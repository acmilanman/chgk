const logger = require('../lib/logger');
const { validate } = require('../lib/validate');

function handle(ws, msg, state) {
  const { type, payload } = msg;
  if (!type) return;

  const validation = validate(type, payload);
  if (!validation.valid) {
    state.safeSend(ws, { type: 'error', payload: { message: validation.error } });
    return;
  }

  if (type === 'admin_login') {
    if (payload.password === state.getAdminPassword()) {
      state.sendAdminState(ws);
      state.logAdminAttempt(ws._remoteIp, ws._remoteUA, true);
      state.safeSend(ws, { type: 'admin_login_result', payload: { success: true } });
    } else {
      state.logAdminAttempt(ws._remoteIp, ws._remoteUA, false);
      state.safeSend(ws, { type: 'admin_login_result', payload: { success: false, message: 'Неверный пароль' } });
    }
    return;
  }

  if (type === 'admin_change_password') {
    if (payload.oldPassword !== state.getAdminPassword()) {
      state.safeSend(ws, { type: 'admin_change_password_result', payload: { success: false, message: 'Неверный старый пароль' } });
      return;
    }
    if (state.setAdminPassword(payload.newPassword)) {
      state.safeSend(ws, { type: 'admin_change_password_result', payload: { success: true, message: 'Пароль успешно изменён' } });
    } else {
      state.safeSend(ws, { type: 'admin_change_password_result', payload: { success: false, message: 'Ошибка при сохранении пароля' } });
    }
    return;
  }

  if (type === 'admin_get_logs') {
    state.safeSend(ws, { type: 'admin_logs_data', payload: state.getAdminLogs() });
    return;
  }

  if (type === 'admin_export_results_xlsx') {
    state.safeSend(ws, { type: 'admin_file', payload: { filename: 'results.xlsx', base64: state.makeResultsXlsxBase64() } });
    return;
  }

  if (type === 'admin_save_game') {
    state.safeSend(ws, { type: 'admin_game_state', payload: state.getGameState() });
    return;
  }

  if (type === 'admin_load_game') {
    state.restoreGameState(payload);
    state.safeSend(ws, { type: 'admin_ok', payload: { message: 'Игра восстановлена.' } });
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_load_teams') {
    const result = state.addTeams(payload.names, payload.exhibitions || []);
    if (result.ok) {
      state.safeSend(ws, { type: 'admin_ok', payload: { message: result.message } });
    } else {
      state.safeSend(ws, { type: 'admin_error', payload: { message: result.message } });
    }
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_update_team_exhibition') {
    const result = state.updateTeamExhibition(payload.teamId, payload.exhibition);
    if (result.ok) {
      state.safeSend(ws, { type: 'admin_ok', payload: { message: result.message } });
    } else {
      state.safeSend(ws, { type: 'admin_error', payload: { message: result.message } });
    }
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_reset_teams') {
    state.resetTeamsOnly();
    state.safeSend(ws, { type: 'admin_ok', payload: { message: 'Команды сброшены.' } });
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_remove_team') {
    if (state.removeTeam(payload.teamId)) {
      state.safeSend(ws, { type: 'admin_ok', payload: { message: 'Команда удалена.' } });
    } else {
      state.safeSend(ws, { type: 'admin_error', payload: { message: 'Команда не найдена.' } });
    }
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_reset_questions') {
    state.resetQuestionsOnly();
    state.safeSend(ws, { type: 'admin_ok', payload: { message: 'Вопросы очищены.' } });
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_end_game') {
    state.endGameProcess();
    state.safeSend(ws, { type: 'admin_ok', payload: { message: 'Игра завершена (процесс сброшен).' } });
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_reset_all') {
    state.resetAll();
    state.safeSend(ws, { type: 'admin_ok', payload: { message: 'Сброшено ВСЁ.' } });
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_kick_team') {
    const result = state.kickTeam(payload.teamId);
    state.safeSend(ws, { type: 'admin_ok', payload: { message: result.message } });
    return;
  }

  if (type === 'admin_add_question') {
    const result = state.addQuestion(payload.questionText, payload.answerText || '', payload.commentText || '', payload.warmup === true);
    if (result.ok) {
      state.safeSend(ws, { type: 'admin_ok', payload: { message: result.message } });
    } else {
      state.safeSend(ws, { type: 'admin_error', payload: { message: result.message } });
    }
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_load_questions') {
    const result = state.loadQuestions(payload.questions);
    if (result.ok) {
      state.safeSend(ws, { type: 'admin_ok', payload: { message: result.message } });
    } else {
      state.safeSend(ws, { type: 'admin_error', payload: { message: result.message } });
    }
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_update_question') {
    const result = state.updateQuestion(payload.index, payload);
    if (result) state.safeSend(ws, { type: 'admin_ok', payload: { message: result.message } });
    return;
  }

  if (type === 'admin_delete_question') {
    state.deleteQuestion(payload.index);
    state.safeSend(ws, { type: 'admin_ok', payload: { message: 'Вопрос удалён.' } });
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_move_question') {
    state.moveQuestion(payload.index, payload.direction);
    state.safeSend(ws, { type: 'admin_ok', payload: { message: 'Порядок вопросов изменён.' } });
    return;
  }

  if (type === 'admin_set_warmup') {
    state.setWarmup(payload.index, payload.warmup);
    state.safeSend(ws, { type: 'admin_ok', payload: { message: 'Настройка разминочных вопросов обновлена.' } });
    return;
  }

  if (type === 'admin_set_question_image') {
    state.setQuestionImage(payload.index, payload.field, payload.dataUrl);
    state.safeSend(ws, { type: 'admin_ok', payload: { message: `Картинка обновлена (вопрос ${payload.index + 1}).` } });
    return;
  }

  if (type === 'admin_clear_question_image') {
    state.clearQuestionImage(payload.index, payload.field);
    state.safeSend(ws, { type: 'admin_ok', payload: { message: `Картинка удалена (вопрос ${payload.index + 1}).` } });
    return;
  }

  if (type === 'admin_set_autostart') {
    state.setAutoStart(payload.value, payload.overtimeSeconds);
    state.safeSend(ws, { type: 'admin_ok', payload: { message: 'Настройка обновлена.' } });
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_reset_show') {
    state.resetShow();
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_break_simple') {
    state.setBreak();
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_show_table') {
    state.showTable();
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_show_next') {
    state.showNext();
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_show_prev') {
    state.showPrev();
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_timer_start') { state.startTimer(60); return; }
  if (type === 'admin_timer_pause') { state.pauseTimer(); return; }
  if (type === 'admin_timer_stop') { state.stopTimer(); return; }
  if (type === 'admin_timer_add10') { state.add10sec(); return; }

  if (type === 'admin_mark_answer') {
    state.markAnswer(payload.qIndex, payload.teamId, payload.verdict);
    return;
  }

  if (type === 'admin_commit_current') {
    const result = state.commitCurrentQuestion();
    if (result.ok) {
      state.safeSend(ws, { type: 'admin_ok', payload: { message: result.message } });
    } else {
      state.safeSend(ws, { type: 'admin_error', payload: { message: result.message } });
    }
    return;
  }

  if (type === 'admin_results_question') {
    const rows = state.getResultsForQuestion(payload.qIndex);
    state.safeSend(ws, { type: 'results_question', payload: { qIndex: payload.qIndex, rows } });
    return;
  }

  if (type === 'admin_edit_result') {
    state.editResult(payload.qIndex, payload.teamId, payload.value);
    state.safeSend(ws, { type: 'admin_ok', payload: { message: `Зачёт изменён (вопрос ${payload.qIndex + 1}).` } });
    return;
  }

  if (type === 'admin_export_teams_xlsx') {
    state.safeSend(ws, { type: 'admin_file', payload: { filename: 'teams.xlsx', base64: state.makeTeamsXlsxBase64() } });
    return;
  }

  if (type === 'admin_export_questions_xlsx') {
    state.safeSend(ws, { type: 'admin_file', payload: { filename: 'questions.xlsx', base64: state.makeQuestionsXlsxBase64() } });
    return;
  }

  if (type === 'admin_export_questions_package') {
    state.makeQuestionsPackageBase64().then(b64 => {
      state.safeSend(ws, { type: 'admin_file', payload: { filename: 'questions_package.zip', base64: b64 } });
    }).catch(err => {
      logger.error(`Error creating package: ${err.message}`);
      state.safeSend(ws, { type: 'admin_error', payload: { message: 'Ошибка создания пакета' } });
    });
    return;
  }

  if (type === 'admin_sound_toggle') {
    state.setSoundEnabled(payload.target, payload.value);
    state.sendAdminState(ws);
    return;
  }

  if (type === 'admin_state_refresh') {
    state.sendAdminState(ws);
    return;
  }
}

module.exports = { handle };
