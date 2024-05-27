const axios = require('axios').default;
const { setUpdatingCompany, getUpdatingCompany } = require('../helpers');


const startCatalogApi = axios.create({
  baseURL: 'https://o91mts5a64.execute-api.eu-west-1.amazonaws.com/dev/', 
  headers: {
    'X-API-KEY': process.env.STARTCATALOG_API_KEY,
    'Content-Type': 'application/json'
  }
});

const getAllOrders = async () => {
  const response = await startCatalogApi.get('/catalog/orders');
  return response.data;
};

const createOrUpdateOrder = async (orderData) => {
  const response = await startCatalogApi.post('/catalog/orders', orderData);
  return response.data;
};

const registerWebhook = async (webhookUrl, apiKey) => {
    await startCatalogApi.post('/catalog/orders/webhook', {
      url: webhookUrl,
      api_key: apiKey
    });
};

const registerWebhookCompanies = async (webhookUrl, apiKey) => {
  await startCatalogApi.post('/catalog/companies/webhook', {
    url: webhookUrl,
    api_key: apiKey
  });
};

const getAllCompanies = async () => {
  const response = await startCatalogApi.get('/catalog/companies')
  console.log(response.data)
  return response.data.companies
}

const updateOrderInCatalog = async (orderId, sellsyOrderId) => {
  const catalogApiUrl = `/catalog/orders`;
  const orders = [{
    id: orderId,
    seller_order_id: sellsyOrderId.toString(),
  }];

  try {
    const response = await startCatalogApi.post(catalogApiUrl, { 
      orders 
    });

    console.log('Order updated in Catalog successfully:', orderId);
    return response.data;
  } catch (error) {
    if (error.response && error.response.data) {
      console.error('Error data:', error.response.data);
    }
    console.error('Error updating order in Catalog:', error.message);
    throw error;
  }
};


async function updateCompanyInCatalog(companyId, sellsyClientId) {
  const catalogApiUrl = `/catalog/companies`; 
  const companies = [{
      id: companyId,
      code: sellsyClientId.toString()
  }];

  try {
    setUpdatingCompany(true); // Activer le drapeau de mise à jour
    const response = await startCatalogApi.post(catalogApiUrl, {
      companies
    });

    console.log('Company updated in Catalog successfully:', companyId);
    return response.data;
  } catch (error) {
    if (error.response && error.response.data) {
      console.error('Error data:', error.response.data);
    }
    console.error('Error updating company in Catalog:', error.message);
    throw error;
  } finally {
    setUpdatingCompany(false); // Désactiver le drapeau de mise à jour
  }
}




module.exports = {
  getAllOrders,
  createOrUpdateOrder,
  registerWebhook,
  registerWebhookCompanies,
  getAllCompanies,
  updateCompanyInCatalog,
  updateOrderInCatalog
};
