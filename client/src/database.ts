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
export type HealthReport = { version?: string, database?: DatabaseState }

export type DatabaseHint = {
  // 'done' ist eine gute Nachricht in einem Satz, 'failed' eine Erklärung, 'stale' eine
  // Feststellung mit einer Handlungsanweisung (#89), die nicht nach einem Fehler aussehen darf.
  kind: 'done' | 'failed' | 'stale'
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

// ---------- Nach einem Update: die Sicherung (#154) ----------
//
// Vor dem Nachholen von Schritten am Aufbau legt der Server eine Sicherung der Datenbank daneben
// (`mietfuchs.sqlite.vor-<Schritt>`, open.ts). Wer Mietfuchs aus dem Startmenü startet, sieht den
// Datenordner nie; ohne diesen Satz wüsste er nicht, dass es den Rückweg gibt.
//
// Kommt nur nach einem Start, der wirklich nachgeholt hat: Beim nächsten liefert der Server
// `migrated: null`, und dann ist der Hinweis weg, auch ohne dass ihn jemand weggeklickt hat.

export type UpdateHint = { backup: string, message: string, guideUrl: string }

// Der Abschnitt „Zurück zu einer älteren Version“ in MIGRATION.md, verankert so, wie GitHub die
// Überschrift umsetzt (klein, Leerzeichen zu Bindestrichen, Umlaute bleiben).
export const MIGRATION_GUIDE_URL = 'https://github.com/speedone/mietfuchs/blob/main/MIGRATION.md#zurück-zu-einer-älteren-version'

// Gemerkt wird der Name der Sicherung: Er trägt den ersten nachgeholten Schritt und ist damit je
// Update ein anderer. Ein späteres Update meldet sich so wieder, dasselbe nicht.
export const UPDATE_DISMISS_KEY = 'nka-sicherung-gelesen'

export function updateHint(database: DatabaseState | null | undefined, version: string | undefined, dismissed: string | null): UpdateHint | null {
  const migrated = database?.migrated
  if (!migrated) return null
  if (dismissed === migrated.backup) return null
  const updated = version ? `Mietfuchs wurde auf Version ${version} aktualisiert.` : 'Mietfuchs wurde aktualisiert.'
  return {
    backup: migrated.backup,
    message:
      `${updated} Vorher wurde eine Sicherung Ihrer Daten angelegt (${migrated.backup} im Datenordner). ` +
      'Wie Sie zur vorigen Version zurückkommen, steht in der Anleitung.',
    guideUrl: MIGRATION_GUIDE_URL,
  }
}
