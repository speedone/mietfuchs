// Eigene Kostenarten (gewerbliche Abrechnung): die Entscheidungen des Seitenfensters und der Vorjahresübernahme, ohne
// DOM prüfbar. Dieselben Prüfungen wie der Server (server/src/db/costTypes.ts).
import type { CostType } from './types'
import { CATEGORIES } from './types'
import type { Problem } from './formProblems'

export type CostTypeDraft = { name: string; baseCategory: string }
export const EMPTY_COST_TYPE_DRAFT: CostTypeDraft = { name: '', baseCategory: 'Sonstige Betriebskosten' }
export const costTypeDraftOf = (t: Pick<CostType, 'name' | 'baseCategory'>): CostTypeDraft => ({ name: t.name, baseCategory: t.baseCategory })
export const COST_TYPE_NAME_MAX = 80

const same = (a: string, b: string): boolean => a.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE') === b.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE')

export function costTypeProblems(d: CostTypeDraft, types: readonly Pick<CostType, 'id' | 'name'>[], ownId: string | null): Problem<'name' | 'baseCategory'>[] {
  const problems: Problem<'name' | 'baseCategory'>[] = []
  const name = d.name.trim()
  if (name === '') problems.push({ field: 'name', short: 'Name fehlt', text: 'Name: Geben Sie der Kostenart einen Namen, etwa „Sicherheitsdienst“.' })
  else if (name.length > COST_TYPE_NAME_MAX) problems.push({ field: 'name', short: `Höchstens ${COST_TYPE_NAME_MAX} Zeichen`, text: `Name: höchstens ${COST_TYPE_NAME_MAX} Zeichen.` })
  else if (types.some((t) => t.id !== ownId && same(t.name, name))) problems.push({ field: 'name', short: 'Gibt es schon', text: `Name: Die Kostenart „${name}“ gibt es in diesem Zeitraum schon.` })
  if (!CATEGORIES.includes(d.baseCategory)) problems.push({ field: 'baseCategory', short: 'Bitte wählen', text: 'Rechnet als: Bitte wählen Sie die Grundart.' })
  return problems
}

// Die eigene Kostenart einer Position des Vorzeitraums im gewählten Zeitraum: die gleichnamige, sonst keine (die Position
// behält dann ihre Grundart). Eine Kostenart gilt je Zeitraum, ihre Kennung also nie in einem anderen.
export function carriedTypeId(previousTypeId: string | null | undefined, all: readonly Pick<CostType, 'id' | 'name' | 'period'>[], period: string): string {
  if (!previousTypeId) return ''
  const before = all.find((t) => t.id === previousTypeId)
  if (!before) return ''
  return all.find((t) => t.period === period && same(t.name, before.name))?.id ?? ''
}

// Die Kostenart, wie eine Zeile der Abrechnung sie nennt: die eigene, wo es eine gibt, sonst die von Mietfuchs.
export const rowCategory = (r: { category: string; costType?: string }): string => r.costType ?? r.category
