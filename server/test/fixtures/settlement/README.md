# Prüfkatalog der Abrechnung

Jedes Fixture ist ein kleiner, vollständiger Datenbestand mit einem von Hand hergeleiteten
Ergebnis:

| Datei | Inhalt |
|---|---|
| `db.json` | Eingangsdaten im Mietfuchs-Datenformat |
| `expected.json` | erwartetes Ergebnis, cent-genau, **von Hand hergeleitet, nicht aus dem Code abgelesen** |
| `README.md` | die Handrechnung mit fachlicher Begründung |

`settlement-golden.test.ts` rechnet jedes Fixture und vergleicht ohne Toleranz: Anteile,
Vermieter- und Eigenanteil, Vorauszahlungen, Salden, §35a, Verbrauch und Warnungen im Wortlaut.
Nicht verglichen werden reine Anzeigetexte wie `basisText`.

**Eine Abweichung ist nie ein Testproblem.** Entweder rechnet die Abrechnung falsch, oder die
Herleitung stimmt nicht. Eine geänderte Erwartung braucht deshalb eine fachliche Begründung in
der README.md des Fixtures. Zum Untersuchen:

```
GOLDEN=diff npm --prefix server test
```

legt das Ist-Ergebnis als `expected.actual.json` neben die Erwartung (nicht eingecheckt).
Übernommen wird es nie automatisch.

| Fixture | Prüft |
|---|---|
| F01 | Flächenschlüssel mit einer Einheit außerhalb der Abrechnungseinheit |
| F02 | Personenschlüssel mit Änderung der Personenzahl im Jahr |
| F03 | Mieterwechsel zum Stichtag, kein Tag doppelt oder fehlend |
| F04 | Restverfahren: 100,00 € auf drei gleiche Einheiten, Tie-Break |
| F05 | Verbrauchsschlüssel mit Zählertausch |
| F06 | fehlender Verbrauch (Warnung) und nicht umlagefähige Kosten |
| F07 | Vorauszahlungs-Staffel und tatsächlich gezahlter Jahresbetrag |
| F08 | §35a-Lohnanteil folgt dem Kostenanteil |
| F09 | Schaltjahr, Einzug im Jahr und Leerstand |
| F10 | gemischte Schlüssel in einer Abrechnung |
| F11 | Eigennutzung: Anteil der selbstgenutzten Wohnung bleibt beim Vermieter |
