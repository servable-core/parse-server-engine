// A real pass-through Express middleware, not a factory returning one.
//
// Every call site passes this straight into the middleware chain - `return empty` in
// cache/index.js (no cache configurations, or an unrecognized storage) and in
// rateLimiter/index.js (no rateLimiting block), plus `middlewares[index] || empty`. The previous
// shape took no arguments and merely RETURNED a function, so Express invoked the outer arrow,
// discarded the returned value, and nothing ever called next() - the request then hung forever
// with no error and no response. It went unnoticed because every route in the app happened to
// declare both a cache and a rateLimiting block, so this no-op path was never reached; deleting
// either one from a route silently made it hang.
export default (req, res, next) => {
  next()
}
