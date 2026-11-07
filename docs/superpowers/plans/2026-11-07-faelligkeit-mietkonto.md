# Fälligkeit am Mietverhältnis, Rückstand ab dem Fälligkeitstag: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Monat zählt im Mietkonto nicht mehr pauschal ab dem Folgemonat als Rückstand (#133), sondern ab dem Tag nach dem spätesten erwarteten Eingang der Miete: Fälligkeitstag nach der Regel des Mietverhältnisses (Vorgabe: gesetzlich) und den Feiertagen am Ort, dazu vier Bankgeschäftstage für Überweisung und Buchung. Wer nichts einstellt, bekommt das gesetzliche Verhalten ohne Pflichtfeld; nie erscheint ein Rückstand zu früh.

**Architecture:** Reine Bausteine in `shared/rentDue.ts` (Fälligkeitstag je Monat und Regel, spätester Tag ohne Land, Bankgeschäftstage, erwarteter Eingang), Werte aus dem Rechtsregister. Drei neue Spalten an `tenancies` (`rent_due`, `rent_due_day`, `first_rent_at_start`), `NULL` heißt gesetzlich. `properties.state` kommt in den Schnappschuss. calc.ts fragt an **einer** Stelle (`monthDue` in `server/src/rentDueOf.ts` oder als Teil von `ledgerRows`), ab wann ein Monat Rückstand ist; dieselbe Stelle liest `tenancyAccount`, `ledgerRows` und `prepayment.arrears`. Die Tilgung (rentAllocation.ts) bleibt unverändert; `rentDueAtStartOf` liest die neue Regel mit.

**Tech Stack:** TypeScript, Express, SQLite über Drizzle (`npm --prefix server run db:generate`), React 19, node:test, vitest.

**Spec:** `docs/superpowers/specs/2026-11-07-faelligkeit-mietkonto-design.md`

## Global Constraints

- Ohne die neuen Angaben rechnen Abrechnung und Steuer wie heute; alle Golden-Tests (settlement-golden, db-golden, period-golden, heating-golden, heating-period-golden, tax-golden.json, tax-received-golden.json) bleiben centgenau grün. Ändert sich ein Golden-Wert, ist das ein Befund, kein neuer Sollwert.
- Ohne Stichtag (`asOf` fehlt: Steuer, Regression des Umstiegs, Tests) ist wie heute die ganze Spanne fällig.
- Kein Rückstand vor dem Tag nach `creditExpectedBy` (Entwurf E3). Die Rechnung des Rückstands hängt nie am Datum der Gutschrift als Beleg für Verzug.
- Feiertage zählen nur mit, wo alle am Tag geltenden Fassungen `checked` sind (Entwurf E6); sonst gilt für den Monat eine sichere Grenze ohne Feiertage (`startWorkday`: Rückstand ab dem Ersten des Folgemonats wie #133; `dayOfMonth` und `inArrears`: ab dem Ersten des übernächsten). Bis Task 1 alle 16 Länder gelesen hat, ändert Task 4 deshalb für heutige Monate nur `dayOfMonth`/`inArrears`-Fälle nach hinten.
- Gemeindeweise Feiertage zählen für den Rückstand als Feiertag (vorsichtig), in der Auskunft weiter nur als Hinweis.
- Tilgung nach § 366 BGB (rentAllocation.ts) unverändert, ihre Wächter bleiben grün.
- Der eingefrorene Eingang (`server/src/legacy/`) bleibt unangetastet; der Umstieg legt `NULL` an.
- Neue Spalten mit Bedingung in zwei erzeugten Migrationsschritten (server/src/db/CLAUDE.md), nie von Hand.
- Server: Importe mit `.ts`, `import type`, kein `enum`, `law()` mit Protokoll in calc.ts, `valueAt(…, LAW_AS_OF)` nur für Texte außerhalb einer Abrechnung. Keine Datumsliterale und Registerzahlen in calc.ts (law-literals.test.ts).
- Nutzertexte siezen, Doku duzen, kein Geviertstrich, keine Namen fremder Software.
- Commits deutsch mit `Refs #334`, nie `Fixes`/`Closes`. Gestapelte Zweige ab `main`, je Aufgabe ein PR.

## Review Focus

1. **Einzug am 09.10.2026, 0 € eingegangen** (Land NW): bis 13.10. „fällig am 13.10.“, 14. bis 19.10. „fällig seit 13.10., Eingang erwartet bis 19.10.“, ab 20.10. Rückstand mit „offen seit 13.10.“; nie „bisher bezahlt“ (Task 4, Task 5).
2. **Ohne Bundesland** fällt der Rückstand nie vor den Tag, den das späteste Land ergäbe (Invariante in Task 2 über alle Monate 2019 bis 2100).
3. **Altvertrag** (Vertrag vom 15.03.1998, nichts eingestellt): Rückstand für März 2026 erst nach dem 01.04.2026 plus Gutschrift, nie im März (Task 4).
4. **Vereinbarter Tag 15., Sonntag**: Fälligkeit Montag 16., Rückstand ab dem Tag nach dem vierten Bankgeschäftstag danach (Task 2, Task 4).
5. **Golden-Tests** und die Regression des Umstiegs unverändert (alle Tasks).

---

### Task 1: Feiertagsgesetze amtlich lesen, Register auf `checked`, Wächter präzisieren

Voraussetzung jeder Zahl mit Folgen (Auflage aus #290). Ergebnis des Nachlesens vom 07.11.2026 steht im Entwurf, Abschnitt „Landesrecht“: BY, BB, NI, SN amtlich gelesen und deckungsgleich; **BW, BE, HB, HH, HE, MV, NW, RP, SL, ST, SH, TH offen**, weil die Portale ohne Browser mit JavaScript nichts liefern. Diese Aufgabe liest die zwölf von Hand im Browser (oder im Gesetz- und Verordnungsblatt als PDF), hält je Land Gesetz, §, Wortlaut, Stand und URL fest und überträgt alles ins Register. Ohne diese Aufgabe bleibt Task 4 für Monate ab heute bei der sicheren Grenze (E6).

**Files:**
- Modify: `shared/law/feiertagsgesetze.ts` (Fundstellen, `checked`, `retrieved`; neue Fassung nur, wo ein Wert abweicht), `shared/law/register.ts` (`LAW_AS_OF`), `server/test/holidays.test.ts` (Wächter), `server/test/law-history.test.ts` (nur bei neuer Fassung eine Zeile ergänzen)
- Create: `shared/holidaysChecked.ts` (oder Export in shared/holidays.ts): `holidaysCheckedOn(date: string): boolean`

**Interfaces:**
- Produces:
  ```ts
  // true, wenn jede am Tag geltende Fassung jedes holiday.*-Parameters `checked` ist
  export function holidaysCheckedOn(date: string): boolean
  ```

- [ ] **Step 1: Failing tests** in `holidays.test.ts`:
  - `holidaysCheckedOn(LAW_AS_OF)` ist `true`, und ebenso für jeden Tag von `LAW_AS_OF` bis 31.12.2100 (je Fassungsgrenze geprüft, nicht jeder Tag).
  - Ein Tag, an dem eine geltende Fassung `adopted` ist (etwa 2017-10-31), ergibt `false`.
  - Der alte Wächter „Feiertage: der Server rechnet erst mit ihnen …“ wird ersetzt durch: Jede Datei unter `server/src`, die `shared/holidays.ts`, `shared/deadlines.ts` oder `shared/rentDue.ts` importiert, steht in einer benannten Liste (mit Grund), und `shared/rentDue.ts` fragt vor jedem Feiertag `holidaysCheckedOn` (Quelltextprüfung wie bisher).
- [ ] **Step 2: Run** `node --test server/test/holidays.test.ts` → FAIL.
- [ ] **Step 3:** Fundstellen aus dem Entwurf eintragen. Für jedes Land, dessen Gesetz amtlich gelesen ist, die geltende (offene) Fassung auf `checked` mit amtlicher URL; gilt ein Wert für mehrere Länder (`EVERYWHERE`), erst `checked`, wenn alle 16 gelesen sind. Länder, deren Portal nicht erreichbar war: im Entwurf als offen geführt, hier nachlesen (anderer Weg: Gesetz- und Verordnungsblatt). Ältere Fassungen bleiben `adopted`, `holidaysCheckedOn` gibt für sie `false`. `retrieved` und `LAW_AS_OF` auf den Tag des Lesens.
- [ ] **Step 4: Run** `node --test server/test/holidays.test.ts server/test/holidays-date-holidays.test.ts server/test/law*.test.ts` → PASS; `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `Feiertagsgesetze der Länder amtlich gelesen, geltende Fassungen geprüft (Refs #334, Refs #290)`.

**Aufwand:** M (Lesen der fehlenden Länder, mechanisches Eintragen; kein Verhalten).

### Task 2: Bausteine der Fälligkeit in `shared/`

**Files:**
- Create: `shared/rentDue.ts`, `server/test/rent-due.test.ts`
- Modify: `shared/law/bgb-betrkv.ts` (neue Parameter, siehe Interfaces), `shared/law/params.ts`, `server/test/law-history.test.ts` (SHIPPED), `server/test/law.test.ts`, `shared/holidays.ts` (Export für Feiertage einschließlich Gemeinden, falls nötig), `shared/deadlines.ts` (Kopfkommentar „Nichts wird still ersetzt“ berichtigen)

**Interfaces:**
- Produces:
  ```ts
  export type RentDueRule = 'startWorkday' | 'dayOfMonth' | 'inArrears' // fehlend: gesetzlich
  export type RentDueTerms = { rentDue?: RentDueRule; rentDueDay?: number; firstRentAtStart?: boolean; start: string; end: string | null; contractDate?: string }
  // Die wirksame Regel: gesetzlich -> 'startWorkday' oder 'inArrears' nach bgb.rent-due-at-start
  export function effectiveRentDue(t: RentDueTerms): RentDueRule
  // Fälligkeitstag des Monats `month` (JJJJ-MM) für ein Mietverhältnis, das in dem Monat besteht; `state` null = spätester aller Länder
  export function rentDueOn(t: RentDueTerms, month: string, state: FederalState | null): string
  // Spätester erwarteter Eingang: der vierte Bankgeschäftstag nach dem Fälligkeitstag
  export function creditExpectedBy(dueOn: string): string
  // Ab diesem Tag zählt der Monat als Rückstand (Tag nach creditExpectedBy); vor dem geprüften Zeitraum die bisherige Regel
  export function arrearsFrom(t: RentDueTerms, month: string, state: FederalState | null): string
  export function isBankBusinessDay(date: string): boolean
  ```
  Neue Register-Parameter (Fundstellen im Entwurf, Abschnitt Rechtslage):
  - `bgb.transfer-execution-days` (`eventDate`, Wert `{ afterCutoff: 1, execution: 1, paper: 1 }`, Eingang bei der Bank des Empfängers, §§ 675n Abs. 1, 675s Abs. 1 BGB, `checked`).
  - `practice.credit-booking-days` (`eventDate`, Wert 1, Buchung nach dem Eingang, Auslegung zu § 675t Abs. 1 BGB, `adopted`).
  - `practice.bank-closed-days` (`eventDate`, Wert `['12-24', '12-31']`, Rang Praxis, `adopted`, als Auslegung benannt).

- [ ] **Step 1: Failing tests** in `rent-due.test.ts`:
  - Volle Monate, `startWorkday`, Land gesetzt: gleich `rentDueDate(month, state)` für alle Länder und Monate 2019 bis 2040, außer wo ein Feiertag einzelner Gemeinden bis zum Fälligkeitstag fällt (dann ein Werktag später; Beispiel Fronleichnam in Sachsen im Juni eines Jahres, in dem er in die ersten Tage fällt, aus der Tabelle gesucht).
  - Ohne Land: `rentDueOn(…, null)` = Maximum über die 16 Länder (mit Gemeindefeiertagen), für jeden Monat 2019 bis 2100; nie früher als `rentDueDate(month, null)`.
  - Einzug 09.10.2026 (Freitag): `startWorkday` → 13.10.2026; mit `firstRentAtStart` → 09.10.2026; Einzug Samstag 10.10.2026 mit `firstRentAtStart` → Montag 12.10.2026 (§ 193 BGB).
  - `dayOfMonth` 15 im März 2026 (Sonntag) → 16.03.2026; `rentDueDay` 31 im Februar → letzter Tag, nach § 193 verschoben; Einzug am 20. mit Tag 15 → dritter Werktag ab dem 20.
  - `inArrears` März 2026 → Tag nach Monatsende, nach § 193 verschoben (01.04.2026 Mittwoch → 01.04.2026); Auszug am 15.06. → 16.06., verschoben.
  - Gesetzlich: Vertrag 15.03.1998 → `inArrears`; Beginn 01.09.2001 → `inArrears`; Beginn 02.09.2001 → `startWorkday` (Grenzfall wie `bgb.rent-due-at-start`).
  - `creditExpectedBy('2026-10-13')` → 19.10.2026; über Weihnachten: Fälligkeit 23.12.2026, 24., 25., 26. und 31.12. sowie 01.01. kein Bankgeschäftstag (aus der Regel nachrechnen und wörtlich festhalten).
  - Bankgeschäftstag: kein Sa/So, kein Feiertag in irgendeinem Land (auch Gemeinden), nicht 24.12./31.12.
  - `arrearsFrom` vor dem geprüften Zeitraum (Monat 2017-10): bei `startWorkday` Erster des Folgemonats, bei `dayOfMonth` und `inArrears` Erster des übernächsten, ohne Feiertage.
  - Einzugsmonat ohne geprüfte Feiertage: Einzug Fr 30.10.2026 → sichere Grenze 01.12.2026, nicht 01.11. (mit geprüften Feiertagen: fällig 03.11., erwartet bis 09.11.).
  - Invariante (fester Startwert, 2.000 Fälle): `arrearsFrom` liegt nie vor dem Tag nach `rentDueOn` und für `startWorkday` und volle Monate nie nach dem Ersten des Folgemonats.
  - Zeitzone: dasselbe Ergebnis unter drei TZ (Muster aus holidays.test.ts).
- [ ] **Step 2: Run** `node --test server/test/rent-due.test.ts` → FAIL.
- [ ] **Step 3:** Umsetzen; Feiertage nur über `holidaysCheckedOn`, sonst die bisherige Regel.
- [ ] **Step 4: Run** den Test, `node --test server/test/law*.test.ts server/test/deadlines.test.ts server/test/holidays.test.ts` → PASS; `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `Fälligkeit je Regel und erwarteter Eingang als Bausteine (Refs #334)`.

**Aufwand:** M.

### Task 3: Fälligkeit am Mietverhältnis speichern, Land in den Schnappschuss

**Files:**
- Modify: `shared/types.ts` (`Tenancy.rentDue`, `rentDueDay`, `firstRentAtStart`), `server/src/db/schema.ts` (`tenancies.rent_due`, `rent_due_day`, `first_rent_at_start` mit Bedingungen), Migrationen 0092 (Spalten) und 0093 (Bedingungen, Neubau) per `db:generate`, `server/src/db/read.ts`, `server/src/db/write.ts`/`repository.ts` (Merge, Prüfung mit deutschem Satz, 400), `server/src/snapshot.ts` (`SnapshotProperty` mit `state`, `SnapshotTenancy` mit den drei Feldern; alle Stellen, die den Schnappschuss bauen), `server/src/rentAllocation.ts` (`rentDueAtStartOf` liest `effectiveRentDue`), `server/src/calc.ts` (`januaryDueInWindow` für `dayOfMonth`)
- Test: `server/test/api-zahlungen.test.ts` oder neue Datei `server/test/api-faelligkeit.test.ts` (Thema Mietverhältnis/Fälligkeit), `server/test/schema.test.ts`, `server/test/migrations.test.ts`, `server/test/api-backup.test.ts` (Wiederherstellen eines Backups vor 0092), `server/test/db-changeover.test.ts` (Spalten `NULL` nach Umstieg), `server/test/api-journal.test.ts` (Änderung erscheint im Verlauf und lässt sich zurücknehmen), Steuer: `server/test/calc-steuer-zufluss*.test.ts` bzw. die Datei der Zehn-Tage-Regel

**Interfaces:**
- Consumes: Task 2 (`RentDueRule`, `effectiveRentDue`).
- Produces:
  ```ts
  Tenancy.rentDue?: 'startWorkday' | 'dayOfMonth' | 'inArrears'   // fehlend/null: gesetzlich
  Tenancy.rentDueDay?: number                                       // 1..31, nur bei 'dayOfMonth'
  Tenancy.firstRentAtStart?: boolean                                // gespeichert nur true
  SnapshotProperty.state?: FederalState | null
  ```
  Spalten: `rent_due` TEXT NULL, CHECK `rent_due IS NULL OR rent_due IN ('startWorkday','dayOfMonth','inArrears')`; `rent_due_day` INTEGER NULL, CHECK `(rent_due IS 'dayOfMonth') = (rent_due_day IS NOT NULL)` und `rent_due_day IS NULL OR rent_due_day BETWEEN 1 AND 31`; `first_rent_at_start` INTEGER NULL, CHECK `first_rent_at_start IS NULL OR first_rent_at_start = 1`.

- [ ] **Step 1: Failing tests:**
  - API (`startServerIn`, mit `NKA_DATA_DIR`, `CI=1`, `NKA_UPDATE_URL`): Mietverhältnis mit `rentDue: 'dayOfMonth', rentDueDay: 15` anlegen und lesen; Teilrumpf ohne die Felder lässt sie stehen; `rentDue: null` leert beide; 400 mit Satz bei `rentDueDay` ohne `dayOfMonth`, bei 0 und 32, bei unbekannter Regel, bei `firstRentAtStart: 'ja'`.
  - Migration: Bestand von 0091 hochgezogen, alle Mietverhältnisse `NULL`; Bedingungen greifen (Einfügen mit `rent_due_day` ohne Regel scheitert).
  - Backup aus 0.16.0 einspielen: läuft durch, Felder `NULL`. Umstieg aus db.json: Felder `NULL`, Regression grün.
  - Schnappschuss trägt `property.state` und die Felder des Mietverhältnisses.
  - Steuer: Mietverhältnis mit `inArrears` (ab 2010) verschiebt am Jahreswechsel nichts; mit `dayOfMonth: 15` nichts; mit `startWorkday` und Vertrag von 1998 verschiebt wie ein neuer Vertrag. Ohne Angabe: unverändert (tax-received-golden.json).
- [ ] **Step 2: Run** die Tests → FAIL.
- [ ] **Step 3:** Typen, Schema, `db:generate` zweimal (erst Spalten, dann Bedingungen), Lesen, Schreiben, Prüfung, Schnappschuss, `rentDueAtStartOf`.
- [ ] **Step 4: Run** `npm run test:server` → PASS (Golden unverändert); `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `Fälligkeit der Miete am Mietverhältnis, Bundesland im Schnappschuss (Refs #334)`.

**Aufwand:** M.

### Task 4: Mietkonto und Hinweis zur Vorauszahlung auf den Fälligkeitstag

**Files:**
- Modify: `server/src/calc.ts` (`tenancyAccount` um Zeile 1100: `dueEnd`; `ledgerRows` um Zeile 1216: `dueMonths`, Status, `dueSollCents`, neue Felder; `prepayment.arrears` um Zeile 9909: `dueInPeriod`; Kommentare zu #133 an allen drei Stellen), `server/src/rentAllocation.ts` (`MonthCoverage.coveredOn`, reine Ergänzung), `shared/types.ts` (`RentMonth.dueOn`, `creditExpectedBy`, `paidAfterExpected`; `RentLedgerRow.nextDue`), `server/testing/fifoLedger.ts` (Orakel mit eigener, einfacher Fälligkeitsrechnung über die Vergleichsliste `server/test/fixtures/holidays/`)
- Test: `server/test/calc-rueckstand.test.ts`, `server/test/calc-mietkonto-uebertrag.test.ts`, `server/test/invariant-mietkonto.test.ts`, `server/test/calc-notices.test.ts`, `server/test/heating-period-golden.test.ts` (nur prüfen)

**Interfaces:**
- Consumes: Task 2, Task 3.
- Produces:
  ```ts
  RentMonth.dueOn?: string             // Fälligkeitstag (nur mit Stichtag und Soll)
  RentMonth.creditExpectedBy?: string  // spätester erwarteter Eingang
  RentMonth.paidAfterExpected?: string // gedeckt erst nach creditExpectedBy: Tag der Deckung, nur Auskunft („zur Prüfung“)
  RentLedgerRow.nextDue?: { month: number; dueOn: string; creditExpectedBy: string } // nächster nicht gedeckter Monat ab dem Stichtag
  ```
  Status `notDue` heißt weiter „zählt noch nicht als Rückstand“ und gilt bis einschließlich `creditExpectedBy`; danach `open`/`partial`.

- [ ] **Step 1: Failing tests:**
  - calc-rueckstand: Einzug 09.10.2026, NW, Soll anteilig, keine Zahlung (aber eine Mietzahlung im Objekt, damit das Konto geführt wird): `asOf` 13.10. und 19.10. → Status `notDue`, `arrearsCents` 0, `dueOn` 2026-10-13, `creditExpectedBy` 2026-10-19; `asOf` 20.10. → `open`, `arrearsCents` = anteiliges Soll.
  - Voller Monat, Zahlung am 05.11.2026 eingegangen, `asOf` 10.11.: `paid`, kein `paidAfterExpected`. Zahlung am 20.11.: `paidAfterExpected` 2026-11-20, kein Rückstand nach dem 20.
  - Ohne Land, Januar 2027: `dueOn` = spätester aller Länder (07.01.2027), nicht 06.01.
  - Altvertrag 1998 ohne Angabe, März 2026, `asOf` 31.03.2026 → `notDue`; `asOf` nach `creditExpectedBy` des 01.04. → `open`.
  - `dayOfMonth` 15, März 2026 → `dueOn` 2026-03-16.
  - Vergangenes Jahr (2025 bei `asOf` 2026): alles fällig wie heute. Ohne `asOf`: wie heute.
  - `prepayment.arrears` in einer offenen Abrechnung mit `asOf` im laufenden Monat: Betrag zählt den laufenden Monat erst nach `creditExpectedBy`.
  - Invariante (invariant-mietkonto, fester Startwert, zufällige `asOf` und Regeln): (a) Rückstand nur für Monate mit `asOf` > `creditExpectedBy`; (b) `arrearsCents` steigt mit `asOf` nie ab; (c) für `startWorkday` liegt der Rückstand zwischen dem der alten Regel zum selben `asOf` und dem der alten Regel einen Monat später; (d) Summe der Teile, Salden und `openMonths` wie bisher gegen das Orakel (FIFO ab Beginn), mit dessen eigener Fälligkeitsrechnung.
  - Golden: alle unverändert (Global Constraints).
- [ ] **Step 2: Run** `node --test server/test/calc-rueckstand.test.ts server/test/invariant-mietkonto.test.ts` → FAIL.
- [ ] **Step 3:** Eine Funktion im Server (`monthDue(t, month, state, asOf)` → `{ dueOn, creditExpectedBy, arrears: boolean }`), gelesen von `tenancyAccount`, `ledgerRows` und `prepayment.arrears`; `coveredOn` in `monthCoverage`; Felder der Zeile.
- [ ] **Step 4: Run** `npm run test:server` → PASS; Invarianten mit den langen Läufen (`fuel-invariant`, `invariant-integration`, Zahl wie in scripts/CLAUDE.md „Prüfumfang je Anlass“) → PASS; `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `Mietkonto: Rückstand ab dem Fälligkeitstag statt ab dem Folgemonat (Refs #334)`.

**Aufwand:** L (drei Stellen, Orakel, Invarianten).

### Task 5: Oberfläche, Lexikon, Anleitungen, Doku

**Files:**
- Modify: `client/src/tenancyModel.ts` (Felder, Optionen `rentDueOptions`, Prüfung), `client/src/pages/Stammdaten.tsx` (Abschnitt „Fälligkeit der Miete“ im Seitenfenster des Mietverhältnisses, neben „Vertragsdatum“), `client/src/ledgerView.ts` (`rowStanding` mit `nothingDue` und `dueAwaiting`, `dueLine`, `rentDueNote` aus den Daten des Servers statt eigener Rechnung, `bookingDate`), `client/src/pages/Mietkonto.tsx` (Plakette, Zeile je Karte, Tooltip und `sr-only`), `client/src/pages/Muster.tsx`, `shared/glossary.ts` (Begriff `rentDue` „Fälligkeit der Miete“; `shortPeriod` „Zehn-Tage-Regel“ Satz „Eine abweichende Fälligkeit im Mietvertrag kennt Mietfuchs nicht“ berichtigen), `shared/guides.ts` (Mieterwechsel: erste Miete im Einzugsmonat), `docs/funktionsweise.md` (Mietkonto), `server/src/CLAUDE.md` (Fristen und Feiertage, Mietkonto), `CHANGELOG.md` (Unveröffentlicht, Link auf #334)
- Test: `client/src/ledgerView.test.ts`, `client/src/tenancyModel.test.ts`, jsdom-Test der Auswahl (angezeigter = gespeicherter Wert, auch für einen Wert, den die Optionen sonst nicht hätten), `client/src/pages/Mietkonto.test.tsx` (falls vorhanden, sonst neu), `server/test/guides.test.ts`, `server/test/glossary.test.ts`, `server/test/anrede.test.ts`

- [ ] **Step 1: Failing tests:**
  - `rowStanding`: keine Zahlung, nichts fällig → `nothingDue` („noch nichts fällig“); fällig, Eingang erwartet → `dueAwaiting` mit Datum; Rückstand → `arrears` wie bisher; „bisher bezahlt“ nur, wenn mindestens ein Monat fällig war und gedeckt ist.
  - Zeile je Karte: „Miete Oktober fällig am Di., 13.10.2026“, „fällig seit 13.10., Eingang erwartet bis 19.10.“, „offen seit 13.10.2026“ (aus `dueOn`, `creditExpectedBy`).
  - `paidAfterExpected`: Tooltip „eingegangen am 20.11., nach dem erwarteten Eingang; ob rechtzeitig überwiesen wurde, zeigt nur der Auftrag des Mieters“; kein Rot.
  - Stammdaten: Auswahl „Fälligkeit der Miete“ mit „Wie im Gesetz (…)“, „Zu Beginn des Monats, spätestens am dritten Werktag“, „An einem festen Tag des Monats“, „Nach Ablauf des Monats (Altvertrag)“; „Wie im Gesetz“ nennt bei einem Vertrag vor dem 02.09.2001 die nachträgliche Fälligkeit und den Satz zur Vorauszahlungsklausel. Tag nur bei festem Tag, Pflicht dort. Häkchen „Erste Miete schon bei Mietbeginn fällig“. Gesendet wird nur, was sich geändert hat.
  - Lexikon: Begriff mit nachgerechnetem Beispiel (Einzug 09.10.2026); guides.test.ts findet jede zitierte Beschriftung.
- [ ] **Step 2: Run** `npm --prefix client test -- ledgerView tenancyModel` → FAIL.
- [ ] **Step 3:** Umsetzen; `rentDueNote` liest die Daten der Zeile; Texte.
- [ ] **Step 4: Run** `npm run test:client` → PASS; `npm run test:server` → PASS; `npm run typecheck` → PASS; `npm run browser-check` (Mietkonto, Stammdaten) ohne Befund.
- [ ] **Step 5: Commit** `Oberfläche: Fälligkeit am Mietverhältnis, Mietkonto sagt „fällig seit“ und „offen seit“ (Refs #334)`.

**Aufwand:** M.

## Nach den Aufgaben

Je Zweig eine Durchsicht mit frischem Kontext vor dem PR; Befunde mit vorher rotem Test, in der PR-Beschreibung. Da Task 2 bis 5 aufeinander aufbauen: Integrationsdurchsicht `main..Spitze` unter Geld (Rückstand, `prepayment.arrears`, Zehn-Tage-Regel, Invarianten) und Daten (Migrationskette, Umstieg, Backup, Journal, Doku), Praxislauf auf der Spitze, Label `full-check`. Gemergt wird der Reihe nach, jeder PR erst nach Umstellen auf `main` und grüner CI. Vor dem Merge anhalten.
