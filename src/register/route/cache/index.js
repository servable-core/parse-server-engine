import memory from "./memory/index.js"
import empty from "../empty.js"

export default ({ cache = {} }) => {
  const { type, params } = cache
  switch (type) {
    case 'inMemory': {
      const { duration = 10 } = params
      return memory({ duration })
    }
    default: {
      return empty
    }
  }
}
