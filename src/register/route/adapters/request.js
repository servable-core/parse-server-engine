/**
 * The request a route's handler gets.
 * @param {object} props
 * @param {any} props.request - Express's request.
 * @param {Record<string, any>} [props.query] - the query as the route reads it (parameters/index.js); Express's own
 *   `request.query` when none is given.
 * @param {Record<string, any>} [props.body] - the body as the route's `schema.body` checked it (parameters/body.js);
 *   Express's own `request.body` (the raw buffer `bodyParser.raw` read) when none is given.
 * @returns {Record<string, any>}
 */
export default ({ request, query, body }) => {
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
    body: body === undefined ? request.body : body,
    native: request
  }
}


