const { readData, writeData, sendJson } = require('../lib/kv');
const { randomUUID } = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  const { action, id } = req.query;

  // PUT /api/trades/:id/close
  if (req.method === 'PUT' && action === 'close' && id) {
    const body = req.body;
    const trades = await readData('my_trades');
    let found = false;
    const updated = trades.map(t => {
      if (t.id !== id) return t;
      found = true;
      const closePrice = body?.close_price ? Number(body.close_price) : Number(t.current_price);
      const pnl = Math.round((closePrice - Number(t.entry_price)) * (Number(t.contracts) || 1) * 100 * 100) / 100;
      return { ...t, status: 'closed', current_price: closePrice, closed_at: new Date().toISOString().slice(0, 19), pnl };
    });
    if (!found) { sendJson(res, { error: 'trade not found' }, 404); return; }
    await writeData('my_trades', updated);
    sendJson(res, { ok: true });
    return;
  }

  // POST /api/trades/add
  if (req.method === 'POST' && action === 'add') {
    const body = req.body;
    if (!body) { sendJson(res, { error: 'invalid body' }, 400); return; }
    const trades = await readData('my_trades');
    const ep = body.entry_price ? Number(body.entry_price) : 0;
    const newTrade = {
      id:            'trade-' + randomUUID().slice(0, 8),
      ticker:        body.ticker    ? body.ticker.toUpperCase() : '',
      strike:        body.strike    ? Number(body.strike)       : 0,
      expiry:        body.expiry    ?? '',
      call_put:      body.call_put  ? body.call_put.toUpperCase() : 'CALL',
      contracts:     body.contracts ? Number(body.contracts)    : 1,
      entry_price:   ep,
      current_price: ep,
      status:        'open',
      opened_at:     new Date().toISOString().slice(0, 19),
      closed_at:     null,
      notes:         body.notes ?? '',
      pnl:           0
    };
    trades.push(newTrade);
    await writeData('my_trades', trades);
    sendJson(res, newTrade);
    return;
  }

  // GET /api/trades
  if (req.method === 'GET') {
    sendJson(res, await readData('my_trades'));
    return;
  }

  sendJson(res, { error: 'Not found' }, 404);
};
