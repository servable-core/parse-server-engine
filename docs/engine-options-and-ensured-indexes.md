# Engine options and ensured indexes

Design note, 2026-11-23. It records why the Parse patches and the index makers that backend/main used to carry now live
in this engine (and in `@servable/tools` for the declarations), and what the alternatives were. The owner decided the move
as Q1151 a: the app does not know its engine.

## What moved, and where

| Was in backend/main | Is now |
| --- | --- |
| `app/lib/parse/fastObjectGet.js` (+ its property spec) | `src/patches/fastObjectGet.js`, option `isFastObjectGetEnabled` (env `PARSE_FAST_OBJECT_GET`), off by default; `tests/unit/fastObjectGet.test.js` |
| `app/lib/parse/reuseSchemaController.js` (+ spec) | `src/patches/reuseSchemaController.js`, option `isSchemaControllerReuseEnabled` (env `PARSE_SCHEMA_CONTROLLER_REUSE`), on by default; `tests/unit/reuseSchemaController.test.js` |
| six index makers reaching `parse-server/lib/Config.js` | `ensuredIndexes` declared in the schema.json files, made by `src/indexes/` after boot; `Servable.App.Indexes.ensure` for the indexes that only exist at run time |

## 1. The patches are engine behaviour, switched by options

Both patches change how Parse itself behaves, whatever the app. They belong to the engine and are installed by
`src/launch/index.js` right after `ParseServer.start()`, before any of the app's hooks run (earlier than backend/main's
`afterInit` used to install them, so seeds and configs already run with them).

- No new API at the call sites. The fast get is proven identical to the SDK's `get` by a property test: five fixed seeds
  of 2000 runs, plus a free one, over random objects and pending states.
- Options sit in `servableConfig.configuration.config.engine` (`src/options/index.js`). The defaults are the ones
  backend/main had: the fast get off and the reuse on. The environment variable kept its name. When it says `1/true/on` or
  `0/false/off` it overrides the app's choice, so production can be flipped from gitops without a release. Anything else
  in it is ignored.
- A patch that cannot be installed leaves Parse as it is and logs why. It never fails the boot.

## 2. Indexes: declared in the schema, made by the engine in the background

The indexes are a unique key per claim, referral, scan and reward; a repo cursor with `objectId`; pointer columns; and
dotted paths into objects. Parse's schema `indexes` cannot express them. It has no unique or partial indexes, and it
refuses `_id`, dotted paths and pointer keys under their own names. Parse also makes these indexes before the server
listens, and on 2026-10-23 an `_id` key refused there kept backend/main from booting.

### Options considered

1. **An engine service the app calls at boot** (`Servable.App.Indexes.ensure(...)`, imperative). It is simple, but every
   protocol and the app write boot code for what is static data. The indexes would also stay invisible to
   `servable schema build/plan`, the artifact and its drift check, as they were before.
2. **Extend `indexes` itself** with options. Parse receives `indexes` as they are, so the engine would have to split one
   key into two kinds at launch. A reader of a schema.json could not tell which entries Parse makes before listening and
   which it never sees.
3. **A sibling key, `ensuredIndexes`, beside `indexes`** (chosen). It is declarative and engine-agnostic, and it uses the
   same places as `indexes`: `managed.classes[].ensuredIndexes` for a protocol's own classes and
   `target.ensuredIndexes` for every class it is attached to. A protocol therefore never names another's class. The
   declarations ride into the compiled artifact, so `schema plan` lists them (added is safe; removed or changed is
   breaking) and the boot's drift check covers them. Parse never sees them: `launch` strips them from the definitions.

The service still exists, as the primitive the declarations are made through (`Servable.App.Indexes.ensure`, with a
fallback contract in `@servable/server` so the name is never undefined). It is for indexes whose existence is only
known at run time: PublishableObjectIn's `targetPointer<Type>` columns, one per class of the app, asked by the
publishable protocol for the classes the app names (Q1106 a).

The framework performance audit of 2026-11-23 proposed declaring what Parse can declare and keeping a service for dotted
paths. Here dotted paths are declarable too. The audit's reason for a separate path was that Parse refuses them in
`indexes`, and `ensuredIndexes` never go through Parse's schema.

### The declaration

```json
"ensuredIndexes": {
  "key_1":         { "keys": { "key": 1 }, "isUnique": true },
  "_repo_cursor_": { "keys": { "repoId": 1, "repoType": 1, "objectId": 1 } },
  "_live_code_":   { "keys": { "code": 1 }, "isUnique": true, "partialFilter": { "status": { "$eq": "live" } } },
  "_targetPointerArticle_": { "keys": { "targetPointerArticle": 1 }, "fieldTypes": { "targetPointerArticle": { "type": "Pointer", "targetClass": "Article" } } }
}
```

- The map key is the index's name in the database. Indexes backend/main made through Parse's `ensureUniqueness` had no
  name, so MongoDB named them `key_1`; they are declared under that name.
- `keys` are fields as the app names them: `objectId`, `createdAt`, a pointer by its own name, or a dotted path. The
  engine maps them with Parse's own `transformKey` (`_id`, `_created_at`, `_p_owner`), typing a pointer from the class's
  fields or from `fieldTypes`.
- The options are Parse's own: built in the background and sparse by default, so a row without the field is not in
  the index. `isSparse: false` turns sparse off, and so does a `partialFilter`; MongoDB refuses an index that is both.
  An index made from the same declaration is therefore identical to the one Parse's adapter made before the move, and
  MongoDB leaves it as it is. Two kinds of test prove this. `tests/unit/indexes.test.js` compares every one of
  backend/main's former calls with its declaration through Parse's real adapter. `tests/integration/indexes.test.js`
  checks a real MongoDB: the old index is found identical, nothing is added and nothing is refused.

### At boot

`startEnsuringTheDeclaredIndexes` is called once Parse Server has started and is never awaited. It makes one index at a
time and writes one summary line. Each index that is not made is logged with MongoDB's reason: a name or keys already
taken by another index (codes 85 and 86), or duplicates under a unique index (11000). A failure never stops the next
index. Nothing is ever dropped: a removed declaration leaves its index in the database until someone drops it on purpose.
`areDeclaredIndexesEnsured` (env `SERVABLE_ENSURE_DECLARED_INDEXES`) switches the whole step off, for an index build
that hurts production.

### `@servable/tools`

The loaders read `target.ensuredIndexes`, and the class merge carries them like `indexes`. The artifact holds
`ensuredIndexes` only for a class that declares some, so an app that declares none keeps its exact hash; this was
checked on backend/main's real tree. `compileArtifact` (the CLI's path) refuses malformed declarations, so
`schema build/plan` stops before a commit. The boot never does: the engine logs a bad declaration and carries on. `plan`
compares the order of an index's keys, because the order is part of the index.

**Release coupling:** the server's drift check at boot and the CLI must use the same `@servable/tools`. An app that
declares `ensuredIndexes` needs every copy of tools at or above the release that knows them. backend/main pins this with
a `resolutions` entry. If an older copy computes the hash, it drops the declarations and the boot refuses the drift.

## Not done here, on purpose

- No index is ever dropped, and there is no `schema contract` path for ensured indexes yet.
- No storage other than MongoDB. The Postgres adapter answers "not MongoDB's" and the index is logged as not made.
- No option of the audit's other findings (F1 to F13) is implemented: they wait on the owner's answers.
