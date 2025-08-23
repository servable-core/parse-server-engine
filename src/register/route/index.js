import _cache from "./cache/index.js"
import _rateLimiter from './rateLimiter/index.js'
import bodyParser from 'body-parser'
import processHttp from './process/http.js'
import sanitizePath from 'path-sanitizer'
// import uploadfile from "./verbs/uploadfile/index.js"
import handleFunction from "./verbs/function/index.js"

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
      parser,
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
          __url = `/${sanitizePath(__url)}`.toLowerCase()
          Servable.AppNative.get(
            __url,
            _cache({ cache: options.cache }),
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                options,
                request,
                response,
                next
              })
            })
        } break
        case 'head': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`.toLowerCase()
          Servable.AppNative.head(
            __url,
            _cache({ cache: options.cache }),
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                options,
                request,
                response,
                next
              })
            })
        } break
        case 'connect': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`.toLowerCase()
          Servable.AppNative.head(
            __url,
            _cache({ cache: options.cache }),
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                options,
                request,
                response,
                next
              })
            })
        } break
        case 'post': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`.toLowerCase()
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
                options,
                request,
                response,
                next
              })
            })
        } break
        case 'put': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`.toLowerCase()
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
                options,
                request,
                response,
                next
              })
            })
        } break
        case 'patch': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`.toLowerCase()
          Servable.AppNative.patch(
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
                options,
                request,
                response,
                next
              })
            })
        } break
        case 'delete': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`.toLowerCase()
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
                options,
                request,
                response,
                next
              })
            })
        } break
        case 'options': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`.toLowerCase()
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
                options,
                request,
                response,
                next
              })
            })
        } break
        case 'trace': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath(__url)}`.toLowerCase()
          Servable.AppNative.trace(
            __url,
            _cache({ cache: options.cache }),
            _rateLimiter({
              rateLimiting: options.rateLimiting
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                options,
                request,
                response,
                next
              })
            })
        } break
        default:
        case 'function': {
          let __url = `/function/${_path}`
          __url = prefix ? `${prefix}/${__url}` : __url
          __url = `/${sanitizePath(__url)}`.toLowerCase()
          await handleFunction({
            url: __url,
            options,
            rateLimiter: _rateLimiter,
            servableArguments,
          })
        } break
        // case 'uploadfile': {
        //   await uploadfile({
        //     options,
        //     path: _path,
        //     rateLimiter: _rateLimiter,
        //     processHttp,
        //     prefix,
        //     servableArguments,
        //   })
        // } break

      }
    }))
  }

  return item
}
