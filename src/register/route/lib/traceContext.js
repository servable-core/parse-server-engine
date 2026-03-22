const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i

const getHeaderValue = (headers = {}, headerName = '') => {
    const expected = headerName.toLowerCase()
    for (const [key, value] of Object.entries(headers || {})) {
        if (key.toLowerCase() === expected) {
            return value
        }
    }
    return undefined
}

const parseTraceparent = (traceparent) => {
    if (typeof traceparent !== 'string') {
        return {}
    }

    const match = traceparent.trim().match(TRACEPARENT_RE)
    if (!match) {
        return {}
    }

    return {
        trace_id: match[1].toLowerCase(),
        span_id: match[2].toLowerCase(),
    }
}

const parseBaggage = (baggage) => {
    if (typeof baggage !== 'string' || !baggage.trim()) {
        return {}
    }

    const values = {}
    for (const entry of baggage.split(',')) {
        const [rawKey, rawValue] = entry.split('=')
        if (!rawKey || rawValue == null) {
            continue
        }

        const key = rawKey.trim()
        const value = rawValue.split(';')[0]?.trim()
        if (!key || !value) {
            continue
        }

        values[key] = decodeURIComponent(value)
    }

    return values
}

const getTraceContextFromHeaders = (headers = {}) => {
    const traceparent = getHeaderValue(headers, 'traceparent')
    const baggage = getHeaderValue(headers, 'baggage')

    const parsedTraceparent = parseTraceparent(traceparent)
    const parsedBaggage = parseBaggage(baggage)

    return {
        traceparent,
        baggage,
        trace_id: parsedTraceparent.trace_id || parsedBaggage.trace_id,
        span_id: parsedTraceparent.span_id || parsedBaggage.span_id,
    }
}

export const buildParamsWithTraceContext = ({ query = {}, headers = {} } = {}) => {
    const traceContext = getTraceContextFromHeaders(headers)

    const params = { ...query }

    if (!params.trace_id && traceContext.trace_id) {
        params.trace_id = traceContext.trace_id
    }

    if (!params.span_id && traceContext.span_id) {
        params.span_id = traceContext.span_id
    }

    if (!params.traceparent && traceContext.traceparent) {
        params.traceparent = traceContext.traceparent
    }

    if (!params.baggage && traceContext.baggage) {
        params.baggage = traceContext.baggage
    }

    return params
}
