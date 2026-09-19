# F07 — Vorauszahlungs-Staffel und Jahres-Korrektur

**Geprüfte Regel:** Die geschuldete Vorauszahlung ergibt sich Monat für Monat aus der Staffel
(„ab diesem Monat gilt dieser Betrag“) — nicht aus dem zuletzt vereinbarten Betrag mal zwölf.
Wo aber ein **tatsächlich gezahlter** Jahresbetrag hinterlegt ist, hat dieser Vorrang: In der
Abrechnung ist rechtlich das anzusetzen, was geleistet wurde, nicht was geschuldet war.

**Grundlage:** In der Abrechnung sind die tatsächlich geleisteten Vorauszahlungen anzusetzen.

## Ausgangslage

Zwei gleich große Wohnungen (je 100 m²), beide ganzjährig vermietet. Eine Kostenposition:
Grundsteuer **2.000,00 €**, Schlüssel `area` → je 1.000,00 € Anteil. Die Kostenseite ist
bewusst symmetrisch, damit allein die Vorauszahlungsseite das Ergebnis unterscheidet.

| Mietverhältnis | Vorauszahlung |
|---|---|
| t1 | Staffel: ab 01/2024 = 100,00 €, **ab 07/2025 = 120,00 €** |
| t2 | Staffel: ab 01/2024 = 100,00 €, aber **Jahreskorrektur 2025 = 1.150,00 €** |

## Handrechnung

**t1 — Staffel, monatsweise ausgewertet.** Maßgeblich ist der Betrag, der am jeweiligen
Monatsersten gilt:

```
Jan–Jun 2025:  6 × 10.000 ct =  60.000 ct
Jul–Dez 2025:  6 × 12.000 ct =  72.000 ct
                     Summe   = 132.000 ct = 1.320,00 €
```

Die naive Rechnung „letzter Betrag × 12“ ergäbe 1.440,00 €, die ebenso naive „erster Betrag
× 12“ ergäbe 1.200,00 €. Beide wären falsch; die Differenz von 120,00 € bzw. 240,00 € landete
unbemerkt im Saldo des Mieters.

**t2 — Korrektur schlägt Staffel.** Die Staffel ergäbe 12 × 100,00 € = 1.200,00 €, tatsächlich
gezahlt wurden aber 1.150,00 € (eine Monatszahlung blieb teilweise aus). Der hinterlegte
Jahreswert gilt:

```
prepaymentCents      = 115.000 ct
prepaymentOverridden = true
```

Das Kennzeichen `prepaymentOverridden` ist Teil des Ergebnisses, weil die Abrechnung
offenlegen muss, dass hier nicht die vereinbarte, sondern die tatsächliche Zahlung angesetzt
wurde.

**Salden:**

```
t1 = 132.000 − 100.000 = +32.000 ct → 320,00 € Guthaben
t2 = 115.000 − 100.000 = +15.000 ct → 150,00 € Guthaben
```

Vorschlag neue Vorauszahlung — für beide identisch, weil er sich allein aus dem Kostenanteil
ergibt und nicht aus dem bisher Gezahlten:

```
100.000 / 12 = 8.333,3 ct → 83,33 € → 83,00 €
```
