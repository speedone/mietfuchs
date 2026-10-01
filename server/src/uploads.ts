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

// Prüfsummen, je Stand der Datei nur einmal gerechnet. Ein Belegordner mit ein paar hundert
// Rechnungen läse sonst bei jedem Aufruf der Seite jede Datei vollständig. Der Stand ist Größe
// und Änderungszeit; ändert sich eines davon, wird neu gerechnet.
export type Checksums = { of(file: string): string }

export function createChecksums(read: (file: string) => Buffer = (file) => fs.readFileSync(file)): Checksums {
  const known = new Map<string, { size: number, mtimeMs: number, sha256: string }>()
  return {
    of(file) {
      const st = fs.statSync(file)
      const cached = known.get(file)
      if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached.sha256
      const sha256 = sha256Of(read(file))
      known.set(file, { size: st.size, mtimeMs: st.mtimeMs, sha256 })
      return sha256
    },
  }
}

export const sha256Of = (content: Buffer): string => createHash('sha256').update(content).digest('hex')

// Was der Belegordner über eine Datei ohne Eintrag in der Datenbank erfährt. Objekt und Jahr
// fehlen: Ein solcher Beleg liegt, solange er an keiner Position hängt, unzugeordnet im
// Posteingang.
//
// Mit `row` (der Zeile aus der Datenbank) gilt, was dort steht, und die Datei wird nicht gelesen;
// Größe und Zeit der Datei kommen immer von der Platte.
export function describeFile(dir: string, file: string, checksums: Checksums, row?: Omit<UploadInfo, 'mtime'>): UploadInfo {
  const full = path.join(dir, file)
  const st = fs.statSync(full)
  if (row) return { ...row, file, size: st.size, mtime: st.mtime.toISOString() }
  return {
    file,
    size: st.size,
    mtime: st.mtime.toISOString(),
    originalName: originalNameOf(file),
    mimeType: mimeTypeOf(file),
    uploadedAt: uploadedAtOf(file, st.mtime),
    sha256: checksums.of(full),
    propertyId: null,
    year: null,
    invoiceDate: null,
  }
}
