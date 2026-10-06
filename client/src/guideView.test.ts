// Anleitungen je Vermietungsart (#164) auf der Seite „Hilfe & Begriffe“: Reihenfolge, Suche und
// die Sprünge, ohne DOM prüfbar.
import { describe, expect, test } from 'vitest'
import { GUIDES, GUIDE_PAGES } from '../../shared/guides.ts'
import { allGuides, filterGuides } from './guideView'
import { NAV, pageLabel } from './nav'

describe('Anleitungen (#164)', () => {
  test('in der Reihenfolge der Daten, mit Kennung', () => {
    expect(allGuides().map((g) => g.id)).toEqual(Object.keys(GUIDES))
  })

  test('jede Seite, auf die eine Anleitung springt, steht in der Navigation, und der Knopf heißt wie dort', () => {
    const navIds = NAV.flatMap((g) => g.items.map((i) => i.id)) as string[]
    for (const p of GUIDE_PAGES) expect(navIds).toContain(p)
    for (const g of allGuides()) {
      for (const s of g.steps) if (s.page) expect(navIds).toContain(s.page)
    }
    expect(pageLabel('zaehler')).toBe('Zähler & Stände')
    expect(pageLabel('steuer')).toBe('Steuer (Anlage V)')
  })

  test('die Suche findet in Titel, Schritten, Rechtsgrundlagen und Issue-Nummern, ohne Groß- und Kleinschreibung', () => {
    const ids = (q: string) => filterGuides(allGuides(), q).map((g) => g.id)
    expect(ids('EINLIEGER')).toContain('granny')
    expect(ids('§ 9b')).toEqual(['meteringService', 'heatingSelf', 'tenantChange'])
    expect(ids('+ Zähler hinzufügen')).toContain('granny')
    expect(ids('#96')).toEqual(['properties'])
    expect(ids('  ')).toHaveLength(allGuides().length)
    expect(ids('gibt es nicht')).toEqual([])
  })
})
