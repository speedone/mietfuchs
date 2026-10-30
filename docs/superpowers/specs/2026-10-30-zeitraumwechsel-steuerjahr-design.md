# Zeitraumwechsel behält das angegebene Jahr der Zahlung (#478)

Fehler mit `priority: high` (falsche Zahl in der Steuer). Teil des Releases „Quellrechnung und Steuerjahr“ (0.14.0),
**erster PR des Stapels** (Release-Plan `2026-10-30-release-0.14-plan.md`, Nr. 1), weil #96 PR 1 und #262 auf
einem Jahr der Zahlung im Kalenderzeitraum aufbauen (Durchsicht X1, R-A). Rechtsaussagen tragen ihre Quelle.

## Befund

Eine Position hat ein Jahr der Zahlung (`taxYear`), aber kein Zahlungsdatum (`paidOn`). Ein Wechsel des
Abrechnungszeitraums legt einen Teil davon in einen Zeitraum, der ganz in einem Kalenderjahr liegt. Dann nimmt der Teil
still dieses Kalenderjahr an (Gartenpflege, bezahlt 2025: 227,66 € landen in 2026; Gutschrift, erhalten 2026:
−31,12 € landen in 2025). Die Vorschau fragt nicht, weil `taxYears` nur für Zeiträume über zwei Kalenderjahre
entsteht, und Hin- und Zurückwechseln mit den Vorgaben bringt die Jahre nicht zurück.

**Ursache im Code** (Stand `main` 8fbce5f6):

1. `keepsTaxYear` (server/src/db/periodChange.ts) hält nur `paidOn` und den Abzug beim Betriebsstrom fest, nicht ein
   angegebenes Jahr.
2. Die drei Funktionen „Jahr der Zahlung im Ziel“ (`taxYearIn` in der Vorschau mit Wirkung, `taxYearIn` beim Schreiben,
   `suggestedYear` in der Vorschau) liefern ohne Frage `null`; `producedRow` und `writeCostItemParts` schreiben dann
   kein Jahr.
3. `requireTaxYear` (server/src/db/repository.ts, ~1260) **lehnt** im Kalenderzeitraum jedes Jahr ≠ Startjahr ab
   („… zählt … deshalb zu {startYear}“). Selbst wenn (1) und (2) das Jahr hielten, schlüge das Schreiben über dieselbe
   Prüfung fehl. Der Fehler lässt sich also nicht allein in `keepsTaxYear` beheben.
4. Das Formular zeigt das Jahr nur bei einem Zeitraum über zwei Kalenderjahre (`showsTaxYear`, `taxYearOptions` in
   client/src/costForm.ts). Ein gespeichertes abweichendes Jahr im Kalenderzeitraum wäre unsichtbar.

## Rechtslage

Werbungskosten zählen im Jahr, in dem sie abfließen (§ 11 Abs. 2 Satz 1 EStG), Einnahmen im Jahr des Zuflusses (§ 11
Abs. 1 Satz 1 EStG; eine Gutschrift mindert im Jahr ihres Zuflusses). Das angegebene Jahr der Zahlung ist eine
Tatsache über die Zahlung; ein Wechsel des Abrechnungszeitraums ändert an ihr nichts. § 11 Abs. 2 EStG kennt keine
Spanne; die „übliche Spanne“ (`paidOnSpan`, Beginn − 1 bis Ende + 3) ist eine Plausibilitätsprüfung von Mietfuchs.

## Entscheidungen

### E1: Ein angegebenes Jahr bleibt stehen

`keepsTaxYear(item) = followsBill(item) || item.paidOn !== undefined || item.taxYear !== undefined`. Ein Helfer
`keptTaxYear(item): number | null` (das gespeicherte Jahr bei angegebenem `taxYear`, sonst `null`) wird von **allen
drei** Jahr-im-Ziel-Funktionen zuerst gefragt; erst danach die Antwort der Vorschau bzw. deren Vorgabe. So schreiben
Teilen (`splits`), Folgen (`follows`), Gruppen und `regrows` dasselbe Jahr, und `mergeTargetOf`/`yearOf` vergleichen
das gehaltene Jahr.

- **Die Vorschau fragt für solche Positionen kein Jahr**, auch nicht beim Ziel über zwei Kalenderjahre (wie bei einer
  datierten Position): Das Jahr ist schon beantwortet. Die Vorgabe des Ziels einer Gruppe richtet sich nicht danach
  (`shiftOf` zählt sie nicht).
- **Gleich dem Kalenderjahr des Ziels** bleibt das Jahr trotzdem gespeichert (keine Normalisierung auf „leer“): Es ist
  eine Angabe des Vermieters, und Zurückwechseln braucht sie. Beim Zusammenfassen gelten „leer“ und „gleich dem
  Startjahr eines Kalenderzeitraums“ als dasselbe Jahr (Vergleich über `storedOutflowYear`, nicht über das Feld), damit
  ein Teil mit gespeichertem Jahr nicht neben einem gleichen ohne Jahr stehen bleibt. Test.
- **Ohne Angabe** (kein Datum, kein Jahr; nur im Kalenderzeitraum möglich) gilt weiter das Kalenderjahr des Zeitraums.
  Wandert eine solche Position in ein anderes Kalenderjahr, verschiebt sich ihr Steuerjahr; das ist die bisherige,
  veröffentlichte Regel („ohne Datum gilt das Abrechnungsjahr“), und die Vorschau nennt es (E3).

### E2: `requireTaxYear` lässt ein abweichendes Jahr im Kalenderzeitraum zu

Neue Regel, für beide Arten von Zeiträumen gleich (eine Spanne statt zweier):

| Lage | bisher | neu |
|---|---|---|
| Kalenderzeitraum, kein Jahr | erlaubt | erlaubt (Jahr des Zeitraums) |
| Kalenderzeitraum, Jahr = Startjahr | erlaubt | erlaubt |
| Kalenderzeitraum, Jahr in der üblichen Spanne (`paidOnSpan`: Startjahr − 1 bis Endjahr + 3) | **400** | erlaubt |
| Zeitraum über zwei Jahre, Jahr fehlt und kein Datum | 400 | 400 (unverändert) |
| Zeitraum über zwei Jahre, Jahr Start bis Ende + 1 | erlaubt | erlaubt |
| Zeitraum über zwei Jahre, Jahr Start − 1 oder Ende + 2/+3 | 400 | erlaubt |
| Jahr außerhalb der Spanne (beide Arten) | 400 | **Rückfrage**: 409 `question: 'taxYear'`, bestätigt mit `confirmTaxYear: true` |
| Abzug beim Betriebsstrom | ohne Prüfung | ohne Prüfung (unverändert) |

- **Begründung**: Ein Jahr ist eine gröbere Angabe als ein Datum und bekommt dieselbe Spanne (`paidOnSpan`, R-4 aus
  #255) und dieselbe Haltung: außerhalb nachfragen statt ablehnen, denn § 11 Abs. 2 EStG kennt keine Grenze. Zwei
  Spannen für Jahr und Datum wären für Laien nicht zu erklären.
- Die Rückfrage entsteht wie `paidOnQuestions` in shared/paidOn.ts als reine Funktion `taxYearQuestions(before,
  after, span)` (gefragt nur, wenn sich das Jahr ändert; dieselben Sätze im Formular und am Server, mit ADVICE).
  **Nicht gefragt** wird beim Aufteilen und beim Wechsel des Zeitraums (`options.splitPart`, `options.periodChange`),
  wie bei `paidOn`: Dort ändert sich das Jahr nicht, oder es wurde für die ganze Rechnung schon gefragt.
- Neue Fehlerklasse `TaxYearQuestion` neben `PaidOnQuestion`, Antwort in index.ts neben der für `paidOn`.
- Ändert ein Jahr der Zahlung im Kalenderzeitraum das wirksame Jahr, fragt Mietfuchs **nicht** (wie heute beim
  Zeitraum über zwei Jahre). Die Steuerübersicht nennt die Position als verschoben (`shiftNotes`), das genügt.

### E3: Die Vorschau nennt jede Verschiebung zwischen Steuerjahren

- **Verschiebung** heißt: Das wirksame Jahr (`storedOutflowYear`) einer Position ist nach dem Wechsel ein anderes als
  vorher. Nach E1 kann das nur eine Position ohne Datum und ohne Jahr sein. Jeder Weg des Wechsels (Gruppe ganz,
  Gruppe geteilt, Quelle neu geteilt, `regrows`) nennt sie mit Betrag, altem und neuem Jahr (`taxShifts`,
  `splitNotes`); ein Test geht alle Wege durch.
- **Gehaltenes Jahr außerhalb der Kalenderjahre des Ziels** (die Position steht danach in der Steuer als verschoben):
  neue Liste `keptTaxYears: { costItemId, description, taxYear, label }[]` in der Vorschau, Satz: „„Gartenpflege“
  behält das Jahr der Zahlung 2025; im Zeitraum 2026 steht sie für die Steuer deshalb als verschoben.“ Sie geht in
  die Marke (`token`) ein. Liegt das gehaltene Jahr außerhalb der üblichen Spanne des Ziels, sagt der Satz das dazu.
- **Verteilte Positionen** (#262, später im Stapel): ändert sich ihr Jahr, nennt der Satz, dass sich alle Raten mit
  verschieben (steht in #262; hier nur der Platz im Satzbau).

### E4: Formular zeigt ein gespeichertes abweichendes Jahr

- `showsTaxYear(period, needsTaxYear, stored)`: wie bisher **oder** `stored` ist gesetzt und ≠ Startjahr eines
  Kalenderzeitraums. (#96 PR 1 ergänzt: immer bei der Kostenart „Entnahme Erhaltungsrücklage“.)
- `taxYearOptions(span, stored)`: die Jahre der üblichen Spanne (`paidOnSpan`), dazu das gespeicherte, wenn es
  außerhalb liegt. **Der angezeigte Wert entspricht immer dem gespeicherten** (CLAUDE.md, Tests Ebene 3: steht ein Wert
  nicht in den Optionen, zeigte der Browser den ersten und speicherte ihn). Ohne gespeichertes Jahr im
  Kalenderzeitraum bleibt das Feld unsichtbar, wie heute; der Leerwert ist „wie Abrechnungsjahr (2025)“.
- Rückfrage im Formular über `taxYearQuestions` vor dem Speichern, wenn das gewählte Jahr außerhalb der Spanne liegt
  (nur bei gespeichertem Ausreißer möglich).

### E5: Kein Datenschritt

Das überschriebene Jahr ist verloren; aus dem Bestand lässt es sich nicht zurückgewinnen (das Journal kennt es nur
für Wechsel innerhalb der Aufbewahrung von zwölf Monaten, und ein Zurückschreiben daraus wäre ein Rücksprung, keine
Migration). Deshalb im CHANGELOG und im Kommentar beim Release: „Wer seit 0.12 den Abrechnungszeitraum gewechselt
hat, prüft das Jahr der Zahlung von Positionen ohne Zahlungsdatum. Lag der Wechsel in den letzten zwölf Monaten,
steht im Verlauf, welches Jahr vorher galt.“

## Golden-Tests

- `tax-golden.json`: **unverändert** (der Generator wechselt keinen Zeitraum).
- `period-golden.json` (period-golden.test.ts): prüfen. Ändert sich eine Prüfsumme, nur dort, wo ein Bestand eine
  Position mit Jahr in einen Kalenderzeitraum bewegt; dann im Commit mit Position und Jahr begründen.
- Bestehende Tests, die die 400 „zählt … deshalb zu {startYear}“ bzw. „muss zwischen … liegen“ erwarten, werden zu
  Tests der neuen Regel (erlaubt bzw. Rückfrage); im PR einzeln genannt.

## Invarianten

- **Hin und zurück** (server/testing/periodChangeFlows.ts, Zufallsabläufe): Wechsel A → B → A mit den Vorgaben der
  Vorschau ergibt für jede Position mit Datum oder Jahr dasselbe wirksame Steuerjahr wie vorher, und je Steuerjahr
  dieselbe Summe der Werbungskosten (`taxReport` vor und nach).
- **Ein angegebenes Jahr wandert nie**: Über jeden Wechsel bleibt `storedOutflowYear` jeder Position mit `taxYear`
  oder `paidOn` gleich (auch für die Teile, die eine Quelle neu ergibt).
- **Ohne Angabe wie bisher**: Positionen ohne Datum und Jahr verhalten sich genau wie vor #478 (Vergleich mit dem
  bisherigen Ergebnis über dieselben Abläufe).

## Zusammenspiel

- **#96 PR 1**: setzt beim Umstellen auf „Entnahme“ ein abweichendes `taxYear` im Kalenderzeitraum; braucht E2 und E4.
- **#262**: Die Raten hängen am Jahr des Abflusses; E1 hält sie über einen Wechsel stehen.
- **#312, #281**: keine Berührung (Einnahmen haben immer ein Datum).

## Umsetzung (ein PR, Stapel Nr. 1, TDD)

Commits mit `Refs #478`, nie `Fixes`. Größe S (~150 Code + 250 Test).

1. **Rot:** `server/test/review-wechsel-steuerjahr.test.ts` (Thema vorhanden): Beispiel aus dem Issue (Gartenpflege
   `taxYear` 2025 im Zeitraum Mai 2025–April 2026, Wechsel zum Kalenderjahr: der Teil im Zeitraum 2026 behält 2025;
   Gutschrift `taxYear` 2026 bleibt 2026); Hin- und Zurückwechseln mit den Vorgaben ergibt die ursprünglichen Jahre;
   die Vorschau fragt für diese Positionen kein Jahr und nennt `keptTaxYears`; eine Position ohne Angabe nennt
   `taxShifts` wie bisher.
2. **Rot:** `server/test/api-zahlungsdatum.test.ts` (bzw. die Datei der Kostenrouten): `taxYear` 2026 im
   Kalenderzeitraum 2025 → 200; `taxYear` 2030 → 409 `question: 'taxYear'`, mit `confirmTaxYear` 200; Zeitraum über
   zwei Jahre mit Jahr Start − 1 → 200; Abzug beim Betriebsstrom unverändert. `shared/paidOn.test.ts`:
   `taxYearQuestions` (nur bei Änderung, Sätze mit ADVICE).
3. **Rot:** `server/test/db-wechsel-quelle.test.ts`: Teile einer Quelle mit gehaltenem Jahr; Zusammenfassen mit einem
   stehenden Teil gleichen wirksamen Jahres (leer vs. gespeichert = Startjahr).
4. **Rot:** Invarianten über `periodChangeFlows.ts` (oben), Startwerte über INV_FROM/INV_TO.
5. **Rot:** `client/src/costForm.test.ts`: `showsTaxYear` mit gespeichertem abweichendem Jahr im Kalenderzeitraum;
   `taxYearOptions` enthält einen Ausreißer. jsdom (Kosten): Das Auswahlfeld zeigt das gespeicherte Jahr, auch
   außerhalb der Spanne.
6. Grün: periodChange.ts (`keepsTaxYear`, `keptTaxYear`, drei Jahr-im-Ziel-Funktionen, `keptTaxYears`, Marke),
   repository.ts (`requireTaxYear`, `TaxYearQuestion`), shared/paidOn.ts (`taxYearQuestions`), index.ts (409),
   shared/types.ts (`PeriodChangePreview.keptTaxYears`), costForm.ts, Kosten.tsx (Rückfrage), Seite Abrechnungszeitraum
   (Satz der Vorschau).
7. period-golden prüfen (oben); server/src/CLAUDE.md „Abrechnungszeitraum“ und „Jahr des Abflusses“: „Datierte
   Positionen und solche mit angegebenem Jahr behalten beim Zeitraumwechsel ihr Jahr (`keepsTaxYear`)“; „Jahr der
   Steuer“: Spanne und Rückfrage statt Ablehnung.
8. CHANGELOG (Wortlaut im Release-Plan), Release-Kommentar mit dem Satz aus E5.
