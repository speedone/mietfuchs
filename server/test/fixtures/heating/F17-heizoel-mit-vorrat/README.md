# F17 Heizöl mit Vorrat

Beispiel 8.2 des Entwurfs mit eigener Heizkostenabrechnung. Drei Wohnungen à 100 m², je ein Mieter
seit 2020, Ölheizung ohne Warmwasser (`hotWater = none`), Kalenderjahr 2025, 70 % nach Verbrauch.
Wärmezähler: A 10.000 kWh, B 12.000 kWh, C 8.000 kWh, zusammen 30.000 kWh.

| Posten | Menge | kg CO₂ | Kosten | CO₂-Kosten |
|---|---|---|---|---|
| Anfangsbestand (Rechnung 2022) | 2.000 l | 5.352,6 | 1.900,00 € | 0 € |
| Lieferung 15.03.2025 | 3.000 l | 8.028,9 | 3.150,00 € | 525,49 € |
| Lieferung 10.10.2025 | 2.500 l | 6.690,75 | 2.500,00 € | 437,91 € |
| Endbestand | 1.800 l | aus der Lieferung vom 10.10. | 1.800,00 € | |

## Herleitung

**Bestandsrechnung** (8.2, aus PR 8 unverändert). Kosten 5.750,00 €, bezahlt 5.650,00 €; Überträge
„aus dem Vorrat“ +1.900,00 € und „im Vorrat“ −1.800,00 €, Gegenzeile beim Vermieter −100,00 €
(`fuelCarry`). Bei `self` gehen die Überträge durch die Heizkostenverordnung wie die Rechnungen
(Entwurf 8.2, Naht N14 des Plans).

**Verteilung.** Grundkosten 30 % nach Fläche (je ⅓), Verbrauchskosten 70 % nach kWh:

| Mieter | Gewicht | Anteil an 5.750,00 € |
|---|---|---|
| A | 0,1 + 0,7 · 10/30 = 0,33333 | 1.916,67 € exakt |
| B | 0,1 + 0,7 · 12/30 = 0,38 | 2.185,00 € |
| C | 0,1 + 0,7 · 8/30 = 0,28667 | 1.648,33 € exakt |

Je Position und Übertrag nach #202 gerundet: **1.916,66 / 2.185,00 / 1.648,34 €**, zusammen 5.750,00 €.

**CO₂.** E = 15.254,91 kg / 300 m² = 50,8 kg je m² → 80 % (Stufe 47 bis unter 52 kg der Anlage zum CO2KostAufG). C = 648,10 €,
L = 518,48 € (8.2). Abgezogen nach dem Anteil am Brennstoff, also an den Rechnungen und Überträgen:
A 172,83 €, B 197,02 €, C 148,63 €, zusammen 518,48 €.

## Variante ⅓ Eigennutzung (G-C5, N8)

Wohnung C bewohnt der Vermieter selbst; damit das Gewicht der Eigennutzung genau ⅓ ist, zeigen alle
drei Wärmezähler 10.000 kWh (Festlegung des Plans, der Entwurf nennt keine Zählerstände).

- Abrechnung: Eigenanteil (`selfUsedShareCents`) exakt 5.750,00 € / 3 = 1.916,666… €. Gedruckt wird
  je Zeile nach #202 (größter Rest, bei Gleichstand an den Vermieter, also an die Eigennutzung):

  | Zeile | je Nutzer exakt | Eigennutzung gedruckt |
  |---|---|---|
  | Heizöl l1 3.150,00 € | 1.050,00 € | 1.050,00 € |
  | Heizöl l2 2.500,00 € | 833,333… € | 833,34 € (Restcent, Gleichstand dreier Nutzer) |
  | Heizöl aus dem Vorrat 1.900,00 € | 633,333… € | 633,34 € (ebenso) |
  | Heizöl im Vorrat −1.800,00 € | −600,00 € | −600,00 € |
  | zusammen | 1.916,666… € | **1.916,68 €** |

  Vier Zeilen, je höchstens 1 ct daneben (6.2); der Test nagelt 1.916,68 € fest, damit ein Fehler bei
  der Zuteilung des Restcents auffällt. Stimmt die Regel von #202 in `distributeCents` (PR 2) anders,
  ist das ein Befund für die Durchsicht und nicht eine neue Erwartung.
- Steuer: privat ist je Position der gedruckte Eigenanteil der Abrechnung (#163, `splitForTax`):
  Heizöl l1 1.050,00 € + Heizöl l2 833,34 € = **1.883,34 €** (exakt 5.650,00 € / 3 = 1.883,33 €; der
  Restcent der Rechnung l2 steht wie in der Abrechnung bei der Eigennutzung).
- Der Abstand 1.916,68 € − 1.883,34 € = 33,34 € ist genau der gedruckte Eigenanteil an den Überträgen
  (633,34 € − 600,00 €); die Steuerseite erklärt ihn (`stockCarrySelfCents`, PR 8).
