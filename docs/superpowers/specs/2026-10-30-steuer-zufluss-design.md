# Zufluss nach Zeilen der Anlage V (#312)

Teil des Releases „Quellrechnung und Steuerjahr“ (0.14.0), zusammen mit #455, #478, #281, #262 und #96. Baut auf
#280 (Art der Zahlung, in `main`) auf. **Mietkonto und Steuer tilgen mit einer Funktion**: PR 1 legt sie an, #281
(Entwurf `2026-10-30-mietkonto-uebertrag-design.md`) stellt das Mietkonto darauf um, erst danach liest die Steuer die
Teile (PR 2). Reihenfolge und Migrationen: `2026-10-30-release-0.14-plan.md`. Rechtsaussagen tragen ihre Quelle; was
nicht amtlich belegt ist, steht als **Auslegung** da.

**Stand nach der Durchsicht** (`2026-10-30-crossreview.md`): eingearbeitet sind X2, X4, X5, X9, X10, X11 und aus
Abschnitt 2 die Punkte 1 bis 7 sowie die weiteren Befunde (E8, Rücklastschrift, Zeile 25, E9, Oberfläche). Punkt 4
bis 7 (Mietkonto, `prepayment.arrears`, Abrechnungsreife, Entwurf der Zahlungsart) liegen bei #281.

## Leitsatz

Die Steuerübersicht trennt heute das **Soll** in Kaltmiete, Vorauszahlungen und Pauschale, das maßgebliche
**Ist** (`income.paidCents`) aber nur in „Abrechnung“ und „alles andere“. Wer die Anlage V ausfüllt, braucht das
Ist in den Zeilen des Vordrucks: Mieten ohne Umlagen, laufend vereinnahmte Umlagen, Nachzahlungen und
Erstattungen aus der Abrechnung, Mieten für frühere Jahre. Dieser Entwurf teilt das Zugeflossene **jeder
Zahlung** nach der gesetzlichen Tilgungsreihenfolge auf die Bestandteile der Miete auf und ordnet die Teile den
Zeilen zu.

**Die Summe bleibt, wie sie ist.** `paidCents` zählt weiter jede Zahlung mit Datum im Jahr (§ 11 Abs. 1 Satz 1
EStG, #70). Neu ist nur, wie sich diese Summe auf die Zeilen verteilt. Die Teile ergeben zusammen genau
`paidCents`, bis auf die Zehn-Tage-Regel (E8: Ende Dezember gezahlte Januarmiete zählt im Folgejahr; Invariante). Kein Überschuss, keine Werbungskosten, kein Soll ändert sich, und die Prüfsummen in
`tax-golden.json` bleiben centgenau (siehe „Prüfsummen“).

**Wer ein Haus mit pünktlich zahlenden Mietern hat, sieht nur bessere Zeilen**: Bei vollständig gezahlter
Monatsmiete ergibt die Aufteilung genau das Soll der Monate des Jahres, also die Zahlen, die er heute unter
„(vereinbart)“ abschreibt. Eine neue Eingabe gibt es nicht.

## Rechtslage

- **Zufluss.** Einnahmen sind in dem Kalenderjahr bezogen, in dem sie zugeflossen sind (§ 11 Abs. 1 Satz 1
  EStG). Mietnach- und -vorauszahlungen zählen im Jahr des Zuflusses (§ 11 Abs. 1 EStG; Haufe, Anlage V 2024,
  Abschn. 24.2.7).
- **Zehn-Tage-Regel.** Regelmäßig wiederkehrende Einnahmen, die kurze Zeit vor Beginn oder nach Beendigung des
  Kalenderjahres zufließen, zu dem sie wirtschaftlich gehören, gelten als in diesem Jahr bezogen (§ 11 Abs. 1
  Satz 2 EStG, gelesen am 31.10.2026 auf gesetze-im-internet.de). Die Vorschrift ist zwingend, kein Wahlrecht. „Kurze
  Zeit“ sind bis zu zehn Tage (BFH, Urteil vom 24.07.1986, IV R 309/84, BStBl 1987 II S. 16). H 11 EStH („Kurze
  Zeit“, gelesen in der Wiedergabe der EStH 2020 bei Haufe): „Innerhalb dieses Zeitraums müssen die Zahlungen fällig
  und geleistet worden sein“; tragend BFH, Urteil vom 16.02.2022, X R 2/21, BStBl 2022 II S. 448 („nicht nur gezahlt,
  sondern auch fällig geworden“). BFH, Urteil vom 27.06.2018, X R 44/16, lässt die Fälligkeit offen (Rn. 12) und ist
  dafür kein Beleg; er und BFH, Urteil vom 11.11.2014, VIII R 34/12, BStBl 2015 II S. 285, sagen, dass ein Wochenende
  die zehn Tage nicht verlängert (§ 108 Abs. 3 AO gilt nicht). Die Miete ist eine regelmäßig wiederkehrende Einnahme.
- **Fälligkeit der Miete.** Zu Beginn, spätestens bis zum dritten Werktag des Monats (§ 556b Abs. 1 BGB,
  Samstag kein Werktag: BGH VIII ZR 129/09; in Mietfuchs `rentDueDate`, #290). Für Mietverhältnisse, die am
  01.09.2001 bestanden, gilt weiter § 551 BGB a. F. (Art. 229 § 3 Abs. 1 Nr. 7 EGBGB): Miete **am Ende** des
  Zeitabschnitts, soweit nicht anders vereinbart. § 556b ist abdingbar. Die Fälligkeit hängt also am Vertrag,
  den Mietfuchs nicht kennt.
- **Tilgungsreihenfolge.** Bestimmt der Mieter bei der Zahlung, welche Schuld getilgt wird, gilt das (§ 366
  Abs. 1 BGB). Sonst: zuerst die fällige Schuld, unter mehreren fälligen die mit geringerer Sicherheit, dann die
  lästigere, dann die ältere, bei gleichem Alter verhältnismäßig (§ 366 Abs. 2 BGB). Für die Bestandteile der
  Bruttomiete hat der BGH § 366 Abs. 2 BGB herangezogen: Reicht eine Zahlung nicht, wird sie zuerst auf die
  Betriebskostenvorauszahlungen angerechnet, weil diese die geringere Sicherheit bieten, dann auf die
  Nettomiete (BGH, Urteil vom 21.03.2018, VIII ZR 68/17, BGHZ 218, 139, Leitentscheidung; Parallelentscheidung
  vom selben Tag VIII ZR 84/17). Fundstellen im Volltext von **VIII ZR 84/17**, im Code so zu zitieren:
  - **Rn. 53**: § 366 Abs. 2 BGB analog; maßgeblich ist die „geringere Sicherheit“, nicht die anteilige
    Verrechnung; die Vorauszahlung ist die unsicherere Forderung, weil sie „nach Eintritt der Abrechnungsreife oder
    erfolgter Abrechnung grundsätzlich nicht mehr geltend gemacht werden kann“.
  - **Rn. 54**: Anrechnung stets auf die ältesten Rückstände.
  - **Rn. 56**: Ist eine Zahlung einem Zeitraum zugeordnet, geht sie zuerst auf dessen Vorauszahlung, dann auf
    dessen Nettomiete; ein Überschuss auf die ältesten Vorauszahlungen, dann die ältesten Nettomieten.
  - **Rn. 57**: Nicht zugeordnete Zahlungen gehen in absteigendem Alter zuerst auf alle Vorauszahlungen, dann auf
    die Nettomieten, je mit der ältesten beginnend.
  Gelesen über gesetze.co (Volltext mit Randnummern), am 30.10.2026.
- **Kaution.** Sie ist bei Zahlung keine Einnahme (Treuhand, § 551 Abs. 3 BGB); Einnahme wird sie erst, wenn
  der Vermieter sie mit Forderungen verrechnet. Dann gehört sie in Zeile 25 („verrechnete Mietkautionen“, Vordruck
  2024 und 2025; Haufe a. a. O.).
- **Verbilligte Vermietung.** Die Einnahmen stehen in voller Höhe in den Zeilen der Einnahmen; gekürzt werden
  nur die Werbungskosten, ausschließlich in den Zeilen 87 und 88 (Vordruck 2025, Hinweis vor Zeile 33).

## Der Vordruck je Jahr

Selbst gelesen (Text aus dem PDF gezogen), Seite 1 und 2:

| Zeile | Kz | Inhalt (Vordruck 2025, wörtlich gekürzt) | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|
| 13, 14 | – | Mieteinnahmen für Wohnungen (ohne Umlagen / ohne Umsatzsteuer), je Wohneinheit mit Wohnfläche | ✓ | ✓ | ✓ |
| 15 | 01 | Summe Wohnungen | ✓ | ✓ | ✓ |
| 16–18 | 02 | Einnahmen für andere Räume (ohne Umlagen), Summe in 18 | ✓ | ✓ | ✓ |
| 19 | 03 | an Angehörige vermietete Wohnungen (ohne Umlagen) | ✓ | ✓ | ✓ |
| 20 | 04 | auf die Zeilen 15 und 18 entfallende laufende Neben-/Betriebskosten | ✓ | ✓ | ✓ |
| 21 | 11 | auf die Zeilen 15 und 18 entfallende, im Jahr erhaltene Nachzahlungen / geleistete Erstattungen (negativ mit Minus) | ✓ | ✓ | ✓ |
| 22 | 05 | auf Zeile 19 entfallende laufende Neben-/Betriebskosten | ✓ | ✓ | ✓ |
| 23 | 12 | auf Zeile 19 entfallende Nachzahlungen / Erstattungen | ✓ | ✓ | ✓ |
| 24 | 13 | Neben-/Betriebskosten wurden nicht gesondert vereinbart (1 = Ja) | ✓ | ✓ | ✓ |
| 25 | 06 | Vereinnahmte Mieten für frühere Jahre / verrechnete Mietkautionen / auf das Kalenderjahr entfallende Mietvorauszahlungen aus Baukostenzuschüssen | ? | ✓ | ✓ |
| 26 | 07 | Einnahmen aus Vermietung von Garagen, Werbeflächen, Grund und Boden für Kioske usw. | ? | ✓ | ✓ |
| 32 | – | Summe der Einnahmen aus den Zeilen 15, 18 bis 28 und 31 | ? | ✓ | ✓ |

Quellen:
- 2025: Finanzverwaltung NRW, Vordruck „2025AnlV101 – September 2025 –“,
  https://www.finanzamt.nrw.de/dokumente/anlage-v-einkuenfte-aus-vermietungverpachtung-bebauter-grundstuecke-2025,
  Seite 1 und 2 (die Adresse liefert das PDF unmittelbar).
- 2024: „2024AnlV101NET“, Kopie bei steuern.de,
  https://www.steuern.de/fileadmin/user_upload/Steuerformulare_2024/Anlage_V_steuern.de_01.pdf; Zeilen 13–24 und 25/26
  gelesen. Für die Fundstelle in taxView.ts bleibt die amtliche Adresse aus dem Formular-Management-System
  (`invoke.do?id=034032_24`), die Zeilen 25/26 sind dort in Schritt 3 gegenzulesen.
- 2023: Zeilen 13–24 belegt (Fundstelle schon in taxView.ts, `invoke.do?id=034032_23`). **Seite 2 (Zeile 25) ist
  noch nicht gelesen**; bis dahin nennt die Seite für 2023 bei Zeile 25 keine Nummer.
- 2026: Die Vordrucke zur Einkommensteuererklärung 2026 sind mit BMF-Schreiben vom 13.08.2026 bekannt gegeben;
  die Anlage V 2026 ist **nicht gelesen**. Keine Nummer, bis jemand sie im Vordruck nachsieht. Ein Eintrag 2026 in
  der Tabelle der Zeilen ist ein eigener kleiner PR mit Fundstelle (wie #110).

Zeilen 13/14 fragen **je Wohneinheit** mit Wohnfläche. Die Übersicht liefert deshalb neben den Summen eine
Aufstellung je Einheit (siehe Oberfläche).

## Entscheidungen

### E1: Grundlage bleibt jede Zahlung nach Datum

`paidCents` bleibt die Summe aller Zahlungen mit Datum im Kalenderjahr, wie seit #70. Die Aufteilung zerlegt
**jede einzelne Zahlung** in Teile; jedem Teil gehört das Jahr ihres Datums. Damit gilt für jedes Jahr
Σ Teile = `paidCents`, und es gibt keine zweite Abgrenzung des Zuflusses. Der Grund aus #70 gilt weiter: Die
Dezembermiete nach Auszug, im Januar eingegangen, und der Dauerauftrag, der vor Beginn des Mietverhältnisses
bucht, fielen bei einer Zeilenbindung aus beiden Jahren.

### E2: Tilgungsreihenfolge nach § 366 BGB und BGH VIII ZR 68/17

Jedes Mietverhältnis hat ein **fortlaufendes Konto ab Beginn**, nicht je Kalenderjahr (Übertrag, #281). Die
Forderungen sind die Bestandteile des Monats-Solls, wie es `ledgerRows` heute rechnet (`rateInMonth`, im
angebrochenen Monat nach Tagen, #311):

- Klasse **A, geringere Sicherheit**: Vorauszahlung und Heizvorauszahlung.
- Klasse **B**: Kaltmiete und Pauschale.

**Warum die Pauschale zu B gehört (Auslegung).** Die Vorauszahlung ist weniger sicher, weil sie nach
Abrechnungsreife nicht mehr verlangt werden kann, nur noch der Saldo der Abrechnung; das ist der Grund des BGH.
Die Pauschale wird nie abgerechnet und ist wie die Kaltmiete fester Teil der Miete. Gleiche Sicherheit, gleiche
Lästigkeit, gleiches Alter: innerhalb eines Monats verhältnismäßig (§ 366 Abs. 2 letzter Halbsatz), über
`largestRemainder` mit festen Schlüsseln (`compareText`). Ebenso Vorauszahlung und Heizvorauszahlung innerhalb A.

**Ablauf je Mietverhältnis**, Zahlungen der Art `rent` nach Datum, bei gleichem Datum nach Kennung
(`compareText`; keine Locale, #70):

1. **Bestimmung des Mieters** (§ 366 Abs. 1; VIII ZR 84/17 Rn. 56): Trägt die Zahlung einen Monat
   (`designatedMonth`, gespeichert mit #281, das vor PR 2 dieses Entwurfs landet), geht sie zuerst auf die offenen
   Teile dieses Monats (A vor B), der Rest weiter nach 2. PR 1 nimmt das Feld schon als optionale Angabe der
   Eingabe (`AllocationPayment`, siehe E3), damit die Funktion vor der Spalte vollständig getestet ist.
2. **Fällige Monate**: Ein Monat ist bei einer Zahlung am Tag d fällig, wenn d ≥ der Erste des Monats
   (Auslegung: § 556b Abs. 1 nennt den Beginn als Leistungszeit, der dritte Werktag ist die Grenze der
   Pünktlichkeit; so hängt die Tilgung weder am Bundesland noch an Feiertagen). Zuerst **alle offenen
   A-Teile** der fälligen Monate, ältester zuerst, dann **alle offenen B-Teile**, ältester zuerst
   (§ 366 Abs. 2: Sicherheit vor Alter; VIII ZR 84/17 Rn. 57).
3. **Noch nicht fällige Monate**: der Rest geht Monat für Monat in die Zukunft, je Monat A vor B. Eine Reihung
   „alle künftigen A vor allen künftigen B“ hätte keinen Halt im Gesetz (Abs. 2 ordnet nur fällige Schulden
   untereinander) und ergäbe absurde Zeilen; die Vorauszahlung des Mieters gilt dem nächsten Monat.
   Bis zum Ende des Mietverhältnisses, bei offenem Ende höchstens 120 Monate nach der Zahlung.
4. **Was übrig bleibt**, ist nicht zuordenbar (Überzahlung ohne Forderung, etwa nach Auszug oder bei einer
   Staffel, die bei 0 endet): Teil `unallocated`.
5. **Negative Zahlung** (Rücklastschrift, Rückzahlung einer Überzahlung): Sie nimmt die zuletzt vorgenommenen
   Zuordnungen zurück (Stapel, zuletzt zuerst; die Überzahlung liegt oben). Die zurückgenommenen Teile behalten
   ihren Bestandteil und ihren Monat und stehen mit negativem Betrag **im Jahr der negativen Zahlung**. Bleibt
   nichts zum Zurücknehmen, ist es ein negativer Teil `unallocated`. Was die Rücknahme wieder öffnet, decken
   spätere Zahlungen nach 2.
   **Auslegung (LIFO).** Rechtlich wäre die Zuordnung genau der zurückgebuchten Zahlung zurückzunehmen. Mietfuchs
   kennt den Bezug einer Rücklastschrift auf ihre Zahlung nicht (keine Spalte, und der Kontoauszug-Import #188
   liefert ihn nicht verlässlich); ohne ihn nimmt die jüngste Zuordnung zurück. Über den Jahreswechsel kann das
   Teile zwischen Zeile 15/20 und Zeile 25 verschieben (Beispiel: Rücklastschrift im Januar Y+1 einer
   Novemberzahlung; die jüngste Zuordnung ist die vorausbezahlte Januarmiete, zurückgenommen wird also ein Teil
   `month` Januar Y+1 statt November Y). Die Summe je Jahr stimmt immer (sie ist `paidCents`). Der Rechenweg nennt
   die Auslegung; eine **negative Zeile 25** erklärt die Seite eigens (Hinweis `formerYears`, Satz: „Eine
   Rücklastschrift nimmt eine früher verbuchte Miete zurück; tragen Sie den Betrag mit Minus ein.“), denn der
   Vordruck nennt dort kein Minus. Ein späterer Verweis „Rücklastschrift zu Zahlung …“ (mit #188) würde LIFO
   ersetzen; er ist nicht Teil dieses Entwurfs.

**Abgelehnt: Verhältnis des Solls im Zahlungsmonat.** Der BGH hat die Frage für die Bruttomiete entschieden;
300 € auf 800 € (600 Kalt, 200 Vorauszahlung) sind 200 € Umlagen und 100 € Kaltmiete, nicht 75/225 (Kommentar
in #312). **Abgelehnt: „jeder Monat für sich, ältester zuerst“** (heute FIFO über die Summe). Das wäre Alter vor
Sicherheit, umgekehrt zur Reihenfolge des § 366 Abs. 2.

**Keine stillschweigende Bestimmung (Auslegung).** Ein Dauerauftrag „Miete“ über genau die Monatsmiete kann
nach den Umständen eine Bestimmung für den laufenden Monat sein. Mietfuchs kann das nicht erkennen und rechnet
nach Abs. 2; wer es anders will, trägt mit #281 den Monat an der Zahlung ein. Auf die Summe des Jahres wirkt das
nie, nur auf die Grenze zwischen Zeile 15/20 und Zeile 25 und zwischen 15 und 20.

**Grenze (bekannt, Abrechnungsreife).** Nach Abrechnungsreife oder erteilter Abrechnung kann der Vermieter offene
Vorauszahlungen nicht mehr verlangen (VIII ZR 84/17 Rn. 53); die Forderung lebt im Saldo der Abrechnung weiter,
der als eigene Zahlung der Art `settlement` kommt (#280). Die Tilgung führt solche A-Teile trotzdem als offene
Forderung und lässt spätere Mietzahlungen sie tilgen. **Entscheidung: keine Abhängigkeit der Tilgung von Frist oder
Versand.** Sonst hinge die Aufteilung (und damit Zeile 15/20/25) am Stichtag der Ansicht und am Versanddatum, also
an „heute“; die Funktion soll aber reproduzierbar aus Zahlungen und Soll folgen. Auf die Zeilen wirkt das nur,
wenn ein Mieter über eine Abrechnung hinweg im Rückstand ist; dann zählt eine spätere Zahlung eher als Umlage
(Zeile 20 bzw. 25 statt 15). Wirtschaftlich ist ein im Jahr Y gezahlter Rückstand an Vorauszahlungen eines schon
abgerechneten Zeitraums Teil der Abrechnung (Zeile 21); „Mehr dazu“ unter der Einnahmentabelle nennt das, ohne die
Rechnung zu ändern. Wie das **Mietkonto** solche Teile zeigt (nicht mehr einzeln einforderbar, kein mahnfähiger
Rückstand), entscheidet #281, E5.

### E3: Eine Rechnung für Mietkonto und Steuer

Die Zuordnung ist eine **reine Funktion** in einem neuen Modul `server/src/rentAllocation.ts`:

```ts
export type RentComponent = 'prepayment' | 'heatingPrepayment' | 'baseRent' | 'flatRate' | 'unallocated'
export type AllocationSlice = {
  paymentId: string
  paidOn: string          // Datum der Zahlung: Jahr des Zuflusses
  month: string | null    // 'JJJJ-MM' der getilgten Forderung, null bei unallocated
  component: RentComponent
  cents: number           // mit Vorzeichen (Rücknahme negativ)
}
// Eingabe: Zahlungen nur dieses Mietverhältnisses; die Art filtert die Funktion selbst. `designatedMonth`
// gibt es als Spalte erst mit #281; bis dahin fehlt es, und Schritt 1 von E2 greift nicht.
export type AllocationPayment = Pick<Payment, 'id' | 'date' | 'amountCents' | 'kind'> & { designatedMonth?: string | null }
export function allocateRentPayments(tenancy: SnapshotTenancy, payments: readonly AllocationPayment[]): AllocationSlice[]
```

**Das Monats-Soll steht in shared/monthRate.ts**, nicht in calc.ts: `monthSoll(t, month)` liefert je Bestandteil
den Betrag des Monats (`rateInMonth` je Staffel, wie heute in `ledgerRows`), daneben liegen schon `rateInMonth` und
`monthShare`. Grund: rentAllocation.ts importiert `monthSoll`, und calc.ts importiert `allocateRentPayments`; lag
`monthSoll` in calc.ts, entstünde ein ESM-Zyklus calc.ts ↔ rentAllocation.ts (Durchsicht, Abschnitt 2 Punkt 1).
`ledgerRows` ruft `monthSoll` ebenfalls, ohne Verhaltensänderung, damit Mietkonto und Steuer nie zwei
Staffelauslegungen haben. Die Funktion fragt nie nach „heute“ und nie nach dem Bundesland.

**Gemeinsame Helfer für Mietkonto und Steuer** (im selben Modul, beide Verbraucher rufen nur sie; nicht in
shared/, weil die Oberfläche nichts davon rechnet):

```ts
// Je Monat und Bestandteil: Soll und das bis `until` (einschließlich, nach `paidOn`) Getilgte.
export function monthCoverage(t: SnapshotTenancy, slices: readonly AllocationSlice[], months: readonly string[], until: string):
  { month: string; soll: Record<SollComponent, number>; paid: Record<SollComponent, number>; paidLaterOn: string | null }[]
// Saldo zu Beginn des Tages `on`: Σ Mietzahlungen mit Datum < on − Σ Soll aller Monate < Monat(on).
// Positiv = Guthaben (vorausbezahlt), negativ = Rückstand. Gleich der Summe offener und vorausbezahlter Teile.
export function openingBalance(t: SnapshotTenancy, payments: readonly AllocationPayment[], on: string): number
```

`monthCoverage` ist die Regel „bezahlt = Σ Teile ≥ Soll“, an einer Stelle; `paidLaterOn` nennt das Datum, an dem
ein zum Stichtag offener Monat später gedeckt wurde (Auskunft im Mietkonto). „Noch nicht fällig“ (`asOf`, #133)
bleibt beim Mietkonto: Die Tilgung kennt kein „heute“, die Status-Regel fragt den Stichtag erst in `ledgerRows`.

**Ein Release, eine Wahrheit.** #281 stellt `ledgerRows` im selben Release auf diese Funktion um, und zwar **bevor**
die Steuer die Teile liest (Reihenfolge: PR 1 hier → #281 → PR 2 hier). Es gibt im Stapel keinen Stand, in dem
Mietkonto und Steuer verschieden tilgen. Der frühere Übergang („bis #281 bleibt `rentLedger` FIFO je Jahr“) ist
gestrichen.

### E4: Zuordnung der Teile zu den Zeilen

Für das Steuerjahr Y zählen die Teile mit `paidOn` in Y:

| Teil | Zeile (2024/2025) | Feld |
|---|---|---|
| `month` in Y oder später, `baseRent` | 15/18 | `rentCents` |
| davon bei Inklusivmiete (kalt oder warm, Modell wie `costModels`) | 15/18, eigens genannt | `inclusiveRentCents` |
| `month` in Y oder später, `prepayment`, `heatingPrepayment`, `flatRate` | 20 | `allocationsCents` |
| davon `flatRate` | 20, eigens genannt (Auslegung, Hinweis `flatRateLine20`) | `flatRateCents` |
| `month` vor Y, jeder Bestandteil | 25 | `formerYearsCents` |
| davon Umlagen (A + Pauschale) | nur Auskunft | `formerYearsAllocationsCents` |
| `unallocated` | 15/18 | in `rentCents`, eigens `unallocatedCents` |
| Zahlungen der Art `settlement` | 21 (Saldo mit Vorzeichen) | wie heute `settlementBackPaymentsCents` − `settlementRefundsCents` |

**Zeile 25 brutto (Auslegung).** Der Vordruck sagt bei Zeile 25 nicht „ohne Umlagen“, die Zeilen 15–20 fragen
ausdrücklich die laufenden Beträge, und Haufe beschreibt Zeile 25 als „Mietrückstände“ aus früheren Jahren. Ein
im Jahr Y gezahlter Rückstand eines früheren Jahres steht deshalb ganz in Zeile 25; seine Umlagen werden
daneben genannt. Auf Zeile 32 wirkt die Wahl nicht. Die Anleitung 2024 nennt bei Zeile 25 nur die verrechnete
Kaution; ein „ohne Umlagen“ steht dort nicht. Grenze: Ein Rückstand an Vorauszahlungen eines schon abgerechneten
Zeitraums ist wirtschaftlich Teil der Abrechnung (Zeile 21); siehe E2, „Grenze“, und „Mehr dazu“.

**Überzahlung ohne Forderung in Zeile 15 (Auslegung).** Für sie ist keine Umlage vereinbart; sie ist kein
„umgelegter“ Betrag. Hinweis mit Betrag (`unallocatedPayment`), denn oft ist es eine Kaution oder eine falsch
erfasste Zahlung.

**Angehörige (Zeilen 19, 22, 23).** Der Entwurf zu #96 (`2026-10-30-steuer-objekt-ruecklage-design.md`, B2/B3)
führt `Tenancy.relative?: boolean | null` ein (fehlend = nein), in #96 PR 2, das im Stapel **vor** PR 2 dieses
Entwurfs liegt. PR 2 rechnet `relatives` deshalb gleich mit; einen Zwischenstand „Kennzeichen ohne Betrag“ gibt es
nicht (Entscheidung des Leads: `Tenancy.relative` kommt zusammen mit #312 in einem Release). Es gilt:

- Die Felder werden **je Mietverhältnis** geführt (`byTenancy`), und jede Zeile trägt `relative: boolean`
  (aus `Tenancy.relative === true`).
- Die Summenfelder von `received` umfassen **alle** Mietverhältnisse (so bleibt die Invariante zu `paidCents`
  einfach). Daneben steht `received.relatives`: dieselben Felder nur über Mietverhältnisse mit `relative`.
  Zeile 15/18 = `rentCents − relatives.rentCents`, Zeile 19 = `relatives.rentCents`, Zeile 20 = `allocationsCents −
  relatives.allocationsCents`, Zeile 22 = `relatives.allocationsCents`, Zeile 21 = Saldo − `relatives.settlementCents`,
  Zeile 23 = `relatives.settlementCents`. Zeile 25 trennt der Vordruck nicht nach Angehörigen; sie bleibt ganz.
  Die Rechnung dieser Zeilen steht in taxView.ts (`incomeRows(report, year)`), nicht in der Seite.
- Z. 10 Kz. 62 (Zahl der Mietverhältnisse mit Kennzeichen) liefert #96 als `costModels.relativeTenancies` (eine
  **Anzahl**; umbenannt aus `relatives`, damit es nicht mit `received.relatives` in **Cent** verwechselt wird, X11).
- Ohne Mietverhältnis mit `relative` entfallen die Zeilen 19/22/23 in der Tabelle; der bisherige Satz zu den
  Angehörigen-Zeilen unter der Tabelle entfällt dann auch (#96 B3 nennt ihn nur, wenn es solche gibt).

**Andere Räume und Garagen** (Zeilen 16–18, 26) unterscheidet Mietfuchs noch nicht: Es gibt keine Art
„Wohnung/andere Räume/Garage“ an der Einheit (#96 B4, #163 F3). Zeile 15 und 18 stehen deshalb zusammen, wie heute.
**Zeile 21 ist nicht neu**: Sie steht seit #280 nach Zufluss in der Übersicht (2023 bis 2025, `settlementLine`);
dieser Entwurf übernimmt sie nur in die neue Tabelle und teilt sie für Angehörige.

### E5: Inklusivmiete, Pauschale, Zeile 24

Inklusivmiete: Die ganze Miete ist Kaltmiete im Sinne des Solls und steht in Zeile 15; Zeile 24 (Kz 13, „nicht
gesondert vereinbart“) bleibt wie heute ein Hinweis aus `costModels` (`inclusiveLine24`, `inclusiveLine24Mixed`).
Neu ist nur, dass auch auf der Ist-Grundlage der inklusive Teil eigens dasteht (`inclusiveRentCents`). Die
Pauschale ist gesondert vereinbart (§ 556 Abs. 2 BGB), deshalb Zeile 20 und nicht Zeile 24 (bleibt Auslegung,
Hinweis `flatRateLine20` unverändert).

### E6: Nachzahlungen und Erstattungen (Zeile 21)

Wie heute aus den Zahlungen der Art `settlement`, nach Datum, saldiert mit Vorzeichen. Sie gehen nie durch die
Tilgung (#280). Ein mit der Miete verrechnetes Guthaben ist volle Miete plus negative Abrechnung (#280); damit
stimmt Zeile 21 auch dann. Ein Abgleich mit dem Ergebnis der (eingefrorenen) Abrechnung ist nicht Teil dieses
Entwurfs: Zeile 21 fragt das Erhaltene, nicht das Abgerechnete.

### E7: Mieten für frühere Jahre (Zeile 25)

Entsteht von selbst aus E2 und E4: Ein Teil mit `month` vor Y und `paidOn` in Y. Typische Fälle: Dezembermiete,
die nach Auszug im Januar eingeht; Rückstand, den der Mieter im Folgejahr begleicht. Ohne Übertrag (#281) gäbe es
diese Zeile nicht; deshalb ist das fortlaufende Konto Voraussetzung.

### E8: Zehn-Tage-Regel: angewandt, wo die Fälligkeit aus dem Gesetz folgt, sonst beziffert

**Stand nach der Durchsicht von PR 2** (ersetzt die frühere Fassung „nur beziffert, nichts verschoben“). § 11 Abs. 1
Satz 2 EStG ist zwingend; die Zeilen sollen im Regelfall gesetzeskonform sein, nicht nur einen Hinweis tragen.
Voraussetzung ist, dass Zahlung **und** Fälligkeit in den zehn Tagen liegen (H 11 EStH, BFH X R 2/21, siehe
Rechtslage). Die Fälligkeit folgt aus dem Gesetz, das für das Mietverhältnis gilt (`bgb.rent-due-at-start` im
Rechtsregister, eventDate = früheres von Vertragsdatum und Beginn):

- **Mietverhältnis, das am 01.09.2001 nicht bestand** (§ 556b Abs. 1 BGB: zu Beginn, spätestens am dritten Werktag).
  - *Vorwärts*: Die Januarmiete ist spätestens am 07.01. fällig (ohne Samstag, mit 01.01. und je Land 06.01.; Test über
    alle 16 Länder und 1995 bis 2100 in invariant-tilgung.test.ts, ohne dass die Rechnung `rentDueDate` liest). Ein Teil
    mit Zahlung vom 22.12. bis 31.12. des Jahres Y für den Januar Y+1 **zählt in Y+1** (Zeile 15/20 dort), nicht in Y.
    Beziffert bleibt er für den Hinweis: `forwardCents` in Y, `fromPreviousCents` in Y+1. Nur, wenn der Januar-Abschnitt
    in den zehn Tagen fällig ist (Nachdurchsicht M1): Beginnt das Mietverhältnis im Januar, beginnt der erste Abschnitt
    mit ihm (Auslegung von „zu Beginn … der einzelnen Zeitabschnitte“), und die erste Miete ist am dritten Werktag ab
    Beginn fällig; bei Beginn am 15.01. also nicht in der Frist, die Zahlung vom 28.12. bleibt im Jahr der Zahlung. Ob der
    dritte Werktag bei Beginn vom 02.01. bis 10.01. noch in die Frist fällt, hängt an Wochentag und Feiertagen des Landes;
    mit Feiertagen darf der Server erst nach amtlicher Lesung aller Landesgesetze rechnen (Auflage aus #290). Bis dahin
    wird nur verschoben, wenn das Mietverhältnis spätestens am 01.01. beginnt (bekannte Grenze). Eine
    Rücklastschrift folgt der Zahlung, die sie zurücknimmt (`reversesPaidOn` am Teil, Nachdurchsicht S1): nur verschoben,
    wenn auch diese in den letzten zehn Tagen des Dezembers kam.
  - *Rückwärts*: Die Dezembermiete ist Anfang Dezember fällig, außerhalb der zehn Tage. Eine Zahlung Anfang Januar bleibt
    im neuen Jahr (Zeile 25), `lateDecemberCents` ist 0.
- **Mietverhältnis, das am 01.09.2001 bestand** (einschließlich Beginn an diesem Tag, Auslegung; Art. 229 § 3 Abs. 1
  Nr. 7 EGBGB, gelesen am 31.10.2026: § 551 BGB a. F.,
  Miete am Ende des Monats). Vorwärts ist die Januarmiete Ende Januar fällig, die Regel greift nicht; rückwärts ist die
  Dezembermiete am 31.12. fällig und eine Zahlung bis 10.01. gehörte ins Vorjahr. Weil solche Verträge oft auf Zahlung zu
  Beginn umgestellt sind, wird hier **nichts verschoben**, nur beziffert: `forwardOldLeaseCents` (bleibt in Y) und
  `lateDecemberCents` (bleibt in Y, Zeile 25), mit dem Vorbehalt „nur wenn laut Vertrag am Monatsende fällig“.

**Bewusste Grenze.** § 556b und § 551 a. F. sind abdingbar. Eine vertraglich abweichende Fälligkeit kennt Mietfuchs nicht;
es gibt am Mietverhältnis kein Feld dafür. Ein Feld „Miete fällig am Monatsende“ wäre ein eigenes Issue.

**Summe.** Für jedes Jahr gilt Zeile 15/18 + 20 + 25 + 21 = `paidCents` − `forwardCents` + `fromPreviousCents`, und
`fromPreviousCents(Y)` = `forwardCents(Y−1)`; über alle Jahre bleibt die Summe gleich. `paidCents` selbst und
`tax-golden.json` bleiben (Zufluss nach Datum), ebenso das Mietkonto, das nie verschiebt.

Die Zehn-Tage-Grenze steht im Rechtsregister (`estg.short-period-days`, 10, Rang `court`, `adopted`, bis H 11 EStH
amtlich gelesen ist), gefragt für das Jahr, zu dem die Zahlung wirtschaftlich gehört (Zeitregel `periodStart`).

### E9: Kaution

Keine neue Art der Zahlung. Die Kaution steht am Mietverhältnis (#228). Als Miete erfasst, verfälschte sie die
Einnahmen; Mietfuchs kann das nicht sicher erkennen, prüft aber einen häufigen Fall: eine Zahlung der Art `rent`
bis 31 Tage vor bis 31 Tage nach Beginn des Mietverhältnisses, deren Betrag `depositCents` gleicht,
`depositCents` ≠ Monats-Soll des ersten vollen Monats, und **die Zahlung tilgt keinen Rückstand** (keiner ihrer
Teile hat einen `month` vor dem Monat ihres Datums; sonst wäre der Verdacht falsch bei einem Mieter, der mit dem
Betrag der Kaution zwei Monate nachzahlt). Dann Hinweis `possibleDeposit` mit Datum und Betrag
(„Ist das die Kaution? Sie ist keine Einnahme …“). Eine verrechnete Kaution gehört in Zeile 25; erfassen lässt sie
sich heute als Zahlung der Art `rent` am Tag der Verrechnung (sie tilgt dann den Rückstand und landet über E4 je
nach Monat in 15/20 oder 25). Ein eigenes Merkmal „verrechnet“ kommt mit #228.

### E10: Eigennutzung und verbilligte Vermietung

- **Eigennutzung** (#163): ohne Mietverhältnis keine Zahlung, die Aufteilung berührt sie nicht. Zeile 12 bleibt
  bei der Fläche.
- **Verbilligte Vermietung** (§ 21 Abs. 2 EStG, #257): Die Einnahmen stehen ungekürzt in den Zeilen; die Kürzung
  bleibt bei den Werbungskosten (Zeilen 87/88). Das Entgelt der Quote (`cheapRent.ts`: Kaltmiete **Soll**, BFH
  IX R 7/20, plus Umlagen laut Abrechnung) ändert sich **nicht**; die neue Aufteilung ist keine Grundlage der
  Quote. Begründung: Der BFH stellt auf die vereinbarte Miete ab; das Ist schwankte mit jedem Rückstand.
  Invariante: invariant-steuer-verbilligt.test.ts bleibt unverändert grün.

### E11: Mehrere Objekte, Mieterwechsel, Zeiträume, Abschluss

- **Je Objekt**: `taxReportFor` rechnet je Objekt; die Zahlungen im Schnappschuss sind die der Mietverhältnisse
  des Objekts (`snapshotFor` filtert nach `tenancyIds`). Die Tilgung läuft je Mietverhältnis, ein Objekt sieht nie
  Zahlungen eines anderen. Die Gesamtsicht (#96 PR 3, letzter PR des Releases) summiert die Felder, auch
  `received`; Kreuz-Invariante X9 (c) im Release-Plan.
- **Option `received: false`** an `taxReportFor`/`taxReport` (Vorgabe `true`): Die Tilgung entfällt, `received`
  fehlt. Für Rückgriffe, die nur Werbungskosten brauchen (#262 E-6, Raten aus Y0; `foreignHeatQuota`), damit
  nicht jeder Rückgriff die Tilgung aller Mietverhältnisse rechnet (Durchsicht X10). Ein Test hält fest, dass alle
  übrigen Felder mit und ohne Option gleich sind.
- **Mieterwechsel**: jedes Mietverhältnis hat sein eigenes Konto. Zahlungen nach Auszug tilgen die Forderungen
  dieses Mietverhältnisses (Zeile 25, wenn aus einem früheren Jahr), sonst `unallocated`.
- **Abrechnungszeitraum ≠ Kalenderjahr** (#208): ohne Bedeutung. Die Tilgung kennt nur Monate und Zahlungsdaten;
  `prepaymentSettlementCents` bleibt wie heute.
- **Abgeschlossene Abrechnung**: friert nichts von den Einnahmen ein. Zahlungen sind Tatsachen mit Datum; die
  Tilgung rechnet immer heute. Wird nach dem Abschluss eine Staffel geändert, ändert sich die Aufteilung (nicht
  die Summe) auch rückwirkend; das ist richtig, denn die Forderung war eine andere. Die Jahreskorrektur der
  Abrechnung (`prepaymentOverride`) geht nicht in das Monats-Soll (wie im Mietkonto, #70).
- **Zahlungsdatum der Werbungskosten** (#255, #478): keine Berührung; Einnahmen haben immer ein Datum.

## Datenmodell der Antwort

In `shared/types.ts`, `TaxReport['income']`, ein neues Feld; alles Übrige bleibt:

```ts
// Das Zugeflossene nach Zeilen der Anlage V (#312), aus der Tilgung jeder Zahlung (rentAllocation.ts).
// rentCents + allocationsCents + formerYearsCents + (settlementBackPaymentsCents − settlementRefundsCents)
//   = paidCents − turnOfYear.forwardCents + turnOfYear.fromPreviousCents (Zehn-Tage-Regel, E8).
received: {
  rentCents: number              // Zeilen 15/18: Kaltmiete und Inklusivmiete, Überzahlung ohne Forderung
  inclusiveRentCents: number     // davon Inklusivmiete
  unallocatedCents: number       // davon ohne Forderung (mit Vorzeichen)
  allocationsCents: number       // Zeile 20: Vorauszahlungen, Heizvorauszahlungen, Pauschalen
  flatRateCents: number          // davon Pauschalen
  formerYearsCents: number       // Zeile 25: Mieten für frühere Jahre, brutto
  formerYearsAllocationsCents: number // davon Umlagen, Auskunft
  turnOfYear: {
    forwardCents: number         // 22.12. bis 31.12. für Januar gezahlt, § 556b: zählt im Folgejahr (nicht in den Zeilen hier)
    forwardAllocationsCents: number
    fromPreviousCents: number    // dasselbe aus dem Vorjahr: zählt hier (in Zeile 15/20 enthalten)
    fromPreviousAllocationsCents: number
    forwardOldLeaseCents: number // wie forwardCents bei Mietverhältnissen, die am 01.09.2001 bestanden: bleibt hier, Vorbehalt
    lateDecemberCents: number    // bis 10.01. für Dezember gezahlt, nur wenn am 01.09.2001 bestehend (sonst 0): bleibt hier
  }
  byUnit: { unitId: string; unitName: string; areaM2: number | null; rentCents: number; allocationsCents: number; settlementCents: number; formerYearsCents: number }[]
  byTenancy: { tenancyId: string; tenantName: string; unitName: string; start: string; end: string | null;
    relative: boolean;           // Tenancy.relative aus #96; ohne das Feld false
    rentCents: number; inclusiveRentCents: number; allocationsCents: number; settlementCents: number;
    formerYearsCents: number; unallocatedCents: number; forwardCents: number }[]
  // Teilsummen über Mietverhältnisse mit `relative` (Zeilen 19, 22, 23); ohne solche überall 0.
  relatives: { rentCents: number; allocationsCents: number; settlementCents: number }
  possibleDeposits: { tenancyId: string; tenantName: string; paidOn: string; cents: number }[]
}
```

`byTenancy` enthält jedes Mietverhältnis mit einer Zahlung im Jahr, auch ohne Zeile im Mietkonto (E1);
Reihenfolge `compareName` nach Einheit, dann Mieter (wie `ledgerRows`). `byUnit` summiert `byTenancy` je Einheit;
die Fläche ist die der Einheit (Zeilen 13/14 fragen sie).

## Rechnung in `taxReport`

`paidInYear` bleibt. Daneben je Mietverhältnis des Schnappschusses (nicht nur der Zeilen des Mietkontos):
`allocateRentPayments(t, payments.filter(p => p.tenancyId === t.id))`, dann die Teile mit `paidOn` in Y nach E4
summiert. Das Inklusiv-Modell je Mietverhältnis aus derselben Bestimmung wie `costModels` (herausgezogen als
`tenancyCostModel(t, heatingBilled)`, damit beide nicht auseinanderlaufen). Zahlungen der Art `rent` an ein
Mietverhältnis, das der Schnappschuss nicht führt, gibt es nach `snapshotFor` nicht; geschähe es doch, wirft die
Rechnung nicht, sondern zählt sie als `unallocated` (Summe bleibt `paidCents`).

## Prüfsummen (`tax-golden.json`)

**Keine Prüfsumme ändert sich.** `incomeFingerprint` in server/testing/taxGolden.ts nimmt `received` heraus,
**unbedingt**, mit Kommentar: Es ist eine Zerlegung von `paidCents`, das in der Prüfsumme bleibt, und seine
Summe prüft die Invariante. Für die neuen Zahlen gibt es eine eigene Referenz `tax-received-golden.json` (je
Startwert des Generators `taxStock.ts` die Prüfsumme über `received` ohne Namen), erzeugt mit dem Code dieses
Entwurfs und nur neu zu schreiben mit Begründung im Commit (`TAX_RECEIVED_GOLDEN_WRITE=1`). Der Generator kennt
keine Art der Zahlung (alles Miete); er soll für die neue Referenz Rückstände, Überzahlungen, Rücklastschriften
und Zahlungen am Jahreswechsel erzeugen. **Den Generator nicht für die alte Referenz ändern** (sonst ändern sich
alle Prüfsummen): eine eigene Ableitung `withPaymentVariety(source, seed)` nur für die neue.

Weitere Folgen: `noticeSamples.json` nur, wenn calc.ts neue Hinweistexte bekommt (hier nicht: die neuen Hinweise
leben in taxView.ts). guides.test.ts, wenn eine Anleitung die Zeilen zitiert (Schritt 3 sucht danach).

## Oberfläche (Steuer.tsx, Logik in taxView.ts)

Die Tabelle „Einnahmen“ bekommt zwei Betragsspalten statt zweier Blöcke: **eingegangen (Ist)** und
**vereinbart (Soll)**. Die Spalte der gewählten Grundlage steht vorn und fett; die andere ist `muted` und heißt
„zum Abgleich“. Am Handy `stacked` mit `data-label`. Eine Spalte „Zeile“ davor, nur wenn `anlageVLines(year).income`
die Nummer kennt (2024/2025, Zeile 25 für 2023 erst nach dem Lesen). Die Tabelle steht unter dem Abschnitt
„Kopf der Anlage V“ aus #96 (B3). **Reihenfolge der Steuerseite** wie der Vordruck (festgehalten in
Steuer.test.tsx, angelegt in #96 PR 1, jeder PR ergänzt seinen Block): Kopf → Einnahmen (13–32) → Werbungskosten
mit Erhaltung (55–72) → übrige Werbungskosten → 87/88 → Gesamtsicht. Mit Mietverhältnissen an Angehörige kommen die Zeilen 19, 22 und 23 als eigene
Zeilen hinzu und 15/18, 20, 21 zeigen den Rest (E4).

| Zeile | Einnahme | eingegangen | vereinbart |
|---|---|---|---|
| 15, 18 | Mieteinnahmen ohne Umlagen | `rentCents` | Kaltmiete Soll − inklusiv |
|  | davon Inklusivmieten (Nebenkosten eingeschlossen) | `inclusiveRentCents` | `inclusiveRentSollCents` |
|  | davon ohne vereinbarte Miete (Überzahlung) | `unallocatedCents` | – |
| 20 | Umlagen: laufende Vorauszahlungen und Pauschalen | `allocationsCents` | `prepaymentSollCents + flatRateSollCents` |
|  | davon Betriebskostenpauschalen | `flatRateCents` | `flatRateSollCents` |
| 21 | Nachzahlungen minus erstattete Guthaben aus der Abrechnung | Saldo | – |
| 25 | Mieten für frühere Jahre | `formerYearsCents` | – |
|  | **Summe** | `paidCents` | `sollCents` |

Zeilen mit 0 € in beiden Spalten entfallen (außer 15 und 20 und Summe). Die bisherigen „davon“-Zeilen und der
lange Absatz zu Zeile 21 entfallen; an ihre Stelle treten zwei Sätze unter der Tabelle: „Tragen Sie jede Zeile
einzeln ein; die Summe ergibt sich in Zeile 32.“ und „Eingegangen und vereinbart lassen sich nur in der Summe
vergleichen: Ein Rückstand oder eine Vorauszahlung verschiebt Beträge zwischen den Zeilen und Jahren, und Zeile 21
und 25 haben kein vereinbartes Gegenstück.“ Die Angehörigen-Zeilen (19, 22, 23) erscheinen nur mit solchen
Mietverhältnissen. Ist Zeile 25 negativ, steht der Satz zur Rücklastschrift aus E2, Schritt 5, dabei.

**Bewusste Abweichung (Durchsicht von PR 3, K6):** Die Spalte „Zeile“ steht nach „Einnahme“, nicht davor. Am Handy
(`stacked`) wird die erste Zelle zum Titel der Karte; dort ist die Einnahme der bessere Titel als eine Nummer. Ebenso aus
der Durchsicht (K4): Auch die bestehenden Hinweise zu Zeile 24 und zur Pauschale nennen Nummern nur aus `anlageVLines`
(`costModelLineTexts` in taxView.ts), für Jahre ohne gelesenen Vordruck in Worten.

Darunter, aufklappbar „Je Wohnung (für die Zeilen 13 und 14)“: `byUnit` mit Bezeichnung, Fläche und Miete ohne
Umlagen; mit dem Satz, dass andere Räume in die Zeilen 16–18 und gesondert vermietete Garagen in Zeile 26
gehören, was Mietfuchs nicht unterscheidet. Im Druck offen.

Auf der Soll-Grundlage bleibt die Tabelle gleich, nur die Spalten tauschen. „Mehr dazu“ unter der Tabelle (nur
Begründungen mit Fundstelle): Tilgungsreihenfolge (§ 366 BGB, BGH VIII ZR 68/17; VIII ZR 84/17 Rn. 53, 57),
Zuflussprinzip, und der Satz zur Grenze aus E2: „Zahlt ein Mieter Vorauszahlungen eines schon abgerechneten
Zeitraums nach, gehört der Betrag wirtschaftlich zur Abrechnung (Zeile 21). Mietfuchs führt ihn nach der
gesetzlichen Reihenfolge als Umlage bzw. Miete für frühere Jahre; die Summe ändert das nicht. Besprechen Sie
größere Beträge mit Ihrem Steuerberater.“

**Hinweise** (TAX_HINTS, je mit Lage im Komponententest):

- `turnOfYear` **ändert die Bedingung und den Text** (E8 nach der Durchsicht von PR 2): nur mit Betrag. Vorgaben für PR 3:
  - *Vorwärts* (`fromPreviousCents` ≠ 0 bzw. im Vorjahr `forwardCents` ≠ 0), ruhig, ohne Vorbehalt: „X € Januarmiete
    sind Ende Dezember eingegangen; sie zählen nach § 11 Abs. 1 Satz 2 EStG im Jahr {Y+1} und stehen dort.“ Auf der
    Seite von Y+1 entsprechend „… aus dem Dezember {Y} stehen in diesem Jahr“, mit Beträgen je Zeile.
  - *Alter Vertrag vorwärts* (`forwardOldLeaseCents` ≠ 0): Vorbehalt „Das Mietverhältnis bestand schon am 01.09.2001;
    ohne andere Vereinbarung ist die Miete am Monatsende fällig, die Januarmiete also nicht in den zehn Tagen. Mietfuchs
    lässt X € deshalb im Jahr der Zahlung. Ist laut Vertrag zu Beginn des Monats zu zahlen, gehören sie ins Jahr {Y+1}.“
  - *Rückwärts* (`lateDecemberCents` ≠ 0, nur bei altem Vertrag): ein ruhiger Satz, **kein Titel „gehören zu“**: „X €
    Dezembermiete sind Anfang Januar eingegangen und stehen in diesem Jahr. Nur wenn die Miete laut Vertrag am
    Monatsende fällig ist, gehören sie ins Jahr {Y−1}.“ Bei Mietverhältnissen nach § 556b gibt es keinen Hinweis: Die
    Dezembermiete war im Dezember fällig und bleibt im neuen Jahr.
  - Nie nahelegen, eine Zahlung ins alte Jahr zu verschieben, wenn die Fälligkeit außerhalb der zehn Tage lag.
  Begründung für die Bedingung: Ein Hinweis ohne Anlass lehrt, Hinweise zu übersehen.
- `unallocatedPayment` (neu): `unallocatedCents` ≠ 0. „X € ohne vereinbarte Miete eingegangen.“ Aktion: im
  Mietkonto prüfen (Kaution? Staffel endet?).
- `possibleDeposit` (neu): Liste nicht leer. „Ist die Zahlung vom … über … € die Kaution?“ Aktion: Art und
  Betrag im Mietkonto prüfen; Kaution ist keine Einnahme.
- `formerYears` (neu, ruhig): `formerYearsCents` ≠ 0. Erklärt Zeile 25 und dass ein Rückstand zuerst getilgt
  wird (§ 366 Abs. 2 BGB), mit dem Hinweis auf die Bestimmung des Mieters (Monat an der Zahlung im Mietkonto, #281).
  Bei negativem Betrag der Satz zur Rücklastschrift (E2, Schritt 5).
- `paymentsMissing`, `flatRateLine20`, `inclusiveLine24*`, `sollIsNotTaxBasis`: unverändert.

Alle Texte siezen (anrede.test.ts). **Zeilennummern aus einer Tabelle** (Durchsicht X5): `anlageVLines(year)` in
client/src/anlageV.ts (angelegt in #96 PR 1) trägt einen Block `income` mit Zeile und Kennzahl je Angabe (13/14,
15 Kz. 01, 18 Kz. 02, 19 Kz. 03, 20 Kz. 04, 21 Kz. 11, 22 Kz. 05, 23 Kz. 12, 24 Kz. 13, 25 Kz. 06), mit Fundstelle
je Jahr. `settlementLine(year)` in taxView.ts bleibt mit Namen und Rückgabe bestehen (nichts wird umbenannt), liest
aber nur noch aus `anlageVLines(year).income`; die bisherige Tabelle `SETTLEMENT_LINES` geht samt Fundstellen
in anlageV.ts über (#96 PR 1). Neu für Zeile 25 sind dort `formerYears: { line: 25, code: 6 }` (angezeigt „06“),
für 2024 und 2025; für 2023 erst nach dem Lesen von Seite 2. Das ist nicht das Zusammenführen zur Ausfüllhilfe
(#194), sondern nur eine Datenquelle für alle drei Entwürfe dieses Releases.

## Steuer-ZIP

Neue Datei `Einnahmen.csv` neben `Übersicht.csv`, gleiche Form (BOM, `;`, CRLF, Euro wie `euro()`), eine Zeile je
`byTenancy`, Summenzeile am Ende:

`Wohnung;Mieter;Beginn;Ende;Miete ohne Umlagen (EUR);davon Inklusivmiete (EUR);Umlagen laufend (EUR);Abrechnung Nachzahlung/Erstattung (EUR);Mieten für frühere Jahre (EUR);ohne vereinbarte Miete (EUR);Zufluss gesamt (EUR);Zehn-Tage-Regel Folgejahr (EUR)`

Erzeugt in `taxReceipts.ts` (`incomeCsv(report)`), angehängt in index.ts. Die Auswahl der Belege und
`Übersicht.csv` ändern sich nicht. Datenschutz: Mieternamen stehen schon in der Steuerübersicht; das ZIP geht an
den Steuerberater, also unbedenklich.

## Zusammenspiel mit den Entwürfen des Releases

Reihenfolge, Abhängigkeiten und Migrationen stehen im Release-Plan (`2026-10-30-release-0.14-plan.md`). Für diesen
Entwurf gilt:

- **#281** (Mietkonto, Übertrag): liest `allocateRentPayments`, `monthCoverage` und `openingBalance` aus PR 1 und
  stellt `ledgerRows` darauf um; bringt `payments.designated_month` (Schritte 0078/0079) und damit Schritt 1 von E2.
  PR 2 hier liegt im Stapel **nach** #281. Weicht #281 in der Durchsicht von E2 ab, wird E2 hier geändert, nie ein
  zweiter Algorithmus gebaut.
- **#96** (Entwurf `2026-10-30-steuer-objekt-ruecklage-design.md`): PR 1 legt `anlageVLines` samt Block `income`
  an (Zeilen dieses Entwurfs kommen von dort); PR 2 bringt `Tenancy.relative` und `costModels.relativeTenancies`.
  Beide liegen vor PR 2 hier. Die Gesamtsicht (#96 PR 3) summiert `received`.
- **#262** (§ 82b EStDV): betrifft nur `expenses` und `surplus*`; liest für den Rückgriff auf Y0 die Option
  `received: false` (E11). Beide ändern `TaxReport` und taxGolden.ts; keiner nimmt in `taxFingerprint` ein Feld
  auf, das ohne Angabe ≠ 0 ist; `received` bleibt herausgenommen.
- **#478** (Zeitraumwechsel behält das Steuerjahr): keine Berührung; Einnahmen haben immer ein Datum.
- **#228** (Kaution): ein Merkmal „verrechnet am …, Betrag“ ergäbe Zeile 25 ohne Umweg über eine Mietzahlung.
- **#194** (Ausfüllhilfe): liest `anlageVLines(year)` und `received`.

## Nicht in diesem Entwurf

Anwenden der Zehn-Tage-Regel bei vertraglich abweichender Fälligkeit (E8, bewusste Grenze); andere Räume und Garagen (E4); Umsatzsteuer (Zeilen 27/28);
Baukostenzuschüsse; Zuschüsse (Zeile 29); Mietvorauszahlungen über mehr als fünf Jahre (§ 11 Abs. 1 Satz 3 EStG,
nur im Rechenweg genannt, wenn eine Zahlung mehr als 60 Monate im Voraus tilgt); die Anzeige des Mietkontos (#281);
ein Verweis der Rücklastschrift auf ihre Zahlung (E2, Schritt 5).

## Entschieden

Keine offenen Fragen. Fachlich entschieden: E2 (Sicherheit vor Alter, Pauschale zu B, Rücklastschrift LIFO; Tilgung
unabhängig von Abrechnungsreife), E4 (Zeile 25 brutto, Überzahlung in 15), E8 (Zehn-Tage-Regel angewandt bei Fälligkeit nach § 556b,
sonst beziffert, ohne `rentDueDate`). Alle als Auslegung gekennzeichnet und in der Oberfläche begründet. Vom Lead entschieden: eine
Tilgungsfunktion für Mietkonto und Steuer im selben Release, `monthSoll` in shared/monthRate.ts, `Tenancy.relative`
vor PR 2.

## Quellen

- § 11 Abs. 1 EStG; § 366 BGB; § 556b Abs. 1, § 556 Abs. 2 und 3, § 551 Abs. 3 BGB; § 551 BGB a. F. mit Art. 229 § 3
  Abs. 1 Nr. 7 EGBGB.
- BGH, Urteil vom 21.03.2018, VIII ZR 68/17, BGHZ 218, 139 (Leitentscheidung, Tilgung bei der Bruttomiete).
- BGH, Urteil vom 21.03.2018, VIII ZR 84/17, Rn. 53, 54, 56, 57, Volltext https://gesetze.co/urteile/VIII_ZR_84-17
  (gelesen am 30.10.2026); Zusammenfassung
  https://deutschesmietrecht.de/betriebskosten/724-mietrueckstaende-zahlungen-verbuchung.html.
- BFH, Urteil vom 24.07.1986, IV R 309/84; BFH, Urteil vom 27.06.2018, X R 44/16; BFH, Urteil vom 16.02.2022,
  X R 2/21; H 11 EStH.
- Anlage V 2025: https://www.finanzamt.nrw.de/dokumente/anlage-v-einkuenfte-aus-vermietungverpachtung-bebauter-grundstuecke-2025
- Anlage V 2024: https://www.steuern.de/fileadmin/user_upload/Steuerformulare_2024/Anlage_V_steuern.de_01.pdf;
  Anleitung zur Anlage V 2024 (Zeile 20: Umlagen in voller Höhe; Zeile 25: verrechnete Kaution).
- Haufe, Anlage V 2024, 24.2.7 „Vereinnahmte Mieten für frühere Jahre …“,
  https://www.haufe.de/id/beitrag/24-anlage-v-2024-fuer-einkuenfte-aus-vermietung-und-verpa-2427-vereinnahmte-mieten-fuer-fruehere-jahre-und-mietvorauszahlungen-aus-baukostenzuschuessen-HI16275528.html

---

# Umsetzungsplan

Drei PRs im Stapel des Releases (dort Nr. 2, 6 und 7), je mit Durchsicht mit frischem Kontext vor dem PR; auf der
Spitze des Releases Integrationsdurchsicht (Release-Plan, X9), Praxislauf und `full-check`. Jeder Schritt TDD: Test
rot, dann Code, dann `npm run typecheck` und `npm test`. Commits mit `Refs #312`, nie `Fixes`.

Keine Migration hier: Gespeichert wird nur `designatedMonth`, und das gehört zu #281.

## PR 1 (Stapel Nr. 2): `rentAllocation.ts` und `monthSoll` (reine Funktionen, noch ohne Verbraucher)

Hängt ab von: Nr. 1 (#478), nur weil der Stapel linear ist. Dateien: `shared/monthRate.ts` (`monthSoll`),
`server/src/calc.ts` (`ledgerRows` ruft `monthSoll`), `server/src/rentAllocation.ts` (neu),
`server/test/rentAllocation.test.ts` (neu), `server/test/invariant-tilgung.test.ts` (neu).

1. **Test**: `monthSoll` liefert für jede Lage aus calc.test.ts dieselben Bestandteile wie `ledgerRows` heute
   (ein neuer Test vergleicht über Zufallsbestände je Monat; bestehende Mietkonto-Tests bleiben grün).
   **Code**: nach shared/monthRate.ts, `ledgerRows` ruft es. Ein Wächter (Suche im Quelltext) verlangt, dass
   rentAllocation.ts nichts aus calc.ts importiert (kein Zyklus).
2. **Tests Beispiele** (je ein `test`, Testdaten über `tenancy()`/`emptyDb` aus server/testing, keine freien
   Literale):
   - Volle Monatsmiete jeden Monat → je Monat genau Soll je Bestandteil.
   - 300 € auf 600 Kalt + 200 VZ → 200 `prepayment`, 100 `baseRent`.
   - Issue-Beispiel: Jan–Nov je 800, Dez nichts → Teile 2025: `baseRent` 6.600, `prepayment` 2.200.
   - Zwei Monate offen, dann 800 → A beider Monate zuerst (400), dann B des älteren (400) (Rn. 57).
   - `designatedMonth` gesetzt → zuerst A, dann B dieses Monats, Rest an die ältesten A, dann B (Rn. 56);
     ein Monat außerhalb des Mietverhältnisses wirkt wie keine Bestimmung.
   - Pauschale und Kaltmiete im selben Monat, Teilzahlung → verhältnismäßig, Rest-Cent nach `largestRemainder`.
   - Heizvorauszahlung + Vorauszahlung → beide A, verhältnismäßig.
   - Überzahlung → nächster Monat (A vor B), nach Ende des Mietverhältnisses `unallocated`.
   - Dauerauftrag am 28.12. für Januar → `month` Januar Folgejahr, `paidOn` Dezember.
   - Dezembermiete nach Auszug am 05.01. → `month` Dezember Vorjahr.
   - Rücklastschrift → nimmt die letzte Zuordnung zurück (LIFO, auch über den Jahreswechsel: Beispiel aus E2
     Schritt 5), negativer Teil im Jahr der Rücklastschrift; spätere Zahlung deckt den wieder offenen Monat.
   - Rückzahlung einer Überzahlung → nimmt zuerst `unallocated` bzw. künftige Monate zurück.
   - Angebrochener Monat (`rateInMonth`) → Soll nach Tagen.
   - Zahlungen der Art `settlement` → kein Teil.
   - Gleiches Datum zweier Zahlungen → Reihenfolge nach Kennung (`compareText`), unabhängig von der Eingabereihenfolge.
   - Staffel endet bei 0 im offenen Mietverhältnis → `unallocated`, keine Schleife (Grenze 120 Monate).
   **Code**: E2.
3. **Tests Helfer**: `monthCoverage` (bezahlt, teilweise, offen; `paidLaterOn` bei später gedecktem Monat;
   Stichtag schneidet Teile mit späterem `paidOn` ab); `openingBalance` (Rückstand aus Dezember, Vorauszahlung vom
   28.12., beides gleich der Summe der offenen bzw. vorausbezahlten Teile).
4. **Invarianten** über Zufallsbestände mit festem Startwert:
   - Σ Teile je Zahlung = Betrag der Zahlung (also Σ Teile eines Jahres = Σ Mietzahlungen des Jahres).
   - Je Monat und Bestandteil: 0 ≤ Σ zugeordnet ≤ Soll (Rücknahmen eingerechnet).
   - Keine Forderung bleibt offen, solange eine spätere positive Zahlung einen `unallocated`-Teil erzeugt.
   - Reihenfolge der Eingabe egal (Permutation der Zahlungen ergibt dieselben Teile).
   - **Jeder Monat genau bezahlt** (je Monat eine Zahlung über das Soll im Monat): Teile = Soll je Monat, und
     `monthCoverage` ergibt für jeden Monat denselben Status wie `ledgerRows` heute (die Zusage aus #281).
   - `openingBalance(t, p, 01.01.Y+1)` = `openingBalance(t, p, 01.01.Y)` + Σ Mietzahlungen in Y − Σ Soll in Y.
   - Ein Test mit `rentDueDate` (E8): Fälligkeit der Januarmiete nie nach dem 10.01., alle Länder, 1995–2100.

## PR 2 (Stapel Nr. 6): `income.received` in `taxReport`

Hängt ab von: Nr. 3 (#281: Mietkonto liest dieselben Teile, `designatedMonth`) und Nr. 5 (#96 PR 2:
`Tenancy.relative`). Dateien: `shared/types.ts`, `server/src/calc.ts` (`taxReport`, Option `received`,
`tenancyCostModel` herausziehen), `server/testing/taxGolden.ts`, `server/testing/taxStock.ts`
(`withPaymentVariety`), `server/test/fixtures/tax-received-golden.json` (neu),
`server/test/calc-steuer-zufluss.test.ts` (neu), `server/test/invariant-steuer-zufluss.test.ts` (neu),
`shared/law/estg.ts` (`estg.short-period-days`).

1. **Test**: Issue-Beispiel über `taxReport` → `rentCents` 660.000, `allocationsCents` 220.000, Zeile 21
   15.000, `paidCents` 895.000. **Code**: E4.
2. **Tests** je Fall: Inklusivmiete (`inclusiveRentCents`), Pauschale (`flatRateCents`), Rückstand aus Vorjahr
   (`formerYearsCents` und `formerYearsAllocationsCents`), Überzahlung (`unallocatedCents`), Zehn-Tage vorwärts
   und `fromPrevious` im Folgejahr (dieselben Cent), `lateDecemberCents`, `possibleDeposits` (trifft / trifft
   nicht bei Betrag = Monatsmiete / trifft nicht, wenn die Zahlung einen Rückstand tilgt), Zahlung ohne Zeile im
   Mietkonto (Auszug 31.12.) in `byTenancy`, zwei Objekte (kein Übergreifen), Abrechnungszeitraum Mai–April (keine
   Änderung), abgeschlossene Abrechnung (keine Änderung), Mietverhältnis mit `relative` (Zeilen 19/22/23),
   `designatedMonth` verschiebt Teile zwischen Zeile 20 und 25, Rücklastschrift ergibt negative Zeile 25.
3. **Option `received: false`**: alle übrigen Felder gleich, `received` fehlt.
4. **Invarianten** über `taxStock` mit `withPaymentVariety`, je Objekt, Jahr, offen und abgeschlossen:
   - `rentCents + allocationsCents + formerYearsCents + Saldo Zeile 21 = paidCents − forwardCents + fromPreviousCents` (X9 b, E8).
   - Σ `byTenancy` = Felder; Σ `byUnit` = Felder; Σ `byTenancy` mit `relative` = `relatives`.
   - Ohne `Tenancy.relative` (oder alle `false`): `relatives` überall 0.
   - `fromPreviousCents(Y) = forwardCents(Y−1)`.
   - Ohne Rückstand, Überzahlung und Zahlung am Jahreswechsel: `rentCents + allocationsCents` = Soll des Jahres
     (Kaltmiete + Vorauszahlungen + Pauschale) und `formerYearsCents` = 0.
   - Alle anderen Felder des Berichts gleich mit und ohne `received` (`surplus*`, Werbungskosten, `cheapRent`).
   - **X9 (a)**: Je Mietverhältnis, Monat und Bestandteil ist das Getilgte im Mietkonto (`rentLedger`, alle
     Jahre) gleich der Summe der Teile aus `allocateRentPayments`.
5. **Prüfsummen**: `incomeFingerprint` nimmt `received` heraus (Kommentar); outflow.test.ts gegen
   `tax-golden.json` **unverändert grün** (das ist der Nachweis). Neue Referenz `tax-received-golden.json`
   erzeugen und im Commit begründen.
6. Rechtsregister: `estg.short-period-days` (10), Test im Register-Test, Lexikon-Eintrag „Zehn-Tage-Regel“ liest
   die Zahl daraus.
7. server/src/CLAUDE.md, Abschnitt „Steuer (Anlage V)“: Tilgung, Zeilen, Zehn-Tage-Regel mit Betrag; der Satz
   „Das Ist kommt nicht aus dem Mietkonto“ wird zu „Die Summe zählt jede Zahlung nach Datum; ihre Aufteilung
   kommt aus derselben Tilgung wie das Mietkonto (rentAllocation.ts)“.

## PR 3 (Stapel Nr. 7): Oberfläche, Hinweise, ZIP

Hängt ab von: Nr. 6. Dateien: `client/src/anlageV.ts` (Block `income`, Zeile 25), `client/src/taxView.ts`
(+ Test), `client/src/pages/Steuer.tsx` (+ Steuer.test.tsx), `server/src/taxReceipts.ts` (`incomeCsv`),
`server/src/index.ts` (ZIP), `server/test/taxReceipts.test.ts`, `server/test/api-belege.test.ts`,
`shared/glossary.ts`, `shared/guides.ts` (falls betroffen), `client/src/pages/Muster.tsx` (falls ein Baustein neu
ist), CHANGELOG.md.

1. **Vordrucke lesen**: Anlage V 2023 Seite 2 und 2024 amtlich (Formular-Management-System), H 11 EStH zur
   Miete. Ergebnis als Fundstellen in `anlageVLines(year).income`. Fehlt etwas, bleibt die Nummer weg.
2. **Test** anlageV/taxView: `anlageVLines(2025).income.formerYears` = Zeile 25 / Kz. 6; `settlementLine(2025)`
   liefert unverändert, was es heute liefert (aus der Tabelle gelesen); `(2026)` = null; 2023 nach Schritt 1.
   `incomeRows(report, year)`: ohne Angehörige 15/18, 20, 21, 25; mit Angehörigen dazu 19, 22, 23, und die Summe
   aller Zeilen = `paidCents`. **Code**: `incomeRows` neu.
3. **Test** taxView: Bedingungen der Hinweise `turnOfYear` (neu: nur mit Betrag), `unallocatedPayment`,
   `possibleDeposit`, `formerYears` (mit negativem Betrag eigener Satz); Texte mit Beträgen (Sätze als reine
   Funktionen wie `movedInText`).
4. **Test** Steuer.test.tsx: jede Zeile der Tabelle in beiden Grundlagen; Spalte „Zeile“ nur mit bekanntem
   Vordruck; Satz zum Vergleich Ist/Soll; „Mehr dazu“ mit dem Satz zur Abrechnungsreife; „Je Wohnung“ im Druck
   offen; Reihenfolge der Blöcke (Test aus #96 PR 1 erweitert); TAX_HINTS-Liste vollständig (vorhandener
   Komponententest verlangt je Hinweis eine Lage). Anrede-Wächter grün. **Code**: Tabelle mit zwei Spalten,
   `stacked`, `data-label`.
5. **Test** taxReceipts: `incomeCsv` Kopf, Zeilen, Summe, Euro-Format, BOM/CRLF; api-belege: ZIP enthält
   `Einnahmen.csv` und unverändert `Übersicht.csv`. **Code**.
6. Lexikon: „Tilgungsreihenfolge“ (Beispiel 300 € → 200/100, nachgerechnet; Fundstelle VIII ZR 84/17 Rn. 53/57),
   „Mieten für frühere Jahre“; „Zehn-Tage-Regel“ an E8 anpassen: Bei Mietverhältnissen nach § 556b BGB zählt die Ende
   Dezember gezahlte Januarmiete im Folgejahr, wenn sie in den zehn Tagen fällig war; bei Altverträgen (am 01.09.2001
   bestehend) und bei Kostenpositionen nennt Mietfuchs den Betrag nur. glossary.test.ts.
   **Aufgabe für PR 3 (Nachdurchsicht K3)**: Die festen Zehn-Tage-Texte der Oberfläche (etwa Steuer.tsx „bis zu zehn
   Tage“, Kosten.tsx „bis zehn Tage davor oder danach“, glossary.ts) aufs Register umstellen (`estg.short-period-days`,
   `valueAt(…, LAW_AS_OF)`).
7. CHANGELOG „Unveröffentlicht“: siehe Release-Plan (Wortlaut dort).
8. `npm run typecheck`, `npm test`, `npm run browser-check` (neue Tabelle am Handy), Bildschirmfotos, wenn die
   Steuerseite im README steht.

## Umfang

Rund 1.700–2.100 Zeilen mit Tests: PR 1 ≈ 280 Code + 550 Test, PR 2 ≈ 220 Code + 520 Test, PR 3 ≈ 300 Code +
350 Test. Kein Schemaschritt, kein eingefrorener Eingang, kein Umstieg betroffen.
