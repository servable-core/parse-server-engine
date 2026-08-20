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
const TX_MARKER = '__servableTransactionMarker'

class ParseEngineTransaction {
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
    this._pending.save.push(...objects)
  }

  enqueueDestroy(objects) {
    this._assertOpen()
    this._assertSingleKind('destroy')
    this._pending.destroy.push(...objects)
  }

  async commit() {
    this._assertOpen()

    try {
      const { save, destroy } = this._pending
      if (save.length) {
        await Parse.Object.saveAll(save, {
          ...this._options,
          transaction: true
        })
        this._writes = save.length
      } else if (destroy.length) {
        await Parse.Object.destroyAll(destroy, {
          ...this._options,
          transaction: true
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
    this._pending = { save: [], destroy: [] }

    return {
      token: this._token,
      writes: this._writes,
      state: this._state,
      mode: this._mode
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

export default ({ Parse }) => {
  patchParseWrites({ Parse })

  return class extends ParseEngineTransaction {}
}
