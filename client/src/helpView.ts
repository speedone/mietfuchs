// Die Startansicht von „Hilfe & Begriffe“: Suche über Anleitungen und Begriffe mit Rangfolge, markierter Fundstelle und
// Ausschnitt, die Gruppen der Anleitungen und die Themen des Lexikons. Ohne DOM prüfbar; die Seite (pages/Hilfe.tsx)
// rendert nur.
//
// Was eine Suche findet, entscheiden weiter `filterGuides` und `filterTerms` (dieselben Felder wie vorher); hier kommt
// nur die Reihenfolge dazu: Titelanfang vor Titel vor Text.

import { GLOSSARY, TERM_TOPICS, type TermId, type TermTopic } from '../../shared/glossary.ts'
import { countOf } from '../../shared/wording.ts'
import { GUIDE_GROUPS, type GuideGroup, type GuideId } from '../../shared/guides.ts'
import { filterTerms, sortedTerms, type TermEntry } from './glossaryView'
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
