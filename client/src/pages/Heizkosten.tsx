// Die Seite „Heizkosten“ (Heizung PR 6, Entwurf 11.4): je Heizanlage und Heizperiode des gewählten
// Zeitraums die Karten „CO₂-Kosten“ und „Warmwasser“. Sie steht erst ab einer Heizanlage in der
// Navigation (`navFor`).
import { useCallback, useEffect, useState } from 'react'
import type { HeatingPeriodView, HeatingPlant, Tenancy, Unit } from '../types'
import { api, errorText } from '../api'
import { usePeriod } from '../period'
import { useProperty, withProperty } from '../property'
import PageHeader from '../components/PageHeader'
import Co2Card from '../components/Co2Card'
import HotWaterCard from '../components/HotWaterCard'
import Term from '../components/Term'
import { co2FirstPeriodStart } from '../../../shared/law/co2kostaufg.ts'
import { germanDate } from '../../../shared/law/register.ts'

export default function Heizkosten({ units, tenancies }: { units: Unit[]; tenancies: Tenancy[] }) {
  const { property } = useProperty()
  const period = usePeriod()
  const [plants, setPlants] = useState<HeatingPlant[] | null>(null)
  const [views, setViews] = useState<Record<string, HeatingPeriodView[]>>({})
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const list = await api<HeatingPlant[]>(withProperty('/api/heating-plants', property?.id))
      const entries = await Promise.all(
        list.map(async (p): Promise<[string, HeatingPeriodView[]]> => [p.id, await api<HeatingPeriodView[]>(`/api/heating-plants/${p.id}/periods?period=${encodeURIComponent(period.param)}`)]),
      )
      setPlants(list)
      setViews(Object.fromEntries(entries))
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }, [property?.id, period.param])
  useEffect(() => { void load() }, [load])
  const first = co2FirstPeriodStart()

  return (
    <div>
      <PageHeader title={`Heizkosten ${period.label}`} />
      {error && <div className="error">{error}</div>}
      {plants !== null && plants.length === 0 && (
        <div className="card"><p>Legen Sie zuerst in den Stammdaten unter „Heizung“ eine Heizanlage an.</p></div>
      )}
      {(plants ?? []).map((plant) => (
        <div key={plant.id}>
          {plant.method !== 'service' ? (
            <div className="card">
              <p>Die Karten dieser Seite gelten für eine Heizanlage, die ein Messdienst oder die Gemeinschaft abrechnet. Verteilen Sie die Heizkosten selbst nach einem Umlageschlüssel <Term id="allocationKey" /> (bei der Frage, wer abrechnet: „Niemand“), teilt Mietfuchs die CO₂-Kosten erst mit einer späteren Version selbst auf.</p>
            </div>
          ) : (
            (views[plant.id] ?? []).map((v) => (
              <div key={v.period}>
                <h2>{plant.name || 'Heizanlage'}, Heizperiode {v.label}</h2>
                {v.from >= first ? (
                  <Co2Card key={`${v.period}:${v.co2?.method ?? ''}`} view={v} tenancies={tenancies} unitsCount={plant.units?.length ?? units.length} onSaved={() => void load()} />
                ) : (
                  <div className="card"><p className="muted">Für Heizperioden, die vor dem {germanDate(first)} beginnen, sind die CO₂-Kosten nicht aufzuteilen.</p></div>
                )}
                <HotWaterCard view={v} onSaved={() => void load()} />
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  )
}
