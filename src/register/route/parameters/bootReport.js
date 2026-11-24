// The boot report: every route defined without a `schema.queryString`, with whether its handler seems to read its
// parameters. "Seems": the engine reads the handler's source for `params` or `.query`, which finds the handler that
// destructures them and misses one that reads them only through code elsewhere; an app that types its routes declares
// every route (`queryString: {}` when it reads none) and checks the full list instead.
//
// The engine does not know when the app has defined its last route, so the summary is written once the definitions
// stop for a moment (a timer that never keeps the process alive), and again if more come later.
// `Servable.App.Route.undeclaredParameterRoutes()` answers the list itself.

const SUMMARY_DELAY_IN_MILLISECONDS = 1000
const ROUTES_NAMED_IN_THE_SUMMARY = 20

/** @type {{ routeName: string, doesSeemToReadParameters: boolean }[]} */
const undeclaredRoutes = []
/** @type {NodeJS.Timeout | null} */
let summaryTimer = null

/**
 * Whether a handler's source reads `params` or a `.query`.
 * @param {any} handler
 * @returns {boolean}
 */
export const doesHandlerSeemToReadParameters = (handler) => {
  if (typeof handler !== 'function') {
    return false
  }
  const source = Function.prototype.toString.call(handler)
  return /\bparams\b|\.query\b/.test(source)
}

/**
 * Records a route defined without a `schema.queryString` (route/index.js).
 * @param {object} props
 * @param {string} props.routeName
 * @param {any} props.handler
 * @returns {{ routeName: string, doesSeemToReadParameters: boolean }}
 */
export const recordUndeclaredRoute = ({ routeName, handler }) => {
  const undeclaredRoute = { routeName, doesSeemToReadParameters: doesHandlerSeemToReadParameters(handler) }
  undeclaredRoutes.push(undeclaredRoute)
  return { ...undeclaredRoute }
}

/**
 * The routes defined so far without a `schema.queryString`: `Servable.App.Route.undeclaredParameterRoutes()`.
 * @returns {{ routeName: string, doesSeemToReadParameters: boolean }[]}
 */
export const undeclaredParameterRoutes = () => undeclaredRoutes.map((route) => ({ ...route }))

/**
 * Forgets the routes recorded (tests).
 */
export const forgetUndeclaredParameterRoutes = () => {
  undeclaredRoutes.length = 0
  if (summaryTimer) {
    clearTimeout(summaryTimer)
    summaryTimer = null
  }
}

/**
 * The summary line, or `null` when every route declares its parameters.
 * @returns {string | null}
 */
export const undeclaredParameterRoutesSummary = () => {
  if (!undeclaredRoutes.length) {
    return null
  }
  const readingRoutes = undeclaredRoutes.filter((route) => route.doesSeemToReadParameters)
  const named = readingRoutes.slice(0, ROUTES_NAMED_IN_THE_SUMMARY).map((route) => route.routeName).join('; ')
  const more = readingRoutes.length > ROUTES_NAMED_IN_THE_SUMMARY ? `; and ${readingRoutes.length - ROUTES_NAMED_IN_THE_SUMMARY} more` : ''
  return `[ENGINE] [route parameters] ${undeclaredRoutes.length} route(s) declare no schema.queryString, ${readingRoutes.length} of them seeming to read their parameters${readingRoutes.length ? `: ${named}${more}` : ''}`
}

/**
 * Writes the summary once the route definitions pause.
 * @param {object} [props]
 * @param {(line: string) => void} [props.writeLine]
 */
export const reportTheUndeclaredParameterRoutesSoon = ({ writeLine = (line) => console.warn(line) } = {}) => {
  if (summaryTimer) {
    clearTimeout(summaryTimer)
  }
  summaryTimer = setTimeout(() => {
    summaryTimer = null
    const summary = undeclaredParameterRoutesSummary()
    if (summary) {
      writeLine(summary)
    }
  }, SUMMARY_DELAY_IN_MILLISECONDS)
  summaryTimer.unref?.()
}

// Production proof 3.8 (.docs/technical/production-proof-instrumentation-2026-11-23.md): ONE summary line per boot, always (the
// line above only when a route declares nothing), its fields in a leading object, written once the definitions pause:
//   [ENGINE] [route parameters] summary { proof: 'route-parameters', routes, declared, undeclared, undeclaredReading,
//     wildcardGuessed, isQueryValueGuessingEnabled, areDeclaredRouteParametersTyped }

const definedRouteCounts = { routes: 0, declared: 0, undeclaredReading: 0, wildcardGuessed: 0 }
/** @type {NodeJS.Timeout | null} */
let routeParametersSummaryTimer = null

/**
 * Records one route defined (route/index.js).
 * @param {{ isDeclared: boolean, isWildcardGuessed?: boolean, doesSeemToReadParameters?: boolean }} props
 */
export const recordDefinedRouteParameters = ({ isDeclared, isWildcardGuessed = false, doesSeemToReadParameters = false }) => {
  definedRouteCounts.routes += 1
  if (isDeclared) {
    definedRouteCounts.declared += 1
  } else if (doesSeemToReadParameters) {
    definedRouteCounts.undeclaredReading += 1
  }
  if (isWildcardGuessed) {
    definedRouteCounts.wildcardGuessed += 1
  }
}

/**
 * The summary's fields. Pure but for the counts recorded.
 * @param {{ isQueryValueGuessingEnabled: boolean, areDeclaredRouteParametersTyped: boolean }} props
 */
export const routeParametersSummaryOf = ({ isQueryValueGuessingEnabled, areDeclaredRouteParametersTyped }) => ({
  proof: 'route-parameters',
  routes: definedRouteCounts.routes,
  declared: definedRouteCounts.declared,
  undeclared: definedRouteCounts.routes - definedRouteCounts.declared,
  undeclaredReading: definedRouteCounts.undeclaredReading,
  wildcardGuessed: definedRouteCounts.wildcardGuessed,
  isQueryValueGuessingEnabled: Boolean(isQueryValueGuessingEnabled),
  areDeclaredRouteParametersTyped: Boolean(areDeclaredRouteParametersTyped),
})

/**
 * Writes the summary once the route definitions pause (a timer that never keeps the process alive).
 * @param {{ isQueryValueGuessingEnabled: boolean, areDeclaredRouteParametersTyped: boolean, logger?: { info: (...args: any[]) => void } }} props
 */
export const reportTheRouteParametersSummarySoon = ({ isQueryValueGuessingEnabled, areDeclaredRouteParametersTyped, logger = console }) => {
  if (routeParametersSummaryTimer) {
    clearTimeout(routeParametersSummaryTimer)
  }
  routeParametersSummaryTimer = setTimeout(() => {
    routeParametersSummaryTimer = null
    try {
      logger.info(routeParametersSummaryOf({ isQueryValueGuessingEnabled, areDeclaredRouteParametersTyped }), '[ENGINE] [route parameters] summary')
    } catch (error) {
      // A boot line never fails a boot.
    }
  }, SUMMARY_DELAY_IN_MILLISECONDS)
  routeParametersSummaryTimer.unref?.()
}

/** Forgets the routes counted (tests). */
export const forgetDefinedRouteParameters = () => {
  Object.assign(definedRouteCounts, { routes: 0, declared: 0, undeclaredReading: 0, wildcardGuessed: 0 })
  if (routeParametersSummaryTimer) {
    clearTimeout(routeParametersSummaryTimer)
    routeParametersSummaryTimer = null
  }
}
