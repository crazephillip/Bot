// app.js — Options Trading Dashboard

const API = '';
let watchlist = [];
let currentTicker = null;
let currentChain = [];
let chainFilter = 'CALL';
let trades = [];
let sortState = {};

// ── Utility ──────────────────────────────────────────────────────────────────

function fmt(n, dec = 2) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toFixed(dec);
}
function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  return (Number(n) * 100).toFixed(1) + '%';
}
function fmtDollar(n) {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  return (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(2);
}
function fmtPnl(n) {
  const v = Number(n);
  const s = (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(2);
  return `<span class="${v >= 0 ? 'badge badge-green' : 'badge badge-red'}">${s}</span>`;
}
function timeSince(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
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

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
  if (name === 'trades') loadTrades();
  if (name === 'greeks') loadGreeks();
  if (name === 'screener') loadScreener();
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

async function loadWatchlist() {
  watchlist = await apiFetch('/api/watchlist') || [];
  renderWatchlist();
  // load prices for all tickers
  for (const item of watchlist) {
    fetchPrice(item.ticker);
  }
}

function renderWatchlist() {
  const container = document.getElementById('watchlist-items');
  if (!watchlist.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">📋</div><div>Add tickers to watchlist</div></div>';
    return;
  }
  container.innerHTML = watchlist.map(item => `
    <div class="sidebar-item ${currentTicker === item.ticker ? 'active' : ''}"
         id="wl-${item.ticker}"
         onclick="selectTicker('${item.ticker}')">
      <div style="flex:1">
        <div class="ticker">${item.ticker}</div>
        <div id="price-${item.ticker}" class="price" style="color:var(--muted);font-size:12px">Loading...</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();removeTicker('${item.ticker}')"
              title="Remove from watchlist" style="padding:2px 6px;font-size:11px">✕</button>
    </div>
  `).join('');
}

async function fetchPrice(ticker) {
  const data = await apiFetch('/api/price/' + ticker);
  if (!data || data.error) return;
  const el = document.getElementById('price-' + ticker);
  if (!el) return;
  const sign = data.change_pct >= 0 ? '+' : '';
  const cls = data.change_pct >= 0 ? 'pos' : 'neg';
  el.innerHTML = `<span>$${fmt(data.price)}</span> <span class="change ${cls}">${sign}${fmt(data.change_pct)}%</span>`;
}

async function addTicker() {
  const input = document.getElementById('add-ticker');
  const ticker = input.value.trim().toUpperCase();
  if (!ticker) return;
  const result = await apiFetch('/api/watchlist/add', 'POST', { ticker });
  if (result && result.ok) {
    input.value = '';
    showToast('Added ' + ticker, 'success');
    await loadWatchlist();
  }
}

async function removeTicker(ticker) {
  await apiFetch('/api/watchlist/' + ticker, 'DELETE');
  if (currentTicker === ticker) {
    currentTicker = null;
    document.getElementById('chain-area').innerHTML = '<div class="empty-state"><div class="icon">📊</div><div>Select a ticker to view the options chain</div></div>';
    document.getElementById('chain-title').textContent = 'Options Chain';
  }
  await loadWatchlist();
  showToast('Removed ' + ticker, 'info');
}

async function selectTicker(ticker) {
  currentTicker = ticker;
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('wl-' + ticker);
  if (el) el.classList.add('active');
  document.getElementById('chain-title').textContent = ticker + ' Options Chain';
  await loadChain(ticker);
}

// ── Options Chain ─────────────────────────────────────────────────────────────

async function loadChain(ticker) {
  const area = document.getElementById('chain-area');
  area.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';

  const [chain, priceData] = await Promise.all([
    apiFetch('/api/options/' + ticker),
    apiFetch('/api/price/' + ticker)
  ]);

  currentChain = chain || [];
  const currentPrice = priceData && !priceData.error ? priceData.price : 0;

  let lastFetch = '';
  if (currentChain.length > 0 && currentChain[0].fetched_at) {
    lastFetch = timeSince(currentChain[0].fetched_at);
  }

  area.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="toggleChain('CALL')">Calls</button>
      <button class="btn btn-ghost btn-sm" onclick="toggleChain('PUT')">Puts</button>
      <button class="btn btn-ghost btn-sm" onclick="toggleChain('ALL')">All</button>
      <select id="expiry-filter" onchange="renderChain(${currentPrice})" style="font-size:12px;padding:4px 8px">
        <option value="">All Expirations</option>
      </select>
      ${lastFetch ? `<span class="badge badge-muted">Updated ${lastFetch}</span>` : ''}
    </div>
    <div class="table-wrap" id="chain-table-wrap">
      <div class="empty-state"><div class="spinner"></div></div>
    </div>
  `;

  // Populate expiry filter
  const expiries = [...new Set(currentChain.map(o => o.expiry))].sort();
  const sel = document.getElementById('expiry-filter');
  expiries.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e;
    opt.textContent = e;
    sel.appendChild(opt);
  });

  renderChain(currentPrice);
}

function toggleChain(type) {
  chainFilter = type;
  const priceData = watchlist.find(w => w.ticker === currentTicker);
  renderChain(0);
}

function renderChain(currentPrice) {
  const expiry = document.getElementById('expiry-filter') ? document.getElementById('expiry-filter').value : '';
  let data = currentChain;
  if (chainFilter !== 'ALL') {
    data = data.filter(o => o.call_put === chainFilter);
  }
  if (expiry) {
    data = data.filter(o => o.expiry === expiry);
  }

  const wrap = document.getElementById('chain-table-wrap');
  if (!data.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="icon">📉</div><div>No options data — fetcher will populate in ~60s</div></div>';
    return;
  }

  const cols = [
    { key: 'strike',        label: 'Strike',   title: 'Option strike price' },
    { key: 'expiry',        label: 'Expiry',   title: 'Expiration date' },
    { key: 'call_put',      label: 'Type',     title: 'Call or Put' },
    { key: 'bid',           label: 'Bid',      title: 'Current bid price' },
    { key: 'ask',           label: 'Ask',      title: 'Current ask price' },
    { key: '_mid',          label: 'Mid',      title: 'Midpoint of bid/ask spread' },
    { key: 'iv',            label: 'IV',       title: 'Implied Volatility — market\'s forecast of price movement' },
    { key: 'delta',         label: 'Δ Delta',  title: 'Delta: rate of change in option price per $1 move in underlying. 0.5 = ATM' },
    { key: 'theta',         label: 'Θ Theta',  title: 'Theta: daily time decay in dollars. Negative = lose value each day' },
    { key: 'volume',        label: 'Volume',   title: 'Contracts traded today' },
    { key: 'open_interest', label: 'OI',       title: 'Open interest — total outstanding contracts' },
  ];

  const state = sortState['chain'] || { key: 'strike', dir: 1 };
  const sorted = [...data].sort((a, b) => {
    const aVal = a[state.key] === undefined ? a['_mid'] : a[state.key];
    const bVal = b[state.key] === undefined ? b['_mid'] : b[state.key];
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;
    return (aVal > bVal ? 1 : -1) * state.dir;
  });

  wrap.innerHTML = `<table>
    <thead><tr>${cols.map(c => `
      <th title="${c.title}" onclick="sortTable('chain','${c.key}',this)"
          class="${state.key === c.key ? (state.dir === 1 ? 'sort-asc' : 'sort-desc') : ''}">${c.label}</th>
    `).join('')}</tr></thead>
    <tbody>${sorted.map(o => {
      const mid = ((Number(o.bid) + Number(o.ask)) / 2).toFixed(2);
      const isItm = currentPrice > 0 && (
        (o.call_put === 'CALL' && Number(o.strike) < currentPrice) ||
        (o.call_put === 'PUT' && Number(o.strike) > currentPrice)
      );
      const thetaVal = o.theta !== null && o.theta !== undefined ? Number(o.theta) : null;
      return `<tr class="${isItm ? 'row-itm' : ''}">
        <td><strong>$${fmt(o.strike)}</strong></td>
        <td>${o.expiry || '—'}</td>
        <td><span class="badge ${o.call_put === 'CALL' ? 'badge-green' : 'badge-red'}">${o.call_put}</span></td>
        <td>$${fmt(o.bid)}</td>
        <td>$${fmt(o.ask)}</td>
        <td>$${mid}</td>
        <td title="IV: ${(Number(o.iv)*100).toFixed(1)}%">${fmtPct(o.iv)}</td>
        <td title="Delta measures directional exposure">${o.delta !== null && o.delta !== undefined ? fmt(o.delta, 3) : '—'}</td>
        <td title="Daily theta decay" style="${thetaVal !== null && thetaVal < -0.1 ? 'color:var(--red)' : ''}">${thetaVal !== null ? fmt(thetaVal, 3) : '—'}</td>
        <td title="Contracts traded today">${o.volume !== null ? Number(o.volume).toLocaleString() : '—'}</td>
        <td title="Total open contracts">${o.open_interest !== null ? Number(o.open_interest).toLocaleString() : '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function sortTable(tableId, key, th) {
  const state = sortState[tableId] || { key: '', dir: 1 };
  if (state.key === key) {
    state.dir = state.dir === 1 ? -1 : 1;
  } else {
    state.key = key;
    state.dir = 1;
  }
  sortState[tableId] = state;

  // re-render
  document.querySelectorAll(`#chain-table-wrap thead th`).forEach(t => {
    t.classList.remove('sort-asc', 'sort-desc');
  });
  const priceData = apiFetch('/api/price/' + (currentTicker || 'AAPL'));
  renderChain(0);
}

// ── Trades ────────────────────────────────────────────────────────────────────

async function loadTrades() {
  trades = await apiFetch('/api/trades') || [];
  renderTrades();
  renderTradesSummary();
  renderPnlChart();
}

function renderTradesSummary() {
  const open   = trades.filter(t => t.status === 'open');
  const closed = trades.filter(t => t.status === 'closed');
  const totalPnl = trades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const wins   = closed.filter(t => Number(t.pnl) > 0).length;
  const losses = closed.filter(t => Number(t.pnl) <= 0).length;
  const winRate = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(0) : '—';

  const best  = trades.reduce((b, t) => (!b || Number(t.pnl) > Number(b.pnl) ? t : b), null);
  const worst = trades.reduce((w, t) => (!w || Number(t.pnl) < Number(w.pnl) ? t : w), null);

  document.getElementById('trades-summary').innerHTML = `
    <div class="stat-chip">
      <span class="value" style="color:${totalPnl>=0?'var(--green)':'var(--red)'}">
        ${totalPnl>=0?'+':''}$${Math.abs(totalPnl).toFixed(2)}
      </span>
      <span class="label">Total P&amp;L</span>
    </div>
    <div class="stat-chip">
      <span class="value">${open.length}</span>
      <span class="label">Open</span>
    </div>
    <div class="stat-chip">
      <span class="value">${winRate}${winRate !== '—' ? '%' : ''}</span>
      <span class="label">Win Rate</span>
    </div>
    <div class="stat-chip">
      <span class="value" style="color:var(--green)" title="${best ? best.ticker + ' ' + best.call_put : ''}">
        ${best ? '+$' + Math.abs(Number(best.pnl)).toFixed(0) : '—'}
      </span>
      <span class="label">Best Trade</span>
    </div>
    <div class="stat-chip">
      <span class="value" style="color:var(--red)" title="${worst ? worst.ticker + ' ' + worst.call_put : ''}">
        ${worst ? '-$' + Math.abs(Number(worst.pnl)).toFixed(0) : '—'}
      </span>
      <span class="label">Worst Trade</span>
    </div>
  `;
}

function renderTrades() {
  const state = sortState['trades'] || { key: 'opened_at', dir: -1 };
  const sorted = [...trades].sort((a, b) => {
    let av = a[state.key], bv = b[state.key];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return (av > bv ? 1 : -1) * state.dir;
  });

  const cols = [
    { key: 'ticker',       label: 'Ticker' },
    { key: 'call_put',     label: 'Type' },
    { key: 'strike',       label: 'Strike' },
    { key: 'expiry',       label: 'Expiry' },
    { key: 'contracts',    label: 'Qty' },
    { key: 'entry_price',  label: 'Entry' },
    { key: 'current_price',label: 'Current' },
    { key: 'pnl',          label: 'P&L' },
    { key: 'status',       label: 'Status' },
    { key: 'opened_at',    label: 'Opened' },
    { key: '_action',      label: 'Action' },
  ];

  const el = document.getElementById('trades-table-wrap');
  el.innerHTML = `<table>
    <thead><tr>${cols.map(c => `
      <th onclick="${c.key !== '_action' ? `sortTradesTable('${c.key}',this)` : ''}"
          class="${state.key === c.key ? (state.dir === 1 ? 'sort-asc' : 'sort-desc') : ''}">${c.label}</th>
    `).join('')}</tr></thead>
    <tbody>${sorted.length === 0 ? `<tr><td colspan="${cols.length}"><div class="empty-state"><div class="icon">📋</div><div>No trades yet — add one below</div></div></td></tr>` :
      sorted.map(t => {
        const pnl = Number(t.pnl) || 0;
        const rowCls = pnl > 0 ? 'row-green' : pnl < 0 ? 'row-red' : '';
        return `<tr class="${rowCls}">
          <td><strong>${t.ticker}</strong></td>
          <td><span class="badge ${t.call_put === 'CALL' ? 'badge-green' : 'badge-red'}">${t.call_put}</span></td>
          <td>$${fmt(t.strike)}</td>
          <td>${t.expiry || '—'}</td>
          <td>${t.contracts}</td>
          <td>$${fmt(t.entry_price)}</td>
          <td>$${fmt(t.current_price)}</td>
          <td>${fmtPnl(t.pnl)}</td>
          <td><span class="badge ${t.status === 'open' ? 'badge-blue' : 'badge-muted'}">${t.status}</span></td>
          <td style="color:var(--muted);font-size:12px">${timeSince(t.opened_at)}</td>
          <td>${t.status === 'open' ? `<button class="btn btn-warning btn-sm" onclick="openCloseModal('${t.id}','${t.ticker}')">Close</button>` : ''}</td>
        </tr>`;
      }).join('')
    }</tbody>
  </table>`;
}

function sortTradesTable(key, th) {
  const state = sortState['trades'] || { key: 'opened_at', dir: -1 };
  if (state.key === key) { state.dir *= -1; } else { state.key = key; state.dir = 1; }
  sortState['trades'] = state;
  renderTrades();
}

// ── Trade Modal (Close) ───────────────────────────────────────────────────────

let closeTradeId = null;
function openCloseModal(id, ticker) {
  closeTradeId = id;
  document.getElementById('close-ticker-label').textContent = ticker;
  document.getElementById('close-modal').classList.add('open');
}
function closeModal() {
  document.getElementById('close-modal').classList.remove('open');
  closeTradeId = null;
}
async function submitCloseTrade() {
  const price = parseFloat(document.getElementById('close-price-input').value);
  if (isNaN(price) || price <= 0) { showToast('Enter a valid close price', 'error'); return; }
  const result = await apiFetch('/api/trades/' + closeTradeId + '/close', 'PUT', { close_price: price });
  if (result && result.ok) {
    showToast('Trade closed', 'success');
    closeModal();
    loadTrades();
  }
}

// ── Add Trade Form ────────────────────────────────────────────────────────────

async function addTrade() {
  const get = id => document.getElementById(id).value.trim();
  const body = {
    ticker:       get('new-ticker').toUpperCase(),
    strike:       parseFloat(get('new-strike')),
    expiry:       get('new-expiry'),
    call_put:     get('new-callput'),
    contracts:    parseInt(get('new-contracts')),
    entry_price:  parseFloat(get('new-entry')),
    notes:        get('new-notes'),
  };
  if (!body.ticker || isNaN(body.strike) || !body.expiry || isNaN(body.entry_price)) {
    showToast('Fill in all required fields', 'error'); return;
  }
  const result = await apiFetch('/api/trades/add', 'POST', body);
  if (result && result.id) {
    showToast('Trade added: ' + body.ticker, 'success');
    ['new-ticker','new-strike','new-expiry','new-contracts','new-entry','new-notes'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('new-contracts').value = '1';
    loadTrades();
  }
}

// ── P&L Chart ─────────────────────────────────────────────────────────────────

function renderPnlChart() {
  const canvas = document.getElementById('pnl-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth || 600;
  canvas.height = 120;

  const closed = [...trades].filter(t => t.status === 'closed').sort((a,b) => a.opened_at > b.opened_at ? 1 : -1);
  if (closed.length < 2) {
    ctx.fillStyle = '#8b949e';
    ctx.font = '13px Segoe UI';
    ctx.fillText('Close more trades to see the P&L chart', 20, 60);
    return;
  }

  let running = 0;
  const points = closed.map(t => { running += Number(t.pnl) || 0; return running; });
  const labels = closed.map(t => t.ticker);

  const w = canvas.width, h = canvas.height;
  const pad = { t: 10, r: 10, b: 20, l: 50 };
  const chartW = w - pad.l - pad.r;
  const chartH = h - pad.t - pad.b;

  const minV = Math.min(0, ...points);
  const maxV = Math.max(0, ...points);
  const range = maxV - minV || 1;

  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach(f => {
    const y = pad.t + chartH * (1 - f);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    const val = minV + range * f;
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px Segoe UI';
    ctx.textAlign = 'right';
    ctx.fillText((val >= 0 ? '+' : '') + '$' + Math.abs(val).toFixed(0), pad.l - 4, y + 3);
  });

  // Zero line
  const zeroY = pad.t + chartH * (1 - (0 - minV) / range);
  ctx.strokeStyle = '#58a6ff';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(pad.l, zeroY); ctx.lineTo(w - pad.r, zeroY); ctx.stroke();
  ctx.setLineDash([]);

  // Fill under curve
  const xStep = chartW / (points.length - 1);
  const toX = i => pad.l + i * xStep;
  const toY = v => pad.t + chartH * (1 - (v - minV) / range);

  const lastColor = points[points.length - 1] >= 0 ? '#3fb950' : '#f78166';
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + chartH);
  grad.addColorStop(0, lastColor + '44');
  grad.addColorStop(1, lastColor + '00');

  ctx.beginPath();
  ctx.moveTo(toX(0), toY(points[0]));
  points.forEach((v, i) => { if (i > 0) ctx.lineTo(toX(i), toY(v)); });
  ctx.lineTo(toX(points.length - 1), h - pad.b);
  ctx.lineTo(pad.l, h - pad.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = lastColor;
  ctx.lineWidth = 2;
  points.forEach((v, i) => { i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)); });
  ctx.stroke();

  // Dots
  points.forEach((v, i) => {
    ctx.beginPath();
    ctx.arc(toX(i), toY(v), 4, 0, Math.PI * 2);
    ctx.fillStyle = v >= 0 ? '#3fb950' : '#f78166';
    ctx.fill();
  });
}

// ── Greeks Tab ────────────────────────────────────────────────────────────────

async function loadGreeks() {
  trades = await apiFetch('/api/trades') || [];
  const open = trades.filter(t => t.status === 'open');
  const el = document.getElementById('greeks-content');

  if (!open.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">Δ</div><div>No open positions</div></div>';
    return;
  }

  // Gather chain data for open positions
  const chainCache = {};
  for (const trade of open) {
    if (!chainCache[trade.ticker]) {
      chainCache[trade.ticker] = await apiFetch('/api/options/' + trade.ticker) || [];
    }
  }

  let totalDelta = 0, totalTheta = 0;
  const rows = open.map(trade => {
    const chain = chainCache[trade.ticker] || [];
    const match = chain.find(o =>
      o.call_put === trade.call_put &&
      Math.abs(Number(o.strike) - Number(trade.strike)) < 0.01
    );
    const delta = match && match.delta !== null ? Number(match.delta) : null;
    const theta = match && match.theta !== null ? Number(match.theta) : null;
    const iv    = match && match.iv !== null ? Number(match.iv) : null;
    const contracts = Number(trade.contracts) || 1;

    if (delta !== null) totalDelta += delta * contracts * 100;
    if (theta !== null) totalTheta += theta * contracts * 100;

    const thetaAlert = theta !== null && (theta * contracts * 100) < -10;

    return `
      <tr>
        <td><strong>${trade.ticker}</strong></td>
        <td><span class="badge ${trade.call_put === 'CALL' ? 'badge-green' : 'badge-red'}">${trade.call_put}</span></td>
        <td>$${fmt(trade.strike)} exp ${trade.expiry}</td>
        <td>${contracts}</td>
        <td title="Delta: directional exposure. 1.0 = equivalent to 100 shares">${delta !== null ? fmt(delta, 3) : '—'}</td>
        <td title="Theta: daily time decay in dollars" style="${thetaAlert ? 'color:var(--red);font-weight:700' : ''}">
          ${theta !== null ? '$' + fmt(theta * contracts * 100, 2) + '/day' : '—'}
          ${thetaAlert ? ' ⚠️' : ''}
        </td>
        <td title="Implied Volatility">${iv !== null ? fmtPct(iv) : '—'}</td>
      </tr>
    `;
  }).join('');

  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><span class="card-title">Portfolio Greeks</span></div>
      <div class="stat-chips-row">
        <div class="stat-chip" title="Total portfolio delta — equivalent share exposure">
          <span class="value" style="color:var(--blue)">${totalDelta.toFixed(1)}</span>
          <span class="label">Total Δ Delta</span>
        </div>
        <div class="stat-chip" title="Total daily theta decay across all positions">
          <span class="value" style="${totalTheta < -20 ? 'color:var(--red)' : 'color:var(--yellow)'}">
            $${totalTheta.toFixed(2)}/day
          </span>
          <span class="label">Total Θ Theta</span>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><span class="card-title">Greeks Explained</span></div>
      <div>
        <div class="greek-row">
          <div>
            <div class="greek-name">Δ Delta</div>
            <div class="greek-expl">Rate of change of option price per $1 move in the underlying. 0.5 = at-the-money. Positive for calls, negative for puts.</div>
          </div>
        </div>
        <div class="greek-row">
          <div>
            <div class="greek-name">Θ Theta</div>
            <div class="greek-expl">Daily time decay — how much the option loses in value per day as expiration approaches. Always negative for long options.</div>
          </div>
        </div>
        <div class="greek-row">
          <div>
            <div class="greek-name">IV (Implied Volatility)</div>
            <div class="greek-expl">The market's implied forecast of future price movement. High IV = expensive options. Watch for IV crush after earnings.</div>
          </div>
        </div>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Ticker</th><th>Type</th><th>Position</th><th>Contracts</th>
          <th title="Delta per contract × qty">Δ Delta</th>
          <th title="Theta decay per day (total)">Θ Theta/Day</th>
          <th title="Implied Volatility">IV</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ── Screener Tab ──────────────────────────────────────────────────────────────

async function loadScreener() {
  const el = document.getElementById('screener-content');
  el.innerHTML = '<div class="empty-state"><div class="spinner"></div><div>Scanning...</div></div>';
  const data = await apiFetch('/api/screener') || [];
  renderScreener(data);
}

function renderScreener(data) {
  const el = document.getElementById('screener-content');

  if (!data.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><div>No unusual activity found. Add more tickers and wait for the fetcher.</div></div>';
    return;
  }

  const cols = [
    { key: 'ticker',        label: 'Ticker' },
    { key: 'call_put',      label: 'Type' },
    { key: 'strike',        label: 'Strike' },
    { key: 'expiry',        label: 'Expiry' },
    { key: 'bid',           label: 'Bid' },
    { key: 'ask',           label: 'Ask' },
    { key: 'iv',            label: 'IV',    title: 'Implied Volatility' },
    { key: 'volume',        label: 'Volume', title: 'Contracts traded today' },
    { key: 'open_interest', label: 'OI',    title: 'Open Interest' },
    { key: 'score',         label: 'Score', title: 'Opportunity score (higher = more unusual)' },
    { key: 'flags',         label: 'Signals' },
  ];

  const state = sortState['screener'] || { key: 'score', dir: -1 };
  const sorted = [...data].sort((a, b) => {
    let av = a[state.key], bv = b[state.key];
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    return (av > bv ? 1 : -1) * state.dir;
  });

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <span class="badge badge-blue">${data.length} opportunities</span>
      <button class="btn btn-ghost btn-sm" onclick="loadScreener()">↻ Refresh</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>${cols.map(c => `
          <th title="${c.title||''}" onclick="sortScreenerTable('${c.key}',this)"
              class="${state.key === c.key ? (state.dir === 1 ? 'sort-asc' : 'sort-desc') : ''}">${c.label}</th>
        `).join('')}</tr></thead>
        <tbody>${sorted.map(row => {
          const scoreColor = row.score >= 50 ? 'var(--green)' : row.score >= 30 ? 'var(--yellow)' : 'var(--muted)';
          return `<tr>
            <td><strong>${row.ticker}</strong></td>
            <td><span class="badge ${row.call_put === 'CALL' ? 'badge-green' : 'badge-red'}">${row.call_put}</span></td>
            <td>$${fmt(row.strike)}</td>
            <td>${row.expiry || '—'}</td>
            <td>$${fmt(row.bid)}</td>
            <td>$${fmt(row.ask)}</td>
            <td>${fmtPct(row.iv)}</td>
            <td>${Number(row.volume).toLocaleString()}</td>
            <td>${Number(row.open_interest).toLocaleString()}</td>
            <td><span style="color:${scoreColor};font-weight:700">${row.score}</span></td>
            <td><span class="badge badge-yellow">${row.flags}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
}

function sortScreenerTable(key, th) {
  const state = sortState['screener'] || { key: 'score', dir: -1 };
  if (state.key === key) { state.dir *= -1; } else { state.key = key; state.dir = 1; }
  sortState['screener'] = state;
  loadScreener();
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadWatchlist();

  // Auto-refresh prices every 30 seconds
  setInterval(() => {
    watchlist.forEach(item => fetchPrice(item.ticker));
  }, 30000);

  // Enter key on add ticker
  document.getElementById('add-ticker').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTicker();
  });

  // Close modal on backdrop click
  document.getElementById('close-modal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  // Resize chart on window resize
  window.addEventListener('resize', () => {
    if (document.getElementById('tab-trades').classList.contains('active')) {
      renderPnlChart();
    }
  });
});
