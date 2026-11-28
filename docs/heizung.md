# Heizung: Entwicklerdoku

Wer an der Heizung arbeitet (Heizanlage, Heizperiode, CO₂, Lieferungen, Vorrat, eigene
Heizkostenabrechnung, § 6a, § 9a, Betriebsstrom), liest diese Datei zuerst. Gesamtentwurf:
`docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (Verweise wie „15.1 Nr. 2“ oder
„G-A2“ meinen Abschnitte dort). Rechtswerte stehen im Rechtsregister (server/src/CLAUDE.md).

**Freie Schlüssel, ganz nach Zählern** (Systemprüfung): Laufen alle Heizpositionen einer Wohnung nach Zählern, ohne
Grundkosten nach Fläche, meldet `heating.all-by-consumption` (hint, ohne Betrag) den Höchstsatz des § 7 Abs. 1 Satz 1
und dass ein höherer Anteil nur mit einer rechtsgeschäftlichen Bestimmung bleibt (§ 10 HeizkostenV; das Modell kennt
bei freien Schlüsseln keine, der Hinweis sagt deshalb, dass sie vorgeht). **Eigener Code, der das Cockpit nicht färbt**
(`INFORMATIONAL`): Im rechtmäßigen Fall ließe er sich nie abstellen; der Mischfall `heating.consumption-share` färbt
weiter und nennt über dem Höchstsatz ebenfalls § 10. Kein Kürzungsbetrag: § 12 Abs. 1 Satz 1 verlangt, dass „nicht
verbrauchsabhängig“ abgerechnet wird. **Er schweigt**, wo die Verordnung nicht erkennbar gilt oder niemand abgerechnet
wird: Wohnung nicht nach Verbrauch gedeckt, nur eine Wohnung in der Gruppe, Zähler, die weder Wärme noch Warmwasser
erfassen (`HEAT_CAPTURE` in shared/heating.ts: Strom, Sonstiges, Kaltwasser), und Positionen, die nur Mieter tragen,
die selbst heizen, oder niemand (Warmmiete, Pauschale; `bearersOf` in calc.ts). Er sagt bedingt, dass enthaltenes
Warmwasser abzutrennen ist (§ 8 Abs. 1, § 9 Abs. 1), außer eine Position nach Warmwasserzählern steht daneben; ob eine
Position Warmwasser enthält, weiß Mietfuchs bei freien Schlüsseln nicht.

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
- **Die laufende Heizperiode ist erreichbar** (#690, `runningHeatingPeriod`): Liegt heute im gewählten Zeitraum P und
  endet die Heizperiode von heute erst nach P (Kalenderjahr, Heizung Juli bis Juni, heute im November), liefert
  `heatingPeriodViews` sie zusätzlich (`current`), das Kostenformular bietet sie zusätzlich an (`heatingItemPeriods` mit
  `today`, Vorgabe bleibt die endende; endet in einem Rumpfzeitraum keine, ist die laufende die einzige Wahl und damit
  vorgewählt), und die Seite Kosten zeigt ihre Positionen mit Vermerk, ohne sie in die Summe
  des Zeitraums zu zählen. Das ist nur der Zugang zum Erfassen (Kosten, Lieferungen, monatliche Verbrauchsinformation
  nach § 6a Abs. 1 HeizkostenV); abgerechnet wird unverändert dort, wo sie endet. Der Ausweis der eigenen
  Heizkostenabrechnung (Ablesungen, Verteilung) kommt aus der Abrechnung des gewählten Zeitraums und fehlt für sie,
  bis der Zeitraum wählbar ist, in dem sie endet.
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
- **H = P: nur die Vorauszahlung aufteilen** (#704): Rechnet die Anlage im Zeitraum des Objekts ab, gibt es keine
  getrennte Abrechnung, nur zwei Staffeln in einer Abrechnung (`way: 'samePeriod'`, ohne Spanne). Ohne gewählten Monat
  schlägt `planOn` dabei den Beginn des Zeitraums vor dem laufenden vor, solange er nicht abgeschlossen ist und es darin
  ein Mietverhältnis gab (meist wird gerade er abgerechnet); mit eigener Heizperiode den laufenden Zeitraum. **Die Knöpfe der Karte
  „Heizung“ folgen dem, was der Server annimmt** (`separateActions` in client/src/heatingPeriodForm.ts), nicht dem
  Rhythmus allein: mit offener Spanne nur „Getrennte Heizkostenabrechnung ausschalten“ (mit `until`), sonst „Vorauszahlung
  aufteilen“ (wie das Objekt, nicht nach einem Kesseltausch, den `planOn` ablehnt) bzw. „… einschalten“ (eigene
  Heizperiode), und sobald ohne Spanne aufgeteilt ist (`separateSettlement`), „Vorauszahlung wieder zusammenführen“ (mit
  `month`, `separateOffBody`), auch nach einem späteren Wechsel auf eine eigene Heizperiode. Vorher hing der Knopf an
  der gespeicherten Antwort, die bei gleichem Zeitraum niemand erfragte. Erneut aufteilen geht (Mietverhältnis ohne
  Heizstaffel); eine schon geteilte Stufe behält ihren Heizanteil als Vorschlag; wessen Heizkosten nicht über
  Vorauszahlungen laufen (Pauschale, Inklusivmiete, Mieter heizt selbst: `settlesHeating` in shared/heatingModel.ts, eine
  Stelle für Vorschlag, Hinweis und den Satz am Mietverhältnis), ist mit 0 vorbelegt, und eine Stufe, die nur den Betrag davor wiederholt, wird bei H = P nicht geschrieben (`compact`).
  Zusammenführen führt bei H = P immer zusammen (`merge` gilt dort nicht als Wahl). **Eine Jahreskorrektur kennt keine
  Aufteilung** (`computePrepaymentCents`): Mit ihr weist die Abrechnung die Heizvorauszahlung nicht getrennt aus, und
  `prepayment.heating-share-missing` schweigt dann, ebenso ohne `settlesHeating`. Beim Zusammenführen (auch Weg d)
  entscheidet über die abschließende 0-Stufe der Heizstaffel nur, was **vor** dem Monat galt (`rate(before, …)`): Die
  Stufe im Monat selbst fällt weg, und eine 0 dort ließ sonst den früheren Heizbetrag wieder aufleben. Am Mietverhältnis nennt ein
  Satz unter der NK-Vorauszahlung den Weg (`prepaymentSplitHint`), nur ohne Heizstaffel und nur, wo es ihn gibt.
- **Anpassung je Teil** (#704 Teil 2), nur in einer Abrechnung, deren Vorschlag die Heizung enthält (keine
  Heizkostenabrechnung, nichts getrennt abgerechnet), und nur bei einem Mietverhältnis mit Heizstaffel:
  `Statement.suggestedHeatingMonthlyCents` ist der Teil von `suggestedMonthlyCents` aus den Heizzeilen (Kostenart
  „Heizung und Warmwasser“ samt Abzugszeilen), mit denselben Faktoren und Tagen, auf volle Euro, nie über dem Vorschlag;
  **die Summe bleibt der bisherige Vorschlag**, der Rest gilt den übrigen Nebenkosten. Das Anschreiben nennt die Teile
  über den Platzhalter `{Aufteilung}` (shared/letter.ts: `splitOf`, `splitSentence`; leer ohne Aufteilung, die Vorgaben
  bleiben dann wortgleich) und friert `adjustment.heatingCents` ein. Beim eigenen Betrag gilt nur ein eigener Teil
  (`tenancy_letter_adjustments.heating_cents`, Schritt 0105; nie ein gerechneter), ohne ihn nennt der Brief keine Teile.
  **Brief, Übersicht und Übernahme sagen dasselbe**: Teile gibt es nur, wenn im Monat der Anpassung eine Heizvorauszahlung
  über 0 gilt (`splitOf`, dieselbe Frage wie `planPrepaymentSteps`), wenn der Text der gewählten Anpassung `{Aufteilung}`
  enthält (`buildLetter`; ein eigener Text ohne den Platzhalter nennt und friert keine Teile ein, das Fenster weist darauf
  hin) und wenn der Teil des Vorschlags über 0 und unter dem Vorschlag liegt (ohne Heizkosten beim Mieter oder ohne Rest für
  die übrigen Nebenkosten fehlt das Feld; „0 €“ für einen Teil wäre geraten und setzte seine Staffel bei der Übernahme auf
  0). **Zwei Anlagen im Objekt**: Ob der Vorschlag „ohne Heizung“ gilt, entscheidet die Abrechnung, nicht das
  Mietverhältnis (`suggestionWithoutHeating`, sobald eine Anlage getrennt abrechnet). Hängt eine Wohnung an einer anderen,
  aufgeteilten Anlage, enthält ihr Betrag die eigene Heizung, heißt im Brief aber „ohne Heizung“ (bekannte Grenze, schon
  vor #704); die Übernahme sperrt dann, statt den Betrag neben die Heizstaffel zu schreiben (`planPrepaymentSteps`,
  `heatingSeparateAt(month, tenancyId)`). Ein Speichern der eigenen Anpassung ohne `heatingCents`
  (ein Tab von vor dem Update) entfernt den gespeicherten Teil: Der Brief nennt dann keine Teile, die Übernahme sperrt
  wieder, nichts wird geraten.
  Gleiche Summe mit anderen Teilen ist eine Anpassung. „In die Staffel übernehmen“ (server/src/prepaymentSteps.ts)
  schreibt mit Teilen beide Staffeln in **einem** Vorgang je Mietverhältnis (`PrepaymentStepItem.heating`; `cents` ist dann
  der Teil der übrigen Nebenkosten); ohne Teile bleibt es bei zwei Staffeln gesperrt. Dass sich die Anpassung nach den
  Kosten je Teil richtet, ist eine Rechnung von Mietfuchs: § 560 Abs. 4 BGB nennt nur „eine Anpassung auf eine angemessene
  Höhe“ und keine Aufteilung.
- **Was die zweite Vorauszahlung deckt** (#712): Voreinstellung ist die Kostenart „Heizung und Warmwasser“. An der Anlage
  lässt sich wählen, dass sie auch „Wasser/Abwasser“ deckt (`secondPrepaymentCoversWater`, Spalte
  `second_prepayment_covers_water`, Schritt 0106, Voreinstellung 0), also was der Messdienst oft mit abrechnet. **Keine
  Summe ändert sich** (Gesamtkosten, Zeilen, angerechnete Vorauszahlungen, Saldo, `suggestedMonthlyCents`), nur zweierlei:
  `suggestedHeatingMonthlyCents` zählt auch die Zeilen der Kostenart „Wasser/Abwasser“ (`heatingRow` in calc.ts), und der
  zweite Teil heißt überall „Heizung, Warmwasser und Wasser/Abwasser“. **Die Bezeichnung hat eine Stelle**,
  `secondPrepaymentLabel` in shared/heatingModel.ts (Formen `costs`, `prepayment`, `short`): gedruckte Abrechnung
  (`prepaymentSplit`), Satz `{Aufteilung}` (`splitSentence`), Fenster „Anschreiben bearbeiten“, Übersicht, Karte und
  Rückfrage der Übernahme, Meldungen zum eigenen Teil. **Gewirkt wird nur in einer gemeinsamen Abrechnung** (`coversWater`
  in calc.ts): Die Anlage, die die Wohnung versorgt (nach einem Kesseltausch die am Ende des Zeitraums heizende; die Angabe selbst
  liest `coversWater` von der laufenden Anlage, denn nur an ihr lässt sie sich wählen), rechnet
  im Zeitraum des Objekts ab, kein Monat des Zeitraums und nicht der danach gehört einer getrennt abgerechneten
  Heizperiode, und das Mietverhältnis führt eine Heizstaffel. Eine Heizkostenabrechnung je Heizperiode (Weg d) rechnet nur
  Heizung und Warmwasser ab und bleibt wortgleich; der Server lehnt das Setzen an einer Anlage mit eigener Heizperiode
  oder offener Spanne mit Satz ab (`SECOND_PREPAYMENT_OWN_PERIOD`), eine schon gesetzte Angabe bleibt stehen und wirkt
  dann nicht. **Eingefroren wird die Angabe mit dem Stand**: `Statement.secondPrepaymentCoversWater` (nur `true`) und am
  Schreiben `adjustment.coversWater` neben `heatingCents`; eine abgeschlossene Abrechnung, ihre Übersicht, die Übernahme
  (`StepLetter.coversWater`, `PrepaymentStepItem.heating.coversWater`) und der Export behalten so ihren Wortlaut, wenn die
  Angabe später geändert wird. Die Auswahl „Was deckt die zweite Vorauszahlung?“ steht im Abschnitt „Zeitraum der
  Heizung“ (`SecondPrepaymentField`, `secondPrepaymentState` in client/src/heatingPeriodForm.ts) nur bei aufgeteilter
  Vorauszahlung im Zeitraum des Objekts, als Entwurf; bei eigener Heizperiode steht der Satz, warum es sie nicht gibt.
  **Mietfuchs verschiebt keine Beträge zwischen den Staffeln**, das sagt der Satz unter der Auswahl. Der Kesseltausch
  übernimmt die Angabe. Fundstellen (nur im Lexikon und in der Anleitung zum Messdienst): BGH, Urteil vom 26.10.2011,
  VIII ZR 268/10, Rn. 11 (die Zuordnung von Kaltwasser und Entwässerung ändert die Summe nicht; ob getrennt ausgewiesene
  Vorauszahlungen auf Abrechnungskreise festlegen, bleibt offen) und BGH, Urteil vom 28.09.2011, VIII ZR 294/10, Rn. 26
  (Erhöhung wegen einer Kostenart nur bei deren Vorauszahlung oder nur anteilig). Tests: calc-zweite-vorauszahlung-wasser.test.ts
  (Beispiele und Invariante über Zufallsbestände), api-zweite-vorauszahlung-wasser.test.ts, db-heizanlage.test.ts.
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
  (nur ausgewiesen), `selfAfterService` (nicht aufgeteilt); nach „Abzugszeile“ wahlweise `serviceEnclosed` (Angaben nicht
  eingetragen, die Abrechnung des Messdienstes liegt bei, #704, siehe unten); bei freien Schlüsseln `self`.
- **S ist die gedruckte Kostensumme**, nicht die Summe gerundeter Nutzerzeilen. Die Probe läuft über
  die Messdienstpositionen (`amounts`): Vorwegabzug Σ = S + L ± 1 ct, nur ausgewiesen Σ = S, Einzel-
  und Eigenbeträge ≤ S + NE · 2 ct. **Scheitert sie, wird nichts gebucht** (`co2.sum-check`, error);
  mit „Ich finde diese Zeile nicht“ ist S geschätzt (`co2.sum-check-approx`), und scheitert die Probe
  dann, wird ebenso nichts gebucht.
  Fehlt im Topf jede Messdienstposition (Heizkosten z. B. nach Fläche oder Zähler verteilt), nennt
  `co2.sum-check` statt „0,00 €“ den Grund und die Positionen mit ihrem Schlüssel, und die Hinweise
  `co2.pool-foreign-item` entfallen; die Probe im Formular sagt dasselbe.
- **Vorwegabzug**: In der Position, in der L steckt (`carrierId`), steht L_self exakt in `selfUse`
  (nie über `take()`), der Rest von L als Grund `co2Share` dahinter; die Mieter zahlen ihre
  Einzelbeträge unverändert (#209: Werbungskosten sind das Bezahlte, L_self privat). Kappt `take()`,
  sagt es `co2.share-capped`.
- **Nur ausgewiesen**: Zeilen `kind: 'co2Relief'` ohne Position (`co2:<Anlage>:<Heizperiode>`), je
  Mieter laut Messdienst oder L · x / S, eine Verteilung von R mit `distributeCents`, der Vermieter
  trägt R als `co2Share`. Σ aller Zeilen bleibt Σ der Positionen.
- **Sammelbetrag und „liegt bei“** (#704): Rechnet der Messdienst Heizung, Warmwasser, Kaltwasser und Abwasser in einem
  Betrag je Nutzer ab, trägt die Position (nur „Heizung und Warmwasser“ mit Schlüssel `amounts`, `allowsIncludesWater`
  in [shared/includesWater.ts](../shared/includesWater.ts); an jeder anderen fällt die Angabe beim Speichern still weg)
  den Haken `includesWater` (`cost_items.includes_water`, Schritt 0108). **Er ändert keine Zahl**, nur Bezeichnung und
  Hinweise: Die Zeilen tragen `includesWater: true` (auch eingefroren), gedruckt wird die Kostenart über
  `categoryLabelOf` mit Zusatz (Abrechnung des Mieters, Aufstellung des Vermieters, CSV; im JSON-Export bleibt `category`
  der Datenwert, daneben `includesWater`); die Prüfung nach der Heizkostenverordnung behandelt die Position wie jede mit
  Einzelbeträgen. Ein Kürzungsbetrag auf eine solche Zeile steht als „höchstens“ (oder beim schon vorhandenen „bis zu“
  ohne Zusatzwort) mit dem Grund: Die Kürzung gilt dem Anteil an den Heizkosten, und den Heizanteil des Sammelbetrags
  kennt Mietfuchs nicht. Das macht eine Stelle, `cutList` in `computeSettlement`, für jede Liste von Kürzungsbeträgen je
  Mieter (`cutsOn`, `waterCutsOn`, § 12 Abs. 1 Satz 2 und 3 HeizkostenV, Verteilung nicht nach Verbrauch); bei einem
  Mieter heißt der Grund „darin auch Kaltwasser und Abwasser …“. Ohne Haken bleibt jeder Wortlaut zeichengleich.
  Nicht darunter fällt die Gutschrift bei `fuel.estimate-overcharged` (keine Kürzung, Lieferzeilen).
  - **`serviceEnclosed` gibt es nur beim Vorwegabzug** (Durchsicht M1). Die Frage nach der Abzugszeile behält ihre drei
    Antworten; nur nach „Ja, es gibt eine Abzugszeile“ folgt die zweite Wahl (`Co2Form.entry`, `showsEntry`): „Angaben
    aus der Abrechnung hier eintragen …“ (`serviceDeducted`, Voreinstellung) oder „Nicht eintragen: Die
    Heizkostenabrechnung des Messdienstes liegt jeder Abrechnung bei“ (`serviceEnclosed`; Beschriftungen in
    shared/co2Probe.ts). Bei „nur ausgewiesen“ enthalten die Beträge je Mieter den Anteil des Vermieters; ohne Buchung
    trügen die Mieter ihn mit, deshalb bietet die Karte die Wahl dort nicht an, und Karte wie Hinweis nennen die
    Voraussetzung (`enclosedCondition`). **Der Server kennt nur die Methode** und kann nicht prüfen, ob die Abrechnung
    wirklich eine Abzugszeile hat; das ist eine Angabe des Vermieters. Ein Sammelbetrag passt deshalb nur zum Vorwegabzug:
    Bei „nur ausgewiesen“ sagen Karte (`includesWaterNote`), `co2.sum-check` und der Haken, dass Heizung/Warmwasser und
    Wasser als getrennte Positionen zu erfassen sind.
  - **Wirkung**: keine Probe (`co2PotsOf` rechnet sie nur für die beiden Antworten mit Zahlen), keine Nachstufung, keine
    Buchung, kein `co2.missing`, `co2.sum-check`, `co2.service-unsplit`, `co2.incomplete`; statt dessen einmal je Topf
    `co2.service-enclosed` (hint, `INFORMATIONAL`, nur mit `settledOn`): Voraussetzung, Beilage, die Pflicht des
    Vermieters nach § 7 Abs. 3 mit der Kürzung nach Abs. 4 und dem Satz, dass nicht entschieden ist, ob der Verweis auf
    die beiliegende Abrechnung genügt. Ohne CO₂-Kosten (`co2Required` falsch, Energieträger nicht „Sonstiges“) gibt es
    weder Hinweis noch Ausweis, und die Karte bietet die Wahl nicht an (`offersEnclosed`). Der Ausweis ist `co2` mit
    `method: 'serviceEnclosed'`, `booked: false`, leeren Zahlen, `enclosedFor` (die Mietverhältnisse mit einer Zeile aus
    den Messdienstpositionen, `sharesOf`) und `enclosedBy` für die Eigentumswohnung; `co2Block` druckt dafür statt des
    Blocks einen Satz, der auf die beiliegende Heizkostenabrechnung verweist (`reference`).
  - **Was von den Angaben der Karte bleibt**: Die Karte schickt nur `{ method }`; früher eingetragene Werte bleiben
    gespeichert. Gelesen wird davon bei `serviceEnclosed` genau einer, **der Ausstoß** (`serviceEmissionsKg`), und nur für
    die gemeinsame Einstufung mit einer Anlage im selben Gebäude oder derselben Linie (`contributionOf`). Hat die Anlage
    eine solche Partnerin, die in der Heizperiode der Ansicht heizt und selbst eine CO₂-Einstufung braucht (`joint`,
    `classifiedJointly` in client/src/co2Form.ts: `sameLine`/`sameBuilding`, `plantSpan`, `asksCo2Facts`; nach einem
    Kesseltausch also nur in der Heizperiode des Tauschs), zeigt die Karte bei „liegt bei“ dieses eine Feld
    (`CO2_ENCLOSED_JOINT`) und schickt es mit; `co2.classification-incomplete` nennt es dann. Die Fläche der Einstufung kommt bei einer Anlage mit
    Messdienst aus den versorgten Wohnungen, ein Feld dafür gibt es deshalb nicht.
  - **Steuer**: Den vorab abgezogenen CO₂-Anteil des Vermieters kennt Mietfuchs so nicht als eigenen Posten (kein
    `co2Share`, L_self nicht getrennt); wer ihn als Werbungskosten will, nimmt als Betrag der Position die Summe aller
    Nutzer plus diesen Anteil, er steht dann als Rest der Einzelbeträge beim Vermieter. **Bewohnt der Vermieter selbst
    eine Wohnung, gehört ihr Teil des Anteils in ihren Eigenbetrag** (sonst stünde er zu viel in den Werbungskosten);
    Karte, Lexikon und Anleitung sagen es immer (`ENCLOSED_SELF_USED`), der Hinweis nur, wenn im Topf ein Eigenbetrag
    steht. Mit beidem ergibt die Steuerübersicht dasselbe wie die Abzugszeile mit Angaben (Test).
  - **Rechtslage der Sammelzeile (gelesen am 27.11.2026)**, Volltexte auf bundesgerichtshof.de; behauptet wird nur das,
    mit diesen Fundstellen (Konstanten `COMBINED_LINE_*` in shared/includesWater.ts): Eine Betriebskostenabrechnung
    stellt die Kosten getrennt nach Kostenarten zusammen; zusammenfassen darf sie nur, was sachlich eng zusammenhängt, so
    Frisch- und Abwasser bei einheitlicher Umlage (BGH, Urteil vom 15.07.2009, VIII ZR 340/08, Rn. 19). Eine unzulässige
    Zusammenfassung ist ein formeller Mangel der Position (BGH, Urteil vom 22.09.2010, VIII ZR 285/09, Rn. 40 bis 42),
    nach Ablauf der Abrechnungsfrist nicht mehr heilbar (BGH, Urteil vom 14.02.2007, VIII ZR 1/06, Rn. 11, 12). Einzeln
    ausgewiesene Kosten für Kaltwasser und Entwässerung dürfen in der Heizkostenabrechnung stehen (BGH, Urteil vom
    26.10.2011, VIII ZR 268/10, Rn. 11). Ob die Aufschlüsselung in einer beigelegten Abrechnung genügt, ist für diesen
    Fall nicht entschieden: „gegebenenfalls auch in einer Anlage“ (BGH, Beschluss vom 06.07.2021, VIII ZR 371/19,
    Rn. 14) gegen einen mitgeschickten Bescheid, der nicht half (BGH, Beschluss vom 24.01.2017, VIII ZR 285/15, Rn. 5
    bis 7); beides Beschlüsse, so zitiert. **Folge**: keine Sperre (Zielbild: angreifbar heißt unterstützt, mit Warnung
    und Betrag), sondern `amounts.combined-line` (warning, färbt das Cockpit, weil getrennte Positionen sie abstellen):
    je Position mit Haken einmal, mit den Mietern und dem Betrag ihrer Zeile als „Nachforderung von bis zu“; ohne Mieter
    mit Zeile kein Hinweis. Zu den Vorauszahlungen (BGH, Urteil vom 22.09.2010, VIII ZR 285/09): Nach Ende des
    Mietverhältnisses kann der Mieter Vorauszahlungen zurückfordern, solange keine formell ordnungsgemäße Abrechnung
    vorliegt (Rn. 38); ein ausgezogener Mieter kann also die Vorauszahlungen auf diese Position vorläufig zurückverlangen.
    Der Anspruch ist vorläufig: Der Vermieter kann ordnungsgemäß nachabrechnen, endgültig ausgeschlossen ist er nur mit
    Nachzahlungsansprüchen (Rn. 44). Endgültig verloren ist deshalb nur die Nachforderung; „Vorauszahlungen sind nicht
    berührt“ wäre zu absolut. Den vollen Zeilenbetrag nennt `amounts.combined-line` als „bis zu“, obwohl verloren nur
    die Nachforderung ist: Mietfuchs kennt den Teil der Vorauszahlungen, der auf die Zeile entfällt, nicht, und bei einem
    ausgezogenen Mieter steht wegen Rn. 38 vorläufig auch die Vorauszahlung im Raum; als Obergrenze ist der volle
    Betrag deshalb vertretbar. Bei einer Eigentumswohnung sagt der Hinweis „Abrechnung der Gemeinschaft“. Haken
    (`INCLUDES_WATER_HELP`, erst mit gesetztem Haken; ohne ihn nur `INCLUDES_WATER_WHEN` und der Lexikonlink), Lexikon
    („Sammelzeile“, `combinedLine`) und Anleitung sagen denselben Satz (`COMBINED_LINE_RISK`). Die gedruckte Abrechnung des Mieters sagt dazu nichts.
  - **Doppelerfassung**: Hat ein Mieter in derselben Abrechnung eine Zeile mit `includesWater` und eine der Kostenart
    „Wasser/Abwasser“, warnt `amounts.water-twice` (warning) an der Wasserposition, gefragt an den gedruckten Zeilen nach
    dem Zusammenführen (Weg b). Der Rat heißt „gar nicht als eigene Position erfassen“, nie „Nicht umlagefähig“: Dort
    stünde das Wasser ein zweites Mal in den Werbungskosten. Das Kostenformular sagt denselben Satz (`waterTwiceText`) für
    jede Wasserposition des Zeitraums, weil es die Verteilung nicht kennt. **Bekannte Grenzen**: Ist die zweite Position
    berechtigt (Wasser einer Wohnung, die der Messdienst nicht abrechnet, Gartenwasser), bleibt die Warnung jedes Jahr
    stehen, eine Bestätigung gibt es nicht; und bei Weg d steht die Heizperiode in einer eigenen Abrechnung, dort warnt
    nichts.
  - Die KI-Auslesung der Messdienstabrechnung kennt weder Haken noch „liegt bei“. Tests:
    calc-messdienst-sammelbetrag.test.ts (mit Invariante und den Befunden der Durchsicht),
    api-messdienst-sammelbetrag.test.ts, client/src/sammelbetrag.test.tsx.
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
- **Lieferung ohne Position** (#722, `fuel.delivery-unlinked`, warning, Ziel Heizkosten): Zeigt keine Position auf eine
  Lieferung, die die Heizperiode berührt (auch keine aus einem anderen Zeitraum), kennt Mietfuchs ihren Betrag nicht. Die
  Positionen werden trotzdem verteilt, ganz in ihrem Zeitraum; der Hinweis nennt die Lieferungen und die Positionen, die
  in Frage kommen (Heizpositionen der Anlage ohne Lieferung, Teil Brennstoff oder ohne Angabe). **Zugeordnet wird nie von
  selbst**, auch nicht bei einer Lieferung und einer Position: Die Verknüpfung grenzt ab und verschiebt Geld zwischen
  Heizperioden, und ob die Position ein Abschlag einer anderen Rechnung ist, weiß nur der Vermieter. **Endet die Lieferung
  in einer späteren Heizperiode**, nennt der Hinweis diese und dass dort zu verknüpfen ist (nur dort zeigt die Karte
  „Lieferungen“ sie, `guardFuelLink`); den Teil für diese Heizperiode bucht danach der Übertrag `fuelCarry`. Ein Rat zum
  Erfassen stünde dort falsch (Durchsicht M1: eine zweite Position, ganz verteilt). Ohne Kandidatin warnt der Satz davor,
  eine schon in einem anderen Zeitraum erfasste Rechnung ein zweites Mal zu erfassen (S3; den Zeitraum einer Position
  ändert das Kostenformular nicht). Ab zwei Anlagen ist eine Brennstoffposition ohne Anlage Kandidatin mit dem Schritt,
  sie im Kostenformular der Anlage zuzuordnen, denn die Verknüpfung zeigt nur Positionen der Anlage (S4). Nicht beim Messdienst
  (der Betrag steht an der Lieferung), nicht bei einer Schätzung, nicht beim Vorrat (dort `fuel.stock-unlinked`). Der
  Druckblock „Brennstoff“ nennt eine Lieferung mit Betrag 0 ohne „= … von …“ (client/src/fuelView.ts, an der Zahl
  entschieden, damit es auch für eingefrorene Stände gilt).
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
  `ends_on` (letzter Betriebstag), neue `replaces_plant_id`, Name und Wohnungen (ohne Liste bleibt es
  ohne Liste, Werte über `basisValues`; Integrationsdurchsicht 0.13.0: Eine Linie allein darf ohne Liste
  stehen, `guardPlantsOfProperty`, `heatingPlantViolations`; für Bestände mit fester Liste vom Tausch
  warnt `heating.unit-unserved`, nur bei `method = 'self'` in einer Linie mit Tausch, denn nur dort verteilt die Liste Geld); Rhythmus,
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
- **Ob eine Position den Schlüssel nach HeizkostenV trägt, entscheidet ihre Heizperiode** (`selfActive` in
  shared/heatingPeriod.ts, gefragt vom Server in `guardHeatingSystem` und seit #690 ebenso vom Kostenformular): vor dem
  Beginn der eigenen Abrechnung die freien Schlüssel, ab ihrem Beginn nur „nach Heizkostenverordnung“. Die Heizperiode
  dazu wählt im Formular eine Stelle (`chosenHeatingPeriod` in client/src/heatingSettlementView.ts), auch für die Frage
  beim Schornsteinfeger (`chimneySweepPlants`, #724). Was das Formular selbst gesetzt hat (Schlüssel, einziges Ziel, auch
  der Schlüssel aus „Auf „Heizung und Warmwasser“ umstellen“), nimmt `settleSelfKey` zurück, sobald die gewählte
  Heizperiode wieder eine mit freien Schlüsseln ist.
- **Umgestellt wird nur über die Einrichtung** (`PUT /api/heating-plants/:id/self`,
  [db/heatingSelf.ts](../server/src/db/heatingSelf.ts)): Anlage, Anteil, Zähler und Positionen offener
  Zeiträume in einer Transaktion; fehlen Teil und Ziel, 409 mit Liste. Zurück auf „Niemand“ verlangt
  `convertItems: 'area'` (die Rückfrage nennt, was entfällt) und nimmt aus offenen Heizperioden mit, was die Einrichtung eintrug (Anteile,
  `above_70_agreed`, das automatische `dhw_method = 'heatMeter'` ohne eigene Warmwasserangaben; danach `dropIfEmpty`),
  sonst sperrte die Zeile den Wechsel des Zeitraums der Heizung. Der Zeitraum gehört **vor** die eigene Abrechnung
  (`SELF_PERIOD_FIRST` im Fenster); die Ablehnung in heatingPeriodChange.ts nennt den Weg über „Niemand“. Bei Heizkostenverteilern und Ablesedienst werden keine Wärmezähler angelegt.
- **Zeiträume der eigenen Abrechnung** stehen in `heating_self_spans` (von, bis ausschließlich), mit
  **Erfassung und Warmwasserbereitung** je Spanne (`captureOf`, `hotWaterOf`). Die Einrichtung öffnet
  einen Zeitraum nie vor oder in einer abgeschlossenen Heizperiode; das Zurückschalten schließt ihn
  (lehnt ab, wenn eine abgeschlossene hinter einer offenen läge). Gerechnet wird je Heizperiode
  (`selfActive`, `selfAt`), denn § 6 Abs. 4 erlaubt die Wahl nur für künftige Zeiträume; eine andere
  Erfassung gilt ab dem Beginn einer schon begonnenen Heizperiode (Tatsache, kein Maßstab), der Anteil
  nach Verbrauch bleibt geschützt (`checkShares`). `PUT` an der Anlage ändert Erfassung und Warmwasser
  bei eigener Abrechnung nicht.
- **Nur die Erfassung ändern** (#690): `PUT …/self` mit `{ period, capture, captureOnly: true }`, in der Karte „Heizung“
  der Knopf „Erfassung ändern“ ([HeatingCaptureChange.tsx](../client/src/components/HeatingCaptureChange.tsx)). Nur wo die
  eigene Abrechnung in der Heizperiode schon gilt (sonst 400). Die Spannen entstehen wie bei der erneuten Einrichtung
  (Berichtigung, wenn die laufende Spanne mit dieser Heizperiode beginnt, sonst eine neue ab ihr); Warmwasserbereitung,
  Maßstab, Werte je Wohnung, **die Zeile der Heizperiode** (Anteile, Wärmeschutz, `dhw_method`) und Teil und Ziel der
  Positionen bleiben unberührt, Geräte und Werte des Ablesedienstes werden nicht gelöscht. Zu Wärmezählern entstehen die
  fehlenden Wärmezähler der Wohnungen. Heizpositionen ohne Teil und Ziel werden dabei nicht verlangt (umgestellt wird
  keine). Eine Berichtigung zurück auf die Einstellung der Spanne davor führt beide wieder zusammen. **Rückfrage** (409,
  `question: 'capture'`, `CaptureQuestion`, bestätigt mit `confirmCapture`): Zählt danach ab dem Beginn der Heizperiode
  etwas nicht mehr (Ablesungen der Heizkostenverteiler bzw. Wärmezähler der Wohnungen, Werte des Ablesedienstes,
  Schätzungen nach § 9a, die erst durch den Wechsel nicht mehr passen, mit dem Weg zum neuen Eintrag; beim Wechsel zum
  Ablesedienst auch die Warmwasserzähler, die seine Werte mit Warmwasser ersetzen; gezählt an jeder versorgten Einheit mit
  Fläche oder Gerät wie `served` in calc.ts; `unusedAfterCapture`), nennt der Satz es und dass nichts gelöscht wird.
  Die Antwort wiederholt die Schätzungen danach nicht (`estimatesNotice` bei `captureOnly` immer `null`); `devicesMissing`
  sagt der Mitteilung, ob noch Heizkostenverteiler anzulegen sind. Der Verlauf nennt den Schritt „Erfassung der
  Heizkostenabrechnung geändert“ (`retitleCurrentGroup`). **Kesseltausch**: Heizte in der Heizperiode noch die Anlage
  davor (`replacesPlantId`, `endsOn` ab ihrem Beginn) mit anderer Erfassung, lehnt der Server ab (400) und nennt die
  nächste Heizperiode, denn zwei Erfassungen in einer Heizperiode rechnet Mietfuchs nicht. Beginnt die eigene Abrechnung
  erst später, nennt die Ablehnung den Beginn (`beforeBeginText`), und die Karte zeigt den Knopf nur, wo sie in der
  Heizperiode gilt (`selfActive`). Geld: db-heizkosten.test.ts (vor, nach und zurück, auch Juli bis Juni mit Abschluss),
  Zufallsabläufe in invariant-heizperiode.test.ts.
  Gelöscht wird bewusst nichts: Der Wechsel ist umkehrbar, und zurückgestellt zählen die Daten wieder. Abgeschlossene
  Heizperioden schützen `heatingPeriodClosed` (409) und `lastClosed` (400): Die neue Spanne beginnt immer nach der
  letzten abgeschlossenen, deren Erfassung steht fest in ihrer Spanne (`pinSelfSpans`). Die Skala der
  Heizkostenverteiler (#723) hängt am Gerät und bleibt; wer zu Heizkostenverteilern wechselt, legt die Geräte mit Skala
  an (die Mitteilung sagt es). Vorher ging der Wechsel nur über „Niemand“ und `convertItems: 'area'`, und das verwarf
  Anteile, Teil und Ziel.
- **Der Anteil gehört zur Linie** ([db/selfLine.ts](../server/src/db/selfLine.ts)): Nach einem Tausch
  gilt er weiter, in derselben Heizperiode lehnt `saveDistribution` einen anderen ab. Läuft eine Anlage
  nur einen Teil der Heizperiode, wird die Wärme am Speicher an ihrer Laufzeit abgegrenzt (Stand am
  Tauschtag nötig, sonst `heating.self-incomplete`).
- **Nicht verteilbar** (fehlender Stand, Zähler nur noch beim Ablesedienst, Anteil, α; eine Wohnung ohne Gerät seit #690 nicht mehr) heißt Fehler an der Anlage und alle
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
  `volume_m3`, Schritte 0071/0072), nicht an der Wohnung; ein Wert gilt für beide Lesarten (ganzer Raum oder beheizte
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
- **Ausweis zum Nachrechnen** ([client/src/heatingSelfView.ts](../client/src/heatingSelfView.ts), `quantity`, `perUnit`,
  `costSplit`, `basisOf`): Der Server liefert Mengen ungerundet (Differenzen der Stände, mal Faktor, geteilte Anteile, auch mit
  Gleitkommarest) und rundet erst den Betrag. Gedruckt wird eine Menge, die mit höchstens drei Nachkommastellen aufgeht,
  genau so (35,4 MWh, 72,5 m², 785 Einheiten); ein gerechneter Anteil und der Preis je Einheit bekommen so viele
  Stellen, dass ihre Rundung den Betrag um höchstens einen Viertelcent verschiebt (Preis mindestens vier Stellen je m²
  bzw. m³, sechs je Verbrauchseinheit). **Zugesagt ist: Menge mal Preis ergibt den gedruckten Betrag bis auf Rundung
  von höchstens einem Cent, je Nutzer bei den Grundkosten bis zur Zahl der verteilten Kostenpositionen des Topfs plus
  einen Cent**, nicht mehr (bei verbundenem
  Warmwasser ist der Topfbetrag ungerundet, gedruckt wird der gerundete; der Betrag des Nutzers ist die Summe seiner je
  Position gerundeten Zeilen). Je Nutzer stehen Grund- und Verbrauchskosten getrennt: Verbrauchskosten = Verbrauch mal Preis je Einheit
  des Topfs (folgt aus `weightsOf`), Grundkosten = Rest zum Betrag der Zeile. Dazu Fläche bzw. Raum der Wohnung und bei
  einem Teilzeitraum der Anteil, mit dem der Server sie in diesem Topf gewichtet („davon 640 von 1.000 ‰ der Gradtage“,
  Warmwasser und zeitanteilige Teilung „273 von 365 Tagen“). Der Stand trägt Gradtage und Tage nur je Nutzer; der Nenner
  ist ihre Summe über die Nutzer der Wohnung, und genannt wird die Rechnung nur, wenn sie die gedruckten Grundkosten
  bis auf die Rundung ergibt: **Zeilenzahl des Topfs plus einen Cent** (`heatingRows`/`waterRows` des Stands, je verteilter
  Position oder Übertrag ein Cent), ohne die Angabe (vorher eingefrorene Stände) ein Cent, und nie mehr als 2 % der
  Grundkosten (mindestens ein Cent; bei Grundkosten von wenigen Cent erklärte die Zeilenzahl sonst auch eine falsche
  Teilung). Sonst steht nur der Betrag da
  (ebenso ohne Fläche im Stand). Das rechnet die Oberfläche
  aus den vorhandenen Feldern, auch für eingefrorene Stände; keine Aufteilung ohne Anteil nach Verbrauch (nur nach
  Fläche, § 9a Abs. 2, 0 oder 100 %) und ohne Betrag.
- **„Nur Heizung“ bei freien Schlüsseln** nimmt beim Mieterwechsel Gradtage statt Tage; kombinierte
  Positionen bleiben nach Tagen.
- **Schornsteinfeger neben der zentralen Anlage** (#724): Die Kostenart „Schornsteinfeger“ (§ 2 Nr. 12 BetrKV) verteilt
  nach ihrem freien Schlüssel. Betrifft die Rechnung die zentrale Heizung, nennt § 7 Abs. 2 HeizkostenV „die Kosten der
  Messungen nach dem Bundes-Immissionsschutzgesetz“ und die „der Reinigung der Anlage“ unter den Kosten des Betriebs der
  zentralen Heizungsanlage einschließlich der Abgasanlage; Nr. 12 gilt für Kehrgebühren nur, „soweit sie nicht bereits
  als Kosten nach Nummer 4 Buchstabe a berücksichtigt sind“ (beides am amtlichen Text gelesen am 27.11.2026; „Kehr- und
  Überprüfungsgebühren“ stehen nicht in § 7 Abs. 2, deshalb nennt kein Text sie dort). **Gefragt wird, umgebucht nie**:
  Ob die Rechnung die Heizung betrifft oder Kaminöfen und Gasthermen einzelner Wohnungen, weiß nur der Vermieter. Das
  Kostenformular fragt, wenn die eigene Heizkostenabrechnung im Zeitraum der Position gilt (`chimneySweepQuestion`,
  `chimneySweepPlants` mit `selfActive` aus shared/heatingPeriod.ts, derselben Stelle wie `guardHeatingSystem` und der
  Schnappschuss; bei eigener Heizperiode mit deren Vorgabe; Durchsicht M2: sonst lehnte der Server mit 400 ab), nicht beim
  Schlüssel „direkt“. Knopf `toCentralHeating` in client/src/costForm.ts: Kostenart, Schlüssel `heatingSystem`, Teil
  `operating`; das Ziel wählt der Vermieter, wenn es mehr als eines gibt. „Nicht vereinbart“ geht nicht mit (bei
  Heizkosten 400); eine Zeile nennt die Mietverhältnisse (`notAgreedDroppedText`, S2). Die Berechnung meldet je Position
  `heating.chimney-sweep-central` (hint, `INFORMATIONAL`, Ziel die Position) bei `self` und, mit dem Satz zur doppelten
  Verteilung statt des Rats zum Umstellen, bei `service`; nur in der Gesamtberechnung, nur neben einer laufenden zentralen
  Anlage des Hauses, deren Art in diesem Zeitraum gilt (`selfAt`), nicht bei freien Schlüsseln, Etagenheizung, Abrechnung
  einer Gemeinschaft, Direktzuordnung an eine Wohnung oder wenn kein Mieter etwas davon trägt. **Kein Betriebsstrom**
  (S1): Eine Heizposition „Betrieb“, die dem Namen nach eine Rechnung des Schornsteinfegers ist (`chimneySweepLike` in
  server/src/operatingPower.ts: Schornstein, Kamin, Kehr-, Abgas, Immission, Feuerstätte, ohne „Strom“), beantwortet die
  Frage nach dem Betriebsstrom nicht; `heating.operating-power-missing` nennt sie dann.
- **Seite Heizkosten bei eigener Abrechnung** (#690, [client/src/heatingPageView.ts](../client/src/heatingPageView.ts)):
  je offener Heizperiode zuerst die Karte „Was fehlt noch“ (`selfTodos`, HeatingTodoCard): Kosten, Anteil nach Verbrauch,
  Warmwasser (nur aus der Heizung), Ablesungen, Verteilung, CO₂, Angaben nach § 6a, je mit Stand als Wort und Farbe.
  **Die Liste ist keine zweite Regel neben der Berechnung**: Eine Zeile ist nur grün, wenn die Abrechnung der
  Heizperiode zu ihrem Thema keinen Fehler und keine Warnung trägt. Welcher Code zu welcher Zeile gehört, steht in
  [shared/heatingTodo.ts](../shared/heatingTodo.ts) (Zeile, `other` = weiterer Hinweis ohne Zeile, oder `skip` mit
  Grund); server/test/heating-todo-codes.test.ts verlangt das für jeden Code `heating.`, `co2.`, `fuel.`, `meter.` des
  Katalogs, **wer einen solchen Hinweis anlegt, ordnet ihn dort zu**. Welche Hinweise zu Anlage und Heizperiode gehören,
  entscheidet `noticesOf` (Bezug auf die Anlage oder eine Position der Heizperiode; bei einer einzigen Anlage jeder
  Hinweis der Heizung; nennt der Text eine andere Heizperiode der Anlage, gehört er dorthin). Eigene Bedingungen nur, wo
  die Berechnung schweigt (keine Kostenposition mit Betrag: eine Lieferung allein genügt nicht; kein Anteil; die
  Grenzen der Karte „Ablesungen“), und solange die Abrechnung nicht verteilt (`self.ok`), gelten Warmwasser, CO₂ und
  § 6a als nicht geprüft (gelb). `heating.info-open` färbt gelb wie die Warnung, außer er nennt allein Nr. 1 c (keine
  Position „Messdienst, Ablesung, Geräte“: keine Kürzung, im rechtmäßigen Fall nicht abstellbar). „Alles erledigt“ steht
  nur, wenn jede Zeile grün ist und die Abrechnung sonst keinen Fehler und keine Warnung zur Heizung meldet
  (`extraNotices`). **Bekannte Grenze**: Eine getrennt abgerechnete Heizperiode (Weg d) steht nicht in der Abrechnung
  des Zeitraums, aus der die Seite liest; die Liste sagt das und bleibt gelb. Danach das Nötige, dahinter „Ausnahmen und
  Vereinbarungen“, das Blatt für den Messdienst und unter „Seltener gebraucht“ die Angaben je Anlage (Betriebsstrom,
  § 43 GModG). **Beim Messdienst, bei freien Schlüsseln und bei der Etagenheizung bleibt die Reihenfolge**, der
  Untertitel richtet sich nach der Lage (`heatingSituation`: `service`, `self`, `manual`, `perUnit`; `heatingSubtitle`).
  **Je Lage erweiterbar** (#719): `todosFor(lage, …)` gibt die Zeilen einer Lage oder `null`; bisher hat nur `self`
  eine Liste (`selfTodos`). Wer eine Lage ergänzt, trägt ihre Funktion in `TODOS` ein, mit denselben Zeilen (`TodoStep`)
  und derselben Regel (nie grüner als die Hinweise). **Dieselben Codes wie die Berechnung**: shared/heatingTodo.ts
  ordnet jeden Code der Heizung und der Zähler einer Zeile zu, als weiteren Hinweis oder mit Grund ausgenommen
  (Wächter heating-todo-codes.test.ts gegen `NOTICE_KINDS`); client/src/heatingTodo.berechnung.test.ts rechnet
  Bestände der eigenen Abrechnung mit `computeSettlement` und verlangt je färbendem Hinweis seine Zeile, nicht grün,
  mit seinem Titel wortgleich. **Ab zwei Anlagen** (nebeneinander, Kesseltausch) ordnet `subjectPlants` Hinweise an
  Zähler (über dessen Anlage oder Wohnung), Wohnung und Mieter der versorgenden Anlage zu; was keiner Anlage sicher
  gehört, steht bei jeder als weiterer Hinweis (`loose`), nie „alles erledigt“ daneben. „Kosten erfasst“ ist auch ohne
  eigene Position grün, wenn die Abrechnung Kosten verteilt (übernommener Vorrat). Zeilen mit Karte auf der Seite
  (Warmwasser, Anteil, § 6a, Werte des Ablesedienstes) springen zur Karte, Ablesungen zur Seite „Zähler & Stände“. Eine
  getrennt abgerechnete Heizperiode zeigt keine rote Zeile. Fehlt der Anteil nach Verbrauch oder liegt er außerhalb der
  Grenzen, meldet die Berechnung `heating.share-invalid` („Anteil nach Verbrauch ungültig“, früher unter
  `heating.self-incomplete`); die Zeile „Anteil“ folgt dem Code, die Zeile „Zählerstände“ im Cockpit nennt ihn weiter
  (`selfHeatingReadings`). **Kesseltausch**: Ausweis und Hinweise nach § 6a hängt die Berechnung an die Anlage, die am
  Ende der Heizperiode heizt (`host`); `lineOf` bildet die Linie (`lineRoot`), Hinweise an einer Partneranlage zählen
  als weiterer Hinweis, und die übrigen Anlagen nennen bei § 6a diese Anlage mit Sprung dorthin. **Vergleichswert**: Weg und Hilfe nur, wo Mietfuchs Nr. 4 selbst
  rechnet (Wärmezähler, Wärme nicht nach § 11 ausgenommen); mit Heizkostenverteilern oder für das Warmwasser allein ein
  Satz, dass Mietfuchs ihn nicht erstellt. Der Weg sagt, dass der Wert nur Nr. 4 erfüllt; Nr. 5 bleibt im ersten Jahr
  der eigenen Abrechnung meist offen (Vorjahresverbrauch unbekannt), mit dem Weg über die Abrechnung des früheren
  Messdienstes und ohne Feld, das die Kürzung abstellt. Dieselbe Weiche gilt für die Quelle des Vergleichswerts der
  monatlichen Verbrauchsinformation (`REFERENCE_SOURCE_TEXT_OWN` in db/monthlyInfo.ts, `monthlyReferenceHelp`). Die Hilfe am Vergleichswert der Karte „Angaben zur Abrechnung (§ 6a)“
  nennt ohne Werte eines Ablesedienstes den Wortlaut der Nr. 4 und eingeklappt den Weg über die Stellen der Nr. 2
  (Verbraucherorganisationen, Energieagenturen; BR-Drs. 643/21, S. 20), ausdrücklich als Auslegung
  (`REFERENCE_WAY` in heatingInfoForm.ts). Hinweis `heating.info-incomplete` und die Ablehnung eines Vergleichswerts
  ohne Quelle nennen die Vergleichsdaten des Ablesedienstes nur noch bei Werten eines Ablesedienstes bzw. außerhalb
  der eigenen Abrechnung (dort wortgleich wie vorher); eingefrorene Hinweise bleiben, wie sie zugestellt wurden.
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

- **Erfassung gewählt, kein Gerät angelegt** (Systemprüfung): Ein Topf ohne ein einziges Gerät geht nur nach Fläche
  (`totals[p].devices` im Plan). Der Ausweis sagt es (`SelfPotView.noDevices`; je Grenze einer Wohnung die Töpfe, für die sie kein Gerät hat,
  `SelfBoundaryView.noDevicePots`, auch wenn nur dieser Wohnung eins fehlt und daneben `heating.self-incomplete` steht;
  `status` beschreibt weiter nur die vorhandenen Zähler; nichts davon unter einer Ausnahme nach § 11, einer
  Vereinbarung nach § 2 oder solange die Verordnung für die Wärmepumpe noch nicht gilt), die Seite Heizkosten zeigt
  statt „abgelesen“ den fehlenden Schritt (`missingDevicesLines`, `estimateIdleText` in client/src/heatingSelfView.ts),
  und `heating.no-consumption` nennt neben der Kürzung, dass die Geräte auf der Seite „Zähler & Stände“ anzulegen sind.
  Keine Zahl ändert sich.
- **Eine Wohnung ohne Gerät, die übrigen mit** (#690): Vorher `noMeter` als Fehler, die Anlage gesperrt, alle Kosten beim
  Vermieter. Jetzt steht die Wohnung in `totals[p].unequipped` (planSelf, nur Wohnungen mit Fläche, nicht beim Ablesedienst:
  dort bleiben fehlende Werte ein Fehler mit dem Weg der Schätzung). Ihr Verbrauch ist der Durchschnitt je m² (bzw. m³)
  der Wohnungen mit erfasstem Verbrauch ohne Schätzung (`substitutePerM2`, dieselbe Rechnung wie der Vorschlag
  „Durchschnitt des Gebäudes“), über ihre Nutzer nach Gradtagen bzw. Tagen geteilt wie eine Schätzung
  (`SelfUserPot.substituted`); centgenau wie eine Schätzung mit diesem Wert (Test in calc-hkv.test.ts). Ihre Fläche zählt
  mit der geschätzten und der geschätzter Ablesungen (`heating.reading-estimate-over-25`) für die Grenze des § 9a Abs. 2
  (`unequippedArea`); darüber, oder ohne abgelesene Wohnung (auch wenn alle übrigen geschätzt sind: `substitutePerM2` null),
  geht der Topf nur nach Fläche. Warnung `heating.unit-without-device` je Topf (ersetzt dort `heating.estimate-over-25` und
  `heating.no-consumption`), Ausweis `SelfPotView.unequippedUnits`/`substitutedConsumption`, Rechenweg und
  `missingDevicesLines` nennen die Wohnung. Die Warnung trägt den Kern, die Begründung mit allen Fundstellen steht in der
  Anleitung „Heizkosten selbst abrechnen“ (shared/guides.ts) und knapp im Lexikon `heatingEstimate`.
  **Rechtslage, am 27.11.2026 an den amtlichen Texten und BGH-Volltexten gelesen**: § 4 Abs. 1, 2 (Ausstattungspflicht),
  § 9a Abs. 1 („wegen Geräteausfalls oder aus anderen zwingenden Gründen“), § 12 Abs. 1 Satz 1 („Soweit … nicht
  verbrauchsabhängig“). Ob eine nie ausgestattete Wohnung ein zwingender Grund ist, hat der BGH nicht entschieden:
  VIII ZR 373/04, Rn. 15 (zwingend, wenn nicht mehr behebbar) gegen Rn. 21 (§ 9a abgegrenzt von der „freien“ Schätzung
  „wegen fehlender Messgeräte“); VIII ZR 264/19, Rn. 20 („aus Bequemlichkeit“). **Der Durchschnitt statt reiner Fläche ist
  eine Festlegung von Mietfuchs.** Dafür: „grundsätzlich“ ist jede den Verbrauch einbeziehende Abrechnung der reinen
  Flächenabrechnung vorzuziehen (VIII ZR 329/14, Rn. 17); VIII ZR 261/06, Rn. 15, lehnte § 9a im Haus ohne Ausstattung nur
  mangels Schätzungsgrundlage ab; die 25-%-Grenze ist die Grenze der Ersatzkriterien (VIII ZR 264/19, Rn. 28). Dagegen:
  rein nach Fläche, wenn ein verbrauchsbezogener Anteil nicht ermittelt worden ist und nicht mehr ermittelt werden kann
  (VIII ZR 329/14, Rn. 18, mit Verweis auf VIII ZR 261/06 zum Fall fehlender Ausstattung). Für eine einzelne Wohnung ohne
  Gerät neben ausgestatteten ist das nicht entschieden. **Kürzung je Topf** (Durchsicht M1): Jede Warnung nennt nur ihren
  eigenen Topf („Soweit“; VIII ZR 195/04, II.: nicht die Kosten, deren Messgeräte vorhanden sind und genutzt werden), bei
  einer Anlage ohne Warmwasser über die Heizkostenzeilen. Sicher für die Mieter der Wohnung ohne Gerät (VIII ZR 151/20,
  Rn. 35), **vorsorglich für die übrigen** (Rn. 23: „auch nur teilweise“), auch über der Grenze getrennt (Durchsicht S3).
  Das ist eine Auslegung zur sicheren Seite des Vermieters (er kennt den höchsten Betrag, den er verlieren kann). Mit
  vollständigen Geräten ändert sich keine Zahl.
- **Ohne Anschluss an das Warmwasser** (`Unit.noConnection` mit `warmwasser`, Durchlauferhitzer; Integrationsdurchsicht
  zu #690): Die Wohnung nimmt am Topf Warmwasser nicht teil, weder mit Fläche (`areaOf`, `potAreaOf`), noch mit Geräten
  oder Schätzung (`metersOf`, `estimateOf` in planSelf), auch nicht bei reiner Flächenverteilung oder ganz ohne
  Warmwasserzähler im Haus (das galt schon in v0.18.1 falsch: sie trug nach Fläche mit). Damit zählt sie nicht als Wohnung
  ohne Gerät, nicht für die Grenze des § 9a Abs. 2, nicht für den Durchschnitt, und ihre Grenzen nennen für das Warmwasser
  kein fehlendes Gerät; der Rechenweg nennt bei ihr nur die Heizung. `SelfUnit.noWater` trägt die Angabe aus calc.ts hinein.
  Ohne Anschluss an die Wärme hängt sie wie bisher gar nicht an der Anlage (`servesUnit`). Die Formel für den
  Warmwasseranteil rechnet schon mit der versorgten Fläche (`suppliedAreaOf` in dhw.ts). Tests: calc-hkv.test.ts.
  **Erreichbar** (Nachtrag): Das Formular der Wohnung bietet den Haken „Warmwasser“ auch ohne Warmwasserzähler im Objekt
  an, wenn eine laufende Anlage mit eigener Abrechnung und Warmwasser (in irgendeinem ihrer Zeiträume) die Wohnung versorgt
  (`waterConnectionAsked` in client/src/unitForm.ts); beim Messdienst und bei freien Schlüsseln nicht, dort wirkt der
  Anschluss nur über die Zähler. Werte eines Ablesedienstes: Eine Wohnung ohne Warmwasseranschluss braucht keinen
  Warmwasserwert und zählt für „alle Zeilen oder keine“ nicht mit (`checkRows` in db/serviceValues.ts).
  **Keine Wohnung angeschlossen** (Nachtrag): Vorher `noArea` für den Topf Warmwasser, die ganze Anlage gesperrt. Jetzt
  `totals.water.unconnected` (planSelf, nur wenn alle Wohnungen mit Fläche ohne Anschluss sind; ohne Fläche bleibt
  `noArea`): Die Heizung wird verteilt, der Teil Warmwasser jeder Position (`partOf`) steht beim Vermieter mit dem Grund
  `noWaterConnection`, und `heating.water-unconnected` (warning) nennt den Betrag und die zwei Wege (Einstellung
  „Es gibt kein zentrales Warmwasser“ oder Haken bei den Wohnungen). **Festlegung nach § 9 Abs. 1 HeizkostenV**: Die Kosten
  einer verbundenen Anlage sind auf Heizung und Warmwasser aufzuteilen; den Teil Warmwasser trägt hier kein Nutzer. Ihn der
  Heizung zuzuschlagen ginge zu Lasten der Mieter, die Anlage zu sperren nähme die ganze Heizung; der Hinweis mit Betrag
  lässt die Wahl beim Vermieter. Der Block der Beträge je Nutzer im Ausweis (`selfBlocksOf`) verteilt die Zeilen des
  Vermieters weiter nach den Gewichten; der Teil Warmwasser hat dort keine Gewichte (offen, nur Ausweis).
- **Einheitsskala**: Ablesewert × Bewertungsfaktor; **Produktskala**: wie abgelesen. Ohne Skala oder
  Faktor `heating.hca-factor-missing`, keine Verteilung. Skala und Faktor nur am Typ `hkv`; ein Gerät
  mit anderem Faktor ist ein neuer Zähler; gesperrt (409), sobald seine Ablesungen eine
  abgeschlossene Heizperiode überdecken.
- **Die Skala ist Pflicht** (#723), im Formular (`scaleRequired`, `SCALE_MISSING` in client/src/meterForm.ts, Feld
  `hcaScale`) und am Server (`guardMeter`): für ein neues Gerät, beim Wechsel der Sparte zum Heizkostenverteiler und für
  eine gespeicherte Skala, die geleert würde (auch durch einen unbekannten Wert). Wie bei der Einheit bleibt ein Gerät,
  das schon ohne Skala gespeichert ist, speicherbar (`keptScale`; krumm, nicht kaputt), das Feld sagt dann, was fehlt
  (`meterScaleHint`); Wiederherstellen und Umstieg laufen nicht durch `guardMeter`. **Ausnahme: gespeicherter Faktor ohne
  Skala** (Altbestand, Durchsicht S6): Der Faktor bleibt beim Speichern erhalten (`hcaFieldsBody`; vorher fiel er still weg,
  bei Ablesungen in einer abgeschlossenen Heizperiode mit 409), und das Formular verlangt die Skala mit
  `SCALE_MISSING_WITH_FACTOR`, denn erst sie sagt, ob der Faktor gilt. Der Server verlangt sie dort nicht. Der Bewertungsfaktor bleibt bei der
  Einheitsskala freiwillig beim Speichern (fehlt er, meldet die Abrechnung es wie bisher). Die Berechnung nimmt ohne
  Skala nichts an: Schon ein Gerät ohne Skala sperrt die Verteilung der Anlage (Test in calc-hkv.test.ts). Die
  Erkennungshilfe am Feld (`SCALE_HELP`) nennt nur, was aus der Bedeutung der Skalen folgt, keine Merkmale am Gerät.
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
- **Beträge je Nutzer und Topf** (`heatingCents`, `waterCents`) sind die Summe seiner verteilten Zeilen
  (`selfBlockCents` in calc.ts: beim Mieter die Kostenzeile jeder Position, sonst sein Teil der Zeilen des
  Vermieters), nicht Topf mal Gewicht einmal gerundet (`selfBlocksOf`); alle Nutzer zusammen ergeben die Positionen
  und Überträge, je Mieter beide Töpfe zusammen genau seine Heizkostenzeilen. Die Zeilen für Heizung und Warmwasser
  werden je Nutzer **einmal** geteilt (das Verhältnis ist für alle solchen Positionen dasselbe), über alle Nutzer
  zugleich nach dem Restverfahren auf den gedruckten Topf Heizung: Der stimmt genau, Warmwasser bis auf einen Cent
  (zwei gerundete Topfbeträge). `heatingRows`/`waterRows` nennen je Nutzer und Topf die Zahl der Zeilen, damit der
  Druck seine Toleranz gegen Fläche mal Preis daran binden kann (fehlt in älteren eingefrorenen Ständen). Der
  CO₂-Abzug: Heizung gerundet, Rest Warmwasser (`selfCo2Of`). Die Kürzungsgrundlage „Anteil Warmwasser“ der Hinweise
  (`waterBaseOf`) liest dieselben Beträge. Eine nicht verteilte Position (`heating.target-invalid`) zählt im Block
  weiter mit Topf mal Gewicht. Tests: calc-heizblock-betraege.test.ts, (s1a) bis (s1d) in fuel-invariant.test.ts.

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
- **Geschätzte Ablesungen** (#98, `readings.estimated`, server/src/CLAUDE.md „Zähler“) an den Geräten eines Topfs zählen
  für die Grenze mit: die Fläche der Wohnungen mit geschätzter Ablesung (ohne Schätzung nach § 9a, jede Wohnung einmal)
  zusammen mit der geschätzten Fläche. Darüber warnt `heating.reading-estimate-over-25` (warning, Regel
  `heating-estimate`) mit Fläche und Quote und verweist auf „Schätzung (§ 9a)“; **umgestellt wird nicht**, gerechnet wird
  weiter nach Verbrauch mit den geschätzten Ständen, damit sich kein Betrag einer bestehenden Abrechnung ändert. Mit den
  Werten eines Ablesedienstes zählen die Geräte nicht. Beim Mieter steht der geschätzte Stand mit Begründung im Text seiner
  Zeile.
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
- **Wo das Kostenformular fragt** (`showsOperatingPower` in client/src/costForm.ts, #721): mit dem Teil „Betrieb“ immer
  (dorthin führen die Hinweise), mit „Brennstoff/Energie“ nur bei Wärmepumpe und Stromheizung, **ohne Teil nur, wenn die
  Beschreibung Strom, Pumpe oder Brenner nennt, die Anlage eine Wärmepumpe oder Stromheizung ist (`POWER_GENERATED`)
  oder die Antwort schon gespeichert ist; nie bei Wartung, Schornsteinfeger, Messdienst nach `heatingKindOf`, auch an
  der Wärmepumpe nicht, und eine Tätigkeit an Pumpe oder Brenner („Reparatur Brenner“) ist Wartung** (sonst
  stand die Frage auch bei Heizöl, Gas und Wartung). Der Rumpf schickt `included` nur, wo die Frage steht; deshalb zählt
  die gespeicherte Antwort mit. Steht eine Position ohne Teil da, nennt `heating.operating-power-deduction-missing` zuerst
  den Teil `OPERATING_PART_LABEL` (shared/operatingPower.ts, dieselbe Konstante wie im Formular; `hasPartless`).
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
- **Die Karte „Heizung“ zeigt den Zustand dauerhaft** (#721, `ownHeatingState`, `ownHeatingNote` in heatingForm.ts):
  ohne Anlage, wenn jedes heute laufende Mietverhältnis des Objekts auf „Mieter heizt selbst“ steht (beendete und künftige
  zählen nicht). Ein Satz je Art (`perUnit`, `central`, gemischt), mit einer Wohnung ohne laufendes Mietverhältnis nur
  „In den vermieteten Wohnungen …“ (`someUnitUnlet`), der Lexikonbegriff `co2Refund`, die Fristen zum Aufklappen und
  „Ändern“ (öffnet die Einrichtung). Entsteht danach eine Anlage des Vermieters, bietet die Karte an, die Mietverhältnisse
  der versorgten Wohnungen, die noch auf „Mieter heizt selbst“ stehen (laufende und künftige), wieder abzurechnen
  (`settlementBackOffer`); sonst folgt `co2.self-supply-mixed`. Die Mitteilung nach dem Einrichten der Etagenheizung ist kurz; bei
  der zentralen Heizung mit Vertrag des Mieters und beim Wärmelieferanten steht der lange Text weiter in der Mitteilung.
- **Ändern einer Anlage auf „Jede Wohnung hat eine eigene Heizung“, Vertrag beim Mieter** (#720, `changeToSelfSupply` in
  HeatingCard.tsx, `selfSupplyChange` in heatingForm.ts): Sind alle Wohnungen der Anlage angehakt, entfernt die Karte sie
  nach einer Rückfrage (Weg und Sperren von „Entfernen …“; die Sperre fragt sie vorher über
  `GET /api/heating-plants/:id/removal`, gesperrt heißt Meldung im Fenster und keine Änderung), dann erst stellt sie die
  Mietverhältnisse um, auch die künftigen (`selfSupplyOffer` mit `withFuture`). Ist nur ein Teil angehakt, behält die
  Anlage die übrigen Wohnungen (`PUT` mit `units`). **Die Heizpositionen fasst die Karte nie an**: Tragen Selbstversorger
  weiter eine Position der Anlage, bleibt `co2.self-supply-mixed`, und sein Text nennt „nur bestimmte Wohnungen
  beteiligen“, wenn die Wohnung nicht an der Anlage hängt. Die Auskunft trägt deshalb auch `items`, die Heizpositionen der
  Anlage in offenen Zeiträumen (`heatingPlantOpenItems`, Regel `itemPeriodClosed`), und die Rückfrage nennt höchstens fünf
  davon (`selfSupplyItemsNote`): danach ohne Anlage nach ihrem Schlüssel, also auch bei Selbstversorgern. Ist die Anlage
  die neue eines Kesseltauschs, sagen Rückfrage und Mitteilung, dass die ersetzte wieder heizt (`replacedHeatsAgain`,
  `replacedAlsoRemove`); entfernt wird sie nicht mit, denn ob sie in ihrer Zeit über den Vertrag des Vermieters heizte,
  weiß nur er, und zwei Entfernungen nacheinander wären keine Transaktion. Scheitert nach dem Schreiben an der Anlage ein
  Mietverhältnis, steht `selfSupplyPartial` oben in der Karte.
- **Brennstoff bei Selbstversorgern** (Durchsicht von #720, `heating.fuel-for-self-supply`, warning, färbt): eine
  Heizposition ohne Anlage mit Teil `fuel`, verknüpfter Lieferung oder ohne Teil mit einer Beschreibung der Art `fuel`
  (`heatingKindOf` in [shared/heatingKind.ts](../shared/heatingKind.ts), kleine Wortliste, eine Art außer Brennstoff
  geht vor, ein Bauteil wie Therme, Tank oder Zähler ohne Lieferung ist nie Brennstoff, Wärmepumpen- und Heizstrom ist
  Energie, Tabelle in shared-heating-kind.test.ts), die ein Mietverhältnis mit „Mieter heizt selbst“ trägt. Text: Position, Betrag, die Selbstversorger mit
  Anteil, was zu prüfen ist (löschen, auf andere Wohnungen beschränken, Angabe am Mietverhältnis). Ohne Paragrafen. Für
  diese Positionen entfällt `co2.self-supply-items`.
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
