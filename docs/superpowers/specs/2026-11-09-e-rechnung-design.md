# E-Rechnungen beim Beleg-Upload direkt auslesen (#189)

Stand 09.11.2026. Bezug: #170 (Belegordner, Belegbuchung), #187 (Ideensammlung), #188 (Kontoauszüge, dessen
XML-Leser hier Vorbild ist).

## Worum es geht

Handwerker, Dienstleister und nach und nach auch Versorger schicken E-Rechnungen: eine XRechnung (reines XML in der
Syntax UBL oder CII) oder ein PDF mit eingebettetem XML (ZUGFeRD, Factur-X). Im XML stehen Betrag, Datum,
Leistungszeitraum, Rechnungssteller und Positionen maschinenlesbar und verbindlich. Mietfuchs liest sie heute gar nicht:
Ein XML wird beim Hochladen abgelehnt, ein ZUGFeRD-PDF geht wie jedes PDF an die KI.

Ziel: Erkennt Mietfuchs eine E-Rechnung, übernimmt es die Angaben **ohne KI und ohne Netz** und legt sie in dieselbe
Prüfung der Belegbuchung wie eine KI-Auswertung. Das hilft gerade dem Vermieter ohne eingerichtete KI.

## Rechtlicher Rahmen (Quellen)

| Aussage | Quelle |
| --- | --- |
| Auch wer ausschließlich steuerfreie Umsätze ausführt („z. B. Vermieter einer Wohnung“), muss seit 01.01.2025 E-Rechnungen empfangen können; ein gesondertes E-Mail-Postfach ist nicht nötig. | BMF 15.10.2025 (BStBl I S. 1806) Rn. 17; UStAE 14.1 Abs. 5 |
| Bis Ende 2026 (bei Ausstellern bis 800.000 € Vorjahresumsatz bis Ende 2027) dürfen weiter Papier- und PDF-Rechnungen kommen. Es kommen also noch Jahre überwiegend PDFs. | § 27 Abs. 38 UStG |
| ZUGFeRD ab 2.0.1 ist E-Rechnung, außer in den Profilen MINIMUM und BASIC WL. | UStAE 14.1 Abs. 14 |
| Bei hybriden Formaten ist das XML der führende Teil; bei Abweichungen gehen seine Daten dem Bild vor. | UStAE 14.4 Abs. 3 Sätze 5 und 6 |
| Aufbewahrt wird im empfangenen Format, der strukturierte Teil unversehrt und maschinell auswertbar, acht Jahre. | § 14b UStG; UStAE 14b.1 Abs. 1 und 5 |
| § 35a: Begünstigt sind Arbeitskosten einschließlich in Rechnung gestellter Maschinen- und Fahrtkosten, brutto, ohne Material (Verbrauchsmittel ausgenommen). Der Anteil muss sich aus der Rechnung ermitteln lassen; eine Schätzung durch den Steuerpflichtigen ist unzulässig. EN 16931 hat kein Feld dafür. | § 35a Abs. 5 EStG; BMF 09.11.2016 (BStBl I S. 1213, geändert 01.09.2021, BStBl I S. 1494) Rn. 39 f.; FG Thüringen 3 K 328/25 |
| Bescheide über öffentlich-rechtliche Abgaben (etwa Wasser, Abfall) dürfen bis 30.06.2030 als sonstige Rechnung kommen. Grundsteuer ist ein Steuerbescheid, keine Rechnung. | BMF 15.10.2026 (Rn. 26 f., Randnummern nur sekundär geprüft) |

Folgen für Mietfuchs:

1. **Die Originaldatei wird bytegenau abgelegt und nie umgeschrieben.** Eine Ansicht, die Mietfuchs daraus baut, ersetzt
   sie nicht.
2. **Bei einem ZUGFeRD-PDF gilt das XML.** Die KI liest das Bild dann nicht zusätzlich; es gibt nichts zu mischen.
3. **Der §35a-Lohnanteil wird nie geschätzt.** Vorgeschlagen werden nur Positionen, die erkennbar Arbeit sind (siehe
   unten), und jeder solche Vorschlag ist gelb und will bestätigt sein.
4. Die Erwartung bleibt bescheiden: Es geht vor allem um Handwerker- und Dienstleisterrechnungen. Messdienst- und
   Gebührenbescheide kommen auf absehbare Zeit als PDF; der bisherige Weg bleibt unverändert.

## Entscheidungen

### Was als E-Rechnung gilt

- **XRechnung UBL**: Wurzel `Invoice` (`urn:oasis:names:specification:ubl:schema:xsd:Invoice-2`) oder `CreditNote`
  (`…:CreditNote-2`).
- **CII**: Wurzel `CrossIndustryInvoice` (`urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100`), als reine
  Datei oder in einem PDF eingebettet.
- **Erkannt wird am Wurzelelement samt Namensraum, nicht am Dateinamen.** Weil der Parser mit `removeNSPrefix: true`
  die `xmlns`-Angaben verwirft, liest ein eigener erster Durchgang (`removeNSPrefix: false`) nur Wurzel und Namensraum;
  erst danach wird mit gekürzten Präfixen gelesen. Im PDF wird jeder XML-Anhang geprüft
  (üblich sind `factur-x.xml`, `xrechnung.xml`, `zugferd-invoice.xml`).
- **Rechnungsart (BT-3)**: übernommen werden nur Rechnung (380), Gutschrift (381) und Schlussrechnung (875, 876, 877).
  Abschlags- und Teilrechnung (386, 326) gehen den bisherigen Weg mit dem Satz, dass Mietfuchs sie nicht als Kosten
  übernimmt, weil sonst die Schlussrechnung doppelt zählte. Eine korrigierte Rechnung (384) wird übernommen, ihre
  Auswertung ist aber rot mit dem Satz, dass sie die Rechnung BG-3 (Nummer und Datum) ersetzt und diese nicht zusätzlich
  gebucht sein darf.
- **Nicht** übernommen werden die Profile MINIMUM und BASIC WL (BT-24 `urn:factur-x.eu:1p0:minimum` bzw. `…:basicwl`, in ZUGFeRD 2.0 `urn:zugferd.de:2p0:minimum` bzw. `…:basicwl`)
  und ZUGFeRD 1.0 (`urn:ferd:…`): Sie sind keine E-Rechnung, MINIMUM und BASIC WL tragen keine Positionen. Ein solches
  PDF geht den bisherigen Weg (KI oder von Hand).

### Wo gelesen wird

- **Das XML aus einem PDF holt der Browser** mit pdf.js, das jedes PDF ohnehin öffnet
  ([client/src/pdfIntake.ts](../../../client/src/pdfIntake.ts)): `getAttachments()` nennt die Anhänge (der Inhalt ist
  dort optional), `getAttachmentContent(id)` lädt ihn, nachdem die Größe geprüft ist. Geschickt wird es als
  **Datei-Feld** `eInvoiceXml` (im Arbeitsspeicher wie `pages`; ein Textfeld scheiterte an multers `fieldSize` von 1 MB),
  höchstens **25 MB** wie jeder Beleg, denn XRechnungen betten über BG-24 oft PDFs in base64 ein; diese Anhänge schneidet
  der Server vor dem Lesen aus (24 MB in Millisekunden statt Sekunden). So bleibt es dabei, dass der Server
  keine PDFs öffnet (#21), und es kommt keine Abhängigkeit hinzu. Für den Server ist das Feld so unzuverlässig wie jede
  Eingabe. Erneutes Auswerten aus dem Posteingang geht, weil die Warteschlange den Upload aus der Datei neu baut
  (client/src/evaluationQueue.ts).
- **Eine reine XML-Datei liest der Server** aus der gespeicherten Datei.
- **Gedeutet wird nur im Server**, in einem neuen reinen Modul `server/src/eInvoice/` (Lesen, Abbilden, Prüfen),
  gebaut wie [bank/camt.ts](../../../server/src/bank/camt.ts): fast-xml-parser (schon Abhängigkeit) mit
  `processEntities: false`, `parseTagValue: false`, `removeNSPrefix: true`, vorher `XMLValidator` und Ablehnung bei
  `<!DOCTYPE`/`<!ENTITY`. Die kleinen Leser (`at`, `all`, `list`, Dezimal zu Cent) wandern dazu aus camt.ts in ein
  gemeinsames Modul.
- **Kein fertiger E-Rechnungs-Leser** aus npm: Die geprüften erzeugen vor allem, sind groß oder hängen an xmldom. Gebraucht
  werden rund 40 Felder.

### Wie die Angaben in die Belegbuchung kommen

Naht: `/api/intake` und `/api/extract`, **vor** `classifyDocType` und jeder Anfrage an ein Modell. Liegt eine
übernehmbare E-Rechnung vor, entsteht daraus eine `RawExtraction`, die durch `normalizeAmounts` und `toExtraction` geht
und mit `rememberAssessment` gespeichert wird, genau wie eine KI-Antwort. Ab da ändert sich nichts: Ampel, Summenregel,
Kandidaten, Buchen.

Abbildung:

| Mietfuchs | E-Rechnung |
| --- | --- |
| `vendor` | BT-27 Verkäufer |
| `invoiceDate` | BT-2 Rechnungsdatum |
| `periodStart`/`periodEnd` | BT-73/74 Rechnungszeitraum; fehlen beide, BT-72 Lieferdatum als beides |
| `totalGrossEur` | **BT-112 Gesamtbetrag einschließlich Umsatzsteuer** (nicht BT-115 Zahlbetrag) |
| Positionen | BG-25, Beschreibung aus BT-153 (BT-154 angehängt, gekürzt) |

- **Brutto je Position**: Die Positionen einer E-Rechnung sind netto (BT-131). Je Umsatzsteuergruppe (BG-23, Kategorie und
  Satz) wird deren Brutto (BT-116 + BT-117) mit `largestRemainder` anteilig zum Netto auf die Positionen dieser Gruppe
  verteilt. Abschläge und Zuschläge auf Dokumentebene (BG-20/21) gehen so anteilig ein. Hat eine Gruppe keine
  Position (nur ein Zuschlag), wird sie eine eigene Position mit dem Grund des Zuschlags. Die Positionen ergeben damit
  zusammen genau BT-112. Kein Hochrechnen mit 19 %, kein `vatExplainsGap`: Die Steuer steht in der Rechnung.
  Formel: je Position Netto × (1 + Satz) als Gewicht, das Brutto der Gruppe im Verhältnis dieser Gewichte, Rest-Cents
  mit `largestRemainder` nur unter Positionen mit dem Vorzeichen des Gruppenbruttos, damit keine Position das
  Vorzeichen wechselt.
- **Abzüge mit Bezug auf eine Vorgängerrechnung**: Zieht eine Schlussrechnung geleistete Abschläge als negative Position
  oder als Abschlag auf Dokumentebene ab (erkennbar an BT-25 oder einem Abschlagstext), wäre BT-112 nur der Rest. Diese
  Zeile wird nicht still verrechnet, sondern rot mit Satz gezeigt; der Vermieter entscheidet.
- **Gesamtbetrag statt Zahlbetrag**: Kosten des Zeitraums sind der Rechnungsbetrag. Bereits bezahlte Abschläge (BT-113)
  ändern ihn nicht; ein BT-113 über 0 wird als Satz genannt („Abschläge über … € sind bereits bezahlt; als Kosten zählt der
  Gesamtbetrag“). Das deckt sich mit der bisherigen Regel, dass ein Betrag unter der Summe eine Abschlagszahlung ist.
- **Gutschrift** (UBL `CreditNote`, CII TypeCode 381): Beträge negativ. Die Belegbuchung behandelt negative Zeilen schon
  heute als Gutschrift und verrechnet sie nie.
- **Währung**: Nur EUR wird übernommen. BT-110 kann doppelt vorkommen; es zählt die Angabe in der Rechnungswährung
  (BT-5).
- **Kostenart**: `matchCategory` auf die Beschreibung; was nicht passt, wird wie heute „Sonstige Betriebskosten“ und
  rot („Kategorie unklar“, `scorePosition`). **Keine KI**,
  auch nicht zur Einordnung, wenn eine eingerichtet ist: Der Weg soll ohne Netz gleich arbeiten, und die Positionstexte
  bleiben auf dem Rechner. Die Einordnung per KI ist eine mögliche spätere Ergänzung.
- **§35a-Lohnanteil**: Eine Position gilt als Arbeit, wenn ihre Einheit eine Zeit ist (UN/ECE-Codes `HUR`, `MIN`;
  nicht `DAY`, weil Versorger den Grundpreis in Tagen abrechnen) oder ihre Bezeichnung eindeutig Arbeit nennt (Arbeitszeit, Arbeitslohn, Lohn, Monteur- oder Gesellenstunde,
  Maschinenstunde, Anfahrt bzw. Fahrtkosten; Rn. 39), **und** die Bezeichnung keines der Ausschlusswörter trägt
  (Material, Gutachten, Planung, Miete, aber nicht „Mieter“). Gutschriften und negative Positionen bekommen nie einen
  Vorschlag. Vorgeschlagen wird als `labor35aEur` ihr Netto plus die eigene Steuer
  (Netto × Satz), abzüglich ihres Anteils an Abschlägen auf Dokumentebene (BG-20), **ohne** Zuschläge (BG-21): Eine
  Entsorgungspauschale als Zuschlag ist keine ausgewiesene Arbeit, sie anteilig einzurechnen wäre eine verdeckte Schätzung.
  Die Zeile ist gelb, nicht vorab angehakt, mit dem Satz „Lohnanteil aus der Position übernommen; prüfen Sie, ob der
  Stundensatz Material enthält.“ Sonst bleibt der Lohnanteil leer. Einen Anteil aus einem Gesamtbetrag oder einen
  Prozentsatz errechnet dieser Weg nie.
- **Prüfungen** (Geschäftsregeln BR-CO der EN 16931): Summe der BT-131 = BT-106; BT-109 = BT-106 − BT-107 + BT-108;
  BT-112 = BT-109 + BT-110; BT-110 = Summe der BT-117. Eine Abweichung über einen Cent je Regel blockiert nichts, wird
  aber als Satz genannt und macht die Auswertung rot wie heute `sumWarning`. Eine Rechnung, deren Pflichtfelder für
  Betrag oder Datum fehlen, wird nicht übernommen und geht den bisherigen Weg.
- **Wo das im Modell steht** (eine Migration, alle Voreinstellungen ergeben das heutige Verhalten):
  - `assessments.source` (`'ki' | 'e-rechnung'`, Voreinstellung `'ki'`), auch in `AssessmentView` (shared/types.ts). Die
    Oberfläche sagt dann „Aus der E-Rechnung übernommen“ statt der KI-Sätze; der Verlauf trägt einen eigenen Satz statt
    „Beleg mit KI ausgewertet“ (journalRoutes.ts). Erneutes Auswerten liest wieder das XML.
  - `assessments.invoice_number` (BT-1), um eine zweimal hochgeladene E-Rechnung als Doppel zu erkennen (rot, Satz).
  - `assessments.e_invoice_notes`: die Sätze dieses Wegs (BR-CO-Abweichung, BT-113, Rechnungsart 384, Abzug mit
    Bezug). Eine solche Notiz macht die Auswertung rot; `sumWarning` greift hier nicht, weil die verteilten Positionen
    immer genau BT-112 ergeben.
  - `assessment_lines.labor_guessed`: gelb in `scorePosition` (shared/assessment.ts) und nicht vorab angehakt.
- **Nicht übernommen** (nur angezeigt): Fälligkeit, IBAN, USt-IdNr.; IBAN und Fälligkeit sind Stoff für den Zahlungsabgleich aus #188. **Der
  Leistungszeitraum bestimmt wie heute nur das Jahr** (`detectedYear`) und setzt nicht `serviceFrom`/`serviceTo`.

### Ohne KI

Heute legt der Eingang ohne erreichbare KI nur ab (`storeOnly`, `/api/upload`). Und der Browser lässt XML gar nicht
durch (`isAcceptedFile` in client/src/belegeView.ts, `accept="application/pdf,image/*"` in BelegeEingang.tsx und
Kosten.tsx); beides wird erweitert, mit jsdom-Test. Neu: Erkennt der Browser eine
E-Rechnung (XML-Datei, oder ein PDF mit passendem Anhang), schickt er sie auch dann an `/api/intake`. Der Server nimmt
den E-Rechnungs-Weg, bevor er die KI braucht. Scheitert das Lesen, wird der Beleg wie bisher nur gespeichert
(`kept: true`), mit Meldung, warum.

### Reine XML-Datei als Beleg

- **Annehmen statt ablehnen**, aber nur, wenn der Inhalt eine E-Rechnung ist (Wurzel und Namensraum wie oben, kein DOCTYPE,
  höchstens 25 MB). Jede andere XML-, SVG- oder HTML-Datei wird wie heute abgelehnt; `SCRIPT_REFUSAL` nennt die
  Ausnahme. Hier wird **ausnahmsweise der Inhalt geprüft** (Schicht 1 in uploads.ts prüfte bisher nur Endung und Typ).
  Weil multers `fileFilter` vor dem Schreiben ohne Inhalt entscheidet, lässt er `.xml` nur auf den Routen durch, die es
  dürfen (`/api/upload`, `/api/intake`, `/api/extract`; nicht die Heizrouten); nach dem Speichern wird der Inhalt
  geprüft und die Datei bei Ablehnung gelöscht. `uploads.mime_type` bekommt `application/xml`.
- **Ausgeliefert nie als XML**: `.xml` bleibt außerhalb von `MIME_BY_EXTENSION`, die Datei geht nur als Download mit
  `nosniff` und `CSP: sandbox` hinaus (Schicht 2 bleibt).
- **Lesbare Ansicht**: `GET /api/e-invoice/:file` liefert das gelesene Modell als JSON, der Client zeigt daraus eine
  eigene Rechnungsansicht (Kopf, Verkäufer, Käufer, Positionen, Steuer, Summen, Zahlung), gegliedert wie die
  Visualisierung der KoSIT. Deren XSLT braucht XSLT 2.0 und damit Java oder einen nicht freien Prozessor; beides
  scheidet aus.
- **Druck und Mappe**: Vorschaubild, Belegkopien der Abrechnung und Belegmappe brauchen Seiten. Der Client setzt die
  Ansicht mit pdf-lib als einfaches PDF (nur WinAnsi über `winAnsiSafe`) und gibt es durch die bestehende Warteschlange
  wie ein PDF-Beleg. Anzupassen sind die drei Stellen, die heute nach Endung entscheiden: `renderInvoicePages` und
  `renderThumbnail` (client/src/pdfPreview.ts) und `appendDocument` (client/src/tenantFolder.ts). Für ein ZUGFeRD-PDF ändert sich nichts, es hat sein Bild. Steuer-ZIP und Backup nehmen die
  Originaldatei unverändert.

## Was nicht dazugehört

- Rechnungen erzeugen (der Vermieter muss für die Wohnraumvermietung keine ausstellen, UStAE 14.1 Abs. 3).
- Validieren gegen das Schema oder die KoSIT-Regeln in voller Breite (Java). Mietfuchs prüft nur, was der Betrag braucht.
- E-Rechnungen per E-Mail abholen.
- Heizkosten: Messdienst- und Lieferantenrechnung (`extractHeating.ts`) bleiben beim bisherigen Weg. Eine
  Brennstofflieferung als E-Rechnung ist eine spätere Ergänzung (Abbildung auf `FuelInvoiceExtraction`).
- Den Leistungszeitraum in `serviceFrom`/`serviceTo` übernehmen (Aufteilung #208); eigene Entscheidung, gleich für KI und
  E-Rechnung.

## Testdaten

Erfundene Rechnungen, im Test selbst erzeugt, dazu unveränderte Beispielrechnungen der KoSIT-Testsuite (Apache-2.0)
mit Herkunftsangabe. Keine echten Rechnungen. Für das ZUGFeRD-PDF erzeugt ein Test mit pdf-lib ein PDF mit Anhang.

## Umsetzung in Schritten

Jeder Schritt ein PR mit `Refs #189`, testgetrieben, gestapelt.

1. **Leser** (nur Server, ohne Oberfläche): gemeinsame XML-Leser aus camt.ts herauslösen (camt-Tests bleiben grün);
   `server/src/eInvoice/read.ts` (UBL und CII zu einem eigenen Modell), `check.ts` (BR-CO), `toRaw.ts` (Modell zu
   `RawExtraction`, Brutto-Verteilung, Lohnanteil). Tests in `server/test/e-invoice.test.ts`: je Syntax Rechnung und
   Gutschrift, Rechnungsarten 326/384/386/875, mehrere Steuersätze, Zuschlag nicht im Lohnanteil, Abschlag mit BT-25, Abschlag und Zuschlag auf Dokumentebene, negative Position, BT-113, doppeltes BT-110,
   Profile MINIMUM/BASIC WL/1.0 abgelehnt, DOCTYPE abgelehnt, abgeschnittenes XML, Fremdwährung, Invariante „Summe der
   Positionen = BT-112“ über zufällige Rechnungen mit festem Startwert.
2. **Weg durch die Belegbuchung**: Datei-Feld `eInvoiceXml` in `/api/intake` und `/api/extract`, die neuen Spalten
   (eine Migration), kein Modellaufruf auf diesem Weg (Test mit nachgebautem Ollama, das bei jedem
   Aufruf scheitert). Client: `getAttachments` in `buildUpload` (pdfIntake-Tests mit echtem pdf.js), Hinweissätze in
   AssessmentReview, Eingang ohne KI schickt E-Rechnungen an intake. Tests in `api-e-rechnung.test.ts` und
   `api-belegbuchung.test.ts`.
3. **Reine XML-Datei**: Annahme nach Inhalt (der bisherige Ablehnungstest in api-belege.test.ts wird aufgeteilt:
   E-Rechnung angenommen, jedes andere XML weiter abgelehnt), Auslieferung nur als Download, `/api/e-invoice/:file`,
   Rechnungsansicht, Seiten für Vorschau, Belegkopien und Mappe. jsdom-Tests für die Ansicht.
4. **Doku und Texte**: Lexikon („E-Rechnung“), docs/funktionsweise.md, README-Funktionsliste, CHANGELOG, Hinweis in
   der Anleitung zum Eingang.

## Offene Punkte mit Quellenstand

- Dateinamen und AFRelationship der Anhänge sind nur aus Herstellerdoku belegt; unkritisch, weil am Inhalt erkannt wird.
- XPaths gegen die KoSIT-Testsuite prüfen, bevor Schritt 1 fertig ist.
- Die Liste der Arbeitsbezeichnungen für § 35a ist eine Mietfuchs-eigene Festlegung. Sie schlägt nur vor; die Grundlage
  (Rn. 39 f.) verlangt, dass der Anteil aus der Rechnung hervorgeht, was bei einer eigenen Position der Fall ist.
- Datum des Änderungsschreibens 2021 zum BMF-Schreiben § 35a: nach Stand der Gegenprüfung 01.09.2021, am Original
  noch nicht gelesen (BMF-Server nicht erreichbar). Ebenso die Randnummern 26 f. des Schreibens vom 15.10.2026.

## Gegenprüfung

Unabhängig gegen Primärquellen und Code geprüft am 09.11.2026. Eingearbeitet: Rechnungsarten 326/384/386 (Doppelzählung),
Lohnanteil ohne Zuschläge, Abzüge mit Bezug auf Vorgängerrechnung, Erkennung des Namensraums, Datei-Feld statt Textfeld,
`fileFilter` je Route, Client-Filter, `getAttachmentContent`, Spalten im Modell, Druckstellen, Kostenart rot,
Verteilungsformel, Satz im Verlauf. Bestätigt ohne Änderung: `normalizeAmounts` verändert die Verteilung nicht; erneutes
Auswerten aus dem Posteingang geht; Backup, Wiederherstellen und Steuer-ZIP filtern keine Endungen.
