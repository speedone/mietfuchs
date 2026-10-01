import { describe, expect, it } from 'vitest'

// Wächter zu #137: Jede Tabelle der Oberfläche entsteht über components/Table.tsx und liegt damit
// in einem waagerecht scrollbaren Bereich. Eine nackte <table> schöbe auf dem Handy die ganze
// Seite in die Breite. Geprüft wird der Quelltext, denn jsdom rechnet kein Layout und kann die
// Breite einer Seite nicht messen.
const sources = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('Tabellen (#137)', () => {
  it('jede Tabelle liegt im scrollbaren Bereich von Table.tsx', () => {
    const files = Object.keys(sources)
    // Fände das Muster keine Dateien, wäre der Wächter grün, ohne etwas zu prüfen.
    expect(files).toContain('../pages/Abrechnung.tsx')
    expect(files).toContain('./Table.tsx')
    const bare = files.filter((file) => file !== './Table.tsx' && /<table[\s>]/.test(sources[file]))
    expect(bare).toEqual([])
  })
})
