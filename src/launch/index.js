import doLaunch from '../doLaunch/index.js'

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
export default async ({ schema, configuration, app }) => {
  const { appProtocol, liveClasses } = schema
  const { classes: { all: definitions } } = appProtocol.schema

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

  const server = await doLaunch({ config, app })

  Servable.schema = schema
  return { config, server }
}
