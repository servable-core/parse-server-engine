import importJSONAsync from '../lib/importJSONAsync.js'

export default async ({
  classesSchemas,
}) => {

  if (!classesSchemas || !classesSchemas.length) {
    return
  }

  let ServableApp = classesSchemas.filter(a => a.className === 'ServableApp')
  if (!ServableApp || !ServableApp.length) {
    ServableApp = await importJSONAsync('./payloads/classes/ServableApp.json')
    classesSchemas.push(ServableApp)
  }

  let _User = classesSchemas.filter(a => a.className === '_User')
  if (!_User || !_User.length) {
    _User = await importJSONAsync('./payloads/classes/_User.json')
    classesSchemas.push(_User)
  }

  let _Session = classesSchemas.filter(a => a.className === '_Session')
  if (!_Session || !_Session.length) {
    _Session = await importJSONAsync('./payloads/classes/_Session.json')
    classesSchemas.push(_Session)
  }

  let _Role = classesSchemas.filter(a => a.className === '_Role')
  if (!_Role || !_Role.length) {
    _Role = await importJSONAsync('./payloads/classes/_Role.json')
    classesSchemas.push(_Role)
  }
}

