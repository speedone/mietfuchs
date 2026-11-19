// Karte „Demnächst fällig“ im Cockpit (#190): Fristen und Erinnerungen des gewählten Objekts, nach Tag geordnet, je
// mit Stufe als Wort (nicht nur als Farbe) und einem Knopf an die Stelle, an der man sie erledigt. Texte und Ziele in
// upcomingView.ts; ohne Einträge fehlt die Karte.
import { fmtDate } from '../api'
import type { UpcomingDeadlines } from '../types'
import { upcomingRows, type UpcomingAction, type UpcomingLevel } from '../upcomingView'
import Card from './Card'
import Term from './Term'

const BADGE: Record<UpcomingLevel, string> = { overdue: 'badge red', open: 'badge', info: 'badge gray' }

export default function UpcomingCard({ list, onAction }: { list: UpcomingDeadlines | null; onAction: (action: UpcomingAction) => void }) {
  if (!list) return null
  const rows = upcomingRows(list)
  if (rows.length === 0) return null
  return (
    <Card title="Demnächst fällig">
      <p className="muted">
        Für dieses Objekt: Abgelaufenes und was bis zum {fmtDate(list.until)} endet, Eichfristen ein Jahr vorher.
        Gerechnet aus Ihren Angaben; mehr unter <Term id="settlementDeadline">Abrechnungsfrist</Term> und <Term id="objectionDeadline">Einwendungsfrist</Term>.
      </p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col items-start gap-1" data-upcoming={r.id}>
            <div>
              <span className={BADGE[r.level]}>{r.levelText}</span>{' '}
              <strong>{r.title}</strong>{' '}
              <span className="muted">{r.when}</span>
            </div>
            <div className="muted">{r.detail}</div>
            <button type="button" className="btn small secondary" onClick={() => onAction(r.action)}>{r.action.label}</button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
