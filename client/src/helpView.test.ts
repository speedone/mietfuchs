// Die Startansicht von „Hilfe & Begriffe“: Suche mit Rangfolge, Markierung und Ausschnitt, die Gruppen der Anleitungen
// und die Themen des Lexikons, ohne DOM prüfbar.
import { describe, expect, test } from 'vitest'
import { GLOSSARY, TERM_TOPICS } from '../../shared/glossary.ts'
import { GUIDES, GUIDE_GROUPS } from '../../shared/guides.ts'
import { excerpt, firstSentence, GUIDE_GROUP_LABELS, guideGroups, highlight, resultCountText, searchHelp, TERM_TOPIC_LABELS, termsOfTopic, topicCounts, type Segment } from './helpView'
import { sortedTerms } from './glossaryView'

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
    expect(searchHelp('#96').guides.map((g) => g.id)).toEqual(['properties'])
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
