// The part of a request's address a cached answer is filed under: the path and its query, sorted, without the
// tracing parameters a client adds to every call (they would give each request its own entry).
const STRIPPED_QUERY_KEYS = new Set([
  'traceid',
  'trace_id',
  'tracespan',
  'trace_span',
  'traceparent',
  'tracestate',
  'spanid',
  'span_id',
  'parentspanid',
  'parent_span_id',
  'requestid',
  'request_id',
  'correlationid',
  'correlation_id'
])

/**
 * @param {unknown} rawUrl
 * @returns {string}
 */
export const normalizeRequestUrl = (rawUrl) => {
  const safeRawUrl = String(rawUrl || '')

  try {
    const parsed = new URL(safeRawUrl, 'http://localhost')
    const keys = Array.from(new Set(Array.from(parsed.searchParams.keys())))

    keys.forEach((key) => {
      if (STRIPPED_QUERY_KEYS.has(String(key).toLowerCase())) {
        parsed.searchParams.delete(key)
      }
    })

    parsed.searchParams.sort()
    const normalizedQuery = parsed.searchParams.toString()

    return normalizedQuery
      ? `${parsed.pathname}?${normalizedQuery}`
      : parsed.pathname
  } catch {
    return safeRawUrl
  }
}

export default normalizeRequestUrl
