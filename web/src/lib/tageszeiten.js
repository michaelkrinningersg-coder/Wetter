// Heute und morgen in Tageszeiten gebündelt (Startseite): je Abschnitt das
// vorherrschende Symbol, Temperatur, Niederschlag und Regenwahrscheinlichkeit.
// Regen kommt immer ins Symbol, sobald er im Abschnitt vorkommt - ob
// anhaltend (Regen) oder zeitweise (Schauer). Ohne Svelte, für die Tests.

// [Schlüssel, Name, Kurzname, von, bis (Stunde, ohne)] - deutsche Ortszeit;
// so entschieden: Nacht 6 Stunden, sonst je 3
export const TAGESZEITEN = [
  ["nacht", "Nacht", "Nacht", 0, 6],
  ["morgen", "Morgen", "Morgen", 6, 9],
  ["vormittag", "Vormittag", "Vorm.", 9, 12],
  ["mittag", "Mittag", "Mittag", 12, 15],
  ["nachmittag", "Nachmittag", "Nachm.", 15, 18],
  ["abend", "Abend", "Abend", 18, 21],
  ["spaet", "Spätabend", "Spät", 21, 24],
];
// ab diesen Böen (km/h) zeigt die Startseite den Windsack
export const WINDIG_AB = 40;

const NASS = new Set(["niesel", "regen", "starkregen", "schauer", "gewitter", "schnee", "schneeschauer", "schneeregen", "glatteis"]);
const SCHNEE = new Set(["schnee", "schneeschauer"]);
// trockene Symbole von hell nach trüb - bei Gleichstand gewinnt das trübere
const TROCKEN = ["klar", "heiter", "wolkig", "bedeckt", "nebel"];
// ab dieser Wahrscheinlichkeit (%) gilt ein trockener Abschnitt als wechselhaft
export const WECHSELHAFT_AB = 50;

const nass = (s) => NASS.has(s.symbol) || (s.regen ?? 0) >= 0.1;

/** vorherrschendes trockenes Symbol: das häufigste, bei Gleichstand das trübere */
function vorherrschend(stunden) {
  const zahl = new Map();
  for (const s of stunden) if (TROCKEN.includes(s.symbol)) zahl.set(s.symbol, (zahl.get(s.symbol) ?? 0) + 1);
  let best = null;
  for (const [sym, n] of zahl) if (!best || n > best[1] || (n === best[1] && TROCKEN.indexOf(sym) > TROCKEN.indexOf(best[0]))) best = [sym, n];
  return best?.[0] ?? stunden.find((s) => s.symbol)?.symbol ?? null;
}

/**
 * Ein Abschnitt aus Stunden ({h, temp, regen, wind, boe, symbol, tagLicht, wkt}):
 * {symbol, text, art ("trocken"|"möglich"|"zeitweise"|"anhaltend"), min, max,
 *  regen (Summe), wkt (höchste, oder null), wind, boe}
 */
export function abschnitt(stunden) {
  const temps = stunden.map((s) => s.temp).filter((v) => v != null);
  const wkts = stunden.map((s) => s.wkt).filter((v) => v != null);
  const wkt = wkts.length ? Math.max(...wkts) : null;
  const nassStunden = stunden.filter(nass);
  const regen = stunden.reduce((a, s) => a + (s.regen ?? 0), 0);
  let symbol, art;
  if (!nassStunden.length) {
    symbol = vorherrschend(stunden);
    art = "trocken";
    if (wkt != null && wkt >= WECHSELHAFT_AB) {
      symbol = "schauer";
      art = "möglich";
    }
  } else {
    const anhaltend = nassStunden.length * 2 >= stunden.length;
    art = anhaltend ? "anhaltend" : "zeitweise";
    const syms = new Set(nassStunden.map((s) => s.symbol));
    const schnee = nassStunden.filter((s) => SCHNEE.has(s.symbol)).length * 2 > nassStunden.length;
    if (syms.has("gewitter")) symbol = "gewitter";
    else if (syms.has("glatteis")) symbol = "glatteis";
    else if (schnee) symbol = anhaltend ? "schnee" : "schneeschauer";
    else if (syms.has("schneeregen")) symbol = "schneeregen";
    else if (!anhaltend) symbol = "schauer";
    else if (syms.has("starkregen")) symbol = "starkregen";
    else if ([...syms].every((x) => x === "niesel")) symbol = "niesel";
    else symbol = "regen";
  }
  const spitze = (i) => {
    const v = stunden.map((s) => s[i]).filter((x) => x != null);
    return v.length ? Math.max(...v) : null;
  };
  return {
    symbol,
    art,
    // Tag oder Nacht fürs Symbol: die Mitte des Abschnitts
    mitte: stunden[Math.floor(stunden.length / 2)],
    min: temps.length ? Math.min(...temps) : null,
    max: temps.length ? Math.max(...temps) : null,
    regen,
    wkt,
    wind: spitze("wind"),
    boe: spitze("boe"),
  };
}

/** Stunden eines Tages -> alle Abschnitte; ohne Stunden (schon vorbei) mit leer: true */
export function tageszeiten(stunden) {
  return TAGESZEITEN.map(([k, name, kurz, von, bis]) => {
    const z = stunden.filter((s) => s.h >= von && s.h < bis);
    return z.length ? { k, name, kurz, von, bis, ab: z[0].h, stunden: z, ...abschnitt(z) } : { k, name, kurz, von, bis, leer: true };
  });
}
