const axios = require('axios').default;
const { formatDate } = require('../helpers')
const { updateCompanyInCatalog, updateOrderInCatalog } = require('./catalogService')
const { setUpdatingCompany, getUpdatingCompany, setUpdatingOrder, getUpdatingOrder } = require('../helpers');

//Auth
let sellsyAccessToken = null;
let sellsyTokenExpiresAt = null;

const getSellsyAccessToken = async () => {
    const now = new Date();
  
    // check if the token is still valid
    if (sellsyAccessToken && sellsyTokenExpiresAt && now < sellsyTokenExpiresAt) {
      return sellsyAccessToken;
    }
  
    // if not, get new token
    try {
      const response = await axios.post(`https://login.sellsy.com/oauth2/access-tokens`, {
        grant_type: 'client_credentials',
        client_id: process.env.SELLSY_CLIENT,
        client_secret: process.env.SELLSY_SECRET
      });
      sellsyAccessToken = response.data.access_token;
  
      // Set the token expiration time (the token is valid for 1 hour)
      const expiresIn = response.data.expires_in; 
      sellsyTokenExpiresAt = new Date(now.getTime() + expiresIn * 1000);
  
      console.log("Got access token");
      return sellsyAccessToken;
    } catch (error) {
      console.error('Error obtaining access token:', error.response ? error.response.data : error.message);
      throw error;
    }
  };
  


async function handleWebhookOrder(webhookEvent) {
    switch (webhookEvent.event) {
      case 'order.placed':
        // Log the event; no action required in Sellsy.
        console.log('Order placed. Awaiting validation.');
        var test = await createSellsyOrder(webhookEvent);
        await updateDeliveryStepInSellsy(test.id, 'wait'); 
        break;
      case 'order.completed':
        // Create a draft order in Sellsy.
        console.log('Order validated. Creating bon de commande brouillon in Sellsy.');
        await updateDeliveryStepInSellsy(webhookEvent.seller_order_id, 'picking');
        break;
      case 'order.shipment_created':
        // Finalize the order and create an invoice in Sellsy.
        console.log('Order shipped. Finalizing order and creating invoice in Sellsy.');
        await updateDeliveryStepInSellsy(webhookEvent.seller_order_id, 'sent'); 
        await createSellsyInvoice(webhookEvent);
        break;
      default:
        console.log('Received an unrecognized event type.');
    }
  }

//mapping bon de commande 
function mapCatalogOrderToSellsyOrder(orderData) {
    
    const sellsyOrder = {
        date: formatDate(orderData.creation_date), 
        due_date: formatDate(orderData.delivery_date), 
        created: orderData.creation_date,  
        subject: `Order for ${orderData.company_name}`,
        currency: orderData.currency_code.toUpperCase(),
        owner_id:297168, //staff
        related: [{
            id: parseInt(orderData.company_external_id), 
            type: "company" 
        }],
        note:'Commande générée depuis Catalog',
        parent:  {
            type: "model",
            id: 50239804,
        },
        rows: orderData.items.map(item   => ({
            type: 'single', 
            unit_amount: item.unit_price.toString(), 
            tax_id: item.tax_id,
            quantity: item.quantity.toString(),
            reference: item.sku, 
            description: item.title, 
        }))
    };
    console.log('orderici', sellsyOrder)
    return sellsyOrder
}

//mapping facture
function mapCatalogOrderToSellsyInvoice(orderData, orderId) {
    const sellsyInvoice = {
        ...mapCatalogOrderToSellsyOrder(orderData),
        date:formatDate(new Date()),
        created: new Date(),
        parent: {
            type: "order",
            id: orderId,
        },
    };
    return sellsyInvoice;
}

//update status 
const updateDeliveryStepInSellsy = async (orderId, newStep) => {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = 'https://apifeed.sellsy.com/0/';
    
    const requestSettings = {
      method: 'Document.updateDeliveryStep',
      params: {
        docid: orderId,
        document: {
          step: newStep,
        }
      }
    };
  
    const params = new URLSearchParams();
    params.append('io_mode', 'json');
    params.append('do_in', JSON.stringify(requestSettings));
  
    try {
      const response = await axios.post(apiUrl, params, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      console.log('Delivery step updated in Sellsy:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error updating delivery step in Sellsy:', error.response ? error.response.data : error.message);
      throw error;
    }
  };

  

//Bon de commande
async function createSellsyOrder(orderData) {
    if (getUpdatingOrder()) {
        console.log('Ignoring order creation as an order update is in progress.');
        return;
    }


    const accessToken = await getSellsyAccessToken();
    const apiUrl = 'https://api.sellsy.com/v2/orders';
    const processedOrderData = mapCatalogOrderToSellsyOrder(orderData);

    try {
        setUpdatingOrder(true); // Set the flag before the update
        const response = await axios.post(apiUrl, processedOrderData, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        console.log('Order created in Sellsy:', response.data);
        const sellsyOrderId = response.data.id;

        // Update the order in catalog with the new Sellsy order ID
        await updateOrderInCatalog(orderData.order_id, sellsyOrderId);

        return response.data;
    } catch (error) {
        console.error('Error creating order in Sellsy:', error.response ? error.response.data : error.message);
        throw error;
    } finally {
        setUpdatingOrder(false); // Reset the flag after the update
    }
}


//Facture sellsy
async function createSellsyInvoice(orderData, orderId) {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = 'https://api.sellsy.com/v2/invoices';
    const processedInvoiceData = mapCatalogOrderToSellsyInvoice(orderData, orderId);

    try {
        console.log('invoice', processedInvoiceData)
        const response = await axios.post(apiUrl, processedInvoiceData, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        console.log('Invoice created in Sellsy:', response.data);
        return response.data; 
    } catch (error) {
        console.error('Error creating invoice in Sellsy:', error.response ? error.response.data : error.message);
        throw error;
    }
}
 

function parseWebhookData(webhookData) {
    const {
        id, event, name, code, registration_number, vat_number,
        contacts, billing_address, shipping_addresses,
        catalog_names
    } = webhookData;

    return {
        event:event, 
        company: {
            id,
            name,
            code,
            registration_number,
            vat_number,
            contacts,
            billing_address,
            shipping_addresses,
            catalog_names
        }
    };
}


///////////////////////////////////////////////////////////////////////////////////// company /////////////////////////////////////////////////////////////////////////////
async function getExistingAddresses(companyId) {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = `https://api.sellsy.com/v2/companies/${companyId}/addresses`;
    try {
        const response = await axios.get(apiUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        
        return response.data.data ? response.data.data : [];
    } catch (error) {
        console.error('Failed to fetch addresses:', error);
        throw error;
    }
}


// Function to create an address for a company in Sellsy
async function createSellsyCompanyAddress(companyId, addressData, addressType) {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = `https://api.sellsy.com/v2/companies/${companyId}/addresses`;

    const addressPayload = mapAddressDataToPayload(addressData, addressType);

    try {
        const response = await axios.post(apiUrl, addressPayload, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        console.log(`${addressType} address created in Sellsy for company ID: ${companyId}`);
        return response.data;
    } catch (error) {
        console.error(`Error creating ${addressType} address in Sellsy for company ID ${companyId}:`, error.response ? error.response.data : error.message);
        throw error;
    }
}


async function handleAddresses(companyId, billingAddress, shippingAddresses) {
    const existingAddresses = await getExistingAddresses(companyId);
    const normalizedBilling = normalizeAddress(billingAddress);
    const normalizedShipping = normalizeAddress(shippingAddresses[0]); // assuming at least one shipping address

    const billingIsShipping = areAddressesEqual(normalizedBilling, normalizedShipping);

    // Handle the case where billing and shipping are the same
    if (billingIsShipping) {
        console.log("Handling a single address as both billing and shipping.");
        await processSingleAddressAsBoth(companyId, normalizedBilling, existingAddresses);
    } else {
        console.log("Handling separate billing and shipping addresses.");
        await processSeparateAddresses(companyId, normalizedBilling, normalizedShipping, existingAddresses);
    }

    processAndDeleteAddresses(companyId)
}


function filterAddressesForDeletion(addresses) {
    return addresses.filter(addr => !addr.is_invoicing_address && !addr.is_delivery_address);
}


async function deleteAddress(companyId, addressId) {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = `https://api.sellsy.com/v2/companies/${companyId}/addresses/${addressId}`;

    try {
        const response = await axios.delete(apiUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        console.log(`Address ID ${addressId} deleted successfully.`);
        return response.data;
    } catch (error) {
        console.error(`Error deleting address ID ${addressId}:`, error.response ? error.response.data : error.message);
        throw error;
    }
}

async function processAndDeleteAddresses(companyId) {
    try {
        const addresses = await getExistingAddresses(companyId);
        const addressesToDelete = filterAddressesForDeletion(addresses);
        for (const address of addressesToDelete) {
            await deleteAddress(companyId, address.id);
        }
        console.log('Address deletion process completed.');
    } catch (error) {
        console.error('Failed to process and delete addresses:', error);
        throw error; // Re-throw the error for handling upstream if necessary
    }
}

async function processSingleAddressAsBoth(companyId, address, existingAddresses) {
    // Check if any address is already set as both
    const existingBoth = existingAddresses.find(addr => addr.is_invoicing_address && addr.is_delivery_address);

    if (existingBoth && areAddressesEqual(existingBoth, address)) {
        console.log("Both address already up-to-date.");
    } else if (existingBoth) {
        await updateSellsyCompanyAddress(companyId, address, existingBoth.id, "Both");
    } else {
        await createSellsyCompanyAddress(companyId, address, "Both");
    }
}

async function processSeparateAddresses(companyId, billingAddress, shippingAddress, existingAddresses) {
    const existingBilling = existingAddresses.find(addr => addr.is_invoicing_address && !addr.is_delivery_address);
    const existingShipping = existingAddresses.find(addr => !addr.is_invoicing_address && addr.is_delivery_address);

    // Update or create billing address
    if (existingBilling && areAddressesEqual(existingBilling, billingAddress)) {
        console.log("Billing address already up-to-date.");
    } else if (existingBilling) {
        await updateSellsyCompanyAddress(companyId, billingAddress, existingBilling.id, "Facturation");
    } else {
        await createSellsyCompanyAddress(companyId, billingAddress, "Facturation");
    }

    // Update or create shipping address
    if (existingShipping && areAddressesEqual(existingShipping, shippingAddress)) {
        console.log("Shipping address already up-to-date.");
    } else if (existingShipping) {
        await updateSellsyCompanyAddress(companyId, shippingAddress, existingShipping.id, "Livraison");
    } else {
        await createSellsyCompanyAddress(companyId, shippingAddress, "Livraison");
    }
}

async function processAddressUpdateOrCreate(companyId, address, addressType, existingAddresses) {
    // Find if the address already exists
    const existingAddress = existingAddresses.find(addr => areAddressesEqual(addr, address));

    if (existingAddress) {
        console.log(`${addressType} address exists. Checking for updates.`);
        if (needsUpdate(existingAddress, address)) {
            console.log(`Updating ${addressType} address for company ID: ${companyId}`);
            await updateSellsyCompanyAddress(companyId, address, existingAddress.id, addressType);
        } else {
            console.log(`${addressType} address already up-to-date, no action taken.`);
        }
    } else {
        console.log(`Creating new ${addressType} address for company ID: ${companyId}`);
        await createSellsyCompanyAddress(companyId, address, addressType);
    }
}

function normalizeAddress(address) {
    return {
        name: address.first_name || address.name || "",
        address_line_1: address.address_line_1 || address.address_1 || "",
        postal_code: address.postal_code || "",
        city: address.city || "",
        country_code: address.country_code.toLowerCase() || ""
    };
    
}

function areAddressesEqual(addr1, addr2) {
    const normAddr1 = normalizeAddress(addr1);
    const normAddr2 = normalizeAddress(addr2);

    console.log('Normalized Address 1:', normAddr1);
    console.log('Normalized Address 2:', normAddr2);

    return normAddr1.name.toLowerCase() === normAddr2.name.toLowerCase() &&
           normAddr1.address_line_1.toLowerCase() === normAddr2.address_line_1.toLowerCase() &&
           normAddr1.postal_code === normAddr2.postal_code &&
           normAddr1.city.toLowerCase() === normAddr2.city.toLowerCase() &&
           normAddr1.country_code.toLowerCase() === normAddr2.country_code.toLowerCase();
}


function needsUpdate(existingAddr, newAddr) {
    return existingAddr.address_line_1 !== newAddr.address_1 ||
           existingAddr.postal_code !== newAddr.postal_code ||
           existingAddr.city !== newAddr.city ||
           existingAddr.country_code !== newAddr.country_code ||
           existingAddr.address_line_2 !== newAddr.address_2;
}

async function updateSellsyCompanyAddress(companyId, addressData, addressId, addressType) {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = `https://api.sellsy.com/v2/companies/${companyId}/addresses/${addressId}`;
    const addressPayload = mapAddressDataToPayload(addressData, addressType);

    try {
        const response = await axios.put(apiUrl, addressPayload, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        console.log(`Updated ${addressType} address in Sellsy for company ID: ${companyId}`);
        return response.data;
    } catch (error) {
        console.error(`Error updating ${addressType} address in Sellsy for company ID ${companyId}:`, error);
        throw error;
    }
}

function mapAddressDataToPayload(addressData, addressType) {
    console.log('ici2',addressData)
    const mappedAddress = {
        name: addressData.name || addressType,  
        address_line_1: addressData.address_1 || addressData.address_line_1,
        address_line_2: addressData.address_2 || addressData.address_line_2 || "",  
        postal_code: addressData.postal_code,
        city: addressData.city,
        country_code: addressData.country_code,
        is_invoicing_address: addressType === "Facturation" || addressType === "Both",
        is_delivery_address: addressType === "Livraison" || addressType === "Both",
    };

    return mappedAddress
}


async function webhookHandler(webhookData) {
    if (getUpdatingCompany()) {
      console.log('Ignoring webhook as a company update is in progress.');
      return;
    }
  
    const { event, company } = parseWebhookData(webhookData);
    try {
      if (event === 'company.created') {
        console.log('Creating new company:', company.name);
        const companyData = await createEntityInSellsy(company);
        console.log('Company created with ID:', companyData);
      } else if (event === 'company.updated') {
        console.log('Updating company:', company.name);
        const companyData = await findCompanyInSellsy(company.name);
        if (!companyData) {
          console.log('No existing company found to update:', company.name);
          return;
        }
        
        // Determine if type transformation is needed
        const needsTransformToCustomer = company.catalog_names.includes("prospect") && companyData.type === 'client';
        const needsTransformToProspect = !company.catalog_names.includes("prospect") && companyData.type === 'prospect';
  
        if (needsTransformToCustomer) {
          await transformClientToProspect(companyData.id);
        } else if (needsTransformToProspect) {
          await transformProspectToCustomer(companyData.id);
        }
  
        await updateEntityInSellsy(companyData.id, company);
        console.log('Company updated with ID:', companyData.id);
        await synchronizeContacts(companyData.id, companyData.type, company.contacts);
  
        await handleAddresses(companyData.id, company.billing_address, company.shipping_addresses);
      }
    } catch (error) {
      console.error('Error in webhookHandler:', error);
      throw error; // Ensure you handle this in your route
    }
  }
  


async function findCompanyInSellsy(companyName) {
    const accessToken = await getSellsyAccessToken();  
    const apiUrl = 'https://api.sellsy.com/v2/companies/search'; 

    try {
        const response = await axios({
            method: 'post', 
            url: apiUrl,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            params:{
                field: ['id', 'type'], 
            },
            data: {
                filters: {
                    name: companyName
                }
            }
        });
        if (response.data && response.data.pagination.total > 0) {
            console.log('Company found:', response.data);
            
            return {
                id: response.data.data[0].id,
                type: response.data.data[0].type
            };
        } else {
            console.log('No company found matching the criteria.');
            return null;
        }
    } catch (error) {
        console.error('Error searching for company in Sellsy:', error.message);
        if (error.response) {
            console.error('Response error:', error.response.data);
        }
        throw error;
    }
}


function mapCatalogToSellsy(company) {

    const cleanedSiret = company.registration_number ? company.registration_number.replace(/\s|-/g, '') : null;
    const cleanedVAT = company.vat_number ? company.vat_number.replace(/\s+/g, '') : null;
    const third = {
      name: company.name,
      ident: company.code || null,
      type: "corporation",
      email: (company.contacts.length > 0) ? company.contacts[0].email : null,
      tel: (company.billing_address) ? company.billing_address.phone : null,
      web: company.website || null,
      siret: cleanedSiret,
      vat: cleanedVAT,
    };
  
    const contact = (company.contacts.length > 0) ? {
      name: company.contacts[0].last_name || company.name ,
      forename: company.contacts[0].first_name || "" ,
      email: company.contacts[0].email || null,
      tel: company.contacts[0].phone || null,
      position: company.contacts[0].position || null,
    } : {};
  
    const address = (company.billing_address) ? {
      name: company.billing_address.label || company.name ,
      part1: company.billing_address.address_1 || null,
      part2: company.billing_address.address_2 || null,
      zip: company.billing_address.postal_code || null,
      town: company.billing_address.city || null,
      countrycode: company.billing_address.country_code || null,
    } : {};

    const sellsyData = {
      third: third,
      contact: contact,
      address: address
    };

    return sellsyData;
}

function getSellsyMethod(catalogNames, isExistingEntity) {
    const entityType = catalogNames.includes("prospect") ? 'Prospects' : 'Client';
    return `${entityType}.${isExistingEntity ? 'update' : 'create'}`;
}

function getSellsyUpdateParams(existingCompanyId, sellsyCompanyData, entityType) {
    const updateParams = { ...sellsyCompanyData };
    if (entityType === 'Prospects') {
      updateParams.id = existingCompanyId; 
    } else {
      updateParams.clientid = existingCompanyId; 
    }
    return updateParams;
}

// Main function to create a client or a prospect with details
// async function createEntityWithDetails(company) {
//     const accessToken = await getSellsyAccessToken(); // Assuming this function gets your access token
//     const apiUrl = 'https://apifeed.sellsy.com/0/';
//     const sellsyCompanyData = mapCatalogToSellsy(company);
//     console.log('compa',company.name)

//     const existingCompanyId = await findCompanyInSellsy(company.name);
//     const entityType = company.catalog_names.includes("prospect") ? 'Prospects' : 'Client';
//     const isExistingEntity = existingCompanyId != null;
//     const method = getSellsyMethod(company.catalog_names, isExistingEntity);
  
//     let requestParams = sellsyCompanyData;
//     if (isExistingEntity) {
//         requestParams = getSellsyUpdateParams(existingCompanyId, sellsyCompanyData, entityType);
//     }
    
//     const requestSettings = {
//         method: method,
//         params: requestParams
//     };

//     if (isExistingEntity) {
//         requestSettings.params.id = existingCompanyId;
//     }

//     const params = new URLSearchParams();
//     params.append('io_mode', 'json');
//     params.append('do_in', JSON.stringify(requestSettings));

//     console.log(requestSettings.params.id)
//     try {
//         const response = await axios({
//             method: 'post',
//             url: apiUrl,
//             data: params,
//             headers: {
//                 'Authorization': `Bearer ${accessToken}`,
//                 'Content-Type': 'application/x-www-form-urlencoded',
//             },
//         });

//         console.log('Response:', response.data);
//         if (response.data.status === 'success') {
//             console.log(`Entity (client/prospect) ${isExistingEntity ? 'updated' : 'created'} successfully with id :`, response.data.response.client_id);
//             return {
//               id: isExistingEntity ? existingCompanyId : response.data.response.client_id, // Return the correct ID based on operation
//               isNewEntity: !isExistingEntity
//             };
//         } else {
//             throw new Error(`Failed to ${isExistingEntity ? 'update' : 'create'} entity (client/prospect)`);
//         }
//     } catch (error) {
//         console.error(`Error ${isExistingEntity ? 'updating' : 'creating'} entity (client/prospect):`, error.response ? error.response.data : error.message);
//         throw error;
//     }
// }


async function createEntityInSellsy(company) {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = 'https://apifeed.sellsy.com/0/';
    const sellsyCompanyData = mapCatalogToSellsy(company);
    const entityType = company.catalog_names.includes("prospect") ? 'Prospects' : 'Client';
    const method = getSellsyMethod(company.catalog_names, false);

    const requestSettings = {
        method: method,
        params: sellsyCompanyData
    };

    const params = new URLSearchParams();
    params.append('io_mode', 'json');
    params.append('do_in', JSON.stringify(requestSettings));

    try {
        const response = await axios({
            method: 'post',
            url: apiUrl,
            data: params,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        
        let isMethod;
        if (method.includes("Prospects")) {
            isMethod = "prospect"
        } else {
            isMethod = "company"
        }
        if (response.data.status === 'success') {
            

            if (isMethod === "prospect") {
                const sellsyId = response.data.response;  
                await updateCompanyInCatalog(company.id, sellsyId, );
                console.log('Prospect created successfully with id:', response.data.response);
                return response.data.response;
            } else {
                const sellsyId = response.data.response.client_id;  
                await updateCompanyInCatalog(company.id, sellsyId, );
                console.log('Company created successfully with id:', response.data.response.client_id);
                return response.data.response.client_id;
            }
        } else {
            throw new Error(`Failed to create entity ${entityType}`);
        }
    } catch (error) {
        console.error(`Error creating entity ${entityType}`, error);
        throw error;
    }
}

async function updateEntityInSellsy(existingCompanyId, company) {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = 'https://apifeed.sellsy.com/0/';
    const sellsyCompanyData = mapCatalogToSellsy(company);
    const entityType = company.catalog_names.includes("prospect") ? 'Prospects' : 'Client';
    const method = getSellsyMethod(company.catalog_names, true);
    const requestParams = getSellsyUpdateParams(existingCompanyId, sellsyCompanyData, entityType);

    const requestSettings = {
        method: method,
        params: requestParams
    };

    const params = new URLSearchParams();
    params.append('io_mode', 'json');
    params.append('do_in', JSON.stringify(requestSettings));

    try {
        const response = await axios({
            method: 'post',
            url: apiUrl,
            data: params,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        if (response.data.status === 'success') {
            console.log('Entity updated successfully with id:', existingCompanyId);
            return existingCompanyId;
        } else {
            throw new Error('Failed to update entity (client/prospect)');
        }
    } catch (error) {
        console.error('Error updating entity (client/prospect):', error);
        throw error;
    }
}

//////////////////////////////////////////////////////////////////////////////// prospect <-> client //////////////////////////////////////////////////////////////////

async function transformProspectToCustomer(thirdId, enableCustomfieldsOnCustomer = 'N') {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = 'https://apifeed.sellsy.com/0/';
    const params = new URLSearchParams();
    const requestSettings = {
        method: 'Prospects.transformToCustomer',
        params: {
            thirdid: thirdId,
            enableCustomfieldsOnCustomer: enableCustomfieldsOnCustomer
        }
    };

    params.append('io_mode', 'json');
    params.append('do_in', JSON.stringify(requestSettings));

    try {
        const response = await axios({
            method: 'post',
            url: apiUrl,
            data: params,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        console.log('Prospect transformed to customer successfully');
        return response.data;
    } catch (error) {
        console.error('Error transforming prospect to customer:', error);
        throw error;
    }
}

async function transformClientToProspect(thirdId, enableCustomfieldsOnProspect = 'N') {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = 'https://apifeed.sellsy.com/0/';
    const params = new URLSearchParams();
    const requestSettings = {
        method: 'Client.transformToProspect',
        params: {
            thirdid: thirdId,
            enableCustomfieldsOnProspect: enableCustomfieldsOnProspect
        }
    };

    params.append('io_mode', 'json');
    params.append('do_in', JSON.stringify(requestSettings));

    try {
        const response = await axios({
            method: 'post',
            url: apiUrl,
            data: params,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        console.log('Client transformed to prospect successfully');
        return response.data;
    } catch (error) {
        console.error('Error transforming client to prospect:', error);
        throw error;
    }
}


/////////////////////////////////////////////////////////////////////////////// company contacts //////////////////////////////////////////////////////////////////////


async function synchronizeContacts(companyId, companyType, newContacts) {
    console.log('Received contacts for synchronization:', newContacts);
    
    if (!newContacts || newContacts.length === 0) {
        console.log("No contacts provided for synchronization.");
        return;
    }

    // Fetch existing contacts from Sellsy
    const existingContacts = await fetchContactsFromSellsy(companyId);
    
    // Check if there are existing contacts to obtain an ID; otherwise, use the passed companyId
    if (existingContacts.length > 0) {
        companyId = existingContacts[0].id; // Adjust based on where the ID you need is stored
    } else {
        console.log("No existing contacts found in Sellsy for this company.");
    }

    const { toAdd, toUpdate, toDelete } = compareContacts(existingContacts, newContacts);
    let isProspect = companyType === "prospect";

    await Promise.all([
        ...toAdd.map(contact => createContactInSellsy(isProspect, companyId, contact)),
        ...toUpdate.map(contact => updateContactInSellsy(companyId, contact)),
        ...toDelete.map(contact => deleteContactInSellsy(companyId))
    ]);
}


async function fetchContactsFromSellsy(companyId) {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = `https://api.sellsy.com/v2/companies/${companyId}/contacts`;  
    try {
        const response = await axios.get(apiUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            params:{
                field: ['id', 'first_name', 'last_name', 'phone_number', 'email'], 
            },
        });
        return response.data.data || [];  
    } catch (error) {
        console.error('Failed to fetch contacts:', error);
        throw error;
    }
}

async function updateContactInSellsy(contactId, contact) {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = `https://api.sellsy.com/v2/contacts/${contactId}`;
    const payload = {
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        position: contact.position
    };

    try {
        const response = await axios.put(apiUrl, payload, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('Contact updated:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error updating contact:', error);
        throw error;
    }
}

async function createContactInSellsy(isProspect, entityId, contact) {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = 'https://apifeed.sellsy.com/0/';
    const params = new URLSearchParams();

    // Define the method based on whether the entity is a prospect or a client
    const method = isProspect ? 'Prospects.addContact' : 'Client.addContact';
    // Construct the contact object based on the API requirements
    const contactData = {
        name:  contact.last_name || contact.first_name,
        email: contact.email || "",
        tel: contact.phone || "",
    };

    // Prepare the request object
    const request = {
        method: method,
        params: {
            [isProspect ? 'prospectid' : 'clientid']: entityId,
            contact: contactData
        }
    };

    // Append the required headers and parameters
    params.append('io_mode', 'json');
    params.append('do_in', JSON.stringify(request));

    try {
        const response = await axios({
            method: 'post',
            url: apiUrl,
            data: params,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        console.log('Contact created successfully:', response.data);
        return response.data.response.contact_id;
    } catch (error) {
        console.error('Error creating contact:', error);
        throw error;
    }
}


async function deleteContactInSellsy(contactId) {
    const accessToken = await getSellsyAccessToken();
    const apiUrl = `https://api.sellsy.com/v2/contacts/${contactId}`;
    try {
        const response = await axios.delete(apiUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('Contact deleted:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error deleting contact:', error);
        throw error;
    }
}


function compareContacts(existing, incoming) {
    const existingEmails = new Set(existing.map(contact => contact.email));
    const incomingEmails = new Set(incoming.map(contact => contact.email));
    

    const toAdd = incoming.filter(contact => !existingEmails.has(contact.email));
    const toDelete = existing.filter(contact => !incomingEmails.has(contact.email));
    const toUpdate = incoming.filter(contact => existingEmails.has(contact.email));
    return { toAdd, toUpdate, toDelete };
}


function needsUpdate(existing, incoming) {
    return existing.name !== incoming.name ||
           existing.phone !== incoming.phone ||
           existing.position !== incoming.position;
}


// async function synchronizeCompanies() {
//     const catalogCompanies = await getAllCompanies();
//     for (const company of catalogCompanies) {
//       try {
//         const clientId = await createEntityWithDetails(company);
  
//         if (clientId) {
//           console.log(`Company created in Sellsy with ID: ${clientId}`);
//         } else {
//           console.error('Failed to create company in Sellsy. No company ID returned.');
//         }
//       } catch (error) {
//         console.error(`Error processing company ${company.name}:`, error);
//       }
//     }
// }



module.exports = {
    getSellsyAccessToken,
    createSellsyOrder,
    createSellsyInvoice,
    webhookHandler,
    handleWebhookOrder
};
  