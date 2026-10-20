"""
Wetter - Auswertungen über die ganze Reihe einer Station
========================================================

Rekorde, Heute in der Geschichte, Kenntage, Wellen, Klimastreifen,
Niederschlag, Sonne, Schnee, Wind, Frost und der Verlauf der Prognose.

Gerechnet wird in Schleifen über die bereinigten Spalten einer Station
(`Spalten`), nicht in SQL: so steht dieselbe Rechnung Zeile für Zeile in
web/src/lokal/auswertung.js, und tests/paritaet.py prüft, dass beide
dasselbe liefern. Eine Station hat höchstens 60.000 Tage - jede Auswertung
braucht damit wenige Millisekunden.

Grenzen (so entschieden bzw. die üblichen meteorologischen):

    Sommertag      Höchstwert >= 25 °C       Frosttag    Tiefstwert < 0 °C
    heißer Tag     Höchstwert >= 30 °C       Eistag      Höchstwert < 0 °C
    Tropennacht    Tiefstwert >= 20 °C       Bodenfrost  Erdboden 5 cm < 0 °C
    Regentag       Niederschlag >= 0,1 mm    Trockentag  < 0,1 mm
    Schneetag      Schneehöhe >= 1 cm        Winter      1. Okt. - 30. Apr.
    Sturmtag       Böe >= 75 km/h            Orkanböe    >= 118 km/h
    Frost          letzter vor dem 1. Juli, erster ab dem 1. Juli

    Wellen, drei Arten (Vorgabe: gegen das Normal):
      fest    Hitze: >= 3 Tage Höchstwert >= 30 °C; Kälte: >= 3 Tage
              Höchstwert < 0 °C
      eigen   Schwellen und Mindestdauer frei gewählt
      normal  >= 5 Tage Tagesmittel über dem 90-%-Wert bzw. unter dem
              10-%-Wert des Normals 1991-2020 für den Kalendertag
"""

from __future__ import annotations

import datetime as dt
import heapq

# Vergleichszeitraum: 30 Jahre ab nv, wählbar je 10 Jahre früher
NORMAL_VON, NORMAL_BIS = 1991, 2020
NORMALE = (1991, 1981, 1971, 1961)
JAHR_MIN = 330
PROGNOSE_JAHRE = 30
MONATSANFANG = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]

# Rekorde: (Spalte, Richtung, Titel, Einheit, Faktor für die Anzeige)
REKORDE = [
    ("txk", "hoch", "Höchstwert", "°C", 1), ("tnk", "tief", "Tiefstwert", "°C", 1),
    ("tmk", "hoch", "wärmstes Tagesmittel", "°C", 1), ("tmk", "tief", "kältestes Tagesmittel", "°C", 1),
    ("tnk", "hoch", "wärmste Nacht", "°C", 1), ("txk", "tief", "kältester Höchstwert", "°C", 1),
    ("rsk", "hoch", "Niederschlag", "mm", 1), ("fx", "hoch", "Böe", "km/h", 3.6),
    ("sdk", "hoch", "Sonnenschein", "h", 1), ("shk", "hoch", "Schneehöhe", "cm", 1),
    ("tgk", "tief", "Erdbodenminimum", "°C", 1),
]

KENNTAGE = [
    ("sommer", "Sommertage", "txk", lambda v: v >= 25),
    ("heiss", "heiße Tage", "txk", lambda v: v >= 30),
    ("tropen", "Tropennächte", "tnk", lambda v: v >= 20),
    ("frost", "Frosttage", "tnk", lambda v: v < 0),
    ("eis", "Eistage", "txk", lambda v: v < 0),
    ("bodenfrost", "Bodenfrost", "tgk", lambda v: v < 0),
]

STURM = 75 / 3.6       # km/h -> m/s
ORKAN = 118 / 3.6


def _r(v, stellen=1):
    # erst auf 9 Stellen, wie daten._r - gleiche Werte runden gleich
    return None if v is None else round(round(float(v), 9), stellen)


def _mittel(werte):
    return sum(werte) / len(werte) if werte else None


def quantil(sortiert, p):
    """quantile_cont wie DuckDB: linear bei (n-1)*p."""
    if not sortiert:
        return None
    pos = (len(sortiert) - 1) * p
    lo, hi = int(pos // 1), -int(-pos // 1)
    return sortiert[lo] + (sortiert[hi] - sortiert[lo]) * (pos - lo)


def platz_erlaubt(jahre: float) -> int:
    """Wie tief eine Reihe gelesen werden darf (Regel der alten App):
    unter 10 Jahren nur Platz 1, unter 20 bis 3, unter 50 bis 5, sonst 10."""
    return 1 if jahre < 10 else 3 if jahre < 20 else 5 if jahre < 50 else 10


class Spalten:
    """Die bereinigten Tage einer Station, nach Datum sortiert.

    Das Datum kommt als Tage seit 1970 und als Jahr/Monat/Tag aus der
    Datenbank - 60.000 date-Objekte zu bauen kostete allein eine halbe
    Sekunde. Als Datum gebraucht wird es nur für die wenigen Zeilen, die
    in einer Antwort landen (`iso`).
    """

    def __init__(self, zeilen: list[tuple], namen: list[str]):
        self.n = len(zeilen)
        spalten = list(zip(*zeilen)) if zeilen else [()] * (4 + len(namen))
        self.ord, self.jahr, self.monat, self.tag = (list(c) for c in spalten[:4])
        for i, name in enumerate(namen):
            setattr(self, name, list(spalten[4 + i]))
        self.k = [MONATSANFANG[m - 1] + t - 1 for m, t in zip(self.monat, self.tag)]

    def datum(self, i) -> dt.date:
        return EPOCHE + dt.timedelta(days=self.ord[i])

    def iso(self, i) -> str:
        return self.datum(i).isoformat()

    def letzter(self, spalte="tmk"):
        werte = getattr(self, spalte)
        for i in range(self.n - 1, -1, -1):
            if werte[i] is not None:
                return i
        return -1


EPOCHE = dt.date(1970, 1, 1)


def _iso(d):
    return d.isoformat() if d else None


# ----------------------------------------------------------------- Rekorde
def rekorde(s: Spalten) -> dict:
    jahre = (s.ord[-1] - s.ord[0] + 1) / 365.25 if s.n else 0
    groessen = []
    for spalte, richtung, titel, einheit, faktor in REKORDE:
        werte = getattr(s, spalte)
        vz = -1 if richtung == "hoch" else 1
        # nur die besten zehn - ganz sortieren hieße 60.000 Werte je Größe
        paare = heapq.nsmallest(10, ((vz * werte[i], s.ord[i], i) for i in range(s.n)
                                     if werte[i] is not None))
        paare = [(vz * w, o, i) for w, o, i in paare]
        anzahl = sum(1 for v in werte if v is not None)
        liste = []
        for pos, (wert, _, i) in enumerate(paare):
            # gleicher Wert, gleicher Platz: der Platz des ersten mit diesem Wert
            platz = pos + 1
            while platz > 1 and paare[platz - 2][0] == wert:
                platz -= 1
            liste.append([platz, _r(wert * faktor), s.iso(i)])
        groessen.append({"spalte": spalte, "richtung": richtung, "titel": titel,
                         "einheit": einheit, "liste": liste, "tage": anzahl})
    return {"jahre": round(jahre, 1), "erlaubt": platz_erlaubt(jahre), "groessen": groessen}


# --------------------------------------------- Normal je Kalendertag (+-7)
def tagesnormal(s: Spalten, spalte="tmk", nv: int = NORMAL_VON) -> dict:
    """k -> (Mittel, 10 %, 90 %) der Tageswerte 1991-2020 im Fenster +-7."""
    werte = getattr(s, spalte)
    pool: dict[int, list] = {}
    for i in range(s.n):
        if not nv <= s.jahr[i] <= nv + 29 or werte[i] is None:
            continue
        for o in range(-7, 8):
            pool.setdefault((s.k[i] + o + 366) % 366, []).append(werte[i])
    aus = {}
    for k, w in pool.items():
        w.sort()
        aus[k] = (sum(w) / len(w), quantil(w, 0.1), quantil(w, 0.9))
    return aus


# ------------------------------------------------ Heute in der Geschichte
def geschichte(s: Spalten, datum: dt.date | None = None, nv: int = NORMAL_VON) -> dict:
    li = s.letzter()
    if li < 0:
        return {"leer": True}
    tag = datum or s.datum(li)
    normal = {sp: tagesnormal(s, sp, nv) for sp in ("tmk", "txk", "tnk")}
    k = MONATSANFANG[tag.month - 1] + tag.day - 1
    groessen = []
    jahre = {}
    for sp, titel in (("tmk", "Mittel"), ("txk", "Höchstwert"), ("tnk", "Tiefstwert")):
        werte = getattr(s, sp)
        paare = [(werte[i], s.jahr[i]) for i in range(s.n)
                 if s.monat[i] == tag.month and s.tag[i] == tag.day and werte[i] is not None]
        for w, j in paare:
            jahre.setdefault(j, {})[sp] = _r(w)
        eigen = next((w for w, j in paare if j == tag.year), None)
        warm = sorted(paare, key=lambda p: (-p[0], p[1]))
        kalt = sorted(paare, key=lambda p: (p[0], p[1]))
        groessen.append({
            "spalte": sp, "titel": titel, "wert": _r(eigen),
            "platz_warm": None if eigen is None else 1 + sum(1 for w, _ in paare if w > eigen),
            "platz_kalt": None if eigen is None else 1 + sum(1 for w, _ in paare if w < eigen),
            "von": len(paare),
            "warm": [[_r(w), j] for w, j in warm[:3]],
            "kalt": [[_r(w), j] for w, j in kalt[:3]],
            "normal": _r(normal[sp][k][0]) if k in normal[sp] else None,
        })
    return {"datum": tag.isoformat(), "groessen": groessen,
            "jahre": [[j, v.get("tmk"), v.get("txk"), v.get("tnk")]
                      for j, v in sorted(jahre.items(), reverse=True)]}


# --------------------------------------------------------------- Kenntage
def kenntage(s: Spalten, nv: int = NORMAL_VON) -> dict:
    proj: dict[int, dict] = {}
    for i in range(s.n):
        e = proj.setdefault(s.jahr[i], {"t": 0, "n": 0, "g": 0, **{k: 0 for k, *_ in KENNTAGE}})
        if s.txk[i] is not None:
            e["t"] += 1
        if s.tnk[i] is not None:
            e["n"] += 1
        if s.tgk[i] is not None:
            e["g"] += 1
        for key, _, sp, bed in KENNTAGE:
            v = getattr(s, sp)[i]
            if v is not None and bed(v):
                e[key] += 1
    zeilen = []
    for j in sorted(proj):
        e = proj[j]
        zeilen.append({"jahr": j, **{k: e[k] for k, *_ in KENNTAGE},
                       "tage_x": e["t"], "tage_n": e["n"], "tage_g": e["g"]})
    normal = {}
    for key, _, sp, _ in KENNTAGE:
        feld = {"txk": "tage_x", "tnk": "tage_n", "tgk": "tage_g"}[sp]
        voll = [z[key] for z in zeilen if nv <= z["jahr"] <= nv + 29 and z[feld] >= JAHR_MIN]
        normal[key] = _r(_mittel(voll))
    return {"arten": [[k, t] for k, t, *_ in KENNTAGE], "jahre": zeilen, "normal": normal,
            "min_tage": JAHR_MIN}


# ----------------------------------------------------------------- Wellen
def wellen(s: Spalten, art="normal", heiss=30.0, kalt=0.0, min_tage=3, nv: int = NORMAL_VON) -> dict:
    if art == "normal":
        tn = tagesnormal(s, "tmk", nv)
        werte, min_tage = s.tmk, 5

        def ist_heiss(i):
            q = tn.get(s.k[i])
            return q is not None and werte[i] > q[2]

        def ist_kalt(i):
            q = tn.get(s.k[i])
            return q is not None and werte[i] < q[1]
    else:
        if art == "fest":
            heiss, kalt, min_tage = 30.0, 0.0, 3
        werte = s.txk
        heiss, kalt, min_tage = float(heiss), float(kalt), max(1, int(min_tage))

        def ist_heiss(i):
            return werte[i] >= heiss

        def ist_kalt(i):
            return werte[i] < kalt

    gefunden = []
    for typ, bed in (("hitze", ist_heiss), ("kaelte", ist_kalt)):
        lauf = []
        for i in range(s.n + 1):
            weiter = (i < s.n and werte[i] is not None and bed(i)
                      and (not lauf or s.ord[i] == s.ord[lauf[-1]] + 1))
            if weiter:
                lauf.append(i)
                continue
            if len(lauf) >= min_tage:
                w = [werte[j] for j in lauf]
                gefunden.append({"typ": typ, "von": s.iso(lauf[0]),
                                 "bis": s.iso(lauf[-1]), "tage": len(lauf),
                                 "extrem": _r(max(w) if typ == "hitze" else min(w)),
                                 "mittel": _r(sum(w) / len(w))})
            lauf = []
            if i < s.n and werte[i] is not None and bed(i):
                lauf = [i]
    proj = {}
    for w in gefunden:
        j = int(w["von"][:4])
        e = proj.setdefault(j, {"jahr": j, "hitze": 0, "hitze_tage": 0, "hitze_laengste": 0,
                                "kaelte": 0, "kaelte_tage": 0, "kaelte_laengste": 0})
        e[w["typ"]] += 1
        e[w["typ"] + "_tage"] += w["tage"]
        e[w["typ"] + "_laengste"] = max(e[w["typ"] + "_laengste"], w["tage"])

    def laengste(typ):
        return sorted((w for w in gefunden if w["typ"] == typ),
                      key=lambda w: (-w["tage"], w["von"]))[:10]
    return {"art": art, "heiss": heiss if art != "normal" else None,
            "kalt": kalt if art != "normal" else None, "min_tage": min_tage,
            "jahre": [proj[j] for j in sorted(proj)],
            "hitze": laengste("hitze"), "kaelte": laengste("kaelte")}


# ----------------------------------------------------------- Klimastreifen
def klimastreifen(s: Spalten, nv: int = NORMAL_VON) -> dict:
    proj: dict[int, list] = {}
    for i in range(s.n):
        if s.tmk[i] is not None:
            proj.setdefault(s.jahr[i], []).append(s.tmk[i])
    jahre = [(j, sum(w) / len(w)) for j, w in sorted(proj.items()) if len(w) >= JAHR_MIN]
    ref = [m for j, m in jahre if nv <= j <= nv + 29]
    bezug = _mittel(ref)
    return {"bezug": _r(bezug, 2), "bezug_jahre": len(ref),
            "jahre": [[j, _r(m, 2), _r(m - bezug, 2) if bezug is not None else None]
                      for j, m in jahre]}


# ----------------------------------------------- Summen: Niederschlag, Sonne
def summen(s: Spalten, spalte: str, jahr: int | None = None, nv: int = NORMAL_VON) -> dict:
    """Niederschlag (rsk) oder Sonne (sdk): Jahr kumuliert gegen das Normal,
    Monatssummen, Rangliste der Jahre, beim Niederschlag Trockenperioden."""
    werte = getattr(s, spalte)
    li = s.letzter(spalte)
    if li < 0:
        return {"leer": True}
    jahr = int(jahr) if jahr else s.jahr[li]
    regen = spalte == "rsk"

    # je Jahr: Summe, Tage mit Wert, Regentage, größter Tag, längste Trockenzeit
    proj: dict[int, dict] = {}
    trocken_lauf, trocken_start, vor_ord = 0, None, None
    for i in range(s.n):
        j = s.jahr[i]
        e = proj.setdefault(j, {"jahr": j, "summe": 0.0, "tage": 0, "nass": 0,
                                "max": None, "max_datum": None, "trocken": 0, "trocken_von": None})
        v = werte[i]
        if v is None:
            trocken_lauf, vor_ord = 0, None
            continue
        e["summe"] += v
        e["tage"] += 1
        if e["max"] is None or v > e["max"]:
            e["max"], e["max_datum"] = v, s.iso(i)
        if regen:
            if v >= 0.1:
                e["nass"] += 1
                trocken_lauf = 0
            else:
                if trocken_lauf and vor_ord == s.ord[i] - 1:
                    trocken_lauf += 1
                else:
                    trocken_lauf, trocken_start = 1, i
                # die Trockenzeit zählt im Jahr, in dem sie endet
                if trocken_lauf > e["trocken"]:
                    e["trocken"], e["trocken_von"] = trocken_lauf, s.iso(trocken_start)
            vor_ord = s.ord[i]
    jahre = []
    for j in sorted(proj):
        e = proj[j]
        jahre.append({"jahr": j, "summe": _r(e["summe"]), "tage": e["tage"],
                      "nass": e["nass"] if regen else None, "max": _r(e["max"]),
                      "max_datum": e["max_datum"],
                      "trocken": e["trocken"] if regen else None,
                      "trocken_von": e["trocken_von"] if regen else None})
    voll = [z for z in jahre if z["tage"] >= JAHR_MIN]
    rang = sorted(voll, key=lambda z: -z["summe"])
    for p, z in enumerate(rang):
        z["platz"] = p + 1
    normal_jahre = [z for z in voll if nv <= z["jahr"] <= nv + 29]

    # ein Durchlauf: je Jahr die Tageswerte nach Kalendertag, je Monat Summe/Tage
    tage_j: dict[int, list] = {}
    monat_j: dict[tuple, list] = {}
    for i in range(s.n):
        v = werte[i]
        if v is None:
            continue
        t = tage_j.setdefault(s.jahr[i], [None] * 366)
        t[s.k[i]] = (t[s.k[i]] or 0.0) + v
        m = monat_j.setdefault((s.jahr[i], s.monat[i]), [0.0, 0])
        m[0] += v
        m[1] += 1

    def kumuliert(j):
        summe, aus = 0.0, []
        for v in tage_j.get(j, [None] * 366):
            summe += v or 0.0
            aus.append(summe)
        return aus

    # das Jahr kumuliert und das Normal (10 %, Median, 90 %) nach Kalendertag
    eigen = kumuliert(jahr)
    letzt_k = max((k for k, v in enumerate(tage_j.get(jahr, [])) if v is not None), default=-1)
    kurven = [kumuliert(z["jahr"]) for z in normal_jahre]
    band = []
    for k in range(366):
        w = sorted(c[k] for c in kurven)
        band.append([k, _r(quantil(w, 0.1)), _r(quantil(w, 0.5)), _r(quantil(w, 0.9))] if w else [k, None, None, None])

    # Monatssummen des Jahres gegen das Normal (Monate mit >= 90 % Tagen)
    monate = []
    for mo in range(1, 13):
        if (jahr, mo) not in monat_j:
            continue
        nm = []
        for j in range(nv, nv + 30):
            sm, n = monat_j.get((j, mo), (0.0, 0))
            tage_m = (dt.date(j + (mo == 12), mo % 12 + 1, 1) - dt.date(j, mo, 1)).days
            if n and n >= 0.9 * tage_m:
                nm.append(sm)
        sm, n = monat_j[(jahr, mo)]
        monate.append({"mo": mo, "summe": _r(sm), "tage": n, "normal": _r(_mittel(nm))})
    return {"spalte": spalte, "jahr": jahr, "letzter": s.iso(li),
            "kumuliert": [[k, _r(eigen[k])] for k in range(letzt_k + 1)],
            "band": band, "monate": monate, "jahre": jahre,
            "normal_jahre": len(normal_jahre),
            "normal": _r(_mittel([z["summe"] for z in normal_jahre]))}


# ------------------------------------------------------------------ Schnee
def schnee(s: Spalten, nv: int = NORMAL_VON) -> dict:
    """Je Winter (1. Okt. bis 30. Apr., benannt nach dem Januar)."""
    proj: dict[int, dict] = {}
    for i in range(s.n):
        mo = s.monat[i]
        if 5 <= mo <= 9:
            continue
        w = s.jahr[i] + (1 if mo >= 10 else 0)
        e = proj.setdefault(w, {"winter": w, "tage": 0, "schneetage": 0, "max": None,
                                "max_datum": None, "erster": None, "letzter": None})
        v = s.shk[i]
        if v is None:
            continue
        e["tage"] += 1
        if v >= 1:
            e["schneetage"] += 1
            e["erster"] = e["erster"] or s.iso(i)
            e["letzter"] = s.iso(i)
        if e["max"] is None or v > e["max"]:
            e["max"], e["max_datum"] = v, s.iso(i)
    winter = [{**e, "max": _r(e["max"], 0)} for _, e in sorted(proj.items())]
    voll = [w for w in winter if w["tage"] >= 0.9 * 212]
    normal = [w["schneetage"] for w in voll if nv <= w["winter"] <= nv + 29]
    return {"winter": winter, "normal": _r(_mittel(normal)), "min_tage": 0.9 * 212}


# -------------------------------------------------------------------- Wind
def wind(s: Spalten, nv: int = NORMAL_VON) -> dict:
    proj: dict[int, dict] = {}
    for i in range(s.n):
        e = proj.setdefault(s.jahr[i], {"jahr": s.jahr[i], "tage": 0, "sturm": 0, "orkan": 0,
                                        "max": None, "max_datum": None})
        v = s.fx[i]
        if v is None:
            continue
        e["tage"] += 1
        if v >= STURM:
            e["sturm"] += 1
        if v >= ORKAN:
            e["orkan"] += 1
        if e["max"] is None or v > e["max"]:
            e["max"], e["max_datum"] = v, s.iso(i)
    jahre = [{**e, "max": _r(e["max"] * 3.6) if e["max"] is not None else None}
             for _, e in sorted(proj.items())]
    normal = [j["sturm"] for j in jahre if nv <= j["jahr"] <= nv + 29 and j["tage"] >= JAHR_MIN]
    return {"jahre": jahre, "normal": _r(_mittel(normal))}


# ------------------------------------------------------------------- Frost
def frost(s: Spalten, nv: int = NORMAL_VON) -> dict:
    """Je Jahr letzter Frost vor dem 1. Juli, erster ab dem 1. Juli - in der
    Luft (Tiefstwert 2 m) und am Boden (5 cm) - und die frostfreie Zeit."""
    proj: dict[int, dict] = {}
    for i in range(s.n):
        j = s.jahr[i]
        e = proj.setdefault(j, {"jahr": j})
        for art, sp in (("luft", "tnk"), ("boden", "tgk")):
            v = getattr(s, sp)[i]
            if v is None:
                continue
            e[art + "_tage"] = e.get(art + "_tage", 0) + 1
            if v < 0:
                if s.monat[i] <= 6:
                    e[art + "_letzter"] = s.iso(i)
                elif art + "_erster" not in e:
                    e[art + "_erster"] = s.iso(i)
    jahre = []
    for j in sorted(proj):
        e = proj[j]
        z = {"jahr": j}
        for art in ("luft", "boden"):
            letzter, erster = e.get(art + "_letzter"), e.get(art + "_erster")
            z[art + "_letzter"], z[art + "_erster"] = letzter, erster
            z[art + "_tage"] = e.get(art + "_tage", 0)
            z[art + "_frei"] = ((dt.date.fromisoformat(erster) - dt.date.fromisoformat(letzter)).days - 1
                               if letzter and erster else None)
        jahre.append(z)

    def normal(feld):
        w = [z[feld] for z in jahre if nv <= z["jahr"] <= nv + 29 and z[feld] is not None
             and z[feld.split("_")[0] + "_tage"] >= JAHR_MIN]
        return _r(_mittel(w))
    return {"jahre": jahre, "normal": {"luft_frei": normal("luft_frei"), "boden_frei": normal("boden_frei")}}


# ------------------------------------------------------ Prognose im Verlauf
def prognose_verlauf(s: Spalten, heute: dt.date) -> dict:
    """Was die Prognose zum Jahresende an jedem Tag des laufenden Jahres
    gesagt hätte - dieselbe Rechnung wie daten._prognose, nur für jeden
    Tag statt nur den letzten."""
    li = s.letzter()
    if li < 0 or s.jahr[li] != heute.year:
        return {"leer": True}
    jahr = s.jahr[li]
    ende = dt.date(jahr, 12, 31)
    tage_im_jahr = ende.timetuple().tm_yday

    # je Vergleichsjahr: Summe und Anzahl der Tagesmittel ab Kalendertag k
    vergleich = range(jahr - PROGNOSE_JAHRE, jahr)
    ab: dict[int, tuple[list, list]] = {j: ([0.0] * 367, [0] * 367) for j in vergleich}
    for i in range(s.n):
        if s.jahr[i] in ab and s.tmk[i] is not None:
            ab[s.jahr[i]][0][s.k[i]] += s.tmk[i]
            ab[s.jahr[i]][1][s.k[i]] += 1
    for summe, anzahl in ab.values():
        for k in range(365, -1, -1):
            summe[k] += summe[k + 1]
            anzahl[k] += anzahl[k + 1]

    eigen = [(i, s.k[i], s.tmk[i]) for i in range(s.n)
             if s.jahr[i] == jahr and s.tmk[i] is not None]
    verlauf = []
    summe, anzahl = 0.0, 0
    for i, k, v in eigen:
        summe += v
        anzahl += 1
        rest = (ende - s.datum(i)).days
        bisher_tage = tage_im_jahr - rest
        if anzahl < 0.9 * bisher_tage or rest == 0:
            continue
        reste = sorted(ab[j][0][k + 1] / ab[j][1][k + 1] for j in vergleich
                       if ab[j][1][k + 1] and ab[j][1][k + 1] >= 0.9 * rest)
        if not reste:
            continue
        m = summe / anzahl
        q = [(m * bisher_tage + quantil(reste, p) * rest) / tage_im_jahr for p in (0.1, 0.5, 0.9)]
        verlauf.append([s.iso(i), _r(q[0], 2), _r(q[1], 2), _r(q[2], 2), _r(m, 2)])
    return {"jahr": jahr, "verlauf": verlauf, "jahre": [jahr - PROGNOSE_JAHRE, jahr - 1]}
