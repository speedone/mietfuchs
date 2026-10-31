// Gemeinsame Helfer der Integrationstests gegen den echten Server (#263).
//
// Bis #263 stand alles in einer Datei, server/test/api.test.ts. `node --test` verteilt aber nur
// Dateien auf Prozesse und nicht die Tests einer Datei, und diese eine Datei mit ihren rund
// 270 Serverstarts bestimmte allein das Ende des ganzen Laufs (418 von 420 Sekunden). Die Tests
// stehen deshalb nach Themen in server/test/api-*.test.ts, und hier steht, was mehrere davon
// brauchen: die Typen der Antworten, der Start des Servers, die nachgebauten Dienste.
//
// Jeder Serverstart setzt NKA_DATA_DIR auf einen Wegwerf-Ordner, CI und NKA_UPDATE_URL auf einen
// geschlossenen Port; der Wächter „Jeder Serverstart einer Prüfung setzt CI“ in
// api-start.test.ts liest dafür diese Datei und alle Teile.
//
// Bewusst außerhalb von test/: `node --test` führt jede Quelldatei unter test/ als Test aus.

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { applyMigrations, connect, loadMigrations, type Connection, type Database } from '../src/db/client.ts'
import { migrateLegacy, straightenForDatabase } from '../src/legacy/migrate.ts'
import { writeStock } from '../src/legacy/write.ts'
import { readStock } from '../src/db/read.ts'
import type { JsonSchema } from '../src/ai/ollama.ts'
import type {
  AiKeyInfo, AiSettings, AiSlot, AiSlotName, AssessmentView, BookingPreview, Extraction, LineDecision, MeterReadingExtraction, Property, Settings,
} from '../../shared/types.ts'
import type { MigratedSettings } from '../src/ai/settings.ts'

export const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------- Was über die Routen zurückkommt ----------
//
// Eine Antwort ist JSON aus einem anderen Prozess: `res.json()` liefert deshalb `unknown`, und
// kein Typ kann prüfen, was wirklich ankommt — das tun die Zusicherungen. Der Aufruf nennt
// aber, was die Route zusagt, und wo das ein Typ aus shared/types.ts ist, prüft der Übersetzer
// mit, dass Route und Datenmodell zusammenpassen. Die eine Behauptung dieser Datei steckt
// deshalb hier, an einer Stelle und benannt, statt verstreut in jedem Test.
export const jsonOf = <T>(res: Response): Promise<T> => res.json() as Promise<T>

// Der Betriebszustand aus /healthz (server/src/health.ts). Kein Typ des Datenmodells: Der
// Bericht ist für Container-Orchestratoren, nicht für die Oberfläche.
export type HealthCheck = { ok: boolean, detail: string }
export type HealthReport = {
  status: string
  version: string
  app: string
  checks: { data: HealthCheck, uploads: HealthCheck }
  // Die Datenbank (#55) steht bewusst neben `checks` und nicht darin: An diesem Stand arbeitet
  // Mietfuchs ohne sie weiter, und ein Fehler hier dürfte keinen Container neu starten lassen.
  database?: {
    open: boolean
    file: string
    migrations: number
    detail: string
    // Was beim Start mit den vorhandenen Daten geschehen ist. Aus diesem Eintrag erfährt es
    // auch die Oberfläche; beim Start aus einem Linux-Paket gibt es keine Konsole.
    changeover: { state: string, message: string, notes: string[] }
    // Hat dieser Start Schritte nachgeholt, die Sicherung davor (#154), sonst null.
    migrated: { steps: number, backup: string, at: string, version?: string } | null
  }
}

// Die Antwort von /api/upload, /api/extract und /api/intake. Welche Felder gesetzt sind, hängt
// vom Status und der Belegart ab; die Tests prüfen erst den Status und lesen dann das Passende.
// Jede Kennzahl ist null, wenn der Anbieter sie nicht meldet (ProviderStats in ai/ollama.ts).
export type AiStat = { step: string, promptTokens: number | null, outputTokens: number | null, seconds: number | null, loadSeconds: number | null }
export type UploadBody = {
  file?: string
  kind?: string
  extraction?: Extraction
  reading?: MeterReadingExtraction
  stats?: AiStat[]
  error?: string
  // Bei einem Fehler der KI (Fehler mit Ausweg): warum, ob der Beleg gespeichert blieb, und bei fehlender
  // Bestätigung der Dienst
  reason?: string
  kept?: boolean
  service?: string
  provider?: string
  meterPhoto?: boolean
}

// Eine Zeile des Stroms (Accept: application/x-ndjson): `type` sagt, was sie bedeutet, die
// übrigen Felder gehören je nach Art dazu.
export type StreamLine = {
  type?: 'progress' | 'heartbeat' | 'result' | 'error'
  step?: string
  phase?: string
  chars?: number
  status?: string
  total?: number
  completed?: number
  error?: string
  file?: string
  reason?: string
  kept?: boolean
  service?: string
  data?: UploadBody
}

// Was /api/settings liefert: die gespeicherten Einstellungen, ergänzt um die wirksamen
// KI-Einstellungen und um das, was die Oberfläche nur anzeigt. `ai` ist im Datenmodell optional,
// weil eine db.json von vor #18 es nicht kennt; über die Route kommt es immer, der Server
// ergänzt es beim Laden.
// Name und Adresse gehören seit #92 zum Objekt und kommen hier nicht mehr mit.
export type ClientSettings = Omit<Settings, 'houseName' | 'address'> & {
  ai: AiSettings
  fixedByEnv: string[]
  aiKeys: Record<AiSlotName, AiKeyInfo>
  aiExternal: Record<AiSlotName, boolean>
}

// Die Meldung einer abgelehnten Anfrage. Fehlt sie, hat die Route etwas anderes geantwortet,
// und der Test soll genau das benennen statt an undefined zu scheitern.
export const errorOf = (body: { error?: string }): string => {
  if (typeof body.error !== 'string') assert.fail(`keine Meldung in der Antwort: ${JSON.stringify(body).slice(0, 200)}`)
  return body.error
}

// Dieselbe Meldung, direkt aus einer Antwort gelesen.
export const errorFrom = async (res: Response): Promise<string> => errorOf(await jsonOf<{ error?: string }>(res))

// Dasselbe für den Belegnamen, den /api/upload zurückgibt.
export const fileOf = (body: { file?: string }): string => {
  if (typeof body.file !== 'string') assert.fail(`kein Beleg in der Antwort: ${JSON.stringify(body).slice(0, 200)}`)
  return body.file
}

// Der gespeicherte Bestand, an den Routen vorbei aus der Datenbank gelesen. Die Tests sehen
// hinein, weil der Schaden mancher Fehler gerade im dauerhaften Speichern besteht: Eine Route
// kann das Richtige antworten und das Falsche ablegen.
//
// Bis Aufgabe 6 stand hier die db.json. Sie wird seit dem Umstellen der Routen nicht mehr
// fortgeschrieben, ein Blick hinein sähe also den Stand von damals und nicht den von jetzt.
//
// **Diese Verbindung ist eine zweite neben der des Servers**, in einem anderen Prozess. Die Schlange
// (db/open.ts) ordnet nur die Zugriffe des Servers; liest der Server gerade (eine Vorversion, das
// Nachtragen der Prüfsummen), scheiterte ein Schreiben hier ohne Wartezeit sofort mit „database is
// locked“. Deshalb wartet sie bis zu fünf Sekunden auf die Sperre (`besideServer`).
export async function inDatabase<T>(s: { dataDir: string }, read: (db: Database) => Promise<T>): Promise<T> {
  const connection = await besideServer(s.dataDir)
  try {
    return await read(connection.db)
  } finally {
    connection.close()
  }
}

// Eine Verbindung auf die Datei eines laufenden Servers, die auf seine Sperren wartet. Nur für
// Tests: Der Server selbst hat genau eine Verbindung und braucht das nicht (db/CLAUDE.md).
export async function besideServer(dataDir: string): Promise<Connection> {
  const connection = await connect(path.join(dataDir, 'mietfuchs.sqlite'))
  connection.exec('PRAGMA busy_timeout = 5000')
  return connection
}

export const storedDb = (s: { dataDir: string }) => inDatabase(s, readStock)

// Die letzte Zeile eines Stroms. Ein leerer Strom ist immer ein Fehler.
export const lastLine = (lines: StreamLine[]): StreamLine => {
  const line = lines.at(-1)
  if (!line) assert.fail('der Strom ist leer geblieben')
  return line
}

// Der Port eines nachgebauten Dienstes. address() kennt auch den Unix-Socket und den nicht
// lauschenden Server; beides kommt hier nicht vor, und wäre es doch so, hilft die Ansage.
export const portOf = (server: http.Server | import('node:net').Server): number => {
  const address = server.address()
  if (address === null || typeof address === 'string') assert.fail('der nachgebaute Dienst lauscht nicht auf einem Port')
  return address.port
}

// Auf das Lauschen warten. listen() ruft ohne Argument zurück, deshalb der eigene Aufruf.
export const listening = (server: http.Server | import('node:net').Server, host?: string): Promise<void> =>
  new Promise((r) => (host ? server.listen(0, host, () => r()) : server.listen(0, () => r())))

// ---------- Anfragen an die nachgebauten Dienste ----------
// Beide Seiten stehen in dieser Datei, deshalb steht hier genau, was geschickt und gelesen wird.

export type OllamaMessage = { role: string, content: string, images?: string[] }
export type OllamaBody = {
  model?: string
  messages?: OllamaMessage[]
  think?: boolean
  stream?: boolean
  options?: { temperature?: number, num_ctx?: number }
  format?: JsonSchema
}
export type OllamaRequest = { url: string | undefined, body: OllamaBody, headers: http.IncomingHttpHeaders }

// Der Inhalt einer Nachricht an einen OpenAI-kompatiblen Dienst ist entweder Text oder eine
// Liste von Teilen (Text und Bilder).
export type OpenAiContentPart = { type: string, text?: string, image_url?: { url: string } }
export type OpenAiMessage = { role: string, content: string | OpenAiContentPart[] }
export type OpenAiBody = {
  model?: string
  messages?: OpenAiMessage[]
  stream?: boolean
  stream_options?: { include_usage?: boolean }
  temperature?: number
  max_tokens?: number
  max_completion_tokens?: number
  response_format?: { type?: string, json_schema?: { strict?: boolean, schema?: JsonSchema } }
}
export type OpenAiRequest = { url: string | undefined, method: string | undefined, body: OpenAiBody, raw: string, headers: http.IncomingHttpHeaders }

// Die erste Nachricht einer Anfrage — ohne sie hätte der Dienst nichts zu tun gehabt.
export const messageOf = <T>(messages: T[] | undefined): T => {
  const first = messages?.[0]
  if (!first) assert.fail('die Anfrage hat keine Nachricht mitgebracht')
  return first
}

// Einen Wegwerf-Ordner wieder loswerden, und zwar mit Wiederholungen.
//
// Seit die Datenbank beim Start geöffnet wird (#55), hält der Server eine Datei in diesem Ordner
// offen, solange sein Prozess lebt. Unter Windows lässt sich ein Ordner nicht löschen, solange
// darin etwas geöffnet ist, und `child.kill()` kehrt zurück, bevor der Prozess wirklich beendet
// ist. Ohne Wiederholung scheiterte das Aufräumen mit EPERM und riss den Test mit, obwohl an ihm
// nichts falsch war. Unter Linux und macOS ändert sich nichts: Dort darf ein geöffneter Pfad
// gelöscht werden.
//
// `maxRetries` von fs.rmSync genügt dafür nicht, nachgemessen: Diesen EPERM wiederholt es nicht.
// Gewartet wird deshalb selbst, und zwar blockierend, weil `stop()` an vielen Stellen im finally
// ohne await steht. Bleibt der Ordner am Ende doch liegen, ist das hinzunehmen: Ein Wegwerf-
// Ordner im Temp-Verzeichnis ist harmlos, ein wegen des Aufräumens rot gefärbter Test nicht.
export const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export const removeDataDir = (dir: string): void => {
  for (let versuch = 0; versuch < 30; versuch++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      sleepSync(100)
    }
  }
}

// Startet eine Server-Instanz auf einem eigenen Datenordner und wartet auf Bereitschaft.
export async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  return startServerIn(dataDir)
}

// Startet den Server neben einem nachgebauten Dienst (Ollama, OpenAI, GitHub). Scheitert der Start, etwa unter Last
// nach dem Zeitlimit von readStartUrl, wird der Dienst gestoppt und der Fehler weitergereicht: Sonst hielte sein offener
// Port die Testdatei für immer offen (gefunden bei #487, api-belegbuchung.test.ts hing so).
export async function startServerBeside(service: { stop: () => void }, dataDir: string, env: NodeJS.ProcessEnv = {}): Promise<Server> {
  try {
    return await startServerIn(dataDir, env)
  } catch (err) {
    service.stop()
    throw err
  }
}

// Liest die Adresse aus der Startmeldung „Mietfuchs-Server läuft auf …“. Wirft, wenn der Prozess
// vorher endet oder die Meldung ausbleibt. Die Ausgabe wird danach weiter gelesen, sonst liefe
// der Puffer der Pipe voll und der Server bliebe beim nächsten console.log hängen.
export function readStartUrl(child: ChildProcess & { stdout: Readable }, timeoutMs = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    let found = false
    const timer = setTimeout(() => reject(new Error(`Server ist nicht gestartet: ${output}`)), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      if (found) return
      output += chunk
      const match = output.match(/läuft auf (http:\/\/\S+)/)
      if (!match) return
      found = true
      clearTimeout(timer)
      resolve(match[1])
    })
    child.on('exit', (code: number | null) => {
      clearTimeout(timer)
      reject(new Error(`Server hat sich beendet (Code ${code}): ${output}`))
    })
  })
}

// `env` ergänzt oder überschreibt Umgebungsvariablen. NKA_UPDATE_URL zeigt standardmäßig ins
// Leere (Port 9 nimmt keine Verbindung an): Kein Test darf versehentlich das echte GitHub fragen.
// Die KI-Variablen aus der Shell des Entwicklers gelten nicht: Leere Werte zählen als nicht
// gesetzt, und eine leere Kandidatenliste schaltet die Suche nach Ollama ab.
//
// Den Port vergibt das System (NKA_PORT=0). Ein selbst gewählter Zufallsport lag im Bereich,
// aus dem Linux auch den nachgebauten Diensten der Tests Ports gibt, und traf gelegentlich einen
// belegten.
export async function startServerIn(dataDir: string, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NKA_UPDATE_URL: 'http://127.0.0.1:9/kein-internet-im-test',
      NKA_OLLAMA_URL: '',
      NKA_OLLAMA_MODEL: '',
      NKA_OLLAMA_NUM_CTX: '',
      NKA_OLLAMA_CANDIDATES: '',
      NKA_AI_TIMEOUT: '',
      NKA_AI_PROVIDER: '',
      NKA_AI_URL: '',
      NKA_AI_MODEL: '',
      NKA_AI_API_KEY: '',
      NKA_AI_API_KEY_FILE: '',
      NKA_AI_MAX_TOKENS: '',
      NKA_RUNTIME: '',
      ...env,
      NKA_PORT: '0',
      NKA_DATA_DIR: dataDir,
      // **Hinter `...env`, damit es kein Aufrufer versehentlich abschaltet.** Ohne `CI` oeffnet
      // der Server den Standard-Browser, sobald er sich fuer die Programmdatei haelt, und genau
      // das tut ein Aufrufer in api-start.test.ts mit `NKA_RUNTIME: 'binary'`. Jeder volle Testlauf riss
      // damit einen Tab auf einem Zufallsport auf. Siehe die Regel in CLAUDE.md.
      CI: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stop = () => {
    child.kill()
    removeDataDir(dataDir)
  }
  // Die ganze Konsolenausgabe, für Tests, die eine Meldung nach der Startzeile lesen (#180).
  let printed = ''
  child.stdout.on('data', (chunk: Buffer) => { printed += chunk })
  const output = () => printed
  // Die Fehlerausgabe ebenso, für Tests, die eine Warnung des Servers ausschließen (#318). Gelesen wird
  // sie in jedem Fall, sonst liefe der Puffer der Pipe voll.
  let printedErrors = ''
  child.stderr.on('data', (chunk: Buffer) => { printedErrors += chunk })
  const errorOutput = () => printedErrors
  let base
  try {
    base = await readStartUrl(child)
  } catch (err) {
    stop() // sonst hielte der verwaiste Prozess den Testlauf für immer offen
    throw err
  }
  const api = async <T = void>(urlPath: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${base}${urlPath}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    })
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${urlPath} → ${res.status}`)
    return jsonOf<T>(res)
  }
  // Sicherung: der Server muss wirklich im Wegwerf-Ordner arbeiten, sonst nichts weiter tun.
  if (!fs.existsSync(path.join(dataDir, 'uploads'))) {
    stop()
    assert.fail('NKA_DATA_DIR wird nicht beachtet')
  }
  return { api, base, dataDir, stop, child, output, errorOutput }
}

// ---------- Start aus dem Startmenü (#45) ----------

// Wartet, bis der Prozess endet, und liefert den Code. Wirft nach der Wartezeit.
export const waitForExit = (child: ChildProcess, timeoutMs = 15000): Promise<number | null> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Der Prozess hat sich nicht beendet')), timeoutMs)
    child.on('exit', (code: number | null) => {
      clearTimeout(timer)
      resolve(code)
    })
  })

// Startet den Server, ohne auf die Startmeldung zu warten, und sammelt seine Ausgabe. Für die
// Fälle, in denen der Start gerade nicht gelingen soll.
export function startServerRaw(dataDir: string, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: serverRoot,
    // CI hinter `...env`, wie in startServerIn: Kein Aufrufer kann es versehentlich abschalten.
    env: { ...process.env, NKA_UPDATE_URL: 'http://127.0.0.1:9/kein-internet-im-test', NKA_DATA_DIR: dataDir, ...env, CI: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (c: Buffer) => { output += c })
  child.stderr.on('data', (c: Buffer) => { output += c })
  return { child, out: () => output }
}

// ---------- Zweiter Start auf belegtem Port fasst die Daten nicht an (#244) ----------

// Lauschen auf einem freien Port zwischen 4200 und 4299, dem Bereich für Ports, die ein Test
// selbst festlegt: 3001 ist auf Arbeitsrechnern oft belegt, und dort laufen parallel weitere
// Prüfungen. Begonnen wird an einer zufälligen Stelle, damit zwei Läufe sich selten treffen.
export async function listenInTestRange(server: http.Server): Promise<number> {
  const offset = Math.floor(Math.random() * 100)
  for (let i = 0; i < 100; i++) {
    const port = 4200 + ((offset + i) % 100)
    const ok = await new Promise<boolean>((resolve) => {
      const onError = () => resolve(false)
      server.once('error', onError)
      server.listen(port, () => {
        server.off('error', onError)
        resolve(true)
      })
    })
    if (ok) return port
  }
  return assert.fail('zwischen 4200 und 4299 ist kein Port frei')
}

// ---------- Update-Hinweis ----------
// Die abgespeicherte echte Antwort der Releases-API, umgeschrieben auf eine höhere Version,
// damit der Hinweis anspringt.
export const releaseFixture = fs.readFileSync(path.join(serverRoot, 'test', 'fixtures', 'github-release-latest.json'), 'utf8')
export const releaseJson = releaseFixture.replaceAll(JSON.parse(releaseFixture).tag_name as string, 'v9.9.9')

export async function fakeGitHub() {
  const http = await import('node:http')
  const requests: (string | undefined)[] = []
  const server = http.createServer((req, res) => {
    requests.push(req.url)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(releaseJson)
  })
  await listening(server, '127.0.0.1')
  const url = `http://127.0.0.1:${portOf(server)}/repos/speedone/mietfuchs/releases/latest`
  return { url, requests, stop: () => server.close() }
}

export type Server = Awaited<ReturnType<typeof startServerIn>>
export type GitHub = Awaited<ReturnType<typeof fakeGitHub>>

// ---------- KI-Auswertung: Text und Seitenbilder kommen aus dem Browser (#21) ----------
// Der Server öffnet keine PDFs mehr selbst. Ollama ersetzt ein lokaler Server, der jede
// Anfrage mitschreibt und eine feste Antwort liefert.

export const LONG_TEXT =
  'Stadtwerke Musterstadt, Rechnung Nr. 4711 vom 15.03.2026. Frischwasser 12,50 EUR, Schmutzwasser 8,20 EUR. Gesamt 20,70 EUR.'

// Eine Antwort, die sich nicht an ihr Schema hält: Beträge deutsch als Text, einer fehlt ganz,
// einer ist gar keine Zahl, dazu ein erfundenes Feld und eines, das nur Mietfuchs selbst setzen
// darf. So antwortet ein kleines Modell auf dem eigenen Rechner, wenn der Dienst das Schema
// nicht durchsetzt, und das ist die Voreinstellung.
export const OFF_SCHEMA = {
  vendor: 'Stadtwerke Musterstadt',
  totalGrossEur: '1.234,56',
  invoiceNumber: 'R-4711',
  amountsAdjusted: 'netto',
  positions: [
    { description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: '12,50', labor35aEur: '4,20' },
    { description: 'Grundgebühr', category: 'Wasser/Abwasser' },
    { description: 'Schmutzwasser', category: 'Wasser/Abwasser', amountEur: 'siehe Anlage' },
  ],
}

// Antwortet wie Ollama 0.34: /api/tags listet die Modelle, /api/show nennt ihre Fähigkeiten,
// und ein unbekanntes Modell ergibt 404. Ohne `capabilities` verhält es sich wie eine ältere
// Ollama-Version, die das Feld noch nicht kennt. /api/chat streamt standardmäßig zeilenweise
// JSON (NDJSON), die letzte Zeile trägt `done: true`, den Grund und die Kennzahlen.
//
// `chat` schaltet Störungen der Auswertung: 'hang' schickt nie etwas, 'hangAfterFirstChunk'
// verstummt nach dem ersten Stück, 'length' endet am Kontextende mit halbem JSON, 'error'
// schickt mitten im Strom eine Fehlerzeile, 'rejectThinkOff' lehnt `think: false` ab wie
// manche Modelle bei Ollama Cloud, 'offSchema' antwortet an seinem Schema vorbei wie ein
// kleines Modell ohne erzwungenes JSON. Mit `key` verlangt der Dienst diesen Bearer-Schlüssel und
// antwortet sonst mit 401. `closedEarly` zählt Chat-Anfragen, deren Verbindung Mietfuchs vor
// dem Ende getrennt hat. `garbledShow` lässt /api/show mit einer nicht lesbaren Antwort
// antworten, die den Schlüssel enthält (Befund aus der Codeprüfung: readJson gab ihn ungeprüft
// weiter).
// Ein Modell, wie der nachgebaute Dienst es kennt (Ollamas /api/tags und /api/show).
// Heizung PR 20 (#103): Antworten des nachgebauten Dienstes für Messdienst- und Lieferantenrechnung,
// erkannt am Schema (`blocks` bzw. `parts`). Die Abzugszeile steht wie gedruckt mit Minus und als Text,
// dazu ein erfundenes Feld, das den Browser nicht erreichen darf.
export const FAKE_SERVICE = {
  vendor: 'Wärmedienst Beispiel GmbH', periodStart: '2025-01-01', periodEnd: '2025-12-31', unitsCount: 4, geheim: 'x',
  usersTotalEur: 3944.5, deductionEur: '-87,50', co2: { landlordPercent: 30, totalEur: 291.67, landlordEur: 87.5 }, dhwMethod: 'volumeFormula',
  blocks: [{ title: 'Heizung und Warmwasser', category: 'Heizung und Warmwasser', totalEur: 3944.5, lines: [{ label: 'Mustermann, Erika', amountEur: 1180.25, vacancy: false }] }],
}
export const FAKE_FUEL = { vendor: 'Stadtwerke Beispielstadt', totalGrossEur: 4067.8, quantityUnit: 'm³', parts: [] }

export type FakeModel = { name: string, size?: number, capabilities?: string[], remote_host?: string }
// Eine erfundene Rechnung für die Belegbuchung (#170). Das nachgebaute Ollama wählt sie, wenn ihr
// Kennwort im Text der Anfrage steht, und beantwortet den Durchgang der Kostenarten mit ihren.
export type FakeInvoice = {
  vendor: string
  invoiceDate?: string
  totalGrossEur?: number
  positions: { description: string, category: string, amountEur: number | null, labor35aEur?: number | null }[]
}
export type FakeOllamaOptions = {
  invoices?: Record<string, FakeInvoice>
  models?: FakeModel[]
  chat?: 'normal' | 'netto' | 'offSchema' | 'hang' | 'hangAfterFirstChunk' | 'length' | 'error' | 'rejectThinkOff' | 'meter'
  key?: string | null
  echoKey?: boolean
  garbledShow?: boolean
}

export async function fakeOllama({ models = [{ name: 'test:latest', capabilities: ['completion', 'vision'] }], chat = 'normal', key = null, echoKey = false, garbledShow = false, invoices }: FakeOllamaOptions = {}) {
  const http = await import('node:http')
  const requests: OllamaRequest[] = []
  const open = new Set<http.ServerResponse>()
  const state: { closedEarly: number, lastInvoice: FakeInvoice | null } = { closedEarly: 0, lastInvoice: null }
  // Steuert den nachgebauten Dienst während eines Tests, etwa für den Abbruch beim Laden. Fehler mit Ausweg (#487):
  // `docType` legt die Belegart fest, `meterFails` lässt das Ablesen scheitern, `tooMany` antwortet wie Ollama Cloud
  // mit aufgebrauchtem Kontingent (429).
  const control: { pullHangs: boolean, docType?: 'zaehlerstand' | 'rechnung', meterFails?: boolean, tooMany?: boolean } = { pullHangs: false }
  const findModel = (name = '') => models.find((m) => m.name === (name.includes(':') ? name : `${name}:latest`))
  const modelOf = (body: OllamaBody): string => body.model ?? ''
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => { body += d })
    req.on('end', () => {
      const json: OllamaBody = body ? JSON.parse(body) : {}
      requests.push({ url: req.url, body: json, headers: req.headers })
      const send = (status: number, data: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(data))
      }
      const notFound = () => send(404, { error: `model '${modelOf(json)}' not found` })
      if (req.url === '/api/version') return send(200, { version: '0.34.2' })
      if (key && req.headers.authorization !== `Bearer ${key}`) return send(401, { error: 'unauthorized' })
      if (echoKey) return send(400, { error: `Proxy lehnt ab: ${req.headers.authorization}` })
      if (req.url === '/api/tags') {
        return send(200, { models: models.map(({ capabilities, ...m }) => ({ size: 1000, ...m })) })
      }
      // Wie Ollama beim Laden eines Modells: zeilenweise JSON mit Schritt und Fortschritt.
      // `pullHangs` bleibt nach der ersten Zeile still, für den Abbruch.
      if (req.url === '/api/pull') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        open.add(res)
        res.on('close', () => { open.delete(res); if (!res.writableFinished) state.closedEarly++ })
        const line = (obj: unknown) => res.write(`${JSON.stringify(obj)}\n`)
        line({ status: 'pulling manifest' })
        if (control.pullHangs) return
        line({ status: 'pulling 4b2c1f', digest: '4b2c1f', total: 3_600_000_000, completed: 1_800_000_000 })
        line({ status: 'success' })
        return res.end()
      }
      if (req.url === '/api/show') {
        if (garbledShow) {
          res.writeHead(200, { 'content-type': 'text/plain' })
          return res.end(`kaputt: ${req.headers.authorization}`)
        }
        const m = findModel(modelOf(json))
        return m ? send(200, { capabilities: m.capabilities, remote_host: m.remote_host }) : notFound()
      }
      if (!findModel(modelOf(json))) return notFound()
      if (control.tooMany) return send(429, { error: 'you have reached your weekly usage limit' })
      if (control.meterFails && json.format?.properties?.meterNumber) return send(500, { error: 'model runner has unexpectedly stopped' })
      // Eine Rechnung mit Nettopositionen und dem Lohnanteil als Gesamtbetrag (#34)
      if (chat === 'netto' && !json.format?.properties?.categories) {
        const netto = {
          vendor: 'Schornsteinfegerei Muster',
          totalGrossEur: 101.86,
          positionsAreNet: true,
          vatRatePercent: 19,
          labor35aTotalEur: 90.56,
          positions: [
            { description: 'Feuerstättenschau', category: 'Schornsteinfeger', amountEur: 28.7 },
            { description: 'Kehren der Abgasleitung', category: 'Schornsteinfeger', amountEur: 24.8 },
            { description: 'Abgaswegeüberprüfung', category: 'Schornsteinfeger', amountEur: 22.6 },
            { description: 'Fahrtkostenpauschale', category: 'Schornsteinfeger', amountEur: 9.5 },
          ],
        }
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        res.write(`${JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(netto) }, done: false })}\n`)
        return res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 10, eval_count: 5 })}\n`)
      }
      if (chat === 'rejectThinkOff' && json.think === false) {
        return send(400, { error: `think value "false" is not supported for "${modelOf(json)}"` })
      }
      // Den zweiten Durchgang (nur Kategorien) erkennt man am Schema
      // 'meter': Das Foto ist ein Zählerstand (Schuhkarton der Schnellerfassung)
      // Belegbuchung (#170): die Rechnung, deren Kennwort in der Anfrage steht. Der Durchgang
      // der Kostenarten nennt die Positionen nicht beim Kennwort, er bekommt die zuletzt gewählte.
      const chosen = invoices ? Object.entries(invoices).find(([marker]) => JSON.stringify(json.messages ?? []).includes(marker))?.[1] : undefined
      if (chosen) state.lastInvoice = chosen
      const content = JSON.stringify(
        json.format?.properties?.blocks
          ? FAKE_SERVICE
          : json.format?.properties?.parts
            ? FAKE_FUEL
        : json.format?.properties?.docType
          ? { docType: control.docType ?? (chat === 'meter' ? 'zaehlerstand' : 'rechnung') }
          : json.format?.properties?.meterNumber
            ? { meterNumber: '4711', value: 123.4, dateOnImage: null }
        : json.format?.properties?.categories
          ? { categories: invoices && state.lastInvoice ? state.lastInvoice.positions.map((p) => p.category) : ['Wasser/Abwasser'] }
          : chosen
            ? chosen
            : chat === 'offSchema'
            ? OFF_SCHEMA
            : {
                vendor: 'Stadtwerke Musterstadt',
                positions: [{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 12.5 }],
                totalGrossEur: 12.5,
              },
      )
      const final = {
        message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop',
        total_duration: 3_000_000_000, load_duration: 500_000_000,
        prompt_eval_count: 812, prompt_eval_duration: 1_500_000_000, eval_count: 64, eval_duration: 1_000_000_000,
      }
      if (json.stream === false) return send(200, { ...final, message: { role: 'assistant', content } })

      open.add(res)
      res.on('close', () => {
        open.delete(res)
        if (!res.writableFinished) state.closedEarly++
      })
      if (chat === 'hang') return
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      const line = (obj: unknown) => res.write(`${JSON.stringify(obj)}\n`)
      const piece = (text: string) => ({ message: { role: 'assistant', content: text }, done: false })
      const third = Math.ceil(content.length / 3)
      line(piece(content.slice(0, third)))
      if (chat === 'hangAfterFirstChunk') return
      if (chat === 'error') {
        line({ error: 'model runner has unexpectedly stopped' })
        return res.end()
      }
      if (chat === 'length') {
        line({ ...final, done_reason: 'length' })
        return res.end()
      }
      line(piece(content.slice(third, 2 * third)))
      line(piece(content.slice(2 * third)))
      line(final)
      res.end()
    })
  })
  await listening(server, '127.0.0.1')
  return {
    url: `http://127.0.0.1:${portOf(server)}`,
    requests,
    control,
    get closedEarly() { return state.closedEarly },
    stop: () => {
      for (const res of open) res.destroy()
      server.close()
    },
  }
}

export type Ollama = Awaited<ReturnType<typeof fakeOllama>>
export type WithOllamaOptions = { models?: FakeModel[], model?: string, chat?: FakeOllamaOptions['chat'], env?: NodeJS.ProcessEnv, invoices?: Record<string, FakeInvoice> }

export async function withOllama(fn: (s: Server, ollama: Ollama) => Promise<void>, { models, model = 'test', chat, env = {}, invoices }: WithOllamaOptions = {}) {
  const ollama = await fakeOllama({ models, chat, invoices })
  const s = await startServerBeside(ollama, fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')), env)
  try {
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaUrl: ollama.url, ollamaModel: model }) })
    await fn(s, ollama)
  } finally {
    s.stop()
    ollama.stop()
  }
}

// Der Inhalt des PDFs spielt keine Rolle mehr: Der Server liest es nicht, er legt es nur ab.
export const PDF = Buffer.from('%PDF-1.4\n%Mietfuchs-Test\n')
export const page = (n: number) => new Blob([Buffer.from(`JPEG-Seite-${n}`)], { type: 'image/jpeg' })
export const base64 = (n: number) => Buffer.from(`JPEG-Seite-${n}`).toString('base64')

export async function uploadPdf(s: Server, route: string, { text, pages = [] }: { text?: string, pages?: Blob[] } = {}) {
  const fd = new FormData()
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'rechnung.pdf')
  if (text !== undefined) fd.append('pdfText', text)
  pages.forEach((b, i) => fd.append('pages', b, `seite-${i + 1}.jpg`))
  const res = await fetch(`${s.base}${route}`, { method: 'POST', body: fd })
  return { status: res.status, body: await jsonOf<UploadBody>(res) }
}

export const chatRequests = (ollama: Ollama) => ollama.requests.filter((a) => a.url === '/api/chat')
export const firstMessage = (ollama: Ollama): OllamaMessage => {
  const first = chatRequests(ollama)[0]
  if (!first) assert.fail('Ollama wurde gar nicht gefragt')
  return messageOf(first.body.messages)
}

// ---------- Ollama per Umgebungsvariable (#17) ----------
// Im Container oder bei zentraler Einrichtung legt der Betreiber Adresse und Modell fest.
// Die Einstellungen zeigen sie dann an, überschreiben sie aber nicht.

export async function withEnv(env: NodeJS.ProcessEnv, fn: (s: Server) => Promise<void>) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const s = await startServerIn(dataDir, env)
  try {
    await fn(s)
  } finally {
    s.stop()
  }
}

// Die Einstellungen, wie sie wirklich in der Datenbank stehen. Was die Oberfläche nur anzeigt
// (fixedByEnv, aiKeys, aiExternal), darf dort gerade nicht stehen, und deshalb ist hier bewusst
// nicht ClientSettings der Typ: Diese Felder bleiben optional, mehrere Tests prüfen ihr Fehlen.
export const storedSettings = async (s: { dataDir: string }): Promise<MigratedSettings> => {
  const settings = (await storedDb(s)).settings
  const { ai } = settings
  if (!ai) assert.fail('in der Datenbank fehlen die KI-Einstellungen')
  return { ...settings, ai }
}

// ---------- Ollama: Kontext und Nachdenken (#17) ----------
// Ohne Angabe nimmt Ollama auf den meisten Rechnern 4096 Token Kontext und kürzt längere
// Anfragen stillschweigend. Neuere Modelle denken außerdem standardmäßig erst lange nach,
// was auf dem Prozessor Minuten kostet. Beides legt Mietfuchs deshalb selbst fest.

export const chatOptions = (ollama: Ollama) => chatRequests(ollama).map((a) => ({ think: a.body.think, ...a.body.options }))

// ---------- Ollama: Streaming, Zeitlimit und Abbruch (#17) ----------
// Ohne Streaming schickt Ollama die Antwort-Header erst mit der fertigen Antwort, und fetch
// bricht unter Node wie unter Bun nach 300 Sekunden ohne Header ab. Mietfuchs streamt deshalb
// und spricht Ollama ohne diese Grenze an. Es gilt nur das eigene Zeitlimit, und das soll als
// solches gemeldet werden, nicht als „nicht erreichbar“.

export const until = async (condition: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (!condition()) {
    if (Date.now() > end) return false
    await new Promise((r) => setTimeout(r, 50))
  }
  return true
}

// ---------- KI-Auswertung als Strom zum Browser (#17) ----------

export const parseLine = (line: string): StreamLine => JSON.parse(line)

// ---------- Backup und Wiederherstellung (#23) ----------
// Ein Backup ist ein ZIP mit db.json und uploads/. Beim Zurückspielen darf ein fremdes oder
// kaputtes Archiv nie einen halb ersetzten Datenstand hinterlassen.

export async function restore(s: Server, zipBuffer: Buffer) {
  const fd = new FormData()
  fd.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'backup.zip')
  const res = await fetch(`${s.base}/api/restore`, { method: 'POST', body: fd })
  const contentType = res.headers.get('content-type') ?? ''
  return { status: res.status, contentType, body: contentType.includes('json') ? await jsonOf<{ error?: string }>(res) : { error: await res.text() } }
}

// Ein Archiv mit gültiger db.json und frei wählbaren weiteren Einträgen
// `db` ist der Inhalt der db.json im Archiv: ein Bestand, eine rohe Zeichenkette (fuer eine
// kaputte Datei) oder null (gar keine db.json).
export function archive(entries: Record<string, string | Buffer> = {}, db: unknown = { units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], settings: {} }): Buffer {
  const zip = new AdmZip()
  if (db !== null) zip.addFile('db.json', Buffer.from(typeof db === 'string' ? db : JSON.stringify(db)))
  for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(content))
  return zip.toBuffer()
}

// ---------- Die Routen lesen und schreiben die Datenbank (#55, Aufgabe 6) ----------
//
// Ab hier ist die Datenbank maßgeblich. Drei Zusagen hängen daran, und jede hat ihren Test: Was
// gespeichert wird, steht in der Datenbank; ein unbekanntes Feld kommt nicht an (#60); und ohne
// Datenbank gibt es keine Daten, also auch keine Antwort, die so tut, als gäbe es welche.

// Die Wohnungen, wie sie in der Datenbank stehen — an den Routen vorbei gelesen. Nur so lässt
// sich unterscheiden, ob eine Route wirklich dort geschrieben hat oder nur in der db.json.
export async function unitRowsInDatabase(dataDir: string): Promise<string[]> {
  const connection = await besideServer(dataDir)
  try {
    return connection.rows('SELECT id FROM units ORDER BY rowid').map((zeile) => String(zeile[0]))
  } finally {
    connection.close()
  }
}

// ---------- API-Schlüssel externer KI-Dienste (#18) ----------

export const putKey = (s: Server, body: { slot?: string, key?: string }) => fetch(`${s.base}/api/ai/key`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

// ---------- Anbieterwahl je Beleg (#18) ----------

// Speichert KI-Einstellungen über die Route, wie es die Oberfläche tut
export async function putAi(s: Server, change: Partial<AiSettings>) {
  const settings = await s.api<ClientSettings>('/api/settings')
  return s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ...settings, ai: { ...settings.ai, ...change } }) })
}

export const ollamaSlot = (url: string, model = 'test'): AiSlot => ({ provider: 'ollama', preset: 'ollama-remote', url, model, vision: null })
export const photoForm = () => {
  const fd = new FormData()
  fd.append('file', new Blob([Buffer.from('JPEG-Foto')], { type: 'image/jpeg' }), 'rechnung.jpg')
  return fd
}

// ---------- Bestätigung externer Dienste (#18) ----------
// 192.0.2.1 liegt im Dokumentationsnetz (RFC 5737): nicht privat, also extern, und nie
// erreichbar. So braucht der Test kein Internet.

export const EXTERNAL = 'http://192.0.2.1:11434'

// ---------- OpenAI-kompatible Dienste (#18) ----------
// Der nachgebaute Dienst antwortet wie die Chat-Completions-Schnittstelle: GET /v1/models und
// POST /v1/chat/completions als SSE-Strom. `rules` schaltet Eigenheiten echter Dienste ein, wie
// sie deren Dokumentation beschreibt:
//   rejectTemperature  lehnt temperature ab (neuere OpenAI-Modelle)
//   onlyMaxTokens      lehnt max_completion_tokens ab (Mistral, LM Studio)
//   rejectJsonSchema   kennt response_format json_schema nicht
//   rejectJsonObject   kennt response_format json_object nicht (LM Studio)
//   key                verlangt diesen Bearer-Schlüssel
//   errorFormat        'ionos' meldet Fehler als { messages: [{ errorCode, message }] }
//   busyOnce           antwortet einmal mit 429 und Retry-After
//   quota              meldet aufgebrauchtes Guthaben (429 insufficient_quota)
//   finish             Grund des Endes, etwa 'length'
//   whole              antwortet trotz stream: true am Stück als JSON
//   reasoning          schickt vor der Antwort Denktext
//   fenced             packt das JSON in einen Codeblock
//   hang               antwortet nie
//   echoKey            wiederholt den geschickten Schlüssel in einer Fehlermeldung
//   echoKeyInStream    wiederholt ihn in einem Fehler mitten im Strom (Status 200)
//   garbledStream      schickt ein nicht als JSON lesbares Ereignis, das den Schlüssel enthält
// Die Eigenheiten echter Dienste, die der nachgebaute auf Wunsch nachstellt (siehe oben).
export type OpenAiRules = {
  key?: string
  errorFormat?: 'ionos'
  busyOnce?: boolean
  quota?: boolean
  rejectTemperature?: boolean
  onlyMaxTokens?: boolean
  rejectJsonSchema?: boolean
  rejectJsonObject?: boolean
  finish?: string
  whole?: boolean
  reasoning?: boolean
  fenced?: boolean
  hang?: boolean
  echoKey?: boolean
  echoKeyInStream?: boolean
  garbledStream?: boolean
}

export async function fakeOpenAi(rules: OpenAiRules = {}) {
  const http = await import('node:http')
  const requests: OpenAiRequest[] = []
  const open = new Set<http.ServerResponse>()
  let busy = rules.busyOnce ? 1 : 0
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => { raw += d })
    req.on('end', () => {
      const body: OpenAiBody & { response_format?: { type?: string } } = raw ? JSON.parse(raw) : {}
      requests.push({ url: req.url, method: req.method, body, raw, headers: req.headers })
      const send = (status: number, data: unknown, headers: http.OutgoingHttpHeaders = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers })
        res.end(JSON.stringify(data))
      }
      const reject = (status: number, message: string, param: string | null, code = 'unsupported_parameter') =>
        rules.errorFormat === 'ionos'
          ? send(status, { httpStatus: status, messages: [{ errorCode: code, message }] })
          : send(status, { error: { message, type: 'invalid_request_error', param, code } })
      if (rules.key && req.headers.authorization !== `Bearer ${rules.key}`) return reject(401, 'Incorrect API key provided', null, 'invalid_api_key')
      if (rules.echoKey) return reject(400, `Invalid request for credentials ${req.headers.authorization}`, null, 'invalid_request')
      if (req.method === 'GET' && req.url === '/v1/models') {
        return send(200, { object: 'list', data: [{ id: 'modell-b', object: 'model' }, { id: 'modell-a', object: 'model', capabilities: { vision: true } }] })
      }
      if (req.url !== '/v1/chat/completions') return send(404, { error: { message: 'Not found' } })
      if (busy > 0) {
        busy -= 1
        return send(429, { error: { message: 'Rate limit reached for requests', code: 'rate_limit_exceeded' } }, { 'retry-after': '1' })
      }
      if (rules.quota) return send(429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } })
      if (rules.rejectTemperature && body.temperature !== undefined) {
        return reject(400, "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.", 'temperature', 'unsupported_value')
      }
      if (rules.onlyMaxTokens && body.max_completion_tokens !== undefined) return reject(400, 'Unrecognized request argument supplied: max_completion_tokens', 'max_completion_tokens')
      if (rules.rejectJsonSchema && body.response_format?.type === 'json_schema') {
        return reject(400, "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model.", 'response_format')
      }
      if (rules.rejectJsonObject && body.response_format?.type === 'json_object') return send(400, { error: "'response_format.type' must be 'json_schema'" })
      if (body.model !== 'modell-a') return reject(404, `The model '${body.model}' does not exist or you do not have access to it.`, 'model', 'model_not_found')
      open.add(res)
      res.on('close', () => open.delete(res))
      if (rules.hang) return
      if (rules.echoKeyInStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ error: { message: `Ungültige Anmeldung mit ${req.headers.authorization}` } })}

`)
        return res.end()
      }
      // Ein Ereignis, das sich nicht als JSON lesen lässt und den Schlüssel enthält (Befund aus
      // der Codeprüfung: handleEvent gab ihn ungeprüft weiter)
      if (rules.garbledStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`data: kaputt: ${req.headers.authorization}\n\n`)
        return res.end()
      }
      // Den zweiten Durchgang (nur Kategorien) erkennt man an Schema oder Prompt
      const answer = JSON.stringify(
        raw.includes('categories')
          ? { categories: ['Wasser/Abwasser'] }
          : { vendor: 'Stadtwerke Musterstadt', positions: [{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 12.5 }], totalGrossEur: 12.5 },
      )
      const fence = '```'
      const content = rules.fenced ? `${fence}json\n${answer}\n${fence}` : answer
      const usage = { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 }
      if (rules.whole) return send(200, { choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const event = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`)
      if (rules.reasoning) event({ choices: [{ index: 0, delta: { reasoning_content: 'Ich rechne die Summe nach.' } }] })
      const half = Math.ceil(content.length / 2)
      event({ choices: [{ index: 0, delta: { role: 'assistant', content: content.slice(0, half) }, finish_reason: null }] })
      event({ choices: [{ index: 0, delta: { content: content.slice(half) }, finish_reason: null }] })
      event({ choices: [{ index: 0, delta: {}, finish_reason: rules.finish ?? 'stop' }] })
      if (body.stream_options?.include_usage) event({ choices: [], usage })
      res.end('data: [DONE]\n\n')
    })
  })
  await listening(server, '127.0.0.1')
  return {
    url: `http://127.0.0.1:${portOf(server)}/v1`,
    requests,
    completions: () => requests.filter((r) => r.url === '/v1/chat/completions'),
    stop: () => {
      for (const res of open) res.destroy()
      server.close()
    },
  }
}

export type OpenAiService = Awaited<ReturnType<typeof fakeOpenAi>>
export type WithOpenAiOptions = {
  rules?: OpenAiRules
  preset?: string
  model?: string
  vision?: boolean | null
  key?: string | null
  ai?: Partial<AiSettings>
  env?: NodeJS.ProcessEnv
}

// ---------- Objekte (#92) ----------
// Jeder Test mit zwei Objekten bekommt seinen eigenen Server: Ein zweites Objekt im geteilten
// Server machte jede Anfrage ohne `property` der übrigen Tests zu einer 400.

export async function withProperties(fn: (s: Server, b: Property) => Promise<void>) {
  const s = await startServer()
  try {
    const b = await s.api<Property>('/api/properties', { method: 'POST', body: JSON.stringify({ name: 'Gartenweg 3', kind: 'etw' }) })
    await fn(s, b)
  } finally {
    s.stop()
  }
}

// Eine Datenbank, wie sie ein Nutzer von v0.8.0 im Backup hat: Stand 0000 mit Bestand.
export async function databaseOfV080(settlementYear: number): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-v080-'))
  try {
    const file = path.join(dir, 'mietfuchs.sqlite')
    const connection = await connect(file)
    const migrations = await loadMigrations()
    applyMigrations(connection, migrations.slice(0, 1))
    await writeStock(connection.db, straightenForDatabase(migrateLegacy({
      settings: { houseName: 'Lindenstraße 7', address: '12345 Stadt', landlordName: 'Erika', iban: 'DE01', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' },
      units: [{ id: 'u1', name: 'EG', areaM2: 60, participates: true }, { id: 'u2', name: 'OG', areaM2: 40, participates: true }],
      tenancies: [],
      costItems: [{ id: 'c1', year: settlementYear, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 100000, key: 'area' }],
      meters: [], readings: [], payments: [], closedSettlements: [],
    })))
    connection.close()
    return fs.readFileSync(file)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// ---------- Sicherung vor dem Update anzeigen (#154) ----------

// Eine Datenbank auf dem Stand von v0.8.0 (nur Schritt 0000) in einem Wegwerf-Ordner.
export async function dataDirAtBaseline(): Promise<string> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const connection = await connect(path.join(dataDir, 'mietfuchs.sqlite'))
  try {
    applyMigrations(connection, (await loadMigrations()).slice(0, 1))
  } finally {
    connection.close()
  }
  return dataDir
}

// ---------- Belegordner (#170) ----------

export async function uploadBelegFile(s: Server, content: string | Buffer, name: string, fields: Record<string, string> = {}): Promise<string> {
  const fd = new FormData()
  fd.append('file', new Blob([Buffer.from(content)], { type: name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' }), name)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  const res = await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })
  assert.equal(res.status, 200, await res.clone().text())
  return fileOf(await jsonOf<UploadBody>(res))
}

// ---------- Belegbuchung (#170): die Routen ----------

export const RECHNUNGEN: Record<string, FakeInvoice> = {
  GRUNDSTEUER: { vendor: 'Stadt Musterstadt', invoiceDate: '2025-02-15', totalGrossEur: 612.4, positions: [{ description: 'Grundsteuer B 2025', category: 'Grundsteuer', amountEur: 612.4 }] },
  WASSER: {
    vendor: 'Stadtwerke Musterstadt', invoiceDate: '2026-02-01', totalGrossEur: 1500,
    positions: [{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 700 }, { description: 'Abwasser', category: 'Wasser/Abwasser', amountEur: 800 }],
  },
  // Weder Rechnungsdatum noch Leistungszeitraum: Das Jahr der Auswertung kommt aus dem Formular.
  HAUSMEISTER: { vendor: 'Hausmeisterdienst Muster', totalGrossEur: 300, positions: [{ description: 'Hausmeisterdienst', category: 'Hauswart', amountEur: 300 }] },
  NACHTRAG: { vendor: 'Stadtwerke Musterstadt', invoiceDate: '2026-03-01', totalGrossEur: 120, positions: [{ description: 'Nachberechnung Abwasser', category: 'Wasser/Abwasser', amountEur: 120 }] },
  MUELL: {
    vendor: 'Abfallwirtschaft Musterkreis', invoiceDate: '2026-12-15', totalGrossEur: 650,
    positions: [{ description: 'Restmüll', category: 'Müllabfuhr', amountEur: 700 }, { description: 'Gutschrift Tonnentausch', category: 'Müllabfuhr', amountEur: -50 }],
  },
  GARTEN: { vendor: 'Gärtnerei Grün', invoiceDate: '2026-11-30', totalGrossEur: 1450, positions: [{ description: 'Gartenpflege Saison', category: 'Gartenpflege', amountEur: 1450, labor35aEur: null }] },
  // Rechnungsdatum im Februar, kein Leistungszeitraum: Das Jahr aus dem Beleg ist das Folgejahr der Leistung.
  VORJAHR: { vendor: 'Hausmeisterdienst Muster', invoiceDate: '2025-02-10', totalGrossEur: 300, positions: [{ description: 'Hausmeisterdienst', category: 'Hauswart', amountEur: 300 }] },
}

export type Evaluated = { file: string, assessment: AssessmentView | null }
// Lang genug für eine Textebene (unter 80 Zeichen gälte das PDF als Scan ohne Text).
export const invoiceText = (marker: string): string => `Rechnung ${marker}: Positionen wie aufgeführt, Betrag in Euro, zahlbar binnen 14 Tagen.`

// Wie der Browser: ein PDF mit Textebene an /api/extract, ohne Strom. `marker` wählt die Rechnung.
export async function evaluate(s: Server, marker: string, extra: Record<string, string> = {}): Promise<Evaluated> {
  const fd = new FormData()
  // Mit `existingFile` wertet der Server einen Beleg aus dem Posteingang aus, statt einen neuen anzunehmen.
  // Der Inhalt hängt an der Rechnung: gleiche Bytes ergäben gleiche Prüfsummen, und ein zweiter Beleg gälte als doppelt.
  if (!extra.existingFile) fd.append('file', new Blob([PDF, `%${marker}\n`], { type: 'application/pdf' }), `${marker.toLowerCase()}.pdf`)
  fd.append('pdfText', invoiceText(marker))
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: fd })
  assert.equal(res.status, 200, await res.clone().text())
  return jsonOf<Evaluated>(res)
}
export const postJson = (s: Server, urlPath: string, body: unknown): Promise<Response> =>
  fetch(`${s.base}${urlPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
export const assessmentOf = (e: Evaluated): AssessmentView => e.assessment ?? assert.fail('keine Auswertung gespeichert')
export const grundsteuer = (a: AssessmentView): LineDecision[] =>
  [{ idx: 0, action: 'create', fields: a.lines[0]?.suggestion?.fields ?? assert.fail('kein Vorschlag') }]

// ---------- Belegbuchung (#170): Befunde der Durchsicht zu Task 4 ----------

export const putJson = (s: Server, urlPath: string, body: unknown): Promise<Response> =>
  fetch(`${s.base}${urlPath}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
export async function bookGrundsteuer(s: Server, a: AssessmentView): Promise<void> {
  const decisions = grundsteuer(a)
  const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
  assert.equal((await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })).status, 200)
}

// Ein Abbruch, der nach der Antwort der KI und vor dem Speichern ankommt. Herbeigeführt mit dem
// Testgriff NKA_TEST_ASSESSMENT_DELAY_MS: Der Server wartet vor dem Speichern, und in diese Pause
// fällt der Abbruch über die Kennung. Gewartet wird, bis der Durchgang der Kostenarten (die letzte
// Anfrage an die KI) beantwortet ist.
export const PAUSE_MS = 2500

// ---------- Integrationsdurchsicht des Stapels #174 → #175 → #184 ----------

// Durchsicht von #226 (I1, M2, M4): das Jahr der Zahlung beim Wechsel des Rhythmus, und die Marke der
// Vorschau.
export type Vorschau = { token: string; taxYears: { key: string; costItemId: string; suggested: number; options: number[] }[]; keptTaxYears: { costItemId: string; period: string; taxYear: number }[] }
export const wechsel = async (s: { base: string }, id: string, body: unknown) =>
  fetch(`${s.base}/api/properties/${id}/period`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

