import memory from "./memory/index.js"
import redis from "./redis/index.js"
import empty from "../empty.js"

const adaptStorage = (storage = '') => {
  const normalized = String(storage || '').trim().toLowerCase()
  switch (normalized) {
    case 'memory':
    case 'inmemory':
      return 'inMemory'
    case 'redis':
      return 'redis'
    default:
      return null
  }
}

const resolveModernConfigurations = ({ cache }) => {
  const { configurations = [] } = cache
  if (!Array.isArray(configurations) || !configurations.length) {
    return []
  }

  return configurations
    .map((item = {}) => {
      const storage = adaptStorage(item.storage)
      if (!storage) {
        return null
      }

      return {
        storage,
        window: item.window ?? 10,
        template: item.template || null
      }
    })
    .filter(Boolean)
}

const resolveConfigurations = ({ cache }) => {
  return resolveModernConfigurations({ cache })
}

const buildMiddleware = ({ configuration }) => {
  const {
    storage,
    window,
    template
  } = configuration

  switch (storage) {
    case 'inMemory': {
      return memory({
        duration: window,
        template
      })
    }
    case 'redis': {
      return redis({
        duration: window,
        template,
        redisUrl: process.env.APP_REDIS_URI
      })
    }
    default: {
      return empty
    }
  }
}

const isUserExists = (req) => {
  const sessionToken = req.headers?.['x-servable-session-token']
  return Boolean(sessionToken)
}

const matchTemplate = ({ template, req }) => {
  const normalizedTemplate = String(template || '').trim().toLowerCase()

  switch (normalizedTemplate) {
    case 'userexists':
      return isUserExists(req)
    case 'userdoesnotexist':
      return !isUserExists(req)
    default:
      return true
  }
}

const resolveConfigurationIndex = ({ configurations, req }) => {
  const index = configurations.findIndex((configuration) => {
    const { template } = configuration
    if (!template) {
      return false
    }

    return matchTemplate({ template, req })
  })

  if (index !== -1) {
    return index
  }

  const fallbackIndex = configurations.findIndex((configuration) => {
    const { template } = configuration
    return !template
  })

  return fallbackIndex !== -1 ? fallbackIndex : 0
}

export default ({ cache = {} }) => {
  const configurations = resolveConfigurations({ cache })
  if (!configurations.length) {
    return empty
  }

  const middlewares = configurations.map((configuration) => buildMiddleware({ configuration }))

  return (req, res, next) => {
    const index = resolveConfigurationIndex({
      configurations,
      req
    })

    const middleware = middlewares[index] || empty
    return middleware(req, res, next)
  }
}
