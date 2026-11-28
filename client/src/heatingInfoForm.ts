// Karte „Angaben zur Abrechnung (§ 6a)“ der Seite Heizkosten (Heizung PR 14), ohne DOM prüfbar. Zahlen über
// `parseNumberDe` (Komma für Nachkommastellen); dieselben Sätze wie der Server.
import type { HeatingInfoInputs } from './types'
import { CONSUMER_CONTRACT_NONE } from '../../shared/heatingInfo.ts'
import { hkvCutInformation } from '../../shared/law/heizkostenv.ts'
import { germanDate, LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { parseNumberDe } from './numbers'

export type InfoForm = {
  taxes: string; ghg: string; pef: string; climateFactor: string; climateFactorPrev: string; climateSource: string; reference: string; referenceSource: string
  // Durchsicht von #243, R-W1: Quelle des beigelegten Vergleichs des Ablesedienstes.
  comparisonSource: string
}
export type ContractForm = { contract: 'none' | 'yes' | ''; disputeText: string }
// Durchsicht von #243, R-K5: Ein Verbrauchervertrag verlangt beide Seiten, den Vermieter als Unternehmer (§ 14 BGB)
// und den Mieter als Verbraucher (§ 13 BGB) (BR-Drs. 643/21, S. 20 f.).
export const CONTRACT_OPTIONS: { value: ContractForm['contract']; label: string }[] = [
  { value: '', label: 'Bitte wählen' },
  { value: 'none', label: 'Nein: kein Verbrauchervertrag' },
  { value: 'yes', label: 'Ja: Verbrauchervertrag (§ 310 Abs. 3 BGB)' },
]
export const CONTRACT_HELP = 'Ein Verbrauchervertrag liegt vor, wenn Sie als Unternehmer (§ 14 BGB) an einen Mieter vermieten, der Verbraucher ist (§ 13 BGB). Wer als Privatperson eigenes Vermögen vermietet, ist in der Regel kein Unternehmer; das kann sich mit Umfang und Organisation der Vermietung ändern (vgl. BGH, Urteil vom 23.10.2001, XI ZR 63/01). ' +
  'Beim Verbrauchervertrag gehört die Information über die Möglichkeit eines Streitbeilegungsverfahrens nach dem Verbraucherstreitbeilegungsgesetz zur Abrechnung (§ 6a Abs. 3 Satz 1 Nr. 3 HeizkostenV); dafür können Sie etwa auf die Liste der Verbraucherschlichtungsstellen verweisen, die das Bundesamt für Justiz veröffentlicht (BR-Drs. 643/21, S. 21). ' +
  'Eigene Informationspflichten nach §§ 36, 37 VSBG bleiben davon unberührt, soweit sie Sie treffen.'
const text = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 6, useGrouping: false }))
const num = (t: string): number | null | 'bad' => {
  if (t.trim() === '') return null
  const n = parseNumberDe(t)
  return n === null ? 'bad' : n
}

export const REFERENCE_SOURCE_TEXT_OWN = 'Bitte nennen Sie die Quelle des Vergleichswerts, etwa Herausgeber, Titel und Jahr der Vergleichswerte. Ein Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich.'
export const REFERENCE_SOURCE_TEXT = 'Bitte nennen Sie die Quelle des Vergleichswerts, etwa die Vergleichsdaten Ihres Ablesedienstes. Ein Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich.'

// Die Hilfe am Vergleichswert (#690 Punkt 7). Mit Werten eines Ablesedienstes bleibt der bisherige Satz. Wer ohne
// Ablesedienst selbst abrechnet, bekommt den Wortlaut der Nr. 4 und eingeklappt einen Weg, den die Verordnung selbst
// trägt: die Stellen der Nr. 2. Wortlaut von § 6a Abs. 3 HeizkostenV und BR-Drs. 643/21, S. 19 bis 21 gelesen am
// 21.11.2026, erneut am 27.11.2026 (§ 6a Abs. 3 und § 12 Abs. 1 Satz 3 auf gesetze-im-internet.de, S. 19 bis 21
// der Drucksache). Dass ein Vergleichsprofil von dort genügt, steht nirgends ausdrücklich; der Text nennt es als Auslegung.
export const REFERENCE_HELP_SERVICE = 'Gemeint ist ein Wert für die ganze Heizperiode aus Vergleichsdaten, etwa vom Ablesedienst; Mietfuchs rechnet ihn auf Wohnfläche und Tage jedes Mieters um. Ein Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich.'
export const REFERENCE_HELP = 'Gemeint ist ein Wert für die ganze Heizperiode: der Verbrauch eines Durchschnittsnutzers derselben Nutzerkategorie, normiert oder durch Vergleichstests ermittelt (§ 6a Abs. 3 Satz 1 Nr. 4 HeizkostenV). Mietfuchs rechnet ihn auf Wohnfläche und Tage jedes Mieters um. Ein Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich.'
// Durchsicht M2: Mit Heizkostenverteilern oder für das Warmwasser allein (Wärme nach § 11 ausgenommen) rechnet Mietfuchs
// Nr. 4 nicht (calc.ts, `heating.info-open`); dort nennt die Hilfe keinen Weg, der die Kürzung nicht abstellte.
export const REFERENCE_HELP_NOT_COMPUTED = 'Mit Heizkostenverteilern oder für das Warmwasser allein erstellt Mietfuchs den Vergleich nach Nr. 4 nicht, auch nicht mit einem Wert in diesen Feldern; was dann gilt, steht unten.'
export const REFERENCE_SOURCE_PLACEHOLDER_SERVICE = 'z. B. Vergleichswerte Ihres Ablesedienstes'
export const REFERENCE_SOURCE_PLACEHOLDER = 'z. B. Herausgeber, Titel und Jahr der Vergleichswerte'
export const REFERENCE_WAY_TITLE = 'Woher bekomme ich den Vergleichswert ohne Ablesedienst?'
export const REFERENCE_WAY: readonly string[] = [
  'Eine bestimmte Quelle schreibt die Verordnung nicht vor. Nach ihrer Begründung sollen dem Vergleich anonymisierte Verbraucher aus den Gebäudebeständen der Ablesedienste dienen, und er soll zum Haus passen: derselbe Zeitraum, dieselbe Klimazone, ein vergleichbarer energetischer Zustand oder das Baualter, der Energieträger oder die Anlagentechnik und die Gebäudegröße (BR-Drs. 643/21, S. 19 und 21).',
  'Wer ohne Ablesedienst abrechnet, hat diese Daten nicht. Als Stellen, bei denen Vergleichsprofile eingeholt werden können, nennt die Verordnung Verbraucherorganisationen, Energieagenturen oder ähnliche Einrichtungen (§ 6a Abs. 3 Satz 1 Nr. 2 HeizkostenV), ihre Begründung die Energieberatung der Verbraucherzentralen (BR-Drs. 643/21, S. 20). Fragen Sie dort nach einem Vergleichswert für den Wärmeverbrauch in kWh je m² Wohnfläche, der zu Ihrem Haus und zum Zeitraum Ihrer Heizperiode passt.',
  'Tragen Sie den Wert ein und nennen Sie als Quelle, wer ihn herausgibt, wie die Veröffentlichung heißt und für welches Jahr und welche Art von Gebäude er gilt; die Quelle steht auf der Abrechnung. Dass ein solches Vergleichsprofil den Vergleich nach Nr. 4 erfüllt, ist eine Auslegung von Mietfuchs; ausdrücklich geregelt ist es nicht.',
  'Der Vergleichswert erfüllt nur den Vergleich nach Nr. 4. Für den Vergleich mit dem vorhergehenden Abrechnungszeitraum (Nr. 5) braucht Mietfuchs den Verbrauch der Mieter im Vorjahr; im ersten Jahr der eigenen Abrechnung kennt es ihn meist nicht. Steht er in der Abrechnung Ihres früheren Messdienstes, legen Sie Ihrer Abrechnung einen witterungsbereinigten Vergleich damit bei; in Mietfuchs vermerken lässt sich das nicht, und die Abrechnung nennt die Kürzung dafür weiter.',
  `Ohne Vergleichswert nennt die Abrechnung das Recht der Mieter, ihren Anteil um ${valueAt(hkvCutInformation, LAW_AS_OF)} % zu kürzen (§ 12 Abs. 1 Satz 3 HeizkostenV); Mietfuchs zieht nichts ab.`,
]
export const CLIMATE_SOURCE_TEXT = 'Bitte nennen Sie die Quelle der Klimafaktoren, etwa „Deutscher Wetterdienst, Klimafaktoren“ mit Postleitzahl und Zeitraum.'

export function infoToForm(i: HeatingInfoInputs): InfoForm {
  return {
    taxes: i.infoTaxesText ?? '', ghg: text(i.infoDistrictGhg), pef: text(i.infoDistrictPef),
    climateFactor: text(i.climateFactor), climateFactorPrev: text(i.climateFactorPrev), climateSource: i.climateFactorSource ?? '',
    reference: text(i.infoReferenceKwhPerM2), referenceSource: i.infoReferenceSource ?? '', comparisonSource: i.infoComparisonSource ?? '',
  }
}

// `byService`: Die Heizperiode wird mit Werten eines Ablesedienstes erfasst (sonst nennt die Meldung ihn nicht, #690).
export function infoBody(f: InfoForm, byService = true): { body: Omit<HeatingInfoInputs, 'postalCode'> } | { error: string } {
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
  if (reference !== null && source === '') return { error: byService ? REFERENCE_SOURCE_TEXT : REFERENCE_SOURCE_TEXT_OWN }
  return {
    body: {
      infoTaxesText: f.taxes.trim() === '' ? null : f.taxes.trim(), infoDistrictGhg: ghg, infoDistrictPef: pef,
      climateFactor: factor, climateFactorPrev: prev, climateFactorSource: climateSource === '' ? null : climateSource,
      infoReferenceKwhPerM2: reference, infoReferenceSource: source === '' ? null : source,
      infoComparisonSource: f.comparisonSource.trim() === '' ? null : f.comparisonSource.trim(),
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
