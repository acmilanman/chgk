// public/admin.js
(() => {
  // Sound unlock across tabs disabled; локальное разблокирование
  // ----- Состояние -----
  let ws = null;
  let reconnectAttempts = 0;
  const maxReconnectDelay = 30000;
  let state = null;          // admin_state
  let questionsList = [];    // questions_list
  let currentAnswers = [];   // answers_update
  let fullScores = null;     // scores_full
  let resultsRows = null;    // results_question rows

  let pendingImage = null;     // { index, field }
  let pendingGameImage = null; // { index, field }

  // Звук для админа (через data URL из WebSocket, без HTTP-запросов)
  let soundsData = { beep: null, gong: null };
  let sound60Enabled = localStorage.getItem('adminSound60') !== 'false';
  let soundOvertimeEnabled = localStorage.getItem('adminSoundOvertime') !== 'false';
  let warnedAt0 = false;
  let gongPlayed = false;

  let soundEnabledCaptains = false;
  let soundEnabledScreens = false;

  // Флаг разблокировки аудио (для автоматического воспроизведения)
  let audioUnlocked = false;

  // ----- DOM элементы -----
  const authOverlay = document.getElementById('authOverlay');
  const adminPass = document.getElementById('adminPass');
  const authMsg = document.getElementById('authMsg');
  const btnLogin = document.getElementById('btnLogin');
  const btnToCaptain = document.getElementById('btnToCaptain');
  const statusBox = document.getElementById('statusBox');
  const msgBox = document.getElementById('msgBox');

  const tabTeams = document.getElementById('tabTeams');
  const tabQuestions = document.getElementById('tabQuestions');
  const tabGame = document.getElementById('tabGame');
  const tabResults = document.getElementById('tabResults');
  const tabSettings = document.getElementById('tabSettings');
  const pageTeams = document.getElementById('pageTeams');
  const pageQuestions = document.getElementById('pageQuestions');
  const pageGame = document.getElementById('pageGame');
  const pageResults = document.getElementById('pageResults');
  const pageSettings = document.getElementById('pageSettings');

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
  const warmupCheckbox = document.getElementById('warmupCheckbox');
  const btnAddQuestion = document.getElementById('btnAddQuestion');
  const btnExportQuestions = document.getElementById('btnExportQuestions');
  const btnImportQuestions = document.getElementById('btnImportQuestions');
  const fileQuestions = document.getElementById('fileQuestions');
  const btnExportPackage = document.getElementById('btnExportPackage');
  const btnImportPackage = document.getElementById('btnImportPackage');
  const filePackage = document.getElementById('filePackage');
  const btnResetQuestions = document.getElementById('btnResetQuestions');
  const questionsTbody = document.getElementById('questionsTbody');
  const fileHandout = document.getElementById('fileHandout');
  const fileCommentImg = document.getElementById('fileCommentImg');

  // Game tab
  const autoStartChk = document.getElementById('autoStartChk');
  const overtimeSelect = document.getElementById('overtimeSelect');
  const shownBadge = document.getElementById('shownBadge');
  const shownTitle = document.getElementById('shownTitle');
  const shownBody = document.getElementById('shownBody');
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

  // Settings tab
  const btnSaveGame = document.getElementById('btnSaveGame');
  const btnLoadGame = document.getElementById('btnLoadGame');
  const fileGameLoad = document.getElementById('fileGameLoad');
  const btnExportResults = document.getElementById('btnExportResults');
  const sound60Checkbox = document.getElementById('sound60SecCheckbox');
  const soundOvertimeCheckbox = document.getElementById('soundOvertimeCheckbox');
  const btnChangePassword = document.getElementById('btnChangePassword');
  const changePasswordModal = document.getElementById('changePasswordModal');
  const oldPasswordInput = document.getElementById('oldPassword');
  const newPasswordInput = document.getElementById('newPassword');
  const confirmPasswordInput = document.getElementById('confirmPassword');
  const btnChangePasswordSubmit = document.getElementById('btnChangePasswordSubmit');
  const btnChangePasswordCancel = document.getElementById('btnChangePasswordCancel');
  const changePasswordMsg = document.getElementById('changePasswordMsg');
  const btnShowLogs = document.getElementById('btnShowLogs');
  const logsTableContainer = document.getElementById('logsTableContainer');
  const logsTbody = document.getElementById('logsTbody');

  // Элементы для загрузки звуков (будут добавлены в admin.html)
  const soundBeepInput = document.getElementById('soundBeepInput');
  const soundGongInput = document.getElementById('soundGongInput');
  const btnUploadBeep = document.getElementById('btnUploadBeep');
  const btnUploadGong = document.getElementById('btnUploadGong');
  const btnTestBeep = document.getElementById('btnTestBeep');
  const btnTestGong = document.getElementById('btnTestGong');
  const btnUnlockAudio = document.getElementById('btnUnlockAudio');
  const soundCaptainsCheckbox = document.getElementById('soundCaptainsCheckbox');
  const soundScreensCheckbox = document.getElementById('soundScreensCheckbox');

  // ----- Helper: parse User-Agent to short browser name -----
  function parseUserAgent(ua) {
    if (!ua) return 'Неизвестно';
    ua = ua.toLowerCase();
    if (ua.includes('chrome') && !ua.includes('edg')) return 'Chrome';
    if (ua.includes('firefox')) return 'Firefox';
    if (ua.includes('safari') && !ua.includes('chrome')) return 'Safari';
    if (ua.includes('edg')) return 'Edge';
    if (ua.includes('opera') || ua.includes('opr')) return 'Opera';
    return 'Другой';
  }

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
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('WebSocket не подключён, сообщение не отправлено');
    }
  }

  function downloadBase64Xlsx(filename, base64) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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
    const exhibitions = rows.map(r => {
      const ex = r.Exhibition ?? r.exhibition ?? r['Вне зачёта'];
      return ex === 'Да' || ex === true;
    });
    return { names, exhibitions };
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
      commentImage: String(r.CommentImage ?? r.commentImage ?? '').trim(),
      warmup: (r.Warmup === 'Да' || r.warmup === true)
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

  // ----- Звук (новый, через HTML5 Audio) -----
function unlockAudio() {
  if (audioUnlocked) return;
  // Создаём AudioContext (он изначально suspended)
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    showErr('Ваш браузер не поддерживает AudioContext');
    return;
  }
  const audioCtx = new AudioCtx();
  // Создаём пустой буфер (1 сэмпл, 1 канал)
  const buffer = audioCtx.createBuffer(1, 1, 22050);
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);
  source.start();
  audioCtx.resume().then(() => {
    audioUnlocked = true;
    showOk('Звук разблокирован');
  }).catch(e => {
    console.warn('Unlock failed', e);
    showErr('Не удалось разблокировать звук. Нажмите ещё раз.');
  });
}

  function playBeep(type) {
    if (!audioUnlocked) return;
    if (type === 'short' && !sound60Enabled) return;
    if (type === 'gong' && !soundOvertimeEnabled) return;
    const dataUrl = type === 'short' ? soundsData.beep : soundsData.gong;
    if (!dataUrl) return;
    const audio = new Audio(dataUrl);
    audio.play().catch(e => console.warn('Playback error:', e));
  }

  function checkSound(remainingSec, overtimeActive) {
    if (remainingSec === 0) {
      if (!overtimeActive && !warnedAt0) {
        warnedAt0 = true;
        playBeep('short');
      } else if (overtimeActive && !gongPlayed) {
        gongPlayed = true;
        playBeep('gong');
      }
    }
  }

  // ----- Загрузка звуков -----
  function uploadSound(type, file) {
    if (!file) {
      showErr('Выберите файл');
      return;
    }
    if (file.size > 1024 * 1024) {
      showErr('Файл слишком большой (макс. 1 МБ)');
      return;
    }
    if (file.type !== 'audio/mpeg') {
      showErr('Поддерживаются только MP3 файлы');
      return;
    }
    const formData = new FormData();
    formData.append('sound', file);
    fetch(`/admin/upload-sound/${type}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': file.type }
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          showOk(`Звук "${type === 'beep' ? '60 секунд' : 'овертайм'}" загружен`);
        } else {
          showErr(`Ошибка загрузки: ${data.message || 'неизвестная'}`);
        }
      })
      .catch(err => {
        console.error(err);
        showErr('Ошибка соединения при загрузке звука');
      });
  }

  function testSound(type) {
    if (!audioUnlocked) {
      showErr('Сначала разблокируйте звук кнопкой "Разрешить звук"');
      return;
    }
    const url = type === 'beep' ? '/sounds/beep.mp3' : '/sounds/gong.mp3';
    const audio = new Audio(url);
    audio.play().catch(e => {
      console.warn(e);
      showErr('Не удалось воспроизвести звук. Возможно, файл не загружен.');
    });
  }

  // ----- Renderers -----
  function renderState() {
    if (!state) return;
    btnShowNext.textContent = state.nextLabel || 'Показать …';
    btnShowPrev.textContent = state.prevLabel || 'Назад';
    autoStartChk.checked = !!state.autoStartTimerOnQuestion;
    if (state.overtimeSeconds !== undefined) overtimeSelect.value = state.overtimeSeconds;
    if (soundCaptainsCheckbox) soundCaptainsCheckbox.checked = !!state.soundEnabledCaptains;
    if (soundScreensCheckbox) soundScreensCheckbox.checked = !!state.soundEnabledScreens;

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
      if (shown.isWarmup) {
        shownBadge.textContent = `Разминочный ${shown.warmupNumber}`;
        shownTitle.textContent = `Показан разминочный вопрос ${shown.warmupNumber}`;
      } else {
        const displayNumber = shown.displayNumber !== undefined ? shown.displayNumber : n;
        shownBadge.textContent = `Вопрос ${displayNumber}`;
        shownTitle.textContent = `Показан вопрос ${displayNumber}`;
      }
      shownBody.textContent = shown.questionText || '';
      warnedAt0 = false;
      gongPlayed = false;
    } else {
      if (shown.isWarmup) {
        shownBadge.textContent = `Ответ ${shown.warmupNumber} (разм.)`;
        shownTitle.textContent = `Показан ответ на разминочный вопрос ${shown.warmupNumber}`;
      } else {
        const displayNumber = shown.displayNumber !== undefined ? shown.displayNumber : n;
        shownBadge.textContent = `Ответ ${displayNumber}`;
        shownTitle.textContent = `Показан ответ ${displayNumber}`;
      }
      shownBody.textContent = `Вопрос:\n${shown.questionText || ''}\n\nОтвет:\n${shown.answerText || ''}\n\nКомментарий:\n${shown.commentText || ''}`;
    }
  }

  function renderTeamsTable() {
    teamsTbody.innerHTML = '';
    const teams = state?.teams || [];
    teams.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align:left;">${escapeHtml(t.name)}</td>
        <td>${t.activeCaptain ? 'Да' : 'Нет'}</td>
        <td><input type="checkbox" class="exhibition-check" data-team-id="${t.id}" ${t.exhibition ? 'checked' : ''}></td>
        <td>
          ${t.activeCaptain ? `<button class="btn small danger miniBtn" data-kick="${t.id}">Кик</button>` : ''}
          <button class="btn small secondary miniBtn" data-remove="${t.id}" title="Удалить команду">🗑️</button>
        </td>
      `;
      teamsTbody.appendChild(tr);
    });
  }

  function renderQuestionsList() {
    questionsTbody.innerHTML = '';
    questionsList.forEach((q, idx) => {
      const hasH = !!q.hasHandout;
      const hasC = !!q.hasCommentImg;
      const isWarmup = !!q.warmup;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><input type="checkbox" class="warmup-check" data-warmup="${idx}" ${isWarmup ? 'checked' : ''}></td>
        <td><textarea data-q="text" data-index="${idx}" rows="3">${escapeHtml(q.text || '')}</textarea></td>
        <td><textarea data-q="answer" data-index="${idx}" rows="3">${escapeHtml(q.answer || '')}</textarea></td>
        <td><textarea data-q="comment" data-index="${idx}" rows="3">${escapeHtml(q.comment || '')}</textarea></td>
        <td style="text-align:left;">
          <div class="row" style="gap:8px;">
            <button class="btn small secondary miniBtn" data-img="handout" data-index="${idx}">Раздатка${hasH ? ' ✓' : ''}</button>
            <button class="btn small secondary miniBtn" data-img="comment" data-index="${idx}">Комм.${hasC ? ' ✓' : ''}</button>
          </div>
          <div class="row" style="gap:8px; margin-top:8px;">
            <button class="btn small secondary miniBtn" data-img-clear="handout" data-index="${idx}">Убрать раздатку</button>
            <button class="btn small secondary miniBtn" data-img-clear="comment" data-index="${idx}">Убрать комм</button>
          </div>
        </td>
        <td class="row" style="justify-content:center;">
          <button class="btn small secondary miniBtn move-btn" data-move="up" data-index="${idx}" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn small secondary miniBtn move-btn" data-move="down" data-index="${idx}" ${idx === questionsList.length-1 ? 'disabled' : ''}>▼</button>
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
        <td style="text-align:left;">${escapeHtml(t.name)}</td>
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
    let h = '<th>Команда</th>';
    for (let i = 0; i < qCount; i++) h += `<th>${i + 1}</th>`;
    h += '<th>Итого</th>';
    scoreHead.innerHTML = h;
    scoreBody.innerHTML = '';
    (fullScores.rows || []).forEach(r => {
      const tr = document.createElement('tr');
      let rowHtml = `<td style="text-align:left;">${escapeHtml(r.name)}</td>`;
      for (let i = 0; i < qCount; i++) {
        const v = (r.perQuestion || [])[i];
        rowHtml += `<td>${v === true ? '+' : (v === false ? '−' : '')}</td>`;
      }
      rowHtml += `<td><strong>${r.total || 0}</strong></td>`;
      tr.innerHTML = rowHtml;
      if (r.exhibition) tr.style.fontStyle = 'italic';
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
      opt.textContent = q.warmup ? `Разминочный ${idx+1}` : `Вопрос ${idx+1}`;
      resQuestionSelect.appendChild(opt);
    });
    if (prev) resQuestionSelect.value = prev;
  }

  function buildLogHtml(answerLog, lastText) {
    const list = Array.isArray(answerLog) ? answerLog : [];
    if (!list.length) return `<div class="logBox">Нет отправок</div>`;
    const lines = list.map((x, i) => {
      const t = fmtTime(x.ts);
      const txt = String(x.text || '');
      const isLast = (i === list.length - 1);
      return isLast ? `<span class="logLine last">[${escapeHtml(t)}] ${escapeHtml(txt)}</span>` : `<div class="logLine">[${escapeHtml(t)}] ${escapeHtml(txt)}</div>`;
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
        <td style="text-align:left;">${escapeHtml(r.teamName)}</td>
        <td style="text-align:left;"><div><strong>${escapeHtml(last || '—')}</strong></div>${logHtml}</td>
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

  // ----- WebSocket -----
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}/?role=admin`);
    ws.onopen = () => { statusBox.textContent = 'WebSocket: подключено'; reconnectAttempts = 0; };
    ws.onerror = () => { statusBox.textContent = 'WebSocket: ошибка'; };
    ws.onclose = () => {
      statusBox.textContent = 'WebSocket: закрыто, переподключение...';
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxReconnectDelay);
      reconnectAttempts++;
      setTimeout(connectWebSocket, delay);
    };
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      const { type, payload } = msg;
      if (type === 'admin_login_result') {
        if (payload.success) { hideAuth(); initApp(); }
        else authMsg.innerHTML = `<div class="msg err">${escapeHtml(payload.message)}</div>`;
        return;
      }
      if (type === 'admin_change_password_result') {
        if (payload.success) {
          showOk(payload.message);
          changePasswordModal.classList.add('hidden');
          oldPasswordInput.value = '';
          newPasswordInput.value = '';
          confirmPasswordInput.value = '';
          changePasswordMsg.innerHTML = '';
        } else changePasswordMsg.innerHTML = `<div class="msg err">${escapeHtml(payload.message)}</div>`;
        return;
      }
      if (type === 'admin_logs_data') {
        logsTbody.innerHTML = '';
        if (payload && payload.length) {
          payload.slice().reverse().forEach(entry => {
            const tr = document.createElement('tr');
            const date = new Date(entry.timestamp).toLocaleString('ru-RU');
            const shortBrowser = parseUserAgent(entry.userAgent);
            const resultText = entry.success ? 'Удачно' : (entry.password ? `Неудачно (пароль: ${escapeHtml(entry.password)})` : 'Неудачно');
            const resultClass = entry.success ? 'msg ok' : 'msg err';
            tr.innerHTML = `
              <td>${escapeHtml(date)}</td>
              <td>${escapeHtml(entry.ip)}</td>
              <td>${escapeHtml(shortBrowser)}</td>
              <td><span class="${resultClass}" style="display:inline-block; padding:2px 8px;">${escapeHtml(resultText)}</span></td>
            `;
            logsTbody.appendChild(tr);
          });
          logsTableContainer.style.display = 'block';
        } else {
          logsTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Нет записей</td></tr>';
          logsTableContainer.style.display = 'block';
        }
        return;
      }
      if (type === 'admin_ok') {
        showOk(payload.message || 'OK');
        if (payload.message && payload.message.includes('Добавлено команд')) teamsInput.value = '';
        return;
      }
      if (type === 'admin_error') { showErr(payload.message || 'Ошибка'); return; }
      if (type === 'admin_state') { state = payload; soundsData = payload.sounds || { beep: null, gong: null }; soundEnabledCaptains = payload.soundEnabledCaptains; soundEnabledScreens = payload.soundEnabledScreens; renderState(); renderTeamsTable(); return; }
      if (type === 'teams_update') { if (!state) state = {}; state.teams = payload.teams; renderTeamsTable(); return; }
      if (type === 'timer_update') { timerValue.textContent = payload.remainingSec; timerHint.textContent = payload.running ? (payload.overtimeActive ? 'овертайм' : 'идёт') : 'остановлен'; checkSound(payload.remainingSec, payload.overtimeActive); return; }
      if (type === 'questions_list') { questionsList = payload.questions || []; renderQuestionsList(); return; }
      if (type === 'answers_update') { currentAnswers = payload.answers || []; renderAnswers(); return; }
      if (type === 'scores_full') { fullScores = payload; renderFullScoreTable(); return; }
      if (type === 'sounds_update') { soundsData = payload || { beep: null, gong: null }; return; }
      if (type === 'admin_file') { downloadBase64Xlsx(payload.filename, payload.base64); return; }
      if (type === 'results_question') { resultsRows = payload.rows || []; renderResultsRows(); return; }
      if (type === 'admin_game_state') {
        const stateStr = JSON.stringify(payload, null, 2);
        const blob = new Blob([stateStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chgk_save_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        showOk('Файл сохранения готов');
        return;
      }
    };
  }

  function showAuth() {
    authOverlay.style.display = 'flex';
    setTimeout(() => adminPass.focus(), 50);
    adminPass.addEventListener('keypress', (e) => { if (e.key === 'Enter') btnLogin.click(); });
    btnLogin.onclick = () => {
      const p = adminPass.value.trim();
      if (!p) { authMsg.innerHTML = '<div class="msg err">Введите пароль</div>'; return; }
      send('admin_login', { password: p });
    };
  }
  function hideAuth() { authOverlay.style.display = 'none'; }

  function initApp() {
    function showTab(name) {
      tabTeams.classList.toggle('active', name === 'teams');
      tabQuestions.classList.toggle('active', name === 'questions');
      tabGame.classList.toggle('active', name === 'game');
      tabResults.classList.toggle('active', name === 'results');
      tabSettings.classList.toggle('active', name === 'settings');
      pageTeams.classList.toggle('hidden', name !== 'teams');
      pageQuestions.classList.toggle('hidden', name !== 'questions');
      pageGame.classList.toggle('hidden', name !== 'game');
      pageResults.classList.toggle('hidden', name !== 'results');
      pageSettings.classList.toggle('hidden', name !== 'settings');
    }
    tabTeams.onclick = () => showTab('teams');
    tabQuestions.onclick = () => showTab('questions');
    tabGame.onclick = () => showTab('game');
    tabResults.onclick = () => showTab('results');
    tabSettings.onclick = () => showTab('settings');
    btnToCaptain.onclick = () => (location.href = '/captain.html');

    if (sound60Checkbox) {
      sound60Checkbox.checked = sound60Enabled;
      sound60Checkbox.onchange = () => { sound60Enabled = sound60Checkbox.checked; localStorage.setItem('adminSound60', sound60Enabled); };
    }
    if (soundOvertimeCheckbox) {
      soundOvertimeCheckbox.checked = soundOvertimeEnabled;
      soundOvertimeCheckbox.onchange = () => { soundOvertimeEnabled = soundOvertimeCheckbox.checked; localStorage.setItem('adminSoundOvertime', soundOvertimeEnabled); };
    }

    if (soundCaptainsCheckbox) {
      soundCaptainsCheckbox.checked = soundEnabledCaptains;
      soundCaptainsCheckbox.onchange = () => {
        soundCaptainsCheckbox.checked ? send('admin_sound_toggle', { target: 'captains', value: true }) : send('admin_sound_toggle', { target: 'captains', value: false });
      };
    }
    if (soundScreensCheckbox) {
      soundScreensCheckbox.checked = soundEnabledScreens;
      soundScreensCheckbox.onchange = () => {
        soundScreensCheckbox.checked ? send('admin_sound_toggle', { target: 'screens', value: true }) : send('admin_sound_toggle', { target: 'screens', value: false });
      };
    }

    // Загрузка звуков
    if (btnUploadBeep && soundBeepInput) {
      btnUploadBeep.onclick = () => uploadSound('beep', soundBeepInput.files[0]);
    }
    if (btnUploadGong && soundGongInput) {
      btnUploadGong.onclick = () => uploadSound('gong', soundGongInput.files[0]);
    }
    if (btnTestBeep) btnTestBeep.onclick = () => testSound('beep');
    if (btnTestGong) btnTestGong.onclick = () => testSound('gong');
    if (btnUnlockAudio) btnUnlockAudio.onclick = unlockAudio;

    btnLoadTeams.onclick = () => {
      const lines = teamsInput.value.split('\n').map(x => x.trim()).filter(Boolean);
      send('admin_load_teams', { names: lines, exhibitions: lines.map(() => false) });
    };
    btnResetTeams.onclick = () => { if (confirm('Сбросить команды?')) send('admin_reset_teams'); };
    btnResetAll.onclick = () => { if (confirm('Сбросить ВСЁ (команды, вопросы, игру)?')) send('admin_reset_all'); };
    teamsTbody.addEventListener('click', (e) => {
      const kickId = e.target?.getAttribute?.('data-kick');
      if (kickId) { send('admin_kick_team', { teamId: Number(kickId) }); return; }
      const removeId = e.target?.getAttribute?.('data-remove');
      if (removeId) { if (confirm('Удалить команду?')) send('admin_remove_team', { teamId: Number(removeId) }); return; }
    });
    teamsTbody.addEventListener('change', (e) => {
      if (e.target.classList.contains('exhibition-check')) {
        const teamId = Number(e.target.getAttribute('data-team-id'));
        const exhibition = e.target.checked;
        send('admin_update_team_exhibition', { teamId, exhibition });
      }
    });
    btnExportTeams.onclick = () => send('admin_export_teams_xlsx');
    btnImportTeams.onclick = () => fileTeams.click();
    fileTeams.onchange = async () => {
      const f = fileTeams.files?.[0];
      fileTeams.value = '';
      if (!f) return;
      try {
        const buf = await fileToArrayBuffer(f);
        const wb = XLSX.read(bytesFromArrayBuffer(buf), { type: 'array' });
        const { names, exhibitions } = parseTeamsFromXlsx(wb);
        teamsInput.value = names.join('\n');
        send('admin_load_teams', { names, exhibitions });
      } catch (err) { console.error(err); showErr('Не смог прочитать teams.xlsx'); }
    };

    btnAddQuestion.onclick = () => {
      const q = qText.value.trim();
      const aAll = aText.value.trim();
      const parts = aAll.split('\n');
      const answer = (parts[0] || '').trim();
      const comment = parts.slice(1).join('\n').trim();
      const warmup = warmupCheckbox.checked;
      send('admin_add_question', { questionText: q, answerText: answer, commentText: comment, warmup });
      qText.value = '';
      aText.value = '';
      warmupCheckbox.checked = false;
    };
    btnResetQuestions.onclick = () => { if (confirm('Очистить все вопросы?')) send('admin_reset_questions'); };
    btnExportQuestions.onclick = () => send('admin_export_questions_xlsx');
    btnImportQuestions.onclick = () => fileQuestions.click();
    btnExportPackage.onclick = () => send('admin_export_questions_package');
    btnImportPackage.onclick = () => filePackage.click();
    filePackage.onchange = async () => {
      const f = filePackage.files?.[0];
      filePackage.value = '';
      if (!f) return;
      try {
        const buf = await fileToArrayBuffer(f);
        const res = await fetch('/admin/upload-questions-package', {
          method: 'POST',
          body: new Uint8Array(buf),
          headers: { 'Content-Type': 'application/zip' }
        });
        const data = await res.json();
        if (data.ok) {
          showOk(data.message || 'Пакет загружен');
          send('admin_state_refresh');
        } else {
          showErr(data.message || 'Ошибка загрузки пакета');
        }
      } catch (err) {
        console.error(err);
        showErr('Ошибка соединения при загрузке пакета');
      }
    };
    fileQuestions.onchange = async () => {
      const f = fileQuestions.files?.[0];
      fileQuestions.value = '';
      if (!f) return;
      try {
        const buf = await fileToArrayBuffer(f);
        const wb = XLSX.read(bytesFromArrayBuffer(buf), { type: 'array' });
        const list = parseQuestionsFromXlsx(wb);
        send('admin_load_questions', { questions: list });
      } catch (err) { console.error(err); showErr('Не смог прочитать questions.xlsx'); }
    };

    questionsTbody.addEventListener('click', async (e) => {
      const saveIndex = e.target?.getAttribute?.('data-save');
      const delIndex = e.target?.getAttribute?.('data-del');
      const imgKind = e.target?.getAttribute?.('data-img');
      const imgClear = e.target?.getAttribute?.('data-img-clear');
      const imgIdx = e.target?.getAttribute?.('data-index');
      const moveDir = e.target?.getAttribute?.('data-move');
      const moveIdx = e.target?.getAttribute?.('data-index');
      if (saveIndex !== null) {
        const idx = Number(saveIndex);
        const text = document.querySelector(`textarea[data-q="text"][data-index="${idx}"]`).value;
        const answer = document.querySelector(`textarea[data-q="answer"][data-index="${idx}"]`).value;
        const comment = document.querySelector(`textarea[data-q="comment"][data-index="${idx}"]`).value;
        const warmupCheckboxInRow = document.querySelector(`input[data-warmup="${idx}"]`);
        const warmup = warmupCheckboxInRow ? warmupCheckboxInRow.checked : false;
        send('admin_update_question', { index: idx, questionText: text, answerText: answer, commentText: comment, warmup });
        return;
      }
      if (delIndex !== null) {
        const idx = Number(delIndex);
        if (confirm(`Удалить вопрос ${idx + 1}?`)) send('admin_delete_question', { index: idx });
        return;
      }
      if (moveDir && moveIdx !== null) {
        const idx = Number(moveIdx);
        send('admin_move_question', { index: idx, direction: moveDir });
        return;
      }
      if (imgKind && imgIdx != null) {
        const idx = Number(imgIdx);
        pendingImage = { index: idx, field: imgKind === 'handout' ? 'handoutImage' : 'commentImage' };
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
    questionsTbody.addEventListener('change', (e) => {
      const warmupCheck = e.target?.getAttribute?.('data-warmup');
      if (warmupCheck !== null) {
        const idx = Number(warmupCheck);
        const isChecked = e.target.checked;
        send('admin_set_warmup', { index: idx, warmup: isChecked });
      }
    });
    async function handleQuestionImageFileInput(inputEl) {
      const f = inputEl.files?.[0];
      inputEl.value = '';
      if (!f || !pendingImage) return;
      if (f.size > 1024 * 1024) { showErr('Картинка слишком большая (нужно ≤ 1MB).'); pendingImage = null; return; }
      try {
        const dataUrl = await fileToDataURL(f);
        send('admin_set_question_image', { index: pendingImage.index, field: pendingImage.field, dataUrl });
      } catch (e) { showErr('Не смог прочитать картинку.'); } finally { pendingImage = null; }
    }
    fileHandout.onchange = () => handleQuestionImageFileInput(fileHandout);
    fileCommentImg.onchange = () => handleQuestionImageFileInput(fileCommentImg);

    btnResetShow.onclick = () => send('admin_reset_show');
    btnShowNext.onclick = () => send('admin_show_next');
    btnShowPrev.onclick = () => send('admin_show_prev');
    btnBreak.onclick = () => send('admin_break_simple');
    btnTable.onclick = () => send('admin_show_table');
    btnEndGame.onclick = () => { if (confirm('Закончить игру?')) send('admin_end_game'); };
    btnTimerStart.onclick = () => send('admin_timer_start');
    btnTimerPause.onclick = () => send('admin_timer_pause');
    btnTimerStop.onclick = () => send('admin_timer_stop');
    btnTimerAdd10.onclick = () => send('admin_timer_add10');
    autoStartChk.onchange = () => { const overtime = parseInt(overtimeSelect.value, 10); send('admin_set_autostart', { value: autoStartChk.checked, overtimeSeconds: overtime }); };
    overtimeSelect.onchange = () => { const overtime = parseInt(overtimeSelect.value, 10); send('admin_set_autostart', { value: autoStartChk.checked, overtimeSeconds: overtime }); };
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
    });

    if (btnSaveGame) btnSaveGame.onclick = () => send('admin_save_game', {});
    if (btnLoadGame && fileGameLoad) {
      btnLoadGame.onclick = () => fileGameLoad.click();
      fileGameLoad.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        let data;
        try { data = JSON.parse(text); } catch { showErr('Неверный формат файла'); return; }
        send('admin_load_game', data);
        fileGameLoad.value = '';
      };
    }
    if (btnExportResults) btnExportResults.onclick = () => send('admin_export_results_xlsx', {});
    if (btnChangePassword) {
      btnChangePassword.onclick = () => {
        changePasswordModal.classList.remove('hidden');
        oldPasswordInput.value = '';
        newPasswordInput.value = '';
        confirmPasswordInput.value = '';
        changePasswordMsg.innerHTML = '';
      };
    }
    btnChangePasswordCancel.onclick = () => changePasswordModal.classList.add('hidden');
    btnChangePasswordSubmit.onclick = () => {
      const oldPass = oldPasswordInput.value.trim();
      const newPass = newPasswordInput.value.trim();
      const confirm = confirmPasswordInput.value.trim();
      if (!oldPass || !newPass || !confirm) { changePasswordMsg.innerHTML = '<div class="msg err">Заполните все поля</div>'; return; }
      if (newPass !== confirm) { changePasswordMsg.innerHTML = '<div class="msg err">Новый пароль и подтверждение не совпадают</div>'; return; }
      if (newPass.length < 4) { changePasswordMsg.innerHTML = '<div class="msg err">Новый пароль должен быть минимум 4 символа</div>'; return; }
      send('admin_change_password', { oldPassword: oldPass, newPassword: newPass });
    };
    if (btnShowLogs) btnShowLogs.onclick = () => send('admin_get_logs', {});
  }

  connectWebSocket();
  showAuth();
})();
