# Heizung: Entwicklerdoku

Aus der CLAUDE.md im Wurzelordner hierher verschoben (Heizung PR 4 bis PR 22). Wer an der
Heizung arbeitet (Heizanlage, Heizperiode, CO₂, Lieferungen, Vorrat, eigene
Heizkostenabrechnung, § 6a, § 9a), liest diese Datei zuerst.

**Heizanlage** (Heizung PR 4, #99, #214, #180): Ein Objekt hat höchstens eine Heizanlage
(`heating_plants`, eine zweite kommt mit PR 9), dazu die angeschlossenen Wohnungen
(`heating_plant_units`) und eine Zeile je Heizperiode (`heating_periods`, ohne Vorrat; geschrieben
ab PR 6). Anlegen, Ändern und Entfernen stehen in
[server/src/db/heating.ts](../server/src/db/heating.ts), die Prüfungen an Zählern und Kostenpositionen
in repository.ts, das dafür seine Rumpf-Helfer exportiert (heating.ts importiert von dort, nie
umgekehrt).

- **Eine Anlage ändert keine Zahl.** `manual` und `service` verteilen wie bisher; `change_split` wird
  gespeichert und wirkt erst mit `heating_target` (PR 10). Was spätere PRs rechnen (eigene
  Abrechnung, Etagenheizung, zweite Anlage, eigene Heizperiode, getrennte Abrechnung, beheizte
  Fläche), lehnt der Server mit `HeatingError` (400) und einem Satz ab.
- **Ohne Liste alle Wohnungen, mit Liste genau diese.** Ob es eine Liste gibt, sagt
  `units_limited`, wie `participants_limited` (#94): Sonst versorgte eine Anlage, deren letzte
  Wohnung gelöscht wurde, plötzlich das ganze Haus. Eine Wohnung in der Liste wechselt nicht das
  Objekt (`guardUnit`).
- **Heizpositionen gehören zur Anlage ihres Objekts.** Beim Einrichten mit Vorschau
  (`/api/heating-plants/assignable`), danach bekommt jede neue Position der Kostenart Heizung und
  Warmwasser ohne Feld `heatingPlantId` die einzige Anlage (`defaultHeatingPlant`, auch für alte
  Tabs und die Belegbuchung). Abgeschlossene Zeiträume bekommen keine Anlage. Entfernen gibt die
  Positionen frei; hängen noch Zähler an der Anlage, wird abgelehnt.
- **Zähler der Anlage** (`heating_plant_id` mit Rolle, ohne Wohnung) sind **keine Hauptzähler** des
  Hauses (`houseMeters` in calc.ts). **Warmwasserzähler zählen beim Kaltwasser mit**, aber nur ein
  Kaltwasserzähler sagt, ob eine Wohnung gemessen ist (G-B8, `measures`). Nach
  Heizkostenverteilern verteilt Mietfuchs erst mit Bewertungsfaktoren (PR 12); bis dahin lehnt der
  Server den Schlüssel ab, und die Oberfläche bietet ihn nicht an.
- **Fernablesbarkeit** entscheidet [server/src/remoteReading.ts](../server/src/remoteReading.ts) nach
  `hkv.remote-reading.new-devices` (Einbau nach dem Stichtag: ab Einbau) und
  `hkv.remote-reading.retrofit` (ältere ab 2027), aus den Zählern oder, beim Messdienst, aus der
  Angabe an der Anlage. Ein neues Gerät in einem System, dessen übrige Geräte nicht fernablesbar
  sind (laut Anlage keines oder alle anderen bekannten nicht), kann ein Ersatz nach § 5 Abs. 2 Satz 4
  sein; dann gilt die Frist des Abs. 3, vorher heißt es nur „bis zu“. Ob einzeln ersetzt oder als
  Ganzes neu installiert, fragt die Anlage (`new_devices_install`: `single` | `whole`, NULL offen);
  unbeantwortet nennt der Hinweis die Frage. Ein allein bekanntes Gerät ist nur sicher, wenn die
  Anlage keine weiteren Wohnungen ohne erfasstes Gerät versorgt. Sicher heißt
  `heating.remote-reading-missing` (warning, 3 % je Mieter in Wohnungen an der Anlage, auf die
  gedruckten Heizzeilen), möglich `heating.remote-reading` mit „bis zu“; ohne Anlage oder ohne
  Angaben bleibt `heating.remote-reading` wortgleich wie vor PR 4. Zwei Codes, weil die Stufe am
  Code hängt (#112).
- **Zweifamilienhaus** ist eine Art des Objekts (`zfh`) und nur Beschreibung; § 2 hängt an den
  Wohnungen (`mayAgreeOtherwise`), ein Widerspruch ergibt `property.kind-mismatch` (hint).
- Das Wiederherstellen prüft Verweise auf Anlagen anderer Objekte, überlappende Anlagen und
  Heizperioden ohne Zeitraum (`heatingPlantViolations`).

**Eigene Heizperiode und getrennte Heizkostenabrechnung** (Heizung PR 5, #217): Eine Anlage rechnet
im Zeitraum ihres Objekts ab (`period_start_month` null) oder in eigenen Heizperioden
(`period_start_month`, `heating_period_changes`, berechnet wie die Zeiträume des Objekts). Die Regeln
stehen in [shared/heatingPeriod.ts](../shared/heatingPeriod.ts).

- **Positionen tragen den Schlüssel ihrer Heizperiode** (G-A2): Eine Heizposition einer Anlage mit
  eigener Heizperiode steht unter einer Heizperiode der Anlage, sonst 400. Eine neue ohne Angabe (alter
  Tab, Belegbuchung) kommt in die Heizperiode, die in ihrem Objektzeitraum endet
  (`defaultHeatingPlant`). Den Rhythmus setzt nur der Wechsel mit Vorschau
  ([server/src/db/heatingPeriodChange.ts](../server/src/db/heatingPeriodChange.ts)), nie `PUT`; er
  schlüsselt die Positionen um, erfasst Korrekturen neu und lässt Abgeschlossenes unangetastet.
- **Weg b** (VIII ZR 240/07): Eine Heizperiode gehört in die Abrechnung P, in der sie endet. Der
  Schnappschuss trägt sie als `heatingParts`; `computeSettlement` rechnet jede mit derselben Funktion
  über ihre eigenen Tage (`scope: 'heatingPart'`, ohne Vorauszahlungen) und führt sie in P zusammen.
  Wer nur in der Heizperiode wohnte, bekommt `heatingOnly` mit `recommendedDeadline` und der Warnung
  `period.heating-only-statement` (15.1 Nr. 2).
- **Weg d** (Auslegung, 15.1 Nr. 21): Nur bei getrennter Abrechnung und H ≠ P. Ob eine Heizperiode
  getrennt abgerechnet wird, sagen die gespeicherten Spannen (`heating_separate_spans`: ab Monat X bis
  vor W), nicht die Antwort von heute, damit Ein- und Ausschalten nie rückwirkend wirken (C3, D1).
  Ein- und Ausschalten laufen über die Vorschau in
  [server/src/db/separateSettlement.ts](../server/src/db/separateSettlement.ts); P lässt die Heizperiode
  weg, sie hat ihre eigene Abrechnung (`scope: 'heating'`, `heatingSnapshotFor`), Frist und
  Abschluss (`closed_heating_settlements` samt Verlauf; der Abschluss von P friert sie nicht ein).
  Bei H = P gibt es eine Gesamtabrechnung mit getrennt ausgewiesenen Vorauszahlungen.
- **Jeder Monat der Heizstaffel wird genau einmal angerechnet** (6.1 Nr. 5): Er gehört der getrennt
  abgerechneten Heizperiode, die ihn enthält, wenn er ab X liegt, sonst der Abrechnung P
  (`separateOwner`, die einzige Stelle). **Die Jahreskorrektur von P gilt für alles, was P anrechnet**
  (bei Weg d also nur die übrigen Vorauszahlungen); eine Heizkorrektur (`heating_prepayment_overrides`,
  endgültig oder vorläufig mit Monaten, D2) gibt es nur für eine getrennt abgerechnete Heizperiode.
  Invariante 11 prüft das über zufällige Abläufe mit Abschlüssen (invariant-heizperiode.test.ts).
- Das Mietkonto führt beide Staffeln im Soll; die Steuerübersicht nimmt Heizpositionen einer eigenen
  Heizperiode im Jahr ihrer Zahlung, bei Weg d aus der Heizkostenabrechnung, und nennt dann keine
  Vorauszahlung der Abrechnung (`prepaymentSettlementCents` null).
- Ein Wechsel des Objektzeitraums lässt Heizpositionen einer eigenen Heizperiode, wo sie sind, und
  lehnt ab, wenn er Weg d für eine Heizperiode umschalten würde.
- **Jede Vorschau trägt eine Marke** (`token`, wie beim Wechsel des Abrechnungszeitraums): Der
  Wechsel des Zeitraums der Heizung und das Ein- und Ausschalten schreiben nur mit der Marke der
  Vorschau, die der Vermieter gesehen hat; sonst 409 mit der neuen Vorschau.
- **Einrichtung Schritt 3** erklärt die drei Wege (Heizperiode des Messdienstes in der
  Gesamtabrechnung, Objekt auf den Zeitraum des Messdienstes umstellen, Messdienst auf den 31.12.
  umstellen lassen) mit Vor- und Nachteilen; Vorgabe ist der erste, solange die Heizkosten nicht
  getrennt abgerechnet werden (VIII ZR 240/07, Leitsatz a). Logik in
  [client/src/heatingPeriodForm.ts](../client/src/heatingPeriodForm.ts) (`heatingWays`).

**CO₂ beim Messdienst** (Heizung PR 6, #97, #209, #211): Die CO₂-Angaben einer Heizperiode stehen in
`co2_statements` (eine Zeile je Zeile in `heating_periods`), die Beträge „vom Vermieter übernommen“ je
Mietverhältnis in `co2_tenant_reliefs`. Lesen und Schreiben in
[server/src/db/co2.ts](../server/src/db/co2.ts), gerechnet in [server/src/co2.ts](../server/src/co2.ts) und im
CO₂-Block von `computeSettlement`; die Probe in [shared/co2Probe.ts](../shared/co2Probe.ts), weil die
Oberfläche sie live zeigt. Die Rechtswerte (Anwendbarkeit ab 01.01.2023, Stufentabelle, Rundung, 3 %)
stehen in [shared/law/co2kostaufg.ts](../shared/law/co2kostaufg.ts), am Wortlaut auf
gesetze-im-internet.de gegengelesen.

- **Die Methode ist eine Antwort, keine Vorgabe** (Entwurf 7.2): `serviceDeducted` (Abzugszeile),
  `serviceShown` (nur ausgewiesen), `selfAfterService` (nicht aufgeteilt). Bei freien Schlüsseln gibt
  es nur `self`, und der Datensatz hält nur die Fläche der Einstufung (Heizung PR 7); der Topf führt
  ihn nicht (`co2PotsOf` kennt nur Angaben laut Messdienst), die eigene Aufteilung liest ihn eigens.
- **S ist die gedruckte Kostensumme** (G-B3), nicht die Summe der gerundeten Nutzerzeilen. Die Probe
  läuft nur über die Messdienstpositionen (Schlüssel `amounts`, W9): Vorwegabzug Σ = S + L ± 1 ct, nur
  ausgewiesen Σ = S, beide Einzel- und Eigenbeträge ≤ S + NE · 2 ct. Scheitert sie, wird **nichts**
  gebucht (`co2.sum-check`, error); mit „Ich finde diese Zeile nicht“ ist S geschätzt, und der
  Spielraum NE · 2 ct gilt auch für den Betrag. Geht die Probe dann auf, bleibt ein Hinweis
  (`co2.sum-check-approx`); geht sie nicht auf, wird ebenso **nichts** gebucht (Durchsicht I-2).
  Alle Hinweise eines Topfs hängen daran, dass jemand eine Zeile aus ihm hat (`settledOn`):
  Pauschal- und Warmmieter kürzen nichts. Kappt `take()` den co2Share über den Spielraum, sagt
  `co2.share-capped`, dass L in einer anderen Position steckt.
- **Vorwegabzug:** In der Position, in der L steckt (`carrierId`: die gewählte, sonst die größte),
  steht L_self exakt in `selfUse` (#203: nie über `take()`), der Rest von L als eigener Grund
  `co2Share` direkt dahinter, durch den Rest begrenzt. Die Mieter zahlen ihre Einzelbeträge
  unverändert. Damit ist #209 behoben: Werbungskosten sind das Bezahlte, L_self privat.
- **Nur ausgewiesen:** Zeilen `kind: 'co2Relief'` ohne Kostenposition (`costItemId` =
  `co2:<Anlage>:<Heizperiode>`), je Mieter der Wert laut Messdienst oder L · x / S, als eine Verteilung
  von R = round(Σ r) mit `distributeCents`; der Vermieter trägt R in einer Zeile gleicher Kennung als
  `co2Share`. Σ aller Zeilen bleibt Σ der Positionen.
- **Kürzungen** (6.5) je Mieter auf seine gedruckten Zeilen im Topf nach der Abzugszeile, nie summiert:
  3 % nach § 7 Abs. 4 CO2KostAufG (`co2.missing`, `co2.service-unsplit`, `co2.incomplete`,
  `co2.sum-check`, ohne Anlage `co2.fuel-unknown` und `co2.missing-first-year`), 15 % bei Warmwasser
  nach Formel (`heating.dhw-not-metered`). Alle Rechtswerte aus `shared/law/co2kostaufg.ts`.
- **Nachstufung** (9.2): Mietfuchs ordnet den Wert laut Messdienst in die Stufentabelle ein (gerundet
  auf eine Nachkommastelle, bei kurzer Heizperiode mit gekürzten Grenzen, ein ganzzahlig gedruckter
  Wert als Spanne) und meldet eine Abweichung als Hinweis (`co2.stage-mismatch`). § 8 und § 9
  rechnet die Berechnung nur bei der eigenen Aufteilung (PR 7, Merkmale an der Anlage).
- **Töpfe und eigene Heizperiode:** Ein Topf ist je Anlage die Menge ihrer Heizpositionen mit dem
  Schlüssel des Zeitraums der Berechnung. Bei eigener Heizperiode rechnet die Teilabrechnung (Weg b)
  bzw. die Heizkostenabrechnung (Weg d) den Topf; `mergeHeatingPart` übernimmt `heating`.
- **Ausweis:** `Settlement.heating` je Anlage und Heizperiode mit `Co2Assessment`; der Druckblock
  „CO₂-Kostenaufteilung“ ([client/src/co2View.ts](../client/src/co2View.ts)) ist nicht `no-print`.
- **Oberfläche:** Seite „Heizkosten“, erst ab einer Heizanlage in der Navigation (`navFor`), mit den
  Karten „CO₂-Kosten“ (Logik in [client/src/co2Form.ts](../client/src/co2Form.ts)) und „Warmwasser“.
- Eine Anlage mit CO₂-Angaben wird nicht still mitgelöscht (409); Beträge je Mietverhältnis gehören zum
  Objekt der Anlage (`guardTenancyMove`, `crossPropertyViolations`). Eine Zeile in `heating_periods`,
  die nach dem Entfernen keine Angabe mehr trägt, wird mit entfernt (`dropIfEmpty`): Der Wechsel des
  Zeitraums der Heizung (PR 5) sieht jede Zeile als erfasste Angabe. Beim Wiederherstellen prüft
  `heatingPlantViolations` die Schlüssel nach dem Rhythmus der Anlage (`plantRules`).
- **Kostenart „Heizung“ ist keine Heizposition.** CO₂-Hinweise erscheinen wie alle Heizregeln nur bei
  der Kostenart „Heizung und Warmwasser“ (`HEATING_CATEGORY`); deshalb bleibt Golden F06 (Kostenart
  „Heizung“) wortgleich, anders als im Entwurf (12.1) angenommen.

**Lieferungen** (Heizung PR 7, #97): Rechnungen des Versorgers an der Heizanlage in `fuel_deliveries`
(Teilmengen in `fuel_delivery_parts`), Positionen zeigen über `cost_items.fuel_delivery_id` darauf,
mehrere je Lieferung (Abschlag, Schlussrechnung, Gutschrift). Abgegrenzt wird in
[server/src/fuel.ts](../server/src/fuel.ts) (`plantFuel`), gelesen und geschrieben in
[server/src/db/fuel.ts](../server/src/db/fuel.ts); die Gradtagzahlen des Orts je Objekt und Monat in
`degree_day_values`. Die CO₂-Merkmale (§ 8, § 9, § 2 Abs. 4 Satz 2 CO2KostAufG) stehen an der Anlage
(`non_residential`, `restriction`, `district_ets_new`), ihre Rechtswerte im Register.

- **Stufen, tagesgenau gibt es nicht** (Entwurf 3.2): eingetragener Anteil, Zählerstand (genau ein
  Versorgungszähler, Stände genau an den Grenzen), Zwischenrechnung, Teilmengen, Ortswerte, Tabelle
  `hkv.degree-days`; feste Preisbestandteile (`fixed_cents`) immer nach Tagen. Die Tabelle wird nur
  gefragt, wenn eine Anlage Lieferungen hat; sonst stünde sie im Rechtsstand jeder Abrechnung.
- **Die Positionen stehen in der Heizperiode, die das Ende der Rechnung enthält** (die Verknüpfung
  wird sonst abgelehnt, `guardFuelLink`). Der Teil einer anderen Heizperiode ist eine Zeile ohne
  Position (`kind: 'fuelCarry'`, Kennung `fuel:<Lieferung>:<Heizperiode>:<andere>:<Position>`), mit dem
  Schlüssel der Position verteilt, und eine Gegenzeile beim Vermieter (`fuelCarry`, Kennung
  `fuel:<Lieferung>:<Heizperiode>:<andere>`). Über die Zeiträume hinweg ist jede Rechnung genau einmal
  verteilt; eine Invariante in calc-fuel.test.ts prüft das an Zufallsbeständen, auch über einen
  Abschluss. Eine Heizperiode ohne eigene Positionen rechnet trotzdem, wenn die Anlage Lieferungen
  hat (Topf und Teilabrechnung nach Weg b), sonst fehlte ihr der Übertrag.
- **Abgeschlossenes bleibt** (G-A4): Der Abschluss friert je Lieferung und Heizperiode in
  `fuel_carry_frozen` ein, was sie herein- oder hinausgebucht hat; gelesen wird das nur für eine
  abgeschlossene Heizperiode, das Wiederöffnen gibt es frei (`unfreezeFuelCarries`, im selben
  Vorgang wie das Wiederöffnen, danach `dropIfEmpty`). Kommt der Teil einer Rechnung in eine
  abgeschlossene Heizperiode, trägt ihn der Vermieter (`fuelClosedPeriod`), oder er ersetzt eine
  Schätzung (`fuelEstimateDiff` mit Vorzeichen). Eine Schätzung zählt, solange keine echte Rechnung
  ihre Tage abdeckt; gespeichert wird „ersetzt“ nicht. Gesperrt (409) sind eine Lieferung mit
  eingefrorenem Teil (außer der Bezeichnung) und Ablesungen des Versorgungszählers mit Datum in
  einer abgeschlossenen Heizperiode (`guardSupplyReading`, `heatingPeriodAt`).
- **Rückfrage beim Abschluss:** Bei einer Lücke mit Schätzvorschlag antwortet der Abschluss mit 409
  und `fuelGaps` (samt Frist); `fuelEstimates: 'estimate' | 'none'` entscheidet. In der Oberfläche
  ist **Abwarten** die Vorgabe (`defaultChoice: 'cancel'` im Bestätigungsdialog), weil die Schätzung
  einer noch fehlenden Versorgerrechnung höchstrichterlich nicht entschieden ist; die Schätzung
  trägt ihre Grundlage in der Bezeichnung. Eine Heizposition der Anlage ohne Lieferung deckt mit
  ihrem Leistungszeitraum ab; ohne Leistungszeitraum gibt es keinen Schätzvorschlag, sondern
  `fuel.loose-item`. Eine Schätzung, deren Tage eine echte Rechnung teilweise abdeckt, zählt nur für
  die übrigen Tage. Rechnen, Schätzungen anlegen,
  neu rechnen, Abschließen und Einfrieren laufen in **einer** Transaktion (`closeWithFuel` in
  index.ts); deshalb nehmen die Leser in read.ts ein `Executor`, und `readStock(tx)` sieht die eben
  angelegten Schätzungen.
- **Eigene CO₂-Aufteilung:** C bei freien Schlüsseln abgegrenzt, beim Messdienst ohne Aufteilung die
  angesetzten Rechnungen ganz (G-A3); E immer umgerechnet. Der Abzug folgt dem Schlüssel des
  Brennstoffs (G-B5, `bookReliefs`), § 8 und § 9 aus dem Register (`co2.non-residential`,
  `co2.restriction`), Wärme aus dem Emissionshandel bei Anschluss nach dem Stichtag
  (`co2.district-ets-new`) ohne Aufteilung.
- **Was die Durchsicht von #233 festhält:** Eine mit 0 eingefrorene Lieferung (beim Abschluss noch
  ohne Position) lässt sich verknüpfen; ihr Teil der abgeschlossenen Heizperiode geht an den
  Vermieter (`fuelClosedPeriod`). Hat eine abgeschlossene Heizperiode einen Teil ungleich 0
  eingefroren, sind Lösen, Umhängen, Verschieben und Löschen nur der **letzten** Position der
  Lieferung gesperrt (409); weitere Positionen (Abschlag, Gutschrift) sind erlaubt. Der eingefrorene
  Stand führt die Überträge je Lieferung (`frozenFuelCarriesOf`): Eine offene Heizperiode nimmt
  genau, was die abgeschlossene Heizperiode der Positionen ihr hinausgebucht hat. Eine Position zeigt nur auf eine Lieferung ihres Objekts. Die Kennung einer
  Übertragszeile nennt beide Heizperioden (`fuel:<Lieferung>:<Heizperiode>:<andere>:<Position>`),
  Hinweise an ihr führen zur Position. Die CO₂-Aufteilung gilt nur für Brennstoffe mit Standardwerten
  (§ 2 Abs. 1 CO2KostAufG): nicht für Strom einer Wärmepumpe, bei Fernwärme nur mit ausgewiesenen
  CO₂-Kosten. Die Nachstufung beim Messdienst erwartet § 8 und § 9 nach den Angaben zum Gebäude.
  **Storno nach Abschluss** (W1): Ergeben die Positionen einer Lieferung 0, wird nichts gesperrt und
  nichts verteilt; hat eine abgeschlossene Heizperiode einen Teil hereingebucht oder die
  abgeschlossene Heizperiode der Positionen einen hinausgebucht, steht beim Vermieter die
  Gegenbuchung und ihr Gegenteil als `fuelClosedPeriod` (Summe 0, ausgewiesen), dazu die Warnung
  `fuel.cancelled-after-close`; das Gegenstück nennt, was die Mieter der abgeschlossenen Heizperiode zu
  viel getragen haben (dafür führt der eingefrorene Übertrag `totalCents`). War die andere Heizperiode
  mit Schätzung abgeschlossen, steht die Schätzung als `fuelEstimateDiff` gegen. Eine stornierte
  Rechnung (Positionen mit Summe 0) verdrängt keine Schätzung, deckt keine Tage ab und zählt nicht in
  der Bewertung; die Lücke steht wieder da. Weil das auch eine echte Rechnung über 0 € treffen kann,
  sagt es der Hinweis `fuel.zero-invoice`, `fuel.uncovered` und die Rückfrage beim Abschluss nennen die
  Rechnung (`zeroInvoices` an der Lücke). Eine Schätzung ohne Rechnung mit Positionen als Vorlage für
  ihren Schlüssel wird nicht verteilt und meldet `fuel.estimate-undistributed` statt `fuel.estimated`. Ihr Satz zur Frist hält sich an den Wortlaut von § 556 Abs. 3 Satz 3
  BGB (ausgeschlossen ist nur die Nachforderung durch den Vermieter). Wurde eine Position erst nach
  dem Abschluss ihrer Heizperiode verknüpft, nimmt die andere nichts und sagt es
  (`fuel.owner-closed-unlinked`, Stufe `hint`).
  Eine Invariante über Zufallsbestände mit Abschluss (auch mit Schätzung), Wiederöffnen, Verknüpfen,
  Gutschriften bis zum Storno, geänderten Beträgen und später eintreffenden Rechnungen
  (fuel-invariant.test.ts, über die echten Schreibwege der Datenbank, ohne nachgebildete Sperren)
  prüft, dass jede Rechnung genau einmal verteilt ist: Die Mieter tragen die Positionen bis auf die
  ausgewiesenen Teile, nach oben wie nach unten, und je Lieferung und Paar von Heizperioden heben sich
  die Gegenbuchungen auf oder ein ausgewiesener Teil desselben Paars deckt sie genau (eine Summe über
  alle Lieferungen ließe eine falsche Gegenbuchung hinter einem berechtigten Teil verschwinden). Feste Startwerte, mehr mit `INV_FROM`/`INV_TO`; jede
  Rücknahme der Befunde der Durchsicht macht sie rot (Mutationsprobe).
- **Gutschrift ohne Rechnung** (#251): Ob eine Lieferung Rechnung, Storno oder Gutschrift ohne
  Rechnung ist, entscheidet **eine** Stelle, `invoiceStatusOf` in fuel.ts (Summe der Positionen > 0,
  = 0, < 0; Bewertung, Blatt für den Messdienst und Plausibilität fragen `notInvoiceDeliveries`). Eine
  Lieferung mit negativer Summe belegt keinen Verbrauch (§ 7 Abs. 2 HeizkostenV): keine Tage, keine
  Verdrängung einer Schätzung, keine Vorlage für einen Vorschlag (`templateFor` nur mit Summe > 0),
  kein CO₂, im Vorrat ungültig mit Satz. Ihr Geld wird nach Anteil verteilt wie das einer Rechnung;
  das ist Auslegung am Verbrauchsprinzip (BGH VIII ZR 156/11) und steht so im Hinweis
  `fuel.credit-only` (bestätigt `fuel.credit-only-confirmed`, Stufe `hint`, über
  `fuel_deliveries.credit_note_kind = 'standalone'`, Migration 0046/0047; die Angabe steuert nur die
  Stufe, keine Zahl). `POST /api/fuel-deliveries/:id/reassign-credit` (`reassignCredit`) hängt die
  Positionen an die Lieferung, die sie berichtigt, in deren Heizperiode; 409, solange eine der
  beiden abgeschlossen ist. Oberfläche: `client/src/fuelCredit.ts`.
  **Eingefrorener Teil ≠ heutiger Teil** (R-2): Hat eine abgeschlossene Heizperiode einen anderen Teil
  einer Rechnung eingefroren als heute auf sie entfiele, bucht die Heizperiode der Positionen nur den
  heutigen hinaus (`frozenPart` am Übertrag); der Unterschied steht beim Vermieter als
  `fuelClosedPeriod` (darüber: `fuel.reduced-after-close`, die Mieter jener Abrechnung haben zu viel
  getragen; darunter: `fuel.closed-period-part`, nachfordern nur dort). Der eingefrorene Übertrag führt
  dafür `bookedCents`, damit ein späteres Storno das Hereingebuchte gegenbucht. **`estimatesIn`** (R-3)
  nimmt als ersetzt den Betrag der Schätzung für die Tage, die die Rechnung abdeckt; Tage, die
  mehrere Rechnungen anderer Heizperioden abdecken, zählen für jede zu ihrem Teil, und zusammen
  ersetzen sie höchstens den eingefrorenen Betrag (der ist schon um die beim Abschluss abgedeckten
  Tage gekürzt). Hat die abgeschlossene Heizperiode neben dem Teil einer Lieferung eine Schätzung
  eingefroren (die Lieferung war damals eine Gutschrift ohne Rechnung), gilt beides zusammen gegen den
  heutigen Teil (`fuelEstimateDiff`). Einen Schätzvorschlag gibt es nur über 0 €. Die Invariante prüft dazu (c1) Abdeckung ohne Gutschriften, (c2) keinen negativen
  Vorschlag, (c3) je Mieter gegen die offene andere Heizperiode, und die Gutschrift je Mieter auch neben
  einer zweiten Rechnung (doppeltes Kontrafaktum); Variante „Gutschrift ohne Rechnung“.
- **Gesperrt bis zu ihren PRs:** Vorratsenergien (PR 8), Lieferungen je Wohnung (PR 9), Netzentgelte
  und Biobrennstoff (PR 18), Methode `self` (PR 10); jeder Satz sagt, was bis dahin geht.
- **Golden F15 und F12** ([server/test/fixtures/heating/](../server/test/fixtures/heating)): F15 ist das
  Techem-Muster mit Vorwegabzug, F12 eine anonymisierte reale Abrechnung Mai bis April. In F12 sind
  nur die Gesamtwerte und der eine Nutzer des Belegs echt; die übrigen drei Nutzer sind synthetisch und
  die kg CO₂ geschätzt, beides steht so in README und `betraege.json`.

**Mehrere Heizanlagen, Etagenheizung und Kesseltausch** (Heizung PR 9, #97): Ein Objekt kann mehrere
Anlagen haben. Ab zwei braucht jede einen Namen (im Objekt verschieden) und ihre Liste der Wohnungen,
und keine Wohnung hängt an zweien, außer die Anlagen gehören zu einer Linie von Täuschen (`replaces_plant_id`,
transitiv: `lineRoot`/`sameLine` in [shared/heatingPeriod.ts](../shared/heatingPeriod.ts)); geprüft wird das nach jedem
Schreiben über alle Anlagen des Objekts (`guardPlantsOfProperty` in
[server/src/db/heating.ts](../server/src/db/heating.ts)), in derselben Transaktion, und beim
Wiederherstellen mit `heatingPlantViolations`. Das Anlegen nimmt Namen und Wohnungen bisheriger Anlagen
im Rumpf `adjust` mit, damit nie ein halber Stand entsteht.

- **Gebäude** (`building_with`, Recht I3 der Durchsicht von #238): Eine weitere Anlage neben einer laufenden
  sagt beim Anlegen, ob sie im selben Gebäude steht (Kennung einer anderen Anlage) oder in einem eigenen
  (`'own'`); Pflicht, ohne Vorbelegung. Im selben Gebäude stuft die Abrechnung über den Ausstoß aller Anlagen
  und die Wohnfläche aller versorgten Wohnungen ein (`partnersOf`/`contributionOf` in calc.ts, § 5 Abs. 1
  Satz 1 und 2 CO2KostAufG, Hinweis `co2.building-joint` als Auslegung); dieselbe Mechanik gilt für die Linie
  eines Kesseltauschs. Fehlt der Ausstoß einer mitheizenden Anlage, `co2.classification-incomplete`.
  **Die Fläche** ist bei Anlagen im selben Gebäude die aller Anlagen des Gebäudes: je Linie die eingetragene
  (9.2) oder die der versorgten Wohnungen, jede Wohnung einmal (`jointAreaOf`); eine eingetragene Fläche einer
  Anlage allein teilte den Ausstoß des ganzen Gebäudes durch einen Teil seiner Fläche (Nachprüfung, I-A).
  **Die erste Anlage wird nicht gefragt** (`building_with` NULL), auch nicht beim Ändern; eine beantwortete
  Frage lässt sich neben einer laufenden Anlage nicht wieder leeren. Ein Kreis der Angaben (`buildingCycle`)
  wird mit 400 abgelehnt; steht er in einem Archiv, ist die Wurzel die kleinste Kennung im Kreis
  (`buildingRoot`). Wird die Anlage entfernt, auf die andere zeigen, gehen die Verweise an ihre
  Nachfolgerin, sonst an das Gebäude, in dem sie stand, sonst wird die erste verweisende der Bezugspunkt;
  ein Verweis ins Leere im Archiv wird beim Wiederherstellen NULL. Die Auswahl in der Oberfläche zeigt bei
  einem Verweis auf eine stillgelegte Anlage die laufende ihrer Linie, mit dem gespeicherten Wert.
- **Eine neue Heizposition ohne Anlage** bekommt mit verknüpfter Lieferung deren Anlage, sonst bei mehreren
  Anlagen die, an der alle von ihr genannten Wohnungen hängen (Direktzuordnung, Teilnehmer, Einzelbeträge;
  `plantForNewItem` in repository.ts) und die zu Beginn ihres Leistungszeitraums heizt, sonst keine. Gehört
  eine Heizposition zu keiner Anlage, obwohl das Objekt welche hat, sagt `co2.fuel-unknown` das an der
  Position statt „Richten Sie die Heizung ein“.
- **Position über zwei Anlagen** (`co2.item-spans-plants`, error): Reicht die Verteilbasis einer
  Heizposition (`itemBasisUnits` in [server/src/co2.ts](../server/src/co2.ts)) in eine zweite Anlage,
  gehört sie zu keinem Topf und mindert keinen Abzug; verteilt wird sie weiter nach ihrem Schlüssel.
  Alte und neue Anlage eines Kesseltauschs zählen dafür nicht als zwei.
- **Etagenheizung auf Vertrag des Vermieters** (`supply = 'perUnit'`, § 5 Abs. 1 Satz 2
  CO2KostAufG): nur mit freien Schlüsseln und ohne Vorratsenergie; jede Heizposition direkt bei einer
  Wohnung der Anlage, jede Rechnung (`fuel_deliveries.unit_id`) mit dieser Wohnung, eine verknüpfte
  Rechnung mit derselben. Eine zentrale Anlage nimmt keine Rechnung mit Wohnung, und ob zentral oder
  je Wohnung, lässt sich nicht mehr umstellen, sobald Positionen oder Rechnungen daran hängen.
  Eingestuft wird über Σ kg / Σ Fläche der vermieteten Wohnungen mit Rechnung in der Heizperiode (eine
  eingetragene Fläche geht vor). Der Abzug ist je Mietverhältnis r = ‰ · C_u · x_t / A_u, **ohne**
  Normierung auf die Mieter der Wohnung: Was in A_u auf Leerstand, Eigennutzung oder Pauschale fällt,
  bleibt beim Vermieter. C_u über A_u → `co2.exceeds-heating` für diese Wohnung, sie bekommt keinen
  Abzug, die übrigen schon. Die Rechnung steht in `perUnitClassification`, `perUnitReliefs`,
  `perUnitExceeding`; calc.ts setzt sie über `perUnitFuelOf` aus den Zeilen der Abgrenzung (PR 7) ein.
- **Kesseltausch** (`POST /api/heating-plants/:id/replace`, `replaceHeatingPlant`, Migration 0026):
  Die alte Anlage bekommt `ends_on` (letzter Betriebstag), die neue `replaces_plant_id`, Namen und
  dieselben Wohnungen; Rhythmus und Gebäudemerkmale übernimmt sie. Ohne Fremdschlüssel, weil drizzle-kit
  beim Hinzufügen einer Spalte kein `ON DELETE` schreibt. Lieferungen müssen in die Betriebszeit ihrer
  Anlage fallen (`plantSpanOf`, db/fuel.ts); die Abgrenzung (PR 7) rechnet eine Anlage nur über ihre
  Betriebstage, die Bestandsrechnung (PR 8) endet am letzten Betriebstag, und der Endbestand dort ist
  der **Restbestand**: den Mietern gutgeschrieben, beim Vermieter als eigene Zeile `stockRemaining`,
  Hinweis `fuel.stock-remaining` mit § 7 Abs. 2 HeizkostenV (im selbstbewohnten Zweifamilienhaus § 2
  Nr. 4a BetrKV). Die Steuerübersicht ändert sich nicht, die Rechnungen bleiben voll. Teilen alte und
  neue Anlage eine Heizperiode, wird das Gebäude über den Ausstoß beider eingestuft (§ 5 Abs. 1 Satz 1
  CO2KostAufG: „des Gebäudes … und Jahr“, `successionOf` in calc.ts, Hinweis `co2.plant-replaced`).
  Gleicher Vorratsbrennstoff: Der Tausch fragt „Verheizt der neue Kessel den Brennstoff im Tank weiter?“
  (`takes_over_stock`, Vorbelegung ja, änderbar, solange weder die letzte Heizperiode der alten noch die
  erste der neuen abgeschlossen ist). Mit Ja beginnt die Kette der neuen Anlage mit der der alten
  (`stockChainsOf` mit `plants`), der Restbestand ist ihr Anfangsbestand, ein eigener wird mit einem Satz
  über die alte Anlage abgelehnt. Mit Nein bleibt der Restbestand wie bei anderem Brennstoff beim
  Vermieter. Zurück von Nein auf Ja fragt die Oberfläche vorher, denn der eigene Anfangsbestand der neuen Anlage entfällt dann. Übernimmt sie den Restbestand im selben Zeitraum nicht, nennt `fuel.stock-not-taken-over` den Restbestand der alten Anlage zum letzten Betriebstag. In beiden Fällen kommt der Schlüssel der Überträge auch von den Positionen der Vorgängerin
  (`sameFuelLine`, `stockTemplateOfLine`; sonst ging der Anfangsbestand ohne eigene Position der neuen
  Anlage im Tauschjahr mit 0 € weiter, Nachprüfung K1). Eine stillgelegte Anlage rechnet in einem späteren Zeitraum mit, wenn
  eine Position dort mit ihrer Lieferung verknüpft ist (die Gasrechnung bis zum Tausch, im Folgejahr
  gebucht): Sie wird in den Zeitraum der Lieferung abgegrenzt, sonst trügen die Mieter sie zweimal. Gleicher Brennstoff über einen Zähler (Gas, Fernwärme,
  Strom): 409, kein Tausch nötig. Das Entfernen der neuen Anlage macht den Tausch rückgängig, das der alten
  nimmt der Nachfolgerin den Verweis, das aus der Mitte einer Linie lässt die nächste den Zeitraum
  übernehmen (Hinweis in Rückfrage und Antwort, `notice`); ein verwaister Verweis im Archiv wird beim Wiederherstellen
  geradegerückt (`straightenHeatingPlants`). Vorrat und Lieferungen nur in der Betriebszeit. Gesperrt
  bleiben der Tausch einer Etagenheizung, bei getrennter Heizkostenabrechnung (Weg d), mitten in einer
  abgeschlossenen Heizperiode (zum Ersten nach dem Abschluss geht er), vor einer abgeschlossenen späteren
  und mit Angaben der alten Anlage für die Zeit danach.
- **Etagenheizung, Grundlage der Umlage:** Die HeizkostenV gilt nicht (§ 1 Abs. 1), § 2 Nr. 4 Buchstabe d
  BetrKV nennt nur Reinigung und Wartung. Eine belegte Grundlage für die Umlage der Gaskosten bei Vertrag des
  Vermieters hat die Durchsicht nicht gefunden; Hinweis `heating.per-unit-basis` und Lexikon „Etagenheizung“
  sagen „nicht geklärt“ und verweisen auf § 556 Abs. 1 Satz 1 BGB. Fernwärme ist keine Etagenheizung. `fuel-invariant.test.ts` und `fuel-stock-invariant.test.ts`
  rechnen je eine Variante mit zwei Anlagen und prüfen, dass jede Lieferung nur bei ihrer Anlage steht.

**Eigene Heizkostenabrechnung** (Heizung PR 10, #99): Bei `method = 'self'` verteilt Mietfuchs nach
der Heizkostenverordnung. Die reine Rechnung steht in [server/src/heating.ts](../server/src/heating.ts):
Nutzer je Wohnung (Mietverhältnisse, Leerstand, Eigennutzung, außerhalb), die Ablesung je Grenze (die
beim Mieterwechsel erfasste fest, `readings.interim_for`; sonst die nächste in der Zelle über H−1, H und
H+1; zwei Werte am selben Tag sind ein Befund; der eingefrorene Endstand der Vorperiode ist der
Anfangsstand; ohne Rückrechnung, Entwurf 3.5),
§ 9b Abs. 3 als Gruppe über die Grenzen ohne Ablesung, Bruchteile je Topf und daraus **ein Gewicht je
Nutzer und Ziel** (`weightsOf`). calc.ts verteilt jede Position mit `key = 'heatingSystem'` mit diesen
Gewichten durch `distributeCents` (#202), wie jede andere Position; Leerstand und Eigennutzung gehen
über `landlordRecipients`.

- **Teil und Ziel** stehen an der Position (`heatingPart`, `heatingTarget`); bei verbundener
  Warmwasserbereitung teilt der Warmwasseranteil α (`hotWaterShareOf`, seit PR 11 über dhw.ts, siehe
  unten) die Ziele „beides“. Der Anteil nach Verbrauch gilt aus der Heizperiode oder der vorigen
  (`consumptionSharesOf`, § 6 Abs. 4); § 7 Abs. 1 Satz 2 ist `hkv.consumption-share-forced`.
- **Umgestellt wird nur über die Einrichtung** (`PUT /api/heating-plants/:id/self`,
  [server/src/db/heatingSelf.ts](../server/src/db/heatingSelf.ts)): Anlage, Anteil, Zähler und die
  Positionen offener Zeiträume in einer Transaktion; fehlen Teil und Ziel, antwortet sie 409 mit der
  Liste. Zurück auf „Niemand“ verlangt `convertItems: 'area'`.
- **Nicht verteilbar** (fehlender Stand, fehlender Zähler, kein Anteil, α unbestimmbar) heißt Fehler an
  der Anlage und alle Positionen beim Vermieter; geraten wird nie. Die Hinweise zu Ablesung und
  Zwischenablesung rechnen nach dem CO₂-Block, weil ihre Kürzungsbeträge auf den gedruckten Zeilen
  stehen; fehlende Zwischenablesungen beantwortet der Vermieter in `interim_reading_gaps`.
- **Wärmepumpe**: Ob die Verordnung gilt, entscheidet `heatPumpVerdict` aus dem Datum der Erfassung
  oder des Einbaus (§ 12 Abs. 3, `hkv.heat-pump.capture`).
- **„Nur Heizung“ bei freien Schlüsseln** nimmt beim Mieterwechsel die Gradtage statt der Tage
  (Fläche, Einheiten, vereinbarte Anteile, Direktzuordnung); eine kombinierte Position bleibt nach
  Tagen, deshalb ändert sich für Bestandsnutzer keine Zahl.
- **Golden F16, F17** in `server/test/fixtures/heating/` rechnen Beispiel A und das Heizöl mit Vorrat von
  Hand nach; Heizkostenverteiler und Werte eines Ablesedienstes kamen mit PR 12, die Angaben nach § 6a mit PR 14.
- **Invarianten**: fuel-invariant.test.ts und fuel-stock-invariant.test.ts haben Läufe mit eigener
  Abrechnung, fuel-invariant auch mit verbundenem und getrenntem Warmwasser; dazu prüfen sie, dass die
  Gewichte jeden Topf ganz verteilen, jede Lieferung über alle Heizperioden genau einmal in den Zeilen
  steht und der Topf Warmwasser den Warmwasseranteil α trägt (s3). Der Vorratsübertrag nimmt bei `self` nur eine
  Brennstoffposition nach Heizkostenverordnung als Vorlage (`stockKeysOf` in fuelStock.ts).
- **Zeiträume und Linie** (Durchsicht von #239 und ihre Nachprüfung): Wann die eigene Abrechnung gilt,
  steht in der Tabelle `heating_self_spans` (von, bis ausschließlich; `until` NULL beim laufenden), wie die
  Spannen nach Weg d. Die Einrichtung öffnet einen Zeitraum (nie vor einem laufenden und nie vor oder in einer
  abgeschlossenen Heizperiode; unmittelbar am Ende eines früheren geht dieser weiter). Das Zurückschalten
  schließt ihn mit der ersten offenen Heizperiode, wenn abgeschlossene nach ihm gerechnet wurden, sonst
  entfällt er, und es leert die Anteile offener Heizperioden; abgeschlossene rechnen weiter nach der
  Verordnung, wie sie zugestellt wurden. Liegt eine abgeschlossene Heizperiode hinter einer offenen, lehnt
  es mit 409 ab. Der Kesseltausch erbt den laufenden Zeitraum. Abgeleitet aus den Anteilszeilen wird nichts.
  Gerechnet wird je Heizperiode (`selfActive` in heating.ts, `selfAt` und `withSelfBegin` in snapshot.ts,
  auch in der Teilabrechnung von calc.ts, der Wächter in repository.ts, `selfItemsOf` mit `from`), denn § 6 Abs. 4
lässt die Wahl nur für künftige Zeiträume zu. Der Anteil gehört zur **Linie** der Anlage
  (`lineShareRows`, [server/src/db/selfLine.ts](../server/src/db/selfLine.ts)): Nach einem Kesseltausch gilt er
  weiter, und in derselben Heizperiode lehnt `saveDistribution` einen anderen ab. Den Pflichtanteil nach
  § 7 Abs. 1 Satz 2 nachzutragen ist keine Wahl und geht auch in einer begonnenen Heizperiode. Läuft eine
  Anlage nur einen Teil der Heizperiode, wird die Wärme am Speicher an ihrer Laufzeit abgegrenzt; dafür
  braucht es den Stand am Tauschtag (der Tausch nimmt `meterReadings` an), sonst `heating.self-incomplete`.
  Der eingefrorene Endstand kommt auch aus der Heizkostenabrechnung nach Weg d. Die Angaben nach § 6a
  stehen seit PR 14 unter „Pflichtangaben und Ausnahmen“ (`heating.info-incomplete` statt
  `heating.self-6a-missing`).
- **Migrationen 0027/0028**: Spalten an `heating_plants` (`hot_water`, `capture`, `area_basis_heat`,
  `heat_pump_installed_on`), `cost_items.heating_target`, `readings.interim_for` und die Tabellen
  `interim_reading_gaps` und `heating_self_spans`; die Bedingungen im zweiten Schritt.
- **Warmwasseranteil α** (Heizung PR 11, #211, [server/src/dhw.ts](../server/src/dhw.ts)): eine Stelle
  für alle drei Verfahren des § 9 Abs. 2 HeizkostenV, als reine Funktionen; `hotWaterShareOf` bleibt der
  eine Aufruf in calc.ts. Die Faktoren 1,11, 1,15 und 0,30 gelten **nur für Formelwerte**, nie für
  gemessene Wärme (Entwurf G-B1 abgelehnt, 15.1 Nr. 9; das Lexikon nennt beide Lesarten, ⟨Norm offen:
  VDI 2077⟩). Wogegen Q gestellt wird, hängt am Erzeuger: Brennstoff in kWh laut Rechnung (die kWh der
  Heizperiode aus der Bewertung der Lieferungen, wie in PR 10), sonst als Menge mit B = Q / Hᵢ (§ 9
  Abs. 3), Fernwärme die gelieferte Wärme, die Wärmepumpe mit Formel den Strom, gemessen bei Wärmepumpe
  und Mischanlage die gemessene Gesamtwärme. Der **Heizwert laut Rechnung** geht vor; die Tabelle nur
  hilfsweise, nur bei Heizkesseln und nur mit der Zeile, die der Vermieter an der Lieferung wählt
  (`fuel_grade`, Zeilen in [shared/fuelGrades.ts](../shared/fuelGrades.ts)); mehrere Heizwerte
  mengengewichtet, beim Vorrat ohne Lieferung in der Heizperiode der der jüngsten früheren.
  **Holzhackschnitzel**: Die Verordnung vom 24.11.2021 hat § 9 Abs. 3 Satz 1 und Satz 2 Nr. 2 neu
  gefasst (BGBl. 2021 I S. 4966), und mit der alten Nummer ist die Angabe 650 kWh/SRm entfallen; seit
  01.12.2021 gelten 4 kWh/kg und B nur in Litern, Kubikmetern oder Kilogramm. gesetze-im-internet.de
  druckt die alte Tabelle hinter Satz 5 noch ab; das ist ein Versehen der Konsolidierung. Eine Formel
  verlangt die Antwort, ob die Anlage die Wärme **allein** erzeugt (`heat_generation`); ohne sie und bei
  mehreren Erzeugern rechnet sie nicht (Satz 6 Nr. 3 „monovalent“, Satz 5). Die Flächenformel liefert kWh
  „pro Jahr“ und wird im Rumpf und bei einem Kesseltausch nach Tagen gekürzt (Festlegung F7, § 9b
  Abs. 2); das Volumen nimmt Mietfuchs beim Tausch nur aus der Zeile der Anlage selbst. Was fehlt, ergibt
  `heating.dhw-share-invalid` mit dem Satz, was fehlt. Der Ausweis führt α als `self.alpha`, den
  Rechenweg als `self.dhw`. Die **Stromheizung** rechnet gemessen gegen den Strom laut Rechnung wie in
  PR 10, nur die Formeln sind dort gesperrt: Eine Anlage, die vorher abrechenbar war, sperrt eine spätere
  PR nicht. Die **Wärmepumpe vor dem 01.10.2024** fiel nach § 11 Abs. 1 Nr. 3 Buchst. a a. F. nicht unter
  die Verordnung (`hkv.exemption.renewable`, zwei Fassungen), wenn sie überwiegend versorgte: Die Anlage
  fragt das (`heat_pump_majority`, unabhängig vom Erzeuger nach § 9); „ja“ und ohne Antwort Hinweis statt
  Fehler, keine Kürzungsbeträge, ohne α gehen Heizung und Warmwasser gemeinsam in den Topf Heizung; „nein“
  rechnet nach der Verordnung. Erzeuger- und Überwiegend-Frage stehen an der Anlage (Karte „Heizung“),
  nicht in der Warmwasser-Karte. Nach einem Kesseltausch mit übernommenem Vorrat zählen für den Heizwert die
  Lieferungen der Vorgängerin gleicher Energie mit. Brennwert/Heizwert, Heizwert und Tabellenzeile bleiben
  an eingefrorenen Lieferungen änderbar (`unfrozenAside` in db/fuel.ts); α abgeschlossener Abrechnungen ist
  eingefroren. Die Kürzung um
  15 % bei einer Formel ohne bestätigten Aufwand (`heating.dhw-not-metered`) gilt auch bei `self`. Tests
  der eigenen Abrechnung bauen Beispiel A mit `selfSnapshot()`
  ([server/testing/selfHeating.ts](../server/testing/selfHeating.ts)); ein Test hält den Helfer gleich mit
  dem Weg über die Datenbank. Die Invarianten prüfen Q, Faktor und α gegen die Eingaben (fuel-invariant
  (s4), fuel-stock-invariant (w) mit Heizöl und Heizwert). Migrationen 0029/0030 (`fuel_grade`,
  `heat_generation`, `heat_pump_majority`).
- **Heizkostenverteiler und Ablesedienst** (Heizung PR 12, #99, [server/src/hca.ts](../server/src/hca.ts)):
  § 5 Abs. 1 Satz 1 HeizkostenV lässt Wärmezähler und Heizkostenverteiler gleichrangig zu, und Mietfuchs
  bringt alle drei Erfassungen in **das Grenzmodell von PR 10**: Ein Heizkostenverteiler ist ein Zähler
  vom Typ `hkv` mit einem Faktor am Zähler (`SelfMeter.factor`, `meterFactor`), `planSelf` wählt den
  Gerätetyp nach der Erfassung, und die Werte eines Ablesedienstes sind je Wohnung ein gedachter Zähler
  mit kumulierten Ständen (`serviceMeters`; 0 am Tag vor der ersten Zeile, ohne Stand am Beginn einer
  Zeile nach einer Lücke, sonst zählte die Lücke still als 0; ein eingefrorener Endstand der Vorperiode
  gilt für diese Zähler nicht, denn ihre Zeilen gehören zu genau einer Heizperiode). Zwischenablesung,
  Gradtage, Leerstand und „keine Interpolation“ bleiben damit an einer Stelle, und ein Test hält fest,
  dass dieselben bewerteten Einheiten dieselben Beträge ergeben, gleich woher sie kommen. Die Einheit des
  Topfs Heizung heißt dann „Einheiten“. Bei der **Einheitsskala** zählt der Ablesewert mal dem
  Bewertungsfaktor, bei der **Produktskala** wie abgelesen (ein eingetragener Faktor wirkt dann nicht);
  ohne Skala oder Faktor `heating.hca-factor-missing` und keine Verteilung. Der **Stichtagswert** ist
  kein eigenes Feld, sondern eine Ablesung mit `replacement` und Wert 0; eine Rücksetzung mitten in der
  Heizperiode ergibt `heating.device-cutoff`. Ein Gerät mit anderem Faktor ist ein neuer Zähler; Skala und
  Faktor eines Geräts, dessen Ablesungen in einer abgeschlossenen Heizperiode mit Heizkostenverteilern
  zählen, sind gesperrt (409), ebenso das Löschen; geprüft wird nach Überdeckung, nicht nach Ablesedatum.
  **Gezählt wird ein Gerät nur in Heizperioden, die seine Ablesungen überdecken** (`coversPeriod`: erste vor
  dem Ende, letzte nach dem Tag vor dem Beginn); ein ausgebautes Gerät mit letzter Ablesung am Stichtag
  muss deshalb nicht gelöscht werden. **Gemischt** ist eine Wohnung, an der in der Heizperiode ein Gerät der
  anderen Art zählt und kein Gerät der eingestellten Art sie **ganz** abdeckt (`spansPeriod`: erste Ablesung am
  Tag vor dem Beginn oder früher, letzte am Ende oder später); ein Heizkostenverteiler neben dem Wärmezähler
  derselben Wohnung ändert also nichts, ein Wechsel mitten in der Heizperiode dagegen schon (`switched`, der
  Satz nennt Zwischenstand bzw. Schätzung nach § 9a, mit der die Wohnung seit PR 13 nicht mehr gemischt ist, und die Meldung zum fehlenden Stand
  nennt das andere Gerät). Sonst fiele der Verbrauch des alten Geräts still weg, nachgemessen 1.349,39 € statt
  1.794,28 €. Das verlangt nach § 5 Abs. 7 eine Vorerfassung, die Mietfuchs nicht rechnet (#218):
  `heating.mixed-capture`, keine Verteilung; Warmwasserzähler und Zähler der Anlage zählen nicht. Beim
  Ablesedienst nennt jede Zeile, ob die Heizung in Einheiten oder kWh steht (`heat_unit`); gemischt ist
  dort, wo beides vorkommt.
  **Verdunster** wertet Mietfuchs nicht aus; ihre Werte kommen wie alle eines Ablesedienstes über
  `heating_service_values` (je Wohnung und Nutzungszeitraum, Warmwasser für alle Zeilen oder keine,
  Lücken bleiben Lücken, die Zeilen einer Heizperiode werden als Ganzes ersetzt; `dropIfEmpty` lässt eine
  Heizperiode mit solchen Werten stehen). Gelesen werden sie **über die Linie** (`lineServiceRows`, eigene
  Zeilen vor denen der Vorgängerin): Nach einem Kesseltausch liest die neue Anlage dieselben Werte, und eine
  Heizperiode der alten Anlage, an der nur solche Werte hängen, sperrt den Tausch nicht. Skala und Faktor gibt es nur am Zähler vom Typ `hkv`
  (Prüfbedingung). Der Ausweis je Gerät (`self.devices`) entsteht aus den Differenzen des Plans
  (`SelfUnitPlan.measured`, je Nutzer bzw. Gruppe nach § 9b Abs. 3), nicht aus einer zweiten Lesart der
  Ablesungen; gedruckt bekommt jeder Mieter nur seine Geräte in seinem Zeitraum und nur die Zeilen des
  Ablesedienstes, die in seinen Zeitraum fallen. Das Ableseergebnis nennt am Stichtag den Stichtagswert
  (`SelfReadingView.oldEndValue`), nicht die 0. Dass die Abrechnung den Faktor nennt, ist Praxis der
  Messdienste (Berliner Mieterverein), keine Norm; so steht es in Lexikon und Sätzen. **Erfassung und Warmwasserbereitung gehören zum Zeitraum der eigenen Abrechnung**
  (`heating_self_spans.capture`, `.hot_water`, `captureOf` und `hotWaterOf` in shared/heatingPeriod.ts, weil die
  Seiten Kosten und Heizkosten dieselbe Frage stellen; beide ändern sich
  über `PUT` bei eigener Abrechnung nicht, sondern nur mit der Einrichtung ab einer Heizperiode): Eine andere Erfassung beginnt mit der Einrichtung ab einer Heizperiode einen neuen
  Zeitraum, frühere Heizperioden rechnen weiter nach ihren Geräten. Ab einer schon begonnenen Heizperiode gilt
  die neue Einstellung ab deren Beginn: Geräte und Warmwasserbereitung sind Tatsachen der Anlage, keine Maßstäbe
  nach § 6 Abs. 4; geschützt bleibt der Anteil nach Verbrauch (`checkShares`, beim Warmwasser nur, wo es vorher
  und nachher einen gibt). Eine offene Heizperiode eines früheren Zeitraums rechnet weiter selbst ab; Verteilung
  und Ansicht fragen dafür `selfActive`, nicht den Beginn des laufenden Zeitraums. Ein Zeitraum von vor PR 12 bekommt beim
  nächsten Schreiben die bisherige Erfassung der Anlage (`pinSelfSpans`); über `PUT /api/heating-plants/:id`
  ändert sie sich bei eigener Abrechnung nicht. Die Einrichtung legt bei Heizkostenverteilern und
  Ablesedienst keine Wärmezähler an. Die Invariante fuel-invariant hat drei Varianten mit
  Heizkostenverteilern bzw. Ablesedienst samt Mieterwechsel und Leerstand ((s5): Verbrauch je Wohnung =
  Σ Differenz × Faktor bzw. Σ der Werte). Weitere Varianten: Heizkostenverteiler und
  Ablesedienst mit Kesseltausch, Heizkostenverteiler mit Ablesungen bis zehn Tage neben dem Stichtag; (s5) wird je
  Variante gezählt. Migrationen 0031/0032 (`hca_scale`, `rating_factor`, `hca_model`, `heating_self_spans.capture`
  und `.hot_water`, `heating_service_values` mit `heat_unit`).
- **Schätzung nach § 9a** (Heizung PR 13, #99, [server/src/db/heatingEstimates.ts](../server/src/db/heatingEstimates.ts)):
  Tabelle `heating_estimates` (Heizperiode, Wohnung, Topf `heat`/`water`, Wert, Weg, Grund aus der Auswahl,
  Begründung Pflicht, Bestätigung, **Erfassung und Einheit beim Speichern**; Migration 0033). Passen Erfassung
  oder Einheit nicht mehr zur Heizperiode (`estimateFits` in hca.ts; beim Warmwasser zählt nur eigene Zähler oder
  Ablesedienst), rechnet die Schätzung nicht: Ohne verwertbare Ablesung gilt die Wohnung als nicht erfasst
  (`heating.estimate-stale`, Stufe `error`), neben vollständiger Ablesung gilt die Ablesung
  (`heating.estimate-stale-unused`, Warnung, Runde 2 N-I1); die Karte zeigt eine veraltete Schätzung immer
  sichtbar mit „Entfernen“ und „Schätzung neu eintragen“. `setUpSelf` nennt solche Schätzungen in
  `estimatesNotice` (Durchsicht von #242, G-I1). Beim Ablesedienst ohne Werte wählt der Vermieter die Einheit
  der Schätzung (Einheiten oder kWh), mit Werten gilt deren Einheit (N-M3). Eine Schätzung gilt für die ganze Heizperiode der Wohnung in der Einheit der
  Erfassung (beim Heizkostenverteiler bewertete Einheiten, ohne Faktor) und tritt in `planSelf` **nur an die
  Stelle des nicht erfassten Verbrauchs**: Ein Nutzer mit gültigen Ablesungen, etwa der
  Vormieter bis zur Zwischenablesung, behält seinen Messwert, denn § 9a Abs. 1 Satz 1 erfasst nur den Verbrauch
  von Nutzern, der nicht ordnungsgemäß erfasst werden kann (Durchsicht von #242, R-I4); die übrigen tragen
  zusammen ihren Anteil nach Gradtagen bzw. Tagen und teilen ihn wie nach § 9b Abs. 3 (Festlegung). Ohne
  behaltenen Wert ersetzt die Schätzung auch abgelesene Zeiten desselben Nutzers; Hinweis, Karte und Druck sagen
  das nur, wenn wirklich ein gemessenes Teilstück ersetzt wird (zwei Stände desselben Geräts im Zeitraum des
  Nutzers, `replacesMeasured`; G-M6, Runde 2 N-I2). Sind alle Ablesungen vollständig, ersetzt die Schätzung alles (Markierung „unbrauchbar“):
  `heating.estimate-complete` ist dann ein Hinweis, der nicht färbt, unbestätigt eine Warnung
  (`heating.estimate-unconfirmed`, R-I7); deckt die Schätzung zwei Stände am selben Tag, warnt
  `heating.estimate-same-day` (G-M7). Weitere Hinweise: `heating.estimate-no-device` (Gerät danach gelöscht,
  die Schätzung zählt weiter), `heating.estimate-below-measured` (Schätzung unter dem abgelesenen Teil des
  Vormieters). Nach einem Kesseltausch steht jeder Hinweis einmal je Linie und Schätzung (zwei Schätzungen derselben
  Wohnung an beiden Anlagen haben je ihre Hinweise, N-M2); abgeschlossen wird weiter je Anlage. Mit Schätzung sind ein fehlender Stand, ein Zählerwechsel ohne Endstand, negativer
  Verbrauch und zwei Stände am selben Tag gedeckt; die Geräte einer geschätzten Wohnung lösen keine Hinweise zu
  fehlenden Zwischenablesungen aus (`liveMetersOf`), stehen aber weiter im Ausweis. Begrenzt eine Ablesung ihres
  Geräts einen behaltenen Messwert, fragt Mietfuchs bei einer fernen Zwischenablesung wie ohne Schätzung
  („Ablesung verwenden“ / „Nach § 9b Abs. 3“, `usableAt` in heating.ts, G-I2). Überschreitet die geschätzte Fläche
  eines Topfs die Grenze `hkv.estimate-threshold` (streng größer, über Produkte verglichen, je Topf, Heizung mit
  der Fläche nach § 7 Abs. 1 Satz 5; die Fläche einer Wohnung zählt ganz, auch wenn nur ein Teil ihrer
  Heizperiode geschätzt ist; beides ist eine **Auslegung von Mietfuchs** und steht so in Hinweis, Dialog, Lexikon
  und Regel), geht der Topf nur nach Fläche, ohne Kürzungsbetrag und ohne `heating.no-consumption` (Auslegung,
  Entwurf 15.1 Nr. 7; für eine Abrechnung nach § 9a Abs. 1 hat der BGH die Kürzung verneint, VIII ZR 373/04
  Leitsatz c). Gelesen werden Schätzungen **über die Linie** wie die Werte eines Ablesedienstes (die eigene geht vor);
  eine Wohnung mit Gerätewechsel mitten in der Heizperiode ist mit Schätzung nicht mehr gemischt
  (`withoutEstimatedSwitches`). Eine Wohnung mit Schätzung oder Werten eines Ablesedienstes wechselt nicht das
  Objekt (`guardUnit`, G-I3). Keine Schätzung für eine Wohnung ohne Gerät (Ausstattungspflicht, 400; beim
  Ablesedienst prüft Mietfuchs keine Geräte) und nie wegen verschiedener Ablesetage; abgeschlossene
  Heizperioden sind gesperrt (409), `dropIfEmpty` lässt eine Heizperiode mit Schätzung stehen. Die Vorschläge
  (`estimateProposals`: Durchschnitt der übrigen erfassten Wohnungen je m², vergleichbare Wohnung je m²,
  Vorperiode) rechnen die Vorperiode neu, nur bei gleich vielen Monaten und gleicher Erfassung, mit eigenem
  Protokoll der Rechtswerte. Die Grenze steht nur mit einer Schätzung im Rechtsstand. Seite Heizkosten: Karte
  „Schätzung (§ 9a)“ ([EstimateCard.tsx](../client/src/components/EstimateCard.tsx), Logik in
  [client/src/estimateForm.ts](../client/src/estimateForm.ts)) mit dem tatsächlichen Flächenanteil vor dem
  Speichern. Die Invariante fuel-invariant hat zwei Varianten „Gerät ausgefallen“ mit vier Wohnungen (30, 20, 25
  und 25 % der Fläche) und Mieterwechsel ((s6): Grenze, Verteilung nur nach Fläche, Wert der Schätzung, der
  Vormieter behält seinen Wert); die Mutationsproben stehen im PR.
- **Pflichtangaben und Ausnahmen** (Heizung PR 14, #99, [server/src/heatingInfo.ts](../server/src/heatingInfo.ts),
  [server/src/db/heatingInfo.ts](../server/src/db/heatingInfo.ts)): **Ausnahme nach § 11, Vereinbarung nach § 2, die
  Bestätigung zur monatlichen Information und die Antwort zum Verbrauchervertrag stehen je Heizperiode** in
  `heating_periods` und gelten ab ihr für die folgenden der Linie, bis eine spätere etwas anderes sagt
  (`heatingRulesOf`; in derselben Heizperiode geht die eigene Anlage vor, `null` heißt geerbt). An der Anlage
  stünden sie zeitlos und wirkten rückwirkend auf offene und abgeschlossene Heizperioden; das war die
  Fehlerklasse der Durchsichten von #239, #241 und #242. In computeSettlement gilt eine Ausnahme je Topf
  (`exemptionScopeOf`, `exemptPot`; ohne Antwort zum Umfang nur die Wärme, ohne zentrales Warmwasser die ganze Anlage): für den ausgenommenen Topf keine
  Kürzung nach § 12 (`noCutFor`, an jeder Stelle mit § 12 Abs. 1 Satz 1, bei der Fernablesbarkeit zählen ganz
  ausgenommene Anlagen nicht mit); sind Wärme und Warmwasser ausgenommen, keine Angaben nach § 6a und keine
  CO₂-Aufteilung ohne vereinbarte Abrechnung (`co2OffByExemption`, § 2 Abs. 7 CO2KostAufG). Ist nur die Wärme
  ausgenommen, teilt Mietfuchs die CO₂-Kosten weiter auf (nach BT-Drs. 20/3172, S. 28 betrifft § 2 Abs. 7 Räume, „in
  denen keine Heizkostenabrechnung durchgeführt wird“; das Warmwasser wird abgerechnet), und **jede Kürzung
  beziffert es dann nur auf den Anteil Warmwasser** (`waterBaseOf`: Kosten des Topfs mal Gewicht, abzüglich des
  CO₂-Abzugs im Topf; bei freien Schlüsseln die Positionen mit Ziel Warmwasser, eine Position für beides ohne
  Betrag), ebenso bei der Fernablesbarkeit und der monatlichen Information nur die Warmwassergeräte (Durchsicht
  von #243). Beim Warmwasser ohne Wärmezähler ist das als Auslegung gekennzeichnet, und der Betrag auf Wärme und
  Warmwasser insgesamt (wie BGH VIII ZR 151/20) steht als Obergrenze dabei. Hat der Messdienst unter voller Ausnahme trotzdem CO₂ abgezogen, bleibt der Abzug zerlegt (der Teil
  der eigenen Wohnung ist privat) und `co2.exempt-deducted` sagt es. Eine Vereinbarung nach
  § 2 (`agreedFor`) wirkt nur, solange das Haus im Zeitraum die Voraussetzung erfüllt (`heatingAgreeable`), und
  hebt nur die Kürzung nach § 12 Abs. 1 Satz 1 auf. „Nach Wohnfläche“ verteilt die eigene Abrechnung ganz nach
  der Fläche (`agreedArea`, Anteil 0, ohne die Grenzen der §§ 7, 8, 10; fehlende Ablesungen und Warmwasseranteil
  sperren dann nicht); „feste Anteile“ kann sie nicht (400 beim
  Speichern, sonst `heating.self-incomplete`). Der Umfang der Angaben folgt dem, was Mietfuchs tatsächlich
  rechnet, nicht der Vereinbarung. Eine Änderung von Umfang oder vereinbarter Abrechnung unter geerbter Ausnahme
  schreibt die Ausnahme in die eigene Zeile; ohne geltende Ausnahme 400. `dryRun` beim Speichern nennt die
  späteren abgeschlossenen Heizperioden, an denen eine Angabe vorbei auf eine offene wirkt; die Karte fragt nach.
  Etagenheizungen haben keine dieser Angaben (§ 1 Abs. 1). Mehr als 70 % nur mit `above_70_agreed` (§ 10), mit
  dem Anteil geerbt, auch über dem Pflichtanteil des § 7 Abs. 1 Satz 2 (Auslegung), nie über 100 %.
  **Die Angaben nach § 6a** rechnet `heatingInfoOf` je Linie und Heizperiode (`Settlement.heating[].info` an der
  Anlage, die am Ende der Heizperiode heizt, mit `tenancyIds`, damit nur deren Mieter den Block gedruckt
  bekommen): Abs. 3 oder Abs. 5 entscheiden die Schlüssel der Positionen, auch bei freien Schlüsseln. **Nr. 4 ist
  nie ein Hausdurchschnitt**: Die Begründung schließt den Vergleich mit den Nutzern desselben Gebäudes aus
  (BR-Drs. 643/21, S. 19, 21); der Vermieter trägt einen Vergleichswert in kWh je m² mit Pflichtquelle ein,
  umgerechnet auf Wohnfläche und Tage des Mieters (Festlegung). Nr. 5: Wärme mal Klimafaktor, Warmwasser
  unbereinigt, der Vorjahreswert aus der neu gerechneten Vorperiode (`prev`); die Klimafaktoren trägt der
  Vermieter mit Quelle ein, denn die des DWD (je Postleitzahl, gleitende zwölf Monate, monatlich neu) bettet
  Mietfuchs nicht ein. Wohnte ein Mieter im Vorjahr noch nicht dort, „bis zu 3 %“ (Auslegung, `heating.info-open`);
  wohnte er dort, aber Mietfuchs kennt seinen Vorjahresverbrauch nicht, fehlt Nr. 5 sicher. **Was fehlt, steht je
  Mieter** (`users[].missing`, die Angaben zur Anlage in `missingCommon`): Kürzen darf der Nutzer, dem die
  Information fehlt. Wo Mietfuchs Nr. 4 nicht rechnen kann (Heizkostenverteiler, Werte des Ablesedienstes,
  Warmwasser allein) oder bei freien Schlüsseln Nr. 4 und 5, bestätigt der Vermieter den beigelegten Vergleich
  des Ablesedienstes mit Quelle (`info_comparison_source`); ohne Bestätigung ist es offen, nicht fehlend. Ist
  der Verbrauch eines Mieters nach § 9a geschätzt, gelten für ihn nur die Mindestangaben nach Abs. 5 (Nr. 2 und 3;
  BR-Drs. 643/21, S. 19 und 22; je Mieter ist Auslegung). Bei Werten des Ablesedienstes deckt die Bestätigung
  auch Nr. 5 (`attachedCoversPrev`). Ohne Position mit dem Teil Erfassung druckt Nr. 1 c keine Zahl (`meteringCents`
  `null`, offen). Jede sicher fehlende Angabe ergibt `heating.info-incomplete` mit 3 % für die betroffenen Mieter
  (ein Kürzungsrecht nach Satz 3, auch mit der monatlichen Information: deren Hinweis nennt die Beträge nicht
  ein zweites Mal; BR-Drs. 643/21, S. 24 f.), nur für Zeiträume ab dem 01.12.2021 (`hkv.settlement-info`). `heating.monthly-info` nur, wenn ein Gerät, das in der
  Heizperiode in Betrieb ist (Ablesungen überdecken sie, `coversPeriod`, oder es hat noch keine), als fernablesbar eingetragen ist oder die Anlage es angibt; ohne Angabe schweigt
  es, denn das Anlegen einer Anlage ändert keinen Hinweis (Entwurf 11.2). Kontaktadressen in
  `shared/heatingInfo.ts`, jährlich prüfen. Seite Heizkosten: Karten „Ausnahmen und Vereinbarungen“
  ([HeatingRulesCard.tsx](../client/src/components/HeatingRulesCard.tsx)) und „Angaben zur Abrechnung (§ 6a)“
  ([HeatingInfoCard.tsx](../client/src/components/HeatingInfoCard.tsx)); Druckblock
  [HeatingInfoBlock.tsx](../client/src/components/HeatingInfoBlock.tsx) mit Balken. Migrationen 0034/0035 (`exemption` mit `chp` für § 11 Abs. 1 Nr. 3 Buchst. b); die
  Invarianten haben je eine Variante „Ausnahme je Heizperiode“ ((x): keine Kürzung und keine Angaben im
  ausgenommenen Topf, keine Zeile außer den CO₂-Abzügen hängt an den Angaben).

**Monatliche Verbrauchsinformation** (Heizung PR 22, #99, [server/src/monthlyInfo.ts](../server/src/monthlyInfo.ts),
Monatsnamen und Lückentexte in [shared/monthlyInfo.ts](../shared/monthlyInfo.ts)): Mietfuchs erstellt sie nur bei
eigener Abrechnung einer zentralen Anlage mit eigenen Zählern (nicht mit Werten des Ablesedienstes) und nur, wenn
ein Gerät einer Wohnung selbst als fernablesbar eingetragen ist; die Angabe an der Anlage allein sagt nicht,
welche Wohnungen. Sonst bleibt der Hinweis von PR 14 („bis zu 3 %“, mit dem Satz, was Mietfuchs braucht).
Verbrauch nur aus Ablesungen **genau** an den Monatsgrenzen (bei Ein- und Auszug am Tag vor dem Einzug bzw. am
Auszugstag), nie interpoliert (§ 6a Abs. 2 Nr. 2 „soweit erhoben“); fehlt einem Gerät einer Größe der Wert, fehlt
die ganze Größe. Vergleiche nur desselben Mietverhältnisses (Begründung: keine Daten anderer Nutzer). Die Geräte
sind die der Linie (Kesseltausch), nur in Betrieb: Ein Gerät gilt als ausgebaut, wenn in derselben Wohnung ein
Nachfolger derselben Größe übernimmt, sonst ist eine fehlende Ablesung eine Lücke. Der Durchschnittsnutzer kommt
als Vergleichswert je Monat mit Quelle (Tabelle `heating_monthly_info`, Migration 0045, an der Anlage, die am
Monatsende heizt, gelesen über die Linie), nie aus dem eigenen Haus (BR-Drs. 643/21, S. 19); der Wert der
Heizperiode (Nr. 4) wird nicht aufgeteilt. Warmwasser in kWh über § 9 Abs. 2 Satz 2 ist eine Auslegung (die
Gleichung gilt der Anlage und enthält die Verluste der Erzeugung) und steht getrennt von der gemessenen Wärme,
ohne Summe und ohne die Faktoren des Satzes 6; die Temperatur ist `heating_periods.dhw_temp_c`. Heizkostenverteiler
ergeben keine kWh. Ist nach § 11 nur die Wärme ausgenommen, zählt nur das Warmwasser. „Mitgeteilt“ je Anlage und
Monat, frühestens am Tag nach dem Monatsende; fällig ist ein Monat ab dem Folgemonat (`asOf`, ohne ihn alle).
`heating.monthly-info` nennt die offenen Monate und je betroffenem Mieter **einmal** 3 % (ein Kürzungsrecht nach
Satz 3, Beträge nicht doppelt neben `heating.info-incomplete`; BR-Drs. 643/21, S. 24 f.), „um 3 %“ für den, dessen
Wohnung ganz fernablesbar ist, sonst „möglich“, und bei gemischter Ausstattung die Einzelfallprüfung
(BR-Drs. 643/21, S. 18); beides und der einzelne fehlende Monat sind als Auslegung benannt. Abgezogen wird
nichts. Karte [MonthlyInfoCard.tsx](../client/src/components/MonthlyInfoCard.tsx) auf der Seite Heizkosten, Blatt
[MonthlyInfoSheet.tsx](../client/src/components/MonthlyInfoSheet.tsx) als Portal an `body`, gedruckt mit
`body.print-monthly-info` ohne `#root`. Die Warmwassertemperatur steht bei verbundenem Warmwasser in der Karte
„Warmwasser“, bei getrenntem in dieser Karte (`saveDhwTemperature` in db/co2.ts, dieselbe Prüfung und Spalte;
ohne sie könnte der Vermieter die genannte Kürzung nicht abwenden). Alle Monate statt nur der Heizperiode
(Vorblatt der BR-Drs. 643/21) und „fällig ab dem 1. des Folgemonats“ stehen als Auslegung bzw. Festlegung im Text.

**Brennstoffvorrat** (Heizung PR 8, #97, #99): Bei Heizöl, Flüssiggas, Pellets, Holz und Kohle
(`STOCK_ENERGIES` in [shared/fuelStock.ts](../shared/fuelStock.ts)) rechnet
[server/src/fuelStock.ts](../server/src/fuelStock.ts) den verbrauchten Brennstoff: Anfangsbestand +
Lieferungen − Endbestand, für Menge, Betrag, kg und CO₂-Kosten. Die acht Spalten des Vorrats stehen an
`heating_periods` (Migrationen 0024, 0025); gelesen und geschrieben in
[server/src/db/fuelStock.ts](../server/src/db/fuelStock.ts). Lieferungen dieser Brennstoffe haben
Lieferdatum und Menge statt Rechnungszeitraum und laufen nicht durch die Abgrenzung von PR 7
(`plantFuel` überspringt sie); ihr Betrag ist Σ der verknüpften Positionen, sonst der an der Lieferung.

- **Bewertung, eine Bewertungsregel:** Die HeizkostenV regelt die Bewertung des Restbestands nicht.
  Verbraucht wird rechnerisch das Älteste zuerst (Kinne/Schach/Bieber-Kinne, BGB § 556 Rn. 121; ebenso
  Minol); der Endbestand besteht aus den jüngsten Teilen und wird zu deren Preisen, kg und CO₂-Kosten
  bewertet, je Teil gerundet (Cent, kg auf das Hundertstel, nicht 0,1 kg wie im Entwurf, weil dessen
  Zahlen zwei Stellen haben). BGH VIII ZR 298/80, auf das Minol sich beruft, betrifft die
  Mindestangaben einer Abrechnung und sagt zur Bewertung nichts.
- **Was weitergegeben wird** (`handover`, Durchsicht von #237): Bucht eine Heizperiode keinen
  Übertrag (freie Schlüssel ohne Brennstoffposition mit Umlageschlüssel, `stockTemplateOf` in
  fuelStock.ts, dieselbe Regel in Schnappschuss und Abrechnung), haben ihre Mieter den Endbestand mit
  den Rechnungen bezahlt; er geht mit 0 € und ohne CO₂-Kosten weiter, die kg bleiben. Ebenso zählt der
  Anfangsbestand der ersten Heizperiode mit Vorrat mit 0 €, wenn er schon umgelegt wurde
  (`heating_periods.opening_already_settled`; ohne Antwort „ja“, wenn die Vorperiode an dieser Anlage
  oder ohne Anlage eine Heizposition **ausdrücklich als Brennstoff** hat (`heatingPart: 'fuel'` oder mit
  Lieferung verknüpft), oder wenn die **positiven** Beträge ihrer Heizpositionen **ohne Kennzeichen**
  zusammen mindestens den Wert des Anfangsbestands erreichen (eine Gutschrift zieht nicht ab): Eine
  Wartung von 250 € erklärt keinen Bestand von 2.000 €, und vorher trug der Vermieter ihn dann still.
  Die Regel steht einmal als `settledByDefault` in fuelStock.ts; Schnappschuss, Abrechnung und Karte
  fragen dort. Die Karte „Vorrat“ belegt „Ja“ nur bei `defaultAlreadySettled: 'default'` vor, sonst
  steht „Bitte wählen …“ und es wird nichts gesendet: Eine Vorbelegung ohne Grund würde beim ersten
  Speichern zur Angabe. Unter der Schwelle und ohne Antwort nennt der Hinweis
  `fuel.opening-check-loose` (Stufe `hint`) die Positionen. „Betrieb“ und „Ablesung“ zählen nie; „abgeschlossen ohne Vorrat“
  allein reicht nicht), Hinweis `fuel.opening-settled` mit „nach Ihrer Angabe“ oder „nach der
  Vorbelegung“. Beruht die Vorbelegung nur auf Positionen ohne Kennzeichen (`defaultLoose`), steht
  statt des Hinweises die Warnung `fuel.opening-settled-assumed`, die die Positionen mit Betrag nennt.
  Ein ausdrückliches „nein“ trotz Brennstoff in der Vorperiode (dieselbe Schwelle) ergibt
  `fuel.opening-not-settled` mit Betrag. Die Auswahl „Teil der Heizkosten“ im Kostenformular führt
  alle Werte des Modells und „ohne Angabe“ (`HEATING_PART_OPTIONS` in costForm.ts). Trägt der
  Vermieter in der Vorperiode einen Endbestand ein, leert das in derselben Transaktion den eigenen
  Anfangsbestand der offenen Folgeperiode, und das Entfernen des Vorrats setzt deren Antwort auf
  „schon umgelegt?“ zurück; sonst lebte ein veralteter Anfangsbestand wieder auf (`saveStock`,
  `removeStock` in db/fuelStock.ts). Eine abgeschlossene Heizperiode, deren Stand
  keinen Vorrat eingefroren hat, gibt ihren Endbestand ebenfalls mit 0 € weiter (`closedWithoutStock`).
  Übernimmt eine Heizperiode einen Bestand mit Wert nicht (Bestandsrechnung fehlt, geht nicht auf oder
  kein Schlüssel), oder ist die Folgeperiode ohne Vorrat abgeschlossen, nennt `fuel.stock-not-taken-over`
  den Betrag, den der Vermieter trägt.
- **Die Kette:** Den Anfangsbestand trägt der Vermieter nur in der ersten Heizperiode mit Vorrat ein;
  jede weitere übernimmt den Endbestand der Vorperiode mit seinen Teilen (der Server lehnt einen
  eigenen ab). `stockChainsOf` in snapshot.ts baut die Kette bis zur ersten abgeschlossenen
  Vorperiode; deren Endbestand ist eingefroren und steht im abgeschlossenen Stand unter
  `heating[].stock.closing`, gelesen über `frozenSettlementOf` (`stockClosings`). Ein Wiederöffnen
  hebt ihn auf.
- **Und rückwärts:** Ist die Folgeperiode abgeschlossen und hat sie den Endbestand übernommen
  (`stockOpenings`), ist ihr eingefrorener Anfangsbestand der Endbestand der Vorperiode
  (`nextFrozenOpening`), und er wird dort als „im Vorrat“ gutgeschrieben, auch wenn die
  Bestandsrechnung nicht mehr aufgeht. Einheit und Endbestand sind gesperrt, sobald die Folgeperiode
  abgeschlossen ist, mit oder ohne Vorrat; hat sie den Bestand übernommen, auch Menge, Einheit und
  Lieferdatum der Lieferungen, ihr Entfernen und das Lösen ihrer Positionen (`stockTakenOverBy` in
  repository.ts); Beträge bleiben änderbar. Ohne diese Regeln änderte die wieder geöffnete Vorperiode,
  was sie weitergibt; die Invariante
  [fuel-stock-invariant.test.ts](../server/test/fuel-stock-invariant.test.ts) prüft die Übergabe je Paar
  von Heizperioden, die Befunde der Durchsicht hält [vorrat-durchsicht.test.ts](../server/test/vorrat-durchsicht.test.ts).
- **Gesperrt** sind Vorrat und Lieferungen einer abgeschlossenen Heizperiode (Lieferdatum dort, auch
  beim Verschieben hinein oder hinaus; die Bezeichnung bleibt änderbar), und der Wechsel des
  Energieträgers, sobald irgendwo ein Vorrat eingetragen ist (409).
- **§ 11 Abs. 2 Satz 2 CO2KostAufG** (`co2.costs-before`, Rechnungsdatum): Brennstoff mit Rechnung vor
  dem 01.01.2023 zählt mit seinen kg, nicht mit seinen CO₂-Kosten; `fuel.before-2023` sagt, dass er die
  Stufe hebt. CO₂-Kosten gibt es nur bei Heizöl, Flüssiggas und Kohle (`CO2_FUELS`): Holz und Pellets
  stehen nicht in Anlage 1 BEHG, für sie gibt es keine Standardwerte nach § 7 Abs. 4 BEHG, und das
  CO2KostAufG gilt nach § 2 Abs. 1 nicht.
- **Messdienst ohne Aufteilung** (`selfAfterService`): E und C aus dem Bestand (Naht N1 zur eigenen
  Aufteilung von PR 7, `OwnFuel` in calc.ts); ohne Bestand keine Aufteilung und `fuel.stock-missing`
  mit 3 % je Mieter statt `co2.service-unsplit`. Wer zum Vorrat nichts erfasst hat, sieht den Hinweis
  von PR 6.
- **Freie Schlüssel** (`manual`): Die Rechnungen bleiben Positionen; zwei Übertragsposten
  `stock:<Anlage>:<Heizperiode>:in|out` („aus dem Vorrat“, „im Vorrat“) laufen mit dem Schlüssel der
  größten Brennstoffposition (sonst der jüngsten der Vorperiode) durch die Verteilung, als Zeilen
  `kind: 'fuelCarry'` über denselben Weg wie die Überträge von PR 7 (`fuelSynthetic`), Gegenzeile beim
  Vermieter `fuelCarry` unter `stock:<Anlage>:<Heizperiode>`. Sie zählen nicht in die Gesamtkosten und
  nicht in die Steuer. Ohne Bestand oder ohne Schlüssel `fuel.manual-by-delivery` und Verteilung nach
  Lieferung wie bisher, die CO₂-Einstufung dann nach den gelieferten kg. Der Hinweis sagt, dass eine
  Abrechnung nach Lieferungen nicht zulässig ist und sich nicht durch die Kürzung ausgleichen lässt (BGH
  VIII ZR 156/11, Leitsätze 1 und 2); im selbstbewohnten Zweifamilienhaus nennt er § 2 Nr. 4a BetrKV.
  Eine Brennstoffposition ohne Lieferung neben dem Vorrat meldet `fuel.stock-unlinked`, und die
  CO₂-Aufteilung gilt dann als unvollständig. Die Kürzung nach § 12 Abs. 1 HeizkostenV rechnet auf den
  Anteil samt Übertrag.
- **Steuer nach Bezahltem:** Der Eigenanteil der Abrechnung enthält den Anteil am Übertrag, die
  Steuerübersicht nicht; `TaxReport.expenses.stockCarrySelfCents` nennt den Abstand, die Steuerseite
  erklärt ihn (N8).
- **Peildatum:** gerechnet wird mit dem Wert wie gepeilt; `fuel.stock-date-differs` nennt Tage,
  Gradtagsanteil und Lieferungen dazwischen.
- `fuel.stock-missing` ist eine Warnung; den Fehler bei der eigenen Heizkostenabrechnung bringt PR 10
  mit eigenem Code, denn eine Stufe hängt am Code.

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
  Abrechnung zählt** (Storno und abgedeckte Schätzung über `cancelledDeliveries`/`estimateFactors`,
  Rechnung vor 2023 nur mit kg), jede nicht zählende Zeile trägt einen Vermerk, nummeriert unter der
  Tabelle (`sheetNotes`). Dritte Person; „Bitte prüfen“ ist `no-print`.
- Ob das CO2KostAufG gilt und die Befunde je Rechnung stehen in `heating[].co2Check`; die Regel zur
  Ausnahme nach § 11 / § 2 Abs. 7 einmal in [server/src/co2Exemption.ts](../server/src/co2Exemption.ts)
  (`co2OffByExemptionOf`, `exemptionText`). Steht eine Heizperiode in keiner Abrechnung, fragt das
  Blatt `heatingRulesOf` selbst.

## Betriebsstrom der Heizung (#212, #224, #252, #253, #266)

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
