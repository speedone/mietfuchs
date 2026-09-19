# Changelog

Alle nennenswerten Änderungen an Mietfuchs. Das Format orientiert sich an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionen an
[Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Geändert

- **Docker-Image läuft mit Node 24.** Das ist die aktuelle LTS-Version von Node mit
  Sicherheitsupdates bis April 2028. Bisher lief das Image mit Node 22.
  ([#15](https://github.com/speedone/mietfuchs/issues/15))

### Hinweise zur Aktualisierung

- Wer Mietfuchs aus dem Quellcode mit `npm start` betreibt, braucht jetzt mindestens Node 22.
  Node 20 bekommt seit April 2026 keine Sicherheitsupdates mehr und wird nicht mehr getestet.
  Programmdateien und Docker-Image bringen ihre Laufzeit selbst mit, dort ist nichts zu tun.

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

[Unveröffentlicht]: https://github.com/speedone/mietfuchs/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/speedone/mietfuchs/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/speedone/mietfuchs/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/speedone/mietfuchs/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/speedone/mietfuchs/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/speedone/mietfuchs/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/speedone/mietfuchs/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/speedone/mietfuchs/releases/tag/v0.1.0
