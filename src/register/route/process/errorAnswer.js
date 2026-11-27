// The body of the answer to a route that threw (owner's Q440 a, 2026-11-27).
//
// A route refuses by throwing an error that carries `refusalCode`, a short name of why it was refused
// (`erasureNotReady`, `blocked`, `payoutAccountNotTheCallersOwn`), and the client decides what to show from it. Until
// now the catch of `process/http.js` and of the function verb built `{ error, code }` and dropped every other field, so
// a thrown refusal never reached a client: web/main showed a generic error and the person never learned why.
//
// The answer now carries the refusal, and only the refusal:
// - `refusalCode` when the error carries one that is a short name (a letter, then letters, digits, `_`, `-` or `.`, at
//   most 64 characters). Anything else (a number, an object, a sentence) is not a refusal code and is left out.
// - `refusalDetails` when the error also carries a plain object under that name: only its keys whose values are text
//   (at most 1,000 characters), finite numbers, true/false or null, or arrays of at most 50 such values. A nested object,
//   a longer text, a function or anything else is left out, key by key, and at most 30 keys are kept. Details without a
//   refusal code are left out too: a refusal is its code, the details only say more about it.
// Nothing else of the error is ever sent: not its stack, not its other fields (an internal id, a query, a cause).
// The status and `{ error, code }` are what they were (errorStatus.js), so a client that reads only those sees no change.

const REFUSAL_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const MAXIMUM_DETAIL_KEY_COUNT = 30
const MAXIMUM_DETAIL_TEXT_LENGTH = 1000
const MAXIMUM_DETAIL_LIST_LENGTH = 50

/**
 * @param {unknown} value
 * @returns {boolean} true for a value a refusal's details may carry as it is.
 */
const isPlainDetailValue = (value) => {
  if (value === null || typeof value === 'boolean') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (typeof value === 'string') {
    return value.length <= MAXIMUM_DETAIL_TEXT_LENGTH
  }
  return false
}

/**
 * @param {unknown} value
 * @returns {boolean} true for a value or a short list of values a refusal's details may carry.
 */
const isAllowedDetailValue = (value) => (
  Array.isArray(value)
    ? value.length <= MAXIMUM_DETAIL_LIST_LENGTH && value.every(isPlainDetailValue)
    : isPlainDetailValue(value)
)

/**
 * @param {unknown} value
 * @returns {boolean} true for an object made by `{}` or `Object.create(null)`, not an instance of a class.
 */
const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * The refusal code a thrown error carries, or null when it carries none that is a short name. Pure.
 * @param {unknown} error
 * @returns {string | null}
 */
export const refusalCodeOfThrownError = (error) => {
  const refusalCode = /** @type {{ refusalCode?: unknown } | null | undefined} */ (error)?.refusalCode
  return typeof refusalCode === 'string' && REFUSAL_CODE_PATTERN.test(refusalCode) ? refusalCode : null
}

/**
 * The details of a thrown refusal that may be sent, or null when there are none. Pure.
 * @param {unknown} error
 * @returns {Record<string, unknown> | null}
 */
export const sendableRefusalDetailsOfThrownError = (error) => {
  const refusalDetails = /** @type {{ refusalDetails?: unknown } | null | undefined} */ (error)?.refusalDetails
  if (!isPlainObject(refusalDetails)) {
    return null
  }
  const sendableEntries = Object.entries(/** @type {Record<string, unknown>} */ (refusalDetails))
    .filter(([, value]) => isAllowedDetailValue(value))
    .slice(0, MAXIMUM_DETAIL_KEY_COUNT)
    .map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])
  return sendableEntries.length ? Object.fromEntries(sendableEntries) : null
}

/**
 * The JSON body of the answer to a route that threw. Pure.
 * @param {{ message: string, code: unknown, thrownError: unknown }} args
 * @returns {{ error: string, code: unknown, refusalCode?: string, refusalDetails?: Record<string, unknown> }}
 */
export const errorAnswerBodyOf = ({ message, code, thrownError }) => {
  const refusalCode = refusalCodeOfThrownError(thrownError)
  if (!refusalCode) {
    return { error: message, code }
  }
  const refusalDetails = sendableRefusalDetailsOfThrownError(thrownError)
  return refusalDetails
    ? { error: message, code, refusalCode, refusalDetails }
    : { error: message, code, refusalCode }
}

export default errorAnswerBodyOf
