/// <reference path="../pb_data/types.d.ts" />

// Kurs-Proxy fuer das Depot: Yahoo Finance liefert Kurse frei und ohne
// API-Key, setzt aber keinen Access-Control-Allow-Origin-Header - ein
// fetch() direkt aus dem Browser der App scheitert deshalb an CORS. Diese
// Route laeuft serverseitig (kein CORS-Problem) und reicht das Ergebnis
// weiter. Bewusst kein Cron/Scheduler - die Route wird nur aufgerufen,
// wenn die App tatsaechlich einen Kurs braucht (Depot-Tab geoeffnet,
// "Aktualisieren" geklickt), genau wie beim Nachbuchen faelliger
// Daueraufträge in App.jsx.
//
// Zwei Modi:
//   ?isin=...   loest zuerst per Yahoo-Suche einen Ticker auf (einmalig
//               beim Anlegen einer Depot-Position, danach wird der
//               Ticker in depot_positions.ticker zwischengespeichert)
//   ?ticker=...  fragt direkt den Kurs ab (der uebliche Fall)
routerAdd("GET", "/api/depot/quote", (e) => {
  const query = e.request.url.query();
  const isin = query.get("isin");
  const tickerParam = query.get("ticker");

  let symbol = tickerParam;
  let name = "";

  try {
    if (!symbol) {
      if (!isin) {
        return e.json(400, { error: "isin oder ticker angeben" });
      }
      const searchRes = $http.send({
        url: "https://query1.finance.yahoo.com/v1/finance/search?q=" + encodeURIComponent(isin),
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 10,
      });
      const first = searchRes.json && searchRes.json.quotes && searchRes.json.quotes[0];
      if (!first) {
        return e.json(404, { error: "Kein Ticker fuer " + isin + " gefunden" });
      }
      symbol = first.symbol;
      name = first.longname || first.shortname || "";
    }

    const chartRes = $http.send({
      url: "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol),
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10,
    });
    const meta = chartRes.json && chartRes.json.chart && chartRes.json.chart.result && chartRes.json.chart.result[0]
      && chartRes.json.chart.result[0].meta;
    if (!meta || meta.regularMarketPrice == null) {
      return e.json(404, { error: "Kein Kurs fuer " + symbol + " gefunden" });
    }

    return e.json(200, {
      symbol: symbol,
      name: name,
      price_cents: Math.round(meta.regularMarketPrice * 100),
      currency: meta.currency,
      as_of: meta.regularMarketTime,
    });
  } catch (err) {
    return e.json(502, { error: "Yahoo Finance nicht erreichbar: " + err });
  }
}, $apis.requireAuth());
