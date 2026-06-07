const logger = require('./logger');

function isString(v, min = 1, max = Infinity) {
  return typeof v === 'string' && v.length >= min && v.length <= max;
}

function isInteger(v, min = -Infinity, max = Infinity) {
  return Number.isInteger(v) && v >= min && v <= max;
}

function isBoolean(v) {
  return v === true || v === false;
}

function isEnum(v, values) {
  return values.includes(v);
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isArrayOf(v, itemCheck) {
  return Array.isArray(v) && v.every(itemCheck);
}

const fieldTypes = {
  string: (v, rules) => {
    if (!isString(v, rules.min, rules.max))
      return rules.min ? `must be a string (min ${rules.min} chars)` : 'must be a string';
  },
  integer: (v, rules) => {
    if (!isInteger(v, rules.min, rules.max))
      return rules.min !== undefined ? `must be an integer >= ${rules.min}` : 'must be an integer';
  },
  boolean: (v) => {
    if (!isBoolean(v)) return 'must be a boolean';
  },
  enum: (v, rules) => {
    if (!isEnum(v, rules.values)) return `must be one of: ${rules.values.join(', ')}`;
  },
  'boolean-or-null': (v) => {
    if (v !== true && v !== false && v !== null) return 'must be a boolean or null';
  },
};

function validateField(type, field, value, rules) {
  const check = fieldTypes[rules.type];
  if (!check) return null;
  const err = check(value, rules);
  if (err) return `${type}: '${field}' ${err}`;
  return null;
}

const schemas = {
  // ========== ADMIN ==========
  admin_login: {
    fields: {
      password: { type: 'string', min: 1 },
    },
  },
  admin_change_password: {
    fields: {
      oldPassword: { type: 'string', min: 1 },
      newPassword: { type: 'string', min: 4 },
    },
  },
  admin_get_logs: { noPayload: true },
  admin_export_results_xlsx: { noPayload: true },
  admin_export_teams_xlsx: { noPayload: true },
  admin_export_questions_xlsx: { noPayload: true },
  admin_export_questions_package: { noPayload: true },
  admin_save_game: { noPayload: true },
  admin_state_refresh: { noPayload: true },
  admin_reset_teams: { noPayload: true },
  admin_reset_questions: { noPayload: true },
  admin_reset_all: { noPayload: true },
  admin_end_game: { noPayload: true },
  admin_reset_show: { noPayload: true },
  admin_break_simple: { noPayload: true },
  admin_show_table: { noPayload: true },
  admin_show_next: { noPayload: true },
  admin_show_prev: { noPayload: true },
  admin_timer_start: { noPayload: true },
  admin_timer_pause: { noPayload: true },
  admin_timer_stop: { noPayload: true },
  admin_timer_add10: { noPayload: true },
  admin_commit_current: { noPayload: true },

  admin_load_game: {
    payloadRequired: true,
  },
  admin_load_teams: {
    fields: {
      names: {
        type: 'array',
        itemType: 'string',
        itemMin: 1,
      },
      exhibitions: {
        type: 'array',
        itemType: 'boolean',
        optional: true,
      },
    },
  },
  admin_update_team_exhibition: {
    fields: {
      teamId: { type: 'integer', min: 1 },
      exhibition: { type: 'boolean' },
    },
  },
  admin_remove_team: {
    fields: {
      teamId: { type: 'integer', min: 1 },
    },
  },
  admin_kick_team: {
    fields: {
      teamId: { type: 'integer', min: 1 },
    },
  },
  admin_add_question: {
    fields: {
      questionText: { type: 'string', min: 1 },
      answerText: { type: 'string', min: 0, optional: true },
      commentText: { type: 'string', min: 0, optional: true },
      warmup: { type: 'boolean', optional: true },
    },
  },
  admin_load_questions: {
    fields: {
      questions: { type: 'array' },
    },
  },
  admin_update_question: {
    fields: {
      index: { type: 'integer', min: 0 },
      questionText: { type: 'string', min: 0, optional: true },
      answerText: { type: 'string', min: 0, optional: true },
      commentText: { type: 'string', min: 0, optional: true },
      warmup: { type: 'boolean', optional: true },
    },
  },
  admin_delete_question: {
    fields: {
      index: { type: 'integer', min: 0 },
    },
  },
  admin_move_question: {
    fields: {
      index: { type: 'integer', min: 0 },
      direction: { type: 'enum', values: ['up', 'down'] },
    },
  },
  admin_set_warmup: {
    fields: {
      index: { type: 'integer', min: 0 },
      warmup: { type: 'boolean' },
    },
  },
  admin_set_question_image: {
    fields: {
      index: { type: 'integer', min: 0 },
      field: { type: 'enum', values: ['handoutImage', 'commentImage'] },
      dataUrl: { type: 'string', min: 1 },
    },
  },
  admin_clear_question_image: {
    fields: {
      index: { type: 'integer', min: 0 },
      field: { type: 'enum', values: ['handoutImage', 'commentImage'] },
    },
  },
  admin_set_autostart: {
    fields: {
      value: { type: 'boolean' },
      overtimeSeconds: { type: 'integer', min: 0, optional: true },
    },
  },
  admin_mark_answer: {
    fields: {
      qIndex: { type: 'integer', min: 0 },
      teamId: { type: 'integer', min: 1 },
      verdict: { type: 'boolean-or-null' },
    },
  },
  admin_results_question: {
    fields: {
      qIndex: { type: 'integer', min: 0 },
    },
  },
  admin_edit_result: {
    fields: {
      qIndex: { type: 'integer', min: 0 },
      teamId: { type: 'integer', min: 1 },
      value: { type: 'boolean-or-null' },
    },
  },
  admin_sound_toggle: {
    fields: {
      target: { type: 'enum', values: ['captains', 'screens'] },
      value: { type: 'boolean' },
    },
  },

  // ========== CAPTAIN ==========
  captain_hello: {
    fields: {
      deviceId: { type: 'string', min: 1 },
    },
  },
  captain_pick_team: {
    fields: {
      teamId: { type: 'integer', min: 1 },
    },
  },
  captain_logout: { noPayload: true },
  captain_send_answer: {
    fields: {
      text: { type: 'string', min: 0 },
    },
  },
};

function validate(type, payload) {
  const schema = schemas[type];
  if (!schema) {
    logger.warn(`validate: unknown message type '${type}'`);
    return { valid: false, error: `Неизвестный тип сообщения: ${type}` };
  }

  // No-payload types: accept null/undefined/empty object
  if (schema.noPayload) {
    if (payload == null) return { valid: true };
    if (typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).length === 0)
      return { valid: true };
    return { valid: false, error: `${type}: payload не допускается` };
  }

  // Payload must be a non-null object
  if (payload == null || Array.isArray(payload) || typeof payload !== 'object') {
    return { valid: false, error: `${type}: payload должен быть объектом` };
  }

  const { fields } = schema;
  if (!fields) {
    if (schema.payloadRequired) return { valid: true };
    return { valid: true };
  }

  for (const [field, rules] of Object.entries(fields)) {
    const value = payload[field];

    // Handle arrays with item validation
    if (rules.type === 'array') {
      if (value === undefined) {
        if (!rules.optional) return { valid: false, error: `${type}: отсутствует обязательное поле '${field}'` };
        continue;
      }
      if (!Array.isArray(value)) return { valid: false, error: `${type}: '${field}' должен быть массивом` };
      if (rules.itemType) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (rules.itemType === 'string') {
            if (typeof item !== 'string' || item.length < (rules.itemMin || 0))
              return { valid: false, error: `${type}: '${field}[${i}]' должен быть строкой (мин ${rules.itemMin || 0} символов)` };
          } else if (rules.itemType === 'boolean') {
            if (typeof item !== 'boolean')
              return { valid: false, error: `${type}: '${field}[${i}]' должен быть boolean` };
          }
        }
      }
      continue;
    }

    if (value === undefined) {
      if (!rules.optional) return { valid: false, error: `${type}: отсутствует обязательное поле '${field}'` };
      continue;
    }

    const err = validateField(type, field, value, rules);
    if (err) return { valid: false, error: err };
  }

  return { valid: true };
}

module.exports = { validate, schemas };
