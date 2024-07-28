import requestAdapter from '../../adapters/request'

export default async ({ servableArguments, extra = {}, handler, request, response, next }) => {
  try {
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

    const result = await handler({
      user,
      request: _request,
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
      code: e.code ? e.code : 520
    }
    // response.status(code).send(message)
    // response.status(code)
    next(a)
  }
}

