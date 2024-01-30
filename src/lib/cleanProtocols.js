export default (items) => {
  if (!items) {
    return null
  }
  let _items = items.filter(a => a)
  const res = []
  const ids = []
  _items.forEach(i => {
    if (!i.id) {
      ids.push(i.id)
      res.push(i)
      return
    }

    if (!ids.includes(i.id)) {
      ids.push(i.id)
      res.push(i)
    }
    else {
      // console.log("[Servable]", '')
    }
  })
  // _items = _.uniq(_items, a => a.id)
  return res
}
