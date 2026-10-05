// Anleitungen je Vermietungsart (#164). Wie beim Lexikon gilt: Jeder Begriff steht im Lexikon,
// jede Rechtsaussage nennt ihre Norm, und jedes Zahlenbeispiel ist nachgerechnet. Nachgerechnet
// wird hier nicht von Hand, sondern mit der Berechnung selbst: Jede Anleitung hat einen Fall, der
// ihr Beispiel durch `computeSettlement` oder `taxReport` schickt, und die Beträge müssen wörtlich
// im Beispieltext stehen. Ändert sich die Berechnung, wird der Text rot statt still falsch.
//
// Dazu ein Wächter über die Bedienangaben: Jeder Text in „…“ in den Schritten und in „Was
// Mietfuchs daraus macht“ muss so in der Oberfläche stehen. Eine umbenannte Schaltfläche fällt
// damit hier auf und nicht erst beim Leser.
//
// **Seine Grenze**: Er sucht im Quelltext (client/src und shared/, ohne Tests), nicht in der
// gerenderten Seite. Ein Zitat besteht, sobald der Wortlaut irgendwo im Quelltext steht, auch in
// einem Kommentar oder an einer anderen Stelle als der gemeinten; ob die Beschriftung auf der
// genannten Seite sitzt, prüft er nicht. Umgekehrt findet er keinen Text, den JSX zerlegt (ein
// <Term> mitten im Satz, ein `{year}` im Knopf); solche Stellen zitiert die Anleitung nicht. HTML-
// Entitäten im JSX-Text werden vor dem Vergleich aufgelöst (`&amp;` ist `&`).

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GLOSSARY } from '../../shared/glossary.ts'
import { GUIDES, GUIDE_PAGES, type GuideId } from '../../shared/guides.ts'
import { computeSettlement, taxReport } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotHeatingPlant, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import type { ComputedSettlement } from '../src/calc.ts'
import type { Co2Statement } from '../../shared/types.ts'
import { splitByService } from '../src/serviceSplit.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ids = Object.keys(GUIDES) as GuideId[]

// ---------- Aufbau ----------

test('Anleitungen: die Vermietungsarten aus #164 und der Abrechnungszeitraum (#208), jede mit allen fünf Abschnitten', () => {
  assert.deepEqual(ids, ['granny', 'multiFamily', 'condo', 'properties', 'garage', 'flatRate', 'meteringService', 'co2Costs', 'tenantChange', 'periodMayApril'])
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
      assert.match(c.norm, /§|IX R \d+\/\d+|VIII ZR \d+\/\d+/, `${id}: Norm ohne Paragraf: ${c.norm}`)
    }
    // Kein Paragraf im Fließtext ohne Normangabe daneben: Wer ein Gesetz zitiert, nennt es.
    for (const c of GUIDES[id].caveats) {
      if (/§/.test(c.text)) assert.ok(c.norm, `${id}: Paragraf im Text, aber keine Norm: ${c.text}`)
    }
  }
  assert.ok(withNorm >= 8, `nur ${withNorm} belegte Rechtsaussagen`)
})

test('Anleitungen: offene Lücken verweisen auf ihr Issue, darunter die Heizkostenabrechnung und die Vorverteilung', () => {
  const issues = new Set(ids.flatMap((id) => GUIDES[id].gaps.flatMap((g) => (g.issue ? [g.issue] : []))))
  for (const n of [95, 97, 99]) assert.ok(issues.has(n), `#${n} fehlt`)
  // Der Belegordner (#170) und das Übernehmen aus dem Vorjahr (#141) sind ausgeliefert und keine
  // Lücke mehr; das alte Wort „Belegarchiv“ kennt die Oberfläche nicht mehr.
  for (const n of [141, 170]) assert.ok(!issues.has(n), `#${n} ist keine Lücke mehr`)
  for (const id of ids) assert.doesNotMatch(JSON.stringify(GUIDES[id]), /Belegarchiv/, `${id} nennt das Belegarchiv`)
})

test('Anleitungen: Belegordner, Vorjahr und Steuer-ZIP stehen dort, wo man sie braucht', () => {
  const text = (id: GuideId) => JSON.stringify(GUIDES[id])
  // Mehrere Objekte: Der Belegordner zeigt das gewählte Objekt und lässt sich umschalten.
  assert.match(text('properties'), /Belegordner/)
  assert.match(text('properties'), /„alle Objekte“/)
  // Wer jedes Jahr dieselben Positionen hat, übernimmt sie aus dem Vorjahr.
  for (const id of ['multiFamily', 'condo'] as const) assert.match(text(id), /Vorjahr/, `${id} ohne Übernahme aus dem Vorjahr`)
  // Belege kommen über den Posteingang; die Steuer bekommt ihr ZIP.
  assert.ok(GUIDES.multiFamily.steps.some((s) => s.page === 'belege' && s.text.includes('„Posteingang“')), 'Posteingang fehlt')
  assert.ok(GUIDES.granny.steps.some((s) => s.page === 'belege' && s.text.includes('„Belege für die Steuer“')), 'Steuer-ZIP fehlt')
})

// ---------- Bedienangaben wörtlich ----------

function uiSources(): string {
  const files = (dir: string) => fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => fs.readFileSync(path.join(ROOT, dir, f), 'utf8'))
  return [...files('client/src'), ...files('shared').filter((s) => !s.includes('export const GUIDES'))].join('\n')
    .replaceAll('&amp;', '&')
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
  id, period: calendarPeriod(2025), category: 'Grundsteuer', description: id, amountCents: 100000, key: 'area', ...over,
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

// Eine Gasheizung beim Messdienst und ihre CO₂-Angaben (Heizung PR 6).
const HP: SnapshotHeatingPlant = { id: 'hp', name: '', energy: 'gas', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null }
const co2Statement = (over: Partial<Co2Statement>): Co2Statement => ({
  heatingPeriodId: 'h', plantId: 'hp', period: calendarPeriod(2025), method: 'serviceDeducted', areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null,
  serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
  serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null,
  serviceFuelNetCents: null, reliefs: [], ...over,
})

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
    // Vorwegabzug (#209) mit der Karte „CO₂-Kosten“ (Heizung PR 6): Der Betrag ist, was bezahlt
    // wurde; Einzel- und Eigenbeträge stehen wie in der Abrechnung; den CO₂-Anteil des Vermieters
    // zerlegt Mietfuchs aus den CO₂-Angaben.
    const net = { ta: 120000, tb: 110000, c: 60000 }
    const co2 = 10000
    const sumNet = net.ta + net.tb + net.c
    const gross = sumNet + co2
    const src = source({
      units: [rented('a', 70), rented('b', 60), own('c', 90)],
      tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
      costItems: [item('heiz', {
        category: 'Heizung und Warmwasser', amountCents: gross, key: 'amounts', tenancyAmounts: { ta: net.ta, tb: net.tb }, selfAmounts: { c: net.c }, heatingPlantId: 'hp',
      })],
    })
    const snap = { ...snapshotOf(src, 2025), heatingPlants: [HP], co2Statements: [co2Statement({ serviceUsersTotalCents: sumNet, serviceLandlordCents: co2, serviceUnitsCount: 3 })] }
    const r = computeSettlement(snap)
    const tax = taxReport(snap).expenses.items.find((x) => x.costItemId === 'heiz')
    if (!tax) return assert.fail('Heizposition fehlt in der Steuerübersicht')
    assert.equal(share(r, 'ta', 'heiz'), net.ta)
    assert.equal(share(r, 'tb', 'heiz'), net.tb)
    assert.ok(!r.notices.some((n) => n.code === 'co2.sum-check'), 'die Probe geht auf')
    const ownCo2 = Math.round((co2 * net.c) / sumNet)
    assert.equal(r.selfUsedShareCents, net.c + ownCo2)
    assert.equal(tax.privateCents, net.c + ownCo2)
    const parts = landlordParts(r, 'heiz')
    assert.deepEqual(parts.map((p) => p.reason), ['selfUse', 'co2Share'])
    const co2Share = parts.find((p) => p.reason === 'co2Share')?.cents ?? -1
    assert.equal(co2Share, co2 - ownCo2)
    // Wer den Anteil seiner Wohnung zusätzlich in den Eigenbetrag schreibt (die frühere Anleitung)
    // oder nur die Summe der Nutzerbeträge als Betrag (#209), dem meldet es die Probe.
    const mit = (over: Partial<SnapshotCostItem>) => computeSettlement({ ...snap, costItems: snap.costItems.map((c) => ({ ...c, ...over })) })
    assert.ok(mit({ selfAmounts: { c: net.c + ownCo2 } }).notices.some((n) => n.code === 'co2.sum-check'), 'doppelt privat')
    assert.ok(mit({ amountCents: sumNet }).notices.some((n) => n.code === 'co2.sum-check'), 'netto statt bezahlt')
    inOrder(GUIDES.meteringService.example, [
      eur(net.ta), eur(net.tb), eur(net.c), eur(sumNet), eur(co2), eur(gross),
      eur(share(r, 'ta', 'heiz')), eur(share(r, 'tb', 'heiz')), eur(net.c), eur(sumNet), eur(co2), eur(gross),
      eur(ownCo2), eur(r.selfUsedShareCents), eur(co2Share),
    ], 'meteringService')
  },
  co2Costs: () => {
    // Beispiel A (Techem-Muster, Entwurf 7.4).
    const betraege = { ta: 110327, tb: 95864, tc: 101485, td: 76875 }
    const S = 384551
    const L = 8750
    const src = source({
      units: ['a', 'b', 'c', 'd'].map((u) => rented(u, 50)),
      tenancies: ['a', 'b', 'c', 'd'].map((u) => tenancy(`t${u}`, u)),
      costItems: [item('heiz', { category: 'Heizung und Warmwasser', amountCents: S + L, key: 'amounts', tenancyAmounts: betraege, heatingPlantId: 'hp' })],
    })
    const snap = { ...snapshotOf(src, 2025), heatingPlants: [HP], co2Statements: [co2Statement({ serviceUsersTotalCents: S, serviceLandlordCents: L, serviceUnitsCount: 4 })] }
    const r = computeSettlement(snap)
    for (const [t, c] of Object.entries(betraege)) assert.equal(share(r, t, 'heiz'), c)
    assert.deepEqual(landlordParts(r, 'heiz'), [{ reason: 'co2Share', cents: L }])
    const tax = taxReport(snap).expenses.items.find((x) => x.costItemId === 'heiz')
    if (!tax) return assert.fail('Heizposition fehlt in der Steuerübersicht')
    assert.equal(tax.deductibleCents, S + L)
    inOrder(GUIDES.co2Costs.example, ['3.540,00 €', eur(L), eur(S), eur(S), eur(L), eur(S), eur(L), eur(S + L), eur(L), eur(S + L)], 'co2Costs')
    // Der zweite Weg der Anleitung (Durchsicht C1): ohne Abzugszeile ist der Betrag S, die Beträge
    // der Mieter stehen wie in der Abrechnung, und Mietfuchs zieht den Anteil mit eigener Zeile ab.
    const brutto = { ta: 112837, tb: 98045, tc: 103794, td: 78625 }
    const S2 = 393301
    const shown = { ...snapshotOf(source({ ...src, costItems: [item('heiz', { category: 'Heizung und Warmwasser', amountCents: S2, key: 'amounts', tenancyAmounts: brutto, heatingPlantId: 'hp' })] }), 2025),
      heatingPlants: [HP], co2Statements: [co2Statement({ method: 'serviceShown', serviceUsersTotalCents: S2, serviceLandlordCents: L, serviceUnitsCount: 4 })] }
    const r2 = computeSettlement(shown)
    assert.ok(!r2.notices.some((n) => n.code === 'co2.sum-check'), 'ohne Abzugszeile geht die Probe mit Betrag S auf')
    const abzug = r2.statements.flatMap((st) => st.rows.filter((row) => row.kind === 'co2Relief')).reduce((a, row) => a - row.shareCents, 0)
    assert.equal(abzug, L)
    const schritte = GUIDES.co2Costs.steps.map((x) => x.text)
    const frage = schritte.findIndex((t) => /Abzüglich CO₂-Kosten Vermieter/.test(t))
    const betrag = schritte.findIndex((t) => /Ohne diese Zeile ist der Betrag die Summe der Kosten aller Nutzer/.test(t))
    assert.ok(frage >= 0 && betrag > frage, 'erst die Frage nach der Abzugszeile, dann der Betrag je nach Antwort')
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
  // #208: die Aufteilung der Grundsteuer nach Tagen, mit derselben Funktion wie beim Speichern.
  periodMayApril: () => {
    const parts = splitByService({ startMonth: 1, changes: ['2025-05'] }, { id: 'g', description: 'Grundsteuer 2025', amountCents: 48000, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
    assert.deepEqual(parts.map((p) => p.amountCents), [15781, 32219])
    inOrder(GUIDES.periodMayApril.example, ['01.01.', '30.04.2025', '30.04.2026', eur(48000), eur(15781), eur(32219)], 'periodMayApril')
  },
}

for (const id of ids) {
  test(`Anleitung „${GUIDES[id].title}“: das Zahlenbeispiel ist mit der Berechnung nachgerechnet`, () => checks[id]())
}

test('Leerstand beim Personenschlüssel: Die leere Wohnung zählt je Leerstandstag mit einer Person, den Anteil trägt der Vermieter (so steht es in der Anleitung, seit #177)', () => {
  const r = settle(source({
    units: [rented('a', 60), rented('b', 120)],
    tenancies: [tenancy('alt', 'a', '2020-01-01', '2025-03-31'), tenancy('neu', 'a', '2025-06-01'), tenancy('tb', 'b')],
    costItems: [item('muell', { category: 'Müllabfuhr', amountCents: 36500, key: 'persons' })],
  }))
  // 2025: alt 90, Leerstand 61, neu 214 und tb 365 Personentage, zusammen 730; 50 Cent je Tag.
  const landlordRow = r.landlord.rows.find((x) => x.costItemId === 'muell') ?? assert.fail('beim Vermieter fehlt der Leerstand')
  assert.deepEqual(landlordRow.landlordParts, [{ reason: 'vacancy', cents: 3050 }])
  assert.deepEqual([share(r, 'alt', 'muell'), share(r, 'neu', 'muell'), share(r, 'tb', 'muell')], [4500, 10700, 18250])
  const result = GUIDES.tenantChange.result.join(' ')
  assert.match(result, /Beim Personenschlüssel zählt eine leerstehende Wohnung je Leerstandstag mit einer Person, und auch diesen Anteil trägt der Vermieter/)
  assert.match(result, /Auslegung von Mietfuchs/)
  assert.doesNotMatch(result, /#177/)
  // Kein Rat zum Schlüsselwechsel: Einseitig geht das nur nach § 556a Abs. 2 BGB (Durchsicht).
  assert.doesNotMatch(JSON.stringify(GUIDES.tenantChange), /verteilen Sie diese Position nach Fläche/)
  assert.ok(!GUIDES.tenantChange.gaps.some((g) => g.issue === 177), 'die Lücke ist mit 0.9.0 geschlossen')
  // Das Lexikon sagt dasselbe: eine Person je Leerstandstag, als Auslegung.
  const v = GLOSSARY.vacancy
  assert.match(v.example + v.needed, /Personenschlüssel/)
  assert.match(v.needed, /Auslegung von Mietfuchs/)
})

// ---------- Befunde der Durchsicht (#164) ----------

test('Durchsicht: Zählerstände zu Jahresbeginn und Jahresende, Speichern beim Objekt der Eigentumswohnung', () => {
  for (const id of ['granny', 'multiFamily'] as const) {
    const zaehler = GUIDES[id].steps.filter((s) => s.page === 'zaehler').map((s) => s.text).join(' ')
    assert.match(zaehler, /31\.12\. des Vorjahres/, id)
    assert.match(zaehler, /Jahresende/, id)
  }
  assert.match(GUIDES.condo.steps[0]?.text ?? '', /klicken Sie auf „Speichern“/)
})

test('Durchsicht: CO₂-Kosten mit belegter Norm beim Mehrfamilienhaus und beim Messdienst', () => {
  for (const id of ['multiFamily', 'meteringService'] as const) {
    const c = GUIDES[id].caveats.find((x) => /CO₂/.test(x.text))
    if (!c) return assert.fail(`${id}: kein Satz zur CO₂-Aufteilung`)
    assert.match(c.norm ?? '', /§ 7 Abs\. 3 und 4 CO2KostAufG/)
    assert.match(c.text, /3 Prozent/)
  }
  // Beim Mehrfamilienhaus ohne Messdienst rechnet Mietfuchs die Aufteilung noch nicht selbst (#97);
  // beim Messdienst übernimmt die Karte „CO₂-Kosten“ dessen Angaben. Die eigene Aufteilung bleibt eine
  // Lücke mit Issue.
  assert.match(GUIDES.multiFamily.caveats.find((x) => /CO₂/.test(x.text))?.text ?? '', /#97/)
  assert.ok(GUIDES.meteringService.gaps.some((g) => g.issue === 97 && /selbst/.test(g.text)), 'die eigene Aufteilung bleibt eine Lücke')
})

test('Messdienst mit Vorwegabzug (#209): Der Betrag ist, was bezahlt wurde, der CO₂-Anteil des Vermieters wird dazugerechnet', () => {
  const g = GUIDES.meteringService
  const [amount, perTenancy, own] = g.steps.map((s) => s.text)
  // Schritt 1: brutto, also vor dem Abzug, mit der Formel aus dem Entwurf (Abschnitt 5.4).
  assert.match(amount ?? '', /bezahlt/)
  assert.match(amount ?? '', /vor dem Abzug/)
  assert.match(amount ?? '', /Summe aller Nutzerbeträge für Heizung und Warmwasser \(einschließlich Leerstand\) \+ CO₂-Anteil des Vermieters/)
  assert.doesNotMatch(amount ?? '', /Gesamtbetrag der Abrechnung/, 'der Gesamtbetrag ist beim Vorwegabzug netto')
  // Schritt 2: der Betrag, den die Abrechnung für den Mieter nennt, ohne selbst abzuziehen; sonst
  // entlastete Mietfuchs ihn bei „nur ausgewiesen“ ein zweites Mal (Durchsicht C1).
  assert.match(perTenancy ?? '', /Tragen Sie den Betrag ein, den die Abrechnung für den Mieter nennt; ziehen Sie selbst nichts ab\./)
  assert.doesNotMatch(perTenancy ?? '', /nach Abzug des CO₂-Anteils/)
  assert.match(perTenancy ?? '', /Kaltwasser/)
  assert.match(perTenancy ?? '', /eigene Positionen/)
  // Schritt 3: Eigenbetrag wie in der Abrechnung; der CO₂-Teil der eigenen Wohnung in die Karte.
  assert.match(own ?? '', /ohne etwas dazuzurechnen/)
  assert.match(own ?? '', /„davon für Ihre Wohnung“/)
  assert.match(own ?? '', /Steht auf der Einzelabrechnung Ihrer Wohnung ein vom Vermieter übernommener CO₂-Betrag, nehmen Sie diesen\./)
  assert.match(own ?? '', /tragen Sie 0 ein; dann gehört nichts davon ins Private\./)
  assert.match(own ?? '', /Nur wenn sie gar keine Beträge je Wohnung nennt, lassen Sie das Feld leer, und Mietfuchs rechnet näherungsweise: CO₂-Anteil × Betrag Ihrer Wohnung ÷ Summe aller Nutzerbeträge für Heizung und Warmwasser\./)
  assert.doesNotMatch(own ?? '', /Nur wenn er fehlt/, 'die Näherung gilt nicht schon, wenn nur bei der eigenen Wohnung ein Betrag fehlt')
  const order = ['Einzelabrechnung', 'ins Private', 'näherungsweise'].map((w) => own?.indexOf(w) ?? -1)
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'erst die Angabe des Messdienstes, dann „nichts privat“, zuletzt die Näherung')
  assert.ok(!order.includes(-1))
  // Was Mietfuchs daraus macht: der Rest ist Werbungskosten.
  assert.match(g.result.join(' '), /CO₂-Anteil des Vermieters[^.]*Werbungskosten/)
})

test('Messdienst (#209): selbstgenutzte Wohnung ohne CO₂-Anteil, Abrechnung ohne Aufteilung, keine Pauschalaussage über Messdienste', () => {
  const g = GUIDES.meteringService
  const all = JSON.stringify(g)
  // Nicht jeder Messdienst setzt für die eigene Wohnung einen Anteil an; dann bleibt nichts privat.
  // Die Regel selbst steht in Schritt 3; der Hinweis wiederholt sie nicht.
  const self = g.caveats.find((c) => /selbstgenutzte Wohnung/.test(c.text) && /CO₂/.test(c.text))
  if (!self) return assert.fail('Hinweis zur selbstgenutzten Wohnung ohne CO₂-Anteil fehlt')
  assert.match(self.text, /Nicht jeder Messdienst/)
  assert.doesNotMatch(self.text, /ins Private|näherungsweise|Näherung/, 'steht schon in Schritt 3')
  assert.doesNotMatch(self.text, /§/, 'keine Rechtsaussage')
  // Weist die Abrechnung keinen Anteil aus: nachfragen, Mietfuchs rechnet es noch nicht, 3 % Kürzung.
  const missing = g.caveats.find((c) => /keinen CO₂-Anteil des Vermieters aus/.test(c.text))
  if (!missing) return assert.fail('Hinweis für eine Abrechnung ohne CO₂-Aufteilung fehlt')
  assert.equal(missing.text, 'Weist die Abrechnung keinen CO₂-Anteil des Vermieters aus, fragen Sie beim Messdienst nach, bevor Sie abrechnen; selbst rechnet Mietfuchs die Aufteilung noch nicht (#97).')
  // Das Kürzungsrecht von 3 Prozent steht genau einmal, im Hinweis zur CO₂-Aufteilung mit seiner Norm.
  const threePercent = [...g.steps.map((x) => x.text), ...g.caveats.map((c) => c.text)].filter((t) => /3 (%|Prozent)/.test(t))
  assert.equal(threePercent.length, 1, `3 % steht ${threePercent.length}-mal`)
  // Über Messdienste nur, was für die großen belegt ist.
  assert.match(all, /Die großen Messdienste teilen auf, wenn/)
  assert.doesNotMatch(all, /Der Messdienst teilt auf/)
  // Zitate aus der Messdienst-Abrechnung in deutschen Anführungszeichen, wie im übrigen Text.
  assert.doesNotMatch(all, /‚|‘/)
  assert.match(g.example, /„abzüglich CO₂-Kosten Vermieter“/)
})

test('Durchsicht: Garagenhof nach Wohneinheiten, denn nach Fläche gibt es bei 0 m² keine Verteilbasis', () => {
  const step = GUIDES.garage.steps.find((s) => /Garagenhof/.test(s.text))?.text ?? ''
  assert.match(step, /nach Wohneinheiten/)
  assert.match(step, /ändert an der Berechnung nichts/)
  const r = settle(source({
    units: [rented('g1', 0), rented('g2', 0)],
    tenancies: [tenancy('t1', 'g1', '2020-01-01', null, 0), tenancy('t2', 'g2', '2020-01-01', null, 0)],
    costItems: [item('gs', { amountCents: 40000 }), item('gs2', { amountCents: 40000, key: 'units' })],
  }))
  assert.deepEqual(landlordParts(r, 'gs').map((p) => p.reason), ['noBasis'], 'nach Fläche bleibt alles beim Vermieter')
  assert.equal(share(r, 't1', 'gs2'), 20000)
})

test('Durchsicht: Normen genauer (§ 535, § 556a Abs. 1 Satz 2, § 16 Abs. 2 WEG, Frist mit Ausnahme, Anleitung zur Anlage V)', () => {
  const garage = GUIDES.garage.caveats.find((c) => /Garage/.test(c.text))
  assert.equal(garage?.norm, '§ 535 Abs. 1 Satz 3, § 556 Abs. 1 BGB')
  assert.ok(ids.some((id) => GUIDES[id].caveats.some((c) => /§ 556a Abs\. 1 Satz (1 und )?2 BGB/.test(c.norm ?? ''))))
  assert.match(GUIDES.condo.caveats.find((c) => c.norm === '§ 16 Abs. 2 WEG')?.text ?? '', /beschlossen oder vereinbart/)
  const frist = GUIDES.condo.caveats.find((c) => /Hausgeldabrechnung noch fehlt/.test(c.text))
  assert.match(frist?.text ?? '', /nicht zu vertreten/)
  assert.doesNotMatch(frist?.text ?? '', /VIII ZR|V ZR/)
  const aufstellung = GUIDES.granny.caveats.find((c) => /gesonderte/.test(c.text))
  assert.match(aufstellung?.text ?? '', /Anleitung zur Anlage V/)
  assert.equal(aufstellung?.norm, undefined, 'eine Anleitung des Vordrucks ist kein Gesetz')
})

test('Durchsicht: Wortlaute „Vermieter & Zahlung“, Inklusivmiete und die neue Anschrift', () => {
  assert.match(GUIDES.properties.steps.map((s) => s.text).join(' '), /„Vermieter & Zahlung“/)
  assert.match(GUIDES.flatRate.steps.map((s) => s.text).join(' '), /Ist alles inklusive, /)
  const address = GUIDES.tenantChange.steps.find((s) => /Anschrift/.test(s.text))?.text ?? ''
  assert.match(address, /✎/)
  assert.match(address, /„Weitere Angaben — Nebenkosten-Modell, Kontakt, Kaution, Vertrag \(optional\)“/)
  assert.match(address, /zur Hand/)
  assert.match(address, /auf den Ausdruck kommt sie nicht/)
})

test('CO₂-Kosten aufteilen (Heizung PR 6): Ort von S je Messdienst, Muster nur bei Techem, keine Annahme je Messdienst (Entwurf 7.2, 7.3)', () => {
  const g = GUIDES.co2Costs
  const hinweise = g.caveats.map((c) => c.text).join(' ')
  assert.match(hinweise, /Bei Techem heißt die Zeile „Summe der Nutzerkosten Heizungsanlage“/)
  assert.match(hinweise, /Für ista, Brunata, Minol und KALO liegt Mietfuchs keine Musterabrechnung vor/)
  assert.ok(g.steps.some((s) => s.page === 'heizkosten' && s.text.includes('„Ich finde diese Zeile nicht“')))
  assert.ok(g.caveats.some((c) => /3 Prozent/.test(c.text) && c.norm === '§ 7 Abs. 3 und 4 CO2KostAufG'))
  assert.match(g.applies, /01\.01\.2023/)
  for (const n of [97, 210, 103]) assert.ok(g.gaps.some((x) => x.issue === n), `#${n} fehlt`)
})
