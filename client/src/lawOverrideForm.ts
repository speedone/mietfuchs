// Rechtswerte, die eine Behörde erst später veröffentlicht (Heizung PR 17, Entwurf 4.5), in den
// Einstellungen: der Stand in Worten, der Entwurf eines Eintrags und der Rumpf für den Server. Ohne DOM
// prüfbar; die Karte rendert nur.
import { fmtDate } from './api'
import { parseDecimal } from './co2Form'
import type { LawOverrideSlot } from './types'

const dec = (v: number): string => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Die Einheit der Werte, die sich eintragen lassen. Beide überschreibbaren Werte sind Preise je Tonne CO₂;
// ein neuer Parameter bekommt hier seine Einheit, sonst steht nur „Wert“ am Feld.
const UNITS: Record<string, string> = { 'co2.price': '€ je Tonne CO₂', 'co2.price-ets': '€ je Tonne CO₂' }
export const unitOf = (s: Pick<LawOverrideSlot, 'paramId'>): string | null => UNITS[s.paramId] ?? null

export function statusText(s: LawOverrideSlot): string {
  if (s.status === 'superseded') return `${s.year}: amtlich ${dec(s.official ?? 0)}; Ihr Eintrag ${dec(s.override?.value ?? 0)} ist überholt`
  if (s.status === 'entered' && s.override) return `${s.year}: ${dec(s.override.value)} von Ihnen eingetragen am ${fmtDate(s.override.enteredAt)} (Quelle: ${s.override.source})`
  return `${s.year}: noch nicht veröffentlicht`
}

export type OverrideDraft = { value: string; source: string }
export const draftOf = (s: LawOverrideSlot): OverrideDraft =>
  s.override ? { value: dec(s.override.value), source: s.override.source } : { value: '', source: '' }

export function overrideBody(d: OverrideDraft): { body: { value: number; source: string } } | { error: string } {
  const value = parseDecimal(d.value)
  if (value === null || !(value > 0)) return { error: 'Bitte geben Sie den Wert als Zahl an, etwa 64,20.' }
  if (d.source.trim() === '') return { error: 'Bitte nennen Sie die Quelle, etwa „UBA, Bekanntmachung vom …“.' }
  return { body: { value, source: d.source.trim() } }
}
