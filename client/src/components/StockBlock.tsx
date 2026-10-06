// Der Druckblock „Bestandsrechnung Brennstoff“ in der Abrechnung eines Mieters (Heizung PR 8, Entwurf
// 8.2, 9.5). Er erklärt die Zeilen „aus dem Vorrat“ und „im Vorrat“ und wird mitgedruckt.
import Table from './Table'
import type { StockBlockView } from '../stockView'

export default function StockBlock({ view }: { view: StockBlockView | null }) {
  if (!view) return null
  return (
    <div className="co2-block">
      <h3>{view.title}</h3>
      <Table>
        <tbody>
          {view.lines.map((l) => <tr key={l.label}><td>{l.label}</td><td className="num">{l.value}</td></tr>)}
        </tbody>
      </Table>
      {view.notes.map((n) => <p key={n} className="muted">{n}</p>)}
    </div>
  )
}
