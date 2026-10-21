// Brücke zu Widget und Meldungen am Handy (WetterNativ.java). Im Browser und
// am PC tut sie nichts.
import { registerPlugin } from "@capacitor/core";

const W = registerPlugin("WetterNativ");

export const nativ = () => globalThis.Capacitor?.isNativePlatform?.() === true;

/** Ort, Modell, Favoriten und Schalter an Widget und Meldungen geben. */
export async function widgetSetzen(e) {
  if (!nativ()) return;
  try {
    await W.setzen(e);
  } catch (f) {
    console.warn("Widget:", f);
  }
}

/** {erlaubt, fehler} */
export async function widgetStatus() {
  if (!nativ()) return { erlaubt: false, fehler: "" };
  try {
    return await W.status();
  } catch {
    return { erlaubt: false, fehler: "" };
  }
}

/** Fragt nach der Erlaubnis für Meldungen (Android 13+); {erlaubt} */
export async function meldungenErlauben() {
  if (!nativ()) return { erlaubt: false };
  try {
    return await W.erlaubnis();
  } catch {
    return { erlaubt: false };
  }
}

export async function widgetJetzt() {
  if (nativ()) await W.jetzt().catch(() => {});
}
