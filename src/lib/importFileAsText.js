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
    console.log("[Servable]", `importFileAsText → `, e)
    return null
  }
}
