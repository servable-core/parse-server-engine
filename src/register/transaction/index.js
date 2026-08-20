const PATCH_FLAG = '__servableTransactionPatched'
const TX_MARKER = '__servableTransactionMarker'

class ParseEngineTransaction {
  _state = 'open'
  _token = null
  _options = {}
  _writes = 0
  _queue = []
  _mode = 'memory-deferred-transaction'

  static isTransaction(value) {
    return Boolean(value && value[TX_MARKER] === true)
  }

  get state() { return this._state }
  get token() { return this._token }
  get writes() { return this._writes }
  get options() { return this._options }
  get mode() { return this._mode }

  constructor(options = {}) {
    this._options = { ...options }
    this._token = options.token
      ? `${options.token}`
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    this[TX_MARKER] = true
  }

  _assertOpen() {
    if (this._state !== 'open') {
      throw new Error(`Transaction is already ${this._state}`)
    }
  }

  toWriteOptions(options = {}) {
    this._assertOpen()

    const _options = (options && typeof options === 'object') ? options : {}
    const { transaction: _ignoredTx, ...rest } = _options

    return {
      ...rest,
      context: {
        ...(rest.context || {}),
        servableTransactionToken: this._token,
      },
    }
  }

  enqueue(operation) {
    this._assertOpen()
    if (typeof operation !== 'function') {
      throw new Error('Transaction operation must be a function')
    }

    this._queue.push(operation)
  }

  async commit() {
    this._assertOpen()
    let executed = 0

    try {
      for (const operation of this._queue) {
        await operation()
        executed += 1
      }
    } catch (error) {
      this._state = 'failed'
      throw error
    }

    this._writes = executed
    this._state = 'committed'
    this._queue = []

    return {
      token: this._token,
      writes: this._writes,
      state: this._state,
      mode: this._mode,
    }
  }

  async rollback() {
    this._assertOpen()
    this._state = 'aborted'
    const queued = this._queue.length
    this._queue = []

    return {
      token: this._token,
      discarded: queued,
      state: this._state,
      mode: this._mode,
    }
  }
}

const normalizeTransactionOptions = (options = {}) => {
  const _options = (options && typeof options === 'object') ? options : {}
  const transaction = _options.transaction
  if (!ParseEngineTransaction.isTransaction(transaction)) {
    return _options
  }

  return transaction.toWriteOptions(_options)
}

const patchParseWrites = ({ Parse }) => {
  if (!Parse || Parse[PATCH_FLAG]) {
    return
  }

  if (Parse.Object && Parse.Object.prototype) {
    const objectProto = Parse.Object.prototype

    if (typeof objectProto.save === 'function') {
      const originalSave = objectProto.save
      objectProto.save = function (attrs, options) {
        const _options = (options && typeof options === 'object') ? options : {}
        const transaction = _options.transaction
        if (!ParseEngineTransaction.isTransaction(transaction)) {
          return originalSave.call(this, attrs, normalizeTransactionOptions(_options))
        }

        transaction.enqueue(async () => {
          await originalSave.call(this, attrs, normalizeTransactionOptions(_options))
        })

        return Promise.resolve(this)
      }
    }

    if (typeof objectProto.destroy === 'function') {
      const originalDestroy = objectProto.destroy
      objectProto.destroy = function (options) {
        const _options = (options && typeof options === 'object') ? options : {}
        const transaction = _options.transaction
        if (!ParseEngineTransaction.isTransaction(transaction)) {
          return originalDestroy.call(this, normalizeTransactionOptions(_options))
        }

        transaction.enqueue(async () => {
          await originalDestroy.call(this, normalizeTransactionOptions(_options))
        })

        return Promise.resolve(this)
      }
    }
  }

  if (Parse.Object && typeof Parse.Object.saveAll === 'function') {
    const originalSaveAll = Parse.Object.saveAll
    Parse.Object.saveAll = function (objects, options) {
      const _options = (options && typeof options === 'object') ? options : {}
      const transaction = _options.transaction
      if (!ParseEngineTransaction.isTransaction(transaction)) {
        return originalSaveAll.call(this, objects, normalizeTransactionOptions(_options))
      }

      transaction.enqueue(async () => {
        await originalSaveAll.call(this, objects, normalizeTransactionOptions(_options))
      })

      return Promise.resolve(objects)
    }
  }

  if (Parse.Object && typeof Parse.Object.destroyAll === 'function') {
    const originalDestroyAll = Parse.Object.destroyAll
    Parse.Object.destroyAll = function (objects, options) {
      const _options = (options && typeof options === 'object') ? options : {}
      const transaction = _options.transaction
      if (!ParseEngineTransaction.isTransaction(transaction)) {
        return originalDestroyAll.call(this, objects, normalizeTransactionOptions(_options))
      }

      transaction.enqueue(async () => {
        await originalDestroyAll.call(this, objects, normalizeTransactionOptions(_options))
      })

      return Promise.resolve(objects)
    }
  }

  Parse[PATCH_FLAG] = true
}

export default ({ Parse }) => {
  patchParseWrites({ Parse })

  return class extends ParseEngineTransaction {
    constructor(options = {}) {
      super(options)
    }
  }
}
