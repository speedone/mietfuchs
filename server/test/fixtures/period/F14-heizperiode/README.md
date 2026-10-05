# F14 Eigene Heizperiode

Ein Haus mit einer Wohnung (EG, 60 m²), abgerechnet im Kalenderjahr. Die Heizanlage wird vom
Messdienst von Mai bis April abgerechnet; die Vorauszahlung ist einheitlich (keine getrennte
Heizkostenabrechnung), also Weg b (Entwurf 3.1, BGH VIII ZR 240/07).

| Mietverhältnis | Zeit | Vorauszahlung |
|---|---|---|
| M | 01.01.2024–31.10.2025 | 200 € im Monat |
| N | ab 01.11.2025 | 220 € im Monat |

Erfasst, bevor die Anlage angelegt wird, also unter dem Kalenderjahr:

| Position | Zeitraum | Betrag | Schlüssel |
|---|---|---|---|
| Messdienst 2024/2025 | 2025 | 950,00 € | Einzelbeträge: M 950,00 € |
| Messdienst 2025/2026 | 2026 | 1.000,00 € | Einzelbeträge: M 412,30 €, N 587,70 € |
| Grundsteuer 2025 | 2025 | 600,00 € | Wohnfläche |
| Grundsteuer 2026 | 2026 | 600,00 € | Wohnfläche |

## Umschlüsseln (G-A2)

Die Anlage bekommt Mai als Beginn ihrer Heizperiode. Jede Heizposition kommt in die Heizperiode, die
in ihrem Abrechnungszeitraum endet: „Messdienst 2024/2025“ von `2025-01` nach `2024-05`
(01.05.2024–30.04.2025, endet 2025), „Messdienst 2025/2026“ von `2026-01` nach `2025-05`
(01.05.2025–30.04.2026, endet 2026). Beide Heizperioden reichen über zwei Kalenderjahre; das Jahr der
Zahlung wird das Jahr des bisherigen Zeitraums (2025 bzw. 2026).

## Abrechnung 2025 (Frist 31.12.2026)

- Grundsteuer 600,00 € nach Fläche, eine Wohnung, durchgehend bewohnt: M 304 Tage, N 61 Tage von 365.
  M 600 · 304/365 = 499,7260 €, N 600 · 61/365 = 100,2740 €. Abgerundet 499,72 + 100,27 = 599,99 €;
  der Restcent geht an den größeren Rest (M, 0,60 ct gegen 0,40 ct): **M 499,73 €, N 100,27 €**.
- Heizperiode 2024/2025: N wohnte darin nicht; **M 950,00 €** laut Einzelbetrag.
- M: 499,73 + 950,00 = 1.449,73 €; Vorauszahlungen Januar bis Oktober 10 · 200 = 2.000,00 €;
  **Guthaben 550,27 €**.
- N: 100,27 €; Vorauszahlungen November und Dezember 2 · 220 = 440,00 €; **Guthaben 339,73 €**.

## Abrechnung 2026 (Frist 31.12.2027)

- Grundsteuer 600,00 €: **N 600,00 €**.
- Heizperiode 2025/2026: **N 587,70 €**, **M 412,30 €**.
- N: 600,00 + 587,70 = 1.187,70 €; Vorauszahlungen 12 · 220 = 2.640,00 €; **Guthaben 1.452,30 €**.
- M wohnte 2026 nicht mehr: **Abrechnung nur mit Heizkosten**, 412,30 €, keine Vorauszahlung,
  **Nachzahlung 412,30 €**. Ob dafür die Frist 31.12.2027 gilt, ist nicht entschieden (15.1 Nr. 2);
  empfohlen ist die Frist des Zeitraums, in dem das Mietverhältnis endete: **31.12.2026**. Die
  Abrechnung des Messdienstes für 2025/2026 ist dafür bis **Oktober 2026** anzufordern (zwei Monate
  vorher, Entwurf 3.1).

## Summen

Jede Position steht in genau einer Abrechnung: 2025 enthält 950,00 + 600,00 = 1.550,00 €, 2026
enthält 1.000,00 + 600,00 = 1.600,00 €; der Vermieter trägt nichts.
