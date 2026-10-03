import { describe, expect, it } from 'vitest'
import type { CostItem, UploadInfo } from './types'
import { amountCheckBody, amountCheckMode, attachChoices, buildFolder, coverage, coverageCheck, duplicateHints, filesByItem, inboxFor, inboxOf, matchesQuery, receiptCards } from './receipts'

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

// Befund C: Ein Beleg aus dem Posteingang wird einer bestehenden Position zugeordnet. Die Liste
// nannte alle Positionen ohne Beleg ohne Vorschlag, und der geschätzte Betrag einer übernommenen
// Position blieb ohne Hinweis stehen.
describe('Posteingang: einer Position zuordnen', () => {
  const open = [
    item('wasser', { category: 'Wasser/Abwasser', description: 'Wasser 2025' }),
    item('gs', { category: 'Grundsteuer', description: 'Grundsteuer 2025' }),
    item('sonst', { category: 'Sonstige Betriebskosten', description: 'Wartung Hebeanlage' }),
  ]
  it('Positionen der Kostenart, die der Name des Belegs nennt, stehen oben (gemeinsame Regel)', () => {
    const c = attachChoices(upload('1_Grundsteuerbescheid_2025.pdf'), open)
    expect(c.category).toBe('Grundsteuer')
    expect(c.likely.map((i) => i.id)).toEqual(['gs'])
    expect(c.rest.map((i) => i.id)).toEqual(['wasser', 'sonst'])
  })
  it('ohne erkennbare Kostenart bleibt die Liste, wie sie ist', () => {
    const c = attachChoices(upload('1_scan0042.pdf'), open)
    expect(c.category).toBeNull()
    expect(c.likely).toEqual([])
    expect(c.rest.map((i) => i.id)).toEqual(['wasser', 'gs', 'sonst'])
  })
  it('bei einer breiten Kostenart nur mit ähnlicher Beschreibung', () => {
    const c = attachChoices(upload('1_Rechnung.pdf'), open)
    expect(c.likely).toEqual([])
  })
  it('ein zerlegtes „ü“ im Dateinamen (NFD, macOS) erkennt die Kostenart ebenso', () => {
    const muell = item('m', { category: 'Müllabfuhr', description: 'Müll 2025' })
    const c = attachChoices(upload('1_Mu\u0308llgebu\u0308hren.pdf'), [...open, muell])
    expect(c.category).toBe('Müllabfuhr')
    expect(c.likely.map((i) => i.id)).toEqual(['m'])
  })
  it('Betrag prüfen: bei Einzelbeträgen und Gemeinschaftsabrechnung im Formular, sonst im Feld', () => {
    expect(amountCheckMode(item('a', { key: 'amounts', tenancyAmounts: { t1: 100 } }))).toBe('form')
    expect(amountCheckMode(item('e', { key: 'external' }))).toBe('form')
    expect(amountCheckMode(item('g'))).toBe('field')
  })
  it('Betrag prüfen: ein Lohnanteil über dem neuen Betrag verweist ins Formular', () => {
    expect(amountCheckBody('500,00', item('g', { labor35aCents: 80000 }))).toEqual({
      error: expect.stringMatching(/§35a-Lohnanteil der Position \(800,00\s€\) liegt über dem neuen Betrag.*Formular/), form: true,
    })
    expect(amountCheckBody('-50,00', item('g', { labor35aCents: 1000 }))).toMatchObject({ form: true })
  })
  it('Betrag prüfen: ein neuer Betrag wird gespeichert, mit derselben Prüfung wie im Formular', () => {
    expect(amountCheckBody('612,40', item('gs'))).toEqual({ body: { amountCents: 61240 } })
    expect(amountCheckBody('0', item('gs'))).toMatchObject({ error: expect.stringMatching(/0 €/) })
    expect(amountCheckBody('abc', item('gs'))).toMatchObject({ error: expect.stringMatching(/Euro-Betrag/) })
  })
})

describe('Belegbuchung (#170): Belege, die über eine verknüpfte Zeile an einer Position hängen', () => {
  const abschlag = upload('1_abschlag.pdf')
  const rest = { ...upload('2_rest.pdf'), bookedItemIds: ['st'], assessment: { id: 'a2', propertyId: 'p1', open: false } }
  const offen = { ...upload('3_offen.pdf'), bookedItemIds: [], assessment: { id: 'a3', propertyId: 'p1', open: true } }
  const st = item('st', { category: 'Beleuchtung/Allgemeinstrom', invoiceFile: '1_abschlag.pdf', amountCents: 80000 })

  it('die Karte nennt die Position, und der Beleg steht nicht im Posteingang', () => {
    const cards = receiptCards([abschlag, rest, offen], [st])
    expect(cards.find((c) => c.upload.file === '2_rest.pdf')?.items.map((i) => i.id)).toEqual(['st'])
    expect(inboxOf(cards, { propertyId: 'all', year: 'all' }).here.map((c) => c.upload.file)).toEqual(['3_offen.pdf'])
  })

  it('im Register stehen beide Belege der Position', () => {
    const folder = buildFolder([abschlag, rest], [st], { propertyId: 'all', year: 'all' }, '')
    expect(folder.groups[0]?.cards.map((c) => c.upload.file)).toEqual(['1_abschlag.pdf', '2_rest.pdf'])
    expect(folder.groups[0]?.missing).toEqual([])
  })

  it('zählt für die Belegabdeckung wie der Beleg der Position, auch wenn dessen Datei fehlt', () => {
    const ohneEigene = item('st', { category: 'Beleuchtung/Allgemeinstrom', invoiceFile: '9_weg.pdf', amountCents: 80000 })
    const present = new Set(['2_rest.pdf'])
    expect(coverage([ohneEigene], { propertyId: 'all', year: 'all' }, present).covered).toBe(0)
    expect(coverage([ohneEigene], { propertyId: 'all', year: 'all' }, present, filesByItem([rest])).covered).toBe(1)
    expect(coverageCheck([ohneEigene], present, filesByItem([rest])).level).toBe('gruen')
  })

  it('zwei Belege derselben Position mit verschiedenen Zeilensummen gelten nicht als doppelt', () => {
    const position = item('st', { category: 'Beleuchtung/Allgemeinstrom', invoiceFile: '1_abschlag.pdf', amountCents: 162000, vendor: 'Stadtwerke' })
    const a = { ...abschlag, bookedItemIds: ['st'], bookedCents: { st: 150000 } }
    const b = { ...rest, bookedCents: { st: 12000 } }
    expect(duplicateHints(receiptCards([a, b], [position])).size).toBe(0)
  })

  it('derselbe Betrag zweimal an einer Position (Scan und PDF) ergibt den Hinweis', () => {
    const position = item('st', { category: 'Beleuchtung/Allgemeinstrom', invoiceFile: '1_abschlag.pdf', amountCents: 24000, vendor: 'Stadtwerke' })
    const scan = { ...upload('1_scan.pdf'), bookedItemIds: ['st'], bookedCents: { st: 12000 } }
    const pdf = { ...upload('2_pdf.pdf'), bookedItemIds: ['st'], bookedCents: { st: 12000 } }
    expect([...duplicateHints(receiptCards([scan, pdf], [position])).keys()]).toEqual(['1_scan.pdf', '2_pdf.pdf'])
  })

  it('die Karte eines Belegs mit gebuchten Zeilen nennt deren Summe, ein Beleg ohne Zeilen den Betrag der Position', () => {
    const position = item('st', { category: 'Beleuchtung/Allgemeinstrom', invoiceFile: '1_abschlag.pdf', amountCents: 162000 })
    const mitZeilen = { ...abschlag, bookedItemIds: ['st'], bookedCents: { st: 150000 } }
    const zweiter = { ...rest, bookedCents: { st: 12000 } }
    const cards = receiptCards([mitZeilen, zweiter], [position])
    expect(cards.map((c) => c.amountCents)).toEqual([150000, 12000])
    expect(receiptCards([abschlag], [position])[0]?.amountCents).toBe(162000)
  })

  it('E5: nach dem Lösen der Zeile von Beleg A zählt A nicht mehr, auch wenn Beleg B an der Position hängt', () => {
    // A hängt nur noch über seine Auswertung (offen, ohne gebuchte Zeile); B ist gebucht und der
    // Beleg der Position.
    const a = { ...upload('1_a.pdf'), bookedItemIds: [], assessment: { id: 'a1', propertyId: 'p1', open: true } }
    const b = { ...upload('2_b.pdf'), bookedItemIds: ['st'], assessment: { id: 'a2', propertyId: 'p1', open: false } }
    const position = item('st', { category: 'Beleuchtung/Allgemeinstrom', invoiceFile: '2_b.pdf', amountCents: 80000 })
    const cards = receiptCards([a, b], [position])
    expect(cards.find((c) => c.upload.file === '1_a.pdf')?.items).toEqual([])
    expect(inboxOf(cards, { propertyId: 'all', year: 'all' }).here.map((c) => c.upload.file)).toEqual(['1_a.pdf'])
    expect(buildFolder([a, b], [position], { propertyId: 'all', year: 'all' }, '').groups[0]?.cards.map((c) => c.upload.file)).toEqual(['2_b.pdf'])
    expect(filesByItem([a, b]).get('st')).toEqual(['2_b.pdf'])
  })
})
