// Der gemerkte Umlageschlüssel im Formular (#141): Eine neue Position bekommt den Schlüssel, den
// dieselbe Kostenart im Vorjahr hatte, samt Teilnehmern und Maßstab; weicht sie ab, sagt das
// Formular es schon beim Erfassen.
import { describe, expect, test } from 'vitest'
import type { CostItem, Meter, Unit } from './types'
import {
  EMPTY_ITEM_FORM,
  aiKeyOptions,
  aiPositionDefaults,
  aiPositionPreselect,
  buildCostItemBody,
  keyChangeNotice,
  lastExternalBasis,
  newItemForm,
  withCategory,
  withKey,
  type KeyContext,
} from './costForm'
import { calendarPeriod } from '../../shared/period.ts'

const unit = (id: string, extra: Partial<Unit> = {}): Unit => ({ propertyId: 'objekt-1', id, name: id.toUpperCase(), areaM2: 50, participates: true, ...extra })
const UNITS = [unit('u1'), unit('u2'), unit('u3')]
const METERS: Meter[] = [{ id: 'm1', propertyId: 'objekt-1', name: 'KW', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]
let n = 0
const item = (over: Partial<CostItem> & Pick<CostItem, 'period' | 'category' | 'key'>): CostItem => ({
  id: `k${++n}`, propertyId: 'objekt-1', description: over.category, amountCents: 10000, ...over,
})
const ctx = (items: CostItem[], over: Partial<KeyContext> = {}): KeyContext => ({ items, year: 2026, propertyKind: 'mfh', ...over })

describe('Vorschlag aus dem Vorjahr', () => {
  test('Kostenart des Vorjahres: Schlüssel und Teilnehmer statt der festen Vorgabe', () => {
    const items = [item({ period: calendarPeriod(2025), category: 'Müllabfuhr', key: 'units', participantUnitIds: ['u1', 'u2'] })]
    const f = withCategory({ ...EMPTY_ITEM_FORM }, 'Müllabfuhr', UNITS, METERS, ctx(items))
    expect(f.key).toBe('units')
    expect(f.participants).toEqual(['u1', 'u2'])
  })

  test('Zählertyp, vereinbarte Anteile und Wohnung kommen mit', () => {
    const items = [
      item({ period: calendarPeriod(2025), category: 'Wasser/Abwasser', key: 'meter', meterType: 'kaltwasser' }),
      item({ period: calendarPeriod(2025), category: 'Gartenpflege', key: 'custom', customShares: { u1: 40, u2: 60 } }),
      item({ period: calendarPeriod(2025), category: 'Schornsteinfeger', key: 'direct', directUnitId: 'u3' }),
    ]
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Wasser/Abwasser', UNITS, METERS, ctx(items))).toMatchObject({ key: 'meter', meterType: 'kaltwasser' })
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Gartenpflege', UNITS, METERS, ctx(items)).customShares).toEqual({ u1: '40', u2: '60' })
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Schornsteinfeger', UNITS, METERS, ctx(items)).directUnitId).toBe('u3')
  })

  test('Gemeinschaftsabrechnung: Maßstab und Summe der Anteile ja, die Kosten der Gemeinschaft nein', () => {
    const items = [item({ period: calendarPeriod(2025), category: 'Hauswart', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 480000 } })]
    const f = withCategory({ ...EMPTY_ITEM_FORM }, 'Hauswart', UNITS, METERS, ctx(items))
    expect(f).toMatchObject({ key: 'external', externalMeasure: 'mea', externalTotal: '1.000', externalTotalAmount: '' })
  })

  test('ohne Vorjahr der bisherige Vorschlag; eine bestehende Position behält ihren Schlüssel', () => {
    const items = [item({ period: calendarPeriod(2025), category: 'Müllabfuhr', key: 'units' })]
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Müllabfuhr', UNITS, METERS, ctx([])).key).toBe('persons')
    expect(withCategory({ ...EMPTY_ITEM_FORM, id: 'x', key: 'area' }, 'Müllabfuhr', UNITS, METERS, ctx(items)).key).toBe('area')
    // Ohne Kontext wie vor #141.
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Müllabfuhr', UNITS, METERS).key).toBe('persons')
  })

  test('gemerkte Teilnehmer bleiben nicht an der nächsten Kostenart hängen', () => {
    const items = [item({ period: calendarPeriod(2025), category: 'Aufzug', key: 'area', participantUnitIds: ['u1'] })]
    const aufzug = withCategory({ ...EMPTY_ITEM_FORM }, 'Aufzug', UNITS, METERS, ctx(items))
    expect(withCategory(aufzug, 'Gartenpflege', UNITS, METERS, ctx(items)).participants).toBeNull()
  })

  // Durchsicht (7): So sieht es in der Datenbank aus, wenn der einzige Teilnehmer gelöscht ist.
  // Die Kaskade entfernt seine Zeile, das Kennzeichen „nur Teilnehmer“ bleibt: eine leere Liste.
  // Das Formular übernimmt sie und lässt so nicht speichern, statt still auf alle zu verteilen.
  test('einziger Teilnehmer gelöscht: leere Liste, und das Formular sperrt das Speichern', () => {
    const items = [item({ period: calendarPeriod(2025), category: 'Aufzug', key: 'area', participantUnitIds: [] })]
    const f = withCategory({ ...EMPTY_ITEM_FORM, description: 'Aufzug', amount: '100,00' }, 'Aufzug', UNITS, METERS, ctx(items))
    expect(f.participants).toEqual([])
    expect(buildCostItemBody(f, UNITS, 2026)).toEqual({ error: 'Bitte mindestens eine teilnehmende Wohnung wählen.' })
  })

  test('das neue Formular schlägt schon für die erste Kostenart vor', () => {
    const items = [item({ period: calendarPeriod(2025), category: 'Grundsteuer', key: 'units' })]
    expect(newItemForm(UNITS, METERS, ctx(items))).toMatchObject({ category: 'Grundsteuer', key: 'units' })
  })
})

describe('Eigentumswohnung (#102): ohne Vorjahr laut Gemeinschaftsabrechnung', () => {
  const etw = (items: CostItem[] = []) => ctx(items, { propertyKind: 'etw' })
  test('umlagefähige Kostenart, mit Maßstab der zuletzt erfassten Position', () => {
    const items = [item({ period: calendarPeriod(2026), category: 'Hauswart', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1 } })]
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Gebäudereinigung', UNITS, METERS, etw(items))).toMatchObject({ key: 'external', externalMeasure: 'mea', externalTotal: '1.000' })
  })
  test('nicht bei der Grundsteuer, die die Gemeinde dem Eigentümer festsetzt', () => {
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Grundsteuer', UNITS, METERS, etw()).key).toBe('area')
  })
  test('KI-Zeile: nur mit schon erfasster Summe der Anteile, sonst wie bisher', () => {
    expect(aiPositionDefaults('Gebäudereinigung', UNITS, METERS, etw()).key).toBe('area')
    const items = [item({ period: calendarPeriod(2026), category: 'Hauswart', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1 } })]
    expect(aiPositionDefaults('Gebäudereinigung', UNITS, METERS, etw(items))).toMatchObject({ key: 'external', allocation: { externalBasis: { measure: 'mea', total: 1000 } } })
  })
  test('das Vorjahr geht vor', () => {
    const items = [item({ period: calendarPeriod(2025), category: 'Gebäudereinigung', key: 'units' })]
    expect(withCategory({ ...EMPTY_ITEM_FORM }, 'Gebäudereinigung', UNITS, METERS, etw(items)).key).toBe('units')
  })
})

describe('Summe der Anteile nicht an jeder Position', () => {
  test('lastExternalBasis: die zuletzt erfasste Angabe, jüngstes Jahr zuerst', () => {
    const items = [
      item({ period: calendarPeriod(2026), category: 'A', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1 } }),
      item({ period: calendarPeriod(2025), category: 'B', key: 'external', externalBasis: { measure: 'area', total: 900, totalCents: 1 } }),
    ]
    expect(lastExternalBasis(items)).toEqual({ measure: 'mea', total: 1000 })
    expect(lastExternalBasis([])).toBeNull()
  })
  test('Wechsel auf „laut Gemeinschaftsabrechnung“ füllt leere Felder, eine Eingabe bleibt', () => {
    const items = [item({ period: calendarPeriod(2026), category: 'A', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1 } })]
    expect(withKey({ ...EMPTY_ITEM_FORM }, 'external', [], ctx(items))).toMatchObject({ externalMeasure: 'mea', externalTotal: '1.000' })
    expect(withKey({ ...EMPTY_ITEM_FORM, externalTotal: '500' }, 'external', [], ctx(items)).externalTotal).toBe('500')
  })
})

describe('Hinweis im Formular: anders als im Vorjahr', () => {
  const items = [item({ period: calendarPeriod(2025), category: 'Müllabfuhr', key: 'persons' })]
  test('anderer Schlüssel ergibt einen Hinweis mit dem Vorjahr', () => {
    const text = keyChangeNotice({ ...EMPTY_ITEM_FORM, category: 'Müllabfuhr', key: 'area' }, UNITS, ctx(items))
    expect(text).toMatch(/2025/)
    expect(text).toMatch(/nach Personenzahl/)
  })
  test('gleicher Schlüssel, kein Vorjahr oder nicht umlagefähig: nichts', () => {
    expect(keyChangeNotice({ ...EMPTY_ITEM_FORM, category: 'Müllabfuhr', key: 'persons' }, UNITS, ctx(items))).toBe('')
    expect(keyChangeNotice({ ...EMPTY_ITEM_FORM, category: 'Aufzug', key: 'area' }, UNITS, ctx(items))).toBe('')
    expect(keyChangeNotice({ ...EMPTY_ITEM_FORM, category: 'Nicht umlagefähig', key: 'area' }, UNITS, ctx([item({ period: calendarPeriod(2025), category: 'Nicht umlagefähig', key: 'units' })]))).toBe('')
  })
  test('der Vorschlag selbst löst den Hinweis nie aus', () => {
    const memory = [
      item({ period: calendarPeriod(2025), category: 'Aufzug', key: 'area', participantUnitIds: ['u2', 'u1'] }),
      item({ period: calendarPeriod(2025), category: 'Gartenpflege', key: 'custom', customShares: { u1: 33.33, u2: 66.67 } }),
      item({ period: calendarPeriod(2025), category: 'Hauswart', key: 'external', externalBasis: { measure: 'area', total: 1240.5, totalCents: 1 } }),
      item({ period: calendarPeriod(2025), category: 'Wasser/Abwasser', key: 'meter', meterType: 'kaltwasser' }),
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
    item({ period: calendarPeriod(2025), category: 'Aufzug', key: 'area', participantUnitIds: ['u1', 'u2'] }),
    item({ period: calendarPeriod(2025), category: 'Hauswart', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1 } }),
    item({ period: calendarPeriod(2025), category: 'Heizung und Warmwasser', key: 'amounts', tenancyAmounts: { t1: 100 } }),
  ]
  test('Vorschlag aus dem Vorjahr, Einzelbeträge nicht (die Beträge sind Zahlen des Jahres)', () => {
    expect(aiPositionDefaults('Aufzug', UNITS, METERS, ctx(items))).toMatchObject({ key: 'area', allocation: { participantUnitIds: ['u1', 'u2'] } })
    expect(aiPositionDefaults('Heizung und Warmwasser', UNITS, METERS, ctx(items))).toEqual({ key: 'area', allocation: null })
    expect(aiPositionDefaults('Müllabfuhr', UNITS, METERS, ctx(items))).toEqual({ key: 'persons', allocation: null })
  })
  // Der Rumpf einer KI-Zeile entsteht seit der Belegbuchung (#170) auf dem Server (lineDraft);
  // die Fälle stehen in server/test/assessment.test.ts.
})

test('KI-Zeile: die Auswahl führt den gespeicherten Schlüssel, damit angezeigt wird, was gespeichert wird', () => {
  expect(aiKeyOptions('persons')).toEqual(['area', 'persons', 'units'])
  expect(aiKeyOptions('external')).toEqual(['area', 'persons', 'units', 'external'])
})

test('Durchsicht: Teilnehmer des Vorjahres, die heute alle Wohnungen sind, lösen keinen Hinweis aus', () => {
  const zwei = [unit('u1'), unit('u2')]
  const memory = [item({ period: calendarPeriod(2025), category: 'Aufzug', key: 'area', participantUnitIds: ['u1', 'u2', 'weg'] })]
  const f = withCategory({ ...EMPTY_ITEM_FORM }, 'Aufzug', zwei, METERS, ctx(memory))
  expect(keyChangeNotice(f, zwei, ctx(memory))).toBe('')
  // Und ausdrücklich „alle“ ebenso.
  expect(keyChangeNotice({ ...f, participants: null }, zwei, ctx(memory))).toBe('')
})

describe('Durchsicht: breite Kostenart, KI-Zeilen mit Einschränkung, unvollständiger Schlüssel', () => {
  const hebe = item({ period: calendarPeriod(2025), category: 'Sonstige Betriebskosten', key: 'direct', directUnitId: 'u1', description: 'Wartung Hebeanlage 2025' })
  test('Hebeanlage → Dachrinne: kein gemerkter Schlüssel, kein Hinweis', () => {
    const f = withCategory({ ...EMPTY_ITEM_FORM, description: 'Reinigung Dachrinne' }, 'Sonstige Betriebskosten', UNITS, METERS, ctx([hebe]))
    expect(f.key).toBe('area')
    expect(keyChangeNotice(f, UNITS, ctx([hebe]))).toBe('')
    expect(aiPositionDefaults('Sonstige Betriebskosten', UNITS, METERS, ctx([hebe]), 'Reinigung Dachrinne')).toEqual({ key: 'area', allocation: null })
  })
  test('dieselbe Beschreibung mit neuer Jahreszahl: gemerkter Schlüssel', () => {
    const f = withCategory({ ...EMPTY_ITEM_FORM, description: 'Wartung Hebeanlage 2026' }, 'Sonstige Betriebskosten', UNITS, METERS, ctx([hebe]))
    expect(f).toMatchObject({ key: 'direct', directUnitId: 'u1' })
    expect(aiPositionDefaults('Sonstige Betriebskosten', UNITS, METERS, ctx([hebe]), 'Wartung Hebeanlage 2026').key).toBe('direct')
  })
  test('eingeschränkter gemerkter Schlüssel: KI-Zeile nie vorab angehakt', () => {
    const items = [item({ period: calendarPeriod(2025), category: 'Aufzug', key: 'area', participantUnitIds: ['u1'] }), hebe]
    expect(aiPositionPreselect(aiPositionDefaults('Aufzug', UNITS, METERS, ctx(items)))).toBe(false)
    expect(aiPositionPreselect(aiPositionDefaults('Sonstige Betriebskosten', UNITS, METERS, ctx(items), 'Wartung Hebeanlage 2026'))).toBe(false)
    expect(aiPositionPreselect(aiPositionDefaults('Müllabfuhr', UNITS, METERS, ctx(items)))).toBe(true)
  })
  test('nicht mehr vollständiger gemerkter Schlüssel: die feste Vorgabe', () => {
    const leer = [item({ period: calendarPeriod(2025), category: 'Aufzug', key: 'area', participantUnitIds: [] })]
    expect(aiPositionDefaults('Aufzug', UNITS, METERS, ctx(leer))).toEqual({ key: 'area', allocation: null })
    const weg = [item({ period: calendarPeriod(2025), category: 'Gartenpflege', key: 'direct', directUnitId: null })]
    expect(aiPositionDefaults('Gartenpflege', UNITS, METERS, ctx(weg))).toEqual({ key: 'area', allocation: null })
    const fremd = [item({ period: calendarPeriod(2025), category: 'Gartenpflege', key: 'direct', directUnitId: 'gibt-es-nicht' })]
    expect(aiPositionDefaults('Gartenpflege', UNITS, METERS, ctx(fremd))).toEqual({ key: 'area', allocation: null })
  })
  test('Formularhinweis behauptet nicht, dass sich ein Schlüssel nie ändern ließe', () => {
    const text = keyChangeNotice({ ...EMPTY_ITEM_FORM, category: 'Müllabfuhr', key: 'area' }, UNITS, ctx([item({ period: calendarPeriod(2025), category: 'Müllabfuhr', key: 'persons' })]))
    expect(text).not.toMatch(/nicht einseitig von Jahr zu Jahr/)
    expect(text).toMatch(/Zustimmung|Erklärung/)
  })
})
