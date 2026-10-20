"""Deutschland-Übersicht: die letzten 7 Tage aller aktiven DWD-Stationen.

Lädt von jeder Station mit recent-Archiv nur dieses (zusammen rund 17 MB),
bereinigt wie überall (plausibel.rein, QN alle) und gibt die Tageswerte
kompakt zurück - die Top-50-Listen rechnet die Seite daraus
(web/src/lib/deutschland.js). Die App am Handy macht dasselbe in
web/src/lokal/deutschland.js.

    {stand, erstellt, tage: [iso...], stationen: [[id, name, land, hoehe]],
     werte: {spalte: [[Wert je Tag] je Station]}, ausfaelle: {id: Text}}
"""

import datetime as dt
import os
import re
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

import daten
import dwd
import plausibel

TAGE = 7
SPALTEN = ["txk", "tmk", "tnk", "tgk", "rsk", "sdk", "shk", "fx", "fm", "nm", "upm", "pm", "vpm"]


def aktive_stationen() -> list[int]:
    html = dwd.holen("recent/").decode("latin-1")
    return sorted({int(m) for m in re.findall(r"tageswerte_KL_(\d{5})_akt\.zip", html)})


def _recent(sid):
    for versuch in range(4):
        try:
            return dwd.produkt(dwd.holen(dwd.recent_pfad(sid)))
        except dwd.Abruffehler:
            if versuch == 3:
                raise
            time.sleep(3 * (versuch + 1))
    return None


def aus_texten(texte: dict[int, bytes], stationen: dict[int, dict], tage=TAGE,
               ausfaelle=None) -> dict:
    """recent-Texte (produkt_klima_tag) je Station -> Format der Übersicht."""
    ausfaelle = dict(ausfaelle or {})
    with tempfile.TemporaryDirectory(prefix="deutschland-") as ordner:
        db = daten.Daten(os.path.join(ordner, "d.duckdb"))
        try:
            for sid, text in texte.items():
                try:
                    db.einlesen(sid, None, text, None)
                except Exception as fehler:                          # noqa: BLE001
                    ausfaelle[sid] = str(fehler)[:200]
            c = db._c()
            stand = c.execute("SELECT max(datum) FROM tag").fetchone()[0]
            if stand is None:
                raise RuntimeError("keine Station geladen")
            ab = stand - dt.timedelta(days=tage - 1)
            zeilen = c.execute(f"""
                SELECT station, datum, {", ".join(SPALTEN)}
                FROM {plausibel.rein("alle", "datum >= ?")}
                ORDER BY station, datum""", [ab]).fetchall()
        finally:
            db.schliessen()

    ids = sorted({z[0] for z in zeilen})
    stelle = {sid: i for i, sid in enumerate(ids)}
    werte = {s: [[None] * tage for _ in ids] for s in SPALTEN}
    for z in zeilen:
        i, t = stelle[z[0]], (z[1] - ab).days
        for k, s in enumerate(SPALTEN):
            v = z[2 + k]
            if v is not None:
                werte[s][i][t] = round(round(float(v), 9), 1)
    return {
        "stand": stand.isoformat(),
        "erstellt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "tage": [(ab + dt.timedelta(days=i)).isoformat() for i in range(tage)],
        "stationen": [[sid, stationen[sid]["name"], stationen[sid]["land"], stationen[sid]["hoehe"]]
                      for sid in ids],
        "werte": werte,
        "ausfaelle": {str(k): v for k, v in ausfaelle.items()},
    }


def laden(stationen: dict[int, dict], fortschritt=None, tage=TAGE) -> dict:
    """Alle aktiven Stationen vom DWD; stationen: id -> {name, land, hoehe}."""
    melden = fortschritt or (lambda text: None)
    anfang = time.time()
    aktiv = [sid for sid in aktive_stationen() if sid in stationen]
    texte, ausfaelle = {}, {}
    # 8 gleichzeitig: mit 16 setzte der DWD-Server Verbindungen zurück
    with ThreadPoolExecutor(max_workers=8) as pool:
        laeufe = [(sid, pool.submit(_recent, sid)) for sid in aktiv]
        for nr, (sid, lauf) in enumerate(laeufe, 1):
            try:
                texte[sid] = lauf.result()
            except Exception as fehler:                              # noqa: BLE001
                ausfaelle[sid] = str(fehler)[:200]
            if nr % 50 == 0:
                melden(f"{nr} von {len(aktiv)} Stationen geladen")
    melden("rechnet …")
    d = aus_texten(texte, stationen, tage, ausfaelle)
    melden(f"{len(d['stationen'])} Stationen in {time.time() - anfang:.0f} s")
    return d
