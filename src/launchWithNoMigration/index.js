import doLaunch from "../doLaunch/index.js"

export default async ({ schema, configuration, app }) => {
  console.log('[PARSE_SERVER_ADAPTER]', '[DEBUG]', 'launchwithnomigration> ', schema, configuration)
  const { liveClasses } = schema
  let config = { ...configuration.config }
  config = {
    ...config,
    parse: {
      ...config.parse,
      liveQuery: {
        ...(config.liveQuery ? config.liveQuery : {}),
        classNames: liveClasses,
      },
    }
  }

  const server = await doLaunch({
    config,
    app
  })
  Servable.schema = schema
  return { config, server }
}
