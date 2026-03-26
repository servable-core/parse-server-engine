import ParseServer from "parse-server"

export default ({ payload }) => {
  if (!payload.redisCacheUri) {
    // console.warn("[@servable/parse-server-engine/setConfigurations/adapt.js] createCacheAdapter() → No redisCacheUri provided in payload. Cache adapter will not be used.")
    return null
  }

  const normalizedRedisCacheUri = String(payload.redisCacheUri).trim().includes("://")
    ? String(payload.redisCacheUri).trim()
    : `redis://${String(payload.redisCacheUri).trim()}`

  // Const redisOptions = { url: process.env.SERVABLE_REDIS_URL, db: process.env.SERVABLE_REDIS_DB }
  const redisOptions = { url: normalizedRedisCacheUri }
  const engine = new ParseServer.RedisCacheAdapter(redisOptions)
  console.log("[@servable/parse-server-engine/setConfigurations/adapt.js] createCacheAdapter() → Redis cache adapter created")

  return engine
}
