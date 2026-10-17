import { describe, expect, it } from 'vitest'
import { calendarPeriod, calendarYearPeriod, settlementPeriod } from '../../shared/period.ts'
import { PDFDocument } from 'pdf-lib'
import type { CostItem, Settlement, SettlementRow, UploadInfo } from './types'
import type { ReceiptUpload } from './receipts'
import { buildTenantFolderPdf, coverPageCount, pageRows, planTenantFolder, UNREADABLE_TEXT, winAnsiSafe } from './tenantFolder'

const upload = (file: string, mimeType = 'application/pdf'): UploadInfo => ({
  file, size: 1, mtime: '2026-01-01T00:00:00.000Z', originalName: file.replace(/^\d+_/, ''), mimeType,
  uploadedAt: '2026-01-01T00:00:00.000Z', sha256: file, propertyId: null, year: null, invoiceDate: null, kind: 'receipt',
})
const item = (id: string, extra: Partial<CostItem> = {}): CostItem => ({
  id, propertyId: 'p1', period: calendarPeriod(2025), category: 'Grundsteuer', description: `Position ${id}`, amountCents: 10000, key: 'area', ...extra,
})
const row = (costItemId: string, category = 'Grundsteuer'): SettlementRow => ({
  costItemId, category, description: costItemId, totalCents: 10000, keyLabel: '', shareCents: 5000,
})
const settlement = (statements: string[][], landlord: string[] = []): Settlement => ({
  year: 2025, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(2025)), deadline: '2026-12-31', selfUsedShareCents: 0, totalCostsCents: 0, warnings: [], closed: null,
  landlord: { rows: landlord.map((id) => row(id)), totalCents: 0 },
  statements: statements.map((ids, i) => ({
    tenancyId: `t${i}`, unitId: `u${i}`, tenantName: `Mieter ${i}`, unitName: `W${i}`, persons: 1, days: 365, personDays: 365,
    periodStart: '2025-01-01', periodEnd: '2025-12-31', rows: ids.map((id) => row(id)), totalShareCents: 0, total35aCents: 0,
    prepaymentCents: 0, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: 0,
  })),
})

describe('Belegmappe für Mieter: was hineingehört', () => {
  const items = [
    item('gs', { invoiceFile: '1_gs.pdf' }),
    item('w', { category: 'Wasser/Abwasser', invoiceFile: '2_w.pdf' }),
    item('a', { category: 'Wasser/Abwasser', invoiceFile: '2_w.pdf' }),
    item('ohne', { category: 'Gartenpflege' }),
    item('weg', { category: 'Müllabfuhr', invoiceFile: '9_weg.pdf' }),
    item('heiz', { category: 'Heizung und Warmwasser', key: 'amounts', invoiceFile: '3_ista.pdf' }),
    item('verw', { category: 'Nicht umlagefähig', invoiceFile: '4_verw.pdf' }),
  ]
  const uploads = [upload('1_gs.pdf'), upload('2_w.pdf'), upload('3_ista.pdf'), upload('4_verw.pdf')]
  // Reihenfolge der Abrechnung: wie in den Zeilen der Mieter, über alle Mieter vereinigt
  const s = settlement([['w', 'gs', 'heiz'], ['w', 'a', 'ohne', 'weg']], ['verw'])

  it('die umgelegten Positionen in der Reihenfolge der Abrechnung, nicht umlagefähige bleiben draußen', () => {
    const plan = planTenantFolder(s, items, uploads, { includeIndividual: false })
    expect(plan.entries.map((e) => [e.item.id, e.status])).toEqual([
      ['w', 'ok'], ['gs', 'ok'], ['heiz', 'excluded'], ['a', 'ok'], ['ohne', 'none'], ['weg', 'missing'],
    ])
    // Ein Beleg für zwei Positionen kommt einmal hinein
    expect(plan.documents.map((d) => d.upload.file)).toEqual(['2_w.pdf', '1_gs.pdf'])
  })

  it('Belege mit Einzelbeträgen anderer Mieter nur auf ausdrückliche Wahl', () => {
    const plan = planTenantFolder(s, items, uploads, { includeIndividual: true })
    expect(plan.entries.find((e) => e.item.id === 'heiz')?.status).toBe('ok')
    expect(plan.documents.map((d) => d.upload.file)).toEqual(['2_w.pdf', '1_gs.pdf', '3_ista.pdf'])
  })
})

describe('Belegmappe für Mieter: Deckblatt und Seiten', () => {
  it('das Deckblatt nennt je Position die Seite, auf der ihr Beleg beginnt', () => {
    const plan = planTenantFolder(settlement([['a', 'b', 'c']]), [
      item('a', { invoiceFile: 'x.pdf' }), item('b', { invoiceFile: 'y.pdf' }), item('c', { invoiceFile: 'x.pdf' }),
    ], [upload('x.pdf'), upload('y.pdf')], { includeIndividual: false })
    const rows = pageRows(plan, new Map([['x.pdf', 3], ['y.pdf', 2]]))
    const cover = coverPageCount(plan.entries.length)
    expect(cover).toBe(1)
    expect(rows.map((r) => r.page)).toEqual([2, 5, 2])
  })

  it('viele Positionen brauchen mehr als ein Deckblatt', () => {
    expect(coverPageCount(20)).toBe(1)
    expect(coverPageCount(80)).toBeGreaterThan(1)
  })

  it('Text, den die Standardschrift nicht kennt, wird ersetzt statt die Mappe abzubrechen', () => {
    expect(winAnsiSafe('Müll → Straße € § „x“ – ✓')).toBe('Müll -> Straße € § „x“ – ?')
  })
})

describe('Belegmappe für Mieter: die PDF', () => {
  it('besteht aus Deckblatt und allen Seiten der Belege, Bilder auf eigener Seite', async () => {
    const zweiSeiten = await PDFDocument.create()
    zweiSeiten.addPage([300, 400])
    zweiSeiten.addPage([300, 400])
    const pdfBytes = await zweiSeiten.save()
    // 1×1 Bildpunkt, PNG
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
    const plan = planTenantFolder(settlement([['a', 'b']]), [
      item('a', { invoiceFile: 'a.pdf', description: 'Grundsteuer → 2025' }), item('b', { invoiceFile: 'b.png' }),
    ], [upload('a.pdf'), upload('b.png', 'image/png')], { includeIndividual: false })
    const bytes = await buildTenantFolderPdf(plan, {
      title: 'Belegmappe 2025', subtitle: 'Haus Lindenstraße',
      load: async (u) => (u.file === 'a.pdf' ? pdfBytes : png),
      rasterize: async () => { throw new Error('nicht gebraucht') },
    })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1 + 2 + 1)
  })

  it('ein PDF, das sich nicht kopieren lässt, kommt als Bild hinein', async () => {
    const jpeg = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiigD//Z'), (c) => c.charCodeAt(0))
    const plan = planTenantFolder(settlement([['a']]), [item('a', { invoiceFile: 'kaputt.pdf' })], [upload('kaputt.pdf')], { includeIndividual: false })
    const bytes = await buildTenantFolderPdf(plan, {
      title: 't', subtitle: 's',
      load: async () => new TextEncoder().encode('kein PDF'),
      rasterize: async () => [jpeg, jpeg],
    })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1 + 2)
  })
})

describe('Belegmappe für Mieter: verschlüsselte PDFs', () => {
  it('ein verschlüsseltes PDF wird nicht roh kopiert, sondern als Bild übernommen', async () => {
    // Durchsicht: Mit `ignoreEncryption` kopierte pdf-lib verschlüsselte Inhalte unlesbar hinein,
    // und die Mappe zeigte leere Seiten statt des Belegs.
    const quelle = await PDFDocument.create()
    quelle.addPage([300, 400])
    const roh = new TextDecoder('latin1').decode(await quelle.save({ useObjectStreams: false }))
    const verschluesselt = new TextEncoder().encode(roh.replace('trailer\n<<', 'trailer\n<<\n/Encrypt << /Filter /Standard /V 1 /R 2 >>'))
    const jpeg = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiigD//Z'), (c) => c.charCodeAt(0))
    let gerastert = 0
    const plan = planTenantFolder(settlement([['a']]), [item('a', { invoiceFile: 'v.pdf' })], [upload('v.pdf')], { includeIndividual: false })
    await buildTenantFolderPdf(plan, { title: 't', subtitle: 's', load: async () => verschluesselt, rasterize: async () => { gerastert++; return [jpeg] } })
    expect(gerastert).toBe(1)
  })
})

describe('Belegmappe für Mieter: Belege, die einzelne Mieter betreffen (Durchsicht)', () => {
  // Solange es keine Mappe je Mieter gibt, geht die Mappe an jeden Mieter des Objekts. Ein Beleg
  // zu einer Direktzuordnung (Reparatur in einer Wohnung) oder zu einer Position mit Teilnehmern
  // betrifft nur einen Teil der Mieter und kommt deshalb wie die Einzelbeträge nur auf Wahl hinein.
  const items = [
    item('d', { key: 'direct', directUnitId: 'u1', invoiceFile: 'd.pdf' }),
    item('t', { participantUnitIds: ['u1'], invoiceFile: 't.pdf' }),
    item('alle', { participantUnitIds: null, invoiceFile: 'a.pdf' }),
  ]
  const uploads = [upload('d.pdf'), upload('t.pdf'), upload('a.pdf')]
  const s = settlement([['d', 't', 'alle']])

  it('Direktzuordnung und Teilnehmer stehen ohne Wahl „auf Anfrage“', () => {
    const plan = planTenantFolder(s, items, uploads, { includeIndividual: false })
    expect(plan.entries.map((e) => [e.item.id, e.status])).toEqual([['d', 'excluded'], ['t', 'excluded'], ['alle', 'ok']])
  })

  it('mit Wahl kommen sie hinein', () => {
    const plan = planTenantFolder(s, items, uploads, { includeIndividual: true })
    expect(plan.documents.map((d) => d.upload.file)).toEqual(['d.pdf', 't.pdf', 'a.pdf'])
  })
})

describe('Belegmappe für Mieter: nicht lesbare Belege (Durchsicht)', () => {
  it('ein Beleg, der sich weder übernehmen noch rendern lässt, bricht die Mappe nicht ab', async () => {
    const gut = await PDFDocument.create()
    gut.addPage([300, 400])
    const gutBytes = await gut.save()
    const plan = planTenantFolder(settlement([['a', 'b', 'c']]), [
      item('a', { invoiceFile: 'foto.heic' }),
      item('b', { invoiceFile: 'gut.pdf' }),
      item('c', { invoiceFile: 'weg.pdf' }),
    ], [upload('foto.heic', 'image/heic'), upload('gut.pdf'), upload('weg.pdf')], { includeIndividual: false })
    const unlesbar: string[] = []
    const bytes = await buildTenantFolderPdf(plan, {
      title: 't', subtitle: 's',
      // weg.pdf: der Abruf scheitert (etwa 404), foto.heic: kein Browser kann es rendern
      load: async (u) => { if (u.file === 'weg.pdf') throw new Error('HTTP 404'); return u.file === 'gut.pdf' ? gutBytes : new Uint8Array([1, 2, 3]) },
      rasterize: async () => { throw new Error('nicht darstellbar') },
      onUnreadable: (u) => unlesbar.push(u.file),
    })
    expect(unlesbar).toEqual(['foto.heic', 'weg.pdf'])
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1 + 1)
  })

  it('auf dem Deckblatt steht bei einem nicht übernehmbaren Beleg keine Seite, sondern der Hinweis', () => {
    const plan = planTenantFolder(settlement([['a']]), [item('a', { invoiceFile: 'x.pdf' })], [upload('x.pdf')], { includeIndividual: false })
    const [row] = pageRows(plan, new Map([['x.pdf', 0]]), new Set(['x.pdf']))
    expect(row.page).toBeNull()
    expect(row.unreadable).toBe(true)
    expect(UNREADABLE_TEXT).toBe('nicht übernehmbar, bitte gesondert beilegen')
  })
})

describe('Belegmappe für Mieter (#170): Belege über gebuchte Zeilen', () => {
  const abschlag = upload('1_abschlag.pdf')
  const rest: ReceiptUpload = { ...upload('2_rest.pdf'), bookedItemIds: ['st'], assessment: { id: 'a2', propertyId: 'p1', open: false } }

  it('Abschlag und Restrechnung einer Position liegen beide in der Mappe', () => {
    const plan = planTenantFolder(settlement([['st']]), [item('st', { invoiceFile: '1_abschlag.pdf', amountCents: 162000 })], [abschlag, rest], { includeIndividual: false })
    expect(plan.entries.map((e) => e.status)).toEqual(['ok'])
    expect(plan.documents.map((d) => [d.upload.file, d.itemIds])).toEqual([['1_abschlag.pdf', ['st']], ['2_rest.pdf', ['st']]])
  })

  it('fehlt die Datei des invoiceFile, steht „missing“, der Zeilenbeleg liegt trotzdem in der Mappe', () => {
    const plan = planTenantFolder(settlement([['st']]), [item('st', { invoiceFile: '9_weg.pdf' })], [rest], { includeIndividual: false })
    expect(plan.entries.map((e) => e.status)).toEqual(['missing'])
    expect(plan.documents.map((d) => d.upload.file)).toEqual(['2_rest.pdf'])
  })

  it('Einzelbeträge ohne Wahl bleiben „auf Anfrage“, auch wenn die Datei des invoiceFile fehlt; der Zeilenbeleg kommt nicht hinein', () => {
    const plan = planTenantFolder(settlement([['st']]), [item('st', { key: 'amounts', invoiceFile: '9_weg.pdf' })], [rest], { includeIndividual: false })
    expect(plan.entries.map((e) => e.status)).toEqual(['excluded'])
    expect(plan.documents).toEqual([])
  })

  it('eine Position ohne invoiceFile, deren Beleg nur an einer Zeile hängt, hat ihn in der Mappe', () => {
    const plan = planTenantFolder(settlement([['st']]), [item('st')], [rest], { includeIndividual: false })
    expect(plan.entries.map((e) => e.status)).toEqual(['ok'])
    expect(plan.documents.map((d) => d.upload.file)).toEqual(['2_rest.pdf'])
  })
})
