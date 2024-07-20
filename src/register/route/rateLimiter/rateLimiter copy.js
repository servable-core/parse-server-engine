import rateLimit from 'express-rate-limit'

export default (options) => rateLimit(options)

// {
//   windowMs: 60 * 60 * 1000, // 1 hour
//   max: 1000, // Limit each IP to 5 create account requests per `window` (here, per hour)
//   message:
//     'Too many requests from this IP, please try again after an hour',
//   standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
//   legacyHeaders: false, // Disable the `X-RateLimit-*` headers
// }
