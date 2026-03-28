const { readData, writeData } = require('../lib/kv');
const { runPropModel } = require('../lib/propModel');

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
  pts: { 'LeBron James':22.5,'Stephen Curry':23.5,'Luka Doncic':28.5,'Giannis Antetokounmpo':29.5,'Jayson Tatum':26.5,'Shai Gilgeous-Alexander':30.5,'Cade Cunningham':24.5,'Donovan Mitchell':25.5,'Victor Wembanyama':22.5,'Tyrese Haliburton':19.5 },
  reb: { 'LeBron James':7.5,'Stephen Curry':4.5,'Luka Doncic':8.5,'Giannis Antetokounmpo':11.5,'Jayson Tatum':8.5,'Shai Gilgeous-Alexander':4.5,'Cade Cunningham':5.5,'Donovan Mitchell':4.5,'Victor Wembanyama':10.5,'Tyrese Haliburton':4.5 },
  ast: { 'LeBron James':7.5,'Stephen Curry':5.5,'Luka Doncic':7.5,'Giannis Antetokounmpo':5.5,'Jayson Tatum':4.5,'Shai Gilgeous-Alexander':5.5,'Cade Cunningham':8.5,'Donovan Mitchell':4.5,'Victor Wembanyama':3.5,'Tyrese Haliburton':8.5 }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
function parse3PM(s) { try { return parseInt(String(s).split('-')[0])||0; } catch { return 0; } }
function parseMin(s)  { try { return parseInt(String(s).split(':')[0])||0; } catch { return 0; } }

async function espnGet(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fetchPlayerLogs(espnId, playerName, team) {
  try {
    const resp = await espnGet(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${espnId}/gamelog?season=${SEASON}`);
    let statEvents = [];
    for (const st of (resp.seasonTypes||[])) {
      for (const cat of (st.categories||[])) {
        if (cat.events?.length) { statEvents = cat.events; break; }
      }
      if (statEvents.length) break;
    }
    const eventLookup = resp.events || {};
    return statEvents
      .filter(se => se.stats?.length >= 14)
      .map(se => {
        let gameDate='', opponent='', homeAway='home';
        const meta = eventLookup[se.eventId];
        if (meta) {
          try { gameDate = new Date(meta.gameDate).toISOString().slice(0,10); } catch {}
          if (meta.opponent?.abbreviation) opponent = meta.opponent.abbreviation;
          if (meta.atVs === '@') homeAway = 'away';
        }
        return { player_id:espnId, player_name:playerName, team, date:gameDate,
          pts:parseInt(se.stats[13])||0, reb:parseInt(se.stats[7])||0, ast:parseInt(se.stats[8])||0,
          stl:parseInt(se.stats[10])||0, blk:parseInt(se.stats[9])||0,
          three_pm:parse3PM(se.stats[3]), min:parseMin(se.stats[0]), opponent, home_away:homeAway };
      });
  } catch { return []; }
}

async function fetchTodaysGames() {
  try {
    const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const resp = await espnGet(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${today}`);
    return (resp.events||[]).map(ev => {
      const comp = ev.competitions?.[0];
      let home='', away='';
      for (const c of (comp?.competitors||[])) {
        if (c.homeAway==='home') home=c.team.abbreviation; else away=c.team.abbreviation;
      }
      let time='';
      try { time = new Date(ev.date).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); } catch {}
      return { id:ev.id, name:ev.shortName, home, away, time, status:ev.status?.type?.description||'' };
    });
  } catch { return []; }
}

module.exports = async function handler(req, res) {
  const { run } = req.query;

  // ── NBA fetch ──
  if (run === 'nba') {
    res.setHeader('Content-Type', 'text/plain');
    res.write('Starting NBA fetch...\n');

    let players = await readData('nba_players');
    if (!players.length) { players = DEFAULT_PLAYERS; await writeData('nba_players', players); }

    const existing = await readData('nba_gamelogs');
    const byPlayer = {};
    for (const l of existing) { const p=String(l.player_id); if(!byPlayer[p]) byPlayer[p]=[]; byPlayer[p].push(l); }

    const allLogs = [];
    for (const p of players) {
      res.write(`Fetching ${p.name}...\n`);
      const logs = await fetchPlayerLogs(String(p.id), p.name, p.team);
      allLogs.push(...(logs.length > 0 ? logs : (byPlayer[String(p.id)]||[])));
      await sleep(1000);
    }
    if (allLogs.length) await writeData('nba_gamelogs', allLogs);

    const todayGames = await fetchTodaysGames();
    if (todayGames.length) await writeData('nba_today_games', todayGames);

    const picks = [];
    for (const p of players) {
      for (const sk of ['pts','reb','ast']) {
        const line = DEFAULT_LINES[sk]?.[p.name];
        if (!line) continue;
        const game = todayGames.find(g => g.home===p.team||g.away===p.team);
        const opp  = game ? (game.home===p.team ? game.away : game.home) : 'OPP';
        const pick = runPropModel(p.name, String(p.id), p.team, sk, line, allLogs, opp);
        if (pick) picks.push(pick);
      }
    }
    const top = picks.sort((a,b)=>b.ev-a.ev).slice(0,15);
    if (top.length) await writeData('nba_picks', top);

    res.write(`\nDone! Logs: ${allLogs.length}, Games today: ${todayGames.length}, Picks: ${top.length}\n`);
    res.end();
    return;
  }

  // ── Options fetch ──
  if (run === 'options') {
    res.setHeader('Content-Type', 'text/plain');
    res.write('Starting options fetch...\n');

    const watchlist = await readData('watchlist');
    if (!watchlist.length) { res.write('Watchlist is empty — add tickers in the app first.\n'); res.end(); return; }

    const [pricesData, chainData] = await Promise.all([readData('stock_prices'), readData('options_chain')]);
    const headers = { 'User-Agent':'Mozilla/5.0','Accept':'application/json' };

    for (const item of watchlist) {
      const ticker = item.ticker;
      res.write(`Fetching ${ticker}...\n`);
      try {
        const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,{headers});
        const d = await r.json();
        const meta = d?.chart?.result?.[0]?.meta;
        if (meta) {
          const price = Math.round(Number(meta.regularMarketPrice)*100)/100;
          const prev  = Number(meta.previousClose)||0;
          pricesData[ticker] = { price, change_pct: prev>0?Math.round((price-prev)/prev*10000)/100:0, updated_at:new Date().toISOString().slice(0,19) };
        }
      } catch(e) { res.write(`  price error: ${e.message}\n`); }
      await sleep(600);
    }

    await Promise.all([writeData('stock_prices', pricesData), writeData('options_chain', chainData)]);
    res.write(`\nDone! Updated ${watchlist.length} tickers.\n`);
    res.end();
    return;
  }

  // ── Menu page ──
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html><html><head><title>Data Trigger</title>
  <style>body{font-family:sans-serif;padding:40px;background:#0d1117;color:#e6edf3}
  h1{color:#58a6ff}a{display:inline-block;margin:10px;padding:14px 28px;background:#238636;
  color:white;text-decoration:none;border-radius:8px;font-size:16px}
  a:hover{background:#2ea043}p{color:#8b949e}</style></head><body>
  <h1>⚡ Trading Platform — Data Triggers</h1>
  <p>Click a button to manually fetch fresh data. The page will stream progress.</p>
  <a href="/api/trigger?run=nba" target="_blank">🏀 Fetch NBA Data</a>
  <a href="/api/trigger?run=options" target="_blank">📈 Fetch Options Data</a>
  <p style="margin-top:30px;font-size:13px">Data also auto-refreshes daily via cron jobs.</p>
  </body></html>`);
};
