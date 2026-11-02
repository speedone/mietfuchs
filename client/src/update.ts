// Entscheidungslogik des Update-Hinweises, ohne DOM prüfbar (siehe update.test.ts).
// Die Prüfung selbst macht der Server (server/src/update.ts), und nur mit Zustimmung.
import type { Settings, UpdateStatus } from './types'

// Aus dem Microsoft Store (#500) aktualisiert der Store selbst, Mietfuchs fragt dort nie bei
// GitHub nach (server/src/update.ts).
export const updatedByStore = (st: UpdateStatus | null): boolean => st?.mode === 'store'

// Gefragt wird, bis eine Antwort gespeichert ist. Vor dem Laden der Einstellungen ist
// unbekannt, ob schon geantwortet wurde, dann bleibt die Frage aus. Ebenso, solange die
// Betriebsart unbekannt ist: Aus dem Store wäre die Frage sinnlos.
export const consentPending = (s: Settings | null, st: UpdateStatus | null): boolean =>
  s !== null && st !== null && !updatedByStore(st) && s.updateCheck === undefined

// „Später“ gilt nur für die Version, bei der es geklickt wurde.
export const hintVisible = (st: UpdateStatus | null, s: Settings | null): boolean =>
  !!st && st.enabled && st.available && st.latest !== s?.updateDismissed

export const RELEASES_URL = 'https://github.com/speedone/mietfuchs/releases/latest'

// ---------- Umstieg auf das eigene Programmfenster (#517) ----------
// Die Programmdatei gibt es ab 0.15 noch einige Releases weiter; unter Windows und macOS weist sie auf das neue
// Programm hin. Ob, sagt der Server (`desktopOffer`, server/src/update.ts), ohne Anfrage bei GitHub. Die Links stehen
// hier fest und kommen nie aus einer Antwort von GitHub: Die Release-Seite führt zu Installer und Abbild.

// Die Seite der App im Microsoft Store, mit der Store-ID aus scripts/store-submit.mjs (update.test.ts hält beide
// zusammen). `mode=direct` öffnet die Store-App statt der Webseite, wie das Abzeichen im README.
export const STORE_URL = 'https://apps.microsoft.com/detail/9PMHZ0ZJPZDZ?mode=direct'

// „Später“ gilt für die installierte Version: Wer die Programmdatei aktualisiert, sieht den Hinweis wieder. Vor dem
// Laden der Einstellungen bleibt er aus, sonst blitzte er nach „Später“ bei jedem Start kurz auf.
export const desktopHintVisible = (st: UpdateStatus | null, s: Settings | null): boolean =>
  !!st?.desktopOffer && s !== null && s.desktopHintDismissed !== st.current

export type DesktopLink = { label: string; href: string; primary: boolean }

// Windows: empfohlen der Store (Updates von selbst, keine Warnung beim Start, eigene ARM-Fassung), daneben der
// Installer für x64 und ARM64. Mac: das Abbild für Apple Silicon oder Intel, beides auf der Release-Seite.
// Läuft eine Vorabversion, führt der Link auf die Seite genau dieses Releases (gebildet aus der eigenen Version, nicht
// aus einer Antwort): releases/latest überspringt Vorabversionen, und der Store hat keine.
export function desktopLinks(offer: 'windows' | 'macos', current: string): DesktopLink[] {
  if (isPrerelease(current)) {
    const href = `https://github.com/speedone/mietfuchs/releases/tag/v${current}`
    return [{ label: offer === 'windows' ? 'Installer herunterladen' : 'Neues Mietfuchs herunterladen', href, primary: true }]
  }
  if (offer === 'windows') {
    return [
      { label: 'Aus dem Microsoft Store laden', href: STORE_URL, primary: true },
      { label: 'Installer herunterladen', href: RELEASES_URL, primary: false },
    ]
  }
  return [{ label: 'Neues Mietfuchs herunterladen', href: RELEASES_URL, primary: true }]
}

// Beenden aus der Oberfläche gibt es nur bei der Programmdatei (#45): Aus einem Linux-Paket
// startet Mietfuchs ohne Konsolenfenster, deren Schließen sonst der Weg zum Beenden ist. Im
// Container und im npm-Betrieb beendet die Umgebung den Dienst, und ein Neustart käme dort von
// selbst. Die Betriebsart meldet der Server mit dem Update-Stand.
// Aus dem Microsoft Store (#500) läuft Mietfuchs ebenfalls ohne Konsolenfenster.
// Im Programmfenster (#517) schließt das Beenden auch das Fenster.
export const canQuit = (st: UpdateStatus | null): boolean => st?.mode === 'binary' || st?.mode === 'package' || st?.mode === 'store' || st?.mode === 'desktop'

// Das System ergibt sich aus der Datei, die der Server passend zum Rechner ausgesucht hat
// (server/src/update.ts). Ohne passende Datei zeigt der Link auf die Release-Seite. `package`
// steht für eine Installation aus einem Linux-Paket: Dort wird nicht die Datei getauscht,
// sondern das Paket neu installiert.
export type System = 'windows' | 'macos' | 'linux' | 'package' | 'desktop' | 'desktop-mac' | null

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
  // Das Programmfenster (#517) wird neu installiert. Auf dem Mac nennt der Server das passende Abbild (kein
  // automatisches Update ohne bezahlte Signatur); unter Windows aktualisiert sich das Fenster selbst, die Anleitung
  // über die Release-Seite bleibt für den Fall, dass es das nicht kann.
  if (st.mode === 'desktop') {
    if (st.downloadUrl?.endsWith('.dmg')) return { kind: 'download', href: st.downloadUrl, system: 'desktop-mac', newTab: false }
    return { kind: 'download', href: st.releaseUrl ?? RELEASES_URL, system: 'desktop', newTab: true }
  }
  if (st.mode === 'docker') return { kind: 'command', lines: ['docker compose pull', 'docker compose up -d'] }
  return { kind: 'command', lines: ['git pull', 'npm install', 'npm run build'] }
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

// Ein Release-Kandidat (`0.9.0-rc.2`) trägt hinter den drei Zahlen einen Bindestrich. Die
// Reihenfolge nach SemVer kennt der Server (server/src/update.ts); hier geht es nur um den Satz.
export const isPrerelease = (version: string): boolean => /^\d+\.\d+\.\d+-/.test(version)

// Der Stand in der Karte der Einstellungen. Bei einer Vorabversion wäre „aktuelle Version“
// falsch (#166): Sie ist noch nicht veröffentlicht, und neben ihr steht die letzte fertige.
export function statusText(s: UpdateStatus): string {
  // Windows ersetzt ein Paket nicht, solange es läuft, und Mietfuchs läuft im Hintergrund weiter, bis man es beendet
  // oder Windows neu startet (MSIX servicing while in use, Microsoft).
  if (updatedByStore(s)) return `Installiert ist Version ${s.current}. Neue Versionen installiert der Microsoft Store von selbst, sobald Mietfuchs beendet ist. Sofort geht es im Store unter „Bibliothek“ mit „Updates abrufen“.`
  if (!s.enabled) return `Installiert ist Version ${s.current}.`
  const lastChecked = s.checkedAt ? ` Zuletzt geprüft: ${fmtDateTime(s.checkedAt)}.` : ''
  if (s.error) {
    const lastKnown = s.available ? ` Zuletzt bekannt: Version ${s.latest} ist erschienen.` : ''
    return `Installiert ist Version ${s.current}. Die letzte Prüfung ist fehlgeschlagen: ${s.error}${lastKnown}`
  }
  if (s.available) return `Version ${s.latest} ist erschienen, installiert ist ${s.current}.${lastChecked}`
  if (s.latest && isPrerelease(s.current)) {
    return `Sie nutzen die Vorabversion ${s.current}. Neueste veröffentlichte Version: ${s.latest}.${lastChecked}`
  }
  if (s.latest) return `Sie nutzen die aktuelle Version ${s.current}.${lastChecked}`
  return `Installiert ist Version ${s.current}.`
}
