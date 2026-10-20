"""Baut die einfache Karte unter dem Regenradar: web/src/lib/karte.json.

Quelle: Natural Earth 1:10 Mio. (gemeinfrei), https://www.naturalearthdata.com
Die Linien liegen schon im Raster des DWD-Radars (RV/DE1200, 1 km,
polarstereografisch, wie es Bright Sky ausliefert): x = Spalte, y = Zeile,
in km mit einer Nachkommastelle. Die App muss so nichts mehr umrechnen.

    python werkzeuge/karte_bauen.py ORDNER_MIT_NATURAL_EARTH_GEOJSON
"""

import json
import math
import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
ZIEL = os.path.join(os.path.dirname(HIER), "web", "src", "lib", "karte.json")

# Radarraster: 1100 Spalten, 1200 Zeilen; etwas Rand für Linien, die hinausführen
BREITE, HOEHE, RAND = 1100, 1200, 40
TOLERANZ = 0.35  # km - Vereinfachung der Linien (Douglas-Peucker)

# --- Projektion (pyproj: +proj=stere +lat_0=90 +lat_ts=60 +lon_0=10
#     +a=6378137 +b=6356752.3142451802 +x_0=543196.835 +y_0=3622588.862) -----
A, B = 6378137.0, 6356752.3142451802
E = math.sqrt(1 - B * B / (A * A))
X0, Y0 = 543196.83521776402, 3622588.8619310018


def _t(phi):
    return math.tan(math.pi / 4 - phi / 2) / ((1 - E * math.sin(phi)) / (1 + E * math.sin(phi))) ** (E / 2)


_PC = math.radians(60)
_MC = math.cos(_PC) / math.sqrt(1 - E * E * math.sin(_PC) ** 2)
_TC = _t(_PC)


def raster(lon, lat):
    """Länge/Breite -> (Spalte, Zeile) im Radarraster, in km."""
    phi, lam = math.radians(lat), math.radians(lon - 10)
    rho = A * _MC * _t(phi) / _TC
    return (X0 + rho * math.sin(lam)) / 1000, -(Y0 - rho * math.cos(lam)) / 1000


def drinnen(p):
    return -RAND <= p[0] <= BREITE + RAND and -RAND <= p[1] <= HOEHE + RAND


# --- Vereinfachen ------------------------------------------------------------
def _abstand(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == dy == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def vereinfachen(punkte, tol=TOLERANZ):
    if len(punkte) < 3:
        return punkte
    behalten = [False] * len(punkte)
    behalten[0] = behalten[-1] = True
    stapel = [(0, len(punkte) - 1)]
    while stapel:
        i, j = stapel.pop()
        weit, k = 0.0, -1
        for m in range(i + 1, j):
            d = _abstand(punkte[m], punkte[i], punkte[j])
            if d > weit:
                weit, k = d, m
        if weit > tol:
            behalten[k] = True
            stapel += [(i, k), (k, j)]
    return [p for p, b in zip(punkte, behalten) if b]


def stuecke(koords):
    """Eine Linie im Raster, zerteilt an den Stellen, wo sie das Gebiet verlässt."""
    teile, jetzt = [], []
    for lon, lat in koords:
        p = raster(lon, lat)
        if drinnen(p):
            jetzt.append(p)
        else:
            if len(jetzt) > 1:
                teile.append(jetzt)
            jetzt = []
    if len(jetzt) > 1:
        teile.append(jetzt)
    return [vereinfachen(t) for t in teile]


def linien(geom):
    t = geom["type"]
    if t == "LineString":
        return [geom["coordinates"]]
    if t == "MultiLineString":
        return geom["coordinates"]
    if t == "Polygon":
        return geom["coordinates"]
    if t == "MultiPolygon":
        return [ring for poly in geom["coordinates"] for ring in poly]
    return []


def flach(teile):
    """[[(x, y), ...], ...] -> [[x1, y1, x2, y2, ...], ...] mit 0,1 km."""
    return [[round(v, 1) for p in t for v in p] for t in teile if len(t) > 1]


def lesen(ordner, name):
    with open(os.path.join(ordner, name + ".geojson"), encoding="utf-8") as datei:
        return json.load(datei)["features"]


def bauen(ordner):
    karte = {"quelle": "Natural Earth (gemeinfrei)", "breite": BREITE, "hoehe": HOEHE}

    # Staatsgrenzen: Deutschland eigens, die Nachbarn als eine Ebene
    deutschland, nachbarn = [], []
    for f in lesen(ordner, "ne_10m_admin_0_countries"):
        a3 = f["properties"].get("ADM0_A3")
        for ring in linien(f["geometry"]):
            (deutschland if a3 == "DEU" else nachbarn).extend(stuecke(ring))
    karte["deutschland"] = flach(deutschland)
    karte["grenzen"] = flach(nachbarn)

    # Bundesländer
    laender = []
    for f in lesen(ordner, "ne_10m_admin_1_states_provinces_lines"):
        if f["properties"].get("ADM0_A3") == "DEU":
            for l in linien(f["geometry"]):
                laender.extend(stuecke(l))
    karte["laender"] = flach(laender)

    # Flüsse: die großen weltweit und die europäischen bis zur mittleren Größe
    fluesse = []
    for name, grenze in (("ne_10m_rivers_lake_centerlines", 9), ("ne_10m_rivers_europe", 10)):
        for f in lesen(ordner, name):
            if (f["properties"].get("scalerank") or 99) <= grenze:
                for l in linien(f["geometry"]):
                    fluesse.extend(stuecke(l))
    karte["fluesse"] = flach(fluesse)

    # Seen (Umrisse)
    seen = []
    for name in ("ne_10m_lakes", "ne_10m_lakes_europe"):
        for f in lesen(ordner, name):
            for ring in linien(f["geometry"]):
                teile = stuecke(ring)
                if teile and sum(len(t) for t in teile) >= 4:
                    seen.extend(teile)
    karte["seen"] = flach(seen)

    # Orte: in Deutschland ab 100.000 Einwohnern, sonst Hauptstädte und
    # Großstädte ab 500.000 - mit Rang für die Beschriftung je Zoom
    orte = []
    for f in lesen(ordner, "ne_10m_populated_places"):
        p = f["properties"]
        de = p.get("ADM0_A3") == "DEU"
        gross = p.get("POP_MAX") or 0
        if not (de and gross >= 100_000) and not (p.get("ADM0CAP") or gross >= 500_000):
            continue
        x, y = raster(p["LONGITUDE"], p["LATITUDE"])
        if 0 <= x <= BREITE and 0 <= y <= HOEHE:
            rang = 1 if gross >= 1_000_000 or p.get("ADM0CAP") else 2 if gross >= 300_000 else 3
            orte.append([p.get("NAME_DE") or p["NAME"], round(x, 1), round(y, 1), rang])
    orte.sort(key=lambda o: o[3])
    karte["orte"] = orte

    with open(ZIEL, "w", encoding="utf-8") as datei:
        json.dump(karte, datei, ensure_ascii=False, separators=(",", ":"))
    groesse = os.path.getsize(ZIEL)
    print(f"{ZIEL}: {groesse / 1024:.0f} KB, {len(orte)} Orte")


if __name__ == "__main__":
    bauen(sys.argv[1] if len(sys.argv) > 1 else ".")
