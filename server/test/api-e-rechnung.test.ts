// E-Rechnung beim Hochladen (#189, PR 2): Der Browser schickt das XML aus einem ZUGFeRD-PDF als Feld
// `eInvoiceXml` mit, der Server übernimmt die Angaben ohne KI in die Belegbuchung.
//
// Die Rechnungen sind erfunden oder stammen aus der KoSIT-Testsuite (test/fixtures/e-invoice/HERKUNFT.md).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UploadInfo } from '../../shared/types.ts'
import type { JournalGroupView } from '../src/db/journal.ts'
import { type ClientSettings, LONG_TEXT, PDF, type UploadBody, chatRequests, fileOf, jsonOf, startServer, withOllama, type Server } from '../testing/api.ts'
import { invoice, xmlOf } from '../testing/eInvoiceXml.ts'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'e-invoice')
const KOSIT_CII = fs.readFileSync(path.join(FIXTURES, '03.06a-INVOICE_uncefact.xml'))
const UNREACHABLE = 'http://127.0.0.1:9' // Port 9 nimmt keine Verbindung an

type Upload = { existingFile?: string, xml?: Buffer | string, text?: string }

async function send(s: Server, route: string, { existingFile, xml, text }: Upload) {
  const fd = new FormData()
  if (existingFile) fd.append('existingFile', existingFile)
  else fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'zugferd.pdf')
  if (xml !== undefined) fd.append('eInvoiceXml', new Blob([xml], { type: 'application/xml' }), 'factur-x.xml')
  if (text !== undefined) fd.append('pdfText', text)
  const res = await fetch(`${s.base}${route}`, { method: 'POST', body: fd })
  return { status: res.status, body: await jsonOf<UploadBody>(res) }
}

const assessmentOf = (body: UploadBody) => body.assessment ?? assert.fail(`keine Auswertung: ${JSON.stringify(body)}`)

test('E-Rechnung: ZUGFeRD-PDF wird ohne KI ausgewertet, mit Herkunft und Verlaufseintrag', async () => {
  await withOllama(async (s, ollama) => {
    const r = await send(s, '/api/intake', { xml: KOSIT_CII, text: LONG_TEXT })
    assert.equal(r.status, 200)
    const a = assessmentOf(r.body)
    assert.equal(a.source, 'e-rechnung')
    assert.equal(a.invoiceNumber, '112233')
    assert.deepEqual(a.lines.map((l) => l.amountCents), [119000, 11900, -10000, 59500])
    assert.equal(a.totalGrossCents, 180400)
    assert.equal(r.body.extraction?.vendor, 'Testverkäufer')
    assert.equal(chatRequests(ollama).length, 0, 'die KI wird nicht gefragt')
    const journal = await jsonOf<JournalGroupView[]>(await fetch(`${s.base}/api/journal?limit=5`))
    assert.ok(journal.some((g) => g.description === 'Beleg aus der E-Rechnung übernommen'), JSON.stringify(journal.map((g) => g.description)))
  })
})

test('E-Rechnung: auch über /api/extract', async () => {
  await withOllama(async (s, ollama) => {
    const r = await send(s, '/api/extract', { xml: KOSIT_CII })
    assert.equal(r.status, 200)
    assert.equal(assessmentOf(r.body).source, 'e-rechnung')
    assert.equal(chatRequests(ollama).length, 0)
  })
})

test('E-Rechnung: funktioniert, wenn keine KI erreichbar ist', async () => {
  const s = await startServer()
  try {
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaUrl: UNREACHABLE }) })
    const r = await send(s, '/api/intake', { xml: KOSIT_CII })
    assert.equal(r.status, 200)
    assert.equal(assessmentOf(r.body).source, 'e-rechnung')
  } finally {
    s.stop()
  }
})

test('E-Rechnung: erneut auswerten aus dem Posteingang mit existingFile', async () => {
  await withOllama(async (s, ollama) => {
    const first = await send(s, '/api/intake', { xml: KOSIT_CII })
    const file = fileOf(first.body)
    const again = await send(s, '/api/intake', { existingFile: file, xml: KOSIT_CII })
    assert.equal(again.status, 200)
    assert.equal(fileOf(again.body), file)
    assert.equal(assessmentOf(again.body).source, 'e-rechnung')
    assert.equal(chatRequests(ollama).length, 0)
  })
})

test('E-Rechnung: das XML wird nicht im Belegordner abgelegt', async () => {
  await withOllama(async (s) => {
    const r = await send(s, '/api/intake', { xml: KOSIT_CII })
    const stored = await s.api<UploadInfo[]>('/api/uploads')
    assert.deepEqual(stored.map((u) => u.file), [fileOf(r.body)])
  })
})

test('E-Rechnung: eine Abschlagsrechnung geht an die KI, die Antwort nennt den Grund', async () => {
  await withOllama(async (s, ollama) => {
    const r = await send(s, '/api/intake', { xml: xmlOf(invoice({ typeCode: '386' })), text: LONG_TEXT })
    assert.equal(r.status, 200)
    assert.match(r.body.eInvoiceRefusal ?? '', /Schlussrechnung doppelt/)
    assert.equal(assessmentOf(r.body).source, 'ki')
    assert.ok(chatRequests(ollama).length > 0)
  })
})

test('E-Rechnung: abgelehnt und keine KI erreichbar, der Beleg bleibt gespeichert und die Meldung nennt den Grund', async () => {
  const s = await startServer()
  try {
    await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaUrl: UNREACHABLE }) })
    const r = await send(s, '/api/intake', { xml: xmlOf(invoice({ typeCode: '386' })), text: LONG_TEXT })
    assert.equal(r.status, 502)
    assert.equal(r.body.kept, true)
    assert.match(r.body.eInvoiceRefusal ?? '', /Schlussrechnung doppelt/)
  } finally {
    s.stop()
  }
})

test('E-Rechnung: eine Dokumenttyp-Erklärung wird abgelehnt, nicht ausgeführt', async () => {
  await withOllama(async (s) => {
    const r = await send(s, '/api/intake', { xml: '<!DOCTYPE x [<!ENTITY a "b">]><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>', text: LONG_TEXT })
    assert.equal(r.status, 200)
    assert.match(r.body.eInvoiceRefusal ?? '', /Dokumenttyp/)
  })
})

test('E-Rechnung: anderes XML im Feld ist keine E-Rechnung, der KI-Weg bleibt unverändert', async () => {
  await withOllama(async (s, ollama) => {
    const r = await send(s, '/api/intake', { xml: '<notiz>hallo</notiz>', text: LONG_TEXT })
    assert.equal(r.status, 200)
    assert.equal(r.body.eInvoiceRefusal, undefined)
    assert.ok(chatRequests(ollama).length > 0)
  })
})
