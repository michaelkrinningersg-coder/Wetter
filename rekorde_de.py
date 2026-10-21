"""Rekorde Deutschland: neue Rekorde aller aktiven DWD-Stationen der
letzten 12 Monate.

Ein Tag zählt, wenn sein Wert zu dem Zeitpunkt, als er gemessen wurde, in
der Reihe der Station so weit vorn lag, wie die Länge der Reihe erlaubt:

    unter  3 Jahren   gar nicht
    ab     3 Jahren   nur Platz 1 (neuer Allzeitrekord)
    ab    20 Jahren   Top 3
    ab    30 Jahren   Top 5
    ab    50 Jahren   Top 10

Länge der Reihe: vom ersten gemessenen Tag dieser Größe bis zu dem Tag.
Gleicher Wert wie ein früherer: der frühere bleibt vorn (der neue landet
dahinter) - sonst zählte z. B. jeder Tag mit gleicher Schneehöhe neu.
Kategorien wie in der Rekorde-Ansicht der Station (auswertung.REKORDE),
Werte bereinigt wie überall (plausibel.rein, QN alle).

Läuft täglich als GitHub-Aktion (.github/workflows/rekorde-de.yml) und legt
rekorde_de.json an die Freigabe "rekorde-de"; am PC kann die App dasselbe
selbst rechnen (Api.rekorde_de_rechnen).

    python rekorde_de.py rekorde_de.json [--zwischenspeicher ORDNER] [--tage 365]
"""

import argparse
import bisect
import datetime as dt
import json
import os
import re
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

import auswertung
import daten
import dwd

ADRESSE = ("https://github.com/michaelkrinningersg-coder/Wetter/releases/"
           "download/rekorde-de/rekorde_de.json")
TAGE = 365
TIEFE = 10  # mehr als Top 10 zählt nie


def erlaubt(jahre: float) -> int:
    """Wie viele Plätze eine Reihe dieser Länge vergibt (0 = keine)."""
    if jahre < 3:
        return 0
    return 1 if jahre < 20 else 3 if jahre < 30 else 5 if jahre < 50 else 10


def neue_rekorde(s: auswertung.Spalten, ab_ord: int, bis_ord: int) -> list[dict]:
    """Alle Tage zwischen ab_ord und bis_ord (Tage seit 1970), deren Wert
    beim Messen einen erlaubten Platz erreichte - je Kategorie."""
    aus = []
    for spalte, richtung, titel, einheit, faktor in auswertung.REKORDE:
        werte = getattr(s, spalte)
        vz = -1 if richtung == "hoch" else 1  # kleiner Schlüssel = besser
        beste = []      # sortiert: (Schlüssel, ord, i) der besten bisher
        erster = None
        for i in range(s.n):
            w = werte[i]
            if w is None:
                continue
            o = s.ord[i]
            if erster is None:
                erster = i
            schluessel = vz * w
            if ab_ord <= o <= bis_ord:
                jahre = (o - s.ord[erster] + 1) / 365.25
                n = erlaubt(jahre)
                # Platz: alle früheren, die mindestens so gut sind, stehen davor
                platz = bisect.bisect_right(beste, (schluessel, float("inf"), 0)) + 1
                if n and platz <= n:
                    eintrag = {
                        "_ord": o, "datum": s.iso(i), "spalte": spalte, "richtung": richtung,
                        "kategorie": titel, "einheit": einheit,
                        "wert": auswertung._r(w * faktor), "platz": platz, "von": n,
                        "seit": s.jahr[erster], "jahre": round(jahre, 1),
                    }
                    if beste:
                        # der bisherige Rekord (Platz 1 vor diesem Tag)
                        b = beste[0]
                        eintrag["bisher"] = [auswertung._r(vz * b[0] * faktor), s.iso(b[2])]
                    aus.append(eintrag)
            if len(beste) < TIEFE or schluessel < beste[-1][0]:
                bisect.insort(beste, (schluessel, o, i))
                del beste[TIEFE:]
    return aus


KALENDERTAG_JAHRE = 20   # so viele Jahre mit Wert an diesem Kalendertag vorher
KALENDERTAG_TAGE = 14    # Kalendertags-Rekorde der letzten 14 Tage (für die Meldungen)


def kalendertag_rekorde(s: auswertung.Spalten, ab_ord: int, bis_ord: int) -> list[dict]:
    """Tage zwischen ab_ord und bis_ord, deren Wert der beste je an diesem
    Kalendertag war (echt besser als alle früheren), wenn es den Kalendertag
    schon in mindestens KALENDERTAG_JAHRE Jahren mit Wert gab."""
    aus = []
    for spalte, richtung, titel, einheit, faktor in auswertung.REKORDE:
        werte = getattr(s, spalte)
        vz = -1 if richtung == "hoch" else 1
        beste = {}   # Kalendertag -> (Schlüssel, i)
        jahre = {}   # Kalendertag -> Anzahl Jahre mit Wert
        for i in range(s.n):
            w = werte[i]
            if w is None:
                continue
            k = s.monat[i] * 100 + s.tag[i]
            schluessel = vz * w
            vorher = beste.get(k)
            if ab_ord <= s.ord[i] <= bis_ord and jahre.get(k, 0) >= KALENDERTAG_JAHRE \
                    and schluessel < vorher[0]:
                aus.append({
                    "_ord": s.ord[i], "datum": s.iso(i), "spalte": spalte, "richtung": richtung,
                    "kategorie": titel, "einheit": einheit, "wert": auswertung._r(w * faktor),
                    "jahre": jahre[k], "bisher": [auswertung._r(vz * vorher[0] * faktor), s.iso(vorher[1])],
                })
            if vorher is None or schluessel < vorher[0]:
                beste[k] = (schluessel, i)
            jahre[k] = jahre.get(k, 0) + 1
    return aus


def aktive_stationen() -> list[int]:
    """Stationen mit recent-Archiv beim DWD."""
    html = dwd.holen("recent/").decode("latin-1")
    return sorted({int(m) for m in re.findall(r"tageswerte_KL_(\d{5})_akt\.zip", html)})


def _holen(pfad: str, versuche=3) -> bytes:
    """dwd.holen mit Wiederholung: bei 570 Stationen bricht die eine oder
    andere TLS-Verbindung des DWD-Servers ab."""
    for versuch in range(versuche):
        try:
            return dwd.holen(pfad)
        except dwd.Abruffehler:
            if versuch == versuche - 1:
                raise
            time.sleep(2 * (versuch + 1))
    raise AssertionError("unerreichbar")


def _archive(sid, hist_datei, zwischenspeicher):
    """hist (aus dem Zwischenspeicher, wenn schon da) und recent einer Station."""
    hist = None
    if hist_datei:
        pfad = os.path.join(zwischenspeicher, hist_datei) if zwischenspeicher else None
        if pfad and os.path.exists(pfad):
            with open(pfad, "rb") as datei:
                roh = datei.read()
        else:
            roh = _holen("historical/" + hist_datei)
            if pfad:
                with open(pfad + ".neu", "wb") as datei:
                    datei.write(roh)
                os.replace(pfad + ".neu", pfad)
        hist = dwd.produkt(roh)
    recent = dwd.produkt(_holen(dwd.recent_pfad(sid)))
    return hist, recent


def berechnen(tage=TAGE, zwischenspeicher=None, fortschritt=None, nur=None) -> dict:
    """Lädt alle aktiven Stationen (oder `nur` diese) und sammelt ihre
    neuen Rekorde."""
    melden = fortschritt or (lambda text: None)
    anfang = time.time()
    if zwischenspeicher:
        os.makedirs(zwischenspeicher, exist_ok=True)
    stationen = {s["id"]: s for s in dwd.stationsliste()}
    verzeichnis = dwd.hist_verzeichnis()
    aktiv = [sid for sid in aktive_stationen() if sid in stationen and (not nur or sid in nur)]
    if zwischenspeicher and not nur:
        # alte Jahreslieferungen weg: der DWD benennt hist-Dateien mit dem Enddatum
        behalten = {verzeichnis[sid] for sid in aktiv if sid in verzeichnis}
        for name in os.listdir(zwischenspeicher):
            if name.endswith(".zip") and name not in behalten:
                os.remove(os.path.join(zwischenspeicher, name))
    melden(f"{len(aktiv)} aktive Stationen")

    eintraege, kalendertag, fehler, stand, gezaehlt = [], [], {}, None, 0

    def auswerten(sid, hist, recent, ordner):
        """Eine Station: einlesen, ihre Rekorde im eigenen Fenster sammeln,
        dann weg damit - alle Stationen zugleich passten nicht in den Speicher."""
        pfad = os.path.join(ordner, f"{sid}.duckdb")
        db = daten.Daten(pfad)
        try:
            db.einlesen(sid, hist, recent, verzeichnis.get(sid))
            s = db.spalten(sid, "alle")
            if not s.n:
                return None, ([], [])
            letzter = s.ord[-1]
            # eigenes Fenster bis zum letzten Tag der Station; gekürzt wird
            # am Ende auf das gemeinsame (ab dem jüngsten Stand aller)
            return letzter, (neue_rekorde(s, letzter - tage + 1, letzter),
                             kalendertag_rekorde(s, letzter - KALENDERTAG_TAGE + 1, letzter))
        finally:
            db.schliessen()
            for rest in (pfad, pfad + ".wal"):
                if os.path.exists(rest):
                    os.remove(rest)

    with tempfile.TemporaryDirectory(prefix="rekorde-") as ordner, \
            ThreadPoolExecutor(max_workers=dwd.GLEICHZEITIG) as pool:
        offen = list(aktiv)
        laeufe = []  # höchstens doppelt so viele unterwegs wie Verbindungen
        while offen or laeufe:
            while offen and len(laeufe) < 2 * dwd.GLEICHZEITIG:
                sid = offen.pop(0)
                laeufe.append((sid, pool.submit(_archive, sid, verzeichnis.get(sid), zwischenspeicher)))
            sid, lauf = laeufe.pop(0)
            try:
                hist, recent = lauf.result()
                letzter, (liste, kt) = auswerten(sid, hist, recent, ordner)
                if letzter is not None:
                    stand = letzter if stand is None else max(stand, letzter)
                    st = stationen[sid]
                    for e in liste + kt:
                        e.update({"id": sid, "name": st["name"], "land": st["land"],
                                  "hoehe": st["hoehe"]})
                    eintraege.extend(liste)
                    kalendertag.extend(kt)
                    gezaehlt += 1
            except Exception as f:                                  # noqa: BLE001
                fehler[sid] = str(f)[:200]
            erledigt = len(aktiv) - len(offen) - len(laeufe)
            if erledigt % 50 == 0:
                melden(f"{erledigt} von {len(aktiv)} Stationen")

    if stand is None:
        raise RuntimeError("keine Station geladen")
    ab = stand - tage + 1
    eintraege = [e for e in eintraege if e.pop("_ord") >= ab]
    ab_kt = stand - KALENDERTAG_TAGE + 1
    kalendertag = [e for e in kalendertag if e.pop("_ord") >= ab_kt]
    kalendertag.sort(key=lambda e: (e["datum"], e["kategorie"], e["name"]))
    eintraege.sort(key=lambda e: (e["datum"], e["kategorie"], e["platz"], e["name"]),
                   reverse=False)
    stand_iso = (dt.date(1970, 1, 1) + dt.timedelta(days=stand)).isoformat()
    melden(f"{len(eintraege)} Rekorde in {time.time() - anfang:.0f} s")
    return {
        "stand": stand_iso,
        "ab": (dt.date(1970, 1, 1) + dt.timedelta(days=ab)).isoformat(),
        "erstellt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "stationen": gezaehlt,
        "regel": "unter 3 Jahren nichts, ab 3 Platz 1, ab 20 Top 3, ab 30 Top 5, ab 50 Top 10",
        "ausfaelle": fehler,  # Stationen, die sich nicht laden ließen
        "eintraege": eintraege,
        # Rekorde je Kalendertag (letzte 14 Tage) - für die Meldungen am Handy
        "kalendertag": kalendertag,
    }


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("ziel")
    p.add_argument("--zwischenspeicher")
    p.add_argument("--tage", type=int, default=TAGE)
    p.add_argument("--nur", help="nur diese Stationen, mit Komma (zum Ausprobieren)")
    a = p.parse_args(argv)
    nur = {int(x) for x in a.nur.split(",")} if a.nur else None
    ergebnis = berechnen(a.tage, a.zwischenspeicher, lambda t: print(t, flush=True), nur)
    with open(a.ziel + ".neu", "w", encoding="utf-8") as datei:
        json.dump(ergebnis, datei, ensure_ascii=False, separators=(",", ":"))
    os.replace(a.ziel + ".neu", a.ziel)
    print(f"{a.ziel}: {os.path.getsize(a.ziel) / 1024:.0f} KB, Stand {ergebnis['stand']}, "
          f"{len(ergebnis['ausfaelle'])} Stationen nicht geladen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
