import { storageIndexFrom } from './storageIndex.js'

// Indexes Parse's schema cannot make (`Servable.App.Indexes`, and the `ensuredIndexes` a schema.json declares):
// unique ones, ones with a partial filter, ones on a dotted path into an object, on `objectId` beside other keys, or
// on a pointer column Parse adds only when a row first holds it. Parse's own schema `indexes` are made by Parse
// Server at boot, BEFORE the server listens, and refused for most of these (an `_id` key stopped backend/main from
// booting on 2026-10-23). These are made by the engine directly through Parse's MongoDB adapter, after boot, one at a
// time, never awaited by the boot: a long build or a refusal is logged and the server serves meanwhile (the queries
// they help still work, only slower; a unique one missing means two rows written at the very same moment could
// both be kept).
//
// Making one is idempotent: an index already there with the same keys, name and options is left as it is. One that
// clashes (the name taken by other keys, the keys indexed under another name or other options, duplicates where it
// should be unique) is not made, and the log says why. Nothing here ever drops an index: a declaration removed from
// the schema leaves its index in the database until someone drops it on purpose.

const LOG_PREFIX = '[ENGINE] [indexes]'

// MongoDB's codes for an index that clashes with one already there, and for duplicates under a unique index.
const REASON_BY_MONGO_CODE = {
  85: 'an index with these keys already exists under another name or with other options',
  86: 'this name is already taken by an index with other keys or options',
  11000: 'the collection holds duplicates, so it cannot be unique',
}

/**
 * @param {any} error
 * @returns {string}
 */
const reasonOf = (error) => {
  const known = REASON_BY_MONGO_CODE[error?.code]
  return known ? `${known} (${error?.message})` : (error?.message || String(error))
}

/**
 * @param {object} props
 * @param {() => Promise<any>} props.resolveAdapter - Parse's storage adapter, once Parse Server has started.
 * @param {() => Promise<(className: string, fieldName: string, schema: any) => string>} [props.loadTransformKey]
 * @param {() => any[] | null | undefined} [props.declaredClasses] - the classes of the schema (`{ className, fields }`), for field types.
 */
export const createIndexes = ({
  resolveAdapter,
  loadTransformKey = async () => {
    // @ts-ignore - parse-server ships no declarations for its compiled lib/ files.
    const loaded = await import('parse-server/lib/Adapters/Storage/Mongo/MongoTransform.js')
    return (loaded?.default ?? loaded).transformKey
  },
  declaredClasses = () => /** @type {any} */ (globalThis).Servable?.schema?.appProtocol?.schema?.classes?.all,
}) => {
  /** @param {string} className */
  const declaredFieldsOf = (className) => {
    try {
      return (declaredClasses() || []).find((declaredClass) => declaredClass?.className === className)?.fields || {}
    } catch {
      return {}
    }
  }

  /**
   * Makes one index when it is not there yet. Never throws; the answer says whether it is there now.
   * @param {object} props
   * @param {string} props.className
   * @param {string} props.name - the index's name in the database.
   * @param {Record<string, 1 | -1>} props.keys - field names (Parse's: `objectId`, a pointer by its name) or dotted paths.
   * @param {boolean} [props.isUnique]
   * @param {boolean} [props.isSparse] - rows without the field left out; true unless a `partialFilter` is given.
   * @param {Record<string, any>} [props.partialFilter] - only the rows matching it, field names as in `keys`.
   * @param {Record<string, any>} [props.fieldTypes] - the type of a field the class's schema does not declare (`{ type: 'Pointer', targetClass }`).
   * @returns {Promise<{ isEnsured: boolean, className: string, name: string, reason?: string }>}
   */
  const ensure = async ({ className, name, keys, isUnique, isSparse, partialFilter, fieldTypes }) => {
    const declaration = Object.fromEntries(Object.entries({ keys, isUnique, isSparse, partialFilter, fieldTypes }).filter(([, value]) => value !== undefined))
    try {
      const transformKey = await loadTransformKey()
      const storageIndex = storageIndexFrom({ className, name, declaration, declaredFields: declaredFieldsOf(className), transformKey })
      const adapter = await resolveAdapter()
      if (typeof adapter?._adaptiveCollection !== 'function') {
        const reason = 'the storage adapter is not MongoDB\'s: this engine makes these indexes only there'
        console.error(LOG_PREFIX, 'not made', { className, name, reason })
        return { isEnsured: false, className, name, reason }
      }
      const collection = await adapter._adaptiveCollection(className)
      await collection._mongoCollection.createIndex(storageIndex.keys, storageIndex.options)
      return { isEnsured: true, className, name }
    } catch (error) {
      const reason = reasonOf(error)
      console.error(LOG_PREFIX, 'not made', { className, name, reason })
      return { isEnsured: false, className, name, reason }
    }
  }

  /**
   * Every `ensuredIndexes` of the classes, one after the other. Resolves when all were tried, never rejects; the boot
   * never awaits it.
   * @param {object} props
   * @param {any[]} props.classes - `{ className, ensuredIndexes }`
   * @param {() => number} [props.now]
   * @returns {Promise<{ ensured: string[], failed: { index: string, reason: string }[] }>}
   */
  const ensureTheDeclared = async ({ classes, now = Date.now }) => {
    const startedAt = now()
    const ensured = []
    const failed = []
    for (const declaredClass of classes || []) {
      for (const [name, declaration] of Object.entries(declaredClass?.ensuredIndexes || {})) {
        // One at a time: index builds compete with the traffic the server has just started to take.
        const answer = await ensure({ className: declaredClass.className, name, ...(declaration || {}) })
        const index = `${declaredClass.className}.${name}`
        answer.isEnsured ? ensured.push(index) : failed.push({ index, reason: answer.reason })
      }
    }
    if (ensured.length > 0 || failed.length > 0) {
      console.info(LOG_PREFIX, 'declared indexes ensured', { ensured: ensured.length, failed: failed.length, milliseconds: now() - startedAt, ...(failed.length > 0 ? { failedIndexes: failed.map(({ index }) => index) } : {}) })
    }
    return { ensured, failed }
  }

  return { ensure, ensureTheDeclared }
}

/**
 * The adapter Parse Server keeps for an application, once it has started.
 * @param {() => string | undefined} applicationIdOf
 * @returns {() => Promise<any>}
 */
export const adapterResolverFor = (applicationIdOf) => async () => {
  // @ts-ignore - parse-server ships no declarations for its compiled lib/ files.
  const loaded = await import('parse-server/lib/Config.js')
  // Parse Server's files are CommonJS compiled by Babel: the class is the module's default or its `default`'s.
  const Config = [loaded?.default, loaded?.default?.default, loaded?.Config].find((candidate) => typeof candidate?.get === 'function')
  return Config?.get(applicationIdOf())?.database?.adapter
}

/**
 * Starts making every declared index, without waiting for it: what the boot calls.
 * @param {object} props
 * @param {{ ensureTheDeclared: (props: { classes: any[] }) => Promise<any> }} props.indexes
 * @param {any[]} props.classes
 * @param {boolean} props.areDeclaredIndexesEnsured
 * @returns {Promise<any> | null} the run, for whoever wants to follow it; null when switched off or nothing is declared.
 */
export const startEnsuringTheDeclaredIndexes = ({ indexes, classes, areDeclaredIndexesEnsured }) => {
  const declaringClasses = (classes || []).filter((declaredClass) => declaredClass?.ensuredIndexes && Object.keys(declaredClass.ensuredIndexes).length > 0)
  if (declaringClasses.length === 0) {
    return null
  }
  if (!areDeclaredIndexesEnsured) {
    console.info(LOG_PREFIX, 'declared indexes not ensured (areDeclaredIndexesEnsured / SERVABLE_ENSURE_DECLARED_INDEXES off)')
    return null
  }
  return Promise.resolve()
    .then(() => indexes.ensureTheDeclared({ classes: declaringClasses }))
    .catch((error) => {
      console.error(LOG_PREFIX, 'declared indexes not ensured', { message: error?.message })
      return null
    })
}

export default createIndexes
