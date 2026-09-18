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

  /** Every app class's own field shape, keyed by class name - e.g. `{ Reaction: Reaction }`.
   * Deliberately empty here (not given a fallback index signature - see
   * @servable/server's own `ServableServiceCallMap` for why: an index signature would widen
   * `keyof` back to plain `string`, defeating the one thing this exists for). Sharpened per-app
   * by @servable/tools' `generateSchemaTypes()`, the same command that already generates a
   * plain interface per class - it also merges each one in here under its own name.
   *
   * lucide 0.7 (typed-object), PEAKUB DX initiative: added alongside `Typed` below rather than
   * by retrofitting `Object`/`Query` themselves - a real survey of this codebase's own call
   * sites found ~235 places (dominated by `new Servable.App.Query(this.className)`, present in
   * every single subclass's own class.js) that pass a non-literal string and would have become
   * new, 100%-false-positive errors under a strict-only `Object`/`Query` signature, with no way
   * to keep those working AND catch a bad literal at the same time (TypeScript's overload
   * resolution tries a permissive `string` fallback before rejecting a bad literal, so a
   * fallback loose enough not to break those sites is also loose enough to accept a typo like
   * '_Reaction' silently - confirmed via a standalone tsc test before choosing this design
   * instead). `Object`/`Query` themselves are therefore untouched, zero regression risk; `Typed`
   * is a new, separate, fully opt-in surface for whoever wants real validation on a literal
   * class name. */
  interface ServableClassMap {
  }

  /** A Parse.Object narrowed to a specific app class's real fields - `.get()`/`.set()` are
   * checked against `T` instead of accepting any string. Everything else (`.save()`, ACL,
   * etc.) still behaves like a normal Parse.Object; only these two are overridden. */
  interface TypedParseObject<T> {
    get<K extends keyof T>(attr: K): T[K]
    set<K extends keyof T>(attr: K, value: T[K]): this
    id: string
    className: string
    save(attrs?: Record<string, any>, options?: Record<string, any>): Promise<this>
    destroy(options?: Record<string, any>): Promise<this>
    fetch(options?: Record<string, any>): Promise<this>
    toJSON(): Record<string, any>
  }

  /** A Parse.Query narrowed the same way `TypedParseObject` narrows Object - `equalTo`/etc. and
   * every read method's results are checked against/return `T`. */
  interface TypedParseQuery<T> {
    equalTo<K extends keyof T>(key: K, value: T[K]): this
    notEqualTo<K extends keyof T>(key: K, value: T[K]): this
    exists<K extends keyof T>(key: K): this
    doesNotExist<K extends keyof T>(key: K): this
    ascending<K extends keyof T>(key: K): this
    descending<K extends keyof T>(key: K): this
    select<K extends keyof T>(...keys: K[]): this
    include<K extends keyof T>(...keys: K[]): this
    limit(n: number): this
    skip(n: number): this
    find(options?: Record<string, any>): Promise<TypedParseObject<T>[]>
    first(options?: Record<string, any>): Promise<TypedParseObject<T> | undefined>
    get(objectId: string, options?: Record<string, any>): Promise<TypedParseObject<T>>
    count(options?: Record<string, any>): Promise<number>
    [key: string]: any
  }

  /** `Servable.App.Typed` - see `ServableClassMap`'s own comment for why this exists as a
   * separate, opt-in surface instead of sharpening `Object`/`Query` themselves. Real
   * implementation just constructs a normal `Object`/`Query` (see register/typed/index.js) -
   * this interface is the only thing that changes. */
  interface ServableTyped {
    object<K extends keyof ServableClassMap>(className: K): TypedParseObject<ServableClassMap[K]>
    query<K extends keyof ServableClassMap>(className: K): TypedParseQuery<ServableClassMap[K]>
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

    /** Opt-in, validated alternative to `new Object(className)`/`new Query(className)` - see
     * `ServableClassMap`'s own comment for why this is separate rather than a change to those.
     * Real implementation: register/typed/index.js. */
    Typed: ServableTyped

    /** Misc Parse-adjacent helpers - see register/parse/utils/index.js. */
    Utils: Record<string, any>
  }
}

export {}
