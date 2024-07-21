import requestAdapter from '../adapters/request'

export default async ({ servableArguments, handler, request, response, next }) => {
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

    const result = await handler({
      request: _request,
      response,
      next,
      native,
      ..._servableArguments
    })

    if (result) {
      response.status(200).send(result)
      // response.send(result)
    }
  } catch (e) {
    const { message = "An error occurred", code = 500 } = e
    // response.status(code).send(message)
    // response.status(code)
    next(e)
  }
}

