// Die Datenbank öffnen, mit allem, was beim Start geprüft werden muss (#55).
//
// Der Transport steht in client.ts: Er weiß, wie man eine SQLite-Datei erreicht und wie
// Migrationen angewendet werden. Hier steht, was drumherum passieren muss, bevor irgendjemand
// auf diese Datei schreibt: Ist der Ordner beschreibbar? Gelten die Fremdschlüssel wirklich?
// Ist die Datei unversehrt? Stammt sie aus einer neueren Mietfuchs-Version? Und liegt sie auf
// einem Netzlaufwerk, auf dem SQLite nicht zu Hause ist?
//
// **Alle Meldungen dieser Datei lesen Vermieter ohne technische Vorkenntnisse.** Jede sagt
// deshalb, was los ist und was zu tun ist. Eine Meldung von SQLite wird nie unverändert
// weitergereicht; wo sie beim Nachfragen hilft, steht sie am Ende als „Technischer Befund“.
//
// Noch werden hier keine fachlichen Daten gelesen oder geschrieben. Geöffnet wird trotzdem
// schon beim Start, und das ist Absicht: Erst dadurch landen Drizzle und das eingebaute SQLite
// in der Bun-Programmdatei, und erst dadurch sagen die Prüfläufe etwas über den Weg, den ein
// Vermieter tatsächlich geht. Scheitert das Öffnen, läuft der Server an diesem Stand weiter
// (siehe index.ts); ab dem Umstieg der Bestände kehrt sich das um.

import fs from 'node:fs'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { applyMigrations, connect, loadMigrations, type Connection, type Database, type Migration } from './client.ts'
import { writable } from '../paths.ts'
import { APP_VERSION } from '../version.ts'

// Der Name ist bewusst sprechend: Wer den Datenordner öffnet, soll die Datei erkennen, ohne zu
// raten, und sie beim Sichern nicht übersehen.
export const DB_FILE_NAME = 'mietfuchs.sqlite'

export const databaseFile = (dataDir: string): string => path.join(dataDir, DB_FILE_NAME)

// ---------- Schritt 6: die Reihung der Schreibvorgänge ----------

// Express bedient nebenläufig, und alle Anfragen teilen sich **eine** Verbindung zu SQLite.
// Eine Transaktion mit asynchronem Rumpf gibt zwischen ihren Anweisungen die Kontrolle ab; eine
// zweite Anfrage beginnt dann mitten hinein ihre eigene Transaktion. Zwei Ausgänge hat das, und
// beide treffen den Nutzer bei einer ganz gewöhnlichen Eingabe:
//
//   1. SQLite lehnt das zweite `begin` ab („cannot start a transaction within a transaction“).
//      Die zweite Anfrage scheitert, obwohl an ihr nichts falsch war.
//   2. Schlimmer, und deshalb laufen **alle** Schreibvorgänge hier durch und nicht nur die
//      Transaktionen: Ein gewöhnliches Einfügen, das währenddessen hereinkommt, landet
//      unbemerkt **innerhalb** der fremden Transaktion. Bricht die ab, verschwindet es mit ihr,
//      nachdem seine Anfrage längst mit „gespeichert“ geantwortet hat. Nachgemessen: Der
//      Datensatz war weg, und keine Zeile Ausgabe wies darauf hin.
//
// Beides tritt nur auf, wenn zwei Dinge gleichzeitig geschehen, also selten und beim Nachstellen
// meist gar nicht. Die Abhilfe ist eine Schlange: Ein Schreibvorgang beginnt erst, wenn der
// vorige ganz fertig ist.
export type WriteQueue = <T>(work: () => Promise<T>) => Promise<T>

const NESTED =
  'Ein Schreibvorgang hat innerhalb eines Schreibvorgangs einen weiteren begonnen. Das ist ein ' +
  'Fehler in Mietfuchs und keiner in den Daten: Der innere wartet darauf, dass der äußere fertig ' +
  'wird, und der äußere auf den inneren, sodass die Anfrage für immer hinge. Bitte melden Sie ' +
  'diesen Fehler; Ihre Daten sind unverändert.'

export function createWriteQueue(): WriteQueue {
  // Woran ein verschachtelter Aufruf erkannt wird. Ein einfaches „läuft gerade“ genügte nicht:
  // Das wäre auch für eine zweite Anfrage wahr, und die soll ja gerade warten dürfen. Der
  // Speicher von AsyncLocalStorage gilt nur innerhalb eines Vorgangs und über seine await
  // hinweg, unterscheidet also genau die beiden Fälle.
  const inside = new AsyncLocalStorage<boolean>()
  // Das Ende der Schlange. Es wird nie abgelehnt: Ein gescheiterter Schreibvorgang darf die
  // folgenden nicht mitreißen, sonst brächte ein einzelner Fehler die ganze Sitzung zum Erliegen.
  let tail: Promise<void> = Promise.resolve()
  return <T>(work: () => Promise<T>): Promise<T> => {
    if (inside.getStore()) return Promise.reject(new Error(NESTED))
    const result = tail.then(() => inside.run(true, work))
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

// ---------- Schritt 3: ist die Datei unversehrt? ----------

// SQLite antwortet auf `PRAGMA integrity_check` mit genau einer Zeile „ok“ oder mit einer Zeile
// je Befund. Beides wird hier gelesen; ein Ergebnis, das weder das eine noch das andere ist,
// gilt als Befund und nicht als Unbedenklichkeit.
export function integrityProblem(rows: unknown[][]): string | null {
  const befunde = rows.map((row) => String(row[0]))
  if (befunde.length === 1 && befunde[0] === 'ok') return null
  if (befunde.length === 0) return 'Die Prüfung der Datei hat gar nicht geantwortet.'
  const gezeigt = befunde.slice(0, 3).join('; ')
  return befunde.length > 3 ? `${gezeigt} und ${befunde.length - 3} weitere` : gezeigt
}

// Die Meldung für eine Datei, die sich nicht lesen lässt. Bewusst überall dieselbe: Ob SQLite
// beim Öffnen abbricht, ob es eine fremde Datei ist oder ob die Unversehrtheitsprüfung etwas
// findet, ändert für den Vermieter nichts an dem, was zu tun ist.
//
// Angefasst wird die Datei dabei nicht. Sie beiseitezulegen und eine frische anzulegen wäre
// heute harmlos, weil noch nichts darin steht, aber genau das ist nicht zu wissen: Wer eine
// neuere Fassung benutzt hat und dann wieder diese startet, hat darin bereits alles stehen
// (siehe die Prüfung der Schemaversion unten). Eine Regel, die Daten wegräumt, wenn sie sie für
// wertlos hält, ist die eine Regel, die hier nicht stehen darf.
const damaged = (file: string, befund: string): string =>
  `Die Datenbankdatei ${file} ist beschädigt und wird deshalb nicht geöffnet. Mietfuchs verändert ` +
  `nichts daran. Am sichersten ist es, ein Backup dieser Datei an ihre Stelle zu kopieren. Gibt ` +
  `es keines und ist der Verlust hinnehmbar, benennen Sie die Datei um (nicht löschen, falls sich ` +
  `doch noch etwas retten lässt); beim nächsten Start legt Mietfuchs eine neue an. ` +
  `Technischer Befund: ${befund}`

// ---------- Schritt 4: stammt die Datei aus einer neueren Version? ----------

type AppliedStep = { hash: string, createdAt: number }

// Was in dieser Datei schon an Änderungen am Aufbau gelaufen ist. Die Buchführung fehlt bei
// einer frisch angelegten Datei, und das ist kein Fehler, sondern der Normalfall beim ersten
// Start.
function appliedSteps(connection: Connection): AppliedStep[] {
  const vorhanden = connection.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
  if (vorhanden.length === 0) return []
  return connection.rows('SELECT hash, created_at FROM __drizzle_migrations').map((row) => ({
    hash: String(row[0]),
    createdAt: Number(row[1]),
  }))
}

// Ein Datum, das auf einer Rechnung stehen könnte, und keine Zeitmarke. Von Hand gesetzt statt
// über die Ländereinstellungen: Die hängen davon ab, was auf dem Rechner installiert ist, und
// eine Meldung soll überall gleich aussehen.
function germanDate(millis: number): string {
  // Der Wert kommt aus einer Datei, für die wir nichts können. Außerhalb dieses Bereichs kennt
  // JavaScript kein Datum, und `toISOString` würde werfen — mitten in einer Meldung, die gerade
  // erklären soll, was los ist.
  if (!Number.isFinite(millis) || Math.abs(millis) > 8.64e15) return 'unbekannt'
  const iso = new Date(millis).toISOString().slice(0, 10).split('-')
  return `${iso[2]}.${iso[1]}.${iso[0]}`
}

// Enthält die Datei Änderungen am Aufbau, die dieses Programm nicht kennt, dann hat eine neuere
// Mietfuchs-Version darauf gearbeitet. Dann wird sie weder geöffnet noch migriert: Unsere
// Schritte auf einen neueren Aufbau anzuwenden hieße, gegen einen Stand zu arbeiten, den wir
// nicht kennen, und am Ende stünde ein Bestand, den keine der beiden Versionen mehr lesen kann.
function newerVersionProblem(file: string, applied: AppliedStep[], known: Migration[]): string | null {
  const bekannt = new Set(known.map((m) => m.hash))
  const fremd = applied.filter((step) => !bekannt.has(step.hash))
  if (fremd.length === 0) return null
  const juengste = Math.max(...fremd.map((step) => step.createdAt))
  return (
    `Die Datenbank ${file} stammt aus einer neueren Mietfuchs-Version. Sie enthält ` +
    `${fremd.length === 1 ? 'eine Änderung' : `${fremd.length} Änderungen`} am Aufbau, die diese ` +
    `Version (${APP_VERSION}) nicht kennt, die jüngste vom ${germanDate(juengste)}. Mietfuchs ` +
    `öffnet sie deshalb nicht und verändert nichts daran, damit nichts verlorengeht. Bitte ` +
    `benutzen Sie wieder die neuere Fassung; sie kann diesen Datenbestand lesen. Wollen Sie ` +
    `bewusst bei dieser Version bleiben, spielen Sie ein Backup von vor dem Wechsel zurück.`
  )
}

// ---------- Schritt 5: liegt die Datei auf einem Netzlaufwerk? ----------

// Dateisysteme über das Netz. SQLite verlässt sich auf Dateisperren, und die täuschen diese
// Systeme regelmäßig nur vor; das Ergebnis reicht von „Datenbank ist gesperrt“ bis zu einer
// beschädigten Datei. Aufgeführt ist, was in `/proc/self/mounts` als Typ auftaucht.
const NETWORK_FILESYSTEMS = new Set([
  'nfs', 'nfs4', 'cifs', 'smbfs', 'smb3', 'afpfs', 'ncpfs', '9p', 'afs', 'ceph', 'glusterfs',
  'lustre', 'beegfs', 'davfs', 'fuse.sshfs', 'fuse.davfs', 'fuse.rclone', 'fuse.glusterfs',
  'fuse.s3fs', 'fuse.gvfsd-fuse',
])

type NetworkOptions = {
  platform?: NodeJS.Platform
  // Der Inhalt von /proc/self/mounts. Hineingereicht, damit der Test die Tabelle stellen kann,
  // ohne dass dafür irgendwo etwas eingehängt sein muss.
  mounts?: () => string | null
}

function readMounts(): string | null {
  try {
    return fs.readFileSync('/proc/self/mounts', 'utf8')
  } catch {
    return null // kein Linux oder kein /proc: dann gibt es hier nichts zu erkennen
  }
}

// `/proc/self/mounts` schreibt Leerzeichen und einige andere Zeichen im Pfad oktal aus.
const unescapeMount = (value: string): string =>
  value.replace(/\\(\d{3})/g, (_, oktal: string) => String.fromCharCode(Number.parseInt(oktal, 8)))

// Ein UNC-Pfad ist unter Windows der sichere Fall: `\\nas\daten\...`. Ein verbundenes
// Netzlaufwerk (Z:) sieht dagegen aus wie eine Platte und lässt sich ohne fremdes Programm
// nicht davon unterscheiden; dort bleibt der Hinweis aus.
function uncShare(file: string): string | null {
  const p = file.replace(/\//g, '\\')
  // Die lange Schreibweise: \\?\UNC\server\freigabe
  const lang = /^\\\\[?.]\\UNC\\([^\\]+)\\([^\\]+)/i.exec(p)
  if (lang) return `\\\\${lang[1]}\\${lang[2]}`
  // \\?\C:\… ist dieselbe Platte, nur anders geschrieben.
  if (/^\\\\[?.]\\/.test(p)) return null
  const kurz = /^\\\\([^\\]+)\\([^\\]+)/.exec(p)
  return kurz ? `\\\\${kurz[1]}\\${kurz[2]}` : null
}

// Liegt die Datei auf einem Netzlaufwerk? Liefert eine kurze Beschreibung oder null.
//
// Was hier nicht erkannt wird, steht im Bericht zu Aufgabe 3: ein verbundenes Netzlaufwerk unter
// Windows, jedes eingebundene Netzlaufwerk unter macOS (dort gibt es kein /proc, und der Typ
// eines Dateisystems ist ohne fremdes Programm nicht zu erfragen) und die Freigaben einer
// virtuellen Maschine. Der Hinweis bleibt dann aus; falsch gewarnt wird niemand.
export function networkLocation(file: string, options: NetworkOptions = {}): string | null {
  const platform = options.platform ?? process.platform
  if (platform === 'win32') return uncShare(file)
  if (platform !== 'linux') return null
  const text = (options.mounts ?? readMounts)()
  if (!text) return null
  // Der Pfad kommt in der Schreibweise des laufenden Rechners; die Einhängepunkte stehen mit
  // Schrägstrich da. Umgestellt wird nur, wenn dieser Rechner Gegenschrägstriche benutzt, damit
  // unter Linux ein Dateiname mit Gegenschrägstrich unangetastet bleibt.
  const gesucht = path.sep === '\\' ? file.replace(/\\/g, '/') : file
  let treffer: { point: string, type: string, device: string } | null = null
  for (const line of text.split('\n')) {
    const [device, point, type] = line.split(' ')
    if (!device || !point || !type) continue
    const dir = unescapeMount(point)
    // Der Einhängepunkt muss ein Ordner im Pfad sein und nicht bloß sein Anfang: /mnt/nase
    // liegt nicht in /mnt/nas.
    if (dir !== '/' && !gesucht.startsWith(dir.endsWith('/') ? dir : `${dir}/`)) continue
    // Der längste passende Einhängepunkt gewinnt, sonst träfe immer „/“ zu.
    if (!treffer || dir.length > treffer.point.length) treffer = { point: dir, type, device: unescapeMount(device) }
  }
  if (!treffer || !NETWORK_FILESYSTEMS.has(treffer.type)) return null
  return `${treffer.type} auf ${treffer.device}`
}

const networkWarning = (beschreibung: string): string =>
  `Der Datenordner liegt auf einem Netzlaufwerk (${beschreibung}). Mietfuchs legt seine Datenbank ` +
  `dort ab, und Netzlaufwerke täuschen die Dateisperren, auf die sich eine Datenbank verlässt, ` +
  `häufig nur vor; im schlechtesten Fall wird die Datei dabei beschädigt. Es kann gutgehen, ` +
  `sicher ist es nicht. Besser liegen die Daten auf der eingebauten Festplatte ` +
  `(Umgebungsvariable NKA_DATA_DIR), und das Netzlaufwerk bekommt regelmäßig ein Backup davon.`

// ---------- Öffnen ----------

export type OpenedDatabase = {
  db: Database
  file: string
  // Wie viele Änderungen am Aufbau dieser Start nachgeholt hat. Beim ersten Start sind es alle,
  // danach in aller Regel keine.
  migrations: number
  // Was zwar zu sagen, aber kein Grund zum Abbruch ist. Der Aufrufer gibt sie aus.
  warnings: string[]
  // Der einzige Weg zu einem Schreibvorgang. Siehe die Begründung bei createWriteQueue.
  write: <T>(work: (db: Database) => Promise<T>) => Promise<T>
  close: () => void
}

export type OpenOptions = {
  dataDir: string
  // Hineingereicht für den Test: ein wirklich gesperrter Ordner lässt sich unter Windows nicht
  // herstellen.
  canWrite?: (dir: string) => boolean
} & NetworkOptions

export async function openDatabase(options: OpenOptions): Promise<OpenedDatabase> {
  const { dataDir, canWrite = writable } = options
  const file = databaseFile(dataDir)

  // Schritt 5 zuerst, denn die Antwort hängt nur am Pfad, und sie gehört auch an jede Meldung,
  // die gleich folgen könnte: Ein Netzlaufwerk ist die wahrscheinlichste Erklärung dafür, dass
  // eine SQLite-Datei beschädigt ist. Wer nur „beschädigt“ liest, kopiert ein Backup an
  // dieselbe Stelle und steht bald wieder davor.
  const warnings: string[] = []
  const network = networkLocation(file, options)
  if (network) warnings.push(networkWarning(network))

  // Jede Meldung dieser Funktion nimmt die Hinweise mit. Der Typ steht ausdrücklich an der
  // Konstanten und nicht nur am Rumpf: Nur so weiß der Übersetzer, dass es hinter einem Aufruf
  // nicht weitergeht, und hält den folgenden Code für unerreichbar.
  const fail: (text: string, cause?: unknown) => never = (text, cause) => {
    throw new Error([text, ...warnings].join('\n'), cause === undefined ? undefined : { cause })
  }

  // Schritt 1: früh und verständlich scheitern, nicht erst beim ersten Speichern. Dieselbe
  // Frage stellt schon chooseDataDir in store.ts, und sie wird hier mit derselben Funktion
  // beantwortet.
  if (!canWrite(dataDir)) {
    fail(
      `In den Datenordner ${dataDir} lässt sich nicht schreiben. Dort legt Mietfuchs seine Daten ab, ` +
        `und ohne Schreibrecht kann es gar nicht erst anfangen. Bitte geben Sie den Ordner zum ` +
        `Schreiben frei oder wählen Sie mit der Umgebungsvariablen NKA_DATA_DIR einen anderen.`,
    )
  }
  fs.mkdirSync(dataDir, { recursive: true })

  const vorhanden = fs.existsSync(file)
  let connection: Connection
  try {
    connection = await connect(file)
  } catch (err) {
    // Eine Datei, die es gibt, die SQLite aber nicht öffnen kann, ist für den Vermieter
    // dasselbe wie eine beschädigte. Gibt es sie noch nicht, liegt es am Ordner.
    return fail(
      vorhanden
        ? damaged(file, messageOf(err))
        : `Die Datenbank ${file} ließ sich nicht anlegen. Bitte prüfen Sie, ob der Ordner ` +
          `beschreibbar ist, oder wählen Sie mit NKA_DATA_DIR einen anderen. Technischer Befund: ${messageOf(err)}`,
      err,
    )
  }

  try {
    // Schritt 2: Fremdschlüssel gelten je Verbindung, und SQLite liefert sie abgeschaltet aus.
    // connect() schaltet sie ein; hier wird nachgesehen, dass es wirklich so ist. Eine
    // Voreinstellung einer Laufzeit kann sich ändern, und ohne diese Prüfung wäre die erste
    // Nachricht davon ein verwaister Datensatz in der Abrechnung eines Vermieters.
    const fk = connection.rows('PRAGMA foreign_keys')
    if (Number(fk[0]?.[0]) !== 1) {
      fail(
        'Die Datenbank hat die Prüfung der Verweise zwischen den Tabellen nicht eingeschaltet. ' +
          'Ohne sie könnten Ablesungen ohne Zähler oder Mietverhältnisse ohne Wohnung entstehen, ' +
          'die in keiner Abrechnung mehr auftauchen. Mietfuchs arbeitet deshalb nicht damit.',
      )
    }

    // Schritt 3: eine beschädigte Datei soll auffallen, bevor jemand darauf weiterarbeitet.
    // Bei einer schwer beschädigten Datei antwortet SQLite gar nicht, sondern bricht ab; beide
    // Ausgänge führen hier zur selben Meldung.
    let befund: string | null
    try {
      befund = integrityProblem(connection.rows('PRAGMA integrity_check'))
    } catch (err) {
      befund = messageOf(err)
    }
    if (befund !== null) fail(damaged(file, befund))

    // Schritt 4: eine Datei aus einer neueren Version wird erklärt, nicht migriert.
    const migrations = await loadMigrations()
    const problem = newerVersionProblem(file, appliedSteps(connection), migrations)
    if (problem) fail(problem)

    const applied = applyMigrations(connection, migrations)
    const queue = createWriteQueue()
    return {
      db: connection.db,
      file,
      migrations: applied,
      warnings,
      write: (work) => queue(() => work(connection.db)),
      close: connection.close,
    }
  } catch (err) {
    // Eine offene Verbindung zu einer Datei, mit der wir nicht arbeiten, hält unter Windows nur
    // deren Sperre — und genau die bräuchte, wer die Datei jetzt austauschen will.
    connection.close()
    throw err
  }
}

// Die Meldung eines geworfenen Fehlers. In einem catch ist er `unknown`: Wer wirft, bestimmt,
// was ankommt. Dieselbe Überlegung wie in index.ts, hier noch einmal, weil diese Datei vom
// Server nichts weiß.
function messageOf(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message) {
    return err.message
  }
  return String(err)
}
