// lucide (PEAKUB DX initiative): the engine-specific half of the `Servable.App` surface. See
// @servable/server's own global.d.ts for the engine-agnostic half (Services, Operations,
// Config, ...) and for why `ServableApp` is declared as an open, mergeable interface there rather
// than typed fully in one place - this file is the merge that sharpens it for
// @servable/parse-server-engine, modeled from `src/register/index.js` (the function that
// actually builds it).
//
// A consuming app wires both in from its own jsconfig.json/tsconfig.json, e.g.:
//   { "include": ["node_modules/@servable/server/global.d.ts",
//                 "node_modules/@servable/parse-server-engine/global.d.ts", "**/*.js"] }
//
// Most branches below reference the `parse` package's own bundled types directly (Cloud, User,
// Role, File, Installation, LiveQuery, Session, Schema, Config, ACL) since register/index.js
// hands those straight through unmodified. `Object` and `Query` are typed against this engine's
// own subclasses (see register/object/index.js, register/query/index.js) - both change real
// behavior (subclass-aware construction; useMasterKey defaulted on reads) that's worth surfacing
// in autocomplete/docs, not just structurally matching Parse's own types. `Route`, `Jobs` and
// `Transaction` are internal, imperative builder objects with no natural TS equivalent worth
// modeling precisely yet - loosely typed rather than left as a black-box `any`.
//
// `import(...)` type queries (rather than a top-level `import` statement) are used throughout so
// this file's declarations stay reachable from `declare global` merging the way the rest of this
// package expects - a top-level `import`/`export` turns a file into a module either way (this one
// already is one, via the `export {}` at the bottom), so that's not the concern here; it's purely
// to keep the Parse type references colocated with the members that use them, one per line.

declare global {
  /** parse-server's own `require('parse/node')` sets this as a real runtime global (a side
   * effect of importing the `parse` package's Node entrypoint) - this engine's own `register/*`
   * modules rely on that directly rather than importing `parse` a second time, since a second
   * independent import would produce a different `Parse.Object` to extend/reference, breaking
   * `instanceof` checks against the real one (see register/query/index.js's own comment on this).
   * Declared here so that convention gets real autocomplete/type-checking too, for this engine's
   * own code and for any consuming app that writes cloud-code-style bare `Parse.X` itself. */
  // eslint-disable-next-line no-var
  var Parse: typeof import('parse')

  /** Servable.App.Route - registers HTTP routes; see register/route/index.js. */
  interface ServableAppRoute {
    define(options: Record<string, any>): Promise<any>
    [key: string]: any
  }

  /** Servable.App.Jobs - defines/schedules background jobs (Agenda-backed); see
   * register/jobs/index.js. */
  interface ServableAppJobs {
    define(options: Record<string, any>): Promise<any>
    [key: string]: any
  }

  /** Servable.App.Transaction - see @servable/server's Transaction taxonomy doc
   * (server/src/domain/servable/transaction/index.js) for the contract this implements against
   * Parse Server's own saveAll()/destroyAll({ transaction: true }). */
  interface ServableAppTransaction {
    readonly state: 'open' | 'committed' | 'aborted' | 'failed'
    readonly token: string
    commit(): Promise<any>
    rollback(): Promise<any>
    [key: string]: any
  }

  interface ServableApp {
    /** Parse.Object, except constructing by class name resolves the registered subclass (so
     * protocol mixins are present from birth) - see register/object/index.js. */
    Object: typeof import('parse').Object

    /** Parse.Query, with read methods (find/first/get/count/each/eachBatch/map/reduce/filter)
     * defaulting `useMasterKey: true` - see register/query/index.js. Writes still need
     * `useMasterKey` passed explicitly via `Object`. */
    Query: typeof import('./src/register/query/index.js').default

    Cloud: typeof import('parse').Cloud
    User: typeof import('parse').User
    Role: typeof import('parse').Role
    File: typeof import('parse').File
    Installation: typeof import('parse').Installation
    LiveQuery: typeof import('parse').LiveQuery
    Session: typeof import('parse').Session
    Schema: typeof import('parse').Schema
    Config: typeof import('parse').Config
    ACL: typeof import('parse').ACL

    Transaction: ServableAppTransaction
    Route: ServableAppRoute
    Jobs: ServableAppJobs

    /** Misc Parse-adjacent helpers - see register/parse/utils/index.js. */
    Utils: Record<string, any>
  }
}

export {}
