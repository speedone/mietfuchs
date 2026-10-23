# Nutzungswechsel einer Einheit (#259)

Stand 23.10.2026. Ob eine Einheit vermietet, selbstgenutzt oder außerhalb der Abrechnungseinheit ist,
war eine feste Angabe. Dieser Entwurf macht daraus eine Staffel „ab Datum“, wie Personenzahl und
Vorauszahlung, und legt fest, wie Abrechnung und Steuerübersicht damit rechnen.

**Leitsatz: Ohne Wechsel ändert sich keine Zahl.** Jede Formel unten ist so geschrieben, dass sie bei
einer Einheit ohne Wechsel im Zeitraum wörtlich dieselben Gleitkommazahlen ergibt wie vorher (Faktor
genau 1 oder 0, gleiche Reihenfolge der Summen). Die Goldens, `tax-golden.json` und alle Invarianten
sind der Beweis.

## 1. Datenmodell

- **Die erste Stufe ist die bisherige Angabe.** `units.participates`/`units.self_used` bleiben und
  heißen fachlich „Nutzung von Anfang an“. Dazu kommt die Tabelle `unit_usage_changes` (`unit_id`
  mit `ON DELETE CASCADE`, `from` als `JJJJ-MM-TT`, `usage` aus `vermietet | eigen | ausgenommen` mit
  Prüfbedingung, Primärschlüssel `(unit_id, from)`): je Wechsel eine Zeile, die ab diesem Tag gilt.
- **Warum keine Datenanweisung, die die heutige Angabe als ersten Eintrag kopiert.** Das wäre
  inhaltlich dasselbe (erster Eintrag „ab Anfang“), hinterließe aber zwei Wahrheiten, solange die
  Spalten an der Wohnung bleiben, und ein Löschen der Spalten berührte jeden Leser (Oberfläche,
  eingefrorener Eingang, Validator, Umstieg, Regression). Dasselbe Muster steht schon zweimal im
  Schema: `properties.period_start_month` mit `period_changes` (#208) und
  `heating_plants.period_start_month` mit `heating_period_changes` (Heizung PR 5). Ohne Zeile in der
  neuen Tabelle ist der Bestand also wörtlich unverändert; der eingefrorene Eingang, der Validator und
  die db.json kennen die Tabelle nicht und müssen es nicht.
- Im Modell: `Unit.usageChanges?: UsageChange[]` (`{ from, usage }`), nach Datum geordnet; gelesen und
  geschrieben wie `noConnection` (read.ts, `mergeUnit`, `writeUnitChildren`). Zwei Einträge am selben
  Tag: es gilt der letzte (`latestPerKey` in schedule.ts). Ein ungültiges Datum oder eine unbekannte
  Nutzung fällt weg (krumm, nicht kaputt).
- **Eine Stelle für „Nutzung am Tag t“**: [shared/unitUsage.ts](../../../shared/unitUsage.ts) mit
  `baseUsage`, `usageAt(unit, tag)` und `usageSpans(unit, von, bis)` (lückenlose Abschnitte gleicher
  Nutzung). Die Oberfläche fragt dieselben Funktionen.
- Schnappschuss: `SnapshotUnit` führt `usageChanges` mit, ungefiltert (eine Stufe ab Datum kann Jahre
  alt sein, wie bei den Staffeln der Mietverhältnisse).

## 2. Abrechnung

Je Einheit und Zeitraum zählt calc.ts die Tage je Nutzung (`usageIn`: vermietet, selbstgenutzt,
außerhalb). Eine Einheit gehört zur Verteilbasis, wenn sie an einem Tag vermietet oder selbstgenutzt ist.

- **Je Abschnitt verteilen** (Durchsicht S1). Wechselt eine Einheit zwischen „in der
  Abrechnungseinheit“ und „außerhalb“, ändert sich die Verteilbasis im Zeitraum. Bei Fläche, Einheiten
  und Gemeinschaft wird der Betrag dann nach Tagen (bei „nur Heizung“ nach Gradtagen, § 9b Abs. 2) auf
  die Abschnitte gleicher Basis geteilt, je Abschnitt nach Fläche, Einheiten oder Wert verteilt, und die
  exakten Anteile werden summiert und **einmal** gerundet (#202). Das ist dasselbe Ergebnis, das eine
  feste Angabe je Abschnitt ergäbe: Eine ganzjährig außerhalb liegende Einheit belastet die übrigen
  voll, also auch in dem Abschnitt, in dem sie außerhalb liegt. Gemittelt über das Jahr (der erste
  Stand von Teil 1) trug ein Mieter dagegen für die Zeit, in der eine andere Einheit außerhalb lag,
  einen Anteil, den es in der Zeit gar nicht gab (Probe P1: 33.515 statt 25.205 Cent). **Dass die
  Kosten gleichmäßig über den Zeitraum anfallen, ist eine Auslegung** und steht so im Hinweis
  `usage.changed`, im Lexikon und in der Anleitung; die Rechnung kennt keinen Anfall je Tag.
- **Ohne Abschnitte**, weil dort keine Basis gemittelt wird:
  - Ein Wechsel nur zwischen vermietet und selbstgenutzt ändert die Basis nicht. Eigenanteil und
    Mieteranteil sind dann Fläche × Tage, und die Summe der Teile ist der Anteil der Einheit.
  - **Vereinbarte Anteile** gelten absolut je Wohnung; in Tagen außerhalb verfällt der Anteil dieser
    Tage (`outsideUnit`), die übrigen Wohnungen tragen nichts davon. Das ist dieselbe Regel wie bei einer
    ganz ausgenommenen Wohnung.
  - **Direktzuordnung**: eine Einheit, nach Tagen auf Mieter, Eigennutzung und außerhalb.
  - **Verbrauch**: gemessen; was ein Zähler in Tagen außerhalb misst, ist `outsideUnit`, in Tagen der
    Eigennutzung Eigenanteil.
  - **Personen**: Personentage sind schon eine Größe über die Zeit; die Basis schwankt auch ohne
    Nutzungswechsel mit jedem Ein- und Auszug, ohne dass Mietfuchs (oder die übliche Praxis) dafür
    Abschnitte bildet. Eine Zeit außerhalb hat keine Personentage, wie eine leere Wohnung ohne fiktive
    Person.
- **Leerstand** sind die vermieteten Tage ohne Mietverhältnis (`vacancy`), beim Personenschlüssel mit
  `VACANCY_PERSONS` je Tag (#177). Eine Zeit der Eigennutzung ist kein Leerstand, eine Zeit außerhalb
  auch nicht.
- **Hauptzähler (#116)**: Der Rest wird Eigenanteil, wenn alle Einheiten ohne Zähler den ganzen
  Zeitraum selbstgenutzt sind. Ist es genau eine Einheit, die nur einen Teil des Zeitraums selbstgenutzt
  ist (Durchsicht S2), gilt der Rest nach Tagen der Eigennutzung als Eigenanteil, der übrige Teil bleibt
  als `mainMeterRest` beim Vermieter; das nimmt gleichmäßigen Verbrauch an und ist eine Auslegung, die
  Warnung `meter.unit-without-meter` sagt es. Bei mehreren solchen Einheiten lässt sich der Rest nicht
  zuordnen und bleibt beim Vermieter.
- **Ein Mietverhältnis zählt nur in der vermieteten Zeit.** Das ist die Verallgemeinerung der
  bisherigen Regel (ein Mietverhältnis in einer selbstgenutzten Wohnung bekam nie einen Kostenanteil).
  Für die Kosten wird es auf seinen ersten vermieteten Abschnitt beschnitten (`costTenancies`); die
  übrigen Tage bleiben beim Vermieter, nie bei anderen Mietern. Vorauszahlungen bleiben am ganzen
  Mietverhältnis. Hinweis `usage.tenancy-conflict` (`error`), der Zeit ohne Vermietung und späteren
  vermieteten Abschnitt getrennt nennt. Für Einheiten ohne Wechsel bleibt es beim bisherigen Verhalten
  ohne Meldung.
- **Eigene Heizkostenabrechnung, § 9b HeizkostenV.** Ein Wechsel ist ein Nutzerwechsel: `usersOf`
  teilt die Zeiten ohne Mietverhältnis an den Grenzen der Staffel, auch in den Nachbarperioden
  (`outerChanges`). Damit gelten Zwischenablesung (§ 9b Abs. 1), Gradtage bzw. Zeitanteil (Abs. 2) und
  die Gruppe nach Abs. 3 auch für den Eintritt des Vermieters als Nutzer. Ein Mietverhältnis ganz in
  einer Zeit ohne Vermietung hat keine Abrechnung; sein Gewicht geht nach der Nutzung seiner Tage an
  `selfUse` bzw. `outsideUnit` (Durchsicht S3). Eines mit vermieteten Tagen bleibt Nutzer, solange es
  läuft (siehe Bewusst offen), und der Hinweis sagt es dann.
- **Ja/Nein-Fragen** (Durchsicht S4): „selbst bewohnt“ für § 2 HeizkostenV und § 5d Abs. 3
  CO2KostAufG nur, wenn die Einheit an **jedem** Tag selbstgenutzt ist (`dwellerUnits`; in
  `agreeableFor` je Heizperiode `flagsWithin`). Die Ausnahmen greifen damit nur, wenn ihre Voraussetzung
  den ganzen Zeitraum besteht; abzurechnen nach der Verordnung ist immer zulässig. Für Garage und
  Wohnung (`isDwelling`) gilt „an einem Tag“.
- Hinweis `usage.changed` (`hint`, färbt das Cockpit nicht) nennt die Abschnitte und die Auslegung.

## 3. Steuerübersicht

- **Tagesgenau** (Durchsicht M1, damit ist der Kern von „Teil 2“ hier erledigt): `taxUsage` zählt je
  Teil im Steuerjahr die Tage je Nutzung. Selbstgenutzt heißt Anteil der Tage der Eigennutzung
  (ohne Wechsel genau 1 oder 0), außerhalb heißt an einem Tag außerhalb.
  - Umlagefähige Positionen übernehmen den Eigenanteil der Abrechnung (#163), der tagesgenau ist.
  - Nach Fläche (nicht umlagefähig, nicht verteilt, Einheiten außerhalb): selbstgenutzte Fläche ×
    Tage der Eigennutzung / Tage des Teils, über die Fläche des Gebäudes (BFH IX R 26/06).
  - Direktzuordnung nicht umlagefähiger Kosten: Betrag × Tage der Eigennutzung / Tage.
  - Ausgleich beim Betriebsstrom ohne zuordenbare Anlage (K1): dieselbe Regel über das Kalenderjahr.
  - Kopf der Anlage V: die selbstgenutzte Fläche nach Tagen, auf zwei Stellen gerundet. Die Anlage V
    fragt die eigengenutzte Fläche, ohne einen Wechsel im Jahr zu regeln; das ist eine Auslegung.
- **Leerstand vor einer Vermietung und nach einer Selbstnutzung**: Aufwendungen für eine zunächst
  selbst bewohnte, anschließend leer stehende und noch nicht vermietete Wohnung sind nur abziehbar,
  wenn der endgültige Entschluss zu vermieten durch ernsthafte und nachhaltige Vermietungsbemühungen
  belegt ist (BFH, Urteil vom 28.10.2008, IX R 1/07, Leitsatz 1, Rn. 12 f.; gelesen auf lexetius.com).
  Für eine Wohnung, die nach vorheriger, auf Dauer angelegter Vermietung leer steht, bleiben die
  Aufwendungen abziehbar, solange der Entschluss zu vermieten nicht endgültig aufgegeben ist (BFH,
  Urteil vom 11.12.2012, IX R 14/12, BFHE 239, 453; **Volltext nicht gelesen**, ungeprüft). Mietfuchs
  kennt die Vermietungsbemühungen nicht, rechnet den Leerstand als abziehbar (`vacancy` ist nicht
  privat) und sagt es im Hinweis der Steuerseite (`usageChangedUnits`).

## 4. Oberfläche

Im Seitenfenster der Einheit (Stammdaten) bleibt „Nutzung“ das Auswahlfeld (es gilt bis zum ersten
Wechsel). Darunter die Staffel „Nutzungswechsel“: je Zeile ein Datum (`type="date"`, tagesgenau wie die
Personenstaffel) und die Nutzung ab diesem Tag, „+ Wechsel ab Datum …“ fügt eine Zeile an. Die Prüfung
meldet je Zeile: Datum fehlt, kein Datum, Tag doppelt, keine Änderung gegenüber der Stufe davor. Der
Server nimmt einen Inhalt, der kein Array ist oder aus nur unbrauchbaren Einträgen besteht, mit 400 nicht
an (statt die Staffel still zu leeren); die Tabelle prüft das Datum mit `GLOB`. Die Liste der Einheiten
zeigt „vermietet bis …“ und „ab …“ je Stufe.

Wer „vermietet im Zeitraum“ oder „selbstgenutzt“ fragt, nimmt die Helfer aus shared/unitUsage.ts
(`rentedWithin`, `selfUsedWithin`, `selfUsedThroughout`, `tenancyRentedWithin`, `everRented`,
`flagsWithin`): Einzelbeträge und Umlagevereinbarung im Kostenformular, Vorschlag des Schlüssels,
Vorwahl der Wohnung für ein neues Mietverhältnis, die Warnung „Keine Wohnung beteiligt“, die Kacheln im
Cockpit, die Zuordnung der Messdienstzeilen und die Frage nach der Eigennutzung bei den CO₂-Angaben.

## 5. Bewusst offen

- **Mietverhältnis mit vermieteten Tagen in der eigenen Heizkostenabrechnung**: Es bleibt über seine
  ganze Laufzeit Nutzer, auch in einer Zeit der Eigennutzung. Nutzer, Zwischenablesungen und Gruppen
  nach § 9b Abs. 3 hängen an ganzen Mietverhältnissen, auch über die Nachbarperioden (`outerChanges`);
  ein Beschneiden müsste das alles mitziehen. Die Summen stimmen, der Hinweis sagt es.
- **Eigenbeträge laut Messdienst** (Schlüssel `amounts`, CO₂-Abzug `co2Units`): Sie sind Beträge, die der
  Messdienst je Nutzer schon aufgeteilt hat; Mietfuchs teilt sie nicht nach Tagen. Eine Einheit, die im
  Zeitraum selbstgenutzt ist, zählt mit ihrem Eigenbetrag als Eigenanteil.
- **Personenschlüssel** ohne Abschnitte (siehe oben).
- **Text der CO₂-Erstattung** (db/co2Refunds.ts) nennt „gehört nicht zur Abrechnungseinheit“ noch nach
  der Angabe von Anfang an; die Entscheidung selbst fällt nach der Abrechnung und ist richtig.
- Anzeigen, die nur beschreiben (etwa Cockpit `missingAreaCheck`), lesen teils noch die Angabe von
  Anfang an.

## 6. Tests

- Handrechnungen je Schlüssel, je Abschnitt, Hauptzähler, Heizung, Steuer (calc-nutzungswechsel.test.ts);
  `usersOf` mit Grenzen der Staffel (heating.test.ts).
- **Ohne Wechsel keine Zahl**: alle Goldens und `tax-golden.json`; ein Wechsel vor dem Zeitraum und
  genau an seinem Beginn ergibt bei jedem Schlüssel dasselbe wie die feste Angabe.
- **Invarianten**: Summen, keine negativen Anteile, Eigenanteil ≤ Vermieteranteil über Zufallsbestände;
  bei gleichbleibender Basis der Eigenanteil je Einheit nach Tagen und der Leerstand nur aus vermieteten
  Tagen; fuel-invariant mit zwei Varianten „Nutzungswechsel in B“ (Gewichte verteilen den Topf ganz).
  Mutationsproben: `outsidePhased = 0`, `wholeSelf` immer wahr, ohne Abschnitte und ohne
  `dwellerUnits` machen je einen Test rot.
- Datenbank: Lesen und Schreiben, Kaskade, 400 bei unbrauchbarem Inhalt, Migrationsmarke, dieselbe Liste
  der Nutzungen in Schema und shared/.
