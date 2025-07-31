import bodyParser from 'body-parser'
import multer from 'multer'
import requestAdapter from '../../adapters/request.js'
import processFunction from './processFunction.js'
import sanitizePath from 'path-sanitizer'
import adaptLimits from './lib/adaptlimits.js'
import uriFromStorage from './lib/urifromstorage.js'

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
    res = sanitizePath(res)
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
            uri = uriFromStorage({
              storage: options.files.storage,
              file: native,
              // name
            })
            if (uri) {
              // native.uri = uri
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
                //+console.log('progressValue: ', progressValue)
                onProgress && onProgress(progressValue)
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
