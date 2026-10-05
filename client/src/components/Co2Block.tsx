// Der Druckblock „CO₂-Kostenaufteilung“ in der Abrechnung eines Mieters (Heizung PR 6, Entwurf 9.5).
// Gedruckt wird er mit, denn er ist der Ausweis nach § 7 Abs. 3 CO2KostAufG.
import Table from './Table'
import type { Co2BlockView } from '../co2View'

export default function Co2Block({ view }: { view: Co2BlockView | null }) {
  if (!view) return null
  return (
    <div className="co2-block">
      <h3>{view.title}</h3>
      <Table>
        <tbody>
          {view.lines.map((l) => (
            <tr key={l.label}><td>{l.label}</td><td className="num">{l.value}</td></tr>
          ))}
        </tbody>
      </Table>
      <Table>
        <thead>
          <tr><th>CO₂-Ausstoß je m² und Jahr</th><th className="num">Anteil Vermieter</th></tr>
        </thead>
        <tbody>
          {view.table.map((s) => (
            <tr key={s.range}><td>{s.marked ? <strong>{s.range} ◀</strong> : s.range}</td><td className="num">{s.marked ? <strong>{s.percent}</strong> : s.percent}</td></tr>
          ))}
        </tbody>
      </Table>
      {view.notes.map((n) => <p key={n} className="muted">{n}</p>)}
    </div>
  )
}
