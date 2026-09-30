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
  // Miteigentumsanteile (#94), für eine vermietete Eigentumswohnung
  mea: string
  rooms: string
  floor: string
  notes: string
}

export const EMPTY_UNIT_FORM: UnitForm = {
  name: '', areaM2: '', usage: 'vermietet', selfPersons: '', mea: '', rooms: '', floor: '', notes: '',
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
    rooms: numStr(u.rooms),
    floor: u.floor ?? '',
    notes: u.notes ?? '',
  }
}

// Eine Zahl, wie sie Menschen in Deutschland eintippen (#105): Komma für Nachkommastellen, ein
// Punkt vor genau drei Ziffern trennt Tausender, ein Punkt vor einer oder zwei Ziffern ist ein
// Dezimalpunkt in technischer Schreibweise. Vorher las das Formular „78.43“ Miteigentumsanteile als
// 7843 und „1.200“ m² als 1,2; beides verschiebt eine Verteilung.
export function parseNumberDe(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '')
  if (!t) return null
  let normalized: string
  if (t.includes(',')) normalized = t.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) normalized = t.replace(/\./g, '')
  else normalized = t
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

export type UnitBuildResult = { error: string } | { body: Record<string, unknown> }

// null statt undefined, damit geleerte Felder über die generische PUT-Route auch
// zurückgesetzt werden.
export function buildUnitBody(form: UnitForm): UnitBuildResult {
  const area = parseNumberDe(form.areaM2) ?? NaN
  if (!form.name.trim() || !Number.isFinite(area) || area <= 0) {
    return { error: 'Bitte Name und gültige Wohnfläche angeben.' }
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
      rooms,
      floor: form.floor.trim() || null,
      notes: form.notes.trim() || null,
    },
  }
}
