import { describe, expect, test } from 'vitest'
import { filterTerms, sortedTerms } from './glossaryView'

describe('Begriffslexikon (#113)', () => {
  test('alphabetisch nach deutscher Sortierung, Umlaute an ihrem Platz', () => {
    const titles = sortedTerms().map((t) => t.title)
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, 'de')))
    expect(titles.indexOf('Umlagefähige Betriebskosten')).toBeLessThan(titles.indexOf('Verbrauchsschlüssel'))
  })

  test('die Suche findet im Titel, in der Erklärung und in der Rechtsgrundlage, ohne Groß- und Kleinschreibung', () => {
    const ids = (q: string) => filterTerms(sortedTerms(), q).map((t) => t.id)
    expect(ids('mea')).toContain('mea')
    expect(ids('HEIZKOSTENV')).toContain('heatingCostOrdinance')
    expect(ids('§ 35a')).toContain('labor35a')
    expect(ids('  ')).toHaveLength(sortedTerms().length)
    expect(ids('gibt es nicht')).toEqual([])
  })
})
