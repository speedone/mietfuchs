// Backup und Wiederherstellen, soweit sie die Datenbank betreffen (#55, Aufgabe 7a).
//
// **Warum das vor dem Umstellen der Routen kommt.** Heute packt das Backup die db.json und die
// Belege, und das Wiederherstellen ersetzt die db.json. Die Datenbank kommt in beidem nicht vor,
// und ein zweiter Umstieg holt das auch nicht nach, denn er unterbleibt, sobald in der Datenbank
// etwas steht. Sobald die Routen aus ihr lesen, spielt also jemand ein Backup ein, sieht eine
// Bestätigung und arbeitet danach mit den alten Daten weiter. Er glaubt, sein Backup sei zurück,
// und es ist nicht so. Für eine Funktion, die es gerade für den Ernstfall gibt, ist das der
// schlimmste Fehler, den sie haben kann.
//
// ---------- Zwei Zusagen ----------
//
//   1. **Das Archiv enthält einen in sich stimmigen Stand.** Deshalb `VACUUM INTO` und keine
//      Dateikopie, siehe unten.
//   2. **Geprüft wird, bevor irgendetwas ersetzt wird.** Dieselbe Bauart wie bei der db.json
//      (#59) und beim Umstieg: Eine beschädigte oder neuere Datenbank darf nie an ihrem Platz
//      landen, denn dort bemerkt sie erst der nächste Start, und dann liegt die alte Datei
//      nicht mehr da.

import fs from 'node:fs'
import { sql } from 'drizzle-orm'
import { APP_VERSION } from '../version.ts'
import { connect, loadMigrations } from './client.ts'
import { germanDate, integrityProblem, messageOf, unknownSteps, type OpenedDatabase } from './open.ts'

// Die Namen im Archiv. Die Datenbank heißt darin wie im Datenordner, damit jemand, der das ZIP
// öffnet, ohne Erklärung versteht, was er vor sich hat.
export const ARCHIVE_DB_NAME = 'mietfuchs.sqlite'
export const ARCHIVE_INFO_NAME = 'mietfuchs-backup.json'

// Die Sicherheitskopie beim Wiederherstellen, wie `db.json.vor-restore` daneben.
export const DB_BEFORE_RESTORE = 'mietfuchs.sqlite.vor-restore'

// ---------- Der Schnappschuss fürs Archiv ----------

// **`VACUUM INTO` und keine Dateikopie.** Der Server hält die Datei die ganze Laufzeit offen.
// Sie einfach zu kopieren liefert im schlechtesten Fall einen Stand, den es nie gab: eine halb
// geschriebene Seite, oder eine Hauptdatei ohne die Beidatei, in der die jüngsten Änderungen
// stehen. `VACUUM INTO` schreibt stattdessen einen in sich stimmigen Stand in eine neue Datei,
// ohne den Betrieb anzuhalten, und die Datei steht für sich: keine Beidateien, die Buchführung
// über den Aufbau ist mit drin. Beides ist nachgemessen und hat einen Test.
//
// Der Vorgang läuft durch die Schlange (`opened.write`). Er schreibt zwar nur in eine fremde
// Datei, aber VACUUM verträgt sich nicht mit einer offenen Transaktion, und die Schlange ist
// genau die Stelle, an der im Server keine läuft.
export async function writeDatabaseSnapshot(opened: OpenedDatabase, target: string): Promise<void> {
  // Ein Rest eines früheren Versuchs. `VACUUM INTO` verlangt, dass die Datei noch nicht da ist,
  // und bricht sonst ab.
  fs.rmSync(target, { force: true })
  await opened.write((db) => db.run(sql`VACUUM INTO ${target}`))
}

// ---------- Die Angabe, woher das Archiv stammt ----------

// Ohne sie lässt sich später nicht sagen, ob ein unbekanntes Feld aus einer neueren Fassung
// stammt oder Müll ist; mit ihr wird aus einem stillen Verlust eine klare Meldung. Sie ist eine
// **Auskunft und keine Prüfung**: Ein Archiv ohne sie ist eines aus einer älteren Version, und
// genau die liegen bei den heutigen Nutzern.
export function archiveInfoText(at: Date): string {
  return `${JSON.stringify({ app: 'mietfuchs', version: APP_VERSION, createdAt: at.toISOString() }, null, 2)}\n`
}

// Woher das Archiv stammt, in Worten für eine Meldung. Nimmt beliebige Werte entgegen, denn der
// Inhalt kommt aus einer hochgeladenen Datei: Verengt wird mit `typeof`, wie im Validator.
export function originText(raw: unknown): string {
  if (raw === null || typeof raw !== 'object') return 'unbekannter Herkunft'
  const version: unknown = Reflect.get(raw, 'version')
  const created: unknown = Reflect.get(raw, 'createdAt')
  if (typeof version !== 'string' || version === '') return 'unbekannter Herkunft'
  const millis = typeof created === 'string' ? Date.parse(created) : Number.NaN
  const wann = Number.isFinite(millis) ? ` vom ${germanDate(millis)}` : ''
  return `Mietfuchs ${version}${wann}`
}

// ---------- Die Prüfung vor dem Austausch ----------

// Ist die Datenbank aus einem Archiv brauchbar? `null` heißt ja, sonst steht hier die Meldung
// für den Nutzer.
//
// Gefragt wird dasselbe wie beim Start (db/open.ts), nur mit anderer Empfehlung am Ende: Dort
// geht es um die eigene Arbeitsdatei, hier um ein Archiv, das mit der neueren Fassung
// eingespielt gehört. Die Fremdschlüssel bleiben hier außen vor, denn sie hängen an der
// Verbindung und nicht an der Datei; sie schaltet `connect` beim nächsten Öffnen ein.
export async function archiveDatabaseProblem(file: string): Promise<string | null> {
  let connection
  try {
    connection = await connect(file)
  } catch (err) {
    return damagedArchive(messageOf(err))
  }
  try {
    // Eine schwer beschädigte Datei antwortet nicht, sondern bricht ab; beide Ausgänge führen
    // zur selben Meldung.
    let befund: string | null
    try {
      befund = integrityProblem(connection.rows('PRAGMA integrity_check'))
    } catch (err) {
      befund = messageOf(err)
    }
    if (befund !== null) return damagedArchive(befund)

    const fremd = unknownSteps(connection, await loadMigrations())
    if (fremd) {
      return (
        `Die Datenbank in diesem Archiv stammt aus einer neueren Mietfuchs-Version. Sie enthält ` +
        `${fremd.count === 1 ? 'eine Änderung' : `${fremd.count} Änderungen`} am Aufbau, die diese ` +
        `Version (${APP_VERSION}) nicht kennt, die jüngste vom ${germanDate(fremd.newestMillis)}. ` +
        `Deshalb wurde nichts übernommen; Ihre bisherigen Daten sind unverändert. Bitte spielen ` +
        `Sie dieses Backup mit der neueren Fassung von Mietfuchs ein.`
      )
    }
    return null
  } finally {
    // Eine offene Verbindung zu einer Datei, die gleich bewegt wird, hält unter Windows nur
    // deren Sperre. Dieselbe Überlegung wie beim Öffnen und beim Umstieg.
    connection.close()
  }
}

const damagedArchive = (befund: string): string =>
  'Die Datenbank in diesem Archiv ist beschädigt, deshalb wurde nichts davon übernommen. Ihre ' +
  'bisherigen Daten sind unverändert. Bitte nehmen Sie ein anderes Backup. ' +
  `Technischer Befund: ${befund}`
