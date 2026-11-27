import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { readerAddressOfRequest } from '../../../readerAddress/index.js'
import empty from "../empty.js"
import RedisRateLimitStore from './redisStore.js'
import { getRedisClient } from '../cache/redis/index.js'

// Opt in with SERVABLE_RATE_LIMIT_REDIS=1 (or true): the counters then live in Redis (APP_REDIS_URI, the route cache's
// client) and are shared by every pod. Unset, each pod counts in its own memory, as before.
const isRedisStoreEnabled = () => ['1', 'true'].includes(String(process.env.SERVABLE_RATE_LIMIT_REDIS || '').trim().toLowerCase())

/**
 * @param {object} props
 * @param {string} [props.routeKey] names the route's counter in the Redis store (method and url)
 * @param {{ type?: 'fixedByIp', params?: { limit?: number, window?: number, message?: string,
 *   standardHeaders?: boolean, legacyHeaders?: boolean } }} [props.rateLimiting]
 * @returns {import('express-rate-limit').RateLimitRequestHandler | typeof import('../empty.js').default}
 */
export default ({ rateLimiting = {}, routeKey = null }) => {
  const { type, params = {} } = rateLimiting
  const {
    limit = 100000,
    window = 100,
    message = 'Too many requests from this IP, please try again after an hour',
    standardHeaders = true,
    legacyHeaders = true
  } = params

  switch (type) {
    case 'fixedByIp': {
      // Opt-in shared counters; a limiter with no route name keeps the in-memory store.
      const store = (isRedisStoreEnabled() && routeKey)
        ? new RedisRateLimitStore({ routeKey, getClient: () => getRedisClient({ redisUrl: process.env.APP_REDIS_URI }) })
        : undefined
      return rateLimit({
        ...(store ? { store } : {}),
        //https://stackoverflow.com/questions/64188573/express-rate-limit-blocking-requests-from-all-users
        windowMs: window, // 1 hour
        max: limit, // Limit each IP to 5 create account requests per `window` (here, per hour)
        message,
        standardHeaders, // Return rate limit info in the `RateLimit-*` headers
        legacyHeaders, // Disable the `X-RateLimit-*` headers,
        // Keyed on the reader's address (readerAddress/index.js): the one a server rendering for readers signed in
        // `x-servable-reader-address`, else req.ip. req.ip is the visitor behind a proxy only when the app sets
        // "trust proxy" (SERVABLE_ENGINE_TRUST_PROXY, createapp/trustProxy.js); without it every visitor shares the
        // proxy's bucket. The library's own checks stay on, so that mistake is logged
        // (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR) instead of silently passing:
        // https://express-rate-limit.mintlify.app/reference/error-codes
        // ipKeyGenerator is the library's own grouping of req.ip, kept: an IPv6 address counted by its /56.
        keyGenerator: (request) => ipKeyGenerator(readerAddressOfRequest(request)),
      })
    }
    default: {
      return empty
    }
  }
}

