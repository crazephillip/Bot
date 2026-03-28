const { readData, sendJson } = require('../../lib/kv');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  const ticker = req.query.ticker.toUpperCase();
  const priceData = await readData('stock_prices');
  const price = priceData[ticker];
  if (price) {
    sendJson(res, price);
  } else {
    sendJson(res, { error: 'no price data' }, 404);
  }
};
