# Der eingefrorene Eingang

Hier steht, wie aus einer alten `db.json` ein Datenbestand in der Datenbank wird. **Diese Dateien
werden nicht mehr geändert.**

Das gilt streng für `schema.ts`, `write.ts` und `migrate.ts`: Sie hängen an einer Prüfsumme in
[legacy-schema.test.ts](../../test/legacy-schema.test.ts), und wer sie anfasst, bekommt einen
roten Test mit einer Erklärung. `read.ts` steht bewusst nicht darunter, siehe seinen eigenen Kopf.

**Eine Ausnahme gibt es, und sie ist eng.** Erlaubt ist eine Änderung, die

- weder eine Datenregel noch einen Wortschatz berührt, also nichts daran ändert, *was* aus einem
  alten Bestand wird,
- deren Verhaltensgleichheit gemessen ist, nicht behauptet,
- und deren neue Marke im **selben** Commit steht. Sonst ist der Zweig dazwischen rot, und
  `git bisect` über diesen Test bricht dort ab. Genau das ist in diesem Ordner schon einmal
  passiert.

Der bisher einzige Fall ist `compareText` in `migrate.ts`: Der Vergleich beim Sortieren kam aus
`calc.ts` statt aus einer eigenen Zeile, weil der Kommentar daneben „wie in `personsAt` in
calc.ts" sagt und das wahr bleiben soll. Gemessen über 5 Millionen Paare aus ISO-Stichtagen und
19 Sprachen: keine einzige abweichende Reihenfolge.

Dass diese Dateien überhaupt lebenden Code importieren dürfen (`ai/settings.ts`, `schedule.ts`,
`calc.ts`), ist kein Widerspruch: **Eingefroren ist der Aufbau der Tabellen, nicht jeder Helfer.**
Was hier nie stehen darf, ist ein Import aus `db/schema.ts`, denn der zielte wieder auf den
neuesten Stand. Dagegen steht ein eigener Wächter.

## Warum es diesen Ordner gibt

Eine fachliche Regel stand einmal an mehreren Stellen. Beispiel: Ein Wert einer Auswahl heißt
künftig `sonstiges` statt `sonstig`.

| Stelle | Was dort stünde |
| --- | --- |
| die neue Migration | `UPDATE meters SET type='sonstiges' WHERE type='sonstig'` |
| der Eingang | dieselbe Umschreibung für eine alte `db.json` |

Nur die erste ist durch die Regel aus [../../drizzle/README.md](../../drizzle/README.md)
geschützt („ein Schritt wird nie geändert"). Die zweite war ungeschützt und leicht zu vergessen,
weil nichts rot wird, wenn man es tut.

Die Ursache war, dass der Import immer auf den **neuesten** Stand zielte: Der Umstieg wendete
alle Migrationen an und schrieb danach mit dem heutigen Schema. Jede Regel, die den Weg dorthin
beschreibt, musste deshalb zweimal geschrieben werden.

## Wie es jetzt läuft

Der Import zielt auf den Stand **nach Migration 0000**, und erst danach läuft die Migrationskette
darüber (siehe `db/changeover.ts`). Damit trägt jeder Schritt seine Datenregel selbst, und ein
alter Bestand kommt auf demselben Weg zum neuesten Stand wie eine vorhandene Datenbank.

| Schritt | Wer | Verändert sich künftig? |
| --- | --- | --- |
| Alte `db.json` → Modell v0 | dieser Ordner | **Nein, eingefroren** |
| Modell v0 → Schema v0 | dieser Ordner | **Nein, eingefroren** |
| Schema v0 → heute | die Migrationen, je eine pro Änderung | wächst, aber nur dort |

Das Muster ist nicht erfunden. Django nennt es **historische Modelle** und sagt in seiner
Dokumentation genau unser Fehlerbild:

> „If you import models directly rather than using the historical models, your migrations may
> work initially but will fail in the future when you try to rerun old migrations."

Bei Flyway heißt der zweite Teil **Baseline**: Ein Altbestand kommt auf einem festgelegten
Ausgangsstand herein, danach läuft die gewöhnliche Kette darüber.

**Der Unterschied zu Django ist der Umfang.** Django braucht ein historisches Modell an *jeder*
Migration, weil dort beliebige Schritte Daten in Python umformen. Hier braucht es genau **eines**,
nämlich v0, weil Daten nur an einer einzigen Stelle hereinkommen. Alles danach ist SQL und
braucht überhaupt kein Modell.

## Warum er eingefroren werden darf

**Weil seine Eingabemenge geschlossen ist.** Nach dem Umstieg entsteht keine neue `db.json` mehr;
es kommt also nie ein Format hinzu, das dieser Ordner noch nicht kennt. Gelesen wird eine
`db.json` nur noch an zwei Stellen, und beide betreffen die Vergangenheit: beim einmaligen
Umstieg und beim Einspielen eines Backups, das von vor dem Umstieg stammt.

## Die Regel

**Wer das Schema oder den Wortschatz ändert, fasst diesen Ordner nicht an.** Er ändert
`db/schema.ts`, erzeugt den Schritt mit `npm --prefix server run db:generate` und schreibt die
Datenregel von Hand in dieselbe `.sql`-Datei. Drizzle unterstützt das ausdrücklich
(`drizzle-kit generate --custom` für einen reinen Datenschritt).

Dass er ihn nicht anfassen **muss**, ist der Gewinn. Dass er ihn nicht anfassen **darf**, steht
hier.

## Was das absichert

`server/test/legacy-schema.test.ts` legt eine Datenbank mit genau dem ersten Migrationsschritt an
und vergleicht Tabellen und Spalten mit `schema.ts` in diesem Ordner. Geprüft wird in beide
Richtungen, denn die beiden Fehler sind verschiedene: Eine Spalte, die die Kopie führt und die
Migration nicht anlegt, ergibt einen Fehler von SQLite. Eine Spalte, die die Migration anlegt und
die Kopie nicht führt, ist der stille Fall, und genau so verliert ein Umstieg ein Feld.

Der Wortschatz steht in `schema.ts` bewusst **ohne** Bindung an die Domänentypen aus
`shared/types.ts`. Eine Bindung an einen lebenden Typ wäre das Gegenteil von eingefroren: Käme
dort ein Wert hinzu oder hieße einer anders, wanderte diese Datei mit, und der Wortschatz von
damals wäre verloren.
