import empty from './empty.js'
import cache from './cache/index.js'
import rateLimiter from './rateLimiter/index.js'

// Regression guard for a route that declares no cache (or no rateLimiting) block. Both modules
// fall back to `empty` and pass it straight into the Express chain, so if it ever stops being a
// real (req, res, next) middleware the request gets no response at all - it hangs forever with
// no error, which is exactly how this shipped: every route in the consuming app happened to
// declare both blocks, so the fallback was never exercised until one was removed.
const run = (middleware) => new Promise((resolve, reject) => {
    const timer = setTimeout(
        () => reject(new Error('middleware never called next() - the request would hang forever')),
        1000,
    )
    middleware({ headers: {}, url: '/x', method: 'GET' }, { send: () => { } }, (err) => {
        clearTimeout(timer)
        if (err) {
            reject(err)
            return
        }
        resolve('next called')
    })
})

describe('empty middleware', () => {
    it('calls next() when used directly as middleware', async () => {
        await expect(run(empty)).resolves.toBe('next called')
    })
})

describe('cache fallback', () => {
    it('passes through when a route declares no cache at all', async () => {
        await expect(run(cache({}))).resolves.toBe('next called')
    })

    it('passes through when a route declares no configurations', async () => {
        await expect(run(cache({ cache: { configurations: [] } }))).resolves.toBe('next called')
    })

    it('passes through when every configuration names an unrecognized storage', async () => {
        await expect(
            run(cache({ cache: { configurations: [{ storage: 'not-a-real-storage', window: 10 }] } })),
        ).resolves.toBe('next called')
    })
})

describe('rateLimiter fallback', () => {
    it('passes through when a route declares no rateLimiting', async () => {
        await expect(run(rateLimiter({}))).resolves.toBe('next called')
    })

    it('passes through when rateLimiting declares an unrecognized type', async () => {
        await expect(run(rateLimiter({ rateLimiting: { type: 'not-a-real-type' } }))).resolves.toBe('next called')
    })
})
