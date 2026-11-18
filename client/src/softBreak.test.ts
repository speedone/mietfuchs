import { describe, expect, it } from 'vitest'
import { SOFT_BREAK_CHUNK, SOFT_BREAK_MIN, softBreak } from './softBreak'

const ZWSP = '​'

describe('softBreak (#647)', () => {
  it('lässt Text ohne überlanges Wort unverändert', () => {
    // Das längste Wort des Beispielbestands und lange echte Komposita: keine Umbruchstelle, die Spaltenbreite bleibt
    for (const text of ['Beleuchtung/Allgemeinstrom', 'Grundstücksentwässerungsanlagenwartung', 'Sach- und Haftpflichtversicherung', '']) {
      expect(softBreak(text)).toBe(text)
    }
  })

  it('lässt ein Wort genau an der Grenze unverändert', () => {
    const word = 'x'.repeat(SOFT_BREAK_MIN)
    expect(softBreak(word)).toBe(word)
  })

  it('setzt in ein überlanges Wort unsichtbare Umbruchstellen', () => {
    const word = 'Wartungsvertragsverlängerungsvereinbarungsnachtragsrechnungsposition'
    const out = softBreak(`Position ${word} 2025`)
    expect(out.replaceAll(ZWSP, '')).toBe(`Position ${word} 2025`)
    const parts = out.split(' ')[1].split(ZWSP)
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(SOFT_BREAK_CHUNK)
  })

  it('bricht auch Adressen ohne Leerzeichen', () => {
    const mail = 'hausverwaltung.klaus.wegener-musterstadt@beispiel-hausverwaltung-mit-langem-namen.example.org'
    expect(softBreak(mail)).toContain(ZWSP)
  })
})
