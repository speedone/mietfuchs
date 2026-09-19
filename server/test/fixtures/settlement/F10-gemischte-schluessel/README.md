# F10 — Gemischte Schlüssel bei Teilnahmequote unter 100 %

**Geprüfte Regel:** Vier Positionen, drei verschiedene Schlüssel, eine Einheit außerhalb der
Abrechnungseinheit — und am Ende muss trotzdem jede einzelne Position vollständig aufgehen.
Die Variante mit einer selbstgenutzten Wohnung prüft F11.

**Grundlage:** Umlage nach Wohnfläche, Personen und Einheiten (§ 556a Abs. 1 BGB); nicht
umlagefähige Kosten wie eine Instandhaltungsrücklage trägt der Vermieter (§ 1 Abs. 2 BetrKV).

## Ausgangslage

| Einheit | Fläche | beteiligt | Mietverhältnis | Personen | Vorauszahlung |
|---|---|---|---|---|---|
| u1 EG (Laden, eigene Abrechnung) | 80 m² | **nein** | — | — | — |
| u2 OG links | 90 m² | ja | t2, ganzjährig | 4 | 150,00 €/Monat |
| u3 OG rechts | 60 m² | ja | t3, ganzjährig | 3 | 100,00 €/Monat |

| Position | Betrag | Schlüssel |
|---|---|---|
| c1 Grundsteuer | 900,00 € | `area` |
| c2 Wasser und Abwasser | **1.000,01 €** | `persons` |
| c3 Müllabfuhr | 600,00 € | `units` |
| c4 Rücklage Fassade | 250,00 € | Kategorie *Nicht umlagefähig* |

Der krumme Betrag bei c2 ist Absicht: Er erzwingt eine Restverteilung.

## Handrechnung

**c1 — Fläche** (Bezugsfläche 90 + 60 = 150 m², u1 zählt nicht mit):

```
t2 = 90.000 × 90/150 = 54.000 ct
t3 = 90.000 × 60/150 = 36.000 ct        Vermieter = 0
```

**c2 — Personentage** (4 × 365 = 1.460 und 3 × 365 = 1.095, Basis 2.555):

```
t2 = 100.001 × 1.460/2.555 = 57.143,4285… ct
t3 = 100.001 × 1.095/2.555 = 42.857,5714… ct

Abrundung 57.143 + 42.857 = 100.000, Rest 1 ct
Nachkommaanteile: t2 = 0,4285   t3 = 0,5714  →  t3 erhält das Cent

t2 = 57.143 ct        t3 = 42.858 ct        Summe = 100.001 ✓
```

**c3 — Einheiten** (zwei beteiligte Einheiten, u1 zählt nicht mit):

```
t2 = 60.000 / 2 = 30.000 ct        t3 = 30.000 ct        Vermieter = 0
```

**c4 — nicht umlagefähig:**

```
Mieteranteile = 0                   Vermieter = 25.000 ct
```

**Summen je Mieter:**

```
t2 = 54.000 + 57.143 + 30.000 = 141.143 ct = 1.411,43 €
t3 = 36.000 + 42.858 + 30.000 = 108.858 ct = 1.088,58 €
Vermieter                     =  25.000 ct =   250,00 €
```

Kontrolle, positionsweise:

```
c1:  54.000 + 36.000 +      0 =  90.000 ✓
c2:  57.143 + 42.858 +      0 = 100.001 ✓
c3:  30.000 + 30.000 +      0 =  60.000 ✓
c4:       0 +      0 + 25.000 =  25.000 ✓
                Gesamtkosten  = 275.001 ✓
```

**Salden:**

```
t2 = 180.000 − 141.143 = +38.857 ct → 388,57 € Guthaben
t3 = 120.000 − 108.858 = +11.142 ct → 111,42 € Guthaben
```

**Vorschlag neue Vorauszahlung:**

```
t2 = 141.143 / 12 = 11.761,9 ct → 117,62 € → 118,00 €
t3 = 108.858 / 12 =  9.071,5 ct →  90,72 € →  91,00 €
```
