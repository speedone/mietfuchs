// Was die Oberfläche über den Umstieg der Daten in die Datenbank sagt (#55).
//
// Den Umstieg macht der Server beim Start (server/src/db/changeover.ts) und legt das Ergebnis in
// den Zustandsbericht (`database` in /healthz). Die Oberfläche liest ihn genau dafür: Beim Start
// aus einem Linux-Paket gibt es kein Konsolenfenster, und ohne diesen Weg erführe der Nutzer
// nie, was mit seinen Daten geschehen ist.
//
// Die Entscheidungslogik steht hier ohne DOM, damit sie prüfbar bleibt (database.test.ts).

import type { DatabaseState } from './types'

// Nur der eine Eintrag, den die Oberfläche daraus braucht. Der Rest des Berichts ist für den
// Betrieb gedacht (Container-Orchestratoren) und geht sie nichts an.
export type HealthReport = { database?: DatabaseState }

export type DatabaseHint = {
  // 'done' ist eine gute Nachricht in einem Satz, 'failed' eine Erklärung.
  kind: 'done' | 'failed'
  message: string
  notes: string[]
}

// Unter diesem Schlüssel merkt sich der Browser, welche Meldung schon weggeklickt wurde.
// Gespeichert wird die Meldung selbst und nicht bloß ein „gelesen": Scheitert der Umstieg beim
// nächsten Start aus einem **anderen** Grund, soll der neue Satz wieder erscheinen.
export const DISMISS_KEY = 'nka-umstieg-gelesen'

// Gesagt wird es einmal. Gab es nichts zu übernehmen, gibt es auch nichts zu erzählen: Das ist
// der Normalfall bei jedem Start nach dem ersten.
export function databaseHint(database: DatabaseState | null | undefined, dismissed: string | null): DatabaseHint | null {
  if (!database) return null
  const { state, message, notes } = database.changeover
  if (state === 'none' || !message) return null
  if (dismissed === message) return null
  return { kind: state, message, notes }
}
