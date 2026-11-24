import requestAdapter from '../adapters/request.js'
import { buildParamsWithTraceContext } from '../lib/traceContext.js'
import { markAnswerAsAnError } from '../cache/lib/cachedAnswer.js'
import { httpStatusOfThrownErrorCode } from './errorStatus.js'

export default async ({
  servableArguments,
  extra = {},
  routeParametersReader,
  options: {
    handler,
    requireUser = false, //#TODO: add requireUserKeys https://docs.parseplatform.org/cloudcode/guide/#cloud-functions
    requireStepUp = false
  },
  request,
  response,
  next }) => {
  try {
    // The query string read as the route declares it (parameters/index.js): a value that cannot be read throws a 400
    // here, before anything else runs. Without a reader (a caller of this function that predates it), Express's query.
    const query = routeParametersReader ? routeParametersReader.readQueryOf(request) : undefined
    const _request = requestAdapter({ request, query })
    const native = {
      request,
      response,
      next
    }

    const _servableArguments =
      servableArguments
        ? await servableArguments({
          request: _request,
          response,
          native
        })
        : {}

    const { userResolver } = _servableArguments
    let user
    if (userResolver) {
      user = await userResolver({ request })
    }

    if (requireUser && !user) {
      throw { code: 209, message: "invalid session token" }
    }

    // Independent from requireUser above, and checked after it - a route can't require step-up
    // from a request that isn't even authenticated. 449 ("Retry With") is distinct from 209 on
    // purpose: 209 means "log in again," 449 means "you're logged in, but prove it again for
    // this specific action" - a client needs to react very differently to each (redirect to
    // login vs. a lightweight password re-prompt that then retries the same request).
    if (requireStepUp && user) {
      const stepUpFresh = await Servable.App.User.checkStepUpFreshness({ user })
      if (!stepUpFresh) {
        throw { code: 449, message: "Step-up authentication required" }
      }
    }

    const params = buildParamsWithTraceContext({
      query: _request.query,
      headers: _request.headers,
    })

    const result = await handler({
      user,
      request: _request,
      response,
      params,
      next,
      native,
      ..._servableArguments,
      ...extra
    })

    if (result) {
      response.status(200).send(result)
      // response.send(result)
    }
  } catch (e) {
    const a = {
      message: e.message ? e.message : "An error occurred",
      // Was 520 - a real HTTP status a route handler should never send deliberately, but
      // Cloudflare (and most CDNs/proxies) treat 520 as their OWN synthetic "unknown error from
      // origin" code. A handler that throws without a .code produces a perfectly well-formed
      // response using this fallback, but at the client it reads as a CDN/infra failure instead
      // of an application error - confirmed live, this cost real debugging time chasing a
      // Cloudflare-side explanation for what was actually this fallback firing on a bare
      // `throw new Error(...)`. 500 carries the same "no more specific code was given" meaning
      // without colliding with a CDN's own status-code space.
      code: e.code ? e.code : 500,
      messageId: e.messageId,
    }
    // next(a)
    // response.send(a)
    // The status is the error's code, a Parse code as often as an HTTP one, and several Parse codes are in the 200s
    // (209 "invalid session token"): marked, so the route cache never keeps it as a success (cache/lib/cachedAnswer.js).
    // A code that is no final HTTP status (a Parse code from 100 to 199, a negative one, one above 599) is answered
    // with a 400, the code kept in the body (./errorStatus.js).
    markAnswerAsAnError(response)
    response.status(httpStatusOfThrownErrorCode(a.code)).json({ error: a.message, code: a.code })
  }
}

