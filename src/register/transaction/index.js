// Implements the Servable.App.Transaction taxonomy (see
// @servable/server's server/src/domain/servable/transaction/index.js for
// the contract) using Parse Server's own real transaction mechanism:
// Parse.Object.saveAll()/destroyAll() with { transaction: true } send one
// POST /batch request that parse-server wraps in a real MongoDB session
// (Controllers/DatabaseController.js createTransactionalSession(), backed
// by MongoStorageAdapter's session.startTransaction() - requires MongoDB
// to be a replica set, same as any Mongo transaction). parse-server also
// retries the whole batch automatically on write-conflict (error code
// 251). None of that is reimplemented here - this class only defers
// individual save()/destroy() calls until commit(), then sends them as one
// real saveAll()/destroyAll() call so they actually get that atomicity.
//
// v1 scope (see the taxonomy doc): one write kind per transaction. Queuing
// both a save and a destroy on the same transaction throws immediately,
// rather than silently running them as two separate non-atomic operations.
//
// Standalone-MongoDB fallback: if the real batch commit fails, isConfirmedStandaloneMongo()
// checks the actual topology (not the error - see that file for why the error
// alone can't be trusted to mean "not a replica set": the same underlying
// standalone-Mongo failure has been observed to reach callers both as a
// generic { code: 1, message: "Internal server error." } (parse-server
// reporting a per-item error inside an otherwise-200 /batch response) and as
// a Parse SDK-mangled { code: 111, message: undefined } (Parse.Object.saveAll
// rewrites ANY /batch request failure to ParseError.INCORRECT_TYPE client-side,
// see parse/lib/node/ParseObject.js - it discards the real code entirely).
// Neither shape is a reliable signal on its own). Only when standalone is
// *confirmed* does commit() fall back to sending each queued write
// individually (the old, non-atomic behavior) instead of failing - any other
// commit failure (a real validation/permission/data error) is rethrown
// unchanged, never masked as "just no replica set".
import isConfirmedStandaloneMongo from './detectReplicaSet.js'

// Parse pushes a new pending-ops layer onto every object in a batch when that batch
// starts, and balances it when the response is handled - popPendingState on success,
// mergeFirstPendingState on a per-item error. But when the /batch HTTP request itself
// rejects (rather than returning 200 with per-item errors), Parse rejects `batchReturned`
// and every object's task is a `.then(onFulfilled)` with NO rejection handler - so
// neither runs, and the pushed layer is never balanced. See parse/lib/node/ParseObject.js
// (_deepSave's batch path).
//
// A leaked layer silently destroys every later write to that instance: `save()` sends
// pendingOps[0] - now an empty layer - while anything newly set sits in a later layer that
// is never reached. The save RESOLVES, reports success, writes nothing, and the keys stay
// dirty forever, because each subsequent save shifts one layer and pushes another so the
// depth never recovers. Confirmed live against a standalone Mongo: after one failed
// transactional batch, two fields set on that instance were still dirty after a successful
// save() and absent from the database.
//
// Depth is measured before the batch and restored after a failure rather than
// unconditionally merging once, because the two failure modes differ: a 200-with-per-item-
// errors response DOES balance itself (Parse calls _handleSaveError), and merging again
// would collapse a layer that is legitimately in use. Comparing depths handles both.
const stateControllerOr = (fallback) => {
  try {
    return Parse.CoreManager.getObjectStateController() || fallback
  } catch (e) {
    return fallback
  }
}

const pendingDepths = (objects) => {
  const stateController = stateControllerOr(null)
  if (!stateController || typeof stateController.getPendingOps !== 'function') {
    return null
  }
  try {
    return objects.map(object => stateController.getPendingOps(object._getStateIdentifier()).length)
  } catch (e) {
    return null
  }
}

const restorePendingDepths = (objects, depths) => {
  if (!depths) {
    return
  }
  const stateController = stateControllerOr(null)
  if (!stateController || typeof stateController.mergeFirstPendingState !== 'function') {
    return
  }

  objects.forEach((object, index) => {
    try {
      const identifier = object._getStateIdentifier()
      // mergeFirstPendingState shifts the oldest layer and merges it into the next one, so
      // it lowers the depth by one WITHOUT discarding operations - the queued writes stay
      // intact for the sequential fallback (or for the caller, if the error is rethrown).
      let depth = stateController.getPendingOps(identifier).length
      while (depth > depths[index]) {
        stateController.mergeFirstPendingState(identifier)
        const next = stateController.getPendingOps(identifier).length
        if (next >= depth) {
          break
        }
        depth = next
      }
    } catch (e) {
      console.error('[Servable Transaction] could not restore pending-ops depth', e.message)
    }
  })
}


const TX_MARKER = '__servableTransactionMarker'

// Mirrors parse/lib/node/arrayContainsObject.js - reference identity, OR the same class
// and the same id. Deliberately the same rule Parse.Object.saveAll() applies (via its own
// unique() call) when it builds a batch: the whole point of the sequential fallback is to
// behave like the atomic path it stands in for, so it has to collapse exactly the same
// duplicates. _getId() falls back to a per-instance localId for unsaved objects, so two
// distinct new objects never collide here.
const alreadyQueued = (queued, object) => {
  if (queued.indexOf(object) > -1) {
    return true
  }
  return queued.some(
    candidate =>
      candidate.className === object.className &&
      candidate._getId &&
      object._getId &&
      candidate._getId() === object._getId()
  )
}

class ParseEngineTransaction {
  // Declared on the base class (unset here) so `_commitBatch`'s `this.constructor` access below
  // type-checks - the real value only ever exists on the anonymous per-`servableConfig` subclass
  // this file's default export returns (`class extends ParseEngineTransaction { static
  // _servableConfig = servableConfig }`), which every real instance is actually constructed from.
  /** @type {Record<string, any> | undefined} */
  static _servableConfig = undefined

  _state = 'open'
  _token = null
  _options = {}
  _writes = 0
  _pending = { save: [], destroy: [] }
  _mode = 'deferred-batch-transaction'

  static isTransaction(value) {
    return Boolean(value && value[TX_MARKER] === true)
  }

  get state() {
    return this._state
  }

  get token() {
    return this._token
  }

  get writes() {
    return this._writes
  }

  get options() {
    return this._options
  }

  get mode() {
    return this._mode
  }

  constructor(options = {}) {
    this._options = { ...options }
    this._token = options.token
      ? `${options.token}`
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    this._pending = { save: [], destroy: [] }
    this[TX_MARKER] = true
  }

  _assertOpen() {
    if (this._state !== 'open') {
      throw new Error(`Transaction is already ${this._state}`)
    }
  }

  _assertSingleKind(kind) {
    const other = kind === 'save' ? 'destroy' : 'save'
    if (this._pending[other].length) {
      throw new Error(
        `Servable transactions only support one write kind per transaction (all saves, or all destroys) - this transaction already has queued ${other}s, cannot also queue a ${kind}.`
      )
    }
  }

  /** @param {{ context?: Record<string, any>, [key: string]: any }} [options] */
  toWriteOptions(options = {}) {
    this._assertOpen()
    const _options = options && typeof options === 'object' ? options : {}

    return {
      ..._options,
      context: {
        ...(_options.context || {}),
        servableTransactionToken: this._token
      },
      transaction: true
    }
  }

  enqueueSave(objects) {
    this._assertOpen()
    this._assertSingleKind('save')
    this._enqueue('save', objects)
  }

  enqueueDestroy(objects) {
    this._assertOpen()
    this._assertSingleKind('destroy')
    this._enqueue('destroy', objects)
  }

  // Queuing the same object twice in one transaction expresses ONE write, not two:
  // everything set() between the two calls accumulates on that same instance and goes out
  // with the single commit either way. Keeping both copies only costs a redundant round
  // trip in the sequential fallback - and fires that object's afterSave trigger twice for
  // one logical change, which is a behaviour difference against the atomic path rather
  // than merely wasted work (Parse.Object.saveAll collapses duplicates itself, so the
  // atomic path only ever fires it once). `writes` therefore reports writes actually
  // sent, not calls enqueued.
  _enqueue(kind, objects) {
    const queued = this._pending[kind]
    for (const object of objects) {
      if (!object || alreadyQueued(queued, object)) {
        continue
      }
      queued.push(object)
    }
  }

  async commit() {
    this._assertOpen()
    let fellBackToSequential = false

    try {
      const { save, destroy } = this._pending
      if (save.length) {
        fellBackToSequential = await this._commitBatch({
          kind: 'save',
          objects: save
        })
        this._writes = save.length
      } else if (destroy.length) {
        fellBackToSequential = await this._commitBatch({
          kind: 'destroy',
          objects: destroy
        })
        this._writes = destroy.length
      } else {
        this._writes = 0
      }
    } catch (error) {
      this._state = 'failed'
      throw error
    }

    this._state = 'committed'
    this._mode = fellBackToSequential ? 'sequential-fallback' : this._mode
    this._pending = { save: [], destroy: [] }

    return {
      token: this._token,
      writes: this._writes,
      state: this._state,
      mode: this._mode
    }
  }

  // Returns true if it fell back to a sequential (non-atomic) commit.
  /**
   * @param {object} props
   * @param {'save' | 'destroy'} props.kind
   * @param {any[]} props.objects
   * @returns {Promise<boolean>} true if it fell back to a sequential (non-atomic) commit.
   */
  async _commitBatch({ kind, objects }) {
    // `this.constructor` is typed as the ambient lib's generic `Function`, which has no
    // `_servableConfig` - TS doesn't narrow `.constructor` to the actual subclass's own static
    // members. Cast to this class itself, the only constructor `_commitBatch` is ever called on.
    const servableConfig = /** @type {typeof ParseEngineTransaction} */ (this.constructor)._servableConfig

    // Already known to be standalone: don't send a batch that cannot possibly commit.
    // Besides the wasted round trip, a failed transactional batch leaks a pending-ops
    // layer onto every object in it (see restorePendingDepths), so the cheapest fix for
    // the common case is not to make the doomed request at all. The topology check is
    // cached per process, so only the very first commit in a process pays for the failure
    // path below.
    if (await isConfirmedStandaloneMongo({ servableConfig })) {
      console.warn(
        `[Servable Transaction] MongoDB is standalone, not a replica set, so this batch of ${objects.length} ${kind}(s) (token ${this._token}) can't commit atomically. Sending each ${kind} individually (non-atomic) instead. Fix: migrate MongoDB to a replica set.`
      )
      await this._commitSequentially({ kind, objects })
      return true
    }

    const depths = pendingDepths(objects)

    try {
      // Invoked as a method on Parse.Object rather than through an extracted reference:
      // detaching a static drops its receiver, so `this` would be undefined inside it.
      // Neither saveAll nor destroyAll happens to read `this` today, which is the only
      // reason the extracted form worked - not something to keep depending on.
      await (kind === 'save'
        ? Parse.Object.saveAll(objects, { ...this._options, transaction: true })
        : Parse.Object.destroyAll(objects, { ...this._options, transaction: true }))
      return false
    } catch (error) {
      // Before anything else, and whether or not this turns out to be the standalone
      // case: a failed batch can leave objects with an unbalanced pending-ops stack, and
      // leaving that in place silently voids every future write to those instances.
      restorePendingDepths(objects, depths)

      if (!(await isConfirmedStandaloneMongo({ servableConfig }))) {
        throw error
      }

      console.warn(
        `[Servable Transaction] MongoDB is standalone, not a replica set, so this batch of ${objects.length} ${kind}(s) (token ${this._token}) can't commit atomically. Falling back to sending each ${kind} individually (non-atomic) instead of failing. Fix: migrate MongoDB to a replica set.`
      )
      await this._commitSequentially({ kind, objects })
      return true
    }
  }

  async _commitSequentially({ kind, objects }) {
    const perObjectMethod =
      kind === 'save'
        ? (object) => object.save(null, { ...this._options })
        : (object) => object.destroy({ ...this._options })

    for (const object of objects) {
      await perObjectMethod(object)
    }
  }

  async rollback() {
    this._assertOpen()
    this._state = 'aborted'
    const discarded = this._pending.save.length + this._pending.destroy.length
    this._pending = { save: [], destroy: [] }

    return {
      token: this._token,
      discarded,
      state: this._state,
      mode: this._mode
    }
  }
}

const patchParseWrites = ({ Parse }) => {
  if (!Parse || Parse[TX_MARKER + 'Patched']) {
    return
  }

  if (Parse.Object && Parse.Object.prototype) {
    const objectProto = Parse.Object.prototype

    if (typeof objectProto.save === 'function') {
      const originalSave = objectProto.save
      objectProto.save = function (attrs, options) {
        const _options = options && typeof options === 'object' ? options : {}
        const transaction = _options.transaction
        if (!ParseEngineTransaction.isTransaction(transaction)) {
          return originalSave.call(this, attrs, _options)
        }

        try {
          if (attrs) {
            this.set(attrs)
          }
          transaction.enqueueSave([this])
        } catch (error) {
          return Promise.reject(error)
        }

        return Promise.resolve(this)
      }
    }

    if (typeof objectProto.destroy === 'function') {
      const originalDestroy = objectProto.destroy
      objectProto.destroy = function (options) {
        const _options = options && typeof options === 'object' ? options : {}
        const transaction = _options.transaction
        if (!ParseEngineTransaction.isTransaction(transaction)) {
          return originalDestroy.call(this, _options)
        }

        try {
          transaction.enqueueDestroy([this])
        } catch (error) {
          return Promise.reject(error)
        }

        return Promise.resolve(this)
      }
    }
  }

  if (Parse.Object && typeof Parse.Object.saveAll === 'function') {
    const originalSaveAll = Parse.Object.saveAll
    Parse.Object.saveAll = function (objects, options) {
      const _options = options && typeof options === 'object' ? options : {}
      const transaction = _options.transaction
      if (!ParseEngineTransaction.isTransaction(transaction)) {
        return originalSaveAll.call(this, objects, _options)
      }

      try {
        transaction.enqueueSave(Array.isArray(objects) ? objects : [objects])
      } catch (error) {
        return Promise.reject(error)
      }

      return Promise.resolve(objects)
    }
  }

  if (Parse.Object && typeof Parse.Object.destroyAll === 'function') {
    const originalDestroyAll = Parse.Object.destroyAll
    Parse.Object.destroyAll = function (objects, options) {
      const _options = options && typeof options === 'object' ? options : {}
      const transaction = _options.transaction
      if (!ParseEngineTransaction.isTransaction(transaction)) {
        return originalDestroyAll.call(this, objects, _options)
      }

      try {
        transaction.enqueueDestroy(Array.isArray(objects) ? objects : [objects])
      } catch (error) {
        return Promise.reject(error)
      }

      return Promise.resolve(objects)
    }
  }

  Parse[TX_MARKER + 'Patched'] = true
}

export default ({ Parse, servableConfig }) => {
  patchParseWrites({ Parse })

  return class extends ParseEngineTransaction {
    static _servableConfig = servableConfig
  }
}
