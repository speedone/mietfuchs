# Abrechnungszeitraum, der vom Kalenderjahr abweicht (#208)

Teil des Vorhabens „Heizung vollständig abdecken“ (Meilenstein 0.11.0), gefunden bei der Planung
der CO₂-Kostenaufteilung (#97, Entwurf auf `feat/co2-kostenaufteilung`, Abschnitt 12). Ziel ist
die breite Abdeckung aller gelebten Formen privater Vermietung (#91).

## 0. Die Entscheidungen auf einen Blick

| # | Frage | Entscheidung | Abschnitt |
|---|---|---|---|
| 1 | Woran hängt der Zeitraum? | Am **Objekt**: ein Beginnmonat (Vorgabe Januar) und eine Liste von **Wechseln**. Die einzelnen Zeiträume werden daraus **berechnet** und nicht gespeichert. | 3.1 |
| 2 | Wie heißt ein Zeitraum im Bestand? | **Zeitraumschlüssel** in den bisherigen `year`-Spalten: Beginnt der Zeitraum im Januar, ist der Schlüssel das Jahr (`2025`), sonst `JJJJMM` des Beginns (`202505`). Ein Kalenderjahr behält damit genau seinen heutigen Wert. | 3.2 |
| 3 | Rumpfzeitraum beim Wechsel? | Ja, automatisch: Der letzte Zeitraum des alten Rhythmus endet am Tag vor dem Wechsel. Kein Zeitraum ist je länger als zwölf Monate. | 3.3, 2.2 |
| 4 | Rechnungen über das Kalenderjahr (Grundsteuer, Versicherung) in einem Zeitraum Mai–April? | **Ganz zuordnen**, und zwar dem Zeitraum mit der größten Überschneidung (Grundsteuer 2025 → 2025/2026). Auf Wunsch **zeitanteilig aufteilen** (ein Knopf an der Position). Im Rumpfzeitraum empfiehlt Mietfuchs das Aufteilen. Heizkosten immer nach dem Verbrauch im Zeitraum. | 5 |
| 5 | Steuer (Anlage V)? | Bleibt Kalenderjahr. Jede Position mit Zeitraum über zwei Kalenderjahre trägt ein **Steuerjahr**, vorbelegt aus dem Rechnungsdatum. | 7 |
| 6 | Mietkonto? | Bleibt Kalenderjahr. Die Abrechnung liest Vorauszahlungen und Rückstände über die Monate **ihres** Zeitraums. | 6 |
| 7 | Frist § 556 Abs. 3 BGB | Ablauf des zwölften Monats nach Ende des Zeitraums (30.04.2026 → 30.04.2027). Eine Funktion für Server und Oberfläche. | 2.1, 8 |
| 8 | Migration | **Keine Datenanweisung nötig**: Alle vorhandenen Schlüssel sind Kalenderjahre und bleiben gültig. Zwei erzeugte Schritte (Spalten und Tabelle, danach Bedingungen). | 9 |
| 9 | Wer nichts einstellt | rechnet auf genau demselben Weg wie heute. Golden-Tests unverändert, dazu ein Test, der das festhält. | 10 |
| 10 | CO₂ (#97) | Der Datensatz steht im Zeitraum (Schlüssel) der Abrechnung; dessen Grenzen sind die Vorgabe für `period_from`/`period_to`. Die offene Rechtsfrage 11.14 beantwortet BGH VIII ZR 240/07. | 11 |
| 11 | Nicht gebaut | getrennter Heizzeitraum neben einem anderen Zeitraum der übrigen Kosten, vereinbarte Verlängerung über zwölf Monate, Zuordnung nach Zahlungsdatum. | 12 |

---

## 1. Ziel in einfachen Worten

Mietfuchs rechnet heute jede Abrechnung vom 1. Januar bis 31. Dezember. Ein Haus mit Messdienst
rechnet oft anders, etwa vom 1. Mai bis 30. April, weil der Messdienst zu diesem Tag abliest. Die
reale Abrechnung eines kleinen Hauses (anonymisiert, siehe CO₂-Entwurf Abschnitt 3) läuft vom
01.05.2025 bis 30.04.2026, mit Heizung, Warmwasser, Kaltwasser und allen Hausnebenkosten.

Nach diesem Vorhaben kann der Vermieter am Objekt einstellen: „Der Abrechnungszeitraum beginnt im
Mai.“ Danach heißt die Abrechnung „2025/2026“, Mieter, Leerstand, Personen, Zähler und
Vorauszahlungen werden über den 01.05.2025–30.04.2026 gerechnet, die Frist läuft bis 30.04.2027.
Steuer und Mietkonto bleiben im Kalenderjahr.

**Wer nichts einstellt, merkt nichts.** Kein neues Pflichtfeld, keine andere Zahl, keine andere
Beschriftung.

---

## 2. Rechtslage mit Fundstellen

### 2.1 Länge und Frist

- **§ 556 Abs. 3 Satz 1 BGB:** „Über die Vorauszahlungen für Betriebskosten ist jährlich
  abzurechnen“. Daraus folgt nach allgemeiner Auffassung: Der Zeitraum darf zwölf Monate nicht
  überschreiten, muss aber nicht das Kalenderjahr sein.
- **§ 556 Abs. 3 Satz 2 BGB:** Die Abrechnung ist dem Mieter „spätestens bis zum Ablauf des
  zwölften Monats nach Ende des Abrechnungszeitraums mitzuteilen“. Bei Mai–April endet die Frist
  also am 30.04. des übernächsten Kalenderjahres, bei einem Rumpfzeitraum zwölf Monate nach dessen
  Ende.
- **Wahl und Wechsel:** Ist im Mietvertrag kein Zeitraum festgelegt, bestimmt ihn der Vermieter;
  ist er festgelegt, kann der Vermieter ihn nicht einseitig ändern (Berliner Mieterverein, BMGEV,
  zusammengefasst; eine Entscheidung des BGH zum einseitigen Wechsel mit Rumpfzeitraum wurde
  nicht gefunden). Mietfuchs prüft keinen Vertrag; der Hinweis beim Wechsel sagt das.
- **Verlängerung über zwölf Monate nur einvernehmlich:** BGH, Urteil vom 27.07.2011,
  VIII ZR 316/10: Eine **einmalige vertragliche** Verlängerung (dort 19 Monate) zur Umstellung auf
  das Kalenderjahr ist zulässig. Daraus folgt umgekehrt, dass eine einseitige Verlängerung es
  nicht ist. Der Rumpfzeitraum ist deshalb der Weg, der ohne Vereinbarung auskommt.

### 2.2 Heizkosten mit anderem Zeitraum als die übrigen Kosten

- **BGH, Urteil vom 30.04.2008, VIII ZR 240/07:** Eine Gesamtabrechnung ist nicht deshalb
  unwirksam, weil die Heizkosten einen anderen Zeitraum haben (dort 01.08.–31.07.) als die
  übrigen Betriebskosten (Kalenderjahr). Für den Ausschluss von Nachforderungen gilt **eine**
  Frist, die der Gesamtabrechnung. Dieselbe Entscheidung nennt die Abrechnung nach dem
  Abflussprinzip „grundsätzlich zulässig“.
- Das beantwortet die offene Rechtsfrage 11.14 des CO₂-Entwurfs: Der Heizzeitraum darf vom
  Zeitraum der übrigen Kosten abweichen. Gebaut wird das hier trotzdem nicht (Abschnitt 12).

### 2.3 Leistungs- und Abflussprinzip

- **BGH, Urteil vom 20.02.2008, VIII ZR 49/07:** Die §§ 556 ff. BGB legen den Vermieter auf
  keine bestimmte zeitliche Zuordnung fest; das Abflussprinzip ist zulässig. Der Vermieter durfte
  die im Jahr 2004 an den Wasserversorger geleisteten Zahlungen in der Abrechnung 2004 umlegen,
  „auch wenn die Zahlungen zum Teil noch für den Wasserverbrauch … des Jahres 2003 bestimmt
  waren“. **Offen gelassen** hat der BGH, ob Treu und Glauben (§ 242 BGB) das Abflussprinzip „in
  besonders gelagerten Ausnahmefällen eines Mieterwechsels“ verwehrt.
- **BGH, Urteil vom 01.02.2012, VIII ZR 156/11:** Im Anwendungsbereich der HeizkostenV ist das
  Abflussprinzip **unzulässig**; abzurechnen sind die Kosten des im Zeitraum verbrauchten
  Brennstoffs. Die Kürzung nach § 12 HeizkostenV heilt den Fehler nicht.
- **Folgerung für Mietfuchs:** Für kalte Betriebskosten sind beide Zuordnungen erlaubt, solange
  sie stetig angewendet werden. Heizung und Warmwasser müssen den Verbrauch im Zeitraum abbilden,
  was eine Messdienstabrechnung mit demselben Zeitraum von selbst tut.

### 2.4 Steuer

- **§ 11 Abs. 1 und 2 EStG:** Einnahmen im Jahr des Zuflusses, Ausgaben im Jahr des Abflusses.
  Die Anlage V ist kalenderjährlich. Das bleibt so (Issue #208, #70).

### 2.5 Was andere Programme tun (nur Ideen)

Laut Marktrecherche im Issue unterstützen immocloud, Immoware24, mibakus und NebenkostenFix
abweichende Zeiträume, objego (bei der eigenen Heizkostenabrechnung) und SmartLandlord nicht.
Immoware24 ordnet jede Buchung über ein **Abgrenzungsdatum** einem Zeitraum zu und teilt eine
Rechnung über zwei Zeiträume als **Splitbuchung** (Handbuch Abrechnung Mietverwaltung, 09/2026).
Mietfuchs übernimmt die Idee als „Position zeitanteilig aufteilen“ (5.3), ohne Buchhaltung.

---

## 3. Datenmodell

### 3.1 Rhythmus und Wechsel am Objekt, Zeiträume berechnet

| Ort | Spalte | Bedeutung |
|---|---|---|
| `properties` | `period_start_month` integer not null default 1, CHECK 1..12 | Beginnmonat **von Anfang an** |
| neue Tabelle `period_changes` | `property_id` → properties `CASCADE`, `from_month` text `JJJJ-MM`, PK beide | Ab diesem Monat beginnt jeder Zeitraum in diesem Monat |

Beispiele:

- Haus, das immer Mai–April abgerechnet hat: `period_start_month = 5`, keine Wechsel.
- Haus mit Kalenderjahr bis 2024, ab Mai 2025 Messdienst: `period_start_month = 1`, Wechsel
  `2025-05`. Ergebnis: 2024 · 01.01.–30.04.2025 (Rumpf) · 2025/2026 · 2026/2027 …

**Warum keine Tabelle mit einer Zeile je Zeitraum:** Sie müsste jedes Jahr fortgeschrieben
werden, und jede Zeile könnte eine Lücke oder Überschneidung erzeugen. Aus Rhythmus und Wechseln
berechnet, sind die Zeiträume **lückenlos, überschneidungsfrei und höchstens zwölf Monate** lang,
und zwar aus der Konstruktion und nicht aus einer Prüfung. Die Rechnung steht einmal in
`shared/period.ts` (Laufzeitanteil wie `shared/heating.ts`, denn Server und Oberfläche brauchen
sie gleich):

```ts
type PeriodRules = { startMonth: number; changes: string[] } // changes: 'JJJJ-MM', aufsteigend
type BillingPeriod = { key: PeriodKey; from: string; to: string; short: boolean }
periodOfKey(rules, key): BillingPeriod | null
periodContaining(rules, date): BillingPeriod
periodsBetween(rules, from, to): BillingPeriod[]
previousPeriod(rules, period): BillingPeriod
periodLabel(period): string          // '2025', '2025/2026', '01.01.–30.04.2025'
settlementDeadline(period): string   // letzter Tag des zwölften Monats nach `to`
```

Ein Wechsel muss am Monatsersten liegen (der Monat **ist** der neue Beginnmonat), darf nicht dem
geltenden Beginnmonat entsprechen und darf keinen abgeschlossenen Zeitraum verändern (3.4).

### 3.2 Der Zeitraumschlüssel in den bisherigen `year`-Spalten

**Problem:** Eine ganze Jahreszahl als Schlüssel geht nicht, und das ist kein Geschmack, sondern
Abzählen. Ein Wechsel Kalenderjahr → Mai erzeugt den Rumpf 01.01.–30.04.2025 **und** 2025/2026,
beide beginnen 2025; ein Wechsel Mai → Kalenderjahr erzeugt 2025/2026 und den Rumpf
01.05.–31.12.2026, beide enden 2026. Mit „Beginnjahr“ scheitert die eine Richtung, mit
„Endjahr“ die andere, und ein Hin und Zurück legt fünf Zeiträume in vier Kalenderjahre.

**Lösung:** `PeriodKey` = das Jahr, wenn der Zeitraum am 1. Januar beginnt, sonst
`JJJJ * 100 + Monat` des Beginns. Weil kein Zeitraum im selben Monat beginnt wie ein anderer, ist
der Schlüssel immer eindeutig.

| Zeitraum | Schlüssel |
|---|---|
| 01.01.–31.12.2025 | `2025` (wie heute) |
| 01.01.–30.04.2025 (Rumpf) | `2025` |
| 01.05.2025–30.04.2026 | `202505` |
| 01.05.–31.12.2026 (Rumpf) | `202605` |

**Verworfen:**

- **Eigene Entität mit Kennung** (`billing_periods.id`): Alle `year`-Spalten (Kosten, Abschlüsse,
  Verlauf, Jahreskorrektur, Belege, Auswertungen, CO₂) müssten umgeschrieben werden, jede Route
  und jede Testfixtur ebenfalls. Viel Bewegung ohne Gewinn an Aussage.
- **Text `JJJJ-MM`:** Typwechsel in sieben Tabellen samt Neubau, dazu jede abgeschlossene
  Abrechnung neu verschlüsselt.

Mit dem Zahlenschlüssel bleibt **jeder vorhandene Wert gültig**, die Spalten behalten Typ und
Namen, `/api/settlement/2025` bedeutet für ein Objekt ohne Einstellung dasselbe wie heute. Der
Preis: Die Spalte heißt `year` und enthält mitunter `202505`. Im Typsystem heißt sie `PeriodKey`
(Aliasname mit Erklärung in shared/types.ts), und **nur `shared/period.ts` zerlegt ihn**; eine
Quelltextwache wie bei `localeCompare` verbietet `key % 100` und `key / 100` anderswo.

Der Prüfausdruck auf die Spalten lässt jeden Wert unter 10000 durch, damit kein vorhandener
Bestand die Migration abbricht, und verlangt bei sechs Stellen einen Monat 2..12:
`"year" < 10000 OR ("year" BETWEEN 100002 AND 999912 AND "year" % 100 BETWEEN 2 AND 12)`.
Die Regel für die Jahreskorrektur in repository.ts („genau vierstellig“, `YEAR_KEY`) wird zu
„vier Stellen oder sechs mit Monat 02–12“; „2024.0“ bleibt abgelehnt. Der Validator der
`db.json` bleibt vierstellig, denn die `db.json` kannte keine Zeiträume.

Dass ein Schlüssel formal gültig ist, heißt nicht, dass das Objekt diesen Zeitraum hat. Das
entscheidet `periodOfKey(rules, key)`; `null` ergibt 404 „Den Zeitraum … gibt es für dieses
Objekt nicht“.

### 3.3 Rumpfzeitraum

Der letzte Zeitraum des alten Rhythmus endet am Tag vor dem Wechsel und heißt Rumpfzeitraum
(`short: true`). Er behält den Schlüssel, den er ohne Wechsel gehabt hätte. Kein eigener
Datensatz, keine Wahl: So kann es keinen Zeitraum über zwölf Monate geben (2.1).

Kein Rumpf entsteht bei Erstbezug, Mieterwechsel oder Eigentümerwechsel; dort hat nur das
Mietverhältnis weniger Tage, wie heute.

### 3.4 Wechsel und vorhandene Daten

`PUT /api/properties/:id/period` setzt Beginnmonat oder fügt einen Wechsel hinzu, **in einer
Transaktion** mit allen Folgen; `POST …/period/preview` liefert vorher, was passiert:

1. **Abgeschlossene Abrechnungen sind unantastbar.** Ändert sich der Zeitraum eines
   abgeschlossenen Schlüssels oder verschwindet er, wird abgelehnt (409 mit Liste). Wer das
   will, öffnet die Abrechnung erst wieder (#56).
2. **Verwaiste Schlüssel** (Kostenpositionen, Jahreskorrekturen, Belege im Posteingang,
   Auswertungen, CO₂-Datensätze, deren Schlüssel danach keinen Zeitraum mehr bezeichnet, etwa
   2025 bei `period_start_month` 1 → 5) werden in der Vorschau aufgeführt und in der
   Transaktion umgehängt, auf den Zeitraum mit der größten Überschneidung, änderbar je Gruppe.
   Ohne Umhängen keine Speicherung: Eine Position, die an keinem Zeitraum hängt, erschiene in
   keiner Abrechnung, und das fiele niemandem auf.
3. **Geschrumpfte Zeiträume** (der Kalenderzeitraum 2025 wird zum Rumpf Januar–April) behalten
   ihre Positionen; die Vorschau nennt sie, und die Abrechnung des Rumpfs gibt die Hinweise aus 8.

---

## 4. Berechnung

### 4.1 Der Schnappschuss trägt den Zeitraum

`Snapshot` bekommt `period: { from, to }` als Pflichtfeld neben `year` (das der Schlüssel ist und
den Namen behält). `snapshotFor(source, propertyId, key)` löst den Schlüssel über die Regeln des
Objekts auf; `snapshotOf(source, year)` (Umstieg, Regression, Tests) setzt das Kalenderjahr,
denn die `db.json` kannte nichts anderes. `previousCostItems` kommt aus `previousPeriod` und nicht
mehr aus `year - 1`.

### 4.2 Was in calc.ts den Zeitraum statt des Kalenderjahres nimmt

Alle Stellen hängen schon an drei Werten (`yFrom`, `yTo`, `diy`), die heute aus dem Jahr
entstehen. Sie kommen künftig aus `snapshot.period`:

| Stelle | heute | künftig |
|---|---|---|
| `overlapDays`, Tage je Mietverhältnis | 01.01.–31.12. | `period.from`–`period.to` |
| `diy` in Fläche, Einheiten, vereinbarten Anteilen, Direktzuordnung, Eigen- und Leerstandstagen | 365/366 | Tage des Zeitraums |
| `personDaysInPeriod`, `occupiedDays`, `consumptionInPeriod`, `coveredDays` | schon allgemein | mit den Zeitraumgrenzen |
| `computePrepaymentCents` | Monate 1..12 des Jahres | die Monate des Zeitraums; Jahreskorrektur unter dem Schlüssel |
| `ruleCoverage`, `rulesFor` (Kabel, Fernablesung) | schon mit `from`/`to` | mit den Zeitraumgrenzen |
| `cableBuiltBeforeDec2021 … && year >= 2021` | Jahr | `period.to >= '2021-12-01'` |
| Texte mit „31.12.“, „im Jahr“, „{year}“ (Hauptzähler, Überschneidung, Kabel, Vorauszahlung) | Jahreszahl | `periodLabel` und die Zeitraumgrenzen |
| `suggestedMonthlyCents` (§ 560) | `Anteil × diy / Tage / 12` | `Anteil × Tage der zwölf Monate ab Beginn / Tage / 12`; im Rumpf **nicht** die Rumpftage, sonst würden vier Monate Kosten auf zwölf Monatsbeträge verteilt |
| `prepayment.unpaid` (offene Monate aus dem Mietkonto) | `rentLedger(year)` | dieselbe Monatsrechnung über die Monate des Zeitraums (4.3) |
| `consumptionOverview` | Kalenderjahr | Zeitraum der Abrechnung (Zähler-Seite zeigt denselben Zeitraum wie die Abrechnung) |

`Settlement` bekommt `period?: { from, to, label, short }`, optional, weil vorher abgeschlossene
Abrechnungen es nicht kennen (die Oberfläche nimmt dann das Kalenderjahr aus `year`, dieselbe
Haltung wie bei `notices` vor #112). `daysInYear` bleibt für ältere Tabs und enthält die Tage des
Zeitraums; der Kommentar im Typ sagt das.

### 4.3 Monatsrechnung für Abrechnung und Mietkonto

`rentLedger` wird zerlegt in `ledgerRows(snapshot, months)` mit einer Monatsliste und die
bisherige Hülle `rentLedger(snapshot)`, die die zwölf Kalendermonate übergibt. Die Abrechnung
ruft `ledgerRows` mit den Monaten ihres Zeitraums und den Zahlungen mit Datum im Zeitraum.
`dueMonthsOf` zählt fällige Monate innerhalb der übergebenen Liste. Damit gibt es eine
Monatsregel und nicht zwei.

---

## 5. Zuordnung der Kosten

### 5.1 Die Regel

**Jede Kostenposition gehört ganz zu genau einem Zeitraum**, wie heute zu genau einem Jahr.
Zwei Fälle:

- **Rechnung für denselben Zeitraum** (Messdienst 01.05.–30.04., Gas laut Ablesung): gehört dorthin.
- **Rechnung für ein Kalenderjahr** (Grundsteuer, Versicherung, Müll, Schornsteinfeger): gehört
  in den Zeitraum mit der **größten Überschneidung** mit ihrem Leistungszeitraum. Bei Mai–April
  ist das für 2025 der Zeitraum 2025/2026 (245 gegen 120 Tage), bei November–Oktober der
  Zeitraum 2024/2025. Jeder Zeitraum bekommt so **genau eine** Jahresrechnung jeder Art.

**Warum ganz und nicht zeitanteilig als Vorgabe:** Das BGB schreibt keine zeitliche Zuordnung vor
(VIII ZR 49/07), und eine stetige Zuordnung „eine Jahresrechnung je Zeitraum“ belastet jeden
Mieter über die Jahre mit genau zwölf Monaten jeder Kostenart. Zeitanteilig hieße, jede
Jahresrechnung in zwei Positionen über zwei Abrechnungen zu zerlegen, also doppelt so viele
Eingaben, und wer die zweite Hälfte vergisst, verliert Geld. Für einen Vermieter ohne
Buchhaltungskenntnisse ist das der schlechtere Ausgang.

**Die Grenze dieser Regel steht dabei:** Beim Mieterwechsel trägt der neue Mieter Kosten von
Monaten, in denen er nicht wohnte (Grundsteuer Januar–April 2025 in 2025/2026). Ob das nach § 242
BGB im Einzelfall verwehrt ist, hat der BGH offen gelassen (2.3). Das Lexikon sagt es, und das
Formular bietet für diesen Fall das Aufteilen an (5.3).

### 5.2 Leistungszeitraum an der Position (optional)

`cost_items.service_from`, `service_to` (text, nullbar, beide oder keines, `from ≤ to`). Die
Belegauswertung liest ihn schon (`Extraction.periodStart/periodEnd`). Er dient:

- dem **Vorschlag des Zeitraums** beim Anlegen und in der Belegbuchung (größte Überschneidung),
- dem **Aufteilen** (5.3),
- den Hinweisen 8.2 und 8.3,
- dem Druck: „Leistungszeitraum 01.01.–31.12.2025“ an der Position, hilfreich bei der
  Belegeinsicht (§ 556 Abs. 4 BGB).

Ohne Angabe passiert nichts anderes als heute.

### 5.3 „Zeitanteilig aufteilen“

Knopf an einer Position mit Leistungszeitraum über zwei Zeiträume. Er ersetzt die Position in
einer Transaktion durch zwei, tagesgenau nach Überschneidung, Restcent nach `largestRemainder`
mit Kennung als Entscheid, §35a-Lohnanteil im selben Verhältnis, Beleg an beiden. Abgeschlossene
Zeiträume lehnen ab. Beschreibung erhält „(anteilig 01.01.–30.04.2025)“.

Empfohlen wird das Aufteilen **im Rumpfzeitraum** (Hinweis 8.2), denn dort verzerrt eine ganze
Jahresrechnung am stärksten: Ohne Aufteilen bekäme der Rumpf keine Grundsteuer 2025 und der
folgende Zeitraum sie ganz; wer im März 2025 auszieht, zahlte keine.

### 5.4 Heizung und Warmwasser

Müssen den Verbrauch im Zeitraum abbilden (VIII ZR 156/11). Mit Messdienst gleichen Zeitraums ist
das erfüllt. Weicht der Leistungszeitraum einer Position der Kostenart „Heizung und Warmwasser“
um mehr als einen Monat vom Zeitraum ab, warnt Mietfuchs (8.3). Die eigene Heizkostenabrechnung
(#99) und der CO₂-Teil (#97, F7) rechnen Lieferanteile ohnehin tagesgenau auf den Zeitraum um.

---

## 6. Staffeln, Vorauszahlungen, Mietkonto

- **Staffeln** (Personen, Vorauszahlung, Kaltmiete, Pauschale) gelten weiter „ab Datum/Monat“;
  sie kennen kein Jahr und bleiben unverändert.
- **Vorauszahlungen der Abrechnung:** die Monate des Zeitraums (4.2). Die **Jahreskorrektur**
  (`prepayment_overrides`) steht unter dem Schlüssel des Zeitraums; das Formular nennt
  „tatsächlich gezahlt 05/2025–04/2026“.
- **Mietkonto:** bleibt Kalenderjahr. Es ist die Grundlage der Einnahmen in der Steuer, und eine
  Monatsliste je Zeitraum gäbe dieselben Monate unter zwei Überschriften. Die Seite nennt bei
  abweichendem Zeitraum oben: „Die Abrechnung 2025/2026 umfasst Mai 2025 bis April 2026.“

---

## 7. Steuer (Anlage V)

Bleibt Kalenderjahr, `/api/taxreport/:year` nimmt weiter ein **Kalenderjahr**.

- **Einnahmen:** unverändert aus Zahlungen und Mietkonto.
- **Werbungskosten:** `cost_items.tax_year` (integer, nullbar). Liegt der Zeitraum in einem
  Kalenderjahr, ist das Steuerjahr dieses Jahr und die Spalte bleibt `null` (also bei jedem
  heutigen Bestand). Reicht er über zwei Kalenderjahre, ist sie **Pflicht** (repository.ts, 400
  mit Satz). Vorbelegt mit dem Jahr des Rechnungsdatums, wenn ein Beleg eines im Zeitraum trägt,
  sonst mit dem Kalenderjahr, in dem der größere Teil des Zeitraums liegt. Das Formular zeigt das
  Feld nur in diesem Fall: „In welchem Jahr haben Sie die Rechnung bezahlt? (Steuer)“.
  Damit kommt die Steuer dem Abflussprinzip (§ 11 Abs. 2 EStG) näher als heute; die Seite
  behauptet das aber nur für diese Positionen.
- **Eigenanteil je Position** (`splitForTax`, #163): aus der Abrechnung des Zeitraums der
  Position, abgeschlossen deren eingefrorener Stand. Eine Steuerübersicht 2025 kann so aus zwei
  Abrechnungen schöpfen (2024/2025 und 2025/2026). Die Übersicht nennt sie: „Eigenanteile aus den
  Abrechnungen 2024/2025 und 2025/2026“.
- **`prepaymentSettlementCents`** (#70) vergleicht Soll und Abrechnung **desselben Jahres**. Das
  gibt es bei abweichendem Zeitraum nicht. Das Feld wird `number | null`; `null` heißt „kein
  Zeitraum deckt sich mit dem Kalenderjahr“, und taxView.ts zeigt dann statt des Vergleichs
  einen Satz. Eine Zahl aus zwei halben Abrechnungen wäre eine erfundene.
- `/api/receipts/tax/:year` sammelt die Belege nach Steuerjahr.

---

## 8. Abgeschlossene Abrechnungen, Fristen, Hinweise

### 8.1 Abschluss und Frist

- `closed_settlements` und `closed_settlement_history` bleiben eindeutig je (Objekt, Schlüssel).
- Der eingefrorene Stand trägt `period`. Damit bleibt eine versandte Abrechnung wortgleich, auch
  wenn später ein Wechsel hinzukommt (3.4 lehnt jede Änderung ihres Zeitraums ohnehin ab).
- **Frist:** `settlementDeadline(period)` ersetzt die drei festen `${year + 1}-12-31`
  (settlementDiff.ts, settlementHistory.ts, Cockpit.tsx). Ein Test hält das Ergebnis für
  Kalenderjahre unverändert fest.

### 8.2 Neue Hinweise (`noticeKinds`, je mit Begriff im Lexikon)

| Code | Stufe | Wann | Begriff |
|---|---|---|---|
| `period.short` | `hint` | Abrechnung eines Rumpfzeitraums | `shortPeriod` |
| `period.annual-bill-in-short` | `warning` | Rumpf, Position mit Leistungszeitraum, der um mehr als einen Monat über den Rumpf hinausreicht. **Beziffert**: Betrag × (1 − Überschneidung / Leistungstage). | `accrualPrinciple` |
| `period.heating-mismatch` | `warning` | Heizposition, Leistungszeitraum weicht um mehr als einen Monat ab (VIII ZR 156/11) | `accrualPrinciple`, `heatingCosts` |
| `period.item-outside` | `warning` | Leistungszeitraum ohne jede Überschneidung mit dem Zeitraum | `billingPeriod` |

`period.short` färbt die Cockpit-Ampel nicht (`INFORMATIONAL`). Der Text sagt: „Rumpfzeitraum
wegen der Umstellung auf Mai–April. Prüfen Sie, ob Ihr Mietvertrag den Zeitraum festlegt; dann
braucht die Umstellung die Zustimmung der Mieter. Jahresrechnungen gehören hier nur anteilig
hinein.“

### 8.3 Lexikon

Neue Begriffe `billingPeriod` (Abrechnungszeitraum), `shortPeriod` (Rumpfzeitraum),
`accrualPrinciple` (Leistungs- und Abflussprinzip), jeweils mit Beispiel in Zahlen und den
Fundstellen aus 2. Beispiele werden nachgerechnet (glossary.test.ts).

---

## 9. Migration, Umstieg, Backup

- Nächste freie Nummer nach der CO₂-Migration (heute `0014_co2` auf dem CO₂-Zweig), erzeugt mit
  `npm --prefix server run db:generate`, **zwei Schritte** nach der Regel aus
  server/drizzle/README.md (neue Spalten und geänderte Bedingungen nie in einem Schritt):
  1. `properties.period_start_month` (default 1), Tabelle `period_changes`,
     `cost_items.tax_year`, `service_from`, `service_to`.
  2. Bedingungen: Beginnmonat 1..12, `from_month` als `JJJJ-MM`, Leistungszeitraum paarweise,
     Steuerjahr 1900..2200, Schlüsselform auf allen `year`-Spalten (3.2). drizzle-kit baut dafür
     die Tabellen neu.
- **Keine Datenanweisung.** Der Vorgabewert 1 ist das Kalenderjahr, jeder vorhandene Schlüssel
  ist ein Kalenderjahr und bleibt gültig. Das ist der Hauptgrund für den Zahlenschlüssel (3.2).
- `backupBeforeMigrating` sichert wie bei jedem Schritt.
- **Eingefrorener Eingang** (`server/src/legacy/`) bleibt unberührt: Die `db.json` kannte nur
  Kalenderjahre, der Umstieg schreibt auf 0000 und die Kette trägt den Rest.
- **Backup/Wiederherstellen:** Die neue Tabelle liegt in der Datei; nichts zu tun. Der Praxislauf bekommt einen Fall 15 „Backup mit abweichendem Zeitraum und
  Rumpf“ nach dem Muster von Fall 9 (Backup nur mit Datenbank), damit Rumpf und Schlüssel
  `202505` den Weg durch `VACUUM INTO` und die Migrationskette nachweislich überstehen, dazu
  ein Fall „Datenbank der Vorversion, Update auf Zeiträume“ nach dem Muster von Fall 11.
- **Wiederherstellen prüft** wie `crossPropertyViolations`: Schlüssel, die für ihr Objekt keinen
  Zeitraum bezeichnen (`orphanPeriodKeys`), lehnen ab, mit Liste.

---

## 10. Oberfläche

- **Objekt-Stammdaten:** „Abrechnungszeitraum beginnt im: Januar ▾“ mit dem Satz „Januar heißt
  Kalenderjahr. Wählen Sie den Monat, mit dem Ihr Messdienst abrechnet.“ Ohne Daten wirkt die
  Wahl von Anfang an. Mit Daten öffnet sie den Dialog **„Zeitraum wechseln“**: ab welchem
  Zeitraum, Vorschau der Liste („2024 · 01.01.–30.04.2025 (Rumpfzeitraum) · 2025/2026“), was
  umgehängt wird (3.4), Hinweis auf Mietvertrag und Information der Mieter.
- **Jahresumschalter wird Zeitraumumschalter.** `YearProvider` führt `periodKey` und
  `calendarYear`. Die Liste kommt aus `GET /api/periods?property=` (Schlüssel, Grenzen, Label,
  Rumpf, abgeschlossen, Frist), von der ältesten Angabe bis zum Zeitraum nach dem laufenden.
  **Ohne Abweichung** sind beide Werte gleich und es gibt einen Umschalter wie heute.
  Mit Abweichung zeigen Mietkonto und Steuer einen eigenen Kalenderjahr-Umschalter, die übrigen
  Seiten den Zeitraum. Beim Wechsel des Objekts wird der Zeitraum auf den zum gleichen Tag
  passenden des neuen Objekts gesetzt.
- **Bezeichnung:** `periodLabel`: „2025“, „2025/2026“, Rumpf „01.01.–30.04.2025“. Abrechnung
  (Kopf und Druck), Cockpit, Fristen, Belegordner und Kosten nutzen nur diese Funktion.
  `PageHeader` zeigt „Abrechnungszeitraum 01.05.2025–30.04.2026“ unter dem Titel, nur bei
  Abweichung.
- **Kosten:** Steuerjahr nur bei Zeitraum über zwei Kalenderjahre; Leistungszeitraum unter
  „Weitere Angaben“; „Zeitanteilig aufteilen“ an der Position (5.3).
- **Aus dem Vorzeitraum übernehmen** (carryOver.ts): nimmt `previousPeriod`. War der
  Vorzeitraum ein Rumpf oder ist der Zielzeitraum einer, steht über der Liste „Der Vorzeitraum
  war 4 Monate lang: Beträge prüfen.“ Hochgerechnet wird nicht, die Übernahme ist ohnehin eine
  Vorlage zum Prüfen.
- **Belegbuchung und Belegordner:** `detectedYear` wird `detectedPeriod` (Zeitraum mit der
  größten Überschneidung mit dem Leistungszeitraum, sonst der Zeitraum des Rechnungsdatums), in
  denselben Spalten. Die Ampel vergleicht Schlüssel. Ordner je Objekt und Zeitraum.
- **Cockpit:** „Abrechnung 2025/2026 bis 30.04.2027“. Die Ablesungsampel fragt nach Ständen zu
  den Zeitraumgrenzen statt zum 31.12. (unitForm.ts, meterCheck.ts).

---

## 11. Schnittstelle zum CO₂-Teil (#97)

Der CO₂-Entwurf (Abschnitt 12) führt je Datensatz den tatsächlichen Zeitraum und ordnet ihn bis
dahin dem Jahr zu, in dem er endet. Mit #208:

- `co2_statements.year` enthält den **Zeitraumschlüssel** der Abrechnung, zu der der Datensatz
  gehört. Für Kalenderjahre ist das dieselbe Zahl, eine Datenmigration ist nicht nötig.
- Die Vorgabe für `period_from`/`period_to` sind die Grenzen dieses Zeitraums statt 01.01.–31.12.
- `co2.period-not-calendar` entfällt, wenn der Datensatz den Zeitraum der Abrechnung hat; weicht
  er ab, bleibt der Hinweis (§ 5 Abs. 1 S. 5 CO2KostAufG: umrechnen) mit neuem Text.
- **Rumpfzeitraum = „unter einem Jahr vereinbart“** (§ 5 Abs. 1 S. 4): Die Kürzung der Tabelle
  aus Fall F11 greift von selbst, weil der Datensatz die Grenzen des Rumpfs übernimmt.
- Rechtsfrage 11.14 ist mit BGH VIII ZR 240/07 beantwortet (2.2). Der CO₂-Entwurf verweist auf
  diesen Abschnitt.
- Reihenfolge: #208 kann vor oder nach dem CO₂-Teil gemergt werden. Kommt er danach, zieht
  PR 6 die Vorbelegung um; kommt er davor, baut der CO₂-Teil gleich auf `periodOfKey`.

---

## 12. Nicht-Ziele, mit Grund

- **Getrennter Heizzeitraum neben einem anderen Zeitraum der übrigen Kosten** (zulässig nach
  VIII ZR 240/07). Ein Mieter, der im Oktober 2024 auszieht, hätte Heizkosten im Zeitraum
  08/2024–07/2025, aber keinen Tag in der Abrechnung 2025; er bräuchte eine Abrechnung, die nur
  aus Heizung besteht. Bei kleinen Häusern liefert der Messdienst meist ohnehin alles im selben
  Zeitraum (wie der reale Fall), und der Ausweg „ganzes Haus im Heizzeitraum abrechnen“ steht
  mit diesem Vorhaben offen. **Vorschlag für ein Issue:** „Heizkosten mit eigenem Zeitraum in
  einer Gesamtabrechnung (BGH VIII ZR 240/07)“.
- **Vereinbarte Verlängerung über zwölf Monate** (VIII ZR 316/10): braucht die Zustimmung aller
  Mieter; der Rumpf leistet dasselbe ohne sie.
- **Zuordnung nach Zahlungsdatum** (reines Abflussprinzip): Positionen tragen kein
  Zahlungsdatum. Sinnvoll erst mit dem Kontoauszug (#188).
- **Mietkonto je Zeitraum:** siehe 6.

---

## 13. Tests

### 13.1 Unverändert

- **Golden-Tests** (`settlement-golden.test.ts`, `db-golden.test.ts`) ohne jede Änderung an
  Fixtures und Erwartungen.
- **Gleichheit:** Für jedes Golden-Fixture ergibt `snapshotFor` mit Regeln `{ startMonth: 1,
  changes: [] }` dieselbe Abrechnung, dasselbe Mietkonto, dieselbe Steuer und denselben
  Verbrauch wie `snapshotOf(…, year)`, verglichen über das ganze Ergebnis (nicht nur Salden).

### 13.2 Invarianten über zufällige Bestände (fester Startwert, wie calc.test.ts)

1. **Zerlegung der Zeit:** Für zufällige Regeln (Beginnmonat, 0–3 Wechsel) liefert
   `periodsBetween` lückenlos und überschneidungsfrei aufeinanderfolgende Zeiträume, jeder
   höchstens zwölf Monate, Rumpf genau vor jedem Wechsel, Schlüssel eindeutig,
   `periodOfKey(key(p)) = p`, `periodContaining(d)` enthält `d`.
2. **Geld bleibt erhalten** in abweichenden Zeiträumen und Rumpfzeiträumen: Mieteranteile +
   Vermieteranteil = Gesamtkosten, keine negativen Anteile, Eigenanteil ≤ Vermieteranteil (die
   bestehenden drei Invarianten, mit zufälligem Zeitraum).
3. **Verschiebung um 120 Tage:** Ein Bestand des Kalenderjahres 2025, dessen Daten (Einzug,
   Auszug, Personenstufen, Ablesungen) um 120 Tage verschoben werden, ergibt im Zeitraum
   01.05.2025–30.04.2026 (beide 365 Tage) für Fläche, Einheiten, Personen, Verbrauch,
   Direktzuordnung und vereinbarte Anteile **centgleiche** Anteile. Das ist der stärkste Test,
   dass keine Stelle das Kalenderjahr behalten hat.
4. **Vorauszahlungen:** Ohne Jahreskorrektur ist die Summe der Vorauszahlungen aller Zeiträume
   einer Spanne gleich der Summe `prepaymentYearCents` des Mietkontos über dieselben Monate.
5. **Steuer erhält jede Position:** Über alle Kalenderjahre summiert, steht jede Position genau
   einmal in den Werbungskosten.
6. **Wechsel schont Abgeschlossenes:** Kein angenommener Wechsel ändert den Zeitraum eines
   abgeschlossenen Schlüssels; jeder Schlüssel im Bestand bezeichnet danach einen Zeitraum.

### 13.3 Einzelfälle

- Frist: 2025 → 31.12.2026; 2025/2026 → 30.04.2027; Rumpf 01.01.–30.04.2025 → 30.04.2026;
  Zeitraum 01.03.2023–29.02.2024 → 28.02.2025.
- Schaltjahr: 01.05.2027–30.04.2028 hat 366 Tage.
- Rumpf: § 560-Vorschlag annualisiert über zwölf Monate, nicht über die Rumpftage.
- `period.annual-bill-in-short` mit Betrag; Aufteilen ergibt zwei Positionen, Summe gleich,
  Lohnanteil gleich.
- Jahreskorrektur unter `202505` angenommen, `2024.0` und `202513` abgelehnt (Route und CHECK).
- Kabelregel in 2023/2024 und 2024/2025 (`partial`), Text mit Datum statt „2024“.
- API: `/api/settlement/2025` für ein Objekt mit Beginnmonat 5 → 404 mit Satz; `/202505` → 200.
- Migrationskette auf einer Datenbank der letzten Version (Muster aus #92).
- Client: Umschalter ohne Abweichung unverändert (vitest), Label, carryOver-Hinweis,
  taxView mit `prepaymentSettlementCents: null`.
- Quelltextwache: `% 100` und `/ 100` auf Schlüsseln nur in shared/period.ts; kein
  `-12-31`/`-01-01` mehr in calc.ts, settlementDiff.ts, settlementHistory.ts, Cockpit.tsx.

### 13.4 Prüffall aus der Praxis

Ein Fixture **F12 Mai–April** nach der realen Abrechnung (anonymisiert, vier Einheiten, rund
200 m², Messdienst-Einzelbeträge für Heizung und Warmwasser, Hausnebenkosten nach Fläche,
Grundsteuer 2025 ganz in 2025/2026), Erwartung von Hand hergeleitet mit README, wie es der
Prüfkatalog verlangt.

---

## 14. PRs und Aufwand

Gestapelt, jeder einzeln grün und auslieferbar, Integrationsdurchsicht und Praxislauf vor dem
Merge (CLAUDE.md).

| PR | Inhalt | Aufwand |
|---|---|---|
| 1 | `shared/period.ts` (Regeln, Schlüssel, Label, Frist) mit Invariante 13.2.1 und Fristfällen; Frist an den drei Stellen umgestellt. Keine sichtbare Änderung. | 1 Tag |
| 2 | Engine: `Snapshot.period`, alle Stellen aus 4.2, `ledgerRows`, Texte. Golden unverändert, Gleichheitstest, Invarianten 2–4, Verschiebungstest. | 2–3 Tage |
| 3 | Schema (zwei Schritte), repository (Regeln, Wechsel mit Vorschau und Umhängen, Steuerjahr, Schlüsselprüfung), Routen (`/api/periods`, 404), Steuer über mehrere Zeiträume, Wiederherstellen prüft Schlüssel. Invarianten 5–6. | 3 Tage |
| 4 | Oberfläche: Provider, Umschalter, Stammdaten mit Dialog, Abrechnung, Cockpit, Kosten (Steuerjahr), Mietkonto/Steuer mit Kalenderjahr, carryOver. | 3 Tage |
| 5 | Leistungszeitraum an der Position, Aufteilen, Hinweise 8.2, Lexikon, Belegbuchung/Belegordner mit Zeitraum, Fixture F12. | 2–3 Tage |
| 6 | CO₂-Schnittstelle (11), MIGRATION.md/Anleitung, CHANGELOG, CLAUDE.md-Abschnitt „Abrechnungszeitraum“. | 1 Tag |

Zusammen rund **12–14 Arbeitstage**. Die Reihenfolge erlaubt, nach PR 4 auszuliefern: Wer
Mai–April abrechnet, kann dann schon arbeiten; PR 5 macht die Zuordnung bequem und warnt.

---

## 15. Quellen

- § 556 BGB; § 11 EStG; HeizkostenV; CO2KostAufG § 5.
- BGH, Urteil vom 20.02.2008, VIII ZR 49/07 (Abflussprinzip zulässig), zitiert nach
  [Berliner Mieterverein](https://www.berliner-mieterverein.de/recht/mieturteile/bgh/bgh0810.htm).
- BGH, Urteil vom 30.04.2008, VIII ZR 240/07 (abweichender Heizzeitraum, eine Frist), nach
  [rewis.io](https://rewis.io/urteile/urteil/x4d-29-04-2008-viii-zr-24007/).
- BGH, Urteil vom 27.07.2011, VIII ZR 316/10 (einmalige vereinbarte Verlängerung), nach
  [urteile-gesetze.de](https://urteile-gesetze.de/rechtsprechung/viii-zr-316-10).
- BGH, Urteil vom 01.02.2012, VIII ZR 156/11 (Heizkosten nicht nach Abfluss), nach
  [rewis.io](https://rewis.io/urteile/urteil/s1c-01-02-2012-viii-zr-15611/).
- [BMGEV: Abrechnungszeitraum](https://bmgev.de/mietrecht/tipps/abrechnungszeitraum-betriebskosten).
- Immoware24, Handbuch Abrechnung Mietverwaltung 09/2026 (Abgrenzungsdatum, Splitbuchung).
- Gelesen am 04. und 05.10.2026. rules.ts bekommt durch dieses Vorhaben keine neue Regel,
  `RULES_AS_OF` bleibt deshalb unberührt.
