// Die Seite „Heizkosten“ (Heizung PR 6 und 7, Entwurf 11.4): je Heizanlage und Heizperiode des gewählten
// Zeitraums die Karten „CO₂-Kosten“ und „Warmwasser“ (beim Messdienst), „Lieferungen“ und „CO₂: Angaben
// zum Gebäude“, dazu einmal „Gradtagzahlen Ihres Orts“. Sie steht erst ab einer Heizanlage in der
// Navigation (`navFor`).
import { useCallback, useEffect, useState } from 'react'
import type { DegreeDayValue, FuelDelivery, HeatingPeriodView, HeatingPlant, Tenancy, Unit } from '../types'
import { api, errorText } from '../api'
import { usePeriod } from '../period'
import { useProperty, withProperty } from '../property'
import PageHeader from '../components/PageHeader'
import Co2Card from '../components/Co2Card'
import Co2FactsCard from '../components/Co2FactsCard'
import DegreeDaysCard from '../components/DegreeDaysCard'
import FuelCard from '../components/FuelCard'
import HotWaterCard from '../components/HotWaterCard'
import Term from '../components/Term'
import { monthsOf, ownedBy } from '../fuelForm'
import { co2FirstPeriodStart } from '../../../shared/law/co2kostaufg.ts'
import { servesUnit } from '../../../shared/heatingPeriod.ts'
import { germanDate } from '../../../shared/law/register.ts'

type Loaded = { plants: HeatingPlant[]; views: Record<string, HeatingPeriodView[]>; deliveries: Record<string, FuelDelivery[]>; degreeDays: DegreeDayValue[] }

export default function Heizkosten({ units, tenancies }: { units: Unit[]; tenancies: Tenancy[] }) {
  const { property } = useProperty()
  const period = usePeriod()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const plants = await api<HeatingPlant[]>(withProperty('/api/heating-plants', property?.id))
      const views = await Promise.all(plants.map((p) => api<HeatingPeriodView[]>(`/api/heating-plants/${p.id}/periods?period=${encodeURIComponent(period.param)}`)))
      const deliveries = await Promise.all(plants.map((p) => api<FuelDelivery[]>(`/api/heating-plants/${p.id}/deliveries`)))
      const degreeDays = property ? await api<DegreeDayValue[]>(`/api/properties/${property.id}/degree-days`) : []
      setData({
        plants,
        views: Object.fromEntries(plants.map((p, i) => [p.id, views[i] ?? []])),
        deliveries: Object.fromEntries(plants.map((p, i) => [p.id, deliveries[i] ?? []])),
        degreeDays,
      })
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }, [property, period.param])
  useEffect(() => { void load() }, [load])
  const first = co2FirstPeriodStart()
  // Die Monate, die die Lieferungen überdecken: Für sie fragt die Karte „Gradtagzahlen Ihres Orts“.
  const all = Object.values(data?.deliveries ?? {}).flat().filter((d) => d.invoiceFrom !== null && d.invoiceTo !== null)
  const from = all.reduce<string | null>((a, d) => (a === null || (d.invoiceFrom ?? a) < a ? d.invoiceFrom : a), null)
  const to = all.reduce<string | null>((a, d) => (a === null || (d.invoiceTo ?? a) > a ? d.invoiceTo : a), null)
  // Die Wohnfläche der versorgten Wohnungen, mit derselben Regel wie die Berechnung (`servesUnit`).
  const servedArea = (plant: HeatingPlant): number =>
    units.filter((u) => servesUnit(plant, u)).reduce((a, u) => a + (u.areaM2 || 0), 0)

  return (
    <div>
      <PageHeader title={`Heizkosten ${period.label}`} />
      {error && <div className="error">{error}</div>}
      {data !== null && data.plants.length === 0 && (
        <div className="card"><p>Legen Sie zuerst in den Stammdaten unter „Heizung“ eine Heizanlage an.</p></div>
      )}
      {(data?.plants ?? []).map((plant) => (
        <div key={plant.id}>
          {plant.method === 'self' ? (
            <div className="card">
              <p>Die eigene Heizkostenabrechnung kommt mit einer späteren Version.</p>
              <ManualCo2Advice />
            </div>
          ) : (<>
            {plant.method === 'manual' && (data?.deliveries[plant.id] ?? []).length === 0 && (
              <div className="card">
                <p>Verteilen Sie die Heizkosten selbst nach einem <Term id="allocationKey">Umlageschlüssel</Term> (bei der Frage, wer abrechnet: „Niemand“), teilt Mietfuchs die CO₂-Kosten selbst auf, sobald Sie die Gas- oder Ölrechnung unten als Lieferung eintragen; Gutschrift und Position „Nicht umlagefähig“ entfallen dann.</p>
                <ManualCo2Advice />
              </div>
            )}
            {(data?.views[plant.id] ?? []).map((v) => (
              <div key={v.period}>
                <h2>{plant.name || 'Heizanlage'}, Heizperiode {v.label}</h2>
                {plant.method === 'service' && (v.from >= first ? (
                  <Co2Card key={`${v.period}:${v.co2?.method ?? ''}`} view={v} tenancies={tenancies} unitsCount={plant.units?.length ?? units.length} hasSelfUsed={units.some((u) => u.selfUsed === true)} onSaved={() => void load()} />
                ) : (
                  <div className="card"><p className="muted">Für Heizperioden, die vor dem {germanDate(first)} beginnen, sind die CO₂-Kosten nicht aufzuteilen.</p></div>
                ))}
                {plant.method === 'service' && <HotWaterCard view={v} onSaved={() => void load()} />}
                <FuelCard plant={plant} view={v} deliveries={ownedBy(data?.deliveries[plant.id] ?? [], v)} onSaved={() => void load()} />
                {v.from >= first && <Co2FactsCard plant={plant} view={v} servedAreaM2={servedArea(plant)} onSaved={() => void load()} />}
              </div>
            ))}
          </>)}
        </div>
      ))}
      {property && from !== null && to !== null && data !== null && (
        <DegreeDaysCard key={`${from}-${to}`} propertyId={property.id} months={monthsOf(from, to)} values={data.degreeDays} onSaved={() => void load()} />
      )}
    </div>
  )
}

// Der Rat aus der Laienprobe, solange Mietfuchs die CO₂-Kosten nicht selbst aufteilt (ohne Lieferungen
// oder bei der eigenen Heizkostenabrechnung): was zu tun ist, damit niemand kürzen darf.
function ManualCo2Advice() {
  return (
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
  )
}
