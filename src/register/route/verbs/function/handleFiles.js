import bodyParser from 'body-parser'
import multer from 'multer'
import requestAdapter from '../../adapters/request.js'
import processFunction from './processFunction.js'
import sanitizePath from 'path-sanitizer'
import adaptLimits from './lib/adaptlimits.js'
import uriFromStorage from './lib/urifromstorage.js'

/**
 * Wires the multipart-upload middleware chain (rate limit -> multer -> body parser -> handler)
 * for one route's `options.files` configuration, then hands off to `processFunction`.
 * @param {object} props
 * @param {string} props.url
 * @param {any} props.options - a route's full options object (also forwarded whole to
 *   `processFunction`, which reads `.handler` itself); only `.files`/`.rateLimiting`/`.request`
 *   are read directly here.
 * @param {(props: { rateLimiting: any }) => import('express').RequestHandler} props.rateLimiter
 * @param {any} [props.servableArguments]
 */
export default async ({
  url,
  options,
  rateLimiter,
  servableArguments,
}) => {

  const {
    createObjectFile = true,
    validateFile = async ({ file }) => true,
    mimeTypes,
    metadata = {},
    tags = []
  } = options.files

  const {
    type,
    params
  } = options.files.storage

  const nameAdapter = async ({ file, request }) => {
    let res = file.name ? file.name : file.originalname
    if (options.files.nameAdapter) {
      res = await options.files.nameAdapter({ file, request })
    }
    res = sanitizePath.default(res)
    return res
  }

  let storage = null
  switch (type) {
    case 'minio': {
      const minio = (await import('./storages/minio.js')).default
      storage = minio({ ...params, nameAdapter })
      break
    }
    default:
    case 'memory': {
      storage = multer.memoryStorage()
      break
    }
  }

  if (!storage) {
    return
  }

  const fileFilter = async (req, file, cb) => {

    if (mimeTypes && mimeTypes.length) {
      let matches = 0
      const fileMimeType = file.mimetype.toLowerCase()
      for (const mimeType of mimeTypes) {
        if (fileMimeType.indexOf(mimeType.toLowerCase().trim()) === 0) {
          matches++
          continue
        }
      }
      if (matches === 0) {
        cb(null, false)
        return
      }
    }

    const request = requestAdapter({ request: req })
    const isValidated = await validateFile({
      request,
      file
    })
    cb(null, isValidated)
  }

  const limits = options.files.limits ? adaptLimits(options.files.limits) : null
  const upload = multer({
    storage,
    fileFilter,
    limits
  })

  Servable.AppNative.post(
    url,
    rateLimiter({
      rateLimiting: options.rateLimiting
    }),
    upload.array('files'),
    bodyParser.raw({
      type: (options.request && options.request.type) ? options.request.type : 'application/json'
    }),
    async (req, response, next) => {
      const request = requestAdapter({ request: req })
      const files = []
      if (req.files && req.files.length) {
        for (const native of req.files) {
          const name = await nameAdapter({ file: native, request })
          let object
          let uri
          let data
          const mimeType = native.mimetype

          if (native.buffer) {
            const buffer = native.buffer
            // const data = { base64: buffer.data.toString("base64") }
            let str = Buffer.from(buffer).toString("base64");
            data = { base64: str }
          }
          else {
            // `name` was commented out (along with `native.uri = uri` below) - without it,
            // `uriFromStorage` falls back to the raw, unsanitized `file.originalname` instead of
            // the sanitized name `nameAdapter` just computed above, for every non-buffer (minio)
            // upload (found via checkJs, lucide/PEAKUB DX initiative).
            uri = uriFromStorage({
              storage: options.files.storage,
              file: native,
              name
            })
            if (uri) {
              data = { uri }
            }
          }

          if (data && options.files.createObjectFile) {
            object = new Servable.App.File(
              name,
              data,
              mimeType,
              metadata,
              tags
            )
            //parseFile.setMetadata(metadata)
            //parseFile.setTags(tags)
            await object.save({
              progress: (progressValue) => {
                // Was a bare `onProgress` reference - not a param, not imported, not read from
                // `options` anywhere: calling it would throw a ReferenceError from inside Parse's
                // own progress callback on every save that reaches this line (found via checkJs,
                // lucide/PEAKUB DX initiative). Threaded through from `options.files.onProgress`
                // instead, mirroring the existing `options.files.nameAdapter` pattern above.
                options.files.onProgress && options.files.onProgress(progressValue)
              },
              useMasterKey: true
            })
          }

          files.push({
            native,
            object,
            name,
            uri
          })
        }
      }
      await processFunction({
        servableArguments,
        options,
        request,
        response,
        next,
        extra: {
          files
        },
      })
    })
}
