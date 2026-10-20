// Antwort von Bright Sky /radar (format=compressed) -> Bilder als Zahlen.
// Jedes Bild: zlib-gepackte uint16 (little endian), Zeile für Zeile, in
// 0,01 mm je 5 Minuten. Ohne Svelte, damit die Tests es direkt prüfen.
import { unzlibSync } from "fflate";

function bytes(b64) {
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

/** bbox: [oben, links, unten, rechts] wie angefragt */
export function entpacken(antwort, bbox) {
  const zeilen = bbox[2] - bbox[0] + 1;
  const spalten = bbox[3] - bbox[1] + 1;
  const bilder = (antwort.radar ?? []).map((b) => {
    const roh = unzlibSync(bytes(b.precipitation_5));
    const werte = new Uint16Array(roh.buffer, roh.byteOffset, roh.byteLength / 2);
    return { zeit: b.timestamp, werte };
  });
  return { bbox, zeilen, spalten, bilder };
}
