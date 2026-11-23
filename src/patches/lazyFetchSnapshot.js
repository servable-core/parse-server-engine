import { createRequire } from 'module'

// A lazy snapshot of the object fields of query results, installed by the engine at launch when
// `isLazyFetchSnapshotEnabled` (off by default; env PARSE_LAZY_FETCH_SNAPSHOT; see ../options/index.js). Framework
// audit 2026-11-23, F6.
//
// What the SDK does (parse 6.1.1). When an object's server data is committed (`ObjectStateMutations.commitServerChanges`,
// on every fetch, query result and save answer), each field holding an object or an array (not a Parse object, file or
// relation) is snapshotted right away: `objectCache[field] = JSON.stringify(encode(value, false, true))`. The only use
// of that string is `_getDirtyObjectAttributes` (behind `dirty()`, `dirtyKeys()` and every save), which encodes the
// field's current value again and calls the field dirty when the strings differ: that is how an in-place change
// (`object.get('tags').push(x)`) is noticed. It is about half of what building an object costs (89 µs against 39 µs for
// a Publication), paid for every object of every query, whether or not anything ever asks whether it is dirty.
//
// What this patch does. For the fields of a query result, it keeps the raw JSON value the field was decoded from and
// computes the very same string, `JSON.stringify(encode(decode(raw), false, true))`, the first time anything reads the
// object's snapshot cache (a dirty check, a save, a clone, a later commit of server data into the object). Reading the
// object's values (`get`, `attributes`, `toJSON`) does not. Why that string is the one the SDK would have computed:
//
//   1. The raw value is the SDK's own: a result object of `QueryController.find`'s answer (neither `json` nor
//      `explain` asked, so never handed to the caller), passed to `ParseObject.fromJSON` by `ParseQuery.find`, and
//      only when objects are unique instances (the server's mode: parse-server calls `disableSingleInstance`; in single
//      instance mode a select on a sub-field copies other objects' live data into the raw result). Once the object is
//      built, nothing else holds it, so it never changes.
//   2. The field's value was decoded from it alone (`_finishFetch` decodes every field but ACL, createdAt, updatedAt,
//      objectId, which keep the eager snapshot), and the raw value only holds what `decode` copies into fresh plain
//      values: strings, numbers, booleans, null, arrays and plain objects, and `{ __type: 'Date', iso }` with a valid
//      date. Anything else (a pointer or an object inside, a file, a relation, a geo point, an `__op`, an invalid date,
//      a class instance, a nested value deeper than 64 levels) keeps the eager snapshot. For those raw values `decode`
//      and `encode` are pure, deterministic and cannot throw, so decoding again later gives a value with the same
//      encoding as the one decoded first, whatever has been done to that one since.
//   3. Every read of the snapshots is a read of the object state's `objectCache`, by the SDK or anyone holding the
//      state. For a state with pending snapshots that property becomes an accessor that computes them all before
//      handing the cache over, so nothing ever sees a pending one. Until then, the cache holds a placeholder under the
//      field's name, so its keys and their order stay what the SDK makes. The state controller is wrapped (and
//      re-wrapped when the SDK installs another one) only for the commit itself.
//
// tests/unit/lazyFetchSnapshot.test.js checks it against the SDK, as installed, over thousands of random objects and
// random sequences of reads, in-place changes, sets, unsets, increments, adds, removes, saves, fetches, reverts and
// clones: every observable answer is the same with the patch on and off.

const requireFromHere = createRequire(import.meta.url)

const SNAPSHOT_PLACEHOLDER = '\u0000servable:lazy-fetch-snapshot\u0000'
const FIELDS_DECODED_APART = new Set(['ACL', 'createdAt', 'updatedAt', 'objectId'])
const MAXIMUM_DEPTH = 64
const IS_WRAPPED = Symbol.for('servable.lazyFetchSnapshot.wrappedStateController')

/**
 * Whether `decode` turns this raw value into fresh plain values only, so that decoding it again later gives the same
 * encoding (see the header, point 2).
 * @param {any} raw - any raw value a query result holds.
 * @param {number} [depth]
 * @returns {boolean}
 */
export const isDecodedIntoFreshPlainValues = (raw, depth = 0) => {
  if (raw === null || raw === undefined) {
    return true
  }
  const type = typeof raw
  if (type === 'string' || type === 'boolean' || type === 'number') {
    return true
  }
  if (type !== 'object' || depth > MAXIMUM_DEPTH) {
    return false
  }
  if (Array.isArray(raw)) {
    if (Object.getPrototypeOf(raw) !== Array.prototype) {
      return false
    }
    for (let index = 0; index < raw.length; index++) {
      if (!isDecodedIntoFreshPlainValues(raw[index], depth + 1)) {
        return false
      }
    }
    return true
  }
  if (Object.getPrototypeOf(raw) !== Object.prototype) {
    return false
  }
  if ('__op' in raw) {
    return false
  }
  if ('__type' in raw) {
    // `decode` makes a Date of it (whatever else it holds); a valid one encodes back the same.
    return raw.__type === 'Date' && typeof raw.iso === 'string' && !Number.isNaN(new Date(raw.iso).getTime())
  }
  for (const key in raw) {
    if (!isDecodedIntoFreshPlainValues(raw[key], depth + 1)) {
      return false
    }
  }
  return true
}

/**
 * The patch, built over one SDK. Nothing is changed until `install()`.
 * @param {object} sdk
 * @param {any} sdk.CoreManager
 * @param {any} sdk.ParseObject
 * @param {any} sdk.ParseFile
 * @param {any} sdk.ParseRelation
 * @param {(value: any, disallowObjects?: boolean, forcePointers?: boolean) => any} sdk.encode
 * @param {(value: any) => any} sdk.decode
 * @param {any} sdk.UniqueInstanceStateController
 */
export const createTheLazyFetchSnapshot = ({ CoreManager, ParseObject, ParseFile, ParseRelation, encode, decode, UniqueInstanceStateController }) => {
  const snapshotOf = (value) => JSON.stringify(encode(value, false, true))

  // objectCache (the SDK's own object, one per object state) -> Map(field -> the raw value its snapshot comes from)
  const pendingRawValuesByObjectCache = new WeakMap()
  // The result objects of query answers nobody but the SDK holds.
  const privateQueryResults = new WeakSet()
  // The private result `ParseObject.fromJSON` is building, if any; and the `_finishFetch` it runs.
  let privateResultOfTheCurrentFromJSON = null
  let currentPrivateFetch = null

  const computeThePendingSnapshotsOf = (objectCache) => {
    const pendingRawValues = objectCache && pendingRawValuesByObjectCache.get(objectCache)
    if (!pendingRawValues) {
      return
    }
    pendingRawValuesByObjectCache.delete(objectCache)
    for (const [field, raw] of pendingRawValues) {
      objectCache[field] = snapshotOf(decode(raw))
    }
  }

  // The SDK's ObjectStateMutations.nestedSet, unchanged (it is not exported).
  const nestedSet = (target, key, value) => {
    const paths = key.split('.')
    let object = target
    for (let i = 0; i < paths.length - 1; i++) {
      const path = paths[i]
      if (!(path in object)) {
        const nextPath = paths[i + 1]
        if (!isNaN(/** @type {any} */ (nextPath))) {
          object[path] = []
        } else {
          object[path] = {}
        }
      }
      object = object[path]
    }
    if (typeof value === 'undefined') {
      delete object[paths[paths.length - 1]]
    } else {
      object[paths[paths.length - 1]] = value
    }
  }

  const isSnapshotted = (value) => value && typeof value === 'object'
    && !(value instanceof CoreManager.getParseObject()) && !(value instanceof ParseFile) && !(value instanceof ParseRelation)

  // A state whose snapshots are pending gets an `objectCache` accessor: whoever reads the cache (the SDK's dirty check,
  // `duplicateState`, a later commit, any caller of `getState`) gets it with every pending snapshot computed first. Reading
  // the state for anything else (`existed`, `serverData`, `pendingOps`) leaves them pending.
  const realObjectCacheByState = new WeakMap()
  const realObjectCacheOf = (state) => {
    if (realObjectCacheByState.has(state)) {
      return realObjectCacheByState.get(state)
    }
    const realObjectCache = state.objectCache
    realObjectCacheByState.set(state, realObjectCache)
    Object.defineProperty(state, 'objectCache', {
      configurable: true,
      enumerable: true,
      get() {
        const objectCache = realObjectCacheByState.get(state)
        computeThePendingSnapshotsOf(objectCache)
        return objectCache
      },
      set(objectCache) {
        realObjectCacheByState.set(state, objectCache)
      },
    })
    return realObjectCache
  }

  const wrapTheStateController = (controller) => {
    if (!controller || controller[IS_WRAPPED]) {
      return controller
    }
    // The SDK installs a copy of the module's namespace, not the module: compare its functions.
    const isUniqueInstanceMode = controller.getState === UniqueInstanceStateController.getState
      && controller.commitServerChanges === UniqueInstanceStateController.commitServerChanges
    return {
      ...controller,
      [IS_WRAPPED]: true,
      commitServerChanges(objectIdentifier, changes) {
        const privateFetch = currentPrivateFetch
        if (!privateFetch || !isUniqueInstanceMode) {
          // The SDK's own commit reads `state.objectCache`: any pending snapshot is computed before it writes.
          return controller.commitServerChanges(objectIdentifier, changes)
        }
        // ObjectStateMutations.commitServerChanges, with the snapshot of a private raw value left for later.
        const state = controller.initializeState(objectIdentifier)
        const { serverData } = state
        const objectCache = realObjectCacheOf(state)
        const pendingRawValues = pendingRawValuesByObjectCache.get(objectCache) || new Map()
        for (const field in changes) {
          const value = changes[field]
          nestedSet(serverData, field, value)
          if (!isSnapshotted(value)) {
            continue
          }
          const raw = privateFetch.serverData[field]
          const isLeftForLater = !FIELDS_DECODED_APART.has(field)
            && !field.includes('.')
            && raw !== null && typeof raw === 'object'
            && privateFetch.result[field] === raw
            && isDecodedIntoFreshPlainValues(raw)
          if (isLeftForLater) {
            objectCache[field] = SNAPSHOT_PLACEHOLDER
            pendingRawValues.set(field, raw)
          } else {
            pendingRawValues.delete(field)
            objectCache[field] = snapshotOf(value)
          }
        }
        if (pendingRawValues.size) {
          pendingRawValuesByObjectCache.set(objectCache, pendingRawValues)
        } else {
          pendingRawValuesByObjectCache.delete(objectCache)
        }
        return undefined
      },
    }
  }

  let restoreTheSdk = null

  const install = () => {
    if (restoreTheSdk) {
      return { isInstalled: true, reason: 'already installed' }
    }
    const fromJSONOfTheSdk = ParseObject.fromJSON
    const finishFetchOfTheSdk = ParseObject.prototype._finishFetch
    const setObjectStateControllerOfTheSdk = CoreManager.setObjectStateController
    const stateControllerOfTheSdk = CoreManager.getObjectStateController()
    const queryControllerOfTheSdk = CoreManager.getQueryController()

    CoreManager.setQueryController({
      ...queryControllerOfTheSdk,
      find(className, params, options) {
        return queryControllerOfTheSdk.find(className, params, options).then((response) => {
          // Results handed back as JSON (`json`) or explained are the caller's, never private.
          if (!options?.json && !params?.explain && Array.isArray(response?.results)) {
            for (const result of response.results) {
              if (result && typeof result === 'object') {
                privateQueryResults.add(result)
              }
            }
          }
          return response
        })
      },
    })

    ParseObject.fromJSON = function fromJSON(json, override, dirty) {
      const previous = privateResultOfTheCurrentFromJSON
      privateResultOfTheCurrentFromJSON = !dirty && json && privateQueryResults.has(json) ? json : null
      try {
        return fromJSONOfTheSdk.call(this, json, override, dirty)
      } finally {
        privateResultOfTheCurrentFromJSON = previous
      }
    }

    ParseObject.prototype._finishFetch = function _finishFetch(serverData) {
      const result = privateResultOfTheCurrentFromJSON
      const previousFetch = currentPrivateFetch
      // Objects decoded inside this one (a pointer, an included object) are built by fromJSON calls of their own.
      privateResultOfTheCurrentFromJSON = null
      currentPrivateFetch = result ? { result, serverData } : null
      try {
        return finishFetchOfTheSdk.call(this, serverData)
      } finally {
        currentPrivateFetch = previousFetch
        privateResultOfTheCurrentFromJSON = result
      }
    }

    CoreManager.setObjectStateController = function setObjectStateController(controller) {
      return setObjectStateControllerOfTheSdk.call(this, wrapTheStateController(controller))
    }
    CoreManager.setObjectStateController(stateControllerOfTheSdk)

    // For tests: puts the SDK back as it was. Objects built meanwhile keep their accessor, so their pending snapshots
    // are still computed when read; production never uninstalls.
    restoreTheSdk = () => {
      ParseObject.fromJSON = fromJSONOfTheSdk
      ParseObject.prototype._finishFetch = finishFetchOfTheSdk
      CoreManager.setObjectStateController = setObjectStateControllerOfTheSdk
      setObjectStateControllerOfTheSdk.call(CoreManager, stateControllerOfTheSdk)
      CoreManager.setQueryController(queryControllerOfTheSdk)
    }
    return { isInstalled: true }
  }

  const uninstall = () => {
    if (!restoreTheSdk) {
      return
    }
    restoreTheSdk()
    restoreTheSdk = null
  }

  return { install, uninstall, wrapTheStateController, isDecodedIntoFreshPlainValues }
}

/**
 * The SDK's own modules, as parse-server and the app use them (one copy of `parse` in the tree).
 * @returns {Parameters<typeof createTheLazyFetchSnapshot>[0]}
 */
export const sdkModules = () => {
  const moduleOf = (name) => {
    const loaded = requireFromHere(`parse/lib/node/${name}.js`)
    return loaded?.default ?? loaded
  }
  const Parse = requireFromHere('parse/node.js')
  const ParseSdk = Parse?.default ?? Parse
  return {
    CoreManager: ParseSdk.CoreManager,
    ParseObject: ParseSdk.Object,
    ParseFile: moduleOf('ParseFile'),
    ParseRelation: moduleOf('ParseRelation'),
    encode: moduleOf('encode'),
    decode: moduleOf('decode'),
    UniqueInstanceStateController: requireFromHere('parse/lib/node/UniqueInstanceStateController.js'),
  }
}

let theInstalledPatch = null

/**
 * Installs the lazy snapshot when switched on. Never throws: an SDK it does not recognise keeps its own behaviour.
 * @param {object} props
 * @param {boolean} props.isEnabled
 * @param {() => Parameters<typeof createTheLazyFetchSnapshot>[0]} [props.loadSdkModules]
 * @returns {Promise<{ isInstalled: boolean, reason?: string }>}
 */
export const installTheLazyFetchSnapshot = async ({ isEnabled, loadSdkModules = sdkModules }) => {
  if (!isEnabled) {
    return { isInstalled: false, reason: 'switched off' }
  }
  try {
    const modules = loadSdkModules()
    const { CoreManager, ParseObject, encode, decode } = modules
    const isRecognised = typeof ParseObject?.fromJSON === 'function'
      && typeof ParseObject?.prototype?._finishFetch === 'function'
      && typeof CoreManager?.getObjectStateController === 'function'
      && typeof CoreManager?.setObjectStateController === 'function'
      && typeof CoreManager?.getQueryController()?.find === 'function'
      && typeof encode === 'function' && typeof decode === 'function'
    if (!isRecognised) {
      console.error('[ENGINE] the lazy fetch snapshot is not installed: the SDK has not the functions it wraps')
      return { isInstalled: false, reason: 'unknown SDK' }
    }
    theInstalledPatch = theInstalledPatch || createTheLazyFetchSnapshot(modules)
    const answer = theInstalledPatch.install()
    console.info('[ENGINE] the lazy fetch snapshot is installed (isLazyFetchSnapshotEnabled / PARSE_LAZY_FETCH_SNAPSHOT)')
    return answer
  } catch (error) {
    console.error('[ENGINE] the lazy fetch snapshot is not installed', { message: error?.message })
    return { isInstalled: false, reason: error?.message }
  }
}
