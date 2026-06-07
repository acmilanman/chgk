const { expect } = require('chai');
const { validate } = require('../lib/validate');

function assertValid(type, payload) {
  const result = validate(type, payload);
  expect(result).to.deep.include({ valid: true }, `expected ${type}(${JSON.stringify(payload)}) to be valid, got: ${result.error}`);
}

function assertInvalid(type, payload, errorMatch) {
  const result = validate(type, payload);
  expect(result.valid).to.be.false;
  if (errorMatch) {
    if (errorMatch instanceof RegExp) {
      expect(result.error).to.match(errorMatch);
    } else {
      expect(result.error).to.include(errorMatch);
    }
  }
}

describe('validate', () => {
  describe('unknown type', () => {
    it('rejects unknown message type', () => {
      assertInvalid('foo_bar', {}, 'Неизвестный тип сообщения');
    });

    it('rejects undefined type', () => {
      assertInvalid(undefined, {}, 'Неизвестный тип сообщения');
    });
  });

  describe('no-payload types', () => {
    const noPayloadTypes = [
      'admin_get_logs', 'admin_export_results_xlsx', 'admin_export_teams_xlsx',
      'admin_export_questions_xlsx', 'admin_export_questions_package',
      'admin_save_game', 'admin_state_refresh', 'admin_reset_teams',
      'admin_reset_questions', 'admin_reset_all', 'admin_end_game',
      'admin_reset_show', 'admin_break_simple', 'admin_show_table',
      'admin_show_next', 'admin_show_prev', 'admin_timer_start',
      'admin_timer_pause', 'admin_timer_stop', 'admin_timer_add10',
      'admin_commit_current',
      'captain_logout',
    ];

    noPayloadTypes.forEach(type => {
      it(`accepts ${type} with null payload`, () => {
        assertValid(type, null);
      });
    });

    noPayloadTypes.forEach(type => {
      it(`accepts ${type} with empty object payload`, () => {
        assertValid(type, {});
      });
    });

    noPayloadTypes.forEach(type => {
      it(`rejects ${type} with unexpected payload keys`, () => {
        assertInvalid(type, { foo: 'bar' }, 'payload не допускается');
      });
    });
  });

  describe('admin_login', () => {
    it('accepts valid login', () => {
      assertValid('admin_login', { password: 'secret' });
    });

    it('rejects missing password', () => {
      assertInvalid('admin_login', {}, 'password');
    });

    it('rejects empty password', () => {
      assertInvalid('admin_login', { password: '' }, 'password');
    });

    it('rejects non-string password', () => {
      assertInvalid('admin_login', { password: 123 }, 'password');
    });
  });

  describe('admin_change_password', () => {
    it('accepts valid change', () => {
      assertValid('admin_change_password', { oldPassword: 'old', newPassword: 'new1234' });
    });

    it('rejects short new password', () => {
      assertInvalid('admin_change_password', { oldPassword: 'old', newPassword: 'ab' }, 'newPassword');
    });

    it('rejects missing old password', () => {
      assertInvalid('admin_change_password', { newPassword: 'abcd' }, 'oldPassword');
    });
  });

  describe('admin_load_teams', () => {
    it('accepts valid teams', () => {
      assertValid('admin_load_teams', { names: ['Team A', 'Team B'], exhibitions: [false, true] });
    });

    it('accepts teams without exhibitions', () => {
      assertValid('admin_load_teams', { names: ['Team A'] });
    });

    it('rejects non-array names', () => {
      assertInvalid('admin_load_teams', { names: 'not array' }, 'names');
    });

    it('rejects names with empty strings', () => {
      assertInvalid('admin_load_teams', { names: ['valid', ''] }, 'names[1]');
    });

    it('rejects exhibitions with non-booleans', () => {
      assertInvalid('admin_load_teams', { names: ['A'], exhibitions: ['yes'] }, 'exhibitions[0]');
    });
  });

  describe('admin_update_team_exhibition', () => {
    it('accepts valid update', () => {
      assertValid('admin_update_team_exhibition', { teamId: 1, exhibition: true });
    });

    it('rejects missing teamId', () => {
      assertInvalid('admin_update_team_exhibition', { exhibition: true }, 'teamId');
    });

    it('rejects non-integer teamId', () => {
      assertInvalid('admin_update_team_exhibition', { teamId: 1.5, exhibition: true }, 'teamId');
    });

    it('rejects teamId < 1', () => {
      assertInvalid('admin_update_team_exhibition', { teamId: 0, exhibition: true }, 'teamId');
    });

    it('rejects missing exhibition', () => {
      assertInvalid('admin_update_team_exhibition', { teamId: 1 }, 'exhibition');
    });
  });

  describe('admin_add_question', () => {
    it('accepts valid question', () => {
      assertValid('admin_add_question', { questionText: 'Q?', answerText: 'A!', commentText: 'C.' });
    });

    it('accepts question with warmup', () => {
      assertValid('admin_add_question', { questionText: 'Q', answerText: 'A', warmup: true });
    });

    it('rejects empty questionText', () => {
      assertInvalid('admin_add_question', { questionText: '', answerText: 'A' }, 'questionText');
    });

    it('rejects missing questionText', () => {
      assertInvalid('admin_add_question', { answerText: 'A' }, 'questionText');
    });
  });

  describe('admin_move_question', () => {
    it('accepts direction up', () => {
      assertValid('admin_move_question', { index: 2, direction: 'up' });
    });

    it('accepts direction down', () => {
      assertValid('admin_move_question', { index: 2, direction: 'down' });
    });

    it('rejects invalid direction', () => {
      assertInvalid('admin_move_question', { index: 0, direction: 'sideways' }, 'direction');
    });
  });

  describe('admin_set_question_image', () => {
    it('accepts valid handoutImage', () => {
      assertValid('admin_set_question_image', { index: 0, field: 'handoutImage', dataUrl: 'data:image/png;base64,abc' });
    });

    it('accepts valid commentImage', () => {
      assertValid('admin_set_question_image', { index: 0, field: 'commentImage', dataUrl: 'data:image/png;base64,abc' });
    });

    it('rejects invalid field', () => {
      assertInvalid('admin_set_question_image', { index: 0, field: 'wrong', dataUrl: 'data:...' }, 'field');
    });
  });

  describe('admin_clear_question_image', () => {
    it('accepts valid clear', () => {
      assertValid('admin_clear_question_image', { index: 1, field: 'handoutImage' });
    });
  });

  describe('admin_mark_answer', () => {
    it('accepts verdict true', () => {
      assertValid('admin_mark_answer', { qIndex: 0, teamId: 1, verdict: true });
    });

    it('accepts verdict false', () => {
      assertValid('admin_mark_answer', { qIndex: 0, teamId: 1, verdict: false });
    });

    it('accepts verdict null', () => {
      assertValid('admin_mark_answer', { qIndex: 0, teamId: 1, verdict: null });
    });

    it('rejects verdict as string', () => {
      assertInvalid('admin_mark_answer', { qIndex: 0, teamId: 1, verdict: 'yes' }, 'verdict');
    });

    it('rejects missing qIndex', () => {
      assertInvalid('admin_mark_answer', { teamId: 1, verdict: true }, 'qIndex');
    });

    it('rejects negative qIndex', () => {
      assertInvalid('admin_mark_answer', { qIndex: -1, teamId: 1, verdict: true }, 'qIndex');
    });
  });

  describe('admin_edit_result', () => {
    it('accepts value true', () => {
      assertValid('admin_edit_result', { qIndex: 0, teamId: 1, value: true });
    });

    it('accepts value null', () => {
      assertValid('admin_edit_result', { qIndex: 0, teamId: 1, value: null });
    });
  });

  describe('admin_sound_toggle', () => {
    it('accepts captains target', () => {
      assertValid('admin_sound_toggle', { target: 'captains', value: true });
    });

    it('accepts screens target', () => {
      assertValid('admin_sound_toggle', { target: 'screens', value: false });
    });

    it('rejects unknown target', () => {
      assertInvalid('admin_sound_toggle', { target: 'players', value: true }, 'target');
    });
  });

  describe('admin_set_autostart', () => {
    it('accepts valid autostart', () => {
      assertValid('admin_set_autostart', { value: true, overtimeSeconds: 10 });
    });

    it('accepts autostart without overtime', () => {
      assertValid('admin_set_autostart', { value: false });
    });
  });

  describe('admin_update_question', () => {
    it('accepts full update', () => {
      assertValid('admin_update_question', { index: 1, questionText: 'Q', answerText: 'A', commentText: 'C', warmup: true });
    });

    it('accepts partial update', () => {
      assertValid('admin_update_question', { index: 1, questionText: 'Q only' });
    });
  });

  describe('admin_load_game', () => {
    it('accepts game state object', () => {
      assertValid('admin_load_game', { questions: [], teams: [] });
    });

    it('rejects non-object payload', () => {
      assertInvalid('admin_load_game', 'string', 'payload');
    });
  });

  describe('captain_hello', () => {
    it('accepts valid deviceId', () => {
      assertValid('captain_hello', { deviceId: 'abc-123' });
    });

    it('rejects missing deviceId', () => {
      assertInvalid('captain_hello', {}, 'deviceId');
    });

    it('rejects empty deviceId', () => {
      assertInvalid('captain_hello', { deviceId: '' }, 'deviceId');
    });
  });

  describe('captain_pick_team', () => {
    it('accepts valid teamId', () => {
      assertValid('captain_pick_team', { teamId: 5 });
    });

    it('rejects teamId 0', () => {
      assertInvalid('captain_pick_team', { teamId: 0 }, 'teamId');
    });
  });

  describe('captain_send_answer', () => {
    it('accepts text answer', () => {
      assertValid('captain_send_answer', { text: 'My answer' });
    });

    it('accepts empty text answer', () => {
      assertValid('captain_send_answer', { text: '' });
    });
  });

  describe('payload rejections', () => {
    it('rejects null payload for types that need fields', () => {
      assertInvalid('admin_login', null, 'payload');
    });

    it('rejects array payload', () => {
      assertInvalid('admin_login', ['pw'], 'payload');
    });
  });
});
