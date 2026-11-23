// The engine's own options: what this engine does on top of Parse Server, switched by the app in
// `servableConfig.configuration.config.engine`, each with an environment variable that overrides the app's
// choice when it is set (so production can be flipped without a release). An app sets none of them to keep the
// defaults below; an unreadable environment value is ignored, never guessed.
//
//   isFastObjectGetEnabled          PARSE_FAST_OBJECT_GET              off  `ParseObject.get` reads the saved data when nothing is pending (patches/fastObjectGet.js)
//   isSchemaControllerReuseEnabled  PARSE_SCHEMA_CONTROLLER_REUSE      on   one SchemaController per schema cache, not per query (patches/reuseSchemaController.js)
//   areDeclaredIndexesEnsured       SERVABLE_ENSURE_DECLARED_INDEXES   on   the `ensuredIndexes` of the schema made after boot, in the background (indexes/)
//   isSchemaMigrationForced         SERVABLE_FORCE_SCHEMA_MIGRATION    off  Parse's schema migration runs at every boot, even when nothing changed since the last one (schemaMigration/)
//   isLazyFetchSnapshotEnabled      PARSE_LAZY_FETCH_SNAPSHOT          off  the SDK's snapshot of a query result's object fields is computed when first read, not at every fetch (patches/lazyFetchSnapshot.js)
//   isQueryValueGuessingEnabled     SERVABLE_QUERY_VALUE_GUESSING      on   a query parameter no route declares is guessed (number-looking text a number, `true`/`false` booleans); off, it is the text the client sent (register/route/parameters/)
//   areDeclaredRouteParametersTyped SERVABLE_TYPED_ROUTE_PARAMETERS    on   a parameter a route declares in `schema.queryString` is read as its type, defaulted, and refused (400) when it cannot be; off, every parameter is read as undeclared (register/route/parameters/)
//   areUndeclaredParameterRoutesRefused SERVABLE_REFUSE_UNDECLARED_PARAMETER_ROUTES off  with guessing off, defining a route whose handler reads its parameters and that declares none throws, so the boot stops (register/route/parameters/)

export const ENGINE_OPTIONS = {
  isFastObjectGetEnabled: { environmentVariable: 'PARSE_FAST_OBJECT_GET', defaultValue: false },
  isSchemaControllerReuseEnabled: { environmentVariable: 'PARSE_SCHEMA_CONTROLLER_REUSE', defaultValue: true },
  areDeclaredIndexesEnsured: { environmentVariable: 'SERVABLE_ENSURE_DECLARED_INDEXES', defaultValue: true },
  isSchemaMigrationForced: { environmentVariable: 'SERVABLE_FORCE_SCHEMA_MIGRATION', defaultValue: false },
  isLazyFetchSnapshotEnabled: { environmentVariable: 'PARSE_LAZY_FETCH_SNAPSHOT', defaultValue: false },
  isQueryValueGuessingEnabled: { environmentVariable: 'SERVABLE_QUERY_VALUE_GUESSING', defaultValue: true },
  areDeclaredRouteParametersTyped: { environmentVariable: 'SERVABLE_TYPED_ROUTE_PARAMETERS', defaultValue: true },
  areUndeclaredParameterRoutesRefused: { environmentVariable: 'SERVABLE_REFUSE_UNDECLARED_PARAMETER_ROUTES', defaultValue: false },
}

/**
 * Reads a switch written in an environment variable: `1`/`true`/`on` and `0`/`false`/`off` (any case, spaces
 * ignored). Anything else, or nothing, answers `undefined`: the variable then says nothing.
 * @param {unknown} rawValue
 * @returns {boolean | undefined}
 */
export const booleanFromEnvironmentValue = (rawValue) => {
  if (rawValue === undefined || rawValue === null) {
    return undefined
  }
  const value = String(rawValue).trim().toLowerCase()
  if (['1', 'true', 'on'].includes(value)) {
    return true
  }
  if (['0', 'false', 'off'].includes(value)) {
    return false
  }
  return undefined
}

/**
 * The engine's options as they apply to this process: the environment variable when it says something, else
 * the app's choice when it is a boolean, else the default.
 * @param {object} [props]
 * @param {Record<string, any>} [props.engineConfiguration] - `servableConfig.configuration.config.engine`.
 * @param {Record<string, string | undefined>} [props.env]
 * @returns {{ isFastObjectGetEnabled: boolean, isSchemaControllerReuseEnabled: boolean, areDeclaredIndexesEnsured: boolean, isSchemaMigrationForced: boolean, isLazyFetchSnapshotEnabled: boolean, isQueryValueGuessingEnabled: boolean, areDeclaredRouteParametersTyped: boolean, areUndeclaredParameterRoutesRefused: boolean }}
 */
export const engineOptionsFrom = ({ engineConfiguration = {}, env = process.env } = {}) => {
  /** @type {any} */
  const options = {}
  for (const [name, { environmentVariable, defaultValue }] of Object.entries(ENGINE_OPTIONS)) {
    const fromEnvironment = booleanFromEnvironmentValue(env?.[environmentVariable])
    const fromTheApp = typeof engineConfiguration?.[name] === 'boolean' ? engineConfiguration[name] : undefined
    options[name] = fromEnvironment ?? fromTheApp ?? defaultValue
  }
  return options
}

// The route cache's bypass secret (register/route/cache/lib/bypass.js): the value `x-servable-reset-cache` must carry
// for a request to skip the route cache over HTTP. Not a switch, so not in ENGINE_OPTIONS:
//   routeCacheBypassSecret          SERVABLE_CACHE_BYPASS_SECRET       none  the environment wins over the app's value
// None (the default) means no HTTP caller can skip the cache; code in the process still can, with the request flag.
// A value shorter than ROUTE_CACHE_BYPASS_SECRET_MINIMUM_LENGTH is refused (logged once, treated as none): a short
// secret would be guessed.
export const ROUTE_CACHE_BYPASS_SECRET_ENVIRONMENT_VARIABLE = 'SERVABLE_CACHE_BYPASS_SECRET'
export const ROUTE_CACHE_BYPASS_SECRET_MINIMUM_LENGTH = 16

let isShortBypassSecretReported = false

/**
 * @param {object} [props]
 * @param {Record<string, any>} [props.engineConfiguration] - `servableConfig.configuration.config.engine`.
 * @param {Record<string, string | undefined>} [props.env]
 * @returns {string | null}
 */
export const routeCacheBypassSecretFrom = ({ engineConfiguration = {}, env = process.env } = {}) => {
  const fromEnvironment = String(env?.[ROUTE_CACHE_BYPASS_SECRET_ENVIRONMENT_VARIABLE] ?? '').trim()
  const fromTheApp = typeof engineConfiguration?.routeCacheBypassSecret === 'string' ? engineConfiguration.routeCacheBypassSecret.trim() : ''
  const secret = fromEnvironment || fromTheApp
  if (!secret) {
    return null
  }
  if (secret.length < ROUTE_CACHE_BYPASS_SECRET_MINIMUM_LENGTH) {
    if (!isShortBypassSecretReported) {
      isShortBypassSecretReported = true
      console.error('[ENGINE] [route cache] bypass secret refused: shorter than', ROUTE_CACHE_BYPASS_SECRET_MINIMUM_LENGTH, 'characters; no HTTP caller can skip the cache')
    }
    return null
  }
  return secret
}

export default engineOptionsFrom
