// Eine hochgeladene Datei mit Kontoauszügen lesen (#188): camt (XML), MT940 (Text) oder ein
// ZIP-Archiv mit mehreren solchen Dateien. Das Format wird am Inhalt erkannt, nicht an der Endung;
// Banken und Programme benennen dieselben Dateien verschieden (.xml, .sta, .txt, .940, .mt940).

import AdmZip from 'adm-zip'
import { readCamtFile } from './camt.ts'
import { readMt940 } from './mt940.ts'
import { clip, problemOnly, type BankReadResult } from './statement.ts'

// Die Grenzen richten sich nach dem größten Fall, der wirklich vorkommt: mehrere Jahre camt.053
// eines Kontos in einem ZIP. Ein Tagesauszug mit einer Handvoll Umsätzen hat wenige Kilobyte,
// ein Umsatz in camt gemessen rund 250 Bytes. Ein Jahr Tagesauszüge (gut 250 Bankarbeitstage)
// sind damit einige hundert Dateien und wenige MB; selbst ein einziger Jahresauszug eines
// lebhaften Kontos mit 20.000 Umsätzen bleibt bei rund 5 MB.
// - 10 MB je Datei: das Doppelte davon. Zugleich bestimmt die Größe, wie lange das Lesen den
//   Server blockiert, denn XML wird am Stück gelesen: Gemessen braucht eine Datei an der Grenze
//   mit rund 40.000 gewöhnlichen Umsätzen etwa sechs Sekunden, ein einziges riesiges Attribut oder
//   Element nur ein bis zwei. Ein Angriff mit einer großen Datei blockiert also nicht länger als
//   ein echter Auszug dieser Größe; kleiner muss die Grenze dafür nicht werden.
// - 20 MB entpackt im ZIP: vier Jahre Tagesauszüge mit Platz nach oben.
// - 3.000 Einträge: vier Jahre Tagesauszüge sind gut 1.040 Dateien, mit Ordnern je Jahr und Monat
//   rund 1.100 Einträge, und ein Archiv vom Mac legt zu jeder Datei und jedem Ordner noch einen
//   unter `__MACOSX/` dazu, zusammen rund 2.200. Gezählt wird jedes Objekt, das adm-zip anlegt:
//   jeder Eintrag, auch Ordner und Beiwerk, und dazu jeder Ordner, den ein Name nur nennt, denn
//   auch für den legt adm-zip beim Laden einen Eintrag an (`makeTemporaryFolders` in zipFile.js).
// - 255 Bytes je Name: so lang darf ein Dateiname auf den gängigen Dateisystemen sein. adm-zip
//   legt zu jedem Ordner im Namen einen Eintrag an, mit Aufwand im Quadrat der Tiefe; ein Name aus
//   Tausenden Ebenen blockierte den Server für Sekunden bis Minuten.
// - 8 Ordnerebenen je Name: Ein Export legt Jahr und Monat an, macOS stellt `__MACOSX/` davor.
//   Ohne Grenze trug ein Name von 255 Bytes rund 125 Ebenen, und 3.000 solche Einträge mit eigener
//   erster Ebene ergaben gemessen 375.000 Objekte, 15,5 s Blockade und 3,7 GB Arbeitsspeicher.
// Gemessen am schlechtesten Archiv, das alle Grenzen einhält (3.000 Objekte, Namen von 255 Bytes,
// je 8 Ebenen bzw. ganz flach): höchstens 120 ms und 50 MB Arbeitsspeicher.
export const MAX_ZIP_ENTRIES = 3000
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_ZIP_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_ZIP_NAME_BYTES = 255
const MAX_ZIP_DEPTH = 8

// MT940 kommt ohne Angabe der Kodierung. Ist die Datei gültiges UTF-8, gilt das; sonst ist sie
// fast immer ISO-8859-1 bzw. Windows-1252, wie es deutsche Banken lange geschrieben haben.
function decodeText(data: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return new TextDecoder('windows-1252').decode(data)
  }
}

const de = (n: number) => n.toLocaleString('de-DE')
const MB = (bytes: number) => `${de(bytes / 1024 / 1024)} MB`
const SPLIT_ARCHIVE = 'Bitte teilen Sie die Auszüge auf mehrere Archive auf, zum Beispiel eines je Jahr.'
const FILE_TOO_BIG = `Die Datei ist zu groß für einen Kontoauszug; höchstens ${MB(MAX_FILE_BYTES)} sind möglich. `
  + 'Bitte rufen Sie bei Ihrer Bank kürzere Zeiträume ab, zum Beispiel je Quartal oder je Monat.'

const NOT_A_STATEMENT = 'Die Datei ist kein Kontoauszug im Format camt oder MT940.'

// `null`: weder XML noch MT940, also nicht als Kontoauszug erkannt.
function readSingle(data: Buffer, where: string): BankReadResult | null {
  if (data.length > MAX_FILE_BYTES) return problemOnly(where, FILE_TOO_BIG)
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

// `entries`: Einträge im Verzeichnis; `objects`: dazu die Ordner, die adm-zip aus den Namen ableitet.
type ZipDirectory = { entries: number, objects: number, totalBytes: number, longName: boolean, tooDeep: boolean }

// Liest das Verzeichnis am Ende des ZIP, ohne einen Eintrag anzufassen: Anzahl der Einträge,
// Summe der unkomprimierten Größen und ob ein Name zu lang ist. Das muss vor adm-zip geschehen,
// denn `getEntries()` legt für jeden Eintrag ein Objekt an, ein Archiv mit 65.535 leeren Einträgen
// kostete so Sekunden und Hunderte MB, bevor überhaupt gezählt werden konnte.
// `null`: Das Verzeichnis ist nicht lesbar oder reicht über die Datei hinaus. ZIP64 (für Archive
// über 4 GB oder mit mehr als 65.534 Einträgen) braucht kein Kontoauszug; seine Platzhalter
// (0xFFFF, 0xFFFFFFFF) liegen ohnehin über jeder Grenze und führen zur Ablehnung.
// `'comment'`: Das Archiv trägt einen Kommentar.
//
// Die Prüfung taugt nur, wenn sie dasselbe Verzeichnis liest wie adm-zip, und adm-zip (0.6.1,
// `readMainHeader` in zipFile.js) sucht anders als die Regel: Es geht von hinten durch die letzten
// 64 KB und nimmt ein ZIP64-Ende (`PK\x06\x06`), sobald es auf eines stößt, auch im Kommentar
// hinter dem gewöhnlichen Ende, und hinter einem ZIP64-Verweis (`PK\x06\x07`) in den 20 Bytes vor
// dem gewöhnlichen Ende sucht es noch einmal 64 KB weiter. Ein Archiv konnte so hier ein harmloses
// Verzeichnis zeigen und beim Entpacken ein anderes, dessen Einträge alle auf denselben
// komprimierten Auszug zeigen (gemessen: 52 KB Archiv, 42 MB entpackt, ohne Befund). Statt die
// Suche von adm-zip nachzubauen, wird das Archiv so eng gefasst, dass beide Suchen nur eine Antwort
// haben: Ein Kontoauszugsarchiv hat keinen Kommentar, also steht das gewöhnliche Ende genau in den
// letzten 22 Bytes, dort beginnt auch adm-zip, und in den 20 Bytes davor, die es danach noch
// ansieht, darf keine Kennung eines weiteren Endes stehen.
function zipDirectory(data: Buffer): ZipDirectory | 'comment' | null {
  const end = data.length - 22
  if (end < 0) return null
  if (data.readUInt32LE(end) !== 0x06054b50) {
    // Steht das Ende weiter vorn, folgt ihm ein Kommentar. Das lässt sich benennen; alles andere
    // ist schlicht kein lesbares Archiv.
    for (let i = end - 1; i >= Math.max(0, end - 0xffff); i--) {
      if (data[i] === 0x50 && data.readUInt32LE(i) === 0x06054b50) return 'comment'
    }
    return null
  }
  // Die Länge des Kommentars steht im Ende selbst; mit 22 Bytes bis zum Dateiende muss sie 0 sein.
  if (data.readUInt16LE(end + 20) !== 0) return null
  for (let i = Math.max(0, end - 20); i < end; i++) {
    const signature = data.readUInt32LE(i)
    if (signature === 0x06054b50 || signature === 0x06064b50 || signature === 0x07064b50) return null
  }
  const entries = Math.max(data.readUInt16LE(end + 8), data.readUInt16LE(end + 10))
  if (entries > MAX_ZIP_ENTRIES) return { entries, objects: entries, totalBytes: 0, longName: false, tooDeep: false }
  let at = data.readUInt32LE(end + 16)
  let totalBytes = 0
  let longName = false
  let tooDeep = false
  const names = new Set<string>()
  const folders = new Set<string>()
  for (let n = 0; n < entries; n++) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== 0x02014b50) return null
    // Entpackt wird höchstens die angegebene Größe, ein gespeicherter Eintrag (ohne Kompression)
    // ergibt aber seine Daten im Archiv, gleich was dasteht; es zählt die größere der beiden.
    totalBytes += Math.max(data.readUInt32LE(at + 20), data.readUInt32LE(at + 24))
    const nameLength = data.readUInt16LE(at + 28)
    if (nameLength > MAX_ZIP_NAME_BYTES) longName = true
    else if (at + 46 + nameLength <= data.length) {
      // Die Ordner, die adm-zip anlegt: jedes Stück des Namens bis zu einem „/“. Gelesen als
      // latin1, also Byte für Byte; ein „/“ ist in jeder Kodierung dasselbe Byte, und zwei
      // verschiedene Namen bleiben hier verschieden, gezählt wird also eher mehr als bei adm-zip.
      const name = data.toString('latin1', at + 46, at + 46 + nameLength)
      names.add(name)
      let depth = 0
      for (let slash = name.indexOf('/'); slash >= 0 && !tooDeep; slash = name.indexOf('/', slash + 1)) {
        if (++depth > MAX_ZIP_DEPTH) tooDeep = true
        else folders.add(name.slice(0, slash + 1))
      }
    }
    at += 46 + nameLength + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32)
  }
  let objects = entries
  for (const folder of folders) if (!names.has(folder)) objects++
  return { entries, objects, totalBytes, longName, tooDeep }
}

const REPACK = 'Bitte entpacken Sie das Archiv und packen Sie die Auszüge neu, oder laden Sie die Dateien einzeln hoch.'
const CANNOT_OPEN = `Das ZIP-Archiv lässt sich nicht öffnen. ${REPACK}`

const ZIP_WITH_COMMENT = 'Das ZIP-Archiv trägt einen Kommentar, wie ihn kein Export von Kontoauszügen schreibt, '
  + `und wird deshalb nicht gelesen. ${REPACK}`

export function readBankFile(data: Buffer, uploadedName: string): BankReadResult {
  // Der Name steht in jedem Befund; ein überlanger stünde dort tausendfach.
  const fileName = clip(uploadedName, MAX_ZIP_NAME_BYTES)
  const isZip = data.length >= 4 && data.readUInt32LE(0) === 0x04034b50
  if (!isZip) return readSingle(data, fileName) ?? problemOnly(fileName, NOT_A_STATEMENT)
  const directory = zipDirectory(data)
  if (directory === 'comment') return problemOnly(fileName, ZIP_WITH_COMMENT)
  if (!directory) return problemOnly(fileName, CANNOT_OPEN)
  if (directory.longName) return problemOnly(fileName, `Das ZIP-Archiv enthält einen Eintrag, dessen Name länger ist, als ein Dateiname sein darf (mehr als ${MAX_ZIP_NAME_BYTES} Bytes); so heißt kein Kontoauszug. ${REPACK}`)
  if (directory.tooDeep) return problemOnly(fileName, `Das ZIP-Archiv enthält Ordner in mehr als ${MAX_ZIP_DEPTH} Ebenen; so legt kein Export Kontoauszüge ab. ${REPACK}`)
  if (directory.objects > MAX_ZIP_ENTRIES) return problemOnly(fileName, `Das ZIP-Archiv enthält mehr als ${de(MAX_ZIP_ENTRIES)} Einträge (Dateien und Ordner zusammen). ${SPLIT_ARCHIVE}`)
  // Die Größen aus dem Verzeichnis des Archivs, bevor entpackt wird. Gelogen werden kann dort
  // auch; dann scheitert das Entpacken unten, und das ist ein Befund und kein Absturz.
  if (directory.totalBytes > MAX_ZIP_TOTAL_BYTES) return problemOnly(fileName, `Das ZIP-Archiv ist zu groß für Kontoauszüge; entpackt sind höchstens ${MB(MAX_ZIP_TOTAL_BYTES)} möglich. ${SPLIT_ARCHIVE}`)
  let entries: AdmZip.IZipEntry[]
  try {
    const zip = new AdmZip(data)
    // adm-zip liest das Verzeichnis selbst noch einmal; findet es dort eine andere Zahl (etwa über
    // einen ZIP64-Eintrag), gilt die Prüfung oben nicht für das, was es entpacken würde.
    if (zip.getEntryCount() !== directory.entries) return problemOnly(fileName, CANNOT_OPEN)
    entries = zip.getEntries()
  } catch {
    return problemOnly(fileName, CANNOT_OPEN)
  }
  const files = entries
    .filter((e) => !e.isDirectory && !isMacJunk(e.entryName) && /\.(xml|sta|txt|940|mt940)$/i.test(e.entryName))
    // In fester Reihenfolge, damit das Ergebnis nicht an der Packreihenfolge hängt.
    .sort((a, b) => (a.entryName < b.entryName ? -1 : a.entryName > b.entryName ? 1 : 0))
  if (files.length === 0) return problemOnly(fileName, 'Das ZIP-Archiv enthält keinen Kontoauszug.')
  const results = files.map((e) => {
    const where = `${fileName}: ${e.entryName}`
    if (e.header.size > MAX_FILE_BYTES) return problemOnly(where, FILE_TOO_BIG)
    let content: Buffer
    try {
      content = e.getData()
    } catch {
      return problemOnly(where, 'Die Datei im ZIP-Archiv ist beschädigt. Bitte laden Sie diesen Auszug erneut bei Ihrer Bank herunter und einzeln hoch.')
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
