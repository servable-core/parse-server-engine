// Production proof 3.14 (.docs/technical/production-proof-instrumentation-2026-11-23.md): ONE line per boot with every engine
// option as resolved (./index.js `engineOptionsFrom`, the environment winning over the app), the route cache's bypass secret
// only as `set` or `not set`, never its value or its length:
//   [ENGINE] options { proof: 'engine-options', isFastObjectGetEnabled, ..., routeCacheBypassSecret: 'set' }

/**
 * @param {object} props
 * @param {Record<string, boolean>} props.engineOptions
 * @param {string | null} props.routeCacheBypassSecret
 * @param {{ info: (...args: any[]) => void }} [props.logger]
 * @returns {Record<string, any>} the fields logged.
 */
export const reportTheEngineOptions = ({ engineOptions, routeCacheBypassSecret, logger = console }) => {
  const fields = { proof: 'engine-options', ...(engineOptions || {}), routeCacheBypassSecret: routeCacheBypassSecret ? 'set' : 'not set' }
  try {
    logger.info(fields, '[ENGINE] options')
  } catch (error) {
    // A boot line never fails a boot.
  }
  return fields
}

export default reportTheEngineOptions
