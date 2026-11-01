// Die Seite „Hilfe“ (#113): alle Begriffe des Lexikons, sortiert und durchsuchbar, ohne DOM
// prüfbar.

import { GLOSSARY, type Term, type TermId } from '../../shared/glossary.ts'
import { searchQuery, searchText } from './searchText'

export type TermEntry = Term & { id: TermId }

// Mit fest eingestelltem Deutsch, sonst stünde „Übersicht“ je nach Rechner hinter „Zähler“.
export function sortedTerms(): TermEntry[] {
  return (Object.keys(GLOSSARY) as TermId[])
    .map((id) => ({ id, ...GLOSSARY[id] }))
    .sort((a, b) => a.title.localeCompare(b.title, 'de'))
}

export function filterTerms(entries: TermEntry[], query: string): TermEntry[] {
  const q = searchQuery(query)
  if (!q) return entries
  return entries.filter((t) => [t.title, t.short, t.norm ?? ''].some((text) => searchText(text).includes(q)))
}

// Der Anfangsbuchstabe eines Begriffs, Trenner in der Liste des Lexikons (N10 aus #341, #488 Teil 3). Umlaute stehen beim
// Grundbuchstaben („Überschuss“ bei U), wie die deutsche Sortierung sie einordnet; was mit einer Ziffer oder einem
// Zeichen beginnt, steht unter „#“.
export const letterOf = (title: string): string => {
  const first = title.normalize('NFD').replace(/\p{M}/gu, '').charAt(0).toUpperCase()
  return /\p{L}/u.test(first) ? first : '#'
}

