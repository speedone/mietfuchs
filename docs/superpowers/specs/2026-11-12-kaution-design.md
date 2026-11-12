# Kaution je Mietverhältnis führen (#228)

Stand: Entwurf vom 12.11.2026. Grundlage: Issue #228 mit dem dort abgestimmten Zuschnitt (Kautionsbuchungen, nie in
`payments`, Stand aus den Buchungen abgeleitet), Berichtigung in #188 vom 14.10.2026, Code in `shared/types.ts`
(`depositCents`, `depositStatus`), `server/src/db/schema.ts`, `server/src/db/repository.ts` (`guardPayment`,
`insertPayments`), `server/src/calc.ts` (`possibleDepositsOf`), `client/src/pages/Stammdaten.tsx`.

## Ziel

Der Vermieter sieht je Mietverhältnis, was von der Kaution wann eingegangen ist, welche Erträge dazukamen, was er
verrechnet und was er zurückgezahlt hat, und was noch bei ihm liegt. Beim Auszug hat er eine Aufstellung, aus der die
Rückzahlung folgt.

**Wer nichts bucht, merkt nichts**: Ohne Kautionsbuchung gilt der gespeicherte `depositStatus` wie bisher, kein Feld
verschwindet, die Golden-Tests bleiben unberührt (Entscheidung im Issue vom 14.10.2026: keine Buchungen erfinden).

## Nicht-Ziele

- Kein Ratenplan mit Fälligkeiten und kein Verzugsrechner. Raten sind einfach mehrere Eingänge.
- Keine Aussage zur Kündigung nach § 569 Abs. 2a BGB.
- Keine Zinsrechnung. Erträge werden erfasst, wie die Bank sie ausweist.
- Kein Kautionskonto einlesen (#285) und keine Steuerbescheinigung für den Mieter.
- Kein Vorschlag in Prozent für den Einbehalt. Die Aufstellung zeigt nur das Ergebnis der letzten Abrechnung.
- Kein Anschreiben „Kautionsabrechnung“ mit Bausteinen. Die Aufstellung lässt sich drucken, mehr nicht (Folgeschritt).

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es läuft)

- Ein Kautionseingang oder eine Rückzahlung zählt als Mieteinnahme oder mindert sie.
- Eine mit Mietrückstand verrechnete Kaution zählt in der Steuer doppelt oder gar nicht, oder der Rückstand bleibt im
  Mietkonto stehen, obwohl er aus der Kaution getilgt ist.
- Der angezeigte Stand widerspricht den Buchungen.

## Recht (was gelesen ist und was nicht)

| Aussage | Quelle | Stand |
|---|---|---|
| Höchstens das Dreifache der Monatsmiete ohne Betriebskosten als Pauschale oder Vorauszahlung | § 551 Abs. 1 BGB | Wortlaut gelesen am 12.11.2026 (gesetze-im-internet.de) |
| Drei gleiche monatliche Teilzahlungen, die erste zu Beginn | § 551 Abs. 2 BGB | gelesen wie oben |
| Getrennte Anlage, Erträge stehen dem Mieter zu und erhöhen die Sicherheit | § 551 Abs. 3 BGB | gelesen wie oben |
| Abweichung zum Nachteil des Mieters unwirksam | § 551 Abs. 4 BGB | gelesen wie oben |
| Einbehalt eines angemessenen Teils bis zur Betriebskostenabrechnung | BGH, Urteil vom 18.01.2006, VIII ZR 71/05 | **nicht gelesen** (Seite des Gerichts nicht abrufbar), Fundstelle aus dem Issue |
| Maßgeblich ist die Miete bei Beginn; mehrere Sicherheiten zählen zusammen | BGH VIII ZR 278/23, VIII ZR 52/23, VIII ZR 243/03 | **nicht gelesen**, Fundstellen aus dem Issue |
| Verrechnete Kaution ist Einnahme im Jahr der Verrechnung | Auslegung, im Issue mit der ELSTER-Hilfe 2023 bis 2025 belegt | **nicht selbst gelesen** |

Folgen: Ins Rechtsregister kommt `bgb.deposit-max-months` (Wert 3, `checked`, § 551 Abs. 1 BGB) in
`shared/law/bgb-betrkv.ts`. Jeder Satz der Oberfläche und des Lexikons, der sich auf eine nicht gelesene Zeile stützt,
wird erst geschrieben, wenn der Builder die Entscheidung im Original gelesen hat; gelingt das nicht, nennt der Text
nur das Gesetz und lässt die Aussage weg. Zeilennummern der Anlage V nennt die Oberfläche nur über `anlageVLines`.

## Datenmodell

Neue Tabelle **`deposit_entries`** (Kautionsbuchungen):

| Spalte | Typ | Regel |
|---|---|---|
| `id` | text | Schlüssel |
| `tenancy_id` | text | Pflicht, `ON DELETE CASCADE` wie `payments` |
| `date` | text | Pflicht, `JJJJ-MM-TT` |
| `kind` | text | `received`, `interest`, `applied`, `refunded` |
| `amount_cents` | integer | Pflicht, **größer 0**; die Richtung ergibt die Art |
| `purpose` | text | nur bei `applied` Pflicht: `rent`, `settlement`, `damage`, `other`; sonst NULL |
| `payment_id` | text | nur bei `applied` mit `rent` oder `settlement`: die erzeugte Zahlung, `ON DELETE CASCADE` |
| `note` | text | frei |

Typen in `shared/types.ts`: `DepositEntryKind`, `DepositPurpose`, `DepositEntry`. Listen in schema.ts über `exactly<…>()`
wie `PAYMENT_KINDS`. Neu am Mietverhältnis: **`depositForm?: DepositForm`** (`account` Kautionskonto oder Sparbuch auf
den Namen des Vermieters, `pledged` verpfändetes Sparbuch des Mieters, `guarantee` Bürgschaft oder Versicherung,
`other`), Spalte `deposit_form`, NULL heißt keine Angabe. Die Angabe ist Auskunft und steuert nur einen Satz in der
Aufstellung („Bei dieser Form fließt kein Geld an Sie; Buchungen brauchen Sie nur, wenn Sie die Sicherheit in Anspruch
nehmen.“).

Bedeutung der Arten:

- `received`: Geld des Mieters eingegangen (auch jede Rate).
- `interest`: Ertrag der Anlage, erhöht die Sicherheit.
- `applied`: Der Vermieter verrechnet mit einer eigenen Forderung; mindert den Stand.
- `refunded`: an den Mieter ausgezahlt; mindert den Stand.
Jede Buchung bewegt Geld. Der **Einbehalt beim Auszug** ist keine Bewegung, sondern eine Absicht, und steht deshalb
nicht in dieser Tabelle (geändert am 12.11.2026 nach der Durchsicht des Datenmodells; vorher gab es dafür eine fünfte
Art `retained`, die in jeder Summe eine Ausnahme brauchte). Er steht am Mietverhältnis: **`depositHoldCents?: number`**
(größer 0) und **`depositHoldNote?: string`** (bis 200 Zeichen, etwa „Nebenkosten 2025“), Spalten
`deposit_hold_cents` und `deposit_hold_note`, beide NULL ohne Angabe. Die Felder kommen mit Teil 2, gepflegt im
Seitenfenster nach dem Auszug. Gilt: Betrag nur mit Grund (400 sonst). Ist der Stand 0, zeigt niemand sie mehr.

## Der Stand: eine reine Funktion

`shared/deposit.ts`, von Server und Client benutzt:

```ts
export type DepositState = {
  derived: boolean            // false: keine Buchung, es gilt der gespeicherte Stand
  status: DepositStatus
  receivedCents: number; interestCents: number; appliedCents: number; refundedCents: number
  balanceCents: number        // received + interest − applied − refunded
}
export function depositState(tenancy: Pick<Tenancy, 'depositCents' | 'depositStatus'>, entries: readonly DepositEntry[]): DepositState
```

Regeln, in dieser Reihenfolge:

1. Keine Buchung: `derived: false`, `status` = gespeicherter Wert, sonst `offen`; alle Beträge 0.
2. `received` = 0: `offen`.
3. `applied + refunded` > 0 und `balance` ≤ 0: `zurückgezahlt`. Die Oberfläche schreibt dafür „abgerechnet“, wenn
   `appliedCents` > 0, sonst „zurückgezahlt“ (kein neuer gespeicherter Wert, der eingefrorene Eingang bleibt unberührt).
4. Vereinbarte Kaution bekannt und `received` kleiner: `teilweise`.
5. Sonst `erhalten`.

Der gespeicherte `depositStatus` wird nie überschrieben. Löscht jemand alle Buchungen, gilt er wieder. Das Auswahlfeld
im Formular ist mit Buchungen gesperrt und sagt „ergibt sich aus den Kautionsbuchungen“.

**Nie negativ**: Eine Buchung, nach der `balanceCents` an irgendeinem Tag unter 0 fiele, lehnt der Server ab (400,
„Mehr als die Kaution hergibt: Am TT.MM.JJJJ lägen noch X bei Ihnen.“). Geprüft über die nach Datum und Einfügung
geordnete Folge, auch beim Ändern und Löschen eines Eingangs.

## Verrechnung mit Miete oder Abrechnung erzeugt eine Zahlung

*Meine Entscheidung*, abweichend vom Arbeitsstand im Issue (eigene Steuerzuordnung je Verrechnung): Wer die Kaution mit
einem Mietrückstand oder einer Nachzahlung verrechnet, hat wirtschaftlich an diesem Tag eine Miet- bzw.
Abrechnungszahlung erhalten. Deshalb legt eine Buchung `applied` mit `purpose` `rent` oder `settlement` **in derselben
Transaktion eine Zahlung in `payments` an** (`kind` entsprechend, Datum und Betrag der Buchung, Notiz „Aus der Kaution
verrechnet“) und merkt sie in `payment_id`.

- Das Mietkonto tilgt damit den Rückstand nach derselben Regel wie jede Zahlung (§ 366 BGB, rentAllocation.ts), und
  die Steuer zählt den Betrag genau einmal über den vorhandenen Weg. Ein Rückstand aus einem früheren Jahr landet so
  von selbst bei „Mieten für frühere Jahre“. Keine zweite Regel, keine Änderung an `taxReport`.
- Der Satz im Issue „die Kaution kommt nie in `payments`“ betrifft Eingang, Ertrag und Rückzahlung. Das bleibt so.
- Die Zahlung ist **gebunden**: `guardPayment` lehnt Ändern von Betrag, Datum, Art und Mietverhältnis ab (409, „Diese
  Zahlung stammt aus der Kaution. Ändern Sie sie bitte dort.“); `designatedMonth` und Notiz bleiben änderbar. Löschen
  der Zahlung löscht die Buchung (Fremdschlüssel), Löschen der Buchung löscht die Zahlung (Repository, eine Transaktion).
- `purpose` `damage` und `other` erzeugen keine Zahlung. Die Steuer rechnet sie **nicht** mit; die Seite Steuer zeigt
  je Jahr einen Hinweis `depositApplied` mit Betrag („Aus Kautionen einbehalten, nicht in den Einnahmen enthalten: X.
  Ob und wo das anzugeben ist, hängt vom Grund ab.“). Die steuerliche Einordnung von Schadensersatz ist nicht belegt,
  also wird sie nicht behauptet.
- Offen für den Builder (kein Fachentscheid): Das Issue nennt für die mit **abzurechnenden Nebenkosten** verrechnete
  Kaution die Zeile für frühere Jahre statt der Zeile für Nachzahlungen. Vor dem Bau die ELSTER-Hilfe bzw. Anleitung
  des Jahres lesen; stimmt es, bekommt die erzeugte Abrechnungszahlung ein Kennzeichen, das `receivedIncome` in die
  andere Zeile lenkt, sonst bleibt es bei der Zeile der Abrechnung. Die Summe der Einnahmen ist in beiden Fällen gleich.

`possibleDeposits` (Mietzahlung, die die Kaution sein könnte) bekommt einen Knopf „Als Kaution umbuchen“: löscht die
Mietzahlung und legt `received` mit gleichem Datum und Betrag an, eine Transaktion, ein Eintrag im Verlauf.

## Hinweis zur Höhe

Reine Funktion `depositLimit(tenancy, at)` in `shared/deposit.ts`: Dreifaches (`bgb.deposit-max-months`) der Kaltmiete
am Mietbeginn; bei Inklusivmiete der ganzen Miete; bei teilweise inklusiver Miete oder ohne Kaltmiete am Beginn `null`
(kein Hinweis). Liegt `depositCents` darüber, steht am Feld ruhig: „Mehr als drei Monatsmieten ohne Betriebskosten
(X). § 551 Abs. 1 BGB erlaubt höchstens das Dreifache.“ Keine Sperre. Der Hinweis nennt nur, was der Wortlaut trägt.

## API

- `GET /api/deposit-entries?property=` → alle Buchungen des Objekts.
- `POST /api/deposit-entries`, `PUT /api/deposit-entries/:id`, `DELETE /api/deposit-entries/:id` in
  `server/src/db/deposits.ts` (Muster `db/co2Refunds.ts`): Prüfungen vor dem Schreiben (Mietverhältnis im Objekt,
  Datum gültig, Betrag ganzzahlig und größer 0, `purpose` genau bei `applied`, Stand nie negativ, gebundene Zahlung).
- `POST /api/deposit-entries/from-payment/:paymentId` (Umbuchen einer Mietzahlung).
- Sätze im Verlauf (`journalRoutes.ts`): „Kautionsbuchung angelegt/geändert/gelöscht“, „Mietzahlung als Kaution
  umgebucht“; Bereich `payments` in `TABLE_KINDS`. Rückgängig braucht nichts weiter (Trigger entstehen beim Öffnen).
- Export für den Kontoauszug (#188): `insertDepositEntries(db, bodies, newId, title)` nach dem Muster `insertPayments`.

## Oberfläche

- **Stammdaten, Karte des Mietverhältnisses**: neben „Kaution X“ der abgeleitete Stand und ein Knopf „Kaution führen“.
  Er öffnet ein Seitenfenster (`Drawer`) **`DepositDrawer`** mit: Kopf (vereinbart, Form, Stand in einem Satz), Tabelle
  der Buchungen (Datum, Art, Betrag mit Vorzeichen in der Anzeige, Notiz), Formular für eine neue Buchung. Logik in
  `client/src/depositForm.ts` (rein), Auswahlfelder aus festen Optionslisten (`DEPOSIT_KIND_OPTIONS`,
  `DEPOSIT_PURPOSE_OPTIONS`).
- **Nach dem Auszug** (Mietende gesetzt und erreicht, Stand größer 0) zeigt das Seitenfenster oben die **Aufstellung
  zum Auszug**: Eingegangen, Erträge, verrechnet (je Zeile), einbehalten (Betrag und Grund vom Mietverhältnis, höchstens der Stand), „bleibt auszuzahlen“ =
  Stand minus Einbehalt. Darüber zwei Felder „Einbehalt“ und „Grund“, die am Mietverhältnis speichern. Darunter als Orientierung „Letzte Nebenkostenabrechnung: Nachzahlung X“ bzw. „Guthaben X“ aus
  der jüngsten abgeschlossenen Abrechnung des Mietverhältnisses und „Abrechnung für JJJJ steht noch aus“, wenn ein
  bewohnter Zeitraum nicht abgeschlossen ist. Kein Vorschlag, kein Prozentsatz. Knopf „Drucken“ (nur die Aufstellung).
- **Cockpit**: Zeile „Kaution nach Auszug“ je Mietverhältnis mit Mietende in der Vergangenheit und Stand größer 0:
  „Bei Ihnen liegen noch X von Erika Mustermann (ausgezogen am …).“ Sprung in das Seitenfenster. Die Zeile erscheint
  nur mit Buchungen (ohne Buchungen weiß Mietfuchs nicht, was wo liegt) und nennt keine Frist: Eine gesetzliche gibt
  es nicht, und die Rechtsprechung dazu ist nicht gelesen.
- **Steuer**: Hinweis `depositApplied` wie oben; `possibleDeposit` mit dem Knopf zum Umbuchen.
- Verlauf: Beschriftungen in `client/src/journalView.ts` (Tabelle, Spalten, Werte der Arten).
- Texte siezen; Lexikon: „Kaution“, „Einbehalt“ (dieser erst nach gelesener Entscheidung, siehe Recht).

## Tests

1. `shared/deposit.ts` (server/test/deposit.test.ts): jede Regel des Stands, Reihenfolge der Regeln,
   Höchstgrenze je Mietmodell. **Invariante** über zufällige Folgen mit
   festem Startwert: `balance = received + interest − applied − refunded`, nie negativ nach jeder angenommenen Buchung.
2. Integration (server/test/api-kaution.test.ts): Anlegen, Ändern, Löschen; 400 je Prüfung; Stand nie negativ auch
   beim Löschen eines Eingangs; Verrechnung mit Miete erzeugt Zahlung, das Mietkonto zeigt den Monat bezahlt, die
   Steuer zählt den Betrag einmal; gebundene Zahlung 409; beidseitiges Löschen; Umbuchen einer Mietzahlung; Löschen
   des Mietverhältnisses nimmt die Buchungen mit; Verlauf und Rücksprung (Buchung samt Zahlung kommt zurück).
3. **Kreuz-Invariante** (invariant-steuer-zufluss.test.ts): Mit `received`, `interest`, `refunded`, einem Einbehalt am Mietverhältnis und
   `applied` mit `damage`/`other` ändert sich keine Zahl in `rentLedger` und `taxReport`.
4. Migration (migrations.test.ts): neuer Schritt, Bestand ohne Buchungen liest sich wie vorher.
5. Client: `depositForm.test.ts`, `DepositDrawer.test.tsx` (angezeigter Wert der Auswahlfelder gleich dem
   gespeicherten; gesperrtes Stand-Feld mit Buchungen), `cockpitChecks.test.ts`, `taxIncome.test.ts`.
6. Praxislauf (`scripts/umstieg-praxislauf.mjs`): Backup und Wiederherstellen mit Kautionsbuchungen.
7. Golden-Tests unverändert grün.

## Zuschnitt in zwei PRs

1. **Buchungen und Stand**: Tabelle, `depositForm`, `shared/deposit.ts`, Routen ohne Verrechnungszahlung (`applied`
   nur mit `damage`/`other`), Seitenfenster, Stand in den Stammdaten, Hinweis zur Höhe, Verlauf.
2. **Verrechnung und Auszug**: `applied` mit `rent`/`settlement` samt gebundener Zahlung, Umbuchen aus
   `possibleDeposits`, Aufstellung zum Auszug mit Druck und den zwei Feldern des Einbehalts (eigener Migrationsschritt), Cockpit-Zeile, Steuer-Hinweis, Lexikon, Doku, Praxislauf.

## Doku

CHANGELOG „Unveröffentlicht“ mit Link auf #228; server/src/CLAUDE.md (neuer Abschnitt „Kaution“, Verweise in
„Mietkonto“ und „Steuer“ anpassen: der Satz „Die Kaution gehört nicht dazu“ bekommt die Ausnahme der Verrechnung);
server/src/db/CLAUDE.md (Löschverhalten); docs/funktionsweise.md; Punkt in #447 nach dem Release abhaken.
