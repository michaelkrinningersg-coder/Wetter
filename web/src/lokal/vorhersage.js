// Aktuelles Wetter und Vorhersage je Modell - wie vorhersage.py, für die
// App. Die Umwandlungen (openMeteo, metNorway, brightSky) prüft
// web/test/vorhersage.test.js an denselben abgelegten Antworten.

import { runden } from "./rechnen.js";

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const STUNDEN_WERTE = "temperature_2m,cloud_cover,precipitation,wind_speed_10m,wind_gusts_10m,weather_code,is_day";
export const MODELLE = [
  ["icon_d2", "ICON-D2", "DWD, 2 km, rund 2 Tage", "open-meteo", "icon_d2"],
  ["icon_eu", "ICON-EU", "DWD, 7 km", "open-meteo", "icon_eu"],
  ["ecmwf", "ECMWF IFS", "Europäisches Zentrum, 25 km", "open-meteo", "ecmwf_ifs025"],
  ["gfs", "GFS", "NOAA (USA)", "open-meteo", "gfs_seamless"],
  ["swiss1", "Swiss HD 1 km", "MeteoSwiss ICON-CH1, nur Alpenraum", "open-meteo", "meteoswiss_icon_ch1"],
  ["swiss2", "Swiss HD 2 km", "MeteoSwiss ICON-CH2, nur Alpenraum", "open-meteo", "meteoswiss_icon_ch2"],
  ["metno", "MET Norway", "Norwegischer Wetterdienst", "met-norway", null],
];

const r1 = (v, s = 1) => (v == null ? null : runden(v, s));

export function symbolWmo(code) {
  if (code == null) return null;
  const c = Math.trunc(code);
  if (c === 0) return "klar";
  if (c === 1) return "heiter";
  if (c === 2) return "wolkig";
  if (c === 3) return "bedeckt";
  if (c === 45 || c === 48) return "nebel";
  if ([51, 53, 55].includes(c)) return "niesel";
  if ([56, 57, 66, 67].includes(c)) return "glatteis";
  if (c === 61 || c === 63) return "regen";
  if (c === 65 || c === 82) return "starkregen";
  if ([71, 73, 75, 77].includes(c)) return "schnee";
  if (c === 80 || c === 81) return "schauer";
  if (c === 85 || c === 86) return "schneeschauer";
  if (c >= 95) return "gewitter";
  return null;
}

export function symbolMetno(code) {
  if (!code) return [null, null];
  const i = code.indexOf("_");
  const basis = i < 0 ? code : code.slice(0, i);
  const zeit = i < 0 ? "" : code.slice(i + 1);
  const tag = zeit ? zeit === "day" : null;
  if (basis.includes("thunder")) return ["gewitter", tag];
  if (basis.includes("snowshowers")) return ["schneeschauer", tag];
  if (basis.includes("sleet")) return ["schneeregen", tag];
  if (basis.includes("snow")) return ["schnee", tag];
  if (basis.includes("rainshowers")) return ["schauer", tag];
  if (basis === "heavyrain") return ["starkregen", tag];
  if (basis === "lightrain") return ["niesel", tag];
  if (basis.includes("rain")) return ["regen", tag];
  return [{ clearsky: "klar", fair: "heiter", partlycloudy: "wolkig", cloudy: "bedeckt", fog: "nebel" }[basis] ?? null, tag];
}

export function symbolBrightsky(icon) {
  if (!icon) return [null, null];
  const tag = icon.endsWith("-day") ? true : icon.endsWith("-night") ? false : null;
  const basis = icon.replace("-day", "").replace("-night", "");
  return [
    { clear: "klar", "partly-cloudy": "wolkig", cloudy: "bedeckt", fog: "nebel", wind: "wind", rain: "regen", sleet: "schneeregen", snow: "schnee", hail: "gewitter", thunderstorm: "gewitter" }[basis] ?? null,
    tag,
  ];
}

export function openMeteo(antwort) {
  if (antwort.error) {
    const grund = antwort.reason ?? "";
    if (grund.includes("No data is available for this location")) return { fehler: "Ort liegt außerhalb des Modellgebiets" };
    if (grund.includes("request limit")) return { fehler: "Tageslimit bei Open-Meteo erreicht - später noch einmal" };
    return { fehler: grund || "unbekannter Fehler" };
  }
  const h = antwort.hourly ?? {};
  const stunden = [];
  (h.time ?? []).forEach((t, i) => {
    const wert = (k) => (h[k] && i < h[k].length ? h[k][i] : null);
    const temp = wert("temperature_2m");
    if (temp == null && wert("cloud_cover") == null) return;
    const tag = wert("is_day");
    stunden.push([
      t + ":00Z", r1(temp), r1(wert("cloud_cover"), 0), r1(wert("precipitation")), r1(wert("wind_speed_10m"), 0),
      r1(wert("wind_gusts_10m"), 0), symbolWmo(wert("weather_code")), tag == null ? null : !!tag,
    ]);
  });
  return stunden.length ? { stunden } : { fehler: "keine Werte für diesen Ort" };
}

export function metNorway(antwort, stundenMax = 72) {
  const reihe = antwort.properties?.timeseries ?? [];
  const stunden = reihe.slice(0, stundenMax).map((e) => {
    const d = e.data ?? {};
    const jetzt = d.instant?.details ?? {};
    const naechste = d.next_1_hours ?? d.next_6_hours ?? {};
    const [symbol, tag] = symbolMetno(naechste.summary?.symbol_code);
    const wind = jetzt.wind_speed, boe = jetzt.wind_speed_of_gust;
    return [
      (e.time ?? "").replace("+00:00", "Z"), r1(jetzt.air_temperature), r1(jetzt.cloud_area_fraction, 0),
      r1(naechste.details?.precipitation_amount), wind != null ? r1(wind * 3.6, 0) : null, boe != null ? r1(boe * 3.6, 0) : null, symbol, tag,
    ];
  });
  return stunden.length ? { stunden } : { fehler: "keine Werte" };
}

export function brightSky(antwort) {
  const w = antwort.weather ?? {};
  if (!Object.keys(w).length) return { fehler: "keine Messung in der Nähe" };
  const quellen = antwort.sources ?? [];
  const q = quellen.find((x) => x.id === w.source_id) ?? quellen[0] ?? {};
  const [symbol, tag] = symbolBrightsky(w.icon);
  return {
    zeit: w.timestamp ?? null, temp: r1(w.temperature), wolken: r1(w.cloud_cover, 0), symbol, tag,
    regen: r1(w.precipitation_60), wind: r1(w.wind_speed_10, 0), boe: r1(w.wind_gust_speed_10, 0),
    feuchte: r1(w.relative_humidity, 0), station: q.station_name ?? null, abstand: r1((q.distance ?? 0) / 1000),
  };
}

const f4 = (x) => Number(x).toFixed(4);
export const urlOpenMeteo = (lat, lon, m) => `${OPEN_METEO}?latitude=${f4(lat)}&longitude=${f4(lon)}&hourly=${STUNDEN_WERTE}&forecast_days=3&timezone=GMT&models=${m}`;
export const urlMetNorway = (lat, lon) => `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${f4(lat)}&lon=${f4(lon)}`;
export const urlBrightSky = (lat, lon) => `https://api.brightsky.dev/current_weather?lat=${f4(lat)}&lon=${f4(lon)}`;

/** Aktuell und alle Modelle gleichzeitig; `json(url)` holt und liest. */
export async function abrufen(lat, lon, json) {
  const modell = async ([id, name, text, quelle, om]) => {
    let daten;
    try {
      daten = quelle === "met-norway" ? metNorway(await json(urlMetNorway(lat, lon))) : openMeteo(await json(urlOpenMeteo(lat, lon, om)));
    } catch (e) {
      daten = { fehler: `nicht erreichbar (${e?.message ?? e})` };
    }
    return { id, name, text, ...daten };
  };
  const aktuell = (async () => {
    try {
      return brightSky(await json(urlBrightSky(lat, lon)));
    } catch (e) {
      return { fehler: `nicht erreichbar (${e?.message ?? e})` };
    }
  })();
  const modelle = await Promise.all(MODELLE.map(modell));
  return { aktuell: await aktuell, modelle };
}
