# Spezifikation: Heizung gesamt (Meilenstein 0.11.0)

- **Fassung:** sechste Fassung vom 05.10.2026, nach der Nachprüfung der fünften Fassung. Die Änderungen stehen je Befund in 0.9 bis 0.5.
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
| **geprüft 05.10.** | Am 05.10.2026 an der Quelle gelesen, für diesen Entwurf oder in einer der drei Gegenprüfungen. Bei Urteilen genügen Leitsatz und Kernaussage aus einer Sekundärquelle, die mit Link angegeben ist. |
| **übernommen** | Steht so in einem Teilentwurf, der es mit Datum geprüft hat (CO₂: 04.10.2026, Heizkostenabrechnung: 04.10.2026). |
| **sekundär** | Nur über einen Kommentar, eine Zusammenfassung oder ein Merkblatt gelesen, nicht im Volltext. Bei Instanzgerichten ist der Volltext vor der PR zu lesen, die die Regel umsetzt. |
| **ungeprüft** | Nicht an einer Primärquelle bestätigt. Vor dem Merge der jeweiligen PR nachzuholen; die Durchsicht prüft es. |

**Kostenpflichtige Normen, nicht gelesen:**

- **VDI 2077** (Verbrauchskostenabrechnung für die Technische Gebäudeausrüstung);
- **DIN 94680:2024-05** („Verfahren zur Abrechnungs- und Verbrauchsinformation über Heiz- und Warmwasserkosten“, NA 041-03-04 AA, laut [DIN Media](https://www.dinmedia.de/en/standard/din-94680/377238518)). Nach Minol wird die Gradtagstabelle heute dort angewandt ([Minol, Gradtagzahlen](https://www.minol.de/blog/gradtagzahlen-in-der-heizkostenabrechnung/)); laut Inhaltsangabe enthält die Norm auch Vergleichswerte für den Durchschnittsnutzer.

Ob die beiden Normen beschafft werden, entscheidet der Nutzer. **Bis dahin stützen sich die Regeln, die an ihnen hängen, auf die dokumentierte Praxis der Messdienste [M]** und tragen im Text die Marke **⟨Norm offen: VDI 2077⟩** bzw. **⟨Norm offen: DIN 94680⟩**. Eine solche Regel wird nach dem Lesen der Norm bestätigt oder geändert; die Tabelle in 15.3 nennt alle Stellen und die PR, vor deren Merge die Norm vorliegen soll. Weitere technische Regeln, die nur über Sekundärquellen eingehen: VDI 2067 Blatt 1 (1983, Herkunft der Gradtagstabelle), DIN 4713 Teil 5, DVGW G 685 (Standardlastprofile Gas), DIN EN 834, DIN EN 1434.

### 0.3 Was nicht belegt ist, steht an einer Stelle

Mietfuchs-eigene Festlegungen ohne Quelle stehen **gesammelt in Abschnitt 15.2**, jede mit Rechercheweg, gewählter Lösung (die konservativste oder die verbreitetste) und dem Hinweis, den der Vermieter sieht. Offene Rechtsfragen, bei denen es Quellen gibt, die aber nichts entscheiden, stehen in 15.1. Regeln, die an einer ungelesenen Norm hängen, stehen in 15.3.

In der zweiten Fassung ist die Liste in 15.2 auf **sechs** Punkte geschrumpft. Belegt sind jetzt die Zuordnung der Heizperiode (Sachverhalt von VIII ZR 240/07), die Bewertung des Endbestands (Minol) und die Ablesung neben dem Stichtag (OLG Schleswig, AG Nordhorn, LG Osnabrück). Diese Festlegungen der ersten Fassung sind ganz entfallen:

| Entfallene Festlegung | Ersetzt durch | Abschnitt |
|---|---|---|
| „±1 Tag gilt als Stichtag, bis 14 Tage wird fortgeschrieben“ | abgelesene Werte gelten, wie sie sind (OLG Schleswig, LG Osnabrück; [M] ista, Brunata) | 3.5 |
| „Verschiedene Ablesedaten → § 9a“ | dasselbe; § 9a nur bei Ausfall (BGH VIII ZR 373/04) | 3.5 |
| Grenze von 75 % bei der Hochrechnung | Umrechnung nach § 5 Abs. 1 S. 5 CO2KostAufG nur für E | 3.3 |
| Zuordnung einer Jahresrechnung zum Zeitraum mit der größten Überschneidung | Leistungsprinzip mit zeitanteiliger Aufteilung, nur für kalte Kosten | 3.4 |
| Toleranz der Summenprobe von 1 € | exakter Vergleich gegen die gedruckte Kostensumme S | 7.3 |

### 0.4 Rechtsaussagen aus den Teilentwürfen

Für die erste Fassung am 05.10.2026 im Wortlaut gelesen: CO2KostAufG §§ 5, 5a Abs. 1, 7 Abs. 1 und 3, 11 sowie HeizkostenV §§ 9, 9b. Die drei Gegenprüfungen haben am selben Tag zusätzlich gelesen:

- im Wortlaut: HeizkostenV §§ 1–12, CO2KostAufG §§ 2–9, 5a–5d, 11 samt Anlage, BGB §§ 556, 556a, 556c, 560, BetrKV § 2, MessEV Anlage 7 und §§ 34, 35, WärmeLV, GasGVV § 12;
- über Leitsatz und Randnummern: BGH VIII ZR 240/07, 49/07, 156/11, 316/10, 151/20, 19/07, 112/10, 159/05, 212/05, 180/12, 373/04, 294/10, V ZR 166/15, VIII ZR 46/25 und 47/25.

Was sie dabei gefunden haben, steht in 0.5.

### 0.5 Änderungen gegenüber der ersten Fassung

Drei Gegenprüfungen vom 05.10.2026:

- **R** = Recht und Quellen (30 Befunde);
- **G** = Geld, Logik, Datenmodell (25 Befunde und Nachrechnungen);
- **Z** = Zeiträume und Praxis (11 Befunde).

Jeder Befund ist entschieden. Eine Ablehnung nennt ihre Quelle.

| ID | Befund | Entscheidung | Abschnitt |
|---|---|---|---|
| R-A1 | Fernablesbarkeit: Für Geräte, die nach dem 01.12.2021 eingebaut wurden, gelten die 3 % schon heute | **Übernommen.** Zwei Zweige nach Einbaudatum (§ 5 Abs. 2, 3, § 12 Abs. 1 S. 2 HeizkostenV), dazu `installed_on` am Zähler und die Angabe an der Anlage für den Messdienst. Ohne Datum heißt es „bis zu 3 %“. | 3.13, 4.3, 5.3, 6.5 |
| R-A2 | Wärmelieferung steht in § 7 Abs. 3, nicht in Abs. 4 | Übernommen, Zitat berichtigt | 8.5, 13 |
| R-A3 | VIII ZR 240/07 setzt einheitliche Vorauszahlungen voraus | **Übernommen.** Frage an der Anlage nach getrennter Heizkostenvorauszahlung; dann wird Weg b nicht angeboten | 3.1, 5.3, 11.2 |
| R-A4 | Eine Abrechnung nur mit Heizkosten für ein Jahr ohne Mietzeit ist nicht belegt | **Übernommen.** Offene Rechtsfrage 15.1 Nr. 2; für diese Abrechnung wird die frühere Frist empfohlen | 3.1, 3.8, 15.1 |
| R-A5 | CO₂-Abzug je Mieter nach dem Schlüssel des Brennstoffs (§ 7 Abs. 1 S. 2 CO2KostAufG) | **Übernommen**, Wortlaut gelesen. x_t ist der Anteil an den Brennstoffpositionen; der Topf ist nur noch Rückfall mit Hinweis | 9.4 |
| R-A6 | Die 15 % nach VIII ZR 151/20 beziehen sich auf den ganzen Anteil an Heiz- und Warmwasserkosten | Übernommen | 6.5, 7.7 |
| R-A7 | § 6 Abs. 4: Wechsel des Maßstabs nur für künftige Zeiträume | **Übernommen.** Vorgabe ist der bisherige Anteil; eine Änderung ergibt einen Hinweis und gilt erst ab dem nächsten H | 8.5, 11.2 |
| R-A8 | § 5a Abs. 3 Nr. 2 (CO₂) ohne „angefallen“ im Wortlaut; Abs. 4 verkürzt | **Übernommen.** Anteilige Teilung als Auslegung in 15.1; Abs. 4 vollständig | 3.9, 4.3, 15.1 |
| R-A9 | § 5b falsch datiert | Übernommen: Daten von § 5a, dazu Neubau bis 31.12.2029 und Antrag ab 13.05.2026 | 4.3, 4.6, 5.3 |
| R-A10 | § 5d Abs. 3: im selbst bewohnten Zweifamilienhaus keine Teilung | **Übernommen**, wird in PR 18 gerechnet | 4.3, 13 |
| R-A11 | ETS-Preis nach dem Jahr vor der Rechnung | Übernommen | 4.3 |
| R-A12 | Wärmepumpe: Verordnung erst ab dem Zeitraum nach der Installation | Übernommen | 4.3 |
| R-A13 | Heizwerte laut Rechnung haben Vorrang, Tabelle nur hilfsweise und nur bei Kesseln; zwei Hackschnitzelwerte | Übernommen | 4.3, 5.4, 8.3 |
| R-A14 | Verschiedene Ablesedaten führen nicht zu § 9a (OLG Schleswig, AG Nordhorn) | **Übernommen**, zusammen mit Z-B1 | 3.5, 8.7 |
| R-A15 | § 9b Abs. 3 deckt eine versäumte Zwischenablesung nicht | **Übernommen**, zusammen mit Z-B2 | 3.5, 15.1 |
| R-A16 | Leerstand als Nutzer nicht mit VIII ZR 159/05 begründen | Übernommen: § 9b Abs. 1 und [M] Brunata | 3.5 |
| R-A17 | § 6a: jede fehlende Angabe ergibt 3 %, ebenso die fehlende monatliche Information; PR 22 ist nicht entbehrlich | **Übernommen** | 8.8, 13 |
| R-A18 | Rumpf nur aus sachlichem Grund; § 5 Abs. 1 S. 4 sagt „vereinbart“ | Übernommen (mit Z-B7) | 3.6, 3.9, 15.1 |
| R-A19 | Kabelregel: § 2 S. 1 Nr. 15 a, b und S. 2 BetrKV | Übernommen | 4.3 |
| R-A20 | Steuerjahr ist das Jahr der Zahlung | Übernommen (mit Z-B6) | 3.10 |
| R-A21 | `heatedArea` nur für den Topf Heizung | Übernommen | 5.3, 8.5 |
| R-A22 | 25 % heißt „überschreitet“; vier gleiche Wohnungen liegen genau bei 25 % | Übernommen, Text berichtigt | 8.7 |
| R-A23 | V ZR 166/15 ist geprüft, und die Schätzung des Betriebsstroms ist Pflicht | Übernommen: Schätzung nach Anschlusswerten angeboten, Prozentspannen als Literaturwerte | 13 PR 15, 16 |
| R-A24 | „Sachgerechte Schätzung“ ist VIII ZR 156/11 Rn. 14; Weg c ist nach VIII ZR 240/07 unzumutbar | Übernommen | 3.1, 3.2, 15.2 |
| R-A25 | Gradtagstabelle: Herkunft VDI 2067 Bl. 1 (1983), heute DIN 94680 | Übernommen; DIN 94680 steht in den Normen | 0.2, 3.5, 15.3 |
| R-A26 | Bewertung des Endbestands belegt durch Minol | Übernommen: F3 aus 15.2 gestrichen; VIII ZR 298/80 ungeprüft | 8.2 |
| R-A27 | MessEV Anlage 7 geprüft, Übergangsdatum nicht | Übernommen; § 35 Stichprobe als Hinweis | 3.12, 4.3 |
| R-A28 | Fernwärme nicht „fossil“ nennen | Übernommen | 5.3, 9.1 |
| R-A29 | § 9 CO2KostAufG nur mit Nachweis | Übernommen | 9.2, 10.1 |
| R-A30 | VIII ZR 19/07: keine Aussage zu Formularklauseln | Übernommen, Text unverändert | 3.5 |
| G-A1 | Ein Zeitraumwechsel lässt Schlüssel schrumpfen; Jahreskorrektur und Ganzjahresposition landen im Rumpf | **Übernommen.** Die Vorschau führt auch schrumpfende Schlüssel; eine Jahreskorrektur eines schrumpfenden Zeitraums sperrt den Wechsel (409) | 3.6, 12.2 |
| G-A2 | Heizpositionen verwaisen bei eigener Heizperiode | **Übernommen.** Umschlüsseln mit Vorschau; die Schreibprüfung lehnt einen Schlüssel ohne Heizperiode ab (400) | 3.0, 5.3, 12.2 |
| G-A3 | C wird bei Messdienst und `manual` abgegrenzt, die Mieter haben aber die ganze Lieferung bezahlt | **Übernommen.** C folgt dem, was im Topf berechnet ist; abgegrenzt wird nur E | 3.3, 7.6, 9.4 |
| G-A4 | `fuelCarry` ist nicht eingefroren und wird zweimal oder gar nicht gebucht | **Übernommen.** Übertrag frieren, Lieferung sperren, Anteil einer abgeschlossenen Periode beim Vermieter | 8.2 |
| G-A5 | Golden F06 bleibt nicht wortgleich | **Übernommen.** F06 ändert in PR 6 einen Hinweis, keine Zahl, und das ist begründet | 1.2, 12.1 |
| G-B1 | Gemessenes Q gegen Hᵢ | **Abgelehnt.** § 9 Abs. 2 S. 6 gilt nach dem Wortlaut nur für „die nach den Zahlenwertgleichungen in Satz 2 oder 4 bestimmte Wärmemenge“, und § 9 Abs. 3 letzter Satz: „Soweit die Abrechnung über Kilowattstunden-Werte erfolgt, ist eine Umrechnung in Brennstoffverbrauch nicht erforderlich“ (geprüft 05.10.). Offene Frage 15.1 Nr. 9 mit Hinweis, ⟨Norm offen: VDI 2077⟩ | 8.3, 15.1 |
| G-B2 | L_self anteilig zu kürzen widerspricht #203 | **Übernommen.** L_self ist exakt, nur `co2Share` läuft über `take()`. W10 der ersten Fassung ist aufgehoben | 7.4 |
| G-B3 | Toleranz der Probe zu eng hergeleitet, S unklar | **Übernommen.** S ist die gedruckte Kostensumme, Betrag = S + L exakt ± 1 ct; Toleranz nur für die Einzelbeträge | 5.5, 7.3 |
| G-B4 | PR 8 ohne PR 10; Umfang von `fuel.stock-missing` | **Übernommen.** Der Fehler nur bei `self`; CO₂-Bestand bis PR 10 nur bei `selfAfterService` | 8.2, 13 |
| G-B5 | r_t nach Topf statt Brennstoff | Übernommen (mit R-A5) | 9.4 |
| G-B6 | Nettozeile bis 2 ct neben dem exakten Wert | Übernommen für die Zusage (je Zeile ≤ 1 ct, Nettosumme ≤ 2 ct). Für die Kürzungen bleibt die Grundlage die gedruckte Zeile, weil § 7 Abs. 4 CO2KostAufG den Anteil „gemäß der Heizkostenabrechnung“ nennt | 6.2, 6.5 |
| G-B7 | `uploads` und `detected_year` sind Kalenderjahre | Übernommen: nur `requested_year` wird `requested_period`, nur mit Objekt | 5.2 |
| G-B8 | Ein Warmwasserzähler zählt als Wohnungszähler beim Kaltwasser | Übernommen | 5.3 |
| G-B9 | Grundlage der 15 % beim Messdienst | Übernommen (mit R-A6) | 6.5, 7.7 |
| G-B10 | `co2Refund` mindert das Ist doppelt | Übernommen: Steuer liest nur die Zahlungen | 6.4 |
| G-C1 | Automatisches Aufteilen nicht für Heizpositionen | Übernommen | 3.4 |
| G-C2 | Fernablesbarkeit beim Messdienst | Übernommen: Angabe an der Anlage | 5.3 |
| G-C3 | Prüfbedingung lässt Monat 00 und 13 zu | Übernommen | 5.2 |
| G-C4 | Lieferung mit mehreren Positionen (Abschläge, Gutschrift) | Übernommen: `cost_items.fuel_delivery_id` (viele zu eins) | 5.4 |
| G-C5 | Steuer und die Zeilen ohne Position | Übernommen: Eigenanteil je Position aus Betrag × Gewicht, ohne Übertrag | 6.4 |
| G-C6 | Alte Tabs; Alias liefert still den Rumpf | Übernommen: Alias nur bei reinem Kalenderobjekt; `Settlement.deadline` | 5.2 |
| G-C7 | Release-Sperre für `unchecked` blockiert durch spätere PRs | Übernommen: Parameter kommen mit der PR, die sie nutzt | 4.7 |
| G-C8 | Wächter trifft Umsatzsteuer und `custom` | Übernommen: Umsatzsteuersatz ins Register, erlaubte Stellen benannt | 4.3, 4.7 |
| G-C9 | `legacy/read.ts` muss `period` erzeugen | Übernommen | 5.9 |
| G-C10 | Abschluss mit Lücke, später kommt die Rechnung | Übernommen: Regel aus G-A4 | 8.2 |
| G-D2 | C1/C2 exakt 1.331,52995/750,75005; F12-Spanne; Öl-kg 6.690,75; Beispiel C; Schlüssel F18 | Übernommen, Werte berichtigt | 3.5, 8.2, 8.6, 7.4, 12.1 |
| G-F | Stichtagstest am 31.12.2022 unmöglich | Übernommen: `2022-12` gegen `2023-01` | 4.7 |
| G-H | Invarianten 2, 6, 7, 9 zu weit | Übernommen, eingeschränkt | 12.3 |
| Z-B1 | Verschiedene Ablesedaten: Werte wie abgelesen verwenden | **Übernommen**; keine Rückrechnung (LG Osnabrück) | 3.5 |
| Z-B2 | Versäumte gegenüber unmöglicher Zwischenablesung | **Übernommen**: Frage am Wechsel; bei Versäumnis Warnung mit bis zu 15 % | 3.5, 6.5 |
| Z-B3 | Toleranz der Zwischenablesung nach ista und Brunata | **Übernommen**: Monatsendwert und Ablesung nahe am Wechsel gelten | 3.5 |
| Z-B4 | § 12 Abs. 2 GasGVV und Teilmengen laut Rechnung | **Übernommen**: neue Stufe 2b; Gradtage begründet mit GasGVV, DWD-Ortswerte optional | 3.2, 15.2 |
| Z-B5 | Vorschlag nach § 560 im Rumpf nach Gradtagen | Übernommen (VIII ZR 294/10) | 3.7 |
| Z-B6 | § 11 EStG als Vereinfachung benennen | Übernommen | 3.10 |
| Z-B7 | § 5 Abs. 1 S. 4 „vereinbart“ | Übernommen: offene Frage, Rechnung wie die Messdienste | 3.9, 15.1 |
| Z-B8 | Gradtage an § 9b Abs. 2 verankern; Tageswerte sind Festlegung | Übernommen: `hkv.degree-days`; Tageswerte in 15.3 | 3.5, 4.3 |
| Z-B9 | Minol teilt nicht belegt „genau so“ | Übernommen: gestrichen | 3.5 |
| Z-B10 | HKV sind nicht eichpflichtig; Übergangsrecht offen | Übernommen | 3.12, 5.3 |
| Z-B11 | Wasserrechnung über zwei Zeiträume: Zählerstand genauer | Übernommen als Hinweis | 3.4 |

### 0.6 Änderungen gegenüber der zweiten Fassung

Grundlage sind zwei Prüfungen vom 05.10.2026: **N** (Nachprüfung der Umsetzung) und **D** (frischer Blick: F = falsch, R = riskant, L = Lücke, H = Hinweis). Jeder Punkt ist entschieden; eine Ablehnung nennt ihre Quelle.

| ID | Befund | Entscheidung | Abschnitt |
|---|---|---|---|
| N1 | Der Teil einer Versorgerrechnung außerhalb von H gehört nach H−1, nicht nach H+1. Wer vor der Folgerechnung abschließt, verliert jedes Jahr rund 15 % der Gaskosten. | **Übernommen und gelöst.** Die Richtung ist berichtigt. Recherche: [M] ProCalor und Minol empfehlen Zählerstand zum Stichtag und Zwischenrechnung, [M] BMGEV beschreibt Zählerstände zu Beginn und Ende. Rechtlich sind möglich die sachgerechte Schätzung ([R] VIII ZR 156/11 Rn. 14) und die vorbehaltene Nachberechnung ([G] § 556 Abs. 3 S. 3 BGB, [R] VIII ZR 264/12). **Regel:** Ablesung zum Stichtag und Zwischenrechnung zuerst; sonst eine geschätzte Lieferung mit Vorbehalt, eingefroren beim Abschluss. Die spätere echte Rechnung gibt ihren tatsächlichen Teil heraus, die Differenz steht beim Vermieter (`fuelEstimateDiff`), mit Hinweis auf die Nachberechnung. Der Vermieter verliert nur noch den Schätzfehler. Testfälle a–d. | 3.2, 8.2, 12.2, 15.1 Nr. 19 |
| N2 | Die Zusage „Nettosumme ≤ 2 ct“ gilt nur bei einer Heizzeile | Übernommen: < (k + 1) ct; den Satz zum Kürzungsbetrag gestrichen | 6.2, 6.5, 12.3 |
| N3 | Gradtage in PR 3, Parameter erst in PR 7 | Übernommen: `hkv.degree-days` kommt mit PR 3 | 4.3, 13, 15.3 |
| N4 | Sperre der Jahreskorrektur: Reihenfolge, zu breit, neuer Zeitraum ohne Korrektur, Test zu schwach | Übernommen: Korrekturen werden in der Vorschau neu erfasst und mit dem Wechsel in einer Transaktion gespeichert; nur bei Mietverhältnissen mit Monaten außerhalb des Rumpfs; Test mit 2.200 € ≠ Soll | 3.6, 12.2 |
| N5 | Text zur 25-%-Schwelle | Übernommen, mit tatsächlichem Anteil im Dialog | 8.7 |
| N6 | Eine Zeitregel je Parameter reicht nicht; Zuordnung zu PR 1 oder PR 4 unklar | **Übernommen, ohne den Typ zu ändern:** die Fälle sind auf zwei Parameter verteilt (`hkv.remote-reading.retrofit` in PR 1, `.new-devices` in PR 4; `hkv.heat-pump.capture`) | 3.13, 4.3, 13 |
| N7 | `amountsRest` wird nicht negativ, wenn nur L fehlt | Übernommen, Text berichtigt | 7.4 |
| N8 | Eigenanteil in Abrechnung und Steuer laufen beim Vorrat auseinander | Übernommen: Abrechnung mit Übertrag, Steuer nach Bezahltem, Erklärung auf der Steuerseite, Test | 8.2 |
| N9 | 6.3 zitiert VIII ZR 159/05; Stufe „eingetragen“ als letzte; „2b“; `manual` mit Vorrat | Übernommen: Begründung über § 9b; eingetragen ist Stufe 0; Nummerierung; `manual` bekommt die Bestandsrechnung (D-R2) | 3.2, 3.5, 6.3, 8.2 |
| N zu 15.1 Nr. 9 | Dasselbe Gas: kWh nach Brennwert 15,0 %, m³ mit Heizwert 16,65 % | Übernommen in 15.1 Nr. 9; Lexikon nennt beide Lesarten gleichwertig (auch D-H3); amtliche Begründung 2008/2009 vor PR 10 lesen | 15.1 |
| N Teilbefunde R-A1, R-A16, R-A22, G-A1, G-C7, G-H, Z-B5 | teilweise erledigt | durch N6, N9, N5, N4, N3, N2 und D-R5 erledigt | – |
| D-F1 | Wärmepumpe mit Formel: falscher Nenner | Übernommen: Formelwert geteilt durch die abgerechnete Energie des Erzeugers, bei der Wärmepumpe der Strom ([G] § 9 Abs. 2 S. 6 Nr. 3); 37,5 % statt 12,5 % | 8.3, 12.2 |
| D-F2 | Eigentumswohnung ohne Anlage hat keinen CO₂-Datensatz | Übernommen: Anlage `source = 'homeowners'`, `method = 'service'` ([G] § 1 Abs. 2 Nr. 3 HeizkostenV) | 5.3, 8.9, 11.2, 14.1 |
| D-F3 | Netto-Erfassung bei der Eigentumswohnung widerspricht #209 | Übernommen: brutto, `serviceDeducted` | 8.9 |
| D-F4 | § 5d nennt drei Verordnungen | Übernommen (§ 556d Abs. 2, § 558 Abs. 3, § 577a Abs. 2 BGB) | 3.9, 4.3, 5.3 |
| D-F5 | § 12 Abs. 3: Installation der Erfassung, nicht der Wärmepumpe | Übernommen, Parameter und Tests neu | 3.13, 4.3, 4.7, 5.3 |
| D-R1 | Feste Preisbestandteile nicht nach Gradtagen | Übernommen: `fixed_cents` nach Tagen ([G] § 12 Abs. 2 GasGVV betrifft nur verbrauchsabhängige Preise); 1.600,00 € statt 1.242,58 € | 3.2, 5.4 |
| D-R2 | `manual` mit Vorrat ohne Bestandsrechnung | Übernommen: Bestandsrechnung und `fuelCarry` auch bei `manual` ([G] § 7 Abs. 2 HeizkostenV, [R] VIII ZR 156/11); ohne Bestand weiter wie heute mit Warnung | 6.1, 8.2, 13 PR 8 |
| D-R3 | Getrennte Heizkostenvorauszahlung ohne Weg | Übernommen: **Weg d**, getrennte Heizkostenabrechnung je H mit eigener Vorauszahlungsstaffel und Frist ([G] § 556 Abs. 3 BGB; VIII ZR 240/07 Leitsatz a e contrario) | 3.1, 3.7, 5.3, 13 PR 5 |
| D-R4 | `manual`: Mieterwechsel und Leerstand nur nach Tagen | Übernommen: `change_split` auch bei `manual`, Vorgabe Gradtage ([G] § 9b Abs. 2, [M] ista); Hinweis bei `time` | 5.3, 6.1 |
| D-R5 | § 560 skaliert Fixkosten nach Gradtagen | Übernommen: nur Brennstoff nach Gradtagen; ohne Kennzeichnung kein Vorschlag für den Heizanteil; 262 € und 133 € | 3.7, 12.2 |
| D-R6 | S ist für Laien nur beim Techem-Muster beschrieben | Übernommen: Muster je Messdienst vor PR 6, Rückfall „Zeile nicht gefunden“ mit hint | 7.3 |
| D-L1 | Gewerbe im Wohngebäude | Übernommen ([G] § 6 Abs. 1 CO2KostAufG) | 9.2, 15.1 Nr. 1 |
| D-L2 | Peildatum des Tanks | Übernommen: `closing_measured_on` | 5.3, 8.2 |
| D-L3 | Frist bei Abrechnung nur mit Heizkosten | Übernommen: Hinweis nennt den Termin für die Anforderung beim Messdienst | 3.1 |
| D-L4 | § 12 Abs. 3 S. 3 ist Pflicht | Übernommen: Aufgabe in der Einrichtung | 5.3, 11.2 |
| D-L5 | Einliegerwohnung zeitweise selbst genutzt | Nur Lexikonsatz zu `mayAgreeOtherwise` (§ 2 hängt an Tatsachen, 8.9) | 10.3 |
| D-H1 | Leerstand weiter mit VIII ZR 159/05 begründet | Übernommen (wie N9) | 3.5, 6.3 |
| D-H2 | § 5d Abs. 4 auf Abs. 3 ist Auslegung | Übernommen: 15.1 Nr. 20 | 3.9, 15.1 |
| D-H3 | Lexikon soll beide Lesarten zu Q gleichwertig nennen | Übernommen | 15.1 Nr. 9 |
| D-H4 | CO₂-Preis 2026 ist kein Festpreis | **Abgelehnt in der Sache, Text präzisiert:** § 4 Abs. 1 Nr. 2 CO2KostAufG setzt für 2026 den „Mittelwert des Preiskorridors“ an, also 60 €/t (Wortlaut durch Gegenprüfung R gelesen); der Text sagt jetzt „Mittelwert des Korridors 55–65“ | 4.3 |
| D-H5 | § 7 Abs. 1 S. 2: Frage für Laien unbeantwortbar | Übernommen: Frage nach Baujahr vor 1995 und Sanierung | 11.2 |
| D-H6 | Altbestand hebt die Stufe | Übernommen: der Ausweis sagt es | 8.2 |
| D-H7 | Laienprobe vor PR 7 | Übernommen | 11.2 |
| D-H8 | Aufwand | neu: 67–76 Arbeitstage | 13 |

**Folgen für PR 1 (läuft parallel):**

- Der Typ `LawParam` mit **einer** Zeitregel je Parameter bleibt (N6 über geteilte Parameter gelöst).
- PR 1 trägt die Fernablesung als `hkv.remote-reading.retrofit` (overlap ab 01.01.2027, ersetzt die Bestandsregel `heating-remote-reading` ohne Text- oder Zahlenänderung) und `hkv.cut.remote-reading` (3 %) ein.
- `hkv.degree-days` gehört **nicht** in PR 1, sondern in PR 3. `hkv.remote-reading.new-devices` gehört in PR 4.
- Der Parameter für die Wärmepumpe heißt `hkv.heat-pump.capture` (PR 10).
- Der CO₂-Preis 2026 wird als Mittelwert des Korridors beschrieben (PR 17).

### 0.7 Änderungen gegenüber der dritten Fassung

Grundlage ist die Nachprüfung der dritten Fassung vom 05.10.2026 (Befunde A1–A11). Jeder Befund ist entschieden.

| ID | Befund | Entscheidung | Abschnitt |
|---|---|---|---|
| A1 | Der § 560-Vorschlag kann in PR 3 nie nach Gradtagen rechnen, weil das Brennstoffmerkmal erst mit PR 10 kommt | **Weg (a):** Ein schmales Merkmal `cost_items.heating_part` (nullbar, nur Kostenart Heizung, Oberfläche zunächst nur „Brennstoff/Energie“) kommt mit **PR 3**; PR 10 macht es bei `heatingSystem` zur Pflicht. So hilft der Vorschlag schon beim häufigsten Fall, dem Winter-Rumpf beim Umstieg auf Mai–April. | 3.7, 5.1, 5.3, 13 |
| A2 | `change_split` bei `manual` verschiebt offene Zahlen und teilt Warmwasser nach Gradtagen | Übernommen. Bei `manual` wirkt `change_split` nur auf Positionen „nur Heizung“ (ab PR 10). Kombinierte Positionen gehen nach Tagen, weil [G] § 9b Abs. 2 Warmwasser nur zeitanteilig teilt. Das Anlegen einer Anlage ändert damit keine Zahl; die Zusage in 11.2 stimmt wieder. | 5.3, 6.1, 12.2 |
| A3 | Weg d: Auslegung, Modell unvollständig, H = P, § 560, 11.2 | Übernommen. Weg d steht als Auslegung in 15.1 Nr. 21, mit Zustimmungsvorbehalt. Gefragt wird nach getrennter **Abrechnung**, deshalb `separate_settlement` statt `separate_prepayment`. Ins Modell kommen `heating_prepayments`, `heating_prepayment_overrides` und **eigene Tabellen `closed_heating_settlements`** samt Verlauf; `closed_settlements` aus PR 2 bleibt unverändert. H = P: eine Gesamtabrechnung mit getrennt ausgewiesenen Vorauszahlungen. § 560-Vorschlag für die Heizvorauszahlung; `Statement.scope`. 11.2 Schritt 3 ist angeglichen. | 3.1, 3.7, 5.1, 5.7, 11.2, 13, 15.1 |
| A4 | N1 rechtlich nachschärfen | Übernommen. Vor Fristablauf ist eine Berichtigung frei möglich ([R] VIII ZR 115/04 vom 17.11.2004, Umkehrschluss). Danach nur bei nicht zu vertretender Verspätung (VIII ZR 264/12) und binnen drei Monaten ([R] VIII ZR 220/05). Eine negative Differenz ist eine Gutschrift an die Mieter und wird als warning gemeldet. Regel für das Wiederöffnen. Testfälle e und f; alle Fälle mit `fixed_cents = null`. | 8.2, 10.1, 12.2, 15.1 Nr. 19 |
| A5 | Die Schätzung widerspricht „nie hochgerechnet“ | Übernommen als begründete Ausnahme: nur als ausdrücklich geschätzte Lieferung mit Vorbehalt (VIII ZR 156/11 Rn. 14). Sie zählt zur Abdeckung von E, und der Ausweis nennt sie. | W4, 3.3, 15.1 Nr. 10 |
| A6 | R2 nicht überall nachgezogen; `manual` mit Gas | Übernommen. Abgegrenzt wird bei `self` und bei `manual` mit verknüpfter Lieferung oder Bestand. **`manual` mit Gas bekommt `fuelCarry`, wenn die Rechnung als Lieferung verknüpft ist**: Es ist dieselbe Rechtsgrundlage (VIII ZR 156/11) und dieselbe Mechanik. Ohne Verknüpfung bleibt die Warnung. C bei `manual` mit Bestand richtet sich nach dem Verbrauch. | W2, 3.2, 3.3, 6.1, 14.1 |
| A7 | k und `fuelCarry`; Invariante 2; `fuelEstimateDiff` in 6.2; Test N2; Invariante 1 | Übernommen in allen fünf Punkten | 6.2, 12.2, 12.3 |
| A8 | F1 schwach belegt; Wärmepumpe mit Warmwasserzähler ohne Gesamtwärmezähler | Übernommen: BT-Drs. 20/7619 als Beleg, die Spannung zu § 9 Abs. 1 S. 2 benannt. Für den fehlenden Fall gibt es den Fehler `heating.heat-pump-dhw-basis`. | 4.3, 8.3, 10.1, 12.2 |
| A9 | 15 % ohne Erfassung nach dem 30.09.2025 ist Auslegung | Übernommen: 15.1 Nr. 22, Vermerk an Parameter und Test | 4.3, 4.7, 15.1 |
| A10 | Restwidersprüche | Alle fünf berichtigt: 14.1 Bruttowarmmiete; 3.6 Summenaussage; Sperre für Ablesungen in abgeschlossener H; Lage der Frist in Fall a; Frage zu § 7 Abs. 1 S. 2 | 3.6, 5.4, 8.2, 11.2, 14.1 |
| A11 | Jahresrechnungen im Rumpf werden hochgerechnet | Übernommen. Feste Heizpositionen mit Leistungszeitraum ab zwölf Monaten gehen als Jahresbetrag ein; ohne Leistungszeitraum gilt die letzte volle Periode. Neue Beispiele: 228 €, 262 € (Wartung nur Januar–April), 100 €. | 3.7, 12.1, 12.2 |
| R1 (Rest) | Stufe 0 gegenüber `fixed_cents` | Der eingetragene Anteil gilt nur für den verbrauchsabhängigen Teil; feste Teile immer nach Tagen | 3.2 |

**Folgen für PR 1 und PR 2:** keine. Das Register (Abschnitt 4, PR 1) und das Schema des Zeitraums (5.2, PR 2) bleiben, wie sie sind. Für Weg d kommen eigene Tabellen dazu, statt `closed_settlements` umzubauen. Neu in Abschnitt 4.3 sind nur Texte und Vermerke an Parametern späterer PRs (`hkv.dhw.factors` PR 11, `hkv.heat-pump.capture` PR 10).

**Folgen für Phase A:**

- **PR 3:** Merkmal `heating_part` und neue Regel für Jahresrechnungen; 5,5–6,5 T.
- **PR 4:** `change_split` bei `manual` ohne Wirkung auf kombinierte Positionen.
- **PR 5:** Weg d mit eigenen Tabellen und § 560-Vorschlag; 6–7 T.

### 0.8 Änderungen gegenüber der vierten Fassung

Grundlage ist die Nachprüfung der vierten Fassung vom 05.10.2026 (Befunde B1–B9 und Kleineres).

| ID | Befund | Entscheidung | Abschnitt |
|---|---|---|---|
| B1 | Bisherige Vorauszahlung beim Umstellen auf Weg d aufteilen | Übernommen. Die Vorschau fragt je Mietverhältnis ab einem Monat den Heizanteil ab; vorbelegt ist der Kostenanteil der letzten Abrechnung. Beide Staffeln werden in einer Transaktion geschrieben, die Summe je Monat bleibt gleich. Ohne Antwort 409. Test 300 € → 123 € / 177 €. | 3.1, 12.2, 13 PR 5 |
| B2 | Heiz-Jahreskorrektur beim Rhythmuswechsel | Übernommen: Neuerfassung in der Vorschau wie N4 | 3.6, 12.2 |
| B3 | Eigener Rechen- und Fristweg für Weg d | Übernommen: Schritt 7 in 6.1 mit eigener Route und eigenem Abschluss; P lässt Heizpositionen und Heizvorauszahlungen weg und friert die Heizkostenabrechnung nicht ein. Neue Zeile in 3.8 (30.04.2027). Nachzug in 3.10, 3.11 und Invariante 11. | 3.1, 3.8, 3.10, 3.11, 6.1, 12.2–12.4 |
| B4 | § 560-Vorschlag behandelt eine Vorratslieferung wie Verbrauch | Übernommen: Nach Gradtagen geht nur Brennstoff **mit Leistungszeitraum** (Verbrauchsrechnung). Lieferungen ohne Leistungszeitraum gehen nach der letzten vollen Periode, sonst ohne Vorschlag (VIII ZR 294/10). **Das ändert PR 3** an einer Stelle: die Bedingung für den Gradtagszweig. | 3.7, 12.2, 13 PR 3 |
| B5 | Test R4 widerspricht A2 | Übernommen: nur für eine Position „nur Heizung“; eine kombinierte Position bleibt bei Tagen | 12.2 |
| B6 | „C nur bei `self` abgegrenzt“ in 6.1 Nr. 4.2 und 3.M | Übernommen | 3.M, 6.1 |
| B7 | Bedingung an `heating_target` schließt `manual` aus | Übernommen: Pflicht bei `heatingSystem`, sonst nullbar und bei `manual` wählbar; `heating.change-split-time` kommt mit PR 10 | 5.1, 5.3, 10.1 |
| B8 | x_t bei `manual` kennt `heating_part` nicht | Übernommen: Brennstoff = verknüpfte Lieferung **oder** `heating_part = 'fuel'`; Näherung nur ohne beides; Test 232,14 € | 9.4, 12.2 |
| B9 | Hinweistexte: Zugang; Gutschrift statt Rückzahlungsanspruch | Übernommen. „muss den Mietern bis {Frist} zugehen“; bei zu hoher Schätzung „Gutschrift jederzeit zulässig und empfohlen“ (§ 556 Abs. 3 S. 5, 6 BGB) | 8.2, 15.1 Nr. 19 |
| Kleineres | VIII ZR 115/04 vom 17.11.2004, „vor Fristablauf“ als Umkehrschluss; `fuelEstimateDiff` in 6.4; Aufwand Phase A | Übernommen; Phase A 23–27,5 T, mit PR 5 jetzt 6,5–7,5 T | 0.7, 6.4, 8.2, 13 |

**Folgen für PR 1–4:**

- PR 1, PR 2 und PR 4 bleiben unverändert.
- **PR 3 ändert sich nur durch B4:** Der Gradtagszweig des § 560-Vorschlags gilt nur für Brennstoffpositionen mit Leistungszeitraum.
- `heating_target` (B7) betrifft PR 10, nicht PR 4.

### 0.9 Änderungen gegenüber der fünften Fassung

Grundlage ist die Nachprüfung der fünften Fassung vom 05.10.2026 (C1–C5, R1–R13).

| ID | Befund | Entscheidung | Abschnitt |
|---|---|---|---|
| C1 | Spätere Staffelstufen werden beim Aufteilen nicht geteilt | Übernommen: Die Vorschau teilt jede Stufe ab X; Test 300/330 € | 3.1, 12.2 |
| C2 | Jahreskorrektur eines offenen P enthält nach dem Aufteilen den Heizanteil | Übernommen: Neuerfassung in der Vorschau, „davon übrige / davon Heizung“; Satz in 3.7; Test 3.300 € | 3.1, 3.7, 12.2 |
| C3 | X in einem abgeschlossenen P | Übernommen: X frühestens nach dem letzten Abschluss (409); H rechnet nur Heizvorauszahlungen ab X an und nennt die frühere Anrechnung; Test 984 € | 3.1, 3.M, 12.2, 12.3 |
| C4 | Ein- und Ausschalten von Weg d; widersprüchlicher Hinweis | Übernommen: jedes Umschalten über dieselbe Vorschau; Regel „Wer die Heizkosten abrechnet, rechnet auch `heating_prepayments` an“ (6.1 Nr. 5); `period.heating-separate-prepayment` gestrichen, neu `prepayment.heating-share-missing` (R13) | 3.1, 6.1, 10.1, 12.2 |
| C5 | Brennstoff mit langem Leistungszeitraum im Rumpf überhöht | Übernommen: Gradtagsanteil des eigenen Leistungszeitraums, ab zwölf Monaten Jahresbetrag (VIII ZR 294/10); Test 200,00 € statt 377,36 €. **Ändert PR 3** an dieser einen Stelle. | 3.7, 12.2, 13 |
| R1 | Testdaten A1, Z-B5 ohne Leistungszeitraum | Übernommen: Leistungszeitraum = Rumpf | 3.7, 12.2 |
| R2 | Frist im Test R3 doppeldeutig | Übernommen: 30.04.2027 | 12.2 |
| R3 | 232,14 € hängt an B und C | Übernommen: B 30 %, C 20 %, L 464,27 €; A 232,14 € | 12.2 |
| R4–R9 | 3.M, 8.2, Invariante 4, 3.10 (zwei Stellen), 11.2 | Übernommen | 3.M, 3.10, 8.2, 11.2, 12.3 |
| R10, R11 | Hinweistext bei Lieferung; kein Vorschlag für den ganzen Heizanteil | Übernommen | 3.7, 10.1 |
| R12 | Formatierung 12.4 | Übernommen | 12.4 |
| R13 | H = P mit leerer Heizstaffel | Übernommen als hint mit Angebot der Vorschau | 3.1, 10.1 |

**Folgen für PR 1–4:**

- PR 1, PR 2 und PR 4 bleiben unverändert.
- **PR 3 ändert sich durch C5** (Gradtagsanteil des eigenen Leistungszeitraums, ab zwölf Monaten Jahresbetrag), durch R11 (kein Vorschlag für den Heizanteil, wenn eine Brennstoffposition keinen hat) und durch R10 (zweiter Hinweistext).

---

## 1. Die Entscheidungen auf einen Blick

### 1.1 Widersprüche zwischen den Teilentwürfen

| # | Widerspruch | Entscheidung | Begründung, Quelle | Abschnitt |
|---|---|---|---|---|
| W1 | **Eigener Heizzeitraum:** #99 sagt nein, #217 sagt ja. | **Ja, in 0.11.0.** Eine Heizanlage kann einen eigenen Zeitraum haben, etwa Juli bis Juni oder Mai bis April, neben dem Zeitraum des Objekts für die übrigen Kosten. Jede Heizperiode gehört in die Gesamtabrechnung des Objektzeitraums, **in dem sie endet**. Die Frist richtet sich nach dem Zeitraum der Gesamtabrechnung. Mieter, die nur in der Heizperiode gewohnt haben, bekommen eine Abrechnung, die nur aus den Heizkosten besteht. | [R] BGH 30.04.2008, VIII ZR 240/07: Die Gesamtabrechnung ist formell wirksam, wenn über die Heizkosten **nicht getrennt** abzurechnen ist (einheitliche Vorauszahlung); die Frist beginnt mit dem Ende des Kalenderjahres der Gesamtabrechnung (geprüft 05.10.). Zweite Fassung: Weg b nur bei einheitlicher Vorauszahlung; eine Abrechnung nur mit Heizkosten für ein Jahr ohne Mietzeit ist offen (15.1 Nr. 2). | 3.0, 3.1 |
| W2 | **Abgrenzung einer Brennstoffrechnung über den Zeitraumwechsel:** tagesgenau (CO₂-Entwurf, Fall F7) gegen Gradtage (#99). | **Ein Verfahren** für den verbrauchsabhängigen Teil, kg CO₂ und CO₂-Kosten: eingetragen, Zählerstand, Zwischenrechnung, Teilmengen laut Rechnung, Gradtage (Ortswerte oder Tabelle), Schätzung mit Vorbehalt; feste Preisbestandteile nach Tagen. Tagesgenau für den Verbrauch gibt es nicht. Kosten und C werden abgegrenzt bei `self` und bei **`manual` mit verknüpfter Lieferung oder Bestand** (A6); beim Messdienst gilt, was im Topf berechnet ist. | [R] VIII ZR 156/11 (Rn. 14: sachgerechte Schätzung). [G] § 5 Abs. 1 S. 5 CO2KostAufG. [G] § 12 Abs. 2 GasGVV analog. [M] Minol. | 3.2, 3.3, 8.2 |
| W3 | **Kennung des Zeitraums:** `202505` in der vorhandenen Spalte `year` (#208) gegen eine eigene Kennung. | **Eigene Kennung** `period` als Text `JJJJ-MM`, der Monat des Beginns. Die Spalte `year` wird per Datenanweisung umgezogen (`2025` → `'2025-01'`). Die Zeiträume werden **berechnet** (Rhythmus und Wechsel am Objekt, wie #208) und nicht als Zeilen gespeichert. | Der Zahlenschlüssel macht aus jedem `year - 1` und jedem `year >= 2023` einen stillen Fehler. Mit einem eigenen Typ zeigt der Übersetzer jede Stelle. Steuer und Mietkonto bleiben beim Kalenderjahr als Zahl, also zwei Typen für zwei Bedeutungen. | 3.0, 5.2 |
| W4 | **Hochrechnung bei Lücken** (CO₂ v3: hochrechnen, Abschlussprüfung: Grenze 75 %) | **Umgerechnet wird nur der Ausstoß E**, für die Einstufung. **C und Brennstoffkosten werden nicht hochgerechnet, außer als ausdrücklich geschätzte Lieferung mit Vorbehalt** (8.2, A5). Eine geschätzte Lieferung zählt zur Abdeckung; der Ausweis nennt sie. | Eine Grenze von 75 % ist nirgends belegt; eine Schätzung ist nach VIII ZR 156/11 Rn. 14 nur als sachgerechte, ausgewiesene Schätzung zulässig. | 3.3, 8.2, 15.1 |
| W5 | **Bestand und Lieferungen:** `co2_deliveries` (CO₂-Entwurf) gegen `cost_item_fuel` (#99). | **Eine Tabelle `fuel_deliveries` an der Heizanlage.** Kostenpositionen können auf eine Lieferung zeigen (`cost_items.fuel_delivery_id`, auch mehrere: Abschläge, Gutschrift; G-C4), oder sie steht für sich (beim Messdienst steckt der Brennstoff in dessen Beträgen, die Gasrechnung liefert nur kg und €). Den Bestand führt `heating_periods`, und zwar einmal. | Sonst stünde die Gasrechnung im Fall F3 doppelt als Kosten, einmal selbst und einmal in den Messdienstbeträgen. | 5.4 |
| W6 | **Name der Anlage:** `heating_systems` (#99) gegen `heating_plants` (Abschlussprüfung). | `heating_plants`, `heating_plant_units`. | Die Abschlussprüfung hat das so festgelegt. | 5.3 |
| W7 | **Wer legt welche Tabelle an, Sperren zwischen den PRs** | Es gibt **eine** Reihenfolge der PRs (Abschnitt 13). Jede Tabelle legt genau eine PR an. Funktionen, die erst eine spätere PR rechnet, lehnt der Server bis dahin mit 400 und einem Satz ab. | Keine Migration wird nach einem Rebase neu erzeugt, und keine Zahl ist zwischendurch falsch. | 13 |
| W8 | **`biomass` (CO₂-Entwurf) gegen `pellets`, `wood` (#99)** | Die Anlage führt `pellets` und `wood` getrennt. CO₂ liest beide als „nicht erfasst“. | Die Heizwerte nach § 9 Abs. 3 HeizkostenV sind verschieden ([G] übernommen). | 5.3 |
| W9 | **Abgleich der Probe** (`co2.sum-check` über alle Positionen, Abschlussprüfung Punkt 1) | Die Probe läuft nur über die **Messdienstpositionen** des Topfs, also die Positionen mit Schlüssel `amounts`. Jede andere Position im Topf ergibt den Hinweis `co2.pool-foreign-item`. | Gutschrift des Versorgers und Wartung sind keine Messdienstbeträge. | 7.3 |
| W10 | **Reihenfolge von `take()`** (Abschlussprüfung Punkt 3) | Zweite Fassung (G-B2): **L_self ist immer exakt** und läuft nicht über `take()`; nur `co2Share` wird durch den Rest begrenzt. Die erste Fassung (beide anteilig kürzen) ist aufgehoben. | #203: Der Eigenanteil ist immer sein exakter Wert, sonst würde Privates abziehbar. | 7.4 |

### 1.2 Was sich insgesamt ergibt

1. **Wer nichts einstellt, merkt nichts.** Ohne Heizanlage, ohne CO₂-Angaben und mit Kalenderjahr bleibt jede Zahl centgenau gleich. Golden F01–F11 bleiben bis PR 5 wortgleich, ebenso die db.json-Fixtures. Ab PR 6 bekommt **F06** (Heizposition 2025 ohne Anlage) den Hinweis `co2.fuel-unknown`; damit ändert sich die Liste `warnings` um einen Text, keine Zahl. Die Änderung steht begründet im README von F06 (G-A5). Der Hinweis wird im CHANGELOG angekündigt.
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
6. **Aufwand:** 23 PRs (0–22, PR 0 erledigt), rund **70–79 Arbeitstage** (Abschnitt 13). Das ist das größte Release bisher. Die Reihenfolge erlaubt es, nach jeder Phase auszuliefern.

---

## 2. Rechtsgrundlagen im Überblick

Den Wortlaut nennen die Abschnitte an der Stelle, an der die Regel steht. Prüfstand nach 0.2.

| Norm | Inhalt, soweit Mietfuchs ihn rechnet | Prüfstand |
|---|---|---|
| [G] § 556 Abs. 3, § 556a, § 556c, § 560 Abs. 4 BGB | jährlich, zwölf Monate, Frist, Ausschluss; Contracting; Anpassung der Vorauszahlung | geprüft 05.10. |
| [G] § 11 Abs. 1, 2 EStG | Zufluss und Abfluss, Zehn-Tage-Regel | geprüft 05.10. |
| [G] HeizkostenV §§ 1–12 | Anwendungsbereich, Erfassung, Fernablesbarkeit, Maßstäbe und ihr Wechsel, Brennstoff nach Verbrauch, § 9 Warmwasser, § 9a, § 9b, § 6a, § 12 | geprüft 05.10. (Fassung Art. 3 G v. 16.10.2023; vom Gesetz vom 23.07.2026 nicht geändert) |
| [G] CO2KostAufG §§ 2–9, 11, Anlage | Anwendungsbereich, Rechnungsangaben, Preis, Einstufung, Rundung, Kürzung der Tabelle, Umrechnung, § 7 Abzug und Ausweis, § 8, § 9 | geprüft 05.10. |
| [G] CO2KostAufG §§ 5a, 5b, 5d (seit 29.07.2026) | hälftige Teilung bei Anlagen nach § 43 Abs. 1 GModG ab 2028/2029, Neubau, Härtefall und Zweifamilienhaus | geprüft 05.10. |
| [G] GasGVV § 12 Abs. 2 | Abgrenzung des Verbrauchs bei Preisänderung nach Erfahrungswerten | geprüft 05.10. (Gegenprüfung Z) |
| [G] BetrKV § 2 S. 1 Nr. 15 a, b und S. 2 | Kabel-TV | geprüft 05.10. |
| [G] MessEV Anlage 7, §§ 34, 35 | Eichfristen sechs Jahre, Ende mit Ablauf des Jahres, Stichprobe | geprüft 05.10.; Übergangsdatum 2021 ungeprüft |
| [G] § 12 Abs. 1 UStG | Regelsatz der Umsatzsteuer (Register, G-C8) | ungeprüft |
| [R] BGH VIII ZR 240/07, 30.04.2008 | abweichende Heizperiode in der Gesamtabrechnung, wenn nicht getrennt abzurechnen ist; Frist ab Ende des Kalenderjahres; Umrechnung unzumutbar | geprüft 05.10. |
| [R] BGH VIII ZR 49/07, 20.02.2008 | Abflussprinzip bei kalten Kosten zulässig | geprüft 05.10. |
| [R] BGH VIII ZR 156/11, 01.02.2012 | Heizkosten nur nach Verbrauch; sachgerechte Schätzung möglich (Rn. 14); § 12 heilt nicht | geprüft 05.10. |
| [R] BGH VIII ZR 316/10, 27.07.2011 | einmalige einvernehmliche Verlängerung | geprüft 05.10. |
| [R] BGH VIII ZR 151/20, 12.01.2022 | 15 % ohne Wärmezähler für Warmwasser, auf den gesamten Anteil | geprüft 05.10. |
| [R] BGH VIII ZR 19/07, 14.11.2007 | Kosten der Zwischenablesung trägt der Vermieter | geprüft 05.10. |
| [R] BGH VIII ZR 112/10, 17.11.2010 | nicht geeichter (Wasser-)Zähler: Beweislast beim Vermieter | geprüft 05.10. |
| [R] BGH VIII ZR 373/04, 16.11.2005 | „zwingender Grund“ nach § 9a erst, wenn der Fehler nicht mehr behebbar ist | sekundär (iww) |
| [R] BGH VIII ZR 294/10, 28.09.2011 | angemessene Vorauszahlung nach der letzten Abrechnung | sekundär |
| [R] BGH VIII ZR 159/05, 212/05, VIII ZR 180/12 | Leerstand trägt der Vermieter; Warmmiete; fiktive Person | geprüft 05.10. |
| [R] BGH V ZR 166/15, 03.06.2016 | Betriebsstrom **muss** nach HeizkostenV verteilt und ohne Zwischenzähler geschätzt werden (WEG) | geprüft 05.10. |
| [R] BGH VIII ZR 46/25, 47/25, 20.05.2026 | § 556c nicht anwendbar nach Einzelöfen des Mieters | geprüft 05.10. |
| [R] BGH VIII ZR 298/80, 23.11.1981 | Bewertung von Heizölvorräten (nach Minol) | ungeprüft |
| [R] OLG Schleswig, RE 04.10.1990, 4 RE-Miet 1/88 | Ablesung neben dem Stichtag unschädlich bei geringem Verbrauch | sekundär (Haufe, mietrecht.org) |
| [R] AG Nordhorn 11.03.2003, 3 C 15/03; LG Osnabrück NZM 2004, 95 | Ablesung im Februar zu spät; keine Rückrechnung nach Gradtagen | sekundär |
| [R] LG Hamburg 18.03.1988, 11 S 202/87; AG Schöneberg 05.10.2005, 104a C 226/05 | versäumte Zwischenablesung: Kürzung bzw. keine Umlage nach Gradtagen | sekundär (Berliner Mieterverein) |

---

## 3. Zeiträume

Dieser Abschnitt klärt jede Facette abweichender Zeiträume rechnerisch und rechtlich. Zuerst kommen das Modell (3.0) und die Matrix (3.M), dann die Einzelheiten je Facette (3.1–3.13).

### 3.0 Das Modell

**Drei Zeitbegriffe, drei Typen:**

| Begriff | Typ | Woher | Wofür |
|---|---|---|---|
| **Abrechnungszeitraum des Objekts** P | `PeriodKey` = `'JJJJ-MM'` (Beginnmonat) | `properties.period_start_month` und `period_changes` | Gesamtabrechnung, Vorauszahlungen, Frist, kalte Kosten |
| **Heizperiode** H einer Anlage | `PeriodKey` derselben Form | `heating_plants.period_start_month` (null bedeutet: wie das Objekt) und `heating_period_changes` | Heizkosten, CO₂, Brennstoff, Ablesungen der Heizung |
| **Kalenderjahr** | `number` | – | Steuer (Anlage V), Mietkonto, Belegjahr |

**Berechnet, nicht gespeichert (aus #208 übernommen):**

- Aus einem Beginnmonat und einer Liste von Wechseln (`JJJJ-MM`) entstehen lückenlose, überschneidungsfreie Zeiträume von höchstens zwölf Monaten.
- Vor jedem Wechsel steht ein **Rumpfzeitraum**. Er endet am Tag vor dem Wechsel.
- Kein Zeitraum beginnt im selben Monat wie ein anderer. Deshalb ist der Beginnmonat eine eindeutige Kennung, auch über Rumpfzeiträume hinweg.
  - Beispiel: Rumpf 01.01.–30.04.2025 = `'2025-01'`, danach `'2025-05'`.
  - Ein Objekt, das schon immer Mai–April abrechnet, hat dagegen `'2024-05'` für 01.05.2024–30.04.2025. Dieselben Daten tragen also je nach Rhythmus verschiedene Schlüssel; F18 und 3.4 nennen beide.
- Die Rechnung steht einmal in `shared/period.ts`: `periodOfKey`, `periodContaining`, `periodsBetween`, `previousPeriod`, `periodLabel` („2025“, „2025/2026“, „01.01.–30.04.2025“) und `settlementDeadline`.

**Zuordnung von H zu P.** Eine Heizperiode gehört in die Gesamtabrechnung des Objektzeitraums, der **ihr Ende enthält** (`periodContaining(objectRules, H.to)`).

- **Beleg:** [R] BGH VIII ZR 240/07 (geprüft 05.10.).
  - Im Fall stand die Heizperiode 01.08.2002–31.07.2003 in der Abrechnung 2003, die Periode ab 01.08.2003 in der Abrechnung 2004.
  - Der BGH betont, die Heizperiode „endete am 31. Juli des Kalenderjahres, für das … die Gesamtabrechnung“ erstellt wurde.
  - Die Regel ist damit belegt und steht nicht mehr in 15.2.
- **Voraussetzung** (Leitsatz a): Über die Heizkosten ist „nicht getrennt von den sonstigen Betriebskosten abzurechnen“, es gibt also einheitliche Vorauszahlungen. Bei getrennter Heizkostenvorauszahlung gilt Weg d (3.1).
- **Häufigkeit:**
  - Bei gleichem Rhythmus ist H = P.
  - Bei zwei Zwölfmonatsrhythmen endet in jedem P genau ein H.
  - Nur ein Wechsel kann zwei H in ein P legen (beide werden abgerechnet) oder keines (`period.no-heating-period`).

**Jede Heizposition trägt den Schlüssel einer Heizperiode ihrer Anlage** (G-A2):

- **Beim Schreiben:** repository.ts lehnt eine Position mit `heating_plant_id` ab, deren `period` keine Heizperiode dieser Anlage bezeichnet (400 mit Satz).
- **Beim Anlegen einer Anlage und bei jedem Rhythmuswechsel einer Anlage** werden die Heizpositionen offener Objektzeiträume auf die H umgeschlüsselt, die in ihrem P endet.
  - Das geschieht in einer Transaktion mit Vorschau.
  - Endet in P keine oder mehr als eine H, ordnet der Vermieter in der Vorschau zu. Ohne Zuordnung wird nicht gespeichert.
- **Beispiel:** Messdienstabrechnung 2025/26 bisher unter Jahr 2026, nach der Migration `'2026-01'`. Die Anlage bekommt Mai als Beginn. Dann wird die Position umgeschlüsselt auf `'2025-05'`, denn diese H endet am 30.04.2026 in P = 2026.
- **Abgeschlossene Zeiträume** werden nie umgeschlüsselt. Ihre Positionen bekommen keine `heating_plant_id` und behalten ihren Schlüssel. Grund: Der eingefrorene Stand bleibt maßgeblich.

### 3.M Die Matrix

Jede Zeile hat unten einen eigenen Unterabschnitt mit Zahlenbeispiel.

| # | Facette | Rechtsgrundlage | Rechenverfahren | Messdienste, Software | Mietfuchs und Hinweis |
|---|---|---|---|---|---|
| 1 | Zeitraum des Messdienstes ≠ Zeitraum des Vermieters | [R] VIII ZR 240/07 (nur bei einheitlicher Vorauszahlung) | H in die Gesamtabrechnung P, die ihr Ende enthält; keine Umrechnung (unzumutbar, ebd.) | [M] jeder Zeitraum; [S] immocloud, Immoware24 | Eigene Heizperiode an der Anlage. `period.heating-differs` (hint) |
| 2 | Versorgerrechnung mit eigenem Zeitraum | [G] § 7 Abs. 2 HeizkostenV; [R] VIII ZR 156/11 (Rn. 14: sachgerechte Schätzung); [G] § 5 Abs. 1 S. 5 CO2KostAufG; [G] § 12 Abs. 2 GasGVV analog | eingetragen; Zählerstand; Zwischenrechnung; Teilmengen laut Rechnung; Gradtage; Schätzung mit Vorbehalt; feste Teile nach Tagen. Kosten und C abgegrenzt bei `self` und `manual` mit verknüpfter Lieferung oder Bestand, E immer | [M] Minol: Zwischenrechnung; Brunata: Abgrenzung ist Sache des Vermieters | `fuel_deliveries`. `fuel.share-by-degree-days`, `fuel.uncovered` |
| 3 | Jahresrechnung bei abweichendem P | [R] VIII ZR 49/07 | Leistungsprinzip, zeitanteilig, nur kalte Kosten | [S] Immoware24 Splitbuchung | Aufteilung beim Speichern; Wasser: Hinweis auf Zählerstand |
| 4 | Mieterwechsel | [G] § 9b HeizkostenV; [R] VIII ZR 19/07; Instanzgerichte zur versäumten Ablesung | Zwischenablesung, auch Monatsendwert oder Ablesung nahe am Wechsel; Grundkosten nach Gradtagen oder Tagen; Abs. 3 nur ohne Ablesung | [M] ista (Monatsendwerte), Brunata (Wechsel- und Ablesedatum getrennt) | Frage „nicht möglich / versäumt“. `heating.interim-reading-off` (hint), `heating.no-interim-reading` (hint bzw. warning) |
| 5 | Ablesung nicht am Stichtag | [R] OLG Schleswig RE 04.10.1990; AG Nordhorn; LG Osnabrück (sekundär); [G] § 9a nur bei Ausfall ([R] VIII ZR 373/04) | Stichtagswert aus dem Speicher, sonst der abgelesene Wert ohne Rückrechnung | [M] ista: Stichtagsspeicher; mehrtägige Ablesung | `heating.reading-dates-differ` (hint, ab einem Monat im Winter warning) |
| 6 | Wechsel des Zeitraums oder des Messdienstes | [G] § 556 Abs. 3 BGB; [R] VIII ZR 316/10; [M] Brunata: nur aus sachlichem Grund | Rumpf ≤ 12 Monate; schrumpfende Schlüssel in der Vorschau | [M] Brunata-Auftrag | `period.short` |
| 7 | Vorauszahlungen | [G] § 556 Abs. 3, § 560 Abs. 4 BGB; [R] VIII ZR 294/10 | Monate von P, bei Weg d der Heizanteil die Monate von H ab X (C3); Vorschlag: kalte Kosten nach Tagen, Heizung nach Gradtagen hochgerechnet | – | `ledgerRows` |
| 8 | Abrechnungsfrist | [G] § 556 Abs. 3 S. 2, 3; [R] VIII ZR 240/07 | zwölf Monate nach Ende von P, bei Weg d nach Ende von H; für Abrechnungen nur mit Heizkosten Empfehlung der früheren Frist | – | `settlementDeadline`, `Statement.recommendedDeadline` |
| 9 | CO₂ und Zeiträume | [G] §§ 5 Abs. 1 S. 4, 5, 5a, 11 Abs. 2 CO2KostAufG | Anwendbar ab Beginn von H; Tabelle gekürzt (Auslegung von „vereinbart“); E umgerechnet, C wie berechnet; § 5a anteilig (Auslegung) | [M] Messdienste rechnen auf H | Hinweise in 10.1 |
| 10 | Steuer | [G] § 11 EStG; Vereinfachung benannt | Jahr der Zahlung je Position, Rechnungsdatum nur Vorbelegung | – | `tax_year`, Hinweis an der Steuerübersicht |
| 11 | Mietkonto | – | unverändert in Kalendermonaten | – | Satz zum Zeitraum der Abrechnung |
| 12 | Zählerwechsel, Eichung | [G] MessEV Anlage 7, §§ 34, 35; [R] VIII ZR 112/10 | Wechsel über Endstand; nicht geeicht → Beweislast | [M] ista; LBME NRW | `meter.calibration-overdue` (nicht für HKV) |
| 13 | Rechtsänderung im Zeitraum | je Parameter (4.3) | Zeitregel je Parameter | – | Register, benutzte Werte |

### 3.1 Facette 1: Zeitraum des Messdienstes ≠ Zeitraum des Vermieters

**Rechtsgrundlage.** [R] BGH 30.04.2008, VIII ZR 240/07 (geprüft 05.10., [iww](https://www.iww.de/mk/quellenmaterial/id/31581), [rewis](https://rewis.io/urteile/urteil/x4d-29-04-2008-viii-zr-24007/)):

- **Leitsatz a:** „Wenn über verbrauchsabhängige Betriebskosten nicht getrennt von den sonstigen Betriebskosten abzurechnen ist“, ist eine Gesamtabrechnung nicht formell unwirksam, weil der Zeitraum einer eingestellten verbrauchsabhängigen Abrechnung abweicht. Im Fall war das die Heizperiode August bis Juli in der Abrechnung des Kalenderjahres.
- **Leitsatz b:** Bei einer auf das Kalenderjahr bezogenen Gesamtabrechnung beginnt die Frist mit dem Ende des Kalenderjahres.
- **Gründe:** Dem Vermieter ist nicht zuzumuten, die Abrechnungen „im Wege einer Schätzung oder mit Hilfe einer zusätzlichen Verbrauchserfassung auf das Kalenderjahr umzurechnen“.
- Für die Heizkosten selbst gilt daneben [R] VIII ZR 156/11: Sie bilden den Verbrauch der **Heizperiode** ab, und das tut die Messdienstabrechnung von sich aus.

**Drei Wege:**

| Weg | Rechtlich | Wann Mietfuchs ihn anbietet |
|---|---|---|
| a) Ganzes Objekt im Zeitraum des Messdienstes | zulässig (§ 556 Abs. 3 BGB); ein Wechsel nur aus sachlichem Grund und, wenn der Mietvertrag den Zeitraum festlegt, nur mit Zustimmung (3.6) | immer |
| b) **Eigene Heizperiode in der Gesamtabrechnung**, übrige Kosten im Objektzeitraum | zulässig ([R] VIII ZR 240/07), **nur bei einheitlicher Vorauszahlung** | wenn `separate_settlement = false` |
| c) Messdienstwerte auf das Kalenderjahr umrechnen | nach VIII ZR 240/07 nicht zumutbar; ohne Ablesungen der Wohnungen auch nicht möglich | nicht angeboten |
| d) **Getrennte Heizkostenabrechnung** je Heizperiode, mit eigener Heizkostenvorauszahlung und eigener Frist | **Auslegung** (15.1 Nr. 21): § 556 Abs. 3 S. 1 BGB verlangt die Abrechnung „über die Vorauszahlungen“; Teilabrechnungen sind erlaubt (§ 556 Abs. 3 S. 4, VIII ZR 240/07 Rn. 17–18); Leitsatz a setzt voraus, dass nicht getrennt abzurechnen ist (Umkehrschluss). Legt der Mietvertrag für die Heizkosten das Kalenderjahr fest, braucht eine Heizperiode Mai–April auch hier die Zustimmung der Mieter (3.6). | wenn `separate_settlement = true` **und H ≠ P** (A3). Gefragt wird, ob die Heizkosten **getrennt abgerechnet** werden, nicht nur, ob getrennt gezahlt wird. |

**Weg d im Modell** (A3):

- Staffel `heating_prepayments(tenancy_id, from, cents ≥ 0)` am Mietverhältnis und Jahreskorrektur `heating_prepayment_overrides(tenancy_id, plant_id, period, cents)` (Schlüssel der Heizperiode).
- Eigene Tabellen `closed_heating_settlements(plant_id, period, …)` und `closed_heating_settlement_history`, eindeutig `(plant_id, period)`. **`closed_settlements` aus PR 2 bleibt unverändert** und eindeutig `(property_id, period)`; so braucht PR 5 keinen Neubau dieser Tabelle.
- `Statement.scope: 'all' \| 'heating'` (5.7). Je H ein Statement `heating` mit den Heizvorauszahlungen der Monate von H, Frist `settlementDeadline(H)`, Vorschlag nach § 560 Abs. 4 für die Heizvorauszahlung aus den Heizkosten von H (3.7). Die Gesamtabrechnung P enthält die Heizkosten dann nicht.
- **H = P mit getrennter Vorauszahlung** (häufiger Formularvertrag mit Kalenderjahr): **eine** Gesamtabrechnung, die beide Vorauszahlungen getrennt ausweist und anrechnet; Weg d gilt nur bei H ≠ P.
- Das Mietkonto führt beide Vorauszahlungen im Soll.
- **Aufteilen der bisherigen Vorauszahlung beim Umstellen auf Weg d** (B1, C1–C3). Bisher steht die ganze Vorauszahlung, Heizung eingeschlossen, in `prepayments`. Die Vorschau arbeitet je Mietverhältnis ab einem Monat X:
  - **X** ist vorbelegt mit dem Beginn der ersten H nach Weg d, **aber nie früher als der erste Monat nach dem letzten abgeschlossenen P** (C3). Einen früheren Monat lehnt der Server ab (409: „Die Vorauszahlungen bis Dezember 2025 sind in der abgeschlossenen Abrechnung 2025 angerechnet. Öffnen Sie sie wieder, wenn Sie früher beginnen wollen.“). Die Heizkostenabrechnung einer H, die vor X beginnt, rechnet nur die Heizvorauszahlungen ab X an und sagt für die Monate davor: „Die Vorauszahlungen Mai bis Dezember 2025 sind in der Abrechnung 2025 angerechnet.“
  - **Jede Stufe der Staffel ab X wird geteilt** (C1): Für jede Stufe Y_i fragt die Vorschau den Heizanteil Z_i ab, vorbelegt mit demselben Anteil (der Anteil der Heizkosten an allen Kosten der letzten Abrechnung, auf volle Euro). In einer Transaktion werden `prepayments` ab X auf Y_i − Z_i und `heating_prepayments` auf Z_i gesetzt. Die Summe je Monat bleibt Y_i.
  - **Jahreskorrekturen** (`prepayment_overrides`) eines offenen P mit Monaten ab X werden in der Vorschau neu erfasst (C2): „davon übrige Vorauszahlungen“ für P und „davon Heizkostenvorauszahlung“ für `heating_prepayment_overrides` der betroffenen H. Bei Weg d enthält die Korrektur von P nur noch die übrigen Vorauszahlungen (3.7).
  - Ohne Antwort wird nicht gespeichert (409). Steht im Mietvertrag eine getrennte Heizvorauszahlung, trägt der Vermieter deren Betrag ein.
- **Ein- und Ausschalten von Weg d** (C4). Weg d ist abgeleitet (`separate_settlement = true` und H ≠ P) und kann sich durch eine andere Antwort oder einen Rhythmuswechsel ändern. **Jedes Ein- und Ausschalten läuft über dieselbe Vorschau.** Beim Ausschalten bietet sie an, beide Staffeln ab dem Wechsel wieder zu `prepayments` zusammenzuführen (Vorgabe). Unabhängig davon gilt in 6.1 Nr. 5: **Wer die Heizkosten abrechnet, rechnet auch `heating_prepayments` an.** Unter Weg b und bei H = P rechnet also die Gesamtabrechnung beide Staffeln an; keine Heizvorauszahlung geht verloren.
- **H = P mit getrennter Vorauszahlung, aber leerer Heizstaffel** (R13): Die Summe stimmt, der getrennte Ausweis zeigt aber 0 €. Hinweis `prepayment.heating-share-missing` (hint) mit dem Angebot der Vorschau zum Aufteilen.
- **Eigener Rechen- und Fristweg** (B3). Weg d rechnet je (Anlage, H) eine eigene Abrechnung: Route `GET /api/heating-settlement/:plant/:period` (Berechnung) und `POST|PUT|DELETE …/close` (Abschluss in `closed_heating_settlements`, Verlauf wie #56). Sie hat ihr eigenes `Settlement.deadline = settlementDeadline(H)`. Die Gesamtabrechnung P lässt die Heizpositionen dieser Anlage und die Heizvorauszahlungen weg, und ihr Abschluss friert die Heizkostenabrechnung **nicht** mit ein; so wird nichts doppelt abgeschlossen. Das Cockpit führt jede Heizkostenabrechnung mit ihrer eigenen Frist.

**Rechenverfahren (Weg b).** Die Anlage hat H = Mai bis April, das Objekt P = Kalenderjahr.

- Die Gesamtabrechnung 2026 enthält H = 01.05.2025–30.04.2026.
- Kalte Kosten, Vorauszahlungen und deren Leerstand rechnen über P. Die Heizpositionen (Einzelbeträge des Messdienstes) gehören zu H.

**Zahlenbeispiel: Mieter mit Auszug.**

- M wohnt bis 31.10.2025 und zahlt 200 € Vorauszahlung im Monat. N wohnt ab 01.11.2025.
- **Abrechnung 2025:** H = 01.05.2024–30.04.2025. Für M: Heizkosten laut Messdienst für H, kalte Kosten 01.01.–31.10.2025, Vorauszahlungen Januar bis Oktober 2025 (2.000 €).
- **Abrechnung 2026:** H = 01.05.2025–30.04.2026.
  - M bekommt eine **Abrechnung nur mit Heizkosten**: seine Messdienstbeträge für 01.05.–31.10.2025, ohne kalte Kosten und ohne Vorauszahlungen.
  - N: Heizkosten ab 01.11.2025 und kalte Kosten 2026.
- Über beide Jahre zahlt M jede Leistung genau einmal, und jede Vorauszahlung wird genau einmal angerechnet.

**Was das Urteil nicht deckt (R-A4).** Im BGH-Fall zog der Mieter am 31.05.2004 aus, im selben Jahr, in dem die letzte Heizperiode endete. Eine Abrechnung für ein Jahr, **in dem der Mieter gar nicht mehr gewohnt hat**, ist nicht entschieden (15.1 Nr. 2). Mietfuchs rechnet sie, damit kein Verbrauch verloren geht, und:

- empfiehlt für diese Abrechnung die Frist zwölf Monate nach Ende des Zeitraums, in dem das Mietverhältnis endete. Im Beispiel ist das der 31.12.2026, und das ist möglich, weil H am 30.04.2026 endet;
- zeigt `period.heating-only-statement` als **warning**: „Ob eine Abrechnung nur der Heizkosten für ein Jahr, in dem {Name} nicht mehr gewohnt hat, die Frist bis 31.12.2027 hat, ist nicht entschieden. Stellen Sie sie bis 31.12.2026 zu. Fordern Sie dafür die Abrechnung des Messdienstes für 2025/2026 bis spätestens Oktober 2026 an.“ (L3)

**Ausdruck:** Der Kopf lautet „Betriebskosten 2026, darin Heiz- und Warmwasserkosten 01.05.2025–30.04.2026“.

**Messdienste und Software:**

- [M] Messdienste rechnen jeden vereinbarten Zeitraum ab.
- [S] immocloud und Immoware24 erlauben freie Zeiträume (Marktvergleich).
- Eine eigene Heizperiode neben dem Kalenderjahr ist bei keinem privaten Programm dokumentiert.

**Hinweise:**

- `period.heating-differs` (hint, färbt nicht);
- `period.heating-only-statement` (warning);
- Der Hinweis `period.heating-separate-prepayment` der vierten Fassung entfällt (C4): Er setzte voraus, dass Weg b trotz getrennter Abrechnung bestehen bleibt, und das schließt die Ableitung in 5.3 aus.

### 3.2 Facette 2: Versorgerrechnung mit eigenem Zeitraum

**Rechtsgrundlage:**

- [G] § 7 Abs. 2 HeizkostenV: Kosten der „verbrauchten Brennstoffe“.
- [R] VIII ZR 156/11 (geprüft 05.10.): kein Abflussprinzip bei Heizkosten. Nach Rn. 14 kann der Vermieter, „gegebenenfalls aufgrund einer **sachgerechten Schätzung**“, eine Abrechnung nach dem Leistungsprinzip vorlegen. Eine Abgrenzung durch Schätzung ist also anerkannt, eine Methode nennt das Urteil nicht.
- [G] § 5 Abs. 1 S. 5 CO2KostAufG: Die „auf den Rechnungen ausgewiesenen Brennstoffemissionen“ sind auf den vereinbarten Zeitraum **umzurechnen**, ohne Methode.
- [G] § 12 Abs. 2 GasGVV (geprüft 05.10. durch Gegenprüfung Z): Ändern sich Preise im Abrechnungszeitraum, wird der Verbrauch „zeitanteilig berechnet; jahreszeitliche Verbrauchsschwankungen sind auf der Grundlage der für Haushaltskunden maßgeblichen Erfahrungswerte angemessen zu berücksichtigen“. Das ist nicht unmittelbar anwendbar, aber das einzige Gesetz, das eine solche Abgrenzung regelt; Mietfuchs folgt ihm analog.

**Wofür die Abgrenzung gilt** (G-A3):

- **Kosten und CO₂-Kosten C** werden abgegrenzt bei `self` und bei **`manual`, wenn die Rechnung als Lieferung verknüpft ist (`fuel_delivery_id`) oder ein Bestand geführt wird** (A6). Dort bucht `fuelCarry` den Teil, der in eine andere Heizperiode gehört, tatsächlich hinaus (8.2). Bei `manual` mit Gas ohne verknüpfte Lieferung bleibt es bei der Warnung `fuel.manual-beyond-period`.
- Bei `service*` gilt für Kosten und C, **was im Topf berechnet ist** (3.3).
- **Der Ausstoß E** wird bei jeder Methode abgegrenzt, denn die Einstufung braucht die Emissionen von H (§ 5 Abs. 1 S. 5).

**Praxis:**

- [M] Minol empfiehlt eine Zwischenabrechnung des Versorgers zum Zählerstand am Stichtag oder gleiche Zeiträume (geprüft 05.10.).
- [M] Brunata: Gas „addiert als Jahresbetrag“, „nur Kosten, die im Abrechnungszeitraum entstanden sind“; die Abgrenzung ist Sache des Vermieters (Ausfüllanleitung 07/2019, sekundär).
- [M] Versorger setzen § 12 Abs. 2 GasGVV mit **örtlichen Gradtagzahlen des DWD** um (Standardlastprofile, [T] DVGW G 685, nicht gelesen), Beispiel [NEW](https://www.new-energie.de/mediathek/mengenaufteilung_innerhalb_eines_abrechnungszeitraums_fuer_gaskunden.pdf).

**Verfahren.** Je Lieferung d und Heizperiode H gilt die erste zutreffende Stufe:

0. **Eingetragen:** `share_permille` des Vermieters geht allen übrigen Stufen vor, und zwar für den **verbrauchsabhängigen** Teil; `fixed_cents` geht immer nach Tagen (Klärung zu R1). Der Ausweis sagt „Anteil vom Vermieter festgelegt“.
1. **Gemessen:** Versorgungszähler der Anlage (Rolle `supply`) mit Ständen an den Grenzen von H und der Rechnung. Anteil = Menge in H ∩ Rechnungszeitraum / Menge der Rechnung. Hat die Rechnung Preisabschnitte, wird je Abschnitt geteilt.
2. **Zwischenrechnung** des Versorgers als eigene Lieferung. Anteil 1 oder 0.
3. **Teilmengen laut Rechnung** (Z-B4): Weist die Rechnung Teilzeiträume mit kWh und € aus, etwa bei Preisänderung, beim Wechsel der Umsatzsteuer oder bei der Preisbremse, werden diese als Unterzeilen erfasst. Jede Teilmenge wird für sich nach Stufe 4 oder 5 geteilt. Diese Mengen hat der Netzbetreiber nach § 12 Abs. 2 GasGVV selbst abgegrenzt.
4. **Gradtage mit Ortswerten**, wenn der Vermieter die tatsächlichen Gradtagzahlen des DWD für seinen Ort und die Monate einträgt. So rechnet der Versorger.
5. **Gradtage nach der Tabelle** `hkv.degree-days` (3.5). Diese Vorgabe kommt ohne Wetterdaten aus. ⟨Norm offen: DIN 94680⟩
6. **Geschätzt mit Vorbehalt**, wenn für einen Teil von H noch keine Rechnung vorliegt (8.2, N1).

Tagesgenau gibt es nicht; es verschöbe Winterverbrauch.

**Feste Preisbestandteile nach Tagen** (R1 der dritten Prüfung). Grund-, Leistungs-, Mess- und Verrechnungspreise hängen an der Zeit, nicht an der Menge. [G] § 12 Abs. 2 GasGVV, die Analogie der Stufen 4 und 5, betrifft nur die „verbrauchsabhängigen Preise“. Deshalb trägt eine Lieferung (und jede Teilmenge) `fixed_cents`; dieser Teil wird tagesgenau abgegrenzt, nur der verbrauchsabhängige Rest nach den Stufen 0–6. Beispiel (Testfall): Fernwärme 15.03.2025–14.03.2026, Grund- und Leistungspreis 2.000 €, H = 2025: zeitanteilig 292/365 = **1.600,00 €**, nach Gradtagen wären es 1.242,58 €. Ohne Angabe von `fixed_cents` geht die ganze Rechnung nach den Stufen, mit dem hint `fuel.fixed-unknown`.

**Dasselbe Verhältnis** gilt bei `self` und `manual` für den verbrauchsabhängigen Teil, kg, CO₂-Kosten, Netzentgelte und Biobrennstoffkosten derselben Rechnung. Die GdW-Arbeitshilfe teilt CO₂-Kosten „passend zu den abgerechneten Brennstoffkosten“ ([Haufe/GdW 7.7.1](https://www.haufe.de/id/beitrag/gdw-aufteilung-der-kohlendioxidkosten-co2kostaufg-in-771-ermittlung-der-im-zugrunde-zu-legenden-abrechnungszeitraum-verbrauchten-brennstoffmenge-HI16464215.html)). CO₂ hängt nur an der Menge, `fixed_cents` trägt kein CO₂.

**Zahlenbeispiel** (nachgerechnet): Gasrechnung 15.03.2025–14.03.2026, Tabelle.

| Ziel | Gradtage (Tabelle) | Tagesgenau (verworfen) |
|---|---|---|
| H = 2025: Überschneidung 15.03.–31.12.2025 | 621,29 ‰ | 800,00 ‰ |
| H = 01.05.2025–30.04.2026: 01.05.2025–14.03.2026 | 848,71 ‰ | 871,23 ‰ |

Mit 6.500 € und H = 2025 sind das 4.038,39 € statt 5.200,00 €.

**Abdeckung:** Decken die Lieferungen H nicht ganz ab, gibt es `fuel.uncovered` (warning): „Für 15.03.–30.04.2026 (47 Tage, 151,3 ‰ der Gradtage) fehlt eine Rechnung. Tragen Sie die Folgerechnung ein oder lesen Sie den Gaszähler zum 30.04.2026 ab.“ Was dann gilt, regelt 3.3.

**Hinweise:**

- `fuel.share-by-degree-days` (hint): Abgrenzung nach Stufe 4 oder 5. Empfohlen werden der Zählerstand oder die Zwischenrechnung, und der Hinweis sagt, dass Versorger mit Ortswerten abgrenzen.
- `fuel.uncovered` (warning).
- `fuel.manual-beyond-period` (warning, nur `manual` ohne verknüpfte Lieferung): Eine Position reicht über H hinaus und wird ganz verteilt ([R] VIII ZR 156/11). Empfohlen wird, die Rechnung als Lieferung zu verknüpfen; dann grenzt Mietfuchs ab.

### 3.3 Lücken in der Abdeckung (zu Facette 2 und 9)

**Rechtsgrundlage:**

- [G] § 5 Abs. 1 S. 5 CO2KostAufG: die ausgewiesenen **Brennstoffemissionen** umrechnen.
- [G] § 7 Abs. 1 S. 1: abzuziehen ist der Vermieteranteil der „angefallenen Kohlendioxidkosten“.
- [R] VIII ZR 156/11: Kosten des **verbrauchten** Brennstoffs.

| Größe | Regel | Grund |
|---|---|---|
| **E** (kg, nur Einstufung) | auf H umgerechnet: E_H = Σ_d E_d · Anteil_d / Abdeckung, mit Anteil nach 3.2 und Abdeckung als Anteil der Gradtage von H, den die Rechnungen überdecken | § 5 Abs. 1 S. 5. Die Umrechnung über eine Lücke hinweg ist **Auslegung** des Wortes „umrechnen“ (15.1 Nr. 10). |
| **C** bei `self` und bei `manual` mit Lieferung oder Bestand | C_H = Σ_d C_d · Anteil_d bzw. nach Verbrauch aus dem Bestand; nicht hochgerechnet, **außer als geschätzte Lieferung mit Vorbehalt** (8.2) | Die Mieter tragen genau diesen Teil der Lieferung. |
| **C** bei `service*` und bei `manual` ohne Lieferung | C_H = Σ_d C_d der Lieferungen, die **im Topf berechnet** sind | Die Mieter haben die ganze Lieferung bezahlt. Bei `selfAfterService` fragt Mietfuchs, welche Lieferungen der Messdienst angesetzt hat (7.6). |
| Brennstoffkosten | nicht hochgerechnet, **außer als ausdrücklich geschätzte Lieferung mit Vorbehalt**, wenn eine Rechnung beim Abschluss fehlt (8.2, A5) | Was nicht in Rechnung steht, ist nicht entstanden; eine sachgerechte Schätzung ist nach VIII ZR 156/11 Rn. 14 nur offen ausgewiesen zulässig. Eine geschätzte Lieferung zählt zur Abdeckung von E; der Ausweis nennt sie. |

**Rechenfehler der ersten Fassung (G-A3), nachgerechnet:** F13-Lage mit C = 600 €, Stufe 40 %, Messdienst hat die Rechnung ganz angesetzt.

- Erste Fassung: 600 · 0,84871 · 40 % = **203,69 €** Entlastung.
- Jetzt: 600 · 40 % = **240,00 €**.
- Den Mietern fehlten 36,31 €. Das Beispiel ist Testfall (12.2).

**Keine Grenze bei der Abdeckung.** `fuel.uncovered` ist eine Warnung und färbt die Ampel. Ein Abschluss mit Lücke fragt zurück. Der Ausweis nennt E „umgerechnet auf 01.05.2025–30.04.2026 (Abdeckung 848,7 ‰)“. Kommt die Rechnung nach dem Abschluss, gilt 8.2 (Übertrag in eine abgeschlossene Periode).

### 3.4 Facette 3: Jahresrechnungen bei abweichendem Zeitraum

**Rechtsgrundlage.** [R] VIII ZR 49/07 (geprüft 05.10.): Die §§ 556 ff. BGB schreiben das Leistungsprinzip nicht vor; das Abflussprinzip ist ebenfalls zulässig. Das gilt für kalte Betriebskosten, nicht für Heizung und Warmwasser ([R] VIII ZR 156/11). Eine Zuordnung nach „größter Überschneidung“ kennt keines der beiden Prinzipien, deshalb entfällt sie.

**Mietfuchs wendet für kalte Kosten das Leistungsprinzip an:**

- Eine Position, deren Leistungszeitraum zwei Objektzeiträume berührt, wird **beim Speichern** in eine Position je Zeitraum zerlegt, tagesgenau, in einer Transaktion.
- Die Restcent verteilt `largestRemainder` mit der Kennung als Entscheid. Der §35a-Lohnanteil wird im selben Verhältnis geteilt, und der Beleg hängt an beiden Positionen. Die Vorschau zeigt beide Beträge.
- Ist ein Zeitraum abgeschlossen, wird abgelehnt (409).
- **Nicht für die Heizkostenart** (G-C1): Heizpositionen ohne Anlage bekommen `period.heating-mismatch` (warning, VIII ZR 156/11). Heizpositionen mit Anlage grenzen über die Lieferungen ab (3.2, 8.2).
- **Verbrauchsabhängige kalte Kosten** (Wasser, Strom mit Hauptzähler; Z-B11): zeitanteilig ist zulässig. Zusätzlich gibt es den hint `period.split-by-days-meter`: „Mit dem Zählerstand zum {Stichtag} wäre die Aufteilung genauer.“
- Ein Abfluss nach Zahlungsdatum wird nicht angeboten, denn Positionen tragen kein Zahlungsdatum (#188).

**Praxis:** [S] Immoware24 ordnet über ein Abgrenzungsdatum zu und teilt per Splitbuchung (übernommen).

**Zahlenbeispiel** (Objekt, das immer Mai–April abrechnet; Grundsteuer 2025, 480,00 €):

| Zeitraum | Rechnung | Betrag |
|---|---|---|
| `'2024-05'` (bis 30.04.2025) | 120/365 · 480 = 157,808 | **157,81 €** |
| `'2025-05'` | 245/365 · 480 = 322,192 | **322,19 €** |

Nach einem Wechsel heißt derselbe Rumpf `'2025-01'` (F18).

**Ohne Leistungszeitraum** fragt das Formular nach dem Zeitraum, vorbelegt mit dem Objektzeitraum des Rechnungsdatums laut Beleg. Bei Kalenderjahr-Rhythmus ändert sich nichts.

**Hinweise:** `period.item-outside` (warning), `period.heating-mismatch` (warning), `period.split-by-days-meter` (hint).

### 3.5 Facetten 4 und 5: Mieterwechsel und Ablesedatum

**Rechtsgrundlage.** [G] § 9b HeizkostenV (geprüft 05.10.):

- **Abs. 1:** Bei Nutzerwechsel „hat der Gebäudeeigentümer eine Ablesung … vorzunehmen“.
- **Abs. 2:** Verbrauchskosten nach der Zwischenablesung, die übrigen Wärmekosten nach den „aus anerkannten Regeln der Technik ergebenden Gradtagszahlen oder zeitanteilig“, die übrigen Warmwasserkosten zeitanteilig.
- **Abs. 3:** Ist die Zwischenablesung „nicht möglich“ oder lässt sie „wegen des Zeitpunktes des Nutzerwechsels aus technischen Gründen keine hinreichend genaue Ermittlung“ zu, werden die gesamten Kosten nach Abs. 2 geteilt.
- **Abs. 4:** Abweichende Vereinbarungen bleiben unberührt.

[R] VIII ZR 19/07: Die Kosten der Zwischenablesung trägt der Vermieter mangels anderweitiger vertraglicher Regelung. Ob eine Formularklausel genügt, sagt der BGH nicht.

**Leerstand ist ein Nutzer.** Für die Zeit des Leerstands ist der Vermieter Nutzer der leeren Räume; sein Eintritt ist ein Nutzerwechsel im Sinne von § 9b Abs. 1, und die Räume bleiben in der Verteilung nach §§ 6, 7 Abs. 1 S. 5, 8 Abs. 1 HeizkostenV. [M] Brunata verlangt die Zeiträume von Leerständen vor und nach dem Wechsel (Ausfüllanleitung, sekundär). VIII ZR 159/05 betrifft kalte Kosten und wird hier nicht als Grundlage zitiert (R-A16, Hinweis 1 der dritten Prüfung).

**Gradtagstabelle** `hkv.degree-days`, verankert in § 9b Abs. 2 („anerkannte Regeln der Technik“):

- Werte nach [M] ista (Fachwissen „Gradtagszahlentabelle“) und Berliner Mieterverein, Info 73 (geprüft 05.10.):

  | Sep | Okt | Nov | Dez | Jan | Feb | Mär | Apr | Mai | Jun–Aug zusammen |
  |---|---|---|---|---|---|---|---|---|---|
  | 30 | 80 | 120 | 160 | 170 | 150 | 130 | 80 | 40 | 40 |

- Juni bis August gelten tagesgenau mit 40/92 je Tag (ista). Für Warmwasser gilt die Tabelle nicht; es wird nach Kalendertagen geteilt (ista, wörtlich).
- **Herkunft:** VDI 2067 Blatt 1 (12/1983), Tabelle 22; heute in DIN 94680 angewandt ([M] Minol, geprüft 05.10. durch Gegenprüfung R). ⟨Norm offen: DIN 94680⟩
- **Tageswerte in den übrigen Monaten** (Monatswert ÷ Tage des Monats, Februar im Schaltjahr 150/29) sind eine Festlegung; ista nennt Tageswerte nur beispielhaft (Oktober 80/31). ⟨Norm offen: DIN 94680⟩, bis dahin 15.3.

**Welche Ablesung gilt am Wechsel** (Z-B3, R-A15, Z-B2). Am Wechsel werden Wärme-, Warmwasserzähler und HKV der Wohnung abgefragt (Mieterwechsel #150). Die erste zutreffende Stufe gilt:

1. **Wert laut Gerät zum Wechseltag.** Das ist der Stichtags- oder Monatsendwert. [M] ista: „Bei Fernablesung werden automatisch die Monatsendwerte des jeweiligen Nutzers verwendet“ ([ista Zwischenablesung](https://www.ista.com/de/kontakt-service/vermieter-oder-verwalter/zwischenablesung/)). Ein Wechsel zum Monatsende hat damit seinen Wert.
2. **Abgelesener Wert neben dem Wechseltag:** Er wird verwendet, wie er ist, ohne Rückrechnung. Die Grenze zwischen den Nutzern liegt dann am Ablesetag, und der Rechenweg nennt das: „Verbrauch 01.–03.10. beim Vormieter (Ablesung am 03.10.)“.
   - [M] Brunata erfasst Wechsel- und Ablesedatum getrennt und rechnet mit dem abgelesenen Wert.
   - Eine Rückrechnung nach Gradtagen ist nach LG Osnabrück, NZM 2004, 95, unzulässig (sekundär über [mietrecht.org](https://www.mietrecht.org/heizkosten/heizkostenabrechnung-stichtag-ablesung/)).
   - Hinweis `heating.interim-reading-off` (hint) mit den Tagen und dem Gradtagsanteil dazwischen.
   - Wie weit daneben noch zulässig ist, regeln weder Verordnung noch Rechtsprechung. ⟨Norm offen: VDI 2077⟩, bis dahin 15.2 F2 und F3: Liegt die Ablesung einen Monat oder mehr neben dem Wechsel und dazwischen ein Monat von Oktober bis April, wird der Hinweis eine **warning**.
3. **Keine Ablesung:** Mietfuchs fragt: „Die Zwischenablesung war **nicht möglich** (Grund)“ oder „wurde **nicht durchgeführt**“.
   - **Nicht möglich:** § 9b Abs. 3. Die gesamten Heizkosten der Wohnung werden nach Gradtagen geteilt (oder nach Tagen bei `change_split = 'time'`), Warmwasser nach Tagen. Hinweis `heating.no-interim-reading` (hint).
   - **Versäumt:** Gerechnet wird ebenfalls nach § 9b Abs. 3, denn eine andere Rechnung gibt es nicht, und so verfährt [M] Brunata bei „nicht plausiblen bzw. unvollständig eingereichten Ablesewerten“. Der Hinweis ist dann eine **warning** mit beziffertem Risiko: „Die Zwischenablesung war Pflicht (§ 9b Abs. 1). Bis zu 15 % der Heizkosten von {Name} ({Betrag}) können gekürzt werden (LG Hamburg, 18.03.1988, 11 S 202/87); nach AG Schöneberg, 05.10.2005, 104a C 226/05, ist die Umlage des Verbrauchsanteils angreifbar.“ (beide sekundär über den Berliner Mieterverein, 15.1 Nr. 5). Der Betrag wird nie automatisch abgezogen; die Kürzung muss der Mieter erklären.

Die Festlegung der ersten Fassung „nur d oder d + 1, sonst § 9b Abs. 3“ entfällt.

**Verdunster.** [M] Die ARGE empfiehlt eine Zwischenablesung nur bei 400–800 ‰ Gradtagen seit der Hauptablesung (Info 73, delta-t). Mietfuchs wertet Verdunster nicht selbst aus (8.1); die Regel wendet der Ablesedienst an.

**Ablesung nicht am Stichtag der Hauptablesung** (Facette 5; R-A14, Z-B1):

1. **Stichtagswert aus dem Gerätespeicher.** Elektronische HKV und Zählermodule speichern den Wert zum Stichtag ([M] ista, Gerätebeschreibungen). Gefragt wird „Stichtagswert laut Anzeige“.
2. **Sonst der abgelesene Wert, wie er ist.** Grundlagen:
   - [R] OLG Schleswig, Rechtsentscheid vom 04.10.1990, 4 RE-Miet 1/88 (DWW 1990, 355; nach mietrecht.org auch WuM 1991, 333, Fundstelle beim Lesen klären): Eine Abweichung zwischen Ablesung und Ende des Zeitraums ist unschädlich, wenn in der Zwischenzeit wenig verbraucht wird.
   - AG Nordhorn, 11.03.2003, 3 C 15/03: eine Ablesung am 20.02. ist bei Jahresende als Stichtag zu spät.
   - LG Osnabrück, NZM 2004, 95: keine Rückrechnung nach Gradtagen.
   - Alle sekundär über [Haufe, Ablesezeitpunkt](https://www.haufe.de/id/beitrag/heizkv-ablesung-und-abrechnungs-und-verbrauchsinformat-3-ablesezeitpunkt-HI14901091.html) und mietrecht.org. Volltexte vor PR 10 lesen.
   - In der Praxis lesen die Messdienste ein Haus über mehrere Tage ab und rechnen mit den abgelesenen Werten.
3. **Hinweis** `heating.reading-dates-differ`:
   - hint, mit größter Abweichung in Tagen und dem Gradtagsanteil dazwischen. Beispiel: Stichtag 31.12., Ablesung 05.01.: 5 · 170/31 = 27,4 ‰.
   - **warning** ab einem Monat Abweichung in den Monaten Oktober bis April. Grundlage ist der Kommentar bei Haufe: „In den Wintermonaten ist eine Abweichung von einem Monat grundsätzlich als nicht zulässig anzusehen.“ Das ist Literatur und keine Rechtsprechung, deshalb steht es in 15.2 F2. ⟨Norm offen: VDI 2077⟩
4. **§ 9a nur bei Ausfall:** Ein Wert fehlt, das Gerät ist defekt, oder der Vermieter markiert den Wert als unbrauchbar. Ein zwingender Grund liegt erst vor, wenn der Vermieter den Fehler nicht mehr beheben kann ([R] BGH 16.11.2005, VIII ZR 373/04, sekundär über iww). Verschiedene Ablesetage sind kein Ausfall.

**Zahlenbeispiel** (aus #99, exakt nachgerechnet): Wohnung C, Wechsel zum 30.09.2025, Zwischenablesung am 30.09.

- Grundkosten Heizung 506,52 €, Gradtage Januar bis September 640 ‰.
- C1 = **1.331,52995 €**, C2 = **750,75005 €** exakt (als Bruch im Test).
- Gegenproben: Grundkosten C1 zeitanteilig 378,85 € statt 324,17 €; ohne Zwischenablesung (§ 9b Abs. 3) trüge C1 1.375,18 €.

**Messdienste:** [M] ista teilt Grundkosten nach Gradtagen und Warmwasser nach Tagen (wörtlich). [M] Brunata nutzt § 9b Abs. 3 bei fehlenden oder unplausiblen Werten. Für Minol ist keine Quelle belegt (Z-B9).

### 3.6 Facette 6: Wechsel des Zeitraums oder des Messdienstes

**Rechtsgrundlage:**

- [G] § 556 Abs. 3 S. 1 BGB: jährlich abrechnen, nach allgemeiner Auffassung höchstens zwölf Monate.
- [R] VIII ZR 316/10 (geprüft 05.10.): Eine **einmalige einvernehmliche** Verlängerung (dort 19 Monate) zur Umstellung ist zulässig.
- [M] Brunata, Auftrag „Änderung Abrechnungszeitraum“ (gelesen durch Gegenprüfung R): „Eine Verkürzung der Abrechnungsperiode kommt lediglich in Ausnahmefällen in Betracht. Hierfür sind sachliche Gründe vorzuweisen, die gem. § 242 BGB … akzeptiert werden müssen.“ Brunata verweist dort auch auf VIII ZR 316/10.
- Legt der Mietvertrag den Zeitraum fest, kann der Vermieter ihn nicht einseitig ändern (übernommen, Mietervereine). Ein BGH-Urteil zum einseitigen Wechsel mit Rumpf war nicht zu finden (15.1 Nr. 12).

**Verfahren:**

- Ein Wechsel erzeugt einen Rumpf bis zum Tag vor dem neuen Beginn. Für die Heizperiode einer Anlage gilt dasselbe, etwa beim Wechsel des Messdienstes.
- Eine Verlängerung über zwölf Monate gibt es nicht.

**Was der Wechsel mit vorhandenen Daten tut** (G-A1). Die Vorschau (`POST …/period/preview`) führt **jede Zeile, deren Schlüssel entfällt oder seinen Umfang ändert**:

| Daten | Behandlung |
|---|---|
| Abgeschlossene Zeiträume | unantastbar (409) |
| Kostenpositionen eines schrumpfenden oder entfallenden Schlüssels | Mit Leistungszeitraum: nach 3.4 aufgeteilt (nur kalte Kosten). Ohne: Der Vermieter ordnet je Gruppe zu. Heizpositionen folgen 3.0. Ohne Zuordnung wird nicht gespeichert. |
| **Jahreskorrektur** (`prepayment_overrides`) eines schrumpfenden Zeitraums | **Wird in der Vorschau neu erfasst**, in derselben Transaktion wie der Wechsel (N4): Für jedes Mietverhältnis mit Korrektur, das Monate von P **außerhalb** des neuen Rumpfs hat, fragt die Vorschau „tatsächlich gezahlt 01–04/2025“ und „tatsächlich gezahlt 05/2025–04/2026“ (für den neuen Zeitraum, falls die Korrektur auf einer Abweichung vom Soll beruhte). Ohne Antwort wird nicht gespeichert (409 mit Satz). Liegt das Mietverhältnis ganz im Rumpf, bleibt seine Korrektur unverändert. Eine tatsächlich gezahlte Summe lässt sich nicht rechnerisch auf Monate verteilen; deshalb fragt Mietfuchs und rechnet nicht. **Dasselbe gilt für `heating_prepayment_overrides`, wenn eine Heizperiode nach Weg d ihren Rhythmus wechselt** (B2); sonst würde eine Jahreskorrektur der Heizvorauszahlung ganz auf den Rumpf angerechnet (G-A1). |
| `heating_periods`, CO₂-Datensätze und Lieferanteile einer Anlage, die dem Objekt folgt | wie Positionen. Ein CO₂-Datensatz eines schrumpfenden H sperrt (409), denn Messdienstwerte gelten für den alten Zeitraum. |
| `assessments.requested_period` | in der Vorschau aufgeführt und neu zugeordnet |

**Rechenfehler der ersten Fassung (G-A1), nachgerechnet:**

- Ausgangslage: Kalenderjahr → Mai ab `2025-05`, Jahreskorrektur 2025 über 2.400 € (200 € im Monat).
- Ohne Sperre würden im Rumpf 2.400 € statt 800 € angerechnet, also 1.600 € zu viel, und Mai bis Dezember in `2025-05` noch einmal.
- Mit der Neuerfassung in der Vorschau (N4) rechnet der Rumpf mit den eingegebenen Beträgen für Januar bis April und `2025-05` mit den eingegebenen für Mai 2025 bis April 2026; kein Monat wird doppelt oder zum Soll angerechnet. Testfall in 12.2.

**Zahlenbeispiel:**

- Wechsel Kalenderjahr → Mai ab `2025-05`. Rumpf `2025-01` = 01.01.–30.04.2025 (120 Tage), Frist 30.04.2026.
- CO₂-Tabelle im Rumpf um 120/365 gekürzt: Grenzen 3,945 · 5,589 · 7,233 · 8,877 · 10,521 · 12,164 · 13,808 · 15,452 · 17,096 kg/m². 5,0 ergibt 10 % für den Vermieter (Vorbehalt „vereinbart“: 3.9).

**Hinweis** `period.short` (hint, färbt nicht): „Rumpfzeitraum wegen der Umstellung. Eine Verkürzung braucht einen sachlichen Grund, etwa die Angleichung an den Messdienst. Legt Ihr Mietvertrag den Zeitraum fest, braucht die Umstellung die Zustimmung der Mieter.“

### 3.7 Facette 7: Vorauszahlungen

**Rechtsgrundlage:**

- [G] § 556 Abs. 3 BGB.
- [R] VIII ZR 240/07: bei einheitlicher Vorauszahlung die Vorauszahlungen der Gesamtabrechnung.
- [G] § 560 Abs. 4 BGB: Anpassung auf eine angemessene Höhe.
- [R] BGH 28.09.2011, VIII ZR 294/10 (sekundär): angemessen sind die voraussichtlich entstehenden Kosten, auf Grundlage der letzten Abrechnung; ein abstrakter Zuschlag ist unzulässig.

**Verfahren:**

- Angerechnet werden die Vorauszahlungen der Monate von P (`ledgerRows`). Die Jahreskorrektur hängt am Schlüssel von P; bei Weg d enthält sie nur die übrigen Vorauszahlungen, die Heizvorauszahlungen haben ihre eigene Korrektur je H (C2).
- **Getrennte Heizkostenvorauszahlung (Weg d, 3.1):** Die Heizkostenabrechnung je H rechnet die Heizvorauszahlungen der Monate von H an, die Gesamtabrechnung P nur die übrigen.
- **Vorschlag nach § 560 Abs. 4**, ein Zwölftel der voraussichtlichen Jahreskosten (Z-B5, R5 der dritten Prüfung):
  - Liegt eine **volle** Heizperiode bzw. ein voller Zeitraum davor, gelten dessen Kosten (VIII ZR 294/10: Grundlage ist die letzte Abrechnung).
  - Sonst, im Rumpf, wird hochgerechnet:
    - **Brennstoff** (Positionen mit `heating_part = 'fuel'`; das Merkmal kommt schmal schon mit PR 3, A1) mit **Leistungszeitraum** (Verbrauchsrechnung): **Betrag / Gradtagsanteil seines eigenen Leistungszeitraums**, also auf zwölf Monate hochgerechnet nach der Jahreszeit, die die Rechnung abdeckt; mit Leistungszeitraum ab zwölf Monaten als **Jahresbetrag** (C5). Beispiel: Gas 01.03.2024–28.02.2025 über 2.400 €, gebucht im Rumpf `2025-01` → 200,00 € je Monat; nach der fünften Fassung (geteilt durch den Gradtagsanteil des Rumpfs) wären es 2.400 / 0,530 / 12 = 377,36 € gewesen, ein überhöhter Vorschlag (VIII ZR 294/10). Ohne Leistungszeitraum ist eine Brennstoffposition eine **Lieferung** (Öl, Flüssiggas, Pellets) und kein Verbrauch; sie geht nach der letzten vollen Periode, sonst ohne Vorschlag (B4).
    - kalte Kosten, die nach 3.4 auf den Rumpf geteilt sind, nach **Tagen**;
    - **feste Heizpositionen** (Wartung, Messdienst, Grundpreis) mit Leistungszeitraum von zwölf Monaten oder mehr gehen als **Jahresbetrag** ein, nicht hochgerechnet; mit kürzerem Leistungszeitraum nach dessen Tagen; ohne Leistungszeitraum gilt die letzte volle Periode, sonst kein Vorschlag für diese Position (A11).
  - **Fehlt für eine Brennstoffposition ein Vorschlag**, gibt es für den ganzen Heizanteil keinen Vorschlag (R11), sonst wäre der Rest ohne Brennstoff zu niedrig. Hinweis `prepayment.no-suggestion` mit zwei Texten: „Kennzeichnen Sie die Brennstoffrechnung …“ bzw. bei einer Lieferung „Aus einer Lieferung lässt sich der Jahresverbrauch nicht ableiten; den Vorschlag gibt es nach der nächsten vollen Abrechnung“ (R10).
  - Eine Abrechnung nur mit Heizkosten **nach Auszug** (`heatingOnly`) ergibt keinen Vorschlag. Die Heizkostenabrechnung nach Weg d (`scope: 'heating'`) ergibt einen Vorschlag für die Heizvorauszahlung (A3).

**Zahlenbeispiele** (Testfälle in 12.2):

| Fall | Rechnung | je Monat |
|---|---|---|
| Winter-Rumpf 01.01.–30.04. (120 Tage, 530 ‰): kalt 400 € (Rumpfanteil), Brennstoff 700 € mit Leistungszeitraum = Rumpf (530 ‰), Wartung 200 € als Jahresrechnung (Leistungszeitraum zwölf Monate) | 400 · 365/120/12 = 101,39; 700 / 0,530 / 12 = 110,06; 200 / 12 = 16,67 | 228,12 → **228 €** |
| derselbe Rumpf, Wartung 200 € ist nur der Anteil Januar–April (Leistungszeitraum 01.01.–30.04.) | Wartung 200 · 365/120/12 = 50,69 | 262,15 → **262 €** |
| Sommer-Rumpf 01.05.–31.08. (123 Tage, 80 ‰): Brennstoff 80 € mit Leistungszeitraum = Rumpf (80 ‰), Wartung 200 € als Jahresrechnung | 80 / 0,080 / 12 = 83,33; 200 / 12 = 16,67 | 100,00 → **100 €** |
| Gas-Jahresrechnung 01.03.2024–28.02.2025 über 2.400 €, gebucht im Rumpf `2025-01` (C5) | Leistungszeitraum zwölf Monate → Jahresbetrag 2.400 / 12 | **200,00 €** (fünfte Fassung: 377,36 €) |
| dasselbe, wenn alles nach Gradtagen ginge (zweite Fassung) bzw. die Jahreswartung nach Tagen (dritte Fassung) | 280 / 0,080 / 12 bzw. 83,33 + 200 · 365/123/12 | 291,67 € bzw. 132,79 € |

**Praxis:** [M] Vorauszahlungen rechnet der Messdienst nur, wenn sie ihm gemeldet wurden (Marktvergleich 2.5).

### 3.8 Facette 8: Abrechnungsfrist

**Rechtsgrundlage:** [G] § 556 Abs. 3 S. 2, 3 BGB; [R] VIII ZR 240/07 Leitsatz b (geprüft 05.10.). Die Frist beginnt mit dem Ende des Zeitraums der Gesamtabrechnung, auch bei abweichender Heizperiode, sofern einheitliche Vorauszahlungen vereinbart sind.

**Verfahren:**

- `settlementDeadline(P)`: letzter Tag des zwölften Monats nach Ende von P. Sie ersetzt die festen `${year + 1}-12-31` in settlementDiff.ts, settlementHistory.ts und Cockpit.tsx.
- Neues Feld `Settlement.deadline`, damit die Oberfläche die Frist nicht selbst rechnet.
- **Abrechnung nur mit Heizkosten** (3.1, R-A4): `Statement.recommendedDeadline` ist zwölf Monate nach Ende des Objektzeitraums, in dem das Mietverhältnis endete. Das Cockpit nennt diese frühere Frist.

| Zeitraum | Frist |
|---|---|
| 2025 | 31.12.2026 |
| `2025-05` | 30.04.2027 |
| Rumpf `2025-01` (bis 30.04.2025) | 30.04.2026 |
| Gesamtabrechnung 2026 mit H = 01.05.2025–30.04.2026 | 31.12.2027 |
| darin Mieter M, ausgezogen 31.10.2025 (nur Heizkosten) | empfohlen 31.12.2026 |
| Weg d: Heizkostenabrechnung H = `2025-05` (01.05.2025–30.04.2026), P = Kalenderjahr | **30.04.2027** (eigene Frist von H, nicht 31.12.2027) |
| 01.03.2023–29.02.2024 | 28.02.2025 |

### 3.9 Facette 9: CO₂ und Zeiträume

Grundlage: §§ 5, 5a, 5b, 5d und 11 CO2KostAufG, im Wortlaut geprüft am 05.10. (§ 5a bis 5d durch Gegenprüfung R).

| Frage | Regel | Quelle |
|---|---|---|
| Anwendbar? | Beginn von H am oder nach 01.01.2023 | [G] § 11 Abs. 2 S. 1 |
| Brennstoff vor 2023 in Rechnung gestellt | kg zählen, € bleiben unberücksichtigt | [G] § 11 Abs. 2 S. 2 (nur „Kohlendioxidkosten“); [M] bved-FAQ: Restbestände „ohne anteilige CO₂-Kosten“ |
| Lieferzeitraum ≠ H | E umrechnen wie 3.2; C wie 3.3 | [G] § 5 Abs. 1 S. 5 |
| H kürzer als ein Jahr | Tabellenwerte anteilig kürzen. Faktor = Tage(H) / Tage der zwölf Monate ab Beginn | [G] § 5 Abs. 1 S. 4: „Ist ein Abrechnungszeitraum von unter einem Jahr **vereinbart**“. Ob ein einseitig gesetzter Rumpf oder ein Rumpf nur der Heizperiode „vereinbart“ ist, ist offen (15.1 Nr. 11). Mietfuchs kürzt wie die Messdienste, die auf ihren Zeitraum rechnen, und der Hinweis nennt das Wort „vereinbart“. |
| Rundung | erste Nachkommastelle, vor der Einstufung | [G] § 5 Abs. 1 S. 3 |
| Mieter- und Eigentümerwechsel | kein kurzer Zeitraum | übernommen (Gegenprüfung A13) |
| Anlage nach § 43 Abs. 1 GModG, ab 2028 | CO₂-Kosten „ab dem 1. Januar 2028“ hälftig (§ 5a Abs. 3 Nr. 2); Netzentgelte, die „im Abrechnungszeitraum ab dem 1. Januar 2028 … angefallen“ sind, „unter entsprechender Anwendung von § 5 Absatz 1 Satz 5“ (Abs. 1 Nr. 1); Biobrennstoff ab 01.01.2029, höchstens 30 % des verbrauchten Brennstoffs (Abs. 1 Nr. 2, Abs. 3 Nr. 3) | [G] § 5a |
| Neubau | § 5a gilt entsprechend in Gebäuden, die bis zum Ablauf des 31.12.2029 neu errichtet und erstmals genutzt werden, außer bei Bauantrag oder Bauanzeige vor dem 13.05.2026 | [G] § 5b |
| Notfalleinbau | Wurde die Anlage nach irreparablem Ausfall weniger als zwölf Monate vor dem 01.01.2028 eingebaut, ruhen Abs. 1–3 zwölf Monate ab Einbau; dazu zwei Fälle mit Bezug auf § 43 Abs. 7 GModG. Wortlaut vollständig in PR 18 übernehmen. | [G] § 5a Abs. 4 |
| Selbst bewohntes Zweifamilienhaus | keine hälftige Teilung, sondern § 5 Abs. 2 (Stufen), außer die Gemeinde steht in einer Rechtsverordnung nach **§ 556d Abs. 2 S. 1, § 558 Abs. 3 S. 3 oder § 577a Abs. 2 S. 2 BGB** (F4 der dritten Prüfung, Wortlaut § 5d Abs. 1 Nr. 1, Abs. 3 S. 2); berücksichtigt nur bei Mitteilung in Textform (Abs. 4; dass Abs. 4 auch für Abs. 3 gilt, ist Auslegung, 15.1 Nr. 20) | [G] § 5d Abs. 3, 4 |

**Zeitregel bei § 5a Abs. 3 Nr. 2 ist Auslegung** (R-A8). Für die CO₂-Kosten einer Heizperiode über den 01.01.2028 sagt Abs. 3 Nr. 2 nur „ab dem 1. Januar 2028“. Mietfuchs teilt anteilig nach Anfall, umgerechnet wie bei den Netzentgelten nach Abs. 1. Das ist die Lesart, die denselben Zeitpunkt für alle Kostenarten der Anlage ansetzt (15.1 Nr. 13).

**Zahlenbeispiel § 5a:**

- H = 01.05.2027–30.04.2028, Stufe 40 %, C = 600 €.
- Gradtage ab 01.01.2028: 530 von 1.000 ‰.
- Vermieteranteil: 0,47 · 600 · 40 % + 0,53 · 600 · 50 % = **271,80 €**.

### 3.10 Facette 10: Steuer (Anlage V)

**Rechtsgrundlage.** [G] § 11 Abs. 2 EStG: Ausgaben im Kalenderjahr, „in dem sie geleistet worden sind“, also nach **Zahlung**. Für regelmäßig wiederkehrende Ausgaben gilt nach S. 2 die Zehn-Tage-Regel.

**Was Mietfuchs tut, und dass es eine Vereinfachung ist** (R-A20, Z-B6):

| Teil | Regel |
|---|---|
| Einnahmen | unverändert, das Ist aus den Zahlungen |
| Werbungskosten | je Position im Feld **„Jahr der Zahlung“** (`tax_year`). Liegt der Zeitraum der Position in einem Kalenderjahr, ist es dieses (Spalte `null`, jeder heutige Bestand). Sonst ist das Feld Pflicht, vorbelegt mit dem Jahr des Rechnungsdatums laut Beleg, und das Formular sagt: „Maßgeblich ist, wann Sie gezahlt haben (§ 11 Abs. 2 EStG).“ |
| Vereinfachung | Eine Messdienstabrechnung ist keine Zahlung. Die Brennstoffkosten darin sind über Abschläge in zwei Kalenderjahren abgeflossen. Die Zuordnung der ganzen Position zu einem Jahr ist deshalb **nicht** § 11, sondern eine Vereinfachung wie im Bestand (CLAUDE.md: „Nicht dem Abflussprinzip folgen die Werbungskosten“). Die Steuerübersicht sagt das bei Heizpositionen mit abweichender Heizperiode. Genau wird es erst mit Zahlungsdaten (#188), dann über Lieferungen und Abschläge. |
| Eigenanteil (`splitForTax`) | aus der Abrechnung des Zeitraums der Position, bei Weg d aus der Heizkostenabrechnung, abgeschlossen aus `closed_heating_settlements` (R8), sonst abgeschlossen aus deren eingefrorenem Stand. Seit G-C5 als Betrag × Gewicht der Eigennutzung je Position, ohne Übertrag (6.4). |
| `prepaymentSettlementCents` | `null`, wenn kein Zeitraum dem Kalenderjahr gleicht, und bei Weg d. Bei H = P mit getrennter Vorauszahlung ist es die Gesamtabrechnung mit beiden Vorauszahlungen (R7). Maßgeblich bleibt das Ist; keine Zahl der Steuer bewegt sich. |
| `fuelCarry`, `co2Relief`, `co2Share` aus 9.4 | außen vor |
| CO₂-Vermieteranteil beim Vorwegabzug | steckt im bezahlten Betrag der Heizposition (7.4) |

### 3.11 Facette 11: Mietkonto

Bleibt nach Kalendermonaten. Bei Weg d führt es beide Vorauszahlungen, `prepayments` und `heating_prepayments`, im Soll. Es ist die Grundlage der Einnahmen in der Steuer, und eine Monatsliste je Zeitraum gäbe dieselben Monate unter zwei Überschriften. Die Seite nennt bei abweichendem P oben: „Die Abrechnung 2025/2026 umfasst Mai 2025 bis April 2026.“ Es gibt keine Rechtsgrundlage, die etwas anderes verlangt.

### 3.12 Facette 12: Zählerwechsel und Eichung im Zeitraum

- **Zählerwechsel:** Bestand (`replacement`, `oldEndValue`, #69, #83). Ein Wechsel ohne Endstand ist für einen Heizungstopf ein fehlender Wert und führt zu § 9a (3.5 Nr. 4).
- **Eichung.** [R] VIII ZR 112/10 (geprüft 05.10.): Nur beim geeichten Zähler wird die Richtigkeit vermutet; beim nicht geeichten muss der Vermieter sie beweisen. Das Urteil betraf einen **Wasserzähler**; für Wärmezähler wird es übertragen, und der Hinweis sagt das.
- **Eichfrist.** [G] MessEV Anlage 7 (geprüft 05.10. durch Gegenprüfung R):
  - Nr. 5.5.1 Kaltwasserzähler, Nr. 5.5.2 Warmwasserzähler und Nr. 7.1 Wärmezähler je **sechs** Jahre.
  - [G] § 34 Abs. 2: Die Frist endet mit Ablauf des Jahres. Das passt zu `calibrated_until` als Jahreszahl.
  - [G] § 35: Die Frist kann im Stichprobenverfahren verlängert werden; dazu gibt es einen Hinweis am Zähler.
  - **Das Datum der Umstellung von fünf auf sechs Jahre (02.11.2021) und das Übergangsrecht für vorher geeichte Zähler sind ungeprüft** (LBME NRW, ista; vor PR 21 im BGBl. lesen). Bis dahin schlägt Mietfuchs keine Frist vor, sondern fragt das Jahr, bis zu dem geeicht ist.
- **Heizkostenverteiler sind keine eichpflichtigen Messgeräte** (Z-B10). Für Zähler vom Typ `hkv` gibt es kein `calibrated_until` (Prüfbedingung) und keinen Hinweis.
- **Hinweis** `meter.calibration-overdue` (warning): Die Werte werden trotzdem verwendet (#91).

### 3.13 Facette 13: Rechtsänderung mitten im Zeitraum

Für jeden Parameter steht im Register seine **Zeitregel**, und zwar die, die das Gesetz anordnet (4.3).

| Zeitregel | Bedeutung | Beispiel mit Beleg |
|---|---|---|
| `periodStart` | gilt die Fassung am Beginn des Zeitraums | [G] § 11 Abs. 2 S. 1 CO2KostAufG: Zeiträume, „die am oder nach dem 1. Januar 2023 beginnen“; [G] § 12 Abs. 3 S. 2 HeizkostenV: bei Wärmepumpen ohne Erfassung am 01.10.2024 ab „dem Abrechnungszeitraum, der nach der Installation [der Erfassung] beginnt“ |
| `incurred` | anteilig nach Anfall, umgerechnet wie Facette 2 | [G] § 5a Abs. 1 (Netzentgelte, Biobrennstoff); für CO₂ nach Abs. 3 Nr. 2 Auslegung (3.9) |
| `overlap` | gilt, sobald der Zeitraum den Geltungsbereich berührt; Hinweis „teilweise“ | [G] § 2 S. 1 Nr. 15 a, b und S. 2 BetrKV (Kabel bis 30.06.2024; Bestand `ruleCoverage`) |
| `eventDate` | Datum eines Ereignisses | Rechnungsdatum (§ 11 Abs. 2 S. 2 CO2KostAufG); Einbaudatum eines Zählers (§ 5 Abs. 2 HeizkostenV) oder einer Anlage (§ 5a); Rechnungsdatum minus ein Jahr beim ETS-Preis (§ 3 Abs. 4 Nr. 4 b); Anzeige (§ 6 Abs. 2) |
| `deliveryYear` | Jahr der Lieferung | CO₂-Preis „zum Zeitpunkt der Lieferung“ ([G] § 3 Abs. 3, § 4 CO2KostAufG) |

**Fernablesbarkeit, berichtigt** (R-A1). [G] § 12 Abs. 1 S. 2 HeizkostenV greift bei einem Verstoß gegen § 5 Abs. 2 **oder** Abs. 3:

| Fall | Regel | Folge |
|---|---|---|
| Gerät **nach dem 01.12.2021** eingebaut, nicht fernablesbar | § 5 Abs. 2 | 3 % ab dem Einbau, außer beim Ersatz oder der Ergänzung eines einzelnen Geräts in einem nicht fernablesbaren Gesamtsystem (Abs. 2 S. 4) |
| Gerät bis 01.12.2021 eingebaut | § 5 Abs. 3 | 3 % für Zeiträume ab 01.01.2027, außer bei technischer Unmöglichkeit oder unbilliger Härte (Abs. 3 S. 2, als Hinweis mit Nachweis) |
| Einbaudatum unbekannt, `remote_readable = false` | – | „bis zu 3 %“ schon heute |

**Eine Zeitregel je Parameter** (N6): Statt Kombinationen werden die beiden Fälle auf zwei Parameter verteilt, `hkv.remote-reading.new-devices` (`eventDate`: Einbau nach dem 01.12.2021) und `hkv.remote-reading.retrofit` (`overlap`: Altgeräte ab 01.01.2027); die Kürzung selbst ist `hkv.cut.remote-reading` (3 %, `periodStart`). So bleibt der Typ `LawParam` aus 4.2 unverändert. Ein H, das 2027 nur teilweise berührt, bekommt bei Altgeräten „bis zu 3 %“ (15.1 Nr. 7).

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
  practice.ts        Werte aus Praxis oder Auslegung (VACANCY_PERSONS, Verdunster-Fenster, Warngrenze der Ablesung), eigens gekennzeichnet
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

Alle Werte stehen nur hier. **Ein Parameter kommt mit der PR ins Register, die ihn benutzt** (G-C7), nicht vorher.

| id | Wert | Norm, Quelle | Zeitregel | Prüfstand | PR |
|---|---|---|---|---|---|
| `bgb.deadline-months` | 12 | § 556 Abs. 3 S. 2 BGB | periodStart | geprüft 05.10. | 2 |
| `bgb.max-period-months` | 12 | § 556 Abs. 3 S. 1 BGB (h. M.) | periodStart | geprüft 05.10. | 2 |
| `betrkv.tv-signal` | bis 30.06.2024; nicht für Anlagen ab 01.12.2021 | § 2 S. 1 Nr. 15 a, b und S. 2 BetrKV | overlap | geprüft 05.10. | 1 |
| `ustg.standard-rate` | 19 % (16 % vom 01.07. bis 31.12.2020) | § 12 Abs. 1 UStG; § 28 Abs. 1 UStG a. F. | eventDate | **ungeprüft**, vor PR 1 lesen | 1 (für `vatExplainsGap`, G-C8) |
| `hkv.consumption-share` | 50 bis 70 % | § 7 Abs. 1 S. 1, § 8 Abs. 1 HeizkostenV | periodStart | geprüft 05.10. | 1 |
| `hkv.consumption-share-forced` | 70 %, nur Öl- oder Gasheizung (nicht bei Wärmelieferung, § 7 Abs. 3) | § 7 Abs. 1 S. 2 | periodStart | geprüft 05.10. | 10 |
| `hkv.cut.not-by-consumption` | 15 % | § 12 Abs. 1 S. 1 | periodStart | geprüft 05.10. | 1 |
| `hkv.cut.remote-reading` | 3 % | § 12 Abs. 1 S. 2 | periodStart | geprüft 05.10. | 1 (der Bestandshinweis nennt die Zahl) |
| `hkv.remote-reading.retrofit` | Altgeräte (Einbau bis 01.12.2021) fernablesbar ab 01.01.2027; Ausnahme technische Unmöglichkeit, unbillige Härte | § 5 Abs. 3 | overlap | geprüft 05.10. | 1 (ersetzt die Bestandsregel `heating-remote-reading` ohne Änderung von Text oder Zahl) |
| `hkv.remote-reading.new-devices` | Geräte mit Einbau nach dem 01.12.2021 sofort fernablesbar, außer Ersatz im nicht fernablesbaren Gesamtsystem | § 5 Abs. 2 | eventDate (Einbau) | geprüft 05.10. | 4 |
| `hkv.cut.information` | 3 % | § 12 Abs. 1 S. 3, § 6a | periodStart | geprüft 05.10. | 14 |
| `hkv.estimate-threshold` | „überschreitet 25 %“ | § 9a Abs. 2 | periodStart | geprüft 05.10. | 13 |
| `hkv.dhw.volume-formula` | 2,5 · V · (t_w − 10) | § 9 Abs. 2 S. 2 | periodStart | geprüft 05.10. | 11 |
| `hkv.dhw.area-formula` | 32 · A | § 9 Abs. 2 S. 4 | periodStart | geprüft 05.10. | 11 |
| `hkv.dhw.factors` | nur für Formelwerte: Erdgas Hₛ × 1,11; Wärmelieferung ÷ 1,15; monovalente Wärmepumpe × 0,30 (ergibt **Strom**: BT-Drs. 20/7619, „für die Abrechnung von Strom für Wärmepumpen … Jahresarbeitszahl von 2,7 … Nutzungsgrad von 0,8“, 0,8/2,7 ≈ 0,30) | § 9 Abs. 2 S. 6 | periodStart | geprüft 05.10. | 11 |
| `hkv.heating-values` | **nur hilfsweise und nur bei Heizkesseln**, wenn die Rechnung keinen Heizwert angibt: Heizöl EL 10 kWh/l, schweres Heizöl 10,9, Erdgas H 10 kWh/m³, L 9, Flüssiggas 13 kWh/kg, Koks 8, Braunkohle 5,5, Steinkohle 8, Holz 4,1, Pellets 5, Holzhackschnitzel 4 kWh/kg bzw. 650 kWh/SRm | § 9 Abs. 3 | periodStart | Werte geprüft 05.10.; **welche Hackschnitzelangabe gilt, ungeprüft** (BGBl. 2021 I S. 4964 vor PR 11 lesen) | 11 |
| `hkv.heat-pump.capture` | Wird der Verbrauch aus Wärmepumpen am 01.10.2024 noch nicht erfasst, ist bis 30.09.2025 eine Erfassung zu installieren; die Verordnung gilt ab dem Zeitraum, der **nach der Installation der Erfassung** beginnt (BT-Drs. 20/7619 bestätigt: Installation der Ausstattung). Ohne Erfassung nach dem 30.09.2025: 15 % nach § 12 Abs. 1 S. 1 als **Auslegung** (15.1 Nr. 22). Wärmepumpe mit Erfassung: sofort. Bei Bruttowarmmiete Durchschnittskosten 2022–2024 (S. 3). | § 12 Abs. 3 | eventDate (Installation der Erfassung) | geprüft 05.10. | 10 |
| `hkv.degree-days` | Tabelle 3.5, Tageswerte Monatswert ÷ Tage | § 9b Abs. 2 („anerkannte Regeln der Technik“); Werte [M] ista, Berliner Mieterverein | periodStart | Werte geprüft 05.10.; Herkunft ⟨Norm offen: DIN 94680⟩ | **3** (Vorschlag nach § 560, N3) |
| `co2.applicable-from` | 01.01.2023 | § 11 Abs. 2 S. 1 CO2KostAufG | periodStart | geprüft 05.10. | 6 |
| `co2.costs-before` | 01.01.2023 (Rechnungsdatum) | § 11 Abs. 2 S. 2 | eventDate | geprüft 05.10. | 8 |
| `co2.stage-table` | zehn Stufen, unten einschließend | Anlage CO2KostAufG | periodStart | geprüft 05.10. | 6 |
| `co2.rounding-decimals` | 1 | § 5 Abs. 1 S. 3 | periodStart | geprüft 05.10. | 6 |
| `co2.non-residential` | Vermieter 500 ‰ | § 8 Abs. 1 | periodStart | geprüft 05.10. | 7 |
| `co2.restriction` | einfach × 0,5; beide → keine Aufteilung; nur mit Nachweis | § 9 Abs. 1–3 | periodStart | geprüft 05.10. | 7 |
| `co2.cut.missing` | 3 % | § 7 Abs. 4 | periodStart | geprüft 05.10. | 6 |
| `co2.half-split` | Vermieter 500 ‰ für Netzentgelte (incurred ab 01.01.2028) und CO₂-Kosten (ab 01.01.2028, anteilig als Auslegung); Biobrennstoff ab 01.01.2029, höchstens 30 % | § 5a Abs. 1, 3 | incurred | geprüft 05.10. | 18 |
| `co2.half-split.new-buildings` | § 5a entsprechend bei Errichtung und erster Nutzung bis 31.12.2029; nicht bei Bauantrag oder Bauanzeige vor 13.05.2026 | § 5b | eventDate | geprüft 05.10. | 18 |
| `co2.half-split.emergency` | Einbau nach irreparablem Ausfall weniger als zwölf Monate vor 01.01.2028: Abs. 1–3 ruhen zwölf Monate ab Einbau; Fälle nach § 43 Abs. 7 GModG | § 5a Abs. 4 | eventDate | geprüft 05.10. | 18 |
| `co2.half-split.two-family` | im selbst bewohnten Gebäude mit höchstens zwei Wohnungen keine Teilung, außer die Gemeinde steht in einer Verordnung nach § 556d Abs. 2 S. 1, § 558 Abs. 3 S. 3 oder § 577a Abs. 2 S. 2 BGB; nur mit Mitteilung in Textform | § 5d Abs. 1 Nr. 1, Abs. 3, 4 | periodStart | geprüft 05.10. | 18 |
| `co2.self-supply` | Anzeige binnen 12 Monaten; −5 % bei Nutzung eigener Geräte zu anderen Zwecken | § 6 Abs. 2, 3 | eventDate | geprüft 05.10. | 19 |
| `co2.price` | 2023: 30, 2024: 45, 2025: 55, 2026: 60 €/t (Mittelwert des Preiskorridors 55–65 nach § 4 Abs. 1 Nr. 2, kein Festpreis; Hinweis 4 der dritten Prüfung, Wortlaut durch Gegenprüfung R gelesen); 2027: `null` | § 3 Abs. 3, § 4 Abs. 1, 2; DEHSt | deliveryYear, überschreibbar | geprüft 05.10. | 17 |
| `co2.price-ets` | 2023: 80,40; 2024: 83,68; 2025: 65,01; 2026: 73,86 €/t | § 3 Abs. 4 Nr. 4 b, § 4 Abs. 3 | eventDate (Rechnungsdatum − 1 Jahr) | Regel geprüft 05.10., Werte übernommen | 17 |
| `co2.ebev-factors` | Erdgas 0,20088 kg/kWh Hᵢ bzw. 0,18139 Hₛ; Heizöl EL 0,2664 kg/kWh bzw. 2,6763 kg/l; Flüssiggas 0,2358 bzw. 3,013 kg/kg | EBeV 2030 Anlage 2 Teil 4 | deliveryYear | übernommen | 17 |
| `messev.calibration-years` | Kaltwasser, Warmwasser, Wärme je 6 | MessEV Anlage 7 Nr. 5.5.1, 5.5.2, 7.1; § 34 Abs. 2 | eventDate | Werte geprüft 05.10.; Übergangsdatum ungeprüft | 21 |
| `practice.vacancy-persons` | 1 | Auslegung nach BGH VIII ZR 180/12 | periodStart | Bestand (#177) | 1 |
| `practice.evaporator-window` | 400–800 ‰ | [M] ARGE (Berliner Mieterverein, ista) | periodStart | geprüft 05.10.; nur Lexikon | 12 |
| `practice.reading-off-warning` | ab einem Monat Abweichung in Oktober bis April | Haufe-Kommentar (Literatur), ⟨Norm offen: VDI 2077⟩ | periodStart | sekundär | 10 |

`practice.*`-Werte sind keine Rechtswerte; Ausweis und Lexikon nennen ihre Herkunft. Die Betriebsstrom-Spannen (3–10 %) kommen **nicht** ins Register, denn sie sind keine Regel, sondern im Lexikon genannte Literaturwerte (13 PR 15).

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
- Die Regeln aus §§ 5a, 5b und 5d gelten ab 01.01.2028 (Netzentgelte, CO₂) und ab 01.01.2029 (Biobrennstoff); § 5b übernimmt die Daten von § 5a, mit den Voraussetzungen zum Neubau (R-A9). Sie kommen mit PR 18 ins Register.
- **Bis dahin gilt eine Sperre:** Das Merkmal „Heizung nach § 43 Abs. 1 GModG“ an der Anlage lässt sich nicht setzen (400). Ohne Merkmal rechnet ein Zeitraum, der 2028 berührt, richtig nach Stufen, denn § 5a gilt nur für solche Anlagen.
- PR 18 muss vor der ersten Abrechnung einer Heizperiode mit Tagen ab 01.01.2028 ausgeliefert sein.

### 4.7 Tests

**Je Parameter ein Test je Stichtag**, nach seiner Zeitregel. Zeiträume beginnen am Monatsersten, deshalb lauten die Stichtagstests auf Monate (G-F):

| Parameter | Fall | Erwartung |
|---|---|---|
| `co2.applicable-from` | Zeitraum `2022-12` | nicht anwendbar |
| `co2.applicable-from` | Zeitraum `2023-01` | anwendbar |
| `co2.half-split` | H `2027-05` | 530 ‰ hälftig (3.9) |
| `hkv.cut.remote-reading` | Gerät eingebaut 15.11.2021 | 2026 keine Kürzung, 2027 3 % |
| `hkv.cut.remote-reading` | Gerät eingebaut 15.12.2021, nicht fernablesbar | 3 % schon 2022 |
| `hkv.heat-pump.capture` | Erfassung schon vor 01.10.2024 vorhanden, Zeitraum `2025-01` | Verordnung anwendbar |
| `hkv.heat-pump.capture` | keine Erfassung am 01.10.2024, Erfassung installiert 01.06.2025, Zeitraum `2025-01` | Verordnung noch nicht anwendbar |
| `hkv.heat-pump.capture` | dasselbe, Zeitraum `2026-01` | anwendbar |
| `hkv.heat-pump.capture` | Wärmepumpe neu eingebaut 01.02.2025 mit Erfassung, Zeitraum `2025-01` | anwendbar (die zweite Fassung nahm sie aus) |
| `hkv.heat-pump.capture` | keine Erfassung bis 30.09.2025, Zeitraum `2026-01` | 15 % nach § 12 Abs. 1 S. 1 (Auslegung, 15.1 Nr. 22) |

**Vollständigkeit:**

- Jede Fassung hat `source.url`, `source.retrieved` und `source.cite`.
- Die Fassungen sind lückenlos und überlappen nicht. `null` ist nur bei `overridable` erlaubt.
- `law-history.test.ts` hält jede ausgelieferte Fassung als Zahl fest. Das ist die eigentliche Sicherung. `LAW_AS_OF` ist das jüngste `retrieved`.

**Release-Sperre:** Ein Test, der nur beim Tag läuft, bricht ab, solange ein Parameter im Register `checked: 'unchecked'` hat. Weil Parameter erst mit ihrer PR eingetragen werden (G-C7), sperrt eine verschobene PR das Release nicht.

**Wächter `law-literals.test.ts`** (Quelltext):

- Verboten sind ISO-Datumsliterale in calc.ts, heating.ts, co2.ts, fuel.ts, period.ts und snapshot.ts.
- Verboten sind auch Prozentangaben im Muster einer Rechtsfolge in Zeichenkettenliteralen (`um \d+ ?%`, `\d+ ?% kürzen`, `\d+ bis \d+ ?%`, `\d+ Prozent`) sowie die Zahlen von Stufen- und Gradtagstabelle als Feld.
- **Erlaubte Stellen** stehen benannt in einer Liste im Test, jede mit Grund (G-C8):
  - Prozentangaben, die Nutzerdaten über `${…}` einsetzen, sind keine Literale und werden ohnehin nicht getroffen (etwa `custom`).
  - Die Umsatzsteuer kommt über `ustg.standard-rate`.
  - Die Prompts an das Modell sind ausgenommen.
  - Beispielrechnungen im Lexikon tragen `/* Beispiel */`.

**Umstellung ohne Golden-Änderung:** PR 1 zieht die bestehenden Werte um. Golden F01–F11, `db-golden` und `calc-wortlaut.test.ts` bleiben wortgleich; die Vergleiche lassen `legalBasis.values` aus.

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
| `properties.period_start_month`, `period_changes` | neu | 2 |
| `year` → `period` in `cost_items`, `closed_settlements`, `closed_settlement_history`, `prepayment_overrides`; `assessments.requested_year` → `requested_period` | geändert, mit Datenanweisung | 2 |
| `uploads.year`, `assessments.year`, `assessments.detected_year` | **bleiben Kalenderjahre** (G-B7) | – |
| `cost_items.service_from`, `service_to`, `tax_year` | neu | 3 |
| `properties.kind` + `'zfh'` | Bedingung | 4 |
| `heating_plants`, `heating_plant_units`, `heating_periods` | neu | 4 |
| `heating_period_changes` | neu | 5 |
| `cost_items.heating_plant_id` | neu | 4 |
| `cost_items.heating_part` (nullbar, nur Kostenart Heizung; die Oberfläche bietet zunächst nur „Brennstoff/Energie“) | neu | **3** (A1) |
| `cost_items.heating_target` (nullbar; Pflicht bei `heatingSystem`, bei `manual` wählbar für `change_split`); `key` + `'heatingSystem'`; `heating_part` Pflicht bei `heatingSystem` | neu bzw. Bedingung | 10 |
| `heating_prepayments`, `heating_prepayment_overrides`, `closed_heating_settlements`, `closed_heating_settlement_history` | neu | 5 |
| `meters`: Typen `warmwasser`, `hkv`; `heating_plant_id`, `heating_role`, `remote_readable`, `installed_on` | neu bzw. Bedingung | 4 |
| `meters.rating_factor`, `hca_scale` | neu | 12 |
| `meters.calibrated_until` (nicht für `hkv`) | neu | 21 |
| `co2_statements`, `co2_tenant_reliefs` | neu | 6 |
| `fuel_deliveries`, `fuel_delivery_parts`, `cost_items.fuel_delivery_id`, `fuel_carry_frozen` | neu | 7 |
| `heating_service_values` | neu | 12 |
| `heating_estimates` | neu | 13 |
| `law_overrides` | neu | 17 |
| `co2_refunds` | neu | 19 |
| Merkmale § 5a/5b/5d an Anlage und Objekt | neu | 18 |

### 5.2 Zeitraum (PR 2): `period` statt `year`

**Betroffen** sind nur Spalten, die einen Abrechnungszeitraum bezeichnen:

- `cost_items.year`
- `closed_settlements.year`
- `closed_settlement_history.year`
- `prepayment_overrides.year` (Teil des Primärschlüssels)
- `assessments.requested_year` → `requested_period`, mit der Bedingung „nur mit Objekt“

`uploads.year`, `assessments.year` und `assessments.detected_year` **bleiben Kalenderjahre** (G-B7). Sie sind Tatsachen über den Beleg, und ohne Objekt (`property_id` nullbar) ließe sich ein Zeitraumschlüssel nicht prüfen. Die pausierte Spezifikation der Belegbuchung (#174, #175) wird beim Wiederaufnehmen nachgezogen.

**Schritt 0014 (Spalten und Daten):**

- Neue Spalte `period` text, nullbar, mit angehängter Datenanweisung `UPDATE … SET period = printf('%04d-01', year) WHERE year IS NOT NULL` hinter `--> statement-breakpoint`, eingeleitet vom Kommentar „angehängt“.
- Dazu `properties.period_start_month` (integer, Vorgabe 1) und `period_changes(property_id → properties CASCADE, from_month text, PK beide)`.
- drizzle-kit fragt beim Wegfall von `year` nach „umbenennen oder neu“; die Antwort ist „neu“, sonst entstünde `period` als Ganzzahl (Gegenprüfung G, E).

**Schritt 0015 (Bedingungen):**

- `period` Pflicht, wo `year` es war; `year` entfällt.
- Prüfung `period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr(period, 6, 2) AS INTEGER) BETWEEN 1 AND 12` (G-C3).
- Indizes `(property_id, period)`, eindeutig bei `closed_settlements`. Primärschlüssel `prepayment_overrides(tenancy_id, period)`.
- Beginnmonat 1..12, `from_month` im selben Format.
- Die Kette läuft in einer Transaktion mit Prüfung der Fremdschlüssel. `applyMigrations` fängt den Neubau samt `PRAGMA foreign_keys=OFF` schon heute ab (client.ts). Praxislauf Fall 16 prüft das an einer Datenbank von 0.10.1.

**API und Kompatibilität** (G-C6):

- Routen mit Zeitraum nehmen `JJJJ-MM`.
- Eine nackte Jahreszahl `2025` gilt als `'2025-01'` **nur bei einem reinen Kalenderobjekt** (Beginnmonat 1, keine Wechsel). Sonst antwortet die Route mit 404 und dem Satz „Den Zeitraum 2025 gibt es für dieses Objekt nicht; meinen Sie 2025/2026?“. So kann ein alter Tab nach einem Wechsel nie still den Rumpf bekommen.
- `Settlement.deadline` (neu) trägt die Frist. Ein Tab von vor dem Update rechnet sie noch als `${year+1}-12-31`. Das betrifft nur Objekte mit abweichendem Zeitraum, und die entstehen erst in der neuen Oberfläche.
- `/api/taxreport/:year` und `/api/rentledger/:year` bleiben beim Kalenderjahr.

**Typen:**

- `PeriodKey` ist ein Markentyp über `string`. Nur `shared/period.ts` erzeugt und zerlegt ihn; jede alte Stelle mit `year - 1` fällt beim Übersetzen auf.
- `Settlement.year` bleibt (Kalenderjahr des Beginns). `Settlement.period` und `Settlement.deadline` sind neu.

**Validator:** Die db.json kennt nur Kalenderjahre, deshalb bleibt `validate.ts` vierstellig.

### 5.3 Heizanlage (PR 4, PR 5)

**`heating_plants`:**

| Spalte | Typ | Bedeutung, Quelle |
|---|---|---|
| `id`, `property_id` (RESTRICT) | | |
| `name` | text, Vorgabe `''` | ab der zweiten Anlage Pflicht |
| `energy` | `gas \| oil \| lpg \| pellets \| wood \| districtHeating \| heatPump \| electric \| coal \| other`, Pflicht | Energieträger. Erfasst vom CO2KostAufG sind Brennstoffe mit Standard-Emissionsfaktor nach der EBeV (`gas`, `oil`, `lpg`, `coal`) und die Wärmelieferung „hinsichtlich der für die Wärmeerzeugung eingesetzten Brennstoffe“ ([G] § 2 Abs. 1 S. 2). Fernwärme ist deshalb nicht pauschal „fossil“; weist der Lieferant kein CO₂ aus (§ 3 Abs. 4), ist C = 0 (R-A28). |
| `supply` | `central \| perUnit`, Vorgabe `central` | `perUnit` = Etagenheizungen mit Vertrag auf den Vermieter ([G] § 5 Abs. 1 S. 2 CO2KostAufG) |
| `method` | `service \| self \| manual`, Vorgabe `manual` | Messdienst, Mietfuchs nach HeizkostenV, freie Schlüssel wie heute |
| `separate_settlement` | boolean, nullbar (unbekannt) | Werden die Heizkosten getrennt abgerechnet, mit eigener Vorauszahlung? `false`: Weg b möglich; `true` und H ≠ P: Weg d; `true` und H = P: eine Gesamtabrechnung mit getrennt ausgewiesenen Vorauszahlungen (3.1, A3). |
| `devices_remote` | `all \| none \| partial \| unknown`, Vorgabe `unknown` | Fernablesbarkeit, wenn Mietfuchs keine Zähler kennt (`service`, `manual`; G-C2) |
| `devices_installed_after_2021_12` | `all \| some \| none \| unknown` | Geräte nach dem 01.12.2021 eingebaut? (§ 5 Abs. 2 HeizkostenV, R-A1) |
| `hot_water` | `combined \| separate \| none`, Vorgabe `combined` | § 9 HeizkostenV |
| `capture` | `heatMeter \| hca \| serviceValues`, nullbar | nur bei `self` |
| `hca_model` | text, nullbar | Bauart |
| `source` | `building \| homeowners`, Vorgabe `building` | `homeowners` = vermietete Eigentumswohnung, die Gemeinschaft liefert die Abrechnung (F2 der dritten Prüfung); nur mit `method = 'service'`, ohne Lieferungen |
| `capture_installed_on`, `captured_on_2024_10_01` | nullbar | Wärmepumpe: Erfassung am 01.10.2024 vorhanden? sonst Datum der Installation (§ 12 Abs. 3, F5) |
| `warm_rent_average_2022_2024` | nullbar | § 12 Abs. 3 S. 3 bei Bruttowarmmiete; Aufgabe in der Einrichtung (L4) |
| `area_basis_heat` | `area \| heatedArea`, Vorgabe `area` | nur für den Topf Heizung (§ 7 Abs. 1 S. 5). Warmwasser immer Wohn- oder Nutzfläche (§ 8 Abs. 1; R-A21). |
| `change_split` | `degreeDays \| time`, Vorgabe `degreeDays` | § 9b Abs. 2: Gradtage oder zeitanteilig **nur für die übrigen Wärmekosten**, Warmwasser immer zeitanteilig. Bei `self` wirkt es auf den Topf Heizung. **Bei `manual`** wirkt es nur auf Positionen, die erkennbar nur Heizung sind (`heating_target = 'heating'`, ab PR 10); kombinierte Positionen „Heizung und Warmwasser“ gehen nach Tagen, wie heute (A2). Damit ändert das Anlegen einer Anlage in PR 4 keine Zahl. Setzt der Vermieter später eine Position auf „nur Heizung“, zeigt die Vorschau die Verschiebung je Mieter. |
| `exemption` | `none \| lowDemand \| disproportionate \| pre1981 \| renewable \| authority` | § 11 HeizkostenV |
| `agreed_otherwise` | `null \| area \| fixedPercent \| consumption` | § 2 HeizkostenV, nur wenn `mayAgreeOtherwise` |
| `non_residential` | boolean | § 8 CO2KostAufG |
| `restriction` | `none \| building \| supply \| both` | § 9 CO2KostAufG, mit Nachweispflicht (§ 9 Abs. 3) |
| `district_ets_new` | boolean | § 2 Abs. 4 S. 2 CO2KostAufG |
| `gmodg43_installed_on`, `emergency_install`, `new_building_first_use`, `building_application_before_2026_05_13` | nullbar | §§ 5a, 5b; gesperrt bis PR 18 |
| `half_split_notice_on` | text, nullbar | Mitteilung in Textform nach § 5d Abs. 4 |
| `period_start_month` | integer 1..12, nullbar | eigene Heizperiode (#217); `null` = wie das Objekt |

`properties.tight_market` (boolean, nullbar) für § 5d kommt mit PR 18; die Frage lautet: „Steht Ihre Gemeinde in einer Verordnung zur Mietpreisbremse (§ 556d BGB), zur Kappungsgrenze (§ 558 Abs. 3 BGB) oder zur Kündigungssperre (§ 577a Abs. 2 BGB)?“ (F4). `heating_period_changes(plant_id CASCADE, from_month, PK beide)` kommt mit PR 5. `heating_prepayments(tenancy_id CASCADE, from, cents ≥ 0)` (Weg d) kommt mit PR 5.

**`heating_plant_units`:** `(plant_id CASCADE, unit_id CASCADE)` als Primärschlüssel, dazu `heated_area_m2` (real, nullbar, > 0). Ohne Zeilen versorgt die Anlage alle Wohnungen des Objekts (`isDwelling`) ohne „kein Anschluss: Wärme“ (#117). Ab zwei Anlagen müssen alle Zeilen haben und sich ausschließen (400, auch beim Wiederherstellen). `sameProperty` prüft die Einheit.

**`heating_periods`:** eine Zeile je Anlage und Heizperiode, eindeutig `(plant_id, period)`.

| Gruppe | Spalten |
|---|---|
| Verteilung (§§ 6 Abs. 4, 7, 8, 10) | `heat_consumption_pct`, `water_consumption_pct`. **Vorgabe ist der Wert der vorigen Heizperiode**; in der ersten fragt die Einrichtung nach dem bisherigen Maßstab. Eine Änderung gilt nur für eine H, die noch nicht begonnen hat, und ergibt den Hinweis `heating.key-change` mit Erklärungspflicht (R-A7, [G] § 6 Abs. 4). Dazu `above_70_agreed`, `insulation_rule` (`applies \| notApplies \| unknown`). |
| Warmwasser (§ 9) | `dhw_method` (`heatMeter \| volumeFormula \| areaFormula`, bei `service` als Angabe laut Messdienst), `dhw_heat_kwh`, `total_heat_kwh`, `dhw_volume_m3`, `dhw_temp_c`, `dhw_unmeasurable` |
| Vorrat | `stock_unit` (`l \| kg \| srm`), `opening_quantity`, `opening_cost_cents`, `opening_emissions_kg`, `opening_co2_cents`, `opening_invoiced_before_2023`, `closing_quantity`, `closing_measured_on` (Peildatum, L2) |
| § 6a Abs. 3 | `info_taxes_text`, `info_district_ghg`, `info_district_pef`, `climate_factor`, `climate_factor_prev`, `consumer_contract`, `info_contacts_confirmed` |

Ist die H abgeschlossen, sind ihre Zeile und die Vorratswerte gesperrt (409; G-A4).

**Kostenpositionen:**

| Spalte | PR | Bedeutung |
|---|---|---|
| `cost_items.heating_plant_id` | 4 | nullbar, RESTRICT; Schlüssel muss eine Heizperiode der Anlage sein (3.0) |
| `heating_part` (`fuel \| operating \| metering`) | 3 | nullbar, nur Kostenart Heizung; Pflicht bei `key = 'heatingSystem'` ab PR 10 |
| `heating_target` (`both \| heating \| water`) | 10 | Pflicht bei `key = 'heatingSystem'`, sonst nullbar; bei `manual` setzt der Vermieter „nur Heizung“, damit `change_split` wirkt (A2, B7). Keine Bedingung „nur bei `heatingSystem`“. |
| `fuel_delivery_id` | 7 | 5.4 |

**Zähler (PR 4):**

- Typen `warmwasser`, `hkv`.
- `heating_plant_id` für Zähler ohne Wohnung mit `heating_role` (`supply \| dhwHeat \| totalHeat`).
- `remote_readable` (nullbar).
- `installed_on` (text, nullbar; R-A1).
- PR 12: `rating_factor`, `hca_scale`.
- PR 21: `calibrated_until`, mit der Bedingung `type <> 'hkv'` (Z-B10).

**Wasserschlüssel (berichtigt, G-B8):**

- Beim Schlüssel „nach Verbrauch“ mit Kaltwasser geht der Verbrauch der Warmwasserzähler in die Basis ein ([G] § 8 Abs. 2 HeizkostenV: Wasserkosten gehören zum Warmwasser, „soweit sie nicht gesondert abgerechnet werden“).
- Für die Frage „hat die Wohnung einen Zähler“ (Rückfall auf den Hauptzähler, #116) zählt aber **nur ein Kaltwasserzähler**. Eine Wohnung mit nur einem Warmwasserzähler gilt als ohne Zähler; ihr Kaltwasser kommt über den Hauptzähler.

**Objektart:** `properties.kind` + `'zfh'` (#180) als Beschreibung. Die Ausnahme des § 2 hängt an den Tatsachen.

### 5.4 Brennstofflieferungen (PR 7): `fuel_deliveries`

| Spalte | Bedeutung |
|---|---|
| `id`, `plant_id` (RESTRICT) | |
| `amount_cents` | Rechnungsbetrag **nur**, wenn keine Kostenposition auf die Lieferung zeigt (Messdienstfall), für C und G |
| `label`, `invoice_date`, `delivered_at`, `invoice_from`, `invoice_to` | Zeitraum Pflicht bei Gas, Fernwärme, Strom |
| `unit_id` | nullbar, CASCADE; nur bei `perUnit` (F8) |
| `quantity`, `quantity_unit` (`l \| kg \| m3 \| kWh \| srm`), `energy_kwh`, `gas_basis` (`hs \| hi`) | Menge |
| `heating_value` | Heizwert laut Rechnung. Er hat Vorrang vor der Tabelle des § 9 Abs. 3 ([G] „sind … zu verwenden“; R-A13). |
| `emissions_kg`, `co2_cost_cents`, `emission_factor` | § 3 Abs. 1 Nr. 1–3 CO2KostAufG, brutto (§ 3 Abs. 3) |
| `grid_fee_cents`, `bio_cost_cents` | § 5a, § 3 Abs. 1 Nr. 6; bis PR 18 gesperrt |
| `share_permille` | nullbar, eingetragener Anteil (Stufe 0 in 3.2) |
| `fixed_cents` | nullbar; fester Preisbestandteil (Grund-, Leistungs-, Mess-, Verrechnungspreis), nach Tagen abgegrenzt (R1) |
| `estimated` | boolean, Vorgabe false; geschätzte Lieferung für eine noch fehlende Rechnung (8.2, N1), ohne Kostenposition |
| `used_by_service` | boolean, Vorgabe true; bei `selfAfterService`: Diese Rechnung hat der Messdienst in seinen Brennstoffkosten angesetzt (3.3, 7.6) |

**`fuel_delivery_parts`** (Stufe 3 in 3.2, Z-B4): `(delivery_id, from)` als Primärschlüssel, dazu `to`, `energy_kwh`, `amount_cents`, `emissions_kg`, `co2_cost_cents`. Das sind die Teilmengen laut Rechnung.

**Mehrere Positionen je Lieferung** (G-C4): `cost_items.fuel_delivery_id` (nullbar, RESTRICT) statt einer Spalte an der Lieferung. Abschläge, Schlussrechnung und Gutschrift einer Lieferrechnung zeigen alle auf dieselbe Lieferung. Ihr Betrag ist Σ der Positionen, und alle Positionen werden im selben Verhältnis abgegrenzt.

**Zu welcher Heizperiode die Positionen einer Lieferung gehören:** zu der, die das Ende des Rechnungszeitraums bzw. das Lieferdatum enthält. Ihr Anteil an anderen Heizperioden läuft über `fuelCarry` (8.2).

**`fuel_carry_frozen`** (G-A4): `(delivery_id, heating_period_id)` als Primärschlüssel, dazu `cents`, `emissions_kg`, `co2_cents`. Beim Abschluss einer H wird je Lieferung festgehalten, was H hinaus- oder hereingebucht hat. Spätere Zeiträume lesen diesen Wert und rechnen ihn nicht neu.

Eine Lieferung, die eine abgeschlossene H berührt, ist in ihren Mengen-, Zeit- und Betragsfeldern gesperrt (409 mit Satz). Der Schnappschuss lädt die Lieferungen der Anlage, die H berühren, samt Vor- und Folgezeitraum und den eingefrorenen Überträgen.

### 5.5 CO₂ (PR 6)

**`co2_statements`:** Primärschlüssel = `heating_period_id` (CASCADE). Der Zeitraum ist der von H.

| Spalte | Bedeutung |
|---|---|
| `method` | `serviceDeducted \| serviceShown \| selfAfterService \| self`, ohne Vorgabe |
| `area_m2` | nullbar, Fläche der Einstufung |
| `service_emissions_kg`, `service_area_m2`, `service_kg_per_m2`, `service_landlord_permille`, `service_total_cents` | laut Messdienst |
| `service_landlord_cents` | L |
| `service_users_total_cents` | **S = die gedruckte Zeile der zu verteilenden Kosten Heizung und Warmwasser** in der Kostenaufstellung des Messdienstes, bei Vorwegabzug also nach dem Abzug (Techem-Muster: „Summe der Nutzerkosten Heizungsanlage 3.845,51“). Nicht die Summe der gerundeten Nutzerzeilen (G-B3). Bei `service*` Pflicht. |
| `service_units_count` | Zahl der Nutzeinheiten laut Messdienst, vorbelegt mit den Wohnungen der Anlage; für die Rundungstoleranz (7.3) |
| `service_cost_item_id` | Position, in der L gebucht wird (SET NULL) |
| `service_self_landlord_cents` | L_self laut Messdienst |
| `service_fuel_gross_cents` | G, vorbelegt aus Σ der Lieferungen |
| `service_fuel_net_cents` | V |

Bedingungen wie bisher. `co2_tenant_reliefs(statement_id, tenancy_id, cents ≥ 0)` mit `guardTenancy`; `crossPropertyViolations` fragt sie mit ab. `co2_refunds` (PR 19) ist aus dem CO₂-Entwurf übernommen.

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
- `LandlordReason` + `'co2Share' | 'fuelCarry' | 'fuelClosedPeriod' | 'fuelEstimateDiff' | 'co2Refund'`.
- `Statement.recommendedDeadline?`, `Statement.scope?: 'all' | 'heating'` (Weg d), `Settlement.deadline`.
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
- **Umstieg:** Die db.json kennt nichts davon. Der Eingang schreibt 0000, die Kette zieht `year` auf `period` um, und es entsteht keine Anlage. Die Regression rechnet beide Seiten mit Kalenderjahr und ohne Anlage. **`server/src/legacy/read.ts`** erfüllt `SnapshotSource` und rechnet vor der übrigen Kette auf einer 0000-Datenbank. Es muss deshalb ab PR 2 aus `year` selbst `period` (`'JJJJ-01'`), `period` des Snapshots (Kalenderjahr) und leere Anlagen erzeugen (G-C9). read.ts steht bewusst nicht unter der Prüfsumme des eingefrorenen Eingangs.
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
2. **Statements bilden.** Ein Statement bekommt jedes Mietverhältnis, das P berührt **oder** eine eingestellte H einer Anlage seiner Wohnung. Wer nur H berührt, bekommt `heatingOnly`: keine kalten Kosten, keine Vorauszahlungen. **Anlagen nach Weg d** (H ≠ P, getrennte Abrechnung) gehören nicht in P: P lässt ihre Positionen und die Heizvorauszahlungen weg; sie laufen im eigenen Zweig 7.
3. **Kalte Positionen von P** werden wie heute verteilt. Schlüssel, Leerstand, Eigennutzung, Pauschale und #202 bleiben unverändert, nur die Tage zählen über P.
4. **Je Anlage und H:**
   1. **Topf** = Positionen mit `heating_plant_id` = Anlage und `period` = H.
   2. **Brennstoff** (`fuel.ts`): Anteil jeder Lieferung an H (3.2), bei Vorrat die Bestandsrechnung (8.2), eingefrorene Überträge abgeschlossener Perioden. Ergebnis: Ausstoß E_H (immer umgerechnet, 3.3), Abdeckung; bei `self` und bei `manual` mit verknüpfter Lieferung oder Bestand die verbrauchten Brennstoffkosten F_H und die abgegrenzten CO₂-Kosten C_H, sonst C_H wie im Topf berechnet (A6, B6); Netzentgelte.
   3. **Verteilen nach `method`:**
      - `manual`: jede Position nach ihrem Schlüssel wie heute, nur über die Tage von H; Mieterwechsel und Leerstand nach Tagen, bei Positionen „nur Heizung“ nach `change_split` (A2); Lieferungen mit verknüpfter Position und Vorrat mit Bestand abgegrenzt über `fuelCarry`, C nach Verbrauch (A6); sonst die Warnungen aus #140 und `fuel.manual-beyond-period`.
      - `service`: Messdienstbeträge (`amounts`) wie heute; Mietverhältnisse aus H.
      - `self`: die Anlage berechnet je Empfänger exakte Gewichte g_r(z) (8.6), und jede Position wird damit **einmal** verteilt (`distributeCents`). Dazu kommen die Zeilen `fuelCarry` (8.2).
   4. **CO₂** (`co2.ts`) mit E_H, C_H und der Stufe:
      - `serviceDeducted`: Zerlegung des Vermieterrests (7.4);
      - alle übrigen Methoden: Abzugszeilen `co2Relief` je Mieter nach dem Anteil am Brennstoff (9.4).
   5. **Kürzungsbeträge** je Mieter (6.5) und Hinweise.
5. **Vorauszahlungen** der Monate von P, Saldo, Vorschlag nach § 560 Abs. 4 (3.7). **Wer die Heizkosten abrechnet, rechnet auch `heating_prepayments` an** (C4): P rechnet beide Staffeln an, außer die Heizkosten laufen nach Weg d in einer eigenen Heizkostenabrechnung; dann rechnet diese die Heizstaffel ab X an.
6. **Ausweis:** Druckblöcke Heizkostenabrechnung (8.8), CO₂ (9.5), § 6a (8.8), Rechtsstand mit benutzten Werten (4.4).
7. **Weg d, je Anlage und H** (B3): eigene Berechnung mit den Schritten 4.1–4.5 für diese Anlage, Statements `scope: 'heating'` mit den Heizvorauszahlungen der Monate von H, Vorschlag nach § 560 für die Heizvorauszahlung, `Settlement.deadline = settlementDeadline(H)`, eigener Abschluss (3.1).

### 6.2 Empfänger und Rundung (#202)

**Mieterzeilen:** Je Position bekommt jedes Mietverhältnis einen exakten Rohwert (bei `self` aus den Gewichten der Anlage, sonst aus dem Schlüssel). `distributeCents` verteilt die Position genau einmal.

**Vermieterzeilen** kommen aus `landlordRecipients` mit `take()`:

- `selfUse` (immer exakt, nie über `take()`, #203);
- `flatRate`, `inclusive`, `outsideUnit`, `vacancy`/`amountsRest`;
- neu `co2Share` (7.4, über `take()`);
- neu `fuelCarry` (8.2);
- neu `fuelClosedPeriod` (8.2);
- neu `fuelEstimateDiff` (8.2), positiv oder **negativ** (zu hohe Schätzung, dann ist der Betrag eine Gutschrift an die Mieter der Vorperiode, A4).

**§35a** läuft über `distributeLaborCents` mit denselben Rohwerten.

**Abzugszeilen `co2Relief`** sind eine eigene Verteilung von R (9.4).

**Zusagen:**

- Summe centgenau.
- **Jede Zeile** liegt höchstens 1 ct neben ihrem exakten Wert, Gleichstand nach Kennung.
- **Die Nettosumme eines Mieters** (Heizzeilen minus Abzug) liegt höchstens **(k + 1) ct** neben ihrem exakten Wert, k = Zahl seiner Heizzeilen im Topf, denn jede Position und der Abzug werden getrennt gerundet (N2; die zweite Fassung nannte 2 ct, das gilt nur bei einer Heizzeile). Kürzungsbeträge rechnen auf den **gedruckten** Zeilen des Mieters (6.5), denn das Gesetz nennt den Anteil „gemäß der Heizkostenabrechnung“.

**Ausnahmen beim Vorzeichen bei widerspruchsfreien Daten:** `fuelCarry` (Vorrat oder Rechnungsteil aus einer anderen Periode) und `fuelEstimateDiff`. Auf der Mieterseite sind die `fuelCarry`-Zeilen „im Vorrat bzw. für den vorigen Zeitraum“ negativ; sie zählen in k der Rundungszusage mit (A7). Das steht am Kommentar von `landlordRecipients`.

### 6.3 Leerstand, Eigennutzung, Pauschale, außerhalb

| Lage | Behandlung | Quelle |
|---|---|---|
| **Leerstand** | Nutzer der Wohnung. Trägt bei `self` seine Grundkosten (Gradtage) und seinen gemessenen Verbrauch, bei `service` den Rest der Messdienstbeträge (`amountsRest`). | [G] § 9b Abs. 1, §§ 6, 7 Abs. 1 S. 5 HeizkostenV (der Vermieter ist Nutzer der leeren Räume); [M] Brunata. Dass der Vermieter die Leerstandskosten trägt, entspricht für kalte Kosten [R] VIII ZR 159/05. |
| **Eigennutzung** | Nutzer mit eigenem Anteil (`selfUse`), in der Steuer privat (#163) | Bestand |
| **Pauschale, Inklusivmiete** | Der Anteil fällt dem Vermieter zu, wie heute (#93). Neu: Die Warnung `heating.flat-rate` nennt den Betrag nach der Verordnung, sobald `self` ihn kennt. | [R] VIII ZR 212/05, übernommen. Die Umrechnung des Heizanteils der Warmmiete in eine Vorauszahlung baut Mietfuchs nicht nach (offen wie #109). |
| **Außerhalb der Abrechnungseinheit** | wie heute (`outsideUnit`) | Bestand |

### 6.4 Steuer, Mietkonto

Siehe 3.10 und 3.11. Dazu drei Regeln:

1. **Eigenanteil je Position** (G-C5). `splitForTax` nimmt den privaten Teil einer Position als **Positionsbetrag × Gewicht der Eigennutzung**, exakt und ohne Übertrag. Zeilen ohne Position (`co2Relief`, `co2Share` aus 9.4, `fuelCarry`, `fuelClosedPeriod`, `fuelEstimateDiff`) lässt sie aus.
   - Beispiel Heizöl (8.2) mit ⅓ Eigennutzung: privat sind 5.650 · ⅓ = **1.883,33 €** (bezahlt), nicht 5.750 · ⅓ = 1.916,67 €.
   - Die Differenz von 33,33 € wäre zu viel privat. Testfall in 12.2.
2. **CO₂ beim Vorwegabzug:** L steckt im Bruttobetrag der Position. `co2Share` ist abziehbar, L_self privat (7.4). Damit ist #209 behoben.
3. **`co2Refund`** (G-B10). Die Steuer liest nur Zahlungen.
   - Verrechnet der Vermieter die Erstattung mit der Miete, steckt sie schon in der kleineren Zahlung.
   - Zahlt er sie gesondert aus, erfasst er eine negative Zahlung.
   - Mietfuchs zieht nichts zusätzlich ab. Testfall: 50 € Erstattung, Zahlung 950 statt 1.000 € → Ist um genau 50 € niedriger, nicht um 100 €.

### 6.5 Kürzungsbeträge

Jede Kürzung wird **je Mieter beziffert und einzeln genannt, nie summiert**. Ob sich Kürzungen addieren, regelt der Wortlaut nicht ([G] § 12 HeizkostenV). ista nennt das Kürzungsrecht „kumulativ“ ([M] ista-FAQ); das ist keine Rechtsquelle (15.1 Nr. 4).

| Kürzung | Satz (Register) | Grundlage der Prozente (gedruckte Zeilen nach Abzug) | Wann |
|---|---|---|---|
| nicht verbrauchsabhängig | `hkv.cut.not-by-consumption` | Anteil an den nicht verbrauchsabhängig verteilten Heizpositionen | wie #140; `heating.no-consumption` |
| **Warmwasser ohne Wärmezähler** | ebenso | **der ganze Anteil an Heiz- und Warmwasserkosten der Anlage**, bei `service` die Einzelbeträge im Topf ([R] VIII ZR 151/20: gekürzt wurde der gesamte Anteil, trotz HKV und Warmwasserzählern; R-A6, G-B9) | `heating.dhw-not-metered` |
| **Versäumte Zwischenablesung** (nur als Risiko) | ebenso | Anteil des betroffenen Mieters an den Heizkosten der Anlage | `heating.no-interim-reading` bei „versäumt“ (3.5); „bis zu“, weil die Rechtslage streitig ist |
| Fernablesbarkeit | `hkv.cut.remote-reading` | Anteil an den Heizkosten | nach 3.13 |
| Informationen § 6a | `hkv.cut.information` | Anteil an den Heizkosten | 8.8 |
| CO₂ | `co2.cut.missing` | „den gemäß der Heizkostenabrechnung auf ihn entfallenden Anteil an den Heizkosten“ ([G] § 7 Abs. 4 CO2KostAufG) | `co2.missing`, `co2.service-unsplit`, `co2.incomplete`, `co2.sum-check` … |

**Rundung:**

- Jeder Betrag ist round(Satz × Summe der gedruckten Heizzeilen des Mieters nach Abzugszeile), kaufmännisch. Grundlage ist bewusst der gedruckte und nicht der exakte Wert: § 7 Abs. 4 CO2KostAufG und § 12 Abs. 1 HeizkostenV meinen den Anteil, wie er in der Abrechnung steht. So rechnet auch der Bestand (#140), und die Golden-Tests bleiben gleich.
- Der Hinweis nennt zusätzlich „zusammen …“ als Summe der gerundeten Beträge.
- **Kein Betrag wird automatisch abgezogen.** Die Kürzung muss der Mieter erklären.

**„Nach CO₂-Abzug“** folgt dem Wortlaut beider Normen („der auf ihn entfallende Anteil“). Ohne CO₂-Angaben ändert sich keine Zahl.

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

**Umfang:** Die Probe läuft nur über die **Messdienstpositionen** des Topfs, also die Positionen mit Schlüssel `amounts` (W9). Jede andere Position im Topf, etwa eine Gutschrift des Versorgers oder eine Wartung mit anderem Schlüssel, ergibt `co2.pool-foreign-item` (hint).

**Was verglichen wird** (G-B3). S ist die **gedruckte Kostensumme** (5.5), und Betrag und S + L sind beide Kostensummen. Dazwischen liegt deshalb keine Rundung der Nutzerzeilen.

| Prüfung | Verlangt | Toleranz |
|---|---|---|
| `serviceDeducted` | Σ Messdienstpositionen = S + L | 1 ct (Rundung von L) |
| `serviceShown` | Σ Messdienstpositionen = S | 0 |
| beide | Σ eingetragene Einzel- und Eigenbeträge ≤ S | NE · 4 · 0,5 ct = NE · 2 ct |

**Wo S steht, und wenn man es nicht findet** (R6 der dritten Prüfung). Die Anleitung zeigt S je Messdienst an einer Musterabrechnung mit markierter Zeile: Techem („Summe der Nutzerkosten Heizungsanlage“, Muster vorhanden), ista, Brunata, Minol, KALO. Die Muster der vier Letztgenannten sind vor PR 6 zu beschaffen (öffentliche Musterabrechnungen der Messdienste); fehlt eines, nennt die Anleitung den Messdienst ohne Muster. Im Formular gibt es „Ich finde diese Zeile nicht“: Dann gilt S := Σ der Einzelbeträge aller Nutzeinheiten laut Messdienst (auch Leerstand, die Oberfläche fragt sie ab), die Probe wird zum hint `co2.sum-check-approx` mit Toleranz NE · 2 ct, und die CO₂-Buchung wird ausgeführt. Die Lücke „nein, obwohl abgezogen“ wird damit nicht größer, denn sie war schon mit exaktem S nicht zu erkennen (7.4).

Zur Toleranz der dritten Prüfung:

- NE ist die Zahl der Nutzeinheiten laut Messdienst (`service_units_count`).
- Vier Rundungen je Nutzer entstehen, weil Techem Grund- und Verbrauchsanteil je Heizung und Warmwasser getrennt ausweist ([M] Techem-Musterabrechnung, Gegenprüfung G).
- Leerstand und fremde Einheiten zählen mit, denn auch ihre Zeilen runden.

**Wenn die Probe scheitert,** wird keine CO₂-Buchung für diese H ausgeführt: kein `co2Share` und keine Abzugszeilen. Die Mieter zahlen ihre Einzelbeträge wie eingetragen. Der Text nennt beide Deutungen mit Zahlen: „Ihre Positionen ergeben 3.845,51 €. Mit Abzugszeile müssten es S + L = 3.933,01 € sein, ohne Abzugszeile S = 3.845,51 €. …“ Er nennt außerdem die 3 % je Mieter.

| Irrtum | Was die Probe sieht |
|---|---|
| „Ja“ bei Bruttobeträgen | Betrag = S, verlangt S + L |
| „Ja“ bei Nettobetrag der Position (#209) | Betrag = S, mit dem richtigen Betrag im Text |
| „Nein“, obwohl abgezogen, Betrag brutto | Betrag = S + L, verlangt S |
| Leerstand, fremde Einheiten | spielen keine Rolle |

### 7.4 Vorwegabzug: Zerlegung des Vermieterrests (`serviceDeducted`)

Den Mietern wird nichts abgezogen. In der Position `service_cost_item_id` zerlegt `landlordRecipients` den Rest nach Einzel- und Eigenbeträgen:

1. **L_self**, der private Teil:
   - Er ist der Wert laut Messdienst, sonst die Näherung L · selfNet / S. Die Näherung ist exakt nur bei einem linearen Schlüssel; der Rechenweg nennt sie „Näherung“.
   - **Er wird exakt gebucht wie `selfRaw`, nie über `take()`** (G-B2, #203): Der Eigenanteil ist immer sein exakter Wert, sonst erschiene Privates in der Steuer als abziehbar.
   - Er steht in `selfUse`.
2. **`co2Share`** = L − L_self, über `take()`, also durch den Rest begrenzt. Das ist der abziehbare Teil.
3. **`amountsRest`** = was übrig bleibt (Leerstand, außerhalb). Negativ wird `amountsRest` nur, wenn der Rest kleiner ist als Eigenbetrag plus L_self (N7); dann bleibt es sichtbar wie bei Überschneidungen (#203), und `co2.sum-check` meldet den Datenfehler. Reicht der Rest nur nicht für L, kappt `take()` den `co2Share`; bei bestandener Probe ist diese Kappung höchstens NE · 2 ct.

W10 der ersten Fassung (beide anteilig kürzen) ist damit aufgehoben.

**Rechenfehler der ersten Fassung (G-B2), nachgerechnet:** Rest 60 €, L_self 20 €, `co2Share` 80 €.

- Erste Fassung: L_self 12 €, `co2Share` 48 €. 8 € Privates wurden abziehbar.
- Jetzt: L_self **20 €** exakt, `co2Share` min(80, 60 − 20) = **40 €**, `amountsRest` 0.

Testfall in 12.2.

**Restlücke, abgesichert mit G und V:** Bei `serviceShown` und |G − V − L| ≤ 1 ct + Rundung von L erscheint `co2.probably-deducted` (warning). Die verbleibende Lücke („nein“ und Betrag = S) hält ein Test fest. #103 liest die Abzugszeile künftig aus.

**Ausweis:**

- je Mieter „in Ihren Heizkosten enthalten“ und „vom Vermieter übernommen“ aus `co2_tenant_reliefs`, sonst L · Netto_t / S (Anzeige ohne Buchung);
- Einstufung und Grundlagen laut Messdienst;
- „bereits abgezogen“.

**Beispiel A (Techem-Muster):**

- 3.540,00 €, Abzugszeile −87,50 € (250,00 € · 35 %).
- S = 3.845,51 €, Betrag 3.933,01 €. Probe bestanden.
- `co2Share` 87,50 €, Werbungskosten 3.933,01 €.

**Beispiel B (Eigennutzung):**

- S = 2.900 €, L = 100 €, eigene Wohnung netto 600 €.
- L_self 20,69 €, `co2Share` 79,31 €, Eigenanteil 620,69 €.
- Mit L_self laut Messdienst 25,00 €: 75,00 € und 625,00 €.

**Beispiel C (Leerstand statt Eigennutzung, G-D2):**

- Wie B, aber die Wohnung mit 600 € steht **leer** (keine Eigennutzung) und ist nicht eingetragen.
- `co2Share` 100 €, `amountsRest` 600 €.

### 7.5 Nur ausgewiesen (`serviceShown`)

Hier gibt es Abzugszeilen je Mieter wie bei eigener Aufteilung (9.4):

- mit den Einzelwerten aus `co2_tenant_reliefs`, geprüft auf Σ r_t ≤ L und r_t ≤ x_t, sonst `co2.reliefs-invalid` (error) und proportional;
- fehlt ein Einzelwert, `co2.reliefs-missing` (warning), und dieser eine Wert wird proportional ergänzt.

Der Fall ist so bei Eigentümergemeinschaften, die nur informativ ausweisen ([M] Marktvergleich: ista- und Techem-Variante 2, übernommen).

### 7.6 Messdienst hat nicht aufgeteilt (`selfAfterService`)

**Ohne Lieferung:** Warnung `co2.service-unsplit` mit 3 % je Mieter, denn die Kürzung ist sicher ([G] § 7 Abs. 4 CO2KostAufG).

**Mit der Gasrechnung als Lieferung** (`fuel_deliveries` ohne Kostenposition) teilt Mietfuchs selbst auf (9.4):

- **E** wird auf H umgerechnet (3.2, 3.3).
- **C** ist der CO₂-Preis der Lieferungen, **die der Messdienst angesetzt hat** (`used_by_service`, Vorgabe ja), und zwar ganz, nicht abgegrenzt (G-A3). Der Messdienst hat sie als „Anlieferung“ voll verteilt, und die Mieter haben sie bezahlt.
- G (Σ der angesetzten Lieferungen) und V (Brennstoff in der Verteilung des Messdienstes) prüfen das: Weichen sie um mehr als 1 € voneinander ab, gibt es den hint `co2.service-fuel-mismatch` („Der Messdienst hat andere Brennstoffkosten angesetzt; prüfen Sie, welche Rechnungen er verwendet hat“). Die Grenze von 1 € ist eine Festlegung ohne Rechtsfolge (15.2 F6).
- Danach gilt der hint `co2.service-unsplit-healed` mit „bis zu 3 %“ (15.1 Nr. 3).

**Ausdruck** „CO₂-Angaben für den Messdienst“ (#210, PR 17).

**Beispiel F13:** Gasrechnung 15.03.2025–14.03.2026, C = 600 €, Stufe 40 %, H = Mai–April. Die Entlastung beträgt **240,00 €**, nicht 203,69 € (3.3).

### 7.7 Warmwasser beim Messdienst (#211)

- Die Messdienstabrechnung nennt, wie der Warmwasseranteil ermittelt wurde. Mietfuchs fragt das als Angabe ab (`heating_periods.dhw_method`).
- Bei einer Formel ohne bestätigten unzumutbaren Aufwand gibt es `heating.dhw-not-metered` (warning).
  - Grundlage: [R] VIII ZR 151/20, geprüft 05.10.
  - Der Hinweis nennt 15 % je Mieter auf **seine Einzelbeträge im Topf**, also den ganzen Anteil an Heiz- und Warmwasserkosten (R-A6, G-B9).
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

**Elektronische HKV setzen am Stichtag zurück** und speichern den Stichtagswert ([M] ista-Gerätebeschreibung). Erfasst wird das wie ein Zählerwechsel: `replacement: true`, `oldEndValue` = Stichtagswert, `value` = 0. Weicht der Gerätestichtag vom Beginn von H ab, gibt es `heating.device-cutoff` (warning). HKV sind keine eichpflichtigen Messgeräte; für sie gibt es kein Eichdatum (3.12). Welche Ablesetoleranzen und Bewertungsregeln für selbst abgelesene HKV gelten, regelt die technische Regel: ⟨Norm offen: VDI 2077⟩; bis dahin gilt 3.5.

### 8.2 Brennstoffkosten: Verbrauch statt Lieferung

**Grundlage:** [G] § 7 Abs. 2 HeizkostenV („verbrauchten Brennstoffe“) und [R] VIII ZR 156/11. Beides gilt für **jede** Methode mit eigenen Brennstoffrechnungen, also für `self` **und `manual`** (R2 der dritten Prüfung). Beim Messdienst führt dieser den Bestand.

**Gas, Fernwärme, Wärmepumpenstrom:**

- F_H = Σ_d (fester Teil_d · Tagesanteil_d(H) + verbrauchsabhängiger Teil_d · Anteil_d(H)), mit dem Anteil nach 3.2.
- Die Positionen einer Lieferung gehören zu der H, die das **Ende** des Rechnungszeitraums enthält (5.4). **Der Teil außerhalb gehört deshalb immer in eine frühere Heizperiode H−1**, nie in eine spätere (N1).
- Er wird in H hinaus- und in H−1 hereingebucht, beides über `fuelCarry`.

**Öl, Flüssiggas, Pellets, Holz: Bestandsrechnung**, einmal für Kosten und CO₂, bei `self` und `manual`.

- Der Anfangsbestand ist vorbelegt aus dem bewerteten Endbestand von H−1. Ist H−1 abgeschlossen, gilt der eingefrorene Wert.
- **Der Endbestand wird zu den jüngsten Lieferungen bewertet, verbraucht wird das Älteste zuerst** ([M] Minol, [Restbewertung](https://www.minol.de/restbewertung.html): „Der zuerst gelieferte Brennstoff wird als erstes verbraucht“). Minol beruft sich auf BGH VIII ZR 298/80 (**ungeprüft**, vor PR 8 lesen). Die Bestandsrechnung selbst ist bei [M] Brunata und Techem belegt.
- **Peildatum** (`heating_periods.closing_measured_on`, L2): Liegt die Peilung des Tanks neben dem Ende von H, gilt der Wert wie abgelesen, mit dem Hinweis `fuel.stock-date-differs` (wie 3.5).
- Verbrauchte Kosten = €₀ + Σ Lieferungen − €₁, ebenso kg und CO₂-€. Gerundet wird je Posten auf den Cent bzw. 0,1 kg.
- Q₁ > Q₀ + Σ q ergibt `fuel.stock-invalid` (error).
- **Ohne Bestand:**
  - `self`: `fuel.stock-missing` (error); die Anlage wird nicht verteilt ([R] VIII ZR 156/11).
  - `manual`: `fuel.manual-by-delivery` (warning). Verteilt wird nach Lieferung wie heute, denn ohne Angaben ändert Mietfuchs keine Zahl. Der Text nennt beide Folgen: Die Kosten sind nach VIII ZR 156/11 angreifbar, und die CO₂-Einstufung beruht auf gelieferten statt verbrauchten kg (§ 5 Abs. 1 CO2KostAufG; N9).
  - `selfAfterService`: warning mit 3 %, keine CO₂-Aufteilung ohne Bestand.
- Der Ausweis nennt, dass Altbestand mit Rechnung vor 2023 mit seinen kg die Stufe hebt, aber keine CO₂-Kosten trägt (§ 11 Abs. 2 S. 2; Hinweis 6 der dritten Prüfung).

**Wie das in die Abrechnung kommt:**

- Die Rechnungen bleiben Kostenpositionen in voller Höhe in ihrem Zeitraum. Steuer und Belegarchiv stimmen damit.
- Die Differenz zum Verbrauch steht als zwei Zeilen je Anlage, „aus Vorrat bzw. aus einer Rechnung des nächsten Zeitraums“ (+) und „im Vorrat bzw. für den vorigen Zeitraum“ (−). Mit Gegenzeile `fuelCarry` beim Vermieter.
- Verteilt werden die Zeilen bei `self` mit den Gewichten des Ziels `both`, bei `manual` mit dem Schlüssel der Brennstoffposition.
- Σ aller Zeilen = Σ Kostenpositionen, über die Zeiträume hinweg.

**Abgeschlossene Heizperioden und noch fehlende Rechnungen** (G-A4, G-C10, N1)

**Das Problem.** Bei einer Gasrechnung von März bis März fehlt beim Abschluss von H oft die Rechnung, die das Ende von H abdeckt. Sie kommt erst im Folgejahr. Ohne Regel trüge der Vermieter deren Teil für H selbst, bei Rechnungen von März bis März jedes Jahr rund 15 % der Gaskosten (N1).

**Wie die Praxis das löst:**

- [M] ProCalor: „den Zählerstand zum Ende des Abrechnungszeitraums festhalten und beim Energieversorger eine Zwischenabrechnung oder zeitanteilige Abgrenzung anfordern“.
- [M] Minol: Zwischenabrechnung des Versorgers zum Stichtag oder Angleichung der Zeiträume.
- [M] BMGEV: Bei Gas ergeben sich die Brennstoffkosten „aus der Differenz der Zählerstände zu Beginn und Ende des Abrechnungszeitraums“ (alle geprüft 05.10.).

**Was das Recht erlaubt:**

- [R] VIII ZR 156/11 Rn. 14: Abrechnung nach dem Leistungsprinzip „gegebenenfalls aufgrund einer sachgerechten Schätzung“.
- [G] § 556 Abs. 3 S. 3 BGB: Eine Nachforderung nach Fristablauf ist ausgeschlossen, „es sei denn, der Vermieter hat die verspätete Geltendmachung nicht zu vertreten“.
- [R] BGH 12.12.2012, VIII ZR 264/12 (sekundär, [LTO](https://www.lto.de/recht/nachrichten/n/bgh-urteil-viii-zr-264-12-betriebskosten-nachberechnung-verjaehrung/print.html)): Der Vermieter darf sich die Nachberechnung einzelner Positionen vorbehalten, soweit er ohne Verschulden an einer rechtzeitigen Abrechnung gehindert ist.

**Regel in Mietfuchs**, in dieser Reihenfolge:

1. **Zählerstand zum Stichtag.** Die Ablesungsampel fragt den Versorgungszähler der Anlage zum Ende jeder H ab („Lesen Sie Ihren Gaszähler am 30.04. ab“). Die Anleitung empfiehlt, mit dem Stand beim Versorger eine Zwischenrechnung anzufordern. Kommt sie, ist sie Stufe 2 aus 3.2, und es fehlt nichts.
2. **Sonst Schätzung mit Vorbehalt.**
   - Fehlt beim Abschluss die Rechnung für einen Teil von H, legt Mietfuchs eine **geschätzte Lieferung** an (`fuel_deliveries.estimated = true`, ohne Kostenposition).
   - Menge: aus dem eigenen Zählerstand, sonst nach Gradtagen aus der letzten Rechnung.
   - Preis: Arbeitspreis der letzten Rechnung für den verbrauchsabhängigen Teil, fester Teil nach Tagen; kg und CO₂-€ im selben Verhältnis.
   - Sie wird in H hereingebucht (`fuelCarry`) und mit dem Abschluss eingefroren.
   - Die Abrechnung sagt: „Die Brennstoffkosten vom 15.03. bis 30.04.2026 sind geschätzt, weil die Rechnung des Versorgers noch nicht vorliegt. Eine Nachberechnung bleibt vorbehalten.“
   - Das ist die Vorgabe im Dialog „Trotzdem abschließen?“. Er nennt beide Beträge: geschätzt X €, oder ohne Schätzung tragen Sie X € selbst.
3. **Kommt die echte Rechnung** (in H+1), bucht H+1 ihren Teil für H hinaus, und zwar den **tatsächlichen**. Den abgeschlossenen Zeitraum H ändert das nicht. Die Differenz (tatsächlich − geschätzt) steht in H+1 als Vermieterteil `fuelEstimateDiff`; so zahlt kein Mieter von H+1 für H.
   - **Vor Ablauf der Frist von H** (Regelfall: die Folgerechnung kommt im März/April, die Frist von H endet bei Weg a am 30.04. des Folgejahres, bei Weg b am 31.12., bei Weg d wie Weg a): Eine Berichtigung ist möglich. Das ist der **Umkehrschluss** aus [R] BGH 17.11.2004, VIII ZR 115/04 (NJW 2005, 219), Leitsatz: „Eine Korrektur des Fehlers zu Lasten des Mieters ist nach Ablauf der Abrechnungsfrist gemäß § 556 Abs. 3 S. 3 BGB ausgeschlossen, es sei denn, der Vermieter hat den Fehler nicht zu vertreten.“ In der Literatur ist der Umkehrschluss unstreitig. Hinweis `fuel.estimate-settled`: „Die berichtigte Abrechnung {H} muss den Mietern bis {Frist} zugehen“ (§ 556 Abs. 3 S. 2: maßgeblich ist der Zugang; B9).
   - **Nach Ablauf der Frist:** nur, wenn der Vermieter die Verspätung nicht zu vertreten hat ([G] § 556 Abs. 3 S. 3 BGB; Vorbehalt [R] VIII ZR 264/12, Leitsatz: „soweit er ohne Verschulden an einer rechtzeitigen Abrechnung gehindert ist“), und alsbald, in der Regel **binnen drei Monaten** nach Wegfall des Hindernisses ([R] BGH 05.07.2006, VIII ZR 220/05, sekundär). Wer freiwillig vor dem Fristende abgeschlossen hat, ist nicht „gehindert“; der Hinweis sagt das.
   - **Negative Differenz** (Schätzung zu hoch, A4): Die Mieter von H haben zu viel getragen. Ein unbedingter Rückzahlungsanspruch folgt daraus nicht, denn Einwendungen sind binnen zwölf Monaten nach Zugang zu erheben (§ 556 Abs. 3 S. 5, 6 BGB), und ob der Vorbehalt der Schätzung daran etwas ändert, ist nicht entschieden. Sicher ist: Eine Berichtigung zugunsten der Mieter ist jederzeit zulässig. Hinweis `fuel.estimate-overcharged` (**warning**): „Die Mieter von {H} haben {Betrag} zu viel getragen ({Beträge je Mieter}). Eine Gutschrift ist jederzeit zulässig und wird empfohlen.“ Weg: Abrechnung H wieder öffnen oder Gutschrift erfassen. Bis dahin steht der Betrag als negatives `fuelEstimateDiff` beim Vermieter (B9).
   - **Wiederöffnen von H** (#56): Die eingefrorenen Werte von H (`fuel_carry_frozen`) entfallen, die geschätzte Lieferung wird als „ersetzt“ markiert und nicht mehr gelesen, H liest den tatsächlichen Teil der echten Rechnung. Ist H+1 noch offen, verschwindet dort `fuelEstimateDiff`. Ist H+1 schon abgeschlossen, bleibt sein eingefrorenes `fuelEstimateDiff` stehen; es betraf nur den Vermieter, `deviation` von H+1 zeigt es.
   - Ob eine Nachberechnung nach Fristablauf trägt, wenn eine Zwischenrechnung möglich gewesen wäre, ist offen (15.1 Nr. 19).
4. **Ohne Schätzung**, also wenn der Vermieter sie abwählt, geht der Teil als `fuelClosedPeriod` an den Vermieter, wie bisher.

**Einfrieren und Sperren:**

- Der Abschluss einer H speichert je Lieferung, auch je geschätzter, was H herein- und hinausgebucht hat (`fuel_carry_frozen`), ebenso den bewerteten Endbestand. Eine spätere H liest das nicht neu.
- Mengen, Zeiträume, Beträge und `share_permille` einer echten Lieferung, deren gebuchter Teil in einer abgeschlossenen H eingefroren ist, sind gesperrt (409); ebenso **Ablesungen des Versorgungszählers mit Datum in einer abgeschlossenen H** (A10). Das gilt nicht für den Teil, der nur geschätzt war.

**Rechenbeispiele (N1, berichtigte Richtung), Testfälle in 12.2:**

Gasrechnung 6.500 € für 15.03.2025–14.03.2026, Position in H = `2025-05`; Teil für H−1 = `2024-05` (15.03.–30.04.2025) nach Gradtagen 151,29 ‰ = 983,39 €.

| Fall | Lage | Ergebnis |
|---|---|---|
| a | H−1 offen, als die Rechnung kommt (sie datiert vom März 2026; Frist von H−1 bei Weg a 30.04.2026, bei Weg b 31.12.2026) | H−1 bucht +983,39 € herein, H −983,39 € hinaus; H trägt 5.516,61 €. Summe 6.500,00 € |
| b | H−1 vorher abgeschlossen, mit Schätzung aus der Vorjahresrechnung (6.000 € · 151,29 ‰ = **907,74 €**) | H−1 hat 907,74 € eingefroren. H bucht die tatsächlichen 983,39 € hinaus; `fuelEstimateDiff` 75,65 € beim Vermieter (Nachberechnung möglich). Summe 5.516,61 + 907,74 + 75,65 = 6.500,00 € |
| c | H−1 abgeschlossen ohne Schätzung | `fuelClosedPeriod` 983,39 € beim Vermieter |
| d | wie a, nach dem Abschluss von H−1 trägt der Vermieter einen Zählerstand des Versorgungszählers mit Datum in H−1 nach (Anteil wäre 200 ‰) | 409 (Ablesung in abgeschlossener H gesperrt); H−1 bleibt bei den eingefrorenen 983,39 €. Die erste Fassung hätte neu gerechnet: 316,61 € mehr als die Rechnung. |
| e | H−1 abgeschlossen mit Schätzung **1.050,00 €**, tatsächlich 983,39 € | `fuelEstimateDiff` **−66,61 €**, `fuel.estimate-overcharged` mit den Beträgen je Mieter von H−1. Summe 5.516,61 + 1.050,00 − 66,61 = 6.500,00 € |
| f | wie b, dann H−1 wieder geöffnet (H offen) | H−1 liest 983,39 €, Schätzung ersetzt, `fuelEstimateDiff` in H entfällt |

Alle Fälle rechnen mit `fixed_cents = null`, also die ganzen 6.500 € nach Gradtagen, mit dem hint `fuel.fixed-unknown` (A4 Nr. 4).

**Beispiel Heizöl** (nachgerechnet, 300 m²; kg der Lieferung vom 10.10. exakt 6.690,75):

| Posten | Menge | kg CO₂ | Wert | CO₂-€ |
|---|---|---|---|---|
| Anfangsbestand (Rechnung 2022) | 2.000 l | 5.352,6 | 1.900,00 € | 0 € |
| Lieferung 15.03.2025 | 3.000 l | 8.028,9 | 3.150,00 € | 525,49 € |
| Lieferung 10.10.2025 | 2.500 l | 6.690,75 | 2.500,00 € | 437,91 € |
| Endbestand | 1.800 l | aus der Lieferung vom 10.10. | 1.800,00 € | |

**Ergebnis:**

- Kosten **5.750,00 €**, bezahlt 5.650,00 €, `fuelCarry` −100 €.
- E = **15.254,91 kg** → 50,8 → 80 %; ohne den Altbestand wären es 33,0 kg/m² und 50 %.
- C = **648,10 €**, L = **518,48 €**.
- Der Endbestand trägt 4.817,34 kg und 315,30 € nach 2026.

**Eigenanteil in Abrechnung und Steuer (N8):**

- `selfUsedShareCents` der Abrechnung enthält den Anteil der Eigennutzung am Übertrag, denn die Abrechnung zeigt den Verbrauch: bei ⅓ Eigennutzung 1.916,67 €.
- Die Steuer nimmt das Bezahlte mal Gewicht: 1.883,33 € (6.4).
- Die Steuerseite erklärt den Abstand: „33,33 € Unterschied: Brennstoff aus dem Vorrat des Vorjahres, steuerlich bereits 2024 abgeflossen.“
- Das ist die eine Stelle, an der Abrechnung und Steuer beim Eigenanteil auseinanderliegen dürfen. Ein Test hält sie fest.

### 8.3 Warmwasseranteil α (§ 9)

| Methode | Q | α |
|---|---|---|
| `heatMeter` (Regel, § 9 Abs. 2 S. 1) | gemessen | Q / Energie des verbrauchten Brennstoffs in kWh, wie abgerechnet; bei Wärmepumpe und Fernwärme mit Gesamtwärmezähler Q / gemessene Gesamtwärme |
| `volumeFormula` (§ 9 Abs. 2 S. 2, 3) | 2,5 · V · (t_w − 10), dann Faktor nach S. 6 | Q_Formel / **abgerechnete Energie des Erzeugers**: Kessel kWh laut Rechnung, Fernwärme gelieferte kWh laut Rechnung, **monovalente Wärmepumpe Strom-kWh** (F1 der dritten Prüfung: der Faktor 0,30 rechnet auf den Strom um; geteilt durch die Gesamtwärme wäre α um die Jahresarbeitszahl zu klein) |
| `areaFormula` (§ 9 Abs. 2 S. 4, 5) | 32 · A, dann Faktor nach S. 6 | wie `volumeFormula` |

**Heizwert und Brennstoffverbrauch.** Wird der Brennstoff in Litern, Kilogramm oder m³ abgerechnet, gilt B = Q / Hᵢ ([G] § 9 Abs. 3). Hᵢ kommt aus der Rechnung (`fuel_deliveries.heating_value`), die Tabelle nur hilfsweise und nur bei Heizkesseln (R-A13). Ohne Heizwert auf der Rechnung gibt es den hint `heating.heating-value-from-table`.

**Gemessenes Q gegen kWh nach Brennwert** (G-B1, **abgelehnt**). Die Gegenprüfung verlangt α = Q / E_Hᵢ, also 9.000 · 1,11 / 60.000 = 16,65 % statt 15,0 %. Der Wortlaut trägt das nicht:

- [G] § 9 Abs. 2 S. 6: „Die **nach den Zahlenwertgleichungen in Satz 2 oder 4 bestimmte** Wärmemenge (Q) ist 1. bei brennwertbezogener Abrechnung von Erdgas mit 1,11 zu multiplizieren …“.
- [G] § 9 Abs. 3 letzter Satz: „Soweit die Abrechnung über Kilowattstunden-Werte erfolgt, ist eine Umrechnung in Brennstoffverbrauch nicht erforderlich.“
- Beides geprüft 05.10. im Wortlaut.

Mietfuchs rechnet nach dem Wortlaut (15,0 %). Ob die technische Regel die gemessene Wärme gegen Hₛ oder Hᵢ stellt, bleibt offen: 15.1 Nr. 9, ⟨Norm offen: VDI 2077⟩. Der Lexikoneintrag zu `hotWaterShare` nennt beide Werte und den Grund.

**Weitere Regeln:**

- Mischanlagen (§ 9 Abs. 1 S. 5): nur `heatMeter` mit gemessener Gesamtwärme.
- Formel ohne `dhw_unmeasurable`: `heating.dhw-not-metered` (warning) mit 15 % auf den ganzen Anteil an Heiz- und Warmwasserkosten (6.5, [R] VIII ZR 151/20).

**Beispiel:** 60.000 kWh Hₛ, 200 m², 120 m³. Gemessen 9.000 kWh → **15,0 %**; Volumenformel → **27,75 %**; Flächenformel → **11,84 %**.

**Beispiel Wärmepumpe (F1, Testfall):** 120 m³, t_w = 60 °C → Q = 15.000 kWh · 0,30 = 4.500 kWh; Strom 12.000 kWh, Wärme 36.000 kWh. α = 4.500 / 12.000 = **37,5 %**; die zweite Fassung hätte 4.500 / 36.000 = 12,5 % gerechnet.

**Beleg zu F1 und eine Spannung** (A8): Der Wortlaut von § 9 Abs. 2 S. 6 Nr. 3 sagt nur „mit 0,30 zu multiplizieren“; § 9 Abs. 1 S. 2 verlangt bei Wärmepumpen die Aufteilung nach Anteilen am **Wärme**verbrauch. Entscheidend ist die Begründung, BT-Drs. 20/7619: Der Faktor gilt „für die Abrechnung von Strom für Wärmepumpen“ und ergibt sich aus einer Jahresarbeitszahl von 2,7 und dem Nutzungsgrad 0,8 in der Zahl 2,5 (0,8 / 2,7 ≈ 0,30). Das Formelergebnis ist also Strom, und α = Q · 0,30 / Strom.

**Wärmepumpe mit Wärmezähler am Warmwasser, aber ohne Gesamtwärmezähler:** Gemessene Wärme geteilt durch Strom ergäbe etwa das Dreifache. Mietfuchs rechnet dann nicht, sondern meldet `heating.heat-pump-dhw-basis` (error) mit der Bitte, einen Gesamtwärmezähler anzugeben oder die Formel zu wählen. Testfall in 12.2.

### 8.4 Nutzerwechsel (§ 9b)

Siehe 3.5. Gerechnet wird je Wohnung, dann je Nutzer (Mietverhältnisse, Leerstand, Eigennutzung).

| Kostenteil | Regel |
|---|---|
| Verbrauch | nach der Zwischenablesung, also dem Wert laut Gerät zum Wechsel oder dem abgelesenen Wert daneben, ohne Rückrechnung |
| Grundkosten Heizung | Gradtage (Vorgabe) oder Tage, je nach `change_split` |
| Grundkosten Warmwasser | Tage |
| keine Ablesung | alles nach § 9b Abs. 3, bei „versäumt“ mit Warnung und Risiko bis 15 % |

Lineare Interpolation eines Wärmestands gibt es nicht. Ein Test wird rot, sobald sie jemand einführt.

### 8.5 Grund- und Verbrauchskosten (§§ 7, 8, 10)

**Formel** je Topf T ∈ {Heizung, Warmwasser} mit Anteil p_T:

- Grund = K_T · (1 − p_T) · a_u / Σ a,
- Verbrauch = K_T · p_T · v_u / Σ v.

Die Fläche a ist beim Topf Heizung Wohn- oder beheizte Fläche (§ 7 Abs. 1 S. 5), beim Warmwasser immer Wohn- oder Nutzfläche (§ 8 Abs. 1; R-A21).

**Grenzen aus dem Register:** 50–70 %, über 70 nur mit `above_70_agreed` ([G] § 10).

- Bei `insulation_rule = applies` gilt zwingend 70 (§ 7 Abs. 1 S. 2). Die Regel setzt eine Öl- oder Gasheizung voraus.
- Bei Wärmelieferung gilt sie nicht: § 7 **Abs. 3** verweist nur auf Abs. 1 S. 1 und 3 bis 5 (R-A2, geprüft 05.10.).

**Wahl und Wechsel des Maßstabs** (R-A7, [G] § 6 Abs. 4, geprüft 05.10.). Die Wahl trifft der Eigentümer. Ändern darf er sie nur:

- „für künftige Abrechnungszeiträume durch Erklärung“,
- nach erstmaliger Bestimmung nur aus den Gründen Nr. 1–3,
- nur zum Beginn eines Zeitraums.

Für Mietfuchs heißt das:

- **Die Vorgabe ist der bisherige Anteil.** In der ersten Heizperiode fragt die Einrichtung „Mit welchem Anteil nach Verbrauch haben Sie bisher abgerechnet?“, Vorgabe 70.
- Eine Änderung gilt nur für eine H, die noch nicht begonnen hat, und ergibt `heating.key-change` (hint) mit dem Satz zur Erklärungspflicht und den Gründen des § 6 Abs. 4.
- 70 % ist also **nicht** „nie unzulässig“; die erste Fassung ist berichtigt.

**Kein Verbrauch:** Σ v = 0 ergibt `heating.no-consumption` (warning, 15 %). Dann wird nach Fläche verteilt.

### 8.6 Gewichte und Rundung

Aus 8.3 bis 8.5 entsteht je Empfänger r ein exakter Anteil an jedem Ziel:

- g_r(heating);
- g_r(water);
- g_r(both) = (1 − α) · g_r(heating) + α · g_r(water).

Jede Position mit Betrag A und Ziel z bekommt die Rohwerte A · g_r(z) und wird einmal verteilt (#202).

**Beispiel A** (aus #99, exakt nachgerechnet):

- Erdgas, drei Wohnungen, α = 15 %. K_H = 5.628,00 €, K_W = 1.032,00 €, 70/30.
- Exakte Summen: A **1.961,88**, B **2.615,84**, C1 **1.331,52995**, C2 **750,75005** (Wechsel in C zum 30.09.).
- Je Position verteilt: A 1.961,89, B 2.615,84, C1 1.331,52, C2 750,75; zusammen 6.660,00 €.

### 8.7 Schätzung (§ 9a)

- **Wann** ([G] § 9a Abs. 1: „wegen Geräteausfalls oder aus anderen zwingenden Gründen“; zwingend ist ein Grund erst, wenn der Vermieter den Fehler nicht mehr beheben kann, [R] VIII ZR 373/04, sekundär):
  - Gerät defekt;
  - Wert fehlt zu Beginn oder Ende von H, und kein Gerätespeicher hilft;
  - Zählerwechsel ohne Endstand;
  - negativer Verbrauch;
  - vom Vermieter als unbrauchbar markiert.
  - **Nicht:** verschiedene Ablesetage (3.5; R-A14, Z-B1).
- **Vorschlag:** die drei Wege des § 9a Abs. 1. Vorgabe ist der Durchschnitt des Gebäudes je m². Gespeichert werden Methode und Begründung.
- **Bestätigung:** unbestätigt `heating.estimate-unconfirmed` (warning), bestätigt `heating.estimated` (hint).
- **Schwelle:** Überschreitet die geschätzte Fläche 25 % der Fläche des Topfs, wird dieser Topf nur nach Fläche verteilt (§ 9a Abs. 2), mit `heating.estimate-over-25`.
  - Je Topf getrennt (15.1 Nr. 6).
  - Keine Kürzung nach § 12 (15.1 Nr. 7).
- **Was die Oberfläche vorher sagt** (N5): „Maßgeblich ist der Flächenanteil der betroffenen Wohnungen, hier {Anteil} %. In kleinen Häusern überschreitet oft schon eine Wohnung 25 %; bei vier gleich großen Wohnungen sind es genau 25 %, also keine Überschreitung.“ Der Dialog rechnet den tatsächlichen Anteil aus.

### 8.8 Ausweis und Pflichtangaben (§ 6a Abs. 3)

**Druckblock „Heizkostenabrechnung“** je Anlage und H:

- Kosten einzeln;
- Brennstoff mit Bestand oder Abgrenzung, die Stufe aus 3.2 benannt;
- α mit Methode;
- Grund und Verbrauch mit Gesamteinheiten und Preis je Einheit;
- eigene Werte samt Ablesungen und Faktoren (bei HKV je Gerät; bei der Einheitsskala muss der Faktor in der Abrechnung stehen, [M] Berliner Mieterverein, übernommen);
- Gradtagsanteile beim Wechsel;
- Schätzungen mit Methode;
- CO₂-Block (9.5);
- § 6a.

**§ 6a Abs. 3** ([G], geprüft 05.10. durch Gegenprüfung R):

| Nr. | Inhalt | Woher |
|---|---|---|
| 1 a | Anteil der Energieträger; bei Fernwärme Treibhausgasemissionen und Primärenergiefaktor | aus der Anlage bzw. abgefragt |
| 1 b | erhobene Steuern, Abgaben, Zölle | abgefragt |
| 1 c | Entgelte für Geräte, Eichung, Ablesung, Abrechnung | automatisch aus Teil `metering` |
| 2 | Kontaktinformationen | fester Text, jährlich geprüft (4.8) |
| 3 | Streitbeilegung bei Verbrauchervertrag | nur mit `consumer_contract` |
| 4 | Vergleich mit Durchschnittsnutzer | Hausdurchschnitt je m², so benannt. ⟨Norm offen: DIN 94680⟩, die laut Inhaltsangabe Vergleichswerte enthält |
| 5 | Vergleich mit dem vorhergehenden Zeitraum, witterungsbereinigt, grafisch, Wärme und Warmwasser | Klimafaktor des DWD je Postleitzahl, abgefragt (15.2 F5) |

**Fehlende Angaben** (R-A17, [G] § 12 Abs. 1 S. 3: „nicht oder nicht vollständig“):

- `heating.info-incomplete` (warning, 3 %) bei **jeder** fehlenden Angabe von Nr. 1 a–c, 2, 3 (bei Verbrauchervertrag), 4 und 5.
- **Erstes Jahr ohne Vorjahr:** Der Wortlaut kennt keine Ausnahme. Mietfuchs nennt „bis zu 3 %“ und kennzeichnet das als Auslegung (15.1 Nr. 14).
- **Monatliche Verbrauchsinformation** (§ 6a Abs. 1, 2): Ist ein Gerät fernablesbar (`remote_readable = true` bzw. `devices_remote` nicht `none`), gibt es `heating.monthly-info` (warning, „bis zu 3 %“), bis PR 22 sie erzeugt oder der Vermieter bestätigt, dass er sie anders liefert (etwa über das Portal des Messdienstes).
- Bei Verteilung ohne Verbrauch genügen Nr. 2 und 3 (§ 6a Abs. 5).

**Ableseergebnis** je Wohnung zum Stichtag als Ausdruck (§ 6 Abs. 1 S. 2).

### 8.9 Zweifamilienhaus, Ausnahmen, Eigentumswohnung

| Lage | Behandlung |
|---|---|
| Zweifamilienhaus (`zfh`) | Objektart als Beschreibung. **Die Ausnahme des § 2 hängt an Tatsachen** (`mayAgreeOtherwise`: höchstens zwei Wohnungen, eine selbst bewohnt). Ein Widerspruch gibt `property.kind-mismatch` (hint). „Abweichende Verteilung vereinbart“ ist nur dann wählbar und gibt keinen § 12-Hinweis. Ohne Vereinbarung gilt die Verordnung (15.1 Nr. 8). |
| § 11 | Eine gewählte Ausnahme führt zur Verteilung nach Fläche ohne § 12-Hinweis, dazu `heating.exemption` (hint, Nachweis aufbewahren). Für CO₂ gilt § 2 Abs. 7 CO2KostAufG: keine Aufteilung, außer eine Abrechnung ist vereinbart (übernommen). |
| Vermietete Eigentumswohnung | **Anlage mit `source = 'homeowners'` und `method = 'service'`** (F2 der dritten Prüfung): Die Gemeinschaft liefert die Abrechnung (§ 1 Abs. 2 Nr. 3 HeizkostenV). Damit gelten Heizperiode der Gemeinschaft, CO₂-Datensatz, Warmwasserangabe und Fernablesbarkeit wie beim Messdienst; alle Kürzungen gelten gegenüber dem Mieter, nur nicht zwischen Eigentümer und Gemeinschaft (§ 12 Abs. 1 S. 4). Schlüssel `amounts` (bzw. `external` nur, wenn die Gemeinschaft keinen Einzelbetrag nennt). **Betrag brutto wie beim Messdienst** (F3, #209): Hat die Gemeinschaft den CO₂-Anteil vorab abgezogen, ist das `serviceDeducted` mit Betrag S + L, und L steht als `co2Share` in den Werbungskosten; die zweite Fassung ließ hier den Nettobetrag erfassen. |

---

## 9. CO₂ selbst aufteilen (`self`, `selfAfterService`)

### 9.1 Anwendbarkeit

Grundlagen: [G] §§ 2, 3, 11 CO2KostAufG (geprüft 05.10.).

**Voraussetzungen:**

- Beginn von H ≥ 01.01.2023.
- Brennstoff mit Standard-Emissionsfaktor nach der EBeV, oder Wärmelieferung, für die der Lieferant CO₂ ausweist (§ 2 Abs. 1 S. 2, § 3 Abs. 4). Weist ein Fernwärmelieferant kein CO₂ aus, etwa bei rein erneuerbarer Erzeugung, ist C = 0 und nichts aufzuteilen (R-A28).
- Kein `district_ets_new`, kein § 9 `both`, keine Ausnahme nach § 11 HeizkostenV ohne vereinbarte Abrechnung (§ 2 Abs. 7).

**Ohne Datensatz:**

| Lage | Hinweis |
|---|---|
| Brennstoff nach EBeV, H ab 2023 | `co2.missing` (warning, 3 %) |
| Fernwärme ohne Datensatz | `co2.missing` mit dem Zusatz „falls Ihr Lieferant CO₂ ausweist“ |
| Ohne Anlage für das Jahr 2023 | `co2.missing-first-year` (hint) |
| Energie unbekannt | `co2.fuel-unknown` (hint) |

### 9.2 Einstufung

1. **Fläche** = `area_m2` oder die Vorgabe: Σ Wohnfläche der versorgten Wohnungen (`isDwelling`). Bei `perUnit` nur vermietete Wohnungen mit Lieferung ([G] § 5 Abs. 1 S. 2: „deren Gesamtwohnfläche“). Die Herkunft wird ausgewiesen.
   - **Gewerbe im Wohngebäude** (L1): § 6 Abs. 1 CO2KostAufG erfasst auch „Räume, die keine Wohnräume sind, in einem Wohngebäude“. Der Gewerbemieter bekommt `co2Relief` nach Stufen wie die übrigen; ob seine Nutzfläche in die Einstufungsfläche gehört, ist Teil von 15.1 Nr. 1 (Vorgabe: ja, wie die Fläche des Messdienstes). Optierte Umsatzsteuer beim Gewerbemieter ist Nicht-Ziel (16).
   - Welche Fläche gemeint ist, definiert das Gesetz nicht ([G] übernommen, #85).
   - Im Zweifel nimmt Mietfuchs die Fläche des Messdienstes, damit beide Angaben übereinstimmen (15.1 Nr. 1).
2. **E** nach 3.2/3.3 bzw. 8.2. **Wert** = round(E / Fläche, 1). Das Register sagt die Stellen; gerundet wird kaufmännisch mit 1e-9 Toleranz gegen Gleitkommarauschen.
3. **Kürzung der Tabelle** bei H < zwölf Monate (3.9).
4. **Stufe** aus dem Register, unten einschließend. Danach § 8 (500 ‰) und § 9 (× 0,5 bzw. keine). Auf § 9 kann sich der Vermieter nur berufen, wenn er dem Mieter die Umstände nachweist ([G] § 9 Abs. 3, R-A29); `co2.restriction` sagt das. Ab 2028 und bei Anlage nach § 43 Abs. 1 GModG gilt § 5a anteilig, im selbst bewohnten Zweifamilienhaus außerhalb angespannter Märkte nicht (§ 5d Abs. 3; 3.9).
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

**Rechtsgrundlage** ([G] § 7 Abs. 1 CO2KostAufG, geprüft 05.10.):

- **S. 1:** Der Vermieter berechnet Ausstoß und Kosten „und [zieht] den auf den Vermieter entfallenden Anteil ab“.
- **S. 2:** Er „berechnet sodann den auf den einzelnen Mieter entfallenden Anteil an den Kohlendioxidkosten gemäß der Vereinbarung … über die Verteilung der Heiz- und Warmwasserkosten auf Grundlage der §§ 6 bis 10 HeizkostenV“.

Die CO₂-Kosten sind Teil der Brennstoffkosten. Der Anteil des Mieters folgt deshalb dem **Schlüssel des Brennstoffs**, nicht seinem Anteil an allen Heizpositionen (R-A5, G-B5). Der bved beschreibt den Abzug von den Kosten vor der Verteilung ([M] bved-FAQ, sekundär).

**x_t, der Anteil des Mietverhältnisses am Brennstoff:**

| Methode | x_t | Hinweis |
|---|---|---|
| `self` | exakter Anteil an den Positionen mit `heating_part = 'fuel'` (Gewicht g_r(both) bzw. das Ziel der Brennstoffposition) | – |
| `manual` | exakter Anteil an den Positionen mit `fuel_delivery_id` **oder `heating_part = 'fuel'`** (B8) | – |
| `manual` ohne beides | Anteil am ganzen Topf | `co2.share-approximated` (hint): „Näherung, weil keine Position als Brennstoff gekennzeichnet ist“ |
| `selfAfterService` | Anteil an den Messdienstbeträgen im Topf (Heiz- und Warmwasserkosten je Nutzer) | `co2.share-approximated`: Der Messdienst weist den Brennstoffanteil je Nutzer nicht aus. Techem verteilt den CO₂-Anteil nach dem Anteil an Heiz- und Warmwasserkosten einschließlich der übrigen Heizkosten ([M] Marktvergleich 3.3, übernommen). |
| `serviceShown` | Einzelwerte laut Messdienst (7.5); fehlt einer, wie `selfAfterService` | – |

**Formel:**

- r_t = ‰/1000 · C_H · x_t / F, mit F = Summe der Brennstoffpositionen (bzw. des Topfs bei der Näherung).
- R = round(Σ r_t), verteilt mit `distributeCents`. Die Zeile `co2Relief` trägt −r_t, der Vermieter `co2Share` R.
- L − R entfällt auf Eigennutzung, Leerstand, Pauschale und Wohnungen außerhalb.
- C > F oder kein Brennstoff im Topf: `co2.exceeds-heating` (error).

**Rechenfehler der ersten Fassung (G-B5), nachgerechnet:**

- Brennstoff 9.000 € nach Verbrauch, Messkosten 1.000 € nach Einheiten (drei Wohnungen), Mieter A verbraucht 50 %, L = 464,27 €.
- Erste Fassung (Topf): 464,27 · 4.833,33 / 10.000 = **224,40 €**.
- Jetzt (Brennstoff): 464,27 · 4.500 / 9.000 = **232,14 €**.

Testfall in 12.2.

**Beispiel B1** (Brennstoffpositionen ohne weitere Heizpositionen, deshalb unverändert):

- 24.105,6 kg / 600 m² = 40,2 → 60 %. C = 773,79 €, L = 464,27 €.
- Bruttobeträge 3.600 / 3.000 / 2.400 €. Verteilt **185,71 / 154,76 / 123,80 €**.

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

**Zeiträume:**

| Code | Stufe | Betrag | PR |
|---|---|---|---|
| `period.short` | hint (färbt nicht) | – | 3 |
| `period.item-outside` | warning | – | 3 |
| `period.heating-mismatch` | warning | – | 3 |
| `period.split-by-days-meter` | hint | – | 3 |
| `period.heating-differs` | hint (färbt nicht) | – | 5 |
| `period.heating-only-statement` | **warning** | empfohlene Frist | 5 |
| `prepayment.heating-share-missing` | hint | – | 5 |
| `period.no-heating-period` | warning | – | 5 |

**Brennstoff:**

| Code | Stufe | Betrag | PR |
|---|---|---|---|
| `fuel.share-by-degree-days` | hint | – | 7 |
| `fuel.uncovered` | warning | fehlende Tage, ‰ | 7 |
| `fuel.manual-beyond-period` | warning | – | 7 |
| `fuel.closed-period-part` | hint | Betrag | 7 |
| `fuel.estimated` | hint (Vorbehalt im Ausdruck) | geschätzter Betrag | 7 |
| `fuel.estimate-settled` | warning | Differenz; vor oder nach Fristablauf | 7 |
| `fuel.estimate-overcharged` | warning | Gutschrift je Mieter | 7 |
| `heating.heat-pump-dhw-basis` | error | – | 11 |
| `fuel.fixed-unknown` | hint | – | 7 |
| `fuel.stock-date-differs` | hint | – | 8 |
| `heating.change-split-time` | hint | beide Beträge | 10 (bei `manual` wirkt `change_split` erst mit `heating_target`) |
| `prepayment.no-suggestion` | hint (zwei Texte: Kennzeichnung fehlt, Lieferung) | – | 3 |
| `co2.sum-check-approx` | hint | – | 6 |
| `fuel.stock-missing` | error bei `self`, warning (3 %) bei `selfAfterService` | – | 8, 10 |
| `fuel.manual-by-delivery` | warning | – | 8 |
| `fuel.stock-invalid` | error | – | 8 |
| `fuel.before-2023` | hint | – | 8 |

**CO₂:**

| Code | Stufe | Betrag | PR |
|---|---|---|---|
| `co2.missing` | warning | 3 % je Mieter | 6 |
| `co2.missing-first-year`, `co2.fuel-unknown` | hint | „falls …: 3 %“ | 6 |
| `co2.service-unsplit` | warning | 3 % | 6 |
| `co2.incomplete` | warning | 3 % | 6 |
| `co2.sum-check` | error | beide Deutungen, 3 % | 6 |
| `co2.pool-foreign-item` | hint | – | 6 |
| `co2.probably-deducted` | warning | – | 6 |
| `co2.stage-mismatch` | hint | – | 6 |
| `co2.reliefs-invalid` | error | – | 6 |
| `co2.reliefs-missing` | warning | – | 6 |
| `co2.service-unsplit-healed` | hint | „bis zu 3 %“ | 7 |
| `co2.service-fuel-mismatch` | hint | – | 7 |
| `co2.share-approximated` | hint | – | 7 |
| `co2.exceeds-heating` | error | 3 % | 7 |
| `co2.pool-keys` | hint | – | 7 |
| `co2.restriction` | hint, mit Nachweispflicht (§ 9 Abs. 3) | – | 7 |
| `co2.non-residential` | hint | – | 7 |
| `co2.short-period-agreed` | hint | – | 7 |
| `co2.item-spans-plants` | error | – | 9 |
| `co2.cost-implausible` | hint | – | 17 |
| `co2.half-split` | hint | – | 18 |
| `co2.half-split-two-family` | hint | – | 18 |
| `co2.refund-late`, `co2.refund-not-next` | hint | – | 19 |
| `co2.refund-due` | warning | – | 19 |

**Heizung:**

| Code | Stufe | Betrag | PR |
|---|---|---|---|
| `heating.remote-reading` | warning bei `false` und Pflicht nach 3.13, sonst hint | 3 % bzw. „bis zu 3 %“ | 4 |
| `heating.dhw-not-metered` | warning | 15 % auf Heiz- und Warmwasserkosten | 6 (service), 11 (self) |
| `heating.interim-reading-off` | hint, ab einem Monat im Winter warning | – | 10 |
| `heating.no-interim-reading` | hint bei „nicht möglich“, **warning** bei „versäumt“ | bei „versäumt“: bis zu 15 % | 10 |
| `heating.reading-dates-differ` | hint, ab einem Monat im Winter warning | – | 10 |
| `heating.no-consumption` | warning | 15 % | 10 |
| `heating.dhw-share-invalid` | error | – | 10 |
| `heating.target-invalid` | error | – | 10 |
| `heating.change-fee` | hint | – | 10 |
| `heating.key-change` | hint | – | 10 |
| `heating.dhw-share-implausible` | hint | – | 11 |
| `heating.heating-value-from-table` | hint | – | 11 |
| `heating.device-cutoff` | warning | – | 12 |
| `heating.mixed-capture`, `heating.hca-factor-missing` | error | – | 12 |
| `heating.estimate-unconfirmed` | warning | – | 13 |
| `heating.estimated` | hint (färbt nicht) | – | 13 |
| `heating.estimate-over-25` | hint | – | 13 |
| `heating.info-incomplete` | warning | 3 % | 14 |
| `heating.monthly-info` | warning | bis zu 3 % | 14, 22 |
| `heating.insulation-rule-unknown` | hint | – | 14 |
| `heating.exemption` | hint | – | 14 |
| `heating.operating-power-double` | warning | Betrag | 15 |
| `heating.contracting` | hint | – | 16 |

**Sonstige:**

| Code | Stufe | Betrag | PR |
|---|---|---|---|
| `meter.calibration-overdue` | warning (nicht für HKV) | – | 21 |
| `property.kind-mismatch` | hint | – | 4 |
| `law.value-overridden` | hint | – | 17 |

**Plausibilitätsgrenzen** ohne Quelle (`heating.dhw-share-implausible`: α unter 5 % oder über 50 %; `co2.service-fuel-mismatch`: 1 €) sind nur ein „bitte prüfen“ ohne Rechtsfolge (15.2 F6).

**Ankündigung:** `co2.missing` und `co2.fuel-unknown` färben die Ampel und erscheinen für alle Bestandsnutzer mit Heizposition ab 2023. Sie stehen im CHANGELOG und in der Anleitung.

### 10.2 Regelverzeichnis

Die qualitativen Regeln wandern mit den Parametern ins Register (4.2).

**Neu:**

| Regel | Norm |
|---|---|
| `co2-split` | §§ 5, 7, 11 CO2KostAufG |
| `co2-non-residential` | § 8 |
| `co2-restriction` | § 9 |
| `co2-half-split` | §§ 5a, 5b, 5d, ab 2028-01-01 (Biobrennstoff ab 2029-01-01) |
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
| `heating-reading-date` | [R] OLG Schleswig RE 04.10.1990; [G] § 9a; [R] VIII ZR 373/04 |
| `heating-key-change` | § 6 Abs. 4 HeizkostenV |

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
   - Wird Weg d gewählt (oder später ein- oder ausgeschaltet), folgt die Vorschau zum Aufteilen der Vorauszahlung: X, jede Stufe, Jahreskorrekturen offener Zeiträume (3.1, B1, C1–C4).
   - Weicht er ab, fragt Mietfuchs: „Rechnen Sie die Heizkosten getrennt ab, mit eigener Heizkostenvorauszahlung?“ Dann bietet es die Wege aus 3.1 an, mit Vorschau der Zeiträume und dem Hinweis auf den Mietvertrag.
   - Vorgeschlagen wird: bei „getrennt abgerechnet“ **Weg d**; sonst die eigene Heizperiode (Weg b), wenn schon Daten im Kalenderjahr vorhanden sind; sonst die Umstellung des ganzen Objektzeitraums (Weg a). Legt der Vertrag den Zeitraum fest, nennt jeder Weg den Zustimmungsvorbehalt (A3).
   - Vorhandene Heizpositionen offener Zeiträume werden mit Vorschau umgeschlüsselt (3.0).
4. **„Welche Wohnungen hängen an dieser Heizung?“** Vorgabe: alle Wohnungen.
5. **„Sind die Zähler und Heizkostenverteiler aus der Ferne ablesbar? Wurden sie nach dem 01.12.2021 eingebaut?“** (`devices_remote`, `devices_installed_after_2021_12`; bei `self` je Zähler; R-A1, G-C2).
6. **Nur bei Wärmepumpe:** „Wurde der Verbrauch am 01.10.2024 schon erfasst? Sonst: Seit wann?“ und bei Bruttowarmmiete die Aufgabe, die Durchschnittskosten 2022–2024 zu bestimmen (§ 12 Abs. 3; F5, L4).
7. **Nur bei `self`:** „Mit welchem Anteil nach Verbrauch haben Sie bisher abgerechnet?“ (Vorgabe 70, § 6 Abs. 4; R-A7); die Frage nach § 7 Abs. 1 S. 2 als „Wurde das Haus vor 1995 gebaut und seither nicht mindestens auf den Stand von 1995 gedämmt? (unsicher → ‚weiß nicht‘) Sind die frei liegenden Heizungsrohre überwiegend gedämmt?“ (A10); Warmwasser (über dieselbe Heizung? Wärmezähler am Speicher? bei Wärmepumpe: Gesamtwärmezähler?), Erfassung, dann legt der Ablauf die Zähler an.

**Eigentumswohnung:** Bei Objektart `etw` fragt Schritt 2 „Die Gemeinschaft (Hausverwaltung) rechnet ab“ und legt die Anlage mit `source = 'homeowners'` an (F2).

**Laienprobe** (Hinweis 7): Vor PR 7 werden die Formulare aus PR 4–6 mit drei Vermietern ohne technische Vorkenntnisse durchgespielt; Befunde gehen in PR 7.

Nach Schritt 2 legt Mietfuchs die Anlage an. Zeitraum, Wohnungen und Fernablesbarkeit lassen sich später ergänzen; bis dahin gelten die Vorgaben und „unbekannt“. Bestehende Heizpositionen in **offenen** Zeiträumen werden ihr zugeordnet, mit Vorschau. Zahlen ändern sich dabei nicht, denn die Methode `manual`/`service` verteilt wie bisher.

### 11.3 Was ein Vermieter mit Messdienst mindestens tut

1. Einmalig: Heizung einrichten, Schritte 1–5 (wenige Minuten).
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

**Bestehende Fixtures:**

- F01–F11 bleiben bis PR 5 wortgleich (db.json und expected.json).
- **Ab PR 6 ändert sich F06** (Heizposition 2025 nach Zählern, ohne Anlage): `warnings` und `notices` bekommen `co2.fuel-unknown`. Keine Zahl ändert sich. README und Commit nennen den Grund (G-A5).
- Ein Gleichheitstest prüft, dass `snapshotFor` mit Regeln `{ startMonth: 1, changes: [] }` und ohne Anlage dasselbe ergibt wie `snapshotOf(…, year)`, über das ganze Ergebnis außer `legalBasis.values` und den neuen CO₂-Hinweisen.

**Neue Fixtures:**

| Fixture | Inhalt | Prüft |
|---|---|---|
| **F12 Mai–April, Messdienst ohne CO₂** | anonymisierte reale Abrechnung (unten) | Zeitraum, `service`, `co2.service-unsplit` |
| **F13 Mai–April mit eigener Aufteilung** | wie F12, dazu die Gasrechnung als Lieferung, `used_by_service` | E umgerechnet, C ganz (G-A3), Abzugszeilen nach Anteil an den Messdienstbeträgen (Näherung) |
| **F14 Eigene Heizperiode** | Objekt im Kalenderjahr, Anlage Mai–April, einheitliche Vorauszahlung, Auszug 31.10.2025 | Abrechnung nur mit Heizkosten samt Warnung und empfohlener Frist 31.12.2026; Umschlüsseln einer Bestandsposition `'2026-01'` → `'2025-05'` (G-A2) |
| **F15 Techem-Muster mit Vorwegabzug** | Beispiel A | Probe exakt, `co2Share`, Steuer 3.933,01 € |
| **F16 Eigene Heizkostenabrechnung** | Beispiel A aus 8.6 | 1.961,89 / 2.615,84 / 1.331,52 / 750,75 |
| **F17 Heizöl mit Vorrat** | Beispiel 8.2 | 5.750,00 €, `fuelCarry` −100 €, E 15.254,91 kg, L 518,48 € |
| **F18 Rumpfzeitraum** | Wechsel Kalenderjahr → Mai 2025; Rumpf `'2025-01'`; Grundsteuer zeitanteilig; Heizung 700 € Brennstoff (Merkmal aus PR 3) + 200 € Jahreswartung | 157,81 / 322,19 €, gekürzte CO₂-Tabelle, Frist 30.04.2026, Vorschlag **228 €** (3.7) |

**F12, die reale Abrechnung.** Sie stammt aus einem Haus mit vier Einheiten und einer Messdienst-Komplettabrechnung. Namen, Adressen, Nutzernummern und Zählernummern werden **nicht** übernommen.

| Angabe | Wert |
|---|---|
| Wohnfläche | 200,6 m² |
| Zeitraum | 01.05.2025–30.04.2026 |
| Gas | 29.886 kWh, 3.117,47 € |
| Verteilung | 30/70 |
| Heizung | 4.035,70 € |
| Warmwasser | 240,81 € |
| CO₂-Aufteilung | keine |

**Erwartung F12:**

- Beginnmonat 5, Abrechnung `'2025-05'`, „2025/2026“, Frist **30.04.2027**.
- Heizposition 4.276,51 € als `amounts`. Die vier Einzelbeträge schreibt die Umsetzung aus dem Beleg ab.
- `co2.service-unsplit` mit 3 % je Mieter auf seine gedruckten Beträge. Die Summe liegt sicher zwischen **128,28 und 128,31 €** (3 % · 4.276,51 = 128,2953; G-D2), aber nur, wenn alle vier Einheiten vermietet und eingetragen sind. Den genauen Wert hält das Fixture fest.
- Keine 15 %, und ohne Angabe zum Warmwasseranteil kein `dhw-not-metered`.

**Erwartung F13:**

- Lieferung 15.03.2025–14.03.2026; Anteil an H nach Tabelle 848,71 ‰; Lücke 47 Tage, 151,29 ‰ → `fuel.uncovered`.
- E umgerechnet = E_Rechnung.
- **C = C_Rechnung**, ganz, weil der Messdienst die Rechnung als Anlieferung angesetzt hat.
- Die kg der Rechnung trägt das Fixture ein, sobald sie vorliegen (Gegenprüfung E.10). Bis dahin ist der Wert erfunden und als solcher gekennzeichnet, nahe der Grenze 27,0.
- Zwei Varianten halten das Kippen fest: 26,94 → 30 % gegen 26,95 → 40 %.

### 12.2 Engine (je Modul)

**Testfälle aus den Gegenprüfungen.** Jeder Rechenfehler der ersten Fassung ist ein Test, der mit der alten Regel rot wäre:

| Test | Lage | Erwartung (zweite Fassung) | Erste Fassung ergab |
|---|---|---|---|
| G-A1 / N4 | Wechsel Kalenderjahr → Mai ab `2025-05`; Mieter A mit Jahreskorrektur 2025 über **2.200 €** (Soll 2.400); Mieter B ganz im Rumpf (Auszug 28.02.2025) mit Korrektur 350 €; Ganzjahresposition 480 € | Vorschau verlangt für A „01–04/2025“ und „05/2025–04/2026“, speichert beides mit dem Wechsel in einer Transaktion; B bleibt unverändert; Rumpf rechnet für A mit den eingegebenen 700 € (01–04/2025), `2025-05` mit dem eingegebenen Betrag für 05/2025–04/2026; kein Monat wird doppelt oder zum Soll angerechnet; Position 157,81 / 322,19 € | Rumpf mit 2.400 € bzw. Mai–Dezember zum Soll |
| G-A2 | Position `'2026-01'`, Anlage mit Beginn Mai | umgeschlüsselt auf `'2025-05'`, verteilt; direkter Schreibversuch mit `'2026-01'` → 400 | Position nirgends verteilt |
| G-A3 | C = 600 €, Stufe 40 %, Anteil 848,71 ‰, `selfAfterService` | Entlastung 240,00 € | 203,69 € |
| G-A4 / N1 a–f | Gasrechnung 6.500 € (15.03.2025–14.03.2026) in H = `2025-05`; Teil für H−1 = 983,39 € (`fixed_cents = null`) | a: +983,39 in H−1; b: Schätzung 907,74, `fuelEstimateDiff` 75,65; c: `fuelClosedPeriod` 983,39; d: Ablesung in abgeschlossener H → 409; e: Schätzung 1.050, `fuelEstimateDiff` −66,61 mit `fuel.estimate-overcharged`; f: Wiederöffnen, Differenz entfällt. Summe immer 6.500,00 € | Richtung H+1; Zuviel blieb beim Vermieter |
| N1 Abschlussdialog | H mit Lücke 15.03.–30.04.2026 | Dialog nennt Schätzung und den Betrag, den der Vermieter ohne Schätzung trägt; Vorgabe Schätzung | stiller Verlust beim Vermieter |
| G-B2 | Rest 60 €, L_self 20 €, `co2Share` 80 € | L_self 20, `co2Share` 40, `amountsRest` 0 | 12 / 48 |
| G-B3 | Betrag 3.933,01 €, S 3.845,51 €, L 87,50 €; Einzelbeträge mit vier Rundungen je Nutzer | bestanden; Einzelbeträge bis S + NE · 2 ct zulässig, NE · 2 ct + 1 ct darüber → Fehler | Toleranz zu eng |
| G-B5 / R-A5 | Brennstoff 9.000 € nach Verbrauch, Messkosten 1.000 € nach Einheiten, A 50 %, B 30 %, C 20 % (wie B8), L 464,27 € | A 232,14 € | 224,40 € |
| G-B6 / N2 | Heizzeilen und Abzug je getrennt gerundet | Nettosumme < (k + 1) ct neben exakt; Kürzung auf die gedruckten Zeilen | Zusage 2 ct |
| G-B8 | Wohnung nur mit Warmwasserzähler, Hauptzähler Kaltwasser | Wohnung gilt als ohne Kaltwasserzähler, Rückfall auf den Hauptzähler | Kaltwasser zahlten die anderen |
| G-B10 | Erstattung 50 € mit der Miete verrechnet (Zahlung 950 €) | Ist um 50 € niedriger | um 100 € |
| G-C5 | Heizöl 8.2 mit ⅓ Eigennutzung | privat 1.883,33 € | 1.916,67 € |
| Z-B1 | Stichtag 31.12., Ablesungen 02.01. und 05.01. | Werte wie abgelesen, hint mit 5 Tagen und 27,4 ‰; keine Schätzung | § 9a, Topf nach Fläche |
| Z-B2 | Wechsel 30.09., keine Ablesung, „versäumt“ | § 9b Abs. 3; warning mit 15 % auf die Heizkosten von C1 | hint |
| Z-B3 | Wechsel 30.09., Ablesung 03.10. | Wert verwendet, Grenze am 03.10., hint | § 9b Abs. 3 |
| Z-B5 / R5 / A11 | Winter-Rumpf: kalt 400, Brennstoff 700 (Leistungszeitraum = Rumpf), Wartung 200 als Jahresrechnung; Variante Wartung nur Januar–April; Sommer-Rumpf: Brennstoff 80, Jahreswartung 200 | 228 € bzw. 262 € bzw. 100 € | 262 € (Jahreswartung × 365/120) bzw. 133 € |
| R1 | Fernwärme 15.03.2025–14.03.2026, Grundpreis 2.000 €, H = 2025 | fester Teil 1.600,00 € | 1.242,58 € |
| R2 | `manual`, Öl, Beispiel 8.2 mit Bestand | Mieter tragen 5.750 € nach Verbrauch, `fuelCarry` −100 € | nach Lieferung 5.650 € (mit 3.000 l Dezemberlieferung +3.150 €) |
| R3 | getrennte Heizvorauszahlung, H Mai–April, P Kalenderjahr | eigene Heizkostenabrechnung je H mit Frist 30.04.2027 bei H = `2025-05`; P ohne Heizkosten | nur Weg a |
| R4 / B5 | `manual`, **Position „nur Heizung“** (`heating_target = 'heating'`, PR 10), Wohnung leer November–März, Mieter April–Oktober | Mieter trägt 270 ‰ dieser Position (Gradtage); eine kombinierte Position „Heizung und Warmwasser“ bleibt bei 214/365 = 58,6 % (§ 9b Abs. 2) | 58,6 % für jede Position |
| B1 / C1 | Weg d einschalten, Staffel 300 € ab 01/2025 und 330 € ab 01/2026, Heizanteil der letzten Abrechnung 41 %, X = 01/2026 | Vorschau teilt beide Stufen ab X: 177/123 €, dann 195/135 €; Mietkonto-Soll 300 bzw. 330 €, nie mehr | Soll 453 € ab 01/2026; 492 € zu viel in H `2025-05` |
| B2 | Weg d, Heizperiode wechselt von Mai auf Januar (P = Kalenderjahr), Jahreskorrektur der Heizvorauszahlung 1.400 € unter `2025-05` | Vorschau verlangt Beträge für den Rumpf `2025-05` (Mai–Dezember 2025); danach ist H = P, Weg d endet, und `2026-01` rechnet als **eine** Gesamtabrechnung mit beiden Vorauszahlungen getrennt ausgewiesen | 1.400 € ganz auf den Rumpf |
| C2 | P 2026 offen, Jahreskorrektur 3.300 € (Soll 3.600), Weg d ab X = 01/2026, Z = 123 € | Vorschau verlangt „davon übrige“ und „davon Heizung“; Summe der Anrechnung über P 2026 und H für Januar bis Dezember 2026 = 3.300 € | 3.300 € in P und zusätzlich 4 · 123 = 492 € in H |
| C3 | P 2025 abgeschlossen, Einrichtung im Herbst 2026, Position auf H `2025-05` umgeschlüsselt | X frühestens 01/2026 (409 bei 05/2025); H `2025-05` rechnet nur Januar–April 2026 an (4 · 123 = 492 €) und nennt die Anrechnung Mai–Dezember 2025 in der Abrechnung 2025 | 984 € je Mieter doppelt angerechnet |
| C4 | Weg d ausgeschaltet (Antwort auf „nein“), `heating_prepayments` gefüllt | Vorschau führt die Staffeln zusammen; ohne Zusammenführen rechnet die Gesamtabrechnung beide Staffeln an | Heizvorauszahlung nie angerechnet |
| C5 | Gas 01.03.2024–28.02.2025 über 2.400 € im Rumpf `2025-01` | Vorschlag 200,00 € je Monat für diese Position | 377,36 € |
| R11 | Rumpf mit Gasrechnung (Vorschlag möglich) und Öllieferung ohne Leistungszeitraum | kein Vorschlag für den ganzen Heizanteil | Vorschlag nur aus Gas, zu niedrig |
| B3 | Weg d, H = `2025-05`, P = 2026 | Heizkostenabrechnung mit Frist 30.04.2027, im Cockpit eigene Zeile; Abschluss von P friert sie nicht ein | Frist 31.12.2027 |
| B4 | Rumpf 01.01.–30.04., Öllieferung 3.000 € als Brennstoff ohne Leistungszeitraum | kein hochgerechneter Vorschlag für diese Position, `prepayment.no-suggestion` | 5.660 € Jahresbasis |
| B8 | `manual`, L = 464,27 €; Brennstoff 9.000 € mit `heating_part = 'fuel'` ohne Lieferung, verteilt A 50 %, B 30 %, C 20 %; Messkosten 1.000 € nach Einheiten (je ⅓) | x_t aus Brennstoff: A **232,14 €**, B 139,28 €, C 92,85 € (exakt 232,135 / 139,281 / 92,854; Restcent nach Bruchteil an C und A) | A 224,40 € (Topf) |
| F1 | Wärmepumpe, Volumenformel, 4.500 kWh, Strom 12.000 kWh, Wärme 36.000 kWh | α = 37,5 % | 12,5 % |
| F2/F3 | ETW, Gemeinschaft mit Vorwegabzug | `serviceDeducted`, Betrag S + L, `co2Share` in den Werbungskosten | ohne CO₂-Datensatz; Nettobetrag |
| F4 | Zweifamilienhaus in Gemeinde mit Kappungsgrenzen-Verordnung, ohne Mietpreisbremse, ab 2028 | hälftige Teilung | Stufen |
| F5 | Wärmepumpe neu 01.02.2025 mit Erfassung | Verordnung im Zeitraum 2025 anwendbar | ausgenommen |
| N2 / A7 | Mieter mit vier Heizzeilen, zwei `fuelCarry`-Zeilen und Abzug (k = 6) | Nettosumme < 7 ct neben exakt | Zusage 2 ct; k ohne `fuelCarry` |
| A1 | Rumpf in PR 3, Brennstoffposition mit `heating_part = 'fuel'` **und Leistungszeitraum = Rumpf** (R1) | Vorschlag nach Gradtagen | in PR 3 nie ein Vorschlag |
| A2 | `manual`, kombinierte Position „Heizung und Warmwasser“, Sommermieter Mai–September, Anlage angelegt | Anteil nach Tagen wie vor dem Anlegen; keine Zahl ändert sich | nach Gradtagen (Sommermieter zu wenig Warmwasser) |
| A3 | Weg d mit H = P (Kalenderjahr, getrennte Vorauszahlung) | eine Gesamtabrechnung, beide Vorauszahlungen getrennt ausgewiesen | ungeregelt |
| A3 | Weg d mit H Mai–April | Heizkostenabrechnung je H mit Vorschlag für die Heizvorauszahlung; Abschluss in `closed_heating_settlements` | kein Vorschlag |
| A6 | `manual`, Gasrechnung als Lieferung verknüpft, reicht über H | abgegrenzt mit `fuelCarry`, C nach Anteil | ganz verteilt mit Warnung |
| A8 | Wärmepumpe, Warmwasserwärmezähler, kein Gesamtwärmezähler | `heating.heat-pump-dhw-basis`, keine Verteilung des Topfs | Q / Strom ≈ dreifach |
| N8 | Heizöl, ⅓ Eigennutzung | Abrechnung 1.916,67 €, Steuer 1.883,33 €, Erklärung auf der Steuerseite | ohne Festlegung |
| R-A1 | Zähler eingebaut 15.12.2021, `remote_readable = false`, Zeitraum 2025 | 3 % | kein Hinweis vor 2027 |
| R-A7 | Vorperiode 50 %, neue H mit 70 % | `heating.key-change`; Änderung für eine begonnene H → 400 | stillschweigend 70 |
| R-A21 | `heatedArea` gesetzt | nur Topf Heizung, Warmwasser nach Wohnfläche | beide Töpfe |
| R-A22 | vier gleich große Wohnungen, eine ausgefallen | genau 25 %, keine Überschreitung, Schätzung bleibt | – |

**`period.test.ts`:**

- Fristen 2025 / `2025-05` / Rumpf / 01.03.2023–29.02.2024 → 28.02.2025.
- Schaltjahr 01.05.2027–30.04.2028 = 366 Tage.
- Alias `2025` nur beim reinen Kalenderobjekt.
- Prüfbedingung lehnt `'2025-00'` und `'2025-13'` ab (G-C3).

**`law.test.ts`:** Stichtage nach 4.7, Vollständigkeit, `law-history`, Wächter samt erlaubten Stellen.

**`fuel.test.ts`:**

- Tabelle: 621,29 / 848,71 / 530 ‰.
- Stufe 1 mit Preisabschnitten; Stufe 3 mit zwei Teilmengen; Stufe 4 mit Ortswerten; eingetragener Anteil schlägt alles.
- Lücke: E umgerechnet, C bei `self` abgegrenzt, bei `service*` ganz.
- Öl nach 8.2 (E 15.254,91 kg, C 648,10 €, gerundet je Posten). Jahr ohne Lieferung. Endbestand zu groß → Fehler. Bestand aus 2022: 0 €. `fuel.stock-missing` je Methode.

**`heating.test.ts`:**

- Beispiel A centgenau, C1/C2 als Bruch 1.331,52995 / 750,75005.
- Gegenproben 378,85 € und 1.375,18 €.
- Keine lineare Interpolation.
- α: 15,0 (nach Wortlaut, G-B1 abgelehnt) / 27,75 / 11,84 %; Heizwert laut Rechnung vor Tabelle; Tabelle nur bei Kessel.
- Anteile: § 7 Abs. 1 S. 2 nur bei Öl und Gas, nicht bei Wärmelieferung (§ 7 Abs. 3).
- Schätzung 40 % → Fläche; 20 % → bleibt.
- HKV mit Faktoren 0,8 und 1,25.
- Leerstand, Eigennutzung, Pauschale, Zweifamilienhaus.

**`co2.test.ts`:**

- Grenzen 11,9 · 11,95 · 12,0 · 51,9 · 52,0.
- § 9 (950 → 475, 100 → 50, 700 → 350); § 8 → 500.
- Anwendbarkeit `2022-12` / `2023-01`; Rumpf 5,0 → 10 % mit `co2.short-period-agreed`.
- A bis A⁗ und die benannte Lücke; Gutschrift im Topf; G/V; B, C, B1.
- § 5a 271,80 €; § 5d Abs. 3 im Zweifamilienhaus → Stufen; angespannter Markt → hälftig; § 5b Neubau mit Bauantrag vor 13.05.2026 → Stufen.

### 12.3 Invarianten über Zufallsbestände

Der Generator aus calc.test.ts und #202 bekommt einen festen Startwert. Er erzeugt Rhythmen und Wechsel, Anlagen (alle Methoden, Energien, Erfassungen, eigene Heizperioden), Lieferungen, Vorrat, Wechsel mit und ohne Zwischenablesung, Leerstand, Eigennutzung, Pauschale und CO₂-Datensätze. **Bestandspositionen werden vor dem Anlegen einer Anlage erzeugt**, damit das Umschlüsseln geprüft wird (G-A2).

Geprüft wird:

1. Σ aller Zeilen = Σ Kostenpositionen von P und den eingestellten H. Die Summe stimmt über die Gegenzeilen: `fuelCarry`, `fuelClosedPeriod`, `fuelEstimateDiff`; geschätzte Lieferungen haben keine Kostenposition und gehen nur über diese Gegenzeilen ein (A7).
2. **Je Zeile** ≤ 1 ct neben dem exakten Wert; keine Mieterzeile negativ bei positiven Kosten, **ausgenommen Zeilen der Art `fuelCarry` und `co2Relief`** (A7). **Je Mieter** ist die Nettosumme Heizung minus Abzug < (k + 1) ct neben dem exakten Wert, k = Zahl seiner gerundeten Heizzeilen **einschließlich `fuelCarry`**.
3. Zeitzerlegung: lückenlos, überschneidungsfrei, ≤ 12 Monate, Rumpf genau vor jedem Wechsel, Schlüssel eindeutig.
4. Jede Heizposition trägt den Schlüssel einer Heizperiode ihrer Anlage. Jede Heizperiode landet in genau einer Gesamtabrechnung oder, bei Weg d, in genau einer Heizkostenabrechnung, jede Messdienstposition wird genau einmal verteilt.
5. Über eine Folge abgeschlossener und offener H wird jede Lieferung genau einmal verbraucht, mit den eingefrorenen Überträgen (G-A4).
6. **Verschiebung um 120 Tage**, beschränkt auf kalte Kosten, Jahre ohne 29.02. und Daten ohne Rechtsänderung (G-H): Ein Kalenderbestand, verschoben und im Zeitraum Mai–April gerechnet, ergibt centgleiche Anteile.
7. **Wechsel neutral, nur für Heizung bei `self`** (G-H): Die Summe der Nutzer einer Wohnung hängt bis auf 1 ct je Zeile nicht davon ab, ob und wann gewechselt wird.
8. `serviceDeducted`: kein Mieter zahlt anders als sein Einzelbetrag, nie eine `co2Relief`-Zeile. L_self ist exakt. `amountsRest` ist nur bei gescheiterter Probe negativ.
9. 0 ≤ r_t ≤ x_t; |R − L_vermietet| ≤ 0,5 ct, **bei widerspruchsfreien Daten**. Bei sich überschneidenden Mietverhältnissen gilt das nicht, und der Kommentar sagt es (G-H).
10. Steuer: Über alle Kalenderjahre steht jede Position genau einmal in den Werbungskosten; `fuelCarry` und `co2Relief` nie. Der private Teil ist Betrag × Gewicht ohne Übertrag.
11. Vorauszahlungen: Ohne Jahreskorrektur ist die Summe der angerechneten Vorauszahlungen (bei Weg d: aus P **und** aus den Heizkostenabrechnungen) gleich der Summe beider Staffeln im Mietkonto über dieselben Monate, auch über einen Wechsel des Zeitraums oder der Heizperiode, über Stufen der Staffel nach X und bei einer Einrichtung von Weg d nach einem Abschluss (Generator erzeugt beides, C1, C3).
12. Ohne Anlage, ohne Rhythmus und ohne CO₂ ist jede Zahl gleich dem Stand vor 0.11.0.
13. Zwei Objekte und zwei Anlagen rechnen unabhängig.
14. Kürzungsbeträge je Mieter auf die gedruckten Zeilen nach Abzug.

### 12.4 API, Schema, Migration, Client

**`api.test.ts`:**

- Zeiträume (404 mit Satz, `2025` als Alias).
- Weg d: `/api/heating-settlement/:plant/:period` rechnet und schließt ab; Frist von H; Aufteilen der Vorauszahlung in einer Transaktion (409 ohne Antwort).
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
| **0** | Anleitung `meteringService`. **Erledigt mit #216** (auf `feat/heizung`); die Durchsicht von PR 6 prüft, dass Text und Probe zusammenpassen. | #209 | 0 T |
| **1** | **Rechtsregister** `shared/law/` mit den Parametern, die der Bestand nutzt (Kabel, 15 %, 50/70, `VACANCY_PERSONS`, Umsatzsteuer, Fernablesung als `hkv.remote-reading.retrofit` und `hkv.cut.remote-reading`, unverändert in Text und Zahl), **eine Zeitregel je Parameter** (N6), Protokoll, `legalBasis.values`, `deviation` für Werte; Wächter mit erlaubten Stellen; Tests je Stichtag. Golden wortgleich. **Nicht** in PR 1: `hkv.degree-days` (PR 3), `hkv.remote-reading.new-devices` (PR 4). | #97, #110 | 2,5–3 T |
| **2** | **Zeitraum, Kern:** `shared/period.ts`; 0014/0015 (`year` → `period` in vier Tabellen und `requested_period`, Rhythmus, Wechsel, Prüfbedingung mit Monat 1..12); `legacy/read.ts` erzeugt `period`; Schnappschuss und calc.ts über P; `ledgerRows`; `settlementDeadline`, `Settlement.deadline`; Alias nur beim reinen Kalenderobjekt. Golden unverändert, Gleichheitstest. | #208 | 4–5 T |
| **3** | **Zeitraum, Bedienung:** Beginnmonat und Wechsel mit Vorschau schrumpfender Schlüssel; Jahreskorrekturen in der Vorschau neu erfasst (N4); Rumpf, Leistungszeitraum, Aufteilen nur kalter Kosten, Jahr der Zahlung, Steuer über zwei Abrechnungen, `PeriodProvider`, Cockpit, `period.*`; `hkv.degree-days` und schmales Merkmal `cost_items.heating_part` (A1); Vorschlag § 560: Brennstoff **mit Leistungszeitraum** nach dem Gradtagsanteil des eigenen Leistungszeitraums, ab zwölf Monaten als Jahresbetrag (C5), Lieferungen ohne Leistungszeitraum nach der letzten vollen Periode oder ohne Vorschlag (B4), kalte Rumpfanteile nach Tagen, feste Jahresrechnungen als Jahresbetrag (A11); Lexikon, F18, Praxislauf 15/16. | #208 | 5,5–6,5 T |
| **4** | **Heizanlage, Grundlage:** `heating_plants` (samt `source`, Wärmepumpen-Erfassung), `heating_plant_units`, `heating_periods` (ohne Vorrat); `cost_items.heating_plant_id` mit Schreibprüfung; Zähler `warmwasser`, `hkv`, Rolle, `remote_readable`, `installed_on`; Fernablesbarkeit neuer Geräte und an der Anlage für den Messdienst; `change_split` (wirkt bei `manual` erst auf Positionen „nur Heizung“, A2); Wasserschlüssel; `zfh`; Eigentumswohnung als Anlage `homeowners`; Einrichtung Schritte 1, 2, 4, 5, 6. **Sperren:** `self`, `perUnit`, zweite Anlage, eigene Heizperiode. | #99, #214, #180 | 4,5–5,5 T |
| **5** | **Eigene Heizperiode und getrennte Heizkostenabrechnung:** Rhythmus der Anlage, Zuordnung H → P, Umschlüsseln mit Vorschau, Abrechnung nur mit Heizkosten (L3), F14; **Weg d** mit `heating_prepayments`, Aufteilen der bisherigen Vorauszahlung mit Vorschau über alle Stufen ab X, X nicht vor dem letzten Abschluss, Neuerfassung der Jahreskorrekturen offener P, Ein- und Ausschalten über dieselbe Vorschau, Anrechnung beider Staffeln, wer die Heizkosten abrechnet (B1, C1–C4), `heating_prepayment_overrides` samt Neuerfassung beim Rhythmuswechsel (B2), eigener Berechnung, Route, Frist und Abschluss je H in `closed_heating_settlements` (B3), `Statement.scope`, § 560-Vorschlag für die Heizvorauszahlung, H = P als eine Gesamtabrechnung; Einrichtung Schritt 3. | #217 | 7–8 T |

### Phase B: Messdienst und CO₂

| PR | Inhalt | Refs | Aufwand |
|---|---|---|---|
| **6** | **CO₂ beim Messdienst und bei der Gemeinschaft:** `co2_statements`, `co2_tenant_reliefs`; `serviceDeducted`, `serviceShown`, `selfAfterService` ohne Lieferung; S als gedruckte Kostensumme, Musterabrechnungen je Messdienst und Rückfall „Zeile nicht gefunden“ (R6); Probe nur über Messdienstpositionen, Toleranz NE · 2 ct, G/V, L_self exakt; ETW brutto mit L (F3); Ausweis; `co2.missing` …; Warmwasser-Angabe mit 15 %; F06 angepasst, F12, F15. **Sperren:** Lieferungen, Methode `self`. | #97, #209, #211 | 5,5 T |
| **7** | **Lieferungen, eigene Aufteilung (Gas, Fernwärme, Strom):** `fuel_deliveries` (mit `fixed_cents`, `estimated`), `fuel_delivery_parts`, `cost_items.fuel_delivery_id`, `fuel_carry_frozen`; Abgrenzung Stufen 0–6, feste Bestandteile nach Tagen; Abgrenzung auch bei `manual` mit verknüpfter Lieferung (A6); Teil einer Rechnung nach H−1, Schätzung mit Vorbehalt, `fuelEstimateDiff` mit Vorzeichen, Hinweise vor und nach Fristablauf, Wiederöffnen (N1, A4); Sperre von Ablesungen in abgeschlossener H; E umgerechnet, C nach Methode; Einstufung, gekürzte Tabelle, § 8, § 9, ETS; Abzug nach Brennstoffanteil; F13. **Sperre:** Vorratsenergien. | #97 | 6 T |
| **8** | **Vorrat bei `selfAfterService` und `manual`** (R2): Bestand in `heating_periods` mit Peildatum, Bewertung nach Minol, Rundung je Posten, Vorbelegung, bei `manual` auch die Kosten nach Verbrauch mit `fuelCarry`; `fuel.stock-*`, `fuel.before-2023`, `fuel.manual-by-delivery` mit Einstufungshinweis. Bei `self` folgt der Vorrat mit PR 10. | #97, #99 | 3 T |
| **9** | **Etagenheizung auf Vermietervertrag und mehrere Anlagen:** `perUnit`, zweite Anlage, `co2.item-spans-plants`. | #97 | 2 T |

### Phase C: Eigene Heizkostenabrechnung

**Vor PR 10 und PR 14** sollen VDI 2077 und DIN 94680 vorliegen (15.3). Fehlen sie, werden die PRs mit den Regeln aus der Praxis der Messdienste gebaut, und die Marken ⟨Norm offen⟩ bleiben im Ausweis und im Lexikon sichtbar.

| PR | Inhalt | Refs | Aufwand |
|---|---|---|---|
| **10** | **Kernrechnung:** `heatingSystem`, Teil und Ziel; Wärme- und Warmwasserzähler; α gemessen; Anteil mit Vorgabe aus der Vorperiode (§ 6 Abs. 4); `heatedArea` nur Heizung; § 9b mit Wert laut Gerät, Ablesung daneben, „nicht möglich / versäumt“; Ablesung neben dem Stichtag wie abgelesen; Leerstand, Eigennutzung, Pauschale; Gewichte und #202; Vorrat und `fuelCarry` bei `self`; Wärmepumpe nach § 12 Abs. 3 mit Datum der Erfassung (F5); Druckblock, Ableseergebnis; Seite Heizkosten; Einrichtung Schritt 7; F16, F17. | #99 | 7–9 T |
| **11** | **Warmwasser ohne Zähler:** Formeln, Faktoren nur für Formelwerte, Heizwert laut Rechnung vor Tabelle (Tabelle nur bei Kesseln, Hackschnitzel geklärt), `dhw-not-metered` bei `self`, Plausibilität. | #211 | 1,5 T |
| **12** | **HKV und Ablesedienst:** Faktor, Skala, Stichtagswert, `device-cutoff`, `hca-factor-missing`, `mixed-capture`; `heating_service_values`. | #99 | 2–3 T |
| **13** | **Schätzung § 9a** nur bei Ausfall: `heating_estimates`, drei Wege, Dialog, „überschreitet 25 %“. | #99 | 2 T |
| **14** | **Pflichtangaben und Ausnahmen:** § 6a Abs. 3 jede Nummer mit 3 %, Klimafaktor, Vergleich, `heating.monthly-info`; § 11; § 2 Vereinbarung; § 7 Abs. 1 S. 2; § 10. | #99 | 2,5–3,5 T |

### Phase D: Hinweise, Zukunft, KI

| PR | Inhalt | Refs | Aufwand |
|---|---|---|---|
| **15** | **Betriebsstrom.** [R] V ZR 166/15 (geprüft 05.10.): Der Betriebsstrom **muss** nach der HeizkostenV verteilt und ohne Zwischenzähler **geschätzt** werden; die Wahl des Maßstabs liegt im Ermessen, solange er „nicht offenkundig ungeeignet“ ist. Das Urteil betrifft eine WEG und wird ins Mietrecht übertragen. Umfang: `heating.operating-power-double` mit Betrag, wenn eine Anlage Betriebsstrom im Topf hat und der Allgemeinstrom ungekürzt umgelegt wird; Abzug beim Allgemeinstrom als zweite Position; **Schätzhilfe nach Anschlusswerten der Geräte und Heiztagen** (vom BGH referiertes, ausrechenbares Verfahren, Rn. 14). Die Prozentspannen der Literatur (3–6 % Jennißen, 4–10 % Schmidt-Futterer/Lammel, 8–10 % Wall, höchstens 5 % Gies) nennt nur das Lexikon, als vom BGH referierte, nicht gebilligte Werte. | #212 | 1,5 T |
| **16** | **Wärmelieferung, Contracting:** Merkmal an der Anlage; Hinweise zu § 556c BGB (Effizienz, Kostenneutralität, Ankündigung drei Monate vorher in Textform) und WärmeLV; [R] VIII ZR 46/25, 47/25 (kein § 556c nach Einzelöfen); § 7 **Abs. 3** HeizkostenV (kein zwingendes 70 %); CO₂ wie Fernwärme. | #213 | 1 T |
| **17** | **Plausibilität und Ausdruck für den Messdienst:** Preise, ETS (Rechnungsdatum − 1 Jahr), EBeV, `law_overrides`, `co2.cost-implausible`; Ausdruck „CO₂-Angaben für den Messdienst“. | #97, #210 | 1,5 T |
| **18** | **§§ 5a, 5b, 5d ab 2028:** Merkmale an Anlage und Objekt; Netzentgelte und Biobrennstoff an der Lieferung; Teilung `incurred` (CO₂ als Auslegung); Notfalleinbau nach § 5a Abs. 4 im vollen Wortlaut; § 5b Neubau; **§ 5d Abs. 3 gerechnet** (Zweifamilienhaus mit Eigennutzung ohne Teilung, außer angespannter Markt; Mitteilung nach Abs. 4); § 5d Abs. 1 als Hinweis. Fällig vor der ersten Abrechnung einer H mit Tagen ab 01.01.2028. | #215 | 3 T |
| **19** | **Selbstversorger-Erstattung:** `co2_refunds`, Gutschriftzeile, Fristhinweise, § 8, § 9, −5 %; Steuer nur über Zahlungen. | #97, #85 | 2 T |
| **20** | **KI (#103):** Messdienst-PDF (Nutzerzeilen je Block, Zeitraum, CO₂-Block, Abzugszeile, S, Warmwasser-Ermittlung, Nutzeinheiten), Lieferantenrechnung (§ 3 Abs. 1 Nr. 1–4, 6, Teilmengen, Heizwert). | #103 | 3 T |
| **21** | **Eichfrist:** `calibrated_until` (nicht für HKV), Übergangsrecht MessEV 2021 vorher lesen, `meter.calibration-overdue`, § 35 Stichprobe als Hinweis. #98 in den Meilenstein. | #98 | 1 T |
| **22** | **Monatliche Verbrauchsinformation** (§ 6a Abs. 1, 2) aus Monatswerten. **Nicht entbehrlich** (R-A17): Ohne sie dürfen Mieter bei fernablesbaren Geräten um 3 % kürzen. Wer sie über das Portal des Messdienstes bekommt, bestätigt das an der Anlage. | #99 | 1,5 T |

**Summe:**

| Umfang | Aufwand |
|---|---|
| alle PRs | **70–79 Arbeitstage** |
| Phase A | 23,5–28 T |
| Phase B | 16,5 T |
| Phase C | 15–19 T |
| Phase D | 14,5 T |

**Wenn gekürzt werden muss:**

- Phase A und B decken den häufigsten Fall vollständig ab, also Messdienst, auch Mai–April und mit eigener Heizperiode, samt CO₂.
- PR 10, 14 und 22 machen die eigene Abrechnung rechtssicher.
- PR 18 muss vor Frühjahr 2028 kommen.

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
| **Gasrechnung über den Zeitraumwechsel** | eingetragen, Zählerstand, Zwischenrechnung, Teilmengen, Gradtage, Schätzung mit Vorbehalt; feste Teile nach Tagen; abgegrenzt bei `self` und `manual` mit verknüpfter Lieferung, eingefroren beim Abschluss | 7, 10 | #97, #99 |
| Selbstabrechnung mit Wärmezählern | vollständig | 10, 11, 13, 14 | #99 |
| Selbstabrechnung mit elektronischen HKV | mit Bewertungsfaktor je Gerät | 12 | #99 |
| Verdunster | über Werte eines Ablesedienstes | 12 | #99 |
| Gemischte Ausstattung (Vorerfassung § 5 Abs. 7) | Fehler mit Verweis auf den Messdienst | 12 | **neues Issue nötig:** „Vorerfassung nach Nutzergruppen bei gemischter Ausstattung (§ 5 Abs. 7 HeizkostenV)“, Backlog |
| Warmwasser ohne Wärmezähler | 15 % beziffert, bei `service` aus der Angabe, bei `self` aus der Methode | 6, 11 | #211 |
| Rohrwärme (§ 7 Abs. 1 S. 3, 4) | nicht gerechnet, Hinweis im Lexikon | – | **neues Issue nötig:** „Rohrwärme nach § 7 Abs. 1 S. 3 HeizkostenV (VDI 2077 Beiblatt)“, Backlog |
| Mieterwechsel | Zwischenablesung (auch Monatswert oder Ablesung daneben), Gradtage, § 9b Abs. 3 mit Unterscheidung „nicht möglich / versäumt“, Leerstand als Nutzer | 10 | #99 |
| Ablesung nicht am Stichtag | Stichtagswert, sonst wie abgelesen mit Hinweis; § 9a nur bei Ausfall | 10, 13 | #99 |
| Geräteausfall | § 9a mit 25 % | 13 | #99 |
| Pflichtangaben § 6a Abs. 3 | Druckblock, 3 % | 14 | #99 |
| Fernablesbarkeit | nach Einbaudatum (§ 5 Abs. 2, 3), am Zähler oder beim Messdienst an der Anlage, 3 % beziffert | 4 | #214 |
| Monatliche Verbrauchsinformation | Warnung „bis zu 3 %“ bei fernablesbaren Geräten; Ausdruck aus Monatswerten | 14, 22 | #99 |
| Öl, Flüssiggas, Pellets, Holz | Bestand für Kosten und CO₂, auch ohne eigene Heizkostenabrechnung (`manual`), mit Peildatum | 8, 10 | #97, #99 (das im CO₂-Entwurf vorgeschlagene Issue „Brennstoffkosten nach Verbrauch“ ist damit abgedeckt) |
| Getrennte Heizkostenvorauszahlung | eigene Heizkostenabrechnung je Heizperiode (Weg d) | 5 | #217 |
| Gewerbe im Wohngebäude | CO₂ nach Stufen, Fläche nach 15.1 Nr. 1 | 7 | #97 |
| Fernwärme | wie Gas; ETS-Erstanschluss; § 9 Anschlusszwang; α ÷ 1,15 | 7, 11 | #97, #99 |
| Contracting, Wärmelieferung | Hinweise § 556c, WärmeLV | 16 | #213 |
| Wärmepumpe, Strom | keine CO₂-Aufteilung; Selbstabrechnung mit Wärmezählern, α × 0,30 | 4, 10, 11 | #99 |
| Gemischte Anlage (Gas + Solar, Wärmepumpe + Heizstab) | CO₂ nur aus Lieferungen mit CO₂-Ausweis; α nur gemessen | 7, 10 | #97, #99 |
| Etagenheizung, Vertrag beim Vermieter | `perUnit` | 9 | #97 |
| Etagenheizung, Vertrag beim Mieter | Erstattung | 19 | #97, #85 |
| Mehrere Heizungen in einem Objekt | mehrere Anlagen | 9 | #97, #99 |
| Pauschale, Warmmiete | Anteil beim Vermieter, Betrag nach Verordnung genannt; BGH VIII ZR 212/05 nicht nachgebaut | 10 | #109 |
| Vermietete Eigentumswohnung | Anlage `homeowners` mit `service`, CO₂, Heizperiode, Kürzungen gegenüber dem Mieter; Betrag brutto | 4, 6 | #97 |
| Zweifamilienhaus mit Eigennutzung | Objektart, § 2-Vereinbarung, CO₂ gilt | 4, 14 | #180, #99 |
| Gemischt genutztes Gebäude, Denkmal, Anschlusszwang | § 8, § 9 | 7 | #97 |
| Ausnahmen § 11 (Passivhaus, vor 1981 …) | Fläche ohne § 12, § 2 Abs. 7 CO2KostAufG | 14 | #99 |
| Betriebsstrom im Allgemeinstrom | Warnung mit Betrag | 15 | #212 |
| Rumpfzeitraum, Wechsel des Messdienstes | Rumpf, gekürzte CO₂-Tabelle | 3, 5 | #208, #217 |
| Ab 2028 Anlage nach § 43 GModG | hälftige Teilung anteilig | 18 | #215 |
| Eichfrist | Hinweis mit Beweislast | 21 | #98 (in den Meilenstein aufnehmen) |
| Gemeinschaftsräume mit hohem Verbrauch (Sauna, § 4 Abs. 3) | nicht gerechnet | – | Nicht-Ziel, selten |
| Bruttowarmmiete bei Wärmepumpe (§ 12 Abs. 3 S. 3) | Aufgabe in der Einrichtung, Feld `warm_rent_average_2022_2024` (L4) | 4, 10 | #99 |

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

Hier gibt es Quellen, aber keine Entscheidung. Mietfuchs wählt die vorsichtige oder die verbreitete Lesart und sagt es dem Vermieter.

| # | Frage | Quellenlage | Regel in Mietfuchs | Hinweis |
|---|---|---|---|---|
| 1 | Wohnflächenbegriff im CO2KostAufG, auch die Nutzfläche von Gewerbe im Wohngebäude (L1) | Gesetz definiert nicht; GdW: Fläche der Heizkostenabrechnung; bved: WoFlV (#85, #109); § 6 Abs. 1 erfasst Nichtwohnräume im Wohngebäude | eigenes Feld, vorbelegt mit der Fläche des Messdienstes bzw. Σ Wohn- und Nutzfläche | Lexikon `co2Area` |
| 2 | Abrechnung nur der Heizkosten für ein Jahr, in dem der Mieter nicht mehr wohnte | VIII ZR 240/07 betraf einen Auszug im Jahr des Periodenendes (R-A4) | wird gerechnet; empfohlene Frist zwölf Monate nach Ende des Zeitraums des Auszugs | `period.heating-only-statement` (warning) |
| 3 | Heilt ein nachgeholter Ausweis die 3 %? | § 7 Abs. 3: „in der Heizkostenabrechnung“; keine Rechtsprechung | abziehen und ausweisen, „bis zu 3 %“ | `co2.service-unsplit-healed` |
| 4 | Addieren sich die Kürzungen? | Wortlaut schweigt; [M] ista: „kumulativ“ | einzeln nennen, nie summieren | jeder Kürzungshinweis |
| 5 | Versäumte (nicht unmögliche) Zwischenablesung | § 9b Abs. 3 nennt nur „nicht möglich“; LG Hamburg 11 S 202/87: Kürzung; AG Schöneberg 104a C 226/05: keine Umlage nach Gradtagen; Berliner Mieterverein: 15 % „zweifelhaft“ wegen VIII ZR 373/04; [M] Brunata rechnet nach Abs. 3 | rechnen nach Abs. 3 wie Brunata, warning mit bis zu 15 % | `heating.no-interim-reading` |
| 6 | 25 % je Topf oder gemeinsam (§ 9a Abs. 2) | Wortlaut nennt beide Flächenmaßstäbe in einem Satz | je Topf | Lexikon |
| 7 | § 12 nach Flächenverteilung gemäß § 9a Abs. 2; 3 % bei einem Zeitraum, der 2027 nur teilweise berührt (Altgeräte) | Wortlaut: Verteilung „nach der Verordnung“; keine Rechtsprechung | keine 15 %; „bis zu 3 %“ | Hinweistexte |
| 8 | Reichweite des § 2 HeizkostenV | Überschrift „Vorrang“; Haufe: Vereinbarung nötig; Ratgeber: Bereichsausnahme (#85) | ohne Vereinbarung gilt die Verordnung | Schalter „vereinbart“ |
| 9 | Gemessenes Q gegen Brennwert-kWh (G-B1) | § 9 Abs. 2 S. 6 nur für Formelwerte; Abs. 3: B = Q / Hᵢ, bei kWh keine Umrechnung in Brennstoffverbrauch. **Folge der Wortlautlesung:** Dasselbe Gas ergibt in kWh nach Brennwert abgerechnet 15,0 %, in m³ mit Heizwert abgerechnet 16,65 % (Nachprüfung). Die Gegenlesung (Hinweis 3 der dritten Prüfung): Der Satz erspart nur die Umrechnung in m³, nicht den Wechsel der Bezugsgröße. | nach Wortlaut, Q / abgerechnete kWh. Vor PR 10 neben VDI 2077 die amtliche Begründung der Änderungsverordnung lesen, die den Faktor 1,11 eingeführt hat. | Lexikon `hotWaterShare` nennt **beide Lesarten gleichwertig** mit beiden Werten |
| 10 | Umrechnung von E über eine Lücke ohne Rechnung | § 5 Abs. 1 S. 5 spricht von den „auf den Rechnungen ausgewiesenen“ Emissionen | E auf H umgerechnet (sonst wäre die Stufe zu niedrig); C und Brennstoffkosten nie hochgerechnet, **außer als ausdrücklich geschätzte Lieferung mit Vorbehalt** (8.2) | `fuel.uncovered`, `fuel.estimated` |
| 11 | Ist ein einseitiger Rumpf oder ein Rumpf nur der Heizperiode „vereinbart“ (§ 5 Abs. 1 S. 4)? | Wortlaut „vereinbart“; [S] NebenkostenFix kürzt nur bei Vereinbarung; Messdienste rechnen auf ihren Zeitraum | kürzen wie die Messdienste | `co2.short-period-agreed` nennt das Wort und verweist auf den Mietvertrag |
| 12 | Einseitiger Wechsel des Zeitraums mit Rumpf | kein BGH; [M] Brunata: nur aus sachlichem Grund | Rumpf mit Hinweis | `period.short` |
| 13 | CO₂-Kosten nach § 5a Abs. 3 Nr. 2 in einer Heizperiode über den 01.01.2028 | Abs. 3 Nr. 2 sagt nur „ab dem 1. Januar 2028“; „angefallen“ mit Umrechnung steht in Abs. 1 für Netzentgelte und Biobrennstoff | anteilig nach Anfall wie Abs. 1 | `co2.half-split` |
| 14 | § 6a Abs. 3 Nr. 5 im ersten Jahr ohne Vorjahr | Wortlaut ohne Ausnahme | „bis zu 3 %“ | `heating.info-incomplete` |
| 15 | Pauschale oder Warmmiete und § 6 Abs. 1 CO2KostAufG | keine Rechtsprechung | keine Rechnung | Lexikon |
| 16 | „Überwiegend dem Wohnen“ (§ 6 Abs. 1) | Maßstab offen | Schalter, Vorgabe Wohngebäude | Lexikon |
| 17 | Fernwärme-Erstanschluss ohne ETS-Anlagen | BMWK-Rechner: 0 %; Gesetz nimmt nur ETS-Lieferungen aus | Wortlaut | Lexikon |
| 18 | Ausweis der Messdienstbeträge über zwei Steuerjahre | § 11 Abs. 2 EStG verlangt den Abfluss; Positionen haben kein Zahlungsdatum | Vereinfachung „Jahr der Zahlung der Position“, benannt | Hinweis an der Steuerübersicht |
| 19 | Berichtigung nach einer geschätzten Brennstoffrechnung | Vor Fristablauf möglich als Umkehrschluss aus [R] BGH 17.11.2004, VIII ZR 115/04; danach nur bei nicht zu vertretender Verspätung ([G] § 556 Abs. 3 S. 3 BGB, [R] BGH 12.12.2012, VIII ZR 264/12) und binnen drei Monaten ([R] BGH 05.07.2006, VIII ZR 220/05). Offen: Hat der Vermieter die Verspätung „nicht zu vertreten“, wenn er eine Zwischenrechnung hätte anfordern können? Zu viel Gezahltes: Einwendungsfrist des Mieters (§ 556 Abs. 3 S. 5, 6); ob der Vorbehalt daran etwas ändert, ist nicht entschieden. Eine Gutschrift ist jederzeit zulässig. | schätzen mit Vorbehalt; Hinweise vor und nach Fristablauf; Zuviel als empfohlene Gutschrift melden | `fuel.estimated`, `fuel.estimate-settled`, `fuel.estimate-overcharged` |
| 20 | Gilt die Mitteilungspflicht des § 5d Abs. 4 auch für Abs. 3? | Abs. 4 spricht von den „Voraussetzungen des Härtefalls“, die Überschrift des § 5d von Härtefällen | ja, als Auslegung: ohne Mitteilung hälftig (zulasten des Vermieters, also vorsichtig gegenüber dem Mieter) | `co2.half-split-two-family` |
| 21 | Getrennte Heizkostenabrechnung (Weg d) | § 556 Abs. 3 S. 1, 4 BGB; VIII ZR 240/07 Rn. 17–22 (Teilabrechnungen erlaubt, Leitsatz a nur bei einheitlicher Vorauszahlung) – Umkehrschluss; ob eine im Vertrag getrennt ausgewiesene Vorauszahlung eine getrennte Abrechnung verlangt, ist Vertragsauslegung | Weg d nur bei getrennter Abrechnung und H ≠ P; Zustimmungsvorbehalt, wenn der Vertrag den Zeitraum festlegt | Einrichtung Schritt 3 |
| 22 | 15 % bei Wärmepumpe ohne Erfassung nach dem 30.09.2025 | § 12 Abs. 3 S. 2: Verordnung erst ab dem Zeitraum nach der Installation; ohne Installation wörtlich nie; BT-Drs. 20/7619 schweigt zur Kürzung | Die Pflicht aus S. 1 ist verletzt, also gilt § 12 Abs. 1 S. 1 (15 %) | `heating.no-consumption` mit Vermerk „Auslegung“ |

### 15.2 Verbleibende Festlegungen ohne Primärquelle

Für jede Festlegung stehen hier der Rechercheweg, die konservativste oder verbreitetste Lösung und der Hinweis, den der Vermieter sieht. **Die Liste umfasst sechs Punkte.**

**F1: Gradtage als rechnerische Abgrenzung einer Versorgerrechnung** (Stufen 4 und 5 in 3.2)

- *Belegt ist:*
  - Eine Abgrenzung durch „sachgerechte Schätzung“ ist zulässig ([R] VIII ZR 156/11 Rn. 14).
  - Versorger grenzen bei Preisänderungen nach jahreszeitlichen Erfahrungswerten ab ([G] § 12 Abs. 2 GasGVV), praktisch mit örtlichen Gradtagzahlen des DWD ([M] NEW, DVGW G 685 nicht gelesen).
- *Nicht belegt:* dass Vermieter für die Abgrenzung die Promilletabelle des § 9b verwenden dürfen.
- *Lösung:*
  - Vorrang haben Zählerstand, Zwischenrechnung und Teilmengen laut Rechnung.
  - Danach kommen Ortswerte, wenn eingetragen, wie die Versorger.
  - Erst dann die Tabelle, weil sie ohne Wetterdaten auskommt. Sie ist nach § 9b Abs. 2 als Verteilung von Heizwärme anerkannt.
- *Hinweis:* `fuel.share-by-degree-days`.

**F2: Abweichung der Ablesung, ab der gewarnt wird** (3.5)

- *Belegt ist:*
  - Abweichungen sind unschädlich bei geringem Verbrauch ([R] OLG Schleswig, RE 04.10.1990).
  - Eine Ablesung am 20.02. ist bei Jahresende als Stichtag zu spät (AG Nordhorn).
  - Keine Rückrechnung nach Gradtagen (LG Osnabrück).
  - Kommentar bei Haufe: im Winter ein Monat „grundsätzlich als nicht zulässig“.
- *Lösung:* Werte wie abgelesen, immer ein Hinweis. Eine warning gibt es ab einem Monat Abweichung, wenn ein Monat von Oktober bis April dazwischen liegt. ⟨Norm offen: VDI 2077⟩
- *Hinweis:* `heating.reading-dates-differ`, `heating.interim-reading-off`.

**F3: Zwischenablesung neben dem Wechseltag**

- *Belegt ist:*
  - ista verwendet Monatsendwerte.
  - Brunata erfasst das Ablesedatum getrennt vom Wechsel und rechnet mit dem Wert.
- *Nicht belegt:* wie weit daneben noch zulässig ist.
- *Lösung:* wie F2.
- *Hinweis:* `heating.interim-reading-off`.

**F4: Zuordnung von Messdienstbeträgen zum Steuerjahr** (3.10)

- *Recherche:* § 11 Abs. 2 EStG verlangt den Abfluss.
- *Lösung:* Vereinfachung „Jahr der Zahlung“ je Position, benannt (15.1 Nr. 18).
- *Hinweis:* an der Steuerübersicht.

**F5: § 6a Abs. 3 Nr. 4 und 5**

- *Recherche:* Die Bekanntmachung der Vereinfachungen nach § 6a Abs. 3 S. 4 wurde nicht gefunden. Nächste amtliche Grundlage sind die GEG-Bekanntmachung „Regeln für Energieverbrauchswerte im Wohngebäudebestand“ (29.03.2021, BAnz 16.04.2021) und die [Klimafaktoren des DWD](https://www.dwd.de/DE/leistungen/klimafaktoren/klimafaktoren.html). Nr. 4 vermutlich in DIN 94680.
- *Lösung:* Hausdurchschnitt je m², so benannt, und Klimafaktor des DWD. ⟨Norm offen: DIN 94680⟩
- *Hinweis:* Der Druckblock nennt die Grundlage.

**F6: Plausibilitätsgrenzen**

- Betroffen: α unter 5 % oder über 50 %; CO₂-Kosten gegen Preis; G gegen V um 1 €.
- *Recherche:* keine Quelle.
- *Lösung:* nur Hinweise ohne Rechtsfolge.
- *Hinweis:* `heating.dhw-share-implausible`, `co2.cost-implausible`, `co2.service-fuel-mismatch`.

**Gegenüber der ersten Fassung belegt und gestrichen:**

| Punkt | Beleg |
|---|---|
| Zuordnung H → P „endet in P“ | Sachverhalt von [R] VIII ZR 240/07 |
| Bewertung des Endbestands | [M] Minol, Restbewertung |
| Ablesung nicht am Stichtag mit § 9a | ersetzt durch OLG Schleswig, AG Nordhorn, LG Osnabrück, VIII ZR 373/04 |
| ±1 Tag, 14 Tage Fortschreibung, 75 %, größte Überschneidung, 1 € Toleranz der Probe | entfallen |

### 15.3 Regeln, die an kostenpflichtigen Normen hängen

Ob VDI 2077 und DIN 94680:2024-05 beschafft werden, entscheidet der Nutzer. Bis dahin stützen sich diese Regeln auf die dokumentierte Praxis der Messdienste und tragen im Text, im Lexikon und im Ausweis die Marke ⟨Norm offen⟩.

| Regel | Abschnitt | Norm | Bis dahin gestützt auf | Lesen vor |
|---|---|---|---|---|
| Gradtagstabelle `hkv.degree-days` (Werte und Herkunft) | 3.5 | DIN 94680 | [M] ista, Berliner Mieterverein; Herkunft VDI 2067 Bl. 1 (1983) laut Minol | **PR 3** |
| Tageswerte (Monatswert ÷ Tage; Februar im Schaltjahr 150/29) | 3.5 | DIN 94680 | [M] ista nennt Tageswerte beispielhaft (Oktober 80/31; Sommer 40/92) | **PR 3** |
| Abgrenzung einer Versorgerrechnung nach Gradtagen | 3.2 | DIN 94680; DVGW G 685 | [G] GasGVV § 12 Abs. 2 analog; [M] NEW | PR 7 |
| Ablesung neben dem Stichtag, Warngrenze | 3.5, F2 | VDI 2077 | Rechtsprechung (sekundär), Haufe | PR 10 |
| Zwischenablesung neben dem Wechsel, Monatswerte | 3.5, F3 | VDI 2077 | [M] ista, Brunata | PR 10 |
| Gemessenes Q gegen Brennwert-kWh | 8.3, 15.1 Nr. 9 | VDI 2077 | Wortlaut § 9 | PR 10 |
| Selbst abgelesene elektronische HKV, Skalen und Bewertungsfaktoren | 8.1 | VDI 2077; DIN EN 834 | [M] Haufe, Berliner Mieterverein | PR 12 |
| Durchschnittsnutzer und Witterungsbereinigung (§ 6a Abs. 3 Nr. 4, 5) | 8.8, F5 | DIN 94680 | Hausdurchschnitt, Klimafaktor des DWD | PR 14 |
| Rohrwärme (Nicht-Ziel) | 16 | VDI 2077 (Beiblatt) | – | – |

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
| Prozentspanne als Rechenregel für den Betriebsstrom | Die Spannen sind Literaturwerte, die der BGH referiert, aber nicht billigt (V ZR 166/15 Rn. 14); gerechnet wird nach Anschlusswerten und Heiztagen |
| Rechtsberatung zur Eignung der Geräte (§ 5 Abs. 1 S. 2) und zu Bewertungsfaktoren | |
| Rechtswerte über das Netz | 4.5 |

---

## 17. Quellen

Gelesen am 05.10.2026, für diesen Entwurf oder in den drei Gegenprüfungen. Die übrigen Fundstellen stehen in den Teilentwürfen mit ihrem Prüfdatum.

**Gesetze** (gesetze-im-internet.de, im Wortlaut):

- HeizkostenV: [§ 5](https://www.gesetze-im-internet.de/heizkostenv/__5.html), [§ 6](https://www.gesetze-im-internet.de/heizkostenv/__6.html), [§ 6a](https://www.gesetze-im-internet.de/heizkostenv/__6a.html), [§ 7](https://www.gesetze-im-internet.de/heizkostenv/__7.html), [§ 8](https://www.gesetze-im-internet.de/heizkostenv/__8.html), [§ 9](https://www.gesetze-im-internet.de/heizkostenv/__9.html), [§ 9a](https://www.gesetze-im-internet.de/heizkostenv/__9a.html), [§ 9b](https://www.gesetze-im-internet.de/heizkostenv/__9b.html), [§ 12](https://www.gesetze-im-internet.de/heizkostenv/__12.html)
- CO2KostAufG: [§ 2](https://www.gesetze-im-internet.de/co2kostaufg/__2.html), [§ 3](https://www.gesetze-im-internet.de/co2kostaufg/__3.html), [§ 4](https://www.gesetze-im-internet.de/co2kostaufg/__4.html), [§ 5](https://www.gesetze-im-internet.de/co2kostaufg/__5.html), [§ 5a](https://www.gesetze-im-internet.de/co2kostaufg/__5a.html), [§ 5b](https://www.gesetze-im-internet.de/co2kostaufg/__5b.html), [§ 5d](https://www.gesetze-im-internet.de/co2kostaufg/__5d.html), [§ 7](https://www.gesetze-im-internet.de/co2kostaufg/__7.html), [§ 9](https://www.gesetze-im-internet.de/co2kostaufg/__9.html), [§ 11](https://www.gesetze-im-internet.de/co2kostaufg/__11.html)
- [GasGVV § 12](https://www.gesetze-im-internet.de/gasgvv/__12.html), [BetrKV § 2](https://www.gesetze-im-internet.de/betrkv/__2.html), [MessEV Anlage 7](https://www.gesetze-im-internet.de/messev/anlage_7.html), [MessEV § 34](https://www.gesetze-im-internet.de/messev/__34.html), [EStG § 11](https://www.gesetze-im-internet.de/estg/__11.html)

**Rechtsprechung:**

- BGH 30.04.2008, VIII ZR 240/07: [iww](https://www.iww.de/mk/quellenmaterial/id/31581), [rewis](https://rewis.io/urteile/urteil/x4d-29-04-2008-viii-zr-24007/)
- BGH 20.02.2008, VIII ZR 49/07: [Berliner Mieterverein](https://www.berliner-mieterverein.de/recht/mieturteile/bgh/bgh0810.htm)
- BGH 01.02.2012, VIII ZR 156/11: [rewis](https://rewis.io/urteile/urteil/s1c-01-02-2012-viii-zr-15611/), [Minol](https://www.minol.de/abrechnung-nach-dem-abflussprinzip-fuer-heizkosten-unzulaessig.html)
- BGH 27.07.2011, VIII ZR 316/10: [Berliner Mieterverein](https://www.berliner-mieterverein.de/recht/mieturteile/bgh/bgh1135.htm)
- BGH 12.01.2022, VIII ZR 151/20: [Berliner Mieterverein](https://www.berliner-mieterverein.de/recht/bgh/heiz-und-warmwasserkostenabrechnung.htm)
- BGH 14.11.2007, VIII ZR 19/07, und Instanzgerichte zur Zwischenablesung: [Berliner Mieterverein, Info 73](https://www.berliner-mieterverein.de/recht/infoblaetter/info-73-heizkostenabrechnung-worauf-achten-beim-mieterwechsel-zwischenablesung-und-gradtagszahlentabelle.htm), [Info 186](https://www.berliner-mieterverein.de/recht/infoblaetter/info-186-die-kuerzungsrechte-bei-der-heizkostenabrechnung.htm), [AG Schöneberg](https://www.berliner-mieterverein.de/recht/mieturteile/06003agschoeneberg22605.htm)
- BGH 17.11.2010, VIII ZR 112/10: [LTO](https://www.lto.de/recht/nachrichten/n/bgh-auch-nicht-geeichte-wasserzaehler-koennen-betriebskosten-fuer-mieter-begruenden)
- BGH 16.11.2005, VIII ZR 373/04: [iww](https://www.iww.de/mk/quellenmaterial/id/3501)
- BGH 28.09.2011, VIII ZR 294/10: [Berliner Mieterverein](https://www.berliner-mieterverein.de/recht/bgh/bgh1145.htm)
- BGH 03.06.2016, V ZR 166/15: [rewis](https://rewis.io/urteile/urteil/phc-03-06-2016-v-zr-16615/), [Haufe](https://www.haufe.de/immobilien/verwaltung/bgh-betriebsstrom-ist-kein-allgemeinstrom_258_383140.html)
- BGH 20.05.2026, VIII ZR 46/25, 47/25: [otto-schmidt](https://www.otto-schmidt.de/news/zivil-und-zivilverfahrensrecht/zur-umlage-von-warmelieferungskosten-auf-die-mieter-bei-umstellung-von-durch-die-mieter-betriebenen-einzelofen-auf-eine-warmelieferung-2026-05-22.html)
- Ablesezeitpunkt (OLG Schleswig, AG Nordhorn, LG Osnabrück): [Haufe](https://www.haufe.de/id/beitrag/heizkv-ablesung-und-abrechnungs-und-verbrauchsinformat-3-ablesezeitpunkt-HI14901091.html), [mietrecht.org](https://www.mietrecht.org/heizkosten/heizkostenabrechnung-stichtag-ablesung/)

**Praxis der Messdienste und Verbände:**

- [ista: Gradtagszahlentabelle](https://www.ista.com/de/kontakt-service/fachwissen/gradtagszahlentabelle/), [ista: Zwischenablesung](https://www.ista.com/de/kontakt-service/vermieter-oder-verwalter/zwischenablesung/), [ista: Mess- und Eichverordnung](https://www.ista.com/de/gesetze-und-verordnungen/mess-und-eichverordnung/)
- [Minol: Gradtagzahlen](https://www.minol.de/blog/gradtagzahlen-in-der-heizkostenabrechnung/), [Minol: Restbewertung](https://www.minol.de/restbewertung.html)
- [Brunata: Auftrag Änderung Abrechnungszeitraum](https://www.brunata-metrona.de/downloads/allgemein/m/BRUNATA_Aenderung_Abrechnungszeitraum_Auftrag.pdf); Brunata-Ausfüllanleitung Nutzerdatenaufstellung 07/2019 (sekundär)
- [bved-FAQ](https://bved.info/veroeffentlichungen/faq-zur-verbrauchsabhangigen-abrechnung-und-zm-co2-kostenaufteilungsgesetz/)
- [Haufe/GdW 7.7.1](https://www.haufe.de/id/beitrag/gdw-aufteilung-der-kohlendioxidkosten-co2kostaufg-in-771-ermittlung-der-im-zugrunde-zu-legenden-abrechnungszeitraum-verbrauchten-brennstoffmenge-HI16464215.html)
- [NEW: Mengenaufteilung Gas](https://www.new-energie.de/mediathek/mengenaufteilung_innerhalb_eines_abrechnungszeitraums_fuer_gaskunden.pdf)
- [LBME NRW: Versorgungsmessgeräte](https://www.lbme.nrw.de/system/files/media/document/file/e_info_versorgungsmessgeraete_2023-03-29.pdf)
- [delta-t: Zwischenablesung](https://delta-t.de/info-center/zwischenablesung/)

**Software:** [objego: Gradtagszahlen](https://www.objego.de/blog/gradtagszahlen-nebenkostenabrechnung/); Immoware24, immocloud, mibakus und NebenkostenFix laut Marktvergleich vom 04.10.2026.

**Normen, nicht gelesen** (15.3): VDI 2077, [DIN 94680:2024-05](https://www.dinmedia.de/en/standard/din-94680/377238518), VDI 2067 Bl. 1 (1983), DIN 4713 Teil 5, DVGW G 685, DIN EN 834, DIN EN 1434.
