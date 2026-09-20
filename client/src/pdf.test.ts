// Wie groß ein Seitenbild wird (#35). Für den Druck zählt Schärfe, für die KI-Auswertung Zeit:
// Jedes Bild kostet Eingabe-Token, und auf einem Rechner ohne Grafikkarte macht das Minuten aus.
// Deshalb rendert die Auswertung kleiner als der Druck.
import { describe, expect, test } from 'vitest'
import { INTAKE_EDGE, MAX_EDGE, pageScale } from './pdf'

// Seitengrößen, wie pdf.js sie bei Faktor 1 liefert: in Punkten (1/72 Zoll)
const a4 = { width: 595, height: 842 }
const a6 = { width: 298, height: 420 }
const scanA4 = { width: 2480, height: 3508 } // ein Scan, dessen Seitengröße der Pixelzahl entspricht

const edge = (base: { width: number; height: number }, maxEdge: number) =>
  Math.round(Math.max(base.width, base.height) * pageScale(base, 2, maxEdge))

describe('Maßstab der Seitenbilder', () => {
  test('für den Druck bleibt es bei Faktor 2', () => {
    expect(pageScale(a4, 2, MAX_EDGE)).toBe(2)
    expect(edge(a4, MAX_EDGE)).toBe(1684)
  })

  test('für die KI-Auswertung zählt die lange Kante', () => {
    expect(edge(a4, INTAKE_EDGE)).toBe(INTAKE_EDGE)
    expect(INTAKE_EDGE).toBeLessThan(MAX_EDGE)
  })

  test('übergroße Seiten werden gestutzt', () => {
    // Sonst wüchse das Canvas über die Grenzen mancher Browser (iOS Safari um 16 MP)
    expect(edge(scanA4, MAX_EDGE)).toBe(MAX_EDGE)
    expect(edge(scanA4, INTAKE_EDGE)).toBe(INTAKE_EDGE)
  })

  test('kleine Seiten werden nicht über Faktor 2 hinaus vergrößert', () => {
    // Ein größeres Bild bringt keine Schärfe dazu, kostet aber Zeit
    expect(pageScale(a6, 2, INTAKE_EDGE)).toBe(2)
    expect(edge(a6, INTAKE_EDGE)).toBe(840)
  })
})
