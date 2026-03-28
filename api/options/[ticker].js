const { readData, sendJson } = require('../../lib/kv');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  const ticker = req.query.ticker.toUpperCase();
  const chainData = await readData('options_chain');
  sendJson(res, chainData[ticker] ?? []);
};
