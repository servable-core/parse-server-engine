import fg from 'fast-glob'

export default async ({ path,
  globOptions = { mark: true },
}) => {
  try {
    const entries = await fg([path], globOptions,)
    return Promise.all(entries.map(entry => import(entry)))
  }
  catch (e) {
    console.error(e)
    return null
  }
}
