import { ParseServer } from "parse-server"

// HIGH-PRIORITY, deliberately left unresolved rather than guess-fixed (found via checkJs,
// lucide/PEAKUB DX initiative): `createLiveQueryServer(httpServer, config, options)`'s real
// signature (node_modules/parse-server/types/ParseServer.d.ts) takes a `config` (live-query
// class/permission options) and `options` (the full ParseServerOptions) - neither is passed here,
// nor anywhere in the one real call chain into this function
// (@servable/server's launch/liveServer/index.js calls `engine.launchLiveServer({ httpServer })`,
// also with nothing else). At runtime this doesn't crash - parse-server's own implementation
// (lib/ParseServer.js's `createLiveQueryServer`) treats a missing `config` as "don't
// self-provision an http server", not as a hard requirement - but it does mean this live query
// server currently starts with NO class/permission config at all. Separately, parse-server's own
// `start()` (lib/ParseServer.js:434) ALREADY calls `createLiveQueryServer` itself whenever the
// app's own `servableConfig.parse.liveQueryServerOptions` is set (see doLaunch/index.js, which
// spreads the app's whole parse config into `options` unmodified) - so if that's ever set, this
// module runs a SECOND, differently-configured live query server on the same `httpServer`. Worth
// a real product decision (delete this module in favor of `liveQueryServerOptions`, or wire
// through the missing config/options here and confirm the two can't both fire) rather than a
// guess.
export default async ({ httpServer, }) => {
  console.log("[PARSE_SERVER_ADAPTER]", `Launch > Live query > Start`)
  // @ts-expect-error - see the module-level note above.
  ParseServer.createLiveQueryServer(httpServer)
  console.log("[PARSE_SERVER_ADAPTER]", `Launch > Live query > Success`)
}
