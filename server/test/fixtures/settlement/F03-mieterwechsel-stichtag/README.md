# F03 — Mieterwechsel zum Stichtag

**Geprüfte Regel:** Endet ein Mietverhältnis am 30.06. und beginnt das nächste am 01.07.,
darf **kein Tag doppelt und kein Tag gar nicht** abgerechnet werden. Beide Zeiträume zusammen
ergeben exakt das Jahr, und beide Anteile zusammen exakt den Kostenbetrag — der Vermieter
trägt nichts, obwohl die Wohnung den Mieter gewechselt hat.

**Grundlage:** Zeiträume mit inklusiven Grenzen, Tagesanteil bei Teiljahren (Auszug 30.06.,
Einzug 01.07.).

## Ausgangslage

Eine einzige Wohnung, 100 m², ganzjährig vermietet — aber an zwei Mieter nacheinander:

| Mietverhältnis | Zeitraum 2025 | Personen | Vorauszahlung |
|---|---|---|---|
| ta Vormieter | 01.01.–30.06. | 2 | 100,00 €/Monat |
| tb Nachmieter | 01.07.–31.12. | 2 | 120,00 €/Monat |

Eine Kostenposition: Grundsteuer 2025, **1.200,00 €**, Schlüssel `area`.

## Handrechnung

Belegte Tage (inklusive Grenzen):

```
ta: 01.01.–30.06.2025 = 31+28+31+30+31+30 = 181 Tage
tb: 01.07.–31.12.2025 = 31+31+30+31+30+31 = 184 Tage
                                   Summe = 365 = daysInYear(2025)   ✓
```

Rohanteile — die Fläche ist für beide dieselbe (100 von 100 m²), es entscheidet allein der
Tagesanteil:

```
ta = 120.000 ct × 181/365 = 59.506,8493… ct
tb = 120.000 ct × 184/365 = 60.493,1506… ct
Summe = 120.000 ct → exakte Ausschöpfung
```

Cent-genaue Verteilung, Rest 1 ct an den größten Nachkommaanteil:

```
Abrundung:  ta = 59.506   tb = 60.493   Summe = 119.999
Nachkommaanteile: ta = 0,8493  tb = 0,1506  →  ta erhält das Cent
```

```
ta = 59.507 ct = 595,07 €       tb = 60.493 ct = 604,93 €       Vermieter = 0
```

Vorauszahlungen — gezählt werden die Monate, in denen das Mietverhältnis **am Monatsersten**
besteht:

```
ta: Jan–Jun   = 6 × 10.000 = 60.000 ct   (am 01.07. bestand ta nicht mehr)
tb: Jul–Dez   = 6 × 12.000 = 72.000 ct   (vor dem 01.07. bestand tb noch nicht)
```

Salden:

```
ta = 60.000 − 59.507 =    +493 ct →   4,93 € Guthaben
tb = 72.000 − 60.493 = +11.507 ct → 115,07 € Guthaben
```

Vorschlag neue Vorauszahlung (ein Zwölftel auf volle Euro) — beide landen bei 50,00 €, weil
der jeweilige Halbjahresanteil hochgerechnet fast dasselbe ergibt:

```
ta = 59.507 / 12 = 4.958,9 ct → 49,59 € → 50,00 €
tb = 60.493 / 12 = 5.041,1 ct → 50,41 € → 50,00 €
```

Personentage: 2 × 181 = 362 bzw. 2 × 184 = 368; zusammen 730 = 2 × 365.
