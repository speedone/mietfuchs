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
  return entries.filter((g) => guideTexts(g).join('\n').toLocaleLowerCase('de').includes(q))
}

// Die Texte einer Anleitung, vorne der Titel, dann in der Reihenfolge der Seite; die Suche zeigt den ersten, in dem das
// gesuchte Wort steht, als Ausschnitt (helpView.ts).
export function guideTexts(g: GuideEntry): string[] {
  return [
    g.title, g.applies,
    ...g.steps.map((s) => s.text),
    ...g.result,
    g.example,
    ...g.caveats.flatMap((c) => [c.text, c.norm ?? '']),
    ...g.gaps.flatMap((x) => [x.text, x.issue ? `#${x.issue}` : '']),
  ].filter((t) => t !== '')
}
