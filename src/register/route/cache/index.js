import memory from "./memory/index.js"
import empty from "../empty.js"

export default ({ cache = {} }) => {
  const { type, params } = cache
  switch (type) {
    case 'inMemory': {
      const {
        window = 10,
        extent = 'user'
      } = params
      return memory({
        duration: window,
        extent
      })
    }
    default: {
      return empty
    }
  }
}
