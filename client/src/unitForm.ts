// Entscheidungslogik des Wohnungs-Formulars: Nutzungsart ↔ Datenmodell. Die beiden
// Kennzeichen `participates` und `selfUsed` werden immer gemeinsam geschrieben, damit keine
// widersprüchliche Kombination entstehen kann (siehe UnitUsage in types.ts).
import type { Unit, UnitUsage } from './types'
import { usageOf } from './types'

export type UnitForm = {
  id?: string
  name: string
  areaM2: string
  usage: UnitUsage
  selfPersons: string
  rooms: string
  floor: string
  notes: string
}

export const EMPTY_UNIT_FORM: UnitForm = {
  name: '', areaM2: '', usage: 'vermietet', selfPersons: '', rooms: '', floor: '', notes: '',
}

const numStr = (n: number | undefined | null) => (n != null ? String(n).replace('.', ',') : '')

export function unitToForm(u: Unit): UnitForm {
  return {
    id: u.id,
    name: u.name,
    areaM2: numStr(u.areaM2),
    usage: usageOf(u),
    selfPersons: numStr(u.selfPersons),
    rooms: numStr(u.rooms),
    floor: u.floor ?? '',
    notes: u.notes ?? '',
  }
}

export type UnitBuildResult = { error: string } | { body: Record<string, unknown> }

// null statt undefined, damit geleerte Felder über die generische PUT-Route auch
// zurückgesetzt werden.
export function buildUnitBody(form: UnitForm): UnitBuildResult {
  const area = Number(form.areaM2.replace(',', '.'))
  if (!form.name.trim() || !Number.isFinite(area) || area <= 0) {
    return { error: 'Bitte Name und gültige Wohnfläche angeben.' }
  }
  const rooms = form.rooms.trim() ? Number(form.rooms.replace(',', '.')) : null
  if (rooms !== null && (!Number.isFinite(rooms) || rooms <= 0)) {
    return { error: 'Zimmerzahl bitte als Zahl angeben (oder leer lassen).' }
  }
  const selfPersons = form.selfPersons.trim() ? Number(form.selfPersons.replace(',', '.')) : null
  if (form.usage === 'eigen' && selfPersons !== null && (!Number.isFinite(selfPersons) || selfPersons < 0)) {
    return { error: 'Personen im eigenen Haushalt bitte als Zahl angeben (oder leer lassen).' }
  }
  return {
    body: {
      name: form.name.trim(),
      areaM2: area,
      participates: form.usage === 'vermietet',
      selfUsed: form.usage === 'eigen',
      selfPersons: form.usage === 'eigen' ? selfPersons : null,
      rooms,
      floor: form.floor.trim() || null,
      notes: form.notes.trim() || null,
    },
  }
}
