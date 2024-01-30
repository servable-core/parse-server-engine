import fs from "fs"
import checkFileExists from "./checkFileExists.js"

export default async _url => {
  // try {
  if (!(await checkFileExists(_url))) {
    return null
  }
  const fileUrl = new URL(_url, import.meta.url)
  const parsedPackageJSON = JSON.parse(await fs.promises.readFile(fileUrl, 'utf8'))
  return parsedPackageJSON
  // } catch (e) {
  //   console.log("[Servable]", `importJSONAsync → `, e)
  //   return null
  // }
}
