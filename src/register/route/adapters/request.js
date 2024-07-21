export default ({ request, }) => {
  return {
    method: request.method,
    orginalUrl: request.orginalUrl,
    params: request.params,
    query: request.query,
    // rawHeaders: request.rawHeaders,
    headers: request.headers,
    url: request.url,
    socket: request.socket,
    complete: request.complete,
    aborted: request.aborted,
    baseUrl: request.baseUrl,
  }
}


