import doAdapt from "./adapt.js"
import fillEnv from './fillEnv.js'

/**
 * @param {object} props
 * @param {Record<string, any>} props.servableConfig
 * @param {boolean} [props.live]
 * @param {any} [props.engine] - accepted for call-shape parity with @servable/server's own
 *   `adaptConfig()`, which always passes it through here; unused - `doAdapt()` never reads it.
 */
export default ({
  servableConfig,
  live,
  engine
}) => {
  const { configuration = {} } = servableConfig

  fillEnv(servableConfig)
  servableConfig.configuration = doAdapt({
    servableConfig,
    live,
    configuration
  })

  return servableConfig
}
