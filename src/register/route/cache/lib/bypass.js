import { createHash, timingSafeEqual } from 'node:crypto'

// Who may make a request skip the route cache (read and write), and how (framework performance audit 2026-11-23, F9;
// owner's Q1095 a). Until then any caller could send `x-servable-reset-cache` and have an expensive route computed
// cold on every request, a cheap way to saturate the server's one JavaScript thread.
//
// Two ways, nothing else:
//   - In the process: code that runs before the route (an app's Express middleware) sets
//     `request.shouldBypassTheRouteCache = true` on the request object. Nothing outside the process can set it.
//   - Over HTTP: `x-servable-reset-cache` carries the server's bypass secret (engine option `routeCacheBypassSecret`,
//     environment `SERVABLE_CACHE_BYPASS_SECRET`, see ../../../../options/index.js), compared in constant time. Callers
//     that hold it are the server's own (a readiness warm-up on loopback, a server-side renderer); a browser never does.
// Any other value of the header, or the header when no secret is configured, is ignored: the request uses the cache
// like any other. Nothing is logged for it, so the header cannot be used to fill the logs either.

export const ROUTE_CACHE_BYPASS_HEADER = 'x-servable-reset-cache'
export const ROUTE_CACHE_BYPASS_REQUEST_FLAG = 'shouldBypassTheRouteCache'

/** @param {string} value */
const digestOf = (value) => createHash('sha256').update(value, 'utf8').digest()

/**
 * Whether a header value is the bypass secret, in time that does not depend on how much of it matches (both sides
 * are hashed first, so their lengths are equal and the secret's length is not given away either).
 * @param {unknown} providedValue
 * @param {string | null | undefined} bypassSecret
 * @returns {boolean}
 */
export const isTheBypassSecret = (providedValue, bypassSecret) => {
  if (!bypassSecret || typeof providedValue !== 'string' || providedValue.length === 0) {
    return false
  }
  return timingSafeEqual(digestOf(providedValue), digestOf(bypassSecret))
}

/**
 * @param {object} props
 * @param {any} props.request - Express's request.
 * @param {string | null | undefined} props.bypassSecret
 * @returns {boolean}
 */
export const isRouteCacheBypassedFor = ({ request, bypassSecret }) => {
  if (request?.[ROUTE_CACHE_BYPASS_REQUEST_FLAG] === true) {
    return true
  }
  return isTheBypassSecret(request?.headers?.[ROUTE_CACHE_BYPASS_HEADER], bypassSecret)
}

export default isRouteCacheBypassedFor
