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

export default httpStatusOfErrorCode
