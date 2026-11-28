// Womit sich Mietfuchs beim Start öffnet (#735). Nur dort, wo Mietfuchs selbst einen Browser öffnet (Programmdatei, Linux-
// Paket, die Programmdatei aus dem Store; nicht im Programmfenster, in Docker oder bei `npm start`).
//
// Vorrang: die Wahl in den Einstellungen, dann die Umgebungsvariable BROWSER, dann der Standardbrowser des Systems
// (xdg-open, open, start). Ist die Wahl nicht mehr zu finden, geht es mit dem Nächsten weiter, und ein Satz sagt es.
//
// Sicherheit: Gespeichert wird nur eine Kennung aus BROWSER_IDS (shared/browsers.ts), nie ein Pfad. Gestartet wird nur,
// was die Suche auf diesem Rechner unter festen Namen an festen Orten findet. Ein gewählter Browser und was BROWSER nennt
// starten ohne Shell (Programm und Argumentliste), die Adresse ist ein einziges Argument; nur der Standardbrowser unter
// Windows geht wie bisher über `cmd /c start`. Was BROWSER nennt, setzt der Nutzer selbst in seiner Umgebung; ein Eintrag
// mit Ordner muss absolut sein, ein bloßer Name wird nur in absoluten Ordnern des PATH gesucht (nie im Arbeitsordner),
// unter Windows nur eine .exe (eine .cmd oder .bat liefe über cmd.exe, Node lehnt sie ohne Shell ab).
//
// Plattform, Umgebung und Dateisystem kommen hinein (`BrowserProbe`), gerechnet mit path.win32 bzw. path.posix.
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import type { BrowserId } from '../../shared/types.ts'
import { asBrowserId, BROWSER_IDS, BROWSER_LABELS } from '../../shared/browsers.ts'

export { asBrowserId }

export type BrowserProbe = {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: () => string | null
  // Eine ausführbare Datei (unter Windows: eine Datei)
  isFile: (file: string) => boolean
  isDir: (dir: string) => boolean
}

export type FoundBrowser = { id: BrowserId, label: string, path: string }
export type Launch = { cmd: string, args: string[] }
export type BrowserPlan = Launch & { source: 'setting' | 'env' | 'default', notes: string[] }

// Programmnamen unter Linux (Pakete der Distributionen, Snap) und die Kennung bei Flatpak
const LINUX_NAMES: Record<BrowserId, { names: string[], flatpak: string }> = {
  firefox: { names: ['firefox', 'firefox-esr'], flatpak: 'org.mozilla.firefox' },
  chromium: { names: ['chromium', 'chromium-browser'], flatpak: 'org.chromium.Chromium' },
  chrome: { names: ['google-chrome', 'google-chrome-stable'], flatpak: 'com.google.Chrome' },
  edge: { names: ['microsoft-edge', 'microsoft-edge-stable'], flatpak: 'com.microsoft.Edge' },
  brave: { names: ['brave-browser', 'brave'], flatpak: 'com.brave.Browser' },
}
const MAC_APPS: Record<BrowserId, string> = {
  firefox: 'Firefox.app',
  chromium: 'Chromium.app',
  chrome: 'Google Chrome.app',
  edge: 'Microsoft Edge.app',
  brave: 'Brave Browser.app',
}
// Unterhalb von Program Files, Program Files (x86) und %LOCALAPPDATA% (Installation nur für den Benutzer)
const WINDOWS_EXES: Record<BrowserId, string> = {
  firefox: 'Mozilla Firefox\\firefox.exe',
  chromium: 'Chromium\\Application\\chrome.exe',
  chrome: 'Google\\Chrome\\Application\\chrome.exe',
  edge: 'Microsoft\\Edge\\Application\\msedge.exe',
  brave: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
}

function safeHome(probe: BrowserProbe): string | null {
  try {
    return probe.home()
  } catch {
    return null
  }
}

// Die absoluten Ordner des PATH; ein leerer oder relativer Eintrag hieße „im Arbeitsordner“
function pathDirs(probe: BrowserProbe): string[] {
  const win = probe.platform === 'win32'
  const p = win ? path.win32 : path.posix
  return (probe.env.PATH ?? probe.env.Path ?? '').split(p.delimiter).filter((dir) => dir !== '' && p.isAbsolute(dir))
}

function locate(id: BrowserId, probe: BrowserProbe): string | null {
  const home = safeHome(probe)
  if (probe.platform === 'darwin') {
    const roots = ['/Applications', ...(home ? [path.posix.join(home, 'Applications')] : [])]
    return roots.map((root) => path.posix.join(root, MAC_APPS[id])).find((app) => probe.isDir(app)) ?? null
  }
  if (probe.platform === 'win32') {
    const roots = [probe.env.ProgramFiles, probe.env['ProgramFiles(x86)'], probe.env.LOCALAPPDATA].filter((root): root is string => !!root && path.win32.isAbsolute(root))
    return roots.map((root) => path.win32.join(root, WINDOWS_EXES[id])).find((exe) => probe.isFile(exe)) ?? null
  }
  const { names, flatpak } = LINUX_NAMES[id]
  // Snap legt seine Programme unter Ubuntu nach /snap/bin, unter Fedora und Arch nach /var/lib/snapd/snap/bin
  const dirs = [...pathDirs(probe), '/snap/bin', '/var/lib/snapd/snap/bin']
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.posix.join(dir, name)
      if (probe.isFile(file)) return file
    }
  }
  const flatpakDirs = [...(home ? [path.posix.join(home, '.local/share/flatpak/exports/bin')] : []), '/var/lib/flatpak/exports/bin']
  return flatpakDirs.map((dir) => path.posix.join(dir, flatpak)).find((file) => probe.isFile(file)) ?? null
}

export function findBrowsers(probe: BrowserProbe): FoundBrowser[] {
  return BROWSER_IDS.flatMap((id) => {
    const found = locate(id, probe)
    return found ? [{ id, label: BROWSER_LABELS[id], path: found }] : []
  })
}

function launchOf(found: FoundBrowser, url: string, platform: NodeJS.Platform): Launch {
  return platform === 'darwin' ? { cmd: 'open', args: ['-a', found.path, url] } : { cmd: found.path, args: [url] }
}

export function defaultLaunch(url: string, platform: NodeJS.Platform): Launch {
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '""', url] }
  return { cmd: platform === 'darwin' ? 'open' : 'xdg-open', args: [url] }
}

// Wörter eines Eintrags mit %s: durch Leerraum getrennt, "…" und '…' halten Leerzeichen zusammen
function words(entry: string): string[] {
  const out: string[] = []
  let current: string | null = null
  let quote: string | null = null
  for (const ch of entry) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      current ??= ''
    } else if (/\s/.test(ch)) {
      if (current !== null) out.push(current)
      current = null
    } else {
      current = (current ?? '') + ch
    }
  }
  if (current !== null) out.push(current)
  return out
}

const withUrl = (word: string, url: string) => word.replace(/%([s%])/g, (_, c: string) => (c === 's' ? url : '%'))

// Ein Programm aus BROWSER: mit Ordner nur absolut, sonst im PATH (unter Windows auch mit .exe)
function resolveProgram(program: string, probe: BrowserProbe): string | null {
  const win = probe.platform === 'win32'
  const p = win ? path.win32 : path.posix
  const hasDir = win ? /[\\/]/.test(program) : program.includes('/')
  if (hasDir) return p.isAbsolute(program) && (!win || /\.exe$/i.test(program)) && probe.isFile(program) ? program : null
  if (win && /\.[^\\/.]+$/.test(program) && !/\.exe$/i.test(program)) return null
  const names = win && !/\.exe$/i.test(program) ? [`${program}.exe`] : [program]
  for (const dir of pathDirs(probe)) {
    for (const name of names) {
      const file = p.join(dir, name)
      if (probe.isFile(file)) return file
    }
  }
  return null
}

function envLaunch(value: string, url: string, probe: BrowserProbe): Launch | null {
  for (const entry of value.split(envDelimiter(probe.platform)).map((e) => e.trim()).filter(Boolean)) {
    const parts = entry.includes('%s') ? words(entry) : [entry]
    const [program, ...rest] = parts
    if (!program) continue
    const cmd = resolveProgram(program, probe)
    if (!cmd) continue
    return { cmd, args: entry.includes('%s') ? rest.map((word) => withUrl(word, url)) : [url] }
  }
  return null
}

const DEFAULT_TAIL = 'Mietfuchs öffnet sich im Standardbrowser.'
const envDelimiter = (platform: NodeJS.Platform) => (platform === 'win32' ? ';' : ':')

// Nennt BROWSER überhaupt einen Eintrag? Leer oder nur Trenner zählt wie nicht gesetzt.
export function hasBrowserEnv(probe: Pick<BrowserProbe, 'env' | 'platform'>): boolean {
  return (probe.env.BROWSER ?? '').split(envDelimiter(probe.platform)).some((entry) => entry.trim() !== '')
}

export function browserPlan({ choice, url, probe }: { choice: BrowserId | null, url: string, probe: BrowserProbe }): BrowserPlan {
  const notes: string[] = []
  const envValue = (probe.env.BROWSER ?? '').trim()
  const hasEnv = hasBrowserEnv(probe)
  if (choice) {
    const found = findBrowsers(probe).find((b) => b.id === choice)
    if (found) return { ...launchOf(found, url, probe.platform), source: 'setting', notes }
    notes.push(`Den in den Einstellungen gewählten Browser (${BROWSER_LABELS[choice]}) findet Mietfuchs auf diesem Rechner nicht mehr. ` +
      (hasEnv ? 'Mietfuchs öffnet sich, wie die Umgebungsvariable BROWSER es angibt.' : DEFAULT_TAIL))
  }
  if (hasEnv) {
    const launch = envLaunch(envValue, url, probe)
    if (launch) return { ...launch, source: 'env', notes }
    notes.push(`Die Umgebungsvariable BROWSER nennt kein Programm, das Mietfuchs auf diesem Rechner findet (${envValue}). ${DEFAULT_TAIL}`)
  }
  return { ...defaultLaunch(url, probe.platform), source: 'default', notes }
}

// Die Wahl aus PUT /api/settings. `found`: die Kennungen der hier gefundenen Browser, `null`, wo Mietfuchs beim Start
// keinen Browser öffnet. Unverändert Mitgeschicktes geht durch, auch wenn der Browser inzwischen fehlt; beim Start fällt
// Mietfuchs dann zurück (browserPlan).
export function acceptOpenWith(value: unknown, { stored, found }: { stored: BrowserId | null, found: readonly BrowserId[] | null }): { value: BrowserId | null } | { error: string } {
  if (value === null || value === undefined || value === '') return { value: null }
  if (value === stored) return { value: stored }
  if (found === null) return { error: 'Hier öffnet Mietfuchs beim Start keinen Browser. Die Wahl gilt nur für die Programmdatei und das Linux-Paket.' }
  const id = asBrowserId(value)
  if (!id) return { error: 'Unbekannter Browser. Wählen Sie den Standardbrowser oder einen der Browser, die Mietfuchs auf diesem Rechner gefunden hat.' }
  if (!found.includes(id)) return { error: `${BROWSER_LABELS[id]} findet Mietfuchs auf diesem Rechner nicht. Wählen Sie einen der gefundenen Browser oder den Standardbrowser.` }
  return { value: id }
}

// Nennt BROWSER ein Programm, das Mietfuchs hier findet? Nur dann heißt der Standard in der Karte nach BROWSER.
export function usableBrowserEnv(probe: BrowserProbe): boolean {
  return hasBrowserEnv(probe) && envLaunch((probe.env.BROWSER ?? '').trim(), 'about:blank', probe) !== null
}

export type SpawnFn = (cmd: string, args: string[]) => { on: (event: 'error', listener: () => void) => unknown, unref: () => void }

// Startet den Browser. Scheitert ein gewählter Browser oder einer aus BROWSER (`fallBack`), sofort (spawn wirft) oder
// später (Ereignis `error`), öffnet sich Mietfuchs im Standardbrowser; scheitert der, steht die Adresse in der Konsole.
export function launchBrowser(launch: Launch, { url, platform, fallBack, spawn, log }: { url: string, platform: NodeJS.Platform, fallBack: boolean, spawn: SpawnFn, log: (line: string) => void }): void {
  const failed = () => {
    if (!fallBack) return log(`Kein Browser gestartet (${launch.cmd} nicht verfügbar) - bitte ${url} von Hand öffnen.`)
    log(`${launch.cmd} ließ sich nicht starten. ${DEFAULT_TAIL}`)
    launchBrowser(defaultLaunch(url, platform), { url, platform, fallBack: false, spawn, log })
  }
  let child: ReturnType<SpawnFn>
  try {
    child = spawn(launch.cmd, launch.args)
  } catch {
    return failed()
  }
  // Fehlt das Programm, wirft spawn nicht, sondern meldet 'error' asynchron. Ohne Zuhörer wird daraus ein unbehandelter
  // Fehler, der den Server beendet, obwohl er schon lauscht (Linux-Server ohne xdg-open: headless, Container, SSH).
  child.on('error', failed)
  child.unref()
}

// Das wirkliche System; nur hier wird gefragt
export function systemProbe(): BrowserProbe {
  return {
    platform: process.platform,
    env: process.env,
    home: () => os.homedir(),
    isFile: (file) => {
      try {
        if (!fs.statSync(file).isFile()) return false
        fs.accessSync(file, fs.constants.X_OK)
        return true
      } catch {
        return false
      }
    },
    isDir: (dir) => {
      try {
        return fs.statSync(dir).isDirectory()
      } catch {
        return false
      }
    },
  }
}
