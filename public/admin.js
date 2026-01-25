// public/admin.js
(() => {
  // ----- AUTH (client-side) -----
  const ADMIN_PASSWORD = 'Z-123456';

  const authOverlay = document.getElementById('authOverlay');
  const adminPass = document.getElementById('adminPass');
  const authMsg = document.getElementById('authMsg');
  const btnLogin = document.getElementById('btnLogin');
  const btnToCaptain = document.getElementById('btnToCaptain');

  function isAuthed() {
    return sessionStorage.getItem('chgk_admin_authed') === '1';
  }
  function setAuthed() {
    sessionStorage.setItem('chgk_admin_authed', '1');
  }
  function showAuth() {
    authOverlay.style.display = 'flex';
    setTimeout(() => adminPass.focus(), 50);
  }
  function hideAuth() {
    authOverlay.style.display = 'none';
  }

  btnLogin.onclick = () => {
    const p = adminPass.value.trim();
    if (p === ADMIN_PASSWORD) {
      setAuthed();
      hideAuth();
      initApp();
    } else {
      authMsg.innerHTML = '<div class="msg err">Неверный пароль.</div>';
    }
  };
  btnToCaptain.onclick = () => (location.href = '/captain.html');

  // ----- Tabs -----
  const tabTeams = document.getElementById('tabTeams');
  const tabQuestions = document.getElementById('tabQuestions');
  const tabGame = document.getElementById('tabGame');
  const tabResults = document.getElementById('tabResults');

  const pageTeams = document.getElementById('pageTeams');
  const pageQuestions = document.getElementById('pageQuestions');
  const pageGame = document.getElementById('pageGame');
  const pageResults = document.getElementById('pageResults');

  function showTab(name) {
    tabTeams.classList.toggle('active', name === 'teams');
    tabQuestions.classList.toggle('active', name === 'questions');
    tabGame.classList.toggle('active', name === 'game');
    tabResults.classList.toggle('active', name === 'results');

    pageTeams.classList.toggle('hidden', name !== 'teams');
    pageQuestions.classList.toggle('hidden', name !== 'questions');
    pageGame.classList.toggle('hidden', name !== 'game');
    pageResults.classList.toggle('hidden', name !== 'results');
  }

  tabTeams.onclick = () => showTab('teams');
  tabQuestions.onclick = () => showTab('questions');
  tabGame.onclick = () => showTab('game');
  tabResults.onclick = () => showTab('results');

  // ----- DOM refs -----
  const statusBox = document.getElementById('statusBox');
  const msgBox = document.getElementById('msgBox');

  // Teams tab
  const teamsInput = document.getElementById('teamsInput');
  const btnLoadTeams = document.getElementById('btnLoadTeams');
  const btnExportTeams = document.getElementById('btnExportTeams');
  const btnImportTeams = document.getElementById('btnImportTeams');
  const fileTeams = document.getElementById('fileTeams');

  const btnResetTeams = document.getElementById('btnResetTeams');
  const btnResetAll = document.getElementById('btnResetAll');

  const teamsTbody = document.getElementById('teamsTbody');

  // Questions tab
  const qText = document.getElementById('qText');
  const aText = document.getElementById('aText');
  const btnAddQuestion = document.getElementById('btnAddQuestion');

  const btnExportQuestions = document.getElementById('btnExportQuestions');
  const btnImportQuestions = document.getElementById('btnImportQuestions');
  const fileQuestions = document.getElementById('fileQuestions');

  const btnResetQuestions = document.getElementById('btnResetQuestions');

  const questionsTbody = document.getElementById('questionsTbody');
  const fileHandout = document.getElementById('fileHandout');
  const fileCommentImg = document.getElementById('fileCommentImg');

  // Game tab
  const autoStartChk = document.getElementById('autoStartChk');
  const shownBadge = document.getElementById('shownBadge');
  const shownTitle = document.getElementById('shownTitle');
  const shownBody = document.getElementById('shownBody');

  const btnGameHandout = document.getElementById('btnGameHandout');
  const btnGameCommentImg = document.getElementById('btnGameCommentImg');
  const btnGameClearHandout = document.getElementById('btnGameClearHandout');
  const btnGameClearCommentImg = document.getElementById('btnGameClearCommentImg');
  const fileGameHandout = document.getElementById('fileGameHandout');
  const fileGameCommentImg = document.getElementById('fileGameCommentImg');

  const btnShowPrev = document.getElementById('btnShowPrev');
  const btnShowNext = document.getElementById('btnShowNext');
  const btnBreak = document.getElementById('btnBreak');
  const btnTable = document.getElementById('btnTable');
  const btnResetShow = document.getElementById('btnResetShow');
  const btnEndGame = document.getElementById('btnEndGame');

  const timerValue = document.getElementById('timerValue');
  const timerHint = document.getElementById('timerHint');
  const btnTimerStart = document.getElementById('btnTimerStart');
  const btnTimerPause = document.getElementById('btnTimerPause');
  const btnTimerStop = document.getElementById('btnTimerStop');
  const btnTimerAdd10 = document.getElementById('btnTimerAdd10');

  const answersTbody = document.getElementById('answersTbody');
  const btnCommitCurrent = document.getElementById('btnCommitCurrent');

  const scoreHead = document.getElementById('scoreHead');
  const scoreBody = document.getElementById('scoreBody');

  // Results tab
  const resQuestionSelect = document.getElementById('resQuestionSelect');
  const btnResRefresh = document.getElementById('btnResRefresh');
  const resTbody = document.getElementById('resTbody');

  // ----- State -----
  let ws = null;
  let state = null;          // admin_state
  let questionsList = [];    // questions_list
  let currentAnswers = [];   // answers_update
  let fullScores = null;     // scores_full
  let resultsRows = null;    // results_question rows

  let pendingImage = null;     // { index, field }
  let pendingGameImage = null; // { index, field }

  // ----- Helpers -----
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function showOk(text) {
    msgBox.innerHTML = `<div class="msg ok">${escapeHtml(text)}</div>`;
  }
  function showErr(text) {
    msgBox.innerHTML = `<div class="msg err">${escapeHtml(text)}</div>`;
  }

  function send(type, payload = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, payload }));
  }

  function downloadBase64Xlsx(filename, base64) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'file.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  }

  function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('FileReader error'));
      r.onload = () => resolve(r.result);
      r.readAsArrayBuffer(file);
    });
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('FileReader error'));
      r.onload = () => resolve(r.result);
      r.readAsDataURL(file);
    });
  }

  function bytesFromArrayBuffer(buf) {
    return new Uint8Array(buf);
  }

  function parseTeamsFromXlsx(workbook) {
    const name = workbook.SheetNames[0];
    const ws0 = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws0, { defval: '' });

    const names = rows.map(r => {
      const v = r.Name ?? r.name ?? r.Team ?? r.team ?? r.Команда ?? r['Название'] ?? '';
      return String(v || '').trim();
    }).filter(Boolean);

    return names;
  }

  function parseQuestionsFromXlsx(workbook) {
    const name = workbook.SheetNames[0];
    const ws0 = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws0, { defval: '' });

    return rows.map(r => ({
      text: String(r.Question ?? r.question ?? r.Вопрос ?? r['Текст'] ?? '').trim(),
      answer: String(r.Answer ?? r.answer ?? r.Ответ ?? '').trim(),
      comment: String(r.Comment ?? r.comment ?? r.Комментарий ?? '').trim(),
      handoutImage: String(r.HandoutImage ?? r.handoutImage ?? '').trim(),
      commentImage: String(r.CommentImage ?? r.commentImage ?? '').trim()
    })).filter(q => q.text);
  }

  function currentShownQIndex() {
    const shown = state?.shown;
    if (!shown) return -1;
    if (shown.phase !== 'question' && shown.phase !== 'answer') return -1;
    return shown.qIndex ?? -1;
  }

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  }

  // ----- Renderers -----
  function renderState() {
    if (!state) return;

    btnShowNext.textContent = state.nextLabel || 'Показать …';
    btnShowPrev.textContent = state.prevLabel || 'Назад';
    autoStartChk.checked = !!state.autoStartTimerOnQuestion;

    const shown = state.shown;

    if (!shown || shown.phase === 'waiting') {
      shownBadge.textContent = 'Ждите';
      shownTitle.textContent = 'Ждите';
      shownBody.textContent = 'У капитанов экран ожидания.';
      return;
    }

    if (shown.phase === 'break') {
      shownBadge.textContent = 'Перерыв';
      shownTitle.textContent = 'Перерыв';
      shownBody.textContent = 'У капитанов экран “Перерыв”.';
      return;
    }

    if (shown.phase === 'table') {
      shownBadge.textContent = 'Таблица';
      shownTitle.textContent = 'Таблица результатов';
      shownBody.textContent = 'У капитанов экран “Таблица результатов”.';
      return;
    }

    const n = (shown.qIndex ?? 0) + 1;
    if (shown.phase === 'question') {
      shownBadge.textContent = `Вопрос ${n}`;
      shownTitle.textContent = `Показан вопрос ${n}`;
      shownBody.textContent = shown.questionText || '';
    } else {
      shownBadge.textContent = `Ответ ${n}`;
      shownTitle.textContent = `Показан ответ ${n}`;
      shownBody.textContent =
        `Вопрос:\n${shown.questionText || ''}\n\nОтвет:\n${shown.answerText || ''}\n\nКомментарий:\n${shown.commentText || ''}`;
    }
  }

  function renderTeamsTable() {
    teamsTbody.innerHTML = '';
    const teams = state?.teams || [];
    teams.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(t.name)}</td>
        <td>${t.activeCaptain ? 'Да' : 'Нет'}</td>
        <td>${t.activeCaptain ? `<button class="btn small danger miniBtn" data-kick="${t.id}">Кик</button>` : ''}</td>
      `;
      teamsTbody.appendChild(tr);
    });
  }

  function renderQuestionsList() {
    questionsTbody.innerHTML = '';
    questionsList.forEach((q, idx) => {
      const hasH = !!q.hasHandout;
      const hasC = !!q.hasCommentImg;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><textarea data-q="text" data-index="${idx}" rows="3">${escapeHtml(q.text || '')}</textarea></td>
        <td><textarea data-q="answer" data-index="${idx}" rows="3">${escapeHtml(q.answer || '')}</textarea></td>
        <td><textarea data-q="comment" data-index="${idx}" rows="3">${escapeHtml(q.comment || '')}</textarea></td>

        <td style="text-align:left;">
          <div class="row" style="gap:8px;">
            <button class="btn small secondary miniBtn" data-img="handout" data-index="${idx}">
              Раздатка${hasH ? ' ✓' : ''}
            </button>
            <button class="btn small secondary miniBtn" data-img="comment" data-index="${idx}">
              Комм.${hasC ? ' ✓' : ''}
            </button>
          </div>
          <div class="row" style="gap:8px; margin-top:8px;">
            <button class="btn small secondary miniBtn" data-img-clear="handout" data-index="${idx}">
              Убрать раздатку
            </button>
            <button class="btn small secondary miniBtn" data-img-clear="comment" data-index="${idx}">
              Убрать комм
            </button>
          </div>
        </td>

        <td class="row" style="justify-content:center;">
          <button class="btn small ok miniBtn" data-save="${idx}">Сохранить</button>
          <button class="btn small danger miniBtn" data-del="${idx}">Удалить</button>
        </td>
      `;
      questionsTbody.appendChild(tr);
    });

    renderResultsQuestionSelect();
  }

  function renderAnswers() {
    answersTbody.innerHTML = '';
    const teams = state?.teams || [];
    const map = new Map(currentAnswers.map(a => [a.teamId, a]));

    teams.forEach(t => {
      const a = map.get(t.id) || { teamId: t.id, text: '', verdict: null };
      const verdict = a.verdict;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(t.name)}</td>
        <td style="text-align:left;">${escapeHtml(a.text || '')}</td>
        <td>
          <select data-team-id="${t.id}">
            <option value="" ${verdict === null ? 'selected' : ''}>—</option>
            <option value="true" ${verdict === true ? 'selected' : ''}>+</option>
            <option value="false" ${verdict === false ? 'selected' : ''}>−</option>
          </select>
        </td>
      `;
      answersTbody.appendChild(tr);
    });
  }

  function renderFullScoreTable() {
    if (!fullScores) return;

    const qCount = fullScores.questionsCount || 0;

    let h = '<tr><th>Команда</th>';
    for (let i = 0; i < qCount; i++) h += `<th>${i + 1}</th>`;
    h += '<th>Итого</th></tr>';
    scoreHead.innerHTML = h;

    scoreBody.innerHTML = '';
    (fullScores.rows || []).forEach(r => {
      const tr = document.createElement('tr');
      let rowHtml = `<td>${escapeHtml(r.name)}</td>`;
      for (let i = 0; i < qCount; i++) {
        const v = (r.perQuestion || [])[i];
        let s = '';
        if (v === true) s = '+';
        else if (v === false) s = '−';
        rowHtml += `<td>${s}</td>`;
      }
      rowHtml += `<td>${r.total || 0}</td>`;
      tr.innerHTML = rowHtml;
      scoreBody.appendChild(tr);
    });
  }

  function renderResultsQuestionSelect() {
    const prev = resQuestionSelect.value;
    resQuestionSelect.innerHTML = '';

    if (!questionsList.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Нет вопросов';
      resQuestionSelect.appendChild(opt);
      return;
    }

    questionsList.forEach((q, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = `Вопрос ${idx + 1}`;
      resQuestionSelect.appendChild(opt);
    });

    if (prev) resQuestionSelect.value = prev;
  }

  function buildLogHtml(answerLog, lastText) {
    const list = Array.isArray(answerLog) ? answerLog : [];
    if (!list.length) return `<div class="logBox">Нет отправок (в зачёт пойдёт то, что было в поле при автоотправке, если она сработала).</div>`;

    const lines = list.map((x, i) => {
      const t = fmtTime(x.ts);
      const txt = String(x.text || '');
      const isLast = (i === list.length - 1);

      // последний вариант подсвечиваем и делаем жирным (в нём же lastText)
      if (isLast) {
        return `<span class="logLine last">[${escapeHtml(t)}] ${escapeHtml(txt)}</span>`;
      }
      return `<div class="logLine">[${escapeHtml(t)}] ${escapeHtml(txt)}</div>`;
    }).join('');

    return `<div class="logBox">${lines}</div>`;
  }

  function renderResultsRows() {
    resTbody.innerHTML = '';
    if (!resultsRows || !Array.isArray(resultsRows)) return;

    resultsRows.forEach(r => {
      const val = r.result;
      const last = r.answerText || '';
      const logHtml = buildLogHtml(r.answerLog, last);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.teamName)}</td>
        <td style="text-align:left;">
          <div><strong>${escapeHtml(last || '—')}</strong></div>
          ${logHtml}
        </td>
        <td>
          <select data-res-team-id="${r.teamId}">
            <option value="" ${val === undefined ? 'selected' : ''}>—</option>
            <option value="true" ${val === true ? 'selected' : ''}>+</option>
            <option value="false" ${val === false ? 'selected' : ''}>−</option>
          </select>
        </td>
      `;
      resTbody.appendChild(tr);
    });
  }

  // ----- Handlers -----
  function initApp() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}/?role=admin`);

    ws.onopen = () => { statusBox.textContent = 'WebSocket: подключено'; };
    ws.onerror = () => { statusBox.textContent = 'WebSocket: ошибка'; };
    ws.onclose = () => { statusBox.textContent = 'WebSocket: закрыто'; };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      const { type, payload } = msg;

      if (type === 'admin_ok') showOk(payload.message || 'OK');
      if (type === 'admin_error') showErr(payload.message || 'Ошибка');

      if (type === 'admin_state') {
        state = payload;
        renderState();
        renderTeamsTable();
      }

      if (type === 'teams_update') {
        if (!state) state = {};
        state.teams = payload.teams;
        renderTeamsTable();
      }

      if (type === 'timer_update') {
        timerValue.textContent = payload.remainingSec;
        timerHint.textContent = payload.running ? 'идёт' : 'остановлен';
      }

      if (type === 'questions_list') {
        questionsList = payload.questions || [];
        renderQuestionsList();
      }

      if (type === 'answers_update') {
        currentAnswers = payload.answers || [];
        renderAnswers();
      }

      if (type === 'scores_full') {
        fullScores = payload;
        renderFullScoreTable();
      }

      if (type === 'admin_file') {
        downloadBase64Xlsx(payload.filename, payload.base64);
      }

      if (type === 'results_question') {
        resultsRows = payload.rows || [];
        renderResultsRows();
      }
    };

    // Teams actions
    btnLoadTeams.onclick = () => {
      const lines = teamsInput.value
        .split('\n')
        .map(x => x.trim())
        .filter(Boolean);
      send('admin_load_teams', { names: lines });
    };

    btnResetTeams.onclick = () => {
      if (confirm('Сбросить команды?')) send('admin_reset_teams');
    };

    btnResetAll.onclick = () => {
      if (confirm('Сбросить ВСЁ (команды, вопросы, игру)?')) send('admin_reset_all');
    };

    teamsTbody.addEventListener('click', (e) => {
      const id = e.target?.getAttribute?.('data-kick');
      if (!id) return;
      send('admin_kick_team', { teamId: Number(id) });
    });

    // Export/import teams
    btnExportTeams.onclick = () => send('admin_export_teams_xlsx');

    btnImportTeams.onclick = () => fileTeams.click();

    fileTeams.onchange = async () => {
      const f = fileTeams.files?.[0];
      fileTeams.value = '';
      if (!f) return;

      try {
        const buf = await fileToArrayBuffer(f);
        const wb = XLSX.read(bytesFromArrayBuffer(buf), { type: 'array' });
        const names = parseTeamsFromXlsx(wb);
        teamsInput.value = names.join('\n');
        send('admin_load_teams', { names });
      } catch (err) {
        showErr('Не смог прочитать teams.xlsx');
      }
    };

    // Questions actions
    btnAddQuestion.onclick = () => {
      const q = qText.value.trim();
      const aAll = aText.value.trim();
      const parts = aAll.split('\n');
      const answer = (parts[0] || '').trim();
      const comment = parts.slice(1).join('\n').trim();

      send('admin_add_question', {
        questionText: q,
        answerText: answer,
        commentText: comment
      });

      qText.value = '';
      aText.value = '';
    };

    btnResetQuestions.onclick = () => {
      if (confirm('Очистить все вопросы?')) send('admin_reset_questions');
    };

    btnExportQuestions.onclick = () => send('admin_export_questions_xlsx');

    btnImportQuestions.onclick = () => fileQuestions.click();

    fileQuestions.onchange = async () => {
      const f = fileQuestions.files?.[0];
      fileQuestions.value = '';
      if (!f) return;

      try {
        const buf = await fileToArrayBuffer(f);
        const wb = XLSX.read(bytesFromArrayBuffer(buf), { type: 'array' });
        const list = parseQuestionsFromXlsx(wb);
        send('admin_load_questions', { questions: list });
      } catch (err) {
        showErr('Не смог прочитать questions.xlsx');
      }
    };

    // Questions table: save/delete/images
    questionsTbody.addEventListener('click', async (e) => {
      const saveIndex = e.target?.getAttribute?.('data-save');
      const delIndex = e.target?.getAttribute?.('data-del');

      const imgKind = e.target?.getAttribute?.('data-img'); // handout|comment
      const imgClear = e.target?.getAttribute?.('data-img-clear'); // handout|comment
      const imgIdx = e.target?.getAttribute?.('data-index');

      if (saveIndex !== null && saveIndex !== undefined) {
        const idx = Number(saveIndex);
        const text = document.querySelector(`textarea[data-q="text"][data-index="${idx}"]`).value;
        const answer = document.querySelector(`textarea[data-q="answer"][data-index="${idx}"]`).value;
        const comment = document.querySelector(`textarea[data-q="comment"][data-index="${idx}"]`).value;

        send('admin_update_question', {
          index: idx,
          questionText: text,
          answerText: answer,
          commentText: comment
        });
        return;
      }

      if (delIndex !== null && delIndex !== undefined) {
        const idx = Number(delIndex);
        if (confirm(`Удалить вопрос ${idx + 1}? Показ сбросится.`)) {
          send('admin_delete_question', { index: idx });
        }
        return;
      }

      if (imgKind && imgIdx != null) {
        const idx = Number(imgIdx);
        pendingImage = {
          index: idx,
          field: imgKind === 'handout' ? 'handoutImage' : 'commentImage'
        };
        if (imgKind === 'handout') fileHandout.click();
        else fileCommentImg.click();
        return;
      }

      if (imgClear && imgIdx != null) {
        const idx = Number(imgIdx);
        const field = imgClear === 'handout' ? 'handoutImage' : 'commentImage';
        send('admin_clear_question_image', { index: idx, field });
      }
    });

    async function handleQuestionImageFileInput(inputEl) {
      const f = inputEl.files?.[0];
      inputEl.value = '';
      if (!f || !pendingImage) return;

      if (f.size > 1024 * 1024) {
        showErr('Картинка слишком большая (нужно ≤ 1MB).');
        pendingImage = null;
        return;
      }

      try {
        const dataUrl = await fileToDataURL(f);
        send('admin_set_question_image', {
          index: pendingImage.index,
          field: pendingImage.field,
          dataUrl
        });
      } catch (e) {
        showErr('Не смог прочитать картинку.');
      } finally {
        pendingImage = null;
      }
    }

    fileHandout.onchange = () => handleQuestionImageFileInput(fileHandout);
    fileCommentImg.onchange = () => handleQuestionImageFileInput(fileCommentImg);

    // Game controls
    btnResetShow.onclick = () => send('admin_reset_show');
    btnShowNext.onclick = () => send('admin_show_next');
    btnShowPrev.onclick = () => send('admin_show_prev');
    btnBreak.onclick = () => send('admin_break_simple');
    btnTable.onclick = () => send('admin_show_table');
    btnEndGame.onclick = () => {
      if (confirm('Закончить игру (сброс процесса)?')) send('admin_end_game');
    };

    btnTimerStart.onclick = () => send('admin_timer_start');
    btnTimerPause.onclick = () => send('admin_timer_pause');
    btnTimerStop.onclick = () => send('admin_timer_stop');
    btnTimerAdd10.onclick = () => send('admin_timer_add10');

    autoStartChk.onchange = () => {
      send('admin_set_autostart', { value: autoStartChk.checked });
    };

    // answers table select
    answersTbody.addEventListener('change', (e) => {
      if (e.target.tagName !== 'SELECT') return;

      const teamId = Number(e.target.getAttribute('data-team-id'));
      const shown = state?.shown;
      if (!shown || (shown.phase !== 'question' && shown.phase !== 'answer')) return;

      let verdict = null;
      if (e.target.value === 'true') verdict = true;
      if (e.target.value === 'false') verdict = false;

      send('admin_mark_answer', { qIndex: shown.qIndex, teamId, verdict });
    });

    btnCommitCurrent.onclick = () => send('admin_commit_current');

    // Game: set current question images (from current shown qIndex)
    btnGameHandout.onclick = () => {
      const qIndex = currentShownQIndex();
      if (qIndex < 0) return showErr('Сейчас нет активного вопроса.');
      pendingGameImage = { field: 'handoutImage', index: qIndex };
      fileGameHandout.click();
    };
    btnGameCommentImg.onclick = () => {
      const qIndex = currentShownQIndex();
      if (qIndex < 0) return showErr('Сейчас нет активного вопроса.');
      pendingGameImage = { field: 'commentImage', index: qIndex };
      fileGameCommentImg.click();
    };
    btnGameClearHandout.onclick = () => {
      const qIndex = currentShownQIndex();
      if (qIndex < 0) return showErr('Сейчас нет активного вопроса.');
      send('admin_clear_question_image', { index: qIndex, field: 'handoutImage' });
    };
    btnGameClearCommentImg.onclick = () => {
      const qIndex = currentShownQIndex();
      if (qIndex < 0) return showErr('Сейчас нет активного вопроса.');
      send('admin_clear_question_image', { index: qIndex, field: 'commentImage' });
    };

    async function handleGameImageInput(inputEl) {
      const f = inputEl.files?.[0];
      inputEl.value = '';
      if (!f || !pendingGameImage) return;

      if (f.size > 1024 * 1024) {
        showErr('Картинка слишком большая (нужно ≤ 1MB).');
        pendingGameImage = null;
        return;
      }

      try {
        const dataUrl = await fileToDataURL(f);
        send('admin_set_question_image', {
          index: pendingGameImage.index,
          field: pendingGameImage.field,
          dataUrl
        });
      } catch (e) {
        showErr('Не смог прочитать картинку.');
      } finally {
        pendingGameImage = null;
      }
    }

    fileGameHandout.onchange = () => handleGameImageInput(fileGameHandout);
    fileGameCommentImg.onchange = () => handleGameImageInput(fileGameCommentImg);

    // Results tab
    function refreshResults() {
      const qIndex = Number(resQuestionSelect.value);
      if (!Number.isFinite(qIndex)) return;
      send('admin_results_question', { qIndex });
    }

    btnResRefresh.onclick = () => refreshResults();
    resQuestionSelect.onchange = () => refreshResults();

    resTbody.addEventListener('change', (e) => {
      if (e.target.tagName !== 'SELECT') return;
      const teamId = Number(e.target.getAttribute('data-res-team-id'));
      const qIndex = Number(resQuestionSelect.value);

      let value = null;
      if (e.target.value === 'true') value = true;
      if (e.target.value === 'false') value = false;

      send('admin_edit_result', { qIndex, teamId, value });

      // (по желанию) можно тут же обновить таблицу результатов
      // refreshResults();
    });
  }

  // start
  if (!isAuthed()) showAuth();
  else initApp();
})();
