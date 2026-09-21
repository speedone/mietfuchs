// Vorschrift für drizzle-kit. Sie beschreibt nur, woraus Migrationen erzeugt werden und wohin
// sie kommen; eine Verbindung zur Datenbank steht hier bewusst nicht. `drizzle-kit generate`
// liest allein das Schema und schreibt SQL, es öffnet dabei keine Datei.
//
// Angewendet werden die Migrationen im Betrieb nicht von drizzle-kit, sondern vom Server selbst
// (Aufgabe 3). In der Programmdatei gibt es dafür kein Dateisystem mit Projektdateien, weshalb
// scripts/embed-migrations.mjs sie in ein Modul einbettet.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
})
