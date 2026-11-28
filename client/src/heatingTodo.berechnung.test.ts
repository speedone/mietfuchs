// „Was fehlt noch“ gegen die echte Berechnung (#690 Punkt 6): Die Liste ist keine zweite Regel neben der Abrechnung.
// Für Bestände der eigenen Heizkostenabrechnung rechnet dieser Test die Abrechnung mit `computeSettlement` und legt
// deren Hinweise und Ausweis in `selfTodos`. Verlangt wird je Fehler und Warnung zur Heizung (und je Hinweis, den die
// Tabelle als färbend führt): Er steht in seiner Zeile mit seinem Titel, wortgleich, und die Zeile ist nicht grün; hat
// er keine Zeile, zählt er unter den weiteren Hinweisen. „Alles erledigt“ steht nie neben einer Warnung. Ab zwei
// Anlagen (nebeneinander, Kesseltausch) je Anlage, und kein Fehler und keine Warnung der Heizung fällt bei allen heraus
// (Durchsicht M1).
import { describe, expect, it } from 'vitest'
import { extraNotices, lineOf, noticesOf, selfTodos, subjectPlants, todoSummary, type TodoNotice } from './heatingPageView'
import { todoRuleOf } from '../../shared/heatingTodo.ts'
import { noInfoView } from './testing/heatingView'
import type { CostItem, FuelDelivery, HeatingPeriodData, HeatingPeriodView, HeatingPlant, HeatingStatement, Meter, Notice, Reading, Tenancy, Unit } from './types'
import { periodKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'

// Berechnung und Testbestand des Servers, ohne dass die Typprüfung des Clients den Server mitprüft (dort fehlen die
// Typen von Node): Der Pfad steht in einer Variablen, also lädt vitest das Modul, tsc folgt ihm nicht. Die Gestalt,
// die der Test braucht, steht hier ausdrücklich, aus dem gemeinsamen Modell.
type SelfSnapshotOptions = {
  plant?: Partial<HeatingPlant>; plants?: HeatingPlant[]; row?: Partial<HeatingPeriodData>; rows?: HeatingPeriodData[]
  readings?: Reading[]; costItems?: CostItem[]; deliveries?: FuelDelivery[]; tenancies?: Tenancy[]; meters?: Meter[]
}
type Snapshot = {
  costItems: CostItem[]; units: Unit[]; tenancies: Pick<Tenancy, 'id' | 'unitId'>[]; meters: Meter[]
  heatingPlants?: HeatingPlant[]; heatingPeriodRows?: HeatingPeriodData[]
}
type Server = {
  computeSettlement: (s: Snapshot) => { notices: Notice[]; heating?: HeatingStatement[] }
  selfSnapshot: (o?: SelfSnapshotOptions) => Snapshot
  selfRow: (o?: Partial<HeatingPeriodData>, year?: number, plantId?: string) => HeatingPeriodData
  selfReadings: () => Reading[]
  selfDelivery: (o?: Partial<FuelDelivery>) => FuelDelivery
  selfTenancy: (id: string, unitId: string, start: string, end: string | null) => Tenancy
  selfMeters: () => Meter[]
  selfReading: (meterId: string, date: string, value: number) => Reading
}
const CALC = new URL('../../server/src/calc.ts', import.meta.url).href
const FIXTURES = new URL('../../server/testing/selfHeating.ts', import.meta.url).href
const server: Server = { ...(await import(/* @vite-ignore */ CALC)), ...(await import(/* @vite-ignore */ FIXTURES)) }
const { computeSettlement, selfDelivery, selfMeters, selfReading, selfReadings, selfRow, selfSnapshot, selfTenancy } = server

// Die Ansicht einer Heizperiode, wie sie die Seite lädt, aus demselben Bestand: Positionen der Anlage, Anteil, Erfassung.
function viewOf(plant: HeatingPlant, row: HeatingPeriodData, snapshot: Snapshot): HeatingPeriodView {
  const items = snapshot.costItems.filter((c) => c.heatingPlantId === plant.id)
  const share = row.heatConsumptionPct === null ? null : { heating: row.heatConsumptionPct, water: row.waterConsumptionPct, insulationRule: row.insulationRule ?? 'notApplies' }
  return {
    plantId: plant.id, period: row.period, label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
    hotWater: { dhwMethod: row.dhwMethod, dhwUnmeasurable: row.dhwUnmeasurable, dhwHeatKwh: row.dhwHeatKwh, totalHeatKwh: row.totalHeatKwh, dhwVolumeM3: row.dhwVolumeM3, dhwTempC: row.dhwTempC },
    hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 200 }, co2: null, stock: null,
    items: items.map((c) => ({ id: c.id, description: c.description, amountCents: c.amountCents, key: c.key, fuelDeliveryId: c.fuelDeliveryId ?? null })),
    distribution: share === null ? null : { own: share, effective: share, inherited: false, begun: true, first: true, forcedPercent: null },
    capture: plant.capture ?? 'heatMeter', selfHotWater: plant.hotWater ?? 'combined',
    ...noInfoView(),
  }
}

// Färbt der Hinweis nach der Tabelle seine Zeile? (Fehler, Warnung, oder ein Hinweis mit `hints`.)
const colours = (n: Notice): boolean => {
  const rule = todoRuleOf(n.code)
  return n.level !== 'hint' || ('step' in rule && rule.hints === true)
}

type Listed = { plantId: string; line: ReadonlySet<string>; steps: ReturnType<typeof selfTodos>; notices: TodoNotice[]; extra: number }
// Je Anlage die Liste, wie die Seite sie baut (Zuordnung über `subjectPlants`, fremde Positionen ausgenommen).
function lists(o: SelfSnapshotOptions): { all: Notice[]; listed: Listed[] } {
  const snapshot = selfSnapshot(o)
  const s = computeSettlement(snapshot)
  const plants = snapshot.heatingPlants ?? []
  const owner = subjectPlants({ plants, units: snapshot.units, meters: snapshot.meters, tenancies: snapshot.tenancies })
  const listed = plants.map((plant) => {
    const row = (snapshot.heatingPeriodRows ?? []).find((r) => r.plantId === plant.id) ?? selfRow(o.row)
    const view = viewOf(plant, row, snapshot)
    const foreignItems = new Set(snapshot.costItems.filter((c) => c.heatingPlantId !== plant.id).map((c) => c.id))
    const statement = s.heating?.find((h) => h.plantId === plant.id && h.period === view.period) ?? null
    const { line, host } = lineOf(plant, plants, view.to)
    const notices = noticesOf(s.notices, { plantId: plant.id, plants: plants.length, view, labels: [view.label], owner, foreignItems, line })
    const steps = selfTodos({ view, statement, notices, deliveries: 1, co2: true, host })
    return { plantId: plant.id, line, steps, notices, extra: extraNotices(notices) }
  })
  return { all: s.notices, listed }
}

function expectConsistent({ all, listed }: { all: Notice[]; listed: Listed[] }): void {
  for (const { plantId, line, steps, notices, extra } of listed) {
    // Nachprüfung M1: Trägt eine Anlage derselben Linie (Kesseltausch) eine Warnung oder einen Fehler der Heizung, ist
    // auch diese Anlage nicht „alles erledigt“.
    const lineWarns = all.some((n) => n.level !== 'hint' && n.subject?.kind === 'heatingCosts' && line.has(n.subject.id) && !('skip' in todoRuleOf(n.code)))
    if (lineWarns) expect(todoSummary(steps, extra), `${plantId}: Warnung bei der Partneranlage`).not.toMatch(/^Alle \d+ Punkte sind erledigt/)
    for (const n of notices.filter(colours)) {
      const rule = todoRuleOf(n.code)
      if (!('step' in rule)) continue
      if (rule.step === 'other' || n.loose === true) {
        if (n.level !== 'hint') expect(extra, `${plantId}: ${n.code} zählt als weiterer Hinweis`).toBeGreaterThan(0)
        continue
      }
      const row = steps.find((x) => x.id === rule.step)
      expect(row, `${plantId}: ${n.code}: Zeile „${rule.step}“ fehlt`).toBeDefined()
      expect(row?.light, `${plantId}: ${n.code}: Zeile „${rule.step}“ ist grün`).not.toBe('green')
      expect(row?.detail, `${plantId}: ${n.code}: Titel der Abrechnung in der Zeile`).toContain(`„${n.title}“`)
    }
    if (notices.some((n) => n.level !== 'hint')) expect(todoSummary(steps, extra), plantId).not.toMatch(/^Alle \d+ Punkte sind erledigt/)
  }
  // Kein Fehler und keine Warnung der Heizung fällt bei allen Anlagen heraus.
  const shown = new Set(listed.flatMap((l) => l.notices))
  const heating = all.filter((n) => n.level !== 'hint' && /^(heating|co2|fuel)\./.test(n.code) && !('skip' in todoRuleOf(n.code)))
  for (const n of heating) expect([...shown].some((x) => x.code === n.code && x.text === n.text), `${n.code} steht bei keiner Anlage`).toBe(true)
}

const CASES: Record<string, SelfSnapshotOptions> = {
  'erstes Jahr ohne Vergleichswert (Warnung nach § 6a)': {},
  'Vergleichswert und Steuern eingetragen': { row: { infoReferenceKwhPerM2: 120, infoReferenceSource: 'Energieagentur, Vergleichswerte 2025', infoTaxesText: 'Energiesteuer 312,00 €' } },
  'Endstände fehlen': { readings: selfReadings().filter((r) => r.date !== '2025-12-31') },
  'keine Kostenposition, nur die Lieferung': { costItems: [] },
  'kein Anteil nach Verbrauch': { row: { heatConsumptionPct: null, waterConsumptionPct: null } },
  'Anteil außerhalb der Grenzen (S5)': { row: { heatConsumptionPct: 95, waterConsumptionPct: 70 } },
  'Warmwasser ohne Verfahren': { row: { dhwMethod: null } },
  'Warmwasser getrennt': { plant: { hotWater: 'separate' }, row: { dhwMethod: null } },
}

// Zwei Anlagen nebeneinander (Haus A: Wohnungen a und b, Haus B: Wohnung c), mit einer Pauschale am Mieter in b und
// einem nicht fernablesbaren Wärmezähler in c: Hinweise an Mieter und Zähler.
const item = (id: string, plant: string, amountCents: number, extra: Partial<CostItem> = {}): CostItem => ({
  id, propertyId: 'objekt-1', period: periodKey('2025-01'), category: HEATING_CATEGORY, description: id, amountCents, key: 'heatingSystem',
  heatingPlantId: plant, heatingPart: 'fuel', heatingTarget: 'heating', ...extra,
})
const base = (): HeatingPlant => selfSnapshot().heatingPlants?.[0] ?? expect.unreachable('keine Anlage im Testbestand')
const twoPlants = (): SelfSnapshotOptions => ({
  plant: { name: 'Haus A', hotWater: 'none', units: [{ unitId: 'a', heatedAreaM2: null }, { unitId: 'b', heatedAreaM2: null }] },
  plants: [{ ...base(), id: 'hpB', name: 'Haus B', hotWater: 'none', units: [{ unitId: 'c', heatedAreaM2: null }] }],
  rows: [selfRow({}, 2025, 'hpB')],
  tenancies: [selfTenancy('A', 'a', '2020-01-01', null), { ...selfTenancy('B', 'b', '2020-01-01', null), heatingModel: 'flatRate' }, selfTenancy('C', 'c', '2020-01-01', null)],
  meters: selfMeters().map((m) => (m.id === 'wz-c' ? { ...m, remoteReadable: false, installedOn: '2023-01-01' } : m)),
  deliveries: [selfDelivery(), selfDelivery({ id: 'd2', plantId: 'hpB' })],
  costItems: [item('gasA', 'hp', 400000, { fuelDeliveryId: 'd1' }), item('gasB', 'hpB', 200000, { fuelDeliveryId: 'd2' })],
})
// Kesseltausch Öl zum 30.06.: Die neue Anlage übernimmt den Vorrat und hat in der Heizperiode keine eigene Position.
const swap = (): SelfSnapshotOptions => {
  const day = (d: string, v: [string, number][]) => v.map(([m, x]) => selfReading(m, d, x))
  return {
    plant: { energy: 'oil', endsOn: '2025-06-30', heatGeneration: 'single' },
    plants: [{ ...base(), id: 'hp2', energy: 'oil', replacesPlantId: 'hp', takesOverStock: true, heatGeneration: 'single', heatPumpMajority: null }],
    row: { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 190000, openingEmissionsKg: 5352.6, openingCo2Cents: 0, openingInvoicedBefore2023: true, openingAlreadySettled: false, closingQuantity: 1500, closingMeasuredOn: '2025-06-30' },
    rows: [selfRow({ stockUnit: 'l', closingQuantity: 500, closingMeasuredOn: '2025-12-31' }, 2025, 'hp2')],
    deliveries: [selfDelivery({ id: 'd1', label: 'Heizöl', invoiceFrom: null, invoiceTo: null, deliveredAt: '2025-03-15', invoiceDate: '2025-03-15', energyKwh: null, quantity: 3000, quantityUnit: 'l', heatingValue: 9.9, emissionsKg: 8028.9, co2CostCents: 52549 })],
    costItems: [item('oel', 'hp', 315000, { fuelDeliveryId: 'd1', heatingTarget: 'both' }), item('wartung', 'hp', 24000, { heatingPart: 'operating', heatingTarget: 'both' })],
    readings: [...selfReadings(), ...day('2025-06-30', [['wz-a', 9000], ['wz-b', 10000], ['wz-c', 6000], ['xw-a', 25], ['xw-b', 20], ['xw-c', 30], ['ww', 4500]])],
  }
}

describe('„Was fehlt noch“ folgt den Hinweisen der Berechnung', () => {
  for (const [name, o] of Object.entries(CASES)) it(name, () => expectConsistent(lists(o)))

  it('erstes Jahr ohne Vergleichswert: § 6a ist gelb und nennt den Titel der Warnung, die Liste ist nicht erledigt', () => {
    const { all, listed } = lists({})
    expect(all.some((n) => n.code === 'heating.info-incomplete' && n.level === 'warning')).toBe(true)
    const info = listed[0]?.steps.find((x) => x.id === 'info')
    expect(info?.light).toBe('yellow')
    expect(info?.detail).toMatch(/Vergleichswert eines Durchschnittsnutzers/)
  })

  it('S5: Anteil außerhalb der Grenzen ist nicht grün', () => {
    expect(lists(CASES['Anteil außerhalb der Grenzen (S5)'] ?? {}).listed[0]?.steps.find((x) => x.id === 'share')?.light).not.toBe('green')
  })

  it('M1: zwei Anlagen nebeneinander; Zähler- und Mieterhinweise bei ihrer Anlage, keiner fällt heraus', () => {
    const r = lists(twoPlants())
    expect(r.all.map((n) => n.code)).toEqual(expect.arrayContaining(['heating.flat-rate', 'heating.remote-reading-missing']))
    expectConsistent(r)
    const of = (plantId: string) => r.listed.find((l) => l.plantId === plantId)?.notices.map((n) => n.code) ?? []
    expect(of('hp')).toContain('heating.flat-rate')
    expect(of('hpB')).not.toContain('heating.flat-rate')
    expect(of('hpB')).toContain('heating.remote-reading-missing')
  })

  it('Nachprüfung M1: Kesseltausch mit vollständigen Ständen; die alte Anlage verweist bei § 6a auf die neue', () => {
    const r = lists(swap())
    expectConsistent(r)
    const old = r.listed.find((l) => l.plantId === 'hp')?.steps.find((x) => x.id === 'info')
    expect(old?.plant?.id).toBe('hp2')
  })

  it('M1 und K5: Kesseltausch; keiner fällt heraus, und die neue Anlage ohne eigene Position ist bei „Kosten“ nicht rot', () => {
    const r = lists(swap())
    expectConsistent(r)
    const costs = r.listed.find((l) => l.plantId === 'hp2')?.steps.find((x) => x.id === 'costs')
    expect(costs?.light).not.toBe('red')
    expect(r.listed.find((l) => l.plantId === 'hp')?.steps.find((x) => x.id === 'costs')?.light).not.toBe('red')
  })
})
