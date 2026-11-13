// Kontoauszüge in Schnellerfassung und Posteingang (#188, Teil 3): Bankdaten gehen nie an eine KI. Eine Datei, die wie
// ein Kontoauszug aussieht, wird an jeder Route der Belege vor jeder Ablage und Auswertung abgewiesen (422 mit
// `bankFile`), nichts bleibt im Belegordner. Eine XRechnung und ein PDF laufen wie bisher.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { startServer, type Server } from '../testing/api.ts'

const fixtures = path.join(import.meta.dirname, 'fixtures')
const CAMT = fs.readFileSync(path.join(fixtures, 'camt', 'kontoauszug-juni.xml'))
const MT940 = fs.readFileSync(path.join(fixtures, 'mt940', fs.readdirSync(path.join(fixtures, 'mt940'))[0] ?? ''))
const zip = (() => {
  const z = new AdmZip()
  z.addFile('auszuege/juni.xml', CAMT)
  return z.toBuffer()
})()
const XRECHNUNG = fs.readFileSync(path.join(fixtures, 'e-invoice', '01.18a-INVOICE_ubl.xml'))
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')

const BANK_TEXT = 'Das ist ein Kontoauszug. Kontoauszüge lesen Sie auf der Seite Kontoauszug ein.'

function send(s: Server, route: string, file: Buffer, name: string): Promise<Response> {
  const fd = new FormData()
  fd.append('file', new Blob([file]), name)
  fd.append('propertyId', 'objekt-1')
  return fetch(`${s.base}${route}`, { method: 'POST', body: fd })
}
const uploads = (s: Server): string[] => {
  const dir = path.join(s.dataDir, 'uploads')
  return fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort() : []
}

test('Kontoauszug an den Routen der Belege: 422 mit bankFile, nichts im Belegordner', async () => {
  const s = await startServer()
  try {
    const before = uploads(s)
    for (const route of ['/api/upload', '/api/intake', '/api/extract']) {
      for (const [file, name] of [[CAMT, 'auszug.xml'], [MT940, 'auszug.sta'], [zip, 'auszuege.zip'], [CAMT, 'rechnung.pdf']] as const) {
        const res = await send(s, route, file, name)
        assert.equal(res.status, 422, `${route} ${name}: ${await res.clone().text()}`)
        assert.deepEqual(await res.json(), { error: BANK_TEXT, bankFile: true })
      }
    }
    assert.deepEqual(uploads(s), before)
  } finally {
    s.child.kill()
    await new Promise((resolve) => s.child.once('exit', resolve))
    fs.rmSync(s.dataDir, { recursive: true, force: true })
  }
})

test('XRechnung und PDF laufen an der Ablage wie bisher', async () => {
  const s = await startServer()
  try {
    assert.equal((await send(s, '/api/upload', XRECHNUNG, 'rechnung.xml')).status, 200)
    assert.equal((await send(s, '/api/upload', PDF, 'rechnung.pdf')).status, 200)
  } finally {
    s.child.kill()
    await new Promise((resolve) => s.child.once('exit', resolve))
    fs.rmSync(s.dataDir, { recursive: true, force: true })
  }
})
