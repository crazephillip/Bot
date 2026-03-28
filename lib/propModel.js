function normalCDF(z) {
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z);
  const t = 1.0 / (1.0 + 0.2316419 * z);
  const d = 0.3989422823 * Math.exp(-0.5 * z * z);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return sign > 0 ? 1.0 - p : p;
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function runPropModel(playerName, espnId, team, statKey, line, logs, opponent) {
  const playerLogs = logs
    .filter(l => String(l.player_id) === String(espnId))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (playerLogs.length < 3) return null;

  const vals = playerLogs.slice(0, 20).map(l => Number(l[statKey]) || 0);
  if (vals.length < 3) return null;

  const n = vals.length;
  const l5avg  = avg(vals.slice(0, Math.min(5, n)));
  const l10avg = avg(vals.slice(0, Math.min(10, n)));
  const seasonAvg = avg(vals);

  // Standard deviation
  const sq = vals.reduce((a, v) => a + (v - seasonAvg) ** 2, 0);
  let stddev = n > 1 ? Math.sqrt(sq / (n - 1)) : 2.5;
  if (stddev < 0.5) stddev = 0.5;

  // vs opponent average
  let vsOpp = seasonAvg;
  const oppLogs = playerLogs.filter(l => l.opponent === opponent);
  if (oppLogs.length >= 2) {
    vsOpp = avg(oppLogs.map(l => Number(l[statKey]) || 0));
  }

  const predicted = l5avg * 0.35 + l10avg * 0.20 + seasonAvg * 0.20 + vsOpp * 0.25;

  const z = (line - predicted) / stddev;
  const probOver = 1.0 - normalCDF(z);
  const ev = probOver * 0.909 - (1 - probOver) * 1.0;
  const confidence = Math.abs(ev) > 0.10 ? 'A' : Math.abs(ev) > 0.07 ? 'B' : 'C';

  const last5  = vals.slice(0, Math.min(5, n));
  const last10 = vals.slice(0, Math.min(10, n));
  const hr5  = last5.length  ? Math.round(last5.filter(v => v > line).length  / last5.length  * 100) : 0;
  const hr10 = last10.length ? Math.round(last10.filter(v => v > line).length / last10.length * 100) : 0;

  return {
    player_name:  playerName,
    player_id:    espnId,
    team,
    opponent,
    stat:         statKey,
    line,
    predicted:    Math.round(predicted * 10) / 10,
    our_prob:     Math.round(probOver * 1000) / 1000,
    implied_prob: 0.524,
    ev:           Math.round(ev * 1000) / 1000,
    confidence,
    hit_rate_5:   hr5,
    hit_rate_10:  hr10,
    last5,
    date:         new Date().toISOString().slice(0, 10)
  };
}

module.exports = { runPropModel };
