const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const catalogService = require('./services/catalogService');
const cron = require('node-cron')
const ekanRoutes = require('./routes/ekanRoutes');
const catalogRoutes = require('./routes/catalogRoutes');
const {syncStockLevels} = require('./services/catalogService')
// const { syncProducts } = require('./services/sellsyService');

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

//PROD/DEV DISTINCT
let url = ""
if (process.env.NODE_ENV == "development") {
  url = process.env.NGROK_URL
} else if (process.env.NODE_ENV == "production") {
  url = process.env.RENDER_URL
}

const registerWebhook = async () => {
  console.log("url",url)
    const webhookUrl = `${url}/catalog/webhook`; 
    const apiKey = process.env.CATALOG_DEV_KEY; 
    try {
      await catalogService.registerWebhook(webhookUrl, apiKey);
      console.log('Webhook for orders registered successfully', webhookUrl);
    } catch (error) {
      console.error('Failed to register webhook:', error);
    }
};

const registerWebhookCompanies = async () => {
  const webhookUrl = `${url}/catalog/companies`; 
  const apiKey = process.env.CATALOG_DEV_KEY; 
  try {
    await catalogService.registerWebhookCompanies(webhookUrl, apiKey);
    console.log('Webhook for companies registered successfully', webhookUrl);
  } catch (error) {
    console.error('Failed to register webhook:', error);
  }
};



app.use('/ekan', ekanRoutes);
app.use('/catalog', catalogRoutes);

// cron.schedule('21 11 * * *', () => {
//   console.log('Starting customer synchronization...');
// }, {
//   scheduled: true,
//   timezone: "Europe/Paris" 
// });


app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});


registerWebhook()
registerWebhookCompanies()
// syncProducts();

// cron job sync stocks 
cron.schedule('0 */4 * * *', syncStockLevels); // Runs every 4 hours


module.exports = app; // dev
