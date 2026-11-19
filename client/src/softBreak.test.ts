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

  it('trennt nie einen Buchstaben von seinem kombinierenden Zeichen (NFD, etwa aus einer PDF kopiert)', () => {
    // „ü“ als u + U+0308 an jeder Stelle eines überlangen Worts; das „x“ vorn verschiebt die Paare, sonst fielen die
    // Schnitte nach je 20 Codepunkten zufällig immer zwischen zwei Paare
    const word = `x${'ü'.repeat(60)}`
    const out = softBreak(word)
    expect(out.replaceAll(ZWSP, '')).toBe(word)
    expect(out).toContain(ZWSP)
    expect(out).not.toMatch(new RegExp(`${ZWSP}\\p{M}`, 'u'))
  })

  it('bricht auch Adressen ohne Leerzeichen', () => {
    const mail = 'hausverwaltung.klaus.wegener-musterstadt@beispiel-hausverwaltung-mit-langem-namen.example.org'
    expect(softBreak(mail)).toContain(ZWSP)
  })
})
