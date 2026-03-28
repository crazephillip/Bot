const { readData, sendJson } = require('../../../../lib/kv');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  const { id } = req.query;
  const gamelogs = await readData('nba_gamelogs');
  const playerLogs = gamelogs
    .filter(l => String(l.player_id) === String(id))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  sendJson(res, playerLogs);
};
