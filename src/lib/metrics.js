// How the engine counts (production proof, .docs/technical/production-proof-instrumentation-2026-11-23.md, owner's Q1460 a):
// through `Servable.App.Metrics`, the metrics contract of @servable/server, so the counts leave through whatever meter provider
// the app registered (backend/main: its Prometheus port) and the engine imports no app. With an @servable/server that does not
// provide the contract yet, every count does nothing: the check is made at each count. A count never throws.
//
// Labels come from closed lists only (a route's registered path, a storage, an outcome): never a token, a digest, a value a
// client sent, a user or an object.

const metricsContract = () => {
  const metrics = /** @type {any} */ (globalThis).Servable?.App?.Metrics
  return metrics && typeof metrics.counter === 'function' ? metrics : null
}

/**
 * @param {string} name
 * @param {{ description?: string }} [options]
 * @returns {{ name: string, add: (value?: number, attributes?: Record<string, string | number | boolean>) => void }}
 */
export const engineCounterNamed = (name, options) => ({
  name,
  add: (value = 1, attributes) => {
    try {
      metricsContract()?.counter(name, options).add(value, attributes)
    } catch (error) {
      // A count never fails what it counts.
    }
  },
})

/**
 * A histogram through the same contract (`Servable.App.Metrics.histogram`): nothing is recorded with an @servable/server whose
 * contract has none. A record never throws.
 * @param {string} name - in Prometheus form, its unit in the name (`_seconds`).
 * @param {{ description?: string, bucketBoundaries?: number[] }} [options]
 * @returns {{ name: string, record: (value: number, attributes?: Record<string, string | number | boolean>) => void }}
 */
export const engineHistogramNamed = (name, options) => ({
  name,
  record: (value, attributes) => {
    try {
      const metrics = metricsContract()
      typeof metrics?.histogram === 'function' && metrics.histogram(name, options).record(value, attributes)
    } catch (error) {
      // A measure never fails what it measures.
    }
  },
})
