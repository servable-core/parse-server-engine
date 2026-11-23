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

## Engine options, patches and ensured indexes (2026-11-23)

Design note: `docs/engine-options-and-ensured-indexes.md`. In short:
- `src/options/index.js`: the engine's options, `servableConfig.configuration.config.engine.{isFastObjectGetEnabled, isSchemaControllerReuseEnabled, areDeclaredIndexesEnsured}`, each overridden by its environment variable when it says on/off (`PARSE_FAST_OBJECT_GET`, `PARSE_SCHEMA_CONTROLLER_REUSE`, `SERVABLE_ENSURE_DECLARED_INDEXES`).
- `src/patches/`: changes to Parse's own behaviour, installed by `launch` right after `ParseServer.start()`, never failing the boot. A new one comes with its option and a test against the real SDK / Parse Server.
- `src/indexes/`: `Servable.App.Indexes.ensure` and the schema's `ensuredIndexes`, made after boot one at a time, never awaited, never dropped, through Parse's MongoDB adapter with Parse's own options (so an index Parse made before is found identical). `launch` strips `ensuredIndexes` from what Parse Server receives.
- Tests: `tests/unit/{fastObjectGet,reuseSchemaController,enginePatches,indexes}.test.js`; against a real MongoDB (scratch, 27018): `tests/integration/{indexes,launch}.test.js`. The launch test mounts Parse Server on an Express app that never listens.

## Route cache, cache bypass and session lookups (2026-11-23, audit F3/F7/F8/F9, owner's Q1092 a, Q1094 a, Q1095 a)

- **Route cache** (`src/register/route/cache/`, both stores share `cache/lib/`): only a success is kept (status 200-299 and not marked by `processHttp` as an error answer: Parse codes such as 209 are in the 200s), with its status, Content-Type and the body as sent, once (`cachedAnswer.js`; Redis entries `SRC2 <header>\n<body>`, older entries are misses, never replayed). A window that is not a positive number keeps nothing. Keys never hold a session token: `userExists` keys end with `sha256(token)` cut to 32 hex (`hashSessionToken.js`).
- **Bypass** (`cache/lib/bypass.js`): `x-servable-reset-cache` is honoured only when it carries the engine option `routeCacheBypassSecret` (env `SERVABLE_CACHE_BYPASS_SECRET`, at least 16 characters, compared in constant time); in-process code sets `request.shouldBypassTheRouteCache = true` instead. Any other header value is ignored, silently. A bypass skips the read and the write.
- **Parse's own cache keys**: `setConfigurations/adapters/sessionKeyHashing.js` subclasses Parse's `RedisCacheAdapter` so `<appId>:user:<token>` keys hold the digest.
- **`_Session._session_token_1`**: declared by the engine itself (`src/indexes/engineOwnedIndexes.js`), unique and sparse, made after boot with the schema's `ensuredIndexes` (same switch); not in any app's artifact.
- **`Servable.App.SessionInvalidations`** (`src/sessionInvalidations/`): reports `{ sessionToken | sessionId | userId | isEverything }` from Parse's `cacheController.user.del` and from `DatabaseController.update/destroy` of `_User`/`_Session`, installed on the first `subscribe` (after Parse has started). No Parse trigger is used (Parse keeps one per class and operation, Servable's protocols own them, `_Session` accepts none). @servable/server's session-user cache listens to it.
- Tests: `tests/unit/{routeCache,sessionKeyHashing,engineOwnedIndexes}.test.js`; real MongoDB/Redis (scratch): `tests/integration/{sessionLookup,routeCacheRedis}.test.js` (`SERVABLE_TEST_REDIS_URI`, default `redis://127.0.0.1:6380`).

## Schema migration skip and lazy fetch snapshot (2026-11-23, audit F4/F6, owner's Q1093 a, Q1096 a)

- **Schema migration at boot** (`src/schemaMigration/`, wired in `src/launch/index.js` and `src/doLaunch/index.js`): Parse's `DefinedSchemas` is skipped when the last completed run changed nothing in `_SCHEMA` and both the definitions' hash (definitions as Parse gets them + the migration options of `doLaunch`'s `PARSE_SCHEMA_MIGRATION_OPTIONS` + Parse Server's version) and `_SCHEMA`'s hash are unchanged. Recorded in `servable_parse_schema_states` (key `parse-definitions`) only after a run that reached `enforceCLPForNonProvidedClass` (Parse logs failures and carries on outside production). Hooks on `DefinedSchemas.prototype.{execute, enforceCLPForNonProvidedClass}`, keyed by the schema options object through a WeakMap (an extra key in Parse's options is logged as invalid). `isSchemaMigrationForced` / `SERVABLE_FORCE_SCHEMA_MIGRATION` runs it anyway. Parse's own start still rewrites each class's `_metadata.indexes` identically (no change). Upstream draft: `docs/upstream-parse-server-defined-schemas.md`.
- **Lazy fetch snapshot** (`src/patches/lazyFetchSnapshot.js`, `isLazyFetchSnapshotEnabled` / `PARSE_LAZY_FETCH_SNAPSHOT`, off): the SDK's `objectCache` string of a query result's object field is computed from the private raw JSON the first time the cache is read, only for raw values `decode` turns into fresh plain values, in unique-instance mode. Wraps `QueryController.find`, `ParseObject.fromJSON`, `ParseObject.prototype._finishFetch` and the state controller's commit (re-wrapped through `CoreManager.setObjectStateController`); a state with pending snapshots gets an `objectCache` accessor that computes them before anyone reads the cache (so `get`/`toJSON` stay lazy, a dirty check or save computes them). Its header lists why the string is the SDK's own. Cost: about 26% less to build a query result, about twice the snapshot cost later on objects that are dirty-checked (decode + encode).
- Tests: `tests/unit/{schemaMigration,lazyFetchSnapshot}.test.js`; real MongoDB (scratch): `tests/integration/{schemaMigration,emptyTriggers}.test.js` (boots in child processes, `tests/integration/fixtures/bootOnce.mjs`; backend/main's committed `servable.schema.json` read when present). `emptyTriggers` pins what an empty Parse trigger changes (the server's trigger plan registers none where nothing runs).

## Typed route parameters (2026-11-23, owner's Q1230 a, Q1375 a)

Design note: `docs/typed-route-parameters.md`. In short:
- A route that declares `schema.queryString` (`id: 'string'`, `ids: 'string[]'`, `{ type: 'integer', default: 10, minimum: 1 }`, `'*': 'guessed'`…) gets each parameter read as that type, once, before its handler (`src/register/route/parameters/`: `declaration.js` compiles at define time and logs what it cannot read, never failing the boot; `coercion.js` reads; `index.js` builds the per-route reader called first by `process/http.js` and `verbs/function/processFunction.js`). A value that cannot be read, or a required one missing, is a 400 naming every parameter at fault. Opt-in per route: a route without `schema.queryString` reads exactly as before.
- Options: `isQueryValueGuessingEnabled` (`SERVABLE_QUERY_VALUE_GUESSING`, on: undeclared values guessed as before, also what Express's `request.query` holds, `createapp/index.js`; off: text as sent), `areDeclaredRouteParametersTyped` (`SERVABLE_TYPED_ROUTE_PARAMETERS`, on; the kill switch), `areUndeclaredParameterRoutesRefused` (`SERVABLE_REFUSE_UNDECLARED_PARAMETER_ROUTES`, off; with guessing off, an undeclared route that seems to read its parameters throws at define).
- Boot report: `parameters/bootReport.js`, one summary line once definitions pause; `Servable.App.Route.undeclaredParameterRoutes()`.
- Tests: `tests/unit/routeParameters.test.js` (every type, defaults, refusals, the guess proven equal to the former parser by a property test); `tests/integration/typedRouteParameters.test.js` (the real Express app, `Route.define`, processHttp and the function verb over HTTP, guessing on and off, the refusal option; no other service).
