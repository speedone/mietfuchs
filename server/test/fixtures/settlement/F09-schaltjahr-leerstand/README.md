# F09 — Schaltjahr, unterjähriger Einzug und Leerstand

**Geprüfte Regel:** Im Schaltjahr hat das Jahr 366 Tage, und der Tagesanteil rechnet gegen
diese 366 — nicht gegen 365. Die Monate vor dem Einzug sind **Leerstand**: Sie werden keinem
Mieter zugeordnet, sondern bleiben beim Vermieter. Der Betrag verschwindet nicht und wird
auch nicht auf die verbleibenden Mieter umverteilt.

**Grundlage:** Tagesanteil gegen die Tage des Abrechnungsjahres (366 im Schaltjahr); den
Leerstand trägt der Vermieter.

## Ausgangslage

Abrechnungsjahr **2024** (Schaltjahr, 366 Tage).

| Einheit | Fläche | Mietverhältnis | Zeitraum 2024 | Personen | Vorauszahlung |
|---|---|---|---|---|---|
| u1 | 60 m² | t1 | ganzjährig | 2 | 50,00 €/Monat |
| u2 | 40 m² | t2 | **ab 01.04.** | 1 | 40,00 €/Monat ab 04/2024 |

Wohnung 2 stand also von Januar bis März leer. Eine Kostenposition: Grundsteuer 2024,
**1.000,00 €**, Schlüssel `area`.

## Handrechnung

Belegte Tage:

```
t1 = 01.01.–31.12.2024 = 366 Tage
t2 = 01.04.–31.12.2024 = 30+31+30+31+31+30+31+30+31 = 275 Tage
Leerstand u2           = 366 − 275 = 91 Tage (Jan 31 + Feb 29 + Mär 31)
```

Rohanteile (Bezugsfläche 60 + 40 = 100 m²):

```
t1 = 100.000 ct × 60/100 × 366/366 = 60.000,0000 ct
t2 = 100.000 ct × 40/100 × 275/366 = 30.054,6448 ct
                            Summe  = 90.054,6448 ct
```

Die Rohanteile schöpfen den Betrag **nicht** aus — es fehlen 9.945,36 ct, nämlich der
Leerstandsanteil. Damit greift nicht die Restverteilung nach Hare, sondern die kaufmännische
Rundung je Anteil; die Differenz trägt der Vermieter:

```
t1        = 60.000 ct = 600,00 €
t2        = 30.055 ct = 300,55 €   (30.054,6448 kaufmännisch gerundet)
Vermieter = 100.000 − 60.000 − 30.055 = 9.945 ct = 99,45 €
```

Kontrolle: 60.000 + 30.055 + 9.945 = 100.000 ✓

Gegenprobe zum Schaltjahrfehler: Mit 365 statt 366 Tagen ergäbe sich für t2
40.000 × 275/365 = 30.136,99 → 30.137 ct, also 82 ct zu viel zulasten des Mieters.

Vorauszahlungen — bei t2 zählen nur die Monate, in denen das Mietverhältnis am Monatsersten
bestand:

```
t1 = 12 × 5.000 = 60.000 ct
t2 =  9 × 4.000 = 36.000 ct   (April bis Dezember)
```

Salden:

```
t1 = 60.000 − 60.000 =     0 ct → punktgenau gedeckt
t2 = 36.000 − 30.055 = +5.945 ct → 59,45 € Guthaben
```

Vorschlag neue Vorauszahlung:

```
t1 = 60.000 / 12 = 5.000,0 ct → 50,00 €
t2 = 30.055 / 12 = 2.504,6 ct → 25,05 € → 25,00 €
```

Hinweis: Der Vorschlag für t2 rechnet den **Teiljahresbetrag** auf zwölf Monate herunter und
liegt damit unter dem, was ein volles Jahr kosten würde. Das ist das heutige Verhalten. Die
in #7 abgestimmte Hochrechnung aufs volle Jahr (§ 560 Abs. 4 BGB) ändert diese Erwartung in
einem eigenen PR auf 33,00 €.
