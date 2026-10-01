import { describe, expect, test } from 'vitest'
import { parseEuro } from './api'
import { parseNumberDe } from './numbers'

describe('Geldbeträge lesen wie Mengen (zweite Integrationsdurchsicht zu #105)', () => {
  test('„1.240“ sind 1.240 € und nicht 1,24 €', () => {
    expect(parseEuro('1.240')).toBe(124000)
    expect(parseEuro('1.240,50')).toBe(124050)
    expect(parseEuro('12.50')).toBe(1250)
    expect(parseEuro('12,5')).toBe(1250)
    expect(parseEuro('€ 480,00')).toBe(48000)
    expect(parseEuro('-100,00')).toBe(-10000)
    // Das typografische Minus (U+2212) kommt aus kopierten Texten und von manchen Tastaturen (#139)
    expect(parseEuro('−100,00')).toBe(-10000)
    expect(parseEuro('− 1.240,50 €')).toBe(-124050)
  })
  test('Tippfehler werden abgelehnt statt still falsch gelesen', () => {
    expect(parseEuro('78.43,5')).toBeNull()
    expect(parseEuro('1,234.56')).toBeNull()
    expect(parseEuro('viel')).toBeNull()
    expect(parseEuro('')).toBeNull()
  })
  test('eine führende Null ist kein Tausendertrenner', () => {
    expect(parseNumberDe('0.500')).toBe(0.5)
  })
})
