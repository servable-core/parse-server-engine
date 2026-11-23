import { MemoryStore } from 'express-rate-limit'

// One atomic step: count the hit, start the window on the first one, answer the hits and the window's time left.
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { hits, ttl }
`

// Takes one hit back, only while the counter exists (a window that already ended stays ended).
const DECREMENT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return redis.call('DECR', KEYS[1])
end
return 0
`

const COMMAND_TIMEOUT_MS = 250
const BREAKER_OPEN_MS = 5000
const LOG_EVERY_MS = 60000

const withTimeout = (promise, timeoutMs) => {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis did not answer within ${timeoutMs} ms`)), timeoutMs)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * An express-rate-limit store that counts in Redis so every pod shares one counter per route and visitor
 * (a fixed window: INCR, PEXPIRE on the first hit). Keys are `<prefix><routeKey>:<visitor key>`, so each route's
 * limiter counts on its own.
 *
 * Fails open to an in-memory store of this process: a Redis that cannot be reached, or that is slow, never blocks a
 * request. After a failure Redis is not tried again for a few seconds (so a down Redis adds no delay per request),
 * and the failure is logged at most once a minute.
 *
 * @param {object} props
 * @param {string} props.routeKey identifies the limiter (method and url of its route)
 * @param {() => Promise<any>} props.getClient resolves the Redis client, or null when there is none
 * @param {string} [props.keyPrefix]
 * @param {number} [props.commandTimeoutMs]
 * @param {() => number} [props.now]
 */
export default class RedisRateLimitStore {
  constructor ({ routeKey, getClient, keyPrefix = 'servable:ratelimit:', commandTimeoutMs = COMMAND_TIMEOUT_MS, now = () => Date.now() }) {
    this.prefix = `${keyPrefix}${routeKey}:`
    this.localKeys = false
    this.getClient = getClient
    this.commandTimeoutMs = commandTimeoutMs
    this.now = now
    this.windowMs = 60000
    this.fallbackStore = new MemoryStore()
    this.breakerOpenUntil = 0
    this.lastLoggedAt = -Infinity
  }

  init (options) {
    this.windowMs = options.windowMs
    this.fallbackStore.init?.(options)
  }

  isRedisSkipped () {
    return this.now() < this.breakerOpenUntil
  }

  noteFailure (error) {
    this.breakerOpenUntil = this.now() + BREAKER_OPEN_MS
    if (this.now() - this.lastLoggedAt >= LOG_EVERY_MS) {
      this.lastLoggedAt = this.now()
      console.error('[@servable/parse-server-engine/rateLimiter/redis] Redis is not available, counting in memory on this pod', error?.message || error)
    }
  }

  async run (script, key, args = []) {
    const client = await withTimeout(this.getClient(), this.commandTimeoutMs)
    if (!client) {
      throw new Error('no Redis client')
    }
    return withTimeout(client.eval(script, { keys: [this.prefix + key], arguments: args }), this.commandTimeoutMs)
  }

  async increment (key) {
    if (!this.isRedisSkipped()) {
      try {
        const [totalHits, timeToLiveMs] = await this.run(INCREMENT_SCRIPT, key, [String(this.windowMs)])
        return { totalHits: Number(totalHits), resetTime: new Date(this.now() + Number(timeToLiveMs)) }
      } catch (error) {
        this.noteFailure(error)
      }
    }
    return this.fallbackStore.increment(key)
  }

  async decrement (key) {
    if (!this.isRedisSkipped()) {
      try {
        await this.run(DECREMENT_SCRIPT, key)
        return
      } catch (error) {
        this.noteFailure(error)
      }
    }
    return this.fallbackStore.decrement(key)
  }

  async resetKey (key) {
    this.fallbackStore.resetKey(key)
    if (!this.isRedisSkipped()) {
      try {
        const client = await withTimeout(this.getClient(), this.commandTimeoutMs)
        await withTimeout(client.del(this.prefix + key), this.commandTimeoutMs)
      } catch (error) {
        this.noteFailure(error)
      }
    }
  }

  shutdown () {
    this.fallbackStore.shutdown?.()
  }
}
