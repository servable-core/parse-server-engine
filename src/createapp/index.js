import express from "express";
import compression from 'compression';
// import bodyParser from 'body-parser'
import qs from 'qs';
import cookieParser from "cookie-parser";
import cors from 'cors';

export default async ({ servableConfig }) => {

  const app = express()
  app.use(compression())
  // app.use(cors(corsOptions))
  // app.use(express.json({
  //   limit: servableConfig.envs['engineMaxUploadSize'],
  // }))

  app.use(cookieParser());       // ✅ parses cookies into req.cookies

  const corsOptions = servableConfig.configuration?.config?.cors || {};
  const { allowedOrigins } = corsOptions;
  console.log("[ENGINE] corsOptions", corsOptions);

  if (allowedOrigins?.length) {
    app.use(cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true); // allow curl/Postman

        try {
          const hostname = new URL(origin).hostname.toLowerCase();

          for (let allowedOrigin of allowedOrigins) {
            // Clean up env inputs (remove protocol, ports, slashes, spaces)
            allowedOrigin = allowedOrigin
              .toLowerCase()
              .replace(/^https?:\/\//, "")
              .replace(/:\d+$/, "")
              .replace(/\/$/, "")
              .trim();

            // ✅ Fast path: exact apex match
            if (hostname === allowedOrigin) {
              // console.log(`[CORS] Allowed apex: ${hostname}`);
              return callback(null, true);
            }

            // ✅ Subdomain match
            if (hostname.endsWith(`.${allowedOrigin}`)) {
              // console.log(`[CORS] Allowed subdomain: ${hostname}`);
              return callback(null, true);
            }
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
