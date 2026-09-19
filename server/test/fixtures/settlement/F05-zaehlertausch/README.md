# F05 — Verbrauchsschlüssel mit Zählertausch

**Geprüfte Regel:** Ein Zählerwechsel mitten im Jahr darf keinen Verbrauch verschlucken und
keinen erfinden. Der Endstand des alten Geräts und der Startstand des neuen ergeben zusammen
den Jahresverbrauch — ohne den negativen Sprung, den ein naiver `neu − alt`-Vergleich
erzeugen würde.

**Grundlage:** Umlage nach erfasstem Verbrauch (§ 556a Abs. 1 Satz 2 BGB); bei einem
Zählerwechsel zählen Endstand des alten und Startstand des neuen Geräts.

## Ausgangslage

Zwei gleich große Wohnungen (je 50 m²), beide ganzjährig vermietet, je ein Kaltwasserzähler.
Eine Kostenposition: Wasser **1.100,00 €**, Schlüssel `meter`, Zählertyp `kaltwasser`.

Ablesungen — eine Ablesung gilt zum **Tagesende** ihres Datums:

| Zähler | Datum | Stand | Bemerkung |
|---|---|---|---|
| m1 (u1) | 31.12.2024 | 100 | Anfangsstand |
| m1 (u1) | 31.12.2025 | 160 | Endstand |
| m2 (u2) | 31.12.2024 | 200 | Anfangsstand |
| m2 (u2) | 30.06.2025 | **0** | Zählertausch: `replacement: true`, `oldEndValue: 230` |
| m2 (u2) | 31.12.2025 | 20 | Endstand des neuen Geräts |

## Handrechnung

**m1** — ein Segment über das ganze Jahr:

```
160 − 100 = 60 Einheiten über 365 Tage → Jahresverbrauch 60
```

**m2** — zwei Segmente, getrennt durch den Tausch:

```
Segment 1  31.12.2024 → 30.06.2025:  oldEndValue 230 − 200 =  30   (181 Tage)
Segment 2  30.06.2025 → 31.12.2025:  20 − 0             =  20   (184 Tage)
                                        Jahresverbrauch  =  50
```

Ohne die `replacement`-Markierung wäre Segment 1 als `0 − 200 = −200` gerechnet worden — ein
negativer Verbrauch, der eine Warnung ausgelöst und die Verteilung verfälscht hätte. Genau
diese Fehlrechnung schließt das Fixture aus.

**Verteilbasis und Anteile:**

```
basis = 60 + 50 = 110 Einheiten

t1 = 110.000 ct × 60/110 = 60.000 ct = 600,00 €
t2 = 110.000 ct × 50/110 = 50.000 ct = 500,00 €
Summe = 110.000 ct → exakte Ausschöpfung, Vermieter = 0
```

Vorauszahlungen: je 12 × 50,00 € = 600,00 €.

Salden:

```
t1 = 60.000 − 60.000 =      0 ct  → punktgenau gedeckt
t2 = 60.000 − 50.000 = +10.000 ct → 100,00 € Guthaben
```

Vorschlag neue Vorauszahlung:

```
t1 = 60.000 / 12 = 5.000 ct → 50,00 €
t2 = 50.000 / 12 = 4.166,7 ct → 41,67 € → 42,00 €
```

Die Zählerübersicht (`consumptionOverview`) hält den Jahresverbrauch je Zähler zusätzlich
fest: m1 = 60 bei 2 Ablesungen, m2 = 50 bei 3 Ablesungen, beide ohne Warnung.
