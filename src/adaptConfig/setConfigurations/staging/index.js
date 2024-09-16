import production from "../production/index.js"

export default (props) => {
  const configuration = production(props)

  configuration = {
    ...configuration,
    key: "staging",
    enabled: true,
    params: {
      ...(configuration.params ? configuration.params : {}),
      skipWiring: true,
      afterMigration: {
        shouldRun: true,
        continueToNextConfigurationIfOk: false
      },
      decoyDatabase: {
        maxDBSize: 1000,
        maxPeriod: 24 * 7
      },
      ...(props.configuration.params ? props.configuration.params : {}),
    },
    config: {
      ...configuration.config,
      ...(props.configuration.config ? props.configuration.config : {}),
      parse: {
        ...configuration.config.parse,
        mountPath: '/parsestaging',
        serverURL: `${process.env.SERVABLE_SERVER_HOST}:${process.env.SERVABLE_SERVER_PORT}/parsestaging`,
        ...((props.configuration.config && props.configuration.config.parse) ? props.configuration.config.parse : {}),
      }
    }
  }

  return configuration
}
