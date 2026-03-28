// nba.js — NBA Prop Analyzer Dashboard

const API = '';
let todayPicks = [];
let nbaPlayers = [];
let nbaBets = [];
let nbaPlayerLogs = [];
let selectedPlayerId = null;
let selectedPlayerName = '';
let nbaSortState = {};

// ── Utility ──────────────────────────────────────────────────────────────────

function fmt(n, dec = 2) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toFixed(dec);
}
function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  return (Number(n) * 100).toFixed(1) + '%';
}
function fmtEV(ev) {
  const v = Number(ev);
  const s = (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  return s;
}

async function apiFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(API + path, opts);
    return await r.json();
  } catch (e) {
    showToast('API error: ' + e.message, 'error');
    return null;
  }
}

function showToast(msg, type = 'info') {
  const ct = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  ct.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function timeSince(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  return Math.floor(diff / 3600) + 'h ago';
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
  if (name === 'picks')    loadTodayPicks();
  if (name === 'analyzer') initAnalyzer();
  if (name === 'matchup')  initMatchup();
  if (name === 'bets')     loadBets();
}

// ── Sparkline SVG ─────────────────────────────────────────────────────────────

function sparklineSVG(values, width = 80, height = 24, line = null) {
  if (!values || values.length < 2) return '<span style="color:var(--muted)">—</span>';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = width, h = height;
  const pad = 2;
  const xStep = (w - pad * 2) / (values.length - 1);
  const toX = i => pad + i * xStep;
  const toY = v => h - pad - ((v - min) / range) * (h - pad * 2);

  const pts = values.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
  const lastColor = values[values.length - 1] > (line || values[0]) ? '#3fb950' : '#f78166';

  let lineEl = '';
  if (line !== null) {
    const ly = toY(Math.max(min, Math.min(max, line)));
    lineEl = `<line x1="${pad}" y1="${ly}" x2="${w - pad}" y2="${ly}" stroke="#e3b341" stroke-width="1" stroke-dasharray="3,2"/>`;
  }

  return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${lineEl}
    <polyline points="${pts}" fill="none" stroke="${lastColor}" stroke-width="1.5"/>
    ${values.map((v, i) => `<circle cx="${toX(i)}" cy="${toY(v)}" r="2" fill="${v > (line !== null ? line : -Infinity) ? '#3fb950' : '#f78166'}"/>`).join('')}
  </svg>`;
}

// ── Daily Picks Tab ───────────────────────────────────────────────────────────

async function loadTodayPicks() {
  todayPicks = await apiFetch('/api/nba/picks/today') || [];
  renderPicks();
}

function renderPicks() {
  const el = document.getElementById('picks-container');
  const statFilter = document.getElementById('filter-stat') ? document.getElementById('filter-stat').value : '';
  const evFilter   = parseFloat(document.getElementById('filter-ev') ? document.getElementById('filter-ev').value : '0') || 0;
  const gradeFilter = document.getElementById('filter-grade') ? document.getElementById('filter-grade').value : '';

  let filtered = [...todayPicks];
  if (statFilter) filtered = filtered.filter(p => p.prop_type === statFilter);
  if (evFilter > 0) filtered = filtered.filter(p => Number(p.ev) >= evFilter / 100);
  if (gradeFilter) filtered = filtered.filter(p => p.confidence === gradeFilter);

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="icon">🏀</div>
      <div>No picks found for today's filters</div>
      <div style="font-size:12px;margin-top:4px">The NBA fetcher generates picks every 15 minutes</div>
    </div>`;
    return;
  }

  el.innerHTML = filtered.map(pick => {
    const ev = Number(pick.ev);
    const evClass = ev >= 0 ? 'pos' : 'neg';
    const ourPct  = (Number(pick.our_prob) * 100).toFixed(1);
    const impPct  = (Number(pick.implied_prob) * 100).toFixed(1);
    const last5   = Array.isArray(pick.last5) ? pick.last5 : [];
    const statLabel = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', stl: 'Steals', blk: 'Blocks', three_pm: '3-Pointers' }[pick.prop_type] || pick.prop_type;

    return `<div class="pick-card ${ev >= 0 ? 'ev-positive' : 'ev-negative'}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between">
        <div>
          <div class="player-name">${pick.player_name}</div>
          <div class="matchup">${pick.team || ''} ${pick.opponent ? '@ ' + pick.opponent : ''} · ${pick.home_away || ''}</div>
        </div>
        <div class="grade-badge grade-${pick.confidence}" title="Confidence grade based on edge size">${pick.confidence}</div>
      </div>

      <div style="display:flex;align-items:center;gap:8px">
        <span class="badge badge-blue">${statLabel}</span>
        <strong style="font-size:16px">${pick.line}</strong>
        <span style="color:var(--muted)">line</span>
        <span style="color:var(--muted);font-size:12px">Model: ${fmt(pick.predicted)}</span>
      </div>

      <div class="pick-probs">
        <div class="pick-prob-item">
          <span class="prob-val our">${ourPct}%</span>
          <span class="prob-label" title="Our model's estimated probability of going over">Our Prob</span>
        </div>
        <div class="pick-prob-item">
          <span class="prob-val" style="color:var(--muted)">${impPct}%</span>
          <span class="prob-label" title="Implied probability at -110 odds">Implied</span>
        </div>
        <div class="pick-prob-item">
          <span class="pick-ev ${evClass}">${fmtEV(ev)}</span>
          <span class="prob-label" title="Expected value per $1 wagered at -110">EV</span>
        </div>
      </div>

      <div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Last 5 games</div>
        <div style="display:flex;align-items:center;gap:8px">
          ${sparklineSVG(last5, 80, 28, pick.line)}
          <span style="font-size:12px;color:var(--muted)">${last5.join(', ')}</span>
        </div>
      </div>

      <div>
        <div class="prob-bar"><div class="prob-bar-fill" style="width:${ourPct}%"></div></div>
      </div>
    </div>`;
  }).join('');
}

// ── Analyzer Tab ──────────────────────────────────────────────────────────────

async function initAnalyzer() {
  if (nbaPlayers.length === 0) {
    nbaPlayers = await apiFetch('/api/nba/players') || [];
  }
}

async function searchPlayers() {
  const q = document.getElementById('player-search').value.trim();
  if (!q) return;
  const results = await apiFetch('/api/nba/players?search=' + encodeURIComponent(q)) || [];
  const el = document.getElementById('player-results');
  if (!results.length) {
    el.innerHTML = '<div style="padding:8px;color:var(--muted)">No players found</div>';
    return;
  }
  el.innerHTML = results.map(p => `
    <div class="sidebar-item" onclick="selectPlayer('${p.id}','${p.name.replace(/'/g,"\\'")}','${p.team}')">
      <div>
        <div class="ticker">${p.name}</div>
        <div style="font-size:12px;color:var(--muted)">${p.team} · ${p.position}</div>
      </div>
    </div>
  `).join('');
}

async function selectPlayer(id, name, team) {
  selectedPlayerId = id;
  selectedPlayerName = name;
  document.getElementById('player-results').innerHTML = '';
  document.getElementById('player-search').value = name;
  document.getElementById('selected-player-label').textContent = name + ' · ' + team;

  const logs = await apiFetch('/api/nba/player/' + id + '/stats') || [];
  nbaPlayerLogs = logs;
  renderPlayerLogs(logs);
}

function renderPlayerLogs(logs) {
  const el = document.getElementById('player-log-table');
  if (!logs.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📋</div><div>No game logs found</div></div>';
    return;
  }

  const cols = ['date','opponent','home_away','min','pts','reb','ast','stl','blk','three_pm'];
  const labels = { date:'Date', opponent:'Opp', home_away:'H/A', min:'MIN', pts:'PTS', reb:'REB', ast:'AST', stl:'STL', blk:'BLK', three_pm:'3PM' };
  const state = nbaSortState['player_logs'] || { key: 'date', dir: -1 };

  const sorted = [...logs].sort((a, b) => {
    let av = a[state.key], bv = b[state.key];
    if (av > bv) return state.dir;
    if (av < bv) return -state.dir;
    return 0;
  });

  el.innerHTML = `<div class="table-wrap" style="max-height:300px">
    <table>
      <thead><tr>${cols.map(c => `
        <th onclick="sortPlayerLogs('${c}',this)"
            class="${state.key === c ? (state.dir === 1 ? 'sort-asc' : 'sort-desc') : ''}">${labels[c]}</th>
      `).join('')}</tr></thead>
      <tbody>${sorted.map(l => `
        <tr>
          <td>${l.date}</td>
          <td>${l.opponent || '—'}</td>
          <td><span class="badge ${l.home_away === 'home' ? 'badge-blue' : 'badge-muted'}">${l.home_away === 'home' ? 'H' : 'A'}</span></td>
          <td>${l.min}</td>
          <td><strong>${l.pts}</strong></td>
          <td>${l.reb}</td>
          <td>${l.ast}</td>
          <td>${l.stl}</td>
          <td>${l.blk}</td>
          <td>${l.three_pm}</td>
        </tr>
      `).join('')}</tbody>
    </table>
  </div>`;
}

function sortPlayerLogs(key, th) {
  const state = nbaSortState['player_logs'] || { key: 'date', dir: -1 };
  if (state.key === key) { state.dir *= -1; } else { state.key = key; state.dir = 1; }
  nbaSortState['player_logs'] = state;
  renderPlayerLogs(nbaPlayerLogs);
}

async function runAnalysis() {
  if (!selectedPlayerId) { showToast('Select a player first', 'error'); return; }
  const stat      = document.getElementById('prop-stat').value;
  const line      = parseFloat(document.getElementById('prop-line').value);
  const homeAway  = document.getElementById('prop-home-away').value;
  if (isNaN(line)) { showToast('Enter a valid prop line', 'error'); return; }

  const el = document.getElementById('analysis-result');
  el.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';

  const result = await apiFetch(`/api/nba/player/${selectedPlayerId}/props?line=${line}&stat=${stat}&home_away=${homeAway}`);
  if (!result || result.error) {
    el.innerHTML = '<div class="empty-state"><div>Not enough data for this player</div></div>';
    return;
  }

  const statLabel = { pts:'Points', reb:'Rebounds', ast:'Assists', stl:'Steals', blk:'Blocks', three_pm:'3-Pointers' }[stat] || stat;
  const ev = Number(result.ev);
  const ourPct = (Number(result.our_prob) * 100).toFixed(1);
  const hitOverLast5 = result.last5 ? result.last5.filter(v => v > line).length : 0;
  const hitOverLast10 = result.last10 ? result.last10.filter(v => v > line).length : 0;

  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">Model Result — ${selectedPlayerName} ${statLabel} ${line}</span>
        <span class="grade-badge grade-${result.confidence}">${result.confidence}</span>
      </div>

      <div class="stat-chips-row" style="margin-bottom:12px">
        <div class="stat-chip" title="Model's weighted prediction">
          <span class="value" style="color:var(--blue)">${fmt(result.predicted)}</span>
          <span class="label">Predicted</span>
        </div>
        <div class="stat-chip" title="Our probability of going over the line">
          <span class="value" style="color:${Number(result.our_prob) > 0.524 ? 'var(--green)' : 'var(--red)'}">${ourPct}%</span>
          <span class="label">Our Prob Over</span>
        </div>
        <div class="stat-chip" title="Expected value at -110 odds">
          <span class="value" style="color:${ev >= 0 ? 'var(--green)' : 'var(--red)'}">
            ${ev >= 0 ? '+' : ''}${(ev*100).toFixed(1)}%
          </span>
          <span class="label">EV @ -110</span>
        </div>
        <div class="stat-chip" title="Half Kelly stake as % of bankroll">
          <span class="value" style="color:var(--yellow)">${(Number(result.kelly_half)*100).toFixed(1)}%</span>
          <span class="label">½ Kelly</span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Hit Rate Over ${line}</div>
          <div style="display:flex;gap:12px">
            <div class="stat-chip" title="Games over line in last 5">
              <span class="value" style="font-size:16px">${hitOverLast5}/5</span>
              <span class="label">Last 5</span>
            </div>
            <div class="stat-chip" title="Games over line in last 10">
              <span class="value" style="font-size:16px">${hitOverLast10}/10</span>
              <span class="label">Last 10</span>
            </div>
          </div>
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Averages</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span class="badge badge-blue" title="Last 5 game average">L5: ${fmt(result.last5avg)}</span>
            <span class="badge badge-blue" title="Last 10 game average">L10: ${fmt(result.last10avg)}</span>
            <span class="badge badge-muted" title="Season average">Season: ${fmt(result.seasonavg)}</span>
            <span class="badge badge-muted" title="${homeAway} game average">${homeAway === 'home' ? 'Home' : 'Away'}: ${fmt(result.homeawayavg)}</span>
          </div>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Last 10 Games Sparkline</div>
        <div style="display:flex;align-items:center;gap:12px">
          ${sparklineSVG(result.last10 || result.last5 || [], 200, 40, line)}
          <div style="font-size:12px;color:var(--muted)">
            StdDev: ${fmt(result.std_dev)} · Z: ${fmt(result.z_score, 3)}
          </div>
        </div>
      </div>

      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:12px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Kelly Criterion (Half Kelly Recommended)</div>
        <div style="font-size:13px">
          Full Kelly: <strong>${(Number(result.kelly)*100).toFixed(1)}%</strong> of bankroll ·
          Half Kelly: <strong style="color:var(--yellow)">${(Number(result.kelly_half)*100).toFixed(1)}%</strong> of bankroll
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">
          On a $1,000 bankroll, Half Kelly suggests betting $${(Number(result.kelly_half)*1000).toFixed(0)}
        </div>
      </div>
    </div>
  `;
}

// ── Matchup Tab ───────────────────────────────────────────────────────────────

async function initMatchup() {
  const el = document.getElementById('matchup-content');
  el.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading today's matchups...</div></div>`;

  const matchups = await apiFetch('/api/nba/matchups') || [];

  if (!Array.isArray(matchups) || matchups.length === 0) {
    el.innerHTML = `
      <div class="pane-main" style="flex-direction:column;gap:12px">
        <div class="card">
          <div class="card-header"><span class="card-title">Today's Matchups</span></div>
          <div class="empty-state"><div class="icon">🏀</div><div>No games today or fetcher hasn't run yet.<br>Run <code>fetch_nba.ps1</code> to populate data.</div></div>
        </div>
      </div>`;
    return;
  }

  el.innerHTML = `<div class="pane-main" style="flex-direction:column;gap:14px">${matchups.map(renderMatchupCard).join('')}</div>`;
}

function renderMatchupCard(m) {
  const defRow = (label, homeVal, awayVal) => {
    if (homeVal == null && awayVal == null) return '';
    const hv = homeVal != null ? homeVal : '—';
    const av = awayVal != null ? awayVal : '—';
    // Lower = better defense (allows fewer pts)
    const hBetter = homeVal != null && awayVal != null && homeVal < awayVal;
    return `
      <tr>
        <td style="color:var(--muted);font-size:12px">${label} allowed/game</td>
        <td style="text-align:center;font-weight:700;color:${hBetter ? 'var(--green)' : 'var(--text)'}">${hv}</td>
        <td style="text-align:center;font-weight:700;color:${!hBetter && homeVal != null && awayVal != null ? 'var(--green)' : 'var(--text)'}">${av}</td>
      </tr>`;
  };

  const playerFlags = (m.players || []).filter(p => p.grade === 'A' || p.grade === 'B');
  const flagsHtml = playerFlags.length > 0
    ? playerFlags.map(p => `
        <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-subtle)">
          <span class="grade-badge grade-${p.grade}">${p.grade}</span>
          <span style="font-size:13px;font-weight:600">${p.player}</span>
          <span style="font-size:12px;color:var(--muted)">${p.team} vs ${p.opp} · avg ${p.avg_pts} pts</span>
        </div>`).join('')
    : `<div style="font-size:12px;color:var(--muted);padding:6px 0">No tracked players in this game with favorable matchup history</div>`;

  return `
    <div class="card">
      <div class="card-header">
        <span class="card-title">${m.away} @ ${m.home}</span>
        <span class="badge badge-muted">${m.time || ''}</span>
        ${m.status && m.status !== 'Scheduled' ? `<span class="badge badge-blue">${m.status}</span>` : ''}
      </div>

      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;margin-bottom:6px">
          Defensive Stats — Pts/Reb/Ast Allowed Per Player Game (lower = better defense)
        </div>
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <thead><tr>
            <th style="text-align:left;color:var(--muted);font-weight:500;padding-bottom:4px"></th>
            <th style="text-align:center;color:var(--text);font-weight:700;padding-bottom:4px">${m.home} (Home)</th>
            <th style="text-align:center;color:var(--text);font-weight:700;padding-bottom:4px">${m.away} (Away)</th>
          </tr></thead>
          <tbody>
            ${defRow('PTS', m.home_def_pts, m.away_def_pts)}
            ${defRow('REB', m.home_def_reb, m.away_def_reb)}
            ${defRow('AST', m.home_def_ast, m.away_def_ast)}
          </tbody>
        </table>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">
          Based on stats allowed to tracked players in your game logs
        </div>
      </div>

      <div>
        <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;margin-bottom:6px">
          Favorable Matchups (tracked players with better-than-average history vs opponent)
        </div>
        ${flagsHtml}
      </div>
    </div>`;
}

function renderDefensiveRatings() {
  // Kept for legacy — no longer used (replaced by real data)
  return '';

  return `<div class="card">
    <div class="card-header">
      <span class="card-title">Defensive Ratings by Team</span>
      <span style="font-size:11px;color:var(--muted)">1=Best Defense, 30=Worst Defense (Favorable for Over)</span>
    </div>
    <div class="table-wrap" style="max-height:280px">
      <table>
        <thead><tr>
          <th>Team</th>
          <th title="Defensive rank allowing points (30=worst = favorable for pts over)">PTS Rank</th>
          <th title="Defensive rank allowing rebounds">REB Rank</th>
          <th title="Defensive rank allowing assists">AST Rank</th>
          <th>Matchup Grade</th>
        </tr></thead>
        <tbody>${teams.map(t => {
          const avg = Math.round((t.pts_rank + t.reb_rank + t.ast_rank) / 3);
          const grade = avg >= 20 ? 'A (Favorable)' : avg >= 15 ? 'B' : avg >= 10 ? 'C' : 'D (Tough)';
          const gradeClass = avg >= 20 ? 'badge-green' : avg >= 15 ? 'badge-yellow' : avg >= 10 ? 'badge-muted' : 'badge-red';
          return `<tr>
            <td><strong>${t.team}</strong></td>
            <td style="color:${rankColor(t.pts_rank)}">${t.pts_rank}</td>
            <td style="color:${rankColor(t.reb_rank)}">${t.reb_rank}</td>
            <td style="color:${rankColor(t.ast_rank)}">${t.ast_rank}</td>
            <td><span class="badge ${gradeClass}">${grade}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

// ── Bet Tracker Tab ───────────────────────────────────────────────────────────

async function loadBets() {
  nbaBets = await apiFetch('/api/nba/bets') || [];
  renderBets();
  renderBetSummary();
  renderBankrollChart();
}

function renderBetSummary() {
  const settled = nbaBets.filter(b => b.result !== 'pending');
  const wins = nbaBets.filter(b => b.result === 'win').length;
  const losses = nbaBets.filter(b => b.result === 'loss').length;
  const pushes = nbaBets.filter(b => b.result === 'push').length;
  const totalPnl = nbaBets.reduce((s, b) => s + (Number(b.pnl) || 0), 0);
  const totalStaked = nbaBets.filter(b => b.result !== 'pending').reduce((s, b) => s + (Number(b.stake) || 0), 0);
  const roi = totalStaked > 0 ? ((totalPnl / totalStaked) * 100).toFixed(1) : '—';
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) + '%' : '—';

  // Streak
  let streak = 0, streakType = '';
  for (let i = nbaBets.length - 1; i >= 0; i--) {
    const r = nbaBets[i].result;
    if (r === 'pending') continue;
    if (!streakType) streakType = r;
    if (r === streakType) streak++;
    else break;
  }
  const streakStr = streak > 0 ? `${streak}${streakType === 'win' ? 'W' : streakType === 'loss' ? 'L' : 'P'}` : '—';

  document.getElementById('bet-summary').innerHTML = `
    <div class="stat-chip" title="Total profit/loss across all settled bets">
      <span class="value" style="color:${totalPnl>=0?'var(--green)':'var(--red)'}">
        ${totalPnl>=0?'+':''}$${Math.abs(totalPnl).toFixed(2)}
      </span>
      <span class="label">Total P&amp;L</span>
    </div>
    <div class="stat-chip" title="Return on investment">
      <span class="value" style="color:${parseFloat(roi)>=0?'var(--green)':'var(--red)'}">
        ${roi !== '—' ? (parseFloat(roi)>=0?'+':'') + roi + '%' : '—'}
      </span>
      <span class="label">ROI</span>
    </div>
    <div class="stat-chip" title="Win rate excluding pushes">
      <span class="value">${winRate}</span>
      <span class="label">Win Rate</span>
    </div>
    <div class="stat-chip" title="W-L-P record">
      <span class="value" style="font-size:14px">${wins}-${losses}-${pushes}</span>
      <span class="label">W-L-P</span>
    </div>
    <div class="stat-chip" title="Current streak">
      <span class="value" style="color:${streakType==='win'?'var(--green)':streakType==='loss'?'var(--red)':'var(--muted)'}">
        ${streakStr}
      </span>
      <span class="label">Streak</span>
    </div>
  `;
}

function renderBets() {
  const state = nbaSortState['bets'] || { key: 'date', dir: -1 };
  const sorted = [...nbaBets].sort((a, b) => {
    let av = a[state.key], bv = b[state.key];
    if (av > bv) return state.dir;
    if (av < bv) return -state.dir;
    return 0;
  });

  const el = document.getElementById('bets-table-wrap');
  if (!sorted.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">💰</div><div>No bets yet — add one below</div></div>';
    return;
  }

  el.innerHTML = `<div class="table-wrap" style="max-height:320px">
    <table>
      <thead><tr>
        <th onclick="sortBetsTable('date',this)" class="${state.key==='date'?(state.dir===1?'sort-asc':'sort-desc'):''}">Date</th>
        <th onclick="sortBetsTable('player_name',this)">Player</th>
        <th onclick="sortBetsTable('prop_type',this)">Prop</th>
        <th onclick="sortBetsTable('line',this)">Line</th>
        <th onclick="sortBetsTable('odds',this)">Odds</th>
        <th onclick="sortBetsTable('stake',this)">Stake</th>
        <th>Book</th>
        <th onclick="sortBetsTable('result',this)">Result</th>
        <th onclick="sortBetsTable('pnl',this)" class="${state.key==='pnl'?(state.dir===1?'sort-asc':'sort-desc'):''}">P&amp;L</th>
        <th>Action</th>
      </tr></thead>
      <tbody>${sorted.map(b => {
        const pnl = Number(b.pnl);
        const resultClass = { win: 'badge-green', loss: 'badge-red', push: 'badge-yellow', pending: 'badge-blue' }[b.result] || 'badge-muted';
        const rowCls = b.result === 'win' ? 'row-green' : b.result === 'loss' ? 'row-red' : '';
        return `<tr class="${rowCls}">
          <td style="color:var(--muted);font-size:12px">${b.date}</td>
          <td><strong>${b.player_name}</strong></td>
          <td><span class="badge badge-blue">${b.prop_type}</span></td>
          <td>${b.line}</td>
          <td>${b.odds > 0 ? '+' : ''}${b.odds}</td>
          <td>$${fmt(b.stake)}</td>
          <td style="color:var(--muted)">${b.sportsbook}</td>
          <td><span class="badge ${resultClass}">${b.result}</span></td>
          <td style="color:${pnl>0?'var(--green)':pnl<0?'var(--red)':'var(--muted)'}">
            ${pnl !== 0 ? (pnl>0?'+':'') + '$' + Math.abs(pnl).toFixed(2) : '—'}
          </td>
          <td>
            ${b.result === 'pending' ? `
              <select id="res-${b.id}" style="font-size:11px;padding:2px 6px">
                <option value="win">Win</option>
                <option value="loss">Loss</option>
                <option value="push">Push</option>
              </select>
              <button class="btn btn-ghost btn-sm" onclick="markResult('${b.id}')" style="margin-left:4px">✓</button>
            ` : ''}
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

function sortBetsTable(key, th) {
  const state = nbaSortState['bets'] || { key: 'date', dir: -1 };
  if (state.key === key) { state.dir *= -1; } else { state.key = key; state.dir = 1; }
  nbaSortState['bets'] = state;
  renderBets();
}

async function markResult(betId) {
  const sel = document.getElementById('res-' + betId);
  if (!sel) return;
  const result = sel.value;
  const r = await apiFetch('/api/nba/bets/' + betId + '/result', 'PUT', { result });
  if (r && r.ok) {
    showToast('Bet marked as ' + result, 'success');
    loadBets();
  }
}

async function addBet() {
  const get = id => document.getElementById(id) ? document.getElementById(id).value.trim() : '';
  const body = {
    player_name: get('new-player'),
    prop_type:   get('new-prop-type'),
    line:        parseFloat(get('new-line')),
    odds:        parseInt(get('new-odds')),
    stake:       parseFloat(get('new-stake')),
    sportsbook:  get('new-sportsbook'),
    date:        get('new-date') || new Date().toISOString().split('T')[0],
  };
  if (!body.player_name || isNaN(body.line) || isNaN(body.stake)) {
    showToast('Fill in required fields', 'error'); return;
  }
  const result = await apiFetch('/api/nba/bets/add', 'POST', body);
  if (result && result.id) {
    showToast('Bet added', 'success');
    ['new-player','new-line','new-stake','new-sportsbook'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('new-odds').value = '-110';
    loadBets();
  }
}

// ── Bankroll Chart ────────────────────────────────────────────────────────────

function renderBankrollChart() {
  const canvas = document.getElementById('bankroll-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth || 600;
  canvas.height = 120;

  const settled = nbaBets.filter(b => b.result !== 'pending').sort((a, b) => a.date > b.date ? 1 : -1);
  if (settled.length < 2) {
    ctx.fillStyle = '#8b949e';
    ctx.font = '13px Segoe UI';
    ctx.fillText('Settle more bets to see the bankroll chart', 20, 60);
    return;
  }

  let running = 0;
  const points = settled.map(b => { running += Number(b.pnl) || 0; return running; });

  const w = canvas.width, h = canvas.height;
  const pad = { t: 10, r: 10, b: 20, l: 55 };
  const chartW = w - pad.l - pad.r;
  const chartH = h - pad.t - pad.b;

  const minV = Math.min(0, ...points);
  const maxV = Math.max(0, ...points);
  const range = maxV - minV || 1;

  ctx.clearRect(0, 0, w, h);

  // Grid + labels
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  [0, 0.5, 1].forEach(f => {
    const y = pad.t + chartH * (1 - f);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    const val = minV + range * f;
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px Segoe UI';
    ctx.textAlign = 'right';
    ctx.fillText((val >= 0 ? '+' : '') + '$' + Math.abs(val).toFixed(0), pad.l - 4, y + 3);
  });

  const xStep = chartW / Math.max(points.length - 1, 1);
  const toX = i => pad.l + i * xStep;
  const toY = v => pad.t + chartH * (1 - (v - minV) / range);

  const lastColor = points[points.length - 1] >= 0 ? '#3fb950' : '#f78166';
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + chartH);
  grad.addColorStop(0, lastColor + '55');
  grad.addColorStop(1, lastColor + '00');

  ctx.beginPath();
  ctx.moveTo(toX(0), toY(points[0]));
  points.forEach((v, i) => { if (i > 0) ctx.lineTo(toX(i), toY(v)); });
  ctx.lineTo(toX(points.length - 1), h - pad.b);
  ctx.lineTo(pad.l, h - pad.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = lastColor;
  ctx.lineWidth = 2;
  points.forEach((v, i) => { i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)); });
  ctx.stroke();

  points.forEach((v, i) => {
    ctx.beginPath();
    ctx.arc(toX(i), toY(v), 3, 0, Math.PI * 2);
    ctx.fillStyle = v >= 0 ? '#3fb950' : '#f78166';
    ctx.fill();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadTodayPicks();

  document.getElementById('player-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') searchPlayers();
  });

  document.getElementById('new-date').value = new Date().toISOString().split('T')[0];

  window.addEventListener('resize', () => {
    if (document.getElementById('tab-bets').classList.contains('active')) {
      renderBankrollChart();
    }
  });
});
