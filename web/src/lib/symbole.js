// Eigene Symbole der App im Stil "Linie mit Akzent": 24er-Raster, Linien in
// Schriftfarbe, ein Teil je Symbol in der Akzentfarbe. Jedes Symbol ist eine
// Liste von [Pfad, Art]:
//   ""   Linie in Schriftfarbe
//   "a"  Linie in Akzentfarbe
//   "af" Linie in Akzentfarbe, Fläche leicht getönt
//   "aF" Fläche voll in Akzentfarbe
//   "d"  gestrichelte Akzentlinie
//   "n"  Niederschlag (Regen, Schnee) - eigene Farbe, siehe Symbol.svelte
//   "w"  Wolke davor: verdeckt, was vor ihr in der Liste steht (Sonne, Mond)
// Ohne Svelte, damit die Tests die Liste direkt prüfen können.

// --- Bausteine -------------------------------------------------------------
const strahlen = (cx, cy, r1, r2, nur = [0, 1, 2, 3, 4, 5, 6, 7]) =>
  nur.map((i) => {
    const w = (i * Math.PI) / 4;
    const f = (x) => Math.round(x * 100) / 100;
    return [`M${f(cx + r1 * Math.cos(w))} ${f(cy + r1 * Math.sin(w))}L${f(cx + r2 * Math.cos(w))} ${f(cy + r2 * Math.sin(w))}`, "a"];
  });
const kreis = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
const flocke = (cx, cy, r = 2) => [
  [`M${cx} ${cy - r}v${2 * r}`, "n"],
  [`M${cx - r * 0.87} ${cy - r / 2}l${r * 1.73} ${r}`, "n"],
  [`M${cx - r * 0.87} ${cy + r / 2}l${r * 1.73} ${-r}`, "n"],
];
const tropfen = (x, y, l = 2.6) => [`M${x} ${y}l-${l * 0.38} ${l}`, "n"];
const punkt = (x, y) => [`M${x} ${y}h.01`, "n"];

// Wolken: groß (allein), hoch (mit Niederschlag darunter), klein (vor Sonne/Mond)
const WOLKE = "M7 18.5a4.2 4.2 0 0 1-.6-8.36A5.6 5.6 0 0 1 17.2 9a4.6 4.6 0 0 1 .3 9.5z";
const WOLKE_HOCH = "M7 15a3.8 3.8 0 0 1-.55-7.56A5.2 5.2 0 0 1 16.5 6.5a4.25 4.25 0 0 1 .5 8.5z";
const WOLKE_KLEIN = "M10.5 19.5a3.4 3.4 0 0 1-.45-6.77A4.5 4.5 0 0 1 18.6 12a3.75 3.75 0 0 1 .4 7.5z";
const WOLKE_KLEIN_HOCH = "M10.5 16a3.2 3.2 0 0 1-.42-6.37A4.3 4.3 0 0 1 18.3 8.8a3.6 3.6 0 0 1 .4 7.2z";
const MOND = "M19.5 14.5A7.8 7.8 0 1 1 9.5 4.5a6.2 6.2 0 0 0 10 10z";
const MOND_KLEIN = "M13.2 10.2A4.8 4.8 0 1 1 7.6 4.3a3.8 3.8 0 0 0 5.6 5.9z";

const sonneKlein = (cx = 8.5, cy = 8.5) => [[kreis(cx, cy, 3), "af"], ...strahlen(cx, cy, 4.6, 6.2, [2, 3, 4, 5, 6, 7])];
const hinterWolke = (nacht, hoch = false) => (nacht ? [[MOND_KLEIN, "af"]] : sonneKlein(8.5, hoch ? 7.5 : 8.5));

// --- Ansichten und Bedienung -----------------------------------------------
export const SYMBOLE = {
  uebersicht: [
    ["M4 4h7v7H4z", ""],
    ["M13 4h7v4h-7z", "af"],
    ["M13 10h7v10h-7z", ""],
    ["M4 13h7v7H4z", ""],
  ],
  vorhersage: null, // = Wetter "wolkig" am Tag, unten gesetzt
  band: [
    ["M3.5 20h17", ""],
    ["M4 16c3-6.5 5.5-10 8-10s5 3.5 8 10", "d"],
    ["M7 9v8", ""],
    ["M10 6v8", ""],
    ["M13 7.5v9", ""],
    ["M16 9v7", ""],
  ],
  monat: [
    ["M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", ""],
    ["M4 9h16", ""],
    ["M8 3.5v3", ""],
    ["M16 3.5v3", ""],
    ["M13.5 15h3v2.5h-3z", "aF"],
    ["M7.5 12.5h.01M11 12.5h.01M14.5 12.5h.01M7.5 16h.01M11 16h.01", ""],
  ],
  rang: [
    ["M3.5 20v-6h5.5v6", ""],
    ["M9 20V9.5h6V20", "af"],
    ["M15 20v-4h5.5v4", ""],
    ["M3 20h18", ""],
    ["M12 3.5l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 5.6l2-.3z", "a"],
  ],
  reihe: [
    ["M3.5 20h17", ""],
    ["M4 15l2.5-2 2.5 2.5 2.5-5 2.5 3 2.5-5.5 2.5 2.5 1.5-1.5", ""],
    ["M4 16.5L20 8", "d"],
  ],
  favorit: [["M12 3.6l2.55 5.2 5.75.84-4.15 4.05.98 5.72L12 16.7l-5.13 2.7.98-5.72L3.7 9.64l5.75-.84z", ""]],
  favorit_an: [["M12 3.6l2.55 5.2 5.75.84-4.15 4.05.98 5.72L12 16.7l-5.13 2.7.98-5.72L3.7 9.64l5.75-.84z", "aF"]],
  aktualisieren: [
    ["M19.5 12a7.5 7.5 0 1 1-2.2-5.3", ""],
    ["M19.5 4v4.2h-4.2", "a"],
  ],
  mehr: [
    [kreis(5.5, 12, 1.2), "aF"],
    [kreis(12, 12, 1.2), "aF"],
    [kreis(18.5, 12, 1.2), "aF"],
  ],

  // --- Auswertungen --------------------------------------------------------
  rekorde: [
    ["M8 4h8v5a4 4 0 0 1-8 0z", "af"],
    ["M8 6H5.5a1 1 0 0 0-1 1.2c.4 2 1.7 3.3 3.6 3.6", ""],
    ["M16 6h2.5a1 1 0 0 1 1 1.2c-.4 2-1.7 3.3-3.6 3.6", ""],
    ["M12 13v4", ""],
    ["M8.5 20h7l-.8-3h-5.4z", ""],
  ],
  geschichte: [
    ["M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z", ""],
    ["M4 10h16", "a"],
    ["M8 4v4", ""],
    ["M16 4v4", ""],
    ["M12 13a2.5 2.5 0 1 1-2.3 3.5", ""],
    ["M9.5 13.2v2h2", ""],
  ],
  kenntage: [
    ["M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", ""],
    ["M4 9h16", ""],
    ["M7.5 13l1.2 1.2 2-2.2", "a"],
    ["M13.5 13l1.2 1.2 2-2.2", "a"],
    ["M7.5 17l1.2 1.2 2-2.2", "a"],
  ],
  wellen: [
    ["M9 4.5a2 2 0 0 1 4 0v8.2a3.6 3.6 0 1 1-4 0z", ""],
    ["M11 9.5v5", ""],
    ["M15.5 8c1-1 2-1 3 0s2 1 3 0", "a"],
    ["M15.5 12c1-1 2-1 3 0s2 1 3 0", "a"],
  ],
  streifen: [
    ["M4 5h4v14H4z", "aF"],
    ["M16 5h4v14h-4z", "aF"],
    ["M4 5h16v14H4z", ""],
    ["M8 5v14M12 5v14M16 5v14", ""],
  ],
  niederschlag: [
    ["M7 14a4 4 0 0 1-.5-8 5 5 0 0 1 9.6 1.2A3.4 3.4 0 0 1 17 14z", ""],
    ["M8 17l-1 2.5", "a"],
    ["M12 17l-1 2.5", "a"],
    ["M16 17l-1 2.5", "a"],
  ],
  sonne: [[kreis(12, 12, 4), "af"], ...strahlen(12, 12, 6.5, 9)],
  schnee: [
    ["M12 3v18", ""],
    ["M4.2 7.5l15.6 9", ""],
    ["M4.2 16.5l15.6-9", ""],
    ["M10 4.5l2 2 2-2M10 19.5l2-2 2 2", ""],
    ["M4.8 10.3l2.7-.7-.7-2.7M19.2 13.7l-2.7.7.7 2.7M4.8 13.7l2.7.7-.7 2.7M19.2 10.3l-2.7-.7.7-2.7", ""],
  ],
  wind: [
    ["M3 9h11a2.5 2.5 0 1 0-2.5-2.5", ""],
    ["M3 13h15a2.5 2.5 0 1 1-2.5 2.5", "a"],
    ["M3 17h7", ""],
  ],
  frost: [
    ["M7 4.5a2 2 0 0 1 4 0v8.2a3.6 3.6 0 1 1-4 0z", ""],
    ["M9 12v3", ""],
    ["M17 5v8M13.5 7l7 4M13.5 11l7-4", "a"],
  ],
  verlauf: [
    ["M4 20V4", ""],
    ["M4 20h16", ""],
    ["M6.5 15l3-3 2.5 2 3.5-4.5", ""],
    ["M15.5 9.5l3.5-3", "d"],
    [kreis(19, 6.5, 1.2), "aF"],
  ],
};

// --- Wetter: Tag und Nacht ----------------------------------------------------
const WETTER = {
  klar: (n) => (n ? [[MOND, "af"]] : SYMBOLE.sonne),
  heiter: (n) => [...(n ? [[MOND_KLEIN, "af"]] : sonneKlein()), ["M13 20a2.6 2.6 0 0 1-.3-5.18A3.5 3.5 0 0 1 19.3 14a2.8 2.8 0 0 1 .2 6z", "w"]],
  wolkig: (n) => [...hinterWolke(n), [WOLKE_KLEIN, "w"]],
  bedeckt: () => [["M9.8 7.6A4.6 4.6 0 0 1 18.4 7a3.8 3.8 0 0 1 2.1 6.4", ""], [WOLKE, ""]],
  nebel: () => [[WOLKE_HOCH, ""], ["M4 18h12", "a"], ["M8 21h12", "a"]],
  niesel: () => [[WOLKE_HOCH, ""], punkt(8.5, 18), punkt(12.5, 18), punkt(16.5, 18), punkt(10.5, 21), punkt(14.5, 21)],
  regen: () => [[WOLKE_HOCH, ""], tropfen(9, 17.5), tropfen(13, 17.5), tropfen(17, 17.5)],
  starkregen: () => [[WOLKE_HOCH, ""], tropfen(8, 17), tropfen(11.5, 17), tropfen(15, 17), tropfen(18.5, 17), tropfen(10, 20.3, 1.6), tropfen(13.5, 20.3, 1.6)],
  schauer: (n) => [...hinterWolke(n, true), [WOLKE_KLEIN_HOCH, "w"], tropfen(12.5, 18.5), tropfen(16.5, 18.5)],
  schneeregen: () => [[WOLKE_HOCH, ""], tropfen(9.5, 17.5), ...flocke(15, 19.5)],
  schnee: () => [[WOLKE_HOCH, ""], ...flocke(7.5, 19), ...flocke(12.5, 20), ...flocke(17.5, 19)],
  schneeschauer: (n) => [...hinterWolke(n, true), [WOLKE_KLEIN_HOCH, "w"], ...flocke(12, 19.8, 1.8), ...flocke(17, 19.8, 1.8)],
  gewitter: () => [[WOLKE_HOCH, ""], ["M12.8 13.5l-2.6 4.2h3.4l-2.4 4.3", "a"]],
  glatteis: () => [[WOLKE_HOCH, ""], tropfen(9, 16.5, 2.2), tropfen(13, 16.5, 2.2), tropfen(17, 16.5, 2.2), ["M4 21h16", "a"], ["M6.5 21l1-1.5M11 21l1-1.5M15.5 21l1-1.5", "a"]],
  wind: () => SYMBOLE.wind,
};
export const WETTER_ARTEN = Object.keys(WETTER);

/** Pfade eines Wettersymbols; `tag` false zeigt den Mond. */
export function wetterPfade(art, tag = true) {
  const f = WETTER[art];
  return f ? f(tag === false) : null;
}

SYMBOLE.vorhersage = wetterPfade("wolkig", true);
