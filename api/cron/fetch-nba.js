const { readData, writeData } = require('../../lib/kv');
const { runPropModel } = require('../../lib/propModel');

const SEASON = '2026';

const DEFAULT_PLAYERS = [
  { id: '1966',    name: 'LeBron James',            team: 'CLE', position: 'F' },
  { id: '3975',    name: 'Stephen Curry',           team: 'GSW', position: 'G' },
  { id: '3136193', name: 'Luka Doncic',             team: 'LAL', position: 'G' },
  { id: '3032977', name: 'Giannis Antetokounmpo',   team: 'MIL', position: 'F' },
  { id: '3059318', name: 'Jayson Tatum',            team: 'BOS', position: 'F' },
  { id: '4065648', name: 'Shai Gilgeous-Alexander', team: 'OKC', position: 'G' },
  { id: '4277905', name: 'Cade Cunningham',         team: 'DET', position: 'G' },
  { id: '3134907', name: 'Donovan Mitchell',        team: 'CLE', position: 'G' },
  { id: '4432816', name: 'Victor Wembanyama',       team: 'SAS', position: 'C' },
  { id: '4066648', name: 'Tyrese Haliburton',       team: 'IND', position: 'G' }
];

const DEFAULT_LINES = {
  pts: { 'LeBron James': 22.5, 'Stephen Curry': 23.5, 'Luka Doncic': 28.5, 'Giannis Antetokounmpo': 29.5, 'Jayson Tatum': 26.5, 'Shai Gilgeous-Alexander': 30.5, 'Cade Cunningham': 24.5, 'Donovan Mitchell': 25.5, 'Victor Wembanyama': 22.5, 'Tyrese Haliburton': 19.5 },
  reb: { 'LeBron James': 7.5,  'Stephen Curry': 4.5,  'Luka Doncic': 8.5,  'Giannis Antetokounmpo': 11.5, 'Jayson Tatum': 8.5,  'Shai Gilgeous-Alexander': 4.5,  'Cade Cunningham': 5.5,  'Donovan Mitchell': 4.5,  'Victor Wembanyama': 10.5, 'Tyrese Haliburton': 4.5  },
  ast: { 'LeBron James': 7.5,  'Stephen Curry': 5.5,  'Luka Doncic': 7.5,  'Giannis Antetokounmpo': 5.5,  'Jayson Tatum': 4.5,  'Shai Gilgeous-Alexander': 5.5,  'Cade Cunningham': 8.5,  'Donovan Mitchell': 4.5,  'Victor Wembanyama': 3.5,  'Tyrese Haliburton': 8.5  }
};

async function espnGet(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parse3PM(s) { try { return parseInt(String(s).split('-')[0]) || 0; } catch { return 0; } }
function parseMin(s)  { try { return parseInt(String(s).split(':')[0]) || 0; } catch { return 0; } }

async function fetchPlayerLogs(espnId, playerName, team) {
  let resp;
  try {
    resp = await espnGet(
      `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${espnId}/gamelog?season=${SEASON}`
    );
  } catch { return []; }

  let statEvents = [];
  for (const st of (resp.seasonTypes || [])) {
    for (const cat of (st.categories || [])) {
      if (cat.events?.length) { statEvents = cat.events; break; }
    }
    if (statEvents.length) break;
  }

  const eventLookup = resp.events || {};
  const logs = [];

  for (const se of statEvents) {
    const stats = se.stats;
    if (!stats || stats.length < 14) continue;

    let gameDate = '', opponent = '', homeAway = 'home';
    const meta = eventLookup[se.eventId];
    if (meta) {
      try { gameDate = new Date(meta.gameDate).toISOString().slice(0, 10); } catch {}
      if (meta.opponent?.abbreviation) opponent = meta.opponent.abbreviation;
      if (meta.atVs === '@') homeAway = 'away';
    }

    logs.push({
      player_id:   espnId,
      player_name: playerName,
      team,
      date:        gameDate,
      pts:         parseInt(stats[13]) || 0,
      reb:         parseInt(stats[7])  || 0,
      ast:         parseInt(stats[8])  || 0,
      stl:         parseInt(stats[10]) || 0,
      blk:         parseInt(stats[9])  || 0,
      three_pm:    parse3PM(stats[3]),
      min:         parseMin(stats[0]),
      opponent,
      home_away:   homeAway
    });
  }

  return logs;
}

async function fetchTodaysGames() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let resp;
  try {
    resp = await espnGet(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${today}`
    );
  } catch { return []; }

  const games = [];
  for (const ev of (resp.events || [])) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    let home = '', away = '';
    for (const c of (comp.competitors || [])) {
      if (c.homeAway === 'home') home = c.team.abbreviation;
      else                       away = c.team.abbreviation;
    }
    let time = '';
    try { time = new Date(ev.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); } catch {}
    games.push({
      id:     ev.id,
      name:   ev.shortName,
      home,   away,   time,
      status: ev.status?.type?.description || ''
    });
  }
  return games;
}

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    // Load or seed players
    let players = await readData('nba_players');
    if (!players.length) {
      players = DEFAULT_PLAYERS;
      await writeData('nba_players', players);
    }

    // Fetch game logs for each player
    const existingLogs = await readData('nba_gamelogs');
    const existingByPlayer = {};
    for (const l of existingLogs) {
      const pid = String(l.player_id);
      if (!existingByPlayer[pid]) existingByPlayer[pid] = [];
      existingByPlayer[pid].push(l);
    }

    const allLogs = [];
    for (const p of players) {
      const pid     = String(p.id);
      const newLogs = await fetchPlayerLogs(pid, p.name, p.team);
      allLogs.push(...(newLogs.length > 0 ? newLogs : (existingByPlayer[pid] || [])));
      await sleep(1000);
    }

    if (allLogs.length > 0) await writeData('nba_gamelogs', allLogs);

    // Fetch today's schedule
    const todayGames = await fetchTodaysGames();
    if (todayGames.length > 0) await writeData('nba_today_games', todayGames);

    // Generate value picks
    const picks = [];
    for (const p of players) {
      for (const statKey of ['pts', 'reb', 'ast']) {
        const line = DEFAULT_LINES[statKey]?.[p.name];
        if (!line) continue;

        const game = todayGames.find(g => g.home === p.team || g.away === p.team);
        const opp  = game ? (game.home === p.team ? game.away : game.home) : 'OPP';

        const pick = runPropModel(p.name, String(p.id), p.team, statKey, line, allLogs, opp);
        if (pick && pick.ev > 0.03) picks.push(pick);
      }
    }

    const topPicks = picks.sort((a, b) => b.ev - a.ev).slice(0, 15);
    if (topPicks.length > 0) await writeData('nba_picks', topPicks);

    res.json({
      ok:        true,
      players:   players.length,
      logs:      allLogs.length,
      games:     todayGames.length,
      picks:     topPicks.length
    });
  } catch (err) {
    console.error('fetch-nba cron error:', err);
    res.status(500).json({ error: err.message });
  }
};
