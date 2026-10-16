// Eine hochgeladene Datei mit Kontoauszügen lesen (#188): camt (XML), MT940 (Text) oder ein
// ZIP-Archiv mit mehreren solchen Dateien. Das Format wird am Inhalt erkannt, nicht an der Endung;
// Banken und Programme benennen dieselben Dateien verschieden (.xml, .sta, .txt, .940, .mt940).

import AdmZip from 'adm-zip'
import { readCamtFile } from './camt.ts'
import { readMt940 } from './mt940.ts'
import { problemOnly, type BankReadResult } from './statement.ts'

// Ein Kontoauszug ist klein, ein Jahr Tagesauszüge sind einige hundert Dateien zu wenigen
// Kilobyte. Was darüber liegt, ist kein Kontoauszug, sondern ein Versehen oder ein Archiv, das
// beim Entpacken den Speicher füllen soll.
const MAX_ZIP_ENTRIES = 1000
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_ZIP_TOTAL_BYTES = 50 * 1024 * 1024

// MT940 kommt ohne Angabe der Kodierung. Ist die Datei gültiges UTF-8, gilt das; sonst ist sie
// fast immer ISO-8859-1 bzw. Windows-1252, wie es deutsche Banken lange geschrieben haben.
function decodeText(data: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return new TextDecoder('windows-1252').decode(data)
  }
}

const NOT_A_STATEMENT = 'Die Datei ist kein Kontoauszug im Format camt oder MT940.'

// `null`: weder XML noch MT940, also nicht als Kontoauszug erkannt.
function readSingle(data: Buffer, where: string): BankReadResult | null {
  if (data.length > MAX_FILE_BYTES) return problemOnly(where, 'Die Datei ist zu groß für einen Kontoauszug.')
  // Das erste sichtbare Zeichen entscheidet: „<“ ist XML, sonst Text. Byte-Order-Mark und
  // Leerraum davor zählen nicht.
  const head = data.subarray(0, 64).toString('latin1').replace(/^\xEF\xBB\xBF/, '').trimStart()
  if (head.startsWith('<')) return readCamtFile(data, where)
  const text = decodeText(data)
  if (/^:(20|25|60F|61):/m.test(text)) return readMt940(text, where)
  return null
}

// Beiwerk, das macOS in ZIP-Archive legt (`__MACOSX/`, `._name.xml`); es sieht aus wie ein
// Auszug und ist keiner.
const isMacJunk = (name: string) => /(^|\/)__MACOSX\//.test(name) || /(^|\/)\._[^/]*$/.test(name)

export function readBankFile(data: Buffer, fileName: string): BankReadResult {
  const isZip = data.length >= 4 && data.readUInt32LE(0) === 0x04034b50
  if (!isZip) return readSingle(data, fileName) ?? problemOnly(fileName, NOT_A_STATEMENT)
  let entries: AdmZip.IZipEntry[]
  try {
    entries = new AdmZip(data).getEntries()
  } catch {
    return problemOnly(fileName, 'Das ZIP-Archiv lässt sich nicht öffnen.')
  }
  const files = entries
    .filter((e) => !e.isDirectory && !isMacJunk(e.entryName) && /\.(xml|sta|txt|940|mt940)$/i.test(e.entryName))
    // In fester Reihenfolge, damit das Ergebnis nicht an der Packreihenfolge hängt.
    .sort((a, b) => (a.entryName < b.entryName ? -1 : a.entryName > b.entryName ? 1 : 0))
  if (files.length === 0) return problemOnly(fileName, 'Das ZIP-Archiv enthält keinen Kontoauszug.')
  if (files.length > MAX_ZIP_ENTRIES) return problemOnly(fileName, `Das ZIP-Archiv enthält mehr als ${MAX_ZIP_ENTRIES} Dateien.`)
  // Die Größen aus dem Verzeichnis des Archivs, bevor entpackt wird. Gelogen werden kann dort
  // auch; dann scheitert das Entpacken unten, und das ist ein Befund und kein Absturz.
  if (files.reduce((a, e) => a + e.header.size, 0) > MAX_ZIP_TOTAL_BYTES) {
    return problemOnly(fileName, 'Das ZIP-Archiv ist zu groß für Kontoauszüge.')
  }
  const results = files.map((e) => {
    const where = `${fileName}: ${e.entryName}`
    if (e.header.size > MAX_FILE_BYTES) return problemOnly(where, 'Die Datei ist zu groß für einen Kontoauszug.')
    let content: Buffer
    try {
      content = e.getData()
    } catch {
      return problemOnly(where, 'Die Datei im ZIP-Archiv ist beschädigt.')
    }
    // Eine Textdatei, die kein MT940 ist (etwa eine Liesmich), gehört nicht zu den Auszügen;
    // eine XML-Datei, die kein camt ist, meldet readCamt selbst.
    return readSingle(content, where)
  }).filter((r): r is BankReadResult => r !== null)
  if (results.length === 0) return problemOnly(fileName, 'Das ZIP-Archiv enthält keinen Kontoauszug.')
  return {
    statements: results.flatMap((r) => r.statements),
    problems: results.flatMap((r) => r.problems),
    pendingSkipped: results.reduce((a, r) => a + r.pendingSkipped, 0),
  }
}
