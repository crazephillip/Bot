const { readData, writeData, sendJson } = require('../../lib/kv');
const { randomUUID } = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  if (req.method !== 'POST') { sendJson(res, { error: 'Method not allowed' }, 405); return; }
  const body = req.body;
  if (!body) { sendJson(res, { error: 'invalid body' }, 400); return; }
  const trades = await readData('my_trades');
  const entryPrice = body.entry_price ? Number(body.entry_price) : 0;
  const newTrade = {
    id:            'trade-' + randomUUID().slice(0, 8),
    ticker:        body.ticker     ? body.ticker.toUpperCase() : '',
    strike:        body.strike     ? Number(body.strike)       : 0,
    expiry:        body.expiry     ?? '',
    call_put:      body.call_put   ? body.call_put.toUpperCase() : 'CALL',
    contracts:     body.contracts  ? Number(body.contracts)    : 1,
    entry_price:   entryPrice,
    current_price: entryPrice,
    status:        'open',
    opened_at:     new Date().toISOString().slice(0, 19),
    closed_at:     null,
    notes:         body.notes ?? '',
    pnl:           0
  };
  trades.push(newTrade);
  await writeData('my_trades', trades);
  sendJson(res, newTrade);
};
