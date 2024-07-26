
// import bodyParser from 'body-parser'
import sanitizePath from 'path-sanitizer'
import multer from 'multer'
import requestAdapter from '../../adapters/request.js'

export default async ({
  options,
  path,
  prefix,
  rateLimiter,
  processHttp
}) => {

  const {
    validateFile,

  } = options
  const {
    type,
    params
  } = options.storage

  let __url = prefix ? `${prefix}/${path}` : path
  __url = `/${sanitizePath(__url)}`

  let storage = null
  switch (type) {
    case 'minio': {
      const minio = (await import('./storages/minio.js')).default
      storage = minio({ ...params })
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

  const fileFilter = validateFile ? async (req, file, cb) => {
    const request = requestAdapter({ request: req })
    const isValidated = await validateFile({
      request,
      file
    })
    cb(null, isValidated)
  } : null
  const limits = options.limits ? adaptLimits(options.limits) : null
  const upload = multer({
    storage,
    fileFilter,
    limits
  })

  Servable.AppNative.post(
    __url,
    rateLimiter({
      rateLimiting: options.rateLimiting
    }),
    upload.single('file'),
    // bodyParser.raw({
    //   type: _request.type ? _request.type : 'application/json'
    // }),
    async (request, response, next) => {
      await processHttp({
        servableArguments,
        handler,
        request,
        response,
        next
      })
    })
}


const adaptLimits = (limits) => {
  const d = {}
  if (limits.fieldNameSize !== undefined) {
    d.fieldNameSize = limits.fieldNameSize
  }
  if (limits.size !== undefined) {
    d.fieldSize = limits.size
  }
  if (limits.fields !== undefined) {
    d.fields = limits.fields
  }
  if (limits.fileSize !== undefined) {
    d.fileSize = limits.fileSize
  }
  if (limits.files !== undefined) {
    d.files = limits.files
  }
  if (limits.parts !== undefined) {
    d.parts = limits.parts
  }
  if (limits.headerPairs !== undefined) {
    d.headerPairs = limits.headerPairs
  }
  return d
}


// https://expressjs.com/en/resources/middleware/multer.html
// fieldNameSize	Max field name size	100 bytes
// fieldSize	Max field value size (in bytes)	1MB
// fields	Max number of non-file fields	Infinity
// fileSize	For multipart forms, the max file size (in bytes)	Infinity
// files	For multipart forms, the max number of file fields	Infinity
// parts	For multipart forms, the max number of parts (fields + files)	Infinity
// headerPairs	For multipart forms, the max number of header key=>value pairs to parse	2000
