# Daten & Backup

Alles liegt in einem Datenordner (`mietfuchs.sqlite`, hochgeladene Belege in `uploads/`, Logo
und Briefpapier für den Druck in `briefpapier/`; Angaben zu den Belegen und gespeicherte
KI-Auswertungen stehen in der Datenbank und kommen mit ins Backup).
Der Verlauf der Änderungen (Seite „Verlauf“) kommt nur mit, wenn du beim Backup „Verlauf der
Änderungen mitsichern“ anhakst: Er enthält bis zu zwölf Monate lang auch gelöschte Angaben
früherer Mieter.

Wo der Datenordner liegt, hängt davon ab, wie du Mietfuchs nutzt:

- **Programm für Windows** (Store oder Installer): `%USERPROFILE%\Mietfuchs`, z. B.
  `C:\Users\Name\Mietfuchs`, außerhalb des Programms, damit er eine Deinstallation übersteht.
- **Programm für macOS**: `~/Library/Application Support/Mietfuchs`.
- **Bisherige Programmdatei**: **neben der Datei**. Liegt sie an einem Ort, an dem sie nicht
  schreiben darf (etwa `Program Files` oder `/Applications`), unter Windows in
  `%LOCALAPPDATA%\Mietfuchs`, unter macOS in `~/Library/Application Support/Mietfuchs`.
- **Linux-Paket**: `~/.local/share/mietfuchs`.
- **Aus dem Quellcode**: `server/data/`.

Im Programm für Windows und macOS öffnet das Menü *Mietfuchs → Datenordner zeigen* den Ordner.
Backup = diesen Ordner kopieren. `NKA_DATA_DIR` legt ihn frei fest.

Eingelesene Kontoauszüge (Seite „Kontoauszug“) stehen in der Datenbank und kommen mit ins Backup:
Konten, Importe, Tagessummen, die Umsätze der Vermietung, die Zuordnungen und gemerkte Zahler. Die Datei
der Bank selbst speichert Mietfuchs nicht; bewahre sie selbst auf.

Das Passwort der Anmeldung steht nur als Hash in `zugang.json` im Datenordner, daneben, solange kein
Passwort festgelegt ist, `einrichtungscode.txt`. Beides geht **nicht** ins Backup über die Oberfläche,
nicht in die automatischen Vorversionen und nicht in den Umzug ins Programmfenster: Ein Backup in einer
Cloud oder auf einem USB-Stick soll niemanden zum Raten einladen. Nach dem Wiederherstellen auf einem
anderen Rechner gilt dessen Anmeldung; auf demselben Rechner bleibt dein Passwort. Kopierst du den
ganzen Ordner von Hand, kommt `zugang.json` mit.

Ebenso draußen bleibt der Ordner `tls/` mit dem Zertifikat, über das Mietfuchs seit Version 0.17 auch
HTTPS spricht (für ein [gekoppeltes Programmfenster](installation.md#programmfenster-mit-mietfuchs-im-heimnetz-verbinden)):
nicht im Backup, nicht in den Vorversionen, nicht im Umzug. Nach dem Wiederherstellen auf einem
anderen Rechner legt Mietfuchs ein neues Zertifikat an; ein gekoppeltes Fenster meldet dann ein
anderes Zertifikat als beim Koppeln, und du koppelst es mit einem neuen Code neu. Mit dem ganzen
Ordner von Hand kommt auch `tls/` mit.

Daneben legt das Programm für Windows und macOS einen eigenen kleinen Ordner `mietfuchs-fenster` an
(unter Windows in `%LOCALAPPDATA%`, bei der Store-Fassung von Windows in deren Paketordner umgelenkt,
auf dem Mac in `~/Library/Application Support`): gemerkter Port,
der Schalter für den Zugriff aus dem Heimnetz, die Verbindung mit einem Mietfuchs im Heimnetz samt
Geräteschlüssel und Protokolle. Deine Abrechnungsdaten stehen dort nicht, fürs Backup brauchst du ihn
nicht.

Bis einschließlich Version 0.7.1 lag alles in einer Datei `db.json`. Kommst du von dort, ziehen
deine Daten beim ersten Start von selbst in
`mietfuchs.sqlite` um. Die bisherige Datei heißt danach `db.json.abgeloest` und bleibt als
Rückweg liegen, daneben ein Protokoll. **Sie ist der Stand zum Zeitpunkt des Umzugs und kein
mitlaufendes Abbild**: Was du danach erfasst, steht nur noch in der Datenbank. Der Weg zurück ist
also deine Sicherung, nicht diese Datei. Am Backup ändert sich nichts, es ist weiterhin dieser
Ordner; das Backup über die Oberfläche nimmt die Datenbank mit, und beim Wiederherstellen kommt
sie mit zurück.

**Vor jedem Update der Datenbank legt Mietfuchs selbst eine Sicherung an**
(`mietfuchs.sqlite.vor-…` im Datenordner) und sagt es nach dem Start in der Oberfläche. Wie du
damit zur vorigen Version zurückkommst, steht in [MIGRATION.md](../MIGRATION.md#zurück-zu-einer-älteren-version).

**Wiederherstellen erwartet das Backup-Archiv**, also die ZIP-Datei, und keine einzelne Datei.
Alte Archive ohne Datenbank gehen weiterhin: Mietfuchs baut sie dann aus den wiederhergestellten
Daten neu auf. Wer nur noch eine lose `db.json` von früher hat, packt sie in ein ZIP und stellt
dieses wieder her. Warum das der verlässlichere Weg ist als das Hineinlegen in den Datenordner,
und wo dieser Ordner liegt, steht in [MIGRATION.md](../MIGRATION.md).
