import * as Minio from 'minio'
import multerMinIOStorage from 'multer-minio-storage'

export default ({ bucketName, endPoint,
  accessKey,
  secretKey, nameAdapter }) => {

  const minioClient = new Minio.Client({
    endPoint,
    accessKey,
    secretKey,
  })

  // @ts-expect-error - a real type-definition mismatch, not a bug: multer-minio-storage's own
  // .d.ts uses TS's `export =` (a single callable, for `import x = require(...)`-style
  // consumption), which declares no `.default`. This file's real default import
  // (`import multerMinIOStorage from 'multer-minio-storage'`) is a plain ESM default import
  // though, and the package's actual published `lib/index.js` sets
  // `module.exports = { default: fn, AUTO_CONTENT_TYPE, DEFAULT_CONTENT_TYPE, __esModule: true }`
  // - so at runtime `multerMinIOStorage` (bound to that whole object) really does have a callable
  // `.default`. Confirmed by importing this exact package under this exact import form in a
  // scratch script rather than trusting the type error at face value - a first attempt assuming
  // an extra level of interop-synthesized `.default` (based on testing `import * as` instead of
  // this file's real default import, which behaves differently under Node's CJS/ESM interop) was
  // wrong and would have broken a currently-working call (found via checkJs, lucide/PEAKUB DX
  // initiative).
  const storage = multerMinIOStorage.default({
    minioClient: minioClient,
    bucket: bucketName,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname })
    },
    key: async function (req, file, cb) {
      // cb(null, Date.now().toString())
      const name = await nameAdapter({ file, request: req })
      cb(null, name)
    }
  })

  return storage
}
