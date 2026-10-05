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
              <p>Die Karten dieser Seite gelten für eine Heizanlage, die ein Messdienst oder die Gemeinschaft abrechnet. Verteilen Sie die Heizkosten selbst nach einem <Term id="allocationKey">Umlageschlüssel</Term> (bei der Frage, wer abrechnet: „Niemand“), teilt Mietfuchs die CO₂-Kosten erst mit einer späteren Version selbst auf.</p>
              {/* Kleinigkeit aus der Laienprobe: Was bis dahin zu tun ist, damit niemand kürzen darf. */}
              <p>
                Bis dahin teilen Sie die CO₂-Kosten selbst auf: Der CO₂-Ausstoß laut Gas- oder Ölrechnung, geteilt durch die Wohnfläche, ergibt die
                Stufe und damit Ihren Anteil an den CO₂-Kosten der Rechnung (<Term id="co2Split">CO₂-Kosten aufteilen</Term>). Lassen Sie die
                Heizposition, wie sie ist. Erfassen Sie Ihren Anteil als Gutschrift „CO₂-Anteil Vermieter“ in der Kostenart „Heizung und Warmwasser“
                mit demselben Umlageschlüssel (Betrag mit Minus) und denselben Betrag noch einmal als Position der Kostenart „Nicht umlagefähig“. So
                tragen ihn die Mieter nicht, und Ihre Werbungskosten bleiben vollständig. Verteilen Sie die Heizkosten mit Einzelbeträgen je Mieter,
                geht eine Gutschrift nicht: Ziehen Sie dann jedem Mieter den auf ihn entfallenden CO₂-Anteil des Vermieters vom Einzelbetrag ab; den
                Rest trägt ohnehin der Vermieter, und eine Position „Nicht umlagefähig“ entfällt dann, sonst stünde der Anteil doppelt in den Werbungskosten. Legen Sie der Abrechnung ein Blatt mindestens mit dem Anteil des
                Mieters, der Einstufung und den Berechnungsgrundlagen bei; fehlt das, dürfen die Mieter ihren Anteil an den Heizkosten kürzen (§ 7 Abs. 3
                und 4 CO2KostAufG).
              </p>
            </div>
          ) : (
            (views[plant.id] ?? []).map((v) => (
              <div key={v.period}>
                <h2>{plant.name || 'Heizanlage'}, Heizperiode {v.label}</h2>
                {v.from >= first ? (
                  <Co2Card key={`${v.period}:${v.co2?.method ?? ''}`} view={v} tenancies={tenancies} unitsCount={plant.units?.length ?? units.length} hasSelfUsed={units.some((u) => u.selfUsed === true)} onSaved={() => void load()} />
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
