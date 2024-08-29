import requestAdapter from '../../adapters/request'

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
      code: e.code ? e.code : 520,
      messageId: e.messageId,
    }
    // next(a)
    // response.send(a)
    response.status(a.code).json({ error: a.message })
    // response.status(code)
    // next(a)
  }
}

