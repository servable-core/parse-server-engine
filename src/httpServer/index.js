import http from "http"

export default async ({ app }) => {
  return new Promise((resolve, reject) => {
    try {
      const port = process.env.SERVER_PORT || 1337
      const httpServer = http.createServer(app)

      httpServer.listen(port, async () => {
        console.info(
          `-- 🚀 😇  ${process.env.SERVABLE_APP_NAME} http server is running on port " + ${process.env.SERVER_PORT} + " 😍 🚀 .`
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
