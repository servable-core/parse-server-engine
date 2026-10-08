import rateLimit from 'express-rate-limit'
import empty from "../empty.js"

/**
 * @param {object} props
 * @param {{ type?: 'fixedByIp', params?: { limit?: number, window?: number, message?: string,
 *   standardHeaders?: boolean, legacyHeaders?: boolean } }} [props.rateLimiting]
 * @returns {import('express-rate-limit').RateLimitRequestHandler | typeof import('../empty.js').default}
 */
export default ({ rateLimiting = {} }) => {
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
      return rateLimit({
        //https://stackoverflow.com/questions/64188573/express-rate-limit-blocking-requests-from-all-users
        windowMs: window, // 1 hour
        max: limit, // Limit each IP to 5 create account requests per `window` (here, per hour)
        message,
        standardHeaders, // Return rate limit info in the `RateLimit-*` headers
        legacyHeaders, // Disable the `X-RateLimit-*` headers,
        // Keyed on req.ip (the library's default). Behind a proxy that is only the visitor when the app
        // sets "trust proxy" (SERVABLE_ENGINE_TRUST_PROXY, createapp/trustProxy.js); without it every visitor
        // shares the proxy's bucket. The library's own checks stay on, so that mistake is logged
        // (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR) instead of silently passing:
        // https://express-rate-limit.mintlify.app/reference/error-codes
      })
    }
    default: {
      return empty
    }
  }
}

