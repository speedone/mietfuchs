// Druckansicht „CO₂-Angaben für den Messdienst“ (Heizung PR 17, #210): die Rechnungen einer Heizperiode
// mit den Angaben nach § 3 Abs. 1 CO2KostAufG, zum Ausdrucken oder Weitergeben. Die Seite Heizkosten zeigt
// sie an Stelle ihrer Karten; die Logik der Texte steht in co2Sheet.ts.
import { useEffect, useState } from 'react'
import { api, errorText } from '../api'
import { SHEET_COLUMNS, sheetFacts, sheetHead, sheetRows } from '../co2Sheet'
import Table from './Table'
import type { Co2Sheet } from '../types'

export default function Co2SheetView({ plantId, period, onClose }: { plantId: string; period: string; onClose: () => void }) {
  const [sheet, setSheet] = useState<Co2Sheet | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<Co2Sheet>(`/api/heating-plants/${encodeURIComponent(plantId)}/periods/${encodeURIComponent(period)}/co2-sheet`).then(setSheet).catch((e: unknown) => setError(errorText(e)))
  }, [plantId, period])
  const back = <button className="btn secondary" type="button" onClick={onClose}>Zurück zu den Heizkosten</button>
  if (error) return <div className="card"><div className="error">{error}</div><div className="row no-print">{back}</div></div>
  if (!sheet) return <div className="card"><p className="muted">Wird geladen …</p></div>
  const head = sheetHead(sheet)
  const findings = sheet.deliveries.flatMap((d) => d.findings)
  return (
    <div className="card">
      <div className="no-print">
        <p className="muted">
          Dieses Blatt fasst die CO₂-Angaben Ihrer Rechnungen für die Heizperiode zusammen. Geben Sie es dem Messdienst, der
          Gemeinschaft oder Ihrem Steuerbüro, wenn diese die CO₂-Kosten aufteilen sollen. Die Rechnungen stehen vollständig darin, auch
          wenn sie über die Heizperiode hinausreichen: Abgegrenzt wird beim Messdienst.
        </p>
        <div className="row">
          <button className="btn" type="button" onClick={() => window.print()}>Drucken</button>
          {back}
        </div>
      </div>
      <h2>{head.title}</h2>
      {head.lines.map((l) => <p key={l}>{l}</p>)}
      {sheet.deliveries.length === 0
        ? <p>Für diese Heizperiode sind keine Rechnungen eingetragen.</p>
        : (
          <Table>
            <thead><tr><th>Rechnung</th>{SHEET_COLUMNS.map((c, j) => <th key={c} className={j >= 5 ? 'num' : undefined}>{c}</th>)}</tr></thead>
            <tbody>
              {sheetRows(sheet).map((r, i) => (
                <tr key={`${r.label}:${i}`} className={r.kind === 'sum' ? 'subtotal' : undefined}>
                  <td>{r.label}{r.note && <div className="muted">{r.note}</div>}</td>
                  {r.cells.map((c, j) => <td key={j} className={j >= 5 ? 'num' : undefined}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      <ul>{sheetFacts(sheet).map((f) => <li key={f}>{f}</li>)}</ul>
      {findings.length > 0 && (
        // Für den Vermieter, nicht für den Empfänger des Blatts (Durchsicht von #246, R-W2).
        <div className="hint no-print">
          <strong>Bitte prüfen</strong>
          <ul>{findings.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}
    </div>
  )
}
