# E-Rechnung (3/4): reine XML-Datei als Beleg

Refs #189. Spec: [docs/superpowers/specs/2026-11-09-e-rechnung-design.md](../specs/2026-11-09-e-rechnung-design.md),
Abschnitt „Reine XML-Datei als Beleg“ und Lieferplan Punkt 3. Baut auf PR 1 (#625, Leser) und PR 2 (#629, Belegbuchung).

## Ziel

Eine XRechnung als XML-Datei (UBL oder CII) wird wie ein PDF als Beleg angenommen, ohne KI ausgewertet, lesbar angezeigt
und gedruckt (Vorschaubild, Belegkopien, Belegmappe). Jedes andere XML, SVG und HTML bleibt abgelehnt.

## Globale Vorgaben

- Die Originaldatei bleibt bytegenau liegen; `.xml` kommt nie in `MIME_BY_EXTENSION` (Auslieferung nur als Download mit
  `nosniff` und `CSP: sandbox`).
- Inhalt wird nur auf `/api/upload`, `/api/intake`, `/api/extract` geprüft; die Heizrouten lehnen XML weiter ab.
- Angenommen wird ein XML, dessen Wurzel samt Namensraum UBL-Rechnung, UBL-Gutschrift oder CII ist, ohne
  Dokumenttyp-Erklärung, vollständig, höchstens 25 MB. Ob es übernommen wird (Profil, Typcode, Prüfungen), entscheidet
  wie bisher `readEInvoice`; eine nicht übernommene XML-Datei bleibt gespeichert (`kept: true`) mit Grund und ohne KI.
- Keine Geviertstriche, keine fremden Namen, gesiezt in Oberflächentexten, Bezeichner englisch.

## Aufgaben

### Aufgabe 1: Modell um die Angaben der Ansicht erweitern

- `shared/types.ts`: Modelltypen der E-Rechnung (`EInvoice`, `EInvoiceLine`, …) ziehen hierher (beide Seiten brauchen
  sie), dazu `EInvoiceView = { invoice: EInvoice, notes: string[], refusal: string | null }`.
  `server/src/eInvoice/model.ts` reicht sie weiter.
- Neue Felder: `sellerAddress`, `buyerAddress` (Zeilen: Straße, PLZ Ort, Land), `sellerVatId` (BT-31),
  `paymentTerms` (BT-20); je Position `quantity` (BT-129) und `unitPrice` (BT-146) als Text, wie sie dastehen.
- Test: gegen KoSIT 03.06a (UBL und CII) die neuen Felder; Testbauer zieht mit.

### Aufgabe 2: Reine XML-Datei annehmen

- `uploads.ts`: `carriesScript(name, type, { eInvoiceXml })` lässt `.xml` mit Typ leer, `application/xml` oder
  `text/xml` durch, wenn die Route es darf; `storedTypeOf` ergibt `application/xml` für `.xml` (für die Zeile in
  `uploads` und den Rückfall `mimeTypeOf`), `servedTypeOf` bleibt ohne XML. `SCRIPT_REFUSAL` nennt die Ausnahme.
- `eInvoice/index.ts`: `isEInvoiceDocument(data)` (wirft nie).
- `index.ts`: fileFilter nach Route; Middleware `checkXmlReceipt` nach multer: kein E-Rechnungs-XML, dann Datei löschen
  und 400 mit Satz.
- Tests: api-belege-Test aufteilen (E-Rechnung angenommen auf Upload und Intake, `Daten.xml` mit anderem Inhalt
  weiter abgelehnt, Heizroute lehnt E-Rechnung ab, DOCTYPE abgelehnt, nichts bleibt liegen), Auslieferung als
  Download mit `nosniff` und `sandbox`, `mimeType` `application/xml`.

### Aufgabe 3: Auswerten und lesbare Ansicht im Server

- `/api/intake` und `/api/extract`: Ist der Beleg selbst XML (neu oder `existingFile`), liest der Server die Datei;
  `read` geht den Weg aus PR 2, sonst Antwort `fail` mit `kept: true`, Grund und `eInvoiceRefusal`, nie die KI.
- `GET /api/e-invoice/:file`: `EInvoiceView` als JSON; 404 ohne Datei, 415 für Nicht-XML oder kein E-Rechnungs-XML.
- Tests in api-e-rechnung.test.ts.

### Aufgabe 4: Client nimmt XML an

- `belegeView.ts`: `isAcceptedFile` mit XML (Typ oder Endung), `RECEIPT_ACCEPT` für alle Ablagen der Belege
  (Eingang, „Nur ablegen“, Ordner, Kosten), `SKIPPED_FILES` nennt E-Rechnungen.
- `pdfIntake.ts`: `hasEInvoice` erkennt eine XML-Datei am Anfang des Inhalts.
- Tests: belegeView, pdfIntake.

### Aufgabe 5: Rechnungsansicht

- `client/src/components/EInvoiceView.tsx` (Kopf, Verkäufer, Käufer, Positionen, Zu- und Abschläge, Steuer, Summen,
  Zahlung, Hinweise), Seite unter `?e-rechnung=<Datei>` innerhalb der Anmeldung mit „Drucken / PDF“ und „Original
  herunterladen“.
- `receiptHref(file)`: XML auf die Ansicht, sonst `/uploads/…`; an allen Links und am Rahmen „Beleg daneben zeigen“.
- jsdom-Tests der Ansicht und von `receiptHref`.

### Aufgabe 6: Seiten für Vorschau, Belegkopien und Mappe

- `client/src/eInvoicePdf.ts`: aus `EInvoiceView` ein einfaches A4-PDF mit pdf-lib (Helvetica, `winAnsiSafe`,
  Umbruch auf Folgeseiten).
- `renderInvoicePages`, `renderThumbnail` (pdfPreview.ts) und `appendDocument` (tenantFolder.ts) nehmen für XML dieses PDF.
- Tests: Text im PDF, mehrere Seiten bei vielen Positionen, Mappe mit XML-Beleg.

### Aufgabe 7: Texte und Doku

- KeptReceipt ohne „im PDF“ bei XML, CHANGELOG, server/src/CLAUDE.md (Belege), Kommentar in uploads.ts.

## Prüfung

`npm run typecheck`, `npm test`, `npm --prefix desktop test`; Durchsicht des Zweigs mit frischem Kontext vor dem PR.

## Review Focus

- Umgehung der Skript-Sperre: `.xml` auf einer Heizroute, Typ `image/svg+xml` mit Endung `.xml`, `.svg` mit
  E-Rechnungs-Inhalt, Groß- und Kleinschreibung der Endung, `existingFile` auf ein XML in der Heizroute.
- Liegt nach jeder Ablehnung keine Datei und keine Zeile mehr?
- Wird für eine XML-Datei je die KI gerufen?
