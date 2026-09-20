// Entscheidungslogik des Update-Hinweises, ohne DOM prüfbar (siehe update.test.ts).
// Die Prüfung selbst macht der Server (server/src/update.ts), und nur mit Zustimmung.
import type { Settings, UpdateStatus } from './types'

// Gefragt wird, bis eine Antwort gespeichert ist. Vor dem Laden der Einstellungen ist
// unbekannt, ob schon geantwortet wurde, dann bleibt die Frage aus.
export const consentPending = (s: Settings | null): boolean => s !== null && s.updateCheck === undefined

// „Später" gilt nur für die Version, bei der es geklickt wurde.
export const hintVisible = (st: UpdateStatus | null, s: Settings | null): boolean =>
  !!st && st.enabled && st.available && st.latest !== s?.updateDismissed

export const RELEASES_URL = 'https://github.com/speedone/mietfuchs/releases/latest'

// Beenden aus der Oberfläche gibt es nur bei der Programmdatei (#45): Aus einem Linux-Paket
// startet Mietfuchs ohne Konsolenfenster, deren Schließen sonst der Weg zum Beenden ist. Im
// Container und im npm-Betrieb beendet die Umgebung den Dienst, und ein Neustart käme dort von
// selbst. Die Betriebsart meldet der Server mit dem Update-Stand.
export const canQuit = (st: UpdateStatus | null): boolean => st?.mode === 'binary' || st?.mode === 'package'

// Das System ergibt sich aus der Datei, die der Server passend zum Rechner ausgesucht hat
// (server/src/update.ts). Ohne passende Datei zeigt der Link auf die Release-Seite. `package`
// steht für eine Installation aus einem Linux-Paket: Dort wird nicht die Datei getauscht,
// sondern das Paket neu installiert.
export type System = 'windows' | 'macos' | 'linux' | 'package' | null

export type UpdateGuide =
  | { kind: 'download'; href: string; system: System; newTab: boolean }
  | { kind: 'command'; lines: string[] }

function systemOf(link: string): System {
  if (link.endsWith('.exe')) return 'windows'
  if (link.endsWith('.zip')) return 'macos'
  if (link.endsWith('.tar.gz')) return 'linux'
  return null
}

// Wie man je Betriebsart aktualisiert: Die Programmdatei wird ersetzt, der Container neu
// gezogen, eine Installation aus dem Quellcode neu gebaut. Befehle stehen einzeln, weil die
// Windows PowerShell 5.1 kein && kennt.
export function updateGuide(st: UpdateStatus): UpdateGuide {
  if (st.mode === 'binary') {
    const href = st.downloadUrl ?? st.releaseUrl ?? RELEASES_URL
    const system = systemOf(href)
    return { kind: 'download', href, system, newTab: system === null }
  }
  // Aus einem Paket installiert: Welche der drei Paketdateien passt, weiß nur die Distribution
  // des Nutzers. Deshalb führt der Weg über die Release-Seite, und installiert wird mit dem
  // Befehl, den er schon beim ersten Mal genommen hat.
  if (st.mode === 'package') return { kind: 'download', href: st.releaseUrl ?? RELEASES_URL, system: 'package', newTab: true }
  if (st.mode === 'docker') return { kind: 'command', lines: ['docker compose pull', 'docker compose up -d'] }
  return { kind: 'command', lines: ['git pull', 'npm install', 'npm run build'] }
}
