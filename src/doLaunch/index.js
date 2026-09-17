import { ParseServer } from "parse-server"
import _path from "path"
import { fileURLToPath } from "url"
import { dirname } from "path"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Boots the real `parse-server` instance and mounts it onto the given Express `app`.
 * @param {object} props
 * @param {{ parse: Record<string, any> }} props.config - `servableConfig`; only `.parse` is read.
 * @param {() => any} [props.serverCloseComplete] - parse-server's own shutdown hook.
 * @param {import('express').Express} props.app
 * @returns {Promise<any>} the mounted parse-server Express app (`server.app`).
 */
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
      // Was `liveClasses.map(...)` - `liveClasses` was never a defined variable anywhere in this
      // scope (only `parseConfig.liveClasses`, checked one line up), so this line threw a
      // ReferenceError and crashed `beforeMigration()` outright any time `parseConfig.liveClasses`
      // was actually set - the one case this debug log exists for (found via checkJs,
      // lucide/PEAKUB DX initiative).
      parseConfig.liveClasses &&
        console.debug(
          `---------------- ⚡️ ${parseConfig.liveClasses.length
          } live classes ⚡️:\n ${parseConfig.liveClasses.map(a => ` ${a}`)}`
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

    enableInsecureAuthAdapters: false,
    security: {
      enableCheck: true,
      enableCheckLog: false
    },
    // MongoDB connection pool options for idle connection handling
    mongoOptions: parseConfig.mongoOptions || {
      socketKeepaliveEnabled: true,
      socketKeepaliveInactivityMS: 30000,
      maxPoolSize: 50,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      waitQueueTimeoutMS: 10000,
      retryWrites: true,
      retryReads: true,
    },
    schema
  }

  // @ts-expect-error - a real parse-server type-definition quirk, not a bug here: its own
  // types/index.d.ts exports the *named* `ParseServer` (imported here) as a plain callable
  // factory typed `(options) => ParseServer` with no construct signature, while the *default*
  // export is the real `declare class ParseServer` with a proper constructor. `new` on the named
  // export is standard, working parse-server usage regardless - confirmed by reading
  // node_modules/parse-server/types/index.d.ts (found via checkJs, lucide/PEAKUB DX initiative).
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
