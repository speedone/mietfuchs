# Bezugszähler und verteilter Rest (#98, Grundlage für #573)

Stand: Entwurf vom 04.11.2026, nicht freigegeben. Teil von #91. Nach einer Gegenprüfung aus Sicht der Umsetzung
umgeschnitten: Statt gespeicherter Rechenzähler („virtueller Zähler“ als Formel) braucht jeder bekannte Fall dasselbe,
nämlich einen **Bezugszähler** und die Verteilung des **Rests** nach einem zweiten Schlüssel.

## Ziel

Eine Kostenposition nach Verbrauch soll den Verbrauch, den die Zähler der Verteilbasis nicht messen, nach Fläche,
Personentagen oder Einheiten verteilen können, statt ihn immer dem Vermieter zu geben oder den Hauptzähler zur Basis
zu machen (#116). Dazu lassen sich **Zwischenzähler ohne Wohnung** (Garten, Waschküche, Garage, Bauwasser) vom
Bezugszähler abziehen und einem eigenen Empfänger geben. Rest = Bezugszähler minus Zähler der Verteilbasis minus
Zwischenzähler.

### Fälle

Zusammengetragen aus Rechtsprechung, Fachpresse, Merkblättern von Versorgern und öffentlichen Handbüchern und Foren
anderer Programme (Recherche vom 04.11.2026). Kein verbreitetes Programm für private Vermieter bildet das öffentlich
belegt vollständig ab: Meist wird der Hauptzähler nur erfasst oder die Differenz von Hand umgebucht.

| Fall | Bezugszähler | Zwischenzähler ohne Wohnung | Rest geht an | Beleg |
| --- | --- | --- | --- | --- |
| Messdifferenz Wasser, alle Wohnungen gemessen | Hauptwasserzähler | | im Verhältnis der Zähler (wie heute still), wahlweise nach Fläche oder Personen; über 20 % Warnung | LG Braunschweig 6 S 163/98; Fachpresse |
| Gewerbe im Haus, Wohnungen ohne Zähler | Hauptzähler | (Gewerbe hat einen Wohnungszähler) | die Wohnungen, nach Fläche | BGH VIII ZR 69/09 |
| Einliegerwohnung des Vermieters ohne Zähler | Hauptzähler | | Eigenanteil (heute #116, unverändert) | #116 |
| Gartenwasser | Hauptwasserzähler | Gartenzähler: an Gartenpflege-Nutzer nach Fläche, an den Vermieter, oder beim Abwasser **gar nicht** (der Versorger zieht ihn dort schon ab) | wie oben | Fachpresse; Merkblätter der Versorger |
| Waschküche, Gemeinschaftsraum, Sauna, Pool | Haupt- oder Allgemeinzähler | an die Nutzer, nach Einheiten oder Personen | alle, nach Fläche | Herleitung |
| Allgemeinstrom mit Garage oder Waschküche | Allgemeinstromzähler | Garage an den Mieter des Stellplatzes, Waschküche an die Nutzer | alle, nach Fläche | Foren anderer Programme |
| Bauwasser, Leerstandsrenovierung | Hauptzähler | an den Vermieter | wie oben | Herleitung |
| Leck oder Zapfstelle ohne Zähler | Hauptzähler | | im Rest, über 20 % Warnung | Merkblatt eines Versorgers |
| WG mit Zimmerzählern (#573) | Zähler der WG-Wohnung | | die Zimmer, nach Fläche oder Personen | Herleitung |

Die Differenz zum Hauptzähler zu bilden ist zulässig, ein Zähler je Wohnung ist nicht nötig (BGH, Urteil vom
25.11.2009, VIII ZR 69/09; vor der Umsetzung im Volltext nachlesen, bisher nur aus zweiter Hand).

Nicht hier: Wallbox mit eigenem Zähler (Zähler an der Einheit des Stellplatzes, geht heute), Betriebs- und
Wärmepumpenstrom (Heizung), Photovoltaik und Mieterstrom (Lieferung, keine Betriebskosten).

**Wer nichts einstellt, merkt nichts.** Ohne die neue Angabe rechnet alles wie bisher, die Golden-Tests bleiben
centgenau grün.

## Nicht-Ziele

- **Kein gespeicherter Rechenzähler mit Formel** in dieser Fassung. Kein bekannter Fall braucht ihn, sobald es den
  Bezugszähler gibt. Kommt ein Fall dazu, der ihn braucht, wird er eigens entworfen.
- **Zwischenzähler der Heizung**: Der Betriebsstrom läuft weiter über die Karte „Betriebsstrom“ (Abzug beim
  Allgemeinstrom, Steuer #267, #268). Ein Zwischenzähler einer Heizanlage ist hier kein Zwischenzähler.
- **Eine Rechnung auf mehrere Kostenarten** zerlegen (Gartenwasser als Gartenpflege statt Wasser): gehört zur
  Vorverteilung (#95). Hier bleibt der Teil in der Position und ihrer Kostenart.
- **Kein Anteilszähler** („x % eines anderen“): Er wiese einen Verbrauch aus, der nie gemessen wurde. Eine WG ohne
  Zimmerzähler löst #573 mit der Gliederung von Wohnung und Zimmern.
- **Sparten**: nur `kaltwasser`, `strom`, `sonstig`. `warmwasser`, `waerme` und `hkv` fließen in die eigene
  Heizkostenabrechnung, den CO₂-Anteil und deren Deckungsprüfung (hca.ts, co2.ts, heatingSelf.ts) und bleiben außen
  vor. Beim Kaltwasser zählen Warmwasserzähler wie heute mit (`measures`).

## Anti-Ziele

- Gemessene Mieter zahlen über den Rest den Verbrauch ungemessener mit (der Fehler aus #116).
- Ein Rest wird zweimal gezählt oder still auf 0 gesetzt.
- Der Rest-Cent entsteht zweimal, weil Rest und Verbrauch getrennt gerundet werden (#202).

## Datenmodell

`CostItem.meterRest?: MeterRest | null`, nur beim Schlüssel `meter`, fehlend heißt wie bisher.

```ts
type RestKey = 'area' | 'persons' | 'units'
type LandlordTarget = 'landlord' | 'selfUse' // abziehbar bzw. Eigenanteil (privat)
type MeterRest = {
  referenceMeterId: string | null // null: der Hauptzähler der Sparte (`unitId: null`, `scope: 'property'`)
  behindMeterIds: string[] | null // Zähler von Einheiten hinter dem Bezugszähler; null nur beim Hauptzähler (s. u.)
  key: RestKey | 'meter' | LandlordTarget // 'meter': im Verhältnis der Zähler, nur bei ganz gemessener Gruppe
  unitIds: string[] | null        // Empfänger des Rests; null: die Verteilbasis der Position
  subMeters: {                    // Zwischenzähler ohne Wohnung (`scope: 'common'`), hinter dem Bezugszähler
    meterId: string
    target: LandlordTarget | 'excluded' | { key: RestKey | 'direct'; unitIds: string[] }
  }[]
}
```

- **Hinter dem Bezugszähler** hängen genau die Zähler aus `behindMeterIds` und `subMeters`; nur sie werden abgezogen.
  - Beim Hauptzähler (`referenceMeterId: null`) heißt `behindMeterIds: null`: alle Zähler von Einheiten des Objekts in
    dieser Sparte (samt `measures`), also wie heute, auch die von Einheiten außerhalb der Abrechnungseinheit.
  - Bei jedem anderen Bezugszähler ist die Liste Pflicht. Die Oberfläche belegt sie mit den Zählern der Verteilbasis
    vor. Grund: Ein Allgemeinstromzähler misst die Wohnungsstromzähler der Mieter nicht; sie abzuziehen ergäbe einen
    zu kleinen oder negativen Rest.
- `'landlord'`: Vermieter trägt, abziehbar (Bauwasser, Leerstandsrenovierung); Grund wie heute der Rest des
  Hauptzählers. `'selfUse'`: Eigenanteil, privat (Garten des Vermieters); Grund `selfUse`, damit Steuer und Zerlegung
  (#142) ihn richtig sehen. `'excluded'`: zählt in dieser Position gar nicht (Gartenwasser beim Abwasser); die Basis
  ist dann Bezugszähler minus dieser Zähler.
- Die Voreinstellung beim Einschalten ist Hauptzähler, `behindMeterIds: null`, `key: 'meter'`, keine
  Zwischenzähler. Ohne Teilnehmer und bei ganz gemessener Gruppe ist das die heutige Rechnung, ausdrücklich gemacht;
  ein Orakeltest hält das centgenau fest.
- Tabelle `cost_item_meter_rest` (eine Zeile je Position, CASCADE) mit Untertabellen für `behindMeterIds` und
  `subMeters`, Migration, Validator, Backup und Wiederherstellen mit dem Schnappschuss der Datenbank. Den Umstieg
  berührt es nicht (die db.json kennt das nicht).
- **Was ein Zähler ohne Wohnung misst**, wird ausdrücklich: `Meter.scope?: 'property' | 'common'`, nur bei
  `unitId: null`, fehlend `property` (das bisherige Verhalten). Heute ist jeder Zähler ohne Wohnung ein Hauptzähler
  (`mainOfType`). Ein Zähler, der nur einen Teil des Hauses misst (der Zähler einer WG-Wohnung, deren Zimmer als
  eigene Einheiten angelegt sind, ein Allgemeinstromzähler), wirkte sonst als Hauptzähler in jede Position derselben
  Sparte. `common` zählt nie als Hauptzähler und nie in eine Basis, nur als Bezugszähler oder Zwischenzähler.
- Bezugszähler: im selben Objekt, passende Sparte, nicht Teil einer Heizanlage, nicht in `behindMeterIds` oder
  `subMeters`, kein Zähler zweimal. Mit der Gliederung aus #573 gehört der WG-Zähler der Wohnung, deren Zimmer die
  Verteilbasis bilden. Kein Verweis über Objektgrenzen (`guardUnit`, `sameProperty`, `crossPropertyViolations`). Wird
  ein Zähler gelöscht, auf den eine Position verweist: 409 mit Satz, welche Positionen ihn nutzen.
- `unitIds` und jede Zielgruppe eines Zwischenzählers müssen Teilmenge der Verteilbasis sein (`participantUnitIds`,
  sonst alle), sonst 400.

## Rechnung

Alles in der Verbrauchsverteilung (`consumptionFor` und Zweig `meter` in calc.ts), der Rest als eigene reine
Funktion mit eigenen Tests, denn #573 braucht denselben Baustein.

1. **Gemessen oder nicht**, je Einheit der Rest-Gruppe wie heute für die Sparte (`perUnit` zählt nur Zähler genau
   dieser Sparte, `coveredDays` über 0, `noConnection`, bewohnt). Eine Einheit mit lückenhaftem Zähler (`partial`)
   gilt als gemessen, wie heute; ihre Lücke steckt im Rest, der Hinweis `meter.unit-partial` bleibt. Beim Kaltwasser
   ist eine Einheit, die nur einen Warmwasserzähler hat, ungemessen, wie heute.
   - Die Gruppe ist **entweder ganz gemessen oder ganz ungemessen**. Gemischt: `meter.rest-mixed` (`error`), Position
     wird nicht verteilt.
   - Ungemessene bewohnte Einheiten **außerhalb** der Rest-Gruppe, die hinter dem Bezugszähler liegen: ihr Verbrauch
     steckt im Rest und lässt sich nicht trennen. Ebenfalls `meter.rest-mixed` mit eigenem Satz.
   - `key: 'meter'` setzt eine ganz gemessene Gruppe voraus, sonst `meter.rest-mixed`.
2. **Abzug**: Rest = Verbrauch des Bezugszählers im Zeitraum minus Summe der Zähler hinter ihm (`behindMeterIds`)
   minus Summe der Zwischenzähler.
   - **Zähler hinter dem Bezugszähler, deren Einheit nicht zur Verteilbasis gehört** (Nicht-Teilnehmer, Einheiten
     außerhalb der Abrechnungseinheit): Ihr Verbrauch geht an den Vermieter, Grund außerhalb (`outsideRaw`), wie
     heute bei Einheiten außerhalb. Er fällt nie in den Rest der Gruppe.
   - Jeder Zwischenzähler geht mit seinem Verbrauch an sein Ziel oder fällt aus der Basis (`excluded`). Ein
     Zwischenzähler, der den Zeitraum nicht deckt: `meter.sub-incomplete` (`error`), kein stiller Teilverbrauch.
3. **Wenn sich der Rest nicht bilden lässt** (Bezugszähler deckt den Zeitraum nicht, `meter.main-partial`; Rest
   kleiner als 0, `meter.sub-exceeds-main`):
   - ganz gemessene Gruppe: Rückfall wie heute, verteilt nach den Zählern der Einheiten, mit Hinweis, dass der Rest
     nicht verteilt wurde;
   - ganz ungemessene Gruppe: Position wird nicht verteilt (`meter.rest-unavailable`, `error`). Ein Rückfall ließe
     hier die gemessenen Einheiten (das Gewerbe) die ganze Rechnung tragen.
4. **Gewichte**: Einheit e bekommt eigenen Verbrauch + Rest × Anteil von e am Rest-Schlüssel innerhalb der Gruppe +
   für jeden Zwischenzähler mit Gruppe dessen Verbrauch × Anteil von e an seinem Schlüssel. Der Anteil kommt aus
   derselben Rechnung wie beim gewählten Schlüssel (`basisOf`): Fläche und Einheiten je Abschnitt bei Nutzungswechsel
   (`segmentsOf`), Personen personentagesgenau mit Leerstand (`VACANCY_PERSONS`), Eigennutzung als Eigenanteil,
   außerhalb an den Vermieter. **Jeder Teil verhält sich in jeder Hinsicht wie eine Position mit seinem Schlüssel**,
   nur ohne eigene Rundung. Bei `key: 'meter'` ist der Anteil der eigene Verbrauch in der Summe der Gruppe.
5. **Eine Verteilung** mit `distributeCents` über alle Empfänger samt Vermieterzeilen (`landlordRecipients`); die
   Gründe (Leerstand, Eigennutzung, außerhalb, Vermieter, Eigenanteil) gehen in die vorhandenen Zeilen, damit Steuer
   und Zerlegung (#142) sie wie beim gewählten Schlüssel sehen.
6. **Mieterwechsel**: Der Rest wird über den Zeitraum gebildet und nach dem Schlüssel auf Tage verteilt;
   Zwischenablesungen des Bezugszählers sind nicht nötig. Die Zähler der Einheiten bleiben bei Mieterwechsel wie
   heute.
7. **Ohne `meterRest`** bleibt die heutige Rechnung samt `mainMeterRest` Zahl für Zahl.

## Bestehende Logik

Leitsatz: Ein Bestand, der vorher richtig rechnete, ändert sich nicht, auch keine offene Abrechnung. Zusammengeführt
wird nur, was dieselbe Rechnung ist.

- **Umgestellt: der Rest des Hauptzählers nach #116** (`mainMeterRest`, Eigenanteil bei nur selbstgenutzten
  Einheiten ohne Zähler). Er ist der neue Baustein mit fester Wahl „Rest beim Vermieter bzw. Eigenanteil“ und läuft
  im ersten PR über dieselbe Funktion, als reiner Umbau: Golden-Tests und Invarianten centgenau unverändert, sonst
  bleibt er, wie er ist.
- **Nicht umgestellt:**
  - Heizung (Grund- und Verbrauchskosten, Warmwasser nach Formel, Gradtage, CO₂-Anteil): eigene Regeln der
    Heizkostenverordnung (docs/heizung.md). Eine Änderung am Rest darf die Heizkostenabrechnung nie berühren.
  - Betriebsstrom der Heizung (Abzug beim Allgemeinstrom): Aufteilen einer Rechnung, daran hängen Steuer (#267, #268)
    und die Meldung an den Messdienst; gehört, wenn überhaupt, zur Vorverteilung (#95).
  - Leerstand beim Personenschlüssel, vereinbarte Anteile unter 100 %, „nicht vereinbart“ (#258): eigene Gründe
    beim Vermieter, keine Reste eines Zählers; der neue Rest nutzt sie nur mit.

## Recht und Hinweise

- **Messdifferenz** (Gruppe ganz gemessen): keine gesetzliche Grenze; über 20 % ist die Umlage nach
  Instanzrechtsprechung gefährdet (LG Braunschweig, 6 S 163/98; AG Mitte, 20 C 394/06). Neuer Code `meter.rest-high`
  (`warning`) mit Betrag je Mieter, Schwelle ins Rechtsregister (`checkOnly`). Bei einer ganz ungemessenen Gruppe ist
  der Rest kein Messfehler, dort keine Schwelle.
- **Eichung**: Die vorhandene Prüfung (`meter.calibration-overdue`) gilt auch für den Bezugszähler (BGH VIII ZR 112/10).
- **Rechenweg** (`steps`): Bezugszähler mit Anfangs- und Endstand, Summe der Zähler, Rest, zweiter Schlüssel mit
  Anteil. Formell nicht nötig (BGH VIII ZR 93/15), aber erläuterungspflichtig, wenn bestritten (VIII ZR 27/07); ob
  § 33 Abs. 3 MessEG für Betriebskostenabrechnungen gilt, ist nicht entschieden. Vor der Umsetzung den Wortlaut von
  § 33 MessEG nachlesen.
- **Wasser nach Fläche trotz Zählern**: Wer statt des Rests die ganze Position nach Fläche verteilt, obwohl alle
  Zähler haben, bekommt den Hinweis aus #98 (BGH VIII ZR 188/07, § 556a Abs. 1 Satz 2 BGB); eigener Punkt, nicht hier.
- Lexikon: „Allgemeinverbrauch“, „Bezugszähler“; Verweis aus „Hauptzähler“.

## Oberfläche

- Kostenformular beim Schlüssel „nach Verbrauch“: „Verbrauch ohne eigenen Zähler“ mit „tragen Sie“ (vorbelegt, wie
  bisher) oder „verteilen nach Fläche, Personen oder Einheiten“, dann Bezugszähler (vorbelegt der Hauptzähler der
  Sparte) und wahlweise „nur auf bestimmte Wohnungen“.
- Logik in costForm.ts, Auswahl über `costKeyOptions`/`meterTypeOptions`, jsdom-Test: angezeigter Wert gleich
  gespeichertem.

## Tests

- **Golden**: Bestände ohne `meterRest`, centgenau unverändert.
- **Orakel**: Rest nach Fläche ergibt dieselben Anteile wie zwei Positionen (Verbrauch nach Zählern plus Rest nach
  Fläche), bis auf die Rundung, die hier einmal geschieht.
- **Invarianten** (fester Startwert): Mieteranteile + Vermieteranteil = Gesamtkosten, keine negativen Anteile; mit
  zufälligem Leerstand, Eigennutzung, Nutzungswechsel und Teilnehmern.
- Fehlerfälle: gemischte Gruppe, ungemessene Einheit außerhalb der Gruppe, Bezugszähler kurz und Rest negativ je
  bei gemessener und ungemessener Gruppe, Zwischenzähler kurz, `key: 'meter'` bei ungemessener Gruppe, Zähler im
  anderen Objekt, Löschen eines verwiesenen Zählers, Gruppe außerhalb der Teilnehmer, Bezugszähler ohne Liste
  `behindMeterIds`.
- Teilnehmer mit Hauptzähler als Bezug: Verbrauch der Nicht-Teilnehmer landet beim Vermieter, nie bei der Gruppe.
- Allgemeinstrom: Wohnungsstromzähler der Mieter werden nicht abgezogen (nicht in `behindMeterIds`).
- Steuer: Zwischenzähler `selfUse` erscheint als privater Anteil, `landlord` als abziehbar.
- Neue Codes in `noticeKinds`: `meter.rest-mixed`, `meter.rest-unavailable`, `meter.sub-incomplete` (je `error`),
  `meter.rest-high` (`warning`).

## Zuschnitt

1. Datenmodell, Rechnung, Hinweise, Invarianten.
2. Kostenformular und Lexikon.

Danach #573 (Gliederung von Wohnung und Zimmern) auf dem Baustein aus Rechnung, Schritt 3 und 4.

## Dem Umsetzenden überlassen

- Name und genaue Form von `meterRest`, Name der Tabelle.
- Wortlaut der Hinweise, im Stil der vorhandenen (gesiezt, mit Betrag, ohne Geviertstrich).
