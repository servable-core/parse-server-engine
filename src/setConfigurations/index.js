import doAdapt from "./adapt.js"
import fillEnv from './fillEnv.js'

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
    engine,
    configuration
  })

  return servableConfig
}
