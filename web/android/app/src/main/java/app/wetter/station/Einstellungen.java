package app.wetter.station;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;

/**
 * Was die App dem Widget und den Meldungen mitgibt (WetterNativ.setzen) und
 * wann die Arbeiten im Hintergrund laufen.
 *
 *   Widget und Unwetter: alle 3 Stunden (WidgetArbeit)
 *   Rekorde der Favoriten: einmal am Tag gegen 13 Uhr (RekordArbeit)
 */
final class Einstellungen {

    static final String DATEI = "wetter_nativ";

    private Einstellungen() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(DATEI, Context.MODE_PRIVATE);
    }

    static boolean hatOrt(Context c) {
        return prefs(c).contains("lat");
    }

    static double lat(Context c) {
        return Double.parseDouble(prefs(c).getString("lat", "51.5"));
    }

    static double lon(Context c) {
        return Double.parseDouble(prefs(c).getString("lon", "9.95"));
    }

    static Set<Integer> favoriten(Context c) {
        Set<Integer> aus = new HashSet<>();
        try {
            JSONArray a = new JSONArray(prefs(c).getString("favoriten", "[]"));
            for (int i = 0; i < a.length(); i++) aus.add(a.getInt(i));
        } catch (Exception ignoriert) {
            // leere Liste
        }
        return aus;
    }

    /** Arbeiten einplanen bzw. abbestellen - nach jeder Änderung der Einstellungen. */
    static void planen(Context c) {
        WorkManager wm = WorkManager.getInstance(c);
        Constraints netz = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest widget = new PeriodicWorkRequest.Builder(WidgetArbeit.class, 3, TimeUnit.HOURS)
            .setConstraints(netz)
            .build();
        wm.enqueueUniquePeriodicWork("widget", ExistingPeriodicWorkPolicy.KEEP, widget);

        if (prefs(c).getBoolean("rekorde", true)) {
            PeriodicWorkRequest rekorde = new PeriodicWorkRequest.Builder(RekordArbeit.class, 24, TimeUnit.HOURS)
                .setConstraints(netz)
                .setInitialDelay(bisMittag(), TimeUnit.MILLISECONDS)
                .build();
            wm.enqueueUniquePeriodicWork("rekorde", ExistingPeriodicWorkPolicy.KEEP, rekorde);
        } else {
            wm.cancelUniqueWork("rekorde");
        }
    }

    /** Widget sofort neu (nach dem Setzen, beim Hinzufügen). */
    static void widgetJetzt(Context c) {
        Constraints netz = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest jetzt = new OneTimeWorkRequest.Builder(WidgetArbeit.class).setConstraints(netz).build();
        WorkManager.getInstance(c).enqueueUniqueWork("widget_jetzt", ExistingWorkPolicy.REPLACE, jetzt);
    }

    static void rekordeJetzt(Context c) {
        OneTimeWorkRequest jetzt = new OneTimeWorkRequest.Builder(RekordArbeit.class).build();
        WorkManager.getInstance(c).enqueueUniqueWork("rekorde_jetzt", ExistingWorkPolicy.REPLACE, jetzt);
    }

    /** Millisekunden bis zum nächsten 13:05 Uhr in Berlin (die Rekord-Aktion rechnet um 12:37). */
    static long bisMittag() {
        Calendar jetzt = Calendar.getInstance(Vorhersage.BERLIN, Locale.GERMANY);
        Calendar z = (Calendar) jetzt.clone();
        z.set(Calendar.HOUR_OF_DAY, 13);
        z.set(Calendar.MINUTE, 5);
        z.set(Calendar.SECOND, 0);
        if (!z.after(jetzt)) z.add(Calendar.DAY_OF_MONTH, 1);
        return z.getTimeInMillis() - jetzt.getTimeInMillis();
    }
}
