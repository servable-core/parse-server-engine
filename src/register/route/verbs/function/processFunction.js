import requestAdapter from '../../adapters/request.js'
import { buildParamsWithTraceContext } from '../../lib/traceContext.js'
import { httpStatusOfThrownErrorCode } from '../../process/errorStatus.js'
import { errorAnswerBodyOf } from '../../process/errorAnswer.js'

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
    // throw { code: 209, message: "invalid session token" }
    // The query string read as the route declares it (parameters/index.js): a value that cannot be read throws a 400
    // here, before anything else runs. Without a reader (a caller of this function that predates it), Express's query.
    const query = routeParametersReader ? routeParametersReader.readQueryOf(request) : undefined
    // As process/http.js: the JSON body checked as `schema.body` declares it, nothing for a route that declares none.
    const body = routeParametersReader?.readBodyOf ? routeParametersReader.readBodyOf(request) : undefined
    const _request = requestAdapter({ request, query, body })
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
    // As process/http.js: a code that is no final HTTP status is answered with a 400, the code in the body, and a thrown
    // refusal (`refusalCode`, its plain `refusalDetails`) is sent with it (../../process/errorAnswer.js).
    response.status(httpStatusOfThrownErrorCode(a.code)).json(errorAnswerBodyOf({ message: a.message, code: a.code, thrownError: e }))
    // response.status(code)
    // next(a)
  }
}

