// Karte „Angaben zur Abrechnung (§ 6a)“ der Seite Heizkosten (Heizung PR 14), ohne DOM prüfbar. Zahlen über
// `parseNumberDe` (Komma für Nachkommastellen); dieselben Sätze wie der Server.
import type { HeatingInfoInputs } from './types'
import { CONSUMER_CONTRACT_NONE } from '../../shared/heatingInfo.ts'
import { germanDate } from '../../shared/law/register.ts'
import { parseNumberDe } from './numbers'

export type InfoForm = {
  taxes: string; ghg: string; pef: string; climateFactor: string; climateFactorPrev: string; climateSource: string; reference: string; referenceSource: string
}
export type ContractForm = { contract: 'none' | 'yes' | ''; disputeText: string }
export const CONTRACT_OPTIONS: { value: ContractForm['contract']; label: string }[] = [
  { value: '', label: 'Bitte wählen' },
  { value: 'none', label: 'Nein, ich vermiete nicht als Unternehmer (kein Verbrauchervertrag)' },
  { value: 'yes', label: 'Ja, ich vermiete als Unternehmer (Verbrauchervertrag nach § 310 Abs. 3 BGB)' },
]
const text = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 6, useGrouping: false }))
const num = (t: string): number | null | 'bad' => {
  if (t.trim() === '') return null
  const n = parseNumberDe(t)
  return n === null ? 'bad' : n
}

export const REFERENCE_SOURCE_TEXT = 'Bitte nennen Sie die Quelle des Vergleichswerts, etwa die Vergleichsdaten Ihres Ablesedienstes. Ein Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich.'
export const CLIMATE_SOURCE_TEXT = 'Bitte nennen Sie die Quelle der Klimafaktoren, etwa „Deutscher Wetterdienst, Klimafaktoren“ mit Postleitzahl und Zeitraum.'

export function infoToForm(i: HeatingInfoInputs): InfoForm {
  return {
    taxes: i.infoTaxesText ?? '', ghg: text(i.infoDistrictGhg), pef: text(i.infoDistrictPef),
    climateFactor: text(i.climateFactor), climateFactorPrev: text(i.climateFactorPrev), climateSource: i.climateFactorSource ?? '',
    reference: text(i.infoReferenceKwhPerM2), referenceSource: i.infoReferenceSource ?? '',
  }
}

export function infoBody(f: InfoForm): { body: Omit<HeatingInfoInputs, 'postalCode'> } | { error: string } {
  const factor = num(f.climateFactor)
  const prev = num(f.climateFactorPrev)
  if (factor === 'bad' || prev === 'bad' || (factor !== null && factor <= 0) || (prev !== null && prev <= 0)) return { error: 'Der Klimafaktor ist eine Zahl größer als 0.' }
  const climateSource = f.climateSource.trim()
  if ((factor !== null || prev !== null) && climateSource === '') return { error: CLIMATE_SOURCE_TEXT }
  const ghg = num(f.ghg)
  if (ghg === 'bad' || (ghg !== null && ghg < 0)) return { error: 'Die Treibhausgasemissionen sind eine Zahl ab 0 (g CO₂-Äquivalent je kWh).' }
  const pef = num(f.pef)
  if (pef === 'bad' || (pef !== null && pef < 0)) return { error: 'Der Primärenergiefaktor ist eine Zahl ab 0.' }
  const reference = num(f.reference)
  if (reference === 'bad' || (reference !== null && reference <= 0)) return { error: 'Der Vergleichswert ist eine Zahl größer als 0 (kWh je m² Wohnfläche in der Heizperiode).' }
  const source = f.referenceSource.trim()
  if (reference !== null && source === '') return { error: REFERENCE_SOURCE_TEXT }
  return {
    body: {
      infoTaxesText: f.taxes.trim() === '' ? null : f.taxes.trim(), infoDistrictGhg: ghg, infoDistrictPef: pef,
      climateFactor: factor, climateFactorPrev: prev, climateFactorSource: climateSource === '' ? null : climateSource,
      infoReferenceKwhPerM2: reference, infoReferenceSource: source === '' ? null : source,
    },
  }
}

export function contractToForm(c: string | null): ContractForm {
  return { contract: c === null ? '' : c === CONSUMER_CONTRACT_NONE ? 'none' : 'yes', disputeText: c !== null && c !== CONSUMER_CONTRACT_NONE ? c : '' }
}
export function contractBody(f: ContractForm): { body: { consumerContract: string | null } } | { error: string } {
  if (f.contract === 'yes' && f.disputeText.trim() === '') return { error: 'Bei einem Verbrauchervertrag tragen Sie die Information zur Streitbeilegung ein (§ 6a Abs. 3 Satz 1 Nr. 3 HeizkostenV).' }
  return { body: { consumerContract: f.contract === '' ? null : f.contract === 'none' ? CONSUMER_CONTRACT_NONE : f.disputeText.trim() } }
}

export function dwdHint(postalCode: string | null, from: string, to: string): string {
  return postalCode
    ? `Der Deutsche Wetterdienst veröffentlicht Klimafaktoren je Postleitzahl für zwölf Monate. Für dieses Objekt: Postleitzahl ${postalCode}, Zeitraum ${germanDate(from)} bis ${germanDate(to)}.`
    : `Der Deutsche Wetterdienst veröffentlicht Klimafaktoren je Postleitzahl für zwölf Monate, hier für den Zeitraum ${germanDate(from)} bis ${germanDate(to)}. Tragen Sie die Adresse des Objekts mit Postleitzahl ein, dann steht sie hier.`
}
