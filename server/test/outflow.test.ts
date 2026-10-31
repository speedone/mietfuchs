// Das Steuerjahr an einer Stelle (#255, PR 1): `outflowShares` in outflow.ts, und die Steuerübersicht, die Teile je
// Objekt und die Belege für die Steuer lesen nur noch dort. Reine Umstellung, deshalb vor allem eine Invariante:
// Über zufällige Bestände (server/testing/taxStock.ts) ergibt der neue Weg je Steuerjahr dieselbe Steuerübersicht und
// dieselbe Auswahl für das Steuer-ZIP wie der alte, tiefengleich. Der alte Weg steht unten als Referenz eingefroren,
// genau wie er vor #255 in calc.ts und index.ts stand (`taxPartsFor` mit `null` beim Kalenderobjekt, `taxYearOf`).
//
// Dazu die beiden Fälle des Mitwirkenden aus #255 (R-9) ohne Zahlungsdatum: Dann steht eine Position im Jahr ihrer
// Abrechnung bzw. im angegebenen Jahr. Mit Zahlungsdatum (PR 3) stehen dieselben Fälle in calc-steuer-zahlungsdatum.test.ts.
// Mehr Startwerte mit INV_FROM/INV_TO.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taxPartsFor, taxReport, taxReportFor, type TaxPart } from '../src/calc.ts'
import { deductionPlan, outflowShares, paidWhollyIn, planRates, soleOutflowYear } from '../src/outflow.ts'
import { frozenSettlementOf, heatingSnapshotFor, narrowToProperty, snapshotFor, wayOf } from '../src/snapshot.ts'
import { computeSettlement } from '../src/calc.ts'
import { derivedTaxLines, planTaxArchive, taxArchiveItems } from '../src/taxReceipts.ts'
import { makeRng, randomTaxStock, TAX_STOCK_PROPERTY, TAX_STOCK_SECOND, TAX_STOCK_YEARS, withSecondProperty, type TaxSource } from '../testing/taxStock.ts'
import { deductionsOffBillYear, pairAcrossParts, sha256, taxAmounts, taxFingerprint, withDeductionsInBillYear } from '../testing/taxGolden.ts'
import fs from 'node:fs'
import { CALENDAR_RULES, calendarPeriod, calendarYearPeriod, isCalendarRules, periodKey, periodsBetween, rulesOf } from '../../shared/period.ts'
import { plantRules, settledSeparately } from '../../shared/heatingPeriod.ts'
import type { BillingPeriod, CostItem, PeriodRules, TaxReport } from '../../shared/types.ts'

const SEEDS: number[] = process.env.INV_FROM !== undefined || process.env.INV_TO !== undefined
  ? Array.from({ length: Math.max(0, Number(process.env.INV_TO ?? 10) - Number(process.env.INV_FROM ?? 1) + 1) }, (_, k) => Number(process.env.INV_FROM ?? 1) + k)
  : Array.from({ length: 40 }, (_, k) => k + 1)

// ---------- Der alte Weg, eingefroren (calc.ts und index.ts vor #255) ----------

const oldTaxYearOf = (item: { taxYear?: number }, period: Pick<BillingPeriod, 'from'>): number => item.taxYear ?? Number(period.from.slice(0, 4))

function oldTaxPartsFor(source: TaxSource, propertyId: string, year: number): TaxPart[] | null {
  const rules = rulesOf(source.properties?.find((p) => p.id === propertyId))
  const ownPlants = (source.heatingPlants ?? []).filter((p) => p.propertyId === propertyId && (p.periodStartMonth ?? null) !== null)
  if (isCalendarRules(rules) && ownPlants.length === 0) return null
  const jahr = calendarYearPeriod(year)
  const vorjahr = calendarYearPeriod(year - 1)
  const bis = ownPlants.length > 0 ? calendarYearPeriod(year + 1).to : jahr.to
  const parts: TaxPart[] = periodsBetween(rules, vorjahr.from, bis).flatMap((p) => {
    const snap = snapshotFor(source, propertyId, p)
    const items = [
      ...(p.from > jahr.to ? [] : snap.costItems.filter((c) => oldTaxYearOf(c, p) === year)),
      ...(snap.heatingParts ?? []).filter((x) => !x.separate).flatMap((x) => x.items.filter((c) => oldTaxYearOf(c, x.period) === year)),
    ]
    const touches = p.from <= jahr.to && p.to >= jahr.from
    return items.length > 0 || touches ? [{ snapshot: snap, items }] : []
  })
  const separate: TaxPart[] = ownPlants.flatMap((plant) => {
    const way = wayOf(plant)
    return periodsBetween(plantRules(way, rules), vorjahr.from, jahr.to).flatMap((h) => {
      if (!settledSeparately(way, rules, h)) return []
      const snap = heatingSnapshotFor(source, propertyId, plant.id, h)
      if (!snap) return []
      const items = snap.costItems.filter((c) => oldTaxYearOf(c, h) === year)
      if (items.length > 0) return [{ snapshot: snap, items }]
      return Number(h.from.slice(0, 4)) === year ? [{ snapshot: snap, items: [], carryOnly: true as const }] : []
    })
  })
  return [...parts, ...separate]
}

function oldTaxReportFor(source: TaxSource, propertyId: string, year: number) {
  const calendar = snapshotFor(source, propertyId, calendarYearPeriod(year))
  const parts = oldTaxPartsFor(source, propertyId, year)
  const all = source.costItems.filter((c) => c.propertyId === propertyId)
  return taxReport(calendar, parts ?? undefined, { linkable: all })
}

// Die Auswahl des Steuer-ZIP (index.ts, `/api/receipts/tax/:year`).
function oldArchiveIds(source: TaxSource, propertyId: string, year: number): string[] {
  const stock = narrowToProperty(source, propertyId)
  const parts = oldTaxPartsFor(source, propertyId, year)
  const ids = new Set(parts === null
    ? stock.costItems.filter((c) => c.period === calendarPeriod(year)).map((c) => c.id)
    : parts.flatMap((p) => p.items.map((c) => c.id)))
  return stock.costItems.filter((c) => ids.has(c.id)).map((c) => c.id)
}

const outcome = <T>(f: () => T): { ok: true; value: T } | { ok: false; error: string } => {
  try {
    return { ok: true, value: f() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- outflowShares ----------

test('outflowShares: ein Anteil über den ganzen Betrag, angegebenes Jahr vor dem Beginn des Zeitraums', () => {
  assert.deepEqual(outflowShares({ taxYear: 2026, amountCents: 12345 }, { from: '2025-05-01' }), [{ year: 2026, cents: 12345, source: 'stated' }])
  assert.deepEqual(outflowShares({ amountCents: 500 }, { from: '2025-01-01' }), [{ year: 2025, cents: 500, source: 'period' }])
  assert.deepEqual(outflowShares({ amountCents: -150 }, { from: '2025-10-01' }), [{ year: 2025, cents: -150, source: 'period' }], 'Gutschrift mit ihrem Vorzeichen')
  assert.equal(paidWhollyIn({ id: 'a', amountCents: 500 }, { from: '2025-05-01' }, 2025), true)
  assert.equal(paidWhollyIn({ id: 'a', amountCents: 500 }, { from: '2025-05-01' }, 2026), false)
  assert.equal(paidWhollyIn({ id: 'a', taxYear: 2026, amountCents: 500 }, { from: '2025-05-01' }, 2026), true)
  assert.equal(soleOutflowYear({ id: 'a', taxYear: 2026, amountCents: 500 }, { from: '2025-05-01' }), 2026)
})

test('outflowShares (#267): ein Abzug beim Betriebsstrom nimmt das Jahr seiner Stromrechnung, sein eigenes zählt nicht', () => {
  const bill = { id: 'hs', amountCents: 100000, taxYear: 2026 }
  const deduction = { id: 'ab', amountCents: -20000, taxYear: 2025, operatingPower: 'deduction' as const, operatingPowerGeneralId: 'hs' }
  assert.deepEqual(outflowShares(deduction, { from: '2025-05-01' }, [bill, deduction]), [{ year: 2026, cents: -20000, source: 'bill' }])
  assert.deepEqual(outflowShares({ ...deduction, taxYear: undefined }, { from: '2025-01-01' }, [{ id: 'hs', amountCents: 100000 }]), [{ year: 2025, cents: -20000, source: 'bill' }],
    'Rechnung ohne Angabe: Beginn des gemeinsamen Zeitraums')
  assert.equal(paidWhollyIn(deduction, { from: '2025-05-01' }, 2025, [bill]), false)
  assert.equal(paidWhollyIn(deduction, { from: '2025-05-01' }, 2026, [bill]), true)
  assert.equal(soleOutflowYear(deduction, { from: '2025-05-01' }, [bill]), 2026)
  // Fehlt die Rechnung unter den Positionen (die Datenbank schließt das aus), gilt der Beginn des Zeitraums; das
  // gespeicherte Jahr am Abzug zählt auch dann nicht (Durchsicht von PR 2, K1).
  assert.deepEqual(outflowShares({ ...deduction, taxYear: 2027 }, { from: '2025-05-01' }, []), [{ year: 2025, cents: -20000, source: 'period' }])
  // Die Heizposition „steckt auch in der Stromrechnung“ behält ihr Jahr.
  assert.deepEqual(outflowShares({ id: 'bs', amountCents: 20000, taxYear: 2025, operatingPower: 'included' }, { from: '2025-05-01' }, [bill]), [{ year: 2025, cents: 20000, source: 'stated' }])
})

test('outflowShares: ein leeres Jahr (null aus einer Ablage) gilt als nicht angegeben und nimmt die Position nicht aus der Übersicht (Durchsicht K1)', () => {
  // Der Typ kennt nur `undefined`; ein `null`, das an der Grenze durchrutscht, darf die Position nicht still in ein
  // Jahr „null“ stellen, sondern muss wie vorher (`taxYear ?? Beginn`) im Jahr des Beginns stehen.
  const item = JSON.parse('{"id":"a","amountCents":500,"taxYear":null}') as { id: string; amountCents: number }
  assert.deepEqual(outflowShares(item, { from: '2025-01-01' }), [{ year: 2025, cents: 500, source: 'period' }])
  assert.equal(paidWhollyIn(item, { from: '2025-01-01' }, 2025), true)
  const src = haus(CALENDAR_RULES, [{ id: 'vers', period: periodKey('2025-01'), description: 'Versicherung', amountCents: 60000 }])
  Reflect.set(src.costItems[0] ?? assert.fail('keine Position'), 'taxYear', null)
  assert.deepEqual(inYear(src, 2025), ['vers'])
  assert.deepEqual(inZip(src, 2025), ['vers'])
})

// ---------- Die Jahre des Abzugs (§ 82b EStDV, #262 PR 2) ----------

const repair = (over: Partial<Pick<CostItem, 'paidOn' | 'taxYear' | 'spreadYears' | 'category' | 'amountCents'>> = {}) =>
  ({ id: 'dach', category: 'Nicht umlagefähig', amountCents: 1_000_000, ...over })

test('deductionPlan: ohne Wahl genau das Jahr des Abflusses', () => {
  assert.deepEqual(deductionPlan(repair(), { from: '2026-01-01' }), [{ outflowYear: 2026, years: [2026], of: 1, restYear: null }])
  assert.deepEqual(deductionPlan(repair({ paidOn: '2027-02-03' }), { from: '2026-01-01' }), [{ outflowYear: 2027, years: [2027], of: 1, restYear: null }])
})

test('deductionPlan: mit Wahl N Jahre ab dem Jahr aus Zahlungsdatum, Jahr der Zahlung oder Zeitraum', () => {
  assert.deepEqual(deductionPlan(repair({ spreadYears: 3 }), { from: '2026-01-01' }), [{ outflowYear: 2026, years: [2026, 2027, 2028], of: 3, restYear: null }])
  assert.deepEqual(deductionPlan(repair({ spreadYears: 2, paidOn: '2027-01-08' }), { from: '2026-01-01' })[0]?.years, [2027, 2028])
  // Mai bis April, Jahr der Zahlung angegeben: die Verteilung beginnt im angegebenen Jahr.
  assert.deepEqual(deductionPlan(repair({ spreadYears: 5, taxYear: 2026 }), { from: '2025-05-01' })[0]?.years, [2026, 2027, 2028, 2029, 2030])
})

test('deductionPlan: wo nicht verteilt werden kann, zählt die Wahl nicht (Heizposition, Gutschrift, umlagefähig)', () => {
  for (const over of [{ category: 'Heizung' }, { category: 'Grundsteuer' }, { amountCents: -5000 }] as const) {
    assert.deepEqual(deductionPlan(repair({ spreadYears: 4, ...over }), { from: '2026-01-01' }), [{ outflowYear: 2026, years: [2026], of: 1, restYear: null, ignored: true }], JSON.stringify(over))
  }
  // Entnahme aus der Rücklage lässt sich verteilen.
  assert.deepEqual(deductionPlan(repair({ spreadYears: 2, category: 'Entnahme Erhaltungsrücklage' }), { from: '2026-01-01' })[0]?.years, [2026, 2027])
})

test('deductionPlan: das vorzeitige Ende (§ 82b Abs. 2) kürzt die Jahre; im ersten Jahr wird nicht verteilt, davor wirkt es nicht', () => {
  assert.deepEqual(deductionPlan(repair({ spreadYears: 5 }), { from: '2026-01-01' }, [], 2027), [{ outflowYear: 2026, years: [2026, 2027], of: 5, restYear: 2027 }])
  // Ende nach dem letzten Jahr: ohne Wirkung.
  assert.deepEqual(deductionPlan(repair({ spreadYears: 3 }), { from: '2026-01-01' }, [], 2030), [{ outflowYear: 2026, years: [2026, 2027, 2028], of: 3, restYear: null }])
  assert.deepEqual(deductionPlan(repair({ spreadYears: 3 }), { from: '2026-01-01' }, [], 2028)[0]?.restYear, null, 'Ende im letzten Jahr: nichts vorzeitig')
  // Ende im Jahr der Zahlung: nicht verteilt. Ein Ende davor wirkt auf diese Position nicht (Durchsicht S2: Aufwand nach
  // dem Ereignis, etwa der Erbin oder nach Wiedervermietung, verteilt normal).
  assert.deepEqual(deductionPlan(repair({ spreadYears: 3 }), { from: '2026-01-01' }, [], 2026), [{ outflowYear: 2026, years: [2026], of: 1, restYear: 2026 }])
  assert.deepEqual(deductionPlan(repair({ spreadYears: 3 }), { from: '2026-01-01' }, [], 2025), [{ outflowYear: 2026, years: [2026, 2027, 2028], of: 3, restYear: null }])
})

test('deductionPlan bricht bei mehreren Anteilen ab, wie paidWhollyIn (bis #292)', () => {
  // Mehrere Anteile liefert `outflowShares` erst mit #292; die Prüfung steht trotzdem, über die vorgegebenen Anteile: eine
  // Liste mit zwei Anteilen wird nicht still zur ersten.
  assert.throws(() => deductionPlan(repair({ spreadYears: 2 }), { from: '2026-01-01' }, [], null, [{ year: 2026, cents: 500_000, source: 'paid' }, { year: 2027, cents: 500_000, source: 'paid' }]), /mehreren Jahren/)
})

test('planRates: Raten nach spreadRates, mit vorzeitigem Ende trägt das letzte Jahr den Rest', () => {
  const plan = (over: Partial<Pick<CostItem, 'spreadYears'>>, rest: number | null = null) => deductionPlan(repair(over), { from: '2026-01-01' }, [], rest)[0] ?? assert.fail('kein Plan')
  assert.deepEqual(planRates(plan({ spreadYears: 3 }), 1_000_000), [{ year: 2026, cents: 333_334 }, { year: 2027, cents: 333_333 }, { year: 2028, cents: 333_333 }])
  assert.deepEqual(planRates(plan({}), 1_000_000), [{ year: 2026, cents: 1_000_000 }])
  assert.deepEqual(planRates(plan({ spreadYears: 5 }, 2027), 1_000_003), [{ year: 2026, cents: 200_001 }, { year: 2027, cents: 800_002, rest: true }])
  assert.deepEqual(planRates(plan({ spreadYears: 5 }, 2026), 1_000_003), [{ year: 2026, cents: 1_000_003 }])
})

// I-5 (#262 PR 2): Ohne Wahl ändert sich nichts, auch wenn jede Position das Feld leer trägt (`undefined` aus dem
// Formular, `null` aus einer Ablage von Hand); die Prüfsummen unten bleiben damit centgenau.
test('I-5: spreadYears leer (undefined oder null) an jeder Position ergibt dieselbe Steuerübersicht', () => {
  for (const seed of SEEDS.slice(0, 15)) {
    const { source } = randomTaxStock(makeRng(seed))
    // `null` kennt der Typ nicht; es kommt wie aus einer Ablage von Hand über JSON hinein.
    const variants: [string, TaxSource][] = [
      ['undefined', { ...source, costItems: source.costItems.map((c) => ({ ...c, spreadYears: undefined })) }],
      ['null', { ...source, costItems: source.costItems.map((c) => Object.assign({ ...c }, JSON.parse('{"spreadYears":null}'))) }],
    ]
    for (const [label, blank] of variants) {
      for (const year of TAX_STOCK_YEARS) assert.deepEqual(taxReportFor(blank, TAX_STOCK_PROPERTY, year), taxReportFor(source, TAX_STOCK_PROPERTY, year), `Startwert ${seed} ${year} (${label})`)
    }
  }
})

// Die Prüfsummen der heutigen Steuerübersicht je Startwert (Durchsicht K3, testing/taxGolden.ts).
const GOLDEN_FILE = new URL('./fixtures/tax-golden.json', import.meta.url)
const GOLDEN_WRITE = process.env.TAX_GOLDEN_WRITE === '1'
const golden: Record<string, string> = fs.existsSync(GOLDEN_FILE) ? JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')) : {}

// #267 (#255, PR 2): Ein Abzug beim Betriebsstrom steht im Steuerjahr seiner Stromrechnung, gleich welches Jahr er selbst
// trägt. Verglichen wird deshalb mit dem alten Weg auf dem Bestand, in dem der Abzug das Jahr seiner Rechnung trägt
// (`withDeductionsInBillYear`); trägt keiner ein anderes, ist das der Bestand selbst, und es bleibt alles, wie es war.
test('Invariante: ohne Zahlungsdatum je Steuerjahr dieselbe Steuerübersicht und dieselbe Auswahl im Steuer-ZIP wie vorher, der Abzug beim Betriebsstrom im Jahr seiner Stromrechnung', () => {
  const fails: string[] = []
  const modes = new Map<string, number>()
  const rulesSeen = new Set<string>()
  let compared = 0
  let twoProperties = 0
  let offBillYear = 0
  let goldenChecked = 0
  let acrossParts = 0
  for (const seed of SEEDS) {
    // Jeder zweite Bestand mit einem zweiten Objekt daneben (Durchsicht K4); geprüft werden dann beide.
    const single = randomTaxStock(makeRng(seed))
    const two = seed % 2 === 0
    const withB = two ? withSecondProperty(single, makeRng(seed * 31 + 3)) : null
    const g = withB ?? single
    if (deductionsOffBillYear(g.source) > 0) offBillYear++
    const prints: unknown[] = []
    if (two) twoProperties++
    modes.set(g.plantMode, (modes.get(g.plantMode) ?? 0) + 1)
    rulesSeen.add(JSON.stringify(g.rules))
    const objects: [string, BillingPeriod[]][] = [[TAX_STOCK_PROPERTY, g.periods], ...(withB ? [[TAX_STOCK_SECOND, withB.second.periods] as [string, BillingPeriod[]]] : [])]
    // Zufällige Zeiträume abgeschlossen, damit der eingefrorene Stand mitläuft.
    const closeRnd = makeRng(seed * 13 + 7)
    const closed = objects.flatMap(([pid, periods]) => periods.filter(() => closeRnd() < 0.3).flatMap((P) => {
      const s = outcome(() => computeSettlement(snapshotFor(g.source, pid, P)))
      if (!s.ok) return []
      const st: unknown = JSON.parse(JSON.stringify(s.value))
      return [{ period: P.key, propertyId: pid, sentAt: null, ...frozenSettlementOf(st), settlement: st }]
    }))
    const variants: [string, TaxSource][] = [['offen', g.source]]
    if (closed.length > 0) variants.push([`abgeschlossen ${closed.map((c) => `${c.propertyId}:${c.period}`).join('+')}`, { ...g.source, closedSettlements: closed } as TaxSource])
    for (const [label, source] of variants) {
      const expected = withDeductionsInBillYear(source)
      for (const [pid] of objects) {
        for (const year of TAX_STOCK_YEARS) {
          const at = `Startwert ${seed} (${pid}, ${g.plantMode}, ${JSON.stringify(g.rules)}, ${label}) ${year}`
          const before = outcome(() => oldTaxReportFor(expected, pid, year))
          const after = outcome(() => taxReportFor(source, pid, year))
          compared++
          // Durchsicht von PR 2, M1: Steht ein Abzug nicht im Teil seiner Heizposition, zählen hier nur die Beträge
          // (taxGolden.ts); den privaten Teil prüft die Invariante S1 über alle Jahre.
          const across = pairAcrossParts(expected, pid, year)
          if (across) acrossParts++
          const print = (r: TaxReport) => (across ? taxAmounts(r) : taxFingerprint(r))
          // Für die Prüfsumme: erzeugt auf dem Bestand mit dem Abzug im Jahr seiner Rechnung (siehe taxGolden.ts).
          const printed = GOLDEN_WRITE ? outcome(() => taxReportFor(expected, pid, year)) : after
          const zipFor = (s: TaxSource) => outcome(() => taxArchiveItems(narrowToProperty(s, pid).costItems, taxPartsFor(s, pid, year)).map((c) => c.id))
          prints.push([label, pid, year, printed.ok ? print(printed.value) : printed.error, zipFor(GOLDEN_WRITE ? expected : source)])
          try {
            if (across && after.ok && before.ok) assert.deepEqual(taxAmounts(after.value), taxAmounts(before.value))
            else assert.deepEqual(after, before)
          } catch {
            fails.push(`${at}: Steuerübersicht weicht ab`)
            continue
          }
          if (!after.ok) continue
          // Das zweite Objekt ändert am ersten nichts: dieselbe Übersicht wie im Bestand ohne es.
          if (two && label === 'offen' && pid === TAX_STOCK_PROPERTY) {
            try {
              assert.deepEqual(after, outcome(() => taxReportFor(single.source, pid, year)))
            } catch {
              fails.push(`${at}: zweites Objekt verändert das erste`)
            }
          }
          const stock = narrowToProperty(source, pid)
          if (after.value.expenses.items.some((i) => !i.operatingPowerBalance && !i.co2RefundPaidOut && !stock.costItems.some((c) => c.id === i.costItemId))) fails.push(`${at}: Position eines anderen Objekts`)
          const oldIds = oldArchiveIds(expected, pid, year)
          const newItems = taxArchiveItems(stock.costItems, taxPartsFor(source, pid, year))
          if (JSON.stringify(newItems.map((c) => c.id)) !== JSON.stringify(oldIds)) fails.push(`${at}: ZIP ${JSON.stringify(oldIds)} → ${JSON.stringify(newItems.map((c) => c.id))}`)
          // Die Übersicht.csv entsteht aus Auswahl und Steuerübersicht; mit beiden gleich ist sie es auch.
          const split = new Map(after.value.expenses.items.map((i) => [i.costItemId, i]))
          const csv = (ids: readonly string[]) => planTaxArchive(stock.costItems.filter((c) => ids.includes(c.id)) as CostItem[], new Map(), new Map(), split, derivedTaxLines(after.value)).overviewCsv
          if (csv(newItems.map((c) => c.id)) !== csv(oldIds)) fails.push(`${at}: Übersicht.csv weicht ab`)
        }
      }
    }
    const hash = sha256(prints)
    if (GOLDEN_WRITE) golden[String(seed)] = hash
    else if (Object.hasOwn(golden, String(seed))) {
      goldenChecked++
      if (golden[String(seed)] !== hash) fails.push(`Startwert ${seed}: Prüfsumme weicht von test/fixtures/tax-golden.json ab`)
    }
  }
  if (GOLDEN_WRITE) {
    fs.mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true })
    fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(Object.fromEntries(Object.entries(golden).sort(([a], [b]) => Number(a) - Number(b))), null, 1)}\n`)
  }
  assert.deepEqual(fails.slice(0, 20), [], `${fails.length} Befunde`)
  // Der Generator muss jede Lage erzeugen, sonst prüft die Invariante sie nicht.
  if (SEEDS.length >= 30) {
    for (const m of ['none', 'object', 'own', 'separate']) assert.ok((modes.get(m) ?? 0) > 0, `keine Bestände mit Anlage ${m}`)
    assert.ok(rulesSeen.size >= 5, `nur ${rulesSeen.size} Rhythmen`)
    assert.ok(twoProperties > 0, 'kein Bestand mit zwei Objekten')
    assert.ok(offBillYear > 0, 'kein Bestand mit einem Abzug in einem anderen Jahr als seine Stromrechnung (#267)')
    assert.ok(goldenChecked >= 30, `nur ${goldenChecked} Startwerte gegen die Prüfsummen geprüft`)
    // Die Ausnahme für den privaten Teil (M1) darf nicht zur Regel werden.
    assert.ok(acrossParts > 0 && acrossParts * 5 < compared, `Jahre mit Abzug außerhalb des Teils seiner Heizposition: ${acrossParts} von ${compared}`)
  }
  assert.ok(compared > 0)
})

// ---------- R-9: die Fälle des Mitwirkenden ohne Zahlungsdatum ----------

const MAI: PeriodRules = { startMonth: 5, changes: [] }
const haus = (rules: PeriodRules, costItems: Omit<TaxSource['costItems'][number], 'propertyId' | 'key' | 'category'>[]): TaxSource => ({
  properties: [{ id: TAX_STOCK_PROPERTY, kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: rules }],
  units: [
    { id: 'eg', propertyId: TAX_STOCK_PROPERTY, name: 'EG', areaM2: 50, participates: false, selfUsed: true },
    { id: 'og', propertyId: TAX_STOCK_PROPERTY, name: 'OG', areaM2: 50, participates: true },
  ],
  tenancies: [{ id: 't1', unitId: 'og', tenantName: 'A', persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }],
  costItems: costItems.map((c) => ({ ...c, propertyId: TAX_STOCK_PROPERTY, key: 'area' as const, category: 'Sach- und Haftpflichtversicherung' })),
  meters: [], readings: [], payments: [], closedSettlements: [],
} as TaxSource)
const inYear = (source: TaxSource, year: number): string[] => taxReportFor(source, TAX_STOCK_PROPERTY, year).expenses.items.map((i) => i.costItemId)
const inZip = (source: TaxSource, year: number): string[] =>
  taxArchiveItems(narrowToProperty(source, TAX_STOCK_PROPERTY).costItems, taxPartsFor(source, TAX_STOCK_PROPERTY, year)).map((c) => c.id)

test('R-9, Fall 1 (ohne Zahlungsdatum): Position der Abrechnung 2026, bezahlt 2027, steht ohne Zahlungsdatum in 2026', () => {
  // Mit „Bezahlt am“ im Jahr 2027 steht sie in 2027 und fehlt in 2026 (calc-steuer-zahlungsdatum.test.ts).
  const src = haus(CALENDAR_RULES, [{ id: 'vers', period: periodKey('2026-01'), description: 'Versicherung 2026', amountCents: 60000 }])
  assert.deepEqual(inYear(src, 2026), ['vers'])
  assert.deepEqual(inYear(src, 2027), [])
  assert.deepEqual(inZip(src, 2026), ['vers'])
  assert.deepEqual(inZip(src, 2027), [])
  const item = taxReportFor(src, TAX_STOCK_PROPERTY, 2026).expenses.items[0] ?? assert.fail('keine Position')
  assert.deepEqual([item.amountCents, item.privateCents, item.deductibleCents], [60000, 30000, 30000], 'privat nach der Abrechnung 2026')
})

test('R-9, Fall 2 (ohne Zahlungsdatum): Position, bezahlt vor Beginn ihres Zeitraums, steht ohne Zahlungsdatum im Jahr ihres Beginns', () => {
  // Versicherung 2026, bezahlt am 01.12.2025: mit „Bezahlt am“ 01.12.2025 steht sie in 2025 (calc-steuer-zahlungsdatum.test.ts).
  const src = haus(CALENDAR_RULES, [{ id: 'vers', period: periodKey('2026-01'), description: 'Versicherung 2026', amountCents: 60000 }])
  assert.deepEqual(inYear(src, 2025), [])
  assert.deepEqual(inYear(src, 2026), ['vers'])
})

test('R-9, Fall 3 (ohne Zahlungsdatum): Die Steuerübersicht findet eine Position über Abrechnungsjahre hinweg über ihr Jahr der Zahlung', () => {
  // Mai bis April: die Position des Zeitraums 2026/2027 mit Jahr der Zahlung 2027 steht in 2027, nicht in 2026, und
  // das Steuer-ZIP folgt ihr. PR 3 lässt das auch beim Kalenderobjekt zu und mit dem Zahlungsdatum statt des Jahres.
  const src = haus(MAI, [
    { id: 'nach', period: periodKey('2026-05'), description: 'Versicherung 2026/2027', amountCents: 60000, taxYear: 2027 },
    { id: 'gleich', period: periodKey('2026-05'), description: 'Grundsteuer 2026/2027', amountCents: 30000, taxYear: 2026 },
  ])
  assert.deepEqual(inYear(src, 2026), ['gleich'])
  assert.deepEqual(inYear(src, 2027), ['nach'])
  assert.deepEqual(inZip(src, 2026), ['gleich'])
  assert.deepEqual(inZip(src, 2027), ['nach'])
  const nach = taxReportFor(src, TAX_STOCK_PROPERTY, 2027).expenses.items[0] ?? assert.fail('keine Position')
  assert.equal(nach.privateCents, 30000, 'privat aus der Abrechnung 2026/2027, in der sie steht')
})

test('Teile für jedes Objekt: auch das Kalenderobjekt hat Teile, und dieselben Positionen wie die Abrechnung des Jahres', () => {
  const src = haus(CALENDAR_RULES, [
    { id: 'a', period: periodKey('2025-01'), description: 'a', amountCents: 1000 },
    { id: 'b', period: periodKey('2026-01'), description: 'b', amountCents: 2000 },
  ])
  const parts = taxPartsFor(src, TAX_STOCK_PROPERTY, 2026)
  assert.deepEqual(parts.map((p) => [p.snapshot.period.key, p.items.map((c) => c.id)]), [['2026-01', ['b']]])
})
