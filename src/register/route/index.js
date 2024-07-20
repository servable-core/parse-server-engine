import _cache from "./cache/index.js"
import _rateLimiter from './rateLimiter/index.js'
import bodyParser from 'body-parser'
import doHandle from './doHandle.js'
import sanitizePath from 'path-sanitizer'
export default ({ servableConfig }) => {
  const item = {}

  item.define = async (options) => {
    if (typeof options === 'function') {
      return
    }

    const {
      servableArguments,
      method,
      url,
      path,
      paths,
      specification,
      prefix,
      schema,
      handler,
      logLevel,
      preHandler,
      request: _request = {}
    } = options

    const urls = paths ? paths : (path ? [path] : (url ? [url] : []))
    return Promise.all(urls.map(async _url => {
      let __url = prefix ? `${prefix}/${_url}` : _url
      __url = `/${sanitizePath(__url)}`

      switch (method.toLowerCase()) {
        case 'get': {
          Servable.AppNative.get(
            _url,
            _cache({ cache: options.cache }),
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            async (request, response, next) => {
              await doHandle({
                servableArguments,
                handler,
                request,
                response,
                next
              })
            })
        } break
        case 'post': {
          Servable.AppNative.post(
            _url,
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await doHandle({
                servableArguments,
                handler,
                request,
                response,
                next
              })
            })
        } break
        case 'put': {
          Servable.AppNative.put(
            _url,
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await doHandle({
                servableArguments,
                handler,
                request,
                response,
                next
              })
            })
        } break
        case 'update': {
          Servable.AppNative.update(
            _url,
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await doHandle({
                servableArguments,
                handler,
                request,
                response,
                next
              })
            })
        } break
        case 'delete': {
          Servable.AppNative.delete(
            _url,
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await doHandle({
                servableArguments,
                handler,
                request,
                response,
                next
              })
            })
        } break
        case 'options': {
          Servable.AppNative.options(
            _url,
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await doHandle({
                servableArguments,
                handler,
                request,
                response,
                next
              })
            })
        } break
        default: break
      }
    }))
  }

  return item
}
