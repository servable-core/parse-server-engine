import { engineCounterNamed } from '../../../lib/metrics.js'

// The HTTP status of the answer to a route that threw (owner's Q1470, 2026-11-24).
//
// A route throws HTTP codes (404, 449) as often as Parse error codes, and the code was sent as the status as it was.
// Parse's codes from 100 to 199 (101 object not found, 119 operation forbidden, 137 duplicate value, 141 script failed,
// 142 validation error...) are informational statuses in HTTP: Node writes them as an interim answer, the client waits
// for a final one that never comes, and the connection is closed. A negative code (Parse's -1, other cause) or one
// above 599 (Parse's 600, MongoDB's 11000) made Express throw inside the error handler, so no answer was sent at all.
// Those are answered with a 400, the code still in the body (`{ error, code }`).
//
// Codes from 200 to 599 keep their status as before: Parse's codes in the 200s (209 invalid session token) are read
// by that status by web/main's client (@servable/nextjs routes/lib/requestRoute.js treats a 209 as signed out).
//
// Production proof of the remap (owner's Q1580 a, 2026-11-24): each answer whose status is not the thrown code is counted,
//   servable_route_error_status_remapped_total{from_kind}
// `from_kind` says which kind of code was remapped, never the code itself (a closed list, so a handler throwing odd codes
// cannot grow the series): `parse_1xx` (an integer below 200 and from 0: Parse's 1 internal error and its 100 to 199, sent
// as a 400), `negative` (Parse's -1 other cause, a 400), `mongo` (above 599: MongoDB's 11000 duplicate key, Parse's 600, a
// 400), `not_integer` (a text or a fraction, a 500). A healthy route throws HTTP codes and these stay low; a rise names the
// kind of error a route lets through as it is.

/**
 * @param {unknown} code - the thrown error's code.
 * @returns {number} a status every HTTP client reads as a final answer.
 */
export const httpStatusOfErrorCode = (code) => {
  if (!Number.isInteger(code)) {
    return 500
  }
  const status = /** @type {number} */ (code)
  return status >= 200 && status <= 599 ? status : 400
}

const remappedCounter = engineCounterNamed('servable_route_error_status_remapped_total', {
  description: 'Count of route error answers whose HTTP status is not the thrown code, by kind of code (parse_1xx, negative, mongo, not_integer).',
})

/**
 * The kind of a thrown code its answer's status does not keep, or null when the status is the code. Pure.
 * @param {unknown} code
 * @returns {'parse_1xx' | 'negative' | 'mongo' | 'not_integer' | null}
 */
export const remappedKindOfErrorCode = (code) => {
  if (!Number.isInteger(code)) {
    return 'not_integer'
  }
  const status = /** @type {number} */ (code)
  if (status < 0) {
    return 'negative'
  }
  if (status < 200) {
    return 'parse_1xx'
  }
  return status > 599 ? 'mongo' : null
}

/**
 * The status of the answer to a route that threw `code` (httpStatusOfErrorCode), the remap counted by kind. Never throws.
 * @param {unknown} code - the thrown error's code.
 * @returns {number}
 */
export const httpStatusOfThrownErrorCode = (code) => {
  const fromKind = remappedKindOfErrorCode(code)
  if (fromKind) {
    remappedCounter.add(1, { from_kind: fromKind })
  }
  return httpStatusOfErrorCode(code)
}

export default httpStatusOfErrorCode
