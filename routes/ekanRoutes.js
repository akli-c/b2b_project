const express = require('express');
const router = express.Router();
const ekanService = require('../services/ekanService');

// create order
router.post('/orders', async (req, res) => {
  try {
    const result = await ekanService.createEkanOrder(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
