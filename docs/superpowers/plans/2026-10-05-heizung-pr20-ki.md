# Heizung PR 20: KI liest Messdienstabrechnung und Lieferantenrechnung (#103) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die KI-Belegauswertung liest zwei neue Belegarten und füllt damit die Formulare der Seite
Heizkosten vor, ohne etwas selbst zu speichern: die Heiz- und Warmwasserkostenabrechnung eines
Messdienstes (Nutzerzeilen je Kostenblock, Zeitraum, CO₂-Block, Abzugszeile „Abzüglich CO₂-Kosten
Vermieter“, die gedruckte Kostensumme S, Ermittlung des Warmwasseranteils, Zahl der Nutzeinheiten) und die
Rechnung eines Brennstoff- oder Wärmelieferanten (Angaben nach § 3 Abs. 1 Nr. 1–4 und 6 CO2KostAufG,
Teilmengen, Heizwert). Ein Mensch prüft jede Zahl, ordnet jede Nutzerzeile einem Mietverhältnis zu und
speichert selbst.

**Architecture:** Ein neues Modul `server/src/extractHeating.ts` hält Schemas, Prompts und je Belegart genau
einen benannten Ausgang (`toServiceExtraction`, `toFuelExtraction`), an dem die Zusage an den Browser
entsteht, nach dem Muster `RawExtraction`/`Extraction` aus CLAUDE.md. `extract.ts` gibt dafür `ask` und das
Zusammenstellen von Text und Seitenbildern (`documentMaterial`) frei. Zwei Routen unter
`/api/heating-plants/:id/…` antworten als derselbe Strom wie `/api/extract`. Im Client stehen Zuordnung,
Prüfungen und die Rümpfe für Kostenpositionen, CO₂-Angaben und Lieferung DOM-frei in
`client/src/serviceImport.ts` und `client/src/fuelImport.ts`; die Karten rendern nur. Der KI-Prüflauf
bekommt drei erfundene Belege und eigene Bewertungen.

**Tech Stack:** Node 24 (TypeScript ohne Build), Express 5, `node:test`, React 19 + Vite, vitest mit jsdom,
Ollama oder OpenAI-kompatibler Dienst über `server/src/ai/`.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich 1.1 (W5,
W9), 3.2 (Stufe 3 Teilmengen laut Rechnung, `fixed_cents`), 5.4 (`fuel_deliveries`, `fuel_delivery_parts`,
`heating_value`, `emissions_kg`, `co2_cost_cents`, `emission_factor`, `bio_cost_cents`), 5.5
(`co2_statements`, S, NE, L), 7.1–7.4 (Betrag der Position = Gesamtkosten vor Abzug; Probe; „#103 liest die
Abzugszeile künftig aus“), 7.7 (Warmwasser beim Messdienst als Angabe), 8.3 (Heizwert laut Rechnung vor
Tabelle), 11.3 (was ein Vermieter mit Messdienst mindestens tut), **13 PR 20**, 14.1 (Zeile
„Komplettabrechnung des Messdienstes … KI liest alle Blöcke“), 14.2 (#103), 16 („Rückfall, der kg oder €
aus kWh vorrechnet“ ist Nicht-Ziel).

**Baut auf:** PR 1 bis PR 19. Gearbeitet wird auf `feat/heizung-pr20-ki`, abgezweigt von der Spitze von
PR 19, gestapelt gestellt und nach dem Merge von PR 19 auf `main` umgestellt.

**Rechtsquellen, am 05.10.2026 im Wortlaut gelesen** (gesetze-im-internet.de):

- § 3 Abs. 1 CO2KostAufG: Brennstofflieferanten haben auf Rechnungen „folgende Informationen in
  allgemeinverständlicher Form auszuweisen: 1. die Brennstoffemissionen der Brennstoff- oder
  Wärmelieferung in Kilogramm Kohlendioxid, 2. den sich nach Absatz 2 für den jeweiligen Zeitpunkt der
  Lieferung ergebenden Preisbestandteil der Kohlendioxidkosten …, 3. den heizwertbezogenen
  Emissionsfaktor … in Kilogramm Kohlendioxid pro Kilowattstunde, 4. den Energiegehalt der gelieferten oder
  zur Wärmeerzeugung eingesetzten Brennstoffmenge in Kilowattstunden, 5. einen Hinweis auf die in § 6
  Absatz 2 und § 8 Absatz 2 geregelten Erstattungsansprüche sowie 6. im Fall der Belieferung eines
  Gebäudes, … das durch eine Heizungsanlage nach § 43 Absatz 1 des Gebäudemodernisierungsgesetzes … versorgt
  wird, den Preisbestandteil für den … verpflichtend anteilig zu nutzenden Brennstoff“. Abs. 3: Der
  Preisbestandteil nach Nr. 2 ist „zuzüglich einer auf diesen Betrag anfallenden Umsatzsteuer“ auszuweisen.
  Abs. 4: entsprechend für Wärmelieferanten.
- § 7 Abs. 3, 4 CO2KostAufG: Ausweis in der Heizkostenabrechnung; sonst 3 % Kürzung (Bestand seit PR 6).
- § 9 Abs. 3 HeizkostenV: Heizwerte laut Rechnung „sind … zu verwenden“, die Tabelle nur hilfsweise
  (übernommen aus dem Entwurf, R-A13; Bestand seit PR 11).

## Global Constraints

- **Die KI schlägt nur vor, ein Mensch prüft** (CLAUDE.md „KI-Belegauswertung“): Keine Route dieses Plans
  schreibt eine Kostenposition, einen CO₂-Datensatz oder eine Lieferung. Gespeichert wird erst über die
  bestehenden Routen, wenn der Vermieter in der Oberfläche „Übernehmen“ wählt. Einzige Ausnahme ist wie
  bei `/api/extract` der hochgeladene Beleg im Belegarchiv; bei Abbruch verschwindet er (`aiResponse`).
- **Eine Grenze, benannt** (#63): Was vom Modell kommt, ist `Record<string, unknown>`; was der Browser
  bekommt, beschreiben `ServiceStatementExtraction` und `FuelInvoiceExtraction` in `shared/types.ts`.
  Überschritten wird die Grenze je Belegart an genau einer Funktion (`toServiceExtraction`,
  `toFuelExtraction`). Kein `as`, keine Zusicherung über Modellwerte.
- **Rechne nichts vor, was nicht auf dem Beleg steht** (Entwurf 16): Keine kg und kein € aus kWh. Einzige
  Rechnung ist das Hochrechnen von Netto-Teilmengen auf den Rechnungsbetrag, nach derselben Regel wie
  `normalizeAmounts` (#34, `vatExplainsGap`), und nur, wenn das Modell sie als netto meldet.
- **Die Frage nach der Abzugszeile bleibt ohne Vorgabe** (Entwurf 7.2): Die Auswertung zeigt die gefundene
  Zeile an, wählt aber keine Antwort vor (Abweichung 2).
- **Betrag der Heizposition = Gesamtkosten vor Abzug** (7.1, 7.3): S + Abzugszeile, wenn eine Abzugszeile
  gelesen wurde; sonst S.
- **Erfundene Belege** (CLAUDE.md „KI-Prüflauf“): Neue Beispielbelege nur erfunden, nie echte Rechnungen.
  Namen, Adressen, Nummern und IBAN sind Muster.
- **Jedes neue Auswahlfeld** wird aus einer Optionsliste gespeist und bekommt einen jsdom-Test, dass der
  angezeigte Wert der gespeicherte ist (CLAUDE.md, Kosten.test.tsx).
- **Prompts** dürfen duzen (anrede.test.ts nimmt sie aus); Oberfläche und Meldungen siezen.
- **Keine Migration**, kein Rechtswert, kein neuer Hinweis-Code in der Abrechnung.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch. Server-Importe mit `.ts`, reine
  Typimporte mit `import type`, kein `enum`.
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port).
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0. Commit-Nachrichten
  deutsch, mit `Refs #103` und den Attribution-Zeilen der ausführenden Sitzung. Der PR bekommt das Label
  `ai-eval`, damit der KI-Prüflauf die neuen Belege mit echten Modellen liest.

## Review Focus

1. **Die Gasrechnung endet mit „Nachzahlung 107,80 €“ nach Abzug der Abschläge.** Der Rechnungsbetrag der
   Lieferung ist der Gesamtbetrag 4.067,80 €, nicht die Nachzahlung. Erwartet: Prompt und erfundener Beleg
   prüfen genau das; die Auswertung meldet die Summe der Teilmengen gegen den Rechnungsbetrag. Tests in Task 2
   (Ausgang) und Task 7 (Prüflauf, Fall `gas-supplier`).
2. **Die Abzugszeile steht mit Minus da („−87,50“), oder das Modell liest sie als Text.** Erwartet: positiver
   Betrag 87,50 €; ein Text, der keine Zahl ist, fehlt. Test in Task 2.
3. **Eine Nutzerzeile passt auf zwei Mietverhältnisse** (Vornutzer und Nachnutzer derselben Wohnung, oder zwei
   Mieter mit gleichem Nachnamen). Erwartet: keine stille Zuordnung, die Zeile bleibt „bitte zuordnen“, und
   Übernehmen lehnt mit einem Satz ab, bis jede Zeile zugeordnet ist. Test in Task 4.
4. **In der Heizperiode stehen schon Einzelbeträge des Messdienstes** (zweite Auswertung desselben Belegs).
   Erwartet: Der Heizblock ist nicht vorgehakt, und ein Satz sagt, warum; doppelt verteilte Heizkosten
   entstünden sonst ohne Fehlermeldung. Test in Task 4.
5. **Kaltwasser steht in der Komplettabrechnung, der Zeitraum des Messdienstes (Mai bis April) ist aber nicht
   der des Objekts (Kalenderjahr).** Kalte Kosten gehören in den Objektzeitraum (Entwurf 3.4). Erwartet: Der
   Kaltwasserblock wird nicht übernommen, mit einem Satz, der auf die Kostenseite verweist. Test in Task 4.

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/types.ts` | `ServiceStatementExtraction`, `ServiceBlock`, `ServiceUserLine`, `ServiceCo2Extraction`, `FuelInvoiceExtraction`, `FuelInvoicePartExtraction`, `ServiceExtractResult`, `FuelExtractResult` | 1 |
| `server/src/extract.ts`, `server/src/invoiceAmounts.ts` | `ask`, `documentMaterial` frei; `vatExplainsGap`, `rateDate`, `tolerance` exportiert | 1 |
| `server/src/extractHeating.ts` (neu) | Schemas, Prompts, Ausgänge, Hochrechnen der Teilmengen, Auswertung | 2 |
| `server/src/index.ts` | zwei Routen | 3 |
| `client/src/aiRequest.ts` | neue Schritte im Fortschritt | 3 |
| `client/src/serviceImport.ts` (neu), `client/src/components/ServiceImportReview.tsx` (neu), `client/src/components/ServiceImportCard.tsx` (neu), `client/src/pages/Heizkosten.tsx` | Messdienstabrechnung übernehmen | 4, 5 |
| `client/src/fuelForm.ts`, `client/src/fuelImport.ts` (neu), Karte der Lieferungen (PR 7: `client/src/components/FuelCard.tsx`) | Lieferantenrechnung übernehmen | 6 |
| `scripts/ai-eval/invoices/metering-service.html`, `gas-supplier.html`, `heating-oil.html` (neu), `scripts/ai-eval/cases.json`, `scripts/ai-eval/score.mjs` (neu), `scripts/ai-eval/score.d.mts` (neu), `scripts/ai-eval.mjs` | KI-Prüflauf | 7 |
| `CHANGELOG.md`, `CLAUDE.md`, `shared/guides.ts` | Doku | 8 |
| Tests: `server/test/extract.test.ts`, `server/test/extract-heating.test.ts` (neu), `server/test/api.test.ts`, `server/test/ai-eval-score.test.ts` (neu), `client/src/aiRequest.test.ts`, `client/src/serviceImport.test.ts` (neu), `client/src/components/ServiceImportReview.test.tsx` (neu), `client/src/fuelImport.test.ts` (neu), `client/src/fuelForm.test.ts`, `client/src/components/FuelCard.test.tsx` | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

- Code auf `feat/heizung`: `server/src/extract.ts` (`ask` Datei-intern, `EXTRACT_CATEGORIES`,
  `numberFromModel`, `TIMEOUT_SECONDS`, `PAGES_MAX`, `TEXT_MIN`, `TEXT_MAX`, `NO_CONTENT`,
  `extractFromFile`, `AskOptions`, `AskProgressEvent`, `AskStats`); `server/src/invoiceAmounts.ts`
  (`vatExplainsGap`, `rateDate`, `tolerance` Datei-intern); `server/src/index.ts` (`fileWithPages`,
  `uploadedFile`, `documentOf`, `aiInput`, `aiResponse`, `effectiveSettings`, `messageOf`, `readData`);
  `client/src/aiRequest.ts` (`aiRequest<T>(path, body, { onProgress, signal })`, `AiStep`, `progressText`);
  `client/src/pdfIntake.ts` (`buildUpload(file)`); `client/src/api.ts` (`api`, `errorText`, `fmtEuro`,
  `parseEuro`); `client/src/types.ts` (`CATEGORIES`); `shared/heating.ts` (`HEATING_CATEGORY`);
  `server/test/api.test.ts` (`fakeOllama`, `withOllama`, `LONG_TEXT`, `PDF`, `jsonOf`).
- PR 4: `HeatingPlant` (`id`, `propertyId`, `method`, `source`, `energy`), `DhwMethod`, `readHeatingPlants(db)`
  (read.ts), Routen `GET`/`POST /api/heating-plants`, `NO_PLANT` in index.ts (PR 6).
- PR 6: `Co2Statement`, `HeatingPeriodView` (`plantId`, `period`, `from`, `to`, `items`, `co2`, `hotWater`),
  `client/src/co2Form.ts` (`Co2Form`, `Co2Answer`, `co2ToForm`, `co2Body(form, ctx)`, `CO2_QUESTION`,
  `CO2_EXAMPLE`, `CO2_ANSWER_OPTIONS`, `parseDecimal`), Routen `PUT /api/heating-plants/:id/periods/:period/co2`
  und `…/hot-water` (Rumpf `{ dhwMethod }` wird mit dem Bestand verschmolzen).
- PR 7: `FuelDelivery`, `FuelDeliveryPart` (`from`, `to`, `energyKwh`, `amountCents`, `fixedCents`,
  `emissionsKg`, `co2CostCents`), `FuelQuantityUnit`, `GasBasis`; `client/src/fuelForm.ts` (`FuelForm`,
  `emptyFuelForm`, `fuelToForm`, `fuelBody(form, method)`); Karte der Lieferungen; Routen
  `POST /api/heating-plants/:id/deliveries`, `PUT /api/fuel-deliveries/:id`.
- PR 11: `FuelForm.heatingValue`, `FuelDelivery.heatingValue`.
- Generische Route `POST /api/costItems` (index.ts, Schleife der Collections) und Felder `CostItem.key =
  'amounts'`, `tenancyAmounts`, `selfAmounts`, `invoiceFile`, `heatingPlantId` (PR 4).

### Annahmen über PR 8 bis PR 19 und Namen der Vorgänger

**Vor Task 1** gleicht die ausführende Sitzung jede Zeile ab und ersetzt abweichende Namen:

| Nr. | Annahme | Wo benutzt |
|---|---|---|
| C1 | Die Karte der Lieferungen heißt nach PR 7 `FuelCard.tsx` (spätere Pläne nennen sie `FuelDeliveriesCard.tsx`); maßgeblich ist der Code. | Task 6 |
| C2 | `FuelForm` hat nach PR 7 bis PR 11 die Felder `label`, `invoiceFrom`, `invoiceTo`, `amount`, `fixed`, `sharePercent`, `emissionsKg`, `co2Cost`, `energyKwh`, `usedByService`, `heatingValue`, `grade`; dazu womöglich (PR 8, PR 9) `deliveredAt`, `quantity`, `quantityUnit`, `unitId`. Task 6 ergänzt jedes Feld aus seiner Liste, das fehlt, und lässt vorhandene stehen. | Task 6 |
| C3 | `fuelBody` nimmt `bioCostCents` an, seit PR 18 die Biobrennstoffkosten freigegeben hat; vorher lehnt der Server sie mit 400 ab. | Task 6 |
| C4 | Die Seite Heizkosten kennt den Zeitraum des Objekts als `BillingPeriod` (`{ key, from, to }`) über `usePeriod()` (PR 3); heißt das Feld anders, dessen Namen. | Task 5 |
| C5 | `GET /api/tenancies` und `GET /api/units` nehmen `?property=` (Bestand, `withProperty`). | Task 5 |
| C6 | Kein PR zwischen 8 und 19 ändert `extract.ts`, `invoiceAmounts.ts` oder die Strom-Antwort der KI-Routen. | Task 1–3 |

## Abweichungen vom Entwurf und Festlegungen dieses Plans

1. **Je Belegart ein Ausgang statt Eingang und Ausgang.** CLAUDE.md beschreibt für Rechnungen zwei benannte
   Stellen, weil dazwischen `normalizeAmounts` rechnet. Hier rechnet Mietfuchs nur bei Netto-Teilmengen, und
   das geschieht im Ausgang auf den schon gelesenen Zahlen; ein eigener roher Typ hätte keine Funktion.
2. **Die gefundene Abzugszeile wählt keine Antwort vor** (7.2 „ohne Vorgabe“). Sie steht als Satz neben der
   Frage, und wählt der Vermieter „nur ausgewiesen“, obwohl die Zeile gelesen wurde, warnt die Karte. Damit
   ist die Restlücke aus 7.4 („nein, obwohl abgezogen“, Betrag = S) für ausgelesene Abrechnungen sichtbar.
3. **Kalte Blöcke nur, wenn die Heizperiode dem Objektzeitraum gleicht** (Festlegung, Review Focus 5). Der
   Entwurf (14.1) sagt „je Kostenart eine `amounts`-Position; KI liest alle Blöcke“, nennt aber keinen
   Zeitraum. Kalte Kosten gehören nach 3.4 in den Objektzeitraum; ein Block über Mai bis April müsste
   aufgeteilt werden, und das Aufteilen beim Speichern (PR 3) ist für Einzelbeträge je Mieter nicht
   definiert.
4. **Zuordnung nur bei genau einem Treffer** (Review Focus 3): Name und Zeitraum der Zeile gegen
   Mietverhältnisse, die die Heizperiode berühren; „Leerstand“ und „Eigentümer/Eigennutzung“ als Wörter. Sonst
   bleibt die Zeile offen.
5. **Bereits vorhandene Einzelbeträge** (Review Focus 4): Der Heizblock ist dann nicht vorgehakt.
6. **Der Netto-Hinweis der CO₂-Kosten wird nicht hochgerechnet.** § 3 Abs. 3 verlangt den Preisbestandteil
   mit Umsatzsteuer; nennt eine Rechnung ihn netto, zeigt die Karte das als Mangel des Belegs, statt eine
   Zahl zu erfinden.
7. **Keine Plausibilität von kg gegen kWh in der Auswertung.** Die prüft PR 17 nach dem Speichern
   (`co2.cost-implausible`); hier stünde sie doppelt und mit einem Hs/Hi-Verhältnis, das nicht im Register
   steht.
8. **Höchstens vier Seitenbilder** bei Scans, wie bei Rechnungen (`PAGES_MAX`). Eine gescannte
   Messdienstabrechnung mit mehr Seiten liest nur die ersten vier; die Karte sagt das, wenn der Beleg mehr hat
   (der Browser kennt die Seitenzahl, `buildUpload`).

---

### Task 1: Typen und freigegebene Bausteine

**Files:**
- Modify: `shared/types.ts`, `server/src/extract.ts`, `server/src/invoiceAmounts.ts`
- Test: `server/test/extract.test.ts`

**Interfaces:**
- Produces (shared/types.ts):
  - `type ServiceUserLine = { label: string; unitLabel: string | null; from: string | null; to: string | null; amountEur?: number; vacancy: boolean }`
  - `type ServiceBlock = { title: string; category: string; totalEur?: number; lines: ServiceUserLine[] }`
  - `type ServiceCo2Extraction = { emissionsKg: number | null; areaM2: number | null; kgPerM2: number | null; landlordPercent: number | null; totalEur: number | null; landlordEur: number | null }`
  - `type ServiceStatementExtraction = { vendor?: string; periodStart?: string; periodEnd?: string; unitsCount: number | null; usersTotalEur: number | null; deductionEur: number | null; co2: ServiceCo2Extraction | null; dhwMethod: DhwMethod | null; blocks: ServiceBlock[] }`
  - `type FuelInvoicePartExtraction = { from: string; to: string; energyKwh: number | null; amountEur: number | null; fixedEur: number | null; emissionsKg: number | null; co2CostEur: number | null }`
  - `type FuelInvoiceExtraction = { vendor?: string; invoiceDate?: string; deliveredAt?: string; periodStart?: string; periodEnd?: string; totalGrossEur: number | null; fixedEur: number | null; quantity: number | null; quantityUnit: FuelQuantityUnit | null; energyKwh: number | null; gasBasis: GasBasis | null; heatingValue: number | null; emissionsKg: number | null; co2CostEur: number | null; co2CostNet: boolean; emissionFactor: number | null; bioCostEur: number | null; parts: FuelInvoicePartExtraction[]; amountsAdjusted?: 'netto'; amountsNetUnadjusted: boolean }`
  - `type ServiceExtractResult = { file: string; extraction: ServiceStatementExtraction }`, `type FuelExtractResult = { file: string; extraction: FuelInvoiceExtraction }`
- Produces (server): `export async function ask(…)` (bisher Datei-intern);
  `export function documentMaterial(filePath: string, mimetype: string, input: { pdfText?: string; pages?: ProviderImage[] }, label: { text: string; noun: string }): { suffix: string; images: ProviderImage[] }`;
  `TIMEOUT_SECONDS` kennt `serviceStatement` und `fuelInvoice`; aus invoiceAmounts.ts exportiert
  `vatExplainsGap`, `rateDate`, `tolerance`.

- [ ] **Step 1: Write the failing test**

`server/test/extract.test.ts`: Import um `documentMaterial` ergänzen; ans Dateiende:

```ts
// ---------- Text und Seitenbilder (Heizung PR 20) ----------

test('Material eines Belegs: Textebene vor Bildern, Scan mit höchstens vier Seiten, Bezeichnung je Belegart', () => {
  const text = 'x'.repeat(100)
  const pdf = documentMaterial('/gibt/es/nicht.pdf', 'application/pdf', { pdfText: text, pages: [{ mimeType: 'image/jpeg', data: 'a' }] }, { text: 'ABRECHNUNGSTEXT', noun: 'Die Abrechnung' })
  assert.equal(pdf.images.length, 0)
  assert.match(pdf.suffix, /--- ABRECHNUNGSTEXT ---\nx{100}/)
  const pages = [1, 2, 3, 4, 5].map((n) => ({ mimeType: 'image/jpeg', data: String(n) }))
  const scan = documentMaterial('/gibt/es/nicht.pdf', 'application/pdf', { pdfText: 'kurz', pages }, { text: 'RECHNUNGSTEXT', noun: 'Die Rechnung' })
  assert.deepEqual(scan.images.map((p) => p.data), ['1', '2', '3', '4'])
  assert.match(scan.suffix, /Die Rechnung ist als Bild\(er\) angehängt/)
  assert.throws(() => documentMaterial('/gibt/es/nicht.pdf', 'application/pdf', {}, { text: 'X', noun: 'Die Rechnung' }), /keine lesbare Textebene/)
  assert.throws(() => documentMaterial('/gibt/es/nicht.txt', 'text/plain', {}, { text: 'X', noun: 'Die Rechnung' }), /Dateityp text\/plain wird nicht unterstützt/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/extract.test.ts`
Expected: FAIL: `documentMaterial` ist kein Export.

- [ ] **Step 3: Typen (`shared/types.ts`)**

Hinter `IntakeResult`:

```ts
// ---------- KI: Messdienstabrechnung und Lieferantenrechnung (Heizung PR 20, #103) ----------
//
// Was der Browser aus der Auswertung bekommt, mit engen Typen. Die rohe Antwort des Modells sieht der
// Browser nie; die Zusage entsteht in server/src/extractHeating.ts (`toServiceExtraction`,
// `toFuelExtraction`). Alles ist ein Vorschlag: Ein Mensch prüft und speichert über die bestehenden Routen.

// Eine Nutzerzeile eines Kostenblocks: Name und Lage, wie gedruckt, der Nutzungszeitraum, falls gedruckt,
// und der Betrag („Ihre Kosten“). `vacancy`: die Abrechnung nennt die Zeile Leerstand.
export type ServiceUserLine = { label: string; unitLabel: string | null; from: string | null; to: string | null; amountEur?: number; vacancy: boolean }

// Ein Kostenblock der Abrechnung (Heizung und Warmwasser, Kaltwasser, …) mit der Kostenart aus der Liste
// der Kostenarten und der gedruckten Summe der Nutzerkosten des Blocks.
export type ServiceBlock = { title: string; category: string; totalEur?: number; lines: ServiceUserLine[] }

// Der CO₂-Block (§ 7 Abs. 3 CO2KostAufG), wie der Messdienst ihn druckt. `landlordPercent` in Prozent.
export type ServiceCo2Extraction = { emissionsKg: number | null; areaM2: number | null; kgPerM2: number | null; landlordPercent: number | null; totalEur: number | null; landlordEur: number | null }

// Die Heiz- und Warmwasserkostenabrechnung eines Messdienstes oder einer Gemeinschaft. `usersTotalEur` ist S,
// die gedruckte Summe der zu verteilenden Heiz- und Warmwasserkosten (Entwurf 5.5); `deductionEur` der Betrag
// der Zeile „Abzüglich CO₂-Kosten Vermieter“, positiv, oder null ohne eine solche Zeile.
export type ServiceStatementExtraction = {
  vendor?: string
  periodStart?: string
  periodEnd?: string
  unitsCount: number | null
  usersTotalEur: number | null
  deductionEur: number | null
  co2: ServiceCo2Extraction | null
  dhwMethod: DhwMethod | null
  blocks: ServiceBlock[]
}

// Eine Teilmenge laut Rechnung (Entwurf 3.2 Stufe 3): Teilzeitraum mit Energie und Betrag, brutto.
export type FuelInvoicePartExtraction = { from: string; to: string; energyKwh: number | null; amountEur: number | null; fixedEur: number | null; emissionsKg: number | null; co2CostEur: number | null }

// Die Rechnung eines Brennstoff- oder Wärmelieferanten mit den Angaben nach § 3 Abs. 1 Nr. 1–4 und 6
// CO2KostAufG. `co2CostNet`: die Rechnung nennt den Preisbestandteil ohne Umsatzsteuer (§ 3 Abs. 3 verlangt
// ihn mit). `amountsAdjusted`: Mietfuchs hat Netto-Teilmengen anteilig auf den Rechnungsbetrag hochgerechnet;
// `amountsNetUnadjusted`: das Modell meldete netto, hochgerechnet wurde aber nicht.
export type FuelInvoiceExtraction = {
  vendor?: string
  invoiceDate?: string
  deliveredAt?: string
  periodStart?: string
  periodEnd?: string
  totalGrossEur: number | null
  fixedEur: number | null
  quantity: number | null
  quantityUnit: FuelQuantityUnit | null
  energyKwh: number | null
  gasBasis: GasBasis | null
  heatingValue: number | null
  emissionsKg: number | null
  co2CostEur: number | null
  co2CostNet: boolean
  emissionFactor: number | null
  bioCostEur: number | null
  parts: FuelInvoicePartExtraction[]
  amountsAdjusted?: 'netto'
  amountsNetUnadjusted: boolean
}

export type ServiceExtractResult = { file: string; extraction: ServiceStatementExtraction }
export type FuelExtractResult = { file: string; extraction: FuelInvoiceExtraction }
```

- [ ] **Step 4: `server/src/extract.ts` freigeben**

`TIMEOUT_SECONDS` ersetzen durch:

```ts
const TIMEOUT_SECONDS: Record<string, number> = { extraction: 1200, classification: 180, docType: 600, meterReading: 600, serviceStatement: 1200, fuelInvoice: 1200 }
```

`async function ask(` ersetzen durch `export async function ask(` (Kommentar darüber um den Satz „Auch
extractHeating.ts fragt darüber (Heizung PR 20).“ ergänzen).

Vor `extractFromFile` einfügen:

```ts
// Text und Bilder eines Belegs für den Prompt, für jede Belegart gleich: Ein PDF mit brauchbarer Textebene
// geht als Text, ein Scan mit höchstens vier Seitenbildern, ein Foto als Bild. `label` nennt die Belegart im
// Prompt („RECHNUNGSTEXT“, „Die Rechnung“).
export function documentMaterial(
  filePath: string,
  mimetype: string,
  { pdfText = '', pages = [] }: { pdfText?: string; pages?: ProviderImage[] },
  label: { text: string; noun: string },
): { suffix: string; images: ProviderImage[] } {
  if (mimetype === 'application/pdf') {
    const text = String(pdfText ?? '').trim()
    if (text.length >= TEXT_MIN) return { suffix: `\n\n--- ${label.text} ---\n${text.slice(0, TEXT_MAX)}`, images: [] }
    if (pages.length > 0) return { suffix: `\n\n${label.noun} ist als Bild(er) angehängt (gescanntes PDF, ggf. mehrseitig).`, images: pages.slice(0, PAGES_MAX) }
    throw new Error(NO_CONTENT)
  }
  if (mimetype.startsWith('image/')) return { suffix: `\n\n${label.noun} ist als Bild angehängt.`, images: [photoOf(filePath, mimetype)] }
  throw new Error(`Dateityp ${mimetype} wird nicht unterstützt (PDF oder Bild).`)
}
```

In `extractFromFile` den Block von `let prompt = PROMPT` bis zum Ende des `if … else`-Zweigs ersetzen durch:

```ts
  const material = documentMaterial(filePath, mimetype, { pdfText, pages }, { text: 'RECHNUNGSTEXT', noun: 'Die Rechnung' })
  const prompt = PROMPT + material.suffix
  const images = material.images
```

Der Wortlaut der Prompts bleibt Zeichen für Zeichen gleich (die api-Tests prüfen `RECHNUNGSTEXT` und die
Bilder).

- [ ] **Step 5: `server/src/invoiceAmounts.ts` exportieren**

`const tolerance =`, `const rateDate =` und `const vatExplainsGap =` je mit `export` versehen; der Kommentar
über `vatExplainsGap` bekommt den Satz „Auch extractHeating.ts prüft damit Netto-Teilmengen einer
Lieferantenrechnung (Heizung PR 20).“

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/extract.test.ts test/invoiceAmounts.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS; die bestehenden KI-Tests bleiben grün.

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts server/src/extract.ts server/src/invoiceAmounts.ts server/test/extract.test.ts
git commit -m "KI: Typen für Messdienst- und Lieferantenrechnung, gemeinsames Material des Belegs

Refs #103"
```

---

### Task 2: Schemas, Prompts und Ausgänge (`server/src/extractHeating.ts`)

**Files:**
- Create: `server/src/extractHeating.ts`, `server/test/extract-heating.test.ts`

**Interfaces:**
- Consumes: Task 1; `EXTRACT_CATEGORIES`, `numberFromModel`, `ask`, `documentMaterial`, `AskOptions`
  (extract.ts); `largestRemainder` (calc.ts); `HEATING_CATEGORY`; `DHW_METHODS` nicht nötig (eigene Liste aus
  `DhwMethod`).
- Produces:
  - `toServiceExtraction(answer: Record<string, unknown>): ServiceStatementExtraction`
  - `toFuelExtraction(answer: Record<string, unknown>, today?: string): FuelInvoiceExtraction`
  - `extractServiceStatement(filePath, mimetype, settings, { pdfText?, pages?, signal?, stats?, onProgress? }): Promise<ServiceStatementExtraction>`
  - `extractFuelInvoice(filePath, mimetype, settings, { … }): Promise<FuelInvoiceExtraction>`
  - `SERVICE_SCHEMA`, `FUEL_SCHEMA` (exportiert für die Tests und den nachgebauten Dienst)

- [ ] **Step 1: Write the failing tests**

`server/test/extract-heating.test.ts`:

```ts
// Was die KI-Auswertung aus der Antwort eines Modells zu einer Messdienstabrechnung und einer
// Lieferantenrechnung übernimmt (Heizung PR 20, #103). Geprüft wird das Einengen an der einen Grenze je
// Belegart, nicht der Weg zum Anbieter (api.test.ts) und nicht die Lesefähigkeit eines Modells (KI-Prüflauf).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FUEL_SCHEMA, SERVICE_SCHEMA, toFuelExtraction, toServiceExtraction } from '../src/extractHeating.ts'

const service = {
  vendor: 'Wärmedienst Beispiel GmbH',
  periodStart: '2025-05-01',
  periodEnd: '2026-04-30',
  unitsCount: 4,
  usersTotalEur: '3.944,50',
  deductionEur: -87.5,
  co2: { emissionsKg: 4456.4, areaM2: 194.6, kgPerM2: 22.9, landlordPercent: 30, totalEur: 291.67, landlordEur: 87.5 },
  dhwMethod: 'volumeFormula',
  blocks: [
    {
      title: 'Heizung und Warmwasser', category: 'Heizung und Warmwasser', totalEur: 3944.5,
      lines: [
        { label: 'Mustermann, Erika', unitLabel: 'EG links', from: '2025-05-01', to: '2026-04-30', amountEur: 1180.25, vacancy: false },
        { label: 'Leerstand', unitLabel: 'EG rechts', from: null, to: null, amountEur: '702,10', vacancy: true },
        { label: 'Beispiel, Max', unitLabel: 'OG links', amountEur: 'eintausend', vacancy: 'ja' },
        'keine Zeile',
      ],
    },
    { title: 'Kaltwasser', category: 'Wasser', totalEur: 1236, lines: [] },
  ],
}

test('Messdienst: Beträge als Text werden gelesen, die Abzugszeile ist positiv, Unbrauchbares fällt weg', () => {
  const x = toServiceExtraction(service)
  assert.equal(x.vendor, 'Wärmedienst Beispiel GmbH')
  assert.deepEqual([x.periodStart, x.periodEnd, x.unitsCount], ['2025-05-01', '2026-04-30', 4])
  assert.equal(x.usersTotalEur, 3944.5)
  assert.equal(x.deductionEur, 87.5)
  assert.deepEqual(x.co2, { emissionsKg: 4456.4, areaM2: 194.6, kgPerM2: 22.9, landlordPercent: 30, totalEur: 291.67, landlordEur: 87.5 })
  assert.equal(x.dhwMethod, 'volumeFormula')
  const [heizung, kalt] = x.blocks
  assert.equal(heizung?.lines.length, 3, 'eine Zeile, die kein Objekt ist, hat keine Felder')
  assert.deepEqual(heizung?.lines[1], { label: 'Leerstand', unitLabel: 'EG rechts', from: null, to: null, amountEur: 702.1, vacancy: true })
  assert.deepEqual(heizung?.lines[2], { label: 'Beispiel, Max', unitLabel: 'OG links', from: null, to: null, vacancy: false }, 'kein Betrag statt eines falschen; „ja“ ist kein Wahrheitswert')
  assert.equal(kalt?.category, '', 'eine Kostenart außerhalb der Liste wird leer, der Mensch wählt')
})

test('Review Focus 2: Abzugszeile als Text mit Minus, als unlesbarer Text, als Null', () => {
  assert.equal(toServiceExtraction({ ...service, deductionEur: '−87,50 €' }).deductionEur, 87.5)
  assert.equal(toServiceExtraction({ ...service, deductionEur: 'siehe Seite 2' }).deductionEur, null)
  assert.equal(toServiceExtraction({ ...service, deductionEur: null }).deductionEur, null)
})

test('Messdienst: Zeitraum nur als Datum, Prozent nur 0 bis 100, Nutzeinheiten nur ganze Zahl ab 1, CO₂-Block ohne Werte ist keiner', () => {
  const x = toServiceExtraction({ ...service, periodStart: '01.05.2025', unitsCount: 2.5, dhwMethod: 'schaetzung', co2: { landlordPercent: 130 } })
  assert.deepEqual([x.periodStart, x.unitsCount, x.dhwMethod, x.co2], [undefined, null, null, null])
  assert.deepEqual(toServiceExtraction({}).blocks, [])
})

test('Messdienst: Felder, die das Modell erfindet, erreichen den Browser nicht', () => {
  const x = toServiceExtraction({ ...service, geheim: 'x', blocks: [{ ...service.blocks[0], extra: 1 }] })
  assert.ok(!('geheim' in x))
  assert.ok(!('extra' in (x.blocks[0] ?? {})))
})

const gas = {
  vendor: 'Stadtwerke Beispielstadt',
  invoiceDate: '2026-03-20',
  periodStart: '2025-03-15',
  periodEnd: '2026-03-14',
  totalGrossEur: 4067.8,
  fixedEur: 207.06,
  quantity: '2.890',
  quantityUnit: 'm³',
  energyKwh: 31285,
  gasBasis: 'Brennwert',
  heatingValue: null,
  emissionsKg: 5674.8,
  co2CostEur: 380.99,
  emissionFactor: 0.20088,
  bioCostEur: null,
  parts: [
    { from: '2025-03-15', to: '2025-12-31', energyKwh: 22410, amountEur: 2885.77, fixedEur: 165.65, emissionsKg: 4065, co2CostEur: 266.05 },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: 8875, amountEur: 1182.03, fixedEur: 41.41, emissionsKg: 1609.8, co2CostEur: 114.94 },
    { from: 'Januar', to: '2026-03-14', amountEur: 1 },
  ],
}

test('Lieferant: Menge mit Einheit, Brennwert als Bezug, Teilmengen nur mit Zeitraum', () => {
  const x = toFuelExtraction(gas, '2026-03-20')
  assert.equal(x.quantity, null, '„2.890“ ist mehrdeutig (zwei Lesarten, Faktor 1000) und bleibt leer')
  assert.equal(x.quantityUnit, 'm3')
  assert.equal(x.gasBasis, 'hs')
  assert.equal(x.heatingValue, null)
  assert.deepEqual([x.emissionsKg, x.co2CostEur, x.emissionFactor, x.energyKwh, x.fixedEur], [5674.8, 380.99, 0.20088, 31285, 207.06])
  assert.equal(x.parts.length, 2)
  assert.deepEqual(x.parts[1], { from: '2026-01-01', to: '2026-03-14', energyKwh: 8875, amountEur: 1182.03, fixedEur: 41.41, emissionsKg: 1609.8, co2CostEur: 114.94 })
  assert.deepEqual([x.co2CostNet, x.amountsAdjusted, x.amountsNetUnadjusted], [false, undefined, false])
})

test('Lieferant: Netto-Teilmengen werden anteilig auf den Rechnungsbetrag hochgerechnet, nur wenn die Umsatzsteuer den Abstand erklärt', () => {
  const netto = { ...gas, amountsAreNet: true, parts: [
    { from: '2025-03-15', to: '2025-12-31', energyKwh: 22410, amountEur: 2425.02, fixedEur: 139.2 },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: 8875, amountEur: 993.3, fixedEur: 34.8 },
  ] }
  const x = toFuelExtraction(netto, '2026-03-20')
  assert.equal(x.amountsAdjusted, 'netto')
  assert.deepEqual(x.parts.map((p) => p.amountEur), [2885.77, 1182.03])
  assert.deepEqual(x.parts.map((p) => p.fixedEur), [165.65, 41.41])
  // Fehlt eine Teilmenge, erklärt die Umsatzsteuer den Abstand nicht: nichts wird hochgerechnet.
  const luecke = toFuelExtraction({ ...netto, parts: [netto.parts[0]] }, '2026-03-20')
  assert.deepEqual([luecke.amountsAdjusted, luecke.amountsNetUnadjusted, luecke.parts[0]?.amountEur], [undefined, true, 2425.02])
})

test('Lieferant: Heizöl mit Heizwert, CO₂-Kosten netto gemeldet, Biobrennstoff, unbekannte Einheit', () => {
  const x = toFuelExtraction({ vendor: 'Heizöl Beispiel', deliveredAt: '2025-10-12', totalGrossEur: 3150, quantity: 3000, quantityUnit: 'Liter', heatingValue: '10,05', energyKwh: 30150, emissionsKg: 8032, co2CostEur: 441.76, co2CostIsNet: true, emissionFactor: 0.2664, bioCostEur: 12.5, parts: 'keine' }, '2025-10-14')
  assert.deepEqual([x.quantity, x.quantityUnit, x.heatingValue, x.co2CostNet, x.bioCostEur, x.parts], [3000, 'l', 10.05, true, 12.5, []])
  assert.equal(toFuelExtraction({ quantityUnit: 'Fass' }).quantityUnit, null)
  assert.equal(toFuelExtraction({ heatingValue: -1 }).heatingValue, null)
})

test('Schemas verlangen das Nötigste und nennen die Felder des Ausgangs', () => {
  assert.deepEqual(SERVICE_SCHEMA.required, ['blocks'])
  assert.ok(Object.keys(SERVICE_SCHEMA.properties).includes('deductionEur'))
  assert.deepEqual(FUEL_SCHEMA.required, ['totalGrossEur'])
  assert.ok(Object.keys(FUEL_SCHEMA.properties).includes('parts'))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/extract-heating.test.ts`
Expected: FAIL: `Cannot find module '../src/extractHeating.ts'`.

- [ ] **Step 3: Implement `server/src/extractHeating.ts`**

```ts
// KI-Auswertung der Heizkostenabrechnung eines Messdienstes und der Rechnung eines Brennstoff- oder
// Wärmelieferanten (Heizung PR 20, #103). Dieselbe Haltung wie extract.ts: Die KI liest, was auf dem Beleg
// steht, ein Mensch prüft es, und Mietfuchs rechnet nichts vor, was nicht dasteht (Entwurf 16).
//
// Die Grenze zwischen roher Antwort und Zusage (#63): Was vom Modell kommt, ist `Record<string, unknown>`;
// was der Browser bekommt, beschreiben `ServiceStatementExtraction` und `FuelInvoiceExtraction` in
// shared/types.ts. Je Belegart gibt es genau einen Ausgang (`toServiceExtraction`, `toFuelExtraction`); nur
// dort entsteht die Zusage. Eingang und Ausgang wie bei Rechnungen braucht es nicht, weil dazwischen nichts
// gerechnet wird außer dem Hochrechnen von Netto-Teilmengen, und das geschieht im Ausgang auf den schon
// gelesenen Zahlen (Plan PR 20, Abweichung 1).
import type {
  AiSettings, DhwMethod, FuelInvoiceExtraction, FuelInvoicePartExtraction, FuelQuantityUnit, GasBasis,
  ServiceBlock, ServiceCo2Extraction, ServiceStatementExtraction, ServiceUserLine,
} from '../../shared/types.ts'
import { valueAt } from '../../shared/law/register.ts'
import { ustgStandardRate } from '../../shared/law/ustg.ts'
import type { ProviderImage } from './ai/index.ts'
import { largestRemainder } from './calc.ts'
import { ask, documentMaterial, EXTRACT_CATEGORIES, numberFromModel, type AskOptions } from './extract.ts'
import { rateDate, tolerance, vatExplainsGap } from './invoiceAmounts.ts'

type AiCapableSettings = { ai: AiSettings }

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v.trim() || undefined : undefined)
const textOrEmpty = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const day = (v: unknown): string | undefined => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : undefined)
// Eine Zahl, auch als Text in deutscher oder technischer Schreibweise (numberFromModel). Das typografische
// Minus „−“ (U+2212) liest ein Modell aus gedruckten Abrechnungen mit; es wird zum Bindestrich.
const num = (v: unknown): number | null => numberFromModel(typeof v === 'string' ? v.replace(/−/g, '-') : v)
const positive = (v: unknown): number | null => {
  const n = num(v)
  return n !== null && n > 0 ? n : null
}
const notNegative = (v: unknown): number | null => {
  const n = num(v)
  return n !== null && n >= 0 ? n : null
}
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null)

// ---------- Messdienst ----------

const DHW: readonly DhwMethod[] = ['heatMeter', 'volumeFormula', 'areaFormula']

export const SERVICE_SCHEMA = {
  type: 'object',
  properties: {
    vendor: { type: 'string', description: 'Messdienst oder Hausverwaltung, die die Abrechnung erstellt hat' },
    periodStart: { type: ['string', 'null'], description: 'Beginn des Abrechnungszeitraums als YYYY-MM-DD' },
    periodEnd: { type: ['string', 'null'], description: 'Ende des Abrechnungszeitraums als YYYY-MM-DD' },
    unitsCount: { type: ['number', 'null'], description: 'Zahl der Nutzeinheiten der Liegenschaft' },
    usersTotalEur: { type: ['number', 'null'], description: 'Gedruckte Summe der zu verteilenden Kosten Heizung und Warmwasser (bei einer Abzugszeile der Betrag nach dem Abzug)' },
    deductionEur: { type: ['number', 'null'], description: 'Betrag der Zeile „Abzüglich CO₂-Kosten Vermieter“ als positive Zahl, sonst null' },
    co2: {
      type: ['object', 'null'],
      properties: {
        emissionsKg: { type: ['number', 'null'] },
        areaM2: { type: ['number', 'null'] },
        kgPerM2: { type: ['number', 'null'] },
        landlordPercent: { type: ['number', 'null'] },
        totalEur: { type: ['number', 'null'] },
        landlordEur: { type: ['number', 'null'] },
      },
    },
    dhwMethod: { type: ['string', 'null'], enum: [...DHW, null] },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          category: { type: 'string', enum: EXTRACT_CATEGORIES },
          totalEur: { type: ['number', 'null'] },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Name des Nutzers, wie gedruckt' },
                unitLabel: { type: ['string', 'null'], description: 'Lage oder Nummer der Nutzeinheit' },
                from: { type: ['string', 'null'], description: 'Nutzungsbeginn YYYY-MM-DD, falls gedruckt' },
                to: { type: ['string', 'null'], description: 'Nutzungsende YYYY-MM-DD, falls gedruckt' },
                amountEur: { type: ['number', 'null'], description: 'Kosten dieses Nutzers in diesem Block' },
                vacancy: { type: 'boolean', description: 'true, wenn die Zeile Leerstand ist' },
              },
              required: ['label', 'amountEur'],
            },
          },
        },
        required: ['title', 'category', 'lines'],
      },
    },
  },
  required: ['blocks'],
}

const SERVICE_PROMPT = `Du bist ein Assistent für die Nebenkostenabrechnung eines privaten Vermieters in Deutschland.
Dir liegt die Heiz- und Warmwasserkostenabrechnung eines Messdienstes (etwa Techem, ista, Brunata, Minol, KALO) oder einer Hausverwaltung vor. Lies die Werte so, wie sie gedruckt sind, und gib sie als JSON zurück. Rechne nichts um.

- "periodStart"/"periodEnd": der Abrechnungszeitraum der Liegenschaft.
- "unitsCount": die Zahl der Nutzeinheiten der Liegenschaft, wenn sie genannt ist.
- "usersTotalEur": die gedruckte Summe der zu verteilenden Heiz- und Warmwasserkosten aller Nutzer, etwa "Summe der Nutzerkosten Heizungsanlage" oder "zu verteilende Kosten". Steht darüber eine Zeile wie "Abzüglich CO₂-Kosten Vermieter", ist es die Summe nach diesem Abzug.
- "deductionEur": den Betrag der Zeile "Abzüglich CO₂-Kosten Vermieter" (oder gleichbedeutend) als positive Zahl. Gibt es keine solche Zeile, null. Beträge, die bei einzelnen Mietern als "vom Vermieter übernommen" stehen, gehören nicht hierher.
- "co2": der CO₂-Block: CO₂-Ausstoß der Liegenschaft in kg ("emissionsKg"), die Fläche dafür in m² ("areaM2"), der Ausstoß je m² und Jahr ("kgPerM2"), der Anteil des Vermieters in Prozent ("landlordPercent"), die CO₂-Kosten insgesamt ("totalEur") und davon der Anteil des Vermieters in Euro ("landlordEur"). Gibt es keinen CO₂-Block, null.
- "dhwMethod": wie der Wärmeanteil für Warmwasser ermittelt wurde: "heatMeter", wenn er mit einem Wärmezähler gemessen wurde; "volumeFormula", wenn er nach § 9 Abs. 2 Satz 2 HeizkostenV aus dem Warmwasservolumen errechnet wurde; "areaFormula", wenn er nach § 9 Abs. 2 Satz 4 aus der Wohnfläche errechnet wurde. Steht dazu nichts da, null.
- "blocks": je Kostenblock (Heizung und Warmwasser, Kaltwasser und Abwasser, Hausstrom, …) ein Eintrag mit Überschrift ("title"), Kostenart ("category", GENAU eine aus der Liste: ${EXTRACT_CATEGORIES.map((c) => `"${c}"`).join(', ')}), der gedruckten Summe der Nutzerkosten des Blocks ("totalEur") und einer Zeile je Nutzer ("lines"): Name, wie gedruckt ("label"), Lage oder Nummer der Nutzeinheit ("unitLabel"), Nutzungszeitraum, falls gedruckt ("from", "to" als YYYY-MM-DD), die Kosten dieses Nutzers in diesem Block ("amountEur"; bei Heizung und Warmwasser die Summe aus Heiz- und Warmwasserkosten des Nutzers) und "vacancy": true, wenn die Zeile Leerstand ist.
- Beträge in Euro mit Dezimalpunkt, so wie gedruckt. Datumsangaben als YYYY-MM-DD.`

function lineOf(l: Record<string, unknown>): ServiceUserLine {
  const amount = num(l.amountEur)
  return {
    label: textOrEmpty(l.label),
    unitLabel: text(l.unitLabel) ?? null,
    from: day(l.from) ?? null,
    to: day(l.to) ?? null,
    ...(amount !== null ? { amountEur: amount } : {}),
    vacancy: l.vacancy === true,
  }
}

function blockOf(b: Record<string, unknown>): ServiceBlock {
  const total = num(b.totalEur)
  const lines = Array.isArray(b.lines) ? b.lines.filter(isObject).map(lineOf) : []
  return {
    title: textOrEmpty(b.title),
    category: oneOf(EXTRACT_CATEGORIES, b.category) ?? '',
    ...(total !== null ? { totalEur: total } : {}),
    lines,
  }
}

function co2Of(v: unknown): ServiceCo2Extraction | null {
  if (!isObject(v)) return null
  const percent = num(v.landlordPercent)
  const c: ServiceCo2Extraction = {
    emissionsKg: notNegative(v.emissionsKg),
    areaM2: positive(v.areaM2),
    kgPerM2: notNegative(v.kgPerM2),
    landlordPercent: percent !== null && percent >= 0 && percent <= 100 ? percent : null,
    totalEur: notNegative(v.totalEur),
    landlordEur: notNegative(v.landlordEur),
  }
  return Object.values(c).every((x) => x === null) ? null : c
}

// Ausgang Messdienst: hier entsteht die Zusage an den Browser, und nur hier.
export function toServiceExtraction(answer: Record<string, unknown>): ServiceStatementExtraction {
  const units = num(answer.unitsCount)
  const deduction = num(answer.deductionEur)
  return {
    vendor: text(answer.vendor),
    periodStart: day(answer.periodStart),
    periodEnd: day(answer.periodEnd),
    unitsCount: units !== null && Number.isInteger(units) && units >= 1 ? units : null,
    usersTotalEur: notNegative(answer.usersTotalEur),
    // Die Zeile steht mit Minus da; gemeint ist der Betrag (Review Focus 2).
    deductionEur: deduction === null ? null : Math.abs(deduction),
    co2: co2Of(answer.co2),
    dhwMethod: oneOf(DHW, answer.dhwMethod),
    blocks: Array.isArray(answer.blocks) ? answer.blocks.filter(isObject).map(blockOf) : [],
  }
}

// ---------- Lieferant ----------

export const FUEL_SCHEMA = {
  type: 'object',
  properties: {
    vendor: { type: 'string' },
    invoiceDate: { type: ['string', 'null'], description: 'Rechnungsdatum YYYY-MM-DD' },
    deliveredAt: { type: ['string', 'null'], description: 'Lieferdatum YYYY-MM-DD (Öl, Pellets, Flüssiggas)' },
    periodStart: { type: ['string', 'null'], description: 'Beginn des Abrechnungs- oder Lieferzeitraums YYYY-MM-DD (Gas, Fernwärme, Strom)' },
    periodEnd: { type: ['string', 'null'], description: 'Ende des Abrechnungs- oder Lieferzeitraums YYYY-MM-DD' },
    totalGrossEur: { type: 'number', description: 'Rechnungsbetrag der Lieferung brutto, vor Abzug geleisteter Abschläge' },
    fixedEur: { type: ['number', 'null'], description: 'Grund-, Leistungs-, Mess- und Verrechnungspreise zusammen, brutto' },
    amountsAreNet: { type: ['boolean', 'null'], description: 'true, wenn die Teilmengen nur netto ausgewiesen sind' },
    quantity: { type: ['number', 'null'] },
    quantityUnit: { type: ['string', 'null'], enum: ['l', 'kg', 'm3', 'kWh', 'srm', null] },
    energyKwh: { type: ['number', 'null'], description: 'Energiegehalt in kWh (§ 3 Abs. 1 Nr. 4 CO2KostAufG)' },
    gasBasis: { type: ['string', 'null'], enum: ['hs', 'hi', null], description: 'hs = Brennwert, hi = Heizwert, nur bei Gas' },
    heatingValue: { type: ['number', 'null'], description: 'Heizwert in kWh je Liter, kg oder m³, nur wenn ausdrücklich als Heizwert genannt' },
    emissionsKg: { type: ['number', 'null'], description: 'Brennstoffemissionen in kg CO₂ (§ 3 Abs. 1 Nr. 1)' },
    co2CostEur: { type: ['number', 'null'], description: 'Preisbestandteil der Kohlendioxidkosten (§ 3 Abs. 1 Nr. 2)' },
    co2CostIsNet: { type: ['boolean', 'null'], description: 'true, wenn dieser Preisbestandteil ohne Umsatzsteuer genannt ist' },
    emissionFactor: { type: ['number', 'null'], description: 'heizwertbezogener Emissionsfaktor in kg CO₂/kWh (§ 3 Abs. 1 Nr. 3)' },
    bioCostEur: { type: ['number', 'null'], description: 'Preisbestandteil für den nach § 43 GModG anteilig zu nutzenden Brennstoff (§ 3 Abs. 1 Nr. 6), sonst null' },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' }, to: { type: 'string' }, energyKwh: { type: ['number', 'null'] }, amountEur: { type: ['number', 'null'] },
          fixedEur: { type: ['number', 'null'] }, emissionsKg: { type: ['number', 'null'] }, co2CostEur: { type: ['number', 'null'] },
        },
        required: ['from', 'to'],
      },
    },
  },
  required: ['totalGrossEur'],
}

const FUEL_PROMPT = `Du bist ein Assistent für die Nebenkostenabrechnung eines privaten Vermieters in Deutschland.
Dir liegt die Rechnung eines Lieferanten für Brennstoff oder Wärme vor (Erdgas, Fernwärme, Heizöl, Flüssiggas, Pellets, Strom für eine Wärmepumpe). Lies die Werte so, wie sie gedruckt sind, und gib sie als JSON zurück. Rechne nichts um und ergänze nichts, was nicht dasteht.

- "totalGrossEur": der Rechnungsbetrag der Lieferung brutto, VOR Abzug geleisteter Abschläge. Nicht die Nachzahlung und nicht das Guthaben.
- "periodStart"/"periodEnd" bei Gas, Fernwärme und Strom den Abrechnungszeitraum; "deliveredAt" bei Öl, Pellets und Flüssiggas den Liefertag.
- "fixedEur": Grund-, Leistungs-, Mess- und Verrechnungspreise zusammen, brutto, wenn gesondert ausgewiesen.
- "parts": Weist die Rechnung Teilzeiträume mit eigener Menge und eigenem Betrag aus (etwa bei einer Preisänderung), je Teilzeitraum ein Eintrag mit "from", "to", Energie in kWh, Betrag brutto, Grundpreis brutto, CO₂ in kg und CO₂-Kosten. Sind die Beträge der Teilzeiträume nur netto ausgewiesen, gib sie netto an und setze "amountsAreNet" auf true. Gibt es keine Teilzeiträume, eine leere Liste.
- "quantity"/"quantityUnit": die gelieferte Menge mit Einheit ("l", "kg", "m3", "kWh" oder "srm").
- Die Angaben nach § 3 Abs. 1 CO2KostAufG stehen oft in einem eigenen Kasten: Brennstoffemissionen in kg CO₂ ("emissionsKg"), Preisbestandteil der Kohlendioxidkosten ("co2CostEur"; steht er ausdrücklich ohne Umsatzsteuer da, setze "co2CostIsNet" auf true), heizwertbezogener Emissionsfaktor in kg CO₂/kWh ("emissionFactor"), Energiegehalt in kWh ("energyKwh"), Preisbestandteil für Biobrennstoff nach § 43 GModG ("bioCostEur", sonst null).
- "gasBasis" nur bei Gas: "hs", wenn die kWh nach dem Brennwert berechnet sind, "hi" nach dem Heizwert.
- "heatingValue": nur, wenn die Rechnung ausdrücklich einen Heizwert in kWh je Liter, kg oder m³ nennt. Ein Brennwert ist kein Heizwert.
- Beträge in Euro mit Dezimalpunkt, Datumsangaben als YYYY-MM-DD.`

const UNIT_WORDS: Readonly<Record<string, FuelQuantityUnit>> = {
  l: 'l', liter: 'l', ltr: 'l', kg: 'kg', kilogramm: 'kg', m3: 'm3', 'm³': 'm3', cbm: 'm3', kubikmeter: 'm3', kwh: 'kWh', srm: 'srm', schüttraummeter: 'srm',
}
const unitOf = (v: unknown): FuelQuantityUnit | null => (typeof v === 'string' ? UNIT_WORDS[v.trim().toLowerCase()] ?? null : null)
const basisOf = (v: unknown): GasBasis | null => {
  if (typeof v !== 'string') return null
  const t = v.trim().toLowerCase()
  return t === 'hs' || t === 'brennwert' ? 'hs' : t === 'hi' || t === 'heizwert' ? 'hi' : null
}

function partOf(p: Record<string, unknown>): FuelInvoicePartExtraction | null {
  const from = day(p.from)
  const to = day(p.to)
  if (!from || !to || from > to) return null
  return { from, to, energyKwh: notNegative(p.energyKwh), amountEur: num(p.amountEur), fixedEur: notNegative(p.fixedEur), emissionsKg: notNegative(p.emissionsKg), co2CostEur: num(p.co2CostEur) }
}

const toCents = (eur: number | null): number | null => (eur === null ? null : Math.round(eur * 100))

// Netto-Teilmengen anteilig auf den Rechnungsbetrag, nach derselben Regel wie normalizeAmounts (#34): nur,
// wenn jede Teilmenge einen Betrag hat und die Umsatzsteuer den Abstand erklärt. Der Grundpreis je Teilmenge
// und der Grundpreis der Rechnung bekommen denselben Faktor.
function grossUp(x: FuelInvoiceExtraction, net: boolean, today: string): FuelInvoiceExtraction {
  if (!net) return x
  const total = toCents(x.totalGrossEur) ?? 0
  const nets = x.parts.map((p) => toCents(p.amountEur))
  const read = nets.filter((c): c is number => c !== null)
  const sum = read.reduce((a, b) => a + b, 0)
  const rate = valueAt(ustgStandardRate, rateDate(x.invoiceDate, today))
  const ok = x.parts.length > 0 && read.length === nets.length && sum < total - tolerance(total) && vatExplainsGap(sum, total, rate)
  if (!ok) return { ...x, amountsNetUnadjusted: true }
  const factor = total / sum
  const gross = largestRemainder(total, read.map((c) => c * factor), x.parts.map((_, i) => String(i)))
  const scale = (eur: number | null): number | null => (eur === null ? null : Math.round(eur * 100 * factor) / 100)
  return {
    ...x,
    fixedEur: scale(x.fixedEur),
    parts: x.parts.map((p, i) => ({ ...p, amountEur: (gross[i] ?? 0) / 100, fixedEur: scale(p.fixedEur) })),
    amountsAdjusted: 'netto',
  }
}

// Ausgang Lieferant: hier entsteht die Zusage an den Browser, und nur hier. `today` als JJJJ-MM-TT für den
// Regelsatz der Umsatzsteuer ohne Rechnungsdatum (wie normalizeAmounts).
export function toFuelExtraction(answer: Record<string, unknown>, today: string = new Date().toISOString().slice(0, 10)): FuelInvoiceExtraction {
  const parts = Array.isArray(answer.parts) ? answer.parts.filter(isObject).map(partOf).filter((p): p is FuelInvoicePartExtraction => p !== null) : []
  const base: FuelInvoiceExtraction = {
    vendor: text(answer.vendor),
    invoiceDate: day(answer.invoiceDate),
    deliveredAt: day(answer.deliveredAt),
    periodStart: day(answer.periodStart),
    periodEnd: day(answer.periodEnd),
    totalGrossEur: num(answer.totalGrossEur),
    fixedEur: notNegative(answer.fixedEur),
    quantity: positive(answer.quantity),
    quantityUnit: unitOf(answer.quantityUnit),
    energyKwh: positive(answer.energyKwh),
    gasBasis: basisOf(answer.gasBasis),
    heatingValue: positive(answer.heatingValue),
    emissionsKg: notNegative(answer.emissionsKg),
    co2CostEur: num(answer.co2CostEur),
    co2CostNet: answer.co2CostIsNet === true,
    emissionFactor: positive(answer.emissionFactor),
    bioCostEur: num(answer.bioCostEur),
    parts,
    amountsNetUnadjusted: false,
  }
  return grossUp(base, answer.amountsAreNet === true, today)
}

// ---------- Auswertung ----------

type Input = { pdfText?: string; pages?: ProviderImage[] } & AskOptions

export async function extractServiceStatement(filePath: string, mimetype: string, settings: AiCapableSettings, { pdfText, pages, ...options }: Input = {}): Promise<ServiceStatementExtraction> {
  const material = documentMaterial(filePath, mimetype, { pdfText, pages }, { text: 'ABRECHNUNGSTEXT', noun: 'Die Abrechnung' })
  const answer = await ask(settings, 'serviceStatement', { prompt: SERVICE_PROMPT + material.suffix, images: material.images, schema: SERVICE_SCHEMA }, options)
  return toServiceExtraction(answer)
}

export async function extractFuelInvoice(filePath: string, mimetype: string, settings: AiCapableSettings, { pdfText, pages, ...options }: Input = {}): Promise<FuelInvoiceExtraction> {
  const material = documentMaterial(filePath, mimetype, { pdfText, pages }, { text: 'RECHNUNGSTEXT', noun: 'Die Rechnung' })
  const answer = await ask(settings, 'fuelInvoice', { prompt: FUEL_PROMPT + material.suffix, images: material.images, schema: FUEL_SCHEMA }, options)
  return toFuelExtraction(answer)
}
```

Hinweis zur Typzusicherung in `oneOf`: `v as T` steht erst nach der Prüfung, dass `v` in `list` vorkommt; das
ist eine Einengung und keine Behauptung über einen Modellwert. Lässt sich das mit einem Typprädikat
schreiben, ohne die Lesbarkeit zu verlieren, diese Form nehmen.

Hinweis zum Test „2.890“: `numberFromModel` liest „2.890“ bewusst nicht (mehrdeutig, extract.ts). Die
erfundene Gasrechnung (Task 7) druckt die Menge deshalb als „2 890 m³“ mit Leerzeichen, wie viele Versorger,
und die Erwartung des Prüflaufs ist 2890.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/extract-heating.test.ts test/law-literals.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS. (`law-literals.test.ts` prüft extractHeating.ts nicht; die Prompts sind ausgenommen.)

- [ ] **Step 5: Commit**

```bash
git add server/src/extractHeating.ts server/test/extract-heating.test.ts
git commit -m "KI: Schemas, Prompts und Ausgänge für Messdienst- und Lieferantenrechnung

Je Belegart eine Grenze zwischen roher Antwort und Zusage; Netto-
Teilmengen anteilig hochgerechnet wie bei Rechnungen (#34).

Refs #103"
```

---

### Task 3: Routen und Fortschritt

**Files:**
- Modify: `server/src/index.ts`, `server/test/api.test.ts`, `client/src/aiRequest.ts`, `client/src/aiRequest.test.ts`

**Interfaces:**
- Consumes: Task 1, 2; `readHeatingPlants` (read.ts), `NO_PLANT`.
- Produces: `POST /api/heating-plants/:id/service-statement` → `ServiceExtractResult` (Strom oder JSON),
  `POST /api/heating-plants/:id/fuel-invoice` → `FuelExtractResult`; `AiStep` kennt `serviceStatement`,
  `fuelInvoice`.

- [ ] **Step 1: Write the failing tests**

`server/test/api.test.ts`: In `fakeOllama` die Auswahl der Antwort (`const content = JSON.stringify(…)`)
vorn um zwei Fälle ergänzen, erkannt am Schema wie `docType`:

```ts
      const content = JSON.stringify(
        json.format?.properties?.blocks
          ? FAKE_SERVICE
          : json.format?.properties?.parts
            ? FAKE_FUEL
            : json.format?.properties?.docType
```

(der Rest der bestehenden Kette bleibt unverändert dahinter). Ist `OllamaBody.format` dort eng getypt (mit
den bekannten Feldern `docType`, `meterNumber`, `categories`), um `blocks?: unknown` und `parts?: unknown`
ergänzen. Über `fakeOllama` die beiden Antworten:

```ts
// Heizung PR 20: Antworten des nachgebauten Dienstes für Messdienst- und Lieferantenrechnung.
const FAKE_SERVICE = {
  vendor: 'Wärmedienst Beispiel GmbH', periodStart: '2025-05-01', periodEnd: '2026-04-30', unitsCount: 4,
  usersTotalEur: 3944.5, deductionEur: '-87,50', co2: { landlordPercent: 30, totalEur: 291.67, landlordEur: 87.5 }, dhwMethod: 'volumeFormula',
  blocks: [{ title: 'Heizung und Warmwasser', category: 'Heizung und Warmwasser', totalEur: 3944.5, lines: [{ label: 'Mustermann, Erika', amountEur: 1180.25, vacancy: false }] }],
}
const FAKE_FUEL = { vendor: 'Stadtwerke Beispielstadt', totalGrossEur: 4067.8, quantityUnit: 'm³', parts: [] }
```

Ans Dateiende:

```ts
// ---------- KI: Messdienst und Lieferant (Heizung PR 20) ----------

test('KI: Messdienstabrechnung an der Anlage mit Messdienst; Antwort eingeengt; nichts gespeichert', async () => {
  await withOllama(async (s, ollama) => {
    const send = (p: string, init: RequestInit) => fetch(`${s.base}${p}`, { headers: { 'content-type': 'application/json' }, ...init })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', { method: 'POST', body: JSON.stringify({ energy: 'gas', method: 'service' }) }))
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'messdienst.pdf')
    fd.append('pdfText', LONG_TEXT)
    const res = await fetch(`${s.base}/api/heating-plants/${plant.id}/service-statement`, { method: 'POST', body: fd })
    assert.equal(res.status, 200)
    const body = await jsonOf<ServiceExtractResult>(res)
    assert.equal(body.extraction.deductionEur, 87.5)
    assert.equal(body.extraction.dhwMethod, 'volumeFormula')
    assert.match(firstMessage(ollama).content, /ABRECHNUNGSTEXT/)
    const items = await s.api<unknown[]>('/api/costItems')
    assert.deepEqual(items, [], 'die Auswertung legt keine Position an')
  })
})

test('KI: Lieferantenrechnung; Messdienstabrechnung bei freien Schlüsseln 400; unbekannte Anlage 404 ohne liegengebliebenen Beleg', async () => {
  await withOllama(async (s) => {
    const send = (p: string, init: RequestInit) => fetch(`${s.base}${p}`, { headers: { 'content-type': 'application/json' }, ...init })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', { method: 'POST', body: JSON.stringify({ energy: 'gas', method: 'manual' }) }))
    const upload = async (route: string) => {
      const fd = new FormData()
      fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'beleg.pdf')
      fd.append('pdfText', LONG_TEXT)
      return fetch(`${s.base}${route}`, { method: 'POST', body: fd })
    }
    const gas = await upload(`/api/heating-plants/${plant.id}/fuel-invoice`)
    assert.equal(gas.status, 200)
    assert.equal((await jsonOf<FuelExtractResult>(gas)).extraction.quantityUnit, 'm3')
    const falsch = await upload(`/api/heating-plants/${plant.id}/service-statement`)
    assert.equal(falsch.status, 400)
    assert.match((await jsonOf<{ error: string }>(falsch)).error, /nur bei einer Heizanlage, die ein Messdienst oder die Gemeinschaft abrechnet/)
    const vorher = (await s.api<unknown[]>('/api/uploads')).length
    assert.equal((await upload('/api/heating-plants/gibt-es-nicht/fuel-invoice')).status, 404)
    assert.equal((await s.api<unknown[]>('/api/uploads')).length, vorher, 'der Beleg einer abgelehnten Anfrage bleibt nicht liegen')
  })
})
```

(`HeatingPlant`, `ServiceExtractResult`, `FuelExtractResult` zum Typimport aus `'../../shared/types.ts'`
ergänzen. Liefert `GET /api/uploads` ein Objekt statt einer Liste, die Länge seiner Liste vergleichen.)

`client/src/aiRequest.test.ts` anhängen (Import um `progressText` ergänzen, falls nicht da):

```ts
test('Fortschritt der neuen Belegarten (Heizung PR 20)', () => {
  expect(progressText({ step: 'serviceStatement', phase: 'waiting' })).toBe('Modell liest die Abrechnung …')
  expect(progressText({ step: 'fuelInvoice', phase: 'writing', chars: 1200 })).toBe('Modell schreibt die Auswertung (1.200 Zeichen) …')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/api.test.ts && npm --prefix client test -- aiRequest`
Expected: FAIL: Die Routen antworten 404; `progressText` kennt die Schritte nicht (Übersetzer).

- [ ] **Step 3: Routen (`server/src/index.ts`)**

Import: `import { extractFuelInvoice, extractServiceStatement } from './extractHeating.ts'`; `readHeatingPlants`
aus `'./db/read.ts'` (falls nicht importiert). Hinter der Route `/api/intake`:

```ts
// ---------- KI: Messdienstabrechnung und Lieferantenrechnung (Heizung PR 20, #103) ----------
//
// Beide Routen antworten wie /api/extract (Strom mit Fortschritt, Abbruch über die Kennung) und speichern
// nichts außer dem Beleg im Belegarchiv: Was die KI liest, ist ein Vorschlag, den die Seite Heizkosten zeigt;
// übernommen wird über die bestehenden Routen, wenn der Vermieter es will.
const discardUpload = (req: Request): void => {
  const f = uploadedFile(req)
  if (f) fs.rmSync(f.path, { force: true })
}
async function plantForAi(req: Request, res: Response): Promise<HeatingPlant | null> {
  const plant = await readData(async (db) => (await readHeatingPlants(db)).find((p) => p.id === req.params.id) ?? null)
  if (!plant) {
    discardUpload(req)
    res.status(404).json({ error: NO_PLANT })
  }
  return plant
}

app.post('/api/heating-plants/:id/service-statement', fileWithPages, async (req: Request, res: Response) => {
  const plant = await plantForAi(req, res)
  if (!plant) return
  if (plant.method !== 'service') {
    discardUpload(req)
    return res.status(400).json({ error: 'Eine Messdienstabrechnung lässt sich nur bei einer Heizanlage, die ein Messdienst oder die Gemeinschaft abrechnet, übernehmen. Stellen Sie das unter Stammdaten bei der Heizung ein.' })
  }
  const file = await documentOf(req, res)
  if (!file) return
  const answer = aiResponse(req, res)
  const { signal, stats, onProgress } = answer
  try {
    const extraction = await extractServiceStatement(file.path, file.mimetype, effectiveSettings(), { ...aiInput(req), signal, stats, onProgress })
    answer.done({ file: file.filename, extraction, stats })
  } catch (err) {
    answer.fail({ file: file.filename, error: messageOf(err), stats })
  }
})

app.post('/api/heating-plants/:id/fuel-invoice', fileWithPages, async (req: Request, res: Response) => {
  const plant = await plantForAi(req, res)
  if (!plant) return
  if (plant.source === 'homeowners') {
    discardUpload(req)
    return res.status(400).json({ error: 'Bei einer vermieteten Eigentumswohnung rechnet die Gemeinschaft ab; Lieferungen erfassen Sie dort nicht. Lesen Sie stattdessen ihre Abrechnung aus.' })
  }
  const file = await documentOf(req, res)
  if (!file) return
  const answer = aiResponse(req, res)
  const { signal, stats, onProgress } = answer
  try {
    const extraction = await extractFuelInvoice(file.path, file.mimetype, effectiveSettings(), { ...aiInput(req), signal, stats, onProgress })
    answer.done({ file: file.filename, extraction, stats })
  } catch (err) {
    answer.fail({ file: file.filename, error: messageOf(err), stats })
  }
})
```

(`HeatingPlant` zum Typimport aus `'../../shared/types.ts'` ergänzen. Heißt die 404-Meldung der Anlage in
index.ts nicht `NO_PLANT`, deren Namen. `fileWithPages` steht vor dem Handler, damit multer den Beleg schon
abgelegt hat; deshalb räumt `discardUpload` ihn bei 400 und 404 weg.)

- [ ] **Step 4: Fortschritt (`client/src/aiRequest.ts`)**

```ts
export type AiStep = 'extraction' | 'classification' | 'docType' | 'meterReading' | 'serviceStatement' | 'fuelInvoice'
```

In `progressText` vor `case 'extraction':`:

```ts
    case 'serviceStatement':
    case 'fuelInvoice':
      if (progress.phase === 'writing' && progress.chars) return `Modell schreibt die Auswertung (${progress.chars.toLocaleString('de-DE')} Zeichen) …`
      if (progress.phase === 'thinking' && progress.chars) return `Modell denkt nach (${progress.chars.toLocaleString('de-DE')} Zeichen) …`
      return progress.step === 'serviceStatement' ? 'Modell liest die Abrechnung …' : 'Modell liest die Rechnung …'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/api.test.ts && npm --prefix client test -- aiRequest && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/index.ts server/test/api.test.ts client/src/aiRequest.ts client/src/aiRequest.test.ts
git commit -m "KI: Routen für Messdienst- und Lieferantenrechnung an der Heizanlage

Antwort als Strom wie /api/extract, gespeichert wird nichts außer dem
Beleg; bei abgelehnter Anfrage verschwindet auch der.

Refs #103"
```

---

### Task 4: Messdienstabrechnung übernehmen, Logik (`client/src/serviceImport.ts`)

**Files:**
- Create: `client/src/serviceImport.ts`, `client/src/serviceImport.test.ts`

**Interfaces:**
- Consumes: Task 1; `Co2Form`, `Co2Answer` (co2Form.ts, PR 6); `parseEuro`, `fmtEuro` (api.ts);
  `HEATING_CATEGORY`; `formatDayRange` (shared/period.ts, PR 2).
- Produces:
  - `type ImportContext = { propertyId: string; plantId: string; heating: { key: string; from: string; to: string }; object: { key: string; from: string; to: string }; tenancies: readonly Pick<Tenancy, 'id' | 'unitId' | 'tenantName' | 'start' | 'end'>[]; units: readonly Pick<Unit, 'id' | 'name' | 'selfUsed'>[]; existingAmountItems: number }`
  - `type BlockDraft = { include: boolean; category: string; amount: string; targets: string[] }` (Ziel: `''`, `'vacancy'`, `'tenancy:<id>'`, `'self:<unitId>'`)
  - `matchLine(line: ServiceUserLine, ctx: ImportContext): string`
  - `targetOptions(ctx: ImportContext): { value: string; label: string }[]`
  - `blockBlocked(block: ServiceBlock, ctx: ImportContext): string | null`
  - `draftsOf(x: ServiceStatementExtraction, ctx: ImportContext): BlockDraft[]`
  - `serviceChecks(x: ServiceStatementExtraction, ctx: ImportContext): string[]`
  - `itemBodies(x, drafts, ctx, file: string): { bodies: Record<string, unknown>[] } | { error: string }`
  - `co2FormFromExtraction(x, base: Co2Form): Co2Form`, `co2Extras(x): { serviceEmissionsKg: number | null; serviceAreaM2: number | null }`
  - `deductionHint(x): string | null`, `answerConflict(x, answer: Co2Answer): string | null`
  - `DHW_LABELS: Record<DhwMethod, string>`

- [ ] **Step 1: Write the failing tests**

`client/src/serviceImport.test.ts`:

```ts
import { expect, test } from 'vitest'
import {
  answerConflict, blockBlocked, co2Extras, co2FormFromExtraction, deductionHint, draftsOf, itemBodies, matchLine, serviceChecks, targetOptions,
  type ImportContext,
} from './serviceImport'
import { co2ToForm } from './co2Form'
import { fmtEuro } from './api'
import type { ServiceStatementExtraction } from './types'

const ctx: ImportContext = {
  propertyId: 'objekt-1',
  plantId: 'hp',
  heating: { key: '2025-05', from: '2025-05-01', to: '2026-04-30' },
  object: { key: '2025-05', from: '2025-05-01', to: '2026-04-30' },
  tenancies: [
    { id: 't1', unitId: 'a', tenantName: 'Erika Mustermann', start: '2020-01-01', end: null },
    { id: 't2', unitId: 'c', tenantName: 'Max Beispiel', start: '2025-01-01', end: null },
    { id: 't3', unitId: 'c', tenantName: 'Hans Vorher', start: '2019-01-01', end: '2024-12-31' },
  ],
  units: [
    { id: 'a', name: 'EG links', selfUsed: false }, { id: 'b', name: 'EG rechts', selfUsed: false },
    { id: 'c', name: 'OG links', selfUsed: false }, { id: 'd', name: 'OG rechts', selfUsed: true },
  ],
  existingAmountItems: 0,
}

const x: ServiceStatementExtraction = {
  vendor: 'Wärmedienst Beispiel GmbH', periodStart: '2025-05-01', periodEnd: '2026-04-30', unitsCount: 4, usersTotalEur: 3944.5, deductionEur: 87.5,
  co2: { emissionsKg: 4456.4, areaM2: 194.6, kgPerM2: 22.9, landlordPercent: 30, totalEur: 291.67, landlordEur: 87.5 },
  dhwMethod: 'volumeFormula',
  blocks: [
    {
      title: 'Heizung und Warmwasser', category: 'Heizung und Warmwasser', totalEur: 3944.5,
      lines: [
        { label: 'Mustermann, Erika', unitLabel: 'EG links', from: null, to: null, amountEur: 1180.25, vacancy: false },
        { label: 'Leerstand', unitLabel: 'EG rechts', from: null, to: null, amountEur: 702.1, vacancy: true },
        { label: 'Beispiel, Max', unitLabel: 'OG links', from: null, to: null, amountEur: 1065.4, vacancy: false },
        { label: 'Eigentümer', unitLabel: 'OG rechts', from: null, to: null, amountEur: 996.75, vacancy: false },
      ],
    },
    {
      title: 'Kaltwasser und Abwasser', category: 'Wasser/Abwasser', totalEur: 1236,
      lines: [
        { label: 'Mustermann, Erika', unitLabel: 'EG links', from: null, to: null, amountEur: 402, vacancy: false },
        { label: 'Leerstand', unitLabel: 'EG rechts', from: null, to: null, amountEur: 85, vacancy: true },
        { label: 'Beispiel, Max', unitLabel: 'OG links', from: null, to: null, amountEur: 377, vacancy: false },
        { label: 'Eigentümer', unitLabel: 'OG rechts', from: null, to: null, amountEur: 372, vacancy: false },
      ],
    },
  ],
}

test('Zuordnung: Name, Leerstand, Eigentümer; nur bei genau einem Treffer', () => {
  const [heizung] = x.blocks
  expect(heizung?.lines.map((l) => matchLine(l, ctx))).toEqual(['tenancy:t1', 'vacancy', 'tenancy:t2', 'self:d'])
  expect(matchLine({ label: 'Unbekannt', unitLabel: null, from: null, to: null, vacancy: false }, ctx)).toBe('')
  // Hans Vorher wohnte nur bis 2024, die Heizperiode beginnt im Mai 2025.
  expect(matchLine({ label: 'Vorher, Hans', unitLabel: 'OG links', from: null, to: null, vacancy: false }, ctx)).toBe('')
})

test('Review Focus 3: zwei Treffer bleiben offen; Übernehmen verlangt jede Zuordnung', () => {
  const zwei: ImportContext = { ...ctx, tenancies: [...ctx.tenancies, { id: 't4', unitId: 'b', tenantName: 'Erika Mustermann', start: '2025-06-01', end: null }] }
  expect(matchLine({ label: 'Mustermann, Erika', unitLabel: null, from: null, to: null, vacancy: false }, zwei)).toBe('')
  // Mit der Lage auf der Zeile ist es wieder eindeutig.
  expect(matchLine({ label: 'Mustermann, Erika', unitLabel: 'EG links', from: null, to: null, vacancy: false }, zwei)).toBe('tenancy:t1')
  const drafts = draftsOf(x, zwei).map((d, i) => (i === 0 ? { ...d, targets: d.targets.map((t, k) => (k === 0 ? '' : t)) } : d))
  expect(itemBodies(x, drafts, zwei, 'beleg.pdf')).toEqual({ error: 'Bitte ordnen Sie „Mustermann, Erika“ (Heizung und Warmwasser) einem Mieter, Ihrer eigenen Wohnung oder dem Leerstand zu.' })
})

test('Positionen: Heizung mit Betrag S + Abzugszeile, Einzel- und Eigenbeträge, Leerstand bleibt offen; Kaltwasser im Objektzeitraum', () => {
  const r = itemBodies(x, draftsOf(x, ctx), ctx, 'beleg.pdf')
  if ('error' in r) throw new Error(r.error)
  expect(r.bodies).toEqual([
    {
      propertyId: 'objekt-1', period: '2025-05', category: 'Heizung und Warmwasser', description: 'Heizung und Warmwasser (Wärmedienst Beispiel GmbH)', vendor: 'Wärmedienst Beispiel GmbH',
      amountCents: 403200, key: 'amounts', tenancyAmounts: { t1: 118025, t2: 106540 }, selfAmounts: { d: 99675 }, invoiceFile: 'beleg.pdf', heatingPlantId: 'hp',
    },
    {
      propertyId: 'objekt-1', period: '2025-05', category: 'Wasser/Abwasser', description: 'Kaltwasser und Abwasser (Wärmedienst Beispiel GmbH)', vendor: 'Wärmedienst Beispiel GmbH',
      amountCents: 123600, key: 'amounts', tenancyAmounts: { t1: 40200, t2: 37700 }, selfAmounts: { d: 37200 }, invoiceFile: 'beleg.pdf',
    },
  ])
})

test('Review Focus 4: schon Einzelbeträge in der Heizperiode: Heizblock nicht vorgehakt, mit Satz', () => {
  const schon = { ...ctx, existingAmountItems: 1 }
  expect(draftsOf(x, schon)[0]?.include).toBe(false)
  expect(serviceChecks(x, schon)).toContain('In dieser Heizperiode gibt es schon Einzelbeträge eines Messdienstes. Übernehmen Sie nur, was noch fehlt; sonst stünden die Heizkosten doppelt in der Abrechnung.')
})

test('Review Focus 5: Kaltwasser bei abweichendem Objektzeitraum nicht übernommen, mit Satz', () => {
  const kalender: ImportContext = { ...ctx, object: { key: '2026-01', from: '2026-01-01', to: '2026-12-31' } }
  const [, kalt] = x.blocks
  if (!kalt) throw new Error('Kaltwasserblock fehlt')
  expect(blockBlocked(kalt, kalender)).toBe('Der Block gilt für 01.05.2025–30.04.2026, Ihr Abrechnungszeitraum für 01.01.–31.12.2026. Kalte Kosten gehören in den Abrechnungszeitraum; erfassen Sie den Block bitte auf der Seite Kosten.')
  expect(draftsOf(x, kalender)[1]?.include).toBe(false)
  const r = itemBodies(x, draftsOf(x, kalender), kalender, 'beleg.pdf')
  if ('error' in r) throw new Error(r.error)
  expect(r.bodies.map((b) => b.category)).toEqual(['Heizung und Warmwasser'])
})

test('Prüfungen: Zeitraum, Summe je Block, S, Nutzeinheiten, CO₂-Anteil gegen Abzugszeile', () => {
  expect(serviceChecks(x, ctx)).toEqual([])
  const abweichend: ServiceStatementExtraction = {
    ...x, periodStart: '2025-01-01', periodEnd: '2025-12-31', unitsCount: 5, usersTotalEur: 3950,
    co2: { ...(x.co2 ?? { emissionsKg: null, areaM2: null, kgPerM2: null, landlordPercent: null, totalEur: null }), landlordEur: 90 },
    blocks: [{ ...(x.blocks[0] ?? { title: '', category: '', lines: [] }), totalEur: 3944.6 }],
  }
  expect(serviceChecks(abweichend, ctx)).toEqual([
    'Die Abrechnung gilt für 01.01.–31.12.2025, die Heizperiode in Mietfuchs für 01.05.2025–30.04.2026. Prüfen Sie den Zeitraum der Heizanlage unter Stammdaten.',
    `Block „Heizung und Warmwasser“: Die Nutzerzeilen ergeben ${fmtEuro(394450)}, die Summe laut Abrechnung ist ${fmtEuro(394460)}.`,
    `Die Summe der Nutzerkosten Heizung und Warmwasser (S) ist ${fmtEuro(395000)}, der Block nennt ${fmtEuro(394460)}.`,
    'Die Abrechnung nennt 5 Nutzeinheiten, im Block stehen 4 Nutzerzeilen.',
    `Der CO₂-Anteil des Vermieters ist ${fmtEuro(9000)}, die Abzugszeile ${fmtEuro(8750)}.`,
  ])
})

test('CO₂: Formular vorbelegt ohne Antwort; Abzugszeile als Satz; Warnung bei „nur ausgewiesen“', () => {
  const form = co2FormFromExtraction(x, co2ToForm(null, { items: [], unitsCount: 4 }))
  expect(form.answer).toBe('')
  expect([form.usersTotal, form.unitsCount, form.kgPerM2, form.landlordPercent, form.totalCo2, form.landlordCo2]).toEqual(['3.944,50', '4', '22,9', '30', '291,67', '87,50'])
  expect(co2Extras(x)).toEqual({ serviceEmissionsKg: 4456.4, serviceAreaM2: 194.6 })
  expect(deductionHint(x)).toBe('In Ihrer Abrechnung steht die Zeile „Abzüglich CO₂-Kosten Vermieter“ mit 87,50 €.')
  expect(answerConflict(x, 'shown')).toBe('Die Auswertung hat eine Abzugszeile gefunden. Ist sie in Ihrer Abrechnung vorhanden, lautet die Antwort „Ja, es gibt eine Abzugszeile“; sonst schlägt die Probe fehl.')
  expect(answerConflict(x, 'deducted')).toBeNull()
  expect(deductionHint({ ...x, deductionEur: null })).toBeNull()
})

test('Auswahl der Ziele: bitte zuordnen, Leerstand, Mietverhältnisse der Heizperiode, eigene Wohnung', () => {
  expect(targetOptions(ctx)).toEqual([
    { value: '', label: 'Bitte zuordnen …' },
    { value: 'vacancy', label: 'Leerstand oder nicht vermietet (bleibt beim Vermieter)' },
    { value: 'tenancy:t1', label: 'Erika Mustermann (EG links)' },
    { value: 'tenancy:t2', label: 'Max Beispiel (OG links)' },
    { value: 'self:d', label: 'Eigene Wohnung OG rechts' },
  ])
})
```

Hinweis: Die Erwartungen mit Beträgen bilden die Tests mit `fmtEuro`, damit das Leerzeichen vor „€“ (in
api.ts womöglich ein geschütztes) aus derselben Quelle kommt wie in `serviceChecks`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- serviceImport`
Expected: FAIL: `Failed to resolve import "./serviceImport"`.

- [ ] **Step 3: Implement `client/src/serviceImport.ts`**

```ts
// Eine ausgelesene Messdienstabrechnung übernehmen (Heizung PR 20, #103), ohne DOM. Die KI schlägt vor, der
// Vermieter prüft: Diese Datei ordnet Nutzerzeilen Mietverhältnissen zu (nur bei genau einem Treffer),
// prüft die gelesenen Zahlen gegeneinander und baut die Rümpfe für die bestehenden Routen. Gespeichert wird
// erst, wenn der Vermieter es auslöst.
import { fmtEuro, parseEuro } from './api'
import type { Co2Answer, Co2Form } from './co2Form'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { formatDayRange } from '../../shared/period.ts'
import type { DhwMethod, ServiceBlock, ServiceStatementExtraction, ServiceUserLine, Tenancy, Unit } from './types'

export type ImportContext = {
  propertyId: string
  plantId: string
  heating: { key: string; from: string; to: string }
  object: { key: string; from: string; to: string }
  tenancies: readonly Pick<Tenancy, 'id' | 'unitId' | 'tenantName' | 'start' | 'end'>[]
  units: readonly Pick<Unit, 'id' | 'name' | 'selfUsed'>[]
  existingAmountItems: number
}

export type BlockDraft = { include: boolean; category: string; amount: string; targets: string[] }

export const DHW_LABELS: Record<DhwMethod, string> = {
  heatMeter: 'mit einem Wärmezähler gemessen',
  volumeFormula: 'aus dem Warmwasservolumen errechnet (§ 9 Abs. 2 Satz 2 HeizkostenV)',
  areaFormula: 'aus der Wohnfläche errechnet (§ 9 Abs. 2 Satz 4 HeizkostenV)',
}

// Wörter eines Namens, ohne Groß- und Kleinschreibung, Akzente und Satzzeichen; erst ab drei Buchstaben, damit
// „EG“ oder „von“ nicht zwei Namen verbinden.
const words = (s: string): string[] =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 3)
const contains = (haystack: string, needle: string): boolean => {
  const hay = new Set(words(haystack))
  const need = words(needle)
  return need.length > 0 && need.every((w) => hay.has(w))
}
const overlaps = (a: { from: string; to: string | null }, b: { from: string; to: string }): boolean =>
  a.from <= b.to && (a.to === null || a.to >= b.from)

const VACANCY = /\b(leerstand|leer|unvermietet)\b/
const OWNER = /\b(eigentumer|eigentumerin|eigennutzung|vermieter|selbstnutzung)\b/

export function matchLine(line: ServiceUserLine, ctx: ImportContext): string {
  const plain = words(line.label).join(' ')
  if (line.vacancy || VACANCY.test(plain)) return 'vacancy'
  if (OWNER.test(plain)) {
    const own = ctx.units.filter((u) => u.selfUsed === true)
    const byLabel = line.unitLabel ? own.filter((u) => contains(line.unitLabel ?? '', u.name)) : []
    const pick = byLabel.length === 1 ? byLabel : own
    return pick.length === 1 && pick[0] ? `self:${pick[0].id}` : ''
  }
  const span = { from: line.from ?? ctx.heating.from, to: line.to ?? ctx.heating.to }
  const live = ctx.tenancies.filter((t) => overlaps({ from: t.start, to: t.end }, span))
  let hits = live.filter((t) => contains(line.label, t.tenantName))
  if (hits.length > 1 && line.unitLabel) {
    const unitIds = new Set(ctx.units.filter((u) => contains(line.unitLabel ?? '', u.name)).map((u) => u.id))
    hits = hits.filter((t) => unitIds.has(t.unitId))
  }
  return hits.length === 1 && hits[0] ? `tenancy:${hits[0].id}` : ''
}

export function targetOptions(ctx: ImportContext): { value: string; label: string }[] {
  const unitName = (id: string) => ctx.units.find((u) => u.id === id)?.name ?? id
  return [
    { value: '', label: 'Bitte zuordnen …' },
    { value: 'vacancy', label: 'Leerstand oder nicht vermietet (bleibt beim Vermieter)' },
    ...ctx.tenancies
      .filter((t) => overlaps({ from: t.start, to: t.end }, ctx.heating))
      .map((t) => ({ value: `tenancy:${t.id}`, label: `${t.tenantName} (${unitName(t.unitId)})` })),
    ...ctx.units.filter((u) => u.selfUsed === true).map((u) => ({ value: `self:${u.id}`, label: `Eigene Wohnung ${u.name}` })),
  ]
}

const isHeating = (b: ServiceBlock): boolean => b.category === HEATING_CATEGORY
const linesCents = (b: ServiceBlock): number => b.lines.reduce((a, l) => a + Math.round((l.amountEur ?? 0) * 100), 0)
const blockCents = (b: ServiceBlock): number => (b.totalEur !== undefined ? Math.round(b.totalEur * 100) : linesCents(b))
const euroText = (cents: number): string => (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Ein kalter Block gehört in den Objektzeitraum (Entwurf 3.4). Weicht die Heizperiode davon ab, übernimmt die
// Karte ihn nicht (Plan PR 20, Abweichung 3).
export function blockBlocked(block: ServiceBlock, ctx: ImportContext): string | null {
  if (isHeating(block)) return null
  if (block.category === '') return 'Bitte wählen Sie die Kostenart des Blocks.'
  if (ctx.heating.from === ctx.object.from && ctx.heating.to === ctx.object.to) return null
  return `Der Block gilt für ${formatDayRange(ctx.heating.from, ctx.heating.to)}, Ihr Abrechnungszeitraum für ${formatDayRange(ctx.object.from, ctx.object.to)}. Kalte Kosten gehören in den Abrechnungszeitraum; erfassen Sie den Block bitte auf der Seite Kosten.`
}

export function draftsOf(x: ServiceStatementExtraction, ctx: ImportContext): BlockDraft[] {
  return x.blocks.map((b) => {
    const heating = isHeating(b)
    // Betrag der Heizposition = Gesamtkosten vor dem Abzug (Entwurf 7.1): S + Abzugszeile.
    const cents = blockCents(b) + (heating && x.deductionEur !== null ? Math.round(x.deductionEur * 100) : 0)
    return {
      include: heating ? ctx.existingAmountItems === 0 : blockBlocked(b, ctx) === null,
      category: b.category,
      amount: euroText(cents),
      targets: b.lines.map((l) => matchLine(l, ctx)),
    }
  })
}

export function serviceChecks(x: ServiceStatementExtraction, ctx: ImportContext): string[] {
  const out: string[] = []
  if (x.periodStart && x.periodEnd && (x.periodStart !== ctx.heating.from || x.periodEnd !== ctx.heating.to)) {
    out.push(`Die Abrechnung gilt für ${formatDayRange(x.periodStart, x.periodEnd)}, die Heizperiode in Mietfuchs für ${formatDayRange(ctx.heating.from, ctx.heating.to)}. Prüfen Sie den Zeitraum der Heizanlage unter Stammdaten.`)
  }
  for (const b of x.blocks) {
    if (b.totalEur === undefined) continue
    // Jede Nutzerzeile ist gerundet, bei Messdiensten aus bis zu vier Teilen: NE · 2 ct (Entwurf 7.3).
    if (Math.abs(linesCents(b) - Math.round(b.totalEur * 100)) > b.lines.length * 2) {
      out.push(`Block „${b.title || b.category}“: Die Nutzerzeilen ergeben ${fmtEuro(linesCents(b))}, die Summe laut Abrechnung ist ${fmtEuro(Math.round(b.totalEur * 100))}.`)
    }
  }
  const heating = x.blocks.find(isHeating)
  if (heating && x.usersTotalEur !== null && heating.totalEur !== undefined && Math.round(x.usersTotalEur * 100) !== Math.round(heating.totalEur * 100)) {
    out.push(`Die Summe der Nutzerkosten Heizung und Warmwasser (S) ist ${fmtEuro(Math.round(x.usersTotalEur * 100))}, der Block nennt ${fmtEuro(Math.round(heating.totalEur * 100))}.`)
  }
  if (heating && x.unitsCount !== null && x.unitsCount !== heating.lines.length) {
    out.push(`Die Abrechnung nennt ${x.unitsCount} Nutzeinheiten, im Block stehen ${heating.lines.length} Nutzerzeilen.`)
  }
  if (x.co2?.landlordEur != null && x.deductionEur !== null && Math.round(x.co2.landlordEur * 100) !== Math.round(x.deductionEur * 100)) {
    out.push(`Der CO₂-Anteil des Vermieters ist ${fmtEuro(Math.round(x.co2.landlordEur * 100))}, die Abzugszeile ${fmtEuro(Math.round(x.deductionEur * 100))}.`)
  }
  if (ctx.existingAmountItems > 0) {
    out.push('In dieser Heizperiode gibt es schon Einzelbeträge eines Messdienstes. Übernehmen Sie nur, was noch fehlt; sonst stünden die Heizkosten doppelt in der Abrechnung.')
  }
  return out
}

export function itemBodies(x: ServiceStatementExtraction, drafts: readonly BlockDraft[], ctx: ImportContext, file: string): { bodies: Record<string, unknown>[] } | { error: string } {
  const bodies: Record<string, unknown>[] = []
  for (const [i, b] of x.blocks.entries()) {
    const d = drafts[i]
    if (!d || !d.include) continue
    const block = { ...b, category: d.category }
    const blocked = blockBlocked(block, ctx)
    if (blocked) return { error: `Block „${b.title || b.category}“: ${blocked}` }
    const amount = parseEuro(d.amount)
    if (amount === null) return { error: `Block „${b.title || b.category}“: Bitte tragen Sie den Betrag ein.` }
    const tenancyAmounts: Record<string, number> = {}
    const selfAmounts: Record<string, number> = {}
    for (const [k, line] of b.lines.entries()) {
      const target = d.targets[k] ?? ''
      if (target === '') return { error: `Bitte ordnen Sie „${line.label}“ (${b.title || b.category}) einem Mieter, Ihrer eigenen Wohnung oder dem Leerstand zu.` }
      if (target === 'vacancy') continue
      if (line.amountEur === undefined) return { error: `„${line.label}“ (${b.title || b.category}) hat keinen Betrag. Bitte tragen Sie ihn nach der Übernahme auf der Seite Kosten ein oder ordnen Sie die Zeile dem Leerstand zu.` }
      const cents = Math.round(line.amountEur * 100)
      const [kind, id = ''] = target.split(':')
      const into = kind === 'self' ? selfAmounts : tenancyAmounts
      into[id] = (into[id] ?? 0) + cents
    }
    const heating = isHeating(block)
    bodies.push({
      propertyId: ctx.propertyId,
      period: heating ? ctx.heating.key : ctx.object.key,
      category: block.category,
      description: `${b.title || block.category} (${x.vendor ?? 'Messdienst'})`,
      ...(x.vendor ? { vendor: x.vendor } : {}),
      amountCents: amount,
      key: 'amounts',
      tenancyAmounts,
      selfAmounts,
      invoiceFile: file,
      ...(heating ? { heatingPlantId: ctx.plantId } : {}),
    })
  }
  return { bodies }
}

const decimalText = (n: number | null | undefined): string => (n == null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 4, useGrouping: false }))

// Das CO₂-Formular (PR 6) aus der Auswertung vorbelegt. Die Antwort auf die Frage nach der Abzugszeile bleibt,
// wie sie war (Entwurf 7.2: ohne Vorgabe).
export function co2FormFromExtraction(x: ServiceStatementExtraction, base: Co2Form): Co2Form {
  const landlord = x.co2?.landlordEur ?? x.deductionEur
  return {
    ...base,
    usersTotal: x.usersTotalEur !== null ? euroText(Math.round(x.usersTotalEur * 100)) : base.usersTotal,
    unitsCount: x.unitsCount !== null ? String(x.unitsCount) : base.unitsCount,
    kgPerM2: x.co2?.kgPerM2 != null ? decimalText(x.co2.kgPerM2) : base.kgPerM2,
    landlordPercent: x.co2?.landlordPercent != null ? decimalText(x.co2.landlordPercent) : base.landlordPercent,
    totalCo2: x.co2?.totalEur != null ? euroText(Math.round(x.co2.totalEur * 100)) : base.totalCo2,
    landlordCo2: landlord != null ? euroText(Math.round(landlord * 100)) : base.landlordCo2,
  }
}

// Ausstoß und Fläche laut Messdienst gehen mit in den CO₂-Datensatz (Entwurf 5.5); das Formular von PR 6 hat
// dafür keine Felder.
export function co2Extras(x: ServiceStatementExtraction): { serviceEmissionsKg: number | null; serviceAreaM2: number | null } {
  return { serviceEmissionsKg: x.co2?.emissionsKg ?? null, serviceAreaM2: x.co2?.areaM2 ?? null }
}

export function deductionHint(x: ServiceStatementExtraction): string | null {
  return x.deductionEur === null ? null : `In Ihrer Abrechnung steht die Zeile „Abzüglich CO₂-Kosten Vermieter“ mit ${fmtEuro(Math.round(x.deductionEur * 100))}.`
}

export function answerConflict(x: ServiceStatementExtraction, answer: Co2Answer): string | null {
  if (x.deductionEur === null || answer !== 'shown') return null
  return 'Die Auswertung hat eine Abzugszeile gefunden. Ist sie in Ihrer Abrechnung vorhanden, lautet die Antwort „Ja, es gibt eine Abzugszeile“; sonst schlägt die Probe fehl.'
}
```

(`Co2Form`, `Co2Answer` exportiert co2Form.ts seit PR 6; `Tenancy`, `Unit`, `DhwMethod` und die neuen Typen
reicht `client/src/types.ts` über `export type *` weiter.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix client test -- serviceImport && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/serviceImport.ts client/src/serviceImport.test.ts
git commit -m "KI: Messdienstabrechnung übernehmen, Zuordnung, Prüfungen und Rümpfe

Zuordnung nur bei genau einem Treffer, Betrag der Heizposition S plus
Abzugszeile, kalte Blöcke nur im Objektzeitraum.

Refs #103"
```

---

### Task 5: Karte „Messdienstabrechnung auslesen“

**Files:**
- Create: `client/src/components/ServiceImportReview.tsx`, `client/src/components/ServiceImportCard.tsx`, `client/src/components/ServiceImportReview.test.tsx`
- Modify: `client/src/pages/Heizkosten.tsx`

**Interfaces:**
- Consumes: Task 3, 4; `aiRequest`, `progressText`, `buildUpload`, `api`, `errorText`, `withProperty`,
  `useToast`, `Term`; `CO2_QUESTION`, `CO2_EXAMPLE`, `CO2_ANSWER_OPTIONS`, `co2ToForm`, `co2Body` (PR 6);
  `CATEGORIES` (client/src/types.ts).
- Produces: Komponenten `ServiceImportReview({ x, file, ctx, view, onDone })`,
  `ServiceImportCard({ plant, view, object, onSaved })`.

- [ ] **Step 1: Write the failing test**

`client/src/components/ServiceImportReview.test.tsx`:

```tsx
// @vitest-environment jsdom
// Die Prüfansicht einer ausgelesenen Messdienstabrechnung (Heizung PR 20). Geprüft wird, was die Logiktests
// nicht sehen: Jede Auswahl zeigt den Wert, mit dem gespeichert wird (CLAUDE.md, Kosten.test.tsx), und
// Übernehmen schickt genau die Rümpfe aus serviceImport.ts.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ServiceImportReview from './ServiceImportReview'
import type { ImportContext } from '../serviceImport'
import type { HeatingPeriodView, ServiceStatementExtraction } from '../types'
import { periodKey } from '../../../shared/period.ts'

const ctx: ImportContext = {
  propertyId: 'objekt-1', plantId: 'hp',
  heating: { key: '2025-05', from: '2025-05-01', to: '2026-04-30' }, object: { key: '2025-05', from: '2025-05-01', to: '2026-04-30' },
  tenancies: [{ id: 't1', unitId: 'a', tenantName: 'Erika Mustermann', start: '2020-01-01', end: null }],
  units: [{ id: 'a', name: 'EG links', selfUsed: false }, { id: 'b', name: 'EG rechts', selfUsed: false }],
  existingAmountItems: 0,
}
const x: ServiceStatementExtraction = {
  vendor: 'Wärmedienst Beispiel GmbH', periodStart: '2025-05-01', periodEnd: '2026-04-30', unitsCount: 2, usersTotalEur: 1882.35, deductionEur: 87.5,
  co2: null, dhwMethod: 'volumeFormula',
  blocks: [{ title: 'Heizung und Warmwasser', category: 'Heizung und Warmwasser', totalEur: 1882.35, lines: [
    { label: 'Mustermann, Erika', unitLabel: 'EG links', from: null, to: null, amountEur: 1180.25, vacancy: false },
    { label: 'Herr Unbekannt', unitLabel: 'EG rechts', from: null, to: null, amountEur: 702.1, vacancy: false },
  ] }],
}
const view: HeatingPeriodView = {
  plantId: 'hp', period: periodKey('2025-05'), label: '2025/2026', from: '2025-05-01', to: '2026-04-30', short: false, closed: false,
  hotWater: { dhwMethod: null, dhwUnmeasurable: null }, co2: null, items: [],
}

let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ id: 'neu' }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const select = (label: string): HTMLSelectElement => {
  const el = screen.getByLabelText(label)
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}

test('Jede Auswahl zeigt den Wert, mit dem gespeichert wird; offene Zeile verhindert Übernehmen', async () => {
  render(<ServiceImportReview x={x} file="beleg.pdf" ctx={ctx} view={view} onDone={() => {}} />)
  expect(select('Zuordnung „Mustermann, Erika“').value).toBe('tenancy:t1')
  expect(select('Zuordnung „Herr Unbekannt“').value).toBe('')
  expect(select('Kostenart „Heizung und Warmwasser“').value).toBe('Heizung und Warmwasser')
  expect(select('Steht in der Kostenaufstellung eine Abzugszeile?').value).toBe('')
  expect(screen.getByText(/Abzüglich CO₂-Kosten Vermieter“ mit 87,50/)).toBeTruthy()
  fireEvent.click(screen.getByText('Positionen anlegen'))
  expect(await screen.findByText(/Bitte ordnen Sie „Herr Unbekannt“/)).toBeTruthy()
  expect(sent.filter((s) => s.method === 'POST')).toEqual([])
})

test('Nach der Zuordnung legt Übernehmen die Position an: Betrag S + Abzugszeile, Leerstand offen', async () => {
  render(<ServiceImportReview x={x} file="beleg.pdf" ctx={ctx} view={view} onDone={() => {}} />)
  fireEvent.change(select('Zuordnung „Herr Unbekannt“'), { target: { value: 'vacancy' } })
  expect(select('Zuordnung „Herr Unbekannt“').value).toBe('vacancy')
  fireEvent.click(screen.getByText('Positionen anlegen'))
  await waitFor(() => expect(sent.find((s) => s.method === 'POST')).toEqual({
    url: '/api/costItems', method: 'POST',
    body: {
      propertyId: 'objekt-1', period: '2025-05', category: 'Heizung und Warmwasser', description: 'Heizung und Warmwasser (Wärmedienst Beispiel GmbH)', vendor: 'Wärmedienst Beispiel GmbH',
      amountCents: 196985, key: 'amounts', tenancyAmounts: { t1: 118025 }, selfAmounts: {}, invoiceFile: 'beleg.pdf', heatingPlantId: 'hp',
    },
  }))
})

test('CO₂-Angaben übernehmen schickt die Antwort und die Werte, Warmwasser die Ermittlung', async () => {
  render(<ServiceImportReview x={x} file="beleg.pdf" ctx={ctx} view={view} onDone={() => {}} />)
  fireEvent.change(select('Steht in der Kostenaufstellung eine Abzugszeile?'), { target: { value: 'deducted' } })
  expect(select('Steht in der Kostenaufstellung eine Abzugszeile?').value).toBe('deducted')
  fireEvent.click(screen.getByText('CO₂-Angaben übernehmen'))
  await waitFor(() => expect(sent.find((s) => s.url.endsWith('/co2'))?.body).toMatchObject({ method: 'serviceDeducted', serviceUsersTotalCents: 188235, serviceUnitsCount: 2 }))
  fireEvent.click(screen.getByText('Ermittlung übernehmen'))
  await waitFor(() => expect(sent.find((s) => s.url.endsWith('/hot-water'))).toEqual({ url: '/api/heating-plants/hp/periods/2025-05/hot-water', method: 'PUT', body: { dhwMethod: 'volumeFormula' } }))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix client test -- ServiceImportReview`
Expected: FAIL: `Failed to resolve import "./ServiceImportReview"`.

- [ ] **Step 3: Implement `client/src/components/ServiceImportReview.tsx`**

```tsx
// Prüfansicht einer ausgelesenen Messdienstabrechnung (Heizung PR 20, #103). Nichts ist gespeichert, bis der
// Vermieter einen der drei Knöpfe wählt; jeder Knopf schreibt über die bestehende Route.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { CO2_ANSWER_OPTIONS, CO2_EXAMPLE, CO2_QUESTION, co2Body, co2ToForm, type Co2Answer } from '../co2Form'
import {
  answerConflict, blockBlocked, co2Extras, co2FormFromExtraction, deductionHint, DHW_LABELS, draftsOf, itemBodies, serviceChecks, targetOptions,
  type BlockDraft, type ImportContext,
} from '../serviceImport'
import { CATEGORIES, type HeatingPeriodView, type ServiceStatementExtraction } from '../types'

export default function ServiceImportReview({ x, file, ctx, view, onDone }: {
  x: ServiceStatementExtraction
  file: string
  ctx: ImportContext
  view: HeatingPeriodView
  onDone: () => void
}) {
  const [drafts, setDrafts] = useState<BlockDraft[]>(() => draftsOf(x, ctx))
  const [answer, setAnswer] = useState<Co2Answer>('')
  const [error, setError] = useState('')
  const toast = useToast()
  const options = targetOptions(ctx)
  const checks = serviceChecks(x, ctx)
  const setDraft = (i: number, next: Partial<BlockDraft>) => setDrafts((all) => all.map((d, k) => (k === i ? { ...d, ...next } : d)))

  async function createItems() {
    const r = itemBodies(x, drafts, ctx, file)
    if ('error' in r) {
      setError(r.error)
      return
    }
    try {
      for (const body of r.bodies) await api('/api/costItems', { method: 'POST', body: JSON.stringify(body) })
      setError('')
      toast(`${r.bodies.length} Position${r.bodies.length === 1 ? '' : 'en'} angelegt.`)
      onDone()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function saveCo2() {
    const unitsCount = x.unitsCount ?? ctx.units.length
    const form = { ...co2FormFromExtraction(x, co2ToForm(view.co2, { items: view.items, unitsCount })), answer }
    const r = co2Body(form, { items: view.items, unitsCount })
    if ('error' in r) {
      setError(r.error)
      return
    }
    try {
      await api(`/api/heating-plants/${ctx.plantId}/periods/${ctx.heating.key}/co2`, { method: 'PUT', body: JSON.stringify({ ...r.body, ...co2Extras(x) }) })
      setError('')
      toast('CO₂-Angaben gespeichert.')
      onDone()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function saveHotWater() {
    if (!x.dhwMethod) return
    try {
      await api(`/api/heating-plants/${ctx.plantId}/periods/${ctx.heating.key}/hot-water`, { method: 'PUT', body: JSON.stringify({ dhwMethod: x.dhwMethod }) })
      toast('Warmwasser gespeichert.')
      onDone()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const hint = deductionHint(x)
  const conflict = answerConflict(x, answer)
  return (
    <div className="field-group">
      <p className="muted">Die KI hat die Abrechnung gelesen. Bitte prüfen Sie jede Zahl am Beleg, bevor Sie etwas übernehmen.</p>
      {checks.length > 0 && <ul className="warning">{checks.map((c) => <li key={c}>{c}</li>)}</ul>}
      {x.blocks.map((b, i) => {
        const d = drafts[i]
        if (!d) return null
        const blocked = blockBlocked({ ...b, category: d.category }, ctx)
        return (
          <fieldset key={`${b.title}-${i}`}>
            <legend>
              <label className="check">
                <input type="checkbox" checked={d.include} disabled={blocked !== null} onChange={(e) => setDraft(i, { include: e.target.checked })} />
                {b.title || 'Kostenblock'}
              </label>
            </legend>
            {blocked && <p className="muted">{blocked}</p>}
            <div className="row">
              <label className="field">
                Kostenart
                <select aria-label={`Kostenart „${b.title}“`} value={d.category} onChange={(e) => setDraft(i, { category: e.target.value })}>
                  <option value="">Bitte wählen …</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="field">
                Betrag der Position{d.category === 'Heizung und Warmwasser' && x.deductionEur !== null ? ' (vor „Abzüglich CO₂-Kosten Vermieter“)' : ''}
                <input inputMode="decimal" value={d.amount} onChange={(e) => setDraft(i, { amount: e.target.value })} />
              </label>
            </div>
            <table className="table">
              <thead><tr><th>Nutzer laut Abrechnung</th><th>Betrag</th><th>Gehört zu</th></tr></thead>
              <tbody>
                {b.lines.map((l, k) => (
                  <tr key={`${l.label}-${k}`}>
                    <td>{l.label}{l.unitLabel ? ` · ${l.unitLabel}` : ''}</td>
                    <td className="num">{l.amountEur === undefined ? 'nicht gelesen' : l.amountEur.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td>
                      <select aria-label={`Zuordnung „${l.label}“`} value={d.targets[k] ?? ''} onChange={(e) => setDraft(i, { targets: d.targets.map((t, j) => (j === k ? e.target.value : t)) })}>
                        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>
        )
      })}
      <button className="btn" onClick={() => void createItems()}>Positionen anlegen</button>

      <h3>CO₂-Kosten <Term id="co2Split" /></h3>
      <label className="field">
        {CO2_QUESTION}
        <select aria-label="Steht in der Kostenaufstellung eine Abzugszeile?" value={answer} onChange={(e) => setAnswer(e.target.value as Co2Answer)}>
          {CO2_ANSWER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <p className="muted">{CO2_EXAMPLE}</p>
      {hint && <p>{hint}</p>}
      {conflict && <p className="warning">{conflict}</p>}
      <button className="btn secondary" onClick={() => void saveCo2()}>CO₂-Angaben übernehmen</button>

      {x.dhwMethod && (
        <p>
          Warmwasseranteil laut Abrechnung {DHW_LABELS[x.dhwMethod]}.{' '}
          <button className="btn secondary" onClick={() => void saveHotWater()}>Ermittlung übernehmen</button>
        </p>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  )
}
```

Hinweis zu `e.target.value as Co2Answer`: Die Optionen stammen aus `CO2_ANSWER_OPTIONS`, ein anderer Wert kann
die Auswahl nicht liefern; so hält es auch die Karte von PR 6. Ist `CATEGORIES` in `client/src/types.ts` eine
Liste von Objekten statt Zeichenketten, die Optionen entsprechend bilden.

- [ ] **Step 4: Implement `client/src/components/ServiceImportCard.tsx`**

```tsx
// Die Karte „Messdienstabrechnung auslesen“ der Seite Heizkosten (Heizung PR 20, #103): Beleg wählen, KI
// lesen lassen, Ergebnis prüfen und übernehmen.
import { useEffect, useRef, useState } from 'react'
import { api, errorText } from '../api'
import { aiRequest, progressText, type AiProgress } from '../aiRequest'
import { buildUpload } from '../pdfIntake'
import { withProperty } from '../property'
import ServiceImportReview from './ServiceImportReview'
import type { ImportContext } from '../serviceImport'
import type { HeatingPeriodView, HeatingPlant, ServiceExtractResult, Tenancy, Unit } from '../types'

export default function ServiceImportCard({ plant, view, object, onSaved }: {
  plant: HeatingPlant
  view: HeatingPeriodView
  object: { key: string; from: string; to: string }
  onSaved: () => void
}) {
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [result, setResult] = useState<ServiceExtractResult | null>(null)
  const [progress, setProgress] = useState<AiProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    void Promise.all([
      api<Tenancy[]>(withProperty('/api/tenancies', plant.propertyId)),
      api<Unit[]>(withProperty('/api/units', plant.propertyId)),
    ]).then(([t, u]) => { setTenancies(t); setUnits(u) }).catch((e) => setError(errorText(e)))
  }, [plant.propertyId])

  async function read(file: File) {
    setBusy(true)
    setError('')
    setResult(null)
    abort.current = new AbortController()
    try {
      const fd = await buildUpload(file)
      fd.append('propertyId', plant.propertyId)
      setResult(await aiRequest<ServiceExtractResult>(`/api/heating-plants/${plant.id}/service-statement`, fd, { onProgress: setProgress, signal: abort.current.signal }))
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setError(errorText(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  if (view.closed) return null
  const ctx: ImportContext = {
    propertyId: plant.propertyId, plantId: plant.id,
    heating: { key: String(view.period), from: view.from, to: view.to }, object,
    tenancies, units, existingAmountItems: view.items.filter((i) => i.key === 'amounts').length,
  }
  return (
    <div className="card">
      <h2>Messdienstabrechnung auslesen</h2>
      <p className="muted">
        Laden Sie die Heiz- und Warmwasserkostenabrechnung Ihres Messdienstes hoch. Mietfuchs liest Nutzerbeträge, Summen, CO₂-Angaben und die
        Ermittlung des Warmwassers und schlägt sie vor; gespeichert wird erst, wenn Sie übernehmen. Bei gescannten Abrechnungen liest Mietfuchs
        höchstens die ersten vier Seiten.
      </p>
      {!busy && <input type="file" accept="application/pdf,image/*" aria-label="Messdienstabrechnung wählen" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f) }} />}
      {busy && (
        <p>
          {progressText(progress)} <button className="btn secondary" onClick={() => abort.current?.abort()}>Abbrechen</button>
        </p>
      )}
      {error && <div className="error">{error}</div>}
      {result && <ServiceImportReview x={result.extraction} file={result.file} ctx={ctx} view={view} onDone={onSaved} />}
    </div>
  )
}
```

(`withProperty` steht in `client/src/property.tsx` (CLAUDE.md „Objekte“); `HeatingPlant.propertyId` seit PR 4.)

- [ ] **Step 5: Seite Heizkosten (`client/src/pages/Heizkosten.tsx`)**

`import ServiceImportCard from '../components/ServiceImportCard'`. In der Schleife je Anlage und Heizperiode
vor der Karte „CO₂-Kosten“ (PR 6):

```tsx
{plant.method === 'service' && (
  <ServiceImportCard plant={plant} view={view} object={objectPeriod} onSaved={reload} />
)}
```

`objectPeriod` ist der Objektzeitraum als `{ key, from, to }` aus `usePeriod()` (Annahme C4); `reload` der
Rückruf, mit dem die Seite nach dem Speichern neu lädt (heißt er anders, dessen Namen).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test -- ServiceImportReview serviceImport && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/ServiceImportReview.tsx client/src/components/ServiceImportReview.test.tsx client/src/components/ServiceImportCard.tsx client/src/pages/Heizkosten.tsx
git commit -m "KI: Karte Messdienstabrechnung auslesen auf der Seite Heizkosten

Prüfansicht mit Zuordnung je Nutzerzeile, Frage nach der Abzugszeile
ohne Vorgabe und drei Knöpfen über die bestehenden Routen.

Refs #103"
```

---

### Task 6: Lieferantenrechnung in die Karte der Lieferungen

**Files:**
- Create: `client/src/fuelImport.ts`, `client/src/fuelImport.test.ts`
- Modify: `client/src/fuelForm.ts`, `client/src/fuelForm.test.ts`, Karte der Lieferungen (PR 7: `client/src/components/FuelCard.tsx`), `client/src/components/FuelCard.test.tsx`

**Interfaces:**
- Consumes: Task 1, 3; `FuelForm`, `emptyFuelForm`, `fuelToForm`, `fuelBody` (PR 7, 11); `parseDecimal`.
- Produces:
  - `FuelForm` mit mindestens `deliveredAt`, `quantity`, `quantityUnit`, `gasBasis`, `heatingValue`,
    `emissionFactor`, `bioCost`, `parts: FuelPartForm[]`; `type FuelPartForm = { from: string; to: string; energyKwh: string; amount: string; fixed: string; emissionsKg: string; co2Cost: string }`;
    `QUANTITY_UNIT_OPTIONS`, `GAS_BASIS_OPTIONS`.
  - `fuelImport.ts`: `fuelFormFromExtraction(x: FuelInvoiceExtraction, base: FuelForm): FuelForm`,
    `fuelChecks(x: FuelInvoiceExtraction): string[]`.

- [ ] **Step 1: Write the failing tests**

`client/src/fuelImport.test.ts`:

```ts
import { expect, test } from 'vitest'
import { fuelChecks, fuelFormFromExtraction } from './fuelImport'
import { emptyFuelForm, fuelBody } from './fuelForm'
import type { FuelInvoiceExtraction } from './types'

const gas: FuelInvoiceExtraction = {
  vendor: 'Stadtwerke Beispielstadt', invoiceDate: '2026-03-20', periodStart: '2025-03-15', periodEnd: '2026-03-14',
  totalGrossEur: 4067.8, fixedEur: 207.06, quantity: 2890, quantityUnit: 'm3', energyKwh: 31285, gasBasis: 'hs', heatingValue: null,
  emissionsKg: 5674.8, co2CostEur: 380.99, co2CostNet: false, emissionFactor: 0.20088, bioCostEur: null,
  parts: [
    { from: '2025-03-15', to: '2025-12-31', energyKwh: 22410, amountEur: 2885.77, fixedEur: 165.65, emissionsKg: 4065, co2CostEur: 266.05 },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: 8875, amountEur: 1182.03, fixedEur: 41.41, emissionsKg: 1609.8, co2CostEur: 114.94 },
  ],
  amountsNetUnadjusted: false,
}

test('Formular aus der Auswertung: alle Angaben nach § 3 Abs. 1, Teilmengen, Bezeichnung', () => {
  const f = fuelFormFromExtraction(gas, emptyFuelForm())
  expect(f).toMatchObject({
    label: 'Stadtwerke Beispielstadt 15.03.2025–14.03.2026', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', amount: '4.067,80', fixed: '207,06',
    quantity: '2890', quantityUnit: 'm3', energyKwh: '31285', gasBasis: 'hs', heatingValue: '', emissionsKg: '5674,8', co2Cost: '380,99', emissionFactor: '0,20088', bioCost: '',
  })
  expect(f.parts).toEqual([
    { from: '2025-03-15', to: '2025-12-31', energyKwh: '22410', amount: '2.885,77', fixed: '165,65', emissionsKg: '4065', co2Cost: '266,05' },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: '8875', amount: '1.182,03', fixed: '41,41', emissionsKg: '1609,8', co2Cost: '114,94' },
  ])
  const r = fuelBody(f, 'service')
  if ('error' in r) throw new Error(r.error)
  expect(r.body).toMatchObject({ amountCents: 406780, fixedCents: 20706, emissionsKg: 5674.8, co2CostCents: 38099, energyKwh: 31285, emissionFactor: 0.20088, gasBasis: 'hs', quantity: 2890, quantityUnit: 'm3' })
  expect(r.body.parts).toEqual([
    { from: '2025-03-15', to: '2025-12-31', energyKwh: 22410, amountCents: 288577, fixedCents: 16565, emissionsKg: 4065, co2CostCents: 26605 },
    { from: '2026-01-01', to: '2026-03-14', energyKwh: 8875, amountCents: 118203, fixedCents: 4141, emissionsKg: 1609.8, co2CostCents: 11494 },
  ])
})

test('Prüfungen: Summe der Teilmengen, Energie, netto genannte CO₂-Kosten, hochgerechnet, Biobrennstoff', () => {
  expect(fuelChecks(gas)).toEqual([])
  const lueckig: FuelInvoiceExtraction = { ...gas, energyKwh: 31000, parts: [gas.parts[0] ?? gas.parts[1]].filter((p) => p !== undefined) }
  const checks = fuelChecks({ ...lueckig, co2CostNet: true, amountsAdjusted: 'netto', bioCostEur: 12.5 })
  expect(checks.some((c) => /Die Teilmengen ergeben 2\.885,77.*Rechnungsbetrag ist 4\.067,80/.test(c))).toBe(true)
  expect(checks.some((c) => /Teilmengen ergeben 22\.410 kWh, die Rechnung nennt 31\.000 kWh/.test(c))).toBe(true)
  expect(checks.some((c) => /ohne Umsatzsteuer.*§ 3 Abs\. 3 CO2KostAufG/.test(c))).toBe(true)
  expect(checks.some((c) => /netto ausgewiesen.*anteilig auf den Rechnungsbetrag hochgerechnet/.test(c))).toBe(true)
  expect(checks.some((c) => /§ 43 GModG/.test(c))).toBe(true)
  expect(fuelChecks({ ...gas, amountsNetUnadjusted: true })).toContain('Die Rechnung nennt die Teilmengen netto, und der Abstand zum Rechnungsbetrag lässt sich nicht allein mit der Umsatzsteuer erklären. Bitte tragen Sie die Bruttobeträge von Hand ein.')
})

test('Heizöl: Liefertag statt Zeitraum, Heizwert laut Rechnung, Menge in Litern', () => {
  const oel: FuelInvoiceExtraction = { ...gas, vendor: 'Heizöl Beispiel', periodStart: undefined, periodEnd: undefined, deliveredAt: '2025-10-12', quantity: 3000, quantityUnit: 'l', gasBasis: null, heatingValue: 10.05, energyKwh: 30150, parts: [], fixedEur: null }
  const f = fuelFormFromExtraction(oel, emptyFuelForm())
  expect([f.label, f.deliveredAt, f.invoiceFrom, f.quantity, f.quantityUnit, f.heatingValue, f.parts]).toEqual(['Heizöl Beispiel 12.10.2025', '2025-10-12', '', '3000', 'l', '10,05', []])
})
```

`client/src/components/FuelCard.test.tsx` anhängen (die Fixtures `view` und `gas` von PR 7 stehen oben in der
Datei):

```tsx
test('Neue Auswahlfelder zeigen den gespeicherten Wert: Einheit und Bezug des Gases (Heizung PR 20)', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[{ ...gas, quantity: 2890, quantityUnit: 'm3', gasBasis: 'hs' }]} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('Ändern'))
  const einheit = screen.getByLabelText('Einheit der Menge')
  const bezug = screen.getByLabelText('kWh berechnet nach')
  if (!(einheit instanceof HTMLSelectElement) || !(bezug instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  expect([einheit.value, bezug.value]).toEqual(['m3', 'hs'])
})

test('Rechnung mit KI auslesen ist da, solange nichts bearbeitet wird', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[]} onSaved={() => {}} />)
  expect(screen.getByLabelText('Rechnung mit KI auslesen')).toBeTruthy()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- fuelImport FuelCard fuelForm`
Expected: FAIL: Modul `./fuelImport` fehlt; `fuelBody` kennt `parts` nicht; die Auswahlfelder fehlen.

- [ ] **Step 3: `FuelForm` ergänzen (`client/src/fuelForm.ts`, Annahme C2)**

Jedes Feld dieser Liste, das `FuelForm` noch nicht hat, ergänzen; vorhandene bleiben unverändert:

```ts
export type FuelPartForm = { from: string; to: string; energyKwh: string; amount: string; fixed: string; emissionsKg: string; co2Cost: string }

// in FuelForm:
  deliveredAt: string
  quantity: string
  quantityUnit: FuelQuantityUnit | ''
  gasBasis: GasBasis | ''
  heatingValue: string
  emissionFactor: string
  bioCost: string
  parts: FuelPartForm[]
```

`emptyFuelForm`: `deliveredAt: '', quantity: '', quantityUnit: '', gasBasis: '', heatingValue: '', emissionFactor: '', bioCost: '', parts: []`
(nur für die neu ergänzten). `fuelToForm` (nur für die neu ergänzten):

```ts
    deliveredAt: d.deliveredAt ?? '',
    quantity: numberText(d.quantity),
    quantityUnit: d.quantityUnit ?? '',
    gasBasis: d.gasBasis ?? '',
    heatingValue: numberText(d.heatingValue),
    emissionFactor: numberText(d.emissionFactor),
    bioCost: centsText(d.bioCostCents),
    parts: d.parts.map((p) => ({
      from: p.from, to: p.to, energyKwh: numberText(p.energyKwh), amount: centsText(p.amountCents), fixed: centsText(p.fixedCents),
      emissionsKg: numberText(p.emissionsKg), co2Cost: centsText(p.co2CostCents),
    })),
```

Optionen für die beiden neuen Auswahlfelder (ans Ende der Datei):

```ts
export const QUANTITY_UNIT_OPTIONS: readonly { value: FuelQuantityUnit | ''; label: string }[] = [
  { value: '', label: '–' }, { value: 'l', label: 'Liter' }, { value: 'kg', label: 'kg' }, { value: 'm3', label: 'm³' }, { value: 'kWh', label: 'kWh' }, { value: 'srm', label: 'Schüttraummeter' },
]
export const GAS_BASIS_OPTIONS: readonly { value: GasBasis | ''; label: string }[] = [
  { value: '', label: '–' }, { value: 'hs', label: 'Brennwert (Hs)' }, { value: 'hi', label: 'Heizwert (Hi)' },
]
```

In `fuelBody` (Teilmengen und die neuen Felder; vorhandene Prüfungen bleiben) vor `const body`:

```ts
  const factor = decimal(form.emissionFactor, 'Der Emissionsfaktor')
  const quantity = decimal(form.quantity, 'Die Menge')
  const bio = euro(form.bioCost, 'Der Preisbestandteil für Biobrennstoff')
  for (const v of [factor, quantity, bio]) if (v !== null && typeof v === 'object') return v
  const parts: Record<string, unknown>[] = []
  for (const [i, p] of form.parts.entries()) {
    const label = `Teilmenge ${i + 1}`
    if (p.from === '' || p.to === '' || p.from > p.to) return { error: `${label}: Bitte geben Sie den Zeitraum an (von bis).` }
    const amount = euro(p.amount, `${label}: Der Betrag`)
    if (amount === null) return { error: `${label}: Jede Teilmenge braucht ihren Betrag laut Rechnung.` }
    const fixedPart = euro(p.fixed, `${label}: Der feste Preisbestandteil`)
    const co2Part = euro(p.co2Cost, `${label}: Die CO₂-Kosten`)
    const kwhPart = decimal(p.energyKwh, `${label}: Die Energie`)
    const kgPart = decimal(p.emissionsKg, `${label}: Der CO₂-Ausstoß`)
    for (const v of [amount, fixedPart, co2Part, kwhPart, kgPart]) if (v !== null && typeof v === 'object') return v
    parts.push({ from: p.from, to: p.to, energyKwh: num(kwhPart), amountCents: num(amount), fixedCents: num(fixedPart), emissionsKg: num(kgPart), co2CostCents: num(co2Part) })
  }
```

(`euro`, `decimal`, `num` sind die Helfer, die `fuelBody` seit PR 7 hat; `num` steht dort hinter der Schleife
über die Fehler und muss für diesen Block davor stehen.) Im Rumpf ergänzen:

```ts
    ...(form.deliveredAt !== '' ? { deliveredAt: form.deliveredAt } : {}),
    quantity: num(quantity),
    quantityUnit: form.quantityUnit === '' ? null : form.quantityUnit,
    gasBasis: form.gasBasis === '' ? null : form.gasBasis,
    emissionFactor: num(factor),
    ...(num(bio) !== null ? { bioCostCents: num(bio) } : {}),
    parts,
```

Verlangt `fuelBody` von PR 7 den Rechnungszeitraum immer, bleibt das so; bei Vorratsenergien ist er seit PR 8
verzichtbar, wenn ein Liefertag da ist (Annahme C2). Den Typimport um `FuelQuantityUnit, GasBasis` ergänzen.

- [ ] **Step 4: Implement `client/src/fuelImport.ts`**

```ts
// Eine ausgelesene Lieferantenrechnung ins Formular der Lieferung (Heizung PR 20, #103), ohne DOM. Gespeichert
// wird mit „Lieferung speichern“ wie jede Lieferung. Mietfuchs rechnet nichts vor (Entwurf 16); die Prüfungen
// vergleichen nur Angaben derselben Rechnung miteinander.
import { fmtEuro } from './api'
import type { FuelForm } from './fuelForm'
import { formatDayRange } from '../../shared/period.ts'
import { germanDate } from '../../shared/law/register.ts'
import type { FuelInvoiceExtraction } from './types'

const euroText = (eur: number | null): string => (eur === null ? '' : eur.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const numberText = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 5, useGrouping: false }))
const cents = (eur: number | null): number => Math.round((eur ?? 0) * 100)

export function fuelFormFromExtraction(x: FuelInvoiceExtraction, base: FuelForm): FuelForm {
  const when = x.periodStart && x.periodEnd ? formatDayRange(x.periodStart, x.periodEnd) : x.deliveredAt ? germanDate(x.deliveredAt) : ''
  return {
    ...base,
    label: base.label || [x.vendor ?? 'Rechnung', when].filter((s) => s !== '').join(' '),
    invoiceFrom: x.periodStart ?? base.invoiceFrom,
    invoiceTo: x.periodEnd ?? base.invoiceTo,
    deliveredAt: x.deliveredAt ?? base.deliveredAt,
    amount: x.totalGrossEur !== null ? euroText(x.totalGrossEur) : base.amount,
    fixed: x.fixedEur !== null ? euroText(x.fixedEur) : base.fixed,
    quantity: x.quantity !== null ? numberText(x.quantity) : base.quantity,
    quantityUnit: x.quantityUnit ?? base.quantityUnit,
    energyKwh: x.energyKwh !== null ? numberText(x.energyKwh) : base.energyKwh,
    gasBasis: x.gasBasis ?? base.gasBasis,
    heatingValue: x.heatingValue !== null ? numberText(x.heatingValue) : base.heatingValue,
    emissionsKg: x.emissionsKg !== null ? numberText(x.emissionsKg) : base.emissionsKg,
    co2Cost: x.co2CostEur !== null ? euroText(x.co2CostEur) : base.co2Cost,
    emissionFactor: x.emissionFactor !== null ? numberText(x.emissionFactor) : base.emissionFactor,
    bioCost: x.bioCostEur !== null ? euroText(x.bioCostEur) : base.bioCost,
    parts: x.parts.map((p) => ({
      from: p.from, to: p.to, energyKwh: numberText(p.energyKwh), amount: euroText(p.amountEur), fixed: euroText(p.fixedEur),
      emissionsKg: numberText(p.emissionsKg), co2Cost: euroText(p.co2CostEur),
    })),
  }
}

export function fuelChecks(x: FuelInvoiceExtraction): string[] {
  const out: string[] = []
  if (x.parts.length > 0 && x.totalGrossEur !== null) {
    const sum = x.parts.reduce((a, p) => a + cents(p.amountEur), 0)
    if (Math.abs(sum - cents(x.totalGrossEur)) > x.parts.length) {
      out.push(`Die Teilmengen ergeben ${fmtEuro(sum)}, der Rechnungsbetrag ist ${fmtEuro(cents(x.totalGrossEur))}. Bitte prüfen Sie, ob eine Teilmenge fehlt oder ob die Nachzahlung statt des Rechnungsbetrags gelesen wurde.`)
    }
  }
  if (x.parts.length > 0 && x.energyKwh !== null && x.parts.every((p) => p.energyKwh !== null)) {
    const kwh = x.parts.reduce((a, p) => a + (p.energyKwh ?? 0), 0)
    if (Math.abs(kwh - x.energyKwh) > 1) {
      out.push(`Die Teilmengen ergeben ${kwh.toLocaleString('de-DE')} kWh, die Rechnung nennt ${x.energyKwh.toLocaleString('de-DE')} kWh.`)
    }
  }
  if (x.co2CostNet) {
    out.push('Die Rechnung nennt die CO₂-Kosten ohne Umsatzsteuer. Auszuweisen sind sie mit Umsatzsteuer (§ 3 Abs. 3 CO2KostAufG); fragen Sie im Zweifel beim Lieferanten nach, Mietfuchs rechnet sie nicht um.')
  }
  if (x.amountsAdjusted === 'netto') {
    out.push('Die Teilmengen waren netto ausgewiesen; Mietfuchs hat sie anteilig auf den Rechnungsbetrag hochgerechnet. Bitte prüfen Sie die Beträge.')
  }
  if (x.amountsNetUnadjusted) {
    out.push('Die Rechnung nennt die Teilmengen netto, und der Abstand zum Rechnungsbetrag lässt sich nicht allein mit der Umsatzsteuer erklären. Bitte tragen Sie die Bruttobeträge von Hand ein.')
  }
  if (x.bioCostEur !== null && x.bioCostEur !== 0) {
    out.push('Die Rechnung weist einen Preisbestandteil für Biobrennstoff nach § 43 GModG aus (§ 3 Abs. 1 Nr. 6 CO2KostAufG). Er gilt nur für eine Heizungsanlage nach § 43 Abs. 1 GModG; prüfen Sie die Angabe an der Heizanlage.')
  }
  return out
}
```

- [ ] **Step 5: Karte der Lieferungen (PR 7: `FuelCard.tsx`, Annahme C1)**

Importe: `aiRequest`, `progressText`, `type AiProgress` aus `'../aiRequest'`; `buildUpload` aus
`'../pdfIntake'`; `fuelChecks`, `fuelFormFromExtraction` aus `'../fuelImport'`; `GAS_BASIS_OPTIONS`,
`QUANTITY_UNIT_OPTIONS`, `type FuelPartForm` aus `'../fuelForm'`; Typ `FuelExtractResult`. Zustand:

```ts
  const [checks, setChecks] = useState<string[]>([])
  const [reading, setReading] = useState<AiProgress | null | 'start'>(null)
```

Funktion:

```ts
  async function readInvoice(file: File) {
    setReading('start')
    setError('')
    try {
      const fd = await buildUpload(file)
      const r = await aiRequest<FuelExtractResult>(`/api/heating-plants/${plant.id}/fuel-invoice`, fd, { onProgress: setReading })
      setForm(fuelFormFromExtraction(r.extraction, emptyFuelForm()))
      setChecks(fuelChecks(r.extraction))
      setEditing('neu')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setReading(null)
    }
  }
```

Neben dem Knopf „Lieferung eintragen“ (nur wenn `!view.closed && editing === null`):

```tsx
        {reading === null
          ? <label className="btn secondary">Rechnung mit KI auslesen<input type="file" hidden aria-label="Rechnung mit KI auslesen" accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readInvoice(f) }} /></label>
          : <span className="muted">{progressText(reading === 'start' ? null : reading)}</span>}
```

Im Formular (innerhalb `editing !== null`) über den Feldern die Prüfungen und hinter „CO₂-Kosten laut
Rechnung“ die neuen Felder:

```tsx
          {checks.length > 0 && <ul className="warning">{checks.map((c) => <li key={c}>{c}</li>)}</ul>}
```

```tsx
          <div className="row">
            {text('quantity', 'Menge')}
            <label className="field">
              Einheit
              <select aria-label="Einheit der Menge" value={form.quantityUnit} onChange={(e) => set('quantityUnit', QUANTITY_UNIT_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
                {QUANTITY_UNIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="field">
              Bezug der kWh (nur Gas)
              <select aria-label="kWh berechnet nach" value={form.gasBasis} onChange={(e) => set('gasBasis', GAS_BASIS_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
                {GAS_BASIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <div className="row">
            {text('emissionFactor', 'Emissionsfaktor laut Rechnung (kg CO₂ je kWh)')}
            {text('bioCost', 'Biobrennstoff nach § 43 GModG (§ 3 Abs. 1 Nr. 6 CO2KostAufG)')}
          </div>
          {form.parts.length > 0 && (
            <div className="field-group">
              <div className="field-group-label">Teilmengen laut Rechnung</div>
              {form.parts.map((p, i) => (
                <div className="row" key={`${p.from}-${i}`}>
                  {(['from', 'to', 'energyKwh', 'amount', 'fixed', 'emissionsKg', 'co2Cost'] as const satisfies readonly (keyof FuelPartForm)[]).map((k) => (
                    <label className="field" key={k}>
                      {({ from: 'von', to: 'bis', energyKwh: 'kWh', amount: 'Betrag', fixed: 'davon fest', emissionsKg: 'kg CO₂', co2Cost: 'CO₂-Kosten' })[k]}
                      <input type={k === 'from' || k === 'to' ? 'date' : 'text'} value={p[k]} onChange={(e) => set('parts', form.parts.map((q, j) => (j === i ? { ...q, [k]: e.target.value } : q)))} />
                    </label>
                  ))}
                  <button className="btn secondary" onClick={() => set('parts', form.parts.filter((_, j) => j !== i))}>Entfernen</button>
                </div>
              ))}
            </div>
          )}
          <button className="btn secondary" onClick={() => set('parts', [...form.parts, { from: '', to: '', energyKwh: '', amount: '', fixed: '', emissionsKg: '', co2Cost: '' }])}>Teilmenge hinzufügen</button>
```

`TextKey` in der Karte (PR 7: `Exclude<keyof FuelForm, 'usedByService'>`) um die Nicht-Text-Felder erweitern:
`Exclude<keyof FuelForm, 'usedByService' | 'quantityUnit' | 'gasBasis' | 'parts' | 'grade'>` (nur die Namen, die
es gibt). `setChecks([])` beim Öffnen einer Lieferung (`open`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test -- fuelImport fuelForm FuelCard && npm run typecheck && npm run build`
Expected: PASS; die Tests von PR 7 bis PR 11 an `fuelForm.test.ts` bleiben grün (die neuen Felder sind leer
und fehlen im Rumpf nur, wo sie leer sind, oder stehen dort als `null`/`[]`).

Gibt ein bestehender Test den ganzen Rumpf mit `toEqual` vor (PR 7: „Lieferung ins Formular und zurück“), dort
die neuen Schlüssel ergänzen: `quantity: null, quantityUnit: null, gasBasis: null, emissionFactor: null, parts: []`
(und `deliveredAt` nur, wenn gesetzt).

- [ ] **Step 7: Commit**

```bash
git add client/src/fuelForm.ts client/src/fuelForm.test.ts client/src/fuelImport.ts client/src/fuelImport.test.ts client/src/components/FuelCard.tsx client/src/components/FuelCard.test.tsx
git commit -m "KI: Lieferantenrechnung in die Karte der Lieferungen

Angaben nach § 3 Abs. 1 Nr. 1–4 und 6 CO2KostAufG, Teilmengen und Heizwert
als Vorschlag im Formular; Prüfungen nur innerhalb derselben Rechnung.

Refs #103"
```

---

### Task 7: KI-Prüflauf mit drei erfundenen Belegen

**Files:**
- Create: `scripts/ai-eval/invoices/metering-service.html`, `scripts/ai-eval/invoices/gas-supplier.html`, `scripts/ai-eval/invoices/heating-oil.html`, `scripts/ai-eval/score.mjs`, `scripts/ai-eval/score.d.mts`, `server/test/ai-eval-score.test.ts`
- Modify: `scripts/ai-eval/cases.json`, `scripts/ai-eval.mjs`

**Interfaces:**
- Produces: `score(expected, extraction)` (umgezogen, unverändert), `scoreService(expected, extraction)`,
  `scoreFuel(expected, extraction)` in `scripts/ai-eval/score.mjs`, je mit Ergebnis
  `{ points: number; passed: number; total: number; failed: string[] }`.

- [ ] **Step 1: Write the failing test**

`server/test/ai-eval-score.test.ts`:

```ts
// Die Bewertung des KI-Prüflaufs (scripts/ai-eval/score.mjs) für die Belege der Heizung (Heizung PR 20).
// Läuft ohne Modell: Geprüft wird, dass eine richtige Auswertung alle Punkte bekommt und typische Fehler
// (Nachzahlung statt Rechnungsbetrag, Brennwert als Heizwert, Abzugszeile vergessen) Punkte kosten.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreFuel, scoreService } from '../../scripts/ai-eval/score.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
type Case = { name: string; kind?: string; file: string; expected: Record<string, unknown> }
const { cases } = JSON.parse(fs.readFileSync(path.join(root, 'scripts/ai-eval/cases.json'), 'utf8')) as { cases: Case[] }
const byName = (name: string): Case => cases.find((c) => c.name === name) ?? assert.fail(`Fall ${name} fehlt`)

test('Jeder neue Fall hat seinen Beleg', () => {
  for (const name of ['metering-service', 'gas-supplier', 'heating-oil']) assert.ok(fs.existsSync(path.join(root, 'scripts/ai-eval', byName(name).file)), name)
})

test('Messdienst: die Sollwerte selbst ergeben volle Punkte, eine vergessene Abzugszeile nicht', () => {
  const c = byName('metering-service')
  const e = c.expected
  const perfect = {
    vendor: 'Wärmedienst Beispiel GmbH', periodStart: e.periodStart, periodEnd: e.periodEnd, unitsCount: e.unitsCount, usersTotalEur: e.usersTotal,
    deductionEur: e.deduction, co2: e.co2, dhwMethod: e.dhwMethod,
    blocks: (e.blocks as { category: string; total: number; lines: number[]; vacancyLines?: number }[]).map((b) => ({
      category: b.category, totalEur: b.total, lines: b.lines.map((amountEur, i) => ({ amountEur, vacancy: i < (b.vacancyLines ?? 0) ? true : false })),
    })),
  }
  // Leerstand steht im Beleg an zweiter Stelle; für die Bewertung zählt nur die Zahl der Leerstandszeilen.
  assert.equal(scoreService(e, perfect).points, 1)
  const ohneAbzug = scoreService(e, { ...perfect, deductionEur: null })
  assert.ok(ohneAbzug.failed.includes('Abzugszeile'))
})

test('Gasrechnung: Nachzahlung statt Rechnungsbetrag und Brennwert als Heizwert kosten Punkte', () => {
  const c = byName('gas-supplier')
  const e = c.expected
  const perfect = {
    vendor: 'Stadtwerke Beispielstadt', totalGrossEur: e.total, periodStart: e.periodStart, periodEnd: e.periodEnd, fixedEur: e.fixed, quantity: e.quantity,
    quantityUnit: e.quantityUnit, energyKwh: e.energyKwh, gasBasis: e.gasBasis, heatingValue: e.heatingValue, emissionsKg: e.emissionsKg, co2CostEur: e.co2Cost,
    emissionFactor: e.emissionFactor, bioCostEur: e.bioCost,
    parts: (e.parts as Record<string, unknown>[]).map((p) => ({ from: p.from, to: p.to, energyKwh: p.energyKwh, amountEur: p.amount, fixedEur: p.fixed, emissionsKg: p.emissionsKg, co2CostEur: p.co2Cost })),
  }
  assert.equal(scoreFuel(e, perfect).points, 1)
  assert.ok(scoreFuel(e, { ...perfect, totalGrossEur: 107.8 }).failed.includes('Rechnungsbetrag'))
  assert.ok(scoreFuel(e, { ...perfect, heatingValue: 11.32 }).failed.includes('Heizwert'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/ai-eval-score.test.ts`
Expected: FAIL: `Cannot find module '../../scripts/ai-eval/score.mjs'`.

- [ ] **Step 3: Erfundene Belege**

Alle drei sind frei erfunden (Namen, Adressen, Nummern, IBAN „DE00 …“); die Zahlen sind in sich stimmig und
hier nachgerechnet.

`scripts/ai-eval/invoices/metering-service.html`:

```html
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Heizkostenabrechnung Wärmedienst Beispiel 2025/2026</title>
<link rel="stylesheet" href="../invoice.css">
</head>
<body>
<!-- Erfundener Beispielbeleg für den KI-Prüflauf (Heizung PR 20). Stolpersteine: Abzugszeile mit Minus,
     S nach dem Abzug, Leerstand als Nutzer, Eigentümer als Nutzer, ein zweiter Kostenblock (Kaltwasser),
     Warmwasser nach Volumenformel. Nachgerechnet: 3.452,50 + 120,00 + 180,00 + 40,00 + 152,00 = 3.944,50;
     1.180,25 + 702,10 + 1.065,40 + 996,75 = 3.944,50; 4.456,4 kg / 194,6 m² = 22,90 → 22,9 kg/m² (Stufe 30 %);
     4.456,4 kg × 55 €/t × 1,19 = 291,67 €; × 30 % = 87,50 €; 402 + 85 + 377 + 372 = 1.236,00. -->
<section class="page">
  <div class="head">
    <div>
      <div class="sender">Wärmedienst Beispiel GmbH · Zählerweg 3 · 12345 Musterstadt</div>
      <div class="address">Frau<br>Erika Vermieterin<br>Musterweg 1<br>12345 Musterstadt</div>
    </div>
    <div>
      <div class="logo">Wärmedienst Beispiel GmbH<small>Heiz- und Wasserkostenabrechnung</small></div>
      <table class="info" style="margin-top:8mm">
        <tr><td>Liegenschaft</td><td>Musterweg 1, 12345 Musterstadt</td></tr>
        <tr><td>Liegenschaftsnummer</td><td>4711-0815</td></tr>
        <tr><td>Abrechnungszeitraum</td><td>01.05.2025 – 30.04.2026</td></tr>
        <tr><td>Anzahl Nutzeinheiten</td><td>4</td></tr>
      </table>
    </div>
  </div>
  <h1>Gesamtabrechnung Heizung und Warmwasser</h1>
  <table class="items">
    <tr><th>Kostenart</th><th class="r">Betrag</th></tr>
    <tr><td>Brennstoffkosten Erdgas laut Rechnungen</td><td class="r">3.540,00 €</td></tr>
    <tr><td>Abzüglich CO₂-Kosten Vermieter</td><td class="r">−87,50 €</td></tr>
    <tr><td>Brennstoffkosten nach Abzug</td><td class="r">3.452,50 €</td></tr>
    <tr><td>Betriebsstrom</td><td class="r">120,00 €</td></tr>
    <tr><td>Wartung der Heizungsanlage</td><td class="r">180,00 €</td></tr>
    <tr><td>Immissionsmessung</td><td class="r">40,00 €</td></tr>
    <tr><td>Gerätemiete und Verbrauchsabrechnung</td><td class="r">152,00 €</td></tr>
    <tr class="sum"><td>Summe der Nutzerkosten Heizungsanlage</td><td class="r">3.944,50 €</td></tr>
  </table>
  <p>Davon Warmwasser 15,0 % = 591,68 €, Heizung 3.352,82 €. Verteilung je 30 % nach Wohnfläche und 70 % nach Verbrauch.</p>
  <p><strong>Ermittlung des Warmwasseranteils:</strong> Die Wärmemenge für die Warmwasserbereitung wurde nach § 9 Abs. 2
    Satz 2 HeizkostenV aus dem gemessenen Warmwasservolumen (118,4 m³) und der mittleren Warmwassertemperatur (55 °C)
    errechnet.</p>
</section>
<section class="page">
  <h1>CO₂-Kostenaufteilung nach dem CO2KostAufG</h1>
  <table class="items">
    <tr><td>Brennstoffemissionen der Liegenschaft</td><td class="r">4.456,4 kg CO₂</td></tr>
    <tr><td>Wohnfläche für die Einstufung</td><td class="r">194,6 m²</td></tr>
    <tr><td>CO₂-Ausstoß je m² Wohnfläche und Jahr</td><td class="r">22,9 kg</td></tr>
    <tr><td>Einstufung: 22 bis unter 27 kg CO₂/m²/a, Anteil Vermieter</td><td class="r">30 %</td></tr>
    <tr><td>CO₂-Kosten gesamt</td><td class="r">291,67 €</td></tr>
    <tr><td>davon Anteil Vermieter</td><td class="r">87,50 €</td></tr>
    <tr><td>davon Anteil Mieter</td><td class="r">204,17 €</td></tr>
  </table>
  <h2>Ihre Kosten Heizung und Warmwasser je Nutzeinheit</h2>
  <table class="items">
    <tr><th>NE</th><th>Lage</th><th>Nutzer</th><th>Zeitraum</th><th class="r">Heizung</th><th class="r">Warmwasser</th><th class="r">Ihre Kosten</th></tr>
    <tr><td>1</td><td>EG links</td><td>Mustermann, Erika</td><td>01.05.2025–30.04.2026</td><td class="r">1.004,15 €</td><td class="r">176,10 €</td><td class="r">1.180,25 €</td></tr>
    <tr><td>2</td><td>EG rechts</td><td>Leerstand</td><td>01.05.2025–30.04.2026</td><td class="r">640,30 €</td><td class="r">61,80 €</td><td class="r">702,10 €</td></tr>
    <tr><td>3</td><td>OG links</td><td>Beispiel, Max</td><td>01.05.2025–30.04.2026</td><td class="r">887,92 €</td><td class="r">177,48 €</td><td class="r">1.065,40 €</td></tr>
    <tr><td>4</td><td>OG rechts</td><td>Eigentümer (Eigennutzung)</td><td>01.05.2025–30.04.2026</td><td class="r">820,45 €</td><td class="r">176,30 €</td><td class="r">996,75 €</td></tr>
    <tr class="sum"><td colspan="4">Summe</td><td class="r">3.352,82 €</td><td class="r">591,68 €</td><td class="r">3.944,50 €</td></tr>
  </table>
</section>
<section class="page">
  <h1>Kaltwasser und Abwasser</h1>
  <p>Kosten laut Gebührenbescheid, verteilt nach den Wasserzählern der Nutzeinheiten.</p>
  <table class="items">
    <tr><th>NE</th><th>Lage</th><th>Nutzer</th><th class="r">Ihre Kosten</th></tr>
    <tr><td>1</td><td>EG links</td><td>Mustermann, Erika</td><td class="r">402,00 €</td></tr>
    <tr><td>2</td><td>EG rechts</td><td>Leerstand</td><td class="r">85,00 €</td></tr>
    <tr><td>3</td><td>OG links</td><td>Beispiel, Max</td><td class="r">377,00 €</td></tr>
    <tr><td>4</td><td>OG rechts</td><td>Eigentümer (Eigennutzung)</td><td class="r">372,00 €</td></tr>
    <tr class="sum"><td colspan="3">Summe der Nutzerkosten Kaltwasser und Abwasser</td><td class="r">1.236,00 €</td></tr>
  </table>
  <div class="foot">
    <div>Wärmedienst Beispiel GmbH<br>Geschäftsführung: M. Beispiel</div>
    <div>Beispielbank<br>IBAN DE00 1111 2222 3333 4444 55</div>
    <div>Amtsgericht Musterstadt HRB 12345</div>
  </div>
</section>
<script src="../invoice.js"></script>
</body>
</html>
```

(Die Spalten Heizung und Warmwasser sind nachgerechnet: 1.004,15 + 640,30 + 887,92 + 820,45 = 3.352,82;
176,10 + 61,80 + 177,48 + 176,30 = 591,68; je Zeile Heizung + Warmwasser = Ihre Kosten.)

`scripts/ai-eval/invoices/gas-supplier.html`:

```html
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Jahresrechnung Erdgas Stadtwerke Beispielstadt</title>
<link rel="stylesheet" href="../invoice.css">
</head>
<body>
<!-- Erfundener Beispielbeleg für den KI-Prüflauf (Heizung PR 20). Stolpersteine: Nachzahlung nach Abschlägen
     statt Rechnungsbetrag, zwei Teilzeiträume (Preisänderung 01.01.2026), Brennwert statt Heizwert, Angaben
     nach § 3 Abs. 1 CO2KostAufG im Kasten, Menge mit Leerzeichen gruppiert. Nachgerechnet: 2 890 m³ × 0,9563 ×
     11,320 kWh/m³ = 31.285 kWh; 22.410 × 10,20 ct = 2.285,82 €; 8.875 × 10,80 ct = 958,50 €; Grundpreis 174,00 €
     netto, nach Tagen 292/365 = 139,20 € und 73/365 = 34,80 €; netto 2.425,02 € und 993,30 €, brutto 2.885,77 €
     und 1.182,03 €, zusammen 4.067,80 €; 22.410 × 0,18139 = 4.065,0 kg, 8.875 × 0,18139 = 1.609,8 kg;
     4.064,95 kg × 55 €/t × 1,19 = 266,05 €, 1.609,84 kg × 60 €/t × 1,19 = 114,94 €. -->
<section class="page">
  <div class="head">
    <div>
      <div class="sender">Stadtwerke Beispielstadt GmbH · Energieweg 1 · 12345 Beispielstadt</div>
      <div class="address">Frau<br>Erika Vermieterin<br>Musterweg 1<br>12345 Musterstadt</div>
    </div>
    <div>
      <div class="logo">Stadtwerke Beispielstadt<small>Erdgas · Strom · Wasser</small></div>
      <table class="info" style="margin-top:8mm">
        <tr><td>Rechnungsnummer</td><td>2026-447711</td></tr>
        <tr><td>Rechnungsdatum</td><td>20.03.2026</td></tr>
        <tr><td>Kundennummer</td><td>100 200 300</td></tr>
        <tr><td>Lieferstelle</td><td>Musterweg 1, Heizung</td></tr>
      </table>
    </div>
  </div>
  <h1>Jahresrechnung Erdgas</h1>
  <p>Abrechnungszeitraum 15.03.2025 bis 14.03.2026</p>
  <table class="items">
    <tr><th>Zählerstand</th><th class="r">Datum</th><th class="r">Stand</th></tr>
    <tr><td>Anfangsstand</td><td class="r">15.03.2025</td><td class="r">12 010 m³</td></tr>
    <tr><td>Endstand</td><td class="r">14.03.2026</td><td class="r">14 900 m³</td></tr>
    <tr><td>Verbrauch</td><td class="r"></td><td class="r">2 890 m³</td></tr>
    <tr><td colspan="2">× Zustandszahl 0,9563 × Brennwert 11,320 kWh/m³</td><td class="r">31 285 kWh</td></tr>
  </table>
  <table class="items">
    <tr><th>Gesamtbetrag</th><th class="r"></th></tr>
    <tr><td>Summe netto</td><td class="r">3.418,32 €</td></tr>
    <tr><td>Umsatzsteuer 19 %</td><td class="r">649,48 €</td></tr>
    <tr class="sum"><td>Rechnungsbetrag</td><td class="r">4.067,80 €</td></tr>
    <tr><td>abzüglich geleistete Abschläge</td><td class="r">−3.960,00 €</td></tr>
    <tr class="sum"><td>Nachzahlung</td><td class="r">107,80 €</td></tr>
  </table>
</section>
<section class="page">
  <h1>Abrechnungsdetails</h1>
  <table class="items">
    <tr><th>Zeitraum</th><th class="r">Menge</th><th class="r">Arbeitspreis</th><th class="r">Arbeitspreis netto</th><th class="r">Grundpreis netto</th><th class="r">Grundpreis brutto</th><th class="r">Summe netto</th><th class="r">Summe brutto</th></tr>
    <tr><td>15.03.2025–31.12.2025</td><td class="r">22 410 kWh</td><td class="r">10,20 ct/kWh</td><td class="r">2.285,82 €</td><td class="r">139,20 €</td><td class="r">165,65 €</td><td class="r">2.425,02 €</td><td class="r">2.885,77 €</td></tr>
    <tr><td>01.01.2026–14.03.2026</td><td class="r">8 875 kWh</td><td class="r">10,80 ct/kWh</td><td class="r">958,50 €</td><td class="r">34,80 €</td><td class="r">41,41 €</td><td class="r">993,30 €</td><td class="r">1.182,03 €</td></tr>
    <tr class="sum"><td>Summe</td><td class="r">31 285 kWh</td><td class="r"></td><td class="r">3.244,32 €</td><td class="r">174,00 €</td><td class="r">207,06 €</td><td class="r">3.418,32 €</td><td class="r">4.067,80 €</td></tr>
  </table>
  <h2>Angaben nach § 3 Abs. 1 Kohlendioxidkostenaufteilungsgesetz</h2>
  <table class="items">
    <tr><td>1. Brennstoffemissionen</td><td class="r">5.674,8 kg CO₂ (15.03.–31.12.2025: 4.065,0 kg; 01.01.–14.03.2026: 1.609,8 kg)</td></tr>
    <tr><td>2. Preisbestandteil der Kohlendioxidkosten, einschließlich Umsatzsteuer</td><td class="r">380,99 € (266,05 € zu 55 €/t; 114,94 € zu 60 €/t)</td></tr>
    <tr><td>3. Heizwertbezogener Emissionsfaktor</td><td class="r">0,20088 kg CO₂/kWh</td></tr>
    <tr><td>4. Energiegehalt der gelieferten Menge</td><td class="r">31.285 kWh (Brennwert)</td></tr>
    <tr><td>5. Hinweis</td><td class="r">Erstattungsansprüche nach § 6 Abs. 2 und § 8 Abs. 2 CO2KostAufG</td></tr>
    <tr><td>6. Preisbestandteil nach § 43 GModG</td><td class="r">entfällt</td></tr>
  </table>
  <div class="foot">
    <div>Stadtwerke Beispielstadt GmbH</div>
    <div>Beispielbank<br>IBAN DE00 9999 8888 7777 6666 55</div>
    <div>USt-IdNr. DE000000000</div>
  </div>
</section>
<script src="../invoice.js"></script>
</body>
</html>
```

`scripts/ai-eval/invoices/heating-oil.html`:

```html
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Rechnung Heizöl Beispiel</title>
<link rel="stylesheet" href="../invoice.css">
</head>
<body>
<!-- Erfundener Beispielbeleg für den KI-Prüflauf (Heizung PR 20). Stolpersteine: Liefertag statt Zeitraum,
     Heizwert ausdrücklich genannt, Preis je 100 Liter brutto. Nachgerechnet: 3.000 l × 105,00 €/100 l =
     3.150,00 € brutto, darin 2.647,06 € netto und 502,94 € Umsatzsteuer; 3.000 l × 10,05 kWh/l = 30.150 kWh;
     30.150 × 0,2664 = 8.032,0 kg; 8.031,96 kg × 55 €/t × 1,19 = 525,69 €. -->
<section class="page">
  <div class="head">
    <div>
      <div class="sender">Heizöl Beispiel GmbH · Tankweg 9 · 12345 Musterstadt</div>
      <div class="address">Frau<br>Erika Vermieterin<br>Musterweg 1<br>12345 Musterstadt</div>
    </div>
    <div>
      <div class="logo">Heizöl Beispiel GmbH<small>Brennstoffhandel</small></div>
      <table class="info" style="margin-top:8mm">
        <tr><td>Rechnungsnummer</td><td>HB-2025-1012</td></tr>
        <tr><td>Rechnungsdatum</td><td>14.10.2025</td></tr>
        <tr><td>Liefertag</td><td>12.10.2025</td></tr>
        <tr><td>Lieferanschrift</td><td>Musterweg 1</td></tr>
      </table>
    </div>
  </div>
  <h1>Rechnung</h1>
  <table class="items">
    <tr><th>Artikel</th><th class="r">Menge</th><th class="r">Preis je 100 l inkl. USt</th><th class="r">Betrag</th></tr>
    <tr><td>Heizöl EL schwefelarm</td><td class="r">3.000 l</td><td class="r">105,00 €</td><td class="r">3.150,00 €</td></tr>
    <tr><td colspan="3">darin enthalten 19 % Umsatzsteuer</td><td class="r">502,94 €</td></tr>
    <tr class="sum"><td colspan="3">Rechnungsbetrag</td><td class="r">3.150,00 €</td></tr>
  </table>
  <h2>Angaben nach § 3 Abs. 1 CO2KostAufG</h2>
  <table class="items">
    <tr><td>Brennstoffemissionen</td><td class="r">8.032,0 kg CO₂</td></tr>
    <tr><td>Preisbestandteil der CO₂-Kosten (55 €/t, inkl. Umsatzsteuer)</td><td class="r">525,69 €</td></tr>
    <tr><td>Heizwertbezogener Emissionsfaktor</td><td class="r">0,2664 kg CO₂/kWh</td></tr>
    <tr><td>Energiegehalt (Heizwert 10,05 kWh/l)</td><td class="r">30.150 kWh</td></tr>
    <tr><td>Hinweis</td><td class="r">Erstattungsansprüche nach § 6 Abs. 2 und § 8 Abs. 2 CO2KostAufG</td></tr>
  </table>
  <div class="foot">
    <div>Heizöl Beispiel GmbH</div>
    <div>Beispielbank<br>IBAN DE00 5555 4444 3333 2222 11</div>
    <div>Steuernummer 123/456/78901</div>
  </div>
</section>
<script src="../invoice.js"></script>
</body>
</html>
```

- [ ] **Step 4: Sollwerte (`scripts/ai-eval/cases.json`)**

`about` um den Satz „`kind`: `service` und `fuel` laufen über die Routen der Heizanlage (Heizung PR 20).“
ergänzen und an `cases` anhängen:

```json
    {
      "name": "metering-service",
      "label": "Heizkostenabrechnung eines Messdienstes (3 Seiten)",
      "kind": "service",
      "file": "invoices/metering-service.html",
      "pages": 3,
      "photo": false,
      "expected": {
        "vendor": "Wärmedienst Beispiel",
        "periodStart": "2025-05-01",
        "periodEnd": "2026-04-30",
        "unitsCount": 4,
        "usersTotal": 3944.50,
        "deduction": 87.50,
        "co2": { "emissionsKg": 4456.4, "areaM2": 194.6, "kgPerM2": 22.9, "landlordPercent": 30, "totalEur": 291.67, "landlordEur": 87.50 },
        "dhwMethod": "volumeFormula",
        "blocks": [
          { "category": "Heizung und Warmwasser", "total": 3944.50, "lines": [1180.25, 702.10, 1065.40, 996.75], "vacancyLines": 1 },
          { "category": "Wasser/Abwasser", "total": 1236.00, "lines": [402.00, 85.00, 377.00, 372.00], "vacancyLines": 1 }
        ]
      }
    },
    {
      "name": "gas-supplier",
      "label": "Jahresrechnung Erdgas mit Preisänderung (2 Seiten)",
      "kind": "fuel",
      "file": "invoices/gas-supplier.html",
      "pages": 2,
      "photo": false,
      "expected": {
        "vendor": "Stadtwerke Beispielstadt",
        "total": 4067.80,
        "periodStart": "2025-03-15",
        "periodEnd": "2026-03-14",
        "fixed": 207.06,
        "quantity": 2890,
        "quantityUnit": "m3",
        "energyKwh": 31285,
        "gasBasis": "hs",
        "heatingValue": null,
        "emissionsKg": 5674.8,
        "co2Cost": 380.99,
        "emissionFactor": 0.20088,
        "bioCost": null,
        "parts": [
          { "from": "2025-03-15", "to": "2025-12-31", "energyKwh": 22410, "amount": 2885.77, "fixed": 165.65, "emissionsKg": 4065.0, "co2Cost": 266.05 },
          { "from": "2026-01-01", "to": "2026-03-14", "energyKwh": 8875, "amount": 1182.03, "fixed": 41.41, "emissionsKg": 1609.8, "co2Cost": 114.94 }
        ]
      }
    },
    {
      "name": "heating-oil",
      "label": "Heizöllieferung mit Heizwert (1 Seite)",
      "kind": "fuel",
      "file": "invoices/heating-oil.html",
      "pages": 1,
      "photo": false,
      "expected": {
        "vendor": "Heizöl Beispiel",
        "total": 3150.00,
        "deliveredAt": "2025-10-12",
        "quantity": 3000,
        "quantityUnit": "l",
        "energyKwh": 30150,
        "heatingValue": 10.05,
        "emissionsKg": 8032.0,
        "co2Cost": 525.69,
        "emissionFactor": 0.2664,
        "bioCost": null,
        "parts": []
      }
    }
```

- [ ] **Step 5: Bewertung (`scripts/ai-eval/score.mjs`, `score.d.mts`)**

`scripts/ai-eval/score.mjs`: die Funktion `score` und `near` aus `scripts/ai-eval.mjs` hierher verschieben
(Wortlaut unverändert, `export function score …`) und ergänzen:

```js
// Bewertung des KI-Prüflaufs (#17). Jede Prüfung zählt gleich. Aus ai-eval.mjs ausgelagert (Heizung PR 20),
// damit server/test/ai-eval-score.test.ts sie ohne Modell prüfen kann.

export const near = (actual, expected, tolerance = 0.011) => typeof actual === 'number' && Math.abs(actual - expected) <= tolerance

function tally(checks) {
  const passed = checks.filter((c) => c.ok).length
  return { points: checks.length ? passed / checks.length : 0, passed, total: checks.length, failed: checks.filter((c) => !c.ok).map((c) => c.name) }
}

// (hier steht die unveränderte Funktion `score` aus ai-eval.mjs, mit `export`)

// Messdienstabrechnung (Heizung PR 20): Kopf, CO₂-Block, Warmwasser und je Block Summe, Beträge und Leerstand.
export function scoreService(expected, x) {
  const checks = []
  const add = (name, ok) => checks.push({ name, ok: Boolean(ok) })
  add('Aussteller', String(x?.vendor ?? '').toLowerCase().includes(expected.vendor.toLowerCase()))
  add('Beginn', x?.periodStart === expected.periodStart)
  add('Ende', x?.periodEnd === expected.periodEnd)
  add('Nutzeinheiten', x?.unitsCount === expected.unitsCount)
  add('Summe S', near(x?.usersTotalEur, expected.usersTotal))
  add('Abzugszeile', near(x?.deductionEur, expected.deduction))
  for (const [k, v] of Object.entries(expected.co2)) add(`CO₂ ${k}`, near(x?.co2?.[k], v, k === 'emissionsKg' || k === 'areaM2' ? 0.051 : 0.011))
  add('Warmwasser', x?.dhwMethod === expected.dhwMethod)
  const blocks = Array.isArray(x?.blocks) ? x.blocks : []
  for (const e of expected.blocks) {
    const b = blocks.find((y) => y?.category === e.category)
    add(`Block ${e.category}`, b)
    add(`Summe ${e.category}`, near(b?.totalEur, e.total))
    const unused = [...(Array.isArray(b?.lines) ? b.lines : [])]
    for (const amount of e.lines) {
      const i = unused.findIndex((l) => near(l?.amountEur, amount))
      add(`${e.category} ${amount}`, i >= 0 && unused.splice(i, 1))
    }
    for (const l of unused) add(`${e.category} zusätzliche Zeile ${l?.amountEur}`, false)
    add(`${e.category} Leerstand`, (Array.isArray(b?.lines) ? b.lines : []).filter((l) => l?.vacancy === true).length === (e.vacancyLines ?? 0))
  }
  return tally(checks)
}

// Lieferantenrechnung (Heizung PR 20): Rechnungsbetrag (nicht die Nachzahlung), Zeitraum oder Liefertag, die
// Angaben nach § 3 Abs. 1 CO2KostAufG, Heizwert (nicht der Brennwert) und je Teilmenge Zeitraum und Beträge.
export function scoreFuel(expected, x) {
  const checks = []
  const add = (name, ok) => checks.push({ name, ok: Boolean(ok) })
  const optionalNear = (actual, want, tolerance) => (want === null ? actual === null || actual === undefined : near(actual, want, tolerance))
  add('Aussteller', String(x?.vendor ?? '').toLowerCase().includes(expected.vendor.toLowerCase()))
  add('Rechnungsbetrag', near(x?.totalGrossEur, expected.total))
  if (expected.periodStart) add('Beginn', x?.periodStart === expected.periodStart)
  if (expected.periodEnd) add('Ende', x?.periodEnd === expected.periodEnd)
  if (expected.deliveredAt) add('Liefertag', x?.deliveredAt === expected.deliveredAt)
  if ('fixed' in expected) add('Grundpreis', optionalNear(x?.fixedEur, expected.fixed))
  add('Menge', near(x?.quantity, expected.quantity, 0.5))
  add('Einheit', x?.quantityUnit === expected.quantityUnit)
  add('Energie', near(x?.energyKwh, expected.energyKwh, 1))
  if ('gasBasis' in expected) add('Brennwert/Heizwert', x?.gasBasis === expected.gasBasis)
  add('Heizwert', optionalNear(x?.heatingValue, expected.heatingValue, 0.011))
  add('Emissionen', near(x?.emissionsKg, expected.emissionsKg, 0.11))
  add('CO₂-Kosten', near(x?.co2CostEur, expected.co2Cost))
  add('Emissionsfaktor', near(x?.emissionFactor, expected.emissionFactor, 0.00001))
  add('Biobrennstoff', optionalNear(x?.bioCostEur, expected.bioCost))
  const parts = Array.isArray(x?.parts) ? x.parts : []
  add('Zahl der Teilmengen', parts.length === expected.parts.length)
  for (const e of expected.parts) {
    const p = parts.find((y) => y?.from === e.from && y?.to === e.to)
    add(`Teilmenge ${e.from}`, p)
    add(`Teilmenge ${e.from} kWh`, near(p?.energyKwh, e.energyKwh, 1))
    add(`Teilmenge ${e.from} Betrag`, near(p?.amountEur, e.amount))
    add(`Teilmenge ${e.from} fest`, near(p?.fixedEur, e.fixed))
    add(`Teilmenge ${e.from} kg`, near(p?.emissionsKg, e.emissionsKg, 0.11))
    add(`Teilmenge ${e.from} CO₂-Kosten`, near(p?.co2CostEur, e.co2Cost))
  }
  return tally(checks)
}
```

(Die Funktion `score` dort mit `tally(checks)` statt ihrer eigenen Rückgabe abschließen; ihr Ergebnis bleibt
gleich.)

`scripts/ai-eval/score.d.mts`:

```ts
// Gepflegte Typangaben zu score.mjs (Heizung PR 20), damit server/test/ai-eval-score.test.ts die Bewertung
// unter den strengen Einstellungen des Servers einbindet; dasselbe Muster wie embedded-migrations.d.ts.
export type Score = { points: number; passed: number; total: number; failed: string[] }
export function near(actual: unknown, expected: number, tolerance?: number): boolean
export function score(expected: Record<string, unknown>, extraction: unknown): Score
export function scoreService(expected: Record<string, unknown>, extraction: unknown): Score
export function scoreFuel(expected: Record<string, unknown>, extraction: unknown): Score
```

- [ ] **Step 6: `scripts/ai-eval.mjs`**

Die Funktionen `near` und `score` dort entfernen und stattdessen importieren und weiterreichen:

```js
import { score, scoreFuel, scoreService } from './ai-eval/score.mjs'
export { score }
```

Eine Heizanlage für die Fälle der Heizung:

```js
// Die Belege der Heizung (Heizung PR 20) laufen über die Routen einer Heizanlage. Ein frischer Datenordner hat
// keine; der Prüflauf legt eine mit Messdienst an (sie nimmt auch Lieferantenrechnungen).
async function ensurePlant(baseUrl) {
  const list = await (await fetch(`${baseUrl}/api/heating-plants`)).json()
  const found = Array.isArray(list) ? list.find((p) => p?.method === 'service') : null
  if (found) return found.id
  const res = await fetch(`${baseUrl}/api/heating-plants`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ energy: 'gas', method: 'service' }) })
  const body = await res.json()
  if (!res.ok || !body?.plant?.id) throw new Error(`Die Heizanlage für den Prüflauf ließ sich nicht anlegen: ${body?.error ?? res.status}`)
  return body.plant.id
}
```

In `evaluate` nach `const selected = …`:

```js
  const plantId = selected.some((c) => c.kind === 'service' || c.kind === 'fuel') ? await ensurePlant(baseUrl) : null
  const routeOf = (c) => (c.kind === 'service' ? `/api/heating-plants/${plantId}/service-statement` : c.kind === 'fuel' ? `/api/heating-plants/${plantId}/fuel-invoice` : '/api/extract')
  const scorerOf = (c) => (c.kind === 'service' ? scoreService : c.kind === 'fuel' ? scoreFuel : score)
```

In der Schleife die Eingaben `text` und `scan` um `route: routeOf(testCase)` ergänzen und
`score(testCase.expected, answer.extraction)` durch `scorerOf(testCase)(testCase.expected, answer.extraction)`
ersetzen. In `modelTable` die Kennzahlen des Schritts so suchen:

```js
    const stat = r.stats?.find((s) => ['extraction', 'serviceStatement', 'fuelInvoice'].includes(s.step))
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/ai-eval-score.test.ts && npm run typecheck`
Expected: PASS; `npm run typecheck` prüft auch `scripts/` (scripts/tsconfig.json, `checkJs`).

Run (Belege im Browser ansehen; ohne Modell):

```bash
node -e "for (const f of ['metering-service','gas-supplier','heating-oil']) require('fs').accessSync('scripts/ai-eval/invoices/'+f+'.html')" && echo ok
```

Expected: `ok`.

- [ ] **Step 8: Commit**

```bash
git add scripts/ai-eval scripts/ai-eval.mjs server/test/ai-eval-score.test.ts
git commit -m "KI-Prüflauf: erfundene Messdienstabrechnung, Gas- und Heizölrechnung

Bewertung in score.mjs ausgelagert und ohne Modell getestet; die Fälle der
Heizung laufen über die Routen einer Heizanlage, die der Lauf anlegt.

Refs #103"
```

---

### Task 8: Doku und Abschluss

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`, `shared/guides.ts`, `server/test/guides.test.ts`

- [ ] **Step 1: Anleitung (`shared/guides.ts`)**

In der Anleitung `meteringService` (PR 0, #216) hinter dem Schritt mit den Einzelbeträgen einen Satz ergänzen:

```ts
      'Statt abzutippen, können Sie die Abrechnung auf der Seite Heizkosten unter „Messdienstabrechnung auslesen“ hochladen: Die KI liest Nutzerbeträge, CO₂-Angaben und die Ermittlung des Warmwassers und schlägt sie vor. Sie ordnen jede Zeile einem Mieter zu und prüfen jede Zahl, bevor Sie übernehmen.',
```

(Die Gestalt eines Schritts in `GUIDES` steht seit #216 fest; heißt das Feld der Schritte anders, dessen
Namen.) `server/test/guides.test.ts` anhängen:

```ts
test('meteringService nennt das Auslesen mit der KI als Vorschlag, den der Vermieter prüft (Heizung PR 20)', () => {
  const text = JSON.stringify(GUIDES.meteringService)
  assert.match(text, /Messdienstabrechnung auslesen/)
  assert.match(text, /prüfen jede Zahl/)
})
```

- [ ] **Step 2: CHANGELOG**

Unter „Unveröffentlicht“, Abschnitt „Hinzugefügt“:

```markdown
- Die KI liest die Heizkostenabrechnung eines Messdienstes (Nutzerbeträge je Kostenblock, Zeitraum,
  CO₂-Block, Abzugszeile, Summe der Nutzerkosten, Ermittlung des Warmwassers, Nutzeinheiten) und die Rechnung
  eines Brennstoff- oder Wärmelieferanten (Angaben nach § 3 CO2KostAufG, Teilmengen, Heizwert) und füllt die
  Formulare der Seite Heizkosten vor. Gespeichert wird erst nach Prüfung
  ([#103](https://github.com/speedone/mietfuchs/issues/103)).
```

- [ ] **Step 3: CLAUDE.md**

Im Abschnitt „KI-Belegauswertung“ hinter der Aufzählung der Module einen Punkt ergänzen:

```markdown
- [server/src/extractHeating.ts](server/src/extractHeating.ts) (Heizung PR 20, #103): Messdienstabrechnung
  und Lieferantenrechnung, über `POST /api/heating-plants/:id/service-statement` und `…/fuel-invoice`, als
  derselbe Strom wie `/api/extract`. Je Belegart **ein** Ausgang (`toServiceExtraction`, `toFuelExtraction`),
  denn dazwischen rechnet Mietfuchs nur Netto-Teilmengen hoch (dieselbe Regel `vatExplainsGap` wie #34).
  Gespeichert wird nichts außer dem Beleg; die Seite Heizkosten zeigt den Vorschlag
  (`client/src/serviceImport.ts`, `fuelImport.ts`) und schreibt über die bestehenden Routen, wenn der
  Vermieter übernimmt. Eine Nutzerzeile wird nur bei genau einem Treffer zugeordnet. Die gefundene
  Abzugszeile steht als Satz neben der Frage, gewählt wird nichts vor (Entwurf 7.2). Kalte Blöcke einer
  Komplettabrechnung nur, wenn die Heizperiode dem Objektzeitraum gleicht.
```

Im Absatz „KI-Prüflauf“ den Satz ergänzen: „Die Belege `metering-service`, `gas-supplier` und `heating-oil`
laufen über die Routen einer Heizanlage, die der Lauf anlegt; bewertet wird in `scripts/ai-eval/score.mjs`
(getestet ohne Modell in `server/test/ai-eval-score.test.ts`).“

- [ ] **Step 4: Volle Prüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: Exit-Status 0.

Run (Smoke-Test mit Wegwerf-Ordner, `CI=1`, geschlossenem Update-Port):

```bash
D=$(mktemp -d); NKA_DATA_DIR=$D CI=1 NKA_UPDATE_URL=http://127.0.0.1:9 NKA_PORT=3001 npm start & sleep 5; node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode npm; kill %1; rm -rf $D
```

Expected: Exit-Status 0.

Den PR mit dem Label `ai-eval` versehen; der KI-Prüflauf liest die drei neuen Belege mit den Modellen der
Matrix. Ein schwaches Ergebnis eines Modells ist kein roter Lauf, sondern ein Befund für die Empfehlungsliste
(`ki-modelle.json`), der in die PR-Beschreibung kommt.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md CLAUDE.md shared/guides.ts server/test/guides.test.ts
git commit -m "Doku: KI liest Messdienst- und Lieferantenrechnung

Refs #103"
```

---

## Selbstprüfung

**1. Abdeckung des Entwurfs.**

| Anforderung (13 PR 20, 14.1) | Task |
|---|---|
| Nutzerzeilen je Block | 2 (Schema, Ausgang), 4 (Zuordnung, Rümpfe), 5 (Prüfansicht), 7 (Fall `metering-service`) |
| Zeitraum | 2, 4 (`serviceChecks`), 7 |
| CO₂-Block | 2, 4 (`co2FormFromExtraction`, `co2Extras`), 5 |
| Abzugszeile (7.4: „#103 liest die Abzugszeile künftig aus“) | 2 (Review Focus 2), 4 (`deductionHint`, `answerConflict`, Betrag S + L), 5 |
| S | 2, 4 (Prüfung gegen den Block), 5 |
| Warmwasser-Ermittlung (7.7) | 2, 5 (`hot-water`) |
| Nutzeinheiten | 2, 4, 5 (`serviceUnitsCount`) |
| Lieferantenrechnung § 3 Abs. 1 Nr. 1–4, 6 CO2KostAufG | 2 (Schema, Prompt), 6 (Formular), 7 (Fälle `gas-supplier`, `heating-oil`) |
| Teilmengen (3.2 Stufe 3) | 2 (Hochrechnen), 6 (Formular, Rumpf `parts`) |
| Heizwert (8.3, R-A13) | 2 (nur ausdrücklich genannt), 6, 7 (Brennwert ≠ Heizwert) |
| KI schlägt nur vor, Mensch prüft | Global Constraints; 3 (nichts gespeichert, Test), 5, 6 |
| RawExtraction/Extraction-Grenze | 2 (Abweichung 1) |
| KI-Prüflauf mit erfundenen Belegen | 7 |

**2. Platzhalter.** Keine „TBD“. Stellen, die an Namen der Vorgänger hängen (Karte der Lieferungen, Felder von
`FuelForm`, Objektzeitraum auf der Seite Heizkosten), nennen die Annahme C1–C5 und was zu tun ist.

**3. Typen.** `ServiceStatementExtraction`, `ServiceBlock`, `ServiceUserLine`, `ServiceCo2Extraction`,
`FuelInvoiceExtraction`, `FuelInvoicePartExtraction` (Task 1) werden in Task 2 (Ausgänge), Task 3 (Routen,
Tests), Task 4 und 5 (Messdienst) sowie Task 6 (Lieferant) mit denselben Feldern benutzt; `ImportContext` und
`BlockDraft` (Task 4) in Task 5; `FuelPartForm` (Task 6) im Formular und in `fuelFormFromExtraction`.

**4. Review Focus.** 1 → Task 2 (Prompt) und Task 7 (`scoreFuel` „Rechnungsbetrag“); 2 → Task 2 „Review Focus
2“; 3 → Task 4 „Review Focus 3“, Task 5 (offene Zeile verhindert Übernehmen); 4 → Task 4 „Review Focus 4“;
5 → Task 4 „Review Focus 5“.
