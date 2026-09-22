# Daten aus einer älteren Mietfuchs-Version übernehmen

Diese Anleitung ist für Sie, wenn Sie Mietfuchs schon einmal benutzt haben und Ihre Daten in die
aktuelle Version bekommen wollen. Sie brauchen dafür keine technischen Kenntnisse.

Seit Version 0.8 liegen die Daten in einer Datenbank (`mietfuchs.sqlite`) statt in der Datei
`db.json`. **Sie müssen dafür nichts tun.** Beim ersten Start wandern vorhandene Daten von selbst
hinüber, und Mietfuchs sagt Ihnen in der Oberfläche, dass es passiert ist.

Bevor der Umzug gilt, rechnet Mietfuchs Abrechnung, Verbrauchsübersicht, Mietkonto und
Steuerübersicht für jedes Jahr, in dem etwas erfasst ist, aus beiden Beständen nach und
vergleicht sie **auf den Cent**. Weicht ein einziger ab, wird nichts übernommen, und Sie erfahren,
in welchem Jahr und in welcher Zahl.

Suchen Sie sich unten heraus, was auf Sie zutrifft.

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

Also die ZIP-Datei, die beim Klick auf „Backup herunterladen" entsteht.

1. Installieren und starten Sie die neue Version.
2. Gehen Sie auf **Einstellungen** und wählen Sie **Backup wiederherstellen**.
3. Wählen Sie Ihre ZIP-Datei aus.

**Das gilt auch für alte Archive**, die noch keine Datenbank enthalten, weil es sie damals nicht
gab. Mietfuchs erkennt das und baut die Datenbank aus den wiederhergestellten Daten neu auf, mit
derselben centgenauen Nachrechnung wie oben.

Zwei Dinge, die Sie wissen sollten. Wiederherstellen erwartet das **Archiv**, also die ZIP-Datei,
und keine einzelne Datei. Das hat sich nicht geändert: Mietfuchs nimmt hier seit jeher ein ZIP.
Gelockert wurde die Anforderung sogar, denn früher musste eine `db.json` darin sein, heute genügt
eines von beidem. Und Ihr bisheriger Stand wird vorher beiseitegelegt, als `db.json.vor-restore`
und `mietfuchs.sqlite.vor-restore`, falls Sie sich vertan haben.

Passt am Archiv etwas nicht, lehnt Mietfuchs es ab, **bevor** irgendetwas ersetzt ist, und nennt
jede Beanstandung mit Stelle und Grund. Ihre bisherigen Daten sind dann unverändert.

---

## Sie haben nur noch eine einzelne Datei `db.json`

Zum Beispiel, weil Sie damals nur diese eine Datei gesichert haben.

1. Finden Sie den Datenordner der neuen Version (siehe unten).
2. Legen Sie die Datei dort hinein. Sie muss genau `db.json` heißen.
3. Haben Sie auch Belege, legen Sie diese in einen Unterordner `uploads` daneben.
4. Starten Sie Mietfuchs.

Der Umzug läuft dann genauso wie oben. Auch sehr alte Dateien gehen: Formate aus der Zeit vor der
Vorauszahlungs-Staffel und vor den KI-Einstellungen werden beim Übernehmen mitgezogen.

---

## Wo der Datenordner liegt

**Am einfachsten lassen Sie sich das von Mietfuchs sagen.** Beim Start steht der Ordner in der
zweiten Zeile:

```text
Mietfuchs-Server läuft auf http://127.0.0.1:3001
Daten: C:\Users\Beispiel\AppData\Local\Mietfuchs
```

Sehen Sie kein Fenster mit Text, weil Sie Mietfuchs über das Startmenü geöffnet haben, dann
rufen Sie im Browser `http://127.0.0.1:3001/healthz` auf. Dort steht unter `database` bei `file`
der vollständige Pfad zur Datenbank; der Ordner darüber ist Ihr Datenordner.

Falls Sie doch selbst suchen wollen, hängt der Ort davon ab, wie Sie Mietfuchs starten:

| So starten Sie Mietfuchs | Dort liegen die Daten |
| --- | --- |
| Programmdatei per Doppelklick | Ordner `data` **neben** der Programmdatei |
| Aus einem Linux-Paket (deb, rpm, Arch) | `~/.local/share/mietfuchs` |
| Programmdatei unter Windows aus `Programme` | `%LOCALAPPDATA%\Mietfuchs` |
| Programmdatei unter macOS aus `/Applications` | `~/Library/Application Support/Mietfuchs` |
| Aus dem Quellcode (`npm start`) | `server/data` im Projektordner |
| Als Docker-Container | im eingebundenen Datenträger, im Container `/app/server/data` |

Aus einem Paket oder einem Systemordner heraus kann Mietfuchs nicht neben sich schreiben, deshalb
liegen die Daten dann in Ihrem Benutzerordner. Das ist Absicht: Sonst landeten sie bei einem Start
mit Administratorrechten an einer Stelle, an der Sie sie als gewöhnlicher Benutzer nicht wieder
fänden.

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

## Backup

Am Backup ändert sich nichts: **diesen Ordner kopieren.** Wer lieber auf den Knopf drückt, bekommt
unter „Einstellungen" weiterhin eine ZIP-Datei, in der jetzt auch die Datenbank liegt.
