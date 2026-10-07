// Formularlogik zu Heizkostenverteilern und Ablesedienst (Heizung PR 12, Entwurf 8.1), ohne DOM
// (hcaForm.test.ts).
import type { CaptureMethod, HcaScale, HeatingServiceValue, Meter, MeterType, ServiceHeatUnit } from './types'
import { ambiguousText, ambiguousThousands, parseNumberDe } from './numbers'
import { hkvCutRemoteReading, hkvRemoteReadingRetrofit } from '../../shared/law/heizkostenv.ts'
import { dayBefore, germanDate, LAW_AS_OF, onlyVersion, valueAt } from '../../shared/law/register.ts'

// Frist für nicht fernablesbare Geräte (§ 5 Abs. 3 HeizkostenV) und die Kürzung danach (§ 12 Abs. 1 Satz 2),
// aus dem Register.
const RETROFIT_LAST_DAY = germanDate(dayBefore(onlyVersion(hkvRemoteReadingRetrofit).validFrom ?? ''))
const REMOTE_CUT = valueAt(hkvCutRemoteReading, LAW_AS_OF)
// Verdunster sind nicht aus der Ferne ablesbar (Durchsicht von #241, Recht-I6).
export const EVAPORATOR_DEADLINE = `Verdunster lassen sich nicht aus der Ferne ablesen. Nicht fernablesbare Geräte müssen bis zum ${RETROFIT_LAST_DAY} nachgerüstet oder ersetzt sein (§ 5 Abs. 3 HeizkostenV); sonst darf jeder Mieter seinen Anteil an den Heizkosten um ${REMOTE_CUT} % kürzen (§ 12 Abs. 1 Satz 2 HeizkostenV).`
// Die Hinweise der Karte „Werte des Ablesedienstes“ (Durchsicht von #241, Recht-I5).
export const SERVICE_VALUES_HINTS: readonly string[] = [
  'Tragen Sie je Wohnung und Nutzungszeitraum die bewerteten Werte ein, so wie sie in der Abrechnung oder im Ableseprotokoll des Dienstes stehen: bei Heizkostenverteilern die Summe nach den Bewertungsfaktoren, nicht die Rohwerte der Geräte. Damit sind auch Verdunster und Funk-Heizkostenverteiler abgedeckt.',
  'Zieht ein Mieter aus und hat der Dienst zwischenabgelesen, sind es zwei Zeilen. Ohne Zwischenablesung, etwa bei Verdunstern, steht eine Zeile über den ganzen Zeitraum; teilen Sie den Wert nicht selbst auf, sondern beantworten Sie in der Karte der Ablesungen die Frage zur fehlenden Zwischenablesung mit „Nicht möglich“ und dem Grund. Lücken bleiben Lücken: Was fehlt, schätzt Mietfuchs nicht.',
  'Nennt der Dienst Werte für das Warmwasser (in m³), tragen Sie sie bei allen Zeilen ein; sonst zählen die Warmwasserzähler.',
  EVAPORATOR_DEADLINE,
]

export const HCA_SCALE_OPTIONS: readonly { value: HcaScale | ''; label: string }[] = [
  { value: '', label: 'bitte wählen' },
  { value: 'unit', label: 'Einheitsskala (Wert mal Bewertungsfaktor)' },
  { value: 'product', label: 'Produktskala (Faktor im Wert enthalten)' },
]
export const scaleOfOption = (v: string): HcaScale | '' => HCA_SCALE_OPTIONS.find((o) => o.value === v)?.value ?? ''

// Eine Zahl so, wie sie gespeichert ist: deutsch, ohne Tausenderpunkte und mit allen Nachkommastellen, damit
// das Formular beim nächsten Speichern nicht still einen gerundeten Wert zurückschreibt.
export const exactText = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 10, useGrouping: false })

// Eine Zahl aus dem Formular. „1.250“ ohne Komma ist mehrdeutig (Tausender oder drei Nachkommastellen);
// Bewertungsfaktoren haben oft drei Nachkommastellen, deshalb fragt das Formular dann nach, statt zu raten.
// `null`: leer; `{ error }`: keine Zahl oder mehrdeutig.
function readNumber(text: string, what: string): number | null | { error: string } {
  if (text.trim() === '') return null
  if (ambiguousThousands(text) && !/^-?0\./.test(text.trim())) return { error: `${what}: ${ambiguousText(text)}` }
  const n = parseNumberDe(text)
  return n === null ? { error: `${what} ist keine Zahl.` } : n
}

// `confirmed`: ein Faktor über `FACTOR_PLAUSIBLE` ist bestätigt (Durchsicht von #241, M3).
export type HcaFieldsForm = { scale: HcaScale | ''; factor: string; confirmed?: boolean }
// Übliche Bewertungsfaktoren liegen deutlich darunter; darüber fragt das Formular nach (keine Rechtsgrenze).
export const FACTOR_PLAUSIBLE = 10

export const hcaFieldsOf = (m: Partial<Pick<Meter, 'hcaScale' | 'ratingFactor'>>): HcaFieldsForm => ({ scale: m.hcaScale ?? '', factor: exactText(m.ratingFactor), ...((m.ratingFactor ?? 0) > FACTOR_PLAUSIBLE ? { confirmed: true } : {}) })
// Steht ein Faktor über der Grenze im Feld, fragt das Formular nach.
export const asksFactorConfirm = (f: HcaFieldsForm): boolean => { const n = parseNumberDe(f.factor); return n !== null && n > FACTOR_PLAUSIBLE }
export const EMPTY_HCA_FIELDS: HcaFieldsForm = { scale: '', factor: '' }

// Skala und Faktor gibt es nur am Heizkostenverteiler; bei jeder anderen Sparte schickt das Formular
// `null`, sonst lehnte der Server ab. Bei der Produktskala ist der Faktor im Wert enthalten; ein Feld dafür
// gibt es dann nicht, und er wird geleert.
export function hcaFieldsBody(type: MeterType, f: HcaFieldsForm): { body: { hcaScale: HcaScale | null; ratingFactor: number | null } } | { error: string } {
  if (type !== 'hkv') return { body: { hcaScale: null, ratingFactor: null } }
  if (f.scale !== 'unit') return { body: { hcaScale: f.scale === '' ? null : f.scale, ratingFactor: null } }
  const factor = readNumber(f.factor, 'Bewertungsfaktor')
  if (factor !== null && typeof factor === 'object') return factor
  if (factor !== null && !(factor > 0)) return { error: 'Der Bewertungsfaktor ist eine Zahl über 0, etwa 0,8 oder 1,25.' }
  if (factor !== null && factor > FACTOR_PLAUSIBLE && !f.confirmed) {
    return { error: `Ein Bewertungsfaktor von ${exactText(factor)} ist ungewöhnlich hoch; üblich sind Werte um 1. Prüfen Sie die Eingabe (Nachkommastellen mit Komma). Stimmt der Wert, bestätigen Sie ihn mit dem Haken unter dem Feld.` }
  }
  return { body: { hcaScale: 'unit', ratingFactor: factor } }
}

// Die Zeile im Ausweis der Zählerliste: was gespeichert ist, mit allen Nachkommastellen.
export function hcaSummary(m: Pick<Meter, 'type' | 'hcaScale' | 'ratingFactor'>): string | null {
  if (m.type !== 'hkv') return null
  if (m.hcaScale === 'product') return 'Produktskala'
  if (m.hcaScale === 'unit') return m.ratingFactor ? `Einheitsskala, Bewertungsfaktor ${exactText(m.ratingFactor)}` : 'Einheitsskala, Bewertungsfaktor fehlt'
  return 'Skala fehlt'
}

// Der Stichtagswert laut Anzeige (Entwurf 8.1): Das Gerät hat am Stichtag auf null zurückgesetzt; erfasst
// wird das wie ein Zählerwechsel.
export type CutoffForm = { date: string; value: string }
export function cutoffReadingBody(meterId: string, f: CutoffForm): { body: { meterId: string; date: string; value: number; replacement: true; oldEndValue: number } } | { error: string } {
  if (f.date === '') return { error: 'Bitte wählen Sie den Stichtag des Geräts.' }
  const value = readNumber(f.value, 'Stichtagswert')
  if (value === null) return { error: 'Bitte tragen Sie den Stichtagswert laut Anzeige ein.' }
  if (typeof value === 'object') return value
  if (value < 0) return { error: 'Der Stichtagswert ist eine Zahl ab 0.' }
  return { body: { meterId, date: f.date, value: 0, replacement: true, oldEndValue: value } }
}
// Ist eine Ablesung ein Stichtagswert (Rücksetzen auf 0 mit dem Wert davor)?
export const isCutoffReading = (type: MeterType, r: { replacement?: boolean; value: number }): boolean => type === 'hkv' && r.replacement === true && r.value === 0

// Werte des Ablesedienstes (Entwurf 5.6).
export type ServiceRowForm = { unitId: string; from: string; to: string; heat: string; heatUnit: ServiceHeatUnit; water: string }
export const SERVICE_UNIT_OPTIONS: readonly { value: ServiceHeatUnit; label: string }[] = [
  { value: 'units', label: 'Einheiten (Heizkostenverteiler)' },
  { value: 'kWh', label: 'kWh (Wärmezähler)' },
]
export const serviceUnitOfOption = (v: string): ServiceHeatUnit => SERVICE_UNIT_OPTIONS.find((o) => o.value === v)?.value ?? 'units'
export const serviceRowsOf = (values: readonly HeatingServiceValue[]): ServiceRowForm[] =>
  values.map((v) => ({ unitId: v.unitId, from: v.from, to: v.to, heat: exactText(v.heatValue), heatUnit: v.heatUnit, water: exactText(v.waterValue) }))
export const emptyServiceRow = (from: string, to: string, heatUnit: ServiceHeatUnit = 'units'): ServiceRowForm => ({ unitId: '', from, to, heat: '', heatUnit, water: '' })

type ServiceValue = { unitId: string; from: string; to: string; heatValue: number; waterValue: number | null; heatUnit: ServiceHeatUnit }
export function serviceValuesBody(rows: readonly ServiceRowForm[]): { body: { values: ServiceValue[] } } | { error: string } {
  const values: ServiceValue[] = []
  for (const [i, r] of rows.entries()) {
    if (r.unitId === '' && r.heat.trim() === '' && r.water.trim() === '') continue
    if (r.unitId === '') return { error: `Bitte wählen Sie in Zeile ${i + 1} die Wohnung.` }
    const heat = readNumber(r.heat, `Heizung in Zeile ${i + 1}`)
    if (heat === null) return { error: `Bitte tragen Sie in Zeile ${i + 1} den Wert für die Heizung ein.` }
    if (typeof heat === 'object') return heat
    const water = readNumber(r.water, `Warmwasser in Zeile ${i + 1}`)
    if (water !== null && typeof water === 'object') return water
    values.push({ unitId: r.unitId, from: r.from, to: r.to, heatValue: heat, waterValue: water, heatUnit: r.heatUnit })
  }
  return { body: { values } }
}

// Was nach der Einrichtung zu tun ist, je nach Erfassung.
export function setupDoneText(capture: CaptureMethod | null): string {
  if (capture === 'hca') return 'Eigene Heizkostenabrechnung eingerichtet. Legen Sie auf der Seite Zähler je Heizkörper einen Heizkostenverteiler mit Skala und Bewertungsfaktor an und tragen Sie die Stände ein.'
  if (capture === 'serviceValues') return 'Eigene Heizkostenabrechnung eingerichtet. Tragen Sie die Werte des Ablesedienstes auf der Seite Heizkosten ein.'
  return 'Eigene Heizkostenabrechnung eingerichtet. Tragen Sie die Zählerstände auf der Seite Zähler ein.'
}

// Die bewerteten Einheiten in der Zählerliste (Durchsicht von #241, Minor 3): bei der Einheitsskala
// Ablesewert mal Faktor.
export function ratedText(m: Pick<Meter, 'type' | 'hcaScale' | 'ratingFactor'>, raw: number): string | null {
  if (m.type !== 'hkv' || m.hcaScale !== 'unit' || !m.ratingFactor) return null
  return `bewertet: ${(raw * m.ratingFactor).toLocaleString('de-DE', { maximumFractionDigits: 3 })} Einheiten`
}
