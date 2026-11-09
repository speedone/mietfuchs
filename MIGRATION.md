# Daten aus einer älteren Mietfuchs-Version übernehmen

Diese Anleitung ist für Sie, wenn Sie Mietfuchs schon einmal benutzt haben und Ihre Daten in die
aktuelle Version bekommen wollen. Sie brauchen dafür keine technischen Kenntnisse.

Bis einschließlich Version 0.7.1 lagen Ihre Daten in einer Datei namens `db.json`. Seitdem liegen
sie in einer Datenbank, der Datei `mietfuchs.sqlite` im selben Ordner. **Sie müssen dafür nichts
tun.** Beim ersten Start wandern vorhandene Daten von selbst hinüber, und Mietfuchs sagt Ihnen in
der Oberfläche, dass es passiert ist.

Bevor der Umzug gilt, rechnet Mietfuchs Abrechnung, Verbrauchsübersicht, Mietkonto und
Steuerübersicht für jedes Jahr, in dem etwas erfasst ist, aus beiden Beständen nach und
vergleicht sie **auf den Cent**. Weicht ein einziger ab, wird nichts übernommen, und Sie erfahren,
in welchem Jahr und in welcher Zahl.

Suchen Sie sich unten heraus, was auf Sie zutrifft.

---

## Nach dem Update fragt Mietfuchs nach einem Passwort

Ab Version 0.17 schützt Mietfuchs Ihre Daten mit einem Passwort, sobald andere Geräte es erreichen
können: im Docker-Container, als Programmdatei, als Linux-Paket und im Programmfenster mit „Zugriff
aus dem Heimnetz“. Nutzen Sie das Programmfenster (auch die App aus dem Microsoft Store) ohne
„Zugriff aus dem Heimnetz“, ändert sich für Sie nichts.

**Sie hatten schon Daten:** Dann bleibt zunächst alles, wie es war, Mietfuchs ist weiter ohne
Passwort erreichbar. Unten in der Seitenleiste steht „Ohne Passwort im Netz“; ein Klick führt zur
Karte „Anmeldung“ in den Einstellungen, dort legen Sie ein Passwort fest. **Ab Version 1.0.0-rc.1, der ersten Testversion von 1.0, verlangt Mietfuchs das Passwort.** An Ihren Daten ändert sich dadurch nichts.

**Mietfuchs zeigt „Passwort festlegen“ und fragt nach einem Einrichtungscode:** Das geschieht bei
einem neuen Datenordner und nach dem Zurücksetzen. Der Code hat zwölf Zeichen in drei Gruppen, etwa
`K7QM-4XPA-9TRW`, und gilt einmal. Sie finden ihn hier:

- **Programmdatei:** Der Browser öffnet die Seite mit dem Code schon eingetragen. Sonst steht er im
  Konsolenfenster und in der Datei `einrichtungscode.txt` im Ordner `data` neben der Programmdatei.
- **Linux-Paket:** Der Browser öffnet die Seite mit dem Code schon eingetragen. Sonst steht er in
  der Ausgabe im Terminal und in `~/.local/share/mietfuchs/einrichtungscode.txt`.
- **Docker:** `docker compose logs mietfuchs` zeigt die Zeile „Einrichtungscode: …“.
- **Programmfenster:** Dort braucht es keinen Code; die Karte „Zugriff aus dem Heimnetz“ fragt beim
  Einschalten nach dem Passwort.

Das Passwort braucht mindestens 15 Zeichen, Leerzeichen sind erlaubt; die Seite schlägt einen Satz
aus mehreren Wörtern vor. Danach melden Sie sich auf jedem Gerät damit an.

**Ohne Passwort weiter:** Wollen Sie (noch) keines, wählen Sie auf derselben Seite „Ohne Passwort
weiter“. Dann kann jedes Gerät in Ihrem Netz Ihre Daten öffnen und ändern. Ein Passwort legen Sie
später unter *Einstellungen → Anmeldung* fest; den Code dafür nennen Konsolenfenster bzw. Protokoll
bei jedem Start.

**Passwort vergessen:** Legen Sie im [Datenordner](#wo-der-datenordner-liegt) eine leere Datei mit
dem Namen `passwort-zuruecksetzen` an und laden Sie die Seite neu. Im Docker-Container geht das mit

```bash
docker compose exec mietfuchs touch /app/server/data/passwort-zuruecksetzen
```

Mietfuchs löscht dann das Passwort, meldet alle Geräte ab, entfernt die Datei und nennt einen neuen
Code (Konsolenfenster, Terminal bzw. `docker compose logs mietfuchs`). Ihre Daten bleiben unberührt.

Das Passwort steht in der Datei `zugang.json` im Datenordner, als Hash, nicht im Klartext. Sie geht
nicht ins Backup und nicht in den Umzug: Nach dem Wiederherstellen auf einem neuen Rechner legen Sie
das Passwort dort neu fest. Ebenso bleibt das Zertifikat im Ordner `tls/` draußen; ein
[gekoppeltes Programmfenster](docs/installation.md#programmfenster-mit-mietfuchs-im-heimnetz-verbinden)
meldet nach dem Umzug auf einen neuen Rechner ein anderes Zertifikat (über einen Proxy wie Caddy:
dass es das Fenster nicht mehr kennt), und Sie koppeln es mit einem neuen Code neu. Eine ältere Version als 0.17 kennt das Passwort nicht; gehen Sie zu ihr
zurück, ist Mietfuchs im Netz wieder ohne Anmeldung erreichbar.

---

## Docker mit Caddy: Adressen in `MIETFUCHS_HOSTS`

Ab Version 0.17 nimmt `deploy/compose.caddy.yml` die Adressen aus der Angabe `MIETFUCHS_HOSTS`;
Caddyfile und Mietfuchs lesen dieselbe. Am einfachsten steht sie in einer Datei `.env` neben der
Compose-Datei:

```
MIETFUCHS_HOSTS=localhost, 192.168.178.23, nas.fritz.box
```

Übernehmen Sie die neue compose.caddy.yml, behalten aber Ihr bisheriges Caddyfile mit eigenen
Adressen, tragen Sie dieselben Adressen in `MIETFUCHS_HOSTS` ein. Sonst antwortet Mietfuchs unter
einer eigenen Domain wie `mietfuchs.example.org` nicht mehr („Mietfuchs antwortet nicht unter dem
Namen …“). IP-Adressen, Namen ohne Punkt und Namen im Heimnetz wie `nas.fritz.box` gehen im Browser
weiter; um ein Programmfenster über Caddy zu koppeln, muss der Name in `MIETFUCHS_HOSTS` stehen. Wer
nur das Image aktualisiert (`docker compose pull` und `docker compose up -d`), behält seine Dateien
und muss nichts tun. Einzelheiten: [Docker](docs/docker.md#mit-https-im-heimnetz-composecaddyyml).

---

## Mietkonto: Rückstand ab dem Fälligkeitstag

Ab Version 0.17 zählt ein Monat ab dem Tag nach dem spätesten erwarteten Eingang der Miete als
Rückstand, nicht mehr erst ab dem Ersten des Folgemonats. Der laufende Monat erscheint deshalb bei
Verträgen ab dem 02.09.2001 schon ab etwa dem 10. bis 14. als Rückstand. Regelt Ihr Mietvertrag die Fälligkeit anders, tragen
Sie das in den Stammdaten am Mietverhältnis unter „Fälligkeit der Miete“ ein. Keine Zahl einer
Abrechnung ändert sich.

---

## Sie wechseln von der Programmdatei zum Programm mit eigenem Fenster

Seit Version 0.15 gibt es Mietfuchs unter Windows und macOS als eigenes Programm mit eigenem Fenster:
aus dem Microsoft Store, mit dem Installer `Mietfuchs-Setup-<Version>.exe` oder als `.dmg` für den
Mac. Die bisherige Programmdatei (`mietfuchs-win.exe`, `mietfuchs-macos-…`) hatte ihre Daten im
Ordner `data` neben sich, das neue Programm hat sie in Ihrem Benutzerordner (Windows
`%USERPROFILE%\Mietfuchs`, macOS `~/Library/Application Support/Mietfuchs`). **Den Umzug erledigt
das neue Programm selbst**, auch das aus dem Microsoft Store:

1. Installieren Sie das neue Programm, wie im
   [Installation](docs/installation.md#installation-unter-windows-und-macos) beschrieben.
2. Beenden Sie das alte Mietfuchs, mit *Mietfuchs beenden* unten in der Seitenleiste oder indem Sie
   sein Konsolenfenster (auf dem Mac das Terminal) schließen. Läuft es noch, bietet das neue
   *Altes Mietfuchs beenden* an.
3. Starten Sie das neue Mietfuchs. Findet es Ihre Daten, zeigt es „Wir haben Ihre bisherigen
   Mietfuchs-Daten gefunden“ mit Ort, letzter Änderung und der Zahl der Objekte und
   Mietverhältnisse. Klicken Sie auf **Daten übernehmen**.

Gesucht wird zuerst dort, wo die Programmdatei zuletzt lief (ab Version 0.14.1 merkt sie sich den
Ort), unter Windows auch in `%LOCALAPPDATA%\Mietfuchs`. Nur wenn dort nichts liegt, sucht es in
Downloads, Schreibtisch und Dokumente, auch in OneDrive. Auf dem Mac fragt macOS dabei, ob Mietfuchs auf diese Ordner zugreifen
darf. Findet Mietfuchs nichts, fragt es „Haben Sie Mietfuchs schon einmal benutzt?“. Nach
*Ja, Daten übernehmen* haben Sie zwei Wege:

- *Ordner der alten Programmdatei wählen …*, wenn Sie wissen, wo sie liegt.
- Über ein Backup: Starten Sie das alte Mietfuchs noch einmal, klicken Sie dort unter
  *Einstellungen* auf **Backup herunterladen (ZIP)** und im neuen auf **Backup einspielen**.
  Schlüssel für einen KI-Dienst sind nicht im Backup; tragen Sie sie danach neu ein.

**Übernommen wird als Kopie**: Datenbank, Belege und Briefpapier, auch eine alte `db.json` aus den
ersten Fassungen. Mietfuchs vergleicht die Kopie mit dem Original und schaltet erst dann um. Bei
großen Beständen zeigt es den Fortschritt, und Sie können abbrechen; dann bleibt alles, wie es war.
Der Papierkorb gelöschter Belege zieht mit. Die automatischen Vorversionen (`vorversionen/`) und die
Sicherungen vor Updates (`mietfuchs.sqlite.vor-…`) bleiben im alten Ordner; das neue Programm legt
ab dann eigene an.

**Ihr alter Ordner bleibt liegen.** Beim Weg über den Ordner bekommt er nur einen Vermerk, die
Dateien `umgezogen.json` und `UMGEZOGEN.txt` mit dem neuen Ort. Eine aktuelle Programmdatei zeigt
ihn danach nur noch zum Ansehen („Nur noch zum Ansehen“), damit es keine zwei Bestände gibt. Ältere
Programmdateien kennen den Vermerk nicht: Was Sie dort noch ändern, fehlt im neuen Mietfuchs. Ändert
jemand trotzdem noch etwas im alten Mietfuchs, sagt Ihnen das neue es und bietet
„Neueren Stand übernehmen …“ an.

Später geht die Übernahme jederzeit in den Einstellungen unter „Daten aus bisherigem Mietfuchs
übernehmen …“. Haben Sie im neuen Programm schon Daten, ersetzt Mietfuchs sie nur nach Rückfrage
und legt sie vorher als `mietfuchs.sqlite.vor-restore` beiseite.

Lag Ihre Mac-Programmdatei im Ordner *Programme*, nutzt das neue Programm deren Daten in
`~/Library/Application Support/Mietfuchs` direkt, ohne Umzug. Starten Sie die alte dann nicht mehr.
Solange die alte läuft, startet das neue nicht, sondern sagt „Mietfuchs läuft bereits mit denselben
Daten …“. Programmdateien vor 0.15 prüfen das umgekehrt nicht.

Läuft alles im neuen Programm, können Sie die alte Programmdatei löschen. Den alten Ordner `data`
heben Sie am besten noch eine Weile als Sicherung auf.

---

## Sie haben noch den ganzen Datenordner

Das ist der Normalfall, und er ist der einfachste: **Sie tun nichts.**

Installieren Sie die neue Version und starten Sie sie. Beim ersten Start wandern Ihre Daten in die
Datenbank. Danach liegen im Ordner:

| Datei | Was sie ist |
| --- | --- |
| `mietfuchs.sqlite` | Ihre Daten, ab jetzt die maßgebliche Ablage |
| `db.json.abgeloest` | Ihre bisherige Datei, unverändert, als Rückweg |
| `umstieg-protokoll.txt` | was übernommen wurde |
| `uploads/` | Ihre Belege, unverändert |

Die alte Datei heißt nur deshalb anders, damit klar ist, dass sie nicht mehr mitgeschrieben wird.
Ihr Inhalt bleibt, wie er war. Löschen Sie sie ruhig erst, wenn Sie ein paar Wochen zufrieden
gearbeitet haben.

---

## Sie haben nur ein Backup-Archiv

Also die ZIP-Datei, die beim Klick auf „Backup herunterladen (ZIP)“ entsteht.

1. Installieren und starten Sie die neue Version.
2. Gehen Sie auf **Einstellungen** und wählen Sie **Backup wiederherstellen**.
3. Wählen Sie Ihre ZIP-Datei aus.

**Das gilt auch für alte Archive**, die noch keine Datenbank enthalten, weil es sie damals nicht
gab. Mietfuchs erkennt das und baut die Datenbank aus den wiederhergestellten Daten neu auf, mit
derselben centgenauen Nachrechnung wie oben.

Zwei Dinge, die Sie wissen sollten. Wiederherstellen erwartet das **Archiv**, also die ZIP-Datei,
und keine einzelne Datei. Das hat sich nicht geändert: Mietfuchs nimmt hier seit jeher ein ZIP.
Gelockert wurde die Anforderung sogar, denn früher musste eine `db.json` darin sein, heute genügt
eines von beidem. Und Ihr bisheriger Stand wird vorher beiseitegelegt, als
`mietfuchs.sqlite.vor-restore`, falls Sie sich vertan haben.

Passt am Archiv etwas nicht, lehnt Mietfuchs es ab, **bevor** irgendetwas ersetzt ist, und nennt
die Beanstandungen einzeln mit Stelle und Grund; sind es viele, die ersten fünf und die Zahl der
übrigen. Ihre bisherigen Daten sind dann unverändert.

---

## Sie haben nur noch eine einzelne Datei `db.json`

Zum Beispiel, weil Sie damals nur diese eine Datei gesichert haben.

**Packen Sie die Datei in ein ZIP-Archiv und stellen Sie dieses wieder her**, wie im Abschnitt
davor beschrieben. Unter Windows genügt dafür ein Rechtsklick auf die Datei und der Eintrag zum
Komprimieren, je nach Windows-Fassung *Senden an* oder *Komprimieren zu*; unter macOS heißt er
*Komprimieren*. Haben Sie auch noch Ihre Belege, legen Sie diese vorher in einen Ordner namens
`uploads` neben die Datei und packen beides zusammen ein.

Naheliegender wirkt es, die Datei einfach in den Datenordner zu legen und Mietfuchs zu starten,
und **auf einer frischen Installation geht das auch**. Der Umweg über das Archiv ist trotzdem der
bessere, weil der direkte Weg still danebengeht, sobald in der neuen Version schon einmal etwas
gespeichert wurde. Dafür genügt wenig: Beim allerersten Start fragt Mietfuchs im Cockpit, ob es
nach Updates sehen darf, und beide Antworten werden gespeichert. Steht in der Datenbank erst
einmal etwas, rührt Mietfuchs sie nicht mehr an, denn ein zweiter Umzug wäre ein Überschreiben
dessen, was schon dasteht. Sie sähen dann ein leeres Haus. Verloren ist auch in diesem Fall
nichts, Ihre Datei liegt unberührt im Ordner, und der Weg über das Archiv holt sie herein.

Auch sehr alte Dateien gehen: Formate aus der Zeit vor der Vorauszahlungs-Staffel und vor den
KI-Einstellungen werden beim Übernehmen mitgezogen.

---

## Wo der Datenordner liegt

**Am einfachsten lassen Sie sich das von Mietfuchs sagen.** Im Programm für Windows und macOS
(ab Version 0.15) öffnet das Menü *Mietfuchs → Datenordner zeigen* den Ordner. Die
Programmdatei nennt ihn beim Start in der zweiten Zeile:

```text
Mietfuchs-Server läuft auf http://127.0.0.1:3001
Daten: C:\Users\Beispiel\AppData\Local\Mietfuchs
```

Sehen Sie kein Fenster mit Text, weil Sie Mietfuchs über das Startmenü geöffnet haben, dann
rufen Sie im Browser `http://127.0.0.1:3001/healthz` auf, beim Programm mit eigenem Fenster (ab 0.15)
`http://127.0.0.1:17517/healthz` (war der Port 17517 beim ersten Start belegt, nimmt das Programm
einen anderen und merkt ihn sich; die Adresse steht dann in der Adresszeile von *Im Browser öffnen*). Dort steht unter `database` bei `file` der vollständige Pfad zur
Datenbank; der Ordner darüber ist Ihr Datenordner.

Falls Sie doch selbst suchen wollen, hängt der Ort davon ab, wie Sie Mietfuchs starten:

| So starten Sie Mietfuchs | Dort liegen die Daten |
| --- | --- |
| Programm für Windows (Microsoft Store oder Installer) | `%USERPROFILE%\Mietfuchs` |
| Programm für macOS (aus dem `.dmg`) | `~/Library/Application Support/Mietfuchs` |
| Programmdatei per Doppelklick | Ordner `data` **neben** der Programmdatei |
| Aus einem Linux-Paket (deb, rpm, Arch) | `~/.local/share/mietfuchs` |
| Programmdatei unter Windows aus `Program Files` | `%LOCALAPPDATA%\Mietfuchs` |
| Programmdatei unter macOS aus `/Applications` | `~/Library/Application Support/Mietfuchs` |
| Aus dem Quellcode (`npm start`) | `server/data` im Projektordner |
| Als Docker-Container | im eingebundenen Datenträger, im Container `/app/server/data` |

Liegt Mietfuchs an einem Systemort, also in `/usr`, `/opt`, `Program Files` oder `Applications`,
dann liegen die Daten immer in Ihrem Benutzerordner. Entschieden wird das allein am Ort und nicht
danach, ob Mietfuchs dort schreiben dürfte. Das ist Absicht: Sonst landeten die Daten bei einem
Start mit Administratorrechten an einer Stelle, an der Sie sie als gewöhnlicher Benutzer nicht
wiederfänden.

Mit der Umgebungsvariablen `NKA_DATA_DIR` können Sie jeden anderen Ordner vorgeben. Sie hat
Vorrang vor allem oben.

---

## Wenn der Umzug nicht gelingt

**Verloren ist dann nichts.** Ihre Daten stehen unverändert in der bisherigen Datei, Mietfuchs
sagt Ihnen in der Oberfläche, woran es lag, und beim nächsten Start wird es erneut versucht.

Solange der Umzug nicht gelungen ist, zeigt Mietfuchs Ihre Daten nicht an. Auch das ist Absicht:
Es könnte stattdessen die noch leere Datenbank zeigen, aber dann sähen Sie ein leeres Haus, und
alles, was Sie hineinschrieben, stünde danach als zweiter Bestand neben Ihrem eigentlichen.

---

## Zurück zu einer älteren Version

Vor jedem Update der Datenbank legt Mietfuchs eine Sicherung daneben, im Datenordner als
`mietfuchs.sqlite.vor-<Schritt>`. Mit ihr kommen Sie zurück:

1. Mietfuchs beenden.
2. `mietfuchs.sqlite` beiseitelegen, also umbenennen oder in einen anderen Ordner verschieben,
   **nicht löschen**: Darin steht alles, was Sie nach dem Update eingetragen haben.
3. Die Sicherung des **ersten** Schritts, den die neue Version angewandt hat, in
   `mietfuchs.sqlite` umbenennen. Beim Update auf die Version mit mehreren Objekten ist das
   `mietfuchs.sqlite.vor-0001_objekte`. Liegen mehrere Sicherungen da, ist es die mit der
   kleinsten Nummer aus diesem Update, und zwar die ohne Zusatz am Ende: Eine Datei wie
   `….vor-0001_objekte.vom-2026-08-01-0930` ist ein älterer Stand von einem früheren Versuch,
   den Mietfuchs beim erneuten Update beiseitegelegt hat.
4. Die ältere Version starten.

Was Sie seit dem Update eingegeben haben, fehlt dann. Umgekehrt ist nichts zu befürchten: Eine
ältere Version erkennt eine Datenbank aus einer neueren, arbeitet nicht mit ihr, sondern sagt es
in der Oberfläche, und verändert sie dabei nicht.

Wollen Sie bei der neuen Version bleiben und nur den Stand von vor dem Update zurück, geht das ohne
Umbenennen: Auf der Seite „Verlauf“ steht die Sicherung als „Vor dem Update auf Version …“ (oder „Vor
einem Update“). „Zu diesem Stand zurückkehren …“ spielt sie ein und bringt sie auf den Stand der neuen
Version; Ihre aktuellen Daten bleiben vorher als `mietfuchs.sqlite.vor-restore` erhalten. Mietfuchs
behält die Sicherungen vor einem Update aus den letzten zwölf Monaten, mindestens aber die drei
jüngsten, und räumt ältere selbst weg.

### Woher die ältere Version kommt

Die Schritte oben gelten im Datenordner der Fassung, die Sie nutzen (siehe
[Wo der Datenordner liegt](#wo-der-datenordner-liegt)). Die ältere Version selbst bekommen Sie so:

- **Aus dem Microsoft Store:** Der Store bietet nur die neueste Version an. Deinstallieren Sie die
  Store-Fassung (Ihr Datenordner `%USERPROFILE%\Mietfuchs` bleibt dabei liegen) und installieren Sie
  den Installer `Mietfuchs-Setup-<Version>.exe` der gewünschten Version von der
  [Release-Seite](https://github.com/speedone/mietfuchs/releases). Er nutzt denselben Datenordner.
- **Mit dem Installer:** Deinstallieren Sie Mietfuchs unter *Einstellungen → Apps* (der Datenordner
  bleibt liegen) und starten Sie den Installer der älteren Version. Schalten Sie danach unter „Über
  Mietfuchs“ die Update-Prüfung aus, sonst lädt Mietfuchs die neuere Version wieder und bietet sie an.
- **Auf dem Mac:** das Abbild (`.dmg`) der älteren Version laden, Mietfuchs in *Programme* ziehen und
  *Ersetzen* wählen.

Den Installer und die Abbilder gibt es ab Version 0.15. Wollen Sie zu einer Version davor zurück,
also zur Programmdatei, und sind Ihre Daten umgezogen, liegt im alten Ordner `data` noch der Stand
vom Tag des Umzugs, samt den Sicherungen vor Updates von damals. Eine Programmdatei bis 0.14 arbeitet
damit wie früher; was Sie seit dem Umzug im neuen Programm eingetragen haben, fehlt dort.

### Der Ordner `vorversionen/`

Unabhängig von Updates legt Mietfuchs höchstens einmal in der Woche eine ganze Kopie der Datenbank
an, im Datenordner unter `vorversionen/` (Name mit Datum und Uhrzeit in UTC), und behält die vier
jüngsten. Sie hilft bei einem Bedienfehler, etwa einer versehentlich gelöschten Wohnung: Auf der Seite
„Verlauf“ steht sie als „Wöchentliche Sicherung“, und „Zu diesem Stand zurückkehren …“ spielt sie ein.
Für den Weg zurück zu einer älteren Version taugt sie nicht, denn sie hat schon den Stand der Version,
die sie angelegt hat. Die Kopien sind nicht im Backup-ZIP und ziehen beim Umzug ins neue Programm
nicht mit.

### Vor der Datenbank (v0.7.x)

Zurück zu einer Version vor der Datenbank (v0.7.x) geht es anders: Dort benennen Sie
`db.json.abgeloest` wieder in `db.json` um und legen `mietfuchs.sqlite` beiseite. Was Sie seit dem
Umstieg eingegeben haben, fehlt dann.

---

## Backup

Am Backup ändert sich nichts: **diesen Ordner kopieren.** Wer lieber auf den Knopf drückt, bekommt
unter „Einstellungen“ weiterhin eine ZIP-Datei, in der jetzt auch die Datenbank liegt.
