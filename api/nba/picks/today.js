const { readData, sendJson } = require('../../../lib/kv');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  const today = new Date().toISOString().slice(0, 10);
  const picks = await readData('nba_picks');
  const todayPicks = picks.filter(p => p.date === today);
  sendJson(res, todayPicks.length > 0 ? todayPicks : picks);
};
