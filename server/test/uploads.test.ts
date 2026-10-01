// Die Angaben zu einem Beleg im Belegordner (#170), soweit sie sich aus der Datei selbst ergeben.
// Sie sind der Rückfall für jeden Beleg, zu dem die Datenbank nichts weiß: alles, was vor der
// Tabelle hochgeladen wurde, und jeder Beleg aus einem Backup einer älteren Version.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describeFile, mimeTypeOf, originalNameOf, uploadedAtOf, createChecksums } from '../src/uploads.ts'

test('Belegordner: der Originalname ist der Name ohne den Zeitstempel davor', () => {
  assert.equal(originalNameOf('1767225600000_Grundsteuer_2025.pdf'), 'Grundsteuer_2025.pdf')
  // Ohne Zeitstempel (etwa ein Beleg aus einem Backup, von Hand angelegt) bleibt der Name.
  assert.equal(originalNameOf('beleg.pdf'), 'beleg.pdf')
})

test('Belegordner: der Zeitstempel im Namen ist der genaue Zeitpunkt des Hochladens', () => {
  // Die Zeit der Datei taugt dafür nicht: Ein ZIP speichert sie auf zwei Sekunden genau und in
  // Ortszeit ohne Zone, nach dem Wiederherstellen eines Backups aus dem Docker-Image steht sie
  // ein bis zwei Stunden daneben (Kommentar zu #170).
  const mtime = new Date('2026-01-01T09:00:00Z')
  assert.equal(uploadedAtOf('1767225600000_beleg.pdf', mtime), '2026-01-01T00:00:00.000Z')
  assert.equal(uploadedAtOf('beleg.pdf', mtime), '2026-01-01T09:00:00.000Z')
  // Eine Zahl, die kein plausibler Zeitpunkt ist, gilt nicht als Zeitstempel.
  assert.equal(uploadedAtOf('0000000000001_beleg.pdf', mtime), '2026-01-01T09:00:00.000Z')
})

test('Belegordner: die Art der Datei ergibt sich aus der Endung', () => {
  assert.equal(mimeTypeOf('a.PDF'), 'application/pdf')
  assert.equal(mimeTypeOf('a.jpeg'), 'image/jpeg')
  assert.equal(mimeTypeOf('a.jpg'), 'image/jpeg')
  assert.equal(mimeTypeOf('a.png'), 'image/png')
  assert.equal(mimeTypeOf('a.webp'), 'image/webp')
  assert.equal(mimeTypeOf('a.txt'), 'application/octet-stream')
})

test('Belegordner: die Prüfsumme ist SHA-256 über den Inhalt und wird je Stand nur einmal gerechnet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-uploads-'))
  try {
    const file = path.join(dir, '1767225600000_a.pdf')
    fs.writeFileSync(file, '%PDF-eins')
    let reads = 0
    const checksums = createChecksums((p) => { reads++; return fs.readFileSync(p) })
    const erwartet = createHash('sha256').update('%PDF-eins').digest('hex')
    assert.equal(checksums.of(file), erwartet)
    assert.equal(checksums.of(file), erwartet)
    assert.equal(reads, 1, 'unveränderte Datei nicht erneut lesen')
    // Ändert sich die Datei (andere Größe oder Zeit), wird neu gerechnet.
    fs.writeFileSync(file, '%PDF-zwei, länger')
    assert.equal(checksums.of(file), createHash('sha256').update('%PDF-zwei, länger').digest('hex'))
    assert.equal(reads, 2)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Belegordner: ein Beleg ohne Angaben in der Datenbank wird aus der Datei beschrieben', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-uploads-'))
  try {
    const name = '1767225600000_Müll_2025.pdf'
    fs.writeFileSync(path.join(dir, name), '%PDF-x')
    const info = describeFile(dir, name, createChecksums())
    assert.equal(info.file, name)
    assert.equal(info.originalName, 'Müll_2025.pdf')
    assert.equal(info.mimeType, 'application/pdf')
    assert.equal(info.size, 6)
    assert.equal(info.uploadedAt, '2026-01-01T00:00:00.000Z')
    assert.equal(info.sha256, createHash('sha256').update('%PDF-x').digest('hex'))
    assert.match(info.mtime, /^\d{4}-\d{2}-\d{2}T/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
