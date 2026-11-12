# Kontoauszug (2/3), Zuordnen und Buchen: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zu jedem offenen Umsatz gibt es einen Vorschlag (Mietverhältnis, Art, Ampel); nach Bestätigung entstehen Zahlungen bzw. Kautionsbuchungen mit Verknüpfung, und eine Verknüpfung lässt sich lösen.

**Architecture:** Reine Module `match.ts` (Vorschlag) und `linkPlan.ts` (Plan aus Entscheidungen, Prüfmarke). `applyBankLinks` schreibt Zahlungen, Kautionsbuchungen und Links in einer Transaktion über die vorhandenen Einfügewege, damit `guardPayment` und die Prüfungen der Kaution gelten. Das Monats-Soll kommt aus `rentLedger`, nie neu gerechnet.

**Tech Stack:** wie Teil 1.

**Spec:** `docs/superpowers/specs/2026-11-12-kontoauszug-design.md`, Abschnitt „Zuordnen und Buchen“. Baut auf `2026-11-12-kontoauszug-1-import.md` und auf #228 Teil 1 (`insertDepositEntries`, `depositState`) auf.

## Global Constraints

- Zweig `feat/kontoauszug-zuordnung`, gestapelt auf `feat/kontoauszug-import`; `main` muss #228 Teil 1 enthalten. Commits mit `Refs #188`; Ende `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Regeln aus Teil 1 gelten weiter.
- **Nichts wird ohne Entscheidung gebucht.** Der Server bucht nur, was im Rumpf als Entscheidung steht.
- **Der Import setzt nie `designatedMonth`** (server/src/CLAUDE.md, Mietkonto).
- Datum der Zahlung = Buchungstag. Notiz = Verwendungszweck, auf 200 Zeichen gekürzt (`clip`).
- Eine Kaution wird nie Zahlung: Eingang → Kautionsbuchung `received`, Rückzahlung → `refunded`.
- Fenster „schon erfasst“: 7 Tage um den Buchungstag. Fenster Kaution: 31 Tage um den Mietbeginn.
- Golden-Tests bleiben unverändert grün.

## Review Focus

1. **Vermieter hat den Monat schon von Hand erfasst** und liest dann den Auszug ein: verknüpft, nicht doppelt gebucht; Ist und Steuer bleiben gleich (Task 1, Task 3 Test).
2. **Zwei Mietverhältnisse mit derselben IBAN** (Umzug im Haus, Paar mit zwei Wohnungen): Vorschlag nur, wenn am Buchungstag genau eines läuft (Task 1 Test).
3. **Rücklastschrift nach gebuchter Miete**: negative Mietzahlung am selben Mietverhältnis, das Mietkonto nimmt die jüngste Zuordnung zurück (Task 3 Test).
4. **Eine Überweisung für zwei Wohnungen**: aufteilen auf zwei Mietverhältnisse, Summe gleich dem Betrag; ein Cent zu viel → 400 (Task 2, Task 3 Test).
5. **Zahlung über die Mietkonto-Seite gelöscht**: der Umsatz ist wieder offen und bekommt wieder seinen Vorschlag (Task 3 Test).

---

### Task 1: Vorschlag `match.ts`

**Files:**
- Create: `server/src/bank/match.ts`
- Test: `server/test/bank-match.test.ts`

**Interfaces:**
- Consumes: `BankTransaction`, `BankLink`, `TenancyPayer` (Teil 1); `Tenancy`, `Payment`, `DepositEntry`; `depositState`.
- Produces:
  - `export type MatchContext = { tenancies: readonly Tenancy[]; payers: readonly TenancyPayer[]; payments: readonly Payment[]; linkedPaymentIds: ReadonlySet<string>; depositEntries: readonly DepositEntry[]; monthlySollCents: (tenancyId: string, month: string) => number | null }`
  - `export type Suggestion = { tenancyId: string; target: { type: 'newPayment'; kind: PaymentKind } | { type: 'existingPayment'; paymentId: string } | { type: 'deposit'; kind: 'received' | 'refunded' }; light: 'green' | 'yellow'; reason: string }`
  - `export function suggest(tx: BankTransaction, ctx: MatchContext): Suggestion | null`
  - `export function linkedCents(target: Payment | DepositEntry): number` (Zahlung: ihr Betrag; Kautionsbuchung: `received`/`interest` positiv, `applied`/`refunded` negativ) und `export function openCents(tx: BankTransaction, linked: readonly number[]): number` (0, wenn `setAside` gesetzt; `linked` sind die Beträge der verknüpften Ziele, der Link selbst trägt keinen)

- [ ] **Step 1: Failing tests** (je Regel der Spec):
  - `Mietverhältnis über die IBAN des Mieters`, `über einen gemerkten Zahler`; `IBAN mit Leerzeichen und klein` trifft.
  - `zwei Mietverhältnisse mit derselben IBAN`: am Buchungstag läuft eines → dieses; beide laufen → `null`; keines läuft → `null`.
  - `ohne bekannte IBAN kein Vorschlag`, auch wenn der Name des Mieters im Zweck steht.
  - `schon erfasst`: Zahlung 800 € am 03.03., Umsatz 800 € am 05.03. → `existingPayment`; am 12.03. → `newPayment`; schon verknüpfte Zahlung zählt nicht; zwei passende mit gleichem Abstand → `newPayment` gelb mit `reason` „Zwei erfasste Zahlungen passen. Bitte wählen Sie.“
  - `Rücklastschrift`: `reversal` und negativer Betrag → `newPayment` `rent`, gelb.
  - `Kaution`: Betrag gleich `depositCents`, 10 Tage nach Mietbeginn, ungleich Monats-Soll → `deposit` `received`, gelb; gleich Monats-Soll → Miete.
  - `Ausgang an den Mieter`: nach Mietende und Kautionsstand > 0 → `deposit` `refunded`; sonst `newPayment` `settlement`; beide gelb.
  - `Ampel`: Betrag gleich Soll des Buchungsmonats → grün mit `reason` „IBAN bekannt, Betrag wie Monatsmiete“; 10 € weniger → gelb „Betrag weicht vom Soll ab (800,00 €)“; Soll `null` → gelb.
  - `openCents`: Betrag 1600 €, verknüpfte Zahlung 800 € → 800 €; `setAside` → 0. `linkedCents`: `refunded` 2.400 € → −2.400 €.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** Tests → PASS; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Kontoauszug: Vorschlag für Mietverhältnis und Art (Refs #188)`.

---

### Task 2: Plan `linkPlan.ts`

**Files:**
- Create: `server/src/bank/linkPlan.ts`
- Test: `server/test/bank-link-plan.test.ts`

**Interfaces:**
- Produces:
  - `export type LinkDecision = { transactionId: string; parts: { tenancyId: string; amountCents: number; target: Suggestion['target'] }[] } | { transactionId: string; setAside: 'transfer' | 'notRental' | 'other' }`
  - `export type LinkWrite = { payments: (Pick<Payment, 'tenancyId' | 'date' | 'amountCents' | 'kind' | 'note'> & { transactionId: string })[]; depositEntries: (Pick<DepositEntry, 'tenancyId' | 'date' | 'kind' | 'amountCents' | 'note'> & { transactionId: string })[]; existing: { transactionId: string; paymentId: string }[]; setAside: { transactionId: string; reason: string }[] }`
  - `export type LinkPlan = { writes: LinkWrite; problems: { transactionId: string; message: string }[]; sentence: string }`
  - `export function planBankLinks(decisions: readonly LinkDecision[], open: readonly { tx: BankTransaction; openCents: number }[], ctx: MatchContext): LinkPlan`
  - `export function linkToken(plan: LinkPlan, decisions: readonly LinkDecision[]): string`
  - `export function parseLinkDecisions(raw: unknown): { decisions: LinkDecision[] } | { error: string }`

- [ ] **Step 1: Failing tests**: `eine Mietzahlung je Entscheidung` (Datum = Buchungstag, Notiz gekürzt auf 200, kein `designatedMonth`); `aufteilen` (zwei Teile, Summe gleich offenem Betrag; Summe größer → Problem „Die Teile ergeben mehr als den Umsatz (… statt …).“; kleiner ist erlaubt, der Rest bleibt offen); `Vorzeichen` (Teil mit anderem Vorzeichen als der Umsatz → Problem); `Kaution` (Betrag der Buchung positiv, auch bei `refunded` aus negativem Umsatz); `erfasste Zahlung` (anderes Mietverhältnis oder anderer Betrag als der Teil → Problem; schon verknüpft → Problem); `erledigter Umsatz` → Problem „Dieser Umsatz ist schon zugeordnet.“; `fremdes Mietverhältnis` → Problem; `Beiseitelegen`; `Satz` („3 Zahlungen gebucht, 1 Kautionsbuchung, 1 Umsatz mit erfasster Zahlung verknüpft, 2 beiseitegelegt.“ mit Einzahl); `parseLinkDecisions` lehnt alles ab, was nicht der Form entspricht, mit einem deutschen Satz.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** Tests → PASS; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Kontoauszug: Zuordnungen planen (Refs #188)`.

---

### Task 3: Buchen, Lösen, Routen

**Files:**
- Modify: `server/src/db/bank.ts` (`listOpenTransactions`, `applyBankLinks`, `removeBankLink`, `unsetAside`), `server/src/index.ts`, `server/src/journalRoutes.ts`, `server/src/db/read.ts` (`Payment.fromBank?: true` in `GET /api/payments`, aus dem Link gelesen), `server/src/db/repository.ts` (`guardPayment`) und `server/src/db/deposits.ts` (Betrag eines verknüpften Ziels nicht über den Umsatz hinaus, kein Umhängen auf ein anderes Mietverhältnis: 409 mit dem Satz der Spec)
- Test: `server/test/api-kontoauszug.test.ts`, `server/test/invariant-kontoauszug.test.ts`

**Interfaces:**
- Consumes: `insertPayments` bzw. der Einfügeweg einer Zahlung, `insertDepositEntries` (#228), `rentLedger` für `monthlySollCents`.
- Produces:
  - `GET /api/bank/transactions?state=open|done` → Umsätze mit `openCents`, `suggestion`, `links`
  - `POST /api/bank/links/plan` (`{ decisions }`) → `{ problems, sentence, token }`; in `DRY_RUN_ROUTES`
  - `POST /api/bank/links` (`{ decisions, token }`) → 200, 400 bei Problemen, 409 bei anderer Marke
  - `DELETE /api/bank/links/:id?payment=keep|delete` (Voreinstellung `keep`)
  - `PUT /api/bank/transactions/:id` (`setAside: null` holt einen Umsatz zurück)
  - Sätze: `retitleCurrentGroup` mit „n Umsätze aus dem Kontoauszug gebucht“; „Zuordnung gelöst“; „Umsatz zurückgeholt“.

- [ ] **Step 1: Failing tests** api-kontoauszug.test.ts:
  - `gebucht wie von Hand erfasst`: Bestand A liest einen Auszug mit zwölf Mieten ein und bucht alle; Bestand B erfasst dieselben zwölf Zahlungen von Hand (gleiches Datum, gleiche Notiz); `GET /api/rentledger/2025` und `GET /api/taxreport/2025` sind `deepStrictEqual` (Kennungen ausgenommen).
  - `schon erfasst wird verknüpft`: danach gleich viele Zahlungen wie vorher, der Umsatz erledigt.
  - `Rücklastschrift`: Mietkonto zeigt den Monat wieder offen.
  - `Kaution wird Kautionsbuchung`: keine neue Zahlung, `depositState` `erhalten`.
  - `aufteilen auf zwei Wohnungen`; `ein Cent zu viel` → 400.
  - `veraltete Marke` → 409, nichts gebucht.
  - `Lösen`: mit `keep` bleibt die Zahlung, mit `delete` fällt sie; der Umsatz ist wieder offen. Eine `existingPayment`-Verknüpfung (Link mit `created` 0) löscht die Zahlung auch bei `delete` nicht (sie stammt nicht aus dem Auszug) → 400 „Diese Zahlung haben Sie selbst erfasst. Löschen Sie sie bitte im Mietkonto.“
  - `Zahlung im Mietkonto gelöscht öffnet den Umsatz`.
  - `verknüpfte Zahlung im Mietkonto geändert`: von 800 € auf 700 € → gespeichert, der Umsatz ist mit 100 € wieder offen; auf 900 € → 409 mit dem Satz der Spec, nichts geändert; anderes Mietverhältnis → 409.
  - `ein Eintrag im Verlauf je Buchungslauf`, `Rücksprung davor` entfernt Zahlungen, Kautionsbuchungen und Links gemeinsam.
- [ ] **Step 2: Failing test** invariant-kontoauszug.test.ts, `die Verknüpfungen übersteigen nie den Umsatz`: 100 zufällige Folgen aus Buchen, Aufteilen, Lösen, Ändern und Löschen von Zahlungen (fester Startwert); nach jedem angenommenen Schritt gilt für jeden Umsatz: Summe der `linkedCents` seiner Ziele ≤ |Betrag| mit gleichem Vorzeichen, und keine Zahlung hängt an zwei Umsätzen.
- [ ] **Step 3:** Tests → FAIL. **Step 4:** Implementieren (alles in einem `writeData`; die Kennung der erzeugten Zahlung bzw. Buchung kommt in den Link, `created` 1; bei `existingPayment` `created` 0).
- [ ] **Step 5:** `npm run test:server` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 6: Commit** `Kontoauszug: Zuordnungen buchen und lösen (Refs #188)`.

---

## Self-Review (vor dem PR)

Spec „Zuordnen und Buchen“: Vorschlag 1 bis 4 → Task 1; Aufteilen, Beiseitelegen, Marke → Task 2; Buchen, Lösen, Verlauf → Task 3. Nähte für #292 und #308 bleiben unbebaut. Durchsicht mit frischem Kontext vor dem PR.
