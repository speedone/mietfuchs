# Umlageschlüssel merken und Vorjahr übernehmen (#141)

## Ziel

Wer jedes Jahr dieselben Kosten erfasst, stellt Schlüssel, Teilnehmer und Maßstab nicht jedes Jahr
neu ein. Die Abnahme (Fall 3, Eigentumswohnung) hat 80 bis 100 Eingaben für zwölf Positionen
gemessen, obwohl sich nur die Beträge ändern.

## Entscheidungen

### 1. „Aus dem Vorjahr übernehmen“: eine Vorschau im Browser, keine Entwürfe in der Datenbank

Auf der Seite Kosten öffnet ein Knopf eine Liste der Positionen des Vorjahres **desselben
Objekts**. Je Zeile stehen Kostenart, Beschreibung (die Jahreszahl des Vorjahres als ganzes Wort
durch das neue Jahr ersetzt, „Grundsteuer 2025“ → „Grundsteuer 2026“), Rechnungssteller und der
Schlüssel samt Angaben (Zählertyp, Teilnehmer, vereinbarte Anteile, Wohnung der Direktzuordnung,
Maßstab und Summe der Anteile bei „laut Gemeinschaftsabrechnung“). Leer bleiben der Betrag, der
§35a-Anteil und bei der Gemeinschaftsabrechnung die Kosten der Gemeinschaft: Das sind die Zahlen
des Jahres. Kein Beleg wird übernommen.

Eine Zeile wird angehakt, sobald ein Betrag eingetragen ist, und lässt sich abhaken; nichts wird
ohne Klick angelegt. Eine angehakte Zeile ohne Betrag heißt „Betrag fehlt“ und verhindert die
Übernahme mit Nennung, wie bei der KI-Übernahme (#139).

**Warum keine Entwürfe in der Datenbank:** `amountProblem` lehnt 0 € ab, und das mit Grund. Eine
Position ohne Betrag in der Datenbank wäre entweder eine 0 (die in jede Rechnung als Kosten von
0 € einginge und in der Abrechnung als Zeile stünde) oder eine neue Spalte „Entwurf“, die jede
Rechnung, das Mietkonto, die Steuer, die Regression des Umstiegs, der Validator und das Backup
kennen müssten. Vergisst eine davon den Entwurf, rutscht er still in eine Abrechnung. Die Vorschau
braucht keinen Schemaeingriff, und gespeichert wird nur, was durch `buildCostItemBody` geht, also
dieselbe Prüfung wie im Formular. Der Preis: Wer die Vorschau verlässt, verliert die eingetragenen
Beträge. Das ist bei einer Liste, die man in einem Zug ausfüllt, vertretbar; die Seite meldet eine
offene Vorschau als offenes Formular (`useOpenForm`).

Positionen mit **Einzelbeträgen je Mieter** lassen sich nicht in einer Zeile übernehmen, weil die
Beträge je Mietverhältnis die Zahlen des Jahres sind. Für sie öffnet „Im Formular öffnen“ das
Formular mit dem Schlüssel des Vorjahres; dieser Weg steht jeder Zeile offen.

Steht im gewählten Jahr schon eine Position derselben Kostenart mit derselben Beschreibung, trägt
die Zeile den Vermerk „schon erfasst“, damit ein zweiter Durchgang nichts doppelt anlegt.

### 2. Schlüssel je Kostenart merken: abgeleitet aus dem Bestand, ohne Migration

Der „gemerkte“ Schlüssel ist der Schlüssel der Positionen derselben Kostenart **im Vorjahr
desselben Objekts** (`previousAllocation` in `shared/allocation.ts`). Haben die Positionen dort
verschiedene Schlüssel, gibt es keinen Vorschlag, denn welcher gemeint ist, weiß nur der
Vermieter. Eine Staffel „gilt ab Jahr“ je Kostenart, wie im Issue vorgeschlagen, wäre ein zweites
Abbild dessen, was die Positionen ohnehin tragen: Sie müsste bei jedem Speichern nachgeführt
werden, und zwei Wahrheiten über denselben Schlüssel laufen auseinander. Das Vorjahr ist genau die
Staffel, ohne eigene Tabelle; „ab welchem Jahr?“ beantwortet das Jahr der Position.

Der Vorschlag gilt beim Anlegen einer Position (Formular und Wechsel der Kostenart), in der
KI-Übernahme der Seite Kosten und der Schnellerfassung. Nur dort ersetzt er `suggestedKey`; eine
bestehende Position behält ihren Schlüssel. Bei der KI-Übernahme bekommt eine Zeile mit gemerktem
Schlüssel „laut Gemeinschaftsabrechnung“ ein Feld für die Kosten der Gemeinschaft; einen gemerkten
Schlüssel „Einzelbeträge“ übernimmt die KI-Zeile nicht, aus demselben Grund wie oben.

Die Auswahl des Schlüssels in der KI-Zeile zeigt den gemerkten Schlüssel als Eintrag, auch wenn er
nicht unter den drei einfachen steht: Angezeigt muss sein, was gespeichert wird.

**Weicht eine Position vom Vorjahr ab**, gibt es einen Hinweis (`key.changed-from-previous-year`,
Stufe `hint`) mit dem neuen Lexikonbegriff „Wechsel des Umlageschlüssels“, im Formular schon beim
Erfassen und in der Abrechnung. Hintergrund ist § 556a BGB, nachgelesen auf
gesetze-im-internet.de: Ein vereinbarter Schlüssel gilt, bis er mit Zustimmung geändert wird;
einseitig nur nach Abs. 2, durch Erklärung in Textform, nur vor Beginn eines
Abrechnungszeitraums und nur hin zu einem Maßstab nach Verbrauch oder Verursachung. Bei einer
vermieteten Eigentumswohnung gilt nach Abs. 3 der „jeweils geltende“ Maßstab der Gemeinschaft,
eine Änderung durch die Gemeinschaft wandert also mit. Der Hinweis behauptet deshalb keinen
Fehler, sondern nennt beides. Er ist kein Fehler und ändert keine Zahl.

Verglichen werden Schlüssel, Zählertyp, Wohnung der Direktzuordnung, vereinbarte Anteile,
Teilnehmer und Maßstab der Gemeinschaft, nicht die Summe der Anteile der Gemeinschaft: Sie ist
eine Angabe über die Anlage und kein Schlüssel. Dieselbe Regel (`sameAllocation`) nutzen Server
und Oberfläche, deshalb steht sie in `shared/`; so kann der Vorschlag nicht selbst den Hinweis
auslösen.

Der Schnappschuss bekommt dafür die Positionen des Vorjahres (`previousCostItems`, optional wie
`property`). Eingegrenzt wird weiter nur in `snapshotOf`. Fehlt die Angabe, etwa in Tests mit
handgebauten Schnappschüssen, entfällt nur der Hinweis. Die Regression des Umstiegs nimmt
Hinweise ohnehin aus.

### 3. Summe der MEA einmal statt an jeder Position: aus dem Bestand, Spalte am Objekt als Folgearbeit

Die Summe der Miteigentumsanteile kommt bei jeder Übernahme aus dem Vorjahr ohnehin mit. Für das
erste Jahr gilt: Wechselt eine neue Position auf „laut Gemeinschaftsabrechnung“, übernimmt sie
Maßstab und Summe der zuletzt erfassten Position dieses Schlüssels im Objekt
(`lastExternalBasis`). Das kostet keine Migration und trifft den gemessenen Schmerz, die 1.000 an
jeder Position.

Dazu der kleine Teil aus #102, der hierher gehört: Bei einem Objekt der Art „Eigentumswohnung“
schlägt das Formular ohne Vorjahr „laut Gemeinschaftsabrechnung“ vor statt Wohnfläche oder
Personenzahl, außer bei der Grundsteuer, die die Gemeinde dem Eigentümer unmittelbar festsetzt.

**Bewusst nicht gemacht:** eine Spalte „Gesamt-MEA“ und „Standard-Maßstab“ am Objekt sowie die
Hausgeldabrechnung als Klammer mit Kopf und Positionen. Beides braucht eine Migration (Spalte am
Objekt, gegebenenfalls eine eigene Tabelle für die Klammer), Stammdaten-Oberfläche, Backup- und
Umstiegsprüfung, und die Klammer ist genau das, was die KI-Belegart „Hausgeldabrechnung“ (#102)
erzeugen soll. Es gehört deshalb mit #102 zusammen geplant. Ist die Spalte da, ersetzt sie
`lastExternalBasis` als Quelle, ohne dass sich an der Übernahme etwas ändert.

## Zahlen

Keine Zahl einer bestehenden Abrechnung ändert sich: Übernahme und Vorschlag belegen nur Formulare
vor, gespeichert wird über dieselben Wege wie bisher; der neue Hinweis ist ein Hinweis.
