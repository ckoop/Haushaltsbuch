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
// Drei Modi:
//   ?isin=...              loest zuerst per Yahoo-Suche einen Ticker auf
//                          (einmalig beim Anlegen einer Depot-Position,
//                          danach wird der Ticker in
//                          depot_positions.ticker zwischengespeichert)
//   ?ticker=...             fragt direkt den aktuellen Kurs ab (der
//                          uebliche Fall)
//   ?ticker=...&range=...&interval=...   fragt stattdessen eine
//                          historische Kursreihe ab, fuer den
//                          Verlaufs-Chart in Depot.jsx. range/interval
//                          werden unveraendert an Yahoo durchgereicht
//                          (z. B. "3mo"/"1d" oder "5y"/"1wk").
routerAdd("GET", "/api/depot/quote", (e) => {
  const query = e.request.url.query();
  const isin = query.get("isin");
  const tickerParam = query.get("ticker");
  const range = query.get("range");
  const interval = query.get("interval");

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

    let chartUrl = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol);
    if (range && interval) {
      chartUrl += "?range=" + encodeURIComponent(range) + "&interval=" + encodeURIComponent(interval);
    }
    const chartRes = $http.send({
      url: chartUrl,
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10,
    });
    const result = chartRes.json && chartRes.json.chart && chartRes.json.chart.result && chartRes.json.chart.result[0];
    const meta = result && result.meta;
    if (!meta) {
      return e.json(404, { error: "Kein Kurs fuer " + symbol + " gefunden" });
    }

    if (range && interval) {
      const timestamps = result.timestamp || [];
      const closes = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
      // Der letzte Punkt eines noch laufenden Handelstages hat oft ein
      // "close: null" - rausfiltern statt eine Luecke im Chart zu erzeugen.
      const points = [];
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] != null) points.push({ t: timestamps[i], price: closes[i] });
      }
      return e.json(200, { symbol: symbol, currency: meta.currency, points: points });
    }

    if (meta.regularMarketPrice == null) {
      return e.json(404, { error: "Kein Kurs fuer " + symbol + " gefunden" });
    }
    return e.json(200, {
      symbol: symbol,
      name: name,
      price_cents: Math.round(meta.regularMarketPrice * 100),
      // Zusaetzlich der rohe Wert: price_cents rundet auf ganze Cent, das
      // reicht fuer Aktien-/ETF-Preise, zerstoert aber die Genauigkeit bei
      // Wechselkursen (z. B. 0,0068 JPY->EUR wuerde auf 0 oder 1 runden).
      // Fuer Waehrungsumrechnung im Depot wird deshalb price verwendet.
      price: meta.regularMarketPrice,
      currency: meta.currency,
      as_of: meta.regularMarketTime,
    });
  } catch (err) {
    return e.json(502, { error: "Yahoo Finance nicht erreichbar: " + err });
  }
}, $apis.requireAuth());
