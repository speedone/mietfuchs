# Fristen (2/2), eigene Termine und Kalenderdatei: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eigene, auch wiederkehrende Termine (Rauchwarnmelder, Wartung) stehen in der Liste „Demnächst fällig“, und alle Termine lassen sich als Kalenderdatei speichern, ab Werk ohne Namen von Mietern.

**Architecture:** Eine Tabelle `custom_reminders` mit Routen; `remindersOf` nimmt sie als siebte Regel auf. Die Kalenderdatei schreibt ein reines Modul `server/src/ics.ts` nach RFC 5545 ohne Bibliothek.

**Tech Stack:** wie Teil 1.

**Spec:** `docs/superpowers/specs/2026-11-12-fristen-design.md`, Abschnitte „Eigene Termine“ und „Kalenderdatei“. Baut auf `2026-11-12-fristen-1-gerechnet.md` auf.

## Global Constraints

- Zweig `feat/fristen-termine`, gestapelt auf `feat/fristen-gerechnet`. Commits mit `Refs #190`; Ende `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Regeln aus Teil 1 gelten weiter.
- **Vor Task 2 RFC 5545 lesen** (Abschnitte 3.1, 3.3.4, 3.3.5, 3.3.10, 3.3.11, 3.6.1, 3.8.4.7, 3.8.7.2) und die Abschnittsnummer an jede Regel im Code schreiben.
- Kalenderdatei: `PRODID:-//Mietfuchs//Fristen//DE`, `VERSION:2.0`, `CALSCALE:GREGORIAN`, Zeilenende CRLF, höchstens 75 Oktette je Zeile, Fortsetzung mit einem Leerzeichen, kein UTF-8-Zeichen geteilt.
- Ab Werk ohne Namen: Mit `names=0` steht in keinem Feld der Name einer Person.
- Vorlagen: „Rauchwarnmelder prüfen“ (12), „Heizung warten“ (12), „Schornsteinfeger“ (12), „Eigener Termin“ (keine). „Legionellenprüfung“ nur, wenn der Builder die Frist in der geltenden Trinkwasserverordnung selbst gelesen hat; Fundstelle dann in den Kommentar.
- Unter der Vorlage Rauchwarnmelder wörtlich: „Wer prüfen muss und wie oft, regeln die Bauordnung Ihres Landes und die Anleitung des Herstellers.“ Keine weitere Aussage dazu.
- `title` höchstens 120 Zeichen, `repeat_months` 1 bis 120.

## Review Focus

1. **Termin am 31.01. mit monatlicher Wiederholung**: „Erledigt“ ergibt 28./29.02., danach 31.03. (der Ursprungstag bleibt maßgeblich, nicht der gekürzte) (Task 1 Test).
2. **Seit drei Jahren überfälliger Jahrestermin**: „Erledigt“ rückt bis nach heute vor, nicht nur um ein Jahr (Task 1 Test).
3. **Titel mit Komma, Semikolon, Umbruch, Emoji und 120 Zeichen**: Die Kalenderdatei bleibt gültig und liest sich zurück (Task 2 Test).
4. **Wohnung oder Objekt eines Termins gelöscht**: Der Termin fällt mit; ein Termin für alle Objekte bleibt (Task 1 Test).
5. **Kalenderdatei ohne jeden Termin**: gültige leere Datei, kein Fehler (Task 2 Test).

---

### Task 1: Eigene Termine

**Files:**
- Modify: `server/src/db/schema.ts` (`customReminders`), `server/src/db/journal.ts` (`TABLE_KINDS`: `settings`), `server/src/db/errors.ts`, `server/src/journalRoutes.ts`, `server/src/index.ts`, `server/src/reminders.ts` (Regel 7), `shared/types.ts` (`CustomReminder`)
- Create: `server/src/db/customReminders.ts`, Migration
- Test: `server/test/api-fristen.test.ts`, `server/test/reminders.test.ts`

**Interfaces:**
- Produces:
  - `CustomReminder = { id: string; propertyId: string | null; unitId: string | null; title: string; dueOn: string; anchorDay: number; repeatMonths: number | null; note?: string; doneOn?: string }` (`anchorDay` = Tag des ersten Termins, Spalte `anchor_day`, damit die Wiederholung nach einem gekürzten Monat zum Ursprungstag zurückkehrt)
  - `export function nextDue(dueOn: string, anchorDay: number, repeatMonths: number, today: string): string`
  - Routen `GET/POST /api/custom-reminders`, `PUT/DELETE /api/custom-reminders/:id`, `POST /api/custom-reminders/:id/done`; Sätze „Termin angelegt/geändert/gelöscht/erledigt“.

- [ ] **Step 1: Failing tests**: `nextDue`: 31.01.2026, Tag 31, monatlich, heute 05.02.2026 → 28.02.2026; von dort heute 01.03.2026 → 31.03.2026; Jahrestermin 01.06.2023, heute 12.11.2026 → 01.06.2027; Termin heute fällig → nächster. Routen: anlegen, ändern, löschen; 400 bei leerem Titel, 121 Zeichen, `repeatMonths` 0 und 121, Wohnung aus anderem Objekt; `done` mit Wiederholung rückt vor und lässt `doneOn` leer, ohne Wiederholung setzt `doneOn` und der Termin fehlt in `GET /api/reminders`; `done` ein zweites Mal ohne Wiederholung → 409; Termin erscheint als `custom` mit `title` wie eingegeben, `jump` auf die Karte; Löschen von Wohnung bzw. Objekt nimmt ihn mit, ein Termin ohne Objekt bleibt; Verlauf und Rücksprung über „Erledigt“.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren, `db:generate`, SQL lesen. **Step 4:** `npm run test:server` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Fristen: eigene Termine mit Wiederholung (Refs #190)`.

---

### Task 2: Kalenderdatei

**Files:**
- Create: `server/src/ics.ts`
- Modify: `server/src/index.ts` (`GET /api/reminders.ics`)
- Test: `server/test/ics.test.ts`, `server/test/api-fristen.test.ts`

**Interfaces:**
- Produces:
  - `export function icsText(value: string): string` (Maskierung nach 3.3.11)
  - `export function foldLine(line: string): string` (3.1)
  - `export function icsCalendar(reminders: readonly Reminder[], custom: readonly CustomReminder[], opts: { names: boolean; now: string }): string`
  - Route liefert `text/calendar; charset=utf-8` mit `Content-Disposition: attachment; filename="mietfuchs-fristen.ics"`.

- [ ] **Step 1: Failing tests**: `Maskierung` (`a,b;c\\d` und Umbruch → `a\\,b\\;c\\\\d\\n`); `Faltung` (Zeile aus 100 × `ä`: jede Zeile ≤ 75 Oktette, Fortsetzungen beginnen mit Leerzeichen, entfaltet byte-gleich, kein Ersatzzeichen); `ganztägiges Ereignis` (`DTSTART;VALUE=DATE:20261231`, `DTEND;VALUE=DATE:20270101`, `UID:` aus der Kennung mit `@mietfuchs`, `DTSTAMP` aus `now` in UTC); `Termine ohne Tag fehlen`; `Wiederholung` (`RRULE:FREQ=MONTHLY;INTERVAL=12`, und nur ein Ereignis je wiederkehrendem Termin); `ohne Namen`: Bestand mit Mieter „Erika Mustermann“, `names: false` → die Datei enthält weder „Erika“ noch „Mustermann“; mit `names: true` steht `detail` in `DESCRIPTION`; `leere Liste` → nur Kopf und Fuß; `alles endet mit CRLF`, kein einzelnes LF; `Rundweg`: die Datei mit einem Leser als Entwicklungsabhängigkeit der Wurzel zurücklesen (Lizenz mit AGPL verträglich, sonst ein Leser im Test, der entfaltet und Felder trennt), Titel mit Komma, Semikolon, Umbruch, Emoji und 120 Zeichen kommt gleich zurück. Route: Kopfzeilen, `names=1` und `names=0`, unbekannter Wert → 400.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** `npm run test:server` → Exit 0; `npm run typecheck` → Exit 0.
- [ ] **Step 5: Commit** `Fristen: Termine als Kalenderdatei (Refs #190)`.

---

### Task 3: Oberfläche und Doku

**Files:**
- Create: `client/src/customReminderForm.ts`, `client/src/components/CustomReminderDrawer.tsx`
- Modify: `client/src/components/RemindersCard.tsx`, `client/src/api.ts`, `client/src/journalView.ts`, `shared/glossary.ts`, `docs/funktionsweise.md`, `CHANGELOG.md`, `server/src/CLAUDE.md`, `client/CLAUDE.md`
- Test: `client/src/customReminderForm.test.ts`, `client/src/components/CustomReminderDrawer.test.tsx`, `client/src/components/RemindersCard.test.tsx`

**Interfaces:**
- Produces: `REMINDER_TEMPLATES: readonly { id: string; title: string; repeatMonths: number | null; hint?: string }[]`; `REPEAT_OPTIONS` („einmalig“, „monatlich“, „vierteljährlich“, „halbjährlich“, „jährlich“, „alle zwei Jahre“, „alle drei Jahre“, „alle fünf Jahre“); `customReminderBody(form)`.

- [ ] **Step 1: Failing tests**: `Vorlage füllt Titel und Wiederholung, beides bleibt änderbar`; `der Satz unter der Vorlage Rauchwarnmelder` wörtlich; `Wiederholung: angezeigter Wert ist der gesendete`, auch für einen gespeicherten Wert außerhalb der Liste (etwa 18 Monate → eigene Option „alle 18 Monate“); `Objekt und Wohnung wählbar, „alle Objekte“ ab Werk bei mehreren`; `Erledigt` an der Zeile mit Rückmeldung „Nächster Termin am …“ bzw. „Erledigt.“; `Als Kalenderdatei speichern` öffnet die Rückfrage mit dem Haken „Namen der Mieter aufnehmen“ (aus) und dem Satz „Ein Kalenderprogramm kann die Datei an einen Dienst im Netz weitergeben.“, der Abruf geht an `/api/reminders.ics?names=0`.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** `npm test` → Exit 0; `npm run typecheck` → Exit 0; `npm run build` → Exit 0.
- [ ] **Step 5: Commit** `Fristen: eigene Termine im Cockpit und Kalenderdatei speichern (Refs #190)`.

---

## Self-Review (vor dem PR)

Spec „Eigene Termine“ → Tasks 1 und 3; „Kalenderdatei“ → Tasks 2 und 3. Der abonnierbare Kalender bleibt Nicht-Ziel; nach dem Merge im Issue als Folgepunkt nennen. Integrationsdurchsicht `main..feat/fristen-termine` vor dem Merge.
