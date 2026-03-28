const { readData, writeData, sendJson } = require('../../../../lib/kv');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  if (req.method !== 'PUT') { sendJson(res, { error: 'Method not allowed' }, 405); return; }
  const { id } = req.query;
  const body = req.body;
  const bets = await readData('nba_bets');
  let found = false;
  const updated = bets.map(b => {
    if (b.id !== id) return b;
    found = true;
    const result = body?.result ?? 'pending';
    const stake  = Number(b.stake) || 0;
    const odds   = Number(b.odds)  || -110;
    let pnl = 0;
    if (result === 'win') {
      pnl = odds < 0
        ? Math.round(stake * (100 / Math.abs(odds)) * 100) / 100
        : Math.round(stake * (odds / 100) * 100) / 100;
    } else if (result === 'loss') {
      pnl = -stake;
    }
    return { ...b, result, pnl };
  });
  if (!found) { sendJson(res, { error: 'bet not found' }, 404); return; }
  await writeData('nba_bets', updated);
  sendJson(res, { ok: true });
};
