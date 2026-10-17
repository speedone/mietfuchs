# F18 Rumpfzeitraum

Ein Haus mit einer Wohnung (EG, 60 m²), ein Mietverhältnis seit 01.01.2024, Vorauszahlung 200 € im
Monat. Bis 2024 Kalenderjahr; ab Mai 2025 rechnet das Objekt von Mai bis April ab (Wechsel
`2025-05`, Entwurf 3.6). Vor dem Wechsel erfasst, im Zeitraum 2025:

| Position | Kostenart | Betrag | Leistungszeitraum | Schlüssel |
|---|---|---|---|---|
| Grundsteuer 2025 | Grundsteuer | 480,00 € | 01.01.–31.12.2025 | Fläche |
| Müll Januar bis April | Müllabfuhr | 242,19 € | 01.01.–30.04.2025 | Fläche |
| Gas | Heizung und Warmwasser, Brennstoff/Energie | 700,00 € | 01.01.–30.04.2025 | Einzelbeträge (Mieter 700,00 €) |
| Wartung | Heizung und Warmwasser | 200,00 € | 01.01.–31.12.2025 | Einzelbeträge (Mieter 200,00 €) |

Die Müllabfuhr ist so gewählt, dass die kalten Kosten im Rumpf zusammen 400,00 € ergeben wie im
Beispiel des Entwurfs (3.7).

## Herleitung

**Rumpf.** Der Wechsel ab Mai 2025 lässt den Zeitraum `2025-01` am 30.04.2025 enden: 120 Tage, Frist
zwölf Monate nach dem Ende, also 30.04.2026 (§ 556 Abs. 3 Satz 2 BGB). Der nächste Zeitraum `2025-05`
läuft vom 01.05.2025 bis 30.04.2026.

**Grundsteuer nach Tagen** (Leistungsprinzip, Entwurf 3.4): 480,00 € · 120/365 = 157,808… €, 480,00 € ·
245/365 = 322,191… €. Abgerundet 157,80 € und 322,19 € ergeben 479,99 €; der eine Restcent geht an
den größeren Nachkommarest (0,808 gegen 0,191), also 157,81 € in den Rumpf und 322,19 € nach
`2025-05`. Die übrigen Positionen liegen mit ihrem Leistungszeitraum im Rumpf (Müll, Gas) oder sind
Heizkosten, die nicht nach Tagen geteilt werden (Wartung, Entwurf 3.4 G-C1); der Vermieter ordnet sie
in der Vorschau dem Rumpf zu.

**Abrechnung des Rumpfs.** Eine Wohnung, ein Mieter, der den ganzen Rumpf wohnt: Er trägt jede
Position ganz. 157,81 + 242,19 + 700,00 + 200,00 = 1.300,00 €. Vorauszahlungen Januar bis April:
4 · 200,00 € = 800,00 €. Nachzahlung 500,00 €.

**Vorschlag nach § 560 Abs. 4 BGB** (Entwurf 3.7):

- kalt 400,00 € nach Tagen: 400,00 · 365/120 / 12 = 101,39 €
- Brennstoff 700,00 € mit Leistungszeitraum Januar bis April, Gradtage 170 + 150 + 130 + 80 = 530 ‰:
  700,00 / 0,530 / 12 = 110,06 €
- Wartung 200,00 € mit Leistungszeitraum zwölf Monate: Jahresbetrag, 200,00 / 12 = 16,67 €

Zusammen 228,12 €, auf volle Euro **228,00 €**.

**Hinweise:** `period.short` (Rumpf) und `period.heating-mismatch` (die Wartung reicht über den Rumpf
hinaus). Die gekürzte CO₂-Stufentabelle (Grenzen × 120/365, Entwurf 3.6) prüft PR 6.

**Zeitraum 2025/2026:** Grundsteuer 322,19 € mit dem Jahr der Zahlung 2025 (der bisherige Zeitraum
begann 2025).
