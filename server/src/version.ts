// Version und Betriebsart des laufenden Mietfuchs. Beides ist die gemeinsame Quelle für
// /healthz und den Update-Hinweis.
//
// Die Version steht in server/package.json. Als JSON-Import statt per Dateizugriff: Buns
// Bundler baut importiertes JSON beim Kompilieren fest ein, sodass auch die Programmdatei ihre
// Version kennt. Dort gibt es keine package.json im Dateisystem. Node lädt JSON-Module erst ab
// 22.12 ohne Warnung und bricht vor 20.10 mit einem Syntaxfehler ab; das allein verlangte nur
// diese Version. `engines` steht heute höher, bei >=24.15: TypeScript-Dateien gelten erst ab
// 24.12 ohne Build-Schritt als stabil ausführbar, und ab 24.15 meldet `node:sqlite` beim Laden
// keine ExperimentalWarning mehr.
import pkg from '../package.json' with { type: 'json' }
import { storeLocation, systemLocation } from './paths.ts'

export const APP_VERSION: string = pkg.version

export type Runtime = 'binary' | 'package' | 'store' | 'desktop' | 'docker' | 'npm'

type RuntimeInput = {
  bun?: boolean
  utility?: boolean
  execPath?: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
}

// Läuft der Server als utilityProcess von Electron (#517)? Nur dort gibt es `process.parentPort`, den Kanal zum
// Hauptprozess; unter Node, in Docker und in der Programmdatei (Bun) fehlt er, und mit `ELECTRON_RUN_AS_NODE` ebenso
// (dazu ist die Fuse `runAsNode` im Fenster ohnehin aus). Die Typen von Node kennen ihn nicht.
export type ParentPort = {
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown
  postMessage(message: unknown): void
}
export const PARENT_PORT: ParentPort | null =
  typeof process.versions.electron === 'string' ? ((process as { parentPort?: ParentPort }).parentPort ?? null) : null

// Im eigenen Programmfenster (#517): utilityProcess von Electron und die Angabe NKA_DESKTOP=1 des Fensters. Beides,
// denn die Angabe allein kann jeder setzen, auch versehentlich im Terminal, aus dem der Dev-Server oder ein Container
// startet; die hielten sich sonst für das Fenster und nähmen den Datenordner im Benutzerordner. `NKA_RUNTIME=desktop`
// stellt das Fenster für die Servertests unter Node nach.
export function inWindow({ utility = PARENT_PORT !== null, env = process.env }: Pick<RuntimeInput, 'utility' | 'env'> = {}): boolean {
  return (utility && env.NKA_DESKTOP === '1') || env.NKA_RUNTIME === 'desktop'
}

// 'binary' in der Programmdatei (Bun), 'package' bei derselben Datei aus einem
// Installationspaket (#25: sie liegt dann an einem Ort, der dem System gehört), 'store' aus dem
// Microsoft Store (#500), 'desktop' im eigenen Programmfenster unter Windows und macOS (#517: der Server als
// utilityProcess von Electron mit NKA_DESKTOP; aus dem Store 'store', erkannt an NKA_STORE, das das Fenster aus
// `process.windowsStore` setzt, oder am Paketordner), 'docker' im Container (das Dockerfile setzt NKA_RUNTIME), sonst 'npm'.
// Bestimmt, wie der Update-Hinweis das Aktualisieren erklärt: Datei austauschen, Paket neu
// installieren, Container ziehen oder neu bauen. Aus dem Store fragt Mietfuchs gar nicht erst
// nach, dort aktualisiert der Store.
// `NKA_RUNTIME=binary` gibt die Programmdatei vor, ohne eine zu sein. Gedacht für Tests, die
// das Verhalten beim Start aus dem Startmenü prüfen (Browser öffnen, Beenden aus der
// Oberfläche, belegter Port). Die Auslieferung des Frontends hängt weiterhin an Bun selbst.
export function detectRuntime({
  bun = !!globalThis.Bun,
  utility = PARENT_PORT !== null,
  execPath = process.execPath,
  platform = process.platform,
  env = process.env,
}: RuntimeInput = {}): Runtime {
  if (utility && env.NKA_DESKTOP === '1') {
    return env.NKA_STORE === '1' || storeLocation(execPath, platform) ? 'store' : 'desktop'
  }
  if (bun) {
    if (storeLocation(execPath, platform)) return 'store'
    return systemLocation(execPath, platform) ? 'package' : 'binary'
  }
  if (env.NKA_RUNTIME === 'docker') return 'docker'
  if (env.NKA_RUNTIME === 'desktop') return 'desktop'
  return env.NKA_RUNTIME === 'binary' ? 'binary' : 'npm'
}

export const RUNTIME: Runtime = detectRuntime()

// Von einem Menschen gestartet und für sich selbst verantwortlich: Nur dann öffnet Mietfuchs
// den Browser, bietet das Beenden aus der Oberfläche an und behandelt einen belegten Port als
// „läuft schon“. Im Container und im npm-Betrieb übernimmt das die Umgebung.
export const STANDALONE: boolean = RUNTIME === 'binary' || RUNTIME === 'package' || RUNTIME === 'store' || RUNTIME === 'desktop'

// Im eigenen Programmfenster (#517), auch aus dem Store: Das Fenster zeigt die Oberfläche, ein Browser öffnet sich
// nicht, und das Fenster beendet den Server.
export const IN_WINDOW: boolean = inWindow()
