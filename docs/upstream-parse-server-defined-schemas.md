# Draft: Parse Server issue and pull request, schema migration at boot is O(classes²)

Draft only, 2026-11-23, written from parse-server 8.2.2 (`lib/SchemaMigrations/DefinedSchemas.js`,
`lib/Routers/SchemasRouter.js`). Not submitted. Until something like it is released, the engine skips the migration
itself when nothing changed (`src/schemaMigration/`, framework audit 2026-11-23 F4).

---

## Issue

### Title

Defined schemas: every boot rewrites every class and reloads all schemas after each write, even when nothing changed

### Description

With `schema.definitions` set, `DefinedSchemas.executeMigrations()` runs `saveOrUpdate()` for every class at once
(`Promise.all`). For a class that already exists, `updateSchema()` always ends with `updateSchemaToDB()`, whether or not
a field, an index or a class-level permission differs: `handleCLP()` always sets a CLP, so there is always something to
write. Each `updateSchemaToDB()` calls `internalUpdateSchema()`, which starts with
`config.database.loadSchema({ clearCache: true })`: a full read of `_SCHEMA`. With N classes, a boot where nothing
changed makes about N writes and N full reads of N documents.

Measured on a real app with 176 classes (MongoDB 8.2, parse-server 8.2.2, profiler on), a boot whose definitions and
database were both unchanged:

| | `_SCHEMA` writes | `_SCHEMA` full reads | documents read | time before the server is ready |
| --- | --- | --- | --- | --- |
| idle machine | 380 | 350 | 61,825 | 4.3 s |
| loaded machine | | | | 8.8 to 11.6 s |

A CPU profile of that boot shows BSON decoding (16.5%), `injectDefaultSchema` (12.9%) and `mongoSchemaToParseSchema`
(3%+) on top: the reloads, not the writes. The time grows with the square of the number of classes and lands entirely
before readiness, so it lengthens every rolling deploy.

A second quirk: on an empty database the first run does not reach a stable `_SCHEMA`. The second run adds the
`_id_` index to `_metadata.indexes` of every class the first run created; only the third run changes nothing.

### Steps to reproduce

1. Define 150+ classes in `schema.definitions` (fields, indexes, CLPs).
2. Start Parse Server once, stop it.
3. Turn MongoDB's profiler on (`db.setProfilingLevel(2)`), start Parse Server again with the same definitions.
4. Count `_SCHEMA` operations in `system.profile`: about one update and one full read per class.

### Expected

A boot with unchanged definitions and an unchanged database writes nothing to `_SCHEMA` and reads it a bounded number
of times (once).

---

## Pull request

### Title

perf(DefinedSchemas): skip unchanged classes and load the schema once per migration

### Changes

1. **Do not write a class that has nothing to change.** In `updateSchema()`, after the fields, indexes and CLP have
   been computed, call `updateSchemaToDB()` only when `newLocalSchema` holds a field or index operation, or when the
   CLP to write differs from the cloud one. The CLP comparison has to use what `handleCLP()` writes
   (`{ ...localSchema.classLevelPermissions, addField: {} }`) against `cloudSchema.classLevelPermissions`, deep and
   key-order independent (`paramsAreEquals` is shallow and would always differ on nested permission maps).
2. **Load the schema once.** `internalUpdateSchema()` and `internalCreateSchema()` take an optional schema controller;
   `executeMigrations()` loads one with `clearCache: true` at the start (it already does, for `getAllClasses()`) and
   passes it down, so a write updates that controller's cached data instead of re-reading `_SCHEMA` (as
   `SchemaController.updateClass` already does through `reloadData` for its own instance). The cache is cleared once,
   after the migration.
3. **Converge in one run.** When a class is created by the migration, record the `_id_` index in its
   `_metadata.indexes` at creation, as the next run would, so a second run changes nothing.
4. Optional: bound the concurrency of `saveOrUpdate()` (for example 8 at a time). With 1 and 2 the cost is linear, and
   unbounded concurrency only adds lock contention on `_SCHEMA`.

### Tests

- A spec with 50 classes defined: start once, then start again with the profiler on (or a spy on the storage
  adapter's `updateClass`/`setClassLevelPermissions`/`getAllClasses`): the second start makes 0 schema writes and at
  most one full `_SCHEMA` read.
- A changed field, index or CLP on one class: exactly that class is written.
- A CLP opened by hand in `_SCHEMA` (for example `addField: { '*': true }`): the next start writes it back.
- On an empty database, a first start followed by a second: the second makes 0 writes.

### Compatibility

No change of behaviour beyond the writes that changed nothing: the same final `_SCHEMA` for every input (the specs
above compare `_SCHEMA` after the current and the new migration on the same inputs).
