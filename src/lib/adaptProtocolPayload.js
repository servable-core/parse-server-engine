export default (payload) => {
    if (typeof payload === 'object') {
        return payload
    }

    if (typeof payload === 'string') {
        return {
            id: payload,
            slug: payload,
            name: payload,
            params: {

            }
        }
    }

    return payload
}