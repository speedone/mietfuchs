# Übergabe: Release 0.14.0 „Quellrechnung und Steuerjahr“

Stand 31.10.2026. Wer hier weitermacht, braucht nur das Repo: Alle Entwürfe, Zwischenstände und Skripte
liegen auf GitHub. Arbeitsweise wie in [CLAUDE.md](../../CLAUDE.md) (Durchsicht mit frischem Kontext vor
jedem PR, Befunde mit vorher rotem Test, `Refs #N`, Squash-Merge, Label `status: awaiting release`).

## Worum es geht

0.14.0 bündelt zwei Themen:

1. **Quellrechnung (#455)**: Eine aufgeteilte Rechnung hat eine gespeicherte Quelle (`cost_sources`,
   `cost_items.source_id`). Die Teile werden nach Tagen daraus abgeleitet, statt bei jedem Wechsel des
   Zeitraums neu geraten zu werden. **Fertig in `main`.**
2. **Steuerjahr**: Ausgaben und Einnahmen stehen im richtigen Jahr der Anlage V (§ 11 EStG), dazu
   Verteilung nach § 82b EStDV, Erhaltungsrücklage bei Verwendung und Kopfangaben. **In Arbeit**, 12 PRs
   im Stapel.

Die Migration 0077 (Datenschritt Quellrechnung) ist noch unveröffentlicht und darf bis zum Release
geändert werden (Prüfsumme in `server/test/data-steps.test.ts` mitziehen). Mit dem Tag ist sie eingefroren.

## Fertig in `main` (seit v0.13.1)

| PR | Inhalt |
|---|---|
| #462, #466, #467 | Quellrechnung in drei Schritten |
| #473, #474, #475, #476 | Folgepunkte #468–#472 (Gutschrift beim Wechsel, Steuer-ZIP, Belegkopien, Prüfsummen) |
| #458–#461, #463–#465 | Befunde aus dem Browsertest (ohne Issue) |
| #477 | Wackeltest Vorschaubilder |
| #479 | Datenschritt 0077: doppelt erfasste Rechnungen bleiben getrennt, Beleg an einem Teil |
| #480 | Wechsel des Rhythmus: Zusatz nennt die getragenen Tage, hin und zurück ohne Cent-Drift |
| #481 | Stapel Nr. 2: `server/src/rentAllocation.ts`, Verteilung der Mietzahlungen nach § 366 BGB |

Geprüft: Durchsicht des Endstands unter Geld und Daten, voller Prüflauf (`release.yml` von Hand) grün,
Umstiegslauf mit Praxisszenarien (siehe [umstieg-szenarien/](umstieg-szenarien/README.md)): Nach dem
Umstieg und nach dem Einspielen eines Backups aus 0.13.1 ist jede Zahl centgenau gleich.

Mit `status: awaiting release`: #455, #468, #469, #470, #471, #472.

## Plan und Entwürfe

- **Gesamtplan mit Reihenfolge, Abhängigkeiten, Migrationsnummern, Konfliktdateien, Kreuz-Invarianten
  für die Schlussdurchsicht und Changelog-Wortlaut:**
  [specs/2026-10-30-release-0.14-plan.md](specs/2026-10-30-release-0.14-plan.md)
- Entwürfe je Thema (alle nach einer Querprüfung überarbeitet,
  [specs/2026-10-30-crossreview.md](specs/2026-10-30-crossreview.md)):
  - #478 Steuerjahr beim Zeitraumwechsel: auf dem Branch `zeitraumwechsel-steuerjahr-478`,
    `docs/superpowers/specs/2026-10-30-zeitraumwechsel-steuerjahr-design.md`
  - #281 Mietkonto mit Übertrag: auf dem Branch `mietkonto-uebertrag-281`,
    `docs/superpowers/specs/2026-10-30-mietkonto-uebertrag-design.md` (mit Nachtrag zu `SnapshotPayment`)
  - #312 Zufluss nach Zeilen: [specs/2026-10-30-steuer-zufluss-design.md](specs/2026-10-30-steuer-zufluss-design.md)
  - #96 Rest (Entnahme Erhaltungsrücklage, Kopfangaben, Gesamtsicht):
    [specs/2026-10-30-steuer-objekt-ruecklage-design.md](specs/2026-10-30-steuer-objekt-ruecklage-design.md)
  - #262 § 82b EStDV: [specs/2026-10-30-erhaltungsaufwand-verteilen-design.md](specs/2026-10-30-erhaltungsaufwand-verteilen-design.md)

Getroffene Entscheidungen stehen in den Entwürfen (Abschnitte „Entschieden“ bzw. „Stand nach der
Durchsicht“). Die wichtigsten: eine Verteilfunktion für Mietkonto und Steuer im selben Release (#281 kommt
deshalb mit); Kürzung bei verbilligter Vermietung je Jahr der Rate; Sonderumlage im Jahr der Ausgabe durch
die Gemeinschaft; § 82b Abs. 2 (vorzeitiges Ende) im Release; ein Wahlrecht je Rechnung; kein Einfrieren
abgegebener Steuerjahre; §§ 11a/11b bleiben draußen; Kostenart heißt „Entnahme Erhaltungsrücklage“.

**Offen gelassen, nicht gerechnet** (im Entwurf zu #281 benannt): ob nach Ablauf der Abrechnungsfrist
unbezahlte Vorauszahlungen über eine verspätete Abrechnung noch verlangt werden können. Das Mietkonto
zeigt sie, zählt sie aber nicht als mahnfähigen Rückstand. Nicht selbst gelesen: H 21.1 EStH, BGH V ZR 96/24,
Anlage V 2023 S. 2 und der Vordruck 2026 (dafür keine Zeilennummern).

## Stapel: Stand je PR

| Nr. | PR | Stand |
|---|---|---|
| 1 | #478 Steuerjahr beim Zeitraumwechsel (lockert `requireTaxYear`) | **WIP** auf `zeitraumwechsel-steuerjahr-478`, siehe unten |
| 2 | #312 PR 1, `rentAllocation.ts` | **gemergt** (#481) |
| 3 | #281 Mietkonto, Migration 0078/0079 | **WIP** auf `mietkonto-uebertrag-281`, siehe unten |
| 4 | #96 PR 1, Entnahme und `anlageVLines` (Label `ai-eval`) | offen |
| 5 | #96 PR 2, Kopfangaben und `Tenancy.relative`, Migration 0080/0081 | offen |
| 6 | #312 PR 2, `received` je Zeile | offen |
| 7 | #312 PR 3, Oberfläche und `Einnahmen.csv` | offen |
| 8 | #262 PR 1, Migration 0082/0083, `allowsSpread` | offen |
| 9 | #262 PR 2, Rechnung mit Kürzung je Jahr | offen |
| 10 | #262 PR 3, Oberfläche und ZIP | offen |
| 11 | #262 PR 4, § 82b Abs. 2 | offen |
| 12 | #96 PR 3, Gesamtsicht | offen |

Einnahmen (2, 3, 6, 7) und Ausgaben (4, 5, 8–11) lassen sich parallel bauen, gemergt wird in dieser
Reihenfolge. Migrationsnummern beim Umsetzen auf `main` neu erzeugen (`npm --prefix server run db:generate`).

### Nr. 1, #478 (`zeitraumwechsel-steuerjahr-478`)

Umsetzung nach dem Entwurf weitgehend vorhanden, als WIP-Commit gesichert (durch das Nutzungslimit
unterbrochen, bevor der Bericht kam). `npm run typecheck` grün. Servertests auf dem WIP-Stand: 4082 von 4085 grün, 2 übersprungen,
**1 rot**: „Golden: je Zeitraum dieselben Summen wie vor dem Umbau“ (`server/test/db-wechsel-quelle.test.ts`),
zuerst bei „Ablauf 0, Wechsel 2: Straßenreinigung 0-0 in 2024-11 hat mehr Zeilen als vorher (2 statt 1)“.
Erwartet: Mit #478 behält ein Teil sein angegebenes Jahr der Zahlung, und Teile verschiedener Jahre
werden nicht mehr zu einer Zeile zusammengefasst (§ 11 Abs. 2 EStG); die Vorlage hält das Verhalten von vor
#455 fest, **einschließlich des Fehlers aus #478**. **Zu entscheiden und zu begründen:** Die Vorlage nicht
umschreiben. Im Test die Regel festhalten: Summen je Zeitraum bleiben exakt; die Zeilenzahl darf steigen und
ein Betrag darf zwischen Steuerjahren wandern, **nur** wo die Vorlage ein angegebenes Jahr der Zahlung
überschrieben hat (genau der Fehler aus #478; das lässt sich aus `taxYear` vor dem Wechsel ablesen). Jede
andere Abweichung bleibt rot. Alternativ die betroffenen Abläufe nach dem Muster von `GOLDEN_DEVIATIONS`
ausdrücklich listen.
Nächste Schritte: Entwurf gegen den Code abhaken (insbesondere `keptTaxYear` an allen drei Stellen,
409-Rückfrage, `keptTaxYears` in der Vorschau, Anzeige im Formular, Rundlauf-Invariante), Client-Tests,
Changelog prüfen, WIP-Commit umformulieren, Durchsicht, PR.

### Nr. 3, #281 (`mietkonto-uebertrag-281`)

Mitten in der Arbeit unterbrochen. Vorhanden: Migration 0078/0079 (`payments.designated_month`, Bedingung
in Arbeit), `SnapshotPayment` mit `id`/`designatedMonth`, erste Umstellung von `rentLedger` in `calc.ts`,
FIFO-Orakel (`server/testing/fifoLedger.ts`) und neue Tests. `npm run typecheck` hat noch 14 Fehler in
Client-Tests (`notDemandableCents` und neue Felder von `RentMonth`/`RentLedger` fehlen in Testdaten).
Offen: Rest der Umstellung, Abrechnungsreife (drei Gründe), `prepayment.arrears` aus offenen
Vorauszahlungsteilen, Oberfläche (Entwurf mit Speichern/Verwerfen für Art und Monat), `FIELD_LABELS` samt
Wächter, Backup/Validator, Changelog („Geändert“, sichtbare Änderung des Mietkontos).

## Vor dem Release

- Stapel fertig, Integrationsdurchsicht des Endstands (`main..Spitze`) unter Geld und Daten mit den
  Kreuz-Invarianten aus dem Plan, Label `full-check`, `scripts/umstieg-praxislauf.mjs`.
- Umstiegslauf 0.13.1 → Spitze mit [umstieg-szenarien/](umstieg-szenarien/README.md), ergänzt um die
  neuen Funktionen.
- Version **0.14.0** (nicht 0.13.2): `server/src/db/releaseSteps.ts` braucht den Eintrag mit der Zahl der
  Schritte; der Wächter in `law-release.test.ts` erzwingt das beim Tag.
- Empfehlung an den Vermieter: einmal mit einer Kopie des eigenen Bestands prüfen.

## Später (nicht in 0.14.0)

- Rückweg für Altfälle ohne Quelle (`isInvoicePart = sourceId || isSplitPart`): „zu einer Rechnung
  zusammenführen“; ein Beleg, der später an einen einzelnen alten Teil kommt, gibt ihm keine Quelle.
- Zusatz „(anteilig …)“ aus der Quelle ableiten statt als Text in der Beschreibung.
- Bekannte Grenze des Datenschritts: In einem Objekt mit Wechsel des Rhythmus wird eine doppelt erfasste
  Rechnung mit verschiedenem Betrag zusammengeführt (von Resten eines Wechsels nicht zu unterscheiden; im
  Changelog benannt).
- #292 (Kontoauszug mit Kostenpositionen) nach #188; #220 betrifft die Abrechnung, nicht die Steuer.
