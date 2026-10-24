// Gleiche Hinweise je Mieter zu einem Kasten: mit echten Texten der Berechnung, und ohne dass ein Wort verloren geht.
import { expect, test } from 'vitest'
import type { Notice } from './types'
import { groupNotices, noticePeople, type NoticeItem } from './noticeGroups'
import { sentences } from './noticeText'
import { addressNotice } from './landlord'
import samplesRaw from './testing/noticeSamples.json?raw'

const samples = JSON.parse(samplesRaw) as { code: string, text: string }[]
const sample = (code: string): string => samples.find((x) => x.code === code)?.text ?? expect.fail(`kein Beispiel für ${code}`)

const people = noticePeople([
  { tenancyId: 't1', tenantName: 'Laura Gerber', unitName: 'Whg. 1.01' },
  { tenancyId: 't2', tenantName: 'Lena Jansen', unitName: 'Whg. 1.02' },
  { tenancyId: 't3', tenantName: 'Lea Thalmann', unitName: 'Whg. 1.03' },
  { tenancyId: 't4', tenantName: 'Elias Thalmann', unitName: 'Whg. 1.04' },
])

// Der echte Text zu prepayment.arrears, je Mieter mit eigenem Namen und eigenen Beträgen.
const ARREARS = sample('prepayment.arrears')
function arrears(id: string, open: string, prepaid: string): Notice {
  const p = people.get(id) ?? expect.fail(`kein Mieter ${id}`)
  expect(ARREARS).toContain('u3 (W3)')
  expect(ARREARS).toContain('2.331,96 €')
  expect(ARREARS).toContain('1.046,32 €')
  const text = ARREARS.replace('u3 (W3)', `${p.tenantName} (${p.unitName})`).replace('2.331,96 €', open).replace('1.046,32 €', prepaid)
  return { code: 'prepayment.arrears', level: 'warning', title: 'Rückstand im Mietkonto', text, subject: { kind: 'rentLedger', id }, terms: ['prepayment'] }
}

const FOUR = [
  arrears('t1', '374,80 €', '3.672,00 €'),
  arrears('t2', '408,00 €', '2.892,00 €'),
  arrears('t3', '180,00 €', '2.628,00 €'),
  arrears('t4', '200,00 €', '3.000,00 €'),
]

// Was ein Kasten zeigt, ergibt je Mieter wieder seinen ganzen Text: die gemeinsamen Sätze an ihrer Stelle, die eigenen
// an ihrer. Geprüft, indem die Sätze beider Teile im Original wiedergefunden werden und zusammen alle sind.
function expectLossless(items: NoticeItem[], input: readonly Notice[]) {
  const shown = items.flatMap((it) => it.kind === 'single' ? [it.notice] : it.members.map((m) => m.notice))
  expect(new Set(shown)).toEqual(new Set(input))
  for (const it of items) {
    if (it.kind !== 'group') continue
    for (const m of it.members) {
      const all = sentences(m.notice.text).map((s) => s.trim())
      const parts = [...sentences(it.common), ...sentences(m.own)].map((s) => s.trim()).filter(Boolean)
      expect([...parts].sort()).toEqual([...all].sort())
    }
  }
}

test('vier Mieter mit Rückstand: ein Kasten, gemeinsamer Text einmal, je Mieter Name und beide Beträge', () => {
  const items = groupNotices(FOUR, people)
  expect(items).toHaveLength(1)
  const g = items[0]
  if (g?.kind !== 'group') return expect.fail('kein Kasten')
  expect(g.notice.title).toBe('Rückstand im Mietkonto')
  expect(g.members.map((m) => m.name)).toEqual(['Laura Gerber (Whg. 1.01)', 'Lena Jansen (Whg. 1.02)', 'Lea Thalmann (Whg. 1.03)', 'Elias Thalmann (Whg. 1.04)'])
  expect(g.members[0]?.own).toContain('374,80 €')
  expect(g.members[0]?.own).toContain('3.672,00 €')
  expect(g.members[3]?.own).toContain('200,00 €')
  expect(g.members[3]?.own).toContain('3.000,00 €')
  // Kein Name und kein Betrag eines Mieters im gemeinsamen Text
  expect(g.common).not.toMatch(/€|Gerber|Jansen|Thalmann/)
  expect(g.common).toContain('tragen Sie die Zahlung im Mietkonto nach')
  expectLossless(items, FOUR)
})

test('Anschrift nach dem Auszug (Prüfung der Seite): drei Mieter in einem Kasten', () => {
  const list: Notice[] = ['t2', 't3', 't4'].map((id) => {
    const p = people.get(id) ?? expect.fail(id)
    const a = addressNotice('former', p.tenantName, p.unitName)
    return { code: 'page.address', level: 'warning', title: a.title, text: a.text, subject: { kind: 'tenancy', id } }
  })
  const items = groupNotices(list, people)
  expect(items.map((i) => i.kind)).toEqual(['group'])
  expectLossless(items, list)
})

test('der Kasten steht an der Stelle des ersten Hinweises, andere bleiben in ihrer Reihenfolge', () => {
  const other: Notice = { code: 'allocation.other-unanswered', level: 'warning', title: 'Sonstige Betriebskosten', text: sample('allocation.other-unanswered'), subject: { kind: 'costItem', id: 'c1' } }
  const [a, b, c, d] = FOUR
  if (!a || !b || !c || !d) return expect.fail('vier Hinweise')
  const items = groupNotices([other, a, b, other, c, d], people)
  expect(items.map((i) => i.kind)).toEqual(['single', 'group', 'single'])
  expect(items[1]?.kind === 'group' && items[1].members).toHaveLength(4)
})

test('was nicht sicher dasselbe sagt, bleibt einzeln', () => {
  const [a, b] = FOUR
  if (!a || !b) return expect.fail('zwei Hinweise')
  const single = (list: Notice[]) => groupNotices(list, people).map((i) => i.kind)
  // Ein Hinweis allein
  expect(single([a])).toEqual(['single'])
  // anderer Titel, andere Stufe, anderer Code
  expect(single([a, { ...b, title: 'Anders' }])).toEqual(['single', 'single'])
  expect(single([a, { ...b, level: 'hint' }])).toEqual(['single', 'single'])
  expect(single([a, { ...b, code: 'x' }])).toEqual(['single', 'single'])
  // Bezug kein Mietverhältnis, unbekanntes Mietverhältnis, ohne Bezug
  expect(single([{ ...a, subject: { kind: 'costItem', id: 't1' } }, { ...b, subject: { kind: 'costItem', id: 't2' } }])).toEqual(['single', 'single'])
  expect(single([a, { ...b, subject: { kind: 'rentLedger', id: 'fremd' } }])).toEqual(['single', 'single'])
  const { subject: _s, ...noSubject } = b
  expect(single([a, noSubject])).toEqual(['single', 'single'])
  // derselbe Mieter zweimal
  expect(single([a, { ...a }])).toEqual(['single', 'single'])
  // Der Text nennt den Mieter nicht
  expect(single([a, { ...b, text: b.text.replace('Lena Jansen', 'jemand') }])).toEqual(['single', 'single'])
  // Ein Wort außer Name und Zahl ist anders
  expect(single([a, { ...b, text: b.text.replace('offen', 'zu viel') }])).toEqual(['single', 'single'])
  // Kein Satz ist bei allen gleich
  const one = (id: string, name: string): Notice => ({ code: 'c', level: 'warning', title: 'T', text: `${name} schuldet 5,00 €.`, subject: { kind: 'tenancy', id } })
  expect(single([one('t1', 'Laura Gerber'), one('t2', 'Lena Jansen')])).toEqual(['single', 'single'])
})

test('jeder echte Text eines Codes, je Mieter eingesetzt, verliert beim Zusammenfassen nichts', () => {
  // Alle Beispiele, die einen Mieter des Beispiels als „Mieter …“ nennen, für zwei Mieter: entweder einzeln oder verlustfrei.
  for (const s of samples) {
    const name = /Mieter ([\w-]+)/.exec(s.text)?.[1]
    if (!name) continue
    const list: Notice[] = ['t1', 't2'].map((id) => ({
      code: s.code, level: 'warning', title: s.code, text: s.text.split(name).join(people.get(id)?.tenantName ?? ''), subject: { kind: 'tenancy', id },
    }))
    expectLossless(groupNotices(list, people), list)
  }
})
