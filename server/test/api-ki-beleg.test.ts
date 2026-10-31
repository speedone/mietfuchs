// Integrationstests gegen den echten Server: KI-Auswertung mit Text und Seitenbildern, Ollama per Umgebung, Kontext und Nachdenken.
//
// Jeder Test startet den Server als eigenen Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner;
// die gemeinsamen Helfer stehen in testing/api.ts. Bis #263 stand dieser Teil mit allen anderen
// in api.test.ts und lief mit ihnen nacheinander.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CostItem, UploadInfo } from '../../shared/types.ts'
import {
  type ClientSettings, LONG_TEXT, PDF, type UploadBody, base64, chatOptions, chatRequests, errorFrom, errorOf, fakeOllama, fileOf, firstMessage, jsonOf, page, startServer, storedSettings, uploadPdf, withEnv, withOllama,
} from '../testing/api.ts'

// ---------- KI-Auswertung: Text und Seitenbilder kommen aus dem Browser (#21) ----------

test('KI-Auswertung: PDF mit Textebene geht als Text an Ollama, ohne Bilder', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT, pages: [page(1)] })
    assert.equal(r.status, 200)
    assert.equal(r.body.extraction?.vendor, 'Stadtwerke Musterstadt')
    const m = firstMessage(ollama)
    assert.match(m.content, /RECHNUNGSTEXT/)
    assert.ok(m.content.includes(LONG_TEXT))
    assert.equal(m.images, undefined) // brauchbarer Text hat Vorrang vor Bildern
  })
})

test('KI-Auswertung: Scan ohne Textebene geht mit den Seitenbildern aus dem Browser an Ollama', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/extract', { text: 'kurz', pages: [page(1), page(2)] })
    assert.equal(r.status, 200)
    const m = firstMessage(ollama)
    assert.deepEqual(m.images, [base64(1), base64(2)])
    assert.doesNotMatch(m.content, /RECHNUNGSTEXT/)
  })
})

test('KI-Auswertung: ohne Text und ohne Seitenbilder eine klare Meldung, Ollama wird nicht gefragt', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/extract')
    assert.equal(r.status, 502)
    assert.match(errorOf(r.body), /Oberfläche/)
    assert.equal(chatRequests(ollama).length, 0)
  })
})

test('KI-Auswertung: Seitenbilder landen nicht im Belegarchiv', async () => {
  await withOllama(async (s) => {
    const uploadsBefore = (await s.api<UploadInfo[]>('/api/uploads')).length
    await uploadPdf(s, '/api/extract', { pages: [page(1), page(2), page(3)] })
    const uploadsAfter = await s.api<UploadInfo[]>('/api/uploads')
    assert.equal(uploadsAfter.length, uploadsBefore + 1)
    assert.match(uploadsAfter.map((u) => u.file).join(' '), /rechnung\.pdf/)
  })
})

test('KI-Auswertung: mehr als vier Seitenbilder lehnt der Server ab, ohne Reste im Archiv', async () => {
  await withOllama(async (s, ollama) => {
    const uploadsBefore = (await s.api<UploadInfo[]>('/api/uploads')).length
    const r = await uploadPdf(s, '/api/extract', { pages: [1, 2, 3, 4, 5].map(page) })
    assert.equal(r.status, 400)
    assert.match(errorOf(r.body), /Höchstens 4 Seitenbilder/)
    assert.equal(chatRequests(ollama).length, 0)
    assert.equal((await s.api<UploadInfo[]>('/api/uploads')).length, uploadsBefore)
  })
})

test('KI-Auswertung: der Schuhkarton nimmt auch die Textebene', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/intake', { text: LONG_TEXT })
    assert.equal(r.status, 200)
    assert.ok(firstMessage(ollama).content.includes(LONG_TEXT))
  })
})

test('KI-Auswertung: nur Bilder zählen als Seitenbilder', async () => {
  await withOllama(async (s, ollama) => {
    const notAnImage = new Blob([Buffer.from('<script>')], { type: 'text/html' })
    const r = await uploadPdf(s, '/api/extract', { pages: [page(1), notAnImage] })
    assert.equal(r.status, 200)
    assert.deepEqual(firstMessage(ollama).images, [base64(1)])
  })
})

test('KI-Auswertung: ein Seitenbild über 5 MB wird abgelehnt, ohne Reste im Archiv', async () => {
  await withOllama(async (s, ollama) => {
    const huge = new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: 'image/jpeg' })
    const r = await uploadPdf(s, '/api/extract', { pages: [huge] })
    assert.equal(r.status, 400)
    assert.match(errorOf(r.body), /Seitenbild ist größer als 5 MB/)
    assert.equal(chatRequests(ollama).length, 0)
    assert.equal((await s.api<UploadInfo[]>('/api/uploads')).length, 0)
  })
})

test('KI-Auswertung: ein überlanger Text ergibt eine lesbare Meldung', async () => {
  await withOllama(async (s) => {
    const r = await uploadPdf(s, '/api/extract', { text: 'x'.repeat(1024 * 1024 + 1) })
    assert.equal(r.status, 400)
    assert.match(errorOf(r.body), /Textfeld ist zu lang/)
    assert.equal((await s.api<UploadInfo[]>('/api/uploads')).length, 0)
  })
})

test('KI-Auswertung: ein Foto geht wie bisher als Bild an Ollama', async () => {
  await withOllama(async (s, ollama) => {
    const photo = Buffer.from('JPEG-Foto')
    const fd = new FormData()
    fd.append('file', new Blob([photo], { type: 'image/jpeg' }), 'rechnung.jpg')
    const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: fd })
    assert.equal(res.status, 200)
    assert.deepEqual(firstMessage(ollama).images, [photo.toString('base64')])
  })
})

test('Beleg anhängen: /api/upload legt die Datei ins Belegarchiv, sie ist abrufbar', async () => {
  const s = await startServer()
  try {
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'Beleg Müll 2025.pdf')
    const res = await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })
    assert.equal(res.status, 200)
    const file = fileOf(await jsonOf<UploadBody>(res))
    assert.match(file, /^\d+_Beleg_Müll_2025\.pdf$/)
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file])
    const download = await fetch(`${s.base}/uploads/${encodeURIComponent(file)}`)
    assert.equal(download.status, 200)
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), PDF)
  } finally {
    s.stop()
  }
})

test('Belegarchiv: ein verknüpfter Beleg lässt sich nicht löschen', async () => {
  // **Der Schutz muss die Datenbank fragen und nicht die db.json.** Fragte er die Datei, sähe
  // er nach dem Umstieg einen leeren Bestand, jeder Beleg gälte als unbenutzt, und ein Klick im
  // Belegarchiv löschte die Rechnung unter einer Kostenposition weg. Die Oberfläche zeigte
  // danach eine Position ohne Beleg, und die Datei wäre fort.
  const s = await startServer()
  try {
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'Rechnung.pdf')
    const file = fileOf(await jsonOf<UploadBody>(await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })))

    const item = await s.api<CostItem>('/api/costItems', {
      method: 'POST',
      body: JSON.stringify({
        year: 2025, category: 'Müllabfuhr', description: 'Abfall', amountCents: 12000,
        key: 'area', invoiceFile: file,
      }),
    })

    const verweigert = await fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'DELETE' })
    assert.equal(verweigert.status, 409)
    assert.match(await errorFrom(verweigert), /verknüpft/)
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file], 'die Datei ist weg')

    // Ohne Kostenposition darf sie weg, sonst bliebe im Archiv für immer liegen, was niemand
    // mehr braucht.
    await s.api(`/api/costItems/${item.id}`, { method: 'DELETE' })
    const gelöscht = await fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'DELETE' })
    assert.equal(gelöscht.status, 200)
    assert.deepEqual(await s.api<UploadInfo[]>('/api/uploads'), [])
  } finally {
    s.stop()
  }
})

test('Beleg anhängen: Umlaute in zerlegter Unicode-Form (macOS) werden zusammengesetzt', async () => {
  const s = await startServer()
  try {
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'Müll.pdf') // „ü“ als u + Trema
    const file = fileOf(await jsonOf<UploadBody>(await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })))
    assert.match(file, /^\d+_Müll\.pdf$/)
  } finally {
    s.stop()
  }
})

test('Hochladen: ein abgebrochener Upload ergibt JSON statt einer HTML-Fehlerseite', async () => {
  const s = await startServer()
  try {
    const res = await fetch(`${s.base}/api/upload`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=grenze' },
      body: '--grenze\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-abgebrochen',
    })
    assert.ok(res.status >= 400)
    assert.match(res.headers.get('content-type') ?? '', /json/)
    assert.equal(typeof (await jsonOf<{ error?: string }>(res)).error, 'string')
  } finally {
    s.stop()
  }
})

test('Hochladen: eine zu große Datei ergibt eine lesbare Meldung statt einer HTML-Seite', async () => {
  const s = await startServer()
  try {
    const fd = new FormData()
    fd.append('file', new Blob([Buffer.alloc(25 * 1024 * 1024 + 1)], { type: 'application/pdf' }), 'riesig.pdf')
    const res = await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })
    assert.equal(res.status, 400)
    assert.match(await errorFrom(res), /größer als 25 MB/)
    assert.equal((await s.api<UploadInfo[]>('/api/uploads')).length, 0)
  } finally {
    s.stop()
  }
})

test('KI-Auswertung: der Schuhkarton (/api/intake) nimmt die Seitenbilder ebenso', async () => {
  await withOllama(async (s, ollama) => {
    const r = await uploadPdf(s, '/api/intake', { pages: [page(1)] })
    assert.equal(r.status, 200)
    assert.equal(r.body.kind, 'rechnung')
    assert.deepEqual(firstMessage(ollama).images, [base64(1)])
  })
})

// ---------- Ollama per Umgebungsvariable (#17) ----------

test('Ollama: NKA_OLLAMA_URL und NKA_OLLAMA_MODEL gelten und sind als fest markiert', async () => {
  await withEnv({ NKA_OLLAMA_URL: 'http://ki.intern:11434', NKA_OLLAMA_MODEL: 'env-modell:4b' }, async (s) => {
    const settings = await s.api<ClientSettings>('/api/settings')
    assert.equal(settings.ollamaUrl, 'http://ki.intern:11434')
    assert.equal(settings.ollamaModel, 'env-modell:4b')
    // Die alten Namen für Tabs von vor dem Update, dazu die Pfade der KI-Einstellungen
    assert.deepEqual(settings.fixedByEnv, ['ollamaUrl', 'ollamaModel', 'ai.text.url', 'ai.text.model'])
    assert.equal(settings.ai.text.url, 'http://ki.intern:11434')
    assert.equal(settings.ai.text.model, 'env-modell:4b')
  })
})

test('Ollama: Speichern lässt fest vorgegebene Werte unberührt, alles andere wird gespeichert', async () => {
  await withEnv({ NKA_OLLAMA_URL: 'http://ki.intern:11434' }, async (s) => {
    const response = await s.api<ClientSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ollamaUrl: 'http://anders:11434', ollamaModel: 'eigenes:2b', landlordName: 'Vermieterin', fixedByEnv: [] }),
    })
    assert.equal(response.ollamaUrl, 'http://ki.intern:11434')
    assert.deepEqual(response.fixedByEnv, ['ollamaUrl', 'ai.text.url'])
    const stored = await storedSettings(s)
    assert.equal(stored.ollamaUrl, 'http://localhost:11434') // Standard bleibt, Env landet nicht in der db.json
    assert.equal(stored.ai.text.url, 'http://localhost:11434')
    assert.equal(stored.ollamaModel, 'eigenes:2b')
    assert.equal(stored.ai.text.model, 'eigenes:2b')
    assert.equal(stored.landlordName, 'Vermieterin')
    assert.equal(stored.fixedByEnv, undefined)
  })
})

test('Ollama: Variablen aus der Shell des Entwicklers erreichen die Test-Server nicht', async () => {
  // Wer NKA_OLLAMA_URL für sein eigenes Ollama gesetzt hat, soll keine Testbelege dorthin schicken
  const saved: Record<string, string | undefined> = { NKA_OLLAMA_URL: process.env.NKA_OLLAMA_URL, NKA_OLLAMA_CANDIDATES: process.env.NKA_OLLAMA_CANDIDATES }
  process.env.NKA_OLLAMA_URL = 'http://aus-der-shell.invalid:11434'
  process.env.NKA_OLLAMA_CANDIDATES = 'http://aus-der-shell.invalid:11434'
  try {
    const s = await startServer()
    try {
      const settings = await s.api<ClientSettings>('/api/settings')
      assert.deepEqual(settings.fixedByEnv, [])
      assert.equal(settings.ollamaUrl, 'http://localhost:11434')
    } finally {
      s.stop()
    }
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('Ollama: leere Umgebungsvariablen zählen als nicht gesetzt', async () => {
  await withEnv({ NKA_OLLAMA_URL: '', NKA_OLLAMA_MODEL: '  ' }, async (s) => {
    const settings = await s.api<ClientSettings>('/api/settings')
    assert.deepEqual(settings.fixedByEnv, [])
    assert.equal(settings.ollamaUrl, 'http://localhost:11434')
  })
})

test('Ollama: die Auswertung nutzt Adresse und Modell aus der Umgebung', async () => {
  const ollama = await fakeOllama({ models: [{ name: 'env-modell:4b', capabilities: ['completion'] }] })
  try {
    await withEnv({ NKA_OLLAMA_URL: ollama.url, NKA_OLLAMA_MODEL: 'env-modell:4b' }, async (s) => {
      await s.api<ClientSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ollamaModel: 'db-modell' }) })
      const r = await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
      assert.equal(r.status, 200)
      assert.equal(chatRequests(ollama)[0].body.model, 'env-modell:4b')
    })
  } finally {
    ollama.stop()
  }
})

// ---------- Ollama: Kontext und Nachdenken (#17) ----------

test('Ollama: jede Anfrage setzt festen Kontext, Temperatur 0 und schaltet das Nachdenken ab', async () => {
  await withOllama(async (s, ollama) => {
    await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
    await uploadPdf(s, '/api/extract', { pages: [page(1)] })
    const options = chatOptions(ollama)
    assert.ok(options.length >= 3) // Auswertung und Kategorien-Durchgang
    // Gleiche Werte in allen Anfragen, sonst lädt Ollama das Modell jedes Mal neu
    for (const o of options) assert.deepEqual(o, { think: false, temperature: 0, num_ctx: 16384 })
  })
})

// Ungültige Werte verhindern den Start (siehe „fehlerhafte Schlüssel-Variablen“ weiter unten)
test('Ollama: NKA_OLLAMA_NUM_CTX ändert die Kontextgröße', async () => {
  const ollama = await fakeOllama()
  try {
    await withEnv({ NKA_OLLAMA_URL: ollama.url, NKA_OLLAMA_MODEL: 'test', NKA_OLLAMA_NUM_CTX: '8192' }, async (s) => {
      await uploadPdf(s, '/api/extract', { text: LONG_TEXT })
      assert.equal(chatOptions(ollama)[0].num_ctx, 8192)
      assert.ok((await s.api<ClientSettings>('/api/settings')).fixedByEnv.includes('ai.numCtx'))
    })
  } finally {
    ollama.stop()
  }
})

// #490: Schnellerfassung und Kosten werten beide über den Schuhkarton aus. Für eine Rechnung muss er sich verhalten
// wie /api/extract: dieselbe Auswertung, dieselben Zeilen, dieselbe gespeicherte Belegbuchung, nur mit `kind`.
// Ein PDF fragt das Modell nicht nach der Belegart (nur ein Bild tut das), also dieselben Anfragen.
test('KI-Auswertung: der Schuhkarton antwortet auf eine Rechnung wie /api/extract', async () => {
  type Answer = UploadBody & { assessment?: { propertyId: string | null; year: number; open: boolean; lines: { description: string; amountCents: number | null; state: string }[] } | null }
  const send = async (s: Parameters<typeof uploadPdf>[0], route: string) => {
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'rechnung.pdf')
    fd.append('pdfText', LONG_TEXT)
    fd.append('year', '2025')
    const res = await fetch(`${s.base}${route}`, { method: 'POST', body: fd })
    return { status: res.status, body: await jsonOf<Answer>(res) }
  }
  await withOllama(async (s, ollama) => {
    const extract = await send(s, '/api/extract')
    const asked = chatRequests(ollama).length
    const intake = await send(s, '/api/intake')
    assert.equal(extract.status, 200)
    assert.equal(intake.status, 200)
    assert.equal(intake.body.kind, 'rechnung')
    assert.equal(chatRequests(ollama).length - asked, asked)
    assert.deepEqual(intake.body.extraction, extract.body.extraction)
    const lines = (b: Answer) => b.assessment?.lines.map(({ description, amountCents, state }) => ({ description, amountCents, state }))
    assert.ok(extract.body.assessment, 'die Auswertung ist gespeichert')
    assert.ok((lines(extract.body)?.length ?? 0) > 0, 'die Auswertung hat Zeilen')
    assert.deepEqual(lines(intake.body), lines(extract.body))
    assert.deepEqual([intake.body.assessment?.propertyId, intake.body.assessment?.year, intake.body.assessment?.open], [extract.body.assessment?.propertyId, extract.body.assessment?.year, extract.body.assessment?.open])
    // Beide Belege liegen im Posteingang
    assert.equal((await s.api<UploadInfo[]>('/api/uploads')).length, 2)
  })
})
