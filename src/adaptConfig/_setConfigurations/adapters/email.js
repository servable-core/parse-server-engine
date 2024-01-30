

export default {
  module: "parse-server-sendgrid-adapter",
  options: {
    fromAddress: process.env.EMAIL_FROM_ADDRESS,
    apiKey: process.env.EMAIL_API_KEY,
  }
}