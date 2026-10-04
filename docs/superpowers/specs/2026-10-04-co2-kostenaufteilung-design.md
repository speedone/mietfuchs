# Spezifikation: CO₂-Kostenaufteilung (#97, Entscheidung 2 aus #85)

Entwurf vom 04.10.2026, Stand `main` (db77c94). Baut auf #203 auf (eine Rundungsregel, Vermieter als gewöhnliche Zeile).
Rechtsstand: CO2KostAufG in der Fassung durch Art. 5 G v. 23.07.2026 (BGBl. 2026 I Nr. 226), in Kraft seit 29.07.2026; Wortlaut am 04.10.2026 auf gesetze-im-internet.de gelesen.

---

## 1. Ziel in einfachen Worten

Seit 2023 zahlt der Vermieter einen Teil der CO₂-Kosten der Heizung, und zwar umso mehr, je mehr CO₂ das Haus je Quadratmeter ausstößt. Die nötigen Zahlen stehen auf der Rechnung des Gas-, Öl- oder Fernwärmelieferanten: Kilogramm CO₂ und CO₂-Kosten in Euro. Bei einem Messdienst stehen sie schon fertig in dessen Abrechnung.

Mietfuchs soll:

- aus diesen Angaben und der Wohnfläche die **Stufe** bestimmen (Anlage zum CO2KostAufG) und daraus den **Vermieteranteil** in Euro;
- den Anteil des Vermieters **als eigene Zeile** von den Heizkosten der Mieter abziehen und auf der Seite Abrechnung unter „Vermieteranteil“ zeigen;
- auf der gedruckten Abrechnung **Mieteranteil, Einstufung und Berechnungsgrundlagen** ausweisen (§ 7 Abs. 3);
- **warnen und die 3-%-Kürzung je Mieter beziffern**, wenn die Aufteilung fehlt oder unvollständig ist (§ 7 Abs. 4).

Für wen: privater Vermieter mit 1 bis 10 Wohnungen, Zentralheizung mit Gas, Öl, Flüssiggas oder Fernwärme, oft mit Messdienst. Abrechnungsjahre 2023 bis 2026.

**Wer nichts einträgt, bekommt keine andere Zahl.** Ohne CO₂-Angaben bleibt jede Verteilung centgenau, wie sie ist. Neu ist nur ein Hinweis bei Heizpositionen ab 2023 (siehe 7.1).

---

## 2. Rechtslage mit Fundstellen

Alle Zitate sind am 04.10.2026 auf gesetze-im-internet.de nachgelesen. Wo der BMWK-Rechner genannt ist, wurde sein ausgelieferter Code gelesen (`/assets/index-ccf7eb1c.js`).

### 2.1 Anwendungsbereich

- **§ 2 Abs. 1:** Das Gesetz gilt für Gebäude, deren Heizung oder Warmwasser Brennstoffe nutzt, für die die EBeV Standard-Emissionsfaktoren festlegt. Das sind Erdgas, Heizöl, Flüssiggas und Kohle. Es gilt auch für die gewerbliche Wärmelieferung, also Fernwärme und Contracting. Holz und Pellets sind nicht erfasst, Wärmepumpe und Strom ebenso nicht.
- **§ 2 Abs. 4:** Das Gesetz gilt auch für Wärme aus Anlagen im EU-Emissionshandel. Das gilt **nicht**, wenn ein Gebäude **erstmals nach dem 1. Januar 2023** an ein solches Netz angeschlossen wurde.
- **§ 2 Abs. 5:** Das Gesetz geht § 6 Abs. 1 HeizkostenV und Vereinbarungen im Mietvertrag vor.
- **§ 2 Abs. 7:** In den Fällen des § 11 HeizkostenV gilt das Gesetz nicht, es sei denn, eine Abrechnung ist vereinbart.
- **§ 11 Abs. 2:** Das Gesetz gilt für Abrechnungszeiträume, die **am oder nach dem 01.01.2023 beginnen**. CO₂-Kosten aus Brennstoff, der **vor dem 01.01.2023 in Rechnung gestellt** wurde, bleiben unberücksichtigt. Das betrifft vor allem Öl, das noch im Tank lag.
- **§ 11 Abs. 1:** Für Altverträge erfasst die Umlagevereinbarung den Vermieteranteil nicht.

### 2.2 Angaben auf der Rechnung (§ 3)

**§ 3 Abs. 1:** Auf Rechnungen für Brennstoff oder Wärme müssen stehen:

1. die Brennstoffemissionen in **kg CO₂**,
2. der **Preisbestandteil der CO₂-Kosten**,
3. der heizwertbezogene Emissionsfaktor in kg CO₂/kWh,
4. der Energiegehalt in kWh,
5. ein Hinweis auf die Erstattungsansprüche,
6. **neu seit 29.07.2026:** der Preisbestandteil des Pflicht-Biobrennstoffanteils bei Heizungen nach § 43 GModG.

**§ 3 Abs. 3:** Der Preisbestandteil ist Emissionen × maßgeblicher Zertifikatepreis (§ 4) **zuzüglich Umsatzsteuer**. Der Betrag auf der Rechnung ist also brutto, so wie Mietfuchs die Heizkosten ohnehin führt.

**§ 3 Abs. 4:** Fernwärme hat dieselbe Pflicht. Bei einem Netz aus mehreren Anlagen gilt ein einheitlicher Emissionsfaktor. Für den Anteil aus EU-ETS-Anlagen gilt der Durchschnittspreis der Versteigerungen des Vorjahres.

**Folge für Mietfuchs:** Die Hauptgrößen werden **abgeschrieben, nicht berechnet**. Standardwerte braucht es nur als Rückfall (siehe 2.6).

### 2.3 Preis (§ 4) – nur für Rückfall und Plausibilität

| Lieferjahr | Preis je t CO₂ | Fundstelle |
|---|---|---|
| 2023 | 30 € | § 4 Abs. 1 Nr. 1; DEHSt (Stand 16.12.2025) |
| 2024 | 45 € | ebd. |
| 2025 | 55 € | ebd. |
| 2026 | 60 € (Mittelwert des Korridors 55–65) | § 4 Abs. 1 Nr. 2; DEHSt |
| 2027 | Durchschnitt der Versteigerungen 01.07.–30.11.2026; das UBA veröffentlicht ihn spätestens zehn Werktage vor Jahresbeginn (§ 4 Abs. 2) | **offen**, noch nicht veröffentlicht |

Für Fernwärme aus EU-ETS-Anlagen nennt die DEHSt die Durchschnittspreise des jeweiligen Vorjahres:

| Rechnungsjahr | Preis je t CO₂ |
|---|---|
| 2023 | 80,40 € |
| 2024 | 83,68 € |
| 2025 | 65,01 € |
| 2026 | 73,86 € |

Diese Werte werden nur für den Hinweis „CO₂-Kosten passen nicht zu den kg“ gebraucht, nicht für die Verteilung.

### 2.4 Einstufung und Aufteilung (§ 5, Anlage)

**§ 5 Abs. 1 S. 1–2:** Maßstab ist der CO₂-Ausstoß **des Gebäudes in kg je m² Wohnfläche und Jahr**. Vermietet der Vermieter mehrere Wohnungen mit gesonderter oder zentraler Versorgung, zählt deren Gesamtwohnfläche.

**§ 5 Abs. 1 S. 3:** Der Wert wird **auf die erste Nachkommastelle gerundet**, und zwar vor der Einstufung.

**§ 5 Abs. 1 S. 4:** Ist ein Abrechnungszeitraum **unter einem Jahr vereinbart**, werden **die Werte der Tabelle anteilig gekürzt**. Der Verbrauch wird nicht hochgerechnet.

**§ 5 Abs. 1 S. 5:** Weichen die Zeiträume der Lieferrechnungen vom Abrechnungszeitraum ab, sind die Emissionen auf den vereinbarten Zeitraum **umzurechnen**. Wie, sagt das Gesetz nicht.

**§ 5 Abs. 2:** Der Wert wird in die Tabelle der Anlage eingeordnet.

Stufentabelle der Anlage (unten einschließend, oben ausschließend; abgeglichen mit dem BMWK-Rechner):

| kg CO₂/m²/a | Mieter | Vermieter |
|---|---|---|
| < 12 | 100 % | 0 % |
| 12 bis < 17 | 90 % | 10 % |
| 17 bis < 22 | 80 % | 20 % |
| 22 bis < 27 | 70 % | 30 % |
| 27 bis < 32 | 60 % | 40 % |
| 32 bis < 37 | 50 % | 50 % |
| 37 bis < 42 | 40 % | 60 % |
| 42 bis < 47 | 30 % | 70 % |
| 47 bis < 52 | 20 % | 80 % |
| ≥ 52 | 5 % | 95 % |

**§ 5 Abs. 3:** Versorgt sich der Mieter selbst, stuft **der Mieter** seine Wohnung ein.

### 2.5 Abrechnung, Ausweis, Kürzung (§ 7)

- **§ 7 Abs. 1:** Der Vermieter berechnet Ausstoß und CO₂-Kosten, **zieht seinen Anteil ab** und verteilt den Rest **nach dem Schlüssel der Heizkosten** (§§ 6–10 HeizkostenV).
- **§ 7 Abs. 2:** Im selbstbewohnten Zweifamilienhaus und in den Fällen des § 11 HeizkostenV mit vereinbarter Abrechnung trägt der Mieter die nach Abs. 1 auf ihn entfallenden Kosten nach dem vereinbarten Verfahren. **Die Aufteilung gilt also auch dort**, nur die Verteilung ist frei.
- **§ 7 Abs. 3:** In der Heizkostenabrechnung sind auszuweisen: der **Anteil des Mieters** an den CO₂-Kosten, die **Einstufung** und die **Berechnungsgrundlagen**.
- **§ 7 Abs. 4:** Fehlt die Aufteilung oder der Ausweis, darf der Mieter „den gemäß der Heizkostenabrechnung auf ihn entfallenden Anteil an den Heizkosten um **3 Prozent** kürzen“.
- **§ 7 Abs. 5 (neu):** Dasselbe gilt für die Kosten nach § 5a, also ab 2028.

### 2.6 Standardwerte (EBeV 2030, Anlage 2 Teil 4)

Diese Werte sind nur der Rückfall, wenn auf der Rechnung keine kg stehen. Sie gelten heizwertbezogen (Hᵢ):

| Brennstoff | EBeV | kg CO₂/kWh Hᵢ | BMWK-Rechner |
|---|---|---|---|
| Erdgas | 0,0558 t/GJ | 0,20088 | 0,20088 |
| Heizöl EL | 0,074 t/GJ; 0,845 t/1000 l; 42,8 GJ/t → 2,6762 kg/l | 0,2664 | 0,2664 |
| Flüssiggas | 0,0655 t/GJ; 46,0 GJ/t → 3,013 kg/kg | 0,2358 | 0,2358 |

**Falle bei Erdgas:** Gasrechnungen nennen kWh **brennwertbezogen** (Hₛ). Die EBeV rechnet MWh Hₛ mit 3,2508 GJ Hᵢ um (= 3,6 × 0,903). Je kWh Hₛ sind das 0,18139 kg.

Nachgerechnet: 150.000 kWh Hₛ ergeben 27.209 kg. Wer stattdessen mit 0,20088 multipliziert, kommt auf 30.132 kg. Bei 700 m² sind das 38,9 statt 43,0 kg/m², also **Stufe 60 % statt 70 %**. Deshalb gilt: kg von der Rechnung haben Vorrang, und der Rückfall fragt ausdrücklich nach „kWh (Heizwert)“ oder rechnet aus Hₛ um.

### 2.7 Sonderfälle

- **§ 6 Abs. 1:** Abweichende Vereinbarungen zulasten des Mieters sind in einem **Wohngebäude** unwirksam, also in einem Gebäude, das nach seiner Zweckbestimmung überwiegend dem Wohnen dient. Das gilt auch für Räume, die keine Wohnräume sind, etwa einen Laden im Wohnhaus.
- **§ 8 (Nichtwohngebäude):** Der Mieter trägt höchstens **50 %**, gleich ob Wohnung oder Gewerbe. Ein Stufenmodell für Nichtwohngebäude kündigt § 8 Abs. 4 „im Jahr 2025“ an; es ist nie erlassen worden, der Satz steht unverändert im Text.
- **§ 9:** Stehen öffentlich-rechtliche Vorgaben einer **wesentlichen energetischen Verbesserung des Gebäudes** oder **der Wärmeversorgung** entgegen, halbiert sich der Vermieteranteil. Beispiele: Denkmalschutz, Anschluss- und Benutzungszwang, Erhaltungssatzung. Stehen beide entgegen, wird **gar nicht** aufgeteilt (Abs. 2). Der Vermieter muss die Umstände nachweisen (Abs. 3). Der BMWK-Rechner rechnet das ebenso: je Grund 0,5.
- **§ 6 Abs. 2 und 3 (Selbstversorger):** Der Vermieter **erstattet** dem Mieter seinen Anteil.
  - Der Mieter macht ihn **binnen 12 Monaten** ab der Lieferantenabrechnung in Textform geltend; das ist eine Ausschlussfrist.
  - Der Vermieter kann mit der **nächsten Betriebskostenabrechnung verrechnen**, sonst zahlt er binnen 12 Monaten nach der Anzeige.
  - Bei Mitnutzung für eigene Geräte, etwa einen Gasherd, kürzt sich der Anspruch um **5 %**. Bei gewerblicher Mitnutzung braucht der Mieter einen Zähler.
  - § 6 Abs. 2 S. 6 sieht seit 29.07.2026 einen Hinweis in Textform bei Vertragsschluss vor (siehe 11.8).
- **§§ 5a, 5b, 5d (ab 2028):** Bei Heizungen nach § 43 GModG werden CO₂-Kosten und Gas-Netzentgelte **hälftig** geteilt, **abweichend vom Stufenmodell**; ab 2029 auch der Pflicht-Biobrennstoffanteil, höchstens 30 %. § 5d regelt Härtefälle, darunter das selbstbewohnte Zweifamilienhaus außerhalb angespannter Märkte.

### 2.8 BMWK-Rechner (`co2kostenaufteilung.bundeswirtschaftsministerium.de`)

Gelesen im ausgelieferten Code. Was er tut:

- Er nimmt die Faktoren aus 2.6.
- Er berechnet die CO₂-Kosten als kg/1000 × Preis × (1 + USt). Für Gas und Fernwärme setzt er vom 01.10.2022 bis 31.03.2024 tagesanteilig **7 %** an, sonst 19 %.
- Ein Zeitraum innerhalb eines Jahres wird **auf 365 Tage hochgerechnet**. Für die Einstufung ist das gleichwertig zur Kürzung der Tabelle.
- § 9 rechnet er mit 0,5 je Grund.
- Bei Fernwärme mit „Erstmaliger Anschluss ab dem 1. Januar 2023“ setzt er den Vermieteranteil auf 0, ohne nach EU-ETS zu fragen.
- Die Anteile rundet er auf zwei Stellen (`toFixed(2)`).

**Abweichungen vom Gesetz, die die Tests festhalten müssen:**

1. Der Rechner **rundet den kg/m²-Wert nicht** auf eine Nachkommastelle (§ 5 Abs. 1 S. 3).
2. Er prüft `d >= min && d <= max` und nimmt den ersten Treffer. Genau **12,0 landet damit in der Stufe „< 12“ (0 %)**, nach der Anlage gehört es in 10 %. Dasselbe gilt an jeder Grenze.
3. Seine Preistabelle endet bei 2025, der Code ist also älter als 2026.

**Mietfuchs folgt dem Gesetz.** Nachgerechnet wird nur an Werten abseits der Grenzen.

---

## 3. Fälle

| # | Lage | Was Mietfuchs tut |
|---|---|---|
| F1 | **Messdienst liefert die Aufteilung** (häufigster Fall; Heizposition mit Schlüssel `amounts`, bei ETW `external`) | Modus „Übernommen“: Einstufungswert (kg/m²/a), Vermieter-%, CO₂-Kosten gesamt und Vermieteranteil gesamt aus der Messdienstabrechnung abschreiben. Optional den Vermieteranteil je Nutzer, sonst verteilt Mietfuchs ihn wie die Heizkosten (siehe 5.3). Mietfuchs rechnet die Stufe aus dem Einstufungswert nach und meldet eine Abweichung als Hinweis. |
| F2 | **Eigenabrechnung ohne Messdienst** (Heizkosten als Positionen nach Wärmezähler und Fläche, oder nach Fläche mit 15-%-Warnung) | Modus „Selbst ermittelt“: eine Zeile je Lieferrechnung mit kg CO₂ und CO₂-Kosten. Wohnfläche ist vorbelegt. Mietfuchs rundet, stuft ein, rechnet den Vermieteranteil und zieht ihn ab. |
| F3 | **Fernwärme** | Wie F2. Die Werte kommen von der Rechnung des Wärmelieferanten (§ 3 Abs. 4). Kein Standardwert-Rückfall, denn der Emissionsfaktor ist netzspezifisch. Schalter „Anschluss erstmals nach dem 01.01.2023 an ein Netz mit Anlagen im EU-Emissionshandel“ → keine Aufteilung (§ 2 Abs. 4 S. 2). |
| F4 | **Mehrere Lieferungen im Jahr** (Öl, Flüssiggas) | Mehrere Zeilen; summiert werden kg und Euro. Je Zeile ein **anzusetzender Anteil** (Vorgabe 100 %) für Tankbestand oder abweichenden Rechnungszeitraum, mit Grund. Eine Lieferung mit Rechnungsdatum vor dem 01.01.2023 zählt 0 (§ 11 Abs. 2 S. 2), mit Hinweis. |
| F5 | **Rechnungszeitraum ≠ Kalenderjahr** (Gasrechnung 15.03.–14.03.) | Je Zeile optional der Rechnungszeitraum. Mietfuchs schlägt den Anteil tagesgenau vor (Tage im Abrechnungsjahr / Tage der Rechnung). Der Nutzer kann ihn überschreiben, etwa mit den Zahlen eines Zwischenstands. Linear ist eine Vorgabe und keine Rechtsregel (siehe 11.4). |
| F6 | **Teiljahr** | Ein **Mieterwechsel ist kein Teiljahr**: Die Einstufung gilt für das Gebäude und das Jahr, der Mieter trägt seinen Anteil über den Schlüssel; dazu gibt es einen eigenen Test. Ein echter kürzerer Abrechnungszeitraum (Kauf oder Fertigstellung im Jahr, Umstellung) wird als Zeitraum der CO₂-Angaben erfasst. Dann werden die **Tabellengrenzen** mit Tage/Tage des Jahres gekürzt (§ 5 Abs. 1 S. 4). |
| F7 | **Selbstversorger** (Etagenheizung, eigener Gasvertrag) | **Erfassung, nicht nur Hinweis** (eigene PR, siehe 12): Erstattung je Mietverhältnis mit Anzeige-Datum, Datum der Lieferantenabrechnung, Betrag (Mietfuchs hilft beim Rechnen aus den Angaben der Mieterrechnung, ±5 % Gasherd) und Jahr der Verrechnung. Sie erscheint als Gutschrift-Zeile in der Abrechnung dieses Jahres, mit Hinweisen zu beiden 12-Monats-Fristen. **Begründung:** Heute bleibt nur der Kniff einer negativen Direktzuordnung, und der landet in der Steuerübersicht als negative Werbungskosten und auf der Abrechnung als „Heizung“. |
| F8 | **Gemischt genutztes Gebäude** | Im Zielbild, weil billig: ein Schalter „Gebäude dient nicht überwiegend dem Wohnen (Nichtwohngebäude)“ → Vermieter 50 % fest (§ 8), keine Stufe. Vorgabe ist das Wohngebäude, wo auch der Laden im Erdgeschoss unter das Stufenmodell fällt. |
| F9 | **§ 9: Denkmal, Anschlusszwang, Erhaltungssatzung** | Auswahl „Einschränkung nach § 9“: keine · Gebäude · Versorgung · beides. Halbiert den Vermieteranteil oder hebt die Aufteilung auf, mit Hinweis auf die Nachweispflicht. Kostet eine Spalte, und die Fernwärme mit Anschlusszwang ist ein realer Fall. |
| F10 | **Zweifamilienhaus mit Eigennutzung** | Die Aufteilung gilt (§ 7 Abs. 2). Keine Sonderbehandlung, kein Ausnahmehinweis wie bei § 2 HeizkostenV. |
| F11 | **Pauschale oder Inklusivmiete bei der Heizung** (#93) | Keine Abrechnung, also kein Abzug. Der Anteil bleibt ohnehin beim Vermieter. Hinweis nur im Lexikon; ob die Pauschale wegen § 6 Abs. 1 zu senken ist, ist offen (siehe 11.7). |
| F12 | **Wärmepumpe, Holz, Pellets, Strom** | Energieträger wählen → keine CO₂-Aufteilung, keine Hinweise. |
| F13 | **ab 2028, § 5a** | Nicht gebaut, nur vorbereitet (siehe 10). |

---

## 4. Datenmodell

Migration `0014_co2.sql`, erzeugt mit `npm --prefix server run db:generate`. Nur neue Tabellen und eine nullbare Spalte, also **keine Datenanweisung nötig**. Der eingefrorene Eingang (`server/src/legacy/`) bleibt unberührt, denn die db.json kennt keine CO₂-Angaben.

### 4.1 `properties.heating_energy` (neu, nullbar)

Werte: `'gas' | 'oil' | 'lpg' | 'districtHeating' | 'coal' | 'heatPump' | 'biomass' | 'none' | 'other'`. `null` heißt unbekannt.

Gebraucht wird die Spalte nur, um **ohne CO₂-Angaben** zwischen Warnung und Hinweis zu unterscheiden. Sie liegt deshalb am Objekt und nicht am Jahr: Sie beschreibt die heutige Anlage, und ein Heizungstausch steht in den Angaben des jeweiligen Jahres (4.2). Prüfbedingung `oneOf`.

### 4.2 `co2_statements` – eine Zeile je (Objekt, Jahr)

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | text PK | |
| `property_id` | text, `RESTRICT` | wie alle Wurzeln |
| `year` | integer | Abrechnungsjahr |
| `source` | `'own' \| 'service'` | selbst ermittelt oder übernommen (Messdienst, WEG) |
| `fuel` | wie `heating_energy` ohne `null` | Energieträger dieses Jahres, vorbelegt vom Objekt |
| `area_m2` | real, nullbar, > 0 | Wohnfläche für die Einstufung; `null` = Vorgabe (siehe 5.1) |
| `period_from`, `period_to` | text, nullbar | nur für einen Abrechnungszeitraum unter einem Jahr; beide oder keiner |
| `non_residential` | boolean, Vorgabe 0 | § 8 |
| `restriction` | `'none' \| 'building' \| 'supply' \| 'both'`, Vorgabe `'none'` | § 9 |
| `district_ets_new` | boolean, Vorgabe 0 | § 2 Abs. 4 S. 2, nur bei Fernwärme |
| `service_kg_per_m2` | real, nullbar | Modus `service`: Einstufungswert laut Messdienst |
| `service_landlord_percent` | integer, nullbar, 0–100 | Modus `service`: Vermieteranteil laut Messdienst |
| `service_total_cents` | integer, nullbar | Modus `service`: CO₂-Kosten gesamt |
| `service_landlord_cents` | integer, nullbar | Modus `service`: Vermieteranteil gesamt in € |

- **Index:** eindeutig `(property_id, year)`. Das ist zugleich die Zusicherung „höchstens eine je Objekt und Jahr“, wie bei `closed_settlements`.
- **Bedingungen:** `period_*` beide oder keiner; `service_*` nur bei `source='service'`; Prozent zwischen 0 und 100.
- **Warum ein eigener Datensatz je Jahr und nicht Felder an der Kostenposition:** Die CO₂-Kosten stecken im **ganzen Topf** der Heizkosten. Wer nach der Warnung von #140 eine Position nach Wärmezähler (70 %) und eine nach Fläche (30 %) anlegt, hat den Brennstoff auf zwei Positionen. § 7 Abs. 1 S. 2 verteilt den Mieterteil der CO₂-Kosten nach dem Schlüssel der Heizkosten, und das ist die Mischung beider Positionen. Felder an einer Position könnten das nicht abbilden.
- **Warum nicht am Objekt:** Fläche, Energieträger und § 9 können sich ändern. Am Objekt änderte eine Korrektur still die Vorjahre; je Jahr friert der Abschluss sie ein.

### 4.3 `co2_deliveries` – Lieferrechnungen (Modus `own`)

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | text PK | |
| `statement_id` | text, `CASCADE` | |
| `label` | text | z. B. „Stadtwerke, Jahresrechnung“ |
| `invoice_date` | text, nullbar | für § 11 Abs. 2 S. 2 |
| `period_from`, `period_to` | text, nullbar | Rechnungszeitraum |
| `emissions_kg` | real, ≥ 0 | § 3 Abs. 1 Nr. 1 |
| `co2_cost_cents` | integer | § 3 Abs. 1 Nr. 2, brutto; ohne Vorzeichenbedingung (Gutschrift einer Korrekturrechnung) |
| `energy_kwh`, `emission_factor` | real, nullbar | Nr. 3 und 4, nur für den Ausweis und den Rückfall |
| `share_permille` | integer 0–1000, Vorgabe 1000 | anzusetzender Anteil |
| `share_reason` | `'period' \| 'stock' \| null` | Grund dafür |

Der Anteil steht in Promille statt als Fließkommazahl, damit die Grundlagen auf der Abrechnung genau so dastehen, wie gerechnet wurde („9/12“ wird 750 ‰). Angesetzt werden `emissions_kg × share/1000` und `round(co2_cost_cents × share/1000)`.

### 4.4 `co2_tenant_reliefs` – Vermieteranteil je Mietverhältnis laut Messdienst (optional)

Primärschlüssel `(statement_id, tenancy_id)`. Fremdschlüssel `CASCADE` auf beide Seiten. Spalte `cents` ≥ 0.

Kein Verweis über Objektgrenzen: Die Prüfung `guardTenancy` / `sameProperty` gilt hier ebenso, ein Verstoß ist ein `CrossPropertyError` mit 400. `crossPropertyViolations` beim Wiederherstellen fragt die Tabelle mit ab.

### 4.5 `co2_refunds` – Erstattungen an Selbstversorger (eigene PR)

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | text PK | |
| `tenancy_id` | text, `CASCADE` | |
| `settle_year` | integer | Jahr der Verrechnung, also die Betriebskostenabrechnung, in der die Gutschrift steht |
| `supplier_billed_at` | text | Datum der Lieferantenabrechnung des Mieters |
| `claimed_at` | text | Anzeige in Textform |
| `amount_cents` | integer, ≥ 0 | |

Dazu nullbar die Rechengrundlagen aus der Mieterrechnung: `emissions_kg`, `co2_cost_cents`, `area_m2`, `own_appliances` (Gasherd, −5 %), `period_from`, `period_to`. Sind sie da, rechnet Mietfuchs den Betrag vor; überschreiben darf der Nutzer.

### 4.6 Gemeinsames Modell (`shared/types.ts`)

- `HeatingEnergy` als Vereinigungstyp, `Property.heatingEnergy?: HeatingEnergy | null`.
- `Co2Statement`, `Co2Delivery`, `Co2Refund`, `Co2Restriction`.
- `LandlordReason` bekommt `'co2Share'`.
- `SettlementRow` bekommt `kind?: 'co2Relief'`. Die Zeile hat **keine Kostenposition**, `costItemId` ist dann `co2:<statementId>`. Abrechnung.tsx und tenantFolder.ts suchen damit keinen Beleg; beide sind zu prüfen.
- `Settlement` bekommt `co2?: Co2Assessment`. Optional, weil vorher abgeschlossene Abrechnungen es nicht kennen. Inhalt:
  - Quelle, Energieträger, Zeitraum, Wohnfläche und ihre Herkunft
  - kg gesamt, Wert genau und gerundet, Faktor der Tabellenkürzung
  - Stufe (von, bis, Mieter %, Vermieter %), § 8, § 9
  - CO₂-Kosten gesamt, Vermieteranteil gesamt
  - die angesetzten Lieferzeilen
  - Grund, wenn nicht aufgeteilt wurde
- `Statement.co2?: { tenantCo2Cents, reliefCents }`.

`schema.test.ts` hält Schema und Typen zusammen. `Settlement.co2` friert mit dem Abschluss ein, ohne weitere Arbeit, denn der Schnappschuss ist JSON.

### 4.7 Schnappschuss, Routen, Backup

- **snapshot.ts:** `co2` = Datensatz des Jahres samt Zeilen und Einzelwerten, eingegrenzt nach `property_id` und `year`. Er trägt sein Jahr als Feld, darf also gefiltert werden. `property.heatingEnergy` kommt dazu wie `cableBuiltBeforeDec2021`. `co2Refunds` werden nach `settle_year` eingegrenzt.
- **Routen:**
  - `GET` und `PUT /api/co2/:year?property=` für einen Datensatz samt Zeilen. Geschrieben wird in einer Transaktion durch `writeData`, ganz oder gar nicht, wie der Mieterwechsel (#150).
  - `DELETE /api/co2/:year`.
  - `GET /api/co2/:year/preview` gibt die Einstufung zurück, ohne zu speichern, für die Live-Vorschau im Formular. Die Oberfläche **rechnet nicht selbst**, sonst gäbe es zwei Stufentabellen.
  - Für Erstattungen kommt `co2Refunds` in die generischen CRUD-Routen.
- **Backup und Wiederherstellen:** Die Datenbank geht ganz mit, es ist nichts zu tun. Der Validator betrifft nur die db.json, auch dort ist nichts zu tun.

---

## 5. Berechnung

Neue Datei `server/src/co2.ts` mit reinen Funktionen ohne Speicherzugriff. Aufgerufen wird sie aus `computeSettlement`.

### 5.1 Einstufung: `co2Assessment(snapshot) → Co2Assessment | null`

1. **Ist das Gesetz anwendbar?**
   - Jahr ≥ 2023 (Regel `co2-split`, `ruleCoverage`). Davor: `null`.
   - `fuel` ∈ {gas, oil, lpg, coal, districtHeating, other}.
   - Bei Fernwärme mit `district_ets_new` gilt das Gesetz nicht: keine Aufteilung, Grund im Ergebnis.
2. **Fläche** = `area_m2` oder als Vorgabe die Summe `areaM2` aller Einheiten, die
   - an einer Heizposition des Jahres teilnehmen (Teilnehmer oder alle) und
   - eine Wohnung sind (`isDwelling`, wie § 2 HeizkostenV).

   Das schließt selbstgenutzte Wohnungen ein, denn § 5 Abs. 1 S. 1 meint das Gebäude. Garagen fallen heraus. Die Herkunft der Fläche steht im Ergebnis.
3. **Emissionen** E = Σ `emissions_kg × share/1000` der Zeilen mit `invoice_date` ≥ 2023-01-01 oder ohne Datum. Zeilen davor zählen 0, mit Hinweis.
4. **Spezifischer Wert**: `tenths = Math.floor(E × 10 / Fläche + 0,5 + 1e-9)`, also kaufmännisch auf 0,1. Ein Wert, der durch Gleitkomma knapp unter x,x5 liegt, darf nicht abrunden. Fläche 0 → `null` und `co2.incomplete`.
5. **Tabellenkürzung:** Bei Zeitraum unter einem Jahr gilt f = Tage/Tage des Jahres, sonst 1. Die Stufe ist die erste, für die `tenths < Grenze × 10 × f` gilt. Verglichen wird ganzzahlig, wo f = 1. Bei f < 1 wird mit Toleranz 1e-9 verglichen, und der Rechenweg nennt die gekürzten Grenzen.
6. **Vermieter-%:**
   - § 8 → 50 %, sonst die Tabelle.
   - § 9: `building` oder `supply` → Hälfte, `both` → 0 und Grund „keine Aufteilung (§ 9 Abs. 2)“.
   - Werte wie 2,5 % sind möglich (Stufe 5 % → halbiert 2,5 %). Gespeichert wird deshalb in **Promille**, also 25.
7. **CO₂-Kosten** C = Σ `round(co2_cost_cents × share/1000)`. Der Vermieteranteil gesamt ist L = C × ‰/1000, als exakter Wert, gerundet erst in 5.3.
8. **Modus `service`:** Wert, Prozent, C und L kommen aus den `service_*`-Feldern.
   - Mietfuchs stuft `service_kg_per_m2` nach (Schritte 4–6). Weicht das Ergebnis von `service_landlord_percent` ab → `co2.stage-mismatch` (hint).
   - Weicht `service_landlord_cents` von C × % um mehr als 1 € ab → derselbe Hinweis.
   - Fehlen Wert oder Prozent → `co2.incomplete`, denn der Ausweis nach § 7 Abs. 3 verlangt die Einstufung.

### 5.2 Wo der Abzug ansetzt

**Grundsatz (§ 7 Abs. 1):** Die Heizpositionen werden **unverändert** wie heute verteilt. Der Abzug ist **eine eigene, synthetische Position** „CO₂-Kosten: Anteil des Vermieters“ mit dem Betrag −L auf die Mieter und +L beim Vermieter (Grund `co2Share`).

Dafür, statt die Anteile innerhalb jeder Heizposition zu verkleinern, sprechen vier Gründe:

- **Keine Zahl ohne CO₂-Angaben ändert sich.** Golden-Fixtures, `heatingFindings`, `covered`, §35a und die 15-%-Beträge bleiben, wie sie sind.
- **Der Abzug ist auf der Abrechnung als eigene Zeile sichtbar.** So verlangt es #97 („Vermieteranteil als eigene Zeile“), und so liest sich § 7 Abs. 1 („abzieht“).
- **Die Rundungsregel von #203 bleibt unverändert:** Jede Position, auch die synthetische, wird einmal nach dem Restverfahren verteilt.
- **Kein §35a im Abzug.** Der Lohnanteil der Heizpositionen bleibt richtig, denn CO₂-Kosten sind Brennstoff und kein Lohn.

**Welche Heizpositionen den Topf bilden:** Kostenart `HEATING_CATEGORY`, Schlüssel ≠ `direct`, Jahr = Abrechnungsjahr. Ist der Topf ≤ 0 oder C > Topf → `co2.exceeds-heating` (error), kein Abzug, 3-%-Kürzung beziffert.

### 5.3 Verteilung des Abzugs

Für jede **Mieterzeile mit Abrechnung über die Heizung** (bookable, `heatingModel = settlement`, Anteil an einer Topfposition) gilt:

- x_t = Σ der **exakten** Anteile des Mietverhältnisses an den Topfpositionen. Genommen wird der Wert vor der Rundung, also die `exact`-Werte aus `onAllocation` von #203.
- A = Σ der Beträge der Topfpositionen.
- **Exakter Abzug:** r_t = ‰/1000 × C × x_t / A.

**Modus `service` mit Einzelwerten:** r_t = eingetragener Betrag. Fehlt einer, während andere da sind → `co2.reliefs-missing` (warning, Mieter genannt). Der fehlende Wert wird dann proportional ergänzt, damit niemand leer ausgeht.

**Gesamt:** R = `Math.round(Σ r_t)`. Danach wird R nach dem Restverfahren auf die r_t verteilt (`distributeCents` aus #203, Gleichstand nach Kennung). Jede Mieterzeile bekommt eine Zeile `kind: 'co2Relief'` mit −r_t gerundet.

**Beim Vermieter:** eine Zeile mit `landlordParts: [{ reason: 'co2Share', cents: R }]` und `totalCents: 0`. Die Gesamtkosten ändern sich nicht.

**Was nicht abgezogen wird:** L − R entfällt auf Eigennutzung, Leerstand, Pauschale, Inklusivmiete und Wohnungen außerhalb. Den Anteil trägt der Vermieter dort ohnehin ganz; er erscheint im Ausweis als „davon auf vermietete Wohnungen mit Abrechnung: R“. Eine zweite Zeile beim Vermieter wäre doppelt gezählt.

**Zusicherungen** (Invarianten, siehe 9):

- Σ Mieterzeilen + Σ Vermieterzeilen = Gesamtkosten, unverändert.
- 0 ≤ r_t ≤ Anteil des Mieters am Topf. Daraus folgt mit C ≤ A: Kein Mieter bekommt mehr gutgeschrieben, als er an Heizkosten trägt.
- R ≤ L + 0,5 Cent.
- Ohne CO₂-Datensatz ist das Ergebnis identisch zu heute, einschließlich der Hinweise ab 2023 bis auf `co2.fuel-unknown` bzw. `co2.missing`.

### 5.4 Mieteranteil an den CO₂-Kosten (Ausweis)

`tenantCo2Cents` = round(C × x_t / A) − r_t, also der Mieteranteil seines CO₂-Kostenanteils. Das ist eine **Anzeigezahl**, sie geht in keine Summe ein. Der Rechenweg sagt „gerundet“.

### 5.5 3-%-Kürzung

Beziffert je Mieter mit Heizabrechnung als round(3 % × Σ seiner Heizzeilen), **nach** Abzug einer etwaigen CO₂-Zeile. Das ist „der gemäß der Heizkostenabrechnung auf ihn entfallende Anteil“.

Ausgegeben wird sie in `co2.missing`, `co2.incomplete` und `co2.exceeds-heating`, im Muster der 15-%-Meldung (`andList`, je Mieter „Name (Wohnung) Betrag“). **Kein Summieren mit den Kürzungen nach § 12 HeizkostenV** (siehe 11.6).

### 5.6 Rechenweg (#114)

Die Zeile `co2Relief` trägt eigene `steps`:

- „Ihr Anteil an den Heizkosten: x_t von A = …“
- „darin CO₂-Kosten: C × x_t / A = …“
- „Anteil des Vermieters: Stufe …, ‰ → …“
- „Restcent …“, falls vergeben

Begriffe: `co2Split`, `co2Stage`.

### 5.7 Selbstversorger-Erstattung (eigene PR)

Je `co2_refunds` mit `settle_year` = Jahr und einer Abrechnung des Mietverhältnisses: eine Zeile `kind: 'co2Refund'` mit −Betrag und beim Vermieter `co2Refund` +Betrag (`totalCents` 0). Ohne Abrechnung (Pauschale oder ausgezogen) bleibt die Erstattung als Hinweis „auszahlen“.

**Steuer:** Nichts extra. Die Verrechnung senkt die Nachzahlung und damit das Ist der Einnahmen. Eine Auszahlung ist eine negative Zahlung im Mietkonto. `splitForTax` liest Gründe des Vermieters für den Eigenanteil; `co2Share` und `co2Refund` gehören ausdrücklich **nicht** zum privaten Teil.

### 5.8 Steuerübersicht, Mietkonto, Regression

- **Steuer:** Die Werbungskosten kommen weiter aus den Kostenpositionen. Sie sind voll, der Abzug verringert nur die Umlage. Der Eigenanteil bleibt unverändert, weil die Heizzeilen unverändert bleiben.
- **Mietkonto:** unberührt.
- **Regression des Umstiegs:** Die db.json hat keine CO₂-Angaben. Beide Seiten rechnen ohne, und `co2` ist auf beiden Seiten `undefined`.
- **Abgeschlossene Abrechnungen:** eingefroren. `deviation` zeigt den Unterschied, wenn jemand nachträglich CO₂-Angaben für ein abgeschlossenes Jahr erfasst.

---

## 6. Oberfläche

### 6.1 Kosten (Jahr ≥ 2023, sobald es eine Heizposition gibt)

Unter den Heizpositionen erscheint die Karte **„CO₂-Kosten der Heizung {Jahr}“**. Die Logik liegt in `client/src/co2Form.ts`, ohne DOM prüfbar wie `costForm.ts`. Alle Auswahlfelder werden aus Optionslisten gespeist, siehe die Regel zu Auswahlfeldern in CLAUDE.md.

**Schritt 1: „Womit wird geheizt?“**

- Auswahl Energieträger, vorbelegt aus dem Objekt.
- Bei Wärmepumpe, Holz/Pellets oder „keine zentrale Heizung“ endet die Karte mit einem Satz: „Keine CO₂-Aufteilung nötig.“
- Die Wahl wird auch am Objekt gespeichert, wenn es dort leer ist.

**Schritt 2: „Woher kommt die Aufteilung?“**

- **„Der Messdienst oder die Hausverwaltung hat sie berechnet“:** vier Felder mit Beschriftungen wie in Messdienstabrechnungen:
  - „CO₂-Ausstoß je m² und Jahr (kg)“
  - „Anteil Vermieter (%)“
  - „CO₂-Kosten gesamt (€)“
  - „davon Vermieter (€)“

  Aufklappbar: „Vermieteranteil je Mieter (falls ausgewiesen)“, je Mietverhältnis ein Feld, im Muster der Einzelbeträge (#94).
- **„Ich rechne selbst mit der Rechnung des Lieferanten“:** Tabelle der Rechnungen mit Bezeichnung, Rechnungsdatum, „CO₂ in kg“, „CO₂-Kosten in €“ und „+ Rechnung“.
  - Weitere Optionen: Rechnungszeitraum (Mietfuchs schlägt den Anteil vor), Anteil von Hand mit Grund „Tankbestand“, kWh und Emissionsfaktor für den Ausdruck.
  - Rückfall „Rechnung nennt keine kg“: kWh (Heizwert) oder kWh (Brennwert, Gas) oder Liter/kg Öl bzw. Flüssiggas → kg nach EBeV und Kosten nach § 4, als Vorschlag in die Zeile (PR 3).

**Schritt 3: „Wohnfläche für die Einstufung“**

- Vorbelegt, mit dem Satz „Summe der beheizten Wohnungen: 432,5 m²“. Überschreibbar, Begriff `co2Area`.

**Weitere Angaben (zugeklappt):**

- Abrechnungszeitraum kürzer als ein Jahr
- „Gebäude dient nicht überwiegend dem Wohnen“
- „Öffentlich-rechtliche Einschränkung (§ 9)“
- bei Fernwärme der ETS-Schalter

**Live-Vorschau** über `/api/co2/:year/preview`: „40,2 kg CO₂/m² → Stufe 37 bis unter 42: Mieter 40 %, Vermieter 60 % = 464,27 €“, mit Begriff `co2Stage`.

**„Aus {Vorjahr} übernehmen“** kopiert Energieträger, Fläche, § 8 und § 9, **nie Beträge**. Das Muster ist die Übernahme der Positionen.

### 6.2 Abrechnung

- **Je Mieter:** die Zeile „abzüglich CO₂-Kostenanteil des Vermieters (§ 5 CO2KostAufG)“ direkt unter den Heizzeilen, mit Rechenweg.
- **Druckblock „CO₂-Kostenaufteilung“ je Mieter**, also nicht `no-print`. Er ist die Erfüllung von § 7 Abs. 3:
  - Ihr Anteil an den CO₂-Kosten
  - Einstufung: Wert, Stufe, Mieter- und Vermieterprozent
  - Berechnungsgrundlagen: Energieträger, kg CO₂ gesamt (je Rechnung mit Anteil), Wohnfläche, CO₂-Kosten gesamt, Vermieteranteil gesamt
  - gegebenenfalls § 8 oder § 9 bzw. „laut Abrechnung des Messdienstes vom …“
  - Die ganze Stufentabelle wird kompakt mitgedruckt und die eigene Stufe markiert. Das ist billig und erklärt die Zahl.
- **Vermieteranteil:** Grund „CO₂-Kosten (Anteil des Vermieters)“.

### 6.3 Weitere Stellen

- **Stammdaten, Karte Objekt:** Feld „Heizung“ (Energieträger), optional.
- **Mietverhältnis, unter „Weitere Angaben“ (PR 4):** „CO₂-Erstattung (eigene Heizung des Mieters)“ mit Liste und Fristen.
- **Cockpit:** Die Ampel liest die Hinweise wie bisher. `co2.fuel-unknown` zählt mit und gehört **nicht** in `INFORMATIONAL`, denn hinter ihm steht eine bezifferte Kürzung. Mit einer Auswahl ist er erledigt.
- **Anleitungen** (`shared/guides.ts`): Die Sätze „Mietfuchs rechnet das noch nicht (#97)“ werden ersetzt (multiFamily, meteringService), die Lücken zu #97 entfernt. Eine neue Anleitung **„Heizung mit Gas, Öl oder Fernwärme: CO₂-Kosten aufteilen“** hat ein Beispiel, das guides.test.ts nachrechnet.

---

## 7. Hinweise, Regeln, Lexikon

### 7.1 Hinweis-Codes (`noticeKinds`, alle mit `rule` und `terms`)

| Code | Stufe | Wann | Betrag |
|---|---|---|---|
| `co2.missing` | warning | Jahr ≥ 2023, Heizung an Mieter abgerechnet, Energieträger fossil oder Fernwärme (am Objekt), kein Datensatz | 3 % je Mieter |
| `co2.fuel-unknown` | hint | wie oben, Energieträger unbekannt | „falls Gas, Öl, Flüssiggas, Kohle oder Fernwärme: 3 % je Mieter, hier …“ |
| `co2.incomplete` | warning | Datensatz ohne Fläche oder kg, Modus `service` ohne Wert oder Prozent | 3 % |
| `co2.exceeds-heating` | error | C > Summe der Heizpositionen oder keine Heizposition | 3 % |
| `co2.cost-implausible` | hint | Zeile: Kosten weichen > 5 % von kg/1000 × Preis(Lieferjahr) × (1 + USt) ab, also kg und t verwechselt oder netto statt brutto. Nicht für Fernwärme ab EU-ETS, nicht ab 2027 ohne bekannten Preis | – |
| `co2.stage-mismatch` | hint | Modus `service`: Prozent oder Betrag passt nicht zur Tabelle | – |
| `co2.reliefs-missing` | warning | Einzelwerte für manche Mieter fehlen | – |
| `co2.fuel-before-2023` | hint | Lieferung mit Rechnungsdatum vor 2023 bleibt außen vor (§ 11 Abs. 2) | – |
| `co2.restriction` | hint | § 9 gewählt: Nachweis gegenüber dem Mieter (§ 9 Abs. 3) | – |
| `co2.non-residential` | hint | § 8 gewählt | – |
| `co2.refund-late` | hint | Anzeige > 12 Monate nach der Lieferantenabrechnung: Ausschlussfrist, keine Pflicht zur Erstattung (PR 4) | – |
| `co2.refund-due` | warning | Erstattung angezeigt, nicht verrechnet, 12 Monate nach Anzeige: auszahlen (PR 4, nach `asOf`) | Betrag |

`subject`:

- Datensatz → `{ kind: 'co2', id: year }`. `NoticeSubject.kind` bekommt `'co2'`, „Hier beheben →“ springt zur Karte.
- Fehlender Datensatz → dieselbe Karte.
- Erstattung → `tenancy`.

### 7.2 Regelverzeichnis (`rules.ts`, `RULES_AS_OF` auf den Tag der Durchsicht)

| code | title | norm | gültig |
|---|---|---|---|
| `co2-split` | Aufteilung der CO₂-Kosten nach Stufen | §§ 5, 7 Abs. 1–4, 11 Abs. 2 CO2KostAufG, Anlage | ab 2023-01-01 |
| `co2-non-residential` | CO₂-Kosten im Nichtwohngebäude | § 8 CO2KostAufG | ab 2023-01-01 |
| `co2-restriction` | Kürzung bei öffentlich-rechtlichen Einschränkungen | § 9 CO2KostAufG | ab 2023-01-01 |
| `co2-self-supply` | Erstattung bei eigener Versorgung des Mieters | § 6 Abs. 2 und 3 CO2KostAufG | ab 2023-01-01 (PR 4) |

**Nicht** aufgenommen wird `co2-half-split` (§ 5a). Das Verzeichnis führt nur, was die Berechnung anwendet; es kommt mit der Umsetzung (siehe 10).

### 7.3 Lexikon (`shared/glossary.ts`)

Jeder Eintrag hat ein nachgerechnetes Beispiel und eine Norm.

- **`co2Split` „CO₂-Kostenaufteilung“:** „Seit 2023 tragen Vermieter einen Teil der CO₂-Kosten der Heizung, umso mehr, je mehr CO₂ das Haus je Quadratmeter ausstößt.“
  - Beispiel B1 aus 9.2.
  - Norm: §§ 5, 7 CO2KostAufG.
  - „Brauche ich das?“: Gas, Öl, Flüssiggas, Kohle oder Fernwärme, ab dem Abrechnungsjahr 2023; nicht bei Wärmepumpe, Holz oder Pellets. Ohne Aufteilung darf jeder Mieter seine Heizkosten um 3 % kürzen.
- **`co2Stage` „Einstufung (Stufenmodell)“:** zehn Stufen, Rundung auf eine Nachkommastelle, Grenzbeispiel 11,96 → 12,0 → 10 %, kurzes Jahr.
- **`co2Area` „Wohnfläche für die CO₂-Einstufung“:** Das Gesetz definiert sie nicht. Mietfuchs nimmt die Fläche der beheizten Wohnungen; man soll sie anpassen, wenn der Messdienst eine andere nennt.
- **`co2Refund` „CO₂-Erstattung bei eigener Heizung des Mieters“** (PR 4): 12-Monats-Frist, Verrechnung, Gasherd −5 %.

---

## 8. Umstieg und Migration

- **Migration `0014_co2`** (erzeugt), nur `CREATE TABLE` und `ADD COLUMN` nullbar. Sie wird über die Kette angewendet, vorher legt `backupBeforeMigrating` die Sicherung an. Ein Test hält die Marke fest.
- **Keine Datenanweisung**, keine Pflichtspalte, kein Neubau.
- **Eingefrorener Eingang:** unverändert. Ein Quelltext-Wächter bleibt grün, weil `legacy/` nichts aus den neuen Tabellen kennt.
- **`embed-migrations.mjs`:** Die eingebettete Datei wird neu erzeugt; der Test, der beide Wege vergleicht, bleibt.
- **Praxislauf** (`scripts/umstieg-praxislauf.mjs`) vor dem Release; er muss nicht erweitert werden.
- **Smoke-Test:** optional ein `PUT /api/co2/2025` mit Lesen. Das ist billig und prüft die Programmdatei mit neuer Tabelle.
- **CHANGELOG** „Unveröffentlicht“ mit Link auf #97, MIGRATION.md unverändert.

---

## 9. Tests

### 9.1 Engine (`server/test/co2.test.ts`, node:test)

- **Stufenfunktion an allen Grenzen:**
  - 11,9 → 0 %; 11,95 → 12,0 → 10 % (BMWK-Rechner: 0 %, Abweichung im Testnamen benannt)
  - 12,0 → 10 % (Rechner: 0 %); 16,99 → 17,0 → 20 %
  - 51,9 → 80 %; 52,0 → 95 %
  - Gleitkomma: 7.149,7 kg / 600 m² = 11,9161… → 11,9 → 0 %
  - Ein Wert genau auf x,x5 aus Division, etwa 7.230 kg / 600 m² = 12,05 → 12,1
- **Rundung vor der Einstufung**, ein Fall, in dem es den Ausschlag gibt.
- **Kurzes Jahr:** Zeitraum 01.07.–31.12.2025 (184 Tage), 6.000 kg auf 600 m² = 10,0. Die Grenzen werden mit 184/365 gekürzt: 12 → 6,05; 17 → 8,57; 22 → 11,09. Damit liegt 10,0 in der gekürzten Stufe „17 bis < 22“ und ergibt **Vermieter 20 %**; ungekürzt wären es 0 %. Die Rechnung steht als Kommentar im Test.
- **Mieterwechsel ist kein Teiljahr:** gleiche Stufe wie ganzjährig, nur der Anteil über den Schlüssel.
- **§ 8** → 50 %. **§ 9** `building` → halbiert (Stufe 60 % → 30 %), `both` → keine Aufteilung. Stufe 5 % halbiert → 25 ‰.
- **Fernwärme** mit `district_ets_new` → keine Aufteilung, Grund. **Wärmepumpe** → kein Ergebnis, keine Hinweise.
- **§ 11 Abs. 2:** eine Öl-Lieferung vom 15.12.2022 zählt 0 und erzeugt den Hinweis.
- **Lieferanteil:** 9/12 einer Gasrechnung in Promille, kg und Cent wie im Rechenweg.

### 9.2 Nachgerechnete Zahlenbeispiele (BMWK-Rechenweg, abseits der Grenzen)

**B1 – Erdgas 2023:**
- 120.000 kWh Hᵢ × 0,20088 = 24.105,6 kg; 600 m² → 40,176 → 40,2 → Stufe 37 bis < 42, Vermieter 60 %.
- Kosten: 24,1056 t × 30 € = 723,17 € netto, × 1,07 (Gas 2023) = 773,79 € brutto.
- Vermieter 60 % = 464,27 €.

**B2 – Heizöl 2024:**
- 10.000 l × 0,845 × 42,8 × 0,074 = 26.762,84 kg; 450 m² → 59,47 → 59,5 → Stufe ≥ 52, Vermieter 95 %.
- Kosten: 26,76284 t × 45 € × 1,19 = 1.433,15 €.
- Vermieter 95 % = 1.361,49 €.

**B3 – Gas-Brennwertfalle:**
- 150.000 kWh Hₛ: richtig 27.209,2 kg → 38,9 auf 700 m² → 60 %.
- Mit dem Hᵢ-Faktor gerechnet: 30.132 kg → 43,0 → 70 %.
- Der Rückfall in PR 3 muss das richtige Ergebnis liefern.

**Verteilung B1** auf drei Wohnungen mit Abrechnung über Messdienst-Einzelbeträge (Heizkosten gesamt 9.000,00 €, darin C = 773,79 €, L = 464,27 €):
- Einzelbeträge 3.600 / 3.000 / 2.400 €.
- Exakt r = 185,7096 / 154,758 / 123,8064 €; R = round(464,274) = 464,27 €.
- Restverfahren: Abgerundet sind es 185,70 / 154,75 / 123,80 = 464,25 €. Die zwei Restcent gehen an die größten Reste (0,96 und 0,80), also **185,71 / 154,76 / 123,80 €**.
- Einzeln gerundet hätten es 123,81 € und zusammen 464,28 € gegeben. Den Fall festschreiben.

### 9.3 Verteilung und Invarianten (`calc.test.ts`, Zufallsbestände mit festem Startwert)

Der Generator von #203 wird um zufällige CO₂-Datensätze erweitert: beide Modi, § 8, § 9, Teiljahr, Einzelwerte, Pauschale, Inklusivmiete, Eigennutzung, Leerstand. Zu prüfen:

- Σ Zeilen = Gesamtkosten.
- 0 ≤ Abzug ≤ Heizanteil je Mieter.
- R ≤ L + 0,5 ct.
- **Ohne Datensatz** ist jede Zahl identisch zum Stand ohne Feature (Vergleich mit abgeschalteter Funktion).
- Zwei Objekte, nur eines mit CO₂-Angaben: Das andere rechnet, als wäre es allein (Invariante aus #92).

Konkrete Fälle:

- Eigennutzung: Der Abzug geht nur an Mieter; der Ausweis zeigt „davon auf vermietete Wohnungen“.
- Zwei Topfpositionen (70 % Wärmezähler, 30 % Fläche): r_t folgt der Mischung.
- Gutschrift im Topf.
- C > A → error, kein Abzug, 3 %.
- Modus `service` mit Einzelwerten, ein Mieter fehlt.
- 3-%-Beträge in allen drei Meldungen, gerechnet nach Abzug.
- **Golden F01–F11 unverändert:** Sie enthalten keine CO₂-Angaben. Fixtures mit Heizposition ab 2023 bekommen den neuen Hinweis `co2.fuel-unknown`; jeder davon wird einzeln begründet, sonst bekommt das Fixture einen Energieträger.

### 9.4 API, Schema, Client

- **`api.test.ts`:**
  - `PUT`/`GET`/`DELETE /api/co2/:year`
  - `?property=` mit zwei Objekten (400 ohne Angabe)
  - Einzelwert mit Mietverhältnis eines anderen Objekts → 400
  - unbekanntes Feld wird verworfen (#60)
  - 503 bei gesperrter Datenbank
  - Vorschau-Route
  - Abschluss friert `co2` ein, nachträgliche Änderung erscheint in `deviation`
- **`schema.test.ts`** (Typen ↔ Schema), **Migrationsmarke**, **`db-golden`** und **`db-changeover`** grün.
- **`glossary.test.ts`:** Jeder `co2.*`-Code hat Begriffe. **`guides.test.ts`** rechnet das neue Beispiel nach. **`anrede.test.ts`** gilt für alle neuen Texte.
- **Client:**
  - `co2Form.test.ts`: Vorbelegung, Modus, Rückfall Hₛ/Hᵢ, Übernahme aus dem Vorjahr ohne Beträge.
  - jsdom-Test, dass Energieträger und Modus im Auswahlfeld dem gespeicherten Wert entsprechen.
  - `notices.test.ts`: `co2.fuel-unknown` färbt die Ampel.
- **Smoke-Test:** ein Datensatz über die Programmdatei.

---

## 10. Nicht-Ziele (ausdrücklich nicht gebaut)

- **Keine HeizkostenV-Engine** (Entscheidung 1 aus #85, #99): keine Zerlegung Heizung/Warmwasser nach § 9 HeizkostenV, keine Gradtagszahlen, keine Verbrauchsermittlung für die CO₂-Verteilung. Der Mieterteil folgt der Verteilung der Heizpositionen, wie sie erfasst ist.
- **§ 5a, § 5b, § 5d (ab 2028/2029)** werden **nicht** berechnet und nicht im Regelverzeichnis geführt. Abrechnungen 2028 entstehen frühestens 2029; die jährliche Durchsicht (#110) baut es dann. Vorbereitet ist nur die Stelle: `co2Assessment` hat **einen** Ausgang für das Verhältnis (Promille), sodass „hälftig“ ein weiterer Zweig ist. Im Datensatz käme `heating_section_43` dazu (Einbau nach dem 29.07.2026). Die Netzentgelte nach § 5a Abs. 1 Nr. 1 wären eine eigene Teilposition, nicht Teil dieser Spezifikation.
- **Kein Stufenmodell für Nichtwohngebäude.** Es gibt keins (§ 8 Abs. 4 ist nicht umgesetzt).
- **Keine Abfrage der UBA-Preise** und keine fest eingebauten Preise ab 2027. Preise stehen als Daten mit Fundstelle in `co2.ts`; ein fehlender Preis heißt „keine Plausibilitätsprüfung“, nie eine geratene Zahl.
- **Keine automatische Senkung von Pauschale oder Warmmiete** wegen § 6 Abs. 1 (offen, 11.7).
- **Kein Nachhalten des Hinweises bei Vertragsschluss** (§ 6 Abs. 2 S. 6, § 5d Abs. 4), nur Lexikon und Anleitung.
- **Keine Mandantenfunktionen**, keine WEG-seitige Einstufung der ganzen Anlage. Bei einer Eigentumswohnung kommen die Werte aus der Abrechnung der Gemeinschaft (Modus `service`).
- **Der Gasherd beim zentral versorgten Mieter** ist nicht im Gesetz, also nicht bei uns. Die −5 % gibt es nur bei der Erstattung.

---

## 11. Offene Rechtsfragen

Nur echte Unsicherheiten. Die Empfehlung, wie Mietfuchs bis zur Klärung verfährt, steht jeweils dabei.

1. **Wohnflächenbegriff** (#109, weiter offen): Das Gesetz definiert „Wohnfläche“ nicht; der GdW nimmt die Fläche der Heizkostenabrechnung, der bved die WoFlV. **Bis dahin:** eigenes Feld, vorbelegt mit der Fläche der beheizten Wohnungen, und der Satz im Lexikon.
2. **Öl im Tank:** Zählt die Lieferung oder der Verbrauch, und wenn der Verbrauch, nach welcher Folge (FIFO)? § 3 und § 5 Abs. 1 S. 5 sprechen von Lieferungen und Umrechnung, § 11 Abs. 2 S. 2 vom Rechnungsdatum. **Bis dahin:** anzusetzender Anteil je Lieferung mit Grund „Tankbestand“, ohne Vorgabe einer Methode.
3. **§ 11 Abs. 2 S. 2 und die Einstufung:** Bleiben die Emissionen aus Brennstoff von vor 2023 nur bei den **Kosten** außen vor oder auch beim **kg/m²-Wert**? Der BMWK-Rechner setzt für 2022 den Faktor 0, also beides. **Bis dahin:** beides außen vor, wie der Rechner des Bundes (§ 11 Abs. 3), mit Hinweis.
4. **Umrechnung abweichender Rechnungszeiträume** (§ 5 Abs. 1 S. 5): tagesgenau oder nach Gradtagen? **Bis dahin:** tagesgenau als Vorschlag, überschreibbar.
5. **Rundung auf eine Nachkommastelle:** kaufmännisch angenommen; das Gesetz sagt nur „runden“. Der BMWK-Rechner rundet gar nicht und ordnet Grenzwerte der unteren Stufe zu. **Bis dahin:** dem Gesetz folgen, die Abweichung im Lexikon nicht erwähnen, im Test benennen.
6. **Treffen die 3 % nach § 7 Abs. 4 mit den Kürzungen nach § 12 HeizkostenV zusammen?** Der in #85 zitierte Satz über das Nebeneinander steht im **heutigen** Wortlaut von § 12 Abs. 1 HeizkostenV nicht mehr (Satz 3 betrifft § 6a, Satz 4 das Wohnungseigentum; nachgelesen am 04.10.2026). Bei #110 nachziehen. **Bis dahin:** jede Kürzung einzeln nennen, keine Summe.
7. **Pauschale, Inklusiv- oder Warmmiete und § 6 Abs. 1:** Muss eine vereinbarte Warmmiete um den Vermieteranteil sinken? **Bis dahin:** keine Rechnung, Satz im Lexikon „lassen Sie das prüfen“.
8. **§ 6 Abs. 2 S. 6 (Hinweis bei Vertragsschluss):** Der neue Wortlaut verknüpft den Hinweis mit der Pflicht nach § 43 GModG. Ob er für jeden Selbstversorger-Vertrag gilt oder nur bei solchen Heizungen, ist unklar. Der Kommentar zu #85 liest ihn allgemein. **Bis dahin:** Anleitung empfiehlt den Hinweis immer; das schadet nicht.
9. **„Überwiegend dem Wohnen“** (§ 6 Abs. 1 S. 3, § 8 Abs. 1 S. 2): Gemessen nach Fläche, nach Nutzwert? **Bis dahin:** Der Nutzer entscheidet per Schalter, Vorgabe Wohngebäude.
10. **Fernwärme, Erstanschluss nach 2023 ohne EU-ETS-Anlagen:** Der BMWK-Rechner setzt bei jedem Erstanschluss 0 %, § 2 Abs. 4 S. 2 nimmt nur ETS-gespeiste Lieferungen aus. **Bis dahin:** dem Gesetzeswortlaut folgen; Schalter mit beiden Bedingungen im Text.
11. **Preis 2027:** Durchschnitt der Versteigerungen vom 01.07. bis 30.11.2026, vom UBA bis Mitte Dezember 2026 zu veröffentlichen. BT-Drs. 21/7869 (Korridor 2027) ist nicht beschlossen. Laut Kommentar zu #97 endeten die Versteigerungen am 09.09.2026; welchen Durchschnitt das ergibt, ist offen. **Betrifft nur die Plausibilitätsprüfung.**
12. **Rechtsprechung zum CO2KostAufG:** weiterhin keine gefunden (#109).

---

## 12. Aufwand und Aufteilung in PRs

Gestapelt auf #203. Jeder Zweig bekommt eine Durchsicht mit frischem Kontext, der Stapel eine Integrationsdurchsicht mit Geld- und Datenblick, Praxislauf und `full-check`. Der Text jeder PR schreibt `Refs #97`.

| PR | Inhalt | Schätzung |
|---|---|---|
| **1 – Datenmodell und Berechnung** | Migration 0014, shared/types, repository (`withCollection`), Routen `/api/co2` inkl. Vorschau, snapshot, `co2.ts` (Einstufung, Abzug, Ausweis-Daten), Einbau in `computeSettlement` (synthetische Position, `co2Share`), Hinweise `co2.missing` / `fuel-unknown` / `incomplete` / `exceeds-heating` / `stage-mismatch` / `reliefs-missing` / `fuel-before-2023` / `restriction` / `non-residential`, Regeln, Lexikon `co2Split` / `co2Stage` / `co2Area`, alle Tests aus 9.1–9.4 außer Client | 3–4 Tage |
| **2 – Oberfläche und Ausdruck** | Karte auf Kosten (`co2Form.ts`), Feld am Objekt, Zeile und Druckblock auf der Abrechnung, Grund beim Vermieter, Cockpit, Anleitungen und guides.test, Client-Tests | 2–3 Tage |
| **3 – Rückfall Standardwerte und Plausibilität** | EBeV-Faktoren, Hₛ→Hᵢ, Preise 2023–2026 und Fernwärme-ETS als Daten mit Fundstelle, USt-Sätze (Gas und Fernwärme 7 % vom 01.10.2022 bis 31.03.2024, Quelle BMWK-Rechner), Hinweis `co2.cost-implausible`, Tests B2/B3 | 1 Tag |
| **4 – Selbstversorger-Erstattung** | Tabelle `co2_refunds` (eigene Migration 0015), Gutschrift-Zeile, Fristenhinweise, Regel `co2-self-supply`, Lexikon `co2Refund`, Formular am Mietverhältnis, Tests | 2 Tage |
| **5 – KI: Lieferantenrechnung** (optional, schließt an #103 an) | Belegart „Brennstoff- oder Wärmerechnung“ liest die Angaben nach § 3 Abs. 1 Nr. 1–4 und füllt eine Lieferzeile; erfundene Beispielbelege im KI-Prüflauf. Den CO₂-Vermieteranteil je Nutzer aus der Messdienstabrechnung liefert #103 in `co2_tenant_reliefs`. | 1–2 Tage |

**Summe:** etwa 9–12 Arbeitstage.

PR 1 und 2 sind für sich auslieferbar und decken die Fälle F1–F6 und F8–F12 ab. PR 4 deckt F7 ab, PR 3 und 5 sind Komfort.

**Reihenfolge-Abhängigkeit:** PR 1 braucht `distributeCents` und die `exact`-Werte aus #203. Wird #203 vorher nicht gemergt, verwendet PR 1 `largestRemainder` mit identischer Gleichstandsregel und zieht nach.
