// Betriebsstrom der Heizung (Heizung PR 15, #212): die Rechnung der Schätzhilfe, für Formular und
// Server dieselbe.
import type { HeatingEnergy, HeatingMethod, HeatingSource, HeatingSupply, OperatingPowerDevice, OperatingPowerHandling } from './types.ts'
import { plantSpan } from './heatingPeriod.ts'

// Die Kostenart des Allgemeinstroms (§ 2 Nr. 11 BetrKV, Beleuchtung). Dieselbe Zeichenkette wie in
// shared/categories.ts; categories.test.ts hält beide zusammen.
export const GENERAL_POWER_CATEGORY = 'Beleuchtung/Allgemeinstrom'

// Was die Hilfe braucht: entweder Geräte und Heiztage (geschätzt) oder gemessene kWh (Zwischenzähler),
// dazu kWh und Betrag der Stromrechnung des Allgemeinstroms.
export type OperatingPowerInput = {
  devices: readonly OperatingPowerDevice[] | null
  heatingDays: number | null
  measuredKwh: number | null
  billKwh: number
  billCents: number
}

// `permille` ist der Anteil an der Stromrechnung in Promille, ungerundet; `cents` auf den Cent gerundet.
export type OperatingPowerShare = { kwh: number; measured: boolean; permille: number; cents: number; steps: string[] }

const de = (n: number, digits: number): string => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
// Euro mit gewöhnlichem Leerzeichen, wie die Texte der Berechnung.
export const euro = (cents: number): string => `${de(cents / 100, 2)} €`
const kwhText = (kwh: number): string => `${kwh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh`
const positive = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

// Der Anteil des Betriebsstroms am Allgemeinstrom (BGH, Urteil vom 03.06.2016, V ZR 166/15, Leitsatz:
// „welcher Anteil an dem Allgemeinstrom hierauf entfällt“). kWh nach Rn. 14 aus Leistung und Heiztagen,
// oder gemessen; Euro = Betrag der Stromrechnung × kWh ÷ kWh der Rechnung, also mit anteiligem
// Grundpreis (Festlegung im Schätzermessen nach Rn. 14, keine Norm). Laufzeit und Heiztage gibt der
// Vermieter ein, Mietfuchs schlägt keine vor.
export function operatingPowerShare(i: OperatingPowerInput): OperatingPowerShare | { error: string } {
  if (!positive(i.billKwh)) return { error: 'Bitte geben Sie die kWh der Stromrechnung des Allgemeinstroms an.' }
  if (!positive(i.billCents)) return { error: 'Der Betrag der Stromrechnung muss größer als 0 sein.' }
  const steps: string[] = []
  let kwh = 0
  const measured = i.measuredKwh !== null
  if (measured) {
    if (!positive(i.measuredKwh)) return { error: 'Bitte geben Sie die gemessenen kWh des Zwischenzählers an.' }
    kwh = i.measuredKwh
  } else {
    const devices = i.devices ?? []
    if (devices.length === 0) return { error: 'Bitte nennen Sie mindestens ein Gerät der Heizung mit Leistung und Laufzeit.' }
    const days = i.heatingDays
    if (days === null || !Number.isInteger(days) || days < 1 || days > 366) return { error: 'Bitte geben Sie die Heiztage an, als ganze Zahl von 1 bis 366.' }
    for (const d of devices) {
      if (!positive(d.watts)) return { error: `Bitte geben Sie die Leistung von „${d.label}“ in Watt an.` }
      if (!positive(d.hoursPerDay) || d.hoursPerDay > 24) return { error: `Die Laufzeit von „${d.label}“ ist höchstens 24 Stunden am Tag.` }
      // P-K8: eigene Tage je Gerät, sonst die Heiztage (Festlegung im Schätzermessen).
      const own = d.days ?? days
      if (!Number.isInteger(own) || own < 1 || own > 366) return { error: `Die Tage von „${d.label}“ sind eine ganze Zahl von 1 bis 366.` }
      const deviceKwh = (d.watts * d.hoursPerDay * own) / 1000
      kwh += deviceKwh
      steps.push(`${d.label}: ${d.watts.toLocaleString('de-DE')} W × ${d.hoursPerDay.toLocaleString('de-DE')} h × ${own} Tage = ${kwhText(deviceKwh)}`)
    }
  }
  if (kwh > i.billKwh) {
    return { error: `Die ${measured ? 'gemessenen' : 'geschätzten'} ${kwhText(kwh)} liegen über dem Verbrauch der Stromrechnung (${kwhText(i.billKwh)}). Bitte prüfen Sie Leistung (in Watt) und Laufzeit.` }
  }
  const ratio = kwh / i.billKwh
  const percent = `${de(ratio * 100, 2)} %`
  steps.push(measured
    ? `gemessen mit Zwischenzähler: ${kwhText(kwh)} von ${kwhText(i.billKwh)} der Stromrechnung = ${percent}`
    : `zusammen ${kwhText(kwh)} von ${kwhText(i.billKwh)} der Stromrechnung = ${percent}`)
  const cents = Math.round(i.billCents * ratio)
  // Festlegung im Schätzermessen: Anteil am Rechnungsbetrag samt Grundpreis. Der Text sagt es, damit der
  // Vermieter die Festlegung sieht.
  steps.push(`${percent} des Rechnungsbetrags einschließlich Grundpreis (${euro(i.billCents)}) = ${euro(cents)}`)
  return { kwh, measured, permille: ratio * 1000, cents, steps }
}

// Der dritte Weg „Betrag selbst geschätzt“ (P-W2, Entwurf 0.12): etwa ein Bruchteil der Brennstoffkosten
// (BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 14). Mietfuchs gibt keinen Prozentsatz vor und rechnet
// keinen vor (Entwurf 16); die Grundlage ist Pflicht, denn bestreitet ein Mieter den Betrag, muss der
// Vermieter sie darlegen (P-W1).
export type OwnEstimate = { cents: number; steps: string[] }
export function ownEstimateShare(i: { cents: number | null; basis: string; billCents: number }): OwnEstimate | { error: string } {
  const basis = i.basis.trim()
  // Das Beispiel nennt bewusst keinen Prozentsatz: Mietfuchs gibt keinen vor (Entwurf 16).
  if (basis === '') return { error: 'Bitte nennen Sie die Grundlage der Schätzung, etwa den Bruchteil der Brennstoffkosten, den Sie angesetzt haben, oder die Geräte mit Leistung und Laufzeit.' }
  if (i.cents === null || !Number.isInteger(i.cents) || i.cents <= 0) return { error: 'Bitte geben Sie den geschätzten Betrag in Euro an.' }
  if (i.cents > i.billCents) return { error: `Die geschätzten ${euro(i.cents)} liegen über dem Betrag der Stromrechnung (${euro(i.billCents)}). Bitte prüfen Sie den Betrag.` }
  return { cents: i.cents, steps: [`selbst geschätzt: ${euro(i.cents)}`, `Grundlage der Schätzung: ${basis}`] }
}

// Wärmepumpe und Stromheizung (P-W5, R2-W1, R-W2 der Durchsicht von #252): Der Strom, den Wärmepumpe
// oder Elektrokessel zur Wärmeerzeugung verbrauchen, gehört zu den Heiz- und Warmwasserkosten, aber weder
// als Brennstoff noch als Betriebsstrom: § 7 Abs. 2 HeizkostenV nennt seit dem 01.10.2024 die „Kosten des
// zur Wärmeerzeugung verbrauchten Stroms“ eigens neben den Brennstoffen (§ 8 Abs. 2 verweist darauf). In
// Mietfuchs steht er im Teil „Brennstoff/Energie“ der Heizposition; die Schätzhilfe gilt für ihn nicht.
// Läuft er über den Zähler des Hauses, ist er aus dem Allgemeinstrom herauszurechnen; das ist eine
// Auslegung (entschieden hat der BGH es für den Betriebsstrom), und der Satz sagt das. Umwälzpumpen und
// Regelung bleiben Betriebsstrom. `null`: Die Schätzhilfe gilt.
export const POWER_GENERATED: readonly HeatingEnergy[] = ['heatPump', 'electric']
export function operatingPowerRefusal(energy: HeatingEnergy): string | null {
  if (!POWER_GENERATED.includes(energy)) return null
  const own = energy === 'heatPump' ? 'Bei einer Wärmepumpe gehört der Strom, den sie zur Wärmeerzeugung verbraucht,' : 'Bei einer Stromheizung gehört der Strom, den der Elektrokessel zur Wärmeerzeugung verbraucht,'
  return `${own} zu den Heiz- und Warmwasserkosten, und zwar nicht als Betriebsstrom: Die Heizkostenverordnung nennt ihn seit dem 01.10.2024 eigens neben den Brennstoffen („Kosten des zur Wärmeerzeugung verbrauchten Stroms“, § 7 Abs. 2, § 8 Abs. 2 HeizkostenV). ` +
    'Erfassen Sie ihn in der Heizposition („Heizung und Warmwasser“, Teil „Brennstoff/Energie“); die Schätzhilfe gilt dafür nicht. ' +
    'Läuft dieser Strom nicht über einen eigenen Zähler, sondern über den Stromzähler des Hauses, steckt er auch in der Rechnung des Allgemeinstroms und muss dort heraus; sonst zahlen die Mieter ihn doppelt oder nach dem falschen Schlüssel. ' +
    'Dass für ihn dasselbe gilt wie für den Betriebsstrom (BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 13 f.), ist eine Auslegung von Mietfuchs; entschieden hat der Bundesgerichtshof es für den Betriebsstrom. ' +
    'Dann kennzeichnen Sie die Heizposition im Kostenformular („Läuft dieser Strom über den Stromzähler des Hauses?“) und verknüpfen den Abzug beim Allgemeinstrom mit ihr. ' +
    'Laufen Umwälzpumpen oder Regelung über den Stromzähler des Hauses, ist deren Strom Betriebsstrom: Er gehört zu den Heiz- und Warmwasserkosten und ist beim Allgemeinstrom abzuziehen (§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 13 f.). ' +
    'Erfassen Sie ihn dann im Kostenformular als Betriebsstrom und verknüpfen Sie den Abzug.'
}

// Ob eine Stromrechnung den Betriebsstrom einer Heizperiode enthalten kann: Ihr Zeitraum berührt die
// Heizperiode (Durchsicht von #252, G-K1 und N1). Eine Quelle für Server und Karte (G2-H4).
export const touchesHeatingPeriod = (general: { from: string; to: string }, heating: { from: string; to: string }): boolean =>
  general.to >= heating.from && general.from <= heating.to

// ---------- Bekommt ein Messdienst den Betriebsstrom? (#268) ----------
//
// Ein Abzug ohne Verweis auf eine Heizposition heißt im Formular „dem Messdienst als Betriebsstrom gemeldet“, wenn
// eine Anlage mit Messdienst im Zeitraum des Abzugs heizt; sonst „ich lege ihn nicht um und trage ihn selbst“. Die
// Steuerübersicht fragt dasselbe: Nur im zweiten Fall steht dem Abzug keine Position gegenüber. Die Spanne einer
// Anlage reicht vom Tag nach dem Ende ihrer Vorgängerin bis `endsOn` (plantSpan), beide Grenzen inklusiv. Keine
// weitere Bedingung an Versorgung oder Quelle: Der Nutzer hat den Weg gewählt, und Mietfuchs folgt ihm.
type SpanPlant = { id: string; method: HeatingMethod; endsOn?: string | null; replacesPlantId?: string | null }
export const heatsIn = (plant: SpanPlant, plants: readonly SpanPlant[], period: { from: string; to: string }): boolean => {
  const span = plantSpan(plant, plants)
  return (span.from === null || span.from <= period.to) && (span.to === null || span.to >= period.from)
}
export const serviceReceivesOperatingPower = (plants: readonly SpanPlant[], period: { from: string; to: string }): boolean =>
  plants.some((p) => p.method === 'service' && heatsIn(p, plants, period))
// Die Antwort am Abzug ohne Verweis, wenn kein Messdienst im Zeitraum heizt (#268). Die Hinweise „Betriebsstrom fehlt“
// und „Abzug fehlt“ zitieren sie wörtlich; OperatingPowerFields.test.tsx hält die gerenderte Auswahl daran fest.
export const OPERATING_POWER_KEPT = 'Ja, ich lege ihn nicht um und trage ihn selbst'
// R-6: Heizt im selben Zeitraum zugleich eine zentrale Anlage des Hauses ohne Messdienst, ist nicht eindeutig, ob der
// Abzug gemeldet ist. Eine Etagenheizung oder eine Anlage der Gemeinschaft zählt nicht (Durchsicht T1, T1b): Ihr Strom
// läuft nicht über den Zähler des Hauses. Dieselbe Bedingung wie bei `unmarkedPowerCredits`.
export const nonServiceHeats = (plants: readonly (SpanPlant & { supply?: HeatingSupply | null; source?: HeatingSource })[], period: { from: string; to: string }): boolean =>
  plants.some((p) => p.method !== 'service' && (p.supply ?? 'central') === 'central' && (p.source ?? 'building') === 'building' && heatsIn(p, plants, period))

// Die Grundlage der Schätzung, wie sie an Betriebsstrom und Abzug gespeichert wird (P-W1): der Rechenweg
// mit allen Eingaben, eine Zeile je Schritt.
export const basisOf = (steps: readonly string[]): string => steps.join('\n')

// ---------- Angabe an der Heizanlage, wie der Betriebsstrom erfasst ist (#266) ----------

// Womit eine Zentralheizung Betriebsstrom für Brenner, Pumpen und Regelung braucht. Fernwärme ist ausgenommen:
// Ob die Hausanlage Pumpen oder Regelung am Zähler des Hauses hat, hängt an Anlage und Vertrag. „Sonstige“
// ebenso, denn darunter kann alles fallen. Wärmepumpe und Elektrokessel haben einen eigenen Hinweis.
export const OPERATING_POWER_BURNERS: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg', 'pellets', 'wood', 'coal']

// Ob Mietfuchs an dieser Anlage fragt, wie der Betriebsstrom erfasst ist. Dieselbe Regel entscheidet, wann der
// Hinweis „Betriebsstrom fehlt“ überhaupt kommen kann (server/src/operatingPower.ts), damit die Frage genau dort
// steht, wohin der Hinweis führt: zentral, im eigenen Haus (keine Gemeinschaft), ohne Messdienst, mit Brenner.
export const asksOperatingPowerHandling = (plant: { energy: HeatingEnergy; method: HeatingMethod; source: HeatingSource; supply?: HeatingSupply | null }): boolean =>
  (plant.supply ?? 'central') === 'central' && plant.source === 'building' && plant.method !== 'service' && OPERATING_POWER_BURNERS.includes(plant.energy)

// Frage und Beschriftungen, eine Quelle für Oberfläche und Hinweistexte, damit beide wortgleich sind. Entscheidend
// ist der Stromvertrag mit eigener Rechnung, nicht der Zähler: Ein Zwischenzähler hinter dem Zähler des Hauses
// gehört zu `deducted` (Rechtsprüfung des Plans, M-1).
// Frage und Antwort des Kostenformulars an einer Heizposition „Betrieb“ (client/src/components/OperatingPowerFields.tsx,
// `OPERATING_POWER_OPTIONS` in client/src/costForm.ts). Der Hinweis „Abzug fehlt“ zitiert beide wörtlich (#266, R-4);
// OperatingPowerFields.test.tsx hält die gerenderte Frage an dieser Konstante fest.
export const OPERATING_POWER_INCLUDED_QUESTION = 'Läuft dieser Betriebsstrom über den Stromzähler des Hauses?'
export const OPERATING_POWER_INCLUDED_YES = 'Ja, er läuft über den Stromzähler des Hauses'

export const OPERATING_POWER_HANDLING_QUESTION = 'Wie ist der Betriebsstrom dieser Heizung erfasst?'
export const OPERATING_POWER_HANDLING_LABELS: Record<OperatingPowerHandling | '', string> = {
  '': 'Keine Angabe',
  ownMeter: 'Eigener Stromvertrag (eigener Zähler mit eigener Rechnung), Rechnung als Heizposition „Betrieb“ erfasst',
  deducted: 'Über die Stromrechnung des Hauses (auch mit Zwischenzähler), beim Allgemeinstrom abgezogen',
  landlordPays: 'Eigener Stromvertrag (eigener Zähler mit eigener Rechnung), die Kosten trägt der Vermieter selbst',
}
