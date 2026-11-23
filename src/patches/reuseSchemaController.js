// One Parse Server SchemaController per schema cache, instead of one per query. Installed by the engine at launch when
// `isSchemaControllerReuseEnabled` (on by default; see ../options/index.js). Moved from backend/main's
// app/lib/parse/reuseSchemaController.js (found 2026-11-23 by local measurement; peakub's
// `.docs/incidents/2026-11-23-backmain-route-timeouts.md`, "Local measurements"; the app does not know its engine).
//
// Parse Server's DatabaseController.loadSchema() builds a NEW SchemaController for every find, count, save and delete, and each
// one builds its SchemaData twice (its constructor, then reloadData): one `Object.defineProperty` closure per class of the app,
// 176 in peakub's. That was 6-8% of the CPU of an explore page and of a publication's content (and 4.9% of the production burst
// profile of 2026-11-22), and it grows with the number of classes. Nothing in it depends on the request: the SchemaData is
// read-only (it is only ever replaced by reloadData, never edited), and it is rebuilt from the schema cache's list of classes.
//
// So `DatabaseController.prototype.loadSchema` is wrapped (not one instance: Parse Server's `Config.get()` makes a NEW DatabaseController for every call, so a
// wrapper on one instance was never reached): while the schema cache still holds the very list of classes the last controller was built from, that controller
// is returned again. When the cache is cleared, replaced or expired (a class or a field was added, the cache's TTL passed), or when the caller asks for
// `clearCache`, the original loadSchema() builds a fresh one. No change to node_modules, nothing to re-apply on an upgrade.

// `schemaCache.all()` answers a NEW array every time (a copy of the cache's list, `[]` when it is cleared), so lists are compared class by class: the cache puts
// new class objects when it is refilled, so the same objects in the same order means the same schema.
/**
 * @param {any} listOfClasses
 * @param {any} otherListOfClasses
 */
const isTheSameList = (listOfClasses, otherListOfClasses) => Array.isArray(listOfClasses) && Array.isArray(otherListOfClasses)
  && listOfClasses.length === otherListOfClasses.length
  && listOfClasses.every((schema, index) => schema === otherListOfClasses[index])

// A controller is reused for at most this long, whatever the cache does: Parse edits a class's permissions in the cached object itself (no new list), and nothing
// that does that runs while the app serves (the schema is applied at boot), but a minute is cheap insurance.
const MOST_MILLISECONDS_REUSED = 60 * 1000

/**
 * Wraps `DatabaseController.prototype.loadSchema`. `schemaCache.all()` is the list of classes the cache holds.
 * @param {object} props
 * @param {any} props.DatabaseController
 * @param {{ all: () => any[] }} props.schemaCache
 * @param {() => number} [props.now]
 * @param {number} [props.mostMillisecondsReused]
 * @returns {{ timesReused: () => number, restore: () => void }}
 */
export const reuseTheSchemaControllerIn = ({ DatabaseController, schemaCache, now = Date.now, mostMillisecondsReused = MOST_MILLISECONDS_REUSED }) => {
  const prototype = DatabaseController.prototype
  const loadSchemaOfParse = prototype.loadSchema
  // One reusable controller per storage adapter (one per app).
  const reusableByAdapter = new WeakMap()
  let timesReused = 0
  // What the cache holds now; anything unexpected there means "nothing to reuse", never an error for the query that asked.
  const classesOfTheCache = () => {
    try {
      return schemaCache.all()
    } catch {
      return null
    }
  }
  /** @type {any} */
  const loadSchemaOrReuse = async function (options = { clearCache: false }) {
    const classesNow = classesOfTheCache()
    const reusable = reusableByAdapter.get(this.adapter)
    if (reusable && !options?.clearCache && classesNow?.length > 0 && now() - reusable.builtAt < mostMillisecondsReused && isTheSameList(reusable.classes, classesNow)) {
      timesReused++
      return reusable.controller
    }
    reusableByAdapter.delete(this.adapter)
    const controller = await loadSchemaOfParse.call(this, options)
    // The list the controller was built from is the cache's list once the load has finished; none (a cache cleared in between) keeps nothing.
    const classesAfter = classesOfTheCache()
    if (classesAfter?.length > 0) {
      reusableByAdapter.set(this.adapter, { controller, classes: classesAfter, builtAt: now() })
    }
    return controller
  }
  loadSchemaOrReuse.isReusingTheSchemaController = true
  prototype.loadSchema = loadSchemaOrReuse
  return { timesReused: () => timesReused, restore: () => { prototype.loadSchema = loadSchemaOfParse } }
}

// Parse Server's files are CommonJS compiled by Babel: depending on how a file exports, the class is the module itself or its `default`.
/**
 * @param {any} loadedModule
 * @param {(candidate: any) => boolean} isWhatWeWant
 */
const classOrInstanceOf = (loadedModule, isWhatWeWant) => [loadedModule?.default, loadedModule?.default?.default, loadedModule].find((candidate) => candidate && isWhatWeWant(candidate))

/**
 * Installs the reuse when switched on. Never throws: a Parse Server it does not recognise builds a controller per query, as it always did.
 * @param {object} props
 * @param {boolean} props.isEnabled
 * @param {() => Promise<any>} [props.loadDatabaseController]
 * @param {() => Promise<any>} [props.loadSchemaCache]
 * @returns {Promise<{ isInstalled: boolean, reason?: string }>}
 */
export const installTheSchemaControllerReuse = async ({
  isEnabled,
  // @ts-ignore - parse-server ships no declarations for its compiled lib/ files.
  loadDatabaseController = async () => classOrInstanceOf(await import('parse-server/lib/Controllers/DatabaseController.js'), (candidate) => typeof candidate?.prototype?.loadSchema === 'function'),
  // @ts-ignore - parse-server ships no declarations for its compiled lib/ files.
  loadSchemaCache = async () => classOrInstanceOf(await import('parse-server/lib/Adapters/Cache/SchemaCache.js'), (candidate) => typeof candidate?.all === 'function'),
}) => {
  if (!isEnabled) {
    return { isInstalled: false, reason: 'switched off' }
  }
  try {
    const DatabaseController = await loadDatabaseController()
    if (typeof DatabaseController?.prototype?.loadSchema !== 'function') {
      console.error('[ENGINE] the schema controller is not reused: the database controller has no loadSchema')
      return { isInstalled: false, reason: 'no loadSchema' }
    }
    if (DatabaseController.prototype.loadSchema.isReusingTheSchemaController) {
      return { isInstalled: true, reason: 'already installed' }
    }
    const schemaCache = await loadSchemaCache()
    if (typeof schemaCache?.all !== 'function') {
      console.error('[ENGINE] the schema controller is not reused: the schema cache has no list of classes')
      return { isInstalled: false, reason: 'no schema cache' }
    }
    reuseTheSchemaControllerIn({ DatabaseController, schemaCache })
    return { isInstalled: true }
  } catch (error) {
    console.error('[ENGINE] the schema controller is not reused', { message: error?.message })
    return { isInstalled: false, reason: error?.message }
  }
}
