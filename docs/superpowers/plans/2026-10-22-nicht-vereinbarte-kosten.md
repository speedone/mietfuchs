# Nicht vereinbarte Betriebskosten trägt der Vermieter: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Kostenposition kann für einzelne Mietverhältnisse „laut Mietvertrag nicht umgelegt“ sein; deren Anteil trägt der Vermieter (`notAgreed`), nie die übrigen Mieter. Bei „Sonstige Betriebskosten“ wird je Mieter gefragt, ob der Vertrag sie benennt.

**Architecture:** Eine Untertabelle `cost_item_contract` (Position, Mietverhältnis, im Vertrag ja/nein) wird im Modell zu zwei Listen an `CostItem`. calc.ts schließt an der vorhandenen Stelle `bookable` an (wie Pauschale und Inklusivmiete). Die Oberfläche fragt nur beim Abwählen von Teilnehmern, per Textlink und bei „Sonstige“; die Logik steht in einem reinen Modul `client/src/contractAgreement.ts`.

**Tech Stack:** TypeScript, Express, SQLite über Drizzle (`npm --prefix server run db:generate`), React 19, node:test, vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-umlagevereinbarung-design.md`

## Global Constraints

- Ohne Einträge rechnet Mietfuchs wie heute; alle Golden-Tests bleiben centgenau grün.
- Nicht erlaubt bei den Kostenarten „Heizung und Warmwasser“, „Nicht umlagefähig“, „Zuführung Erhaltungsrücklage“ (Server lehnt mit Satz ab).
- Nur Mietverhältnisse des Objekts der Position; ein gelöschtes Mietverhältnis nimmt seine Zeile mit (`onDelete: 'cascade'`).
- Neuer `LandlordReason` heißt `notAgreed`, Beschriftung „nicht vereinbart (Mietvertrag)“.
- Hinweis-Codes: `allocation.not-agreed` (`hint`), `allocation.other-unanswered` (`hint`); Begriffe `notAgreedCosts`, `namedOtherCosts`.
- Die Auslegung („trägt der Vermieter“) steht unter „Mehr dazu“ mit BGH, Urteil vom 31.05.2006, VIII ZR 159/05; „Sonstige“ mit BGH, Urteil vom 07.04.2004, VIII ZR 167/03; Heizung mit BGH VIII ZR 212/05.
- Nutzertexte siezen; Regeln aus client/CLAUDE.md (Hinweise, Verben, Felder, Entwürfe), server/src/db/CLAUDE.md (Migration nie von Hand ändern, Validator, read.ts/write.ts mechanisch).
- Commits: `Refs #258`, nie `Fixes`.

## Review Focus

1. **Mieterwechsel in der Wohnung im Zeitraum**: Nur das angehakte Mietverhältnis geht an den Vermieter, das andere trägt seinen Anteil (Test in Task 2).
2. **Schlüssel `amounts` und `direct`**: Der Einzelbetrag bzw. der ganze Betrag eines nicht vereinbarten Mieters geht an den Vermieter, nicht an `amountsRest` oder `vacancy` (Test in Task 2).
3. **Gutschrift (negativer Betrag)**: Vorzeichen bleibt, Summe stimmt (Invariante in Task 2).
4. **Position wechselt die Kostenart auf „Heizung und Warmwasser“**: Speichern mit vorhandenen Einträgen wird abgelehnt bzw. die Oberfläche leert sie mit Satz (Tests in Task 1 und Task 4).
5. **Übernahme aus dem Vorjahr, Mieter ausgezogen**: Die alte Kennung fällt heraus, die Zeile fragt nach dem neuen Mieter (Test in Task 5).

---

### Task 1: Modell, Tabelle, Lesen, Schreiben, Prüfen

**Files:**
- Modify: `shared/types.ts` (CostItem um zwei Felder, `LandlordReason` um `notAgreed` samt Kommentarzeile)
- Modify: `server/src/db/schema.ts` (neue Tabelle nach `costItemAmounts`)
- Create: `server/drizzle/0062_*.sql` per `npm --prefix server run db:generate`
- Modify: `server/src/db/read.ts`, `server/src/db/repository.ts` (`writeCostItemShares`, Zusammenführen im `PUT` neben `participantUnitIds`, Prüfung), `server/src/snapshot.ts` (Felder in `SnapshotCostItem`)
- Test: `server/test/api-kosten-vertrag.test.ts` (neu), `server/test/schema.test.ts` läuft mit

**Interfaces:**
- Produces: `CostItem.notAgreedTenancyIds?: string[] | null`, `CostItem.namedTenancyIds?: string[] | null`; Tabelle `cost_item_contract(cost_item_id, tenancy_id, in_contract integer boolean)`, Primärschlüssel beide Kennungen; Rumpffelder gleichen Namens bei `POST/PUT /api/cost-items`.

- [ ] **Step 1: Failing test** `api-kosten-vertrag.test.ts` mit `startServerIn`: Position „Gartenpflege“ anlegen mit `notAgreedTenancyIds: [t1]`, `namedTenancyIds: []`; `GET` liefert beide Listen. Zweiter Test: dieselben Felder bei Kostenart „Heizung und Warmwasser“ → 400 mit `/Heizkostenverordnung/`. Dritter: Kennung eines Mietverhältnisses aus einem anderen Objekt → 400. Vierter: `PUT` ohne die Felder lässt sie unverändert (Teilrumpf).
- [ ] **Step 2: Run** `node --test server/test/api-kosten-vertrag.test.ts` → FAIL.
- [ ] **Step 3:** Typen, Tabelle, Migration erzeugen, Lesen (beide Listen aus `in_contract` 0/1, ohne Zeilen Feld weglassen), Schreiben in `writeCostItemShares`, Prüfung im Repository (unbekannte oder fremde Kennung, verbotene Kostenart, dieselbe Kennung in beiden Listen → 400 mit Satz). Eine Kennung, die in beiden Listen steht, ist ein Fehler.
- [ ] **Step 4: Run** den Test und `node --test server/test/schema.test.ts server/test/migrations.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(kosten): nicht vereinbart und im Vertrag benannt je Mietverhältnis speichern`.

### Task 2: Berechnung und Hinweise

**Files:**
- Modify: `server/src/calc.ts` (`bookable` in der Verteilschleife, `landlordRecipients`, Hinweisregister bei `'prepayment.partial-month'`, neue Hinweise)
- Modify: `shared/glossary.ts` (zwei Begriffe), `client/src/landlordReasons.ts`
- Modify: `client/src/testing/noticeSamples.json` (neu erzeugt, siehe Kopf von noticeText.test.ts)
- Test: `server/test/calc-vertrag.test.ts` (neu), `server/test/calc.test.ts` (Invariante)

**Interfaces:**
- Consumes: Felder aus Task 1 über `SnapshotCostItem`.
- Produces: `LandlordPart` mit `reason: 'notAgreed'`; Hinweise `allocation.not-agreed` (Subjekt: Mietverhältnis, Text nennt Position, Mieter, Betrag), `allocation.other-unanswered` (Subjekt: Position, Text nennt die Mieter ohne Antwort und ihren Betrag, `fix` zur Position).

- [ ] **Step 1: Failing tests** in `calc-vertrag.test.ts`, Bestand über `emptyDb`/`tenancy`:
  - Zwei Wohnungen je 50 m², „Gartenpflege“ 1.000 € nach Fläche, `notAgreedTenancyIds: ['t1']`: Mieter t1 0 €, t2 500 €, Vermieter `notAgreed` 500 €.
  - Dieselbe Position mit `participantUnitIds: ['u2']` (heutiger Behelf) ergibt t2 1.000 €: der Unterschied ist gewollt (Test benennt ihn).
  - Mieterwechsel in u1 am 01.07. (t1a, t1b), nur t1a nicht vereinbart: t1a 0, t1b sein halber Anteil, Vermieter `notAgreed` den Anteil von t1a.
  - Schlüssel `amounts` mit `tenancyAmounts {t1: 300, t2: 200}` (€) und t1 nicht vereinbart: t1 0, t2 200, `notAgreed` 300, `amountsRest` 0.
  - Schlüssel `direct` auf u1, t1 nicht vereinbart: `notAgreed` 100 %.
  - „Sonstige Betriebskosten“ 200 €, keine Antwort für t1 und t2: Verteilung wie heute, Hinweis `allocation.other-unanswered` nennt beide; `namedTenancyIds: ['t1','t2']` → kein Hinweis.
  - Hinweis `allocation.not-agreed` für t1 mit Betrag „500,00 €“.
  - Steuer (Anlage V) unverändert: Werbungskosten der Position 1.000 €, nur die Umlage von t1 fehlt in den Einnahmen.
- [ ] **Step 2: Run** `node --test server/test/calc-vertrag.test.ts` → FAIL.
- [ ] **Step 3:** In der Verteilschleife `bookable(t)` zusätzlich `!item.notAgreedTenancyIds?.includes(t.id)`; in `notBooked` als Grund `notAgreed`, wenn das Mietverhältnis in der Liste steht (vor `modelFor`). In `landlordRecipients` Zeile `{ key: 'notAgreed', landlord: true, raw: sum('notAgreed') }` nach `inclusive`. Hinweise registrieren (Stufe, Titel, Begriffe) und je Mietverhältnis bzw. Position ausgeben. Begriffe im Lexikon mit Erklärung, Beispiel mit Zahlen (das aus Step 1), Rechtsgrundlage, „Brauche ich das?“. Beschriftung in landlordReasons.ts.
- [ ] **Step 4: Invariante** in `calc.test.ts`: `randomDb` setzt bei 20 % der umlagefähigen Positionen (nicht Heizung) ein zufälliges Mietverhältnis in `notAgreedTenancyIds`; zusätzlich prüfen, dass die Summe der übrigen Mieter gleich bleibt gegenüber derselben Rechnung ohne den Eintrag.
- [ ] **Step 5: Run** `npm run test:server` → PASS, Golden-Tests unverändert; `noticeSamples.json` neu erzeugen, `npm --prefix client test -- noticeText` → PASS.
- [ ] **Step 6: Commit** `feat(abrechnung): Anteil nicht vereinbarter Kosten trägt der Vermieter`.

### Task 3: Formularlogik (rein)

**Files:**
- Create: `client/src/contractAgreement.ts`, Test `client/src/contractAgreement.test.ts`
- Modify: `client/src/costForm.ts` (`ItemForm`, `itemToForm`, `buildCostItemBody`)

**Interfaces:**
- Produces:
  - `ItemForm.notAgreed: string[]`, `ItemForm.named: string[]`, `ItemForm.pendingWhy: string[]` (Wohnungen, die in diesem Fenster abgewählt und noch nicht beantwortet sind; wird nicht gesendet)
  - `contractTenancies(form: ItemForm, units: Unit[], tenancies: Tenancy[], period: BillingPeriod): { tenancyId: string, tenantName: string, unitId: string, unitName: string }[]` – Mietverhältnisse, die im Zeitraum bestehen und an der Position teilnehmen
  - `allowsContractAnswer(category: string): boolean`
  - `answerWhy(form: ItemForm, unitId: string, why: 'notConcerned' | 'contract', tenancyIds: string[]): ItemForm` – `contract`: Wohnung wieder Teilnehmer, Kennungen in `notAgreed`, aus `pendingWhy`; `notConcerned`: nur aus `pendingWhy`
  - Problem `{ field: 'participants', short: 'Bitte wählen Sie, warum', text: 'Teilnehmer: Bitte wählen Sie bei <Wohnung>, warum sie diese Kosten nicht trägt.' }` aus `buildCostItemBody`, solange `pendingWhy` nicht leer ist
  - `buildCostItemBody` sendet `notAgreedTenancyIds`/`namedTenancyIds` (leer → `null`), filtert auf `contractTenancies`, und leert beide bei einer Kostenart, für die `allowsContractAnswer` falsch ist

- [ ] **Step 1: Failing tests** für jede Funktion oben, darunter: Abwählen ohne Antwort ergibt das Problem; `answerWhy(…, 'contract', ['t1'])` macht u1 wieder zum Teilnehmer; Wechsel auf „Heizung und Warmwasser“ sendet `null` für beide; ein Mietverhältnis außerhalb des Zeitraums fällt heraus.
- [ ] **Step 2: Run** `npm --prefix client test -- contractAgreement costForm` → FAIL.
- [ ] **Step 3:** umsetzen.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(kosten): Formularlogik für nicht vereinbarte Kosten`.

### Task 4: Oberfläche im Seitenfenster der Kostenposition

**Files:**
- Create: `client/src/components/ContractAgreementFields.tsx`
- Modify: `client/src/pages/Kosten.tsx` (Abwählen in der Teilnehmerliste ruft die Frage auf; Abschnitt unter dem Schlüssel einbinden), `client/src/pages/Muster.tsx` (Abschnitt zeigen)
- Test: `client/src/components/ContractAgreementFields.test.tsx`, `client/src/pages/Kosten.test.tsx`

**Interfaces:**
- Consumes: Task 3.
- Produces: `<ContractAgreementFields form units tenancies period onChange errors />` mit drei Teilen:
  - **Warum-Frage** direkt unter einer Wohnung in `pendingWhy` (zwei Radiobuttons, Texte aus Spec 3; bei mehreren Mietverhältnissen Häkchen je Mietverhältnis unter der zweiten Antwort)
  - **Textlink** „Ein Mieter trägt das laut Mietvertrag nicht …“ (als `<details>`, offen, wenn `notAgreed` nicht leer), Häkchen je `contractTenancies`; nicht bei verbotenen Kostenarten
  - **„Sonstige“-Abschnitt** nur bei Kostenart „Sonstige Betriebskosten“: Einleitungssatz „Gehört die Position eigentlich zu einer anderen Kostenart, wählen Sie diese oben.“, dann je Mietverhältnis „Ja“/„Nein“ als Radiogruppe (`named` bzw. `notAgreed`)
  - bei „Heizung und Warmwasser“ statt der zweiten Antwort der Satz aus Spec 4

- [ ] **Step 1: Failing tests:** Abwählen von EG links zeigt „Warum trägt EG links diese Kosten nicht?“; „Steht nicht im Mietvertrag von Anna Becker“ hakt EG links wieder an und sendet `notAgreedTenancyIds: ['t1']` beim Speichern; „Speichern“ ohne Antwort meldet am Feld; ETW mit einer Wohnung: Textlink vorhanden, Häkchen sendet die Kennung; Kostenart „Sonstige“: Radiogruppen je Mieter, „Ja“ sendet `namedTenancyIds`; „Heizung und Warmwasser“: kein Textlink, Satz zur Heizkostenverordnung sichtbar.
- [ ] **Step 2: Run** `npm --prefix client test -- ContractAgreementFields Kosten` → FAIL.
- [ ] **Step 3:** umsetzen; `value` des Drawers umfasst die neuen Felder (S12b), Liste der Positionen zeigt „trägt nicht: Anna Becker (Vertrag)“.
- [ ] **Step 4: Run** dieselben Tests und `npm --prefix client test -- uiRules openFormGuard saveOnChange requiredFields` → PASS.
- [ ] **Step 5: Commit** `feat(kosten): nicht vereinbarte Kosten im Seitenfenster erfassen`.

### Task 5: Übernahme aus dem Vorjahr

**Files:**
- Modify: `client/src/carryOver.ts` (`carryOverRows` bekommt optional `tenancies`, `CarryRow.newTenants`), `client/src/pages/Kosten.tsx` (Zeile der Vorschau zeigt die Frage)
- Test: `client/src/carryOver.test.ts`

**Interfaces:**
- Produces: `CarryRow.newTenants: { unitId: string, unitName: string, tenancyId: string, tenantName: string, ask: 'contract' | 'named', answer: boolean | null }[]` – je Wohnung, deren Mietverhältnis aus `notAgreedTenancyIds`/`namedTenancyIds` im neuen Zeitraum nicht mehr besteht und die ein neues hat. `carryOverForm` übernimmt die Kennungen, die im neuen Zeitraum bestehen, und setzt die Antworten aus `newTenants` (`answer === false` → `notAgreed`, bei `named` `true` → `named`).

- [ ] **Step 1: Failing tests:** Vorjahr t1 in `notAgreed`, t1 bis 30.06., t1b ab 01.07. in derselben Wohnung, Übernahme ins Folgejahr: `newTenants` nennt t1b mit `ask: 'contract'`; Antwort „Nein“ → Rumpf enthält t1b in `notAgreedTenancyIds`; ohne Antwort weder t1 noch t1b. Unverändertes Mietverhältnis bleibt in der Liste.
- [ ] **Step 2: Run** `npm --prefix client test -- carryOver` → FAIL.
- [ ] **Step 3:** umsetzen; die Vorschauzeile zeigt „Neuer Mieter in EG links (Lea Schneider): Trägt sie diese Kosten laut Vertrag?“ bzw. „… im Vertrag ausdrücklich genannt?“ mit „Ja“/„Nein“.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(kosten): Übernahme fragt beim Mieterwechsel nach dem Vertrag`.

### Task 6: Doku, Changelog, Abschluss

**Files:**
- Modify: `CHANGELOG.md` („Hinzugefügt“, mit Link auf #258), `server/src/CLAUDE.md` (Berechnungs-Engine: `notAgreed`), `client/CLAUDE.md` (Abschnitt Formulare: Warum-Frage und Textlink), `shared/guides.ts` nur falls eine Anleitung Teilnehmer beschreibt (guides.test.ts grün halten)

- [ ] **Step 1:** Doku und Changelog schreiben.
- [ ] **Step 2: Run** `npm run typecheck && npm test` → PASS; `npm run browser-check -- --engines chromium --pages kosten,muster` → ohne Befund.
- [ ] **Step 3: Commit** `docs: nicht vereinbarte Kosten in Changelog und CLAUDE.md`; PR (nicht Draft) mit Label `full-check`, Durchsicht Geld und Daten.
