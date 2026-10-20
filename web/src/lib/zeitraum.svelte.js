// Der gewählte Vergleichszeitraum ("Normal"): immer 30 Jahre, ab 1991, 1981,
// 1971 oder 1961. Gilt für alle Ansichten; die Texte lesen ihn von hier.

export const NORMALE = [1991, 1981, 1971, 1961];

export const vergleich = $state({ von: 1991 });

/** "1991–2020" */
export const normalText = (von = vergleich.von) => `${von}–${von + 29}`;
