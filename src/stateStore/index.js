import { MongoClient } from 'mongodb'
import { COLLECTIONS } from './collections.js'

// utilless (PEAKUB-321) - this engine's implementation of @servable/server's state-store contract
// (see that package's src/lib/stateStore/index.js): the unischema compatibility floor and the
// seed/config boot state, stored in the same MongoDB Parse Server already uses, so they are backed
// up and restored together with the data they describe.
//
// Plain collections, deliberately NOT Parse classes: a Parse class would sit inside the very schema
// the compatibility floor guards (and the drift check covers), show up in the dashboard and REST
// API, and pick up protocol triggers. Parse only manages the classes listed in _SCHEMA and ignores
// these. The `servable_` prefix stays clear of Parse's own `_`-prefixed system classes.
//
// Own MongoClient rather than Parse's database adapter: the floor check runs before
// engine.launch(), when no ParseServer - and so no adapter - exists yet.
//
// The engine database is the ONLY database this package knows about: no utils database, no import
// code, no extra env var. An engine database with no state yet is a legitimate starting point - the
// floor defaults to 0, and the first boot simply re-runs the hash-skip passes for seeds and configs.
// An app upgrading from an older @servable/server copies its old state across with a throwaway
// script of its own (see this package's CLAUDE.md); boot-time data migration is what unischema
// removed, so don't add any back here.

export { COLLECTIONS } from './collections.js'

// Same resolution order as register/transaction/detectReplicaSet.js: servable's local-dev
// bootstrapping only ever writes the docker-compose-derived URI to servableConfig.envs.
export const resolveDatabaseURI = (servableConfig) =>
  servableConfig?.envs?.databaseURI
  || servableConfig?.configuration?.config?.parse?.databaseURI
  || process.env.ENGINE_DATABASE_URI

// mongodb 4.x resolves findOneAndUpdate to a ModifyResult ({ value, ok, ... }); 6.x resolves to the
// document itself. Accept both so a driver bump doesn't silently break every read-back.
const unwrap = (result) => (
  result && typeof result === 'object' && 'ok' in result && 'value' in result ? result.value : result
)

// Two writers upserting a brand-new unique key at the same time: one insert can lose with E11000
// even though the other writer's document now exists. Retrying once turns it into a plain update.
const withUpsertRetry = async (fn) => {
  try {
    return await fn()
  } catch (error) {
    if (error?.code === 11000) {
      return fn()
    }
    throw error
  }
}

export const ensureIndexes = (db) => Promise.all([
  db.collection(COLLECTIONS.schema).createIndex({ key: 1 }, { unique: true }),
  db.collection(COLLECTIONS.seed).createIndex({ type: 1, entityId: 1 }, { unique: true }),
  db.collection(COLLECTIONS.config).createIndex({ type: 1, entityId: 1 }, { unique: true }),
])

const bootCollection = (db, kind) => {
  if (kind !== 'seed' && kind !== 'config') {
    throw new Error(`Unknown boot state kind: ${kind}`)
  }
  return db.collection(COLLECTIONS[kind])
}

export const createStateStoreForDb = (db) => ({
  schemaState: {
    get: ({ key }) => db.collection(COLLECTIONS.schema).findOne({ key }, { projection: { _id: 0 } }),

    // One aggregation-pipeline update: `$max` is evaluated by MongoDB against the stored floor at
    // write time, so there is no intervening read to go stale. Never turn this into a
    // read-then-write - that shape let an old, low-floor pod regress an already-raised floor
    // (confirmed against a real MongoDB, see @servable/server's CLAUDE.md and
    // tests/integration/stateStore.test.js).
    recordApplied: ({ key, artifactHash, compatibilityFloor }) => withUpsertRetry(async () => unwrap(
      await db.collection(COLLECTIONS.schema).findOneAndUpdate(
        { key },
        [{
          $set: {
            key,
            artifactHash: { $literal: artifactHash },
            appliedAt: new Date(),
            compatibilityFloor: {
              $max: [{ $ifNull: ['$compatibilityFloor', 0] }, compatibilityFloor || 0],
            },
          },
        }],
        { upsert: true, returnDocument: 'after', projection: { _id: 0 } }
      )
    )),
  },

  bootState: {
    get: async ({ kind, type, entityId }) => bootCollection(db, kind)
      .findOne({ type, entityId }, { projection: { _id: 0 } }),

    save: ({ kind, type, entityId, fields = {} }) => withUpsertRetry(async () => {
      const { createdAt, ...rest } = fields
      const now = new Date()
      return unwrap(await bootCollection(db, kind).findOneAndUpdate(
        { type, entityId },
        {
          $set: { updatedAt: now, ...rest, type, entityId },
          $setOnInsert: { createdAt: createdAt || now },
        },
        { upsert: true, returnDocument: 'after', projection: { _id: 0 } }
      ))
    }),
  },
})

// One client per URI for the process lifetime, like mongoose's global connection was.
const clients = new Map()

const connect = (uri) => {
  if (!clients.has(uri)) {
    const connecting = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 })
      .connect()
      .catch(error => {
        clients.delete(uri)
        throw error
      })
    clients.set(uri, connecting)
  }
  return clients.get(uri)
}

export default async ({ servableConfig } = {}) => {
  const uri = resolveDatabaseURI(servableConfig)
  if (!uri) {
    throw new Error(
      'createStateStore: no engine database URI (servableConfig.envs.databaseURI or ENGINE_DATABASE_URI)'
    )
  }

  const client = await connect(uri)
  const db = client.db()
  await ensureIndexes(db)

  return createStateStoreForDb(db)
}
