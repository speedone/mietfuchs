// Der gemerkte Umlageschlüssel im Formular (#141): Eine neue Position bekommt den Schlüssel, den
// dieselbe Kostenart im Vorjahr hatte, samt Teilnehmern und Maßstab; weicht sie ab, sagt das
// Formular es schon beim Erfassen.
import { describe, expect, test } from 'vitest'
import type { CostItem, Meter, Unit } from './types'
import {
  EMPTY_ITEM_FORM,
  aiKeyOptions,
  aiPositionBody,
  aiPositionDefaults,
  aiPositionProblem,
  buildCostItemBody,
  keyChangeNotice,
  lastExternalBasis,
  newItemForm,
  withCategory,
  withKey,
  type KeyContext,
} from './costForm'

const unit = (id: string, extra: Partial<Unit> = {}): Unit => ({ propertyId: 'objekt-1', id, name: id.toUpperCase(), areaM2: 50, participates: true, ...extra })
const UNITS = [unit('u1'), unit('u2'), unit('u3')]
const METERS: Meter[] = [{ id: 'm1', propertyId: 'objekt-1', name: 'KW', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]
let n = 0
const item = (over: Partial<CostItem> & Pick<CostItem, 'year' | 'category' | 'key'>): CostItem => ({
  id: `k${++n}`, propertyId: 'objekt-1', description: over.category, amountCents: 10000, ...over,
})
const ctx = (items: CostItem[], over: Partial<KeyContext> = {}): KeyContext => ({ items, year: 2026, propertyKind: 'mfh', ...over })

describe('Vorschlag aus dem Vorjahr', () => {
  test('Kostenart des Vorjahres: Schlüssel und Teilnehmer statt der festen Vorgabe', () => {
    const items = [item({ year: 2025, category: 'Müllabfuhr', key: 'units', participantUnitIds: ['u1', 'u2'] })]
    const f = withCategory({ ...EMPTY_ITEM_FORM }, 'Müllabfuhr', UNITS, METERS, ctx(items))
    expect(f.key).toBe('units')
    expect(f.participants).toEqual(['u1', 'u2'])
  })

  test('Zählertyp, vereinbarte Anteile und Wohnung kommen mit', () => {
    const items = [
      item({ year: 2025, category: 'Wasser/Abwasser', key: 'meter', meterType: 'kaltwasser' }),
      item({ year: 2025, category: 'Gartenpflege', key: 'custom', customShares: { u1: 40, u2: 60 } }),
      item({ year: 2025, category: 'Sonstige Betriebskosten', key: 'direct', directUnitId: 'u3' }),
    ]
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Wasser/Abwasser', UNITS, METERS, ctx(items))).toMatchObject({ key: 'meter', meterType: 'kaltwasser' })
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Gartenpflege', UNITS, METERS, ctx(items)).customShares).toEqual({ u1: '40', u2: '60' })
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Sonstige Betriebskosten', UNITS, METERS, ctx(items)).directUnitId).toBe('u3')
  })

  test('Gemeinschaftsabrechnung: Maßstab und Summe der Anteile ja, die Kosten der Gemeinschaft nein', () => {
    const items = [item({ year: 2025, category: 'Hauswart', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 480000 } })]
    const f = withCategory({ ...EMPTY_ITEM_FORM }, 'Hauswart', UNITS, METERS, ctx(items))
    expect(f).toMatchObject({ key: 'external', externalMeasure: 'mea', externalTotal: '1.000', externalTotalAmount: '' })
  })

  test('ohne Vorjahr der bisherige Vorschlag; eine bestehende Position behält ihren Schlüssel', () => {
    const items = [item({ year: 2025, category: 'Müllabfuhr', key: 'units' })]
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Müllabfuhr', UNITS, METERS, ctx([])).key).toBe('persons')
    expect(withCategory({ ...EMPTY_ITEM_FORM, id: 'x', key: 'area' }, 'Müllabfuhr', UNITS, METERS, ctx(items)).key).toBe('area')
    // Ohne Kontext wie vor #141.
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Müllabfuhr', UNITS, METERS).key).toBe('persons')
  })

  test('gemerkte Teilnehmer bleiben nicht an der nächsten Kostenart hängen', () => {
    const items = [item({ year: 2025, category: 'Aufzug', key: 'area', participantUnitIds: ['u1'] })]
    const aufzug = withCategory({ ...EMPTY_ITEM_FORM }, 'Aufzug', UNITS, METERS, ctx(items))
    expect(withCategory(aufzug, 'Gartenpflege', UNITS, METERS, ctx(items)).participants).toBeNull()
  })

  test('Teilnehmer einer inzwischen gelöschten Wohnung fallen heraus', () => {
    const items = [item({ year: 2025, category: 'Aufzug', key: 'area', participantUnitIds: ['u1', 'weg'] })]
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Aufzug', UNITS, METERS, ctx(items)).participants).toEqual(['u1'])
  })

  test('das neue Formular schlägt schon für die erste Kostenart vor', () => {
    const items = [item({ year: 2025, category: 'Grundsteuer', key: 'units' })]
    expect(newItemForm(UNITS, METERS, ctx(items))).toMatchObject({ category: 'Grundsteuer', key: 'units' })
  })
})

describe('Eigentumswohnung (#102): ohne Vorjahr laut Gemeinschaftsabrechnung', () => {
  const etw = (items: CostItem[] = []) => ctx(items, { propertyKind: 'etw' })
  test('umlagefähige Kostenart, mit Maßstab der zuletzt erfassten Position', () => {
    const items = [item({ year: 2026, category: 'Hauswart', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1 } })]
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Gebäudereinigung', UNITS, METERS, etw(items))).toMatchObject({ key: 'external', externalMeasure: 'mea', externalTotal: '1.000' })
  })
  test('nicht bei der Grundsteuer, die die Gemeinde dem Eigentümer festsetzt', () => {
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Grundsteuer', UNITS, METERS, etw()).key).toBe('area')
  })
  test('KI-Zeile: nur mit schon erfasster Summe der Anteile, sonst wie bisher', () => {
    expect(aiPositionDefaults('Gebäudereinigung', UNITS, METERS, etw()).key).toBe('area')
    const items = [item({ year: 2026, category: 'Hauswart', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1 } })]
    expect(aiPositionDefaults('Gebäudereinigung', UNITS, METERS, etw(items))).toMatchObject({ key: 'external', allocation: { externalBasis: { measure: 'mea', total: 1000 } } })
  })
  test('das Vorjahr geht vor', () => {
    const items = [item({ year: 2025, category: 'Gebäudereinigung', key: 'units' })]
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Gebäudereinigung', UNITS, METERS, etw(items)).key).toBe('units')
  })
})

describe('Summe der Anteile nicht an jeder Position', () => {
  test('lastExternalBasis: die zuletzt erfasste Angabe, jüngstes Jahr zuerst', () => {
    const items = [
      item({ year: 2026, category: 'A', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1 } }),
      item({ year: 2025, category: 'B', key: 'external', externalBasis: { measure: 'area', total: 900, totalCents: 1 } }),
    ]
    expect(lastExternalBasis(items)).toEqual({ measure: 'mea', total: 1000 })
    expect(lastExternalBasis([])).toBeNull()
  })
  test('Wechsel auf „laut Gemeinschaftsabrechnung“ füllt leere Felder, eine Eingabe bleibt', () => {
    const items = [item({ year: 2026, category: 'A', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1 } })]
    expect(withKey({ ...EMPTY_ITEM_FORM }, 'external', [], ctx(items))).toMatchObject({ externalMeasure: 'mea', externalTotal: '1.000' })
    expect(withKey({ ...EMPTY_ITEM_FORM, externalTotal: '500' }, 'external', [], ctx(items)).externalTotal).toBe('500')
  })
})

describe('Hinweis im Formular: anders als im Vorjahr', () => {
  const items = [item({ year: 2025, category: 'Müllabfuhr', key: 'persons' })]
  test('anderer Schlüssel ergibt einen Hinweis mit dem Vorjahr', () => {
    const text = keyChangeNotice({ ...EMPTY_ITEM_FORM, category: 'Müllabfuhr', key: 'area' }, UNITS, ctx(items))
    expect(text).toMatch(/2025/)
    expect(text).toMatch(/nach Personenzahl/)
  })
  test('gleicher Schlüssel, kein Vorjahr oder nicht umlagefähig: nichts', () => {
    expect(keyChangeNotice({ ...EMPTY_ITEM_FORM, category: 'Müllabfuhr', key: 'persons' }, UNITS, ctx(items))).toBe('')
    expect(keyChangeNotice({ ...EMPTY_ITEM_FORM, category: 'Aufzug', key: 'area' }, UNITS, ctx(items))).toBe('')
    expect(keyChangeNotice({ ...EMPTY_ITEM_FORM, category: 'Nicht umlagefähig', key: 'area' }, UNITS, ctx([item({ year: 2025, category: 'Nicht umlagefähig', key: 'units' })]))).toBe('')
  })
  test('der Vorschlag selbst löst den Hinweis nie aus', () => {
    const memory = [
      item({ year: 2025, category: 'Aufzug', key: 'area', participantUnitIds: ['u2', 'u1'] }),
      item({ year: 2025, category: 'Gartenpflege', key: 'custom', customShares: { u1: 33.33, u2: 66.67 } }),
      item({ year: 2025, category: 'Hauswart', key: 'external', externalBasis: { measure: 'area', total: 1240.5, totalCents: 1 } }),
      item({ year: 2025, category: 'Wasser/Abwasser', key: 'meter', meterType: 'kaltwasser' }),
    ]
    for (const category of ['Aufzug', 'Gartenpflege', 'Hauswart', 'Wasser/Abwasser']) {
      const f = withCategory({ ...EMPTY_ITEM_FORM }, category, UNITS, METERS, ctx(memory))
      expect(keyChangeNotice(f, UNITS, ctx(memory)), category).toBe('')
    }
  })
  test('alle Wohnungen angehakt heißt alle, wie beim Speichern', () => {
    const f = { ...EMPTY_ITEM_FORM, category: 'Müllabfuhr', key: 'persons' as const, participants: ['u1', 'u2', 'u3'] }
    expect(keyChangeNotice(f, UNITS, ctx(items))).toBe('')
  })
})

describe('KI-Übernahme mit gemerktem Schlüssel', () => {
  const items = [
    item({ year: 2025, category: 'Aufzug', key: 'area', participantUnitIds: ['u1', 'u2'] }),
    item({ year: 2025, category: 'Hauswart', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1 } }),
    item({ year: 2025, category: 'Heizung und Warmwasser', key: 'amounts', tenancyAmounts: { t1: 100 } }),
  ]
  test('Vorschlag aus dem Vorjahr, Einzelbeträge nicht (die Beträge sind Zahlen des Jahres)', () => {
    expect(aiPositionDefaults('Aufzug', UNITS, METERS, ctx(items))).toMatchObject({ key: 'area', allocation: { participantUnitIds: ['u1', 'u2'] } })
    expect(aiPositionDefaults('Heizung und Warmwasser', UNITS, METERS, ctx(items))).toEqual({ key: 'area', allocation: null })
    expect(aiPositionDefaults('Müllabfuhr', UNITS, METERS, ctx(items))).toEqual({ key: 'persons', allocation: null })
  })
  test('der Rumpf trägt Teilnehmer, Beleg und Rechnungssteller', () => {
    const d = aiPositionDefaults('Aufzug', UNITS, METERS, ctx(items))
    const p = { description: 'Aufzugswartung', category: 'Aufzug', amount: '480,00', labor35a: '', externalTotalAmount: '', ...d }
    const built = aiPositionBody(p, { vendor: 'Lift GmbH', invoiceFile: 'b.pdf' }, UNITS, 2026)
    expect(built).toMatchObject({ body: { key: 'area', participantUnitIds: ['u1', 'u2'], amountCents: 48000, vendor: 'Lift GmbH', invoiceFile: 'b.pdf', year: 2026 } })
  })
  test('Gemeinschaftsabrechnung verlangt die Kosten der Gemeinschaft', () => {
    const d = aiPositionDefaults('Hauswart', UNITS, METERS, ctx(items))
    const p = { description: 'Hauswart', category: 'Hauswart', amount: '120,00', labor35a: '', externalTotalAmount: '', ...d }
    expect(aiPositionProblem(p, UNITS, 2026)).toMatch(/Gemeinschaft/)
    const ok = aiPositionBody({ ...p, externalTotalAmount: '120.000,00' }, { vendor: 'WEG' }, UNITS, 2026)
    expect(ok).toMatchObject({ body: { externalBasis: { measure: 'mea', total: 1000, totalCents: 12000000 } } })
  })
  test('ohne Gedächtnis derselbe Rumpf wie bisher (nur der Schlüssel, Nebenfelder leer)', () => {
    const p = { description: 'Müll', category: 'Müllabfuhr', amount: '60,00', labor35a: '', externalTotalAmount: '', key: 'persons' as const, allocation: null }
    const built = aiPositionBody(p, { vendor: 'Stadt' }, UNITS, 2026)
    const viaForm = buildCostItemBody({ ...EMPTY_ITEM_FORM, category: 'Müllabfuhr', description: 'Müll', vendor: 'Stadt', amount: '60,00', key: 'persons' }, UNITS, 2026)
    expect(built).toEqual(viaForm)
    // Wie bisher: 0 € ist keine Position (#139).
    expect(aiPositionProblem({ ...p, amount: '0' }, UNITS, 2026)).toMatch(/0 €/)
  })
})

test('KI-Zeile: die Auswahl führt den gespeicherten Schlüssel, damit angezeigt wird, was gespeichert wird', () => {
  expect(aiKeyOptions('persons')).toEqual(['area', 'persons', 'units'])
  expect(aiKeyOptions('external')).toEqual(['area', 'persons', 'units', 'external'])
})

test('Durchsicht: Teilnehmer des Vorjahres, die heute alle Wohnungen sind, lösen keinen Hinweis aus', () => {
  const zwei = [unit('u1'), unit('u2')]
  const memory = [item({ year: 2025, category: 'Aufzug', key: 'area', participantUnitIds: ['u1', 'u2', 'weg'] })]
  const f = withCategory({ ...EMPTY_ITEM_FORM }, 'Aufzug', zwei, METERS, ctx(memory))
  expect(keyChangeNotice(f, zwei, ctx(memory))).toBe('')
  // Und ausdrücklich „alle“ ebenso.
  expect(keyChangeNotice({ ...f, participants: null }, zwei, ctx(memory))).toBe('')
})
