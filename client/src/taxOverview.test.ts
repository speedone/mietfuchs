// Gesamtsicht über alle Objekte (#96 PR 3): was die Seite aus der Antwort des Servers wählt.
import { expect, test } from 'vitest'
import type { TaxOverview, TaxOverviewSums } from './types'
import { neutralText, OVERVIEW_NOTE, overviewMore, overviewView, showsOverview } from './taxOverview'

const SUMS = (over: Partial<TaxOverviewSums> = {}): TaxOverviewSums => ({
  incomeCents: 600_000,
  incomeLines: { homes: 0, inclusive: 0, unallocated: 0, relatives: 600_000, allocations: 0, flatRate: 0, settlement: 0, relativesAllocations: 0, relativesSettlement: 0, formerYears: 0, formerYearsAllocations: 0, totalCents: 600_000 },
  sollCents: 550_000, expensesTotalCents: 940_000, privateCents: 0, gratuitousCents: 0, deferredCents: 600_000, deductibleCents: 340_000,
  reserveContributionCents: 0, surplusCents: 260_000, surplusSollCents: 210_000, ...over,
})
const OVERVIEW: TaxOverview = {
  year: 2025,
  rows: [
    { propertyId: 'a', name: 'Haus A', kind: 'mfh', ok: true, hasRental: true, number: 1, sums: SUMS() },
    { propertyId: 'g', name: 'Garagen', kind: 'sonstiges', ok: true, hasRental: false, number: null, sums: SUMS({ incomeCents: 0, sollCents: 0, deductibleCents: 0, surplusCents: 0, surplusSollCents: 0, deferredCents: 0 }) },
    { propertyId: 'w', name: '', kind: 'etw', ok: true, hasRental: true, number: 2, sums: SUMS({ incomeCents: 0, sollCents: 0, deductibleCents: 120_000, privateCents: 30_000, surplusCents: -120_000, surplusSollCents: -120_000 }) },
    { propertyId: 'x', name: 'Haus X', kind: 'mfh', ok: false, error: 'Die Position y ist im Jahr 2025 nur mit einem Teilbetrag abgeflossen.' },
  ],
  totals: SUMS({ incomeCents: 600_000, sollCents: 550_000, deductibleCents: 460_000, privateCents: 30_000, surplusCents: 140_000, surplusSollCents: 90_000 }),
}

test('Erst ab zwei Objekten', () => {
  expect([0, 1, 2, 3].map(showsOverview)).toEqual([false, false, true, true])
})

test('Ist: Zeile 32 und Überschuss aus `received`, Nummer, neutraler Satz, Fehler mit Meldung, das gewählte Objekt markiert', () => {
  const v = overviewView(OVERVIEW, 'ist', 'g')
  expect(v.title).toBe('Alle Objekte 2025')
  expect(v.incomeHead).toBe('Einnahmen (Zeile 32)')
  expect(v.lines.map((l) => l.state)).toEqual(['rental', 'neutral', 'rental', 'error'])
  expect(v.lines.map((l) => l.current)).toEqual([false, true, false, false])
  const [a, g, w, x] = v.lines
  expect(a).toMatchObject({ number: 1, incomeCents: 600_000, deductibleCents: 340_000, surplusCents: 260_000 })
  expect(g).toMatchObject({ text: 'Keine Einnahmen und keine Werbungskosten in 2025.' })
  expect(w).toMatchObject({ name: 'Ohne Namen', number: 2, privateCents: 30_000 })
  expect(x).toMatchObject({ text: 'Nicht gerechnet: Die Position y ist im Jahr 2025 nur mit einem Teilbetrag abgeflossen.' })
  expect(v.totals).toEqual({ incomeCents: 600_000, deductibleCents: 460_000, privateCents: 30_000, surplusCents: 140_000 })
  expect(v.showsPrivate).toBe(true)
  expect(v.failedText).toBe('Ein Objekt zählt nicht in die Summe, weil die Steuerübersicht dort nicht gerechnet werden konnte. Die Nummern der Objekte danach stehen erst fest, wenn der Fehler behoben ist.')
})

test('Soll: Einnahmen und Überschuss vereinbart, Werbungskosten gleich', () => {
  const v = overviewView(OVERVIEW, 'soll', undefined)
  expect(v.incomeHead).toBe('Einnahmen vereinbart (Soll)')
  expect(v.lines[0]).toMatchObject({ incomeCents: 550_000, deductibleCents: 340_000, surplusCents: 210_000 })
  expect(v.totals).toMatchObject({ incomeCents: 550_000, surplusCents: 90_000 })
})

test('Ohne privaten Teil keine Spalte; ohne Fehler kein Satz; ein Jahr ohne gelesenen Vordruck ohne Zeilennummer', () => {
  const rows = OVERVIEW.rows.slice(0, 2)
  const v = overviewView({ ...OVERVIEW, year: 2030, rows }, 'ist', undefined)
  expect(v.showsPrivate).toBe(false)
  expect(v.failedText).toBeNull()
  expect(v.incomeHead).toBe('Einnahmen')
  expect(neutralText(2030)).toBe('Keine Einnahmen und keine Werbungskosten in 2030.')
})

test('„Mehr dazu“: dieselben Zahlen wie je Objekt, Nummer auch bei Leerstand, keine Aussage über die Pflicht', () => {
  const more = overviewMore(2025).join(' ')
  expect(more).toMatch(/dieselben wie in der Steuerübersicht jedes Objekts/)
  expect(more).toMatch(/Zehn-Tage-Regel/)
  expect(more).toMatch(/§ 82b EStDV/)
  expect(more).toMatch(/leer stehende Wohnung/)
  expect(more).toMatch(/beurteilt Mietfuchs nicht/)
  expect(more).not.toMatch(/—/)
})

// Durchsicht S1: Ein Objekt ohne Vermietung zeigt keine Beträge; sein privater Teil schaltet die Spalte nicht ein.
test('Privater Teil nur eines Objekts ohne Vermietung: keine Spalte „privat“', () => {
  const [a, g] = OVERVIEW.rows
  if (!a?.ok || !g?.ok) throw new Error('Zeilen')
  const v = overviewView({ ...OVERVIEW, rows: [a, { ...g, sums: { ...g.sums, privateCents: 30_000 } }] }, 'ist', undefined)
  expect(v.showsPrivate).toBe(false)
})

// Durchsicht S3: nach einem Fehler Beträge ohne Nummer.
test('Objekt mit Vermietung nach einem Fehler: Beträge, Nummer „–“', () => {
  const [a, , , x] = OVERVIEW.rows
  if (!a?.ok || !x) throw new Error('Zeilen')
  const v = overviewView({ ...OVERVIEW, rows: [x, { ...a, number: null }] }, 'ist', undefined)
  expect(v.lines[1]).toMatchObject({ state: 'rental', number: null, incomeCents: 600_000 })
})

test('K1/K2: Satz oben knapp; „Mehr dazu“ mit Anlage je Objekt, abweichender Nummerierung und Kürzung bei verbilligter Vermietung', () => {
  expect(OVERVIEW_NOTE).toBe('Kein Formular: Die Summe dient nur Ihrer Kontrolle.')
  const more = overviewMore(2025).join(' ')
  expect(more).toMatch(/In der Regel geben Sie je Objekt eine Anlage V ab/)
  expect(more).toMatch(/Nummerierung abweichen/)
  expect(more).toMatch(/§ 21 Abs\. 2 EStG/)
})
