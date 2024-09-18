import resize from 'jimp'
import fs from 'fs'
//import fsw from 'filendir'

export default (path) => {

    return (req, res, next) => {
        const parts = req.url.split('/')
        parts.shift() // remove first slash 
        parts.shift() // remove api-slug (differs per parse-config)
        const isFile = parts.length == 3 & parts[0] == "files"
        if (!req.query.w || !isFile) {
            return next()
        }

        // if (!isFile) {
        //     return next()
        // }

        const fileBase = parts.pop().replace(/\?.*/, '')
        const file = process.cwd() + `/${path}/${fileBase}`
        const fileResized = file + `.${req.query.w}.png`
        const urlResized = req.url.replace(fileBase, fileBase + `.${req.query.w}.png`)
            .replace(/\?.*/, '')
        // let static middleware serve image if already resized
        if (fs.existsSync(fileResized)) {
            req.url = urlResized
            res.redirect(308, urlResized)
            res.end()
            return
        }//return serveImage(fileResized,res)
        // lets resize it
        const roundMeasure = 32 // we want to cache images like foo.100.png, foo-200.png etc
        const width = roundMeasure * Math.ceil(req.query.w / roundMeasure)
        if (width < roundMeasure) {
            width = roundMeasure
        }

        resize.read(file, (err, handle) => {
            if (err) {
                return res.end(err.toString())
            }
            handle.resize(width, resize.AUTO).quality(100)
            handle.getBase64(resize.MIME_PNG, function (err, imageResized) {
                if (err) return res.end(err)
                //fsw.writeFileSync(fileResized, Buffer.from(stripBase64Header(imageResized), 'base64'), 'base64')
                serveImage(fileResized, res)
            })
        })
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