const { readData, sendJson } = require('../../lib/kv');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  let players = await readData('nba_players');
  const { search } = req.query;
  if (search) {
    const s = search.toLowerCase();
    players = players.filter(p => p.name?.toLowerCase().includes(s));
  }
  sendJson(res, players);
};
