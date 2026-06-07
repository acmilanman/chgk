const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');
const storage = require('./storage');
const gameEngine = require('../engine/game');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SOUNDS_DIR = path.join(DATA_DIR, 'sounds');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const GAME_FILE = path.join(DATA_DIR, 'game_save.json');
const GAME_BACKUP = path.join(DATA_DIR, 'game_save.json.bak');
const PASSWORD_FILE = path.join(DATA_DIR, 'admin_password.txt');
const PASSWORD_BACKUP = path.join(DATA_DIR, 'admin_password.txt.bak');
const ADMIN_LOG_FILE = path.join(DATA_DIR, 'admin_logs.json');

for (const dir of [DATA_DIR, SOUNDS_DIR, IMAGES_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

class StateManager {
  constructor() {
    this.game = this._defaultGame();
    this.clients = { admin: new Set(), captains: new Set(), players: new Set() };
    this.deviceToTeam = new Map();
    this.teamToDevice = new Map();
    this.cachedSounds = { beep: null, gong: null };
    this._saveDebounceTimer = null;
    this._cache = {};
    this._cacheDirty = {};

    this._initPassword();
    this.reloadSoundCache();
    this._loadGame();
  }

  _defaultGame() {
    return {
      autoStartTimerOnQuestion: true,
      overtimeSeconds: 0,
      displayMode: 'normal',
      showStep: -1,
      questions: [],
      teams: [],
      rawAnswers: {},
      answerLog: {},
      results: {},
      timer: {
        running: false,
        startTime: null,
        durationSec: 60,
        remainingSec: 60,
        overtimeActive: false
      },
      soundEnabledCaptains: false,
      soundEnabledScreens: false
    };
  }

  // ===================== PERSISTENCE =====================

  _initPassword() {
    if (!fs.existsSync(PASSWORD_FILE)) {
      this._writePasswordSync('Z-123456');
      logger.info('Default admin password created');
    }
  }

  _writePasswordSync(pass) {
    fs.writeFileSync(PASSWORD_FILE, String(pass), 'utf8');
    try {
      fs.copyFileSync(PASSWORD_FILE, PASSWORD_BACKUP);
    } catch (e) {
      logger.warn(`Failed to copy password backup: ${e.message}`);
    }
  }

  getAdminPassword() {
    try {
      return fs.readFileSync(PASSWORD_FILE, 'utf8').trim();
    } catch {
      return 'Z-123456';
    }
  }

  setAdminPassword(newPass) {
    try {
      this._writePasswordSync(newPass);
      return true;
    } catch (e) {
      logger.error(`Failed to write admin password: ${e.message}`);
      return false;
    }
  }

  logAdminAttempt(ip, userAgent, success, enteredPassword) {
    try {
      let logs = fs.existsSync(ADMIN_LOG_FILE)
        ? JSON.parse(fs.readFileSync(ADMIN_LOG_FILE, 'utf8').trim() || '[]')
        : [];
      logs.push({
        timestamp: Date.now(),
        ip: ip || 'unknown',
        userAgent: userAgent || 'unknown',
        success
      });
      if (logs.length > 50) logs = logs.slice(-50);
      fs.writeFileSync(ADMIN_LOG_FILE, JSON.stringify(logs, null, 2));
    } catch (e) {
      logger.error(`Error writing admin log: ${e.message}`);
    }
  }

  getAdminLogs() {
    try {
      if (fs.existsSync(ADMIN_LOG_FILE)) {
        const content = fs.readFileSync(ADMIN_LOG_FILE, 'utf8');
        if (content.trim()) return JSON.parse(content);
      }
    } catch (e) {
      logger.error(`Error reading admin logs: ${e.message}`);
    }
    return [];
  }

  async _saveGameToFile() {
    const state = {
      autoStartTimerOnQuestion: this.game.autoStartTimerOnQuestion,
      overtimeSeconds: this.game.overtimeSeconds,
      displayMode: this.game.displayMode,
      showStep: this.game.showStep,
      questions: this.game.questions,
      teams: this.game.teams,
      rawAnswers: this.game.rawAnswers,
      answerLog: this.game.answerLog,
      results: this.game.results,
      timer: { ...this.game.timer, startTime: null }
    };
    const data = JSON.stringify(state, null, 2);
    const ok = await storage.writeText(GAME_FILE, data);
    if (ok) {
      try {
        await fs.promises.copyFile(GAME_FILE, GAME_BACKUP);
      } catch (e) {
        logger.warn(`Failed to create backup: ${e.message}`);
      }
    }
  }

  async _loadGame() {
    const readFile = async (fp) => {
      try {
        const d = await fs.promises.readFile(fp, 'utf8');
        return d && d.trim() ? d : null;
      } catch { return null; }
    };
    let data = await readFile(GAME_FILE);
    if (!data) data = await readFile(GAME_BACKUP);
    if (data) {
      try {
        const state = JSON.parse(data);
        this.game = {
          ...state,
          timer: {
            ...state.timer,
            running: false,
            startTime: null,
            remainingSec: state.timer.durationSec || 60,
            overtimeActive: false
          }
        };
        if (this.game.overtimeSeconds === undefined) this.game.overtimeSeconds = 0;
        logger.info('Game state loaded from file');
        this._migrateGameImages();
      } catch (e) {
        logger.error(`Error parsing game file: ${e.message}`);
      }
    } else {
      logger.info('No saved game found, starting fresh');
    }
  }

  _migrateGameImages() {
    let changed = false;
    for (let i = 0; i < this.game.questions.length; i++) {
      const q = this.game.questions[i];
      for (const field of ['handoutImage', 'commentImage']) {
        if (q[field] && q[field].startsWith('data:')) {
          const url = this._saveImageFromDataUrl(q[field], i, field);
          if (url !== q[field]) {
            q[field] = url;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      logger.info('Migrated data URLs to image files');
      this.autoSave();
    }
  }

  _saveImageFromDataUrl(dataUrl, qIndex, field) {
    if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
    const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) return dataUrl;
    let ext = matches[1];
    if (ext === 'jpeg') ext = 'jpg';
    if (ext === 'svg+xml') ext = 'svg';
    const base64Data = matches[2];
    const hash = crypto.createHash('md5').update(base64Data.slice(0, 1000)).digest('hex').slice(0, 8);
    const filename = `q${qIndex}_${field}_${Date.now()}_${hash}.${ext}`;
    const filePath = path.join(IMAGES_DIR, filename);
    try {
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
      logger.info(`Image saved: ${filename}`);
      return `/i/${filename}`;
    } catch (e) {
      logger.error(`Error saving image: ${e.message}`);
      return dataUrl;
    }
  }

  saveImageFromDataUrl(dataUrl, qIndex, field) {
    return this._saveImageFromDataUrl(dataUrl, qIndex, field);
  }

  autoSave() {
    if (this._saveDebounceTimer) clearTimeout(this._saveDebounceTimer);
    this._saveDebounceTimer = setTimeout(() => {
      this._saveGameToFile();
      this._saveDebounceTimer = null;
    }, 2000);
  }

  // ===================== SOUND =====================

  reloadSoundCache() {
    ['beep', 'gong'].forEach(name => {
      const filePath = path.join(SOUNDS_DIR, `${name}.mp3`);
      try {
        const data = fs.readFileSync(filePath);
        this.cachedSounds[name] = `data:audio/mpeg;base64,${data.toString('base64')}`;
      } catch {
        this.cachedSounds[name] = null;
      }
    });
  }

  // ===================== BROADCAST =====================

  safeSend(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  _invalidateCache(...keys) {
    for (const key of keys) this._cacheDirty[key] = true;
  }

  _getCached(key, computeFn) {
    if (this._cacheDirty[key] || this._cache[key] === undefined) {
      this._cache[key] = computeFn();
      this._cacheDirty[key] = false;
    }
    return this._cache[key];
  }

  getCachedShown() {
    return this._getCached('shown', () => this._computeShown());
  }

  getCachedScores() {
    return this._getCached('scores', () => gameEngine.buildScoresFull(this.game));
  }

  getCachedQuestionsList() {
    return this._getCached('questionsList', () => this.game.questions.map(q => ({
      text: q.text || '',
      answer: q.answer || '',
      comment: q.comment || '',
      hasHandout: !!q.handoutImage,
      hasCommentImg: !!q.commentImage,
      warmup: q.warmup === true
    })));
  }

  broadcast(type, payload, role) {
    const msg = JSON.stringify({ type, payload });
    if (!role || role === 'admin') {
      this.clients.admin.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
    }
    if (!role || role === 'captain') {
      this.clients.captains.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
    }
    if (!role || role === 'player') {
      this.clients.players.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
    }
  }

  // ===================== TIMER =====================

  resetTimer() {
    const t = this.game.timer;
    t.running = false;
    t.startTime = null;
    t.durationSec = 60;
    t.remainingSec = 60;
    t.overtimeActive = false;
    this.broadcast('timer_update', t);
    this.autoSave();
  }

  startTimer(durationSec = 60) {
    const t = this.game.timer;
    t.durationSec = durationSec;
    t.remainingSec = durationSec;
    t.startTime = Date.now();
    t.running = true;
    t.overtimeActive = false;
    this.broadcast('timer_update', t);
    this.autoSave();
  }

  startOvertime(seconds) {
    if (seconds <= 0) {
      this.stopTimer();
      return;
    }
    const t = this.game.timer;
    t.durationSec = seconds;
    t.remainingSec = seconds;
    t.startTime = Date.now();
    t.running = true;
    t.overtimeActive = true;
    this.broadcast('timer_update', t);
    this.autoSave();
  }

  pauseTimer() {
    const t = this.game.timer;
    if (!t.running) return;
    const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
    t.remainingSec = Math.max(0, t.durationSec - elapsed);
    t.running = false;
    this.broadcast('timer_update', t);
    this.autoSave();
  }

  stopTimer() {
    const t = this.game.timer;
    t.running = false;
    t.remainingSec = 0;
    this.broadcast('timer_update', t);
    this.autoSave();
  }

  add10sec() {
    const t = this.game.timer;
    t.durationSec += 10;
    t.remainingSec += 10;
    this.broadcast('timer_update', t);
    this.autoSave();
  }

  tickTimer() {
    const t = this.game.timer;
    if (!t.running) return;
    const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
    const remain = Math.max(0, t.durationSec - elapsed);
    if (remain !== t.remainingSec) {
      t.remainingSec = remain;
      this.broadcast('timer_update', t);
    }
    if (remain === 0) {
      if (!t.overtimeActive && this.game.overtimeSeconds > 0) {
        this.startOvertime(this.game.overtimeSeconds);
      } else {
        t.running = false;
        this.broadcast('timer_update', t);
        this.autoSave();
      }
    }
  }

  // ===================== DISPLAY / STEP =====================

  _computeShown() {
    const game = this.game;
    if (game.displayMode === 'break') return { phase: 'break' };
    if (game.displayMode === 'table') return { phase: 'table' };
    if (!game.questions.length || game.showStep < 0) return { phase: 'waiting' };

    const maxStep = game.questions.length * 2 - 1;
    const step = Math.max(0, Math.min(game.showStep, maxStep));
    const qIndex = Math.floor(step / 2);
    const q = game.questions[qIndex] || {};

    const isWarmup = q.warmup === true;
    let warmupNumber = 0;
    let regularNumber = 0;
    for (let i = 0; i <= qIndex; i++) {
      if (game.questions[i].warmup) warmupNumber++;
      else regularNumber++;
    }
    const displayNumber = isWarmup ? warmupNumber : regularNumber;

    if (step % 2 === 0) {
      return {
        phase: 'question', qIndex,
        questionText: q.text || '',
        handoutImage: q.handoutImage || '',
        isWarmup, warmupNumber, regularNumber, displayNumber,
        questionNumber: qIndex + 1
      };
    }

    return {
      phase: 'answer', qIndex,
      questionText: q.text || '',
      answerText: q.answer || '',
      commentText: q.comment || '',
      handoutImage: q.handoutImage || '',
      commentImage: q.commentImage || '',
      isWarmup, warmupNumber, regularNumber, displayNumber,
      questionNumber: qIndex + 1
    };
  }

  _labelForStep(step) {
    const game = this.game;
    if (step < 0) return 'Ждите';
    const qIndex = Math.floor(step / 2);
    const q = game.questions[qIndex];
    const isWarmup = q && q.warmup === true;
    if (step % 2 === 0) {
      if (isWarmup) {
        let warmupCount = 0;
        for (let i = 0; i <= qIndex; i++) {
          if (game.questions[i].warmup) warmupCount++;
        }
        return `Разминочный ${warmupCount}`;
      } else {
        let regularCount = 0;
        for (let i = 0; i <= qIndex; i++) {
          if (!game.questions[i].warmup) regularCount++;
        }
        return `Вопрос ${regularCount}`;
      }
    } else {
      if (isWarmup) {
        let warmupCount = 0;
        for (let i = 0; i <= qIndex; i++) {
          if (game.questions[i].warmup) warmupCount++;
        }
        return `Ответ ${warmupCount} (разм.)`;
      } else {
        let regularCount = 0;
        for (let i = 0; i <= qIndex; i++) {
          if (!game.questions[i].warmup) regularCount++;
        }
        return `Ответ ${regularCount}`;
      }
    }
  }

  computeLabels() {
    const game = this.game;
    const n = game.questions.length;
    const maxStep = n ? (n * 2 - 1) : -1;
    const shown = this.getCachedShown();

    if (shown.phase === 'waiting') {
      return { nextLabel: n ? 'Показать Вопрос 1' : 'Показать …', prevLabel: 'Назад' };
    }

    if (shown.phase === 'break' || shown.phase === 'table') {
      const currentStep = Math.max(-1, Math.min(game.showStep, maxStep));
      return {
        nextLabel: this._labelForStep(Math.min(maxStep, currentStep + 1)),
        prevLabel: currentStep - 1 < 0 ? 'Назад (Ждите)' : this._labelForStep(currentStep - 1)
      };
    }

    const step = Math.max(-1, Math.min(game.showStep, maxStep));
    return {
      nextLabel: this._labelForStep(Math.min(maxStep, step + 1)),
      prevLabel: step - 1 < 0 ? 'Назад (Ждите)' : this._labelForStep(step - 1)
    };
  }

  // ===================== RESULTS & SCORES =====================

  playedCount() {
    return gameEngine.playedCount(this.game);
  }

  commitVerdictsForQuestion(qIndex) {
    if (qIndex == null || qIndex < 0 || qIndex >= this.game.questions.length) return;
    const q = this.game.questions[qIndex];
    if (q.warmup) return;
    if (!this.game.results[qIndex]) this.game.results[qIndex] = {};
    const rawRow = this.game.rawAnswers[qIndex] || {};
    this.game.teams.forEach(t => {
      const a = rawRow[t.id];
      this.game.results[qIndex][t.id] = (a && (a.verdict === true || a.verdict === false)) ? a.verdict : false;
    });
    this._invalidateCache('scores');
    this.autoSave();
  }

  broadcastScores() {
    const scores = this.getCachedScores();
    this.broadcast('scores_full', scores, 'admin');
    this.broadcast('break_table', scores, 'captain');
    this.broadcast('break_table', scores, 'player');
    this.autoSave();
  }

  // ===================== ANSWERS =====================

  ensureRaw(qIndex) {
    if (!this.game.rawAnswers[qIndex]) this.game.rawAnswers[qIndex] = {};
    return this.game.rawAnswers[qIndex];
  }

  ensureLog(qIndex) {
    if (!this.game.answerLog[qIndex]) this.game.answerLog[qIndex] = {};
    return this.game.answerLog[qIndex];
  }

  appendAnswerLog(qIndex, teamId, text) {
    const logRow = this.ensureLog(qIndex);
    if (!logRow[teamId]) logRow[teamId] = [];
    logRow[teamId].push({ ts: Date.now(), text: String(text || '') });
    if (logRow[teamId].length > 50) logRow[teamId] = logRow[teamId].slice(-50);
    this.autoSave();
  }

  getAnswerLog(qIndex, teamId) {
    const row = this.game.answerLog[qIndex];
    return row ? (row[teamId] || []) : [];
  }

  getAnswersListForAdmin(qIndex) {
    const raw = this.game.rawAnswers[qIndex] || {};
    return this.game.teams.map(t => {
      const a = raw[t.id] || { text: '', verdict: null };
      return { teamId: t.id, text: a.text || '', verdict: a.verdict ?? null };
    });
  }

  // ===================== TEAMS =====================

  addTeams(names, exhibitions) {
    function getUniqueName(baseName, existingNames) {
      let name = baseName;
      let counter = 1;
      while (existingNames.has(name)) {
        counter++;
        name = `${baseName}-${counter}`;
      }
      return name;
    }

    const existingNames = new Set(this.game.teams.map(t => t.name));
    const startId = this.game.teams.length ? Math.max(...this.game.teams.map(t => t.id)) + 1 : 1;
    const newTeams = [];
    const renamedList = [];

    names.forEach((rawName, idx) => {
      const trimmed = String(rawName || '').trim();
      if (!trimmed) return;
      const uniqueName = getUniqueName(trimmed, existingNames);
      existingNames.add(uniqueName);
      if (uniqueName !== trimmed) renamedList.push(`${trimmed} → ${uniqueName}`);
      newTeams.push({ id: startId + idx, name: uniqueName, activeCaptain: false, exhibition: exhibitions[idx] === true });
    });

    if (!newTeams.length) return { ok: false, message: 'Нет корректных названий команд.' };

    this.game.teams.push(...newTeams);
    this.broadcast('teams_update', { teams: this.game.teams });
    this._invalidateCache('scores');
    this.broadcastScores();
    this.autoSave();

    let message = `Добавлено команд: ${newTeams.length}`;
    if (renamedList.length > 0) message += `. Переименованы: ${renamedList.join(', ')}`;
    return { ok: true, message };
  }

  updateTeamExhibition(teamId, exhibition) {
    const team = this.game.teams.find(t => t.id === teamId);
    if (!team) return { ok: false, message: 'Команда не найдена.' };
    team.exhibition = exhibition === true;
    this.broadcast('teams_update', { teams: this.game.teams });
    this._invalidateCache('scores');
    this.broadcastScores();
    this.autoSave();
    return { ok: true, message: 'Статус команды обновлён.' };
  }

  kickTeam(teamId) {
    const dev = this.teamToDevice.get(teamId);
    if (dev) this.deviceToTeam.delete(dev);
    this.teamToDevice.delete(teamId);
    const t = this.game.teams.find(x => x.id === teamId);
    if (t) t.activeCaptain = false;
    this.clients.captains.forEach(cw => {
      if (cw.teamId === teamId) {
        this.safeSend(cw, { type: 'team_kicked', payload: { teamId } });
        cw.teamId = null;
      }
    });
    this.broadcast('teams_update', { teams: this.game.teams });
    this.autoSave();
    return { ok: true, message: `Кик: команда ${teamId}` };
  }

  removeTeam(teamId) {
    const teamIndex = this.game.teams.findIndex(t => t.id === teamId);
    if (teamIndex === -1) return false;
    if (this.game.teams[teamIndex].activeCaptain) {
      const dev = this.teamToDevice.get(teamId);
      if (dev) this.deviceToTeam.delete(dev);
      this.teamToDevice.delete(teamId);
      this.clients.captains.forEach(cw => {
        if (cw.teamId === teamId) {
          this.safeSend(cw, { type: 'team_kicked', payload: { teamId } });
          cw.teamId = null;
        }
      });
    }
    this.game.teams.splice(teamIndex, 1);
    for (const q in this.game.rawAnswers) delete this.game.rawAnswers[q][teamId];
    for (const q in this.game.answerLog) delete this.game.answerLog[q][teamId];
    for (const q in this.game.results) delete this.game.results[q][teamId];
    this.broadcast('teams_update', { teams: this.game.teams });
    this._invalidateCache('scores');
    this.broadcastScores();
    this.autoSave();
    return true;
  }

  kickAllCaptains() {
    this.clients.captains.forEach(ws => {
      if (ws.teamId != null) {
        this.safeSend(ws, { type: 'team_kicked', payload: { teamId: ws.teamId } });
        ws.teamId = null;
      }
    });
  }

  resetTeamsOnly() {
    this.kickAllCaptains();
    this.deviceToTeam.clear();
    this.teamToDevice.clear();
    this.game.teams = [];
    this.game.rawAnswers = {};
    this.game.answerLog = {};
    this.game.results = {};
    this.broadcast('teams_update', { teams: this.game.teams });
    this._invalidateCache('scores');
    this.broadcastScores();
    this.autoSave();
  }

  // ===================== QUESTIONS =====================

  addQuestion(text, answer, comment, warmup) {
    if (!text || !text.trim()) return { ok: false, message: 'Пустой вопрос.' };
    this.game.questions.push({ text: text.trim(), answer: (answer || '').trim(), comment: (comment || '').trim(), handoutImage: '', commentImage: '', warmup: warmup === true });
    this._invalidateCache('questionsList', 'shown');
    this.broadcast('questions_list', this.getCachedQuestionsList(), 'admin');
    this.autoSave();
    return { ok: true, message: `Вопрос добавлен. Всего: ${this.game.questions.length}` };
  }

  loadQuestions(list) {
    this.game.questions = list.map(q => ({
      text: String(q.text || '').trim(),
      answer: String(q.answer || '').trim(),
      comment: String(q.comment || '').trim(),
      handoutImage: String(q.handoutImage || ''),
      commentImage: String(q.commentImage || ''),
      warmup: q.warmup === true
    })).filter(q => q.text);
    this._migrateGameImages();
    this.game.rawAnswers = {};
    this.game.answerLog = {};
    this.game.results = {};
    this.game.displayMode = 'normal';
    this.game.showStep = -1;
    this.resetTimer();
    this._invalidateCache('shown', 'scores', 'questionsList');
    this.broadcast('shown_update', this.getCachedShown(), 'captain');
    this.broadcast('shown_update', this.getCachedShown(), 'player');
    this.broadcastScores();
    this.broadcast('questions_list', this.getCachedQuestionsList(), 'admin');
    this.autoSave();
    return { ok: true, message: `Пакет загружен: ${this.game.questions.length} вопросов.` };
  }

  updateQuestion(idx, data) {
    const q = this.game.questions[idx];
    if (!q) return;
    q.text = String(data.questionText || '').trim();
    q.answer = String(data.answerText || '').trim();
    q.comment = String(data.commentText || '').trim();
    if (data.warmup !== undefined) q.warmup = data.warmup === true;
    this._invalidateCache('questionsList', 'shown');
    this.broadcast('questions_list', this.getCachedQuestionsList(), 'admin');
    this.broadcast('shown_update', this.getCachedShown(), 'captain');
    this.broadcast('shown_update', this.getCachedShown(), 'player');
    this.autoSave();
    return { ok: true, message: `Вопрос ${idx + 1} сохранён.` };
  }

  deleteQuestion(idx) {
    if (idx < 0 || idx >= this.game.questions.length) return;
    this.game.questions.splice(idx, 1);
    this.game.rawAnswers = {};
    this.game.answerLog = {};
    this.game.results = {};
    this.game.displayMode = 'normal';
    this.game.showStep = -1;
    this.resetTimer();
    this._invalidateCache('shown', 'scores', 'questionsList');
    this.broadcast('shown_update', this.getCachedShown(), 'captain');
    this.broadcast('shown_update', this.getCachedShown(), 'player');
    this.broadcastScores();
    this.broadcast('questions_list', this.getCachedQuestionsList(), 'admin');
    this.autoSave();
  }

  moveQuestion(idx, direction) {
    if (idx < 0 || idx >= this.game.questions.length) return;
    let newIdx;
    if (direction === 'up' && idx > 0) newIdx = idx - 1;
    else if (direction === 'down' && idx < this.game.questions.length - 1) newIdx = idx + 1;
    else return;
    const temp = this.game.questions[newIdx];
    this.game.questions[newIdx] = this.game.questions[idx];
    this.game.questions[idx] = temp;
    this._invalidateCache('questionsList', 'shown');
    this.broadcast('questions_list', this.getCachedQuestionsList(), 'admin');
    this.autoSave();
  }

  setWarmup(idx, warmup) {
    if (idx < 0 || idx >= this.game.questions.length) return;
    this.game.questions[idx].warmup = warmup === true;
    if (warmup) {
      for (let i = 0; i < idx; i++) this.game.questions[i].warmup = true;
    } else {
      for (let i = idx; i < this.game.questions.length; i++) this.game.questions[i].warmup = false;
    }
    this._invalidateCache('questionsList', 'shown', 'scores');
    this.broadcast('questions_list', this.getCachedQuestionsList(), 'admin');
    this.autoSave();
  }

  setQuestionImage(idx, field, dataUrl) {
    const q = this.game.questions[idx];
    if (!q) return;
    if (field !== 'handoutImage' && field !== 'commentImage') return;
    q[field] = this._saveImageFromDataUrl(dataUrl, idx, field);
    this._invalidateCache('questionsList', 'shown');
    this.broadcast('questions_list', this.getCachedQuestionsList(), 'admin');
    this.broadcast('shown_update', this.getCachedShown(), 'captain');
    this.broadcast('shown_update', this.getCachedShown(), 'player');
    this.autoSave();
  }

  clearQuestionImage(idx, field) {
    const q = this.game.questions[idx];
    if (!q) return;
    if (field !== 'handoutImage' && field !== 'commentImage') return;
    q[field] = '';
    this._invalidateCache('questionsList', 'shown');
    this.broadcast('questions_list', this.getCachedQuestionsList(), 'admin');
    this.broadcast('shown_update', this.getCachedShown(), 'captain');
    this.broadcast('shown_update', this.getCachedShown(), 'player');
    this.autoSave();
  }

  resetQuestionsOnly() {
    this.game.questions = [];
    this.game.rawAnswers = {};
    this.game.answerLog = {};
    this.game.results = {};
    this.game.displayMode = 'normal';
    this.game.showStep = -1;
    this.resetTimer();
    this._invalidateCache('shown', 'scores', 'questionsList');
    this.broadcast('shown_update', this.getCachedShown(), 'captain');
    this.broadcast('shown_update', this.getCachedShown(), 'player');
    this.broadcastScores();
    this.broadcast('questions_list', this.getCachedQuestionsList(), 'admin');
    this.autoSave();
  }

  // ===================== GAME FLOW =====================

  showNext() {
    if (!this.game.questions.length) {
      this.game.showStep = -1;
      this.game.displayMode = 'normal';
      this._invalidateCache('shown');
      this.broadcast('shown_update', this.getCachedShown(), 'captain');
      this.broadcast('shown_update', this.getCachedShown(), 'player');
      return;
    }
    if (this.game.displayMode !== 'normal') this.game.displayMode = 'normal';
    const before = this.getCachedShown();
    if (before.phase === 'question' || before.phase === 'answer') {
      this.commitVerdictsForQuestion(before.qIndex);
      this.broadcastScores();
    }
    const maxStep = this.game.questions.length * 2 - 1;
    this.game.showStep = Math.min(maxStep, this.game.showStep + 1);
    this._invalidateCache('shown');
    const shown = this.getCachedShown();
    if (shown.phase === 'question') {
      if (this.game.autoStartTimerOnQuestion) this.startTimer(60);
      else this.resetTimer();
    } else {
      this.pauseTimer();
    }
    this.broadcast('shown_update', shown, 'captain');
    this.broadcast('shown_update', shown, 'player');
    if (shown.phase === 'question' || shown.phase === 'answer') {
      this.broadcast('answers_update', { qIndex: shown.qIndex, answers: this.getAnswersListForAdmin(shown.qIndex) }, 'admin');
    } else {
      this.broadcast('answers_update', { qIndex: -1, answers: [] }, 'admin');
    }
    this.autoSave();
  }

  showPrev() {
    if (!this.game.questions.length) {
      this.game.showStep = -1;
      this.game.displayMode = 'normal';
      this._invalidateCache('shown');
      this.broadcast('shown_update', this.getCachedShown(), 'captain');
      this.broadcast('shown_update', this.getCachedShown(), 'player');
      return;
    }
    if (this.game.displayMode !== 'normal') this.game.displayMode = 'normal';
    const maxStep = this.game.questions.length * 2 - 1;
    this.game.showStep = Math.max(-1, this.game.showStep - 1);
    this._invalidateCache('shown');
    const shown = this.getCachedShown();
    if (shown.phase === 'question') {
      if (this.game.autoStartTimerOnQuestion) this.startTimer(60);
      else this.resetTimer();
    } else {
      this.pauseTimer();
    }
    this.broadcast('shown_update', shown, 'captain');
    this.broadcast('shown_update', shown, 'player');
    if (shown.phase === 'question' || shown.phase === 'answer') {
      this.broadcast('answers_update', { qIndex: shown.qIndex, answers: this.getAnswersListForAdmin(shown.qIndex) }, 'admin');
    } else {
      this.broadcast('answers_update', { qIndex: -1, answers: [] }, 'admin');
    }
    this.autoSave();
  }

  setBreak() {
    this.game.displayMode = 'break';
    this.pauseTimer();
    this._invalidateCache('shown');
    this.broadcast('shown_update', this.getCachedShown(), 'captain');
    this.broadcast('shown_update', this.getCachedShown(), 'player');
    this.autoSave();
  }

  showTable() {
    this.game.displayMode = 'table';
    this.pauseTimer();
    this._invalidateCache('shown');
    this.broadcast('shown_update', this.getCachedShown(), 'captain');
    this.broadcast('shown_update', this.getCachedShown(), 'player');
    this.broadcastScores();
    this.autoSave();
  }

  resetShow() {
    this.game.displayMode = 'normal';
    this.game.showStep = -1;
    this.resetTimer();
    this._invalidateCache('shown');
    this.broadcast('shown_update', this.getCachedShown(), 'captain');
    this.broadcast('shown_update', this.getCachedShown(), 'player');
    this.autoSave();
  }

  endGameProcess() {
    this.game.rawAnswers = {};
    this.game.answerLog = {};
    this.game.results = {};
    this.game.displayMode = 'normal';
    this.game.showStep = -1;
    this.resetTimer();
    this._invalidateCache('shown', 'scores');
    this.broadcast('shown_update', this.getCachedShown(), 'captain');
    this.broadcast('shown_update', this.getCachedShown(), 'player');
    this.broadcastScores();
    this.autoSave();
  }

  resetAll() {
    this.resetTeamsOnly();
    this.resetQuestionsOnly();
    this.endGameProcess();
    this.autoSave();
  }

  // ===================== ADMIN STATE =====================

  getAdminState() {
    const shown = this.getCachedShown();
    const labels = this.computeLabels();
    return {
      teams: this.game.teams,
      shown,
      autoStartTimerOnQuestion: this.game.autoStartTimerOnQuestion,
      overtimeSeconds: this.game.overtimeSeconds,
      nextLabel: labels.nextLabel,
      prevLabel: labels.prevLabel,
      sounds: this.cachedSounds,
      soundEnabledCaptains: this.game.soundEnabledCaptains,
      soundEnabledScreens: this.game.soundEnabledScreens
    };
  }

  sendAdminState(ws) {
    this.safeSend(ws, { type: 'admin_state', payload: this.getAdminState() });
    this.safeSend(ws, { type: 'questions_list', payload: { questions: this.getCachedQuestionsList() } });
    this.safeSend(ws, { type: 'timer_update', payload: this.game.timer });
    this.safeSend(ws, { type: 'scores_full', payload: this.getCachedScores() });
    const shown = this.getCachedShown();
    if (shown.phase === 'question' || shown.phase === 'answer') {
      this.safeSend(ws, { type: 'answers_update', payload: { qIndex: shown.qIndex, answers: this.getAnswersListForAdmin(shown.qIndex) } });
    } else {
      this.safeSend(ws, { type: 'answers_update', payload: { qIndex: -1, answers: [] } });
    }
  }

  // ===================== XLSX EXPORTS =====================

  makeResultsXlsxBase64() {
    const scores = this.getCachedScores();
    const qCount = scores.questionsCount;
    const data = scores.rows.map(r => {
      const row = { Команда: r.name };
      for (let i = 0; i < qCount; i++) {
        const v = r.perQuestion[i];
        row[`Вопрос ${i + 1}`] = v === true ? '+' : (v === false ? '−' : '');
      }
      row['Итог'] = r.total;
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 25 }, ...Array(qCount).fill({ wch: 8 }), { wch: 10 }];
    if (data.length > 0) {
      const start = XLSX.utils.encode_cell({ c: 0, r: 0 });
      const end = XLSX.utils.encode_cell({ c: qCount + 1, r: data.length });
      ws['!autofilter'] = { ref: start + ':' + end };
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Результаты');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64');
  }

  makeTeamsXlsxBase64() {
    const data = this.game.teams.map(t => ({ Name: t.name, Exhibition: t.exhibition ? 'Да' : '' }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Teams');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64');
  }

  makeQuestionsXlsxBase64() {
    const data = this.game.questions.map(q => ({
      Question: q.text || '',
      Answer: q.answer || '',
      Comment: q.comment || '',
      Warmup: q.warmup ? 'Да' : '',
      HandoutImage: this._getImageFilename(q.handoutImage),
      CommentImage: this._getImageFilename(q.commentImage)
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Questions');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64');
  }

  _getImageFilename(url) {
    if (!url || url.startsWith('data:')) return '';
    return url.split('/').pop();
  }

  makeQuestionsPackageBase64() {
    const zip = new AdmZip();
    const xlsxBuf = Buffer.from(this.makeQuestionsXlsxBase64(), 'base64');
    zip.addFile('questions.xlsx', xlsxBuf);
    this.game.questions.forEach(q => {
      ['handoutImage', 'commentImage'].forEach(field => {
        const url = q[field];
        if (!url || url.startsWith('data:')) return;
        const filename = url.split('/').pop();
        const filePath = path.join(IMAGES_DIR, filename);
        try {
          if (fs.existsSync(filePath)) zip.addLocalFile(filePath, 'images');
        } catch { }
      });
    });
    return zip.toBuffer().toString('base64');
  }

  // ===================== SAVE / RESTORE =====================

  getGameState() {
    return {
      autoStartTimerOnQuestion: this.game.autoStartTimerOnQuestion,
      overtimeSeconds: this.game.overtimeSeconds,
      displayMode: this.game.displayMode,
      showStep: this.game.showStep,
      questions: this.game.questions,
      teams: this.game.teams,
      rawAnswers: this.game.rawAnswers,
      answerLog: this.game.answerLog,
      results: this.game.results,
      timer: { ...this.game.timer, startTime: null }
    };
  }

  restoreGameState(state) {
    this.game = {
      ...state,
      timer: {
        ...state.timer,
        running: false,
        startTime: null,
        remainingSec: state.timer.durationSec || 60,
        overtimeActive: false
      }
    };
    if (this.game.overtimeSeconds === undefined) this.game.overtimeSeconds = 0;
    this._migrateGameImages();
    this.deviceToTeam.clear();
    this.teamToDevice.clear();
    this.kickAllCaptains();
    this._invalidateCache('shown', 'scores', 'questionsList');
    this.broadcast('shown_update', this.getCachedShown(), 'captain');
    this.broadcast('shown_update', this.getCachedShown(), 'player');
    this.broadcast('teams_update', { teams: this.game.teams });
    this.broadcastScores();
    this.broadcast('questions_list', this.getCachedQuestionsList(), 'admin');
    this.broadcast('timer_update', this.game.timer);
    this.autoSave();
  }

  // ===================== AUTO-START SETTINGS =====================

  setAutoStart(value, overtimeSeconds) {
    this.game.autoStartTimerOnQuestion = !!value;
    if (overtimeSeconds !== undefined && [0, 10, 15].includes(overtimeSeconds)) {
      this.game.overtimeSeconds = overtimeSeconds;
    }
    this.autoSave();
  }

  // ===================== SOUND TOGGLE =====================

  setSoundEnabled(target, value) {
    if (target === 'captains') {
      this.game.soundEnabledCaptains = value;
      this.broadcast('sound_permission', { soundEnabled: value }, 'captain');
      if (value) this.broadcast('sounds_update', this.cachedSounds, 'captain');
    } else if (target === 'screens') {
      this.game.soundEnabledScreens = value;
      this.broadcast('sound_permission', { soundEnabled: value }, 'player');
      if (value) this.broadcast('sounds_update', this.cachedSounds, 'player');
    }
    this.autoSave();
  }

  // ===================== MARK ANSWER / EDIT RESULT =====================

  markAnswer(qIndex, teamId, verdict) {
    const rawRow = this.ensureRaw(qIndex);
    const prev = rawRow[teamId] || { text: '', verdict: null };
    let v = null;
    if (verdict === true) v = true;
    else if (verdict === false) v = false;
    rawRow[teamId] = { text: prev.text || '', verdict: v };
    this.broadcast('answers_update', { qIndex, answers: this.getAnswersListForAdmin(qIndex) }, 'admin');
    this.autoSave();
  }

  commitCurrentQuestion() {
    const shown = this.getCachedShown();
    if (shown.phase !== 'question' && shown.phase !== 'answer') {
      return { ok: false, message: 'Сейчас нет активного вопроса.' };
    }
    this.commitVerdictsForQuestion(shown.qIndex);
    this.broadcastScores();
    return { ok: true, message: `Результаты по вопросу ${shown.qIndex + 1} подтверждены.` };
  }

  getResultsForQuestion(qIndex) {
    const rawRow = this.game.rawAnswers[qIndex] || {};
    return this.getCachedScores().rows.map(r => {
      const teamId = r.teamId;
      const a = rawRow[teamId];
      const last = a ? (a.text || '') : '';
      const log = this.getAnswerLog(qIndex, teamId);
      return {
        teamId,
        teamName: r.name,
        answerText: last,
        result: gameEngine.getResult(this.game, qIndex, teamId),
        answerLog: log
      };
    });
  }

  editResult(qIndex, teamId, value) {
    if (qIndex < 0 || qIndex >= this.game.questions.length) return;
    if (!this.game.results[qIndex]) this.game.results[qIndex] = {};
    if (value === true) this.game.results[qIndex][teamId] = true;
    else if (value === false) this.game.results[qIndex][teamId] = false;
    else delete this.game.results[qIndex][teamId];
    this._invalidateCache('scores');
    this.broadcastScores();
    this.autoSave();
  }
}

module.exports = new StateManager();
