# Belegbuchung auf dem Server

## Ziel

Eine Rechnung landet **genau einmal** in den Kosten. Das gilt für jeden Weg, auf dem sie ankommt:
Schnellerfassung, KI-Auswertung auf der Kostenseite, Posteingang des Belegordners, neben einer
Position aus „Aus dem Vorjahr übernehmen“. Es gilt auch, wenn jemand doppelt klickt, die Seite neu
lädt oder eine Anfrage nach einem Netzfehler wiederholt.

Erfolg heißt:

- Der Server kann eine Zeile einer Auswertung nicht zweimal buchen.
- Der Betrag einer verknüpften Position wird aus dem gespeicherten Stand berechnet, nie aus dem
  Zustand einer Browser-Seite.
- Alle drei Wege zeigen dieselbe Entscheidung, weil sie vom Server kommt. Was ein Knopf
  verspricht, ist wörtlich das, was der Server danach tut.
- Keine Zahl einer bestehenden Abrechnung ändert sich.

## Ausgangslage

Gemessen am Stand von PR #175 (`feat/belegordner`, 9a984c5):

- Das Ergebnis der KI wird nirgends gespeichert, nur das Rechnungsdatum. Positionen, Beträge,
  Rechnungssteller und Lohnanteil gehen nur an den Browser und sind nach dem Neuladen weg.
- Gebucht wird mit einzelnen `POST /api/costItems`, je Zeile eine Anfrage mit neuer Kennung. Es
  gibt keinen Schutz gegen Wiederholung. Scheitert die Antwort nach dem Speichern, bucht der
  zweite Versuch doppelt.
- Der einzige Verweis von der Position auf den Beleg ist `cost_items.invoice_file`, Freitext,
  nicht eindeutig. Ob eine Zeile schon gebucht ist, weiß nur die Seite, die sie anzeigt.
- Die fachliche Prüfung des Betrags (§35a, Gutschrift, Verteilung) läuft nur im Browser
  (`amountProblem`, `buildCostItemBody` in `client/src/costForm.ts`).
- Schnellerfassung (846 Zeilen) und Kostenseite (1.091 Zeilen) führen dieselbe Logik zweimal:
  Warteschlange, Abbildung der KI-Zeilen, Vorauswahl, Rückfrage, Gruppen und Verknüpfen.

Drei Durchsichten haben in dieser Logik nacheinander Geldfehler gefunden. Zwei Zeilen
derselben Kostenart aus einem Beleg verloren 800 €. Eine geschätzte §35a-Angabe blieb stehen.
Eine schon angelegte Zeile wurde beim Verknüpfen noch einmal addiert. Jeder Fehler wurde im
Browser behoben, und jede Behebung fand den nächsten Randfall. Die Ursache ist dieselbe: Der
Zustand einer Buchung lebt im Browser.

## Entscheidungen

### 1. Eine Auswertung ist ein gespeicherter Gegenstand

Zwei neue Tabellen, Migration `0013`, erzeugt mit `npm --prefix server run db:generate`:

**`assessments`**, eine Zeile je ausgewertetem Beleg:

| Spalte | Bedeutung |
| --- | --- |
| `id` | Kennung |
| `file` | der Beleg, Text wie `cost_items.invoice_file`, eindeutig (eine Auswertung je Datei) |
| `property_id` | Objekt, Fremdschlüssel mit `ON DELETE SET NULL`, wie bei `uploads` |
| `year` | Zieljahr der Buchung: das Jahr aus dem Beleg, sonst das gewählte; änderbar |
| `vendor`, `invoice_date`, `total_gross_cents` | was die KI gelesen hat |
| `created_at` | Zeitpunkt der Auswertung |

**`assessment_lines`**, eine Zeile je Position der Rechnung:

| Spalte | Bedeutung |
| --- | --- |
| `assessment_id`, `idx` | Primärschlüssel; `ON DELETE CASCADE` |
| `description`, `category` | gelesen, im Browser vor dem Buchen änderbar |
| `amount_cents`, `labor35a_cents` | gelesen; **`null` heißt „nicht gelesen“**, 0 ist eine Angabe |
| `booking` | `created`, `linked` oder `null` |
| `cost_item_id` | die Position, Fremdschlüssel mit `ON DELETE SET NULL` |
| `dismissed` | vom Nutzer verworfen |

Der Zustand einer Zeile wird **abgeleitet und nicht gespeichert**:

- Ohne `cost_item_id` ist sie offen, mit `dismissed` verworfen.
- Mit `cost_item_id` ist sie angelegt oder verknüpft, je nach `booking`.

So setzt das Löschen einer Position die Zeile von selbst wieder auf offen. Ein zweites Feld, das
dabei nachgezogen werden müsste, gibt es nicht.

Eine Auswertung wird **nur bei Erfolg** gespeichert. Ein Abbruch speichert nichts, wie heute.
Wird derselbe Beleg erneut ausgewertet, ersetzt die neue Auswertung **nur die offenen und
verworfenen Zeilen**. Gebuchte Zeilen bleiben stehen, mit ihren Nummern.

### 2. Der Betrag einer verknüpften Position ist die Summe ihrer Zeilen

Wird eine Zeile mit einer bestehenden Position verknüpft, setzt der Server deren Betrag auf **die
Summe aller Zeilen, die mit ihr verknüpft sind**, über alle Belege. Den §35a-Lohnanteil bestimmt
er nach derselben Regel:

- Haben die verknüpften Zeilen einen gelesenen Lohnanteil, gilt deren Summe.
- Hat keine einen gelesenen Lohnanteil und die Position einen, wird er entfernt. Die Vorschau
  sagt das vorher wörtlich.

Der Server rechnet die Summe bei jeder Buchung, die die Position berührt, neu aus dem
gespeicherten Stand. Dadurch kann keine Zeile doppelt zählen, egal wie oft gebucht wird.

Geschätzte Beträge werden ersetzt:

- Hatte die Position vorher einen Betrag ohne verknüpfte Zeilen, etwa eine Schätzung aus der
  Vorjahresübernahme, wird er ersetzt. Die Vorschau nennt alten und neuen Betrag.
- Hat jemand den Betrag einer verknüpften Position später von Hand geändert, ersetzt die nächste
  Buchung, die diese Position berührt, ihn ebenfalls. Auch das sagt die Vorschau vorher.

Zwei Belege an einer Position, etwa Abschlag und Restrechnung, ergeben die Summe beider.
`invoice_file` der Position bleibt der zuerst verknüpfte Beleg. Der zweite gilt trotzdem als
gebucht und steht nicht im Posteingang (siehe 6).

### 3. Drei Routen

1. **Auswerten:** `/api/extract` und `/api/intake`, unverändert als Strom.
   - Am Ende speichert der Server die Auswertung. Das Ergebnis enthält zusätzlich die
     Auswertung mit einem **Vorschlag je Zeile**:
     - Kostenart und Umlageschlüssel aus dem Vorjahr (`previousAllocation`);
     - die Kandidaten nach der Doppelungsregel (`sameCostCandidates`);
     - die Ampel;
     - ob die Zeile vorab angehakt ist.
   - Dazu kommt `GET /api/assessments?property=…&open=1` für offene Auswertungen, damit
     Posteingang und Schnellerfassung nach dem Neuladen weitermachen können.
2. **Vorschau:** `POST /api/assessments/:id/plan`.
   - Der Browser schickt die Entscheidung je Zeile:
     - `{ idx, action: 'create', fields }`;
     - `{ idx, action: 'link', costItemId }`;
     - `{ idx, action: 'dismiss' }`;
     - `{ idx, action: 'release' }`.
   - `fields` sind die Angaben, die der Nutzer an der Zeile ändern kann: Beschreibung, Kostenart,
     Betrag, Lohnanteil, Schlüssel und Verteilung.
   - Der Server schreibt nichts. Er antwortet je betroffener Position mit Betrag und Lohnanteil
     danach, mit den Hinweisen in ganzen Sätzen und mit den Fehlern, die das Buchen verhindern.
3. **Buchen:** `POST /api/assessments/:id/book`, gleicher Rumpf, in einer Transaktion durch die
   Schreibschlange (`opened.write`).
   - Der Server prüft wie bei der Vorschau. Dann legt er an, verknüpft, verwirft oder löst und
     rechnet die Summen nach Entscheidung 2 neu.
   - **Eine Zeile, die nicht offen ist, wird nie noch einmal gebucht:**
     - Ist sie schon genau so gebucht, etwa nach einem Doppelklick oder einer Wiederholung, ist
       das ein Erfolg ohne Änderung.
     - Ist sie anders gebucht, antwortet der Server mit 409 und dem aktuellen Stand.
   - Die Antwort ist die Auswertung nach der Buchung.

`release` löst eine verknüpfte Zeile wieder:

- Die Zeile wird offen, und die Summe der Position wird aus den übrigen Zeilen neu gerechnet.
- Bleibt keine Zeile übrig, behält die Position ihren Betrag, und die Vorschau sagt das.
- Eine angelegte Zeile löst man, indem man die Position löscht. Das ist der gewohnte Weg, und die
  Zeile wird dadurch von selbst wieder offen.

### 4. Regeln beim Buchen

- **Ziele:** Nur Positionen desselben Objekts und desselben Jahres (`year` der Auswertung).
  Alles andere ist ein Fehler, kein stilles Umbiegen.
- **Kein Ein-Klick-Verknüpfen** mit Positionen mit Einzelbeträgen je Mieter (`amounts`) und
  „laut Gemeinschaftsabrechnung“ (`external`).
  - Beim einen hinge die Summe an den Mietern, beim anderen ist der Betrag der eigene Anteil und
    nicht die Rechnung.
  - Die Vorschau bietet dort „Position öffnen“ an.
- **Eine Gutschrift wird nie verrechnet.** Eine Zeile mit negativem Betrag kann angelegt, aber
  nicht verknüpft werden. Ergäbe eine Verknüpfung eine negative oder eine Null-Summe, ist das ein
  Fehler.
- **Vorauswahl:** Eine Zeile mit Kandidaten nach der Doppelungsregel oder mit roter Ampel ist nie
  vorab angehakt. Entscheidet der Nutzer sich trotzdem fürs Anlegen, schickt der Browser das
  ausdrücklich. Die Rückfrage „Schon erfasst?“ stellt die Komponente aus der Vorschau.

### 5. Die Prüfungen wandern nach `shared/`

Die Prüfung des Betrags (`amountProblem`) und der Bau des Rumpfs einer Kostenposition
(`buildCostItemBody` samt den Prüfungen der Verteilung) ziehen aus `client/src/costForm.ts` nach
`shared/`. Sie sind Laufzeitanteil wie `shared/heating.ts`: Endung `.ts`, und das Dockerfile
übernimmt `shared/` schon.

- Das Formular und der Server benutzen dieselben Funktionen.
- Wo sie `parseEuro` oder Beschriftungen der Oberfläche brauchen, bekommen sie Cent und Codes
  herein, und die Oberfläche formuliert.

Die bisherigen Routen `POST` und `PUT /api/costItems` bleiben **vorerst unverändert**. Sie
ebenfalls streng zu prüfen, könnte bestehende Abläufe und alte Tabs brechen und ist ein eigener
Schritt.

### 6. Posteingang und Belegordner

- Posteingang ist ein Beleg **ohne gebuchte Zeile und ohne Position mit diesem `invoice_file`**.
- Ein Beleg mit offener Auswertung steht dort mit „Weiter prüfen“ statt „Per KI auswerten“.
- Ein Beleg, der nur über eine verknüpfte Zeile an einer Position hängt, zählt für die
  Belegabdeckung dieser Position wie ihr `invoice_file`. Die Karte im Belegordner nennt die
  Position.
- Zählerfotos bleiben, wie sie sind.

### 7. Oberfläche

- **Eine Komponente** „Auswertung prüfen“ zeigt Zeilen, Vorschläge, Kandidaten und die Vorschau
  des Servers und bucht. Schnellerfassung, KI auf der Kostenseite und Posteingang benutzen sie.
- Im Browser fallen weg:
  - die doppelte Warteschlangen- und Zeilenlogik beider Seiten;
  - `duplicateGroups`, `linkOffer`, `takenByReceipt` und die Summenlogik in `client/src/triage.ts`.
- Es bleiben:
  - die Zählerstände in der Schnellerfassung;
  - die Vorjahresübernahme, die Positionen ohne Beleg anlegt und von der Auswertung als
    Kandidat gefunden wird;
  - die Rückfrage im Kostenformular.
- Die Ampel (`scorePosition`) zieht nach `shared/` und wird vom Server mitgeliefert.
- Die KI auf der Kostenseite schickt künftig Objekt und Jahr mit. Ein nicht gebuchter Beleg landet
  dann im Posteingang des richtigen Objekts statt „ohne Objekt“.

### 8. Daten

- Backup und Wiederherstellen nehmen die Tabellen mit, denn sie liegen in der Datenbank. Der
  Praxislauf bekommt einen Fall: Backup mit offener und gebuchter Auswertung, wiederhergestellt,
  Zustände unverändert.
- Der Umstieg aus einer `db.json` ist nicht betroffen: Es gibt dort keine Auswertungen, und der
  eingefrorene Eingang bleibt unberührt.
- Bestehende Positionen und Belege bekommen keine Auswertung. Für sie gilt weiter `invoice_file`.
- Die Marke von 0013 wird im Migrationstest festgehalten.

## Nicht im Umfang

- Strengere Prüfung der allgemeinen Routen `POST`/`PUT /api/costItems`.
- Zählerfotos mit der Ablesung verknüpfen.
- Mehrere Auswertungen je Beleg (Fassungen). Eine erneute Auswertung ersetzt die offenen Zeilen.
- Wegklicken des Hinweises `cost.possible-duplicate` (bekannt aus #174, L5).

## Reihenfolge

Neuer Zweig `feat/belegbuchung` auf `feat/belegordner` (#175), eigener PR. Gemergt wird #174,
dann #175, dann dieser, dicht hintereinander. So erscheint die Zwischenfassung im Browser nie
allein in einem Release. Vor dem Merge kommen dazu:

- eine Integrationsdurchsicht des Endstands `main..feat/belegbuchung` mit den Blickwinkeln Geld
  und Daten;
- der Praxislauf;
- das Label `full-check` am obersten PR.

## Prüfung

**Server**, node:test:

- Zweimal hintereinander buchen ergibt eine Position. Zwei gleichzeitige Buchungen ergeben eine
  Position und eine Antwort ohne Änderung bzw. 409.
- Summenregel über mehrere Zeilen und über zwei Belege an einer Position.
- §35a: gelesener Wert, entfernter Schätzwert, ausdrückliche 0.
- Gutschrift wird angelegt und nie verknüpft.
- `external` und `amounts` sind keine Verknüpfungsziele.
- Ziel aus anderem Objekt oder Jahr ergibt einen Fehler.
- Löschen der Position setzt die Zeile auf offen.
- `release` rechnet die Summe neu.
- Erneutes Auswerten ersetzt nur offene Zeilen.
- Migration 0013 mit Marke.

**Abnahmefälle aus den drei Durchsichten**, als Servertests und jsdom-Tests:

- Wasser 700 € + 800 € gegen eine Schätzung von 1.500 € ergibt eine Position über 1.500 €.
- Restmüll 700 € mit Gutschrift −50 € ergibt zwei Positionen, 700 € und −50 €.
- Schätzung mit §35a 1.000 €, Rechnung ohne Lohnanteil: Der Lohnanteil wird mit Ansage entfernt.
- Derselbe Beleg zweimal ergibt keine zweite Buchung.

**Oberfläche:**

- jsdom-Tests für die drei Einstiege.
- Weiterprüfen nach dem Neuladen.
- Die Vorschau stimmt wörtlich mit dem Ergebnis der Buchung überein.

**Praktisch:** im Browser am Server mit nachgebautem Ollama:

- die vier Abnahmefälle;
- zwei Objekte;
- Handy-Breite 390 px.
