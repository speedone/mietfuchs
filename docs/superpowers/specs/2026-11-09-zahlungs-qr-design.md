# Zahlungs-QR-Code auf der Abrechnung (#624)

Stand: Entwurf vom 09.11.2026, Builder-Prüfung eingearbeitet (ECI-Kopf, Zeichenabbildung, EWR, Speichermuster, Stellen im Editor). Grundlage: EPC069-12 v3.0 (European Payments Council, 13.09.2022), Code in
`shared/letter.ts`, `shared/landlord.ts`, `client/src/components/Letter.tsx`, `client/src/components/PrintDrawer.tsx`.

## Ziel

Wer nachzahlen muss, scannt den Code mit der Banking-App und bekommt eine fertig ausgefüllte Überweisung: Empfänger,
IBAN, Betrag und Verwendungszweck. Das senkt Tippfehler und macht die Zahlung im Kontoabgleich wiedererkennbar.

**Wer nichts einstellt, merkt nichts**: Der Schalter steht ab Werk aus, die Golden-Tests bleiben unberührt, ein
gedrucktes Anschreiben sieht ohne Schalter aus wie bisher.

## Nicht-Ziele

- Kein Code bei Guthaben oder ausgeglichener Abrechnung (der Vermieter zahlt bzw. niemand).
- Kein Code für Miete, Kaution oder Mietkonto-Rückstände (eigenes Vorhaben, falls gewünscht).
- Kein eigener Kontoinhaber neben dem Vermieter: Empfänger ist wie bei `{Konto}` der Vermieter.
- Kein Schalter je Objekt. Die **IBAN je Objekt** gilt trotzdem (siehe unten), nur das Ein/Aus ist einmal je Installation.
- Kein GiroCode-Logo, kein Markenname (Marke der Deutschen Kreditwirtschaft mit eigenen Nutzungsbedingungen).
- Keine Bezahldienste, keine Links, nichts geht ins Netz.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es läuft)

- Der Code nennt eine **andere IBAN, einen anderen Betrag oder Empfänger** als der Text daneben. Text und Code
  kommen deshalb aus derselben Quelle (dem Anschreiben, beim Abschluss eingefroren).
- Eine Banking-App lehnt den Code ab oder zeigt Zeichensalat (Umlaute, Byte-Grenze, falsche Fehlerkorrektur).
- Ein früher zugestelltes Anschreiben druckt sich nachträglich mit Code, obwohl beim Zustellen keiner darauf war,
  ohne dass der Vermieter das selbst so einstellt (siehe „Eingefrorene Abrechnungen“).

## Der Inhalt des Codes (EPC069-12)

Reiner Text, Zeilen mit `\n` getrennt, **kein** Umbruch nach der letzten Zeile:

| Zeile | Inhalt | Regel |
|---|---|---|
| 1 | `BCD` | fest |
| 2 | `002` | Fassung 2: BIC im EWR nicht nötig |
| 3 | `1` | Zeichensatz UTF-8 |
| 4 | `SCT` | fest |
| 5 | leer | BIC |
| 6 | Empfänger | Pflicht, höchstens 70 Zeichen |
| 7 | IBAN | ohne Leerzeichen, groß, gültig nach `shared/iban.ts` |
| 8 | `EUR123.45` | 0.01 bis 999999999.99, Punkt, zwei Nachkommastellen ohne führende Nullen vor dem Punkt außer `0.` |
| 9 | leer | Zweckcode |
| 10 | leer | strukturierte Referenz (RF), nie zusammen mit 11 |
| 11 | Verwendungszweck | höchstens 140 Zeichen, darf fehlen |

Die Zeilen 10 und 11 werden nach der Richtlinie nur bis zur letzten belegten Angabe geschrieben: Ohne
Verwendungszweck endet der Inhalt nach Zeile 8 bzw. 9 (Entscheidung beim Bauen nach dem Original, siehe Offenes).

- **Höchstens 331 Byte** (UTF-8, nicht Zeichen). Reicht es nicht, wird zuerst der Verwendungszweck gekürzt, dann der
  Name; ein Wort wird nicht mitten im Zeichen (Surrogat, Umlaut) geschnitten.
- **Fehlerkorrektur M** fest (nicht höher, sonst wird der Code unnötig groß), höchstens QR-Version 13, **Byte-Modus
  ohne ECI-Kopf**: die UTF-8-Bytes über `mode.bytes(new TextEncoder().encode(payload))`. Zeile 3 (`1`) erklärt UTF-8
  bereits. *Entscheidung nach der Builder-Prüfung*: `mode.utf8` von lean-qr schreibt immer ECI 26 (12 Bit), dann passen
  bei Version 13/M nur 330 Byte; ohne ECI passen die 331 der Richtlinie, und das ist auch die verbreitete Form, die alle
  Apps lesen.
- **Zeichen**: Erlaubt ist der SEPA-Zeichensatz mit der deutschen Erweiterung (a-z, A-Z, 0-9, Leerzeichen,
  `' : ? , - ( + . ) / & * $ %`, Ä Ö Ü ä ö ü ß). Vorher abgebildet: Gedankenstriche und ähnliche (– — ‑ −) zu `-`,
  typografische Anführungszeichen („ “ ” ‚ ‘ ’ « ») zu `'`, `·` und `|` zu `,`. Andere Buchstaben verlieren ihr Zeichen über NFD (é → e), alles
  Übrige fällt weg, Zeilenumbrüche und Tabs werden zu einem Leerzeichen, Leerraum wird zusammengezogen.
  *Meine Entscheidung*: so lehnt keine Bank ab, und der Kontoabgleich (`purposeKey`) liest ohnehin nur a-z0-9. Ohne die
  Abbildung würde aus `01.05.2025–30.04.2026` (settlementTitle) `01.05.202530.04.2026`.
- **Nur IBANs aus dem EWR** (EU-27, IS, LI, NO; Länderliste in `shared/epcQr.ts`): Fassung 002 darf die BIC nur dort
  weglassen, und das Modell kennt keine BIC. Für andere Länder (auch SEPA-Länder außerhalb des EWR wie CH, GB, MC, SM)
  gibt `epcPayload` `null`. *Meine Entscheidung*; ein BIC-Feld ist nicht Teil dieses Vorhabens.

Ergebnis ist eine reine Funktion in **`shared/epcQr.ts`**:

```ts
epcPayload(i: { name: string; iban: string; amountCents: number; purpose: string }): string | null
```

`null`, wenn ein Pflichtteil fehlt oder ungültig ist (leerer Name nach Bereinigung, ungültige IBAN, Betrag außerhalb
der Grenzen). Der Aufrufer zeigt dann keinen Code; der Text daneben bleibt wie bisher.

## Woher die Werte kommen: Anschreiben, eingefroren

- **IBAN und Empfänger** aus dem Anschreiben des Mieters: `letter.values.IBAN` und `letter.values.Vermieter`. Diese
  setzt `lettersOf` über `effectiveLandlord(property, settings)` ein. **Damit gilt die abweichende IBAN und der
  abweichende Vermieter am Objekt automatisch** (Haus der Eltern, Erbengemeinschaft). Ein Test hält das fest: Objekt
  mit eigener IBAN → Code trägt die Objekt-IBAN, nicht die der Einstellungen.
- **Betrag**: `-statement.balanceCents` (negativ heißt Nachzahlung, siehe `chooseLetterBlocks`). Die Aufstellung ist
  ebenso eingefroren wie das Anschreiben.
- **Verwendungszweck**: neuer Baustein des Anschreibens (nächster Abschnitt), mit dem Abschluss eingefroren. Vor
  `epcPayload` läuft er durch `renderLetterText` (setzt `{Datum}` ein und hebt die Maskierung ``/`` auf),
  wie jeder Absatz beim Druck.

## Verwendungszweck als Baustein der Vorlage

Neuer Baustein **`paymentPurpose`** in `LETTER_BLOCKS` (shared/letter.ts):

- Bezeichnung „Verwendungszweck (QR-Code)“, `when`: „nur bei einer Nachzahlung, im QR-Code; steht nicht im Brieftext“,
  einzeilig.
- **Vorgabe** `'{Name}, {Wohnung}, {Abrechnung}'`, etwa „Erika Mustermann, EG links, Nebenkostenabrechnung 2025“.
  *Meine Entscheidung*: Name, Lage und Zeitraum reichen dem Vermieter zum Zuordnen; die Kennung des Mieters gibt es
  im Modell nicht als lesbare Nummer. **Der Name steht vorn**, weil gekürzt wird vom Ende her: Der lange Titel
  „Betriebskosten 2026, darin Heiz- und Warmwasserkosten …“ (rund 80 Zeichen) verliert dann sein Ende, nicht den Namen.
- **Dieselben Ebenen wie jeder Baustein**: Installation, Objekt, Mietverhältnis (`letter_texts`,
  `property_letter_texts`, `tenancy_letter_texts`). So kann ein Objekt mit eigenem Konto auch einen eigenen Zweck
  tragen, und ein einzelner Mieter einen abweichenden (etwa eine Kundennummer).
- Platzhalter wie in jedem Baustein, Prüfung mit `templateProblems`. Gesperrt (`only`) wird nichts zusätzlich;
  `{AnzahlBelege}` ist ohnehin nur in `attachments` erlaubt. `{Datum}` wird beim Druck wie sonst eingesetzt.
- **Leer** heißt wie bei jedem Baustein „weglassen“: Code ohne Verwendungszweck.
- Länger als 140 Zeichen nach dem Einsetzen: Das Feld im Editor sagt „wird im QR-Code auf 140 Zeichen gekürzt“
  (ruhiger Hinweis, keine Sperre, denn die Länge hängt am Mieter).
- `chooseLetterBlocks` und `statementBlocks` nehmen den Baustein **nicht** auf: Er ist kein Absatz.
- Der Editor (LetterDrawer) zeigt ihn dort, wo er auch `backPayment` zeigt. Zwei Stellen dort müssen ihn eigens
  behandeln (Builder-Prüfung): `exceedsOnePage` über alle Bausteine (LetterDrawer.tsx:76) zählt ihn **nicht** als Absatz,
  sondern über den QR-Kasten (unten); und auf Mieterebene, wo die gezeigten Bausteine aus `chooseLetterBlocks` kommen,
  darf er nicht „(in diesem Anschreiben nicht)“ heißen, solange der Mieter nachzahlt.

**Die Liste der Bausteine steht dreimal**: `LETTER_BLOCKS` in shared/letter.ts, der Vereinigungstyp `LetterBlock` in
shared/types.ts und `LETTER_BLOCKS` in server/src/db/schema.ts:128. Alle drei bekommen `paymentPurpose`.

**Datenbank**: Die drei Tabellen prüfen den Baustein per CHECK (`oneOf(..., LETTER_BLOCKS)`); die Liste wächst, also
eine Migration, die die Bedingung neu setzt (SQLite: Tabelle neu bauen, Muster der bisherigen Schritte, siehe
server/src/db/CLAUDE.md). Im selben Schritt die Spalte `settings.print_payment_qr`. Backup und Wiederherstellen nehmen
die Tabellen ohnehin mit; ein älteres Archiv ohne den Baustein ergibt die Vorgabe.

## Schalter

`settings.printPaymentQr?: boolean`, Spalte `print_payment_qr` (NULL = aus), im PrintDrawer neben Falzmarken und
Fußzeile: „QR-Code zum Bezahlen bei Nachzahlung“. Darunter, wenn er nichts bewirken kann, ein ruhiger Grund: „(braucht
Vermieter und gültige IBAN aus dem EWR)“ bzw. „(… am Objekt)“. Speichern nach dem Muster von **`printFooter`**
(write.ts, read.ts und in die Liste der Ja/Nein-Prüfung von `PUT /api/settings`, server/src/index.ts um Zeile 448;
`printFoldMarks` wird dort nicht geprüft und ist deshalb nicht die Vorlage).

*Meine Entscheidung*: nur Druck, nicht eingefroren, wie Falzmarken und Fußzeile.

## Wo der Code steht

- **Mit Anschreiben**: als Kasten direkt nach dem Absatz `backPayment` im Brief (Letter.tsx, `FLOW`). Links der Code
  (**30 mm** Kantenlänge einschließlich Ruhezone von 4 Modulen), rechts daneben klein: „Mit Ihrer Banking-App scannen“,
  dann Empfänger, IBAN (formatiert), Betrag und Verwendungszweck als Text. *Meine Entscheidung*: 30 mm statt der oft
  genannten 20 mm, weil Version 9 bis 13 bei 331 Byte viele Module hat und Laserdrucker bei 20 mm grenzwertig werden.
- **Ohne Anschreiben**: derselbe Kasten unter der Aufstellung nach dem Baustein `backPayment` (`underTable` in
  Abrechnung.tsx).
- **Seitenumfang**: `exceedsOnePage` rechnet den Kasten mit ein (rund 8 Zeilen), sonst warnt die Oberfläche zu spät.
- Schwarz auf Weiß; der Kasten hat einen weißen Hintergrund, damit Briefpapier ihn nicht stört. `break-inside: avoid`.
- Bildschirm und Druck zeigen dasselbe (keine `print-only`), damit der Vermieter vor dem Druck sieht, was kommt.
- Zugänglichkeit: `role="img"` mit `aria-label` „QR-Code für die Überweisung von {Betrag}“.

## Eingefrorene Abrechnungen

- Abgeschlossen **mit** Baustein `paymentPurpose` im eingefrorenen Anschreiben: Code wie bei offenen, wenn der Schalter
  an ist.
- Abgeschlossen **vor** diesem Vorhaben (kein `paymentPurpose` in `letter.texts`): **kein Code**. Was zugestellt wurde,
  ändert eine Programmänderung nicht rückwirkend. Ein Wiederöffnen und erneuter Abschluss ergibt ihn.
- Vor #415 abgeschlossen (kein Anschreiben im Stand): kein Code.

## Bibliothek

**lean-qr 2.7.4** (MIT, keine Abhängigkeiten, unter 4 kB), nur im Client. Erzeugt mit `mode.bytes` aus den
UTF-8-Bytes (ohne ECI, siehe oben), `minCorrectionLevel` und `maxCorrectionLevel` auf M, `maxVersion: 13`, Ausgabe als SVG (`toSvgSource` bzw. die
SVG-Hilfe aus `lean-qr/extras/svg`), damit der Druck scharf bleibt. Einbinden als Inline-SVG; kein `dangerouslySetInnerHTML`
mit Fremdtext, der Text im SVG ist nur Pfaddaten (vom Builder zu bestätigen).

Verworfen: fertige EPC-Pakete (girocode, sepa-payment-qr-code, eu-payment-qr), weil der Inhalt in 40 Zeilen selbst
gebaut und genauer getestet ist als dort; qrcode (soldair) wegen Abhängigkeiten; uqr wegen Fassung 0.1.

## Tests

1. **shared/epcQr.ts** (server/test/epcQr.test.ts, node:test): Musterinhalt Zeile für Zeile; Betrag 1 Cent und
   999999999,99 €, darüber und 0 → `null`; IBAN mit Leerzeichen, klein, ungültig, gültig aber außerhalb des EWR (CH,
   GB) → `null`; leerer Name → `null`; Umlaute bleiben, é wird e, Emoji fällt weg, `–` wird `-`; Zeilenumbruch im
   Zweck; 140-Zeichen-Grenze; 331-Byte-Grenze mit langem Namen und Zweck aus Umlauten (genau 331 Byte lässt sich
   erzeugen); kein abschließendes `\n`.
2. **shared/letter.ts** (letter.test.ts): Baustein `paymentPurpose` wird eingesetzt und eingefroren; Ebenen
   Installation/Objekt/Mieter; nicht in `chooseLetterBlocks`; **abweichende IBAN am Objekt landet in `values.IBAN`**.
3. **Client** (vitest + jsdom): Code nur bei Nachzahlung, Schalter an, gültiger IBAN, Name; nicht bei Guthaben,
   ausgeglichen, Schalter aus, eingefrorenem Anschreiben ohne Baustein. Mit und ohne Anschreiben.
4. **Rundweg**: Ein Test erzeugt den Code mit lean-qr und liest ihn mit einem Decoder (Vorschlag: `jsqr` als
   Entwicklungsabhängigkeit, Apache-2.0) zurück; Ergebnis byte-gleich mit `epcPayload`, auch mit Umlauten.
5. **Migration**: neuer Schritt in der Kette (migrations-Test), Baustein speicherbar auf allen drei Ebenen.
6. Golden-Tests unverändert grün (die Rechnung ist nicht berührt).

## Doku und Texte

- Lexikon: Eintrag „QR-Code zum Bezahlen“ (gesiezt), was drinsteht, dass nichts ins Netz geht.
- docs/funktionsweise.md o. Ä.: ein Absatz; CHANGELOG „Unveröffentlicht“ mit Issue-Link.
- server/src/CLAUDE.md (Abschnitt Anschreiben) und client/CLAUDE.md: Baustein, Schalter, Quelle der Werte.
- Bildschirmfoto des Anschreibens mit Code beim nächsten Release (scripts/CLAUDE.md).

## Offenes für den Builder (kein Fachentscheid)

- Ob nach EPC v3.0 die leeren Zeilen 9/10 bei fehlendem Zweck stehen bleiben oder entfallen: im Originaldokument
  nachlesen und so bauen; beide Formen lesen die Apps.
- Genaue Prüfung, ob eine EPC-Fassung 3.1 (März 2024, nur aus zweiter Hand belegt) etwas am Inhalt ändert.
- Name der Migration und genaue Lage des Kastens im Raster von letter.css.
