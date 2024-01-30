export default ({ item } = {}) => {
    if (!item) {
        return
    }

    const name = `utilCampaignEmail_${item.id}`
    return name
}