# Server: Berechnung, Routen und Fachliches

Die Heizung steht in [docs/heizung.md](../../docs/heizung.md), die KI-Belegauswertung in
[ai/CLAUDE.md](ai/CLAUDE.md), die Datenbank in [db/CLAUDE.md](db/CLAUDE.md).

## Objekte (#92)

Eine Installation verwaltet mehrere Objekte (`properties`); **ein Objekt ist zugleich die
Abrechnungseinheit**. Eine dritte Ebene (Wirtschaftseinheit) gibt es bewusst nicht: Mehrere
Gebäude, die gemeinsam abrechnen, sind *ein* Objekt, eine Rechnung für mehrere Objekte wird
vorverteilt (#95), die Flexibilität steckt in der Kostenposition (#94).

- **Wurzeln tragen das Objekt, alles andere erbt es**: `property_id` an Wohnungen, Zählern (ein
  Hauptzähler hat keine Wohnung), Kostenpositionen und Abschlüssen. Mietverhältnisse, Zahlungen
  und Ablesungen erben; eine zweite Spalte wäre eine zweite Wahrheit. `ON DELETE RESTRICT`:
  gelöscht wird nur ein leeres Objekt, nie das letzte (`removeProperty`).
- **Eingegrenzt wird an genau einer Stelle**, `narrowToProperty` in snapshot.ts; ein fehlender
  Filter ergäbe still eine Verteilung über zwei Häuser. Eine Invariante in calc.test.ts prüft, dass
  jedes Objekt rechnet, als wäre es allein.
- **Kein Verweis über Objektgrenzen** (Zähler, Direktzuordnung, Anteile, Teilnehmer,
  Einzelbeträge), auch nicht beim Wechsel von Wohnung oder Objekt (`guardUnit`, `guardTenancy`,
  `sameProperty`, `CrossPropertyError` → 400; beim Wiederherstellen `crossPropertyViolations`).
  Keine zusammengesetzten Fremdschlüssel, weil `SET NULL` auf `direct_unit_id` sonst auch das
  Pflichtfeld leerte.
- **Abschlüsse sind eindeutig je (Objekt, Zeitraum).**
- **Routen nehmen `?property=`**, beim Anlegen einer Wurzel `propertyId` im Rumpf (`propertyOf`).
  **Fehlt die Angabe und gibt es genau ein Objekt, gilt dieses**; bei mehreren 400 statt still
  alle. Belege und Backup sind installationsweit.
- **Einstellungen**: Name und Adresse gehören zum Objekt (`settings.house_name`/`address` stehen
  nur noch für den eingefrorenen Eingang da). Vermieter, IBAN und Zahlungsfrist sind in `settings`
  die Vorgabe, am Objekt `null` = „Vorgabe gilt“ (`effectiveLandlord` in client/src/landlord.ts).
- **Die db.json kennt keine Objekte** (`LegacyUnit`, `LegacyMeter`, `LegacyCostItem` in store.ts).
  Tests, die einen Bestand in die Datenbank bringen, gehen über `openDatabaseWithStock`.
- **Oberfläche**: `PropertyProvider` (client/src/property.tsx), Abrufe mit `withProperty`. Nach dem
  Wechsel in ein Objekt ohne Wohnungen steht oben „Zurück zu …“ (#157, client/src/propertyView.ts).

## Abrechnungszeitraum (#208)

Ein Objekt rechnet im Kalenderjahr oder in eigenem Rhythmus ab. **Der Zeitraum ist ein eigener
Schlüssel** `PeriodKey` (`'JJJJ-MM'`, Monat des Beginns, Markentyp), kein Jahr: `cost_items.period`,
`closed_settlements.period`, `closed_settlement_history.period`, `prepayment_overrides.period`,
`assessments.requested_period`. Kalenderjahre bleiben, was Tatsache über einen Beleg ist
(`uploads.year`, `assessments.year`, `detected_year`, `requested_year`).

- **Zeiträume werden berechnet, nie gespeichert** ([shared/period.ts](../../shared/period.ts)): aus
  `period_start_month` und `period_changes` lückenlose Zeiträume bis zwölf Monate
  (`bgb.max-period-months`), vor jedem Wechsel ein Rumpf. Aus Text wird ein Schlüssel nur dort
  (Wächter in period.test.ts). `computeSettlement` rechnet über die Grenzen des Zeitraums; eine
  Wache in calc-zeitraum.test.ts verbietet Kalenderdaten in seinem Rumpf.
- **Mietkonto und Steuer bleiben Kalenderjahr**; Abrechnung und Mietkonto teilen `ledgerRows`.
- **Die nackte Jahreszahl gilt nur beim reinen Kalenderobjekt**, sonst 404 mit Satz, damit ein
  alter Tab nie still einen Rumpf bekommt. Ebenso beim Schreiben (`year` statt `period`,
  vierstellige Jahreskorrektur → `PeriodError`). Schickt ein Tab Jahreszahlen, gilt sein Stand
  vollständig. Ein ungültiger `period` ist 400; ein Schlüssel, den es für das Objekt nicht gibt,
  wird abgelehnt, beim Wiederherstellen ebenso (`orphanPeriodKeys`).
- Die Frist kommt vom Server (`Settlement.deadline`, `settlementDeadline`, `bgb.deadline-months`)
  und friert mit ein.
- **Wechsel des Rhythmus nur mit Vorschau** ([db/periodChange.ts](db/periodChange.ts),
  `POST /api/properties/:id/period/preview`, `PUT …/period`), mit Marke (`token`; stimmt sie nicht
  mehr: 409 mit neuer Vorschau). Ändert sich ein abgeschlossener Zeitraum: 409. Jahreskorrekturen
  werden neu erfasst, wenn ein Mietverhältnis Monate in anders geschnittenen Zeiträumen bekommt
  (eine gezahlte Summe lässt sich nicht verteilen). Das Jahr der Zahlung jeder Position, die in
  einen Zeitraum über zwei Kalenderjahre gelangt, fragt die Vorschau, vorbelegt und geklemmt;
  verschoben wird über dieselbe Schreibprüfung wie beim Speichern.
- **Kalte Rechnungen mit Leistungszeitraum über zwei Zeiträume werden beim Speichern nach Tagen
  aufgeteilt** ([serviceSplit.ts](serviceSplit.ts), Leistungsprinzip); jeder Teil trägt den ganzen
  Leistungszeitraum, und ein Teil wird danach nur berichtigt. Ob eine Position ein Teil ist, sagt die Quelle
  (`isInvoicePart`, shared/splitPart.ts: `sourceId`, für alte Teile ohne Quelle `isSplitPart`), nicht der Zeitraum: Ein Teil kann
  ganz in einem Zeitraum liegen. Auf Teile mit Quelle ändert sich nichts an Kostenart, Einzelbeträgen und Betriebsstrom
  (`requireSourcePartStays`); Objekt wechseln sie nie. Jeder Weg, der so teilt, legt eine
  Quelle an (#455, `cost_sources`). Der Wechsel des Rhythmus teilt nach Quelle (`sourceId`): Teile in Zeiträumen,
  die bleiben oder wachsen, stehen; die übrigen werden als eine Rechnung über ihre Spannen neu geteilt
  (`deriveSourceParts`), und ein Ergebnis kommt zum stehenden Teil seines Zeitraums bei gleichem Zahlungsdatum,
  gleichem Jahr der Zahlung und gleicher Verteilung (`mergeTargetOf`, `sameAllocation`, Vorschau `mergedInto`, bei
  gefragtem Jahr `mergeDependsOnYear`; entsteht es erst mit einem anderen als dem vorbelegten Jahr, `mergeWithYear`, #471). Stehen bewegte Teile im selben Zeitraum, zählen sie nur bei gleichem Jahr der
  Zahlung und Zahlungsdatum zusammen, sonst je Jahr eine Rechnung mit eigener Frage (`sourceSplit`, `poolOf`); liegt
  jeder in einem anderen Zeitraum, bleibt es eine (Golden). Bleibt ein Teil, entfällt die Quelle; trägt er die ganze Rechnung
  (Leistungszeitraum ganz in seinem Zeitraum, `carriesWholeInvoice`, und alle Teile der Quelle decken ihn, `wholeFamily`),
  entfällt auch der Zusatz „(anteilig …)“, Vorschau `renamedTo`, auch an `mergeWithYear` (#471). Decken die bewegten Teile den Leistungszeitraum nicht (ein Teil wurde gelöscht), behält auch eine
  einzige Zeile den Zusatz (`coversService`). Kommt ein Anteil zu einem stehenden Teil, nennt dessen Zusatz danach seine
  bisherige Spanne samt der des Anteils (`mergedNamer`, Vorschau `mergedAs`; Befund 3 zu #455). Steht dieser Teil in einem
  wachsenden Zeitraum und bilden er und die bewegten Teile zusammen eine unveränderte Teilung nach Tagen (im bisherigen
  Rhythmus aus Summe und Spannen genau so geteilt), wird ihre Summe als eine Rechnung neu geteilt und der Anteil ist, was ihm
  zum neuen Betrag fehlt (`withStandingShare`, Befund 4): So ergibt hin und zurück centgenau den Ausgangsstand, bei jeder
  Wiederholung. Teile in Zeiträumen, die bleiben (auch jeder abgeschlossene), ein einzeln berichtigter Teil und bewegte
  Teile in mehreren Rechnungen je Jahr (`poolOf`) werden nicht neu geteilt; dort kommt wie bisher der Anteil der bewegten
  Teile dazu. Gegen den Golden-Stand von vor #455 (db-wechsel-quelle.test.ts) weicht das in einem von 200 Abläufen um einen
  Cent je Zeitraum ab, die Summe der Rechnung nicht; der Test lässt das nur für eine Rechnung mit zusammengefasster Zeile
  zu. Ein Teil
  ohne Quelle wird über seinen eigenen Teil des Leistungszeitraums geteilt und bekommt dann eine. Löschen geht je Teil wie
  bisher; der letzte Teil nimmt die Quelle mit. Ein Datenschritt (0077, dataSteps) hat bestehende Teile zusammengeführt: Kandidat
  ist `isSplitPart` oder eine Beschreibung mit dem Zusatz „(anteilig …)“, zusammen nur bei gleichem Familienschlüssel des Schritts. Heizkosten nie
  (VIII ZR 156/11), dort warnt `period.heating-mismatch`.
- **Jahr der Steuer**: `tax_year` ist das Jahr der Zahlung, Pflicht nur bei einem Zeitraum über zwei
  Kalenderjahre. Welches Jahr eine Position für die Steuer hat, sagt allein `outflowShares`
  ([outflow.ts](outflow.ts), siehe Steuer). Die Steuerübersicht schöpft aus allen Abrechnungen,
  die das Jahr berühren (`taxPartsFor`), das Steuer-ZIP aus denselben (`taxArchiveItems`).
  Referenz: Prüfsummen in `server/test/fixtures/tax-golden.json` ([outflow.test.ts](../test/outflow.test.ts)).
- **Vorschlag nach § 560 im Rumpf** ([prepaymentSuggestion.ts](prepaymentSuggestion.ts)): Jahresfaktor
  je Position, kalt nach Tagen ihres Leistungszeitraums (ohne einen: Jahresbetrag und
  `prepayment.annual-assumed`), Brennstoff nach Gradtagen (`hkv.degree-days`), fehlt der Faktor,
  kein Vorschlag.
- **Oberfläche** hält einen **Tag**, keinen Schlüssel ([client/src/period.tsx](../../client/src/period.tsx),
  [periodForm.ts](../../client/src/periodForm.ts)), so passt ein Objektwechsel den Zeitraum von
  selbst an. Beim Kalenderobjekt heißt er „Abrechnungsjahr“ und die Routen bekommen die Jahreszahl;
  bei abweichendem Zeitraum haben Mietkonto und Steuer `CalendarYearSelect`.
- **Belegbuchung** bucht in `bookingPeriod` (shared/assessment.ts): den gewählten Zeitraum, wenn er
  das Jahr des Belegs berührt, sonst den mit der größten Überschneidung. Der Zeitraum einer
  Auswertung entsteht nach den Regeln des Objekts (`periodForYear`), nie als festes `JJJJ-01`
  (verwaister Schlüssel, und jedes spätere Backup ließe sich nicht wiederherstellen).

## Fristen und Feiertage

[shared/holidays.ts](../../shared/holidays.ts), [shared/deadlines.ts](../../shared/deadlines.ts):
reine Funktionen in UTC, ohne Uhr und Datenzugriff. Maßgeblich ist das Land des Objekts
(`properties.state`, eine der 16 Kennungen oder `null`; ein fremdes Kürzel ist 400).

- **Regeln und Feiertage stehen im Rechtsregister**: `bgb.rent-due-workday` (3, § 556b Abs. 1),
  `bgb.rent-due-saturday` (Samstag zählt nicht, VIII ZR 129/09), `bgb.deadline-on-workday`
  (§ 193 BGB), je Feiertag `holiday.*` in [shared/law/feiertagsgesetze.ts](../../shared/law/feiertagsgesetze.ts).
  `checked` nur, wo der Wortlaut amtlich gelesen ist, sonst `adopted` mit Angabe. Gerechnet wird
  mit Osterformel ohne Laufzeitbibliothek (date-holidays: Daten unter CC BY-SA 3.0, mit AGPL nicht
  verträglich).
- **Geprüft gegen zwei unabhängige Quellen**: feste Liste der Python-Bibliothek holidays
  ([fixtures/holidays/](../test/fixtures/holidays/README.md), 1995–2100) und **date-holidays als
  devDependency der Wurzel** (nur Tests dürfen es importieren; Dependabot hebt es, eine
  Gesetzesänderung macht den Test rot und ergibt eine neue Fassung im Register). Vor 1995 wird
  nicht gerechnet.
- **Gemeindeweise Feiertage werden nie gezählt**, nur genannt (`localHolidaysOf`); das Mietkonto sagt,
  wenn einer bis zum Fälligkeitstag fällt. **Ohne Land** zählen nur bundesweite Feiertage, und die
  Oberfläche sagt, dass die Frist am Ort einen Tag später sein kann.
- `isWorkday` verlangt die Angabe, ob der Samstag zählt (keine Voreinstellung). `rentDueDate`:
  dritter Werktag ohne Samstag; `deadlineOnWorkday`: Fristende nach § 193 BGB.
- **Nichts wird still ersetzt**: calc.ts nutzt die Bausteine nicht, `ledgerRows` und die Regel aus
  #133 (laufender Monat nie fällig) bleiben. Einziger Einsatz ist die Auskunft „Miete … fällig am …“
  im Mietkonto (`rentDueNote`, nur bei voller Monatsmiete, `rentDueApplies`). Jeder weitere Einsatz
  ist eine eigene Entscheidung mit eigenem Test; rechnet calc.ts einmal damit, dann mit `law()`.
- Bewusst nicht: Land aus der Postleitzahl, Sonntage in Hessen, ob § 193 BGB auf eine Frist
  anzuwenden ist (entscheidet der Aufrufer).

## Belegordner (#170)

[client/src/pages/Belege.tsx](../../client/src/pages/Belege.tsx), Logik in
[client/src/receipts.ts](../../client/src/receipts.ts), Entwurf in
[docs/superpowers/specs/2026-10-02-belegordner-design.md](../../docs/superpowers/specs/2026-10-02-belegordner-design.md).
Objekt und Jahr kommen aus der Seitenleiste; nur Objekt und Jahr eines Belegs im Posteingang sind
Auswahlfelder. Bei abweichendem Rhythmus gilt für das Objekt der Seitenleiste der gewählte Zeitraum
(`FolderFilter.period` in client/src/receipts.ts), denn Rumpf und neuer Zeitraum beginnen im selben Jahr;
Register, Belegabdeckung und Belegmappe folgen ihm, der Posteingang bleibt beim Kalenderjahr des Belegs.

- **Die Datei ist der Beleg, `uploads` nur eine Beschreibung** ([db/uploads.ts](db/uploads.ts)).
  **Eine fehlende Zeile ist kein Fehler**: Ältere Belege werden aus der Datei beschrieben
  ([uploads.ts](uploads.ts), `describeFile`, Hochladezeit aus dem Namen). Deshalb kein Fremdschlüssel
  von `cost_items.invoice_file`. `GET /api/uploads` geht auch ohne Datenbank (ohne Posteingang).
  **Die Prüfsumme wird nie synchron gerechnet**, `backfillUploads` trägt sie gestreamt nach.
- **`kind`**: `receipt` oder `meterPhoto` (ein Zählerfoto steht nicht im Posteingang).
- **Objekt und Jahr nur für den Posteingang**; für verknüpfte Belege ergeben sie sich aus den
  Positionen. Hochladen nimmt `propertyId`/`year`; ein unbekanntes Objekt oder Jahr wird abgelehnt
  und die Datei entfernt, ein Fehler der Datenbank verhindert das Hochladen nicht.
- **Ein Beleg aus dem Posteingang wird nicht erneut hochgeladen**: KI-Routen nehmen `existingFile`
  (`path.basename`), ein Abbruch löscht ihn nicht.
- **Zuordnen an eine bestehende Position** (`attachChoices`, `amountCheckBody`): passende Positionen
  oben, danach „Betrag prüfen“ (eine übernommene Position trägt einen Schätzbetrag). Bei `amounts`,
  `external`, einem Teil einer aufgeteilten Rechnung (`amountCheckIsPart`, #455: sein Betrag ist nur der Anteil des
  Zeitraums) oder einem Lohnanteil über dem neuen Betrag nur „Position öffnen“; ein vorhandener
  §35a-Anteil wird genannt. Dateinamen vor `matchCategory` mit NFC normalisieren.
- **Löschen** gesperrt, solange irgendeine Position irgendeines Objekts auf den Beleg zeigt
  (`invoiceFilesInUse`).
- **Backup und Umstieg**: Die Tabelle kommt mit dem Schnappschuss der Datenbank; ein Archiv ohne
  sie ergibt eine leere Tabelle (Praxislauf Fall 13).
- **Vorschaubilder** ([client/src/previewQueue.ts](../../client/src/previewQueue.ts), pdfPreview.ts): ein gemeinsamer
  pdf.js-Worker (pdf.ts), höchstens zwei Dokumente zugleich in einer Warteschlange, gerendert erst nahe dem sichtbaren
  Bereich (IntersectionObserver); wer vorbeiscrollt, zieht die Anfrage zurück. Ergebnisse begrenzt gemerkt. Druck der
  Belegkopien und Belegmappe gehen durch dieselbe Warteschlange, ohne Sichtbarkeit. Zeitlimit je Auftrag (Vorschau 30 s,
  Druckseiten 180 s): danach scheitert er wie ein unlesbarer Beleg, der Platz wird frei und der Worker verworfen. Vorher startete jedes Bild einen
  eigenen Worker, und „alle Jahre“ ließ den Tab abstürzen. Mit „alle Jahre“ steht jedes Jahr in einem eingeklappten
  Abschnitt (`yearSections`), der Posteingang zeigt 20 und „Ältere anzeigen (N)“ (`inboxPage`).
- **Belegabdeckung** am Betrag gemessen; die Cockpit-Zeile wird **höchstens gelb**.
- **Belegmappe für Mieter** ([client/src/tenantFolder.ts](../../client/src/tenantFolder.ts)) im Browser
  mit pdf-lib, Nicht-Kopierbares über pdf.js als Bild. Positionen der Mieterzeilen ohne nicht
  Umlagefähiges; **Belege nur einzelner Mieter nur auf ausdrückliche Wahl**. Ein unbrauchbarer Beleg
  bricht die Mappe nicht ab, das Deckblatt nennt ihn. Nur WinAnsi (`winAnsiSafe`).
- **Belege für die Steuer** ([taxReceipts.ts](taxReceipts.ts)): ZIP aus dem Speicher, Ordner je
  `ANLAGE_V_GROUP` in der Reihenfolge der Steuerübersicht, `Übersicht.csv` (BOM, Semikolon) mit jeder
  Position; Textfelder mit = + - @ am Anfang bekommen einen Apostroph (Formel-Einschleusung). Ein Teil
  einer aufgeteilten Rechnung ohne eigenen Beleg nennt den seiner Rechnung und nimmt die Datei mit, auch
  wenn der belegte Teil in einem anderen Steuerjahr steht (#469, `parts` aus `partsBySource`, Regel wie
  `isItemCovered`); einmal je Gruppe, kein Betrag ändert sich.

## API

[index.ts](index.ts): generische CRUD-Routen in einer Schleife für `units, tenancies, costItems,
meters, readings, payments`, durch [db/repository.ts](db/repository.ts); Kaskaden erledigen die
Fremdschlüssel. Alle Datenrouten nehmen `?property=`. Die übrigen Routen stehen in index.ts, die
Heizung betreffenden in docs/heizung.md. Was sich nicht aus dem Code erschließt:

- `POST /api/tenancies/:id/change`: Mieterwechsel (Ende, Zwischenablesungen, Nachmieter) in einer
  Transaktion, ganz oder gar nicht (`changeTenant`). `contact` (#229) setzt neue Anschrift, E-Mail und Telefon des
  ausziehenden Mieters in den vorhandenen Feldern, nur die mitgeschickten Schlüssel, leer entfernt; falsche Art oder über
  200 Zeichen ist eine 400, bevor etwas geschrieben wird (`departingContact`).
- `/api/restore` setzt **keinen vorhandenen Stand voraus** (auf einem frischen Rechner wird am
  häufigsten wiederhergestellt): Sicherheitskopien nur, wo es etwas zu sichern gab, den Belegordner
  legt die Route selbst an. Geprüft wird vor jedem Überschreiben (siehe db/CLAUDE.md).
- `/api/settlement/:period/close` (POST/PUT/DELETE) friert die Abrechnung samt `sentAt` ein; `GET`
  liefert dann den eingefrorenen Stand und daneben in `deviation` je Mieter, was die heutige
  Berechnung anders ergäbe ([settlementDiff.ts](settlementDiff.ts); unlesbar heißt „nicht
  vergleichbar“, nicht „keine Abweichung“). DELETE verschiebt den Stand nach
  `closed_settlement_history` (`…/history`, #56). `taxReport` nimmt den Eigenanteil aus dem
  eingefrorenen Stand.

## Anschreiben zur Abrechnung (#415)

Bausteine, Platzhalter und Vorgabetexte stehen einmal in [shared/letter.ts](../../shared/letter.ts), für Server und
Oberfläche. Ein Baustein ist Text mit Platzhaltern aus einer festen Liste (`{Betrag}`, `LETTER_FIELDS`), **ohne
Logik**: Welcher erscheint (Guthaben, Nachzahlung, ausgeglichen, Vorschlag oder eigener Betrag, Belegeinsicht oder
Belege beigefügt), entscheidet `chooseLetterBlocks`. Beträge und Daten formatiert Mietfuchs; ein leerer Wert nimmt
das Leerzeichen davor mit (`{Konto}` ohne IBAN ergibt den bisherigen Satz ohne Konto).

- **Die Vorgaben sind die bisherigen Sätze**, wortgleich, wo es sie gab (letter.test.ts). Neu: Betreff, Anrede,
  Einleitung, „ausgeglichen“ (bei 0 € stand vorher „Guthaben von 0,00 €“), Schluss, Gruß, Unterschrift.
- **Ebenen** ([db/letters.ts](db/letters.ts), Schritt 0065): `letter_texts` (Installation), `property_letter_texts`
  (fällt mit dem Objekt), `tenancy_letter_texts` und `tenancy_letter_adjustments` je Mietverhältnis und Abrechnung
  (`doc`: Zeitraum, bei Weg d `heating:<Anlage>:<Heizperiode>`; fällt mit dem Mietverhältnis). Eine fehlende Zeile
  heißt „Ebene darüber gilt“, ein leerer Text „weglassen“. `PUT` nach Anwesenheit des Schlüssels, `null` entfernt.
  Die Vorgabe der Anpassung ist die Spalte `print_adjust_suggestion` (der frühere Schalter, ohne Umbenennung, sein
  Wert gilt weiter); `print_fold_marks` ist die Druckeinstellung der Falzmarken.
- **Je Mieter gespeichert, nicht nur für den Druck**: Druckte der Vermieter einen angepassten Text und schlösse
  danach ab, fröre sonst ein anderer Text ein als der, der beim Mieter liegt. Gespeichert wird nur, solange die
  Abrechnung offen ist (409 danach); beim Wiederöffnen gilt die gespeicherte Anpassung wieder.
- **Der Server setzt die Werte ein** (`lettersOf` in shared/letter.ts, gelesen über `lettersFor` in
  [letter.ts](letter.ts)) und liefert `letters` neben `statements`, offen wie abgeschlossen. **Der Abschluss friert
  es im Stand ein** (im selben Vorgang wie die Zahlen); danach ändert keine Vorlage mehr, was zugestellt wurde.
  `{Datum}` und `{AnzahlBelege}` bleiben Platzhalter, denn sie gehören zum Druck (Versanddatum, mitgedruckte
  Belege). `deviation` vergleicht weiter nur Zahlen.
- **Vor #415 abgeschlossen** heißt: kein Anschreiben im Stand, und die Route ergänzt auch keines (`letters` fehlt).
  Was zugestellt wurde, ändert eine Programmänderung nicht rückwirkend; die Seite druckt den bisherigen Aufbau.
- Werte werden beim Einsetzen maskiert (`{`, `}` in einem Namen), damit der zweite Durchgang beim Druck sie nie als
  Platzhalter liest. Absender, Rücksendeangabe und Anschrift stehen im Anschreiben (`sender`, `recipient`) und
  frieren mit ein. `PUT /api/letter-texts` schreibt Texte und Vorgabe der Anpassung in einer Transaktion.
- **Geprüft wird beim Speichern** mit `parseLetterTexts` (unbekannter Platzhalter, ein Platzhalter, den es im
  Baustein nicht gibt, einzelne Klammern, Länge): 400 mit dem Baustein im Satz. Backup und Wiederherstellen nehmen
  die Tabellen mit dem Schnappschuss der Datenbank mit; ein Archiv ohne sie ergibt die Vorgaben, der eingefrorene
  Eingang kennt sie nicht. Validator und Umstieg berührt das nicht (die db.json kennt kein Anschreiben).
- **Teil 2**: Anschrift und Kontakt des Vermieters (`settings.landlord_address`/`landlord_contact`, am Objekt abweichend,
  `null` heißt Vorgabe, `effectiveLandlord`) ergeben Rücksendeangabe (`returnLine`: mit Anschrift „Name · Anschrift“, sonst
  wie bisher `letterhead`), Anschrift im Kopf und die Fußzeile (`footerLine`); alles steht in `sender` und friert ein.
  Die Anrede je Mietverhältnis (`tenancies.letter_salutation`) setzt `{Anrede}` ein (`salutationOf`: ohne Angabe „Guten
  Tag {Name},“, ohne Satzzeichen am Ende ein Komma); die Vorgabe des Bausteins ist jetzt `{Anrede}`, was ohne Anrede
  denselben Satz ergibt. „Anschreiben mitdrucken“ (`settings.print_letter`, `properties.print_letter`) und die Fußzeile
  (`settings.print_footer`) sind nur Druck: Eingefroren wird immer dasselbe Anschreiben. `PUT /api/settings` lehnt bei
  diesen Feldern eine Angabe falscher Art mit 400 ab (`nullableLine`, höchstens 200 Zeichen, Umbrüche werden „, “).
- **Der Schlüssel `doc` nennt das Objekt** (Integrationsdurchsicht): `<Objekt>:<Zeitraum>` bzw.
  `heating:<Anlage>:<Heizperiode>` (`letterDoc`); Schritt 0068 schreibt vorhandene Zeilen um. Der Wechsel des
  Abrechnungszeitraums (periodChange.ts) und der Heizperiode (heatingPeriodChange.ts) entfernen die Zeilen jedes
  Schlüssels, dessen Zeitraum sich ändert, und nennen sie in der Vorschau (`letters`, in der Marke); wechselt ein
  Mietverhältnis das Objekt, entfallen seine offenen Zeilen (`dropOpenTenancyLetters`, im Vorgang des Wechsels), die
  abgeschlossener Abrechnungen bleiben; ebenso beim Objektwechsel einer Wohnung für alle ihre Mietverhältnisse. Das
  Ausschalten der getrennten Heizkostenabrechnung und das Entfernen der Anlage entfernen die offenen Zeilen
  `heating:<Anlage>:…` (`dropOpenHeatingLetters`). Falsche Angaben zu Anschrift, Kontakt, Anrede und „mitdrucken“ sind
  ein `LetterInputError` (400).
- **Teil 2b: Logo und Briefpapier** (Regeln in [shared/letterDesign.ts](../../shared/letterDesign.ts), Dateien in
  [letterDesign.ts](letterDesign.ts), Zeilen in [db/letterDesign.ts](db/letterDesign.ts), Schritt 0070): Tabellen
  `letter_design` (eine Zeile, Installation; ohne Zeile die Vorgaben) und `property_letter_designs` (eigene Gestaltung
  je Objekt, CASCADE; ohne Zeile gilt die der Installation). Die Dateien liegen in `briefpapier/` im Datenordner,
  **Namen vergibt der Server** (`logo|paper-<16 Hex>.<Endung>`, Art am Inhalt erkannt, nie am Namen), nur PNG, JPG und
  (Briefpapier) PDF, Grenzen 2 MB (Logo) und 10 MB (Briefpapier). **Kein SVG** (Durchsicht S1): Eine Musterprüfung auf
  Skripte war umgehbar; die Oberfläche wandelt ein gewähltes SVG vor dem Hochladen in ein PNG um (300 dpi). Der Rand oben
  geht bis 70 mm (M1: Chromium wiederholt den Tabellenkopf ab rund einem Viertel der Seitenhöhe nicht mehr). **Ein Pfad entsteht nur aus einem Namen der eigenen
  Liste** (`designFilePath` setzt den Eintrag aus `referencedDesignFiles` ein, nie den Namen der Anfrage). Ausgeliefert
  mit `nosniff` und `Content-Security-Policy: … sandbox` (ein SVG, in einem eigenen Fenster geöffnet, führt nichts
  aus). `PUT` als Formular (`design` als JSON mit `keep`/`remove`/`new` je Datei, die Dateien daneben): erst die neuen
  Dateien schreiben, dann die Zeile in einer Transaktion, danach weg, was **keine** Gestaltung mehr nennt (Installation
  und Objekt können dieselbe Datei nennen, die eigene beginnt mit der Vorgabe); scheitert die Transaktion, gehen die
  neuen wieder weg. Das Löschen eines Objekts räumt seine Dateien ebenso. **Die Gestaltung ist Druck und friert nicht
  ein**: Sie ändert nur das Aussehen, nie eine Angabe. Backup packt `briefpapier/`, das Wiederherstellen nimmt nur Namen
  der eigenen Gestalt bis 10 MB, deren Inhalt zur Endung passt (`archivedDesignProblem`, sonst 400, nichts ersetzt).
  `GET /api/letter-design` nennt eine Datei, die im Ordner fehlt, als `null` und in `missing` (`presentDesign`, M2); die
  Seite druckt dann ohne sie. Die Seitenzahl einer PDF prüft nur die Oberfläche; der Server druckt ohnehin nur Seite 1. Eine Vorversion (#318) enthält nur die Datenbank; ein seither
  ersetztes Logo fehlt dann, die Antwort nennt es. Routen: `GET /api/letter-design` (`?property=`),
  `GET /api/letter-design/files/:name`, `PUT /api/letter-design`, `PUT /api/properties/:id/letter-design` (dazu `own`).
- **Druck nach DIN 5008** (#415): `sender.contact` (Kontakt für den Informationsblock), `premises` (Anschrift des
  Objekts, Wohnfläche der Wohnung, `null` ohne Fläche) und `labor35a` (je Position mit Lohnanteil Rechnungsbetrag und
  Lohnanteil der Rechnung) setzt `lettersOf` aus `units` und `costItems` der Route; sie frieren mit ein. Die Anschrift
  (`recipient`) nennt die Lage der Wohnung nicht mehr; eingefrorene behalten sie.
- Routen: `GET`/`PUT /api/letter-texts` (Installation, `adjustDefault`, `printLetter`), `PUT /api/properties/:id/letter-texts` (dazu `printLetter`, `null` = Vorgabe),
  `GET …/letters` und `PUT …/letters/:tenancyId` unter `/api/settlement/:period` und
  `/api/heating-settlement/:plant/:period`.

- **Monat der Anpassung und Übernahme in die Staffel** (#317, [prepaymentSteps.ts](prepaymentSteps.ts)): Das
  Anschreiben nennt den Monat (`{AnpassungAb}`, `StatementLetter.adjustment.from`); ohne eigene Angabe des Mieters
  (`tenancy_letter_adjustments.from_month`, Schritte 0073/0074) ist es der übernächste nach dem Tag des Briefs
  (`adjustFromFor`, `LetterSource.asOf` = `today()`, mit dem Abschluss eingefroren), **nie im abgerechneten Zeitraum**
  (dann der erste Monat danach); eine eigene Angabe im Zeitraum lehnt `PUT …/letters/:tenancyId` mit 400 ab. Das ist eine vorsichtige
  Vorgabe; § 560 Abs. 4 BGB nennt keine Frist (AG Mannheim, 8 C 552/06, Rn. 29: nächster Fälligkeitstermin).
  `POST …/prepayment-steps/plan` (unter `/api/settlement/:period` und `/api/heating-settlement/:plant/:period`) liest
  nur die abgeschlossene Abrechnung (sonst 409): je Mieter Betrag und Monat aus dem eingefrorenen Anschreiben (vor
  #317 ohne Monat: übernächster nach Versand bzw. Abschluss), Staffel (`heatingPrepayments` bei Weg d), Stand, Stufen
  ab dem Monat, Sätze zu Versand und Zugang, Fehler der Abrechnung (`blockingErrors` der eingefrorenen Hinweise),
  dazu eine Marke. `POST …/prepayment-steps` schreibt nur mit dieser Marke (sonst 409 mit neuem Plan), über
  `patchTenancyIn` (Verschmelzung und Wächter wie `PUT /api/tenancies/:id`) in einer Transaktion; eine Stufe desselben
  Monats wird ersetzt, spätere bleiben. Ein geänderter Monat im abgerechneten Zeitraum ist eine 400; steht er so im
  Schreiben, ist die Zeile gesperrt (`fixMonth`) und wird nie geschrieben. `earlier` nennt Stufen zwischen Zeitraumende
  und Monat. Gesperrt: Mietverhältnis
  endet vorher, oder eine Gesamtabrechnung neben einer eigenen Heizstaffel (der Betrag gilt beiden; nicht geraten).
  Rückfragen formuliert die Oberfläche (client/src/prepaymentSteps.ts) mit gelesenen Fundstellen: BGH VIII ZR 246/11
  (Leitsatz), VIII ZR 271/10 (Leitsatz 2), AG Köln 203 C 73/23 (Rn. 27).
- **Export als Daten** (#415 Teil 3, [settlementExport.ts](settlementExport.ts)): `GET /api/settlement/:period/export?format=json|csv`
  (`?property=` und Zeitraum wie die Abrechnung). Eine Stelle baut die Form; bei Abschluss gilt nur der eingefrorene
  Stand plus Rahmen (`frozenExportable`, nichts wird neu gerechnet; fehlen Pflichtfelder: 409). JSON: `format:
  'mietfuchs-abrechnung'`, `version: 1`, Beträge in Cent, je Mieter alle gedruckten Angaben (auch `prepaymentNote`,
  `heatingOnly`, `recommendedDeadline`, gewählte `adjustment`), je Zeile `kind`, dazu `heating` (die Blöcke wie die
  API sie liefert) und `draft`/`errors` bei einer offenen Abrechnung mit Fehlern (`blockingErrors`). CSV: Zeilen und
  Summen, die Art einer Sonderzeile statt „Position“, der Kopf „Gesamtkosten bzw. Anteil an der Gemeinschaft“ wie auf
  der Seite, vorweg eine Hinweiszeile bei Entwurf und eine, dass die Angaben der Heizkostenabrechnung nur im JSON
  stehen; Helfer aus taxReceipts.ts (BOM, Semikolon, deutsche Euro, Apostroph vor = + - @, auch nach Leerraum).
  Nur Zahlen und Namen wie auf der Abrechnung, keine Anschrift, Bank oder Anschreibentexte. Nicht für die
  Heizkostenabrechnung nach Weg d. Ändert sich die Form nach der Veröffentlichung, `version` anheben.

## Der Schnappschuss (#55)

[snapshot.ts](snapshot.ts): Die Berechnung liest den Speicher nicht selbst, sie bekommt einen
`Snapshot` (`snapshotFor`). `computeSettlement`, `rentLedger`, `taxReport` und
`consumptionOverview` nehmen nur ihn; er trägt den Zeitraum, damit er sich nicht mit einem anderen
verrechnen lässt. Er führt nur, was die Berechnung liest (`Pick` aus shared/types.ts).

- **Eingegrenzt wird nur, was seinen Zeitraum als Feld trägt** (Kostenpositionen, Abschluss).
  Ablesungen, Mietverhältnisse, Zahlungen, Wohnungen und Zähler gehen vollständig hinein, denn
  Anfangsstände und Staffeln „ab Datum“ können Jahre alt sein; wer dort filtert, bekommt still eine
  Falschrechnung.
- Er reicht die Datensätze durch, die Berechnung ändert nichts daran. Vom Objekt führt er nur, was
  gebraucht wird (`property`); fehlt es (Umstieg, Regression), rechnet sie wie ohne die Angabe.
- **Aufgefangen wird nichts**: Ist eine Sammlung `null` (#59), soll es krachen. Ein `?? []` ergäbe
  eine stimmig aussehende, falsche Abrechnung, in der jeder Mieter alles erstattet bekommt.

## Hinweise (#112)

Die Berechnung erzeugt `notices` (`Notice` in shared/types.ts): Code, Stufe, Titel, Text, `subject`
(daraus „Hier beheben →“), ggf. Regel. **Stufe, Titel und Regel hängen am Code** (`noticeKinds` in
calc.ts); `warn` nimmt nur Codes aus der Tabelle. Stufen: `error` = Position wird wegen
widersprüchlicher Angaben nicht verteilt, `warning` = Geld landet vermutlich anders als gewollt
oder eine Rechtsregel ist verletzt, `hint` = prüfen ohne sicheren Fehler. Eine Stufe hängt am Code,
deshalb bekommt ein anderer Fall einen eigenen Code.

- **`warnings` bleibt als Liste der Texte, Wortlaut unverändert**: Cockpit, ältere Tabs und
  eingefrorene Abrechnungen vor #112 lesen sie (`noticesOf` in client/src/notices.ts).
- **Ein `error` sichert das Abschließen ab** (#319): 409 mit `errorNotices` und `errorToken`, bis
  `despiteErrors` die Marke des einzufrierenden Stands trägt ([closeQuestion.ts](closeQuestion.ts));
  ausgenommen `INFORMATIONAL` ([shared/notices.ts](../../shared/notices.ts), `blockingErrors`). Die
  Oberfläche fragt bei denselben Fehlern vor dem Drucken einer offenen Abrechnung, und die gedruckte
  trägt dann „Entwurf, nicht versenden“ (siehe client/CLAUDE.md).

## Rechtsregister

Jede Rechtszahl steht nur in [shared/law/](../../shared/law), mit Gültigkeit, Fundstelle,
Prüfstand und **genau einer Zeitregel** (`periodStart`, `overlap`, `eventDate`, `incurred`; braucht
ein Fall zwei, sind es zwei Parameter). Entwurf: `2026-10-05-heizung-gesamt-design.md`, Abschnitt 4.

- **Abgefragt wird mit `law(param, ctx, log)`** ([shared/law/register.ts](../../shared/law/register.ts)):
  je Abrechnung ein Protokoll (`createLawLog`, kein globaler Zustand), gefragt erst, wo ein Wert
  gebraucht wird; die benutzten Werte stehen in `legalBasis.values` und frieren mit dem Abschluss
  ein (`deviation` meldet spätere Änderungen in `valueChanges`). **Ein Wert, der im Zeitraum nicht
  gilt, ist kein angewandter Wert**: `overlap` protokolliert bei `none` nichts; braucht ein Hinweis
  die Fassung trotzdem, trägt calc.ts sie mit `recordVersionAt` ein. Texte außerhalb einer
  Abrechnung (Lexikon, Anleitungen, Cockpit) lesen `valueAt(param, LAW_AS_OF)`. Das
  Regelverzeichnis ([shared/law/rules.ts](../../shared/law/rules.ts)) nimmt Daten und Zahlen aus den
  Parametern.
- **Eine Fassung wird nie geändert, nur eine neue angelegt** (`law-history.test.ts`). Erlaubt sind
  nur: das offene Ende schließen, wenn eine neue anschließt, und `null` eines überschreibbaren
  Werts durch den amtlichen ersetzen.
- **`law-literals.test.ts`** verbietet Prozentangaben einer Rechtsfolge außerhalb des Registers,
  Datumsliterale in den Dateien der Berechnung und die Zahlen des Registers im Code von calc.ts,
  snapshot.ts, shared/heating.ts und invoiceAmounts.ts; erlaubte Stellen stehen dort mit Grund.
- **Release-Sperre**: Beim Tag bricht release.yml ab, solange ein Wert `checked: 'unchecked'` hat
  (`law-release.test.ts`, mit Prüfung, dass der Sperrtest nicht übersprungen wurde).
- **Ein Stichtag, `LAW_AS_OF`**: Wer eine Regel oder einen Wert prüft, setzt `retrieved` der
  Parameter und `LAW_AS_OF` auf den Tag der Durchsicht (#110); es ist das jüngste `retrieved` und
  steht als Rechtsstand in jeder Abrechnung. Die **jährliche Durchsicht** geht jeden Parameter an
  seiner Fundstelle durch, legt bei Änderungen neue Fassungen an, trägt veröffentlichte Werte ein,
  sieht das BGBl. (HeizkostenV, CO2KostAufG, GModG, BetrKV, MessEV) und neue Urteile des VIII.
  Senats durch und setzt zuletzt `LAW_AS_OF`.
- **Werte, die erst später veröffentlicht werden** (`co2.price` ab 2027, `co2.price-ets`) sind
  `null` und `overridable`; nur `lawOverridable` fragt sie und liest einen Eintrag des Vermieters
  aus `law_overrides` (je Kalenderjahr, mit Quelle, [db/lawOverrides.ts](db/lawOverrides.ts)),
  protokolliert als `overridden` und genannt mit `law.value-overridden`. `law()` lehnt
  überschreibbare Parameter ab. Ins Register kommt, was im BGBl. steht oder das UBA nach § 4
  CO2KostAufG bekanntmacht, keine Drucksachen. Werte, die nur geprüft werden, tragen `checkOnly`.

## IBAN (#279)

Die Prüfung nach ISO 13616 steht einmal in [shared/iban.ts](../../shared/iban.ts). Geprüft wird nur
beim Speichern über die Routen (`acceptIban` in [iban.ts](iban.ts)) und im Formular
([client/src/ibanField.ts](../../client/src/ibanField.ts)), und **nur eine neu gesetzte oder
geänderte**: Eine gespeicherte ungültige, die unverändert mitkommt, hindert das Speichern nicht.
Backup, Wiederherstellen, Umstieg und Validator prüfen bewusst nicht (krumm, nicht kaputt). Leer
ist erlaubt. Das Cockpit nennt ungültige IBANs des gewählten Objekts als ruhigen Hinweis
([client/src/ibanCheck.ts](../../client/src/ibanCheck.ts)).

## Rechenweg (#114)

Jede Mieterzeile trägt `steps` (`CalcStep`), erzeugt dort, wo die Zeile entsteht, aus denselben
Zahlen. Der Restcent aus `largestRemainder` wird an der Zeile benannt, die ihn bekommt. Angezeigt
aufklappbar und `no-print` ([CalcSteps.tsx](../../client/src/components/CalcSteps.tsx)). Eine ältere
abgeschlossene Abrechnung ohne Schritte wird nicht nachgerechnet (`stepsOf`). Die Regression des
Umstiegs nimmt `steps` aus.

## Schlüssel merken und Vorjahr übernehmen (#141)

Entwurf: [docs/superpowers/specs/2026-10-02-schluessel-merken-design.md](../../docs/superpowers/specs/2026-10-02-schluessel-merken-design.md).

- **Der gemerkte Schlüssel einer Kostenart ist der ihrer Positionen im Vorjahr desselben Objekts**,
  abgeleitet, ohne eigene Tabelle. Was „derselbe Schlüssel“ heißt, steht einmal in
  [shared/allocation.ts](../../shared/allocation.ts), weil Vorschlag (costForm.ts) und Hinweis
  (`key.changed-from-previous-year`, `hint`) dasselbe meinen müssen. Widersprechen sich die
  Vorjahrespositionen, kein Vorschlag. Bei breiten Kostenarten (`BROAD_CATEGORIES`) zählt nur die
  Vorjahresposition mit derselben Beschreibung (`comparablePrevious`). Eine KI-Zeile mit gemerkten
  Teilnehmern oder Direktzuordnung ist nie vorab angehakt. Bei Heizung nennt der Hinweis § 6 Abs. 4
  HeizkostenV. Der Schnappschuss trägt `previousCostItems` (verteilt wird davon nichts).
- **„Aus dem Vorjahr übernehmen“ lebt nur im Browser** ([client/src/carryOver.ts](../../client/src/carryOver.ts)):
  keine Entwürfe in der Datenbank. Gespeichert wird über `buildCostItemBody`; Betrag, §35a-Anteil,
  Kosten der Gemeinschaft und Beleg kommen nie mit. Die Summe der MEA kommt bis #102 von der zuletzt
  erfassten Position „laut Gemeinschaftsabrechnung“ (`lastExternalBasis`).

## Doppelte Kostenpositionen

Ob eine Position dieselbe Rechnung sein könnte, steht **einmal** in
[shared/duplicates.ts](../../shared/duplicates.ts) (`sameCostCandidates`): Objekt, Jahr, Kostenart;
bei breiten Kostenarten (`LOOSE_CATEGORIES`) zusätzlich ähnliche Beschreibung oder gleicher
Rechnungssteller. Die Regel findet nur Kandidaten, entscheiden tut der Vermieter. Sie fragen
`alreadyCarried`, der Vorschlag jeder Zeile einer Auswertung (`describeAssessment`, nicht vorab
angehakt), das Kostenformular beim Anlegen („Stattdessen … bearbeiten“) und der Hinweis
`cost.possible-duplicate`. Dieser kommt nur, wenn eine Position der Gruppe keinen Beleg hat und
(a) eine andere einen hat oder (b) schon das Vorjahr Positionen dieser Art hatte und das Jahr
mehr davon hat. Gezählt wird
im Jahr des Belegs (`detected_year`), nicht im gewählten.

Gezählt wird **je Rechnung** (#455): Die Teile einer Quelle sind eine Rechnung (`invoiceOf`), im selben Zeitraum melden sie
einander nicht. Belegt ist eine Rechnung, wenn ein Teil in irgendeinem Zeitraum den Beleg trägt (`receiptedSources`; der
Schnappschuss trägt `receiptedSources`, weil er sonst nur seinen Zeitraum sieht). Dieselbe Regel gilt für Belegabdeckung,
Abzeichen, Cockpit und Belegmappe (`isItemCovered` mit `partsBySource`); „Hier beheben“ führt nie zu einem Teil einer
belegten Rechnung. Die Kostenliste zeigt unter einem Teil „Teil von N“. Bei der Belegbuchung ist ein Teil kein Ziel zum
Verknüpfen (`formOnly`, `part`): Die Zeile wird verworfen, wenn der Teil stimmt. Lösen lässt seinen Betrag stehen. Das Steuer-ZIP folgt derselben Regel (#469, siehe Belegordner).

Ist eine aufgeteilte Rechnung an der Gruppe beteiligt, richtet sich der Rat nach der Quelle, nicht nach der Zahl der
Teile im Zeitraum (die übrigen sieht die Gruppe nicht): nie „setzen Sie ihren Betrag auf den der Rechnung“, gelöscht
wird eine aufgeteilte Rechnung nur mit allen Teilen, auch denen in anderen Zeiträumen, das gilt für beide Seiten. Als
aufgeteilt zählt `isInvoicePart`, also auch ein alter Teil ohne Quelle. Ohne Teil in der Gruppe bleibt der Wortlaut.
Zwei Positionen, deren Leistungszeiträume beide angegeben sind und sich nicht überschneiden, verbindet
`possibleDuplicates` nicht (`separateService`; die Versicherung Juli bis Juni, zwei Jahre nacheinander); verbindet sie
eine dritte ohne Leistungszeitraum, führt „Hier beheben“ zu der Rechnung ohne Beleg, die zu allen anderen passt;
passt keine und gibt es mehrere ohne Beleg, zur ersten, und der Rat sagt bei einer aufgeteilten „eine der Rechnungen ohne
Beleg“ statt „die Rechnung ohne Beleg“ (#471; ohne Teil bleibt der Wortlaut). „Betrag prüfen“ im Belegordner nennt bei
einem alten Teil ohne Quelle die Zeiträume und die Beschreibung, unter denen die übrigen Teile stehen.
`sameCostCandidates` und damit Kostenformular und Belegbuchung fragen weiter ohne Leistungszeitraum.

## Belegbuchung (#170)

Entwurf: [docs/superpowers/specs/2026-10-02-belegbuchung-design.md](../../docs/superpowers/specs/2026-10-02-belegbuchung-design.md).
Eine Rechnung landet genau einmal in den Kosten, weil **der Server bucht, nicht die Seite**.

- **Eine Auswertung ist ein gespeicherter Gegenstand** (`assessments`, `assessment_lines`), eine je
  Beleg, gespeichert nur nach Erfolg der KI (ein Abbruch speichert nichts). Der Zustand einer Zeile
  wird **abgeleitet** (`lineState`): ohne `cost_item_id` offen oder verworfen, mit ihr angelegt oder
  verknüpft; `ON DELETE SET NULL` macht Zeilen einer gelöschten Position wieder offen.
- **Zeilennummern kommen aus einer Hochwassermarke** (`next_idx`) und werden nie wiederverwendet;
  die Routen sprechen Zeilen über sie an. Erneutes Auswerten ersetzt nur offene und verworfene
  Zeilen. Kommen dabei Zeilen **neben gebuchten** hinzu, tragen sie `reassessed`: Die aus diesem
  Beleg gebuchten Positionen sind ihre Kandidaten, gleich welcher Kostenart, die Zeile ist rot, und
  Anlegen wie Verknüpfen brauchen `despiteCandidates` (sonst Rückfrage bzw. 400). Für die erste
  Auswertung gilt das nicht.
- Weitere Spalten: `detected_year` (Ampel „Rechnungsjahr ≠ Zieljahr“), `requested_year` (weicht
  `year` ab, ist die Zeile gelb, nicht vorab angehakt und nicht in „Alle grünen übernehmen“),
  `amounts_adjusted`/`labor_from_total`, `category_guessed` (gelb).
- **Planen ist eine reine Funktion** (`planBooking` in [bookingPlan.ts](bookingPlan.ts)), Buchen
  führt die Schreibliste in einer Transaktion aus ([db/booking.ts](db/booking.ts)).
- **Summenregel**: Der Betrag einer Position mit Zeilen ist die Summe **aller** ihrer Zeilen über
  alle Belege; der §35a-Lohn die Summe der gelesenen, und nennt keine einen, wird ein vorhandener
  entfernt. Schätzung, Handbetrag und ungelesener Beleg werden ersetzt, die Vorschau sagt es
  vorher. Ziele nur im Objekt und Jahr der Auswertung; `amounts` und `external` sind keine Ziele
  („Position öffnen“). **Gutschriften werden nie verrechnet**: Gutschrift-Positionen sind keine
  Ziele, eine Gutschrift-Zeile hat nur Gutschriften als Kandidaten.
- **Hängt der Beleg (oder einer gleicher Prüfsumme) schon von Hand an einer Position**, ist sie
  Kandidat jeder seiner Zeilen, gleich welcher Kostenart (`lineCandidates`): rot, Anlegen nur mit
  Bestätigung. Derselbe Beleg kann nicht zweimal an dieselbe Position.
- Beim Lösen einer Zeile wechselt der Beleg der Position nur, wenn der gelöste ihr Beleg war.
  Verwerfen ergibt einen Hinweis je Zeile. **Ein Teil einer aufgeteilten Rechnung** (`isInvoicePart`) behält beim
  Lösen seinen Betrag (die Summe der übrigen Zeilen wäre die ganze Rechnung); die Vorschau sagt es.
- **Eine Zeile wird nie zweimal gebucht**: „genau so gebucht“ ist Erfolg ohne Änderung
  (Doppelklick, Wiederholung), **jede Abweichung 409 mit aktuellem Stand**. Die Vorschau trägt eine
  Marke (`token`, SHA-256 über `tokenSource`); weicht der Stand ab, 409 mit neuer Vorschau. Gebucht
  wird immer im Objekt der Auswertung. **Objekt und Jahr sind nach der ersten gebuchten Zeile fest**
  (`placeAssessment` → 409); bis dahin ziehen sich Posteingang und Auswertung Jahr und Objekt
  gegenseitig nach.
- **Prüfungen in shared/**: `amountProblem`, `costItemBody` (shared/costItem.ts), Ampel und
  Vorauswahl (shared/assessment.ts), Kostenarten (shared/categories.ts). `POST`/`PUT /api/costItems`
  prüfen noch nicht damit.
- **Routen**: `/api/extract` und `/api/intake` liefern `assessment`; `GET /api/assessments`,
  `GET`/`PUT …/:id`, `POST …/plan`, `POST …/book`. `GET /api/uploads` nennt `bookedItemIds` und
  `bookedCents`; ein nur über eine gebuchte Zeile verknüpfter Beleg zählt als verknüpft
  (Posteingang, Abdeckung, Mappe, Steuer-ZIP, Löschsperre, Belegkopien der Abrechnung über
  `filesOfItem` in client/src/costPeriods.ts, #470). Fehlt die Datei einer Auswertung, fehlt
  sie in der Liste, und `plan`, `book`, `PUT` antworten 404.
- **Oberfläche**: eine Komponente für Schnellerfassung und Kostenseite
  ([AssessmentReview.tsx](../../client/src/components/AssessmentReview.tsx), Logik in
  [client/src/assessment.ts](../../client/src/assessment.ts), Warteschlange `useEvaluationQueue`).
  „Alle grünen übernehmen“ bucht je Auswertung nacheinander. jsdom-Tests rechnen mit dem echten
  Planer ([client/src/testing/fakeBooking.ts](../../client/src/testing/fakeBooking.ts)); für Praxislauf
  und Browserprobe gibt es [scripts/fake-ollama.mjs](../../scripts/fake-ollama.mjs).

## Testgriffe

Nur für Tests, ein Nutzer setzt sie nie:

- **`NKA_TEST_ASSESSMENT_DELAY_MS`** verzögert das Speichern einer Auswertung (Abbruch zwischen
  Antwort der KI und Speichern).
- **`NKA_TEST_TODAY`** (JJJJ-MM-TT) fixiert die Uhr des Servers (`today()`, testToday.ts), damit
  Prüfbestände mit festen Jahren nicht an einem Datum kippen. Wirkt nicht auf den Browser; die
  Konsole nennt ihn beim Start, ein ungültiges Datum bricht den Start ab.
- **`NKA_TEST_IDS=seq`** vergibt fortlaufende Kennungen im selben Format (16 Hexziffern, [ids.ts](ids.ts)),
  damit der Beispielbestand für README-Bilder und Browserlauf in jedem Lauf gleich ist; bei Gleichstand
  entscheidet die Kennung über den Rest-Cent. `startServer` in scripts/demo-stock.mjs setzt ihn. Der Zähler beginnt je
  Prozess bei 1, also nur auf einem leeren, einmal gestarteten Datenordner; die Konsole nennt ihn beim Start. Unter
  `seq` gewinnt bei Gleichstand immer der zuerst angelegte Datensatz, im Betrieb ein zufälliger.
- `NKA_TEST_START_DELAY_MS`, `NKA_TEST_FREE_BYTES`: siehe scripts/CLAUDE.md bzw. db/CLAUDE.md.

## Berechnungs-Engine

[calc.ts](calc.ts), das Herzstück. Heizungsregeln (Betriebsstrom, Contracting, § 5a, Mieter heizt
selbst) stehen in [docs/heizung.md](../../docs/heizung.md).

### Nicht vereinbart (#258)

`CostItem.notAgreedTenancyIds` (Mieter, die die Kosten laut Vertrag nicht tragen) und `namedTenancyIds`
(bei „Sonstige“: im Vertrag genannt) liegen in `cost_item_contract`. Der Anteil eines nicht
vereinbarten Mietverhältnisses geht als `LandlordReason` `notAgreed` an den Vermieter; die Einheit
bleibt im Verteilschlüssel, **der Anteil fällt nie auf die anderen Mieter** (Zufallsinvariante in
calc.test.ts). Der Server lehnt beide Listen bei Heizung, Nicht umlagefähig und Rücklage ab.
Hinweise: `allocation.not-agreed` (nur Info), `allocation.other-unanswered` (färbt das Cockpit).

### Verteilen

- **Alle Beträge in Cent (Integer)**, niemals Euro-Floats.
- **Eine Rundungsregel für jede Verteilung** (#202, `distributeCents`): Jede Position wird genau
  einmal nach Hare/largest-remainder verteilt, über alle Empfänger zugleich, also die Mieter **und
  je Grund eine Zeile des Vermieters** (Eigennutzung, Pauschale, Inklusivmiete, nicht vereinbart, außerhalb, Rest der
  Vereinbarung, Rest des Hauptzählers, zuletzt Leerstand bzw. Rest der Einzelbeträge;
  `landlordRecipients`). Jede Zeile ist ihr exakter Wert ab- oder aufgerundet, keine wechselt das
  Vorzeichen, exakt 0 bekommt nie einen Cent. Gleichstand: erst der Vermieter, dann die Kennung per
  `compareText`. Gutschriften spiegelbildlich. Der Eigenanteil ist genau die Zeile `selfUse`.
- **§35a-Lohn wird innerhalb der Kostenanteile verteilt** (`distributeLaborCents`): je Zeile nie
  über dem Kostenanteil, zusammen genau L. Nicht Lohn und Rest getrennt verteilen (zwei Rundungen
  weichen bis fast 2 Cent ab). Zufallstest über `onAllocation`.
- **Umlageschlüssel** (`item.key`): `area`, `persons` (personentagesgenau), `units`, `meter`
  (Verbrauch nach Zählertyp), `direct`, `custom` (vereinbarte Prozente absolut, was unter 100 %
  fehlt, trägt der Vermieter), `external` (laut Gemeinschaftsabrechnung) und `amounts`
  (Einzelbeträge je Mietverhältnis).
- **Nicht vereinbart** (#258): Ein Mietverhältnis in `notAgreedTenancyIds` bleibt in der Verteilbasis, sein Anteil
  geht als `notAgreed` an den Vermieter (`bookable`), bei jedem Schlüssel. Nicht bei Heizung, nicht Umlagefähigem und
  an Übertragszeilen (`contractTenancyIds`; das Wiederherstellen prüft die Kostenart nicht). Hinweise
  `allocation.not-agreed` je Mietverhältnis und `allocation.other-unanswered` bei „Sonstige Betriebskosten“ ohne
  Antwort (`namedTenancyIds`). Invariante in calc.test.ts: Die Summe der übrigen Mieter ändert sich nicht.
- **Verteilbasis je Position** (#94): `participantUnitIds` grenzt auf Teilnehmer ein; ohne
  Teilnehmer ist sie **dasselbe Objekt** wie zuvor (`fullBasis`), damit keine Zahl wandert. Bei
  `external` **trägt die Position den eigenen Anteil** laut Hausgeldabrechnung, nicht die Summe der
  Anlage; `externalBasis` (Maßstab, Summe, Gesamtkosten) dient Rechenweg und Plausibilität,
  verteilt wird nach `mea`, Fläche oder 1 je Wohnung. Bei `amounts` ist der Anteil genau der Betrag
  ohne Tagesanteil, der Rest beim Vermieter; eine Summe über dem Rechnungsbetrag wird nicht
  verteilt. Tests: calc-verteilbasis.test.ts.
- **Beteiligung je Wohnung** (`UnitUsage`): `participates` = vermietet; `selfUsed` = selbstgenutzt,
  zählt in die Basis von `area`/`units`/`persons` (mit `selfPersons`), Anteil beim Vermieter (als
  `selfUsedShareCents` gesondert, für die Steuer privat); beides `false` = außerhalb, ganz außen
  vor. Ein Datenschritt setzt das Kennzeichen nie automatisch, weil es abgerechnete Jahre änderte.
- **Nutzungswechsel** (#259, Entwurf
  [docs/superpowers/specs/2026-10-23-nutzungswechsel-design.md](../../docs/superpowers/specs/2026-10-23-nutzungswechsel-design.md)):
  Die Nutzung ist eine Staffel „ab Tag“. Die erste Stufe ist die Angabe an der Einheit, jede Zeile in
  `unit_usage_changes` (`Unit.usageChanges`) gilt ab ihrem Tag; dasselbe Muster wie `period_start_month` mit
  `period_changes`, deshalb keine Datenanweisung. „Nutzung am Tag t“ steht nur in
  [shared/unitUsage.ts](../../shared/unitUsage.ts), auch die Fragen der Oberfläche (`rentedWithin`, `selfUsedWithin`
  …). computeSettlement zählt je Einheit die Tage je Nutzung (`usageIn`); **ohne Wechsel im Zeitraum ist jeder
  Faktor genau 1 oder 0**, halte das ein, wenn du eine Formel anfasst. Wechselt eine Einheit zwischen drinnen und
  außerhalb, verteilen Fläche, Einheiten und Gemeinschaft **je Abschnitt** (`segmentsOf`, `segmented`; eine Rundung
  je Position); vereinbart, direkt, Verbrauch und Personen brauchen das nicht (Begründung im Entwurf). Für die
  Kosten zählt ein Mietverhältnis nur in seinem ersten vermieteten Abschnitt (`costTenancies`; Abrechnung und
  Vorauszahlungen am ganzen, `partTenancies`), sonst `usage.tenancy-conflict` (`error`). Liegt ein Mietverhältnis ganz in
  einer Zeit ohne Vermietung, hat es keine Abrechnung; es steht dann in `notSettled` mit `usageConflict` (seine
  Vorauszahlungen, die keine Abrechnung anrechnet), und der Hinweis nennt den Betrag, auch in der
  Heizkostenabrechnung nach Weg d (dort mit deren Anrechnung, `prepaymentOf`). Eine CO₂-Erstattung lässt sich dort nicht
  verrechnen (eigener Satz in db/co2Refunds.ts). Der Vorschlag nach § 560 rechnet
  bei einem Widerspruch je Zeile hoch: die Zeilen der eigenen Heizkostenabrechnung (Schlüssel `heatingSystem` samt
  Abzugszeilen ihres Topfs, `wholeTime`) auf die Tage des Mietverhältnisses, denn dort bleibt es Nutzer für seine ganze
  Zeit, die übrigen auf die Tage mit Kosten (`costDays`); sonst halbierte bzw. verdoppelte er sich bei einem Wechsel zur
  Jahresmitte. Ohne Widerspruch rechnet er unverändert über die Summe. Der Rest des Hauptzählers
  ist je Tag Eigenanteil, an dem alle Einheiten ohne Zähler selbstgenutzt sind (`daysAllSelf`, Auslegung). „Selbst bewohnt“ (§ 2 HeizkostenV, § 5d) nur an jedem Tag (`dwellerUnits`). In der eigenen
  Heizkostenabrechnung teilt `usersOf` an den Grenzen der Staffel (§ 9b). Bei „nur Heizung“ nach Gradtagen werden
  Eigenanteil und außerhalb nach demselben Maß gewichtet (`itemSelfShare`). Die Steuer rechnet tagesgenau über
  `taxUsage`, und zwar über den **ganzen Zeitraum des Teils**, nicht nur seinen Schnitt mit dem Steuerjahr (Fläche ×
  Tage der Eigennutzung, Kopf der Anlage V, Ausgleich beim Betriebsstrom, verbilligte Vermietung in cheapRent.ts). Hinweis
  `usage.changed` (`hint`) nennt die Abschnitte und dass gleichmäßiger Anfall eine Auslegung ist. Eine Invariante über alle Funktionen von 0.13.0 zugleich
  (Nutzungswechsel, verbilligte Vermietung, Betriebsstrom, Kalenderjahr und Mai bis April) steht in
  invariant-0-13-zusammenspiel.test.ts, Bestände in server/testing/integration013.ts.
- **Verbrauchsschlüssel**: Die Basis bilden **alle** Wohnungszähler, unabhängig vom Kennzeichen.
  **Fehlt einer bewohnten Einheit der Verteilbasis ein Zähler, wird der Hauptzähler zur Basis**
  (#116, Vorwegabzug): ihr Verbrauch ist der Rest; bei Eigennutzung als Eigenanteil, bei einer
  vermieteten Wohnung beim Vermieter mit Warnung. Gefragt wird ohne Teilnehmer nach allen Einheiten
  des Objekts (auch außerhalb), nur nach **bewohnten**; ein Zähler ohne Ablesung im Zeitraum zählt
  nicht (`coveredDays`); ein Hauptzähler, der nicht den ganzen Zeitraum deckt, wird nicht zur Basis,
  sondern ergibt eine Warnung. Mit Teilnehmern gilt der Hauptzähler nie. `noConnection` je Zählertyp
  (#117, `unit_no_connection`): der Einheit fehlt dann kein Zähler.
- **Leerstand beim Personenschlüssel** (#177): Jede vermietbare Wohnung der Basis zählt je Tag ohne
  Mietverhältnis mit `VACANCY_PERSONS` (1) Personen; der Anteil bleibt als `vacancy` beim Vermieter.
  **Das ist eine Auslegung an genau einer Stelle** (höchstrichterlich nicht geklärt; VIII ZR 159/05,
  VIII ZR 180/12), Hinweis `basis.vacancy-persons` und Lexikon sagen das. `item.no-basis` hängt an
  den Personentagen der Bewohner (`occupantPersonDays`). **Wohnung ist, was Fläche hat oder bewohnt
  ist** (`isDwelling`, wie bei § 2 HeizkostenV): eine leere Garage ohne Fläche ist kein Leerstand
  (eine ganz leere meldet `basis.vacancy-no-area`).
- **Überschneidende Mietverhältnisse einer Wohnung** (#204): Die Regel (ein gemeinsamer Tag) steht
  einmal in [shared/tenancyOverlap.ts](../../shared/tenancyOverlap.ts). Gerechnet wird wie erfasst,
  mit `tenancy.overlap` (`error`) und beziffertem Mehrbetrag (`overlapExtra`): je Position, was die
  Wohnung ohne die doppelten Tage **eines** der beiden weniger trüge, beide Lesarten, Kosten und
  Gutschriften getrennt, je Position zur Seite „zu viel“ geklemmt. Beim Personenschlüssel wird neu
  geteilt. Der Server lehnt nicht ab, Validator, Umstieg und Backup rücken nichts gerade; die
  Stammdaten fragen beim Speichern nach.

### Mietmodell und Staffeln

- **Nebenkostenmodell am Mietverhältnis** (#93): `costModel` (kalt) und `heatingModel` (Kostenart
  „Heizung und Warmwasser“, `HEATING_CATEGORY`), je `settlement | flatRate | inclusive`, fehlend
  `settlement`; beim Heizmodell zusätzlich `selfSupply` (wird über `allocationModel` als
  `settlement` gelesen). Pauschale und Inklusivmiete **bleiben in der Verteilbasis**; ihr Anteil
  fällt dem Vermieter zu, **nicht als Eigenanteil** (abziehbar). Bleibt die Abrechnung leer und gibt
  es keine Vorauszahlung, steht das Mietverhältnis in `notSettled`. **Die Pauschale hat eine eigene
  Staffel** (`flat_rates`): das Mietkonto führt sie im Soll, die Abrechnung rechnet sie nie an.
  Warnung nach § 2 HeizkostenV außerhalb des selbstbewohnten Zweifamilienhauses. Die drei Listen
  der Kostenarten (Oberfläche, KI-Schema, Anlage V) hält categories.test.ts zusammen.
- **Staffeln statt Neuanlage**: Personenzahl (`personHistory`, ab Datum; die erste gilt ab Einzug),
  Vorauszahlung (`prepayments`, ab Monat), Kaltmiete (`baseRents`). Die tatsächlich gezahlten
  Vorauszahlungen je Zeitraum (`prepaymentOverrides`) haben Vorrang, denn anzusetzen ist das
  Geleistete (VIII ZR 240/10, Rn. 16); ohne Eintrag rechnet Mietfuchs mit dem Soll, und
  `prepayment.arrears` weist darauf hin.
- **Die Monatsregel steht an einer Stelle** (#311, `monthShare`, `rateInMonth` in shared/monthRate.ts) für Abrechnung und
  Mietkonto: Ein Monat zählt, sobald das Mietverhältnis an einem seiner Tage besteht; im
  angebrochenen Monat `round(Rate × Tage / Tage des Monats)`, bei getrennter Heizstaffel je Staffel
  gerundet. **Das ist eine Auslegung** (Kalendertage wie auf der Kostenseite; 1/30 wäre ebenso
  vertretbar), `prepayment.partial-month` (`hint`) nennt sie. Eine Invariante hält Abrechnung und
  Mietkonto je Mietverhältnis gleich.
- **Zeiträume** sind ISO-Strings mit inklusiven Grenzen in UTC; `end: null` = offen.

### Zähler

- Ablesungen → Segmente (`meterSegments`), tagesanteilig interpoliert (`consumptionInPeriod`).
  Zählerwechsel über `replacement: true` + `oldEndValue`. Warnungen bei negativem Verbrauch, bei
  **Wechsel ohne `oldEndValue`** (#83; gefragt wird nach `null`, denn 0 ist eine Angabe; es entsteht
  kein Segment) und bei **zwei Ablesungen am selben Tag** (#69; die Differenz wird nicht verteilt,
  welche stimmt, weiß nur der Vermieter). In allen drei Fällen zahlt die Lücke nicht der Vermieter,
  sondern ein anderer Mieter, weil Zähler und Nenner gemeinsam schrumpfen; die Warnung ist das
  Einzige, was darauf stößt. Validator und Schema lehnen solche Bestände bewusst nicht ab.
- **Diese Warnungen erscheinen nie auf der Abrechnung**, nur über `consumptionOverview` auf der
  Zähler-Seite und im Cockpit (Ampel „Zählerstände“ rot): Die Abrechnung ist das Dokument für den
  Mieter.
- **Einheiten** (#342, [shared/meterUnits.ts](../../shared/meterUnits.ts)): Text am Zähler, beim Lesen
  normiert (`unitKey`), keine Migration. Wärme kWh/MWh/GJ, Wasser m³/l, Strom kWh/MWh als exakte
  Brüche; Heizkostenverteiler und „Sonstiges“ (auch Gas) ohne Umrechnung. **Leitsatz: Ein Bestand,
  der vorher richtig rechnete, ändert sich nicht.** Wer Verbräuche mehrerer Zähler addiert, fragt
  `unitScale`, **nur mit den Zählern, die im Zeitraum beitragen**. `relative` (Verbrauchsschlüssel,
  eigene Heizkostenabrechnung): einheitlich heißt Faktor 1, auch bei MWh oder unbekannter Einheit;
  nur gemischt bekannte Einheiten werden umgerechnet (dann `heating.estimate-base-unit` bei einer
  Schätzung im Topf). `base` (absolute Vergleiche: α, Volumenvorschlag, monatliche Information, § 6a
  in kWh) rechnet bekannte Einheiten immer um. Ohne Einheit gilt der Zähler wie die übrigen; eine
  für die Sparte unbekannte sperrt nicht (`meter.unit-unknown`, warning); `meter.units-mixed`
  (error) nur bei verschiedenen bekannten Größen ohne Umrechnung. Der Server prüft nur eine neue
  oder geänderte Einheit (`acceptMeterUnit`, Muster der IBAN) und nimmt bei Sparten mit Auswahl keine
  neue leere an.
- **Eichfrist** (#98) ist eine Warnung, keine Sperre: `meters.calibrated_until` (Jahr, mit dessen
  Ende die Frist endet, § 34 Abs. 2 MessEV) ergibt `meter.calibration-overdue` nur in
  `consumptionOverview`, nie auf der Abrechnung (die Regel hat `scope: 'meters'`, `rulesFor` lässt
  sie aus dem Rechtsstand). Geprüft wird die jüngste Ablesung, die der Zeitraum benutzt
  (`readingsUsedFor` in calibration.ts); nach einem Wechsel am letzten Tag kein Hinweis. Cockpit:
  eigene gelbe Zeile, nicht in der Ampel „Zählerstände“. Heizkostenverteiler haben kein Eichjahr
  (gesendet: 400). Fristen im Register (`messev.calibration-years`): ab 2015 Kaltwasser 6,
  Warmwasser und Wärme 5 Jahre, ab 03.11.2021 je 6. Die Änderungsverordnung vom 26.10.2021 enthält
  keine Übergangsregel. Mietfuchs wendet die Frist von 6 Jahren auch auf Fristen an, die am
  03.11.2021 noch liefen; eine schon abgelaufene Frist lebt nicht wieder auf. Das ist eine
  Auslegung. Gerechnet wird sie in `calibrationEnd` (shared/calibration.ts). Keiner Behörde oder keinem Messdienst
  zugeschrieben; Hinweis, Regel und Lexikon zitieren VIII ZR 112/10 nur mit dem Wortlaut von
  Leitsatz c (calibration.test.ts hält beides fest). Gas- und Stromzähler: Feld ohne Vorschlag.
  **Beim Zählerwechsel** nimmt `POST /api/readings` mit `replacement: true` ein `newCalibratedUntil` mit
  (`createReading` in db/repository.ts): das Jahr des neuen Geräts, in einer Transaktion mit der Ablesung an den
  Zähler geschrieben und geprüft wie dort (`guardMeter`); ohne Wechsel 400, `null` wie nicht gesendet, im `PUT` einer
  Ablesung 400. Gefragt wird nur im Fenster der Seite Zähler, nicht in der Schnellerfassung. Das bisherige Jahr wird ersetzt, nicht
  aufbewahrt: Für einen Zeitraum, in dem das ausgebaute Gerät schon abgelaufen war, entfällt dessen Warnung
  (bekannte Grenze; das Jahr je Gerät hieße eine Spalte an der Ablesung).

### Mietkonto

`rentLedger`: Kaltmiete + Vorauszahlung (+ Heizstaffel, Pauschale) ergeben das monatliche Soll;
Mietzahlungen werden Jan→Dez FIFO auf die Monate verteilt. Im angebrochenen Monat anteilig
(`rateInMonth`, die Zeile trägt `share`). #281 (Übertrag, Tilgung nach § 366 BGB) baut darauf auf.

- **Nur die Miete** (#280): `payments.kind` ist `rent` oder `settlement` (fehlend: Miete,
  `isRentPayment`). Nachzahlungen und Guthaben (negativ) aus der Abrechnung verteilt das Mietkonto
  nicht, es führt sie in `settlementYearCents` bzw. `settlementOnly`. `prepayment.arrears` und
  `tenanciesWithoutPayment` fragen nur Mietzahlungen. Ein mit der Miete verrechnetes Guthaben ist
  volle Miete plus negative Abrechnung. Die Kaution gehört nicht dazu (#228).

### Steuer (Anlage V)

`taxReport`: Einnahmen (Soll aus `rentLedger`, Ist aus den Zahlungen), Werbungskosten nach
`ANLAGE_V_GROUP`, §35a-Summe, Gesamt- und selbstgenutzte Fläche (#68: **das Private wird gemessen**,
Grundmenge ist das ganze Gebäude), Überschuss. Beschreibende Gruppen statt fester Zeilennummern.

- **Maßgeblich ist das Ist** (#70, § 11 Abs. 1 EStG); das Soll bleibt umschaltbar zum Abgleich
  (Logik in [client/src/taxView.ts](../../client/src/taxView.ts)). Ein Soll als Vorgabe wäre unsichtbar
  falsch, 0 € dagegen sichtbar. **Das Ist kommt nicht aus dem Mietkonto**, sondern zählt jede Zahlung
  mit Datum im Jahr (sonst fielen die im Januar eingehende Dezembermiete nach Auszug und der
  vorgezogene Dauerauftrag aus beiden Jahren). Beide Arten zählen; `settlementBackPaymentsCents`
  und `settlementRefundsCents` stehen daneben. Die Zehn-Tage-Regel (§ 11 Abs. 1 Satz 2) ist nur ein
  Hinweis, denn sie hängt an der vertraglichen Fälligkeit.
- **Vorauszahlungen**: `taxReport` führt `prepaymentSollCents` und `prepaymentSettlementCents`
  (aus der Abrechnung, bei Abschluss eingefroren, nie ein zweites Mal ausgelegt). Die Oberfläche
  erklärt einen Abstand, **ohne ihm eine Ursache zuzuschreiben** (Jahreskorrektur und
  unterschiedliche Grundmengen tragen beide bei).
- **Zeilen**: Nummern nur, wo der amtliche Vordruck sie belegt (2025: 11, 12, 33/34, 87/88; Zeile 21
  für 2023 bis 2025, Fundstellen an `settlementLine` in taxView.ts). Die Seite zeigt den Zufluss in
  zwei Teilen, die zusammen den Zufluss ergeben (`paidWithoutSettlementCents`,
  `settlementBalanceCents`), sonst zählte mancher den Saldo doppelt. Kopfzeilen am Mietmodell (#96):
  `costModels` zählt ganz/teilweise inklusiv und Pauschale; die Pauschale bei Zeile 20 ist Auslegung.
- **Teilweise Eigennutzung** (#163, `splitForTax`, Entwurf
  [docs/superpowers/specs/2026-10-02-steuer-eigennutzung-design.md](../../docs/superpowers/specs/2026-10-02-steuer-eigennutzung-design.md)):
  jede Position in privat und abziehbar. Direkt zugeordnet ganz zu ihrer Einheit; nicht umlagefähig
  nach der Fläche der betroffenen Einheiten (BFH IX R 26/06); **umlagefähig mit dem Eigenanteil der
  Abrechnung**, damit beide dasselbe sagen, **außer** eine betroffene Einheit liegt außerhalb der
  Abrechnungseinheit: dann bei Schlüsseln über Wohnungen die Gebäudefläche, Hinweis mit Richtung des
  Abstands (`excludedAreaDifference`, Auslegung; `areaPrivateCents` zum Vergleich). Leerstand
  (`vacancy`) ist nicht privat. Nicht verteilt (`noBasis`): Fläche. Bei Abschluss kommen die
  Eigenanteile aus dem eingefrorenen Stand, nur für Positionen mit unverändertem Betrag
  (`closedItemsChanged`). `abziehbar = Betrag − privat`; **der Überschuss rechnet mit
  `deductibleCents`**. Ohne Eigennutzung ändert sich keine Zahl (Invariante). „Nicht umlagefähig“
  lässt sich für die Steuer Einheiten zuordnen (`key: 'direct'`, `participantUnitIds`); die
  Abrechnung liest das nicht. AfA, Schuldzinsen und § 82b EStDV werden nur genannt; einen Nutzungswechsel (#259)
  rechnet die Übersicht nach Tagen (`taxUsage`, siehe Verteilen).
- **Verbilligte Vermietung** (#257, [cheapRent.ts](cheapRent.ts), Grenzen in `estg.cheap-rent`,
  [shared/law/estg.ts](../../shared/law/estg.ts)): Die ortsübliche Warmmiete steht **an der Wohnung**
  (`Unit.localRents`, Tabelle `unit_local_rents`, Staffel ab Monat mit Quelle und Datum), weil sie an Wohnung und
  Zeit hängt und über einen Mieterwechsel weitergilt; die vereinbarte Miete steht am Mietverhältnis. Quote je
  Mietverhältnis und Kalenderjahr = Entgelt / ortsübliche Miete derselben Monate (im angebrochenen Monat nach Tagen,
  `rateInMonth`). **Entgelt** = vereinbarte Kaltmiete (Soll; BFH IX R 7/20, Rz. 11) + gezahlte Umlagen (BMF-Schreiben
  vom 08.10.2004, BStBl I S. 933, Rz. 11; OFD Frankfurt, Rundvfg. vom 17.06.2025, Tz. 3): der Anteil des Mieters an
  den Kosten laut Abrechnung über genau das Kalenderjahr (heute gerechnet, der eingefrorene Stand führt keine
  Mieterzeilen), sonst das Soll der Vorauszahlungen; die Pauschale mit ihrem Soll. Verglichen wird in ganzen Cent,
  nicht über die Gleitkommaquote. Unter der Grenze von Satz 1 (`split`) wird gekürzt, darunter bis Satz 2 (`paid`)
  nur genannt (Totalüberschussprognose nach Verwaltungsauffassung), vor 2012 gar nicht (keine Fassung). „Mieter
  heizt selbst“ ohne Eintrag macht die Quote zur Untergrenze (`lowerBound`, keine Kürzung). **Was der Mieter direkt an
  Dritte zahlt** (IX R 7/20, Rz. 21; OFD Frankfurt, Tz. 3), steht am Mietverhältnis als Staffel je Monat
  (`Tenancy.directCharges`, Tabelle `tenancy_direct_charges`, derselbe Schritt 0066; Staffel, weil die Quote je Monat
  des Mietverhältnisses rechnet), geht nur ins Entgelt (`directChargesCents`), nie in Werbungskosten, Mietkonto oder
  Abrechnung, und hebt `lowerBound` auf. Eingetragen in derselben Karte wie die ortsübliche Miete. Fehlt für einen Monat der Wert, `incomplete`. **Kürzung je
  Position**: Umlagefähiges, das die Abrechnung über genau das Kalenderjahr dem Mietverhältnis zubucht, mit seinem
  Anteil laut Abrechnung × (1 − Quote) (`settledShare`; der Anteil deckt schon seine Tage und folgt dem Schlüssel,
  Durchsicht von PR #422, S1); sonst (nicht umlagefähig, Pauschale, Inklusivmiete, kein Kalenderzeitraum) Betrag ×
  Gewicht (direkt 1, sonst Fläche über die betroffenen Einheiten, IX R 26/06, Auslegung) × Σ (1 − Quote) × Tage /
  Tage des Jahres. Entgeltlicher Anteil der Wohnung = 1 − min(1, Σ (1 − Quote) × Tage / Tage des Jahres); Leerstand
  zählt als entgeltlich (Auslegung, im Rechenweg genannt). Die Quote ist auf zwei Stellen abgeschnitten (S3); die Umlagen
  zählen ohne verrechnete CO₂-Erstattung (`recurringShareCents`, K4). Geprüft wird jede nicht selbstgenutzte Wohnung,
  auch eine vermietete außerhalb der Abrechnungseinheit (K3). Sie steht als `gratuitousCents` an Position, Kostenart, Gruppe und Summe, wird aus dem **abziehbaren** Teil
  genommen und darauf geklemmt, der private bleibt (keine Doppelkürzung); `deductibleCents` = Brutto − privat −
  unentgeltlich. Abgeleitete Zeilen (Betriebsstrom, CO₂-Erstattung), ein Abzug des Betriebsstroms, den die Ausgleichszeile aufhebt
  (selbst getragen oder verknüpft), und eine Heizposition `included` (Ausschnitte der Stromrechnung, die mit ihrem
  Gewicht gekürzt wird, #268) und Positionen ohne Fläche (`unallocated`) bleiben ungekürzt. Ein Abzug, der als dem
  Messdienst gemeldet gilt (`balance.reported`, Regel `deductionReported`), steht als eigene negative Position in der
  Steuer und wird wie jede Position gekürzt (Integrationsdurchsicht 0.13.0, M1). Die Übersicht.csv des Steuer-ZIP bekommt die Spalte „unentgeltlich“ nur mit
  einem unentgeltlichen Teil. Ohne Eintrag fehlt `cheapRent`, und keine Zahl ändert sich (Prüfsummen tax-golden.json).
  Invariante: invariant-steuer-verbilligt.test.ts.
- **Jahr des Abflusses** (#255): Allein `outflowShares` ([outflow.ts](outflow.ts)) bestimmt es,
  Rangfolge `paidOn` (Datum der ganzen Zahlung), dann `taxYear`, dann Beginn des Zeitraums
  (`statedOutflowYear` in [shared/paidOn.ts](../../shared/paidOn.ts) für Formular und Schreibwege). Keine
  andere Stelle leitet ein Steuerjahr ab. **Ohne Datum gilt das Abrechnungsjahr** (bewusst, damit
  keine veröffentlichte Zahl wandert; Prüfsummen in outflow.test.ts). Ein Datum, das das wirksame
  Jahr ändert, `taxYear` widerspricht oder außerhalb Beginn − 1 bis Ende + 3 liegt, braucht
  `confirmPaidOn` (409 `question: 'paidOn'`), beim Aufteilen je Teil (`splitPaidOnQuestions`).
  Datierte Positionen behalten beim Zeitraumwechsel ihr Jahr (`keepsTaxYear`). Kein Datum bei
  `external` und am Abzug beim Betriebsstrom (er folgt seiner Stromrechnung, Quelle `bill`, #267).
  Die Belegbuchung belegt es nie vor (Rechnungsdatum ≠ Zahlungsdatum). Teilzahlungen kommen mit
  #292 über dieselbe Funktion. Über alle Jahre ändert ein Datum weder Summe noch privaten Teil
  (invariant-steuer-summe-zahlungsdatum.test.ts).
- **Verschiebung anzeigen** (`shiftNotes`, nur Auskunft): Jede Position trägt `outflow`; liegt das
  Jahr außerhalb der Kalenderjahre ihres Zeitraums, heißt sie verschoben (`settlementPeriod`,
  `movedOut`), und jede Verschiebung steht auf jeder Seite genau einmal. `unstatedCount` nur, wo das
  Formular ein Datum anbietet (`allowsPaidOn`). Eine Heizposition unter eigener Heizperiode nimmt
  ihren Zeitraum aus der Heizperiode (`plantRules`), nie aus dem Schlüssel.
- **Betriebsstrom: die Stromrechnung zählt genau einmal** (#268): Heizposition `included` und Abzug
  sind Ausschnitte derselben Rechnung. `operatingPowerBalance` rechnet je Steuerjahr **C = Σ Abzüge −
  Σ Heizpositionen `included`**, mit Vorzeichen und ohne Klemme, als abgeleitete Zeile
  `operating-power-balance:<Jahr>` beim Allgemeinstrom. Der Abzug steht im Jahr seiner Stromrechnung
  (#267); ein verknüpfter Abzug nimmt den Heizanteil aus dem Teil seiner Heizposition
  (`foreignHeatQuota`, dafür löst `taxReportFor` Verweise über alle Positionen des Objekts auf). Der
  private Teil folgt dem Heizanteil, ohne zuordenbare Anlage der Gebäudefläche (Auslegung). Ein Abzug
  ohne Verweis bei einer Anlage mit Messdienst gilt als dem Messdienst gemeldet und zählt nicht, außer der
  Vermieter hat am Abzug „nicht gemeldet, selbst getragen“ angegeben (#270, `operatingPowerReported`,
  Regel in `deductionReported`); dann zählt er wie ohne Messdienst. Ohne Angabe bei Kesseltausch mit
  beiden Anlagen: `operatingPowerAmbiguous`, mit Angabe nie. Negativer Allgemeinstrom ohne Kennzeichnung bleibt
  (`unmarkedPowerCredits`). Invariante S1: privater Teil über alle Jahre gleich, wo immer Rechnung,
  Abzug und Heizposition stehen.

## Update-Hinweis

[update.ts](update.ts): **Nur mit Zustimmung** (`settings.updateCheck === 'on'`, im Cockpit gefragt)
fragt der Server `releases/latest` bei GitHub, höchstens einmal am Tag; ohne Zustimmung geht keine
Anfrage hinaus. Nach Fehler eine Stunde Pause, bei Rate-Limit bis `retry-after`/`x-ratelimit-reset`
(höchstens ein Tag). „Jetzt prüfen“ höchstens einmal pro Minute, gleichzeitige Aufrufe teilen eine
Anfrage; Links nur ins eigene Repo. Kein Selbst-Update (#20), sondern eine Anleitung je Betriebsart
([client/src/update.ts](../../client/src/update.ts)). Version aus `server/package.json`
([version.ts](version.ts)); Betriebsart aus `globalThis.Bun` (`binary`, an Systemort `package`),
`NKA_RUNTIME=docker`, sonst `npm`. `NKA_UPDATE_URL` lenkt die Abfrage um. SemVer mit Vorabversionen
(#166): ein Tag mit Vorabversion wird nie angeboten; läuft selbst ein Kandidat, ist die fertige
Version gleicher Nummer ein Update.
