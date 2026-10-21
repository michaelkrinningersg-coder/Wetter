// Heute und morgen Stunde für Stunde mit dem feinsten Kurzfristmodell, das
// für den Ort Werte liefert. Stunden jenseits seiner Reichweite kommen aus
// dem nächsten Modell der Liste und tragen dessen Namen (`ersatz`).
// Ohne Svelte, damit die Tests es direkt prüfen können.

// feinste Auflösung zuerst: Swiss HD 1 km nur bis etwa 50° Nord, sonst ICON-D2
export const KURZFRIST = ["swiss1", "icon_d2", "swiss2", "icon_eu", "ecmwf", "gfs", "metno"];

const ZONE = "Europe/Berlin";
const TAG = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: ZONE });
const STUNDE = new Intl.DateTimeFormat("de-DE", { hour: "numeric", hourCycle: "h23", timeZone: ZONE });
const KOPF = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: ZONE });

/** "2026-10-20" in deutscher Zeit */
export const ortsTag = (ms) => TAG.format(new Date(ms));
const ortsStunde = (ms) => Number(STUNDE.formatToParts(new Date(ms)).find((t) => t.type === "hour").value);

/**
 * modelle: Liste aus der Vorhersage ({id, name, stunden}), jetzt: ms.
 * Liefert {modell, tage: [{titel, tag, min, max, regen, stunden}]} oder null.
 */
export function heuteMorgen(modelle, jetzt = Date.now()) {
  const mit = KURZFRIST.map((id) => modelle?.find((m) => m.id === id && m.stunden?.length)).filter(Boolean);
  if (!mit.length) return null;
  const heute = ortsTag(jetzt);
  const morgen = ortsTag(Date.parse(`${heute}T12:00:00Z`) + 86400000);
  const ab = jetzt - 3600 * 1000; // die laufende Stunde gehört dazu

  // je Stunde das erste Modell der Liste, das einen Wert hat
  const stunden = new Map();
  for (const m of mit) {
    for (const s of m.stunden) {
      const ms = Date.parse(s[0]);
      if (ms < ab || stunden.has(ms)) continue;
      const tag = ortsTag(ms);
      if (tag !== heute && tag !== morgen) continue;
      if (s[1] == null) continue;
      stunden.set(ms, { zeit: s[0], tag, h: ortsStunde(ms), temp: s[1], wolken: s[2], regen: s[3], wind: s[4], boe: s[5], symbol: s[6], tagLicht: s[7], ersatz: m === mit[0] ? null : m.name });
    }
  }
  const tage = [heute, morgen].map((t) => {
    const z = [...stunden.entries()].filter(([, s]) => s.tag === t).sort((a, b) => a[0] - b[0]).map(([, s]) => s);
    const temps = z.map((s) => s.temp);
    return {
      tag: t,
      titel: t === heute ? "Heute" : "Morgen",
      datum: z.length ? KOPF.format(new Date(z[0].zeit)) : "",
      min: temps.length ? Math.min(...temps) : null,
      max: temps.length ? Math.max(...temps) : null,
      regen: z.reduce((a, s) => a + (s.regen ?? 0), 0),
      stunden: z,
    };
  });
  return { modell: mit[0].name, tage };
}
