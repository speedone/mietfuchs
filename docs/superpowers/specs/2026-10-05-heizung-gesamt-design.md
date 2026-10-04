# Spezifikation: Heizung gesamt (Meilenstein 0.11.0)

- **Fassung:** erste Gesamtfassung vom 05.10.2026.
- **Ersetzt** die drei Teilentwürfe. Sie bleiben als Herleitung auf ihren Zweigen liegen, gelten aber nicht mehr:
  - CO₂-Kostenaufteilung, 3. Fassung (`feat/co2-kostenaufteilung`, `docs/superpowers/specs/2026-10-04-co2-kostenaufteilung-design.md`);
  - Abrechnungszeitraum (`feat/abrechnungszeitraum`, `…/2026-10-05-abrechnungszeitraum-design.md`);
  - Eigene Heizkostenabrechnung (`feat/heizkostenabrechnung`, `…/2026-10-05-heizkostenabrechnung-design.md`).

  Eingearbeitet sind außerdem die Gegenprüfung des CO₂-Entwurfs (19 Befunde), der Marktvergleich vom 04.10.2026, die Abschlussprüfung der CO₂-Fassung 3 (sechs Punkte) und die Vorgabe zur Architektur für Rechtsänderungen.
- **Codestand:** `main` mit v0.10.1. Es gibt eine Rundungsregel aus #202 (`distributeCents`, `distributeLaborCents`, `landlordRecipients` mit `take()` in calc.ts) und das Regelverzeichnis aus #112 (`server/src/rules.ts`). Die nächste freie Migration ist `0014`.
- **Issues:** #85, #97, #99, #103, #180 (Teil Zweifamilienhaus), #208, #209, #210, #211, #212, #213, #214, #215, #217. Wo jedes Issue steht, zeigt die Tabelle in Abschnitt 14.2.

## 0. Wie dieser Entwurf mit Recht umgeht

**Vorgabe des Nutzers:** Jede fachliche Regel muss rechtlich zu 100 % stimmen. Eigene Annahmen sind nicht erlaubt. Ist etwas unklar, wird recherchiert, und der Entwurf folgt etablierter Software und Praxis. Daraus folgen vier Arbeitsregeln für dieses Dokument.

### 0.1 Rangfolge der Quellen

Jede Regel nennt ihre Quelle direkt an der Stelle, an der sie steht. Gilt mehr als eine, zählt die höhere Stufe.

| Stufe | Quelle | Kennung im Text |
|---|---|---|
| 1 | Gesetz oder Verordnung, nachgelesen auf gesetze-im-internet.de oder recht.bund.de | **[G]** |
| 2 | Rechtsprechung mit Aktenzeichen und Datum | **[R]** |
| 3 | Technische Regel: VDI 2077, VDI 2067, DIN EN 834, DIN EN 1434 | **[T]** |
| 4 | Dokumentierte Praxis der Messdienste (Merkblätter, Musterabrechnungen, Fachwissenseiten) | **[M]** |
| 5 | Etablierte Software, soweit dokumentiert | **[S]** |

### 0.2 Prüfstand der Quellen

| Kennzeichen | Bedeutung |
|---|---|
| **geprüft 05.10.** | Für diesen Entwurf am 05.10.2026 an der Quelle gelesen. Bei Urteilen genügen Leitsatz und Kernaussage aus einer Sekundärquelle, die mit Link angegeben ist. |
| **übernommen** | Steht so in einem Teilentwurf, der es mit Datum geprüft hat (CO₂: 04.10.2026, Heizkostenabrechnung: 04.10.2026). Hier nicht erneut gelesen. |
| **ungeprüft** | Aktenzeichen, Wortlaut oder Zahl konnte ich nicht an einer Primärquelle bestätigen. Bei der Umsetzung ist das vor dem Merge nachzuholen, und die Durchsicht der jeweiligen PR prüft es. |

**Nicht zugänglich: VDI 2077 und VDI 2067.** Beide Regeln sind kostenpflichtig, ich habe sie nicht im Wortlaut gelesen. Wo der Entwurf sich auf sie stützt, geschieht das nur über Messdienste oder Mietervereine, die sie wiedergeben. Diese Stellen sind als [M] gekennzeichnet und nicht als [T]. Vor der PR, die eine solche Regel umsetzt, wird die Norm beschafft (Beuth oder eine Bibliothek), oder die Regel bleibt in Abschnitt 15.2.

### 0.3 Was nicht belegt ist, steht an einer Stelle

Mietfuchs-eigene Festlegungen, für die sich keine Quelle fand, stehen **gesammelt in Abschnitt 15.2, „Verbleibende Festlegungen ohne Primärquelle“**. Zu jeder gibt es dort:

- den Rechercheweg,
- die gewählte Lösung (die konservativste oder die verbreitetste),
- den Hinweis, den der Vermieter dazu sieht.

Gegenüber den Teilentwürfen ist die Liste deutlich kürzer geworden. Diese Festlegungen sind **entfallen**, weil sie keine Quelle hatten und eine belegte Regel sie ersetzt:

| Entfallene Festlegung | Ersetzt durch | Abschnitt |
|---|---|---|
| „±1 Tag gilt als Stichtag, bis 14 Tage wird fortgeschrieben“ | § 9b Abs. 3 HeizkostenV und Stichtagsspeicher der Geräte | 3.5 |
| Grenze von 75 % bei der Hochrechnung | Umrechnung nach § 5 Abs. 1 S. 5 CO2KostAufG ohne Grenze, dazu eine Warnung | 3.3 |
| Zuordnung einer Jahresrechnung zum Zeitraum mit der größten Überschneidung | Leistungsprinzip mit zeitanteiliger Aufteilung | 3.4 |
| Toleranz der Summenprobe von 1 € | aus der Rundung hergeleitete Schranke | 7.3 |

### 0.4 Rechtsaussagen aus den Teilentwürfen

Stichprobenartig gegen die Primärquelle geprüft wurden:

- CO2KostAufG § 5, § 5a und § 11 Abs. 2 sowie HeizkostenV § 9b (gesetze-im-internet.de, 05.10.2026);
- die Urteile BGH VIII ZR 240/07, VIII ZR 49/07, VIII ZR 156/11, VIII ZR 316/10, VIII ZR 151/20, VIII ZR 19/07 und VIII ZR 112/10 (Leitsätze über die Fundstellen in Abschnitt 17).

Alle übrigen Normzitate sind **übernommen** und mit ihrem Prüfdatum aus dem Teilentwurf gekennzeichnet.

**Zwei Aussagen der Teilentwürfe mussten berichtigt werden:**

1. **BGH VIII ZR 240/07 beantwortet die Frist eindeutig**, und zwar anders als der Vorschlag „frühere der beiden Fristen“. Die Frist beginnt mit dem Ende des Zeitraums der Gesamtabrechnung (Abschnitt 3.1).
2. **Für die Abgrenzung einer Versorgerrechnung** empfehlen die Messdienste weder Tage noch Gradtage. Ihr erster Weg ist der Zählerstand zum Stichtag, eine Zwischenrechnung des Versorgers oder gleiche Zeiträume ([M] Minol). Mietfuchs folgt dem (Abschnitt 3.2).

---

## 1. Die Entscheidungen auf einen Blick

### 1.1 Widersprüche zwischen den Teilentwürfen

| # | Widerspruch | Entscheidung | Begründung, Quelle | Abschnitt |
|---|---|---|---|---|
| W1 | **Eigener Heizzeitraum:** #99 sagt nein, #217 sagt ja. | **Ja, in 0.11.0.** Eine Heizanlage kann einen eigenen Zeitraum haben, etwa Juli bis Juni oder Mai bis April, neben dem Zeitraum des Objekts für die übrigen Kosten. Jede Heizperiode gehört in die Gesamtabrechnung des Objektzeitraums, **in dem sie endet**. Die Frist richtet sich nach dem Zeitraum der Gesamtabrechnung. Mieter, die nur in der Heizperiode gewohnt haben, bekommen eine Abrechnung, die nur aus den Heizkosten besteht. | [R] BGH 30.04.2008, VIII ZR 240/07: Die Gesamtabrechnung ist formell wirksam, auch wenn der Zeitraum der Heizkosten abweicht, und die Frist beginnt mit dem Ende des Kalenderjahres der Gesamtabrechnung (geprüft 05.10.). | 3.1 |
| W2 | **Abgrenzung einer Brennstoffrechnung über den Zeitraumwechsel:** tagesgenau (CO₂-Entwurf, Fall F7) gegen Gradtage (#99). | **Ein Verfahren** für Brennstoffkosten, kg CO₂ und CO₂-Kosten, in dieser Reihenfolge: (1) Zählerstand des Versorgungszählers zum Stichtag, (2) Zwischenrechnung des Versorgers, (3) Gradtagszahlen als rechnerische Abgrenzung. Tagesgenau gibt es nicht. Ein Wert, den der Vermieter einträgt, ist immer möglich. | [R] VIII ZR 156/11: nur verbrauchter Brennstoff. [G] § 5 Abs. 1 S. 5 CO2KostAufG: umzurechnen. [M] Minol: Zwischenrechnung zum Stichtag. Gradtage als Fallback stehen in 15.2. | 3.2 |
| W3 | **Kennung des Zeitraums:** `202505` in der vorhandenen Spalte `year` (#208) gegen eine eigene Kennung. | **Eigene Kennung** `period` als Text `JJJJ-MM`, der Monat des Beginns. Die Spalte `year` wird per Datenanweisung umgezogen (`2025` → `'2025-01'`). Die Zeiträume werden **berechnet** (Rhythmus und Wechsel am Objekt, wie #208) und nicht als Zeilen gespeichert. | Der Zahlenschlüssel macht aus jedem `year - 1` und jedem `year >= 2023` einen stillen Fehler. Mit einem eigenen Typ zeigt der Übersetzer jede Stelle. Steuer und Mietkonto bleiben beim Kalenderjahr als Zahl, also zwei Typen für zwei Bedeutungen. | 3.0, 5.2 |
| W4 | **Hochrechnung bei Lücken** (CO₂ v3: hochrechnen, Abschlussprüfung: Grenze 75 %) | **Umgerechnet wird nur der Ausstoß E**, und nur für die Einstufung, nach § 5 Abs. 1 S. 5 mit demselben Verfahren wie W2. **Die CO₂-Kosten C und die Brennstoffkosten werden nicht hochgerechnet**, abgezogen wird nur, was in Rechnung steht. Eine Grenze gibt es nicht. Jede Lücke ergibt die Warnung `fuel.uncovered` mit Tagen und Promille. | Eine Grenze von 75 % ist nirgends belegt. Würde C hochgerechnet, bekäme der Mieter CO₂-Kosten gutgeschrieben, die ihm gar nicht berechnet wurden. | 3.3, 15.2 |
| W5 | **Bestand und Lieferungen:** `co2_deliveries` (CO₂-Entwurf) gegen `cost_item_fuel` (#99). | **Eine Tabelle `fuel_deliveries` an der Heizanlage.** Eine Lieferung kann auf eine Kostenposition zeigen (bei eigener Abrechnung ist die Rechnung die Position) oder für sich stehen (beim Messdienst steckt der Brennstoff in dessen Beträgen, die Gasrechnung liefert nur kg und €). Den Bestand führt `heating_periods`, und zwar einmal. | Sonst stünde die Gasrechnung im Fall F3 doppelt als Kosten, einmal selbst und einmal in den Messdienstbeträgen. | 5.4 |
| W6 | **Name der Anlage:** `heating_systems` (#99) gegen `heating_plants` (Abschlussprüfung). | `heating_plants`, `heating_plant_units`. | Die Abschlussprüfung hat das so festgelegt. | 5.3 |
| W7 | **Wer legt welche Tabelle an, Sperren zwischen den PRs** | Es gibt **eine** Reihenfolge der PRs (Abschnitt 13). Jede Tabelle legt genau eine PR an. Funktionen, die erst eine spätere PR rechnet, lehnt der Server bis dahin mit 400 und einem Satz ab. | Keine Migration wird nach einem Rebase neu erzeugt, und keine Zahl ist zwischendurch falsch. | 13 |
| W8 | **`biomass` (CO₂-Entwurf) gegen `pellets`, `wood` (#99)** | Die Anlage führt `pellets` und `wood` getrennt. CO₂ liest beide als „nicht erfasst“. | Die Heizwerte nach § 9 Abs. 3 HeizkostenV sind verschieden ([G] übernommen). | 5.3 |
| W9 | **Abgleich der Probe** (`co2.sum-check` über alle Positionen, Abschlussprüfung Punkt 1) | Die Probe läuft nur über die **Messdienstpositionen** des Topfs, also die Positionen mit Schlüssel `amounts`. Jede andere Position im Topf ergibt den Hinweis `co2.pool-foreign-item`. | Gutschrift des Versorgers und Wartung sind keine Messdienstbeträge. | 7.3 |
| W10 | **Reihenfolge von `take()`** (Abschlussprüfung Punkt 3) | Reicht der Rest nicht für beide Teile von L, werden **beide anteilig gekürzt**. | So verschiebt ein Datenfehler weder den abziehbaren noch den privaten Teil zugunsten des anderen. | 7.4 |

### 1.2 Was sich insgesamt ergibt

1. **Wer nichts einstellt, merkt nichts.** Ohne Heizanlage, ohne CO₂-Angaben und mit Kalenderjahr bleibt jede Zahl centgenau gleich. Golden F01–F11 bleiben unverändert, ebenso die db.json-Fixtures. Neu ist für Heizpositionen ab 2023 der Hinweis zur CO₂-Aufteilung. Er wird angekündigt.
2. **Drei Wege durch die Heizung**, gewählt an der Anlage. `method` legt den Weg fest:
   - `service`: Messdienst oder Hausverwaltung liefern Einzelbeträge;
   - `self`: eigene Heizkostenabrechnung nach HeizkostenV;
   - `manual`: Positionen mit freien Schlüsseln wie heute, mit den Warnungen aus #140.

   Die CO₂-Aufteilung hängt an der Anlage und folgt jedem der drei Wege.
3. **Zeiträume:**
   - Objektzeitraum mit Rhythmus und Wechseln (#208);
   - eigener Heizzeitraum je Anlage (#217);
   - Rumpfzeiträume entstehen von selbst und sind nie länger als zwölf Monate;
   - Steuer und Mietkonto rechnen weiter im Kalenderjahr.
4. **Rechtsregister** in `shared/law/`: jeder Rechtswert mit Gültigkeit, Fundstelle und Zeitregel. Die benutzten Werte frieren mit der abgeschlossenen Abrechnung ein. Ein Wächtertest verbietet Rechtszahlen außerhalb des Registers.
5. **Kürzungen** werden je Mieter beziffert und jede einzeln genannt, nie als Summe: 15 % (§ 12 Abs. 1 S. 1), 3 % (§ 12 Abs. 1 S. 2), 3 % (§ 12 Abs. 1 S. 3) und 3 % (§ 7 Abs. 4 CO2KostAufG).
6. **Aufwand:** 23 PRs (0–22), rund **56–65 Arbeitstage** (Abschnitt 13). Das ist das größte Release bisher. Die Reihenfolge erlaubt es, nach jeder Phase auszuliefern.

---

## 2. Rechtsgrundlagen im Überblick

Der Wortlaut steht in den Teilentwürfen und wird hier nicht wiederholt. Die Tabelle nennt, was die Rechnung trägt, und den Prüfstand nach 0.2.

| Norm | Inhalt, soweit Mietfuchs ihn rechnet | Prüfstand |
|---|---|---|
| [G] § 556 Abs. 3 S. 1, 2 BGB | jährlich abrechnen; Frist bis zum Ablauf des zwölften Monats nach Ende des Zeitraums | übernommen (#208) |
| [G] § 560 Abs. 4 BGB | Anpassung der Vorauszahlung nach der Abrechnung auf eine angemessene Höhe | übernommen (Bestand #134) |
| [G] § 11 Abs. 1, 2 EStG | Zufluss und Abfluss im Kalenderjahr | übernommen (#70) |
| [G] HeizkostenV §§ 1–12 | Anwendungsbereich, Erfassung, 50–70 %, Brennstoff nach Verbrauch, § 9 Warmwasser, § 9a Schätzung, § 9b Nutzerwechsel, § 6a Informationen, § 12 Kürzung | übernommen (04.10.); § 9b geprüft 05.10. |
| [G] CO2KostAufG §§ 2–9, 11, Anlage | Einstufung, Rundung, Kürzung der Tabelle, Umrechnung, § 8, § 9, Ausweis, 3 % | übernommen (04.10.); §§ 5, 11 geprüft 05.10. |
| [G] § 5a CO2KostAufG (seit 29.07.2026) | hälftige Teilung für Anlagen nach § 43 Abs. 1 GModG: Netzentgelte und CO₂-Kosten, die **im Abrechnungszeitraum ab dem 01.01.2028 angefallen** sind, Biobrennstoff ab 01.01.2029 (höchstens 30 %), „unter entsprechender Anwendung von § 5 Abs. 1 Satz 5“ | Abs. 1 geprüft 05.10. im Wortlaut. Abs. 3 nur in Zusammenfassung gelesen, **Wortlaut zu Abs. 3 Nr. 2 (CO₂) ungeprüft** |
| [G] MessEV Anlage 7 | Eichfrist von Wärme-, Warm- und Kaltwasserzählern einheitlich sechs Jahre, seit 02.11.2021 (davor fünf Jahre für Wärme und Warmwasser) | **ungeprüft im Wortlaut**, nur [M] ista |
| [R] BGH VIII ZR 240/07, 30.04.2008 | abweichender Heizzeitraum in der Gesamtabrechnung zulässig; Frist ab Ende des Zeitraums der Gesamtabrechnung | geprüft 05.10. (rewis.io) |
| [R] BGH VIII ZR 49/07, 20.02.2008 | Abflussprinzip bei kalten Betriebskosten zulässig; das Leistungsprinzip ist nicht vorgeschrieben | geprüft 05.10. (Berliner Mieterverein) |
| [R] BGH VIII ZR 156/11, 01.02.2012 | Heizkosten nur nach verbrauchtem Brennstoff; die Kürzung nach § 12 heilt das nicht | geprüft 05.10. (rewis.io, Minol, IKZ) |
| [R] BGH VIII ZR 316/10, 27.07.2011 | einmalige **vereinbarte** Verlängerung über zwölf Monate zur Umstellung zulässig | geprüft 05.10. (Berliner Mieterverein, Haufe) |
| [R] BGH VIII ZR 151/20, 12.01.2022 | ohne Wärmezähler für das Warmwasser darf der Mieter um 15 % kürzen, auch bei HKV und Warmwasserzählern | geprüft 05.10. (Berliner Mieterverein) |
| [R] BGH VIII ZR 19/07, 14.11.2007 | Kosten der Zwischenablesung sind keine Betriebskosten, außer bei Vereinbarung | geprüft 05.10. (Berliner Mieterverein) |
| [R] BGH VIII ZR 112/10, 17.11.2010 | Werte eines nicht geeichten Zählers sind verwertbar, wenn der Vermieter ihre Richtigkeit beweist; nur beim geeichten Zähler wird die Richtigkeit vermutet | geprüft 05.10. (LTO, Berliner Mieterverein) |
| [R] BGH VIII ZR 159/05, VIII ZR 212/05, VIII ZR 180/12 | Leerstand trägt der Vermieter; Warmmiete; fiktive Person beim Leerstand | übernommen (Bestand #93, #177) |
| [R] BGH V ZR 166/15, 03.06.2016 | Schätzung des Betriebsstroms ist zulässig (WEG) | **ungeprüft** |
| [R] BGH VIII ZR 46/25, 47/25, 20.05.2026 | § 556c BGB greift nicht, wenn vorher mit Einzelöfen geheizt wurde | **ungeprüft** (aus #97, Durchsicht 02.10.) |

---

## 3. Zeiträume

Dieser Abschnitt klärt jede Facette abweichender Zeiträume rechnerisch und rechtlich. Zuerst kommen das Modell (3.0) und die Matrix (3.M), dann die Einzelheiten je Facette (3.1–3.13).

### 3.0 Das Modell

**Drei Zeitbegriffe, drei Typen:**

| Begriff | Typ | Woher | Wofür |
|---|---|---|---|
| **Abrechnungszeitraum des Objekts** P | `PeriodKey` = `'JJJJ-MM'` (Beginnmonat) | `properties.period_start_month` und `period_changes` | Gesamtabrechnung, Vorauszahlungen, Frist, kalte Kosten |
| **Heizperiode** H einer Anlage | `PeriodKey` derselben Form | `heating_plants.period_start_month` (null bedeutet: wie das Objekt) und `heating_period_changes` | Heizkosten, CO₂, Brennstoff, Ablesungen der Heizung |
| **Kalenderjahr** | `number` | – | Steuer (Anlage V), Mietkonto |

**Berechnet, nicht gespeichert (aus #208 übernommen):**

- Aus einem Beginnmonat und einer Liste von Wechseln (`JJJJ-MM`) entstehen lückenlose, überschneidungsfreie Zeiträume von höchstens zwölf Monaten.
- Vor jedem Wechsel steht ein **Rumpfzeitraum**. Er endet am Tag vor dem Wechsel.
- Kein Zeitraum beginnt im selben Monat wie ein anderer. Deshalb ist der Beginnmonat eine eindeutige Kennung, auch über Rumpfzeiträume hinweg. Beispiel: Rumpf 01.01.–30.04.2025 = `'2025-01'`, danach `'2025-05'`.
- Die Rechnung steht einmal in `shared/period.ts`, denn Server und Oberfläche brauchen sie gleich:
  - `periodOfKey(rules, key)`
  - `periodContaining(rules, date)`
  - `periodsBetween`
  - `previousPeriod`
  - `periodLabel` („2025“, „2025/2026“, „01.01.–30.04.2025“)
  - `settlementDeadline`

**Zuordnung von H zu P:** Eine Heizperiode gehört in die Gesamtabrechnung des Objektzeitraums, der **ihr Ende enthält** (`periodContaining(objectRules, H.to)`).

- Bei gleichem Rhythmus ist H = P.
- Bei zwei Zwölfmonatsrhythmen endet in jedem P genau ein H.
- Nur ein Wechsel kann zwei H in ein P legen (beide werden abgerechnet) oder keines (der Hinweis `period.no-heating-period` sagt es).
- Grundlage: [R] VIII ZR 240/07 lässt die abweichende Heizperiode in der Gesamtabrechnung zu. Dass es die zuletzt **beendete** Periode ist, folgt daraus, dass zum Abrechnen ihre Verbrauchswerte vorliegen müssen. Im Fall des BGH war es die Heizperiode August bis Juli in der Kalenderjahresabrechnung. **Welche der beiden Perioden der BGH-Fall im Einzelnen einstellte, ist ungeprüft.** Die Regel „endet in P“ ist die einzige, bei der die Abrechnung im Zeitpunkt der Erstellung vollständig sein kann. Sie steht deshalb zusätzlich in 15.2.

### 3.M Die Matrix

Jede Zeile hat unten einen eigenen Unterabschnitt mit Zahlenbeispiel.

| # | Facette | Rechtsgrundlage | Rechenverfahren | Messdienste, Software | Mietfuchs und Hinweis |
|---|---|---|---|---|---|
| 1 | Zeitraum des Messdienstes ≠ Zeitraum des Vermieters | [R] VIII ZR 240/07 | Heizperiode H in die Gesamtabrechnung P, die ihr Ende enthält; keine Umrechnung | [M] Messdienste rechnen jeden Zeitraum ab. [S] immocloud und Immoware24: freie Zeiträume | Eigener Heizzeitraum an der Anlage. Hinweis `period.heating-differs` (hint) |
| 2 | Versorgerrechnung mit eigenem Zeitraum | [G] § 7 Abs. 2 HeizkostenV, [R] VIII ZR 156/11, [G] § 5 Abs. 1 S. 5 CO2KostAufG | Zählerstand zum Stichtag, sonst Zwischenrechnung, sonst Gradtage | [M] Minol: Zwischenrechnung oder gleiche Zeiträume | `fuel_deliveries` mit Anteil je H. Hinweise `fuel.share-by-degree-days` (hint) und `fuel.uncovered` (warning) |
| 3 | Jahresrechnung (Grundsteuer, Versicherung) bei abweichendem P | [R] VIII ZR 49/07 (Leistungs- oder Abflussprinzip) | Leistungsprinzip: zeitanteilig auf die berührten P, Restcent nach Kennung | [S] Immoware24: Abgrenzungsdatum und Splitbuchung | Beim Speichern automatisch in zwei Positionen aufgeteilt, mit Vorschau |
| 4 | Mieterwechsel | [G] § 9b HeizkostenV; [M] ista und Berliner Mieterverein: Gradtagstabelle; [R] VIII ZR 19/07 | Zwischenablesung, Grundkosten nach Gradtagen oder Tagen, Warmwasser nach Tagen; ohne Zwischenablesung alles nach Abs. 3 | [M] ista, Minol, ARGE: Verdunster nur bei 400–800 ‰ | Ablesung am Wechseltag, sonst § 9b Abs. 3. Hinweis `heating.no-interim-reading` |
| 5 | Ablesung nicht am Stichtag | [G] § 9a HeizkostenV; VDI 2077 nicht gelesen | Stichtagswert aus dem Gerätespeicher; sonst gleiches Ablesedatum aller Einheiten eines Topfs; sonst § 9a | [M] ista: Geräte speichern den Stichtagswert | Feld „Stichtagswert“. Hinweis `heating.reading-dates-differ` |
| 6 | Wechsel des Zeitraums oder des Messdienstes | [G] § 556 Abs. 3 BGB; [R] VIII ZR 316/10 | Rumpfzeitraum ≤ 12 Monate; Verlängerung nur vereinbart | [M] Brunata: Auftrag zur Änderung des Zeitraums | Wechsel mit Vorschau. Hinweis `period.short` |
| 7 | Vorauszahlungen | [G] § 556 Abs. 3, § 560 Abs. 4 BGB; [R] VIII ZR 240/07 | angerechnet werden die Monate von P; Anpassung auf zwölf Monate hochgerechnet | – | `ledgerRows` über die Monate von P |
| 8 | Abrechnungsfrist | [G] § 556 Abs. 3 S. 2, 3 BGB; [R] VIII ZR 240/07 | zwölf Monate nach Ende von P, auch für eine abweichende Heizperiode | – | `settlementDeadline(P)` |
| 9 | CO₂ und Zeiträume | [G] §§ 5 Abs. 1 S. 4, 5, 11 Abs. 2, 5a CO2KostAufG | Anwendbar ab Beginn von H ≥ 01.01.2023; Tabelle gekürzt bei H < 1 Jahr; Lieferungen wie Facette 2; § 5a anteilig nach Anfall | [S] BMWK-Rechner (übernommen) | Rechnet auf H. Hinweise in 10.1 |
| 10 | Steuer | [G] § 11 EStG | Werbungskosten nach Steuerjahr der Position, Eigenanteil aus der Abrechnung ihres Zeitraums | – | `tax_year` |
| 11 | Mietkonto | – (Kalendermonate) | unverändert | – | Satz zum Zeitraum der Abrechnung |
| 12 | Zählerwechsel, Eichung | [G] MessEV Anlage 7 (ungeprüft); [R] VIII ZR 112/10 | Wechsel über Endstand; nicht geeicht → Beweislast beim Vermieter | [M] ista | Hinweis `meter.calibration-overdue` |
| 13 | Rechtsänderung mitten im Zeitraum | je Parameter (Abschnitt 4.3) | Zeitregel je Parameter: Beginn, Überdeckung, Anfall, Ereignisdatum | – | Register, Rechtsstand mit benutzten Werten |

### 3.1 Facette 1: Zeitraum des Messdienstes ≠ Zeitraum des Vermieters

**Rechtsgrundlage.** [R] BGH 30.04.2008, VIII ZR 240/07 (geprüft 05.10.):

- Leitsatz a: Eine Gesamtabrechnung ist **nicht formell unwirksam**, wenn der Zeitraum einer eingestellten Abrechnung verbrauchsabhängiger Kosten nicht deckungsgleich ist. Im Fall war das die Heizperiode August bis Juli in einer Kalenderjahresabrechnung.
- Leitsatz b: Die Frist für die Abrechnung der Vorauszahlungen beginnt mit dem **Ende des Kalenderjahres**, also mit dem Zeitraum der Gesamtabrechnung.
- Eine gesonderte Heizkostenabrechnung ist nicht nötig, wenn einheitliche Vorauszahlungen vereinbart sind.

Für die Heizkosten selbst gilt daneben [R] VIII ZR 156/11: Sie müssen den Verbrauch der **Heizperiode** abbilden, und das tut die Messdienstabrechnung für ihren Zeitraum von sich aus.

**Drei Wege, und welchen Mietfuchs vorschlägt:**

| Weg | Rechtlich | Wann |
|---|---|---|
| a) Ganzes Haus im Zeitraum des Messdienstes (Objekt beginnt im Mai) | zulässig (§ 556 Abs. 3 BGB) | Wenn der Mietvertrag keinen Zeitraum festlegt oder ohnehin Mai bis April nennt. Ein Wechsel braucht sonst die Zustimmung der Mieter (übernommen aus #208: Berliner Mieterverein, BMGEV). |
| b) **Eigener Heizzeitraum**, übrige Kosten im Kalenderjahr | zulässig ([R] VIII ZR 240/07) | Vorschlag, wenn das Objekt schon Daten im Kalenderjahr hat. Der Vertrag bleibt unberührt, und es gibt keinen Rumpfzeitraum. |
| c) Messdienstwerte auf das Kalenderjahr umrechnen | **nicht möglich**: Für den Jahreswechsel fehlen die Ablesungen der Wohnungen, und eine Umrechnung nach Tagen oder Gradtagen ersetzt nach § 9b keine Ablesung | nicht angeboten |

**Rechenverfahren (Weg b).** Die Anlage hat H = Mai bis April, das Objekt P = Kalenderjahr.

- Die Gesamtabrechnung 2026 (P = 01.01.–31.12.2026) enthält die Heizperiode 01.05.2025–30.04.2026, denn diese endet in P.
- Kalte Kosten, Vorauszahlungen und Leerstand der kalten Kosten rechnen über P.
- Die Heizpositionen (Schlüssel `amounts` des Messdienstes) gehören zu H.

**Zahlenbeispiel: Mieter mit Auszug.**

- Mieter M wohnt bis 31.10.2025 und zahlt 200 € Vorauszahlung im Monat. Nachmieterin N wohnt ab 01.11.2025.
- **Abrechnung 2025:**
  - enthält H = 01.05.2024–30.04.2025;
  - M: Heizkosten laut Messdienst für H, kalte Kosten 01.01.–31.10.2025, Vorauszahlungen Januar bis Oktober 2025 (2.000 €).
- **Abrechnung 2026:**
  - enthält H = 01.05.2025–30.04.2026;
  - M bekommt eine **Abrechnung nur mit Heizkosten**: seine Messdienstbeträge für 01.05.–31.10.2025, ohne kalte Kosten und ohne Vorauszahlungen, denn alle hat die Abrechnung 2025 angerechnet;
  - N: Heizkosten ab 01.11.2025 und kalte Kosten 2026.
- Über beide Jahre zahlt M jede Leistung genau einmal, und jede Vorauszahlung wird genau einmal angerechnet. Das ist die Lage des BGH-Falls (dort Mieter bis 31.05.2004).

**Mieterabrechnung:** Kopf „Betriebskosten 2026, darin Heiz- und Warmwasserkosten 01.05.2025–30.04.2026“. Im Ausdruck steht der Zeitraum jeder Kostengruppe.

**Messdienste und Software:**

- [M] Messdienste rechnen jeden vereinbarten Zeitraum ab, Brunata bietet dafür einen eigenen Auftrag zur Änderung an.
- [S] immocloud (Zeitraum frei) und Immoware24 (Abrechnungszeiträume frei) laut Marktvergleich.
- Eine eigene Heizperiode neben dem Kalenderjahr ist bei keinem privaten Programm dokumentiert.

**Hinweise:**

- `period.heating-differs` (hint): „Die Heizkosten umfassen 01.05.2025–30.04.2026, die übrigen Kosten das Kalenderjahr 2026. Das ist zulässig (BGH VIII ZR 240/07).“
- `period.heating-only-statement` (hint, je Mieter): „Für {Name} enthält diese Abrechnung nur Heizkosten, weil er im Kalenderjahr nicht mehr gewohnt hat.“

### 3.2 Facette 2: Versorgerrechnung mit eigenem Zeitraum

**Rechtsgrundlage:**

- [G] § 7 Abs. 2 HeizkostenV: Kosten der „verbrauchten Brennstoffe“ (übernommen).
- [R] VIII ZR 156/11: kein Abflussprinzip bei Heizkosten (geprüft 05.10.).
- [G] § 5 Abs. 1 S. 5 CO2KostAufG: Weichen die Zeiträume der Brennstoff- oder Wärmelieferungen ab, sind sie auf den vereinbarten Zeitraum **umzurechnen** (geprüft 05.10.). Eine Methode nennt das Gesetz nicht.

**Was die Praxis tut:** [M] Minol (Fachbeitrag zum Abflussprinzip, geprüft 05.10.) empfiehlt drei Wege:

1. eine **Zwischenabrechnung des Versorgers auf Basis des Zählerstands zum Stichtag**,
2. den Zeitraum an den des Versorgers angleichen,
3. mit dem Versorger einen anderen Zeitraum vereinbaren.

Eine rein rechnerische Abgrenzung nennt Minol nicht. Die Ratgeberliteratur nennt „Zwischenablesung, Zwischenrechnung oder nachvollziehbare rechnerische Aufteilung“ (nebenkostenabrechnung.com u. a., Rang unter [M]).

**Verfahren in Mietfuchs.** Je Lieferung d und Heizperiode H gilt die erste zutreffende Stufe:

1. **Gemessen:** Die Anlage hat einen Versorgungszähler (Gas, Wärme, Wärmepumpenstrom; Zählerrolle `supply`) mit Ständen am Beginn und Ende von H **und** an den Grenzen der Rechnung. Dann ist der Anteil = Verbrauch in H ∩ Rechnungszeitraum / Verbrauch im Rechnungszeitraum. Damit setzt Mietfuchs den ersten Weg von Minol selbst um: Der Vermieter liest den Gaszähler zum Stichtag ab, und die Rechnung wird nach Menge geteilt.
2. **Zwischenrechnung:** Der Vermieter erfasst die Zwischenrechnung des Versorgers als eigene Lieferung. Dann deckt jede Lieferung H ganz oder gar nicht ab, und der Anteil ist 1 oder 0.
3. **Rechnerisch nach Gradtagen:** Anteil = Gradtage(H ∩ Rechnungszeitraum) / Gradtage(Rechnungszeitraum). Die Tabelle steht in 4.4. Das ist eine **Festlegung ohne Primärquelle** und steht deshalb auch in 15.2. Begründung: Unter den rechnerischen Wegen ist die Gradtagstabelle der einzige, den Verordnung und Praxis für die zeitliche Verteilung von Heizwärme kennen (§ 9b Abs. 2 HeizkostenV, [M] ista, Berliner Mieterverein). Tagesgenau verschöbe Winterverbrauch in den Sommer.
4. **Eingetragen:** `share_permille` des Vermieters überschreibt alles. Der Ausweis sagt dann „Anteil vom Vermieter festgelegt“.

**Dasselbe Verhältnis gilt für Brennstoffkosten, kg CO₂, CO₂-Kosten, Netzentgelte und Biobrennstoffkosten** derselben Rechnung. Sie gehören zur selben Menge, und ein zweites Verfahren für CO₂ hätte Einstufung und Kosten auf verschiedene Mengen gestützt. Damit ist W2 aufgelöst.

**Zahlenbeispiel** (nachgerechnet, Skript im Testordner): Gasrechnung 15.03.2025–14.03.2026.

| Ziel | Gradtage | Tagesgenau (verworfen) |
|---|---|---|
| H = Kalenderjahr 2025: Überschneidung 15.03.–31.12.2025 | 621,29 ‰ | 292/365 = 800,00 ‰ |
| H = 01.05.2025–30.04.2026: Überschneidung 01.05.2025–14.03.2026 | 848,71 ‰ | 318/365 = 871,23 ‰ |

Mit 6.500 € und H = 2025 sind das nach Gradtagen 4.038,39 € statt 5.200,00 €. Die Differenz von 1.161,61 € wäre Winterverbrauch 2026, der tagesgenau in 2025 läge.

**Abdeckung:** Decken die Lieferungen H nicht ganz ab, gibt es die Warnung `fuel.uncovered`: „Für 15.03.–30.04.2026 (47 Tage, 151,3 ‰ der Gradtage) fehlt eine Rechnung. Tragen Sie die Folgerechnung ein oder lesen Sie den Gaszähler zum 30.04.2026 ab.“ Was dann gilt, regelt 3.3.

**Messdienste und Software:**

- [M] Minol, wie oben.
- Der reale Techem-Beleg setzt die einzige Lieferung als „Anlieferung“ an, ohne erkennbar umzurechnen (Gegenprüfung C3). Das ist eine Schwäche des Belegs und kein Vorbild.
- [S] NebenkostenFix nutzt Gradtage nur für fehlende Zählerstände (Marktvergleich). mibakus hat keine Abgrenzung.

**Hinweise:**

- `fuel.share-by-degree-days` (hint): nennt die Gradtage samt Tabelle und empfiehlt den Zählerstand.
- `fuel.uncovered` (warning).

### 3.3 Lücken in der Abdeckung (zu Facette 2 und 9)

**Rechtsgrundlage:**

- [G] § 5 Abs. 1 S. 5 CO2KostAufG verlangt, die Emissionen auf den Zeitraum **umzurechnen**.
- [R] VIII ZR 156/11 verlangt die Kosten des **verbrauchten** Brennstoffs.

**Was Mietfuchs tut:**

| Größe | Bei Lücke | Grund |
|---|---|---|
| **E** (kg, nur für die Einstufung) | Auf H umgerechnet: E_H = Σ_d E_d · Anteil_d / Abdeckung. Die Abdeckung ist der Anteil der Gradtage von H, den die Rechnungen überdecken, nach Stufe 1 gemessen, wo es geht. | Umrechnen verlangt § 5 Abs. 1 S. 5. Ohne Umrechnung wäre E zu klein und damit auch der Vermieteranteil. |
| **C** (CO₂-Kosten) | nicht hochgerechnet: C_H = Σ_d C_d · Anteil_d | Abgezogen wird nur, was den Mietern berechnet ist (Abschnitt 6.6). |
| Brennstoffkosten | nicht hochgerechnet | Was nicht in Rechnung steht, ist nicht entstanden. Den Verlust trägt der Vermieter, solange er die Rechnung nicht nachträgt. |

- **Keine Grenze.** Die 75 % der Abschlussprüfung sind nicht belegt, deshalb entfallen sie.
- Stattdessen ist `fuel.uncovered` eine **Warnung** und färbt die Ampel des Cockpits.
- Ein Abschluss mit Lücke fragt zurück: „Für 47 Tage fehlt eine Rechnung. Trotzdem abschließen?“
- Der Ausweis nennt E „umgerechnet auf 01.05.2025–30.04.2026 (Abdeckung 848,7 ‰)“.

**Hintergrund zur Abschlussprüfung, Punkt 2:**

| Teil des Punkts | Wie er hier eingelöst ist |
|---|---|
| Faktor aus exakten Werten | erfüllt: Gradtage taggenau, nicht aus gerundeten ‰ |
| Bezeichnung „hochgerechnet“ | erfüllt: Der Ausweis sagt „umgerechnet“ |
| Bei überschriebenem Anteil | Die Überschneidung zählt als abgedeckt, und der eingetragene Anteil gilt für kg und € gleich |
| Satz „BMWK-Rechner verfährt ebenso“ | gestrichen |

### 3.4 Facette 3: Jahresrechnungen bei abweichendem Zeitraum

**Rechtsgrundlage.** [R] VIII ZR 49/07 (geprüft 05.10.): Die §§ 556 ff. BGB schreiben das **Leistungsprinzip** nicht vor, das **Abflussprinzip** ist ebenfalls zulässig. Das gilt für kalte Betriebskosten. Für Heizung und Warmwasser gilt es nicht ([R] VIII ZR 156/11).

**Beide Prinzipien kennen keine Zuordnung nach größter Überschneidung.** Die Regel aus #208 (eine Jahresrechnung ganz in den Zeitraum mit der größten Überschneidung) entfällt deshalb.

- Leistungsprinzip heißt: die Kosten, die auf den Zeitraum entfallen, also zeitanteilig.
- Abflussprinzip heißt: was im Zeitraum bezahlt wurde.

**Mietfuchs wendet das Leistungsprinzip an**, mit zeitanteiliger Aufteilung:

- Eine Position mit Leistungszeitraum (`service_from`, `service_to`), der zwei Objektzeiträume berührt, wird **beim Speichern** in eine Position je Zeitraum zerlegt, in einer Transaktion.
- Gerechnet wird tagesgenau, die Restcent gehen nach `largestRemainder` mit der Kennung als Entscheid.
- Der §35a-Lohnanteil wird im selben Verhältnis geteilt, und der Beleg hängt an beiden Positionen.
- Die Vorschau zeigt beide Beträge. Ist einer der Zeiträume abgeschlossen, wird abgelehnt (409 mit Satz).

**Der Abfluss wird nicht angeboten:** Positionen tragen kein Zahlungsdatum. Das kommt erst mit dem Kontoauszug (#188).

- **Messdienste und Software:** [S] Immoware24 ordnet jede Buchung über ein Abgrenzungsdatum zu und teilt per Splitbuchung (Handbuch 09/2026, übernommen aus #208).
- **Zahlenbeispiel** (Rhythmus Mai bis April, Grundsteuer 2025 über 480,00 €):
  - Zeitraum `2024-05` (bis 30.04.2025): 120/365 · 480 = 157,808 → **157,81 €**;
  - Zeitraum `2025-05`: 245/365 · 480 = 322,192 → **322,19 €**;
  - Summe 480,00 €.
- **Ohne Leistungszeitraum** fragt das Formular nach dem Zeitraum. Vorbelegt ist der Objektzeitraum, der das Rechnungsdatum enthält. Ein Rechnungsdatum gibt es nur, wenn ein Beleg es trägt.
- **Bei Kalenderjahr-Rhythmus** ändert sich nichts: Der Leistungszeitraum liegt in einem P.

**Hinweise:**

- `period.item-outside` (warning): Der Leistungszeitraum berührt den Zeitraum der Position nicht.
- `period.heating-mismatch` (warning): Eine Heizposition ohne Anlage hat einen Leistungszeitraum, der von H abweicht ([R] VIII ZR 156/11).

### 3.5 Facetten 4 und 5: Mieterwechsel und Ablesedatum

**Rechtsgrundlage.** [G] § 9b HeizkostenV (geprüft 05.10.):

- **Abs. 1:** Beim Nutzerwechsel ist eine Zwischenablesung vorzunehmen.
- **Abs. 2:** Die Verbrauchskosten werden nach der Zwischenablesung geteilt. Die übrigen Wärmekosten werden nach **Gradtagszahlen oder zeitanteilig** geteilt, die übrigen Warmwasserkosten zeitanteilig.
- **Abs. 3:** Ist die Zwischenablesung nicht möglich oder wegen des Zeitpunkts technisch zu ungenau, werden die **gesamten** Kosten nach Abs. 2 für die übrigen Kosten geteilt.
- **Abs. 4:** Abweichende Vereinbarungen bleiben unberührt.

[R] VIII ZR 19/07: Die Kosten der Zwischenablesung trägt der Vermieter, außer bei Vereinbarung.

**Gradtagstabelle.** [M] ista (Fachwissen „Gradtagszahlentabelle“) und [M] Berliner Mieterverein, Info 73 (beide geprüft 05.10.) nennen dieselben Werte, in Promille je Monat, Summe 1.000:

| Sep | Okt | Nov | Dez | Jan | Feb | Mär | Apr | Mai | Jun–Aug zusammen |
|---|---|---|---|---|---|---|---|---|---|
| 30 | 80 | 120 | 160 | 170 | 150 | 130 | 80 | 40 | 40 |

- Juni bis August gelten tagesgenau mit 40/92 je Tag (ista).
- Die Tabelle gilt nicht für Warmwasser. Warmwasser und Hausnebenkosten werden nach Kalendertagen geteilt (ista, wörtlich).
- Ihre Herkunft aus VDI 2067 bzw. DIN 4713 Teil 5 wird in der Literatur genannt. **Ungeprüft**, weil die Norm nicht gelesen wurde.

**Verdunster.** [M] Die ARGE der Wärmemessdienste empfiehlt eine Zwischenablesung bei Verdunstern nur, wenn seit der Hauptablesung **mindestens 400 und höchstens 800 ‰** der Gradtage vergangen sind (Berliner Mieterverein, Info 73; delta-t; geprüft 05.10.). Außerhalb dieses Bereichs gilt § 9b Abs. 3. Mietfuchs wertet Verdunster nicht selbst aus (Abschnitt 8.1). Die Regel gilt deshalb nur für die Werte eines Ablesedienstes, und der wendet sie selbst an.

**Wann eine Ablesung eine Zwischenablesung ist.** Ohne Toleranz von Mietfuchs, Schritt für Schritt:

1. Ein Nutzerwechsel liegt zwischen dem letzten Tag des alten Nutzers (d) und dem ersten des neuen (d + 1). Eine Ablesung mit Datum d oder d + 1 ist die Zwischenablesung. Das ist kein Spielraum: Ob jemand am Auszugstag abends oder am Folgetag morgens abliest, bezeichnet denselben Zählerstand an derselben Grenze.
2. **Leerstand ist ein Nutzer** (Nutzeinheit nach § 9b, [R] VIII ZR 159/05 übernommen). Steht die Wohnung zwischen zwei Mietern leer, trennt eine Ablesung am Beginn oder Ende des Leerstands die Nutzer genau. Ein Wechsel ist also auch durch eine Ablesung an der Grenze des Leerstands erfasst.
3. **Fehlt eine solche Ablesung**, gilt für **diesen** Wechsel § 9b Abs. 3: Die gesamten Heizkosten der Wohnung werden nach Gradtagen geteilt (oder nach Tagen, wenn die Anlage `change_split = 'time'` hat), die Warmwasserkosten nach Tagen. Es gibt keine Fortschreibung und keine lineare Schätzung.
   - Die Teilentwürfe hatten ±1 Tag und 14 Tage Fortschreibung vorgesehen. Beides war ohne Quelle und entfällt.
   - Eine Fortschreibung nach Gradtagen wäre im Ergebnis dieselbe Rechnung wie § 9b Abs. 3, nur ohne diesen Namen.
4. **Hinweis** `heating.no-interim-reading` (hint): nennt den Wechsel und den Betrag nach § 9b Abs. 3 und zum Vergleich den Betrag mit Ablesung, wenn eine Ablesung ein paar Tage daneben liegt: „Die Ablesung vom 03.10. ist keine Zwischenablesung zum Wechsel am 30.09.; aufgeteilt nach § 9b Abs. 3.“ So sieht der Vermieter, ob er nachträglich den Stichtagswert eintragen kann.

**Ablesung nicht am Stichtag der Hauptablesung** (Facette 5):

- **Geräte mit Speicher.** Elektronische HKV speichern den Wert zum programmierten Stichtag und setzen danach zurück. Wärme- und Wasserzählermodule speichern Stichtags- und Monatswerte ([M] ista, Gerätebeschreibungen sensonic und Funksystem, geprüft 05.10.). Mietfuchs fragt deshalb „Stichtagswert laut Anzeige“ und nicht „heutiger Stand“. Wer am 10.05. abliest, trägt den gespeicherten Wert zum 30.04. ein.
- **Geräte ohne Speicher** (ältere mechanische Zähler): Verteilt wird nach Anteilen, deshalb ist ein gemeinsames Ablesedatum aller Wohnungen eines Topfs gleichwertig zum Stichtag. Die Verbrauchsanteile vergleichen dann gleich lange Zeiträume.
- **Haben die Wohnungen eines Topfs verschiedene Ablesedaten** und keine Stichtagswerte, sind die Werte nicht vergleichbar. Die betroffenen Wohnungen gelten als **nicht ordnungsgemäß erfasst** ([G] § 9a Abs. 1: „aus anderen zwingenden Gründen“), und es gilt die Schätzung samt 25-%-Schwelle (Abschnitt 8.7). Hinweis `heating.reading-dates-differ` (warning) mit den Daten.
- **VDI 2077** regelt das vermutlich genauer. Sie ist nicht gelesen (0.2), deshalb steht der Punkt in 15.2 mit dieser konservativen Lösung. Sie ist konservativ, weil sie nur verwendet, was ein Gerät zum Stichtag zeigt oder was gleichzeitig abgelesen wurde, und alles andere dem Verfahren des Gesetzes überlässt.

**Zahlenbeispiel** (aus #99, nachgerechnet): Wohnung C, Wechsel zum 30.09.2025.

- Grundkosten Heizung 506,52 €. Gradtage Januar bis September: 640 ‰.
- Mit Zwischenablesung (Wärme 7.200/4.800 kWh, Warmwasser 38/12 m³): C1 = **1.331,53 €**, C2 = **750,75 €** (exakt 1.331,5300 und 750,7500).
- Grundkosten C1 zeitanteilig wären 378,85 € statt 324,17 €.
- Ohne Zwischenablesung (§ 9b Abs. 3) trüge C1 1.375,18 €.

**Messdienste:** [M] ista, Minol und Brunata teilen genau so: Grundkosten nach Gradtagen, Warmwasser nach Tagen, ohne Zwischenablesung alles nach Gradtagen bzw. Tagen.

### 3.6 Facette 6: Wechsel des Zeitraums oder des Messdienstes

**Rechtsgrundlage:**

- [G] § 556 Abs. 3 S. 1 BGB: jährlich abrechnen; nach allgemeiner Auffassung höchstens zwölf Monate (übernommen aus #208, Berliner Mieterverein, BMGEV).
- [R] VIII ZR 316/10 (geprüft 05.10.): Eine **einmalige, vereinbarte** Verlängerung (dort 19 Monate) zur Umstellung auf das Kalenderjahr ist zulässig. Einseitig ist sie es nicht.
- Legt der Mietvertrag den Zeitraum fest, kann der Vermieter ihn nicht einseitig ändern (übernommen, Mietervereine). Ein BGH-Urteil zum einseitigen Wechsel mit Rumpfzeitraum war nicht zu finden.

**Verfahren:**

- Ein Wechsel erzeugt einen **Rumpfzeitraum** bis zum Tag vor dem neuen Beginn, ohne eigenen Datensatz.
- Mit der Heizanlage gilt dasselbe für die Heizperiode, etwa wenn der Messdienst wechselt und der neue zum 31.12. abliest.
- Eine Verlängerung über zwölf Monate gibt es nicht. Sie bräuchte die Zustimmung aller Mieter, und der Rumpf leistet ohne Zustimmung dasselbe.

**Was der Wechsel mit vorhandenen Daten tut** (aus #208):

- Er ändert keinen abgeschlossenen Zeitraum (409).
- Kostenpositionen, deren Zeitraum entfällt, werden in der Vorschau aufgeführt und nach dem Leistungsprinzip aufgeteilt (3.4).
- Fehlt der Leistungszeitraum, ordnet der Vermieter sie je Gruppe zu. Ohne Zuordnung wird nicht gespeichert.

**Zahlenbeispiel:**

- **Wechsel Kalenderjahr → Mai, ab 2025-05:** Zeiträume 2024 · `2025-01` = 01.01.–30.04.2025 (Rumpf, 120 Tage) · `2025-05` …
- **Frist des Rumpfs:** 30.04.2026.
- **CO₂-Tabelle im Rumpf:** um 120/365 gekürzt ([G] § 5 Abs. 1 S. 4). Die Grenzen sind dann 3,945 · 5,589 · 7,233 · 8,877 · 10,521 · 12,164 · 13,808 · 15,452 · 17,096 kg/m². Ein Wert von 5,0 ergibt damit 10 % für den Vermieter.

**Messdienste:** [M] Brunata hat ein Auftragsformular „Änderung Abrechnungszeitraum“. Den Wechsel führt der Messdienst also durch, mit Rumpf.

**Hinweis** `period.short` (hint, färbt nicht): „Rumpfzeitraum wegen der Umstellung. Legt Ihr Mietvertrag den Zeitraum fest, braucht die Umstellung die Zustimmung der Mieter.“

### 3.7 Facette 7: Vorauszahlungen

**Rechtsgrundlage:**

- [G] § 556 Abs. 3 BGB: Abgerechnet wird über die Vorauszahlungen des Zeitraums.
- [R] VIII ZR 240/07: Bei einheitlichen Vorauszahlungen ist keine eigene Heizkostenabrechnung nötig, und angerechnet werden die Vorauszahlungen der **Gesamtabrechnung**.
- [G] § 560 Abs. 4 BGB: Nach der Abrechnung darf jede Partei die Vorauszahlung auf eine angemessene Höhe anpassen.

**Verfahren:**

- Angerechnet werden die Vorauszahlungen der Monate von P. Die Monatsregel steht einmal in `ledgerRows(snapshot, months)` (aus #208).
- Die Jahreskorrektur (`prepayment_overrides`) hängt am Schlüssel von P.
- Der Vorschlag nach § 560 Abs. 4 ist ein Zwölftel der Kosten, **auf zwölf Monate bezogen**:
  - kalte Kosten aus P, Heizkosten aus der eingestellten H;
  - im Rumpf hochgerechnet auf zwölf Monate ab Beginn, nicht über die Rumpftage verteilt.
  - Eine Abrechnung nur mit Heizkosten (3.1) ergibt keinen Vorschlag, denn das Mietverhältnis ist beendet.

**Zahlenbeispiel** (Rumpf von 120 Tagen mit 400 € Kosten): Vorschlag = 400 · 365/120 / 12 = 101,39 → 101 € (volle Euro wie bisher).

**Messdienste:** [M] Vorauszahlungen rechnet der Messdienst nur, wenn sie ihm gemeldet wurden (Marktvergleich 2.5). In Mietfuchs gehören sie immer zur Gesamtabrechnung.

### 3.8 Facette 8: Abrechnungsfrist

**Rechtsgrundlage:**

- [G] § 556 Abs. 3 S. 2, 3 BGB.
- [R] VIII ZR 240/07: Die Frist beginnt mit dem Ende des Zeitraums der **Gesamtabrechnung**, auch wenn die Heizperiode abweicht (geprüft 05.10.).

**Verfahren:** `settlementDeadline(P)` ist der letzte Tag des zwölften Monats nach dem Ende von P. Sie ersetzt die festen `${year + 1}-12-31` in settlementDiff.ts, settlementHistory.ts und Cockpit.tsx.

**Zahlenbeispiele:**

| Zeitraum | Frist |
|---|---|
| 2025 | 31.12.2026 |
| `2025-05` | 30.04.2027 |
| Rumpf `2025-01` (bis 30.04.2025) | 30.04.2026 |
| Gesamtabrechnung 2026 mit H = 01.05.2025–30.04.2026 | 31.12.2027 |

Der Vorschlag „frühere der beiden Fristen“ aus der Planung entfällt, denn das Urteil beantwortet die Frage.

**Hinweis:** Das Cockpit nennt die Frist mit Zeitraum, etwa „Abrechnung 2025/2026 bis 30.04.2027“.

### 3.9 Facette 9: CO₂ und Zeiträume

Grundlage sind §§ 5, 5a und 11 CO2KostAufG (geprüft 05.10., § 5a Abs. 3 Nr. 2 siehe Abschnitt 2).

| Frage | Regel | Quelle |
|---|---|---|
| Anwendbar? | Beginn von **H** am oder nach 01.01.2023 | [G] § 11 Abs. 2 S. 1 |
| Brennstoff, vor 2023 berechnet | kg zählen für die Einstufung, € bleiben unberücksichtigt | [G] § 11 Abs. 2 S. 2; Lesart übernommen (CO₂-Entwurf 11.3) |
| Lieferzeitraum ≠ H | umrechnen wie Facette 2 | [G] § 5 Abs. 1 S. 5 |
| H kürzer als ein Jahr | Tabellenwerte anteilig kürzen, Faktor = Tage(H) / Tage der zwölf Monate ab Beginn (Schaltjahr eingeschlossen) | [G] § 5 Abs. 1 S. 4; Faktor übernommen |
| Rundung | auf die erste Nachkommastelle, vor der Einstufung | [G] § 5 Abs. 1 S. 3 |
| Mieterwechsel, Eigentümerwechsel | **kein** kurzer Zeitraum | übernommen (Gegenprüfung A13) |
| Anlage nach § 43 GModG, ab 2028 | Netzentgelte und CO₂-Kosten, die im Zeitraum **ab dem 01.01.2028 angefallen** sind, hälftig; was davor anfiel, nach Stufen. „Angefallen“ wird **wie Facette 2 umgerechnet**, so verweist § 5a Abs. 1 auf § 5 Abs. 1 S. 5. | [G] § 5a Abs. 1, 3 |

**Zahlenbeispiel § 5a:**

- H = 01.05.2027–30.04.2028, Anlage nach § 43 GModG, Stufe 40 % (Vermieter), C = 600 €.
- Gradtage ab 01.01.2028: 530 von 1.000 ‰ (nachgerechnet; 2028 ist ein Schaltjahr, der Februar zählt 150/29 je Tag).
- **Vermieteranteil:** 0,47 · 600 · 40 % + 0,53 · 600 · 50 % = 112,80 + 159,00 = **271,80 €**.
- Ist der Gaszähler zum 31.12.2027 abgelesen, gilt die gemessene Menge (Facette 2, Stufe 1).

### 3.10 Facette 10: Steuer (Anlage V)

**Rechtsgrundlage:** [G] § 11 Abs. 1, 2 EStG, also Zufluss und Abfluss im Kalenderjahr (übernommen, #70).

**Verfahren:**

| Teil | Regel |
|---|---|
| Einnahmen | unverändert, das Ist aus den Zahlungen |
| Werbungskosten | je Position im **Steuerjahr** `tax_year`. Liegt ihr Zeitraum in einem Kalenderjahr, ist es dieses (Spalte `null`, also jeder heutige Bestand). Sonst ist das Feld Pflicht, vorbelegt mit dem Jahr des Rechnungsdatums laut Beleg. Ohne Beleg ist es leer und muss beantwortet werden. Eine Vorbelegung nach „größerem Teil“ (#208) ist ohne Quelle und entfällt. |
| Eigenanteil (`splitForTax`) | aus der Abrechnung des Zeitraums der Position, abgeschlossen aus deren eingefrorenem Stand. Eine Steuerübersicht kann aus zwei Abrechnungen schöpfen und nennt beide. |
| `prepaymentSettlementCents` | `null`, wenn kein Zeitraum dem Kalenderjahr gleicht. Dann steht dort ein Satz statt einer erfundenen Zahl. |
| `fuelCarry` (8.2) | außen vor: eine zeitliche Verschiebung, weder Eigenanteil noch Werbungskosten |
| CO₂-Vermieteranteil | steckt im bezahlten Betrag der Heizposition (7.4) |

**Zahlenbeispiel** (Heizperiode Juli bis Juni): Messdienstposition 4.200 €, Rechnung vom 15.08.2026. Steuerjahr 2026. Eigenanteil aus der Abrechnung, die H 2025/26 enthält.

### 3.11 Facette 11: Mietkonto

Bleibt nach Kalendermonaten. Es ist die Grundlage der Einnahmen in der Steuer, und eine Monatsliste je Zeitraum gäbe dieselben Monate unter zwei Überschriften. Die Seite nennt bei abweichendem P oben: „Die Abrechnung 2025/2026 umfasst Mai 2025 bis April 2026.“ Es gibt keine Rechtsgrundlage, die etwas anderes verlangt.

### 3.12 Facette 12: Zählerwechsel und Eichung im Zeitraum

- **Zählerwechsel:** Bestand (`replacement`, `oldEndValue`, Hinweise #69 und #83). Bei elektronischen HKV ist das Zurücksetzen am Stichtag mechanisch derselbe Vorgang (8.1). Ein Wechsel ohne Endstand ist für einen Heizungstopf „nicht ordnungsgemäß erfasst“ und führt zu § 9a.
- **Eichung.** [R] VIII ZR 112/10 (geprüft 05.10.): Nur beim geeichten Zähler wird die Richtigkeit vermutet. Beim nicht geeichten muss der Vermieter sie beweisen, etwa mit einer Prüfbescheinigung.
- **Eichfrist:** [G] MessEV Anlage 7, nach [M] ista: Wärme-, Warm- und Kaltwasserzähler sechs Jahre seit 02.11.2021, davor fünf Jahre für Wärme- und Warmwasserzähler. **Wortlaut ungeprüft.**
- **Verfahren:**
  - neues optionales Feld `meters.calibrated_until` (Jahr, bis zu dessen Ende geeicht);
  - Hinweis `meter.calibration-overdue` (warning) mit dem Satz aus dem Urteil;
  - die Werte werden trotzdem verwendet: unterstützen und warnen (#91);
  - die Eichfrist kommt als Vorschlag aus dem Register (`messev.calibration-years`, Zeitregel Ereignisdatum = Jahr der letzten Eichung).
- **Issue #98** (Eichfrist) ist nicht im Meilenstein. Empfehlung: aufnehmen, Umfang 1 Tag (PR 21).

### 3.13 Facette 13: Rechtsänderung mitten im Zeitraum

Für jeden Parameter steht im Register seine **Zeitregel**, und zwar die, die das Gesetz anordnet (Abschnitt 4.3). Das Register kennt fünf Arten:

| Zeitregel | Bedeutung | Beispiel mit Beleg |
|---|---|---|
| `periodStart` | gilt die Fassung am Beginn des Zeitraums | Anwendbarkeit CO2KostAufG: „Abrechnungszeiträume …, die am oder nach dem 1. Januar 2023 beginnen“ ([G] § 11 Abs. 2 S. 1) |
| `incurred` | anteilig nach Anfall, umgerechnet wie Facette 2 | § 5a: „im Abrechnungszeitraum ab dem 1. Januar 2028 … angefallen“, „unter entsprechender Anwendung von § 5 Absatz 1 Satz 5“ ([G] § 5a Abs. 1) |
| `overlap` | Regel gilt, sobald der Zeitraum den Geltungsbeginn berührt; der Hinweis sagt „teilweise“ | Fernablesbarkeit ab 01.01.2027 ([G] § 5 Abs. 3, § 12 Abs. 1 S. 2 HeizkostenV); Kabel-TV bis 30.06.2024 ([G] § 2 Satz 2 BetrKV). Beides ist Bestand, und die Kabelregel ist dort schon so gebaut (`ruleCoverage`). |
| `eventDate` | Datum eines Ereignisses: Rechnung, Einbau, Eichung, Anzeige | § 11 Abs. 2 S. 2 CO2KostAufG (Rechnungsdatum); § 5a (Einbau nach § 43 GModG); § 6 Abs. 2 (Anzeige in Textform) |
| `deliveryYear` | Jahr der Lieferung | CO₂-Preis nach § 4 CO2KostAufG, nur Plausibilität |

**Beim Hinweis ab 2027 bleibt offen, ob die 3 % bei einem Zeitraum, der 2027 nur teilweise berührt, voll oder anteilig gelten.** Bestand und Hinweis sagen „bis zu 3 %“ (15.1 Nr. 7).

---

## 4. Architektur für Rechtsänderungen

### 4.1 Der Ist-Stand und seine Lücken

`server/src/rules.ts` (#112) führt Regeln mit Gültigkeit. Es kennt `ruleCoverage` und `rulesFor`, `RULES_AS_OF` steht als Rechtsstand in jeder Abrechnung, und `legalBasis` friert mit dem Abschluss ein.

Es fehlen drei Dinge:

1. **Zahlenwerte mit Gültigkeit.** Die Kürzung von 15 % steht als `(share * 15) / 100` in calc.ts. Die 3 % stehen nur im Hinweistext. `VACANCY_PERSONS` steht in calc.ts. Die Daten der Kabelregel stehen als Literale in Texten und Bedingungen (`year >= 2021`). Die 50/70 % stehen in shared/heating.ts.
2. **Eine Zeitregel je Wert** (3.13).
3. **Das Einfrieren der benutzten Werte**, nicht nur der Codes.

### 4.2 Das Register: `shared/law/`

Das Register ist ein Laufzeitanteil in `shared/`, wie `shared/heating.ts` (#140): Lexikon und Oberfläche lesen dieselben Zahlen wie die Berechnung, und so können Text und Rechnung nicht auseinanderlaufen. `server/src/rules.ts` wird zu einer Weiterleitung auf `shared/law/rules.ts` und verschwindet in derselben PR, sobald niemand mehr darauf zeigt.

```
shared/law/
  register.ts        Typen, Abfrage, Protokoll der benutzten Werte, LAW_AS_OF
  rules.ts           die qualitativen Regeln aus rules.ts (Code, Titel, Norm, Gültigkeit), unverändert
  heizkostenv.ts     Parameter der HeizkostenV
  co2kostaufg.ts     Parameter des CO2KostAufG, Stufentabelle, Preise, EBeV
  bgb-betrkv.ts      Frist, Höchstdauer, Kabelregel-Daten
  messev.ts          Eichfristen
  practice.ts        Werte aus Praxis oder Auslegung (Gradtagstabelle, VACANCY_PERSONS), eigens gekennzeichnet
```

**Typ eines Parameters:**

```ts
type SourceRank = 'law' | 'court' | 'technical' | 'practice' | 'software' | 'interpretation'
type Source = { rank: SourceRank; cite: string; url: string; retrieved: string; checked: 'checked' | 'adopted' | 'unchecked' }
type Timing = 'periodStart' | 'incurred' | 'overlap' | 'eventDate' | 'deliveryYear'
type Version<T> = { validFrom?: string; validTo?: string; value: T | null; source: Source; enacted: string }
type LawParam<T> = {
  id: string                 // 'hkv.cut.not-by-consumption'
  title: string              // 'Kürzung bei nicht verbrauchsabhängiger Abrechnung'
  norm: string               // '§ 12 Abs. 1 Satz 1 HeizkostenV'
  timing: Timing
  versions: Version<T>[]     // lückenlos, nicht überlappend, aufsteigend
  overridable?: { reason: string } // nur Werte, die eine Behörde später veröffentlicht
}
```

**Abfrage.** Die Zeitregel bestimmt den Typ des Arguments, so prüft der Übersetzer, dass eine Stelle die richtige Frage stellt:

```ts
law(id, ctx)       // ctx je nach timing:
                   //  periodStart  → { period: { from, to } }   gilt die Fassung am from
                   //  overlap      → { period }                 → { coverage: 'full'|'partial'|'none', value }
                   //  incurred     → { period, weights }        → Segmente [{ from, to, value, weight }]
                   //  eventDate    → { date }
                   //  deliveryYear → { year }
```

**Protokoll.** Jede Abfrage schreibt in den `LawLog` der laufenden Berechnung, was sie bekommen hat: `{ id, validFrom, value, norm, source.cite, overridden? }`. Am Ende steht das Protokoll in `Settlement.legalBasis.values`. Die Berechnung bekommt das Protokoll übergeben und nicht als globalen Zustand, denn zwei Abrechnungen rechnen nebeneinander.

**Fehlender Wert:**

- Gibt es zu einem Zeitpunkt keine Fassung, wirft `law()`. Das ist ein Programmfehler wie `ruleByCode`.
- Ist die Fassung beschlossen, der Wert aber noch nicht veröffentlicht (`value: null`, etwa der CO₂-Preis 2027), liefert `law()` `null`, und der Aufrufer muss damit umgehen. Der Typ zwingt dazu, denn `value` hat dann `T | null`.

### 4.3 Die Parameter

Alle Werte stehen nur hier. Die Spalte „Zeitregel“ sagt, nach welchem Datum die Fassung gewählt wird.

| id | Wert | Norm, Quelle | Zeitregel | Prüfstand |
|---|---|---|---|---|
| `bgb.deadline-months` | 12 | § 556 Abs. 3 S. 2 BGB | periodStart | übernommen |
| `bgb.max-period-months` | 12 | § 556 Abs. 3 S. 1 BGB (h. M.) | periodStart | übernommen |
| `betrkv.tv-signal` | gültig bis 30.06.2024, Anlage vor 01.12.2021 | § 2 Satz 2 BetrKV | overlap | Bestand (#112, #121) |
| `hkv.consumption-share` | min 50, max 70 (%) | § 7 Abs. 1 S. 1, § 8 Abs. 1 HeizkostenV | periodStart | übernommen |
| `hkv.consumption-share-forced` | 70 % | § 7 Abs. 1 S. 2 | periodStart | übernommen |
| `hkv.cut.not-by-consumption` | 15 % | § 12 Abs. 1 S. 1 | periodStart | übernommen |
| `hkv.cut.remote-reading` | 3 %, gilt ab 01.01.2027 | § 12 Abs. 1 S. 2, § 5 Abs. 3 | overlap | Bestand |
| `hkv.cut.information` | 3 % | § 12 Abs. 1 S. 3, § 6a | periodStart | übernommen |
| `hkv.estimate-threshold` | 25 % der Fläche | § 9a Abs. 2 | periodStart | übernommen |
| `hkv.dhw.volume-formula` | 2,5 · V · (t_w − 10) | § 9 Abs. 2 S. 2 | periodStart | übernommen |
| `hkv.dhw.area-formula` | 32 · A | § 9 Abs. 2 S. 4 | periodStart | übernommen |
| `hkv.dhw.factors` | Erdgas Hₛ × 1,11; Wärmelieferung ÷ 1,15; monovalente Wärmepumpe × 0,30 | § 9 Abs. 2 S. 6 | periodStart | übernommen |
| `hkv.heating-values` | Tabelle H_i (Heizöl EL 10 kWh/l, Erdgas H 10 kWh/m³, Erdgas L 9, Flüssiggas 13 kWh/kg, Holzpellets 5 kWh/kg, Brennholz 4,1, Hackschnitzel 650 kWh/SRm …) | § 9 Abs. 3 | periodStart | übernommen, **Tabelle vollständig bei Umsetzung abschreiben** |
| `hkv.heat-pump` | Erfassung Pflicht ab 01.10.2024, Nachrüstung bis 30.09.2025 | § 12 Abs. 3 | overlap | übernommen (#85, #99) |
| `co2.applicable-from` | 01.01.2023 | § 11 Abs. 2 S. 1 CO2KostAufG | periodStart | geprüft 05.10. |
| `co2.costs-before` | 01.01.2023 (Rechnungsdatum) | § 11 Abs. 2 S. 2 | eventDate | geprüft 05.10. |
| `co2.stage-table` | zehn Stufen, unten einschließend | Anlage CO2KostAufG | periodStart | übernommen |
| `co2.rounding-decimals` | 1 | § 5 Abs. 1 S. 3 | periodStart | geprüft 05.10. |
| `co2.non-residential` | Vermieter 500 ‰ | § 8 Abs. 1 | periodStart | übernommen |
| `co2.restriction` | einfach × 0,5; beide → keine Aufteilung | § 9 Abs. 1, 2 | periodStart | übernommen |
| `co2.cut.missing` | 3 % | § 7 Abs. 4 | periodStart | übernommen |
| `co2.half-split` | Vermieter 500 ‰ für CO₂-Kosten und Gas-Netzentgelte ab 01.01.2028; Biobrennstoff ab 01.01.2029, höchstens 30 % des Brennstoffs | § 5a Abs. 1, 3 | incurred | Abs. 1 geprüft, Abs. 3 Nr. 2 **ungeprüft** |
| `co2.half-split.emergency` | zwölf Monate nach Notfalleinbau keine Teilung | § 5a Abs. 4 | eventDate | **ungeprüft** (nur Zusammenfassung) |
| `co2.self-supply` | Anzeige binnen 12 Monaten; Gasherd −5 % | § 6 Abs. 2, 3 | eventDate | übernommen |
| `co2.price` | 2023: 30, 2024: 45, 2025: 55, 2026: 60 €/t; 2027: `null` (Veröffentlichung UBA) | § 4 CO2KostAufG; DEHSt | deliveryYear, überschreibbar | übernommen |
| `co2.price-ets` | 2023: 80,40; 2024: 83,68; 2025: 65,01; 2026: 73,86 €/t | § 3 Abs. 4; DEHSt | deliveryYear | übernommen |
| `co2.ebev-factors` | Erdgas 0,20088 kg/kWh Hᵢ bzw. 0,18139 Hₛ; Heizöl EL 0,2664 kg/kWh bzw. 2,6763 kg/l; Flüssiggas 0,2358 bzw. 3,013 kg/kg | EBeV 2030 Anlage 2 Teil 4 | deliveryYear | übernommen |
| `messev.calibration-years` | 6 (ab 02.11.2021), davor Wärme und Warmwasser 5 | MessEV Anlage 7 | eventDate | **ungeprüft** |
| `practice.degree-days` | Tabelle 3.5 | [M] ista; Berliner Mieterverein | periodStart | geprüft 05.10. |
| `practice.vacancy-persons` | 1 | Auslegung nach BGH VIII ZR 180/12 | periodStart | Bestand (#177) |
| `practice.evaporator-window` | 400–800 ‰ | [M] ARGE (über Berliner Mieterverein) | periodStart | geprüft 05.10.; nur Lexikon |

`practice.*`-Werte sind **keine** Rechtswerte. Sie stehen trotzdem im Register, denn auch sie dürfen nicht verstreut stehen. Ausweis und Lexikon nennen sie mit ihrer Herkunft („nach der Gradtagstabelle der Messdienste“), nicht als Gesetz.

### 4.4 Einfrieren und spätere Korrekturen

- **Einfrieren.** `legalBasis` bekommt `values: AppliedValue[]` neben `asOf` und `rules`. Weil die abgeschlossene Abrechnung wortgleich eingefroren wird, frieren die Werte mit. Ältere Abschlüsse ohne `values` zeigen „Rechtswerte nicht gespeichert (vor 0.11.0)“.
- **`deviation`** (settlementDiff.ts) vergleicht zusätzlich die Werte: „Rechtswert geändert: CO₂-Preis 2027 von 65,00 auf 64,20 €/t (nur Plausibilität)“. Geldabweichungen zeigt `deviation` wie bisher je Mieter.
- **Korrektur eines Parameters** (Tippfehler im Register):
  - Sie geht mit einem Release.
  - Die neue Fassung **ersetzt** die alte nicht still. Sie bekommt einen Eintrag in `CHANGELOG.md` mit dem Satz „Abgeschlossene Abrechnungen bleiben unverändert; `deviation` zeigt die Auswirkung“.
  - Ein Test hält jede bisher ausgelieferte Fassung als Zahl fest (`law-history.test.ts`, eine Zeile je ausgelieferter Fassung). Wer eine Fassung ändert statt eine neue anzulegen, bekommt einen roten Test.

### 4.5 Werte, die erst später veröffentlicht werden

Betroffen sind heute der CO₂-Preis ab 2027 (UBA, spätestens zehn Werktage vor Jahresbeginn) und die ETS-Preise. Beide dienen **nur der Plausibilität**, keine Abrechnungszahl hängt an ihnen.

- **Grundsatz:** Rechtswerte kommen nur mit einem Release, nie über das Netz wie `ki-modelle.json`. Sie müssen geprüft und versioniert sein.
- **Überschreiben im Einzelfall:** Ist ein Parameter `overridable` und sein Wert `null`, darf der Vermieter ihn eintragen, mit Pflichtfeld „Quelle“ (etwa „UBA, Bekanntmachung vom …“).
  - Gespeichert wird in der Tabelle `law_overrides` (installationsweit, 5.9).
  - Der Hinweis `law.value-overridden` (hint) steht in jeder Abrechnung, die den Wert nutzt.
  - Bringt ein Release später den amtlichen Wert, **gilt der amtliche**. Der eingetragene wird als „überholt“ angezeigt. Offene Abrechnungen rechnen neu, abgeschlossene bleiben, und `deviation` zeigt den Unterschied.
- **Nicht überschreibbar** sind alle Werte, die eine Abrechnungszahl bestimmen. Ein Vermieter, der einen anderen Prozentsatz will, hat dafür keine Rechtsgrundlage.

### 4.6 Künftige, beschlossene Regeln

- **Eingetragen wird nur, was im Bundesgesetzblatt steht.** Entwürfe (BT-Drucksachen) bleiben draußen, etwa BT-Drs. 21/7869 zum Korridor 2027.
- §§ 5a und 5b stehen mit `validFrom` 2028-01-01 bzw. 2029-01-01 im Register.
- Gerechnet wird ab PR 18 (Abschnitt 13).
- Bis dahin gilt eine **Sperre:**
  - Das Merkmal „Heizung nach § 43 GModG“ an der Anlage lässt sich vorher nicht setzen (400).
  - Ein Zeitraum, der 2028 berührt, bei einer Anlage ohne dieses Merkmal, rechnet richtig nach Stufen, denn § 5a gilt nur für solche Anlagen.

### 4.7 Tests

- **Je Parameter ein Test je Stichtag:** am Tag davor, am Tag selbst und über die Grenze, nach seiner Zeitregel. Beispiele:
  - `co2.applicable-from`: Zeitraum ab 31.12.2022 → nicht anwendbar, ab 01.01.2023 → anwendbar.
  - `co2.half-split`: H 2027-05 → 530 ‰ hälftig (3.9).
  - `hkv.cut.remote-reading`: 2026 → keine Kürzung, 2026-05 → `partial`, 2027 → `full`.
- **Vollständigkeit:**
  - Jede Fassung hat `source.url`, `source.retrieved` und `source.cite`.
  - Die Fassungen sind lückenlos und überlappen nicht.
  - Ein Wert `null` ist nur bei `overridable` zulässig.
  - `LAW_AS_OF` ist das jüngste `retrieved` aller Fassungen. Der Test schlägt fehl, wenn jemand eine Fassung ändert, ohne das Datum zu setzen.
- **`unchecked`** ist in einem Release nicht zulässig. Ein Test, der nur beim Tag läuft, bricht ab, solange eine Fassung `checked: 'unchecked'` hat. So wird jede ungeprüfte Stelle aus Abschnitt 2 vor dem Release geprüft.
- **Wächter `law-literals.test.ts`** (Quelltext, wie `anrede.test.ts`) über `server/src/**/*.ts`, `shared/**/*.ts` außer `shared/law/`, `client/src/**/*.ts(x)`, Lexikon und Anleitungen. Verboten sind:
  - ISO-Datumsliterale (`'\d{4}-\d{2}-\d{2}'`) in calc.ts, heating.ts, co2.ts, period.ts und snapshot.ts;
  - Prozentangaben im Muster einer Rechtsfolge in Zeichenkettenliteralen: `um \d+ ?%`, `\d+ ?% kürzen`, `\d+ bis \d+ ?%`, `\d+ Prozent`;
  - die Zahlen der Stufentabelle und der Gradtagstabelle als Feld.

  Beispielrechnungen im Lexikon kennzeichnet `/* Beispiel */` am Feld. glossary.test.ts rechnet sie ohnehin nach. Texte holen ihre Zahl über `fmtLaw('hkv.cut.not-by-consumption', ctx)`.
- **Umstellung ohne Golden-Änderung:** PR 1 zieht die bestehenden Werte um (15 %, 3 %, 50/70, Kabelregel, `VACANCY_PERSONS`, Fernablesung). Golden F01–F11, `db-golden` und `calc-wortlaut.test.ts` bleiben **wortgleich**: Die Texte entstehen aus dem Register mit derselben Formatierung. Neu in `legalBasis` ist nur das Feld `values`, und die Golden-Vergleiche lassen es aus wie `steps`. Den Wächter gibt es, sobald der letzte Literal umgezogen ist.

### 4.8 Prozess (#110)

Die Checkliste der jährlichen Durchsicht (`docs/…/rechtsdurchsicht-JJJJ.md`) bekommt diese Punkte:

1. Für jeden Parameter: Fundstelle aufrufen, Fassung prüfen, `retrieved` setzen. Bei Änderung eine neue Fassung anlegen, nie eine alte ändern.
2. Veröffentlichte Werte (CO₂-Preis des Folgejahres, ETS-Preis) eintragen.
3. Neue Gesetze im BGBl. (HeizkostenV, CO2KostAufG, GModG, BetrKV, MessEV) und neue BGH-Urteile des VIII. Senats zu Heiz- und Betriebskosten durchsehen.
4. Kontaktadressen nach § 6a Abs. 3 Nr. 2 prüfen (8.8).
5. `LAW_AS_OF` setzen. Der Rechtsstand und die benutzten Werte stehen sichtbar im Ausdruck („Rechtsstand 05.10.2026; angewandt: § 12 Abs. 1 S. 1 HeizkostenV 15 %, …“) und im Rechenweg jeder Zeile, die einen Wert nutzt.

---

## 5. Datenmodell

Alle Schritte sind erzeugt mit `npm --prefix server run db:generate`. Datenanweisungen gibt es nur in 5.2, nach dem Muster 0001/0002 aus server/drizzle/README.md. Jede Aufzählung steht zusätzlich als Prüfbedingung im SQL. Neue Spalten und geänderte Bedingungen kommen nie in einem Schritt.

### 5.1 Übersicht

| Tabelle oder Spalte | Neu oder geändert | PR |
|---|---|---|
| `law_overrides` | neu | 17 |
| `properties.period_start_month`, `period_changes` | neu | 2 |
| `year` → `period` in 6 Tabellen | geändert, mit Datenanweisung | 2 |
| `cost_items.service_from`, `service_to`, `tax_year` | neu | 3 |
| `properties.kind` + `'zfh'` | Bedingung | 4 |
| `heating_plants`, `heating_plant_units`, `heating_periods`, `heating_period_changes` | neu | 4, 5 |
| `cost_items.heating_plant_id`, `heating_part`, `heating_target`; `key` + `'heatingSystem'` | neu bzw. Bedingung | 4, 10 |
| `meters`: Typen `warmwasser`, `hkv`; `heating_plant_id`, `heating_role`, `rating_factor`, `hca_scale`, `remote_readable`, `calibrated_until` | neu bzw. Bedingung | 4, 12, 21 |
| `co2_statements`, `co2_tenant_reliefs` | neu | 6 |
| `fuel_deliveries` | neu | 7 |
| `heating_estimates` | neu | 13 |
| `heating_service_values` | neu | 12 |
| `co2_refunds` | neu | 19 |

### 5.2 Zeitraum (PR 2): `period` statt `year`

**Betroffen:**

- `cost_items.year`
- `closed_settlements.year`
- `closed_settlement_history.year`
- `prepayment_overrides.year` (Teil des Primärschlüssels)
- `uploads.year`
- `assessments.year`, `detected_year`, `requested_year`

**Schritt 0014 (Spalten und Daten):**

- Neue Spalten `period` text, nullbar (bzw. `detected_period`, `requested_period`).
- Angehängte Datenanweisungen `UPDATE … SET period = printf('%04d-01', year) WHERE year IS NOT NULL`, je Tabelle hinter einem `--> statement-breakpoint`, mit dem Kommentar „angehängt“.
- Dazu `properties.period_start_month` (integer, Vorgabe 1) und die Tabelle `period_changes(property_id → properties CASCADE, from_month text, PK beide)`.

**Schritt 0015 (Bedingungen):**

- `period` wird Pflicht, wo `year` es war.
- Prüfung `period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'` mit Monat 01–12.
- `year` entfällt.
- Indizes `(property_id, period)`; eindeutig bei `closed_settlements`.
- Primärschlüssel `prepayment_overrides(tenancy_id, period)`.
- Bedingungen Beginnmonat 1..12 und `from_month` im Format `JJJJ-MM`.
- drizzle-kit baut die Tabellen neu. Dass dabei eine Spalte wegfällt, ist kein Fall der Regel „neue Spalten nie mit Bedingungen“. Die Durchsicht der PR prüft es trotzdem an einer Datenbank von 0.10.1.

**Warum die Datenanweisung unbedenklich ist:**

- Jeder vorhandene Schlüssel ist ein Kalenderjahr. `'JJJJ-01'` bezeichnet bei Beginnmonat 1 genau diesen Zeitraum.
- Die Kette läuft in einer Transaktion mit abschließender Prüfung der Fremdschlüssel.
- Der eingefrorene Eingang (`server/src/legacy/`) schreibt weiter auf 0000 mit `year`, und die Kette zieht um.

**API und Kompatibilität:**

- `/api/settlement/:period` und alle Routen mit Jahr nehmen `JJJJ-MM`.
- Eine nackte Jahreszahl `2025` wird als `'2025-01'` gelesen, **nur wenn** das Objekt einen Zeitraum mit diesem Schlüssel hat. Sonst kommt 404 mit dem Satz „Den Zeitraum 2025 gibt es für dieses Objekt nicht; meinen Sie 2025/2026?“. So arbeiten alte Tabs, Smoke-Test und Praxislauf unverändert.
- `/api/taxreport/:year` und `/api/rentledger/:year` bleiben beim Kalenderjahr.

**Typen:**

- `PeriodKey` ist ein Markentyp über `string` (`string & { readonly __period: unique symbol }`).
- Nur `shared/period.ts` erzeugt und zerlegt ihn. Damit fällt jede alte Stelle mit `year - 1` beim Übersetzen auf.
- `Settlement.year` bleibt für ältere Tabs und eingefrorene Abschlüsse. Es ist das Kalenderjahr des Beginns, also bei Kalenderjahren dasselbe wie heute.
- `Settlement.period?: { key, from, to, label, short }` ist neu.

**Validator:** Die db.json kennt nur Kalenderjahre, deshalb bleibt `validate.ts` vierstellig.

### 5.3 Heizanlage (PR 4, PR 5)

**`heating_plants`:**

| Spalte | Typ | Bedeutung, Quelle |
|---|---|---|
| `id`, `property_id` (RESTRICT) | | |
| `name` | text, Vorgabe `''` | ab der zweiten Anlage Pflicht |
| `energy` | `gas \| oil \| lpg \| pellets \| wood \| districtHeating \| heatPump \| electric \| coal \| other`, Pflicht | Energieträger. Fossil im Sinne von § 2 Abs. 1 CO2KostAufG sind `gas`, `oil`, `lpg`, `coal` und `districtHeating` (gewerbliche Wärmelieferung). |
| `supply` | `central \| perUnit`, Vorgabe `central` | `perUnit` = Etagenheizungen mit Vertrag auf den Vermieter ([G] § 5 Abs. 1 S. 2 CO2KostAufG) |
| `method` | `service \| self \| manual`, Vorgabe `manual` | Wer rechnet: Messdienst, Mietfuchs nach HeizkostenV, Positionen mit freien Schlüsseln (heute) |
| `hot_water` | `combined \| separate \| none`, Vorgabe `combined` | § 9 HeizkostenV |
| `capture` | `heatMeter \| hca \| serviceValues`, nullbar | nur bei `self` |
| `hca_model` | text, nullbar | Bauart, für den Ausweis |
| `area_basis` | `area \| heatedArea`, Vorgabe `area` | § 7 Abs. 1 S. 5, § 8 Abs. 1 |
| `change_split` | `degreeDays \| time`, Vorgabe `degreeDays` | § 9b Abs. 2: Wahl des Vermieters. Vorgabe wie die Messdienste ([M] ista: „für den Grundkostenanteil … maßgebend“) |
| `exemption` | `none \| lowDemand \| disproportionate \| pre1981 \| renewable \| authority`, Vorgabe `none` | § 11 HeizkostenV |
| `agreed_otherwise` | `null \| area \| fixedPercent \| consumption` | § 2 HeizkostenV, nur wählbar, wenn `mayAgreeOtherwise` gilt |
| `non_residential` | boolean, Vorgabe false | § 8 CO2KostAufG |
| `restriction` | `none \| building \| supply \| both`, Vorgabe `none` | § 9 CO2KostAufG |
| `district_ets_new` | boolean, Vorgabe false | § 2 Abs. 4 S. 2 CO2KostAufG |
| `gmodg43_installed_on` | text, nullbar | Einbau einer Anlage nach § 43 Abs. 1 GModG (§ 5a); bis PR 18 gesperrt |
| `period_start_month` | integer 1..12, nullbar | eigene Heizperiode (#217); `null` = wie das Objekt |

`heating_period_changes(plant_id CASCADE, from_month, PK beide)` verhält sich wie `period_changes` (PR 5).

**`heating_plant_units`:** `(plant_id CASCADE, unit_id CASCADE)` als Primärschlüssel, dazu `heated_area_m2` (real, nullbar, > 0).

- Ohne Zeilen versorgt die Anlage alle Einheiten des Objekts, die Wohnungen sind (`isDwelling`) und keinen Eintrag „kein Anschluss: Wärme“ haben (#117).
- Ab zwei Anlagen müssen alle Anlagen Zeilen haben und sich ausschließen (400, auch beim Wiederherstellen).
- `sameProperty` prüft die Einheit.

**`heating_periods`:** eine Zeile je Anlage und Heizperiode, eindeutig `(plant_id, period)`. Ohne Zeile gelten die Vorgaben.

| Gruppe | Spalten |
|---|---|
| Verteilung (§§ 7, 8, 10) | `heat_consumption_pct`, `water_consumption_pct` (Vorgabe 70, Grenzen aus dem Register, über 70 nur mit `above_70_agreed`); `insulation_rule` (`applies \| notApplies \| unknown`) |
| Warmwasser (§ 9) | `dhw_method` (`heatMeter \| volumeFormula \| areaFormula`, auch beim Messdienst als **Angabe laut Messdienst** für #211); `dhw_heat_kwh`, `total_heat_kwh`, `dhw_volume_m3`, `dhw_temp_c`, `heating_value`, `gas_basis` (`hs \| hi`), `dhw_unmeasurable` |
| Vorrat (§ 7 Abs. 2 HeizkostenV und CO₂) | `stock_unit` (`l \| kg \| srm`), `opening_quantity`, `opening_cost_cents`, `opening_emissions_kg`, `opening_co2_cents`, `opening_invoiced_before_2023` (boolean), `closing_quantity` |
| § 6a Abs. 3 | `info_taxes_text`, `info_district_ghg`, `info_district_pef`, `climate_factor`, `climate_factor_prev`, `consumer_contract` |

Bestand und Lieferungen stehen **nur hier und in `fuel_deliveries`**, und Brennstoffkosten wie CO₂ lesen sie (W5).

**Kostenpositionen (PR 4, `heatingSystem` erst PR 10):**

| Spalte | Bedeutung |
|---|---|
| `cost_items.heating_plant_id` | nullbar, RESTRICT. Gibt es nur eine Anlage, setzt der Server sie für jede Position der Heizkostenart beim Speichern. Bestehende Positionen bekommen sie beim ersten Anlegen der Anlage in einer Transaktion, mit Vorschau, nur in offenen Zeiträumen. |
| `heating_part` | `fuel \| operating \| metering`, Pflicht genau dann, wenn `key = 'heatingSystem'` |
| `heating_target` | `both \| heating \| water`, ebenso |

Eine Position mit Anlage gehört zum Zeitraum ihrer Heizperiode: `period` ist dann der Schlüssel von H. Für eine Anlage ohne eigene Heizperiode ist das derselbe Schlüssel wie P.

**Zähler (PR 4):**

- Typen `warmwasser` und `hkv`.
- `heating_plant_id` für Zähler ohne Wohnung mit Rolle `heating_role` (`supply \| dhwHeat \| totalHeat`).
- `remote_readable` (boolean, nullbar = unbekannt; #214).
- `rating_factor` (> 0) und `hca_scale` (`product \| unit`) kommen in PR 12.
- `calibrated_until` (integer Jahr) kommt in PR 21.

**Wasserschlüssel:** Beim Schlüssel „nach Verbrauch“ mit Zählertyp Kaltwasser zählen Warmwasserzähler mit. Grund: § 8 Abs. 2 HeizkostenV rechnet die Wasserkosten zum Warmwasser, „soweit sie nicht gesondert abgerechnet werden“, und Mietfuchs rechnet sie gesondert ab (übernommen aus #99). Heute gibt es keine Zähler dieses Typs, also ändert sich keine Zahl.

**Objektart:** `properties.kind` + `'zfh'` (#180), als Beschreibung. Die Ausnahme des § 2 hängt weiter an den Tatsachen (`mayAgreeOtherwise`).

### 5.4 Brennstofflieferungen (PR 7): `fuel_deliveries`

| Spalte | Bedeutung |
|---|---|
| `id`, `plant_id` (RESTRICT) | |
| `cost_item_id` | nullbar, eindeutig, CASCADE. Gesetzt, wenn die Rechnung selbst Kostenposition ist (`self`, `manual`). Leer, wenn der Brennstoff in den Beträgen des Messdienstes steckt (`service`, Fall F3), dann nur für kg, € und G. |
| `amount_cents` | nur ohne `cost_item_id`: Rechnungsbetrag (für G, 7.5) |
| `label`, `invoice_date`, `delivered_at`, `invoice_from`, `invoice_to` | Zeitraum Pflicht bei Gas, Fernwärme und Strom |
| `unit_id` | nullbar, CASCADE. Nur bei `supply = 'perUnit'`: Rechnung dieser Wohnung (F8) |
| `quantity`, `quantity_unit` (`l \| kg \| m3 \| kWh \| srm`), `energy_kwh`, `gas_basis` | Menge |
| `emissions_kg`, `co2_cost_cents`, `emission_factor` | § 3 Abs. 1 Nr. 1–3 CO2KostAufG, brutto (§ 3 Abs. 3) |
| `grid_fee_cents`, `bio_cost_cents` | § 5a, § 3 Abs. 1 Nr. 6; bis PR 18 gesperrt |
| `share_permille` | nullbar; eingetragener Anteil an der Heizperiode, die das Ende der Rechnung enthält. Überschreibt die Stufen 1–3 aus 3.2. |

**Keinen Zeitraumschlüssel:** Der Anteil je Heizperiode entsteht aus den Daten (3.2). Der Schnappschuss lädt die Lieferungen der Anlage, deren Zeitraum oder Lieferdatum H berührt, dazu die des Vor- und Folgezeitraums. Die Begründung steht als Kommentar an der Stelle, wie bei den Ablesungen.

### 5.5 CO₂ (PR 6)

**`co2_statements`:** Primärschlüssel = `heating_period_id` (CASCADE), also eine Zeile je Anlage und Heizperiode. Der Zeitraum ist der von H. **Es gibt kein eigenes Feldpaar `period_from`/`period_to` mehr** (W1, eine Wahrheit).

| Spalte | Bedeutung |
|---|---|
| `method` | `serviceDeducted \| serviceShown \| selfAfterService \| self`, **ohne Vorgabe** |
| `area_m2` | nullbar; Fläche der Einstufung, Vorgabe in 9.2 |
| `service_emissions_kg`, `service_area_m2`, `service_kg_per_m2`, `service_landlord_permille`, `service_total_cents` | laut Messdienst |
| `service_landlord_cents` | L |
| `service_users_total_cents` | S, bei `service*` Pflicht |
| `service_cost_item_id` | Position, in der L gebucht wird; SET NULL |
| `service_self_landlord_cents` | L_self laut Messdienst |
| `service_fuel_gross_cents` | G: Brennstoff laut Lieferantenrechnung. Vorbelegt aus Σ `fuel_deliveries.amount_cents` |
| `service_fuel_net_cents` | V: Brennstoff in der Verteilung des Messdienstes |

**Bedingungen:**

- `service_*` nur bei `service*`; dort sind S, L, ‰ und der Einstufungswert Pflicht.
- `method` ohne Vorgabe: Die API lehnt einen Datensatz ohne Methode ab.

**`co2_tenant_reliefs(statement_id, tenancy_id, cents ≥ 0)`:**

- `guardTenancy` prüft das Mietverhältnis.
- `crossPropertyViolations` fragt die Tabelle mit ab.
- Bei `serviceShown` wird der Betrag abgezogen, bei `serviceDeducted` dient er nur dem Ausweis.

`co2_refunds` (PR 19) ist unverändert aus dem CO₂-Entwurf übernommen.

### 5.6 Selbstabrechnung (PR 12, 13)

- **`heating_service_values`** (PR 12): `(heating_period_id, unit_id, from)` als Primärschlüssel, dazu `to`, `heat_value`, `water_value`. Es sind die Werte eines Ablesedienstes je Nutzungszeitraum.
- **`heating_estimates`** (PR 13): `(heating_period_id, unit_id, part)` als Primärschlüssel, `part` ist `heat | water`. Dazu `value`, `method` (`previousPeriod | comparableUnit | buildingAverage`, die drei Wege aus [G] § 9a Abs. 1), `reason` (Pflicht) und `confirmed`.

### 5.7 Gemeinsames Modell (`shared/types.ts`)

**Neue Typen:**

- `PeriodKey`
- `HeatingPlant`
- `HeatingPeriodData`
- `FuelDelivery`
- `Co2Statement`, `Co2Method`
- `HeatingEstimate`, `HeatingServiceValue`
- `AppliedValue`

**Erweiterungen:**

- `MeterType` + `'warmwasser' | 'hkv'`, `CostKey` + `'heatingSystem'`, `PropertyKind` + `'zfh'`.
- `LandlordReason` + `'co2Share' | 'fuelCarry' | 'co2Refund'`.
- `SettlementRow.kind?: 'co2Relief' | 'fuelCarry' | 'co2Refund'`. Diese Zeilen haben keine Kostenposition. Abrechnung.tsx (Belegsuche) und tenantFolder.ts sind darauf zu prüfen.
- `Settlement.heating?: HeatingStatement[]` je Anlage und eingestellter H, mit Töpfen, Preisen, Werten, Gradtagsanteilen, Schätzungen, § 6a und CO₂-Bewertung.
- `Settlement.period?`, `Settlement.legalBasis.values?`.
- `Statement.heatingOnly?: boolean` (3.1).

`schema.test.ts` hält Schema und Typen zusammen.

### 5.8 Schnappschuss

`Snapshot` bekommt:

- `period` (P);
- `heatingPeriods`: je Anlage die in P eingestellten H mit `{ key, from, to, short }`;
- die Anlagen samt Einheiten;
- die `heating_periods`-Zeilen dieser H und der Vorperiode (Vorbelegung des Bestands);
- die Lieferungen (5.4), CO₂-Datensätze, Schätzungen und Ablesedienstwerte;
- die Kostenpositionen mit `period` = P **oder** = einer eingestellten H.

**Mietverhältnisse, Ablesungen und Zahlungen** gehen wie bisher vollständig hinein (siehe snapshot.ts).

`snapshotOf(source, year)` für Umstieg und Regression setzt P = H = Kalenderjahr und keine Anlage.

### 5.9 Weitere Tabellen

- **`law_overrides`** (PR 17): `param_id`, `valid_from`, `value_json`, `source` (Pflicht), `entered_at`; Primärschlüssel `(param_id, valid_from)`. Nur für Parameter mit `overridable` (Prüfung in repository.ts, 400).
- **Backup:** Alle Tabellen liegen in der Datei und gehen mit `VACUUM INTO`.
- **Wiederherstellen** prüft zusätzlich:
  - `orphanPeriodKeys`: Schlüssel ohne Zeitraum beim Objekt bzw. der Anlage;
  - überlappende Anlagen;
  - Einheiten, Mietverhältnisse und Lieferungen über Objektgrenzen (`crossPropertyViolations` erweitert).
- **Umstieg:** Die db.json kennt nichts davon. Der Eingang schreibt 0000, die Kette zieht `year` auf `period` um, und es entsteht keine Anlage. Die Regression rechnet beide Seiten mit Kalenderjahr und ohne Anlage.
- **Praxislauf:**
  - Fall 15 „Backup mit abweichendem Zeitraum, Rumpf und eigener Heizperiode“;
  - Fall 16 „Datenbank 0.10.1 → 0.11.0 mit Kostenpositionen in fünf Jahren“, prüft `year` → `period` und dass jede Zahl gleich bleibt.

---

## 6. Der Rechenweg von der Versorgerrechnung bis zum Mieter

Dieser Abschnitt beschreibt die Reihenfolge der Berechnung. Die Einzelheiten stehen in den Abschnitten 7 bis 9.

Neue Dateien, alle als reine Funktionen:

- `server/src/heating.ts` (Selbstabrechnung)
- `server/src/fuel.ts` (Lieferungen, Abgrenzung, Vorrat)
- `server/src/co2.ts` (Einstufung, Abzug)

Eingebaut werden sie in `computeSettlement`, und zwar über die Empfänger aus #202.

### 6.1 Ablauf je Gesamtabrechnung P

1. **Zeiträume bestimmen.** P aus den Regeln des Objekts. Je Anlage die eingestellten Heizperioden H (3.0). Gibt es keine Anlage, gibt es keine H, und die Heizpositionen laufen wie heute über P.
2. **Statements bilden.** Ein Statement bekommt jedes Mietverhältnis, das P berührt **oder** eine eingestellte H einer Anlage seiner Wohnung. Wer nur H berührt, bekommt `heatingOnly`: keine kalten Kosten, keine Vorauszahlungen.
3. **Kalte Positionen von P** werden wie heute verteilt. Schlüssel, Leerstand, Eigennutzung, Pauschale und #202 bleiben unverändert, nur die Tage zählen über P.
4. **Je Anlage und H:**
   1. **Topf** = Positionen mit `heating_plant_id` = Anlage und `period` = H.
   2. **Brennstoff** (`fuel.ts`): Anteil jeder Lieferung an H (3.2), bei Vorrat die Bestandsrechnung (8.2). Ergebnis: verbrauchte Brennstoffkosten F_H, Ausstoß E_H (umgerechnet, 3.3), CO₂-Kosten C_H, Netzentgelte, Abdeckung.
   3. **Verteilen nach `method`:**
      - `manual`: jede Position nach ihrem Schlüssel wie heute, nur über die Tage von H; die Warnungen aus #140.
      - `service`: Messdienstbeträge (`amounts`) wie heute; Mietverhältnisse aus H.
      - `self`: die Anlage berechnet je Empfänger exakte Gewichte g_r(z) (8.6), und jede Position wird damit **einmal** verteilt (`distributeCents`). Dazu kommen die Zeilen `fuelCarry` (8.2).
   4. **CO₂** (`co2.ts`) mit E_H, C_H und der Stufe:
      - `serviceDeducted`: Zerlegung des Vermieterrests (7.4);
      - alle übrigen Methoden: Abzugszeilen `co2Relief` je Mieter (9.4).
   5. **Kürzungsbeträge** je Mieter (6.5) und Hinweise.
5. **Vorauszahlungen** der Monate von P, Saldo, Vorschlag nach § 560 Abs. 4 (3.7).
6. **Ausweis:** Druckblöcke Heizkostenabrechnung (8.8), CO₂ (9.5), § 6a (8.8), Rechtsstand mit benutzten Werten (4.4).

### 6.2 Empfänger und Rundung (#202)

**Mieterzeilen:** Je Position bekommt jedes Mietverhältnis einen exakten Rohwert. Bei `self` sind das die Gewichte der Anlage, sonst der Schlüssel. Dann verteilt `distributeCents` die Position genau einmal.

**Vermieterzeilen:** `landlordRecipients` mit `take()` wie heute:

- `selfUse`, `flatRate`, `inclusive`, `outsideUnit`, `vacancy`/`amountsRest`;
- neu `co2Share` (7.4);
- neu `fuelCarry` (8.2).

**§35a:** `distributeLaborCents` mit denselben Rohwerten.

**Abzugszeilen `co2Relief`** sind eine eigene Verteilung des Gesamtabzugs R über die Mietverhältnisse (9.4). Der Gegenwert steht beim Vermieter als `co2Share`.

Damit gelten die Zusagen aus #202 unverändert:

- Summe centgenau;
- jede Zeile höchstens 1 ct neben ihrem exakten Wert;
- Gleichstand nach Kennung.

**Die eine Ausnahme bei widerspruchsfreien Daten** ist `fuelCarry`. Diese Vermieterzeile darf das Vorzeichen wechseln, wenn Vorrat aus dem Vorjahr verbraucht wird. Das steht als Ausnahme am Kommentar von `landlordRecipients`.

### 6.3 Leerstand, Eigennutzung, Pauschale, außerhalb

| Lage | Behandlung | Quelle |
|---|---|---|
| **Leerstand** | Nutzer der Wohnung. Trägt bei `self` seine Grundkosten (Gradtage) und seinen gemessenen Verbrauch, bei `service` den Rest der Messdienstbeträge (`amountsRest`). | [R] VIII ZR 159/05, übernommen |
| **Eigennutzung** | Nutzer mit eigenem Anteil (`selfUse`), in der Steuer privat (#163) | Bestand |
| **Pauschale, Inklusivmiete** | Der Anteil fällt dem Vermieter zu, wie heute (#93). Neu: Die Warnung `heating.flat-rate` nennt den Betrag nach der Verordnung, sobald `self` ihn kennt. | [R] VIII ZR 212/05, übernommen. Die Umrechnung des Heizanteils der Warmmiete in eine Vorauszahlung baut Mietfuchs nicht nach (offen wie #109). |
| **Außerhalb der Abrechnungseinheit** | wie heute (`outsideUnit`) | Bestand |

### 6.4 Steuer, Mietkonto

Siehe 3.10 und 3.11.

- Neu für die Steuer ist nur, dass `fuelCarry` außen vor bleibt.
- Der CO₂-Vermieteranteil steckt bei `serviceDeducted` im Bruttobetrag der Position. Damit ist #209 behoben (7.4).
- `co2Refund` mindert das Ist der Einnahmen, sobald verrechnet ist.

### 6.5 Kürzungsbeträge

Jede Kürzung wird **je Mieter beziffert und einzeln genannt, nie summiert**.

- Ob sich die Kürzungen addieren, regelt der Wortlaut nicht ([G] § 12 HeizkostenV, übernommen; die Berichtigung in #97 vom 04.10. gilt).
- ista nennt das Kürzungsrecht „kumulativ“ ([M] ista-FAQ, übernommen). Das ist die Auffassung eines Messdienstes und kein Gesetz.

| Kürzung | Prozentsatz (Register) | Grundlage der Prozente | Wann |
|---|---|---|---|
| nicht verbrauchsabhängig | `hkv.cut.not-by-consumption` | Anteil des Mieters an den nicht verbrauchsabhängig verteilten Heizpositionen, **nach** CO₂-Abzug | wie #140; dazu `heating.dhw-not-metered` ([R] VIII ZR 151/20), `heating.no-consumption` |
| Fernablesbarkeit | `hkv.cut.remote-reading` | Anteil an den Heizkosten nach Abzug | Gerät der Wohnung mit `remote_readable = false` in einer H, die 2027 berührt; unbekannt → Hinweis „bis zu“ (#214) |
| Informationen § 6a | `hkv.cut.information` | Anteil an den Heizkosten nach Abzug | `self`, Angaben § 6a Abs. 3 unvollständig (8.8) |
| CO₂ | `co2.cut.missing` | „den gemäß der Heizkostenabrechnung auf ihn entfallenden Anteil an den Heizkosten“ ([G] § 7 Abs. 4 CO2KostAufG, übernommen) nach Abzug | Hinweise `co2.missing`, `co2.service-unsplit`, `co2.incomplete`, `co2.sum-check` … |

**Rundung:** Jeder Betrag wird je Mieter kaufmännisch auf den Cent gerundet, wie heute bei der 15-%-Kürzung (Einzelzahl, keine Verteilung). Die Summe über die Mieter nennt der Hinweis zusätzlich („zusammen …“) als Summe der gerundeten Beträge.

**„Nach CO₂-Abzug“ als Grundlage** folgt dem Wortlaut beider Normen („der auf ihn entfallende Anteil“), denn der Anteil ist der nach dem Abzug. Ohne CO₂-Angaben ändert sich keine Zahl.

---

## 7. Messdienst-Übernahme (`method = 'service'`)

### 7.1 Was der Vermieter mit Messdienst tut, und was Mietfuchs prüft

Grundlage ist [M] der Marktvergleich 2.5. Je Mieter übernimmt der Vermieter „Ihre Heizkosten + Ihre Warmwasserkosten“ als Einzelbetrag (`amounts`). Der **Betrag der Position ist das Bezahlte**, also die Gesamtkosten **vor** „Abzüglich CO₂-Kosten Vermieter“. Warum: Die Werbungskosten sind die bezahlten Kosten (#209, Gegenprüfung A6).

Die Anleitung `meteringService` wird sofort berichtigt (PR 0).

### 7.2 Die Methode: eine sichtbare Tatsache, ohne Vorgabe

Die Frage lautet: „Steht in der Kostenaufstellung eine Zeile wie ‚Abzüglich CO₂-Kosten Vermieter‘, oder bei Ihren Mietern ‚vom Vermieter übernommen‘?“ Darunter steht die Beispielzeile aus dem Techem-Muster: „Anlieferung Brennstoff 3.540,00 · Abzüglich CO₂-Kosten Vermieter −87,50 · Verbrauch 3.452,50“ ([M] Techem-Musterabrechnung, übernommen).

Die Antworten führen zu diesen Methoden:

| Antwort | Methode |
|---|---|
| Ja | `serviceDeducted` |
| Nein, die CO₂-Kosten sind nur ausgewiesen | `serviceShown` |
| Der Messdienst hat gar nicht aufgeteilt | `selfAfterService` |

Belege für die Praxis der Messdienste:

- Techem und ista ziehen den Vermieteranteil im Mietshaus vorab ab ([M] übernommen).
- Bei Brunata, Minol und KALO ist der Vorwegabzug nicht im Wortlaut belegt (Marktvergleich 4.9). Deshalb gibt es die Frage und keine Annahme je Messdienst.

### 7.3 Die harte Probe `co2.sum-check` (error)

**Umfang:** Die Probe läuft nur über die **Messdienstpositionen** des Topfs, also die Positionen mit Schlüssel `amounts` (W9). Jede andere Position im Topf, etwa eine Gutschrift des Versorgers oder eine Wartung mit anderem Schlüssel, ergibt den Hinweis `co2.pool-foreign-item` (hint): „… gehört nicht zur Abrechnung des Messdienstes; sie nimmt an der CO₂-Prüfung nicht teil.“

| Methode | Verlangt |
|---|---|
| `serviceDeducted` | Σ Messdienstpositionen = S + L |
| `serviceShown` | Σ Messdienstpositionen = S |
| beide, zusätzlich | Σ eingetragene Einzel- und Eigenbeträge ≤ S |

**Toleranz, hergeleitet statt gesetzt.** Der Messdienst rundet jede Nutzerzeile und jeden Kostenblock je Nutzer auf den Cent. S ist die Summe dieser gerundeten Zeilen, die Gesamtkosten sind ungerundet bzw. auf den Cent der Rechnungen. Der Abstand ist deshalb höchstens 0,5 ct je gerundeter Zeile.

- Die Toleranz ist **n · 1 ct**, n = Zahl der Nutzerzeilen des Messdienstes, also der eingetragenen Einzel- und Eigenbeträge.
- Gerechnet wird mit zwei Kostenblöcken je Nutzer (Heizung und Warmwasser) zu je höchstens 0,5 ct.
- Dazu 1 ct für die Rundung von L.
- Die Teilentwürfe hatten 1 € angesetzt, ohne Quelle. Das entfällt.

**Wenn die Probe scheitert,** wird keine CO₂-Buchung für diese H ausgeführt: kein `co2Share` und keine Abzugszeilen. Die Mieter zahlen ihre Einzelbeträge wie eingetragen. Der Text nennt beide Deutungen mit Zahlen (aus dem CO₂-Entwurf übernommen): „Ihre Positionen ergeben 3.845,51 €. Mit Abzugszeile müssten es S + L = 3.933,01 € sein, ohne Abzugszeile S = 3.845,51 €. …“ Er nennt außerdem die 3-%-Kürzung je Mieter, denn ohne bestandene Probe ist die Aufteilung nicht nachgewiesen.

| Irrtum | Was die Probe sieht |
|---|---|
| „Ja“ bei Bruttobeträgen | Betrag = S, verlangt S + L → Fehler |
| „Ja“ bei Nettobetrag der Position (#209) | Betrag = S → Fehler, mit dem richtigen Betrag |
| „Nein“, obwohl abgezogen, Betrag brutto | Betrag = S + L, verlangt S → Fehler |
| Leerstand, fremde Einheiten, fehlende Eigenbeträge | spielen keine Rolle: Die Probe läuft gegen S |

### 7.4 Vorwegabzug: Zerlegung des Vermieterrests (`serviceDeducted`)

Den Mietern wird **nichts abgezogen**. In der Position `service_cost_item_id` (Pflicht ab zwei Messdienstpositionen, sonst die einzige) zerlegt `landlordRecipients` den Rest nach Einzel- und Eigenbeträgen:

1. **L_self:**
   - der Wert `service_self_landlord_cents` laut Messdienst, sonst die Näherung L · selfNet / S;
   - die Näherung ist exakt nur bei einem linearen Schlüssel für alle Topfkosten, der Rechenweg nennt sie „Näherung“;
   - er steht in `selfUse` und ist in der Steuer privat.
2. **`co2Share`** = L − L_self, der abziehbare Teil.
   - Beide Teile laufen über `take()`.
   - **Reicht der Rest nicht für beide, werden beide anteilig gekürzt** (W10, Abschlussprüfung Punkt 3). Das geschieht nur bei einem Datenfehler, den die Probe ohnehin meldet.
3. **`amountsRest`** = was übrig bleibt (Leerstand, außerhalb). Wegen `take()` kann es nicht negativ werden.

Gerundet wird mit allen Empfängern in einem Restverfahren (#202).

**Absicherung der Restlücke** (Abschlussprüfung Punkt 4). Die Probe kann einen Fall nicht unterscheiden: Antwort „nein“, obwohl abgezogen wurde, **und** Betrag = S. Dafür gibt es zwei optionale Felder:

- **G** = Brennstoff laut Lieferantenrechnung, vorbelegt aus `fuel_deliveries`;
- **V** = Brennstoff in der Verteilung des Messdienstes („Verbrauch 3.452,50“).

Gilt bei `serviceShown`, dass |G − V − L| ≤ 1 ct + Rundung von L, erscheint `co2.probably-deducted` (warning): „Die Brennstoffkosten des Messdienstes liegen genau um den Vermieteranteil unter Ihrer Gasrechnung; vermutlich ist er schon abgezogen.“

Bleibt die Lücke trotzdem, hält ein Test sie fest. #103 liest die Abzugszeile künftig aus (PR 20).

**Ausweis:**

- je Mieter „in Ihren Heizkosten enthalten“ und „vom Vermieter übernommen“ aus `co2_tenant_reliefs`, sonst die Anzeigenäherung L · Netto_t / S (gerundet, ohne Buchung);
- Einstufung und Grundlagen laut Messdienst;
- der Satz „Der Anteil des Vermieters ist in den Heizkosten oben bereits abgezogen.“

**Beispiel A (Techem-Muster, übernommen und nachgerechnet):**

- Anlieferung 3.540,00 €, −87,50 € (250,00 € · 35 %; 46,4 kg/m² → 70 %, halbiert nach § 9).
- S = 3.845,51 €. Betrag der Position 3.933,01 €. Probe bestanden.
- `co2Share` 87,50 €, kein Mieter gekürzt, Werbungskosten 3.933,01 €.

**Beispiel B (Eigennutzung):** S = 2.900 €, L = 100 €, eigene Wohnung netto 600 €.

- L_self = 20,69 €, `co2Share` 79,31 €, Eigenanteil 620,69 €.
- Mit ausgewiesenem L_self 25,00 € sind es 75,00 € und 625,00 €.

**Beispiel C (Leerstand):** wie B, die dritte Wohnung steht leer und ist nicht eingetragen. Ergebnis: `co2Share` 100 €, `amountsRest` 600 €.

### 7.5 Nur ausgewiesen (`serviceShown`)

Hier gibt es Abzugszeilen je Mieter wie bei eigener Aufteilung (9.4):

- mit den Einzelwerten aus `co2_tenant_reliefs`, geprüft auf Σ r_t ≤ L und r_t ≤ x_t, sonst `co2.reliefs-invalid` (error) und proportional;
- fehlt ein Einzelwert, `co2.reliefs-missing` (warning), und dieser eine Wert wird proportional ergänzt.

Der Fall ist so bei Eigentümergemeinschaften, die nur informativ ausweisen ([M] Marktvergleich: ista- und Techem-Variante 2, übernommen).

### 7.6 Messdienst hat nicht aufgeteilt (`selfAfterService`)

- Ohne eigene Rechnung gibt es die Warnung `co2.service-unsplit` mit 3 % je Mieter, denn die Kürzung ist sicher ([G] § 7 Abs. 4 CO2KostAufG).
- Trägt der Vermieter die Gasrechnung als Lieferung ein (`fuel_deliveries` ohne Kostenposition, 5.4), teilt Mietfuchs selbst auf (9.4). Dann gibt es den Hinweis `co2.service-unsplit-healed` mit „bis zu 3 %“. Ob ein nachgeholter Ausweis in der Betriebskostenabrechnung die Kürzung ausschließt, ist nicht entschieden (15.1 Nr. 3).
- Dazu kommt der Ausdruck „CO₂-Angaben für den Messdienst“ (#210, PR 17).

### 7.7 Warmwasser beim Messdienst (#211)

Die Messdienstabrechnung nennt, wie der Warmwasseranteil ermittelt wurde („Wärmezähler“ oder „nach § 9 Abs. 2 HeizkostenV“). Mietfuchs fragt das als Angabe ab (`heating_periods.dhw_method`, auch bei `service`).

- Bei einer Formel ohne bestätigten unzumutbaren Aufwand gibt es `heating.dhw-not-metered` (warning) mit 15 % je Mieter ([R] VIII ZR 151/20, geprüft 05.10.).
- Ohne Angabe gibt es keinen Hinweis.

### 7.8 Eigener Zeitraum des Messdienstes

Das ist Facette 1 (3.1). Der Messdienst rechnet über H, und die CO₂-Angaben gelten für H. Ein eigenes Feldpaar am CO₂-Datensatz entfällt.

---

## 8. Eigene Heizkostenabrechnung (`method = 'self'`)

Die Abschnitte 3 bis 8 des Teilentwurfs #99 sind übernommen. Hier steht, was gilt, mit den Änderungen aus der Gesamtsicht. Wortlaut: [G] HeizkostenV §§ 1–12 (übernommen 04.10., § 9b geprüft 05.10.).

### 8.1 Erfassung

| Erfassung | Unterstützt | Quelle |
|---|---|---|
| Wärmemengenzähler je Wohnung (kWh) | ja | § 5 Abs. 1 S. 1 |
| Warmwasserzähler je Wohnung (m³) | ja, Typ `warmwasser` | § 5 Abs. 1 S. 1, § 8 |
| Elektronische HKV, selbst abgelesen, Produkt- oder Einheitsskala mit Bewertungsfaktor je Gerät | ja (PR 12) | § 5 Abs. 1 S. 1: Wärmezähler **oder** HKV, gleichrangig. Die Skalen nach [M] Haufe HeizKV § 5.3 und Berliner Mieterverein: Bei der Einheitsskala muss der Faktor in der Abrechnung stehen (übernommen). Die Gerätenorm DIN EN 834 ist nicht gelesen. |
| Werte eines Ablesedienstes je Wohnung und Nutzungszeitraum | ja (PR 12), deckt Verdunster und Funk-HKV ab | – |
| Verdunster selbst auswerten | nein | Skala, Kaltverdunstungsvorgabe, Ampullentausch, Zeitfenster 400–800 ‰ für Zwischenablesungen ([M] ARGE) liegen beim Ablesedienst |
| Gemischte Ausstattung in einer Anlage | nein: Fehler `heating.mixed-capture` mit Verweis auf den Messdienst | § 5 Abs. 7 verlangt eine Vorerfassung nach Gruppen |

**Elektronische HKV setzen am Stichtag zurück** und speichern den Stichtagswert ([M] ista-Gerätebeschreibung). Erfasst wird das wie ein Zählerwechsel: `replacement: true`, `oldEndValue` = Stichtagswert, `value` = 0. Weicht der Gerätestichtag vom Beginn von H ab, gibt es `heating.device-cutoff` (warning).

### 8.2 Brennstoffkosten: Verbrauch statt Lieferung

Grundlage: [G] § 7 Abs. 2 HeizkostenV („verbrauchten Brennstoffe“) und [R] VIII ZR 156/11.

**Gas, Fernwärme, Wärmepumpenstrom:**

- F_H = Σ_d Betrag_d · Anteil_d(H), mit dem Anteil nach 3.2.
- Ein Rest, der nach H+1 gehört, steht dort als „Brennstoff aus früherer Rechnung“.

**Öl, Flüssiggas, Pellets, Holz: Bestandsrechnung.** Sie gilt einmal für Brennstoffkosten und CO₂.

- Anfangsbestand Q₀ mit Wert €₀, kg₀ und CO₂-€₀, vorbelegt aus dem bewerteten Endbestand von H−1.
- Lieferungen i im Zeitraum.
- Endbestand Q₁, **bewertet zu den jüngsten Lieferungen**. Verbraucht wird also das Älteste zuerst.
  - Grundlage: [M] GdW-Arbeitshilfe (Bestand zu Beginn und Ende), ista („Restbestände … ohne anteilige CO₂-Kosten“) und Immoware24 (Export von Anfangs- und Endbestand), alle übernommen aus dem CO₂-Entwurf.
  - Die **Bewertungsfolge** ist in keiner Quelle vorgeschrieben (15.2). mibakus rechnet so ([S], nur Idee, GPL).
- Verbrauchte Kosten = €₀ + Σ Lieferungen − €₁. Ebenso kg und CO₂-€.
- Q₁ > Q₀ + Σ q gibt `fuel.stock-invalid` (error).
- **Ohne Bestand** bei einer Vorratsenergie gibt es `fuel.stock-missing` (error). Die Anlage wird nicht verteilt, denn eine Abrechnung nach Lieferungen ist materiell falsch, und keine Kürzung heilt sie ([R] VIII ZR 156/11).

**Wie das in die Abrechnung kommt, ohne Steuer und Summen zu verbiegen** (aus #99 übernommen):

- Die Lieferrechnungen bleiben Kostenpositionen in voller Höhe in ihrem Zeitraum. So stimmen Steuer und Belegarchiv.
- Die Differenz zum Verbrauch stehen als zwei Zeilen je Anlage:
  - „Brennstoff aus Vorrat bzw. früherer Rechnung“ (+), mit den Gewichten des Ziels `both` verteilt;
  - „Brennstoff im Vorrat bzw. für den nächsten Zeitraum“ (−);
  - jeweils mit Gegenzeile beim Vermieter, Grund `fuelCarry`.
- Σ aller Zeilen = Σ Kostenpositionen. Die Mieter tragen genau den Verbrauch.

**Beispiel Heizöl** (übernommen, nachgerechnet; 300 m²):

| Posten | Menge | kg CO₂ | Wert | CO₂-€ |
|---|---|---|---|---|
| Anfangsbestand (Rechnung 2022) | 2.000 l | 5.352,6 | 1.900,00 € | 0 € (§ 11 Abs. 2 S. 2) |
| Lieferung 15.03.2025 | 3.000 l | 8.028,9 | 3.150,00 € | 525,49 € |
| Lieferung 10.10.2025 | 2.500 l | 6.690,7 | 2.500,00 € | 437,91 € |
| Endbestand | 1.800 l | aus der Lieferung vom 10.10. | 1.800,00 € | |

**Ergebnis:**

- Verbrauch 5.700 l. Kosten 1.900 + 3.150 + 2.500 − 1.800 = **5.750,00 €**.
- Bezahlt und in der Steuer: 5.650,00 €. `fuelCarry` beim Vermieter: −100 €.
- **E = 15.254,9 kg** (Abschlussprüfung Punkt 5), also 50,85 → **50,8** → Vermieter 80 %.
- C = 525,49 + 122,61 = **648,10 €**, **L = 518,48 €**.
- Endbestand trägt 4.817,3 kg und 315,30 € CO₂-Kosten nach 2026.

### 8.3 Warmwasseranteil α (§ 9)

| Methode | Q | α |
|---|---|---|
| `heatMeter` (Regel, § 9 Abs. 2 S. 1) | gemessen | Q / Energie des verbrauchten Brennstoffs, bei Wärmepumpe und Fernwärme Q / gemessene Gesamtwärme |
| `volumeFormula` (§ 9 Abs. 2 S. 2, 3) | 2,5 · V · (t_w − 10), Faktoren nach S. 6 | wie oben |
| `areaFormula` (§ 9 Abs. 2 S. 4, 5) | 32 · A, Faktoren nach S. 6 | wie oben |

- Bei Brennstoff in Litern oder kg ohne kWh: B = Q / H_i (§ 9 Abs. 3, Heizwerte aus dem Register).
- Gemessenes Q wird **nicht** mit 1,11 multipliziert. Der Wortlaut von S. 6 bezieht sich auf die bestimmte Wärmemenge der Formeln (übernommen, 15.1 Nr. 5).
- Mischanlagen (§ 9 Abs. 1 S. 5): nur `heatMeter` mit gemessener Gesamtwärme.
- Formel ohne `dhw_unmeasurable`: `heating.dhw-not-metered` (warning, 15 %, [R] VIII ZR 151/20). Mit Bestätigung: Hinweis ohne Betrag, Nachweis aufbewahren.

**Beispiel:** 60.000 kWh Hₛ, 200 m², 120 m³. Gemessen 9.000 kWh → **15,0 %**. Volumenformel → **27,75 %**. Flächenformel → **11,84 %**.

### 8.4 Nutzerwechsel (§ 9b)

Siehe 3.5. Gerechnet wird je Wohnung, dann je Nutzer (Mietverhältnisse, Leerstand, Eigennutzung):

| Kostenteil | Regel |
|---|---|
| Verbrauch | nach Zwischenablesung |
| Grundkosten Heizung | Gradtage (Vorgabe) oder Tage |
| Grundkosten Warmwasser | Tage |
| ohne Zwischenablesung | alles nach § 9b Abs. 3 |

Lineare Interpolation eines Wärmestands gibt es nicht. Ein Test wird rot, sobald sie jemand einführt.

### 8.5 Grund- und Verbrauchskosten (§§ 7, 8, 10)

- Je Topf T ∈ {Heizung, Warmwasser} mit Anteil p_T:
  - Grund = K_T · (1 − p_T) · a_u / Σ a,
  - Verbrauch = K_T · p_T · v_u / Σ v.
- **Grenzen aus dem Register:** Vorgabe 70, zulässig 50–70, über 70 nur mit `above_70_agreed` (§ 10). Bei `insulation_rule = applies` gilt zwingend 70 (§ 7 Abs. 1 S. 2), nicht bei Wärmelieferung (§ 7 Abs. 4).
- Σ v = 0 ergibt `heating.no-consumption` (warning, 15 %). Dann wird nach Fläche verteilt: unterstützen und warnen.
- Die Vorgabe 70 % ist zulässig in jedem Fall ([G] § 7 Abs. 1 S. 1) und in den Fällen von S. 2 Pflicht. Damit ist sie die einzige Vorgabe, die nie unzulässig ist.

### 8.6 Gewichte und Rundung

Aus 8.3 bis 8.5 entsteht je Empfänger r ein exakter Anteil an jedem Ziel:

- g_r(heating);
- g_r(water);
- g_r(both) = (1 − α) · g_r(heating) + α · g_r(water).

Jede Position mit Betrag A und Ziel z bekommt die Rohwerte A · g_r(z) und wird einmal verteilt (#202).

**Beispiel A** (aus #99, nachgerechnet 05.10.):

- Erdgas, drei Wohnungen, α = 15 %. K_H = 5.628,00 €, K_W = 1.032,00 €, 70/30.
- Exakte Summen: A **1.961,88**, B **2.615,84**, C1 **1.331,53**, C2 **750,75** (Wechsel in C zum 30.09.).
- Je Position verteilt: A 1.961,89 / B 2.615,84 / C1 1.331,52 / C2 750,75, zusammen 6.660,00 €.

### 8.7 Schätzung (§ 9a)

- **Wann:**
  - Gerät ohne verwendbaren Wert zu Beginn oder Ende von H (3.5: kein Stichtagswert und kein gemeinsames Ablesedatum);
  - Zählerwechsel ohne Endstand;
  - negativer Verbrauch;
  - als ausgefallen markiert.
- **Vorschlag:** die drei Wege des § 9a Abs. 1. Vorgabe ist der Durchschnitt des Gebäudes je m², denn er ist immer berechenbar. Gespeichert werden Methode und Begründung.
- **Unbestätigt** gibt es `heating.estimate-unconfirmed` (warning), bestätigt `heating.estimated` (hint).
- **Schwelle aus dem Register:** Ist die geschätzte Fläche > 25 % der Fläche des Topfs, wird dieser Topf nur nach Fläche verteilt (§ 9a Abs. 2), mit Hinweis `heating.estimate-over-25`.
  - Je Topf getrennt (15.1 Nr. 6).
  - Keine Kürzung nach § 12, denn das ist eine Verteilung nach der Verordnung (15.1 Nr. 7).
  - Die Oberfläche warnt vorher. Im Haus mit drei oder vier Wohnungen ist jede Wohnung mehr als 25 % der Fläche.

### 8.8 Ausweis und Pflichtangaben (§ 6a Abs. 3)

**Druckblock „Heizkostenabrechnung“** je Anlage und H:

- Kosten einzeln;
- Brennstoff mit Bestand oder Abgrenzung (Stufe 1–4 aus 3.2 benannt);
- α mit Methode;
- Grund und Verbrauch mit Gesamteinheiten und Preis je Einheit;
- eigene Werte samt Ablesungen und Faktoren (bei HKV je Gerät);
- Gradtagsanteile beim Wechsel;
- Schätzungen mit Methode;
- CO₂-Block (9.5);
- § 6a.

**§ 6a Abs. 3** ([G] übernommen):

| Nr. | Inhalt | Woher |
|---|---|---|
| 1 a | Anteil der Energieträger; bei Fernwärme Treibhausgasemissionen und Primärenergiefaktor | aus der Anlage bzw. abgefragt |
| 1 b | erhobene Steuern, Abgaben, Zölle | abgefragt |
| 1 c | Entgelte für Geräte, Eichung, Ablesung, Abrechnung | automatisch aus Teil `metering` |
| 2 | Kontaktinformationen von Verbraucherorganisationen, Energieagenturen | fester Text im Register, jährlich geprüft (4.8) |
| 3 | Streitbeilegung bei Verbrauchervertrag | nur mit `consumer_contract` |
| 4 | Vergleich mit Durchschnittsnutzer | Hausdurchschnitt je m², so benannt (15.2) |
| 5 | witterungsbereinigter Vorjahresvergleich, grafisch | Klimafaktor des DWD je Postleitzahl, abgefragt (15.2) |

- Fehlt 1 b oder 5, gibt es `heating.info-incomplete` (warning, 3 %).
- Im ersten Jahr ohne Vorjahr steht der Satz ohne Betrag.
- Bei Verteilung ohne Verbrauch genügen Nr. 2 und 3 (§ 6a Abs. 5).
- **Ableseergebnis** je Wohnung zum Stichtag als Ausdruck (§ 6 Abs. 1 S. 2).

### 8.9 Zweifamilienhaus, Ausnahmen, Eigentumswohnung

| Lage | Behandlung |
|---|---|
| Zweifamilienhaus (`zfh`) | Objektart als Beschreibung. **Die Ausnahme des § 2 hängt an Tatsachen** (`mayAgreeOtherwise`: höchstens zwei Wohnungen, eine selbst bewohnt). Ein Widerspruch gibt `property.kind-mismatch` (hint). „Abweichende Verteilung vereinbart“ ist nur dann wählbar und gibt keinen § 12-Hinweis. Ohne Vereinbarung gilt die Verordnung (15.1 Nr. 8). |
| § 11 | Eine gewählte Ausnahme führt zur Verteilung nach Fläche ohne § 12-Hinweis, dazu `heating.exemption` (hint, Nachweis aufbewahren). Für CO₂ gilt § 2 Abs. 7 CO2KostAufG: keine Aufteilung, außer eine Abrechnung ist vereinbart (übernommen). |
| Vermietete Eigentumswohnung | Keine Anlage: Die Gemeinschaft liefert die Abrechnung (§ 1 Abs. 2 Nr. 3). Der Schlüssel ist `external` oder `amounts`, und für CO₂ gilt `serviceShown`. Bei Vorwegabzug der Gemeinschaft wird `amounts` mit dem Nettobetrag erfasst (CO₂-Entwurf 5.4, übernommen). Kürzungen nach § 12 gelten nicht zwischen Eigentümer und Gemeinschaft (§ 12 Abs. 1 S. 4). |

---

## 9. CO₂ selbst aufteilen (`self`, `selfAfterService`)

### 9.1 Anwendbarkeit

Grundlagen: [G] §§ 2, 11 CO2KostAufG (übernommen bzw. geprüft 05.10.).

- Beginn von H ≥ 01.01.2023.
- Energie fossil oder Fernwärme.
- Kein `district_ets_new`, kein § 9 `both`, keine Ausnahme nach § 11 HeizkostenV ohne vereinbarte Abrechnung (§ 2 Abs. 7).

**Ohne Datensatz:**

| Lage | Hinweis |
|---|---|
| H beginnt ab 2023 und fossil | `co2.missing` (warning, 3 %) |
| Ohne Anlage ist der Zeitraum das Kalenderjahr; für das Jahr 2023 kann die Messdienstabrechnung 2022 begonnen haben | `co2.missing-first-year` (hint) |
| Energie unbekannt (keine Anlage) | `co2.fuel-unknown` (hint, „falls fossil: 3 % …“) |

### 9.2 Einstufung

1. **Fläche** = `area_m2` oder die Vorgabe: Σ Wohnfläche der versorgten Wohnungen (`isDwelling`). Bei `perUnit` nur vermietete Wohnungen mit Lieferung ([G] § 5 Abs. 1 S. 2: „deren Gesamtwohnfläche“). Die Herkunft wird ausgewiesen.
   - Welche Fläche gemeint ist, definiert das Gesetz nicht ([G] übernommen, #85).
   - Im Zweifel nimmt Mietfuchs die Fläche des Messdienstes, damit beide Angaben übereinstimmen (15.1 Nr. 1).
2. **E** nach 3.2/3.3 bzw. 8.2. **Wert** = round(E / Fläche, 1). Das Register sagt die Stellen; gerundet wird kaufmännisch mit 1e-9 Toleranz gegen Gleitkommarauschen.
3. **Kürzung der Tabelle** bei H < zwölf Monate (3.9).
4. **Stufe** aus dem Register, unten einschließend. Danach § 8 (500 ‰) und § 9 (× 0,5 bzw. keine). Ab 2028 und bei Anlage nach § 43 GModG gilt § 5a anteilig (3.9).
5. **L = C · ‰ / 1000**, exakt. Gerundet wird erst bei der Verteilung.

**Mietfuchs folgt dem Gesetz, nicht dem BMWK-Rechner.** Der Rechner rundet nicht und stuft 12,0 bei 0 % ein (CO₂-Entwurf 2.8, am Code des Rechners geprüft, übernommen). Die Tests halten beide Abweichungen fest.

**Methoden `service*`, Nachstufung:** C, L, Wert und ‰ kommen vom Messdienst. Mietfuchs stuft nach:

- Ein ganzzahlig gedruckter Wert wird als [w − 0,5; w + 0,5) gelesen.
- Weicht ‰ ab oder liegt L um mehr als 1 ct + Rundung neben C · ‰, gibt es `co2.stage-mismatch` (hint).

### 9.3 Mehrere Anlagen und Etagenheizung

- **F9:** Je Anlage gibt es eine eigene Einstufung. Eine Position, deren Verteilbasis in zwei Anlagen reicht, ergibt `co2.item-spans-plants` (error).
- **F8 (`perUnit`):**
  - Lieferzeilen je Wohnung. Die Einstufung erfolgt über Σ kg / Σ Fläche.
  - Abzug je Wohnung: r_t = ‰ · C_u · x_t / A_u, **ohne** Normierung. Der Leerstand bleibt beim Vermieter.

### 9.4 Abzug als eigene Zeile

**Topf A** = Positionen der Anlage in H. x_t = Σ der **exakten** Anteile des Mietverhältnisses (aus `onAllocation`).

| Methode | r_t |
|---|---|
| `self`, `selfAfterService` | ‰/1000 · C_H · x_t / A |
| `serviceShown` | Einzelwert des Messdienstes (7.5) |

- **R** = round(Σ r_t), verteilt mit `distributeCents`.
- Die Zeile `co2Relief` trägt −r_t.
- Beim Vermieter steht `co2Share` mit R.
- L − R entfällt auf Eigennutzung, Leerstand, Pauschale und Wohnungen außerhalb. Der Vermieter trägt diese Teile ohnehin ganz.
- C > A oder kein Topf ergibt `co2.exceeds-heating` (error).

**Beispiel B1** (übernommen, nachgerechnet 05.10.):

- 24.105,6 kg / 600 m² = 40,2 → Vermieter 60 %. C = 773,79 €, L = 464,27 €.
- Bruttobeträge der drei Mieter: 3.600 / 3.000 / 2.400 €.
- Exakt: 185,708 / 154,757 / 123,805. Verteilt: **185,71 / 154,76 / 123,80 €**, zusammen 464,27 €.

### 9.5 Ausweis (§ 7 Abs. 3 CO2KostAufG)

Druckblock „CO₂-Kostenaufteilung“ je Anlage. Er ist nicht `no-print`, denn er erfüllt § 7 Abs. 3. Inhalt:

- Mieteranteil;
- Einstufung mit kompakter Stufentabelle und markierter Stufe (bei gekürzter Tabelle die gekürzten Grenzen);
- Grundlagen:
  - Energieträger, Zeitraum H;
  - kg je Rechnung mit Anteil und Verfahren (gemessen, Zwischenrechnung, Gradtage, eingetragen);
  - Abdeckung und „umgerechnet“;
  - Bestandsrechnung, Fläche und ihre Herkunft, C, L;
  - § 8, § 9, § 5a anteilig;
  - „laut Messdienst“ bzw. „bereits abgezogen“.

---

## 10. Hinweise, Regeln, Lexikon

### 10.1 Hinweis-Codes

Jeder Code steht in `noticeKinds` und trägt mindestens einen Begriff.

| Code | Stufe | Betrag | PR |
|---|---|---|---|
| `period.short` | hint (färbt nicht) | – | 3 |
| `period.item-outside` | warning | – | 3 |
| `period.heating-mismatch` | warning | – | 3 |
| `period.heating-differs` | hint (färbt nicht) | – | 5 |
| `period.heating-only-statement` | hint (färbt nicht) | – | 5 |
| `period.no-heating-period` | warning | – | 5 |
| `fuel.share-by-degree-days` | hint | – | 7 |
| `fuel.uncovered` | warning | fehlende Tage, ‰ | 7 |
| `fuel.stock-missing`, `fuel.stock-invalid` | error | – | 8 |
| `fuel.before-2023` | hint | – | 8 |
| `co2.missing` | warning | 3 % je Mieter | 6 |
| `co2.missing-first-year`, `co2.fuel-unknown` | hint | „falls …: 3 %“ | 6 |
| `co2.service-unsplit` | warning | 3 % | 6 |
| `co2.service-unsplit-healed` | hint | „bis zu 3 %“ | 7 |
| `co2.incomplete` | warning | 3 % | 6 |
| `co2.sum-check` | error | beide Deutungen, 3 % | 6 |
| `co2.pool-foreign-item` | hint | – | 6 |
| `co2.probably-deducted` | warning | – | 6 |
| `co2.stage-mismatch` | hint | – | 6 |
| `co2.reliefs-invalid` | error | – | 6 |
| `co2.reliefs-missing` | warning | – | 6 |
| `co2.exceeds-heating` | error | 3 % | 7 |
| `co2.item-spans-plants` | error | – | 9 |
| `co2.pool-keys` | hint | – | 7 |
| `co2.restriction`, `co2.non-residential` | hint | – | 7 |
| `co2.half-split` | hint | – | 18 |
| `co2.cost-implausible` | hint | – | 17 |
| `co2.refund-late`, `co2.refund-not-next` | hint | – | 19 |
| `co2.refund-due` | warning | – | 19 |
| `heating.no-interim-reading` | hint (färbt nicht) | § 9b-Abs.-3-Betrag | 10 |
| `heating.reading-dates-differ` | warning | – | 10 |
| `heating.device-cutoff` | warning | – | 12 |
| `heating.no-consumption` | warning | 15 % | 10 |
| `heating.dhw-not-metered` | warning | 15 % | 6 (service), 11 (self) |
| `heating.dhw-share-invalid` | error | – | 10 |
| `heating.dhw-share-implausible` | hint | – | 11 |
| `heating.mixed-capture`, `heating.hca-factor-missing`, `heating.target-invalid` | error | – | 10, 12 |
| `heating.estimate-unconfirmed` | warning | – | 13 |
| `heating.estimated` | hint (färbt nicht) | – | 13 |
| `heating.estimate-over-25` | hint | – | 13 |
| `heating.info-incomplete` | warning | 3 % | 14 |
| `heating.insulation-rule-unknown` | hint | – | 14 |
| `heating.exemption` | hint | – | 14 |
| `heating.change-fee` | hint | – | 10 |
| `heating.remote-reading` | wird beziffert (warning bei `false`) | 3 % | 4 |
| `heating.operating-power-double` | warning | Betrag | 15 |
| `heating.contracting` | hint | – | 16 |
| `meter.calibration-overdue` | warning | – | 21 |
| `property.kind-mismatch` | hint | – | 4 |
| `law.value-overridden` | hint | – | 17 |

**Zur Prüfung `heating.dhw-share-implausible` (α unter 5 % oder über 50 %):** Diese Grenzen haben keine Quelle. Sie sind keine Rechtsfolge, nur ein „bitte prüfen“, und stehen deshalb in 15.2.

**Ankündigung:** `co2.missing` und `co2.fuel-unknown` färben die Ampel. Sie erscheinen für alle Bestandsnutzer mit Heizposition ab 2023 und werden im CHANGELOG und in der Anleitung angekündigt.

### 10.2 Regelverzeichnis

Die qualitativen Regeln wandern mit den Parametern ins Register (4.2).

**Neu:**

| Regel | Norm |
|---|---|
| `co2-split` | §§ 5, 7, 11 CO2KostAufG |
| `co2-non-residential` | § 8 |
| `co2-restriction` | § 9 |
| `co2-half-split` | § 5a, ab 2028-01-01 |
| `co2-self-supply` | § 6 Abs. 2, 3 |
| `heating-own-settlement` | §§ 6–8 HeizkostenV |
| `heating-dhw-split` | § 9; [R] VIII ZR 151/20 |
| `heating-estimate` | § 9a |
| `heating-tenant-change` | § 9b; [R] VIII ZR 19/07 |
| `heating-consumed-fuel` | § 7 Abs. 2; [R] VIII ZR 156/11 |
| `heating-info` | § 6a Abs. 3, 5; § 12 Abs. 1 S. 3 |
| `period-annual` | § 556 Abs. 3 BGB; [R] VIII ZR 316/10 |
| `period-heating-differs` | [R] VIII ZR 240/07 |
| `meter-calibration` | MessEV; [R] VIII ZR 112/10 |

**Bestehende Regeln** bleiben: `tv-signal`, `heating-flat-rate`, `heating-consumption`, `heating-remote-reading`.

`ruleCoverage` wird bei Heizregeln mit **H** aufgerufen, nicht mit P.

### 10.3 Lexikon

Jeder Eintrag hat Beispiel mit Zahlen, Rechtsgrundlage und „Brauche ich das?“. Die Zahlen kommen aus dem Register.

| Gruppe | Begriffe |
|---|---|
| Zeiträume | `billingPeriod`, `shortPeriod`, `accrualPrinciple`, `heatingPeriod` (eigene Heizperiode, VIII ZR 240/07) |
| Heizanlage und Verteilung | `heatingSystem`, `baseCosts`, `consumptionCosts`, `hotWaterShare`, `degreeDays`, `interimReading`, `heatMeter`, `heatCostAllocator`, `heatingEstimate`, `fuelStock` |
| Angaben und Messung | `billingInfo`, `climateFactor`, `meterCalibration` |
| CO₂ | `co2Split`, `co2Stage`, `co2Area`, `co2Deducted`, `co2Refund`, `co2HalfSplit` |

---

## 11. Oberfläche für Laien

Die Logik liegt in DOM-freien Modulen, `client/src/heatingForm.ts`, `co2Form.ts` und `periodForm.ts`. Jedes Auswahlfeld wird aus Optionslisten gespeist; ein jsdom-Test prüft, dass der angezeigte Wert der gespeicherte ist.

### 11.1 Wer nichts einstellt

- Es gibt keinen neuen Pflichtschritt, kein neues Feld im Weg und keinen anderen Betrag.
- Sichtbar wird nur der angekündigte CO₂-Hinweis bei Heizpositionen ab 2023 mit dem Knopf „Heizung einrichten →“.
- Der Zeitraumumschalter sieht aus wie heute, solange das Objekt das Kalenderjahr nutzt.

### 11.2 Einrichtung „Heizung“

Die Einrichtung ist ein geführter Ablauf in den Stammdaten des Objekts. Jede Frage hat eine Vorgabe und einen Satz „Woran erkenne ich das?“.

1. **„Womit wird geheizt?“** Gas · Öl · Flüssiggas · Fernwärme · Wärmepumpe · Pellets/Holz · Strom · jede Wohnung hat eine eigene Heizung.
   - Bei „eigene Heizung“ folgt die Frage nach dem Vertrag:
     - Vertrag beim Mieter: Selbstversorger, keine Heizkostenabrechnung; der Erstattungsanspruch nach § 6 CO2KostAufG wird erklärt (PR 19);
     - Vertrag beim Vermieter: `perUnit`, Direktzuordnung je Wohnung.
2. **„Wer erstellt Ihre Heizkostenabrechnung?“**
   - Ein Messdienst oder die Hausverwaltung → `service`.
   - Ich selbst, mit Zählern oder Heizkostenverteilern → `self` (ab PR 10).
   - Niemand, die Heizkosten werden nach Fläche oder fest verteilt → `manual`, mit dem Satz zu § 12 (15 %) und beim Zweifamilienhaus zur Vereinbarung nach § 2.
3. **„Für welchen Zeitraum rechnet sie ab?“** Vorgabe ist der Zeitraum des Objekts.
   - Weicht er ab, bietet Mietfuchs die beiden Wege aus 3.1 an, mit Vorschau der Zeiträume und dem Hinweis auf den Mietvertrag.
   - Vorgeschlagen wird die eigene Heizperiode, wenn schon Daten im Kalenderjahr vorhanden sind.
4. **„Welche Wohnungen hängen an dieser Heizung?“** Vorgabe: alle Wohnungen.
5. **Nur bei `self`:** Warmwasser (über dieselbe Heizung? Wärmezähler am Speicher?), Erfassung, dann legt der Ablauf die Zähler an.

Nach Schritt 2 legt Mietfuchs die Anlage an. Bestehende Heizpositionen in **offenen** Zeiträumen werden ihr zugeordnet, mit Vorschau. Zahlen ändern sich dabei nicht, denn die Methode `manual`/`service` verteilt wie bisher.

### 11.3 Was ein Vermieter mit Messdienst mindestens tut

1. Einmalig: Heizung einrichten, Schritte 1–4 (zwei Minuten).
2. Je Abrechnung, wie bisher: die Position „Heizung und Warmwasser“ mit Schlüssel „Einzelbeträge“. **Betrag = Gesamtkosten der Heizungsanlage vor ‚Abzüglich CO₂-Kosten Vermieter‘**, je Mieter „Ihre Heizkosten + Ihre Warmwasserkosten“.
3. Neu, Karte „CO₂-Kosten“ (ab 2023):
   - die Frage nach der Abzugszeile (ohne Vorgabe);
   - fünf Zahlen aus der CO₂-Seite der Messdienstabrechnung: S, kg/m², Anteil Vermieter, CO₂-Kosten gesamt, davon Vermieter.
   - Live darunter die Probe: „Ihre Positionen: 3.933,01 € · erwartet: 3.933,01 € ✓“.
4. Optional: Gasrechnung als Lieferung (für G und V oder wenn der Messdienst nicht aufgeteilt hat), Angabe zum Warmwasseranteil.

### 11.4 Weitere Stellen

| Stelle | Änderung |
|---|---|
| Zeitraumumschalter (`YearProvider` → `PeriodProvider`) | Führt `periodKey` und `calendarYear`. Ohne Abweichung ist es ein Umschalter wie heute. Mietkonto und Steuer zeigen das Kalenderjahr. |
| Kosten | Leistungszeitraum unter „Weitere Angaben“, Aufteilung beim Speichern mit Vorschau (3.4), Steuerjahr nur bei Zeitraum über zwei Jahre |
| Seite „Heizkosten {Zeitraum}“ | Ab einer Anlage mit `self` oder einer CO₂-Karte. Karten: Kosten und Brennstoff (mit Lieferungen, Abgrenzung je Stufe, Vorrat), Warmwasser, Ablesungen (Ampel je Wohnung: Stichtag Beginn/Ende, Wechsel; „Stichtagswert“), Verteilung (Vorschau), CO₂ |
| Mieterwechsel (#150) | fragt Wärme-, Warmwasserzähler und HKV mit ab, mit dem Satz, dass die Kosten der Zwischenablesung nicht umlagefähig sind (VIII ZR 19/07) |
| Abrechnung | Druckblöcke; Kopf mit beiden Zeiträumen bei abweichender Heizperiode |
| Cockpit | Frist mit Zeitraum; Ampel liest die Hinweise |
| Anleitungen (`shared/guides.ts`) | `meteringService` berichtigt (PR 0); neu „Heizung einrichten“, „CO₂-Kosten aufteilen“, „Heizkosten selbst abrechnen“, „Abrechnungszeitraum Mai–April“; `multiFamily`, `granny`, `condo` verweisen; Betriebsstrom-Satz |

---

## 12. Tests

### 12.1 Golden-Fixtures (neu, mit README und Herleitung von Hand)

**Bestehende Fixtures:** F01–F11 bleiben wortgleich (db.json und expected.json). Ein Gleichheitstest prüft, dass `snapshotFor` mit Regeln `{ startMonth: 1, changes: [] }` und ohne Anlage dasselbe ergibt wie `snapshotOf(…, year)`, über das ganze Ergebnis außer `legalBasis.values`.

**Neue Fixtures:**

| Fixture | Inhalt | Prüft |
|---|---|---|
| **F12 Mai–April, Messdienst ohne CO₂** | anonymisierte reale Abrechnung (unten) | Zeitraum, `service`, `co2.service-unsplit` |
| **F13 Mai–April mit eigener Aufteilung** | wie F12, dazu die Gasrechnung als Lieferung | Abgrenzung nach Gradtagen, Umrechnung von E, Abzugszeilen |
| **F14 Eigene Heizperiode** | Objekt im Kalenderjahr, Anlage Mai–April, Auszug 31.10.2025 | Abrechnung nur mit Heizkosten, Frist, Vorauszahlungen |
| **F15 Techem-Muster mit Vorwegabzug** | Beispiel A | Probe, `co2Share`, Steuer 3.933,01 € |
| **F16 Eigene Heizkostenabrechnung** | Beispiel A aus 8.6 | centgenau 1.961,89 / 2.615,84 / 1.331,52 / 750,75 |
| **F17 Heizöl mit Vorrat** | Beispiel 8.2 | 5.750,00 €, `fuelCarry` −100 €, L 518,48 € |
| **F18 Rumpfzeitraum** | Wechsel auf Mai 2025, Grundsteuer zeitanteilig | 157,81 / 322,19 €, gekürzte CO₂-Tabelle, Frist 30.04.2026 |

**F12, die reale Abrechnung.** Sie stammt aus der Abrechnung eines Hauses mit vier Einheiten, Messdienst-Komplettabrechnung. Namen, Adressen, Nutzernummern und Zählernummern werden **nicht** übernommen, nur Beträge, Flächen und Zeiträume.

| Angabe | Wert |
|---|---|
| Wohnfläche | 200,6 m² |
| Zeitraum | 01.05.2025–30.04.2026 |
| Gas | eine Rechnung, 29.886 kWh, 3.117,47 € |
| Verteilung | Grund- und Verbrauchsanteil 30/70 |
| Heizkosten | 4.035,70 € |
| Warmwasser | 240,81 € |
| CO₂-Aufteilung | keine |

**Erwartung F12:**

- Objekt mit Beginnmonat 5; Abrechnung `2025-05`, Bezeichnung „2025/2026“.
- Frist **30.04.2027**.
- Heizposition 4.276,51 € als `amounts`. Die vier Einzelbeträge schreibt die Umsetzung aus dem Beleg ab.
- Methode `selfAfterService` ohne Lieferung → `co2.service-unsplit` (warning):
  - je Mieter 3 % seines Betrags, kaufmännisch gerundet;
  - die Summe liegt bei 3 % · 4.276,51 = 128,2953 €, also zwischen **128,27 und 128,32 €** (vier Rundungen zu je höchstens 0,5 ct). Den genauen Wert hält das Fixture fest.
- Keine 15-%-Kürzung, denn 30/70 nach Verbrauch.
- Ohne Angabe zum Warmwasseranteil kein `dhw-not-metered`.

**Erwartung F13** (wie F12, dazu die Gasrechnung als Lieferung mit Zeitraum 15.03.2025–14.03.2026 und den kg der Rechnung):

- Anteil nach Gradtagen 848,71 ‰. Lücke 15.03.–30.04.2026, also 47 Tage und 151,29 ‰ → `fuel.uncovered`.
- E umgerechnet = E_Rechnung · 848,71 / 848,71 = E_Rechnung, denn die Rechnung und H umfassen je zwölf Monate.
- C = C_Rechnung · 0,84871. Nicht hochgerechnet.
- **Die kg der Rechnung sind nicht bekannt.** Die Schätzung über den Faktor der EBeV (29.886 · 0,18139 ≈ 5.421 kg, 27,0 kg/m², Stufe 40 %) dient **nur** als Plausibilität. Das Fixture verwendet die kg der Rechnung, sobald sie vorliegen (Gegenprüfung E.10). Bis dahin trägt es einen erfundenen Wert, als solcher gekennzeichnet, nahe der Grenze 27,0.
- Zwei Varianten halten das Kippen der Stufe fest: 26,94 → 26,9 → 30 % gegen 26,95 → 27,0 → 40 %.

### 12.2 Engine (je Modul)

**`period.test.ts`:**

- Fristen 2025 / `2025-05` / Rumpf / 01.03.2023–29.02.2024 → 28.02.2025.
- Schaltjahr 01.05.2027–30.04.2028 = 366 Tage.
- `periodOfKey(…, '2025-01')` bei Beginnmonat 5 → `null`.
- Bezeichnungen.

**`law.test.ts`:** Stichtage je Parameter (4.7), Vollständigkeit, `LAW_AS_OF`, Wächter.

**`fuel.test.ts`:**

- Gradtage 621,29 / 848,71 / 530 ‰.
- Stufe 1 mit gemessenem Gaszähler.
- Eingetragener Anteil schlägt alles.
- Lücke: E umgerechnet, C nicht.
- Öl wie 8.2. Jahr ohne Lieferung: L > 0. Endbestand zu groß → Fehler. Bestand aus 2022: € 0, kg zählen.

**`heating.test.ts`:**

- Beispiel A centgenau samt Gegenproben: zeitanteilig 378,85 €; ohne Zwischenablesung 1.375,18 €.
- Ablesung am Tag d oder d + 1 ist eine Zwischenablesung. Am 03.10. bei Wechsel 30.09. gilt § 9b Abs. 3. Eine Ablesung im Leerstand trennt.
- **Keine lineare Interpolation:** Der Test verlangt bei fehlender Zwischenablesung den Gradtagsanteil und wird am linearen Wert rot.
- Verschiedene Ablesedaten ohne Stichtagswert → § 9a.
- α: 15 / 27,75 / 11,84 %; Öl über H_i = 10; × 0,30; ÷ 1,15; α ≥ 1 → Fehler; Formel bei Mischanlage gesperrt.
- Anteile: 70 Vorgabe; 50 zulässig; 75 ohne § 10 → 400; `insulation_rule = applies` erzwingt 70; Wärmelieferung ohne S. 2.
- Schätzung: 40 % Fläche → Topf nach Fläche; 20 % → Schätzung bleibt.
- HKV mit Faktoren 0,8 und 1,25. Stichtagsrücksetzung.
- Leerstand, Eigennutzung, Pauschale; Zweifamilienhaus mit und ohne Vereinbarung.

**`co2.test.ts`:**

- **Grenzen:**

  | Wert | Ergebnis | Anmerkung |
  |---|---|---|
  | 11,9 | 0 % | |
  | 11,95 | 12,0 → 10 % | BMWK-Rechner: 0 %, im Testnamen genannt |
  | 12,0 | 10 % | |
  | 51,9 | 80 % | |
  | 52,0 | 95 % | |

- § 9: 950 → 475, 100 → 50, 700 → 350 (L = 87,50 € aus 250,00 €); `both` → keine Aufteilung. § 8 → 500.
- Anwendbarkeit am Beginn von H. Rumpf mit gekürzter Tabelle (5,0 → 10 %). Mieterwechsel ist kein Teiljahr.
- Beispiele A bis A⁗ und die benannte Lücke aus dem CO₂-Entwurf:
  - A: `serviceDeducted`, Betrag 3.933,01 € → bestanden;
  - A′: `serviceShown`, S = Betrag = 3.933,01 € → Abzugszeilen zusammen 87,50 €;
  - A″: „ja“, Betrag 3.845,51 € → `co2.sum-check`;
  - A‴: „ja“ bei Bruttobeträgen → verlangt 4.020,51 €;
  - A⁗: „nein“, Betrag 3.933,01 € → verlangt 3.845,51 €;
  - Lücke: „nein“ und Betrag = S → bestanden, doppelter Abzug, und der Test hält das fest.
- Neu: **Gutschrift im Topf** (Abschlussprüfung Punkt 1). Eine Messdienstposition mit 3.933,01 € und eine Gutschrift des Versorgers mit −40 € → Probe bestanden, `co2.pool-foreign-item`.
- **G/V:** G = 3.540,00, V = 3.452,50, L = 87,50, `serviceShown` → `co2.probably-deducted`.
- **`take()` anteilig:** Rest 60 € bei L_self 20 und `co2Share` 80 → 12 und 48.
- B, C, B1. Toleranz der Probe: n Nutzerzeilen · 1 ct (+1 ct). n + 2 ct daneben → Fehler.
- § 5a: 271,80 €. Ohne Merkmal § 43 nach Stufen.

### 12.3 Invarianten über Zufallsbestände

Der Generator aus calc.test.ts und #202 bekommt einen festen Startwert und erzeugt:

- Rhythmen und Wechsel;
- Anlagen (alle Methoden, Energien, Erfassungen, eigene Heizperioden);
- Lieferungen mit beliebigen Zeiträumen;
- Vorrat, Wechsel mit und ohne Zwischenablesung;
- Leerstand, Eigennutzung, Pauschale;
- CO₂-Datensätze aller Methoden.

**Geprüft wird:**

1. Σ aller Zeilen = Σ Kostenpositionen von P und den eingestellten H, mit `fuelCarry`.
2. Je Position liegt jede Zeile ≤ 1 ct neben ihrem exakten Wert, keine Mieterzeile ist negativ bei positiven Kosten.
3. **Zerlegung der Zeit:** lückenlos, überschneidungsfrei, ≤ 12 Monate, Rumpf genau vor jedem Wechsel, Schlüssel eindeutig, `periodOfKey(key(p)) = p`.
4. **Jede Heizperiode landet in genau einer Gesamtabrechnung**, und jede Messdienstposition wird genau einmal verteilt.
5. **Jede Lieferung wird über alle H genau einmal verbraucht:** Σ_H Anteil = 1, wenn die H ihren Zeitraum lückenlos überdecken.
6. **Verschiebung um 120 Tage** (aus #208): Ein Kalenderbestand, um 120 Tage verschoben und im Zeitraum Mai–April gerechnet, ergibt centgleiche Anteile.
7. **Wechsel neutral:** Die Summe der Nutzer einer Wohnung hängt nicht davon ab, ob und wann gewechselt wird.
8. `serviceDeducted`: kein Mieter zahlt anders als sein Einzelbetrag, nie eine `co2Relief`-Zeile, keine Vermieterzeile negativ.
9. 0 ≤ r_t ≤ x_t; R ≤ L + 0,5 ct.
10. **Steuer:** Über alle Kalenderjahre steht jede Position genau einmal in den Werbungskosten, `fuelCarry` nie.
11. **Vorauszahlungen:** Ohne Jahreskorrektur ist die Summe der angerechneten Vorauszahlungen über eine Spanne gleich der des Mietkontos.
12. Ohne Anlage, ohne Rhythmus und ohne CO₂ ist jede Zahl gleich dem Stand vor 0.11.0.
13. Zwei Objekte und zwei Anlagen rechnen unabhängig.
14. Kürzungsbeträge je Mieter auf derselben Grundlage (nach Abzug).

### 12.4 API, Schema, Migration, Client

**`api.test.ts`:**

- Zeiträume (404 mit Satz, `2025` als Alias).
- Anlage anlegen samt Zuordnung offener Positionen.
- Sperren je PR (400).
- Fremdes Objekt → 400. Überlappende Anlagen → 400. Abgeschlossener Zeitraum beim Wechsel → 409.
- Der Abschluss friert `heating`, `co2`, `period` und `legalBasis.values` ein. `deviation` zeigt Werte und Geld.
- Mieterwechsel mit Zwischenablesung der Heizungszähler in einer Transaktion.

**Schema und Migration:**

- `schema.test.ts`, Marken jedes Schritts, `embed-migrations`.
- Kette auf einer Datenbank von 0.10.1 (`year` → `period`).
- `db-golden`, `db-changeover`, Praxislauf Fälle 15 und 16.

**Wächter und Lexikon:** `law-literals.test.ts`, `glossary.test.ts` (Beispiele nachgerechnet), `guides.test.ts` (Anleitungen nachgerechnet), `anrede.test.ts`, `categories.test.ts`.

**Client:**

- `periodForm`, `heatingForm`, `co2Form`: Vorgaben, Frage ohne Vorauswahl, Live-Probe, Übernahme aus dem Vorzeitraum nie mit Beträgen, 25-%-Warnung vor dem Markieren.
- jsdom für jedes neue Auswahlfeld.
- `notices.test.ts`: Ampel.

**Smoke-Test:** `PUT` einer Anlage und eines CO₂-Datensatzes, Abrechnung `2025-05` lesen.

---

## 13. Reihenfolge der PRs

**Für jede PR gilt:**

- Einzeln auslieferbar, ohne falsche Zahl zwischendurch.
- Funktionen späterer PRs lehnt der Server mit 400 und einem Satz ab („Die eigene Heizkostenabrechnung kommt mit einer späteren Version“).
- Jede PR mit Durchsicht mit frischem Kontext, `Refs #N`, CHANGELOG.
- Der Stapel jeder Phase bekommt eine Integrationsdurchsicht (Geld und Daten), Praxislauf und `full-check`.
- Migrationen in genau dieser Reihenfolge. Keine wird nach einem Rebase neu erzeugt (W7).

### Phase A: Fundament

| PR | Inhalt | Refs | Aufwand |
|---|---|---|---|
| **0** | Anleitung `meteringService`: Betrag vor Vorwegabzug, Blöcke je Kostenart, berichtigtes Beispiel; guides.test.ts. Sofort möglich, ohne Abhängigkeit. | #209 | 0,5 T |
| **1** | **Rechtsregister** `shared/law/` mit Parametern, Zeitregeln, Protokoll, `legalBasis.values`, `deviation` für Werte; Umzug aller bestehenden Rechtszahlen und Regeln; Wächter; Tests je Stichtag. Golden wortgleich. | #97, #110 | 2,5–3 T |
| **2** | **Zeitraum, Kern:** `shared/period.ts`; Migration 0014/0015 (`year` → `period` mit Datenanweisung, Rhythmus, Wechsel); Schnappschuss und calc.ts über P; `ledgerRows`; `settlementDeadline`; API mit Alias. Golden unverändert, Gleichheitstest, Invarianten 3, 6, 11, 12. Ohne Oberfläche für den Wechsel; der Beginnmonat ist bis PR 3 nur 1. | #208 | 4–5 T |
| **3** | **Zeitraum, Bedienung:** Beginnmonat und Wechsel mit Vorschau, Rumpf, Leistungszeitraum, Aufteilen beim Speichern, Steuerjahr, Steuer über zwei Abrechnungen, `PeriodProvider`, Cockpit, Hinweise `period.*`, Lexikon, F18, Praxislauf 15/16. | #208 | 4–5 T |
| **4** | **Heizanlage, Grundlage:** `heating_plants`, `heating_plant_units`, `heating_periods` (ohne Bestand); `cost_items.heating_plant_id`; Zähler `warmwasser` und `hkv` (ohne Faktor), Rolle, `remote_readable` mit beziffertem Hinweis; Wasserschlüssel zählt Warmwasser mit; `zfh`; Einrichtung Schritte 1, 2, 4. Methoden `manual` und `service` rechnen wie heute. **Sperren:** `self`, `perUnit`, zweite Anlage, eigene Heizperiode. | #99, #214, #180 | 3–4 T |
| **5** | **Eigene Heizperiode:** Rhythmus der Anlage, Zuordnung H → P, Abrechnung nur mit Heizkosten, Positionen im Schlüssel von H, Frist, F14, Einrichtung Schritt 3. | #217 | 3–4 T |

Nach Phase A kann ausgeliefert werden. Ein Vermieter mit Mai–April-Messdienst kann dann vollständig abrechnen, mit beiden Wegen aus 3.1.

### Phase B: Messdienst und CO₂

| PR | Inhalt | Refs | Aufwand |
|---|---|---|---|
| **6** | **CO₂ beim Messdienst:** `co2_statements`, `co2_tenant_reliefs`; `serviceDeducted`, `serviceShown`, `selfAfterService` (ohne Lieferung); Pflichtfeld S, Probe nur über Messdienstpositionen, hergeleitete Toleranz, G/V, `take()` anteilig; Ausweis; Hinweise `co2.missing` …; Warmwasser-Angabe laut Messdienst mit 15 %; Karte CO₂; F12, F15. **Sperren:** Lieferungen, Methode `self`. | #97, #209, #211 | 5 T |
| **7** | **Lieferungen und eigene Aufteilung, Gas, Fernwärme, Strom:** `fuel_deliveries`; Abgrenzung in vier Stufen samt Zählerrolle `supply`; Abdeckung, Umrechnung von E; Einstufung, Kürzung der Tabelle, § 8, § 9, ETS; Abzugszeilen; `service-unsplit-healed`; F13. **Sperre:** Vorratsenergien. | #97 | 4 T |
| **8** | **Vorrat** (Öl, Flüssiggas, Pellets, Holz): Bestand in `heating_periods`, Bestandsrechnung, Vorbelegung, `fuel.stock-*`, `fuel.before-2023`. Zunächst für CO₂; die Brennstoffkosten folgen mit PR 10. | #97 | 2 T |
| **9** | **Etagenheizung auf Vermietervertrag und mehrere Anlagen:** `perUnit` (Formel ohne Normierung), zweite Anlage mit Ausschluss, `co2.item-spans-plants`; Sperren aufheben. | #97 | 2 T |

### Phase C: Eigene Heizkostenabrechnung

| PR | Inhalt | Refs | Aufwand |
|---|---|---|---|
| **10** | **Kernrechnung:** Schlüssel `heatingSystem`, Teil und Ziel; Wärme- und Warmwasserzähler; α gemessen; 70/30; § 9b mit Zwischenablesung, Gradtagen, Abs. 3; Leerstand, Eigennutzung, Pauschale; Gewichte und #202; `fuelCarry` aus Lieferungen und Vorrat; Druckblock, Ableseergebnis; Seite Heizkosten; Einrichtung Schritt 5; F16, F17. Sperre `self` aufheben. | #99 | 7–9 T |
| **11** | **Warmwasser ohne Zähler:** Formeln, Faktoren, Heizwerttabelle (vollständig aus § 9 Abs. 3 abgeschrieben), `dhw-not-metered` bei `self`, Plausibilität. | #211 | 1,5 T |
| **12** | **HKV und Ablesedienst:** Bewertungsfaktor, Skala, Stichtagswert, `device-cutoff`, `hca-factor-missing`, `mixed-capture`; `heating_service_values`. | #99 | 2–3 T |
| **13** | **Schätzung § 9a:** `heating_estimates`, drei Wege, Dialog, 25 %, `reading-dates-differ` → § 9a. | #99 | 2 T |
| **14** | **Pflichtangaben und Ausnahmen:** § 6a Abs. 3 mit 3 %, Klimafaktor, Vergleich; § 11; § 2 Vereinbarung; § 7 Abs. 1 S. 2; § 10. | #99 | 2–3 T |

### Phase D: Hinweise, Zukunft, KI

| PR | Inhalt | Refs | Aufwand |
|---|---|---|---|
| **15** | **Betriebsstrom doppelt:** Heizanlage mit Betriebsstrom im Topf und Position „Allgemeinstrom“ ohne Abzug → `heating.operating-power-double` mit dem Betrag des Betriebsstroms; Abzug beim Allgemeinstrom als zweite Position „davon Betriebsstrom Heizung (nicht umlagefähig hier)“. **Keine Spanne für Schätzungen**, denn die Faustwerte von 3–10 % sind ohne Primärquelle. Grundlage: [G] § 7 Abs. 2 HeizkostenV (Betriebsstrom gehört zur Heizung); [R] V ZR 166/15 **ungeprüft**. | #212 | 1 T |
| **16** | **Wärmelieferung, Contracting:** Energie `districtHeating` mit Merkmal „Contracting im Haus“; Hinweise zu § 556c BGB und WärmeLV (Kostenneutralität, Ankündigung); § 7 Abs. 4 HeizkostenV (kein zwingendes 70 %); CO₂ wie Fernwärme. Wortlaut von § 556c und WärmeLV vor der PR lesen; BGH VIII ZR 46/25, 47/25 prüfen. | #213 | 1 T |
| **17** | **Plausibilität und Ausdruck für den Messdienst:** `co2.price`, `co2.price-ets`, EBeV, `law_overrides`, `co2.cost-implausible` mit Brennwertfalle; Ausdruck „CO₂-Angaben für den Messdienst“ (§ 3 Abs. 1 Nr. 1–4 je Rechnung, Fläche, § 8, § 9). | #97, #210 | 1,5 T |
| **18** | **§§ 5a, 5b ab 2028:** Merkmal § 43 GModG mit Einbaudatum, Netzentgelte und Biobrennstoff an der Lieferung, Teilung `incurred` nach 3.9, Notfalleinbau (§ 5a Abs. 4), Hinweis Härtefall § 5d. **Vorher den Wortlaut von § 5a Abs. 3, 4, § 5b und § 5d lesen.** Fällig, bevor die erste Heizperiode mit Tagen ab 01.01.2028 abgerechnet wird, also spätestens im Frühjahr 2028. In 0.11.0 geplant, verschiebbar ohne falsche Zahl dazwischen, solange die Sperre aus 4.6 gilt. | #215 | 2 T |
| **19** | **Selbstversorger-Erstattung:** `co2_refunds`, Gutschriftzeile, Fristhinweise, § 8, § 9, −5 %. | #97, #85 | 2 T |
| **20** | **KI (#103):** Messdienst-PDF mit Nutzerzeilen je Kostenblock und Nutzerzeitraum, Zeitraum der Abrechnung, CO₂-Block gesamt und je Nutzer, **Abzugszeile ja/nein** (füllt die Methode), Warmwasser-Ermittlung; Lieferantenrechnung mit § 3 Abs. 1 Nr. 1–4, 6 und Rechnungszeitraum. KI-Prüflauf mit erfundenen Belegen. | #103 | 3 T |
| **21** | **Eichfrist:** `calibrated_until`, `meter.calibration-overdue` ([R] VIII ZR 112/10). Empfehlung: #98 in den Meilenstein. | #98 | 1 T |
| **22** (entbehrlich) | Monatliche Verbrauchsinformation § 6a Abs. 1, 2 aus Monatswerten. | #99 | 1,5 T |

**Summe:**

| Umfang | Aufwand |
|---|---|
| Ohne PR 22 | **56–65 Arbeitstage** |
| Phase A | 17–21,5 T |
| Phase B | 13 T |
| Phase C | 14,5–18,5 T |
| Phase D | 11,5 T |

**Wenn gekürzt werden muss:** Phase A und B decken den häufigsten Fall vollständig ab, also Messdienst, auch Mai–April und mit eigener Heizperiode, samt CO₂. PR 10 und 14 machen die eigene Abrechnung rechtssicher. PR 11–13 sind die nächstwichtigen. PR 18 muss vor Frühjahr 2028 kommen. PR 22 kann warten.

---

## 14. Abdeckung

### 14.1 Heizlagen

Erweitert aus Abschnitt 15 des CO₂-Entwurfs. „Neues Issue nötig“ heißt: Es gibt noch keins, der Titel ist ein Vorschlag.

| Lage | Wie abgedeckt | PR | Issue |
|---|---|---|---|
| Messdienst mit Vorwegabzug | Bruttobetrag, Probe gegen S + L, `co2Share`, L_self privat, Steuer richtig; Restlücke mit G/V | 0, 6 | #97, #209 |
| Messdienst nur ausweisend (WEG informativ) | Abzugszeilen mit Einzelwerten, geprüft | 6 | #97 |
| Messdienst ohne Aufteilung | Warnung mit 3 % je Mieter; eigene Aufteilung aus der Gasrechnung; Ausdruck für den Messdienst | 6, 7, 17 | #97, #210 |
| Komplettabrechnung des Messdienstes | je Kostenart eine `amounts`-Position; KI liest alle Blöcke | 0, 20 | #103 |
| **Zeitraum des Messdienstes ≠ Kalenderjahr** | ganzes Objekt im Zeitraum oder eigene Heizperiode | 2, 3, 5 | #208, #217 |
| **Gasrechnung über den Zeitraumwechsel** | Zählerstand, Zwischenrechnung, Gradtage, eingetragen | 7, 10 | #97, #99 |
| Selbstabrechnung mit Wärmezählern | vollständig | 10, 11, 13, 14 | #99 |
| Selbstabrechnung mit elektronischen HKV | mit Bewertungsfaktor je Gerät | 12 | #99 |
| Verdunster | über Werte eines Ablesedienstes | 12 | #99 |
| Gemischte Ausstattung (Vorerfassung § 5 Abs. 7) | Fehler mit Verweis auf den Messdienst | 12 | **neues Issue nötig:** „Vorerfassung nach Nutzergruppen bei gemischter Ausstattung (§ 5 Abs. 7 HeizkostenV)“, Backlog |
| Warmwasser ohne Wärmezähler | 15 % beziffert, bei `service` aus der Angabe, bei `self` aus der Methode | 6, 11 | #211 |
| Rohrwärme (§ 7 Abs. 1 S. 3, 4) | nicht gerechnet, Hinweis im Lexikon | – | **neues Issue nötig:** „Rohrwärme nach § 7 Abs. 1 S. 3 HeizkostenV (VDI 2077 Beiblatt)“, Backlog |
| Mieterwechsel | Zwischenablesung, Gradtage, § 9b Abs. 3, Leerstand als Nutzer | 10 | #99 |
| Ablesung nicht am Stichtag | Stichtagswert, gemeinsames Datum, sonst § 9a | 10, 13 | #99 |
| Geräteausfall | § 9a mit 25 % | 13 | #99 |
| Pflichtangaben § 6a Abs. 3 | Druckblock, 3 % | 14 | #99 |
| Fernablesbarkeit | Merkmal am Zähler, 3 % beziffert | 4 | #214 |
| Monatliche Verbrauchsinformation | Hinweis, Ausdruck entbehrlich | 22 | #99 |
| Öl, Flüssiggas, Pellets, Holz | Bestand für Kosten und CO₂ | 8, 10 | #97, #99 (das im CO₂-Entwurf vorgeschlagene Issue „Brennstoffkosten nach Verbrauch“ ist damit abgedeckt) |
| Fernwärme | wie Gas; ETS-Erstanschluss; § 9 Anschlusszwang; α ÷ 1,15 | 7, 11 | #97, #99 |
| Contracting, Wärmelieferung | Hinweise § 556c, WärmeLV | 16 | #213 |
| Wärmepumpe, Strom | keine CO₂-Aufteilung; Selbstabrechnung mit Wärmezählern, α × 0,30 | 4, 10, 11 | #99 |
| Gemischte Anlage (Gas + Solar, Wärmepumpe + Heizstab) | CO₂ nur aus fossilen Lieferungen; α nur gemessen | 7, 10 | #97, #99 |
| Etagenheizung, Vertrag beim Vermieter | `perUnit` | 9 | #97 |
| Etagenheizung, Vertrag beim Mieter | Erstattung | 19 | #97, #85 |
| Mehrere Heizungen in einem Objekt | mehrere Anlagen | 9 | #97, #99 |
| Pauschale, Warmmiete | Anteil beim Vermieter, Betrag nach Verordnung genannt; BGH VIII ZR 212/05 nicht nachgebaut | 10 | #109 |
| Vermietete Eigentumswohnung | `external`/`amounts`, `serviceShown` | 6 | #97 |
| Zweifamilienhaus mit Eigennutzung | Objektart, § 2-Vereinbarung, CO₂ gilt | 4, 14 | #180, #99 |
| Gemischt genutztes Gebäude, Denkmal, Anschlusszwang | § 8, § 9 | 7 | #97 |
| Ausnahmen § 11 (Passivhaus, vor 1981 …) | Fläche ohne § 12, § 2 Abs. 7 CO2KostAufG | 14 | #99 |
| Betriebsstrom im Allgemeinstrom | Warnung mit Betrag | 15 | #212 |
| Rumpfzeitraum, Wechsel des Messdienstes | Rumpf, gekürzte CO₂-Tabelle | 3, 5 | #208, #217 |
| Ab 2028 Anlage nach § 43 GModG | hälftige Teilung anteilig | 18 | #215 |
| Eichfrist | Hinweis mit Beweislast | 21 | #98 (in den Meilenstein aufnehmen) |
| Gemeinschaftsräume mit hohem Verbrauch (Sauna, § 4 Abs. 3) | nicht gerechnet | – | Nicht-Ziel, selten |
| Bruttowarmmiete bei Wärmepumpe (§ 12 Abs. 3) | Lexikonsatz | – | Nicht-Ziel |

### 14.2 Die Issues des Meilensteins

| Issue | Wo im Entwurf | PR | Nach 0.11.0 |
|---|---|---|---|
| #85 (zwei Entscheidungen) | Entscheidung 1 revidiert: eigene Abrechnung nach HeizkostenV (8), auch mit HKV. Entscheidung 2: CO₂ (7, 9). Offene Punkte: Wohnfläche (15.1 Nr. 1), § 2 (15.1 Nr. 8), Detailtiefe (9.5). | alle | schließen |
| #97 CO₂ und Warnungen | 7, 9, 10 | 1, 6–9, 15, 17, 19 | schließen |
| #99 eigene Abrechnung | 8; Zuschnitt erweitert (HKV, Ablesedienst) | 4, 10–14, 22 | schließen |
| #103 KI Messdienst | 13 PR 20 | 20 | schließen |
| #180 (Teil Zweifamilienhaus) | 5.3, 8.9 | 4 | **Rest „Wohnung in ein anderes Objekt verschieben“ bleibt offen**; nicht Heizung, eigener Meilenstein |
| #208 Zeitraum | 3, 5.2 | 2, 3 | schließen; Kennung als `period` statt Zahlenschlüssel (W3) |
| #209 Steuer beim Vorwegabzug | 7.1, 7.4 | 0, 6 | schließen |
| #210 Ausdruck für den Messdienst | 7.6 | 17 | schließen |
| #211 Warmwasser ohne Zähler | 7.7, 8.3 | 6, 11 | schließen |
| #212 Betriebsstrom | 13 PR 15 | 15 | schließen |
| #213 Contracting | 13 PR 16 | 16 | schließen |
| #214 fernablesbar | 5.3, 6.5 | 4 | schließen |
| #215 §§ 5a, 5b | 3.9, 4.6 | 18 | schließen |
| #217 eigener Heizzeitraum | 3.1, W1 | 5 | schließen |

**Neue Issues** (Titel als Vorschlag; vor dem Anlegen nachfragen, denn Issues sind öffentlich):

1. „Vorerfassung nach Nutzergruppen bei gemischter Ausstattung (§ 5 Abs. 7 HeizkostenV)“
2. „Rohrwärme nach § 7 Abs. 1 S. 3 HeizkostenV (VDI 2077 Beiblatt)“
3. „Abflussprinzip für kalte Betriebskosten mit Zahlungsdatum“ (hängt an #188)
4. #98 in den Meilenstein 0.11.0 aufnehmen (kein neues Issue).

---

## 15. Offene Rechtsfragen und Festlegungen

### 15.1 Offene Rechtsfragen

Die Rechtslage ist hier ungeklärt. Mietfuchs wählt die vorsichtige Lesart und sagt es.

| # | Frage | Regel in Mietfuchs | Hinweis an den Vermieter |
|---|---|---|---|
| 1 | Wohnflächenbegriff im CO2KostAufG (nicht definiert; GdW: Fläche der Heizkostenabrechnung, bved: WoFlV; übernommen aus #85, #109) | eigenes Feld, vorbelegt mit der Fläche des Messdienstes bzw. Σ Wohnfläche | Lexikon `co2Area` |
| 2 | § 11 Abs. 2 S. 2 und die Einstufung: Der Wortlaut nimmt nur die **Kosten** aus | kg zählen, € nicht (Wortlaut, geprüft 05.10.) | `fuel.before-2023` |
| 3 | Heilt ein nachgeholter Ausweis die 3 %? (§ 7 Abs. 3: „in der Heizkostenabrechnung“) | abziehen und ausweisen, „bis zu 3 %“ | `co2.service-unsplit-healed` |
| 4 | Addieren sich die Kürzungen? | einzeln nennen, keine Summe | in jedem Kürzungshinweis |
| 5 | Gemessenes Q und Faktor 1,11 (§ 9 Abs. 2 S. 6) | nur für Formelwerte (Wortlaut) | Lexikon |
| 6 | 25 % je Topf oder gemeinsam (§ 9a Abs. 2) | je Topf | Lexikon |
| 7 | § 12 nach Flächenverteilung gemäß § 9a Abs. 2; 3 % bei Zeitraum, der 2027 nur teilweise berührt | keine 15 %; „bis zu 3 %“ | Hinweistexte |
| 8 | Reichweite des § 2 HeizkostenV (Haufe: Vereinbarung nötig) | ohne Vereinbarung gilt die Verordnung | Schalter heißt „vereinbart“ |
| 9 | Pauschale oder Warmmiete und § 6 Abs. 1 CO2KostAufG (Absenkung?) | keine Rechnung, Lexikonsatz | Lexikon |
| 10 | „Überwiegend dem Wohnen“ (§ 6 Abs. 1) | Schalter, Vorgabe Wohngebäude | Lexikon |
| 11 | Fernwärme-Erstanschluss ohne ETS-Anlagen (Rechner: 0 %) | Wortlaut | Lexikon |
| 12 | § 5a für eine Heizperiode über den 01.01.2028 | anteilig nach Anfall, Umrechnung nach § 5 Abs. 1 S. 5 (Wortlaut Abs. 1 geprüft). **Abs. 3 Nr. 2 vor PR 18 im Wortlaut prüfen.** | `co2.half-split` |
| 13 | Einseitiger Wechsel des Zeitraums mit Rumpf (kein BGH gefunden) | Rumpf; Hinweis auf den Mietvertrag | `period.short` |

### 15.2 Verbleibende Festlegungen ohne Primärquelle

Für jede ist der Rechercheweg genannt, die konservativste oder verbreitetste Lösung gewählt und ein Hinweis angezeigt. **Die Liste umfasst sieben Punkte.**

**F1: Rechnerische Abgrenzung einer Versorgerrechnung nach Gradtagen** (Stufe 3 in 3.2).

- *Recherche:*
  - § 5 Abs. 1 S. 5 CO2KostAufG nennt keine Methode.
  - § 7 Abs. 2 HeizkostenV und VIII ZR 156/11 verlangen den Verbrauch.
  - Minol empfiehlt Zwischenrechnung oder gleiche Zeiträume, nicht rechnerisch.
  - VDI 2077 ist nicht gelesen.
- *Lösung:* Die Stufen 1 (Zählerstand) und 2 (Zwischenrechnung) gehen vor. Erst danach gelten Gradtage, weil sie die einzige von Verordnung (§ 9b Abs. 2) und Messdiensten (ista, Minol, Brunata beim Nutzerwechsel) anerkannte zeitliche Verteilung von Heizwärme sind. Tagesgenau ist verworfen, denn es verschiebt Winterverbrauch.
- *Hinweis:* `fuel.share-by-degree-days`: „rechnerisch nach der Gradtagstabelle aufgeteilt; genauer und rechtlich sicherer ist der Zählerstand zum {Stichtag} oder eine Zwischenrechnung Ihres Versorgers“.

**F2: Lücken in der Abdeckung** (3.3).

- *Recherche:* § 5 Abs. 1 S. 5 verlangt Umrechnung, ohne Methode und Grenze. Der BMWK-Rechner rechnet Teilzeiträume hoch (übernommen). Techem rechnet im realen Beleg nicht um.
- *Lösung:* E umrechnen (Gesetz), C und Brennstoff nicht (nur Berechnetes). Keine Grenze, aber Warnung und Rückfrage beim Abschluss.
- *Hinweis:* `fuel.uncovered`.

**F3: Bewertung des Endbestands zu den jüngsten Lieferungen.**

- *Recherche:* GdW, ista und Immoware24 verlangen Anfangs- und Endbestand, aber keine Bewertungsfolge. mibakus rechnet so.
- *Lösung:* verbreitetste dokumentierte Lösung (mibakus); im Ausweis sichtbar.
- *Hinweis:* Rechenweg „Endbestand zu den Preisen der letzten Lieferungen bewertet“.

**F4: Ablesung nicht am Stichtag bei Geräten ohne Speicher** (3.5).

- *Recherche:* HeizkostenV schweigt; VDI 2077 nicht gelesen; ista beschreibt Stichtagsspeicher.
- *Lösung:* Stichtagswert, sonst gemeinsames Ablesedatum, sonst § 9a. Konservativ, weil nur Vergleichbares verglichen wird. **Vor PR 10 VDI 2077 beschaffen und prüfen.**
- *Hinweis:* `heating.reading-dates-differ`.

**F5: Heizperiode gehört in die Gesamtabrechnung, in der sie endet** (3.0).

- *Recherche:* VIII ZR 240/07 lässt die abweichende Periode zu, nennt aber keine Zuordnungsregel. Im Fall lag eine Periode August bis Juli in der Kalenderjahresabrechnung (Einzelheiten ungeprüft).
- *Lösung:* die einzige Regel, bei der beim Abrechnen alle Werte vorliegen.
- *Hinweis:* `period.heating-differs` nennt beide Zeiträume.

**F6: § 6a Abs. 3 Nr. 4, 5** (Durchschnittsnutzer, Witterungsbereinigung).

- *Recherche:* Die Bekanntmachung der Vereinfachungen im Bundesanzeiger ist nicht im Wortlaut gefunden; der DWD veröffentlicht Klimafaktoren.
- *Lösung:* Hausdurchschnitt je m², so benannt; Klimafaktor abgefragt. **Vor PR 14 Bekanntmachung suchen.**
- *Hinweis:* Druckblock nennt die Grundlage.

**F7: Plausibilitätsgrenzen** (α unter 5 % oder über 50 %; Abweichung der CO₂-Kosten vom Preis).

- *Recherche:* keine Quelle.
- *Lösung:* nur Hinweise ohne Rechtsfolge, nie Rechnung.
- *Hinweis:* `heating.dhw-share-implausible`, `co2.cost-implausible` mit „bitte prüfen“.

**Nicht mehr in der Liste**, weil belegt oder hergeleitet:

| Punkt | Jetzt |
|---|---|
| ±1 Tag | entfallen, 3.5 |
| 14 Tage Fortschreibung | entfallen |
| 75 % | entfallen |
| größte Überschneidung | ersetzt durch Leistungsprinzip, 3.4 |
| 1 € Toleranz | hergeleitet, 7.3 |
| Vorgabe Gradtage für Grundkosten | Praxis ista, 5.3 |
| Gradtagstabelle | ista, Berliner Mieterverein |
| Zuordnung Steuerjahr nach größerem Teil | entfallen, 3.10 |

---

## 16. Nicht-Ziele

| Nicht-Ziel | Grund |
|---|---|
| Vereinbarte Verlängerung eines Zeitraums über zwölf Monate | Sie braucht die Zustimmung aller Mieter; der Rumpf leistet dasselbe ([R] VIII ZR 316/10). |
| Abflussprinzip | Positionen tragen kein Zahlungsdatum (#188). Für Heizung ist es ohnehin unzulässig. |
| Umrechnung von Messdienstwerten auf einen anderen Zeitraum | 3.1 Weg c |
| Verdunster selbst auswerten | |
| Vorerfassung (§ 5 Abs. 7) | |
| Rohrwärme | |
| Umbauter Raum als Maßstab | |
| Gemeinschaftsräume mit hohem Verbrauch | |
| Mischanlagen nach anderen Regeln der Technik als gemessener Gesamtwärme | |
| ARGE/bved-Datenaustausch, Import von Funkdaten | |
| Automatische Umstellung abgeschlossener Jahre auf eine Anlage | |
| Freier CO₂-Prozentsatz | zulasten des Mieters unwirksam, § 6 Abs. 1 CO2KostAufG, übernommen |
| Rückfall, der kg oder € aus kWh vorrechnet | Standardwerte nur für die Plausibilität |
| Spanne für die Schätzung des Betriebsstroms | ohne Quelle |
| Rechtsberatung zur Eignung der Geräte (§ 5 Abs. 1 S. 2) und zu Bewertungsfaktoren | |
| Rechtswerte über das Netz | 4.5 |

---

## 17. Quellen

Gelesen am 05.10.2026, wo nicht anders vermerkt. Die übrigen Fundstellen stehen in den Teilentwürfen (CO₂ Abschnitt 2, #99 Abschnitt 2.10, #208 Abschnitt 15) mit ihrem Prüfdatum.

**Gesetze:**

- CO2KostAufG: [§ 5](https://www.gesetze-im-internet.de/co2kostaufg/__5.html), [§ 5a](https://www.gesetze-im-internet.de/co2kostaufg/__5a.html), [§ 11](https://www.gesetze-im-internet.de/co2kostaufg/__11.html)
- HeizkostenV: [§ 9b](https://www.gesetze-im-internet.de/heizkostenv/__9b.html)

**Rechtsprechung:**

- BGH 30.04.2008, VIII ZR 240/07: [rewis.io](https://rewis.io/urteile/urteil/x4d-29-04-2008-viii-zr-24007/), [iww](https://www.iww.de/mk/archiv/betriebskosten-zeitraeume-fuer-verbrauchserfassung-und-gesamtabrechnung-nicht-deckungsgleich-f17259)
- BGH 20.02.2008, VIII ZR 49/07: [Berliner Mieterverein](https://www.berliner-mieterverein.de/recht/mieturteile/bgh/bgh0810.htm), [iww](https://www.iww.de/mk/archiv/betriebskostenabrechnung-abflussprinzip-ist-zulaessig-f17292)
- BGH 01.02.2012, VIII ZR 156/11: [rewis.io](https://rewis.io/urteile/urteil/s1c-01-02-2012-viii-zr-15611/), [Minol](https://www.minol.de/abrechnung-nach-dem-abflussprinzip-fuer-heizkosten-unzulaessig.html), [IKZ](https://www.ikz.de/detail/news/detail/unterschiedliche-abrechnungszeitraeume-fuer-brennstoffkosten-und-heizkosten-sind-unzulaessig/)
- BGH 27.07.2011, VIII ZR 316/10: [Berliner Mieterverein](https://www.berliner-mieterverein.de/recht/mieturteile/bgh/bgh1135.htm), [Haufe](https://www.haufe.de/immobilien/verwaltung/bgh-erlaubt-verlaengerten-abrechnungszeitraum_258_82420.html)
- BGH 12.01.2022, VIII ZR 151/20: [Berliner Mieterverein](https://www.berliner-mieterverein.de/recht/bgh/heiz-und-warmwasserkostenabrechnung.htm)
- BGH 14.11.2007, VIII ZR 19/07: [Berliner Mieterverein, Info 73](https://www.berliner-mieterverein.de/recht/infoblaetter/info-73-heizkostenabrechnung-worauf-achten-beim-mieterwechsel-zwischenablesung-und-gradtagszahlentabelle.htm)
- BGH 17.11.2010, VIII ZR 112/10: [LTO](https://www.lto.de/recht/nachrichten/n/bgh-auch-nicht-geeichte-wasserzaehler-koennen-betriebskosten-fuer-mieter-begruenden), [Berliner Mieterverein](https://www.berliner-mieterverein.de/recht/bgh/bgh1069.htm)

**Praxis der Messdienste:**

- [ista: Gradtagszahlentabelle](https://www.ista.com/de/kontakt-service/fachwissen/gradtagszahlentabelle/)
- [ista: Zwischenablesung](https://www.ista.com/de/kontakt-service/vermieter-oder-verwalter/zwischenablesung/)
- [ista: Mess- und Eichverordnung](https://www.ista.com/de/gesetze-und-verordnungen/mess-und-eichverordnung/)
- [ista: Nutzerinformation sensonic 3](https://ista.com/fileadmin/media_ista/germany_de/Dokumente/Technik/Nutzerinformation_sensonic_3.pdf)
- [Berliner Mieterverein, Info 73](https://www.berliner-mieterverein.de/recht/infoblaetter/info-73-heizkostenabrechnung-worauf-achten-beim-mieterwechsel-zwischenablesung-und-gradtagszahlentabelle.htm) (ARGE 400/800 ‰)
- [delta-t: Zwischenablesung](https://delta-t.de/info-center/zwischenablesung/)
- [Haufe: Kostenverteilung bei Nutzerwechsel](https://www.haufe.de/id/beitrag/heizkostenabrechnung-weg-3-kostenverteilung-bei-nutzerwechsel-HI636698.html)
- [Brunata: Auftrag Änderung Abrechnungszeitraum](https://www.brunata-metrona.de/downloads/allgemein/m/BRUNATA_Aenderung_Abrechnungszeitraum_Auftrag.pdf) (nur Titel gesehen, Inhalt **ungeprüft**)

**Software:** [objego: Gradtagszahlen](https://www.objego.de/blog/gradtagszahlen-nebenkostenabrechnung/); Immoware24, immocloud, mibakus und NebenkostenFix laut Marktvergleich vom 04.10.2026.

**Nicht gelesen:** VDI 2077, VDI 2067, DIN 4713 Teil 5, DIN EN 834, DIN EN 1434. Sie sind kostenpflichtig und vor PR 10 und PR 12 zu beschaffen (0.2).
