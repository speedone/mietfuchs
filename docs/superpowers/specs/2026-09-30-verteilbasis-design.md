# Teil 3a: Verteilbasis erweitern (#94)

Teil von #91. Hier steht der Kern von #94: Berechnung, Datenmodell und die Seite Kosten. Die
KI-Belegarten für Hausgeld- und Messdienst-Abrechnungen und die Voreinstellungen je Objektart
kommen als 3b.

## Ziel

Drei gelebte Fälle, die das heutige Modell nicht fasst, weil die Verteilbasis einer
Kostenposition immer aus allen Wohnungen des Objekts entsteht:

1. **Nur ein Teil der Wohnungen nimmt teil**: der Aufzug nur für Haus A, die Waschküche nur für
   ihre Nutzer, ein Garten nur für das Erdgeschoss.
2. **Vermietete Eigentumswohnung**: Die Kosten verteilt die Gemeinschaft nach ihrem Schlüssel,
   meist Miteigentumsanteile (§ 556a Abs. 3 BGB). Mietfuchs kennt davon nur die eigene Wohnung.
3. **Einzelbeträge vom Messdienst** (Techem, ista, Brunata, Minol), dazu Heiz- und Wasserkosten,
   die eine Hausgeldabrechnung schon je Wohnung ausweist, und ein Versorger, der je Zähler
   abrechnet.

## Die Zusage aus #91

**Wer das nicht braucht, merkt nichts.** Neue Angaben sind optional, und ohne sie rechnet jede
Position wie bisher. Die Golden-Tests bleiben centgenau grün. Die neuen Schlüssel und Felder
erscheinen in der Oberfläche nur, wenn man sie wählt.

## 1. Teilnehmer je Kostenposition

- Neues Feld `CostItem.participantUnitIds?: string[] | null`. `null` oder fehlend heißt „alle
  Wohnungen des Objekts“, wie heute.
- Wirkt für die Schlüssel Fläche, Einheiten, Personen und Verbrauch: Die Verteilbasis besteht
  nur aus den Teilnehmern.
  - Das gilt für vermietete und selbstgenutzte Wohnungen gleichermaßen. Eine selbstgenutzte
    Wohnung, die nicht teilnimmt, trägt auch keinen Eigenanteil.
  - Beim Verbrauch zählen nur die Wohnungszähler der Teilnehmer.
- Bei Direktzuordnung und vereinbarten Anteilen ist die Auswahl ohnehin je Wohnung und wird
  nicht angeboten.
- Eine leere Teilnehmerliste ist ein Datenmangel: Der Betrag geht an den Vermieter, mit Warnung,
  wie bei fehlender Basis.
- Die Zeile auf der Abrechnung bleibt, wie sie ist. Der `basisText` nennt die Basis der
  Teilnehmer („80 von 200 m²“), und das ist die Auskunft, die der Mieter braucht.
- **Datenbank**: Tabelle `cost_item_participants (cost_item_id, unit_id)`, beide Fremdschlüssel
  `ON DELETE CASCADE`, zusammengesetzter Primärschlüssel. Dasselbe Muster wie
  `cost_item_shares`. Wird eine Teilnehmerwohnung gelöscht, fällt sie heraus; wird die letzte
  gelöscht, greift die Warnung „keine Teilnehmer“.
- **Grenze der Objekte**: Teilnehmer müssen im Objekt der Position liegen (`guardCostItem`,
  `crossPropertyViolations`).

## 2. Schlüssel „laut Gemeinschaftsabrechnung“ (`external`)

**Die Kostenposition trägt den eigenen Anteil**, also den Betrag, den der Vermieter laut
Hausgeldabrechnung für seine Wohnung zahlt, und nicht die Summe der Anlage. Nur so stimmen
Vermieteranteil und Werbungskosten: Stünden dort die 50.000 € der WEG, liefen 49.380 € als
„Vermieteranteil“ in die Abrechnung und in die Steuerübersicht, obwohl der Vermieter sie nie
gezahlt hat.

Die Angaben der Gemeinschaft stehen **daneben**, für den Rechenweg auf der Abrechnung (BGH VIII
ZR 93/15: Gesamtkosten, Schlüssel, Anteil) und zur Plausibilitätsprüfung:

- `CostItem.externalBasis?: { measure: 'mea' | 'area' | 'units', total: number, totalCents: number } | null`
  - `measure`: Maßstab der Gemeinschaft, also Miteigentumsanteile, Fläche oder Einheiten.
  - `total`: Summe des Maßstabs in der Anlage, z. B. 10.000 MEA oder 1.240 m².
  - `totalCents`: Gesamtkosten dieser Kostenart in der Anlage.
- Neues Feld an der Wohnung: `Unit.mea?: number`, ihre Miteigentumsanteile. Dieselbe Angabe
  führen objego und WISO an der Einheit.

**Verteilt wird innerhalb des Objekts** nach dem Wert jeder beteiligten Wohnung im Maßstab:
`mea`, `areaM2` oder 1.

- Mieteranteil = Betrag × Wert der Wohnung ÷ Summe der Werte der beteiligten Wohnungen ×
  Tagesanteil.
- Bei einer einzelnen ETW ist das der ganze Betrag, tagesanteilig. Leerstand und
  Eigennutzung trägt der Vermieter, wie bei jedem Schlüssel.
- Teilnehmer (Punkt 1) wirken auch hier.
- Der `basisText` auf der Abrechnung lautet:
  `124 von 10.000 MEA · Gesamtkosten der Anlage 50.000,00 €`, bei Teiljahr mit `· 200/365 Tage`.

**Plausibilität**: Weicht der Betrag um mehr als 1 € vom rechnerischen Anteil ab
(`totalCents × Summe der eigenen Werte ÷ total`), gibt es eine Warnung mit beiden Zahlen. Verteilt
wird trotzdem der eingetragene Betrag, denn er ist der gezahlte. Ein Tippfehler in der
Gesamtsumme soll auffallen, aber keine Zahl verschieben.

**Fehlende Angaben**:
- Ohne `externalBasis`, mit `total ≤ 0` oder ohne Wert der beteiligten Wohnungen (keine MEA
  eingetragen) geht der Betrag an den Vermieter, mit Warnung.
- Eine einzelne Wohnung ohne MEA zwischen anderen mit MEA wird wie beim Flächenschlüssel
  gemeldet.

## 3. Schlüssel „Einzelbeträge je Mietverhältnis“ (`amounts`)

- `CostItem.tenancyAmounts?: Record<tenancyId, cents> | null`: der vom Messdienst ausgewiesene
  Betrag je Nutzer.
- **Je Mietverhältnis und nicht je Wohnung**, weil der Messdienst beim Nutzerwechsel selbst
  aufteilt (Zwischenablesung). Tagesanteilig gerechnet wird hier nicht.
- Der Anteil eines Mietverhältnisses ist genau sein Betrag. `largestRemainder` entfällt, denn
  nichts wird aufgeteilt.
- Der Vermieter trägt Gesamtbetrag − Summe der Einzelbeträge: Leerstand, Eigennutzung und
  Rundung des Messdienstes.
- Der `basisText` lautet „Einzelabrechnung“, bei `vendor` „laut Einzelabrechnung Techem“.

**Warnungen** (nie still):
- **Die Summe der Beträge übersteigt den Gesamtbetrag**: Dann wird nichts verteilt, der Betrag
  geht an den Vermieter. Mehr zu verteilen, als die Rechnung hergibt, ergäbe einen negativen
  Vermieteranteil.
- **Ein Mietverhältnis bestand im Jahr, hat aber keinen Betrag**: Warnung mit Namen, denn
  sonst zahlt dieser Mieter nichts.
- **Ein Betrag gehört zu einem Mietverhältnis, das es nicht gibt, das nicht im Jahr lag oder in
  einer nicht beteiligten Wohnung ist**: Der Betrag entfällt und geht an den Vermieter, mit
  Warnung.
- **Ein negativer Betrag**: wird abgelehnt, von der Datenbank per `CHECK`.

**Datenbank**: Tabelle `cost_item_amounts (cost_item_id, tenancy_id, amount_cents)`, beide
Fremdschlüssel `ON DELETE CASCADE`. Ein gelöschtes Mietverhältnis nimmt seinen Betrag mit, und
der Rest fällt dem Vermieter zu, wie bei jedem verschwundenen Verteilziel.

**§ 35a**: bleibt vorerst beim bestehenden Verfahren (Lohnanteil × Mieteranteil ÷ Betrag). Den
Lohnanteil je Nutzer aus der Messdienst-Abrechnung zu übernehmen, gehört zu 3b.

## Grenze der Objekte

- Die Teilnehmer müssen Wohnungen des Objekts sein.
- Die Mietverhältnisse der Einzelbeträge müssen in Wohnungen des Objekts liegen.
- Beides prüfen `guardCostItem` und `crossPropertyViolations`.

## Berechnung

`computeSettlement` bekommt die Verteilbasis **je Position** statt einmal je Abrechnung.

- **Ohne Teilnehmer ist sie genau die heutige.** Die bisherigen Werte werden weiter einmal
  berechnet und für jede Position ohne Teilnehmer wiederverwendet. So kann die Umstellung keine
  Zahl verschieben, und die Golden-Tests und die drei Invarianten bleiben der Beweis.
- **Die Invarianten wachsen**: Der Zufallsgenerator erzeugt auch Teilnehmer, `external` und
  `amounts`, und „Mieteranteile + Vermieteranteil = Gesamtkosten“ sowie „kein negativer
  Anteil“ müssen weiter gelten.

## Datenmodell und Migration

- **Schema**:
  - `units.mea` (real, ≥ 0)
  - `cost_items.external_measure` mit CHECK-Liste
  - `cost_items.external_total` (> 0)
  - `cost_items.external_total_cents` (ohne Vorzeichenbedingung, eine Gutschrift ist möglich)
  - die beiden neuen Tabellen
  - `COST_KEYS` um `external` und `amounts`
- Die geänderte CHECK-Liste der Schlüssel verlangt einen Neubau von `cost_items`. drizzle-kit
  erzeugt ihn als Schritt 0003. **Es gibt keinen Datenanteil**, denn alle neuen Felder sind
  optional.
- **Der eingefrorene Eingang bleibt unberührt.** Eine alte `db.json` kennt die neuen Schlüssel
  nicht, und der Validator nimmt `COST_KEYS` von schema.ts. Eine alte Datei mit einem
  unbekannten Schlüssel bleibt also abgelehnt, wie heute.
- **Typen**: `shared/types.ts` bekommt `CostKey` um `'external' | 'amounts'`, `ExternalBasis`,
  die drei optionalen Felder an `CostItem` und `mea` an `Unit`. Die Legacy-Typen der `db.json`
  bleiben, wie sie sind.

## Oberfläche (Seite Kosten)

Die Entscheidungslogik steht in `costForm.ts`, die Seite rendert nur.

- **Schlüssel „laut Gemeinschaftsabrechnung“**:
  - Maßstab (MEA, Fläche, Einheiten)
  - Summe in der Anlage
  - Gesamtkosten in der Anlage
  - darunter der rechnerische Anteil zum Vergleich mit dem Betrag
  - Die MEA einer Wohnung werden in den Stammdaten eingetragen, als neues Feld im
    Wohnungsformular unter den erweiterten Angaben.
- **Schlüssel „Einzelbeträge je Mietverhältnis“**:
  - Je Mietverhältnis des Jahres im Objekt ein Betragsfeld.
  - Darunter „Summe der Einzelbeträge“ und „davon trägt der Vermieter“.
  - Ist die Summe größer als der Gesamtbetrag, erscheint der Fehler schon im Formular.
- **Teilnehmer**: hinter „Weitere Optionen“ eine Liste der Wohnungen mit Haken, voreingestellt
  alle. Sind alle angehakt, wird `null` gespeichert, damit „alle“ auch neue Wohnungen umfasst.
  Nur bei Fläche, Einheiten, Personen, Verbrauch und laut Gemeinschaftsabrechnung.
- **Auswahlfelder** kommen weiter aus `costKeyOptions` (siehe CLAUDE.md, Kosten.test.tsx). Die
  beiden neuen Schlüssel werden immer angeboten.

## Tests

- **calc.test.ts**, je Punkt:
  - Beispielfälle mit Handrechnung.
  - Warnungen einzeln.
  - Ohne neue Angaben dasselbe Ergebnis wie vorher, belegt durch die Golden-Tests.
  - Die Invarianten mit dem erweiterten Generator.
- **db-repository.test.ts**:
  - Teilnehmer und Einzelbeträge werden geschrieben, gelesen und verschmolzen, wie
    `customShares`.
  - Kaskade beim Löschen einer Wohnung bzw. eines Mietverhältnisses.
  - Grenze der Objekte.
- **schema.test.ts, db-stock.test.ts** („jede Spalte belegt“) und **migrations.test.ts**:
  Marke 0003.
- **Client**: `costForm.test.ts` für die neuen Felder und die Summenprüfung, `unitForm` für
  `mea`.
- **Außen**: Smoke-Test und Praxislauf unverändert grün.
