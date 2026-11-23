// One boot of the engine's launch, in a process of its own (Parse Server keeps its schema cache in the module, so two
// boots in one process would not read the database the second time). Used by schemaMigration.test.js.
//
//   SCHEMA_MIGRATION_TEST_DATABASE_URI  the scratch database
//   SCHEMA_MIGRATION_TEST_CLASSES       a JSON file: the class definitions (servable.schema.json's `classes` shape)
//   SERVABLE_FORCE_SCHEMA_MIGRATION     read by the engine's options, as in production
//
// Prints one line, `BOOT_RESULT <json>`: the engine's schema migration log and how long the launch took.
import fs from 'fs'
import express from 'express'
import launch from '../../../src/launch/index.js'

const databaseURI = process.env.SCHEMA_MIGRATION_TEST_DATABASE_URI
const classes = JSON.parse(fs.readFileSync(process.env.SCHEMA_MIGRATION_TEST_CLASSES, 'utf8'))

let migrationLog = null
const info = console.info
console.info = (...parts) => {
  if (parts[0] === '[ENGINE] schema migration') {
    migrationLog = parts[1]
  }
}
console.log = () => {}
console.debug = () => {}
globalThis.Servable = {}

const configuration = {
  config: {
    parse: { appId: 'schema-migration-test', masterKey: 'schema-migration-test-master-key', databaseURI, serverURL: 'http://127.0.0.1:1/parse', mountPath: '/parse', verbose: 'error', silent: true, logLevel: 'error' },
    engine: { areDeclaredIndexesEnsured: false },
  },
}
const startedAt = process.hrtime.bigint()
await launch({ schema: { appProtocol: { schema: { classes: { all: classes } } }, liveClasses: [] }, configuration, app: express() })
const launchMilliseconds = Number(process.hrtime.bigint() - startedAt) / 1e6
info(`BOOT_RESULT ${JSON.stringify({ ...migrationLog, launchMilliseconds })}`)
// Parse Server keeps its connections and timers open: this throwaway process ends here, on purpose.
// eslint-disable-next-line n/no-process-exit
process.exit(0)
