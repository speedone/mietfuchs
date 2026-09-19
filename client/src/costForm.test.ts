import { describe, expect, test } from 'vitest'
import type { CostKey, MeterType, Unit } from './types'
import { KEY_LABELS } from './types'
import {
  EMPTY_ITEM_FORM,
  buildCostItemBody,
  costKeyOptions,
  customSharesSumText,
  itemToForm,
  meterTypeOptions,
  type ItemForm,
} from './costForm'

const unit = (id: string, extra: Partial<Unit> = {}): Unit => ({
  id, name: id.toUpperCase(), areaM2: 50, participates: true, ...extra,
})
const UNITS = [unit('u1'), unit('u2')]
const form = (patch: Partial<ItemForm> = {}): ItemForm => ({
  ...EMPTY_ITEM_FORM, description: 'Test', amount: '100,00', ...patch,
})

// Der Kern von Issue #6: Ein Select zeigt den ersten Eintrag an, wenn sein Wert nicht in der
// Optionsliste steht — der State bleibt dabei unverändert. Gespeichert wird dann etwas
// anderes als das, was der Nutzer sieht. Diese Invariante schließt das für beide Selects aus.
describe('Auswahllisten enthalten immer den gewählten Wert', () => {
  const ALLE_TYPEN: (MeterType | '')[] = ['', 'kaltwasser', 'strom', 'waerme', 'sonstig']
  const VORHANDEN: MeterType[][] = [[], ['sonstig'], ['kaltwasser'], ['strom', 'waerme'], ['kaltwasser', 'sonstig']]

  test('Zählertyp: jeder Formularwert steht in der angebotenen Liste', () => {
    for (const vorhanden of VORHANDEN) {
      for (const gewaehlt of ALLE_TYPEN) {
        // '' entspricht der Option „— wählen —", die das Formular immer anbietet
        const optionen: (MeterType | '')[] = ['', ...meterTypeOptions(vorhanden, gewaehlt)]
        expect(optionen, `vorhanden=${vorhanden} gewählt=${gewaehlt}`).toContain(gewaehlt)
      }
    }
  })

  test('Umlageschlüssel: jeder Formularwert steht in der angebotenen Liste', () => {
    for (const vorhanden of VORHANDEN) {
      for (const gewaehlt of Object.keys(KEY_LABELS) as CostKey[]) {
        expect(costKeyOptions(vorhanden, gewaehlt), `vorhanden=${vorhanden} gewählt=${gewaehlt}`).toContain(gewaehlt)
      }
    }
  })

  test('Verbrauchsschlüssel wird ohne Wohnungszähler nicht angeboten', () => {
    expect(costKeyOptions([], 'area')).not.toContain('meter')
    expect(costKeyOptions(['sonstig'], 'area')).toContain('meter')
  })

  test('Ein leeres Formular hat keinen vorbelegten Zählertyp', () => {
    // Genau diese Vorbelegung war der Fehler: „kaltwasser" ohne passenden Zähler.
    expect(EMPTY_ITEM_FORM.meterType).toBe('')
  })
})

describe('Validierung', () => {
  test('Verbrauchsumlage ohne Zählertyp wird abgelehnt', () => {
    const r = buildCostItemBody(form({ key: 'meter' }), UNITS, 2025)
    expect(r).toEqual({ error: 'Bei Verbrauchsumlage bitte einen Zählertyp wählen.' })
  })

  test('Direktzuordnung ohne Wohnung wird abgelehnt', () => {
    const r = buildCostItemBody(form({ key: 'direct' }), UNITS, 2025)
    expect(r).toHaveProperty('error')
  })

  test('Betrag und Beschreibung sind Pflicht', () => {
    expect(buildCostItemBody(form({ description: '  ' }), UNITS, 2025)).toHaveProperty('error')
    expect(buildCostItemBody(form({ amount: 'abc' }), UNITS, 2025)).toHaveProperty('error')
    expect(buildCostItemBody(form({ amount: '0' }), UNITS, 2025)).toHaveProperty('error')
  })

  test('§35a-Lohnanteil darf den Gesamtbetrag nicht übersteigen', () => {
    expect(buildCostItemBody(form({ labor35a: '150,00' }), UNITS, 2025)).toHaveProperty('error')
    expect(buildCostItemBody(form({ labor35a: '40,00' }), UNITS, 2025)).toHaveProperty('body')
  })

  test('§35a-Lohnanteil darf nicht negativ sein', () => {
    expect(buildCostItemBody(form({ labor35a: '-10,00' }), UNITS, 2025)).toHaveProperty('error')
    expect(buildCostItemBody(form({ labor35a: '0' }), UNITS, 2025)).toHaveProperty('body')
  })
})

describe('Vereinbarte Prozentanteile', () => {
  test('deutsche Schreibweise wird als Prozent übernommen', () => {
    const r = buildCostItemBody(form({ key: 'custom', customShares: { u1: '33,33', u2: '66,67' } }), UNITS, 2025)
    expect(r).toHaveProperty('body')
    expect((r as { body: Record<string, unknown> }).body.customShares).toEqual({ u1: 33.33, u2: 66.67 })
  })

  test('Anteile über 100 % werden abgelehnt', () => {
    const r = buildCostItemBody(form({ key: 'custom', customShares: { u1: '60', u2: '60' } }), UNITS, 2025)
    expect(r).toHaveProperty('error')
    expect((r as { error: string }).error).toContain('120')
  })

  test('ohne jeden Anteil wird abgelehnt', () => {
    expect(buildCostItemBody(form({ key: 'custom', customShares: {} }), UNITS, 2025)).toHaveProperty('error')
    expect(buildCostItemBody(form({ key: 'custom', customShares: { u1: '0' } }), UNITS, 2025)).toHaveProperty('error')
  })

  test('unlesbare Eingabe wird abgelehnt, nicht stillschweigend verworfen', () => {
    const r = buildCostItemBody(form({ key: 'custom', customShares: { u1: 'viel' } }), UNITS, 2025)
    expect(r).toHaveProperty('error')
  })

  test('ausgenommene Wohnungen können keinen Anteil tragen', () => {
    const units = [unit('u1'), unit('u3', { participates: false })]
    const r = buildCostItemBody(form({ key: 'custom', customShares: { u1: '50', u3: '50' } }), units, 2025)
    expect((r as { body: Record<string, unknown> }).body.customShares).toEqual({ u1: 50 })
  })

  test('selbstgenutzte Wohnungen dürfen einen vereinbarten Anteil tragen', () => {
    const units = [unit('u1'), unit('u2', { participates: false, selfUsed: true })]
    const r = buildCostItemBody(form({ key: 'custom', customShares: { u1: '80', u2: '20' } }), units, 2025)
    expect((r as { body: Record<string, unknown> }).body.customShares).toEqual({ u1: 80, u2: 20 })
  })

  test('der Hinweistext nennt den Rest, den der Vermieter trägt', () => {
    expect(customSharesSumText(form({ customShares: { u1: '40', u2: '40' } }), UNITS))
      .toBe('80 % — die restlichen 20 % trägt der Vermieter')
    expect(customSharesSumText(form({ customShares: { u1: '50', u2: '50' } }), UNITS)).toBe('100 %')
    expect(customSharesSumText(form({ customShares: { u1: '80', u2: '80' } }), UNITS))
      .toBe('160 % — mehr als 100 % sind nicht möglich')
  })
})

describe('Felder eines nicht gewählten Schlüssels werden zurückgesetzt', () => {
  // undefined würde die generische PUT-Route überspringen — der alte Wert bliebe stehen.
  test('Wechsel von Verbrauch auf Fläche löscht den Zählertyp', () => {
    const r = buildCostItemBody(form({ key: 'area', meterType: 'kaltwasser' }), UNITS, 2025)
    const body = (r as { body: Record<string, unknown> }).body
    expect(body.meterType).toBeNull()
    expect(body.directUnitId).toBeNull()
    expect(body.customShares).toBeNull()
  })

  test('bei Verbrauchsumlage bleibt der Zählertyp erhalten', () => {
    const r = buildCostItemBody(form({ key: 'meter', meterType: 'sonstig' }), UNITS, 2025)
    expect((r as { body: Record<string, unknown> }).body.meterType).toBe('sonstig')
  })
})

describe('Bearbeiten einer gespeicherten Position', () => {
  test('Zählertyp und Anteile werden ins Formular übernommen', () => {
    const f = itemToForm({
      id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser',
      amountCents: 123456, key: 'meter', meterType: 'sonstig', labor35aCents: 1000,
      customShares: { u1: 33.33 },
    })
    expect(f.meterType).toBe('sonstig')
    expect(f.amount).toBe('1.234,56')
    expect(f.labor35a).toBe('10,00')
    expect(f.customShares).toEqual({ u1: '33,33' })
  })

  test('eine Position ohne Zählertyp füllt das Feld nicht mit einem geratenen Wert', () => {
    const f = itemToForm({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area' })
    expect(f.meterType).toBe('')
  })

  test('der Rundlauf Formular → Rumpf verändert die Anteile nicht', () => {
    const original = { u1: 12.5, u2: 87.5 }
    const f = itemToForm({
      id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'X',
      amountCents: 50000, key: 'custom', customShares: original,
    })
    const r = buildCostItemBody(f, UNITS, 2025)
    expect((r as { body: Record<string, unknown> }).body.customShares).toEqual(original)
  })
})
