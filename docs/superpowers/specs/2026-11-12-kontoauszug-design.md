# Kontoauszug einlesen und Zahlungen zuordnen (#188)

Stand: Entwurf vom 12.11.2026. Grundlage: Issue #188 mit den Festlegungen vom 13., 14. und 17.10.2026, der Leser in
`server/src/bank/` (seit #282 in `main`, bisher nur von Tests benutzt), `server/src/markPaid.ts` und
`server/src/bookingPlan.ts` als Muster für „planen, dann ausführen“, der Entwurf zur Kaution
(`2026-11-12-kaution-design.md`). Der Architekturentwurf des Mitwirkenden vom 14.10.2026 ist gelesen; übernommen und
gestrichen steht unten.

## Ziel

Der Vermieter lädt den Auszug seiner Bank (camt.052/053/054, MT940, auch als ZIP), sieht eine Vorschau, und nach
seiner Bestätigung stehen die Mieteingänge im Mietkonto, schon dem richtigen Mietverhältnis zugeordnet. Zweimal
eingelesene Tage ändern nichts.

**Wer keinen Auszug einliest, merkt nichts**: `payments` bleibt, wie es ist; Mietkonto, Steuer und Golden-Tests
rechnen unverändert. Eine aus dem Auszug gebuchte Zahlung ist eine gewöhnliche Zahlung.

## Festlegungen aus dem Issue (nicht neu zu verhandeln)

1. Kontoumsatz und Zahlung sind getrennt; die Verknüpfung fällt mit der Zahlung weg, der Umsatz ist dann wieder offen.
2. Nur gebuchte Umsätze. Der Leser liefert vorgemerkte nicht.
3. **Vorsichtige Voreinstellung „Mischkonto“**: Privates wird nie einzeln gespeichert, nur als Tagessumme. „Nur für
   die Vermietung“ gilt erst nach ausdrücklicher Bestätigung.
4. Kein Hash je privatem Umsatz.
5. `tenancies.iban` zuerst, zusätzliche Zahler in eigener Tabelle.
6. Monats-Soll aus `rentLedger`. **Der Import setzt nie einen Monat laut Verwendungszweck.**
7. Unbekanntes Konto: nachfragen, nicht still zuordnen.
8. Die Kaution kommt nie als Eingang in `payments`; das Kautionskonto wird nicht eingelesen (#285 ist ein eigenes Vorhaben).
9. Wortlaut „Konto lückenlos eingelesen“, nie „Einnahmen vollständig“.
10. Bankdaten gehen nie an eine KI. Wer einen Auszug in die Schnellerfassung oder den Posteingang zieht, wird auf die
    Seite Kontoauszug geführt, die Datei wird dort nicht angenommen.
11. Kleine PRs: Schema und Import, Zuordnung und Buchen, Oberfläche.

## Nicht-Ziele

- Keine Abbuchungen mit Kostenpositionen verknüpfen (#292) und keine Erkennung der Nachzahlung am Betrag der
  abgeschlossenen Abrechnung (#308). Beide bekommen hier nur ihre Naht (siehe „Nähte“).
- Kein CSV, kein FinTS.
- Keine gedruckte Kontoabstimmung, keine Umstufung eines Kontos mit Nachspeichern, keine eigene Klasse für Umsätze mit
  dem Finanzamt, kein Kontenrahmen.
- Kein eigenes Protokoll neben dem Verlauf, kein Löschverbot (siehe „Aufzeichnungspflichten“).

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es läuft)

- Eine Zahlung steht nach einem zweiten Einlesen doppelt im Ist.
- Ein privater Umsatz eines Mischkontos steht einzeln in Datenbank, Backup, Verlauf oder Vorversion.
- Ein Eingang wird ohne Bestätigung gebucht.
- Die Oberfläche behauptet Vollständigkeit der Einnahmen.

## Aufzeichnungspflichten: Befund vom 12.11.2026

Gelesen: §§ 140, 141, 146, 147a AO, §§ 14b, 22 UStG, BMF-Schreiben zu den GoBD vom 28.11.2019. Die GoBD knüpfen an
bestehende Buchführungs- und Aufzeichnungspflichten an und nennen Vermietung nicht; § 147a AO greift erst ab 500.000 €
positiver Überschusseinkünfte (ab 2027: 750.000 €). **Offen** bleibt, ob ein privater Vermieter „Unternehmer“ im Sinne
von § 146 Abs. 6 AO ist; die späteren Änderungen der GoBD sind nicht gelesen. Folge: Mietfuchs baut **kein
unveränderliches Protokoll**. Zuordnungen lassen sich lösen, Importe zurücknehmen; was geändert wurde, hält der Verlauf
(#318) fest. Die Oberfläche wirbt nicht mit „GoBD“ oder „revisionssicher“ und sagt einmal: „Bewahren Sie die
Kontoauszüge Ihrer Bank selbst auf. Mietfuchs ersetzt sie nicht.“ Mit der Umsatzsteueroption (#316) ist die Frage neu
zu stellen.

## Übernommen und gestrichen aus dem Architekturentwurf vom 14.10.2026

Übernommen: Tagessummen statt privater Einzelumsätze; der abgeschlossene Buchungstag je Konto als Einheit des
Abgleichs; planen und ausführen mit Prüfmarke und 409, die Datei kommt beim Ausführen noch einmal vom Browser;
camt.054 begründet nie einen Tag und zerlegt nur Sammelbuchungen; Prüfsumme der Datei gegen doppeltes Einlesen; „schon
erfasst“ verknüpft statt neu anzulegen.

Gestrichen, je mit Grund: Tabelle `bank_events` (der Verlauf leistet es, und unveränderliche Links widersprächen dem
Rücksprung); Kontoarten `private` und `deposit` (das Mischkonto deckt das erste ab, das zweite ist #285); Rollen und
Zeiträume an Zahlern; Tagesendsaldo je Tag und Saldenkette als Pflicht (die Lückenprobe läuft über die Auszüge);
„Tag ersetzen“; Klasse Finanzamt; Jahres-Kontoabstimmung; Link-Arten für die Kaution (dafür gibt es Kautionsbuchungen).

## Datenmodell

Sechs Tabellen, alle ohne Objektbezug: Ein Konto kann Mieten mehrerer Häuser empfangen.

**`bank_accounts`**: `id`, `iban` (eindeutig, NULL erlaubt), `other_id` (Konto ohne IBAN), `label`, `kind` (`mixed`
Voreinstellung, `rental`), `rental_confirmed_at` (Pflicht bei `rental`).

**`bank_imports`**: `id`, `account_id` (CASCADE), `file_sha256`, `file_name`, `format`, `statement_id`
(eindeutig ist `account_id`, `file_sha256`, `from_date`, `to_date`, weil eine Datei mehrere Auszüge tragen kann), `from_date`, `to_date`, `opening_balance_cents`, `closing_balance_cents` (beide NULL erlaubt),
`imported_at`. Eine Zeile je übernommenem Auszug, nicht je Datei.

**`bank_days`**: `account_id` (CASCADE), `date`, `import_id` (CASCADE), `entry_count`, `credit_cents`, `debit_cents`
(alle ≥ 0, laut Auszug; eine Sammelbuchung zählt als ein Umsatz). Schlüssel (`account_id`, `date`). Nur Tage mit
Umsätzen bekommen eine Zeile.

**`bank_transactions`**: `id`, `account_id` (CASCADE), `import_id` (CASCADE), `booking_date`, `value_date`,
`amount_cents` (ungleich 0), `counterparty_name`, `counterparty_iban`, `ultimate_party_name`, `purpose`,
`bank_reference`, `end_to_end_id`, `reversal`, `fingerprint`, `batch_reference`, `batch_part`, `batch_parts`,
`batch_total_cents`, `set_aside` (NULL oder Grund: `transfer` Umbuchung zwischen eigenen Konten, `notRental` gehört
nicht zur Vermietung, `other`). Längen wie `TEXT_LIMITS` des Lesers.

**`bank_transaction_links`**: `id`, `transaction_id` (CASCADE), genau eines von `payment_id` (CASCADE) und
`deposit_entry_id` (CASCADE), `created` (1: Zahlung oder Buchung entstand aus dem Umsatz; 0: sie war schon erfasst
und wurde nur verknüpft). Jede Zahlung und jede Kautionsbuchung hängt an höchstens einem Umsatz (eindeutig je
`payment_id` und je `deposit_entry_id`).

**Der Link trägt keinen Betrag** (geändert am 12.11.2026 nach der Durchsicht des Datenmodells; vorher stand der
Betrag ein zweites Mal am Link und konnte von der Zahlung abweichen). Der zugeordnete Betrag eines Links ist der
Betrag seines Ziels: bei einer Zahlung `amount_cents`, bei einer Kautionsbuchung `amount_cents` mit dem Vorzeichen der
Art (`received`, `interest` positiv; `applied`, `refunded` negativ). Die Summe je Umsatz ist höchstens dessen Betrag,
mit gleichem Vorzeichen; das Repository prüft es beim Buchen **und** beim Ändern eines verknüpften Ziels: Senken ist
erlaubt (der Rest des Umsatzes ist wieder offen), Erhöhen über den Umsatz hinaus lehnt `guardPayment` bzw. die
Prüfung der Kautionsbuchung ab (409, „Diese Zahlung ist einem Kontoumsatz über X zugeordnet. Lösen Sie zuerst die
Zuordnung auf der Seite Kontoauszug.“). Ebenso das Umhängen auf ein anderes Mietverhältnis.

**`tenancy_payers`**: `id`, `tenancy_id` (CASCADE), `iban`, `name`; eindeutig (`tenancy_id`, `iban`).

Ein Umsatz ist **offen**, solange die Summe der Beträge seiner verknüpften Ziele kleiner als sein Betrag ist und `set_aside` leer ist; sonst
**erledigt**. Das wird nie gespeichert, immer gerechnet.

**Verlauf und Vorversionen**: Die Trigger des Verlaufs schreiben Zeilen mit; in `bank_transactions` stehen nur Umsätze
der Vermietung, also ist das gewollt. `TABLE_KINDS`: alle sechs im Bereich `payments`.

## Import: planen, dann ausführen

`server/src/bank/importPlan.ts`, rein:

```ts
planBankImport(read: BankReadResult, stock: BankStock, decisions: readonly ImportDecision[], fileSha256: string): ImportPlan
```

`BankStock` trägt Konten, Importe, Tage, gespeicherte Umsätze der betroffenen Tage, Mieter-IBANs und Zahler,
IBANs des Vermieters. Routen: `POST /api/bank/import/plan` (Datei als Rumpf, nichts wird abgelegt) und
`POST /api/bank/import` (Datei, `decisions`, `token`); die zweite plant in der Schreibschlange neu und antwortet 409
mit neuer Vorschau, wenn die Marke (SHA-256 über Plan und Entscheidungen) abweicht.

Regeln je Auszug der Datei, in dieser Reihenfolge:

1. **Befunde des Lesers** stehen in der Vorschau. Ein Auszug, dessen Saldenprobe scheitert, wird nicht übernommen.
2. **Schon eingelesen**: gleiche `file_sha256` am Konto → „Dieser Auszug wurde am … schon eingelesen.“, nichts weiter.
3. **Konto** über IBAN, sonst `other_id`. Unbekannt → Rückfrage „Das Konto DE… wurde noch nie eingelesen. Ist es Ihr
   Konto für Mieteingänge?“ Ja legt es als `mixed` an. Sagt der Vermieter nein, wird nichts übernommen. Die Rückfrage nennt eigens: „Ein
   Kautionskonto lesen Sie hier bitte nicht ein.“
4. **Abgeschlossene Tage**: camt.053 und MT940 sind Tagesendauszüge, jeder Tag im Auszugszeitraum gilt. Bei camt.052
   gilt ein Tag nur, wenn er vor dem Kalendertag von `createdAt` liegt; ohne `createdAt` keiner. Beginnt der Bericht
   mitten am Tag (`FrDtTm` nicht um 0 Uhr), gilt sein erster Tag nicht (Durchsicht PR 1, W5). Übrige Umsätze zeigt
   die Vorschau als „kommt mit dem Tagesauszug“ und speichert nichts. Derselbe Tag auf mehreren Seiten einer Datei
   ist ein Tag (W2).
5. **camt.054** legt nie einen Tag an. Findet sich zu einem Posten ein gespeicherter, unverknüpfter Umsatz mit
   derselben `batch_reference` bzw. Bankreferenz, demselben Buchungstag und `amount_cents` gleich `batch.totalCents`,
   wird er durch seine Einzelposten ersetzt, wenn sie vollständig sind (Anzahl und Summe gleich; W3). Auf einem
   Mischkonto nur, wenn jeder Posten von einer Mieter- oder Zahler-IBAN kommt (W4); sonst bleibt die Sammelbuchung. Ist er schon verknüpft, bleibt er, die Vorschau sagt es. Ohne Treffer: „Zu
   dieser Aufschlüsselung fehlt der Tagesauszug.“
6. **Tagesabgleich** je abgeschlossenem Tag: unbekannt → neu. Bekannt mit gleicher Anzahl, Haben- und Sollsumme →
   übersprungen. Bekannt und abweichend → nichts geschrieben, Befund „Der TT.MM.JJJJ sieht in dieser Datei anders aus
   (n statt m Umsätze). Übernommen ist der frühere Stand; nehmen Sie den früheren Import im Verlauf zurück, wenn dieser
   Auszug gelten soll.“
7. **Einordnen** je Umsatz eines neuen Tages:
   - Konto `rental`: jeder Umsatz wird gespeichert.
   - Konto `mixed`: gespeichert wird ein Eingang oder eine Rücklastschrift von einer Mieter- oder Zahler-IBAN und ein
     Ausgang an eine solche. Ein **Eingang unbekannter Herkunft** ist eine Rückfrage je Umsatz: „Mieteingang“ (mit
     Mietverhältnis, auf Wunsch IBAN als Zahler merken), „Kaution“, „privat“. Ein **Ausgang an Unbekannt** gilt ohne
     Frage als privat. Privates geht nur in die Tagessumme.
   - Nachtrag 13.11. (Klicktest): Passen Name und Betrag (Soll des Buchungs-, Vor- oder Folgemonats) zu genau einem
     Mietverhältnis, trägt die Rückfrage einen Vorschlag, den das Fenster vorbelegt; bestätigt wird mit „Einlesen“.
     Gemerkte Zahler stehen in einer eigenen Karte und lassen sich entfernen, danach fragt das Einlesen wieder.
   - Die Vorschau zeigt private Umsätze nicht. Ausnahme sind die Rückfragen; sie leben nur im Arbeitsspeicher der
     Anfrage und des Browsers.
8. **Schreiben** in einer Transaktion: Konto (falls neu), `bank_imports`, `bank_days`, `bank_transactions`,
   `tenancy_payers`. Links entstehen erst beim Zuordnen.
9. **Ergebnis** als Satz: „12 Umsätze übernommen, 3 Tage schon eingelesen, 2 Umsätze kommen mit dem Tagesauszug.“

**Lückenlos eingelesen** (`coverageOf(imports)`, rein): Die Importe eines Kontos, nach `from_date` geordnet, schließen
an, wenn der nächste am Folgetag oder früher beginnt und sein Anfangssaldo gleich dem Endsaldo des vorigen ist. Die
Oberfläche nennt den längsten anschließenden Zeitraum bis zum jüngsten Auszug: „Konto lückenlos eingelesen vom … bis
…“; ohne Salden oder mit Bruch: „Zwischen … und … fehlt ein Auszug oder die Salden schließen nicht an.“

**Konto auf „nur Vermietung“ stellen**: `PUT /api/bank/accounts/:id` mit `kind: 'rental'` verlangt `confirm: true`;
die Rückfrage sagt „Ab jetzt wird jeder Umsatz dieses Kontos einzeln gespeichert, auch ein privater.“ Gilt für
künftige Importe, frühere Tage bleiben.

## Zuordnen und Buchen

`server/src/bank/match.ts` und `linkPlan.ts`, rein; Routen `POST /api/bank/links/plan` und `POST /api/bank/links`
(Marke und 409 wie oben).

**Vorschlag** je offenem Umsatz:

1. **Mietverhältnis**: über `counterparty_iban` gleich `tenancies.iban`, sonst `tenancy_payers`. Mehrere Treffer:
   dasjenige, das am Buchungstag läuft; laufen mehrere oder keines → kein Vorschlag. Kein Treffer über die IBAN: kein
   Vorschlag (Name und Zweck allein reichen nicht).
2. **Schon erfasst**: Gibt es am Mietverhältnis eine unverknüpfte Zahlung gleichen Betrags innerhalb von 7 Tagen um
   den Buchungstag, heißt der Vorschlag „mit der erfassten Zahlung vom … verknüpfen“ und legt nichts an. Bei zwei
   solchen Zahlungen die mit dem nächsten Datum, bei Gleichstand keine.
3. **Art**:
   - Rücklastschrift oder negativer Betrag von der Mieter-IBAN mit `reversal`: Mietzahlung mit negativem Betrag.
   - Eingang, Betrag gleich `depositCents`, höchstens 31 Tage um den Mietbeginn, nicht gleich dem Monats-Soll:
     Kautionsbuchung `received` (dieselbe Regel wie `possibleDepositsOf`).
   - Nachtrag 13.11. (Praxistest vor 0.18.0): Eine Rate (ein Drittel von `depositCents`) oder ein Eingang mit „Kaution“
     im Zweck, bis 100 Tage nach dem Beginn, solange die Kaution laut Buchungen offen ist (nicht laut Stammdaten erhalten,
     keine Bürgschaft oder Verpfändung) und der Betrag weder dem Soll des Buchungs- noch des Folgemonats gleicht:
     Kautionsbuchung `received`, gelb. Eine erfasste Zahlung gleichen Betrags bis 15 Tage entfernt geht vor (gelb, Miete).
   - Ausgang an den Mieter: nach dem Mietende und mit Kautionsstand größer 0 Kautionsbuchung `refunded`, sonst
     Abrechnungszahlung mit negativem Betrag (Guthaben). Immer gelb.
   - sonst: Mietzahlung.
4. **Ampel**: grün, wenn Mietverhältnis über IBAN eindeutig, Art Miete und Betrag gleich dem Monats-Soll des
   Buchungsmonats aus `rentLedger`; gelb sonst mit Vorschlag; grau ohne Vorschlag.

**Buchen** (`applyBankLinks` in `server/src/db/bank.ts`, eine Transaktion, ein Eintrag im Verlauf „n Umsätze aus dem
Kontoauszug gebucht“): je Entscheidung eine Zahlung über den Weg von `insertPayments` (Datum = Buchungstag, Notiz =
Verwendungszweck gekürzt auf 200 Zeichen, **kein** `designatedMonth`) oder eine Kautionsbuchung über
`insertDepositEntries`, dazu der Link. Ein Umsatz lässt sich auf mehrere Mietverhältnisse aufteilen (mehrere
Entscheidungen, Summe gleich dem Betrag). „Beiseitelegen“ setzt `set_aside`. „Lösen“ (`DELETE /api/bank/links/:id`)
entfernt den Link und fragt, ob die Zahlung mit gelöscht werden soll (Voreinstellung nein).

Nichts wird ohne Entscheidung gebucht; die Seite bietet „alle grünen übernehmen“ als eine Bestätigung.

## Oberfläche

Seite **„Kontoauszug“** (`client/src/pages/Kontoauszug.tsx`), in der Navigation unter „Mietkonto“:

1. **Einlesen**: Datei wählen oder ablegen → Vorschau (Befunde, Rückfragen, Satz zum Ergebnis) → „Übernehmen“.
2. **Offene Umsätze**: Tabelle mit Ampel, Datum, Betrag, Gegenseite, Zweck, Vorschlag; je Zeile Mietverhältnis und Art
   änderbar, „Beiseitelegen“; oben „Alle grünen übernehmen (n)“.
3. **Konten**: je Konto Bezeichnung, IBAN, Art, Satz zur Lückenlosigkeit, Liste der Importe; „Nur für die Vermietung“.
4. Der Satz zur Aufbewahrung der Auszüge und ein Lexikon-Eintrag „Mischkonto“.

Dazu: im Cockpit die Zeile „n Umsätze aus dem Kontoauszug sind noch nicht zugeordnet“ (nur wenn n > 0); im Mietkonto an
einer verknüpften Zahlung der Vermerk „aus dem Kontoauszug“; Schnellerfassung und Posteingang erkennen einen Auszug
(`looksLikeBankFile`, aus dem Leser) **vor** jeder Auswertung und zeigen „Das ist ein Kontoauszug. Kontoauszüge lesen
Sie auf der Seite Kontoauszug ein.“ mit Knopf; die Datei wird nicht gespeichert und nicht ausgewertet.

## Nähte für #292 und #308

- #292 (Abbuchungen und Kostenpositionen): `bank_transaction_links` bekommt später eine dritte Zielspalte
  `cost_item_id`, und das Einordnen auf dem Mischkonto eine Wahl „gehört zur Vermietung“ für Ausgänge. `outflow.ts`
  liest das Zahlungsdatum dann vom Umsatz. Hier wird dafür nichts gebaut.
- #308 (Nachzahlung am Betrag erkennen): eine weitere Regel in `match.ts` zwischen 3 b und 3 d.

## Sicherheit und Datenschutz

- Der Leser bleibt, wie er ist (keine Entitäten, Grenzen für Größe und ZIP). Die Routen nehmen höchstens
  `MAX_ZIP_TOTAL_BYTES` an.
- **Wächter** (Test): Kein Modul unter `server/src/bank/` importiert aus `server/src/ai/`, und keines unter
  `server/src/ai/` aus `server/src/bank/` außer `looksLikeBankFile`.
- Die Datei wird nie auf die Platte geschrieben; auf dem Mischkonto stehen private Umsätze in keiner Tabelle.
- `docs/datenschutz.md`: Abschnitt, was gespeichert wird und was nicht (gesiezt).

## Tests

1. Rein (node:test): `importPlan.test.ts` (jede Regel 1 bis 9 mit erfundenen Auszügen aus `server/test/fixtures/`),
   `match.test.ts`, `linkPlan.test.ts`, `coverage.test.ts`.
2. **Invarianten** mit festem Startwert: (a) denselben Auszug zweimal, überlappende Auszüge und Auszüge in beliebiger
   Reihenfolge einlesen ergibt denselben Bestand an Umsätzen und Tagen; (b) nach beliebigem Buchen und Lösen ist die
   Summe der verknüpften Ziele je Umsatz nie größer als sein Betrag, auch nach dem Ändern einer verknüpften Zahlung; (c) auf dem Mischkonto steht nach jedem Import kein Umsatz,
   dessen Gegenseite weder Mieter noch Zahler ist und den keine Rückfrage als Vermietung entschieden hat.
3. Integration (`server/test/api-kontoauszug.test.ts`): Plan und Ausführen, 409 bei geändertem Bestand, Buchen, Lösen,
   Löschen der Zahlung öffnet den Umsatz, Rücksprung über einen Import, Mietkonto und Steuer zählen eine gebuchte
   Zahlung wie eine von Hand erfasste (`deepStrictEqual` gegen denselben Bestand mit Handeingabe).
4. Client: `bankView.test.ts` (rein), `Kontoauszug.test.tsx`, Schnellerfassung und Posteingang weisen den Auszug ab.
5. Praxislauf: Backup und Wiederherstellen mit allen sechs Tabellen.
6. Golden-Tests unverändert grün. Beispielauszüge nur erfunden.

## Zuschnitt in drei PRs

1. **Schema und Import** (`plans/2026-11-12-kontoauszug-1-import.md`): Tabellen, `planBankImport`, Routen, Konten.
2. **Zuordnen und Buchen** (`…-2-zuordnung.md`): `match.ts`, `linkPlan.ts`, `applyBankLinks`, Lösen. Setzt die
   Kautionsbuchungen voraus (#228 Teil 1).
3. **Seite** (`…-3-seite.md`): Seite, Cockpit, Abweisen in Schnellerfassung und Posteingang, Lexikon, Doku, Praxislauf.

Bis PR 3 gemergt ist, sieht kein Nutzer etwas; die Routen aus 1 und 2 sind ohne Seite nicht erreichbar verlinkt.
Die drei Zweige sind gestapelt und bekommen vor dem Merge die Integrationsdurchsicht unter Geld und Daten.
