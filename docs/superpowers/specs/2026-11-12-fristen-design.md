# Fristen und Termine im Cockpit (#190)

Stand: Entwurf vom 12.11.2026. Grundlage: Issue #190 samt Ergänzung zur Einwendungsfrist, `shared/period.ts`
(`settlementDeadline`), `shared/deadlines.ts` (`deadlineOnWorkday`), `shared/calibration.ts` (`calibrationEnd`),
`closed_settlements.sent_at`, die Cockpit-Zeilen „Abgeschlossen & versendet“ und „Eichfrist“
(`client/src/pages/Cockpit.tsx`, `client/src/meterCheck.ts`), der Entwurf zur Kaution.

## Ziel

Eine Liste **„Demnächst fällig“** im Cockpit, über alle Objekte, aus den Daten gerechnet: Was läuft in den nächsten
Wochen ab, was ist überfällig. Dazu eigene, wiederkehrende Termine (Rauchwarnmelder, Wartung) und ein Export als
Kalenderdatei.

**Wer nichts einträgt, bekommt trotzdem die gerechneten Fristen** und sonst nichts Neues; die bisherigen Zeilen der
Checkliste bleiben, wie sie sind.

## Umfang

| Frist | Woraus | Neu |
|---|---|---|
| Abrechnungsfrist | Zeitraum zu Ende, nicht abgeschlossen oder ohne Versanddatum; `settlementDeadline` | nur die Liste |
| Einwendungsfrist des Mieters | `sent_at` + zwölf Monate | Rechnung, Erfassen von Einwendungen |
| Ersatzansprüche nach Auszug | Mietende + sechs Monate | Rechnung |
| Kaution nach Auszug | `depositsAfterMoveOut` (#228 Teil 2) | nur die Liste |
| Eichfrist | `calibrationEnd` je Zähler | nur die Liste (Vorschau auf kommende Jahre) |
| Eigene Termine | neue Tabelle | alles |

## Nicht-Ziele

- Keine Fristen der Mieterhöhung (Index, Staffel, Kappungsgrenze): gehört zu #191.
- Keine Erinnerung „Vorauszahlung anpassen“: Den Vorschlag gibt es schon an der Abrechnung.
- Keine Liste der Rauchwarnmelder-Pflichten je Land. Der Termin ist ein eigener Termin mit Vorlage.
- Keine Benachrichtigung (Mail, Push) und **kein abonnierbarer Kalender**: Ein Kalenderprogramm kann sich nicht
  anmelden (#528), also bräuchte die Adresse ein Geheimnis im Link. Das ist ein eigenes Vorhaben mit eigener
  Sicherheitsdurchsicht. Hier gibt es die Datei zum Herunterladen.
- Keine Fristen der Hausgeldabrechnung (siehe Entwurf Hausgeld).

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es läuft)

- Die Liste nennt ein Fristende, das **später** liegt als das wirkliche, wo der Vermieter handeln muss
  (Abrechnungsfrist, Ersatzansprüche), oder **früher**, wo er sich auf den Ablauf verlässt (Einwendungsfrist).
- Ein Termin verschwindet, ohne dass ihn jemand erledigt hat.
- Die Kalenderdatei trägt Namen von Mietern in einen fremden Kalenderdienst, ohne dass der Vermieter es gewählt hat.

## Recht (was gelesen ist und was nicht)

| Aussage | Quelle | Stand |
|---|---|---|
| Abrechnung bis zum Ablauf des zwölften Monats nach Ende des Zeitraums | § 556 Abs. 3 Satz 2 BGB | im Register (`bgb.deadline-months`) |
| Einwendungen bis zum Ablauf des zwölften Monats nach Zugang; danach ausgeschlossen, außer nicht zu vertreten | § 556 Abs. 3 Satz 5 und 6 BGB | Wortlaut gelesen am 12.11.2026 |
| Ersatzansprüche des Vermieters wegen Veränderungen oder Verschlechterungen verjähren in sechs Monaten ab Rückerhalt | § 548 Abs. 1 BGB | gelesen wie oben |
| Monatsfrist endet am Tag gleicher Zahl; fehlt er, am Monatsletzten | § 188 Abs. 2 und 3 BGB | gelesen wie oben |
| Fristende am Samstag, Sonntag, Feiertag: nächster Werktag | § 193 BGB | im Register (`bgb.deadline-on-workday`) |
| Wie sich „Ablauf des zwölften Monats nach Zugang“ rechnet (Tag gleicher Zahl oder Monatsende) | Rechtsprechung | **nicht gelesen** |
| Prüfpflicht und Abstand bei Rauchwarnmeldern | Bauordnungen der Länder, Norm | **nicht gelesen**, deshalb keine Aussage |

Folgen, je zur sicheren Seite:

- **Abrechnungsfrist**: wie bisher `settlementDeadline`, ohne Verschiebung nach § 193 (früher ist sicher).
- **Ersatzansprüche**: Mietende + sechs Monate nach § 188, ohne Verschiebung. Das Mietende ist nur ein Näherungswert
  für den Rückerhalt; die Zeile sagt es.
- **Einwendungsfrist**: Der Vermieter verlässt sich auf den Ablauf, also zählt das **späteste** vertretbare Ende:
  der Monatsletzte des zwölften Monats nach dem Versand, nach § 193 verschoben (`deadlineOnWorkday` mit dem Land des
  Objekts). *Meine Entscheidung*, bis die Rechnung an einer Entscheidung belegt ist; als `adopted` im Register
  (`bgb.objection-months`, Wert 12, § 556 Abs. 3 Satz 5 ist `checked`, die Rechenweise in einem eigenen Eintrag
  `practice.objection-end-of-month`). Die Zeile sagt „frühestens ausgeschlossen ab“ und „Das Versanddatum ist nur ein
  Näherungswert für den Zugang.“

## Die Liste: eine reine Funktion im Server

`server/src/reminders.ts`:

```ts
export type Reminder = {
  id: string                      // stabil: Art + Objekt + Bezug, etwa 'objection:p1:2025:t3'
  kind: 'settlementDeadline' | 'objectionDeadline' | 'openObjection' | 'damageClaims' | 'depositAfterMoveOut' | 'calibration' | 'custom'
  dueOn: string | null            // 'JJJJ-MM-TT'; null bei Zuständen ohne Tag (Kaution nach Auszug, offene Einwendung)
  propertyId: string | null
  title: string                   // ohne Namen von Personen
  detail: string                  // mit Namen, nur für die Oberfläche
  jump: { tab: string; focus?: string } | null
  level: 'overdue' | 'soon' | 'later'
}
export function remindersOf(input: ReminderInput, today: string): Reminder[]
```

`ReminderInput` trägt je Objekt Regeln und Zeiträume, abgeschlossene Abrechnungen mit `sentAt`, Mietverhältnisse,
Zähler, Kautionsbuchungen, Einwendungen und eigene Termine. `level`: `overdue` vor heute, `soon` bis 60 Tage,
`later` darüber. Sortiert nach `dueOn` (ohne Tag zuerst), dann Objekt, dann Titel mit `compareName`.

Regeln:

1. **Abrechnungsfrist** je Objekt und Zeitraum, der zu Ende ist und nicht (abgeschlossen **und** mit Versanddatum)
   ist, frühestens ab dem ersten Zeitraum mit Mietverhältnis; ebenso je Heizanlage mit eigener Abrechnung. Nach
   Ablauf bleibt die Zeile `overdue`, bis versendet ist. Zeiträume, die vor mehr als drei Jahren endeten, erscheinen
   nicht (die Nachforderung ist längst ausgeschlossen, die Zeile wäre Lärm).
2. **Einwendungsfrist** je versendeter Abrechnung und Mietverhältnis darin, bis sie abgelaufen ist; danach entfällt
   die Zeile.
3. **Offene Einwendung** je erfasster Einwendung mit Stand `open`, ohne Tag.
4. **Ersatzansprüche** je Mietverhältnis, dessen Ende höchstens sechs Monate zurückliegt, bis zum Ablauf.
5. **Kaution nach Auszug** aus `depositsAfterMoveOut`, ohne Tag.
6. **Eichfrist** je Zähler mit Eichjahr: Ende laut `calibrationEnd`, in der Liste ab 18 Monaten vorher (ein
   Zählertausch braucht Vorlauf). Die gelbe Zeile der Checkliste bleibt daneben.
7. **Eigene Termine** mit ihrem Tag.

Route `GET /api/reminders` (ohne `?property`, über alle Objekte; mit `?property=` gefiltert).

## Einwendungen erfassen

Tabelle **`settlement_objections`**: `id`, `property_id` (RESTRICT wie die Wurzeln), `period`, `tenancy_id` (CASCADE),
`received_on`, `status` (`open`, `done`), `note`. Routen `GET/POST/PUT/DELETE /api/settlement-objections`.
Oberfläche: an der abgeschlossenen und versendeten Abrechnung je Mieter eine Zeile „Einwendungen bis frühestens
TT.MM.JJJJ möglich“ und „Einwendung erfassen“ (Datum, Notiz, Stand). Eine Einwendung nach dem gerechneten Ende trägt
den ruhigen Hinweis „Nach dem gerechneten Fristende eingegangen. Ob der Mieter die Verspätung zu vertreten hat, prüfen
Sie bitte selbst (§ 556 Abs. 3 Satz 6 BGB).“ Wird die Abrechnung wiedergeöffnet, bleiben die Einwendungen stehen.

## Eigene Termine

Tabelle **`custom_reminders`**: `id`, `property_id` (NULL = alle Objekte, sonst CASCADE), `unit_id` (NULL oder
CASCADE), `title` (≤ 120 Zeichen), `due_on`, `anchor_day` (Tag des ersten Termins, damit eine Wiederholung nach einem
gekürzten Monat zum Ursprungstag zurückkehrt), `repeat_months` (NULL oder 1 bis 120), `note`, `done_on` (nur ohne
Wiederholung). Routen `GET/POST/PUT/DELETE /api/custom-reminders` und `POST /api/custom-reminders/:id/done`:

- mit Wiederholung: `due_on` rückt um `repeat_months` weiter (nach § 188 Abs. 3 gekürzt auf den Monatsletzten),
  so oft, bis es nach heute liegt;
- ohne: `done_on` = heute, der Termin fällt aus der Liste.

Vorlagen im Formular (füllen Titel und Wiederholung, alles bleibt änderbar): „Rauchwarnmelder prüfen“ (12),
„Heizung warten“ (12), „Schornsteinfeger“ (12), „Legionellenprüfung“ (36), „Eigener Termin“ (keine). Unter der
Vorlage Rauchwarnmelder steht: „Wer prüfen muss und wie oft, regeln die Bauordnung Ihres Landes und die Anleitung des
Herstellers.“ Die 36 Monate der Legionellenprüfung setzt der Builder nur, wenn er § 14b TrinkwV bzw. die geltende
Fassung gelesen hat; sonst bleibt die Vorlage ohne Wiederholung.

## Kalenderdatei

`GET /api/reminders.ics?names=0|1` liefert eine Datei nach RFC 5545 (vor dem Bau lesen: Abschnitte 3.1 Zeilenlänge
und Faltung, 3.3.4 DATE, 3.3.11 TEXT-Maskierung, 3.6.1 VEVENT): je Termin mit Tag ein ganztägiges Ereignis,
`UID` = `Reminder.id` + `@mietfuchs`, `DTSTAMP`, `DTSTART;VALUE=DATE`, `DTEND` am Folgetag, `SUMMARY` = `title`.
Wiederkehrende eigene Termine als `RRULE:FREQ=MONTHLY;INTERVAL=n`. Zeilenende CRLF, gefaltet bei 75 Oktetten ohne ein
UTF-8-Zeichen zu teilen. **Ab Werk ohne Namen** (`title`); mit `names=1` steht `detail` in `DESCRIPTION`. Der Knopf
„Als Kalenderdatei speichern“ fragt mit einem Haken „Namen der Mieter aufnehmen“ (aus) und sagt: „Ein
Kalenderprogramm kann die Datei an einen Dienst im Netz weitergeben.“ Eigene Bibliothek braucht es nicht.

## Oberfläche

- **Cockpit**: Karte „Demnächst fällig“ über der Checkliste: `overdue` und `soon`, höchstens acht Zeilen, „Alle
  Termine (n)“ klappt `later` auf. Bei mehreren Objekten steht das Objekt an der Zeile. Jede Zeile springt
  (`jumpTargets.ts`). Leer: Die Karte fehlt.
- **Eigene Termine**: Seitenfenster aus der Karte („Termin anlegen“), Liste mit „Erledigt“.
- Lexikon: „Einwendungsfrist“, „Verjährung nach Auszug“.

## Tests

1. `server/test/reminders.test.ts`: jede Regel mit Grenzfällen (Versand am 31.01. und am 29.02.; Fristende am
   Samstag und an einem Feiertag des Landes; Mietende am 31.08. → 28./29.02.; Zeitraum genau drei Jahre alt;
   Zähler ohne Eichjahr). **Invarianten** über zufällige Bestände: Einwendungsende ≥ Versand + 12 Monate nach § 188;
   Abrechnungsfrist = `settlementDeadline`; jede Kennung eindeutig und über zwei Läufe gleich.
2. `server/test/ics.test.ts`: Faltung bei 75 Oktetten mit Umlauten, Maskierung von Komma, Semikolon, Umbruch,
   CRLF, `names=0` enthält keinen Mieternamen (über alle Felder gesucht), ein Rundweg mit einem Leser als
   Entwicklungsabhängigkeit (Lizenz prüfen, sonst ein eigener kleiner Leser im Test).
3. Integration `server/test/api-fristen.test.ts`: Routen, 400 je Feld, „Erledigt“ mit und ohne Wiederholung,
   Einwendungen an einer wiedergeöffneten Abrechnung, Verlauf, Backup.
4. Client: `reminderView.test.ts`, Cockpit-Karte, Seitenfenster, Abrechnung mit Einwendung.
5. Migration; Golden-Tests unverändert.

## Zuschnitt in zwei PRs

1. **Gerechnete Fristen**: `remindersOf` (Regeln 1 bis 6), Einwendungen, Karte im Cockpit.
2. **Eigene Termine und Kalenderdatei**.

Regel 5 hängt an #228 Teil 2; ist der noch nicht in `main`, liefert `ReminderInput` dafür eine leere Liste.
