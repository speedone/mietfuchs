// Der einmalige Umstieg der vorhandenen Daten in die Datenbank (#55).
//
// **Er läuft beim ersten Start der neuen Version von selbst.** Niemand soll einen Befehl
// eingeben müssen, um an seine eigenen Daten zu kommen.
//
// Zwei Zusagen bestimmen jeden Schritt hier, und wo sie sich widersprechen, gewinnt die zweite:
//
//   1. Gelingt der Umstieg, liegen die Daten danach in der Datenbank, und zwar vollständig.
//   2. **Der Nutzer ist nie blockiert und verliert nie Daten.** Scheitert irgendetwas, arbeitet
//      Mietfuchs mit der db.json weiter wie bisher, sagt, woran es lag, und versucht es beim
//      nächsten Start erneut. Das ist wichtiger, als dass der Umstieg gelingt.
//
// ---------- Die Reihenfolge, und warum sie so ist ----------
//
//    1. Gibt es eine db.json? Ohne sie gibt es nichts zu übernehmen.
//    2. Ist die Datenbank noch leer? Steht schon etwas darin, wäre ein zweiter Umstieg ein
//       Überschreiben.
//    3. **Prüfen, bevor irgendetwas geschrieben wird.** Dafür ist der Validator geschrieben
//       (db/validate.ts): Ein verdorbener Bestand fiele sonst erst beim Einfügen auf, mitten im
//       Vorgang, und die Meldung käme von SQLite statt von Mietfuchs.
//    4. Sicherung der db.json anlegen.
//    5. In eine **eigene Datei** schreiben, nicht in die richtige. Sie heißt
//       `mietfuchs.sqlite.umstieg` und wird erst am Ende an ihren Platz bewegt. Ein Stromausfall
//       mittendrin lässt damit nur eine halbe Datei zurück, die niemand benutzt.
//    6. Importieren.
//    7. **Die Regression** (db/regression.ts): Kommt aus der Datenbank dieselbe Abrechnung
//       heraus wie aus der Datei?
//    8. Weicht ein einziger Cent ab, wird nicht aktiviert. Es bleibt alles, wie es war.
//    9. Sonst aktivieren: ein `rename`, also ein Schritt, den das Dateisystem ganz oder gar
//       nicht macht.
//   10. Protokoll schreiben. Die db.json bleibt liegen, sie ist der Rückweg.
//
// **Ohne WAL.** Die Datei für den Umstieg wird bewusst im gewöhnlichen Journalmodus geführt: Ein
// `rename` bewegt nur die Hauptdatei, die Beidateien (`-wal`, `-shm`) blieben verwaist zurück
// und gehörten danach zu keiner Datenbank mehr. Vor dem Bewegen wird deshalb nachgesehen, dass
// keine daliegt.

import fs from 'node:fs'
import path from 'node:path'
import { migrateLegacy, legacyPrepaymentCase, straightenForDatabase, type LegacyTenancy } from '../legacy.ts'
import type { Db } from '../store.ts'
import { APP_VERSION } from '../version.ts'
import { applyMigrations, connect, loadMigrations, type Connection, type Database } from './client.ts'
import { messageOf, type OpenedDatabase } from './open.ts'
import { readStock } from './read.ts'
import { deviationMessage, frozenDifference, runRegression, standToCompare, yearsToCheck } from './regression.ts'
import { findingsText, validateDb, type Finding } from './validate.ts'
import { writeStock, type StockCounts } from './write.ts'
import {
  aiSlots, baseRents, closedSettlements, costItemShares, costItems, meters, payments,
  personHistory, prepaymentOverrides, prepayments, readings, settings, tenancies, units,
} from './schema.ts'
import { count } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { ChangeoverState } from '../../../shared/types.ts'

// Die Sicherung heißt wie die Datei, aus der sie stammt, mit einem deutschen Zusatz — wie
// `db.json.vor-restore` beim Wiederherstellen eines Backups. Wer den Datenordner öffnet, soll
// ohne Erklärung verstehen, was er vor sich hat.
export const BACKUP_NAME = 'db.json.vor-umstieg'
export const TEMP_NAME = 'mietfuchs.sqlite.umstieg'
export const PROTOCOL_NAME = 'umstieg-protokoll.txt'

// Beidateien von SQLite. Sie gehören zur Hauptdatei und dürfen bei einem `rename` nicht
// zurückbleiben.
const SIDECARS = ['-journal', '-wal', '-shm']

export type ChangeoverResult = {
  state: ChangeoverState
  // Ein Satz für die Oberfläche und für die Konsole.
  message: string
  // Was der Nutzer außerdem wissen muss, etwa dass sein Mietkonto ab jetzt anders rechnet.
  notes: string[]
  // Der Pfad des Protokolls, sofern eines geschrieben wurde.
  protocol: string | null
  // Die Datenbank, mit der weitergearbeitet wird. `null`, wenn sie sich nicht öffnen lässt;
  // dann arbeitet Mietfuchs ohne sie weiter.
  database: OpenedDatabase | null
}

// Griffe für die Tests. **Jeder Abbruch muss einzeln prüfbar sein** („bei einem Fehler in jedem
// Schritt bleibt der alte Zustand unberührt"), und zwei Schritte lassen sich von außen nicht
// zum Scheitern bringen: das Einfügen (der Validator hat vorher alles abgefangen, was die
// Datenbank ablehnen würde) und die Regression (sie schlägt nur bei einem Fehler in Mietfuchs
// selbst an). Die Griffe stellen die Bedingung her; der geprüfte Weg ist der richtige.
export type ChangeoverHooks = {
  beforeImport?: (db: Database) => Promise<void>
  afterImport?: (db: Database) => Promise<void>
  beforeActivate?: () => void
}

export type ChangeoverOptions = {
  dataDir: string
  opened: OpenedDatabase
  // Die Datenbank nach dem Austausch der Datei erneut öffnen.
  reopen: () => Promise<OpenedDatabase>
  hooks?: ChangeoverHooks
  now?: () => Date
}

// ---------- Schritt 2: ist die Datenbank noch leer? ----------

const COUNTED: { label: string, table: SQLiteTable }[] = [
  { label: 'Wohnungen', table: units },
  { label: 'Mietverhältnisse', table: tenancies },
  { label: 'Personen-Staffeln', table: personHistory },
  { label: 'Vorauszahlungs-Staffeln', table: prepayments },
  { label: 'Kaltmiete-Staffeln', table: baseRents },
  { label: 'gezahlte Vorauszahlungen', table: prepaymentOverrides },
  { label: 'Kostenpositionen', table: costItems },
  { label: 'vereinbarte Anteile', table: costItemShares },
  { label: 'Zähler', table: meters },
  { label: 'Ablesungen', table: readings },
  { label: 'Zahlungen', table: payments },
  { label: 'abgeschlossene Abrechnungen', table: closedSettlements },
  { label: 'Einstellungen', table: settings },
  { label: 'KI-Plätze', table: aiSlots },
]

// Gefragt werden **alle** Tabellen und nicht nur die Wohnungen: Ein Bestand kann ohne Wohnungen
// anfangen, und eine Zeile in irgendeiner Tabelle heißt, dass hier schon jemand gearbeitet hat.
async function firstFilledTable(db: Database): Promise<string | null> {
  for (const { label, table } of COUNTED) {
    const rows = await db.select({ n: count() }).from(table)
    if ((rows[0]?.n ?? 0) > 0) return label
  }
  return null
}

// ---------- Abbruch mit einer Meldung, die jemand lesen kann ----------

class ChangeoverStop extends Error {}

// Der Typ steht ausdrücklich an der Konstanten und nicht nur am Rumpf: Nur so weiß der
// Übersetzer, dass es hinter einem Aufruf nicht weitergeht. Dieselbe Bauart wie `fail` in
// open.ts.
const stop: (reason: string) => never = (reason) => { throw new ChangeoverStop(reason) }

const CONTINUES =
  'Mietfuchs arbeitet unverändert mit der Datei db.json weiter, es geht nichts verloren, und ' +
  'beim nächsten Start wird es erneut versucht.'

// ---------- Die Datei für den Umstieg ----------

function removeTemp(tempFile: string): void {
  // Reste eines früheren, abgebrochenen Versuchs. Sie zu löschen ist ungefährlich: Diese Datei
  // gehört ausschließlich dem Umstieg, und benutzt wird sie erst, wenn sie an ihrem Platz liegt.
  //
  // **Aufräumen darf nie selbst zum Fehler werden.** Es läuft auch im Fehlerfall, und wenn es
  // dort würfe, käme aus dem Umstieg statt einer Meldung eine Ausnahme heraus; der Server
  // bekäme sie beim Start um die Ohren, obwohl er gerade weiterlaufen soll. Gelingt es nicht,
  // liegt eine Datei zu viel im Ordner, und der nächste Versuch räumt sie weg.
  // Bewusst **ohne** `recursive`: Was hier liegt, soll eine Datei sein. Steht dort ein Ordner,
  // wird er nicht weggeräumt, sondern der Umstieg bricht gleich danach mit einer Meldung ab —
  // eine Regel, die einen ganzen Ordner löscht, weil sie ihn für wertlos hält, darf es an
  // dieser Stelle nicht geben.
  for (const suffix of ['', ...SIDECARS]) {
    try {
      fs.rmSync(`${tempFile}${suffix}`, { force: true })
    } catch {
      /* siehe oben */
    }
  }
}

// Ein `rename` kann unter Windows kurzzeitig scheitern, wenn ein Virenscanner oder die
// Suchindizierung die Datei gerade offen hält. Ein paar Versuche im Abstand von Millisekunden
// kosten nichts und ersparen dem Nutzer eine Fehlermeldung für etwas, das von selbst vergeht.
async function replaceFile(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to)
      return
    } catch (err) {
      if (attempt >= 5) throw err
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

// ---------- Das Protokoll ----------

const germanDateTime = (at: Date): string => {
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(at.getDate())}.${two(at.getMonth() + 1)}.${at.getFullYear()} ${two(at.getHours())}:${two(at.getMinutes())}`
}

// Was übernommen wurde, in Worten. Die Zahlen stehen im Protokoll, damit der Vermieter
// nachsehen kann, ob sein Bestand vollständig angekommen ist.
function countedText(counts: StockCounts): string[] {
  const rows: [number, string, string][] = [
    [counts.units, 'Wohnung', 'Wohnungen'],
    [counts.tenancies, 'Mietverhältnis', 'Mietverhältnisse'],
    [counts.costItems, 'Kostenposition', 'Kostenpositionen'],
    [counts.meters, 'Zähler', 'Zähler'],
    [counts.readings, 'Ablesung', 'Ablesungen'],
    [counts.payments, 'Zahlung', 'Zahlungen'],
    [counts.closedSettlements, 'abgeschlossene Abrechnung', 'abgeschlossene Abrechnungen'],
    [counts.personHistory + counts.prepayments + counts.baseRents, 'Staffeleintrag', 'Staffeleinträge'],
    [counts.prepaymentOverrides, 'gezahlte Vorauszahlung', 'gezahlte Vorauszahlungen'],
    [counts.costItemShares, 'vereinbarter Anteil', 'vereinbarte Anteile'],
  ]
  return rows.map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
}

type Protocol = {
  at: Date
  counts: StockCounts | null
  years: number[]
  adjustments: Finding[]
  notes: string[]
  outcome: string
}

function protocolText(protocol: Protocol): string {
  const lines = [
    `Umstieg der Daten in die Datenbank, ${germanDateTime(protocol.at)}, Mietfuchs ${APP_VERSION}`,
    '',
    protocol.outcome,
    '',
  ]
  if (protocol.counts) {
    lines.push('Übernommen:', ...countedText(protocol.counts).map((text) => `  ${text}`), '')
  }
  if (protocol.years.length > 0) {
    lines.push(
      `Nachgerechnet und centgenau verglichen wurden Abrechnung, Verbrauchsübersicht, Mietkonto und`,
      `Steuerübersicht für ${protocol.years.length === 1 ? 'das Jahr' : 'die Jahre'} ${protocol.years.join(', ')}.`,
      '',
    )
  }
  if (protocol.adjustments.length > 0) {
    lines.push('Beim Übernehmen geradegerückt:')
    for (const finding of protocol.adjustments) lines.push(`  ${finding.where}: ${finding.reason}`)
    lines.push('')
  }
  if (protocol.notes.length > 0) {
    lines.push('Was sich dadurch ändert:', ...protocol.notes.map((note) => `  ${note}`), '')
  }
  lines.push(
    'Die bisherige Datei db.json bleibt liegen, daneben eine Kopie ihres Standes vor dem Umstieg',
    `(${BACKUP_NAME}). Am Backup ändert sich nichts: weiterhin diesen Ordner kopieren.`,
  )
  return lines.join('\n')
}

// ---------- Der Umstieg ----------

// Die Datenbank ließ sich gar nicht erst öffnen (beschädigt, schreibgeschützt, aus einer
// neueren Version). Dann gibt es keinen Umstieg. Wer eine db.json hat, soll erfahren, warum
// seine Daten nicht umgezogen sind, und zwar an derselben Stelle wie sonst auch; wer keine hat,
// hat nichts versäumt und bekommt deshalb auch keine Meldung.
export function changeoverWithoutDatabase(dataDir: string, problem: string): ChangeoverResult {
  if (!fs.existsSync(path.join(dataDir, 'db.json'))) {
    return { state: 'none', message: 'Ohne geöffnete Datenbank ist nichts zu übernehmen.', notes: [], protocol: null, database: null }
  }
  return {
    state: 'failed',
    message: `Der Umstieg der Daten in die Datenbank ist nicht gelungen. ${CONTINUES}\n\nDie Datenbank ließ sich nicht öffnen: ${problem}`,
    notes: [],
    protocol: null,
    database: null,
  }
}

export async function runChangeover(options: ChangeoverOptions): Promise<ChangeoverResult> {
  const { dataDir, opened, reopen, hooks = {}, now = () => new Date() } = options
  const jsonFile = path.join(dataDir, 'db.json')
  const tempFile = path.join(dataDir, TEMP_NAME)
  const protocolFile = path.join(dataDir, PROTOCOL_NAME)

  // Schritt 1: Gibt es überhaupt etwas zu übernehmen? Auf einem frischen Rechner entsteht die
  // db.json erst beim ersten Speichern.
  if (!fs.existsSync(jsonFile)) {
    return { state: 'none', message: 'Es gibt noch keine db.json; es ist nichts zu übernehmen.', notes: [], protocol: null, database: opened }
  }

  // Schritt 2: Steht schon etwas in der Datenbank, ist der Umstieg gelaufen (oder eine neuere
  // Version arbeitet damit). Ein zweiter wäre ein Überschreiben.
  const filled = await firstFilledTable(opened.db)
  if (filled) {
    return {
      state: 'none',
      message: `Die Datenbank enthält bereits Daten (${filled}); der Umstieg ist schon gelaufen.`,
      notes: [], protocol: null, database: opened,
    }
  }

  let database: OpenedDatabase | null = opened
  let connection: Connection | null = null
  let counts: StockCounts | null = null
  let years: number[] = []
  let adjustments: Finding[] = []
  const notes: string[] = []

  try {
    // Schritt 3: erst lesen, dann prüfen, und bei einer Beanstandung abbrechen, bevor
    // irgendetwas geschrieben wurde.
    let raw: Partial<Db> | null
    try {
      raw = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))
    } catch (err) {
      stop(`Die Datei db.json ließ sich nicht lesen: ${messageOf(err)}`)
    }
    const validation = validateDb(raw)
    adjustments = validation.adjustments
    if (validation.problems.length > 0) {
      stop(
        'Die Daten in der Datei db.json lassen sich nicht übernehmen, ohne etwas zu verändern. ' +
          `Beanstandet wurde:\n${findingsText(validation.problems)}`,
      )
    }

    // Der Bestand, wie ihn Mietfuchs heute liest, und derselbe Bestand in der Gestalt, die die
    // Datenbank verlangt. Beide Regeln stehen in legacy.ts, damit sie nicht auseinanderlaufen.
    const stock = migrateLegacy(raw)
    const straight = straightenForDatabase(stock)
    notes.push(...notesFor(stock))

    // Schritt 4: die Sicherung. Sie hält den Stand fest, den der Umstieg vorgefunden hat; die
    // db.json selbst bleibt liegen und wird weiter benutzt.
    try {
      fs.copyFileSync(jsonFile, path.join(dataDir, BACKUP_NAME))
    } catch (err) {
      stop(`Die Sicherung der Datei db.json ließ sich nicht anlegen: ${messageOf(err)}`)
    }

    // Schritt 5: eine eigene Datei, und zwar eine frische.
    try {
      removeTemp(tempFile)
      connection = await connect(tempFile)
      // Kein WAL: Sonst blieben beim Bewegen der Datei die Beidateien zurück. Eine frisch
      // angelegte SQLite-Datei steht ohnehin im gewöhnlichen Journalmodus; nachgesehen wird es
      // trotzdem, denn davon hängt ab, ob Schritt 9 heil bleibt.
      const mode = String(connection.rows('PRAGMA journal_mode')[0]?.[0] ?? '').toLowerCase()
      if (mode === 'wal') stop('Die Datei für den Umstieg steht im WAL-Modus; dann bliebe beim Bewegen eine Beidatei zurück.')
      applyMigrations(connection, await loadMigrations())
    } catch (err) {
      if (err instanceof ChangeoverStop) throw err
      stop(`Die Datenbank für den Umstieg ließ sich nicht anlegen: ${messageOf(err)}`)
    }

    // Schritt 6: importieren.
    await hooks.beforeImport?.(connection.db)
    try {
      counts = await writeStock(connection.db, straight)
    } catch (err) {
      stop(
        `Die Daten ließen sich nicht in die Datenbank schreiben: ${messageOf(err)}. Geprüft wurden ` +
          'sie vorher, dies ist also ein Fehler in Mietfuchs und keiner in Ihren Daten. Bitte melden Sie ihn.',
      )
    }
    await hooks.afterImport?.(connection.db)

    // Schritt 7: die Regression. Der Prüfstein.
    const written = await readStock(connection.db)
    years = yearsToCheck(stock, now().getFullYear())
    const regression = runRegression(standToCompare(stock), written, years)
    // Schritt 8: weicht ein einziger Cent ab, wird nicht aktiviert.
    if (regression.deviation) stop(deviationMessage(regression.deviation))
    // Dazu die Archivstücke: Die vier Rechnungen lesen aus einer abgeschlossenen Abrechnung nur
    // den Eigenanteil, der Rest fiele oben also gar nicht auf.
    const frozen = frozenDifference(stock.closedSettlements, written.closedSettlements)
    if (frozen) stop(deviationMessage(frozen))
    if (regression.labelsChanged) {
      notes.push(
        'Eine Beschriftung sieht danach anders aus (ein Name, der in der Datei fehlte, steht jetzt ' +
          'als leeres Feld da). An den Beträgen ändert sich dadurch nichts.',
      )
    }

    // Schritt 9: aktivieren. Erst die Verbindungen schließen, denn unter Windows lässt sich eine
    // geöffnete Datei nicht ersetzen.
    connection.close()
    connection = null
    hooks.beforeActivate?.()
    const liegengeblieben = SIDECARS.filter((suffix) => fs.existsSync(`${tempFile}${suffix}`))
    if (liegengeblieben.length > 0) {
      stop(
        `Neben der fertigen Datei liegt noch eine Beidatei (${liegengeblieben.join(', ')}). Ein Bewegen ` +
          'ließe sie verwaist zurück, und sie könnte die Datenbank beschädigen.',
      )
    }
    opened.close()
    database = null
    try {
      await replaceFile(tempFile, opened.file)
    } catch (err) {
      stop(`Die fertige Datenbank ließ sich nicht an ihren Platz bewegen: ${messageOf(err)}`)
    }

    // Schritt 10: Protokoll schreiben und die Datenbank wieder öffnen.
    const message =
      'Ihre Daten liegen jetzt in einer Datenbank (mietfuchs.sqlite im Datenordner). Die bisherige ' +
      `Datei db.json bleibt als Sicherung daneben liegen. Am Backup ändert sich nichts: weiterhin ` +
      'diesen Ordner kopieren.'
    const protocol = writeProtocol(protocolFile, {
      at: now(), counts, years, adjustments, notes,
      outcome: 'Der Umstieg ist gelungen.',
    })
    try {
      database = await reopen()
    } catch (err) {
      // Übernommen ist alles, nur die Verbindung fehlt. Der nächste Start öffnet sie; bis dahin
      // arbeitet Mietfuchs mit der db.json weiter, und verloren ist nichts.
      return {
        state: 'done',
        message,
        notes: [...notes, `Die neue Datenbank ließ sich nicht gleich wieder öffnen: ${messageOf(err)}`],
        protocol,
        database: null,
      }
    }
    return { state: 'done', message, notes, protocol, database }
  } catch (err) {
    const reason = err instanceof ChangeoverStop ? err.message : `Unerwarteter Fehler: ${messageOf(err)}`
    // Aufräumen, und zwar so, dass danach wieder der Zustand von vorher herrscht: keine halbe
    // Datei, und die Datenbank offen.
    try {
      connection?.close()
    } catch {
      /* eine Verbindung, die sich nicht schließen lässt, ändert nichts mehr am Ergebnis */
    }
    removeTemp(tempFile)
    if (!database) {
      try {
        database = await reopen()
      } catch {
        database = null // dann läuft Mietfuchs ohne Datenbank weiter, wie vor dem Umstieg
      }
    }
    const message = `Der Umstieg der Daten in die Datenbank ist nicht gelungen. ${CONTINUES}\n\n${reason}`
    // Ohne Übernahme gibt es weder etwas Geradegerücktes noch eine Änderung, die der Nutzer
    // kennen müsste: Beides stünde hier als Ankündigung von etwas, das gerade nicht geschehen
    // ist. Die geprüften Jahre bleiben, denn bei einer Abweichung sagen sie, wie weit die
    // Prüfung gekommen ist.
    const protocol = writeProtocol(protocolFile, {
      at: now(), counts: null, years, adjustments: [], notes: [],
      outcome: `Der Umstieg ist nicht gelungen.\n\n${reason}\n\n${CONTINUES}`,
    })
    return { state: 'failed', message, notes: [], protocol, database }
  }
}

// Das Protokoll scheitert nicht den Umstieg: Es ist eine Erklärung, kein Datenspeicher.
function writeProtocol(file: string, protocol: Protocol): string | null {
  try {
    fs.writeFileSync(file, `${protocolText(protocol)}\n`, 'utf8')
    return file
  } catch {
    return null
  }
}

// Was der Nutzer über sein eigenes Ergebnis wissen muss. Heute ist das genau eine Sache, und
// sie steht hier, statt sich hinter einer Zusage zu verstecken: Der feste Monatsbetrag neben
// einer leeren Staffel wandert in die Vorauszahlungs-Staffel, und damit fordert das Mietkonto
// ab jetzt, was die Abrechnung ohnehin schon ansetzt.
function notesFor(stock: Db): string[] {
  const betroffen = stock.tenancies.filter((tenancy) => {
    const legacy: LegacyTenancy = tenancy
    return legacyPrepaymentCase(tenancy.prepayments, legacy.prepaymentMonthlyCents) === 'empty-schedule'
  })
  if (betroffen.length === 0) return []
  const wer = betroffen.map((t) => t.tenantName || 'ohne Namen').join(', ')
  return [
    `Bei ${betroffen.length === 1 ? 'einem Mietverhältnis' : `${betroffen.length} Mietverhältnissen`} (${wer}) ` +
      'stand die Vorauszahlung noch als fester Monatsbetrag da. Daraus ist ein Eintrag der ' +
      'Vorauszahlungs-Staffel geworden, wie ihn die Abrechnung schon bisher gelesen hat. Neu ist, ' +
      'dass auch das Mietkonto und die Steuerübersicht damit rechnen: Das monatliche Soll steigt um ' +
      'die Vorauszahlung, dieselbe Zahlung deckt also weniger Monate, und ein Monat kann von ' +
      '„bezahlt" auf „teilweise" wechseln. Gefordert wird damit, was die Abrechnung ohnehin ansetzt; ' +
      'bisher forderte das Mietkonto zu wenig.',
  ]
}
