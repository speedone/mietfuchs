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

// Die Buchstabenleiste der Begriffe (N10 aus #341): je Anfangsbuchstabe der erste Begriff. Umlaute stehen beim
// Grundbuchstaben („Überschuss“ bei U), wie die deutsche Sortierung sie einordnet.
export const letterOf = (title: string): string => title.normalize('NFD').replace(/\p{M}/gu, '').charAt(0).toUpperCase()

export function termLetters(entries: readonly TermEntry[]): { letter: string; id: TermId }[] {
  const out: { letter: string; id: TermId }[] = []
  for (const e of entries) {
    const letter = letterOf(e.title)
    if (!out.some((x) => x.letter === letter)) out.push({ letter, id: e.id })
  }
  return out
}
