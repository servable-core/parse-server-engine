import ParseServer from "parse-server"

export default ({ payload }) => {
  if (!payload.redisCacheUri) {
    return null
  }

  const normalizedRedisCacheUri = String(payload.redisCacheUri).trim().includes("://")
    ? String(payload.redisCacheUri).trim()
    : `redis://${String(payload.redisCacheUri).trim()}`

  // Const redisOptions = { url: process.env.SERVABLE_REDIS_URL, db: process.env.SERVABLE_REDIS_DB }
  const redisOptions = { url: normalizedRedisCacheUri }
  const engine = new ParseServer.RedisCacheAdapter(redisOptions)
  return engine
}
