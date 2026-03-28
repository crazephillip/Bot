function getScreenerResults(chainData, priceData) {
  const results = [];
  const tickers = Object.keys(chainData || {});

  for (const ticker of tickers) {
    const chain = chainData[ticker];
    if (!Array.isArray(chain)) continue;

    const currentPrice = Number(priceData?.[ticker]?.price) || 0;

    for (const opt of chain) {
      let score = 0;
      const flags = [];

      const vol = Number(opt.volume) || 0;
      const oi  = Number(opt.open_interest) || 0;
      const iv  = Number(opt.iv) || 0;

      if (oi > 0 && vol > oi * 2)  { score += 30; flags.push('Vol Spike'); }
      if (vol > 5000)               { score += 20; flags.push('High Volume'); }
      if (iv > 0.50)                { score += 25; flags.push('High IV'); }

      const strike = Number(opt.strike) || 0;
      if (currentPrice > 0 && strike > 0) {
        if (Math.abs(strike - currentPrice) / currentPrice < 0.03) {
          score += 20;
          flags.push('Near ATM');
        }
      }

      if (score >= 20) {
        const mid = (opt.bid && opt.ask)
          ? Math.round((Number(opt.bid) + Number(opt.ask)) / 2 * 100) / 100
          : 0;
        results.push({
          ticker,
          strike:        opt.strike,
          expiry:        opt.expiry,
          call_put:      opt.call_put,
          bid:           opt.bid,
          ask:           opt.ask,
          mid,
          iv:            opt.iv,
          delta:         opt.delta,
          theta:         opt.theta,
          volume:        opt.volume,
          open_interest: opt.open_interest,
          score,
          flags:         flags.join(', ')
        });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

module.exports = { getScreenerResults };
