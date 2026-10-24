// Die Liste der Mietverhältnisse in den Stammdaten: laufende und künftige oben, beendete darunter in einem eingeklappten
// Abschnitt „Frühere Mietverhältnisse (N)“, neueste zuerst. Mit zehn Jahren Mieterwechseln standen sonst 82 Zeilen
// gemischt, und der heutige Mieter einer Wohnung stand zwischen seinen Vorgängern (Leistungsprüfung mit großem Bestand).
//
// Bezug ist **heute** (Ortszeit), wie die übrige Seite (`defaultTenancyUnitId`, „laufend“ in der Spalte Zeitraum): Die
// Stammdaten zeigen keinen Abrechnungszeitraum. Ein Mietverhältnis, das heute endet, läuft noch; eines, das gestern
// endete, ist beendet. Ein künftiges (Einzug nach heute) gehört nach oben, denn um dieses geht es als nächstes.

export type TenancyPhase = 'current' | 'future' | 'former'

type Dated = { id: string, start: string, end?: string | null }

export function tenancyPhase(t: Dated, today: string): TenancyPhase {
  if (t.end && t.end < today) return 'former'
  if (t.start > today) return 'future'
  return 'current'
}

// ISO-Daten und Kennungen Zeichen für Zeichen, ohne Locale.
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

// Laufende und künftige in der Reihenfolge der Liste, beendete nach Auszug absteigend (bei gleichem Auszug nach Einzug,
// dann nach Kennung, damit die Reihenfolge feststeht).
export function splitTenancies<T extends Dated>(list: readonly T[], today: string): { current: T[], former: T[] } {
  const current = list.filter((t) => tenancyPhase(t, today) !== 'former')
  const former = list
    .filter((t) => tenancyPhase(t, today) === 'former')
    .sort((a, b) => cmp(b.end ?? '', a.end ?? '') || cmp(b.start, a.start) || cmp(a.id, b.id))
  return { current, former }
}
