"""
Wetter - die Datenbank
======================

DuckDB, eine Datei. Gewählt nach Messung mit 21,6 Mio. Stationstagen
(alle 1.560 Reihen): 166 MB statt 1,1 GB bei SQLite, Jahresmittel aller
Stationen in 22 ms statt 721 ms, Rekord je Station in 56 ms statt 1,8 s.
Eine Station zu lesen dauert ein paar Millisekunden.

Tabellen
--------
    station  die Stationsliste des DWD (1.386 Reihen)
    tag      ein Tag einer Station: tmk/txk/tnk roh, qn, quelle (0 hist, 1 recent)
    abruf    je geladener Station: Name des hist-Archivs, wann recent kam
    meta     Kleinkram: wann Stationsliste und Verzeichnis geholt wurden

Kein Primärschlüssel auf `tag`: ein Index kostet bei jedem Einfügen und
DuckDB braucht ihn zum Lesen nicht. Eingefügt wird je Station am Stück und
nach Datum sortiert, so bleiben die Blöcke einer Station beisammen.

Historisch gewinnt: recent wird nur nach dem letzten hist-Tag übernommen.
Für Göttingen deckten sich die 258 überlappenden Tage ohne Abweichung,
aber hist ist die geprüfte Fassung.

Jede Abfrage nimmt ihren eigenen Cursor - pywebview ruft aus Threads.
"""

from __future__ import annotations

import datetime as dt
import os
import re
import tempfile
import threading
import time

import duckdb

import auswertung
import plausibel

SCHEMA = """
CREATE TABLE IF NOT EXISTS station (
    id INTEGER PRIMARY KEY, name VARCHAR, land VARCHAR, hoehe INTEGER,
    lat DOUBLE, lon DOUBLE, von DATE, bis DATE);
CREATE TABLE IF NOT EXISTS tag (
    station INTEGER, datum DATE, tmk DOUBLE, txk DOUBLE, tnk DOUBLE,
    qn UTINYINT, quelle UTINYINT,
    fx DOUBLE, fm DOUBLE, rsk DOUBLE, rskf UTINYINT, sdk DOUBLE,
    shk DOUBLE, nm DOUBLE, vpm DOUBLE, pm DOUBLE, upm DOUBLE, tgk DOUBLE,
    qn3 UTINYINT);
CREATE TABLE IF NOT EXISTS abruf (
    station INTEGER PRIMARY KEY, hist_datei VARCHAR, recent_am DOUBLE);
CREATE TABLE IF NOT EXISTS meta (k VARCHAR PRIMARY KEY, v VARCHAR);
"""

# Nur Jahre mit so vielen Tageswerten zählen als Jahr.
JAHR_MIN_TAGE = 330
NORMAL_VON, NORMAL_BIS = 1991, 2020
GLAETTUNG = 15                  # Jahre je Seite: Mittel über 31 Jahre
SPALTEN = {"m": "tmk", "x": "txk", "n": "tnk"}
PROGNOSE_JAHRE = 30             # Vergleichsjahre vor dem laufenden
# Die Monatstabelle: alle Größen der Tagesarchive, in Leserichtung
MONAT_SPALTEN = ["tmk", "txk", "tnk", "tgk", "fm", "fx", "rsk", "rskf",
                 "sdk", "shk", "nm", "upm", "vpm", "pm"]
SUMMEN = {"rsk", "sdk"}         # im Monat summiert statt gemittelt
WIND = {"fm", "fx"}

# Die übrigen Größen der Tagesarchive: DWD-Spalte -> Spalte in `tag`.
# Wind in m/s wie geliefert; km/h rechnet erst die Anzeige.
WEITERE = {"FX": "fx", "FM": "fm", "RSK": "rsk", "RSKF": "rskf",
           "SDK": "sdk", "SHK_TAG": "shk", "NM": "nm", "VPM": "vpm",
           "PM": "pm", "UPM": "upm", "TGK": "tgk"}
SCHEMA_STAND = "2"

_NAME = re.compile(r"^[A-Za-z0-9_]+$")
_TYP = {"MESS_DATUM": "VARCHAR", "QN_4": "INTEGER", "QN_3": "INTEGER",
        "RSKF": "INTEGER", "TMK": "DOUBLE", "TXK": "DOUBLE", "TNK": "DOUBLE",
        **{k: "DOUBLE" for k in WEITERE if k != "RSKF"}}


def _tag_index(datum_sql: str) -> str:
    """0..365 - der Kalendertag, in jedem Jahr gleich: der 1. März ist
    immer 60, der 29. Februar 59. Sonst verrutscht in Schaltjahren alles
    ab März um einen Tag gegen das Normal."""
    return (f"(dayofyear(make_date(2000, month({datum_sql}), "
            f"day({datum_sql}))) - 1)")


def _r(wert, stellen=1):
    return None if wert is None else round(float(wert), stellen)


class Daten:
    def __init__(self, pfad: str):
        self.pfad = pfad
        self._con = duckdb.connect(pfad)
        self._schreiben = threading.Lock()
        self._spalten: dict = {}            # (Station, QN) -> auswertung.Spalten
        self._umbauen()
        self._con.execute(SCHEMA)
        self._con.execute("INSERT OR REPLACE INTO meta VALUES ('schema', ?)",
                          [SCHEMA_STAND])

    def _umbauen(self):
        """Eine Datenbank aus einem älteren Stand: Tage und Abrufe weg,
        die Stationen werden beim nächsten Öffnen neu geladen. Die
        Stationsliste und die Einstellungen bleiben."""
        spalten = {z[0] for z in self._con.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'tag'").fetchall()}
        if spalten and "qn3" not in spalten:
            self._con.execute("DROP TABLE tag; DROP TABLE IF EXISTS abruf")

    def schliessen(self):
        self._con.close()

    def _c(self):
        return self._con.cursor()

    # ---------------------------------------------------------- Kleinkram
    def meta(self, k, vorgabe=None):
        z = self._c().execute("SELECT v FROM meta WHERE k = ?", [k]).fetchone()
        return z[0] if z else vorgabe

    def meta_setzen(self, k, v):
        with self._schreiben:
            self._c().execute("INSERT OR REPLACE INTO meta VALUES (?, ?)",
                              [k, str(v)])

    # ----------------------------------------------------------- Stationen
    def stationen_setzen(self, stationen: list[dict]):
        if not stationen:
            return
        zeilen = [(s["id"], s["name"], s["land"], s["hoehe"], s["lat"],
                   s["lon"], _datum(s["von"]), _datum(s["bis"]))
                  for s in stationen]
        with self._schreiben:
            c = self._c()
            c.execute("BEGIN")
            c.execute("DELETE FROM station")
            c.executemany("INSERT INTO station VALUES (?,?,?,?,?,?,?,?)",
                          zeilen)
            c.execute("COMMIT")

    def stationen(self) -> list[list]:
        """Kompakt für die Suche: [id, name, land, hoehe, von, bis, tage]."""
        zeilen = self._c().execute("""
            SELECT s.id, s.name, s.land, s.hoehe, year(s.von), s.bis,
                   coalesce(t.n, 0)
            FROM station s
            LEFT JOIN (SELECT station, count(*) n FROM tag GROUP BY station) t
                   ON t.station = s.id
            ORDER BY s.name""").fetchall()
        return [[i, n, l, h, v, b.isoformat() if b else None, t]
                for i, n, l, h, v, b, t in zeilen]

    def station(self, sid) -> dict | None:
        z = self._c().execute(
            "SELECT id, name, land, hoehe, lat, lon, von, bis FROM station "
            "WHERE id = ?", [sid]).fetchone()
        if not z:
            return None
        return {"id": z[0], "name": z[1], "land": z[2], "hoehe": z[3],
                "lat": z[4], "lon": z[5],
                "von": z[6].isoformat() if z[6] else None,
                "bis": z[7].isoformat() if z[7] else None}

    # ------------------------------------------------------------ Abruf
    def abruf(self, sid) -> dict | None:
        z = self._c().execute(
            "SELECT hist_datei, recent_am FROM abruf WHERE station = ?",
            [sid]).fetchone()
        return {"hist_datei": z[0], "recent_am": z[1]} if z else None

    def geladene(self) -> list[int]:
        return [z[0] for z in self._c().execute(
            "SELECT station FROM abruf ORDER BY station").fetchall()]

    # ---------------------------------------------------------- Einlesen
    def einlesen(self, sid, hist: bytes | None, recent: bytes | None,
                 hist_datei: str | None, nur_recent=False):
        """Schreibt die Tage einer Station. Ohne `nur_recent` wird die
        Station ganz ersetzt; mit nur der recent-Teil hinter hist."""
        with tempfile.TemporaryDirectory(prefix="wetter-") as ordner, \
                self._schreiben:
            c = self._c()
            c.execute("BEGIN")
            try:
                if nur_recent:
                    c.execute("DELETE FROM tag WHERE station = ? AND quelle = 1",
                              [sid])
                else:
                    c.execute("DELETE FROM tag WHERE station = ?", [sid])
                    if hist:
                        self._csv(c, ordner, "hist", hist, sid, 0, None)
                if recent:
                    ende = c.execute(
                        "SELECT max(datum) FROM tag WHERE station = ? "
                        "AND quelle = 0", [sid]).fetchone()[0]
                    self._csv(c, ordner, "recent", recent, sid, 1, ende)
                c.execute("""
                    INSERT INTO abruf VALUES (?, ?, ?)
                    ON CONFLICT (station) DO UPDATE SET
                        hist_datei = coalesce(excluded.hist_datei, abruf.hist_datei),
                        recent_am = coalesce(excluded.recent_am, abruf.recent_am)
                    """, [sid, None if nur_recent else (hist_datei or ""),
                          time.time() if recent else None])
                c.execute("COMMIT")
            except Exception:
                c.execute("ROLLBACK")
                raise
            finally:
                self._spalten = {k: v for k, v in self._spalten.items() if k[0] != sid}

    @staticmethod
    def _csv(c, ordner, art, roh: bytes, sid, quelle, nach):
        """produkt_klima_tag_*.txt -> tag, mit festen Typen.

        Die Typerkennung taugt hier nicht: Spalten, die jahrzehntelang
        nur -999 enthalten, hält sie für Ganzzahlen und scheitert später
        an "7.8". Die Namen sind gepolstert ("  TMK"), -999 heißt fehlt.
        """
        kopf = roh.split(b"\n", 1)[0].decode("latin-1").strip().split(";")
        namen = [k.strip() for k in kopf]
        if not all(_NAME.match(n) for n in namen) or \
                not {"MESS_DATUM", "TMK", "TXK", "TNK"} <= set(namen):
            raise ValueError(f"{art}: unerwarteter Kopf {kopf!r}")
        spalten = "{" + ", ".join(f"'{n}': '{_TYP.get(n, 'VARCHAR')}'"
                                  for n in namen) + "}"
        def wert(dwd_name):
            return f"nullif({dwd_name}, -999)" if dwd_name in namen else "NULL"
        weitere = ", ".join(wert(k) for k in WEITERE)
        pfad = os.path.join(ordner, art + ".csv")
        with open(pfad, "wb") as datei:
            datei.write(roh)
        c.execute(f"""
            INSERT INTO tag
            SELECT ?, strptime(trim(MESS_DATUM), '%Y%m%d')::DATE,
                   nullif(TMK, -999), nullif(TXK, -999), nullif(TNK, -999),
                   {wert("QN_4")}, ?, {weitere}, {wert("QN_3")}
            FROM read_csv(?, delim=';', header=true, auto_detect=false,
                          columns={spalten}, null_padding=true)
            WHERE trim(MESS_DATUM) <> ''
              AND (?::DATE IS NULL
                   OR strptime(trim(MESS_DATUM), '%Y%m%d')::DATE > ?::DATE)
            ORDER BY 2
            """, [sid, quelle, pfad, nach, nach])

    # --------------------------------------------------------- Abfragen
    def zeitraum(self, sid) -> dict:
        z = self._c().execute(
            "SELECT min(datum), max(datum), count(*) FROM tag "
            "WHERE station = ?", [sid]).fetchone()
        return {"von": z[0].isoformat() if z[0] else None,
                "bis": z[1].isoformat() if z[1] else None, "tage": z[2]}

    def bilanz(self, sid, stufe) -> dict:
        c = self._c()
        z = c.execute(plausibel.bilanz_sql(stufe), [sid]).fetchone()
        namen = [d[0] for d in c.description]
        return dict(zip(namen, z))

    def jahre(self, sid, stufe) -> list[int]:
        return [z[0] for z in self._c().execute(f"""
            SELECT DISTINCT year(datum) FROM {plausibel.rein(stufe, 'station = ?')}
            WHERE tmk IS NOT NULL OR txk IS NOT NULL OR tnk IS NOT NULL
            ORDER BY 1 DESC""", [sid]).fetchall()]

    def jahresband(self, sid, jahr: int | None, stufe) -> dict:
        """Ein Jahr Tag für Tag, gegen das Normal 1991-2020.

        Normal je Kalendertag: alle Tage 1991-2020 im Fenster +-7 Tage,
        daraus das mittlere Tief, Mittel und Hoch sowie das 10. und 90.
        Perzentil der Tagesmittel.
        """
        c = self._c()
        r = plausibel.rein(stufe, "station = ?")
        letzter = c.execute(f"SELECT max(datum) FROM {r} WHERE tmk IS NOT NULL",
                            [sid]).fetchone()[0]
        if letzter is None:
            return {"leer": True}
        if jahr is None:
            jahr = letzter.year
        jahr = int(jahr)
        tage = c.execute(f"""
            SELECT {_tag_index('datum')}, tmk, txk, tnk FROM {r}
            WHERE year(datum) = ? ORDER BY datum""", [sid, jahr]).fetchall()
        tage = [[i, _r(m), _r(x), _r(n)] for i, m, x, n in tage]

        normal_jahre = c.execute(f"""
            SELECT count(DISTINCT year(datum)) FROM {r}
            WHERE year(datum) BETWEEN {NORMAL_VON} AND {NORMAL_BIS}
              AND tmk IS NOT NULL""", [sid]).fetchone()[0]
        normal = []
        if normal_jahre:
            zeilen = c.execute(f"""
                WITH b AS (
                    SELECT {_tag_index('datum')} AS k, tmk, txk, tnk FROM {r}
                    WHERE year(datum) BETWEEN {NORMAL_VON} AND {NORMAL_BIS}),
                p AS (SELECT (k + o + 366) % 366 AS k, tmk, txk, tnk
                      FROM b, range(-7, 8) t(o))
                SELECT k, avg(tmk), avg(txk), avg(tnk),
                       quantile_cont(tmk, 0.1), quantile_cont(tmk, 0.9)
                FROM p GROUP BY k ORDER BY k""", [sid]).fetchall()
            normal = [[k, _r(m, 2), _r(x, 2), _r(n, 2), _r(a, 2), _r(b, 2)]
                      for k, m, x, n, a, b in zeilen]

        # Monate des Jahres gegen den Monat im Normal
        monate = c.execute(f"""
            WITH j AS (SELECT month(datum) mo, avg(tmk) m, count(tmk) n
                       FROM {r} WHERE year(datum) = ? GROUP BY 1),
                 nm AS (SELECT month(datum) mo, avg(tmk) m FROM {r}
                        WHERE year(datum) BETWEEN {NORMAL_VON} AND {NORMAL_BIS}
                        GROUP BY 1)
            SELECT j.mo, j.m, j.n, nm.m FROM j LEFT JOIN nm USING (mo)
            ORDER BY j.mo""", [sid, jahr, sid]).fetchall()
        monate = [{"mo": mo, "m": _r(m), "tage": n, "norm": _r(nm)}
                  for mo, m, n, nm in monate]

        # Bis heute: dasselbe Stück jedes anderen Jahres, gereiht
        ende = letzter if jahr == letzter.year else dt.date(jahr, 12, 31)
        bis_md = ende.month * 100 + ende.day
        spanne = (ende - dt.date(jahr, 1, 1)).days + 1
        reihe = c.execute(f"""
            SELECT year(datum) y, avg(tmk) m FROM {r}
            WHERE month(datum) * 100 + day(datum) <= ? AND tmk IS NOT NULL
            GROUP BY 1 HAVING count(*) >= ?
            ORDER BY m DESC""", [sid, bis_md, 0.9 * spanne]).fetchall()
        platz = next((i + 1 for i, (y, _) in enumerate(reihe) if y == jahr),
                     None)
        eigen = c.execute(f"""
            SELECT avg(tmk), count(tmk) FROM {r}
            WHERE year(datum) = ? AND datum <= ?""",
                          [sid, jahr, ende]).fetchone()

        return {
            "jahr": jahr, "letzter": letzter.isoformat(),
            "laufend": jahr == letzter.year,
            "ende": ende.isoformat(),
            "tage": tage, "normal": normal, "normal_jahre": normal_jahre,
            "monate": monate,
            "bisher": {"m": _r(eigen[0], 2), "tage": eigen[1],
                       "platz": platz, "von": len(reihe)},
            "prognose": (self._prognose(c, r, sid, letzter)
                         if jahr == letzter.year else None),
        }

    # ----------------------------------------------------------- Prognose
    def _prognose(self, c, r, sid, letzter: dt.date) -> dict | None:
        """Wo landet das Jahresmittel am 31.12.?

        Bisher gemessen plus der Rest des Jahres. Für den Rest nimmt jedes
        der letzten 30 Jahre sein eigenes Mittel vom Tag nach `letzter` bis
        zum 31.12.; davon das 10., 50. und 90. Perzentil. (So entschieden:
        die letzten 30 Jahre, damit die Erwärmung drin ist.) Pro Tag ein
        Perzentil zu summieren gäbe ein viel zu breites Band - dass jeder
        Tag bis Silvester zu den kältesten zehn Prozent gehört, kommt nicht
        vor.

        Nur für das laufende Kalenderjahr, und nur wenn der Rest in einem
        Vergleichsjahr zu mindestens 90 % gemessen ist.
        """
        jahr = letzter.year
        if jahr != heute().year:
            return None
        jahresende = dt.date(jahr, 12, 31)
        rest = (jahresende - letzter).days
        tage_im_jahr = jahresende.timetuple().tm_yday
        bisher_tage = tage_im_jahr - rest
        eigen = c.execute(f"""
            SELECT avg(tmk), count(tmk) FROM {r}
            WHERE year(datum) = ? AND datum <= ?""",
                          [sid, jahr, letzter]).fetchone()
        if eigen[0] is None or eigen[1] < 0.9 * bisher_tage:
            return None
        if rest == 0:
            q = [eigen[0]] * 3
            vergleich = 0
        else:
            z = c.execute(f"""
                WITH j AS (SELECT year(datum) y, avg(tmk) m, count(tmk) n
                           FROM {r}
                           WHERE year(datum) BETWEEN ? AND ?
                             AND month(datum) * 100 + day(datum) > ?
                           GROUP BY 1)
                SELECT quantile_cont(m, [0.1, 0.5, 0.9]), count(*)
                FROM j WHERE n >= ?""",
                          [sid, jahr - PROGNOSE_JAHRE, jahr - 1,
                           letzter.month * 100 + letzter.day,
                           0.9 * rest]).fetchone()
            if not z[1]:
                return None
            vergleich = z[1]
            q = [(eigen[0] * bisher_tage + w * rest) / tage_im_jahr
                 for w in z[0]]
        volle = [z[0] for z in c.execute(f"""
            SELECT avg(tmk) FROM {r} WHERE year(datum) <> ?
            GROUP BY year(datum) HAVING count(tmk) >= {JAHR_MIN_TAGE}""",
                                          [sid, jahr]).fetchall()]

        def platz(wert):
            return 1 + sum(1 for v in volle if v > wert)

        return {"tief": _r(q[0], 2), "mitte": _r(q[1], 2), "hoch": _r(q[2], 2),
                "platz": platz(q[1]), "platz_hoch": platz(q[2]),
                "platz_tief": platz(q[0]), "von": len(volle) + 1,
                "vergleichsjahre": vergleich,
                "jahre": [jahr - PROGNOSE_JAHRE, jahr - 1],
                "rest_tage": rest}

    # ---------------------------------------------------------- Rangliste
    def rangliste(self, sid, modus: str, mit_prognose: bool, stufe) -> dict:
        """Alle Jahre nach Mittel, wärmstes zuerst.

        modus "heute": jedes Jahr vom 1.1. bis zum selben Kalendertag wie
        der letzte Messtag (mindestens 90 % gemessen).
        modus "jahr": ganze Jahre (mindestens 330 Tage). Das laufende Jahr
        ist dann nur mit Prognose dabei - als Mitte des Bands.
        Abweichung gegen das Mittel derselben Spanne 1991-2020.
        """
        c = self._c()
        r = plausibel.rein(stufe, "station = ?")
        letzter = c.execute(f"SELECT max(datum) FROM {r} WHERE tmk IS NOT NULL",
                            [sid]).fetchone()[0]
        if letzter is None:
            return {"zeilen": []}
        if modus == "heute":
            bis_md = letzter.month * 100 + letzter.day
            spanne = (letzter - dt.date(letzter.year, 1, 1)).days + 1
            zeilen = c.execute(f"""
                SELECT year(datum), avg(tmk), count(tmk) FROM {r}
                WHERE month(datum) * 100 + day(datum) <= ?
                GROUP BY 1 HAVING count(tmk) >= ?""",
                               [sid, bis_md, 0.9 * spanne]).fetchall()
        else:
            modus = "jahr"
            zeilen = c.execute(f"""
                SELECT year(datum), avg(tmk), count(tmk) FROM {r}
                WHERE year(datum) <> ?
                GROUP BY 1 HAVING count(tmk) >= {JAHR_MIN_TAGE}""",
                               [sid, letzter.year]).fetchall()
        liste = [{"jahr": y, "m": m, "tage": n} for y, m, n in zeilen]
        prognose = None
        if modus == "jahr" and mit_prognose:
            prognose = self._prognose(c, r, sid, letzter)
            if prognose:
                liste.append({"jahr": letzter.year, "m": prognose["mitte"],
                              "tage": None, "prognose": True,
                              "tief": prognose["tief"],
                              "hoch": prognose["hoch"]})
        normale = [z["m"] for z in liste
                   if NORMAL_VON <= z["jahr"] <= NORMAL_BIS]
        normal = sum(normale) / len(normale) if normale else None
        liste.sort(key=lambda z: -z["m"])
        for i, z in enumerate(liste):
            z["platz"] = i + 1
            z["abw"] = _r(z["m"] - normal, 2) if normal is not None else None
            z["m"] = _r(z["m"], 2)
        return {"zeilen": liste, "modus": modus, "letzter": letzter.isoformat(),
                "jahr": letzter.year, "normal": _r(normal, 2),
                "normal_jahre": len(normale), "prognose": prognose}

    # -------------------------------------------------------------- Monat
    def monat(self, sid, jahr, monat, stufe) -> dict:
        """Ein Monat Tag für Tag mit allen Größen, dazu Summe und Normal.

        Summe: Mittel über die Tage, bei Niederschlag und Sonne die Summe.
        Normal: derselbe Monat 1991-2020, und zwar dieselben Tage - im
        laufenden Monat bis zum letzten Messtag, sonst hinkt die Summe des
        halben Monats gegen die eines ganzen.
        Wind kommt vom DWD in m/s und geht hier als km/h hinaus.
        """
        c = self._c()
        r = plausibel.rein(stufe, "station = ?")
        z = c.execute(f"SELECT min(datum), max(datum) FROM {r} "
                      "WHERE tmk IS NOT NULL OR rsk IS NOT NULL", [sid]).fetchone()
        if z[1] is None:
            return {"leer": True}
        erster, letzter = z
        if not jahr or not monat:
            jahr, monat = letzter.year, letzter.month
        jahr, monat = int(jahr), int(monat)
        sp = ", ".join(MONAT_SPALTEN)
        tage = c.execute(f"""
            SELECT day(datum), {_tag_index('datum')}, {sp} FROM {r}
            WHERE year(datum) = ? AND month(datum) = ? ORDER BY datum""",
                         [sid, jahr, monat]).fetchall()
        bis_tag = max((t[0] for t in tage), default=31)
        # Tagesnormal des Mittels für die Farbe: +-7 Tage, 1991-2020
        normal_tag = dict(c.execute(f"""
            WITH b AS (SELECT {_tag_index('datum')} AS k, tmk FROM {r}
                       WHERE year(datum) BETWEEN {NORMAL_VON} AND {NORMAL_BIS}),
            p AS (SELECT (k + o + 366) % 366 AS k, tmk FROM b, range(-7, 8) t(o))
            SELECT k, avg(tmk) FROM p WHERE k IN (SELECT unnest(?::INTEGER[]))
            GROUP BY k""", [sid, [t[1] for t in tage]]).fetchall())

        def mittel_oder_summe(spalte):
            return f"sum({spalte})" if spalte in SUMMEN else f"avg({spalte})"

        werte_spalten = [s for s in MONAT_SPALTEN if s != "rskf"]
        z = c.execute(f"""
            SELECT {", ".join(mittel_oder_summe(s) for s in werte_spalten)},
                   {", ".join(f"count({s})" for s in werte_spalten)}
            FROM {r} WHERE year(datum) = ? AND month(datum) = ?""",
                      [sid, jahr, monat]).fetchone()
        n = len(werte_spalten)
        summe = dict(zip(werte_spalten, z[:n]))
        anzahl = dict(zip(werte_spalten, z[n:]))

        normal = c.execute(f"""
            WITH b AS (SELECT * FROM {r}
                       WHERE year(datum) BETWEEN {NORMAL_VON} AND {NORMAL_BIS}
                         AND month(datum) = ? AND day(datum) <= ?),
            j AS (SELECT year(datum) y,
                         {", ".join(f"sum({s}) AS {s}, count({s}) AS n_{s}"
                                    for s in SUMMEN)}
                  FROM b GROUP BY 1)
            SELECT {", ".join(
                f"(SELECT avg({s}) FROM j WHERE n_{s} >= 0.9 * ?)"
                if s in SUMMEN else f"(SELECT avg({s}) FROM b)"
                for s in werte_spalten)},
                   (SELECT count(DISTINCT year(datum)) FROM b
                    WHERE tmk IS NOT NULL)""",
                           [sid, monat, bis_tag]
                           + [bis_tag] * len(SUMMEN)).fetchone()
        normal_jahre = normal[-1]
        normal = dict(zip(werte_spalten, normal[:-1]))

        def ausgabe(spalte, wert):
            if wert is None:
                return None
            if spalte in WIND:
                return _r(wert * 3.6)
            if spalte == "rskf":
                return int(wert)
            return _r(wert)

        zeilen = []
        for t in tage:
            werte = dict(zip(MONAT_SPALTEN, t[2:]))
            nm = normal_tag.get(t[1])
            zeilen.append({
                "tag": t[0],
                "werte": {s: ausgabe(s, w) for s, w in werte.items()},
                "abw": _r(werte["tmk"] - nm) if nm is not None
                and werte["tmk"] is not None else None})
        return {
            "jahr": jahr, "monat": monat, "bis_tag": bis_tag,
            "erster": erster.isoformat(), "letzter": letzter.isoformat(),
            "spalten": MONAT_SPALTEN, "summen": sorted(SUMMEN),
            "zeilen": zeilen,
            "summe": {s: ausgabe(s, w) for s, w in summe.items()},
            "anzahl": anzahl,
            "normal": {s: ausgabe(s, w) for s, w in normal.items()},
            "normal_jahre": normal_jahre,
        }

    def zeitreihe(self, sid, groesse: str, aufloesung: str, stufe) -> dict:
        """Eine Größe über die ganze Reihe: Tag, Monat oder Jahr.

        Zeit als Unix-Sekunden der Mitte des Zeitraums. Jahre und Monate
        zählen nur mit mindestens 90 % gemessener Tage (330 je Jahr).
        Bei Tagen sind Sprünge > 15 K zum Vortag markiert.
        """
        sp = SPALTEN.get(groesse, "tmk")
        c = self._c()
        r = plausibel.rein(stufe, "station = ?")
        if aufloesung == "tag":
            zeilen = c.execute(f"""
                SELECT epoch(datum)::BIGINT + 43200, {sp},
                       CASE WHEN lag(datum) OVER w = datum - 1
                             AND abs({sp} - lag({sp}) OVER w) > {plausibel.SPRUNG}
                            THEN lag({sp}) OVER w END
                FROM {r} WHERE {sp} IS NOT NULL
                WINDOW w AS (ORDER BY datum)
                ORDER BY datum""", [sid]).fetchall()
            t, v = _mit_luecken(zeilen, 86400)
            spruenge = [[z[0], _r(z[1]), _r(z[2])] for z in zeilen
                        if z[2] is not None]
            return {"t": t, "v": v, "glatt": None, "spruenge": spruenge}
        if aufloesung == "monat":
            zeilen = c.execute(f"""
                SELECT epoch(date_trunc('month', datum) + INTERVAL 14 DAY)::BIGINT,
                       avg({sp})
                FROM {r} WHERE {sp} IS NOT NULL
                GROUP BY date_trunc('month', datum)
                HAVING count(*) >= 0.9 * day(last_day(min(datum)))
                ORDER BY 1""", [sid]).fetchall()
            t, v = _mit_luecken(zeilen, 31 * 86400, 2)
            return {"t": t, "v": v, "glatt": None, "spruenge": []}
        zeilen = c.execute(f"""
            WITH j AS (SELECT year(datum) y, avg({sp}) m FROM {r}
                       WHERE {sp} IS NOT NULL GROUP BY 1
                       HAVING count(*) >= {JAHR_MIN_TAGE})
            SELECT y, m, avg(m) OVER (ORDER BY y RANGE BETWEEN {GLAETTUNG}
                                      PRECEDING AND {GLAETTUNG} FOLLOWING)
            FROM j ORDER BY y""", [sid]).fetchall()
        return {"t": [_jahresmitte(z[0]) for z in zeilen],
                "j": [z[0] for z in zeilen],
                "v": [_r(z[1], 2) for z in zeilen],
                "glatt": [_r(z[2], 2) for z in zeilen], "spruenge": []}

    # ------------------------------------------------------ Auswertungen
    def spalten(self, sid, stufe) -> auswertung.Spalten:
        """Die bereinigten Tage einer Station als Spalten - gemerkt, bis die
        Station neu eingelesen wird."""
        schluessel = (int(sid), plausibel.qn_min(stufe))
        if schluessel not in self._spalten:
            namen = ["tmk", "txk", "tnk", "fx", "fm", "rsk", "rskf", "sdk",
                     "shk", "nm", "vpm", "pm", "upm", "tgk"]
            zeilen = self._c().execute(
                f"SELECT (datum - DATE '1970-01-01')::INTEGER, year(datum), "
                f"month(datum), day(datum), {', '.join(namen)} FROM "
                f"{plausibel.rein(stufe, 'station = ?')} ORDER BY datum",
                [int(sid)]).fetchall()
            self._spalten[schluessel] = auswertung.Spalten(zeilen, namen)
        return self._spalten[schluessel]

    def auswertung(self, sid, art: str, stufe, optionen: dict | None = None) -> dict:
        """Eine der Auswertungen aus auswertung.py für eine Station."""
        s = self.spalten(sid, stufe)
        o = optionen or {}
        if not s.n:
            return {"leer": True}
        if art == "rekorde":
            return auswertung.rekorde(s)
        if art == "geschichte":
            d = o.get("datum")
            return auswertung.geschichte(s, dt.date.fromisoformat(d) if d else None)
        if art == "kenntage":
            return auswertung.kenntage(s)
        if art == "wellen":
            return auswertung.wellen(s, o.get("art", "normal"), o.get("heiss", 30),
                                     o.get("kalt", 0), o.get("min_tage", 3))
        if art == "streifen":
            return auswertung.klimastreifen(s)
        if art in ("niederschlag", "sonne"):
            return auswertung.summen(s, "rsk" if art == "niederschlag" else "sdk", o.get("jahr"))
        if art == "schnee":
            return auswertung.schnee(s)
        if art == "wind":
            return auswertung.wind(s)
        if art == "frost":
            return auswertung.frost(s)
        if art == "prognose_verlauf":
            return auswertung.prognose_verlauf(s, heute())
        raise ValueError(f"Unbekannte Auswertung: {art}")

    def rekorde(self, sid, stufe) -> dict:
        c = self._c()
        r = plausibel.rein(stufe, "station = ?")
        heiss = c.execute(f"SELECT txk, datum FROM {r} WHERE txk IS NOT NULL "
                          "ORDER BY txk DESC, datum LIMIT 1", [sid]).fetchone()
        kalt = c.execute(f"SELECT tnk, datum FROM {r} WHERE tnk IS NOT NULL "
                         "ORDER BY tnk, datum LIMIT 1", [sid]).fetchone()
        return {"heiss": [_r(heiss[0]), heiss[1].isoformat()] if heiss else None,
                "kalt": [_r(kalt[0]), kalt[1].isoformat()] if kalt else None}


def heute() -> dt.date:
    """Eigene Funktion, damit Tests ein anderes Heute setzen können."""
    return dt.date.today()


def _datum(text: str):
    try:
        return dt.date(int(text[:4]), int(text[4:6]), int(text[6:8]))
    except (TypeError, ValueError):
        return None


def _mit_luecken(zeilen, schritt: int, stellen=1):
    """Zeit und Wert; wo mehr als ein Schritt fehlt, ein Punkt ohne Wert -
    sonst zieht die Linie quer über Jahre ohne Messung."""
    t, v = [], []
    for z in zeilen:
        if t and z[0] - t[-1] > schritt:
            t.append(t[-1] + schritt)
            v.append(None)
        t.append(z[0])
        v.append(_r(z[1], stellen))
    return t, v


def _jahresmitte(jahr: int) -> int:
    return int(dt.datetime(jahr, 7, 2, tzinfo=dt.timezone.utc).timestamp())
