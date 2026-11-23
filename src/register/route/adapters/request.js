/**
 * The request a route's handler gets.
 * @param {object} props
 * @param {any} props.request - Express's request.
 * @param {Record<string, any>} [props.query] - the query as the route reads it (parameters/index.js); Express's own
 *   `request.query` when none is given.
 * @returns {Record<string, any>}
 */
export default ({ request, query }) => {
  return {
    method: request.method,
    orginalUrl: request.orginalUrl,
    params: request.params,
    query: query === undefined ? request.query : query,
    // rawHeaders: request.rawHeaders,
    headers: request.headers,
    url: request.url,
    socket: request.socket,
    complete: request.complete,
    aborted: request.aborted,
    baseUrl: request.baseUrl,
    files: request.files,
    file: request.file,
    body: request.body,
    native: request
  }
}


