import { describe, expect, it } from 'vitest'
import { lengthPx, pageContentWidthPx, printMediaMatches } from './printFit'

// Andere Merkmale (hover, pointer, prefers-…) fragt die Notbremse beim Browser; hier fest
const device = (condition: string) => condition === '(hover:hover)'

describe('printMediaMatches: welche Regel im Druck gilt, bei der Breite der Seite', () => {
  it('Druck ja, Bildschirm nein', () => {
    expect(printMediaMatches('print', 703, device)).toBe(true)
    expect(printMediaMatches('not print', 703, device)).toBe(false)
    expect(printMediaMatches('screen', 703, device)).toBe(false)
    expect(printMediaMatches('not screen', 703, device)).toBe(true)
    expect(printMediaMatches('all', 703, device)).toBe(true)
    expect(printMediaMatches('', 703, device)).toBe(true)
  })

  it('Breiten gegen die Seite, nicht gegen das Fenster (Bereichsschreibweise wie aus dem Build)', () => {
    expect(printMediaMatches('(width<=720px)', 703, device)).toBe(true)
    expect(printMediaMatches('(width<=640px)', 703, device)).toBe(false)
    expect(printMediaMatches('(width>=48rem)', 703, device)).toBe(false)
    expect(printMediaMatches('(width>=40rem)', 703, device)).toBe(true)
    expect(printMediaMatches('(min-width: 40rem)', 703, device)).toBe(true)
    expect(printMediaMatches('(max-width: 640px)', 703, device)).toBe(false)
    expect(printMediaMatches('not all and (width>=40rem)', 703, device)).toBe(false)
  })

  it('Typ und Bedingungen zusammen, Listen mit Komma', () => {
    expect(printMediaMatches('screen and (width<=899px)', 703, device)).toBe(false)
    expect(printMediaMatches('print and (width<=899px)', 703, device)).toBe(true)
    expect(printMediaMatches('(pointer:coarse),(width<=720px)', 703, device)).toBe(true)
    expect(printMediaMatches('(pointer:coarse),(width<=640px)', 703, device)).toBe(false)
    expect(printMediaMatches('(hover:hover)', 703, device)).toBe(true)
  })

  it('Unbekanntes bleibt beim Browser (null: Regel nicht anfassen)', () => {
    expect(printMediaMatches('(orientation: portrait)', 703, device)).toBe(null)
  })
})

describe('Breite des Satzspiegels', () => {
  it('Längen in mm, cm, in, pt, px', () => {
    expect(lengthPx('12mm')).toBeCloseTo(45.35, 1)
    expect(lengthPx('1.2cm')).toBeCloseTo(45.35, 1)
    expect(lengthPx('1in')).toBe(96)
    expect(lengthPx('72pt')).toBe(96)
    expect(lengthPx('0')).toBe(0)
    expect(lengthPx('0px')).toBe(0)
    expect(lengthPx('auto')).toBe(null)
  })

  it('A4 minus Rand links und rechts', () => {
    expect(pageContentWidthPx('12mm', '12mm')).toBeCloseTo(702.99, 1)
    expect(pageContentWidthPx('0', '0')).toBeCloseTo(793.7, 1)
    // Ohne lesbaren Rand die Vorgabe der Browser (rund 10 mm wären breiter; 12 mm ist die strengere Annahme)
    expect(pageContentWidthPx(null, null)).toBeCloseTo(702.99, 1)
  })
})
