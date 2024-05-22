const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const catalogService = require('./services/catalogService');
const cron = require('node-cron')
// const ekanRoutes = require('./routes/ekanRoutes');
const catalogRoutes = require('./routes/catalogRoutes');

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
    const apiKey = process.env.STARTCATALOG_API_KEY; 
    try {
      await catalogService.registerWebhook(webhookUrl, apiKey);
      console.log('Webhook for orders registered successfully');
    } catch (error) {
      console.error('Failed to register webhook:', error);
    }
};

const registerWebhookCompanies = async () => {
  const webhookUrl = `${url}/catalog/companies`; 
  const apiKey = process.env.STARTCATALOG_API_KEY; 
  try {
    await catalogService.registerWebhookCompanies(webhookUrl, apiKey);
    console.log('Webhook for companies registered successfully');
  } catch (error) {
    console.error('Failed to register webhook:', error);
  }
};



//app.use('/ekan', ekanRoutes);
app.use('/catalog', catalogRoutes);

cron.schedule('21 11 * * *', () => {
  console.log('Starting customer synchronization...');
}, {
  scheduled: true,
  timezone: "Europe/Paris" 
});


app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

registerWebhook()
registerWebhookCompanies()

module.exports = app; // dev
