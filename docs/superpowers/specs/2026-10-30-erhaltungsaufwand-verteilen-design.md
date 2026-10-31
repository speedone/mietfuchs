# Größeren Erhaltungsaufwand auf zwei bis fünf Jahre verteilen (§ 82b EStDV, #262)

Entwurf zu #262. Er baut auf dem Jahr des Abflusses (#255, `outflowShares` in server/src/outflow.ts) und auf der
Quellrechnung (#455) auf. Er gehört zum Release „Quellrechnung und Steuerjahr“ (0.14.0) zusammen mit #312, #281, #96 (Rest)
und #478; Reihenfolge und Migrationen im Release-Plan (`2026-10-30-release-0.14-plan.md`). Rechtsaussagen nennen
ihre Quelle. Was nicht amtlich belegt ist, steht als **Auslegung** da.

**Stand nach der Durchsicht** (`2026-10-30-crossreview.md`): eingearbeitet sind X3, X5, X6, X7, X9, X10 und V1 bis
V7 samt den kleinen Befunden; die Entscheidungen U-1 bis U-4 hat der Lead getroffen (Abschnitt „Entschieden“).

## Leitsatz

**Verteilt wird der Betrag einer Position ohne ihren privaten Teil, nicht ihr Abfluss.** Die Position fließt weiter
genau einmal ab, in dem Jahr, das `outflowShares` nennt. Bei einer gewählten Verteilung zieht die Steuerübersicht
D = Betrag − privat (Eigennutzung, festgestellt im Jahr des Abflusses) in N gleichen Raten ab: die erste im Jahr des
Abflusses, die übrigen in den N − 1 Folgejahren. **Die Kürzung bei verbilligter Vermietung trifft jede Rate in dem
Jahr, in dem sie abgezogen wird**, mit der Quote dieses Jahres, wie jede andere Position (Anleitung Anlage V: volle
Höhe in den Zeilen 33 bis 84, Kürzung nur in 87/88). **Wer nicht verteilt, merkt nichts.** Ohne Angabe gibt es keine
Verteilung, keine Zahl ändert sich, und die Prüfsummen in tax-golden.json bleiben centgenau. Die
Nebenkostenabrechnung liest die Angabe nie.

## Rechtslage

### Wortlaut (§ 82b EStDV, gesetze-im-internet.de)

- **Abs. 1 Satz 1**: Größere Aufwendungen für die Erhaltung von Gebäuden, die im Zeitpunkt der Leistung des
  Erhaltungsaufwands nicht zu einem Betriebsvermögen gehören und überwiegend Wohnzwecken dienen, kann der
  Steuerpflichtige abweichend von § 11 Abs. 2 EStG auf zwei bis fünf Jahre gleichmäßig verteilen.
- **Satz 2**: Ein Gebäude dient überwiegend Wohnzwecken, wenn die Grundfläche der Wohnzwecken dienenden Räume mehr als
  die Hälfte der gesamten Nutzfläche beträgt.
- **Satz 3**: Garagen, die zum Gebäude gehören, gelten unabhängig von ihrer tatsächlichen Nutzung als Wohnzwecken
  dienend, soweit in ihnen nicht mehr als ein Pkw je Wohnung untergestellt werden kann.
- **Satz 4**: Räume für weitere Kraftwagen gelten stets als nicht Wohnzwecken dienend.
- **Abs. 2**: Wird das Gebäude während des Verteilungszeitraums veräußert, ist der noch nicht berücksichtigte Teil im
  Jahr der Veräußerung als Werbungskosten abzusetzen. Dasselbe gilt, wenn es in ein Betriebsvermögen eingebracht oder
  nicht mehr zur Einkunftserzielung genutzt wird.
- **Abs. 3**: Steht das Gebäude im Eigentum mehrerer Personen, verteilen alle Eigentümer auf denselben Zeitraum.

### Was Rechtsprechung und Verwaltung ergänzen

| Punkt | Aussage | Quelle |
|---|---|---|
| „Größer“ | Es gibt keinen Mindestbetrag. Mehrere kleinere Maßnahmen dürfen zusammengefasst werden. | Fachliteratur (Zenthöfer, Einkommensteuer, Teil K 7.7.5.3, zitiert im iww-Fachbeitrag SR „größerer Erhaltungsaufwand“, Teil 1) |
| Gleichmäßig | Gleiche Jahresbeträge. Kein ungleiches Verteilen, kein Zeitraum über fünf Jahre. Ein Anteil lässt sich nicht in ein anderes Jahr schieben, auch nicht nachholen. | ebd.; H 21.1 EStH (BFH vom 26.10.1977) |
| Wahlrecht | Es wird in der Erklärung des Jahres ausgeübt, in dem der Aufwand abfließt. Wird es dort nicht genutzt und ist der Bescheid bestandskräftig, erlischt es. Danach sind die Folgejahre an die Wahl gebunden. | Fachliteratur und FG-Rechtsprechung, zitiert im iww-Fachbeitrag (Teil 1); H 21.1 EStH |
| Je Aufwand | Die Wahl gilt je Aufwand. Wird ein Aufwand in zwei Jahren bezahlt, entstehen zwei Verteilungszeiträume, jeder ab seinem Jahr des Abflusses. | iww-Fachbeitrag (Teil 1); FG Münster (iww astw, „Verteilung … abhängig vom Zeitpunkt der Zahlung“) |
| Dauerwohnen | Eine Wohnung, die wechselnden Feriengästen überlassen wird, dient nicht Wohnzwecken im Sinne der Vorschrift. | Rechtsprechung, zitiert im iww-Fachbeitrag (Teil 1) |
| Tod | Stirbt der Steuerpflichtige im Verteilungszeitraum, wird der Rest im Todesjahr beim Erblasser abgezogen. Der Erbe führt die Verteilung nicht fort. R 21.1 Abs. 6 Satz 2 und 3 EStR 2012 (Aufteilung zwischen Erblasser und Erben) hält der BFH für überholt. | BFH, Urteil vom 10.11.2020, IX R 31/19 |
| Nießbrauch | Hat ein Nießbraucher Erhaltungsaufwand nach § 82b verteilt, kann der Eigentümer den beim Tod des Nießbrauchers noch nicht berücksichtigten Teil nicht abziehen. Mehr sagt die Entscheidung nicht; eine allgemeine Regel für jede Rechtsnachfolge folgt aus ihr nicht. | BFH, Urteil vom 13.03.2018, IX R 22/17; Beschluss vom 25.09.2017, IX S 17/17 |
| Anlage V | Abschnitt „Auf bis zu 5 Jahre zu verteilende Erhaltungsaufwendungen (einschließlich Entnahmen aus der Erhaltungsrücklage) – §§ 11a, 11b EStG, § 82b EStDV –“. Vordruck 2025: Zeile 57 „Gesamtaufwand 2025“ / „davon 2025 abzuziehen“, 58 direkt zuzuordnen, 59 verhältnismäßig mit „Gesamtbetrag“ und „abzugsfähiger Anteil (in %)“, 60 Summe (Kz. 38); Zeilen 61–72 die Anteile aus 2021 bis 2024, **je Ursprungsjahr drei Zeilen** (2021: 61/62/63, 2022: 64/65/66, 2023: 67/68/69, 2024: 70/71/72; direkt, verhältnismäßig, Summe; Kz. 39–42). Anleitung 2024: „Zeile 57 bis 60“ entsprechend. | Vordruck 2025AnlV101, Anleitung Anlage V 2024 (beide in der Durchsicht selbst gelesen) |
| Verbilligte Vermietung | „Im Falle einer verbilligten Vermietung zu Wohnzwecken tragen Sie bitte die Aufwendungen in die Zeilen 33 bis 84 in voller Höhe ein. Hinsichtlich der vorzunehmenden Kürzung der Werbungskosten nutzen Sie bitte ausschließlich die Zeilen 87 und 88.“ Die Raten in 57–72 stehen also ungekürzt; gekürzt wird die Summe der Werbungskosten des Jahres in 87/88, mit der Quote dieses Jahres. | Anleitung Anlage V 2024, S. 7 unten |

### Grenzen

- **§§ 11a, 11b EStG** (Gebäude in einem Sanierungsgebiet oder städtebaulichen Entwicklungsbereich, Baudenkmal):
  ebenfalls zwei bis fünf Jahre, aber nur mit Bescheinigung der Gemeinde bzw. der Denkmalbehörde und ohne die
  Voraussetzung „überwiegend Wohnzwecke“. **Bewusst draußen** (Entscheidung des Leads): keine Spalte für die
  Rechtsgrundlage, kein Ausbau geplant. Mietfuchs nennt nur die Grenze: Lexikon `spread82b` und der Hinweis
  `spreadConditions` sagen, dass Denkmal und Sanierungsgebiet eigene Vorschriften mit Bescheinigung haben, die
  Mietfuchs nicht rechnet.
- **Anschaffungsnahe Herstellungskosten** (§ 6 Abs. 1 Nr. 1a EStG, für V+V über § 9 Abs. 5 Satz 2 EStG):
  Aufwendungen für Instandsetzung und Modernisierung innerhalb von drei Jahren nach der Anschaffung, die ohne
  Umsatzsteuer 15 % der Anschaffungskosten des Gebäudes übersteigen, sind Herstellungskosten. Sie gehen dann in die AfA
  ein und sind weder sofort abziehbar noch nach § 82b verteilbar. Schönheitsreparaturen zählen mit (BFH, Urteil vom
  14.06.2016, IX R 25/14). Ausgenommen sind Erweiterungen und jährlich übliche Erhaltungsarbeiten. Mietfuchs kennt
  die Kosten der Anschaffung nicht und prüft die Grenze deshalb nicht. Es gibt **einen** Hinweis dazu für das ganze
  Release, `acquisitionRelated`, angelegt in #96 PR 2 (Durchsicht X6, Bedingung dort und in E-8).
- **Herstellungsaufwand** überhaupt (Erweiterung, wesentliche Verbesserung) ist keine Erhaltung. Die Abgrenzung trifft
  der Vermieter, Mietfuchs nennt sie im Lexikon.
- **Betriebsvermögen und gewerbliche Vermietung** gibt es in Mietfuchs nicht (CLAUDE.md, Zielbild). Der Hinweis nennt
  die Voraussetzung trotzdem.

## Entscheidungen

### E-1: Die Wahl steht an der Kostenposition

`CostItem.spreadYears?: 2 | 3 | 4 | 5`, Spalte `cost_items.spread_years`. Fehlt sie, wird nicht verteilt.

- **Warum an der Position:** Das Wahlrecht gilt je Aufwand, und der Aufwand ist in Mietfuchs die Position. Dort stehen
  schon Zahlungsdatum und Jahr der Zahlung, also alles, woraus das erste Jahr folgt. Ein eigener Datensatz
  „Verteilung“ wäre eine zweite Stelle für dieselbe Angabe.
- **Nur Werte 2 bis 5.** „1 Jahr“ ist dasselbe wie keine Verteilung und bekommt keinen eigenen Wert, sonst gäbe es
  zwei Schreibweisen für dasselbe.
- **Nur, wo verteilt werden kann** (`allowsSpread` in shared/spread.ts, Server und Formular):
  - Kostenart „Nicht umlagefähig“ oder **„Entnahme Erhaltungsrücklage“** (aus #96 PR 1, das im Stapel vorher liegt;
    Zeile 57 nennt Entnahmen ausdrücklich). Instandhaltungskosten sind nach § 1 Abs. 2 Nr. 2 BetrKV keine
    Betriebskosten. Eine Reparatur unter einer umlagefähigen Kostenart wäre schon für die Abrechnung falsch erfasst.
    Die Zuführung zur Erhaltungsrücklage ist keine Werbungskosten (#143, BFH IX R 19/24) und lässt sich nicht verteilen.
  - Betrag über 0. Eine Gutschrift auf eine verteilte Maßnahme (etwa eine Erstattung im Folgejahr) mindert die
    Werbungskosten im Jahr ihres Zuflusses und wird nicht verteilt.
  - Kein Abzug beim Betriebsstrom. Das folgt schon aus der Kostenart und wird nur zur Sicherheit geprüft.
  - Bei „laut Gemeinschaftsabrechnung“ (`external`, Eigentumswohnung) **erlaubt**, soweit die Kostenart es ist: Der
    Anteil des Eigentümers an einer Erhaltungsmaßnahme der Gemeinschaft ist sein Erhaltungsaufwand, im Jahr, in dem
    die Gemeinschaft ihn verausgabt (E-10).
- **Der Server lehnt ab**, was die Bedingung verletzt (400, Satz mit Grund). Das Formular schickt `null`, sobald die
  Bedingung nicht mehr gilt (Muster `paidOn`/`showsPaidOn` in costForm.ts). Ändert sich die Kostenart einer verteilten
  Position, leert das Formular die Wahl und sagt es.
- **Kein Mindestbetrag und kein Hinweis zur Höhe.** Das Gesetz nennt keinen, und eine Schwelle von Mietfuchs wäre
  erfunden.

### E-2: Die Jahre bestimmt outflow.ts, aufbauend auf `outflowShares`

`outflowShares` bleibt die **einzige** Stelle für das Jahr des Abflusses und ändert sich nicht. Die Verteilung ist kein
zweiter Abfluss. Sonst hielten Übertrag aus dem Vorrat (`carryShareCents`), Verschiebungshinweise (`shiftNotes`),
Wechsel des Zeitraums (`storedOutflowYear`), Steuer-ZIP-Auswahl und `paidWhollyIn` eine verteilte Position für eine in
mehreren Jahren bezahlte, und `paidWhollyIn` bräche ab.

Neu in derselben Datei:

```ts
// Die Jahre des Abzugs einer Position (§ 82b EStDV, #262): je Anteil aus `outflowShares` die Jahre ab seinem Jahr.
// Ohne Verteilung genau das Jahr des Abflusses. `restYear` (E-7) beendet die Verteilung vorzeitig.
export type DeductionPlan = { outflowYear: number; years: number[]; restYear: number | null }
export function deductionPlan(item, period, items, restYear: number | null): DeductionPlan[]
```

- Je Anteil von `outflowShares` ein Plan. Heute gibt es genau einen, und mit #292 entstehen mehrere: je Zahlung ein
  eigener Verteilungszeitraum ab ihrem Jahr. Das deckt sich mit der Rechtslage (Zahlung in zwei Jahren, zwei
  Zeiträume). Bis #292 bricht `deductionPlan` wie `paidWhollyIn` bei mehreren Anteilen mit Meldung ab.
- `years` = `[Y0, …, Y0 + N − 1]`, gekürzt auf `≤ restYear` (E-7).
- **Keine andere Stelle rechnet ein Jahr des Abzugs.** Der Kopf von outflow.ts und server/src/CLAUDE.md („Jahr des
  Abflusses“) nennen beide Funktionen. Ein Wächter (Suche im Quelltext) verlangt, dass `spreadYears` außerhalb von
  outflow.ts, shared/spread.ts, den Schreibwegen in db/, dem Formular und der Anzeige nicht gelesen wird, und in
  calc.ts nur in `taxReport`/`taxReportFor` über `deductionPlan`. Die Gesamtsicht (#96 PR 3) liest `spreadYears`
  nie; sie summiert die fertigen Berichte je Objekt (die Wache nennt sie trotzdem ausdrücklich als erlaubten Leser
  von `taxReportFor`, damit niemand dort nachrechnet).

### E-3: Verteilt wird D = Betrag − privat; gekürzt wird jede Rate im Jahr ihres Abzugs

Die Aufteilung in privat und abziehbar rechnet `taxReport` für das Jahr des Abflusses Y0 wie heute (`splitForTax`).
**D = Betrag − privat** (ohne `gratuitousCents`) wird verteilt.

- **Rechtsgrund:** Werbungskosten ist nur der Teil, der auf die Vermietung entfällt (§ 9 Abs. 1, § 12 Nr. 1 EStG). Der
  Zusammenhang mit der Vermietung besteht im Zeitpunkt des Aufwands. § 82b verschiebt nur den Zeitpunkt des Abzugs,
  nicht den Betrag. Der Vordruck fragt genau so: Gesamtbetrag mal abzugsfähiger Anteil, davon der Anteil des Jahres.
- **Verbilligte Vermietung** (#257): **nicht** vor dem Verteilen. Die Anleitung zur Anlage V verlangt die Aufwendungen
  in den Zeilen 33 bis 84 in voller Höhe und die Kürzung ausschließlich in den Zeilen 87 und 88 (Anleitung 2024, S. 7;
  Durchsicht V1). Zeile 87/88 kürzt die Summe der Werbungskosten **des Jahres**; also wird jede Rate im Jahr ihres
  Abzugs mit der Quote dieses Jahres gekürzt, wie jede andere Position dieses Jahres: `cheapRentOf` des Jahres, Gewicht
  nach Fläche der betroffenen Einheiten (direkt 1), Σ (1 − Quote) × Tage / Tage des Jahres, aus dem abziehbaren Teil
  genommen und darauf geklemmt (Regel aus server/src/CLAUDE.md, „Verbilligte Vermietung“). Die abgeleitete Zeile
  eines Folgejahres trägt dafür Gewicht und Einheiten der Position. Es gibt dafür eine Fundstelle, keine Auslegung mehr.
- **Spätere Änderung der Nutzung** (eine Wohnung wird im dritten Jahr selbst bezogen) ändert den privaten Teil und
  damit D nicht. Fällt die Vermietung des Gebäudes ganz weg, greift Abs. 2 (E-7). Bei teilweisem Wechsel kommt ein
  Hinweis (E-8).
- **Lohnanteil § 35a** bleibt im Jahr des Abflusses, wie er ist. Er ist eine Angabe für die Abrechnung des Mieters bzw.
  für den eigenen Haushalt und kein Teil der Werbungskosten. § 35a Abs. 5 EStG schließt Werbungskosten aus, und an
  dieser Zahl ändert die Verteilung nichts.

### E-4: Raten auf den Cent, Rest-Cent in die ersten Jahre

`spreadRates(X, n)` in shared/spread.ts: `base = Math.floor(X / n)`, `r = X − n · base`; die ersten `r` Jahre bekommen
`base + 1`. X ist ≥ 0. Gerechnet wird zweimal: **`rateCents` = `spreadRates(D, N)`** (abziehbar vor Kürzung) und
**`grossRateCents` = `spreadRates(Betrag, N)`** (der Bruttoanteil des Jahres, den Zeile 57 „davon … abzuziehen“ und
Zeile 59/62 … „Gesamtbetrag“ fragen; Durchsicht V2). Ohne privaten Teil sind beide gleich.

- Das ist genau `largestRemainder(X, n × X/n, Jahre als Schlüssel)`: gleiche Nachkommaanteile, der Entscheid nach
  `compareText` der Jahreszahlen, also das früheste Jahr zuerst. Ein Test hält die Gleichheit für zufällige X und n
  fest. Gerechnet wird ganzzahlig, ohne Gleitkomma.
- **Warum vorn:** gleichmäßig verlangt gleiche Beträge, und ein Cent Unterschied ist das Mindeste. Vorn zieht
  ihn früher ab, und das ist für den Vermieter nicht schlechter. Er ist dann auch nicht vom letzten Jahr abhängig, das
  mit Abs. 2 womöglich nie kommt.
- **Mit Abs. 2** (E-7) bekommt das Jahr `restYear` den ganzen Rest, je für D und für den Betrag.
- **Je Position.** Teile einer Quelle (#455) werden je Teil verteilt. Bei mehreren Teilen kann die Summe der Raten eines
  Jahres um höchstens (Teile − 1) Cent von der Rate der ganzen Rechnung abweichen. Die Summe über alle Jahre bleibt
  centgenau. Jeder Teil steht ohnehin als eigene Zeile in Übersicht und CSV.
- `deductiblePercent` = D / Betrag, auf zwei Stellen abgeschnitten, wie der „abzugsfähige Anteil (in %)“ des Vordrucks;
  die Seite zeigt Gesamtbetrag (`grossRateCents`), Anteil und Ergebnis (`rateCents`) in der Reihenfolge des Vordrucks,
  damit der Vermieter nichts zurückrechnet.

### E-5: Darstellung im Bericht: die Position bleibt im Jahr des Abflusses, Raten als abgeleitete Zeilen

**Jahr des Abflusses Y0:** Die Position steht wie heute in ihrer Gruppe, mit Betrag und privat. Neu:

- `deferredCents = D − Rate₁` (in Folgejahre verschoben).
- `gratuitousCents` = Kürzung von Rate₁ mit der Quote von Y0 (E-3), `deductibleCents = Rate₁ − gratuitousCents`.
- `spread: { years: N, baseCents: D, rates: { year, cents, grossCents }[] }` (Auskunft für Anzeige und CSV).
- Je Zeile gilt **Betrag = privat + unentgeltlich + verschoben + abziehbar**.

**Folgejahre Y0 + k:** eine **abgeleitete Zeile** je Position, wie die Ausgleichszeile beim Betriebsstrom (#268) und
die ausgezahlte CO₂-Erstattung:

- `costItemId: 'spread:<Position>:<Y0>'`, Kostenart und Gruppe der Position, Beschreibung
  „Anteil k + 1 von N aus <Y0>: <Beschreibung>“.
- `amountCents: 0`, `privateCents: 0`, `deferredCents: −Rate`, `gratuitousCents`: Kürzung der Rate mit der Quote des
  Jahres Y0 + k, `deductibleCents: Rate − gratuitousCents`.
- `spreadFrom: { costItemId, outflowYear: Y0, index: k + 1, of: N, baseCents: D, grossRateCents, restAfterCents, rest?: true }`.

Abgeleitete Zeilen bleiben sonst ungekürzt (Betriebsstrom, CO₂); die Zeile `spread:` ist die Ausnahme, denn sie ist
der Werbungskostenanteil einer gewöhnlichen Position dieses Jahres. calc.ts nennt das am Ort der Kürzung.

**Summen:** `expenses.deferredCents` (vorzeichenbehaftet, Summe der Zeilen) und
`expenses.deductibleCents = totalCents − privateCents − gratuitousCents − deferredCents`. Gruppen und Kategorien
führen `deferredCents` mit (nur wenn ≠ 0, wie `gratuitousCents`). Der Überschuss rechnet weiter mit `deductibleCents`
und ist damit richtig.

**Warum Betrag 0 in den Folgejahren:** Über alle Jahre bleibt so der Gesamtbetrag der Ausgaben, was abgeflossen ist.
Der Betrag zählt nur im Jahr des Abflusses, und die Summe der Ausgaben stimmt mit dem Kontoauszug. Privat bleibt über
alle Jahre gleich, `deductibleCents + gratuitousCents` ebenfalls (Invarianten I-1 bis I-3).

**Zusätzlich ein Block** `expenses.spread` (nur, wenn es etwas zu verteilen gibt), gegliedert wie der Abschnitt der
Anlage V:

```ts
type TaxSpread = {
  // Zeilen 57–60: in diesem Jahr begonnene Verteilungen.
  started: { costItemId; description; amountCents; privateCents; baseCents; deductiblePercent: number | null; years;
    grossRateCents; rateCents; remainingCents; direct: boolean }[]
  // Zeilen 61–72: Anteile aus Vorjahren, je Ursprungsjahr.
  carried: { costItemId; description; outflowYear; index; of; baseCents; deductiblePercent: number | null;
    grossRateCents; rateCents; remainingCents; direct: boolean; rest?: true }[]
  thisYearCents: number // Σ rateCents dieses Jahres (begonnene + übernommene), vor der Kürzung in 87/88
}
```

`direct` = kein privater Teil (D = Betrag): Zeile 58 bzw. die erste der drei Zeilen des Ursprungsjahres; sonst
verhältnismäßig (Zeile 59 bzw. die zweite) mit Gesamtbetrag und Anteil. Die Zeilennummern liest die Seite aus
`anlageVLines(year).maintenance` (#96 PR 1, Durchsicht X5): `spread: { total: 57, direct: 58, proportional: 59, sum: 60 }`
und `spreadFromPriorYears: { fromYear, direct, proportional, sum }[]` (2025: 2021 → 61/62/63, 2022 → 64/65/66,
2023 → 67/68/69, 2024 → 70/71/72; 2024 laut Anleitung entsprechend). Liegt Y0 vor dem ältesten Ursprungsjahr des
Vordrucks, nennt die Seite keine Nummer. Die Kürzung steht nicht im Block, sondern wie heute bei 87/88.

### E-6: Wie die Folgejahre an D kommen

`taxReportFor(source, property, Y)` sucht die Positionen des Objekts mit `spreadYears`, deren Plan das Jahr Y in
`years` hat und Y0 < Y. Für jedes solche Y0 rechnet es **einmal** `taxReportFor(source, property, Y0, …, { carried:
false, received: false })` (Zwischenspeicher je Aufruf) und übernimmt aus dessen Zeile der Position `spread.rates`
und das Gewicht für die Kürzung.

- **Keine Rekursion über mehr als eine Stufe:** Mit `carried: false` sucht der Bericht für Y0 selbst keine Vorjahre.
  Für die Rate in Y zählt nur D aus Y0.
- **`received: false`** (Option aus #312, E11): Der Rückgriff braucht keine Einnahmen und rechnet deshalb keine
  Tilgung (Durchsicht X10). Die Quote der verbilligten Vermietung für Y kommt aus dem Bericht für Y selbst.
- **Ohne verteilte Position im Objekt passiert nichts** (Schnellweg, keine zusätzliche Rechnung). Die Prüfsummen
  bleiben gleich, und die Laufzeit auch.
- **Eine Zahl, eine Stelle:** Die Rate in Y ist dieselbe Funktion von Y0, die die Übersicht Y0 zeigt. Ändert sich D
  (etwa weil eine Fläche berichtigt wird), wandern alle Raten mit. Das ist gewollt, denn sonst stünde in Y0 eine andere
  Zahl als die Summe der Raten. **Kein Einfrieren abgegebener Steuerjahre** (Entscheidung des Leads, U-1): Jedes
  Folgejahr zeigt D zum Vergleich mit dem Bescheid Y0 (Hinweis `spreadCarried`, E-8); ein „Steuerjahr abgegeben“ ist
  kein Teil dieses Release.
- `taxReport` ohne Quelle (direkte Aufrufe in Tests) rechnet nur die eigenen Positionen (`started`) und kennt kein
  `carried`. So bleibt die heutige Unterschrift gültig.

### E-7: Vorzeitiges Ende (Abs. 2), am Objekt

`Property.spreadRestYear?: number | null`, Spalte `properties.spread_rest_year`: das Jahr, in dem der noch nicht
abgezogene Rest aller verteilten Positionen des Objekts abgezogen wird. Abs. 2 nennt Veräußerung, Einlage in ein
Betriebsvermögen und das Ende der Nutzung zur Einkunftserzielung; der **Tod** ist durch BFH IX R 31/19 gleichgestellt.
**Schenkung** (unentgeltliche Übertragung zu Lebzeiten) ist **Auslegung**: Der Schenker nutzt das Gebäude nicht mehr zur
Einkunftserzielung, also greift der dritte Fall des Abs. 2; eine Entscheidung eigens dazu ist nicht bekannt. Lexikon
und Hilfe am Feld kennzeichnen sie so. IX R 22/17 wird nur für das zitiert, was es sagt (Nießbrauch, Tabelle oben).

- **Am Objekt und nicht an der Position**, weil das Ereignis das Gebäude bzw. den Eigentümer betrifft und für alle
  Verteilungen zugleich gilt. Eine Angabe statt einer je Position.
- `deductionPlan` kürzt `years` auf `≤ restYear`. Das letzte Jahr bekommt den Rest. Ist `restYear = Y0`, wird
  nicht verteilt (alles in Y0), mit Hinweis `spreadRestBeforeStart`. **Abweichung (Durchsicht von PR 4, S2):** Ein Ende
  vor Y0 wirkt auf die Position nicht. Der Aufwand entstand nach dem Ereignis (die Erbin führt die Vermietung fort, die
  Wohnung wird wieder vermietet) und ist eine eigene Wahl; ursprünglich stand hier `restYear ≤ Y0`.
- **Beschriftung** (Durchsicht V7): „Verkauft, verschenkt, vererbt oder Vermietung beendet im Jahr“, ein Jahresfeld
  (wie `taxYear`, 1900 bis 2200), nur sichtbar, wenn das Objekt eine verteilte Position hat. Hilfe am Feld: „Der noch
  nicht abgezogene Teil des verteilten Erhaltungsaufwands wird in diesem Jahr abgezogen (§ 82b Abs. 2 EStDV). Wer erbt
  oder geschenkt bekommt, führt die Verteilung nicht fort. Bei einer Schenkung ist das eine Auslegung; fragen Sie im
  Zweifel Ihren Steuerberater.“ Dieselbe Beschriftung im Verlauf (`FIELD_LABELS`).
- **Der Erwerber** führt nichts fort. Mietfuchs übernimmt keine Verteilung in ein anderes Objekt oder einen anderen
  Bestand.

### E-8: Hinweise (taxHints in client/src/taxView.ts, Texte im Lexikon)

| Kennung | Wann | Inhalt |
|---|---|---|
| `spreadConditions` | eine Verteilung beginnt in diesem Jahr | Voraussetzungen: Privatvermögen; überwiegend Wohnzwecke nach Grundfläche (mehr als die Hälfte der Nutzfläche), Garagen bis ein Pkw je Wohnung zählen mit, weitere Stellplätze nicht; keine Ferienwohnung mit wechselnden Gästen; die Wahl gehört in die Erklärung dieses Jahres und bindet die Folgejahre; Miteigentümer verteilen gleich (Abs. 3); Denkmal und Sanierungsgebiet (§§ 11a, 11b EStG) rechnet Mietfuchs nicht. Immer als Warnung, nur im ersten Jahr (Entscheidung zu PR 3: Betriebsvermögen und die Nutzung jeder Fläche kennt Mietfuchs nicht); bei `kind: 'sonstiges'` mit dem Satz „Mietfuchs kennt die Nutzung der Flächen nicht“. Bei `kind: 'etw'` der Satz aus E-10. |
| `acquisitionRelated` | gemeinsamer Hinweis aus #96 PR 2 (Durchsicht X6): Datum der Anschaffung am Objekt bekannt → nur, wenn das Jahr in die drei Jahre nach dem Übergang fällt und es eine Verteilung oder Positionen der Erhaltung gibt; Datum unbekannt → nur, wenn in diesem Jahr eine Verteilung beginnt | anschaffungsnahe Herstellungskosten (§ 6 Abs. 1 Nr. 1a EStG): drei Jahre, 15 % netto, dann AfA statt Erhaltungsaufwand. Dieser Entwurf legt keinen eigenen Code an; er erweitert nur die Bedingung um „Verteilung beginnt“. |
| `spreadCarried` | Raten aus Vorjahren | „Diese Anteile gehören in die Erklärung dieses Jahres. Ein vergessener Anteil lässt sich nicht nachholen.“ (H 21.1 EStH) Nennt die Grundlage D je Position, damit der Vermieter sie mit seinem Bescheid Y0 vergleicht; weicht sie ab (Fläche berichtigt), gilt für die Erklärung der Wert des Bescheids. |
| `spreadUsageChanged` | im Verteilungszeitraum wechselt die Nutzung einer Einheit (`usageChangedUnits`, Selbstnutzung) | Prüfen, ob § 82b Abs. 2 greift (Vermietung beendet); die Raten bleiben, wie sie sind |
| `spreadNothingDeductible` | D = 0 (direkt der selbstgenutzten Wohnung zugeordnet) | Die Verteilung hat keine Wirkung |
| `spreadRest` | `restYear` = dieses Jahr, mit Rest | Rest nach § 82b Abs. 2 |
| `spreadRestBeforeStart` | `restYear = Y0` (ein Ende davor wirkt nicht, Durchsicht S2) | nichts verteilt |
| `spreadIgnored` | `spreadYears` an einer Position, für die `allowsSpread` nicht gilt (Ablage von Hand, wiederhergestellt) | nicht verteilt, mit Name der Position |

`specialLevySuspects` (#96 A4.3) gilt auch für eine Position „Nicht umlagefähig“ mit „Sonderumlage“ in der
Beschreibung **und gewählter Verteilung** (Durchsicht X3): Die eigene Zahlung an die Gemeinschaft ist nicht das Jahr
des Abzugs; erfasst wird der Anteil laut Jahresabrechnung als „Entnahme Erhaltungsrücklage“ bzw. Anteil an der
Maßnahme im Jahr der Verausgabung (E-10). Die Bedingung steht in calc.ts bei `specialLevySuspects`, ergänzt in PR 2.

Der bisherige Satz „die Verteilung nach § 82b EStDV tragen Sie selbst ein; diese Angaben kennt Mietfuchs nicht“
(Steuer.tsx, `mixedUseNotCalculated`) wird zu: „Größeren Erhaltungsaufwand verteilt Mietfuchs, wenn Sie es an der
Position wählen (§ 82b EStDV).“

Der Hinweis zur Gruppe „Erhaltungsaufwand“ (#96 A4.1, „Zeile 55/56“) nennt 55/56 nur für unverteilte Positionen;
verteilte stehen im Block aus E-5 (Durchsicht X7). #96 formuliert den Satz so von Anfang an.

### E-9: Formular (costForm.ts, Kosten.tsx)

- Unter „Weitere Angaben“, neben „Bezahlt am (für die Steuer)“, steht ein Auswahlfeld „Für die Steuer verteilen
  (§ 82b EStDV)“ mit den Werten **„nicht verteilen“** und „auf 2 Jahre“ bis „auf 5 Jahre“ (kurz, der Browserlauf misst
  `clippedFields`). Die Hilfe am Feld sagt: „Ohne Verteilung zählt der Betrag ganz im Jahr der Zahlung.“ Die Optionen
  kommen aus `spreadOptions` (shared/spread.ts). Das Feld ist nur sichtbar, wenn `allowsSpread`.
- Darunter live: „Abzug 2026 bis 2030, je etwa 1.000 € vom abziehbaren Teil“ (Jahr aus `statedOutflowYear`, sonst
  Beginn des Zeitraums, wie `effectiveYear` in shared/paidOn.ts; Betrag Brutto / N mit „etwa“, denn D kennt erst die
  Steuerübersicht). Dazu ein Satz zu anschaffungsnahen Herstellungskosten und ein Link ins Lexikon.
- **Rückfrage beim Ändern** (`spreadQuestions` in shared/spread.ts, Muster `paidOnQuestions`, 409
  `question: 'spread'`, `confirmSpread`): beim Setzen, Ändern oder Entfernen an einer **gespeicherten** Position und
  beim Ändern von Zahlungsdatum oder Jahr der Zahlung an einer verteilten Position („Die Verteilung beginnt dann 2027
  statt 2026“). Text: welche Jahre sich ändern, dazu der ADVICE-Satz („Haben Sie die Steuererklärung eines
  betroffenen Jahres schon abgegeben …“) und „Die Wahl ist an die Erklärung des ersten Jahres gebunden.“ Beim Anlegen
  wird nicht gefragt.
- **Löschen** einer verteilten Position: Die Rückfrage nennt „Die Anteile 2027 bis 2030 entfallen damit.“
- **Übernehmen aus dem Vorjahr** (client/src/carryOver.ts) leert `spreadYears` wie `paidOn`, denn die Wahl gilt je
  Aufwand.
- Belegbuchung und KI-Auswertung belegen das Feld nie vor.
- jsdom-Test: Der angezeigte Wert des Auswahlfelds entspricht dem gespeicherten (CLAUDE.md, Tests Ebene 3).

### E-10: Eigentumswohnung

- **Die Eigentumswohnung gilt als das Gebäude im Sinne der Vorschrift** (**Auslegung**, hier entschieden; #96 hatte es
  empfohlen): Wohnungseigentum ist ein selbständiges Wirtschaftsgut und das Objekt der Anlage V; „überwiegend
  Wohnzwecke“ wird an der Wohnung gemessen, nicht am Gebäude der Gemeinschaft. Teileigentum, etwa eine gewerbliche
  Einheit, dient nicht Wohnzwecken. Der Hinweis `spreadConditions` sagt das bei `kind: 'etw'`.
- **Sonderumlage** (Durchsicht X3, im Einklang mit #96 R5): Die Zahlung des Eigentümers an die Gemeinschaft ist nie das
  Jahr des Abzugs. Abziehbar und damit verteilbar ist erst der eigene Anteil an der Maßnahme **im Jahr, in dem die
  Gemeinschaft ihn verausgabt** (BFH IX R 19/24, gleiche Begründung; FG Niedersachsen 2005, laut #96). Erfasst wird er
  als „Entnahme Erhaltungsrücklage“ bzw. als Anteil laut Jahresabrechnung ohne Datum; `outflowShares` legt ihn ins
  Jahr der Abrechnung (#96 R4) oder ins angegebene Jahr der Zahlung (#478 hält es beim Zeitraumwechsel). Eine
  Sonderumlage, die in die Rücklage fließt, ist eine Zuführung und nicht verteilbar. Der Hinweis
  `specialLevySuspects` (E-8) fängt die als „Nicht umlagefähig“ mit eigenem Datum erfasste.
- **Zuführung zur Erhaltungsrücklage**: nicht verteilbar, denn sie ist keine Werbungskosten (#143, BFH IX R 19/24).
- **Entnahme aus der Rücklage** (#96 PR 1): eigene Kostenart „Entnahme Erhaltungsrücklage“, in `allowsSpread` von
  Anfang an (E-1). Die erste Rate gehört ins Jahr aus `outflowShares`, also ins Jahr der Ausgabe durch die
  Gemeinschaft; Zeilen 57–60 im ersten, 61–72 in den Folgejahren (Durchsicht X7).
- **Abs. 3 (Miteigentümer)**: Mietfuchs führt einen Vermieter je Bestand. Die Wahl steht an der Position und gilt damit
  für alle. Der Hinweis nennt die Pflicht.

### E-11: Quellrechnung (#455): eine Wahl je Rechnung

- `SPLIT_FIELDS.spreadYears = 'same'`: Beim Aufteilen tragen alle Teile die Wahl.
- **Ändert der Vermieter die Wahl an einem Teil, schreibt der Server sie an alle Teile derselben Quelle**, in einer
  Transaktion und damit in einer Gruppe des Verlaufs (`syncSourceSpread` in db/repository.ts). Die Rückfrage nennt die
  Teile. **Entschieden (Lead, U-2): eine Wahl je Rechnung.** Eine Rechnung ist eine Maßnahme, und eine Wahl je Rechnung
  ist für Vermieter ohne Vorkenntnisse die verständliche Form. **Grenze:** Rechtlich dürfte, wer eine Rechnung in zwei
  Jahren bezahlt, je Jahr verschieden wählen. Mietfuchs bietet das nicht an; Lexikon `spread82b` nennt es.
- Das Zusammenfassen beim Wechsel des Zeitraums vergleicht `spreadYears` von selbst mit (`ALLOCATION_FIELDS` nimmt jedes
  `same`-Feld). Teile mit verschiedener Wahl, etwa aus einer Ablage von Hand, werden also nicht zusammengefasst.
- Das Steuer-ZIP nennt je Teil seine Raten. Ein Teil ohne eigenen Beleg verweist wie heute auf die Belege der Quelle
  (#469).

### E-12: Steuer-ZIP und Übersicht.csv (taxReceipts.ts)

- **Der Beleg liegt im Archiv des Jahres des Abflusses**, wie heute: `taxArchiveItems` wählt über die Teile und ändert
  sich nicht.
- **Spalte „verteilt § 82b EStDV (EUR)“** in der Übersicht.csv, nur wenn eine Zeile verteilt ist (Muster „unentgeltlich“,
  #257). In Y0 steht dort der verschobene Betrag, in Folgejahren der übernommene mit Minus. Damit ergibt jede Zeile
  Betrag = privat + unentgeltlich + verteilt + abziehbar, und die Summen sind die der Übersicht.
- **Folgejahre**: Die abgeleiteten Zeilen kommen über `derivedTaxLines` (Filter um `spreadFrom` erweitert). Beleg:
  „kein eigener Beleg (Anteil 2 von 5 aus 2026, Beleg im Steuer-ZIP 2026)“. Spalte „Jahr der Zahlung“: das Jahr Y0 mit
  seiner Quelle (`outflowText`). Die Datei wird **nicht** noch einmal beigelegt. Ordner wie die Gruppe der Position
  (bei einer Entnahme „Erhaltungsaufwand“, #96).
- In Y0 bekommt „Jahr der Zahlung“ den Zusatz „auf 5 Jahre verteilt, 2026 bis 2030“.

### E-13: Rechenweg und Lexikon

- Die Schritte der Position (`steps`) bekommen „Verteilung nach § 82b EStDV“ mit „abziehbar D auf N Jahre: je R
  (Restcent in den ersten Jahren)“, `term: 'spread82b'`; bei verbilligter Vermietung den Satz „Gekürzt wird jeder
  Anteil im Jahr seines Abzugs mit der Quote dieses Jahres (Anleitung zur Anlage V, Zeilen 87 und 88).“
- Lexikon (shared/glossary.ts): `spread82b` (Voraussetzungen, Wahl, Bindung, eine Wahl je Rechnung, Abs. 2 mit Tod und
  Schenkung als Auslegung, Grenzen §§ 11a/11b) verweist auf den gemeinsamen Begriff „Anschaffungsnahe
  Herstellungskosten“ aus #96 (Durchsicht X6). Siezen (anrede.test.ts).

### E-14: Nebenkostenabrechnung

Unberührt. `computeSettlement`, Mietkonto, Verbrauch, Schnappschuss und eingefrorene Abschlüsse lesen `spreadYears`
und `spreadRestYear` nie. Wie `paidOn`: „Die Abrechnung liest es nie“ steht am Typ, und ein Wächter (Suche im
Quelltext) prüft es. Eine Zufallsinvariante setzt `spreadYears` zufällig und vergleicht Abrechnungen centgenau.

## Daten

- **Migration** nach der Regel „Spalten und Bedingungen nie in einem Schritt“ (server/drizzle/README.md), Paar wie
  0056/0057, im Stapel des Releases **0082/0083** (Nummer beim Umstellen auf `main` mit `db:generate` neu erzeugt):
  - `0082_verteilung_82b.sql`: `ALTER TABLE cost_items ADD spread_years integer`, `ALTER TABLE properties ADD
    spread_rest_year integer`.
  - `0083_verteilung_82b_bedingungen.sql`: CHECK `cost_items_spread_years_valid` (`spread_years IS NULL OR
    spread_years BETWEEN 2 AND 5`) und `properties_spread_rest_year_valid` (NULL oder 1900 bis 2200). drizzle-kit baut
    dafür beide Tabellen neu (`properties` hat dann schon die Spalten aus #96, 0080/0081).
  - Kein Datenschritt: Jeder Bestand bekommt NULL, also keine Verteilung.
  - Die Bedingung „nur Nicht umlagefähig bzw. Entnahme, Betrag > 0“ prüft das Repository, nicht die Datenbank.
    Kostenarten sind Text, und eine spätere Erweiterung soll keine Tabelle neu bauen müssen.
- **Eingefrorener Eingang und Validator**: unberührt. Die db.json kennt keine Verteilung. Die Kette setzt NULL.
- **Backup und Wiederherstellen**: Die Spalten kommen mit dem Schnappschuss. Ein älteres Backup holt die Kette nach.
  Wiederherstellen eines Bestands mit `spread_years` an einer Position, die die Bedingung verletzt (Ablage von Hand),
  ist **krumm, nicht kaputt**: Es wird hingenommen. Die Steuer rechnet nur, wo `allowsSpread` gilt, und nennt den Rest
  im Hinweis `spreadIgnored`, statt still zu verteilen.
- **Verlauf und Rücksprung** (#318): Die Trigger entstehen beim Öffnen von selbst. **`FIELD_LABELS`** in
  client/src/journalView.ts bekommt `spread_years: 'Für die Steuer verteilen (§ 82b EStDV)'` und
  `spread_rest_year: 'Verkauft, verschenkt, vererbt oder Vermietung beendet im Jahr'` (sonst zeigte der Verlauf den
  Spaltennamen; ein Test in journalView.test.ts verlangt für jede Spalte von schema.ts eine Beschriftung oder einen
  Grund). Der Rücksprung über ein Setzen mit Weitergabe an Teile ist in api-ruecksprung.test.ts geprüft.
- **Neue Version, alter Server**: Eine Datei mit 0082/0083 öffnet ein älterer Server nicht (`unknownSteps`), wie bei
  jedem Schritt.
- **Export** (JSON/CSV der Kostenpositionen): Das Feld wird mitgeführt, wo Exporte Felder aufzählen.

## Zusammenspiel mit den Entwürfen des Releases

- **#312 (Zufluss nach Zeilen):** betrifft nur `income`, dieser Entwurf nur `expenses`. Der Rückgriff auf Y0 nutzt
  `received: false` (E-6). Beide ändern `TaxReport` und Steuer.tsx; in `taxFingerprint` nimmt keiner ein Feld auf,
  das ohne Angabe ≠ 0 ist.
- **#96 Rest:** liefert vorher die Kostenart „Entnahme Erhaltungsrücklage“ (in `allowsSpread` von Anfang an),
  `anlageVLines` mit den Zeilen 57–72, den gemeinsamen Hinweis `acquisitionRelated` mit dem Datum am Objekt und
  `specialLevySuspects`. Die Gesamtsicht (#96 PR 3, nach diesem Entwurf) summiert `deductibleCents` nach Raten.
- **#478 (Wechsel des Zeitraums behält das angegebene Jahr):** liegt vorher. Die Raten hängen am Jahr des Abflusses.
  Bleibt das beim Wechsel stehen, bleiben auch die Raten. `spreadYears` ist `same` und wandert mit jedem Teil. Die
  Vorschau (`taxShifts`) nennt bei einer verteilten Position, dass sich mit dem Jahr auch alle Raten verschieben.
  Test: Hin- und Zurückwechseln ergibt je Steuerjahr dieselben Raten.
- **#281:** keine Berührung (Mietkonto liest `spreadYears` nie).
- **#292 (Abbuchungen):** `deductionPlan` ist schon je Anteil gebaut. Mehrere Zahlungen ergeben mehrere
  Verteilungszeiträume, und dann rechnet E-3 D je Anteil. Bis dahin bricht die Funktion mit Meldung ab.

## Invarianten (Tests, nicht Datenbank)

- **I-1 Σ über alle Jahre unverändert:** Für jeden Zufallsbestand und jede zufällige Wahl von `spreadYears` (und
  `spreadRestYear`) sind Σ_Jahre `totalCents`, Σ `privateCents` und Σ (`deductibleCents` + `gratuitousCents`)
  centgenau gleich dem Bestand ohne Verteilung. **Σ `gratuitousCents` allein nicht** (gekürzt wird mit der Quote des
  Jahres der Rate, V1). Ohne verbilligte Vermietung gilt zusätzlich Σ `deductibleCents` gleich. Die Jahresspanne
  reicht bis Y0 + 4 des spätesten Abflusses.
- **I-2 Je Jahr:** `totalCents = privateCents + gratuitousCents + deferredCents + deductibleCents`, für die Übersicht, je
  Gruppe, je Kategorie und je Zeile.
- **I-3 Σ_Jahre `deferredCents` = 0** je Position.
- **I-4 Raten:** Jede Rate ist ⌊X/N⌋ oder ⌈X/N⌉ (für D und für den Betrag), nicht steigend über die Jahre, Σ = X;
  gleich `largestRemainder` mit Jahresschlüsseln. Mit `restYear`: keine Rate nach ihm, und das Jahr `restYear` trägt
  den Rest.
- **I-5 Ohne Angabe nichts:** tax-golden.json unverändert, auch wenn jede Position `spreadYears: undefined` bzw. `null`
  trägt. Der Generator (taxStock.ts) bleibt unverändert.
- **I-6 Abrechnung unberührt:** Abrechnung, Mietkonto und Verbrauch centgenau gleich mit zufälligem `spreadYears`.
- **I-7 Ein Jahr des Abflusses:** `outflowShares`, `paidWhollyIn`, `shiftNotes`, `movedOut`, `carryShareCents` und die
  ZIP-Auswahl sind mit und ohne Verteilung gleich.
- **I-8 ZIP:** Die Spaltensummen der Übersicht.csv sind die der Übersicht, je Jahr. Der Beleg einer verteilten Position
  liegt nur im Archiv von Y0.
- **I-9 Quote je Jahr:** Wechselt die Quote der verbilligten Vermietung zwischen Y0 und Y0 + k, ist die Kürzung der
  Rate in Y0 + k dieselbe wie die einer unverteilten Position gleichen Betrags (= Rate) und gleicher Einheiten in
  Y0 + k (Nachweis von V1).
- **X9 (d)** mit #96: Eine Entnahme, auf „Nicht umlagefähig“ umgestellt und verteilt, ergibt über alle Jahre dieselben
  Summen wie unverteilt (I-1 dieses Entwurfs × I1 von #96); im Release-Plan als Kreuz-Invariante.

## Entschieden

Vom Lead entschieden (vorher U-1 bis U-4):

- **U-1 Kein Einfrieren abgegebener Steuerjahre.** Ändert sich D nach Abgabe der Erklärung Y0, wandern die Raten der
  Folgejahre mit; jedes Folgejahr zeigt D zum Vergleich (`spreadCarried`). Kein „Steuerjahr abgegeben“ in diesem
  Release.
- **U-2 Eine Wahl je Rechnung** (E-11), mit der Grenze im Lexikon.
- **U-3 §§ 11a/11b EStG bleiben draußen**, nur als Grenze genannt (Lexikon, `spreadConditions`).
- **U-4 § 82b Abs. 2 kommt in diesem Release** (PR 4, Stapel Nr. 11); Schenkung als Auslegung gekennzeichnet.
- Dazu aus der Durchsicht: Kürzung bei verbilligter Vermietung je Jahr der Rate nach der Verteilung (V1); Jahr der
  Sonderumlage = Jahr der Verausgabung durch die Gemeinschaft (X3, wie #96); `grossRateCents` für die Zeilen 57/59
  (V2); Zeilennummern 61–72 je Ursprungsjahr aus `anlageVLines` (X5); ETW: Wohnzwecke an der Wohnung gemessen.

## Vorgehen in Schritten (je ein PR, aufeinander aufbauend, TDD)

Vier PRs im Stapel des Releases (dort Nr. 8 bis 11). Jeder Schritt beginnt mit dem roten Test. `npm run typecheck`
vor jedem Commit. Commits mit `Refs #262`. CHANGELOG unter „Unveröffentlicht“ mit Link auf #262 (Wortlaut im
Release-Plan).

### PR 1 (Stapel Nr. 8): Datenmodell und Schreibweg (keine Zahl ändert sich)

Hängt ab von: Nr. 4 (#96 PR 1, Kostenart „Entnahme Erhaltungsrücklage“) und Nr. 5 (#96 PR 2, Migrationen 0080/0081
liegen vor 0082/0083). Dateien: server/src/db/schema.ts, server/drizzle/0082*, 0083*, shared/types.ts
(`CostItem.spreadYears`, `Property.spreadRestYear`), shared/spread.ts (neu: `allowsSpread`, `SPREAD_YEARS`,
`spreadOptions`, `spreadRates`, `spreadQuestions`), shared/splitPart.ts (`spreadYears: 'same'`),
server/src/db/repository.ts (Lesen/Schreiben, Prüfung `requireSpread`, `syncSourceSpread`, Rückfrage 409 `spread`),
server/src/index.ts (Rumpf, `confirmSpread`), server/src/journalRoutes.ts (Satz, falls neue Route),
client/src/journalView.ts (`FIELD_LABELS`), client/src/carryOver.ts.

Tests zuerst:
1. `server/test/spread.test.ts` (neu, rein): `spreadRates` für X ∈ {0, 1, 4, 5, 99 999}, n ∈ 2…5. Rest-Cent vorn. Gleichheit
   mit `largestRemainder` über 1 000 Zufallsfälle mit festem Startwert. `allowsSpread` je Kostenart (Nicht umlagefähig
   und Entnahme ja, Zuführung und umlagefähige nein), Betrag ≤ 0, Abzug beim Betriebsstrom, `external`.
2. `server/test/migrations.test.ts`: 0082/0083 auf einem Bestand mit Inhalt; die Bedingung lehnt 1 und 6 ab.
3. `server/test/api-kosten*.test.ts` (Datei des Themas): Setzen, Ablehnen bei falscher Kostenart (400 mit Satz),
   Rückfrage beim Ändern einer gespeicherten Position (409 ohne `confirmSpread`), keine Rückfrage beim Anlegen,
   Weitergabe an alle Teile einer Quelle in einem Vorgang, Wechsel der Kostenart mit Wahl abgelehnt.
4. `api-ruecksprung.test.ts`: Rücksprung über Setzen mit Weitergabe stellt alle Teile wieder her.
5. Backup/Wiederherstellen: Rundlauf mit Wahl; altes Backup ergibt NULL.
6. `client/src/carryOver.test.ts`: Übernahme leert `spreadYears`.
7. Wächter: `SPLIT_FIELDS` deckt das Feld ab (Übersetzer), journal.test.ts (Trigger mit neuen Spalten),
   journalView.test.ts (Beschriftung beider Spalten).

### PR 2 (Stapel Nr. 9): Rechnung (outflow.ts, calc.ts)

Hängt ab von: Nr. 8; liest die Option `received: false` aus Nr. 6 (#312 PR 2). Dateien: server/src/outflow.ts
(`deductionPlan`), server/src/calc.ts (`taxReport`: Verteilung von D, Kürzung je Jahr der Rate, Zeilen, Summen,
`steps`, `specialLevySuspects` erweitert; `taxReportFor`: Folgejahre mit Zwischenspeicher, `carried: false`,
`received: false`), shared/types.ts (`TaxExpenseItem.deferredCents/spread/spreadFrom`,
`TaxExpenseCategory/Group.deferredCents`, `expenses.deferredCents`, `expenses.spread` mit `grossRateCents`),
server/src/CLAUDE.md („Steuer“, „Jahr des Abflusses“).

Tests zuerst:
1. `server/test/outflow.test.ts`: `deductionPlan` ohne Wahl = `[Y0]`; mit Wahl N Jahre ab Y0 aus Zahlungsdatum, Jahr der
   Zahlung und Zeitraum; Heizposition ausgeschlossen; `restYear` kürzt; mehrere Anteile werfen.
2. `server/test/calc-steuer-verteilung.test.ts` (neu): Beispiel 10.000 € auf 3 Jahre, ohne Eigennutzung: 3.333,34 /
   3.333,33 / 3.333,33. Mit 40 % Eigennutzung (Fläche): D = 6.000, Raten 2.000, `grossRateCents` 3.333,34 / 3.333,33 /
   3.333,33, `deductiblePercent` 60. **Verbilligte Vermietung mit wechselnder Quote** (Y0 50 %, Y0 + 1 100 %): Rate in
   Y0 gekürzt, Rate in Y0 + 1 ungekürzt; umgekehrt ebenso (I-9). Mai-bis-April-Objekt mit Zahlungsdatum im Folgejahr.
   Entnahme verteilt. Rest im Jahr `restYear`. D = 0. Abgeleitete Zeile mit Betrag 0. Gruppensummen. Überschuss.
   `specialLevySuspects` mit Verteilung an „Nicht umlagefähig“ mit „Sonderumlage“.
3. `server/test/invariant-steuer-verteilung.test.ts` (neu, Startwerte über INV_FROM/INV_TO): I-1 bis I-4, I-7 und I-9
   auf `randomTaxStock` mit zufällig gesetzter Wahl an den erlaubten Positionen und zufälligem `restYear`.
4. `outflow.test.ts` Prüfsummen: I-5 (tax-golden.json unverändert, auch mit `spreadYears: undefined` überall).
5. `server/test/calc.test.ts`-Geschwister: I-6 (Abrechnung, Mietkonto und Verbrauch mit zufälliger Wahl gleich).
6. Wächter (Suche im Quelltext): `spreadYears` in calc.ts nur über `deductionPlan`, nicht in `computeSettlement`
   und den Schnappschuss-Funktionen.
7. Laufzeit: Rückgriff auf Y0 ohne Tilgung (Test zählt Aufrufe von `allocateRentPayments`: 0 im Rückgriff).

### PR 3 (Stapel Nr. 10): Steuer-ZIP, Steuerübersicht, Formular, Hinweise, Lexikon

Hängt ab von: Nr. 9 und Nr. 7 (#312 PR 3, Einnahmentabelle; Konfliktdateien taxView.ts, Steuer.tsx). Dateien:
server/src/taxReceipts.ts (Spalte, abgeleitete Zeilen, Zusatz „verteilt“), client/src/taxView.ts (Hinweise,
Texte der Raten, Block nach Anlage V), client/src/anlageV.ts (Struktur `spread` und `spreadFromPriorYears` je
Ursprungsjahr, falls #96 PR 1 sie nur als Platzhalter angelegt hat), client/src/pages/Steuer.tsx (Spalte „verteilt“,
Block „Zu verteilender Erhaltungsaufwand“, Satz in `mixedUseNotCalculated`), client/src/costForm.ts (`spreadYears`
im ItemForm, `costItemBody`, Vorschau der Jahre), client/src/pages/Kosten.tsx (Feld, Rückfrage, Löschen),
shared/glossary.ts (`spread82b`).

Tests zuerst:
1. `server/test/taxReceipts.test.ts`: Spalte nur mit Verteilung; Zeilensumme I-2 in der CSV; Folgejahr ohne Datei, mit
   Verweis; Beleg nur im Archiv von Y0 (I-8); Teil einer Quelle ohne eigenen Beleg verweist weiter auf die Quelle.
2. `client/src/taxView.test.ts`: jede Hinweiskennung aus E-8 mit Auslöser und ohne; `acquisitionRelated` mit und ohne
   Datum am Objekt; Texte der Raten („Anteil 2 von 5 aus 2026“); Zeilen des Blocks für 2025 (57–60; 2023 → 67/68/69)
   und keine Nummer für 2026 und für ein Ursprungsjahr vor 2021.
3. `client/src/costForm.test.ts`: `allowsSpread` blendet ein und aus; Kostenartwechsel leert die Wahl;
   `costItemBody` schickt `null`; Vorschau der Jahre aus Datum, Jahr und Zeitraum; Rückfragen.
4. `client/src/pages/Kosten.*.test.tsx` (jsdom): Der angezeigte Wert des Auswahlfelds entspricht dem gespeicherten (3 →
   „auf 3 Jahre“); Rückfrage beim Ändern; Hinweis beim Löschen.
5. `client/src/pages/Steuer.*.test.tsx` (jsdom): Spalte und Block erscheinen nur mit Verteilung; Gesamtbetrag, Anteil
   und Ergebnis in der Reihenfolge des Vordrucks; Folgejahr zeigt die Rate und die Grundlage; Reihenfolge der Blöcke
   (Test aus #96 PR 1).
6. anrede.test.ts (Siezen in neuen Texten), Lexikon-Wächter (jede `term` hat einen Eintrag).

Aufgaben aus der Durchsicht von PR 2 (dort schon erledigt: Spalte „verteilt § 82b EStDV“ und die Zeilen `spreadFrom`
in der Übersicht.csv, `derivedTaxLines`, Zusatz „auf N Jahre verteilt“ bei „Jahr der Zahlung“):
- Die Steuerseite kennt `deferredCents` und `spreadFrom` noch nicht: `showsSplit` (client/src/taxView.ts), die Tabelle
  der Werbungskosten und `SplitTable` in Steuer.tsx und der Satz „… abziehbar“ unter den Summen rechnen ohne den
  verschobenen Teil; eine Zeile ergibt dort sonst nicht Betrag = privat + unentgeltlich + verschoben + abziehbar.
- `maintenanceLineText` (Steuer.tsx) unterscheidet verteilte Positionen nicht: Sie gehören in die Zeilen 57 bis 72, nicht
  in 55/56 (`isSpread` oder Abfrage von `spread`/`spreadFrom`).
- Lexikon `spread82b`: Der private Teil steht im Jahr des Abflusses fest (E-3), die Quote der verbilligten Vermietung
  gilt je Jahr der Rate (V1). Dazu `term: 'spread82b'` an den Schritten „Verteilung nach § 82b EStDV“ in calc.ts.
- Rate von D = 0 bei Bruttoanteil über 0 (direkt der selbstgenutzten Wohnung, `spreadNothingDeductible`) bewusst
  entscheiden: PR 2 legt dann im Folgejahr keine Zeile an und zeigt die Verteilung nur in Y0.

### PR 4 (Stapel Nr. 11): Vorzeitiges Ende (§ 82b Abs. 2)

Hängt ab von: Nr. 10. Dateien: Objektformular (client, Objekte-Seite und reines Formularmodul),
server/src/db/repository.ts (Objekt, Prüfung 1900 bis 2200, Rückfrage beim Setzen mit verteilten Positionen),
`taxReportFor` (reicht `restYear` an `deductionPlan`), client/src/taxView.ts (`spreadRest`, `spreadRestBeforeStart`,
`spreadUsageChanged`), shared/glossary.ts (Abs. 2, Schenkung als Auslegung).

Tests zuerst:
1. `calc-steuer-verteilung.test.ts`: Verkauf im zweiten von fünf Jahren, Rest dort und nichts danach;
   `restYear ≤ Y0`; I-1 mit `restYear`.
2. `api-objekte*.test.ts`: Setzen, Prüfung, Rückfrage.
3. jsdom: Feld nur bei verteilten Positionen; Beschriftung „Verkauft, verschenkt, vererbt oder Vermietung beendet im
   Jahr“; angezeigter Wert = gespeicherter.

### Danach

Integrationsdurchsicht des Endstands (`main..Spitze`) laut Release-Plan unter Geld (I-1 bis I-9, X9 c/d, Zusammenspiel
mit #257, #163, #268, #478) und Daten (Migrationskette 0078–0083, Backup, Rücksprung, Journal-Beschriftungen, Doku),
dazu der Praxislauf und das Label `full-check` (CLAUDE.md).

## Umfang

Etwa 4 PRs. Produktionscode schätzungsweise 950 bis 1.250 Zeilen, davon calc.ts ~280, taxReceipts ~60,
Steuer.tsx/taxView ~300, Formular ~150, Repository/Schema ~200. Tests etwa ebenso viel. Heikel sind PR 2 (Summen,
Kürzung je Jahr, eine Stufe Rückgriff auf Y0) und PR 3 (Anzeige ohne doppelte Zählung im Vordruck).

## Quellen

- § 82b EStDV: https://www.gesetze-im-internet.de/estdv_1955/__82b.html
- BFH, Urteil vom 10.11.2020, IX R 31/19 (Tod im Verteilungszeitraum), Besprechungen: haufe.de „Abzug nicht verbrauchter
  Erhaltungsaufwendungen beim Erblasser“; blogs.pwc.de (Artikel 228417)
- BFH, Urteil vom 13.03.2018, IX R 22/17; Beschluss vom 25.09.2017, IX S 17/17 (nur Nießbrauch)
- BFH, Urteil vom 14.01.2025, IX R 19/24 (Rücklage erst bei Verausgabung; Begründung für die Sonderumlage)
- iww SR „Mandanten fragen: Welche Möglichkeiten ergeben sich bei größerem Erhaltungsaufwand“, Teil 1 (f139009) und
  Teil 2 (f139590)
- iww astw „§ 21 EStG – Verteilung des Erhaltungsaufwands abhängig vom Zeitpunkt der Zahlung“ (f52824)
- H 21.1 EStH (BFH vom 26.10.1977: kein Übertrag eines Jahresanteils; nicht unabhängig geprüft), R 21.1 Abs. 6 EStR 2012
- § 6 Abs. 1 Nr. 1a, § 9 Abs. 5 Satz 2, §§ 11a, 11b, § 35a Abs. 5 EStG; BFH, Urteil vom 14.06.2016, IX R 25/14
- Anlage V 2025, Vordruck 2025AnlV101 (Zeilen 55–72); Anleitung zur Anlage V 2024 (Zeilen 57–60; S. 7 zur Kürzung bei
  verbilligter Vermietung nur in 87/88)
