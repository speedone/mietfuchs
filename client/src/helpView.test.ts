// Die Startansicht von „Hilfe & Begriffe“: Suche mit Rangfolge, Markierung und Ausschnitt, die Gruppen der Anleitungen
// und die Themen des Lexikons, ohne DOM prüfbar.
import { describe, expect, test } from 'vitest'
import { GLOSSARY, TERM_TOPICS } from '../../shared/glossary.ts'
import { GUIDES, GUIDE_GROUPS } from '../../shared/guides.ts'
import { chooseTerm, chooseTopic, excerpt, firstSentence, GUIDE_GROUP_LABELS, guideGroups, guidesWithTerm, highlight, jumpToTerm, lexiconEntries, lexiconFilters, lexiconPane, nextStepWithPage, relatedGuides, relatedTerms, resultCountText, searchHelp, TERM_TOPIC_LABELS, termsOfTopic, topicCounts, type Segment } from './helpView'
import { letterOf, sortedTerms } from './glossaryView'

const plain = (s: readonly Segment[]) => s.map((x) => x.text).join('')
const hits = (s: readonly Segment[]) => s.filter((x) => x.hit).map((x) => x.text)

describe('Markierung und Ausschnitt', () => {
  test('markiert jede Fundstelle ohne Rücksicht auf Groß- und Kleinschreibung und lässt den Text, wie er ist', () => {
    const s = highlight('Garage oder Stellplatz, die garage im Hof', 'GARAGE')
    expect(plain(s)).toBe('Garage oder Stellplatz, die garage im Hof')
    expect(hits(s)).toEqual(['Garage', 'garage'])
    expect(highlight('Garage', '')).toEqual([{ text: 'Garage', hit: false }])
    expect(highlight('Garage', 'Pauschale')).toEqual([{ text: 'Garage', hit: false }])
  })

  test('ein kurzer Text bleibt ganz, ein langer wird um die erste Fundstelle an Wortgrenzen gekürzt', () => {
    expect(plain(excerpt('Sie vermieten eine Garage.', 'garage'))).toBe('Sie vermieten eine Garage.')
    const long = `${'Vorne steht viel Text. '.repeat(10)}Hier ist der Garagenhof gemeint. ${'Hinten steht noch mehr. '.repeat(10)}`
    const s = excerpt(long, 'garagen')
    const text = plain(s)
    expect(hits(s)).toEqual(['Garagen'])
    expect(text.startsWith('… ')).toBe(true)
    expect(text.endsWith(' …')).toBe(true)
    // An Wortgrenzen: kein angeschnittenes Wort am Rand (vorher „… er, ein Haus“)
    const inner = text.slice(2, -2)
    expect(long.includes(inner)).toBe(true)
    expect(long.charAt(long.indexOf(inner) - 1)).toBe(' ')
    expect([' ', undefined, '']).toContain(long.charAt(long.indexOf(inner) + inner.length))
    expect(text.length).toBeLessThan(200)
  })

  test('ohne Fundstelle der Anfang des Texts', () => {
    const long = 'Wort '.repeat(80)
    const text = plain(excerpt(long, 'garage'))
    expect(long.startsWith(text.slice(0, -2))).toBe(true)
    expect(text.endsWith(' …')).toBe(true)
  })

  test('der erste Satz, ohne an Abkürzungen oder Paragrafen abzubrechen', () => {
    expect(firstSentence('Sie vermieten eine Eigentumswohnung. Die Kosten rechnet die Gemeinschaft ab.')).toBe('Sie vermieten eine Eigentumswohnung.')
    expect(firstSentence('Nach § 556 Abs. 3 BGB gilt das, z. B. bei einer Garage. Danach mehr.')).toBe('Nach § 556 Abs. 3 BGB gilt das, z. B. bei einer Garage.')
    expect(firstSentence('Ohne Punkt am Ende')).toBe('Ohne Punkt am Ende')
  })
})

describe('Suche über Anleitungen und Begriffe', () => {
  test('getrennt nach Anleitungen und Begriffen, Titelanfang vor Titel vor Text', () => {
    const r = searchHelp('garage')
    expect(r.guides.map((g) => g.id)).toEqual(['garage', 'properties'])
    expect(r.terms.map((t) => t.id)).toEqual(['garageVat', 'noConnection'])
    const vat = r.terms[0] ?? expect.fail('Begriff fehlt')
    expect(vat.topic).toBe('tax')
    expect(hits(vat.title)).toEqual(['Garage'])
    // Der Fundort im Text: bei „Mehrere Häuser“ steht „Garagenhof“ in „Trifft das auf Sie zu?“
    const props = r.guides[1] ?? expect.fail('Anleitung fehlt')
    expect(hits(props.excerpt)).toEqual(['Garage'])
    expect(plain(props.excerpt)).toContain('Garagenhof')
  })

  test('ein Treffer im Titel zeigt den Anfang der Erklärung, mit Markierung, wo das Wort dort auch steht', () => {
    const r = searchHelp('Leerstand')
    const vacancy = r.terms.find((t) => t.id === 'vacancy') ?? expect.fail('Leerstand fehlt')
    expect(plain(vacancy.excerpt)).toBe(GLOSSARY.vacancy.short)
    expect(r.terms[0]?.id).toBe('vacancy')
    expect(r.guides[0]?.id).toBe('tenantChange')
  })

  test('innerhalb derselben Stufe im Titel der kürzere Titel zuerst; im Text Anleitungen wie in den Daten, Begriffe nach dem Alphabet', () => {
    const r = searchHelp('heiz')
    const ranks = r.terms.map((t) => t.rank)
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a))
    const top = r.terms.filter((t) => t.rank === ranks[0]).map((t) => GLOSSARY[t.id].title.length)
    expect(top).toEqual([...top].sort((a, b) => a - b))
    const inText = r.terms.filter((t) => t.rank === 1).map((t) => GLOSSARY[t.id].title)
    expect(inText.length).toBeGreaterThan(1)
    expect(inText).toEqual([...inText].sort((a, b) => a.localeCompare(b, 'de')))
    const order = Object.keys(GUIDES)
    const textGuides = r.guides.filter((g) => g.rank === 1).map((g) => order.indexOf(g.id))
    expect(textGuides).toEqual([...textGuides].sort((a, b) => a - b))
  })

  test('Paragrafen und Issue-Nummern werden gefunden, Leerraum allein findet nichts', () => {
    expect(searchHelp('§ 35a').terms.map((t) => t.id)).toContain('labor35a')
    expect(searchHelp('#95').guides.map((g) => g.id)).toEqual(['properties', 'garage'])
    expect(searchHelp('  ')).toEqual({ guides: [], terms: [] })
    expect(searchHelp('gibt es nicht')).toEqual({ guides: [], terms: [] })
  })

  // Durchsicht von #488, S4: „CO2“ fand „CO₂“ nicht, „§556“ nicht „§ 556“.
  test('tiefgestellte Ziffern und ein Paragraf ohne Leerzeichen werden gefunden und markiert', () => {
    expect(searchHelp('CO2').guides.map((g) => g.id)).toContain('co2Costs')
    const co2 = searchHelp('co2')
    expect(co2.terms[0]?.id).toBe('co2Split')
    expect(hits(co2.terms[0]?.title ?? [])).toEqual(['CO₂'])
    const para = searchHelp('§556')
    expect(para.terms.map((t) => t.id)).toContain('settlementDeadline')
    const deadline = para.terms.find((t) => t.id === 'settlementDeadline') ?? expect.fail('Abrechnungsfrist fehlt')
    expect(hits(deadline.excerpt)).toContain('§ 556')
    // Die Markierung behält den Text, wie er dasteht
    expect(plain(highlight('Die CO₂-Kosten', 'co2'))).toBe('Die CO₂-Kosten')
  })

  test('die Trefferzahl für Vorleser, in Einzahl und Mehrzahl', () => {
    expect(resultCountText(2, 1)).toBe('2 Anleitungen und 1 Begriff gefunden.')
    expect(resultCountText(1, 0)).toBe('1 Anleitung und 0 Begriffe gefunden.')
    expect(resultCountText(0, 0)).toBe('Nichts gefunden.')
  })
})

describe('Gruppen und Themen', () => {
  test('jede Anleitung steht in genau einer Gruppe, in der Reihenfolge der Daten, und keine Gruppe ist leer', () => {
    const groups = guideGroups()
    expect(groups.map((g) => g.group)).toEqual([...GUIDE_GROUPS])
    expect(groups.flatMap((g) => g.guides.map((x) => x.id)).sort()).toEqual(Object.keys(GUIDES).sort())
    for (const g of groups) expect(g.guides.length, g.group).toBeGreaterThan(0)
    expect(groups[0]?.guides[0]?.id).toBe('granny')
    for (const g of GUIDE_GROUPS) expect(GUIDE_GROUP_LABELS[g]).toBeTruthy()
  })

  test('jedes Thema hat Begriffe und eine Beschriftung, zusammen alle', () => {
    const counts = topicCounts()
    expect(counts.map((c) => c.topic)).toEqual([...TERM_TOPICS])
    for (const c of counts) expect(c.count, c.topic).toBeGreaterThan(0)
    expect(counts.reduce((a, c) => a + c.count, 0)).toBe(Object.keys(GLOSSARY).length)
    for (const t of TERM_TOPICS) expect(TERM_TOPIC_LABELS[t]).toBeTruthy()
  })

  // Durchsicht von #488, K5: Heizperiode und getrennte Heizkostenabrechnung gehören zur Heizung.
  test('Heizperiode und getrennte Heizkostenabrechnung stehen bei der Heizung', () => {
    expect(GLOSSARY.heatingPeriod.topic).toBe('heating')
    expect(GLOSSARY.separateHeatingSettlement.topic).toBe('heating')
  })

  test('ein Thema zeigt nur seine Begriffe, alphabetisch; ohne Thema alle', () => {
    const all = sortedTerms()
    expect(termsOfTopic(all, null)).toEqual(all)
    const heating = termsOfTopic(all, 'heating')
    expect(heating.every((t) => t.topic === 'heating')).toBe(true)
    expect(heating.map((t) => t.id)).toContain('heatCostAllocator')
    expect(heating.map((t) => t.id)).not.toContain('mea')
  })
})

// #488, PR 2: „Nächster Schritt“ im Faden und „Ähnliche Anleitungen“
test('der nächste Schritt mit Seite überspringt Schritte in der Seitenleiste; nach dem letzten gibt es keinen', () => {
  const steps = GUIDES.properties.steps
  expect(steps[1]?.page).toBeUndefined()
  expect(nextStepWithPage(steps, 0)).toBe(2)
  expect(nextStepWithPage(steps, steps.length - 1)).toBeNull()
  expect(nextStepWithPage([{ text: 'a', page: 'kosten' }, { text: 'b' }], 0)).toBeNull()
})

test('ähnliche Anleitungen: höchstens drei aus derselben Gruppe, ohne die offene', () => {
  const related = relatedGuides('co2Costs')
  expect(related.length).toBe(3)
  expect(related.every((g) => g.group === 'heating' && g.id !== 'co2Costs')).toBe(true)
  expect(relatedGuides('tenantChange').every((g) => g.group === 'year' && g.id !== 'tenantChange')).toBe(true)
})

// #488, Teil 3: das Lexikon zweispaltig mit Themenfilter, „Kommt vor in“ und verwandten Begriffen
describe('Lexikon', () => {
  test('der Themenfilter: vorne „Alle“, dann jedes Thema mit seiner Zahl', () => {
    const filters = lexiconFilters()
    expect(filters[0]).toEqual({ topic: null, label: 'Alle', count: Object.keys(GLOSSARY).length })
    expect(filters.slice(1).map((f) => f.topic)).toEqual([...TERM_TOPICS])
    for (const f of filters.slice(1)) {
      expect(f.label).toBe(TERM_TOPIC_LABELS[f.topic ?? expect.fail('Thema fehlt')])
      expect(f.count).toBe(Object.values(GLOSSARY).filter((t) => t.topic === f.topic).length)
    }
  })

  test('die Liste: alphabetisch, der Anfangsbuchstabe am ersten Begriff jedes Buchstabens, Ü bei U', () => {
    const all = lexiconEntries(null)
    expect(all.map((e) => e.id)).toEqual(sortedTerms().map((t) => t.id))
    const letters = all.flatMap((e) => (e.letter ? [e.letter] : []))
    expect(new Set(letters).size).toBe(letters.length)
    expect(letters).not.toContain('Ü')
    expect(all[0]?.letter).toBe('A')
    // Jeder Begriff ohne eigenen Buchstaben hat denselben wie der vor ihm
    let current = ''
    for (const e of all) {
      current = e.letter ?? current
      expect(letterOf(e.title), e.title).toBe(current)
    }
    const condo = lexiconEntries('condo')
    expect(condo.map((e) => e.id).sort()).toEqual(Object.entries(GLOSSARY).filter(([, t]) => t.topic === 'condo').map(([id]) => id).sort())
    expect(condo[0]?.letter).toBeTruthy()
  })

  test('„Kommt vor in“: die Anleitungen, die den Begriff nennen, in der Reihenfolge der Daten', () => {
    const ids = guidesWithTerm('ownShare').map((g) => g.id)
    const expected = Object.entries(GUIDES).filter(([, g]) => (g.terms as readonly string[]).includes('ownShare')).map(([id]) => id)
    expect(ids).toEqual(expected)
    expect(ids).toContain('granny')
    expect(ids.length).toBeGreaterThan(1)
    // Ohne Anleitung, die ihn nennt, keine (Durchsicht S4: nicht an den heutigen Daten festgemacht)
    expect(guidesWithTerm('ownShare', [])).toEqual([])
  })

  test('verwandte Begriffe: dasselbe Thema, ohne den Begriff selbst, höchstens acht, gemeinsame Anleitungen zuerst', () => {
    const related = relatedTerms('heatCostAllocator')
    expect(related.length).toBe(8)
    expect(related.every((t) => t.topic === 'heating' && t.id !== 'heatCostAllocator')).toBe(true)
    const shared = (id: string) => Object.values(GUIDES).filter((g) => (g.terms as readonly string[]).includes(id) && (g.terms as readonly string[]).includes('heatCostAllocator')).length
    const counts = related.map((t) => shared(t.id))
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    // Bei gleich vielen gemeinsamen Anleitungen nach dem Alphabet
    for (let i = 1; i < related.length; i++) {
      const [a, b] = [related[i - 1], related[i]]
      if (a && b && counts[i - 1] === counts[i]) expect(a.title.localeCompare(b.title, 'de')).toBeLessThan(0)
    }
    // Ein Thema mit wenigen Begriffen: alle übrigen
    const condo = Object.values(GLOSSARY).filter((t) => t.topic === 'condo').length
    expect(relatedTerms('mea').length).toBe(Math.min(8, condo - 1))
  })

  test('Sprung auf einen Begriff (Formular, Suche, Anleitung): Filter „Alle“, der Begriff gewählt', () => {
    expect(jumpToTerm('mea')).toEqual({ topic: null, term: 'mea' })
  })

  test('ein Thema wählen hebt die Wahl des Begriffs auf; ein Begriff behält das Thema, wenn er darin steht', () => {
    expect(chooseTopic('condo')).toEqual({ topic: 'condo', term: null })
    expect(chooseTerm({ topic: 'condo', term: null }, 'reserveFund')).toEqual({ topic: 'condo', term: 'reserveFund' })
    expect(chooseTerm({ topic: 'condo', term: 'mea' }, 'heatCostAllocator')).toEqual({ topic: null, term: 'heatCostAllocator' })
  })

  test('schmal: ohne gewählten Begriff die Liste, mit Begriff nur er', () => {
    expect(lexiconPane(null)).toBe('list')
    expect(lexiconPane('mea')).toBe('term')
  })
})
