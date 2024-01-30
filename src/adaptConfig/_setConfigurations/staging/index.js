import production from "../production/index.js"

export default (props) => {
  let config = production(props)

  config = {
    ...config,
    ...(props.configuration.config ? props.configuration.config : {}),
    parse: {
      ...config.parse,
      mountPath: process.env.SERVABLE_MOUNT_STAGING,
      serverURL: `${process.env.SERVABLE_SERVER_URL}${process.env.SERVABLE_MOUNT_STAGING}`,
      publicServerURL: `${process.env.SERVABLE_PUBLIC_SERVER_URL}${process.env.SERVABLE_MOUNT_STAGING}`,
      ...((props.configuration.config && props.configuration.config.parse) ? props.configuration.config.parse : {}),
    }
  }

  return config
}
