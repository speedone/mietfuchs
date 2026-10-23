// Das leere Ableseformular zum Ausdrucken (#320). Reine Anzeige: Gruppierung der Zähler, letzter Stand und
// Kennzeichnung der Eichfrist, ohne eigene Datenhaltung. Ein Feld „Einbauort“ gibt es am Zähler nicht, deshalb
// gilt `name` als Bezeichnung und Ort.
import type { HeatingPlant, Meter, Reading, Unit } from './types'
import { METER_TYPE_LABELS } from './types'

export type SheetOptions = {
  /** Fernablesbare Zähler (`remoteReadable`) aufführen. */
  remote: boolean
  /** Heizkostenverteiler aufführen. */
  hca: boolean
  /** Nur die Zähler dieser Wohnung (Mieterwechsel); `null` heißt das ganze Objekt. */
  unitId: string | null
}

export const DEFAULT_SHEET_OPTIONS: SheetOptions = { remote: true, hca: true, unitId: null }

export type CalibrationMark = { kind: 'overdue' | 'ending'; year: number }

/**
 * Die Eichfrist endet mit dem Ende des Jahres `calibratedUntil` (§ 34 Abs. 2 MessEV; das Feld ist das Ergebnis von
 * `calibrationEnd` in shared/calibration.ts und wird nicht noch einmal gerechnet). Abgelaufen: vor dem laufenden
 * Jahr. „Endet“: im laufenden oder im folgenden Jahr. Heizkostenverteiler sind nicht eichpflichtig.
 */
export function calibrationMark(meter: Pick<Meter, 'type' | 'calibratedUntil'>, year: number): CalibrationMark | null {
  const until = meter.calibratedUntil
  if (meter.type === 'hkv' || until === null || until === undefined) return null
  if (until < year) return { kind: 'overdue', year: until }
  if (until <= year + 1) return { kind: 'ending', year: until }
  return null
}

export type SheetRow = {
  id: string
  name: string
  meterNumber: string
  typeLabel: string
  unit: string
  last: { value: number; date: string } | null
  mark: CalibrationMark | null
}

export type SheetGroup = { key: string; title: string; rows: SheetRow[] }

export type ReadingSheet = { groups: SheetGroup[]; count: number }

/** Der jüngste Stand; bei gleichem Datum gilt der spätere in der Liste, wie die Berechnung ihn liest. */
function lastReading(meterId: string, readings: readonly Reading[]): SheetRow['last'] {
  let last: Reading | null = null
  for (const r of readings) if (r.meterId === meterId && (last === null || r.date >= last.date)) last = r
  return last === null ? null : { value: last.value, date: last.date }
}

/**
 * Ein Heizkostenverteiler gilt als ausgebaut, wenn in derselben Wohnung ein Nachfolger abgelesen wird: ein Gerät,
 * dessen Ablesungen alle nicht vor der letzten dieses Geräts liegen und von denen eine danach liegt. Sonst fehlt nur
 * eine Ablesung, das ist eine Lücke und kein Ausbau. Dieselbe Regel wie `inUseAt` in server/src/monthlyInfo.ts; ein
 * sicheres Merkmal „ausgebaut“ gibt es am Zähler nicht, bei anderen Zählern bleibt es deshalb bei der Liste.
 */
function isRemoved(m: Meter, all: readonly Meter[], readings: readonly Reading[]): boolean {
  if (m.type !== 'hkv' || m.unitId === null) return false
  const datesOf = (id: string) => readings.filter((r) => r.meterId === id).map((r) => r.date)
  const own = datesOf(m.id)
  if (own.length === 0) return false
  const last = own.reduce((a, d) => (d > a ? d : a))
  return all.some((x) => {
    if (x.id === m.id || x.unitId !== m.unitId || x.type !== 'hkv') return false
    const dates = datesOf(x.id)
    return dates.length > 0 && dates.every((d) => d >= last) && dates.some((d) => d > last)
  })
}

/** Die Wohnungen, an denen eigene Zähler hängen (ohne die der Heizanlage): nur für sie gibt es ein Blatt. */
export function unitsWithMeters(units: readonly Unit[], meters: readonly Meter[]): Unit[] {
  return units.filter((u) => meters.some((m) => m.unitId === u.id && !m.heatingPlantId))
}

export function buildReadingSheet(input: {
  meters: readonly Meter[]
  readings: readonly Reading[]
  units: readonly Unit[]
  plants: readonly HeatingPlant[]
  /** Heute (JJJJ-MM-TT): das laufende Jahr für die Eichfrist, Obergrenze der Stände, Betrieb der Anlagen. */
  today: string
  options: SheetOptions
}): ReadingSheet {
  const { options, today } = input
  const year = Number(today.slice(0, 4))
  // Stände nach heute sind kein „letzter Stand“.
  const readings = input.readings.filter((r) => r.date <= today)
  // Eine stillgelegte Anlage: Ihr letzter Betriebstag liegt vor heute (`endsOn`).
  const ended = new Set(input.plants.filter((p) => !!p.endsOn && p.endsOn < today).map((p) => p.id))
  const wanted = input.meters.filter((m) => {
    if (m.heatingPlantId && ended.has(m.heatingPlantId)) return false
    if (isRemoved(m, input.meters, readings)) return false
    if (options.unitId !== null && (m.unitId !== options.unitId || m.heatingPlantId)) return false
    if (!options.remote && m.remoteReadable === true) return false
    if (!options.hca && m.type === 'hkv') return false
    return true
  })
  const row = (m: Meter): SheetRow => ({
    id: m.id,
    name: m.name,
    meterNumber: m.meterNumber ?? '',
    typeLabel: METER_TYPE_LABELS[m.type],
    unit: m.unit,
    last: lastReading(m.id, readings),
    mark: calibrationMark(m, year),
  })
  const groups: SheetGroup[] = []
  const add = (key: string, title: string, list: Meter[]) => {
    if (list.length > 0) groups.push({ key, title, rows: list.map(row) })
  }
  const inPlant = (m: Meter) => !!m.heatingPlantId
  add('house', 'Hauptzähler (Haus)', wanted.filter((m) => m.unitId === null && !inPlant(m)))
  const known = new Set(input.units.map((u) => u.id))
  for (const u of input.units) add(`unit:${u.id}`, u.name, wanted.filter((m) => m.unitId === u.id && !inPlant(m)))
  add('unknown', 'Ohne bekannte Wohnung', wanted.filter((m) => m.unitId !== null && !known.has(m.unitId)))
  const plantIds = new Set(input.plants.map((p) => p.id))
  for (const p of input.plants) add(`plant:${p.id}`, `Heizanlage ${p.name}`, wanted.filter((m) => m.heatingPlantId === p.id && m.unitId === null))
  add('plant', 'Heizanlage', wanted.filter((m) => inPlant(m) && m.unitId === null && !plantIds.has(m.heatingPlantId ?? '')))
  return { groups, count: groups.reduce((n, g) => n + g.rows.length, 0) }
}

/** Heute als JJJJ-MM-TT nach der Ortszeit (nicht UTC), wie der Nutzer den Tag sieht. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
