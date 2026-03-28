const { readData, writeData } = require('../../lib/kv');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9'
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const watchlist = await readData('watchlist');
    if (!watchlist.length) {
      res.json({ ok: true, message: 'empty watchlist' });
      return;
    }

    const [pricesData, chainData] = await Promise.all([
      readData('stock_prices'),
      readData('options_chain')
    ]);

    for (const item of watchlist) {
      const ticker = item.ticker;
      if (!ticker) continue;

      // Fetch price
      try {
        const resp = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`);
        const meta = resp?.chart?.result?.[0]?.meta;
        if (meta) {
          const price     = Math.round(Number(meta.regularMarketPrice) * 100) / 100;
          const prevClose = Number(meta.previousClose) || 0;
          const changePct = prevClose > 0 ? Math.round((price - prevClose) / prevClose * 10000) / 100 : 0;
          pricesData[ticker] = { price, change_pct: changePct, updated_at: new Date().toISOString().slice(0, 19) };
        }
      } catch (e) {
        console.warn(`Price fetch failed for ${ticker}:`, e.message);
      }

      await sleep(600);

      // Fetch options chain (first 3 expirations)
      try {
        const optResp  = await fetchJson(`https://query1.finance.yahoo.com/v7/finance/options/${ticker}`);
        const optResult = optResp?.optionChain?.result?.[0];
        if (!optResult) continue;

        const expirations = (optResult.expirationDates || []).slice(0, 3);
        const optionsArr  = [];

        for (const exp of expirations) {
          try {
            const expResp   = await fetchJson(`https://query1.finance.yahoo.com/v7/finance/options/${ticker}?date=${exp}`);
            const expResult  = expResp?.optionChain?.result?.[0];
            if (!expResult) continue;

            const expDate = new Date(exp * 1000).toISOString().slice(0, 10);
            const parse = (o, type) => ({
              strike:        Math.round((Number(o.strike?.raw) || 0) * 100) / 100,
              expiry:        expDate,
              call_put:      type,
              bid:           Math.round((Number(o.bid?.raw) || 0) * 100) / 100,
              ask:           Math.round((Number(o.ask?.raw) || 0) * 100) / 100,
              iv:            Math.round((Number(o.impliedVolatility?.raw) || 0) * 10000) / 10000,
              delta:         o.delta   ? Math.round(Number(o.delta)   * 10000) / 10000 : null,
              theta:         o.theta   ? Math.round(Number(o.theta)   * 10000) / 10000 : null,
              volume:        Number(o.volume?.raw)       || 0,
              open_interest: Number(o.openInterest?.raw) || 0,
              fetched_at:    new Date().toISOString().slice(0, 19)
            });

            for (const c of (expResult.options?.[0]?.calls || [])) optionsArr.push(parse(c, 'CALL'));
            for (const p of (expResult.options?.[0]?.puts  || [])) optionsArr.push(parse(p, 'PUT'));
            await sleep(300);
          } catch {}
        }

        if (optionsArr.length > 0) chainData[ticker] = optionsArr;
      } catch (e) {
        console.warn(`Options fetch failed for ${ticker}:`, e.message);
      }

      await sleep(800);
    }

    await Promise.all([
      writeData('stock_prices', pricesData),
      writeData('options_chain', chainData)
    ]);

    res.json({ ok: true, tickers: watchlist.map(w => w.ticker) });
  } catch (err) {
    console.error('fetch-options cron error:', err);
    res.status(500).json({ error: err.message });
  }
};
