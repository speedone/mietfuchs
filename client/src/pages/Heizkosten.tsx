// Die Seite „Heizkosten“ (Heizung PR 6 und 7, Entwurf 11.4): je Heizanlage und Heizperiode des gewählten
// Zeitraums die Karten „CO₂-Kosten“ und „Warmwasser“ (beim Messdienst), „Lieferungen“ und „CO₂: Angaben
// zum Gebäude“, seit Heizung PR 8 „Vorrat“ bei Heizöl, Flüssiggas, Pellets, Holz und Kohle, dazu einmal
// „Gradtagzahlen Ihres Orts“. Seit Heizung PR 17 je Heizperiode mit Rechnungen der Ausdruck „CO₂-Angaben
// für den Messdienst“ (#210), der die Seite ersetzt, bis man zurückgeht. Sie steht erst ab einer
// Heizanlage in der Navigation (`navFor`). Seit #266 je Anlage die Karte „Betriebsstrom der Heizung“.
// Bei eigener Abrechnung (#690 Punkt 6) steht je Heizperiode zuerst „Was fehlt noch“ (`selfTodos`), das Seltene
// (Ausnahmen, Blatt für den Messdienst, die Angaben je Anlage) hinter dem Nötigen; beim Messdienst und bei freien
// Schlüsseln bleibt die Reihenfolge, wie sie war. Der Untertitel richtet sich nach der Art der Abrechnung.
import Card from '../components/Card'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Co2Sheet, CostItem, DegreeDayValue, FuelDelivery, HeatingPeriodView, HeatingPlant, HeatingStatement, Meter, Notice, Tenancy, Unit } from '../types'
import { api, errorText } from '../api'
import { usePeriod } from '../period'
import { useHasOpenForm, useProperty, withProperty } from '../property'
import { useConfirm } from '../components/feedback'
import PageHeader from '../components/PageHeader'
import Co2Card from '../components/Co2Card'
import Co2FactsCard from '../components/Co2FactsCard'
import Co2SheetView from '../components/Co2SheetView'
import { hasSheet } from '../co2Sheet'
import DegreeDaysCard from '../components/DegreeDaysCard'
import FuelCard from '../components/FuelCard'
import ServiceImportCard from '../components/ServiceImportCard'
import OperatingPowerCard from '../components/OperatingPowerCard'
import OperatingPowerHandlingCard from '../components/OperatingPowerHandlingCard'
import { showsHandlingCard } from '../operatingPowerHandling'
import HotWaterCard from '../components/HotWaterCard'
import HalfSplitCard from '../components/HalfSplitCard'
import { halfSplitAvailable } from '../halfSplitForm'
import StockCard from '../components/StockCard'
import SelfHeatingCards from '../components/SelfHeatingCards'
import HeatingInfoCard from '../components/HeatingInfoCard'
import HeatingRulesCard from '../components/HeatingRulesCard'
import MonthlyInfoCard from '../components/MonthlyInfoCard'
import HeatingTodoCard from '../components/HeatingTodoCard'
import { extraNotices, heatingSituation, heatingSubtitle, lineOf, noticesOf, subjectPlants, todosFor, type TodoStep } from '../heatingPageView'
import ServiceValuesCard from '../components/ServiceValuesCard'
import { showsStockCard } from '../stockForm'
import Term from '../components/Term'
import { asksCo2Facts, monthsOf, ownedBy } from '../fuelForm'
import { billingEnergy } from '../../../shared/heatDelivery.ts'
import { co2FirstPeriodStart } from '../../../shared/law/co2kostaufg.ts'
import { servesUnit } from '../../../shared/heatingPeriod.ts'
import { flatIdsWithRooms } from '../unitForm'
import { selfUsedWithin } from '../../../shared/unitUsage.ts'
import { germanDate } from '../../../shared/law/register.ts'
import { NoticeBox } from '../components/Notice'
import EmptyState from '../components/EmptyState'
import { useSubjectJump, type FocusProps, type JumpTarget } from '../focus'
import { CHECKS_TARGET, NEW_COST_ITEM_TARGET, SET_UP_HEATING_TARGET } from '../jumpTargets'
import type { NoticeTab } from '../notices'

// `heating`: der Ausweis der Abrechnung des Zeitraums (Heizung PR 10), für die eigene Heizkostenabrechnung.
// `findings`: die Befunde der CO₂-Prüfung je Anlage und Heizperiode, je Lieferung (Heizung PR 17, #246 R-K7).
// `items`: alle Positionen des Objekts aus allen Zeiträumen, für die Karte „Betriebsstrom“ (Heizung PR 15).
// `notices`: die Hinweise derselben Abrechnung, für die Liste „Was fehlt noch“ (#690): Sie folgt ihnen.
// `meters`: die Zähler des Objekts, damit „Was fehlt noch“ ab zwei Anlagen einen Zählerhinweis seiner Anlage zuordnet
// (Durchsicht M1); nur dann geladen.
type Loaded = { items: CostItem[]; plants: HeatingPlant[]; views: Record<string, HeatingPeriodView[]>; deliveries: Record<string, FuelDelivery[]>; degreeDays: DegreeDayValue[]; heating: HeatingStatement[]; notices: Notice[]; meters: Meter[]; findings: Record<string, Record<string, string[]>> }

// `onOpenReceipt`, `onOpenAiSettings`: Auswege, wenn die KI an einer Rechnung oder Abrechnung scheitert (#487)
// `focus`: „Hier beheben →“ an einem Hinweis zu den Heizkosten einer Anlage; ihr Bereich wird hervorgehoben. Mehr als
// die Anlage nennt der Hinweis nicht (`NoticeSubject`), Heizperiode und Karte sucht man darin selbst.
// `onNavigate`: der Weg in die Stammdaten, solange es keine Heizanlage gibt.
export default function Heizkosten({ units, tenancies, onTenanciesChanged, onOpenReceipt, onOpenAiSettings, focus, onFocusDone, onNavigate }: {
  units: Unit[]; tenancies: Tenancy[]; onTenanciesChanged?: () => Promise<void> | void
  onOpenReceipt?: (file: string) => void; onOpenAiSettings?: () => void
  onNavigate?: (tab: NoticeTab, focus?: JumpTarget) => void
} & FocusProps) {
  const { property } = useProperty()
  const period = usePeriod()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  // Der Ausdruck für den Messdienst (Heizung PR 17): Anlage und Heizperiode, oder keiner.
  const [sheetFor, setSheetFor] = useState<{ plantId: string; period: string } | null>(null)
  // Das Blatt ersetzt die Seite, alle Karten werden ausgehängt; offene Eingaben gingen still verloren
  // (Nachprüfung zu #346, B5). Deshalb fragt das Öffnen vorher wie ein Seitenwechsel.
  const hasOpenForm = useHasOpenForm()
  const confirm = useConfirm()
  async function openSheet(plantId: string, period: string) {
    if (hasOpenForm()) {
      const ok = await confirm({
        title: 'Ungespeicherte Änderungen verwerfen?',
        message: 'Auf dieser Seite ist ein Formular offen oder eine Änderung noch nicht gespeichert. Beim Öffnen des Blatts geht sie verloren.',
        confirmLabel: 'Verwerfen',
        cancelLabel: 'Abbrechen',
        danger: true,
      })
      if (!ok) return
    }
    setSheetFor({ plantId, period })
  }
  const load = useCallback(async () => {
    try {
      const plants = await api<HeatingPlant[]>(withProperty('/api/heating-plants', property?.id))
      const views = await Promise.all(plants.map((p) => api<HeatingPeriodView[]>(withProperty(`/api/heating-plants/${p.id}/periods?period=${encodeURIComponent(period.param)}`, property?.id))))
      const deliveries = await Promise.all(plants.map((p) => api<FuelDelivery[]>(withProperty(`/api/heating-plants/${p.id}/deliveries`, property?.id))))
      // Heizung PR 15: alle Positionen des Objekts aus allen Zeiträumen, für die Karte „Betriebsstrom“.
      const items = await api<CostItem[]>(withProperty('/api/costItems', property?.id))
      const degreeDays = property ? await api<DegreeDayValue[]>(`/api/properties/${property.id}/degree-days`) : []
      // Heizung PR 10: Ausweis, Ablesungen und Verteilung der eigenen Heizkostenabrechnung stehen in der Abrechnung.
      const settlement = plants.some((p) => p.method === 'self')
        ? await api<{ heating?: HeatingStatement[]; notices?: Notice[] }>(withProperty(`/api/settlement/${encodeURIComponent(period.param)}`, property?.id))
        : null
      const heating = settlement?.heating ?? []
      const notices = settlement?.notices ?? []
      const meters = settlement !== null && plants.length > 1 ? await api<Meter[]>(withProperty('/api/meters', property?.id)) : []
      // Die Befunde der Prüfung kommen aus dem Blatt für den Messdienst: dieselbe Prüfung wie in der Abrechnung.
      const sheetKeys = plants.flatMap((p, i) => (asksCo2Facts(p) ? (views[i] ?? []).filter((v) => hasSheet(deliveries[i] ?? [], v)).map((v) => ({ p, v })) : []))
      const sheets = await Promise.all(sheetKeys.map(({ p, v }) => api<Co2Sheet>(withProperty(`/api/heating-plants/${p.id}/periods/${encodeURIComponent(String(v.period))}/co2-sheet`, property?.id))))
      const findings = Object.fromEntries(sheetKeys.map(({ p, v }, i) => [`${p.id}:${v.period}`, Object.fromEntries((sheets[i]?.deliveries ?? []).map((d) => [d.id, d.findings]))]))
      setData({
        items,
        findings,
        heating,
        notices,
        meters,
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
  const plantIds = useMemo(() => data?.plants.map((p) => p.id) ?? null, [data])
  const jumpAt = useSubjectJump(sheetFor ? null : focus, 'heatingCosts', plantIds, onFocusDone)
  const first = co2FirstPeriodStart()
  // Die Monate, die die Lieferungen überdecken: Für sie fragt die Karte „Gradtagzahlen Ihres Orts“.
  const all = Object.values(data?.deliveries ?? {}).flat().filter((d) => d.invoiceFrom !== null && d.invoiceTo !== null)
  const from = all.reduce<string | null>((a, d) => (a === null || (d.invoiceFrom ?? a) < a ? d.invoiceFrom : a), null)
  const to = all.reduce<string | null>((a, d) => (a === null || (d.invoiceTo ?? a) > a ? d.invoiceTo : a), null)
  // Die Wohnfläche der versorgten Wohnungen, mit derselben Regel wie die Berechnung (`servesUnit`).
  const servedArea = (plant: HeatingPlant): number =>
    units.filter((u) => servesUnit(plant, u)).reduce((a, u) => a + (u.areaM2 || 0), 0)

  // „Was fehlt noch“ (#690 Punkt 6): die Zeilen aus Ansicht, Ausweis und den Hinweisen der Abrechnung zu dieser Anlage
  // und Heizperiode. Die Knöpfe der Zeilen springen an die Stelle, an der man es erledigt: das Formular einer neuen
  // Position, „Zu prüfen“ in der Abrechnung; die Seite der Zähler hat kein einzelnes Ziel.
  // Durchsicht S2: Ein Schritt, dessen Karte auf dieser Seite steht, springt zu ihrer Überschrift in derselben Heizperiode.
  const revealCard = (block: string, card: string) => {
    const root = [...document.querySelectorAll<HTMLElement>('[data-heating-period]')].find((el) => el.dataset.heatingPeriod === block)
    const heading = [...(root?.querySelectorAll<HTMLElement>('h2, h3') ?? [])].find((h) => (h.textContent ?? '').trim().startsWith(card))
    if (!heading) return
    heading.setAttribute('tabindex', '-1')
    heading.scrollIntoView?.({ block: 'start' })
    heading.focus()
  }
  // Nachprüfung M1: zur Überschrift einer anderen Anlage derselben Linie (ihr Bereich trägt `data-jump`).
  const revealPlant = (plantId: string) => {
    const area = document.querySelector<HTMLElement>(`[data-jump="heatingCosts:${plantId}"]`)
    const heading = area?.querySelector<HTMLElement>('[data-jump-focus]')
    if (!heading) return
    heading.setAttribute('tabindex', '-1')
    heading.scrollIntoView?.({ block: 'start' })
    heading.focus()
  }
  const TODO_JUMP: Record<NonNullable<TodoStep['page']>, JumpTarget | undefined> = { kosten: NEW_COST_ITEM_TARGET, abrechnung: CHECKS_TARGET, zaehler: undefined }
  // Ab zwei Anlagen: zu welcher Anlage ein Hinweis an Zähler, Wohnung oder Mieter gehört (Durchsicht M1).
  const owner = data && data.plants.length > 1 ? subjectPlants({ plants: data.plants, units, meters: data.meters, tenancies }) : undefined
  const todoCard = (plant: HeatingPlant, v: HeatingPeriodView) => {
    const views = data?.views[plant.id] ?? []
    // Positionen aller übrigen Heizperioden (auch anderer Anlagen): ihre Hinweise gehören dorthin.
    const foreignItems = new Set(Object.values(data?.views ?? {}).flat().filter((x) => x !== v).flatMap((x) => x.items.map((i) => i.id)))
    const { line, host } = lineOf(plant, data?.plants ?? [], v.to)
    const notices = noticesOf(data?.notices ?? [], { plantId: plant.id, plants: data?.plants.length ?? 1, view: v, labels: views.map((x) => x.label), owner, foreignItems, line })
    const statement = data?.heating.find((h) => h.plantId === plant.id && h.period === v.period) ?? null
    // Eine getrennt abgerechnete Heizperiode (Weg d) steht nicht in der Abrechnung des Zeitraums.
    const separate = statement === null && (plant.separateSpans ?? []).length > 0
    const steps = todosFor(heatingSituation(plant), { view: v, statement, notices, deliveries: ownedBy(data?.deliveries[plant.id] ?? [], v).length, co2: v.from >= first && asksCo2Facts(plant), separate, host })
    if (steps === null) return null
    return (
      <HeatingTodoCard
        steps={steps} extra={extraNotices(notices)} separate={separate}
        onNavigate={onNavigate ? (page) => onNavigate(page, TODO_JUMP[page]) : undefined}
        onCard={(card) => revealCard(`${plant.id}:${v.period}`, card)}
        onPlant={revealPlant}
      />
    )
  }
  // Die Angaben je Anlage, die selten gebraucht werden: beim Messdienst und bei freien Schlüsseln über den
  // Heizperioden wie bisher, bei eigener Abrechnung dahinter (#690 Punkt 6).
  // `level`: unter der Überschrift „Seltener gebraucht“ sind die Karten eine Ebene tiefer.
  const plantCards = (plant: HeatingPlant, level?: 3) => (
    <>
      {/* #266: wie der Betriebsstrom erfasst ist, je Anlage. */}
      {showsHandlingCard(plant) && (
        <OperatingPowerHandlingCard key={`ophandling:${plant.id}`} plant={plant} level={level} onSaved={() => void load()} />
      )}
      {/* Heizung PR 18 (#215): Heizung nach § 43 GModG, je Anlage. Bei Contracting zählt der Brennstoff des
          Lieferanten (`plant.energy`). */}
      {halfSplitAvailable(plant.energy) && (
        <HalfSplitCard
          key={`half:${plant.id}:${JSON.stringify([plant.gmodg43InstalledOn, plant.emergencyInstall, plant.emergencyPriorDuty, plant.newBuildingFirstUse, plant.buildingApplicationBefore20260513])}`}
          plant={plant} tenancies={tenancies} level={level} onSaved={() => void load()}
          onNoticeSaved={() => { void load(); void onTenanciesChanged?.() }}
        />
      )}
    </>
  )
  // Das Blatt der CO₂-Angaben zum Weitergeben (Heizung PR 17, #210), sobald es Rechnungen gibt.
  const sheetCard = (plant: HeatingPlant, v: HeatingPeriodView) => asksCo2Facts(plant) && hasSheet(data?.deliveries[plant.id] ?? [], v) && (
    <Card title="CO₂-Angaben für den Messdienst" level={3} className="no-print">
      <p className="muted">
        Ein Blatt mit den CO₂-Angaben Ihrer Rechnungen dieser Heizperiode (kg CO₂, CO₂-Kosten, Energiegehalt, Menge) und den Angaben zum
        Gebäude, zum Ausdrucken oder Weitergeben an den Messdienst, die Gemeinschaft oder Ihr Steuerbüro.
      </p>
      <div className="row">
        <button className="btn secondary" type="button" onClick={() => void openSheet(plant.id, String(v.period))}>Blatt „CO₂-Angaben für den Messdienst“ öffnen</button>
      </div>
    </Card>
  )
  // Ausnahme, Vereinbarung und monatliche Information je Heizperiode (Heizung PR 14). Für Etagenheizungen gilt die
  // Verordnung nicht. Ohne den Stand im Schlüssel: Speichert eine andere Karte, bliebe sonst ein Entwurf hier nicht
  // stehen (Durchsicht zu #309, SOLLTE 5). Neue gespeicherte Werte übernimmt useDraft selbst.
  const rulesCard = (plant: HeatingPlant, v: HeatingPeriodView) => (plant.supply ?? 'central') === 'central' && (
    <HeatingRulesCard key={`rules:${plant.id}:${v.period}`} plant={plant} view={v} onChanged={() => void load()} />
  )

  if (sheetFor) return <Co2SheetView plantId={sheetFor.plantId} period={sheetFor.period} onClose={() => setSheetFor(null)} />

  return (
    <div>
      <PageHeader
        title={`Heizkosten ${period.label}`}
        subtitle={heatingSubtitle(data ? data.plants : null)}
      />
      {error && <NoticeBox level="error" action={error} />}
      {data !== null && data.plants.length === 0 && (
        <div className="card">
          <EmptyState action={onNavigate ? { label: 'Heizung einrichten', onClick: () => onNavigate('stammdaten', SET_UP_HEATING_TARGET) } : null}>
            Legen Sie zuerst in den Stammdaten unter „Heizung“ eine Heizanlage an.
          </EmptyState>
        </div>
      )}
      {(data?.plants ?? []).map((plant) => (
        <div key={plant.id} {...jumpAt(plant.id)}>
          {/* Die Überschrift des Bereichs, auf der der Fokus nach „Hier beheben →“ steht (Durchsicht): Sie nennt die Anlage.
              Bei einer einzigen Anlage nur für Vorleseprogramme, die Karten darunter nennen sie ohnehin. */}
          <h2 className={(data?.plants.length ?? 0) > 1 ? 'section-title' : 'sr-only'} data-jump-focus="">{plant.name ? `Heizanlage „${plant.name}“` : 'Heizanlage'}</h2>
          <>
            {/* #341 M8: ein Satz, was zu tun ist. Ohne Lieferung teilt Mietfuchs die CO₂-Kosten nicht auf, auch nicht bei der
                eigenen Heizkostenabrechnung (calc.ts, `ownSplit`). Den Weg von Hand (Gutschrift mit demselben
                Umlageschlüssel) gibt es nur bei „Niemand“; er steht eingeklappt darunter. */}
            {plant.method !== 'service' && asksCo2Facts(plant) && (data?.deliveries[plant.id] ?? []).length === 0 && (
              <NoticeBox
                level="hint"
                title="CO₂-Kosten aufteilen"
                action={<>Tragen Sie die {invoiceName(plant)} unten als Lieferung ein; dann teilt Mietfuchs die CO₂-Kosten selbst auf (<Term id="co2Split">CO₂-Kosten aufteilen</Term>).</>}
              >
                {plant.method === 'manual' && (
                  <details className="extra-details">
                    <summary>Ohne Lieferung: CO₂-Kosten von Hand aufteilen</summary>
                    <ManualCo2Advice plant={plant} />
                  </details>
                )}
              </NoticeBox>
            )}
            {/* #690: Bei eigener Abrechnung stehen die Angaben der Anlage hinter den Heizperioden (Nötiges vor Seltenem). */}
            {plant.method !== 'self' && plantCards(plant)}
            {(data?.views[plant.id] ?? []).map((v) => (
              <div key={v.period} data-heating-period={`${plant.id}:${v.period}`}>
                <h2 className="section-title">{plant.name || 'Heizanlage'}, Heizperiode {v.label}</h2>
                {/* #690 Punkt 6: bei eigener Abrechnung zuerst, was noch fehlt. Abgeschlossen fehlt nichts mehr. */}
                {!v.closed && todoCard(plant, v)}
                {/* Heizung PR 20 (#103): die Abrechnung des Messdienstes mit der KI auslesen; übernommen wird in der Prüfansicht. */}
                {plant.method === 'service' && (
                  <ServiceImportCard plant={plant} view={v} object={period.period} tenancies={tenancies} units={units} items={data?.items ?? []} co2={v.from >= first} onSaved={() => void load()}
                    onOpenReceipt={onOpenReceipt} onOpenAiSettings={onOpenAiSettings} />
                )}
                {plant.method === 'service' && (v.from >= first ? (
                  <Co2Card key={`${v.period}:${v.co2?.method ?? ''}`} view={v} tenancies={tenancies} unitsCount={units.filter((u) => servesUnit(plant, u)).length} hasSelfUsed={units.some((u) => selfUsedWithin(u, v.from, v.to))} homeowners={plant.source === 'homeowners'} onSaved={() => void load()} />
                ) : (
                  <div className="card"><p className="muted">Für Heizperioden, die vor dem {germanDate(first)} beginnen, sind die CO₂-Kosten nicht aufzuteilen.</p></div>
                ))}
                {/* Heizung PR 11: auch bei eigener Abrechnung, wenn die Heizung das Warmwasser bereitet. */}
                {(plant.method === 'service' || (plant.method === 'self' && (v.selfHotWater ?? plant.hotWater) === 'combined')) && (
                  <HotWaterCard key={`hw:${v.period}:${JSON.stringify(v.hotWater)}:${plant.heatGeneration ?? ''}`} view={v} plant={plant} onSaved={() => void load()} />
                )}
                <FuelCard plant={plant} view={v} deliveries={ownedBy(data?.deliveries[plant.id] ?? [], v)} allDeliveries={data?.deliveries[plant.id] ?? []} allItems={data?.items ?? []} units={units} findings={data?.findings[`${plant.id}:${v.period}`] ?? {}} onSaved={() => void load()} onOpenAiSettings={onOpenAiSettings} />
                <OperatingPowerCard plant={plant} view={v} rules={period.rules} items={data?.items ?? []} onBooked={() => void load()} />
                {showsStockCard(plant, v) && <StockCard key={`stock:${v.period}:${JSON.stringify(v.stock?.row ?? null)}`} view={v} co2Fields={asksCo2Facts(plant)} energy={billingEnergy(plant)} onSaved={() => void load()} />}
                {v.from >= first && asksCo2Facts(plant) && <Co2FactsCard plant={plant} view={v} servedAreaM2={servedArea(plant)} onSaved={() => void load()} />}
                {plant.method !== 'self' && sheetCard(plant, v)}
                {/* Heizung PR 12: die Werte des Ablesedienstes, wenn diese Heizperiode so erfasst wird. */}
                {v.capture === 'serviceValues' && (
                  <ServiceValuesCard
                    key={`svc:${v.period}:${JSON.stringify(v.serviceValues ?? [])}`}
                    plantId={plant.id} period={v.period} from={v.from} to={v.to} closed={v.closed}
                    units={units.filter((u) => servesUnit(plant, u) && !flatIdsWithRooms(units).has(u.id)).map((u) => ({ id: u.id, name: u.name }))}
                    values={v.serviceValues ?? []} remoteUnknown={plant.devicesRemote === 'unknown'} onSaved={() => void load()}
                  />
                )}
                {plant.method === 'self' && (
                  <SelfHeatingCards plant={plant} view={v} self={data?.heating.find((h) => h.plantId === plant.id && h.period === v.period)?.self ?? null} onChanged={() => void load()} />
                )}
                {plant.method !== 'self' && rulesCard(plant, v)}
                {/* Heizung PR 14: die Angaben nach § 6a bei eigener Abrechnung und freien Schlüsseln. */}
                {(plant.supply ?? 'central') === 'central' && plant.method !== 'service' && v.rules.exemptionScope !== 'both' && (
                  <HeatingInfoCard key={`info:${v.period}:${JSON.stringify(v.info)}:${v.rules.consumerContract ?? ''}`} plant={plant} view={v} onChanged={() => void load()} />
                )}
                {/* Heizung PR 22: die monatliche Verbrauchsinformation, wenn Mietfuchs sie bei eigener Abrechnung erstellt. Ob das
                    so ist, sagt der Server (`managed`); ohne sie oder mit „anders mitgeteilt“ bleibt die Karte leer. Der Schlüssel
                    lädt sie neu, wenn sich die Angaben der Heizperiode ändern. */}
                {(plant.supply ?? 'central') === 'central' && plant.method === 'self' && v.rules.exemptionScope !== 'both' && (
                  <MonthlyInfoCard key={`monthly:${v.period}:${JSON.stringify(v.rules)}:${JSON.stringify(v.hotWater)}`} plantId={plant.id} period={String(v.period)} propertyName={property?.name ?? ''} byService={v.capture === 'serviceValues'} />
                )}
                {/* #690 Punkt 6: Bei eigener Abrechnung steht das Seltene hinter dem Nötigen. */}
                {plant.method === 'self' && rulesCard(plant, v)}
                {plant.method === 'self' && sheetCard(plant, v)}
              </div>
            ))}
            {plant.method === 'self' && (showsHandlingCard(plant) || halfSplitAvailable(plant.energy)) && (
              <>
                <h2 className="section-title">{plant.name || 'Heizanlage'}: Seltener gebraucht</h2>
                {plantCards(plant, 3)}
              </>
            )}
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
      Der CO₂-Ausstoß laut {invoiceName(plant)}, geteilt durch die Wohnfläche, ergibt die Stufe und damit Ihren Anteil an den
      CO₂-Kosten der Rechnung. Lassen Sie die
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
