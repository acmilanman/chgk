// server.js

const express = require('express');
const path = require('path');
const { WebSocketServer } = require('ws');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/captain')); // корень ведёт в капитанку
app.get('/captain', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'captain.html'))
);
app.get('/player', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'player.html'))
);
app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
);

app.use(express.json({ limit: '5mb' }));

const server = app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

const clients = {
  admin: new Set(),
  captains: new Set(),
  players: new Set()
};

// device lock
const deviceToTeam = new Map(); // deviceId -> teamId
const teamToDevice = new Map(); // teamId -> deviceId

let game = {
  autoStartTimerOnQuestion: true,
  displayMode: 'normal', // normal | break | table
  showStep: -1, // -1 waiting, 0..2N-1 steps
  questions: [], // {text, answer, comment, handoutImage?, commentImage?}
  teams: [], // {id, name, activeCaptain:false}

  // rawAnswers[qIndex][teamId] = { text, verdict:null|true|false }
  rawAnswers: {},

  // answerLog[qIndex][teamId] = [ {ts, text} ... ] (история всех отправок)
  answerLog: {},

  // results[qIndex][teamId] = true|false
  results: {},

  timer: {
    running: false,
    startTime: null,
    durationSec: 60,
    remainingSec: 60
  }
};

function safeSend(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(type, payload, role = null) {
  const msg = { type, payload };
  if (!role || role === 'admin') clients.admin.forEach(ws => safeSend(ws, msg));
  if (!role || role === 'captain') clients.captains.forEach(ws => safeSend(ws, msg));
  if (!role || role === 'player') clients.players.forEach(ws => safeSend(ws, msg));
}

function nowShown() {
  if (game.displayMode === 'break') return { phase: 'break' };
  if (game.displayMode === 'table') return { phase: 'table' };
  if (!game.questions.length || game.showStep < 0) return { phase: 'waiting' };

  const maxStep = game.questions.length * 2 - 1;
  const step = Math.max(0, Math.min(game.showStep, maxStep));
  const qIndex = Math.floor(step / 2);
  const q = game.questions[qIndex] || {};

  if (step % 2 === 0) {
    return {
      phase: 'question',
      qIndex,
      questionText: q.text || '',
      handoutImage: q.handoutImage || ''
    };
  }

  return {
    phase: 'answer',
    qIndex,
    questionText: q.text || '',
    answerText: q.answer || '',
    commentText: q.comment || '',
    handoutImage: q.handoutImage || '',
    commentImage: q.commentImage || ''
  };
}

function computeLabels() {
  const n = game.questions.length;
  const maxStep = n ? (n * 2 - 1) : -1;
  const shown = nowShown();

  let nextLabel = 'Показать …';
  let prevLabel = 'Назад';

  if (shown.phase === 'waiting') {
    nextLabel = n ? 'Показать Вопрос 1' : 'Показать …';
    prevLabel = 'Назад';
    return { nextLabel, prevLabel };
  }

  if (shown.phase === 'break' || shown.phase === 'table') {
    nextLabel = 'Продолжить';
    prevLabel = 'Назад';
    return { nextLabel, prevLabel };
  }

  const step = Math.max(-1, Math.min(game.showStep, maxStep));
  const nextStep = Math.min(maxStep, step + 1);
  const prevStep = Math.max(-1, step - 1);

  nextLabel = labelForStep(nextStep);
  prevLabel = (prevStep < 0) ? 'Назад (Ждите)' : labelForStep(prevStep);
  return { nextLabel, prevLabel };
}

function labelForStep(step) {
  if (step < 0) return 'Ждите';
  const qIndex = Math.floor(step / 2);
  const n = qIndex + 1;
  return (step % 2 === 0) ? `Вопрос ${n}` : `Ответ ${n}`;
}

// -------- Timer --------
function resetTimer() {
  game.timer.running = false;
  game.timer.startTime = null;
  game.timer.durationSec = 60;
  game.timer.remainingSec = 60;
  broadcast('timer_update', game.timer);
}

function startTimer(durationSec = 60) {
  game.timer.durationSec = durationSec;
  game.timer.remainingSec = durationSec;
  game.timer.startTime = Date.now();
  game.timer.running = true;
  broadcast('timer_update', game.timer);
}

function pauseTimer() {
  const t = game.timer;
  if (!t.running) return;
  const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
  t.remainingSec = Math.max(0, t.durationSec - elapsed);
  t.running = false;
  broadcast('timer_update', t);
}

function stopTimer() {
  const t = game.timer;
  t.running = false;
  t.remainingSec = 0;
  broadcast('timer_update', t);
}

function add10sec() {
  game.timer.durationSec += 10;
  broadcast('timer_update', game.timer);
}

setInterval(() => {
  const t = game.timer;
  if (!t.running) return;

  const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
  const remain = Math.max(0, t.durationSec - elapsed);

  if (remain !== t.remainingSec) {
    t.remainingSec = remain;
    broadcast('timer_update', t);
  }

  if (remain === 0) {
    t.running = false;
    broadcast('timer_update', t);
  }
}, 250);

// -------- Results helpers (NEW) --------

// Сколько вопросов уже "сыграно" (то есть уже прошли ответ хотя бы до показа следующего вопроса).
// По вашему требованию: пустыми должны быть только те вопросы, которые еще не отыграли.
// Здесь считаем "отыгранным" любой вопрос с индексом < текущего вопроса в normal-режиме.
function playedCount() {
  // showStep: -1 wait, 0=Q1,1=A1,2=Q2,3=A2...
  if (!game.questions.length || game.showStep < 0) return 0;

  const maxStep = game.questions.length * 2 - 1;
  const step = Math.max(0, Math.min(game.showStep, maxStep));
  const qIndex = Math.floor(step / 2);

  // "Отыграны" строго предыдущие вопросы: пока мы на вопросе/ответе N, вопросы < N уже завершены.
  // qIndex здесь 0-based текущий. Значит отыграно qIndex.
  return qIndex;
}

// Зафиксировать вердикты (true/false) в results для qIndex.
// Если у команды нет выбранного вердикта (null/undefined), считаем это как "-" (false) — под ваш п.4.
function commitVerdictsForQuestion(qIndex) {
  if (qIndex == null || qIndex < 0 || qIndex >= game.questions.length) return;

  if (!game.results[qIndex]) game.results[qIndex] = {};
  const rawRow = game.rawAnswers[qIndex] || {};

  game.teams.forEach(t => {
    const a = rawRow[t.id];
    const verdict =
      (a && (a.verdict === true || a.verdict === false))
        ? a.verdict
        : false;
    game.results[qIndex][t.id] = verdict;
  });
}

// -------- Scores / ranking --------
function getResult(qIndex, teamId) {
  const row = game.results[qIndex];
  if (!row) return undefined;
  return row[teamId];
}

function computeTotal(teamId) {
  let total = 0;
  for (let i = 0; i < game.questions.length; i++) {
    if (getResult(i, teamId) === true) total += 1;
  }
  return total;
}

function compareTeamsByTieBreak(a, b) {
  const ta = computeTotal(a.id);
  const tb = computeTotal(b.id);
  if (tb !== ta) return tb - ta;

  for (let i = game.questions.length - 1; i >= 0; i--) {
    const ra = (getResult(i, a.id) === true);
    const rb = (getResult(i, b.id) === true);
    if (ra !== rb) return rb ? 1 : -1;
  }

  return (a.name || '').localeCompare(b.name || '', 'ru');
}

function buildScoresFull() {
  const qCount = game.questions.length;
  const teamsSorted = [...game.teams].sort(compareTeamsByTieBreak);

  const played = playedCount(); // <-- NEW

  const rows = teamsSorted.map(t => {
    const perQuestion = [];
    for (let i = 0; i < qCount; i++) {
      const r = getResult(i, t.id); // true/false/undefined
      if (i < played) {
        // уже отыграно: нет "+" => "-"
        perQuestion.push(r === true ? true : false);
      } else {
        // будущие: оставляем как есть (undefined => пусто)
        perQuestion.push(r);
      }
    }

    return {
      teamId: t.id,
      name: t.name,
      perQuestion,
      total: computeTotal(t.id)
    };
  });

  return { questionsCount: qCount, rows };
}

function broadcastScores() {
  const scores = buildScoresFull();
  broadcast('scores_full', scores, 'admin');
  broadcast('break_table', scores, 'captain');
  broadcast('break_table', scores, 'player');
}

// -------- Helpers: answers --------
function ensureRaw(qIndex) {
  if (!game.rawAnswers[qIndex]) game.rawAnswers[qIndex] = {};
  return game.rawAnswers[qIndex];
}

function ensureLog(qIndex) {
  if (!game.answerLog[qIndex]) game.answerLog[qIndex] = {};
  return game.answerLog[qIndex];
}

function appendAnswerLog(qIndex, teamId, text) {
  const logRow = ensureLog(qIndex);
  if (!logRow[teamId]) logRow[teamId] = [];
  logRow[teamId].push({ ts: Date.now(), text: String(text || '') });
  // ограничим лог, чтобы не раздувался (на всякий)
  if (logRow[teamId].length > 50) logRow[teamId] = logRow[teamId].slice(-50);
}

function getAnswerLog(qIndex, teamId) {
  const row = game.answerLog[qIndex];
  const list = row ? (row[teamId] || []) : [];
  return list;
}

function getAnswersListForAdmin(qIndex) {
  const raw = game.rawAnswers[qIndex] || {};
  return game.teams.map(t => {
    const a = raw[t.id] || { text: '', verdict: null };
    return { teamId: t.id, text: a.text || '', verdict: a.verdict ?? null };
  });
}

function sendAdminState(ws) {
  const shown = nowShown();
  const labels = computeLabels();

  safeSend(ws, {
    type: 'admin_state',
    payload: {
      teams: game.teams,
      shown,
      autoStartTimerOnQuestion: game.autoStartTimerOnQuestion,
      nextLabel: labels.nextLabel,
      prevLabel: labels.prevLabel
    }
  });

  safeSend(ws, {
    type: 'questions_list',
    payload: {
      questions: game.questions.map(q => ({
        text: q.text || '',
        answer: q.answer || '',
        comment: q.comment || '',
        hasHandout: !!q.handoutImage,
        hasCommentImg: !!q.commentImage
      }))
    }
  });

  safeSend(ws, { type: 'timer_update', payload: game.timer });
  safeSend(ws, { type: 'scores_full', payload: buildScoresFull() });

  if (shown.phase === 'question' || shown.phase === 'answer') {
    safeSend(ws, {
      type: 'answers_update',
      payload: { qIndex: shown.qIndex, answers: getAnswersListForAdmin(shown.qIndex) }
    });
  } else {
    safeSend(ws, { type: 'answers_update', payload: { qIndex: -1, answers: [] } });
  }
}

// -------- XLSX export --------
function makeTeamsXlsxBase64() {
  const data = game.teams.map(t => ({ Name: t.name }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Teams');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buf.toString('base64');
}

function makeQuestionsXlsxBase64() {
  const data = game.questions.map(q => ({
    Question: q.text || '',
    Answer: q.answer || '',
    Comment: q.comment || '',
    HandoutImage: q.handoutImage || '',
    CommentImage: q.commentImage || ''
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Questions');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buf.toString('base64');
}

// -------- Reset actions --------
function kickAllCaptains() {
  clients.captains.forEach(ws => {
    if (ws.teamId != null) {
      safeSend(ws, { type: 'team_kicked', payload: { teamId: ws.teamId } });
      ws.teamId = null;
    }
  });
}

function resetTeamsOnly() {
  kickAllCaptains();
  deviceToTeam.clear();
  teamToDevice.clear();
  game.teams = [];
  game.rawAnswers = {};
  game.answerLog = {};
  game.results = {};
  broadcast('teams_update', { teams: game.teams });
  broadcastScores();
}

function resetQuestionsOnly() {
  game.questions = [];
  game.rawAnswers = {};
  game.answerLog = {};
  game.results = {};
  game.displayMode = 'normal';
  game.showStep = -1;

  resetTimer();

  broadcast('shown_update', nowShown(), 'captain');
  broadcast('shown_update', nowShown(), 'player');
  broadcastScores();
  broadcast('questions_list', { questions: [] }, 'admin');
}

function endGameProcess() {
  game.rawAnswers = {};
  game.answerLog = {};
  game.results = {};
  game.displayMode = 'normal';
  game.showStep = -1;

  resetTimer();

  broadcast('shown_update', nowShown(), 'captain');
  broadcast('shown_update', nowShown(), 'player');
  broadcastScores();
}

function resetAll() {
  resetTeamsOnly();
  resetQuestionsOnly();
  endGameProcess();
}

// -------- WS handling --------
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const role = (url.searchParams.get('role') || '').toLowerCase();

  ws.role = role;
  ws.teamId = null;
  ws.deviceId = null;

  if (role === 'admin') clients.admin.add(ws);
  else if (role === 'captain') clients.captains.add(ws);
  else if (role === 'player') clients.players.add(ws);
  else {
    ws.close();
    return;
  }

  ws.on('close', () => {
    if (ws.role === 'admin') clients.admin.delete(ws);
    if (ws.role === 'player') clients.players.delete(ws);
    if (ws.role === 'captain') {
      clients.captains.delete(ws);
      if (ws.teamId != null) {
        const t = game.teams.find(x => x.id === ws.teamId);
        if (t) t.activeCaptain = false;
        broadcast('teams_update', { teams: game.teams });
      }
    }
  });

  // init
  if (role === 'admin') {
    sendAdminState(ws);
    safeSend(ws, { type: 'admin_ok', payload: { message: 'Админ подключён.' } });
  }

  if (role === 'captain') {
    safeSend(ws, {
      type: 'init_for_captain',
      payload: { teams: game.teams, shown: nowShown(), timer: game.timer }
    });
  }

  if (role === 'player') {
    safeSend(ws, {
      type: 'init_for_player',
      payload: { shown: nowShown(), timer: game.timer }
    });
    safeSend(ws, { type: 'break_table', payload: buildScoresFull() });
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { type, payload } = msg || {};
    if (!type) return;

    // ---------- CAPTAIN ----------
    if (ws.role === 'captain') {
      if (type === 'captain_hello') {
        const deviceId = String(payload?.deviceId || '').trim();
        if (!deviceId) return;

        ws.deviceId = deviceId;

        const assigned = deviceToTeam.get(deviceId);
        if (assigned != null) {
          ws.teamId = assigned;
          const t = game.teams.find(x => x.id === assigned);
          if (t) t.activeCaptain = true;
          broadcast('teams_update', { teams: game.teams });
          safeSend(ws, { type: 'captain_session', payload: { assignedTeamId: assigned } });
        } else {
          safeSend(ws, { type: 'captain_session', payload: { assignedTeamId: null } });
        }
        return;
      }

      if (type === 'captain_pick_team') {
        const teamId = Number(payload?.teamId);
        if (!ws.deviceId) {
          safeSend(ws, { type: 'error', payload: { message: 'Нет deviceId. Перезагрузите страницу.' } });
          return;
        }

        const team = game.teams.find(t => t.id === teamId);
        if (!team) {
          safeSend(ws, { type: 'error', payload: { message: 'Команда не найдена.' } });
          return;
        }

        const already = deviceToTeam.get(ws.deviceId);
        if (already != null && already !== teamId) {
          safeSend(ws, { type: 'error', payload: { message: 'Это устройство уже закреплено за другой командой.' } });
          return;
        }

        const boundDev = teamToDevice.get(teamId);
        if (boundDev && boundDev !== ws.deviceId) {
          safeSend(ws, { type: 'error', payload: { message: 'Команда уже занята другим устройством.' } });
          return;
        }

        deviceToTeam.set(ws.deviceId, teamId);
        teamToDevice.set(teamId, ws.deviceId);
        ws.teamId = teamId;

        team.activeCaptain = true;
        broadcast('teams_update', { teams: game.teams });
        safeSend(ws, { type: 'team_confirmed', payload: { teamId } });
        return;
      }

      if (type === 'captain_logout') {
        if (ws.teamId != null) {
          const teamId = ws.teamId;
          const dev = ws.deviceId;

          const t = game.teams.find(x => x.id === teamId);
          if (t) t.activeCaptain = false;

          if (dev) deviceToTeam.delete(dev);
          teamToDevice.delete(teamId);

          ws.teamId = null;
          broadcast('teams_update', { teams: game.teams });
        }

        safeSend(ws, { type: 'captain_logged_out', payload: {} });
        return;
      }

      if (type === 'captain_send_answer') {
        if (ws.teamId == null) {
          safeSend(ws, { type: 'error', payload: { message: 'Сначала выберите команду.' } });
          return;
        }

        const shown = nowShown();
        if (shown.phase !== 'question') {
          safeSend(ws, { type: 'error', payload: { message: 'Сейчас нельзя отправлять ответ.' } });
          return;
        }

        const qIndex = shown.qIndex;
        const text = String(payload?.text || '').trim();

        // 1) логируем каждый отправленный вариант
        appendAnswerLog(qIndex, ws.teamId, text);

        // 2) rawAnswers хранит "последний"
        const rawRow = ensureRaw(qIndex);
        const prev = rawRow[ws.teamId] || { text: '', verdict: null };
        rawRow[ws.teamId] = { text, verdict: prev.verdict ?? null };

        // обновить админам таблицу ответов
        broadcast('answers_update', { qIndex, answers: getAnswersListForAdmin(qIndex) }, 'admin');

        safeSend(ws, { type: 'answer_ok', payload: {} });
        return;
      }
    }

    // ---------- ADMIN ----------
    if (ws.role === 'admin') {
      if (type === 'admin_load_teams') {
        const names = Array.isArray(payload?.names) ? payload.names : [];
        resetTeamsOnly();

        game.teams = names.map((name, idx) => ({
          id: idx + 1,
          name: String(name || '').trim(),
          activeCaptain: false
        })).filter(t => t.name);

        broadcast('teams_update', { teams: game.teams });
        broadcastScores();

        safeSend(ws, { type: 'admin_ok', payload: { message: `Команды загружены: ${game.teams.length}` } });
        sendAdminState(ws);
        return;
      }

      if (type === 'admin_reset_teams') {
        resetTeamsOnly();
        safeSend(ws, { type: 'admin_ok', payload: { message: 'Команды сброшены.' } });
        sendAdminState(ws);
        return;
      }

      if (type === 'admin_reset_questions') {
        resetQuestionsOnly();
        safeSend(ws, { type: 'admin_ok', payload: { message: 'Вопросы очищены.' } });
        sendAdminState(ws);
        return;
      }

      if (type === 'admin_end_game') {
        endGameProcess();
        safeSend(ws, { type: 'admin_ok', payload: { message: 'Игра завершена (процесс сброшен).' } });
        sendAdminState(ws);
        return;
      }

      if (type === 'admin_reset_all') {
        resetAll();
        safeSend(ws, { type: 'admin_ok', payload: { message: 'Сброшено ВСЁ.' } });
        sendAdminState(ws);
        return;
      }

      if (type === 'admin_kick_team') {
        const teamId = Number(payload?.teamId);

        const dev = teamToDevice.get(teamId);
        if (dev) deviceToTeam.delete(dev);
        teamToDevice.delete(teamId);

        const t = game.teams.find(x => x.id === teamId);
        if (t) t.activeCaptain = false;

        clients.captains.forEach(cw => {
          if (cw.teamId === teamId) {
            safeSend(cw, { type: 'team_kicked', payload: { teamId } });
            cw.teamId = null;
          }
        });

        broadcast('teams_update', { teams: game.teams });
        safeSend(ws, { type: 'admin_ok', payload: { message: `Кик: команда ${teamId}` } });
        return;
      }

      if (type === 'admin_add_question') {
        const q = String(payload?.questionText || '').trim();
        const a = String(payload?.answerText || '').trim();
        const c = String(payload?.commentText || '').trim();

        if (!q) {
          safeSend(ws, { type: 'admin_error', payload: { message: 'Пустой вопрос.' } });
          return;
        }

        game.questions.push({ text: q, answer: a, comment: c, handoutImage: '', commentImage: '' });

        safeSend(ws, { type: 'admin_ok', payload: { message: `Вопрос добавлен. Всего: ${game.questions.length}` } });

        broadcast('questions_list', {
          questions: game.questions.map(x => ({
            text: x.text || '',
            answer: x.answer || '',
            comment: x.comment || '',
            hasHandout: !!x.handoutImage,
            hasCommentImg: !!x.commentImage
          }))
        }, 'admin');

        sendAdminState(ws);
        return;
      }

      if (type === 'admin_load_questions') {
        const list = Array.isArray(payload?.questions) ? payload.questions : [];

        game.questions = list.map(q => ({
          text: String(q.text || '').trim(),
          answer: String(q.answer || '').trim(),
          comment: String(q.comment || '').trim(),
          handoutImage: String(q.handoutImage || ''),
          commentImage: String(q.commentImage || '')
        })).filter(q => q.text);

        game.rawAnswers = {};
        game.answerLog = {};
        game.results = {};
        game.displayMode = 'normal';
        game.showStep = -1;

        resetTimer();

        broadcast('shown_update', nowShown(), 'captain');
        broadcast('shown_update', nowShown(), 'player');
        broadcastScores();

        broadcast('questions_list', {
          questions: game.questions.map(x => ({
            text: x.text || '',
            answer: x.answer || '',
            comment: x.comment || '',
            hasHandout: !!x.handoutImage,
            hasCommentImg: !!x.commentImage
          }))
        }, 'admin');

        safeSend(ws, { type: 'admin_ok', payload: { message: `Пакет загружен: ${game.questions.length} вопросов.` } });
        sendAdminState(ws);
        return;
      }

      if (type === 'admin_update_question') {
        const idx = Number(payload?.index);
        const q = game.questions[idx];
        if (!q) return;

        q.text = String(payload?.questionText || '').trim();
        q.answer = String(payload?.answerText || '').trim();
        q.comment = String(payload?.commentText || '').trim();

        broadcast('questions_list', {
          questions: game.questions.map(x => ({
            text: x.text || '',
            answer: x.answer || '',
            comment: x.comment || '',
            hasHandout: !!x.handoutImage,
            hasCommentImg: !!x.commentImage
          }))
        }, 'admin');

        broadcast('shown_update', nowShown(), 'captain');
        broadcast('shown_update', nowShown(), 'player');

        safeSend(ws, { type: 'admin_ok', payload: { message: `Вопрос ${idx + 1} сохранён.` } });
        return;
      }

      if (type === 'admin_delete_question') {
        const idx = Number(payload?.index);
        if (idx < 0 || idx >= game.questions.length) return;

        game.questions.splice(idx, 1);

        game.rawAnswers = {};
        game.answerLog = {};
        game.results = {};
        game.displayMode = 'normal';
        game.showStep = -1;

        resetTimer();

        broadcast('shown_update', nowShown(), 'captain');
        broadcast('shown_update', nowShown(), 'player');
        broadcastScores();

        broadcast('questions_list', {
          questions: game.questions.map(x => ({
            text: x.text || '',
            answer: x.answer || '',
            comment: x.comment || '',
            hasHandout: !!x.handoutImage,
            hasCommentImg: !!x.commentImage
          }))
        }, 'admin');

        safeSend(ws, { type: 'admin_ok', payload: { message: `Вопрос удалён.` } });
        sendAdminState(ws);
        return;
      }

      if (type === 'admin_set_question_image') {
        const idx = Number(payload?.index);
        const field = String(payload?.field || '');
        const dataUrl = String(payload?.dataUrl || '');
        const q = game.questions[idx];
        if (!q) return;
        if (field !== 'handoutImage' && field !== 'commentImage') return;

        q[field] = dataUrl;

        broadcast('questions_list', {
          questions: game.questions.map(x => ({
            text: x.text || '',
            answer: x.answer || '',
            comment: x.comment || '',
            hasHandout: !!x.handoutImage,
            hasCommentImg: !!x.commentImage
          }))
        }, 'admin');

        broadcast('shown_update', nowShown(), 'captain');
        broadcast('shown_update', nowShown(), 'player');

        safeSend(ws, { type: 'admin_ok', payload: { message: `Картинка обновлена (вопрос ${idx + 1}).` } });
        return;
      }

      if (type === 'admin_clear_question_image') {
        const idx = Number(payload?.index);
        const field = String(payload?.field || '');
        const q = game.questions[idx];
        if (!q) return;
        if (field !== 'handoutImage' && field !== 'commentImage') return;

        q[field] = '';

        broadcast('questions_list', {
          questions: game.questions.map(x => ({
            text: x.text || '',
            answer: x.answer || '',
            comment: x.comment || '',
            hasHandout: !!x.handoutImage,
            hasCommentImg: !!x.commentImage
          }))
        }, 'admin');

        broadcast('shown_update', nowShown(), 'captain');
        broadcast('shown_update', nowShown(), 'player');

        safeSend(ws, { type: 'admin_ok', payload: { message: `Картинка удалена (вопрос ${idx + 1}).` } });
        return;
      }

      if (type === 'admin_set_autostart') {
        game.autoStartTimerOnQuestion = !!payload?.value;
        safeSend(ws, { type: 'admin_ok', payload: { message: 'Настройка обновлена.' } });
        sendAdminState(ws);
        return;
      }

      if (type === 'admin_reset_show') {
        game.displayMode = 'normal';
        game.showStep = -1;

        resetTimer();

        broadcast('shown_update', nowShown(), 'captain');
        broadcast('shown_update', nowShown(), 'player');

        sendAdminState(ws);
        return;
      }

      if (type === 'admin_break_simple') {
        game.displayMode = 'break';

        pauseTimer();

        broadcast('shown_update', nowShown(), 'captain');
        broadcast('shown_update', nowShown(), 'player');

        sendAdminState(ws);
        return;
      }

      if (type === 'admin_show_table') {
        game.displayMode = 'table';

        pauseTimer();

        broadcast('shown_update', nowShown(), 'captain');
        broadcast('shown_update', nowShown(), 'player');

        broadcastScores();
        sendAdminState(ws);
        return;
      }

      if (type === 'admin_show_next' || type === 'admin_show_prev') {
        if (!game.questions.length) {
          game.showStep = -1;
          game.displayMode = 'normal';

          broadcast('shown_update', nowShown(), 'captain');
          broadcast('shown_update', nowShown(), 'player');

          sendAdminState(ws);
          return;
        }

        if (game.displayMode !== 'normal') game.displayMode = 'normal';

        // --- NEW: при "вперед" фиксируем результаты текущего вопроса
        const before = nowShown();
        if (type === 'admin_show_next' && (before.phase === 'question' || before.phase === 'answer')) {
          commitVerdictsForQuestion(before.qIndex);
          broadcastScores();
        }

        const maxStep = game.questions.length * 2 - 1;

        if (type === 'admin_show_next') game.showStep = Math.min(maxStep, game.showStep + 1);
        if (type === 'admin_show_prev') game.showStep = Math.max(-1, game.showStep - 1);

        const shown = nowShown();

        if (shown.phase === 'question') {
          if (game.autoStartTimerOnQuestion) startTimer(60);
          else resetTimer();
        } else {
          pauseTimer();
        }

        broadcast('shown_update', shown, 'captain');
        broadcast('shown_update', shown, 'player');

        if (shown.phase === 'question' || shown.phase === 'answer') {
          broadcast('answers_update', { qIndex: shown.qIndex, answers: getAnswersListForAdmin(shown.qIndex) }, 'admin');
        } else {
          broadcast('answers_update', { qIndex: -1, answers: [] }, 'admin');
        }

        sendAdminState(ws);
        return;
      }

      if (type === 'admin_timer_start') return startTimer(60);
      if (type === 'admin_timer_pause') return pauseTimer();
      if (type === 'admin_timer_stop') return stopTimer();
      if (type === 'admin_timer_add10') return add10sec();

      if (type === 'admin_mark_answer') {
        const qIndex = Number(payload?.qIndex);
        const teamId = Number(payload?.teamId);
        const verdict = payload?.verdict;

        const rawRow = ensureRaw(qIndex);
        const prev = rawRow[teamId] || { text: '', verdict: null };

        let v = null;
        if (verdict === true) v = true;
        else if (verdict === false) v = false;

        rawRow[teamId] = { text: prev.text || '', verdict: v };

        broadcast('answers_update', { qIndex, answers: getAnswersListForAdmin(qIndex) }, 'admin');
        return;
      }

      if (type === 'admin_commit_current') {
        const shown = nowShown();
        if (shown.phase !== 'question' && shown.phase !== 'answer') {
          safeSend(ws, { type: 'admin_error', payload: { message: 'Сейчас нет активного вопроса.' } });
          return;
        }

        const qIndex = shown.qIndex;
        commitVerdictsForQuestion(qIndex); // (обновлено через общий хелпер)
        broadcastScores();

        safeSend(ws, { type: 'admin_ok', payload: { message: `Результаты по вопросу ${qIndex + 1} подтверждены.` } });
        return;
      }

      // ------ RESULTS TAB DATA ------
      // rows: teamName, lastAnswer, result, log[]
      if (type === 'admin_results_question') {
        const qIndex = Number(payload?.qIndex);
        const rawRow = game.rawAnswers[qIndex] || {};

        const out = buildScoresFull().rows.map(r => {
          const teamId = r.teamId;
          const a = rawRow[teamId];
          const last = a ? (a.text || '') : '';
          const log = getAnswerLog(qIndex, teamId);

          return {
            teamId,
            teamName: r.name,
            answerText: last,
            result: getResult(qIndex, teamId),
            answerLog: log // [{ts,text}...]
          };
        });

        safeSend(ws, { type: 'results_question', payload: { qIndex, rows: out } });
        return;
      }

      if (type === 'admin_edit_result') {
        const qIndex = Number(payload?.qIndex);
        const teamId = Number(payload?.teamId);
        const value = payload?.value;

        if (qIndex < 0 || qIndex >= game.questions.length) return;
        if (!game.results[qIndex]) game.results[qIndex] = {};

        if (value === true) game.results[qIndex][teamId] = true;
        else if (value === false) game.results[qIndex][teamId] = false;
        else delete game.results[qIndex][teamId];

        broadcastScores();
        safeSend(ws, { type: 'admin_ok', payload: { message: `Зачёт изменён (вопрос ${qIndex + 1}).` } });
        return;
      }

      if (type === 'admin_export_teams_xlsx') {
        const b64 = makeTeamsXlsxBase64();
        safeSend(ws, { type: 'admin_file', payload: { filename: 'teams.xlsx', base64: b64 } });
        return;
      }

      if (type === 'admin_export_questions_xlsx') {
        const b64 = makeQuestionsXlsxBase64();
        safeSend(ws, { type: 'admin_file', payload: { filename: 'questions.xlsx', base64: b64 } });
        return;
      }

      return;
    }
  });
});
