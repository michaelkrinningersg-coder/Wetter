// Standort des Geräts (GPS am Handy, Ortung von Windows am PC) und die
// nächste DWD-Station dazu. Ohne Svelte, damit die Tests es direkt prüfen.

const FEHLER = {
  1: "Standort nicht erlaubt – bitte in den Einstellungen freigeben",
  2: "Standort nicht verfügbar – ist die Ortung eingeschaltet?",
  3: "Standort kam nicht rechtzeitig",
};

let gemerkt = null; // [Zeit, {lat, lon, genau}]

/** {lat, lon, genau (m)} - 10 Minuten gemerkt; wirft mit deutschem Text. */
export function meinStandort(neu = false) {
  if (!neu && gemerkt && Date.now() - gemerkt[0] < 10 * 60 * 1000) return Promise.resolve(gemerkt[1]);
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.reject(new Error("Dieses Gerät kann seinen Standort nicht bestimmen"));
  return new Promise((ok, nein) =>
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const ort = { lat: p.coords.latitude, lon: p.coords.longitude, genau: Math.round(p.coords.accuracy) };
        gemerkt = [Date.now(), ort];
        ok(ort);
      },
      (f) => nein(new Error(FEHLER[f.code] ?? f.message ?? "Standort unbekannt")),
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 10 * 60 * 1000 },
    ),
  );
}

/** Der zuletzt bestimmte Standort (oder null) - für das Widget */
export const letzterStandort = () => gemerkt?.[1] ?? null;

/** Entfernung in km (Großkreis) */
export function entfernung(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/**
 * Nächste Station zu einem Punkt. stationen: Zeilen der Suche
 * [id, name, land, hoehe, von, bis, tage, lat, lon]; nur aktive (Daten bis
 * mindestens Vorjahr), wenn `nurAktiv`. Liefert [zeile, km] oder null.
 */
export function naechsteStation(stationen, lat, lon, nurAktiv = true, jahr = new Date().getFullYear()) {
  let beste = null;
  for (const z of stationen) {
    if (z[7] == null || z[8] == null) continue;
    if (nurAktiv && !(z[5] && Number(z[5].slice(0, 4)) >= jahr - 1)) continue;
    const km = entfernung(lat, lon, z[7], z[8]);
    if (!beste || km < beste[1]) beste = [z, km];
  }
  return beste;
}

/**
 * Station für die Klimadaten eines Punkts: aktiv (Daten bis mindestens
 * Vorjahr), mindestens 30 Jahre, und die nächste - 100 m Höhenunterschied
 * zählen wie 10 km Entfernung. hoehe null: nur die Entfernung.
 * Liefert bis zu `anzahl` Vorschläge [{zeile, km, dh, wert}], bester zuerst.
 */
export function passendeStationen(stationen, lat, lon, hoehe = null, anzahl = 3, jahr = new Date().getFullYear()) {
  const aus = [];
  for (const z of stationen) {
    if (z[7] == null || z[8] == null || !z[4] || !z[5]) continue;
    const bis = Number(String(z[5]).slice(0, 4));
    if (bis < jahr - 1 || bis - Number(String(z[4]).slice(0, 4)) + 1 < 30) continue;
    const km = entfernung(lat, lon, z[7], z[8]);
    const dh = hoehe == null || z[3] == null ? null : z[3] - hoehe;
    aus.push({ zeile: z, km, dh, wert: km + (dh == null ? 0 : Math.abs(dh) / 10) });
  }
  aus.sort((a, b) => a.wert - b.wert);
  return aus.slice(0, anzahl);
}
