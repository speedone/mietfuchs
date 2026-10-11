// Die Seite „Heizkosten“ (Heizung PR 6 und 7, Entwurf 11.4): je Heizanlage und Heizperiode des gewählten
// Zeitraums die Karten „CO₂-Kosten“ und „Warmwasser“ (beim Messdienst), „Lieferungen“ und „CO₂: Angaben
// zum Gebäude“, seit Heizung PR 8 „Vorrat“ bei Heizöl, Flüssiggas, Pellets, Holz und Kohle, dazu einmal
// „Gradtagzahlen Ihres Orts“. Seit Heizung PR 17 je Heizperiode mit Rechnungen der Ausdruck „CO₂-Angaben
// für den Messdienst“ (#210), der die Seite ersetzt, bis man zurückgeht. Sie steht erst ab einer
// Heizanlage in der Navigation (`navFor`). Seit #266 je Anlage die Karte „Betriebsstrom der Heizung“.
import { useCallback, useEffect, useState } from 'react'
import type { Co2Sheet, CostItem, DegreeDayValue, FuelDelivery, HeatingPeriodView, HeatingPlant, HeatingStatement, Tenancy, Unit } from '../types'
import { api, errorText } from '../api'
import { usePeriod } from '../period'
import { useProperty, withProperty } from '../property'
import PageHeader from '../components/PageHeader'
import Co2Card from '../components/Co2Card'
import Co2FactsCard from '../components/Co2FactsCard'
import Co2SheetView from '../components/Co2SheetView'
import { hasSheet } from '../co2Sheet'
import DegreeDaysCard from '../components/DegreeDaysCard'
import FuelCard from '../components/FuelCard'
import OperatingPowerCard from '../components/OperatingPowerCard'
import OperatingPowerHandlingCard from '../components/OperatingPowerHandlingCard'
import { showsHandlingCard } from '../operatingPowerHandling'
import HotWaterCard from '../components/HotWaterCard'
import StockCard from '../components/StockCard'
import SelfHeatingCards from '../components/SelfHeatingCards'
import HeatingInfoCard from '../components/HeatingInfoCard'
import HeatingRulesCard from '../components/HeatingRulesCard'
import MonthlyInfoCard from '../components/MonthlyInfoCard'
import ServiceValuesCard from '../components/ServiceValuesCard'
import { showsStockCard } from '../stockForm'
import Term from '../components/Term'
import { asksCo2Facts, monthsOf, ownedBy } from '../fuelForm'
import { billingEnergy } from '../../../shared/heatDelivery.ts'
import { co2FirstPeriodStart } from '../../../shared/law/co2kostaufg.ts'
import { servesUnit } from '../../../shared/heatingPeriod.ts'
import { germanDate } from '../../../shared/law/register.ts'

// `heating`: der Ausweis der Abrechnung des Zeitraums (Heizung PR 10), für die eigene Heizkostenabrechnung.
// `findings`: die Befunde der CO₂-Prüfung je Anlage und Heizperiode, je Lieferung (Heizung PR 17, #246 R-K7).
// `items`: alle Positionen des Objekts aus allen Zeiträumen, für die Karte „Betriebsstrom“ (Heizung PR 15).
type Loaded = { items: CostItem[]; plants: HeatingPlant[]; views: Record<string, HeatingPeriodView[]>; deliveries: Record<string, FuelDelivery[]>; degreeDays: DegreeDayValue[]; heating: HeatingStatement[]; findings: Record<string, Record<string, string[]>> }

export default function Heizkosten({ units, tenancies }: { units: Unit[]; tenancies: Tenancy[] }) {
  const { property } = useProperty()
  const period = usePeriod()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  // Der Ausdruck für den Messdienst (Heizung PR 17): Anlage und Heizperiode, oder keiner.
  const [sheetFor, setSheetFor] = useState<{ plantId: string; period: string } | null>(null)
  const load = useCallback(async () => {
    try {
      const plants = await api<HeatingPlant[]>(withProperty('/api/heating-plants', property?.id))
      const views = await Promise.all(plants.map((p) => api<HeatingPeriodView[]>(`/api/heating-plants/${p.id}/periods?period=${encodeURIComponent(period.param)}`)))
      const deliveries = await Promise.all(plants.map((p) => api<FuelDelivery[]>(`/api/heating-plants/${p.id}/deliveries`)))
      // Heizung PR 15: alle Positionen des Objekts aus allen Zeiträumen, für die Karte „Betriebsstrom“.
      const items = await api<CostItem[]>(withProperty('/api/costItems', property?.id))
      const degreeDays = property ? await api<DegreeDayValue[]>(`/api/properties/${property.id}/degree-days`) : []
      // Heizung PR 10: Ausweis, Ablesungen und Verteilung der eigenen Heizkostenabrechnung stehen in der Abrechnung.
      const heating = plants.some((p) => p.method === 'self')
        ? ((await api<{ heating?: HeatingStatement[] }>(withProperty(`/api/settlement/${encodeURIComponent(period.param)}`, property?.id))).heating ?? [])
        : []
      // Die Befunde der Prüfung kommen aus dem Blatt für den Messdienst: dieselbe Prüfung wie in der Abrechnung.
      const sheetKeys = plants.flatMap((p, i) => (asksCo2Facts(p) ? (views[i] ?? []).filter((v) => hasSheet(deliveries[i] ?? [], v)).map((v) => ({ p, v })) : []))
      const sheets = await Promise.all(sheetKeys.map(({ p, v }) => api<Co2Sheet>(`/api/heating-plants/${p.id}/periods/${encodeURIComponent(String(v.period))}/co2-sheet`)))
      const findings = Object.fromEntries(sheetKeys.map(({ p, v }, i) => [`${p.id}:${v.period}`, Object.fromEntries((sheets[i]?.deliveries ?? []).map((d) => [d.id, d.findings]))]))
      setData({
        items,
        findings,
        heating,
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

  if (sheetFor) return <Co2SheetView plantId={sheetFor.plantId} period={sheetFor.period} onClose={() => setSheetFor(null)} />

  return (
    <div>
      <PageHeader
        title={`Heizkosten ${period.label}`}
        subtitle="Je Heizperiode die Angaben aus der Heizkostenabrechnung: CO₂-Kosten, Warmwasser und Lieferungen."
      />
      {error && <div className="error">{error}</div>}
      {data !== null && data.plants.length === 0 && (
        <div className="card"><p>Legen Sie zuerst in den Stammdaten unter „Heizung“ eine Heizanlage an.</p></div>
      )}
      {(data?.plants ?? []).map((plant) => (
        <div key={plant.id}>
          <>
            {plant.method !== 'service' && asksCo2Facts(plant) && (data?.deliveries[plant.id] ?? []).length === 0 && (
              <div className="card">
                <p>Verteilen Sie die Heizkosten selbst nach einem <Term id="allocationKey">Umlageschlüssel</Term> (bei der Frage, wer abrechnet: „Niemand“), teilt Mietfuchs die CO₂-Kosten selbst auf, sobald Sie die {invoiceName(plant)} unten als Lieferung eintragen; Gutschrift und Position „Nicht umlagefähig“ entfallen dann.</p>
                <ManualCo2Advice plant={plant} />
              </div>
            )}
            {/* #266: wie der Betriebsstrom erfasst ist, je Anlage über den Heizperioden. */}
            {showsHandlingCard(plant) && (
              <OperatingPowerHandlingCard key={`ophandling:${plant.operatingPowerHandling ?? ''}`} plant={plant} onSaved={() => void load()} />
            )}
            {(data?.views[plant.id] ?? []).map((v) => (
              <div key={v.period}>
                <h2 className="section-title">{plant.name || 'Heizanlage'}, Heizperiode {v.label}</h2>
                {plant.method === 'service' && (v.from >= first ? (
                  <Co2Card key={`${v.period}:${v.co2?.method ?? ''}`} view={v} tenancies={tenancies} unitsCount={plant.units?.length ?? units.length} hasSelfUsed={units.some((u) => u.selfUsed === true)} onSaved={() => void load()} />
                ) : (
                  <div className="card"><p className="muted">Für Heizperioden, die vor dem {germanDate(first)} beginnen, sind die CO₂-Kosten nicht aufzuteilen.</p></div>
                ))}
                {/* Heizung PR 11: auch bei eigener Abrechnung, wenn die Heizung das Warmwasser bereitet. */}
                {(plant.method === 'service' || (plant.method === 'self' && (v.selfHotWater ?? plant.hotWater) === 'combined')) && (
                  <HotWaterCard key={`hw:${v.period}:${JSON.stringify(v.hotWater)}:${plant.heatGeneration ?? ''}`} view={v} plant={plant} onSaved={() => void load()} />
                )}
                <FuelCard plant={plant} view={v} deliveries={ownedBy(data?.deliveries[plant.id] ?? [], v)} units={units} findings={data?.findings[`${plant.id}:${v.period}`] ?? {}} onSaved={() => void load()} />
                <OperatingPowerCard plant={plant} view={v} rules={period.rules} items={data?.items ?? []} onBooked={() => void load()} />
                {showsStockCard(plant, v) && <StockCard key={`stock:${v.period}:${JSON.stringify(v.stock?.row ?? null)}`} view={v} co2Fields={asksCo2Facts(plant)} energy={billingEnergy(plant)} onSaved={() => void load()} />}
                {v.from >= first && asksCo2Facts(plant) && <Co2FactsCard plant={plant} view={v} servedAreaM2={servedArea(plant)} onSaved={() => void load()} />}
                {/* Heizung PR 17 (#210): die CO₂-Angaben der Rechnungen zum Weitergeben, sobald es Rechnungen gibt. */}
                {asksCo2Facts(plant) && hasSheet(data?.deliveries[plant.id] ?? [], v) && (
                  <div className="card no-print">
                    <h2>CO₂-Angaben für den Messdienst</h2>
                    <p className="muted">
                      Ein Blatt mit den CO₂-Angaben Ihrer Rechnungen dieser Heizperiode (kg CO₂, CO₂-Kosten, Energiegehalt, Menge) und den Angaben zum
                      Gebäude, zum Ausdrucken oder Weitergeben an den Messdienst, die Gemeinschaft oder Ihr Steuerbüro.
                    </p>
                    <div className="row">
                      <button className="btn secondary" type="button" onClick={() => setSheetFor({ plantId: plant.id, period: String(v.period) })}>Blatt „CO₂-Angaben für den Messdienst“ öffnen</button>
                    </div>
                  </div>
                )}
                {/* Heizung PR 12: die Werte des Ablesedienstes, wenn diese Heizperiode so erfasst wird. */}
                {v.capture === 'serviceValues' && (
                  <ServiceValuesCard
                    key={`svc:${v.period}:${JSON.stringify(v.serviceValues ?? [])}`}
                    plantId={plant.id} period={v.period} from={v.from} to={v.to} closed={v.closed}
                    units={units.filter((u) => servesUnit(plant, u)).map((u) => ({ id: u.id, name: u.name }))}
                    values={v.serviceValues ?? []} remoteUnknown={plant.devicesRemote === 'unknown'} onSaved={() => void load()}
                  />
                )}
                {plant.method === 'self' && (
                  <SelfHeatingCards plant={plant} view={v} self={data?.heating.find((h) => h.plantId === plant.id && h.period === v.period)?.self ?? null} onChanged={() => void load()} />
                )}
                {/* Heizung PR 14: Ausnahme, Vereinbarung und monatliche Information je Heizperiode; die Angaben nach
                    § 6a bei eigener Abrechnung und freien Schlüsseln. Für Etagenheizungen gilt die Verordnung nicht. */}
                {(plant.supply ?? 'central') === 'central' && (
                  <HeatingRulesCard key={`rules:${v.period}:${JSON.stringify(v.rules)}`} plant={plant} view={v} onChanged={() => void load()} />
                )}
                {(plant.supply ?? 'central') === 'central' && plant.method !== 'service' && v.rules.exemptionScope !== 'both' && (
                  <HeatingInfoCard key={`info:${v.period}:${JSON.stringify(v.info)}:${v.rules.consumerContract ?? ''}`} plant={plant} view={v} onChanged={() => void load()} />
                )}
                {/* Heizung PR 22: die monatliche Verbrauchsinformation, wenn Mietfuchs sie bei eigener Abrechnung erstellt. Ob das
                    so ist, sagt der Server (`managed`); ohne sie oder mit „anders mitgeteilt“ bleibt die Karte leer. Der Schlüssel
                    lädt sie neu, wenn sich die Angaben der Heizperiode ändern. */}
                {(plant.supply ?? 'central') === 'central' && plant.method === 'self' && v.rules.exemptionScope !== 'both' && (
                  <MonthlyInfoCard key={`monthly:${v.period}:${JSON.stringify(v.rules)}:${JSON.stringify(v.hotWater)}`} plantId={plant.id} period={String(v.period)} propertyName={property?.name ?? ''} />
                )}
              </div>
            ))}
          </>
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
// Bei Fernwärme gibt es keine Gas- oder Ölrechnung, sondern die Rechnung für die Fernwärme.
// Heizung PR 16: bei Contracting die Rechnung des Wärmelieferanten, nicht die Fernwärmerechnung.
const invoiceName = (plant: Pick<HeatingPlant, 'energy'> & { contracting?: boolean }): string =>
  (plant.contracting === true ? 'Rechnung Ihres Wärmelieferanten' : billingEnergy(plant) === 'districtHeating' ? 'Fernwärmerechnung' : 'Gas- oder Ölrechnung')

function ManualCo2Advice({ plant }: { plant: Pick<HeatingPlant, 'energy'> & { contracting?: boolean } }) {
  return (
    <p>
      Bis dahin teilen Sie die CO₂-Kosten selbst auf: Der CO₂-Ausstoß laut {invoiceName(plant)}, geteilt durch die Wohnfläche, ergibt die
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
