import bodyParser from 'body-parser';
import handleFiles from './handleFiles.js';
import processFunction from './processFunction.js';

export default async ({
  options,
  rateLimiter,
  servableArguments,
  url
}) => {
  // Servable.AppNative.use((req, res, next) => {
  //   res.append('Access-Control-Allow-Origin', ['*']);
  //   res.append('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
  //   res.append('Access-Control-Allow-Headers', 'Content-Type');
  //   next();
  // });

  if (!options.files) {
    Servable.AppNative.post(
      url,
      // _cache({ cache: options.cache }),
      rateLimiter({
        rateLimiting: options.rateLimiting
      }),
      bodyParser.raw({
        type: (options.request && options.request.type) ? options.request.type : 'application/json'
      }),
      async (request, response, next) => {
        await processFunction({
          servableArguments,
          options,
          request,
          response,
          next
        })
      })
    return
  }

  return handleFiles({
    url,
    options,
    rateLimiter,
    servableArguments,
  })
}
