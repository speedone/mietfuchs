# F16 Eigene Heizkostenabrechnung

Beispiel A des Entwurfs (8.6). Drei Wohnungen: A 60 m², B 80 m², C 60 m², zusammen 200 m². Mieter A
und B seit 2020; in C zieht Mieter C1 zum 30.09.2025 aus, C2 zum 01.10.2025 ein, mit
Zwischenablesung am 30.09.2025. Gasheizung, die auch das Warmwasser bereitet; der Vermieter rechnet
selbst ab, Kalenderjahr 2025, 70 % nach Verbrauch bei Heizung und Warmwasser (§ 7 Abs. 1, § 8 Abs. 1
HeizkostenV). Je Wohnung ein Wärmezähler (kWh) und ein Warmwasserzähler (m³), am Speicher ein
Wärmezähler für das Warmwasser.

| Zähler | 31.12.2024 | 30.09.2025 | 31.12.2025 | Verbrauch |
|---|---|---|---|---|
| Wärme A | 1.000 | | 13.000 | 12.000 kWh |
| Wärme B | 0 | | 16.000 | 16.000 kWh |
| Wärme C | 500 | 7.700 | 12.500 | C1 7.200, C2 4.800 kWh |
| Warmwasser A | 10 | | 40 | 30 m³ |
| Warmwasser B | 0 | | 40 | 40 m³ |
| Warmwasser C | 5 | 43 | 55 | C1 38, C2 12 m³ |
| Wärme am Speicher | 0 | | 9.000 | 9.000 kWh |

Positionen: Erdgas 6.000,00 € (Brennstoff, Heizung und Warmwasser; Rechnung über das Jahr, 60.000 kWh,
10.883,4 kg CO₂, CO₂-Kosten 598,59 €), Betriebsstrom 180,00 €, Wartung 240,00 €, Immissionsmessung
60,00 € (Betrieb, Heizung und Warmwasser), Miete Wärmezähler 120,00 € (Erfassung, nur Heizung), Miete
Warmwasserzähler 60,00 € (Erfassung, nur Warmwasser). Zusammen 6.660,00 €.

## Herleitung

**Warmwasseranteil** (§ 9 Abs. 2 Satz 1, Entwurf 8.3): α = 9.000 kWh / 60.000 kWh = 15,0 %. Die kWh der
Gasrechnung bleiben, wie abgerechnet (§ 9 Abs. 3 letzter Satz; G-B1 abgelehnt).

**Töpfe.** Positionen „Heizung und Warmwasser“ 6.480,00 € → Heizung 85 % = 5.508,00 €, Warmwasser
15 % = 972,00 €. Dazu Wärmezähler 120,00 € zur Heizung, Warmwasserzähler 60,00 € zum Warmwasser:
K_H = 5.628,00 €, K_W = 1.032,00 €.

**Preise.** Heizung: Grundkosten 30 % = 1.688,40 € / 200 m² = 8,442 €/m²; Verbrauchskosten 70 % =
3.939,60 € / 40.000 kWh = 0,09849 €/kWh. Warmwasser: Grundkosten 309,60 € / 200 m² = 1,548 €/m²;
Verbrauchskosten 722,40 € / 120 m³ = 6,02 €/m³.

**Wechsel in C** (§ 9b Abs. 1, 2). Die Verbrauchskosten folgen der Zwischenablesung; die Grundkosten
Heizung nach Gradtagen (Januar bis September 640 ‰, Oktober bis Dezember 360 ‰), die Grundkosten
Warmwasser nach Tagen (273 / 92 von 365).

| Nutzer | Heizung | Warmwasser | zusammen |
|---|---|---|---|
| A | 60 · 8,442 + 12.000 · 0,09849 = 1.688,40 € | 60 · 1,548 + 30 · 6,02 = 273,48 € | 1.961,88 € |
| B | 675,36 + 1.575,84 = 2.251,20 € | 123,84 + 240,80 = 364,64 € | 2.615,84 € |
| C1 | 506,52 · 0,64 + 709,128 = 1.033,3008 € | 92,88 · 273/365 + 228,76 = 298,2285 € | 1.331,5293 € |
| C2 | 506,52 · 0,36 + 472,752 = 655,0992 € | 92,88 · 92/365 + 72,24 = 95,6507 € | 750,7499 € |

Gerundet wird je Position nach #202 (größter Rest, bei Gleichstand an den Vermieter); die Summen der
Zeilen sind **1.961,89 / 2.615,84 / 1.331,52 / 750,75 €** (zusammen 6.660,00 €). A bekommt bei der
Rundung der sechs Positionen einen Cent mehr als die exakte Summe; die Zeilen stehen im Test.

**CO₂** (Entwurf 9.4). 10.883,4 kg / 200 m² = 54,4 kg je m²; ab 52 kg trägt der Vermieter 95 %
(letzte Stufe der Anlage zum CO2KostAufG). L = 598,59 € · 95 % = 568,6605 €. Abgezogen wird nach dem Anteil
jedes Mieters an der Brennstoffposition (Erdgas): A 1.768,50 € / 6.000,00 € · 568,6605 € = 167,61 €,
B 223,48 €, C1 113,40 €, C2 64,17 €, zusammen R = 568,66 €.

**Ohne Hinweis** außer dem CO₂-Ausweis: keine Lücke, alle Grenzen abgelesen, Anteil wie im ersten
Jahr.
