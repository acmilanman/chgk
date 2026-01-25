<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>ЧГК — Капитан</title>
  <style>
    body { font-family: sans-serif; margin: 20px; }
    .timer { font-size: 32px; margin: 10px 0; }
    .question { margin: 10px 0; }
    textarea { width: 100%; height: 80px; }
    select { width: 100%; }
  </style>
</head>
<body>
  <h1>ЧГК — Капитан</h1>

  <div id="teamSelectBlock">
    <label for="teamSelect">Выберите свою команду:</label>
    <select id="teamSelect"></select>
    <button id="pickTeam">Подтвердить</button>
    <div id="teamStatus"></div>
  </div>

  <div id="gameBlock" style="display:none;">
    <div class="timer">
      Осталось: <span id="timerValue">60</span> сек
    </div>

    <div class="question">
      <b id="questionText"></b>
    </div>

    <div>
      <label for="answerInput">Ваш ответ:</label>
      <textarea id="answerInput"></textarea>
    </div>
  </div>

  <div id="breakBlock" style="display:none;">
    <h2>Перерыв. Таблица результатов</h2>
    <table id="scoresTable">
      <thead>
        <tr>
          <th>Команда</th>
          <th>Баллы</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </div>

  <script type="module">
    import { createSocket } from './common.js';

    const teamSelectBlock = document.getElementById('teamSelectBlock');
    const teamSelect = document.getElementById('teamSelect');
    const pickTeamBtn = document.getElementById('pickTeam');
    const teamStatus = document.getElementById('teamStatus');

    const gameBlock = document.getElementById('gameBlock');
    const breakBlock = document.getElementById('breakBlock');
    const timerValueSpan = document.getElementById('timerValue');
    const questionTextEl = document.getElementById('questionText');
    const answerInput = document.getElementById('answerInput');
    const scoresTableBody = document.querySelector('#scoresTable tbody');

    let ws = createSocket('captain', onMessage);
    let teams = [];
    let currentQuestionIndex = 0;
    let timerRunning = false;

    function onMessage(msg) {
      const { type, payload } = msg;

      if (type === 'init_for_captain') {
        teams = payload.teams || [];
        currentQuestionIndex = payload.currentQuestionIndex || 0;
        renderTeamsSelect();
        renderQuestion(payload.question);
        updateTimerFromServer(payload.timer);
      } else if (type === 'new_question') {
        gameBlock.style.display = 'block';
        breakBlock.style.display = 'none';
        currentQuestionIndex = payload.index;
        renderQuestion(payload.question);
        enableAnswerInput();
      } else if (type === 'timer_update') {
        timerValueSpan.textContent = payload.remainingSec;
        timerRunning = payload.running;
        if (!timerRunning && payload.remainingSec === 0) {
          disableAnswerInput();
        }
      } else if (type === 'teams_update') {
        teams = payload.teams || [];
        renderTeamsSelect();
      } else if (type === 'break_mode') {
        gameBlock.style.display = 'none';
        breakBlock.style.display = 'block';
        renderScores(payload.teams);
      } else if (type === 'game_running') {
        gameBlock.style.display = 'block';
        breakBlock.style.display = 'none';
      } else if (type === 'scores_update') {
        renderScores(payload.teams);
      } else if (type === 'team_kicked') {
        if (parseInt(teamSelect.value, 10) === payload.teamId) {
          teamStatus.textContent = 'Вас кикнули, выберите заново или попросите админа.';
          teamSelectBlock.style.display = 'block';
          gameBlock.style.display = 'none';
        }
      } else if (type === 'error') {
        teamStatus.textContent = payload;
      }
    }

    function renderTeamsSelect() {
      const currentValue = teamSelect.value;
      teamSelect.innerHTML = '';
      teams.forEach(team => {
        const option = document.createElement('option');
        option.value = team.id;
        option.textContent = `${team.name} ${team.activeCaptain ? '(занята)' : ''}`;
        teamSelect.appendChild(option);
      });
      if (currentValue) {
        teamSelect.value = currentValue;
      }
    }

    function renderQuestion(q) {
      questionTextEl.textContent = q ? q.text : '';
      answerInput.value = '';
      enableAnswerInput();
    }

    function updateTimerFromServer(timer) {
      if (!timer) return;
      timerValueSpan.textContent = timer.remainingSec;
      timerRunning = timer.running;
      if (!timerRunning && timer.remainingSec === 0) {
        disableAnswerInput();
      }
    }

    function renderScores(teamsData) {
      scoresTableBody.innerHTML = '';
      (teamsData || []).forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${t.name}</td>
          <td>${t.score || 0}</td>
        `;
        scoresTableBody.appendChild(tr);
      });
    }

    function enableAnswerInput() {
      answerInput.disabled = false;
    }

    function disableAnswerInput() {
      answerInput.disabled = true;
      // на всякий случай отправим окончательный текст
      sendAnswer();
    }

    // Выбор команды
    pickTeamBtn.onclick = () => {
      const teamId = parseInt(teamSelect.value, 10);
      if (!teamId) return;
      ws.send(JSON.stringify({
        type: 'captain_pick_team',
        payload: { teamId }
      }));
      teamStatus.textContent = 'Команда выбрана. Ждите старт вопроса.';
      gameBlock.style.display = 'block';
    };

    // Отправка ответа при каждом изменении (можно сделать по onblur/Enter)
    answerInput.addEventListener('input', () => {
      if (!timerRunning) return; // чтобы не спамить после остановки
      sendAnswer();
    });

    function sendAnswer() {
      const text = answerInput.value;
      ws.send(JSON.stringify({
        type: 'captain_answer',
        payload: { text }
      }));
    }
  </script>
</body>
</html>
