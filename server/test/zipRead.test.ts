// Das Lesen hochgeladener ZIP-Archive (server/src/zipRead.ts): Grenzen an einer Stelle, geprüft
// am Verzeichnis, bevor ein Eintrag ausgepackt wird, und beim Auspacken noch einmal am Strom.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { openZip, ZipRefusal, type ZipLimits } from '../src/zipRead.ts'
import { craftZip, storedEntry, zeroEntry, zip64Claim } from '../testing/zipCraft.ts'

const LIMITS: ZipLimits = {
  maxEntries: 100, maxEntryBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024,
  maxRatio: 100, ratioAbove: 64 * 1024, maxNameBytes: 300,
}

async function refusal(source: Buffer, limits = LIMITS): Promise<ZipRefusal> {
  try {
    const zip = await openZip(source, limits)
    try {
      for (const item of zip.items) if (!item.isDirectory) await zip.read(item, limits.maxEntryBytes)
    } finally {
      zip.close()
    }
  } catch (err) {
    if (err instanceof ZipRefusal) return err
    throw err
  }
  return assert.fail('das Archiv wurde nicht abgelehnt')
}

test('ZIP lesen: Namen, Inhalte und Zeiten kommen so heraus, wie adm-zip sie geschrieben hat', async () => {
  const when = new Date('2023-03-14T10:20:30Z')
  const old = new AdmZip()
  old.addFile('db.json', Buffer.from('{"a":1}'))
  old.addFile('uploads/1700000000000_Gebührenbescheid_Müll.pdf', Buffer.from('%PDF-ü'))
  for (const e of old.getEntries()) e.header.time = when
  const zip = await openZip(old.toBuffer(), LIMITS)
  try {
    assert.deepEqual(zip.items.map((i) => i.name), ['db.json', 'uploads/1700000000000_Gebührenbescheid_Müll.pdf'])
    assert.equal((await zip.read(zip.items[1], 1000)).toString(), '%PDF-ü')
    assert.ok(Math.abs(zip.items[1].time.getTime() - when.getTime()) <= 2000)
  } finally {
    zip.close()
  }
})

test('ZIP lesen: auspacken auf die Platte setzt Inhalt und Datum', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zipread-'))
  try {
    const data = crypto.randomBytes(200 * 1024)
    const old = new AdmZip()
    old.addFile('uploads/a.pdf', data)
    const when = new Date('2021-06-01T08:00:00Z')
    old.getEntries()[0].header.time = when
    const zip = await openZip(old.toBuffer(), LIMITS)
    const target = path.join(dir, 'a.pdf')
    try {
      await zip.extract(zip.items[0], target)
    } finally {
      zip.close()
    }
    assert.ok(fs.readFileSync(target).equals(data))
    assert.ok(Math.abs(fs.statSync(target).mtime.getTime() - when.getTime()) <= 2000)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ZIP lesen: zu viele Einträge werden am Ende des Archivs gezählt, bevor einer gelesen wird', async () => {
  const many = craftZip(Array.from({ length: 101 }, (_, i) => storedEntry(`uploads/${i}`, '')))
  assert.equal((await refusal(many)).kind, 'entries')
  // Ein ZIP64-Ende, das fünf Millionen Einträge ankündigt: abgelehnt, ohne einen zu suchen.
  const start = performance.now()
  const claim = await refusal(zip64Claim(5_000_000), { ...LIMITS, maxEntries: 100_000 })
  assert.equal(claim.kind, 'entries')
  assert.match(claim.message, /100\.000 Einträge/)
  assert.ok(performance.now() - start < 250)
})

test('ZIP lesen: ein Eintrag, der größer ist als erlaubt, wird am Verzeichnis abgelehnt', async () => {
  const r = await refusal(craftZip([await zeroEntry('uploads/a.pdf', 2 * 1024 * 1024)]), { ...LIMITS, maxRatio: 1e9 })
  assert.equal(r.kind, 'entry-size')
})

test('ZIP lesen: die Summe aller Einträge hat eine Grenze', async () => {
  const entries = await Promise.all(Array.from({ length: 5 }, (_, i) => zeroEntry(`uploads/${i}`, 1000 * 1024)))
  assert.equal((await refusal(craftZip(entries), { ...LIMITS, maxRatio: 1e9 })).kind, 'total')
})

test('ZIP lesen: was sich auf ein Vielfaches auspacken würde, wird abgelehnt (Entpackbombe)', async () => {
  // Echte Belege (PDF, JPEG) sind schon gepackt; Nullbytes lassen sich tausendfach verdichten.
  const bomb = craftZip([await zeroEntry('uploads/a.pdf', 512 * 1024)])
  assert.ok(bomb.length < 2 * 1024)
  assert.equal((await refusal(bomb)).kind, 'ratio')
  // Unterhalb der Schwelle gilt die Grenze nicht: Eine kleine, fast leere Datei ist kein Angriff.
  const small = await openZip(craftZip([await zeroEntry('uploads/b.pdf', 32 * 1024)]), LIMITS)
  small.close()
})

test('ZIP lesen: ein Eintrag, der mehr enthält als das Verzeichnis angibt, bricht beim Lesen ab', async () => {
  const liar = craftZip([await zeroEntry('uploads/a.pdf', 50 * 1024 * 1024, 1000)])
  const r = await refusal(liar)
  assert.equal(r.kind, 'damaged')
})

test('ZIP lesen: eine falsche Prüfsumme wird bemerkt', async () => {
  const entry = storedEntry('uploads/a.pdf', 'Inhalt')
  const r = await refusal(craftZip([{ ...entry, crc: 12345 }]))
  assert.equal(r.kind, 'damaged')
})

test('ZIP lesen: Namen, die aus dem Ziel ausbrechen, werden abgelehnt', async () => {
  for (const name of ['../boese.txt', 'uploads/../../boese.txt', '/etc/passwd', 'C:/Windows/boese.txt', 'uploads\\..\\boese.txt']) {
    assert.equal((await refusal(craftZip([storedEntry(name, 'x')]))).kind, 'name', name)
  }
  assert.equal((await refusal(craftZip([storedEntry(`uploads/${'x'.repeat(400)}`, 'x')]))).kind, 'name')
})

test('ZIP lesen: was kein ZIP ist, heißt so', async () => {
  assert.equal((await refusal(Buffer.from('kein ZIP'))).kind, 'not-zip')
})

test('ZIP lesen: aus einer Datei auf der Platte wie aus dem Speicher', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zipread-'))
  try {
    const old = new AdmZip()
    old.addFile('db.json', Buffer.from('{}'))
    const file = path.join(dir, 'a.zip')
    fs.writeFileSync(file, old.toBuffer())
    const zip = await openZip(file, LIMITS)
    try {
      assert.equal((await zip.read(zip.items[0], 10)).toString(), '{}')
      // Mehr als erlaubt wird nicht gelesen.
      await assert.rejects(zip.read(zip.items[0], 1), ZipRefusal)
    } finally {
      zip.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ZIP lesen: Namen ohne UTF-8-Kennzeichen liest es wie adm-zip, und Umlaute bleiben Umlaute', async () => {
  // Ein ausgepacktes und neu gepacktes Backup (ältere Packprogramme, manche Werkzeuge unter
  // Windows) führt die Namen als UTF-8, ohne es zu kennzeichnen. yauzl läse sie nach der Norm als
  // CP437, aus „Müll.pdf“ würde „M├╝ll.pdf“, und die Kostenposition verlöre still ihren Beleg.
  const ohne = storedEntry('uploads/1700000000000_Müll.pdf', 'x')
  // Echtes CP437 (0x81 ist dort „ü“) bleibt lesbar, weil es kein gültiges UTF-8 ist.
  const cp437 = { ...storedEntry('uploads/Gebühr.pdf', 'y'), rawName: Buffer.from([...Buffer.from('uploads/Geb'), 0x81, ...Buffer.from('hr.pdf')]) }
  // Zerlegte Umlaute (macOS) werden zusammengesetzt, wie der Server Namen beim Hochladen ablegt.
  const nfd = storedEntry('uploads/Übersicht.pdf'.normalize('NFD'), 'z')
  const zip = await openZip(craftZip([{ ...ohne, utf8: false }, { ...cp437, utf8: false }, nfd]), LIMITS)
  try {
    assert.deepEqual(zip.items.map((i) => i.name), ['uploads/1700000000000_Müll.pdf', 'uploads/Gebühr.pdf', 'uploads/Übersicht.pdf'])
  } finally {
    zip.close()
  }
  // Und die Prüfung der Namen gilt weiter, auch ohne Kennzeichen.
  assert.equal((await refusal(craftZip([{ ...storedEntry('../böse.txt', 'x'), utf8: false }]))).kind, 'name')
})
