import { useEffect, useState } from 'react'
import type { CostModel, DepositStatus, HeatingPlant, Meter, MeterType, Settings, Tenancy, Unit, UnitDependents, UnitUsage } from '../types'
import { DEPOSIT_STATUS_LABELS, METER_TYPE_LABELS, UNIT_USAGE_LABELS, usageOf } from '../types'
import { EMPTY_UNIT_FORM, buildUnitBody, connectionSummary, connectionTypes, setConnected, unitDeleteMessage, unitToForm, type UnitForm } from '../unitForm'
import { api, errorText, fmtDate, fmtEuro, parseEuro } from '../api'
import { scheduleOf, separateHeatingFor, separateHeatingPlant } from '../heatingSettlementView'
import Drawer from '../components/Drawer'
import PropertyCard from '../components/PropertyCard'
import { COST_MODEL_LABELS, buildPersonHistory, costModelBadge, costModelBody, defaultTenancyUnitId, overlapQuestion, prepaymentColumn, showsFlatRates } from '../tenancyModel'
import { useOpenForm, useProperty, withProperty } from '../property'
import { buildTenantChange, defaultStart, EMPTY_NEW_TENANT, endProblem, meterProblem, parseMeterValue, type NewTenantForm } from '../tenantChange'
import PeriodCard from '../components/PeriodCard'
import PageHeader from '../components/PageHeader'
import { emptyUnitsText } from '../propertyView'
import Term from '../components/Term'
import { useToast, useConfirm } from '../components/feedback'
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
  heatingModel: CostModel
  // Die Marke des Stands, aus dem das Formular gefüllt wurde (Laienprobe B1, shared/tenancyStamp.ts).
  stamp?: string
}

const EMPTY_UNIT: UnitForm = EMPTY_UNIT_FORM

// Leere erweiterte Mieter-Felder — bei „neu“ und (mit Werten) beim Bearbeiten verwendet
const EMPTY_TENANCY_EXTRA = {
  email: '', phone: '', correspondenceAddress: '', iban: '', contractDate: '', deposit: '', depositStatus: 'offen' as DepositStatus, notes: '',
  costModel: 'settlement' as CostModel, heatingModel: 'settlement' as CostModel,
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
      from: p.from,
      amount: (p.monthlyCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
    })),
    prepayments: t.prepayments.map((p) => ({
      from: p.from,
      amount: (p.monthlyCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
    })),
    email: t.email ?? '',
    phone: t.phone ?? '',
    correspondenceAddress: t.correspondenceAddress ?? '',
    iban: t.iban ?? '',
    contractDate: t.contractDate ?? '',
    deposit: t.depositCents != null ? (t.depositCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '',
    depositStatus: t.depositStatus ?? 'offen',
    notes: t.notes ?? '',
    costModel: t.costModel ?? 'settlement',
    heatingModel: t.heatingModel ?? 'settlement',
    flatRates: (t.flatRates ?? []).map((p) => ({
      from: p.from,
      amount: (p.monthlyCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
    })),
    heatingPrepayments: (t.heatingPrepayments ?? []).map((p) => ({
      from: p.from,
      amount: (p.monthlyCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
    })),
    stamp: tenancyStamp(t),
  }
}

export default function Stammdaten({ units, tenancies, settings, reload, focus, onFocusDone }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const { property } = useProperty()
  const propertyId = property?.id
  const [unitForm, setUnitForm] = useState<UnitForm | null>(null)
  const [tenForm, setTenForm] = useState<TenancyForm | null>(null)
  const [wizardFor, setWizardFor] = useState<Tenancy | null>(null)
  const [error, setError] = useState('')
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
  useFocusTarget(focus, 'unit', units, (u) => u.id, (u) => { setError(''); setUnitForm(unitToForm(u)) }, onFocusDone)
  useFocusTarget(focus, 'tenancy', tenancies, (t) => t.id, (t) => { setError(''); setTenForm(tenancyToForm(t)) }, onFocusDone)

  async function saveUnit() {
    if (!unitForm) return
    const built = buildUnitBody(unitForm)
    if ('error' in built) {
      setError(built.error)
      return
    }
    setError('')
    const body = JSON.stringify(built.body)
    const editing = !!unitForm.id
    // Lehnt der Server ab (#146), bleibt der Dialog offen und zeigt seinen Satz.
    try {
      if (editing) await api(`/api/units/${unitForm.id}`, { method: 'PUT', body })
      else await api(withProperty('/api/units', propertyId), { method: 'POST', body })
    } catch (e) {
      setError(errorText(e))
      return
    }
    setUnitForm(null)
    await reload()
    toast(editing ? `„${unitForm.name.trim()}“ übernommen.` : `Wohnung „${unitForm.name.trim()}“ angelegt.`)
  }

  async function deleteUnit(u: Unit) {
    // Was mitgelöscht wird, mit Anzahl (#142); ohne Antwort die vollständige Liste ohne Zahlen.
    const deps = await api<UnitDependents>(`/api/units/${u.id}/dependents`).catch(() => null)
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
      setError(errorText(e))
      return
    }
    setError('')
    await reload()
    toast(`Wohnung „${u.name}“ gelöscht.`)
  }

  async function saveTenancy() {
    if (!tenForm) return
    if (!tenForm.tenantName.trim() || !tenForm.unitId || !tenForm.start) {
      setError('Bitte Mieter, Wohnung und Einzugsdatum prüfen.')
      return
    }
    const persons = buildPersonHistory(tenForm.personHistory, tenForm.start)
    if ('error' in persons) {
      setError(persons.error)
      return
    }
    const { personHistory } = persons
    const baseRents: { from: string; monthlyCents: number }[] = []
    for (const row of tenForm.baseRents) {
      if (!row.from && !row.amount.trim()) continue // leere Zeile überspringen
      const cents = parseEuro(row.amount)
      const from = row.from || tenForm.start.slice(0, 7)
      if (cents === null || !/^\d{4}-\d{2}$/.test(from)) {
        setError('Bitte Kaltmiete-Staffel prüfen (Monat und Betrag).')
        return
      }
      baseRents.push({ from, monthlyCents: cents })
    }
    baseRents.sort((a, b) => a.from.localeCompare(b.from))
    const prepayments: { from: string; monthlyCents: number }[] = []
    for (const row of tenForm.prepayments) {
      if (!row.from && !row.amount.trim()) continue // leere Zeile überspringen
      const cents = parseEuro(row.amount)
      const from = row.from || tenForm.start.slice(0, 7)
      if (cents === null || !/^\d{4}-\d{2}$/.test(from)) {
        setError('Bitte Vorauszahlungs-Staffel prüfen (Monat und Betrag).')
        return
      }
      prepayments.push({ from, monthlyCents: cents })
    }
    const flatRates: { from: string; monthlyCents: number }[] = []
    if (showsFlatRates(tenForm.costModel, tenForm.heatingModel)) {
      for (const row of tenForm.flatRates) {
        if (!row.from && !row.amount.trim()) continue
        const cents = parseEuro(row.amount)
        const from = row.from || tenForm.start.slice(0, 7)
        if (cents === null || !/^\d{4}-\d{2}$/.test(from)) {
          setError('Bitte die Staffel der Pauschale prüfen (Monat und Betrag).')
          return
        }
        flatRates.push({ from, monthlyCents: cents })
      }
    }
    // Heizung PR 5: die Heizstaffel neben der übrigen Vorauszahlung (nach dem Aufteilen, Entwurf 3.1).
    const heating = scheduleOf(tenForm.heatingPrepayments, tenForm.start.slice(0, 7))
    if ('error' in heating) {
      setError(heating.error)
      return
    }
    let depositCents: number | null = null
    if (tenForm.deposit.trim()) {
      depositCents = parseEuro(tenForm.deposit)
      if (depositCents === null) {
        setError('Kaution bitte als Betrag angeben (oder leer lassen).')
        return
      }
    }
    if (tenForm.contractDate && !/^\d{4}-\d{2}-\d{2}$/.test(tenForm.contractDate)) {
      setError('Vertragsdatum bitte als gültiges Datum angeben.')
      return
    }
    setError('')
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
      iban: tenForm.iban.trim() || null,
      contractDate: tenForm.contractDate || null,
      depositCents,
      depositStatus: depositCents !== null ? tenForm.depositStatus : null,
      notes: tenForm.notes.trim() || null,
      ...costModelBody(tenForm.costModel, tenForm.heatingModel),
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
      setError(errorText(e))
      return
    }
    const name = tenForm.tenantName.trim()
    setTenForm(null)
    await reload()
    toast(editing ? `„${name}“ übernommen.` : `Mietverhältnis „${name}“ angelegt.`)
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
      setError(errorText(e))
      return
    }
    setError('')
    await reload()
    toast(`Mietverhältnis „${t.tenantName}“ gelöscht.`)
  }

  const participating = units.filter((u) => u.participates)
  // Miteigentumsanteile (#142): bei einer Eigentumswohnung immer, sonst sobald eine Wohnung welche hat.
  const showsMea = property?.kind === 'etw' || units.some((u) => u.mea != null)

  return (
    <>
      <PageHeader title="Stammdaten" subtitle="Objekt, Wohnungen und Mietverhältnisse — die Grundlage jeder Abrechnung." />

      {/* Fehler beim Löschen (#146); die der Formulare stehen in ihrem Dialog. */}
      {error && !unitForm && !tenForm && <div className="error">{error}</div>}

      <PropertyCard />
      <PeriodCard onChanged={afterHeatingOrPeriodChange} />

      <div className="card">
        <h2>Wohnungen</h2>
        {units.length === 0 && <div className="empty">{emptyUnitsText(property?.kind ?? 'mfh')}</div>}
        {units.length > 0 && (
          <Table>
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
                  <td>
                    {u.name}
                    {(u.rooms != null || u.floor || u.notes) && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {[u.floor, u.rooms != null ? `${u.rooms.toLocaleString('de-DE')} Zi.` : null, u.notes].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="num">{u.areaM2.toLocaleString('de-DE')} m²</td>
                  {showsMea && <td className="num">{u.mea != null ? u.mea.toLocaleString('de-DE') : '—'}</td>}
                  <td>
                    {usageOf(u) === 'vermietet' && <span className="badge green">beteiligt</span>}
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
                      <span className="badge gray" style={{ marginLeft: 6 }}>{connectionSummary(u.noConnection ?? [])}</span>
                    )}
                  </td>
                  <td className="actions no-print">
                    <button className="icon-btn" title="Bearbeiten" aria-label="Wohnung bearbeiten" onClick={() => { setError(''); setUnitForm(unitToForm(u)) }}>✎</button>
                    <button className="icon-btn danger" title="Löschen" aria-label="Wohnung löschen" onClick={() => deleteUnit(u)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => { setError(''); setUnitForm({ ...EMPTY_UNIT }) }}>+ Wohnung hinzufügen</button>
        {units.length > 0 && participating.length === 0 && (
          <div className="notice" style={{ marginTop: 14 }}>Keine Wohnung ist an der Kostenverteilung beteiligt — die Abrechnung wäre leer.</div>
        )}
      </div>

      {/* Heizung PR 4: optional, nach den Wohnungen, weil Schritt 4 nach ihnen fragt. */}
      <HeatingCard units={units} focus={focus} onFocusDone={onFocusDone} onChanged={afterHeatingOrPeriodChange} />

      <div className="card">
        <h2>Mietverhältnisse</h2>
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
          <Table className="tenancy-table">
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
                  <td>
                    {t.tenantName}
                    {/* Pauschale oder Inklusivmiete auf einen Blick (#142); die Abrechnung ist der Normalfall. */}
                    {costModelBadge(t.costModel, t.heatingModel) && (
                      <div style={{ marginTop: 2 }}>
                        <span className="badge gray" title="Nebenkostenmodell; ändern unter „Weitere Angaben“">
                          {costModelBadge(t.costModel, t.heatingModel)}
                        </span>
                      </div>
                    )}
                    {(t.email || t.phone) && (
                      <div className="muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
                        {t.email}{t.email && t.phone && ' · '}{t.phone && <span className="nowrap">{t.phone}</span>}
                      </div>
                    )}
                    {t.depositCents != null && (
                      <div style={{ fontSize: 12, marginTop: 2 }}>
                        <span className="muted">Kaution {fmtEuro(t.depositCents)}</span>{' '}
                        <span className={`badge ${t.depositStatus === 'erhalten' ? 'green' : t.depositStatus === 'offen' ? 'gray' : 'gray'}`}>
                          {DEPOSIT_STATUS_LABELS[t.depositStatus ?? 'offen']}
                        </span>
                      </div>
                    )}
                  </td>
                  <td>{units.find((u) => u.id === t.unitId)?.name ?? '—'}</td>
                  <td className="num">
                    {(t.personHistory ?? []).map((p, i) => (
                      <div key={i}>
                        {(t.personHistory?.length ?? 0) > 1 && <><span className="muted nowrap">ab {fmtDate(p.from)}:</span>{' '}</>}
                        <span className="nowrap">{p.persons}</span>
                      </div>
                    ))}
                  </td>
                  <td>
                    {fmtDate(t.start)} – {t.end ? fmtDate(t.end) : 'laufend'}
                  </td>
                  <td className="num">
                    {(t.baseRents?.length ?? 0) === 0 && '—'}
                    {(t.baseRents ?? []).map((p, i) => (
                      <div key={i}>
                        {(t.baseRents?.length ?? 0) > 1 && <><span className="muted nowrap">ab {p.from.slice(5, 7)}/{p.from.slice(0, 4)}:</span>{' '}</>}
                        <span className="nowrap">{fmtEuro(p.monthlyCents)}</span>
                      </div>
                    ))}
                  </td>
                  <td className="num">
                    {prepaymentColumn(t).length === 0 && '—'}
                    {prepaymentColumn(t).map((line, i) => (
                      <div key={i}>
                        {line.label !== null && <><span className="muted nowrap">{line.label}</span>{' '}</>}
                        <span className="nowrap">{line.amount}</span>
                      </div>
                    ))}
                  </td>
                  <td className="actions no-print">
                    {!t.end && (
                      <button className="btn small secondary" title="Geführter Ablauf: Auszug, Zwischenablesung, neuer Mieter" onClick={() => setWizardFor(t)}>
                        Mieterwechsel
                      </button>
                    )}
                    {' '}
                    <span className="nowrap">
                    <button
                      className="icon-btn"
                      title="Bearbeiten"
                      aria-label="Mietverhältnis bearbeiten"
                      onClick={() => {
                        setError('')
                        setTenForm(tenancyToForm(t))
                      }}
                    >
                      ✎
                    </button>
                    <button className="icon-btn danger" title="Löschen" aria-label="Mietverhältnis löschen" onClick={() => deleteTenancy(t)}>🗑</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <button
          className="btn secondary"
          style={{ marginTop: 14 }}
          onClick={() => { setError(''); setTenForm({ unitId: defaultTenancyUnitId(units, tenancies, localToday()), tenantName: '', personHistory: [{ from: '', persons: '2' }], start: '', end: '', baseRents: [{ from: '', amount: '' }], prepayments: [{ from: '', amount: '' }], ...EMPTY_TENANCY_EXTRA }) }}
          disabled={units.length === 0}
        >
          + Mietverhältnis hinzufügen
        </button>
      </div>

      {tenForm && (
        <Drawer
          open
          title={tenForm.id ? 'Mietverhältnis bearbeiten' : 'Neues Mietverhältnis'}
          subtitle={tenForm.id ? tenForm.tenantName : undefined}
          onClose={() => { setError(''); setTenForm(null) }}
          onSubmit={saveTenancy}
          width={480}
          footer={
            <>
              <span className="drawer-hint">Strg+S speichert · Esc schließt</span>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => { setError(''); setTenForm(null) }}>Abbrechen</button>
              <button className="btn" onClick={saveTenancy}>{tenForm.id ? 'Übernehmen' : 'Anlegen'}</button>
            </>
          }
        >
          {error && <div className="error">{error}</div>}
          <div className="row">
            <label className="field grow">
              Mieter
              <input value={tenForm.tenantName} onChange={(e) => setTenForm({ ...tenForm, tenantName: e.target.value })} placeholder="z. B. Familie Müller" />
            </label>
            <label className="field grow">
              Wohnung
              <select value={tenForm.unitId} onChange={(e) => setTenForm({ ...tenForm, unitId: e.target.value })}>
                <option value="">— wählen —</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
            <label className="field grow">
              Einzug
              <input type="date" value={tenForm.start} onChange={(e) => setTenForm({ ...tenForm, start: e.target.value })} />
            </label>
            <label className="field grow">
              Auszug (leer = laufend)
              <input type="date" value={tenForm.end} onChange={(e) => setTenForm({ ...tenForm, end: e.target.value })} />
            </label>

            <div className="field-group">
              <div className="field-group-label">Personenzahl — Staffel</div>
              {tenForm.personHistory.map((p, i) => (
                <div className="staffel-row" key={i}>
                  <label className="field">
                    gültig ab
                    <input type="date" value={p.from} onChange={(e) => setTenForm({ ...tenForm, personHistory: tenForm.personHistory.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })} />
                  </label>
                  <label className="field">
                    Personen
                    <input value={p.persons} inputMode="numeric" onChange={(e) => setTenForm({ ...tenForm, personHistory: tenForm.personHistory.map((x, k) => (k === i ? { ...x, persons: e.target.value } : x)) })} />
                  </label>
                  {tenForm.personHistory.length > 1
                    ? <button className="icon-btn danger" title="Zeile entfernen" aria-label="Zeile entfernen" onClick={() => setTenForm({ ...tenForm, personHistory: tenForm.personHistory.filter((_, k) => k !== i) })}>🗑</button>
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
                  <label className="field">
                    gültig ab
                    <input type="month" value={p.from} placeholder="Einzugsmonat" onChange={(e) => setTenForm({ ...tenForm, baseRents: tenForm.baseRents.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })} />
                  </label>
                  <label className="field">
                    Betrag €/Monat
                    <input value={p.amount} placeholder="z. B. 800,00" onChange={(e) => setTenForm({ ...tenForm, baseRents: tenForm.baseRents.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)) })} />
                  </label>
                  {tenForm.baseRents.length > 1
                    ? <button className="icon-btn danger" title="Zeile entfernen" aria-label="Zeile entfernen" onClick={() => setTenForm({ ...tenForm, baseRents: tenForm.baseRents.filter((_, k) => k !== i) })}>🗑</button>
                    : <span />}
                </div>
              ))}
              <button className="btn small secondary field-add" onClick={() => setTenForm({ ...tenForm, baseRents: [...tenForm.baseRents, { from: '', amount: '' }] })}>+ Mieterhöhung ab Monat …</button>
            </div>

            <div className="field-group">
              <div className="field-group-label">NK-<Term id="prepayment">Vorauszahlung</Term> je Monat — Staffel</div>
              {tenForm.prepayments.map((p, i) => (
                <div className="staffel-row" key={i}>
                  <label className="field">
                    gültig ab
                    <input type="month" value={p.from} placeholder="Einzugsmonat" onChange={(e) => setTenForm({ ...tenForm, prepayments: tenForm.prepayments.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })} />
                  </label>
                  <label className="field">
                    Betrag €/Monat
                    <input value={p.amount} placeholder="z. B. 150,00" onChange={(e) => setTenForm({ ...tenForm, prepayments: tenForm.prepayments.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)) })} />
                  </label>
                  {tenForm.prepayments.length > 1
                    ? <button className="icon-btn danger" title="Zeile entfernen" aria-label="Zeile entfernen" onClick={() => setTenForm({ ...tenForm, prepayments: tenForm.prepayments.filter((_, k) => k !== i) })}>🗑</button>
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
                      <label className="field">gültig ab
                        <input type="month" value={p.from} placeholder="Einzugsmonat" onChange={(e) => setTenForm({ ...tenForm, heatingPrepayments: rows.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })} />
                      </label>
                      <label className="field">Betrag €/Monat
                        <input value={p.amount} placeholder="z. B. 120,00" onChange={(e) => setTenForm({ ...tenForm, heatingPrepayments: rows.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)) })} />
                      </label>
                      <span />
                    </div>
                  ))}
                  <button className="btn small secondary field-add" onClick={() => setTenForm({ ...tenForm, heatingPrepayments: [...rows, { from: '', amount: '' }] })}>+ Änderung ab Monat …</button>
                </div>
              )
            })()}

            <details className="extra-details" style={{ width: '100%' }}>
              <summary>Weitere Angaben — Nebenkosten-Modell, Kontakt, Kaution, Vertrag (optional)</summary>
              <div className="row" style={{ marginTop: 10 }}>
                <label className="field grow" title="Pauschale nach § 556 Abs. 2 BGB oder Inklusivmiete: dann gibt es keine Nebenkostenabrechnung">
                  <span>Nebenkosten (<Term id="flatRate">Pauschale</Term>, <Term id="inclusiveRent">Inklusivmiete</Term>)</span>
                  <select value={tenForm.costModel} onChange={(e) => setTenForm({ ...tenForm, costModel: e.target.value as CostModel })}>
                    {(Object.keys(COST_MODEL_LABELS) as CostModel[]).map((m) => <option key={m} value={m}>{COST_MODEL_LABELS[m]}</option>)}
                  </select>
                </label>
                <label className="field grow" title="Für die Kostenart Heizung und Warmwasser; eine Pauschale oder Warmmiete ist nur im selbstbewohnten Zweifamilienhaus zulässig (§ 2 HeizkostenV)">
                  <span>Heizung und Warmwasser (<Term id="heatingCostOrdinance">HeizkostenV</Term>)</span>
                  <select value={tenForm.heatingModel} onChange={(e) => setTenForm({ ...tenForm, heatingModel: e.target.value as CostModel })}>
                    {(Object.keys(COST_MODEL_LABELS) as CostModel[]).map((m) => <option key={m} value={m}>{COST_MODEL_LABELS[m]}</option>)}
                  </select>
                </label>
              </div>
              {showsFlatRates(tenForm.costModel, tenForm.heatingModel) && (
                <div className="field-group" style={{ marginTop: 10 }}>
                  <div className="field-group-label">Pauschale je Monat — Staffel</div>
                  <div className="muted" style={{ marginBottom: 6 }}>
                    Die Pauschale steht im Mietkonto, wird aber nie abgerechnet. Eine Vorauszahlung für die
                    abgerechnete Art gehört in die Staffel „NK-Vorauszahlung“ oben.
                  </div>
                  {(tenForm.flatRates.length > 0 ? tenForm.flatRates : [{ from: '', amount: '' }]).map((p, i, alle) => (
                    <div className="staffel-row" key={i}>
                      <label className="field">
                        gültig ab
                        <input type="month" value={p.from} placeholder="Einzugsmonat" onChange={(e) => setTenForm({ ...tenForm, flatRates: alle.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })} />
                      </label>
                      <label className="field">
                        Betrag €/Monat
                        <input value={p.amount} placeholder="z. B. 90,00" onChange={(e) => setTenForm({ ...tenForm, flatRates: alle.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)) })} />
                      </label>
                      {alle.length > 1
                        ? <button className="icon-btn danger" title="Zeile entfernen" aria-label="Zeile entfernen" onClick={() => setTenForm({ ...tenForm, flatRates: alle.filter((_, k) => k !== i) })}>🗑</button>
                        : <span />}
                    </div>
                  ))}
                  <button className="btn small secondary field-add" onClick={() => setTenForm({ ...tenForm, flatRates: [...(tenForm.flatRates.length > 0 ? tenForm.flatRates : [{ from: '', amount: '' }]), { from: '', amount: '' }] })}>+ Änderung ab Monat …</button>
                </div>
              )}
              <div className="row" style={{ marginTop: 10 }}>
                <label className="field grow">
                  E-Mail
                  <input type="email" value={tenForm.email} onChange={(e) => setTenForm({ ...tenForm, email: e.target.value })} placeholder="mieter@example.de" />
                </label>
                <label className="field grow">
                  Telefon
                  <input value={tenForm.phone} onChange={(e) => setTenForm({ ...tenForm, phone: e.target.value })} placeholder="0123 456789" />
                </label>
                <label className="field grow">
                  Abweichende Anschrift (Schriftverkehr)
                  <input value={tenForm.correspondenceAddress} onChange={(e) => setTenForm({ ...tenForm, correspondenceAddress: e.target.value })} placeholder="z. B. neue Adresse nach Auszug" />
                </label>
                <label className="field grow">
                  Mieter-IBAN (für Lastschrift / Guthaben-Rückzahlung)
                  <input value={tenForm.iban} onChange={(e) => setTenForm({ ...tenForm, iban: e.target.value })} placeholder="DE.." />
                </label>
                <label className="field grow">
                  Vertragsdatum
                  <input type="date" value={tenForm.contractDate} onChange={(e) => setTenForm({ ...tenForm, contractDate: e.target.value })} />
                </label>
                <label className="field grow">
                  Kaution €
                  <input value={tenForm.deposit} placeholder="z. B. 2.400,00" onChange={(e) => setTenForm({ ...tenForm, deposit: e.target.value })} />
                </label>
                <label className="field grow">
                  Kautionsstatus
                  <select value={tenForm.depositStatus} disabled={!tenForm.deposit.trim()} onChange={(e) => setTenForm({ ...tenForm, depositStatus: e.target.value as DepositStatus })}>
                    {(Object.keys(DEPOSIT_STATUS_LABELS) as DepositStatus[]).map((s) => (
                      <option key={s} value={s}>{DEPOSIT_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </label>
                <label className="field grow">
                  Notiz
                  <input value={tenForm.notes} onChange={(e) => setTenForm({ ...tenForm, notes: e.target.value })} placeholder="freie Notiz zum Mietverhältnis" />
                </label>
              </div>
            </details>
          </div>
        </Drawer>
      )}

      {unitForm && (
        <Drawer
          open
          title={unitForm.id ? 'Wohnung bearbeiten' : 'Neue Wohnung'}
          subtitle={unitForm.id ? unitForm.name : undefined}
          onClose={() => { setError(''); setUnitForm(null) }}
          onSubmit={saveUnit}
          footer={
            <>
              <span className="drawer-hint">Strg+S speichert · Esc schließt</span>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => { setError(''); setUnitForm(null) }}>Abbrechen</button>
              <button className="btn" onClick={saveUnit}>{unitForm.id ? 'Übernehmen' : 'Anlegen'}</button>
            </>
          }
        >
          {error && <div className="error">{error}</div>}
          <div className="row">
            <label className="field grow">
              Name
              <input value={unitForm.name} onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })} placeholder="z. B. OG links" />
            </label>
            <label className="field grow">
              Wohnfläche (m²)
              <input value={unitForm.areaM2} onChange={(e) => setUnitForm({ ...unitForm, areaM2: e.target.value })} placeholder="z. B. 85,5" />
              <small className="muted">0 für Garage, Stellplatz oder Lager; sie zählt dann beim Flächenschlüssel nicht mit.</small>
            </label>
            <label className="field grow">
              Zimmer
              <input value={unitForm.rooms} onChange={(e) => setUnitForm({ ...unitForm, rooms: e.target.value })} placeholder="z. B. 3" />
            </label>
            {(property?.kind === 'etw' || unitForm.mea.trim() !== '') && (
              <label className="field grow" title="Aus der Teilungserklärung oder der Hausgeldabrechnung; für den Umlageschlüssel „laut Gemeinschaftsabrechnung“">
                <Term id="mea">Miteigentumsanteile</Term>
                <input value={unitForm.mea} onChange={(e) => setUnitForm({ ...unitForm, mea: e.target.value })} placeholder="z. B. 124" inputMode="decimal" />
              </label>
            )}
            <label className="field grow">
              Etage
              <input value={unitForm.floor} onChange={(e) => setUnitForm({ ...unitForm, floor: e.target.value })} placeholder="z. B. 1. OG" />
            </label>
            <label className="field grow">
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
              <label className="field grow" title="Nur für den Personenschlüssel — ohne Angabe bleibt die eigene Wohnung dort unberücksichtigt">
                Personen im eigenen Haushalt
                <input value={unitForm.selfPersons} onChange={(e) => setUnitForm({ ...unitForm, selfPersons: e.target.value })} placeholder="z. B. 2" />
              </label>
            )}
            <label className="field grow">
              Notiz (optional)
              <input value={unitForm.notes} onChange={(e) => setUnitForm({ ...unitForm, notes: e.target.value })} placeholder="z. B. Balkon, Stellplatz Nr. 2" />
            </label>
            {/* Anschlüsse (#117, #142): positiv gefragt, gespeichert wird nur die Ausnahme. Nur
                Zählerarten des Objekts und schon gesetzte Ausnahmen; sonst gibt es nichts zu fragen. */}
            {connectionTypes(objectMeters, unitForm.noConnection).length > 0 && (
              <details className="extra-details" style={{ width: '100%' }}>
                <summary>
                  Weitere Angaben — Anschlüsse{connectionSummary(unitForm.noConnection) ? `: ${connectionSummary(unitForm.noConnection)}` : ''}
                </summary>
                <fieldset className="field grow no-connection" style={{ marginTop: 10 }}>
                  <legend className="field-legend"><Term id="noConnection">Anschlüsse</Term> dieser Einheit:</legend>
                  <div className="row" style={{ gap: 10 }}>
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
        <TenantChangeWizard
          tenancy={wizardFor}
          unit={units.find((u) => u.id === wizardFor.unitId)}
          plants={plants}
          onClose={() => setWizardFor(null)}
          onDone={async () => { await reload(); setWizardFor(null) }}
        />
      )}
    </>
  )
}

// ---------- Mieterwechsel-Assistent ----------
// Geführter Ablauf: Auszugsdatum → Zwischenablesung der Zähler → neuer Mieter (oder Leerstand).
// Alle Schritte werden erst beim Abschluss gespeichert, und zwar in einer Anfrage, die der Server
// ganz oder gar nicht ausführt (#150). Abbrechen ändert nichts; scheitert das Speichern, auch nicht.
// Die Regeln stehen in tenantChange.ts.

function TenantChangeWizard({ tenancy, unit, plants, onClose, onDone }: {
  tenancy: Tenancy
  unit: Unit | undefined
  plants: HeatingPlant[]
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [step, setStep] = useState(1)
  const [meters, setMeters] = useState<Meter[]>([])
  const [endDate, setEndDate] = useState('')
  const [meterValues, setMeterValues] = useState<Record<string, string>>({})
  const [vacancy, setVacancy] = useState(false)
  const [newTenant, setNewTenant] = useState<NewTenantForm>(EMPTY_NEW_TENANT)
  // Getrennte Heizkostenabrechnung an der Wohnung (Durchsicht von #231): der Nachmieter bekommt seine Heizvorauszahlung.
  const askHeating = unit ? separateHeatingFor(unit, plants) : false
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  // Der Mieterwechsel hängt an einem Mietverhältnis dieses Objekts (#145).
  useOpenForm(true)

  // Zähler der Wohnung + Hauptzähler (Dokumentation) laden, aus dem Objekt der Wohnung (#92)
  const { property } = useProperty()
  const propertyId = property?.id
  useEffect(() => {
    void api<Meter[]>(withProperty('/api/meters', propertyId))
      .then((all) => setMeters(all.filter((m) => m.unitId === tenancy.unitId || m.unitId === null)))
      .catch(() => setMeters([]))
  }, [tenancy.unitId, propertyId])

  function goToStep2() {
    const problem = endProblem(endDate, tenancy)
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    setNewTenant((n) => ({ ...n, start: n.start || defaultStart(endDate) }))
    setStep(2)
  }

  function goToStep3() {
    const problem = meterProblem(meters, meterValues)
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    setStep(3)
  }

  async function commit() {
    const change = buildTenantChange({ tenancy, endDate, meters, meterValues, vacancy, newTenant, askHeating })
    if ('error' in change) {
      setError(change.error)
      return
    }
    setError('')
    setBusy(true)
    try {
      await api(withProperty(`/api/tenancies/${tenancy.id}/change`, propertyId), { method: 'POST', body: JSON.stringify(change.body) })
    } catch (e) {
      // Gespeichert ist dann nichts; die Meldung bleibt im Assistenten stehen (#146).
      setError(errorText(e))
      setBusy(false)
      return
    }
    // Gespeichert ist der Wechsel jetzt. Scheitert nur das Neuladen der Ansicht, darf der Fehler
    // nicht verloren gehen, und der Wechsel darf nicht noch einmal angeboten werden.
    try {
      await onDone()
    } catch {
      setSaved(true)
      setBusy(false)
    }
  }

  const unitMeters = meters.filter((m) => m.unitId !== null)
  const readCount = meters.filter((m) => parseMeterValue(meterValues[m.id] ?? '') !== null).length

  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <h2>Mieterwechsel: {tenancy.tenantName} ({unit?.name ?? '—'})</h2>
      {error && <div className="error">{error}</div>}
      {saved && (
        <div className="notice">
          Der Mieterwechsel ist gespeichert; die Ansicht ließ sich nicht neu laden, bitte Seite neu laden.{' '}
          <button className="btn ghost" onClick={onClose}>Schließen</button>
        </div>
      )}

      {!saved && <>
      <div className="wizard-step">
        <strong>1. Auszug</strong>
        <div className="row" style={{ marginTop: 8 }}>
          <label className="field">
            Auszugsdatum (letzter Miettag)
            <input type="date" value={endDate} disabled={step > 1} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          {step === 1 && <button className="btn" onClick={goToStep2}>Weiter</button>}
        </div>
      </div>

      {step >= 2 && (
        <div className="wizard-step">
          <strong>2. Zwischenablesung der Zähler</strong>
          {meters.length === 0 ? (
            <p className="muted">
              Keine Zähler erfasst — nichts abzulesen. (Wasser nach Personen braucht keine Ablesung.)
            </p>
          ) : (
            <>
              <p className="muted" style={{ margin: '4px 0 8px' }}>
                Stände zum {fmtDate(endDate)} erfassen — dann wird der Verbrauch exakt statt
                tagesanteilig aufgeteilt. {unitMeters.length === 0 && 'Der Hauptzähler dient nur der Dokumentation.'}
                {' '}Leere Felder werden übersprungen.
              </p>
              <div className="row">
                {meters.map((m) => (
                  <label className="field" key={m.id}>
                    {m.name} ({m.unitId === null ? 'Hauptzähler' : METER_TYPE_LABELS[m.type] ?? m.type}{m.unit ? `, ${m.unit}` : ''})
                    <input
                      value={meterValues[m.id] ?? ''}
                      disabled={step > 2}
                      placeholder="Stand"
                      style={{ width: 140 }}
                      onChange={(e) => setMeterValues({ ...meterValues, [m.id]: e.target.value })}
                    />
                  </label>
                ))}
                {step === 2 && <button className="btn" onClick={goToStep3}>Weiter</button>}
              </div>
            </>
          )}
          {step === 2 && meters.length === 0 && <button className="btn" onClick={goToStep3}>Weiter</button>}
        </div>
      )}

      {step >= 3 && (
        <div className="wizard-step">
          <strong>3. Neuer Mieter</strong>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 9 }}>
              <input type="checkbox" checked={vacancy} onChange={(e) => setVacancy(e.target.checked)} />
              Wohnung bleibt vorerst leer (Leerstand)
            </label>
          </div>
          {!vacancy && (
            <div className="row">
              <label className="field grow">
                Mieter
                <input value={newTenant.name} onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })} placeholder="z. B. Familie Müller" />
              </label>
              <label className="field">
                Einzug
                <input type="date" value={newTenant.start} onChange={(e) => setNewTenant({ ...newTenant, start: e.target.value })} />
              </label>
              <label className="field">
                Personen
                <input value={newTenant.persons} style={{ width: 80 }} onChange={(e) => setNewTenant({ ...newTenant, persons: e.target.value })} />
              </label>
              <label className="field">
                Kaltmiete €/Monat
                <input value={newTenant.baseRent} style={{ width: 120 }} placeholder="z. B. 800,00" onChange={(e) => setNewTenant({ ...newTenant, baseRent: e.target.value })} />
              </label>
              <label className="field">
                {askHeating ? 'Übrige Vorauszahlung €/Monat' : 'Vorauszahlung €/Monat'}
                <input value={newTenant.prepayment} style={{ width: 120 }} placeholder="z. B. 150,00" onChange={(e) => setNewTenant({ ...newTenant, prepayment: e.target.value })} />
              </label>
              {askHeating && (
                <label className="field">
                  Heizvorauszahlung €/Monat
                  <input value={newTenant.heatingPrepayment ?? ''} style={{ width: 120 }} placeholder="z. B. 120,00" onChange={(e) => setNewTenant({ ...newTenant, heatingPrepayment: e.target.value })} />
                </label>
              )}
            </div>
          )}
          <div className="notice" style={{ marginTop: 10 }}>
            Beim Abschluss passiert: Mietverhältnis „{tenancy.tenantName}“ endet am {fmtDate(endDate)}
            {readCount > 0 && <> · {readCount} Zwischenablesung{readCount > 1 ? 'en werden' : ' wird'} gespeichert</>}
            {vacancy
              ? ' · die Wohnung bleibt ohne Mieter (Leerstandskosten trägt der Vermieter).'
              : newTenant.name.trim() ? <> · neues Mietverhältnis „{newTenant.name}“ ab {newTenant.start ? fmtDate(newTenant.start) : '—'}.</> : ' · neues Mietverhältnis wird angelegt.'}
          </div>
          <button className="btn" disabled={busy} onClick={() => void commit()}>
            {busy && <span className="spinner" />}Mieterwechsel durchführen
          </button>{' '}
          <button className="btn ghost" disabled={busy} onClick={onClose}>Abbrechen</button>
        </div>
      )}
      {step < 3 && (
        <button className="btn ghost" onClick={onClose}>Abbrechen</button>
      )}
      </>}
    </div>
  )
}
