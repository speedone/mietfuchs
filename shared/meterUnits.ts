// Die Einheiten der Zähler (#342), eine Stelle für Formular, Server und Berechnung.
//
// Bis #342 war die Einheit ein freier Text, den die Berechnung nie las: Verbräuche verschiedener Zähler
// wurden addiert, als hätten alle dieselbe Einheit. Ein Wärmezähler in MWh neben solchen in kWh zahlte so
// fast nichts, ein Warmwasserzähler in Litern neben solchen in m³ fast alles (gemessen 998,00 € statt
// 333,33 € von 1.000 €).
//
// **Bekannt sind die Einheiten je Sparte, nicht je Text.** Wärme: kWh, MWh, GJ; Wasser (kalt und warm):
// m³, l; Strom: kWh, MWh. Heizkostenverteiler zählen Einheiten ohne physikalische Größe, „Sonstiges“ hat
// keine bekannte Einheit. Gas hat keine eigene Sparte (der Gaszähler der Heizanlage ist „Sonstiges“): Dort
// sind m³ und kWh verschiedene Größen, die sich nur über Brennwert und Zustandszahl der Rechnung
// ineinander umrechnen ließen, und deshalb rechnet Mietfuchs sie nicht um.
//
// **Die Faktoren sind exakte Brüche** auf die Grundeinheit der Sparte (kWh bzw. m³): 1 MWh = 1.000 kWh,
// 1 l = 1/1.000 m³, 1 GJ = 10^9 J / 3,6·10^6 J = 2.500/9 kWh (1 kWh = 3,6 MJ, SI-Definition). Bei kWh,
// MWh, m³ und l ist die Umrechnung eine Multiplikation mit einer ganzen Zahl oder ihrem Kehrwert, bei GJ
// mit 277,77…; mehr als die übliche Rundung der Gleitkommazahl (eine Stelle in der 16.) entsteht dabei
// nicht, und die Verteilung rechnet mit Anteilen und rundet erst den Betrag in Cent. GJ bleibt deshalb
// in der Auswahl: Der Bruch ist exakt, ungenau wäre nur ein gerundeter Faktor wie 277,78.
//
// **Gleiche Einheit heißt keine Umrechnung** (`unitScale` mit `mode: 'relative'`): Sind alle Zähler einer
// Verteilung in derselben Einheit, rechnet Mietfuchs mit den Werten, wie sie dastehen, auch wenn die
// Einheit unbekannt ist. So ändert sich bei einem Bestand mit einheitlichen Einheiten keine Zahl.

import type { MeterType } from './types.ts'

export type UnitFamily = 'heat' | 'water' | 'power'
export type MeterUnit = { label: string; num: number; den: number }

export const FAMILY_OF: Record<MeterType, UnitFamily | null> = {
  waerme: 'heat', kaltwasser: 'water', warmwasser: 'water', strom: 'power', hkv: null, sonstig: null,
}

// Die erste Einheit jeder Sparte ist ihre Grundeinheit.
export const UNITS: Record<UnitFamily, readonly MeterUnit[]> = {
  heat: [{ label: 'kWh', num: 1, den: 1 }, { label: 'MWh', num: 1000, den: 1 }, { label: 'GJ', num: 2500, den: 9 }],
  water: [{ label: 'm³', num: 1, den: 1 }, { label: 'l', num: 1, den: 1000 }],
  power: [{ label: 'kWh', num: 1, den: 1 }, { label: 'MWh', num: 1000, den: 1 }],
}

export const baseUnitOf = (family: UnitFamily): string => UNITS[family][0]?.label ?? ''

// Schreibweisen, die vorkommen: „m3“, „M³“, „cbm“, „Kubikmeter“, „Liter“, „KWh“ … Verglichen wird ohne
// Leerzeichen, Punkte und Groß-/Kleinschreibung, „³“ und „^3“ als „3“.
const ALIASES: Record<string, string> = {
  kwh: 'kWh', kilowattstunde: 'kWh', kilowattstunden: 'kWh',
  mwh: 'MWh', megawattstunde: 'MWh', megawattstunden: 'MWh',
  gj: 'GJ', gigajoule: 'GJ',
  m3: 'm³', cbm: 'm³', qm3: 'm³', kubikmeter: 'm³', kubikmetern: 'm³',
  l: 'l', ltr: 'l', liter: 'l', litern: 'l',
}

const squash = (text: string): string => text.normalize('NFKC').trim().toLowerCase().replace(/\^3/g, '3').replace(/³/g, '3').replace(/[\s.]/g, '')

// Die Einheit eines Zählers dieser Sparte, oder null, wenn Mietfuchs sie nicht kennt.
export function knownUnit(type: MeterType, text: string | null | undefined): MeterUnit | null {
  const family = FAMILY_OF[type]
  if (family === null || typeof text !== 'string') return null
  const label = ALIASES[squash(text)]
  return UNITS[family].find((u) => u.label === label) ?? null
}

// Zum Vergleichen zweier Einheiten: die bekannte Schreibweise, sonst der Text ohne Groß-/Kleinschreibung und
// Leerzeichen am Rand. Die Schreibweisen gelten bei jeder Sparte als gleich (Durchsicht von #342, S1): Auch bei
// „Sonstiges“ sind „m³“, „m3“, „cbm“ und „Kubikmeter“ dieselbe Einheit. Umgerechnet wird dabei nichts.
export function unitKey(_type: MeterType, text: string | null | undefined): string {
  if (typeof text !== 'string') return ''
  return ALIASES[squash(text)] ?? text.normalize('NFC').trim().toLowerCase()
}

// Die Einheit, wie sie dasteht oder in der bekannten Schreibweise (für Anzeige und Formular).
export function unitLabel(type: MeterType, text: string | null | undefined): string {
  return knownUnit(type, text)?.label ?? (typeof text === 'string' ? text.trim() : '')
}

// Hat diese Sparte eine Auswahl bekannter Einheiten?
export const hasKnownUnits = (type: MeterType): boolean => FAMILY_OF[type] !== null

// Die Auswahl im Formular: die bekannten Einheiten der Sparte und, wenn gespeichert, eine unbekannte dazu,
// damit das Auswahlfeld zeigt, was gespeichert ist (wie `meterTypeOptions`).
export function meterUnitOptions(type: MeterType, stored: string): string[] {
  const family = FAMILY_OF[type]
  if (family === null) return []
  const labels = UNITS[family].map((u) => u.label)
  const kept = stored.trim()
  return kept === '' || labels.includes(unitLabel(type, kept)) ? labels : [...labels, kept]
}

// Die Prüfung beim Speichern einer neuen oder geänderten Einheit: ein Satz, oder null.
export function unitProblem(type: MeterType, text: string): string | null {
  const family = FAMILY_OF[type]
  if (family === null || knownUnit(type, text) !== null) return null
  return `Die Einheit „${text.trim()}“ kennt Mietfuchs für diese Sparte nicht. Wählen Sie ${UNITS[family].map((u) => u.label).join(', ').replace(/, ([^,]*)$/, ' oder $1')}; Mietfuchs rechnet sie beim Verteilen ineinander um.`
}

export type UnitScaleMeter = { id: string; type: MeterType; unit?: string | null; name?: string | null }
// `factorOf`: womit der Verbrauch eines Zählers malzunehmen ist, damit alle in `unit` stehen. `problem`:
// - `unknown`: Neben anderen Einheiten steht eine, die Mietfuchs für die Sparte nicht kennt (etwa „m³“ an einem
//   Wärmezähler, die Vorgabe vor #142), oder ein Zähler ohne Einheit neben verschiedenen. Gerechnet wird wie vor
//   #342 mit Faktor 1, und die Abrechnung warnt (`meter.unit-unknown`); welche Einheit der Zähler wirklich zeigt,
//   weiß nur der Vermieter, und ein Bestand, der so richtig rechnete, bleibt unverändert.
// - `mixed`: verschiedene bekannte Einheiten ohne Umrechnung (Gas über „Sonstiges“: m³ neben kWh). Das rechnete
//   schon vorher falsch, denn zusammengezählt wurden verschiedene Größen; es wird nicht verteilt (`meter.units-mixed`).
// `meters` nennt alle beteiligten Zähler, für den Satz.
export type UnitScale = {
  unit: string
  converted: boolean
  factorOf: (meterId: string) => number
  problem: null | { kind: 'unknown' | 'mixed'; meters: readonly UnitScaleMeter[] }
}

const stated = (m: UnitScaleMeter): boolean => typeof m.unit === 'string' && m.unit.trim() !== ''

// Eine gemeinsame Einheit für Zähler, deren Verbräuche zusammengezählt werden. **Gefragt werden nur Zähler, die
// im Zeitraum Verbrauch beitragen** (die Auswahl trifft der Aufrufer): Ein stillgelegter Zähler mit alter Einheit
// änderte sonst eine Abrechnung, in der er nichts misst.
//
// `relative` (Verbrauchsschlüssel, Verteilung der eigenen Heizkostenabrechnung): Haben alle dieselbe Einheit, bleibt
// es bei ihr, Faktor 1, auch bei MWh, Litern oder einer unbekannten. Nur verschiedene, alle für die Sparte bekannte
// Einheiten werden in die Grundeinheit umgerechnet (kWh bzw. m³).
// `base` (wo gegen eine absolute Größe verglichen wird: Wärme am Speicher gegen die kWh der Brennstoffrechnung,
// Warmwasservolumen in m³, monatliche Information in kWh und m³): bekannte Einheiten immer in die Grundeinheit.
// Eine unbekannte einheitliche Einheit bleibt bei Faktor 1, wie bisher.
//
// **Ein Zähler ohne Einheit** (leerer Text aus einer alten db.json oder vom Validator geradegerückt; `unit` fehlt
// nur in von Hand gebauten Schnappschüssen der Tests) gilt als „wie die übrigen“: Haben die übrigen eine Einheit,
// gilt sie auch für ihn (Faktor wie sie). Stehen daneben verschiedene, ist er eine unbekannte Einheit. Ohne diese
// Regel änderte der Umstieg einer db.json mit einem Zähler ohne Einheit die Abrechnung.
export function unitScale(meters: readonly UnitScaleMeter[], mode: 'relative' | 'base'): UnitScale {
  const one = (unit: string, problem: UnitScale['problem'] = null): UnitScale => ({ unit, converted: false, factorOf: () => 1, problem })
  const withUnit = meters.filter(stated)
  const keys = new Set(withUnit.map((m) => unitKey(m.type, m.unit)))
  const families = new Set(meters.map((m) => FAMILY_OF[m.type]))
  const family = families.size === 1 ? ([...families][0] ?? null) : null
  const allKnown = family !== null && withUnit.every((m) => knownUnit(m.type, m.unit) !== null)
  const first = withUnit[0]
  if (keys.size <= 1) {
    const label = first ? unitLabel(first.type, first.unit) : ''
    const u = first ? knownUnit(first.type, first.unit) : null
    if (mode === 'relative' || family === null || !allKnown || u === null || label === baseUnitOf(family)) return one(label)
    // Alle in derselben bekannten Einheit, gebraucht in der Grundeinheit: alle umrechnen, auch die ohne Angabe.
    const f = u.num / u.den
    return { unit: baseUnitOf(family), converted: true, factorOf: () => f, problem: null }
  }
  const unstated = withUnit.length < meters.length
  if (allKnown && !unstated && family !== null) {
    const factors = new Map(withUnit.map((m) => {
      const u = knownUnit(m.type, m.unit)
      return [m.id, u ? u.num / u.den : 1] as const
    }))
    return { unit: baseUnitOf(family), converted: true, factorOf: (id) => factors.get(id) ?? 1, problem: null }
  }
  // Ohne Familie (Sonstiges): Sind alle Angaben bekannte Schreibweisen verschiedener Einheiten, wurden verschiedene
  // Größen zusammengezählt. Sonst (eine unbekannte Einheit, eine fehlende) bleibt es bei Faktor 1 mit Warnung.
  const allAliases = withUnit.every((m) => typeof m.unit === 'string' && ALIASES[squash(m.unit)] !== undefined)
  if (family === null && families.size === 1 && allAliases && !unstated) return one('', { kind: 'mixed', meters })
  return one(first ? unitLabel(first.type, first.unit) : '', { kind: 'unknown', meters })
}

// Die Zähler nach Einheit, für einen Hinweis (Durchsicht von #342, S3): „Wärme A“ und „Wärme B“ in m³, „Wärme C“
// in kWh, „Wärme D“ ohne Einheit.
export function metersByUnitText(meters: readonly UnitScaleMeter[]): string {
  const groups = new Map<string, string[]>()
  for (const m of meters) {
    const label = stated(m) ? `in ${unitLabel(m.type, m.unit)}` : 'ohne Einheit'
    groups.set(label, [...(groups.get(label) ?? []), `„${m.name || m.id}“`])
  }
  const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} und ${xs[xs.length - 1]}`)
  return [...groups].map(([label, names]) => `${list(names)} ${label}`).join(', ')
}
