const { readData, sendJson } = require('../lib/kv');
const { getScreenerResults } = require('../lib/screener');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  const [chainData, priceData] = await Promise.all([
    readData('options_chain'),
    readData('stock_prices')
  ]);
  sendJson(res, getScreenerResults(chainData, priceData));
};
