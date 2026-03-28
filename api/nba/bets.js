const { readData, sendJson } = require('../../lib/kv');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  if (req.method !== 'GET') { sendJson(res, { error: 'Method not allowed' }, 405); return; }
  const bets = await readData('nba_bets');
  sendJson(res, bets);
};
