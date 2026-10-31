// Von Hand erfassen aus dem Beleg (#490 PR 3, #487 Teil 2): das Kostenformular mit dem Beleg, die Kostenart aus dem
// Dateinamen vorgeschlagen, Angaben aus dem Vorjahr über den Rechnungssteller übernehmbar, nie der Betrag.
import { describe, expect, test } from 'vitest'
import type { CostItem, Unit } from './types'
import { calendarContext, calendarPeriod } from '../../shared/period.ts'
import { carryOverRows } from './carryOver'
import { EMPTY_ITEM_FORM, costFieldProblems } from './costForm'
import { adoptPrevious, categoryFromName, receiptItemForm, vendorPrevious } from './receiptForm'

const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'p', name: 'EG', areaM2: 50, participates: true },
  { id: 'u2', propertyId: 'p', name: 'OG', areaM2: 70, participates: true },
]
let n = 0
const item = (over: Partial<CostItem> & Pick<CostItem, 'period' | 'category' | 'description'>): CostItem => ({
  id: `k${++n}`, propertyId: 'p', amountCents: 50000, key: 'area', ...over,
})

describe('Kostenart aus dem Dateinamen', () => {
  test('ein Treffer nach matchCategory', () => {
    expect(categoryFromName('Muellabfuhr_2025.pdf')).toBe('')
    expect(categoryFromName('Müllabfuhr_2025.pdf')).toBe('Müllabfuhr')
    expect(categoryFromName('Grundsteuerbescheid-2025.pdf')).toBe('Grundsteuer')
    // macOS liefert Namen zerlegt („u“ und Trema)
    expect(categoryFromName('Müllabfuhr.pdf')).toBe('Müllabfuhr')
    expect(categoryFromName('Schornsteinfeger Rechnung.jpg')).toBe('Schornsteinfeger')
  })
  // Durchsicht S2: mehr als eine Kostenart oder nur ein Teil eines Straßennamens: leer
  test('mehrere Kostenarten im Namen: leer', () => {
    expect(categoryFromName('Rechnung Wasser und Müll.pdf')).toBe('')
    expect(categoryFromName('Wasser Abwasser 2025.pdf')).toBe('Wasser/Abwasser')
  })
  test('Straßennamen zählen nicht', () => {
    expect(categoryFromName('Gartenstraße 5 Hausmeister.pdf')).toBe('Hauswart')
    expect(categoryFromName('Am Kanal 3 Versicherung.pdf')).toBe('Sach- und Haftpflichtversicherung')
    expect(categoryFromName('Wasserturmstraße 2.pdf')).toBe('')
    expect(categoryFromName('Rechnung_Gartenweg_12.pdf')).toBe('')
    expect(categoryFromName('Am Kanal 3.pdf')).toBe('')
    expect(categoryFromName('Nicht umlagefähig Am Kanal.pdf')).toBe('Nicht umlagefähig')
  })
  test('ohne Treffer leer, nicht still „Sonstige Betriebskosten“', () => {
    expect(categoryFromName('Rechnung_4711.pdf')).toBe('')
    expect(categoryFromName('scan0001.jpg')).toBe('')
    // Wer „Sonstige“ in den Namen schreibt, meint es
    expect(categoryFromName('Sonstige Betriebskosten.pdf')).toBe('Sonstige Betriebskosten')
  })
})

describe('Formular aus dem Beleg', () => {
  test('Beleg vorbelegt, Kostenart vorgeschlagen samt Schlüssel', () => {
    const form = receiptItemForm({ file: '7_Müllabfuhr.pdf', originalName: 'Müllabfuhr.pdf' }, UNITS, [])
    expect(form).toMatchObject({ invoiceFile: '7_Müllabfuhr.pdf', category: 'Müllabfuhr', key: 'persons', amount: '', description: '' })
    expect(form.id).toBeUndefined()
  })
  test('ohne Treffer bleibt die Kostenart leer, und „Anlegen“ meldet sie am Feld', () => {
    const form = receiptItemForm({ file: '7_scan.pdf', originalName: 'scan.pdf' }, UNITS, [])
    expect(form.category).toBe('')
    expect(costFieldProblems({ ...form, description: 'x', amount: '10,00' }, null)).toEqual([
      { field: 'category', short: 'Kostenart fehlt', text: 'Kostenart: Wählen Sie, wofür die Rechnung ist, etwa „Müllabfuhr“.' },
    ])
  })
  test('die übliche Kostenart des leeren Formulars ist keine Meldung', () => {
    expect(costFieldProblems({ ...EMPTY_ITEM_FORM, description: 'x', amount: '10,00' }, null)).toEqual([])
  })
})

describe('Angaben aus dem Vorjahr über den Rechnungssteller', () => {
  const items = [
    item({ period: calendarPeriod(2024), category: 'Müllabfuhr', description: 'Müll 2024', vendor: 'AWB Köln', key: 'persons', amountCents: 48000 }),
    item({ period: calendarPeriod(2024), category: 'Wasser/Abwasser', description: 'Wasser 2024', vendor: 'Stadtwerke', key: 'units' }),
    item({ period: calendarPeriod(2023), category: 'Gartenpflege', description: 'Garten', vendor: 'Grün GmbH' }),
  ]
  const rows = carryOverRows(items, calendarContext(2025))

  test('derselbe Rechnungssteller, auch anders geschrieben', () => {
    expect(vendorPrevious(rows, 'awb köln').map((r) => r.source.description)).toEqual(['Müll 2024'])
    expect(vendorPrevious(rows, ' AWB  Köln ').map((r) => r.source.description)).toEqual(['Müll 2024'])
  })
  test('nur das Vorjahr, nur ganze Namen, nichts bei leerem oder kurzem Namen', () => {
    expect(vendorPrevious(rows, 'Grün GmbH')).toEqual([])
    expect(vendorPrevious(rows, 'AWB')).toEqual([])
    expect(vendorPrevious(rows, '')).toEqual([])
  })
  // Durchsicht S4: zwei Positionen desselben Rechnungsstellers im Vorjahr, beide angeboten; übernommen ist nur die eine
  test('zwei Vorjahrespositionen desselben Rechnungsstellers', () => {
    const two = carryOverRows([
      ...items,
      item({ period: calendarPeriod(2024), category: 'Wasser/Abwasser', description: 'Abwasser 2024', vendor: 'Stadtwerke', key: 'units' }),
    ], calendarContext(2025))
    expect(vendorPrevious(two, 'Stadtwerke').map((r) => r.source.description)).toEqual(['Wasser 2024', 'Abwasser 2024'])
    const abwasser = vendorPrevious(two, 'Stadtwerke')[1] ?? expect.fail('keine Vorlage')
    const next = adoptPrevious({ ...receiptItemForm({ file: 'x.pdf', originalName: 'x.pdf' }, UNITS, []), vendor: 'Stadtwerke' }, abwasser)
    expect(vendorPrevious(two, 'Stadtwerke', next).map((r) => r.source.description)).toEqual(['Wasser 2024'])
  })
  test('übernommen werden Kostenart, Beschreibung und Schlüssel, nie der Betrag; Beleg und Datum bleiben', () => {
    const row = vendorPrevious(rows, 'AWB Köln')[0] ?? expect.fail('keine Vorlage')
    const form = { ...receiptItemForm({ file: '7_scan.pdf', originalName: 'scan.pdf' }, UNITS, []), vendor: 'awb köln', amount: '512,00', labor35a: '12,00', paidOn: '2025-03-01' }
    const next = adoptPrevious(form, row)
    expect(next).toMatchObject({ category: 'Müllabfuhr', description: 'Müll 2025', key: 'persons', amount: '512,00', labor35a: '12,00', vendor: 'awb köln', invoiceFile: '7_scan.pdf', paidOn: '2025-03-01' })
    // Danach steht der Hinweis nicht mehr da
    expect(vendorPrevious(rows, next.vendor, next)).toEqual([])
  })
})
