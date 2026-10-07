import { expect, test } from 'vitest'
import { hcaLines, hcaTitle } from './hcaView'
import { periodKey } from '../../shared/period.ts'
import type { HcaDeviceLine, HeatingServiceValue } from './types'

const name = (id: string) => (id === 'a' ? 'Wohnung A' : id === 'b' ? 'Wohnung B' : 'Wohnung C')
const dev = (over: Partial<HcaDeviceLine>): HcaDeviceLine => ({ unitId: 'a', meterId: 'a1', name: 'Wohnzimmer', scale: 'unit', factor: 1.25, raw: 500, rated: 625, userKeys: ['A'], from: '2025-01-01', to: '2025-12-31', ...over })
const A = { userKey: 'A', from: '2025-01-01', to: '2025-12-31' }

test('Druckblock: je Gerät Ablesewert, Skala und Faktor (Entwurf 8.8); Faktor mit allen Stellen', () => {
  const devices = [dev({}), dev({ meterId: 'a2', name: 'Bad', scale: 'product', factor: 1, raw: 160, rated: 160 }), dev({ unitId: 'b', meterId: 'b1', name: 'Küche', factor: 0.8125, raw: 1000, rated: 812.5, userKeys: ['B'] })]
  expect(hcaLines({ devices }, name, A)).toEqual([
    'Wohnung A, „Wohnzimmer“: Ablesewert 500 × Bewertungsfaktor 1,25 = 625 Einheiten (Einheitsskala)',
    'Wohnung A, „Bad“: 160 Einheiten (Produktskala, Faktor im Ablesewert enthalten)',
  ])
  expect(hcaLines({ devices }, name, { userKey: 'B', from: '2025-01-01', to: '2025-12-31' })).toEqual(['Wohnung B, „Küche“: Ablesewert 1.000 × Bewertungsfaktor 0,8125 = 812,5 Einheiten (Einheitsskala)'])
  // Auf der Seite Heizkosten alle, mit Zeitraum.
  expect(hcaLines({ devices }, name)[0]).toBe('Wohnung A, „Wohnzimmer“, 01.01.2025 bis 31.12.2025: Ablesewert 500 × Bewertungsfaktor 1,25 = 625 Einheiten (Einheitsskala)')
  expect(hcaTitle({ devices })).toBe('Heizkostenverteiler')
})

test('Durchsicht #241 Recht-I1: beim Mieterwechsel sieht jeder Nutzer nur sein Gerätesegment und seine Zeilen des Ablesedienstes', () => {
  const devices = [
    dev({ unitId: 'c', meterId: 'c1', name: 'Wohnzimmer', raw: 300, rated: 375, userKeys: ['C1'], from: '2025-01-01', to: '2025-09-30' }),
    dev({ unitId: 'c', meterId: 'c1', name: 'Wohnzimmer', raw: 200, rated: 250, userKeys: ['C2'], from: '2025-10-01', to: '2025-12-31' }),
  ]
  expect(hcaLines({ devices }, name, { userKey: 'C2', from: '2025-10-01', to: '2025-12-31' })).toEqual(['Wohnung C, „Wohnzimmer“: Ablesewert 200 × Bewertungsfaktor 1,25 = 250 Einheiten (Einheitsskala)'])
  const gruppe = [dev({ unitId: 'c', userKeys: ['C1', 'C2'] })]
  expect(hcaLines({ devices: gruppe }, name, { userKey: 'C2', from: '2025-10-01', to: '2025-12-31' })[0]).toMatch(/gemeinsam für mehrere Nutzer nach § 9b Abs\. 3/)
  const p = periodKey('2025-01')
  const serviceValues: HeatingServiceValue[] = [
    { plantId: 'hp', period: p, unitId: 'c', from: '2025-01-01', to: '2025-09-30', heatValue: 340, waterValue: 12, heatUnit: 'units' },
    { plantId: 'hp', period: p, unitId: 'c', from: '2025-10-01', to: '2025-12-31', heatValue: 100, waterValue: 3, heatUnit: 'units' },
  ]
  expect(hcaLines({ serviceValues }, name, { userKey: 'C2', from: '2025-10-01', to: '2025-12-31' }, 'c')).toEqual(['Wohnung C, 01.10.2025 bis 31.12.2025: Heizung 100 Einheiten, Warmwasser 3 m³ (laut Ablesedienst)'])
  expect(hcaLines({ serviceValues: [{ ...serviceValues[0], heatUnit: 'kWh' } as HeatingServiceValue] }, name, undefined, 'c')).toEqual(['Wohnung C, 01.01.2025 bis 30.09.2025: Heizung 340 kWh, Warmwasser 12 m³ (laut Ablesedienst)'])
  expect(hcaLines({ serviceValues }, name, A, 'a')).toEqual([])
  expect(hcaTitle({})).toBe('Werte des Ablesedienstes')
  expect(hcaLines({}, name)).toEqual([])
  expect(hcaLines(undefined, name)).toEqual([])
})
