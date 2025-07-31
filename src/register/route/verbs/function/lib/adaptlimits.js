export default (limits) => {
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
