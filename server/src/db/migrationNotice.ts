// Der Hinweis auf die Sicherung vor einem Update (#154), über einen Neustart hinweg (#180).
//
// Vor dem Nachholen von Schritten legt open.ts eine Sicherung daneben, und /healthz nennt sie,
// damit die Oberfläche den Rückweg zeigen kann. Bekannt war sie aber nur dem Prozess, der
// migriert hat: Startete Mietfuchs neu, bevor jemand die Oberfläche geöffnet hatte (Docker mit
// Neustart-Richtlinie, npm nach einem Absturz, ein Rechner, der über Nacht neu startet), war der
// Hinweis verloren, und mit ihm das Wissen, dass es den Rückweg gibt.
//
// Deshalb eine kleine Merkdatei im Datenordner und keine Spalte in der Datenbank: Der Hinweis
// gehört zum Update und nicht zum Bestand, er soll weder ins Backup noch eine eigene Migration
// brauchen. Sie steht, bis die Oberfläche den Hinweis wegklickt (`acknowledge`), bis ein Backup
// eingespielt wird (`clear`, die Sicherung gehört dann nicht mehr zum Stand) oder bis die
// genannte Sicherung nicht mehr da ist: Eine Meldung über eine Datei, die es nicht gibt, wäre
// falsch. Eine unlesbare Merkdatei ist kein Grund für einen Fehler, dann gibt es eben keinen
// Hinweis.

import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseState } from '../../../shared/types.ts'

export type MigrationNotice = NonNullable<DatabaseState['migrated']>

export const NOTICE_NAME = 'sicherung-vor-update.json'

const noticeFile = (dataDir: string): string => path.join(dataDir, NOTICE_NAME)

// Woran die Oberfläche das Wegklicken erkennt (client/src/database.ts, `dismissKey`).
export const noticeKey = (notice: MigrationNotice): string => `${notice.backup}@${notice.at}`

export function recordNotice(dataDir: string, notice: MigrationNotice): void {
  fs.writeFileSync(noticeFile(dataDir), JSON.stringify(notice, null, 2), 'utf8')
}

export function readNotice(dataDir: string): MigrationNotice | null {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(noticeFile(dataDir), 'utf8'))
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const { steps, backup, at } = raw as Record<string, unknown>
  if (typeof steps !== 'number' || typeof backup !== 'string' || typeof at !== 'string') return null
  // Nur ein Dateiname im Datenordner, nie ein Pfad: Die Datei kommt von außen.
  if (backup !== path.basename(backup) || !backup.startsWith('mietfuchs.sqlite.vor-')) return null
  if (!fs.existsSync(path.join(dataDir, backup))) return null
  return { steps, backup, at }
}

// Weggeklickt. Nur wenn der Schlüssel zu dem passt, was dasteht: Ein Tab von vor einem weiteren
// Update soll den Hinweis auf die neuere Sicherung nicht wegräumen.
// Scheitert das Entfernen (Datenordner schreibgeschützt), ist das kein Fehler der Anfrage: Der
// Hinweis kommt dann beim nächsten Start wieder, und `failed` sagt das dem Aufrufer, statt zu werfen.
// `remove` ist für den Test hineingereicht.
export function acknowledgeNotice(dataDir: string, key: string, remove: (dataDir: string) => void = clearNotice): 'cleared' | 'unchanged' | 'failed' {
  const notice = readNotice(dataDir)
  if (!notice || noticeKey(notice) !== key) return 'unchanged'
  try {
    remove(dataDir)
  } catch {
    return 'failed'
  }
  return 'cleared'
}

export function clearNotice(dataDir: string): void {
  fs.rmSync(noticeFile(dataDir), { force: true })
}
