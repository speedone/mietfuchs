# E-Rechnung lesen (PR 1 von 4, nur Server): Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine reine Funktion im Server, die aus den Bytes einer XRechnung (UBL oder CII) oder dem eingebetteten XML eines ZUGFeRD-PDFs entweder eine `RawExtraction` samt Notizen, Rechnungsnummer und Lohn-Vermutung je Position macht oder begründet sagt, warum sie nicht übernommen wird. Noch keine Route, keine Oberfläche, keine Migration (das ist PR 2).

**Architecture:** Die kleinen XML-Leser aus `server/src/bank/camt.ts` wandern nach `server/src/xml.ts` und werden von camt.ts und dem neuen Ordner `server/src/eInvoice/` genutzt. Dort: `detect.ts` (Wurzel, Namensraum, Profil, Sicherheit), `read.ts` (UBL und CII zu einem gemeinsamen Modell `EInvoice` in Cent), `check.ts` (Rechnungsart, Währung, Pflichtfelder, BR-CO-Summen), `toRaw.ts` (Brutto je Position, §35a-Vorschlag), `index.ts` (`readEInvoice`, der einzige Eingang für PR 2).

**Tech Stack:** TypeScript auf Node 24 ohne Build, fast-xml-parser 5 (schon Abhängigkeit), node:test.

**Spec:** `docs/superpowers/specs/2026-11-09-e-rechnung-design.md`

## Global Constraints

- Keine neue Abhängigkeit. fast-xml-parser mit `processEntities: false`, `htmlEntities: false`, `parseTagValue: false`, `parseAttributeValue: false`; `<!DOCTYPE`/`<!ENTITY` vorab abgelehnt; `XMLValidator.validate` vor dem Parsen; höchstens **10 MB**.
- Geld in Cent als Integer. Beträge als Text lesen, nie über `Number(...)` auf Euro.
- Übernommene Rechnungsarten (BT-3): **380, 381, 875, 876, 877**, dazu **384** mit Notiz. **386 und 326** abgelehnt mit Satz. Alles andere abgelehnt mit Satz, der die Nummer nennt.
- Abgelehnte Profile (BT-24 beginnt mit): `urn:factur-x.eu:1p0:minimum`, `urn:factur-x.eu:1p0:basicwl`; Namensraum `urn:ferd:CrossIndustryDocument:invoice:1p0` (ZUGFeRD 1.0).
- Namensräume: UBL `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2` / `…:CreditNote-2`, CII `urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100`.
- Nur Währung EUR. BT-110 ist die Angabe mit `currencyID` gleich BT-5.
- `totalGrossEur` ist **BT-112**, nie BT-115. Positionen ergeben zusammen genau BT-112 (Gutschrift: genau −BT-112).
- §35a nie geschätzt: Vorschlag nur aus einer Arbeitsposition, ohne Zuschläge (BG-21), Ausschlusswörter beachtet.
- Keine KI, kein Netz in diesem Modul.
- Testdaten erfunden oder aus der KoSIT-Testsuite (Apache-2.0) mit Herkunftsangabe. Keine echten Rechnungen.
- Server-Importe mit `.ts`, `import type`, kein `enum`; Kommentare und Meldungen deutsch, Bezeichner englisch; Meldungen siezen; kein Geviertstrich; keine Namen fremder Software (die Testsuite der KoSIT ist eine Behörde, ihr Name darf stehen).
- `npm run typecheck` und `npm run test:server` grün vor jedem Commit. Commits deutsch mit `Refs #189`.

## Review Focus

1. **KoSIT-Beispiel statt eigenem Bauer**: Wer Leser und Testbauer zugleich schreibt, spiegelt dieselben falschen Pfade. Mindestens je eine echte UBL- und CII-Datei der KoSIT-Testsuite muss die von Hand aus dem XML abgeschriebenen Werte ergeben (Task 3).
2. **Schlussrechnung mit Abzug der Abschläge als negative Position**: Positionen bleiben, wie sie sind, aber eine Notiz nennt den Abzug (Task 4, Test `Abzug mit Bezug auf Vorgängerrechnung`).
3. **Gruppe nur aus einem Zuschlag** (z. B. 7 %-Zuschlag ohne 7 %-Position): eigene Position, Summe stimmt trotzdem (Task 5).
4. **Rest-Cent bei Gutschrift und negativer Position**: kein Vorzeichenwechsel, Summe exakt (Invariante, Task 5).
5. **Kodierung**: ISO-8859-1-Datei mit Umlauten im Verkäufer liest wie UTF-8 (Task 1 übernimmt `decodeXml`, Test in Task 3).

---

### Task 1: Gemeinsame XML-Leser aus camt.ts herauslösen

**Files:**
- Create: `server/src/xml.ts`
- Modify: `server/src/bank/camt.ts` (Zeilen 44-120 und `decodeXml` ab 413 wandern; camt.ts importiert sie)
- Test: `server/test/xml.test.ts`; `server/test/camt.test.ts` und `bank-read.test.ts` bleiben unverändert grün

**Interfaces:**
- Produces (aus `server/src/xml.ts`):
  - `type XmlNode = Record<string, unknown>`
  - `makeParser(opts: { keepPrefixes: boolean }): XMLParser`: die camt-Einstellung, mit `removeNSPrefix: !keepPrefixes`
  - `isNode(v): v is XmlNode`, `list(v): unknown[]`, `at(node, ...path): unknown`, `all(node, ...path): unknown[]`
  - `text(v): string | null` (mit `decodeEntities`), `attr(v, name: string): string | null` (liest `@name` eines Knotens)
  - `decodeXml(data: Buffer): { xml: string } | { problem: string }`
  - `refuseUnsafe(xml: string): string | null`: Satz bei DOCTYPE/ENTITY oder unvollständigem XML (`XMLValidator`), sonst `null`. Die beiden Sätze bleiben in camt.ts, weil sie „Kontoauszug“ nennen; `refuseUnsafe` liefert nur die Art (`'doctype' | 'incomplete' | null`), jeder Aufrufer formuliert selbst.
  - `signedDecimalToCents(raw: string): number | null`: wie `decimalToCents(raw, '.')`, dazu ein führendes `-`; mehr als zwei Nachkommastellen ergeben `null`.

- [ ] **Step 1: Test schreiben**: `xml.test.ts` mit `signedDecimalToCents('-12.5') === -1250`, `('0.005') === null`, `('1e3') === null`, `('12') === 1200`; `refuseUnsafe('<!DOCTYPE x><x/>') === 'doctype'`, `refuseUnsafe('<a><b></a>') === 'incomplete'`; `attr(makeParser({keepPrefixes:false}).parse('<a x="1"/>').a, 'x') === '1'`.
- [ ] **Step 2: Laufen lassen**: `node --test server/test/xml.test.ts`, erwartet: FAIL (Modul fehlt).
- [ ] **Step 3: Umsetzen**: Funktionen verschieben, nicht neu schreiben; camt.ts importiert sie. Die Kommentare wandern mit.
- [ ] **Step 4: Prüfen**: `node --test server/test/xml.test.ts server/test/camt.test.ts server/test/bank-read.test.ts` grün, `npm run typecheck` grün.
- [ ] **Step 5: Commit** `Kontoauszug: XML-Leser für die E-Rechnung herausgelöst (Refs #189)`

### Task 2: Erkennen (Wurzel, Namensraum, Profil)

**Files:**
- Create: `server/src/eInvoice/detect.ts`, `server/src/eInvoice/model.ts`
- Test: `server/test/e-invoice.test.ts` (Abschnitt „Erkennen“)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `type EInvoiceSyntax = 'ubl-invoice' | 'ubl-credit-note' | 'cii'`
  - `type Refusal = { refused: string }` (gesiezter Satz für den Vermieter)
  - `detectEInvoice(xml: string): { syntax: EInvoiceSyntax, profile: string | null } | Refusal | null`. `null` heißt „keine E-Rechnung“ (anderes XML), `Refusal` heißt „E-Rechnung, aber nicht übernehmbar“ oder „unsicher“.
  - `const E_INVOICE_MAX_BYTES = 10 * 1024 * 1024`

- [ ] **Step 1: Tests schreiben**:
  - UBL-Invoice, UBL-CreditNote, CII je mit Präfix (`<rsm:CrossIndustryInvoice xmlns:rsm=…>`) **und** als Vorgabe-Namensraum (`<Invoice xmlns=…>`) werden erkannt.
  - `<Invoice xmlns="urn:example">` → `null`; `<Document>` (camt) → `null`.
  - CII mit `GuidelineSpecifiedDocumentContextParameter/ID` = `urn:factur-x.eu:1p0:minimum` und `…:basicwl` → `Refusal`, Satz enthält „keine Positionen“.
  - `urn:ferd:CrossIndustryDocument:invoice:1p0` → `Refusal` (ZUGFeRD 1.0).
  - DOCTYPE → `Refusal`; abgeschnittenes XML → `Refusal`.
  - profile wird zurückgegeben (UBL `CustomizationID`, CII Guideline-ID), z. B. `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`.
- [ ] **Step 2: Laufen lassen**: FAIL.
- [ ] **Step 3: Umsetzen**: erster Durchgang mit `makeParser({ keepPrefixes: true })`, Wurzelname ohne Präfix, Namensraum aus `@xmlns:<präfix>` bzw. `@xmlns`. Profil im zweiten Durchgang (`keepPrefixes: false`).
- [ ] **Step 4: Prüfen**: grün, typecheck grün.
- [ ] **Step 5: Commit** `E-Rechnung erkennen: UBL, CII, Profile (Refs #189)`

### Task 3: Lesen zum Modell, an KoSIT-Beispielen geprüft

**Files:**
- Create: `server/src/eInvoice/read.ts`; Modell in `server/src/eInvoice/model.ts`
- Create: `server/testing/eInvoiceXml.ts` (Bauer: macht aus einem `EInvoice` UBL- und CII-XML, für Task 4 und 5)
- Create: `server/test/fixtures/e-invoice/` mit 2 bis 4 Dateien aus https://github.com/itplr-kosit/xrechnung-testsuite (je eine UBL- und eine CII-Rechnung mit mehreren Positionen, möglichst eine mit zwei Steuersätzen und eine Gutschrift) und `HERKUNFT.md` (Quelle, Commit, Lizenz Apache-2.0, unverändert übernommen). Heruntergeladene Dateien vor dem Commit lesen.
- Test: `server/test/e-invoice.test.ts` (Abschnitt „Lesen“)

**Interfaces:**
- Produces (`model.ts`):
  ```ts
  type VatKey = { category: string, rateBasisPoints: number }   // Satz in Hundertstel-Prozent: 19 % → 1900, 7 % → 700
  type EInvoiceLine = { id: string, name: string, description: string | null, netCents: number, unitCode: string | null, vat: VatKey }
  type EInvoiceDocCharge = { charge: boolean, cents: number, reason: string | null, vat: VatKey }
  type EInvoiceVatGroup = { vat: VatKey, basisCents: number, taxCents: number }
  type EInvoice = {
    syntax: EInvoiceSyntax, typeCode: string, number: string | null, issueDate: string | null,
    currency: string | null, seller: string | null, buyer: string | null,
    periodStart: string | null, periodEnd: string | null, deliveryDate: string | null,
    dueDate: string | null, iban: string | null, precedingInvoice: { number: string, date: string | null } | null,
    lines: EInvoiceLine[], charges: EInvoiceDocCharge[], vatGroups: EInvoiceVatGroup[],
    totals: { lineNet: number | null, allowances: number | null, charges: number | null, taxExclusive: number | null,
              tax: number | null, taxInclusive: number | null, prepaid: number | null, rounding: number | null, payable: number | null },
    unreadable: string[],   // BT-Kennungen, deren Wert da, aber nicht lesbar war (z. B. „BT-131 Position 3“)
  }
  ```
  Satz als Integer in Hundertstel-Prozent, damit kein Float im Schlüssel steht. Fehlt BT-119 (Kategorie E, O, AE …), gilt 0.
- `readModel(xml: string, syntax: EInvoiceSyntax): EInvoice` in `read.ts`.
- Beträge stehen im Modell **wie im XML** (Gutschrift positiv); das Vorzeichen setzt Task 5.
- Pfade: Tabelle „XPaths“ der Recherche, im Entwurf zusammengefasst; maßgeblich ist, dass die KoSIT-Dateien stimmen. Hinweise: CII-Datum Format `102` (`JJJJMMTT`) → ISO; UBL-Verkäufer `PartyLegalEntity/RegistrationName`, sonst `PartyName/Name`; UBL-Fälligkeit bei CreditNote unter `PaymentMeans/PaymentDueDate`; IBAN nicht bei Lastschrift (BT-81 = 59); `precedingInvoice` aus BG-3 (UBL `BillingReference/InvoiceDocumentReference`, CII `ApplicableHeaderTradeSettlement/InvoiceReferencedDocument`).

- [ ] **Step 1: KoSIT-Dateien holen und lesen**, Erwartungswerte **von Hand aus dem XML** in den Test schreiben (Nummer, Datum, Verkäufer, Anzahl Positionen, Netto jeder Position, Steuergruppen, BT-109/110/112/115).
- [ ] **Step 2: Tests schreiben**: je KoSIT-Datei `readModel` gleich den Erwartungswerten; Bauer-Rundlauf (ein Modell → UBL → `readModel` → dasselbe Modell, ebenso CII) für: zwei Steuersätze, Zuschlag und Abschlag auf Dokumentebene, negative Position, BT-113 > 0, doppeltes BT-110 (zweites in USD wird ignoriert), Gutschrift, BG-3 vorhanden, Lastschrift ohne IBAN; ISO-8859-1-Datei mit `Müller GmbH` über `decodeXml`; Betrag `12.345` landet in `unreadable`.
- [ ] **Step 3: Laufen lassen**: FAIL.
- [ ] **Step 4: Umsetzen** `readModel` und den Bauer.
- [ ] **Step 5: Prüfen**: grün, typecheck grün.
- [ ] **Step 6: Commit** `E-Rechnung lesen: UBL und CII zum gemeinsamen Modell (Refs #189)`

### Task 4: Prüfen (Rechnungsart, Währung, Pflichtfelder, Summen, Notizen)

**Files:**
- Create: `server/src/eInvoice/check.ts`
- Test: `server/test/e-invoice.test.ts` (Abschnitt „Prüfen“)

**Interfaces:**
- Consumes: `EInvoice` (Task 3).
- Produces: `checkEInvoice(inv: EInvoice): { refused: string } | { notes: string[] }`

Regeln, in dieser Reihenfolge:
1. `unreadable` nicht leer, oder BT-2 / BT-112 fehlt, oder keine Position → `refused` („Die E-Rechnung ließ sich nicht vollständig lesen (…).“).
2. Währung ≠ `EUR` → `refused` mit der Währung.
3. BT-3: 386/326 → `refused` „Abschlags- und Teilrechnungen übernimmt Mietfuchs nicht als Kosten, sonst zählte die Schlussrechnung doppelt. Erfassen Sie die Schlussrechnung.“; nicht in {380, 381, 384, 875, 876, 877} → `refused` mit Nummer.
4. Notizen (jede ein Satz, Beträge mit `fmtEuro`):
   - 384: „Diese Rechnung korrigiert die Rechnung {Nummer} vom {Datum}. Diese darf nicht zusätzlich gebucht sein.“
   - BT-113 > 0: „Abschläge über {Betrag} sind bereits bezahlt; als Kosten zählt der Gesamtbetrag von {BT-112}.“
   - BR-CO, Toleranz 1 Cent je Regel: Summe BT-131 = BT-106; BT-109 = BT-106 − BT-107 + BT-108; BT-112 = BT-109 + BT-110; BT-110 = Summe BT-117. Je Abweichung ein Satz mit beiden Beträgen.
   - Abzug mit Bezug: eine negative Position oder ein Abschlag auf Dokumentebene, wenn `precedingInvoice` gesetzt ist oder Name/Grund auf `/abschlag|anzahlung|vorauszahlung|bereits (gezahlt|bezahlt)/i` passt: „Die Rechnung zieht {Betrag} für „{Name}“ ab. Ist das eine bereits gebuchte Abschlagsrechnung, wären die Kosten zu niedrig.“

- [ ] **Step 1: Tests schreiben**, je Regel ein Fall über den Bauer, dazu: 875 ohne Notiz; 381 ohne Notiz; 380 mit BT-112 um 2 Cent neben BT-109 + BT-110 → eine BR-CO-Notiz; 1 Cent → keine.
- [ ] **Step 2: Laufen lassen**: FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen**: grün, typecheck grün.
- [ ] **Step 5: Commit** `E-Rechnung prüfen: Rechnungsart, Währung, Summenregeln (Refs #189)`

### Task 5: Abbilden auf `RawExtraction` (Brutto je Position, §35a) und Eingang `readEInvoice`

**Files:**
- Create: `server/src/eInvoice/toRaw.ts`, `server/src/eInvoice/index.ts`
- Test: `server/test/e-invoice.test.ts` (Abschnitte „Abbilden“, „Lohnanteil“, „Invariante“, „Eingang“)

**Interfaces:**
- Consumes: Task 2 bis 4; `largestRemainder` aus `server/src/apportion.ts`; `RawExtraction` aus `server/src/invoiceAmounts.ts`.
- Produces (für PR 2):
  ```ts
  // server/src/eInvoice/toRaw.ts
  toRawExtraction(inv: EInvoice): { raw: RawExtraction, laborGuessed: boolean[] }
  // server/src/eInvoice/index.ts
  type EInvoiceResult =
    | { kind: 'none' }                                   // keine E-Rechnung: bisheriger Weg
    | { kind: 'refused', reason: string }                // E-Rechnung, nicht übernommen: bisheriger Weg mit Satz
    | { kind: 'read', raw: RawExtraction, laborGuessed: boolean[], notes: string[], invoiceNumber: string | null }
  readEInvoice(data: Buffer): EInvoiceResult
  ```
  `readEInvoice` prüft Größe (`E_INVOICE_MAX_BYTES` → refused), `decodeXml`, `detectEInvoice`, `readModel`, `checkEInvoice`, `toRawExtraction`.

`raw` hat genau: `vendor` (BT-27), `invoiceDate` (BT-2), `periodStart`/`periodEnd` (BT-73/74, sonst beide BT-72, sonst `null`), `totalGrossEur` (BT-112 / 100, bei Gutschrift negativ), `positions: [{ description, amountEur, labor35aEur }]`. **Kein `category`** (linesFromExtraction nimmt dann die Beschreibung, PR 2 prüft die Farbe), kein `positionsAreNet`, kein `labor35aTotalEur`, damit `normalizeAmounts` nichts ändert. `description` = BT-153, mit „ - “ und BT-154, wenn BT-154 nicht leer und nicht gleich, gekürzt mit `clip` auf 200.

Brutto-Verteilung je Steuergruppe (BG-23), Gruppenbrutto G = BT-116 + BT-117:
```text
gewicht_i = netCents_i × (10000 + rateBasisPoints) / 10000      für Positionen der Gruppe
roh_i     = G × gewicht_i / Σ gewicht
cents_i   = largestRemainder über die Positionen mit sign(netCents_i) == sign(G),
            die übrigen Math.round(roh_i); Rest-Cent nur unter den gleichen Vorzeichens
```
Gruppe ohne Position (oder Σ gewicht = 0): eine Position mit dem Grund des Zuschlags/Abschlags dieser Gruppe (sonst „Zuschlag“/„Abschlag“) und dem Betrag G. Gutschrift (`ubl-credit-note` oder BT-3 381): alle Beträge × −1 am Ende.

§35a je Position, `laborGuessed[i] = true` genau dann, wenn vorgeschlagen:
- Arbeit, wenn `unitCode` ∈ {`HUR`, `MIN`, `DAY`} oder Name/Beschreibung auf `/arbeitszeit|arbeitslohn|\blohn|monteur|gesellen|meisterstunde|maschinenstunde|anfahrt|fahrtkosten|fahrtzeit/i` passt,
- **und nicht** `/material|gutachten|planung|miete/i`,
- **und** `netCents > 0`.
- Wert: `netCents + round(netCents × rateBasisPoints / 10000)` minus anteiliger Abschläge (BG-20) der Gruppe im Verhältnis Netto der Position zu Netto der Gruppe, brutto; Zuschläge (BG-21) nie. Begrenzt auf [0, Brutto der Position]. Sonst `labor35aEur: null`.

- [ ] **Step 1: Tests schreiben**:
  - Eine Position 100,00 netto 19 % → Position 119,00, Summe = BT-112.
  - Zwei Gruppen (19 % und 7 %) mit Zuschlag 10,00 in 19 % → Summe = BT-112, die 7 %-Positionen unberührt vom Zuschlag.
  - Gruppe nur aus Zuschlag 7 % → eigene Position mit Grund.
  - Gutschrift UBL und CII → alle Beträge negativ, Summe = −BT-112.
  - Lohn: `HUR` 2 × 55,00 netto 19 % → `labor35aEur` 130,90, `laborGuessed` true; dieselbe Position mit Dokumentzuschlag „Entsorgung“ 20,00 → Lohn weiter 130,90 (Zuschlag nicht drin), Positionsbetrag größer; mit Dokumentabschlag 10 % auf die Gruppe → Lohn um anteiligen Abschlag kleiner; Name „Stundensatz inkl. Material“ → kein Vorschlag; „Anfahrtspauschale“ ohne Einheit → Vorschlag; „Kupferrohr 15 mm“ `MTR` → kein Vorschlag.
  - `normalizeAmounts(raw)` aus invoiceAmounts.ts lässt `raw` unverändert (`deepEqual`), `amountsAdjusted` und `laborFromTotal` bleiben leer.
  - Eingang: `readEInvoice` auf jede KoSIT-Datei → `kind: 'read'`, Summe der Positionen = BT-112; auf camt-Fixture → `none`; auf MINIMUM → `refused`; auf 11 MB → `refused`; auf 386 → `refused`.
  - **Invariante** (mulberry32 wie in period.test.ts, Startwerte 1 bis 300): zufällige Rechnungen über den Bauer (1 bis 8 Positionen, Netto −500,00 bis 5.000,00 mit überwiegend positiven, Sätze 0/7/19 %, 0 bis 2 Dokumentzuschläge und -abschläge, Gutschrift zu 20 %), BT-110/112 vom Bauer korrekt gerechnet: Summe der Positionen = ±BT-112 exakt; keine Position wechselt das Vorzeichen gegenüber ihrem Netto; jeder Lohnvorschlag in [0, Positionsbetrag]; `toExtraction(normalizeAmounts(raw))` behält jede Position.
- [ ] **Step 2: Laufen lassen**: FAIL.
- [ ] **Step 3: Umsetzen** `toRawExtraction` und `readEInvoice`.
- [ ] **Step 4: Prüfen**: `node --test server/test/e-invoice.test.ts` grün, dann `npm run test:server` und `npm run typecheck` grün.
- [ ] **Step 5: Commit** `E-Rechnung abbilden: Brutto je Position, Lohnanteil, Eingang für die Auswertung (Refs #189)`

### Abschluss

- [ ] Durchsicht mit frischem Kontext (CLAUDE.md „Durchsicht vor jedem PR“), Befunde mit vorher rotem Test beheben.
- [ ] PR gegen `main`: `E-Rechnung lesen (1/4): XRechnung und ZUGFeRD zum Vorschlag, ohne KI (Refs #189)`, Beschreibung mit Befunden der Durchsicht. Kein CHANGELOG-Eintrag (noch nichts für Nutzer sichtbar; kommt in PR 2).
