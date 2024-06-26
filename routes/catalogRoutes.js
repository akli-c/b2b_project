const express = require('express');
const router = express.Router();
const { getAllOrders, createOrUpdateOrder } = require('../services/catalogService');
const { handleWebhookOrder, webhookHandler } = require("../services/sellsyService");

// get all orders
router.get('/orders', async (req, res) => {
  try {
    const products = await getAllOrders();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  console.log('ça marche')
  res.send('ça marche') 
})

//  post a new order 
router.post('/orders', async (req, res) => {
  try {
    const newOrder = await createOrUpdateOrder(req.body);
    res.json(newOrder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Webhook
router.post('/webhook', async (req, res) => {
  try {
    const webhookData = req.body;
    console.log('Webhook received:', webhookData);

    // Call webhookHandler to process the received data
    await handleWebhookOrder(webhookData);

    res.status(200).json({
      message: 'Webhook data processed successfully'
    });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({
      error: 'Error handling webhook',
      details: error.message
    });
  }
});

// router.post('/companies', async (req, res) => {
//   try {
//     const companyData = req.body;
//     console.log('Received company data:', companyData);

    


//     const sellsyResponse = await createEntityWithDetails(companyData);
//     console.log(companyData.id)
//     console.log('Sellsy response:', sellsyResponse);
//     console.log(sellsyResponse.id)

//     if (sellsyResponse) {
//       // If the operation was a creation, update the Catalog with the Sellsy client ID
//       const updatedCatalogCompany = await updateCompanyInCatalog(companyData.id, companyData.name, sellsyResponse.id);
      
//       res.status(200).json({
//         message: 'Company processed in Sellsy and updated in Catalog successfully',
//         operation: sellsyResponse.isNewEntity ? 'created' : 'updated',
//         sellsyId: sellsyResponse.id, // The Sellsy client ID
//         catalogUpdate: updatedCatalogCompany // The response from the Catalog update
//       });

//       await webhookHandler(companyData);
//     } else {
//       throw new Error('Not a new company');
//     }
//   } catch (error) {
//     console.error('Error in processing company:', error);
//     res.status(500).json(error);
//   }
// });

// Webhook endpoint for handling company creation or updates
router.post('/companies', async (req, res) => {
  try {
    const webhookData = req.body;
    console.log('Webhook received:', webhookData);

    // Call webhookHandler to process the received data
    await webhookHandler(webhookData);

    res.status(200).json({
      message: 'Webhook data processed successfully'
    });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({
      error: 'Error handling webhook',
      details: error.message
    });
  }
});



module.exports = router;
