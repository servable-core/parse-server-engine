// What the route cache keeps of an answer, and how it gives it back (framework performance audit 2026-11-23, F7 and
// F8; owner's Q1094 a).
//
// - Only a success is kept: a status from 200 to 299, and not an answer the engine marked as an error. Until then
//   every answer was kept whatever its status (a 404, a 500, a rate limiter's 429) and replayed as a 200, for up to
//   the route's window (30 minutes for an anonymous explore page). The mark is needed because `processHttp` answers
//   a thrown Parse error with the Parse code as the HTTP status, and several Parse codes are in the 200s (209
//   "invalid session token", 202, 203...): the status alone cannot tell them from a success.
// - What is kept is what the client received: the status, the Content-Type, and the body already serialized, once.
//   It used to be the body wrapped again in `JSON.stringify({ entry, body })` (a JSON string inside JSON) and parsed
//   back on every hit, and the replay went out as `text/html` with status 200.
// - The body is captured at the point Express hands over the serialized body (`res.send` with a string or a
//   Buffer). `res.send(object)` and `res.json(object)` both come back through it with the string, so an answer is
//   stored once, not twice as before. The status and Content-Type are read after Express has written them: an
//   answer Express turned into a 304 (the client already had it) is not kept.

export const ERROR_ANSWER_LOCALS_FLAG = 'isAnErrorAnswer'

const REDIS_ENTRY_PREFIX = 'SRC2 '

/**
 * @typedef {{ status: number, contentType: string | null, body: string | Buffer }} CachedAnswer
 */

/**
 * @param {any} response - Express's response, after the answer was sent.
 * @returns {boolean}
 */
export const isAnswerCacheable = (response) => {
  const status = Number(response?.statusCode)
  return status >= 200 && status < 300 && response?.locals?.[ERROR_ANSWER_LOCALS_FLAG] !== true
}

/**
 * Marks an answer as an error whatever its status, so no cache keeps it.
 * @param {any} response
 */
export const markAnswerAsAnError = (response) => {
  if (response && typeof response === 'object') {
    response.locals = response.locals || {}
    response.locals[ERROR_ANSWER_LOCALS_FLAG] = true
  }
}

/**
 * Wraps `response.send` so the answer, once sent, is handed to `keepAnswer` when it may be cached. `keepAnswer` is
 * called at most once per response, after the client's answer has been handed to Node, and never changes it.
 * @param {object} props
 * @param {any} props.response
 * @param {(answer: CachedAnswer) => void} props.keepAnswer
 * @param {() => void} [props.onAnswerNotKept] - called once when a serialized answer was sent that may not be cached.
 */
export const keepTheAnswerOf = ({ response, keepAnswer, onAnswerNotKept }) => {
  const sendOfExpress = response.send
  let isAnswerKept = false
  let isAnswerNotKeptReported = false
  response.send = function sendAndKeepTheAnswer (body) {
    const isSerializedBody = typeof body === 'string' || Buffer.isBuffer(body)
    const result = sendOfExpress.call(this, body)
    if (isSerializedBody && !isAnswerKept && !isAnswerCacheable(response)) {
      if (!isAnswerNotKeptReported) {
        isAnswerNotKeptReported = true
        try {
          onAnswerNotKept?.()
        } catch (error) {
          // A count never fails an answer.
        }
      }
    } else if (isSerializedBody && !isAnswerKept) {
      isAnswerKept = true
      const contentType = response.getHeader('content-type')
      try {
        keepAnswer({ status: response.statusCode, contentType: contentType ? String(contentType) : null, body })
      } catch (error) {
        console.error('[@servable/parse-server-engine/cache] Failed to keep an answer', error)
      }
    }
    return result
  }
}

/**
 * Sends a kept answer as it was first sent: same status, same Content-Type, same bytes.
 * @param {object} props
 * @param {any} props.response
 * @param {CachedAnswer} props.answer
 */
export const replayAnswer = ({ response, answer }) => {
  response.status(answer.status)
  if (answer.contentType) {
    response.setHeader('Content-Type', answer.contentType)
  }
  return response.send(answer.body)
}

/**
 * One Redis string: a short header line (status, Content-Type, how the body is written), then the body as it was
 * sent. A string body is written as it is; only a Buffer is written in base64.
 * @param {CachedAnswer} answer
 * @returns {string}
 */
export const redisEntryOf = ({ status, contentType, body }) => {
  const isBuffer = Buffer.isBuffer(body)
  const header = JSON.stringify({ s: status, t: contentType, e: isBuffer ? 'base64' : 'utf8' })
  return `${REDIS_ENTRY_PREFIX}${header}\n${isBuffer ? body.toString('base64') : body}`
}

/**
 * Reads a Redis entry back. Anything else (an entry an older engine wrote, a damaged one) answers null: it is
 * treated as a miss and replaced, never replayed.
 * @param {unknown} entry
 * @returns {CachedAnswer | null}
 */
export const answerOfRedisEntry = (entry) => {
  if (typeof entry !== 'string' || !entry.startsWith(REDIS_ENTRY_PREFIX)) {
    return null
  }
  const endOfHeader = entry.indexOf('\n')
  if (endOfHeader === -1) {
    return null
  }
  try {
    const header = JSON.parse(entry.slice(REDIS_ENTRY_PREFIX.length, endOfHeader))
    const status = Number(header?.s)
    if (!(status >= 200 && status < 300)) {
      return null
    }
    const rawBody = entry.slice(endOfHeader + 1)
    return {
      status,
      contentType: typeof header.t === 'string' ? header.t : null,
      body: header.e === 'base64' ? Buffer.from(rawBody, 'base64') : rawBody,
    }
  } catch {
    return null
  }
}
