import type { HeatingInfoStatement } from '../types'
import { barWidths, comparisonOf, infoLines } from '../heatingInfoView'

// Druckblock „Informationen nach § 6a HeizkostenV“ je Mieter (Heizung PR 14, Entwurf 8.8): die Angaben der Anlage
// und nur der Vergleich dieses Mieters, der witterungsbereinigte als Balken (§ 6a Abs. 3 Satz 1 Nr. 5).
const fmt = (v: number): string => v.toLocaleString('de-DE', { maximumFractionDigits: 0 })

export default function HeatingInfoBlock({ info, tenancyId, plantName }: { info: HeatingInfoStatement; tenancyId: string; plantName: string }) {
  const c = comparisonOf(info, tenancyId)
  return (
    <div className="co2-block heating-info-block">
      <h3>Informationen nach § 6a HeizkostenV{plantName ? ` · ${plantName}` : ''}</h3>
      {infoLines(info).map((l) => <p key={l}>{l}</p>)}
      {c && c.lines.map((l) => <p key={l}>{l}</p>)}
      {c && c.bars.map((b) => {
        const [now, prev] = barWidths([b.now, b.prev])
        return (
          <div key={b.label} className="info-bars" role="img" aria-label={`${b.label}: dieser Zeitraum ${fmt(b.now)} ${b.unit}, vorhergehender Zeitraum ${fmt(b.prev)} ${b.unit}`}>
            <div className="info-bar-row"><span>{b.label}, dieser Zeitraum: {fmt(b.now)} {b.unit}</span><div className="info-bar-track"><div className="info-bar" style={{ width: `${now}%` }} /></div></div>
            <div className="info-bar-row"><span>{b.label}, vorhergehender Zeitraum: {fmt(b.prev)} {b.unit}</span><div className="info-bar-track"><div className="info-bar prev" style={{ width: `${prev}%` }} /></div></div>
          </div>
        )
      })}
    </div>
  )
}
