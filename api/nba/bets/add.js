const { readData, writeData, sendJson } = require('../../../lib/kv');
const { randomUUID } = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  if (req.method !== 'POST') { sendJson(res, { error: 'Method not allowed' }, 405); return; }
  const body = req.body;
  if (!body) { sendJson(res, { error: 'invalid body' }, 400); return; }
  const bets = await readData('nba_bets');
  const newBet = {
    id:          'bet-' + randomUUID().slice(0, 8),
    date:        body.date        ?? new Date().toISOString().slice(0, 10),
    player_name: body.player_name ?? '',
    prop_type:   body.prop_type   ?? 'pts',
    line:        body.line        ? Number(body.line)  : 0,
    over_under:  body.over_under  ?? 'over',
    odds:        body.odds        ? Number(body.odds)  : -110,
    stake:       body.stake       ? Number(body.stake) : 0,
    sportsbook:  body.sportsbook  ?? '',
    result:      'pending',
    pnl:         0
  };
  bets.push(newBet);
  await writeData('nba_bets', bets);
  sendJson(res, newBet);
};
