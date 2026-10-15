// Eine hochgeladene Datei mit Kontoauszügen lesen (#188): camt (XML), MT940 (Text) oder ein
// ZIP-Archiv mit mehreren solchen Dateien. Das Format wird am Inhalt erkannt, nicht an der Endung;
// Banken und Programme benennen dieselben Dateien verschieden (.xml, .sta, .txt, .940, .mt940).

import AdmZip from 'adm-zip'
import { readCamtFile } from './camt.ts'
import { readMt940 } from './mt940.ts'
import { clip, problemOnly, type BankReadResult } from './statement.ts'

// Die Grenzen richten sich nach dem größten Fall, der wirklich vorkommt: mehrere Jahre camt.053
// eines Kontos in einem ZIP. Ein Tagesauszug mit einer Handvoll Umsätzen hat wenige Kilobyte,
// ein Umsatz in camt rund 1 bis 2 KB. Ein Jahr Tagesauszüge (gut 250 Bankarbeitstage) sind damit
// einige hundert Dateien und wenige MB; selbst ein einziger Jahresauszug eines lebhaften Kontos
// mit 2.000 Umsätzen bleibt unter 5 MB.
// - 10 MB je Datei: das Doppelte davon. Zugleich bestimmt die Größe, wie lange das Lesen den
//   Server blockiert, denn XML wird am Stück gelesen: Gemessen braucht eine Datei an der Grenze
//   mit rund 40.000 gewöhnlichen Umsätzen etwa sechs Sekunden, ein einziges riesiges Attribut oder
//   Element nur ein bis zwei. Ein Angriff mit einer großen Datei blockiert also nicht länger als
//   ein echter Auszug dieser Größe; kleiner muss die Grenze dafür nicht werden.
// - 20 MB entpackt im ZIP: vier Jahre Tagesauszüge mit Platz nach oben.
// - 1000 Einträge: vier Jahre Tagesauszüge; gezählt wird jeder Eintrag, auch Ordner und Beiwerk,
//   denn adm-zip legt für jeden ein Objekt an.
// - 255 Bytes je Name: so lang darf ein Dateiname auf den gängigen Dateisystemen sein. adm-zip
//   legt zu jedem Ordner im Namen einen Eintrag an, mit Aufwand im Quadrat der Tiefe; ein Name aus
//   Tausenden Ebenen blockierte den Server für Sekunden bis Minuten.
export const MAX_ZIP_ENTRIES = 1000
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_ZIP_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_ZIP_NAME_BYTES = 255

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

type ZipDirectory = { entries: number, totalBytes: number, longName: boolean }

// Liest das Verzeichnis am Ende des ZIP, ohne einen Eintrag anzufassen: Anzahl der Einträge,
// Summe der unkomprimierten Größen und ob ein Name zu lang ist. Das muss vor adm-zip geschehen,
// denn `getEntries()` legt für jeden Eintrag ein Objekt an, ein Archiv mit 65.535 leeren Einträgen
// kostete so Sekunden und Hunderte MB, bevor überhaupt gezählt werden konnte.
// `null`: Das Verzeichnis ist nicht lesbar oder reicht über die Datei hinaus. ZIP64 (für Archive
// über 4 GB oder mit mehr als 65.534 Einträgen) braucht kein Kontoauszug; seine Platzhalter
// (0xFFFF, 0xFFFFFFFF) liegen ohnehin über jeder Grenze und führen zur Ablehnung.
function zipDirectory(data: Buffer): ZipDirectory | null {
  // Das Ende des Verzeichnisses steht in den letzten 22 Bytes, gefolgt von einem Kommentar von
  // höchstens 65.535 Bytes. Gesucht wird von hinten, wie adm-zip es tut.
  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (data[i] === 0x50 && data.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) return null
  // adm-zip sucht in den 20 Bytes davor noch nach einem zweiten Ende oder einem ZIP64-Verweis und
  // nähme dann jenes. Ein Kontoauszug hat beides nicht; zwei Verzeichnisse wären ein Archiv, das
  // hier anders gelesen würde als beim Entpacken.
  for (let i = Math.max(0, end - 20); i < end; i++) {
    const signature = data.readUInt32LE(i)
    if (signature === 0x06054b50 || signature === 0x07064b50) return null
  }
  const entries = Math.max(data.readUInt16LE(end + 8), data.readUInt16LE(end + 10))
  if (entries > MAX_ZIP_ENTRIES) return { entries, totalBytes: 0, longName: false }
  let at = data.readUInt32LE(end + 16)
  let totalBytes = 0
  let longName = false
  for (let n = 0; n < entries; n++) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== 0x02014b50) return null
    totalBytes += data.readUInt32LE(at + 24)
    const nameLength = data.readUInt16LE(at + 28)
    if (nameLength > MAX_ZIP_NAME_BYTES) longName = true
    at += 46 + nameLength + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32)
  }
  return { entries, totalBytes, longName }
}

export function readBankFile(data: Buffer, uploadedName: string): BankReadResult {
  // Der Name steht in jedem Befund; ein überlanger stünde dort tausendfach.
  const fileName = clip(uploadedName, MAX_ZIP_NAME_BYTES)
  const isZip = data.length >= 4 && data.readUInt32LE(0) === 0x04034b50
  if (!isZip) return readSingle(data, fileName) ?? problemOnly(fileName, NOT_A_STATEMENT)
  const directory = zipDirectory(data)
  if (!directory) return problemOnly(fileName, 'Das ZIP-Archiv lässt sich nicht öffnen.')
  if (directory.entries > MAX_ZIP_ENTRIES) return problemOnly(fileName, `Das ZIP-Archiv enthält mehr als ${MAX_ZIP_ENTRIES} Einträge.`)
  // Die Größen aus dem Verzeichnis des Archivs, bevor entpackt wird. Gelogen werden kann dort
  // auch; dann scheitert das Entpacken unten, und das ist ein Befund und kein Absturz.
  if (directory.totalBytes > MAX_ZIP_TOTAL_BYTES) return problemOnly(fileName, 'Das ZIP-Archiv ist zu groß für Kontoauszüge.')
  if (directory.longName) return problemOnly(fileName, `Das ZIP-Archiv enthält einen Eintrag mit mehr als ${MAX_ZIP_NAME_BYTES} Zeichen im Namen; so heißt kein Kontoauszug.`)
  let entries: AdmZip.IZipEntry[]
  try {
    const zip = new AdmZip(data)
    // adm-zip liest das Verzeichnis selbst noch einmal; findet es dort eine andere Zahl (etwa über
    // einen ZIP64-Eintrag), gilt die Prüfung oben nicht für das, was es entpacken würde.
    if (zip.getEntryCount() !== directory.entries) return problemOnly(fileName, 'Das ZIP-Archiv lässt sich nicht öffnen.')
    entries = zip.getEntries()
  } catch {
    return problemOnly(fileName, 'Das ZIP-Archiv lässt sich nicht öffnen.')
  }
  const files = entries
    .filter((e) => !e.isDirectory && !isMacJunk(e.entryName) && /\.(xml|sta|txt|940|mt940)$/i.test(e.entryName))
    // In fester Reihenfolge, damit das Ergebnis nicht an der Packreihenfolge hängt.
    .sort((a, b) => (a.entryName < b.entryName ? -1 : a.entryName > b.entryName ? 1 : 0))
  if (files.length === 0) return problemOnly(fileName, 'Das ZIP-Archiv enthält keinen Kontoauszug.')
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
