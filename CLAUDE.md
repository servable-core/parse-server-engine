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

## State store (utilless) — Servable's boot bookkeeping lives in Parse's own MongoDB

PEAKUB-321. `@servable/server` no longer talks to a separate "utils" MongoDB. It defines a state-store contract (`src/lib/stateStore/index.js` in that package) and calls `engine.createStateStore({ servableConfig })` during boot; this engine implements it in `src/stateStore/`.

- **Where**: plain collections in the engine database (`servableConfig.envs.databaseURI` → parse config → `ENGINE_DATABASE_URI`, same order as `register/transaction/detectReplicaSet.js`): `servable_schema_states` (compatibility floor), `servable_seed_states`, `servable_config_states` (hash-skip records). Backed up and restored together with the data they describe — the reason for the move.
- **Not Parse classes, on purpose**: a class would sit inside the schema the floor guards and the drift check covers, show up in the dashboard/REST, and pick up protocol triggers. Parse ignores collections that aren't in `_SCHEMA`; the `servable_` prefix stays clear of Parse's `_`-prefixed system classes.
- **Own `MongoClient`** (one per URI, process lifetime), not Parse's adapter: the floor check runs before `launch()`, when no `ParseServer` exists yet.
- **`schemaState.recordApplied` is one aggregation-pipeline `findOneAndUpdate` with `$max`** — never a read-then-write (that shape regressed an already-raised floor under interleaved pods; see `@servable/server`'s CLAUDE.md). Artifact hashes go through `$literal`.
- **Unique indexes** (`key`; `type`+`entityId`) plus one retry on `E11000`, so pods upserting a brand-new record at the same time end with one document.
- **`unwrap()`** accepts both mongodb 4.x `ModifyResult` and 6.x document results from `findOneAndUpdate`, so a driver bump doesn't silently break read-backs.
- **Not a lock**: `bootState` is bookkeeping; nothing here excludes concurrent pods.

**This package has no notion of the old utils database — deliberately.** No import code, no `SERVABLE_UTILS_DATABASE_URI`, no extra env var: the store reads and writes the engine database and nothing else. An engine database with no state yet is a legitimate starting point (the floor defaults to 0, and the first boot simply re-runs the hash-skip passes for seeds and configs). Boot-time data migration is precisely what unischema removed; don't add any back here.

Apps that ran an older `@servable/server` and still have state in a separate utils database copy it across once with a throwaway script of their own (for peakub: `peakub/scripts`' `project/servable-migrate-utils-state`, run in development and production — PEAKUB-325), not with anything shipped in this package. Such a copy is optional rather than a correctness prerequisite: seeded rows are matched by `uniqueRef` (a content hash when a seed defines no `ref.js`) and left untouched when unchanged, and `ServableConfig` is fetched by `protocolId` with the same hash early-return, so a first boot against an empty store re-checks that state instead of duplicating it.

`setConfigurations/adapt.js` no longer builds `configuration.lock` (its only content was the utils URI). The unused `agenda` dependency was removed; `Servable.App.Jobs` uses `@hokify/agenda` against the engine database (`configuration.config.parse.databaseURI`), unrelated to the utils database.

Tests: `tests/unit/stateStore.test.js` (URI resolution, fail-closed import, no MongoDB) and `tests/integration/stateStore.test.js` (real MongoDB: floor never lowers under interleaved/concurrent writers, boot-state upserts, import idempotency and precedence). The integration test uses `SERVABLE_TEST_DATABASE_URI`, defaulting to a scratch MongoDB on `127.0.0.1:27018` (`root`/`DATABASE_PASSWORD_TO_CHANGE`), and skips when none is reachable — start a throwaway `mongo:7.0` for it rather than pointing it at a shared dev database.
