import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { MOBILE_QUERY, useMediaQuery } from './MobileNav'
import { useSwitchTo } from '../period'
import { useProperty, withProperty } from '../property'
import { arrivalSummary, type Arrival as ArrivalKind, type ArrivalStock, type ArrivalSummary } from '../relocation'
import { rulesOf } from '../../../shared/period.ts'
import type { CostItem, Tenancy } from '../types'

// Einmal nach Umzug, Backup oder neuerem Stand (Praxistest B-04, E-04, F-04, H-04, P-05): Das Cockpit stand im
// aktuellen Jahr bei „0,00 €“, obwohl die Kosten in einem früheren Jahr liegen, und das sah aus wie Datenverlust. Hier
// steht, was da ist, und die Oberfläche springt in den Zeitraum mit den jüngsten erfassten Kosten. Die Entscheidung
// steht in relocation.ts (`arrivalSummary`); den Anlass bringt die Adresse über das Neuladen (`?arrived=…`).
export default function Arrival({ arrival, onClose }: { arrival: ArrivalKind, onClose: () => void }) {
  const { properties, property } = useProperty()
  const switchTo = useSwitchTo()
  const [summary, setSummary] = useState<ArrivalSummary | null>(null)
  const asked = useRef(false)
  // Am Handy steht „Verstanden“ unter dem Text
  const mobile = useMediaQuery(MOBILE_QUERY)

  useEffect(() => {
    if (asked.current) return
    asked.current = true
    const currentId = property?.id ?? null
    Promise.all(properties.map(async (p): Promise<ArrivalStock> => {
      const [tenancies, costs] = await Promise.all([
        api<Tenancy[]>(withProperty('/api/tenancies', p.id)),
        api<CostItem[]>(withProperty('/api/costItems', p.id)),
      ])
      return { property: { id: p.id, name: p.name, rules: rulesOf(p) }, tenancies: tenancies.length, periods: costs.map((c) => c.period) }
    }))
      .then((stock) => setSummary(arrivalSummary(arrival, stock, currentId)))
      // Lässt sich nichts lesen, bleibt es beim Satz ohne Zahlen
      .catch(() => setSummary(arrivalSummary(arrival, [], currentId)))
  }, [arrival, properties, property])

  // Einmal in den Zeitraum mit den jüngsten Kosten; danach wählt der Nutzer selbst
  const switched = useRef(false)
  useEffect(() => {
    if (!summary?.target || switched.current) return
    switched.current = true
    void switchTo(summary.target.propertyId, summary.target.periodKey)
  }, [summary, switchTo])

  if (!summary) return null
  const button = <button type="button" className="btn" onClick={onClose}>Verstanden</button>
  return (
    <section className="card db-notice no-print" role="status">
      <span className="db-notice-icon" aria-hidden="true">✅</span>
      <div className="db-notice-body">
        <h2>{summary.title}</h2>
        {summary.text && <p>{summary.text}</p>}
        {mobile && <div className="row mt-3">{button}</div>}
      </div>
      {!mobile && button}
    </section>
  )
}
