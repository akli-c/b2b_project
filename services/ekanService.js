const axios = require('axios').default;
const moment = require('moment');
const Joi = require('joi');
const orderSchema = require('../orderSchema');  // Assurez-vous que le chemin est correct

const ekanCredentials = {
  username: process.env.EKAN_MERCHANT_NUMBER,
  password: process.env.EKAN_API_KEY
};

function mapCatalogOrderToEkanOrder(orderData) {
  console.log('Mapping order data:', orderData);

  if (!Array.isArray(orderData.items)) {
    console.error('Items is not an array:', orderData.order_id);
    return null;
  }

  return {
    reference: orderData.order_id,  
    referenceClient: orderData.company_id,
    referenceSecondaire:orderData.seller_order_id,
    codeServiceTransporteur: 1,  // change
    numeroLogo: 1,  // change
    dateCommande: moment(orderData.creation_date).format('YYYY-MM-DDTHH:mm:ssZ'),
    listeArticles: orderData.items.map(item => ({
      refEcommercant: "TS1001", // change 
      quantite: item.quantity,
      prixVenteUnitaire: item.unit_price,
      devisePrixVenteUnitaire: orderData.currency_code.toUpperCase(), // Mapping currency_code
    })),
    adresseFacturation: {
      societe: orderData.billing_address.company_name || "",
      nom: orderData.billing_address.label,
      prenom: orderData.billing_address.first_name,
      adresse: orderData.billing_address.address_1,
      adresse2: orderData.billing_address.address_2 || "",
      codePostal: orderData.billing_address.postal_code,
      ville: orderData.billing_address.city,
      codePays: orderData.billing_address.country_code.toUpperCase(), // Mapping country_code
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

const createOrder = async (orderData) => {
  const authHeader = Buffer.from(`${ekanCredentials.username}:${ekanCredentials.password}`).toString('base64');
  
  const ekanOrderData = mapCatalogOrderToEkanOrder(orderData);
  if (!ekanOrderData) {
    throw new Error('Invalid order data');
  }

  // Validation des données mappées
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
  createOrder,
  mapCatalogOrderToEkanOrder
};
