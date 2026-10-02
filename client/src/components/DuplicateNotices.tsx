import type { CostItem } from '../types'
import { candidateText, type AiRow, type DuplicateGroup, type LinkOffer } from '../triage'

// Die Hinweise unter der Tabelle einer KI-Auswertung, wenn dieselbe Rechnung schon erfasst sein
// könnte (shared/duplicates.ts), etwa als Übernahme aus dem Vorjahr mit Schätzbetrag. Sie stehen
// unter und nicht in der Tabelle: In einer Zeile scrollten sie auf dem Handy mit der Tabelle zur
// Seite und wären abgeschnitten (zweite Durchsicht). Schnellerfassung und Kostenseite zeigen sie
// gleich.
export default function DuplicateNotices({ groups, rows, year, busy, onLink, onOpen }: {
  groups: DuplicateGroup[]
  rows: readonly AiRow[]
  year: number
  busy?: boolean
  onLink: (group: DuplicateGroup, offer: LinkOffer) => void
  onOpen?: (item: CostItem) => void
}) {
  const linked = new Map<string, string[]>()
  for (const r of rows) if (r.linked) linked.set(r.linked, [...(linked.get(r.linked) ?? []), r.description])
  if (groups.length === 0 && linked.size === 0) return null
  const names = (g: DuplicateGroup) => g.rows.map((i) => `„${rows[i]?.description ?? ''}“`).join(', ')
  return (
    <div className="duplicate-notices no-print" style={{ marginTop: 8 }}>
      {[...linked].map(([target, descs]) => (
        <div key={`l-${target}`}><span className="badge green">✓ {descs.map((d) => `„${d}“`).join(', ')} verknüpft mit „{target}“</span></div>
      ))}
      {groups.map((g) => {
        const other = g.candidates.filter((c) => !g.offers.some((o) => o.target.id === c.id) && !g.formOnly.includes(c))
        return (
          <div key={g.rows.join('-')} className="warn" style={{ marginTop: 6 }}>
            {names(g)}: Für {year} schon erfasst: {g.candidates.map(candidateText).join(', ')}.{' '}
            {g.offers.length > 0 && 'Ist das dieselbe Rechnung, verknüpfen Sie den Beleg mit der Position. '}
            {g.formOnly.length > 0 && 'Bei einer Position laut Gemeinschaftsabrechnung oder mit Einzelbeträgen pflegen Sie Betrag und Angaben im Formular. '}
            {g.offers.length === 0 && g.formOnly.length === 0 && other.length > 0 && 'Ist das dieselbe Rechnung, übernehmen Sie die Zeile bitte nicht. '}
            Ist es eine zweite Rechnung, haken Sie die Zeile an und legen sie als neue Position an.
            {(g.offers.length > 0 || (g.formOnly.length > 0 && onOpen)) && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                {g.offers.map((o) => (
                  <div key={o.target.id}>
                    <button type="button" className="btn small secondary" style={{ whiteSpace: 'normal', textAlign: 'left' }}
                      disabled={busy || 'error' in o.built} onClick={() => onLink(g, o)}>
                      {o.label}
                    </button>
                    {o.note && <div className="muted">{o.note}</div>}
                    {'error' in o.built && <div className="muted">Nicht möglich: {o.built.error}</div>}
                  </div>
                ))}
                {onOpen && g.formOnly.map((c) => (
                  <button key={c.id} type="button" className="btn small secondary" style={{ whiteSpace: 'normal', textAlign: 'left' }} onClick={() => onOpen(c)}>
                    Position „{c.description}“ öffnen
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
