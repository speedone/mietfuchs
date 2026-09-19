# F11 — Eigennutzung: der Anteil der selbstgenutzten Wohnung bleibt beim Vermieter

**Geprüfte Regel:** Eine selbstgenutzte Wohnung (Nutzungsart *Eigennutzung*, `selfUsed`) gehört
zur Abrechnungseinheit. Sie zählt in die Verteilbasis von Wohnfläche, Personen und Einheiten.
Ihr Anteil wird keinem Mieter zugeordnet, sondern bleibt beim Vermieter und wird dort als
Eigenanteil ausgewiesen. Die Mieter tragen damit nur ihren eigenen Anteil, nicht den der
Vermieterwohnung.

Dieselbe Hausgröße wie in F01, nur ist das EG hier selbstgenutzt statt außerhalb der
Abrechnungseinheit.

**Grundlage:** Umlage nach dem Anteil an Wohnfläche, Personen oder Einheiten der ganzen
Abrechnungseinheit (§ 556a Abs. 1 BGB). Der auf die selbstgenutzte Wohnung entfallende Teil
bleibt wie bei Leerstand beim Vermieter.

## Ausgangslage

Abrechnungsjahr 2025 (365 Tage), alle Mietverhältnisse ganzjährig.

| Einheit | Fläche | Nutzungsart | Mietverhältnis | Personen | Vorauszahlung |
|---|---|---|---|---|---|
| u1 EG | 80 m² | **Eigennutzung** | — | 2 (eigener Haushalt) | — |
| u2 OG links | 90 m² | vermietet | t2 | 4 | 150,00 €/Monat |
| u3 OG rechts | 60 m² | vermietet | t3 | 3 | 100,00 €/Monat |

| Position | Betrag | Schlüssel |
|---|---|---|
| c1 Grundsteuer 2025 | 900,00 € | `area` |
| c2 Müllabfuhr 2025 | 460,00 € | `persons` |
| c3 Hauswart 2025 | 300,00 € | `units` |

## Rechenregeln

1. Die Verteilbasis umfasst vermietete **und** selbstgenutzte Wohnungen. Die Personentage der
   Eigennutzung sind Personenzahl × Tage des Jahres.
2. Weil die Mieter den Betrag nicht ausschöpfen, wird jeder Mieteranteil für sich kaufmännisch
   auf den Cent gerundet. Der Rest ist Vermieteranteil.
3. Der Eigenanteil einer Position ist der Anteil der selbstgenutzten Wohnung, kaufmännisch
   gerundet und höchstens so groß wie der Vermieteranteil dieser Position. Der Unterschied
   zum Vermieteranteil ist Rundung.

## Handrechnung

**c1 — Fläche** (Basis 80 + 90 + 60 = 230 m²):

```
t2    = 90.000 × 90/230 = 35.217,39 ct → 35.217 ct
t3    = 90.000 × 60/230 = 23.478,26 ct → 23.478 ct
Vermieter = 90.000 − 35.217 − 23.478   = 31.305 ct
Eigenanteil = 90.000 × 80/230 = 31.304,35 ct → 31.304 ct   (1 ct Rundung beim Vermieter)
```

**c2 — Personentage** (EG 2 × 365 = 730, t2 4 × 365 = 1.460, t3 3 × 365 = 1.095, Basis 3.285):

```
t2    = 46.000 × 1.460/3.285 = 20.444,44 ct → 20.444 ct
t3    = 46.000 × 1.095/3.285 = 15.333,33 ct → 15.333 ct
Vermieter = 46.000 − 20.444 − 15.333       = 10.223 ct
Eigenanteil = 46.000 × 730/3.285 = 10.222,22 ct → 10.222 ct   (1 ct Rundung beim Vermieter)
```

**c3 — Einheiten** (EG, OG links, OG rechts = 3):

```
t2 = t3 = 30.000 / 3 = 10.000 ct
Vermieter = Eigenanteil = 10.000 ct
```

**Summen:**

```
t2          = 35.217 + 20.444 + 10.000 = 65.661 ct =   656,61 €
t3          = 23.478 + 15.333 + 10.000 = 48.811 ct =   488,11 €
Vermieter   = 31.305 + 10.223 + 10.000 = 51.528 ct =   515,28 €
Eigenanteil = 31.304 + 10.222 + 10.000 = 51.526 ct =   515,26 €
Kontrolle: 65.661 + 48.811 + 51.528 = 166.000 ct = Gesamtkosten ✓
```

Zum Vergleich: Stünde das EG auf *nicht beteiligt* (wie in F01), trügen die beiden Mieter die
drei Positionen vollständig: 1.660,00 € statt 1.144,72 €.

**Vorauszahlungen und Salden** (positiv = Guthaben):

```
t2 = 12 × 15.000 = 180.000 ct    Saldo = 180.000 − 65.661 = +114.339 ct
t3 = 12 × 10.000 = 120.000 ct    Saldo = 120.000 − 48.811 =  +71.189 ct
```

**Vorschlag neue Vorauszahlung** (ein Zwölftel, auf volle Euro gerundet):

```
t2 = 65.661 / 12 = 5.471,75 ct → 54,72 € → 55,00 €
t3 = 48.811 / 12 = 4.067,58 ct → 40,68 € → 41,00 €
```

Keine Warnungen: Die selbstgenutzte Wohnung hat Fläche und Personenzahl.

Diese Erwartung wurde von Hand hergeleitet und traf die Engine beim ersten Lauf cent-genau —
eine unabhängige Bestätigung der Eigennutzung aus v0.3.0.
