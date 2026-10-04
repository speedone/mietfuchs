import { describe, expect, test } from 'vitest'
import type { CostKey, Meter, MeterType, Unit } from './types'
import { KEY_LABELS, matchCategory } from './types'
import {
  EMPTY_ITEM_FORM,
  sameCostOf,
  amountProblem,
  buildCostItemBody,
  costKeyOptions,
  customSharesSumText,
  itemToForm,
  meterTypeOptions,
  suggestedKey,
  amountsSumText,
  externalHint,
  externalMismatch,
  tenanciesForAmounts,
  categoryNotice,
  selfAmountUnits,
  externalTotalLabel,
  keyListText,
  showsKeyFields,
  showsTaxUnitField,
  taxScopeOf,
  TAX_SCOPE_SOME,
  toggleTaxUnit,
  withTaxUnit,
  withKey,
  withCategory,
  type ItemForm,
} from './costForm'

const unit = (id: string, extra: Partial<Unit> = {}): Unit => ({ propertyId: 'objekt-1',
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
  const ALL_TYPES: (MeterType | '')[] = ['', 'kaltwasser', 'strom', 'waerme', 'sonstig']
  const AVAILABLE: MeterType[][] = [[], ['sonstig'], ['kaltwasser'], ['strom', 'waerme'], ['kaltwasser', 'sonstig']]

  test('Zählertyp: jeder Formularwert steht in der angebotenen Liste', () => {
    for (const available of AVAILABLE) {
      for (const chosen of ALL_TYPES) {
        // '' entspricht der Option „— wählen —", die das Formular immer anbietet
        const options: (MeterType | '')[] = ['', ...meterTypeOptions(available, chosen)]
        expect(options, `vorhanden=${available} gewählt=${chosen}`).toContain(chosen)
      }
    }
  })

  test('Umlageschlüssel: jeder Formularwert steht in der angebotenen Liste', () => {
    for (const available of AVAILABLE) {
      for (const chosen of Object.keys(KEY_LABELS) as CostKey[]) {
        expect(costKeyOptions(available, chosen), `vorhanden=${available} gewählt=${chosen}`).toContain(chosen)
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

  test('Gutschrift (#139): ein negativer Betrag wird angenommen, mit „-“ und mit typografischem „−“', () => {
    for (const amount of ['-54,00', '-54', '−54,00', '− 54,00']) {
      const r = buildCostItemBody(form({ amount }), UNITS, 2025)
      expect(r, amount).toHaveProperty('body')
      expect((r as { body: Record<string, unknown> }).body.amountCents, amount).toBe(-5400)
    }
  })

  test('Betrag (#139): die Meldung nennt den Grund', () => {
    expect(buildCostItemBody(form({ description: '  ' }), UNITS, 2025)).toEqual({ error: 'Bitte eine Beschreibung angeben.' })
    expect((buildCostItemBody(form({ amount: '0' }), UNITS, 2025) as { error: string }).error).toMatch(/0 €/)
    expect((buildCostItemBody(form({ amount: '0,00' }), UNITS, 2025) as { error: string }).error).toMatch(/0 €/)
    expect((buildCostItemBody(form({ amount: '' }), UNITS, 2025) as { error: string }).error).toMatch(/Betrag/)
    expect((buildCostItemBody(form({ amount: 'abc' }), UNITS, 2025) as { error: string }).error).toMatch(/Gutschrift mit Minus/)
  })

  test('Gutschrift (#139): kein §35a-Lohnanteil, und die Meldung sagt warum', () => {
    // Bescheinigt werden nach § 35a EStG gezahlte Lohnkosten. Die Berechnung bescheinigte bei
    // einer Gutschrift ohnehin nichts (calc.ts warnt), die Steuerübersicht zählte den Lohnanteil
    // aber mit. Deshalb schon beim Erfassen ablehnen.
    const r = buildCostItemBody(form({ amount: '-54,00', labor35a: '10,00' }), UNITS, 2025)
    expect(r).toEqual({ error: 'Bei einer Gutschrift gibt es keinen §35a-Lohnanteil. Bitte das Feld leer lassen.' })
    expect(buildCostItemBody(form({ amount: '-54,00', labor35a: '0' }), UNITS, 2025)).toHaveProperty('body')
  })

  test('Gutschrift (#139): nicht nach Einzelbeträgen', () => {
    const r = buildCostItemBody(form({ amount: '-54,00', key: 'amounts' }), UNITS, 2025)
    expect(r).toEqual({ error: 'Bei einer Gutschrift sind Einzelbeträge nicht möglich; verteilen Sie sie bitte nach einem anderen Schlüssel.' })
  })

  test('amountProblem: an einer Zuführung zur Erhaltungsrücklage gibt es keinen §35a-Lohnanteil (#143)', () => {
    expect(amountProblem(90000, 20000, 'Zuführung Erhaltungsrücklage')).toMatch(/Erhaltungsrücklage/)
    expect(amountProblem(90000, 0, 'Zuführung Erhaltungsrücklage')).toBeNull()
    expect(amountProblem(90000, 20000, 'Gartenpflege')).toBeNull()
    expect(buildCostItemBody(form({ category: 'Zuführung Erhaltungsrücklage', amount: '900,00', labor35a: '200,00' }), UNITS, 2025)).toHaveProperty('error')
  })

  test('amountProblem (#139): dieselbe Prüfung wie das Formular, für übernommene Positionen', () => {
    expect(amountProblem(-5400, 0)).toBeNull()
    expect(amountProblem(10000, 4000)).toBeNull()
    expect(amountProblem(0, 0)).toMatch(/0 €/)
    expect(amountProblem(null, 0)).toMatch(/Gutschrift mit Minus/)
    expect(amountProblem(-5400, 1000)).toMatch(/Gutschrift gibt es keinen §35a-Lohnanteil/)
    expect(amountProblem(10000, 15000)).toMatch(/§35a-Lohnanteil/)
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
      id: 'c1', propertyId: 'objekt-1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser',
      amountCents: 123456, key: 'meter', meterType: 'sonstig', labor35aCents: 1000,
      customShares: { u1: 33.33 },
    })
    expect(f.meterType).toBe('sonstig')
    expect(f.amount).toBe('1.234,56')
    expect(f.labor35a).toBe('10,00')
    expect(f.customShares).toEqual({ u1: '33,33' })
  })

  test('eine Position ohne Zählertyp füllt das Feld nicht mit einem geratenen Wert', () => {
    const f = itemToForm({ id: 'c1', propertyId: 'objekt-1', year: 2025, category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area' })
    expect(f.meterType).toBe('')
  })

  test('der Rundlauf Formular → Rumpf verändert die Anteile nicht', () => {
    const original = { u1: 12.5, u2: 87.5 }
    const f = itemToForm({
      id: 'c1', propertyId: 'objekt-1', year: 2025, category: 'Sonstige Betriebskosten', description: 'X',
      amountCents: 50000, key: 'custom', customShares: original,
    })
    const r = buildCostItemBody(f, UNITS, 2025)
    expect((r as { body: Record<string, unknown> }).body.customShares).toEqual(original)
  })
})

// ---------- Verteilbasis erweitern (#94) ----------

describe('Teilnehmer, Gemeinschaftsabrechnung und Einzelbeträge (#94)', () => {
  const t = (id: string, unitId: string, start = '2025-01-01', end: string | null = null) => ({
    id, unitId, tenantName: id, persons: 1, personHistory: [], start, end, prepayments: [], prepaymentOverrides: {}, baseRents: [],
  })

  test('die beiden neuen Schlüssel werden angeboten', () => {
    expect(costKeyOptions([], 'area')).toEqual(expect.arrayContaining(['external', 'amounts']))
  })

  test('Teilnehmer: alle angehakt heißt null, damit neue Wohnungen dazugehören; bei Direktzuordnung nie', () => {
    const alle = buildCostItemBody(form({ key: 'area', participants: ['u1', 'u2'] }), UNITS, 2025)
    expect(alle).toMatchObject({ body: { participantUnitIds: null } })
    const eine = buildCostItemBody(form({ key: 'area', participants: ['u2'] }), UNITS, 2025)
    expect(eine).toMatchObject({ body: { participantUnitIds: ['u2'] } })
    expect(buildCostItemBody(form({ key: 'area', participants: [] }), UNITS, 2025)).toHaveProperty('error')
    const direkt = buildCostItemBody(form({ key: 'direct', directUnitId: 'u1', participants: ['u2'] }), UNITS, 2025)
    expect(direkt).toMatchObject({ body: { participantUnitIds: null } })
  })

  test('Gemeinschaft: die Angaben kommen als ein Wert in den Rumpf, ohne sie gibt es einen Fehler', () => {
    const r = buildCostItemBody(form({ key: 'external', amount: '620,00', externalMeasure: 'mea', externalTotal: '10.000', externalTotalAmount: '50.000,00' }), UNITS, 2025)
    expect(r).toMatchObject({ body: { key: 'external', externalBasis: { measure: 'mea', total: 10000, totalCents: 5000000 }, tenancyAmounts: null } })
    expect(buildCostItemBody(form({ key: 'external', externalTotal: '', externalTotalAmount: '50.000,00' }), UNITS, 2025)).toHaveProperty('error')
    expect(buildCostItemBody(form({ key: 'area', externalTotal: '10000', externalTotalAmount: '1,00' }), UNITS, 2025)).toMatchObject({ body: { externalBasis: null } })
  })

  test('Gemeinschaft: der rechnerische Anteil steht zum Vergleich unter dem Betrag', () => {
    const wohnungen = [unit('u1', { mea: 124 })]
    const text = externalHint(form({ key: 'external', amount: '620,00', externalMeasure: 'mea', externalTotal: '10000', externalTotalAmount: '50.000,00' }), wohnungen)
    expect(text).toMatch(/124 von 10\.000 MEA/)
    expect(text).toMatch(/620,00/)
  })

  test('Gemeinschaft: weicht der rechnerische Anteil um mehr als 1 € vom Betrag ab, ist er markiert (#144)', () => {
    const wohnungen = [unit('u1', { mea: 124 })]
    const angaben = { key: 'external' as const, externalMeasure: 'mea' as const, externalTotal: '10000', externalTotalAmount: '50.000,00' }
    // Toleranz wie die Warnung external.amount-mismatch in calc.ts: bis 1,00 € passt es.
    expect(externalMismatch(form({ ...angaben, amount: '620,00' }), wohnungen)).toBe(false)
    expect(externalMismatch(form({ ...angaben, amount: '621,00' }), wohnungen)).toBe(false)
    expect(externalMismatch(form({ ...angaben, amount: '621,01' }), wohnungen)).toBe(true)
    expect(externalHint(form({ ...angaben, amount: '400,00' }), wohnungen)).toMatch(/weicht um 220,00 € vom Betrag ab/)
    expect(externalHint(form({ ...angaben, amount: '620,00' }), wohnungen)).not.toMatch(/weicht/)
  })

  test('Einzelbeträge: je Mietverhältnis des Jahres, die Summe darf den Betrag nicht übersteigen', () => {
    const mieter = [t('t1', 'u1', '2025-01-01', '2025-06-30'), t('t2', 'u1', '2025-07-01'), t('alt', 'u2', '2020-01-01', '2024-12-31')]
    expect(tenanciesForAmounts(mieter, UNITS, 2025).map((x) => x.id)).toEqual(['t1', 't2'])
    const ok = buildCostItemBody(form({ key: 'amounts', amount: '800,00', tenancyAmounts: { t1: '300,00', t2: '400,00', alt: '' } }), UNITS, 2025)
    expect(ok).toMatchObject({ body: { key: 'amounts', tenancyAmounts: { t1: 30000, t2: 40000 }, externalBasis: null } })
    expect(buildCostItemBody(form({ key: 'amounts', amount: '100,00', tenancyAmounts: { t1: '120,00' } }), UNITS, 2025)).toHaveProperty('error')
    expect(buildCostItemBody(form({ key: 'amounts', amount: '100,00', tenancyAmounts: { t1: 'viel' } }), UNITS, 2025)).toHaveProperty('error')
    expect(amountsSumText(form({ key: 'amounts', amount: '800,00', tenancyAmounts: { t1: '300,00', t2: '400,00' } }), UNITS)).toMatch(/700,00.*100,00 .*Vermieter/)
  })

  test('eine gespeicherte Position füllt die neuen Felder', () => {
    const f = itemToForm({
      id: 'c', propertyId: 'objekt-1', year: 2025, category: 'Heizung', description: 'H', amountCents: 80000, key: 'amounts',
      participantUnitIds: ['u1'], tenancyAmounts: { t1: 30000 },
      externalBasis: { measure: 'area', total: 1240, totalCents: 100000 },
    })
    expect(f.participants).toEqual(['u1'])
    expect(f.tenancyAmounts).toEqual({ t1: '300,00' })
    expect([f.externalMeasure, f.externalTotal, f.externalTotalAmount]).toEqual(['area', '1.240', '1.000,00'])
    expect(itemToForm({ id: 'c', propertyId: 'objekt-1', year: 2025, category: 'X', description: 'X', amountCents: 1, key: 'area' }).participants).toBeNull()
  })
})

describe('Heizkostenart (#93)', () => {
  test('„Warmwasser“ und der Messdienst landen bei Heizung, nicht bei Wasser/Abwasser', () => {
    expect(matchCategory('Warmwasserkosten')).toBe('Heizung und Warmwasser')
    expect(matchCategory('Heizkostenabrechnung Techem')).toBe('Heizung und Warmwasser')
    expect(matchCategory('Frischwasser')).toBe('Wasser/Abwasser')
  })

  test('Reparaturen an der Heizung bleiben nicht umlagefähig, und kein Treffer mitten im Wort', () => {
    expect(matchCategory('Heizungsreparatur')).toBe('Nicht umlagefähig')
    expect(matchCategory('Wärmedämmung Fassade')).toBe('Nicht umlagefähig')
    expect(matchCategory('Distanzzuschlag')).toBe('Sonstige Betriebskosten')
    expect(matchCategory('ista Energieabrechnung')).toBe('Heizung und Warmwasser')
  })
})

describe('Kabelfernsehen (#107)', () => {
  test('ab dem Abrechnungsjahr 2024 steht am Formular ein Hinweis, vorher nicht', () => {
    expect(categoryNotice('Kabel/Antenne', 2023)).toBe('')
    expect(categoryNotice('Kabel/Antenne', 2024)).toMatch(/30\.06\.2024/)
    expect(categoryNotice('Kabel/Antenne', 2025)).toMatch(/nicht mehr umlagefähig/)
    expect(categoryNotice('Grundsteuer', 2025)).toBe('')
    // Derselbe Rechtsstand wie die Warnung der Abrechnung (#109): Betriebsstrom nur bei Anlagen vor
    // dem 01.12.2021, Prüfung und Einstellung nur bei einer Gemeinschaftsantenne.
    for (const y of [2024, 2025]) {
      expect(categoryNotice('Kabel/Antenne', y)).toMatch(/vor dem 01\.12\.2021/)
      expect(categoryNotice('Kabel/Antenne', y)).not.toMatch(/Wartung einer Antenne/)
    }
  })
})

describe('Eigenbeträge (#104)', () => {
  const EIGEN = [unit('u1', { participates: false, selfUsed: true }), unit('u2')]

  test('der Betrag der eigenen Wohnung wird gespeichert, gelesen und in die Summe gezählt', () => {
    const f = form({ key: 'amounts', amount: '3.000,00', tenancyAmounts: { t1: '1.240,00' }, selfAmounts: { u1: '1.600,00' } })
    expect(buildCostItemBody(f, EIGEN, 2025)).toMatchObject({ body: { tenancyAmounts: { t1: 124000 }, selfAmounts: { u1: 160000 } } })
    expect(amountsSumText(f, EIGEN)).toMatch(/2\.840,00.*160,00/)
    expect(buildCostItemBody(form({ key: 'amounts', amount: '1.000,00', tenancyAmounts: { t1: '600,00' }, selfAmounts: { u1: '500,00' } }), EIGEN, 2025)).toHaveProperty('error')
    expect(itemToForm({ id: 'c', propertyId: 'objekt-1', year: 2025, category: 'X', description: 'X', amountCents: 1, key: 'amounts', selfAmounts: { u1: 160000 } }).selfAmounts).toEqual({ u1: '1.600,00' })
    expect(buildCostItemBody(form({ key: 'area', amount: '100,00', selfAmounts: { u1: '1,00' } }), EIGEN, 2025)).toMatchObject({ body: { selfAmounts: null } })
  })

  test('ein Eigenbetrag, dessen Feld nicht mehr erscheint, zählt nicht und wird nicht gespeichert', () => {
    // Befund der Durchsicht: Wohnung u2 war selbstgenutzt und ist jetzt vermietet. Ihr alter
    // Betrag stand unsichtbar im Formular, blockierte das Speichern und ließ sich nicht löschen.
    const f = form({ key: 'amounts', amount: '1.000,00', tenancyAmounts: { t1: '400,00', t2: '600,00' }, selfAmounts: { u2: '600,00' } })
    const r = buildCostItemBody(f, EIGEN, 2025)
    expect(r).not.toHaveProperty('error')
    expect(r).toMatchObject({ body: { selfAmounts: {} } })
    expect(amountsSumText(f, EIGEN)).not.toMatch(/eigene Wohnung/)
    // Dasselbe, wenn die eigene Wohnung an der Position nicht teilnimmt.
    const g = form({ key: 'amounts', amount: '1.000,00', participants: ['u2'], tenancyAmounts: { t1: '1.000,00' }, selfAmounts: { u1: '100,00' } })
    expect(buildCostItemBody(g, EIGEN, 2025)).toMatchObject({ body: { selfAmounts: {} } })
    expect(selfAmountUnits(EIGEN, ['u2'])).toEqual([])
    expect(selfAmountUnits(EIGEN, null).map((u) => u.id)).toEqual(['u1'])
  })
})

describe('Kleinigkeiten (#105)', () => {
  test('Gutschrift mit Einzelbeträgen: ein klarer Satz statt einer falschen Summenwarnung', () => {
    // Das Formular nimmt Beträge unter null ohnehin nicht an; eine Gutschrift kann aber über die
    // KI-Auswertung hereinkommen, und dann stand hier eine unsinnige Summenwarnung.
    const g = form({ key: 'amounts', amount: '-100,00', tenancyAmounts: { t1: '50,00' } })
    expect(amountsSumText(g, UNITS)).toMatch(/Gutschrift/)
  })

  test('Teilnehmer: der Hinweis zur Gemeinschaftsabrechnung und die Mieterliste der Einzelbeträge beachten sie', () => {
    const units = [unit('u1', { mea: 60 }), unit('u2', { mea: 40 })]
    const f = form({ key: 'external', amount: '100,00', externalMeasure: 'mea', externalTotal: '1.000', externalTotalAmount: '2.000,00', participants: ['u1'] })
    expect(externalHint(f, units)).toMatch(/60 von 1\.000 MEA/)
    const t = (id: string, unitId: string) => ({ id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] })
    expect(tenanciesForAmounts([t('a', 'u1'), t('b', 'u2')], units, 2025, ['u2']).map((x) => x.id)).toEqual(['b'])
  })

  test('die Summe der Anlage behält beim erneuten Speichern ihre Nachkommastellen', () => {
    const f = itemToForm({ id: 'c', propertyId: 'objekt-1', year: 2025, category: 'X', description: 'X', amountCents: 1, key: 'external', externalBasis: { measure: 'mea', total: 1000.125, totalCents: 1 } })
    expect(f.externalTotal).toBe('1.000,125')
  })
})

describe('Durchsicht zu #105', () => {
  test('Einzelbeträge abgewählter Teilnehmer zählen nicht und werden nicht gespeichert', () => {
    const t = (id: string, unitId: string) => ({ id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] })
    const tenancies = [t('t1', 'u1'), t('t2', 'u2')]
    const f = form({ key: 'amounts', amount: '1.000,00', participants: ['u2'], tenancyAmounts: { t1: '600,00', t2: '500,00' } })
    expect(amountsSumText(f, UNITS, tenancies, 2025)).toMatch(/^Summe 500,00/)
    expect(buildCostItemBody(f, UNITS, 2025, tenancies)).toMatchObject({ body: { tenancyAmounts: { t2: 50000 } } })
  })
})

describe('Kabelanlage am Objekt (#121)', () => {
  test('ist die Anlage ab dem 01.12.2021 errichtet, sagt das Formular es schon ab 2021', () => {
    expect(categoryNotice('Kabel/Antenne', 2022, false)).toMatch(/nie umlagefähig/)
    expect(categoryNotice('Kabel/Antenne', 2020, false)).toBe('')
    expect(categoryNotice('Kabel/Antenne', 2023, null)).toBe('')
    expect(categoryNotice('Kabel/Antenne', 2025, true)).toMatch(/nicht mehr umlagefähig/)
  })
})

describe('Vorschlag des Schlüssels je Kostenart (#142)', () => {
  const unit = (id: string, over: Partial<Unit> = {}): Unit => ({ id, propertyId: 'p', name: id, areaM2: 50, participates: true, ...over })
  const meter = (unitId: string | null, type: MeterType = 'kaltwasser'): Meter => ({ id: `m-${unitId}`, propertyId: 'p', name: 'Zähler', unitId, type, unit: 'm³' })
  const zwei = [unit('a'), unit('b')]

  test('Wasser/Abwasser, jede beteiligte Wohnung hat einen Kaltwasserzähler: nach Verbrauch, Zählertyp Kaltwasser', () => {
    expect(suggestedKey('Wasser/Abwasser', zwei, [meter('a'), meter('b')])).toEqual({ key: 'meter', meterType: 'kaltwasser' })
  })

  test('nur eine von zwei Wohnungen hat einen Zähler: kein Verbrauchsvorschlag, sonst zahlte einer die Lücke', () => {
    expect(suggestedKey('Wasser/Abwasser', zwei, [meter('a')])).toEqual({ key: 'persons', meterType: '' })
    // ein Hauptzähler allein ändert daran nichts
    expect(suggestedKey('Wasser/Abwasser', zwei, [meter('a'), meter(null)])).toEqual({ key: 'persons', meterType: '' })
  })

  test('eine Wohnung ohne Wasseranschluss braucht keinen Zähler; selbstgenutzte und nicht beteiligte zählen nicht mit', () => {
    const units = [unit('a'), unit('garage', { noConnection: ['kaltwasser'] }), unit('eigen', { participates: false, selfUsed: true }), unit('aus', { participates: false })]
    expect(suggestedKey('Wasser/Abwasser', units, [meter('a')])).toEqual({ key: 'meter', meterType: 'kaltwasser' })
  })

  test('ohne Kaltwasserzähler oder ohne beteiligte Wohnung bleibt es bei der Personenzahl', () => {
    expect(suggestedKey('Wasser/Abwasser', zwei, [])).toEqual({ key: 'persons', meterType: '' })
    expect(suggestedKey('Wasser/Abwasser', zwei, [meter('a', 'strom'), meter('b', 'strom')])).toEqual({ key: 'persons', meterType: '' })
    expect(suggestedKey('Wasser/Abwasser', [], [])).toEqual({ key: 'persons', meterType: '' })
  })

  test('andere Kostenarten unverändert', () => {
    expect(suggestedKey('Müllabfuhr', zwei, [meter('a'), meter('b')])).toEqual({ key: 'persons', meterType: '' })
    expect(suggestedKey('Grundsteuer', zwei, [meter('a'), meter('b')])).toEqual({ key: 'area', meterType: '' })
  })

  test('der Vorschlag steht in beiden Auswahllisten, angezeigt wird also, was gespeichert wird', () => {
    const s = suggestedKey('Wasser/Abwasser', zwei, [meter('a'), meter('b')])
    expect(costKeyOptions(['kaltwasser'], s.key)).toContain(s.key)
    expect(meterTypeOptions(['kaltwasser'], s.meterType)).toContain(s.meterType)
  })
})

describe('Kleinigkeiten aus der Browser-Abnahme (#142)', () => {
  test('Summe in der Anlage: gemeint sind die Anteile, nicht die Kosten, und zwar je Maßstab', () => {
    expect(externalTotalLabel('mea')).toBe('Summe der Miteigentumsanteile in der Anlage (z. B. 1.000 MEA)')
    expect(externalTotalLabel('area')).toBe('Summe der Wohnflächen in der Anlage (z. B. 1.240 m²)')
    expect(externalTotalLabel('units')).toBe('Zahl der Einheiten in der Anlage (z. B. 24)')
    // Die Meldung beim Speichern sagt dasselbe.
    const r = buildCostItemBody(form({ key: 'external', amount: '100,00' }), UNITS, 2025)
    expect(r).toEqual({ error: 'Bitte aus der Gemeinschaftsabrechnung die Summe der Anteile in der Anlage und die Kosten der Gemeinschaft eintragen.' })
  })

  test('Einzelbeträge: „den Rest trägt der Vermieter“, und ohne Rest steht kein Rest da', () => {
    expect(amountsSumText(form({ key: 'amounts', amount: '800,00', tenancyAmounts: { t1: '300,00', t2: '400,00' } }), UNITS))
      .toBe('Summe 700,00 € — den Rest von 100,00 € trägt der Vermieter (etwa für Leerstand)')
    expect(amountsSumText(form({ key: 'amounts', amount: '700,00', tenancyAmounts: { t1: '300,00', t2: '400,00' } }), UNITS))
      .toBe('Summe 700,00 € — der Rechnungsbetrag ist vollständig verteilt')
  })

  test('Nicht umlagefähig: kein Schlüssel im Formular, in der Liste „trägt der Vermieter“', () => {
    expect(showsKeyFields('Nicht umlagefähig')).toBe(false)
    expect(showsKeyFields('Zuführung Erhaltungsrücklage')).toBe(false)
    expect(showsKeyFields('Grundsteuer')).toBe(true)
    const base = { id: 'c', propertyId: 'p', year: 2025, description: 'X', amountCents: 100 } as const
    expect(keyListText({ ...base, category: 'Nicht umlagefähig', key: 'persons' })).toBe('— trägt der Vermieter')
    expect(keyListText({ ...base, category: 'Grundsteuer', key: 'persons' })).toBe('nach Personenzahl')
  })

  test('Nicht umlagefähig: gespeichert wird kein Schlüssel mit Zuordnungen, sondern die neutrale Vorgabe', () => {
    // Die Berechnung liest den Schlüssel einer nicht umlagefähigen Position nicht (calc.ts,
    // `isNotAllocable`); eine Direktzuordnung ohne Wohnung darf das Speichern deshalb nicht aufhalten,
    // und Anteile, Teilnehmer oder Einzelbeträge bleiben nicht als tote Angaben stehen.
    const f = form({
      category: 'Nicht umlagefähig', amount: '500,00', key: 'custom', customShares: { u1: '40' }, participants: ['u1'],
      directUnitId: 'u1', meterType: 'kaltwasser', tenancyAmounts: { t1: '10,00' },
    })
    expect(buildCostItemBody(f, UNITS, 2025)).toMatchObject({
      body: { key: 'area', directUnitId: null, meterType: null, customShares: null, participantUnitIds: null, externalBasis: null, tenancyAmounts: null, selfAmounts: null },
    })
    expect(buildCostItemBody(form({ category: 'Zuführung Erhaltungsrücklage', amount: '900,00', key: 'direct', directUnitId: '' }), UNITS, 2025))
      .toMatchObject({ body: { key: 'area', directUnitId: null } })
  })

  test('Nicht umlagefähig: für die Steuer einer Einheit zuordenbar, sonst das ganze Gebäude (#163)', () => {
    // Die Abrechnung liest den Schlüssel weiter nicht; die Steuerübersicht teilt damit auf: eine
    // Badrenovierung der vermieteten Wohnung voll abziehbar, eine der eigenen gar nicht.
    expect(showsTaxUnitField('Nicht umlagefähig')).toBe(true)
    expect(showsTaxUnitField('Zuführung Erhaltungsrücklage')).toBe(false)
    expect(showsTaxUnitField('Grundsteuer')).toBe(false)
    const f = withTaxUnit(form({ category: 'Nicht umlagefähig', amount: '4.000,00' }), 'u1')
    expect(f).toMatchObject({ key: 'direct', directUnitId: 'u1' })
    expect(buildCostItemBody(f, UNITS, 2025)).toMatchObject({ body: { key: 'direct', directUnitId: 'u1', customShares: null, participantUnitIds: null } })
    // Zurück auf das ganze Gebäude: der neutrale Schlüssel ohne Einheit.
    const g = withTaxUnit(f, '')
    expect(g).toMatchObject({ key: 'area', directUnitId: '' })
    expect(buildCostItemBody(g, UNITS, 2025)).toMatchObject({ body: { key: 'area', directUnitId: null } })
    // In der Liste steht, wen die Position betrifft.
    const base = { id: 'c', propertyId: 'p', year: 2025, description: 'X', amountCents: 100 } as const
    expect(keyListText({ ...base, category: 'Nicht umlagefähig', key: 'direct', directUnitId: 'u1' }, UNITS)).toBe('— trägt der Vermieter · betrifft U1')
    expect(keyListText({ ...base, category: 'Nicht umlagefähig', key: 'area' }, UNITS)).toBe('— trägt der Vermieter')
  })

  test('Nicht umlagefähig: nur bestimmte Einheiten betroffen, etwa das Dach des Hinterhauses (#163, Durchsicht)', () => {
    const base = form({ category: 'Nicht umlagefähig', amount: '3.000,00' })
    expect(taxScopeOf(base)).toBe('')
    const einige = withTaxUnit(base, TAX_SCOPE_SOME)
    expect(taxScopeOf(einige)).toBe(TAX_SCOPE_SOME)
    // Ohne gewählte Einheit wird nicht gespeichert.
    expect(buildCostItemBody(einige, UNITS, 2025)).toEqual({ error: 'Bitte mindestens eine Einheit wählen, die diese Position betrifft.' })
    const hinterhaus = toggleTaxUnit(einige, 'u2', true)
    expect(hinterhaus.participants).toEqual(['u2'])
    expect(buildCostItemBody(hinterhaus, UNITS, 2025)).toMatchObject({ body: { key: 'area', directUnitId: null, participantUnitIds: ['u2'] } })
    expect(taxScopeOf(toggleTaxUnit(hinterhaus, 'u2', false))).toBe(TAX_SCOPE_SOME)
    // Zurück auf das ganze Gebäude oder eine Einheit: keine Teilnehmer mehr.
    expect(withTaxUnit(hinterhaus, '')).toMatchObject({ key: 'area', participants: null })
    expect(withTaxUnit(hinterhaus, 'u1')).toMatchObject({ key: 'direct', directUnitId: 'u1', participants: null })
    // Gespeicherte Teilnehmer kommen als „bestimmte Einheiten“ zurück, und die Liste nennt sie.
    const stored = { id: 'c', propertyId: 'p', year: 2025, description: 'Dach', amountCents: 300000, category: 'Nicht umlagefähig', key: 'area', participantUnitIds: ['u2'] } as const
    expect(taxScopeOf(itemToForm({ ...stored, participantUnitIds: ['u2'] }))).toBe(TAX_SCOPE_SOME)
    expect(keyListText({ ...stored, participantUnitIds: ['u2'] }, UNITS)).toBe('— trägt der Vermieter · betrifft U2')
    // Wer von einer umlagefähigen Kostenart wechselt, nimmt keine alten Teilnehmer mit.
    const vorher = form({ category: 'Grundsteuer', key: 'area', participants: ['u1'] })
    expect(withCategory(vorher, 'Nicht umlagefähig', UNITS, [])).toMatchObject({ key: 'area', participants: null, directUnitId: '' })
  })

  test('Verbrauchsschlüssel: gibt es nur einen Zählertyp, ist er vorgewählt und gespeichert', () => {
    expect(withKey(form(), 'meter', ['kaltwasser'])).toMatchObject({ key: 'meter', meterType: 'kaltwasser' })
    // Bei zwei Typen wählt der Mensch.
    expect(withKey(form(), 'meter', ['kaltwasser', 'waerme'])).toMatchObject({ key: 'meter', meterType: '' })
    // Eine schon getroffene Wahl bleibt.
    expect(withKey(form({ meterType: 'sonstig' }), 'meter', ['kaltwasser'])).toMatchObject({ meterType: 'sonstig' })
    expect(withKey(form(), 'area', ['kaltwasser'])).toMatchObject({ key: 'area', meterType: '' })
  })
})

describe('Kostenart wechseln (Durchsicht zu #142)', () => {
  const unit = (id: string): Unit => ({ id, propertyId: 'p', name: id, areaM2: 50, participates: true })
  const meter = (unitId: string): Meter => ({ id: `m-${unitId}`, propertyId: 'p', name: 'Zähler', unitId, type: 'kaltwasser', unit: 'm³' })
  const units = [unit('a'), unit('b')]
  const meters = [meter('a'), meter('b')]

  test('eine neue Position bekommt den Vorschlag der Kostenart', () => {
    expect(withCategory(form(), 'Wasser/Abwasser', units, meters)).toMatchObject({ category: 'Wasser/Abwasser', key: 'meter', meterType: 'kaltwasser' })
  })

  test('eine bestehende behält ihren Schlüssel, außer sie wird aus „nicht umlagefähig“ umlagefähig', () => {
    const bestehend = form({ id: 'c', category: 'Grundsteuer', key: 'persons' })
    expect(withCategory(bestehend, 'Wasser/Abwasser', units, meters)).toMatchObject({ key: 'persons', meterType: '' })
    // Die neutrale Vorgabe „area“ einer nicht umlagefähigen Position ist keine Wahl des Nutzers.
    const verwaltung = form({ id: 'c', category: 'Nicht umlagefähig', key: 'area' })
    expect(withCategory(verwaltung, 'Wasser/Abwasser', units, meters)).toMatchObject({ key: 'meter', meterType: 'kaltwasser' })
    expect(withCategory(verwaltung, 'Zuführung Erhaltungsrücklage', units, meters)).toMatchObject({ key: 'area' })
  })
})

// Rückfrage „Dieselbe Rechnung?“ beim Anlegen (Befund gegen 0.10.0-rc.1): Eine Gutschrift ist nie
// dieselbe Rechnung wie eine Rechnung derselben Kostenart. Die Rückfrage riet sonst, statt der
// Gutschrift die vorhandene Rechnung zu bearbeiten.
describe('Rückfrage nach derselben Rechnung', () => {
  const rechnung = { id: 'r', propertyId: 'p', year: 2026, category: 'Wasser', description: 'Wasser 2026', amountCents: 84000 }
  const gutschrift = { id: 'g', propertyId: 'p', year: 2026, category: 'Wasser', description: 'Gutschrift Wasser', amountCents: -5745 }
  const body = (amountCents: number | null) => ({ category: 'Wasser', description: 'Wasser', vendor: '', amountCents })
  test('eine Gutschrift fragt nur nach Gutschriften, eine Rechnung nur nach Rechnungen (rc.1)', () => {
    expect(sameCostOf([rechnung, gutschrift], body(-5745), 'p', 2026).map((i) => i.id)).toEqual(['g'])
    expect(sameCostOf([rechnung], body(-5745), 'p', 2026)).toEqual([])
    expect(sameCostOf([rechnung, gutschrift], body(84000), 'p', 2026).map((i) => i.id)).toEqual(['r'])
  })
})
