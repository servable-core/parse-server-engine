//import fsw from 'filendir'
import sharp from 'sharp'
import { parser } from 'query-string-parse'
import axios from "axios"
import stream from 'stream'

const cachedExists = async () => {
  return false
}

export default (path) => {

  return async (request, response, next) => {
    const parts = request.url.split('/')
    parts.shift() // remove first slash
    parts.shift() // remove api-slug (differs per parse-config)
    const isFile = parts.length == 3 & parts[0] == "files"
    //const parrr = urlParse(req.url)

    const reppm = parser(request.url)
    const {
      w,
      q = process.env.PARSE_SERVER_IMAGE_RESIZING_QUALITY } = reppm

    if (!w || !isFile) {
      return next()
    }

    console.log("[PARSE_SERVER_ADAPTER]", "----------imagehost", "url", request.url)
    console.log("[PARSE_SERVER_ADAPTER]", "----------imagehost", "reppm", reppm)

    const width = parseInt(w)
    const quality = parseFloat(q)
    const url = `${process.env.PUBLIC_SERVER_URL}${Object.keys(reppm)[0]}`

    console.log("[PARSE_SERVER_ADAPTER]", "----------imagehost", "c url", url)
    const input = await fetchFile({ url })
    const buffer = await sharp(input)
      .resize(width)
      .webp({ quality })
      .toBuffer({ resolveWithObject: true })

    if (!buffer || !buffer.data) {
      return
    }

    var minutes = 60
    var hours = 24
    var days = 3
    var duration = (((1000 * 60) * minutes) * hours) * days
    response.set('Content-Type', 'image/webp')
    // res.sendFile(buffer.data, { maxAge: duration })
    //response.set('Content-disposition', 'attachment; filename=' + url.split('/')[url.split('/').length - 1]);

    var readStream = new stream.PassThrough()
    readStream.end(buffer.data)

    //res.set('Content-disposition', 'attachment; filename=' + fileName);
    //res.set('Content-Type', 'text/plain');

    readStream.pipe(response, { maxAge: duration })

    // const data = { base64: buffer.data.toString("base64") };
    // const file = new Servable.App.File('avatar', data, 'image/webp')
    // await file.save({ useMasterKey: true })



    // resize.read(file, (err, handle) => {
    //     if (err) {
    //         return res.end(err.toString())
    //     }
    //     handle.resize(width, resize.AUTO).quality(100)
    //     handle.getBase64(resize.MIME_PNG, function (err, imageResized) {
    //         if (err) return res.end(err)
    //         //fsw.writeFileSync(fileResized, Buffer.from(stripBase64Header(imageResized), 'base64'), 'base64')
    //         serveImage(fileResized, res)
    //     })
    // })
  }
}

const stripBase64Header = (base64str) => {
  return base64str.replace(/^.*base64,/, '')
}

// lodash get
const get = function get(xs, x, fallback) {
  return String(x).split('.').reduce(function (acc, x) {
    if (acc == null || acc == undefined) return fallback
    return new Function("x", "acc", "return acc['" + x.split(".").join("']['") + "']")(x, acc) || fallback
  }, xs)
}

const serveImage = function (file, res) {
  var minutes = 60
  var hours = 24
  var days = 3
  var duration = (((1000 * 60) * minutes) * hours) * days
  res.set('Content-Type', 'image/png')
  res.sendFile(file, { maxAge: duration })
}


const fetchFile = async ({ url }) => {
  try {
    if (!url) {
      return null
    }
    const rawBuffer = await axios({ url, responseType: "arraybuffer" })
    if (!rawBuffer) {
      return null
    }

    return rawBuffer.data

  } catch (e) {

    console.error(e)
  }
  return null
}
