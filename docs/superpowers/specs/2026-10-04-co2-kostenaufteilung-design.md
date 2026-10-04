# Spezifikation: CO₂-Kostenaufteilung (#97, Entscheidung 2 aus #85)

- **Fassung:** dritte Fassung vom 04.10.2026 (nach der Nachprüfung der zweiten).
- **Codestand:** `main` mit #203 (eine Rundungsregel; `distributeCents` und `landlordRecipients` liegen in calc.ts).
- **Rechtsstand:** CO2KostAufG in der Fassung von Art. 5 G v. 23.07.2026 (BGBl. 2026 I Nr. 226), in Kraft seit 29.07.2026. Den Wortlaut habe ich am 04.10.2026 auf gesetze-im-internet.de gelesen.
- **Grundlage der Überarbeitung:** zwei unabhängige Prüfungen, nämlich eine rechtliche und logische Gegenprüfung (19 Befunde) und ein Marktvergleich von Heizkosten-Software und Messdiensten (Techem, ista, Brunata; objego, immocloud, WISO, Immoware24, mibakus, NebenkostenFix). Jeder Befund ist unten entschieden.

---

## 0. Änderungen

### 0.1 Änderungen gegenüber der zweiten Fassung

Die Nachprüfung der zweiten Fassung lautete „noch nicht umsetzungsreif“. Bestätigt hat sie den Befund A1 (doppelter Abzug), die Zahlenbeispiele und die PR-Reihenfolge. Jeder ihrer Befunde ist hier entschieden.

| # | Befund der Nachprüfung | Entscheidung | Abschnitt |
|---|---|---|---|
| N1 | **Falsch:** Die Begründung zu A8 trägt nicht. `co2.amount-net` fängt den Irrtum nicht in beide Richtungen. Bei „ja“ trotz Bruttobeträgen rät die Prüfung, um L zu erhöhen, und die Werbungskosten stehen L zu hoch. Bei „nein“ trotz Abzug prüft nichts, und es wird doppelt abgezogen. | **Keine Vorgabe mehr.** Gefragt wird eine sichtbare Tatsache: „Steht in der Kostenaufstellung eine Zeile wie ‚Abzüglich CO₂-Kosten Vermieter‘ oder beim Mieter ‚vom Vermieter übernommen‘?“, mit Beispielzeile aus dem Techem-Muster. Neues **Pflichtfeld S**, die „Summe der Nutzerkosten Heizung und Warmwasser laut Messdienst“. Die **harte Probe** `co2.sum-check` (error) verlangt: Σ Topfbeträge = S + L bei Vorwegabzug, sonst = S. `co2.amount-net` entfällt. Die verbleibende Lücke (falsches „nein“ **und** Betrag = S) ist mit Zahlen allein nicht zu erkennen; sie ist benannt, und #103 liest die Abzugszeile künftig aus. | 3, 4.2, 5.4, 6.1 |
| N2 | **Riskant:** Die Summenprüfung ist blind bei Leerstand, fremden Einheiten und fehlenden Eigenbeträgen. | Die Probe läuft gegen S, nicht gegen Σ der eingetragenen Einzelbeträge. Was S an Einzelbeträgen fehlt, ist der gewöhnliche Rest (Leerstand, außerhalb). L ist davon getrennt: L = Betrag − S. | 5.4 |
| N3 | **Riskant:** Der Eigennutzungsteil von L wird ohne `take()` gebucht. Bei Nettoerfassung wird `amountsRest` negativ. | Beide Teile von L laufen über `take()` und sind damit durch das begrenzt, was übrig ist. | 5.4 |
| N4 | **Riskant:** „Exakt, weil netto proportional zu brutto“ gilt nur bei einem linearen Schlüssel für alle Topfkosten. | Das ist jetzt eine **Näherung**. Gibt es den Wert des Messdienstes für die eigene Wohnung, wird er übernommen (`service_self_landlord_cents`). Die Probe läuft über **alle** Topfpositionen. Festgelegt ist, in welcher Position L gebucht wird (`service_cost_item_id`). | 4.2, 5.4 |
| N5 | **Riskant:** Eine Gasrechnung vom 15.03. bis 14.03. deckt Mai bis April nur zu 318 Tagen. | Hinweis `co2.period-uncovered` mit den fehlenden Tagen. Bis die Folgerechnung da ist, wird **tagesgleich hochgerechnet**. Begründung: § 5 Abs. 1 S. 5 verlangt die Emissionen des ganzen Zeitraums. Weglassen senkte E und C und damit beides, was den Mieter entlastet. Hochrechnen wirkt im Zweifel zu seinen Gunsten. | 5.1 |
| N6 | **Riskant:** `service-unsplit` färbt als `hint` die Ampel nicht, obwohl die 3 % sicher sind. | `co2.service-unsplit` ist eine **warning**, solange nicht selbst aufgeteilt wurde. Nach der eigenen Aufteilung (ab PR 2) bleibt der Hinweis `co2.service-unsplit-healed` (Rechtsfrage 11.13). | 7.1 |
| N7 | **Lücke:** Sperren bis zum jeweiligen PR. | Öl und Flüssiggas mit `self*` lassen sich bis PR 3 nicht speichern (400); `co2.missing` bleibt bis dahin stehen. Eine zweite Heizanlage und Lieferzeilen je Wohnung (F8) sind bis PR 4 ebenso gesperrt. | 13 |
| N8 | **Lücke:** Die Formel für F8 war nicht festgeschrieben. | r_t = ‰/1000 × C_u × x_t / A_u, **ohne** Normierung auf die Mietverhältnisse. Was auf Leerstand fällt, bleibt beim Vermieter. | 5.3 |
| N9 | **Lücke:** Bei `serviceShown` mit Einzelwerten fehlte eine Prüfung. | Verlangt sind Σ r_t ≤ L und r_t ≤ x_t, sonst `co2.reliefs-invalid` (error) und proportionale Verteilung. | 5.3 |
| N10 | **Kleinere Punkte.** | E = 15.254,8 kg (aus den gerundeten Tabellenwerten 15.254,9), der Wert 50,849… → 50,8. Für das Mietfuchs-Jahr 2023 ohne Datensatz gibt es nur den Hinweis `co2.missing-first-year` statt der Warnung, denn der Zeitraum kann 2022 begonnen haben. Eine Position über mehrere Heizanlagen ergibt `co2.item-spans-plants` (error). | 5.2, 7.1, 5.3 |
| N11 | **Schnittstellen zu #99 und #208** für 0.11.0. | Die **Heizanlage** gehört #99. Der CO₂-Teil benennt die Felder, die er von ihr braucht (4.1). `properties.heating_energy` und `co2_statement_units` entfallen. Die Schnittstelle zu #208 ist auf ein Feld und eine Regel verdichtet (12). | 4.1, 12 |

### 0.2 Änderungen gegenüber dem ersten Entwurf

| # | Befund | Entscheidung | Abschnitt |
|---|---|---|---|
| 1 | **Doppelter Abzug** beim Messdienst (Gegenprüfung A1, Marktvergleich 3.2). Techem und ista ziehen den Vermieteranteil im Mietshaus standardmäßig vor der Verteilung von den Brennstoffkosten ab; die Einzelbeträge sind dann netto. | Neue Pflichtangabe **„Hat der Messdienst den Vermieteranteil schon abgezogen?“**, Vorgabe ja. Bei ja gibt es keine Abzugszeile; der Vermieteranteil wird als eigener Teil des Vermieteranteils gebucht (`co2Share`), und eine Summenprüfung stellt sicher, dass die Heizposition brutto erfasst ist. Bei „nur ausgewiesen“ (WEG) bleibt die Abzugszeile. | 3, 4.2, 5.3, 5.4 |
| 2 | Die **Heizposition muss brutto erfasst sein**, sonst fehlen Werbungskosten (A6, Marktvergleich 0.3). | Bei Vorwegabzug gilt: Betrag = netto verteilte Kosten + Vermieteranteil. Die Summenprüfung `co2.amount-net` nennt den richtigen Betrag. Die Anleitung `meteringService` wird berichtigt; das ist der Befund aus #209, siehe 14. | 5.4, 14 |
| 3 | **Dritter Messdienst-Fall:** Der Messdienst hat gar nicht aufgeteilt. Die vorliegende reale Abrechnung ist so. | Eigene Methode „Messdienst hat nicht aufgeteilt“: Der Vermieter rechnet selbst aus der Gasrechnung, ausgehend von den Messdienstbeträgen brutto, und bekommt einen Hinweis mit beziffertem Kürzungsrecht von 3 %. | 3 F3, 7.1 |
| 4 | Falsches Beispiel „Stufe 5 % halbiert → 2,5 %“ (A5). Die 5 % sind der Anteil des **Mieters**. | Richtig ist: Vermieter 95 % halbiert ergibt **47,5 % (475 ‰)**, 10 % halbiert ergibt 5 % (50 ‰). | 5.1, 9.1 |
| 5 | **Öl und Flüssiggas nach Lieferung statt nach Verbrauch** (A2): Ein Jahr ohne Lieferung hätte keinen Abzug ergeben, eine Doppellieferung eine zu hohe Stufe. | **Bestandsrechnung:** Anfangsbestand + Lieferungen − Endbestand. Der Restbestand wird zu den jüngsten Lieferungen bewertet (die Idee stammt aus mibakus, der Code nicht, weil mibakus unter GPL steht). Den freien Anteil von Hand gibt es für Tankbrennstoffe nicht mehr. | 3 F6, 5.2 |
| 6 | **Gasetagenheizung mit Vertrag auf den Vermieter** (§ 5 Abs. 1 S. 2, A3) fiel durch den Ausschluss von `direct` still heraus. | Eigener Fall: Lieferzeile je Wohnung; Einstufung über Σ kg / Σ Fläche der gesondert versorgten Wohnungen; Abzug je Wohnung aus deren eigener Rechnung. | 3 F8, 5.3 |
| 7 | **Abrechnungszeitraum ≠ Kalenderjahr** (A4). Die reale Abrechnung läuft vom 01.05. bis 30.04. | Der Datensatz führt **immer** den tatsächlichen Zeitraum. Anwendbar ist das Gesetz, wenn dieser Zeitraum am oder nach dem 01.01.2023 beginnt. Der Kürzungsfaktor wird gegen zwölf Monate ab Beginn gerechnet, Schaltjahre eingeschlossen. Der abweichende Zeitraum selbst ist das eigene Vorhaben #208; dieser Entwurf nennt nur die Schnittstelle. | 5.1, 12 |
| 8 | **Mehrere Gebäude mit getrennter Heizung** in einem Objekt (A7). | Mehrere Datensätze je Objekt und Jahr („Heizanlagen“), jeder mit seinen Wohnungen. | 4.2, 5.3 |
| 9 | **Bezugsgröße des Abzugs** (A8): Der Anteil je Mieter darf nur aus Heiz- und Warmwasserkosten gebildet werden, nicht aus einem Gesamtbetrag samt Kaltwasser. | Grundlage ist ausschließlich die Kostenart „Heizung und Warmwasser“. Formular und Anleitung sagen, dass dort nur „Ihre Heizkosten + Ihre Warmwasserkosten“ hineingehören. Positionen mit verschiedenen Schlüsseln ergeben einen Hinweis. | 5.3, 6.1 |
| 10 | **Umfang** (Marktvergleich 3.3, Gegenprüfung D). | Der Rückfall auf Standardwerte wird zur **Plausibilitätsprüfung gekürzt**. Die Erstattung an Selbstversorger rückt **nach hinten**. Die Felder, die Messdienste abfragen (Fläche, § 8, § 9, Fernwärme), bleiben. | 13 |
| 11 | Ob sich die Kürzungen addieren (11.6). | Fundstelle der ista-FAQ („kumulativ“) ergänzt. Die Entscheidung bleibt: Kürzungen einzeln nennen, nicht summieren. | 11.6 |
| 12 | Bezugsgröße der 3 % und 15 % (A9). | Beide werden auf den Anteil **nach** dem CO₂-Abzug gerechnet. | 5.6 |
| 13 | § 11 Abs. 2 und der BMWK-Rechner (A10). | Der Rechner ist kein Beleg für Tankbestände. **Neue Entscheidung:** Bestand, der vor 2023 in Rechnung gestellt wurde, zählt mit **0 €, aber mit seinen kg** für die Einstufung. Das folgt dem Wortlaut („Kosten … bleiben unberücksichtigt“). | 5.2, 11.3 |
| 14 | Kleinere Punkte: USt-Zeitraum (A11), Hochrechnen ≈ Kürzen (A12), Kauf ist kein kurzes Jahr (A13), ganzzahliger Einstufungswert des Messdienstes (A14), § 9 und § 8 bei der Erstattung (A15), Verrechnung nur in der nächsten Abrechnung (A16), Ampel ankündigen (A17), Preis 2027 (A18). | Alle übernommen. | 2.8, 3, 5.1, 5.7, 8 |
| 15 | PR-Reihenfolge. | Zuerst der Messdienst mit Vorwegabzug und der Hinweis „nicht aufgeteilt“, also der häufigste Fall bei Kleinvermietern. | 13 |
| 16 | Breite Abdeckung (Wunsch des Nutzers) und neue Issues #208 und #209. | Keine gängige Lage fällt weg, auch wenn sie selten ist: Jede hat einen PR, ein Issue oder einen Titelvorschlag für ein neues Issue. #208 ist nur als Schnittstelle beschrieben, #209 steht im PR-Plan. | 12, 13, 14, 15 |

**Nicht übernommen:**

- **Schalter „enthält Brennstoff“ an der Kostenposition** (A8). Die Kostenart ist bereits diese Aussage. Ein zweites Merkmal wäre eine weitere Stelle, an der man sich irren kann. Stattdessen gibt es eine klare Regel und einen Hinweis bei gemischten Schlüsseln.
- **Antwort „weiß nicht“ auf die Vorwegabzugsfrage** (A1). Stattdessen zeigt das Formular unter der Frage, woran man es erkennt. Die Vorgabe „ja“ ist der Standard im Mietshaus, und die Summenprüfung fängt den Irrtum in beide Richtungen.

---

## 1. Ziel in einfachen Worten

Seit 2023 zahlt der Vermieter einen Teil der CO₂-Kosten der Heizung, und zwar umso mehr, je mehr CO₂ das Haus je Quadratmeter ausstößt. Die Zahlen stehen auf der Rechnung des Gas-, Öl- oder Fernwärmelieferanten: Kilogramm CO₂ und CO₂-Kosten in Euro. Wer einen Messdienst hat, findet sie meist schon fertig in dessen Abrechnung. Dort ist der Anteil des Vermieters in der Regel **schon abgezogen**.

Mietfuchs soll:

- **die Messdienstabrechnung richtig übernehmen.** Ist der Vermieteranteil schon abgezogen, wird nichts ein zweites Mal abgezogen. Der Vermieteranteil steht dann als eigener Posten beim Vermieter und zählt in der Steuer als Werbungskosten.
- **merken, wenn niemand aufgeteilt hat**, und die 3-%-Kürzung je Mieter beziffern (§ 7 Abs. 4).
- **selbst aufteilen können**, wenn es keinen Messdienst gibt oder er nicht aufgeteilt hat. Dazu gehören Einstufung, Vermieteranteil als eigene Zeile und Ausweis auf der Abrechnung (§ 7 Abs. 3).

Zielgruppe: private Vermieter mit 1 bis 10 Wohnungen, Zentralheizung mit Gas, Öl, Flüssiggas oder Fernwärme, oft mit Messdienst, Abrechnungsjahre 2023 bis 2026.

**Wer nichts einträgt, bekommt keine andere Zahl.** Ohne CO₂-Angaben bleibt jede Verteilung centgenau, wie sie ist. Neu ist ab 2023 nur ein Hinweis bei Heizpositionen. Er wird im CHANGELOG und in der Anleitung angekündigt.

---

## 2. Rechtslage mit Fundstellen

Alle Normzitate sind am 04.10.2026 auf gesetze-im-internet.de nachgelesen. Die Gegenprüfung hat sie unabhängig bestätigt (§§ 2, 3, 4, 5, 5a, 5d, 6, 7, 8, 9, 11 und Anlage). Wo der BMWK-Rechner genannt ist, wurde sein ausgelieferter Code gelesen (`/assets/index-ccf7eb1c.js`).

### 2.1 Anwendungsbereich

- **§ 2 Abs. 1:** Das Gesetz gilt für Brennstoffe mit Standard-Emissionsfaktor nach der EBeV. Das sind Erdgas, Heizöl, Flüssiggas und Kohle. Es gilt auch für die gewerbliche Wärmelieferung, also Fernwärme und Contracting. Nicht erfasst sind Holz und Pellets, Wärmepumpe und Strom.
- **§ 2 Abs. 4:** Wärme aus Anlagen im EU-Emissionshandel ist eingeschlossen, aber **nicht** für Gebäude, die **erstmals nach dem 01.01.2023** angeschlossen wurden.
- **§ 2 Abs. 5:** Das Gesetz hat Vorrang vor § 6 Abs. 1 HeizkostenV und vor Vereinbarungen.
- **§ 2 Abs. 7:** In den Fällen des § 11 HeizkostenV gilt es nicht, es sei denn, eine Abrechnung ist vereinbart.
- **§ 11 Abs. 2:** Das Gesetz gilt für Abrechnungszeiträume, die **am oder nach dem 01.01.2023 beginnen**. Satz 2: „Kohlendioxidkosten, die aufgrund des Verbrauchs von Brennstoffmengen anfallen, die vor dem 1. Januar 2023 in Rechnung gestellt worden sind, bleiben unberücksichtigt.“
- **§ 11 Abs. 1:** Bei Altverträgen erfasst die Umlagevereinbarung den Vermieteranteil nicht.

### 2.2 Angaben auf der Rechnung (§ 3)

**§ 3 Abs. 1:** Die Rechnung muss enthalten:

- Nr. 1: Brennstoffemissionen in **kg CO₂**,
- Nr. 2: den **Preisbestandteil der CO₂-Kosten**,
- Nr. 3: den heizwertbezogenen Emissionsfaktor,
- Nr. 4: den Energiegehalt in kWh,
- Nr. 5: einen Hinweis auf die Erstattung,
- Nr. 6 (neu seit 29.07.2026): den Preisbestandteil des Pflicht-Biobrennstoffanteils bei Heizungen nach § 43 GModG.

**§ 3 Abs. 3:** Der Preisbestandteil versteht sich **zuzüglich Umsatzsteuer**, ist also brutto.

**§ 3 Abs. 4:** Für Fernwärme gilt dasselbe. Dort gibt es einen netzeinheitlichen Faktor, und für den Anteil aus Anlagen im EU-Emissionshandel gilt der Versteigerungsdurchschnitt des Vorjahres.

**Folge:** Die Hauptgrößen werden **abgeschrieben, nicht berechnet**. Das tun auch alle Messdienste und Programme im Marktvergleich. Keiner rechnet aus kWh vor.

### 2.3 Preis (§ 4): nur für die Plausibilitätsprüfung

| Lieferjahr | Preis je t CO₂ | Fundstelle |
|---|---|---|
| 2023 | 30 € | § 4 Abs. 1 Nr. 1; DEHSt, Stand 16.12.2025 |
| 2024 | 45 € | ebd. |
| 2025 | 55 € | ebd. |
| 2026 | 60 € (Mittelwert des Korridors) | § 4 Abs. 1 Nr. 2; DEHSt |
| 2027 | Durchschnitt der **Versteigerungen** 01.07.–30.11.2026, vom UBA spätestens zehn Werktage vor Jahresbeginn veröffentlicht (§ 4 Abs. 2) | **offen**; ein Festpreisverkauf zählt nicht |

Fernwärme aus Anlagen im EU-Emissionshandel, Preis nach Rechnungsjahr (DEHSt): 2023: 80,40 € · 2024: 83,68 € · 2025: 65,01 € · 2026: 73,86 €.

### 2.4 Einstufung und Aufteilung (§ 5, Anlage)

- **§ 5 Abs. 1 S. 1:** Maßgeblich ist der CO₂-Ausstoß **des Gebäudes** in kg je m² Wohnfläche und Jahr.
- **§ 5 Abs. 1 S. 2:** Bei **gesonderter Versorgung** einer Wohnung durch den Vermieter zählt der Ausstoß **der Wohnung**. Vermietet er mehrere Wohnungen mit gesonderter oder zentraler Versorgung, zählt deren Gesamtwohnfläche.
- **§ 5 Abs. 1 S. 3:** Der Wert wird **auf die erste Nachkommastelle gerundet**, und zwar vor der Einstufung.
- **§ 5 Abs. 1 S. 4:** Ist ein Abrechnungszeitraum **unter einem Jahr vereinbart**, werden **die Tabellenwerte anteilig gekürzt**.
- **§ 5 Abs. 1 S. 5:** Weichen die Zeiträume der Lieferrechnungen ab, sind die Emissionen **umzurechnen**. Die Methode ist nicht vorgegeben.
- **§ 5 Abs. 2:** Die Einordnung erfolgt in die Tabelle der Anlage.

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

### 2.5 Abrechnung, Ausweis, Kürzung (§ 7)

- **§ 7 Abs. 1:** Der Vermieter berechnet den „im Abrechnungszeitraum verursachten“ Ausstoß und die Kosten, **zieht seinen Anteil ab** und verteilt den Rest **nach dem Schlüssel der Heiz- und Warmwasserkosten**.
- **§ 7 Abs. 2:** Im selbstbewohnten Zweifamilienhaus gilt die Aufteilung ebenfalls; nur das Verteilverfahren ist frei.
- **§ 7 Abs. 3:** Auszuweisen sind der **Anteil des Mieters**, die **Einstufung** und die **Berechnungsgrundlagen**.
- **§ 7 Abs. 4:** Fehlt eines davon, darf der Mieter „den gemäß der Heizkostenabrechnung auf ihn entfallenden Anteil an den Heizkosten um **3 Prozent**“ kürzen.
- **§ 7 Abs. 5:** Dasselbe gilt für die Kosten nach § 5a, also ab 2028.

**Wer schuldet die Aufteilung?** Der Vermieter. Der Messdienst rechnet nur, wenn der Vermieter ihm kg und € meldet. ista sagt dazu wörtlich: ohne Angaben „keine CO₂-Kostenaufteilung … Die CO₂-Kosten legen wir wie bisher vollständig auf Ihre Mieter um“ ([ista-FAQ](https://www.ista.com/de/kontakt-service/vermieter-oder-verwalter/faq/)).

### 2.6 Standardwerte (EBeV 2030, Anlage 2 Teil 4): nur für die Plausibilitätsprüfung

| Brennstoff | EBeV | kg CO₂ |
|---|---|---|
| Erdgas | 0,0558 t/GJ; 3,2508 GJ/MWh Hₛ | 0,20088 je kWh Hᵢ, 0,18139 je kWh Hₛ |
| Heizöl EL | 0,074 t/GJ; 0,845 t/1000 l; 42,8 GJ/t | 0,2664 je kWh Hᵢ, 2,6763 je l |
| Flüssiggas | 0,0655 t/GJ; 46,0 GJ/t | 0,2358 je kWh Hᵢ, 3,013 je kg |

**Brennwertfalle bei Gas:** Die Rechnung nennt kWh nach Brennwert (Hₛ). Wer mit dem Faktor für den Heizwert rechnet, liegt rund 11 % zu hoch. Nachgerechnet: 150.000 kWh Hₛ auf 700 m² ergeben richtig 38,9 kg/m² und damit 60 %, mit dem falschen Faktor 43,0 kg/m² und damit 70 %.

### 2.7 Sonderfälle

- **§ 6 Abs. 1:** Ein Wohngebäude dient nach seiner Zweckbestimmung überwiegend dem Wohnen. Das Stufenmodell gilt dort auch für Gewerberäume.
- **§ 8:** Im Nichtwohngebäude trägt der Mieter höchstens **50 %**. Das in § 8 Abs. 4 angekündigte Stufenmodell für Nichtwohngebäude wurde nie erlassen. ista rechnet „zu gleichen Teilen“.
- **§ 9:** Stehen einer Verbesserung öffentlich-rechtliche Vorgaben entgegen, **halbiert sich der Vermieteranteil**. Das gilt beim Gebäude (etwa Denkmalschutz, Erhaltungssatzung) und bei der Versorgung (etwa Anschluss- und Benutzungszwang). Treffen beide zu, wird **gar nicht aufgeteilt** (Abs. 2). Der Vermieter muss die Umstände nachweisen (Abs. 3). § 9 gilt für §§ 5 bis 8, also auch für die Erstattung.
- **§ 6 Abs. 2 und 3 (Selbstversorger):**
  - Der Vermieter **erstattet** dem Mieter seinen Anteil.
  - Der Mieter muss ihn binnen 12 Monaten ab der Lieferantenabrechnung in Textform geltend machen (Ausschlussfrist).
  - Haben die Parteien eine Vorauszahlung vereinbart, verrechnet der Vermieter in der **nächsten auf die Anzeige folgenden** Betriebskostenabrechnung. Sonst erstattet er binnen 12 Monaten.
  - Wer den Brennstoff auch für eigene Geräte nutzt (Gasherd), bekommt 5 % weniger.
- **§§ 5a, 5b, 5d (ab 2028):** Bei Heizungen nach § 43 GModG werden CO₂-Kosten und Gas-Netzentgelte **hälftig** geteilt, statt nach Stufen. Ab 2029 kommt der Biobrennstoffanteil hinzu, höchstens 30 %. § 5d regelt Härtefälle.

### 2.8 BMWK-Rechner (`co2kostenaufteilung.bundeswirtschaftsministerium.de`)

**Was er tut** (am Code geprüft, von der Gegenprüfung bestätigt):

- Faktoren wie in 2.6, Kohle 0,3571.
- CO₂-Kosten = kg/1000 × Preis × (1 + USt), mit 7 % für Gas und Fernwärme vom Beginn des Zeitraums, **frühestens 01.01.2023**, bis 31.03.2024. Rechtlich galt der ermäßigte Satz ab 01.10.2022 (§ 28 Abs. 5 UStG a. F.). Ab 2023 macht das keinen Unterschied.
- Ein Zeitraum innerhalb eines Kalenderjahres wird auf 365 bzw. 366 Tage hochgerechnet. Das ist **im Ergebnis fast immer** gleich der Kürzung der Tabelle, an einer Grenze kann es eine Stufe Unterschied geben.
- § 9 mit 0,5 je Grund.
- Erstanschluss Fernwärme ab 2023 → 0 %.

**Wo er vom Gesetz abweicht** (die Tests halten beides fest):

- Er **rundet den kg/m²-Wert nicht**.
- Er wählt die Stufe mit `d >= min && d <= max` und nimmt den ersten Treffer. **Genau 12,0 landet so bei 0 %** statt 10 %.

Außerdem endet seine Preistabelle 2025.

**Mietfuchs folgt dem Gesetz.**

---

## 3. Fälle

Die **Methode** eines CO₂-Datensatzes beantwortet die Frage „Wer hat aufgeteilt, und ist schon abgezogen?“. Daraus folgen drei Lagen beim Messdienst und eine ohne.

| # | Lage | Methode | Was Mietfuchs tut |
|---|---|---|---|
| **F1** | **Messdienst hat aufgeteilt und den Vermieteranteil vorab abgezogen.** Das ist der Standard bei Techem und ista im Mietshaus und der häufigste Fall. Die Einzelbeträge je Nutzer sind netto. | `serviceDeducted`, gewählt über die sichtbare Tatsache „Abzugszeile steht da“, **ohne Vorgabe** | **Keine Abzugszeile.** Der Vermieteranteil L ist ein eigener Teil des Vermieteranteils der Heizposition (Grund `co2Share`). Der **Betrag der Heizposition ist brutto**, also S + L. Die harte Probe `co2.sum-check` vergleicht die Summe der Topfbeträge mit S + L. Der Ausweis zeigt die Angaben des Messdienstes. |
| **F2** | **Messdienst oder Hausverwaltung hat aufgeteilt, aber nur ausgewiesen.** So ist es bei der WEG in der Variante „informativ ohne Abzug“ und in der Buhl-Forum-Variante bei ista. | `serviceShown` | Abzugszeile je Mieter, mit den Einzelwerten des Messdienstes (geprüft: Σ ≤ L, je Mieter ≤ Heizanteil) oder verteilt wie die Heizkosten (5.3). Probe: Σ Topfbeträge = S. |
| **F3** | **Messdienst hat gar nicht aufgeteilt.** Das ist der Fall der vorliegenden realen Abrechnung (siehe Kasten). | `selfAfterService` | Der Vermieter teilt selbst auf, aus der Gas-, Öl- oder Fernwärmerechnung. Die Messdienstbeträge bleiben brutto, der Abzug kommt als eigene Zeile. Solange nicht selbst aufgeteilt ist, gibt es die Warnung `co2.service-unsplit` mit der 3-%-Kürzung je Mieter, danach den Hinweis `co2.service-unsplit-healed` (7.1). |
| **F4** | **Kein Messdienst**, Heizkosten selbst verteilt (nach Wärmezählern und Fläche, oder nur nach Fläche mit der 15-%-Warnung) | `self` | Wie F3, aber ohne den Hinweis. |
| **F5** | **Fernwärme** | F1–F4 | Die Werte kommen von der Rechnung des Wärmelieferanten. Erstanschluss nach dem 01.01.2023 an ein Netz mit Anlagen im EU-Emissionshandel: keine Aufteilung (§ 2 Abs. 4 S. 2). |
| **F6** | **Öl und Flüssiggas** | `self`, `selfAfterService` | Bestandsrechnung: Anfangsbestand + Lieferungen − Endbestand = Verbrauch, der Restbestand zu den jüngsten Lieferungen bewertet (5.2). Bestand, der vor 2023 in Rechnung gestellt wurde, zählt mit 0 €, aber mit seinen kg. |
| **F7** | **Rechnungszeitraum ≠ Abrechnungszeitraum** (Gasrechnung 15.03.–14.03.) | `self`, `selfAfterService` | Je Lieferzeile ein Rechnungszeitraum (bei Gas und Fernwärme Pflicht). Mietfuchs schlägt den Anteil tagesgenau **auf den tatsächlichen Abrechnungszeitraum** vor, überschreibbar. Deckt keine Rechnung einen Teil des Zeitraums ab, wird hochgerechnet, und `co2.period-uncovered` nennt die fehlenden Tage (5.1). |
| **F8** | **Gasetagenheizung, Vertrag auf den Vermieter**, umgelegt per Direktzuordnung (§ 5 Abs. 1 S. 2) | `self` | Lieferzeile **je Wohnung**. Einstufung über Σ kg / Σ Fläche aller vom Vermieter versorgten vermieteten Wohnungen. Abzug je Wohnung aus deren eigener Rechnung. |
| **F9** | **Mehrere Gebäude mit getrennter Heizung** in einem Objekt | alle | Je Heizanlage (#99, 4.1) ein Datensatz mit eigener Einstufung. Eine Position, deren Verteilbasis in zwei Anlagen reicht, ergibt `co2.item-spans-plants`. |
| **F10** | **Abrechnungszeitraum ≠ Kalenderjahr** (Messdienst 01.05.–30.04.) | alle | Der Datensatz führt den tatsächlichen Zeitraum. Er entscheidet über die Anwendbarkeit (Beginn ab 01.01.2023), die Tabellenkürzung und die Lieferanteile. Mietfuchs selbst rechnet weiter im Kalenderjahr (siehe 5.1 und #208, Schnittstelle in 12). |
| **F11** | **Kürzerer Abrechnungszeitraum** (Erstbezug, Umstellung des Zeitraums) | alle | Die Tabellengrenzen werden gekürzt. **Kein** Teiljahr sind der Mieterwechsel und der Eigentümerwechsel; beide bekommen einen eigenen Test. |
| **F12** | **Nichtwohngebäude, § 9** | `self*` | Schalter § 8 (50 %) und Auswahl § 9; diese Felder fragt auch der Messdienst ab. Bei `service*` stehen sie in der Messdienstabrechnung und werden dort abgeschrieben. |
| **F13** | **Zweifamilienhaus mit Eigennutzung** | alle | Die Aufteilung gilt (§ 7 Abs. 2), es gibt keine Ausnahme. |
| **F14** | **Pauschale oder Inklusivmiete bei der Heizung** | – | Keine Abrechnung, also kein Abzug. Der Anteil bleibt ohnehin beim Vermieter (11.7). |
| **F15** | **Wärmepumpe, Holz, Pellets, Strom** | – | Energieträger wählen → keine Aufteilung, keine Hinweise. |
| **F16** | **Selbstversorger** (Etagenheizung, Vertrag auf den Mieter) | – | Erstattung als Gutschriftzeile in der nächsten Abrechnung, als **späte PR**. Bis dahin nennen Lexikon und Anleitung den Anspruch. |
| **F17** | **ab 2028, § 5a** | – | Nicht gebaut (10). |

**Kasten: die reale Abrechnung eines kleinen Hauses, anonymisiert (Fall F3, F10)**

- **Haus:** 4 Einheiten, rund 200 m², Erdgas.
- **Abrechnung:** Messdienst-Komplettabrechnung für den Zeitraum 01.05.2025–30.04.2026, Heizung und Warmwasser zusammen rund 4.276 €, **keine** CO₂-Aufteilung.
- **Gasrechnung:** eine einzige über rund 29.900 kWh.
- **Folge:** Der Zeitraum beginnt nach dem 01.01.2023, die Aufteilung fehlt also. Jeder Mieter darf um 3 % kürzen; zusammen sind das 3 % × 4.276,51 € = **128,30 €**.
- **Schätzung, ohne die kg der Rechnung:** 29.886 kWh Hₛ × 0,18139 ≈ 5.421 kg, geteilt durch 200,6 m² ≈ 27,0. Das wäre Stufe 40 %, mit einem Vermieteranteil von rund 140–155 €.
- **Grenzfall:** Der Wert liegt **an der Grenze 27**. Schon die Umrechnung der Gasrechnung auf Mai bis April oder eine etwas größere Fläche ergibt 30 %. Damit ist der Beleg der Prüffall für Fläche, Umrechnung und Rundung (9.2).

---

## 4. Datenmodell

Migration `0014_co2.sql`, erzeugt mit `npm --prefix server run db:generate`. Sie enthält nur neue Tabellen und eine nullbare Spalte, also keine Datenanweisung. Der eingefrorene Eingang (`server/src/legacy/`) bleibt unberührt.

### 4.1 Heizanlage: Schnittstelle zu #99

Die **Heizanlage** ist ein Konzept von #99 (Zweig `feat/heizkostenabrechnung`). Die Tabelle legt an, wer zuerst gemergt wird, mit **genau diesen Feldern**; der andere ergänzt sie. Der CO₂-Teil braucht von ihr:

| Feld | Zweck im CO₂-Teil |
|---|---|
| `id`, `property_id` | Bezug der CO₂-Datensätze (`co2_statements.plant_id`) |
| `name` | Ausweis, erst ab der zweiten Anlage sichtbar |
| `energy` (`'gas' \| 'oil' \| 'lpg' \| 'districtHeating' \| 'coal' \| 'heatPump' \| 'biomass' \| 'other'`, nullbar = unbekannt) | Ohne Datensatz die Wahl zwischen Warnung (`co2.missing`) und Hinweis (`co2.fuel-unknown`). Vorbelegung des Energieträgers im Datensatz. |
| `supply` (`'central' \| 'perUnit'`) | `perUnit` = Etagenheizungen mit Vertrag auf den Vermieter (F8, § 5 Abs. 1 S. 2) |
| versorgte Einheiten (eigene Zuordnungstabelle; ohne Zeilen alle Einheiten des Objekts) | Topf, Fläche und Mieter je Anlage (F9) |
| Zuordnung Kostenposition → Anlage (`cost_items.heating_plant_id`, nullbar) | Topf. Ohne Zuordnung gilt die Anlage, deren Einheiten die Verteilbasis der Position enthalten; reicht die Basis in zwei Anlagen → `co2.item-spans-plants`. |

**Ohne angelegte Anlage** gibt es eine gedachte Anlage je Objekt (alle Einheiten, zentral, Energieträger unbekannt). Das Formular legt sie an, sobald „Womit wird geheizt?“ beantwortet ist. **Später, nicht hier:** das Merkmal „Heizung nach § 43 GModG, eingebaut nach dem 29.07.2026“ für §§ 5a–5d.

### 4.2 `co2_statements`: eine Zeile je Heizanlage und Jahr (eindeutig: `plant_id`, `year`)

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | text PK | |
| `property_id` | text, `RESTRICT` | |
| `year` | integer | Mietfuchs-Jahr, dem der Datensatz zugeordnet ist (Regel siehe 5.1) |
| `plant_id` | text, `RESTRICT` | Heizanlage (4.1) |
| `method` | `'serviceDeducted' \| 'serviceShown' \| 'selfAfterService' \| 'self'` | siehe 3 |
| `fuel` | wie `energy` der Anlage, ohne `null` | Energieträger dieses Zeitraums, vorbelegt von der Anlage |
| `period_from`, `period_to` | text, **Pflicht** | tatsächlicher Abrechnungszeitraum; das Formular belegt ihn mit dem 01.01.–31.12. des Jahres vor |
| `area_m2` | real, nullbar, > 0 | Fläche für die Einstufung; `null` = Vorgabe (5.1) |
| `non_residential` | boolean | § 8 |
| `restriction` | `'none' \| 'building' \| 'supply' \| 'both'` | § 9 |
| `district_ets_new` | boolean | § 2 Abs. 4 S. 2 |
| `service_emissions_kg`, `service_area_m2` | real, nullbar | `service*`: kg und Fläche laut Messdienst, damit Mietfuchs nachstufen kann |
| `service_kg_per_m2` | real, nullbar | `service*`: Einstufungswert, wie gedruckt |
| `service_landlord_permille` | integer, nullbar | `service*`: Vermieteranteil (z. B. 350 für 35 %) |
| `service_total_cents` | integer, nullbar | `service*`: CO₂-Kosten gesamt |
| `service_landlord_cents` | integer, nullbar | `service*`: **L**, Vermieteranteil in € |
| `service_users_total_cents` | integer, nullbar; bei `service*` **Pflicht** | **S**: Summe der Nutzerkosten Heizung und Warmwasser laut Messdienst, so wie gedruckt (bei Vorwegabzug netto) |
| `service_cost_item_id` | text, nullbar, `SET NULL` | Position, in der L gebucht wird (5.4). Pflicht, wenn der Topf mehr als eine Position hat. |
| `service_self_landlord_cents` | integer, nullbar | Vermieteranteil der selbstgenutzten Wohnungen laut Messdienst, wenn ausgewiesen (5.4) |
| `stock_unit` | `'l' \| 'kg'`, nullbar | Öl, Flüssiggas: Mengeneinheit |
| `opening_quantity`, `opening_emissions_kg`, `opening_cost_cents` | nullbar | Anfangsbestand mit Bewertung, vorbelegt aus dem Endbestand des Vorjahres |
| `closing_quantity` | real, nullbar | Endbestand |

**Bedingungen:**

- `service_*` nur bei `method` `service*`; dort sind S, L, ‰ und Wert Pflicht.
- `method` hat **keine Vorgabe**: Die API lehnt einen Datensatz ohne Methode ab.
- Bestandsfelder nur bei `oil` und `lpg`.
- `period_from` ≤ `period_to`, und der Zeitraum dauert höchstens zwölf Monate.

**Mehrere Anlagen (F9):** Je Anlage ein Datensatz. Die versorgten Einheiten kommen von der Anlage (4.1), nicht vom Datensatz. Sich überschneidende Anlagen lehnt der Server ab (400), ebenso das Wiederherstellen eines solchen Bestands.

**Warum je Anlage und Jahr und nicht an der Kostenposition:** Die CO₂-Kosten stecken im **ganzen Topf** Heizung und Warmwasser. Bei eigener Verteilung sind das oft zwei Positionen (Verbrauch, Fläche), und § 7 Abs. 1 S. 2 verteilt nach der Mischung beider. NebenkostenFix kommt aus demselben Grund zum selben Schnitt: Die Anlage ist der Topf, nicht die Position.

### 4.3 `co2_deliveries`: Lieferrechnungen (Methoden `self*`)

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id`, `statement_id` (`CASCADE`) | | |
| `label` | text | |
| `invoice_date` | text, nullbar | Rechnungsdatum, für § 11 Abs. 2 S. 2 |
| `delivered_at` | text, nullbar | Lieferdatum, für die Reihenfolge im Bestand |
| `period_from`, `period_to` | text, nullbar | Rechnungszeitraum, nur für Gas und Fernwärme |
| `unit_id` | text, nullbar, `CASCADE` | F8: gesonderte Versorgung dieser Wohnung; `null` = zentrale Anlage |
| `quantity` | real, nullbar | Öl, Flüssiggas: Liefermenge in `stock_unit` |
| `emissions_kg` | real, ≥ 0 | § 3 Abs. 1 Nr. 1 |
| `co2_cost_cents` | integer | § 3 Abs. 1 Nr. 2, brutto |
| `energy_kwh`, `emission_factor` | real, nullbar | für Ausweis und Plausibilität |
| `share_permille` | integer 0–1000, Vorgabe 1000 | nur bei Gas und Fernwärme: Anteil, der in den Abrechnungszeitraum fällt |

`unit_id` darf nur auf eine Einheit desselben Objekts und derselben Anlage zeigen (`sameProperty`, 400), und nur bei `supply = 'perUnit'`.

### 4.4 `co2_tenant_reliefs`: Angaben je Mietverhältnis laut Messdienst (optional)

Primärschlüssel `(statement_id, tenancy_id)`, beide `CASCADE`. Spalte `cents` ≥ 0, Bedeutung „vom Vermieter übernommen“.

- Bei `serviceShown` wird dieser Betrag abgezogen.
- Bei `serviceDeducted` ist er **nur Ausweis**.

Prüfung über Objektgrenzen mit `guardTenancy` (400); `crossPropertyViolations` fragt die Tabelle mit ab.

### 4.5 `co2_refunds` (späte PR, F16)

| Spalte | Bedeutung |
|---|---|
| `id` | |
| `tenancy_id` (`CASCADE`) | |
| `supplier_billed_at` | Datum der Lieferantenabrechnung des Mieters |
| `claimed_at` | Anzeige in Textform |
| `settle_year` | Jahr der Verrechnung |
| `amount_cents` ≥ 0 | Betrag |

Optional die Grundlagen aus der Mieterrechnung: `emissions_kg`, `co2_cost_cents`, `area_m2`, `own_appliances` (−5 %), dazu § 8 und § 9 wie im Datensatz (A15).

### 4.6 Gemeinsames Modell (`shared/types.ts`)

- `HeatingEnergy`, `Co2Method`, `Co2Restriction`, `Co2Statement`, `Co2Delivery`, `Co2Refund`.
- `HeatingPlant` (4.1), mit #99 abgestimmt.
- `LandlordReason` bekommt `'co2Share'` (und in der späten PR `'co2Refund'`).
- `SettlementRow` bekommt `kind?: 'co2Relief' | 'co2Refund'`. Die Zeile hat keine Kostenposition; `costItemId` ist `co2:<statementId>`. Abrechnung.tsx (Belegsuche) und tenantFolder.ts sind darauf zu prüfen.
- `Settlement.co2?: Co2Assessment[]` (je Anlage), optional für vorher abgeschlossene Abrechnungen. Inhalt:
  - Methode, Energieträger, Zeitraum, Fläche und ihre Herkunft,
  - kg (davon Bestand und davon vor 2023), Wert genau und gerundet, Kürzungsfaktor,
  - Stufe (von, bis, Mieter %, Vermieter ‰), § 8, § 9,
  - C, L, die angesetzten Zeilen samt Bestandsrechnung,
  - den Grund, wenn nicht aufgeteilt wurde.
- `Statement.co2?: { tenantCo2Cents, reliefCents, deducted: boolean }`.

`schema.test.ts` hält Schema und Typen zusammen. `Settlement.co2` friert mit dem Abschluss ein.

### 4.7 Schnappschuss, Routen

- **snapshot.ts:** Die Datensätze des Jahres samt Zeilen, Einheiten und Einzelwerten werden nach Objekt und `year` eingegrenzt; sie tragen ihr Jahr als Feld. Für die Vorbelegung des Anfangsbestands kommt der Endbestand des Vorjahres dazu. Außerdem die Heizanlagen des Objekts samt Einheiten und der Zuordnung der Positionen.
- **Routen:**
  - `GET` und `PUT /api/co2/:year?property=` als Liste der Datensätze des Jahres samt Zeilen. Geschrieben wird ganz oder gar nicht in einer Transaktion durch `writeData`.
  - `DELETE /api/co2/:year/:id`.
  - `POST /api/co2/:year/preview` gibt die Einstufung und den Bestand zurück, ohne zu speichern. Die Oberfläche rechnet nicht selbst, damit es nur eine Stufentabelle gibt.
  - Für die Erstattungen (späte PR) kommt `co2Refunds` zu den generischen CRUD-Routen.
- **Backup und Wiederherstellen:** Die Datenbank geht ganz mit. Der Validator betrifft die db.json und ist nicht berührt.

---

## 5. Berechnung

Neue Datei `server/src/co2.ts` mit reinen Funktionen. Der Einbau erfolgt in `computeSettlement`, über die Empfänger aus #203.

### 5.1 Einstufung: `co2Assessment(statement, snapshot) → Co2Assessment`

1. **Anwendbar?**
   - Regel `co2-split`, geprüft am **Beginn des tatsächlichen Zeitraums** (`period_from` ≥ 2023-01-01, § 11 Abs. 2 S. 1). Liegt der Beginn davor, wird nichts aufgeteilt und kein Hinweis gegeben. Damit feuert eine übernommene Abrechnung 05/2022–04/2023 nicht fälschlich.
   - Brennstoff fossil oder Fernwärme.
   - **Ohne Datensatz** ist der Zeitraum unbekannt. Für das Mietfuchs-Jahr 2023 gibt es deshalb nur den Hinweis `co2.missing-first-year`, denn eine Abrechnung 05/2022–04/2023 liegt dort und fällt nicht unter das Gesetz. Ab 2024 beginnt jeder Zwölfmonatszeitraum, der in dem Jahr endet, nach dem 01.01.2023, und es gilt `co2.missing`.
   - Kein `district_ets_new` und kein § 9 `both`. Sonst wird nichts aufgeteilt, mit Grund im Ausweis.
2. **Zuordnung zum Mietfuchs-Jahr:** Der Datensatz steht im Jahr derselben Heizpositionen, auf die er sich bezieht. Das Formular schlägt das Jahr vor, in dem der Zeitraum **endet**, denn dann wird abgerechnet. Die Regel steht im Lexikon (`co2Period`).
3. **Fläche** = `area_m2` oder die Vorgabe: Σ `areaM2` der Einheiten der Anlage, die Wohnungen sind (`isDwelling`) und an einer Heizposition teilnehmen oder eine Lieferzeile nach F8 haben. Bei F8 zählen nur vermietete Wohnungen („vermietet er … deren Gesamtwohnfläche“). Garagen bleiben draußen. Die Herkunft der Fläche wird ausgewiesen.
4. **Emissionen E und Kosten C**, je nach Brennstoff:
   - **Gas, Fernwärme, Kohle:** Σ `emissions_kg × share/1000` und Σ `round(co2_cost_cents × share/1000)`. Der Anteil wird **auf den tatsächlichen Zeitraum** tagesgenau vorgeschlagen: Tage der Überschneidung / Tage der Rechnung. Bei Gas und Fernwärme ist der Rechnungszeitraum Pflicht.
   - **Abdeckung:** D_c = Tage des Abrechnungszeitraums, die mindestens eine Rechnung abdeckt; D = alle Tage. Ist D_c < D, werden E und C **tagesgleich auf D hochgerechnet** (× D/D_c), und `co2.period-uncovered` nennt die fehlenden Tage mit der Bitte, die Folgerechnung einzutragen, sobald sie da ist.
     - **Begründung:** § 5 Abs. 1 S. 5 verlangt die Emissionen des vereinbarten Zeitraums. Fehlende Tage wegzulassen ergäbe einen kleineren Wert (niedrigere Stufe) **und** kleinere Kosten C, beides zulasten des Mieters. Hochrechnen ist die einzige Umrechnung, die mit den vorhandenen Rechnungen den ganzen Zeitraum erfasst, und im Zweifel die mieterfreundliche. Der BMWK-Rechner verfährt bei Teilzeiträumen ebenso.
     - Tagesgleich und nicht nach Gradtagen (11.4).
     - **Beispiel:** Rechnung 15.03.2025–14.03.2026, Zeitraum 01.05.2025–30.04.2026. Überschneidung 318 Tage, Anteil 318/365 = 871 ‰, fehlend 47 Tage (15.03.–30.04.2026), Hochrechnung × 365/318. Im Ergebnis zählt die Rechnung voll, bis die Folgerechnung eingetragen ist.
   - **Öl, Flüssiggas:** Bestandsrechnung (5.2).
   - **Zeilen mit `invoice_date` vor 2023-01-01:** kg zählen, € zählen 0, dazu der Hinweis `co2.fuel-before-2023` (11.3).
5. **Wert:** `tenths = Math.floor(E × 10 / Fläche + 0,5 + 1e-9)`, also kaufmännisch auf eine Stelle.
6. **Kürzung der Tabelle:** f = min(1, Tage des Zeitraums / Tage der zwölf Monate ab `period_from`). Für 01.05.2027–30.04.2028 sind das 366 / 366 = 1. Ist f < 1, werden die Grenzen mit f multipliziert, verglichen wird mit einer Toleranz von 1e-9, und der Rechenweg nennt die gekürzten Grenzen.
7. **Vermieteranteil in Promille:**
   - Tabelle; bei § 8 fest 500.
   - § 9 `building` oder `supply` halbiert. Beispiele: 950 → 475 (47,5 %), 100 → 50 (5 %), 700 → 350 (Techem-Muster).
8. **L = C × ‰ / 1000** als exakter Wert; gerundet wird erst bei der Verteilung.
9. **Methoden `service*`:** C, L, Wert und ‰ kommen aus `service_*`. Mietfuchs stuft nach:
   - aus `service_emissions_kg` / `service_area_m2`, falls angegeben, sonst aus `service_kg_per_m2`;
   - ist der gedruckte Wert ganzzahlig (das Techem-Muster druckt „46 kg“ für 46,43), meldet Mietfuchs nur, wenn **kein** Wert in [w − 0,5; w + 0,5) die angegebene Stufe ergibt;
   - weicht ‰ oder L um mehr als 1 € von C × ‰ ab → `co2.stage-mismatch` (Hinweis).
   - Fehlen Wert, ‰ oder L → `co2.incomplete`.

### 5.2 Bestandsrechnung für Öl und Flüssiggas

Gesetzesbegründung laut GdW-Arbeitshilfe: Bestand zu Beginn und Ende erfassen. Die Messdienste fragen dasselbe ab (Immoware24-Export, ista: „Restbestände … ohne anteilige CO₂-Kosten“). Gezählt wird also der **Verbrauch**, nicht die Lieferung. Die Idee der Bewertung stammt aus mibakus, der Code wird wegen der GPL nicht übernommen.

1. **Anfangsbestand** Q₀ mit kg₀ und €₀. Vorbelegt ist der bewertete Endbestand des Vorjahres. Fehlt er, wird von Hand eingetragen. Stammt der Bestand aus einer Rechnung vor 2023, ist €₀ = 0.
2. **Lieferungen** i im Zeitraum mit Menge qᵢ, kgᵢ, €ᵢ.
3. **Endbestand** Q₁. Er wird **den jüngsten Lieferungen zugerechnet**, also von der letzten Lieferung rückwärts, und erst, wenn diese nicht reichen, dem Anfangsbestand. Verbraucht ist damit das Älteste zuerst.
4. **Verbrauch** je Posten = Menge − davon im Endbestand. kg und € werden je Posten im Verhältnis der Menge angesetzt (€ auf Cent gerundet je Posten).
5. **Ergebnis:** E und C sind die Summen über die verbrauchten Teile. Der Endbestand trägt seine kg und € in das nächste Jahr.
6. **Fehler:** Ist Q₁ > Q₀ + Σ qᵢ, gibt es `co2.stock-invalid` (error) und keine Aufteilung.

**Beispiel (Heizöl, 2025, 300 m²):**

| Posten | Menge | kg | CO₂-Kosten |
|---|---|---|---|
| Anfangsbestand (Rechnung 2022) | 2.000 l | 5.352,6 | 0 € |
| Lieferung 15.03.2025 | 3.000 l | 8.028,9 | 525,49 € |
| Lieferung 10.10.2025 | 2.500 l | 6.690,7 | 437,91 € |
| **Endbestand** | 1.800 l | aus der Lieferung vom 10.10. | |

- **Verbrauch:** 5.700 l, davon 700 l aus der Lieferung vom 10.10.
- **E** = 15.254,8 kg (aus den gerundeten Tabellenwerten 15.254,9), also 50,849… → **50,8** → Vermieter 80 %.
- **C** = 525,49 + 122,61 = **648,10 €**, **L = 518,48 €**.
- Der Endbestand trägt 4.817,3 kg und 315,30 € ins Jahr 2026.
- **Nach Lieferungen** gerechnet wären es 49,1 kg/m² (ebenfalls 80 %), aber C = 963,40 € und L = 770,72 €, also **252 € zu viel** zulasten des Vermieters. In einem Jahr ohne Lieferung wäre L = 0.

**Die Heizposition selbst** (Brennstoffkosten nach Verbrauch, § 7 Abs. 2 HeizkostenV) ist nicht Teil von #97. Wer selbst abrechnet, trägt den Verbrauchswert ein. Die Vorschau zeigt ihn als Hilfe („verbraucht: 5.700 l, Wert laut Lieferungen …“). Siehe Folgebefund 14.3.

### 5.3 Abzug als eigene Zeile (Methoden `serviceShown`, `selfAfterService`, `self`)

**Topf** einer Anlage: Positionen der Kostenart `HEATING_CATEGORY` im Jahr, die der Anlage zugeordnet sind (4.1). Ohne Zuordnung zählen die Positionen, deren Verteilbasis in den Einheiten der Anlage liegt. Reicht die Basis einer Position in zwei Anlagen → `co2.item-spans-plants` (error): Die Position gehört dann zu keinem Topf und mindert keinen Abzug, und der Text bittet, sie je Anlage aufzuteilen (Teilnehmer) oder zuzuordnen.

- Die Kostenart enthält **nur Heiz- und Warmwasserkosten** einschließlich Heiznebenkosten (Betriebsstrom, Wartung, Messdienst). Kaltwasser und Hausnebenkosten aus einer Komplettabrechnung gehören in ihre eigenen Kostenarten. So steht es im Formular und in der Anleitung (A8).
- Direktzuordnungen gehören nur über F8 dazu.
- Haben Topfpositionen verschiedene Schlüssel außer dem Paar „Verbrauch + Fläche“ (etwa Wartung nach Einheiten) → Hinweis `co2.pool-keys`. Der Abzug folgt dann der Mischung, wie § 7 Abs. 1 S. 2 es für einen einheitlichen Schlüssel annimmt.

**Zentrale Anlage:** Für jede Mieterzeile mit Abrechnung über die Heizung (bookable, `heatingModel = settlement`) gilt:

- x_t = Σ der **exakten** Anteile an den Topfpositionen (aus `onAllocation`);
- A = Σ der Topfbeträge;
- r_t = ‰/1000 × C_zentral × x_t / A.

Bei `serviceShown` mit Einzelwerten gilt r_t = der eingetragene Wert. Vorher wird geprüft:

- **Σ r_t ≤ L** und **r_t ≤ x_t** für jeden Mieter (kein Mieter bekommt mehr gutgeschrieben, als er an Heizkosten trägt).
- Verletzt ein Wert das → `co2.reliefs-invalid` (error). Die Einzelwerte werden dann verworfen, und es gilt die proportionale Formel oben.
- Fehlt ein Wert für einen Mieter → `co2.reliefs-missing` (warning), und dieser eine Wert wird proportional ergänzt.

**Gesonderte Versorgung (F8):** Für jede Wohnung u mit Lieferzeilen gilt:

- A_u = Σ der Beträge der Direktpositionen der Heizkostenart, die dieser Wohnung zugeordnet sind (ihre Gasrechnung);
- x_t = exakter Anteil des Mietverhältnisses t an diesen Positionen;
- **r_t = ‰/1000 × C_u × x_t / A_u**, ausdrücklich **ohne Normierung** auf die Mietverhältnisse. Fällt ein Teil von A_u auf Leerstand, bleibt der entsprechende Teil des Vermieteranteils ohne Buchung beim Vermieter, wie bei der zentralen Anlage.
- Gibt es keine solche Position oder ist C_u > A_u → `co2.exceeds-heating` für diese Wohnung.

**Gesamtbetrag und Rundung:**

- R = `Math.round(Σ r_t)`.
- R wird nach dem Restverfahren auf die Zeilen verteilt (`distributeCents`, Gleichstand nach Kennung).
- Jede Zeile `co2Relief` trägt −r_t.
- Beim Vermieter steht eine Zeile mit `landlordParts: [{ reason: 'co2Share', cents: R }]` und `totalCents` 0.

**L − R** entfällt auf Eigennutzung, Leerstand, Pauschale und Wohnungen außerhalb der Abrechnung. Diesen Teil trägt der Vermieter ohnehin ganz. Der Ausweis nennt „davon auf Mietverhältnisse mit Abrechnung: R“.

**Steuer:** Die Werbungskosten sind die bezahlten Topfbeträge. Bei diesen Methoden sind sie brutto, weil niemand vorab abgezogen hat. Der Eigenanteil bleibt unverändert.

### 5.4 Vorwegabzug durch den Messdienst (Methode `serviceDeducted`)

Hier wird **nichts von Mietern abgezogen**. Die Einzelbeträge (`amounts`) sind die Nettobeträge des Messdienstes. Neu ist, wie der Rest beim Vermieter zerlegt wird, und eine harte Probe.

**Wie die Methode gewählt wird:** über eine **sichtbare Tatsache und ohne Vorgabe** (6.1). „Steht in der Kostenaufstellung eine Zeile wie ‚Abzüglich CO₂-Kosten Vermieter‘ oder beim Mieter ‚vom Vermieter übernommen‘?“

- **Ja** → `serviceDeducted`.
- **Nein, die CO₂-Kosten sind nur ausgewiesen** → `serviceShown`.

**Voraussetzung:** Die Position `service_cost_item_id` hat den Schlüssel `amounts`. Bei einem anderen Schlüssel (`external`, `meter` …) antwortet der Server mit 400 und Begründung. Mit `external` bekäme der Mieter den ganzen eigenen Anteil, also brutto. Eine vermietete Eigentumswohnung mit Vorwegabzug der Gemeinschaft wird deshalb als `amounts` mit dem Nettobetrag erfasst; so sagt es die Anleitung. Hat der Topf genau eine Position, ist sie die Vorgabe für `service_cost_item_id`.

**Harte Probe `co2.sum-check`** (error), über **alle** Topfpositionen der Anlage, Toleranz 1 € für die Rundung des Messdienstes:

- `serviceDeducted`: Σ Topfbeträge = **S + L**.
- `serviceShown`: Σ Topfbeträge = **S**.
- Zusätzlich: Σ eingetragene Einzel- und Eigenbeträge ≤ S + 1 €.

**Scheitert die Probe**, wird die CO₂-Buchung dieser Anlage nicht ausgeführt: kein `co2Share`, keine Abzugszeilen. Die Mieter zahlen ihre Einzelbeträge wie eingetragen. Der Ausweis wird gedruckt. Der Text der Meldung nennt beide Deutungen mit Zahlen, zum Beispiel: „Ihre Positionen ergeben 3.845,51 €. Mit Abzugszeile müssten es S + L = 3.933,01 € sein, ohne Abzugszeile S = 3.845,51 €. Passt ‚ohne‘, ist die Antwort auf die Frage nach der Abzugszeile vermutlich ‚nein‘. Steht die Zeile wirklich da, erhöhen Sie den Betrag auf 3.933,01 €; das ist der bezahlte Betrag.“

Die Probe fängt damit:

| Irrtum | Was die Probe sieht |
|---|---|
| „Ja“ bei Bruttobeträgen | Betrag = S, verlangt wäre S + L → Fehler |
| „Ja“ bei Nettobetrag der Position (#209) | Betrag = S, verlangt wäre S + L → Fehler, mit dem richtigen Betrag |
| „Nein“, obwohl abgezogen wurde, bei richtig erfasstem Bruttobetrag | Betrag = S + L, verlangt wäre S → Fehler |
| Leerstand, fremde Einheiten, fehlende Eigenbeträge | spielen keine Rolle, denn die Probe läuft gegen S und nicht gegen die eingetragenen Einzelbeträge |

**Was sie nicht fangen kann:** „Nein“, obwohl abgezogen wurde, **und** gleichzeitig Betrag = S. Dann ist alles in sich stimmig netto, und Mietfuchs zöge L ein zweites Mal ab. Zahlen allein unterscheiden das nicht. Dagegen helfen nur die Frage nach der sichtbaren Zeile mit Beispielzeile, der Hilfetext an der Heizposition („bezahlter Betrag vor Abzug“) und künftig das Auslesen der Abzugszeile durch die KI (#103).

**Empfänger** in der Position `service_cost_item_id` (`landlordRecipients`, beide Teile über `take()` und damit durch das begrenzt, was nach den Einzel- und Eigenbeträgen übrig ist):

1. **Eigennutzungsteil** L_self = `service_self_landlord_cents`, falls ausgewiesen. Sonst gilt die **Näherung** L × selfNet / S, wobei selfNet die Σ der Eigenbeträge ist. Die Näherung ist exakt nur, wenn alle Topfkosten nach demselben linearen Schlüssel verteilt sind. Nutzerbezogene Gebühren, Warmwasser und Strom in derselben Position oder mehrere Topfpositionen verschieben sie leicht. Gebucht wird über `take()` in `selfUse`, ist also in der Steuer privat.
2. **`co2Share`** = L − L_self, über `take()`. Das ist der abziehbare Teil.
3. **`amountsRest`** = was dann übrig ist, also der Anteil von S ohne Einzelbetrag (Leerstand, außerhalb). Er kann wegen `take()` nicht negativ werden.

Gerundet wird mit allen anderen Empfängern in **einem** Restverfahren (#203).

**Ausweis:** Je Mieter stehen der Mieteranteil („in Ihren Heizkosten enthalten“) und „vom Vermieter übernommen“. Die Werte kommen aus `co2_tenant_reliefs`. Sonst gilt die Anzeigenäherung L × Netto_t / S, gerundet und ohne Buchung. Dazu Einstufung und Grundlagen laut Messdienst und der Satz „Der Anteil des Vermieters ist in den Heizkosten oben bereits abgezogen.“

**Steuer:** Bei bestandener Probe ist Σ Topf = S + L, also sind die Werbungskosten der bezahlte Betrag, L eingeschlossen. `co2Share` steht im Vermieteranteil und ist abziehbar, L_self ist privat.

**Beispiel A (Techem-Muster, öffentlich):**

- Anlieferung Brennstoff 3.540,00 €, abzüglich CO₂-Kosten Vermieter −87,50 € (250,00 € × 35 %; 46,4 kg/m² → 70 %, halbiert nach § 9).
- S = Summe der Nutzerkosten Heizungsanlage 3.845,51 €.
- **Betrag der Position** = 3.933,01 €, Probe bestanden.
- **Ergebnis:** `co2Share` 87,50 €, `amountsRest` 0, kein Mieter gekürzt.

**Beispiel B (Eigennutzung, Näherung):**

- Messdienst netto: Mieterin A 1.200 €, Mieter B 1.100 €, eigene Wohnung 600 €; S = 2.900 €, L = 100 €, Betrag 3.000 €.
- **Ergebnis:** L_self = 100 × 600 / 2.900 = 20,69 €, `co2Share` = 79,31 €, Eigenanteil = 620,69 €.
- **Mit ausgewiesenem L_self = 25,00 €:** `co2Share` 75,00 €, Eigenanteil 625,00 €.

**Beispiel C (Leerstand):**

- Wie B, aber die dritte Wohnung steht leer, und ihr Messdienstbetrag von 600 € ist nicht eingetragen.
- Probe: 3.000 = 2.900 + 100, bestanden.
- **Ergebnis:** `co2Share` 100 €, `amountsRest` (Leerstand) 600 €.
- Die Prüfung der zweiten Fassung hätte hier nichts gesehen.

### 5.5 Anteil des Mieters an den CO₂-Kosten (Ausweis)

- **Abzugszeile** (5.3): `tenantCo2Cents` = round(C × x_t / A) − r_t.
- **Vorwegabzug** (5.4): aus dem Messdienst, sonst (C − L) × Netto_t / Σ Netto.

Das ist eine Anzeigezahl. Der Rechenweg sagt „gerundet“.

### 5.6 Kürzungsbeträge

Die 3 % nach § 7 Abs. 4 sind round(3 % × Σ der Heizzeilen des Mieters) **nach** einer etwaigen Abzugszeile.

Auf **denselben Stand** wird jetzt auch die 15-%-Kürzung nach § 12 HeizkostenV gerechnet (A9). Ohne CO₂-Angaben ändert sich daran keine Zahl.

Die Kürzungen werden einzeln genannt und nicht summiert (11.6).

### 5.7 Rechenweg (#114)

Die Zeile `co2Relief` zeigt:

1. „Ihr Anteil an den Heiz- und Warmwasserkosten: x_t von A“
2. „darin CO₂-Kosten: C × x_t / A“
3. „Anteil des Vermieters: Stufe …, ‰ → …“
4. „Restcent …“

Bei `serviceDeducted` trägt die Heizzeile des Mieters einen zusätzlichen Schritt: „CO₂: Anteil des Vermieters laut Messdienst bereits abgezogen: …“.

### 5.8 Erstattung an Selbstversorger (späte PR)

- Sie steht als Zeile `co2Refund` mit −Betrag in der Abrechnung des Jahres `settle_year`, beim Vermieter `co2Refund` +Betrag (`totalCents` 0).
- **Hinweise:**
  - `co2.refund-late`: Anzeige mehr als 12 Monate nach der Lieferantenabrechnung, also Ausschlussfrist.
  - `co2.refund-not-next`: `settle_year` ist nicht die nächste Abrechnung nach der Anzeige, oder es gibt keine Vorauszahlung (§ 6 Abs. 2 S. 4, A16).
  - `co2.refund-due`: 12 Monate nach der Anzeige noch nicht verrechnet.
- Die Rechenhilfe wendet § 8 und § 9 an (A15).
- **Steuer:** Die Verrechnung senkt das Ist der Einnahmen. Darüber hinaus ist nichts zu tun.

### 5.9 Mietkonto, Regression, Abschluss

- **Mietkonto:** unberührt.
- **Regression des Umstiegs:** Die db.json hat keine CO₂-Angaben; beide Seiten rechnen ohne.
- **Abgeschlossene Abrechnungen** bleiben eingefroren. `deviation` zeigt nachträglich erfasste CO₂-Angaben.

---

## 6. Oberfläche

### 6.1 Kosten: Karte „CO₂-Kosten der Heizung {Jahr}“

Die Karte erscheint ab 2023, sobald es eine Heizposition gibt. Die Logik liegt in `client/src/co2Form.ts`, ohne DOM prüfbar; Auswahlfelder werden aus Optionslisten gespeist.

1. **„Womit wird geheizt?“**
   - Energieträger, vorbelegt aus der Heizanlage (4.1) und dort mitgespeichert, wenn er leer war. Gibt es noch keine Anlage, legt die Antwort die gedachte Anlage des Objekts an.
   - Bei Wärmepumpe, Holz oder Pellets oder ohne Zentralheizung kommt ein Satz und Schluss.
2. **„Wer hat die CO₂-Kosten aufgeteilt?“**
   - **Der Messdienst oder die Hausverwaltung.** Dann die Pflichtfrage, **ohne Vorauswahl**: **„Steht in der Kostenaufstellung eine Zeile wie ‚Abzüglich CO₂-Kosten Vermieter‘, oder in Ihrer Abrechnung je Mieter ‚vom Vermieter übernommen‘?“** Darunter steht eine Beispielzeile aus dem Techem-Muster: „Anlieferung Brennstoff 3.540,00 · Abzüglich CO₂-Kosten Vermieter −87,50 · Verbrauch 3.452,50“.
     - **Ja, eine solche Zeile steht da.**
     - **Nein, die CO₂-Kosten sind nur ausgewiesen.** So ist es oft bei Eigentümergemeinschaften.

     Danach folgen die Felder in der Reihenfolge der Messdienstabrechnung: Zeitraum, **Summe der Nutzerkosten Heizung und Warmwasser (S, Pflicht)**, CO₂ gesamt (kg), Fläche, kg je m², Anteil Vermieter (%), CO₂-Kosten gesamt (€), davon Vermieter (€). Aufklappbar: „je Mieter, falls ausgewiesen“ und „Ihre eigene Wohnung: vom Vermieter übernommen“. Unter den Feldern steht live das Ergebnis der Probe („Ihre Positionen: … € · erwartet: … €“).
   - **Niemand. Die Abrechnung des Messdienstes enthält keine CO₂-Aufteilung.** In PR 1 ist das zunächst nur die Methode samt Warnung, die Rechnungsfelder kommen mit PR 2. Dann ein Satz mit Betrag: „Ihre Mieter dürfen ihre Heizkosten um 3 % kürzen, zusammen … €. Sie können die Aufteilung hier selbst nachholen; melden Sie dem Messdienst künftig kg und € von der Lieferantenrechnung.“ Danach folgen die Rechnungsfelder wie unten.
   - **Ich rechne die Heizung selbst ab (ohne Messdienst).**
3. **Rechnungen** (bei den beiden letzten Methoden):
   - **Gas, Fernwärme:** Tabelle der Rechnungen mit Bezeichnung, Rechnungsdatum, Rechnungszeitraum, „CO₂ in kg“ und „CO₂-Kosten in €“. Der vorgeschlagene Anteil im Abrechnungszeitraum ist überschreibbar.
   - **Öl, Flüssiggas:** „Bestand am {Beginn}“ (vorbelegt), Lieferungen mit Datum, Menge, kg und €, und „Bestand am {Ende}“. Die Vorschau zeigt den Verbrauch und seine Bewertung.
   - **Etagenheizungen auf Ihren Namen:** Lieferzeile mit Auswahl der Wohnung.
4. **Abrechnungszeitraum**, vorbelegt mit dem 01.01.–31.12. Der Satz dazu: „Rechnet Ihr Messdienst z. B. von Mai bis April ab, tragen Sie diesen Zeitraum ein.“
5. **Wohnfläche für die Einstufung**, vorbelegt: „Summe der beheizten Wohnungen: … m²“.
6. **Weitere Angaben** (zugeklappt): Nichtwohngebäude (§ 8), Einschränkung nach § 9, Fernwärme-Erstanschluss.
7. **Vorschau** über `/api/co2/:year/preview`, zum Beispiel: „40,2 kg CO₂/m² → Stufe 37 bis unter 42: Mieter 40 %, Vermieter 60 % = 464,27 €“.
8. **Weitere Anlage** über „+ weitere Heizanlage“ (F9), mit Auswahl der Wohnungen.

**„Aus {Vorjahr} übernehmen“** kopiert Energieträger, Methode, Fläche, § 8 und § 9 und den Endbestand als Anfangsbestand, **nie Beträge**.

**An der Heizposition** (Kostenformular, Kostenart „Heizung und Warmwasser“, Schlüssel `amounts`):

- Der Hilfetext sagt: „Betrag: was Sie bezahlt haben, also die Gesamtkosten **vor** ‚Abzüglich CO₂-Kosten Vermieter‘. Je Mieter: ‚Ihre Heizkosten + Ihre Warmwasserkosten‘, ohne Kaltwasser und Hausnebenkosten.“
- Ist für das Jahr `serviceDeducted` gewählt, zeigt die Summenzeile „davon Vermieteranteil CO₂: …“ neben „Rest beim Vermieter“ und das Ergebnis der Probe gegen S.

### 6.2 Abrechnung

- **Je Mieter:** die Zeile „abzüglich CO₂-Kostenanteil des Vermieters (§ 5 CO2KostAufG)“ (bei 5.3) mit Rechenweg.
- **Druckblock „CO₂-Kostenaufteilung“** (nicht `no-print`), Erfüllung von § 7 Abs. 3. Er enthält:
  - den Mieteranteil,
  - die Einstufung mit kompakter Stufentabelle und markierter Stufe,
  - die Grundlagen: Energieträger, Zeitraum, kg (je Rechnung oder Bestandsrechnung), Fläche, C, L, gegebenenfalls § 8 oder § 9 und „laut Abrechnung des Messdienstes“,
  - bei `serviceDeducted` den Satz „bereits abgezogen“.
- **Vermieteranteil:** Grund „CO₂-Kosten (Anteil des Vermieters)“.

### 6.3 Weitere Stellen

- **Stammdaten:** Karte „Heizung“ mit der Heizanlage (Energieträger, Art der Versorgung, ab der zweiten Anlage die versorgten Wohnungen). Den Aufbau der Karte bestimmt #99; der CO₂-Teil braucht nur die Felder aus 4.1.
- **Cockpit:** Die Ampel liest die Hinweise. `co2.fuel-unknown` zählt mit; Ankündigung im CHANGELOG und in der Anleitung (A17).
- **Anleitungen** (`shared/guides.ts`):
  - `meteringService` wird berichtigt (14.1).
  - In `multiFamily` und `condo` werden die Sätze „rechnet das noch nicht“ ersetzt.
  - Neue Anleitung „Heizung mit Gas, Öl oder Fernwärme: CO₂-Kosten aufteilen“ mit nachgerechnetem Beispiel (guides.test.ts).
  - Der Satz zum Betriebsstrom: „Steht in der Heizkostenabrechnung ein Betriebsstromanteil, ziehen Sie ihn beim Allgemeinstrom ab.“

---

## 7. Hinweise, Regeln, Lexikon

### 7.1 Hinweis-Codes (`noticeKinds`)

| Code | Stufe | Wann | Betrag |
|---|---|---|---|
| `co2.missing` | warning | Mietfuchs-Jahr ab 2024 ohne Datensatz (bzw. Zeitraum ab 2023 mit unvollständigem Datensatz), Heizung an Mieter abgerechnet, Energieträger der Anlage fossil oder Fernwärme | 3 % je Mieter |
| `co2.missing-first-year` | hint | wie `co2.missing`, aber Mietfuchs-Jahr 2023 ohne Datensatz: Der Zeitraum kann 2022 begonnen haben. Der Text bittet, den Zeitraum einzutragen; beginnt er ab 01.01.2023, gilt die Warnung. | „falls ab 2023: 3 % je Mieter …“ |
| `co2.fuel-unknown` | hint | wie oben, Energieträger unbekannt | „falls fossil: 3 % je Mieter …“ |
| `co2.service-unsplit` | **warning** | Methode `selfAfterService` **ohne** eigene Aufteilung (keine Rechnungszeilen; in PR 1 immer so). Die Kürzung ist sicher. | 3 % je Mieter |
| `co2.service-unsplit-healed` | hint | `selfAfterService` mit eigener Aufteilung. Mietfuchs zieht ab und weist aus; ob ein nachgeholter Ausweis die Kürzung ausschließt, ist nicht entschieden (11.13). Empfehlung: dem Messdienst künftig kg und € melden. | „bis zu 3 % je Mieter …“ |
| `co2.incomplete` | warning | Fläche, kg oder (bei `service*`) Wert, ‰ oder L fehlen | 3 % |
| `co2.exceeds-heating` | error | C > Topf, kein Topf, oder F8 ohne Direktposition | 3 % |
| `co2.stock-invalid` | error | Endbestand > Anfangsbestand + Lieferungen | 3 % |
| `co2.sum-check` | error | `service*`: Σ Topfbeträge ≠ S + L (Vorwegabzug) bzw. ≠ S, oder Σ Einzelbeträge > S (5.4). Die CO₂-Buchung entfällt. | nennt beide Deutungen mit Zahlen |
| `co2.period-uncovered` | hint | Rechnungen decken den Zeitraum nicht ganz ab, es wurde hochgerechnet (5.1) | fehlende Tage, Faktor |
| `co2.reliefs-invalid` | error | `serviceShown`: Σ Einzelwerte > L oder ein Wert > Heizanteil des Mieters; die Werte werden verworfen, proportional verteilt | – |
| `co2.item-spans-plants` | error | Verteilbasis einer Heizposition reicht in zwei Anlagen | – |
| `co2.stage-mismatch` | hint | Messdienstangaben passen nicht zur Tabelle (5.1 Schritt 9) | – |
| `co2.reliefs-missing` | warning | `serviceShown`: Einzelwerte für manche Mieter fehlen | – |
| `co2.pool-keys` | hint | Topfpositionen mit gemischten Schlüsseln | – |
| `co2.fuel-before-2023` | hint | Bestand oder Lieferung mit Rechnung vor 2023: kg zählen, € nicht | – |
| `co2.period-not-calendar` | hint | Zeitraum ≠ Kalenderjahr: Die CO₂-Angaben gelten für diesen Zeitraum, Mietfuchs rechnet die übrige Abrechnung im Kalenderjahr | – |
| `co2.restriction` | hint | § 9 gewählt: Nachweis (Abs. 3) | – |
| `co2.non-residential` | hint | § 8 gewählt | – |
| `co2.refund-late`, `co2.refund-not-next`, `co2.refund-due` | hint, hint, warning | späte PR (5.8) | – |

`NoticeSubject.kind` bekommt `'co2'` (id = Datensatz oder Jahr). Bei fehlendem Datensatz führt „Hier beheben →“ zur Karte.

### 7.2 Regelverzeichnis (`rules.ts`; `RULES_AS_OF` auf den Tag der Durchsicht)

| code | Norm | gültig ab |
|---|---|---|
| `co2-split` | §§ 5, 7 Abs. 1–4, 11 Abs. 2 CO2KostAufG, Anlage | 2023-01-01, geprüft am Beginn des Zeitraums |
| `co2-non-residential` | § 8 | 2023-01-01 |
| `co2-restriction` | § 9 | 2023-01-01 |
| `co2-self-supply` | § 6 Abs. 2, 3 | 2023-01-01 (späte PR) |

`co2-half-split` (§ 5a) kommt erst mit seiner Umsetzung.

`ruleCoverage` wird mit dem Zeitraum des Datensatzes aufgerufen, nicht mit dem Mietfuchs-Jahr.

### 7.3 Lexikon (`shared/glossary.ts`)

- **`co2Split` „CO₂-Kostenaufteilung“:**
  - Beispiel B1.
  - „Brauche ich das?“: Gas, Öl, Flüssiggas, Kohle oder Fernwärme, ab Zeiträumen, die 2023 beginnen. Dazu der Satz: „Hat Ihr Messdienst aufgeteilt, ist der Anteil meist schon abgezogen.“
- **`co2Stage` „Einstufung“:** Rundung, Grenzbeispiel 11,96 → 12,0 → 10 %, kurzer Zeitraum.
- **`co2Area` „Wohnfläche für die CO₂-Einstufung“:** offen (11.1); im Zweifel die Fläche des Messdienstes.
- **`co2Deducted` „Vorwegabzug“:**
  - Was der Messdienst tut.
  - Warum die Heizposition trotzdem den bezahlten Betrag tragen muss: Beispiel A mit 3.933,01 €.
- **`co2Period` „Abrechnungszeitraum der Heizung“:** Zuordnung zum Jahr, in dem er endet; Anwendbarkeit ab Beginn 2023.
- **`co2Refund` „CO₂-Erstattung bei eigener Heizung des Mieters“:** Fristen, Verrechnung, −5 %. Kommt mit der späten PR; vorher steht der Anspruch kurz in `co2Split`.

---

## 8. Umstieg und Migration

- `0014_co2` (erzeugt): `CREATE TABLE` für `co2_statements`, `co2_deliveries`, `co2_tenant_reliefs` und, falls #99 noch nicht gemergt ist, die Heizanlage mit ihrer Einheitenzuordnung (4.1), dazu `cost_items.heating_plant_id` (`ADD COLUMN`, nullbar). Später `co2_refunds` als `0015`. Vorher legt `backupBeforeMigrating` die Sicherung an. Die Marke wird im Test festgehalten, `embed-migrations` neu erzeugt.
- Keine Datenanweisung; der eingefrorene Eingang bleibt unverändert.
- Praxislauf vor dem Release. Der Smoke-Test bekommt `PUT /api/co2/2025` mit Lesen.
- CHANGELOG „Unveröffentlicht“ mit Link auf #97 und dem Hinweis auf die neue Ampelmeldung. MIGRATION.md bleibt unverändert.

---

## 9. Tests

### 9.1 Engine (`server/test/co2.test.ts`)

**Grenzen:**

| Wert | Ergebnis | Anmerkung |
|---|---|---|
| 11,9 | 0 % | |
| 11,95 | 12,0 → 10 % | BMWK-Rechner: 0 %, Abweichung im Testnamen |
| 12,0 | 10 % | Rechner: 0 % |
| 51,9 | 80 % | |
| 52,0 | 95 % | |
| 7.230 kg / 600 m² = 12,05 | 12,1 | |
| 7.149,7 / 600 | 11,9 | |

**Weitere Fälle:**

- **§ 9:** 950 → 475; 100 → 50; Techem-Muster 46,4 → 700 → 350 → L = 87,50 € aus 250,00 €; `both` → keine Aufteilung. **§ 8** → 500.
- **Zeitraum:**
  - Beginn 01.05.2022 → nicht anwendbar, kein Hinweis.
  - Beginn 01.05.2025 → anwendbar.
  - 01.05.2027–30.04.2028 → f = 1, nicht 366/365.
  - Erstbezug 01.07.–31.12.2025 → f = 184/365 → Grenzen 6,05 / 8,57 / 11,09; der Wert 10,0 → 20 %.
  - Mieterwechsel und Eigentümerwechsel: kein Teiljahr.
- **Gaszeile mit Rechnungszeitraum 15.03.2025–14.03.2026** auf 01.05.2025–30.04.2026: Anteil 318/365 = 871 ‰; fehlend 47 Tage → `co2.period-uncovered`, Hochrechnung × 365/318. Mit der Folgerechnung ab 15.03.2026 entfällt der Hinweis, und es wird nicht mehr hochgerechnet.
- **`co2.missing-first-year`:** Mietfuchs-Jahr 2023 ohne Datensatz → Hinweis, keine Warnung. 2024 → `co2.missing`. Datensatz 05/2022–04/2023 → nichts.
- **Öl-Bestand** wie 5.2:
  - E = 15.254,8 kg (50,849… → 50,8), C = 648,10 €, L = 518,48 €, Endbestand 4.817,3 kg / 315,30 €;
  - Jahr ohne Lieferung: Verbrauch nur aus dem Bestand, L > 0;
  - Endbestand zu groß → error;
  - Bestand aus 2022: € 0, kg zählen.
- **F8:** zwei Wohnungen mit eigener Gasrechnung; Einstufung über Σ kg / Σ Fläche; r_t = ‰ × C_u × x_t / A_u. Mieterwechsel mit zwei Monaten Leerstand dazwischen: Die Summe der Abzüge ist kleiner als ‰ × C_u, und der Leerstandsteil wird nicht gebucht (keine Normierung).
- **F9:** zwei Anlagen mit zwei Stufen; überlappende Anlagen → 400; Position über beide Anlagen → `co2.item-spans-plants`, keine Minderung durch sie.
- **`serviceShown` mit Einzelwerten:** Σ > L → `co2.reliefs-invalid` und proportional; ein Wert > Heizanteil → ebenso.
- **Sperren:** Öl mit `self` in PR 2 → 400; zweite Anlage oder `perUnit` vor PR 4 → 400.
- **Fernwärme** mit `district_ets_new` → keine Aufteilung. **Wärmepumpe** → nichts.

### 9.2 Nachgerechnete Beispiele

- **B1 (Erdgas 2023, BMWK-Rechenweg):**
  - 24.105,6 kg / 600 m² → 40,2 → 60 %; C = 773,79 €; L = 464,27 €.
  - **Verteilung** auf drei Mieter mit Bruttobeträgen 3.600 / 3.000 / 2.400 € (Methode `self`): exakt 185,7096 / 154,758 / 123,8064 € → **185,71 / 154,76 / 123,80 €**, zusammen 464,27 €.
- **B2 (Heizöl 2024):** 59,5 → 95 %; C = 1.433,15 €; L = 1.361,49 €.
- **B3 (Brennwertfalle):** 38,9 → 60 % gegen 43,0 → 70 % (Plausibilitätsprüfung).
- **Beispiel A (Techem-Muster), `serviceDeducted`:** S = 3.845,51 €, Betrag 3.933,01 € → Probe bestanden, `co2Share` 87,50 €, kein Mieter gekürzt, Werbungskosten 3.933,01 €.
  - **Gegenprobe A′:** `serviceShown`, Bruttobeträge je Nutzer mit S = Betrag = 3.933,01 € → Probe bestanden, Abzugszeilen zusammen 87,50 €.
  - **Fehlerfall A″ („ja“ bei Nettobetrag der Position, #209):** Betrag 3.845,51 € → `co2.sum-check` mit „erwartet 3.933,01 €“, keine CO₂-Buchung.
  - **Fehlerfall A‴ („ja“ bei Bruttobeträgen):** S = Betrag = 3.933,01 € (brutto), Antwort ja → Probe verlangt 4.020,51 € → `co2.sum-check`, Deutung „ohne“ passt.
  - **Fehlerfall A⁗ („nein“, obwohl abgezogen, Betrag brutto richtig):** S = 3.845,51 €, Betrag 3.933,01 €, Antwort nein → Probe verlangt 3.845,51 € → `co2.sum-check`, Deutung „mit“ passt.
  - **Benannte Lücke:** „nein“ und Betrag = S = 3.845,51 € → Probe bestanden, doppelter Abzug. Der Test hält fest, dass das so ist, damit eine spätere Erkennung (#103) es rot werden lässt.
- **Beispiel B (Eigennutzung, Vorwegabzug):** Näherung → `co2Share` 79,31 €, Eigenanteil 620,69 €; mit ausgewiesenem L_self 25 € → 75,00 / 625,00 €. Die Steuerübersicht nimmt den Eigenanteil als privat.
- **Beispiel C (Leerstand, Vorwegabzug):** `co2Share` 100 €, `amountsRest` 600 €.
- **`take()`-Grenze:** Betrag netto erfasst und Eigenbetrag eingetragen: `amountsRest` wird nie negativ; die Probe meldet den Fehler.
- **Reale Abrechnung, anonymisiert (`selfAfterService`):**
  - Hinweis mit 3 % von 4.276,51 € = 128,30 € über vier Mieter.
  - Gasrechnung umgerechnet auf Mai bis April.
  - Grenzfall 27,0 gegen 26,9: zwei Flächen bzw. kg-Werte, die die Stufe kippen. Festschreiben.

### 9.3 Verteilung und Invarianten (`calc.test.ts`, Zufallsbestände)

Der Generator von #203 wird um zufällige Datensätze erweitert: alle Methoden, F8, F9, Bestand, § 8, § 9, Zeitraum, Einzelwerte, Pauschale, Inklusivmiete, Eigennutzung, Leerstand. Zu prüfen:

- Σ Zeilen = Gesamtkosten.
- 0 ≤ Abzug ≤ Heizanteil je Mieter.
- R ≤ L + 0,5 ct.
- **`serviceDeducted`: Kein Mieter zahlt etwas anderes als seinen Einzelbetrag**, und `co2Share` + `amountsRest` + Eigenanteil = Betrag − Σ Einzelbeträge; keine Vermieterzeile wird negativ.
- **Kein doppelter Abzug:** Bei `serviceDeducted` gibt es nie eine Zeile `co2Relief`.
- Ohne Datensatz ist jede Zahl identisch zum Stand ohne die Funktion.
- Zwei Objekte rechnen unabhängig.
- 15-%- und 3-%-Beträge auf derselben Grundlage (A9).
- Golden F01–F11 unverändert. Fixtures mit Heizposition ab 2023 bekommen begründet `co2.fuel-unknown` oder einen Energieträger.

### 9.4 API, Schema, Client

- **`api.test.ts`:**
  - CRUD und Vorschau.
  - `?property=` bei zwei Objekten.
  - Einzelwert eines fremden Objekts → 400; `serviceDeducted` ohne `amounts`-Position → 400; überlappende Anlagen → 400.
  - Ein unbekanntes Feld wird verworfen; 503 ohne Datenbank.
  - Der Abschluss friert `co2` ein, `deviation` zeigt Änderungen.
- **Prüfungen von Schema und Migration:** `schema.test.ts`, Migrationsmarke, `db-golden`, `db-changeover`.
- **`glossary.test.ts`**, **`guides.test.ts`** (mit dem berichtigten Beispiel `meteringService`), **`anrede.test.ts`**.
- **Client:**
  - `co2Form.test.ts`: Vorbelegung, Pflichtfrage nach der Abzugszeile **ohne Vorauswahl**, Pflichtfeld S, Live-Probe, Bestandsvorschau, Übernahme ohne Beträge.
  - jsdom: Auswahlfelder entsprechen dem gespeicherten Wert.
  - `notices.test.ts`: Ampel.

---

## 10. Nicht-Ziele

- **Keine HeizkostenV-Engine** (Entscheidung 1 aus #85, #99). Das heißt: keine Trennung von Heizung und Warmwasser, keine Gradtage, keine Verbrauchsermittlung für den Abzug. Der Marktvergleich bestätigt die Entscheidung für Kleinvermieter.
- **§§ 5a, 5b, 5d:** nicht berechnet, nicht im Regelverzeichnis. Vorbereitet ist nur, dass das Verhältnis aus **einer** Funktion kommt (‰). Abrechnungen 2028 entstehen frühestens 2029, die Durchsicht (#110) baut es dann.
- **Kein Rückfall, der kg oder € vorrechnet.** Standardwerte und Preise dienen nur der Plausibilitätsprüfung (13, PR 5).
- **Kein ARGE/bved-Datenaustausch.** Den gibt es nur in Verwaltersoftware, und die Spezifikation ist nicht frei.
- **Kein Stufenmodell für Nichtwohngebäude.** Es existiert nicht.
- **Keine automatische Senkung einer Pauschale oder Warmmiete** (11.7).
- **Kein Nachhalten der Hinweispflicht bei Vertragsschluss.** Dazu stehen nur Sätze in Lexikon und Anleitung.
- **Kein freier CO₂-Prozentsatz.** Techem rät davon ab, und zulasten des Mieters ist er unwirksam (§ 6 Abs. 1).
- **Kein abweichender Abrechnungszeitraum für die ganze Abrechnung.** Das ist #208 (Schnittstelle in 12).

---

## 11. Offene Rechtsfragen

Jede mit der Übergangsregel, nach der Mietfuchs bis zur Klärung verfährt.

1. **Wohnflächenbegriff** (#109): Das Gesetz definiert ihn nicht. Der GdW nimmt die Fläche der Heizkostenabrechnung, der bved die WoFlV.
   **Regel:** eigenes Feld, vorbelegt; im Zweifel die Fläche des Messdienstes.
2. **Öl im Tank:** nach Verbrauch, gestützt auf die Gesetzesbegründung laut GdW, ista und Immoware24. **Entschieden.** Offen bleibt nur die Bewertungsfolge.
   **Regel:** Verbraucht wird das Älteste zuerst; das ist beschrieben und im Ausweis sichtbar.
3. **§ 11 Abs. 2 S. 2 und die Einstufung:** Der Wortlaut nimmt nur die **Kosten** aus.
   **Regel:** kg zählen für die Einstufung, € nicht. Der BMWK-Rechner ist dafür kein Beleg (A10), die Entscheidung beruht allein auf dem Wortlaut.
4. **Umrechnung abweichender Rechnungszeiträume** (§ 5 Abs. 1 S. 5): Die Methode ist nicht vorgegeben.
   **Regel:** tagesgenau als Vorschlag, überschreibbar.
5. **Rundung:** kaufmännisch angenommen. Der BMWK-Rechner rundet nicht.
   **Regel:** dem Gesetz folgen.
6. **Addieren sich die 3 % nach § 7 Abs. 4 und die Kürzungen nach § 12 HeizkostenV?**
   - Der in #85 und #97 zitierte Satz über das Nebeneinander steht im heutigen § 12 Abs. 1 nicht (Satz 3 betrifft § 6a, Satz 4 das Wohnungseigentum; gelesen am 04.10.2026). Der Issue-Kommentar ist zu berichtigen.
   - Die ista-FAQ sagt: „Dieses Kürzungsrecht gilt **kumulativ** zu den bereits in der Heizkostenverordnung vorgesehenen Kürzungsrechten“ ([ista-FAQ für Vermieter und Verwalter](https://www.ista.com/de/kontakt-service/vermieter-oder-verwalter/faq/)). Das ist die Auffassung eines Messdienstes, nicht Gesetz.

   **Regel:** einzeln nennen, nicht summieren, keine Aussage über das Zusammentreffen.
7. **Pauschale, Inklusiv- oder Warmmiete und § 6 Abs. 1:** Muss sie um den Vermieteranteil sinken?
   **Regel:** keine Rechnung, nur ein Lexikonsatz.
8. **§ 6 Abs. 2 S. 6 (Hinweis bei Vertragsschluss):** Gilt er allgemein oder nur bei Heizungen nach § 43 GModG?
   **Regel:** Die Anleitung empfiehlt den Hinweis immer.
9. **„Überwiegend dem Wohnen“:** Der Maßstab ist offen.
   **Regel:** Schalter, Vorgabe Wohngebäude.
10. **Fernwärme-Erstanschluss ohne Anlagen im EU-Emissionshandel:** Der Rechner setzt 0 %, das Gesetz nimmt nur ETS-Lieferungen aus.
    **Regel:** Wortlaut.
11. **Preis 2027:** offen, bis das UBA ihn veröffentlicht. Nur die Versteigerungen bis 30.11.2026 zählen. Das betrifft nur die Plausibilitätsprüfung.
12. **Rechtsprechung zum CO2KostAufG:** keine gefunden.
13. **Heilt ein nachgeholter Ausweis die Kürzung?** Teilt der Vermieter in der Betriebskostenabrechnung auf, die der Messdienst ohne Aufteilung geliefert hat: Entfällt dann das Kürzungsrecht? § 7 Abs. 3 verlangt den Ausweis „in der Heizkostenabrechnung“; Rechtsprechung gibt es nicht.
    **Regel:** abziehen und ausweisen, dazu der Hinweis `co2.service-unsplit` mit dem Betrag „bis zu“.
14. **Abweichender Heizzeitraum ohne Vereinbarung:** Darf der Heizkostenzeitraum vom Zeitraum der übrigen Betriebskosten abweichen? Das ist für #208 zu klären.

---

## 12. Schnittstelle zu #208 (Abrechnungszeitraum ≠ Kalenderjahr)

Der abweichende Abrechnungszeitraum ist das eigene Vorhaben #208 (Zweig `feat/abrechnungszeitraum`). Die Schnittstelle besteht aus **einem Feldpaar und einer Regel**.

| | bis #208 | mit #208 |
|---|---|---|
| **Feldpaar** `co2_statements.period_from`, `period_to` (Pflicht) | vom Nutzer, Vorgabe 01.01.–31.12. des Mietfuchs-Jahres | Vorgabe ist der Abrechnungszeitraum des Objekts. Weicht er ab, gibt es den Hinweis `co2.period-not-calendar`, umbenannt in `co2.period-differs` (Rechtsfrage 11.14). |
| **Regel** Zuordnung des Datensatzes | zum Mietfuchs-Jahr, in dem der Zeitraum endet (`year`) | `year` wird durch die Kennung des Abrechnungszeitraums ersetzt. Das ist eine Migration der Zuordnung, die Werte bleiben. |

**Gerechnet wird in beiden Fällen nur mit dem Feldpaar:** Anwendbarkeit (Beginn ab 01.01.2023), Kürzungsfaktor (zwölf Monate ab Beginn), Abdeckung und Lieferanteile. Dasselbe gilt für `ruleCoverage`.

**Was der CO₂-Teil von #208 braucht:** je Objekt die Abrechnungszeiträume als [Beginn, Ende] mit einer Kennung. Mehr nicht.

---

## 13. Aufwand und Aufteilung in PRs

Gestapelt auf `main`. Jede PR bekommt eine Durchsicht mit frischem Kontext, der Stapel eine Integrationsdurchsicht mit Blick auf Geld und Daten, den Praxislauf und `full-check`. Jede verweist mit `Refs #97`; PR 0 und PR 1 zusätzlich mit `Refs #209`.

| PR | Inhalt | Schätzung |
|---|---|---|
| **0: Anleitung Messdienst** (`Refs #209`) | Text und Beispiel der Anleitung `meteringService` auf den bezahlten Betrag vor Vorwegabzug (14.2 Punkt 1), guides.test.ts. Unabhängig von allem anderen, kann sofort. | 0,5 Tage |
| **1: Messdienst** (`Refs #97`, `Refs #209`) | Migration 0014 (alle Tabellen außer `co2_refunds`), Typen, Repository, Routen, Schnappschuss. Heizanlage mit den Feldern aus 4.1 (falls #99 sie noch nicht hat). Methoden `serviceDeducted` und `serviceShown`: Pflichtfrage ohne Vorgabe, S als Pflichtfeld, harte Probe `co2.sum-check`, `co2Share` und Eigennutzungsteil über `take()`, Abzugszeile für `serviceShown` mit `reliefs-invalid`. Ausweis mit Druckblock. Hinweise `co2.missing`, `missing-first-year`, `fuel-unknown`, `service-unsplit` (warning, Methode ohne eigene Rechnung), `incomplete`, `stage-mismatch`, `reliefs-missing`, `period-not-calendar`, `item-spans-plants`. **Sperren:** `self*`-Methoden außer der Wahl „nicht aufgeteilt“, eine zweite Anlage und `perUnit` → 400 bis PR 2 bzw. PR 4. Zeitraum je Datensatz für die Anwendbarkeit. Feld „Heizung“, Karte auf Kosten (Schritt 1, 2, 4, 5), Hilfetext an der Heizposition. **Berichtigung der Anleitung `meteringService`** (14.1). Regeln `co2-split`, Lexikon `co2Split`, `co2Stage`, `co2Deducted`, `co2Period`, `co2Area`. Tests: Beispiele A bis A⁗, B, C, benannte Lücke, Invarianten. | 4,5–5,5 Tage |
| **2: Selbst aufteilen, Gas und Fernwärme** | Methoden `self` und `selfAfterService` mit Lieferzeilen, Umrechnung auf den Zeitraum, Einstufung, Kürzungsfaktor, Abdeckung und Hochrechnung mit `period-uncovered`, Abzugszeile (5.3), § 8, § 9, Fernwärme-ETS, `pool-keys`, `service-unsplit-healed`, Bezug der 15 % (A9). **Sperre:** Öl und Flüssiggas mit `self*` → 400 bis PR 3. Tests B1, Zeitraum, Abdeckung, reale Abrechnung. | 2,5–3 Tage |
| **3: Öl und Flüssiggas** | Bestandsrechnung (5.2), Vorbelegung aus dem Vorjahr, `stock-invalid`, `fuel-before-2023`. | 1,5 Tage |
| **4: Etagenheizung auf Vermietervertrag und mehrere Anlagen** | F8 (`supply = 'perUnit'`, Formel ohne Normierung) und F9 über die Heizanlagen (4.1); Prüfung überlappender Anlagen; Sperren aufheben. | 1,5–2 Tage |
| **5: Plausibilität** | Preise 2023–2026 und ETS-Preise als Daten mit Fundstelle, EBeV-Faktoren, Hinweis `co2.cost-implausible` mit Erklärung der Brennwertfalle. | 0,5–1 Tag |
| **6: Selbstversorger-Erstattung** | `co2_refunds` (Migration 0015), Gutschriftzeile, drei Fristhinweise, § 8 und § 9 in der Rechenhilfe, Regel `co2-self-supply`, Lexikon `co2Refund`. | 2 Tage |
| **7: KI (optional, an #103)** | Messdienst-PDF: Zeitraum, Nutzerzeilen getrennt nach Kostenblöcken, CO₂-Block gesamt und je Nutzer, **ob ein Vorwegabzug in der Kostenaufstellung steht** (füllt die Methode); Lieferantenrechnung: § 3 Abs. 1 Nr. 1–4. | 1–2 Tage |

**Summe:** etwa 14,5–18 Arbeitstage. PR 1 allein schließt die Lücke beim häufigsten Fall und macht den fehlenden Abzug sichtbar. PR 1 und 2 decken F1–F5, F7, F10–F15 ab.

---

## 14. Folgebefund #209: Anleitung „Messdienst“ und Steuerübersicht

### 14.1 Der Befund

Die Anleitung `meteringService` (shared/guides.ts) sagt: „Unter ‚Betrag €‘ steht der Gesamtbetrag der Abrechnung.“ Beim Vorwegabzug ist der „Gesamtbetrag“ der Messdienstabrechnung **um den CO₂-Anteil des Vermieters gekürzt** (Techem: 3.540,00 € Anlieferung, −87,50 €, „Verbrauch 3.452,50“). Der Vermieter hat aber die volle Gasrechnung bezahlt.

**Folge:** In der Steuerübersicht fehlen ab 2023 bei jedem Nutzer mit Messdienst die CO₂-Kosten des Vermieters als Werbungskosten. Die Verteilung an die Mieter stimmt dabei, denn die Einzelbeträge sind richtig. Deshalb fällt der Fehler sonst nirgends auf.

**Schwere:** Geld in der Steuer, also nach den Labels des Repos `priority: high`. Erfasst als #209. Der Text der Anleitung kann vor #97 behoben werden (14.2 Punkt 1); die Prüfung kommt mit PR 1.

### 14.2 Wie die CO₂-Arbeit es behebt

1. **Text der Anleitung** (sofort möglich, als eigene kleine PR 0 mit `Refs #209` vor PR 1):
   - Schritt 1: „Unter ‚Betrag €‘ tragen Sie ein, was Sie für Heizung und Warmwasser bezahlt haben: die Gesamtkosten der Heizungsanlage **vor** ‚Abzüglich CO₂-Kosten Vermieter‘. Steht diese Zeile in der Abrechnung, rechnen Sie den Betrag dazu.“
   - Schritt 2: „Je Mieter ‚Ihre Heizkosten‘ und ‚Ihre Warmwasserkosten‘; Kaltwasser und weitere Nebenkosten der Messdienstabrechnung als eigene Positionen mit ihrer Kostenart.“
   - Das Beispiel wird auf eine Abrechnung mit Vorwegabzug umgestellt; guides.test.ts rechnet es nach.
   - Unter „Worauf Sie achten müssen“ steht der CO₂-Satz ohne „rechnet das noch nicht“.
2. **Die harte Probe `co2.sum-check`** (PR 1) findet bestehende Bestände, sobald jemand die CO₂-Angaben des Messdienstes samt S einträgt. Sie nennt den Betrag S + L, auf den die Position zu erhöhen ist.
3. **Der neue Grund `co2Share`** macht den Betrag im Vermieteranteil der Abrechnung sichtbar. Die Steuerübersicht nimmt ihn über den Bruttobetrag automatisch als Werbungskosten.
4. **Für Jahre ohne CO₂-Datensatz** fragt der Hinweis `co2.missing` bzw. `fuel-unknown` ohnehin nach der Methode. Mit „Messdienst hat abgezogen“ greift Punkt 2.
5. **Abgeschlossene Abrechnungen** bleiben eingefroren. Die Steuerübersicht eines abgeschlossenen Jahres rechnet die Werbungskosten aus den Kostenpositionen. Wer den Betrag nachträglich erhöht, ändert die Steuer, aber nicht die versandte Abrechnung, denn die Mieterbeträge bleiben gleich und `deviation` zeigt null. Ein Test hält das fest.

### 14.3 Verwandter Befund (Hinweis, kein Teil von #97)

Wer ohne Messdienst mit Öl oder Flüssiggas selbst abrechnet, trägt heute als Heizposition meist die **Lieferungen** des Jahres ein. Nach § 7 Abs. 2 HeizkostenV sind es die Kosten der **verbrauchten** Brennstoffe. Die Bestandsrechnung aus 5.2 liefert den Wert in der Vorschau; ihn an die Position zu übergeben, ist ein eigenes kleines Vorhaben, sinnvoll zusammen mit #99.

---

## 15. Abdeckung Heizkosten insgesamt

Der Nutzer wünscht eine möglichst breite Abdeckung. Deshalb steht hier jede gängige Heizlage privater Vermieter, auch die seltenen, mit ihrem Platz:

- Spalte „nach diesem Entwurf“: was Mietfuchs nach PR 0–7 kann.
- Spalte „danach fehlt“: was dann noch offen ist.
- Spalte „Issue“: wo das Fehlende steht.

„Neues Issue nötig“ heißt: Es gibt noch keins, der Titel ist ein Vorschlag.

| Lage | Nach diesem Entwurf | Danach fehlt | Issue |
|---|---|---|---|
| **Messdienst mit Vorwegabzug** (Techem- und ista-Standard im Mietshaus) | Einzelbeträge netto übernehmen. Vermieteranteil als `co2Share`, Eigennutzungsteil privat. Harte Probe gegen S, Ausweis, Steuer richtig (PR 0, PR 1). Benannte Restlücke: falsches „nein“ bei Nettobetrag. | Auslesen der Messdienst-PDF statt Abtippen | #97, #209, KI: #103 |
| **Messdienst nur ausweisend** (WEG „informativ“, ista ohne Abzug) | Abzugszeile je Mieter, mit Einzelwerten des Messdienstes oder verteilt wie die Heizkosten (PR 1). | – | #97 |
| **Messdienst ohne Aufteilung** (reale Abrechnung) | Hinweis mit beziffertem 3-%-Kürzungsrecht (PR 1). Selbst nachholen aus der Lieferantenrechnung, mit Abzugszeile (PR 2). | Rechtsfrage 11.13, ob ein nachgeholter Ausweis heilt. Komfort: ein Ausdruck „Angaben für den Messdienst“ (kg, €, Fläche, § 9), den der Vermieter dem Messdienst schickt. | #97; Ausdruck: **neues Issue nötig** „CO₂-Angaben für den Messdienst als Ausdruck zusammenstellen“ |
| **Komplettabrechnung des Messdienstes** (Heizung, Warmwasser, Kaltwasser und Hausnebenkosten je Nutzer) | Heute je Kostenart eine `amounts`-Position von Hand. Die Anleitung sagt, welche Blöcke wohin gehören (PR 0). | Übernahme aller Blöcke und Nutzerzeiträume in einem Schritt | #103 (dort auf alle Kostenblöcke und den CO₂-Block erweitern) |
| **Selbstabrechnung mit Wärmemengenzählern** | CO₂-Aufteilung selbst (PR 2) auf den Positionen nach Zählern und Fläche. Die Warnungen zu 15 % und 50–70 % gibt es schon (#140). | Eigene Heizkostenabrechnung nach HeizkostenV: Grund- und Verbrauchskosten, Warmwassertrennung, Zwischenablesung mit Gradtagen, Angaben nach § 6a Abs. 3 auf dem Ausdruck | #99 |
| **Selbstabrechnung mit Heizkostenverteilern ohne Messdienst** | CO₂ wie oben, sofern die Heizkosten als Positionen erfasst sind | Bewertungsfaktoren liegen beim Messdienst. Bewusst nicht vorgesehen (#85, Entscheidung 1). | – (Nicht-Ziel; Hinweis in der Anleitung) |
| **Warmwasser ohne eigenen Wärmezähler** (§ 9 Abs. 2 HeizkostenV, BGH VIII ZR 151/20: 15 %) | – | Hinweis mit beziffertem Kürzungsrecht bei selbst verteilten Heizpositionen | **Neues Issue nötig:** „Hinweis: Warmwasseranteil ohne Wärmezähler ermittelt (§ 9 Abs. 2 HeizkostenV, Kürzung 15 %)“ |
| **Betriebsstrom der Heizung im Allgemeinstrom** | Satz in der Anleitung: den Anteil beim Allgemeinstrom abziehen (PR 1) | Warnung mit beziffertem Betrag, wenn er doppelt umgelegt wird. Plausibilitätsspanne für die Schätzung. | #97 (Umfang „Warnungen“), in dieser Spezifikation nicht enthalten. Besser getrennt: **neues Issue nötig** „Betriebsstrom der Heizung: doppelte Umlage mit dem Allgemeinstrom erkennen“ |
| **Etagenheizung, Vertrag beim Mieter** (Selbstversorger) | Erstattung als Gutschriftzeile mit Fristen, § 8 und § 9, −5 % Gasherd (PR 6) | Hinweis in Textform bei Vertragsschluss nachhalten (nur Lexikon) | #97 |
| **Etagenheizung, Vertrag beim Vermieter** (§ 5 Abs. 1 S. 2) | Lieferzeile je Wohnung, gemeinsame Einstufung, Abzug je Wohnung (PR 4) | – | #97 |
| **Öl oder Flüssiggas mit Tank** | Bestandsrechnung für CO₂ (PR 3), Bestand vor 2023 mit 0 € | Die Heizposition selbst nach Verbrauch statt nach Lieferung (§ 7 Abs. 2 HeizkostenV), Übernahme des Werts aus der Bestandsrechnung | **Neues Issue nötig:** „Öl und Flüssiggas: Brennstoffkosten nach Verbrauch (Anfangsbestand + Lieferungen − Endbestand)“, sinnvoll mit #99 |
| **Fernwärme** | Wie Gas aus der Rechnung des Wärmelieferanten, Schalter für den Erstanschluss an ein Netz im EU-Emissionshandel, § 9 bei Anschlusszwang (PR 2) | – | #97 |
| **Contracting oder Wärmelieferung mit Grund- und Arbeitspreis** | CO₂ wie Fernwärme (§ 2 Abs. 1 S. 2) | Umlagefähigkeit der Contracting-Kosten (§ 556c BGB, WärmeLV), Kostenneutralität | **Neues Issue nötig:** „Wärmelieferung/Contracting: Hinweise nach § 556c BGB und WärmeLV“ |
| **Wärmepumpe oder Strom** | Energieträger wählen → keine CO₂-Aufteilung, keine Hinweise (PR 1). Seit 01.10.2024 gilt die HeizkostenV; die Warnungen dazu greifen schon. | Verbrauchserfassung und Abrechnung der Wärmepumpe selbst | #99 (Wärmemengenzähler) |
| **Pellets oder Holz** | Energieträger wählen → keine CO₂-Aufteilung (PR 1) | Lagerbestand wie Öl für die Brennstoffkosten | im Issue „Brennstoffkosten nach Verbrauch“ (oben) mit aufnehmen |
| **Gemischte Anlage** (Gas + Solarthermie, Gas + Wärmepumpe) | CO₂ nur aus den fossilen Rechnungen, die übrigen tragen 0 kg (PR 2) | – | #97 |
| **Pauschale oder Warmmiete** | Kein Abzug, der Anteil bleibt beim Vermieter. Warnung zu § 2 HeizkostenV gibt es schon (#93). | Rechtsfrage 11.7 (Absenkung nach § 6 Abs. 1). Bezifferter Heizanteil nach BGH VIII ZR 212/05 ist offen (#109). | #97, #109 |
| **Vermietete Eigentumswohnung (WEG-Hausgeld)** | `serviceShown` mit den Werten der Gemeinschaft; bei Vorwegabzug der Gemeinschaft als `amounts` mit Nettobetrag (PR 1). Kürzungen nach § 12 gelten nicht zwischen Eigentümer und Gemeinschaft (§ 12 Abs. 1 S. 4). | – | #97; Anleitung `condo` |
| **Gemischt genutztes Gebäude** | Schalter Nichtwohngebäude → 50 % (§ 8, PR 2). Gewerbe im Wohngebäude nach Stufen. | Maßstab „überwiegend“ (11.9) | #97 |
| **Denkmal, Erhaltungssatzung, Anschlusszwang** | § 9: halbiert oder keine Aufteilung, mit Nachweishinweis (PR 2) | – | #97 |
| **Mehrere Heizungen in einem Objekt** | Je Heizanlage (4.1) ein Datensatz mit eigener Stufe; Positionen über `heating_plant_id` oder über ihre Teilnehmer zugeordnet; `item-spans-plants` (PR 4) | Heizkostenabrechnung je Anlage | #97, #99 (Heizanlage) |
| **Zweifamilienhaus mit Eigennutzung** | Aufteilung gilt (§ 7 Abs. 2); § 2 HeizkostenV als Hinweis gibt es schon | – | #97 |
| **Abweichender Abrechnungszeitraum** (Mai bis April) | CO₂-Teil führt den tatsächlichen Zeitraum für Anwendbarkeit, Kürzung und Lieferanteile (PR 1, PR 2) | Die ganze Abrechnung im abweichenden Zeitraum | #208 |
| **Kürzerer Zeitraum** (Erstbezug, Umstellung) | Gekürzte Stufengrenzen (PR 2) | Rumpfzeitraum der übrigen Abrechnung | #208 |
| **Fernablesbarkeit und monatliche Verbrauchsinformation** (§§ 5, 6a HeizkostenV) | Hinweis ab 2027 gibt es schon | Bezifferte 3-%-Kürzung über ein Merkmal „fernablesbar“ am Zähler | #99 (Zähler), sonst **neues Issue nötig** „Merkmal ‚fernablesbar‘ am Zähler und bezifferte Kürzung nach § 12 Abs. 1 S. 2 HeizkostenV“ |
| **Ab 2028: Heizung nach § 43 GModG** (hälftige Teilung, Netzentgelte, ab 2029 Biobrennstoff, Härtefälle) | Vorbereitet: Das Verhältnis kommt aus einer Funktion | Rechnung nach §§ 5a, 5b, 5d, Merkmal „Heizung nach § 43 GModG, eingebaut nach dem 29.07.2026“, Netzentgelte als Teilposition | **Neues Issue nötig:** „CO₂ und Gas-Netzentgelte ab 2028 hälftig teilen (§§ 5a, 5b, 5d CO2KostAufG)“, fällig vor den Abrechnungen 2028 |
| **Eichfrist der Wärme- und Warmwasserzähler** | – | Hinweis bei abgelaufener Eichung | #98 |
