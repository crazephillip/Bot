const { readData, writeData, sendJson } = require('../lib/kv');
const { runPropModel } = require('../lib/propModel');
const { randomUUID } = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { sendJson(res, {}, 204); return; }
  const { action, id, search, line, stat, home_away } = req.query;

  // GET /api/nba/picks/today
  if (action === 'picks-today') {
    const today = new Date().toISOString().slice(0, 10);
    const picks = await readData('nba_picks');
    const todayPicks = picks.filter(p => p.date === today);
    sendJson(res, todayPicks.length > 0 ? todayPicks : picks);
    return;
  }

  // GET /api/nba/players
  if (action === 'players') {
    let players = await readData('nba_players');
    if (search) {
      const s = search.toLowerCase();
      players = players.filter(p => p.name?.toLowerCase().includes(s));
    }
    sendJson(res, players);
    return;
  }

  // GET /api/nba/matchups
  if (action === 'matchups') {
    const [todayGames, gamelogs, players] = await Promise.all([
      readData('nba_today_games'),
      readData('nba_gamelogs'),
      readData('nba_players')
    ]);
    const teamDef = {};
    for (const log of gamelogs) {
      const opp = String(log.opponent || '');
      if (!opp) continue;
      if (!teamDef[opp]) teamDef[opp] = { pts: [], reb: [], ast: [] };
      teamDef[opp].pts.push(Number(log.pts) || 0);
      teamDef[opp].reb.push(Number(log.reb) || 0);
      teamDef[opp].ast.push(Number(log.ast) || 0);
    }
    const defAvg = (team, s) => {
      const arr = teamDef[team]?.[s];
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
        game: `${g.away} @ ${g.home}`,
        home: String(g.home), away: String(g.away), time: String(g.time), status: String(g.status),
        home_def_pts: defAvg(g.home, 'pts'), home_def_reb: defAvg(g.home, 'reb'), home_def_ast: defAvg(g.home, 'ast'),
        away_def_pts: defAvg(g.away, 'pts'), away_def_reb: defAvg(g.away, 'reb'), away_def_ast: defAvg(g.away, 'ast'),
        players: flags
      };
    });
    sendJson(res, matchups);
    return;
  }

  // GET /api/nba/bets
  if (action === 'bets' && req.method === 'GET') {
    sendJson(res, await readData('nba_bets'));
    return;
  }

  // POST /api/nba/bets/add
  if (action === 'bets-add' && req.method === 'POST') {
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
    return;
  }

  // PUT /api/nba/bets/:id/result
  if (action === 'bets-result' && req.method === 'PUT' && id) {
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
    return;
  }

  // GET /api/nba/player/:id/stats
  if (action === 'player-stats' && id) {
    const gamelogs = await readData('nba_gamelogs');
    const playerLogs = gamelogs
      .filter(l => String(l.player_id) === String(id))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    sendJson(res, playerLogs);
    return;
  }

  // GET /api/nba/player/:id/props
  if (action === 'player-props' && id) {
    const gamelogs = await readData('nba_gamelogs');
    const playerLogs = gamelogs.filter(l => String(l.player_id) === String(id));
    if (playerLogs.length === 0) {
      sendJson(res, { error: `not enough data for player ${id}` }, 404);
      return;
    }
    const first  = playerLogs[0];
    const result = runPropModel(
      first.player_name, id, first.team,
      stat || 'pts', Number(line || '20.5'),
      gamelogs, 'OPP'
    );
    if (result) sendJson(res, result);
    else sendJson(res, { error: `not enough data for player ${id}` }, 404);
    return;
  }

  sendJson(res, { error: 'Not found' }, 404);
};
