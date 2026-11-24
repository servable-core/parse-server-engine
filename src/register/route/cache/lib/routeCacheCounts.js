import { engineCounterNamed } from '../../../../lib/metrics.js'
import { ROUTE_CACHE_BYPASS_HEADER, ROUTE_CACHE_BYPASS_REQUEST_FLAG, isTheBypassSecret } from './bypass.js'

// Production proof 3.4 (.docs/technical/production-proof-instrumentation-2026-11-23.md): what each cached route's cache did.
//   servable_route_cache_lookups_total{route, storage, outcome}
//     hit, miss, bypass_in_process (the request flag), bypass_secret (the header with the server's secret), bypass_refused
//     (the header with any other value: counted, still never logged, and the request then uses the cache like any other, so
//     it is also counted hit or miss), no_key, no_client (Redis unavailable)
//   servable_route_cache_stores_total{route, storage, outcome}
//     stored, not_cacheable (not a success, or marked as an error), write_failed
//   servable_route_cache_reader_credentials_total{storage, credential}
//     on a per-reader (`userExists`) configuration, which credentials keyed the lookup: session, bearer, session_and_bearer
//     (owner's Q1961 b; none is the lookup's no_key). No route label: 2 storages x 3 values.
// `route` is the route's registered path (only routes with a `cache` declaration); `storage` is `redis` or `inMemory`.

const lookupsCounter = engineCounterNamed('servable_route_cache_lookups_total', {
  description: 'Count of route cache lookups by route, storage and outcome (hit, miss, bypass_*, no_key, no_client).',
})
const readerCredentialsCounter = engineCounterNamed('servable_route_cache_reader_credentials_total', {
  description: 'Count of per-reader route cache lookups by storage and the credentials that keyed them (session, bearer, session_and_bearer).',
})
const storesCounter = engineCounterNamed('servable_route_cache_stores_total', {
  description: 'Count of route cache answers kept or not, by route, storage and outcome (stored, not_cacheable, write_failed).',
})

/**
 * How a request skips the cache, or null when it uses it: `bypass_in_process` or `bypass_secret`. Mirrors
 * isRouteCacheBypassedFor (bypass.js), which stays the one rule.
 * @param {{ request: any, bypassSecret: string | null | undefined }} props
 * @returns {'bypass_in_process' | 'bypass_secret' | null}
 */
export const routeCacheBypassOutcomeOf = ({ request, bypassSecret }) => {
  if (request?.[ROUTE_CACHE_BYPASS_REQUEST_FLAG] === true) {
    return 'bypass_in_process'
  }
  return isTheBypassSecret(request?.headers?.[ROUTE_CACHE_BYPASS_HEADER], bypassSecret) ? 'bypass_secret' : null
}

/**
 * Whether the request carried the bypass header (whatever its value) without it being honoured.
 * @param {any} request
 * @returns {boolean}
 */
export const isTheBypassHeaderRefusedFor = (request) => {
  const value = request?.headers?.[ROUTE_CACHE_BYPASS_HEADER]
  return value !== undefined && value !== null && value !== ''
}

/**
 * @param {{ routePath?: string | null, storage: string, outcome: string }} props
 */
export const countTheRouteCacheLookup = ({ routePath, storage, outcome }) => {
  lookupsCounter.add(1, { route: routePath || 'unknown', storage, outcome })
}

/**
 * @param {{ routePath?: string | null, storage: string, outcome: string }} props
 */
export const countTheRouteCacheStore = ({ routePath, storage, outcome }) => {
  storesCounter.add(1, { route: routePath || 'unknown', storage, outcome })
}

/**
 * @param {{ storage: string, credential: 'session' | 'bearer' | 'session_and_bearer' | null }} props
 */
export const countTheRouteCacheReaderCredential = ({ storage, credential }) => {
  if (credential) {
    readerCredentialsCounter.add(1, { storage, credential })
  }
}
