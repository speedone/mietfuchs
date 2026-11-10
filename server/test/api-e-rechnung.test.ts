// E-Rechnung beim Hochladen (#189, PR 2): Der Browser schickt das XML aus einem ZUGFeRD-PDF als Feld
// `eInvoiceXml` mit, der Server übernimmt die Angaben ohne KI in die Belegbuchung.
//
// Die Rechnungen sind erfunden oder stammen aus der KoSIT-Testsuite (test/fixtures/e-invoice/HERKUNFT.md).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AssessmentView, EInvoiceView, UploadInfo } from '../../shared/types.ts'
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
    const a = assessmentOf(r.body)
    assert.equal(a.source, 'ki')
    assert.ok(chatRequests(ollama).length > 0)
    // Der Grund steht an der Auswertung, auch nach dem Neuladen, und keine Zeile ist grün.
    assert.ok(a.eInvoiceNotes.some((n) => /Schlussrechnung doppelt/.test(n)), JSON.stringify(a.eInvoiceNotes))
    assert.ok(a.lines.every((l) => l.suggestion?.level === 'rot'))
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

test('E-Rechnung: dieselbe Rechnung als zweites PDF wird erkannt (gleiche Nummer, gleicher Steller)', async () => {
  await withOllama(async (s) => {
    const first = await send(s, '/api/intake', { xml: KOSIT_CII })
    const second = await send(s, '/api/intake', { xml: KOSIT_CII })
    assert.notEqual(fileOf(first.body), fileOf(second.body))
    const reasons = assessmentOf(second.body).lines.flatMap((l) => l.suggestion?.reasons ?? [])
    assert.ok(reasons.some((r) => /Rechnung Nr\. 112233 von Testverkäufer ist schon ausgewertet/.test(r)), reasons.join(' | '))
    assert.ok(assessmentOf(second.body).lines.every((l) => l.suggestion?.level === 'rot'))
    // Das Original bleibt ohne diesen Grund: Doppel ist nur die später ausgewertete.
    const all = await s.api<AssessmentView[]>('/api/assessments')
    const original = all.find((v) => v.file === fileOf(first.body)) ?? assert.fail('Original fehlt')
    const reasonsFirst = original.lines.flatMap((l) => l.suggestion?.reasons ?? [])
    assert.ok(!reasonsFirst.some((r) => /schon ausgewertet/.test(r)), reasonsFirst.join(' | '))
  })
})

// ---------- Reine XML-Datei (PR 3) ----------

const KOSIT_UBL = fs.readFileSync(path.join(FIXTURES, '03.06a-INVOICE_ubl.xml'))
const SVG_MIT_SKRIPT = '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/uploads")</script></svg>'

async function sendXml(s: Server, route: string, content: Buffer | string, name = 'xrechnung.xml', type = 'application/xml') {
  const fd = new FormData()
  fd.append('file', new Blob([content], { type }), name)
  const res = await fetch(`${s.base}${route}`, { method: 'POST', body: fd })
  return { status: res.status, body: await jsonOf<UploadBody & { error?: string }>(res) }
}
const storedFiles = (s: Server) => fs.readdirSync(path.join(s.dataDir, 'uploads'))

test('XML-Datei: eine XRechnung wird als Beleg angenommen, gespeichert als application/xml und nur als Download ausgeliefert', async () => {
  const s = await startServer()
  try {
    // Express nimmt die Route auch in anderer Schreibweise und mit Schrägstrich am Ende (Durchsicht)
    for (const [name, type, content, route] of [['xrechnung.xml', 'application/xml', KOSIT_UBL, '/api/upload'], ['RECHNUNG.XML', 'text/xml', KOSIT_CII, '/API/Upload'], ['ohne-typ.xml', '', KOSIT_UBL, '/api/upload/']] as const) {
      const r = await sendXml(s, route, content, name, type)
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.body)}`)
      const file = fileOf(r.body)
      assert.ok(fs.readFileSync(path.join(s.dataDir, 'uploads', file)).equals(content), 'bytegenau abgelegt')
      const info = (await s.api<UploadInfo[]>('/api/uploads')).find((u) => u.file === file) ?? assert.fail(`${file} fehlt`)
      assert.equal(info.mimeType, 'application/xml')
      const res = await fetch(`${s.base}/uploads/${encodeURIComponent(file)}`)
      assert.equal(res.headers.get('content-type'), 'application/octet-stream')
      assert.equal(res.headers.get('content-disposition'), 'attachment')
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(res.headers.get('content-security-policy'), 'sandbox')
    }
  } finally {
    s.stop()
  }
})

test('XML-Datei: anderes XML, eine Dokumenttyp-Erklärung und getarnte Typen bleiben abgelehnt, nichts bleibt liegen', async () => {
  const s = await startServer()
  try {
    const doctype = `<!DOCTYPE x [<!ENTITY a "b">]>${KOSIT_UBL.toString('utf8').replace(/^<\?xml[^>]*>/, '')}`
    const cases: Array<[string, string, Buffer | string]> = [
      ['Daten.xml', 'application/xml', SVG_MIT_SKRIPT],
      ['Daten.xml', 'application/xml', '<notiz>hallo</notiz>'],
      ['Daten.xml', 'application/xml', doctype],
      ['Daten.xml', 'application/xml', 'kein XML'],
      ['Rechnung.xml', 'image/svg+xml', KOSIT_UBL],
      ['Rechnung.svg', 'application/xml', KOSIT_UBL],
      ['Rechnung.xsl', 'application/xml', KOSIT_UBL],
    ]
    for (const route of ['/api/upload', '/api/intake', '/api/extract']) {
      for (const [name, type, content] of cases) {
        const r = await sendXml(s, route, content, name, type)
        assert.equal(r.status, 400, `${route} ${name} (${type})`)
        assert.match(r.body.error ?? '', /PDF oder Bild/, `${route} ${name}`)
      }
    }
    assert.deepEqual(storedFiles(s), [], 'nichts davon liegt im Belegordner')
    assert.equal((await s.api<UploadInfo[]>('/api/uploads')).length, 0)
  } finally {
    s.stop()
  }
})

test('XML-Datei: die Routen der Heizung nehmen auch eine E-Rechnung nicht als Datei an', async () => {
  const s = await startServer()
  try {
    for (const route of ['/api/heating-plants/x/service-statement', '/api/heating-plants/x/fuel-invoice']) {
      const r = await sendXml(s, route, KOSIT_UBL)
      assert.equal(r.status, 400, route)
      assert.match(r.body.error ?? '', /PDF oder Bild/, route)
    }
    assert.deepEqual(storedFiles(s), [])
  } finally {
    s.stop()
  }
})

test('XML-Datei: Eingang und /api/extract werten sie ohne KI aus, auch aus dem Posteingang', async () => {
  await withOllama(async (s, ollama) => {
    for (const route of ['/api/intake', '/api/extract']) {
      const r = await sendXml(s, route, KOSIT_UBL)
      assert.equal(r.status, 200, `${route}: ${JSON.stringify(r.body)}`)
      const a = assessmentOf(r.body)
      assert.equal(a.source, 'e-rechnung')
      assert.equal(a.totalGrossCents, 180400)
    }
    const stored = await sendXml(s, '/api/upload', KOSIT_CII)
    const again = await send(s, '/api/intake', { existingFile: fileOf(stored.body) })
    assert.equal(again.status, 200)
    assert.equal(assessmentOf(again.body).source, 'e-rechnung')
    assert.equal(chatRequests(ollama).length, 0, 'die KI wird für eine XML-Datei nie gefragt')
  })
})

test('XML-Datei: eine nicht übernommene E-Rechnung bleibt gespeichert, mit Grund und ohne KI', async () => {
  await withOllama(async (s, ollama) => {
    for (const xml of [xmlOf(invoice({ typeCode: '386' })), xmlOf({ ...invoice(), syntax: 'cii' }).replace(/urn:cen\.eu:en16931:2017#compliant#urn:xeinkauf\.de:kosit:xrechnung_3\.0/, 'urn:factur-x.eu:1p0:minimum')]) {
      const r = await sendXml(s, '/api/intake', xml)
      assert.equal(r.status, 502)
      assert.equal(r.body.kept, true)
      assert.equal(r.body.reason, 'e-invoice')
      assert.ok(r.body.eInvoiceRefusal, JSON.stringify(r.body))
      assert.ok(storedFiles(s).includes(fileOf(r.body)), 'der Beleg bleibt liegen')
    }
    assert.equal(chatRequests(ollama).length, 0)
  })
})

test('Rechnungsansicht: GET /api/e-invoice/:file liefert die gelesene Rechnung, Hinweise und Grund', async () => {
  const s = await startServer()
  try {
    const ok = fileOf((await sendXml(s, '/api/upload', KOSIT_UBL)).body)
    const view = await s.api<EInvoiceView>(`/api/e-invoice/${encodeURIComponent(ok)}`)
    assert.equal(view.invoice.number, '112233')
    assert.equal(view.invoice.seller, 'Testverkäufer')
    assert.equal(view.invoice.lines.length, 4)
    assert.equal(view.refusal, null)
    assert.deepEqual(view.notes, [])
    const partial = fileOf((await sendXml(s, '/api/upload', xmlOf(invoice({ typeCode: '386' })))).body)
    const refused = await s.api<EInvoiceView>(`/api/e-invoice/${encodeURIComponent(partial)}`)
    assert.match(refused.refusal ?? '', /Schlussrechnung doppelt/)
    assert.equal(refused.invoice.typeCode, '386')
    // Kein Beleg dieses Namens, ein PDF, ein Ausbruch aus dem Ordner
    assert.equal((await fetch(`${s.base}/api/e-invoice/gibt-es-nicht.xml`)).status, 404)
    const pdf = fileOf((await send(s, '/api/upload', {})).body)
    assert.equal((await fetch(`${s.base}/api/e-invoice/${encodeURIComponent(pdf)}`)).status, 415)
    assert.equal((await fetch(`${s.base}/api/e-invoice/..%2Fmietfuchs.sqlite`)).status, 404)
  } finally {
    s.stop()
  }
})
