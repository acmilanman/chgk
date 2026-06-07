const { validate } = require('../lib/validate');

function handle(ws, msg, state) {
  const { type, payload } = msg;
  if (!type) return;

  const validation = validate(type, payload);
  if (!validation.valid) {
    state.safeSend(ws, { type: 'error', payload: { message: validation.error } });
    return;
  }

  if (type === 'captain_hello') {
    ws.deviceId = payload.deviceId;
    const assigned = state.deviceToTeam.get(payload.deviceId);
    if (assigned != null) {
      ws.teamId = assigned;
      const t = state.game.teams.find(x => x.id === assigned);
      if (t) t.activeCaptain = true;
      state.broadcast('teams_update', { teams: state.game.teams });
      state.safeSend(ws, { type: 'captain_session', payload: { assignedTeamId: assigned } });
    } else {
      state.safeSend(ws, { type: 'captain_session', payload: { assignedTeamId: null } });
    }
    state.autoSave();
    return;
  }

  if (type === 'captain_pick_team') {
    if (!ws.deviceId) {
      state.safeSend(ws, { type: 'error', payload: { message: 'Нет deviceId. Перезагрузите страницу.' } });
      return;
    }
    const team = state.game.teams.find(t => t.id === payload.teamId);
    if (!team) {
      state.safeSend(ws, { type: 'error', payload: { message: 'Команда не найдена.' } });
      return;
    }
    const already = state.deviceToTeam.get(ws.deviceId);
    if (already != null && already !== payload.teamId) {
      state.safeSend(ws, { type: 'error', payload: { message: 'Это устройство уже закреплено за другой командой.' } });
      return;
    }
    const boundDev = state.teamToDevice.get(payload.teamId);
    if (boundDev && boundDev !== ws.deviceId) {
      state.safeSend(ws, { type: 'error', payload: { message: 'Команда уже занята другим устройством.' } });
      return;
    }
    state.deviceToTeam.set(ws.deviceId, payload.teamId);
    state.teamToDevice.set(payload.teamId, ws.deviceId);
    ws.teamId = payload.teamId;
    team.activeCaptain = true;
    state.broadcast('teams_update', { teams: state.game.teams });
    state.safeSend(ws, { type: 'team_confirmed', payload: { teamId: payload.teamId } });
    state.autoSave();
    return;
  }

  if (type === 'captain_logout') {
    if (ws.teamId != null) {
      const teamId = ws.teamId;
      const dev = ws.deviceId;
      const t = state.game.teams.find(x => x.id === teamId);
      if (t) t.activeCaptain = false;
      if (dev) state.deviceToTeam.delete(dev);
      state.teamToDevice.delete(teamId);
      ws.teamId = null;
      state.broadcast('teams_update', { teams: state.game.teams });
    }
    state.safeSend(ws, { type: 'captain_logged_out', payload: {} });
    state.autoSave();
    return;
  }

  if (type === 'captain_send_answer') {
    if (ws.teamId == null) {
      state.safeSend(ws, { type: 'error', payload: { message: 'Сначала выберите команду.' } });
      return;
    }
    const shown = state.getCachedShown();
    if (shown.phase !== 'question') {
      state.safeSend(ws, { type: 'error', payload: { message: 'Сейчас нельзя отправлять ответ.' } });
      return;
    }
    const qIndex = shown.qIndex;
    const text = payload.text;
    state.appendAnswerLog(qIndex, ws.teamId, text);
    const rawRow = state.ensureRaw(qIndex);
    const prev = rawRow[ws.teamId] || { text: '', verdict: null };
    rawRow[ws.teamId] = { text, verdict: prev.verdict ?? null };
    state.broadcast('answers_update', { qIndex, answers: state.getAnswersListForAdmin(qIndex) }, 'admin');
    state.safeSend(ws, { type: 'answer_ok', payload: { text } });
    state.autoSave();
    return;
  }
}

module.exports = { handle };
