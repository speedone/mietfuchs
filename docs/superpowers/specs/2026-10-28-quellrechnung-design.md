# Quellrechnung und abgeleitete Positionen (#455)

Entwurf zu #455, Schritt 1 des Vorgehens im Issue. Er klärt, was vor 1.0.0-rc.1 ins Datenmodell muss,
wie bestehende Teile centgenau zu einer Quelle finden und was davon in 1.x folgt.

## Leitsatz

**Eine aufgeteilte Rechnung hat eine Kennung, und jeder ihrer Teile verweist darauf.** Die Teile
erzeugt genau eine Funktion aus Quelle und Regel. Die Berechnung (calc.ts) rechnet weiter mit den
Kostenpositionen wie heute und liest den Verweis nur, wo sie heute die Heuristik `splitFamilyKey`
fragt. Wer ein Haus im Kalenderjahr vermietet, merkt nichts: Ohne aufgeteilte Rechnung entsteht keine
Quelle, und keine Zahl ändert sich. Golden-Tests und die Prüfsummen der Steuer bleiben centgenau grün.

## Was das Issue verlangt und was dieser Entwurf entscheidet

| Frage aus #455 | Entscheidung |
|---|---|
| Quelle als eigener Datensatz | ja, Tabelle `cost_sources` |
| Verweis der Teile | `cost_items.source_id`, Fremdschlüssel |
| Erzeugt von genau einer Funktion | `deriveSourceParts` in server/src/serviceSplit.ts, genutzt vom Aufteilen beim Speichern und vom Wechsel des Rhythmus |
| Bestehende Teile beim Datenschritt | ein Datenschritt in TypeScript nach dem Schemaschritt; er findet genau die Familien, die der Wechsel heute schon als eine Rechnung behandelt, und ändert keinen Betrag (unten) |
| Teile, die sich nicht eindeutig zuordnen lassen | bleiben ohne Quelle und verhalten sich wie heute ein Teil, dessen Familie `familyOf` nicht findet |
| Abgeschlossene Abrechnungen | unverändert: Der Datenschritt setzt nur den Verweis, kein Betrag und keine Zeile ändert sich |
| Backup, Wiederherstellen, Umstieg, Verlauf, Rücksprung | siehe Abschnitt „Daten“ |
| Vor rc.1 alles oder nur das Schema? | Schema, Datenschritt, Ableitung nach Tagen und die Verbraucher (Hinweis, Beleg, Doppelte) vor rc.1. Die weiteren Regeln (#95, #141, #262, #292) kommen in 1.x als **zusätzliche** Werte und Spalten. |

## Datenmodell

### `cost_sources` (neu)

| Spalte | Art | Bedeutung |
|---|---|---|
| `id` | TEXT PK | Kennung der Rechnung |
| `property_id` | TEXT NOT NULL → `properties` RESTRICT | Objekt, wie jede Wurzel (`propertyRef`) |
| `rule` | TEXT NOT NULL, CHECK `rule IN ('days')` | Ableitungsregel; heute nur „nach Tagen“ (#208) |

**Bewusst nicht an der Quelle: Betrag, Lohnanteil, Leistungszeitraum, Beschreibung, Rechnungssteller,
Beleg.** Die Teile tragen sie heute schon, und die Berechnung liest sie dort. Stünden sie zusätzlich an
der Quelle, gäbe es zwei Wahrheiten. Ein Teil lässt sich heute im Betrag berichtigen, das bleibt so.
Eine Summe an der Quelle müsste dann jede Schreibstelle nachführen, und sonst zeigte sie still etwas
anderes als die Teile.

- **Der Rechnungsbetrag ist die Summe der Teile.** Gerechnet wird er beim Lesen, nicht gespeichert.
  Genau das tut der Wechsel heute schon (`wholeInvoice` summiert die Teile).
- **Leistungszeitraum und Beschreibung** kommen vom Teil. Alle Teile einer Quelle tragen denselben
  Leistungszeitraum, das sichert der Wächter schon heute (`splitPartMessage`). Die Beschreibung ohne
  „(anteilig …)“ liefert `baseDescription`.
- **1.x ergänzt Spalten, wenn ein Verbraucher sie braucht**: Zahlungen (#292) verweisen auf die
  Quelle. Rechnungssteller und Beleg wandern an die Quelle, sobald die Vorverteilung (#95) Teile in
  mehreren Objekten hat. Eine Spalte hinzuzufügen hält die Zusage aus #447 (jeder Bestand öffnet
  sich in jeder späteren 1.x), denn die Kette baut sie samt Datenanweisung nach.
- **Für #95** wird `property_id` später NULL-fähig (eine Quelle über mehrere Objekte). Eine Pflicht
  aufzuheben ist ebenfalls vorwärts verträglich.
- **Weitere Regeln** (`properties`, `keys`, `hausgeld`, `taxYears`) kommen in 1.x mit eigener
  Prüfbedingung dazu. drizzle-kit baut die Tabelle dafür neu, nach der Regel „Spalten und Bedingungen
  nie in einem Schritt“ (server/drizzle/README.md).

### `cost_items.source_id` (neu)

TEXT, NULL-fähig, → `cost_sources(id)` **ON DELETE RESTRICT** im Schema; in der Datei NO ACTION, weil drizzle-kit
bei `ALTER TABLE … ADD` kein `ON DELETE` schreibt, bis ein späterer Schritt `cost_items` neu baut (unter
`defer_foreign_keys` wird dann erst beim Festschreiben geprüft). Eine Quelle wird nie gelöscht, solange
ein Teil auf sie zeigt; sie fällt mit ihrem letzten Teil weg (`costItemCollection.remove` löscht eine
Quelle ohne Teile im selben Vorgang). `NULL` heißt: keine aufgeteilte Rechnung, oder ein alter Teil ohne
eindeutige Zuordnung.

- **Shared-Typ**: `CostItem.sourceId?: string`. In `SPLIT_FIELDS` ist das `same`: Jeder Teil trägt
  denselben Verweis. `SnapshotCostItem` führt ihn mit (Hinweis „Betrag passt nicht zum Anteil“).
- **Nur von Hand gesetzt wird er nie.** `mergeCostItem` übernimmt `sourceId` aus einem Rumpf nicht.
  Gesetzt wird er nur von den Schreibfunktionen der Teile (unten), sonst hängte ein alter Tab eine
  Position an eine fremde Rechnung.
- **Wächter**: Ein Teil und seine Quelle haben dasselbe Objekt (`crossPropertyViolations` beim
  Wiederherstellen, `sameProperty` beim Schreiben). Wechselt eine Position mit Quelle das Objekt,
  lehnt der Wächter ab, denn die Teile gehören zusammen. **Außerdem lehnt er an einem Teil mit Quelle
  ab** (heute nur Zeitraum, Leistungszeitraum und Wechsel zur Heizung, `requireServiceAndTax`): jeden
  Wechsel der Kostenart, den Schlüssel `amounts` (Satz aus `splitBlocker`) und `operatingPower`. Sonst
  teilte der nächste Wechsel einen Teil nach Tagen, den `splitBlocker` verbietet, oder hielte einen
  Abzug für einen Teil.
- **Index** `cost_items(source_id)`, weil das Löschen und der Wechsel nach Quelle suchen.

### Invarianten (geprüft in Tests, nicht in der Datenbank)

1. Alle Teile einer Quelle haben dasselbe Objekt, dieselbe Kostenart und denselben Leistungszeitraum.
   Sie sind kalt, nicht `amounts` und kein Abzug beim Betriebsstrom.
2. Ein Wechsel legt keinen **zweiten** Teil einer Quelle in einen Zeitraum, in dem schon einer steht,
   solange beide dasselbe Jahr der Zahlung und dieselbe Verteilung haben (unten, „Zusammenfassen“). Mehrere im selben Zeitraum
   gibt es sonst nur aus Beständen vor dieser Version (Fall aus dem Issue).
3. Jede Quelle hat mindestens einen Teil. Ergibt ein Wechsel nur noch einen Teil (der Leistungszeitraum
   liegt danach ganz in einem Zeitraum), entfällt die Quelle, und der Teil ist eine gewöhnliche
   Position.
4. **Je Zeitraum ändert der Umbau gegenüber heute keinen Cent**: Für jeden Bestand und jeden Wechsel
   ergibt die Summe der Teile je Zeitraum dasselbe wie der Code vor dieser Version, wo der ihn als
   Familie behandelte. Eine Zufallsinvariante prüft das gegen eine eingefrorene Kopie von
   `wholeInvoice` (nur im Test).

## Die eine Funktion: `deriveSourceParts`

```
deriveSourceParts(rules, invoice) → ServicePart[]
  invoice: { tieId, description, amountCents, labor35aCents?, spans: { from, to }[], marked }
```

Verteilt `amountCents` (und den Lohnanteil) nach den Tagen, die die `spans` in jedem Zeitraum von
`rules` haben, mit `largestRemainder` und dem Entscheid `${tieId}|${Zeitraum}`.

- **Aufteilen beim Speichern**: `spans` = der ganze Leistungszeitraum, `tieId` = Kennung der Position
  oder `'vorschau'` wie heute. Das ist genau `splitByService`; F18 und jede gespeicherte Aufteilung
  bleiben centgenau.
- **Wechsel des Rhythmus**: `amountCents` = Summe der **bewegten** Teile, `spans` = deren Leistungszeitraum
  geschnitten mit ihrem bisherigen Zeitraum, `tieId` = kleinste Kennung aller Teile der Quelle. Das ist
  `wholeInvoice` von heute, ohne die Bedingung einer zusammenhängenden Spanne (liegt eine Lücke
  dazwischen, zählt sie einfach nicht). Bei zusammenhängender Spanne sind Gewichte und Entscheid
  dieselben wie heute, das Ergebnis also centgenau gleich.
- **Wo kein bewegter Teil liegt, kommt nichts hin**: Ein gelöschter Teil hinterlässt eine Lücke, und die
  bleibt leer. Deshalb darf man einen Teil weiter allein löschen.
- **Beschreibung**: mehr als ein Ergebnis oder `marked` (es bleiben Teile stehen) →
  `„<Basis> (anteilig <Spanne im Zeitraum>)“`, sonst die Basis (wie Zeile 304 heute).
- **Beträge sind ganze Cent**, Gutschriften behalten ihr Vorzeichen (`byDays`), der Lohnanteil nur an
  einer positiven Rechnung. Das sind dieselben Regeln wie heute.
- `splitByService` bleibt als dünne Hülle (ein Span) für die übrigen Aufrufer, etwa die Gruppen ohne
  Leistungszeitraum.
- **Beträge sind ganze Cent**, Gutschriften behalten ihr Vorzeichen (`byDays`), der Lohnanteil nur an
  einer positiven Rechnung. Das sind dieselben Regeln wie heute.

## Schreibwege

### Aufteilen beim Speichern (`saveCostItemSplit`)

Legt in einer Transaktion eine Quelle an (`rule: 'days'`, neue Kennung) und schreibt die Teile über
`writeCostItemParts` mit `sourceId`. Vorschau, Fragen und Ablehnungen bleiben unverändert. Ein Teil wird
nicht noch einmal aufgeteilt, auch das bleibt (`splitBase`).

**Jeder Weg, der eine Position in mehrere Zeiträume teilt, legt eine Quelle an.** Das sind drei:
`saveCostItemSplit`, der Wechsel bei einer gewöhnlichen Position mit Leistungszeitraum (heute
`splits` ohne `family`) und der Wechsel bei einer kalten Position ohne Leistungszeitraum, die nach
Tagen über ihren bisherigen Zeitraum geteilt wird (Laienprobe B2, `writeChangeIn` ~Z. 802–808; ihre
Teile bekommen den bisherigen Zeitraum als Leistungszeitraum und sind danach Teile wie andere).
Abzüge beim Betriebsstrom (`follows`, Gruppen mit Abzügen) bekommen keine.

### Wechsel des Rhythmus (periodChange.ts)

`splitFamilyKey`, `familyOf` und `wholeInvoice` entfallen. Die **Familie** sind alle Positionen derselben
`sourceId`, gleich in welchem Zeitraum.

- **Stehende Teile**: die in einem Zeitraum mit Status `same` **oder `grows`**, wie heute
  (`wholeInvoice` bewegt nur, was nicht wächst). Ein abgeschlossener Zeitraum ist immer `same`, denn
  sonst sperrt der Wechsel schon heute. Ein berichtigter Betrag bleibt so an seinem Teil.
- **Bewegt** werden die Teile in Zeiträumen mit `shrinks` oder `gone`; sie gehen mit ihrer Summe in
  `deriveSourceParts`.
- **Zusammenfassen** (neu gegenüber heute, die Zeilenvermehrung aus dem Issue): Fällt ein Ergebnis in
  einen Zeitraum, in dem ein stehender Teil derselben Quelle liegt, kommt sein Betrag (und Lohnanteil)
  **zu diesem Teil hinzu**, statt eine zweite Zeile anzulegen. Das geschieht nur, wenn beide nach dem
  Wechsel dasselbe Jahr der Zahlung haben (`storedOutflowYear` bzw. die Antwort der Vorschau) und
  dasselbe `paidOn`; sonst bleibt es eine eigene Zeile, damit keine Werbungskosten das Jahr wechseln.
  Ebenso nur bei **derselben Verteilung** (Durchsicht von PR 2, M1; `sameAllocation`): Jedes Feld, das
  nicht je Teil gesetzt wird (`part` in `SPLIT_FIELDS`), muss beim stehenden Teil und beim führenden
  bewegten gleich sein, ausgenommen Objekt, Leistungszeitraum, Quelle, Zahlungsdatum, Rechnungssteller und
  Beleg; Listen zählen als Mengen, leer wie nicht angegeben. Ist der stehende Teil einzeln berichtigt
  (anderer Schlüssel, andere Teilnehmer, Direktzuordnung, nicht vereinbart …), verteilte er den
  hinzukommenden Anteil sonst nach seiner Berichtigung statt nach der Rechnung (§ 556a BGB), und Geld
  wanderte zwischen Mietern, ohne dass jemand es gewählt hat; der Anteil bleibt dann eine eigene Zeile.
  Je Zeitraum ändert das keinen Cent der Summe. Weil eine Zeile statt zweier verteilt wird, kann sich
  bei den Mietern ein Restcent verschieben. Das ist gewollt (das Issue nennt die Rundung je Zeile als
  Problem). Die Vorschau sagt es („wird mit dem Teil … zusammengefasst“). Ist der stehende Teil der
  Abschluss eines geschlossenen Zeitraums, kann das nicht vorkommen, denn dorthin bewegt der Wechsel
  nichts.
- Je neuem Zeitraum ohne stehenden Teil ein Teil. Er behält die Kennung eines bisherigen bewegten Teils
  desselben Zeitraums, sonst die eines übrigen bewegten, sonst eine neue. **Jeder Teil behält dabei
  seine eigenen Felder und Unterlisten**, ein neuer kopiert die des ersten bewegten Teils
  (`rewriteCostItemFamily`, unverändert samt Umhängen gebuchter Belegzeilen und des Belegs). Das ist
  das Verhalten von heute; ein abweichender Schlüssel eines Zeitraums (§ 556a Abs. 2 BGB) bleibt an
  seinem Teil.
- **Mehrere Teile im selben Zeitraum** (aus Beständen vor dieser Version, oder das Zusammenfassen ließ sie wegen
  verschiedener Jahre getrennt): Stehen sie, bleiben beide Zeilen. Werden sie bewegt, zählen sie zusammen und ergeben
  je neuem Zeitraum eine Zeile, **aber nur bei gleichem Jahr der Zahlung (`storedOutflowYear`) und Zahlungsdatum**
  (Integrationsdurchsicht, I1). Sonst wird je Jahr und Zahlungsdatum eine eigene Rechnung geteilt, mit eigenem
  führendem Teil und eigener Frage nach dem Jahr; zusammengezählt hätten alle das Jahr des ersten bekommen, und
  Werbungskosten wechselten das Jahr. Die Ergebnisse einer späteren solchen Rechnung kommen zu einer eigenen Zeile
  einer früheren derselben Quelle, wenn sie danach dasselbe Jahr haben (wie beim Zusammenfassen), so bleibt es je
  Zeitraum und Jahr eine Zeile. Liegt jeder bewegte Teil in einem anderen Zeitraum, bleibt es eine Rechnung wie bei
  `wholeInvoice` (Invariante 4); dort gilt die Vorbelegung des führenden Teils weiter.
- **Vorschau des Zusammenfassens**: gerechnet mit den vorbelegten Jahren. Fragt die Vorschau in dem Zeitraum ein
  Jahr der Zahlung (des bewegten oder des stehenden Teils), trägt der Teil `mergeDependsOnYear`, und der Satz sagt,
  dass das Zusammenfassen nur beim vorbelegten Jahr gilt.
- Ergibt der Wechsel für eine Quelle nur noch einen Teil, entfällt die Quelle (Invariante 3).
- **Teile ohne Quelle** (alter Bestand, unten) behalten den bisherigen Weg: geteilt über den eigenen
  Teil des Leistungszeitraums. Die Teile, die dabei entstehen, bekommen **eine neue Quelle**, denn sie
  sind jetzt eine Rechnung. Wie jede Quelle bewegt der nächste Wechsel nur ihre Spannen.
- Das Jahr der Zahlung je neuem Teil: Die Vorschau fragt es wie heute (`taxEntry`, Schlüssel mit der
  Kennung des führenden Teils). Ein Teil mit `paidOn` behält sein Jahr (`keepsTaxYear`).
- Abzüge beim Betriebsstrom folgen ihrer Stromrechnung wie heute (`follows`, `splitDeductionsAlike`,
  `settleOperatingPowerLinks`). Sie sind selbst nie Teil einer Quelle.

### Bearbeiten eines Teils

Unverändert: Betrag, Lohnanteil, Beschreibung, Jahr der Zahlung, Rechnungssteller, Beleg und Schlüssel
lassen sich je Teil berichtigen. Zeitraum, Leistungszeitraum und Kostenart nicht (`splitPartMessage`).
Ein Schlüssel darf je Zeitraum abweichen (§ 556a Abs. 2 BGB: Ein Wechsel gilt für künftige
Abrechnungszeiträume). Deshalb wird nichts auf die Geschwister übertragen.

### Löschen eines Teils

Unverändert je Teil, über dieselbe Route und dieselben Prüfungen (`costItemCollection.remove`: Abzüge,
die auf ihn zeigen, `guardFrozenLink`). Neu ist nur: Ist es der letzte Teil seiner Quelle, fällt die
Quelle im selben Vorgang weg. Weil der Wechsel nur bewegte Spannen verteilt, verschiebt eine Lücke
kein Geld. Eine Route „ganze Rechnung löschen“ gibt es in diesem Schritt nicht.

Ein Teil, dessen übrige Teile gelöscht sind, behält seine Quelle und bleibt gesperrt (Durchsicht von PR 2, M3). Seine
Quelle zu lösen hülfe kaum: Reicht sein Leistungszeitraum über mehrere Zeiträume, sperrt `isSplitPart` ihn ohnehin, und
ein stilles Lösen nähme dem Verlauf die Zuordnung. Jeder Satz der Sperren (`splitPartMessage`, `requireSourcePartStays`)
nennt deshalb den Ausweg, der geht: alle Teile löschen und die Rechnung neu erfassen.

## Datenschritt für bestehende Teile

### Mechanik: Datenschritt in TypeScript nach einem Schemaschritt

SQL allein reicht nicht: Ob eine Position ein Teil ist, hängt an den Zeiträumen des Objekts
(`period_start_month`, `period_changes`), und der Vergleich der Unterlisten braucht eine sichere
Reihenfolge. Deshalb gibt es einen neuen Mechanismus:

- `applyMigrations` (client.ts) führt nach den Anweisungen eines Schrittes, **in derselben
  Transaktion und vor der Prüfung der Fremdschlüssel**, eine Funktion aus, die für die Marke (`tag`)
  dieses Schrittes eingetragen ist (`DATA_STEPS` in einer neuen Datei `server/src/db/dataSteps/`).
  Scheitert sie, rollt der Schritt zurück wie jeder andere.
- **Ein Datenschritt ist eingefroren wie ein SQL-Schritt.** Er liest und schreibt nur mit rohem SQL über
  `connection` und kennt die Spalten seines Schrittes, nicht `schema.ts`. Ein Wächter verbietet Importe
  aus `db/schema.ts`, aus `shared/` und aus server/src außer dem eigenen Ordner. Eine Prüfsumme je Datei
  hält sie fest (Muster legacy-schema.test.ts). Die Regeln, die er braucht (Zeiträume aus Beginnmonat
  und Wechseln, Basisbeschreibung), stehen als eingefrorene Kopie darin.
- Für die Programmdatei ist nichts zu tun, denn es ist gewöhnlicher Code. Umstieg, Wiederherstellen,
  Vorversionen und die Tests laufen ohnehin durch `applyMigrations`.
- Die Datenbankdoku (server/src/db/CLAUDE.md, „Migrationen“) und server/drizzle/README.md beschreiben
  den Mechanismus.

### Regel: streng, nur der Verweis, keine Zahl

Für jedes Objekt die Regeln zur Zeit des Schrittes. **Kandidat** ist eine Position, die

- nicht Heizung ist (`category <> 'Heizung und Warmwasser'`), einen Leistungszeitraum hat, nicht
  `key = 'amounts'` ist und kein Abzug beim Betriebsstrom (`operating_power IS NOT 'deduction'`),
- und deren Leistungszeitraum mehr als einen Zeitraum des Objekts berührt (`isSplitPart`) **oder** deren
  Beschreibung auf „(anteilig …)“ endet (`SPLIT_SUFFIX`). Das zweite braucht der Fall aus dem Issue: Nach
  Schritt 2 liegt der Leistungszeitraum wieder ganz in einem Zeitraum, beide Zeilen sind aber Teile
  derselben Rechnung. Den Zusatz schreibt nur das Aufteilen. Zwei gleiche Rechnungen ohne Zusatz in
  einem Zeitraum bleiben deshalb ohne Quelle.

Folge für den übrigen Code: **Ob eine Position Teil einer Quelle ist, sagt `sourceId`, nicht
`isSplitPart`.** Der Wächter für Teile mit Quelle und die Familie im Wechsel fragen `sourceId`.

Der Schritt findet **dieselben Familien wie der Code vor dieser Version**, damit niemand einen
Ganzrechnungs-Wechsel verliert, den er heute hat (sonst käme die Rundungsdrift aus #226 zurück):

1. **Familie** = Kandidaten desselben Objekts mit gleichem `splitFamilyKey` (Kostenart,
   Basisbeschreibung, Leistungszeitraum, Rechnungssteller, Beleg, Schlüssel; eingefrorene Kopie der
   Regel im Schritt).
2. Liegen alle Mitglieder in **verschiedenen** Zeiträumen und sind es mindestens zwei, bekommt die
   Familie eine Quelle. Genau diese Familien teilt der Wechsel heute als Ganzes (`familyOf`).
3. Liegen **zwei oder mehr im selben Zeitraum** (Fall aus dem Issue), behandelt der Code sie heute
   einzeln. Dann bekommt die Familie nur eine Quelle, wenn alle Mitglieder **in jeder Angabe** gleich
   sind: alle Spalten außer `id`, `period`, `amount_cents`, `labor_35a_cents`, `description` und
   `tax_year` (gelesen mit `PRAGMA table_info`, damit sicher alle dabei sind) und die Zeilen der
   Unterlisten (`cost_item_shares`, `cost_item_participants`, `cost_item_amounts`,
   `cost_item_contract`, `cost_item_self_amounts`, je Position sortiert verglichen). Sonst bleibt die
   ganze Familie ohne Quelle, wie heute.
4. Eine Familie mit einem einzigen Mitglied bekommt keine Quelle.

Bekannte Abweichung von „dieselben Familien“: Der Code vor dieser Version bildete Familien aus **jeder**
kalten Position mit Leistungszeitraum, also auch aus Einzelbeträgen und Abzügen. Der Schritt nimmt nur
Kandidaten. Bei Einzelbeträgen und Abzügen ist das so entschieden (sie bekommen nie eine Quelle). Bei
Zeilen ohne Zusatz in einem Zeitraum wäre es nur theoretisch: Es bräuchte eine gleiche Spanne ganz in
einem Zeitraum neben Teilen in anderen.

- Die Kennung der Quelle ist die **kleinste Kennung** ihrer Teile, damit der Schritt reproduzierbar ist
  (Tabellen verschieden, keine Kollision).
- `UPDATE cost_items SET source_id = …` ist der **einzige** Eingriff: kein Betrag, keine Zeile, keine
  Beschreibung. Damit bleibt auch jede abgeschlossene Abrechnung unberührt.

**Ohne Quelle** bleiben einzelne Teile und Familien nach Regel 3, deren Mitglieder sich in einer
Angabe unterscheiden. Sie verhalten sich wie heute ein Teil, dessen Familie `familyOf` nicht findet.
Das ist der vorsichtige Ausgang, denn sie zusammenzulegen könnte zwei verschiedene Rechnungen im selben
Zeitraum vereinen (Begründung im Issue).

**Grenze, bewusst hingenommen**: Zwei wirklich verschiedene Rechnungen, die in jeder Angabe gleich sind
(ohne Rechnungssteller und Beleg, dieselben Teilnehmer, derselbe Leistungszeitraum), bekommen eine
Quelle. Geld wandert dabei nicht: Der Schritt ändert keinen Betrag, und eine spätere Neuberechnung
verteilt die Summe nach denselben Tagen. Nur der Hinweis auf doppelte Positionen zählt sie dann als
eine Rechnung.

### Prüfung des Datenschritts

- Fall aus dem Issue (Schritte 1–4, aufgebaut über die Routen vor dem Schritt): eine Quelle je
  Rechnung, auch nach Schritt 2 mit zwei Teilen im selben Zeitraum.
- Zwei Rechnungen im selben Zeitraum mit gleichem `splitFamilyKey`, aber verschiedenen Teilnehmern,
  ergeben keine gemeinsame Quelle. Familien in verschiedenen Zeiträumen bekommen sie wie heute.
- Ein Teil allein, Heizung, `amounts` und Abzug ergeben keine Quelle.
- **Regression wie beim Umstieg**: Abrechnung, Mietkonto, Steuer und Verbrauch jedes Zeitraums sind vor
  und nach dem Schritt centgenau gleich. Dazu dient ein Zufallsbestand mit festem Startwert, der
  Rechnungen mit Leistungszeitraum über mehrere Wechsel aufteilt. `regression.ts` lässt sich dafür
  wiederverwenden.

## Verbraucher, die nach Quelle zählen

| Stelle | heute | danach |
|---|---|---|
| Hinweis „Betrag passt nicht zum Anteil“ (calc.ts, `external.amount-mismatch`) | Summe über `splitFamilyKey` im Zeitraum | Summe über `sourceId` im Zeitraum. Ohne Quelle nur der Teil selbst. |
| Kostenformular, Anteil der Gemeinschaft (Kosten.tsx `othersCents`, costForm.ts) | `splitFamilyKey` | `sourceId` |
| Doppelte Positionen (shared/duplicates.ts, `possibleDuplicates`) | jede Position einzeln | Teile derselben Quelle **im selben Zeitraum** zählen als eine und melden einander nicht. `alreadyCarried` (Übernehmen aus dem Vorjahr) bleibt unverändert, denn ein Teil derselben Rechnung im Zeitraum heißt dort zu Recht „schon erfasst“. |
| Belegabdeckung (client/src/receipts.ts `coverage`) | je Position | je Rechnung: Teile einer Quelle zählen als eine Position, belegt, wenn einer den Beleg trägt |
| Belegordner, Karten (`receiptCards`) | Summe der Positionen am Beleg | unverändert (die Teile ergeben schon die ganze Rechnung) |
| Steuer, `outflowShares`, Steuer-ZIP | je Position | **unverändert**. Jeder Teil hat sein eigenes Jahr der Zahlung, und die Übersicht.csv nennt ihn als eigene Zeile. #262 käme als weitere Regel an `outflowShares`. |
| Export JSON/CSV | je Zeile | unverändert |

`splitFamilyKey` wird danach entfernt. Ein Wächter (Suche im Quelltext) verhindert, dass es
zurückkommt.

## Daten

- **Backup**: Die Tabelle kommt mit dem Schnappschuss der Datenbank. Ein Backup aus einer früheren
  Version durchläuft beim Einspielen die Kette samt Datenschritt (`archiveDatabaseProblem` holt die
  Migrationen nach).
- **Wiederherstellen**: `crossPropertyViolations` prüft auch Quelle ↔ Teil. Eine Quelle ohne Teil ist
  krumm, nicht kaputt: Sie wird hingenommen und schadet nicht.
- **Umstieg aus der db.json**: Die db.json kennt keine aufgeteilten Rechnungen (`LegacyCostItem` hat
  keinen Leistungszeitraum). Der Datenschritt findet nichts. Der eingefrorene Eingang bleibt unberührt.
- **Verlauf und Rücksprung (#318)**: Die neue Tabelle bekommt ihre Trigger beim Öffnen von selbst. Dazu
  kommt ein Bereich in `TABLE_KINDS` (`costs`) und ein Titel der Zeile in journal.ts (die Beschreibung
  des ersten Teils), dazu die Feldnamen in client/src/journalView.ts. Der Rücksprung über ein Aufteilen,
  einen Wechsel und das Löschen des letzten Teils stellt Quelle und Teile wieder her
  (`defer_foreign_keys`), geprüft in api-ruecksprung.test.ts. Der Datenschritt selbst steht nicht im
  Verlauf (Migrationen laufen ohne Trigger).
- **Vorversionen**: nichts zu tun. Eine Vorversion aus der Zeit davor holt beim Einspielen die Kette
  nach.
- **Neue Version, alter Server**: Eine Datei mit dem neuen Schritt öffnet ein älterer Server nicht
  (`unknownSteps`), wie bei jedem Schritt.

## Nicht in diesem Entwurf

- Vorverteilung auf Objekte (#95), Mischschlüssel, Hausgeldabrechnung als Klammer (#141), § 82b EStDV
  (#262) und Zahlungen (#292): weitere Regeln und Spalten in 1.x.
- Angaben der Rechnung (Rechnungssteller, Beleg, Zahlungsdatum) an der Quelle führen und an alle Teile
  weitergeben.
- Eine eigene Ansicht „Rechnung mit ihren Teilen“ in der Oberfläche. In der Kostenliste kann ein Teil
  „Teil von N · Rechnung gesamt X €“ zeigen. Das ist klein und gehört dazu, wenn es ohne neue Route
  geht.
- Teile ohne Quelle nachträglich zuordnen (eine Rückfrage an den Vermieter).

## Vorgehen in Schritten (je ein PR, aufeinander aufbauend)

1. **Schema und Datenschritt**: `cost_sources`, `source_id`, Index, Mechanismus `DATA_STEPS`, der
   eingefrorene Schritt samt Wächtern und Regression. `CostItem.sourceId` lesen und mitführen,
   `mergeCostItem` übernimmt ihn nicht. Dazu Journal, Wiederherstellen und Doku. Noch keine
   Verhaltensänderung außer dem Verweis.
2. **Ableitung**: `deriveSourceParts`, jeder Weg des Aufteilens legt eine Quelle an, der Wechsel
   arbeitet nach Quelle samt Zusammenfassen, der Wächter für Teile mit Quelle, die Quelle fällt mit dem
   letzten Teil. `wholeInvoice` und `familyOf` entfallen.
3. **Verbraucher**: Hinweis, Formular, Doppelte, Belegabdeckung nach Quelle. `splitFamilyKey` entfällt
   samt Wächter, Anzeige „Teil von N“.

Danach eine Integrationsdurchsicht des Endstands (Geld und Daten), der Praxislauf und das Label
`full-check` (CLAUDE.md).
