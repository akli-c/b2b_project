const axios = require('axios').default;
const cron = require('node-cron');
const moment = require('moment');
const Joi = require('joi');
const orderSchema = require('../orderSchema');  
const { updateFulfillmentStatusInCatalog, createFulfillmentInCatalog } = require('./catalogService');

const ekanCredentials = {
  username: process.env.EKAN_MERCHANT_NUMBER,
  password: process.env.EKAN_API_KEY
};

const pendingOrders = [];

const pendingShippedOrders = [];

const checkParcelInEkan = async (order_id) => {
  const authHeader = Buffer.from(`${ekanCredentials.username}:${ekanCredentials.password}`).toString('base64');
  
  try {
    const response = await axios.post('https://oms.ekan-democommercant.fr/api/ecomm/v1/colis/liste', {
      referenceCommande: order_id
    }, {
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Parcel status from E-Kan:', response.data);
    return response.data;

  } catch (error) {
    console.error('Failed to get parcel status from E-Kan', error.response ? error.response.data : error.message);
    throw new Error('Failed to get parcel status from E-Kan');
  }
};

const isOrderShipped = (ekanOrderData) => {
  if (ekanOrderData.commandes && ekanOrderData.commandes.length > 0) {
    const order = ekanOrderData.commandes[0];
    return order.etatLivraison === 'EXPEDIE' || order.etatLivraisonLibelle === 'Expédié'; // Ajuster en fonction de la réponse exacte
  }
  return false;
};  

// Cron job to check the status of pending orders in Ekan
cron.schedule('*/5 * * * *', async () => { // every 5 min
  console.log('Running cron job to check pending orders in E-Kan', pendingOrders);
  
  for (let i = 0; i < pendingOrders.length; i++) {
    const order = pendingOrders[i];
    
    try {
      const ekanParcelData = await checkParcelInEkan(order.order_id);

      if (ekanParcelData.colis && ekanParcelData.colis.length > 0) {
        const parcel = ekanParcelData.colis[0];
        const trackingUrl = parcel.urlTracking;

        // await updateFulfillmentStatusInCatalog(order, trackingUrl, 'prepared');
        await createFulfillmentInCatalog(order, trackingUrl, 'prepared');

        console.log('Order marked as prepared in Catalog with tracking URL');

        // remove order from pendingOrders once it is marked as prepared
        pendingOrders.splice(i, 1);
        i--; // Adjust the index after removal
      } else {
        console.log('No parcel found for this order in E-Kan');
      }
    } catch (error) {
      console.error('Error processing order:', error.message);
    }
  }
});

// Cron job to check the status of pending shipped orders in Ekan
cron.schedule('*/5 * * * *', async () => {//5 min
  console.log('Running cron job to check pending shipped orders in E-Kan', pendingShippedOrders);

  for (let i = 0; i < pendingShippedOrders.length; i++) {
    const order = pendingShippedOrders[i];

    try {
      const ekanParcelData = await checkParcelInEkan(order.order_id);

      if (isOrderShipped(ekanParcelData)) {
        const parcel = ekanParcelData.colis[0];
        const trackingUrl = parcel.urlTracking;

        await updateFulfillmentStatusInCatalog(order, trackingUrl, 'shipped');

        console.log('Order marked as shipped in Catalog with tracking URL');

        // remove order from pendingShippedOrders once it is marked as shipped
        pendingShippedOrders.splice(i, 1);
        i--; // come back
      } else {
        console.log('Order is not yet shipped in E-Kan');
      }
    } catch (error) {
      console.error('Error processing order:', error.message);
    }
  }
});

function mapCatalogOrderToEkanOrder(orderData) {
  console.log('Mapping order data:', orderData);

  if (!Array.isArray(orderData.items)) {
    console.error('Items is not an array:', orderData.order_id);
    return null;
  }

  return {
    reference: orderData.order_id,  
    referenceClient: orderData.company_id,
    referenceSecondaire: String(orderData.seller_order_id || ""), 
    codeServiceTransporteur: 1,  // change
    numeroLogo: 1,  // change
    dateCommande: moment(orderData.creation_date).format('YYYY-MM-DDTHH:mm:ssZ'),
    listeArticles: orderData.items.map(item => ({
      refEcommercant: item.sku,
      quantite: item.quantity,
      prixVenteUnitaire: item.unit_price,
      devisePrixVenteUnitaire: orderData.currency_code.toUpperCase(), 
    })),
    adresseFacturation: {
      societe: orderData.billing_address.company_name || "",
      nom: orderData.billing_address.label,
      prenom: orderData.billing_address.first_name,
      adresse: orderData.billing_address.address_1,
      adresse2: orderData.billing_address.address_2 || "",
      codePostal: orderData.billing_address.postal_code,
      ville: orderData.billing_address.city,
      codePays: orderData.billing_address.country_code.toUpperCase(),
      telephoneFixe: orderData.billing_address.phone,
      email: orderData.email,
    },
    adresseLivraison: {
      societe: orderData.shipping_address.company_name || "",
      nom: orderData.shipping_address.label,
      prenom: orderData.shipping_address.first_name,
      adresse: orderData.shipping_address.address_1,
      adresse2: orderData.shipping_address.address_2 || "",
      codePostal: orderData.shipping_address.postal_code,
      ville: orderData.shipping_address.city,
      codePays: orderData.shipping_address.country_code.toUpperCase(), 
      telephoneFixe: orderData.shipping_address.phone,
      email: orderData.email,
    },
    montantHT: orderData.items.reduce((total, item) => total + (item.unit_price * item.quantity), 0),
    montantAssure: orderData.items.reduce((total, item) => total + (item.unit_price * item.quantity), 0),
    deviseMontantAssure: orderData.currency_code.toUpperCase(), 
    fraisDePort: orderData.shipping_price,
    deviseFraisDePort: orderData.currency_code.toUpperCase(), 
  };
}

const createEkanOrder = async (orderData) => {
  const authHeader = Buffer.from(`${ekanCredentials.username}:${ekanCredentials.password}`).toString('base64');
  
  const ekanOrderData = mapCatalogOrderToEkanOrder(orderData);
  if (!ekanOrderData) {
    throw new Error('Invalid order data');
  }

  // validation des données 
  const { error } = orderSchema.validate(ekanOrderData);
  if (error) {
    console.error('Validation error:', error.details);
    throw new Error(`Validation error: ${error.details.map(x => x.message).join(', ')}`);
  }

  try {
    const response = await axios.post('https://oms.ekan-democommercant.fr/api/ecomm/v1/commandes/creer', ekanOrderData, {
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Order successfully sent to E-Kan', response.data);
    return response.data;

  } catch (error) {
    console.error('Failed to send order to E-Kan', error.response ? error.response.data : error.message);
    throw new Error('Failed to send order to E-Kan');
  }
};

module.exports = {
  createEkanOrder,
  mapCatalogOrderToEkanOrder, 
  checkParcelInEkan,
  isOrderShipped, 
  pendingOrders,
  pendingShippedOrders
};
