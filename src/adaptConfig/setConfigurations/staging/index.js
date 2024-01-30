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
        mountPath: process.env.SERVABLE_MOUNT_STAGING,
        serverURL: `${process.env.SERVABLE_SERVER_URL}${process.env.SERVABLE_MOUNT_STAGING}`,
        publicServerURL: `${process.env.SERVABLE_PUBLIC_SERVER_URL}${process.env.SERVABLE_MOUNT_STAGING}`,
        ...((props.configuration.config && props.configuration.config.parse) ? props.configuration.config.parse : {}),
      }
    }
  }

  return configuration
}
