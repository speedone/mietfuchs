// Die Angaben zu einem Beleg im Belegordner (#170), soweit sie sich aus der Datei selbst ergeben.
//
// **Das ist der Rückfall, nicht der Regelfall.** Seit #170 hält die Tabelle `uploads` zu jedem
// neu hochgeladenen Beleg Originalname, Art, Hochladezeit und Prüfsumme fest. Zu allem, was davor
// hochgeladen wurde, und zu jedem Beleg aus einem Backup einer älteren Version weiß die Datenbank
// aber nichts, und diese Belege sollen im Belegordner trotzdem vollständig dastehen. Was hier aus
// der Datei gelesen wird, ist deshalb dasselbe, was die Tabelle trüge.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { UploadInfo } from '../../shared/types.ts'

// Hochgeladene Belege heißen `<Date.now()>_<Name>` (diskStore in index.ts). Dreizehn Ziffern
// sind die Millisekunden seit 1970 zwischen 2001 und 2286; was davor oder danach läge, ist kein
// Zeitstempel, sondern ein Name, der zufällig mit Ziffern beginnt.
const STAMP = /^(\d{13})_(.+)$/
const PLAUSIBLE_FROM = Date.UTC(2015, 0, 1)

const stampOf = (file: string): number | null => {
  const match = STAMP.exec(file)
  if (!match) return null
  const ms = Number(match[1])
  return ms >= PLAUSIBLE_FROM ? ms : null
}

export function originalNameOf(file: string): string {
  const match = STAMP.exec(file)
  return match && stampOf(file) !== null ? match[2] : file
}

// **Der Zeitstempel im Namen vor der Zeit der Datei.** Er ist auf die Millisekunde genau und
// übersteht jedes Backup unverändert. Die Zeit der Datei dagegen setzt das Wiederherstellen aus
// dem ZIP-Eintrag, und ein ZIP speichert sie auf zwei Sekunden genau und in Ortszeit ohne Zone:
// Ein Backup aus dem Docker-Image (UTC), eingespielt auf einem Rechner in deutscher Zeit,
// verschöbe die Anzeige um ein bis zwei Stunden.
export function uploadedAtOf(file: string, mtime: Date): string {
  const ms = stampOf(file)
  return new Date(ms ?? mtime.getTime()).toISOString()
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
}

export function mimeTypeOf(file: string): string {
  return MIME_BY_EXTENSION[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

// Die Prüfsumme einer Datei, **gestreamt und asynchron**: Ein Beleg kann 25 MB groß sein, und
// eine Altablage hat Hunderte davon. Synchron gelesen hielte das den ganzen Server an, auch
// /healthz (Durchsicht). Gerechnet wird je Beleg nur einmal; danach steht sie in der Tabelle
// `uploads` (siehe backfill in index.ts).
export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export const sha256Of = (content: Buffer): string => createHash('sha256').update(content).digest('hex')

// Was der Belegordner über eine Datei ohne Eintrag in der Datenbank erfährt. Objekt und Jahr
// fehlen: Ein solcher Beleg liegt, solange er an keiner Position hängt, unzugeordnet im
// Posteingang. Die Prüfsumme kommt mit `sha256`, wenn sie schon gerechnet ist, sonst ist sie leer
// („noch nicht gerechnet“); gelesen wird die Datei hier nie.
//
// Mit `row` (der Zeile aus der Datenbank) gilt, was dort steht; Größe und Zeit der Datei kommen
// immer von der Platte. `null`, wenn der Eintrag keine gewöhnliche Datei ist (ein Unterordner)
// oder zwischen Auflisten und Lesen verschwunden ist: Die Liste übergeht ihn, statt zu scheitern.
export function describeFile(dir: string, file: string, row?: Omit<UploadInfo, 'mtime'>, sha256 = ''): UploadInfo | null {
  let st: fs.Stats
  try {
    st = fs.statSync(path.join(dir, file))
  } catch {
    return null
  }
  if (!st.isFile()) return null
  if (row) return { ...row, file, size: st.size, mtime: st.mtime.toISOString() }
  return {
    file,
    size: st.size,
    mtime: st.mtime.toISOString(),
    originalName: originalNameOf(file),
    mimeType: mimeTypeOf(file),
    uploadedAt: uploadedAtOf(file, st.mtime),
    sha256,
    propertyId: null,
    year: null,
    invoiceDate: null,
    kind: 'receipt',
  }
}

// Alle Belege im Ordner, je Eintrag einzeln: Was sich nicht beschreiben lässt, fällt heraus.
export function describeFolder(dir: string, rows: Map<string, Omit<UploadInfo, 'mtime'>>): UploadInfo[] {
  const list: UploadInfo[] = []
  for (const name of fs.readdirSync(dir)) {
    const info = describeFile(dir, name, rows.get(name))
    if (info) list.push(info)
  }
  return list
}
