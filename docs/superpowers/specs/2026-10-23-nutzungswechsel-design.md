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

Je Einheit und Zeitraum zählt calc.ts die Tage je Nutzung: `rentedDays`, `selfDays`, `outsideDays`.
Eine Einheit gehört zur Verteilbasis, wenn sie an einem Tag vermietet oder selbstgenutzt ist; ihr
Gewicht ist der Anteil dieser Tage am Zeitraum.

| Schlüssel | Verteilbasis | Eigenanteil (`selfUse`) |
| --- | --- | --- |
| Fläche | Σ m² × Tage in der Einheit / Tage des Zeitraums | Σ m² × `selfDays` / Tage |
| Einheiten | Σ Tage in der Einheit / Tage | Σ `selfDays` / Tage |
| Personen | Personentage der Mieter + `selfPersons` × `selfDays` + Leerstand | `selfPersons` × `selfDays` |
| Vereinbart | Anteil × Tage in der Einheit / Tage; außerhalb verfällt der Anteil anteilig (`outsideUnit`) | Anteil × `selfDays` / Tage |
| Gemeinschaft | Wert × Tage in der Einheit / Tage | Wert × `selfDays` / Tage |
| Verbrauch | alle Wohnungszähler wie bisher | Verbrauch der Zähler in den Tagen der Eigennutzung |
| Direkt | (eine Einheit) | Betrag × `selfDays` / Tage; außerhalb: `outsideUnit` |

- **Leerstand** sind die vermieteten Tage ohne Mietverhältnis; er bleibt wie bisher als Rest beim
  Vermieter (`vacancy`), beim Personenschlüssel mit `VACANCY_PERSONS` je Tag (#177). Eine Zeit der
  Eigennutzung ist kein Leerstand, eine Zeit außerhalb auch nicht.
- **Verbrauch**: Was die Zähler einer Einheit in ihren Tagen außerhalb messen, geht als
  `outsideUnit` an den Vermieter, wie bisher bei einer Einheit, die ganz außerhalb liegt. Der Rest des
  Hauptzählers (#116) wird nur dann Eigenanteil, wenn alle Einheiten ohne Zähler den **ganzen**
  Zeitraum selbstgenutzt sind; sonst bleibt er wie bei jeder vermieteten Wohnung ohne Zähler beim
  Vermieter mit der bekannten Warnung. Der Zähler einer Einheit muss die Tage der Eigennutzung und
  der Mietverhältnisse abdecken (`neededDays`).
- **Ein Mietverhältnis zählt nur in der vermieteten Zeit.** Das ist die Verallgemeinerung der
  bisherigen Regel: Ein Mietverhältnis in einer selbstgenutzten oder ausgenommenen Wohnung bekam nie
  einen Kostenanteil (`partTenancies` filterte nach `participates`). Für die Kosten wird das
  Mietverhältnis deshalb auf die vermieteten Tage beschnitten; überspannt es eine Zeit anderer
  Nutzung, zählt sein erster vermieteter Abschnitt (die übrigen Tage bleiben beim Vermieter, nie bei
  anderen Mietern). Die Vorauszahlungen bleiben unberührt, denn gezahlt hat der Mieter sie. Der
  Widerspruch steht als Hinweis `usage.tenancy-conflict` (Stufe `error`, sichert das Abschließen ab),
  mit den Tagen. Für Einheiten ohne Wechsel gibt es den Hinweis nicht; dort bleibt es beim bisherigen
  Verhalten ohne Meldung.
- **Eigene Heizkostenabrechnung, § 9b HeizkostenV.** Ein Wechsel der Nutzung ist ein Nutzerwechsel:
  `usersOf` (server/src/heating.ts) teilt die Zeiten ohne Mietverhältnis an den Grenzen der Staffel in
  Leerstand, Eigennutzung und außerhalb. Damit gilt alles, was beim Mieterwechsel gilt, auch für den
  Eintritt des Vermieters als Nutzer: Zwischenablesung an der Grenze (§ 9b Abs. 1), sonst Gradtage
  bzw. Zeitanteil (§ 9b Abs. 2), die Gruppe nach § 9b Abs. 3, der Hinweis zur fehlenden
  Zwischenablesung. Ein Mietverhältnis bleibt dort Nutzer, solange es läuft (wer dort wohnt, ist
  Nutzer); der Widerspruch steht schon im Hinweis oben, und der Hinweis sagt, dass er dort Nutzer bleibt.
  Das ist eine bewusste Grenze (Durchsicht, Befund 1): Die Heizperiode und ihre Nachbarn bilden die
  Nutzer über `usersOf` aus ganzen Mietverhältnissen; ein Beschneiden dort müsste die Zwischenablesungen
  und die Gruppen nach § 9b Abs. 3 mitziehen. Die Summen stimmen auch so, nur trägt der Mieter dann die
  Heizkosten der widersprüchlichen Tage, bis die Angaben berichtigt sind.
- **Ja/Nein-Fragen im Zeitraum** (§ 2 HeizkostenV, § 5d Abs. 3 CO2KostAufG, Garage, Wohnung im Sinne
  von `isDwelling`): Eine Einheit mit Wechsel im Zeitraum gilt als vermietet, wenn sie an einem Tag
  vermietet ist, und nur dann als selbst bewohnt, wenn sie an keinem Tag vermietet ist. Die Ausnahmen
  für das selbst bewohnte Zweifamilienhaus greifen damit nur, wenn ihre Voraussetzung den ganzen
  Zeitraum besteht; das ist die vorsichtige Lesart (der Vermieter muss sonst nach der Verordnung
  abrechnen, was immer zulässig ist).
- Hinweis `usage.changed` (Stufe `hint`, färbt das Cockpit nicht): nennt je Einheit die Abschnitte
  im Zeitraum, damit die Abrechnung erklärt, warum ein Eigenanteil nur für einen Teil gilt.

## 3. Steuerübersicht

- **Umlagefähige Positionen** übernehmen schon heute den Eigenanteil der Abrechnung (#163,
  `splitForTax`). Weil die Abrechnung tagesgenau rechnet, ist ihr privater Teil damit ebenfalls
  tagesgenau, ohne eigene Regel.
- **Teil 2 (eigener PR)**: Was nach Fläche geteilt wird (nicht umlagefähige Kosten, nicht verteilte
  Positionen, Einheiten außerhalb, Direktzuordnung nicht umlagefähiger Kosten), die Flächen im Kopf
  der Anlage V und die Grundsatzfrage, ob die Zeit nach einem Wechsel abziehbar ist. In Teil 1 liest
  die Steuerübersicht dafür die **Nutzung am letzten Tag des Kalenderjahres** (`unitAsOf`), und der
  Hinweis `usageChanges` der Übersicht nennt die Einheiten mit Wechsel und sagt, dass diese Teile
  noch nicht tagesgenau sind. Ohne Wechsel ist die Nutzung am Jahresende die bisherige Angabe.
- **Leerstand vor einer Vermietung und nach einer Selbstnutzung**: Aufwendungen für eine zunächst
  selbst bewohnte, anschließend leer stehende und noch nicht vermietete Wohnung sind nur abziehbar,
  wenn der endgültige Entschluss zu vermieten durch ernsthafte und nachhaltige Vermietungsbemühungen
  belegt ist (BFH, Urteil vom 28.10.2008, IX R 1/07, Leitsatz 1, Rn. 12 f.; gelesen auf lexetius.com).
  Für eine Wohnung, die nach vorheriger, auf Dauer angelegter Vermietung leer steht, bleiben die
  Aufwendungen abziehbar, solange der Entschluss zu vermieten nicht endgültig aufgegeben ist (BFH,
  Urteil vom 11.12.2012, IX R 14/12, BFHE 239, 453; **Volltext nicht gelesen**, Inhalt nach den
  Zusammenfassungen und nach dem Zitat in späteren Urteilen, ungeprüft). Mietfuchs kennt die
  Vermietungsbemühungen nicht. Es rechnet den Leerstand deshalb weiter als abziehbar (`vacancy` ist
  nicht privat) und sagt im Hinweis `usage.vacancy-after-self` (Stufe `hint`), dass das nach einer
  Eigennutzung nur mit belegten Vermietungsbemühungen gilt. Gerechnet wird nichts davon; das bleibt
  ein Hinweis, weil die Antwort an Tatsachen hängt, die nur der Vermieter kennt.

## 4. Oberfläche

Im Seitenfenster der Einheit (Stammdaten) bleibt „Nutzung“ das Auswahlfeld, jetzt mit dem Hinweis „von
Anfang an“. Darunter die Staffel „Nutzungswechsel“: je Zeile ein Datum (`type="date"`, tagesgenau
wie die Personenstaffel) und die Nutzung ab diesem Tag, „+ Wechsel ab Datum“ fügt eine Zeile an. Die
Prüfung meldet je Zeile und Feld (`Problem`), gespeichert wird mit dem Rumpf der Einheit. Die Liste
der Einheiten zeigt die Nutzung heute und „ab …“ beim nächsten Wechsel.

## 5. Tests

- Handrechnungen je Schlüssel, Direktzuordnung, Verbrauch, Personen samt Leerstand, Widerspruch mit
  einem Mietverhältnis (calc-nutzungswechsel.test.ts); `usersOf` mit Grenzen der Staffel.
- **Ohne Wechsel keine Zahl**: alle bestehenden Goldens und `tax-golden.json`; dazu ein Test, dass ein
  Wechsel vor oder nach dem Zeitraum dasselbe ergibt wie die entsprechende feste Angabe.
- **Invariante über Zufallsbestände mit Nutzungswechseln**: Mieteranteile + Vermieteranteil =
  Gesamtkosten, kein negativer Anteil, Eigenanteil ≤ Vermieteranteil.
- Datenbank: Lesen und Schreiben über `PUT /api/units`, Kaskade beim Löschen, Migrationsmarke.
