// Fehlender Test aus der Bestandsaufnahme (#490): das Aufnahmedatum aus dem Foto eines Zählers (EXIF), damit niemand
// das Ablesedatum tippen muss. Gebaut wird ein kleines JPEG mit APP1-Block, wie Kameras ihn schreiben.
import { expect, test } from 'vitest'
import { readExifDate } from './readingCandidate'

// Ein JPEG mit TIFF-Kopf (`II`, little endian oder `MM`) und den angegebenen Datumsfeldern: DateTimeOriginal im
// Exif-Verzeichnis, DateTime in IFD0.
function jpegWith({ original, plain, big = false }: { original?: string; plain?: string; big?: boolean }): Uint8Array {
  const tiff: number[] = []
  const u16 = (v: number) => (big ? [v >> 8, v & 0xff] : [v & 0xff, v >> 8])
  const u32 = (v: number) => (big ? [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff] : [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24])
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0)
  // IFD0: der Zeiger auf das Exif-Verzeichnis und DateTime
  const ifd0Entries = (original ? 1 : 0) + (plain ? 1 : 0)
  const ifd0At = 8
  const exifAt = ifd0At + 2 + ifd0Entries * 12 + 4
  const exifSize = original ? 2 + 12 + 4 : 0
  let dataAt = exifAt + exifSize
  const data: number[] = []
  const place = (s: string) => { const at = dataAt + data.length; data.push(...ascii(s)); return at }
  const originalAt = original ? place(original) : 0
  const plainAt = plain ? place(plain) : 0
  tiff.push(...(big ? [0x4d, 0x4d] : [0x49, 0x49]), ...u16(42), ...u32(ifd0At))
  tiff.push(...u16(ifd0Entries))
  if (plain) tiff.push(...u16(0x0132), ...u16(2), ...u32(plain.length + 1), ...u32(plainAt))
  if (original) tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt))
  tiff.push(...u32(0))
  if (original) tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(original.length + 1), ...u32(originalAt), ...u32(0))
  tiff.push(...data)
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const size = app1.length + 2
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 0xff, ...app1, 0xff, 0xd9])
}
const file = (bytes: Uint8Array, type = 'image/jpeg') => new File([bytes as BlobPart], 'zaehler.jpg', { type })

test('Aufnahmedatum: DateTimeOriginal aus dem Exif-Verzeichnis, als ISO-Datum', async () => {
  expect(await readExifDate(file(jpegWith({ original: '2025:12:30 14:22:01', plain: '2026:01:05 09:00:00' })))).toBe('2025-12-30')
})

test('Aufnahmedatum: ohne DateTimeOriginal gilt DateTime, auch in der Byte-Folge „MM“', async () => {
  expect(await readExifDate(file(jpegWith({ plain: '2026:01:05 09:00:00' })))).toBe('2026-01-05')
  expect(await readExifDate(file(jpegWith({ original: '2024:12:31 23:59:00', big: true })))).toBe('2024-12-31')
})

test('Aufnahmedatum: kein JPEG, kein Exif oder ein kaputtes Datum ergibt nichts, ohne Fehler', async () => {
  expect(await readExifDate(file(jpegWith({ original: '2025:12:30 14:22:01' }), 'image/png'))).toBeNull()
  expect(await readExifDate(file(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])))).toBeNull()
  expect(await readExifDate(file(Uint8Array.from([0x00, 0x01, 0x02])))).toBeNull()
  expect(await readExifDate(file(jpegWith({ original: 'gestern' })))).toBeNull()
})
