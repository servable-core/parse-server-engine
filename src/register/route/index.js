import _cache from "./cache/index.js"
import _rateLimiter from './rateLimiter/index.js'
import bodyParser from 'body-parser'
import processHttp from './process/http.js'
import sanitizePath from 'path-sanitizer'
// import uploadfile from "./verbs/uploadfile/index.js"
import handleFunction from "./verbs/function/index.js"
import engineOptionsFrom, { routeCacheBypassSecretFrom } from '../../options/index.js'
import { createRouteParametersReader, recordUndeclaredRoute, undeclaredParameterRoutes } from './parameters/index.js'
import { reportTheUndeclaredParameterRoutesSoon } from './parameters/bootReport.js'

export default ({ servableConfig }) => {
  const item = {}

  // The routes defined without a `schema.queryString` (parameters/bootReport.js), for an app's own checks.
  item.undeclaredParameterRoutes = undeclaredParameterRoutes

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


    // Read when the route is defined (after the boot adapted the configuration), so every route of the app uses the
    // same secret; it is an option of the engine (options/index.js), the environment winning.
    const bypassSecret = routeCacheBypassSecretFrom({ engineConfiguration: servableConfig?.configuration?.config?.engine })
    const urls = paths ? paths : (path ? [path] : (url ? [url] : []))

    // The route's parameters, read as `schema.queryString` declares them (parameters/index.js), compiled once here.
    const {
      isQueryValueGuessingEnabled,
      areDeclaredRouteParametersTyped,
      areUndeclaredParameterRoutesRefused,
    } = engineOptionsFrom({ engineConfiguration: servableConfig?.configuration?.config?.engine })
    const routeName = `${String(method).toUpperCase()} ${urls.map((routePath) => (prefix ? `${prefix}/${routePath}` : routePath)).join(', ')}`
    const routeParametersReader = createRouteParametersReader({
      queryStringDeclaration: schema?.queryString,
      isQueryValueGuessingEnabled,
      areDeclaredRouteParametersTyped,
      routeName,
    })
    if (!routeParametersReader.isDeclared) {
      const undeclaredRoute = recordUndeclaredRoute({ routeName, handler })
      if (areUndeclaredParameterRoutesRefused && !isQueryValueGuessingEnabled && undeclaredRoute.doesSeemToReadParameters) {
        throw new Error(`[ENGINE] [route parameters] ${routeName} reads its parameters and declares none in schema.queryString, while query value guessing is off (areUndeclaredParameterRoutesRefused)`)
      }
      reportTheUndeclaredParameterRoutesSoon()
    }
    return Promise.all(urls.map(async _path => {
      switch (method.toLowerCase()) {
        case 'get': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath.default(__url)}`.toLowerCase()
          Servable.AppNative.get(
            __url,
            _cache({ cache: options.cache, bypassSecret }),
            _rateLimiter({
              rateLimiting: options.rateLimiting,
              routeKey: `${method.toLowerCase()}:${__url}`
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                options,
                routeParametersReader,
                request,
                response,
                next
              })
            })
        } break
        case 'head': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath.default(__url)}`.toLowerCase()
          Servable.AppNative.head(
            __url,
            _cache({ cache: options.cache, bypassSecret }),
            _rateLimiter({
              rateLimiting: options.rateLimiting,
              routeKey: `${method.toLowerCase()}:${__url}`
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                options,
                routeParametersReader,
                request,
                response,
                next
              })
            })
        } break
        case 'connect': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath.default(__url)}`.toLowerCase()
          Servable.AppNative.head(
            __url,
            _cache({ cache: options.cache, bypassSecret }),
            _rateLimiter({
              rateLimiting: options.rateLimiting,
              routeKey: `${method.toLowerCase()}:${__url}`
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                options,
                routeParametersReader,
                request,
                response,
                next
              })
            })
        } break
        case 'post': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath.default(__url)}`.toLowerCase()
          Servable.AppNative.post(
            __url,
            _rateLimiter({
              rateLimiting: options.rateLimiting,
              routeKey: `${method.toLowerCase()}:${__url}`
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                options,
                routeParametersReader,
                request,
                response,
                next
              })
            })
        } break
        case 'put': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath.default(__url)}`.toLowerCase()
          Servable.AppNative.put(
            __url,
            _rateLimiter({
              rateLimiting: options.rateLimiting,
              routeKey: `${method.toLowerCase()}:${__url}`
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                options,
                routeParametersReader,
                request,
                response,
                next
              })
            })
        } break
        case 'patch': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath.default(__url)}`.toLowerCase()
          Servable.AppNative.patch(
            __url,
            _rateLimiter({
              rateLimiting: options.rateLimiting,
              routeKey: `${method.toLowerCase()}:${__url}`
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                options,
                routeParametersReader,
                request,
                response,
                next
              })
            })
        } break
        case 'delete': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath.default(__url)}`.toLowerCase()
          Servable.AppNative.delete(
            __url,
            _rateLimiter({
              rateLimiting: options.rateLimiting,
              routeKey: `${method.toLowerCase()}:${__url}`
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                options,
                routeParametersReader,
                request,
                response,
                next
              })
            })
        } break
        case 'options': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath.default(__url)}`.toLowerCase()
          Servable.AppNative.options(
            __url,
            _rateLimiter({
              rateLimiting: options.rateLimiting,
              routeKey: `${method.toLowerCase()}:${__url}`
            }),
            bodyParser.raw({
              type: _request.type ? _request.type : 'application/json'
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                options,
                routeParametersReader,
                request,
                response,
                next
              })
            })
        } break
        case 'trace': {
          let __url = prefix ? `${prefix}/${_path}` : _path
          __url = `/${sanitizePath.default(__url)}`.toLowerCase()
          Servable.AppNative.trace(
            __url,
            _cache({ cache: options.cache, bypassSecret }),
            _rateLimiter({
              rateLimiting: options.rateLimiting,
              routeKey: `${method.toLowerCase()}:${__url}`
            }),
            async (request, response, next) => {
              await processHttp({
                servableArguments,
                options,
                routeParametersReader,
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
          __url = `/${sanitizePath.default(__url)}`.toLowerCase()
          await handleFunction({
            url: __url,
            options,
            routeParametersReader,
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
