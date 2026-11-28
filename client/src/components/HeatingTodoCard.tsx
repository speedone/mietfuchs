import Card from './Card'
import { TODO_LIGHT_WORD, TODO_PAGE_LABEL, todoCardLabel, todoPlantLabel, todoSummary, type TodoStep } from '../heatingPageView'
import type { Light } from '../heatingSelfView'

// Die Farbe der Ampel, wie im Cockpit.
const AMPEL: Record<Light, string> = { green: 'gruen', yellow: 'gelb', red: 'rot' }

// Karte „Was fehlt noch“ der Seite Heizkosten bei eigener Abrechnung (#690 Punkt 6): je Heizperiode die nötigen
// Schritte in der Reihenfolge der Arbeit, jeder mit seinem Stand. Reine Anzeige (`selfTodos`): Der Stand folgt den
// Hinweisen der Abrechnung und steht als Wort vor dem Titel, nicht nur als Farbe.
// `extra`: Fehler und Warnungen der Abrechnung zur Heizung ohne eigene Zeile. `separate`: Die Heizperiode wird getrennt
// abgerechnet und steht deshalb nicht in der Abrechnung des Zeitraums, aus der die Liste liest.
// `onCard`: springt zur Karte eines Schritts auf dieser Seite (Durchsicht S2); `onPlant` zu einer anderen Anlage
// derselben Linie (Kesseltausch, Nachprüfung M1).
export default function HeatingTodoCard({ steps, extra, separate, onNavigate, onCard, onPlant }: {
  steps: readonly TodoStep[]; extra: number; separate?: boolean; onNavigate?: (page: NonNullable<TodoStep['page']>) => void
  onCard?: (card: string) => void; onPlant?: (plantId: string) => void
}) {
  return (
    <Card title="Was fehlt noch" level={3} className="no-print">
      <p className="muted">{todoSummary(steps, extra)} Die Liste folgt den Hinweisen der Abrechnung dieser Heizperiode.</p>
      {separate && <p className="muted">Diese Heizperiode rechnen Sie getrennt ab. Ihren Stand prüft die Seite Abrechnung unter der Heizkostenabrechnung, nicht diese Liste.</p>}
      <div className="checklist">
        {steps.map((s) => {
          const page = s.page
          const card = s.card
          return (
            <div key={s.id} className={`check-row ${s.light === 'green' ? '' : AMPEL[s.light]}`}>
              <span className={`ampel ${AMPEL[s.light]}`} />
              <div className="grow">
                <div className="check-title"><span className="sr-only">{TODO_LIGHT_WORD[s.light]}: </span>{s.title}</div>
                <div className="muted">{s.detail}</div>
              </div>
              {page !== undefined && s.light !== 'green' && onNavigate && (
                <button className="btn ghost" type="button" onClick={() => onNavigate(page)}>{TODO_PAGE_LABEL[page]} →</button>
              )}
              {s.plant !== undefined && onPlant && (
                <button className="btn ghost" type="button" onClick={() => s.plant && onPlant(s.plant.id)}>{todoPlantLabel(s.plant.name)} ↓</button>
              )}
              {page === undefined && card !== undefined && s.light !== 'green' && onCard && (
                <button className="btn ghost" type="button" onClick={() => onCard(card)}>{todoCardLabel(card)} ↓</button>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
