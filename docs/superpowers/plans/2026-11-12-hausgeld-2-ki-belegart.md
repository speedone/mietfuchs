# Hausgeld (2/2), KI-Belegart „Hausgeldabrechnung“: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine hochgeladene Hausgeldabrechnung wird erkannt, in Kopf und Zeilen gelesen und öffnet das Blatt aus Teil 1 vorbelegt, mit Ampel je Zeile; gespeichert wird erst nach Durchsicht.

**Architecture:** Ein eigener Leseweg `extractHousing.ts` neben den Rechnungen (eigener Prompt, eigenes Schema) über die vorhandene KI-Schnittstelle `json(...)`. Ampel und Proben sind reine Funktionen in `shared/housingCheck.ts`. Das Ergebnis wird als Auswertung des Belegs gespeichert und vom Blatt gelesen; die Belegbuchung der Rechnungen (`bookingPlan.ts`) bleibt unberührt.

**Tech Stack:** wie Teil 1, dazu die KI-Schnittstelle unter `server/src/ai/` und der KI-Prüflauf unter `scripts/ai-eval/`.

**Spec:** `docs/superpowers/specs/2026-11-12-hausgeld-design.md`, Abschnitt „KI-Belegart“. Baut auf `2026-11-12-hausgeld-1-klammer.md` auf. Vorher lesen: `server/src/ai/CLAUDE.md` ganz, `server/src/extract.ts` (Ablauf, Zeitlimits, rohe Antwort und Zusage).

## Global Constraints

- Zweig `feat/hausgeld-ki`, gestapelt auf `feat/hausgeld-klammer`. Commits mit `Refs #102`; Ende `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Regeln aus Teil 1 gelten weiter.
- **Für KI-Anfragen nie `fetch` direkt**, nur die Schnittstelle aus `server/src/ai/index.ts`; die Bestätigung externer Dienste wird dort durchgesetzt und nicht umgangen.
- Die rohe Antwort des Modells ist nie die Zusage: Jedes Feld wird geprüft und geradegerückt (`null` statt Raten), wie bei den Rechnungen (#63).
- Die Kostenarten im Schema sind dieselbe Liste wie bei den Rechnungen (categories.test.ts).
- **Nichts wird ohne Bestätigung gespeichert.** Die Auswertung schreibt nur die Auswertung des Belegs, nie eine Kostenposition.
- Schwellen der Ampel: Abweichung gelb ab mehr als 1 € **und** mehr als 2 %. Stichwörter für „klingt nicht umlagefähig“: `verwalt`, `rücklage`, `ruecklage`, `instandhalt`, `instandsetz`, `reparatur`, `kontoführung`, `kontofuehrung`, `bankgebühr`, `bankgebuehr`, `rechtsanwalt`, `versammlung` (klein verglichen).
- Beispielabrechnungen nur erfunden (Namen, Adressen, Verwaltung), keine echten Vorlagen fremder Software.
- Der Fristhinweis aus #102 (Jahresfrist ohne Beschluss der Gemeinschaft) wird nur geschrieben, wenn BGH VIII ZR 249/15 im Original gelesen ist; Fundstelle mit Randnummer dann ins Rechtsregister.

## Review Focus

1. **Abrechnung über zwei Seiten mit Zwischensummen**: Zwischensummen und die Gesamtsumme werden keine Zeilen (Task 1 Test, Prüflauf).
2. **Gutschrift oder Erstattung als negative Zeile**: bleibt negativ, die Summenprobe stimmt (Task 1, Task 2 Test).
3. **„Hausmeister inkl. Kleinreparaturen“ als umlagefähig eingeordnet**: gelb mit dem Grund, nicht vorab angehakt (Task 2 Test).
4. **Beleg nennt andere Miteigentumsanteile als die Stammdaten**: Probe mit beiden Zahlen im Satz, kein stilles Überschreiben (Task 2, Task 4 Test).
5. **Abbruch mitten in der Auswertung und erneutes Öffnen aus dem Posteingang**: kein halbes Blatt, zweites Öffnen wertet neu aus bzw. zeigt die gespeicherte Auswertung (Task 3 Test).

---

### Task 1: Lesen `extractHousing.ts`

**Files:**
- Create: `server/src/extractHousing.ts`
- Modify: `server/src/extract.ts` (`classifyDocType` um `hausgeld`), `shared/types.ts` (`HousingExtraction`)
- Test: `server/test/extract-housing.test.ts`

**Interfaces:**
- Consumes: `json({ prompt, images, schema, timeoutMs, signal, onProgress })` aus `server/src/ai/index.ts`; Seitenbilder und Textebene wie `extractFromFile`.
- Produces:
  - `export type HousingExtraction` wie in der Spec
  - `export const HOUSING_SCHEMA` (JSON-Schema), `export const HOUSING_PROMPT`
  - `export function toHousingExtraction(raw: unknown): HousingExtraction` (rein: prüft und rückt gerade)
  - `export async function extractHousing(filePath: string, mimetype: string, settings: AiCapableSettings, options: AskOptions): Promise<HousingExtraction>`
  - `classifyDocType(...)` liefert `'rechnung' | 'zaehler' | 'hausgeld'` (die vorhandenen Namen der beiden ersten beibehalten).

- [ ] **Step 1: Failing tests** `toHousingExtraction`: vollständige Antwort wird übernommen; Betrag als Text „180,00“ und als Zahl 180 → 18000; Text ohne Zahl → `null`; unbekannter Maßstab → `null`; Maßstab „MEA“, „Miteigentumsanteile“, „Wohnfläche“, „Einheiten“ → `mea`, `mea`, `area`, `units`; unbekannte Kostenart → über `matchCategory` bzw. den Weg der Rechnungen; Zeilen „Summe“, „Zwischensumme“, „Gesamt“, „Übertrag“ fallen weg; negative Zeile bleibt negativ; Datum in deutscher und ISO-Form; Zeile ohne Beschreibung fällt weg; `ownTotalCents` fehlt → `null`.
- [ ] **Step 2: Failing tests** `extractHousing` gegen den nachgebauten Dienst (server/testing/api.ts): gute Antwort; Antwort ohne `lines` → leere Liste, kein Wurf; Abbruch über `signal` wirft den Abbruch der Schnittstelle; ohne Bestätigung eines externen Dienstes kommt die vorhandene Ablehnung. `classifyDocType` mit Antwort `hausgeld`.
- [ ] **Step 3:** Tests → FAIL. **Step 4:** Implementieren. Der Prompt (deutsch, an das Modell gerichtet, also ohne Anrede-Regel) nennt: Kopf lesen, je Kostenzeile eigener Anteil und Gesamtkosten, Summenzeilen auslassen, Maßstab je Zeile nur bei Abweichung vom Kopf, nichts erfinden, fehlendes als `null`. **Step 5:** `npm run test:server` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 6: Commit** `Hausgeld: Hausgeldabrechnung per KI lesen (Refs #102)`.

---

### Task 2: Ampel und Proben `shared/housingCheck.ts`

**Files:**
- Create: `shared/housingCheck.ts`
- Test: `server/test/housing-check.test.ts`

**Interfaces:**
- Consumes: `HousingExtraction`, `isNotAllocable`, `createScorer` (shared/assessment.ts), `TrafficLight`.
- Produces:
  - `export const NOT_ALLOCABLE_WORDS: readonly string[]`
  - `export function soundsNotAllocable(description: string): boolean`
  - `export function scoreHousingLine(line: HousingExtraction['lines'][number], ctx: { ownMeasure: number | null; measure: ExternalMeasure | null; measureTotal: number | null; categoryGuessed: boolean; previousCategories: ReadonlySet<string> | null }): { level: TrafficLight; reasons: string[]; preselect: boolean }`
  - `export function sheetChecks(ex: HousingExtraction, ctx: { unitMea: number | null; period: BillingPeriod }): string[]`

- [ ] **Step 1: Failing tests**: `rot ohne eigenen Anteil`; `gelb bei geratener Kostenart`; `gelb bei Abweichung` (eigener Anteil 180,00 €, rechnerisch 195,00 € → Grund „Rechnerisch wären es 195,00 € (8,3 % mehr).“; 180,00 € gegen 180,90 € → grün, weil unter 1 €; 5,00 € gegen 5,50 € → grün, weil unter 1 €; 1.000,00 € gegen 1.015,00 € → grün, weil unter 2 %); `gelb, wenn die Kostenart im Vorjahr fehlte` (nur mit Vorjahr); `klingt nicht umlagefähig` (Review Focus 3: gelb, `preselect` false; dieselbe Zeile mit Kostenart „Nicht umlagefähig“ → kein solcher Grund); jedes Stichwort der Liste einzeln; `grün ist vorab angehakt, gelb und rot nicht`. `sheetChecks`: Summe der Zeilen 2.345,67 € gegen `ownTotalCents` 2.400,00 € → „Die Zeilen ergeben 2.345,67 €, der Beleg nennt 2.400,00 €.“; `ownMeasure` 91 gegen `unitMea` 87 → „Der Beleg nennt 91 Anteile, in den Stammdaten stehen 87.“; Zeitraum des Belegs 2024 gegen gewählten 2025 → Satz mit beiden Jahren; alles passend → leer.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** Tests → PASS; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Hausgeld: Ampel und Proben der gelesenen Hausgeldabrechnung (Refs #102)`.

---

### Task 3: Routen und gespeicherte Auswertung

**Files:**
- Modify: `server/src/index.ts` (die Routen der Belegauswertung um Zeile ~2280 bis 2350: Zweig `hausgeld`), `server/src/db/assessments.ts`, `server/src/db/schema.ts` (Herkunft `housing` in der Liste der Herkünfte; Spalte `housing` als JSON mit `json_valid` an `assessments`), `shared/types.ts` (`AssessmentSource`, `StoredAssessment.housing?: HousingExtraction | null`), `server/src/journalRoutes.ts`
- Create: Migration
- Test: `server/test/api-ki-beleg.test.ts`, `server/test/api-hausgeld.test.ts`, `server/test/api-belege.test.ts`

**Interfaces:**
- Produces:
  - Antwort der Auswertung bei Hausgeld: `{ file, kind: 'hausgeld', housing: { extraction: HousingExtraction; lines: { level; reasons; preselect }[]; checks: string[] }, stats }`
  - `GET /api/assessments/:id` liefert für Herkunft `housing` dasselbe `housing`-Objekt, frisch bewertet
  - `saveHousingSheet` (Teil 1) nimmt `assessmentId?: string` entgegen und vermerkt an der Auswertung, dass sie übernommen ist (der Beleg verlässt den Posteingang wie ein gebuchter Beleg).

- [ ] **Step 1: Failing tests**: `Hausgeldabrechnung wird erkannt und gelesen` (nachgebauter Dienst: Klassifikation `hausgeld`, dann die Zeilen) → Antwort wie oben, **keine** Kostenposition angelegt, eine Auswertung mit Herkunft `housing` gespeichert; `von Hand gewählte Belegart` (`docType: 'hausgeld'`) überspringt die Klassifikation; `erneutes Öffnen` liefert die gespeicherte Auswertung ohne zweiten Aufruf des Dienstes; `Abbruch` hinterlässt keine Auswertung; `Blatt speichern mit assessmentId` verknüpft Beleg und Klammer, der Posteingang führt den Beleg nicht mehr als offen; `eine Rechnung läuft unverändert` (bestehende Tests grün); Backup trägt die Spalte; Verlauf.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren, `db:generate`, SQL lesen. **Step 4:** `npm run test:server` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Hausgeld: Auswertung der Hausgeldabrechnung speichern und liefern (Refs #102)`.

---

### Task 4: Vorbelegtes Blatt in der Oberfläche

**Files:**
- Modify: `client/src/housingSheet.ts` (`sheetFromExtraction`), `client/src/components/HousingSheetDrawer.tsx`, `client/src/pages/Kosten.tsx`, `client/src/pages/BelegeEingang.tsx`, die Schnellerfassung, `client/src/aiUpload.ts`
- Test: `client/src/housingSheet.test.ts`, `client/src/components/HousingSheetDrawer.test.tsx`, `client/src/pages/kostenAusBeleg.test.tsx`, `client/src/pages/intakeInbox.test.tsx`

**Interfaces:**
- Produces: `export function sheetFromExtraction(housing, property, period, units): SheetForm` (Zeilen mit `preselect` false sind im Blatt abgewählt und werden beim Speichern ausgelassen, bis der Nutzer sie anhakt).

- [ ] **Step 1: Failing tests**: `Blatt aus der Auswertung`: Kopf und Zeilen vorbelegt, je Zeile die Ampel als Wort mit Gründen, grüne angehakt, gelbe und rote nicht; `Proben stehen über der Tabelle` (Review Focus 4, die Stammdaten werden nicht geändert); `abgewählte Zeilen werden nicht gespeichert`, die Fußzeile zählt nur angehakte; `Belegart wählbar` in Schnellerfassung, Posteingang und Kosten („Hausgeldabrechnung“ neben „Rechnung“), nur bei einem Objekt der Art Eigentumswohnung angeboten; `aus dem Posteingang geöffnet` zeigt dasselbe Blatt; `bei einem Haus` führt eine als Hausgeld erkannte Datei zur Meldung „Das sieht nach einer Hausgeldabrechnung aus. Dafür braucht es ein Objekt der Art Eigentumswohnung.“ mit der Wahl, sie als Rechnung auszuwerten.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** `npm test` → Exit 0; `npm run typecheck` → Exit 0; `npm run build` → Exit 0.
- [ ] **Step 5: Commit** `Hausgeld: gelesene Hausgeldabrechnung im Blatt prüfen und übernehmen (Refs #102)`.

---

### Task 5: KI-Prüflauf und Doku

**Files:**
- Create: drei erfundene Hausgeldabrechnungen unter `scripts/ai-eval/invoices/` (Erzeugung wie die vorhandenen Fälle: `invoice.js`/`invoice.css` lesen; je eine als PDF mit Textebene, als Scan, als Foto)
- Modify: `scripts/ai-eval/cases.json`, `scripts/ai-eval/score.mjs` (+ `score.d.mts`), `.github/workflows/ai-eval.yml` nur, wenn der Lauf die neue Belegart eigens aufrufen muss
- Modify: `server/src/ai/CLAUDE.md`, `server/src/CLAUDE.md`, `docs/ki-belegauswertung.md` (bzw. die Datei der Nutzerdoku dazu), `shared/glossary.ts`, `shared/guides.ts`, `CHANGELOG.md`
- Test: der Test zu `score.mjs`, falls vorhanden; sonst ein neuer `scripts`-naher Test im Server (`server/test/ai-eval-score.test.ts`)

- [ ] **Step 1: Failing test** der Bewertung: Fall mit zwölf erwarteten Zeilen; Ergebnis mit elf richtigen und einer falschen Kostenart → Punktzahl und Befund nennen die Zeile; fehlender Kopf zählt eigens; Summenzeile als Zeile gelesen zählt als Fehler (Review Focus 1).
- [ ] **Step 2:** Test → FAIL. **Step 3:** Fälle und Bewertung bauen; lokal einmal gegen ein eingerichtetes Modell laufen lassen und das Ergebnis in den PR-Text schreiben (kein Schlüssel ins Repo). **Step 4:** `npm test` → Exit 0; `npm run typecheck` → Exit 0; am PR das Label `ai-eval` setzen und das Ergebnis lesen.
- [ ] **Step 5: Commit** `Hausgeld: KI-Prüflauf mit erfundenen Hausgeldabrechnungen, Doku (Refs #102)`.

---

## Self-Review (vor dem PR)

Spec „KI-Belegart“: Erkennen und Lesen → Task 1; Ampel und Proben → Task 2; gespeicherte Auswertung → Task 3; vorbelegtes Blatt → Task 4; Prüflauf → Task 5. Der Fristhinweis hängt an der gelesenen Entscheidung (Global Constraints). Integrationsdurchsicht `main..feat/hausgeld-ki` unter Geld und Daten vor dem Merge.
