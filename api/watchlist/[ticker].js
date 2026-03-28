const { readData, writeData, sendJson } = require('../../lib/kv');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  if (req.method !== 'DELETE') { sendJson(res, { error: 'Method not allowed' }, 405); return; }
  const ticker = req.query.ticker.toUpperCase();
  const watchlist = await readData('watchlist');
  await writeData('watchlist', watchlist.filter(w => w.ticker !== ticker));
  sendJson(res, { ok: true, removed: ticker });
};
