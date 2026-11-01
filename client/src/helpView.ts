// Die Startansicht von „Hilfe & Begriffe“: Suche über Anleitungen und Begriffe mit Rangfolge, markierter Fundstelle und
// Ausschnitt, die Gruppen der Anleitungen und die Themen des Lexikons. Ohne DOM prüfbar; die Seite (pages/Hilfe.tsx)
// rendert nur.
//
// Was eine Suche findet, entscheiden weiter `filterGuides` und `filterTerms` (dieselben Felder wie vorher); hier kommt
// nur die Reihenfolge dazu: Titelanfang vor Titel vor Text.

import { GLOSSARY, TERM_TOPICS, type TermId, type TermTopic } from '../../shared/glossary.ts'
import { countOf } from '../../shared/wording.ts'
import { GUIDE_GROUPS, type GuideGroup, type GuideId, type GuideStep } from '../../shared/guides.ts'
import { filterTerms, letterOf, sortedTerms, type TermEntry } from './glossaryView'
import { allGuides, filterGuides, guideTexts, type GuideEntry } from './guideView'
import { searchQuery, searchText } from './searchText'

export const TERM_TOPIC_LABELS: Record<TermTopic, string> = {
  costs: 'Kosten und Verteilung',
  tenants: 'Mieter und Zahlungen',
  period: 'Zeitraum und Fristen',
  meters: 'Zähler',
  heating: 'Heizung',
  co2: 'CO₂-Kosten',
  condo: 'Eigentumswohnung',
  tax: 'Steuer',
}

export const GUIDE_GROUP_LABELS: Record<GuideGroup, string> = {
  property: 'Ihr Objekt',
  year: 'Im Abrechnungsjahr',
  heating: 'Heizung',
}

// Die Knöpfe unter der Suche: Wörter, die eine Anleitung und einen Begriff zugleich treffen.
export const POPULAR_SEARCHES = ['Garage', 'Leerstand', 'Hausgeld', 'Heizöl', '§ 35a'] as const

// Ein Stück Text, `hit` ist die gesuchte Stelle (gezeigt als <mark>).
export type Segment = { text: string; hit: boolean }

export function highlight(text: string, query: string): Segment[] {
  const q = searchQuery(query)
  // `searchText` erhält die Länge; die Stellen im verglichenen Text sind also die im Original.
  const l = searchText(text)
  if (!q) return [{ text, hit: false }]
  const out: Segment[] = []
  let from = 0
  for (let i = l.indexOf(q); i >= 0; i = l.indexOf(q, i + q.length)) {
    if (i > from) out.push({ text: text.slice(from, i), hit: false })
    out.push({ text: text.slice(i, i + q.length), hit: true })
    from = i + q.length
  }
  if (from < text.length || out.length === 0) out.push({ text: text.slice(from), hit: false })
  return out
}

// Ausschnitt um die erste Fundstelle, an Wortgrenzen gekürzt; „…“ zeigt, dass davor oder danach Text fehlt. Ohne
// Fundstelle der Anfang des Texts.
const BEFORE = 50
const AFTER = 90
const MAX = BEFORE + AFTER + 20
export function excerpt(text: string, query: string): Segment[] {
  if (text.length <= MAX) return highlight(text, query)
  const q = searchQuery(query)
  const at = q ? searchText(text).indexOf(q) : -1
  let start = at < 0 ? 0 : Math.max(0, at - BEFORE)
  let end = Math.min(text.length, (at < 0 ? 0 : at + q.length) + AFTER)
  if (start > 0) {
    const space = text.indexOf(' ', start)
    start = space >= 0 && space < at ? space + 1 : start
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    end = space > (at < 0 ? 0 : at + q.length) ? space : end
  }
  const body = highlight(text.slice(start, end).trim(), query)
  return [
    ...(start > 0 ? [{ text: '… ', hit: false }] : []),
    ...body,
    ...(end < text.length ? [{ text: ' …', hit: false }] : []),
  ]
}

// Der erste Satz: Er endet an einem Punkt (oder ! ?) hinter einem Wort aus mindestens zwei Zeichen, vor einem
// Großbuchstaben oder dem Ende. So bricht „z. B.“ oder „Abs. 3“ nicht ab.
export function firstSentence(text: string): string {
  const m = text.match(/^.*?[^\s.]{2}[.!?](?=\s+[A-ZÄÖÜ„]|\s*$)/s)
  return m ? m[0] : text
}

type Hit<K, Id> = { kind: K; id: Id; rank: number; title: Segment[]; excerpt: Segment[] }
export type GuideHit = Hit<'guide', GuideId>
export type TermHit = Hit<'term', TermId> & { topic: TermTopic }
export type HelpResults = { guides: GuideHit[]; terms: TermHit[] }

// 3: der Titel beginnt mit dem Wort, 2: er enthält es, 1: nur der Text.
function rankOf(title: string, q: string): number {
  const t = searchText(title)
  return t.startsWith(q) ? 3 : t.includes(q) ? 2 : 1
}

// Der Ausschnitt: Steht das Wort im Titel, der Anfang der Erklärung; sonst der erste Text, in dem es steht.
function excerptOf(texts: readonly string[], first: string, query: string, inTitle: boolean): Segment[] {
  const q = searchQuery(query)
  const found = inTitle ? first : texts.find((t) => searchText(t).includes(q)) ?? first
  return excerpt(found, query)
}

export function searchHelp(query: string, guides: GuideEntry[] = allGuides(), terms: TermEntry[] = sortedTerms()): HelpResults {
  const q = searchQuery(query)
  if (!q) return { guides: [], terms: [] }
  // In derselben Stufe (Titel) zuerst der kürzere Titel: Das Wort macht mehr von ihm aus („CO₂-Kostenaufteilung“ vor
  // „CO₂-Erstattung, wenn der Mieter selbst heizt“). Sonst die Reihenfolge der Liste: Anleitungen wie in den Daten,
  // Begriffe nach dem Alphabet.
  const byRank = <T extends { rank: number }>(list: { hit: T; title: string }[]): T[] => list.map((x, i) => ({ ...x, i }))
    .sort((a, b) => b.hit.rank - a.hit.rank || (a.hit.rank > 1 ? a.title.length - b.title.length : 0) || a.i - b.i)
    .map((x) => x.hit)
  return {
    guides: byRank(filterGuides(guides, query).map((g) => {
      const rank = rankOf(g.title, q)
      const hit: GuideHit = { kind: 'guide', id: g.id, rank, title: highlight(g.title, query), excerpt: excerptOf(guideTexts(g).slice(1), firstSentence(g.applies), query, rank > 1) }
      return { hit, title: g.title }
    })),
    terms: byRank(filterTerms(terms, query).map((t) => {
      const rank = rankOf(t.title, q)
      const hit: TermHit = { kind: 'term', id: t.id, topic: t.topic, rank, title: highlight(t.title, query), excerpt: excerptOf([t.short, t.norm ?? ''], t.short, query, rank > 1) }
      return { hit, title: t.title }
    })),
  }
}

export function resultCountText(guides: number, terms: number): string {
  if (guides === 0 && terms === 0) return 'Nichts gefunden.'
  return `${countOf(guides, 'Anleitung', 'Anleitungen')} und ${countOf(terms, 'Begriff', 'Begriffe')} gefunden.`
}

export function guideGroups(guides: GuideEntry[] = allGuides()): { group: GuideGroup; guides: GuideEntry[] }[] {
  return GUIDE_GROUPS.map((group) => ({ group, guides: guides.filter((g) => g.group === group) }))
}

export function topicCounts(): { topic: TermTopic; count: number }[] {
  const all = Object.values(GLOSSARY)
  return TERM_TOPICS.map((topic) => ({ topic, count: all.filter((t) => t.topic === topic).length }))
}

export function termsOfTopic(entries: TermEntry[], topic: TermTopic | null): TermEntry[] {
  return topic === null ? entries : entries.filter((t) => t.topic === topic)
}

// Die Abschnitte einer Anleitung in ihrer Inhaltsleiste (#488, PR 2), in der Reihenfolge der Ansicht. „Trifft das auf
// Sie zu?“ steht oben und braucht keinen Sprung; „Ähnliche Anleitungen“ ist kein Teil der Anleitung selbst.
export const GUIDE_SECTIONS = [
  { id: 'schritte', label: 'So legen Sie es an' },
  { id: 'ergebnis', label: 'Was Mietfuchs daraus macht' },
  { id: 'beispiel', label: 'Beispiel' },
  { id: 'achtung', label: 'Worauf Sie achten müssen' },
  { id: 'luecken', label: 'Was Mietfuchs (noch) nicht kann' },
  { id: 'begriffe', label: 'Begriffe' },
] as const
export type GuideSection = (typeof GUIDE_SECTIONS)[number]['id']

// Der nächste Schritt nach `from`, der eine Seite hat („Nächster Schritt“ in der Leiste des Fadens). Ein Schritt ohne
// Seite liegt in der Seitenleiste und wird übersprungen; nach dem letzten gibt es keinen.
export function nextStepWithPage(steps: readonly GuideStep[], from: number): number | null {
  for (let i = from + 1; i < steps.length; i++) if (steps[i]?.page) return i
  return null
}

// „Ähnliche Anleitungen“: die übrigen aus derselben Gruppe, in der Reihenfolge der Daten, höchstens `max`.
export function relatedGuides(id: GuideId, guides: GuideEntry[] = allGuides(), max = 3): GuideEntry[] {
  const group = guides.find((g) => g.id === id)?.group
  return guides.filter((g) => g.group === group && g.id !== id).slice(0, max)
}

// Das Lexikon (#488, Teil 3): links die Liste der Begriffe mit Themenfilter, rechts der gewählte Begriff mit „Kommt vor
// in“ und verwandten Begriffen. Der Zustand ist Thema (null: alle) und gewählter Begriff (null: keiner).
export type LexiconState = { topic: TermTopic | null; term: TermId | null }

// Die Knöpfe des Themenfilters mit Zahl der Begriffe, vorne „Alle“.
export function lexiconFilters(): { topic: TermTopic | null; label: string; count: number }[] {
  const counts = topicCounts()
  return [
    { topic: null, label: 'Alle', count: counts.reduce((a, c) => a + c.count, 0) },
    ...counts.map((c) => ({ topic: c.topic, label: TERM_TOPIC_LABELS[c.topic], count: c.count })),
  ]
}

// Die Liste: alphabetisch, am ersten Begriff jedes Anfangsbuchstabens dieser Buchstabe (als Trenner gezeigt).
export function lexiconEntries(topic: TermTopic | null, terms: TermEntry[] = sortedTerms()): { id: TermId; title: string; letter: string | null }[] {
  let last = ''
  return termsOfTopic(terms, topic).map((t) => {
    const letter = letterOf(t.title)
    const first = letter !== last
    last = letter
    return { id: t.id, title: t.title, letter: first ? letter : null }
  })
}

// „Kommt vor in“: die Anleitungen, die den Begriff unter „Begriffe“ nennen, in der Reihenfolge der Daten.
export function guidesWithTerm(id: TermId, guides: GuideEntry[] = allGuides()): GuideEntry[] {
  return guides.filter((g) => g.terms.includes(id))
}

// „Verwandte Begriffe“: die übrigen desselben Themas, höchstens `max`. Zuerst die, die mit ihm in denselben Anleitungen
// stehen (sie gehören zum selben Vorgang), sonst nach dem Alphabet; nur nach dem Alphabet stünden bei der Heizung mit
// ihren 27 Begriffen unter jedem Begriff dieselben acht vom Anfang des Alphabets.
export function relatedTerms(id: TermId, max = 8, terms: TermEntry[] = sortedTerms(), guides: GuideEntry[] = allGuides()): TermEntry[] {
  const topic = GLOSSARY[id].topic
  const withIt = guidesWithTerm(id, guides)
  const shared = (other: TermId) => withIt.filter((g) => g.terms.includes(other)).length
  return terms
    .filter((t) => t.topic === topic && t.id !== id)
    .map((t, i) => ({ t, i, n: shared(t.id) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, max)
    .map((x) => x.t)
}

// Ein Sprung von außen auf einen Begriff (Erklärung im Formular, Suche, Anleitung): Filter „Alle“. Der Sprung kommt
// nicht über ein Thema, und unter „Alle“ steht der Begriff an seinem Platz im Alphabet wie in der Suche; sein Thema
// nennt die Kennzeile über dem Titel, die Nachbarn im Thema „Verwandte Begriffe“.
export function jumpToTerm(id: TermId): LexiconState {
  return { topic: null, term: id }
}

// Ein Thema wählen hebt die Wahl des Begriffs auf (wie im Vorschlag): Am Handy erscheint so sofort die gefilterte
// Liste, statt dass der Begriff stehen bleibt und der Filter scheinbar nichts tut.
export function chooseTopic(topic: TermTopic | null): LexiconState {
  return { topic, term: null }
}

// Einen Begriff wählen (Liste, „Verwandte Begriffe“): Das Thema bleibt, wenn er darin steht, sonst gilt „Alle“, damit
// der gewählte Begriff in der Liste steht.
export function chooseTerm(state: LexiconState, id: TermId): LexiconState {
  return { topic: state.topic === null || GLOSSARY[id].topic === state.topic ? state.topic : null, term: id }
}

// Schmale Ansicht (am Handy): ohne gewählten Begriff die Liste, mit Begriff nur er und „← Alle Begriffe“.
export function lexiconPane(term: TermId | null): 'list' | 'term' {
  return term === null ? 'list' : 'term'
}
