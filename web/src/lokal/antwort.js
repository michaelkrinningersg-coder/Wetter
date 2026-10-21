// Was CapacitorHttp als `data` liefert, hängt vom Content-Type der Antwort
// ab - nicht vom gewünschten responseType:
//   application/json            -> schon gelesenes Objekt (auch bei Fehlern)
//   sonst mit "arraybuffer"     -> Base64-Text der Bytes
//   Fehlerantwort ohne JSON     -> einfacher Text
// Ohne Capacitor, damit die Tests es direkt prüfen können.

/** Bytes einer Antwort (Base64-Text oder ArrayBuffer) */
export function bytesAus(data) {
  if (typeof data === "string") return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error("Antwort ohne Bytes");
}

/** JSON aus einer Antwort von CapacitorHttp */
export function jsonAus(data) {
  if (data == null) throw new Error("leere Antwort");
  if (typeof data === "object" && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return data;
  if (typeof data === "string") {
    const t = data.trim();
    if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t); // Fehlertext als JSON
  }
  return JSON.parse(new TextDecoder("utf-8").decode(bytesAus(data)));
}
