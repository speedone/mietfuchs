# F04 — Largest Remainder: 100,00 € auf drei gleiche Einheiten

**Geprüfte Regel:** Ein Betrag, der sich nicht glatt teilen lässt, wird **vollständig**
verteilt — die Summe der Anteile ist exakt der Ausgangsbetrag, nicht ein Cent weniger. Und:
Bei gleichem Nachkommaanteil muss der Tie-Break **deterministisch** sein.

**Grundlage:** Restverfahren nach dem größten Rest; bei Gleichstand entscheidet die ID des
Mietverhältnisses (seit v0.3.1, #9).

## Das Beispiel

100,00 € auf drei gleiche Einheiten ergeben 33,34 + 33,33 + 33,33 = 100,00 €. Wer den Rest-Cent
bekommt, ist fachlich beliebig — aber dieselben Daten müssen immer dasselbe Ergebnis liefern.

## Ausgangslage

Drei gleich große Wohnungen (je 50 m²), alle ganzjährig vermietet, alle beteiligt.
Eine Kostenposition: **100,00 €**, Schlüssel `units`.

## Handrechnung

```
Rohanteil je Einheit = 10.000 ct / 3 = 3.333,3333… ct
Abrundung            = 3.333 ct je Einheit → Summe 9.999 ct
Rest                 = 10.000 − 9.999 = 1 ct
```

Das eine verbleibende Cent geht an den größten Nachkommaanteil. Hier sind **alle drei
Nachkommaanteile identisch** (0,3333…) — genau der Fall, in dem der Tie-Break entscheidet. Er wird
zugunsten des ersten Mietverhältnisses in fachlich stabiler Sortierung entschieden, also `t1`:

```
t1 = 3.334 ct = 33,34 €
t2 = 3.333 ct = 33,33 €
t3 = 3.333 ct = 33,33 €
      Summe   = 10.000 ct = 100,00 €      Vermieter = 0
```

**Wichtig:** „Erster“ heißt hier *erster nach fachlichem Schlüssel* (Mietverhältnis-ID), nicht
*erster in der zufälligen Eingabereihenfolge*. Würde die Zuteilung von der Array- oder
Datenbankreihenfolge abhängen, wäre dasselbe Fixture bei anderer Eingabesortierung anders
verteilt. Das prüft der Test „Restcent bei gleichen Anteilen“ in `calc.test.ts` mit
vertauschter Eingabe.

Vorauszahlungen: je 12 × 10,00 € = 120,00 €.

Salden:

```
t1 = 12.000 − 3.334 = +8.666 ct
t2 = 12.000 − 3.333 = +8.667 ct
t3 = 12.000 − 3.333 = +8.667 ct
```

Vorschlag neue Vorauszahlung: 3.334 / 12 = 2,78 € bzw. 3.333 / 12 = 2,78 € — beide auf volle
Euro gerundet 3,00 €.
