import requestAdapter from '../adapters/request.js'
import { buildParamsWithTraceContext } from '../lib/traceContext.js'

export default async ({
  servableArguments,
  extra = {},
  options: {
    handler,
    requireUser = false //#TODO: add requireUserKeys https://docs.parseplatform.org/cloudcode/guide/#cloud-functions
  },
  request,
  response,
  next }) => {
  try {
    const _request = requestAdapter({ request })
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
      code: e.code ? e.code : 520,
      messageId: e.messageId,
    }
    // next(a)
    // response.send(a)
    response.status(a.code).json({ error: a.message })
  }
}

