// lucide (PEAKUB DX initiative): dev-only ambient globals for THIS package's own `checkJs` run.
// Not published (deliberately absent from package.json's "files") and not meant to be included
// by a consuming app. `Servable` is owned by @servable/server's own global.d.ts, which types it
// precisely (`ServableRuntime`) - this package can't redeclare it at all without conflicting with
// that declaration wherever the two are combined (confirmed via a standalone tsc test: repeated
// `var` declarations of the same global must have identical types, with no `any`-is-compatible
// exception), which is exactly the combination this package's own `global.d.ts` is designed to
// support cleanly. So this file exists purely so `Servable.App.X`/`Servable.Console` etc. don't
// error out when checking this package in isolation, the way @servable/server itself is never
// present in this package's own tsconfig.
declare global {
  // eslint-disable-next-line no-var
  var Servable: any
}

export {}
