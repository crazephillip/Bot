const { readData, sendJson } = require('../../../../lib/kv');
const { runPropModel } = require('../../../../lib/propModel');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  const { id } = req.query;
  const { line = '20.5', stat = 'pts', home_away = 'home' } = req.query;
  const gamelogs = await readData('nba_gamelogs');
  const playerLogs = gamelogs.filter(l => String(l.player_id) === String(id));
  if (playerLogs.length === 0) {
    sendJson(res, { error: `not enough data for player ${id}` }, 404);
    return;
  }
  const first = playerLogs[0];
  const result = runPropModel(first.player_name, id, first.team, stat, Number(line), gamelogs, 'OPP');
  if (result) {
    sendJson(res, result);
  } else {
    sendJson(res, { error: `not enough data for player ${id}` }, 404);
  }
};
