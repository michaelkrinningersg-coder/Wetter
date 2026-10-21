package app.wetter.station;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.text.TextUtils;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Meldungen: Unwetter in der Vorhersage (Sturmböen ab 75 km/h, Starkregen
 * ab 15 mm in einer Stunde, Gewitter - nächste 24 Stunden, Ort und Modell
 * wie im Widget) und neue Rekorde der Favoriten (RekordArbeit).
 */
final class Meldung {

    static final String KANAL_UNWETTER = "unwetter";
    static final String KANAL_REKORDE = "rekorde";

    private Meldung() {}

    static boolean erlaubt(Context c) {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(c).areNotificationsEnabled();
    }

    static void kanaele(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel u = new NotificationChannel(KANAL_UNWETTER, "Unwetter in der Vorhersage", NotificationManager.IMPORTANCE_HIGH);
        u.setDescription("Sturmböen, Starkregen und Gewitter in den nächsten 24 Stunden");
        nm.createNotificationChannel(u);
        NotificationChannel r = new NotificationChannel(KANAL_REKORDE, "Rekorde der Favoriten", NotificationManager.IMPORTANCE_DEFAULT);
        r.setDescription("Neue Rekorde und Kalendertags-Rekorde an deinen Favoriten - einmal am Tag");
        nm.createNotificationChannel(r);
    }

    static void senden(Context c, String kanal, int nummer, String titel, String text, List<String> zeilen) {
        if (!erlaubt(c)) return;
        kanaele(c);
        Intent oeffnen = new Intent(c, MainActivity.class);
        oeffnen.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, nummer, oeffnen,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, kanal)
            .setSmallIcon(R.drawable.ic_meldung)
            .setContentTitle(titel)
            .setContentText(text)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(KANAL_UNWETTER.equals(kanal) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT);
        if (zeilen != null && zeilen.size() > 1) {
            NotificationCompat.InboxStyle stil = new NotificationCompat.InboxStyle();
            for (String z : zeilen) stil.addLine(z);
            b.setStyle(stil);
        } else {
            b.setStyle(new NotificationCompat.BigTextStyle().bigText(text));
        }
        try {
            NotificationManagerCompat.from(c).notify(nummer, b.build());
        } catch (SecurityException ignoriert) {
            // Erlaubnis inzwischen entzogen
        }
    }

    /** Unwetter der nächsten 24 Stunden - je Art und Tag einmal. */
    static void unwetter(Context c, List<Vorhersage.Stunde> stunden, long jetzt) {
        String ort = Einstellungen.prefs(c).getString("name", "");
        String modell = Einstellungen.prefs(c).getString("modellName", "");
        SimpleDateFormat wann = new SimpleDateFormat("EE HH 'Uhr'", Locale.GERMANY);
        wann.setTimeZone(Vorhersage.BERLIN);
        SimpleDateFormat tag = new SimpleDateFormat("yyyyMMdd", Locale.ROOT);
        tag.setTimeZone(Vorhersage.BERLIN);
        Vorhersage.Stunde sturm = null, regen = null, gewitter = null;
        for (Vorhersage.Stunde s : stunden) {
            if (s.ms < jetzt - 3600000L || s.ms > jetzt + 24 * 3600000L) continue;
            if (!Double.isNaN(s.boe) && s.boe >= WidgetArbeit.STURM && (sturm == null || s.boe > sturm.boe)) sturm = s;
            if (!Double.isNaN(s.regen) && s.regen >= WidgetArbeit.STARKREGEN && (regen == null || s.regen > regen.regen)) regen = s;
            if ("gewitter".equals(s.art) && gewitter == null) gewitter = s;
        }
        List<String> zeilen = new ArrayList<>();
        if (sturm != null && WidgetArbeit.neuGemeldet(c, "sturm_" + tag.format(sturm.ms))) {
            zeilen.add(String.format(Locale.GERMANY, "Sturmböen bis %d km/h – %s", Math.round(sturm.boe), wann.format(sturm.ms)));
        }
        if (regen != null && WidgetArbeit.neuGemeldet(c, "regen_" + tag.format(regen.ms))) {
            zeilen.add(String.format(Locale.GERMANY, "Starkregen %.1f mm in einer Stunde – %s", regen.regen, wann.format(regen.ms)));
        }
        if (gewitter != null && WidgetArbeit.neuGemeldet(c, "gewitter_" + tag.format(gewitter.ms))) {
            zeilen.add("Gewitter – ab " + wann.format(gewitter.ms));
        }
        if (zeilen.isEmpty()) return;
        String titel = "Unwetter in " + ort + (modell.isEmpty() ? "" : " (" + modell + ")");
        senden(c, KANAL_UNWETTER, 101, titel, TextUtils.join(" · ", zeilen), zeilen);
    }
}
