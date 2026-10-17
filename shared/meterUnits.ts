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

// Zum Vergleichen zweier Einheiten: die bekannte in ihrer Schreibweise, sonst der Text ohne
// Groß-/Kleinschreibung und Leerzeichen am Rand.
export function unitKey(type: MeterType, text: string | null | undefined): string {
  return knownUnit(type, text)?.label ?? (typeof text === 'string' ? text.normalize('NFC').trim().toLowerCase() : '')
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

export type UnitScaleMeter = { id: string; type: MeterType; unit?: string | null }
// `factorOf`: womit der Verbrauch eines Zählers malzunehmen ist, damit alle in `unit` stehen.
export type UnitScale =
  | { ok: true; unit: string; converted: boolean; factorOf: (meterId: string) => number }
  | { ok: false; units: string[] }

// Eine gemeinsame Einheit für Zähler, deren Verbräuche zusammengezählt werden.
//
// `relative`: Haben alle dieselbe Einheit, bleibt es bei ihr (Faktor 1, auch wenn sie unbekannt ist).
// Sonst rechnet Mietfuchs in die Grundeinheit der Sparte um, wenn jede Einheit bekannt ist und alle zu
// derselben Sparte gehören; sonst gibt es keine gemeinsame Einheit (`ok: false`).
// `base`: wie `relative`, aber bekannte Einheiten immer in die Grundeinheit, denn dort steht der Verbrauch
// in kWh bzw. m³ in Sätzen, neben Schätzungen und gegen die kWh der Brennstoffrechnung (eigene
// Heizkostenabrechnung). Sind alle Einheiten gleich und unbekannt, bleibt es wie bisher bei Faktor 1.
//
// **Ein Zähler ohne Einheit** (leerer Text aus einer alten db.json oder vom Validator geradegerückt; `unit`
// fehlt nur in von Hand gebauten Schnappschüssen der Tests) gilt als „wie die übrigen“: Haben die übrigen
// dieselbe Einheit, bleibt es überall bei Faktor 1, wie vor #342. Sonst müsste Mietfuchs raten, welche Einheit er
// zeigt, und es gibt keine gemeinsame. Ohne diese Regel änderte der Umstieg einer db.json mit einem Zähler ohne
// Einheit die Abrechnung, und die Regression ließe ihn nicht zu.
export function unitScale(meters: readonly UnitScaleMeter[], mode: 'relative' | 'base'): UnitScale {
  const one = (unit: string): UnitScale => ({ ok: true, unit, converted: false, factorOf: () => 1 })
  const stated = meters.filter((m) => typeof m.unit === 'string' && m.unit.trim() !== '')
  const unstated = stated.length < meters.length
  const keys = [...new Set(stated.map((m) => unitKey(m.type, m.unit)))]
  const known = stated.map((m) => ({ m, u: knownUnit(m.type, m.unit), family: FAMILY_OF[m.type] }))
  const families = new Set([...known.map((k) => k.family), ...meters.map((m) => FAMILY_OF[m.type])])
  const allKnown = known.every((k) => k.u !== null) && families.size === 1
  const family = [...families][0] ?? null
  if (keys.length <= 1) {
    const first = stated[0]
    const label = first ? unitLabel(first.type, first.unit) : ''
    // In der Grundeinheit gebraucht und alle in derselben bekannten, aber nicht in ihr (alle in MWh): umrechnen,
    // wenn keiner ohne Einheit ist.
    const toBase = mode === 'base' && allKnown && family !== null && first !== undefined && label !== baseUnitOf(family)
    if (!toBase) return one(label)
    if (unstated) return { ok: false, units: [label, '(ohne Einheit)'] }
  }
  if (!allKnown || family === null || unstated) {
    return { ok: false, units: [...new Set(meters.map((m) => unitLabel(m.type, m.unit) || '(ohne Einheit)'))] }
  }
  const factors = new Map(known.map((k) => [k.m.id, k.u ? k.u.num / k.u.den : 1]))
  return { ok: true, unit: baseUnitOf(family), converted: true, factorOf: (id) => factors.get(id) ?? 1 }
}
