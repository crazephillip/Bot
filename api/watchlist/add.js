const { readData, writeData, sendJson } = require('../../lib/kv');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  if (req.method !== 'POST') { sendJson(res, { error: 'Method not allowed' }, 405); return; }
  const body = req.body;
  if (!body?.ticker) { sendJson(res, { error: 'ticker required' }, 400); return; }
  const ticker = body.ticker.toUpperCase().trim();
  const watchlist = await readData('watchlist');
  if (watchlist.find(w => w.ticker === ticker)) {
    sendJson(res, { ok: true, message: 'already in watchlist' });
    return;
  }
  watchlist.push({ ticker, added_on: new Date().toISOString().slice(0, 19) });
  await writeData('watchlist', watchlist);
  sendJson(res, { ok: true, ticker });
};
