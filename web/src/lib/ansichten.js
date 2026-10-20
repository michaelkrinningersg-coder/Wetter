// Alle Ansichten der App: Schlüssel, Titel, Kurzname, Symbol - für das
// Menüband, das Menü "Ansicht" und die Navigation auf dem Handy.

export const HAUPT = [
  ["uebersicht", "Übersicht", "Start", "⌂"],
  ["vorhersage", "Vorhersage", "Wetter", "⛅"],
  ["band", "Jahresband", "Jahr", "▥"],
  ["monat", "Monat", "Monat", "▦"],
  ["rang", "Rangliste", "Rang", "≡"],
  ["reihe", "Zeitreihe", "Reihe", "⌇"],
];

// Auswertungen über die ganze Reihe: Schlüssel, Titel, Name beim Aufruf,
// Symbol, Kurzname fürs Menüband
export const AUSWERTUNGEN = [
  ["rekorde", "Rekorde", "rekorde", "🏆", "Rekorde"],
  ["geschichte", "Heute in der Geschichte", "geschichte", "📅", "Heute"],
  ["kenntage", "Kenntage", "kenntage", "☀", "Kenntage"],
  ["wellen", "Hitze- und Kältewellen", "wellen", "〰", "Wellen"],
  ["streifen", "Klimastreifen", "streifen", "▮", "Streifen"],
  ["niederschlag", "Niederschlag", "niederschlag", "☂", "Regen"],
  ["sonne", "Sonnenschein", "sonne", "☼", "Sonne"],
  ["schnee", "Schnee", "schnee", "❄", "Schnee"],
  ["wind", "Wind und Sturm", "wind", "≋", "Wind"],
  ["frost", "Frost", "frost", "✱", "Frost"],
  ["verlauf", "Prognose im Verlauf", "prognose_verlauf", "↗", "Prognose"],
];

export const TITEL = Object.fromEntries([...HAUPT, ...AUSWERTUNGEN].map(([k, t]) => [k, t]));
export const IST_AUSWERTUNG = new Set(AUSWERTUNGEN.map(([k]) => k));
export const AUFRUF = Object.fromEntries(AUSWERTUNGEN.map(([k, , a]) => [k, a]));

// Startwerte der Optionen je Auswertung; `daten` sind die, die gerechnet werden müssen
export const OPTIONEN = {
  rekorde: { tiefe: 1 },
  geschichte: { datum: null },
  kenntage: { kenntag: "heiss" },
  wellen: { art: "normal", heiss: 30, kalt: 0, min_tage: 3 },
  niederschlag: { jahr: null },
  sonne: { jahr: null },
};
export const DATEN_OPTIONEN = {
  geschichte: ["datum"],
  wellen: ["art", "heiss", "kalt", "min_tage"],
  niederschlag: ["jahr"],
  sonne: ["jahr"],
};

// Handy: diese vier stehen unten, alles andere unter "Mehr"
export const HANDY_NAV = ["uebersicht", "vorhersage", "band", "monat"];
