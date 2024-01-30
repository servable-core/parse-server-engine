
export default async ({ handler, request, response, next }) => {
  try {
    const result = await handler(request, response, next)
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
