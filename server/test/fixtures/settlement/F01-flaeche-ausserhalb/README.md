# F01 — Flächenschlüssel mit einer Einheit außerhalb der Abrechnungseinheit

**Geprüfte Regel:** Eine Einheit, die nicht zur Abrechnungseinheit gehört (Nutzungsart *nicht
beteiligt*, `participates: false` ohne `selfUsed`), zählt beim Flächenschlüssel nicht mit — sie
verschwindet aus dem Nenner. Beispiel: ein Laden mit eigener Betriebskostenabrechnung. Die
Mieter der Abrechnungseinheit schöpfen den Betrag aus, der Vermieter trägt nichts.

Nicht zu verwechseln mit einer **selbstgenutzten** Wohnung: Die gehört zur Abrechnungseinheit,
zählt im Nenner mit, und ihr Anteil bleibt wie bei Leerstand beim Vermieter. Das prüft F11 mit
denselben Flächen.

**Grundlage:** Umlage nach dem Anteil der Wohnfläche innerhalb der Abrechnungseinheit
(§ 556a Abs. 1 BGB).

## Ausgangslage

| Einheit | Fläche | beteiligt | Mietverhältnis | Personen | Vorauszahlung |
|---|---|---|---|---|---|
| u1 EG (Laden, eigene Abrechnung) | 80 m² | **nein** | — | — | — |
| u2 OG links | 90 m² | ja | t2, ganzjährig | 4 | 150,00 €/Monat |
| u3 OG rechts | 60 m² | ja | t3, ganzjährig | 3 | 100,00 €/Monat |

Eine Kostenposition: Grundsteuer 2025, **900,00 €**, Schlüssel `area`.

## Handrechnung

Bezugsfläche = Einheiten der Abrechnungseinheit:

```
basisArea = 90 + 60 = 150 m²        (u1 gehört nicht zur Abrechnungseinheit)
```

Rohanteile (Tagesfaktor 365/365 = 1):

```
t2 = 90.000 ct × 90/150 = 54.000 ct = 540,00 €
t3 = 90.000 ct × 60/150 = 36.000 ct = 360,00 €
Summe = 90.000 ct → schöpft den Betrag exakt aus
```

Weil die Rohanteile den Betrag voll ausschöpfen, greift die cent-genaue Verteilung
(Hare/largest remainder). Beide Rohanteile sind bereits ganzzahlig, es bleibt kein Rest:

```
t2 = 54.000 ct        t3 = 36.000 ct        Vermieter = 0 ct
```

Gehörte u1 als selbstgenutzte Wohnung zur Abrechnungseinheit, wäre der Nenner 230 m²: Die
Mieter trügen 35.217 und 23.478 ct, die übrigen 31.305 ct blieben beim Vermieter — siehe F11.

Vorauszahlungen (12 Monate, Staffel gilt ab 2020-01):

```
t2 = 12 × 15.000 = 180.000 ct        t3 = 12 × 10.000 = 120.000 ct
```

Salden (`Vorauszahlung − Anteil`, positiv = Guthaben):

```
t2 = 180.000 − 54.000 = +126.000 ct = 1.260,00 € Guthaben
t3 = 120.000 − 36.000 =  +84.000 ct =   840,00 € Guthaben
```

Vorschlag neue Vorauszahlung (§560 Abs. 4 BGB, ein Zwölftel auf volle Euro):

```
t2 = 54.000 / 12 = 4.500 ct → 45,00 €
t3 = 36.000 / 12 = 3.000 ct → 30,00 €
```

Personentage: 4 × 365 = 1.460 bzw. 3 × 365 = 1.095 — hier ohne Wirkung auf die Verteilung,
aber Teil des verglichenen Ergebnisses.
