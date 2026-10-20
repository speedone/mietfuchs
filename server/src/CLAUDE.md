# Server: Berechnung, Routen und Fachliches

Aus der CLAUDE.md im Wurzelordner hierher verschoben. Die Heizung steht in
[docs/heizung.md](../../docs/heizung.md), die KI-Belegauswertung in [ai/CLAUDE.md](ai/CLAUDE.md),
die Datenbank in [db/CLAUDE.md](db/CLAUDE.md).

**Objekte** (#92): Eine Installation verwaltet mehrere Objekte (`properties`), und **ein Objekt
ist zugleich die Abrechnungseinheit**. Eine dritte Ebene gibt es bewusst nicht: Alle Programme
für Kleinvermieter haben Objekt → Einheit → Mietverhältnis, eine Wirtschaftseinheit als eigene
Ebene nur Verwaltersoftware. Mehrere Gebäude, die gemeinsam abrechnen, sind *ein* Objekt; eine
Rechnung für mehrere Objekte wird vorverteilt (#95). Die Flexibilität kommt in die
Kostenposition (#94), nicht in weitere Ebenen.

- **Wurzeln tragen das Objekt, alles andere erbt es**: `property_id` steht an Wohnungen, Zählern
  (eigens, weil ein Hauptzähler keine Wohnung hat), Kostenpositionen und abgeschlossenen
  Abrechnungen. Mietverhältnisse erben über die Wohnung, Zahlungen über das Mietverhältnis,
  Ablesungen über den Zähler. Eine zweite Spalte wäre eine zweite Wahrheit. `ON DELETE RESTRICT`:
  Gelöscht wird nur ein leeres Objekt, und nie das letzte (repository.ts, `removeProperty`).
- **Eingegrenzt wird an genau einer Stelle**, `narrowToProperty` in snapshot.ts. Ein fehlender
  Filter ergäbe keine Fehlermeldung, sondern eine Verteilung über zwei Häuser. Die Routen rechnen
  über `snapshotFor` und listen über dieselbe Funktion; eine Invariante in calc.test.ts prüft an
  zufälligen Beständen mit zwei Objekten, dass jedes rechnet, als wäre es allein.
- **Kein Verweis über Objektgrenzen**: Zähler, Direktzuordnung, vereinbarte Anteile, Teilnehmer
  und Einzelbeträge (#94) dürfen nicht auf eine Wohnung oder ein Mietverhältnis eines anderen
  Objekts zeigen; das gilt auch, wenn eine Wohnung das Objekt oder ein Mietverhältnis die Wohnung
  wechselt (`guardUnit`, `guardTenancy`) (`sameProperty`, `CrossPropertyError`
  mit 400). Zusammengesetzte Fremdschlüssel scheiden aus, weil `direct_unit_id` mit `ON DELETE
  SET NULL` alle Spalten des Schlüssels leeren würde, auch das Pflichtfeld. Das Wiederherstellen
  fragt denselben Befund über den ganzen Bestand ab (`crossPropertyViolations`).
- **Abgeschlossene Abrechnungen sind eindeutig je (Objekt, Jahr).** Vorher je Jahr, und mit zwei
  Objekten hätten Versanddatum und Wiederöffnen die Abrechnung des falschen Hauses getroffen.
- **Die Routen nehmen `?property=`**, beim Anlegen einer Wurzel auch `propertyId` im Rumpf
  (`propertyOf` in index.ts). **Fehlt die Angabe und gibt es genau ein Objekt, gilt dieses**, so
  arbeiten alte Tabs, Smoke-Test und Praxislauf unverändert; bei mehreren antwortet die Route mit
  400, statt still alle zu liefern. Belege und Backup bleiben installationsweit; der Belegordner
  fragt die Kostenpositionen deshalb je Objekt ab (siehe Belegordner).
- **Einstellungen**: Name und Adresse gehören zum Objekt. Die Spalten `house_name` und `address`
  stehen noch in `settings`, weil der eingefrorene Eingang sie schreibt und Migration 0001 sie
  abliest; ausgeliefert und angenommen werden sie nicht mehr. Vermieter, IBAN und Zahlungsfrist
  bleiben dort als **Vorgabe**; am Objekt dürfen sie abweichen, `null` heißt „Vorgabe gilt“
  (`effectiveLandlord` in client/src/landlord.ts).
- **Die db.json kennt keine Objekte**: `Db` in store.ts beschreibt ihre Sammlungen mit
  `LegacyUnit`, `LegacyMeter` und `LegacyCostItem`. Tests, die einen Bestand in die Datenbank
  bringen, gehen den Weg des Umstiegs (`openDatabaseWithStock` in server/testing/database.ts):
  auf 0000 schreiben, dann die Kette.
- **Oberfläche**: `PropertyProvider` (client/src/property.tsx) nach dem Muster des
  `YearProvider`; der Umschalter erscheint erst ab dem zweiten Objekt. Seiten hängen das Objekt
  mit `withProperty` an ihre Abrufe. `PageHeader` nennt das gewählte Objekt in der Kontextzeile
  (seit #346 Schritt 8 auch bei einem einzigen, siehe Seitenkopf unter Konventionen), und nach dem Wechsel in ein Objekt ohne Wohnungen steht oben ein Hinweis mit „Zurück zu …“
  (#157, Logik in client/src/propertyView.ts, das vorige Objekt merkt der Provider): Ein leeres
  neues Objekt sah sonst aus wie ein verlorener Bestand.

**Abrechnungszeitraum** (#208, Kern): Ein Objekt rechnet im Kalenderjahr oder in einem eigenen
Rhythmus ab. **Der Zeitraum ist ein eigener Schlüssel** `PeriodKey` (`'JJJJ-MM'`, Monat des Beginns,
Markentyp in shared/types.ts), und kein Jahr: `cost_items.period`, `closed_settlements.period`,
`closed_settlement_history.period`, `prepayment_overrides.period` und `assessments.requested_period`
(nur mit Objekt). `uploads.year`, `assessments.year` und `detected_year` bleiben Kalenderjahre, denn
sie sind Tatsachen über den Beleg; ebenso `assessments.requested_year`, das gewählte Jahr, das auch
ohne Objekt stehen bleibt und beim Zuordnen den Zeitraum ergibt (sonst wäre eine später zugeordnete
Auswertung grün und „Alle grünen übernehmen“ buchte ungesehen in ein anderes Jahr). **Die Zeiträume werden berechnet und nie gespeichert**
([shared/period.ts](../../shared/period.ts)): aus `properties.period_start_month` und `period_changes`
entstehen lückenlose Zeiträume von höchstens zwölf Monaten (`bgb.max-period-months`), vor jedem
Wechsel ein Rumpf. Aus Text wird ein Schlüssel nur dort (Wächter in period.test.ts). Der
Schnappschuss trägt P und den Vorzeitraum, `computeSettlement` rechnet über dessen Grenzen und
Monate, eine Wache in calc-zeitraum.test.ts verbietet Kalenderdaten in seinem Rumpf. **Mietkonto und
Steuer bleiben Kalenderjahr**; die Abrechnung teilt sich mit dem Mietkonto die Monatsrechnung
`ledgerRows`. Die Routen der Abrechnung und des Verbrauchs nehmen `JJJJ-MM`; **die nackte Jahreszahl
gilt nur bei einem reinen Kalenderobjekt**, sonst 404 mit einem Satz, der den gemeinten Zeitraum
nennt, damit ein alter Tab nie still einen Rumpf bekommt. Dasselbe beim Schreiben: `year` statt
`period` oder eine vierstellige Jahreskorrektur nimmt repository.ts nur beim Kalenderobjekt an
(`PeriodError`), und die Listen nennen einem alten Tab dort weiter `year` an den Kostenpositionen
und die Jahreskorrektur nach Jahreszahl. Schickt ein Tab Jahreszahlen, gilt sein Stand vollständig
für die Kalenderzeiträume, sonst bliebe eine zurückgesetzte Korrektur stehen. Ein ungültiger
`period` ist eine 400 und wird nicht still ersetzt. Ein
Schlüssel, den es für sein Objekt nicht gibt, wird beim Schreiben abgelehnt und beim Wiederherstellen
eines Archivs ebenso (`orphanPeriodKeys`). Die Frist kommt vom Server (`Settlement.deadline`,
`settlementDeadline` mit `bgb.deadline-months`) und friert mit ein.
**Bedienung** (PR 3): Den Rhythmus ändert nur der Wechsel mit Vorschau
([server/src/db/periodChange.ts](db/periodChange.ts), `POST /api/properties/:id/period/preview`
und `PUT …/period`); er bekommt die ganzen neuen Regeln und vergleicht sie mit den alten. Ein
abgeschlossener Zeitraum, der sich änderte, sperrt (409); Jahreskorrekturen werden neu erfasst, wenn
ein Mietverhältnis danach Monate in mehr als einem oder einem anders geschnittenen Zeitraum hat
(eine gezahlte Summe lässt sich nicht verteilen), ohne Antwort wird nicht gespeichert. Das Jahr der
Zahlung jeder Position, die in einen Zeitraum über zwei Kalenderjahre gelangt oder deren Zeitraum
dorthin wächst, fragt die Vorschau, vorbelegt und in die Spanne geklemmt; verschoben wird durch
dieselbe Schreibprüfung wie beim Speichern, eine gescheiterte ist eine 409 mit Vorschau. Die
Vorschau trägt eine Marke (`token`); stimmt sie beim Wechsel nicht mehr, gibt es 409 mit der neuen. **Kalte
Rechnungen mit Leistungszeitraum über zwei Zeiträume werden beim Speichern nach Tagen aufgeteilt**
(ein Teil wird danach nur berichtigt: Leistungszeitraum und Zeitraum eines Teils ändert weder das
Speichern noch das Aufteilen, `isSplitPart` in repository.ts)
([server/src/serviceSplit.ts](serviceSplit.ts), Leistungsprinzip); jeder Teil trägt den
ganzen Leistungszeitraum, daran erkennt die Abrechnung ihn. Heizkosten nie (VIII ZR 156/11), dort
warnt `period.heating-mismatch`. `tax_year` ist das Jahr der Zahlung, Pflicht nur bei einem
Zeitraum über zwei Kalenderjahre; die Steuerübersicht jedes Objekts schöpft aus allen
Abrechnungen, die das Jahr berühren (`taxPartsFor` in calc.ts, seit #255 auch beim Kalenderobjekt),
und das Steuer-ZIP nimmt dieselben Positionen (`taxArchiveItems` in taxReceipts.ts). **Welches Jahr
eine Position für die Steuer hat, sagt beim Rechnen `outflowShares`** ([server/src/outflow.ts](outflow.ts)),
eine Liste `{ year, cents, source }` als Naht zu #292; bis dahin genau ein Anteil über den ganzen
Betrag (angegebenes Jahr, sonst Beginn des Zeitraums). **Ein Abzug beim Betriebsstrom hat kein eigenes Jahr**
(#267): Er nimmt das seiner Stromrechnung (`operatingPowerGeneralId`, Quelle `bill`), abgeleitet und nicht
gespeichert; `mergeCostItem` leert `tax_year` am Abzug beim Speichern, und ein älterer Wert wird nicht gelesen.
Der Zeitraumwechsel (periodChange.ts) und die Schätzhilfe (db/operatingPower.ts) lesen das bisherige Jahr über
`storedOutflowYear`; heatingPeriodChange.ts und `defaultHeatingPlant` in repository.ts lesen `taxYear ?? Beginn`
noch selbst, das zieht PR 3 von #255 nach. Gegen eine vom Code unabhängige Referenz prüft
[outflow.test.ts](../test/outflow.test.ts): Prüfsummen der Steuerübersicht je Startwert in
`server/test/fixtures/tax-golden.json` (server/testing/taxGolden.ts), erzeugt mit dem Code von `main` auf dem Bestand
mit dem Abzug im Jahr seiner Rechnung; für ein Jahr mit einem Abzug außerhalb des Teils seiner Heizposition nur die
Beträge, den privaten Teil prüft dort die Invariante S1. **Der Vorschlag nach § 560 im
Rumpf** rechnet je Position einen Jahresfaktor ([server/src/prepaymentSuggestion.ts](prepaymentSuggestion.ts)):
kalt nach den Tagen ihres Leistungszeitraums im Rumpf, gleichartige über die Vereinigung, ohne
Leistungszeitraum als Jahresbetrag mit Hinweis `prepayment.annual-assumed`; Brennstoff (`heating_part = 'fuel'`) nach Gradtagen aus `hkv.degree-days` über die
Vereinigung der Leistungszeiträume, feste Heizpositionen nach den Tagen ihres Leistungszeitraums;
fehlt für den Brennstoff ein Faktor, gibt es keinen Vorschlag. Die Oberfläche hält einen **Tag** und
keinen Schlüssel ([client/src/period.tsx](../../client/src/period.tsx), Logik in
[client/src/periodForm.ts](../../client/src/periodForm.ts)): Der Zeitraum ist der, der ihn enthält, so
passt ein Objektwechsel ihn von selbst an. Beim Kalenderobjekt heißt der Umschalter weiter
„Abrechnungsjahr“, seine Werte sind Jahreszahlen und die Routen bekommen die Jahreszahl; Mietkonto
und Steuer haben bei abweichendem Zeitraum einen eigenen Umschalter „Kalenderjahr“ auf der Seite
(`CalendarYearSelect`, beim Kalenderobjekt gibt es ihn nicht, dort ist das Kalenderjahr der Zeitraum
der Seitenleiste). Gewählt wird der Zeitraum sonst nur in der Seitenleiste (#346 Schritt 8). Die Belegbuchung
bucht in `bookingPeriod` (shared/assessment.ts): den gewählten Zeitraum, wenn er das Jahr des Belegs
berührt, sonst den mit der größten Überschneidung. Der gewählte Zeitraum einer Auswertung entsteht
aus dem gewählten Jahr nach den Regeln des Objekts (`periodForYear`) und nie als festes `JJJJ-01`:
Das wäre bei Mai bis April ein verwaister Schlüssel, und jedes spätere Backup lehnte das
Wiederherstellen ab. Ein schon aufgeteilter Teil wird bei einem weiteren Wechsel nur über den Teil
seines Leistungszeitraums neu geteilt, der in seinem bisherigen Zeitraum liegt, und beim Berichtigen
seines Betrags nicht noch einmal (`needsSplitCheck` mit der gespeicherten Position).

**Fristen und Feiertage** ([shared/holidays.ts](../../shared/holidays.ts),
[shared/deadlines.ts](../../shared/deadlines.ts)): reine Funktionen in UTC, ohne Uhr und ohne Datenzugriff.
Maßgeblich ist das Land des Objekts (`properties.state`, eine der 16 Kennungen oder `null`, Schritte
0060/0061, ein fremdes Kürzel ist eine 400 und wird nicht still zu „unbekannt“).

- **Regeln und Feiertage stehen im Rechtsregister**: `bgb.rent-due-workday` (3, § 556b Abs. 1 BGB),
  `bgb.rent-due-saturday` (Samstag zählt nicht, BGH VIII ZR 129/09; VIII ZR 222/15 betrifft nur die
  Rechtzeitigkeit der Überweisung), `bgb.deadline-on-workday` (§ 193 BGB) in shared/law/bgb-betrkv.ts, und
  je Feiertag ein Parameter `holiday.*` in [shared/law/feiertagsgesetze.ts](../../shared/law/feiertagsgesetze.ts)
  (Tag im Jahr, Länder, gemeindeweise Länder; einmalige Feiertage als Fassung eines Tages, `eventDate`).
  Im Register und nicht in einer eigenen Tabelle, weil es Rechtswerte mit Gültigkeit sind und dort
  Fassungsgeschichte, Prüfstand und Release-Sperre schon gelten. `checked` nur, wo der Wortlaut amtlich
  gelesen ist; Werte für mehrere Länder, deren Gesetze nicht alle gelesen sind, `adopted` mit Angabe, was
  gelesen ist, und dem Abgleich mit beiden Vergleichslisten. holidays.ts rechnet daraus mit Osterformel,
  ohne Laufzeitbibliothek: feiertagejs wich von der Vergleichsliste ab, und date-holidays stimmt zwar,
  seine Feiertagsdaten stehen aber unter CC BY-SA 3.0 (Mietfuchs: AGPL-3.0, damit nicht verträglich) und kämen mit rund 40 MB
  Abhängigkeiten in Programmdatei und Image. Geprüft wird gegen **zwei unabhängige Quellen**: eine feste
  Liste der Python-Bibliothek holidays
  ([server/test/fixtures/holidays/](../test/fixtures/holidays/README.md), 1995 bis 2100) und
  **date-holidays als devDependency der Wurzel** (`holidays-date-holidays.test.ts`, 1995 bis laufendes
  Jahr + 10). Die Wurzel, weil deren node_modules weder das Docker-Image (es übernimmt nur server/,
  client/dist und shared/) noch Bun noch Vite erreichen; ein Test verlangt, dass nichts außer Tests das
  Paket importiert. Dependabot hebt es monatlich: Trägt seine Pflege eine Gesetzesänderung nach, wird
  der Test rot, und das Register bekommt eine neue Fassung mit amtlicher Fundstelle. Die gemeindeweisen
  Regionen (BY KATH/A, SN BZ, TH EIC) sind in beiden Abgleichen genau Land plus Hinweis. Vor 1995 wird
  nicht gerechnet. Einmalige Feiertage, die ein Land
  künftig beschließt, kommen als neue Fassung ins Register. Gefragt wird mit `valueAt`, weil noch keine
  Abrechnung damit rechnet; rechnet calc.ts einmal mit einer Frist, dann mit `law()` und Protokoll.
- **Gemeindeweise Feiertage werden nicht geraten** (Mariä Himmelfahrt in Bayern, Augsburger
  Friedensfest, Fronleichnam in Teilen Sachsens und Thüringens): `localHolidaysOf` nennt sie, gezählt
  werden sie nie. Fällt einer bis zum Fälligkeitstag auf einen Werktag (Fronleichnam am 03.06.2021 in
  Sachsen), sagt die Auskunft im Mietkonto, dass es dort ein Werktag später ist. **Ohne Land** zählen nur die Tage, die in allen 16 Ländern Feiertag sind; eine Frist
  kann dann einen Tag früher erscheinen als am Ort, und die Oberfläche sagt das.
- `isWorkday` verlangt die Angabe, ob der Samstag zählt; es gibt keine Voreinstellung.
  `rentDueDate` ist der dritte Werktag ohne Samstag, `deadlineOnWorkday` das Fristende nach § 193 BGB.
- **Nichts wird still ersetzt.** `ledgerRows` und die Regel aus #133 (der laufende Monat ist nie
  fällig) bleiben; calc.ts nutzt die Bausteine nicht. Einziger Einsatz ist eine Auskunft im Mietkonto
  (`rentDueNote` in client/src/ledgerView.ts): eine Zeile „Miete … fällig am …“, die Einzelheiten
  zum Aufklappen (Regel, Feiertage am Ort, der Mietvertrag kann Abweichendes bestimmen, der
  Überweisungsauftrag bis zu dem Tag genügt). Über den Rückstand sagt sie nichts, denn das Mietkonto
  zählt den laufenden Monat noch nach #133; den Fälligkeitstag dort einzusetzen ist ein eigener Schritt; gezeigt nur, wenn im laufenden Monat eine volle Monatsmiete
  geschuldet ist (`rentDueApplies`, nicht im angebrochenen Monat nach #311). Die gestrichelten Monate
  heißen dort „zählen noch nicht als Rückstand“ und nicht „noch nicht fällig“. Jeder weitere Einsatz ist eine eigene Entscheidung mit eigenem Test.
- Bewusst nicht: ein Vorschlag des Landes aus der Postleitzahl (Postleitzahlgebiete folgen nicht
  überall den Landesgrenzen, und eine Tabelle dafür wäre eine weitere Datenquelle), die Sonntage als Feiertage in Hessen (für Werktage ohne Folge) und die Frage, ob
  § 193 BGB auf eine bestimmte Frist überhaupt anzuwenden ist; das entscheidet der Aufrufer.

**Belegordner** (#170, [client/src/pages/Belege.tsx](../../client/src/pages/Belege.tsx), Logik in
[client/src/receipts.ts](../../client/src/receipts.ts)): Objekt → Jahr → Kostenart als Register, Suche,
Belegabdeckung, Posteingang und zwei Mappen. Entscheidungen und Quellen in
[docs/superpowers/specs/2026-10-02-belegordner-design.md](../../docs/superpowers/specs/2026-10-02-belegordner-design.md).
Objekt und Jahr kommen aus der Seitenleiste (#346 Schritt 8); der Ordner hat dafür keine eigene Auswahl
mehr, nur die Häkchen „Belege aller Objekte zeigen“ und „Belege aller Jahre zeigen“. Objekt und Jahr
eines Belegs im Posteingang sind Eigenschaften des Belegs und bleiben Auswahlfelder.

- **Die Datei ist der Beleg, die Tabelle `uploads` nur eine Beschreibung dazu**
  ([server/src/db/uploads.ts](db/uploads.ts), Migration 0012): Originalname, Art,
  Größe, SHA-256, genaue Hochladezeit, Rechnungsdatum. **Eine fehlende Zeile ist kein Fehler**:
  Alles von vor der Tabelle und jeder Beleg aus einem alten Backup wird aus der Datei beschrieben
  ([server/src/uploads.ts](uploads.ts), `describeFile`; Hochladezeit aus dem
  Zeitstempel im Namen, nicht aus der Dateizeit, die ein ZIP verfälscht). Deshalb auch kein
  Fremdschlüssel von `cost_items.invoice_file` dorthin. `GET /api/uploads` liefert die Liste auch
  ohne Datenbank, nur ohne Posteingang, und übergeht Unterordner und verschwundene Dateien. **Die
  Prüfsumme wird nie synchron gerechnet**: Fehlt sie, trägt `backfillUploads` sie gestreamt und
  je Beleg einzeln nach und schreibt sie in die Zeile; bis dahin ist `sha256` leer.
- **`kind`**: `receipt` oder `meterPhoto`. Ein Foto, das der Schuhkarton als Zählerstand erkennt,
  wird ohne Objekt als Zählerfoto gekennzeichnet und steht weder im Posteingang noch beim
  Nachreichen.
- **Objekt und Jahr nur für den Posteingang**, also für Belege an keiner Position; für verknüpfte
  ergeben sie sich aus den Positionen (keine zweite Wahrheit). `property_id` mit `SET NULL`.
  Hochladen nimmt `propertyId` und `year` als Formularfelder (`/api/upload`, `/api/extract`,
  `/api/intake`); ein unbekanntes Objekt oder ungültiges Jahr wird abgelehnt und die Datei
  entfernt, ein Fehler der Datenbank dagegen verhindert das Hochladen nicht.
- **Ein Beleg aus dem Posteingang wird nicht erneut hochgeladen**: Die KI-Routen nehmen statt
  `file` das Feld `existingFile` (nur ein Name im Belegordner, `path.basename`), und ein Abbruch
  löscht ihn nicht. Die Schnellerfassung bekommt die Belege über `handoff` aus App.tsx; ihre
  Auswertung läuft über die gespeicherte Auswertung (siehe Belegbuchung).
- **Zuordnen an eine bestehende Position** (`attachChoices`, `amountCheckBody` in receipts.ts):
  Mehr als den Namen weiß der Posteingang über einen Beleg nicht; nennt er eine Kostenart
  (`matchCategory`), stehen die Positionen, die nach shared/duplicates.ts dazu passen, oben.
  Danach fragt „Betrag prüfen“ nach dem Betrag, weil eine übernommene Position einen Schätzbetrag
  trägt; gespeichert wird nur `amountCents`, mit derselben Prüfung wie im Formular. Bei `amounts`
  und `external` (`amountCheckMode`) und wenn der Lohnanteil über dem neuen Betrag läge, gibt es
  kein Feld, sondern „Position öffnen“ (Formular auf der Seite Kosten, `onOpenItem`). Der Dateiname
  wird vor `matchCategory` mit NFC normalisiert. Trägt die Position einen §35a-Lohnanteil, nennt „Betrag prüfen“
  ihn und führt ins Formular, damit eine Schätzung nicht still in die Anlage V gelangt.
- **Löschen** nimmt die Zeile mit und bleibt gesperrt, solange irgendeine Position irgendeines
  Objekts auf den Beleg zeigt (`invoiceFilesInUse` fragt ohne Objekt).
- **Backup und Umstieg**: Die Tabelle steckt im Schnappschuss der Datenbank und kommt so mit; ein
  Archiv ohne sie (nur `db.json`, oder Datenbank einer älteren Version) ergibt eine leere Tabelle,
  der eingefrorene Eingang kennt sie nicht. Praxislauf Fall 13 prüft das über zwei Starts.
- **Belegabdeckung** wird am Betrag gemessen, eine Gutschrift mit ihrem Betrag, Positionen über
  0 € zählen nicht. Die Cockpit-Zeile „Belege vollständig“ wird **höchstens gelb**: Ein fehlender
  Beleg ändert keine Zahl der Abrechnung.
- **Belegmappe für Mieter** ([client/src/tenantFolder.ts](../../client/src/tenantFolder.ts)) entsteht im
  Browser mit **pdf-lib** (reines JavaScript, erst bei Bedarf geladen); was pdf-lib nicht kopieren
  kann, kommt über pdf.js als Seitenbilder hinein. Sie enthält die Positionen der Mieterzeilen der
  Abrechnung in deren Reihenfolge, ohne nicht Umlagefähiges. **Belege, die nur einzelne Mieter
  betreffen (Einzelbeträge, Direktzuordnung, Teilnehmer), nur auf ausdrückliche Wahl**, solange es
  keine Mappe je Mieter gibt; Begründung mit Quellen im Design-Text. Ein Beleg, der sich weder
  übernehmen noch rendern lässt, bricht die Mappe nicht ab: Das Deckblatt sagt „nicht
  übernehmbar, bitte gesondert beilegen“. Die Standardschrift kann nur WinAnsi, `winAnsiSafe` ersetzt den Rest.
- **Belege für die Steuer** ([server/src/taxReceipts.ts](taxReceipts.ts)) baut der
  Server mit yazl (siehe ZIP lesen und schreiben): Ordner je Gruppe aus `ANLAGE_V_GROUP` in derselben Reihenfolge wie die
  Steuerübersicht, Erhaltungsrücklage gesondert, dazu `Übersicht.csv` (mit BOM, Semikolon) mit
  jeder Position, auch ohne Beleg. Textfelder, die mit = + - @ beginnen, bekommen einen Apostroph
  davor (CSV-Formel-Einschleusung).

**API** ([server/src/index.ts](index.ts)): generische CRUD-Routen werden in einer
Schleife für die Collections `units, tenancies, costItems, meters, readings, payments` erzeugt.
Sie gehen durch [server/src/db/repository.ts](db/repository.ts); das Kaskadieren beim
Löschen erledigen die Fremdschlüssel und nicht mehr index.ts. Alle Datenrouten grenzen mit
`?property=` auf ein Objekt ein (siehe Objekte). `POST /api/tenancies/:id/change` führt den
Mieterwechsel (Ende, Zwischenablesungen, Nachmieter) in einer Transaktion aus, ganz oder gar
nicht (#150, `changeTenant` in repository.ts). Daneben Spezialrouten: `/api/properties`
(Objekte anlegen, ändern, nur leere löschen), `/api/heating-plants` (Heizanlage, siehe dort; der Rumpf beim Anlegen nimmt `adjust` für Name und Wohnungen bisheriger Anlagen, `/:id/replace` ist der Kesseltausch; `PUT /:id/self` richtet die eigene Heizkostenabrechnung ein, 409 mit Positionen; `PUT …/periods/:period/distribution` setzt den Anteil nach Verbrauch; `PUT …/periods/:period/info` die Angaben nach § 6a und `PUT …/periods/:period/rules` Ausnahme, Vereinbarung, monatliche Information und Verbrauchervertrag ab dieser Heizperiode (siehe Pflichtangaben); `PUT`/`DELETE …/periods/:period/estimates/:unitId/:part` die Schätzung nach § 9a (siehe dort); `PUT`/`DELETE /api/units/:id/interim-gaps/:date` die Antwort zu einer fehlenden Zwischenablesung, siehe Eigene Heizkostenabrechnung), `/api/heating-plants/:id/periods` (Heizperioden einer Anlage mit CO₂-Angaben und Warmwasser, siehe CO₂ beim Messdienst), `…/periods/:period/stock` (PUT/DELETE, Vorrat, siehe Brennstoffvorrat), `/api/heating-plants/:id/period` und `/separate` (je mit `/preview`), `/api/heating-settlement/:plant/:period` (samt `/close` und `/history`) und `/api/heating-settlements` (eigene Heizperiode, siehe dort), `/api/heating-plants/:id/deliveries`, `/api/fuel-deliveries/:id` und `/api/properties/:id/degree-days` (siehe Lieferungen), `/api/settings`, `/api/settlement/:year`, `/api/consumption/:year`, `/api/rentledger/:year`
(Mietkonto: Soll/Ist je Monat), `/api/taxreport/:year` (Steuer-Übersicht Anlage V),
`/api/upload`, `/api/extract` und `/api/intake` (KI-Auswertung, auf Wunsch als Strom, siehe
unten), die KI-Einstellungen `/api/ai/presets`, `/api/ai/status`, `/api/ai/key` und
`/api/ai/consent` sowie `/api/ollama/status` für ältere Tabs (alles siehe
KI-Belegauswertung), `/api/update` und `POST /api/update/check`
(Update-Hinweis, siehe unten), `/api/uploads` (Belegordner: Liste mit Angaben, `PUT` für Objekt,
Jahr und Rechnungsdatum im Posteingang, Löschen unverknüpfter Dateien, siehe Belegordner), `/api/assessments` (Belegbuchung, siehe dort),
`/api/receipts/tax/:year` (Belege für die Steuer als ZIP), `/api/backup`/`/api/restore` (ZIP via yazl und yauzl; das
Wiederherstellen prüft die `db.json` im Archiv erst mit dem Validator und lehnt sie ab, bevor
irgendetwas überschrieben wird, siehe Die Datenbank. Es setzt dabei **keinen vorhandenen Stand
voraus**: Auf einem frischen Rechner gibt es noch keine `db.json`, denn die entsteht erst beim
ersten Speichern, und genau dort wird am häufigsten wiederhergestellt. Die Sicherheitskopie
`db.json.vor-restore` entsteht deshalb nur, wenn es etwas zu sichern gab, und den Belegordner
legt die Route selbst an, statt sich darauf zu verlassen, dass multer ihn beim Laden des Moduls
angelegt hat. Beides spricht seit Aufgabe 7a auch die Datenbank, siehe Backup und
Wiederherstellen) sowie
`/api/settlement/:year/close` (POST/PUT/DELETE; DELETE schiebt den Stand in die Tabelle
`closed_settlement_history` statt ihn zu löschen, lesbar über `/api/settlement/:year/history`,
#56): friert die Abrechnung als Snapshot in der
Collection `closedSettlements` ein (inkl. `sentAt` für die §556-Frist) — `GET
/api/settlement/:year` liefert dann den Snapshot statt der Live-Berechnung; daneben rechnet sie neu und
liefert in `deviation` je Mieter, was die heutige Berechnung anders ergäbe (#56,
[server/src/settlementDiff.ts](settlementDiff.ts)); ein unlesbarer alter Stand heißt
„nicht vergleichbar“ und nicht „keine Abweichung“; ebenso nimmt
`taxReport` den Eigenanteil aus dem Snapshot, damit Steuerübersicht und versendete Abrechnung
nicht auseinanderlaufen.

**Der Schnappschuss** ([server/src/snapshot.ts](snapshot.ts), #55): Die Berechnung
liest den Speicher nicht mehr selbst, sondern bekommt den `Snapshot` eines Abrechnungsjahres
gereicht. `snapshotFromDb(db, year)` baut ihn, die Routen in index.ts rufen ihn auf, und
`computeSettlement`, `rentLedger`, `taxReport` und `consumptionOverview` nehmen nur noch ihn
(das Jahr steckt darin, damit sich ein Schnappschuss nicht mit einem anderen Jahr verrechnen
lässt). Der Typ führt nur die Sammlungen und Felder, die die Berechnung wirklich liest, mit
`Pick` aus `shared/types.ts` geschnitten: keine Einstellungen, keine Kontaktdaten, keine
Belegdateien. So sieht man der Grenze an, woraus eine Abrechnung entsteht, und ein zweites
Speicher-Backend wird später eine neue Datei statt eines Umbaus.
**Nach Jahr eingegrenzt wird nur, was sein Jahr als Feld trägt** (`costItems`, die abgeschlossene
Abrechnung). Ablesungen, Mietverhältnisse, Zahlungen, Wohnungen und Zähler gehen vollständig
hinein: Der Anfangsstand eines Jahres ist die Ablesung vom 31. Dezember des Vorjahres, und die
Staffeln für Personenzahl, Vorauszahlung und Kaltmiete gelten „ab diesem Datum" mit einem
Eintrag, der Jahre alt sein kann. Wer dort filtert, bekommt keinen Fehler, sondern eine stille
Falschrechnung. Die Begründung je Sammlung steht in snapshot.ts, die Tests dazu in calc.test.ts.
Der Schnappschuss reicht die Datensätze durch und kopiert sie nicht; die Berechnung ändert
nichts an ihm. **Vom Objekt führt er nur, was die Berechnung braucht** (`property`: Art und Baujahr
der Kabelanlage, #121), gefüllt in `snapshotFor` aus dem Bestand. Fehlt es, etwa beim Umstieg aus
einer `db.json` und in der Regression, rechnet die Berechnung wie ohne die Angabe; beide Seiten der
Regression haben es deshalb gleichermaßen nicht. Aufgefangen wird dort nichts: Ist eine Sammlung in der Datei `null` (#59), soll
es krachen. Ein `?? []` an der Grenze ergäbe eine leere Abrechnung ohne Kosten und ohne
Warnung, in der jeder Mieter seine Vorauszahlung voll erstattet bekommt. Sie sähe stimmig aus
und wäre falsch, und das ist der schlimmere der beiden Ausgänge.

**Hinweise und Regelverzeichnis** (#112): Die Berechnung erzeugt keine losen Sätze mehr, sondern
`notices` (`Notice` in shared/types.ts) mit Code, Stufe, Titel, Text, dem betroffenen Eintrag
(`subject`, daraus wird „Hier beheben →“) und gegebenenfalls der Regel. **Stufe, Titel und Regel
hängen am Code** (`noticeKinds` in calc.ts), und `warn` nimmt nur Codes aus dieser Tabelle; so
hat derselbe Code nie zwei Stufen. Die Stufen sind fachlich bestimmt: `error` heißt, eine
Position wird wegen widersprüchlicher Angaben gar nicht verteilt, `warning`, Geld landet anders
als vermutlich gewollt oder eine Rechtsregel ist verletzt, `hint`, prüfen ohne sicheren Fehler.
**`warnings` bleibt als Liste der Texte, Wortlaut unverändert**: Cockpit, ältere Tabs und
eingefrorene Abrechnungen lesen sie, und eine vor #112 abgeschlossene Abrechnung kennt nur sie
(die Oberfläche zeigt sie dann als Warnungen ohne Titel, `noticesOf` in
[client/src/notices.ts](../../client/src/notices.ts)).
**Ein `error` sichert das Abschließen ab** (#319): Beide Close-Routen antworten mit 409,
`errorNotices` und `errorToken`, in derselben Rückfrage wie `fuelGaps`, bis `despiteErrors` die
Marke des Stands trägt, der eingefroren würde (nach einer Schätzung;
[server/src/closeQuestion.ts](closeQuestion.ts)). Ausgenommen sind die Auskünfte aus
`INFORMATIONAL`, die dafür in [shared/notices.ts](../../shared/notices.ts) stehen (`blockingErrors`).
**Die Oberfläche fragt bei denselben Fehlern auch vor dem Drucken** (#341,
[client/src/despiteErrors.ts](../../client/src/despiteErrors.ts)), denn der Druck ist Browser-Druck: nur bei
einer offenen Abrechnung, eine abgeschlossene wurde beim Abschluss schon bestätigt, und das
Versanddatum gibt es nur dort. Zeigt die Seite schon Fehler, nennt sie die erste Rückfrage zum
Abschließen, und die Rückfrage des Servers zu denselben Fehlern gilt damit als beantwortet
(`sameErrors`). Solange eine offene Abrechnung Fehler hat, trägt jede Mieterabrechnung im Druck den
Vermerk „Entwurf, nicht versenden“ (`print-only`), auch bei Strg+P; eine abgeschlossene nie, denn nach
„Trotzdem abschließen“ muss sie sich ohne ihn drucken lassen.

**Rechtsregister** (Heizung PR 1, Entwurf `2026-10-05-heizung-gesamt-design.md` Abschnitt 4):
Jede Rechtszahl steht nur in [shared/law/](../../shared/law), mit Gültigkeit, Fundstelle, Prüfstand und
**genau einer Zeitregel** (`periodStart`, `overlap`, `eventDate`; braucht ein Fall zwei, sind es
zwei Parameter). Abgefragt wird mit `law(param, ctx, log)` aus
[shared/law/register.ts](../../shared/law/register.ts); die Berechnung legt je Abrechnung ein Protokoll
an (`createLawLog`, kein globaler Zustand), fragt erst dort, wo ein Wert gebraucht wird, und legt
die benutzten Werte in `legalBasis.values`. **Ein Wert, der im Zeitraum nicht gilt, ist kein
angewandter Wert**: `overlap` protokolliert bei `none` nichts; braucht ein Hinweis die Fassung
trotzdem (die Kabelregel ab 2025), trägt calc.ts sie mit `recordVersionAt` ein, und die Anzeige
nennt die Gültigkeit („gilt bis 30.06.2024“). Die Werte frieren mit dem Abschluss ein, `deviation`
meldet einen später geänderten Wert in `valueChanges`, je Fassung (Kennung und Beginn). Texte außerhalb einer Abrechnung (Lexikon,
Anleitungen, Cockpit) lesen `valueAt(param, LAW_AS_OF)`. Das Regelverzeichnis liegt in
[shared/law/rules.ts](../../shared/law/rules.ts) und nimmt seine Daten und Zahlen aus den Parametern.
**Eine Fassung wird nie geändert, nur eine neue angelegt**; `law-history.test.ts` hält jede
ausgelieferte Fassung als Zahl fest. Einzige erlaubte Änderung: das offene Ende einer Fassung zu
schließen, wenn eine neue anschließt. `law-literals.test.ts` verbietet Prozentangaben einer
Rechtsfolge außerhalb des Registers, Datumsliterale in den Dateien der Berechnung und die Zahlen
des Registers im Code (ohne Zeichenketten und Kommentare) von calc.ts, snapshot.ts,
shared/heating.ts und invoiceAmounts.ts; erlaubte Stellen stehen dort mit Grund, eine
Mutationsprobe hält fest, dass der Wächter die früheren Stellen fängt. Beim Tag bricht release.yml
ab, solange ein Wert `checked: 'unchecked'` hat (`law-release.test.ts`); der Schritt prüft an der
TAP-Ausgabe, dass der Sperrtest nicht übersprungen wurde, sonst fiele die Sperre bei fehlender
Variable still aus. **Es gibt nur ein Stichtagsdatum**,
`LAW_AS_OF`; das frühere `RULES_AS_OF` des Regelverzeichnisses ist entfallen. Wer eine Regel oder
einen Wert prüft, setzt `retrieved` der betroffenen Parameter und `LAW_AS_OF` auf den Tag der
Durchsicht (#110); `LAW_AS_OF` ist das jüngste `retrieved` und steht als Rechtsstand in jeder
Abrechnung. Die
jährliche Durchsicht (Entwurf 4.8) geht jeden Parameter an seiner Fundstelle durch, legt bei
einer Änderung eine neue Fassung an statt die alte zu ändern, trägt veröffentlichte Werte ein,
sieht Bundesgesetzblatt (HeizkostenV, CO2KostAufG, GModG, BetrKV, MessEV) und neue Urteile des
VIII. Senats zu Heiz- und Betriebskosten durch und setzt zuletzt `LAW_AS_OF`.

**Werte, die erst später veröffentlicht werden** (Heizung PR 17, Entwurf 4.5): `co2.price` (ab 2027) und
`co2.price-ets` (ab Rechnungsjahr 2027) haben `null` und sind `overridable`. Sie fragt nur
`lawOverridable`, das einen Eintrag des Vermieters aus `law_overrides` (je Kalenderjahr, mit Quelle;
[server/src/db/lawOverrides.ts](db/lawOverrides.ts), Routen `/api/law-overrides`) liest und als
`overridden` protokolliert; `law()` lehnt überschreibbare Parameter ab. Die Abrechnung nennt einen benutzten
Eintrag (`law.value-overridden`, hint). Ein Release mit dem amtlichen Wert setzt ihn an die Stelle von `null`
(die zweite Ausnahme in `law-history.test.ts`), und der Eintrag heißt „überholt“. Gebraucht werden diese
Werte, die EBeV-Werte und `ustg.gas-heat-network-rate` nur für `co2.cost-implausible`
([server/src/co2Plausibility.ts](co2Plausibility.ts), je Rechnung, die die Heizperiode berührt,
auch bei Vorratsenergien): Spannen über Preisjahre, Emissionshandel und Steuersätze (Mischsatz über die
Stichtage nach BMF-Schreiben vom 25.10.2022, Rz. 12; Flüssiggas beide Sätze nach Rz. 5), Grenzen 1 €/3 %
und bei den kg 1 % nach oben, 10 % nach unten wegen anerkannter Biomasseanteile (Festlegung ohne
Rechtsquelle nach 15.2 F6, `KG_TOLERANCE`, `COST_TOLERANCE`). Mietfuchs rechnet nie kg oder € aus kWh vor,
es vergleicht nur. Ins Register kommt, was im BGBl. steht oder das UBA nach § 4 Abs. 2, 3 CO2KostAufG
bekanntmacht; keine Drucksachen. Das Blatt „CO₂-Angaben für den Messdienst“ baut
[server/src/co2Sheet.ts](co2Sheet.ts) (#210, nicht abgegrenzt; Betrag ohne Eintrag aus den
verknüpften Positionen), die Seite Heizkosten zeigt es über `Co2SheetView`. **Seine Summe zählt nur, was die
Abrechnung zählt** (Durchsicht von #246): Storno und abgedeckte Schätzung über `cancelledDeliveries` und
`estimateFactors` aus fuel.ts (dieselbe Auswahl wie die Bewertung; auch die Prüfung in calc.ts überspringt
Stornos), eine Rechnung vor 2023 nur mit kg, der Anfangsbestand mit seinen CO₂-Kosten nach der Regel der
Bestandsrechnung; jede nicht zählende Zeile trägt einen Vermerk. Bei Wärme aus dem Emissionshandel mit
Anschluss nach dem Stichtag prüfen Abrechnung und Blatt nicht (`etsExempt` in co2Plausibility.ts, eine
Stelle). Das Blatt spricht in der dritten Person, der Kasten „Bitte prüfen“ ist `no-print`; dieselben
Befunde stehen an der Lieferung auf der Seite Heizkosten. **Das Blatt rechnet nichts, was die Abrechnung
entscheidet** (Runde 3 von #246): Endbestand, Verbrauch, der Teil je Rechnung in der Heizperiode sowie kg/m²
und Stufe kommen aus dem Ergebnis der Abrechnung (`heating[].stock`, `fuel`, `co2`, als `billing`);
`co2SheetFor` rechnet dafür die Abrechnung, in der die Heizperiode steht. Eine Zufallsprüfung in
co2-sheet-runde3.test.ts hält die abgegrenzte Zeile gleich der CO₂-Grundlage der Abrechnung, auch bei einer Lücke.
Auch die Fläche der Einstufung kommt von dort (bei mehreren Anlagen eines Gebäudes die gemeinsame, `areaSource:
'building'`). Vermerke stehen nummeriert unter der Tabelle (`sheetNotes`), nicht als Zeile darin: Die Tabelle
scrollt auf dem Handy seitlich. Ob das CO2KostAufG gilt und welche Befunde die Prüfung je Rechnung hat, steht in
`heating[].co2Check` (`applies`, `exemption`, `findings`); Blatt und Karte „Lieferungen“ lesen es von dort, auch
die Ausnahme nach § 11 für Wärme und Warmwasser ohne vereinbarte Abrechnung (§ 2 Abs. 7). Die Regel dazu steht einmal in
[server/src/co2Exemption.ts](co2Exemption.ts) (`co2OffByExemptionOf`, `exemptionText`); steht eine Heizperiode in
keiner Abrechnung, fragt das Blatt sie mit den Periodendaten (`heatingRulesOf`) selbst. Werte, die nur geprüft werden, tragen
`checkOnly` (shared/law); die Abweichung einer abgeschlossenen Abrechnung sagt dann „Prüfwert geändert“.

**IBAN** (#279): Die Prüfung nach ISO 13616 (Länderkennung, Länge je Land, Prüfziffer) steht
einmal in [shared/iban.ts](../../shared/iban.ts), für Formular und Server dieselbe. Geprüft wird nur
beim Speichern über die Routen (`acceptIban` in [server/src/iban.ts](iban.ts), aus
den Verschmelzungen in repository.ts und aus `PUT /api/settings`) und im Formular
([client/src/ibanField.ts](../../client/src/ibanField.ts), Feld
[IbanInput.tsx](../../client/src/components/IbanInput.tsx)), und **nur eine neu gesetzte oder
geänderte**: Eine gespeicherte ungültige, die eine Seite unverändert mitschickt (normiert
verglichen), hindert das Speichern einer anderen Angabe nicht und wird nicht still
umgeschrieben; das Formular nennt sie als Hinweis. Backup, Wiederherstellen, Umstieg und
Validator prüfen bewusst nicht: Eine falsche IBAN ändert keine Zahl, sie ist krumm und nicht
kaputt. Leer ist immer erlaubt. Was dennoch ungültig im Bestand steht, nennt das Cockpit als
ruhigen Hinweis ohne Ampel ([client/src/ibanCheck.ts](../../client/src/ibanCheck.ts)), mit Sprung zur
Stelle, und nur, was das gewählte Objekt betrifft: die Vorgabe der Einstellungen nur ohne eigene
IBAN am Objekt, Mietverhältnisse nur, wenn sie im Vorjahr oder später noch liefen.

**Rechenweg** (#114): Jede Zeile der Mieter trägt `steps` (`CalcStep` in shared/types.ts),
erzeugt dort, wo die Zeile entsteht, aus denselben Zahlen, als fertiger Text. Der Restcent aus
`largestRemainder` wird an der Zeile benannt, die ihn bekommt. Die Seite Abrechnung zeigt die
Schritte aufklappbar ([CalcSteps.tsx](../../client/src/components/CalcSteps.tsx)), immer `no-print`.
Eine vorher abgeschlossene Abrechnung hat keine Schritte; dann zeigt `stepsOf`
([calcSteps.ts](../../client/src/calcSteps.ts)) nur, was die Zeile selbst hergibt, statt nachzurechnen,
denn eine neue Rechnung muss nicht zum eingefrorenen Stand passen. Die Regression des Umstiegs
nimmt `steps` aus wie `basisText`.

**Schlüssel merken und Vorjahr übernehmen** (#141, Entwurf in
[docs/superpowers/specs/2026-10-02-schluessel-merken-design.md](../../docs/superpowers/specs/2026-10-02-schluessel-merken-design.md)):
Der gemerkte Schlüssel einer Kostenart ist **der Schlüssel ihrer Positionen im Vorjahr desselben
Objekts**, abgeleitet aus dem Bestand und ohne eigene Tabelle; eine Staffel daneben wäre ein
zweites Abbild, das auseinanderläuft. Was „derselbe Schlüssel“ heißt (Schlüssel, Zählertyp,
Wohnung, Anteile, Teilnehmer, Maßstab der Gemeinschaft, **nicht** deren Summe der Anteile), steht
einmal in [shared/allocation.ts](../../shared/allocation.ts), weil Vorschlag (client/src/costForm.ts,
`withCategory`/`newItemForm`/`aiPositionDefaults` mit `KeyContext`) und Hinweis
(`key.changed-from-previous-year` in calc.ts, Stufe `hint`) dasselbe meinen müssen; sonst löste
der Vorschlag selbst den Hinweis aus. Widersprechen sich die Vorjahrespositionen, gibt es keinen
Vorschlag. Bei einer breiten Kostenart (`BROAD_CATEGORIES`, heute „Sonstige Betriebskosten“) zählt
nur die Vorjahresposition mit derselben Beschreibung (Jahreszahl ersetzt), sonst bekäme die
Dachrinne die Direktzuordnung der Hebeanlage (`comparablePrevious`, für Vorschlag und Hinweis
dieselbe). Eine KI-Zeile mit gemerkten Teilnehmern oder Direktzuordnung ist nie vorab angehakt
und in der Schnellerfassung nie grün. Für Heizung und Warmwasser nennt der Hinweis § 6 Abs. 4
HeizkostenV statt § 556a Abs. 2 BGB. Das Abrechnungsjahr wechselt nur über `useSwitchYear`
(property.tsx), das wie `useSwitchProperty` bei offenem Formular fragt; App.tsx stellt die
Seiten je Objekt **und Jahr** neu auf. Der Schnappschuss trägt dafür `previousCostItems` (optional wie `property`, gefüllt in
`snapshotOf`); verteilt wird davon nichts. **„Aus dem Vorjahr übernehmen“ lebt nur im Browser**
([client/src/carryOver.ts](../../client/src/carryOver.ts)): keine Entwürfe in der Datenbank, denn eine
Position ohne Betrag wäre dort eine 0 oder ein Kennzeichen, das jede Rechnung kennen müsste.
Gespeichert wird über `buildCostItemBody`, also mit derselben Prüfung wie im Formular; Betrag,
§35a-Anteil, Kosten der Gemeinschaft und Beleg kommen nie mit. Die KI-Übernahme baut ihren Rumpf
seither ebenfalls über `buildCostItemBody` (`aiPositionBody`). Die Summe der MEA am Objekt und die
Hausgeldabrechnung als Klammer sind Folgearbeit mit #102; bis dahin kommt die Summe von der
zuletzt erfassten Position „laut Gemeinschaftsabrechnung“ (`lastExternalBasis`).

**Doppelte Kostenpositionen** (Zusammenspiel von #141 und #170): Die Übernahme aus dem Vorjahr
legt eine Position mit Schätzbetrag und ohne Beleg an; kam danach die echte Rechnung über einen
KI-Weg, entstand still eine zweite derselben Kostenart, und umgekehrt traf der Vergleich der
Beschreibung eine KI-Beschreibung nie. Ob eine Position dieselbe Rechnung sein könnte, steht
deshalb **einmal** in [shared/duplicates.ts](../../shared/duplicates.ts) (`sameCostCandidates`):
dasselbe Objekt, Jahr und dieselbe Kostenart; bei den breiten Kostenarten (`LOOSE_CATEGORIES`:
`BROAD_CATEGORIES` und „Nicht umlagefähig“) zusätzlich ähnliche Beschreibung oder gleicher
Rechnungssteller (ohne Jahreszahlen und Satzzeichen, Präfixvergleich), weil dort ganz
verschiedene Rechnungen nebeneinander stehen. Die Regel findet nur Kandidaten, entscheiden tut der
Vermieter. Sie fragen: `alreadyCarried` (carryOver.ts, ausgenommen die genaue Übernahme einer
Schwesterposition des Vorjahres), der Vorschlag jeder Zeile einer Auswertung (`describeAssessment`
in server/src/assessment.ts, nicht vorab angehakt, Rückfrage „Trotzdem anlegen“ aus der Vorschau),
das Kostenformular beim Neuanlegen („Stattdessen … bearbeiten“) und der Hinweis
`cost.possible-duplicate` in calc.ts. Was beim Verknüpfen mit dem Betrag geschieht, steht in
**Belegbuchung** unten; die Logik dafür lebt nicht mehr im Browser.
Der Hinweis der Abrechnung (`possibleDuplicates`, Stufe `hint`, zählt in der
Ampel) kommt nur, wenn eine Position der Gruppe keinen Beleg hat und dazu (a) eine einen Beleg
hat oder (b) das Vorjahr Positionen dieser Art hatte und das Jahr mehr hat. Ohne Vorjahr und ganz
ohne Belege bleibt er still, ebenso Restmüll und Biomüll, beide übernommen. Gezählt wird im Jahr des Belegs (`detectedYear` in
server/src/assessment.ts, gespeichert als `assessments.detected_year`), nicht im gewählten, denn im Januar steht die Auswahl oft noch auf dem Vorjahr. Der Schnappschuss
führt dafür `vendor` und `invoiceFile`; verteilt wird nach keinem.

**Belegbuchung** (#170, Entwurf in
[docs/superpowers/specs/2026-10-02-belegbuchung-design.md](../../docs/superpowers/specs/2026-10-02-belegbuchung-design.md)):
Eine Rechnung landet genau einmal in den Kosten, weil der **Server** bucht und nicht die Seite.
Das ersetzt die frühere Logik im Browser (Gruppen, Verknüpfen, Rückfragen in triage.ts und den
beiden Seiten), die dreimal einen Geldfehler hatte.

- **Eine Auswertung ist ein gespeicherter Gegenstand** (Tabellen `assessments` und
  `assessment_lines`, Migration 0013): eine je Beleg, gespeichert nur nach Erfolg der KI (nach der
  Antwort wird `signal.aborted` geprüft, ein Abbruch speichert nichts; schlägt die Prüfsumme fehl,
  geht die Auswertung trotzdem ohne sie ein). Der Zustand einer Zeile wird **abgeleitet**
  (`lineState` in server/src/assessment.ts): ohne `cost_item_id` offen oder verworfen („Verwerfen“
  an der Zeile, die Auswertung bleibt; „Ausblenden“ heißt nur der Knopf der Warteschlange auf der
  Kostenseite, der die Karte wegnimmt und nichts verwirft), mit ihr angelegt oder verknüpft. `cost_item_id` ist
  `ON DELETE SET NULL`, das Löschen einer Position macht ihre Zeilen von selbst wieder offen.
  **Zeilennummern kommen aus einer Hochwassermarke** (`assessments.next_idx`) und werden nie
  wiederverwendet: Erneutes Auswerten ersetzt nur offene und verworfene Zeilen, gebuchte bleiben
  mit ihren Nummern, neue bekommen nie benutzte, und eine Zeile, die einer gebuchten gleicht,
  kommt nicht wieder. Die Routen sprechen Zeilen über diese Nummer an, eine wiederverwendete
  Nummer träfe die falsche Zeile. **„Gleicht einer gebuchten“ reicht dabei nicht** (`withoutBooked`
  vergleicht Betrag und Beschreibung oder Kostenart): Eine von Hand berichtigte Zeile oder eine,
  die die KI anders aufteilt, kam als neue grüne Zeile wieder und wurde mit „Alle grünen
  übernehmen“ ein zweites Mal gebucht (Integrationsdurchsicht H1, nachgemessen 2.250 € statt
  1.550 €). Zeilen, die beim erneuten Auswerten **neben gebuchten** dazukommen, tragen deshalb
  `reassessed`; für sie sind die schon aus diesem Beleg gebuchten Positionen Kandidaten, gleich
  welcher Kostenart, die Zeile ist rot („Dieser Beleg ist schon gebucht …“), und Anlegen braucht
  die Bestätigung. Ebenso das Verknüpfen mit einer solchen Position, denn es addiert den Betrag:
  Ohne `despiteCandidates` an der Entscheidung antwortet der Planer mit einer Rückfrage und die
  Buchung mit 400, die Oberfläche fragt „Trotzdem verknüpfen“ (`confirmLabel` in client/src/assessment.ts). Für die Zeilen der ersten Auswertung gilt das nicht, sonst stünde Abwasser rot,
  sobald Frischwasser gebucht ist.
  Neben den Spalten der Spezifikation stehen `detected_year` (Ampel „Rechnungsjahr ≠ Zieljahr“),
  `requested_year` (das gewählte Jahr: beim Auswerten mitgeschickt, nach einem `PUT` mit Jahr das
  gesetzte; weicht `year` davon ab, ist die Zeile gelb und nicht vorab angehakt, und „Alle grünen
  übernehmen“ bucht sie nicht, sonst landete eine Jahresrechnung vom Februar ohne gelesenen
  Leistungszeitraum ungesehen im Folgejahr; Schlussdurchsicht I1),
  `amounts_adjusted`/`labor_from_total` (die Hinweise #34 überleben das Neuladen) und
  `category_guessed` (gelb, wenn die Kostenart nur aus der Beschreibung kam).
- **Planen ist eine reine Funktion** (`planBooking` in server/src/bookingPlan.ts), Buchen führt
  ihre Schreibliste in einer Transaktion durch die Schreibschlange aus (server/src/db/booking.ts).
  **Summenregel**: Der Betrag einer Position mit Zeilen ist die Summe **aller** ihrer Zeilen,
  angelegter wie verknüpfter, über alle Belege, aus dem gespeicherten Stand; der §35a-Lohnanteil
  ist die Summe der gelesenen, und nennt keine einen, wird ein vorhandener entfernt (sonst würde
  ein stehengebliebener Schätzwert Mietern und Anlage V bescheinigt). Eine Schätzung, ein von
  Hand geänderter Betrag und ein ungelesener Beleg an der Position werden ersetzt, die Vorschau
  sagt es in ganzen Sätzen vorher. Ziele sind nur Positionen im Objekt und Jahr der Auswertung;
  `amounts` und `external` sind keine Ziele („Position öffnen“, ihr Betrag hängt an weiteren
  Angaben; der Hinweis sagt, die Zeile nach dem Aktualisieren der Position zu verwerfen, sonst
  bliebe der Beleg offen). **Gutschrift-Positionen sind keine Verknüpfungsziele, und eine Gutschrift-Zeile
  bekommt nur Gutschriften als Kandidaten**; sie wird nie verrechnet, damit sie auf der
  Abrechnung sichtbar bleibt. Ein Beleg gleichen Inhalts (Prüfsumme) kann nicht ein zweites Mal an
  dieselbe Position, der Doppelt-Hinweis erscheint bei gleichen Beträgen an einer Position.
  **Hängt der Beleg schon von Hand (`invoice_file`) an einer Position**, ohne dass eine Zeile
  gebucht ist, ist sie Kandidat jeder seiner Zeilen, unabhängig von der Kostenart
  (`lineCandidates` in server/src/assessment.ts, Ansicht und Rückfrage des Planers fragen dieselbe
  Regel): Die Zeile ist rot („Dieser Beleg hängt schon an …“), Anlegen braucht die Bestätigung.
  **Dasselbe gilt für einen Beleg gleichen Inhalts** (gleiche Prüfsumme), der von Hand an einer
  Position hängt (Integrationsdurchsicht H2): Vorher prüften `twinOf` und der Planer nur gebuchte
  Zeilen, und las die KI eine andere Kostenart, stand dieselbe Rechnung grün und vorab angehakt
  da.
  Verwerfen ergibt einen Hinweis je Zeile, damit Vorschau und Erfolgsmeldung nie leer sind.
  **Beim Lösen einer Zeile wechselt der Beleg der Position nur, wenn der gelöste ihr Beleg war**
  (und keine Zeile dieser Datei bleibt); ein von Hand angehängter Beleg bleibt, die Vorschau
  kündigt den Wechsel an.
- **Eine Zeile wird nie zweimal gebucht.** „Genau so gebucht“ (Betrag, Lohnanteil, bei neu
  angelegten auch Beschreibung, Kostenart, Schlüssel, Verteilung) ist ein Erfolg ohne Änderung
  (Doppelklick, Wiederholung nach Netzfehler); **jede Abweichung ist ein 409 mit dem aktuellen
  Stand**. **Die Vorschau trägt eine Prüfmarke** (`token`, SHA-256 über `tokenSource`, bei neu
  angelegten Positionen mit Schlüssel und Verteilung): Weicht der Stand beim Buchen ab, antwortet
  der Server mit 409 und der neuen Vorschau, statt still anders zu buchen. Gebucht wird immer im
  Objekt der Auswertung, `?property=` gilt nur für die Liste. **Objekt und Jahr sind nach der
  ersten gebuchten Zeile fest** (`placeAssessment` lehnt beides mit 409 ab, sonst entstünden
  Verknüpfungen über Jahre). Solange nichts gebucht ist, ziehen sich Posteingang
  (`PUT /api/uploads/:file`) und Auswertung (`PUT /api/assessments/:id`) Jahr und Objekt
  gegenseitig nach, damit beide Listen übereinstimmen.
- **Prüfungen in shared/**: `amountProblem` und `costItemBody` (shared/costItem.ts, nimmt Cent,
  das Formular liest nur die Eingaben), Ampel, Vorauswahl und gemerkter Schlüssel einer KI-Zeile
  (shared/assessment.ts), die Kostenarten (shared/categories.ts, client/src/types.ts reicht sie
  weiter). `POST`/`PUT /api/costItems` prüfen bewusst noch nicht damit (eigener Schritt).
- **Routen**: `/api/extract` und `/api/intake` liefern `assessment` mit Vorschlag je Zeile;
  `GET /api/assessments?property=…&open=1`, `GET`/`PUT /api/assessments/:id`,
  `POST …/plan` und `POST …/book`. `GET /api/uploads` nennt je Beleg `bookedItemIds`, die Summe
  seiner eigenen gebuchten Zeilen je Position (`bookedCents`) und die Auswertung; ein Beleg, der
  nur über eine gebuchte Zeile an einer Position hängt, steht nicht im Posteingang, zählt für die
  Belegabdeckung, kommt in Belegmappe und Steuer-ZIP und lässt sich nicht löschen (die Karte zeigt
  die Summe der eigenen Zeilen, nicht den Betrag der Position). Das Löschen prüft „in Gebrauch“
  und vergisst die Auswertung in einem Schreibvorgang, erst danach geht die Datei. Eine
  Auswertung, deren Datei fehlt, erscheint nicht in der Liste, und `plan`, `book` und `PUT`
  antworten 404 (`PUT` prüft das, bevor es schreibt).
- **Oberfläche**: eine Komponente
  ([AssessmentReview.tsx](../../client/src/components/AssessmentReview.tsx), Logik in
  [client/src/assessment.ts](../../client/src/assessment.ts)) für Schnellerfassung und Kostenseite,
  die Warteschlange dahinter ist der gemeinsame Hook `useEvaluationQueue`
  ([client/src/evaluationQueue.ts](../../client/src/evaluationQueue.ts)). Beide Seiten zeigen dieselbe
  Ampel: eine rote Zeile ist nicht vorab angehakt, das Jahr aus dem Beleg geht vor dem
  gewählten, und beide zeigen „Jahr …“, wenn das Jahr der Buchung vom gewählten abweicht; die
  Vorschau nennt das Jahr neuer Positionen. Die Kostenseite schickt Objekt und Jahr mit. Der
  Posteingang führt mit „Weiter prüfen“ in die Schnellerfassung (ohne Objekt
  wird zuerst das gewählte zugewiesen). „Alle grünen übernehmen“ bucht je Auswertung nacheinander,
  damit der zweite Beleg derselben Kostenart die eben angelegte Position sieht; dieser Knopf und
  „Ablesung übernehmen“ haben eine Sperre gegen Doppelklick (eine ausdrücklich übernommene rote
  Ablesung wird gesendet, als übernommen gilt sie erst danach). Die jsdom-Tests rechnen mit dem
  echten Planer ([client/src/testing/fakeBooking.ts](../../client/src/testing/fakeBooking.ts)). Für
  Praxislauf (Fall 14) und Browserprobe gibt es ein nachgebautes Ollama mit den Abnahmefällen
  ([scripts/fake-ollama.mjs](../../scripts/fake-ollama.mjs)).
- **Testgriff `NKA_TEST_ASSESSMENT_DELAY_MS`**: verzögert das Speichern einer Auswertung um so
  viele Millisekunden, nur für Tests (api-belegbuchung.test.ts legt damit einen Abbruch in das Fenster zwischen
  Antwort der KI und Speichern). Ohne die Variable gibt es keine Pause; ein Nutzer setzt sie nie.
- **Testgriff `NKA_TEST_TODAY`** (Laienprobe Heizung, Durchsicht): ein fester Tag als JJJJ-MM-TT für
  die Uhr des Servers (`today()` in index.ts, server/src/testToday.ts), nur für Tests. Prüfbestände mit
  festen Jahren kippen sonst an einem bestimmten Datum, weil eine Frist abläuft und Zeitraumwechsel,
  Aufteilen und Heizperiodenwechsel dann eine Bestätigung verlangen. Er wirkt nur auf den Server,
  nicht auf die Uhr des Browsers. Ist er gesetzt, nennt die Konsole ihn beim Start; ein Wert, der kein
  echtes Kalenderdatum ist, bricht den Start mit Meldung ab. Ein Nutzer setzt ihn nie.

**Berechnungs-Engine** ([server/src/calc.ts](calc.ts)) — das Herzstück, hier liegt
die ganze fachliche Komplexität:
- **Alle Beträge in Cent (Integer)**, niemals Euro-Floats — Gleitkomma-Fehler vermeiden.
- **Eine Rundungsregel für jede Verteilung** (#202, `distributeCents`): Jede Position wird
  genau einmal nach Hare/largest-remainder verteilt, über alle Empfänger zugleich, also die
  Mieter **und je Grund eine Zeile des Vermieters** (Eigennutzung, Pauschale, Inklusivmiete,
  außerhalb, Rest der Vereinbarung, Rest des Hauptzählers, zuletzt Leerstand bzw. Rest der
  Einzelbeträge als Betrag minus alles übrige; `landlordRecipients`). Die exakten Werte ergeben
  genau den Betrag, jede Zeile ist ihr Wert ab- oder aufgerundet, keine wechselt das Vorzeichen,
  eine mit exakt 0 bekommt nie einen Cent. Gleichstand (mit Toleranz gegen Rauschen): erst der
  Vermieter, dann die Kennung per `compareText`. Gutschriften als Spiegelbild. Der Eigenanteil
  ist genau die Zeile `selfUse`, die Zeilen des Vermieters sind die `landlordParts`; einen
  Grund `rounding` erzeugt die Berechnung nicht mehr. Der §35a-Lohn wird danach **innerhalb**
  der Kostenanteile verteilt (`distributeLaborCents`): je Zeile ab- oder aufgerundet, nie über
  dem Kostenanteil, zusammen genau L, bei L = A gleich dem Kostenanteil. Nicht Lohn und Rest
  getrennt verteilen: zwei Rundungen zusammen können fast 2 Cent vom exakten Anteil abweichen.
  Ein Test über Zufallsbestände prüft das über `onAllocation` in den Optionen.
- **Umlageschlüssel** (`item.key`): `area` (Wohnfläche), `persons` (personentagesgenau),
  `units` (Wohneinheiten), `meter` (Verbrauch nach Zählertyp), `direct` (Direktzuordnung),
  `custom` (vereinbarte Prozentanteile je Wohnung in `item.customShares`, absolut gerechnet —
  was unter 100 % fehlt, trägt der Vermieter), `external` (laut Gemeinschaftsabrechnung, #94)
  und `amounts` (Einzelbeträge je Mietverhältnis, #94).
- **Verteilbasis je Position** (#94): `participantUnitIds` grenzt die Basis auf Teilnehmer ein
  (Fläche, Einheiten, Personen, Verbrauch, `external`, `amounts`); ohne Teilnehmer ist sie
  **dasselbe Objekt** wie bisher (`fullBasis` in calc.ts), damit die Umstellung keine Zahl
  verschiebt. Bei `external` **trägt die Position den eigenen Anteil** laut Hausgeldabrechnung,
  nicht die Summe der Anlage, sonst stünde die Summe als Vermieteranteil und Werbungskosten da;
  `externalBasis` (Maßstab, Summe, Gesamtkosten) steht daneben für den Rechenweg und eine
  Plausibilitätswarnung. Verteilt wird nach `mea`, Fläche oder 1 je Wohnung. Bei `amounts` ist
  der Anteil genau der Betrag des Mietverhältnisses, ohne Tagesanteil (der Messdienst teilt beim
  Wechsel selbst), der Rest beim Vermieter; eine Summe über dem Rechnungsbetrag wird nicht
  verteilt. Tests in calc-verteilbasis.test.ts samt eigener Invariante.
- **Nebenkostenmodell am Mietverhältnis** (#93): `costModel` (kalte Kosten) und
  `heatingModel` (Kostenart „Heizung und Warmwasser“, `HEATING_CATEGORY` in calc.ts), jeweils
  `settlement | flatRate | inclusive`, fehlend `settlement`; beim Heizmodell dazu `selfSupply` (siehe
  „Mieter heizt selbst“ unten), das jede Stelle über `allocationModel` als `settlement` liest. Ein Mietverhältnis mit Pauschale
  oder Inklusivmiete **bleibt in der Verteilbasis**, sein Anteil wird ihm nicht zugebucht und
  fällt dem Vermieter zu, und zwar **nicht als Eigenanteil** (abziehbar). Bleibt seine Abrechnung
  leer und gibt es keine Vorauszahlung, fehlt sie in `statements` und steht in `notSettled`.
  **Die Pauschale hat eine eigene Staffel** (`flatRates`, Tabelle `flat_rates`): Das Mietkonto
  führt sie im Soll, die Abrechnung rechnet sie nie an. In der Staffel der Vorauszahlung wurde
  sie bei einem gemischten Modell (kalt pauschal, Heizung abgerechnet) gegen die Heizkosten
  gutgeschrieben, gefunden in der Durchsicht. Warnung nach
  § 2 HeizkostenV außerhalb des selbstbewohnten Zweifamilienhauses. Die drei Listen der
  Kostenarten (Oberfläche, KI-Schema, Anlage V) hält categories.test.ts zusammen.
- **Staffeln statt Neuanlage**: Personenzahl (`personHistory`) und Vorauszahlung
  (`prepayments`, `from: YYYY-MM`) werden als „ab Datum gilt Wert" geführt. Die tatsächlich
  gezahlten Vorauszahlungen je Abrechnungszeitraum lassen sich via `prepaymentOverrides`
  eintragen und haben Vorrang, denn anzusetzen ist, was der Mieter für den Abrechnungszeitraum
  tatsächlich geleistet hat (BGH VIII ZR 240/10 vom 18.05.2011, Rn. 16). Mietfuchs rechnet ohne
  Eintrag mit der Staffel, also dem Soll; auf das Ist kommt es durch die Jahreskorrektur, und
  `prepayment.arrears` und `prepayment.partial-month` weisen darauf hin.
  **Die Monatsregel steht an einer Stelle** (#311, `monthShare` und `rateInMonth` in calc.ts) und
  gilt für die Abrechnung (Vorauszahlung, Heizstaffel) wie für das Mietkonto (Kaltmiete,
  Vorauszahlung, Heizstaffel, Pauschale). Ein Monat zählt, sobald das Mietverhältnis an einem
  seiner Tage besteht; im angebrochenen Ein- und Auszugsmonat gilt die Rate nach Kalendertagen,
  `round(Rate × Tage / Tage des Monats)` je Monat in Cent, ein voller Monat ohne Rundung. Vorher
  zählte ein Monat nur, wenn das Mietverhältnis am Monatsersten bestand, falsch in beide
  Richtungen (Einzug am 15.03. bei 150 €: 82,26 € zu wenig angerechnet; Auszug am 15.06.: 75,00 €
  zu viel). **Das ist eine Auslegung**, wie `VACANCY_PERSONS`: Ein Gesetz oder eine
  BGH-Entscheidung zur Methode gibt es nicht. Kalendertage, weil die Kostenseite derselben
  Abrechnung nach Kalendertagen verteilt; 1/30 je Tag nach der Wertung des § 191 BGB ist ebenso
  vertretbar und weicht um Euro-Beträge ab (bei 150 € und Einzug am 15.: 2,74 € im März, 5,00 € im
  Februar). § 556b Abs. 1 BGB regelt nur die Fälligkeit und trägt die Regel nicht. Bei
  getrennter Heizstaffel wird je Staffel gerundet (32,90 € + 49,35 € = 82,25 €), weil die Beträge
  bei Weg d zwei Abrechnungen gehören. Der Hinweis `prepayment.partial-month` (Stufe `hint`,
  `INFORMATIONAL`) nennt den angesetzten Betrag und Beispielsummen mit und ohne vollen Monat,
  ausdrücklich als Beispiel, das volle Zahlung der übrigen Monate voraussetzt; `prepaymentNote`
  nennt dem Mieter den Anteil. Abgeschlossene Abrechnungen bleiben eingefroren, `deviation`
  zeigt den Unterschied. Eine Invariante in calc.test.ts hält Abrechnung und Mietkonto je
  Mietverhältnis gleich.
- **Zeiträume** sind ISO-Strings mit inklusiven Grenzen, in UTC gerechnet; Tagesanteile zählen
  für Teiljahre. `end: null` = offenes Mietverhältnis.
- **Zähler**: Ablesungen → Verbrauchssegmente (`meterSegments`), tagesanteilig interpoliert
  (`consumptionInPeriod`). Zählerwechsel über `replacement: true` + `oldEndValue`. Negativer
  Verbrauch erzeugt eine Warnung.
  **Ein Zählerwechsel ohne `oldEndValue` ebenfalls** (#83), und dort entsteht **kein Segment**.
  Auch hier zahlt die Lücke **ein anderer Mieter** und nicht der Vermieter, aus demselben Grund
  wie unten: gemessen 540,15 € statt 802,40 € beim einen und 1.459,85 € statt 1.197,60 € beim
  anderen. Der Rechenweg auf der Abrechnung liest sich dabei plausibel, die Meldung ist also das
  Einzige, was darauf stößt.
  Das frühere `?? 0` las das fehlende Feld als Null und machte aus einem Stand von 980 einen
  Verbrauch von minus 980 (im Jahr gemessen minus 910), der beim Verbrauchsschlüssel in die
  Verteilbasis einging und die Anteile aller Mieter verschob. Gefragt wird nach `null` und nicht
  nach dem Wert, denn ein eingetragener Endstand von 0 ist eine Angabe (Zähler lief rückwärts)
  und keine Lücke. Validator und Schema bleiben bewusst außen vor: Beide würden den Bestand
  ablehnen und dem Vermieter den Umstieg verwehren, obwohl die Übernahme selbst keine Zahl
  verändert — die ist schon vorher falsch.
  **Zwei Ablesungen am selben Tag ebenso** (#69), und zwar statt der über negativen Verbrauch:
  Ein Segment entsteht nur bei mindestens einem Tag Abstand, sonst müsste durch null geteilt
  werden, und die Differenz fiel bisher wortlos heraus. Sie wird **nicht** verteilt, und das ist
  eine Entscheidung mit Begründung: Zwei gewöhnliche Ablesungen am selben Tag sind fast immer
  eine Korrektur, und dann wäre die Differenz ein Tippfehler und keine Menge Wasser; beim
  Zählerwechsel wäre sie Verbrauch über null Tage, also selbst schon ein Widerspruch. Welche der
  beiden stimmt, weiß nur der Vermieter, und geraten wird in calc.ts nicht.
  **Wer das bezahlt, ist nachgemessen und stand im Issue falsch**: nicht der Vermieter, sondern
  ein anderer Mieter. Die Verteilbasis des Verbrauchsschlüssels ist die Summe des *gemessenen*
  Verbrauchs, Zähler und Nenner schrumpfen also gemeinsam, und der Rechnungsbetrag wird trotzdem
  vollständig verteilt (zwei Wohnungen, 2.000 € Wasser, 10 m³ Tippfehler: 947,37 € gegen
  1.052,63 €). Ein Test hält die Zahlen fest.
  Die Warnungen aus `meterSegments` gehen über `consumptionOverview` an die **Zähler-Seite** und
  ans **Cockpit**, dessen Ampel „Zählerstände" davon auf Rot springt; auf der Abrechnung
  erscheinen sie nicht, denn `computeSettlement` ruft `consumptionInPeriod` auf und wirft sie
  weg. Das war vorher schon so, und es soll so bleiben: Die Abrechnung ist das Dokument, das der
  Mieter bekommt, und ein Hinweis auf einen Datenfehler des Vermieters gehört nicht darauf.
  **Die Einheit** (#342, [shared/meterUnits.ts](../../shared/meterUnits.ts)) bleibt ein Text am Zähler, wird aber
  gelesen: Wärme kWh, MWh, GJ (2.500/9 kWh), Wasser m³, l, Strom kWh, MWh, als exakte Brüche auf kWh bzw. m³;
  Heizkostenverteiler und „Sonstiges“ (auch der Gaszähler, m³ und kWh Gas sind verschiedene Größen) ohne
  Umrechnung. Normiert wird beim Lesen (`unitKey`: „m3“, „cbm“, „KWh“ …, die Schreibweisen bei jeder Sparte),
  eine Migration gibt es nicht. **Leitsatz der Durchsicht: Ein Bestand, der vor #342 richtig rechnete, ändert
  sich nicht.** Wer Verbräuche mehrerer Zähler zusammenzählt, fragt `unitScale`, und zwar **nur mit den Zählern,
  die im Zeitraum Verbrauch beitragen** (`coveredDays` beim Verbrauchsschlüssel, sonst `coversPeriod`): Ein
  stillgelegter Zähler mit alter Einheit änderte sonst eine Abrechnung, in der er nichts misst. `relative`
  (Verbrauchsschlüssel samt Hauptzähler, Teilnehmern, Überschneidung und Zerlegung des Vermieteranteils; die
  Verteilung der eigenen Heizkostenabrechnung über `SelfMeter.scale`): Einheitlich heißt Faktor 1, auch bei MWh,
  Litern oder einer unbekannten Einheit, so bleiben gespeicherte Schätzungen nach § 9a und die Vorschläge in ihren
  Zahlen; nur gemischt bekannte Einheiten werden in die Grundeinheit umgerechnet. Der Ausweis nennt dann die Einheit
  der Zähler (`potUnits`, `potShownUnit`, `SelfPotView.consumptionUnit` ist ein Text); `estimateFits` und die
  gespeicherte `valueUnit` bleiben bei `potUnitFor`. Wird umgerechnet und gibt es eine Schätzung im Topf, sagt
  `heating.estimate-base-unit` (hint), dass ihre Zahl in kWh bzw. m³ gilt. `base` (absolute Vergleiche: Wärme am
  Speicher für α gegen die kWh der Brennstoffrechnung, Volumenvorschlag in db/co2.ts, monatliche Information)
  rechnet bekannte Einheiten immer in die Grundeinheit; das behebt α bei einem Speicherzähler in MWh. **Ein Zähler
  ohne Einheit gilt wie die übrigen.** Eine für die Sparte unbekannte Einheit neben anderen (etwa „m³“ an Wärme, die
  Vorgabe vor #142) sperrt nicht: Faktor 1 wie vor #342 und `meter.unit-unknown` (warning). Umgerechnet wird nur,
  wo alle Einheiten bekannt sind. `meter.units-mixed` (error, nicht verteilt) bleibt für verschiedene bekannte
  Größen ohne Umrechnung, also Gas über „Sonstiges“ in m³ neben kWh; das rechnete schon vorher falsch. Beide Hinweise
  nennen die Zähler mit Name und Einheit (`metersByUnitText`) und führen zur Seite Zähler (Subjekt `meter`, der
  erste Zähler mit unpassender Einheit). Das Ableseergebnis nennt die Einheit des Zählers
  (`SelfReadingView.meterUnit`). Auf der Seite Zähler ist die Einheit bei bekannten Sparten eine Auswahl
  (`meterUnitOptions`, eine gespeicherte unbekannte steht dabei); ein Zähler ohne Einheit bekommt keine Vorgabe,
  sondern „Bitte wählen“, und ein Spartenwechsel auf eine Sparte, die die Einheit nicht kennt, leert sie mit Hinweis
  (`unitDropped`, `meterUnitHint`); gespeichert wird bei Sparten mit Auswahl nur eine gewählte Einheit, eine schon
  leer gespeicherte darf leer bleiben. Der Server prüft nur eine neue oder geänderte Einheit (`acceptMeterUnit` in
  repository.ts, Muster der IBAN), nimmt bei Sparten mit Auswahl keine neue leere an und speichert die bekannte
  Schreibweise. Die Angaben nach § 6a (`heatingInfoOf`) stehen in kWh (#345): Steht der Topf Wärme in MWh oder GJ,
  rechnet heatingInfo.ts Verbrauch, Vorjahr und bereinigte Werte mit dem Faktor aus shared/meterUnits.ts um und
  vergleicht mit dem Vergleichswert in kWh je m²; der Ausweis nennt dann kWh. Vorperiode und Zeitraum rechnen mit
  denselben Zählern und Faktoren, stehen also in derselben Einheit. Heizkostenverteiler bleiben unvergleichbar.
  **Die Eichfrist** (#98, Heizung PR 21) ist eine Warnung und keine Sperre: `meters.calibrated_until`
  (Jahr, mit dessen Ende die Frist endet, § 34 Abs. 2 MessEV; Migrationen 0046/0047, Bedingungen
  `meters_calibrated_until_valid` mit `typeof`, weil die INTEGER-Affinität eine Kommazahl als REAL behält,
  und `meters_calibrated_until_hca_valid`) ergibt `meter.calibration-overdue` in `consumptionOverview`
  (Zähler-Seite, dort als `warn` und nicht als Fehler), nie auf der Abrechnung. Geprüft wird die jüngste
  Ablesung, die der Zeitraum benutzt (`readingsUsedFor` in server/src/calibration.ts: die im Zeitraum ab dem
  Vortag des Beginns, die davor und die erste danach nur, wenn interpoliert wird; ohne Gegenstück zählen sie
  nicht); eine Ablesung vom 31.12. des Eichjahres zählt noch. Liegt der letzte Zählerwechsel am letzten Tag
  des Zeitraums oder danach, misst das heutige Gerät im Zeitraum nichts, und es gibt keinen Hinweis. Die
  Regel `meter-calibration` hat `scope: 'meters'`: `rulesFor` lässt sie aus dem Rechtsstand jeder Abrechnung,
  denn die Abrechnung prüft nicht nach ihr. Das Cockpit zeigt eine eigene gelbe Zeile „Eichfrist“
  (`overdueMeters`, `calibrationDetail` in client/src/meterCheck.ts); die Ampel „Zählerstände“ zählt diesen
  Hinweis nicht (`readingProblems`). Heizkostenverteiler haben kein Eichjahr: Beim Umstellen der Sparte auf
  HKV fällt es weg, ausdrücklich gesendet gibt es 400. Die Fristen stehen im Register
  (`messev.calibration-years`, Zeitregel `eventDate`): ab 01.01.2015 Kaltwasser 6, Warmwasser und Wärme 5
  Jahre (amtlich aus BR-Drs. 599/21, Begründung zu Art. 1 Nr. 11 a), ab 03.11.2021 je 6 (Dritte
  Änderungsverordnung, BGBl. 2021 I S. 4742). **Die Verordnung hat keine Übergangsregel** (Art. 2 nur
  Inkrafttreten, § 58 Abs. 7 MessEV betrifft § 25, am Wortlaut gelesen am 12.10.2026). Die Änderungsverordnung
  vom 26.10.2021 enthält keine Übergangsregel. Mietfuchs wendet die Frist von 6 Jahren auch auf Fristen an, die
  am 03.11.2021 noch liefen; eine schon abgelaufene Frist lebt nicht wieder auf. Das ist eine Auslegung.
  Gerechnet wird sie in `calibrationEnd` (shared/calibration.ts; Jahreszahl 2016 bis 2021 ergibt J + 6, bis 2015 J + 5). Eine Praxis
  von Behörden oder Messdiensten wird nirgends als Beleg genannt, denn dafür gibt es keine Quelle (Durchsicht
  S1); Hinweis, Regel und Lexikon zitieren Leitsatz c wörtlich („abgelesenen Verbrauchswerten“, Durchsicht M1),
  ein Test hält beide Wortlaute fest. Der Vorschlag im Zählerformular sagt es mit demselben Satz; gefragt wird
  nach der Jahreszahl auf dem Zähler (Eichmarke: Jahr des Fristbeginns, Anlage 8; „M22“: Jahr der
  Kennzeichnung, vermutet als Inverkehrbringen). Hinweis, Regel und Lexikon zitieren BGH VIII ZR 112/10 nur
  mit dem Wortlaut von Leitsatz c. Gas- und Stromzähler haben das Feld, aber keinen Vorschlag (Frist nach
  Bauart, Anlage 7 Nr. 5.6, 6). Die Vierte Änderungsverordnung (2024) berührt diese Nummern nicht.
- **Leerstand beim Personenschlüssel** (#177): Jede Wohnung der Verteilbasis, die vermietet
  wird (`participates`, nicht selbstgenutzt, unter den Teilnehmern der Position), zählt für jeden Tag ohne Mietverhältnis mit `VACANCY_PERSONS` Personen (heute 1),
  auch zwischen zwei Mietern. Diese Personentage bekommt niemand zugebucht, ihr Anteil bleibt als
  `vacancy` beim Vermieter. Vorher fiel die leere Wohnung aus der Basis, und die übrigen Mieter
  zahlten ihren Anteil. Grundsatz: BGH VIII ZR 159/05 (am Flächenschlüssel); die fiktive Person
  nennt BGH VIII ZR 180/12 als Möglichkeit im Einzelfall, höchstrichterlich ist es nicht
  geklärt, abweichend etwa AG Köln WuM 2002, 28 (Durchschnittsbelegung). Die Zahl ist deshalb
  **eine Auslegung an genau einer Stelle** (`VACANCY_PERSONS`, verwendet über `vacancyPersons` in
  computeSettlement), und Hinweis `basis.vacancy-persons` (Stufe `hint`: nichts ist falsch
  erfasst) und Lexikon sagen das. `item.no-basis` hängt an den Personentagen der **Bewohner**
  (`occupantPersonDays`), nicht an der Basis samt Leerstand: Fehlen die Personen aller Mieter,
  bleibt das ein Datenmangel. **Wohnung ist, was Fläche hat oder bewohnt ist** (`isDwelling`,
  dieselbe Regel wie bei § 2 HeizkostenV): Eine Einheit ohne Fläche und ohne Bewohner (Garage,
  Stellplatz, auch ganz leer) ist kein Leerstand, sonst verschöben vier leere Stellplätze einen
  großen Teil der Müllabfuhr zum Vermieter; eine ganz leere meldet `basis.vacancy-no-area`, weil
  sie auch eine Wohnung mit vergessener Fläche sein kann. Eine leere Garage **mit** eingetragener
  Fläche zählt weiter als Leerstand. Der Rechenweg nennt die Leerstandstage („davon
  Leerstand“), der gedruckte `basisText` die Summe („(davon N Leerstand)“). Beide Hinweise färben
  die Cockpit-Ampel nicht (`INFORMATIONAL` in client/src/notices.ts). Abgeschlossene Abrechnungen bleiben, `deviation` zeigt
  den Unterschied.
- **Betriebsstrom der Heizung** (#212, Heizung PR 15): `cost_items.operating_power` sagt an einer
  Heizposition `included` (der Strom läuft über den Zähler des Hauses und steckt im Allgemeinstrom), an
  einer Position „Beleuchtung/Allgemeinstrom“ `deduction` (der Abzug); der Abzug zeigt mit
  `operating_power_item_id` auf seinen Betriebsstrom (`RESTRICT`, Löschen mit einem Satz gesperrt).
  Die Verweisbedingung vergleicht mit `IS` statt `=`: `NULL = 'deduction'` ist in SQLite kein Verstoß.
  Die Abrechnung prüft jede Position, die sie verteilt, gegen die Abzüge **aus allen Zeiträumen**
  (`operatingPowerDeductions` im Schnappschuss, `deductionsOf`), denn eine eigene Heizperiode und der
  Allgemeinstrom liegen oft in verschiedenen; `heating.operating-power-double` nennt die Differenz. Ein
  Abzug in einer abgeschlossenen Abrechnung hat vier Zustände am eingefrorenen Stand (`itemTotals`):
  gutgeschrieben, geändert (es zählt der eingefrorene Betrag), nicht darin (zählt nicht) und unlesbar
  (zählt nicht, aber der Text behauptet nichts und bittet nicht um neue Zustellung); je ein eigener
  Satz. Die Schätzhilfe (`shared/operatingPower.ts`, Route `POST /api/heating-plants/:id/operating-power`,
  `server/src/db/operatingPower.ts`) rechnet kWh aus Leistung, Laufzeit und Tagen je Gerät, nimmt den
  Zwischenzähler oder einen selbst geschätzten Betrag mit Pflichtgrundlage, Euro als Anteil an der
  Stromrechnung samt Grundpreis (Festlegung im Schätzermessen, im Rechenweg benannt), und legt beide
  Positionen in einer Transaktion an; 409, wenn Heizperiode oder Allgemeinstrom abgeschlossen sind. Die
  Grundlage der Schätzung steht als Text in `cost_items.operating_power_basis` an beiden Positionen und
  im Rechenweg (`no-print`), denn bestreitet ein Mieter den Betrag, muss der Vermieter sie darlegen
  (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz c). Bei Wärmepumpe und Stromheizung
  gibt es keine Hilfe: Der Strom zur Wärmeerzeugung gehört zu den Heizkosten, ist aber weder Brennstoff
  noch Betriebsstrom (§ 7 Abs. 2 HeizkostenV nennt seit 01.10.2024 die „Kosten des zur Wärmeerzeugung
  verbrauchten Stroms“ neben den Brennstoffen). Seine Heizposition (Teil `fuel`) darf trotzdem `included`
  tragen, wenn die Anlage mit Strom heizt (`POWER_GENERATED`, geprüft in `guardOperatingPower`), damit
  ein Abzug auf sie zeigen kann; das Herausrechnen ist als Auslegung gekennzeichnet. Umwälzpumpen und
  Regelung bleiben Betriebsstrom. **Durchsicht von #252:** Der Abzug zeigt außerdem auf seine
  Stromrechnung (`operating_power_general_id`, Schritt 0039 mit Datenanweisung, Bedingungen in 0040):
  dasselbe Objekt und derselbe Zeitraum, Löschen und Umstellen der Rechnung gesperrt, solange er besteht;
  Hinweise `heating.operating-power-key` (anders verteilt als die Rechnung), `-exceeds` (mehr Abzug als
  Rechnung); `-tax-year` (Betriebsstrom und Abzug in verschiedenen Steuerjahren) entfällt seit #268, siehe Steuer. Die Schätzhilfe
  nimmt nur eine Stromrechnung, die die Heizperiode berührt, übernimmt deren Jahr der Zahlung, wo der
  Zeitraum zwei Kalenderjahre berührt, lehnt eine Summe der Abzüge über der Rechnung ab (400) und fragt
  bei schon gebuchtem Betriebsstrom zurück (409 mit `question: 'despiteExisting'`; nur dann bietet die
  Karte „Trotzdem anlegen“). Dieselbe Summenregel gilt im Kostenformular (Abzug anlegen oder ändern,
  Rechnung verkleinern). Beim Steuerjahr folgt der Abzug seit #267 der Stromrechnung (outflow.ts), nicht mehr dem
  Betriebsstrom; der Betriebsstrom hat das Jahr seiner Heizperiode bzw. das angegebene. Beim Wechsel des Abrechnungszeitraums wandern Rechnung und Abzüge
  als Einheit: Die Prüfungen gelten für den Endstand (Option `periodChange`, `settleOperatingPowerLinks`),
  der Abzug folgt immer dem Endzustand seiner Rechnung (auch wenn deren Leistungszeitraum ganz in einem
  neuen Zeitraum liegt und die Gruppe des Abzugs woandershin geht; dann steht er in der Vorschau unter
  `moves` und in keiner Gruppe), denn der Betriebsstrom steckt in jedem Teil der Rechnung; jeder Teil zeigt
  auf den Teil der Rechnung im selben Zeitraum. Mehrere Abzüge einer Rechnung werden **gemeinsam** geteilt
  (`splitDeductionsAlike` in serviceSplit.ts), und zwar nach den **Beträgen** der Teile, nicht nach Tagen:
  Nur so ist aus keinem Teil mehr abgezogen, als er beträgt, auch bei drei und mehr Teilen und wenn die
  Abzüge die ganze Rechnung ergeben (Restverfahren nach Tagen ist nicht monoton). Das Jahr der Zahlung
  eines Abzugsteils fragt die Vorschau nicht und schreibt keines (#267): Jeder Teil steht im Zeitraum seines Teils der
  Rechnung und damit in dessen Jahr. Die frühere Einschränkung auf den Schnitt der Spannen und die Sperre eines Ziels
  ohne passendes Jahr (`noYearText`) sind damit entfallen, ebenso zählt ein Abzug nicht in den Sätzen zur Verschiebung
  (`followsBill`). Einen Satz zur Verschiebung in der Anlage V bei einem Teil mit festem Jahr gibt es seit #268 nicht
  mehr, denn die Steuerübersicht gleicht je Steuerjahr aus und es verschiebt sich nichts. Geprüft wird das
  **je Mieter** gegen von Hand hergeleitete Beträge, nicht je Zeitraum: „Abzug gleich Betriebsstrom je
  Zeitraum“ hielt auch ein falsches Ergebnis aus. Ein
  Scheitern ist eine 409 mit Vorschau. Kein Objektwechsel, solange ein
  Verweis besteht; `crossPropertyViolations` kennt beide. `included` nur mit positivem Betrag. Liegt ein
  Abzug in einer abgeschlossenen Abrechnung, hat jeder Zustand seinen eigenen Text, und keiner rät zu
  einem neuen Abzug in einem anderen Jahr. „Aus dem Vorjahr übernehmen“
  behält nur die Kennzeichnung `included`, nicht Grundlage und Abzug. Die Prozentspannen der Literatur
  stehen nur im Lexikon: BGH V ZR 166/15 Rn. 14 lässt den Bruchteil der Brennstoffkosten als
  Schätzgrundlage zu, gibt die Werte aber nur wieder und legt keinen fest; Mietfuchs rechnet ihn bewusst
  nicht vor. Kein Eintrag im Regelverzeichnis, denn der änderte den Rechtsstand jeder Abrechnung.
- **Betriebsstrom fehlt und Strom der Wärmepumpe im Allgemeinstrom** (#224, #253, Folge-PR zu #252,
  `missingPowerFindings` in server/src/operatingPower.ts): zwei Hinweise der Stufe `hint`, nur in der
  Gesamtberechnung, beide reine Auskunft. `heating.operating-power-missing` kommt bei einer zentralen
  Anlage mit Brenner (nicht Fernwärme, nicht „sonstige“), ohne Messdienst, ohne Eigentümergemeinschaft, mit
  Heizkosten im Zeitraum und Allgemeinstrom (nicht `external`/`amounts`), wenn keine Heizposition
  gekennzeichnet ist, keine den Teil „Betrieb“ hat, keine ohne Teil ist und kein Abzug als Antwort gilt
  (ohne Verweis oder auf eine Position dieser Anlage). **Die Grenze ist gewollt:** Ohne Angabe an der Anlage
  schweigt er, sobald irgendeine Position „Betrieb“ besteht, auch nur die Wartung, denn dann ist sie von
  einer Rechnung über einen eigenen Stromvertrag nicht zu unterscheiden, und wegklicken lässt sich ein
  Hinweis nicht. Er färbt die Cockpit-Ampel nicht (`INFORMATIONAL`), weil er auch den rechtmäßigen Fall
  „eigener Stromvertrag, Vermieter trägt selbst“ trifft. **Die Angabe an der Anlage** (#266,
  `heating_plants.operating_power_handling`, Schritte 0041/0042, Karte „Betriebsstrom der Heizung“ auf der
  Seite Heizkosten) unterscheidet die Fälle: `deducted` (über die Stromrechnung des Hauses, auch mit
  Zwischenzähler, beim Allgemeinstrom abgezogen) meldet `heating.operating-power-deduction-missing`, wenn
  Allgemeinstrom da ist, aber weder Abzug noch gekennzeichneter Betriebsstrom, **auch wenn eine Position
  „Betrieb“ besteht**; das ist die Lage aus V ZR 166/15 und VIII ZR 27/07, deshalb färbt er gelb.
  `ownMeter` (eigener Stromvertrag, Rechnung als Heizposition „Betrieb“) meldet
  `heating.operating-power-bill-missing`, wenn weder Position „Betrieb“ noch ohne Teil noch Kennzeichnung
  noch Abzug besteht, **auch ohne Allgemeinstrom** (er betrifft die eigene Rechnung); er färbt nicht, denn
  der Vermieter verliert nur eigenes Geld. `landlordPays` schweigt immer, `null` verhält sich wie vor #266.
  Die Werte richten sich nach **Stromvertrag und Rechnung, nicht nach dem Zähler** (E1 mit Rechtsprüfung
  M-1): Läuft der Strom über die Rechnung des Hauses, muss er dort heraus, gleich wer ihn trägt, und ein
  Zwischenzähler ersetzt nur das Schätzen (VIII ZR 27/07, Rn. 32). Eigene Codes statt Varianten (E6), weil
  Stufe und Ampel am Code hängen. Die Angabe steht an der Anlage, nicht je Heizperiode (E2), der Kesseltausch
  übernimmt sie (E3), der Server nimmt sie an jeder Anlage an (E4), und ob gefragt und ausgewertet wird,
  entscheidet einmal `asksOperatingPowerHandling` in shared/operatingPower.ts (E5). Frage, Beschriftungen
  und die zitierte Frage des Kostenformulars stehen dort als Konstanten, damit Hinweis, Lexikon und
  Oberfläche wortgleich sind (OperatingPowerFields.test.tsx hält die gerenderte Frage fest). Ist die
  Position „Betrieb“ womöglich schon der Betriebsstrom selbst, sagt `deduction-missing`, ihn zu kennzeichnen
  statt mit der Karte ein zweites Mal anzulegen; die Karte sieht eine Position ohne Kennzeichnung nicht.
  Keine Zahl ändert sich; ein Satz zur Steuer beim Weg „abziehen und selbst tragen“ steht bewusst nicht
  darin (eigener Befund). `heating.generation-power-missing` kommt bei Wärmepumpe und
  Elektrokessel ohne eigene Stromrechnung (Teil `fuel`, ohne Teil, Lieferung) und ohne Abzug, auch ganz
  ohne Heizposition, solange die Anlage im Zeitraum besteht; er färbt gelb. Die Daten der Fassungen kommen
  aus dem Register (`betrkv.generation-power` ab 01.01.2024, `hkv.generation-power` ab 01.10.2024, beide
  `overlap`, BGBl. 2023 I Nr. 280): ganz vor 2024 schweigt er, die HeizkostenV nennt er nur, wo der Zeitraum
  ihre Fassung berührt und `heating.heat-pump-capture` für die Anlage nicht meldet, dass sie noch nicht
  gilt (§ 12 Abs. 3 Satz 2). Abgefragt wird das Register erst, wenn der Hinweis sonst käme, damit es nicht
  im Rechtsstand jeder Abrechnung mit Wärmepumpe steht. Das Herausrechnen und die Schätzung sind beim
  Strom zur Wärmeerzeugung als Auslegung gekennzeichnet; entschieden ist beides für den Betriebsstrom.
- **Wärmelieferung, Contracting** (#213, Heizung PR 16, [shared/heatDelivery.ts](../../shared/heatDelivery.ts),
  [server/src/heatDelivery.ts](heatDelivery.ts)): `heating_plants.contracting` (Schritte 0043/0044)
  an jeder zentralen Anlage außer Fernwärme, **auch an der Wärmepumpe** (Prüfung R-M4); `energy` ist dann der
  Brennstoff des Kessels. Dazu `heat_delivery_since`, `previous_supply` (`landlord` | `tenant`) und
  `switch_announced_on`, nur bei Fernwärme oder Contracting. **Eine Naht:** `asBilledPlant` in `snapshotFor` und
  `heatingSnapshotFor` gibt der Berechnung bei Contracting `energy = 'districtHeating'` und daneben
  `fuelEnergy`; damit gelten die Regeln der Fernwärme ohne weitere Zeile (kein Pflichtanteil nach § 7 Abs. 1
  Satz 2 wegen § 7 Abs. 3, ÷ 1,15 nach § 9 Abs. 2 Satz 6 Nr. 2, kein Vorrat, Lieferungen als Wärmerechnungen).
  `asBilledPlant` ist idempotent (calc.ts baut Schnappschüsse auch aus Schnappschüssen). Schreibwege, Oberfläche,
  Betriebsstrom und das Blatt für den Messdienst fragen `billingEnergy`; der Wächter
  [heat-delivery-guard.test.ts](../test/heat-delivery-guard.test.ts) verbietet dort `plant.energy` in
  Entscheidungen (Vorrat, Heizwerttabelle, Pflichtanteil, CO₂-Felder, Betriebsstrom), mit benannten Ausnahmen.
  **Ausnahmen der Naht:** § 2 Abs. 4 Satz 2 CO2KostAufG hängt an der gespeicherten Energie; ob CO₂ aufzuteilen
  ist, sagt `co2Required` nach dem Brennstoff des Lieferanten (`NO_CO2_FUELS`: Pellets, Holz, Strom, Wärmepumpe;
  „Sonstiges“ bleibt pflichtig, Auslegung); die Informationen nach § 6a nennen den Brennstoff (`generatorEnergy`)
  und verlangen Werte eines Wärmenetzes nur bei Fernwärme ohne Merkmal (§ 6a Abs. 3 Satz 1 Nr. 1 Buchst. a,
  Prüfung C-M2); bei Contracting mit Wärmepumpe sperrt dhw.ts die Formeln (`heating.dhw-share-invalid`), denn
  offen ist, ob Satz 6 Nr. 2 oder Nr. 3 gilt; gemessen rechnet sie gegen die gelieferte Wärme. § 11 Abs. 1 Nr. 3
  Buchst. a a. F. und § 12 Abs. 3 hängen am Wärmeerzeuger (`generatorEnergy` in calc.ts, Durchsicht von #272, M1;
  Auslegung am Wortlaut von § 1 Abs. 1 Nr. 2); bei Contracting mit Pellets, Holz, Strom oder Wärmepumpe teilt die
  Berechnung kein CO₂ auf und prüft keine CO₂-Werte, auch wenn eine Rechnung welche trägt.
  Nach dem Betriebsstrom fragt Mietfuchs bei Contracting wie bei Fernwärme nicht (Prüfung C-M3). **Umschalten**
  des Merkmals an einer Anlage mit Lieferungen, Vorrat, CO₂-Angaben oder Heizpositionen und Angaben (Verteilung,
  Warmwasser) eines offenen Zeitraums ist gesperrt (409, Weg über den
  Kesseltausch), denn die Abrechnung hängt am Merkmal und nicht an einem Datum; der Kesseltausch nimmt Merkmal
  und Angaben an (`SWAP_FIELDS`) und vergleicht nach der Energie der Abrechnung, Gas → Gas mit Contracting ist
  also ein Tausch (Prüfung C-M1); die Oberfläche schlägt den Tag des Tauschs als Tag der Umstellung vor.
  `heating.contracting` (hint, färbt das Cockpit nicht, führt zur Anlage) nennt für Mieter, deren Mietvertrag
  vor der Umstellung geschlossen wurde (`contractDate`, sonst Mietbeginn) und am Tag noch lief, ohne Inklusivmiete
  bei der Heizung (eine Betriebskostenpauschale zählt mit, § 556 Abs. 2 BGB, Auslegung; Durchsicht von #272, S1): die beiden Voraussetzungen des § 556c Abs. 1 BGB, die Ankündigung als
  eigene Pflicht (Abs. 2) mit § 11 Abs. 3 WärmeLV bei Zugang ab dem Tag `noticeMonths` Monate vorher
  (Auslegung entsprechend §§ 187, 188 BGB, im Text als vorsichtige Auslegung mit dem letzten Tag genannt; eine
  Ankündigung nach der Umstellung hat einen eigenen Satz), den Weg über § 5 WärmeLV; bei vorheriger Eigenversorgung der Mieter
  BGH VIII ZR 46/25 und 47/25 (Volltext geprüft am 11.10.2026: § 556c gilt nicht; im entschiedenen Fall
  jedenfalls § 7 Abs. 2, § 8 Abs. 2 HeizkostenV, der volle Umfang offen); vor dem 01.07.2013 einen eigenen
  Text (VIII ZR 54/04). Der Wortlaut folgt der rechtlichen Gegenprüfung. Die Zahlen kommen aus
  `bgb.heat-delivery-switch` (ab 01.07.2013, `eventDate`); kein Eintrag im Regelverzeichnis, damit § 556c
  nicht im Rechtsstand jeder Abrechnung steht. Nicht abgebildet: die Lieferung mit unmittelbarer Abrechnung
  des Lieferanten (§ 1 Abs. 3, § 11 Abs. 1 Nr. 4 HeizkostenV) und Contracting bei Etagenheizungen.
- **Hälftige Teilung nach § 5a CO2KostAufG** (#215, Heizung PR 18, [server/src/halfSplit.ts](halfSplit.ts),
  [shared/law/gmodg.ts](../../shared/law/gmodg.ts)): Ab 2028 trägt der Vermieter bei einer Heizung nach § 43 Abs. 1 GModG
  die Hälfte der Gasnetzentgelte und CO₂-Kosten, ab 2029 des Pflichtanteils an Biobrennstoff (bis 30 % des
  Brennstoffs). Merkmale: `heating_plants.gmodg43_installed_on` (gesetzt heißt „Heizung nach § 43“, nur Gas, Öl,
  Flüssiggas, nach dem 29.07.2026 außer im Neubau), `emergency_install`, `emergency_prior_duty` (gefragt als „war die
  ausgefallene eine solche Heizung, nach dem 29.07.2026 eingebaut?“, Prüfung M8), `new_building_first_use`,
  `building_application_before_2026_05_13`; `tenancies.half_split_notice_on` (§ 5d Abs. 4 je Mieter);
  `properties.tight_market` mit `tight_market_from`/`_to` (Geltung der Verordnung); Schritte 0048/0049, die
  Bedingungen an NULL-fähigen Merkmalen vergleichen mit `IS 1`, weil `= 1` bei NULL die Bedingung bestehen ließe.
  **Die Zeitregel ist `incurred`**: `law()` teilt den Zeitraum an den Fassungen von `co2.half-split` und gewichtet
  nach Anfall; je Lieferung nach den Stufen 1–5 (`deliveryShare` mit dem `ctx` aus `fuelResults`), ohne Lieferungen
  (Messdienst, Vorrat) nach Gradtagen; dass auch die CO₂-Kosten nach Anfall geteilt werden, ist Auslegung (15.1
  Nr. 13). Vor 2028 und ohne Merkmal fragt `halfSplitOf` das Register nicht. § 5a Abs. 4 Satz 2 heißt zwölf Monate
  ab dem Einbau (BT-Drs. 21/7009, S. 154), „zwölf Monate ab“ rechnet `eventPeriodEnd` (§§ 187, 188 BGB); ein Einbau
  genau zwölf Monate vor dem 01.01.2028 wird nach dem Wortlaut geteilt und als Auslegung genannt. `selfSplit` mischt
  den Anteil nach Stufen (mit § 8 und § 9) und die Hälfte; § 9 kürzt nur den Teil nach Stufen (Auslegung zulasten
  des Vermieters; bei § 9 Abs. 2 ist der Teil nach Stufen 0 ‰, nie „unbekannt“). Die Nachstufung des Messdienstes
  mischt über den vorhandenen Parameter `adjust` von `restage` mit Toleranz 1 ‰. Die Etagenheizung mischt je Wohnung
  nach ihren Rechnungen. Im selbst bewohnten Gebäude mit höchstens zwei Wohnungen an einer zentralen Anlage gilt
  die Ausnahme des § 5d Abs. 3 nur bei festgestellten Voraussetzungen: Gebiet in der Heizperiode „nein“ und für
  jeden Mieter eine zählende Mitteilung, vor Beginn der Heizperiode oder, wenn der Vertrag schon vor den
  Voraussetzungen bestand, bis zum Ende der Abrechnungsfrist (§ 5d Abs. 4 Satz 2). Contracting ist eingeschlossen
  (BT-Drs. 21/6278, S. 124); ob Gas, entscheidet `generatorEnergy` (Ausnahme der Naht, im Wächter benannt).
  Netzentgelte und Biobrennstoff stehen als Zeilen `gmodgRelief` unter `gmodg:<Anlage>:<Heizperiode>` mit Grund
  `gmodgShare` (§ 7 Abs. 5), verteilt nach dem Anteil am Brennstoff; **jede Stelle, die die CO₂-Abzugszeile an
  `reliefKey` erkennt, fragt `reliefKeysOf`** (Kürzungsbeträge, Ausweis der eigenen Abrechnung, Vorschlag nach
  § 560 im Rumpf; Prüfung M5). Fehlen Netzentgelte oder Biobrennstoff an einer Lieferung mit Tagen in der Teilung,
  warnt `co2.half-split-missing` mit 3 % je Mieter; Biobrennstoff aus dem Vorrat rechnet Mietfuchs nicht (Warnung,
  außer an jeder Lieferung ab dem 01.01.2029 (oder ohne Datum) steht 0, Durchsicht S3; ein Betrag über 0 wird abgelehnt, ebenso ab 2040).
- **Mieter heizt selbst und die CO₂-Erstattung** (#97, Heizung PR 19, [server/src/co2Refund.ts](co2Refund.ts),
  [server/src/db/co2Refunds.ts](db/co2Refunds.ts)): `heatingModel: 'selfSupply'` heißt, der Mieter
  bezieht Brennstoff oder Wärme über einen eigenen Vertrag, als Etagenheizung oder als zentrale Heizung mit
  Brennstoffvertrag beim Mieter (§ 2 Abs. 1, § 6 Abs. 2 CO2KostAufG). **Nie wie Pauschale oder Inklusivmiete lesen**:
  `allocationModel` macht daraus `settlement` für `modelFor`, `notSettled`, `heatingFlat` und `costModels`, denn
  Wartung und Betriebsstrom, die der Vermieter trägt, bleiben umlegbar. Für eine solche Anlage entsteht **keine
  Heizanlage** (die Einrichtung fragt bei Gas, Öl, Flüssiggas und Kohle nach dem Liefervertrag und bietet die
  Umstellung der Mietverhältnisse an; ein Mieter, über dessen Vertrag auch Dritte versorgt werden, ist nicht
  abgedeckt). Die Art steht in `selfSupplyKind` (`perUnit` Heizung in der Wohnung, `central` zentrale Heizung, Schritte
  0052/0053): Bei `central` meldet `heating.self-supply-operating-power` (Auskunft, färbt nicht, wie Hinweis A aus #265), wenn andere Mieter den Allgemeinstrom
  tragen und kein Abzug des Betriebsstroms erfasst ist (V ZR 166/15, Rn. 13); die Art geht beim Mieterwechsel mit.
  Heizpositionen, die nur Selbstversorger tragen, melden keine Kürzung nach § 7 Abs. 4 CO2KostAufG und
  keine nach § 12 HeizkostenV (bei der Etagenheizung gilt die Verordnung nicht, beim einzigen Nutzer wird nichts
  verteilt; Auslegung), sondern `co2.self-supply-items`; wer selbst heizt und zugleich Positionen einer Heizanlage
  trägt, bekommt `co2.self-supply-mixed` (error). Die Erstattung (`co2_refunds`, Schritte 0050/0051) gibt es nur bei
  `selfSupply` (Route 400, Abrechnung `co2.refund-not-self` und keine Zeile); verrechnet wird sie als Zeile
  `co2Refund` (Kostenart `CO₂-Erstattung`, ohne Position) mit Gegenzeile `co2Refund` beim Vermieter, Σ unverändert;
  nur in einem Zeitraum, in dem der Mieter wohnte, nie in einem abgeschlossenen, und eine dort verrechnete bleibt
  unveränderlich. Gebucht wird der angezeigte Betrag; die Nachrechnung (`selfSplit` wie bei der eigenen Aufteilung:
  Stufe, § 8 Abs. 2, § 9 nur auf den Teil nach Stufen, § 5a nach Gradtagen) steht im Rechenweg, eine Abweichung
  meldet `co2.refund-differs`; über mehr als ein Jahr rechnet sie nicht nach (umzurechnen ist nach § 5 Abs. 1 Satz 5,
  offen ist nur das Verfahren). **Steuer:** Eine verrechnete Erstattung wirkt über Saldo und Zahlungen; eine
  ausgezahlte (`paidOutOn`) steht in `taxReport` im Jahr der Auszahlung als Werbungskosten (§ 11 Abs. 2 EStG) und
  **nie als negative Zahlung im Mietkonto** (die läse `rentLedger` als Rücklastschrift). Der Vorschlag nach § 560 Abs. 4 BGB rechnet mit `recurringShareCents` ohne Erstattungen.
  Offen ist, ob § 8 Abs. 2 seit der Neufassung von § 6 Abs. 2 noch auf die Auszahlungsfrist verweist; Mietfuchs warnt.
- **Überschneidende Mietverhältnisse einer Wohnung** (#204): Wann sich zwei überschneiden (ein
  gemeinsamer Tag, inklusive Grenzen), steht einmal in [shared/tenancyOverlap.ts](../../shared/tenancyOverlap.ts);
  Server und Oberfläche fragen dieselbe Funktion. Gerechnet wird wie erfasst, jedes mit vollem
  Tagesanteil, aber mit Hinweis `tenancy.overlap` der Stufe `error` und beziffertem Mehrbetrag
  (`overlapExtra` in calc.ts): je Position, was die Wohnung ohne die Überschneidungstage **eines**
  der beiden weniger trüge, beide Lesarten gerechnet und beide genannt, wenn sie verschieden sind
  (eine kann 0 sein, etwa neben einer Pauschale), denn welches Datum falsch ist, weiß nur der
  Vermieter. Kosten (zu viel getragen) und Gutschriften (zu viel gutgeschrieben) werden getrennt
  summiert; es ist die Summe der Überzahlungen je Position, kein Saldo. Je Position wird zur Seite
  „zu viel“ geklemmt, eine Lesart von 0 heißt also nur „nicht zu viel“ und nie „keine Auswirkung“. Bei Schlüsseln mit fester Basis ist das der Anteil an
  den doppelten Tagen (beim Verbrauch nach dem in der Zeit gemessenen Verbrauch); beim
  Personenschlüssel stecken die Personentage auch in der Basis, dort wird neu geteilt
  (S/P − (S − o)/(P − o)); bei Einzelbeträgen entsteht nichts doppelt. Die Stammdaten fragen beim
  Speichern nach (`overlapQuestion` in client/src/tenancyModel.ts), der Server lehnt nicht ab, und
  Validator, Umstieg und Backup rücken nichts gerade. Ein Hinweis der Stufe `error` färbt die
  Cockpit-Ampel rot (`attentionLevel` in client/src/notices.ts).
- **Beteiligung je Wohnung** (drei Zustände, siehe `UnitUsage` in shared/types.ts): `participates:
  true` = vermietet, Anteil trägt der Mieter · `selfUsed: true` = selbstgenutzt, zählt in die
  Verteilbasis von `area`/`units`/`persons` (dort mit `selfPersons`), Anteil fällt in den
  Vermieteranteil · beides `false` = außerhalb der Abrechnungseinheit, bleibt ganz außen vor.
  Grund für die Basis-Zugehörigkeit: Kosten einer Rechnung über das ganze Haus dürfen nur
  anteilig auf die Mieter umgelegt werden. Beim `meter`-Schlüssel bilden **alle**
  Wohnungszähler die Basis, unabhängig vom Kennzeichen — ein Zählerstand belegt Verbrauch
  innerhalb der abgerechneten Menge. **Fehlt einer Wohnung der Verteilbasis der Zähler, wird
  der Hauptzähler (Zähler ohne Wohnung) zur Basis** (#116, Vorwegabzug): Ihr Verbrauch ist der
  Rest nach Abzug der Wohnungszähler, bei selbstgenutzten Wohnungen als Eigenanteil, bei einer
  vermieteten ohne Zähler beim Vermieter und mit Warnung, denn aufteilen ließe er sich nur mit
  einer erfundenen Regel. Vorher zahlte bei einer Einliegerwohnung mit Zwischenzähler der
  Mieter die ganze Rechnung (gemessen 1.000 € statt 200 €). Haben alle Wohnungen Zähler, bleibt
  es beim Verhältnis der Wohnungszähler, und die Messdifferenz geht darin auf; zeigen sie
  zusammen mehr als der Hauptzähler, ebenso, dann mit Warnung. Mit Teilnehmern (#94) gilt der
  Hauptzähler nie, er misst das ganze Haus. Vier Feinheiten aus der Durchsicht, jede mit Test:
  Gefragt wird nur nach **bewohnten** Einheiten (selbstgenutzt oder mit Mietverhältnis im
  Jahr), eine leere Garage verbraucht nichts; ohne Teilnehmer nach **allen** Einheiten des
  Objekts, auch außerhalb der Abrechnungseinheit, denn deren Verbrauch steckt ebenfalls im
  Hauptzähler und gehört nicht in den Eigenanteil. Ein Zähler **ohne Ablesung im Jahr** zählt
  nicht als Zähler (`coveredDays`). Und ein Hauptzähler, der **nicht das ganze Jahr** abdeckt,
  wird nicht zur Basis, sondern ergibt eine Warnung: Der Versorger liest selten zum 31.12. ab,
  und ein Teiljahr gegen ganzjährige Wohnungszähler ließe den Mieter zu viel zahlen. Einer Einheit
  mit `noConnection` für den Zählertyp (#117, Tabelle `unit_no_connection`) fehlt kein Zähler,
  etwa die vermietete Garage ohne Wasser. `computeSettlement` liefert den auf `selfUsed`-Wohnungen
  entfallenden Teil separat als `selfUsedShareCents` (für die Anlage V privat, nicht
  abziehbar). Ein Datenschritt setzt das Kennzeichen bewusst **nicht** automatisch, weil es die
  Verteilung bereits abgerechneter Jahre verändern würde.
- **Mietkonto** (`rentLedger`): Kaltmiete-Staffel (`baseRents`) + Vorauszahlung ergeben das
  monatliche Soll (Bruttomiete); Zahlungseingänge (`payments`) werden Jan→Dez FIFO auf die
  Monate verteilt (Status bezahlt/teilweise/offen). Im angebrochenen Ein- und Auszugsmonat ist
  das Soll anteilig nach Kalendertagen, mit derselben Funktion wie die Abrechnung (`rateInMonth`,
  #311); der Monat trägt dann `share` und die Seite zeigt „anteilig 17/31 Tage“. Vorher fehlte im
  Einzugsmonat das ganze Soll, und im Auszugsmonat meldete `prepayment.arrears` einen Rückstand,
  den es nicht gab. #281 (Übertrag, Tilgung nach § 366 BGB) baut auf dieser Funktion auf; die
  Verteilung der Zahlungen bleibt dort.
  **Nur die Miete** (#280): Jede Zahlung hat eine Art (`payments.kind`, `rent` oder `settlement`,
  Vorgabe `rent`; fehlt sie im Schnappschuss, gilt Miete, `isRentPayment` in calc.ts). Nachzahlung
  und Guthaben aus der Abrechnung (Guthaben negativ) verteilt das Mietkonto nicht, sondern führt sie
  in `settlementYearCents` je Zeile und in `settlementOnly` für Mietverhältnisse ohne Tag im Jahr
  (meist nach dem Auszug; eigene Liste, weil eine Zeile ohne Soll in `costModels` mitzählte). Auch
  „wird das Mietkonto geführt“ (`prepayment.arrears`) und „ohne Zahlung“ (`tenanciesWithoutPayment`)
  fragen nur Mietzahlungen. Die Steuerübersicht zählt beide Arten im Ist (§ 11 Abs. 1 EStG) und
  nennt `settlementBackPaymentsCents` und `settlementRefundsCents` daneben, mit dem Saldo für Zeile
  21 nur in den belegten Jahren (siehe unten). Die Oberfläche (client/src/paymentForm.ts) zeigt die
  Abrechnung nach dem Vorhandensein solcher Zahlungen, nicht nach ihrer Summe, lässt die Art einer
  erfassten Zahlung umstellen (erst nach Rückfrage, `kindChangeQuestion`: Mit den Pfeiltasten
  wechselt ein Auswahlfeld seinen Wert schon beim Durchgehen der Tabelle), beginnt ohne
  Mietverhältnis im Jahr mit „Abrechnung“ und fragt nach, bevor eine Miete ohne Zeile im Mietkonto
  gespeichert wird. Ein mit der Miete verrechnetes Guthaben ist volle Miete plus negative
  Abrechnung, sonst stünde der Monat offen und der Zufluss zu niedrig. Die Kaution gehört nicht
  dazu (#228). Spalte und Bedingung in zwei Schritten (0058/0059); der eingefrorene Eingang kennt
  die Spalte nicht, die Vorgabe gibt sie.
- **Steuer/Anlage V** (`taxReport`): aggregiert Einnahmen (das Soll aus `rentLedger`, das Ist
  unmittelbar aus den Zahlungen) und
  Werbungskosten (Kostenpositionen nach `ANLAGE_V_GROUP`-Mapping), liefert §35a-Summe,
  Gesamtfläche und selbstgenutzte Fläche in Quadratmetern (#68: **das Private wird gemessen, nicht
  das Vermietete**, denn nur das ist eindeutig, und die Anlage V fragt genau diese beiden Zahlen
  im Kopf ab; die Grundmenge ist das ganze Gebäude und damit eine andere als die Verteilbasis der
  Abrechnung) sowie den Überschuss. Bewusst beschreibende Gruppen statt fester
  Anlage-V-Zeilennummern.
  **Bei teilweiser Eigennutzung teilt sie jede Position in privat und abziehbar** (#163,
  `splitForTax` in calc.ts, Entscheidungen samt Quellen in
  [docs/superpowers/specs/2026-10-02-steuer-eigennutzung-design.md](../../docs/superpowers/specs/2026-10-02-steuer-eigennutzung-design.md)).
  Direkt zugeordnet gehört eine Position ganz zu ihrer Einheit; nicht umlagefähige Gebäudekosten
  gehen nach der Fläche der betroffenen Einheiten (Teilnehmer, sonst das ganze Objekt wie #68;
  BFH IX R 26/06); **umlagefähige übernehmen den Eigenanteil der Abrechnung** (`landlordParts`
  mit `selfUse`), damit Abrechnung und Steuer dasselbe sagen; **außer** es gibt unter den
  betroffenen Einheiten eine außerhalb der Abrechnungseinheit: Dann gilt bei den Schlüsseln über
  Wohnungen (Fläche, Einheiten, Personen, vereinbart, Gemeinschaft) die Gebäudefläche, denn der
  Eigenanteil der Abrechnung lässt diese Einheit außen vor und ist kein Anteil am ganzen Gebäude
  (`settlementPrivateCents` steht zum Vergleich daneben). Der Hinweis dazu nennt den Abstand **mit
  Richtung** (`excludedAreaDifference`): Beim Flächenschlüssel ist es weniger privat, beim
  Personenschlüssel kann es auch mehr sein. Das ist eine Auslegung: Bei Personen,
  Einheiten, vereinbarten Anteilen und Gemeinschaft rechnet `areaPrivateCents` zum Vergleich nach
  Fläche, und ein Hinweis beziffert den Abstand. Leerstand ist dabei keine Ursache mehr: Seit #177
  bleibt der Anteil einer leeren Wohnung als `vacancy` beim Vermieter, ist nicht privat und bleibt
  bei Vermietungsabsicht abziehbar; der Hinweis sagt das so. Hat die Abrechnung eine Position nicht verteilt
  (`noBasis`), gilt die Fläche. Bei abgeschlossener Abrechnung kommen die Eigenanteile je Position
  aus dem eingefrorenen Stand (`selfUseByItem` in `frozenSettlementOf`), aber nur für Positionen,
  die mit demselben Betrag darin stehen (`itemTotals`); nachgetragene oder geänderte rechnet sie
  heute (`closedItemsChanged`); eine 0-€-Position, für die ältere Versionen keine Zeile schrieben,
  zählt dabei nicht als geändert. Ein Archivstück von vor
  #142 oder eines, dessen Teile nicht die Summe ergeben, verteilt die eingefrorene Summe im
  Verhältnis der heutigen. `abziehbar = Betrag − privat` je Position, Rundung spiegelbildlich
  (und ohne negative Null, die Invariante fand sie). **Der Überschuss rechnet mit
  `deductibleCents`**, `totalCents` bleibt die Bruttosumme. Ohne selbstgenutzte Einheit ist nichts
  privat, und keine Zahl ändert sich (Invariante in calc.test.ts). Die Abrechnung bleibt
  unberührt. „Nicht umlagefähig“ lässt sich im Formular für die Steuer einer Einheit zuordnen
  („Betrifft (für die Steuer)“, gespeichert als `key: 'direct'`) oder bestimmten Einheiten
  (`participantUnitIds`); die Abrechnung liest das nicht.
  AfA, Schuldzinsen, § 82b EStDV, verbilligte Vermietung und ein Nutzungswechsel im Jahr werden
  nicht gerechnet, nur genannt. Zeilennummern der Anlage V nennt die Seite nur, wo der Vordruck 2025
  sie belegt (11, 12, 33/34, 87/88); eine Anleitung 2025 war nicht auffindbar. Dazu Zeile 21
  (Kennzahl 11, Nachzahlungen und Erstattungen aus der Nebenkostenabrechnung, saldiert; Zeile 23 bei
  Angehörigen, Zeile 19) für 2023 bis 2025, je im amtlichen Vordruck des Jahres nachgesehen: 2023
  und 2024 im Formular-Management-System der Bundesfinanzverwaltung („2023AnlV101NET – September
  2023 –“, „2024AnlV101NET – September 2024 –“), 2025 bei der Finanzverwaltung NRW („2025AnlV101 –
  September 2025 –“), jeweils Seite 1; Fundstellen an `settlementLine` in client/src/taxView.ts
  (#280). Für andere Jahre nennt die Seite keine Zeile. **Die Seite zeigt den Zufluss in zwei Teilen,
  die zusammen den Zufluss ergeben** (`paidWithoutSettlementCents` und `settlementBalanceCents`): ohne
  Abrechnung für die Zeilen der Mieten und Umlagen, den Saldo für Zeile 21. Stünde nur der Saldo
  neben dem ganzen Zufluss, trüge mancher beides ein und zählte den Saldo doppelt (Durchsicht zu
  #328). Den Hinweis dazu gibt es nur auf der Ist-Grundlage.
  **Maßgeblich ist das Ist** (#70): § 11 Abs. 1 Satz 1 EStG setzt Einnahmen im Jahr des Zuflusses
  an, ein vereinbartes, nicht gezahltes Soll ist keine Einnahme. Das Soll bleibt umschaltbar, denn
  zum Abgleich taugt es, ist aber nicht mehr die Vorgabe; die Entscheidungslogik samt Hinweisen
  steht in [client/src/taxView.ts](../../client/src/taxView.ts). Dass die Vorgabe früher das Soll war,
  hatte einen ehrlichen Grund, nämlich eine Zahl auch ohne erfasste Zahlungen — und war genau
  deshalb der schlimmere Ausgang: 0 € sind sichtbar falsch und führen ins Mietkonto, eine
  Soll-Summe ist unsichtbar falsch und wandert in die Steuererklärung. Dieselbe Abwägung wie beim
  `?? []` an der Schnappschuss-Grenze.
  **Drei Sichten, drei Zahlen, und nur die Steuerübersicht war falsch.** Die Abrechnung setzt die
  Staffel an und die Jahreskorrektur, wenn sie erfasst ist (`prepaymentOverrides` hat Vorrang);
  maßgeblich ist das tatsächlich Geleistete. Anzusetzen sind die Vorauszahlungen, die der Mieter
  für den Abrechnungszeitraum tatsächlich geleistet hat (BGH VIII ZR 240/10 vom 18.05.2011, Rn. 16;
  VIII ZA 2/08); Soll statt Ist ist, wenn beide abweichen, ein inhaltlicher und kein formeller
  Fehler. Nach Ablauf der Frist des § 556 Abs. 3 BGB ist nach Satz 3 die Nachforderung über das
  Ergebnis einer rechtzeitig erteilten Abrechnung hinaus ausgeschlossen, ohne rechtzeitige
  Abrechnung die Nachforderung über die vereinbarten Vorauszahlungen hinaus (VIII ZR 190/06;
  VIII ZR 261/06); eine erteilte
  Abrechnung lässt sich danach grundsätzlich nicht mehr zulasten des Mieters korrigieren, auch
  nicht bei zu hoch angesetzten Vorauszahlungen (VIII ZR 133/10, Rn. 12 f.; Ausnahme bei einem auf
  den ersten Blick erkennbaren, kurz nach Fristablauf berichtigten Fehler, Rn. 15). Das
  Mietkonto führt das monatliche Soll, denn eine Jahreszahl auf zwölf Monate zu verteilen wäre
  erfunden. `taxReport` führt beide nebeneinander (`prepaymentSollCents` und
  `prepaymentSettlementCents` samt `prepaymentOverridden`) und **entnimmt die zweite der
  Abrechnung**, statt die Staffel ein zweites Mal auszulegen; bei abgeschlossener Abrechnung gilt
  ihr eingefrorener Stand, dieselbe Regel wie beim Eigenanteil und aus demselben Grund. Die
  Oberfläche erklärt den Abstand, **sobald es ihn gibt, und schreibt ihm keine Ursache zu**: Er
  entsteht aus der Jahreskorrektur und ebenso daraus, dass die Abrechnung nur über Wohnungen der
  Abrechnungseinheit verteilt, während das Mietkonto jedes Mietverhältnis führt. Die Durchsicht
  hat gemessen, dass von 1.500 € Abstand nur 600 € aus der Korrektur kamen; ein Kausalsatz wäre
  dort zu 60 Prozent falsch gewesen.
  **Das Ist kommt nicht aus dem Mietkonto**, sondern zählt jede Zahlung mit Datum im Jahr. Das
  Mietkonto bildet Zeilen nur für Mietverhältnisse mit Überlappung, und dadurch fielen zwei
  alltägliche Fälle aus **beiden** Jahren: die Dezembermiete, die im Januar eingeht, nachdem das
  Mietverhältnis am 31.12. endete, und der Dauerauftrag, der die Januarmiete am 30.12. bucht.
  Für das Mietkonto ist die Zeilenbindung richtig, für eine Zahl nach dem Zuflussprinzip nicht.
  Die Zehn-Tage-Regel des § 11 Abs. 1
  Satz 2 EStG bleibt ein Hinweis in der Oberfläche und wird nicht gerechnet: Sie hängt an der
  vertraglichen Fälligkeit, die Mietfuchs nicht kennt, und ein Feld dafür machte eine Zahl der
  Steuererklärung davon abhängig, dass jeder Nutzer es richtig ausfüllt. Das Beispiel dort ist
  bewusst die vorab gezahlte Januarmiete: Die Dezembermiete ist nach § 556b Abs. 1 BGB im
  Dezember fällig, bei ihr greift die Regel also gerade nicht.
  **Die Kopfzeilen der Anlage V, die am Mietmodell hängen** (#96): `costModels` zählt die
  Mietverhältnisse des Jahres, ganz inklusiv (kalt und warm; ohne Heizposition im Jahr zählt nur
  kalt), teilweise inklusiv und mit Pauschale. Daraus entscheidet `taxView.ts` die Hinweise zu
  Zeile 24 und Zeile 20; die Zuordnung der Pauschale zu Zeile 20 ist eine Auslegung und steht als
  solche da.
  **Dem Abflussprinzip folgen die Werbungskosten nur mit Zahlungsdatum** (#255, PR 3). Die
  Kostenposition trägt optional `paidOn` (Spalte `paid_on`, „Bezahlt am (für die Steuer)“), das
  Datum der ganzen Zahlung. Das Steuerjahr bestimmt allein `outflowShares` in
  [server/src/outflow.ts](outflow.ts), Rangfolge Zahlungsdatum, dann `taxYear`, dann das
  Jahr des Beginns des Zeitraums; die Rangfolge selbst steht als `statedOutflowYear` in
  [shared/paidOn.ts](../../shared/paidOn.ts), damit Formular und Schreibwege (Wechsel des Zeitraums und
  der Heizperiode, Heizposition aus der Belegbuchung, Übernahme aus dem Vorjahr) dasselbe meinen.
  Keine andere Stelle leitet ein Steuerjahr aus `taxYear` oder `paidOn` ab; nur zur Auswahl lesen
  `taxPartsFor` (Suchfenster) und die Rückfrage „Jahr der Zahlung“ beim Aufteilen in Kosten.tsx das
  Jahr des Datums. `taxPartsFor` sucht
  zusätzlich in den Zeiträumen jeder Position, die im Steuerjahr bezahlt ist, auch nach dem Jahr
  (vorab bezahlt) und Jahre davor (späte Nachzahlung); der private Teil kommt aus der Abrechnung
  ihres Zeitraums. Ein Datum, das das wirksame Jahr ändert, einem gesetzten `taxYear` widerspricht
  oder außerhalb von Beginn − 1 bis Ende + 3 liegt, wird nur mit `confirmPaidOn: true` gespeichert
  (`PaidOnQuestion`, 409 mit `question: 'paidOn'`; dieselben Sätze zeigt das Formular). Beim Aufteilen
  zählt jeder Teil mit seinem eigenen Zeitraum (eine Jahresversicherung 07/2025 bis 06/2026, bezahlt
  am 01.07.2025, ändert das Jahr des Teils 2026): Server und Formular fragen dafür mit denselben
  Teilen der Vorschau (`splitPaidOnQuestions`, die Vorschau nennt je Teil `startYear`/`endYear`).
  Kommt trotzdem eine 409 mit `question: 'paidOn'`, zeigt das Formular sie als Rückfrage und
  wiederholt mit Bestätigung. Beim Wechsel des
  Abrechnungszeitraums behält eine datierte Position ihr Steuerjahr (`keepsTaxYear` in
  periodChange.ts): keine Frage nach dem Jahr, keine angekündigte Verschiebung. Kein Datum
  bei `external` (Hausgeld, abgelehnt mit Hinweis) und am Abzug beim Betriebsstrom (geleert, er
  folgt seiner Rechnung, auch deren Datum). Die Belegbuchung belegt es nie vor: Das Rechnungsdatum
  ist kein Zahlungsdatum. Teilzahlungen bildet das Datum nicht ab, die kommen mit #292 über
  dieselbe Funktion, und eine verknüpfte Abbuchung ist dort ein Nachweis, keine zusätzliche
  Zahlung. Die Zehn-Tage-Regel ist nur ein Hinweis im Formular (Datum zwischen 22.12. und 10.01.,
  nie bei der Grundsteuer). **Ohne Datum gilt weiter das Abrechnungsjahr**: Die Grundsteuer 2025,
  im Februar 2026 gezahlt, steht dann in der Anlage V 2025, obwohl sie nach § 11 Abs. 2 EStG in
  2026 abfließt; die Gleichheitsinvariante und die Prüfsummen in outflow.test.ts halten fest, dass
  ohne Datum keine Zahl wandert. Die db.json kennt das Feld nicht, Umstieg und alte Backups
  ergeben `NULL`.
  **Die Steuerübersicht zeigt die Verschiebung** (#255, PR 4), nur als Auskunft: `shiftNotes` in
  calc.ts liest dieselbe Antwort von `outflowShares` noch einmal und rechnet nichts. Verschoben
  heißt, das Jahr der Zahlung liegt außerhalb der Kalenderjahre, die der Zeitraum der Position
  berührt (bei Mai bis April ist 2026 für 2025/2026 keine Verschiebung, 2027 schon). Jede Position
  trägt `outflow` (Jahr und Quelle `paid`, `stated`, `period`, `bill`), eine verschobene dazu
  `settlementPeriod` („aus Abrechnung 2025, bezahlt am …“); umgekehrt nennt `movedOut` die
  Positionen der Zeiträume, die im Jahr beginnen und anderswo stehen. Jede Verschiebung steht so
  auf jeder Seite genau einmal (Invariante in calc-steuer-verschiebung.test.ts). `unstatedCount`
  zählt die Positionen ohne Angabe, aber nur, wo das Formular ein Datum anbietet (`allowsPaidOn`),
  und ergibt einen ruhigen Satz. Ein Datum außerhalb von Beginn − 1 bis Ende + 3 trägt
  `outsideSpan`: Ein späterer Wechsel des Zeitraums fragt nicht neu (Durchsicht von PR 3, K8), die
  Übersicht nennt es stattdessen. Die Texte stehen in taxView.ts (`movedInLines`, `movedOutLines`,
  `unstatedText`); die Übersicht.csv im Steuer-ZIP hat dafür die letzte Spalte „Jahr der Zahlung“.
  Die Prüfsummen (`taxFingerprint`) lesen die neuen Felder nicht. Eine Heizposition unter eigener
  Heizperiode nimmt ihren Zeitraum aus der Heizperiode (`plantRules`), nie nach dem Schlüssel: Ein
  Rumpf am Wechsel des Rhythmus kann denselben Schlüssel tragen. Über alle Steuerjahre ändert ein
  Datum weder den Gesamtbetrag noch den privaten Teil
  ([invariant-steuer-summe-zahlungsdatum.test.ts](../test/invariant-steuer-summe-zahlungsdatum.test.ts)),
  auch nicht den der Ausgleichszeilen beim Betriebsstrom (bis auf einen Cent Rundung je Zeile): Ihr
  Heizanteil (`plantHeatQuota`) kommt aus den Heizpositionen des Teils, die ohne Zahlungsdatum im
  selben Steuerjahr stünden wie der Betriebsstrom (`heatPool`, `yearWithoutDate`), nicht aus denen,
  die per Datum im Steuerjahr stehen. Vorher wichen über alle Jahre bis 55,78 € ab. Trägt eine
  Position eines Zeitraums über zwei Kalenderjahre nur ein Datum, gilt dafür das Jahr des Datums,
  geklemmt auf Beginn bis Ende + 1 wie ein `taxYear` (`asStatedYear`): Jahr der Zahlung t und Datum
  im Jahr t ergeben dieselbe Übersicht. Offen bleibt die Regel „alle Heizpositionen der Anlage im
  Zeitraum, unabhängig von Datum und Jahr“; sie änderte veröffentlichte Zahlen bei Mai bis April.
  **Betriebsstrom: die Stromrechnung zählt genau einmal** (#268). Eine Heizposition `included`
  („steckt auch in der Stromrechnung“) und ein Abzug beim Allgemeinstrom (`operatingPower:
  'deduction'`) sind beide nur Ausschnitte derselben bezahlten Stromrechnung, keine eigene Zahlung.
  Summiert mit Vorzeichen stand der Strom als G − Σ Abzug + Σ Heizposition da: Ein selbst
  getragener Abzug ohne Gegenstück senkte die Werbungskosten wie eine Gutschrift, eine Heizposition
  über dem Abzug zählte doppelt. `operatingPowerBalance` (server/src/operatingPower.ts) rechnet je
  Steuerjahr **C = Σ Betrag der Abzüge − Σ Betrag der Heizpositionen `included`**, über alle
  Positionen des Steuerjahres, **mit Vorzeichen und ohne Klemme**, und `taxReport` stellt C als
  abgeleitete Zeile `operating-power-balance:<Jahr>` beim Allgemeinstrom dazu
  (`TaxExpenseItem.operatingPowerBalance`). Damit ist der Strom in jedem Jahr die bezahlte Rechnung,
  auch wenn Abzug und Betriebsstrom in verschiedenen Steuerjahren stehen (deshalb entfielen der Hinweis
  `heating.operating-power-tax-year` und der Satz zur Verschiebung in der Vorschau des Zeitraumwechsels). **Seit #267
  steht der Abzug im Steuerjahr seiner Stromrechnung**: Stand er in einem anderen, blieb dort ein privater Rest, weil
  sein privater Teil dem Schlüssel der Rechnung folgt und der von C dem Heizanteil (Beispiel B2 im Plan zu #255, Test in
  calc-steuer-betriebsstrom.test.ts). Auseinander liegen können nur noch Abzug und Heizposition; die Heizposition und
  ihr Beitrag zu C heben sich in ihrem Jahr auf, im Betrag wie im privaten Teil. **Ein verknüpfter Abzug nimmt den
  Heizanteil aus dem Teil, in dem seine Heizposition steht**, nicht aus dem Teil, in dem er selbst steht (Durchsicht
  von #255 PR 2, M1): Steht sie in einem anderen Steuerjahr, rechnet `foreignHeatQuota` in calc.ts deren Teil und
  Aufteilung wie die Steuerübersicht jenes Jahres. Vorher galt im Jahr des Abzugs der Heizanteil dort und ohne
  Heizkosten dort die Fläche; über beide Jahre fehlte dann privat der Unterschied (gemessen 26,67 €). So ist der
  private Teil über alle Steuerjahre zusammen derselbe, gleich wo Rechnung, Abzug und Heizposition stehen (Invariante
  S1 in invariant-betriebsstrom-steuer.test.ts); stehen Abzug und Heizposition im selben Teil, ändert sich nichts.
  Dafür löst `taxReportFor` den Verweis über alle Positionen des Objekts auf (`linkable`), denn der Schnappschuss
  kennt nur sein Jahr (Durchsicht M1 zu #268).
  Zeilenname und Texte folgen der Lage (`operatingPowerBalanceKind`): „selbst getragen“ nur beim Abzug ohne Verweis,
  „prüfen“ nur, wenn Abzug und Betriebsstrom im selben Steuerjahr verschieden hoch sind;
  eine Sonderregel für
  Verweise über Jahre gibt es bewusst nicht (eine Klemme bei 0 und „anderes Jahr neutral“ waren
  beide nachgemessen falsch). Ausgenommen sind Abzüge **ohne Verweis**, wenn eine Anlage mit
  Messdienst den Zeitraum berührt (`serviceReceivesOperatingPower` in shared/operatingPower.ts,
  dieselbe Frage wie im Kostenformular): Dann ist der Betrag nach Angabe des Nutzers dem Messdienst
  gemeldet und steckt in dessen Betrag. Mietfuchs folgt dieser Angabe; ist in Wahrheit nichts
  gemeldet, fehlt der Betrag, und das ist eine bekannte Grenze. Heizt im Zeitraum zugleich eine
  Anlage ohne Messdienst (Kesseltausch), nennt die Seite den Abzug als nicht eindeutig
  (`operatingPowerAmbiguous`). Ohne Messdienst heißt dieselbe Wahl im Formular „Ja, ich lege ihn
  nicht um und trage ihn selbst“ (`OPERATING_POWER_KEPT`). **Der private Teil folgt dem
  Heizanteil**: jeder Beitrag zu C mal Eigenanteil an den Heizkosten seiner Anlage in der Abrechnung
  seines Teils, so wie die Übersicht diese Heizpositionen aufteilt (bei abgeschlossener Abrechnung
  also eingefroren); dann ergibt ein verknüpfter Abzug über dem Betriebsstrom dasselbe wie das richtige Paar. Ohne
  zuordenbare Anlage (Abzug ohne Verweis) gilt die Fläche des ganzen Gebäudes (BFH IX R 26/06); das kann vom Paar
  abweichen, etwa wenn die Anlage die eigene Wohnung gar nicht heizt. Beides ist
  Auslegung und steht so im Rechenweg und auf der Seite. Die Zeile geht nicht durch den eingefrorenen
  Stand (`closedItemsChanged` bleibt), nicht in `selfUsedShareCents` und steht im Steuer-ZIP ohne
  eigenen Beleg. Negativer Allgemeinstrom **ohne** Kennzeichnung bleibt, wie er ist (Gutschrift und
  Abzug sind nicht zu unterscheiden), die Seite weist nur darauf hin (`unmarkedPowerCredits`). Die
  Abrechnung an die Mieter bleibt unberührt. Zusicherungen in
  [calc-steuer-betriebsstrom.test.ts](../test/calc-steuer-betriebsstrom.test.ts) und als
  Invariante in [invariant-betriebsstrom-steuer.test.ts](../test/invariant-betriebsstrom-steuer.test.ts).

**Update-Hinweis** ([server/src/update.ts](update.ts)): Nur mit Zustimmung
(`settings.updateCheck === 'on'`, beim ersten Start im Cockpit gefragt) fragt der Server
`releases/latest` bei GitHub ab, höchstens einmal am Tag je laufender Instanz. Ohne Zustimmung
geht keine Anfrage hinaus, `/api/update` liefert dann nur die installierte Version. Nach einem
Fehler wartet er eine Stunde, bei einem Rate-Limit bis `retry-after` bzw. `x-ratelimit-reset`
(höchstens einen Tag), dann auch für „Jetzt prüfen". „Jetzt prüfen" fragt ohnehin höchstens
einmal pro Minute, gleichzeitige Aufrufe teilen sich eine Anfrage, und Links aus der Antwort
werden nur übernommen, wenn sie ins eigene Repo zeigen. Ein Selbst-Update gibt es nicht: Der
Hinweis führt zu einer Anleitung, bei der Programmdatei mit dem Download der passenden Datei
und Schritten je System, bei Docker und npm mit Befehlen. Die Entscheidungslogik der
Oberfläche liegt in [client/src/update.ts](../../client/src/update.ts). Ob später ein Updater
dazukommt, ist offen (Issue #20). Die eigene Version liest
[server/src/version.ts](version.ts) per JSON-Import aus `server/package.json`, den
Bun beim Kompilieren einbettet. Die Betriebsart ergibt sich aus `globalThis.Bun`
(Programmdatei, an einem Systemort `package`, siehe Linux-Pakete) bzw. `NKA_RUNTIME=docker`
(setzt das Dockerfile), sonst `npm`.
`NKA_UPDATE_URL` lenkt die Abfrage auf einen nachgebauten Server. Verglichen wird nach SemVer
mit Vorabversionen (#166): `0.9.0-rc.2` liegt vor `0.9.0`, `rc.2` vor `rc.10`. Ein Tag mit
Vorabversion wird nie angeboten, auch ohne das Kennzeichen `prerelease`; läuft dagegen selbst
ein Kandidat, ist die fertige Version gleicher Nummer ein Update, und die Oberfläche nennt ihn
„Vorabversion“ statt „aktuelle Version“.
