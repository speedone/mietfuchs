# F02 — Personenschlüssel mit unterjähriger Änderung

**Geprüfte Regel:** Der Personenschlüssel rechnet **personentagesgenau**, nicht mit der
Personenzahl am Jahresende. Eine Änderung mitten im Jahr (hier: Geburt zum 01.07.2025) wirkt
nur für den Rest des Jahres. Die Personen-Staffel (`personHistory`) ist die Wahrheit — die
angezeigte `persons` ist nur der Stand am Periodenende.

**Grundlage:** Umlage nach Personen, taggenau über die Personen-Staffel. Zeiträume haben
inklusive Grenzen, kein Tag wird doppelt oder gar nicht gezählt.

## Ausgangslage

| Einheit | Fläche | Mietverhältnis | Personen | Vorauszahlung |
|---|---|---|---|---|
| u1 | 80 m² | t1, ganzjährig | 2, **ab 01.07.2025: 3** | 50,00 €/Monat |
| u2 | 80 m² | t2, ganzjährig | 2 | 30,00 €/Monat |

Beide Wohnungen sind gleich groß — die Fläche kann das Ergebnis also nicht beeinflussen.
Eine Kostenposition: Wasser/Abwasser 2025, **1.000,00 €**, Schlüssel `persons`.

## Handrechnung

Personentage t1, zwei Stufen mit inklusiven Grenzen:

```
01.01.–30.06.2025 = 181 Tage × 2 Personen = 362
01.07.–31.12.2025 = 184 Tage × 3 Personen = 552
                                  t1 gesamt = 914
```

Die Stufe endet am **30.06.**, die nächste beginnt am **01.07.** — kein doppelter, kein
fehlender Tag. Kontrolle: 181 + 184 = 365.

```
t2 = 365 Tage × 2 Personen = 730
basisPersonDays = 914 + 730 = 1.644
```

Rohanteile:

```
t1 = 100.000 ct × 914/1.644 = 55.596,1070… ct
t2 = 100.000 ct × 730/1.644 = 44.403,8929… ct
Summe = 100.000 ct → exakte Ausschöpfung
```

Cent-genaue Verteilung nach Hare/largest remainder:

```
Abrundung:  t1 = 55.596        t2 = 44.403        Summe = 99.999
Rest = 1 ct → an den größten Nachkommaanteil
Nachkommaanteile: t1 = 0,1070   t2 = 0,8929  →  t2 erhält das Cent
```

```
t1 = 55.596 ct = 555,96 €        t2 = 44.404 ct = 444,04 €        Vermieter = 0
```

Gegenprobe zur falschen Rechnung: Mit der Personenzahl am Jahresende (3 zu 2) ergäbe sich
60.000 / 40.000 ct. Die Differenz von 4.404 ct ist genau der Effekt, den die
Personentagesrechnung abbildet.

Vorauszahlungen: t1 = 12 × 5.000 = 60.000 ct, t2 = 12 × 3.000 = 36.000 ct.

Salden:

```
t1 = 60.000 − 55.596 = +4.404 ct  →  44,04 € Guthaben
t2 = 36.000 − 44.404 = −8.404 ct  →  84,04 € Nachzahlung
```

Vorschlag neue Vorauszahlung (ein Zwölftel, auf volle Euro gerundet):

```
t1 = 55.596 / 12 = 4.633,0 ct → 46,33 € → 46,00 €
t2 = 44.404 / 12 = 3.700,3 ct → 37,00 € → 37,00 €
```
