# F06 — Fehlender Verbrauch und nicht umlagefähige Kosten

**Geprüfte Regel:** Wenn eine Verteilung fachlich nicht möglich ist, wird der Betrag **nicht
still auf einen Ersatzschlüssel umgebogen**. Er landet vollständig beim Vermieter — und im
Fall des fehlenden Verbrauchs zusätzlich sichtbar als Warnung. Nicht umlagefähige Kosten
bleiben ebenfalls vollständig beim Vermieter, aber ohne Warnung, denn das ist der gewollte
Normalfall und kein Datenmangel.

**Grundlage:** Kein stiller Ersatzschlüssel. Fehlt die Verteilbasis, trägt der Vermieter den
Betrag, und die Abrechnung sagt es. Nicht umlagefähige Kosten trägt der Vermieter ohnehin.

## Ausgangslage

Zwei Wohnungen à 50 m², beide ganzjährig vermietet, **keine Vorauszahlungen** vereinbart.
Ein Kaltwasserzähler in Wohnung 1 (Typ `kaltwasser`), aber **kein einziger Zähler vom Typ
`waerme`**.

| Position | Betrag | Schlüssel | Situation |
|---|---|---|---|
| c1 Heizkosten Zentralheizung | 500,00 € | `meter` / Typ `waerme` | Verteilbasis fehlt vollständig |
| c2 Instandhaltung Dach | 300,00 € | `area`, Kategorie **Nicht umlagefähig** | darf gar nicht verteilt werden |

## Handrechnung

**c1** — für den Zählertyp `waerme` existiert kein Zähler, die Verteilbasis ist also 0. Ein
Rückfall auf Fläche, Personen oder Einheiten wäre eine stille Ersatzannahme. Also:

```
Mieteranteile = 0
Vermieteranteil = 50.000 ct
+ Warnung: „Heizkosten Zentralheizung": kein Verbrauch für Zählertyp „waerme" erfasst
           — Betrag geht an den Vermieter.
```

Die Warnung nennt heute den internen Schlüssel `waerme`. Ihn im Klartext („Wärme“) zu nennen,
ist ein eigener kleiner PR, der genau diese Erwartung ändert. Die Warnung ist der eigentliche
Prüfgegenstand: Ein leises Ergebnis wäre hier gefährlicher als
ein falsches, weil der Vermieter den Datenmangel nicht bemerken würde.

**c2** — die Kategorie `Nicht umlagefähig` schaltet die Verteilung vor dem Schlüssel ab. Der
gesetzte Schlüssel `area` bleibt wirkungslos:

```
Mieteranteile = 0
Vermieteranteil = 30.000 ct
keine Warnung — dies ist der gewollte Fall, kein Datenmangel
```

**Gesamt:**

```
Gesamtkosten          = 50.000 + 30.000 = 80.000 ct
Summe Mieteranteile   =                        0 ct
Vermieteranteil       =                   80.000 ct
```

Mieteranteile plus Vermieteranteil müssen also auch hier den Gesamtbetrag ergeben:
0 + 80.000 = 80.000.

Vorauszahlungen sind nicht vereinbart, damit sind alle Salden 0 und der Vorschlag für die
neue Vorauszahlung ebenfalls 0 — ein Zwölftel von nichts.

Die Zählerübersicht weist den Wasserzähler weiter korrekt mit 40 Einheiten aus; er ist für
diese Abrechnung nur nicht einschlägig.
