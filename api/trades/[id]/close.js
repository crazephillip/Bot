const { readData, writeData, sendJson } = require('../../../lib/kv');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  if (req.method !== 'PUT') { sendJson(res, { error: 'Method not allowed' }, 405); return; }
  const { id } = req.query;
  const body = req.body;
  const trades = await readData('my_trades');
  let found = false;
  const updated = trades.map(t => {
    if (t.id !== id) return t;
    found = true;
    const closePrice = body?.close_price ? Number(body.close_price) : Number(t.current_price);
    const contracts  = Number(t.contracts) || 1;
    const pnl = Math.round((closePrice - Number(t.entry_price)) * contracts * 100 * 100) / 100;
    return { ...t, status: 'closed', current_price: closePrice, closed_at: new Date().toISOString().slice(0, 19), pnl };
  });
  if (!found) { sendJson(res, { error: 'trade not found' }, 404); return; }
  await writeData('my_trades', updated);
  sendJson(res, { ok: true });
};
