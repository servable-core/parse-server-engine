
// import bodyParser from 'body-parser'
import multer from 'multer'
import requestAdapter from '../../adapters/request.js'
import processFunction from './processFunction.js'

// import sanitizeFilename from 'sanitize-filename'
import sanitizePath from 'path-sanitizer'


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
    // multer({ dest: 'uploads/' }).single('file'),
    // upload.single('file'),
    upload.array('files'),
    // bodyParser.raw({
    //   type: _request.type ? _request.type : 'application/json'
    // }),
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
        handler: options.handler,
        request,
        response,
        next,
        extra: {
          files
        },
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

const uriFromStorage = ({ storage, file, name }) => {
  const {
    type,
    params
  } = storage
  let uri
  switch (type) {
    case 'minio': {
      uri = `https://${params.endPoint}/${params.bucketName}/${name ? name : file.originalname}`
      break
    }
    default: {
      break
    }
  }

  return uri
}
// https://expressjs.com/en/resources/middleware/multer.html
// fieldNameSize	Max field name size	100 bytes
// fieldSize	Max field value size (in bytes)	1MB
// fields	Max number of non-file fields	Infinity
// fileSize	For multipart forms, the max file size (in bytes)	Infinity
// files	For multipart forms, the max number of file fields	Infinity
// parts	For multipart forms, the max number of parts (fields + files)	Infinity
// headerPairs	For multipart forms, the max number of header key=>value pairs to parse	2000
