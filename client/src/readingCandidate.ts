// Ein erkannter Zählerstand aus der KI-Auswertung (Schuhkarton, #149), wie ihn Schnellerfassung und Kosten zur
// Prüfung zeigen (#490). Der Vorschlag entsteht aus der Antwort des Modells, dem Aufnahmedatum des Fotos und den
// Zählern des Objekts; erst eine Eingabe des Nutzers macht daraus einen eigenen Stand am Eintrag der Warteschlange.
import type { Meter, MeterReadingExtraction, Reading } from './types'
import { autoMatchMeter, scoreReading } from './triage'
import { parseQuantity } from './costForm'

export type ReadingCandidate = {
  meterNumber: string
  value: string
  date: string // YYYY-MM-DD
  hasDate: boolean
  matchedMeterId: string
  replacement: boolean
  oldEndValue: string
  checked: boolean
}

// Zählerstände lesen wie jede Menge (#149): „1.234“ ist 1234 und nicht 1,234. Ein leeres Feld ist
// kein Wert.
export const parseNum = (s: string): number | null => parseQuantity(s)
// Und so ins Feld schreiben, dass dasselbe wieder herauskommt: Als „1.234“ stünde 1,234 m³ da und
// würde als 1234 gelesen.
export const quantityInput = (n: number): string => n.toLocaleString('de-DE', { useGrouping: false, maximumFractionDigits: 6 })

const todayISO = () => new Date().toISOString().slice(0, 10)

// Der Vorschlag aus der Antwort des Modells: Zähler nach der gelesenen Nummer, Datum vom Bild, sonst aus dem Foto,
// sonst heute; angehakt, solange die Ampel nicht rot ist.
export function initialCandidate(r: MeterReadingExtraction, exifDate: string | null, meters: Meter[], readings: Reading[]): ReadingCandidate {
  const matchedMeterId = autoMatchMeter(r.meterNumber ?? null, meters) ?? ''
  const value = r.value ?? null
  const sc = scoreReading({
    meterNumber: r.meterNumber ?? null,
    value,
    hasDate: !!(r.dateOnImage || exifDate),
    matchedMeterId: matchedMeterId || null,
    readings,
  })
  return {
    meterNumber: r.meterNumber ?? '',
    value: value != null ? quantityInput(value) : '',
    date: r.dateOnImage || exifDate || todayISO(),
    hasDate: !!(r.dateOnImage || exifDate),
    matchedMeterId,
    replacement: sc.replacementGuess,
    oldEndValue: sc.suggestedOldEndValue != null ? quantityInput(sc.suggestedOldEndValue) : '',
    checked: sc.level !== 'rot',
  }
}

export const scoreCandidate = (r: ReadingCandidate, readings: Reading[]) =>
  scoreReading({ meterNumber: r.meterNumber || null, value: parseNum(r.value), hasDate: r.hasDate, matchedMeterId: r.matchedMeterId || null, readings })

// Was an POST /api/readings geht, oder `null`, wenn etwas fehlt (Zähler, Stand, beim Wechsel der Endstand des alten).
export function readingBody(r: ReadingCandidate): { meterId: string; date: string; value: number; replacement?: true; oldEndValue?: number } | null {
  const value = parseNum(r.value)
  if (!r.matchedMeterId || value == null) return null
  if (!r.replacement) return { meterId: r.matchedMeterId, date: r.date, value }
  const oldEnd = parseNum(r.oldEndValue)
  if (oldEnd == null) return null
  return { meterId: r.matchedMeterId, date: r.date, value, replacement: true, oldEndValue: oldEnd }
}

// ---------- EXIF-Datum (best effort) ----------
// Liest das Aufnahmedatum (DateTimeOriginal) aus dem JPEG, damit der Nutzer das Ablesedatum nicht
// tippen muss. Schlägt es fehl, greift im Aufrufer der Fallback „heute“. Bewusst minimal gehalten.
export async function readExifDate(file: File): Promise<string | null> {
  if (!/jpe?g/i.test(file.type)) return null
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer()
    const view = new DataView(buf)
    if (view.getUint16(0) !== 0xffd8) return null
    let offset = 2
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset)
      if ((marker & 0xff00) !== 0xff00) break
      const size = view.getUint16(offset + 2)
      if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966 /* 'Exif' */) {
        return parseExifDate(view, offset + 10)
      }
      offset += 2 + size
    }
  } catch {
    /* best effort, das Datum ist optional */
  }
  return null
}

function parseExifDate(view: DataView, tiffStart: number): string | null {
  const little = view.getUint16(tiffStart) === 0x4949
  const u16 = (o: number) => view.getUint16(o, little)
  const u32 = (o: number) => view.getUint32(o, little)
  const findTag = (ifd: number, tag: number): number | null => {
    const count = u16(ifd)
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12
      if (u16(entry) === tag) return entry
    }
    return null
  }
  const readAscii = (entry: number): string => {
    const len = u32(entry + 4)
    const at = len > 4 ? tiffStart + u32(entry + 8) : entry + 8
    let s = ''
    for (let i = 0; i < len - 1; i++) s += String.fromCharCode(view.getUint8(at + i))
    return s
  }
  const ifd0 = tiffStart + u32(tiffStart + 4)
  const candidates: number[] = []
  const exifPtr = findTag(ifd0, 0x8769) // ExifIFD-Zeiger
  if (exifPtr) {
    const dto = findTag(tiffStart + u32(exifPtr + 8), 0x9003) // DateTimeOriginal
    if (dto) candidates.push(dto)
  }
  const dt = findTag(ifd0, 0x0132) // DateTime
  if (dt) candidates.push(dt)
  for (const c of candidates) {
    const m = readAscii(c).match(/^(\d{4}):(\d{2}):(\d{2})/) // "YYYY:MM:DD HH:MM:SS"
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
  }
  return null
}
