// Der Druckblock „Brennstoff“ in der Abrechnung eines Mieters (Heizung PR 7). Gedruckt wird er mit.
import Table from './Table'
import type { FuelBlockView } from '../fuelView'
import { softBreak } from '../softBreak'

export default function FuelBlock({ view }: { view: FuelBlockView | null }) {
  if (!view) return null
  return (
    <div className="co2-block">
      <h3>{view.title}</h3>
      <Table>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.label}><td>{softBreak(r.label)}</td><td className="num wraps">{r.value}</td></tr>
          ))}
        </tbody>
      </Table>
      {view.notes.map((n) => <p key={n} className="muted">{n}</p>)}
    </div>
  )
}
