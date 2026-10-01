// Entscheidungslogik des Wohnungs-Formulars: Nutzungsart ↔ Datenmodell. Die beiden
// Kennzeichen `participates` und `selfUsed` werden immer gemeinsam geschrieben, damit keine
// widersprüchliche Kombination entstehen kann (siehe UnitUsage in types.ts).
import { parseNumberDe } from './numbers'
import type { MeterType, Unit, UnitUsage } from './types'
import { usageOf } from './types'

export type UnitForm = {
  id?: string
  name: string
  areaM2: string
  usage: UnitUsage
  selfPersons: string
  // Miteigentumsanteile (#94), für eine vermietete Eigentumswohnung
  mea: string
  // Zählertypen ohne Anschluss (#117), etwa Wasser bei einer Garage
  noConnection: MeterType[]
  rooms: string
  floor: string
  notes: string
}

export const EMPTY_UNIT_FORM: UnitForm = {
  name: '', areaM2: '', usage: 'vermietet', selfPersons: '', mea: '', noConnection: [], rooms: '', floor: '', notes: '',
}

const numStr = (n: number | undefined | null) => (n != null ? String(n).replace('.', ',') : '')

export function unitToForm(u: Unit): UnitForm {
  return {
    id: u.id,
    name: u.name,
    areaM2: numStr(u.areaM2),
    usage: usageOf(u),
    selfPersons: numStr(u.selfPersons),
    mea: numStr(u.mea),
    noConnection: u.noConnection ?? [],
    rooms: numStr(u.rooms),
    floor: u.floor ?? '',
    notes: u.notes ?? '',
  }
}

export type UnitBuildResult = { error: string } | { body: Record<string, unknown> }

// null statt undefined, damit geleerte Felder über die generische PUT-Route auch
// zurückgesetzt werden.
export function buildUnitBody(form: UnitForm): UnitBuildResult {
  // 0 m² ist erlaubt (#135): Eine Garage, ein Stellplatz oder ein Lager zählt beim
  // Flächenschlüssel dann nicht mit. Ein leeres Feld ist keine Angabe und bleibt ein Fehler.
  const area = parseNumberDe(form.areaM2) ?? NaN
  if (!form.name.trim() || !Number.isFinite(area) || area < 0) {
    return { error: 'Bitte Name und gültige Wohnfläche angeben (0 m² für Garage, Stellplatz oder Lager).' }
  }
  const rooms = form.rooms.trim() ? (parseNumberDe(form.rooms) ?? NaN) : null
  if (rooms !== null && (!Number.isFinite(rooms) || rooms <= 0)) {
    return { error: 'Zimmerzahl bitte als Zahl angeben (oder leer lassen).' }
  }
  const selfPersons = form.selfPersons.trim() ? (parseNumberDe(form.selfPersons) ?? NaN) : null
  if (form.usage === 'eigen' && selfPersons !== null && (!Number.isFinite(selfPersons) || selfPersons < 0)) {
    return { error: 'Personen im eigenen Haushalt bitte als Zahl angeben (oder leer lassen).' }
  }
  const mea = form.mea.trim() ? (parseNumberDe(form.mea) ?? NaN) : null
  if (mea !== null && (!Number.isFinite(mea) || mea < 0)) {
    return { error: 'Miteigentumsanteile bitte als Zahl angeben (oder leer lassen).' }
  }
  return {
    body: {
      name: form.name.trim(),
      areaM2: area,
      participates: form.usage === 'vermietet',
      selfUsed: form.usage === 'eigen',
      selfPersons: form.usage === 'eigen' ? selfPersons : null,
      mea,
      noConnection: form.noConnection,
      rooms,
      floor: form.floor.trim() || null,
      notes: form.notes.trim() || null,
    },
  }
}

// Einheiten der Abrechnung mit 0 m² (#135), nach derselben Unterscheidung wie calc.ts
// (`isGarageLike`): Wer weder Fläche noch Bewohner hat, ist Garage-artig, und die 0 ist eine
// Angabe (`zero`). Wohnt dort jemand, ist die Fläche vergessen (`missing`), und das Cockpit meldet
// es gelb wie vor #135. Die Personentage kommen aus der Abrechnung, bei der eigenen Wohnung aus
// der Personenzahl des eigenen Haushalts.
export function zeroAreaUnits(
  units: Unit[],
  statements: { unitId: string, personDays: number }[],
): { zero: Unit[], missing: Unit[] } {
  const withoutArea = units.filter((u) => usageOf(u) !== 'ausgenommen' && !u.areaM2)
  const inhabited = (u: Unit) => (usageOf(u) === 'eigen'
    ? (u.selfPersons ?? 0) > 0
    : statements.some((st) => st.unitId === u.id && st.personDays > 0))
  return { zero: withoutArea.filter((u) => !inhabited(u)), missing: withoutArea.filter(inhabited) }
}
