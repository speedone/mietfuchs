// Seite „Heizkosten“ bei eigener Abrechnung (#690 Punkt 6): Untertitel passend zur Art der Abrechnung und die
// Liste „Was fehlt noch“ je Heizperiode. Die Liste folgt den Hinweisen der Abrechnung: Eine Zeile ist nur grün, wenn
// die Abrechnung zu ihrem Thema keinen Fehler und keine Warnung trägt (Durchsicht des Zweigs).
import { describe, expect, it } from 'vitest'
import { extraNotices, heatingSituation, heatingSubtitle, noticesOf, selfTodos, subjectPlants, todosFor, todoSummary } from './heatingPageView'
import { noInfoView } from './testing/heatingView'
import { periodKey } from '../../shared/period.ts'
import type { HeatingDistribution, HeatingPlant, HeatingInfoStatement, HeatingPeriodView, Notice, SelfBoundaryView, SelfHeatingStatement } from './types'

const distribution: HeatingDistribution = {
  own: { heating: 70, water: null, insulationRule: 'notApplies' }, effective: { heating: 70, water: null, insulationRule: 'notApplies' },
  inherited: false, begun: true, first: true, forcedPercent: null,
}
const view = (over: Partial<HeatingPeriodView> = {}): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null },
  hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2: null, stock: null,
  items: [{ id: 'i1', description: 'Erdgas', amountCents: 480000, key: 'heatingSystem', fuelDeliveryId: null }],
  distribution, capture: 'heatMeter', selfHotWater: 'none',
  ...noInfoView(),
  ...over,
})
const boundary = (over: Partial<SelfBoundaryView> = {}): SelfBoundaryView => ({ date: '2025-01-01', kind: 'start', status: 'read', offDays: 0, far: false, gap: null, ...over })
const self = (boundaries: SelfBoundaryView[], over: Partial<SelfHeatingStatement> = {}): SelfHeatingStatement => ({
  ok: true, capture: 'heatMeter', heatPump: null, changeSplit: 'degreeDays', areaBasisHeat: 'area', hotWater: 'none', alpha: null,
  shares: { heating: 70, water: null, forced: false, previous: null },
  pots: [{ pot: 'heating', costCents: 480000, consumptionPct: 70, byAreaOnly: false, areaM2: 270, consumption: 35400, consumptionUnit: 'kWh', baseCentsPerM2: 533, consumptionCentsPerUnit: 9.5 }],
  units: [{ unitId: 'u1', unitName: 'EG links', areaM2: 72, heatAreaM2: 72, readings: [], boundaries, users: [] }],
  ...over,
})
const info = (over: Partial<HeatingInfoStatement> = {}): HeatingInfoStatement => ({
  scope: 'full', carriers: [{ energy: 'gas', percent: 100 }], district: null, taxesText: 'Energiesteuer 312,00 €', meteringCents: null, comparisonSource: null,
  reference: { kwhPerM2: 120, source: 'Quelle' }, referenceComparable: true, contacts: [], contactsChecked: '2026-10-07',
  dispute: { kind: 'none' }, climate: { factor: null, factorPrev: null, source: null }, units: { heating: 'kWh', water: 'm³' }, users: [],
  missing: [], uncertain: [], comparisons: true, mixedGeneration: false, heatExempt: false,
  ...over,
})
const notice = (code: string, level: Notice['level'], title: string, over: Partial<Notice> = {}): Notice => ({ code, level, title, text: `Heizanlage, Heizperiode 2025: ${title}.`, subject: { kind: 'heatingCosts', id: 'hp' }, ...over })
const complete = { self: self([boundary(), boundary({ date: '2025-12-31', kind: 'end' })]), info: info() }
const lightOf = (steps: ReturnType<typeof selfTodos>, id: string) => steps.find((s) => s.id === id)?.light

describe('Untertitel der Seite Heizkosten', () => {
  const plant = (method: HeatingPlant['method'], supply: HeatingPlant['supply'] = 'central') => ({ method, supply })
  it('beim Messdienst bleibt der bisherige Satz, auch vor dem Laden (kein sichtbarer Wechsel)', () => {
    const service = 'Je Heizperiode die Angaben aus der Heizkostenabrechnung: CO₂-Kosten, Warmwasser und Lieferungen.'
    expect(heatingSubtitle([plant('service')])).toBe(service)
    expect(heatingSubtitle(null)).toBe(service)
  })
  it('bei eigener Abrechnung nennt er die eigene Abrechnung, nicht die des Messdienstes', () => {
    expect(heatingSubtitle([plant('self')])).toMatch(/Ihre eigene Heizkostenabrechnung/)
    expect(heatingSubtitle([plant('self')])).not.toMatch(/aus der Heizkostenabrechnung/)
  })
  it('bei freien Schlüsseln die Lieferungen und Angaben, ohne Messdienst', () => {
    expect(heatingSubtitle([plant('manual')])).toMatch(/Lieferungen/)
    expect(heatingSubtitle([plant('manual')])).not.toMatch(/aus der Heizkostenabrechnung/)
  })
  it('Etagenheizung: die Verordnung gilt nicht, also keine „Angaben zur Abrechnung“ und kein Messdienst', () => {
    const t = heatingSubtitle([plant('manual', 'perUnit')])
    expect(t).toMatch(/Lieferungen/)
    expect(t).not.toMatch(/Angaben zur Abrechnung|aus der Heizkostenabrechnung/)
    expect(heatingSituation(plant('manual', 'perUnit'))).toBe('perUnit')
    expect(heatingSituation(plant('manual'))).toBe('manual')
  })
  it('ohne Anlage und bei gemischten Anlagen ein Satz, der zu allen passt', () => {
    const neutral = heatingSubtitle([])
    expect(neutral).not.toMatch(/Messdienst|aus der Heizkostenabrechnung|eigene/)
    expect(heatingSubtitle([plant('self'), plant('service')])).toBe(neutral)
  })
})

describe('„Was fehlt noch“ je Lage (#719 baut darauf auf)', () => {
  it('nur die eigene Abrechnung hat bisher eine Liste; Messdienst, freie Schlüssel und Etagenheizung keine', () => {
    const input = { view: view(), statement: complete, notices: [], deliveries: 1, co2: true }
    expect(todosFor('self', input)).toEqual(selfTodos(input))
    for (const s of ['service', 'manual', 'perUnit'] as const) expect(todosFor(s, input)).toBeNull()
  })
})

describe('welche Hinweise der Abrechnung zu Anlage und Heizperiode gehören', () => {
  const v = view()
  it('mit Bezug auf die Anlage; die einer anderen Anlage nicht', () => {
    const all = [notice('co2.missing', 'warning', 'A'), notice('co2.missing', 'warning', 'B', { subject: { kind: 'heatingCosts', id: 'andere' } })]
    expect(noticesOf(all, { plantId: 'hp', plants: 2, view: v, labels: ['2025'] }).map((n) => n.title)).toEqual(['A'])
  })
  it('mit Bezug auf eine Position der Heizperiode', () => {
    const all = [notice('heating.target-invalid', 'error', 'Ziel', { subject: { kind: 'costItem', id: 'i1' } }), notice('heating.target-invalid', 'error', 'fremd', { subject: { kind: 'costItem', id: 'x' } })]
    expect(noticesOf(all, { plantId: 'hp', plants: 2, view: v, labels: ['2025'], foreignItems: new Set(['x']) }).map((n) => n.title)).toEqual(['Ziel'])
    // Ohne bekannte Anlage der fremden Position: weiterer Hinweis, nie still weg (Durchsicht M1).
    expect(noticesOf(all, { plantId: 'hp', plants: 2, view: v, labels: ['2025'] }).map((n) => [n.title, n.loose === true])).toEqual([['Ziel', false], ['fremd', true]])
  })
  it('bei einer einzigen Anlage auch Hinweise der Heizung mit anderem Bezug (Mieter, Wohnung), aber keine kalten', () => {
    const all = [notice('heating.info-open', 'hint', 'Angaben', { subject: { kind: 'tenancy', id: 't' } }), notice('key.changed-from-previous-year', 'hint', 'kalt', { subject: { kind: 'costItem', id: 'x' } })]
    expect(noticesOf(all, { plantId: 'hp', plants: 1, view: v, labels: ['2025'] }).map((n) => n.title)).toEqual(['Angaben'])
    // Ab zwei Anlagen ohne Zuordnung: bei jeder Anlage als weiterer Hinweis (Durchsicht M1).
    expect(noticesOf(all, { plantId: 'hp', plants: 2, view: v, labels: ['2025'] }).map((n) => [n.title, n.loose])).toEqual([['Angaben', true]])
  })
  it('nennt der Text eine andere Heizperiode der Anlage, gehört er dorthin', () => {
    const all = [notice('co2.missing', 'warning', 'A', { text: 'Heizanlage, Heizperiode 2024/2025: fehlt.' })]
    expect(noticesOf(all, { plantId: 'hp', plants: 1, view: v, labels: ['2025', '2024/2025'] })).toEqual([])
    expect(noticesOf(all, { plantId: 'hp', plants: 1, view: view({ label: '2024/2025' }), labels: ['2025', '2024/2025'] })).toHaveLength(1)
  })
  it('ausgenommene Codes zählen nie', () => {
    expect(noticesOf([notice('meter.rest-high', 'warning', 'Rest')], { plantId: 'hp', plants: 1, view: v, labels: ['2025'] })).toEqual([])
  })
})

describe('„Was fehlt noch“ bei eigener Abrechnung', () => {
  it('ohne Kosten, Anteil und Ausweis: nichts ist grün, und die Zeile „Ablesungen“ steht trotzdem', () => {
    const steps = selfTodos({ view: view({ items: [], distribution: null }), statement: null, notices: [], deliveries: 0, co2: true })
    expect(steps.map((s) => s.id)).toEqual(['costs', 'share', 'readings', 'distribution', 'co2', 'info'])
    expect(steps.every((s) => s.light !== 'green')).toBe(true)
    expect(steps[0]?.page).toBe('kosten')
    expect(steps[0]?.detail).toMatch(/Heizung und Warmwasser/)
  })
  it('laufendes Jahr ohne Kosten: der Fehler der Abrechnung zu fehlenden Ständen macht „Ablesungen“ rot', () => {
    const steps = selfTodos({ view: view({ items: [] }), statement: null, notices: [notice('heating.self-incomplete', 'error', 'Heizkostenabrechnung unvollständig')], deliveries: 0, co2: false })
    expect(lightOf(steps, 'readings')).toBe('red')
    expect(lightOf(steps, 'distribution')).toBe('red')
    expect(steps.find((s) => s.id === 'distribution')?.detail).toMatch(/Heizkostenabrechnung unvollständig/)
  })
  it('alles da und die Abrechnung meldet nichts: jede Zeile grün, dann und nur dann „alles erledigt“', () => {
    const steps = selfTodos({ view: view(), statement: complete, notices: [], deliveries: 1, co2: true })
    expect(steps.map((s) => [s.id, s.light])).toEqual([['costs', 'green'], ['share', 'green'], ['readings', 'green'], ['distribution', 'green'], ['co2', 'green'], ['info', 'green']])
    expect(todoSummary(steps, 0)).toMatch(/^Alle 6 Punkte sind erledigt/)
    // Ein weiterer Fehler oder eine Warnung der Abrechnung zur Heizung: nicht „alles erledigt“.
    expect(todoSummary(steps, 1)).not.toMatch(/Alle 6 Punkte sind erledigt/)
    expect(todoSummary(steps, 1)).toMatch(/einen weiteren Hinweis/)
  })
  it('Sollte 3: eine Lieferung ohne Kostenposition mit Betrag ist nicht „Kosten erfasst“', () => {
    const only = selfTodos({ view: view({ items: [] }), statement: null, notices: [], deliveries: 1, co2: false })[0]
    expect(only?.light).toBe('red')
    expect(only?.detail).toMatch(/Lieferung/)
    expect(selfTodos({ view: view({ items: [{ id: 'i', description: 'Gas', amountCents: 0, key: 'heatingSystem', fuelDeliveryId: 'd' }] }), statement: null, notices: [], deliveries: 1, co2: false })[0]?.light).toBe('red')
  })
  it('fehlende Ablesung: rot mit Zahl; nicht verteilbar: rot mit dem Weg zur Seite Abrechnung', () => {
    const steps = selfTodos({ view: view(), statement: { self: self([boundary(), boundary({ date: '2025-12-31', kind: 'end', status: 'missing' })], { ok: false }), info: info() }, notices: [], deliveries: 0, co2: false })
    const readings = steps.find((s) => s.id === 'readings')
    expect(readings?.light).toBe('red')
    expect(readings?.detail).toMatch(/^1 von 2 Ablesungen fehlt/)
    const dist = steps.find((s) => s.id === 'distribution')
    expect(dist?.light).toBe('red')
    expect(dist?.page).toBe('abrechnung')
    // Solange nicht verteilt wird, gilt auch § 6a nicht als geprüft.
    expect(lightOf(steps, 'info')).toBe('yellow')
    expect(todoSummary(steps, 0)).toBe('3 von 5 Punkten sind offen.')
  })
  it('daneben abgelesen ist gelb, kein Gerät angelegt rot', () => {
    const off = selfTodos({ view: view(), statement: { self: self([boundary({ status: 'off', offDays: 3 })]) }, notices: [], deliveries: 0, co2: false })
    expect(lightOf(off, 'readings')).toBe('yellow')
    const none = selfTodos({ view: view(), statement: { self: self([boundary({ noDevicePots: ['heating'] })]) }, notices: [], deliveries: 0, co2: false })
    expect(lightOf(none, 'readings')).toBe('red')
    expect(none.find((s) => s.id === 'readings')?.page).toBe('zaehler')
  })
  it('Muss 2: Warmwasser aus der Heizung: der Fehler der Abrechnung macht die Zeile rot, auch mit gewähltem Verfahren', () => {
    const chosen = view({ selfHotWater: 'combined', hotWater: { ...view().hotWater, dhwMethod: 'volumeFormula' }, distribution: { ...distribution, effective: { heating: 70, water: 70, insulationRule: 'notApplies' } } })
    const bad = selfTodos({ view: chosen, statement: { self: self([boundary()], { ok: false }) }, notices: [notice('heating.dhw-share-invalid', 'error', 'Warmwasseranteil nicht bestimmbar')], deliveries: 0, co2: false })
    expect(lightOf(bad, 'hotWater')).toBe('red')
    expect(bad.find((s) => s.id === 'hotWater')?.detail).toMatch(/Warmwasseranteil nicht bestimmbar/)
    expect(lightOf(selfTodos({ view: chosen, statement: complete, notices: [], deliveries: 0, co2: false }), 'hotWater')).toBe('green')
    // Ohne Ausweis der Abrechnung ist das gewählte Verfahren allein nicht „erledigt“.
    expect(lightOf(selfTodos({ view: chosen, statement: null, notices: [], deliveries: 0, co2: false }), 'hotWater')).toBe('yellow')
    expect(selfTodos({ view: view(), statement: null, notices: [], deliveries: 0, co2: false }).some((s) => s.id === 'hotWater')).toBe(false)
  })
  it('fehlender Anteil fürs Warmwasser macht den Anteil rot', () => {
    const steps = selfTodos({ view: view({ selfHotWater: 'separate' }), statement: null, notices: [], deliveries: 0, co2: false })
    expect(lightOf(steps, 'share')).toBe('red')
    expect(steps.find((s) => s.id === 'share')?.detail).toMatch(/Warmwasser/)
  })
  it('Muss 1: § 6a ist gelb, solange die Abrechnung dazu etwas meldet, auch nur als Hinweis mit „bis zu“', () => {
    // Heizkostenverteiler, alles eingetragen, Vergleich des Ablesedienstes nicht bestätigt: `missing` leer, `uncertain` Nr. 4.
    const open = selfTodos({
      view: view(), statement: { self: complete.self, info: info({ uncertain: ['4', '1c'] }) },
      notices: [notice('heating.info-open', 'hint', 'Angaben zur Heizkostenabrechnung prüfen')], deliveries: 0, co2: false,
    })
    const row = open.find((s) => s.id === 'info')
    expect(row?.light).toBe('yellow')
    expect(row?.detail).toMatch(/Vergleichswert eines Durchschnittsnutzers/)
    expect(row?.detail).toMatch(/Angaben zur Heizkostenabrechnung prüfen/)
    expect(todoSummary(open, 0)).not.toMatch(/erledigt/)
    const missing = selfTodos({ view: view(), statement: { self: complete.self, info: info({ missing: ['1b', '4'] }) }, notices: [notice('heating.info-incomplete', 'warning', 'Angaben zur Heizkostenabrechnung unvollständig')], deliveries: 0, co2: false }).find((s) => s.id === 'info')
    expect(missing?.light).toBe('yellow')
    expect(missing?.detail).toMatch(/Steuern, Abgaben und Zölle/)
    // Auch ohne Hinweis in der Hand (älterer Stand): was der Ausweis als fehlend oder offen nennt, ist nicht grün.
    expect(lightOf(selfTodos({ view: view(), statement: { self: complete.self, info: info({ uncertain: ['5'] }) }, notices: [], deliveries: 0, co2: false }), 'info')).toBe('yellow')
  })
  it('§ 6a: nur die Entgelte der Erfassung offen (keine Position „Messdienst, Ablesung, Geräte“) färbt nicht, der Hinweis nennt keine Kürzung', () => {
    const steps = selfTodos({
      view: view(), statement: { self: complete.self, info: info({ uncertain: ['1c'] }) },
      notices: [notice('heating.info-open', 'hint', 'Angaben zur Heizkostenabrechnung prüfen')], deliveries: 0, co2: false,
    })
    expect(lightOf(steps, 'info')).toBe('green')
    expect(steps.find((s) => s.id === 'info')?.detail).toMatch(/sind keine angefallen, ist nichts zu tun/)
    expect(todoSummary(steps, extraNotices([notice('heating.info-open', 'hint', 'x')]))).toMatch(/^Alle 5 Punkte sind erledigt/)
  })
  it('solange die Abrechnung nicht verteilt, sind CO₂ und § 6a nicht „erledigt“, auch wenn sie dazu nichts meldet', () => {
    const steps = selfTodos({ view: view(), statement: { self: self([boundary()], { ok: false }), info: info() }, notices: [], deliveries: 1, co2: true })
    expect(lightOf(steps, 'co2')).toBe('yellow')
    expect(lightOf(steps, 'info')).toBe('yellow')
  })
  it('Sollte 4: die Warnung zur CO₂-Aufteilung hat ihre Zeile', () => {
    const steps = selfTodos({ view: view(), statement: complete, notices: [notice('co2.missing', 'warning', 'CO₂-Kosten nicht aufgeteilt')], deliveries: 0, co2: true })
    expect(lightOf(steps, 'co2')).toBe('yellow')
    expect(steps.find((s) => s.id === 'co2')?.detail).toMatch(/CO₂-Kosten nicht aufgeteilt/)
    // Auch wo die Seite nicht nach CO₂ fragt: Meldet die Abrechnung etwas dazu, steht die Zeile.
    expect(lightOf(selfTodos({ view: view(), statement: complete, notices: [notice('co2.exceeds-heating', 'error', 'CO₂ höher')], deliveries: 0, co2: false }), 'co2')).toBe('red')
    expect(selfTodos({ view: view(), statement: complete, notices: [], deliveries: 0, co2: false }).some((s) => s.id === 'co2')).toBe(false)
  })
  it('ein Hinweis der Stufe „Hinweis“ färbt sonst nicht; eine Warnung zu den Kosten macht „Kosten“ gelb', () => {
    expect(lightOf(selfTodos({ view: view(), statement: complete, notices: [notice('fuel.share-by-degree-days', 'hint', 'Gradtage')], deliveries: 0, co2: false }), 'costs')).toBe('green')
    expect(lightOf(selfTodos({ view: view(), statement: complete, notices: [notice('fuel.uncovered', 'warning', 'Rechnung fehlt')], deliveries: 0, co2: false }), 'costs')).toBe('yellow')
  })
  it('weitere Hinweise ohne Zeile zählen nur als Fehler oder Warnung', () => {
    expect(extraNotices([notice('heating.remote-reading-missing', 'warning', 'x'), notice('heating.exemption', 'hint', 'y'), notice('heating.neu', 'error', 'z'), notice('co2.missing', 'warning', 'hat eine Zeile')])).toBe(2)
  })
  it('ohne Angaben nach § 6a im Ausweis (Ausnahme für Wärme und Warmwasser) keine Zeile dazu', () => {
    expect(selfTodos({ view: view(), statement: { self: complete.self }, notices: [], deliveries: 0, co2: false }).some((s) => s.id === 'info')).toBe(false)
  })
})

// ---------- Durchsicht des Zweigs (63f96fb1) ----------
describe('Durchsicht: mehrere Anlagen (M1)', () => {
  const v = view()
  const plants = [{ id: 'hp', units: [{ unitId: 'u1', heatedAreaM2: null }] }, { id: 'hp2', units: [{ unitId: 'u2', heatedAreaM2: null }] }]
  const owner = subjectPlants({
    plants, units: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }],
    meters: [{ id: 'm1', unitId: 'u1', heatingPlantId: null }, { id: 'm2', unitId: 'u2', heatingPlantId: null }, { id: 'mx', unitId: null, heatingPlantId: null }],
    tenancies: [{ id: 't1', unitId: 'u1' }, { id: 't3', unitId: 'u3' }],
  })
  const ctx = (plantId: string) => ({ plantId, plants: 2, view: v, labels: ['2025'], owner })
  it('ein Zählerhinweis gehört zur Anlage seines Zählers, bei der anderen zählt er nicht', () => {
    const n = notice('heating.remote-reading-missing', 'warning', 'Geräte nicht fernablesbar', { subject: { kind: 'meter', id: 'm2' } })
    expect(noticesOf([n], ctx('hp'))).toEqual([])
    expect(noticesOf([n], ctx('hp2'))).toHaveLength(1)
  })
  it('nicht zuordenbar (ohne Bezug, Mieter einer Wohnung ohne Anlage): bei jeder Anlage ein weiterer Hinweis, nie „alles erledigt“', () => {
    const loose = [notice('heating.flat-rate', 'warning', 'Pauschale', { subject: { kind: 'tenancy', id: 't3' } }), notice('heating.remote-reading-missing', 'warning', 'Fernablesung', { subject: undefined })]
    for (const id of ['hp', 'hp2']) {
      const mine = noticesOf(loose, ctx(id))
      expect(mine).toHaveLength(2)
      const steps = selfTodos({ view: v, statement: complete, notices: mine, deliveries: 1, co2: false })
      expect(steps.every((s) => s.light === 'green')).toBe(true)
      expect(extraNotices(mine)).toBe(2)
      expect(todoSummary(steps, extraNotices(mine))).not.toMatch(/^Alle/)
    }
  })
  it('ein Mieterhinweis einer Wohnung an genau dieser Anlage gehört zu ihr', () => {
    const n = notice('heating.flat-rate', 'warning', 'Pauschale', { subject: { kind: 'tenancy', id: 't1' } })
    expect(noticesOf([n], ctx('hp'))).toHaveLength(1)
    expect(noticesOf([n], ctx('hp2'))).toEqual([])
  })
})

describe('Durchsicht: Zeilen', () => {
  it('K5: ohne eigene Position, aber mit Kosten in der Verteilung (Kesseltausch, übernommener Vorrat) ist „Kosten“ nicht rot', () => {
    const steps = selfTodos({ view: view({ items: [] }), statement: complete, notices: [], deliveries: 0, co2: false })
    expect(lightOf(steps, 'costs')).toBe('green')
    expect(steps.find((s) => s.id === 'costs')?.detail).toMatch(/Wartung, Betriebsstrom und Zählermiete .*eigene Positionen/)
  })
  it('S5: „Anteil … außerhalb“ der Abrechnung macht die Zeile Anteil rot und nennt den Titel', () => {
    const n = notice('heating.share-invalid', 'error', 'Anteil nach Verbrauch ungültig', { text: 'Heizanlage, Heizperiode 2025: Der Anteil nach Verbrauch liegt außerhalb von 50 bis 70 %.' })
    const steps = selfTodos({ view: view(), statement: { self: self([boundary()], { ok: false }), info: info() }, notices: [n], deliveries: 1, co2: false })
    expect(lightOf(steps, 'share')).toBe('red')
    expect(steps.find((s) => s.id === 'share')?.detail).toMatch(/„Anteil nach Verbrauch ungültig“/)
    // Der Satz allein entscheidet nicht mehr: derselbe Wortlaut unter „unvollständig“ färbt die Zeile nicht.
    const other = notice('heating.self-incomplete', 'error', 'Heizkostenabrechnung unvollständig', { text: 'Heizanlage, Heizperiode 2025: Der Anteil nach Verbrauch liegt außerhalb von 50 bis 70 %.' })
    expect(lightOf(selfTodos({ view: view(), statement: { self: self([boundary()], { ok: false }), info: info() }, notices: [other], deliveries: 1, co2: false }), 'share')).toBe('green')
  })
  it('S2: Zeilen mit Karte auf dieser Seite springen zur Karte, Ablesungen zur Seite Zähler & Stände', () => {
    const n = (code: string, title: string) => notice(code, 'warning', title)
    const steps = selfTodos({
      view: view({ selfHotWater: 'combined', hotWater: { ...view().hotWater, dhwMethod: 'heatMeter' }, distribution: { ...distribution, effective: { heating: 70, water: 70, insulationRule: 'notApplies' } } }),
      statement: complete, notices: [n('heating.dhw-share-implausible', 'W'), n('heating.key-change', 'A'), n('heating.info-incomplete', 'I'), n('heating.reading-dates-differ', 'R')], deliveries: 1, co2: false,
    })
    expect(steps.find((s) => s.id === 'hotWater')).toMatchObject({ card: 'Warmwasser' })
    expect(steps.find((s) => s.id === 'share')).toMatchObject({ card: 'Anteil nach Verbrauch' })
    expect(steps.find((s) => s.id === 'info')).toMatchObject({ card: 'Angaben zur Abrechnung (§ 6a)' })
    for (const id of ['hotWater', 'share', 'info']) expect(steps.find((s) => s.id === id)?.page).toBeUndefined()
    expect(steps.find((s) => s.id === 'readings')?.page).toBe('zaehler')
  })
  it('S3: ohne Kosten nennt die Zeile die Reihenfolge: Lieferung hier, Position auf der Seite Kosten, Verknüpfung', () => {
    const d = selfTodos({ view: view({ items: [] }), statement: null, notices: [], deliveries: 0, co2: false })[0]?.detail ?? ''
    expect(d).toMatch(/„Lieferungen“/)
    expect(d).toMatch(/Seite Kosten/)
    expect(d).toMatch(/Welche Position gehört zu welcher Rechnung\?/)
    expect(d.indexOf('„Lieferungen“')).toBeLessThan(d.indexOf('Seite Kosten'))
  })
  it('S1: im ersten Jahr nennt § 6a, dass der Vorjahresvergleich (Nr. 5) offen bleibt', () => {
    const first = info({ missing: ['5'], users: [{ tenancyId: 't', label: 'A', days: 365, prevDays: null, heating: null, water: null, firstPeriod: false, prevUnknown: true, estimated: false, missing: ['5'], ghgKg: null }] as HeatingInfoStatement['users'] })
    const row = selfTodos({ view: view(), statement: { self: complete.self, info: first }, notices: [], deliveries: 1, co2: false }).find((s) => s.id === 'info')
    expect(row?.light).toBe('yellow')
    expect(row?.detail).toMatch(/Nr\. 5/)
    expect(row?.detail).toMatch(/früheren Messdienst/)
  })
  it('K1: getrennt abgerechnet hat die Liste keine roten Zeilen', () => {
    const steps = selfTodos({ view: view({ items: [], distribution: null }), statement: null, notices: [], deliveries: 0, co2: true, separate: true })
    expect(steps.some((s) => s.light === 'red')).toBe(false)
  })
})

describe('Nachprüfung: Kesseltausch, eine Linie (M1)', () => {
  const v = view()
  const warn = notice('heating.info-incomplete', 'warning', 'Angaben zur Heizkostenabrechnung unvollständig', { subject: { kind: 'heatingCosts', id: 'hp2' } })
  it('ein Hinweis an der Partneranlage derselben Linie zählt als weiterer Hinweis, an einer fremden Anlage nicht', () => {
    expect(noticesOf([warn], { plantId: 'hp', plants: 2, view: v, labels: ['2025'], line: new Set(['hp2']) }).map((n) => n.loose)).toEqual([true])
    expect(noticesOf([warn], { plantId: 'hp', plants: 2, view: v, labels: ['2025'] })).toEqual([])
  })
  it('die alte Anlage sagt bei § 6a, dass die Angaben bei der neuen stehen, mit Sprung dorthin, und ist nie „alles erledigt“', () => {
    const mine = noticesOf([warn], { plantId: 'hp', plants: 2, view: v, labels: ['2025'], line: new Set(['hp2']) })
    const steps = selfTodos({ view: v, statement: { self: complete.self }, notices: mine, deliveries: 1, co2: false, host: { id: 'hp2', name: 'neu' } })
    const info = steps.find((s) => s.id === 'info')
    expect(info).toMatchObject({ plant: { id: 'hp2' }, light: 'yellow' })
    expect(info?.detail).toMatch(/Heizanlage „neu“/)
    expect(info?.detail).toMatch(/„Angaben zur Heizkostenabrechnung unvollständig“/)
    expect(todoSummary(steps, extraNotices(mine))).not.toMatch(/^Alle/)
    // Ohne Meldung dort: grün, aber mit Verweis.
    const quiet = selfTodos({ view: v, statement: { self: complete.self }, notices: [], deliveries: 1, co2: false, host: { id: 'hp2', name: 'neu' } }).find((s) => s.id === 'info')
    expect(quiet).toMatchObject({ plant: { id: 'hp2' }, light: 'green' })
  })
})
