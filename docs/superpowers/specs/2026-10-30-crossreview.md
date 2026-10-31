# Durchsicht mit frischem Kontext: Entwürfe zu 0.14.0 „Quellrechnung und Steuerjahr“

Geprüft: `2026-10-30-steuer-zufluss-design.md` (#312), `2026-10-30-erhaltungsaufwand-verteilen-design.md` (#262),
`2026-10-30-steuer-objekt-ruecklage-design.md` (#96 Rest), dazu #478 und #281 (mit Kommentaren). Stand `main` 8fbce5f6,
nur gelesen. Code gegengelesen: calc.ts (`ledgerRows`, `rentLedger`, `taxReport`, Hinweis `prepayment.arrears`),
outflow.ts, db/periodChange.ts (`keepsTaxYear`), db/repository.ts (`requireTaxYear`), shared/paidOn.ts,
shared/costItem.ts, shared/monthRate.ts, snapshot.ts (`snapshotFor`), taxReceipts.ts, testing/taxGolden.ts,
client/src/costForm.ts, client/src/journalView.ts. Vordruck Anlage V 2025 und Anleitung 2024 als Text selbst gelesen.

Stufen: **Kritisch** = falsche Zahl, Ablehnung durch den Server oder Widerspruch zwischen Entwürfen, der beim Bauen
auffällt; **Wichtig** = sollte vor dem Bau im Entwurf stehen; **Klein** = beim Bau mitnehmen.

---

## 1. Übergreifend (alle Entwürfe, #478, #281)

### Kritisch

**X1. `requireTaxYear` lehnt heute jedes Jahr der Zahlung ≠ Startjahr in einem Kalenderzeitraum ab**
(server/src/db/repository.ts:1265–1268: „…zählt … deshalb zu {startYear}“). Folgen:
- **#478** kann den Fehler nicht allein in `keepsTaxYear` beheben: Die Vorschau „verschiebt über dieselbe
  Schreibprüfung wie beim Speichern“, und die lehnt das erhaltene Jahr im Kalenderzeitraum ab. #478 muss
  `requireTaxYear` für Zeiträume in einem Kalenderjahr lockern (Spanne wie `paidOnSpan`, Startjahr − 1 bis Endjahr + 3,
  oder enger Startjahr − 1 bis + 1; außerhalb Rückfrage wie bei `paidOn`), und das Formular muss ein gespeichertes
  abweichendes Jahr auch im Kalenderzeitraum zeigen (heute nur bei Zeitraum über zwei Jahre, `taxYearOptions`).
- **#96 A3** (Entnahme: Datum → `taxYear`, „sofern es vom Jahr des Zeitraums abweicht“) und der Test „`taxYear: 2026`
  legt sie nach 2026“ scheitern sonst mit 400 im Kalenderzeitraum, also im Regelfall der Eigentumswohnung.
- **Folge für die Reihenfolge**: #478 vor #96 PR 1. Der #96-Entwurf sagt „#478 vor oder mit A … ohne #478 ist A
  trotzdem richtig“; das stimmt nur für Entnahmen ohne Umstellung einer datierten Position.

**X2. „Keine zwei Wahrheiten“ zwischen Mietkonto und Steuer ist im #312-Entwurf noch als Übergang angelegt** (E3:
„Bis #281 bleibt `rentLedger` unverändert … bewusst zweierlei für die Dauer eines Releases“). Mit #281 im selben
Release muss der Entwurf das streichen: `rentAllocation.ts` (PR 1 von #312) ist die Grundlage beider, #281 stellt
`ledgerRows` darauf um, bevor die Steuer die Teile liest (siehe Reihenfolge). Was #281 dafür von E2/E3 braucht, steht in
Abschnitt 2 („Trägt der #312-Entwurf #281?“).

**X3. Sonderumlage: zwei Entwürfe, zwei Jahre.** #262 E-10: „Sonderumlage für eine Erhaltungsmaßnahme, erfasst als
‚Nicht umlagefähig‘: verteilbar, ab dem Jahr ihrer Zahlung.“ #96 R5: „Die Zahlung des Eigentümers an die Gemeinschaft
ist in keinem Fall das maßgebliche Datum“ (erst bei Verausgabung, FG Niedersachsen; gleiche Begründung wie IX R 19/24).
#96 hat recht. **Fix** in #262 E-10: Die Sonderumlage zählt im Jahr der Verausgabung durch die Gemeinschaft; erfasst wird
sie als „Entnahme Erhaltungsrücklage“ bzw. ihr Anteil laut Jahresabrechnung (ohne Datum), und erst dieser Anteil ist
verteilbar. Den Hinweis `specialLevySuspects` (#96 A4.3) gibt es dann auch bei einer Wahl nach § 82b an einer
„Nicht umlagefähig“-Position mit „Sonderumlage“ im Text.

### Wichtig

**X4. Gemeinsame Dateien.** Alle drei ändern `shared/types.ts` (`TaxReport`), `server/src/calc.ts` (`taxReport`),
`server/testing/taxGolden.ts`, `client/src/taxView.ts` (TAX_HINTS, Zeilentabellen), `client/src/pages/Steuer.tsx`,
`server/src/taxReceipts.ts`, `shared/glossary.ts`, `shared/guides.ts`, server/src/CLAUDE.md („Steuer“, „Jahr des
Abflusses“), CHANGELOG (union-Merge). #281 ändert zusätzlich `ledgerRows`/`rentLedger`, den Hinweis
`prepayment.arrears`, Mietkonto-Seite. Nur ein linearer Stapel hält das beherrschbar (Abschnitt 5).

**X5. Zeilennummern an zwei Orten.** #312 erweitert `settlementLine` (taxView.ts) um Zeile 25, #96 legt
`anlageVLines` (client/src/anlageV.ts) für Kopf und Werbungskosten an, #262 nennt „keine Zeilennummern, nicht geprüft“
— obwohl #96 die Zeilen 57–72 am Vordruck 2025 belegt hat (selbst nachgelesen, siehe Tabelle). Drei Entwürfe, drei
Haltungen. **Fix**: `anlageVLines(year)` wird die eine Tabelle mit Fundstelle je Jahr; sie bekommt einen Block
`income` (13/14, 15, 18, 19, 20, 21, 22, 23, 24, 25 mit Kennzahlen) und `settlementLine(year)` wird ein dünner Leser
darauf (Name bleibt, damit nichts umbenannt wird; #96 A5 ist damit erfüllt). #262 liest `maintenance.spread`
und `spreadFromPriorYears` von dort. Das ist nicht das Zusammenführen von #194 (Ausfüllhilfe), sondern nur eine
Datenquelle; ohne sie wachsen im selben Release zwei Jahrestabellen mit getrennten Quellenwächtern.
Dazu: `spreadFromPriorYears: [61, 72]` als Bereich ist zu grob. Der Vordruck 2025 hat **je Ursprungsjahr drei Zeilen**
(2021: 61/62/63, 2022: 64/65/66, 2023: 67/68/69, 2024: 70/71/72; je direkt, verhältnismäßig mit „Gesamtbetrag“ und
„abzugsfähiger Anteil“, Summe mit Kz. 39–42). Abbilden als `{ fromYear, direct, proportional, sum }[]`.

**X6. Ein Hinweis zu anschaffungsnahen Herstellungskosten, nicht zwei.** #262 `spreadAcquisition` (immer bei Beginn
einer Verteilung) und #96 A4.4 (nur mit Datum am Objekt, in den drei Jahren nach Übergang). **Fix**: ein Code
(`acquisitionRelated`, § 6 Abs. 1 Nr. 1a EStG), in #96 PR 1/2 angelegt; Bedingung: Datum bekannt → nur innerhalb der
drei Jahre, mit Verteilung oder Erhaltungsgruppe; Datum unbekannt → nur bei Beginn einer Verteilung. Ein Lexikonbegriff
„Anschaffungsnahe Herstellungskosten“, auf den `spread82b` und „Erhaltungsrücklage“ verweisen.

**X7. Hinweis „Zeile 55/56“ für die Gruppe „Erhaltungsaufwand“ (#96 A4.1) ist mit § 82b falsch**, sobald eine Entnahme
verteilt wird: dann Zeilen 57–60 im ersten und 61–72 in den Folgejahren. Der Satz nennt 55/56 nur für unverteilte
Positionen; verteilte stehen im Block aus #262.

**X8. Migrationen.** Beansprucht: #262 `0078/0079`, #96 `0078` (+ zweiter Schritt), #281 `designated_month`
(+ Bedingung), #478 keine (kein Datenschritt möglich: das überschriebene Jahr ist verloren; das in CHANGELOG/Release-
Kommentar sagen). Nummern beim Umstellen auf `main` neu erzeugen. In der Reihenfolge aus Abschnitt 5:
0078/0079 #281, 0080/0081 #96 PR 2, 0082/0083 #262 PR 1. Jeder neue Spaltenname braucht ein Feld in
`FIELD_LABELS` (client/src/journalView.ts), sonst zeigt der Verlauf `ground_tax_file_number`; #96 sagt „Journal braucht
nichts“, das stimmt nur für Trigger, nicht für die Beschriftung. Dasselbe für `designated_month` (#281).

**X9. Kreuz-Invariante für die Integrationsdurchsicht.** Neu, über Zufallsbestände: (a) Mietkonto und Steuer lesen
dieselben Teile (Σ je Monat und Bestandteil im Mietkonto = Σ der Teile aus `allocateRentPayments`); (b)
Zeile 15/18 + 19 + 20 + 22 + 21 + 23 + 25 = `paidCents` je Objekt und Jahr; (c) Gesamtsicht = Σ Einzelberichte,
auch mit Verteilung (`deductibleCents` nach Raten) und mit `received`; (d) Entnahme auf „Nicht umlagefähig“
umgestellt und verteilt = unverteilt über alle Jahre (I1 von #96 × I-1 von #262).

### Klein

- **X10.** Gesamtsicht (#96 C) und #262 E-6 rufen `taxReportFor` mehrfach je Objekt (Folgejahre einer Verteilung bis zu
  vier Vorjahre, plus `foreignHeatQuota`). Mit #312 rechnet jeder Aufruf die Tilgung. Option `{ income: false }` für
  den Rückgriff auf Y0 in #262 oder Zwischenspeicher je Anfrage.
- **X11.** Namen: `costModels.relatives` (#96, eine **Anzahl**) und `received.relatives` (#312, **Cent**). Umbenennen in
  `costModels.relativeTenancies`.

---

## 2. #312 Zufluss nach Zeilen (steuer-zufluss-design.md)

### Trägt der Entwurf #281? (Auftrag des Leads)

Grundsätzlich ja: reine Funktion, fortlaufendes Konto ab Beginn, `designatedMonth` als einzige gespeicherte Angabe,
Rechnung nach BGH VIII ZR 84/17 Rn. 57 (siehe Tabelle) — genau der Vorschlag in #281. Der Schnappschuss führt alle
Mietverhältnisse und Zahlungen des Objekts (snapshot.ts, „wie immer vollständig“), das fortlaufende Konto ist also ohne
neue Datenquelle möglich. Was geändert werden muss:

1. **Kritisch: Importzyklus.** E3/PR 1 ziehen `monthSoll` „aus `ledgerRows` heraus“ in calc.ts; `rentAllocation.ts`
   importiert es, und calc.ts (`taxReport`, ab #281 `ledgerRows`) importiert `allocateRentPayments`. Das ist ein
   ESM-Zyklus calc.ts ↔ rentAllocation.ts. **Fix**: `monthSoll` nach `shared/monthRate.ts` (dort liegen schon
   `rateInMonth`, `monthShare`) oder in rentAllocation.ts; calc.ts importiert nur.
2. **Kritisch: E3-Übergang streichen** (X2). Stattdessen: „#281 stellt `ledgerRows` im selben Release um; die Steuer
   liest die Teile erst, wenn das Mietkonto es auch tut“ (Reihenfolge: #312 PR 1 → #281 → #312 PR 2).
3. **Wichtig: Was das Mietkonto aus den Teilen braucht, fehlt im Ausgabetyp.** `AllocationSlice` reicht für Status je
   Monat (bezahlt = Σ Teile ≥ Soll), aber #281 braucht zusätzlich: Anfangssaldo zum 01.01. (= Σ Soll fälliger Monate
   < Y − Σ Teile mit `month` < Y und `paidOn` < Y, plus vorausbezahlte Teile `month` ≥ Y mit `paidOn` < Y);
   `notDue` nach `asOf` (bleibt im Mietkonto, die Tilgung kennt kein „heute“: richtig so). In E3 eine kleine
   Hilfsfunktion `monthCoverage(slices, t, months)` festlegen, die beide nutzen, sonst rechnet #281 die Status-Regel
   ein zweites Mal.
4. **Wichtig: Abrechnung liest `ledgerRows` mit.** Der Hinweis `prepayment.arrears` (calc.ts ~8455) nimmt
   `row.arrearsCents` über die Monate des Zeitraums. Mit #281 wird er anders: Ein Vorjahresrückstand wird zuerst
   getilgt (Vorauszahlung vor Kaltmiete, ältere zuerst), dadurch können Vorauszahlungen im Zeitraum offen erscheinen,
   die bei FIFO je Jahr gedeckt waren. Rechtlich richtig, aber eine sichtbare Änderung in Abrechnungen. #281 muss
   entscheiden und testen: offene **A-Teile** der Monate des Zeitraums als Betrag des Hinweises (jetzt bezifferbar, der
   Satz „Ob die Vorauszahlung betroffen ist, sehen Sie im Mietkonto“ kann präziser werden). Folgen:
   `noticeSamples.json` neu, calc-rueckstand/calc-zeitraum/calc-teilmonat/calc-zahlungsart anpassen; Goldens der
   Abrechnung enthalten den Hinweis heute nicht (geprüft: kein `expected.json` mit „Im Mietkonto“), bleiben also grün.
   Eingefrorene Abschlüsse ändern sich nicht.
5. **Wichtig: Status je Monat ändert sich bei Teilzahlungen** (FIFO füllt Monat für Monat, § 366 erst alle A-Teile).
   Die Zusage aus #281 „Für Bestände, in denen jedes Jahr für sich aufgeht, ändert sich keine Zahl“ als Invariante
   aufnehmen: jeder Monat genau bezahlt → Teile = Soll, Status wie heute.
6. **Wichtig: Grenze „Abrechnungsreife“** (E2 letzter Absatz) wirkt im Mietkonto stärker als in der Steuer: Nach
   Abrechnungsreife darf der Vermieter offene Vorauszahlungen nicht mehr verlangen (BGH, ständige Rspr.; in VIII ZR 84/17
   als Grund der geringeren Sicherheit genannt). Das Mietkonto zeigte sie weiter als Rückstand, also eine Mahnung über
   einen nicht mehr geschuldeten Betrag (#281 nennt Mahnung als Folgenutzer). Mindestens Hinweis im Mietkonto, wenn
   offene A-Teile eines abgeschlossenen und versandten Zeitraums bestehen; der Saldo der Abrechnung ist dann die
   Forderung. In #281 als Entscheidung aufnehmen, in #312 bleibt es eine bekannte Grenze.
7. **Klein**: Die Art einer Zahlung speichert noch beim Anklicken (Ausnahme in saveOnChange.test.ts) — mit #281 als
   Entwurf, wie im Kommentar zu #281 zugesagt; das Feld `designatedMonth` gleich als `MonthField` im selben Entwurf.

### Weitere Befunde #312

- **Wichtig (E8)**: Die Vorwärtsprüfung ruft `rentDueDate(Januar, state)`. Der Schnappschuss trägt kein Bundesland
  (`snapshot.property` hat nur `kind`, Kabel, Mietpreisbremse), und E3 sagt „fragt nie nach dem Bundesland“. Da § 556b
  höchstens auf den 07.01. führt, ist die Prüfung immer wahr. **Fix**: Bedingung ohne `rentDueDate`, Kommentar mit dem
  Grund (dritter Werktag ≤ 07.01.); kein Durchreichen des Landes.
- **Wichtig (E2 Schritt 5, Rücklastschrift)**: LIFO über alle Zuordnungen nimmt nicht die Zuordnung der
  zurückgebuchten Zahlung zurück, sondern die jüngste. Über den Jahreswechsel verschiebt das Teile zwischen Zeile 15/20
  und 25 (Beispiel: Rücklastschrift im Januar Y+1 einer Novemberzahlung, jüngste Zuordnung ist die vorausbezahlte
  Januarmiete). Ohne Verweis der Rücklastschrift auf ihre Zahlung ist LIFO vertretbar; als **Auslegung** kennzeichnen
  und in der Seite eine negative Zeile 25 erklären (der Vordruck nennt dort kein Minus).
- **Wichtig (Zeile 25 brutto, E4)**: Auslegung tragfähig (Vordruck sagt bei 25 nicht „ohne Umlagen“; Anleitung 2024
  nennt bei 25 nur die verrechnete Kaution). Aber: Ein im Jahr Y gezahlter Rückstand an **Vorauszahlungen** eines
  bereits abgerechneten Vorjahres ist wirtschaftlich Teil der Abrechnung (Zeile 21), nicht Miete. Mit Punkt 6 oben
  zusammen in „Mehr dazu“ nennen; keine Rechnungsänderung.
- **Klein (E9)**: `possibleDeposit` „Betrag = `depositCents` und ≠ Monats-Soll“ — gut. Zusätzlich nur, wenn die Zahlung
  keinen Rückstand tilgt (sonst falscher Verdacht bei Mieter, der mit Kautionsbetrag gleich zwei Monate nachzahlt).
- **Klein (Oberfläche)**: Spalte „vereinbart“ für Zeile 25 und 21 „–“ ist richtig; für Laien ein Satz unter der
  Tabelle, warum Ist und Soll nur in der Summe vergleichbar sind. Option „Zeile“ nur mit bekanntem Vordruck: gut.
- **Klein**: `byUnit.areaM2` ist die Fläche der Einheit; Zeile 13/14 fragt die Wohnfläche „der Wohneinheit“ — bei
  angebrochenem Jahr/Mieterwechsel trotzdem eine Zeile je Einheit, nicht je Mietverhältnis: so steht es da, gut.
- **Golden**: `incomeFingerprint` nimmt `received` unbedingt heraus; `taxAmounts` nutzt dieselbe Funktion — passt.
  Kein anderer Entwurf fügt `income` ein Feld hinzu (#96 sagt es ausdrücklich). `tax-golden.json` bleibt.

---

## 3. #262 § 82b EStDV (erhaltungsaufwand-verteilen-design.md)

### Kritisch

**V1. Kürzung bei verbilligter Vermietung vor dem Verteilen widerspricht dem Vordruck** (E-3, E-4, I-1). Anleitung
Anlage V 2024 (selbst gelesen, Seite 7 unten): „Im Falle einer verbilligten Vermietung zu Wohnzwecken tragen Sie bitte
die Aufwendungen in die Zeilen 33 bis 84 **in voller Höhe** ein. Hinsichtlich der vorzunehmenden Kürzung der
Werbungskosten nutzen Sie bitte **ausschließlich die Zeilen 87 und 88**.“ Die Raten in 57–72 sind also ungekürzt (nur um
den privaten Anteil gemindert, über „abzugsfähiger Anteil (in %)“); gekürzt wird in Zeile 87/88 **mit der Quote des
Jahres, in dem die Rate abgezogen wird**, weil 87/88 die Summe der Werbungskosten dieses Jahres kürzt. Der Entwurf
verteilt D nach der Kürzung mit der Quote von Y0 und lässt die Folgejahre ungekürzt — bei wechselnder Quote (Mieterwechsel,
Mieterhöhung) eine andere Zahl als nach dem Vordruck. **Fix**: D = Betrag − privat (ohne `gratuitousCents`); verteilt
wird D; jede Rate (auch die abgeleitete Zeile im Folgejahr) wird im Jahr ihres Abzugs wie jede Position mit der Quote
dieses Jahres gekürzt (`cheapRentOf`, Gewicht nach Fläche). I-1 dann: Σ Jahre `deductibleCents + gratuitousCents`
gleich ohne Verteilung; Σ `gratuitousCents` allein nicht mehr. Die Auslegung im Rechenweg entfällt (es gibt eine Fundstelle).

### Wichtig

- **V2. Zeilen 57/59 brauchen den Bruttoanteil.** Zeile 57 fragt „Gesamtaufwand 2025 / davon 2025 abzuziehen“, 58/59 den
  Anteil des Jahres mit „Gesamtbetrag“ und „abzugsfähiger Anteil (in %)“, 61–72 je Ursprungsjahr ebenso. `TaxSpread`
  liefert `rateCents` vom abziehbaren Teil, nicht die Bruttorate. **Fix**: `grossRateCents` (= `spreadRates(Betrag, N)`
  im Jahr) neben `rateCents` und `deductiblePercent`; die Seite zeigt die Werte in der Reihenfolge des Vordrucks. Sonst
  rechnet der Laie zurück.
- **V3. Zeilennummern sind belegt** (X5): `anlageVLines(2025).maintenance` aus #96 lesen, Satz „nicht geprüft“ aus dem
  Entwurf streichen; 2024 laut Anleitung „Zeile 57 bis 60“ ebenso (selbst gelesen).
- **V4. Entnahme verteilbar** (#96 A1 „muss möglich werden“): `allowsSpread` nimmt „Entnahme Erhaltungsrücklage“ von
  Anfang an auf, wenn #96 PR 1 vorher gemergt ist (Abschnitt 5). E-10 „Ist die Verwendung eine abgeleitete Zeile …“
  entfällt: #96 hat sich für eine Kostenart entschieden.
- **V5. Entscheidungen des Leads eintragen**: U-1 (kein Einfrieren), U-2 (eine Wahl je Rechnung), U-3 (§§ 11a/11b
  draußen), U-4 (Abs. 2 im Release, PR 4). Abschnitt „Echte Entscheidungen“ in „Entschieden“ umschreiben.
- **V6. Abs. 2 „Schenkung“ ist Auslegung.** § 82b Abs. 2 nennt Veräußerung, Einlage ins Betriebsvermögen, Ende der
  Einkunftserzielung; Tod ist durch BFH IX R 31/19 gleichgestellt (bestätigt). Die unentgeltliche Übertragung zu
  Lebzeiten folgt aus „nicht mehr zur Einkunftserzielung genutzt“ beim Schenker — vertretbar, aber als **Auslegung**
  kennzeichnen. IX R 22/17 betrifft den **Nießbraucher** (Rest nicht auf den Eigentümer übertragbar): „Rechtsnachfolge“
  allgemein ist zu weit formuliert.
- **V7. Feld am Objekt verständlich benennen**: statt „Rest abziehen im Jahr“ etwa „Verkauft, verschenkt, vererbt oder
  Vermietung beendet im Jahr“ mit dem Satz aus E-7 als Hinweis. Journal-Beschriftung entsprechend.

### Klein

- E-6: `taxReportFor(Y0, { carried: false })` rechnet mit #312 auch die Tilgung (X10).
- E-9 Optionstext „nicht verteilen (ganz im Jahr der Zahlung)“ ist lang für ein Auswahlfeld (Browserlauf misst
  `clippedFields`); kürzer „nicht verteilen“, Rest als Hinweis am Feld.
- E-8 `spreadConditions` „überwiegend Wohnzwecke“: Mietfuchs kennt Fläche und Nutzung der Einheiten (Wohnfläche, Eigen-
  nutzung); eine Garage-/Gewerbeart an der Einheit fehlt (#163 F3). Warnung bei `kind: 'sonstiges'` ist das Richtige.
- Die Wache „`spreadYears` nur über `deductionPlan`“ muss `shared/spread.ts` und die Gesamtsicht (#96 C) zulassen.

---

## 4. #96 Rest (steuer-objekt-ruecklage-design.md)

### Kritisch

- **R-A. A3 hängt an X1** (`requireTaxYear`). Ohne #478 lehnt der Server das übertragene Jahr im Kalenderzeitraum ab.
- **R-B. `allowsPaidOn` = false für beide Rücklagen-Kostenarten** wirkt auch in `costItemBody` (shared/costItem.ts:184:
  `paidOn: allowsPaidOn(...) ? … : null`) — dort wird das Datum **still** geleert, bevor der Server es sieht. A3 will
  „nicht still geleert“. **Fix**: Der Übertrag Datum → `taxYear` (A3, Formular) läuft vor `costItemBody`, mit Test,
  dass beim Umstellen auf Entnahme `taxYear` gesetzt ist, wenn das Datumsjahr abweicht. Und eine bestehende Zuführung
  mit Datum (über die API gesetzt): Das Formular blendet `paidOn` für die Zuführung schon heute aus und schickt
  `null` — das nächste Speichern leert also still. Das ist für die Zuführung unschädlich (keine Werbungskosten), verschiebt
  aber `reserveContributionCents` zwischen Jahren; im Entwurf so sagen statt „verlangt, es zu entfernen“ (das sähe der
  Nutzer nie, weil das Feld fehlt).

### Wichtig

- **R-C. Gesamtsicht: „keine Anlage V (nicht vermietet)“ ist bei Leerstand mit Vermietungsabsicht falsch.** Auch ohne
  Mietverhältnis und Zufluss sind Werbungskosten abziehbar, und die Anlage V ist abzugeben. `hasRental` = Mietverhältnis
  im Jahr **oder** Zufluss ≠ 0 **oder** abziehbare Werbungskosten ≠ 0; der Text bei „nein“ neutral („keine Einnahmen
  und keine Werbungskosten in {Jahr}“), ohne Aussage über die Pflicht zur Anlage.
- **R-D. Gesamtsicht summiert auch `received`** (#312) und den abziehbaren Teil nach Verteilung (#262); deshalb als
  letzter PR des Releases (Abschnitt 5) und Test „Summe = Summe der Einzelberichte“ mit Verteilung und mit Angehörigen.
- **R-E. Hinweis A4.1 bei Verteilung** (X7). **A4.4 und `spreadAcquisition`** zusammenlegen (X6).
- **R-F. B3 „Angehörige … Satz ohne Betrag“ bis #312**: Der Lead hat entschieden, `Tenancy.relative` mit #312
  auszuliefern. Dann gibt es den Zwischenzustand nicht, wenn PR 2 (#96) direkt vor #312 PR 2 liegt und #312 PR 2
  `relatives` gleich rechnet. Den „Folgeschritt nach #312“ streichen; Z. 10 Kz. 62 und Z. 19/22/23 erscheinen zusammen.
- **R-G. Jahr der Entnahme für Laien.** Die Beschriftung „Jahr, in dem die Gemeinschaft bezahlt hat“ setzt Wissen voraus,
  das der Eigentümer nicht hat. Ergänzen: „steht in der Hausgeldabrechnung dieses Jahres (Entnahmen aus der
  Erhaltungsrücklage); ohne Angabe gilt das Jahr der Abrechnung“. Das ist zugleich die Vorgabe (R4).
- **R-H. Prompt-Änderung** (extract.ts): Label `ai-eval` steht im Plan, gut. Die neue Kostenart auch in
  `meterTypeOptions`/`costKeyOptions`-gespeiste Selects? Kostenarten kommen aus `CATEGORIES` — jsdom-Test „angezeigter
  Wert = gespeicherter“ für die neue Kostenart ist im Plan (Schritt 5): gut.

### Klein

- B2 Migration: Spalten und Bedingungen in zwei Schritten — steht so da. `relative` als INTEGER mit CHECK (0/1/NULL).
- B2 Aktenzeichen ≤ 40 Zeichen; `fileNumberDigits` als Anzeige — gut, Grundsteuer-Aktenzeichen haben je Land
  verschiedene Formate.
- A2 `unstatedCount` (calc.ts:1744) zählt heute die Zuführung als „ohne Datum“, obwohl das Formular kein Datum anbietet;
  mit `allowsPaidOn` = false fällt sie heraus — eine kleine, gewollte Änderung einer angezeigten Zahl, im CHANGELOG
  nicht nötig, im PR nennen.
- R4 zitiert BGH V ZR 96/24 (11.04.2025) zur Abrechnungsspitze; nicht unabhängig geprüft (für die Rechnung ohne
  Bedeutung, nur Begründung).

---

## 5. #478 und #281 im Release

- **#478** (S, ~250–400 Zeilen mit Tests): `keepsTaxYear` um `taxYear !== undefined` erweitern; `requireTaxYear` für
  Kalenderzeiträume lockern (X1) mit Rückfrage außerhalb der üblichen Spanne; Vorschau nennt jede Verschiebung zwischen
  Steuerjahren (auch für ein erhaltenes Jahr: `shiftNotes`); Hin- und Zurückwechseln-Test (periodChangeFlows.ts);
  Formular zeigt ein gespeichertes abweichendes Jahr auch im Kalenderzeitraum. Golden: `tax-golden.json` sollte
  unverändert bleiben (der Generator wechselt keinen Zeitraum); period-golden prüfen. Kein Datenschritt möglich, im
  Release-Kommentar: „Wer seit 0.12 den Zeitraum gewechselt hat, prüft das Jahr der Zahlung von Positionen ohne Datum.“
- **#281** (L, ~1.000–1.400 Zeilen mit Tests): `ledgerRows` auf `allocateRentPayments`, Anfangssaldo, Status je Monat,
  `designatedMonth` (Migration), Art und Monat als Entwurf, `prepayment.arrears` aus A-Teilen, Hinweis bei offener
  Vorauszahlung nach Abrechnungsreife (Punkt 6 in Abschnitt 2), CLAUDE.md „Mietkonto“ und „Steuer“ („Das Ist kommt
  nicht aus dem Mietkonto“ umformulieren: Summe weiter nach Datum, Aufteilung aus derselben Tilgung).

---

## 6. Rechtliche Prüfung

| Aussage (Entwurf) | Ergebnis | Quelle |
|---|---|---|
| BGH 21.03.2018 VIII ZR 68/17: § 366 Abs. 2 analog auf Bestandteile der Bruttomiete, Vorauszahlung vor Nettomiete (#312 E2) | **bestätigt**, mit Präzisierung: VIII ZR 68/17 ist die Leitentscheidung (BGHZ 218, 139; NJW 2018, 3448); die Reihenfolge über mehrere Monate (erst alle Vorauszahlungen, dann Nettomieten, je älteste zuerst) steht ausdrücklich in der Parallelentscheidung **VIII ZR 84/17, Rn. 57**; Rn. 39/47 Analogie; „unsicherster Anteil der Bruttomiete“. Im Code die Rn. von 84/17 zitieren | dejure.org (VIII ZR 84/17, Verweis auf 68/17); deutschesmietrecht.de |
| Pauschale gehört zu Klasse B (#312) | **Auslegung, tragfähig**: Die Begründung des BGH (nach Abrechnungsreife nicht mehr verlangbar) trifft die Pauschale nicht | wie oben |
| § 11 Abs. 1 S. 2 EStG, 10 Tage, Zahlung **und** Fälligkeit im Zeitraum (#312 E8) | **bestätigt**: H 11 EStH „kurze Zeit“ bis 10 Tage (BFH IV R 309/84); kumulativ fällig und gezahlt: BFH X R 2/21 (16.02.2022, BStBl II 2022, 448); Miete gilt als regelmäßig wiederkehrend (Literatur; H 11-Wortlaut nicht selbst gelesen, wie der Entwurf sagt) | nwb-experten-blog; steuerschroeder.de H 11 |
| Dezembermiete im Januar: Regel greift bei § 556b nicht (#312 E8) | **bestätigt** (Fälligkeit Anfang Dezember, außerhalb der 10 Tage) | § 556b Abs. 1 BGB; X R 2/21 |
| § 82b Abs. 1 (2–5 Jahre, überwiegend Wohnzwecke, Garagen), Abs. 2 (Veräußerung, Betriebsvermögen, keine Einkunftserzielung), Abs. 3 (Miteigentümer) (#262) | **bestätigt**, Wortlaut | gesetze-im-internet.de/estdv_1955/__82b.html |
| BFH IX R 31/19 (10.11.2020): Rest im Todesjahr beim Erblasser, R 21.1 Abs. 6 EStR überholt (#262) | **bestätigt** | haufe.de, ey.com, pwc-Blog |
| BFH IX R 22/17 (13.03.2018): kein Übergang auf Rechtsnachfolger (#262) | **bestätigt für den Nießbrauch** (Eigentümer kann vom Nießbraucher getragenen Rest nach dessen Tod nicht abziehen); als allgemeine Regel „Rechtsnachfolge“ zu weit | rewis.io, urteile-gesetze.de |
| Schenkung beendet die Verteilung (#262 E-7) | **Auslegung** (nicht im Wortlaut) | — |
| Verteilung des Betrags nach Kürzung bei verbilligter Vermietung (#262 E-3) | **widerlegt** durch die Anleitung: volle Höhe in 33–84, Kürzung nur in 87/88 (V1) | Anleitung Anlage V 2024, S. 7 (selbst gelesen) |
| BFH IX R 19/24 (14.01.2025): Zuführung keine WK, erst bei Verausgabung (#96 R1, #262) | **bestätigt** (BStBl II 2025, 291; Vorinstanz FG Nürnberg 1 K 866/23); Datum in einer Quelle 13.01., amtlich 14.01. | otto-schmidt.de, deubner, gesetze.co |
| Anleitung 2024: Rücklagenbeiträge erst bei Ausgabe für Erhaltung abziehbar, Verweis auf 55–72 (#96 R1/R6) | **bestätigt** | Anleitung 2024 (selbst gelesen) |
| Sonderumlage zählt erst bei Verausgabung (#96 R5) vs. „ab Jahr ihrer Zahlung“ (#262 E-10) | **#96 richtig, #262 falsch** (X3); FG Niedersachsen 2005 nicht selbst geprüft | deubner (laut #96) |
| Anlage V 2025: Z. 6 Aktenzeichen, Z. 7 vier Daten, Z. 8 Veräußerung, Z. 9 W-IdNr., Z. 10 Kz. 61/63/62, Z. 11 Kz. 54, Z. 12 Kz. 55/56 | **bestätigt** | Vordruck 2025AnlV101 (selbst gelesen) |
| Z. 15 (Kz. 01), 18 (02), 19 (03), 20 (04), 21 (11), 22 (05), 23 (12), 24 (13), 25 (06: frühere Jahre / verrechnete Kautionen / Baukostenzuschüsse), 26 (07) | **bestätigt** für 2025; 2024 laut Anleitung dieselben (20–24, 25–28) | Vordruck 2025, Anleitung 2024 |
| Z. 55/56 „voll abzuziehende Erhaltungsaufwendungen (einschließlich Entnahmen aus der Erhaltungsrücklage)“, Kz. 36/37 | **bestätigt** | Vordruck 2025 |
| Z. 57–60 zu verteilende (57 Gesamtaufwand / davon im Jahr, 58 direkt, 59 verhältnismäßig mit %, 60 Summe Kz. 38); Z. 61–72 Anteile aus 2021–2024 je drei Zeilen (Kz. 39–42) | **bestätigt**; Struktur genauer als „[61, 72]“ (X5) | Vordruck 2025 |
| Z. 76–78 „ohne Erhaltungsrücklage“ | **bestätigt** | Vordruck 2025, Anleitung 2024 |
| Anleitung 2024 zu Z. 20: Umlagen „immer in voller Höhe“, laufend vereinnahmt (#312 Zeile 20) | **bestätigt** | Anleitung 2024 |
| H 21.1 EStH (BFH 26.10.1977, kein Nachholen eines Jahresanteils) (#262) | nicht unabhängig geprüft | — |
| BGH V ZR 96/24 (11.04.2025) Rücklagenentnahmen nicht in Abrechnungsspitze (#96 R4) | nicht unabhängig geprüft (nur Begründung) | — |

---

## 7. Grundsatz „Voreinstellung = bisheriges Verhalten“

- **#312**: hält, wenn `received` aus `incomeFingerprint` fällt (geplant) — Summe und Überschuss unverändert.
- **#262**: hält ohne Wahl (`deferredCents` 0, keine abgeleiteten Zeilen, `items`-Tupel unverändert). Mit V1 ändert sich
  nur der Fall mit Wahl.
- **#96**: hält (neue Gruppe nur sortiert, nicht gehasht; `costModels` nicht gehasht). Einzige sichtbare Änderung ohne
  Eingabe: `unstatedCount` ohne Zuführungen.
- **#478**: hält für `tax-golden.json`; ändert gewollt das Ergebnis eines Zeitraumwechsels.
- **#281**: **ändert für viele Nutzer sichtbar das Mietkonto** (Übertrag, Status nach § 366) und den Hinweis
  `prepayment.arrears`. Das ist der Zweck von #281, verletzt aber den Satz „wer ein Haus vermietet, merkt nichts“ im
  wörtlichen Sinn; CHANGELOG muss es sagen. Zahlen der Abrechnung und Steuer bleiben.

## 8. Bedienbarkeit (Deutsch, siezen)

Alle Texte siezen, Wächter anrede.test.ts ist in allen Plänen. Zusätzlich zu den Einzelbefunden (R-G, V2, V7, R-C):
- Die Steuerseite bekommt im Release vier neue Blöcke (Kopf der Anlage V, Einnahmen mit zwei Spalten, verteilter
  Erhaltungsaufwand, Gesamtsicht). Reihenfolge der Seite festlegen, wie der Vordruck: Kopf → Einnahmen (13–32) →
  Werbungskosten mit Erhaltung (55–72) → übrige → 87/88 → Gesamtsicht unten. Ein Test in Steuer.test.tsx hält die
  Reihenfolge fest, sonst entscheidet jeder PR für sich.
- „Je Wohnung (für die Zeilen 13 und 14)“ aufklappbar und im Druck offen: gut.
- Neue Hinweise: nur mit Anlass (#312 macht `turnOfYear` anlassbezogen: gut); `spreadConditions` als ruhiger Hinweis,
  nur im ersten Jahr: gut.

---

## 9. Gemeinsame Reihenfolge (ein Stapel, je PR Durchsicht mit frischem Kontext, auf der Spitze Integrations-
durchsicht, Praxislauf, `full-check`)

| # | PR | hängt ab von | Migration | Größe (Code + Test) |
|---|---|---|---|---|
| 1 | **#478** Zeitraumwechsel behält angegebenes Jahr; `requireTaxYear` im Kalenderzeitraum gelockert; Formular zeigt abweichendes Jahr | main | – | S (~150 + 250) |
| 2 | **#312 PR 1** `rentAllocation.ts` + `monthSoll` in shared/monthRate.ts (kein Zyklus), Invarianten; noch kein Verbraucher | 1 (nur Stapel) | – | M (~250 + 500) |
| 3 | **#281** Mietkonto auf Tilgung, Übertrag, `designatedMonth`, Entwurf für Art/Monat, `prepayment.arrears` aus A-Teilen, Hinweis Abrechnungsreife | 2 | 0078/0079 | L (~500 + 700) |
| 4 | **#96 PR 1** Entnahme Erhaltungsrücklage (Kostenart, Gruppe, `allowsPaidOn`, A3-Übertrag, Hinweise A4.1–A4.3/A4.5/A4.6, `anlageVLines` **mit income-Block**, `settlementLine` liest daraus), Label `ai-eval` | 1 | – | M (~400 + 450) |
| 5 | **#96 PR 2** Kopfangaben + `Tenancy.relative` (Formular, Kopf der Anlage V, Z. 10, Hinweis anschaffungsnah zusammengelegt), Journal-Beschriftungen | 4 | 0080/0081 | M (~350 + 400) |
| 6 | **#312 PR 2** `income.received` inkl. `relatives` (Z. 19/22/23), `incomeFingerprint`, `tax-received-golden.json`, Rechtsregister `estg.short-period-days` | 3, 5 | – | M (~200 + 500) |
| 7 | **#312 PR 3** Einnahmentabelle, Hinweise, `Einnahmen.csv`, Lexikon | 6 | – | M (~300 + 350) |
| 8 | **#262 PR 1** Datenmodell, `allowsSpread` inkl. Entnahme, Schreibweg, Rückfragen, `syncSourceSpread` | 4 | 0082/0083 | M (~300 + 350) |
| 9 | **#262 PR 2** `deductionPlan`, Raten, abgeleitete Zeilen, Kürzung je Jahr (V1), `grossRateCents` (V2) | 8 | – | L (~350 + 500) |
| 10 | **#262 PR 3** ZIP-Spalte, Steuerseite (Zeilen aus `anlageVLines`), Formular, Hinweise, Lexikon | 9, 7 | – | L (~400 + 400) |
| 11 | **#262 PR 4** § 82b Abs. 2 am Objekt | 10 | (Spalte schon in 8) | S–M (~150 + 200) |
| 12 | **#96 PR 3** Gesamtsicht (summiert `received` und Raten; `hasRental` nach R-C) | 7, 11 | – | S (~150 + 200) |

Begründung der Reihenfolge:
- #478 zuerst: Fehler mit `priority: high`, kleine Fläche, und X1 ist Voraussetzung für #96 PR 1 und die Rückfrage-
  Logik von #262 (Raten hängen am Jahr des Abflusses).
- #312 PR 1 → #281 direkt dahinter: Danach gibt es im Stapel keinen Stand, in dem Mietkonto und Steuer verschieden
  tilgen; die Steuer liest die Teile erst ab PR 6.
- #96 PR 1/2 vor #312 PR 2: `Tenancy.relative` liegt dann vor, `received.relatives` wird gleich gerechnet, der
  „Folgeschritt nach #312“ entfällt (Lead-Entscheidung „relative zusammen mit #312“ ist so erfüllt). `anlageVLines`
  (PR 4) liegt vor #312 PR 3 und #262 PR 3, beide lesen daraus.
- #96 PR 1 vor #262 PR 1: `allowsSpread` kennt die Entnahme von Anfang an.
- Gesamtsicht zuletzt: Sie summiert, was alle anderen liefern.
- Parallel bearbeitbar (eigene Zweige, aber in dieser Folge umgestellt und gemergt): Strang Einnahmen (2, 3, 6, 7) und
  Strang Werbungskosten (4, 5, 8–11). Konfliktdateien in X4; `CHANGELOG.md` löst `merge=union`.

**Umfang gesamt** ≈ 3.600 Zeilen Code + 4.800 Zeilen Test, 12 PRs, vier Migrationsschritte (zwei Paare plus ein Paar
#281). Integrationsdurchsicht: Geld (X9 a–d, I-1…I-8 von #262 mit V1, Invarianten der Tilgung, verbilligte Vermietung
unverändert), Daten (0078–0083 in Kette, Backup-Rundlauf mit allen neuen Feldern, Rücksprung über `syncSourceSpread`
und `designatedMonth`, Journal-Beschriftungen, Routen je Objekt und die installationsweite Gesamtsicht, Doku in
server/src/CLAUDE.md „Mietkonto“, „Steuer“, „Jahr des Abflusses“).
