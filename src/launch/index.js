import doLaunch from '../doLaunch/index.js'
import engineOptionsFrom from '../options/index.js'
import installTheEnginePatches from '../patches/index.js'
import createIndexes, { adapterResolverFor, startEnsuringTheDeclaredIndexes } from '../indexes/index.js'
import { engineDatabaseOf } from '../stateStore/index.js'
import { PARSE_SCHEMA_MIGRATION_OPTIONS } from '../doLaunch/index.js'
import { installTheMigrationControls, planTheSchemaMigration, recordTheCompletedMigration } from '../schemaMigration/index.js'

// Replaces launchWithMigration/index.js and launchWithNoMigration/index.js - see
// .docs/technical/unischema-plan.md. There is no more migrate/no-migrate branch to choose
// between: every boot passes the full class definitions to Parse Server's own schema option,
// the same way launchWithMigration always did. Parse's own lockSchemas/deleteExtraFields:false/
// recreateModifiedFields:false (doLaunch/index.js) already make this additive-only and
// idempotent - a boot that changes nothing just confirms the existing schema matches, exactly
// like every other boot.
//
// The old split existed because launchWithNoMigration deliberately omitted `definitions`
// entirely, relying on a PRIOR "migrating" boot having already applied the schema Parse now
// keeps. unischema removes that distinction on purpose: server-unischema's own boot-time check
// (launch/start/schemaState/checkSchemaCompatibility.js) already decided, before this function
// is ever called, that this build's schema is safe to apply (drift-checked against the
// committed artifact, floor-checked against the database) - so every boot applies it, not just
// the ones some prior version-comparison decided counted as "a migration."
//
// Once Parse Server has started, and before any of the app's hooks run, the engine installs its
// patches (patches/, each behind its option) and starts making the schema's `ensuredIndexes`
// (indexes/), in the background: never awaited, so an index build never holds the boot (the
// 2026-10-23 outage). Parse itself never sees `ensuredIndexes`: they are not its schema.
//
// Parse's schema migration is skipped when neither the definitions nor the database's schema changed since the last
// migration that completed (schemaMigration/, framework audit 2026-11-23 F4); `isSchemaMigrationForced` runs it anyway.

/**
 * A class definition as Parse Server's schema option takes it: without the engine's own keys.
 * @param {Record<string, any>} classDefinition
 * @returns {Record<string, any>}
 */
export const parseDefinitionOf = ({ ensuredIndexes: _ensuredIndexes, ...parseDefinition }) => parseDefinition

/**
 * @param {object} props
 * @param {any} props.schema - `buildSchema()`'s result.
 * @param {any} props.configuration - `servableConfig.configuration`.
 * @param {any} props.app
 */
export default async ({ schema, configuration, app }) => {
  const { appProtocol, liveClasses } = schema
  const { classes: { all: classes } } = appProtocol.schema
  const definitions = classes.map(parseDefinitionOf)

  const config = {
    ...configuration.config,
    parse: {
      ...configuration.config.parse,
      schema: { definitions },
      liveQuery: {
        ...(configuration.config.liveQuery || {}),
        classNames: liveClasses,
      },
    },
  }

  const engineOptions = engineOptionsFrom({ engineConfiguration: configuration.config.engine })

  const migrationControlsInstallation = installTheMigrationControls()
  const engineDatabase = await engineDatabaseOf({ configuration }).catch(() => null)
  const collectionPrefix = config.parse.collectionPrefix || ''
  const schemaMigrationPlan = await planTheSchemaMigration({
    db: engineDatabase,
    definitions,
    schemaOptions: PARSE_SCHEMA_MIGRATION_OPTIONS,
    collectionPrefix,
    isForced: engineOptions.isSchemaMigrationForced,
    areControlsInstalled: migrationControlsInstallation.isInstalled,
  })
  let hasTheMigrationCompleted = false
  const startedAt = Date.now()
  const server = await doLaunch({
    config,
    app,
    migrationControls: {
      isSkipped: !schemaMigrationPlan.isMigrationRun,
      onCompleted: () => { hasTheMigrationCompleted = true },
    },
  })
  const recording = schemaMigrationPlan.isMigrationRun
    ? await recordTheCompletedMigration({ db: engineDatabase, plan: schemaMigrationPlan, hasCompleted: hasTheMigrationCompleted, collectionPrefix })
    : { isRecorded: false, reason: 'skipped' }
  console.info('[ENGINE] schema migration', {
    decision: schemaMigrationPlan.isMigrationRun ? (hasTheMigrationCompleted ? 'ran' : 'ran, not completed') : 'skipped',
    reason: schemaMigrationPlan.reason,
    isRecorded: recording.isRecorded,
    ...(recording.isRecorded ? { hasChangedNothing: recording.hasChangedNothing } : {}),
    ...(recording.isRecorded || !schemaMigrationPlan.isMigrationRun ? {} : { notRecordedBecause: recording.reason }),
    ...(migrationControlsInstallation.isInstalled ? {} : { controls: migrationControlsInstallation.reason }),
    parseStartMilliseconds: Date.now() - startedAt,
  })

  await installTheEnginePatches({ engineOptions })
  startEnsuringTheDeclaredIndexes({
    indexes: createIndexes({
      resolveAdapter: adapterResolverFor(() => config.parse.appId ?? /** @type {any} */ (globalThis).Parse?.applicationId),
      declaredClasses: () => classes,
    }),
    classes,
    areDeclaredIndexesEnsured: engineOptions.areDeclaredIndexesEnsured,
  })

  Servable.schema = schema
  return { config, server }
}
