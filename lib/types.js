// Type definitions for the project (JSDoc-compatible)
// Used via: /** @type {import('./types').GameStateSummary} */

/**
 * @typedef {Object} Question
 * @property {string} text
 * @property {string} answer
 * @property {string} comment
 * @property {string} handoutImage
 * @property {string} commentImage
 * @property {boolean} warmup
 */

/**
 * @typedef {Object} Team
 * @property {number} id
 * @property {string} name
 * @property {boolean} activeCaptain
 * @property {boolean} exhibition
 */

/**
 * @typedef {Object} TimerState
 * @property {boolean} running
 * @property {number|null} startTime
 * @property {number} durationSec
 * @property {number} remainingSec
 * @property {boolean} overtimeActive
 */

/**
 * @typedef {Object} GameState
 * @property {boolean} autoStartTimerOnQuestion
 * @property {number} overtimeSeconds
 * @property {string} displayMode
 * @property {number} showStep
 * @property {Question[]} questions
 * @property {Team[]} teams
 * @property {Object.<string, Object.<string, {text: string, verdict: boolean|null}>>} rawAnswers
 * @property {Object.<string, Object.<string, Array<{ts: number, text: string}>>>} answerLog
 * @property {Object.<string, Object.<string, boolean|undefined>>} results
 * @property {TimerState} timer
 * @property {boolean} soundEnabledCaptains
 * @property {boolean} soundEnabledScreens
 */

/**
 * @typedef {Object} ShownState
 * @property {string} phase
 * @property {number} [qIndex]
 * @property {string} [questionText]
 * @property {string} [answerText]
 * @property {string} [commentText]
 * @property {string} [handoutImage]
 * @property {string} [commentImage]
 * @property {boolean} [isWarmup]
 * @property {number} [warmupNumber]
 * @property {number} [regularNumber]
 * @property {number} [displayNumber]
 * @property {number} [questionNumber]
 */

/**
 * @typedef {Object} ScoreRow
 * @property {number} teamId
 * @property {string} name
 * @property {boolean} exhibition
 * @property {Array<boolean|undefined>} perQuestion
 * @property {number} total
 */

/**
 * @typedef {Object} ScoresFull
 * @property {number} questionsCount
 * @property {ScoreRow[]} rows
 */

/**
 * @typedef {Object} WsMessage
 * @property {string} type
 * @property {*} [payload]
 */

module.exports = {};
