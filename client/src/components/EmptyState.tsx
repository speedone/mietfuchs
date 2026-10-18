// Leerzustand (#346, Schritt 10; Spezifikation Abschnitt 6): ein Satz, was fehlt, und der Knopf, der
// dorthin führt. Kein gesperrter Knopf ohne Grund, keine vorbelegten Felder (UI-Durchsicht M14, N12).
import type { ReactNode } from 'react'

export default function EmptyState({ children, action, secondary }: {
  children: ReactNode
  action?: { label: string, onClick: () => void } | null
  secondary?: { label: string, onClick: () => void } | null
}) {
  return (
    <div className="empty" data-empty-state="">
      <p>{children}</p>
      {(action || secondary) && (
        <div className="row centered">
          {action && <button type="button" className="btn" onClick={action.onClick}>{action.label}</button>}
          {secondary && <button type="button" className="btn secondary" onClick={secondary.onClick}>{secondary.label}</button>}
        </div>
      )}
    </div>
  )
}
