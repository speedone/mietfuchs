import { useEffect, useRef, useState } from 'react'
import type { CostModel, HeatingModel, SelfSupplyKind, DepositStatus, HeatingPlant, InterimGapStatus, Meter, MeterType, Settings, Tenancy, Unit, UnitDependents, UnitUsage } from '../types'
import { servesUnit } from '../../../shared/heatingPeriod.ts'
import { DEPOSIT_STATUS_LABELS, METER_TYPE_LABELS, UNIT_USAGE_LABELS, usageOf } from '../types'
import { EMPTY_UNIT_FORM, buildUnitBody, connectionSummary, connectionTypes, setConnected, unitDeleteBlocked, unitDeleteMessage, unitToForm, type UnitField, type UnitForm } from '../unitForm'
import { api, errorText, fmtDate, fmtEuro, parseEuro } from '../api'
import { separateHeatingFor, separateHeatingPlant } from '../heatingSettlementView'
import Drawer from '../components/Drawer'
import { useSaving } from '../useSaving'
import PropertyCard from '../components/PropertyCard'
import IbanInput from '../components/IbanInput'
import Field from '../components/Field'
import { useFormError } from '../components/ErrorSummary'
import { ibanForSave, ibanToInput, storedIbanInvalid } from '../ibanField'
import { IBAN_LABELS, normalizeIban } from '../../../shared/iban.ts'
import { COST_MODEL_LABELS, HEATING_MODEL_LABELS, SELF_SUPPLY_KIND_OPTIONS, SELF_SUPPLY_TENANCY_HINT, buildPersonHistory, costModelBadge, costModelBody, buildSchedule, defaultTenancyUnitId, overlapQuestion, prepaymentColumn, tenancyRequired, type TenancyField, scheduleField, scheduleLabel, scheduleMonthText, showsFlatRates, startsSchedule } from '../tenancyModel'
import { useOpenForm, useProperty, withProperty } from '../property'
import { buildTenantChange, defaultStart, EMPTY_NEW_TENANT, INTERIM_FEE_HINT, INTERIM_GAP_OPTIONS, parseMeterValue, successorHeatingNote, tenantChangeProblems, type NewTenantForm, type TenantChangeField } from '../tenantChange'
import { gapConsequence } from '../heatingSelfView'
import PeriodCard from '../components/PeriodCard'
import Card from '../components/Card'
import PageHeader from '../components/PageHeader'
import { emptyUnitsText } from '../propertyView'
import Term from '../components/Term'
import { useToast, useConfirm } from '../components/feedback'
import MonthField from '../components/MonthField'
import Table from '../components/Table'
import HeatingCard from '../components/HeatingCard'
import { useFocusTarget, type FocusProps } from '../focus'
import { tenancyStamp } from '../../../shared/tenancyStamp.ts'

type Props = {
  units: Unit[]
  tenancies: Tenancy[]
  settings: Settings | null
  reload: () => Promise<void>
} & FocusProps

type TenancyForm = {
  id?: string
  unitId: string
  tenantName: string
  personHistory: { from: string; persons: string }[]
  start: string
  end: string
  baseRents: { from: string; amount: string }[]
  prepayments: { from: string; amount: string }[]
  // Pauschale je Monat (#93), eigene Staffel
  flatRates: { from: string; amount: string }[]
  // Heizvorauszahlung je Monat (Heizung PR 5): nach dem Aufteilen bei getrennter Heizkostenabrechnung
  heatingPrepayments: { from: string; amount: string }[]
  // erweiterte Stammdaten (optional)
  email: string
  phone: string
  correspondenceAddress: string
  iban: string
  contractDate: string
  deposit: string
  depositStatus: DepositStatus
  notes: string
  // Nebenkostenmodell (#93)
  costModel: CostModel
  heatingModel: HeatingModel
  // Durchsicht S-2: welche Heizung der Mieter selbst betreibt; '' keine Angabe.
  selfSupplyKind: SelfSupplyKind | ''
  // Die Marke des Stands, aus dem das Formular gefüllt wurde (Laienprobe B1, shared/tenancyStamp.ts).
  stamp?: string
}

const EMPTY_UNIT: UnitForm = EMPTY_UNIT_FORM

// Leere erweiterte Mieter-Felder — bei „neu“ und (mit Werten) beim Bearbeiten verwendet
const EMPTY_TENANCY_EXTRA = {
  email: '', phone: '', correspondenceAddress: '', iban: '', contractDate: '', deposit: '', depositStatus: 'offen' as DepositStatus, notes: '',
  costModel: 'settlement' as CostModel, heatingModel: 'settlement' as HeatingModel, selfSupplyKind: '' as SelfSupplyKind | '',
  flatRates: [] as { from: string; amount: string }[],
  heatingPrepayments: [] as { from: string; amount: string }[],
}

// Heute als JJJJ-MM-TT, örtlich: „läuft noch“ ist eine Frage an den Kalender des Nutzers.
const localToday = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Formular aus einem gespeicherten Mietverhältnis füllen; auch „Hier beheben →“ öffnet es so (#142).
function tenancyToForm(t: Tenancy): TenancyForm {
  return {
    id: t.id,
    unitId: t.unitId,
    tenantName: t.tenantName,
    personHistory: (t.personHistory ?? [{ from: t.start, persons: t.persons }]).map((p) => ({
      from: p.from,
      persons: String(p.persons),
    })),
    start: t.start,
    end: t.end ?? '',
    baseRents: (t.baseRents ?? []).map((p) => ({
      from: scheduleMonthText(p.from),
      amount: (p.monthlyCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
    })),
    prepayments: t.prepayments.map((p) => ({
      from: scheduleMonthText(p.from),
      amount: (p.monthlyCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
    })),
    email: t.email ?? '',
    phone: t.phone ?? '',
    correspondenceAddress: t.correspondenceAddress ?? '',
    iban: ibanToInput(t.iban),
    contractDate: t.contractDate ?? '',
    deposit: t.depositCents != null ? (t.depositCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '',
    depositStatus: t.depositStatus ?? 'offen',
    notes: t.notes ?? '',
    costModel: t.costModel ?? 'settlement',
    heatingModel: t.heatingModel ?? 'settlement',
    selfSupplyKind: t.selfSupplyKind ?? '',
    flatRates: (t.flatRates ?? []).map((p) => ({
      from: scheduleMonthText(p.from),
      amount: (p.monthlyCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
    })),
    heatingPrepayments: (t.heatingPrepayments ?? []).map((p) => ({
      from: scheduleMonthText(p.from),
      amount: (p.monthlyCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
    })),
    stamp: tenancyStamp(t),
  }
}

export default function Stammdaten({ units, tenancies, settings, reload, focus, onFocusDone }: Props) {
  const toast = useToast()
  // Kein doppeltes Speichern (Durchsicht S1): `busy` an Fenster und Knopf, ein zweiter Aufruf fällt weg.
  const saving = useSaving()
  const confirm = useConfirm()
  const { property } = useProperty()
  const propertyId = property?.id
  const [unitForm, setUnitForm] = useState<UnitForm | null>(null)
  const [tenForm, setTenForm] = useState<TenancyForm | null>(null)
  const [wizardFor, setWizardFor] = useState<Tenancy | null>(null)
  // Der Mieterwechsel ist gespeichert, aber die Ansicht ließ sich nicht neu laden (#150).
  const [staleAfterChange, setStaleAfterChange] = useState(false)
  // Die Fehler der beiden Seitenfenster, im Fuß des Fensters (#346, Schritt 3)
  const unitErrors = useFormError<UnitField>()
  const tenErrors = useFormError<TenancyField>()
  // Die Zählerarten des Objekts, für die Frage nach den Anschlüssen einer Einheit (#142).
  const [objectMeters, setObjectMeters] = useState<Meter[]>([])
  useEffect(() => {
    if (!propertyId) return
    let alive = true
    void api<Meter[]>(withProperty('/api/meters', propertyId))
      .then((all) => { if (alive) setObjectMeters(all) })
      .catch(() => { if (alive) setObjectMeters([]) })
    return () => { alive = false }
  }, [propertyId])
  // Die Heizanlagen (Heizung PR 5): Rechnet die Anlage einer Wohnung die Heizkosten getrennt ab, fragen
  // Mietverhältnis und Mieterwechsel die Heizvorauszahlung mit ab (Durchsicht von #231).
  const [plants, setPlants] = useState<HeatingPlant[]>([])
  const [plantsVersion, setPlantsVersion] = useState(0)
  useEffect(() => {
    if (!propertyId) return
    let alive = true
    void api<HeatingPlant[]>(withProperty('/api/heating-plants', propertyId))
      .then((all) => { if (alive) setPlants(Array.isArray(all) ? all : []) })
      .catch(() => { if (alive) setPlants([]) })
    return () => { alive = false }
  }, [propertyId, plantsVersion])
  // Laienprobe B1: Das Einschalten der getrennten Heizkostenabrechnung teilt die Staffeln der
  // Mietverhältnisse auf, ein Wechsel des Zeitraums schreibt ihre Jahreskorrekturen neu. Danach lädt
  // die Seite beides neu; sonst zeigte das Formular den alten Stand und schriebe ihn beim Speichern zurück.
  async function afterHeatingOrPeriodChange() {
    setPlantsVersion((v) => v + 1)
    await reload()
  }
  // „Hier beheben →“ aus der Abrechnung (#142): die betroffene Wohnung oder das Mietverhältnis öffnen.
  useFocusTarget(focus, 'unit', units, (u) => u.id, (u) => { unitErrors.clear(); setUnitForm(unitToForm(u)) }, onFocusDone)
  useFocusTarget(focus, 'tenancy', tenancies, (t) => t.id, (t) => { tenErrors.clear(); setTenForm(tenancyToForm(t)) }, onFocusDone)

  async function saveUnit() {
    if (!unitForm) return
    const built = buildUnitBody(unitForm)
    if ('problems' in built) {
      unitErrors.report(built.problems)
      return
    }
    unitErrors.clear()
    const body = JSON.stringify(built.body)
    const editing = !!unitForm.id
    // Lehnt der Server ab (#146), bleibt der Dialog offen und zeigt seinen Satz.
    try {
      if (editing) await api(`/api/units/${unitForm.id}`, { method: 'PUT', body })
      else await api(withProperty('/api/units', propertyId), { method: 'POST', body })
    } catch (e) {
      unitErrors.show(errorText(e))
      return
    }
    setUnitForm(null)
    await reload()
    toast(editing ? `Wohnung „${unitForm.name.trim()}“ gespeichert.` : `Wohnung „${unitForm.name.trim()}“ angelegt.`)
  }

  async function deleteUnit(u: Unit) {
    // Was mitgelöscht wird, mit Anzahl (#142); ohne Antwort die vollständige Liste ohne Zahlen.
    const deps = await api<UnitDependents>(`/api/units/${u.id}/dependents`).catch(() => null)
    const blocked = unitDeleteBlocked(deps)
    if (blocked) {
      // Eine Aktion ohne Formular meldet ihren Fehler als Mitteilung, nicht oben auf der Seite (H3).
      toast(blocked, 'error')
      return
    }
    const ok = await confirm({
      title: `Wohnung „${u.name}“ löschen?`,
      message: unitDeleteMessage(deps),
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/units/${u.id}`, { method: 'DELETE' })
    } catch (e) {
      toast(errorText(e), 'error')
      return
    }
    await reload()
    toast(`Wohnung „${u.name}“ gelöscht.`)
  }

  async function saveTenancy() {
    if (!tenForm) return
    // Jede fehlende Pflichtangabe mit ihrem Feld (#346, Schritt 3); vorher „Bitte Mieter, Wohnung und
    // Einzugsdatum prüfen.“ für alle drei zusammen (UI-Durchsicht M5).
    const missing = tenancyRequired(tenForm)
    if (missing.length > 0) {
      tenErrors.report(missing)
      return
    }
    const setError = tenErrors.set
    const persons = buildPersonHistory(tenForm.personHistory, tenForm.start)
    if ('error' in persons) {
      setError(persons.error)
      return
    }
    const { personHistory } = persons
    // Nur die erste Zeile einer Staffel gilt ohne Monat ab Einzug (Durchsicht von #287, tenancyModel.ts).
    // Die Angaben aller Staffeln auf einmal, je an ihrem Feld (#346, Schritt 5).
    const rents = buildSchedule(tenForm.baseRents, tenForm.start, 'baseRent')
    const pre = buildSchedule(tenForm.prepayments, tenForm.start, 'prepayment')
    const flat = buildSchedule(showsFlatRates(tenForm.costModel, tenForm.heatingModel) ? tenForm.flatRates : [], tenForm.start, 'flatRate')
    // Heizung PR 5: die Heizstaffel neben der übrigen Vorauszahlung (nach dem Aufteilen, Entwurf 3.1).
    const heat = buildSchedule(tenForm.heatingPrepayments, tenForm.start, 'heatingPrepayment')
    const scheduleProblems = [rents, pre, heat, flat].flatMap((r) => ('problems' in r ? r.problems : []))
    if ('problems' in rents || 'problems' in pre || 'problems' in flat || 'problems' in heat) {
      tenErrors.report(scheduleProblems)
      return
    }
    const baseRents = [...rents.schedule].sort((a, b) => a.from.localeCompare(b.from))
    const prepayments = pre.schedule
    const flatRates = flat.schedule
    const heating = heat.schedule
    let depositCents: number | null = null
    if (tenForm.deposit.trim()) {
      depositCents = parseEuro(tenForm.deposit)
      if (depositCents === null) {
        tenErrors.report([{ field: 'deposit', short: 'Kein Betrag', text: 'Kaution bitte als Betrag angeben (oder leer lassen).' }])
        return
      }
    }
    if (tenForm.contractDate && !/^\d{4}-\d{2}-\d{2}$/.test(tenForm.contractDate)) {
      tenErrors.report([{ field: 'contractDate', short: 'Kein Datum', text: 'Vertragsdatum bitte als gültiges Datum angeben.' }])
      return
    }
    // Eine neue ungültige IBAN wird nicht gespeichert (#279); eine gespeicherte ungültige geht
    // unverändert mit, damit die übrigen Angaben trotzdem gespeichert werden.
    const storedIban = tenancies.find((t) => t.id === tenForm.id)?.iban
    const iban = ibanForSave(tenForm.iban, storedIban, IBAN_LABELS.tenancy)
    if ('error' in iban) {
      tenErrors.report([{ field: 'iban', short: 'IBAN ungültig', text: iban.error }])
      return
    }
    tenErrors.clear()
    // null statt undefined, damit geleerte Felder über die generische PUT-Route zurückgesetzt werden
    const body = JSON.stringify({
      unitId: tenForm.unitId,
      tenantName: tenForm.tenantName.trim(),
      persons: personHistory[personHistory.length - 1].persons,
      personHistory,
      start: tenForm.start,
      end: tenForm.end || null,
      baseRents,
      prepayments,
      email: tenForm.email.trim() || null,
      phone: tenForm.phone.trim() || null,
      correspondenceAddress: tenForm.correspondenceAddress.trim() || null,
      iban: iban.value || null,
      contractDate: tenForm.contractDate || null,
      depositCents,
      depositStatus: depositCents !== null ? tenForm.depositStatus : null,
      notes: tenForm.notes.trim() || null,
      ...costModelBody(tenForm.costModel, tenForm.heatingModel),
      selfSupplyKind: tenForm.heatingModel === 'selfSupply' && tenForm.selfSupplyKind !== '' ? tenForm.selfSupplyKind : null,
      flatRates,
      heatingPrepayments: heating,
      // Laienprobe B1: Hat sich der Stand inzwischen geändert, lehnt der Server ab, statt ihn zu ersetzen.
      ...(tenForm.stamp ? { ifUnchanged: tenForm.stamp } : {}),
    })
    const editing = !!tenForm.id
    // Überschneidung mit einem anderen Mietverhältnis derselben Wohnung (#204): nachfragen, nicht
    // verweigern; der Server nimmt es an, die Abrechnung meldet es.
    const overlap = overlapQuestion({ id: tenForm.id, unitId: tenForm.unitId, start: tenForm.start, end: tenForm.end || null }, tenancies)
    if (overlap && !(await confirm(overlap))) return
    try {
      if (editing) await api(`/api/tenancies/${tenForm.id}`, { method: 'PUT', body })
      else await api('/api/tenancies', { method: 'POST', body })
    } catch (e) {
      tenErrors.show(errorText(e))
      return
    }
    const name = tenForm.tenantName.trim()
    setTenForm(null)
    await reload()
    toast(editing ? `Mietverhältnis „${name}“ gespeichert.` : `Mietverhältnis „${name}“ angelegt.`)
  }

  async function deleteTenancy(t: Tenancy) {
    const ok = await confirm({
      title: `Mietverhältnis „${t.tenantName}“ löschen?`,
      message: 'Das Mietverhältnis und zugehörige Zahlungen werden gelöscht.',
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/tenancies/${t.id}`, { method: 'DELETE' })
    } catch (e) {
      toast(errorText(e), 'error')
      return
    }
    await reload()
    toast(`Mietverhältnis „${t.tenantName}“ gelöscht.`)
  }

  const participating = units.filter((u) => u.participates)
  // Miteigentumsanteile (#142): bei einer Eigentumswohnung immer, sonst sobald eine Wohnung welche hat.
  const showsMea = property?.kind === 'etw' || units.some((u) => u.mea != null)

  return (
    <>
      <PageHeader context="property" title="Stammdaten" subtitle="Objekt, Wohnungen und Mietverhältnisse — die Grundlage jeder Abrechnung." />

      {/* Fehler beim Löschen (#146); die der Formulare stehen in ihrem Dialog. */}

      <PropertyCard />
      <PeriodCard onChanged={afterHeatingOrPeriodChange} />

      {/* Neues anlegen steht oben rechts im Kartenkopf (#346 Schritt 7b). */}
      <Card title="Wohnungen" aside={<button className="btn secondary" onClick={() => { unitErrors.clear(); setUnitForm({ ...EMPTY_UNIT }) }}>+ Wohnung anlegen</button>}>
        {units.length === 0 && <div className="empty">{emptyUnitsText(property?.kind ?? 'mfh')}</div>}
        {units.length > 0 && (
          <Table className="stacked">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Wohnfläche</th>
                {showsMea && <th className="num"><Term id="mea">MEA</Term></th>}
                <th>Kostenverteilung</th>
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td data-label="Name">
                    {u.name}
                    {(u.rooms != null || u.floor || u.notes) && (
                      <div className="muted cell-sub">
                        {[u.floor, u.rooms != null ? `${u.rooms.toLocaleString('de-DE')} Zi.` : null, u.notes].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="num" data-label="Wohnfläche">{u.areaM2.toLocaleString('de-DE')} m²</td>
                  {showsMea && <td className="num" data-label="MEA">{u.mea != null ? u.mea.toLocaleString('de-DE') : '—'}</td>}
                  <td data-label="Kostenverteilung">
                    {usageOf(u) === 'vermietet' && <span className="badge accent">beteiligt</span>}
                    {usageOf(u) === 'eigen' && (
                      <span className="badge gray" title="In der Verteilbasis, Anteil trägt der Vermieter">
                        Eigennutzung — Eigenanteil
                      </span>
                    )}
                    {usageOf(u) === 'ausgenommen' && (
                      <span className="badge gray" title="Bleibt vollständig außen vor">nicht beteiligt</span>
                    )}
                    {/* Eine Einheit ohne Anschluss (#117, #142) soll man in der Liste sehen. */}
                    {connectionSummary(u.noConnection ?? []) && (
                      <span className="badge gray badge-next">{connectionSummary(u.noConnection ?? [])}</span>
                    )}
                  </td>
                  <td className="actions no-print">
                    <button className="icon-btn" title="Bearbeiten" aria-label="Wohnung bearbeiten" onClick={() => { unitErrors.clear(); setUnitForm(unitToForm(u)) }}>✎</button>
                    <button className="icon-btn danger" title="Löschen" aria-label="Wohnung löschen" onClick={() => deleteUnit(u)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {units.length > 0 && participating.length === 0 && (
          <div className="notice">Keine Wohnung ist an der Kostenverteilung beteiligt — die Abrechnung wäre leer.</div>
        )}
      </Card>

      {/* Heizung PR 4: optional, nach den Wohnungen, weil Schritt 4 nach ihnen fragt. */}
      <HeatingCard units={units} focus={focus} onFocusDone={onFocusDone} onChanged={afterHeatingOrPeriodChange} />

      <Card
        title="Mietverhältnisse"
        aside={(
          <span className="flex flex-wrap items-center justify-end gap-2">
            {/* Ein gesperrter Knopf nennt seinen Grund (#346, Schritt 10, M14). */}
            {units.length === 0 && <span id="tenancy-needs-unit" className="muted">Legen Sie zuerst eine Wohnung an.</span>}
            <button
              className="btn secondary"
              onClick={() => { tenErrors.clear(); setTenForm({ unitId: defaultTenancyUnitId(units, tenancies, localToday()), tenantName: '', personHistory: [{ from: '', persons: '2' }], start: '', end: '', baseRents: [{ from: '', amount: '' }], prepayments: [{ from: '', amount: '' }], ...EMPTY_TENANCY_EXTRA }) }}
              disabled={units.length === 0}
              aria-describedby={units.length === 0 ? 'tenancy-needs-unit' : undefined}
            >
              + Mietverhältnis anlegen
            </button>
          </span>
        )}
      >
        {staleAfterChange && (
          <div className="notice" role="status">Der Mieterwechsel ist gespeichert; die Ansicht ließ sich nicht neu laden, bitte Seite neu laden.</div>
        )}
        <p className="muted">
          Personenzahl und Vorauszahlung werden als Staffel erfasst („ab X gilt Y“) — Änderungen
          wie Geburt, Auszug einzelner Personen oder Vorauszahlungs-Erhöhungen brauchen kein
          neues Mietverhältnis. Nur bei echtem Mieterwechsel das alte Mietverhältnis beenden
          und ein neues anlegen.
        </p>
        {tenancies.length === 0 && <div className="empty">Noch keine Mietverhältnisse angelegt.</div>}
        {tenancies.length > 0 && (
          // Die Tabelle muss in ihre Karte passen (#180): Bei 1.280 px war sie 1.234 px breit in einer
          // Karte von 953 px, und Mieterwechsel, ✎ und 🗑 lagen nur durch Scrollen im Bild. Deshalb
          // dürfen Kopfzeilen, Staffeln und die Aktionen umbrechen, jeweils nur an einer sinnvollen
          // Stelle (zwischen „ab …:“ und dem Wert, zwischen Knopf und Symbolen).
          <Table className="tenancy-table stacked">
            <thead>
              <tr>
                <th>Mieter</th>
                <th>Wohnung</th>
                <th className="num">Personen</th>
                <th>Zeitraum</th>
                <th className="num">Kaltmiete je Monat</th>
                <th className="num">Voraus{'\u00ad'}zahlung je Monat</th>
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {tenancies.map((t) => (
                <tr key={t.id}>
                  <td data-label="Mieter">
                    {t.tenantName}
                    {/* Pauschale oder Inklusivmiete auf einen Blick (#142); die Abrechnung ist der Normalfall. */}
                    {costModelBadge(t.costModel, t.heatingModel) && (
                      <div className="cell-sub">
                        <span className="badge gray" title="Nebenkostenmodell; ändern unter „Weitere Angaben“">
                          {costModelBadge(t.costModel, t.heatingModel)}
                        </span>
                      </div>
                    )}
                    {(t.email || t.phone) && (
                      <div className="muted cell-sub cell-contact" title={[t.email, t.phone].filter(Boolean).join(' · ')}>
                        {t.email}{t.email && t.phone && ' · '}{t.phone && <span className="nowrap">{t.phone}</span>}
                      </div>
                    )}
                    {t.depositCents != null && (
                      <div className="cell-sub">
                        <span className="muted">Kaution {fmtEuro(t.depositCents)}</span>{' '}
                        <span className={`badge ${t.depositStatus === 'erhalten' ? 'green' : t.depositStatus === 'offen' ? 'gray' : 'gray'}`}>
                          {DEPOSIT_STATUS_LABELS[t.depositStatus ?? 'offen']}
                        </span>
                      </div>
                    )}
                  </td>
                  <td data-label="Wohnung">{units.find((u) => u.id === t.unitId)?.name ?? '—'}</td>
                  <td className="num" data-label="Personen">
                    {(t.personHistory ?? []).map((p, i) => (
                      <div key={i}>
                        {(t.personHistory?.length ?? 0) > 1 && <><span className="muted nowrap">ab {fmtDate(p.from)}:</span>{' '}</>}
                        <span className="nowrap">{p.persons}</span>
                      </div>
                    ))}
                  </td>
                  <td data-label="Zeitraum">
                    {fmtDate(t.start)} – {t.end ? fmtDate(t.end) : 'laufend'}
                  </td>
                  <td className="num" data-label="Kaltmiete je Monat">
                    {(t.baseRents?.length ?? 0) === 0 && '—'}
                    {(t.baseRents ?? []).map((p, i) => (
                      <div key={i}>
                        {(t.baseRents?.length ?? 0) > 1 && <><span className="muted nowrap">ab {p.from.slice(5, 7)}/{p.from.slice(0, 4)}:</span>{' '}</>}
                        <span className="nowrap">{fmtEuro(p.monthlyCents)}</span>
                      </div>
                    ))}
                  </td>
                  <td className="num" data-label="Vorauszahlung je Monat">
                    {prepaymentColumn(t).length === 0 && '—'}
                    {prepaymentColumn(t).map((line, i) => (
                      <div key={i}>
                        {line.label !== null && <><span className="muted nowrap">{line.label}</span>{' '}</>}
                        <span className="nowrap">{line.amount}</span>
                      </div>
                    ))}
                  </td>
                  <td className="actions no-print">
                    {/* Sichtprüfung E13: Bearbeiten und Löschen stehen in jeder Zeile oben, der Mieterwechsel darunter */}
                    <div className="cell-actions">
                    <span className="nowrap">
                    <button
                      className="icon-btn"
                      title="Bearbeiten"
                      aria-label="Mietverhältnis bearbeiten"
                      onClick={() => {
                        tenErrors.clear()
                        setTenForm(tenancyToForm(t))
                      }}
                    >
                      ✎
                    </button>
                    <button className="icon-btn danger" title="Löschen" aria-label="Mietverhältnis löschen" onClick={() => deleteTenancy(t)}>🗑</button>
                    </span>
                    {!t.end && (
                      <button className="btn small secondary" title="Auszug, Zwischenablesung und neuer Mieter in einem Fenster" onClick={() => setWizardFor(t)}>
                        Mieterwechsel
                      </button>
                    )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {tenForm && (
        <Drawer
          // Ein anderer Datensatz im offenen Fenster ist ein neues Formular (Durchsicht S3)
          key={tenForm.id ?? 'neu'}
          open
          title={tenForm.id ? 'Mietverhältnis bearbeiten' : 'Neues Mietverhältnis'}
          subtitle={tenForm.id ? tenForm.tenantName : undefined}
          onClose={() => { tenErrors.clear(); setTenForm(null) }}
          onSubmit={() => void saving.run(saveTenancy)}
          busy={saving.busy}
          width={480}
          // Die IBAN schreibt das Feld beim Verlassen in Vierergruppen um; das ist keine Änderung (Durchsicht K5)
          value={{ ...tenForm, iban: normalizeIban(tenForm.iban) }}
          errors={tenErrors}
          actions={<button className="btn" disabled={saving.busy} onClick={() => void saving.run(saveTenancy)}>{tenForm.id ? 'Speichern' : 'Anlegen'}</button>}
        >
          <div className="row">
            <Field label="Mieter" required {...tenErrors.field('tenantName')}>
              <input value={tenForm.tenantName} onChange={(e) => setTenForm({ ...tenForm, tenantName: e.target.value })} placeholder="z. B. Familie Müller" />
            </Field>
            <Field label="Wohnung" required {...tenErrors.field('unitId')}>
              <select value={tenForm.unitId} onChange={(e) => setTenForm({ ...tenForm, unitId: e.target.value })}>
                <option value="">— wählen —</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Einzug" required {...tenErrors.field('start')}>
              <input type="date" value={tenForm.start} onChange={(e) => setTenForm({ ...tenForm, start: e.target.value })} />
            </Field>
            <Field label="Auszug" hint="Leer lassen, solange das Mietverhältnis läuft.">
              <input type="date" value={tenForm.end} onChange={(e) => setTenForm({ ...tenForm, end: e.target.value })} />
            </Field>

            <div className="field-group">
              <div className="field-group-label">Personenzahl — Staffel</div>
              {tenForm.personHistory.map((p, i) => (
                <div className="staffel-row" key={i}>
                  <label className="field">
                    Personenzahl gültig ab
                    <input type="date" value={p.from} onChange={(e) => setTenForm({ ...tenForm, personHistory: tenForm.personHistory.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })} />
                  </label>
                  <label className="field">
                    Personen
                    <input value={p.persons} inputMode="numeric" onChange={(e) => setTenForm({ ...tenForm, personHistory: tenForm.personHistory.map((x, k) => (k === i ? { ...x, persons: e.target.value } : x)) })} />
                  </label>
                  {tenForm.personHistory.length > 1
                    ? <button className="icon-btn danger" title="Zeile entfernen" aria-label="Zeile entfernen" onClick={() => { tenErrors.clear(); setTenForm({ ...tenForm, personHistory: tenForm.personHistory.filter((_, k) => k !== i) }) }}>🗑</button>
                    : <span />}
                </div>
              ))}
              <small className="muted">0 Personen für Garage, Stellplatz oder Lager; das Mietverhältnis zählt dann beim Personenschlüssel nicht mit.</small>
              <button className="btn small secondary field-add" onClick={() => setTenForm({ ...tenForm, personHistory: [...tenForm.personHistory, { from: '', persons: '' }] })}>+ Änderung ab Datum …</button>
            </div>

            <div className="field-group">
              <div className="field-group-label">Kaltmiete je Monat — Staffel (leer = nur NK)</div>
              {tenForm.baseRents.map((p, i) => (
                <div className="staffel-row" key={i}>
                  <MonthField label={scheduleLabel('baseRent')} placeholder={startsSchedule(tenForm.baseRents, i) ? 'ab Einzug' : undefined} value={p.from} start={tenForm.start} today={localToday()} {...tenErrors.field(scheduleField('baseRent', i, 'from'))} onChange={(from) => setTenForm({ ...tenForm, baseRents: tenForm.baseRents.map((x, k) => (k === i ? { ...x, from } : x)) })} />
                  <Field label="Betrag €/Monat" {...tenErrors.field(scheduleField('baseRent', i, 'amount'))}>
                    <input inputMode="decimal" value={p.amount} placeholder="z. B. 800,00" onChange={(e) => setTenForm({ ...tenForm, baseRents: tenForm.baseRents.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)) })} />
                  </Field>
                  {tenForm.baseRents.length > 1
                    ? <button className="icon-btn danger" title="Zeile entfernen" aria-label="Zeile entfernen" onClick={() => { tenErrors.clear(); setTenForm({ ...tenForm, baseRents: tenForm.baseRents.filter((_, k) => k !== i) }) }}>🗑</button>
                    : <span />}
                </div>
              ))}
              <button className="btn small secondary field-add" onClick={() => setTenForm({ ...tenForm, baseRents: [...tenForm.baseRents, { from: '', amount: '' }] })}>+ Mieterhöhung ab Monat …</button>
            </div>

            <div className="field-group">
              <div className="field-group-label">NK-<Term id="prepayment">Vorauszahlung</Term> je Monat — Staffel</div>
              {tenForm.prepayments.map((p, i) => (
                <div className="staffel-row" key={i}>
                  <MonthField label={scheduleLabel('prepayment')} placeholder={startsSchedule(tenForm.prepayments, i) ? 'ab Einzug' : undefined} value={p.from} start={tenForm.start} today={localToday()} {...tenErrors.field(scheduleField('prepayment', i, 'from'))} onChange={(from) => setTenForm({ ...tenForm, prepayments: tenForm.prepayments.map((x, k) => (k === i ? { ...x, from } : x)) })} />
                  <Field label="Betrag €/Monat" {...tenErrors.field(scheduleField('prepayment', i, 'amount'))}>
                    <input inputMode="decimal" value={p.amount} placeholder="z. B. 150,00" onChange={(e) => setTenForm({ ...tenForm, prepayments: tenForm.prepayments.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)) })} />
                  </Field>
                  {tenForm.prepayments.length > 1
                    ? <button className="icon-btn danger" title="Zeile entfernen" aria-label="Zeile entfernen" onClick={() => { tenErrors.clear(); setTenForm({ ...tenForm, prepayments: tenForm.prepayments.filter((_, k) => k !== i) }) }}>🗑</button>
                    : <span />}
                </div>
              ))}
              <button className="btn small secondary field-add" onClick={() => setTenForm({ ...tenForm, prepayments: [...tenForm.prepayments, { from: '', amount: '' }] })}>+ Erhöhung ab Monat …</button>
            </div>

            {(() => {
              // Bei getrennter Heizkostenabrechnung gehört zu jedem Mietverhältnis seine Heizvorauszahlung,
              // auch zu einem neuen (Durchsicht von #231); die Staffel oben ist dann die übrige Vorauszahlung.
              // Eine eigene Feldgruppe mit dem Abstand der übrigen, und der Satz nennt den Grund
              // (Rückmeldung zur Laienprobe).
              const plant = separateHeatingPlant(units.find((u) => u.id === tenForm.unitId) ?? { id: tenForm.unitId }, plants)
              if (tenForm.heatingPrepayments.length === 0 && plant === null) return null
              const rows = tenForm.heatingPrepayments.length > 0 ? tenForm.heatingPrepayments : [{ from: '', amount: '' }]
              return (
                <div className="field-group">
                  <div className="field-group-label">Heizvorauszahlung je Monat (neben der übrigen Vorauszahlung) — Staffel</div>
                  <p className="muted">
                    {plant
                      ? <>Erscheint, weil die Heizung „{plant.name || 'Heizanlage'}“ die Heizkosten getrennt abrechnet (<Term id="separateHeatingSettlement">getrennte Heizkostenabrechnung</Term> mit eigener Vorauszahlung). Ändern unter Stammdaten → Heizung.</>
                      : <>Erscheint, weil für dieses Mietverhältnis eine Heizvorauszahlung eingetragen ist.</>}
                    {' '}Die Staffel „NK-Vorauszahlung“ oben ist dann die übrige Vorauszahlung; ändert sich eine der beiden, tragen Sie die neue ab demselben Monat hier oder oben ein.
                  </p>
                  {rows.map((p, i) => (
                    <div key={i} className="staffel-row">
                      <MonthField label={scheduleLabel('heatingPrepayment')} placeholder={startsSchedule(rows, i) ? 'ab Einzug' : undefined} value={p.from} start={tenForm.start} today={localToday()} {...tenErrors.field(scheduleField('heatingPrepayment', i, 'from'))} onChange={(from) => setTenForm({ ...tenForm, heatingPrepayments: rows.map((x, k) => (k === i ? { ...x, from } : x)) })} />
                      <Field label="Betrag €/Monat" {...tenErrors.field(scheduleField('heatingPrepayment', i, 'amount'))}>
                        <input inputMode="decimal" value={p.amount} placeholder="z. B. 120,00" onChange={(e) => setTenForm({ ...tenForm, heatingPrepayments: rows.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)) })} />
                      </Field>
                      {rows.length > 1
                        ? <button className="icon-btn danger" title="Zeile entfernen" aria-label="Zeile entfernen" onClick={() => { tenErrors.clear(); setTenForm({ ...tenForm, heatingPrepayments: rows.filter((_, k) => k !== i) }) }}>🗑</button>
                        : <span />}
                    </div>
                  ))}
                  <button className="btn small secondary field-add" onClick={() => setTenForm({ ...tenForm, heatingPrepayments: [...rows, { from: '', amount: '' }] })}>+ Änderung ab Monat …</button>
                </div>
              )
            })()}

            {/* Aufgeklappt, wenn die gespeicherte IBAN vermutlich falsch ist (#279): Der Hinweis steht darin. */}
            <details className="extra-details" style={{ width: '100%' }} open={storedIbanInvalid(tenancies.find((t) => t.id === tenForm.id)?.iban) || undefined}>
              <summary>Weitere Angaben — Nebenkosten-Modell, Kontakt, Kaution, Vertrag (optional)</summary>
              <div className="row">
                <label className="field" title="Pauschale nach § 556 Abs. 2 BGB oder Inklusivmiete: dann gibt es keine Nebenkostenabrechnung">
                  <span>Nebenkosten (<Term id="flatRate">Pauschale</Term>, <Term id="inclusiveRent">Inklusivmiete</Term>)</span>
                  <select value={tenForm.costModel} onChange={(e) => setTenForm({ ...tenForm, costModel: e.target.value as CostModel })}>
                    {(Object.keys(COST_MODEL_LABELS) as CostModel[]).map((m) => <option key={m} value={m}>{COST_MODEL_LABELS[m]}</option>)}
                  </select>
                </label>
                <label className="field" title="Für die Kostenart Heizung und Warmwasser; eine Pauschale oder Warmmiete ist nur im selbstbewohnten Zweifamilienhaus zulässig (§ 2 HeizkostenV)">
                  <span>Heizung und Warmwasser (<Term id="heatingCostOrdinance">HeizkostenV</Term>)</span>
                  <select value={tenForm.heatingModel} onChange={(e) => setTenForm({ ...tenForm, heatingModel: (Object.keys(HEATING_MODEL_LABELS) as HeatingModel[]).find((m) => m === e.target.value) ?? 'settlement' })}>
                    {(Object.keys(HEATING_MODEL_LABELS) as HeatingModel[]).map((m) => <option key={m} value={m}>{HEATING_MODEL_LABELS[m]}</option>)}
                  </select>
                </label>
              </div>
              {/* Heizung PR 19 (#97): die Hinweispflicht nach § 6 Abs. 2 Satz 6 CO2KostAufG. */}
              {tenForm.heatingModel === 'selfSupply' && (
                <>
                  <label className="field">
                    <span>Welche Heizung betreibt der Mieter selbst?</span>
                    <select value={tenForm.selfSupplyKind} onChange={(e) => setTenForm({ ...tenForm, selfSupplyKind: SELF_SUPPLY_KIND_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '' })}>
                      {SELF_SUPPLY_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                  <div className="muted">{SELF_SUPPLY_TENANCY_HINT} <Term id="co2Refund">Mehr zur CO₂-Erstattung</Term></div>
                </>
              )}
              {showsFlatRates(tenForm.costModel, tenForm.heatingModel) && (
                <div className="field-group">
                  <div className="field-group-label">Pauschale je Monat — Staffel</div>
                  <div className="muted">
                    Die Pauschale steht im Mietkonto, wird aber nie abgerechnet. Eine Vorauszahlung für die
                    abgerechnete Art gehört in die Staffel „NK-Vorauszahlung“ oben.
                  </div>
                  {(tenForm.flatRates.length > 0 ? tenForm.flatRates : [{ from: '', amount: '' }]).map((p, i, alle) => (
                    <div className="staffel-row" key={i}>
                      <MonthField label={scheduleLabel('flatRate')} placeholder={startsSchedule(alle, i) ? 'ab Einzug' : undefined} value={p.from} start={tenForm.start} today={localToday()} {...tenErrors.field(scheduleField('flatRate', i, 'from'))} onChange={(from) => setTenForm({ ...tenForm, flatRates: alle.map((x, k) => (k === i ? { ...x, from } : x)) })} />
                      <Field label="Betrag €/Monat" {...tenErrors.field(scheduleField('flatRate', i, 'amount'))}>
                        <input inputMode="decimal" value={p.amount} placeholder="z. B. 90,00" onChange={(e) => setTenForm({ ...tenForm, flatRates: alle.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)) })} />
                      </Field>
                      {alle.length > 1
                        ? <button className="icon-btn danger" title="Zeile entfernen" aria-label="Zeile entfernen" onClick={() => { tenErrors.clear(); setTenForm({ ...tenForm, flatRates: alle.filter((_, k) => k !== i) }) }}>🗑</button>
                        : <span />}
                    </div>
                  ))}
                  <button className="btn small secondary field-add" onClick={() => setTenForm({ ...tenForm, flatRates: [...(tenForm.flatRates.length > 0 ? tenForm.flatRates : [{ from: '', amount: '' }]), { from: '', amount: '' }] })}>+ Änderung ab Monat …</button>
                </div>
              )}
              <div className="row">
                <Field label="E-Mail">
                  <input type="email" value={tenForm.email} onChange={(e) => setTenForm({ ...tenForm, email: e.target.value })} placeholder="mieter@example.de" />
                </Field>
                <Field label="Telefon">
                  <input value={tenForm.phone} onChange={(e) => setTenForm({ ...tenForm, phone: e.target.value })} placeholder="0123 456789" />
                </Field>
                <Field label="Abweichende Anschrift (Schriftverkehr)">
                  <input value={tenForm.correspondenceAddress} onChange={(e) => setTenForm({ ...tenForm, correspondenceAddress: e.target.value })} placeholder="z. B. neue Adresse nach Auszug" />
                </Field>
                {/* Je Mietverhältnis neu (Durchsicht zu #279): Der Dialog bleibt offen, wenn „Hier beheben →“
                    oder ein Klick in der Liste ein anderes öffnet, und das Feld wüsste sonst noch,
                    dass es schon verlassen wurde. */}
                <IbanInput
                  key={tenForm.id ?? 'neu'}
                  label="Mieter-IBAN (für Lastschrift / Guthaben-Rückzahlung)"
                  value={tenForm.iban}
                  stored={tenancies.find((t) => t.id === tenForm.id)?.iban}
                  onChange={(iban) => setTenForm({ ...tenForm, iban })}
                  placeholder="DE.."
                  {...tenErrors.field('iban')}
                />
                <Field label="Vertragsdatum" {...tenErrors.field('contractDate')}>
                  <input type="date" value={tenForm.contractDate} onChange={(e) => setTenForm({ ...tenForm, contractDate: e.target.value })} />
                </Field>
                <Field label="Kaution €" {...tenErrors.field('deposit')}>
                  <input value={tenForm.deposit} inputMode="decimal" placeholder="z. B. 2.400,00" onChange={(e) => setTenForm({ ...tenForm, deposit: e.target.value })} />
                </Field>
                <Field label="Kautionsstatus">
                  <select value={tenForm.depositStatus} disabled={!tenForm.deposit.trim()} onChange={(e) => setTenForm({ ...tenForm, depositStatus: e.target.value as DepositStatus })}>
                    {(Object.keys(DEPOSIT_STATUS_LABELS) as DepositStatus[]).map((s) => (
                      <option key={s} value={s}>{DEPOSIT_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Notiz">
                  <input value={tenForm.notes} onChange={(e) => setTenForm({ ...tenForm, notes: e.target.value })} placeholder="freie Notiz zum Mietverhältnis" />
                </Field>
              </div>
            </details>
          </div>
        </Drawer>
      )}

      {unitForm && (
        <Drawer
          // Ein anderer Datensatz im offenen Fenster ist ein neues Formular (Durchsicht S3)
          key={unitForm.id ?? 'neu'}
          open
          title={unitForm.id ? 'Wohnung bearbeiten' : 'Neue Wohnung'}
          subtitle={unitForm.id ? unitForm.name : undefined}
          onClose={() => { unitErrors.clear(); setUnitForm(null) }}
          onSubmit={() => void saving.run(saveUnit)}
          busy={saving.busy}
          value={unitForm}
          errors={unitErrors}
          actions={<button className="btn" disabled={saving.busy} onClick={() => void saving.run(saveUnit)}>{unitForm.id ? 'Speichern' : 'Anlegen'}</button>}
        >
          <div className="row">
            <Field label="Name" required {...unitErrors.field('name')}>
              <input value={unitForm.name} onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })} placeholder="z. B. OG links" />
            </Field>
            <Field label="Wohnfläche (m²)" required hint="0 für Garage, Stellplatz oder Lager; sie zählt dann beim Flächenschlüssel nicht mit." {...unitErrors.field('areaM2')}>
              <input value={unitForm.areaM2} inputMode="decimal" onChange={(e) => setUnitForm({ ...unitForm, areaM2: e.target.value })} placeholder="z. B. 85,5" />
            </Field>
            <Field label="Zimmer" {...unitErrors.field('rooms')}>
              <input inputMode="decimal" value={unitForm.rooms} onChange={(e) => setUnitForm({ ...unitForm, rooms: e.target.value })} placeholder="z. B. 3" />
            </Field>
            {(property?.kind === 'etw' || unitForm.mea.trim() !== '') && (
              <Field label={<Term id="mea">Miteigentumsanteile</Term>} hint="Aus der Teilungserklärung oder der Hausgeldabrechnung; für den Umlageschlüssel „laut Gemeinschaftsabrechnung“." {...unitErrors.field('mea')}>
                <input value={unitForm.mea} onChange={(e) => setUnitForm({ ...unitForm, mea: e.target.value })} placeholder="z. B. 124" inputMode="decimal" />
              </Field>
            )}
            <Field label="Etage" width="m">
              <input value={unitForm.floor} onChange={(e) => setUnitForm({ ...unitForm, floor: e.target.value })} placeholder="z. B. 1. OG" />
            </Field>
            <label className="field">
              Nutzung
              <select value={unitForm.usage} onChange={(e) => setUnitForm({ ...unitForm, usage: e.target.value as UnitUsage })}>
                {(Object.keys(UNIT_USAGE_LABELS) as UnitUsage[]).map((k) => (
                  <option key={k} value={k}>{UNIT_USAGE_LABELS[k]}</option>
                ))}
              </select>
              <small className="muted">
                {unitForm.usage === 'vermietet' && 'Die Wohnung nimmt an der Verteilung teil, ihren Anteil trägt der Mieter.'}
                {unitForm.usage === 'eigen' && <>Zählt in die <Term id="distributionBasis">Verteilbasis</Term>, hat aber keinen Mieter — der Anteil ist Ihr <Term id="ownShare">Eigenanteil</Term>. Richtig für selbst bewohnte Wohnungen, etwa neben einer <Term id="granny">Einliegerwohnung</Term>, denn Kosten für das ganze Haus dürfen nur anteilig umgelegt werden.</>}
                {unitForm.usage === 'ausgenommen' && <>Bleibt vollständig außen vor. Nur richtig, wenn die Wohnung nicht zur <Term id="billingUnit">Abrechnungseinheit</Term> gehört (z. B. separat abgerechnete Einheit) — sonst tragen die Mieter deren Anteil mit.</>}
              </small>
            </label>
            {unitForm.usage === 'eigen' && (
              <Field label="Personen im eigenen Haushalt" hint="Nur für den Personenschlüssel; ohne Angabe bleibt die eigene Wohnung dort unberücksichtigt." {...unitErrors.field('selfPersons')}>
                <input inputMode="numeric" value={unitForm.selfPersons} onChange={(e) => setUnitForm({ ...unitForm, selfPersons: e.target.value })} placeholder="z. B. 2" />
              </Field>
            )}
            <Field label="Notiz">
              <input value={unitForm.notes} onChange={(e) => setUnitForm({ ...unitForm, notes: e.target.value })} placeholder="z. B. Balkon, Stellplatz Nr. 2" />
            </Field>
            {/* Anschlüsse (#117, #142): positiv gefragt, gespeichert wird nur die Ausnahme. Nur
                Zählerarten des Objekts und schon gesetzte Ausnahmen; sonst gibt es nichts zu fragen. */}
            {connectionTypes(objectMeters, unitForm.noConnection).length > 0 && (
              <details className="extra-details">
                <summary>
                  Weitere Angaben — Anschlüsse{connectionSummary(unitForm.noConnection) ? `: ${connectionSummary(unitForm.noConnection)}` : ''}
                </summary>
                <fieldset className="field no-connection">
                  <legend className="field-legend"><Term id="noConnection">Anschlüsse</Term> dieser Einheit:</legend>
                  <div className="checks">
                    {connectionTypes(objectMeters, unitForm.noConnection).map((t) => (
                      <label key={t} className="checkline">
                        <input
                          type="checkbox"
                          checked={!unitForm.noConnection.includes(t)}
                          onChange={(e) => setUnitForm(setConnected(unitForm, t, e.target.checked))}
                        />
                        {METER_TYPE_LABELS[t]}
                      </label>
                    ))}
                  </div>
                  <small className="muted">Hat eine Einheit keinen Anschluss, etwa eine Garage ohne Wasser, das Häkchen entfernen. Dann fehlt ihr kein Zähler, und Verbrauchskosten dieser Art betreffen sie nicht. Die Angabe gilt für alle noch offenen Jahre.</small>
                </fieldset>
              </details>
            )}
          </div>
        </Drawer>
      )}

      {wizardFor && (
        <TenantChangeDrawer
          // Ein anderes Mietverhältnis im offenen Fenster ist ein neues Formular (Durchsicht S3)
          key={wizardFor.id}
          tenancy={wizardFor}
          unit={units.find((u) => u.id === wizardFor.unitId)}
          plants={plants}
          onClose={() => setWizardFor(null)}
          onDone={async () => {
            setWizardFor(null)
            // Gespeichert ist der Wechsel; scheitert nur das Neuladen, sagt die Seite es, statt ihn noch einmal anzubieten (#150).
            try {
              await reload()
              setStaleAfterChange(false)
            } catch {
              setStaleAfterChange(true)
            }
          }}
        />
      )}
    </>
  )
}

// ---------- Mieterwechsel im Seitenfenster ----------
// Auszugsdatum, Zwischenablesung der Zähler und neuer Mieter (oder Leerstand) in einem Seitenfenster (#346 Schritt 7,
// UI-Durchsicht N16). Gespeichert wird erst mit „Speichern“, in einer Anfrage, die der Server ganz oder gar nicht
// ausführt (#150). Abbrechen ändert nichts; scheitert das Speichern, auch nicht. Die Regeln stehen in tenantChange.ts:
// `tenantChangeProblems` meldet alles auf einmal am Feld, `buildTenantChange` baut denselben Rumpf wie vorher.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function TenantChangeDrawer({ tenancy, unit, plants, onClose, onDone }: {
  tenancy: Tenancy
  unit: Unit | undefined
  plants: HeatingPlant[]
  onClose: () => void
  // Nach dem Speichern: Die Seite schließt das Fenster und lädt neu.
  onDone: () => Promise<void>
}) {
  const [meters, setMeters] = useState<Meter[]>([])
  const [endDate, setEndDate] = useState('')
  const [meterValues, setMeterValues] = useState<Record<string, string>>({})
  const [vacancy, setVacancy] = useState(false)
  const [newTenant, setNewTenant] = useState<NewTenantForm>(EMPTY_NEW_TENANT)
  // Der Einzug folgt dem Auszug (Tag danach), bis er selbst geändert wird.
  const [startTouched, setStartTouched] = useState(false)
  // Getrennte Heizkostenabrechnung an der Wohnung (Durchsicht von #231): der Nachmieter bekommt seine Heizvorauszahlung.
  const askHeating = unit ? separateHeatingFor(unit, plants) : false
  // Eigene Heizkostenabrechnung an der Wohnung (Heizung PR 10, Entwurf 3.5): Ablesedatum je Zähler und, wenn
  // ein Stand eines Wärme- oder Warmwasserzählers fehlt, die Antwort warum.
  const selfHeating = unit ? plants.some((p) => p.method === 'self' && p.endsOn === null && servesUnit(p, unit)) : false
  const [meterDates, setMeterDates] = useState<Record<string, string>>({})
  const [gap, setGap] = useState<{ status: InterimGapStatus | ''; reason: string }>({ status: '', reason: '' })
  const errors = useFormError<TenantChangeField>()
  const [busy, setBusy] = useState(false)

  // Zähler der Wohnung + Hauptzähler (Dokumentation) laden, aus dem Objekt der Wohnung (#92)
  const { property } = useProperty()
  const propertyId = property?.id
  useEffect(() => {
    void api<Meter[]>(withProperty('/api/meters', propertyId))
      // Die Zähler einer Heizanlage (Speicher, Gesamtwärme) gehören nicht zur Zwischenablesung (Durchsicht von #239, M8).
      .then((all) => setMeters(all.filter((m) => (m.unitId === tenancy.unitId || m.unitId === null) && !m.heatingPlantId)))
      .catch(() => setMeters([]))
  }, [tenancy.unitId, propertyId])

  function changeEnd(value: string) {
    setEndDate(value)
    if (startTouched) return
    setNewTenant((n) => ({ ...n, start: ISO_DAY.test(value) ? defaultStart(value) : '' }))
    // Der Einzug ist damit gesetzt; eine Meldung „Einzug fehlt“ von vorher gilt nicht mehr (Probe im Browser).
    if (ISO_DAY.test(value)) errors.clearField('start')
  }

  const unitMeters = meters.filter((m) => m.unitId !== null)
  const heatMeters = selfHeating ? unitMeters.filter((m) => m.type === 'waerme' || m.type === 'warmwasser') : []
  const heatMissing = heatMeters.some((m) => parseMeterValue(meterValues[m.id] ?? '') === null)
  const readCount = meters.filter((m) => parseMeterValue(meterValues[m.id] ?? '') !== null).length

  async function commit() {
    if (busy) return
    const heatMeterIds = selfHeating ? meters.filter((m) => m.unitId === tenancy.unitId && (m.type === 'waerme' || m.type === 'warmwasser')).map((m) => m.id) : []
    const input = { tenancy, endDate, meters, meterValues, vacancy, newTenant, askHeating, meterDates, heatMeterIds, interimGap: gap }
    const problems = tenantChangeProblems(input)
    if (problems.length > 0) {
      errors.report(problems)
      return
    }
    const change = buildTenantChange(input)
    if ('error' in change) {
      errors.show(change.error)
      return
    }
    errors.clear()
    setBusy(true)
    try {
      await api(withProperty(`/api/tenancies/${tenancy.id}/change`, propertyId), { method: 'POST', body: JSON.stringify(change.body) })
    } catch (e) {
      // Gespeichert ist dann nichts; die Meldung bleibt im Seitenfenster stehen (#146).
      errors.show(errorText(e))
      setBusy(false)
      return
    }
    // Gespeichert ist der Wechsel jetzt; Schließen und Neuladen übernimmt die Seite, auch wenn das Neuladen scheitert.
    await onDone()
  }

  const endText = ISO_DAY.test(endDate) ? fmtDate(endDate) : 'Auszugstag'
  return (
    <Drawer
      open
      title={`Mieterwechsel: ${tenancy.tenantName} (${unit?.name ?? '—'})`}
      subtitle="Auszug, Zwischenablesung und neuer Mieter; gespeichert wird alles auf einmal."
      width={560}
      onClose={onClose}
      onSubmit={() => void commit()}
      value={{ endDate, meterValues, meterDates, vacancy, newTenant, gap }}
      busy={busy}
      errors={errors}
      actions={<button className="btn" disabled={busy} onClick={() => void commit()}>{busy && <span className="spinner" />}Speichern</button>}
    >
      <section className="stack">
        <h3>1. Auszug</h3>
        <Field label="Auszugsdatum (letzter Miettag)" required width="m" {...errors.field('end')}>
          <input type="date" value={endDate} onChange={(e) => changeEnd(e.target.value)} />
        </Field>
      </section>

      <section className="stack">
        <h3>2. Zwischenablesung der Zähler</h3>
        {meters.length === 0 ? (
          <p className="muted">Keine Zähler erfasst — nichts abzulesen. (Wasser nach Personen braucht keine Ablesung.)</p>
        ) : (
          <>
            <p className="muted">
              Stände zum {endText} erfassen — dann wird der Verbrauch nach den Ständen statt
              tagesanteilig aufgeteilt.{heatMeters.length > 0 && ' Bei der Heizkostenabrechnung trägt jeder Mieter seinen abgelesenen Verbrauch; die Grundkosten der Heizung teilen sich nach Gradtagen, die des Warmwassers nach Tagen.'}
              {' '}{unitMeters.length === 0 && 'Der Hauptzähler dient nur der Dokumentation.'}
              {' '}Leere Felder werden übersprungen.
            </p>
            <div className="field-grid">
              {meters.map((m) => (
                <Field key={m.id} label={`${m.name} (${m.unitId === null ? 'Hauptzähler' : METER_TYPE_LABELS[m.type] ?? m.type}${m.unit ? `, ${m.unit}` : ''})`} {...errors.field(`meter:${m.id}`)}>
                  <input value={meterValues[m.id] ?? ''} inputMode="decimal" placeholder="Stand" onChange={(e) => setMeterValues({ ...meterValues, [m.id]: e.target.value })} />
                </Field>
              ))}
              {heatMeters.map((m) => (
                <Field key={`datum-${m.id}`} label={`Ablesedatum ${m.name}`} hint="Leer heißt am Auszugstag." {...errors.field(`meterDate:${m.id}`)}>
                  <input type="date" value={meterDates[m.id] ?? ''} onChange={(e) => setMeterDates({ ...meterDates, [m.id]: e.target.value })} />
                </Field>
              ))}
            </div>
            {heatMeters.length > 0 && (
              <>
                <p className="muted">Bei den Wärme- und Warmwasserzählern tragen Sie das Ablesedatum ein, wenn nicht am Auszugstag abgelesen wurde; gerechnet wird mit dem Stand, wie er abgelesen ist. {INTERIM_FEE_HINT}</p>
                {heatMissing && (
                  <div className="field-grid">
                    <Field label="Warum gibt es keine Zwischenablesung?" required {...errors.field('gapStatus')}>
                      <select value={gap.status} onChange={(e) => setGap({ ...gap, status: INTERIM_GAP_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '' })}>
                        <option value="">— bitte wählen —</option>
                        {INTERIM_GAP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                    {gap.status === 'impossible' && (
                      <Field label="Grund (steht in der Abrechnung)" required {...errors.field('gapReason')}>
                        <input value={gap.reason} onChange={(e) => setGap({ ...gap, reason: e.target.value })} />
                      </Field>
                    )}
                  </div>
                )}
                {heatMissing && gap.status !== '' && <p className="muted">{gapConsequence(gap.status === 'impossible' ? 'impossible' : 'missed')}</p>}
              </>
            )}
          </>
        )}
      </section>

      <section className="stack">
        <h3>3. Neuer Mieter</h3>
        <label className="checkline">
          <input type="checkbox" checked={vacancy} onChange={(e) => setVacancy(e.target.checked)} />
          <span>Wohnung bleibt vorerst leer (Leerstand)</span>
        </label>
        {!vacancy && (
          <div className="field-grid">
            <Field label="Mieter" required {...errors.field('name')}>
              <input value={newTenant.name} onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })} placeholder="z. B. Familie Müller" />
            </Field>
            <Field label="Einzug" required hint="Vorgabe: der Tag nach dem Auszug." {...errors.field('start')}>
              <input type="date" value={newTenant.start} onChange={(e) => { setStartTouched(true); setNewTenant({ ...newTenant, start: e.target.value }) }} />
            </Field>
            <Field label="Personen" required width="s" {...errors.field('persons')}>
              <input value={newTenant.persons} inputMode="numeric" onChange={(e) => setNewTenant({ ...newTenant, persons: e.target.value })} />
            </Field>
            <Field label="Kaltmiete €/Monat" width="s" {...errors.field('baseRent')}>
              <input value={newTenant.baseRent} inputMode="decimal" placeholder="z. B. 800,00" onChange={(e) => setNewTenant({ ...newTenant, baseRent: e.target.value })} />
            </Field>
            <Field label={askHeating ? 'Übrige Vorauszahlung €/Monat' : 'Vorauszahlung €/Monat'} width="s" {...errors.field('prepayment')}>
              <input value={newTenant.prepayment} inputMode="decimal" placeholder="z. B. 150,00" onChange={(e) => setNewTenant({ ...newTenant, prepayment: e.target.value })} />
            </Field>
            {askHeating && (
              <Field label="Heizvorauszahlung €/Monat" required width="s" {...errors.field('heatingPrepayment')}>
                <input value={newTenant.heatingPrepayment ?? ''} inputMode="decimal" placeholder="z. B. 120,00" onChange={(e) => setNewTenant({ ...newTenant, heatingPrepayment: e.target.value })} />
              </Field>
            )}
          </div>
        )}
      </section>

      <div className="notice">
        Beim Speichern passiert: Mietverhältnis „{tenancy.tenantName}“ endet am {ISO_DAY.test(endDate) ? fmtDate(endDate) : '—'}
        {readCount > 0 && <> · {readCount} Zwischenablesung{readCount > 1 ? 'en werden' : ' wird'} gespeichert</>}
        {vacancy
          ? ' · die Wohnung bleibt ohne Mieter (Leerstandskosten trägt der Vermieter).'
          : newTenant.name.trim() ? <> · neues Mietverhältnis „{newTenant.name}“ ab {newTenant.start ? fmtDate(newTenant.start) : '—'}.</> : ' · neues Mietverhältnis wird angelegt.'}
        {!vacancy && successorHeatingNote(tenancy) && <> {successorHeatingNote(tenancy)}</>}
      </div>
    </Drawer>
  )
}
