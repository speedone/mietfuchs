import { describe, expect, test } from 'vitest'
import { buildTenantChange, defaultStart, EMPTY_NEW_TENANT, endProblem, meterProblem, parseMeterValue, type NewTenantForm } from './tenantChange'

const meters = [{ id: 'm1', name: 'KW EG' }, { id: 'm2', name: 'Haupt' }]
const input = (patch: Partial<Parameters<typeof buildTenantChange>[0]> = {}, tenant: Partial<NewTenantForm> = {}) => ({
  tenancy: { start: '2024-01-01' },
  endDate: '2025-06-30',
  meters,
  meterValues: { m1: '123,5', m2: '' },
  vacancy: false,
  newTenant: { ...EMPTY_NEW_TENANT, name: ' Neu ', start: '2025-07-01', persons: '3', baseRent: '800,00', prepayment: '150' },
  ...patch,
  ...(Object.keys(tenant).length ? { newTenant: { ...EMPTY_NEW_TENANT, name: 'Neu', start: '2025-07-01', persons: '3', ...tenant } } : {}),
})

describe('Mieterwechsel (#150)', () => {
  test('der ganze Wechsel wird ein Rumpf für eine einzige Anfrage', () => {
    expect(buildTenantChange(input())).toEqual({
      body: {
        end: '2025-06-30',
        readings: [{ meterId: 'm1', value: 123.5 }],
        newTenancy: {
          tenantName: 'Neu', persons: 3, personHistory: [{ from: '2025-07-01', persons: 3 }], start: '2025-07-01',
          baseRents: [{ from: '2025-07', monthlyCents: 80000 }], prepayments: [{ from: '2025-07', monthlyCents: 15000 }],
          prepaymentOverrides: {},
        },
      },
    })
  })

  test('Leerstand: kein neues Mietverhältnis, und die Angaben zum Nachmieter zählen nicht', () => {
    expect(buildTenantChange(input({ vacancy: true }, { name: '', persons: 'x' }))).toEqual({
      body: { end: '2025-06-30', readings: [{ meterId: 'm1', value: 123.5 }], newTenancy: null },
    })
  })

  test('was der Server ablehnen würde, wird vorher gemeldet', () => {
    expect(buildTenantChange(input({ endDate: '2023-12-31' }))).toHaveProperty('error')
    expect(buildTenantChange(input({ meterValues: { m1: 'viel' } }))).toEqual({ error: 'Zählerstand für „KW EG“ ist keine gültige Zahl.' })
    expect(buildTenantChange(input({}, { start: '2025-06-30' }))).toEqual({ error: 'Der Einzug des neuen Mieters muss nach dem Auszug liegen.' })
    expect(buildTenantChange(input({}, { name: '' }))).toHaveProperty('error')
    expect(buildTenantChange(input({}, { prepayment: 'abc' }))).toEqual({ error: 'Die Vorauszahlung bitte als Betrag angeben, z. B. 150,00.' })
    expect(buildTenantChange(input({}, { baseRent: 'viel' }))).toEqual({ error: 'Die Kaltmiete bitte als Betrag angeben, z. B. 800,00.' })
    for (const persons of ['', 'zwei', '-1', '1,5']) {
      expect(buildTenantChange(input({}, { persons })), persons).toEqual({ error: expect.stringMatching(/Personenzahl/) })
    }
    expect(buildTenantChange(input({ meterValues: { m1: '-3' } }))).toEqual({ error: 'Zählerstand für „KW EG“ ist keine gültige Zahl.' })
  })

  test('leere Beträge heißen keine Staffel', () => {
    const r = buildTenantChange(input({}, { baseRent: '', prepayment: '' }))
    if ('error' in r) throw new Error(r.error)
    expect(r.body.newTenancy?.baseRents).toEqual([])
    expect(r.body.newTenancy?.prepayments).toEqual([])
  })

  test('Zählerstände werden gelesen wie auf der Zähler-Seite (#149)', () => {
    expect(parseMeterValue('')).toBeNull()
    expect(parseMeterValue('1.234')).toBe(1234)
    expect(parseMeterValue('1.234,5')).toBe(1234.5)
    expect(parseMeterValue('-3')).toBeNull()
    expect(meterProblem(meters, { m1: '', m2: '  ' })).toBeNull()
  })

  test('Einzug standardmäßig am Tag nach dem Auszug, auch über den Jahreswechsel', () => {
    expect(defaultStart('2025-12-31')).toBe('2026-01-01')
    expect(endProblem('2025-06-30', { start: '2024-01-01' })).toBeNull()
    expect(endProblem('', { start: '2024-01-01' })).not.toBeNull()
  })
})

describe('Nachmieter unter getrennter Heizkostenabrechnung (Durchsicht von #231, Important 2)', () => {
  test('Die Heizvorauszahlung wird mit abgefragt und als eigene Staffel geschickt', () => {
    const r = buildTenantChange({ ...input({}, { prepayment: '177,00', heatingPrepayment: '123,00' }), askHeating: true })
    if ('error' in r) throw new Error(r.error)
    expect([r.body.newTenancy?.prepayments, r.body.newTenancy?.heatingPrepayments]).toEqual([[{ from: '2025-07', monthlyCents: 17700 }], [{ from: '2025-07', monthlyCents: 12300 }]])
    expect(buildTenantChange({ ...input({}, { prepayment: '177,00', heatingPrepayment: '' }), askHeating: true })).toEqual({ error: 'Bitte die Heizvorauszahlung des neuen Mieters angeben (0,00, wenn er keine zahlt).' })
  })
  test('Ohne getrennte Abrechnung bleibt der Rumpf wie bisher', () => {
    const r = buildTenantChange(input({}, { prepayment: '300,00' }))
    if ('error' in r) throw new Error(r.error)
    expect(Object.hasOwn(r.body.newTenancy ?? {}, 'heatingPrepayments')).toBe(false)
  })
})
