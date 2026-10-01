// Der Rechenweg einer Zeile zum Aufklappen (#114). Die Zeile selbst rendert die Seite über
// `children` und bekommt den Knopf gereicht; darunter erscheint auf Wunsch eine Zeile mit den
// Schritten. Beides trägt `no-print`: Der Ausdruck ist das Dokument für den Mieter und bleibt,
// wie er ist.

import { useState, type ReactNode } from 'react'
import { stepsOf } from '../calcSteps'
import type { SettlementRow } from '../types'
import Term from './Term'

export default function CalcSteps({ row, colSpan, children }: { row: SettlementRow; colSpan: number; children: (toggle: ReactNode) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const { steps, complete } = stepsOf(row)
  const toggle = (
    <button type="button" className="btn small secondary no-print calc-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
      {open ? 'Rechenweg schließen' : 'Rechenweg'}
    </button>
  )
  return (
    <>
      {children(toggle)}
      {open && (
        <tr className="calc-steps no-print">
          <td colSpan={colSpan}>
            <ol className="calc-steps-list">
              {steps.map((s, i) => (
                <li key={i}>
                  <span className="calc-step-label">{s.term ? <Term id={s.term}>{s.label}</Term> : s.label}:</span> {s.value}
                </li>
              ))}
            </ol>
            {!complete && (
              <div className="muted">Diese Abrechnung wurde abgeschlossen, bevor Mietfuchs den ausführlichen Rechenweg festhielt; zu sehen ist, was sie selbst enthält.</div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
