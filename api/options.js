const { readData, sendJson } = require('../lib/kv');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  const { ticker } = req.query;
  if (!ticker) { sendJson(res, { error: 'ticker required' }, 400); return; }
  const chainData = await readData('options_chain');
  sendJson(res, chainData[ticker.toUpperCase()] ?? []);
};
