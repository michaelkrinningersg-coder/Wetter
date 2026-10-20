"""
Wetter - Startdaten für die Android-App
=======================================

    python android_start.py [Ziel]      Vorgabe: web/public-android/start

Legt in die App, was sie beim ersten Start ohne Netz braucht: die
Stationsliste (als kleines JSON statt 1,4 MB Text mit Leerzeichen), das
Verzeichnis der hist-Archive und die beiden Göttinger Archive, so wie der
DWD sie liefert. Gelesen werden sie im Handy (src/lokal/lesen.js).
"""

import json
import os
import sys
import time

import dwd

GOETTINGEN = 1691


def bauen(ziel: str) -> None:
    os.makedirs(ziel, exist_ok=True)
    stationen = dwd.stationsliste()
    verzeichnis = dwd.hist_verzeichnis()
    hist = dwd.holen("historical/" + verzeichnis[GOETTINGEN])
    recent = dwd.holen(dwd.recent_pfad(GOETTINGEN))
    with open(os.path.join(ziel, "stationen.json"), "w", encoding="utf-8") as datei:
        json.dump(stationen, datei, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(ziel, "verzeichnis.json"), "w", encoding="utf-8") as datei:
        json.dump(verzeichnis, datei, separators=(",", ":"))
    with open(os.path.join(ziel, "01691_hist.zip"), "wb") as datei:
        datei.write(hist)
    with open(os.path.join(ziel, "01691_akt.zip"), "wb") as datei:
        datei.write(recent)
    # wann recent geholt wurde - die App holt es neu, wenn das zu alt ist
    with open(os.path.join(ziel, "stand.json"), "w", encoding="utf-8") as datei:
        json.dump({"recent_am": int(time.time() * 1000)}, datei)
    print(f"{len(stationen)} Stationen, {len(verzeichnis)} hist-Archive, "
          f"Göttingen {len(hist) // 1024} + {len(recent) // 1024} kB -> {ziel}")


if __name__ == "__main__":
    bauen(sys.argv[1] if len(sys.argv) > 1 else
          os.path.join("web", "public-android", "start"))
