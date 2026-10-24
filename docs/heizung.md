# Heizung: Entwicklerdoku

Wer an der Heizung arbeitet (Heizanlage, Heizperiode, CO₂, Lieferungen, Vorrat, eigene
Heizkostenabrechnung, § 6a, § 9a, Betriebsstrom), liest diese Datei zuerst. Gesamtentwurf:
`docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (Verweise wie „15.1 Nr. 2“ oder
„G-A2“ meinen Abschnitte dort). Rechtswerte stehen im Rechtsregister (server/src/CLAUDE.md).

**Grundsätze**: Eine Anlage ändert für sich keine Zahl; was Mietfuchs nicht rechnen kann, lehnt der
Server mit Satz ab (`HeatingError`, 400). Heizregeln gelten nur für die Kostenart **„Heizung und
Warmwasser“** (`HEATING_CATEGORY`), nicht für „Heizung“. Abgeschlossenes bleibt, wie es zugestellt
wurde: Jede Angabe, die rückwirkend eine abgeschlossene Heizperiode änderte, steht je Heizperiode
oder in Spannen und nie zeitlos an der Anlage. Jede Vorschau eines Wechsels trägt eine Marke
(`token`); ohne passende Marke 409 mit neuer Vorschau. Geraten wird nie: Was nicht verteilbar ist,
wird Fehler an der Anlage, und die Positionen gehen an den Vermieter.

## Heizanlage

[server/src/db/heating.ts](../server/src/db/heating.ts) (Anlegen, Ändern, Entfernen); Prüfungen an
Zählern und Positionen in repository.ts (heating.ts importiert von dort, nie umgekehrt). Tabellen
`heating_plants`, `heating_plant_units`, `heating_periods` (eine Zeile je Heizperiode mit Angaben).

- **Ohne Liste alle Wohnungen, mit Liste genau diese**, entschieden an `units_limited` (sonst
  versorgte eine Anlage nach Löschen ihrer letzten Wohnung plötzlich das ganze Haus). Eine Wohnung
  der Liste wechselt nicht das Objekt (`guardUnit`).
- **Heizpositionen gehören zur Anlage ihres Objekts**: zugeordnet beim Einrichten mit Vorschau
  (`/api/heating-plants/assignable`), danach bekommt eine neue Position ohne `heatingPlantId` eine
  Anlage (`defaultHeatingPlant`, `plantForNewItem`: mit verknüpfter Lieferung deren Anlage, sonst die,
  an der alle genannten Wohnungen hängen und die zu Beginn des Leistungszeitraums heizt). Abgeschlossene
  Zeiträume bekommen keine Anlage. Ohne Anlage trotz Anlagen im Objekt: `co2.fuel-unknown` an der
  Position. Entfernen gibt die Positionen frei; hängen Zähler oder CO₂-Angaben daran, 409.
- **Zähler der Anlage** (`heating_plant_id` mit Rolle, ohne Wohnung) sind **keine Hauptzähler**
  (`houseMeters`). Warmwasserzähler zählen beim Kaltwasser mit, aber nur ein Kaltwasserzähler sagt,
  ob eine Wohnung gemessen ist (`measures`).
- **Fernablesbarkeit** ([remoteReading.ts](../server/src/remoteReading.ts)) nach
  `hkv.remote-reading.new-devices` und `.retrofit`, aus den Zählern oder der Angabe an der Anlage. Ein
  neues Gerät in einem nicht fernablesbaren System kann ein Ersatz nach § 5 Abs. 2 Satz 4 sein; die
  Anlage fragt einzeln/als Ganzes (`new_devices_install`). Sicher → `heating.remote-reading-missing`
  (warning, 3 % je Mieter auf die Heizzeilen), möglich → `heating.remote-reading` („bis zu“).
- **Zweifamilienhaus** (`zfh`) ist nur Beschreibung; § 2 hängt an den Wohnungen
  (`mayAgreeOtherwise`), ein Widerspruch ergibt `property.kind-mismatch`.
- Beim Wiederherstellen: `heatingPlantViolations` (fremde Objekte, überlappende Anlagen, Schlüssel nach
  dem Rhythmus der Anlage, `plantRules`).

## Eigene Heizperiode und getrennte Abrechnung

Regeln in [shared/heatingPeriod.ts](../shared/heatingPeriod.ts). Eine Anlage rechnet im Zeitraum
ihres Objekts (`period_start_month` NULL) oder in eigenen Heizperioden (`period_start_month`,
`heating_period_changes`, berechnet wie die Zeiträume des Objekts).

- **Positionen tragen den Schlüssel ihrer Heizperiode**, sonst 400. Eine neue ohne Angabe kommt in
  die Heizperiode, die in ihrem Objektzeitraum endet. **Den Rhythmus ändert nur der Wechsel mit
  Vorschau** ([db/heatingPeriodChange.ts](../server/src/db/heatingPeriodChange.ts)), nie `PUT`; er
  schlüsselt Positionen um, erfasst Korrekturen neu und lässt Abgeschlossenes unangetastet.
- **Weg b** (VIII ZR 240/07): Eine Heizperiode gehört in die Abrechnung P, in der sie endet. Der
  Schnappschuss trägt sie als `heatingParts`, `computeSettlement` rechnet jede über ihre eigenen Tage
  (`scope: 'heatingPart'`, ohne Vorauszahlungen) und führt sie in P zusammen. Wer nur in der
  Heizperiode wohnte: `heatingOnly`, `recommendedDeadline`, `period.heating-only-statement`.
- **Weg d** (getrennte Heizkostenabrechnung, Auslegung), nur bei H ≠ P: Ob eine Heizperiode getrennt
  abgerechnet wird, sagen die gespeicherten Spannen `heating_separate_spans`, nie die heutige
  Antwort. Ein- und Ausschalten mit Vorschau ([db/separateSettlement.ts](../server/src/db/separateSettlement.ts)).
  P lässt die Heizperiode weg; sie hat eigene Abrechnung (`scope: 'heating'`, `heatingSnapshotFor`),
  Frist und Abschluss (`closed_heating_settlements` samt Verlauf). Bei H = P eine Gesamtabrechnung mit
  getrennt ausgewiesenen Vorauszahlungen.
- **Jeder Monat der Heizstaffel wird genau einmal angerechnet**: Er gehört der getrennt abgerechneten
  Heizperiode, wenn er ab ihrem Beginn liegt, sonst P (`separateOwner`, die einzige Stelle). Die
  Jahreskorrektur von P gilt für alles, was P anrechnet; eine Heizkorrektur
  (`heating_prepayment_overrides`, endgültig oder vorläufig) nur für getrennt abgerechnete
  Heizperioden. Invariante in invariant-heizperiode.test.ts.
- Das Mietkonto führt beide Staffeln; die Steuer nimmt Heizpositionen eigener Heizperioden im Jahr
  ihrer Zahlung, bei Weg d ohne Vorauszahlung der Abrechnung (`prepaymentSettlementCents` null). Ein
  Wechsel des Objektzeitraums lässt Heizpositionen eigener Heizperioden, wo sie sind, und lehnt ab,
  wenn er Weg d umschaltete.
- **Einrichtung Schritt 3** erklärt drei Wege (Heizperiode des Messdienstes in der Gesamtabrechnung,
  Objekt auf den Zeitraum des Messdienstes umstellen, Messdienst auf den 31.12. umstellen); Vorgabe
  ist der erste (VIII ZR 240/07, Leitsatz a). Logik: `heatingWays` in client/src/heatingPeriodForm.ts.

## CO₂ beim Messdienst

Angaben je Heizperiode in `co2_statements`, „vom Vermieter übernommen“ je Mietverhältnis in
`co2_tenant_reliefs`; [db/co2.ts](../server/src/db/co2.ts), [co2.ts](../server/src/co2.ts), CO₂-Block
in `computeSettlement`; die Probe in [shared/co2Probe.ts](../shared/co2Probe.ts) (die Oberfläche
zeigt sie live). Rechtswerte in [shared/law/co2kostaufg.ts](../shared/law/co2kostaufg.ts).

- **Die Methode ist eine Antwort, keine Vorgabe**: `serviceDeducted` (Abzugszeile), `serviceShown`
  (nur ausgewiesen), `selfAfterService` (nicht aufgeteilt); bei freien Schlüsseln `self`.
- **S ist die gedruckte Kostensumme**, nicht die Summe gerundeter Nutzerzeilen. Die Probe läuft über
  die Messdienstpositionen (`amounts`): Vorwegabzug Σ = S + L ± 1 ct, nur ausgewiesen Σ = S, Einzel-
  und Eigenbeträge ≤ S + NE · 2 ct. **Scheitert sie, wird nichts gebucht** (`co2.sum-check`, error);
  mit „Ich finde diese Zeile nicht“ ist S geschätzt (`co2.sum-check-approx`), und scheitert die Probe
  dann, wird ebenso nichts gebucht.
- **Vorwegabzug**: In der Position, in der L steckt (`carrierId`), steht L_self exakt in `selfUse`
  (nie über `take()`), der Rest von L als Grund `co2Share` dahinter; die Mieter zahlen ihre
  Einzelbeträge unverändert (#209: Werbungskosten sind das Bezahlte, L_self privat). Kappt `take()`,
  sagt es `co2.share-capped`.
- **Nur ausgewiesen**: Zeilen `kind: 'co2Relief'` ohne Position (`co2:<Anlage>:<Heizperiode>`), je
  Mieter laut Messdienst oder L · x / S, eine Verteilung von R mit `distributeCents`, der Vermieter
  trägt R als `co2Share`. Σ aller Zeilen bleibt Σ der Positionen.
- **Kürzungen** je Mieter auf seine gedruckten Zeilen im Topf, nie summiert: 3 % nach § 7 Abs. 4
  CO2KostAufG (`co2.missing`, `co2.service-unsplit`, `co2.incomplete`, `co2.sum-check`,
  `co2.fuel-unknown`, `co2.missing-first-year`), 15 % bei Warmwasser nach Formel
  (`heating.dhw-not-metered`). Alle Hinweise eines Topfs nur, wenn jemand eine Zeile daraus hat
  (`settledOn`): Pauschal- und Warmmieter kürzen nichts.
- **Nachstufung**: Der Wert laut Messdienst wird in die Stufentabelle eingeordnet (eine
  Nachkommastelle, kurze Heizperiode mit gekürzten Grenzen, ganzzahlig gedruckt als Spanne), eine
  Abweichung meldet `co2.stage-mismatch`.
- **Töpfe**: je Anlage die Heizpositionen mit dem Schlüssel des Zeitraums; bei eigener Heizperiode
  rechnet die Teilabrechnung bzw. Heizkostenabrechnung den Topf (`mergeHeatingPart`).
- **Ausweis**: `Settlement.heating` je Anlage und Heizperiode mit `Co2Assessment`; der Druckblock
  „CO₂-Kostenaufteilung“ ([client/src/co2View.ts](../client/src/co2View.ts)) wird gedruckt.
- **Oberfläche**: Seite „Heizkosten“, erst ab einer Heizanlage in der Navigation (`navFor`).
- Eine Zeile in `heating_periods` ohne Angaben wird mitentfernt (`dropIfEmpty`), denn der Wechsel des
  Rhythmus sieht jede Zeile als Angabe. Beträge je Mietverhältnis bleiben im Objekt der Anlage
  (`guardTenancyMove`).

## Lieferungen und Abgrenzung

Rechnungen des Versorgers in `fuel_deliveries` (Teilmengen `fuel_delivery_parts`); Positionen zeigen
über `cost_items.fuel_delivery_id` darauf, mehrere je Lieferung. Abgegrenzt in
[fuel.ts](../server/src/fuel.ts) (`plantFuel`), gespeichert in [db/fuel.ts](../server/src/db/fuel.ts);
Gradtage des Orts in `degree_day_values`. CO₂-Merkmale an der Anlage (`non_residential`,
`restriction`, `district_ets_new`).

- **Stufen der Abgrenzung, kein „tagesgenau“**: eingetragener Anteil, Zählerstand (genau ein
  Versorgungszähler, Stände genau an den Grenzen), Zwischenrechnung, Teilmengen, Ortswerte, Tabelle
  `hkv.degree-days` (nur gefragt, wenn die Anlage Lieferungen hat); feste Preisbestandteile nach Tagen.
- **Positionen stehen in der Heizperiode, die das Ende der Rechnung enthält** (`guardFuelLink`), und
  nur bei einer Lieferung ihres Objekts. Der Teil einer anderen Heizperiode ist eine Zeile
  `kind: 'fuelCarry'` (`fuel:<Lieferung>:<Heizperiode>:<andere>:<Position>`) mit dem Schlüssel der
  Position, Gegenzeile beim Vermieter. **Über alle Zeiträume ist jede Rechnung genau einmal verteilt**
  (calc-fuel.test.ts, fuel-invariant.test.ts über die echten Schreibwege, je Lieferung und Paar von
  Heizperioden). Eine Heizperiode ohne eigene Positionen rechnet trotzdem, wenn die Anlage Lieferungen
  hat.
- **Abgeschlossenes bleibt**: Der Abschluss friert je Lieferung und Heizperiode in
  `fuel_carry_frozen` ein, was herein- oder hinausgebucht wurde; das Wiederöffnen gibt es im selben
  Vorgang frei (`unfreezeFuelCarries`). Kommt ein Teil in eine abgeschlossene Heizperiode, trägt ihn
  der Vermieter (`fuelClosedPeriod`) oder er ersetzt eine Schätzung (`fuelEstimateDiff`). Weicht der
  eingefrorene Teil vom heutigen ab, bucht die Heizperiode der Positionen nur den heutigen hinaus
  (`frozenPart`), der Unterschied steht beim Vermieter (`fuel.reduced-after-close`,
  `fuel.closed-period-part`). Gesperrt (409): eingefrorene Lieferungen (außer Bezeichnung und
  Heizwertangaben, `unfrozenAside`), Ablesungen des Versorgungszählers in abgeschlossenen
  Heizperioden (`guardSupplyReading`), und Lösen, Umhängen, Verschieben, Löschen der **letzten**
  Position einer Lieferung mit eingefrorenem Teil ≠ 0.
- **Rückfrage beim Abschluss**: Bei einer Lücke mit Schätzvorschlag 409 mit `fuelGaps`;
  `fuelEstimates: 'estimate' | 'none'` entscheidet, in der Oberfläche ist **Abwarten** die Vorgabe
  (höchstrichterlich nicht entschieden). Rechnen, Schätzen, neu Rechnen, Abschließen und Einfrieren
  laufen in **einer** Transaktion (`closeWithFuel`; deshalb nehmen die Leser in read.ts ein
  `Executor`). Eine Heizposition ohne Lieferung deckt mit ihrem Leistungszeitraum ab, ohne einen
  `fuel.loose-item`. Eine Schätzung zählt, solange keine echte Rechnung ihre Tage abdeckt, teilweise
  abgedeckt nur für die übrigen Tage (`estimatesIn`); Vorschläge nur über 0 €.
- **Rechnung, Storno oder Gutschrift ohne Rechnung entscheidet eine Stelle**: `invoiceStatusOf`
  (Summe der Positionen > 0, = 0, < 0; `notInvoiceDeliveries`). Storno und Gutschrift belegen keinen
  Verbrauch: keine Tage, keine Verdrängung einer Schätzung, keine Vorlage, kein CO₂. **Storno nach
  Abschluss**: nichts gesperrt, Gegenbuchung beim Vermieter, `fuel.cancelled-after-close`; eine echte
  Rechnung über 0 € nennt `fuel.zero-invoice`. **Gutschrift ohne Rechnung** (#251): ihr Geld wird nach
  Anteil verteilt (Auslegung, VIII ZR 156/11; `fuel.credit-only`, bestätigt über
  `credit_note_kind = 'standalone'` nur als Stufe `hint`); `POST /api/fuel-deliveries/:id/reassign-credit`
  hängt sie an die berichtigte Rechnung (409, wenn eine der beiden abgeschlossen ist).
- **Eigene CO₂-Aufteilung**: C bei freien Schlüsseln abgegrenzt, beim Messdienst ohne Aufteilung die
  Rechnungen ganz; E umgerechnet; der Abzug folgt dem Schlüssel des Brennstoffs (`bookReliefs`); § 8,
  § 9 und Emissionshandel nach Stichtag aus dem Register. Nur für Brennstoffe mit Standardwerten
  (§ 2 Abs. 1 CO2KostAufG), bei Fernwärme nur mit ausgewiesenen CO₂-Kosten.
- **Golden-Fälle** in [server/test/fixtures/heating/](../server/test/fixtures/heating): F15
  (Techem-Muster mit Vorwegabzug), F12 (anonymisierte reale Abrechnung Mai bis April; nur Gesamtwerte
  und ein Nutzer echt, so in README und `betraege.json`), F16/F17 (eigene Abrechnung, Heizöl mit Vorrat,
  von Hand nachgerechnet).

## Mehrere Anlagen, Etagenheizung, Kesseltausch

- **Ab zwei Anlagen** braucht jede einen Namen (im Objekt verschieden) und ihre Liste; keine Wohnung
  hängt an zweien, außer innerhalb einer **Linie** von Täuschen (`replaces_plant_id`, `lineRoot`,
  `sameLine`). Geprüft nach jedem Schreiben über alle Anlagen des Objekts in derselben Transaktion
  (`guardPlantsOfProperty`). Das Anlegen nimmt Änderungen bisheriger Anlagen im Rumpf `adjust` mit.
- **Gebäude** (`building_with`): Eine weitere Anlage neben einer laufenden sagt beim Anlegen, ob sie
  im selben Gebäude steht (Kennung) oder in einem eigenen (`'own'`), Pflicht ohne Vorbelegung; die
  erste wird nicht gefragt. Im selben Gebäude stuft die Abrechnung über Ausstoß aller Anlagen und die
  Fläche aller versorgten Wohnungen ein, jede einmal (`partnersOf`, `contributionOf`, `jointAreaOf`;
  `co2.building-joint` als Auslegung; fehlt ein Ausstoß, `co2.classification-incomplete`). Ein Kreis
  der Angaben ist 400 (`buildingCycle`), im Archiv gilt die kleinste Kennung (`buildingRoot`).
  Entfernen einer Anlage, auf die andere zeigen, gibt die Verweise an Nachfolgerin oder Gebäude
  weiter.
- **Position über zwei Anlagen** (`co2.item-spans-plants`, error): gehört zu keinem Topf, wird aber
  nach ihrem Schlüssel verteilt (`itemBasisUnits`); eine Linie zählt als eine Anlage.
- **Etagenheizung auf Vertrag des Vermieters** (`supply = 'perUnit'`): nur freie Schlüssel, kein
  Vorrat; jede Heizposition direkt bei einer Wohnung der Anlage, jede Rechnung mit dieser Wohnung
  (`fuel_deliveries.unit_id`). Zentral oder je Wohnung ist nicht mehr umstellbar, sobald etwas daran
  hängt. Einstufung über Σ kg / Σ Fläche der vermieteten Wohnungen mit Rechnung; Abzug je
  Mietverhältnis r = ‰ · C_u · x_t / A_u **ohne Normierung** (Leerstand, Eigennutzung, Pauschale
  bleiben beim Vermieter); `co2.exceeds-heating` je Wohnung (`perUnitClassification`,
  `perUnitReliefs`). **Grundlage der Umlage ist nicht geklärt** (HeizkostenV gilt nicht, § 2 Nr. 4
  d BetrKV nennt nur Reinigung und Wartung): `heating.per-unit-basis` und Lexikon sagen das. Fernwärme
  ist keine Etagenheizung. Etagenheizungen haben keine Angaben nach § 6a, § 2, § 11.
- **Kesseltausch** (`POST /api/heating-plants/:id/replace`, `replaceHeatingPlant`): alte Anlage
  `ends_on` (letzter Betriebstag), neue `replaces_plant_id`, Name und Wohnungen; Rhythmus,
  Gebäudemerkmale, Betriebsstrom-Angabe und Zeitraum der eigenen Abrechnung werden übernommen. Kein
  Fremdschlüssel (drizzle-kit schreibt beim Hinzufügen kein `ON DELETE`). Lieferungen und Vorrat nur
  in der Betriebszeit (`plantSpanOf`); die Bestandsrechnung endet am letzten Betriebstag mit dem
  **Restbestand** (den Mietern gutgeschrieben, beim Vermieter `stockRemaining`,
  `fuel.stock-remaining`). Teilen alte und neue Anlage eine Heizperiode, wird über beide eingestuft
  (wie im selben Gebäude über `partnersOf`, `co2.plant-replaced`).
  - **Gleicher Vorratsbrennstoff**: „Verheizt der neue Kessel den Brennstoff im Tank weiter?“
    (`takes_over_stock`, Vorbelegung ja, änderbar bis zum ersten Abschluss beidseits). Ja: die Kette
    der neuen beginnt mit der alten, der Restbestand ist ihr Anfangsbestand, ein eigener wird
    abgelehnt. Nein: Restbestand beim Vermieter (`fuel.stock-not-taken-over`). Der Schlüssel der
    Überträge kommt auch von den Positionen der Vorgängerin (`sameFuelLine`, `stockTemplateOfLine`).
  - Eine stillgelegte Anlage rechnet in einem späteren Zeitraum mit, wenn eine Position dort mit ihrer
    Lieferung verknüpft ist (sonst trügen die Mieter die Rechnung zweimal).
  - Gleicher Brennstoff über einen Zähler (Gas, Fernwärme, Strom): 409, kein Tausch nötig. Gesperrt:
    Etagenheizung, Weg d, mitten in oder vor einer abgeschlossenen Heizperiode, mit Angaben der alten
    Anlage für die Zeit danach. Entfernen der neuen macht den Tausch rückgängig; verwaiste Verweise im
    Archiv rückt `straightenHeatingPlants` gerade.

## Eigene Heizkostenabrechnung (`method = 'self'`)

Die reine Rechnung in [server/src/heating.ts](../server/src/heating.ts): Nutzer je Wohnung
(Mietverhältnisse, Leerstand, Eigennutzung), die Ablesung je Grenze (die beim Mieterwechsel erfasste
fest, `readings.interim_for`, sonst die nächste in der Zelle; zwei Werte am selben Tag sind ein
Befund; der eingefrorene Endstand der Vorperiode ist der Anfangsstand; **keine Rückrechnung, keine
Interpolation**), § 9b Abs. 3 als Gruppe über Grenzen ohne Ablesung, daraus **ein Gewicht je Nutzer
und Ziel** (`weightsOf`). calc.ts verteilt Positionen mit `key = 'heatingSystem'` mit diesen
Gewichten durch `distributeCents`. Tests bauen Beispiel A mit `selfSnapshot()`
([server/testing/selfHeating.ts](../server/testing/selfHeating.ts)).

- **Teil und Ziel** an der Position (`heatingPart`, `heatingTarget`); bei verbundenem Warmwasser
  teilt α die Ziele „beides“. Der Anteil nach Verbrauch gilt aus der Heizperiode oder der vorigen
  (`consumptionSharesOf`); § 7 Abs. 1 Satz 2 ist `hkv.consumption-share-forced`; mehr als 70 % nur
  mit `above_70_agreed`, nie über 100 %.
- **Umgestellt wird nur über die Einrichtung** (`PUT /api/heating-plants/:id/self`,
  [db/heatingSelf.ts](../server/src/db/heatingSelf.ts)): Anlage, Anteil, Zähler und Positionen offener
  Zeiträume in einer Transaktion; fehlen Teil und Ziel, 409 mit Liste. Zurück auf „Niemand“ verlangt
  `convertItems: 'area'`. Bei Heizkostenverteilern und Ablesedienst werden keine Wärmezähler angelegt.
- **Zeiträume der eigenen Abrechnung** stehen in `heating_self_spans` (von, bis ausschließlich), mit
  **Erfassung und Warmwasserbereitung** je Spanne (`captureOf`, `hotWaterOf`). Die Einrichtung öffnet
  einen Zeitraum nie vor oder in einer abgeschlossenen Heizperiode; das Zurückschalten schließt ihn
  (lehnt ab, wenn eine abgeschlossene hinter einer offenen läge). Gerechnet wird je Heizperiode
  (`selfActive`, `selfAt`), denn § 6 Abs. 4 erlaubt die Wahl nur für künftige Zeiträume; eine andere
  Erfassung gilt ab dem Beginn einer schon begonnenen Heizperiode (Tatsache, kein Maßstab), der Anteil
  nach Verbrauch bleibt geschützt (`checkShares`). `PUT` an der Anlage ändert Erfassung und Warmwasser
  bei eigener Abrechnung nicht.
- **Der Anteil gehört zur Linie** ([db/selfLine.ts](../server/src/db/selfLine.ts)): Nach einem Tausch
  gilt er weiter, in derselben Heizperiode lehnt `saveDistribution` einen anderen ab. Läuft eine Anlage
  nur einen Teil der Heizperiode, wird die Wärme am Speicher an ihrer Laufzeit abgegrenzt (Stand am
  Tauschtag nötig, sonst `heating.self-incomplete`).
- **Nicht verteilbar** (fehlender Stand, Zähler, Anteil, α) heißt Fehler an der Anlage und alle
  Positionen beim Vermieter. Hinweise zu Ablesungen rechnen nach dem CO₂-Block (ihre Kürzungen stehen
  auf den gedruckten Zeilen); fehlende Zwischenablesungen beantwortet der Vermieter in
  `interim_reading_gaps` („Ablesung verwenden“ / „Nach § 9b Abs. 3“, `usableAt`). Ein Wechsel nur zwischen Rollen des
  Vermieters (Leerstand, Eigennutzung, außerhalb, #259) ist keine Grenze, an der abgelesen werden muss (`tenantChange`
  in heating.ts): kein Befund, keine Frage, kein Eintrag im Ausweis. Ohne Ablesung teilt § 9b Abs. 3 wie bisher, eine nahe
  Ablesung gilt, und eine ferne gilt **von selbst als nicht hinreichend genau** (`landlordFar`, Festlegung): geteilt wird
  nach § 9b Abs. 3, als fehlte sie; vorher sperrte sie als `farInterim` die Verteilung, bis der Vermieter wählte. Eine
  dort gespeicherte Antwort wird nicht mehr gebraucht. Das alles verschiebt nur Geld zwischen den Zeilen des
  Vermieters; die Verbräuche der Mieter begrenzen die Ablesungen an ihren eigenen Grenzen.
- **Wärmepumpe**: Ob die Verordnung gilt, entscheidet `heatPumpVerdict` (§ 12 Abs. 3,
  `hkv.heat-pump.capture`). Vor dem 01.10.2024 fiel eine überwiegend versorgende Wärmepumpe nach § 11
  Abs. 1 Nr. 3 a a. F. nicht darunter (`heat_pump_majority`; „ja“ oder ohne Antwort: Hinweis, keine
  Kürzungen, Heizung und Warmwasser gemeinsam).
- **Vergleich der Teilung beim Wechsel** (#314): Die Gewichte der anderen Teilung nach § 9b Abs. 2 stehen in
  `compare` des Plans in calc.ts, nur zum Vergleich. Bei Gradtagen nennen Rechenweg („Zum Vergleich zeitanteilig“)
  und `heating.change-split-degree-days` (hint, `INFORMATIONAL`) sie nur für Wohnungen mit Leerstand, Eigennutzung,
  einer Zeit außerhalb der Abrechnungseinheit (#259) oder Wechsel ohne Zwischenablesung (eine Gruppe allein wegen einer Schätzung nach § 9a zählt nicht), nie beim Ziel
  Warmwasser (immer nach Tagen) und nicht unter einer Vereinbarung „nach Wohnfläche“; bei zeitanteiliger Teilung
  nennt `heating.change-split-time` wie bisher jeden Wechsel, jetzt mit dem Leerstand. Der Leerstand als
  Nutzerwechsel ist Auslegung (Entwurf 3.5, R-A16); BGH VIII ZR 9/14 ist nur über eine Sekundärquelle gelesen und
  wird nicht zitiert.
- **Maßstab der Grundkosten der Heizung** (`area_basis_heat`, § 7 Abs. 1 Satz 5): Wohnfläche, beheizte Fläche
  oder umbauter Raum (#322). Beheizte Fläche und Rauminhalt stehen in `heating_plant_units` (`heated_area_m2`,
  `volume_m3`, Schritte 0069/0070), nicht an der Wohnung; ein Wert gilt für beide Lesarten (ganzer Raum oder beheizte
  Räume). **Die Zeilen tragen auch ohne Liste Werte** (`units_limited` 0): Dann ist `units` null und die Werte stehen in
  `basisValues`; gelesen wird immer über `unitBasisOf`/`plantUnitValues` (shared/heatingPeriod.ts), und jede Abfrage,
  die aus den Zeilen die Versorgung liest, filtert auf `units_limited` (Durchsicht M1: Eine erzwungene Liste hängte eine
  später angelegte Wohnung still ab). Eingetragen werden die Werte mit `unitValues` in der Einrichtung (`PUT …/self`) und in
  „Heizanlage ändern“ (`PUT /api/heating-plants/:id`); ein Eintrag in `units` ohne Wert behält den gespeicherten.
  Pflicht sind sie nur an Wohnungen mit Fläche (`guardBasisValues`, die Garage zählt nicht, wie `served` in calc.ts);
  fehlt einer Wohnung der Wert (später angelegt, Archiv), meldet `planSelf` `noBasisValue`, und nichts wird verteilt.
  Die Wohnfläche ersetzt eine fehlende beheizte Fläche nicht mehr. Wechselt eine Wohnung das Objekt, entfallen ihre
  Werte an Anlagen ohne Liste. Das Warmwasser bleibt immer bei der Wohnfläche (§ 8 Abs. 1), die CO₂-Einstufung ebenso.
  Beim umbauten Raum rechnen Rechenweg, Ausweis (`SelfPotView.basisUnit`), Druckzeilen und die Grenze des § 9a Abs. 2
  in m³. Eine Vereinbarung nach § 2 „nach Wohnfläche“ verteilt auch dann nach der Wohnfläche. Den Maßstab ändert bei
  eigener Abrechnung nur die Einrichtung (`PUT` an der Anlage: 409); **bewusst offen**: er steht noch nicht je Zeitraum
  wie Erfassung und Warmwasser (Fehlerklasse #239/#241). Ob Satz 5 unter die freie Wahl nach § 6 Abs. 4 fällt, sagt der
  Wortlaut nicht; Texte sprechen von „bestimmt oder vereinbart“. Invariante: Variante „Grundkosten nach umbautem Raum“
  in fuel-invariant.test.ts, Prüfung (s7).
- **„Nur Heizung“ bei freien Schlüsseln** nimmt beim Mieterwechsel Gradtage statt Tage; kombinierte
  Positionen bleiben nach Tagen.
- **Invarianten** (fuel-invariant.test.ts, fuel-stock-invariant.test.ts) mit Varianten für eigene
  Abrechnung, Warmwasser, Heizkostenverteiler, Ablesedienst, Kesseltausch, Schätzung und Ausnahmen:
  Gewichte verteilen jeden Topf ganz, jede Lieferung steht genau einmal in den Zeilen, α, Q und
  Faktor stimmen mit den Eingaben. Der Vorratsübertrag nimmt bei `self` nur eine Brennstoffposition
  nach HeizkostenV als Vorlage (`stockKeysOf`).

### Warmwasseranteil α

[server/src/dhw.ts](../server/src/dhw.ts): alle drei Verfahren des § 9 Abs. 2 HeizkostenV als reine
Funktionen, ein Aufruf in calc.ts (`hotWaterShareOf`).

- Die Faktoren 1,11, 1,15 und 0,30 gelten **nur für Formelwerte**, nie für gemessene Wärme (das
  Lexikon nennt beide Lesarten). Q gegen: Brennstoff in kWh laut Rechnung (aus der Bewertung der
  Lieferungen), sonst als Menge mit B = Q / Hᵢ, Fernwärme die gelieferte Wärme, Wärmepumpe mit Formel
  den Strom, gemessen bei Wärmepumpe und Mischanlage die Gesamtwärme. Bekannte Einheiten in die
  Grundeinheit (`base`).
- **Heizwert laut Rechnung geht vor**, die Tabelle nur hilfsweise bei Heizkesseln mit der Zeile, die
  der Vermieter wählt (`fuel_grade`, [shared/fuelGrades.ts](../shared/fuelGrades.ts)); mehrere
  mengengewichtet; nach einem Tausch mit übernommenem Vorrat zählen die Lieferungen der Vorgängerin
  mit. **Holzhackschnitzel**: seit 01.12.2021 4 kWh/kg (BGBl. 2021 I S. 4966), die Angabe in kWh/SRm
  ist entfallen (gesetze-im-internet.de druckt die alte Tabelle versehentlich noch).
- Eine Formel verlangt die Antwort, ob die Anlage die Wärme **allein** erzeugt (`heat_generation`).
  Die Flächenformel gilt „pro Jahr“ und wird im Rumpf und beim Tausch nach Tagen gekürzt (Festlegung).
  Was fehlt, sagt `heating.dhw-share-invalid`. Stromheizung: gemessen ja, Formeln gesperrt; bei
  Contracting mit Wärmepumpe ebenso.
- α abgeschlossener Abrechnungen ist eingefroren. Die 15 % bei Formel ohne bestätigten Aufwand
  (`heating.dhw-not-metered`) gelten auch bei `self`. Ausweis: `self.alpha`, `self.dhw`.

### Heizkostenverteiler und Ablesedienst

[server/src/hca.ts](../server/src/hca.ts). Alle drei Erfassungen laufen durch **dasselbe
Grenzmodell**: Ein Heizkostenverteiler ist ein Zähler vom Typ `hkv` mit Faktor (`meterFactor`), Werte
eines Ablesedienstes sind je Wohnung ein gedachter Zähler mit kumulierten Ständen (`serviceMeters`;
ohne Stand am Beginn einer Zeile nach einer Lücke, damit die Lücke nicht still 0 zählt). Dieselben
bewerteten Einheiten ergeben dieselben Beträge, gleich woher (Test).

- **Einheitsskala**: Ablesewert × Bewertungsfaktor; **Produktskala**: wie abgelesen. Ohne Skala oder
  Faktor `heating.hca-factor-missing`, keine Verteilung. Skala und Faktor nur am Typ `hkv`; ein Gerät
  mit anderem Faktor ist ein neuer Zähler; gesperrt (409), sobald seine Ablesungen eine
  abgeschlossene Heizperiode überdecken.
- **Stichtagswert** ist eine Ablesung mit `replacement` und Wert 0 (das Ableseergebnis zeigt
  `oldEndValue`); eine Rücksetzung mitten in der Heizperiode ergibt `heating.device-cutoff`.
- **Gezählt wird ein Gerät nur in Heizperioden, die seine Ablesungen überdecken** (`coversPeriod`).
  **Gemischt** ist eine Wohnung, wenn ein Gerät der anderen Art zählt und keins der eingestellten Art
  sie ganz abdeckt (`spansPeriod`): `heating.mixed-capture`, keine Verteilung (eine Vorerfassung nach
  § 5 Abs. 7 rechnet Mietfuchs nicht, #218); mit Schätzung nach § 9a nicht mehr gemischt.
- **Ablesedienst und Verdunster**: Werte über `heating_service_values` (je Wohnung und
  Nutzungszeitraum, Heizung in Einheiten oder kWh je Zeile, `heat_unit`; die Zeilen einer Heizperiode
  werden als Ganzes ersetzt). Gelesen **über die Linie** (`lineServiceRows`, eigene zuerst). Verdunster
  wertet Mietfuchs nicht selbst aus.
- **Ausweis je Gerät** (`self.devices`) aus den Differenzen des Plans, nicht aus einer zweiten Lesart;
  jeder Mieter bekommt nur seine Geräte und Zeilen. Dass der Faktor genannt wird, ist Praxis, keine
  Norm (so in Lexikon und Sätzen).

### Schätzung nach § 9a

[db/heatingEstimates.ts](../server/src/db/heatingEstimates.ts), Tabelle `heating_estimates` (Topf
`heat`/`water`, Wert, Weg, Grund, **Begründung Pflicht**, Bestätigung, Erfassung und Einheit beim
Speichern). Karte [EstimateCard.tsx](../client/src/components/EstimateCard.tsx), Logik
[estimateForm.ts](../client/src/estimateForm.ts).

- **Eine Schätzung tritt nur an die Stelle des nicht erfassten Verbrauchs** (§ 9a Abs. 1 Satz 1): Ein
  Nutzer mit gültigen Ablesungen (etwa der Vormieter bis zur Zwischenablesung) behält seinen Messwert,
  die übrigen teilen den Rest nach Gradtagen bzw. Tagen (Festlegung). Ohne behaltenen Wert ersetzt
  sie auch Gemessenes; gesagt wird das nur, wenn wirklich ein Teilstück ersetzt wird
  (`replacesMeasured`). Neben vollständigen Ablesungen ersetzt sie alles (`heating.estimate-complete`,
  unbestätigt `heating.estimate-unconfirmed`).
- **Passt sie nicht mehr** zu Erfassung oder Einheit (`estimateFits`), rechnet sie nicht
  (`heating.estimate-stale` bzw. `-stale-unused`); die Karte zeigt sie mit „Entfernen“. Einheit beim
  Ablesedienst ohne Werte wählbar, sonst die der Werte. Weitere Hinweise: `-same-day`, `-no-device`,
  `-below-measured`, `-base-unit`.
- **Über `hkv.estimate-threshold`** geschätzter Fläche je Topf (streng größer; die Fläche einer
  Wohnung zählt ganz; **Auslegung**) geht der Topf nur nach Fläche, ohne Kürzung (VIII ZR 373/04).
- Gelesen **über die Linie**. Keine Schätzung ohne Gerät (400; beim Ablesedienst nicht geprüft), nie
  wegen verschiedener Ablesetage, gesperrt in abgeschlossenen Heizperioden. Eine Wohnung mit
  Schätzung oder Ablesedienstwerten wechselt nicht das Objekt. Vorschläge (`estimateProposals`):
  Durchschnitt je m², vergleichbare Wohnung, Vorperiode (nur gleich lang und gleich erfasst).

### Pflichtangaben und Ausnahmen (§ 2, § 6a, § 11)

[server/src/heatingInfo.ts](../server/src/heatingInfo.ts), [db/heatingInfo.ts](../server/src/db/heatingInfo.ts);
Karten HeatingRulesCard, HeatingInfoCard, Druckblock HeatingInfoBlock.

- **Ausnahme (§ 11), Vereinbarung (§ 2), monatliche Information und Verbrauchervertrag stehen je
  Heizperiode** in `heating_periods` und gelten für die folgenden der Linie, bis eine spätere etwas
  anderes sagt (`heatingRulesOf`; `null` = geerbt). Zeitlos an der Anlage wirkten sie rückwirkend.
  `dryRun` nennt spätere abgeschlossene Heizperioden, an denen eine Angabe vorbeiwirkt.
- **Ausnahme je Topf** (`exemptionScopeOf`, `exemptPot`; ohne Antwort nur die Wärme): keine Kürzung
  nach § 12 (`noCutFor`); Wärme und Warmwasser ausgenommen: keine § 6a-Angaben und keine
  CO₂-Aufteilung ohne vereinbarte Abrechnung (§ 2 Abs. 7 CO2KostAufG, Regel einmal in
  [server/src/co2Exemption.ts](../server/src/co2Exemption.ts)). Nur Wärme ausgenommen: CO₂ wird
  aufgeteilt, **Kürzungen nur auf den Anteil Warmwasser** (`waterBaseOf`), die Gesamtsumme steht als
  Obergrenze dabei. Hat der Messdienst trotzdem abgezogen: `co2.exempt-deducted`.
- **Vereinbarung nach § 2** wirkt nur, solange das Haus die Voraussetzung erfüllt (`heatingAgreeable`)
  und hebt nur die Kürzung nach § 12 Abs. 1 Satz 1 auf; „nach Wohnfläche“ verteilt ganz nach Fläche
  (`agreedArea`), „feste Anteile“ kann Mietfuchs nicht (400).
- **§ 6a** (`heatingInfoOf` je Linie und Heizperiode, an der Anlage, die am Ende heizt, mit
  `tenancyIds`): **Nr. 4 ist nie ein Hausdurchschnitt** (BR-Drs. 643/21), sondern ein Vergleichswert in
  kWh/m² mit Pflichtquelle, umgerechnet auf Fläche und Tage des Mieters. Nr. 5 mit Klimafaktoren, die
  der Vermieter mit Quelle einträgt. **Was fehlt, steht je Mieter** (`users[].missing`,
  `missingCommon`). Wo Mietfuchs nicht rechnen kann, bestätigt der Vermieter den Vergleich des
  Ablesedienstes (`info_comparison_source`). Bei geschätztem Verbrauch nur die Mindestangaben.
  Sicher fehlend: `heating.info-incomplete` mit 3 % (ein Kürzungsrecht, auch mit der monatlichen
  Information), ab Zeiträumen nach dem 01.12.2021; unsicher: `heating.info-open`. Kontaktadressen in
  `shared/heatingInfo.ts` jährlich prüfen.

## Monatliche Verbrauchsinformation

[server/src/monthlyInfo.ts](../server/src/monthlyInfo.ts), Texte in
[shared/monthlyInfo.ts](../shared/monthlyInfo.ts), Karte MonthlyInfoCard, Blatt MonthlyInfoSheet (Portal
an `body`, gedruckt mit `body.print-monthly-info`).

- Nur bei eigener Abrechnung einer zentralen Anlage mit eigenen Zählern und nur, wenn ein Gerät einer
  Wohnung selbst als fernablesbar eingetragen ist; sonst bleibt `heating.monthly-info` („bis zu 3 %“).
- Verbrauch nur aus Ablesungen **genau** an den Monatsgrenzen, nie interpoliert; fehlt einem Gerät
  einer Größe der Wert, fehlt die ganze Größe. Vergleiche nur mit demselben Mietverhältnis; der
  Durchschnittsnutzer als Vergleichswert je Monat mit Quelle (`heating_monthly_info`), nie aus dem
  eigenen Haus. Warmwasser in kWh über § 9 Abs. 2 Satz 2 ist Auslegung und steht getrennt;
  Heizkostenverteiler ergeben keine kWh. Die Warmwassertemperatur (`dhw_temp_c`) ist dafür nötig.
- „Mitgeteilt“ je Anlage und Monat, fällig ab dem Folgemonat (Festlegung). `heating.monthly-info`
  nennt offene Monate und je Mieter **einmal** 3 % (nicht doppelt neben `heating.info-incomplete`);
  abgezogen wird nichts.

## Brennstoffvorrat

Heizöl, Flüssiggas, Pellets, Holz, Kohle (`STOCK_ENERGIES`, [shared/fuelStock.ts](../shared/fuelStock.ts)):
[server/src/fuelStock.ts](../server/src/fuelStock.ts) rechnet Anfangsbestand + Lieferungen −
Endbestand für Menge, Betrag, kg und CO₂-Kosten; Spalten an `heating_periods`,
[db/fuelStock.ts](../server/src/db/fuelStock.ts). Lieferungen haben Lieferdatum und Menge und laufen
nicht durch die Abgrenzung; ihr Betrag ist Σ der verknüpften Positionen.

- **Bewertung**: Verbraucht wird rechnerisch das Älteste zuerst (Kinne/Schach/Bieber), der Endbestand
  besteht aus den jüngsten Teilen zu deren Preisen, kg und CO₂-Kosten, je Teil gerundet (kg auf das
  Hundertstel). Die HeizkostenV regelt das nicht.
- **Die Kette**: Den Anfangsbestand trägt der Vermieter nur in der ersten Heizperiode mit Vorrat ein,
  danach übernimmt jede den Endbestand der vorigen (ein eigener wird abgelehnt; `stockChainsOf`, bis
  zur ersten abgeschlossenen Vorperiode, deren Endbestand eingefroren ist). **Und rückwärts**: Hat eine
  abgeschlossene Folgeperiode den Bestand übernommen, ist ihr eingefrorener Anfangsbestand der
  Endbestand der Vorperiode, und Einheit, Endbestand sowie Menge, Einheit, Datum und Positionen der
  Lieferungen sind gesperrt (`stockTakenOverBy`); Beträge bleiben änderbar. Ein neuer Endbestand der
  Vorperiode leert den eigenen Anfangsbestand der offenen Folgeperiode (`saveStock`, `removeStock`).
- **Was weitergegeben wird** (`handover`): Bucht eine Heizperiode keinen Übertrag (freie Schlüssel
  ohne Brennstoffposition, `stockTemplateOf`) oder ist ohne Vorrat abgeschlossen
  (`closedWithoutStock`), geht der Endbestand mit 0 € weiter (die kg bleiben). Der erste
  Anfangsbestand zählt 0 €, wenn er schon umgelegt wurde (`opening_already_settled`); ohne Antwort
  „ja“ nach `settledByDefault` (Vorperiode mit ausdrücklichem Brennstoff, oder positive Heizpositionen
  ohne Kennzeichen mindestens im Wert des Bestands; „Betrieb“ und „Ablesung“ zählen nie). Die Karte
  belegt nur bei `defaultAlreadySettled: 'default'` vor. Hinweise `fuel.opening-settled`,
  `-settled-assumed`, `-not-settled`, `-check-loose`, `fuel.stock-not-taken-over`.
- **Gesperrt**: Vorrat und Lieferungen einer abgeschlossenen Heizperiode (auch Verschieben hinein oder
  hinaus), der Wechsel des Energieträgers, sobald ein Vorrat eingetragen ist.
- **CO₂**: Brennstoff mit Rechnung vor 2023 zählt mit kg, nicht mit CO₂-Kosten (`co2.costs-before`,
  `fuel.before-2023`). CO₂-Kosten nur bei Heizöl, Flüssiggas, Kohle (`CO2_FUELS`; Holz und Pellets
  stehen nicht in Anlage 1 BEHG). Beim Messdienst ohne Aufteilung kommen E und C aus dem Bestand
  (`OwnFuel`); ohne Bestand `fuel.stock-missing` (3 %).
- **Freie Schlüssel**: Zwei Übertragsposten `stock:<Anlage>:<Heizperiode>:in|out` laufen mit dem
  Schlüssel der größten Brennstoffposition als `fuelCarry` durch die Verteilung (nicht in
  Gesamtkosten und Steuer). Ohne Bestand oder Schlüssel `fuel.manual-by-delivery` (eine Abrechnung
  nach Lieferungen ist unzulässig, VIII ZR 156/11). Eine Brennstoffposition ohne Lieferung neben dem
  Vorrat: `fuel.stock-unlinked`.
- **Steuer nach Bezahltem**: Der Eigenanteil enthält den Übertrag, die Steuer nicht
  (`stockCarrySelfCents` nennt den Abstand). **Peildatum** wie gepeilt; `fuel.stock-date-differs`
  nennt Abweichungen.
- Invarianten: fuel-stock-invariant.test.ts (Übergabe je Paar von Heizperioden),
  vorrat-durchsicht.test.ts.

## Blatt „CO₂-Angaben für den Messdienst“ und Plausibilität

- **`co2.cost-implausible`** ([server/src/co2Plausibility.ts](../server/src/co2Plausibility.ts)) je
  Rechnung, die die Heizperiode berührt, auch bei Vorrat: Spannen aus CO₂-Preis (`co2.price`,
  `co2.price-ets`, überschreibbar, siehe Rechtsregister), EBeV-Werten und Steuersätzen
  (`ustg.gas-heat-network-rate`, Mischsatz nach BMF vom 25.10.2022, Rz. 12; Flüssiggas Rz. 5).
  Grenzen 1 €/3 %, bei den kg 1 % nach oben und 10 % nach unten wegen Biomasseanteilen
  (Festlegung, `KG_TOLERANCE`, `COST_TOLERANCE`). Mietfuchs rechnet nie kg oder € aus kWh vor, es
  vergleicht nur. Bei Wärme aus dem Emissionshandel mit Anschluss nach dem Stichtag wird nicht
  geprüft (`etsExempt`, eine Stelle).
- **Das Blatt** ([server/src/co2Sheet.ts](../server/src/co2Sheet.ts), #210, `Co2SheetView`) **rechnet
  nichts, was die Abrechnung entscheidet**: Endbestand, Verbrauch, Teil je Rechnung, kg/m², Stufe
  und Fläche kommen aus dem Ergebnis der Abrechnung (`billing`, über `co2SheetFor`); eine
  Zufallsprüfung in co2-sheet-runde3.test.ts hält beides gleich. **Seine Summe zählt nur, was die
  Abrechnung zählt** (Storno und abgedeckte Schätzung über `notInvoiceDeliveries`/`estimateFactors`,
  Rechnung vor 2023 nur mit kg), jede nicht zählende Zeile trägt einen Vermerk, nummeriert unter der
  Tabelle (`sheetNotes`). Dritte Person; „Bitte prüfen“ ist `no-print`.
- Ob das CO2KostAufG gilt und die Befunde je Rechnung stehen in `heating[].co2Check`; die Regel zur
  Ausnahme nach § 11 / § 2 Abs. 7 einmal in [server/src/co2Exemption.ts](../server/src/co2Exemption.ts)
  (`co2OffByExemptionOf`, `exemptionText`). Steht eine Heizperiode in keiner Abrechnung, fragt das
  Blatt `heatingRulesOf` selbst.

## Betriebsstrom der Heizung (#212, #224, #252, #253, #266, #270)

- `cost_items.operating_power`: an einer Heizposition `included` (der Strom steckt im
  Allgemeinstrom), an „Beleuchtung/Allgemeinstrom“ `deduction`. Der Abzug zeigt auf seinen
  Betriebsstrom (`operating_power_item_id`, `RESTRICT`) und auf seine Stromrechnung
  (`operating_power_general_id`: gleiches Objekt und gleicher Zeitraum, Rechnung solange gesperrt).
  Verweisbedingungen vergleichen mit `IS`, weil `NULL = …` in SQLite kein Verstoß ist. `included`
  nur mit positivem Betrag.
- Die Abrechnung prüft jede Position gegen die Abzüge **aus allen Zeiträumen** (`deductionsOf`;
  `heating.operating-power-double`, `-key`, `-exceeds`). Ein Abzug in einer abgeschlossenen
  Abrechnung hat vier Zustände (gutgeschrieben, geändert, nicht darin, unlesbar), je ein Satz;
  keiner rät zu einem neuen Abzug in einem anderen Jahr.
- **Schätzhilfe** ([shared/operatingPower.ts](../shared/operatingPower.ts),
  `POST /api/heating-plants/:id/operating-power`, [db/operatingPower.ts](../server/src/db/operatingPower.ts)):
  kWh aus Leistung, Laufzeit und Tagen, Zwischenzähler oder eigene Schätzung mit Pflichtgrundlage,
  Euro als Anteil an der Stromrechnung samt Grundpreis (Festlegung). Legt beide Positionen in einer
  Transaktion an; 409, wenn etwas abgeschlossen ist, 409 `despiteExisting` bei schon gebuchtem
  Betriebsstrom, 400 bei Abzügen über der Rechnung (dieselbe Summenregel im Kostenformular). Die
  Grundlage steht in `operating_power_basis` und im Rechenweg, denn der Vermieter muss sie darlegen
  können (VIII ZR 27/07, Leitsatz c). Prozentspannen der Literatur nur im Lexikon (V ZR 166/15 Rn. 14
  legt keinen Wert fest). Kein Eintrag im Regelverzeichnis.
- **Wärmepumpe und Stromheizung**: keine Hilfe, denn der Strom zur Wärmeerzeugung ist Heizkosten,
  aber weder Brennstoff noch Betriebsstrom (§ 7 Abs. 2 HeizkostenV seit 01.10.2024). Die Heizposition
  (Teil `fuel`) darf trotzdem `included` tragen (`POWER_GENERATED`, `guardOperatingPower`);
  Herausrechnen ist Auslegung.
- **Zeitraumwechsel**: Rechnung und Abzüge wandern als Einheit, geprüft am Endstand
  (`settleOperatingPowerLinks`); der Abzug folgt seiner Rechnung, jeder Teil zeigt auf den Teil der
  Rechnung im selben Zeitraum. Mehrere Abzüge werden **gemeinsam nach den Beträgen der Teile**
  geteilt (`splitDeductionsAlike`), sonst würde aus einem Teil mehr abgezogen, als er beträgt. Kein
  Jahr der Zahlung am Abzug (#267). Geprüft wird je Mieter gegen von Hand hergeleitete Beträge.
- **Hinweise, wenn er fehlt** (`missingPowerFindings` in [operatingPower.ts](../server/src/operatingPower.ts),
  alle reine Auskunft, keine Zahl ändert sich): `heating.operating-power-missing` (`hint`, färbt nicht)
  bei zentraler Anlage mit Brenner, ohne Messdienst und ohne Gemeinschaft, wenn nichts gekennzeichnet
  ist und keine Position „Betrieb“ oder ohne Teil besteht. **Die Angabe an der Anlage**
  (`operating_power_handling`, Karte „Betriebsstrom der Heizung“) unterscheidet: `deducted` →
  `heating.operating-power-deduction-missing` (gelb, auch wenn eine Position „Betrieb“ besteht),
  `ownMeter` → `heating.operating-power-bill-missing` (färbt nicht), `landlordPays` schweigt. Die
  Werte richten sich nach **Stromvertrag und Rechnung, nicht nach dem Zähler** (VIII ZR 27/07,
  Rn. 32). Ob gefragt wird, entscheidet `asksOperatingPowerHandling`; Frage und Beschriftungen stehen
  dort als Konstanten (wortgleich in Hinweis, Lexikon, Oberfläche). Der Kesseltausch übernimmt die
  Angabe. `heating.generation-power-missing` (gelb) bei Wärmepumpe und Elektrokessel ohne eigene
  Stromrechnung und ohne Abzug, nach den Fassungen `betrkv.generation-power` (2024) und
  `hkv.generation-power` (01.10.2024), das Register erst gefragt, wenn der Hinweis sonst käme.
- **Abzug ohne Verweis bei Messdienst** (#270): `cost_items.operating_power_reported` (Schritte 0063/0064,
  nur am Abzug ohne Verweis, Bedingung `…_reported_valid`) sagt, ob der Betrag dem Messdienst gemeldet ist
  (1) oder der Vermieter ihn selbst trägt (0); NULL heißt keine Angabe und gilt wie vor #270 als gemeldet,
  wo ein Messdienst heizt. Die Regel steht einmal in `deductionReported` (shared/operatingPower.ts):
  Formular, Steuerübersicht und Hinweis fragen sie. Die Auswahl im Kostenformular bietet bei Messdienst
  beide Antworten (`OPERATING_POWER_REPORTED`, `OPERATING_POWER_KEPT`), ohne Messdienst nur die zweite;
  ohne Messdienst gilt der Abzug immer als selbst getragen, gleich was dasteht. Ohne Angabe zeigt die Auswahl bei
  Messdienst „Ohne Angabe (gilt als dem Messdienst gemeldet)“, damit „gemeldet“ eine echte Wahl ist; die Schätzhilfe
  legt den Abzug beim Messdienst mit der Angabe „gemeldet“ an. Wird der Abzug verknüpft
  oder ist er keiner mehr, fällt die Angabe beim Speichern weg (`mergeCostItem`, geradegerückt). „Nicht
  gemeldet“ ergibt `heating.operating-power-not-reported` (`hint`, färbt nicht): Der Betriebsstrom steht
  dann in keiner Abrechnung an die Mieter; zulässig (VIII ZR 45/11, Rn. 3), der Text nennt den Weg über
  die Meldung. Keine Zahl der Abrechnung ändert sich; ohne Angabe bleibt alles wie vorher.

## Wärmelieferung, Contracting (#213)

[shared/heatDelivery.ts](../shared/heatDelivery.ts), [server/src/heatDelivery.ts](../server/src/heatDelivery.ts).

- `heating_plants.contracting` an jeder zentralen Anlage außer Fernwärme, auch an der Wärmepumpe;
  `energy` ist dann der Brennstoff des Kessels. Dazu `heat_delivery_since`, `previous_supply`,
  `switch_announced_on`.
- **Eine Naht**: `asBilledPlant` (idempotent) gibt der Berechnung bei Contracting
  `energy = 'districtHeating'` und `fuelEnergy`; damit gelten die Regeln der Fernwärme (kein
  Pflichtanteil, ÷ 1,15, kein Vorrat, Wärmerechnungen). Schreibwege und Oberfläche fragen
  `billingEnergy`; [heat-delivery-guard.test.ts](../server/test/heat-delivery-guard.test.ts) verbietet
  `plant.energy` in Entscheidungen. **Ausnahmen der Naht**: § 2 Abs. 4 Satz 2 CO2KostAufG (gespeicherte
  Energie); `co2Required` nach dem Brennstoff des Lieferanten (`NO_CO2_FUELS`); § 6a nennt den
  Brennstoff (`generatorEnergy`); § 11 Abs. 1 Nr. 3 a. F. und § 12 Abs. 3 am Wärmeerzeuger; bei
  Contracting mit Wärmepumpe sperrt dhw.ts die Formeln. Nach Betriebsstrom wird nicht gefragt.
- **Umschalten** an einer Anlage mit Lieferungen, Vorrat, CO₂-Angaben oder Positionen offener
  Zeiträume: 409, Weg über den Kesseltausch (`SWAP_FIELDS`; Gas → Gas mit Contracting ist ein Tausch).
- `heating.contracting` (`hint`) nennt für betroffene Mieter (Vertrag vor der Umstellung, keine
  Inklusivmiete bei der Heizung) § 556c Abs. 1 und 2 BGB, § 11 Abs. 3 WärmeLV (`noticeMonths`, Frist
  als vorsichtige Auslegung), § 5 WärmeLV; bei vorheriger Eigenversorgung VIII ZR 46/25 und 47/25,
  vor dem 01.07.2013 VIII ZR 54/04. Werte aus `bgb.heat-delivery-switch`, kein Eintrag im
  Regelverzeichnis. Nicht abgebildet: unmittelbare Abrechnung des Lieferanten, Contracting bei
  Etagenheizungen.

## Hälftige Teilung nach § 5a CO2KostAufG (#215)

[server/src/halfSplit.ts](../server/src/halfSplit.ts), [shared/law/gmodg.ts](../shared/law/gmodg.ts).

- Ab 2028 trägt der Vermieter bei einer Heizung nach § 43 Abs. 1 GModG die Hälfte der
  Gasnetzentgelte und CO₂-Kosten, ab 2029 des Pflichtanteils Biobrennstoff. Merkmale an der Anlage
  (`gmodg43_installed_on`, `emergency_install`, `emergency_prior_duty`, `new_building_first_use`,
  `building_application_before_2026_05_13`), am Mietverhältnis `half_split_notice_on` (§ 5d Abs. 4),
  am Objekt `tight_market` mit Geltung. Bedingungen an NULL-fähigen Merkmalen mit `IS 1`.
- **Zeitregel `incurred`**: `law()` teilt den Zeitraum an den Fassungen von `co2.half-split` und
  gewichtet nach Anfall (je Lieferung nach Stufen 1–5, sonst Gradtage; bei CO₂ Auslegung). Vor 2028
  und ohne Merkmal fragt `halfSplitOf` das Register nicht. „Zwölf Monate ab“ rechnet `eventPeriodEnd`.
- `selfSplit` mischt Stufen (mit § 8, § 9) und Hälfte; § 9 kürzt nur den Teil nach Stufen
  (Auslegung). Nachstufung des Messdienstes über `adjust` von `restage`. Etagenheizung je Wohnung.
  Ausnahme des § 5d Abs. 3 (selbst bewohnt, höchstens zwei Wohnungen) nur bei festgestellten
  Voraussetzungen. Contracting eingeschlossen; ob Gas, entscheidet `generatorEnergy`.
- Zeilen `gmodgRelief` unter `gmodg:<Anlage>:<Heizperiode>` (Grund `gmodgShare`); **jede Stelle, die
  die CO₂-Abzugszeile an `reliefKey` erkennt, fragt `reliefKeysOf`**. Fehlende Netzentgelte oder
  Biobrennstoff: `co2.half-split-missing` mit 3 %; Biobrennstoff aus dem Vorrat rechnet Mietfuchs nicht.

## Mieter heizt selbst und CO₂-Erstattung (#97)

[server/src/co2Refund.ts](../server/src/co2Refund.ts), [server/src/db/co2Refunds.ts](../server/src/db/co2Refunds.ts).

- `heatingModel: 'selfSupply'`: eigener Vertrag des Mieters (Etagenheizung oder zentrale Heizung mit
  Brennstoffvertrag beim Mieter). **Nie wie Pauschale oder Inklusivmiete lesen**: `allocationModel`
  macht daraus `settlement`, denn Wartung und Betriebsstrom bleiben umlegbar. Für eine solche Anlage
  entsteht keine Heizanlage. `selfSupplyKind` (`perUnit`/`central`); bei `central`
  `heating.self-supply-operating-power`, wenn andere Mieter den Allgemeinstrom tragen und kein Abzug
  erfasst ist.
- Heizpositionen nur von Selbstversorgern: keine Kürzung nach § 7 Abs. 4 CO2KostAufG oder § 12
  HeizkostenV, sondern `co2.self-supply-items`; gemischt mit Positionen einer Heizanlage
  `co2.self-supply-mixed` (error).
- **Erstattung** (`co2_refunds`) nur bei `selfSupply` (sonst 400 bzw. `co2.refund-not-self`),
  verrechnet als Zeile `co2Refund` mit Gegenzeile beim Vermieter (Σ unverändert), nur in einem
  Zeitraum, in dem der Mieter wohnte, nie in einem abgeschlossenen. Gebucht wird der angezeigte
  Betrag; die Nachrechnung (`selfSplit`) steht im Rechenweg, Abweichung `co2.refund-differs`.
  **Steuer**: verrechnet über Saldo; ausgezahlt (`paidOutOn`) als Werbungskosten im Jahr der
  Auszahlung, **nie als negative Zahlung im Mietkonto** (die läse `rentLedger` als Rücklastschrift).
  Der Vorschlag nach § 560 Abs. 4 BGB rechnet ohne Erstattungen (`recurringShareCents`).
