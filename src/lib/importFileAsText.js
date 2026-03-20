import fs from "fs"
import checkFileExists from "./checkFileExists.js"

export default async _url => {
  try {
    if (!(await checkFileExists(_url))) {
      return null
    }
    const fileUrl = new URL(_url, import.meta.url)
    return fs.promises.readFile(fileUrl, 'utf8')
  } catch (e) {
    console.log("[@servable/parse-server-engine/lib/importFileAsText] default() → Failed to import file as text:", _url, "Error:", e.message || e)
    return null
  }
}
