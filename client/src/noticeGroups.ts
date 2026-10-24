// Gleiche Hinweise je Mieter zu einem Kasten zusammenfassen („Zu prüfen“ der Seite Abrechnung). Mit 20 Mietern stand
// derselbe Hinweis („Rückstand im Mietkonto“) zwanzigmal als eigener Kasten mit vollem Text da und füllte zwei Drittel
// der Seite (Leistungsprüfung mit großem Bestand).
//
// **Kein Wort geht verloren.** Der Text des Servers wird nur in Sätze zerlegt (noticeText.ts). Ein Satz, der bei allen
// Betroffenen wörtlich gleich ist, steht einmal im Kasten; jeder andere Satz steht wörtlich in der Zeile seines Mieters,
// also auch jeder Betrag. Zusammengefasst wird nur, was sicher dasselbe sagt:
// - gleicher Code, gleiche Stufe, gleicher Titel und gleiche Art des Bezugs (`subject.kind`);
// - der Bezug ist ein Mietverhältnis (`tenancy`, `rentLedger`), das die Abrechnung kennt, je Mietverhältnis höchstens
//   ein Hinweis, und der Text nennt seinen Mieter beim Namen;
// - nach Abzug von Name und Wohnung des Mieters und aller Zahlen ist der Text gleich, und er hat gleich viele Sätze;
// - mindestens ein Satz ist bei allen gleich (sonst gäbe es keinen gemeinsamen Text).
// **Ein Satz mit Betrag, Prozent, Datum oder Kürzung (`PROTECTED`) bleibt immer beim Mieter**, auch wenn er bei allen
// gleich lautet: Unter der Liste stünde sonst ein Betrag ohne Mieter (Durchsicht M1).
// Was davon abweicht, bleibt ein einzelner Hinweis. Ein Kasten steht dort, wo sein erster Hinweis stand.
import type { Notice } from './types'
import { fmtDate } from './api'
import { PROTECTED, sentences } from './noticeText'

export type NoticePerson = { tenantName: string, unitName: string, periodStart?: string, periodEnd?: string }

export type NoticeMember = {
  notice: Notice
  // „Name (Wohnung)“, wie die Texte des Servers den Mieter nennen
  name: string
  // Die Beschriftung der Zeile: der Name, bei zwei gleichen Namen in derselben Gruppe mit dem Zeitraum (Durchsicht K4)
  label: string
  // Die Sätze, in denen sich dieser Hinweis von den übrigen unterscheidet, wörtlich und in ihrer Reihenfolge
  own: string
}

export type NoticeItem =
  | { kind: 'single', notice: Notice }
  | { kind: 'group', notice: Notice, common: string, members: NoticeMember[] }

const GROUP_KINDS = new Set(['tenancy', 'rentLedger'])

// Der Text ohne das, worin sich Hinweise je Mieter unterscheiden dürfen: Name, Wohnung, Zahlen.
function skeleton(text: string, p: NoticePerson): string {
  let out = text
  for (const part of [p.tenantName, p.unitName].filter((s) => s.trim() !== '').sort((a, b) => b.length - a.length)) {
    out = out.split(part).join('\u0000')
  }
  return out.replace(/\d+(?:[.,]\d+)*/g, '#')
}

function groupKey(n: Notice, people: ReadonlyMap<string, NoticePerson>): string | null {
  const s = n.subject
  if (!s || !GROUP_KINDS.has(s.kind)) return null
  const p = people.get(s.id)
  if (!p || p.tenantName.trim() === '' || !n.text.includes(p.tenantName)) return null
  return [n.code, n.level, n.title, s.kind, skeleton(n.text, p)].join('\u0001')
}

// Zerlegt eine Gruppe in den gemeinsamen Text und die Sätze je Mieter, oder `null`, wenn das nicht sicher geht.
function split(notices: readonly Notice[], people: ReadonlyMap<string, NoticePerson>): { common: string, members: NoticeMember[] } | null {
  const parts = notices.map((n) => sentences(n.text))
  const count = parts[0]?.length ?? 0
  if (parts.some((p) => p.length !== count)) return null
  const same = Array.from({ length: count }, (_, i) => {
    const first = parts[0]?.[i] ?? ''
    return !PROTECTED.test(first) && parts.every((p) => p[i] === first)
  })
  if (!same.some(Boolean)) return null
  const named = notices.map((n) => {
    const p = people.get(n.subject?.id ?? '')
    return { p, name: p ? (p.unitName ? `${p.tenantName} (${p.unitName})` : p.tenantName) : '' }
  })
  const members = notices.map((n, k): NoticeMember => {
    const { p, name } = named[k] ?? { p: undefined, name: '' }
    const twin = named.some((x, j) => j !== k && x.name === name)
    const period = p?.periodStart && p.periodEnd ? `${fmtDate(p.periodStart)} – ${fmtDate(p.periodEnd)}` : ''
    return {
      notice: n,
      name,
      label: twin && period ? (p?.unitName ? `${p.tenantName} (${p.unitName}, ${period})` : `${name} (${period})`) : name,
      own: (parts[k] ?? []).filter((_, i) => !same[i]).join('').trim(),
    }
  })
  return { common: (parts[0] ?? []).filter((_, i) => same[i]).join('').trim(), members }
}

// Die Hinweise in ihrer Reihenfolge, gleiche je Mieter zu einem Kasten zusammengefasst.
export function groupNotices(notices: readonly Notice[], people: ReadonlyMap<string, NoticePerson>): NoticeItem[] {
  const keys = notices.map((n) => groupKey(n, people))
  const byKey = new Map<string, Notice[]>()
  notices.forEach((n, i) => {
    const k = keys[i]
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), n])
  })
  const groups = new Map<string, { common: string, members: NoticeMember[] }>()
  for (const [k, list] of byKey) {
    const ids = list.map((n) => n.subject?.id)
    if (list.length < 2 || new Set(ids).size !== ids.length) continue
    const g = split(list, people)
    if (g) groups.set(k, g)
  }
  const out: NoticeItem[] = []
  const placed = new Set<string>()
  notices.forEach((n, i) => {
    const k = keys[i]
    const g = k ? groups.get(k) : undefined
    if (!k || !g) {
      out.push({ kind: 'single', notice: n })
      return
    }
    if (placed.has(k)) return
    placed.add(k)
    out.push({ kind: 'group', notice: n, common: g.common, members: g.members })
  })
  return out
}

// Die Mieter einer Abrechnung, nach Kennung des Mietverhältnisses.
export function noticePeople(statements: readonly ({ tenancyId: string } & NoticePerson)[]): Map<string, NoticePerson> {
  return new Map(statements.map((s) => [s.tenancyId, { tenantName: s.tenantName, unitName: s.unitName, periodStart: s.periodStart, periodEnd: s.periodEnd }]))
}

// Die Zeile eines Mieters: Beginnen seine eigenen Sätze schon mit „Name (Wohnung):“, steht der Name nicht doppelt da,
// sondern der Text folgt der fetten Beschriftung ohne das Präfix (Durchsicht K1). Sonst Beschriftung, Doppelpunkt, Text.
export function memberLine(m: Pick<NoticeMember, 'name' | 'label' | 'own'>): { label: string, rest: string } {
  if (m.name && m.own.startsWith(`${m.name}:`)) return { label: m.label, rest: m.own.slice(m.name.length) }
  return { label: m.label, rest: m.own ? `: ${m.own}` : '' }
}
