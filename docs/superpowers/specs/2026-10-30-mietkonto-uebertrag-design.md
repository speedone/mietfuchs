# Mietkonto: Übertrag und Tilgung nach § 366 BGB (#281)

Teil des Releases „Quellrechnung und Steuerjahr“ (0.14.0), im Stapel Nr. 3 (Release-Plan
`2026-10-30-release-0.14-plan.md`), direkt nach #312 PR 1, das die Tilgung als reine Funktion anlegt
(`server/src/rentAllocation.ts`, Entwurf `2026-10-30-steuer-zufluss-design.md`, E2/E3). **Dieser Entwurf baut keinen
zweiten Algorithmus**: Das Mietkonto liest dieselben Teile wie später die Steuer (#312 PR 2). Rechtsaussagen tragen
ihre Quelle; was nicht belegt ist, steht als **Auslegung** da.

## Leitsatz

Das Mietkonto rechnet **ab Beginn des Mietverhältnisses** und zeigt das gewählte Jahr mit **Anfangssaldo**. Jede
Mietzahlung tilgt nach § 366 BGB: Bestimmt der Mieter den Monat, gilt der; sonst zuerst alle offenen Vorauszahlungen,
älteste zuerst, dann die Kaltmiete und Pauschale, älteste zuerst (BGH VIII ZR 84/17 Rn. 56/57). Ein Rückstand aus dem
Dezember steht im Januar noch da; eine Dezemberzahlung für Januar deckt den Januar.

**Wer jeden Monat genau die Monatsmiete zahlt, sieht dieselben Zahlen wie heute** (Invariante). Wer Rückstände,
Teilzahlungen oder vorausbezahlte Monate hat, sieht ein anderes, richtigeres Mietkonto, und der Hinweis
`prepayment.arrears` in der Abrechnung nennt jetzt den offenen Betrag der Vorauszahlungen selbst. Das ist der Zweck
dieses Issues und verletzt „wer ein Haus vermietet, merkt nichts“ im wörtlichen Sinn; der CHANGELOG sagt es
ausdrücklich (Release-Plan). Zahlen der Abrechnung und der Steuer ändern sich nicht.

## Rechtslage

- **§ 366 Abs. 1 BGB**: Bestimmt der Schuldner bei der Zahlung, welche Schuld getilgt wird (Verwendungszweck „Miete
  März“), gilt das.
- **§ 366 Abs. 2 BGB analog auf die Bestandteile der Bruttomiete** (BGH, Urteil vom 21.03.2018, VIII ZR 68/17, BGHZ
  218, 139; Parallelentscheidung VIII ZR 84/17): maßgeblich ist die geringere Sicherheit, nicht eine anteilige
  Verrechnung; die Vorauszahlung ist unsicherer, weil sie „nach Eintritt der Abrechnungsreife oder erfolgter Abrechnung
  grundsätzlich nicht mehr geltend gemacht werden kann“ (VIII ZR 84/17 Rn. 53). Anrechnung stets auf die ältesten
  Rückstände (Rn. 54). Mit Bestimmung eines Zeitraums: zuerst dessen Vorauszahlung, dann dessen Nettomiete, ein
  Überschuss auf die ältesten Vorauszahlungen, dann die ältesten Nettomieten (Rn. 56). Ohne Bestimmung: in
  absteigendem Alter zuerst alle Vorauszahlungen, dann die Nettomieten (Rn. 57). Volltext über gesetze.co gelesen am
  30.10.2026.
- **Abrechnungsreife.** Die Abrechnung ist spätestens zwölf Monate nach Ende des Abrechnungszeitraums mitzuteilen
  (§ 556 Abs. 3 Satz 2 BGB); VIII ZR 84/17 knüpft die Abrechnungsreife an den Ablauf dieser Frist (Rn. 12, 15). Danach
  oder nach erteilter Abrechnung kann der Vermieter rückständige Vorauszahlungen grundsätzlich nicht mehr verlangen,
  nur noch den Saldo der Abrechnung (VIII ZR 84/17 Rn. 53 mit Verweis auf VIII ZR 68/17; ebenso nach
  Sekundärdarstellungen BGH, Urteil vom 09.03.2005, VIII ZR 57/04, NJW 2005, 1499, und für Gewerberaum BGH, Urteil
  vom 26.09.2012, XII ZR 112/10, beide nicht selbst gelesen). In die Abrechnung gehören die **tatsächlich geleisteten**
  Vorauszahlungen (BGH VIII ZR 240/10, Rn. 16; in Mietfuchs die Jahreskorrektur `prepaymentOverrides`). Rechnet eine
  Abrechnung das Soll als gezahlt an, fehlt der Rückstand im Saldo; ob er sich nach Ablauf der Frist noch durch eine
  berichtigte Abrechnung verlangen lässt, ist eine Frage des § 556 Abs. 3 Satz 3 BGB (Instanzrechtsprechung verneint
  das, etwa LG Aachen, 10.03.2016, 2 S 245/15, nicht selbst vollständig gelesen). **Mietfuchs entscheidet diese Frage
  nicht**, es nennt sie.
- **Pauschale** gehört zur sichereren Klasse (wird nie abgerechnet; Auslegung, #312 E2).

## Entscheidungen

### E1: Eine Tilgung, aus rentAllocation.ts

`ledgerRows` ruft je Mietverhältnis `allocateRentPayments(t, payments)` über **alle** Mietzahlungen des
Mietverhältnisses (der Schnappschuss führt sie vollständig, snapshot.ts) und liest Status und Salden nur über die
gemeinsamen Helfer `monthCoverage` und `openingBalance` (#312 E3). Keine zweite Status-Regel in calc.ts; `monthSoll`
liegt in shared/monthRate.ts. Gespeichert wird nur die Bestimmung des Mieters (E3). Der bisherige FIFO je Jahr entfällt
ersatzlos; der Übergang „bis #281 bleibt FIFO“ aus dem früheren #312-Entwurf ist gestrichen.

### E2: Jahr mit Anfangssaldo, Stand zum Jahresende

Für das Jahr Y (bzw. die Monate eines Abrechnungszeitraums beim Hinweis, E6):

- **Anfangssaldo** `openingBalanceCents = openingBalance(t, payments, Y-01-01)`: Σ Mietzahlungen vor dem 01.01. −
  Σ Soll aller Monate vor Januar. Negativ = Rückstand, positiv = vorausbezahlt. Ohne Mietverhältnis vor Y ist er 0, außer eine Zahlung ging vor Beginn ein (etwa am 28.12. für einen Mietbeginn im Januar); dann ist er positiv (Durchsicht von Stapel Nr. 2, M7).
- **Monat** (`RentMonth`): `paidCents` = Σ der Teile dieses Monats mit `paidOn` ≤ 31.12.Y (auch aus Vorjahren:
  eine Dezemberzahlung für Januar zählt im Januar); Status wie bisher `paid | partial | open | notDue`, nach
  `monthCoverage` (bezahlt = Σ Teile ≥ Soll), `notDue` nach `asOf` (#133, unverändert: Monate ab dem des Stichtags).
  Neu `paidLaterOn`: wurde ein zum 31.12.Y offener Monat später gedeckt, das Datum (nur Auskunft, „bezahlt am
  15.02.2026“). Neu je Monat `openPrepaymentCents` / `openRentCents`: offene A- bzw. B-Teile (für E5 und die Anzeige).
- **Endsaldo** `closingBalanceCents = openingBalanceCents + paidYearCents − sollYearCents`; Invariante: Endsaldo(Y) =
  Anfangssaldo(Y+1).
- **Unverändert** in Bedeutung und Namen: `sollYearCents` und Bestandteile, `paidYearCents` (Mietzahlungen mit Datum
  im Jahr, für den Abgleich mit dem Kontoauszug), `settlementYearCents`, `balanceCents` (Jahr allein, paid − soll).
  Die Steuer liest weiter nur das Soll aus dem Mietkonto.
- **`arrearsCents`** heißt jetzt: mahnfähiger Rückstand zum Stand der Ansicht, **über alle Jahre ab Beginn**: offene
  Teile fälliger Monate (bis 31.12.Y bzw. vor dem Monat von `asOf`), ohne die nach E5 nicht mehr einzeln einforderbaren
  Vorauszahlungen. Neu daneben `notDemandableCents` (E5). `openMonths` zählt fällige offene oder teilweise Monate des
  Jahres wie bisher. `dueSollCents` bleibt das Soll der fälligen Monate des Jahres.
- **Ein Mietverhältnis ohne Tag im Jahr, aber mit offenem Saldo**, bekommt keine Zeile (Zeile = Mietverhältnis des
  Jahres; `costModels` zählt Zeilen); sein Rückstand steht in einer eigenen Liste `carriedOnly` (wie `settlementOnly`,
  #280): „{Mieter}, ausgezogen am …: offen 800,00 €“. So verschwindet ein Rückstand eines Ausgezogenen nicht.

### E3: Bestimmung des Mieters (`designatedMonth`)

- Spalte `payments.designated_month` (Text `'JJJJ-MM'`, `null` = keine Bestimmung), Typ `Payment.designatedMonth?:
  string | null` in shared/types.ts (Server und Formular brauchen ihn).
- Erlaubt nur an Zahlungen der Art `rent` (an `settlement` 400: „Eine Zahlung aus der Abrechnung gilt dem Saldo,
  nicht einem Monat.“) und nur für einen Monat, an dem das Mietverhältnis besteht (sonst 400 mit dem Zeitraum des
  Mietverhältnisses). Ändern sich später Beginn oder Ende so, dass der Monat herausfällt, wird nicht abgelehnt
  (krumm, nicht kaputt): Die Tilgung behandelt ihn wie keine Bestimmung (#312 E2), und das Mietkonto nennt es
  (`designatedOutside`, Hinweis an der Zahlung).
- **Keine Vorbelegung**: Weder Kontoauszug-Import (#188) noch KI setzen das Feld; ein Verwendungszweck ist eine
  Erklärung des Mieters, die der Vermieter selbst liest. Eine stillschweigende Bestimmung (Dauerauftrag über genau
  die Monatsmiete) erkennt Mietfuchs nicht (Auslegung, #312 E2).
- **Oberfläche**: An der Zahlung im Mietkonto „Für Monat (laut Verwendungszweck)“ als `MonthField`, leer = „nach
  gesetzlicher Reihenfolge“. **Art und Monat sind ein Entwurf mit „Speichern“/„Verwerfen“** wie die übrigen
  Auswahlfelder (Kommentar in #281 aus #341); die Ausnahme der Art in client/src/saveOnChange.test.ts entfällt.
  Hilfe am Feld: „Nennt der Mieter in der Überweisung einen Monat, tragen Sie ihn hier ein. Sonst verteilt Mietfuchs
  die Zahlung nach § 366 BGB: zuerst offene Vorauszahlungen, dann die Miete, jeweils die ältesten zuerst.“

### E4: Anzeige im Mietkonto

- Je Mietverhältnis oben eine Zeile **„Übertrag aus {Y−1}“**: „Rückstand 800,00 €“ bzw. „vorausbezahlt 800,00 €“
  bzw. nichts bei 0.
- Monatszellen wie bisher (bezahlt, teilweise, offen, noch nicht fällig); ein teilweise bezahlter Monat nennt, was
  offen ist („offen: Vorauszahlung 0,00 €, Kaltmiete 200,00 €“), damit die Reihenfolge sichtbar ist. `paidLaterOn`
  als kleiner Zusatz. Nicht mehr einzeln einforderbare Vorauszahlungen nach E5.
- Zeilenende: **„Stand 31.12.{Y}“** (Endsaldo), darunter getrennt „davon Rückstand“ (`arrearsCents`) und „davon nicht
  mehr einzeln einforderbar“ (`notDemandableCents`), jeweils nur ≠ 0. `ledgerView.ts` entscheidet die Art der
  Zusammenfassung (heute `arrears`/`credit`/`paidSoFar`) künftig aus Endsaldo und `arrearsCents`.
- „Mehr dazu“: Tilgungsreihenfolge mit Beispiel (300 € auf 600 Kalt + 200 Vorauszahlung → 200 / 100) und Fundstelle
  VIII ZR 84/17 Rn. 56/57; Lexikon „Tilgungsreihenfolge“ (#312 PR 3 legt den Eintrag an, dieser PR verweist schon
  darauf; liegt er noch nicht vor, legt ihn dieser PR an und #312 PR 3 ergänzt ihn).
- Alle Texte siezen (anrede.test.ts). Am Handy `stacked` wie die übrigen Tabellen; Browserlauf.

### E5: Abrechnungsreife: offene Vorauszahlungen eines abgerechneten Zeitraums

**Entscheidung.** Die Tilgung bleibt unverändert (sie fragt nie nach „heute“, #312 E2). Das Mietkonto **klassifiziert**
offene A-Teile (Vorauszahlung, Heizvorauszahlung) eines Monats danach, ob ihre Abrechnung reif ist, **zeigt sie
weiter**, zählt sie aber **nicht in den mahnfähigen Rückstand** (`arrearsCents`), sondern in `notDemandableCents`.

**Wann reif** (je Monat und Bestandteil, über die Abrechnung, die ihn anrechnet):
- Kalte Vorauszahlung und Heizvorauszahlung ohne eigene Heizkostenabrechnung: der **Abrechnungszeitraum** des Objekts,
  in dem der Monat liegt (Zeiträume aus den Regeln des Objekts, `periodOfKey`).
- Heizvorauszahlung bei eigener Heizkostenabrechnung nach Weg d: die **Heizperiode** der Anlage (docs/heizung.md).
- Reif, wenn (a) die Abrechnung abgeschlossen ist und ein **Versanddatum** (`sentAt`) ≤ Stichtag trägt („erfolgte
  Abrechnung“; Auslegung: der Versand steht für den Zugang, den Mietfuchs nicht kennt), oder (b) der Stichtag nach
  der **Frist** liegt (`settlementDeadline`, Ende + 12 Monate, `bgb.deadline-months`). Stichtag ist `asOf` (heute),
  bei einer vergangenen Jahresansicht der 31.12.Y, wenn der früher liegt.
- Eine abgeschlossene Abrechnung ohne Versanddatum gilt nicht als erteilt; vor Fristablauf bleibt die Vorauszahlung
  einforderbar.

**Was die Anzeige sagt** (drei Gründe, `notDemandable[].reason`, je mit Zeitraum und Betrag):
1. `inStatement`: Abrechnung erteilt **und** sie rechnet für diesen Mieter höchstens die tatsächlich gezahlten
   Vorauszahlungen an (eingefrorene Anrechnung ≤ Soll − offene A-Teile des Zeitraums; also mit Jahreskorrektur). Satz:
   „In der Abrechnung {Zeitraum} enthalten: Die nicht gezahlte Vorauszahlung steckt im Saldo der Abrechnung; fordern
   Sie diesen, nicht die Vorauszahlung.“
2. `creditedAsPaid`: Abrechnung erteilt, rechnet aber mehr an als gezahlt (ohne Jahreskorrektur das Soll). Satz mit
   Differenz: „Die Abrechnung {Zeitraum} rechnet {X} € Vorauszahlung als gezahlt an, die nicht eingegangen sind.
   Einzeln verlangen lässt sich die Vorauszahlung nicht mehr. Ob eine berichtigte Abrechnung den Betrag noch
   einfordern kann, hängt an der Abrechnungsfrist (§ 556 Abs. 3 Satz 3 BGB); besprechen Sie das im Zweifel mit einer
   Beratung.“ Stufe Warnung im Mietkonto.
3. `deadlinePassed`: keine erteilte Abrechnung, Frist abgelaufen. Satz: „Die Abrechnungsfrist für {Zeitraum} ist
   abgelaufen. Die Vorauszahlung lässt sich nicht mehr einzeln verlangen, nur noch über die Abrechnung.“

**Darstellung**: In der Monatszelle bleibt der Status, was er nach den Zahlungen ist (offen bzw. teilweise), denn der
Abgleich mit dem Kontoauszug braucht die Wahrheit über Eingänge. Der nicht einforderbare Teil trägt eine eigene,
gedämpfte Kennzeichnung („Vorauszahlung: über die Abrechnung“) statt der roten des Rückstands; der Text steht in
einer Fußnote je Mietverhältnis mit dem Grund. Kaltmiete und Pauschale bleiben immer einforderbar (§ 195 BGB, drei
Jahre; Mietfuchs prüft Verjährung nicht).

**Begründung.** (1) Ausblenden wäre falsch: Das Geld ist nicht eingegangen; das Mietkonto ist auch Kontoabgleich, und
die Steuer (Zeile 15/20/25) liest dieselben Teile. (2) Als Rückstand zählen wäre falsch: Eine Mahnung (#281 nennt sie
als Folgenutzer) über eine nicht mehr geschuldete Vorauszahlung ist rechtlich angreifbar (VIII ZR 84/17 Rn. 53). (3)
„Erledigt“ allein wäre irreführend, wenn die Abrechnung das Soll angerechnet hat; dann ist der Betrag nicht im Saldo,
sondern womöglich verloren. Deshalb drei Gründe mit eigenem Satz, und nur der erste sagt „enthalten“. (4) Die
Tilgung bleibt unberührt, damit Mietkonto und Steuer reproduzierbar dieselben Teile haben.

**Bekannte Grenze** (Durchsicht, Befund 5; bewusst nicht geändert). Die Tilgung fragt nie nach Frist oder Versand. Eine
Zahlung nach Eintritt der Abrechnungsreife tilgt deshalb weiter zuerst die offenen Vorauszahlungen des abgerechneten
Zeitraums, obwohl der Vermieter sie nicht mehr einzeln verlangen kann (VIII ZR 84/17 Rn. 53). Szenario: Der Dezember
2024 ist offen (200 € Vorauszahlung, 600 € Kaltmiete), die Abrechnung 2024 ist im März 2025 erteilt, im April 2025 gehen
800 € ohne Verwendungszweck ein. Mietfuchs rechnet 200 € auf die Vorauszahlung Dezember 2024 an und 600 € auf die
Kaltmiete; rechtlich naheliegender wäre, die erloschene Vorauszahlung zu überspringen und 800 € auf Kaltmiete und
spätere Monate anzurechnen. So bleibt die Tilgung stichtagsunabhängig, und Mietkonto und Steuer haben reproduzierbar
dieselben Teile; die Anzeige ordnet den Betrag über die Abrechnungsreife ein, und wer den Monat kennt, trägt ihn an der
Zahlung ein (§ 366 Abs. 1 BGB).

**Datenquelle.** `rentLedger(snapshot, { asOf, statements })`: `statements` sind die Abrechnungen des Objekts (je
Zeitraum bzw. Heizperiode: Grenzen, Frist, `sentAt`, eingefrorene Anrechnung je Mietverhältnis), gelesen in index.ts
aus den Abschlusstabellen und der Berechnung der Zeiträume. calc.ts bleibt rein. Ohne `statements` (direkte Aufrufe in
Tests, Regression des Umstiegs) gibt es keine Klassifikation: Alles Offene ist Rückstand. Die Regression vergleicht
beide Bestände mit derselben Rechnung und bleibt grün.

### E6: Hinweis `prepayment.arrears` in der Abrechnung

Heute: `row.arrearsCents` über die Monate des Zeitraums (FIFO je Zeitraum), Satz „Ob die Vorauszahlung betroffen ist,
sehen Sie im Mietkonto“. Neu:

- **Betrag** = offene **A-Teile** der Monate des Zeitraums, die diese Abrechnung anrechnet (kalte Abrechnung:
  Vorauszahlung, und Heizvorauszahlung, wenn keine eigene Heizkostenabrechnung sie anrechnet), fällige Monate wie
  bisher (vor dem Monat von `asOf`). Getilgt durch alle Mietzahlungen bis heute, auch nach Ende des Zeitraums: Eine
  nachgezahlte Vorauszahlung ist geleistet.
- **Bedingungen** unverändert (Mietkonto in Gebrauch, Monate fällig, keine Jahreskorrektur, Vorauszahlung > 0).
  Ist nur Kaltmiete offen (A ganz gedeckt), **kein Hinweis** mehr: Die Vorauszahlung ist nach § 366 Abs. 2 BGB
  bezahlt, die Abrechnung rechnet richtig an.
- **Text** (präziser, ohne die Vermutung über Kaltmiete und Pauschale): „Von den Vorauszahlungen {Zeitraum} von
  {Mieter} ({Wohnung}) sind {X} nicht gezahlt; Zahlungen werden nach § 366 BGB zuerst auf die Vorauszahlungen
  angerechnet, die ältesten zuerst. Die Abrechnung rechnet die Vorauszahlung laut Vertrag an ({Soll}); maßgeblich ist,
  was tatsächlich gezahlt wurde. Fehlt nur eine Buchung, tragen Sie die Zahlung im Mietkonto nach; sonst tragen Sie
  bei „abzüglich geleisteter Vorauszahlungen“ mit „✎ anpassen“ {Soll − X} ein.“ Der Satz zur Dezembermiete im Vorjahr
  entfällt, denn der Übertrag macht ihn unnötig.
- **Folgen**: `noticeSamples.json` neu; calc-rueckstand, calc-zeitraum, calc-teilmonat, calc-zahlungsart anpassen;
  Abrechnungs-Goldens enthalten den Hinweis heute nicht (geprüft in der Durchsicht) und bleiben grün. **Eingefrorene
  Abschlüsse ändern sich nicht** (sie tragen ihre Hinweise). Sichtbare Änderung offener Abrechnungen → CHANGELOG.

### E7: Was sich nicht ändert

Abrechnung (Zahlen), Steuer (Soll und Summe des Ist), eingefrorene Abschlüsse, Jahreskorrektur
(`prepaymentOverrides`, geht nicht ins Monats-Soll, #70), Rechtsregister. `rentDueNote` (Auskunft „fällig am …“) bleibt.

## Daten

- **Migration** im Stapel **0078/0079** (Nummern beim Umstellen auf `main` mit `db:generate` neu erzeugt):
  `0078_bestimmung_monat`: `ALTER TABLE payments ADD designated_month text`; `0079_bestimmung_monat_bedingung`:
  CHECK `payments_designated_month_valid` (`designated_month IS NULL OR designated_month GLOB
  '[0-9][0-9][0-9][0-9]-[0-1][0-9]'`), Neubau der Tabelle durch drizzle-kit. Kein Datenschritt (alle `NULL`).
- **Eingefrorener Eingang, Validator, Umstieg**: unberührt (die db.json kennt das Feld nicht).
- **Backup/Wiederherstellen**: Spalte kommt mit dem Schnappschuss; älteres Backup → `NULL`. Rundlauf-Test.
- **Verlauf** (#318): Trigger entstehen beim Öffnen. **`FIELD_LABELS`** (client/src/journalView.ts):
  `designated_month: 'Für Monat (laut Verwendungszweck)'`. Dieser PR legt den Wächter in journalView.test.ts an:
  jede Spalte aus schema.ts hat eine Beschriftung oder steht mit Grund in einer Ausnahmeliste (die heutigen Lücken
  zuerst als Ausnahmen; die Liste darf nur kürzer werden). #96 PR 2 und #262 PR 1 erweitern ihn.
- **Rücksprung**: Setzen und Leeren des Monats über `PUT /api/payments/:id` ist eine Zeile; der Generator der
  Rücksprung-Invariante (server/testing/revertFlows.ts) setzt das Feld zufällig mit.

## Invarianten

- **Wie heute bei genauer Zahlung**: Zahlt jedes Mietverhältnis jeden Monat genau das Soll im Monat (Datum im Monat),
  sind Status, `paidCents`, `arrearsCents`, `openMonths` und `balanceCents` jeder Zeile gleich dem bisherigen
  Ergebnis (bisherige Funktion als Testorakel in server/testing behalten), Anfangssaldo 0.
- **Übertrag**: Endsaldo(Y) = Anfangssaldo(Y+1) für jedes Mietverhältnis und Jahr.
- **X9 (a)** (mit #312 PR 2): Je Mietverhältnis, Monat und Bestandteil: getilgt im Mietkonto = Σ Teile aus
  `allocateRentPayments`.
- **Summen**: Σ `paidCents` aller Monate ab Beginn (mit `paidOn` ≤ Stichtag) + Überzahlung = Σ Mietzahlungen bis
  Stichtag.
- **E5**: `arrearsCents + notDemandableCents` = Σ offener Teile fälliger Monate; ohne `statements` ist
  `notDemandableCents` 0. Kaltmiete und Pauschale sind nie in `notDemandableCents`.
- **Hinweis**: Betrag von `prepayment.arrears` = Σ offener A-Teile der Monate des Zeitraums; ohne offene A-Teile kein
  Hinweis.
- Abrechnung und Steuer centgenau unverändert (Zufallsbestände, `computeSettlement` und `taxReport` vor und nach).

## Umsetzung (ein PR, Stapel Nr. 3, TDD), Größe L

Hängt ab von: Nr. 2 (#312 PR 1). Commits mit `Refs #281`. ~500 Code + ~700 Test.

1. **Rot:** `server/test/calc-mietkonto-uebertrag.test.ts` (neu): beide Beispiele aus dem Issue (Dauerauftrag am
   28.12. deckt Januar; Dezember-Rückstand steht im Januar als Übertrag); Teilzahlung 300 € → Vorauszahlung zuerst;
   zwei offene Monate, dann eine Zahlung (Rn. 57); `designatedMonth` (Rn. 56); Auszug mit Rückstand → `carriedOnly`;
   `paidLaterOn`; Endsaldo = Anfangssaldo des Folgejahres.
2. **Rot:** E5 je Grund: erteilt mit Jahreskorrektur (`inStatement`), erteilt ohne (`creditedAsPaid`, Differenz),
   Frist abgelaufen ohne Abrechnung (`deadlinePassed`), abgeschlossen ohne Versanddatum (einforderbar), Weg d mit
   Heizperiode; Kaltmiete bleibt immer Rückstand; ohne `statements` keine Klassifikation.
3. **Rot:** `calc-rueckstand.test.ts` u. a.: neuer Betrag und Text von `prepayment.arrears`; kein Hinweis, wenn nur
   Kaltmiete offen ist; `noticeSamples.json` neu erzeugen und im Commit begründen.
4. **Rot:** Invarianten (oben) in `server/test/invariant-mietkonto.test.ts` (neu), Orakel des alten FIFO in
   server/testing.
5. **Rot:** Migrationstest 0078/0079; `api-zahlungen*.test.ts` (Datei des Themas): Monat setzen, leeren, 400 an
   `settlement`, 400 außerhalb des Mietverhältnisses; Backup-Rundlauf; journalView.test.ts (Wächter, Beschriftung).
6. **Rot:** Client: `ledgerView.test.ts` (Übertrag, Stand, Rückstand vs. nicht einforderbar, Gründe);
   jsdom Mietkonto: `MonthField` zeigt den gespeicherten Monat, Art und Monat als Entwurf mit Speichern/Verwerfen;
   saveOnChange.test.ts ohne Ausnahme.
7. Grün: rentAllocation-Verbraucher in calc.ts (`ledgerRows`, `rentLedger`, Hinweis), shared/types.ts
   (`RentMonth`, `RentLedgerRow`, `RentLedger.carriedOnly`, `Payment.designatedMonth`), schema.ts, repository.ts,
   index.ts (`statements` für `rentLedger`), ledgerView.ts, Seite Mietkonto, journalView.ts, glossary.ts.
8. server/src/CLAUDE.md „Mietkonto“ neu („Tilgung nach § 366 BGB aus rentAllocation.ts, fortlaufend ab Beginn,
   Abrechnungsreife nur Anzeige“); „Steuer“: „Das Ist kommt nicht aus dem Mietkonto“ bleibt bis #312 PR 2.
9. CHANGELOG (Wortlaut im Release-Plan). `npm run typecheck`, `npm test`, `npm run browser-check`.

## Quellen

- § 366, § 556 Abs. 3, § 556b Abs. 1 BGB.
- BGH, Urteil vom 21.03.2018, VIII ZR 68/17, BGHZ 218, 139.
- BGH, Urteil vom 21.03.2018, VIII ZR 84/17, Rn. 12, 15, 53, 54, 56, 57: https://gesetze.co/urteile/VIII_ZR_84-17
  (gelesen am 30.10.2026).
- BGH VIII ZR 240/10, Rn. 16 (geleistete Vorauszahlungen in die Abrechnung; schon in server/src/CLAUDE.md).
- Sekundär, nicht selbst gelesen: BGH, Urteil vom 09.03.2005, VIII ZR 57/04, NJW 2005, 1499; BGH, Urteil vom
  26.09.2012, XII ZR 112/10; LG Aachen, Urteil vom 10.03.2016, 2 S 245/15 (Bericht:
  https://www.anwaltonline.com/mietrecht/urteile/38329/kein-anspruch-auf-nicht-geleistete-betriebskostenvorauszahlungen-nach-ablauf-der-abrechnungsfrist).
- Issue #281 samt Kommentaren (#311 `rateInMonth`, #341 Entwurf der Zahlungsart), #280, #188, #312.

## Nachtrag aus der Durchsicht von Stapel Nr. 2 (I1)

- `SnapshotPayment` (server/src/snapshot.ts) bekommt `'id' | 'designatedMonth'`. `allocateRentPayments` braucht `id` als Nachrang beim Sortieren und zum Zusammenlegen der Teile (`paymentId`). Zur Laufzeit liegt die Kennung schon vor, im Typ fehlt sie.
- Testdaten des Mietkontos, die Zahlungen ohne `id` bauen (etwa vier Dateien `calc-*.test.ts` und `invariant-tilgung.test.ts`), bekommen eine `id`. Der Übersetzer verlangt sie dann.
