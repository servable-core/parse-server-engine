import express from "express";
import compression from 'compression';
// import bodyParser from 'body-parser'
import qs from 'qs';
import cookieParser from "cookie-parser";
import cors from 'cors';

// Cheap in-process TTL cache in front of a consumer-supplied isOriginAllowed hook, so a burst of
// requests from the same origin doesn't round-trip to whatever store the consumer backs it with
// (Redis, a DB, ...) on every single request. Negative results get a shorter TTL so a
// spoofed/bad-actor origin can't wedge a false answer in for as long as a real one.
const createCachedOriginResolver = (isOriginAllowed, {
  positiveTtlMs = 30 * 1000,
  negativeTtlMs = 5 * 1000,
} = {}) => {
  const cache = new Map() // hostname -> { allowed, expiresAt }

  return async (hostname) => {
    const cached = cache.get(hostname)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.allowed
    }

    let allowed = false
    try {
      allowed = await isOriginAllowed(hostname)
    } catch (error) {
      console.error("[ENGINE] isOriginAllowed hook threw:", error)
      allowed = false
    }

    cache.set(hostname, {
      allowed,
      expiresAt: Date.now() + (allowed ? positiveTtlMs : negativeTtlMs),
    })
    return allowed
  }
}

const normalizeOrigin = (origin) => origin
  .toLowerCase()
  .replace(/^https?:\/\//, "")
  .replace(/:\d+$/, "")
  .replace(/\/$/, "")
  .trim()

export default async ({ servableConfig }) => {
  const app = express()
  app.use(compression())

  // app.use(express.json({
  //   limit: servableConfig.envs['engineMaxUploadSize'],
  // }))

  app.use(cookieParser());       // ✅ parses cookies into req.cookies

  const corsOptions = servableConfig.configuration?.config?.cors || {};
  const { allowedOrigins, isOriginAllowed } = corsOptions;
  console.log("[ENGINE] corsOptions", corsOptions);

  // Normalized once at boot instead of per-request. This list is expected to stay small (a
  // handful of platform apex/wildcard domains) - a large, dynamic allow-list (e.g. tens of
  // thousands of verified customer domains) belongs behind isOriginAllowed instead, which keeps
  // this engine storage-agnostic: it never needs to know what a consumer backs it with (Redis, a
  // DB, ...), it just calls the hook.
  const normalizedAllowedOrigins = (allowedOrigins || []).map(normalizeOrigin)

  // Kill switch for the isOriginAllowed hook specifically (not this whole file) - set
  // SERVABLE_CORS_DISABLE_DYNAMIC_ORIGIN=1 on the running pod and restart it to instantly fall
  // back to the pre-existing static-allowedOrigins-only behavior, with no new image/rebuild
  // needed (unlike removing isOriginAllowed from a consumer's servable.config.js, which does
  // require a redeploy of that consumer). Added specifically so this can be rolled back fast
  // before this engine change has run live - remove once it's proven safe in production, or
  // keep indefinitely as a standing emergency lever, your call.
  const dynamicOriginDisabled = ['1', 'true'].includes(
    String(process.env.SERVABLE_CORS_DISABLE_DYNAMIC_ORIGIN).toLowerCase()
  )
  if (dynamicOriginDisabled && isOriginAllowed) {
    console.warn(
      "[ENGINE] SERVABLE_CORS_DISABLE_DYNAMIC_ORIGIN is set - ignoring the configured " +
      "isOriginAllowed hook, falling back to allowedOrigins-only CORS matching."
    )
  }
  const cachedIsOriginAllowed = (isOriginAllowed && !dynamicOriginDisabled)
    ? createCachedOriginResolver(isOriginAllowed)
    : null

  if (normalizedAllowedOrigins.length || cachedIsOriginAllowed) {
    app.use(cors({
      origin: async (origin, callback) => {
        if (!origin) return callback(null, true); // allow curl/Postman

        try {
          const hostname = new URL(origin).hostname.toLowerCase();

          for (const allowedOrigin of normalizedAllowedOrigins) {
            // ✅ Fast path: exact apex match
            if (hostname === allowedOrigin) {
              // console.log(`[CORS] Allowed apex: ${hostname}`);
              return callback(null, true);
            }

            // ✅ Subdomain match
            if (hostname.endsWith(`.${allowedOrigin}`)) {
              // console.log(`[CORS] Allowed subdomain: ${hostname}`);
              return callback(null, true)
            }
          }

          // Fallback for large/dynamic allow-lists a consumer app manages itself (e.g. verified
          // custom domains) - only ever consulted once the small static list above misses.
          if (cachedIsOriginAllowed && await cachedIsOriginAllowed(hostname)) {
            return callback(null, true);
          }

          console.warn(`[CORS] ❌ Blocked origin: ${origin}`);
          return callback(new Error("Not allowed by CORS"));
        } catch (err) {
          console.error("[ENGINE] Invalid origin:", origin, err);
          return callback(new Error("Invalid origin"));
        }
      },
      credentials: true,
      optionsSuccessStatus: 200,
    }));
  } else {
    app.use(cors());
  }

  app.use(express.urlencoded({
    limit: servableConfig.envs['engineMaxUploadSize'],
    extended: true,
    parameterLimit: 1000000
  }))

  const numberRegex = /^-?\d+(\.\d+)?$/

  app.set('query parser',
    (str) => qs.parse(
      str,
      {
        allowDots: true,
        decoder: (str, defaultDecoder, charset, type) => {
          // const val = defaultDecoder(str, defaultDecoder, charset, type);
          // if (/^\d+$/.test(val)) {
          //   return Number(val);
          // }
          // return val;
          const val = defaultDecoder(str, defaultDecoder, charset, type);

          // Only convert if it looks like a number
          if (typeof val === 'string' && numberRegex.test(val)) {
            const num = Number(val);
            // Ensure not NaN
            if (!Number.isNaN(num)) {
              return num;
            }
          }

          if (typeof val === 'string' && (val === 'false')) {
            return false
          }

          if (typeof val === 'string' && (val === 'true')) {
            return true
          }

          return val;
        }
      }))

  return app
}
