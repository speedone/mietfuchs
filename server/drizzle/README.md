# Migrationen

Erzeugt von `drizzle-kit` aus [../src/db/schema.ts](../src/db/schema.ts). Ein neuer Schritt
entsteht mit:

```powershell
npm --prefix server run db:generate
```

## Die Regel, und sie gilt für immer

**Ein Migrationsschritt wird nie gelöscht und nie geändert.** Weder die `.sql`-Datei noch ihr
Eintrag in `meta/_journal.json` noch die zugehörige Momentaufnahme unter `meta/`.

Der Grund ist die Zusage, die Mietfuchs seinen Nutzern gibt: Von **jeder** alten Version kommt
man auf die neueste, ohne die Daten neu einzutippen. Diese Zusage hält nur, solange die Kette
der Schritte vollständig und unverändert ist. Wer einen Schritt nachbessert, bessert ihn nur für
sich nach: Bei allen, die ihn schon angewendet haben, bleibt die alte Fassung wirksam, und ab da
weichen zwei Datenbestände voneinander ab, die sich für denselben halten. Wer einen Schritt
löscht, nimmt jedem, der weiter zurückliegt, den Weg nach vorn.

Ein Fehler in einem bereits veröffentlichten Schritt wird deshalb mit einem **neuen** Schritt
behoben, der ihn geraderückt. Auch dann, wenn das umständlicher ist als die zwei Zeichen, die
man ändern wollte.

Solange ein Schritt die Arbeitskopie nicht verlassen hat, also weder gepusht noch in ein Release
gelangt ist, darf man ihn natürlich neu erzeugen. Die Regel greift ab dem Augenblick, in dem
jemand anderes ihn haben könnte.

## Momentaufnahmen

Die Dateien unter `meta/` sind die Buchführung von drizzle-kit: Sie beschreiben, wie das Schema
nach jedem Schritt aussah, und nur daraus kann drizzle-kit den nächsten Unterschied berechnen.
Sie gehören ins Repository und fallen unter dieselbe Regel.

## Wie sie in die Programmdatei kommen

In der Bun-Programmdatei gibt es zur Laufzeit kein Dateisystem mit Projektdateien. Deshalb
erzeugt [../../scripts/embed-migrations.mjs](../../scripts/embed-migrations.mjs) aus genau
diesen `.sql`-Dateien ein Modul, das mit eingebaut wird. Von Hand abgeschrieben wird nichts,
sonst liefen Erzeugtes und Verwendetes irgendwann auseinander.
