"""Baut die Ortsliste für die Ortswahl: web/src/lib/orte.json.

Quelle: GeoNames (CC BY 4.0), https://www.geonames.org - Datei DE.zip aus
https://download.geonames.org/export/dump/. Genommen werden alle bewohnten
Orte und Ortsteile (ohne untergegangene und historische) und die benannten
Gipfel (PK, MT). Sortiert nach Einwohnern, damit die Karte je nach Zoom
die größeren zuerst beschriftet und die Suche sie zuerst nennt.

Format, spaltenweise und kompakt (Zahlen ganzzahlig):
    n: Namen, b/l: Breite/Länge * 1000, h: Höhe in m (oder null),
    e: Einwohner, a: Bundesland (Index in LAENDER), g: 1 = Gipfel

    python werkzeuge/orte_bauen.py PFAD/ZU/DE.zip
"""

import csv
import io
import json
import os
import sys
import zipfile

HIER = os.path.dirname(os.path.abspath(__file__))
ZIEL = os.path.join(os.path.dirname(HIER), "web", "src", "lib", "orte.json")

# GeoNames-Schlüssel admin1 für Deutschland
LAENDER = {
    "01": "Baden-Württemberg", "02": "Bayern", "03": "Bremen", "04": "Hamburg",
    "05": "Hessen", "06": "Niedersachsen", "07": "Nordrhein-Westfalen",
    "08": "Rheinland-Pfalz", "09": "Saarland", "10": "Schleswig-Holstein",
    "11": "Brandenburg", "12": "Mecklenburg-Vorpommern", "13": "Sachsen",
    "14": "Sachsen-Anhalt", "15": "Thüringen", "16": "Berlin",
}
ORTE_OHNE = {"PPLH", "PPLQ", "PPLW", "PPLCH"}    # historisch, verlassen, zerstört
GIPFEL = {"PK", "MT"}


def zahl(text):
    try:
        return int(text)
    except ValueError:
        return None


def bauen(pfad_zip):
    with zipfile.ZipFile(pfad_zip) as z, z.open("DE.txt") as roh:
        zeilen = list(csv.reader(io.TextIOWrapper(roh, encoding="utf-8"), delimiter="\t",
                                 quoting=csv.QUOTE_NONE))
    orte = []
    laender = list(LAENDER.values())
    for r in zeilen:
        ort = r[6] == "P" and r[7] not in ORTE_OHNE
        gipfel = r[6] == "T" and r[7] in GIPFEL
        if not (ort or gipfel) or r[10] not in LAENDER:
            continue
        hoehe = zahl(r[15]) if r[15] else zahl(r[16])
        if hoehe is not None and hoehe < -100:            # -9999 = unbekannt
            hoehe = None
        orte.append((zahl(r[14]) or 0, r[1], round(float(r[4]) * 1000), round(float(r[5]) * 1000),
                     hoehe, laender.index(LAENDER[r[10]]), 1 if gipfel else 0))
    # größere zuerst, Gipfel nach Höhe zwischen den kleinen Orten
    orte.sort(key=lambda o: (-o[0], -(o[4] or 0) if o[6] else 0, o[1]))
    daten = {
        "quelle": "GeoNames, CC BY 4.0, geonames.org",
        "laender": laender,
        "n": [o[1] for o in orte], "b": [o[2] for o in orte], "l": [o[3] for o in orte],
        "h": [o[4] for o in orte], "e": [o[0] for o in orte], "a": [o[5] for o in orte],
        "g": [o[6] for o in orte],
    }
    with open(ZIEL, "w", encoding="utf-8") as datei:
        json.dump(daten, datei, ensure_ascii=False, separators=(",", ":"))
    return len(orte), sum(o[6] for o in orte)


if __name__ == "__main__":
    anzahl, gipfel = bauen(sys.argv[1])
    print(f"{anzahl} Orte, davon {gipfel} Gipfel -> {ZIEL} ({os.path.getsize(ZIEL) // 1024} KB)")
