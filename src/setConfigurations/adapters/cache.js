import ParseServer from "parse-server"

export default ({ payload }) => {
  if (!payload.redisCacheUri) {
    return null
  }

  // Const redisOptions = { url: process.env.SERVABLE_REDIS_URL, db: process.env.SERVABLE_REDIS_DB }
  const redisOptions = { url: payload.redisCacheUri }
  return new ParseServer.RedisCacheAdapter(redisOptions)
}
