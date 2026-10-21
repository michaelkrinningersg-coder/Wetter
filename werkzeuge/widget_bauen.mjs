// Baut die Teile des Android-Widgets, die aus der App kommen:
//   * Wettersymbole als VectorDrawable (aus web/src/lib/symbole.js), in den
//     Farben des Widgets (Graphit, Orange, Blau für Niederschlag)
//   * das Layout 4x3: Kopf, Zeile der Uhrzeiten, 3 Tage mit je 8 Zeitpunkten
//
//   node werkzeuge/widget_bauen.mjs
//
// Die Wolke vor Sonne/Mond (Art "w") deckt mit der Hintergrundfarbe ab -
// Masken kennt VectorDrawable nicht.

import { mkdirSync, writeFileSync } from "node:fs";
import { WETTER_ARTEN, wetterPfade } from "../web/src/lib/symbole.js";

const RES = new URL("../web/android/app/src/main/res/", import.meta.url);
const HINTERGRUND = "#FF1F2329";
const LINIE = "#FFF3F4F6";
const AKZENT = "#FFFB923C";
const NASS = "#FF60A5FA";

function pfadXml(d, art) {
  const a = ['    <path', `        android:pathData="${d}"`, '        android:strokeWidth="1.7"', '        android:strokeLineCap="round"', '        android:strokeLineJoin="round"'];
  if (art === "a" || art === "d") a.push(`        android:strokeColor="${AKZENT}"`);
  else if (art === "af") a.push(`        android:strokeColor="${AKZENT}"`, '        android:fillColor="#2EFB923C"');
  else if (art === "aF") a.push(`        android:strokeColor="${AKZENT}"`, `        android:fillColor="${AKZENT}"`);
  else if (art === "n") a.push(`        android:strokeColor="${NASS}"`);
  else if (art === "w") a.push(`        android:strokeColor="${LINIE}"`, `        android:fillColor="${HINTERGRUND}"`);
  else a.push(`        android:strokeColor="${LINIE}"`);
  return a.join("\n") + " />";
}

function symbolXml(pfade) {
  // Wolke davor: erst ein breiter Rand in Hintergrundfarbe (deckt Strahlen ab), dann die Wolke
  const teile = pfade.flatMap(([d, art]) =>
    art === "w"
      ? [`    <path android:pathData="${d}" android:strokeWidth="4.2" android:strokeColor="${HINTERGRUND}" android:fillColor="${HINTERGRUND}" android:strokeLineJoin="round" />`, pfadXml(d, art)]
      : [pfadXml(d, art)],
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- erzeugt von werkzeuge/widget_bauen.mjs aus web/src/lib/symbole.js -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
${teile.join("\n")}
</vector>
`;
}

mkdirSync(new URL("drawable/", RES), { recursive: true });
let n = 0;
for (const art of WETTER_ARTEN) {
  for (const [tag, k] of [[true, "t"], [false, "n"]]) {
    writeFileSync(new URL(`drawable/wsym_${art}_${k}.xml`, RES), symbolXml(wetterPfade(art, tag)));
    n++;
  }
}
writeFileSync(new URL("drawable/wsym_leer.xml", RES), `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:pathData="M11 12h2" android:strokeWidth="1.7" android:strokeColor="#66F3F4F6" android:strokeLineCap="round" />
</vector>
`);
writeFileSync(new URL("drawable/widget_hintergrund.xml", RES), `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#F21F2329" />
    <corners android:radius="18dp" />
</shape>
`);

// ---------------------------------------------------------------- Layout
const UHREN = [0, 3, 6, 9, 12, 15, 18, 21];
const zelleUhr = (h) => `            <TextView android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:gravity="center" android:text="${String(h).padStart(2, "0")}" android:textColor="#FF9AA1AD" android:textSize="10sp" />`;
const zelle = (t, c) => `            <LinearLayout android:layout_width="0dp" android:layout_height="match_parent" android:layout_weight="1" android:orientation="vertical" android:gravity="center">
                <ImageView android:id="@+id/w_${t}_${c}_s" android:layout_width="22dp" android:layout_height="22dp" android:src="@drawable/wsym_leer" />
                <TextView android:id="@+id/w_${t}_${c}_t" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textColor="#FFF3F4F6" android:textSize="11sp" android:text="" />
            </LinearLayout>`;
const tagZeile = (t) => `        <LinearLayout android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" android:orientation="horizontal" android:gravity="center_vertical">
            <LinearLayout android:layout_width="54dp" android:layout_height="wrap_content" android:orientation="vertical">
                <TextView android:id="@+id/w_${t}_name" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textColor="#FFF3F4F6" android:textSize="12sp" android:textStyle="bold" android:text="" />
                <TextView android:id="@+id/w_${t}_mm" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textColor="#FF9AA1AD" android:textSize="10sp" android:text="" />
            </LinearLayout>
${UHREN.map((_, c) => zelle(t, c)).join("\n")}
        </LinearLayout>`;

mkdirSync(new URL("layout/", RES), { recursive: true });
writeFileSync(new URL("layout/wetter_widget.xml", RES), `<?xml version="1.0" encoding="utf-8"?>
<!-- erzeugt von werkzeuge/widget_bauen.mjs: 3 Tage x 8 Zeitpunkte (alle 3 Stunden) -->
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/w_rahmen"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:orientation="vertical" android:padding="10dp"
    android:background="@drawable/widget_hintergrund">
    <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:gravity="center_vertical">
        <TextView android:id="@+id/w_ort" android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:textColor="#FFF3F4F6" android:textSize="13sp" android:textStyle="bold" android:maxLines="1" android:ellipsize="end" android:text="Wetter" />
        <TextView android:id="@+id/w_stand" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textColor="#FF9AA1AD" android:textSize="10sp" android:text="" />
    </LinearLayout>
    <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:layout_marginTop="2dp">
        <View android:layout_width="54dp" android:layout_height="1dp" />
${UHREN.map(zelleUhr).join("\n")}
    </LinearLayout>
${[0, 1, 2].map(tagZeile).join("\n")}
</LinearLayout>
`);
console.log(`${n + 1} Symbole und das Layout geschrieben`);
