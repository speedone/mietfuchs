# Kontoauszug (3/3), Seite und Doku: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Seite „Kontoauszug“ zum Einlesen, Zuordnen und für die Konten; dazu die Cockpit-Zeile, das Abweisen von Auszügen in Schnellerfassung und Posteingang, Lexikon, Doku und Praxislauf.

**Architecture:** Die Seite rendert nur; Entscheidungen (Zustand der Vorschau, Entscheidungen je Zeile, Texte) liegen im reinen Modul `client/src/bankView.ts`. Der Server liefert Vorschläge und Sätze fertig, der Client rechnet kein Geld. Das Abweisen fragt `looksLikeBankFile` vor jeder Auswertung.

**Tech Stack:** React 19, Vite, Tailwind v4 mit den Tokens des Projekts, vitest/jsdom, Playwright für `browser-check`.

**Spec:** `docs/superpowers/specs/2026-11-12-kontoauszug-design.md`, Abschnitte „Oberfläche“ und „Sicherheit und Datenschutz“. Baut auf den Plänen 1 und 2 auf. Vorher lesen: `client/CLAUDE.md` (Seitenfenster, Rückfragen, Meldungen, Leerzustände, Navigation, Stile).

## Global Constraints

- Zweig `feat/kontoauszug-seite`, gestapelt auf `feat/kontoauszug-zuordnung`. Commits mit `Refs #188`; Ende `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Oberfläche siezt; nur Tokens, keine Farbwerte, `index.css` wächst nicht (`uiRules.test.ts`).
- Auswahlfelder aus festen Optionslisten; der angezeigte Wert ist der gesendete.
- Wortlaute der Spec wörtlich: „Konto lückenlos eingelesen vom … bis …“, „Bewahren Sie die Kontoauszüge Ihrer Bank selbst auf. Mietfuchs ersetzt sie nicht.“, „Das ist ein Kontoauszug. Kontoauszüge lesen Sie auf der Seite Kontoauszug ein.“ Nirgends „GoBD“, „revisionssicher“, „Einnahmen vollständig“.
- Die Ampel ist nie nur Farbe: jede Zeile trägt den Grund als Text.
- Private Umsätze erscheinen nur in den Rückfragen der Vorschau und werden im Client nicht abgelegt (kein `localStorage`, kein Entwurf über `useDraft`).
- Vor dem Merge des Stapels: Integrationsdurchsicht Geld und Daten, Praxislauf, Label `full-check`, `npm run browser-check`.

## Review Focus

1. **Vorschau schließen oder Seite verlassen mit offenen Rückfragen**: Nichts ist gespeichert, kein Rest im Browser; erneutes Öffnen beginnt leer (Task 2 Test).
2. **„Alle grünen übernehmen“ bei 409**: Die neue Vorschau erscheint mit einem Satz, nichts ist gebucht, die Auswahl bleibt (Task 3 Test).
3. **Auszug als ZIP in den Posteingang gezogen, zusammen mit zwei Rechnungen**: Der Auszug wird abgewiesen, die Rechnungen laufen normal (Task 5 Test).
4. **Kein Konto, kein Umsatz**: Leerzustand mit einem Satz und dem Knopf zum Einlesen; keine leere Tabelle (Task 2 Test).
5. **Schmaler Bildschirm**: Die Tabelle der offenen Umsätze bleibt bedienbar (Karten statt Spalten nach dem Muster der vorhandenen Tabellen; `browser-check` mit axe grün) (Task 3).

---

### Task 1: Reines Modul `bankView.ts` und API-Aufrufe

**Files:**
- Create: `client/src/bankView.ts`
- Modify: `client/src/api.ts`, `shared/types.ts` (nur die Formen, die über die Leitung gehen und beide Seiten brauchen: `BankSuggestion`, `BankOpenTransaction`, `BankAccountView`, `BankImportPreview`; der Server importiert sie statt eigener Kopien)
- Test: `client/src/bankView.test.ts`

**Interfaces:**
- Produces:
  - `export type RowChoice = { tenancyId: string | null; target: 'rent' | 'settlement' | 'depositReceived' | 'depositRefunded' | 'existing'; paymentId?: string }`
  - `export function initialChoice(tx: BankOpenTransaction): RowChoice`
  - `export function decisionsOf(rows: readonly { tx: BankOpenTransaction; choice: RowChoice; selected: boolean }[]): LinkDecisionBody[]`
  - `export function greenRows(txs: readonly BankOpenTransaction[]): BankOpenTransaction[]`
  - `export const BANK_TARGET_OPTIONS`, `export const SET_ASIDE_OPTIONS` (Beschriftungen: „Miete“, „Nachzahlung oder Guthaben“, „Kaution erhalten“, „Kaution zurückgezahlt“, „mit erfasster Zahlung verknüpfen“; „Umbuchung zwischen eigenen Konten“, „gehört nicht zur Vermietung“, „Sonstiges“)
  - `export function coverageText(a: BankAccountView): string`
  - `export function questionProblems(questions, answers): FormProblem[]` (jede Rückfrage braucht eine Antwort; „Mieteingang“ braucht ein Mietverhältnis)

- [ ] **Step 1: Failing tests**: `Vorschlag wird zur Vorauswahl`; `ohne Vorschlag ist nichts gewählt und die Zeile nicht buchbar`; `nur ausgewählte Zeilen werden Entscheidungen`; `Ziel erfasste Zahlung trägt die Kennung`; `grüne Zeilen`; `Satz zur Lückenlosigkeit` für alle drei Fälle der Spec; `Rückfragen brauchen Antworten`.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** Tests → PASS; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Kontoauszug: Logik der Seite (Refs #188)`.

---

### Task 2: Seite, Teil „Einlesen“ und „Konten“

**Files:**
- Create: `client/src/pages/Kontoauszug.tsx`, `client/src/components/BankImportPreview.tsx`, `client/src/components/BankAccountsCard.tsx`
- Modify: `client/src/nav.ts` (Eintrag `kontoauszug` unter `mietkonto`), `client/src/App.tsx` bzw. die Stelle der Seitenzuordnung, `client/src/jumpTargets.ts`
- Test: `client/src/pages/Kontoauszug.test.tsx`, `client/src/nav.test.ts`

- [ ] **Step 1: Failing tests**: `Leerzustand` (Satz und Knopf „Kontoauszug einlesen“); `Datei wählen zeigt die Vorschau` (Befunde, Satz zum Ergebnis, Knopf „Übernehmen“ erst bedienbar, wenn `ready`); `Rückfrage zum Konto` mit dem Satz der Spec samt „Ein Kautionskonto lesen Sie hier bitte nicht ein.“; `Rückfrage je Eingang` (Auswahl „Mieteingang“, „Kaution“, „privat“; bei Mieteingang Mietverhältnis und Haken „Dieses Konto als Zahler merken“, ab Werk an); `Antwort ändert die Vorschau` (erneuter Plan-Aufruf mit `decisions`); `Übernehmen` ruft die zweite Route mit Datei, Antworten und Marke; `409 zeigt die neue Vorschau` mit „Der Bestand hat sich geändert. Bitte prüfen Sie die Vorschau noch einmal.“; `Abbrechen verwirft alles`; `Konten`: Art, Satz zur Lückenlosigkeit, Liste der Importe mit „Zurücknehmen“ (Rückfrage); `Nur für die Vermietung` mit Rückfrage „Ab jetzt wird jeder Umsatz dieses Kontos einzeln gespeichert, auch ein privater.“; der Satz zur Aufbewahrung steht auf der Seite.
- [ ] **Step 2:** `npm --prefix client test -- Kontoauszug nav` → FAIL. **Step 3:** Implementieren. **Step 4:** Tests → PASS; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Kontoauszug: Seite zum Einlesen und Konten (Refs #188)`.

---

### Task 3: Seite, Teil „Offene Umsätze“

**Files:**
- Create: `client/src/components/BankOpenTable.tsx`
- Modify: `client/src/pages/Kontoauszug.tsx`
- Test: `client/src/components/BankOpenTable.test.tsx`, `client/src/pages/Kontoauszug.test.tsx`

- [ ] **Step 1: Failing tests**: `Zeile zeigt Ampel mit Grund, Datum, Betrag, Gegenseite, Zweck, Vorschlag`; `Mietverhältnis und Ziel sind änderbar, der angezeigte Wert ist der gesendete`; `Alle grünen übernehmen (n)` schickt genau die grünen, fragt einmal nach und nennt Anzahl und Summe; `einzelne Zeile übernehmen`; `Beiseitelegen` mit Grund; `Aufteilen` (zweite Zeile unter dem Umsatz, Rest wird angezeigt, „Die Teile ergeben mehr als den Umsatz“ vom Server steht an der Zeile); `409` wie in Task 2, Auswahl bleibt; `erledigte Umsätze` hinter einem Umschalter mit „Lösen“ (Rückfrage mit der Wahl, die Zahlung zu behalten, ab Werk behalten) und „Zurückholen“ für Beiseitegelegtes.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** Tests → PASS; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Kontoauszug: offene Umsätze zuordnen (Refs #188)`.

---

### Task 4: Cockpit und Mietkonto

**Files:**
- Modify: `client/src/cockpitChecks.ts`, `client/src/pages/Cockpit.tsx`, `client/src/pages/Mietkonto.tsx`, `client/src/journalView.ts` (Beschriftungen der sechs Tabellen und ihrer Spalten)
- Test: `client/src/cockpitChecks.test.ts`, `client/src/pages/cockpitSprungziele.test.tsx`, `client/src/pages/mietkontoZahlungsart.test.tsx`, `client/src/journalView.test.ts`

- [ ] **Step 1: Failing tests**: Cockpit-Zeile „3 Umsätze aus dem Kontoauszug sind noch nicht zugeordnet“ (Einzahl „1 Umsatz … ist“), fehlt bei 0 und ohne Konto, springt auf die Seite; im Mietkonto trägt eine Zahlung mit `fromBank` den Vermerk „aus dem Kontoauszug“; der Verlauf nennt „Kontoumsatz“, „Verknüpfung“, „Konto“ statt Tabellennamen.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** `npm --prefix client test` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Kontoauszug: Cockpit-Zeile und Vermerk im Mietkonto (Refs #188)`.

---

### Task 5: Auszüge in Schnellerfassung und Posteingang abweisen

**Files:**
- Modify: `server/src/index.ts` (die Upload-Routen der Belegauswertung und des Posteingangs: vor Ablage und Auswertung `looksLikeBankFile`), `client/src/aiUpload.ts`, `client/src/pages/BelegeEingang.tsx` und die Schnellerfassung
- Test: `server/test/api-belege.test.ts`, `server/test/api-ki-beleg.test.ts`, `client/src/pages/intakeInbox.test.tsx`, `client/src/pages/erfassen.test.tsx`

**Interfaces:**
- Produces: Antwort 422 `{ error: 'Das ist ein Kontoauszug. Kontoauszüge lesen Sie auf der Seite Kontoauszug ein.', bankFile: true }`.

- [ ] **Step 1: Failing tests**: Server: camt, MT940 und ZIP damit an jeder der Routen → 422 mit `bankFile`, **keine Datei** im Belegordner oder Posteingang, der nachgebaute KI-Dienst bekommt keinen Aufruf; eine XRechnung und ein PDF laufen wie bisher. Client: Meldung mit Knopf „Zur Seite Kontoauszug“; drei Dateien, davon ein Auszug → zwei laufen, eine Meldung.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** `npm test` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Belege: Kontoauszüge abweisen und auf die Seite Kontoauszug führen (Refs #188)`.

---

### Task 6: Lexikon, Doku, Praxislauf, Bildschirmfotos

**Files:**
- Modify: `shared/glossary.ts` („Kontoauszug einlesen“, „Mischkonto“), `shared/guides.ts` (kurze Anleitung), `docs/funktionsweise.md`, `docs/datenschutz.md` (gesiezt: was gespeichert wird, was nie; keine KI), `docs/daten-backup.md`, `README.md` (eine Zeile unter den Funktionen), `CHANGELOG.md`, `server/src/CLAUDE.md` (neuer Abschnitt „Kontoauszug“), `server/src/db/CLAUDE.md` (Löschverhalten, letzter Satz zu adm-zip), `client/CLAUDE.md`, `scripts/umstieg-praxislauf.mjs`, `scripts/` für `screenshots` und `browser-check` (neue Seite aufnehmen)
- Test: `server/test/anrede.test.ts`, `server/test/geviertstrich.test.ts` (laufen von selbst)

- [ ] **Step 1:** Praxislauf um einen Fall erweitern: Auszug einlesen, zwei Umsätze buchen (eine Miete, eine Kaution), Backup, Wiederherstellen in leeren Ordner; danach sind die sechs Tabellen zeilengleich und der Umsatz noch verknüpft. Lauf → FAIL vor dem Fall, PASS danach.
- [ ] **Step 2:** Texte schreiben. Rechtsaussagen nur, was die Spec als gelesen führt; zur Aufbewahrung nur der eine Satz.
- [ ] **Step 3:** `npm test` → Exit 0; `npm run typecheck` → Exit 0; `npm run build` → Exit 0; `node scripts/umstieg-praxislauf.mjs` → Exit 0; `npm run browser-check` → Exit 0.
- [ ] **Step 4: Commit** `Kontoauszug: Lexikon, Doku und Praxislauf (Refs #188)`.

---

## Self-Review (vor dem PR)

Spec „Oberfläche“ Punkte 1 bis 4 → Tasks 2 und 3; Cockpit und Mietkonto → Task 4; Abweisen → Task 5; Datenschutz-Doku und Praxislauf → Task 6. Nach dem Merge: in #292 und #308 vermerken, dass die Nähte stehen; #188 bekommt `status: awaiting release`.
