// Rechtswerte, die eine Behörde erst später veröffentlicht (Heizung PR 17, Entwurf 4.5), in den
// Einstellungen: der Stand in Worten, der Entwurf eines Eintrags und der Rumpf für den Server. Ohne DOM
// prüfbar; die Karte rendert nur.
import { fmtDate } from './api'
import { parseDecimal } from './co2Form'
import type { LawOverrideSlot } from './types'

const dec = (v: number): string => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Die Einheit der Werte, die sich eintragen lassen (kurz im Stand, lang am Feld). Beide überschreibbaren
// Werte sind Preise je Tonne CO₂ ohne Umsatzsteuer: § 3 Abs. 3 CO2KostAufG rechnet sie erst danach hinzu
// (Durchsicht von #246, R-K2). Ein neuer Parameter bekommt hier seine Einheit, sonst steht nur „Wert“ am Feld.
const UNITS: Record<string, { short: string; long: string }> = {
  'co2.price': { short: '€/t', long: '€ je Tonne CO₂ ohne Umsatzsteuer' },
  'co2.price-ets': { short: '€/t', long: '€ je Tonne CO₂ ohne Umsatzsteuer' },
}
export const unitOf = (s: Pick<LawOverrideSlot, 'paramId'>): string | null => UNITS[s.paramId]?.short ?? null

const withUnit = (s: LawOverrideSlot, v: number): string => (unitOf(s) ? `${dec(v)} ${unitOf(s)}` : dec(v))
const capitalized = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1)

export function statusText(s: LawOverrideSlot): string {
  const year = capitalized(s.yearLabel)
  if (s.status === 'superseded') return `${year}: amtlich ${withUnit(s, s.official ?? 0)}; Ihr Eintrag ${withUnit(s, s.override?.value ?? 0)} ist überholt`
  if (s.status === 'entered' && s.override) return `${year}: ${withUnit(s, s.override.value)} von Ihnen eingetragen am ${fmtDate(s.override.enteredAt)} (Quelle: ${s.override.source})`
  return `${year}: noch nicht veröffentlicht`
}

// Die Beschriftung des Felds: welches Jahr gemeint ist (R-W4) und in welcher Einheit.
export function fieldLabel(s: LawOverrideSlot): string {
  const unit = UNITS[s.paramId]?.long
  return unit ? `Wert ${s.yearLabel}, in ${unit}` : `Wert ${s.yearLabel}`
}

// Vor dem 1. Dezember des Vorjahres kann keiner der Werte veröffentlicht sein: den Preis gibt das
// Umweltbundesamt zehn Werktage vor Jahresbeginn bekannt (§ 4 Abs. 2 CO2KostAufG), den Durchschnitt der
// Versteigerungen eines Jahres nach ihrem Ende (§ 4 Abs. 3). Eintragen lässt Mietfuchs trotzdem, sagt es
// aber am Feld (Durchsicht von #246, R-K3).
export function earlyHint(s: LawOverrideSlot, today: string): string | null {
  if (s.status === 'superseded' || today >= `${s.year - 1}-12-01`) return null
  return `Dieser Wert kann heute noch nicht veröffentlicht sein: Das Umweltbundesamt gibt ihn frühestens im Dezember ${s.year - 1} bekannt. Tragen Sie nur die amtliche Bekanntmachung ein, keine Schätzung.`
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
