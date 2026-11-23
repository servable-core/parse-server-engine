// A cheaper `ParseObject.get`, installed by the engine at launch when `isFastObjectGetEnabled` (off by default;
// see ../options/index.js). Moved from backend/main's app/lib/parse/fastObjectGet.js (serializer audit F7,
// 2026-11-23; the app does not know its engine).
//
// The SDK's `get(attr)` is `this.attributes[attr]`, and `attributes` copies EVERY field of the object into a new object and
// freezes it, on every call (`parse/lib/node/ParseObject.js` `get attributes()`, `ObjectStateMutations.estimateAttributes`):
// 3.5 µs at 60 fields, 12 µs at 200, and a publication serialization makes about 90 of them. When the object holds no pending
// change, that copy is exactly its server data, so the value asked is `serverData[attr]`, the same reference.
//
// The fast path answers `serverData[attr]` only when every pending operation list is empty and the name is an ordinary one;
// anything else (a pending set, unset, increment, add, relation op, a save in flight, a name Object.prototype has, a state
// it cannot read) goes to the SDK's own `get`. Nothing is copied, nothing is cached: the answer is read live each time.
// The property test (tests/unit/fastObjectGet.test.js) checks it against the SDK's `get` over random objects and states.

/** @param {unknown} pendingOperations */
const hasNoPendingOperation = (pendingOperations) => {
  if (!Array.isArray(pendingOperations)) {
    return false
  }
  for (const operations of pendingOperations) {
    if (!operations || typeof operations !== 'object') {
      return false
    }
    for (const name in operations) {
      return false
    }
  }
  return true
}

/**
 * The fast `get`, falling back to `getOfTheSdk` whenever the object is not in the plain "as saved" state.
 * @param {(this: any, attr: any) => any} getOfTheSdk
 * @returns {(this: any, attr: any) => any}
 */
export const fastGetOver = (getOfTheSdk) => function fastGet(attr) {
  if (typeof attr !== 'string' || attr in Object.prototype) {
    return getOfTheSdk.call(this, attr)
  }
  let serverData
  try {
    if (!hasNoPendingOperation(this._getPendingOps())) {
      return getOfTheSdk.call(this, attr)
    }
    serverData = this._getServerData()
  } catch {
    return getOfTheSdk.call(this, attr)
  }
  if (!serverData || typeof serverData !== 'object' || Object.getPrototypeOf(serverData) !== Object.prototype) {
    return getOfTheSdk.call(this, attr)
  }
  return serverData[attr]
}

/**
 * Patches `ParseObject.prototype.get`. Returns how to put the SDK's back.
 * @param {{ ParseObject: any }} props
 * @returns {{ isInstalled: boolean, reason?: string, restore: () => void }}
 */
export const installTheFastObjectGetIn = ({ ParseObject }) => {
  const prototype = ParseObject.prototype
  if (prototype.get?.isTheFastObjectGet) {
    return { isInstalled: true, reason: 'already installed', restore: () => {} }
  }
  const getOfTheSdk = prototype.get
  /** @type {any} */
  const fastGet = fastGetOver(getOfTheSdk)
  fastGet.isTheFastObjectGet = true
  prototype.get = fastGet
  return { isInstalled: true, restore: () => { prototype.get = getOfTheSdk } }
}

/** @param {any} ParseObject */
const hasTheMethodsTheFastGetReads = (ParseObject) => typeof ParseObject?.prototype?.get === 'function'
  && typeof ParseObject.prototype._getPendingOps === 'function'
  && typeof ParseObject.prototype._getServerData === 'function'

/**
 * Installs the fast get when switched on. Never throws: an SDK it does not recognise keeps its own `get`.
 * @param {object} props
 * @param {boolean} props.isEnabled
 * @param {() => Promise<any>} [props.loadParseObject]
 * @returns {Promise<{ isInstalled: boolean, reason?: string }>}
 */
export const installTheFastObjectGet = async ({
  isEnabled,
  loadParseObject = async () => {
    const loaded = await import('parse/node.js')
    return (loaded?.default ?? loaded)?.Object
  },
}) => {
  if (!isEnabled) {
    return { isInstalled: false, reason: 'switched off' }
  }
  try {
    const ParseObject = await loadParseObject()
    if (!hasTheMethodsTheFastGetReads(ParseObject)) {
      console.error('[ENGINE] the fast object get is not installed: the SDK has not the methods it reads')
      return { isInstalled: false, reason: 'unknown SDK' }
    }
    const answer = installTheFastObjectGetIn({ ParseObject })
    // The global Parse of the server is the same SDK; patched too if it were another copy.
    const globalParseObject = globalThis.Parse?.Object
    if (globalParseObject && globalParseObject !== ParseObject && hasTheMethodsTheFastGetReads(globalParseObject)) {
      installTheFastObjectGetIn({ ParseObject: globalParseObject })
    }
    console.info('[ENGINE] the fast object get is installed (isFastObjectGetEnabled / PARSE_FAST_OBJECT_GET)')
    return { isInstalled: answer.isInstalled, ...(answer.reason ? { reason: answer.reason } : {}) }
  } catch (error) {
    console.error('[ENGINE] the fast object get is not installed', { message: error?.message })
    return { isInstalled: false, reason: error?.message }
  }
}
