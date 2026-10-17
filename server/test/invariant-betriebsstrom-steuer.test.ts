// Invarianten zum Betriebsstrom in der Steuerübersicht (#268), über zufällige Bestände mit festem Startwert.
//
// Je Bestand: ein Objekt mit ein bis drei Einheiten (vermietet oder selbstgenutzt), eine Anlage mit oder ohne
// Messdienst, zwei Kalenderjahre mit Gas, Stromrechnung, null bis zwei Heizpositionen „steckt auch in der
// Stromrechnung“ und null bis drei Abzügen beim Allgemeinstrom, verknüpft (auch ins andere Jahr) oder ohne Verweis.
// Geprüft wird je Steuerjahr:
//   I1 Werbungskosten = bezahlte Rechnungen, mit Gleichheit: Σ aller Positionen ohne Kennzeichnung, dazu die Abzüge
//      ohne Verweis bei Messdienst (deren Betriebsstrom steckt im Betrag des Messdienstes, der als Heizposition dasteht).
//      Ohne Messdienst also genau Gas + Stromrechnung + übrige Heizkosten. Gilt ohne Klemme, auch wenn mehr Betriebsstrom
//      in den Heizkosten steht als abgezogen ist (Entscheidung R-2).
//   I2 Die Abrechnung bleibt: Die Zeilen der echten Positionen tragen deren Betrag, und der Eigenanteil laut Abrechnung
//      (`selfUsedShareCents`) ist der von computeSettlement, die abgeleitete Zeile steckt nicht darin.
//   I3 privat + abziehbar = gesamt je Zeile und in der Summe; ohne selbstgenutzte Einheit ist nichts privat.
//   I4 Ist der Strom nach Fläche über alle Einheiten verteilt und gibt es keine Heizposition „steckt auch in der
//      Stromrechnung“, ist die Steuer mit selbst getragenem Abzug (ohne Verweis, ohne Messdienst) dieselbe wie ohne
//      Abzug: gleicher Betrag, privat auf höchstens einen Cent gleich (zwei Rundungen).
//   I5 (Integrationsdurchsicht M1) Mit Gutschriften in den Heizkosten (negative Heizposition mit eigenem Schlüssel
//      oder eigenen Teilnehmern, bis fast zur Höhe der Rechnung): Je Zeile hat der private Teil das Vorzeichen des
//      Betrags und liegt betragsmäßig nicht über ihm; an der Zeile zum Ausgleich liegt er zwischen ihren beiden
//      Richtungen (Abzüge und Betriebsstrom in den Heizkosten des Steuerjahres).
// Mehr Startwerte mit INV_FROM/INV_TO.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReportFor } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, calendarYearPeriod, periodKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { CostKey } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]
type Item = Source['costItems'][number]
type Plant = NonNullable<Source['heatingPlants']>[number]
type Rng = () => number
function makeRng(seed: number): Rng {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}
const SEEDS: number[] = process.env.INV_FROM !== undefined || process.env.INV_TO !== undefined
  ? Array.from({ length: Math.max(0, Number(process.env.INV_TO ?? 10) - Number(process.env.INV_FROM ?? 1) + 1) }, (_, k) => Number(process.env.INV_FROM ?? 1) + k)
  : Array.from({ length: 150 }, (_, k) => k + 1)
const YEARS = [2025, 2026]

type Stock = { source: Source; service: boolean; selfUsed: boolean }

function randomStock(rnd: Rng, opts: { generalKey?: CostKey; noIncluded?: boolean; deductions?: 'none' | 'unlinked' | 'random'; method?: 'manual' | 'service'; credits?: boolean; billYears?: boolean } = {}): Stock {
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T
  const cents = (min: number, max: number) => Math.round((min + rnd() * (max - min)) * 100)
  const unitCount = 1 + Math.floor(rnd() * 3)
  const units = Array.from({ length: unitCount }, (_, i) => {
    const self = unitCount > 1 && rnd() < 0.35
    return { id: `u${i}`, propertyId: 'objekt-1', name: `W${i}`, areaM2: 20 + Math.floor(rnd() * 80), participates: !self, ...(self ? { selfUsed: true, selfPersons: 1 + Math.floor(rnd() * 3) } : {}) }
  })
  const tenancies = units.filter((u) => u.participates).map((u) => ({
    id: `t-${u.id}`, unitId: u.id, tenantName: u.id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 + Math.floor(rnd() * 3) }], start: '2020-01-01', end: null,
    prepayments: [], prepaymentOverrides: {}, baseRents: [],
  }))
  const method = opts.method ?? pick(['manual', 'manual', 'service'] as const)
  const plant: Plant = {
    id: 'hp1', propertyId: 'objekt-1', name: 'Kessel', method, source: 'building', supply: 'central', energy: 'gas', devicesRemote: 'unknown',
    devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null, periodStartMonth: null, periodChanges: [], separateSpans: [],
    separateSettlement: false, endsOn: null, replacesPlantId: null,
  }
  const heatKeys: CostKey[] = ['area', 'units', 'persons']
  const subset = () => {
    if (rnd() < 0.7 || unitCount < 2) return {}
    const ids = units.filter(() => rnd() < 0.6).map((u) => u.id)
    return ids.length > 0 ? { participantUnitIds: ids } : {}
  }
  const items: Item[] = []
  const included: string[] = []
  for (const year of YEARS) {
    const period = periodKey(`${year}-01`)
    const heatSubset = subset()
    items.push({ id: `gas${year}`, propertyId: 'objekt-1', period, category: HEATING_CATEGORY, description: `Gas ${year}`, amountCents: cents(1000, 9000), key: pick(heatKeys), heatingPlantId: 'hp1', heatingPart: 'fuel', ...heatSubset })
    items.push({ id: `hs${year}`, propertyId: 'objekt-1', period, category: 'Beleuchtung/Allgemeinstrom', description: `Hausstrom ${year}`, amountCents: cents(300, 2000), key: opts.generalKey ?? pick(heatKeys) })
    if (!opts.noIncluded) {
      const n = Math.floor(rnd() * 3)
      for (let k = 0; k < n; k++) {
        const id = `bs${year}-${k}`
        included.push(id)
        items.push({ id, propertyId: 'objekt-1', period, category: HEATING_CATEGORY, description: `Betriebsstrom ${id}`, amountCents: cents(20, 400), key: pick(heatKeys), heatingPlantId: 'hp1', heatingPart: 'operating', operatingPower: 'included', ...heatSubset })
      }
    }
  }
  const deductionMode = opts.deductions ?? 'random'
  if (deductionMode !== 'none') {
    for (const year of YEARS) {
      const period = periodKey(`${year}-01`)
      const n = deductionMode === 'unlinked' ? 1 : Math.floor(rnd() * 4)
      for (let k = 0; k < n; k++) {
        const link = deductionMode === 'random' && included.length > 0 && rnd() < 0.6 ? pick(included) : undefined
        items.push({
          id: `ab${year}-${k}`, propertyId: 'objekt-1', period, category: 'Beleuchtung/Allgemeinstrom', description: `Abzug ${year}-${k}`,
          amountCents: -cents(10, 250), key: opts.generalKey ?? 'units', operatingPower: 'deduction', operatingPowerGeneralId: `hs${year}`,
          ...(link ? { operatingPowerItemId: link } : {}),
        })
      }
    }
  }
  // I5: Gutschriften in den Heizkosten, zuletzt gezogen, damit die Bestände ohne sie gleich bleiben.
  if (opts.credits) {
    for (const year of YEARS) {
      if (rnd() < 0.4) continue
      const period = periodKey(`${year}-01`)
      const gas = items.find((c) => c.id === `gas${year}`)?.amountCents ?? 0
      items.push({
        id: `gut${year}`, propertyId: 'objekt-1', period, category: HEATING_CATEGORY, description: `Gutschrift ${year}`,
        amountCents: -Math.max(1, Math.round(gas * (0.05 + rnd() * 0.94))), key: pick(heatKeys), heatingPlantId: 'hp1', heatingPart: 'fuel', ...subset(),
      })
    }
  }
  // #267: Die Stromrechnung im Jahr nach ihrer Abrechnung bezahlt, und ein Abzug mit einem eigenen, abweichenden Jahr
  // (aus der Zeit vor #267). Zuletzt gezogen, damit die Bestände ohne diese Angaben gleich bleiben. Der Kalenderzeitraum
  // mit einem anderen Jahr kommt erst mit PR 3 von #255 in die Datenbank; die Rechnung nimmt ihn schon heute so.
  if (opts.billYears) {
    for (const c of items) {
      const year = Number(c.period.slice(0, 4))
      if (c.category === 'Beleuchtung/Allgemeinstrom' && c.operatingPower === undefined && rnd() < 0.5) c.taxYear = year + 1
      if (c.operatingPower === 'deduction' && rnd() < 0.5) c.taxYear = year + Math.floor(rnd() * 2)
    }
  }
  const source = {
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
    units, tenancies, costItems: items, meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [plant],
  } as Source
  return { source, service: method === 'service', selfUsed: units.some((u) => !u.participates) }
}

const yearItems = (s: Source, year: number) => s.costItems.filter((c) => c.period === periodKey(`${year}-01`))

test('#268 Invariante I1–I3: Werbungskosten = bezahlte Rechnungen je Steuerjahr, privat + abziehbar = gesamt, Abrechnung unberührt', () => {
  let negative = 0
  let positive = 0
  for (const seed of SEEDS) {
    const rnd = makeRng(seed)
    const { source, service, selfUsed } = randomStock(rnd)
    for (const year of YEARS) {
      const at = `Startwert ${seed}, ${year}`
      const r = taxReportFor(source, 'objekt-1', year)
      const own = yearItems(source, year)
      // I1: bezahlt sind die Rechnungen ohne Kennzeichnung; bei Messdienst bleiben die Abzüge ohne Verweis abgezogen.
      const paid = own.filter((c) => c.operatingPower === undefined).reduce((a, c) => a + c.amountCents, 0)
      const reported = service ? own.filter((c) => c.operatingPower === 'deduction' && !c.operatingPowerItemId).reduce((a, c) => a + c.amountCents, 0) : 0
      assert.equal(r.expenses.totalCents, paid + reported, `${at}: I1`)
      const balance = r.operatingPowerBalanceCents ?? 0
      if (balance < 0) negative++
      if (balance > 0) positive++
      // I2: echte Positionen mit ihrem Betrag; der Eigenanteil laut Abrechnung ohne die abgeleitete Zeile.
      for (const i of r.expenses.items) {
        if (i.operatingPowerBalance) continue
        assert.equal(i.amountCents, own.find((c) => c.id === i.costItemId)?.amountCents, `${at}: I2 ${i.costItemId}`)
      }
      const settlement = computeSettlement(snapshotFor(source, 'objekt-1', calendarYearPeriod(year)))
      assert.equal(r.selfUsedShareCents, settlement.selfUsedShareCents, `${at}: I2 Eigenanteil`)
      // I3
      for (const i of r.expenses.items) assert.equal(i.privateCents + i.deductibleCents, i.amountCents, `${at}: I3 ${i.costItemId}`)
      assert.equal(r.expenses.privateCents + r.expenses.deductibleCents, r.expenses.totalCents, `${at}: I3 Summe`)
      if (!selfUsed) assert.ok(r.expenses.items.every((i) => i.privateCents === 0), `${at}: I3 ohne Eigennutzung`)
    }
  }
  // Der Generator muss beide Richtungen des Ausgleichs erzeugen, sonst prüft I1 die Klemme nicht.
  assert.ok(negative > 0 && positive > 0, `negativ ${negative}, positiv ${positive}`)
})

test('#268 Invariante I4: Strom nach Fläche, Abzug ohne Verweis und ohne Messdienst: Steuer wie ohne Abzug', () => {
  let compared = 0
  for (const seed of SEEDS) {
    const withDeduction = randomStock(makeRng(seed), { generalKey: 'area', noIncluded: true, deductions: 'unlinked', method: 'manual' })
    const without = randomStock(makeRng(seed), { generalKey: 'area', noIncluded: true, deductions: 'none', method: 'manual' })
    for (const year of YEARS) {
      const a = taxReportFor(withDeduction.source, 'objekt-1', year)
      const b = taxReportFor(without.source, 'objekt-1', year)
      const at = `Startwert ${seed}, ${year}`
      assert.equal(a.expenses.totalCents, b.expenses.totalCents, `${at}: Betrag`)
      assert.ok(Math.abs(a.expenses.privateCents - b.expenses.privateCents) <= 1, `${at}: privat ${a.expenses.privateCents} gegen ${b.expenses.privateCents}`)
      compared++
    }
  }
  assert.ok(compared > 0)
})

test('#268 Invariante I5 (M1): mit Gutschriften in den Heizkosten privat mit dem Vorzeichen des Betrags und nie darüber', () => {
  let credits = 0
  let balanceLines = 0
  for (const seed of SEEDS) {
    const { source } = randomStock(makeRng(seed), { credits: true })
    credits += source.costItems.filter((c) => c.id.startsWith('gut')).length
    for (const year of YEARS) {
      const r = taxReportFor(source, 'objekt-1', year)
      const at = `Startwert ${seed}, ${year}`
      const own = yearItems(source, year)
      for (const i of r.expenses.items) {
        assert.equal(i.privateCents + i.deductibleCents, i.amountCents, `${at}: ${i.costItemId} Summe`)
        if (i.operatingPowerBalance) {
          // Die Zeile zum Ausgleich verrechnet zwei Richtungen, Abzüge (+) und Betriebsstrom in den Heizkosten (−), jede mit
          // ihrem eigenen Maßstab (Fläche beim Abzug ohne Verweis, Heizanteil sonst). Ihr privater Teil liegt deshalb
          // zwischen den beiden Richtungen und nicht zwingend im Saldo; außerhalb davon war die Quote kein Anteil.
          balanceLines++
          const up = own.filter((c) => c.operatingPower === 'deduction').reduce((a, c) => a - c.amountCents, 0)
          const down = own.filter((c) => c.operatingPower === 'included').reduce((a, c) => a + c.amountCents, 0)
          assert.ok(i.privateCents >= -down && i.privateCents <= up, `${at}: Ausgleich privat ${i.privateCents} außerhalb −${down} … +${up}`)
          if (up === 0 || down === 0) assert.ok(Math.abs(i.privateCents) <= Math.abs(i.amountCents), `${at}: Ausgleich privat ${i.privateCents} über dem Betrag ${i.amountCents}`)
          continue
        }
        assert.ok(Math.abs(i.privateCents) <= Math.abs(i.amountCents), `${at}: ${i.costItemId} privat ${i.privateCents} über dem Betrag ${i.amountCents}`)
        assert.ok(i.privateCents === 0 || Math.sign(i.privateCents) === Math.sign(i.amountCents), `${at}: ${i.costItemId} privat ${i.privateCents} gegen Betrag ${i.amountCents}`)
      }
      assert.equal(r.expenses.privateCents + r.expenses.deductibleCents, r.expenses.totalCents, `${at}: Summe`)
    }
  }
  assert.ok(credits > 0 && balanceLines > 0, `Gutschriften ${credits}, Ausgleichszeilen ${balanceLines}`)
})

// #267 (#255, PR 2): Der Abzug steht im Steuerjahr seiner Stromrechnung, gleich welches Jahr er selbst trägt. Das Jahr
// der Zahlung einer Position, wie es die Steuer sieht, nach outflow.ts nachgebaut: der Abzug das seiner Rechnung, sonst
// das angegebene, sonst das des Zeitraums.
const BILL_YEARS = [2025, 2026, 2027]
function paidYearOf(s: Source, c: Item): number {
  const own = (x: Item) => x.taxYear ?? Number(x.period.slice(0, 4))
  if (c.operatingPower !== 'deduction') return own(c)
  const bill = s.costItems.find((x) => x.id === c.operatingPowerGeneralId) ?? assert.fail(`${c.id}: keine Rechnung`)
  return own(bill)
}

test('#267 Invariante I1/I3 mit Jahr der Zahlung der Stromrechnung: Werbungskosten = in diesem Jahr bezahlte Rechnungen, Abzug im Jahr seiner Rechnung', () => {
  let moved = 0
  let stale = 0
  for (const seed of SEEDS) {
    const { source, service, selfUsed } = randomStock(makeRng(seed), { billYears: true })
    moved += source.costItems.filter((c) => c.operatingPower === undefined && c.taxYear !== undefined).length
    stale += source.costItems.filter((c) => c.operatingPower === 'deduction' && c.taxYear !== undefined && c.taxYear !== paidYearOf(source, c)).length
    let total = 0
    for (const year of BILL_YEARS) {
      const at = `Startwert ${seed}, ${year}`
      const r = taxReportFor(source, 'objekt-1', year)
      const own = source.costItems.filter((c) => paidYearOf(source, c) === year)
      const paid = own.filter((c) => c.operatingPower === undefined).reduce((a, c) => a + c.amountCents, 0)
      const reported = service ? own.filter((c) => c.operatingPower === 'deduction' && !c.operatingPowerItemId).reduce((a, c) => a + c.amountCents, 0) : 0
      assert.equal(r.expenses.totalCents, paid + reported, `${at}: I1`)
      // Jeder Abzug steht mit seiner Rechnung im selben Jahr.
      const ids = new Set(r.expenses.items.map((i) => i.costItemId))
      for (const d of source.costItems.filter((c) => c.operatingPower === 'deduction')) {
        assert.equal(ids.has(d.id), ids.has(d.operatingPowerGeneralId ?? ''), `${at}: Abzug ${d.id} ohne seine Rechnung`)
      }
      for (const i of r.expenses.items) assert.equal(i.privateCents + i.deductibleCents, i.amountCents, `${at}: I3 ${i.costItemId}`)
      assert.equal(r.expenses.privateCents + r.expenses.deductibleCents, r.expenses.totalCents, `${at}: I3 Summe`)
      if (!selfUsed) assert.ok(r.expenses.items.every((i) => i.privateCents === 0), `${at}: I3 ohne Eigennutzung`)
      total += r.expenses.totalCents
    }
    // Über alle Jahre genau einmal (Plan I2), ohne Kennzeichnung gezählt wie oben.
    const all = source.costItems.filter((c) => c.operatingPower === undefined).reduce((a, c) => a + c.amountCents, 0)
    const reportedAll = service ? source.costItems.filter((c) => c.operatingPower === 'deduction' && !c.operatingPowerItemId).reduce((a, c) => a + c.amountCents, 0) : 0
    assert.equal(total, all + reportedAll, `Startwert ${seed}: über alle Jahre`)
  }
  if (SEEDS.length >= 30) assert.ok(moved > 0 && stale > 0, `verschobene Rechnungen ${moved}, abweichende Abzüge ${stale}`)
})

test('#267 Invariante I4 mit Jahr der Zahlung: Abzug ohne Verweis selbst getragen ist wie kein Abzug, auch wenn die Rechnung im Folgejahr bezahlt ist', () => {
  // Nach Fläche haben Abzug und Ausgleich denselben Maßstab; die Invariante prüft hier nur, dass die verschobene Rechnung
  // daran nichts ändert. Ob ein eigenes Jahr am Abzug etwas bewirkt, prüft der nächste Test.
  let compared = 0
  for (const seed of SEEDS) {
    const withDeduction = randomStock(makeRng(seed), { generalKey: 'area', noIncluded: true, deductions: 'unlinked', method: 'manual', billYears: true })
    const without = randomStock(makeRng(seed), { generalKey: 'area', noIncluded: true, deductions: 'none', method: 'manual', billYears: true })
    // Dieselben Jahre der Rechnungen in beiden Beständen (der Zufall läuft mit den Abzügen verschieden weiter).
    for (const c of without.source.costItems) {
      const twin = withDeduction.source.costItems.find((x) => x.id === c.id)
      if (twin?.taxYear === undefined) delete c.taxYear
      else c.taxYear = twin.taxYear
    }
    for (const year of BILL_YEARS) {
      const a = taxReportFor(withDeduction.source, 'objekt-1', year)
      const b = taxReportFor(without.source, 'objekt-1', year)
      const at = `Startwert ${seed}, ${year}`
      assert.equal(a.expenses.totalCents, b.expenses.totalCents, `${at}: Betrag`)
      assert.ok(Math.abs(a.expenses.privateCents - b.expenses.privateCents) <= 1, `${at}: privat ${a.expenses.privateCents} gegen ${b.expenses.privateCents}`)
      compared++
    }
  }
  assert.ok(compared > 0)
})

test('#267 Invariante: ein eigenes Jahr am Abzug ändert an der Steuerübersicht nichts, privat eingeschlossen', () => {
  // Vor #267 stand der Abzug in seinem eigenen Jahr; mit einem anderen Schlüssel als dem des Ausgleichs blieb dort ein
  // privater Rest, und in einem Jahr ohne Stromrechnung ein Betrag von 0 mit privatem Teil (Plan, Beispiel B2).
  let differs = 0
  for (const seed of SEEDS) {
    const { source } = randomStock(makeRng(seed), { billYears: true })
    const plain = { ...source, costItems: source.costItems.map((c) => {
      if (c.operatingPower !== 'deduction') return c
      const { taxYear: _, ...rest } = c
      return rest
    }) } as Source
    if (source.costItems.some((c) => c.operatingPower === 'deduction' && c.taxYear !== undefined && c.taxYear !== paidYearOf(source, c))) differs++
    for (const year of BILL_YEARS) {
      const a = taxReportFor(source, 'objekt-1', year)
      const b = taxReportFor(plain, 'objekt-1', year)
      assert.deepEqual([a.expenses.totalCents, a.expenses.privateCents, a.expenses.items.map((i) => [i.costItemId, i.amountCents, i.privateCents])],
        [b.expenses.totalCents, b.expenses.privateCents, b.expenses.items.map((i) => [i.costItemId, i.amountCents, i.privateCents])], `Startwert ${seed}, ${year}`)
    }
  }
  if (SEEDS.length >= 30) assert.ok(differs > 0, 'kein Bestand mit abweichendem Jahr am Abzug')
})

// Durchsicht von #255 PR 2, S1 (zu M1): Über alle Steuerjahre zusammen ist der private Teil derselbe, gleich in welchen
// Jahren Stromrechnung, Abzug und Heizposition stehen. Jede Heizposition „steckt auch in der Stromrechnung“ hat genau
// einen Abzug gleicher Höhe, im Zeitraum eines zufälligen Jahres; die Stromrechnungen sind zufällig im Folgejahr bezahlt,
// und in einem Jahr fehlen zuweilen die übrigen Heizkosten. Dann gleicht sich jedes Paar aus: Die Zeilen zum Ausgleich
// ergeben über die Jahre zusammen 0 €, im Betrag genau und privat bis auf die Rundung je Zeile. Vorher nahm der Abzug
// den Heizanteil des Teils, in dem er stand (ohne Heizkosten dort: die Fläche), die Heizposition den ihres Teils.
test('#267 Invariante (S1): Betriebsstrom und Abzug in beliebigen Steuerjahren, über alle Jahre heben sie sich auch privat auf', () => {
  let crossing = 0
  let withoutHeat = 0
  for (const seed of SEEDS) {
    const rnd = makeRng(seed * 7 + 1)
    const { source } = randomStock(rnd, { deductions: 'none', method: 'manual', billYears: true })
    const heatKeys: CostKey[] = ['area', 'units', 'persons']
    const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T
    for (const h of source.costItems.filter((c) => c.operatingPower === 'included')) {
      const year = pick(YEARS)
      source.costItems.push({
        id: `ab-${h.id}`, propertyId: 'objekt-1', period: periodKey(`${year}-01`), category: 'Beleuchtung/Allgemeinstrom', description: `Abzug ${h.id}`,
        amountCents: -h.amountCents, key: pick(heatKeys), operatingPower: 'deduction', operatingPowerGeneralId: `hs${year}`, operatingPowerItemId: h.id,
      })
    }
    // Zuweilen hat ein Jahr außer dem Betriebsstrom keine Heizkosten (der Fall aus M1).
    if (rnd() < 0.3) {
      const year = pick(YEARS)
      source.costItems = source.costItems.filter((c) => c.id !== `gas${year}`)
      withoutHeat++
    }
    let amount = 0
    let privat = 0
    let lines = 0
    for (const year of BILL_YEARS) {
      const r = taxReportFor(source, 'objekt-1', year)
      const z = r.expenses.items.find((i) => i.operatingPowerBalance)
      if (z === undefined) continue
      lines++
      amount += z.amountCents
      privat += z.privateCents
    }
    if (lines > 0) crossing++
    assert.equal(amount, 0, `Startwert ${seed}: Ausgleich über alle Jahre`)
    assert.ok(Math.abs(privat) <= lines, `Startwert ${seed}: privat über alle Jahre ${privat} Cent bei ${lines} Zeilen`)
  }
  if (SEEDS.length >= 30) assert.ok(crossing > 0 && withoutHeat > 0, `Paare über Jahre ${crossing}, Jahre ohne Heizkosten ${withoutHeat}`)
})
