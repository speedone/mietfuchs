# Hausgeldabrechnung als Klammer, von der KI zerlegt (#141, #102)

Stand: Entwurf vom 12.11.2026. Grundlage: Issues #141 (offener Teil: die Klammer) und #102, der Entwurf
`2026-10-02-schluessel-merken-design.md`, Code in `shared/types.ts` (`ExternalBasis`, `Unit.mea`, Schlüssel
`external`), `shared/assessment.ts` (`lastExternalBasis`, `etwByStatement`), `client/src/carryOver.ts`, die
Belegbuchung (`server/src/bookingPlan.ts`, `server/src/assessment.ts`, `StoredAssessment`), `server/src/extract.ts`.

## Ziel

Wer eine Eigentumswohnung vermietet, gibt die Hausgeldabrechnung der Gemeinschaft **einmal als Ganzes** ein: Kopf
(Beleg, Datum, Maßstab und seine Summe) einmal, darunter je Kostenart nur den eigenen Anteil und die Gesamtkosten.
Im Folgejahr stehen die Zeilen schon da, es fehlen nur die Beträge. Wer will, lädt die Abrechnung hoch und bekommt
die Zeilen von der KI vorgeschlagen.

**Wer ein Haus vermietet, merkt nichts**: Die Klammer erscheint nur bei der Objektart Eigentumswohnung. Bestehende
Positionen „laut Gemeinschaftsabrechnung“ bleiben, wie sie sind, und rechnen centgenau wie bisher. `calc.ts` wird
nicht angefasst.

## Ist-Stand (nachgesehen)

- Eine Position mit Schlüssel `external` trägt ihren Betrag (eigener Anteil) und `externalBasis` (Maßstab, Summe
  des Maßstabs, Gesamtkosten der Anlage). Die Engine rechnet daraus Rechenweg und Plausibilität.
- Seit 0.10.0: Vorjahr übernehmen (nur im Browser), Vorschlag „laut Gemeinschaftsabrechnung“ bei Eigentumswohnungen,
  die Summe der Miteigentumsanteile kommt von der zuletzt erfassten Position (`lastExternalBasis`).
- Die KI-Belegauswertung kennt Rechnungen und Zählerstände; eine Hausgeldabrechnung liest sie heute als Rechnung mit
  einem Betrag je Zeile, ohne Maßstab und ohne Gesamtkosten.

## Nicht-Ziele

- Keine Verwaltung der Gemeinschaft, kein Wirtschaftsplan, keine Hausgeld-Vorauszahlungen als Soll und Ist.
- Keine eigene Heizkostenabrechnung der Gemeinschaft zerlegen (bleibt bei der Heizung, docs/heizung.md).
- Keine neue Steuerlogik: Erhaltungsrücklage und Zahlungsjahr des Hausgelds sind seit #143 geregelt.
- Kein Zwang zur Klammer: Einzelne Positionen „laut Gemeinschaftsabrechnung“ ohne Klammer bleiben möglich.
- Keine automatische Übernahme. Die KI schlägt vor, der Mensch bestätigt (wie bei jeder Auswertung).

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es läuft)

- Eine bestehende Abrechnung einer Eigentumswohnung ändert durch die Migration oder das Anlegen einer Klammer eine Zahl.
- Kopf und Positionen sagen Verschiedenes (Maßstab am Kopf geändert, Position rechnet mit dem alten).
- Die KI ordnet eine nicht umlagefähige Zeile (Verwaltung, Rücklage) als umlagefähig ein, und sie ist vorab angehakt.
- Eine abgeschlossene Abrechnung ändert sich, weil jemand den Kopf anfasst.

## Recht

Die Klammer selbst stellt keine Rechtsbehauptung auf. Zwei Sätze der Oberfläche stützen sich auf Quellen:

| Aussage | Quelle | Stand |
|---|---|---|
| Der Verwalter stellt nach Ablauf des Kalenderjahres die Jahresabrechnung auf | § 28 Abs. 2 WEG | Wortlaut gelesen am 12.11.2026 |
| Die Abrechnungsfrist gegenüber dem Mieter läuft auch ohne Beschluss der Gemeinschaft | BGH VIII ZR 249/15 (Fundstelle aus #102) | **nicht gelesen** |
| Welche Kostenarten umlagefähig sind | § 2 BetrKV, schon im Projekt über `isNotAllocable` und die Kostenarten | vorhanden |

Der Fristhinweis aus #102 wird erst geschrieben, wenn der Builder die Entscheidung gelesen hat. Die vorhandene
Cockpit-Zeile für die Eigentumswohnung ohne Hausgeld (`condoWithoutHousingMoney`) bleibt bis dahin, wie sie ist.

## Datenmodell

Neue Tabelle **`housing_statements`**: `id`, `property_id` (RESTRICT wie die Wurzeln), `period`, `file` (Beleg im
Belegordner, NULL erlaubt), `statement_date` (NULL erlaubt), `measure` (`mea`, `area`, `units`), `measure_total`
(größer 0), `note`. Je Objekt und Zeitraum mehrere möglich (zwei Wohnungen in derselben Anlage bekommen zwei
Abrechnungen; ein Eigentümerwechsel im Jahr auch).

Neu an **`cost_items`**: nur `housing_statement_id` (NULL, `ON DELETE RESTRICT`: Die Position ist bezahlt und bleibt
in der Abrechnung, auch wenn die Klammer geht; das Lösen läuft deshalb über das Repository, siehe API).

**Der Maßstab steht einmal, am Kopf** (geändert am 12.11.2026 nach der Durchsicht des Datenmodells; vorher schrieb
das Repository eine Kopie in jede Position und ein Wächter prüfte den Gleichstand). Die Engine liest weiter
`externalBasis` an der Position und bleibt unberührt:

- Eine Position mit Klammer speichert `external_measure` und `external_total` als NULL. Die eine Lesestelle
  (`read.ts`, wo `externalBasis` aus den drei Spalten entsteht) setzt `measure` und `total` des Kopfes ein. Ändert
  sich der Kopf, wird keine Position geschrieben.
- Hat die Position einen **eigenen Maßstab** (etwa Kabel nach Einheiten), stehen `external_measure` und
  `external_total` wie heute an ihr und gelten. Ein Kennzeichen dafür gibt es nicht: gespeichert heißt eigen.
- `external_total_cents` (Gesamtkosten der Anlage) bleibt je Position. Fehlen sie, hat die Position wie heute keine
  `externalBasis`.
- Der Schreibweg (`repository.ts`, wo die drei Spalten aus `externalBasis` entstehen) speichert für eine Position mit
  Klammer `measure` und `total` nur, wenn sie vom Kopf abweichen.
- Die Prüfbedingung „alle drei oder keine“ an `cost_items` wird dafür gelockert (Neubau der Tabelle, eigener
  Schritt nach dem Muster 0085/0086): Maßstab und Summe nur gemeinsam; mit Maßstab auch Gesamtkosten; Gesamtkosten
  ohne Maßstab nur mit `housing_statement_id`. Ein Bestand von vorher erfüllt die neue Bedingung unverändert.

**Abgeschlossen bleibt abgeschlossen**: Ist der Zeitraum der Klammer abgeschlossen, lehnt der Server jede Änderung an
Kopf und Zeilen ab (409 mit dem vorhandenen Satz für abgeschlossene Zeiträume). Die eingefrorene Abrechnung liest
ohnehin ihren eigenen Stand.

**Belege**: `housing_statements.file` kommt in `FILE_COLUMNS` (fileRefs.ts), sonst räumte der Papierkorb den Beleg weg.

Typen in `shared/types.ts`: `HousingStatement`, `CostItem.housingStatementId?: string | null`,
sonst nichts an der Position. Die Migration legt für bestehende Positionen **keine** Klammer an.

## API

In `server/src/db/housingStatements.ts`:

- `GET /api/housing-statements?property=&period=` → Köpfe mit ihren Positionen (Kennungen).
- `PUT /api/housing-statements/:id/sheet` (und `POST /api/housing-statements/sheet` für eine neue): **das ganze Blatt
  in einem Zug**, Kopf und Zeilen:

```ts
type HousingSheet = {
  propertyId: string; period: PeriodKey
  file: string | null; statementDate: string | null
  measure: ExternalMeasure; measureTotal: number; note?: string
  rows: {
    costItemId?: string            // fehlt: neue Position
    category: string; description?: string
    ownCents: number               // eigener Anteil, wird `amountCents`
    totalCents: number | null      // Gesamtkosten der Anlage
    own?: { measure: ExternalMeasure; total: number }   // abweichender Maßstab
    remove?: true                  // Position löschen
  }[]
}
```

  Eine Transaktion, ein Eintrag im Verlauf („Hausgeldabrechnung gespeichert“). Jede Zeile läuft durch denselben Weg
  wie `POST`/`PUT /api/costItems` (`buildCostItemBody` hat sein Gegenstück im Server: dieselben Prüfungen, Schlüssel
  `external`, Teilnehmer wie bisher vorgeschlagen), nichts wird an der Prüfung vorbei geschrieben.
- `DELETE /api/housing-statements/:id` löst die Klammer; die Positionen bleiben. Dieselbe
  Transaktion schreibt Maßstab und Summe des Kopfes in jede Position, die bisher erbte, und leert den Verweis. Mit
  `?items=delete` gehen sie mit, nach Rückfrage.
- Eine einzelne Position lässt sich weiter über die Seite Kosten ändern; ändert jemand dort den Maßstab einer Position
  mit Klammer, speichert die Position ihn als eigenen Maßstab; stellt er ihn auf den des Kopfes zurück, erbt sie wieder.

## Oberfläche

Seite Kosten, nur bei Objektart Eigentumswohnung, über der Liste:

- **Karte „Hausgeldabrechnung JJJJ“** je Klammer, sonst der Knopf „Hausgeldabrechnung erfassen“ (und „Aus dem Vorjahr
  übernehmen“, wenn es im Vorjahr eine Klammer oder Positionen „laut Gemeinschaftsabrechnung“ gab).
- Das Blatt (Seitenfenster, breit): Kopf mit Beleg, Datum, Maßstab, Summe des Maßstabs; daneben der eigene Anteil aus
  den Stammdaten („Ihre Wohnung: 87 von 1.000 Miteigentumsanteilen“). Darunter die Tabelle: Kostenart, eigener
  Anteil, Gesamtkosten, rechnerischer Anteil (nur Anzeige, mit Abweichung), „umlagefähig“ (aus der Kostenart, nicht
  wählbar), „eigener Maßstab“ (klappt Maßstab und Summe auf). Fußzeile: Summe der eigenen Anteile, davon umlagefähig.
- **Vorjahr übernehmen** füllt Kostenarten, Beschreibungen und eigene Maßstäbe, keine Beträge, kein Beleg; es bleibt
  im Browser, bis gespeichert wird (wie `carryOver.ts`).
- Bestehende lose Positionen „laut Gemeinschaftsabrechnung“ desselben Zeitraums bietet das Blatt zum Aufnehmen an
  („3 Positionen dieses Jahres gehören noch zu keiner Hausgeldabrechnung. Aufnehmen?“), nie von selbst.
- In der Liste der Kosten tragen Positionen einer Klammer den Vermerk „Hausgeldabrechnung“; Bearbeiten öffnet das Blatt.
- Stammdaten: Beim Anlegen einer Wohnung in einem Objekt der Art Eigentumswohnung steht das Feld
  „Miteigentumsanteile“ im ersten Schritt (heute bei den weiteren Angaben). Die Zähler-Seite zeigt bei dieser
  Objektart statt des leeren Zustands für Hauptzähler den Satz „Bei einer Eigentumswohnung rechnet meist die
  Gemeinschaft ab. Zähler brauchen Sie nur, wenn Sie selbst nach Verbrauch verteilen.“ Beides nur, soweit der Builder
  es beim Nachsehen nicht schon so vorfindet.

Logik in `client/src/housingSheet.ts` (rein), die Seite rendert nur.

## KI-Belegart „Hausgeldabrechnung“ (#102)

- **Erkennen**: `classifyDocType` bekommt die dritte Antwort `hausgeld`; in Schnellerfassung, Posteingang und auf der
  Seite Kosten lässt sich die Belegart auch von Hand wählen (wie heute „Rechnung“).
- **Lesen** (`server/src/extractHousing.ts`): eigener Prompt und eigenes Schema, getrennt von den Rechnungen:

```ts
type HousingExtraction = {
  statementDate: string | null; periodStart: string | null; periodEnd: string | null
  measure: ExternalMeasure | null; measureTotal: number | null; ownMeasure: number | null
  lines: { description: string; category: string; ownCents: number | null; totalCents: number | null
           measure: ExternalMeasure | null; measureTotal: number | null }[]
  ownTotalCents: number | null     // Summe der eigenen Anteile laut Beleg, zur Probe
}
```

  Die Kostenart je Zeile kommt aus derselben Liste wie bei Rechnungen (categories.test.ts hält sie zusammen).
  Heizkosten, die die Gemeinschaft nach Verbrauch abrechnet, bleiben eine Zeile mit eigenem Anteil.
- **Vorschlag, nicht Buchung**: Das Ergebnis öffnet **das Blatt** vorbelegt (Kopf und Zeilen), nicht die Prüfung der
  Belegbuchung. Der Beleg liegt wie jeder im Belegordner und wird mit dem Speichern des Blatts verknüpft. So gibt es
  einen Weg, eine Hausgeldabrechnung einzugeben, nicht zwei. Das Ergebnis der Auswertung wird als Auswertung des
  Belegs gespeichert (`assessments`, neue Herkunft `housing`), damit ein späteres Öffnen aus dem Posteingang dasselbe
  Blatt zeigt, ohne neu auszuwerten.
- **Ampel je Zeile** (rein, `shared/housingCheck.ts`): rot ohne eigenen Anteil; gelb, wenn die Kostenart geraten ist,
  wenn eigener Anteil und rechnerischer Anteil (Gesamtkosten × eigener Maßstab ÷ Summe) um mehr als 1 € und 2 %
  auseinanderliegen, oder wenn die Zeile im Vorjahr fehlte; sonst grün. **Nicht umlagefähige Kostenarten sind nie
  vorab angehakt als umlagefähig**: Die Umlagefähigkeit hängt allein an der Kostenart, und eine Zeile, deren Text
  nach Verwaltung, Rücklage, Instandhaltung oder Kontoführung klingt, die KI aber einer umlagefähigen Art zuordnet,
  wird gelb mit dem Grund „Klingt nach einer nicht umlagefähigen Position“ (Stichwörter in einer Liste mit Test).
- **Proben über das Blatt**: Summe der eigenen Anteile gegen `ownTotalCents`; `ownMeasure` gegen `Unit.mea`
  („Der Beleg nennt 91 Anteile, in den Stammdaten stehen 87.“); Zeitraum des Belegs gegen den gewählten.
- **Bestätigung externer Dienste** und Abbruch wie bei jeder Auswertung (server/src/ai/CLAUDE.md), nichts Neues.
- **KI-Prüflauf**: erfundene Hausgeldabrechnungen unter `scripts/ai-eval/` als PDF mit Textebene, als Scan und als
  Foto, mit erwarteten Zeilen in `cases.json`; `score.mjs` bewertet je Zeile Kostenart, eigenen Anteil, Gesamtkosten
  und den Kopf. Auslöser bleibt das Label `ai-eval`.

## Tests

1. Rein: `housingSheet.test.ts` (Client), `housingCheck.test.ts` (Ampel, Proben, Stichwörter).
2. Integration `server/test/api-hausgeld.test.ts`: Blatt anlegen, ändern, Zeile entfernen, Klammer lösen mit und
   ohne Positionen; Kopf ändern wirkt auf alle Positionen ohne eigenen Maßstab, ohne eine von ihnen zu schreiben; abgeschlossener Zeitraum 409;
   Verlauf und Rücksprung; Papierkorb lässt den Beleg stehen; Backup.
3. **Regression**: Ein Bestand mit zwölf losen Positionen „laut Gemeinschaftsabrechnung“ und derselbe Bestand, über
   das Blatt eingegeben, ergeben dieselbe Abrechnung, dasselbe Mietkonto und dieselbe Steuer (`deepStrictEqual`
   ohne Kennungen). Golden-Tests unverändert.
4. Bedingungen der Datenbank (db-hausgeld.test.ts): Gesamtkosten ohne Maßstab und ohne Klammer scheitern; Maßstab
   ohne Summe scheitert; Löschen einer Klammer mit Positionen an der Datenbank vorbei scheitert. Einen Wächter für
   den Gleichstand braucht es nicht mehr, weil es keine Kopie gibt.
5. KI: `extractHousing` gegen den nachgebauten Dienst (server/testing/api.ts) mit festen Antworten, auch kaputten
   (fehlende Felder, Text statt Zahl, negative Beträge für Gutschriften).
6. Client jsdom: Blatt (Auswahlfelder zeigen den gespeicherten Wert), Vorjahr übernehmen, Aufnehmen loser Positionen,
   vorbelegtes Blatt aus der Auswertung.
7. Migration; Praxislauf mit einer Klammer.

## Zuschnitt in zwei PRs

1. **Die Klammer** (#141): Tabelle, Blatt-Routen, Oberfläche, Vorjahr, Stammdaten-Kleinigkeiten.
2. **Die KI-Belegart** (#102): Erkennen, Lesen, Ampel, vorbelegtes Blatt, KI-Prüflauf.

## Doku

CHANGELOG mit Links auf #141 und #102; server/src/CLAUDE.md (Abschnitt „Schlüssel merken“: der Satz „bis #102“
entfällt, neuer Abschnitt „Hausgeldabrechnung“), server/src/db/CLAUDE.md (Löschverhalten, Dateispalte),
server/src/ai/CLAUDE.md (Belegart), docs/funktionsweise.md, Lexikon „Hausgeldabrechnung“ (anpassen), Anleitung für
die Eigentumswohnung in `shared/guides.ts`.
