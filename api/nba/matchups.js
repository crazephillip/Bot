const { readData, sendJson } = require('../../lib/kv');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }

  const [todayGames, gamelogs, players] = await Promise.all([
    readData('nba_today_games'),
    readData('nba_gamelogs'),
    readData('nba_players')
  ]);

  // Build per-team defensive averages from game logs
  const teamDef = {};
  for (const log of gamelogs) {
    const opp = String(log.opponent || '');
    if (!opp) continue;
    if (!teamDef[opp]) teamDef[opp] = { pts: [], reb: [], ast: [] };
    teamDef[opp].pts.push(Number(log.pts) || 0);
    teamDef[opp].reb.push(Number(log.reb) || 0);
    teamDef[opp].ast.push(Number(log.ast) || 0);
  }

  const defAvg = (team, stat) => {
    const arr = teamDef[team]?.[stat];
    if (!arr?.length) return null;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10;
  };

  const matchups = todayGames.map(g => {
    const homePlayers = players.filter(p => p.team === g.home);
    const awayPlayers = players.filter(p => p.team === g.away);

    const flags = [];
    for (const p of [...homePlayers, ...awayPlayers]) {
      const pid  = String(p.id);
      const pOpp = homePlayers.includes(p) ? g.away : g.home;
      const pLogs = gamelogs
        .filter(l => String(l.player_id) === pid)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 10);
      if (pLogs.length < 3) continue;

      const ptsArr = pLogs.map(l => Number(l.pts) || 0);
      const avgPts = Math.round(ptsArr.reduce((a, b) => a + b, 0) / ptsArr.length * 10) / 10;
      const vsOpp  = pLogs.filter(l => l.opponent === pOpp);

      let grade = 'C';
      if (vsOpp.length >= 2) {
        const vsAvg = vsOpp.reduce((a, l) => a + (Number(l.pts) || 0), 0) / vsOpp.length;
        if (vsAvg > avgPts * 1.10) grade = 'A';
        else if (vsAvg > avgPts * 1.03) grade = 'B';
      }
      flags.push({ player: String(p.name), team: String(p.team), opp: pOpp, avg_pts: avgPts, grade });
    }

    return {
      game:         `${g.away} @ ${g.home}`,
      home:         String(g.home),
      away:         String(g.away),
      time:         String(g.time),
      status:       String(g.status),
      home_def_pts: defAvg(g.home, 'pts'),
      home_def_reb: defAvg(g.home, 'reb'),
      home_def_ast: defAvg(g.home, 'ast'),
      away_def_pts: defAvg(g.away, 'pts'),
      away_def_reb: defAvg(g.away, 'reb'),
      away_def_ast: defAvg(g.away, 'ast'),
      players:      flags
    };
  });

  sendJson(res, matchups);
};
