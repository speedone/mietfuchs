import { describe, expect, it } from 'vitest'
import type { CostItem, UploadInfo } from './types'
import { buildFolder, coverage, coverageCheck, duplicateHints, inboxFor, inboxOf, matchesQuery, receiptCards } from './receipts'

const upload = (file: string, extra: Partial<UploadInfo> = {}): UploadInfo => ({
  file, size: 10, mtime: '2026-01-02T10:00:00.000Z', originalName: file.replace(/^\d+_/, ''),
  mimeType: file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', uploadedAt: '2026-01-02T10:00:00.000Z',
  sha256: `sha-${file}`, propertyId: null, year: null, invoiceDate: null, kind: 'receipt', ...extra,
})

const item = (id: string, extra: Partial<CostItem> = {}): CostItem => ({
  id, propertyId: 'p1', year: 2025, category: 'Grundsteuer', description: `Position ${id}`, amountCents: 10000, key: 'area', ...extra,
})

describe('Belegordner: Karten', () => {
  it('fasst die Positionen eines Belegs zusammen, über Objekte und Jahre hinweg', () => {
    const cards = receiptCards(
      [upload('1_wasser.pdf'), upload('2_leer.pdf')],
      [
        item('a', { invoiceFile: '1_wasser.pdf', category: 'Wasser/Abwasser', amountCents: 98000, vendor: 'Stadtwerke' }),
        item('b', { invoiceFile: '1_wasser.pdf', category: 'Wasser/Abwasser', amountCents: 26000 }),
        item('c'),
      ],
    )
    const wasser = cards.find((c) => c.upload.file === '1_wasser.pdf')
    expect(wasser?.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(wasser?.amountCents).toBe(124000)
    expect(wasser?.vendor).toBe('Stadtwerke')
    expect(wasser?.years).toEqual([2025])
    expect(wasser?.propertyIds).toEqual(['p1'])
    expect(cards.find((c) => c.upload.file === '2_leer.pdf')?.items).toEqual([])
  })
})

describe('Belegordner: Register nach Kostenart', () => {
  const uploads = [upload('1_gs.pdf'), upload('2_wasser.pdf'), upload('3_alt.pdf'), upload('4_fremd.pdf')]
  const items = [
    item('gs', { invoiceFile: '1_gs.pdf', amountCents: 60000 }),
    item('w1', { invoiceFile: '2_wasser.pdf', category: 'Wasser/Abwasser', amountCents: 98000 }),
    item('w2', { category: 'Wasser/Abwasser', amountCents: 26000 }),
    item('alt', { invoiceFile: '3_alt.pdf', year: 2024 }),
    item('fremd', { invoiceFile: '4_fremd.pdf', propertyId: 'p2' }),
  ]

  it('zeigt Objekt und Jahr der Voreinstellung, in der Reihenfolge der Kostenarten, mit Summe', () => {
    const folder = buildFolder(uploads, items, { propertyId: 'p1', year: 2025 }, '')
    expect(folder.groups.map((g) => g.category)).toEqual(['Grundsteuer', 'Wasser/Abwasser'])
    const wasser = folder.groups[1]
    expect(wasser.sumCents).toBe(124000)
    expect(wasser.cards.map((c) => c.upload.file)).toEqual(['2_wasser.pdf'])
    expect(wasser.missing.map((i) => i.id)).toEqual(['w2'])
  })

  it('„alle Objekte“ nimmt die Positionen jedes Objekts dazu', () => {
    const folder = buildFolder(uploads, items, { propertyId: 'all', year: 2025 }, '')
    expect(folder.groups[0].cards.map((c) => c.upload.file).sort()).toEqual(['1_gs.pdf', '4_fremd.pdf'])
    expect(folder.groups[0].sumCents).toBe(70000)
  })

  it('„alle Jahre“ trennt die Register nach Jahr, das neueste zuerst', () => {
    const folder = buildFolder(uploads, items, { propertyId: 'p1', year: 'all' }, '')
    expect(folder.groups.map((g) => `${g.year} ${g.category}`)).toEqual(['2025 Grundsteuer', '2025 Wasser/Abwasser', '2024 Grundsteuer'])
  })

  it('ein Beleg, der an keiner Position hängt, steht nicht im Register, sondern bei den unzugeordneten', () => {
    const folder = buildFolder([...uploads, upload('9_lose.pdf')], items, { propertyId: 'p1', year: 2025 }, '')
    expect(folder.unlinked.map((c) => c.upload.file)).toEqual(['9_lose.pdf'])
  })

  it('die Suche grenzt Register, Karten und fehlende Positionen ein', () => {
    const folder = buildFolder(uploads, items, { propertyId: 'p1', year: 2025 }, '260,00')
    expect(folder.groups.map((g) => g.category)).toEqual(['Wasser/Abwasser'])
    expect(folder.groups[0].cards).toEqual([])
    expect(folder.groups[0].missing.map((i) => i.id)).toEqual(['w2'])
    // Die Summe des Registers bleibt die ganze Kostenart, sonst sähe ein Suchergebnis wie eine
    // kleinere Rechnung aus.
    expect(folder.groups[0].sumCents).toBe(124000)
  })
})

describe('Belegordner: Suche', () => {
  const card = receiptCards(
    [upload('1767225600000_Bescheid_Grundsteuer.pdf', { originalName: 'Bescheid Grundsteuer.pdf' })],
    [item('a', { invoiceFile: '1767225600000_Bescheid_Grundsteuer.pdf', vendor: 'Stadt Musterhausen', description: 'Grundsteuer B', amountCents: 12840 })],
  )[0]

  it.each([
    ['Rechnungssteller', 'musterhausen'],
    ['Beschreibung', 'steuer b'],
    ['Betrag deutsch', '128,40'],
    ['Betrag mit Euro', '128,40 €'],
    ['Betrag technisch', '128.40'],
    ['Dateiname', 'bescheid'],
    ['Jahr', '2025'],
  ])('findet nach %s', (_, q) => {
    expect(matchesQuery(card, q)).toBe(true)
  })

  it('findet nichts Falsches', () => {
    expect(matchesQuery(card, '128,41')).toBe(false)
    expect(matchesQuery(card, '2024')).toBe(false)
    expect(matchesQuery(card, 'wasser')).toBe(false)
  })

  it('ein Betrag trifft auch die Summe eines Belegs mit mehreren Positionen', () => {
    const multi = receiptCards([upload('1_w.pdf')], [
      item('a', { invoiceFile: '1_w.pdf', amountCents: 98000 }),
      item('b', { invoiceFile: '1_w.pdf', amountCents: 26000 }),
    ])[0]
    expect(matchesQuery(multi, '1.240,00')).toBe(true)
    expect(matchesQuery(multi, '260')).toBe(true)
  })

  it('eine leere Suche lässt alles durch', () => {
    expect(matchesQuery(card, '   ')).toBe(true)
  })
})

describe('Belegordner: Doppelte', () => {
  it('erkennt gleichen Inhalt an der Prüfsumme, auch unter anderem Namen und ohne Positionen', () => {
    const cards = receiptCards([upload('1_a.pdf', { sha256: 'x' }), upload('2_kopie.pdf', { sha256: 'x' }), upload('3_b.pdf', { sha256: 'y' })], [])
    const hints = duplicateHints(cards)
    expect(hints.get('2_kopie.pdf')).toMatch(/gleicher Inhalt wie „a.pdf“/)
    expect(hints.get('1_a.pdf')).toMatch(/gleicher Inhalt wie „kopie.pdf“/)
    expect(hints.has('3_b.pdf')).toBe(false)
  })

  it('gleiche Dateigröße allein ist kein Hinweis mehr', () => {
    const cards = receiptCards([upload('1_a.pdf', { size: 5 }), upload('2_b.pdf', { size: 5 })], [])
    expect(duplicateHints(cards).size).toBe(0)
  })

  it('gleicher Steller, gleiche Summe, gleiches Jahr bleibt ein schwächerer Hinweis', () => {
    const cards = receiptCards([upload('1_a.pdf'), upload('2_b.pdf')], [
      item('a', { invoiceFile: '1_a.pdf', vendor: 'Stadtwerke' }),
      item('b', { invoiceFile: '2_b.pdf', vendor: 'stadtwerke' }),
    ])
    expect(duplicateHints(cards).get('1_a.pdf')).toMatch(/möglicherweise doppelt erfasst/)
  })
})

describe('Belegabdeckung', () => {
  const items = [
    item('a', { amountCents: 60000, invoiceFile: '1_a.pdf' }),
    item('b', { amountCents: 30000 }),
    item('c', { amountCents: 10000, invoiceFile: '9_weg.pdf' }),
    item('null', { amountCents: 0 }),
    item('alt', { year: 2024, amountCents: 5000 }),
    item('fremd', { propertyId: 'p2', amountCents: 5000 }),
  ]

  it('rechnet den Anteil der Kosten mit Beleg je Objekt und Jahr, ohne Positionen über 0 €', () => {
    const cov = coverage(items, { propertyId: 'p1', year: 2025 }, new Set(['1_a.pdf']))
    expect(cov.positions).toBe(3)
    expect(cov.covered).toBe(1)
    expect(cov.totalCents).toBe(100000)
    expect(cov.coveredCents).toBe(60000)
    expect(cov.percent).toBe(60)
    // Ein verknüpfter Beleg, dessen Datei fehlt, zählt als fehlend.
    expect(cov.missing.map((c) => c.id)).toEqual(['b', 'c'])
  })

  it('zeigt 100 % nur, wenn wirklich nichts fehlt', () => {
    const viele = [item('a', { amountCents: 999999, invoiceFile: 'x' }), item('b', { amountCents: 1 })]
    expect(coverage(viele, { propertyId: 'p1', year: 2025 }, null).percent).toBe(99)
  })

  it('eine Gutschrift zählt mit ihrem Betrag, nicht mit ihrem Vorzeichen', () => {
    const cov = coverage([item('a', { amountCents: 10000, invoiceFile: 'x' }), item('g', { amountCents: -10000 })], { propertyId: 'p1', year: 2025 }, null)
    expect(cov.percent).toBe(50)
  })

  it('die Ampel im Cockpit ist grün oder gelb, nie rot: Ein fehlender Beleg ist kein Rechenfehler', () => {
    expect(coverageCheck([item('a', { invoiceFile: 'x' })]).level).toBe('gruen')
    const gelb = coverageCheck([item('a', { invoiceFile: 'x' }), item('b', { description: 'Abwasser' })])
    expect(gelb.level).toBe('gelb')
    expect(gelb.detail).toMatch(/1 von 2 Positionen ohne Beleg/)
    expect(gelb.detail).toMatch(/50 %/)
    expect(coverageCheck([item('b')]).level).toBe('gelb')
    expect(coverageCheck([]).level).toBe('leer')
  })
})

describe('Posteingang', () => {
  const cards = receiptCards([
    upload('1_ohne.pdf'),
    upload('2_hier.pdf', { propertyId: 'p1', year: 2025 }),
    upload('3_anderes-jahr.pdf', { propertyId: 'p1', year: 2024 }),
    upload('4_anderes-objekt.pdf', { propertyId: 'p2' }),
    upload('5_verknuepft.pdf', { propertyId: 'p2', year: 2020 }),
  ], [item('a', { invoiceFile: '5_verknuepft.pdf' })])

  it('zeigt, was Objekt und Jahr der Auswahl zugedacht ist, dazu alles ohne Zuordnung', () => {
    const box = inboxOf(cards, { propertyId: 'p1', year: 2025 })
    expect(box.here.map((c) => c.upload.file)).toEqual(['1_ohne.pdf', '2_hier.pdf'])
    expect(box.elsewhere).toBe(2)
  })

  it('ein verknüpfter Beleg steht nie im Posteingang, auch wenn seine Zeile noch ein Objekt nennt', () => {
    expect(inboxOf(cards, { propertyId: 'all', year: 'all' }).here.map((c) => c.upload.file)).not.toContain('5_verknuepft.pdf')
  })

  it('für eine Position kommen nur Belege ihres Objekts und Jahres oder ohne Zuordnung in Frage', () => {
    expect(inboxFor(cards, item('x', { propertyId: 'p1', year: 2024 })).map((c) => c.upload.file)).toEqual(['1_ohne.pdf', '3_anderes-jahr.pdf'])
  })
})

describe('Zählerfotos (Durchsicht)', () => {
  const cards = receiptCards([upload('1_foto.jpg', { kind: 'meterPhoto' }), upload('2_beleg.pdf')], [])

  it('stehen weder im Posteingang noch bei „nachreichen“ noch bei den Belegen ohne Position', () => {
    expect(inboxOf(cards, { propertyId: 'all', year: 'all' }).here.map((c) => c.upload.file)).toEqual(['2_beleg.pdf'])
    expect(inboxOf(cards, { propertyId: 'all', year: 'all' }).elsewhere).toBe(0)
    expect(inboxFor(cards, item('x')).map((c) => c.upload.file)).toEqual(['2_beleg.pdf'])
    expect(buildFolder(cards.map((c) => c.upload), [], { propertyId: 'all', year: 'all' }, '').unlinked.map((c) => c.upload.file)).toEqual(['2_beleg.pdf'])
  })
})

describe('Cockpit-Zeile mit Dateiliste (Durchsicht)', () => {
  it('ein verknüpfter Beleg, dessen Datei fehlt, zählt wie im Belegordner als fehlend und wird benannt', () => {
    const items = [item('a', { invoiceFile: '1_da.pdf' }), item('b', { invoiceFile: '2_weg.pdf' })]
    const check = coverageCheck(items, new Set(['1_da.pdf']))
    expect(check.level).toBe('gelb')
    expect(check.detail).toMatch(/1 von 2 Positionen ohne Beleg/)
    expect(check.detail).toMatch(/bei 1 fehlt die Datei im Belegordner/)
    expect(coverageCheck(items, new Set(['1_da.pdf', '2_weg.pdf'])).level).toBe('gruen')
  })
})
