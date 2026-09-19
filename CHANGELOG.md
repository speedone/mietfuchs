# Changelog

Alle nennenswerten Änderungen an Mietfuchs. Das Format orientiert sich an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionen an
[Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Hinzugefügt

- **Modelle lassen sich aus Mietfuchs laden.** In den Einstellungen steht neben einem fehlenden
  Modell ein Knopf „Modell laden“: Mietfuchs holt es über Ollama und zeigt den Fortschritt.
  Abbrechen ist möglich, ein späterer Versuch setzt dort an, wo der letzte aufgehört hat. Vorher
  fragt Mietfuchs nach, denn Modelle sind mehrere Gigabyte groß. Der Befehl fürs Terminal steht
  weiterhin daneben. ([#33](https://github.com/speedone/mietfuchs/issues/33))
- **Installationspakete für Linux.** Neben dem Archiv gibt es Mietfuchs jetzt als `.deb`
  (Debian, Ubuntu, Mint), `.rpm` (Fedora, openSUSE, RHEL und Verwandte) und als Paket für Arch
  Linux, je für x64 und ARM64. Installiert wird mit dem gewohnten Befehl der Distribution;
  danach steht Mietfuchs mit Symbol im Startmenü. Die Daten liegen dann in
  `~/.local/share/mietfuchs`, weil ein Programm in `/usr/bin` nicht neben sich schreiben darf.
  Wer das Archiv nutzt, behält seinen Ordner `data/` neben der Programmdatei. Der Update-Hinweis
  erklärt in einer Paketinstallation den Weg über die Paketverwaltung.
  ([#25](https://github.com/speedone/mietfuchs/issues/25))
- **Beim Start steht im Programmfenster, wo die Daten liegen.** Wer sie sichern oder umziehen
  will, muss den Ordner nicht mehr suchen.
  ([#25](https://github.com/speedone/mietfuchs/issues/25))
- **Empfehlungen, welches Modell taugt.** Die Einstellungen zeigen einige Modelle mit Größe,
  Bildverständnis und den Messwerten des KI-Prüflaufs. Mit eingeschalteter Update-Prüfung holt
  Mietfuchs höchstens einmal am Tag die aktuelle Liste aus dem Repo, sonst gilt die
  mitgelieferte. Empfehlungen belegen nur vor, jedes andere Modell lässt sich weiterhin
  eintragen. ([#33](https://github.com/speedone/mietfuchs/issues/33))

### Behoben

- **Rechnungen mit Nettopositionen werden richtig übernommen.** Weisen Handwerker oder
  Schornsteinfeger die Positionen ohne Umsatzsteuer aus und nennen sie erst in der Summe,
  rechnet Mietfuchs die Positionen jetzt selbst auf den Rechnungsbetrag hoch, statt die
  Nettobeträge zu übernehmen. Ein Hinweis nennt das, damit man es prüfen kann.
  ([#34](https://github.com/speedone/mietfuchs/issues/34))
- **Der Arbeitskostenanteil nach §35a geht nicht mehr verloren**, wenn die Rechnung ihn nur als
  einen Betrag nennt („Im Rechnungsbetrag sind Arbeitskosten von 90,56 € enthalten“). Mietfuchs
  verteilt ihn nach Beträgen auf die Positionen und weist darauf hin.
  ([#34](https://github.com/speedone/mietfuchs/issues/34))

## [0.6.0] – 2026-09-19

### Hinzugefügt

- **KI-Dienste neben Ollama.** In den Einstellungen lässt sich statt Ollama auf dem eigenen
  Rechner auch ein Dienst im Internet einstellen: OpenAI, IONOS AI Model Hub, Mistral, Ollama
  Cloud, LM Studio oder jeder andere OpenAI-kompatible Dienst. Vorlagen belegen die Adresse
  vor, ändern lässt sich alles. Ein Beleg dauert dort Sekunden statt Minuten und kostet
  Bruchteile eines Cents. ([#18](https://github.com/speedone/mietfuchs/issues/18))
- **Belege gehen erst nach einer Bestätigung aus dem Haus.** Zeigt die Adresse ins Internet,
  oder reicht Ollama das Modell an einen Cloud-Dienst weiter, fragt Mietfuchs einmal nach,
  mit Link zu den Bedingungen des Anbieters. Die Bestätigung gilt für genau diese Adresse und
  lässt sich widerrufen. Kosten und Schnellerfassung zeigen, wohin die Belege gehen.
  ([#18](https://github.com/speedone/mietfuchs/issues/18))
- **API-Schlüssel liegen getrennt von der Datenbank** in `data/secrets.json`, unter Linux und
  macOS nur für den eigenen Benutzer lesbar. Sie sind nicht im Backup und gehen nie an den
  Browser zurück. Im Container legen `NKA_AI_API_KEY` oder `NKA_AI_API_KEY_FILE` (Docker-Secret)
  den Schlüssel fest. ([#18](https://github.com/speedone/mietfuchs/issues/18))
- **Erweiterte Einstellungen für die KI:** ein eigener Anbieter für Fotos und Scans, Zeitlimit,
  Kontextgröße, Länge der Antwort, Stufe der strukturierten Ausgabe, Denkaufwand und
  zusätzliche Hinweise an das Modell. Dazu die Variablen `NKA_AI_PROVIDER`, `NKA_AI_URL`,
  `NKA_AI_MODEL` und `NKA_AI_MAX_TOKENS`. ([#18](https://github.com/speedone/mietfuchs/issues/18))
- **Programmdateien für Linux und Windows auf ARM**, etwa für einen Raspberry Pi 4 oder 5 mit
  64-Bit-System oder Windows-Laptops mit Snapdragon-Prozessor. Der Update-Hinweis kennt die
  neuen Dateien. ([#22](https://github.com/speedone/mietfuchs/issues/22))
- **Jede Programmdatei wird vor dem Release auf ihrem System gestartet und geprüft**, auf
  Windows, macOS und Linux jeweils mit Intel/AMD und ARM. Die Linux-Dateien laufen dabei
  zusätzlich auf 15 Distributionen, das Docker-Image auf beiden Plattformen. Ins Release
  kommt nur, was alle Prüfungen besteht. ([#22](https://github.com/speedone/mietfuchs/issues/22))
- **Ollama lässt sich leichter einrichten.** Die Einstellungen zeigen die installierten Modelle
  zur Auswahl, mit Größe und ob ein Modell Bilder versteht. Fehlt das gewählte Modell, steht der
  Befehl zum Laden mit Kopier-Knopf daneben. Antwortet Ollama unter einer anderen üblichen
  Adresse, etwa vom Docker-Container aus, schlägt Mietfuchs sie zur Übernahme vor.
  ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Ollama im Docker-Container:** `docker compose --profile ki up -d` startet Ollama mit und
  lädt das Modell einmalig. ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Umgebungsvariablen für die KI-Auswertung:** `NKA_OLLAMA_URL` und `NKA_OLLAMA_MODEL` legen
  Adresse und Modell fest, die Einstellungen zeigen sie dann gesperrt. `NKA_OLLAMA_NUM_CTX`
  ändert die Kontextgröße, `NKA_AI_TIMEOUT` das Zeitlimit.
  ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Fortschritt und Abbrechen bei der KI-Auswertung.** Kosten und Schnellerfassung zeigen, was
  das Modell gerade tut und wie lange es schon läuft. „Abbrechen“ und das Verlassen der Seite
  stoppen auch das Modell. ([#17](https://github.com/speedone/mietfuchs/issues/17))

### Behoben

- **Lange KI-Auswertungen brechen nicht mehr nach fünf Minuten ab.** Auf einem Rechner ohne
  Grafikkarte kann ein gescannter Beleg länger dauern. Dann endete die Auswertung nach fünf
  Minuten mit „Ollama nicht erreichbar“, in Firefox auch schon im Browser. Jetzt gilt nur das
  eigene Zeitlimit von 20 Minuten. ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Ollama las lange Belege nur teilweise.** Ohne Angabe nimmt Ollama auf den meisten Rechnern
  4.096 Token Kontext und kürzt längere Anfragen, ohne es zu melden. Mietfuchs setzt jetzt
  16.384. Neuere Modelle denken außerdem nicht mehr erst minutenlang nach, bevor sie antworten.
  ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Verständliche Meldungen bei der KI-Auswertung**, etwa wenn Ollama nicht läuft, das Modell
  fehlt oder die Antwort am Kontextende abgeschnitten wurde. Ein Modell ohne Bildverständnis
  bekommt keine Fotos und Scans mehr, statt sich eine Rechnung auszudenken.
  ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Das voreingestellte KI-Modell gab es nicht.** Mietfuchs schlug `qwen3.6-35b` vor, das es in
  der Ollama-Bibliothek nie gab. Neu voreingestellt ist `qwen3.5:4b`, ausgewählt mit einem
  Prüflauf an Beispielbelegen auf einem Rechner ohne Grafikkarte. Wer den alten Namen noch
  eingestellt hat, wird automatisch umgestellt.
  ([#17](https://github.com/speedone/mietfuchs/issues/17))
- **Die macOS-Programmdateien tragen eine gültige Signatur.** Die Datei für Intel-Macs war
  ungültig signiert. macOS 26 startet sie trotzdem, neuere Versionen beenden solche Programme
  aber sofort. Die macOS-Dateien werden jetzt auf einem Mac neu signiert und geprüft.
  ([#22](https://github.com/speedone/mietfuchs/issues/22))
- **Gescannte PDFs werden auch in der Programmdatei ausgewertet.** Bei PDFs ohne Textebene
  brach die KI-Auswertung in der Programmdatei mit „DOMMatrix is not defined“ ab. Im
  Docker-Image und beim Start aus dem Quellcode lief sie. Jetzt liest der Browser das PDF vor
  dem Hochladen: Er schickt die Textebene mit und bei Scans die ersten vier Seiten als Bilder.
  Das verhält sich in allen Betriebsarten gleich.
  ([#21](https://github.com/speedone/mietfuchs/issues/21))
- **Umlaute in Dateinamen bleiben erhalten.** Aus „Gebührenbescheid.pdf“ wurde beim Hochladen
  „Geb__hrenbescheid.pdf“. Bereits hochgeladene Belege behalten ihren Namen.
- **Fehler beim Hochladen erscheinen als verständliche Meldung**, etwa bei einer Datei über
  25 MB, statt als technische Fehlerseite. Passwortgeschützte oder beschädigte PDFs werden
  ebenfalls klar benannt.
- **Belegkopien im Druck und die Auswertung von PDFs laufen auch in etwas älteren Browsern.**
  pdf.js wird jetzt in der Fassung für ältere Browser geladen (laut pdf.js ab Chrome 125,
  Safari 18 und Firefox ESR). Die bisherige Fassung setzte die allerneuesten Browser voraus.

### Sicherheit

- **Der Server enthält kein pdf.js mehr.** `npm audit` meldete für die dort genutzte Version
  eine Lücke, über die ein präpariertes PDF Code ausführen kann. Sie setzt Formular-Skripte
  voraus, die Mietfuchs nicht einschaltet, betroffen war Mietfuchs also nicht. Mit dem Wegfall
  ist die Meldung trotzdem erledigt.
- **Ein Backup wird vollständig geprüft, bevor die Wiederherstellung etwas ersetzt.** Ein
  präpariertes Archiv konnte bisher die Daten ersetzen und danach abbrechen, sodass ein halb
  wiederhergestellter Stand übrig blieb. Jetzt werden verdächtige Einträge abgelehnt, und
  ausgepackt darf ein Backup höchstens 1 GB groß werden.
  ([#23](https://github.com/speedone/mietfuchs/issues/23))
- **Alle Abhängigkeiten sind auf dem neuesten Stand**, darunter Express 5, Vite 8 und
  TypeScript 7. Damit sind die von `npm audit` gemeldeten Lücken geschlossen, etwa in `multer`
  (Überlastung durch präparierte Uploads) und `adm-zip` (übermäßiger Speicherverbrauch beim
  Wiederherstellen). Dependabot hält sie künftig aktuell.
  ([#23](https://github.com/speedone/mietfuchs/issues/23))

## [0.5.0] – 2026-09-19

### Hinzugefügt

- **Hinweis auf neue Versionen.** Beim ersten Start fragt Mietfuchs einmal, ob es bei neuen
  Versionen Bescheid geben soll. Nur mit Zustimmung sieht es beim Öffnen bei GitHub nach.
  GitHub sieht dabei nur die IP-Adresse und die installierte Versionsnummer. Gibt es eine neue
  Version, erscheint oben in der Seitenleiste ein Hinweis. Er führt zu einer Anleitung in den
  Einstellungen: bei der Programmdatei mit dem Download der passenden Datei und den Schritten
  für das eigene System, bei Docker und bei einer Installation aus dem Quellcode mit den
  nötigen Befehlen. „Später“ blendet den Hinweis bis zur nächsten Version aus. In den
  Einstellungen lässt sich die Prüfung jederzeit ein- und ausschalten oder von Hand anstoßen.
  Ein automatisches Update gibt es bewusst nicht.
  ([#14](https://github.com/speedone/mietfuchs/issues/14))

### Geändert

- **Docker-Image läuft mit Node 24.** Das ist die aktuelle LTS-Version von Node mit
  Sicherheitsupdates bis April 2028. Bisher lief das Image mit Node 22.
  ([#15](https://github.com/speedone/mietfuchs/issues/15))

### Behoben

- **Backup-Knöpfe in den Einstellungen sehen wie Knöpfe aus.** „Backup herunterladen“ erschien
  als einfacher Link und „Backup wiederherstellen“ wie normaler Text, obwohl beide anklickbar
  sind.
- **Die Zustandsprüfung `/healthz` nennt in der Programmdatei die richtige Version** statt
  „unbekannt“.

### Hinweise zur Aktualisierung

- Wer Mietfuchs aus dem Quellcode mit `npm start` betreibt, braucht jetzt mindestens
  Node 22.12. Node 20 bekommt seit April 2026 keine Sicherheitsupdates mehr und wird nicht mehr
  getestet. Programmdateien und Docker-Image bringen ihre Laufzeit selbst mit, dort ist nichts
  zu tun.

## [0.4.0] – 2026-09-19

### Hinzugefügt

- **Zustandsprüfung unter `/healthz`** für den Betrieb im Container. Die Adresse meldet
  „ok“, wenn die Daten lesbar sind und der Datenordner beschreibbar ist. Sonst antwortet
  sie mit HTTP 503, etwa bei einer beschädigten `db.json` oder einem schreibgeschützt
  eingehängten Datenordner. Das Docker-Image nutzt sie als `HEALTHCHECK`: `docker ps` zeigt
  dann *healthy* oder *unhealthy* an, auch wenn der Prozess hängt. Beitrag von
  [@thorstenhornung1](https://github.com/thorstenhornung1) in
  [#12](https://github.com/speedone/mietfuchs/pull/12).

### Behoben

- **Fehlende Verteilbasis wird gemeldet.** Fehlte bei einer Wohnung der Abrechnungseinheit die
  Wohnfläche oder bei einem Mietverhältnis die Personenzahl, verteilte der Schlüssel deren
  Anteil kommentarlos auf die übrigen Wohnungen: Die anderen Mieter zahlten mit. Fehlte die
  Angabe überall, ging der Betrag ebenso kommentarlos an den Vermieter, und dasselbe galt für
  eine Direktzuordnung auf eine Wohnung außerhalb der Abrechnungseinheit. Die Abrechnung meldet
  diese Fälle jetzt und nennt die betroffene Wohnung. Leerstand und Eigennutzung bleiben ohne
  Meldung. Außerdem bricht die Berechnung nicht mehr ab, wenn bei einer Wohnung die Angabe der
  Wohnfläche ganz fehlt. Beitrag von [@thorstenhornung1](https://github.com/thorstenhornung1) in
  [#10](https://github.com/speedone/mietfuchs/pull/10).
  ([#7](https://github.com/speedone/mietfuchs/issues/7))
- **§35a-Bescheinigung übersteigt nie den Lohnanteil der Rechnung.** Der Lohnanteil wurde je
  Abrechnungszeile einzeln gerundet. Zusammen konnten die Mieter dadurch mehr bescheinigt
  bekommen, als die Rechnung enthält, etwa 3 × 66,67 € = 200,01 € bei 200,00 € Lohnanteil.
  Jetzt bekommen die Mieter zusammen den auf ihre Kostenanteile entfallenden Lohnanteil,
  kaufmännisch gerundet und höchstens den der Rechnung. Diese Summe wird wie die Kosten
  centgenau verteilt. Tragen die Mieter die Position vollständig, stimmt die Summe genau.
  Ein negativer oder zu hoher Lohnanteil wird nicht bescheinigt, sondern gemeldet, und das
  Formular lehnt einen negativen Lohnanteil jetzt ab. Beitrag von
  [@thorstenhornung1](https://github.com/thorstenhornung1) in
  [#11](https://github.com/speedone/mietfuchs/pull/11).
  ([#7](https://github.com/speedone/mietfuchs/issues/7))

### Hinweise zur Aktualisierung

- In noch nicht abgeschlossenen Jahren kann sich der §35a-Betrag eines Mieters um 1 ct ändern.
  Die Kosten selbst und abgeschlossene Abrechnungen bleiben unverändert.

## [0.3.1] – 2026-09-19

### Behoben

- **Linux-Programmdatei startet auch ohne grafische Oberfläche.** Fehlte `xdg-open` — auf
  einem Server, in einem Container oder bei Anmeldung per SSH —, beendete sich die
  Programmdatei direkt nach dem Start, obwohl der Server schon lief. Jetzt erscheint ein
  Hinweis, die Adresse von Hand im Browser zu öffnen, und Mietfuchs läuft weiter. Beitrag von
  [@thorstenhornung1](https://github.com/thorstenhornung1) in
  [#8](https://github.com/speedone/mietfuchs/pull/8).
  ([#7](https://github.com/speedone/mietfuchs/issues/7))
- **Rundungscent hängt nicht mehr von der Reihenfolge der Daten ab.** Haben mehrere
  Mietverhältnisse exakt gleiche Anteile, etwa bei drei gleich großen Wohnungen, bleibt beim
  Verteilen ein Cent übrig. Wer ihn trägt, entschied bisher die Reihenfolge der
  Mietverhältnisse in der Datendatei. Jetzt entscheidet die interne Kennung des
  Mietverhältnisses, sodass dieselben Daten immer dieselbe Abrechnung ergeben. Beitrag von
  [@thorstenhornung1](https://github.com/thorstenhornung1) in
  [#9](https://github.com/speedone/mietfuchs/pull/9).
  ([#7](https://github.com/speedone/mietfuchs/issues/7))

### Hinweise zur Aktualisierung

- In noch nicht abgeschlossenen Jahren kann der Rundungscent bei gleichen Anteilen einem
  anderen Mieter zufallen als vorher. Abgeschlossene Abrechnungen bleiben unverändert.

## [0.3.0] – 2026-09-18

### Hinzugefügt

- **Nutzungsart je Wohnung.** Eine Wohnung ist jetzt entweder *vermietet*, *selbstgenutzt*
  oder *nicht beteiligt*. Selbstgenutzte Wohnungen zählen in die Verteilbasis von Wohnfläche,
  Wohneinheiten und Personenzahl; ihr Anteil erscheint im Vermieteranteil. Hintergrund:
  Betriebskosten aus einer Rechnung über das ganze Haus dürfen nur anteilig auf die Mieter
  umgelegt werden — der auf eine selbstgenutzte Wohnung entfallende Teil bleibt beim Vermieter,
  genauso wie der Anteil leerstehender Wohnungen. Für den Personenschlüssel lässt sich die
  Personenzahl des eigenen Haushalts hinterlegen.
  ([#3](https://github.com/speedone/mietfuchs/issues/3))
- **Umlageschlüssel „nach vereinbarten Anteilen (%)".** Feste Prozentanteile je Wohnung, wie
  sie im Mietvertrag vereinbart sein können (§556a Abs. 1 BGB). Die Anteile gelten absolut:
  Was unter 100 % fehlt, trägt der Vermieter — so lässt sich ein vereinbarter Eigenanteil
  abbilden. Bei einem Mieterwechsel wird der Anteil tagesanteilig geteilt.
  ([#5](https://github.com/speedone/mietfuchs/issues/5))
- **Eigenanteil als Betrag.** Abrechnung und Steuerübersicht weisen aus, welcher Teil des
  Vermieteranteils auf selbstgenutzte Wohnungen entfällt. Für die Anlage V ist dieser Teil
  privat veranlasst und damit nicht als Werbungskosten abziehbar; die Aufteilung nimmt die
  Übersicht weiterhin nicht automatisch vor.
- **Prüfzeile „Verteilbasis" im Cockpit.** Weist auf Wohnungen hin, die als *nicht beteiligt*
  geführt werden, obwohl sie eine Wohnfläche haben — in diesem Fall tragen die Mieter deren
  Anteil mit.
- **Fertiges Docker-Image.** Das Image wird für `linux/amd64` und `linux/arm64` nach
  `ghcr.io/speedone/mietfuchs` veröffentlicht. Damit lässt sich Mietfuchs per `docker run`
  oder mit einer eigenständigen Compose-Datei starten, ohne das Repository zu klonen.
  ([#4](https://github.com/speedone/mietfuchs/issues/4))
- **`NKA_DATA_DIR`** verlegt den Datenordner auf einen beliebigen Pfad. Gedacht für Tests
  gegen einen Wegwerf-Ordner und für Installationen, deren Daten woanders liegen sollen.

### Behoben

- **Downloads für macOS und Linux lassen sich wieder direkt starten.** Die Programmdateien
  kommen jetzt als `.zip` (macOS) bzw. `.tar.gz` (Linux) statt als rohe Datei: HTTP überträgt
  keine Dateirechte, rohe Downloads verloren deshalb das Ausführungsrecht. Die Archive
  erhalten es, ein `chmod +x` entfällt. Die README beschreibt außerdem den seit macOS 15
  gültigen Weg, eine nicht signierte Programmdatei freizugeben. Beitrag von
  [@thorstenhornung1](https://github.com/thorstenhornung1) in
  [#2](https://github.com/speedone/mietfuchs/pull/2).
  ([#1](https://github.com/speedone/mietfuchs/issues/1))
- **Zählertyp wurde falsch gespeichert.** Das Feld war mit „Kaltwasser" vorbelegt, die Auswahl
  bot aber nur Typen an, für die Wohnungszähler existieren. Ohne Kaltwasserzähler zeigte das
  Feld deshalb den ersten angebotenen Typ an, gespeichert wurde trotzdem „Kaltwasser": die
  Kostenposition fand keinen passenden Verbrauch und landete vollständig im Vermieteranteil.
  Das Feld verlangt nun eine ausdrückliche Auswahl.
  ([#6](https://github.com/speedone/mietfuchs/issues/6))
- **Verteilbasis bei nicht vermieteten Wohnungen.** Wohnungen ohne Beteiligung fielen
  vollständig aus der Basis von Wohnfläche, Wohneinheiten und Personenzahl — die Mieter trugen
  dadurch den gesamten Rechnungsbetrag. Die neue Nutzungsart *selbstgenutzt* behebt das, sobald
  sie gesetzt ist (siehe *Hinweise zur Aktualisierung*). Beim Verbrauchsschlüssel war das schon
  vorher richtig, weil ein eigener Zähler die Basis mitbildet.
  ([#3](https://github.com/speedone/mietfuchs/issues/3))
- **Direktzuordnung auf eine nicht beteiligte Wohnung ließ einen Betrag verschwinden.** Bestand
  für die Wohnung im Abrechnungsjahr noch ein Mietverhältnis, wurde deren Anteil als verteilt
  gebucht, obwohl ihn niemand erhielt: Mieteranteile plus Vermieteranteil ergaben dann weniger
  als die Gesamtkosten. Der Betrag läuft jetzt in den Vermieteranteil.
- **Robustheit der Verteilung gegenüber unplausiblen Daten.** Prozentanteile über 100 % werden
  nicht mehr verteilt (sie hätten auch den §35a-Anteil über den Rechnungsbetrag getrieben),
  eine negative Personenzahl der eigenen Wohnung kann die Verteilbasis nicht mehr verkleinern,
  und widersprüchliche Kennzeichen an einer Wohnung (vermietet *und* selbstgenutzt) gelten als
  vermietet. Verweise auf gelöschte Wohnungen — bei Direktzuordnung wie bei Prozentanteilen —
  und fehlende Angaben an der selbstgenutzten Wohnung (Fläche, Personenzahl) erzeugen jetzt
  eine Warnung in der Abrechnung, statt stillschweigend die Mieter zu belasten.
- **Steuerübersicht folgt abgeschlossenen Abrechnungen.** Der ausgewiesene Eigenanteil stammt
  bei einer eingefrorenen Abrechnung aus deren Snapshot, damit Übersicht und versendete
  Abrechnung nicht auseinanderlaufen.
- **Packaging bricht bei echten Archivfehlern ab.** Bisher wurde jeder Fehler beim Verpacken
  als „Werkzeug nicht verfügbar" abgetan; ein fehlgeschlagenes Archiv fiel erst beim
  Release-Upload auf.

### Hinweise zur Aktualisierung

- Bestehende Daten rechnen unverändert weiter: Die Nutzungsart wird **nicht** automatisch
  gesetzt, weil das die Verteilung bereits abgerechneter Jahre verändern würde. Selbstgenutzte
  Wohnungen sind in den Stammdaten einmalig auf *Eigennutzung* zu stellen; das Cockpit weist
  darauf hin. Abgeschlossene (eingefrorene) Abrechnungen bleiben in jedem Fall unberührt.
- Kostenpositionen, die vor diesem Update mit Verbrauchsumlage gespeichert wurden, können noch
  den falschen Zählertyp „Kaltwasser" tragen. Die Auswahl zeigt den gespeicherten Typ jetzt
  korrekt an — betroffene Positionen einmal öffnen, den richtigen Typ wählen und speichern.

## [0.2.1] – 2026-07-07

### Behoben

- Die gepackte Binary öffnet den Browser auf `127.0.0.1` statt `localhost` — unter Windows
  führte die Namensauflösung sonst gelegentlich auf eine IPv6-Adresse, auf der der Server
  nicht lauschte.

## [0.2.0] – 2026-07-07

### Hinzugefügt

- **Eigenständige Binaries** für Windows, macOS (Intel und Apple Silicon) und Linux, gebaut
  per Bun `--compile`. Eine Datei, kein Node nötig; die Daten liegen im Ordner `data/` neben
  der Programmdatei, der Browser öffnet sich automatisch.
- README-Anleitung zum Herunterladen und Starten der fertigen Binaries.

## [0.1.1] – 2026-07-07

### Behoben

- Fokus-Handling im Drawer stabilisiert.
- Routing des Dev-Proxys auf IPv6-Hosts korrigiert.

## [0.1.0] – 2026-06-13

Erste öffentliche Version: Erfassung von Kosten, Belegen und Zählerständen, centgenaue
Verteilung nach Wohnfläche, Personenzahl, Wohneinheiten, Verbrauch oder Direktzuordnung,
druckfertige Abrechnung je Mieter, Mietkonto, Steuerübersicht für die Anlage V, optionale
KI-Belegauswertung gegen eine lokale Ollama-Instanz, Backup und Wiederherstellung.

[Unveröffentlicht]: https://github.com/speedone/mietfuchs/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/speedone/mietfuchs/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/speedone/mietfuchs/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/speedone/mietfuchs/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/speedone/mietfuchs/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/speedone/mietfuchs/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/speedone/mietfuchs/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/speedone/mietfuchs/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/speedone/mietfuchs/releases/tag/v0.1.0
