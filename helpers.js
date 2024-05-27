//formattage date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0]; // Convert to YYYY-MM-DD format
}

let isUpdatingCompany = false;
let isUpdatingOrder = false;

function setUpdatingCompany(status) {
  isUpdatingCompany = status;
}

function getUpdatingCompany() {
  return isUpdatingCompany;
}

function setUpdatingOrder(status) {
  isUpdatingOrder = status;
}

function getUpdatingOrder() {
  return isUpdatingOrder;
}

module.exports = {
    formatDate,
    setUpdatingCompany,
    getUpdatingCompany,
    setUpdatingOrder,
    getUpdatingOrder
}