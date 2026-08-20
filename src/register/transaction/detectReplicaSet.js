import { MongoClient } from 'mongodb'

// Whether Parse.Object.saveAll()/destroyAll() with { transaction: true } can
// actually commit atomically depends on MongoDB being a replica set - a
// standalone mongod rejects session.startTransaction() at the first write,
// not at session-creation time. That failure reaches a Transaction.commit()
// caller as a generically-sanitized Parse "Internal server error" (parse-server
// deliberately doesn't leak internal error text over the wire) - indistinguishable
// from any other unrelated commit failure by error code/message alone. So
// this checks the real topology directly instead of trying to sniff the
// error, and is only ever called *after* a commit has already failed, to
// decide whether that failure was topology-related (fall back) or a real
// error (rethrow it unchanged).
//
// Returns true ONLY when standalone is confirmed - every other outcome
// (replica set confirmed, or the check itself couldn't run) returns false,
// so the caller's default is to let the original commit error propagate
// unchanged rather than risk masking a real, unrelated failure as "just no
// replica set".
//
// Cached for the process lifetime - MongoDB topology doesn't change without
// a restart, and this avoids paying a connection round-trip on every
// transaction once the answer is known.
// The resolved databaseURI isn't always the literal ENGINE_DATABASE_URI env
// var - servable's own local-dev bootstrapping (system/index.js's
// adaptAppPayload) constructs it dynamically from the docker-compose mongo
// service when that env var isn't set, and only ever writes the result to
// servableConfig.envs.databaseURI (mutated in place as launch proceeds, so
// reading it lazily here - not at Transaction-construction time - sees the
// fully-resolved value once launchSystem has run). Prefer that over the raw
// env var; fall back to the env var for callers that don't thread
// servableConfig through (e.g. these unit tests).
let cachedIsConfirmedStandalone = null

export default async ({ servableConfig } = {}) => {
  if (cachedIsConfirmedStandalone !== null) {
    return cachedIsConfirmedStandalone
  }

  const uri =
    servableConfig?.envs?.databaseURI || process.env.ENGINE_DATABASE_URI
  if (!uri) {
    return false
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 })
  try {
    await client.connect()
    const hello = await client.db().admin().command({ hello: 1 })
    cachedIsConfirmedStandalone = typeof hello?.setName !== 'string'
  } catch (error) {
    console.warn(
      '[Servable Transaction] Could not verify MongoDB replica-set status:',
      error?.message || error
    )
    cachedIsConfirmedStandalone = false
  } finally {
    await client.close().catch(() => {})
  }

  return cachedIsConfirmedStandalone
}
