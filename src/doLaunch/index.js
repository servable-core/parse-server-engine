import { ParseServer } from "parse-server"
import _path from "path"
import { fileURLToPath } from "url"
import { dirname } from "path"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default async ({ config, serverCloseComplete, app }) => {
  const { parse: parseConfig } = config
  console.log('[PARSE_SERVER_ADAPTER]', '[DEBUG]', 'dolaunch>',
    // config,
  )
  const schema = {

    ...(parseConfig.schema ? parseConfig.schema : {}),
    // Parse Schema API will be disabled
    // If you need to update schemas Parse server
    // need to be updated and deployed (CI/CD strategy)
    lockSchemas: true,
    // If true, Parse Server will delete non defined Classes from
    // the database. (Core classes like Role, User are never deleted)
    strict: false,
    // If true, a field type change, the changed field is deleted
    // from the database (all data in this field will be deleted)
    // and then create the field with the new type
    recreateModifiedFields: false,
    // If true, Parse will delete non defined fields on a class. (Core fields are never deleted)
    deleteExtraFields: false,

    // LockSchemas: JSON.parse(process.env.SERVABLE_SCHEMA_LOCK_SCHEMAS) ? true : false,
    // strict: JSON.parse(process.env.SERVABLE_SCHEMA_STRICT) ? true : false,
    // recreateModifiedFields: JSON.parse(process.env.SERVABLE_SCHEMA_RECREATE_MODIFIED_FIELDS) ? true : false,
    // deleteExtraFields: JSON.parse(process.env.SERVABLE_SCHEMA_DELETE_EXTRA_FIELDS) ? true : false,
    beforeMigration: () => {
      if (parseConfig.schema && parseConfig.schema.beforeMigration) {
        parseConfig.schema.beforeMigration()
      }

      console.log("[PARSE_SERVER_ADAPTER]", "\n")
      if (parseConfig.schema && parseConfig.schema.definitions) {
        console.debug(
          `---------------- 🍯 ${parseConfig.schema.definitions.length
          } classes 🍯:\n ${parseConfig.schema.definitions.map(
            a => ` ${a.className}`
          )}`
        )
      }

      console.log("[PARSE_SERVER_ADAPTER]", "\n")
      parseConfig.liveClasses &&
        console.debug(
          `---------------- ⚡️ ${parseConfig.liveClasses.length
          } live classes ⚡️:\n ${liveClasses.map(a => ` ${a}`)}`
        )
      console.log("[PARSE_SERVER_ADAPTER]", "\n")
      console.log("[PARSE_SERVER_ADAPTER]", "---------------- 🧐 launching migration 😰😰")
      console.log("[PARSE_SERVER_ADAPTER]", "\n")
    },
    afterMigration: async () => {
      if (parseConfig.schema && parseConfig.schema.afterMigration) {
        parseConfig.schema.afterMigration()
      }

      console.log("[PARSE_SERVER_ADAPTER]", "---------------- 🥰 afterMigration 😍😍")
    }
  }

  const options = {
    ...parseConfig,
    verbose: (parseConfig.verbose && parseConfig.verbose !== undefined) ? parseConfig.verbose : 'warn', //#TODO: transmit verbose from envs properly
    allowClientClassCreation: false,
    cloud: _path.resolve(__dirname, "./main.cjs"),
    masterKeyIps: [], // allow all IPs,
    enableInsecureAuthAdapters: false,
    security: {
      enableCheck: true,
      enableCheckLog: false
    },
    schema
  }

  const server = new ParseServer({
    ...options,
    serverCloseComplete: async () => {
      console.log("[PARSE_SERVER_ADAPTER]", "serverCloseComplete")
      serverCloseComplete && serverCloseComplete()
    },
  })

  await server.start()
  app.use(config.parse.mountPath, server.app)
  return server.app
}
