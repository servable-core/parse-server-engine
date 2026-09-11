# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For fast copy-paste usage (including the `Servable.App.Transaction` reference implementation), see `QUICKREF.md`.

## What this repo is

`@servable/parse-server-engine` — the concrete Parse Server binding for `@servable/server`'s taxonomy. `createApp()` sets up Express + CORS; `adaptApp()` returns the real `Servable.App.{Object,Query,Cloud,User,Role,File,Installation,LiveQuery,Session,Schema,Config,ACL,Transaction,Route,Jobs}`; `doLaunch()` constructs and starts the actual `ParseServer` instance.

## unischema — `launch()` replaces `launchWithMigration`/`launchWithNoMigration`

See `.docs/technical/unischema-plan.md` (workspace root) for the full plan.

`src/launch/index.js` — one function, one path. Always passes the full class `definitions` (`appProtocol.schema.classes.all`) to Parse Server's own `schema` config option, the same way `launchWithMigration` (deleted) always did.

**Why the old split existed, and why it's gone**: `launchWithNoMigration` (also deleted) deliberately *omitted* `definitions` entirely, relying on a prior "migrating" boot having already applied the schema Parse now keeps cached. `@servable/server`'s own boot-time check (`checkSchemaCompatibility`, see that package's `CLAUDE.md`) now decides, *before* this function is ever called, whether the current build's schema is safe to apply (drift-checked against the committed artifact, floor-checked against the database) — so every boot applies the full schema, not just the ones some prior version-comparison decided counted as "a migration." Parse's own `lockSchemas: true` / `deleteExtraFields: false` / `recreateModifiedFields: false` (`doLaunch/index.js`) already make this additive-only and idempotent — a boot that changes nothing just confirms the existing schema matches, exactly like every other boot.

`src/index.js` exports `launch` where it used to export both `launchWithMigration` and `launchWithNoMigration`. If you're looking for the old files, they no longer exist — this is the whole replacement, not a rename.
