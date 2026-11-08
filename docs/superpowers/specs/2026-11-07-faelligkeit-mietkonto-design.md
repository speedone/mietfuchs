# Fälligkeit am Mietverhältnis, Rückstand ab dem Fälligkeitstag (#334)

Stand: Entwurf vom 07.11.2026, Rechtsaussagen an Primärquellen gelesen und unabhängig gegengeprüft (vier
Muss-Befunde eingearbeitet: § 579 richtig zitiert, sichere Grenze im Einzugsmonat, § 675t Abs. 1 und der Tag der
Buchung, Übergangsrecht in E1 richtig formuliert), noch nicht freigegeben. Folgeschritt zu #290 (Fälligkeit als Auskunft, PR #338) und Ablösung der pauschalen Regel aus #133. Baut
auf #311/#326 (Monatsregel `rateInMonth`) und #281 (Mietkonto ab Beginn, Tilgung nach § 366 BGB) auf. Plan:
`docs/superpowers/plans/2026-11-07-faelligkeit-mietkonto.md`.

**Herkunft.** #334 hat ein externer Mitwirkender vorgeschlagen (Autor auch von #290/#338, #328, #333). Spuren einer
Umsetzung von #334 gibt es im Repo nicht: kein Zweig, kein PR (`gh pr list --state all --search 334` findet nur #338),
kein Commit. Vorarbeit von ihm, auf der dieser Entwurf aufsetzt: `shared/holidays.ts`, `shared/deadlines.ts`,
`properties.state`, die Feiertage im Rechtsregister und der Wächter zur Auflage aus #290 (alles #338).

## Ziel

Ein Monat zählt im Mietkonto **ab dem Tag als Rückstand, an dem die Miete hätte eingegangen sein müssen**, statt
pauschal erst ab dem Folgemonat. Der schiefe Fall aus dem Issue: Einzug am 09.10., 0 € eingegangen, und das Mietkonto
zeigt den Oktober bis Monatsende als „zählt noch nicht als Rückstand“ und darüber grün „bisher bezahlt“.

**Wer nichts einstellt, bekommt das gesetzliche Verhalten ohne Pflichtfeld.** **Nie erscheint ein Rückstand zu früh**:
Wo eine Angabe oder eine Rechtsfrage offen ist, wählt Mietfuchs den späteren Tag.

## Ist-Stand im Code

- **Regel aus #133 an drei Stellen**, jede als „Monat vor dem Monat des Stichtags“:
  - `tenancyAccount` in [server/src/calc.ts:1107-1109](../../../server/src/calc.ts) (`dueEnd = min(spanLast, prevMonth(asOfMonth))`),
    daraus `arrearsCents` über alle Jahre (calc.ts:1162-1166).
  - `ledgerRows` in calc.ts:1222-1223 (`dueMonths`), Status `notDue` in calc.ts:1265, `dueSollCents` in calc.ts:1278;
    Begründung der pauschalen Regel im Kommentar calc.ts:1206-1212.
  - Hinweis `prepayment.arrears` in calc.ts:9909-9912 (`anyDue`, `dueInPeriod`), Begründung calc.ts:9900-9904.
  - Ohne `asOf` (Steuer, Regression des Umstiegs, Tests) ist die ganze Spanne fällig. Den Stichtag reicht nur die Route
    `/api/rentledger/:year` (server/src/index.ts:1736, `asOf: today()`) und die Abrechnung (`computeSettlement(…,
    { asOf: today() })`, index.ts:1052 u. a.).
- **Monats-Soll** an einer Stelle (#311): `monthShare`, `rateInMonth`, `monthSoll` in
  [shared/monthRate.ts](../../../shared/monthRate.ts) (`monthShare` Zeile 35, `rateInMonth` Zeile 60, `monthSoll` Zeile 78). Dieser Entwurf
  ändert kein Soll, er dockt an `monthShare` an (Beginn des ersten, angebrochenen Abschnitts).
- **Tilgung** [server/src/rentAllocation.ts](../../../server/src/rentAllocation.ts): fällig im Sinne von § 366 Abs. 2
  ist ein Monat bei einer Zahlung am Tag d, wenn d ≥ Monatserster (Kommentar Zeile 29-31), ausdrücklich ohne Land und
  Feiertage. `rentDueAtStartOf` (Zeile 170) fragt `bgb.rent-due-at-start` mit dem früheren von Vertragsdatum und
  Beginn; gelesen von `ledgerStartOf` (Dauerauftrag zum Monatsende, Zeile 162) und der Zehn-Tage-Regel der Steuer
  (`receivedIncome`, calc.ts:1629; `januaryDueInWindow` calc.ts:1589).
- **Fälligkeit aus #290** in [shared/deadlines.ts](../../../shared/deadlines.ts): `rentDueDate(month, state)` (dritter
  Werktag ohne Samstag, nur volle Monate ab dem Ersten), `deadlineOnWorkday` (§ 193 BGB), `rentDueRuleText`. Der
  Kopfkommentar sagt „Nichts wird still ersetzt“. **Feiertage** in [shared/holidays.ts](../../../shared/holidays.ts)
  (`holidaysOf`, `localHolidaysOf` Zeile 164, `isHoliday` Zeile 173, `isWorkday` Zeile 181); ohne Land nur Tage, die in
  allen Ländern gelten, also **der früheste** Fälligkeitstag, nicht der späteste. Gemeindefeiertage werden nie gezählt.
- **Einziger Einsatz heute**: die Auskunft `rentDueNote`/`rentDueApplies` in
  [client/src/ledgerView.ts:143-171](../../../client/src/ledgerView.ts), angezeigt über den Karten in
  client/src/pages/Mietkonto.tsx:132 und 259; die Plakette „bisher bezahlt“ (Mietkonto.tsx:287) kommt aus `rowStanding`
  (ledgerView.ts:26-32) bei negativem Endsaldo ohne Rückstand, also auch bei 0 € gezahlt und nichts fällig.
- **Rechtsregister**: `bgb.rent-due-workday` (3, `checked`), `bgb.rent-due-saturday` (false, `checked`),
  `bgb.deadline-on-workday` (`checked`), `bgb.rent-due-at-start` (bis 01.09.2001 false, `adopted`; ab 02.09.2001 true,
  `checked`) in [shared/law/bgb-betrkv.ts:97-181](../../../shared/law/bgb-betrkv.ts); je Feiertag `holiday.*` in
  [shared/law/feiertagsgesetze.ts](../../../shared/law/feiertagsgesetze.ts). `LAW_AS_OF` = 05.11.2026
  (shared/law/register.ts:66).
- **Wächter der Auflage aus #290**: [server/test/holidays.test.ts:172-184](../../../server/test/holidays.test.ts). Er
  wird rot, sobald eine Datei unter `server/src` `shared/holidays.ts` oder `shared/deadlines.ts` importiert, solange
  irgendeine Fassung eines `holiday.*` nicht `checked` ist.
- **Prüfstand der Feiertage im Register** (Stand des Codes):
  - `checked`: `holiday.unity-day` (Einigungsvertrag), `holiday.repentance` (SächsSFG), `holiday.augsburg-peace`
    (BayFTG), `holiday.liberation-day` und `holiday.uprising-1953` (alle Fassungen, GVBl. Berlin 2019 und 2024),
    `holiday.womens-day` ab 07.02.2019 (Berlin) und ab 13.07.2022 (GVOBl. M-V).
  - `adopted`: die acht bundesweiten Tage (`EVERYWHERE`, gelesen nur SächsSFG und BayFTG), `holiday.epiphany`,
    `holiday.womens-day` bis 06.02.2019, `holiday.easter-sunday`, `holiday.whit-sunday` (Brandenburg über eine
    nichtamtliche Sammlung), `holiday.corpus-christi`, `holiday.assumption`, `holiday.childrens-day`, alle vier
    Fassungen von `holiday.reformation`, `holiday.all-saints`.
  - Im Gesetzestext amtlich gelesen sind damit bisher: **BY** (BayFTG) und **SN** (SächsSFG, Fronleichnamsverordnung),
    dazu Änderungsgesetze aus **BE**, **MV**, **HB**, **HH** und **TH** (§ 10 ThürFtG). Ganz ohne amtlich gelesenen
    Gesetzestext: **BW, BB, HE, NI, NW, RP, SL, ST, SH** und die Stammfassungen der übrigen.
- **Datenmodell**: `Tenancy.contractDate` (shared/types.ts:195, Spalte `tenancies.contract_date`) gibt es; eine Angabe
  zur Fälligkeit gibt es nicht. `Property.state` (shared/types.ts:61) steht **nicht** im Schnappschuss
  (`SnapshotProperty`, server/src/snapshot.ts:656). Letzter Migrationsschritt: 0091.
- **Cockpit** liest das Mietkonto nicht. **Steuer** liest die Tilgung ohne Stichtag; betroffen ist nur die
  Zehn-Tage-Regel über `rentDueAtStartOf`.

## Rechtslage

Gelesen am 07.11.2026; Gesetze auf gesetze-im-internet.de, BGH-Volltexte über rechtsprechung-im-internet.de (das
amtliche Portal des Bundes; die Datenbank des BGH selbst wies den Abruf ab), Randnummern nach dem Volltext.

- **Fälligkeit**: „Die Miete ist zu Beginn, spätestens bis zum dritten Werktag der einzelnen Zeitabschnitte zu
  entrichten, nach denen sie bemessen ist.“ (§ 556b Abs. 1 BGB). Abdingbar; der Vertrag kann anderes bestimmen.
- **Samstag zählt nicht**: BGH, Urteil vom 13.07.2010, VIII ZR 129/09, Leitsatz und Rn. 42, 46 („ungeschmälert zur
  Verfügung stehen“), Rn. 48 mit §§ 675s, 675n Abs. 1 Satz 4 BGB, Rn. 49 („unabhängig von der Zahlungsweise“). Ebenso
  für eine Vorauszahlungsklausel in einem Vertrag von 1978: VIII ZR 291/09 vom selben Tag, Leitsatz.
- **Verzug ohne Mahnung**: „Der Mahnung bedarf es nicht, wenn 1. für die Leistung eine Zeit nach dem Kalender bestimmt
  ist“ (§ 286 Abs. 2 Nr. 1 BGB). Für eine Klausel „monatlich im Voraus, spätestens am 3. Werktag des Monats“ nimmt der
  BGH Verzug nach § 286 Abs. 2 Nr. 1 BGB an (VIII ZR 138/11 vom 11.07.2012, Rn. 16 mit Rn. 1), ohne die Frage näher zu
  begründen. Mietfuchs zeigt einen **Rückstand**, keinen Verzug: Verzug setzt zusätzlich Vertretenmüssen voraus
  (§ 286 Abs. 4 BGB), das Mietfuchs nicht kennt.
- **§ 193 BGB**: Fällt der bestimmte Tag auf Sonnabend, Sonntag oder einen am Leistungsort staatlich anerkannten
  allgemeinen Feiertag, tritt der nächste Werktag an seine Stelle. Für einen vereinbarten Kalendertag und für den Tag
  nach Ablauf des Monats (Altvertrag) maßgeblich.
- **Altverträge**: „Auf ein am 1. September 2001 bestehendes Mietverhältnis … sind … 7. hinsichtlich der Fälligkeit
  § 551 des Bürgerlichen Gesetzbuchs in der bis zum 1. September 2001 geltenden Fassung anzuwenden.“ (Art. 229 § 3
  Abs. 1 Nr. 7 EGBGB). VIII ZR 291/09 Rn. 15 sagt nur, dass § 556b auf einen Vertrag von 1978 keine Anwendung findet;
  **das Issue zitiert Rn. 15 zu weit**. Dass § 551 a. F. die Miete nachträglich fällig stellte, steht mittelbar in
  VIII ZR 291/09 Rn. 17 (eine Vorauszahlungsklausel verlegt die Fälligkeit „abweichend von … § 551 Abs. 1 BGB aF … auf
  den Beginn des Monats“) und VIII ZR 107/12 vom 10.10.2012, Rn. 14 („wonach die Miete jeweils am Monatsende zu zahlen
  war“). Den Wortlaut von § 551 a. F. gibt es an keiner gelesenen Primärquelle (bleibt `adopted`).
- **Rechtzeitigkeit der Überweisung**: Es genügt, dass der Mieter „bei ausreichend gedecktem Konto seinem
  Zahlungsdienstleister den Zahlungsauftrag bis zum dritten Werktag des vereinbarten Zeitabschnitts erteilt“
  (VIII ZR 222/15 vom 05.10.2016, Leitsatz 1, Rn. 17, 18); die Gutschrift gehört nicht mehr zur Leistungshandlung
  (Rn. 23), Zahlungsdienstleister sind keine Erfüllungsgehilfen (Rn. 24). Eine Klausel, die auf den Eingang abstellt,
  ist ohne Einschränkung für Verzögerungen der Banken unwirksam (Rn. 38, 43, 45).
- **Laufzeit einer Überweisung**: Der Auftrag wird mit Zugang wirksam; fällt der Zugang nicht auf einen Geschäftstag,
  gilt der nächste; die Bank darf einen Annahmeschluss „nahe am Ende eines Geschäftstags“ setzen, danach gilt der
  Auftrag als am folgenden Geschäftstag zugegangen; Geschäftstag ist ein Tag mit dem nötigen Geschäftsbetrieb der
  beteiligten Bank (§ 675n Abs. 1 Sätze 1 bis 4 BGB). Der Betrag muss „spätestens am Ende des auf den Zugangszeitpunkt
  … folgenden Geschäftstags“ bei der Bank des Empfängers eingehen, bei Papierform „um einen weiteren Geschäftstag“
  später (§ 675s Abs. 1 Sätze 1 und 3 BGB), und ist dem Empfänger dann unverzüglich verfügbar zu machen, Wertstellung
  spätestens an diesem Geschäftstag (§ 675t Abs. 1 BGB).
- **Lastschrift**: Mit einer Lastschriftabrede wird die Zahlungspflicht zur Holschuld; der Schuldner hat das
  Erforderliche getan, wenn sein Konto gedeckt ist (BGH, Urteil vom 20.07.2010, XI ZR 236/07, BGHZ 186, 269, Rn. 26,
  auch für die SEPA-Lastschrift; ebenso für Hausgeld V ZR 97/15 vom 29.01.2016, Rn. 11: „Die Einziehung ist Sache des
  Gläubigers“). Eine Entscheidung genau zur Miete ist nicht gefunden.

### Landesrecht (Feiertage)

Ergebnis des amtlichen Nachlesens am 07.11.2026 (Auftrag aus #290/#334):

| Land | Ergebnis | Fundstelle |
| --- | --- | --- |
| BY | deckungsgleich | Art. 1 Abs. 1 Nr. 1 und 2, Abs. 2, 3 FTG (BayRS 1131-3-I), zuletzt geändert durch VO vom 26.03.2019 (GVBl. S. 98), https://www.gesetze-bayern.de/Content/Document/BayFTG/true |
| BB | deckungsgleich | § 2 Abs. 1 FTG vom 21.03.1991, zuletzt geändert durch G vom 30.04.2015 (GVBl. I Nr. 13), https://bravors.brandenburg.de/gesetze/ftg_2015 |
| NI | deckungsgleich | § 2 Abs. 1 NFeiertagsG i. d. F. vom 07.03.1995, zuletzt geändert durch G vom 22.06.2018 (Nds. GVBl. S. 123), Fassung ab 29.06.2018, NI-VORIS https://voris.wolterskluwer-online.de/browse/document/f74bc6e7-6ded-3c2c-9afb-b34620456e56 |
| SN | deckungsgleich | § 1 Abs. 1 SächsSFG, Stand 07.05.2025, https://www.revosax.sachsen.de/vorschrift/3997; § 1 FronleichnamsVO vom 04.05.1993 mit Anlage (29 Gemeinden), https://www.revosax.sachsen.de/vorschrift/4142 |
| BW, BE, HE, MV, NW, SL, SH, TH | deckungsgleich (Task 1, gelesen am 07.11.2026) | Fundstellen und Kette der Änderungen je Land in `STATE_HOLIDAY_LAW` (shared/law/feiertagsgesetze.ts); gelesen im Gesetzblatt, meist über die Parlamentsdokumentation des Landtags, NW auf recht.nrw.de |
| HB, HH (bis 07.11.2026 auch RP, ST) | Inhalt deckungsgleich, Wortlaut der Liste amtlich nicht lesbar | juris-Portale antworten einem Browser ohne Fenster mit 204, *.bremen.de mit 403; Gesetzblätter der Stammfassungen nicht online. Grund je Land in `STATE_HOLIDAY_LAW_UNREAD`. Nicht umgangen. |
| RP, ST | deckungsgleich (nachgelesen am 08.11.2026) | Stammgesetz über Regierungsentwurf, Beschlussempfehlung und Plenarprotokoll im Landtag (OPAL, PADOKA), Änderungen über ihre Drucksachen; Fundstellen in `STATE_HOLIDAY_LAW` |

Für Berlin bleiben die schon gelesenen Gesetzblätter (G vom 30.01.2019, GVBl. S. 22; G vom 10.07.2024, GVBl. S. 460)
die Fundstelle der einmaligen Feiertage; ein Teilbefund aus dem Blatt von 2019 (8. Mai und 17. Juni dort als
Gedenktage) widerspricht dem nicht, denn die Einfügung für 2025 und 2028 steht erst im Gesetz von 2024. Das amtliche
Lesen der zwölf Länder ist **Task 1 des Plans**, von Hand im Browser oder über das jeweilige Gesetz- und
Verordnungsblatt (PDF).

**Stand nach Task 1:** Zwölf Länder sind im Wortlaut gelesen, kein Wert weicht ab. HB, HH, RP und ST bleiben offen,
weil ihr Landesrecht-Portal oder Gesetzblatt für einen Browser ohne Fenster gesperrt ist; ihr Inhalt deckt sich mit
amtlichen Teilbelegen (Drucksachen, Änderungsgesetze, Angaben der Landesbehörden). Folge für E6: Die geltenden
Fassungen bleiben `adopted`, `holidaysCheckedOn` ist für heutige Tage falsch, und Task 4 rechnet bis dahin mit der
sicheren Grenze. Schließen lässt sich die Lücke nur, indem jemand die vier Listen in einem gewöhnlichen Browser im
Landesrecht-Portal liest und in `STATE_HOLIDAY_LAW` einträgt; die Fassungen werden dann von selbst `checked`.

**Nachtrag 08.11.2026:** RP und ST sind über die Parlamentsdokumentation ihrer Landtage im Wortlaut gelesen
(Stammgesetz in der beschlossenen Fassung, jede Änderung der Liste über ihre Drucksachen); kein Wert weicht ab. Offen
bleiben HB und HH: Gesetzblatt und Transparenzportal Bremens antworten mit 403, die Parlamentsdatenbank der Hamburger
Bürgerschaft sperrt den Zugriff, die Stammfassungen von 1953 und 1954 sind sonst nicht amtlich online.

## Entscheidungen

### E1 Fälligkeit als Angabe am Mietverhältnis, Vorgabe gesetzlich

Drei optionale Felder am Mietverhältnis, keines Pflicht:

- `rentDue`: fehlend heißt **gesetzlich**: wirksam `startWorkday`, wenn das Mietverhältnis am 01.09.2001 noch nicht
  bestand (Vertragsdatum und Beginn nach dem 01.09.2001), sonst `inArrears`, entschieden wie heute über `bgb.rent-due-at-start` mit dem früheren von Vertragsdatum und Beginn
  (eine Stelle: `rentDueAtStartOf`). Ausdrücklich wählbar:
  - `startWorkday`: zu Beginn, spätestens am dritten Werktag (§ 556b Abs. 1 BGB; für Altverträge mit
    Vorauszahlungsklausel, die nach VIII ZR 291/09 ebenso auszulegen ist).
  - `dayOfMonth` mit `rentDueDay` 1 bis 31: ein vereinbarter Tag; in kürzeren Monaten der letzte Tag; nach § 193 BGB
    verschoben.
  - `inArrears`: nach Ablauf des Monats (Altvertrag ohne Vorauszahlungsklausel).
- `firstRentAtStart` (nur `true` gespeichert): Die erste Miete ist schon bei Mietbeginn fällig (Klausel einiger
  Verbandsmuster, laut Issue Haus & Grund und weitere; nicht selbst gelesen). Gilt nur für den ersten Monat; der Tag
  ist der Mietbeginn, nach § 193 BGB verschoben.

**Warum am Mietverhältnis**: Die Fälligkeit steht im Mietvertrag; zwei Mieter im selben Haus können verschiedene
haben (Altvertrag neben neuem). **Warum diese Vorgabe**: Sie ist das Gesetz und das, was nach dem Issue alle geprüften
Muster vorsehen. Für Altverträge ist sie die spätere der beiden Möglichkeiten und deshalb vorsichtig; wer eine
Vorauszahlungsklausel hat, stellt `startWorkday` ein. Ein Feld für „n-ter Werktag“ gibt es nicht; ein fester Tag deckt
die seltenen Abweichungen.

### E2 Der erste, angebrochene Monat

Ob der erste Zeitabschnitt des § 556b mit dem Mietbeginn beginnt, ist an keiner Primärquelle entschieden.
**Auslegung von Mietfuchs**, die spätere: Im Einzugsmonat beginnt der Abschnitt am Mietbeginn, der dritte Werktag
wird ab diesem Tag gezählt (der Tag selbst mitgezählt, wie bei `monthShare`). Einzug Freitag 09.10.2026: Fr 09.,
Mo 12., Di 13. → fällig am **13.10.2026**. Bei `dayOfMonth` gilt im Einzugsmonat der spätere von vereinbartem Tag und
diesem dritten Werktag. Mit `firstRentAtStart` gilt der Mietbeginn. Im Auszugsmonat ändert sich nichts außer bei
`inArrears`: fällig am Tag nach dem Mietende (Ablauf des letzten Abschnitts), nach § 193 BGB verschoben.

### E3 Rückstand erst nach dem spätesten erwarteten Eingang

Mietfuchs kennt nur das Datum der Gutschrift, nicht den Tag des Auftrags. Rechtzeitig ist der Auftrag bis zum
Fälligkeitstag (VIII ZR 222/15). Deshalb zählt ein Monat **erst ab dem Tag nach `creditExpectedBy`** als Rückstand,
und `creditExpectedBy` ist der **vierte Bankgeschäftstag nach dem Fälligkeitstag**:
- bis zu drei Tage bis zum Eingang bei der Bank des Vermieters: einer für einen Auftrag nach Annahmeschluss oder an
  einem Tag ohne Geschäftsbetrieb (§ 675n Abs. 1 Sätze 2, 3), einer für die Ausführung (§ 675s Abs. 1 Satz 1), einer
  für die Papierform, wenn die Bank die Frist verlängert („können … verlängert werden“, § 675s Abs. 1 Satz 3);
- ein weiterer für die Buchung auf dem Konto (**Auslegung**): Der Betrag ist „unverzüglich verfügbar zu machen,
  nachdem“ er eingegangen ist; nur die Wertstellung muss spätestens am Geschäftstag des Eingangs liegen (§ 675t Abs. 1
  Sätze 1, 2). Mietfuchs kennt nur das Buchungsdatum, nicht die Wertstellung, und ein Buchungstag nach dem Eingang ist
  nicht ausgeschlossen.

Der Wert im Register (`bgb.transfer-execution-days`) beschreibt den Eingang bei der Bank des Vermieters, der Tag für
die Buchung steht getrennt als Auslegung (`practice.credit-booking-days`). Beispiel: fällig Di 13.10.2026, erwartet bis
Mo **19.10.2026** (Mi 14., Do 15., Fr 16., Mo 19.), Rückstand ab 20.10.2026.

- **Abweichung vom Issue**: Das Issue schlug einen Bankgeschäftstag vor. Drei folgen aus dem Wortlaut der §§ 675n,
  675s, wenn der Mieter am letzten Tag nach Annahmeschluss **und** mit Überweisungsträger beauftragt und die Bank die
  Papierfrist nutzt, dazu der Tag der Buchung; mit einem Tag erschiene bei einem pünktlichen Mieter ein Rückstand. Das
  widerspricht „nie zu früh“.
- **Bankgeschäftstag (Auslegung, vorsichtig)**: Montag bis Freitag, kein Feiertag in irgendeinem Land (auch
  Gemeindefeiertage), nicht 24.12. und 31.12. Die Bank des Mieters kann in einem anderen Land sitzen, und § 675n
  Abs. 1 Satz 4 knüpft an ihren Geschäftsbetrieb an, den Mietfuchs nicht kennt. 24.12. und 31.12. sind keine
  gesetzlichen Feiertage; dass viele Banken dort keinen Geschäftsbetrieb unterhalten, ist eine Annahme aus der
  Praxis (Register `practice.bank-closed-days`, `adopted`).
- **„Zur Prüfung“ statt Verzug (für #188)**: Wird ein Monat erst nach `creditExpectedBy` gedeckt, trägt er
  `paidAfterExpected` (Tag der Deckung) als neutrale Auskunft. Mietfuchs leitet daraus nie einen Verzug ab; ob
  rechtzeitig beauftragt wurde, weiß nur der Mieter.
- **Lastschrift** (Offen C): Holschuld, rechtzeitig bei gedecktem Konto (XI ZR 236/07 Rn. 26); den Zeitpunkt der
  Gutschrift bestimmt dann der Vermieter mit dem Einzug. Mietfuchs kennt den Zahlungsweg nicht und behandelt beide
  gleich. Für den Rückstand ist das vorsichtig (ein Lastschriftmieter ohne Rücklastschrift hat gezahlt, sobald der
  Vermieter einzieht; ohne Einzug bleibt ein Rückstand stehen, den der Vermieter selbst verursacht hat). Ein Satz in
  Lexikon und Auskunft sagt das; eine eigene Angabe „Lastschrift“ ist nicht Teil von #334.

### E4 Ohne Bundesland der späteste Tag aller Länder

Ohne `properties.state` rechnet der Rückstand mit dem **spätesten** Fälligkeitstag der 16 Länder (Maximum je Monat,
mit Gemeindefeiertagen), nicht wie heute die Auskunft mit dem frühesten. Nachgerechnet mit dem heutigen
`rentDueDate`: Für volle Monate liegt der dritte Werktag 1995 bis 2100 in keinem Land nach dem 7. (spätester Fall
Januar 1997 und Januar 2026/2027: 07.01.). Die Auskunft im Mietkonto nennt ohne Land künftig ebenfalls diesen Tag, mit
dem Satz, dass er am Ort früher sein kann.

### E5 Gemeindefeiertage zählen für den Rückstand

`localHolidaysOf` (Fronleichnam in Teilen Sachsens und Thüringens, Mariä Himmelfahrt in Teilen Bayerns, Augsburg) wird
für den Rückstand als Feiertag behandelt: Mietfuchs kennt die Gemeinde nicht, und gezählt verschiebt er den Tag nur
nach hinten. In der Auskunft bleibt es beim Hinweis „in Gemeinden, in denen …, ist es ein Werktag später“, damit sie
für die übrigen Orte stimmt.

### E6 Auflage aus #290: geprüft muss sein, was am Tag gilt

Die Auflage verlangt amtlich gelesenes Landesrecht, bevor die Fälligkeit in eine Zahl mit Folgen eingeht. Das Issue
schlägt vor, Länder ohne gelesenes Gesetz „wie ohne Bundesland“ zu rechnen. **Das trägt nicht**: Der späteste Tag
aller Länder (E4) braucht die Feiertage aller Länder, also auch der ungelesenen. Und Bankgeschäftstage (E3) brauchen
ebenfalls alle Länder.

Entscheidung:
- Mit Feiertagen rechnet der Rückstand nur für einen Tag, an dem **jede dann geltende Fassung jedes `holiday.*`**
  `checked` ist (`holidaysCheckedOn(date)`). Für die übrigen Tage gilt die bisherige Regel, und zwar je Regel als
  sichere obere Grenze ohne Feiertage: `startWorkday` in einem vollen Monat Rückstand ab dem Ersten des Folgemonats
  (wie #133; der dritte Werktag liegt nie nach dem 7., siehe E4, plus vier Bankgeschäftstage bleibt es im Monat);
  `dayOfMonth`, `inArrears` und **jeder Einzugsmonat** (auch mit `firstRentAtStart`) ab dem Ersten des übernächsten
  Monats. Beispiel für den Einzugsmonat: Einzug Fr 30.10.2026, dritter Werktag Di 03.11., erwartet bis 09.11.; der
  Erste des Folgemonats wäre zu früh.
- Ältere Fassungen (Reformationstag 2017, Frauentag vor 2019 …) bleiben `adopted`. Das ist folgenlos: Bei einem
  Stichtag heute liegt jeder Monat vor 2018 unter jeder Regel lange in der Vergangenheit, der Rückstand ist derselbe.
- Bis Task 1 alle 16 Länder amtlich gelesen hat, ist `holidaysCheckedOn` für keinen heutigen Tag wahr. Task 4 rückt
  dann nur Rückstände nach hinten (Altverträge ohne Angabe, fester Tag, Einzugsmonat) und zeigt noch keinen Rückstand
  im laufenden Monat; der eigentliche Gewinn kommt erst mit Task 1. Deshalb steht Task 1 vorn.
- Der Wächter in holidays.test.ts wird dazu umgeschrieben (Plan, Task 1). Das präzisiert die Auflage des
  Projektinhabers und wird ihm im PR genannt.

### E7 Eine Stelle für „ab wann Rückstand“

`tenancyAccount`, `ledgerRows` und `prepayment.arrears` lesen dieselbe Funktion (`monthDue`), wie das Soll aus
`monthSoll`. Damit sagen Mietkonto und Hinweis der Abrechnung dasselbe. Die **Tilgung bleibt unverändert**: Sie fragt
weiter „Zahlung am oder nach dem Monatsersten“, ohne Land und Feiertage, damit Mietkonto und Steuer dieselben Teile
haben. **Bekannte Grenze**: Bei `inArrears` oder einem späten vereinbarten Tag ist der laufende Monat nach § 366
Abs. 2 BGB bei einer Zahlung am Monatsanfang noch nicht fällig, und eine ältere offene Kaltmiete ginge der laufenden
Vorauszahlung vor. Das betrifft nur die Aufteilung zwischen Vorauszahlung und Kaltmiete bei gleichzeitigen
Rückständen; ein eigenes Issue, falls es jemand trifft.

### E8 Offene Rechtsfragen aus dem Issue

| Frage | Ergebnis | Voreinstellung |
| --- | --- | --- |
| A: „nach Ablauf des Monats“ (Altvertrag): Monatsletzter oder Erster des Folgemonats? | Nicht entschieden. Zwei BGH-Nebenbemerkungen sagen „am Monatsende“ (VIII ZR 107/12 Rn. 14; IX ZR 279/13 vom 29.01.2015, Rn. 73), ohne den Tag tragend festzulegen. § 579 Abs. 1 Satz 2 BGB (Grundstücke, Räume außer Wohnraum) sagt nur „nach Ablauf der einzelnen Zeitabschnitte“; den ersten Werktag des Folgemonats nennt Satz 3 nur für die nach Vierteljahren bemessene Grundstücksmiete, IX ZR 279/13 Rn. 73 überträgt ihn beiläufig allgemein. Das stützt die Voreinstellung nur als Vergleich. | Der Erste des Folgemonats, nach § 193 BGB auf den nächsten Werktag (der spätere Tag); als Auslegung benannt. |
| B: Wirksamkeit „erste Miete bei Mietbeginn, ohne Karenz“ als AGB | Nicht entschieden; keine BGH-Entscheidung im Bestand ab 2010. Verwandt: VIII ZR 191/10 vom 04.05.2011 (Vorauszahlungsklausel wirksam), nicht dieselbe Frage. | Aus (`firstRentAtStart` fehlt). Wer es einstellt, bekommt in der Auskunft den Satz, dass die Wirksamkeit dieser Klausel nicht höchstrichterlich geklärt ist. |
| C: Rechtzeitigkeit bei SEPA-Lastschrift | Holschuld, rechtzeitig bei gedecktem Konto (XI ZR 236/07 Rn. 26; V ZR 97/15 Rn. 11); zur Miete nicht eigens entschieden. | Wie Überweisung (E3); Satz im Lexikon. |
| Zusatz: erster, angebrochener Abschnitt | Nicht entschieden. | E2: dritter Werktag ab Mietbeginn. |

## Datenmodell

- `shared/types.ts`, `Tenancy`: `rentDue?: 'startWorkday' | 'dayOfMonth' | 'inArrears'`, `rentDueDay?: number`,
  `firstRentAtStart?: boolean`. Fehlend heißt gesetzlich bzw. nein.
- Spalten an `tenancies`: `rent_due` TEXT NULL, `rent_due_day` INTEGER NULL, `first_rent_at_start` INTEGER NULL;
  Bedingungen: Aufzählung mit `IS NULL OR IN (…)`, `rent_due_day` genau bei `dayOfMonth` und zwischen 1 und 31,
  `first_rent_at_start IS NULL OR = 1` (Vergleiche mit `IS`, server/src/db/CLAUDE.md). **Zwei erzeugte Schritte**
  (0092 Spalten, 0093 Bedingungen mit Neubau), weil drizzle-kit Spalte und Bedingung in einem Schritt falsch umbaut
  (wie 0085/0086, 0090/0091). Keine Datenanweisung: `NULL` ist die Vorgabe, und sie ergibt für jeden Bestand das
  gesetzliche Verhalten.
- **Verschlechtert die Vorgabe etwas?** Für Verträge ab dem 02.09.2001 erscheint ein Rückstand des laufenden Monats
  ab etwa dem 8. bis 13. statt ab dem Ersten des Folgemonats. Das ist der Zweck des Issues und rechtlich der
  gesetzliche Fall; wer einen späteren Tag vereinbart hat, stellt ihn ein. Für Altverträge kommt er später als heute
  (vorsichtig). Kein früherer Monat ändert sich (E6). Abrechnung und Steuer rechnen ohne Angabe wie heute.
- `SnapshotProperty` bekommt `state` (Pick aus `Property`), `SnapshotTenancy` die drei Felder; alle Stellen, die den
  Schnappschuss bauen (db/read.ts `snapshotFromStock`, snapshot.ts `snapshotFromDb`).
- **Repository/API**: `POST`/`PUT /api/tenancies` nehmen die Felder; Teilrumpf ohne sie lässt sie stehen; `null` leert;
  400 mit deutschem Satz bei unbekannter Regel, Tag ohne `dayOfMonth`, Tag außerhalb 1 bis 31, `firstRentAtStart`
  nicht boolesch. Journal und Verlauf: Die Tabelle `tenancies` ist schon erfasst; Test, dass die Änderung im Verlauf
  steht und sich zurücknehmen lässt.
- **Backup**: `VACUUM INTO` trägt die Spalten; ein Backup vor 0092 läuft beim Einspielen durch die Kette und bekommt
  `NULL`.
- **Umstieg aus db.json und eingefrorener Eingang**: unberührt. Die db.json kennt die Felder nicht, `server/src/legacy/`
  (Prüfsumme) bleibt, wie er ist; nach dem Umstieg sind die Spalten `NULL`. Die Regression des Umstiegs rechnet das
  Mietkonto ohne Stichtag und vergleicht beide Bestände mit demselben Code; sie bleibt grün.
- **Validator** (legacy/validate.ts): keine Änderung, er prüft nur rohe db.json-Inhalte.
- **Rechtsregister**: neu `bgb.transfer-execution-days` (`eventDate`, `{ afterCutoff: 1, execution: 1, paper: 1 }`, Eingang bei der Bank des Empfängers, §§ 675n
  Abs. 1, 675s Abs. 1 BGB, `checked`), `practice.credit-booking-days` (1, `adopted`, Auslegung zu § 675t Abs. 1) und `practice.bank-closed-days` (`['12-24', '12-31']`, `adopted`, Auslegung).
  Jede neue Fassung in law-history.test.ts (SHIPPED). Die Fundstelle von `bgb.rent-due-at-start` Fassung 1 bekommt
  VIII ZR 291/09 Rn. 17 und VIII ZR 107/12 Rn. 14 dazu (Wert unverändert, bleibt `adopted`).

## Rechnung

- `shared/rentDue.ts` (rein, UTC, ohne Uhr): `effectiveRentDue`, `rentDueOn(t, month, state)`,
  `creditExpectedBy(dueOn)`, `isBankBusinessDay`, `arrearsFrom(t, month, state)`. Feiertage nur über
  `holidaysCheckedOn` (E6); Werte aus dem Register mit `valueAt` für Texte, mit `law()` und Protokoll, wo calc.ts sie
  braucht (die verwendeten Werte stehen dann in `legalBasis.values` einer Abrechnung, wegen `prepayment.arrears`).
- `monthDue(t, month, state, asOf)` im Server: `{ dueOn, creditExpectedBy, arrears }`, `arrears` genau wenn
  `asOf > creditExpectedBy` (bzw. ≥ `arrearsFrom`). Ohne `asOf`: alles fällig (wie heute).
- `ledgerRows`: Status `notDue` bis einschließlich `creditExpectedBy`, danach `open`/`partial`; die Zeile trägt je
  Monat mit Soll `dueOn` und `creditExpectedBy`, `paidAfterExpected` aus dem neuen `MonthCoverage.coveredOn`
  (rentAllocation.ts, reine Ergänzung), und `nextDue` (der nächste nicht gedeckte Monat ab dem Stichtag) für die
  Zeile der Karte. `dueSollCents` und `openMonths` zählen die Monate mit `arrears`.
- `tenancyAccount`: `arrearsCents` über `monthDue` statt `dueEnd`.
- `prepayment.arrears`: `dueInPeriod` über `monthDue`.
- **Steuer**: `rentDueAtStartOf` liest `effectiveRentDue` (`startWorkday` → true, `inArrears` → false, `dayOfMonth`
  → true genau dann, wenn der nach § 193 verschobene Tag im Januar innerhalb von `estg.short-period-days` liegt). Ohne
  Angabe unverändert; die Golden-Werte der Steuer bleiben.

## Anzeige

- **Mietkonto, Plakette** (`rowStanding`): neu `nothingDue` „noch nichts fällig“ (kein Monat fällig, nichts gezahlt)
  und `dueAwaiting` „fällig seit {Datum}“ (fällig, Eingang noch erwartet, neutral); „{Betrag} offen“ wie heute für
  `arrears`; „bisher bezahlt“ nur, wenn mindestens ein Monat fällig war und gedeckt ist.
- **Mietkonto, Zeile je Karte** statt der einen Auskunft über den Karten: „Miete Oktober fällig am Di., 13.10.2026“;
  nach dem Fälligkeitstag „fällig seit 13.10., Eingang erwartet bis 19.10.“; danach rot „offen seit 13.10.2026“. Die
  Einzelheiten (Regel, Feiertage am Ort bzw. „ohne Bundesland: spätester Tag aller Länder“, Gemeindefeiertage, „Das
  gilt, wenn der Mietvertrag nichts anderes bestimmt“, Überweisungsauftrag genügt, vier Bankgeschäftstage) zum
  Aufklappen. Die Daten kommen vom Server, der Client rechnet die Fälligkeit nicht mehr selbst.
- **Monatskästchen**: Tooltip und `sr-only` „zählt noch nicht als Rückstand“ wie heute, dazu „fällig am …“; bei
  `paidAfterExpected` „eingegangen am …, nach dem erwarteten Eingang“ ohne Farbe. Die Legende über den Karten bleibt.
- **`bookingDate`**: Ein Monat mit `notDue` bucht weiter mit heute vor.
- **Stammdaten**, Seitenfenster des Mietverhältnisses neben „Vertragsdatum“: Auswahl „Fälligkeit der Miete“ mit „Wie im
  Gesetz (…)“ (der Zusatz nennt die wirksame Regel, bei Altvertrag „nach Ablauf des Monats“ mit dem Satz zur
  Vorauszahlungsklausel), „Zu Beginn, spätestens am dritten Werktag“, „An einem festen Tag des Monats“ (dann Feld „Tag“,
  Pflicht), „Nach Ablauf des Monats“; Häkchen „Erste Miete schon bei Mietbeginn fällig“. Optionen aus einem reinen
  Modul (`rentDueOptions` in tenancyModel.ts), angezeigter Wert = gespeicherter (jsdom-Test).
- **Cockpit**: nicht betroffen (liest das Mietkonto nicht). **Abrechnung**: nur der Betrag in `prepayment.arrears` im
  laufenden Monat. **Steuer**: nur die Zehn-Tage-Regel, und nur bei eingestellter Regel.

## Lexikon, Anleitungen, Doku

- Lexikon (shared/glossary.ts): neuer Begriff „Fälligkeit der Miete“ (Erklärung, Beispiel Einzug 09.10.2026
  nachgerechnet, Rechtsgrundlage § 556b Abs. 1, § 193, § 286 Abs. 2 Nr. 1, §§ 675n, 675s BGB, VIII ZR 129/09,
  VIII ZR 222/15, Art. 229 § 3 Abs. 1 Nr. 7 EGBGB; die Auslegungen E2, E3, E8 A als solche benannt; „Brauche ich
  das?“: nur bei abweichendem Vertrag oder Altvertrag mit Vorauszahlungsklausel). „Zehn-Tage-Regel“: Satz „Eine
  abweichende Fälligkeit im Mietvertrag kennt Mietfuchs nicht“ berichtigen.
- Anleitung Mieterwechsel (shared/guides.ts): erste Miete im Einzugsmonat, wann sie im Mietkonto als offen gilt.
- docs/funktionsweise.md (Mietkonto, Punkt 7), server/src/CLAUDE.md (Fristen und Feiertage: „Nichts wird still
  ersetzt“ berichtigen; Mietkonto), Kopfkommentar shared/deadlines.ts, CHANGELOG „Unveröffentlicht“ mit Link auf #334
  und dem Satz für bestehende Daten (laufender Monat früher als Rückstand; bei abweichendem Vertrag die Fälligkeit am
  Mietverhältnis eintragen).
- README Zeile 88 („fällige Rückstände“) stimmt weiter.

## Tests

- **Bausteine** (`server/test/rent-due.test.ts`): Beispiele je Regel (Plan, Task 2); ohne Land = Maximum der Länder
  über alle Monate bis 2100; Zeitzone; `holidaysCheckedOn` an Fassungsgrenzen.
- **Engine-Invarianten** (invariant-mietkonto.test.ts, fester Startwert): Rückstand nur nach `creditExpectedBy`;
  monoton in `asOf`; für `startWorkday` zwischen alter Regel zum Stichtag und alter Regel einen Monat später; Summe
  der Teile und Salden unverändert gegen das Orakel (server/testing/fifoLedger.ts mit eigener, einfacher Fälligkeit
  aus der Vergleichsliste der Feiertage, damit es unabhängig bleibt).
- **API**: Felder anlegen, lesen, leeren, 400 mit Satz; Migration und Bedingungen; Backup vor 0092; Umstieg; Journal.
- **Client**: `rowStanding`, Zeilentexte, Auswahl im Formular (angezeigt = gespeichert), guides.test.ts,
  glossary.test.ts, anrede.test.ts.
- **Golden-Tests** (settlement, db, period, heating, heating-period, tax-golden.json, tax-received-golden.json)
  **bleiben centgenau grün**; heating-period-golden rechnet mit festem `asOf` und wird ausdrücklich geprüft.

## Zuschnitt

Fünf PRs (Plan): 1 Landesrecht amtlich lesen und Wächter, 2 Bausteine, 3 Datenmodell, 4 Rechnung, 5 Oberfläche und
Texte. 2 bis 5 bauen aufeinander auf; Integrationsdurchsicht vor dem Merge.

## Dem Umsetzenden überlassen

Name und Ort von `monthDue` (eigene Datei oder in calc.ts), ob `nextDue` an der Zeile oder im Client aus den Monaten
gebildet wird, genauer Wortlaut der Texte innerhalb der hier genannten Aussagen.
