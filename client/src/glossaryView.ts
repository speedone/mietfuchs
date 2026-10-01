// Die Seite „Hilfe“ (#113): alle Begriffe des Lexikons, sortiert und durchsuchbar, ohne DOM
// prüfbar.

import { GLOSSARY, type Term, type TermId } from '../../shared/glossary.ts'

export type TermEntry = Term & { id: TermId }

// Mit fest eingestelltem Deutsch, sonst stünde „Übersicht“ je nach Rechner hinter „Zähler“.
export function sortedTerms(): TermEntry[] {
  return (Object.keys(GLOSSARY) as TermId[])
    .map((id) => ({ id, ...GLOSSARY[id] }))
    .sort((a, b) => a.title.localeCompare(b.title, 'de'))
}

export function filterTerms(entries: TermEntry[], query: string): TermEntry[] {
  const q = query.trim().toLocaleLowerCase('de')
  if (!q) return entries
  return entries.filter((t) => [t.title, t.short, t.norm ?? ''].some((text) => text.toLocaleLowerCase('de').includes(q)))
}
