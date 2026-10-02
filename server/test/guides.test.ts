// Anleitungen je Vermietungsart (#164). Wie beim Lexikon gilt: Jeder Begriff steht im Lexikon,
// jede Rechtsaussage nennt ihre Norm, und jedes Zahlenbeispiel ist nachgerechnet. Nachgerechnet
// wird hier nicht von Hand, sondern mit der Berechnung selbst: Jede Anleitung hat einen Fall, der
// ihr Beispiel durch `computeSettlement` oder `taxReport` schickt, und die Beträge müssen wörtlich
// im Beispieltext stehen. Ändert sich die Berechnung, wird der Text rot statt still falsch.
//
// Dazu ein Wächter über die Bedienangaben: Jeder Text in „…“ in den Schritten und in „Was
// Mietfuchs daraus macht“ muss so in der Oberfläche stehen. Eine umbenannte Schaltfläche fällt
// damit hier auf und nicht erst beim Leser.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GLOSSARY } from '../../shared/glossary.ts'
import { GUIDES, GUIDE_PAGES, type GuideId } from '../../shared/guides.ts'
import { computeSettlement, taxReport } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import type { ComputedSettlement } from '../src/calc.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ids = Object.keys(GUIDES) as GuideId[]

// ---------- Aufbau ----------

test('Anleitungen: die acht Vermietungsarten aus #164, jede mit allen fünf Abschnitten', () => {
  assert.deepEqual(ids, ['granny', 'multiFamily', 'condo', 'properties', 'garage', 'flatRate', 'meteringService', 'tenantChange'])
  const titles = ids.map((id) => GUIDES[id].title)
  assert.equal(new Set(titles).size, titles.length, 'doppelter Titel')
  for (const id of ids) {
    const g = GUIDES[id]
    assert.ok(g.title.trim() && g.applies.trim() && g.example.trim(), id)
    assert.ok(g.steps.length >= 3, `${id}: zu wenige Schritte`)
    assert.ok(g.result.length >= 2, `${id}: „Was Mietfuchs daraus macht“ zu knapp`)
    assert.ok(g.caveats.length >= 1, `${id}: „Worauf Sie achten müssen“ fehlt`)
    assert.ok(g.gaps.length >= 1, `${id}: „Was Mietfuchs (noch) nicht kann“ fehlt`)
    assert.match(g.example, /\d/, `${id}: Beispiel ohne Zahl`)
    for (const s of g.steps) assert.ok(s.text.trim(), `${id}: leerer Schritt`)
  }
})

test('Anleitungen: jeder genannte Begriff steht im Lexikon', () => {
  for (const id of ids) {
    const g = GUIDES[id]
    assert.ok(g.terms.length > 0, `${id} ohne Begriff`)
    for (const t of g.terms) assert.ok(Object.hasOwn(GLOSSARY, t), `${id}: unbekannter Begriff ${t}`)
  }
})

test('Anleitungen: jeder Sprung zeigt auf eine Seite der Navigation, und jede Anleitung springt', () => {
  // Die Kennungen sind dieselben wie die der Navigation (client/src/nav.ts prüft das beim
  // Übersetzen); hier nur, dass keine Anleitung ohne Sprung auskommt.
  for (const id of ids) {
    const pages = GUIDES[id].steps.flatMap((s) => (s.page ? [s.page] : []))
    assert.ok(pages.length >= 2, `${id}: zu wenige Sprünge`)
    for (const p of pages) assert.ok(GUIDE_PAGES.includes(p), `${id}: unbekannte Seite ${p}`)
  }
})

test('Anleitungen: Rechtliches nur mit Norm, und jede Norm nennt Paragraf oder Aktenzeichen', () => {
  let withNorm = 0
  for (const id of ids) {
    for (const c of GUIDES[id].caveats) {
      if (c.norm === undefined) continue
      withNorm++
      assert.match(c.norm, /§|IX R \d+\/\d+/, `${id}: Norm ohne Paragraf: ${c.norm}`)
    }
    // Kein Paragraf im Fließtext ohne Normangabe daneben: Wer ein Gesetz zitiert, nennt es.
    for (const c of GUIDES[id].caveats) {
      if (/§/.test(c.text)) assert.ok(c.norm, `${id}: Paragraf im Text, aber keine Norm: ${c.text}`)
    }
  }
  assert.ok(withNorm >= 8, `nur ${withNorm} belegte Rechtsaussagen`)
})

test('Anleitungen: offene Lücken verweisen auf ihr Issue, darunter die Heizkostenabrechnung, die Vorverteilung und der Belegordner', () => {
  const issues = new Set(ids.flatMap((id) => GUIDES[id].gaps.flatMap((g) => (g.issue ? [g.issue] : []))))
  for (const n of [95, 97, 99, 170]) assert.ok(issues.has(n), `#${n} fehlt`)
  // #141 ist auf diesem Stand nicht umgesetzt und nicht erwähnt.
  assert.ok(!issues.has(141))
  for (const id of ids) {
    const all = JSON.stringify(GUIDES[id])
    assert.doesNotMatch(all, /Vorjahr übernehmen|#141/, `${id} erwähnt #141`)
  }
})

// ---------- Bedienangaben wörtlich ----------

function uiSources(): string {
  const files = (dir: string) => fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => fs.readFileSync(path.join(ROOT, dir, f), 'utf8'))
  return [...files('client/src'), ...files('shared').filter((s) => !s.includes('export const GUIDES'))].join('\n')
}

test('Anleitungen: jede zitierte Beschriftung steht so in der Oberfläche', () => {
  const ui = uiSources()
  const missing: string[] = []
  for (const id of ids) {
    const g = GUIDES[id]
    for (const text of [...g.steps.map((s) => s.text), ...g.result]) {
      for (const m of text.matchAll(/„([^“]+)“/g)) {
        const quoted = m[1] ?? ''
        if (!ui.includes(quoted)) missing.push(`${id}: „${quoted}“`)
      }
    }
  }
  assert.deepEqual(missing, [])
})

// ---------- Zahlenbeispiele, mit der Berechnung nachgerechnet ----------

const eur = (cents: number): string =>
  `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })} €`

const tenancy = (id: string, unitId: string, start = '2020-01-01', end: string | null = null, persons = 1, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons, personHistory: [{ from: start, persons }], start, end,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const rented = (id: string, areaM2: number, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2, participates: true, ...over })
const own = (id: string, areaM2: number, selfPersons = 2): SnapshotUnit => ({ id, name: id, areaM2, participates: false, selfUsed: true, selfPersons })
const item = (id: string, over: Partial<SnapshotCostItem>): SnapshotCostItem => ({
  id, year: 2025, category: 'Grundsteuer', description: id, amountCents: 100000, key: 'area', ...over,
})
const source = (over: Partial<SnapshotSource>): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...over,
})
const settle = (s: SnapshotSource): ComputedSettlement => computeSettlement(snapshotOf(s, 2025))
const share = (r: ComputedSettlement, tenancyId: string, itemId: string): number => {
  const row = r.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((x) => x.costItemId === itemId)
  if (!row) return assert.fail(`keine Zeile ${itemId} bei ${tenancyId}`)
  return row.shareCents
}
const landlordParts = (r: ComputedSettlement, itemId: string) =>
  r.landlord.rows.find((x) => x.costItemId === itemId)?.landlordParts ?? []
// Die Beträge stehen in dieser Reihenfolge im Beispiel.
const inOrder = (text: string, amounts: string[], id: string) => {
  let from = 0
  for (const a of amounts) {
    const at = text.indexOf(a, from)
    assert.ok(at >= 0, `${id}: „${a}“ fehlt im Beispiel (ab Stelle ${from}): ${text}`)
    from = at + a.length
  }
}

const checks: Record<GuideId, () => void> = {
  granny: () => {
    const src = source({
      units: [own('eigen', 120), rented('elw', 60)],
      tenancies: [tenancy('t', 'elw')],
      meters: [{ id: 'haus', unitId: null, type: 'kaltwasser' }, { id: 'zw', unitId: 'elw', type: 'kaltwasser' }],
      readings: [
        { meterId: 'haus', date: '2024-12-31', value: 1000 }, { meterId: 'haus', date: '2025-12-31', value: 1150 },
        { meterId: 'zw', date: '2024-12-31', value: 200 }, { meterId: 'zw', date: '2025-12-31', value: 250 },
      ],
      costItems: [
        item('gs', { amountCents: 90000 }),
        item('wasser', { category: 'Wasser/Abwasser', amountCents: 60000, key: 'meter', meterType: 'kaltwasser' }),
        item('dach', { category: 'Nicht umlagefähig', amountCents: 180000 }),
      ],
    })
    const r = settle(src)
    const tax = taxReport(snapshotOf(src, 2025)).expenses.items.find((x) => x.costItemId === 'dach')
    if (!tax) return assert.fail('Dachreparatur fehlt in der Steuerübersicht')
    assert.equal(1150 - 1000, 150)
    assert.equal(250 - 200, 50)
    inOrder(GUIDES.granny.example, [
      '120 m²', '60 m²', '180 m²', eur(90000), eur(share(r, 't', 'gs')), eur(90000 - share(r, 't', 'gs')),
      eur(60000), '150 m³', '50 m³', eur(share(r, 't', 'wasser')), eur(60000 - share(r, 't', 'wasser')),
      eur(180000), eur(tax.deductibleCents), eur(tax.privateCents),
    ], 'granny')
    assert.equal(r.selfUsedShareCents, 90000 - share(r, 't', 'gs') + 60000 - share(r, 't', 'wasser'))
  },
  multiFamily: () => {
    const r = settle(source({
      units: [rented('a', 50), rented('b', 70), own('c', 80)],
      tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
      costItems: [item('gs', { amountCents: 200000 })],
    }))
    inOrder(GUIDES.multiFamily.example, ['50', '70', '80 m²', eur(200000), eur(share(r, 'ta', 'gs')), eur(share(r, 'tb', 'gs')), eur(r.selfUsedShareCents)], 'multiFamily')
    // Ganz vermietet trägt der dritte Mieter, was sonst Eigenanteil wäre.
    const full = settle(source({
      units: [rented('a', 50), rented('b', 70), rented('c', 80)],
      tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b'), tenancy('tc', 'c')],
      costItems: [item('gs', { amountCents: 200000 })],
    }))
    assert.equal(share(full, 'tc', 'gs'), r.selfUsedShareCents)
  },
  condo: () => {
    const r = settle(source({
      units: [rented('w', 72, { mea: 124 })],
      tenancies: [tenancy('tw', 'w')],
      costItems: [item('strom', { category: 'Beleuchtung/Allgemeinstrom', amountCents: 2976, key: 'external', externalBasis: { measure: 'mea', total: 10000, totalCents: 240000 } })],
    }))
    assert.equal(Math.round((240000 * 124) / 10000), 2976)
    assert.deepEqual(r.notices.map((n) => n.code), [], 'Betrag passt zu den Angaben der Gemeinschaft')
    inOrder(GUIDES.condo.example, [eur(240000), '124', '10.000 MEA', eur(2976), eur(share(r, 'tw', 'strom'))], 'condo')
    // Hausgeld: 300 € im Monat, davon 900 € im Jahr Rücklage (wie im Lexikon).
    inOrder(GUIDES.condo.example, [eur(30000), eur(360000), eur(90000), eur(270000)], 'condo')
    assert.equal(300 * 12 - 900, 2700)
  },
  properties: () => {
    // Vorverteilung von Hand, bis es #95 gibt: 1.500 € nach 300 und 200 m².
    assert.equal(150000 * 300 / 500, 90000)
    assert.equal(150000 * 200 / 500, 60000)
    inOrder(GUIDES.properties.example, [eur(150000), '300', '200 m²', eur(90000), eur(60000)], 'properties')
  },
  garage: () => {
    const r = settle(source({
      units: [rented('a', 70), rented('b', 50), rented('g', 0)],
      tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b'), tenancy('tg', 'g', '2020-01-01', null, 0)],
      costItems: [
        item('gs', { amountCents: 120000 }),
        item('muell', { category: 'Müllabfuhr', amountCents: 60000, key: 'units' }),
        item('muell2', { category: 'Müllabfuhr', amountCents: 60000, key: 'units', participantUnitIds: ['a', 'b'] }),
      ],
    }))
    assert.equal(share(r, 'tg', 'gs'), 0)
    assert.equal(share(r, 'tg', 'muell'), share(r, 'ta', 'muell'), 'nach Wohneinheiten zählt die Garage mit')
    assert.ok(r.notices.some((n) => n.code === 'basis.unit-zero'), 'die Garage ergibt einen Hinweis')
    inOrder(GUIDES.garage.example, [
      '70', '50 m²', '0 m²', eur(120000), eur(share(r, 'ta', 'gs')), eur(share(r, 'tb', 'gs')),
      eur(60000), eur(share(r, 'tg', 'muell')), eur(share(r, 'ta', 'muell2')),
    ], 'garage')
  },
  flatRate: () => {
    const r = settle(source({
      units: [rented('a', 60), rented('b', 60)],
      tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b', '2020-01-01', null, 1, { costModel: 'flatRate', flatRates: [{ from: '2020-01', monthlyCents: 5000 }] })],
      costItems: [item('gs', { amountCents: 120000 })],
    }))
    assert.deepEqual(r.statements.map((s) => s.tenancyId), ['ta'], 'mit Pauschale keine Abrechnung')
    assert.deepEqual(r.notSettled?.map((n) => n.tenancyId), ['tb'])
    const parts = landlordParts(r, 'gs')
    assert.deepEqual(parts.map((p) => p.reason), ['flatRate'])
    inOrder(GUIDES.flatRate.example, [eur(120000), eur(share(r, 'ta', 'gs')), eur(5000), eur(5000 * 12), eur(parts[0]?.cents ?? -1)], 'flatRate')
  },
  meteringService: () => {
    const base = {
      units: [rented('a', 70), rented('b', 60), own('c', 90)],
      tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
    }
    const heat = (selfAmounts: Record<string, number> | null) => item('heiz', {
      category: 'Heizung und Warmwasser', amountCents: 300000, key: 'amounts', tenancyAmounts: { ta: 124000, tb: 116000 }, selfAmounts,
    })
    const r = settle(source({ ...base, costItems: [heat({ c: 60000 })] }))
    const without = settle(source({ ...base, costItems: [heat(null)] }))
    assert.equal(r.selfUsedShareCents, 60000)
    // Ohne den Betrag der eigenen Wohnung steht er als Rest beim Vermieter und nicht als Eigenanteil.
    assert.equal(without.selfUsedShareCents, 0)
    assert.deepEqual(landlordParts(without, 'heiz').map((p) => p.reason), ['amountsRest'])
    inOrder(GUIDES.meteringService.example, [eur(300000), eur(share(r, 'ta', 'heiz')), eur(share(r, 'tb', 'heiz')), eur(r.selfUsedShareCents)], 'meteringService')
  },
  tenantChange: () => {
    const r = settle(source({
      units: [rented('a', 60), rented('b', 120)],
      tenancies: [tenancy('alt', 'a', '2020-01-01', '2025-03-31'), tenancy('neu', 'a', '2025-06-01'), tenancy('tb', 'b')],
      costItems: [item('gs', { amountCents: 180000 })],
    }))
    const vacancy = landlordParts(r, 'gs')
    assert.deepEqual(vacancy.map((p) => p.reason), ['vacancy'])
    // 01.01.–31.03. sind 90 Tage, April und Mai 61, 01.06.–31.12. 214; zusammen 365.
    assert.equal(90 + 61 + 214, 365)
    assert.equal(share(r, 'alt', 'gs') + (vacancy[0]?.cents ?? 0) + share(r, 'neu', 'gs'), 60000)
    inOrder(GUIDES.tenantChange.example, [
      '60', '180 m²', eur(180000), eur(60000), '90 Tage', eur(share(r, 'alt', 'gs')), '61 Tage', eur(vacancy[0]?.cents ?? -1),
      '214 Tage', eur(share(r, 'neu', 'gs')),
    ], 'tenantChange')
  },
}

for (const id of ids) {
  test(`Anleitung „${GUIDES[id].title}“: das Zahlenbeispiel ist mit der Berechnung nachgerechnet`, () => checks[id]())
}

test('Leerstand beim Personenschlüssel: Die leere Wohnung hat keine Personentage, ihr Anteil geht an die Bewohner (so steht es in der Anleitung)', () => {
  const r = settle(source({
    units: [rented('a', 60), rented('b', 120)],
    tenancies: [tenancy('alt', 'a', '2020-01-01', '2025-03-31'), tenancy('neu', 'a', '2025-06-01'), tenancy('tb', 'b')],
    costItems: [item('muell', { category: 'Müllabfuhr', amountCents: 36500, key: 'persons' })],
  }))
  assert.equal(r.landlord.rows.filter((x) => x.costItemId === 'muell').length, 0, 'beim Vermieter bleibt nichts')
  assert.equal(share(r, 'alt', 'muell') + share(r, 'neu', 'muell') + share(r, 'tb', 'muell'), 36500)
  assert.match(GUIDES.tenantChange.result.join(' '), /Personenzahl[^.]*keine Personentage/)
})
