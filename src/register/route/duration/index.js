import { performance } from 'node:perf_hooks'
import { engineHistogramNamed } from '../../../lib/metrics.js'
import empty from '../empty.js'

// How long a route takes to answer, for the routes that ask for it (owner's Q1580 a, 2026-11-24: the before/after of the work of
// 2026-11-23). backend/main exports no HTTP duration of its own (its meter provider is registered without the auto-instrumentations'
// metrics, one histogram per route of every route being many series), so a route declares that its duration is measured:
//
//   { method: 'get', path: 'article', metrics: { isDurationMeasured: true }, ... }
//
// and the engine measures it from the first middleware of the route (before its cache, so a cached answer is measured too) to
// the moment its answer is sent:
//   servable_route_duration_seconds{route, method, status_class}
// `route` is the registered path (`/v1/article`), `method` the route's verb, `status_class` 2xx, 3xx, 4xx, 5xx, or `aborted` (the
// client closed the connection before the answer was sent). Never a value from the address, a user or an object. A route that
// does not ask has no middleware at all: no cost. A function route (`/function/...`) is not measured.

export const ROUTE_DURATION_BUCKETS_IN_SECONDS = Object.freeze([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10])

const routeDurationHistogram = engineHistogramNamed('servable_route_duration_seconds', {
  description: 'Duration in seconds of the routes that declare metrics.isDurationMeasured, from their first middleware to the answer sent, by route, method and status class.',
  bucketBoundaries: [...ROUTE_DURATION_BUCKETS_IN_SECONDS],
})

/**
 * Whether a route's declaration asks for its duration to be measured.
 * @param {any} routeOptions - the route's declaration.
 * @returns {boolean}
 */
export const isRouteDurationMeasured = (routeOptions) => routeOptions?.metrics?.isDurationMeasured === true

/**
 * The class of a status: `2xx`, `3xx`, `4xx`, `5xx`, else `other`. Pure.
 * @param {unknown} statusCode
 * @returns {string}
 */
export const statusClassOf = (statusCode) => {
  const status = Number(statusCode)
  return Number.isInteger(status) && status >= 200 && status <= 599 ? `${Math.floor(status / 100)}xx` : 'other'
}

/**
 * The middleware that measures a route, or the pass-through when the route does not ask for it.
 * @param {object} props
 * @param {any} props.routeOptions - the route's declaration.
 * @param {string} props.routePath - the registered path, the `route` label.
 * @param {string} props.method
 * @param {() => number} [props.nowInMilliseconds]
 */
export const routeDurationMiddlewareOf = ({ routeOptions, routePath, method, nowInMilliseconds = () => performance.now() }) => {
  if (!isRouteDurationMeasured(routeOptions)) {
    return empty
  }
  const methodLabel = String(method).toLowerCase()
  return (request, response, next) => {
    try {
      const startedAt = nowInMilliseconds()
      let isRecorded = false
      const recordOnce = () => {
        if (isRecorded) {
          return
        }
        isRecorded = true
        routeDurationHistogram.record((nowInMilliseconds() - startedAt) / 1000, {
          route: routePath,
          method: methodLabel,
          status_class: response.writableFinished ? statusClassOf(response.statusCode) : 'aborted',
        })
      }
      response.once('finish', recordOnce)
      response.once('close', recordOnce)
    } catch {
      // A measure never fails a request.
    }
    next()
  }
}

export default routeDurationMiddlewareOf
