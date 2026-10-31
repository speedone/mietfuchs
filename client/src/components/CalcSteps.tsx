// Der Rechenweg einer Zeile zum Aufklappen (#114). Die Zeile selbst rendert die Seite über
// `children` und bekommt den Knopf gereicht; darunter erscheint auf Wunsch eine Zeile mit den
// Schritten. Beides trägt `no-print`: Der Ausdruck ist das Dokument für den Mieter und bleibt,
// wie er ist.

import { useId, useState, type ReactNode } from 'react'
import { stepsOf } from '../calcSteps'
import type { CalcStep, SettlementRow } from '../types'
import Term from './Term'
import DisclosureButton from './DisclosureButton'

// `open` von außen (Seite Abrechnung: ein Schalter „Rechenweg zeigen“ für die ganze Aufstellung) ersetzt den Knopf je
// Zeile; `toggle` ist dann leer.
export default function CalcSteps({ row, colSpan, open: shown, children }: { row: SettlementRow; colSpan: number; open?: boolean; children: (toggle: ReactNode) => ReactNode }) {
  const [own, setOpen] = useState(false)
  const stepsId = useId()
  const open = shown ?? own
  const { steps, complete } = stepsOf(row)
  const toggle = shown !== undefined ? null : (
    <DisclosureButton open={open} onToggle={() => setOpen((o) => !o)} closedLabel="Rechenweg" openLabel="Rechenweg schließen" controls={stepsId} className="btn small secondary no-print calc-toggle" />
  )
  return (
    <>
      {children(toggle)}
      {open && (
        <tr id={stepsId} className="calc-steps no-print">
          <td colSpan={colSpan}>
            <ol className="calc-steps-list">
              {steps.map((s, i) => <Step key={i} step={s} />)}
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

// Die Schritte als Liste, für Rechenwege, die nicht an einer Zeile der Abrechnung hängen (die
// Steuerübersicht, #163).
export function StepList({ steps }: { steps: CalcStep[] }) {
  return (
    <ol className="calc-steps-list">
      {steps.map((s, i) => <Step key={i} step={s} />)}
    </ol>
  )
}

// Ein Schritt. Die Erklärung seines Begriffs öffnet als Popover (#346, Schritt 6) und schiebt die Zeile nicht
// auseinander; vorher stand sie zwischen Beschriftung und Wert, dann unter der ganzen Zeile (#142).
function Step({ step }: { step: CalcStep }) {
  return (
    <li>
      <span className="calc-step-label">
        {step.term ? <Term id={step.term}>{step.label}</Term> : step.label}:
      </span> {step.value}
    </li>
  )
}
