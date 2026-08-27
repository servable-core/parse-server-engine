import requestAdapter from '../../adapters/request.js'
import { buildParamsWithTraceContext } from '../../lib/traceContext.js'

export default async ({
  servableArguments,
  extra = {},
  options: {
    handler,
    requireUser = false, //#TODO: add requireUserKeys https://docs.parseplatform.org/cloudcode/guide/#cloud-functions
    requireStepUp = false
  },
  request,
  response,
  next }) => {
  try {
    // throw { code: 209, message: "invalid session token" }
    const _request = requestAdapter({ request })
    const native = {
      request,
      response,
      next
    }

    const _servableArguments = await servableArguments({
      request: _request,
      response,
      native
    })

    const { userResolver } = _servableArguments
    const user = await userResolver({ request })
    if (requireUser && !user) {
      throw { code: 209, message: "invalid session token" }
    }

    // See process/http.js's identical check for why this is 449, not 209.
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
      params,
      response,
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
      // See process/http.js's identical fallback for why 500 replaces the old 520 - it collided
      // with Cloudflare's own synthetic "unknown error from origin" status.
      code: e.code ? e.code : 500,
      messageId: e.messageId,
    }
    // next(a)
    // response.send(a)
    response.status(a.code).json({ error: a.message })
    // response.status(code)
    // next(a)
  }
}

