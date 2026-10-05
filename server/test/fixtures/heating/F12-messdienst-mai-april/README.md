# F12 Mai–April, Messdienst ohne CO₂-Aufteilung

Eine reale Abrechnung, anonymisiert (Entwurf 12.1): ein Haus mit vier Nutzeinheiten und 200,6 m²
Wohnfläche, Erdgas, Abrechnungszeitraum des Messdienstes 01.05.2025–30.04.2026. Eine Gasrechnung über
29.886 kWh und 3.117,47 €. Verteilt wird nach 30/70; Heizung 4.035,70 €, Warmwasser 240,81 €, zusammen
4.276,51 €. Eine CO₂-Aufteilung enthält die Abrechnung nicht. Keine Namen, keine Adressen, keine
Nutzer- oder Zählernummern.

## Was echt ist und was synthetisch

Der Beleg ist die Einzelabrechnung **eines** Nutzers. Echt, also aus dem Beleg abgeschrieben, sind
die Gesamtwerte oben und die Werte dieses einen Nutzers: 34 m², Heizung 290,12 €, Warmwasser
20,47 €, zusammen **310,59 €** (Nutzer 1, W1).

Die drei übrigen Nutzer stehen nicht auf dem Beleg. Sie sind **synthetisch**, und zwar stimmig
ergänzt: Flächen 52,2 m², 57,4 m² und 57,0 m² (zusammen mit den 34 m² genau 200,6 m²), Beträge
1.189,30 €, 1.397,45 € und 1.379,17 € (zusammen mit 310,59 € genau 4.276,51 €). Welche Beträge die
anderen Mieter wirklich hatten, sagt diese Fixture nicht; sie prüft die Rechnung, nicht den Beleg.

Ebenfalls **geschätzt** und nicht aus dem Beleg sind die CO₂-Werte: 29.886 kWh (Brennwert) ×
0,9 (Heizwert zu Brennwert) × 0,2016 kg CO₂/kWh (Heizwert, Erdgas) ergeben rund 5.421 kg CO₂, bei
200,6 m² also 27,02 kg je m², gerundet 27,0 (Stufe 27 bis unter 32 kg, Vermieter 40 %). Die echten
Werte stehen auf der Gasrechnung, die nicht vorliegt. Die Rechnung dieser Fixture braucht sie nicht,
denn der Messdienst hat nicht aufgeteilt.

Die Einzelbeträge (in der Reihenfolge der Nutzeinheiten, W1 zuerst) und die Kürzungen stehen in
`betraege.json`.

## Herleitung

**Zeitraum.** `2025-05`, 01.05.2025–30.04.2026, Bezeichnung „2025/2026“. Frist zwölf Monate nach dem
Ende: 30.04.2027 (§ 556 Abs. 3 Satz 2 BGB). Weil der Zeitraum über zwei Kalenderjahre reicht, braucht
die Position ein Jahr der Zahlung (PR 5); angenommen ist 2026, die Abrechnung des Messdienstes kommt
nach dem Ende des Zeitraums. Auf die Rechnung dieser Fixture wirkt es nicht.

**CO₂.** Gas ist ein Brennstoff mit Standardwert nach der EBeV; die Heizperiode beginnt nach dem
01.01.2023, die Aufteilung gilt (§ 11 Abs. 2 Satz 1 CO2KostAufG). Der Messdienst hat nicht aufgeteilt
(Antwort „gar nicht aufgeteilt“). Ohne Aufteilung darf jeder Mieter seinen Anteil an den Heizkosten um
3 % kürzen (§ 7 Abs. 4 CO2KostAufG): je Mieter 3 % seines gedruckten Einzelbetrags, kaufmännisch
gerundet (Entwurf 6.5), von Hand:

| Nutzer | Einzelbetrag | 3 % | gerundet | |
|---|---|---|---|---|
| Mieter 1 (W1) | 310,59 € | 9,3177 € | 9,32 € | echt |
| Mieter 2 (W2) | 1.189,30 € | 35,679 € | 35,68 € | synthetisch |
| Mieter 3 (W3) | 1.397,45 € | 41,9235 € | 41,92 € | synthetisch |
| Mieter 4 (W4) | 1.379,17 € | 41,3751 € | 41,38 € | synthetisch |

**Summe der Kürzungen.** 3 % · 4.276,51 € = 128,2953 €. Weil jeder Betrag für sich gerundet wird, liegt
die Summe der vier Kürzungen zwischen 128,28 € und 128,31 € (vier Rundungen von höchstens einem halben
Cent um 128,2953 €); hier 128,30 €.

**Keine 15 %.** Einzelbeträge zählen als Verteilung nach Verbrauch. Ohne Angabe zum Warmwasseranteil
gibt es keinen Hinweis nach § 9 Abs. 2 HeizkostenV.
