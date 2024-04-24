//formattage date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0]; // Convert to YYYY-MM-DD format
}

module.exports = {
    formatDate
}