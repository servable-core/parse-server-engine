import { normalizeRequestUrl } from './normalizeRequestUrl.js'
import { readerKeyPartOf } from './readerCredentials.js'

const KEY_PREFIX = '__express__'
// Sets the reader's part apart from the address: a normalized address never holds a `#` (it ends a path, and a query
// writes it `%23`), so no address, whatever a client sends, can spell a signed-in key.
const READER_SEPARATOR = '#'

/**
 * Whether a configuration keeps one entry per signed-in reader.
 * @param {string | null | undefined} template
 * @returns {boolean}
 */
export const isPerReaderTemplate = (template) => String(template || '').trim().toLowerCase() === 'userexists'

/**
 * The key a route's answer is cached under, the same for both stores: the normalized address, and for a
 * `userExists` configuration (one entry per signed-in reader) the digests of the credentials the request carries,
 * each in its namespace (`b:` a bearer, `s:` a session with `.i:` its device; ./readerCredentials.js), never a token.
 * Null when the configuration is per reader and the request carries no credential: such a request is not cached.
 * @param {object} props
 * @param {any} props.request - Express's request.
 * @param {string | null | undefined} props.template
 * @returns {string | null}
 */
export const routeCacheKeyOf = ({ request, template }) => {
  const key = KEY_PREFIX + normalizeRequestUrl(request?.originalUrl || request?.url)
  if (!isPerReaderTemplate(template)) {
    return key
  }
  const readerKeyPart = readerKeyPartOf(request)
  if (!readerKeyPart) {
    return null
  }
  return `${key}${READER_SEPARATOR}${readerKeyPart}`
}

export default routeCacheKeyOf
