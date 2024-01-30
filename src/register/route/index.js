import _cache from "./cache/index.js"
import _rateLimiter from './rateLimiter.js'
import bodyParser from 'body-parser'
import doHandle from './doHandle.js'

export default ({ servableConfig }) => {
  const item = {}

  item.define = async (options) => {
    if (typeof options === 'function') {
      return
    }

    const {
      method,
      url,
      path,
      paths,
      specification,
      schema,
      handler,
      preHandler,
      request = {}
      // rateLimiter = {
      //   windowMs = 60 * 60 * 1000, // 1 hour
      //   max = 1000, // Limit each IP to 5 create account requests per `window` (here, per hour)
      //   message:
      //     'Too many requests from this IP, please try again after an hour',
      //   standardHeaders = true, // Return rate limit info in the `RateLimit-*` headers
      //   legacyHeaders = false, // Disable the `X-RateLimit-*` headers
      // } = {},
      // cache = { type = 'memory', duration = 10 } = {}
    } = options

    // if (cache) {
    //   // const { type = memory, duration = 10 } = cache
    // }

    const urls = paths ? paths : (path ? [path] : (url ? [url] : []))
    return Promise.all(urls.map(async _url => {
      switch (method.toLowerCase()) {
        case 'get': {
          Servable.AppNative.get(
            _url,
            _cache(10),
            _rateLimiter({
              //https://stackoverflow.com/questions/64188573/express-rate-limit-blocking-requests-from-all-users
              windowMs: 60 * 60 * 1000, // 1 hour
              max: 1000, // Limit each IP to 5 create account requests per `window` (here, per hour)
              message:
                'Too many requests from this IP, please try again after an hour',
              standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
              legacyHeaders: false, // Disable the `X-RateLimit-*` headers,
            }),
            async (request, response, next) => {
              await doHandle({ handler, request, response, next })
            })
        } break
        case 'post': {
          Servable.AppNative.post(
            _url,
            bodyParser.raw({ type: request.type ? request.type : 'application/json' }),
            async (request, response, next) => {
              await doHandle({ handler, request, response, next })
            })
        } break
        default: break
      }
    }))
  }

  return item
}
