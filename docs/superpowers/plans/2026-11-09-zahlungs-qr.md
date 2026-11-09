# Zahlungs-QR-Code bei Nachzahlung: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein optionaler EPC-QR-Code (SEPA-Überweisung) auf Anschreiben bzw. Aufstellung, wenn der Mieter nachzahlt, mit IBAN und Empfänger aus dem (eingefrorenen) Anschreiben und einem Verwendungszweck als Baustein der Vorlage.

**Architecture:** Eine reine Funktion `epcPayload` in `shared/epcQr.ts` baut den Inhalt nach EPC069-12. Der Verwendungszweck ist ein neuer Baustein `paymentPurpose` des Anschreibens (dieselben Ebenen, dasselbe Einfrieren). Der Client entscheidet in einem reinen Modul, ob ein Code erscheint, und zeichnet ihn als SVG mit lean-qr; ein Schalter `printPaymentQr` in den Druckeinstellungen, ab Werk aus.

**Tech Stack:** TypeScript (Node 24 ohne Build, `.ts`-Importe im Server), React 19, Vite, node:test, vitest/jsdom, drizzle (SQLite), lean-qr 2.7.4, jsqr (nur Test).

**Spec:** `docs/superpowers/specs/2026-11-09-zahlungs-qr-design.md` (Issue #624). Vor jeder Aufgabe lesen.

## Global Constraints

- Worktree `/home/agent/projects/mietfuchs-zahlungs-qr`, Zweig `feat/zahlungs-qr`. Commits mit `Refs #624`, nie `Fixes`/`Closes`; Commit-Nachrichten deutsch, Ende `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commit nur nach grünem Exit-Status von Test **und** `npm run typecheck` (einzige statische Prüfung).
- Bezeichner englisch, Kommentare/Oberfläche/Testnamen deutsch; Oberfläche siezt, Entwicklerdoku duzt.
- **Kein Geviertstrich** im Repo (`server/test/geviertstrich.test.ts`); wo das Zeichen Daten ist, `'—'` schreiben.
- Geld in Cent als Integer. Server-Importe mit `.ts`, Client-Importe endungslos außer aus `shared/` (`.ts`). `import type` für reine Typen; kein `enum`.
- Neue Angabe ergibt ohne Einstellung das bisherige Verhalten; Golden-Tests bleiben unverändert grün.
- Migration nur mit `npm --prefix server run db:generate`, nie von Hand (Ausnahme laut server/src/db/CLAUDE.md, Abschnitt Migrationen, lesen).
- Server-Tests mit `NKA_DATA_DIR` (Wegwerf), `CI=1`, `NKA_UPDATE_URL` (geschlossener Port), `NKA_HOST=127.0.0.1`; dafür `startServerIn`/`startServerRaw` aus `server/testing/api.ts` nutzen.
- Testdaten über die Typen aus `shared/types.ts`; fehlende Werte mit `assert.fail` statt `!`/`as`.
- EPC-Werte: Fassung `002`, Zeichensatz `1`, `SCT`, BIC leer, Name ≤ 70 Zeichen, Betrag 1 bis 99 999 999 999 Cent, Zweck ≤ 140 Zeichen, gesamt ≤ 331 Byte UTF-8, Fehlerkorrektur M, Version ≤ 13, Byte-Modus **ohne ECI**, kein `\n` am Ende, nur IBANs aus EU-27 + IS, LI, NO.
- Vorgabe des Bausteins: `'{Name}, {Wohnung}, {Abrechnung}'`. Schalter-Text: „QR-Code zum Bezahlen bei Nachzahlung“. Kastentext: „Mit Ihrer Banking-App scannen“. Kein GiroCode-Logo oder -Name.

## Review Focus

1. **Objekt mit eigener IBAN und eigenem Vermieter**: Der Code trägt die Werte des Objekts, nicht der Einstellungen (Task 2 Test, Task 5 Test).
2. **Eingefrorene Abrechnung ohne `paymentPurpose`** (vor diesem Vorhaben abgeschlossen) mit Schalter an: kein Code, Druck unverändert (Task 4 Test).
3. **Langer Titel mit Halbgeviertstrich** („Betriebskosten 2026, darin Heiz- und Warmwasserkosten 01.05.2025–30.04.2026“) plus langer Name: Name bleibt erhalten, Datumsbereich mit `-`, ≤ 140 Zeichen (Task 1 Test).
4. **Gültige IBAN außerhalb des EWR** (CH, GB) oder leerer Vermietername bei Schalter an: kein Code, im Druckfenster der ruhige Grund (Task 1, Task 3 Test).
5. **Guthaben oder ausgeglichen** bei Schalter an: kein Code, auch ohne Anschreiben unter der Aufstellung (Task 5 Test).

---

### Task 1: EPC-Inhalt `shared/epcQr.ts`

**Files:**
- Create: `shared/epcQr.ts`
- Test: `server/test/epcQr.test.ts`

**Interfaces:**
- Consumes: `checkIban`/Normalisierung aus `shared/iban.ts` (vorhandene Exporte lesen und nutzen, nichts doppelt bauen).
- Produces:
  - `export type EpcInput = { name: string; iban: string; amountCents: number; purpose: string }`
  - `export function epcPayload(i: EpcInput): string | null`
  - `export function epcText(text: string): string` (Bereinigung nach SEPA-Zeichensatz, auch für die Textanzeige neben dem Code)
  - `export const EEA_COUNTRIES: readonly string[]`
  - `export const EPC_MAX_BYTES = 331`, `EPC_NAME_MAX = 70`, `EPC_PURPOSE_MAX = 140`
  - `export function epcBlocked(landlord: { landlordName: string; iban: string }): string | null` (ruhiger Grund für das Druckfenster, sonst `null`)

- [ ] **Step 1: Failing tests** (`node:test`, Namen deutsch):
  - `Musterinhalt Zeile für Zeile`: `epcPayload({ name: 'Max Vermieter', iban: 'DE02 1203 0000 0000 2020 51', amountCents: 12345, purpose: 'Erika Mustermann, EG links, Nebenkostenabrechnung 2025' })` gleich `['BCD','002','1','SCT','','Max Vermieter','DE02120300000000202051','EUR123.45','','','Erika Mustermann, EG links, Nebenkostenabrechnung 2025'].join('\n')`.
  - `Betrag an den Grenzen`: 1 → `EUR0.01`; 99999999999 → `EUR999999999.99`; 0, -5, 100000000000, 1.5 → `null`; 100 → `EUR1.00`.
  - `IBAN`: klein und mit Leerzeichen wird normalisiert; Prüfziffer falsch → `null`; gültige `CH93 0076 2011 6238 5295 7` und gültige GB-IBAN → `null`; gültige AT-, NO-, LI-IBAN → Inhalt.
  - `Name`: nur Leerraum oder nur Emoji → `null`; 80 Zeichen → 70.
  - `Zeichen`: `epcText('Müller–Lüdenscheidt „Haus“ · é—x\n\ty 🏠')` gleich `"Müller-Lüdenscheidt 'Haus' , e-x y"` (Leerraum zusammengezogen, getrimmt).
  - `Verwendungszweck`: leer → Inhalt endet nach Zeile 8 bzw. nach der Form, die der Builder aus EPC069-12 v3.0 belegt (im Test als Kommentar mit Abschnittsnummer festhalten); 200 Zeichen → 140; Titel `Betriebskosten 2026, darin Heiz- und Warmwasserkosten 01.05.2025–30.04.2026` mit Name vorn: Name bleibt, enthält `01.05.2025-30.04.2026`.
  - `331 Byte`: Name 70 × `ä`, Zweck 140 × `ü` → Ergebnis ≤ 331 Byte (`new TextEncoder().encode(x).length`), Zweck gekürzt, Name voll, kein halbes Zeichen; ein Fall, der genau 331 Byte ergibt, bleibt unverändert.
  - `kein Zeilenumbruch am Ende`.
  - `epcBlocked`: leerer Name → `'(braucht Vermieter und gültige IBAN aus dem EWR)'`; `CH93…` → derselbe Satz; gültige DE-IBAN und Name → `null`.
- [ ] **Step 2:** `npm --prefix server test -- --test-name-pattern "Musterinhalt|Betrag an den Grenzen|IBAN|Zeichen|Verwendungszweck|331 Byte"` → FAIL (Modul fehlt).
- [ ] **Step 3: Implementieren.** `epcText`: erst die Abbildungen der Spec (Striche → `-`, Anführungszeichen → `'`, `·`/`|` → `,`), dann NFD und Diakritika entfernen **außer** bei ä ö ü Ä Ö Ü (vorher schützen), dann alles außerhalb `[A-Za-z0-9 '\:?,\-(+.)/&*$%ÄÖÜäöüß]` entfernen, Leerraum zusammenziehen, trimmen. Kürzen nach Zeichen (Codepoints), dann bei Bytes > 331 den Zweck codepointweise vom Ende kürzen, danach den Namen.
- [ ] **Step 4:** Tests wie Step 2 → PASS; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Zahlungs-QR: Inhalt nach EPC069-12 (Refs #624)`.

---

### Task 2: Baustein `paymentPurpose` und Datenbank

**Files:**
- Modify: `shared/types.ts` (`LetterBlock`, `Settings.printPaymentQr?: boolean`)
- Modify: `shared/letter.ts` (`LETTER_BLOCKS`, `DEFAULT_LETTER_TEXTS`)
- Modify: `server/src/db/schema.ts:128` (`LETTER_BLOCKS`), Settings-Tabelle (Spalte `printPaymentQr: integer('print_payment_qr', { mode: 'boolean' })` neben `printFooter`, schema.ts ~1778)
- Create: Migration über `db:generate` (CHECK der drei Tabellen `letter_texts`, `property_letter_texts`, `tenancy_letter_texts` und neue Spalte)
- Test: `server/test/letter.test.ts`, `server/test/api-anschreiben.test.ts`, ggf. `server/test/migrations.test.ts`

**Interfaces:**
- Produces: `LetterBlock` enthält `'paymentPurpose'`; `StatementLetter.texts.paymentPurpose` (resolved, eingefroren beim Abschluss); `Settings.printPaymentQr?: boolean`.

- [ ] **Step 1: Failing tests** in letter.test.ts:
  - `der Verwendungszweck ist ein Baustein mit Vorgabe {Name}, {Wohnung}, {Abrechnung}`: `DEFAULT_LETTER_TEXTS.paymentPurpose === '{Name}, {Wohnung}, {Abrechnung}'`; `LETTER_BLOCKS` enthält `{ id: 'paymentPurpose', label: 'Verwendungszweck (QR-Code)', multiline: false }`.
  - `der Verwendungszweck ist kein Absatz`: `chooseLetterBlocks` und `statementBlocks` liefern ihn bei Nachzahlung, Guthaben, ausgeglichen nie.
  - `lettersOf setzt den Verwendungszweck ein`: mit Mieter „Erika Mustermann“, Wohnung „EG links“ → `texts.paymentPurpose === 'Erika Mustermann, EG links, Nebenkostenabrechnung 2025'`; Objektebene überschreibt Installation, Mieterebene überschreibt Objekt.
  - `abweichende IBAN und Vermieter am Objekt im Anschreiben`: Einstellungen `iban` DE…, Objekt `iban` AT…, `landlordName` „Erbengemeinschaft Becker“ → `values.IBAN` ist die formatierte AT-IBAN, `values.Vermieter` „Erbengemeinschaft Becker“.
  - Den bestehenden Test „die Vorgaben drucken die bisherigen Sätze wortgleich“ unverändert grün halten.
- [ ] **Step 2: Failing test** in api-anschreiben.test.ts: `der Verwendungszweck lässt sich je Ebene speichern`: `PUT /api/letter-texts` mit `{ paymentPurpose: 'NK {Wohnung}' }` → 200; Objekt- und Mieterebene ebenso; `{ paymentPurpose: '{Unbekannt}' }` → 400 mit „Verwendungszweck (QR-Code)“ im Satz. Und: `PUT /api/settings` mit `printPaymentQr: 'ja'` → 400 „„QR-Code zum Bezahlen bei Nachzahlung“ ist ja oder nein.“; mit `true` → 200 und `GET` liefert `true`.
- [ ] **Step 3:** `npm --prefix server test -- --test-name-pattern "Verwendungszweck|abweichende IBAN"` → FAIL.
- [ ] **Step 4: Implementieren.** Baustein in alle drei Listen; `when: 'nur bei einer Nachzahlung, im QR-Code; steht nicht im Brieftext'`. Schemaspalte, `npm --prefix server run db:generate`, erzeugtes SQL lesen (SQLite baut die drei Tabellen neu; Daten müssen erhalten bleiben). `read.ts`/`write.ts` wie `printFooter`; in `server/src/index.ts` (~Zeile 448) `['printPaymentQr', '„QR-Code zum Bezahlen bei Nachzahlung“']` in die Ja/Nein-Liste. Backup-Validator und Wiederherstellen prüfen, ob sie die Bausteinliste fest führen (grep `LETTER_BLOCKS`/`'signature'` unter server/src/db), und mitziehen.
- [ ] **Step 5:** `npm run test:server` → Exit 0 (inkl. migrations-, golden- und geviertstrich-Tests); `npm run typecheck` → Exit 0.
- [ ] **Step 6: Commit** `Anschreiben: Baustein Verwendungszweck und Schalter für den Zahlungs-QR-Code (Refs #624)`.

---

### Task 3: Schalter im Druckfenster

**Files:**
- Modify: `client/src/components/PrintDrawer.tsx` (`PrintSettings` um `printPaymentQr: boolean`)
- Modify: `client/src/pages/Abrechnung.tsx:124,182-188` (Entwurf `printDraft`, `printBefore`)
- Test: `client/src/pages/Abrechnung.anschreiben.test.tsx` (oder bestehender PrintDrawer-Test, falls vorhanden)

**Interfaces:**
- Consumes: `Settings.printPaymentQr` (Task 2), `epcBlocked` (Task 1).
- Produces: `printPaymentQr: boolean` in der Druckansicht (Standard `settings?.printPaymentQr === true`); `PrintDrawer`-Prop `qrBlocked: string | null` (der ruhige Grund oder `null`).

- [ ] **Step 1: Failing test** `Schalter für den QR-Code steht ab Werk aus und speichert`: Checkbox mit Namen „QR-Code zum Bezahlen bei Nachzahlung“ ist nicht angehakt; Anhaken und Speichern schickt `printPaymentQr: true` wie bei der Fußzeile. Zweiter Test: Vermieter ohne Namen oder IBAN `CH93…` → Text „(braucht Vermieter und gültige IBAN aus dem EWR)“ neben dem Schalter.
- [ ] **Step 2:** `npm --prefix client test -- Abrechnung.anschreiben` → FAIL.
- [ ] **Step 3: Implementieren** nach dem Muster `printFooter` (Speichern, Entwurf, Zurücksetzen). Den Grund liefert `epcBlocked(landlord)` aus Task 1 mit dem wirksamen Vermieter des Objekts (`effectiveLandlord`).
- [ ] **Step 4:** Test → PASS; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Druck: Schalter für den Zahlungs-QR-Code (Refs #624)`.

---

### Task 4: Entscheidung und Zeichnung des Codes im Client

**Files:**
- Create: `client/src/paymentQr.ts` (reine Logik), `client/src/components/PaymentQr.tsx` (Kasten)
- Modify: `client/package.json` (`lean-qr` `2.7.4` in dependencies, `jsqr` in devDependencies), `client/src/letter.css`
- Test: `client/src/paymentQr.test.ts`, `client/src/components/PaymentQr.test.tsx`

**Interfaces:**
- Consumes: `epcPayload`, `epcText` (Task 1); `StatementLetter`, `renderLetterText` aus `shared/letter.ts`; `formatIban` aus `shared/iban.ts`.
- Produces:
  - `export type PaymentQrData = { payload: string; name: string; iban: string; amountCents: number; purpose: string }`
  - `export function paymentQrOf(letter: Pick<StatementLetter, 'texts' | 'values'> | null, balanceCents: number, print: { date: string; attachments: number }, enabled: boolean): PaymentQrData | null` (IBAN aus `letter.values.IBAN`, Name aus `letter.values.Vermieter`, Betrag `-balanceCents`, Zweck `renderLetterText(letter.texts.paymentPurpose, print)`)
  - `export default function PaymentQr({ data }: { data: PaymentQrData }): JSX.Element`

- [ ] **Step 1: Failing tests** paymentQr.test.ts:
  - `Code nur bei Nachzahlung und eingeschaltet`: `balanceCents` -4000 und `enabled` true → `amountCents` 4000; +4000, 0, oder `enabled` false → `null`.
  - `eingefrorenes Anschreiben ohne Verwendungszweck ergibt keinen Code`: `texts` ohne Schlüssel `paymentPurpose` → `null`; mit leerem String → Code mit leerem Zweck.
  - `Verwendungszweck mit Datum und maskierter Klammer`: `texts.paymentPurpose` mit `{Datum}` und `x` → Zweck enthält das Datum als TT.MM.JJJJ und `x` ohne Klammern (der SEPA-Satz kennt keine `{}`).
  - `IBAN und Name aus dem Anschreiben`: `values.IBAN` „AT61 1904 3002 3457 3201“ → `iban` gleich der formatierten AT-IBAN, `payload` enthält `AT611904300234573201`.
- [ ] **Step 2: Failing test** PaymentQr.test.tsx: `der gezeichnete Code liest sich byte-gleich zurück`: Inhalt mit Umlauten, rendern; die Modulmatrix aus derselben lean-qr-Erzeugung (exportierte Hilfe `qrMatrix(payload)` in PaymentQr.tsx) in ein RGBA-Bild wandeln, mit `jsqr` dekodieren, `binaryData` als UTF-8 gleich `payload`. Weiter: `role="img"` mit `aria-label` „QR-Code für die Überweisung von 40,00 €“; daneben sichtbar „Mit Ihrer Banking-App scannen“, Empfänger, formatierte IBAN, Betrag, Zweck.
- [ ] **Step 3:** `npm install --prefix client lean-qr@2.7.4` und `npm install --prefix client -D jsqr`; `npm --prefix client test -- paymentQr PaymentQr` → FAIL.
- [ ] **Step 4: Implementieren.** lean-qr: `generate(mode.bytes(new TextEncoder().encode(payload)), { minCorrectionLevel: correction.M, maxCorrectionLevel: correction.M, maxVersion: 13 })`, SVG über `toSvgPath`/`toSvgSource` (Paket `lean-qr/extras/svg`) als React-`<svg><path d=…/></svg>` ohne `dangerouslySetInnerHTML`, Ruhezone 4 Module, Kantenlänge 30 mm im Druck (`letter.css`), weißer Hintergrund des Kastens, `break-inside: avoid`. Text neben dem Code mit `epcText`-bereinigtem Zweck (so steht daneben, was im Code steht).
- [ ] **Step 5:** Tests → PASS; `npm run typecheck` → Exit 0.
- [ ] **Step 6: Commit** `Zahlungs-QR: Kasten mit Code und Angaben (Refs #624)`.

---

### Task 5: Einbau in Anschreiben und Aufstellung

**Files:**
- Modify: `client/src/components/Letter.tsx` (Prop `paymentQr: PaymentQrData | null`, Kasten direkt nach dem Absatz `backPayment` in der `FLOW`-Schleife)
- Modify: `client/src/pages/Abrechnung.tsx:646-678` (`viewOf`: `paymentQr` berechnen, an `Letter` und unter `underTable` nach `backPayment` geben; in die Rückgabe von `viewOf` aufnehmen)
- Modify: `shared/letter.ts` (`exceedsOnePage(paragraphs, extraLines = 0)`), Konstante `PAYMENT_QR_LINES = 8`
- Test: `client/src/pages/Abrechnung.anschreiben.test.tsx`, `server/test/letter.test.ts`

**Interfaces:**
- Consumes: `paymentQrOf`, `PaymentQr` (Task 4), `printPaymentQr` (Task 3).

- [ ] **Step 1: Failing tests** in Abrechnung.anschreiben.test.tsx:
  - `QR-Code im Anschreiben bei Nachzahlung`: Schalter an, Mieter mit Nachzahlung → im Abschnitt „Anschreiben an …“ ein `img` „QR-Code für die Überweisung von …“, und er folgt dem Absatz „Es ergibt sich eine Nachzahlung …“.
  - `QR-Code unter der Aufstellung ohne Anschreiben`: `printLetter` false → Code nach dem Satz zur Nachzahlung unter der Tabelle.
  - `kein QR-Code bei Guthaben, ausgeglichen oder Schalter aus`.
  - `Objekt mit eigener IBAN`: Einstellungen DE-IBAN, Objekt AT-IBAN → Text im Kasten zeigt die AT-IBAN.
  - `abgeschlossene Abrechnung ohne eingefrorenen Verwendungszweck druckt keinen Code`.
- [ ] **Step 2: Failing test** letter.test.ts `der QR-Kasten zählt zur Seitenlänge`: ein Brief knapp unter 33 Zeilen ist mit `extraLines = PAYMENT_QR_LINES` über einer Seite.
- [ ] **Step 3:** `npm --prefix client test -- Abrechnung.anschreiben` und `npm --prefix server test -- --test-name-pattern "QR-Kasten"` → FAIL.
- [ ] **Step 4: Implementieren**; die Seitenprüfung der Druckansicht (`pageChecks`) und `exceedsOnePage`-Aufrufe in Abrechnung.tsx bekommen `extraLines`, wenn ein Code erscheint.
- [ ] **Step 5:** `npm test` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 6: Commit** `Zahlungs-QR im Anschreiben und unter der Aufstellung (Refs #624)`.

---

### Task 6: Editor der Vorlage

**Files:**
- Modify: `client/src/components/LetterDrawer.tsx:76-78` (und die Liste `shown` dort, wo sie aus `chooseLetterBlocks` entsteht; grep `shown` im Aufrufer)
- Test: `client/src/components/LetterTemplateCard.test.tsx` oder ein neuer `LetterDrawer.test.tsx`

**Interfaces:**
- Consumes: `paymentPurpose`, `EPC_PURPOSE_MAX`, `epcText`.

- [ ] **Step 1: Failing tests**:
  - `der Verwendungszweck zählt nicht zur Länge des Briefs`: ein sehr langer Zweck (500 Zeichen) löst die Warnung „mehr als eine Seite“ nicht aus.
  - `auf Mieterebene mit Nachzahlung ist der Verwendungszweck nicht „in diesem Anschreiben nicht“`.
  - `Hinweis bei mehr als 140 Zeichen`: Vorschau-Zweck nach `epcText` länger als 140 → Hinweis „Wird im QR-Code auf 140 Zeichen gekürzt.“ am Feld, Speichern bleibt möglich.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3: Implementieren**: `paymentPurpose` aus dem `exceedsOnePage`-Aufruf filtern; in der `shown`-Liste bei Nachzahlung ergänzen.
- [ ] **Step 4:** Test → PASS; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Vorlage: Verwendungszweck im Editor des Anschreibens (Refs #624)`.

---

### Task 7: Texte und Doku

**Files:**
- Modify: `shared/glossary.ts` (Eintrag „QR-Code zum Bezahlen“, gesiezt: was drinsteht, nur bei Nachzahlung, wird auf dem Rechner erzeugt, nichts geht ins Netz, Verwendungszweck in der Vorlage änderbar, IBAN am Objekt gilt)
- Modify: `docs/funktionsweise.md` (Absatz beim Anschreiben/Druck, geduzt)
- Modify: `server/src/CLAUDE.md` (Abschnitt „Anschreiben zur Abrechnung (#415)“: Baustein `paymentPurpose`, kein Absatz, eingefroren; Schalter `printPaymentQr` nur Druck), `client/CLAUDE.md` (PaymentQr-Kasten, Quelle der Werte)
- Modify: `CHANGELOG.md` „Unveröffentlicht“: `([#624](https://github.com/speedone/mietfuchs/issues/624))`
- Test: vorhandene Wächter (`anrede.test.ts`, `geviertstrich.test.ts`, Lexikon-Tests)

- [ ] **Step 1:** Texte schreiben.
- [ ] **Step 2:** `npm test` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 3: Commit** `docs: Zahlungs-QR-Code in Lexikon, Doku und Changelog (Refs #624)`.

---

## Abschluss

Durchsicht des ganzen Zweigs mit frischem Kontext (`main..feat/zahlungs-qr`, Geld: Betrag/IBAN/Empfänger stimmen mit dem Text überein; Daten: Migration, Backup, Wiederherstellen, eingefrorene Stände). Befunde mit vorher rotem Test beheben, in der PR-Beschreibung nennen. PR gegen `main` mit `Refs #624`; Merge erst nach grüner CI.
