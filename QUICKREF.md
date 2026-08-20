# @servable/parse-server-engine — Quick Reference

## Transactions

Concrete implementation of the `Servable.App.Transaction` contract defined in `@servable/server` (see that package's `QUICKREF.md` for the taxonomy this conforms to). Real MongoDB-session-backed atomicity - not a custom shim - via `Parse.Object.saveAll()`/`destroyAll()` with `{ transaction: true }`, which parse-server wraps in `DatabaseController.createTransactionalSession()` (backed by `MongoStorageAdapter`'s real `session.startTransaction()`). Requires the backing MongoDB to be a replica set to actually commit.

Source: `src/register/transaction/index.js`. Tests: `tests/unit/transaction.test.js` (12 tests, spies on the real `Parse.Object.saveAll`/`destroyAll` to assert the exact deferred-then-batched behavior - not just asserting against this package's own mocks).

### Usage

```js
const tx = new Servable.App.Transaction({ useMasterKey: true })

const a = new Servable.App.Object('SomeClass')
a.set('field', 1)
await a.save(null, { transaction: tx })   // deferred - no network call yet

const b = new Servable.App.Object('SomeClass')
b.set('field', 2)
await b.save(null, { transaction: tx })   // also deferred

await tx.commit()   // NOW one real, atomic saveAll([a, b], { useMasterKey: true, transaction: true }) fires
```

Same pattern for destroys via `.destroy({ transaction: tx })`, and for arrays via `Parse.Object.saveAll(objects, { transaction: tx })` / `destroyAll(objects, { transaction: tx })`.

**v1 scope: one write kind per transaction** (all saves, or all destroys - never both). Queuing a destroy on a transaction that already has a queued save (or vice versa) throws immediately, as a rejected promise:

```js
await a.save(null, { transaction: tx })
await b.destroy({ transaction: tx })
// -> rejects: "Servable transactions only support one write kind per
//    transaction (all saves, or all destroys) - this transaction already
//    has queued saves, cannot also queue a destroy."
```

### How the deferral works

`patchParseWrites()` (called once, idempotently, the first time an engine `Transaction` class is constructed) wraps `Parse.Object.prototype.save`, `.destroy`, `Parse.Object.saveAll`, and `.destroyAll`. Each wrapped method checks whether `options.transaction` is a live `Transaction` instance (`ParseEngineTransaction.isTransaction(value)`, a private marker check, not `instanceof`):

- **Not a transaction** (the option is absent, `true`, or anything else): falls straight through to the original method - completely unaffected, this is why a `commit()`'s own internal `Parse.Object.saveAll(pending, { transaction: true })` call (note: `true`, not a Transaction instance) correctly reaches the *real* `saveAll` instead of recursing into deferral.
- **Is a transaction**: the write is registered on the transaction (`enqueueSave`/`enqueueDestroy`) and the call returns immediately (`Promise.resolve(this)`) with no network I/O. `attrs` passed to `.save(attrs, options)` are still applied via `this.set(attrs)` synchronously, so the object's local state is correct even though the real save hasn't happened - just don't read anything server-computed (a fresh `objectId`, `createdAt`, etc.) off that object before `commit()` resolves, since the server hasn't assigned it yet.

### `useMasterKey`

Set once on the `Transaction` constructor - `commit()` applies the transaction's own `_options` (not each individual call's options) to the single real `saveAll`/`destroyAll` call. Don't pass `useMasterKey` on the individual `.save()`/`.destroy()` calls inside a transaction; it's a no-op there since only the token (`options.transaction`) is read from them.

### Standalone-MongoDB fallback

Real atomicity requires the backing MongoDB to be a **replica set** - Parse Server's transactional `/batch` uses a real `session.startTransaction()` under the hood, and a standalone `mongod` rejects that at the first write. When it does, that failure reaches `commit()` as a **generically-sanitized** Parse error (`{"code":1,"message":"Internal server error."}` - parse-server deliberately doesn't leak internal error text over the wire), so it's not reliably distinguishable from any other unrelated commit failure by error code/message alone.

Because of that, `commit()` doesn't try to sniff the error. On any batch-commit failure it calls `isConfirmedStandaloneMongo()` (`src/register/transaction/detectReplicaSet.js`), which connects directly with the `mongodb` driver to `process.env.ENGINE_DATABASE_URI` and checks `hello().setName` - present only on a replica set member. The result is cached for the process lifetime (topology doesn't change without a restart).

- **Standalone confirmed**: logs a `console.warn` and falls back to sending each queued write individually via the same patched `.save()`/`.destroy()` methods (called without a `transaction` option, so they route to the real, immediate write) - non-atomic, but doesn't hard-fail. The commit outcome's `mode` becomes `'sequential-fallback'` instead of `'deferred-batch-transaction'`.
- **Replica set confirmed, or the check itself couldn't run** (e.g. `ENGINE_DATABASE_URI` unset, connection error): the original commit error is rethrown unchanged. This is the safe default - it only masks a failure as "just no replica set" when that's actually confirmed, never on ambiguity, so a real validation/permission/data error during a genuine transaction is never silently swallowed.

```js
const outcome = await tx.commit()
// outcome.mode === 'sequential-fallback' means this commit's writes landed,
// but NOT atomically - a partial-failure mid-batch would leave some written
// and some not. Check this if callers need to know.
```

Verified against a real standalone MongoDB and a real parse-server instance (not just mocks): the transaction commits, the warning logs, and every object lands in the database via the fallback path. Fix for production is migrating MongoDB to a replica set, not code - this fallback exists to keep writes working during that migration gap.

## Roadmap

- **Mixed-kind transactions** (save + destroy together) - would need a lower-level combined `/batch` request builder (mixing `POST`/`PUT`/`DELETE` sub-requests in one call) instead of the `saveAll`/`destroyAll` split this v1 is built on. Not started.
- See `@servable/server`'s `QUICKREF.md` for the taxonomy-level roadmap (this engine is the reference implementation other engines would be compared against).
