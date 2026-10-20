"""
Wetter - die mitgelieferte Datenbank bauen
==========================================

    python startdaten_bauen.py [Ziel] [Station ...]

Holt Stationsliste, Verzeichnis der hist-Archive und die Reihen der
genannten Stationen (Vorgabe: Göttingen) und schreibt sie nach
startdaten/wetter.duckdb. Läuft beim Bau der exe - so öffnet das Programm
beim ersten Start sofort mit Göttingen, ohne auf den DWD zu warten.
"""

import os
import sys
import time

import daten
import dwd
import wetter


def bauen(ziel: str, stationen: list[int]) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(ziel)), exist_ok=True)
    for rest in (ziel, ziel + ".wal"):
        if os.path.exists(rest):
            os.remove(rest)
    db = daten.Daten(ziel)
    t = time.perf_counter()
    liste = dwd.stationsliste()
    db.stationen_setzen(liste)
    db.meta_setzen("stationen_am", time.time())
    print(f"Stationsliste: {len(liste)} ({time.perf_counter() - t:.1f} s)")
    api = wetter.Api(db)
    t = time.perf_counter()
    verzeichnis = api._verzeichnis(neu=True)
    print(f"hist-Verzeichnis: {len(verzeichnis)} ({time.perf_counter() - t:.1f} s)")
    for sid in stationen:
        print(api._laden(sid, ganz=True), db.zeitraum(sid))
    db.meta_setzen("station", stationen[0])
    db._c().execute("CHECKPOINT")
    db.schliessen()
    print(f"{ziel}: {os.path.getsize(ziel) / 1048576:.1f} MB")


if __name__ == "__main__":
    argumente = sys.argv[1:]
    ziel = argumente[0] if argumente else os.path.join("startdaten",
                                                       "wetter.duckdb")
    bauen(ziel, [int(a) for a in argumente[1:]] or [wetter.GOETTINGEN])
