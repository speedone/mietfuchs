// Die Anleitungen der Seite „Hilfe & Begriffe“ (#164): Reihenfolge und Suche, ohne DOM prüfbar.

import { GUIDES, type Guide, type GuideId } from '../../shared/guides.ts'

export type GuideEntry = Guide & { id: GuideId }

// In der Reihenfolge der Daten: vom häufigsten Fall (eine Einliegerwohnung) zum besonderen.
export function allGuides(): GuideEntry[] {
  return (Object.keys(GUIDES) as GuideId[]).map((id) => ({ id, ...GUIDES[id] }))
}

// Gesucht wird im ganzen Text einer Anleitung, auch in Rechtsgrundlagen und Issue-Nummern („#99“).
export function filterGuides(entries: GuideEntry[], query: string): GuideEntry[] {
  const q = query.trim().toLocaleLowerCase('de')
  if (!q) return entries
  return entries.filter((g) => textOf(g).toLocaleLowerCase('de').includes(q))
}

function textOf(g: GuideEntry): string {
  return [
    g.title, g.applies, g.example,
    ...g.steps.map((s) => s.text),
    ...g.result,
    ...g.caveats.flatMap((c) => [c.text, c.norm ?? '']),
    ...g.gaps.flatMap((x) => [x.text, x.issue ? `#${x.issue}` : '']),
  ].join('\n')
}
