const { readData, writeData, sendJson } = require('../lib/kv');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  const { action, ticker } = req.query;

  // DELETE /api/watchlist/:ticker
  if (req.method === 'DELETE' && ticker) {
    const watchlist = await readData('watchlist');
    await writeData('watchlist', watchlist.filter(w => w.ticker !== ticker.toUpperCase()));
    sendJson(res, { ok: true, removed: ticker.toUpperCase() });
    return;
  }

  // POST /api/watchlist/add
  if (req.method === 'POST' && action === 'add') {
    const body = req.body;
    if (!body?.ticker) { sendJson(res, { error: 'ticker required' }, 400); return; }
    const t = body.ticker.toUpperCase().trim();
    const watchlist = await readData('watchlist');
    if (watchlist.find(w => w.ticker === t)) {
      sendJson(res, { ok: true, message: 'already in watchlist' });
      return;
    }
    watchlist.push({ ticker: t, added_on: new Date().toISOString().slice(0, 19) });
    await writeData('watchlist', watchlist);
    sendJson(res, { ok: true, ticker: t });
    return;
  }

  // GET /api/watchlist
  if (req.method === 'GET') {
    sendJson(res, await readData('watchlist'));
    return;
  }

  sendJson(res, { error: 'Not found' }, 404);
};
