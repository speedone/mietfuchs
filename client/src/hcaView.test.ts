import { expect, test } from 'vitest'
import { hcaLines, hcaTitle } from './hcaView'
import { periodKey } from '../../shared/period.ts'

test('Druckblock: je Gerät Einheiten, Skala und Faktor (Entwurf 8.8); Werte des Ablesedienstes je Zeile; nur die eigene Wohnung', () => {
  const name = (id: string) => (id === 'a' ? 'Wohnung A' : 'Wohnung B')
  const devices = [
    { unitId: 'a', meterId: 'a1', name: 'Wohnzimmer', scale: 'unit' as const, factor: 1.25, raw: 500, rated: 625 },
    { unitId: 'a', meterId: 'a2', name: 'Bad', scale: 'product' as const, factor: 1, raw: 160, rated: 160 },
    { unitId: 'b', meterId: 'b1', name: 'Küche', scale: 'unit' as const, factor: 0.8125, raw: 1000, rated: 812.5 },
  ]
  expect(hcaLines({ devices }, name, 'a')).toEqual([
    'Wohnung A, „Wohnzimmer“: 500 Einheiten × Bewertungsfaktor 1,25 = 625 Einheiten (Einheitsskala)',
    'Wohnung A, „Bad“: 160 Einheiten (Produktskala, Faktor im Wert enthalten)',
  ])
  // Der Faktor steht mit allen Stellen, wie gespeichert.
  expect(hcaLines({ devices }, name, 'b')).toEqual(['Wohnung B, „Küche“: 1.000 Einheiten × Bewertungsfaktor 0,8125 = 812,5 Einheiten (Einheitsskala)'])
  expect(hcaLines({ devices }, name)).toHaveLength(3)
  expect(hcaTitle({ devices })).toBe('Heizkostenverteiler')
  const serviceValues = [{ plantId: 'hp', period: periodKey('2025-01'), unitId: 'a', from: '2025-01-01', to: '2025-09-30', heatValue: 340, waterValue: 12 }]
  expect(hcaLines({ serviceValues }, name, 'a')).toEqual(['Wohnung A, 01.01.2025 bis 30.09.2025: Heizung 340 Einheiten, Warmwasser 12 (laut Ablesedienst)'])
  expect(hcaLines({ serviceValues }, name, 'b')).toEqual([])
  expect(hcaTitle({})).toBe('Werte des Ablesedienstes')
  expect(hcaLines({}, name)).toEqual([])
  expect(hcaLines(undefined, name)).toEqual([])
})
