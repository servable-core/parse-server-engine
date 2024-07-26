import _cache from "./cache/index.js"
import _rateLimiter from './rateLimiter/index.js'
import bodyParser from 'body-parser'
import processHttp from './process/http.js'
import sanitizePath from 'path-sanitizer'
import processFunction from './process/function.js'
import uploadfile from "./verbs/uploadfile/index.js"

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
    return Promise.all(urls.map(async _path => {
      switch (method.toLowerCase()) {
        case 'get': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`
          Servable.AppNative.get(
            __url,
            _cache({ cache: options.cache }),
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                handler,
                request,
                response,
                next
              })
            })
        } break
        case 'post': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`
          Servable.AppNative.post(
            __url,
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                handler,
                request,
                response,
                next
              })
            })
        } break
        case 'put': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`
          Servable.AppNative.put(
            __url,
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                handler,
                request,
                response,
                next
              })
            })
        } break

        case 'update': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`
          Servable.AppNative.update(
            __url,
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                handler,
                request,
                response,
                next
              })
            })
        } break
        case 'delete': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`
          Servable.AppNative.delete(
            __url,
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                handler,
                request,
                response,
                next
              })
            })
        } break
        case 'options': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`
          Servable.AppNative.options(
            __url,
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                handler,
                request,
                response,
                next
              })
            })
        } break
        case 'function': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/functions/${sanitizePath(__url)}`
          Servable.AppNative.get(
            __url,
            // _cache({ cache: options.cache }),
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            async (request, response, next) => {
              await processFunction({
                servableArguments,
                handler,
                request,
                response,
                next
              })
            })
        } break
        case 'uploadfile': {
          await uploadfile({
            options,
            path: _path,
            rateLimiter: _rateLimiter,
            processHttp,
            prefix
          })
        } break
        default: break
      }
    }))
  }

  return item
}
