import memory from "./memory/index.js"
import redis from "./redis/index.js"
import empty from "../empty.js"

export default ({ cache = {} }) => {
  const { type, params } = cache
  switch (type) {
    case 'inMemory': {
      const {
        window = 10,
        extent = 'user'
      } = params
      return memory({
        duration: window,
        extent
      })
    }
    case 'redis': {
      const {
        window = 10,
        extent = 'user'
      } = params
      return redis({
        duration: window,
        extent,
        redisUrl: process.env.APP_REDIS_URI
      })
    }
    default: {
      return empty
    }
  }
}
