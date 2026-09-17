/**
 * @param {object} [props]
 * @param {{ id: string }} [props.item]
 * @returns {string | undefined} a deterministic job name for the given item, or `undefined`.
 */
export default ({ item } = {}) => {
    if (!item) {
        return
    }

    const name = `utilCampaignEmail_${item.id}`
    return name
}