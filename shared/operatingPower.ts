// Betriebsstrom der Heizung (Heizung PR 15, #212): die Rechnung der Schätzhilfe, für Formular und
// Server dieselbe.
import type { HeatingEnergy, OperatingPowerDevice } from './types.ts'

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
const euro = (cents: number): string => `${de(cents / 100, 2)} €`
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

// Wärmepumpe und Stromheizung (P-W5, R2-W1): Der Strom, den Wärmepumpe oder Elektrokessel selbst
// verbrauchen, ist Brennstoff („Kosten der verbrauchten Brennstoffe“, § 7 Abs. 2 HeizkostenV; Entwurf 8.3)
// und gehört als Teil „Brennstoff/Energie“ in die Heizposition; für ihn gilt die Schätzhilfe nicht.
// Umwälzpumpen und Regelung, die über den Zähler des Hauses laufen, bleiben aber Betriebsstrom und sind
// beim Allgemeinstrom abzuziehen (V ZR 166/15 Rn. 13); der Satz nennt den Weg über das Kostenformular,
// das Kennzeichnen und Verknüpfen auch bei diesen Anlagen erlaubt. `null`: Die Schätzhilfe gilt.
const FUEL_IS_POWER: readonly HeatingEnergy[] = ['heatPump', 'electric']
export function operatingPowerRefusal(energy: HeatingEnergy): string | null {
  if (!FUEL_IS_POWER.includes(energy)) return null
  const own = energy === 'heatPump' ? 'Bei einer Wärmepumpe ist der Strom, den sie selbst verbraucht,' : 'Bei einer Stromheizung ist der Strom, den der Elektrokessel selbst verbraucht,'
  return `${own} Brennstoff und kein Betriebsstrom (§ 7 Abs. 2 HeizkostenV); er gehört als Brennstoffkosten in die Heizposition („Heizung und Warmwasser“, Teil „Brennstoff/Energie“), und die Schätzhilfe gilt dafür nicht. ` +
    'Laufen Umwälzpumpen oder Regelung über den Stromzähler des Hauses, ist deren Strom Betriebsstrom: Er gehört zu den Heiz- und Warmwasserkosten und ist beim Allgemeinstrom abzuziehen (§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 13). ' +
    'Erfassen Sie ihn dann im Kostenformular als Betriebsstrom und verknüpfen Sie den Abzug.'
}

// Die Grundlage der Schätzung, wie sie an Betriebsstrom und Abzug gespeichert wird (P-W1): der Rechenweg
// mit allen Eingaben, eine Zeile je Schritt.
export const basisOf = (steps: readonly string[]): string => steps.join('\n')
