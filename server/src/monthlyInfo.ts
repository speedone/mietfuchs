// Monatliche Verbrauchsinformation (Heizung PR 22, § 6a Abs. 1 Nr. 2, Abs. 2 HeizkostenV). Reine Rechnung.
//
// Verbrauch entsteht nur aus erhobenen Werten: Ablesungen genau am Ende des Vormonats und am Ende des Monats
// (bei Ein- oder Auszug am Tag vor dem Einzug bzw. am Auszugstag). Nie interpoliert, nie geschätzt: Abs. 2
// Nr. 2 vergleicht nur, „soweit diese Daten erhoben worden sind“, und die Begründung beschränkt die
// Erhebung auf einmal im Monat (BR-Drs. 643/21, S. 18).
//
// Je Mieter: Wärme in kWh (Wärmezähler, gemessen), Warmwasser in m³ (gemessen) und in kWh, umgerechnet mit
// der Zahlenwertgleichung des § 9 Abs. 2 Satz 2 (angelehnt; die Gleichung bestimmt die Wärme der Anlage für
// ein Jahr und enthält die Verluste der Erzeugung, deshalb eine Auslegung), jede Größe für sich und ohne
// Summe, ohne die Faktoren des Satzes 6. Vormonat und Vorjahresmonat desselben Mietverhältnisses,
// Durchschnittsnutzer aus dem eingetragenen Vergleichswert, nie aus dem eigenen Haus (Begründung S. 19).
// Heizkostenverteiler ergeben keine kWh; eine Umrechnung kennt die Verordnung nicht.
//
// Die Geräte sind die der Linie (Kesseltausch): Die Information gilt dem Nutzer, nicht dem Kessel.
import type { HeatingPlant, MonthlyInfoAmounts, MonthlyInfoGap, MonthlyInfoMonth, MonthlyInfoRow, MonthlyInfoUser } from '../../shared/types.ts'
import { hkvDhwVolumeFormula, hkvMonthlyInfo } from '../../shared/law/heizkostenv.ts'
import { dayAfter, dayBefore, law, type LawLog } from '../../shared/law/register.ts'
import { addMonths, monthBounds, monthsBetween } from '../../shared/monthlyInfo.ts'
import { unitScale } from '../../shared/meterUnits.ts'
import { plantDevices, type RemoteMeter, type RemotePlant, type RemoteUnit } from './remoteReading.ts'
import type { SnapshotReading } from './snapshot.ts'

const byDate = (a: SnapshotReading, b: SnapshotReading): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

// Verbrauch zwischen zwei Tagesenden, nur aus Ablesungen genau an beiden; ein Zählerwechsel zählt über den
// Endstand des alten Geräts (wie meterSegments in calc.ts). Zwei Ablesungen am selben Tag sind
// widersprüchlich (#69), ein Wechsel ohne Endstand eine Lücke (#83): dann null.
export function exactConsumption(readings: readonly SnapshotReading[], startDay: string, endDay: string): number | null {
  const inside = readings.filter((x) => x.date >= startDay && x.date <= endDay).sort(byDate)
  const first = inside[0]
  const last = inside.at(-1)
  if (!first || !last || first.date !== startDay || last.date !== endDay) return null
  if (new Set(inside.map((x) => x.date)).size !== inside.length) return null
  let sum = 0
  for (let k = 1; k < inside.length; k++) {
    const a = inside[k - 1]
    const b = inside[k]
    if (!a || !b) return null
    if (b.replacement === true) {
      if (b.oldEndValue === undefined || b.oldEndValue === null) return null
      sum += b.oldEndValue - a.value
    } else sum += b.value - a.value
  }
  return sum
}

export type MonthlyInfoPlant = RemotePlant & Partial<Pick<HeatingPlant, 'endsOn' | 'replacesPlantId'>>
type Tenancy = { id: string; unitId: string; tenantName: string; start: string; end: string | null }
type InfoUnit = RemoteUnit & { name: string; areaM2: number }

// Die Anlage einer Linie, die an einem Tag heizt: nicht beendet und ihre Vorgängerin schon. Ohne Treffer null.
export function heatingPlantAt<P extends Pick<MonthlyInfoPlant, 'id' | 'endsOn' | 'replacesPlantId'>>(plants: readonly P[], day: string): P | null {
  return plants.find((p) => {
    if (p.endsOn && p.endsOn < day) return false
    const before = p.replacesPlantId ? plants.find((x) => x.id === p.replacesPlantId) : undefined
    return !before || (before.endsOn !== null && before.endsOn !== undefined && before.endsOn < day)
  }) ?? null
}

// `plants`: die Anlagen der Linie in dieser Heizperiode; `rows`: die Zeilen der Linie. `parts`: welche Geräte
// zählen. Ist nach § 11 nur die Wärme ausgenommen, gilt § 6a nur für das Warmwasser (`heat: false`); ohne
// Warmwasser an der Anlage zählt nur die Wärme. `asOf`: Stichtag; ohne ihn ist jeder Monat fällig.
export type MonthlyInfoInput = {
  plants: readonly MonthlyInfoPlant[]
  meters: readonly RemoteMeter[]
  units: readonly InfoUnit[]
  tenancies: readonly Tenancy[]
  readings: readonly SnapshotReading[]
  rows: readonly MonthlyInfoRow[]
  dhwTempC: number | null
  h: { from: string; to: string }
  parts: { heat: boolean; water: boolean }
  asOf?: string
}

const daysOf = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1

// Die Tage eines Mietverhältnisses in einem Monat, oder null.
function sliceOf(t: Tenancy, month: string): { from: string; to: string } | null {
  const b = monthBounds(month)
  const from = t.start > b.from ? t.start : b.from
  const to = t.end !== null && t.end < b.to ? t.end : b.to
  return from <= to ? { from, to } : null
}

type Measured = MonthlyInfoAmounts & { gaps: MonthlyInfoGap[] }

// Was die Geräte einer Wohnung zwischen zwei Tagesenden gemessen haben. Fehlt einem Gerät einer Größe der
// Wert, fehlt die ganze Größe: Ein halber Verbrauch sähe aus wie ein ganzer.
//
// Gemessen wird mit den Geräten, die in diesem Fenster messen, nicht mit denen des Monats, für den die
// Information gilt (Durchsicht S1): Für den Vormonat und den Vorjahresmonat zählt der Zähler, der damals hing.
// Ein Wechsel auf einen neuen Zähler (kein `replacement` am selben Zähler) ist eine Kette (Durchsicht M1): Der
// alte misst bis zu seiner letzten Ablesung, der neue ab seiner ersten, am selben Tag oder am Folgetag; fehlt
// dazwischen ein Tag, ist es eine Lücke. Ein Gerät, das erst am Ende des Fensters abgelesen wird, misst darin
// nichts, ebenso eines, das am Anfang zum letzten Mal abgelesen und danach ersetzt ist.
function measure(unitDevices: readonly RemoteMeter[], readings: readonly SnapshotReading[], startDay: string, endDay: string, dhw: () => { factor: number; gap: boolean }): Measured {
  const gaps = new Set<MonthlyInfoGap>()
  const datesOf = (id: string): string[] => readings.filter((x) => x.meterId === id && x.date >= startDay && x.date <= endDay).map((x) => x.date).sort()
  const devices = unitDevices.filter((d) => !(d.installedOn && d.installedOn > endDay) && (datesOf(d.id).length > 0 || inUseAt(d, unitDevices, readings, endDay)))
  const sumOf = (list: readonly RemoteMeter[]): number | null => {
    if (list.length === 0) return null
    let sum = 0
    let ok = true
    let measured = 0
    const fail = (g: MonthlyInfoGap): void => {
      gaps.add(g)
      ok = false
    }
    // In kWh bzw. m³ (#342, Durchsicht E3): ein Zähler in MWh oder Litern wird umgerechnet. Die Geräte sind schon die
    // dieses Fensters. Eine unbekannte Einheit rechnet mit Faktor 1 wie bisher; die Abrechnung warnt (`meter.unit-unknown`).
    const scale = unitScale(list, 'base')
    const add = (v: number | null, id: string): void => {
      measured++
      if (v === null) fail('noReading')
      else if (v < 0) fail('negative')
      else sum += v * scale.factorOf(id)
    }
    const parts: { id: string; first: string; last: string }[] = []
    for (const d of list) {
      const dates = datesOf(d.id)
      const first = dates[0]
      const last = dates.at(-1)
      if (first === undefined || last === undefined) {
        fail('noReading')
        continue
      }
      const own = readings.filter((x) => x.meterId === d.id)
      if (first === startDay && last === endDay) add(exactConsumption(own, startDay, endDay), d.id)
      // Neu und erst am Ende abgelesen: misst in diesem Fenster nichts. Hat es schon vorher Stände, fehlt der am Anfang.
      else if (first === endDay && !own.some((x) => x.date < endDay)) continue
      else if (last === startDay && !inUseAt(d, unitDevices, readings, endDay)) continue
      else parts.push({ id: d.id, first, last })
    }
    // Ketten von Geräten, die einander ablösen, vom Anfang bis zum Ende des Fensters.
    const open = [...parts]
    while (ok && open.length > 0) {
      const begin = open.findIndex((p) => p.first === startDay)
      if (begin < 0) {
        fail('noReading')
        break
      }
      let [p] = open.splice(begin, 1)
      while (ok && p) {
        add(exactConsumption(readings.filter((x) => x.meterId === p?.id), p.first, p.last), p.id)
        if (p.last === endDay) break
        const prev = p
        const next = open.findIndex((q) => q.first === prev.last || q.first === dayAfter(prev.last))
        if (next < 0) {
          fail('noReading')
          break
        }
        ;[p] = open.splice(next, 1)
      }
    }
    // Hat kein Gerät etwas gemessen, ist nichts erhoben, auch nicht 0.
    if (ok && measured === 0) fail('noReading')
    // Auf drei Stellen (Wh bzw. Liter), sonst stünde 699,9999… kWh auf dem Blatt; immer gleich gerundet (Durchsicht K3).
    return ok ? Math.round(sum * 1000) / 1000 : null
  }
  const hca = devices.filter((d) => d.type === 'hkv')
  if (hca.length > 0) gaps.add('hca')
  const heat = hca.length > 0 ? null : sumOf(devices.filter((d) => d.type === 'waerme'))
  const m3 = sumOf(devices.filter((d) => d.type === 'warmwasser'))
  let dhwKwh: number | null = null
  if (m3 !== null) {
    const f = dhw()
    if (f.gap) gaps.add('dhwTemp')
    else dhwKwh = Math.round(f.factor * m3 * 1000) / 1000
  }
  return { heatKwh: heat, dhwM3: m3, dhwKwh, gaps: [...gaps] }
}

const kindOf = (d: RemoteMeter): 'water' | 'heat' => (d.type === 'warmwasser' ? 'water' : 'heat')

// Ist ein Gerät am Ende eines Monats in Betrieb (Prüfung M5, wie `deviceInUse` in calc.ts)? Eingebaut
// (`installedOn`; ohne Datum immer), und seine Ablesungen reichen bis zu diesem Tag, oder es hat keine. Enden
// sie davor, ist es ausgebaut, wenn in derselben Wohnung ein Nachfolger derselben Größe abgelesen wird, also
// ein Gerät, dessen erste Ablesung nicht vor der letzten dieses Geräts liegt. Sonst fehlt nur die Ablesung;
// das ist eine Lücke und kein Ausbau, auch neben einem zweiten Gerät, das zugleich läuft.
function inUseAt(d: RemoteMeter, devices: readonly RemoteMeter[], readings: readonly SnapshotReading[], day: string): boolean {
  if (d.installedOn && d.installedOn > day) return false
  const datesOf = (id: string): string[] => readings.filter((x) => x.meterId === id).map((x) => x.date)
  const own = datesOf(d.id)
  if (own.length === 0) return true
  const last = own.reduce((a, x) => (x > a ? x : a))
  if (last >= day) return true
  return !devices.some((x) => {
    if (x.id === d.id || x.unitId !== d.unitId || kindOf(x) !== kindOf(d)) return false
    const dates = datesOf(x.id)
    return dates.length > 0 && dates.every((date) => date >= last) && dates.some((date) => date > last)
  })
}

// Die Monate einer Heizperiode, für die die Information geschuldet ist: ab dem Beginn der Pflicht
// (`hkv.monthly-info`), in denen am Monatsende ein fernablesbares Gerät einer Wohnung in Betrieb war.
export function monthlyInfoMonths(i: MonthlyInfoInput, log: LawLog): MonthlyInfoMonth[] {
  const duty = law(hkvMonthlyInfo, { period: i.h }, log)
  if (duty.coverage === 'none') return []
  const startsAt = duty.validFrom ?? i.h.from
  const seen = new Set<string>()
  const all = i.plants.flatMap((p) => plantDevices(p, i.meters, i.units)).filter((m) => {
    if (m.unitId === null || m.unitId === undefined || seen.has(m.id)) return false
    seen.add(m.id)
    return m.type === 'warmwasser' ? i.parts.water : i.parts.heat
  })
  // Die Umrechnung des Warmwassers: erst fragen, wenn Warmwasser gemessen ist, sonst stünde die Formel im
  // Rechtsstand jeder Abrechnung (Entwurf 1.2 Nr. 1).
  let factor: { factor: number; gap: boolean } | null = null
  const dhw = (): { factor: number; gap: boolean } => {
    if (factor) return factor
    const f = law(hkvDhwVolumeFormula, { period: i.h }, log)
    const t = i.dhwTempC
    factor = t === null || !(t > f.coldWaterC) ? { factor: 0, gap: true } : { factor: f.effort * (t - f.coldWaterC), gap: false }
    return factor
  }
  const asOfMonth = i.asOf?.slice(0, 7)
  const months: MonthlyInfoMonth[] = []
  for (const month of monthsBetween(i.h.from, i.h.to)) {
    const bounds = monthBounds(month)
    if (bounds.to < startsAt) continue
    const running = all.filter((m) => inUseAt(m, all, i.readings, bounds.to))
    if (!running.some((m) => m.remoteReadable === true)) continue
    const host = heatingPlantAt(i.plants, bounds.to)
    const ofMonth = i.rows.filter((x) => x.month === month)
    const row = ofMonth.find((x) => x.plantId === host?.id) ?? ofMonth[0] ?? null
    const users: MonthlyInfoUser[] = []
    for (const unit of i.units) {
      const devices = running.filter((m) => m.unitId === unit.id)
      if (devices.length === 0) continue
      // Gemessen wird mit allen Geräten der Wohnung; welche im Fenster messen, entscheidet `measure`.
      const unitDevices = all.filter((m) => m.unitId === unit.id)
      for (const t of i.tenancies.filter((x) => x.unitId === unit.id)) {
        const slice = sliceOf(t, month)
        if (!slice) continue
        const now = measure(unitDevices, i.readings, dayBefore(slice.from), slice.to, dhw)
        // Vormonat und Vorjahresmonat: nur desselben Mietverhältnisses und nur, soweit erhoben; je Größe für sich.
        const earlier = (m: string): MonthlyInfoAmounts | null => {
          const s = sliceOf(t, m)
          if (!s) return null
          const e = measure(unitDevices, i.readings, dayBefore(s.from), s.to, dhw)
          return e.heatKwh === null && e.dhwM3 === null ? null : { heatKwh: e.heatKwh, dhwM3: e.dhwM3, dhwKwh: e.dhwKwh }
        }
        const ref = row?.referenceKwhPerM2 ?? null
        const referenceKwh = ref === null ? null : Math.round(ref * unit.areaM2 * (daysOf(slice.from, slice.to) / daysOf(bounds.from, bounds.to)) * 100) / 100
        users.push({
          tenancyId: t.id, tenantName: t.tenantName, unitName: unit.name, areaM2: unit.areaM2, from: slice.from, to: slice.to,
          // Für die Kürzung: Ist die Wohnung selbst ganz fernablesbar ausgestattet (Prüfung S7)?
          remote: devices.every((d) => d.remoteReadable === true),
          heatKwh: now.heatKwh, dhwM3: now.dhwM3, dhwKwh: now.dhwKwh,
          previousMonth: earlier(addMonths(month, -1)), previousYear: earlier(addMonths(month, -12)),
          referenceKwh,
          gaps: [...now.gaps, ...(referenceKwh === null ? (['reference'] as const) : [])],
        })
      }
    }
    months.push({
      month,
      due: asOfMonth === undefined || month < asOfMonth,
      row,
      users,
      complete: users.every((u) => u.gaps.length === 0),
      sent: (row?.sentOn ?? null) !== null,
      mixed: running.some((m) => m.remoteReadable !== true),
    })
  }
  return months
}

export type OpenMonth = { month: string; tenancyIds: string[]; notSent: boolean; gaps: MonthlyInfoGap[] }

// Die fälligen Monate, deren Information fehlt (nicht als mitgeteilt vermerkt) oder unvollständig ist, mit
// den betroffenen Mietverhältnissen. Ein Monat ohne Mieter braucht keine Mitteilung.
export function openMonths(months: readonly MonthlyInfoMonth[]): OpenMonth[] {
  return months
    .filter((m) => m.due && m.users.length > 0 && (!m.sent || !m.complete))
    .map((m) => ({
      month: m.month,
      tenancyIds: [...new Set(m.users.filter((u) => !m.sent || u.gaps.length > 0).map((u) => u.tenancyId))],
      notSent: !m.sent,
      gaps: [...new Set(m.users.flatMap((u) => u.gaps))],
    }))
}
