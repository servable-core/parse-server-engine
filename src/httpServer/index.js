import http from "http"

export default async ({ app, servableConfig }) => {
  return new Promise((resolve, reject) => {
    try {
      const port = servableConfig.envs.serverPort || 1337
      const httpServer = http.createServer(app)

      httpServer.listen(port, async () => {
        console.info(
          `-- 🚀 😇  ${servableConfig.envs.appName} http server is running on port " + ${servableConfig.envs.serverPort} + " 😍 🚀 .`
        )
        console.info("---------------------------------------------------")
        resolve(httpServer)
      })
    } catch (e) {
      console.error("[PARSE_SERVER_ADAPTER]", '[DEBUG]', 'createHttpServer', e)
      reject(e)
    }
  })
}
