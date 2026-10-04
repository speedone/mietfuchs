// Prüfungen des Cockpits, ohne DOM prüfbar (cockpitChecks.test.ts).
import type { CostItem, MeterType } from './types'
import { isNotAllocable } from './types'
import { fmtEuro } from './api'
import { andList, countOf } from '../../shared/wording.ts'

// Nicht umlagefähige Positionen werden nie verteilt (calc.ts, `isNotAllocable`), ihr gespeicherter
// Schlüssel bedeutet also nichts (#142). Zählten sie mit, verlangte das Cockpit Ablesungen für eine
// Verwaltungsrechnung oder prüfte die Verteilbasis wegen der Erhaltungsrücklage.
const allocable = (items: CostItem[]) => items.filter((c) => !isNotAllocable(c.category))

// Die Zählertypen, nach denen im Jahr verbrauchsabhängig umgelegt wird.
export function meterTypesInUse(items: CostItem[]): Set<MeterType | null | undefined> {
  return new Set(allocable(items).filter((c) => c.key === 'meter').map((c) => c.meterType))
}

// Kommt ein Schlüssel vor, dessen Verteilbasis die Wohnungen bilden? Auch die Gemeinschaftsabrechnung
// (#105) verteilt über die Wohnungen der Einheit.
export function usesUnitBasis(items: CostItem[]): boolean {
  return allocable(items).some((c) => c.key === 'area' || c.key === 'units' || c.key === 'persons' || c.key === 'external')
}

// Die grünen Zeilen „Mietverhältnisse & Flächen“ und „Belege erfasst“, mit Ein- und Mehrzahl statt
// „Mietverhältnis(se)“ oder „Position(en)“ (#180).
export function tenanciesDetail(tenancies: number, notSettled: number, participating: number, zeroArea: string[]): string {
  return `${countOf(tenancies, 'Mietverhältnis', 'Mietverhältnisse')}${notSettled > 0 ? `, davon ${notSettled} ohne Abrechnung` : ''}` +
    ` · ${countOf(participating, 'beteiligte Wohnung', 'beteiligte Wohnungen')} · ` +
    (zeroArea.length > 0 ? `0 m² und 0 Personen: ${andList(zeroArea)}` : 'vollständig')
}

export function itemsDetail(items: number, sumCents: number, files: number): string {
  return `${countOf(items, 'Position', 'Positionen')} · Summe ${fmtEuro(sumCents)}${files ? ` · ${countOf(files, 'Belegdatei', 'Belegdateien')}` : ''}`
}
