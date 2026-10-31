// Integrationstests gegen den echten Server: Belegbuchung: Befunde der Durchsichten.
//
// Jeder Test startet den Server als eigenen Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner;
// die gemeinsamen Helfer stehen in testing/api.ts. Bis #263 stand dieser Teil mit allen anderen
// in api.test.ts und lief mit ihnen nacheinander.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assessments as assessmentsTable, periodChanges as periodChangesTable, properties as propertiesTable } from '../src/db/schema.ts'
import { eq } from 'drizzle-orm'
import type {
  AssessmentLine, AssessmentView, BookingPreview, CostItem, LineDecision, LineFields, Property, Settlement, Tenancy, Unit, UploadEntry, UploadInfo,
} from '../../shared/types.ts'
import {
  type Evaluated, type FakeInvoice, type Ollama, PAUSE_MS, PDF, RECHNUNGEN, type Server, type Vorschau, assessmentOf, errorFrom, evaluate, grundsteuer, inDatabase, invoiceText, jsonOf, postJson, putJson, restore, startServer, startServerIn, uploadBelegFile, wechsel, withOllama,
} from '../testing/api.ts'

// ---------- Belegbuchung (#170): Befunde der Durchsicht zu Task 4 ----------

const uploadOf = async (s: Server, file: string): Promise<UploadInfo> =>
  (await s.api<UploadInfo[]>('/api/uploads')).find((u) => u.file === file) ?? assert.fail(`der Beleg ${file} fehlt im Ordner`)
const storedAssessmentFiles = (s: Server): Promise<string[]> =>
  inDatabase(s, async (db) => (await db.select({ file: assessmentsTable.file }).from(assessmentsTable)).map((r) => r.file))
async function plainUpload(s: Server, name: string): Promise<string> {
  const fd = new FormData()
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), name)
  const res = await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })
  assert.equal(res.status, 200, await res.clone().text())
  return (await jsonOf<{ file: string }>(res)).file
}
async function evaluateAndCancel(s: Server, ollama: Ollama, marker: string, extra: Record<string, string>): Promise<void> {
  const requestId = 'abcdef0123456789abcdef0123456789'
  const fd = new FormData()
  if (!extra.existingFile) fd.append('file', new Blob([PDF], { type: 'application/pdf' }), `${marker.toLowerCase()}.pdf`)
  fd.append('pdfText', invoiceText(marker))
  fd.append('requestId', requestId)
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  const before = ollama.requests.length
  const pending = fetch(`${s.base}/api/extract`, { method: 'POST', body: fd }).then((r) => r.text()).catch(() => '')
  const deadline = Date.now() + 10_000
  while (!ollama.requests.slice(before).some((r) => r.body.format?.properties?.categories)) {
    if (Date.now() > deadline) assert.fail('der Durchgang der Kostenarten kam nicht an')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal((await fetch(`${s.base}/api/ai/cancel/${requestId}`, { method: 'POST' })).status, 200, 'der Abbruch kam nicht mehr an')
  await pending
  // Die Pause des Servers abwarten: Erst danach würde er speichern.
  await new Promise((resolve) => setTimeout(resolve, PAUSE_MS + 500))
}

test('Belegbuchung: ein Abbruch nach der Antwort der KI speichert keine Auswertung', async () => {
  await withOllama(async (s, ollama) => {
    await evaluateAndCancel(s, ollama, 'GRUNDSTEUER', {})
    assert.deepEqual(await storedAssessmentFiles(s), [], 'nach dem Abbruch steht eine Auswertung in der Datenbank')
  }, { invoices: RECHNUNGEN, env: { NKA_TEST_ASSESSMENT_DELAY_MS: String(PAUSE_MS) } })
})

test('Belegbuchung: ein Abbruch beim erneuten Auswerten eines Belegs aus dem Posteingang lässt die offenen Zeilen stehen', async () => {
  await withOllama(async (s, ollama) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    await evaluateAndCancel(s, ollama, 'WASSER', { existingFile: a.file })
    const after = await s.api<AssessmentView>(`/api/assessments/${a.id}`)
    assert.deepEqual(after.lines.map((l) => [l.idx, l.description, l.amountCents]), [[0, 'Grundsteuer B 2025', 61240]])
    assert.ok(fs.existsSync(path.join(s.dataDir, 'uploads', a.file)), 'der Beleg aus dem Posteingang ist weg')
  }, { invoices: RECHNUNGEN, env: { NKA_TEST_ASSESSMENT_DELAY_MS: String(PAUSE_MS) } })
})

test('Belegbuchung: PUT auf die Auswertung zieht Jahr und Objekt des Belegs mit, solange nichts gebucht ist', async () => {
  await withOllama(async (s) => {
    const zweites = await jsonOf<Property>(await postJson(s, '/api/properties', { name: 'Zweites Haus' }))
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { propertyId: 'objekt-1' }))
    assert.equal((await putJson(s, `/api/assessments/${a.id}`, { year: 2024, propertyId: zweites.id })).status, 200)
    const beleg = await uploadOf(s, a.file)
    assert.deepEqual([beleg.year, beleg.propertyId], [2024, zweites.id])
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: Verschieben im Posteingang zieht die Auswertung mit, solange nichts gebucht ist; gebucht bleibt sie', async () => {
  await withOllama(async (s) => {
    const zweites = await jsonOf<Property>(await postJson(s, '/api/properties', { name: 'Zweites Haus' }))
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { propertyId: 'objekt-1' }))
    assert.equal((await putJson(s, `/api/uploads/${a.file}`, { year: 2023, propertyId: zweites.id })).status, 200)
    const moved = await s.api<AssessmentView>(`/api/assessments/${a.id}`)
    assert.deepEqual([moved.year, moved.propertyId], [2023, zweites.id])

    const b = assessmentOf(await evaluate(s, 'WASSER', { propertyId: 'objekt-1' }))
    const decisions: LineDecision[] = b.lines.map((l) => ({ idx: l.idx, action: 'create', fields: l.suggestion?.fields ?? assert.fail('kein Vorschlag') }))
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${b.id}/plan`, { decisions }))
    assert.equal((await postJson(s, `/api/assessments/${b.id}/book`, { decisions, token: preview.token })).status, 200)
    assert.equal((await putJson(s, `/api/uploads/${b.file}`, { year: 2023, propertyId: zweites.id })).status, 200)
    const kept = await s.api<AssessmentView>(`/api/assessments/${b.id}`)
    assert.deepEqual([kept.year, kept.propertyId], [b.year, 'objekt-1'])
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: beim Speichern bekommt ein Beleg ohne Objekt das Objekt der Auswertung', async () => {
  await withOllama(async (s) => {
    const file = await plainUpload(s, 'ohne-objekt.pdf')
    assert.equal((await uploadOf(s, file)).propertyId, null)
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { existingFile: file }))
    assert.equal(a.propertyId, 'objekt-1')
    const beleg = await uploadOf(s, file)
    assert.deepEqual([beleg.year, beleg.propertyId], [2025, 'objekt-1'])
  }, { invoices: RECHNUNGEN })
})

// Abnahme B3: „Per KI auswerten“ aus dem Posteingang schickte das Jahr der Seitenleiste mit, und das
// überschrieb das Jahr, das am Beleg eingestellt war. Das Jahr des Belegs ist das gewählte.
test('Belegbuchung: aus dem Posteingang gilt das Jahr am Beleg als gewähltes, nicht das der Seitenleiste', async () => {
  await withOllama(async (s) => {
    const file = await plainUpload(s, 'hausmeister.pdf')
    assert.equal((await putJson(s, `/api/uploads/${file}`, { year: 2023, propertyId: 'objekt-1' })).status, 200)
    const a = assessmentOf(await evaluate(s, 'HAUSMEISTER', { existingFile: file, year: '2026' }))
    assert.deepEqual([a.detectedYear, a.year, a.requestedPeriod], [null, 2023, '2023-01'])
    // Nennt der Beleg selbst ein Jahr, geht es weiter vor; verglichen wird mit dem Jahr am Beleg.
    const other = await plainUpload(s, 'vorjahr.pdf')
    assert.equal((await putJson(s, `/api/uploads/${other}`, { year: 2025, propertyId: 'objekt-1' })).status, 200)
    const b = assessmentOf(await evaluate(s, 'VORJAHR', { existingFile: other, year: '2026' }))
    assert.deepEqual([b.detectedYear, b.year, b.requestedPeriod], [2025, 2025, '2025-01'])
    assert.ok(!b.lines.some((l) => l.suggestion?.reasons.some((r) => /gewählt war/.test(r))), 'kein Hinweis auf ein anderes Jahr')
  }, { invoices: RECHNUNGEN })
})

// L1 der Durchsicht von #201: Nach der ersten Auswertung legt der Server den Beleg auf das Jahr aus
// dem Beleg. Ein zweites „Per KI auswerten“ nahm dieses Jahr als gewähltes, die gelbe Zeile wurde
// grün, und „Alle grünen übernehmen“ buchte ungesehen in das andere Jahr. Hat der Beleg schon eine
// Auswertung, gilt deren gewähltes Jahr; ändert der Nutzer das Jahr am Beleg, zieht es mit.
test('Belegbuchung: erneut ausgewertet bleibt das gewählte Jahr der früheren Auswertung', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'WASSER', { year: '2024' }))
    assert.deepEqual([a.year, a.requestedPeriod], [2026, '2024-01'])
    assert.equal((await uploadOf(s, a.file)).year, 2026, 'der Beleg liegt im Jahr aus dem Beleg')
    const again = assessmentOf(await evaluate(s, 'WASSER', { existingFile: a.file, year: '2025' }))
    assert.deepEqual([again.year, again.requestedPeriod], [2026, '2024-01'])
    assert.ok(again.lines.every((l) => l.suggestion?.level !== 'gruen' && l.suggestion?.preselected !== true), 'nicht grün, nicht angehakt')
    assert.ok(again.lines.some((l) => l.suggestion?.reasons.some((r) => /gewählt war 2024/.test(r))))
    // Stellt der Nutzer das Jahr am Beleg um (Belegordner, Posteingang), gilt danach dieses.
    assert.equal((await putJson(s, `/api/uploads/${a.file}`, { year: 2026 })).status, 200)
    const moved = assessmentOf(await evaluate(s, 'WASSER', { existingFile: a.file, year: '2025' }))
    assert.deepEqual([moved.year, moved.requestedPeriod], [2026, '2026-01'])
    assert.ok(!moved.lines.some((l) => l.suggestion?.reasons.some((r) => /gewählt war/.test(r))))
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: nennt der Beleg kein Jahr, gilt das mitgeschickte', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'HAUSMEISTER', { year: '2023' }))
    assert.deepEqual([a.detectedYear, a.year], [null, 2023])
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: die Antwort als Strom trägt die Auswertung', async () => {
  await withOllama(async (s) => {
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'grundsteuer.pdf')
    fd.append('pdfText', invoiceText('GRUNDSTEUER'))
    const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: fd, headers: { accept: 'application/x-ndjson' } })
    assert.equal(res.status, 200)
    const lines: { type: string, data?: Evaluated }[] = (await res.text()).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
    const result = lines.find((l) => l.type === 'result')?.data ?? assert.fail('keine Zeile result im Strom')
    const a = assessmentOf(result)
    assert.deepEqual(a.lines.map((l) => l.description), ['Grundsteuer B 2025'])
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: lässt sich die Prüfsumme nicht rechnen, wird die Auswertung trotzdem gespeichert', async (t) => {
  await withOllama(async (s) => {
    const file = await plainUpload(s, 'unlesbar.pdf')
    const full = path.join(s.dataDir, 'uploads', file)
    fs.chmodSync(full, 0o000)
    try {
      let readable = true
      try { fs.accessSync(full, fs.constants.R_OK) } catch { readable = false }
      // Als root (oder unter Windows) lässt sich die Datei trotz fehlender Rechte lesen; dann gibt
      // es den Fehlerfall nicht, den dieser Test herbeiführen will.
      if (readable) return t.skip('die Datei bleibt lesbar, ein Lesefehler lässt sich hier nicht herbeiführen')
      const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { existingFile: file }))
      assert.equal(a.file, file)
    } finally {
      fs.chmodSync(full, 0o644)
    }
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: der Belegordner kennt gebuchte Zeilen; Löschen der Position öffnet beide Belege wieder', async () => {
  await withOllama(async (s) => {
    const st = await jsonOf<CostItem>(await postJson(s, '/api/costItems', { year: 2026, category: 'Wasser/Abwasser', description: 'Wasser 2026', amountCents: 150000, key: 'area' }))
    const a = assessmentOf(await evaluate(s, 'WASSER'))
    const b = assessmentOf(await evaluate(s, 'NACHTRAG'))
    const book = async (x: AssessmentView, decisions: LineDecision[]) => {
      const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${x.id}/plan`, { decisions }))
      const res = await postJson(s, `/api/assessments/${x.id}/book`, { decisions, token: preview.token })
      assert.equal(res.status, 200, await res.clone().text())
    }
    await book(a, [{ idx: 0, action: 'link', costItemId: st.id }, { idx: 1, action: 'link', costItemId: st.id }])
    await book(b, [{ idx: 0, action: 'link', costItemId: st.id }])
    const entry = async (file: string): Promise<UploadEntry> =>
      (await s.api<UploadEntry[]>('/api/uploads')).find((u) => u.file === file) ?? assert.fail(`kein Beleg ${file}`)
    assert.deepEqual([(await entry(b.file)).bookedItemIds, (await entry(b.file)).assessment?.open], [[st.id], false])
    assert.deepEqual([(await entry(a.file)).bookedCents, (await entry(b.file)).bookedCents], [{ [st.id]: 150000 }, { [st.id]: 12000 }], 'je Beleg die Summe seiner gebuchten Zeilen')
    const [position] = await s.api<CostItem[]>('/api/costItems')
    assert.deepEqual([position?.amountCents, position?.invoiceFile], [162000, a.file], 'Summe beider Belege, die Position trägt den ersten')
    const del = (file: string) => fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'DELETE' })
    assert.equal((await del(b.file)).status, 409, 'ein Beleg mit gebuchter Zeile lässt sich nicht löschen')
    assert.equal((await fetch(`${s.base}/api/costItems/${st.id}`, { method: 'DELETE' })).status, 200)
    for (const f of [a.file, b.file]) {
      const e = await entry(f)
      assert.deepEqual([e.bookedItemIds, e.assessment?.open], [[], true], `${f} ist wieder offen`)
    }
    assert.equal((await del(b.file)).status, 200)
    assert.equal((await fetch(`${s.base}/api/assessments/${b.id}`)).status, 404, 'die Auswertung geht mit dem Beleg')
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: Backup und Wiederherstellen nehmen Auswertungen und gebuchte Zeilen mit', async () => {
  await withOllama(async (s) => {
    const g = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const w = assessmentOf(await evaluate(s, 'WASSER'))
    const decisions = grundsteuer(g)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${g.id}/plan`, { decisions }))
    assert.equal((await postJson(s, `/api/assessments/${g.id}/book`, { decisions, token: preview.token })).status, 200)
    // Der Stand im Archiv: die offene Auswertung samt Zeilen, Beträgen und Vorschlägen, die gebuchte Zeile und ihre Position.
    const openBefore = await s.api<AssessmentView[]>('/api/assessments?open=1')
    const bookedBefore = await s.api<AssessmentView>(`/api/assessments/${g.id}`)
    const [position] = await s.api<CostItem[]>('/api/costItems')
    if (!position) return assert.fail('die gebuchte Position fehlt')
    assert.equal(bookedBefore.lines[0]?.costItemId, position.id)
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    // Danach ändern, damit das Zurückspielen sichtbar wird: Die Position fällt weg, die Zeile wird offen.
    assert.equal((await fetch(`${s.base}/api/costItems/${position.id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await s.api<AssessmentView[]>('/api/assessments?open=1')).length, 2)
    assert.equal((await restore(s, backup)).status, 200)
    const openAfter = await s.api<AssessmentView[]>('/api/assessments?open=1')
    assert.deepEqual(openAfter.map((a) => a.id), [w.id])
    assert.deepEqual(openAfter, openBefore, 'die offene Auswertung steht mit Zeilen, Beträgen und Vorschlägen da wie im Archiv')
    const bookedAfter = await s.api<AssessmentView>(`/api/assessments/${g.id}`)
    assert.deepEqual(bookedAfter, bookedBefore, 'die gebuchte Auswertung steht da wie im Archiv')
    const restored = await s.api<CostItem[]>('/api/costItems')
    assert.deepEqual(restored, [position], 'die Position ist wieder da, genau einmal und unverändert')
    assert.deepEqual([bookedAfter.lines[0]?.state, bookedAfter.lines[0]?.costItemId, bookedAfter.lines[0]?.itemDescription], ['created', position.id, position.description],
      'die gebuchte Zeile zeigt auf die wiederhergestellte Position')
  }, { invoices: RECHNUNGEN })
})

// Ein Beleg aus dem Posteingang noch einmal auswerten, wie „Per KI auswerten“ es tut.
async function evaluateAgain(s: Server, file: string, marker: string): Promise<Evaluated> {
  const fd = new FormData()
  fd.append('existingFile', file)
  // Wie beim ersten Auswerten: Unter 80 Zeichen gälte die Textebene als fehlend.
  fd.append('pdfText', invoiceText(marker))
  const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: fd })
  assert.equal(res.status, 200, await res.clone().text())
  return jsonOf<Evaluated>(res)
}

test('Belegbuchung: die vier Abnahmefälle der Spezifikation über die Routen', async () => {
  await withOllama(async (s) => {
    const book = async (a: AssessmentView, decisions: LineDecision[]): Promise<{ changed: boolean }> => {
      const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
      assert.deepEqual(preview.errors, [])
      const res = await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })
      assert.equal(res.status, 200, await res.clone().text())
      return jsonOf<{ changed: boolean }>(res)
    }
    const fieldsAt = (a: AssessmentView, idx: number) => a.lines.find((l) => l.idx === idx)?.suggestion?.fields ?? assert.fail(`kein Vorschlag zu Zeile ${idx}`)
    const newItem = async (body: Record<string, unknown>) => jsonOf<CostItem>(await postJson(s, '/api/costItems', body))

    // A: Wasser 700 € + 800 € gegen eine Schätzung von 1.500 €
    const wa = await newItem({ year: 2026, category: 'Wasser/Abwasser', description: 'Wasser 2026', amountCents: 150000, key: 'area' })
    const wasser = assessmentOf(await evaluate(s, 'WASSER'))
    const wasserDecisions: LineDecision[] = [{ idx: 0, action: 'link', costItemId: wa.id }, { idx: 1, action: 'link', costItemId: wa.id }]
    await book(wasser, wasserDecisions)

    // B: Restmüll 700 € mit Gutschrift −50 €
    const muell = assessmentOf(await evaluate(s, 'MUELL'))
    await book(muell, [{ idx: 0, action: 'create', fields: fieldsAt(muell, 0) }, { idx: 1, action: 'create', fields: fieldsAt(muell, 1) }])

    // C: Schätzung mit §35a 1.000 €, Rechnung ohne Lohnanteil
    const gp = await newItem({ year: 2026, category: 'Gartenpflege', description: 'Gartenpflege 2026', amountCents: 150000, labor35aCents: 100000, key: 'area' })
    const garten = assessmentOf(await evaluate(s, 'GARTEN'))
    const gartenDecisions: LineDecision[] = [{ idx: 0, action: 'link', costItemId: gp.id }]
    const c = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${garten.id}/plan`, { decisions: gartenDecisions }))
    assert.ok(c.notices.some((n) => /Lohnanteil von 1\.000,00\s€ wird entfernt/.test(n)), c.notices.join('\n'))
    await book(garten, gartenDecisions)

    // D: derselbe Beleg zweimal: wiederholte Buchung ohne Änderung, erneutes Auswerten ohne neue offene Zeile
    assert.equal((await book(wasser, wasserDecisions)).changed, false)
    const again = assessmentOf(await evaluateAgain(s, wasser.file, 'WASSER'))
    assert.deepEqual([again.id, again.open, again.lines.map((l) => l.state)], [wasser.id, false, ['linked', 'linked']])

    const items = await s.api<CostItem[]>('/api/costItems')
    const byDescription = (d: string) => items.filter((i) => i.description === d).map((i) => [i.amountCents, i.labor35aCents ?? null])
    assert.deepEqual(byDescription('Wasser 2026'), [[150000, null]], 'A: eine Position über 1.500 €')
    assert.deepEqual([...byDescription('Restmüll'), ...byDescription('Gutschrift Tonnentausch')], [[70000, null], [-5000, null]], 'B: zwei Positionen')
    assert.deepEqual(byDescription('Gartenpflege 2026'), [[145000, null]], 'C: Lohnanteil entfernt')
    assert.equal(items.length, 4, 'D: nichts doppelt')
  }, { invoices: RECHNUNGEN })
})

// ---------- Integrationsdurchsicht des Stapels #174 → #175 → #184 ----------

const NOCHMAL: Record<string, FakeInvoice> = {
  ZWEIZEILEN: RECHNUNGEN.WASSER ?? assert.fail('Rechnung WASSER fehlt'),
  EINEZEILE: { vendor: 'Stadtwerke Musterstadt', invoiceDate: '2026-02-01', totalGrossEur: 1500, positions: [{ description: 'Wasser und Abwasser', category: 'Wasser/Abwasser', amountEur: 1500 }] },
  GARTENARBEITEN: { vendor: 'Hausmeisterdienst Muster', invoiceDate: '2026-06-30', totalGrossEur: 400, positions: [{ description: 'Gartenarbeiten', category: 'Gartenpflege', amountEur: 400 }] },
}

// Plan und Buchung wie die Oberfläche: erst die Vorschau, dann mit ihrer Marke buchen.
async function planAndBook(s: Server, a: AssessmentView, decisions: LineDecision[]): Promise<{ preview: BookingPreview, status: number }> {
  const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
  const res = await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })
  return { preview, status: res.status }
}
const fieldsOfLine = (l: AssessmentLine | undefined): LineFields => l?.suggestion?.fields ?? assert.fail('kein Vorschlag')
// „Alle grünen übernehmen“ der Oberfläche (client/src/assessment.ts, isGreen).
const greenLines = (a: AssessmentView): AssessmentLine[] =>
  a.lines.filter((l) => l.state === 'open' && !!l.suggestion?.preselected && l.suggestion.level === 'gruen')
const totalOf = async (s: Server): Promise<number> => (await s.api<CostItem[]>('/api/costItems')).reduce((x, i) => x + i.amountCents, 0)

test('H1: ein gebuchter Beleg, erneut ausgewertet, bucht eine berichtigte Zeile nicht still ein zweites Mal', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'ZWEIZEILEN'))
    const [frisch, ab] = a.lines
    // Frischwasser von Hand auf 750 € berichtigt, Abwasser wie gelesen.
    const decisions: LineDecision[] = [
      { idx: 0, action: 'create', fields: { ...fieldsOfLine(frisch), amountCents: 75000 } },
      { idx: 1, action: 'create', fields: fieldsOfLine(ab) },
    ]
    assert.equal((await planAndBook(s, a, decisions)).status, 200)
    assert.equal(await totalOf(s), 155000)

    const again = assessmentOf(await evaluateAgain(s, a.file, 'ZWEIZEILEN'))
    const fresh = again.lines.filter((l) => l.state === 'open')
    assert.equal(fresh.length, 1, 'die berichtigte Zeile kommt mit dem gelesenen Betrag wieder')
    const line = fresh[0] ?? assert.fail('keine offene Zeile')
    assert.equal(line.amountCents, 70000)
    assert.equal(line.suggestion?.level, 'rot')
    assert.equal(line.suggestion?.preselected, false)
    assert.ok(line.suggestion?.reasons.some((r) => /Dieser Beleg ist schon gebucht/.test(r) && /Frischwasser/.test(r) && /verwerfen Sie sie/.test(r)), line.suggestion?.reasons.join(' | '))
    assert.deepEqual(greenLines(again), [], '„Alle grünen übernehmen“ bucht sie nicht')

    // Direkt angelegt, ohne Bestätigung: Rückfrage, gebucht wird nichts.
    const direct: LineDecision[] = [{ idx: line.idx, action: 'create', fields: fieldsOfLine(line) }]
    const { preview, status } = await planAndBook(s, again, direct)
    assert.equal(status, 400)
    assert.ok(preview.confirm.some((c) => c.idx === line.idx && /schon gebucht/.test(c.message)), JSON.stringify(preview.confirm))
    assert.equal(await totalOf(s), 155000, 'keine stille zweite Buchung')
    // Mit ausdrücklicher Bestätigung legt sie an: Es kann eine weitere Zeile derselben Rechnung sein.
    assert.equal((await planAndBook(s, again, [{ ...direct[0] as LineDecision & { action: 'create' }, despiteCandidates: true }])).status, 200)
    assert.equal(await totalOf(s), 225000)
  }, { invoices: NOCHMAL })
})

test('H1: erst eine Zeile über 1.500 € gebucht, erneut ausgewertet zwei Zeilen: beide rot, keine vorab angehakt', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'EINEZEILE'))
    assert.equal((await planAndBook(s, a, [{ idx: 0, action: 'create', fields: fieldsOfLine(a.lines[0]) }])).status, 200)
    const again = assessmentOf(await evaluateAgain(s, a.file, 'ZWEIZEILEN'))
    const fresh = again.lines.filter((l) => l.state === 'open')
    assert.deepEqual(fresh.map((l) => [l.amountCents, l.suggestion?.level, l.suggestion?.preselected]), [[70000, 'rot', false], [80000, 'rot', false]])
    for (const l of fresh) assert.ok(l.suggestion?.candidates.some((c) => c.description === 'Wasser und Abwasser'), 'die gebuchte Position steht als Kandidat da')
    assert.deepEqual(greenLines(again), [])
    const decisions: LineDecision[] = fresh.map((l) => ({ idx: l.idx, action: 'create', fields: fieldsOfLine(l) }))
    const { preview, status } = await planAndBook(s, again, decisions)
    assert.equal(status, 400)
    assert.equal(preview.confirm.length, 2)
    assert.equal(await totalOf(s), 150000)
  }, { invoices: NOCHMAL })
})

test('H1: im gewöhnlichen Ablauf (eine Zeile gebucht, die zweite derselben Auswertung offen) bleibt die zweite grün', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'ZWEIZEILEN'))
    assert.equal((await planAndBook(s, a, [{ idx: 0, action: 'create', fields: fieldsOfLine(a.lines[0]) }])).status, 200)
    const after = await s.api<AssessmentView>(`/api/assessments/${a.id}`)
    const open = after.lines.find((l) => l.idx === 1) ?? assert.fail('Zeile 1 fehlt')
    assert.equal(open.suggestion?.reasons.some((r) => /schon gebucht/.test(r)), false)
    assert.notEqual(open.suggestion?.level, 'rot')
  }, { invoices: NOCHMAL })
})

test('H2: ein Beleg gleichen Inhalts wie ein von Hand angehängter wird nicht still gebucht, auch mit anderer Kostenart', async () => {
  await withOllama(async (s) => {
    // Dieselben Bytes, wie evaluate sie hochlädt: gleiche Prüfsumme.
    const alt = await uploadBelegFile(s, Buffer.concat([PDF, Buffer.from('%GARTENARBEITEN\n')]), 'alt.pdf')
    const hm = await jsonOf<CostItem>(await postJson(s, '/api/costItems', { year: 2026, category: 'Hauswart', description: 'Hausmeisterdienst', amountCents: 40000, key: 'area', invoiceFile: alt }))
    assert.equal(hm.invoiceFile, alt)
    const a = assessmentOf(await evaluate(s, 'GARTENARBEITEN'))
    assert.notEqual(a.file, alt)
    const line = a.lines[0] ?? assert.fail('keine Zeile')
    assert.equal(line.category, 'Gartenpflege')
    assert.equal(line.suggestion?.level, 'rot')
    assert.equal(line.suggestion?.preselected, false)
    assert.ok(line.suggestion?.reasons.some((r) => /gleichem Inhalt/.test(r) && /Hausmeisterdienst/.test(r)), line.suggestion?.reasons.join(' | '))
    assert.ok(line.suggestion?.candidates.some((c) => c.id === hm.id), 'die Position steht als Kandidat da')
    assert.deepEqual(greenLines(a), [])
    const { preview, status } = await planAndBook(s, a, [{ idx: 0, action: 'create', fields: fieldsOfLine(line) }])
    assert.equal(status, 400)
    assert.ok(preview.confirm.some((c) => /gleichem Inhalt/.test(c.message) && /Hausmeisterdienst/.test(c.message)), JSON.stringify(preview.confirm))
    assert.equal(await totalOf(s), 40000, 'keine stille zweite Buchung')
  }, { invoices: NOCHMAL })
})

test('H1: eine erneut ausgewertete Zeile mit einer schon aus diesem Beleg gebuchten Position zu verknüpfen braucht die Bestätigung', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'ZWEIZEILEN'))
    const [frisch, ab] = a.lines
    assert.equal((await planAndBook(s, a, [
      { idx: 0, action: 'create', fields: { ...fieldsOfLine(frisch), amountCents: 75000 } },
      { idx: 1, action: 'create', fields: fieldsOfLine(ab) },
    ])).status, 200)
    const target = (await s.api<CostItem[]>('/api/costItems')).find((i) => i.description === 'Frischwasser') ?? assert.fail('Frischwasser fehlt')
    const again = assessmentOf(await evaluateAgain(s, a.file, 'ZWEIZEILEN'))
    const line = again.lines.find((l) => l.state === 'open') ?? assert.fail('keine offene Zeile')
    const link: LineDecision = { idx: line.idx, action: 'link', costItemId: target.id }
    const { preview, status } = await planAndBook(s, again, [link])
    assert.equal(status, 400)
    const asked = preview.confirm.find((c) => c.idx === line.idx) ?? assert.fail(`keine Rückfrage: ${JSON.stringify(preview)}`)
    assert.match(asked.message, /„Frischwasser“ ist schon aus diesem Beleg gebucht \(750,00\s€\)/)
    assert.match(asked.message, /addiert 700,00\s€ auf 1\.450,00\s€/)
    assert.equal(await totalOf(s), 155000, 'ohne Bestätigung keine Addition')
    assert.equal((await planAndBook(s, again, [{ ...link, despiteCandidates: true }])).status, 200)
    assert.equal(await totalOf(s), 225000)
  }, { invoices: NOCHMAL })
})

test('Alter Tab: Die Kostenliste eines Kalenderobjekts nennt weiter das Jahr (#208)', async () => {
  // Ein Tab von vor dem Update filtert nach `item.year`. Ohne das Feld sähe der Vermieter eine leere
  // Liste und erfasste alles noch einmal.
  const s = await startServer()
  try {
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000, key: 'area' }) })
    const [item] = await s.api<(CostItem & { year?: number })[]>('/api/costItems')
    assert.deepEqual([item?.period, item?.year], ['2025-01', 2025])
  } finally {
    s.stop()
  }
})

test('Zeitraum (#208): die Jahreszahl nur beim Kalenderobjekt, JJJJ-MM mit Zeitraum und Frist, Steuer im Kalenderjahr', async () => {
  const s = await startServer()
  try {
    const kalender = await s.api<Settlement>('/api/settlement/2025')
    assert.deepEqual([kalender.period.key, kalender.period.label, kalender.deadline], ['2025-01', '2025', '2026-12-31'])
    assert.equal((await s.api<Settlement>('/api/settlement/2025-01')).period.label, '2025')

    // Ein zweites Objekt, das Mai bis April abrechnet. In dieser Version setzt das nur die
    // Datenbank selbst (Bedienung: PR 3).
    const mai = await s.api<Property>('/api/properties', { method: 'POST', body: JSON.stringify({ name: 'Gartenweg 3', kind: 'mfh', address: '' }) })
    await inDatabase(s, async (db) => { await db.update(propertiesTable).set({ periodStartMonth: 5 }).where(eq(propertiesTable.id, mai.id)) })
    const q = `?property=${mai.id}`

    const alt = await fetch(`${s.base}/api/settlement/2025${q}`)
    assert.equal(alt.status, 404)
    assert.equal(await errorFrom(alt), 'Den Zeitraum 2025 gibt es für dieses Objekt nicht; meinen Sie 2025/2026 (2025-05)?')
    const neu = await s.api<Settlement>(`/api/settlement/2025-05${q}`)
    assert.deepEqual([neu.period.from, neu.period.to, neu.period.label, neu.deadline, neu.daysInYear], ['2025-05-01', '2026-04-30', '2025/2026', '2027-04-30', 365])
    assert.equal((await fetch(`${s.base}/api/settlement/2025-13${q}`)).status, 400)

    // Abschließen, Versand, Verlauf und Wiederöffnen über denselben Schlüssel.
    const post = (path: string) => fetch(`${s.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal((await post(`/api/settlement/2025-05/close${q}`)).status, 201)
    const doppelt = await post(`/api/settlement/2025-05/close${q}`)
    assert.equal(doppelt.status, 409)
    assert.equal(await errorFrom(doppelt), 'Abrechnung 2025/2026 ist bereits abgeschlossen.')
    const zu = await s.api<Settlement>(`/api/settlement/2025-05${q}`)
    assert.ok(zu.closed, 'abgeschlossen')
    assert.equal(zu.deadline, '2027-04-30')
    await s.api(`/api/settlement/2025-05/close${q}`, { method: 'PUT', body: JSON.stringify({ sentAt: '2026-06-01' }) })
    await s.api(`/api/settlement/2025-05/close${q}`, { method: 'DELETE' })
    assert.equal((await s.api<unknown[]>(`/api/settlement/2025-05/history${q}`)).length, 1)

    // Verbrauch über denselben Zeitraum; das Mietkonto bleibt Kalenderjahr.
    assert.equal((await fetch(`${s.base}/api/consumption/2025${q}`)).status, 404)
    assert.equal((await fetch(`${s.base}/api/consumption/2025-05${q}`)).status, 200)
    assert.equal((await s.api<{ year: number }>(`/api/rentledger/2025${q}`)).year, 2025)
    // Die Steuer rechnet im Kalenderjahr und schöpft aus den Abrechnungen 2024/2025 und 2025/2026 (#208, PR 3).
    const steuer = await s.api<{ settlementPeriods: { label: string }[] }>(`/api/taxreport/2025${q}`)
    assert.deepEqual(steuer.settlementPeriods.map((p) => p.label), ['2024/2025', '2025/2026'])
    assert.equal((await fetch(`${s.base}/api/receipts/tax/2025${q}`)).status, 200)

    // Ein alter Tab schreibt mit Jahreszahl: abgelehnt statt still in einen anderen Zeitraum
    // (Review Focus 1). Die Liste nennt für dieses Objekt kein Jahr, es gäbe keines, das stimmte.
    const altTab = await fetch(`${s.base}/api/costItems${q}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2025, category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area' }),
    })
    assert.equal(altTab.status, 400)
    assert.match(await errorFrom(altTab), /älter als das Programm/)
    await s.api(`/api/costItems${q}`, { method: 'POST', body: JSON.stringify({ period: '2025-05', category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area', taxYear: 2025 }) })
    const [item] = await s.api<(CostItem & { year?: number })[]>(`/api/costItems${q}`)
    assert.deepEqual([item?.period, item?.year], ['2025-05', undefined])
  } finally {
    s.stop()
  }
})

test('Zeitraum (#208): eine vor dem Update abgeschlossene Abrechnung bekommt Zeitraum und Frist von der Route', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-alt-'))
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: {}, units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [],
    closedSettlements: [{
      id: 'alt', year: 2030, closedAt: '2031-01-05', sentAt: null,
      settlement: { year: 2030, daysInYear: 365, statements: [], landlord: { rows: [], totalCents: 0 }, totalCostsCents: 0, warnings: [] },
    }],
  }))
  const s = await startServerIn(dataDir)
  try {
    const alt = await s.api<Settlement>('/api/settlement/2030')
    assert.deepEqual([alt.period.label, alt.deadline, alt.closed?.closedAt], ['2030', '2031-12-31', '2031-01-05'])
    assert.equal(alt.deviation?.deadline, '2031-12-31')
  } finally {
    s.stop()
  }
})

// Durchsicht von #222 (I1): Eine Auswertung ohne Objekt verlor das gewählte Jahr. Später einem Objekt
// zugeordnet, war die Zeile grün und vorab angehakt, und „Alle grünen übernehmen“ buchte ungesehen in
// das Jahr aus dem Beleg. Das gewählte Kalenderjahr bleibt ohne Objekt stehen; beim Zuordnen wird
// daraus der Zeitraum.
test('Belegbuchung: ohne Objekt ausgewertet, danach zugeordnet, bleibt das gewählte Jahr (#208)', async () => {
  await withOllama(async (s) => {
    await s.api<Property>('/api/properties', { method: 'POST', body: JSON.stringify({ name: 'Gartenweg 3', kind: 'mfh', address: '' }) })
    const a = assessmentOf(await evaluate(s, 'WASSER', { year: '2024' }))
    assert.deepEqual([a.propertyId, a.year, a.requestedYear, a.requestedPeriod], [null, 2026, 2024, null])
    const zugeordnet = await s.api<AssessmentView>(`/api/assessments/${a.id}`, { method: 'PUT', body: JSON.stringify({ propertyId: 'objekt-1' }) })
    assert.deepEqual([zugeordnet.requestedYear, zugeordnet.requestedPeriod], [2024, '2024-01'])
    assert.ok(zugeordnet.lines.every((l) => l.suggestion?.level !== 'gruen' && l.suggestion?.preselected !== true), 'nicht grün, nicht angehakt')
    // Gelöst und wieder zugeordnet: dasselbe.
    const geloest = await s.api<AssessmentView>(`/api/assessments/${a.id}`, { method: 'PUT', body: JSON.stringify({ propertyId: null }) })
    assert.deepEqual([geloest.requestedYear, geloest.requestedPeriod], [2024, null])
    const wieder = await s.api<AssessmentView>(`/api/assessments/${a.id}`, { method: 'PUT', body: JSON.stringify({ propertyId: 'objekt-1' }) })
    assert.deepEqual([wieder.requestedYear, wieder.requestedPeriod], [2024, '2024-01'])
    assert.ok(wieder.lines.some((l) => l.suggestion?.reasons.some((r) => /gewählt war 2024/.test(r))))
  }, { invoices: RECHNUNGEN })
})

// Durchsicht von #222 (M1): Ein Tab von vor dem Update setzt die Jahreskorrektur zurück, indem er den
// Schlüssel „2025“ löscht und den Rest schickt. Damit das wirkt, nennt die Liste der Mietverhältnisse
// einem Kalenderobjekt die Jahreskorrektur weiter nach Jahreszahl, wie vor dem Update; die Oberfläche
// dieser Version schickt Zeiträume. Dazu M3: ein ungültiger Zeitraum ist eine 400.
test('Alter Tab: Jahreskorrektur nach Jahreszahl lesen und zurücksetzen; ungültiger Zeitraum ist 400 (#208)', async () => {
  const s = await startServer()
  try {
    const u = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    const t = await s.api<Tenancy>('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: u.id, tenantName: 'A', persons: 1, start: '2024-01-01', prepaymentOverrides: { '2025-01': 2000 } }) })
    const [liste] = await s.api<Tenancy[]>('/api/tenancies')
    assert.deepEqual(liste?.prepaymentOverrides, { 2025: 2000 }, 'der alte Tab liest die Jahreszahl')
    // So setzt ihn der alte Tab zurück: Schlüssel „2025“ gelöscht, der Rest (nichts) geschickt.
    await s.api(`/api/tenancies/${t.id}`, { method: 'PUT', body: JSON.stringify({ prepaymentOverrides: {} }) })
    const [danach] = await s.api<Tenancy[]>('/api/tenancies')
    assert.deepEqual(danach?.prepaymentOverrides, {})
    const kaputt = await fetch(`${s.base}/api/costItems`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ period: '2025-13', category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area' }),
    })
    assert.equal(kaputt.status, 400)
    assert.match(await errorFrom(kaputt), /Ungültiger Zeitraum/)
  } finally {
    s.stop()
  }
})

test('Aufteilen (#208): Vorschau und Speichern über HTTP, 409 bei abgeschlossenem Zeitraum', async () => {
  const s = await startServer()
  try {
    await inDatabase(s, async (db) => { await db.update(propertiesTable).set({ periodStartMonth: 5 }).where(eq(propertiesTable.id, 'objekt-1')) })
    const rumpf = { category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31', taxYear: 2025 }
    const vorschau = await s.api<{ parts: { period: string; amountCents: number }[] }>('/api/costItems/split/preview', { method: 'POST', body: JSON.stringify(rumpf) })
    assert.deepEqual(vorschau.parts.map((p) => [p.period, p.amountCents]), [['2024-05', 15781], ['2025-05', 32219]])
    // Ohne Aufteilen lehnt die gewöhnliche Route ab und nennt den Knopf.
    const einzeln = await fetch(`${s.base}/api/costItems`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...rumpf, period: '2025-05' }) })
    assert.equal(einzeln.status, 400)
    assert.match(await errorFrom(einzeln), /„Aufteilen und speichern“/)
    const angelegt = await s.api<CostItem[]>('/api/costItems/split', { method: 'POST', body: JSON.stringify(rumpf) })
    assert.equal(angelegt.length, 2)
    await s.api('/api/settlement/2025-05/close', { method: 'POST', body: '{}' })
    const zu = await fetch(`${s.base}/api/costItems/split`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rumpf) })
    assert.equal(zu.status, 409)
  } finally {
    s.stop()
  }
})

test('Wechsel des Zeitraums (#208): Vorschau und Speichern über HTTP, 409 ohne Antworten', async () => {
  const s = await startServer()
  try {
    const unit = await s.api<{ id: string }>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    await s.api('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'A', persons: 1, start: '2024-01-01', prepaymentOverrides: { '2025-01': 220000 } }) })
    const [objekt] = await s.api<{ id: string }[]>('/api/properties')
    const id = objekt?.id ?? assert.fail('kein Objekt')
    const next = { startMonth: 1, changes: ['2025-05'] }
    const vorschau = await s.api<{ token: string; overrides: { ask: { period: string }[] }[] }>(`/api/properties/${id}/period/preview`, { method: 'POST', body: JSON.stringify({ rules: next }) })
    assert.deepEqual(vorschau.overrides[0]?.ask.map((a) => a.period), ['2025-01', '2025-05'])
    const ohne = await fetch(`${s.base}/api/properties/${id}/period`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: next }) })
    assert.equal(ohne.status, 409)
    const tenancyId = (await s.api<{ id: string }[]>('/api/tenancies'))[0]?.id ?? assert.fail('kein Mietverhältnis')
    const property = await s.api<{ periodRules: unknown }>(`/api/properties/${id}`, {
      method: 'PUT', body: JSON.stringify({ periodRules: { startMonth: 5, changes: [] } }),
    })
    assert.deepEqual(property.periodRules, { startMonth: 1, changes: [] }, 'PUT /api/properties setzt den Rhythmus nicht')
    const gewechselt = await s.api<{ periodRules: unknown }>(`/api/properties/${id}/period`, {
      method: 'PUT', body: JSON.stringify({ rules: next, answers: { understood: true, token: vorschau.token, overrides: { [tenancyId]: { '2025-01': 70000, '2025-05': null } } } }),
    })
    assert.deepEqual(gewechselt.periodRules, next)
    assert.equal((await s.api<{ period: { label: string } }>('/api/settlement/2025-01')).period.label, '01.01.–30.04.2025')
    const falsch = await fetch(`${s.base}/api/properties/${id}/period/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { startMonth: 0, changes: [] } }) })
    assert.equal(falsch.status, 400)
  } finally {
    s.stop()
  }
})

// Durchsicht von #226 (C1): Ein schon aufgeteilter Teil trägt den ganzen Leistungszeitraum der
// Rechnung, sein Betrag ist aber nur der Anteil seines Zeitraums. Wurde er erneut aufgeteilt, als
// wäre er die ganze Rechnung, wanderten 106,22 € zu den Mietern des anderen Zeitraums.
test('Aufteilen (#208): Ein Teil einer aufgeteilten Rechnung wird nur berichtigt, nie noch einmal aufgeteilt', async () => {
  const s = await startServer()
  try {
    await inDatabase(s, async (db) => { await db.update(propertiesTable).set({ periodStartMonth: 5 }).where(eq(propertiesTable.id, 'objekt-1')) })
    const rumpf = { category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31', taxYear: 2025 }
    await s.api<CostItem[]>('/api/costItems/split', { method: 'POST', body: JSON.stringify(rumpf) })
    const teile = async () => (await s.api<CostItem[]>('/api/costItems')).map((c) => [c.period, c.amountCents]).sort()
    assert.deepEqual(await teile(), [['2024-05', 15781], ['2025-05', 32219]])
    const zweiter = (await s.api<CostItem[]>('/api/costItems')).find((c) => c.period === '2025-05') ?? assert.fail('kein Teil 2025-05')
    const json = { 'content-type': 'application/json' }
    // Den Leistungszeitraum eines Teils ändern: weder über das Aufteilen noch über die gewöhnliche Route.
    const geteilt = await fetch(`${s.base}/api/costItems/${zweiter.id}/split`, { method: 'PUT', headers: json, body: JSON.stringify({ serviceTo: '2025-12-30' }) })
    assert.equal(geteilt.status, 400)
    assert.match(await errorFrom(geteilt), /ist ein Teil einer aufgeteilten Rechnung/)
    const vorschau = await fetch(`${s.base}/api/costItems/${zweiter.id}/split/preview`, { method: 'POST', headers: json, body: JSON.stringify({ serviceTo: '2025-12-30' }) })
    assert.equal(vorschau.status, 400)
    const direkt = await fetch(`${s.base}/api/costItems/${zweiter.id}`, { method: 'PUT', headers: json, body: JSON.stringify({ serviceTo: '2025-12-30' }) })
    assert.equal(direkt.status, 400)
    assert.match(await errorFrom(direkt), /ist ein Teil einer aufgeteilten Rechnung/)
    const umziehen = await fetch(`${s.base}/api/costItems/${zweiter.id}`, { method: 'PUT', headers: json, body: JSON.stringify({ period: '2024-05' }) })
    assert.equal(umziehen.status, 400)
    assert.deepEqual(await teile(), [['2024-05', 15781], ['2025-05', 32219]], 'nichts gewandert')
    // Berichtigen geht: Rechnungssteller und Beleg ändern, Leistungszeitraum und Zeitraum bleiben.
    await s.api(`/api/costItems/${zweiter.id}`, { method: 'PUT', body: JSON.stringify({ vendor: 'Stadtkasse' }) })
    assert.deepEqual(await teile(), [['2024-05', 15781], ['2025-05', 32219]])
  } finally {
    s.stop()
  }
})
// Seit #478 (E1) behält eine Position ihr angegebenes Jahr der Zahlung: keine Frage, keine Klemme. Vorher fragte die
// Vorschau und klemmte 2026 auf 2025; die Werbungskosten wechselten das Jahr, obwohl sich an der Zahlung nichts änderte.
test('Wechsel des Zeitraums (#208, #478): Das angegebene Jahr der Zahlung bleibt, die Vorschau fragt nicht und nennt es', async () => {
  const s = await startServer()
  try {
    await inDatabase(s, async (db) => { await db.update(propertiesTable).set({ periodStartMonth: 5 }).where(eq(propertiesTable.id, 'objekt-1')) })
    // 2024/2025, im Jahr 2026 bezahlt.
    const [item] = [await s.api<CostItem>('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2024-05', category: 'Müllabfuhr', description: 'Müll', amountCents: 10000, key: 'area', taxYear: 2026 }) })]
    const id = (await s.api<{ id: string }[]>('/api/properties'))[0]?.id ?? assert.fail('kein Objekt')
    const regeln = { startMonth: 9, changes: [] }
    const vorschau = await s.api<Vorschau>(`/api/properties/${id}/period/preview`, { method: 'POST', body: JSON.stringify({ rules: regeln }) })
    assert.equal(vorschau.taxYears.find((t) => t.costItemId === item?.id), undefined, 'keine Frage nach dem Jahr der Zahlung')
    // September 2023 bis August 2024: 2026 liegt außerhalb dieser Kalenderjahre, die Vorschau sagt es.
    assert.deepEqual(vorschau.keptTaxYears.filter((k) => k.period === '2023-09').map((k) => [k.costItemId, k.taxYear]), [[item?.id, 2026]])
    const ok = await wechsel(s, id, { rules: regeln, answers: { understood: true, token: vorschau.token, groups: { '2024-05': '2023-09' } } })
    assert.equal(ok.status, 200)
    const nachher = (await s.api<CostItem[]>('/api/costItems')).find((c) => c.id === item?.id)
    assert.deepEqual([nachher?.period, nachher?.taxYear], ['2023-09', 2026])
    // Sie steht in genau einer Steuerübersicht, der des Jahres ihrer Zahlung.
    const jahre = await Promise.all([2023, 2024, 2025, 2026].map(async (y) => (await s.api<{ expenses: { items: { costItemId: string }[] } }>(`/api/taxreport/${y}`)).expenses.items.some((i) => i.costItemId === item?.id)))
    assert.deepEqual(jahre, [false, false, false, true])
  } finally {
    s.stop()
  }
})

test('Wechsel des Zeitraums (#208): Wächst ein Zeitraum über zwei Kalenderjahre, bekommt jede Position ihr Jahr der Zahlung', async () => {
  const s = await startServer()
  try {
    await inDatabase(s, async (db) => {
      await db.update(propertiesTable).set({ periodStartMonth: 1 }).where(eq(propertiesTable.id, 'objekt-1'))
      await db.insert(periodChangesTable).values([{ propertyId: 'objekt-1', fromMonth: '2025-05' }, { propertyId: 'objekt-1', fromMonth: '2026-01' }])
    })
    // Mai bis Dezember 2025 ist ein Kalenderjahr; ohne den Wechsel ab Januar 2026 reicht der Zeitraum bis April 2026.
    const item = await s.api<CostItem>('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-05', category: 'Müllabfuhr', description: 'Müll', amountCents: 10000, key: 'area' }) })
    const id = (await s.api<{ id: string }[]>('/api/properties'))[0]?.id ?? assert.fail('kein Objekt')
    const regeln = { startMonth: 1, changes: ['2025-05'] }
    const vorschau = await s.api<Vorschau>(`/api/properties/${id}/period/preview`, { method: 'POST', body: JSON.stringify({ rules: regeln }) })
    assert.equal(vorschau.taxYears.find((t) => t.key === `${item.id}|2025-05`)?.suggested, 2025)
    assert.equal((await wechsel(s, id, { rules: regeln, answers: { understood: true, token: vorschau.token } })).status, 200)
    assert.equal((await s.api<CostItem[]>('/api/costItems')).find((c) => c.id === item.id)?.taxYear, 2025)
    // Danach lässt sie sich speichern.
    await s.api(`/api/costItems/${item.id}`, { method: 'PUT', body: JSON.stringify({ vendor: 'Stadt' }) })
  } finally {
    s.stop()
  }
})

test('Wechsel des Zeitraums (#208): Eine veraltete Vorschau zieht keine gewachsene Gruppe ungesehen mit (409 mit neuer Vorschau)', async () => {
  const s = await startServer()
  try {
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Müllabfuhr', description: 'Müll', amountCents: 10000, key: 'area' }) })
    const id = (await s.api<{ id: string }[]>('/api/properties'))[0]?.id ?? assert.fail('kein Objekt')
    const regeln = { startMonth: 1, changes: ['2025-05'] }
    const vorschau = await s.api<Vorschau>(`/api/properties/${id}/period/preview`, { method: 'POST', body: JSON.stringify({ rules: regeln }) })
    // In einem zweiten Tab kommt eine Position dazu.
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 20000, key: 'area' }) })
    const alt = await wechsel(s, id, { rules: regeln, answers: { understood: true, token: vorschau.token, groups: { '2025-01': '2025-01' } } })
    assert.equal(alt.status, 409)
    const antwort = await jsonOf<{ error: string; preview: Vorschau }>(alt)
    assert.match(antwort.error, /Vorschau ist nicht mehr aktuell/)
    assert.notEqual(antwort.preview.token, vorschau.token)
    assert.deepEqual((await s.api<{ periodRules: unknown }[]>('/api/properties'))[0]?.periodRules, { startMonth: 1, changes: [] }, 'nichts geschrieben')
    const ohneMarke = await wechsel(s, id, { rules: regeln, answers: { groups: { '2025-01': '2025-01' } } })
    assert.equal(ohneMarke.status, 409)
    assert.equal((await wechsel(s, id, { rules: regeln, answers: { understood: true, token: antwort.preview.token, groups: { '2025-01': '2025-01' } } })).status, 200)
  } finally {
    s.stop()
  }
})

// Nachprüfung von #226 (1): Ein Wechsel der Kostenart zwischen Heizung und kalten Kosten ist kein
// „unverändert“. Sonst stünde eine Heizposition über zwei Zeiträume als kalte ungeteilt in einem,
// und ein Teil einer aufgeteilten Rechnung würde zur Heizposition.
test('Aufteilen (#208): Heizung ↔ kalt über die Kostenart, nicht am Aufteilen vorbei', async () => {
  const s = await startServer()
  try {
    await inDatabase(s, async (db) => { await db.update(propertiesTable).set({ periodStartMonth: 5 }).where(eq(propertiesTable.id, 'objekt-1')) })
    const json = { 'content-type': 'application/json' }
    const heizung = await s.api<CostItem>('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2024-05', category: 'Heizung und Warmwasser', description: 'Wartung', amountCents: 100000, key: 'area', taxYear: 2025, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }) })
    const kalt = await fetch(`${s.base}/api/costItems/${heizung.id}`, { method: 'PUT', headers: json, body: JSON.stringify({ category: 'Grundsteuer' }) })
    assert.equal(kalt.status, 400)
    assert.match(await errorFrom(kalt), /„Aufteilen und speichern“/)
    // Über das Aufteilen geht es.
    const geteilt = await s.api<CostItem[]>(`/api/costItems/${heizung.id}/split`, { method: 'PUT', body: JSON.stringify({ category: 'Grundsteuer' }) })
    assert.deepEqual(geteilt.map((c) => [c.period, c.amountCents]).sort(), [['2024-05', 32877], ['2025-05', 67123]])
    const teil = geteilt.find((c) => c.period === '2025-05') ?? assert.fail('kein Teil')
    const warm = await fetch(`${s.base}/api/costItems/${teil.id}`, { method: 'PUT', headers: json, body: JSON.stringify({ category: 'Heizung und Warmwasser' }) })
    assert.equal(warm.status, 400)
    assert.match(await errorFrom(warm), /ist ein Teil einer aufgeteilten Rechnung/)
  } finally {
    s.stop()
  }
})

// Nachprüfung von #226 (2): Ein Wechsel teilt eine aufgeteilte Rechnung als Ganzes neu und nicht
// jeden Teil für sich, sonst summieren sich die Rundungen; nach Mai → Januar → Mai → September →
// Mai stand ein Cent im falschen Zeitraum.
test('Wechsel des Zeitraums (#208): hin und zurück steht die Rechnung wieder exakt im Schnitt nach Tagen', async () => {
  const s = await startServer()
  try {
    await inDatabase(s, async (db) => { await db.update(propertiesTable).set({ periodStartMonth: 5 }).where(eq(propertiesTable.id, 'objekt-1')) })
    await s.api('/api/costItems/split', { method: 'POST', body: JSON.stringify({ category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31', taxYear: 2025 }) })
    const id = (await s.api<{ id: string }[]>('/api/properties'))[0]?.id ?? assert.fail('kein Objekt')
    const teile = async () => (await s.api<CostItem[]>('/api/costItems')).map((c) => [c.period, c.amountCents]).sort()
    assert.deepEqual(await teile(), [['2024-05', 15781], ['2025-05', 32219]])
    for (const startMonth of [1, 5, 9, 5]) {
      const regeln = { startMonth, changes: [] }
      const vorschau = await s.api<{ token: string; groups: { id: string; suggested: string }[] }>(`/api/properties/${id}/period/preview`, { method: 'POST', body: JSON.stringify({ rules: regeln }) })
      const groups = Object.fromEntries(vorschau.groups.map((g) => [g.id, g.suggested]))
      await s.api(`/api/properties/${id}/period`, { method: 'PUT', body: JSON.stringify({ rules: regeln, answers: { understood: true, token: vorschau.token, groups } }) })
      const summe = (await s.api<CostItem[]>('/api/costItems')).reduce((a, c) => a + c.amountCents, 0)
      assert.equal(summe, 48000, `nach Beginn ${startMonth}: die Summe bleibt`)
    }
    assert.deepEqual(await teile(), [['2024-05', 15781], ['2025-05', 32219]])
  } finally {
    s.stop()
  }
})

// Durchsicht von #490 PR 3, K3: Ein am Beleg korrigiertes Rechnungsdatum (Kostenformular) zieht in seine Auswertung mit;
// deren offene Zeilen buchen sonst mit dem alten Datum ins Jahr der Zahlung.
test('Belegbuchung: das Rechnungsdatum am Beleg zieht in die Auswertung mit, geleert ebenso', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { propertyId: 'objekt-1' }))
    assert.equal((await putJson(s, `/api/uploads/${a.file}`, { invoiceDate: '2025-03-03' })).status, 200)
    assert.equal((await s.api<AssessmentView>(`/api/assessments/${a.id}`)).invoiceDate, '2025-03-03')
    assert.equal((await putJson(s, `/api/uploads/${a.file}`, { invoiceDate: null })).status, 200)
    assert.equal((await s.api<AssessmentView>(`/api/assessments/${a.id}`)).invoiceDate, null)
    // Jahr und Objekt allein lassen das Datum stehen
    assert.equal((await putJson(s, `/api/uploads/${a.file}`, { invoiceDate: '2025-04-04' })).status, 200)
    assert.equal((await putJson(s, `/api/uploads/${a.file}`, { year: 2025 })).status, 200)
    assert.equal((await s.api<AssessmentView>(`/api/assessments/${a.id}`)).invoiceDate, '2025-04-04')
  }, { invoices: RECHNUNGEN })
})
