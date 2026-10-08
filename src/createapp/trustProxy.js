// Express's "trust proxy" setting, read from SERVABLE_ENGINE_TRUST_PROXY. Behind a reverse proxy (an ingress,
// a load balancer) every request reaches the app from the proxy's address, so without it `req.ip` is
// the proxy and every visitor looks the same: one rate-limit bucket for everybody, one address for
// every analytics event. With it, Express takes the client from X-Forwarded-For, trusting only as many
// hops as configured.
//
// Accepted values (https://expressjs.com/en/guide/behind-proxies.html):
//   unset or empty  leave Express's default (trust nothing)
//   a whole number  trust that many hops in front of the app (production behind ingress-nginx: 1)
//   true / false    trust every hop / none (true lets any client pick its own address: avoid it)
//   anything else   passed through as a list of trusted addresses or subnets ("loopback, 10.0.0.0/8")
export const trustProxySettingFrom = (rawValue) => {
  if (rawValue === undefined || rawValue === null) {
    return undefined
  }
  const value = String(rawValue).trim()
  if (value === '') {
    return undefined
  }
  if (/^\d+$/.test(value)) {
    return Number(value)
  }
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  return value
}

export const applyTrustProxy = ({ app, rawValue }) => {
  const trustProxySetting = trustProxySettingFrom(rawValue)
  if (trustProxySetting === undefined) {
    return undefined
  }
  app.set('trust proxy', trustProxySetting)
  return trustProxySetting
}
