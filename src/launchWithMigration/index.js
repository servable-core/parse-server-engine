
import doLaunch from "../doLaunch/index.js"

export default async (props) => {
  const { schema, configuration, app } = props
  console.log('[PARSE_SERVER_ADAPTER]', '[DEBUG]', 'launchwithmigration>', schema, configuration)

  const { appFeature, liveClasses } = schema
  const {
    classes: { all: definitions },
  } = appFeature.schema

  let state = 0

  const migrationSchema = {
    beforeMigration: () => {
      console.debug(`---------------- 🐝 ${schema.features.length} features 🐝:\n ${schema.features.map(a => ` ${a.id}${(a.type === 'app') ? ' (app)' : ''}`)}`)
      state = 1
    },
    afterMigration: async () => {
      state = 2
    },
    definitions
  }

  let config = { ...configuration.config }

  config = {
    ...config,
    parse: {
      ...config.parse,
      schema: migrationSchema,
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
