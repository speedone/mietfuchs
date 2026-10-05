import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { AssessmentView, CostItem, CostKey, ExternalMeasure, ExtractResult, Meter, MeterType, Settlement, Settings, SplitPreviewPart, Tenancy, Unit } from '../types'
import { CATEGORIES, KEY_LABELS, METER_TYPE_LABELS, isNotAllocable, usageOf } from '../types'
import {
  EMPTY_ITEM_FORM,
  basisUnitsOf,
  buildCostItemBody,
  costKeyOptions,
  customSharesSumText,
  itemToForm,
  meterTypeOptions,
  amountsSumText,
  externalHint,
  externalMismatch,
  tenanciesForAmounts,
  EXTERNAL_MEASURE_OPTIONS,
  PARTICIPANT_KEYS,
  categoryNotice,
  selfAmountUnits,
  keyChangeNotice,
  newItemForm,
  externalTotalLabel,
  keyListText,
  showsKeyFields,
  showsTaxUnitField,
  taxScopeOf,
  TAX_SCOPE_SOME,
  toggleTaxUnit,
  withTaxUnit,
  withKey,
  withCategory,
  sameCostOf,
  needsSplitCheck,
  splitDecision,
  showsTaxYear,
  taxYearOptions,
  type ItemForm,
  type KeyContext,
} from '../costForm'
import CostPeriodFields from '../components/CostPeriodFields'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { alreadyCarried, carryKeyDetails, carryOverBody, carryOverForm, carryOverRows, withCarryAmount, type CarryRow } from '../carryOver'
import { api, errorText, fmtDate, fmtEuro, parseEuro } from '../api'
import { aiSummary } from '../aiForm'
import { useEvaluationQueue } from '../evaluationQueue'
import AssessmentReview from '../components/AssessmentReview'
import { usePeriod } from '../period'
import { PeriodSelect } from '../components/PeriodSelect'
import { useOpenForm, useProperty, withProperty } from '../property'
import Drawer from '../components/Drawer'
import PageHeader from '../components/PageHeader'
import Term from '../components/Term'
import { AiProgressBadge } from '../components/AiProgress'
import { useToast, useConfirm } from '../components/feedback'
import Table from '../components/Table'
import { candidateText } from '../triage'
import { countOf } from '../../../shared/wording.ts'
import { useFocusTarget, type FocusProps } from '../focus'

// `tenancies` für die Einzelbeträge je Mietverhältnis (#94); ohne sie gibt es dort nur keine Felder.
type Props = { units: Unit[]; settings: Settings | null; tenancies?: Tenancy[] } & FocusProps

// Maßeinheit der Summe der Anteile, für die Vorlagenliste (#141)
const EXTERNAL_UNIT_LABELS: Record<ExternalMeasure, string> = { mea: 'MEA', area: 'm²', units: 'Einheiten' }

// Was ein Beleg der KI-Warteschlange (evaluationQueue.ts) nach der Auswertung trägt: die
// gespeicherte Auswertung, die „Auswertung prüfen“ zeigt (#170).
type Evaluated = { serverFile: string; assessment: AssessmentView }

const NOT_SAVED = 'Die Auswertung ließ sich nicht speichern. Bitte versuchen Sie es noch einmal; gebucht wurde nichts.'

export default function Kosten({ units, settings, tenancies = [], focus, onFocusDone }: Props) {
  // Wohin die Belege zur Auswertung gehen (siehe aiForm.ts)
  const ai = aiSummary(settings)
  // Der gewählte Abrechnungszeitraum (#208). `year` ist das Kalenderjahr, in dem er beginnt: Belege
  // tragen Kalenderjahre, und der Hinweis zur Kostenart hängt am Jahr.
  const view = usePeriod()
  const { key, label, at, param, period, year } = view
  const { property } = useProperty()
  const propertyId = property?.id
  const toast = useToast()
  const confirm = useConfirm()
  const [items, setItems] = useState<CostItem[]>([])
  const [meters, setMeters] = useState<Meter[]>([])
  const [form, setForm] = useState<ItemForm | null>(null)
  // Verlangt die Vorschau des Aufteilens das Jahr der Zahlung (#208), zeigt das Formular das Feld
  // auch bei einem Zeitraum in einem Kalenderjahr.
  const [needsTaxYear, setNeedsTaxYear] = useState(false)
  useEffect(() => { if (!form) setNeedsTaxYear(false) }, [form])
  const [error, setError] = useState('')

  // „Aus dem Vorjahr übernehmen“ (#141): die Vorlagen, solange die Liste offen ist. Eingetragene
  // Beträge gehen beim Verlassen verloren, deshalb zählt die Liste als offenes Formular.
  const [carry, setCarry] = useState<CarryRow[] | null>(null)
  useOpenForm(carry?.some((r) => r.amount.trim() !== '') ?? false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const load = () => api<CostItem[]>(withProperty('/api/costItems', propertyId)).then(setItems)
  useEffect(() => {
    load().catch(() => setError('Server nicht erreichbar — läuft `npm run dev`?'))
    api<Meter[]>(withProperty('/api/meters', propertyId)).then(setMeters).catch(() => {})
    // Neu laden, wenn das Objekt wechselt (#92).
  }, [propertyId])
  // Ist die Abrechnung des Jahres für dieses Objekt abgeschlossen (#142)? Dann ändert eine
  // Kostenposition sie nicht mehr; die Seite sagt das, statt still weiter erfassen zu lassen.
  const [closedAt, setClosedAt] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setClosedAt(null)
    api<Pick<Settlement, 'closed'>>(withProperty(`/api/settlement/${param}`, propertyId))
      .then((s) => { if (alive) setClosedAt(s.closed?.closedAt ?? null) })
      .catch(() => {})
    return () => { alive = false }
  }, [param, propertyId])
  // „Hier beheben →“ aus der Abrechnung (#142): die betroffene Position zum Bearbeiten öffnen.
  useFocusTarget(focus, 'costItem', items, (i) => i.id, (i) => { setError(''); setForm(itemToForm(i)) }, onFocusDone)

  // Verbrauchsschlüssel ist nur sinnvoll, wenn Wohnungszähler existieren
  const unitMeterTypes = useMemo(() => [...new Set(meters.filter((m) => m.unitId).map((m) => m.type))], [meters])
  // Wohnungen der Abrechnungseinheit — nur sie können einen vereinbarten Anteil tragen
  const basisUnits = useMemo(() => basisUnitsOf(units), [units])
  // Live-Summe der Anteile, damit der Vermieter-Rest schon bei der Eingabe sichtbar ist
  const sumText = form ? customSharesSumText(form, units) : ''

  // Bereits hochgeladene Belege (für die nachträgliche Zuordnung zu einer Position)
  const knownFiles = useMemo(() => {
    const m = new Map<string, string>()
    for (const it of items) if (it.invoiceFile && !m.has(it.invoiceFile)) m.set(it.invoiceFile, it.vendor || it.category)
    return [...m.entries()]
  }, [items])

  async function uploadInvoice(f: File) {
    const fd = new FormData()
    fd.append('file', f)
    // Wird die Position nicht gespeichert, steht der Beleg im Posteingang dieses Objekts und
    // Jahres (#170) statt ohne Zuordnung.
    if (property?.id) fd.append('propertyId', property.id)
    fd.append('year', String(year))
    try {
      const res = await api<{ file: string }>('/api/upload', { method: 'POST', body: fd })
      setForm((prev) => (prev ? { ...prev, invoiceFile: res.file } : prev))
    } catch (e) {
      setError(`Der Beleg wurde nicht hochgeladen: ${errorText(e)}`)
    }
  }

  const yearItems = useMemo(() => items.filter((i) => i.period === key), [items, key])
  // Woraus eine neue Position ihren Schlüssel vorgeschlagen bekommt (#141): die Positionen des
  // Objekts, das Jahr und die Art des Objekts.
  const keyCtx: KeyContext = useMemo(() => ({ items, year, at, propertyKind: property?.kind ?? null }), [items, year, at, property?.kind])
  const totalCents = yearItems.reduce((a, i) => a + i.amountCents, 0)

  // Nach Beleg (Rechnung) gruppiert — alle Positionen eines Belegs stehen zusammen, mit
  // Zwischensumme = Belegsumme. So lassen sich die einzelnen Beträge und die Summe direkt
  // mit der Rechnung abgleichen (z. B. Wasser, Abwasser, Kanal- und Niederschlagsbeitrag
  // eines Versorgers). Manuell erfasste Positionen ohne Beleg stehen einzeln am Ende.
  type CostGroup = { key: string; label: string; invoiceFile?: string; items: CostItem[] }
  const grouped = useMemo(() => {
    const withInvoice: CostGroup[] = []
    const withoutInvoice: CostGroup[] = []
    for (const it of yearItems) {
      if (it.invoiceFile) {
        const g = withInvoice.find((x) => x.invoiceFile === it.invoiceFile)
        if (g) { g.items.push(it); if (!g.label && it.vendor) g.label = it.vendor }
        else withInvoice.push({ key: `f:${it.invoiceFile}`, label: it.vendor || '', invoiceFile: it.invoiceFile, items: [it] })
      } else {
        withoutInvoice.push({ key: `i:${it.id}`, label: it.vendor || it.category, items: [it] })
      }
    }
    // Fallback-Beschriftung, falls kein Rechnungssteller hinterlegt ist
    for (const g of withInvoice) if (!g.label) g.label = g.items.map((i) => i.category).find(Boolean) || 'Beleg'
    return [...withInvoice, ...withoutInvoice]
  }, [yearItems])

  // Die Vorlagen gehören zum gewählten Jahr und Objekt; wechselt eines davon, schließt die Liste.
  useEffect(() => { setCarry(null) }, [key, propertyId])
  const previousCount = useMemo(() => items.filter((i) => i.period === at.previous).length, [items, at.previous])

  function updateCarry(index: number, patch: Partial<CarryRow>) {
    setCarry((rows) => rows && rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  // Erst alle angehakten Zeilen prüfen, dann anlegen (#139): Eine Zeile ohne Betrag wird genannt,
  // statt still zu fehlen. Angelegte Zeilen verschwinden aus der Liste; scheitert eine, bleibt der
  // Rest stehen, damit ein zweiter Versuch nichts doppelt anlegt.
  // Gesperrt, solange ein Durchgang läuft (Durchsicht): Ein Doppelklick legte sonst alles zweimal
  // an, denn der zweite Klick kommt, bevor die Liste neu gezeichnet ist. Deshalb ein Ref und nicht
  // nur der gesperrte Knopf.
  const carryBusy = useRef(false)
  const [carrySaving, setCarrySaving] = useState(false)
  async function adoptCarry() {
    if (!carry || carryBusy.current) return
    carryBusy.current = true
    setCarrySaving(true)
    try {
      await adoptCarryRows(carry)
    } finally {
      carryBusy.current = false
      setCarrySaving(false)
    }
  }
  async function adoptCarryRows(rows: CarryRow[]) {
    const chosen = rows.filter((row) => row.checked)
    const blocked = chosen.flatMap((row) => {
      const built = carryOverBody(row, units, period, tenancies)
      return 'error' in built ? [`„${row.description}“: ${built.error}`] : []
    })
    if (blocked.length > 0) {
      setError(`Nicht übernommen: ${blocked.join(' ')}`)
      return
    }
    // Schon im Jahr erfasst und trotzdem angehakt: ausdrücklich nachfragen (Durchsicht), sonst
    // stünde dieselbe Rechnung zweimal in der Abrechnung.
    const twice = chosen.filter((row) => alreadyCarried(items, row, at))
    if (twice.length > 0) {
      const ok = await confirm({
        title: 'Schon erfasst',
        message: `${twice.map((r) => `„${r.description}“`).join(', ')} ${twice.length === 1 ? 'ist' : 'sind'} für ${label} schon erfasst. Legen Sie ${twice.length === 1 ? 'die Position' : 'die Positionen'} trotzdem noch einmal an, wird dieselbe Rechnung zweimal verteilt.`,
        confirmLabel: 'Trotzdem anlegen',
        cancelLabel: 'Abbrechen',
      })
      if (!ok) return
    }
    setError('')
    const done = new Set<string>()
    for (const row of chosen) {
      const built = carryOverBody(row, units, period, tenancies)
      if ('error' in built) continue
      try {
        await api(withProperty('/api/costItems', propertyId), { method: 'POST', body: JSON.stringify(built.body) })
        done.add(row.source.id)
      } catch (e) {
        setError(`„${row.description}“ wurde nicht übernommen: ${errorText(e)}`)
        break
      }
    }
    removeCarried(done)
    await load()
    if (done.size > 0) toast(`${done.size} ${done.size === 1 ? 'Position' : 'Positionen'} aus ${at.previousLabel} für ${label} angelegt.`)
  }
  // Angelegte Zeilen verschwinden aus der Liste, gleich auf welchem Weg (Knopf oder Formular).
  function removeCarried(ids: Set<string>) {
    if (ids.size === 0) return
    setCarry((rows) => {
      if (!rows) return rows
      const rest = rows.filter((r) => !ids.has(r.source.id))
      return rest.length > 0 ? rest : null
    })
  }
  // Die Zeile, aus der das offene Formular stammt („Im Formular öffnen“): Nach dem Speichern
  // verschwindet sie aus der Liste, sonst legte der Knopf sie ein zweites Mal an (Durchsicht).
  const [formCarryId, setFormCarryId] = useState<string | null>(null)
  useEffect(() => { if (!form) setFormCarryId(null) }, [form])

  async function saveItem() {
    if (!form) return
    const built = buildCostItemBody(form, units, period, tenancies)
    if ('error' in built) {
      setError(built.error)
      return
    }
    setError('')
    const body = JSON.stringify(built.body)
    const editing = !!form.id
    // Eine kalte Rechnung über zwei Abrechnungszeiträume (#208, Entwurf 3.4): erst die Vorschau,
    // dann nach Rückfrage alle Teile auf einmal.
    if (needsSplitCheck(built.body, editing ? items.find((i) => i.id === form.id) : null)) {
      let parts: SplitPreviewPart[]
      try {
        parts = (await api<{ parts: SplitPreviewPart[] }>(
          editing ? `/api/costItems/${form.id}/split/preview` : withProperty('/api/costItems/split/preview', propertyId),
          { method: 'POST', body },
        )).parts
      } catch (e) {
        setError(errorText(e))
        return
      }
      if (parts.length > 1) {
        const decision = splitDecision(parts, form.taxYear)
        if ('error' in decision) {
          setNeedsTaxYear(decision.needsTaxYear)
          setError(decision.error)
          return
        }
        const ok = await confirm({ title: 'Rechnung aufteilen?', message: decision.message, confirmLabel: 'Aufteilen und speichern', cancelLabel: 'Abbrechen' })
        if (!ok) return
        try {
          await api(editing ? `/api/costItems/${form.id}/split` : withProperty('/api/costItems/split', propertyId), { method: editing ? 'PUT' : 'POST', body })
        } catch (e) {
          setError(errorText(e))
          return
        }
        const desc = form.description.trim()
        setForm(null)
        await load()
        toast(`„${desc}“ auf ${parts.length} Abrechnungszeiträume aufgeteilt.`)
        return
      }
    }
    // Eine neue Position, für die dieselbe Rechnung schon erfasst sein könnte (shared/duplicates.ts):
    // nachfragen, wie in der Schnellerfassung. Nur beim Neuanlegen; wer bearbeitet, meint diese.
    if (!editing) {
      const same = sameCostOf(items, { category: form.category, description: form.description, vendor: form.vendor, amountCents: built.body.amountCents }, propertyId, key)
      const first = same[0]
      if (first) {
        let instead = false
        const ok = await confirm({
          title: 'Dieselbe Rechnung?',
          message: `Für ${label} ist ${same.map(candidateText).join(', ')} schon erfasst. Ist das dieselbe Rechnung? Dann bearbeiten Sie besser die vorhandene Position, sonst wird sie zweimal verteilt.`,
          confirmLabel: 'Trotzdem anlegen',
          alternativeLabel: `Stattdessen „${first.description}“ bearbeiten`,
          onAlternative: () => { instead = true },
          cancelLabel: 'Abbrechen',
        })
        if (instead) { setForm(itemToForm(first)); return }
        if (!ok) return
      }
    }
    // Lehnt der Server ab (#146), bleibt der Dialog offen und zeigt seinen Satz.
    try {
      if (editing) await api(`/api/costItems/${form.id}`, { method: 'PUT', body })
      else await api(withProperty('/api/costItems', propertyId), { method: 'POST', body })
    } catch (e) {
      setError(errorText(e))
      return
    }
    const desc = form.description.trim()
    if (!editing && formCarryId) removeCarried(new Set([formCarryId]))
    setForm(null)
    await load()
    toast(editing ? `„${desc}“ übernommen.` : `„${desc}“ hinzugefügt.`)
  }

  async function deleteItem(i: CostItem) {
    const ok = await confirm({
      title: `Kostenposition löschen?`,
      message: `„${i.description}“ (${fmtEuro(i.amountCents)}) wird gelöscht.`,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/costItems/${i.id}`, { method: 'DELETE' })
    } catch (e) {
      setError(errorText(e))
      return
    }
    setError('')
    await load()
    toast(`„${i.description}“ gelöscht.`)
  }

  // KI-Auswertung (#170): Die Warteschlange teilt sich die Kostenseite mit der Schnellerfassung.
  // Eine ausgewertete Rechnung ist danach als Auswertung gespeichert und wird mit „Auswertung
  // prüfen“ gebucht; verlässt der Nutzer die Seite, geht sie nicht verloren (Posteingang).
  const { queue, patchEntry, addFiles, remove, cancel } = useEvaluationQueue<ExtractResult, Evaluated>({
    endpoint: '/api/extract',
    pageImageEdge: settings?.ai?.pageImageEdge ?? undefined,
    // Bleibt der Beleg ungebucht, steht er im Posteingang dieses Objekts; nennt er kein Jahr,
    // gilt das gewählte (#170).
    propertyId,
    year,
    finish: (res) => (res.assessment
      ? { status: res.assessment.open ? 'fertig' : 'übernommen', data: { serverFile: res.file, assessment: res.assessment } }
      : { status: 'fehler', error: NOT_SAVED }),
  })
  // Nur laufende und wartende Auswertungen gingen beim Objektwechsel verloren (#145).
  useOpenForm(queue.some((x) => x.status === 'wartend' || x.status === 'läuft'))

  return (
    <>
      <PageHeader
        title="Kosten & Belege"
        subtitle="Alle Rechnungen des Abrechnungsjahres erfassen — manuell oder per KI-Belegauswertung."
        actions={<button className="btn" onClick={() => { setError(''); setForm(newItemForm(units, meters, keyCtx)) }}>+ Kostenposition</button>}
      />
      {error && !form && <div className="error">{error}</div>}
      {closedAt && (
        <div className="notice">
          Die Abrechnung {label} ist abgeschlossen (am {fmtDate(closedAt.slice(0, 10))}). Änderungen an den Kosten
          ändern die eingefrorene Abrechnung nicht; die Abrechnungsseite zeigt sie als Abweichung zur heutigen
          Berechnung. Bearbeiten bleibt möglich.
        </div>
      )}

      <div className="card no-print">
        <div className="row">
          <PeriodSelect />
          {previousCount > 0 && !carry && (
            <button className="btn secondary" onClick={() => { setError(''); setCarry(carryOverRows(items, at)) }}>
              Aus {at.previousLabel} übernehmen …
            </button>
          )}
          <div className="grow" />
          <div>
            <div className="muted">Erfasste Kosten {label}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtEuro(totalCents)}</div>
          </div>
        </div>
      </div>


      {carry && (
        <div className="card no-print">
          <h2>Positionen aus {at.previousLabel} für {label} übernehmen</h2>
          <p className="muted">
            Übernommen werden Kostenart, Beschreibung, Rechnungssteller und der Umlageschlüssel samt
            Angaben. Tragen Sie je Zeile den Betrag {label} ein; eine Zeile mit Betrag ist angehakt.
            Angelegt wird erst mit dem Knopf unten, ohne Beleg.
          </p>
          <Table>
            <thead>
              <tr>
                <th><span className="sr-only">Übernehmen</span></th>
                <th>Kostenart</th>
                {/* Betrag gleich hinter der Kostenart: Auf dem Handy scrollt die Tabelle waagerecht
                    (Table.tsx), und das Feld, das man ausfüllen muss, soll ohne Wischen dastehen. */}
                <th className="num">Betrag {label} €</th>
                <th className="num">§35a Lohn €</th>
                <th>Beschreibung</th>
                <th>Umlageschlüssel</th>
                <th><span className="sr-only">Formular</span></th>
              </tr>
            </thead>
            <tbody>
              {carry.map((r, i) => (
                <tr key={r.source.id}>
                  <td>
                    <input type="checkbox" aria-label={`${r.description} übernehmen`} checked={r.checked} disabled={!r.inline}
                      onChange={(e) => updateCarry(i, { checked: e.target.checked })} />
                  </td>
                  <td>
                    {r.source.category}
                    {alreadyCarried(items, r, at) && <div><span className="badge gray">schon für {label} erfasst</span></div>}
                  </td>
                  <td className="num">
                    {r.inline && (
                      <input aria-label={`Betrag ${label} für ${r.description}`} value={r.amount} onChange={(e) => updateCarry(i, withCarryAmount(r, e.target.value, alreadyCarried(items, r, at)))}
                        placeholder="—" inputMode="decimal" style={{ width: 100, textAlign: 'right' }} />
                    )}
                    {r.checked && !r.amount.trim() && <div><span className="badge red">Betrag fehlt</span></div>}
                    <div className="muted">{at.previousLabel}: {fmtEuro(r.source.amountCents)}</div>
                  </td>
                  <td className="num">
                    {r.inline && <input aria-label={`§35a-Lohn ${label} für ${r.description}`} value={r.labor35a} onChange={(e) => updateCarry(i, { labor35a: e.target.value })} placeholder="—" inputMode="decimal" style={{ width: 90, textAlign: 'right' }} />}
                  </td>
                  <td><input aria-label="Beschreibung" value={r.description} onChange={(e) => updateCarry(i, { description: e.target.value })} style={{ width: '100%', minWidth: 200 }} /></td>
                  <td>
                    {keyListText(r.source, units)}
                    {showsKeyFields(r.source.category) && r.source.participantUnitIds && (
                      <div className="muted">nur {r.source.participantUnitIds.map((id) => units.find((u) => u.id === id)?.name ?? '?').join(', ')}</div>
                    )}
                    {showsKeyFields(r.source.category) && r.source.key === 'meter' && r.source.meterType && <div className="muted">{METER_TYPE_LABELS[r.source.meterType]}</div>}
                    {/* Durchsicht: Anteile samt Summe, Wohnung der Direktzuordnung */}
                    {showsKeyFields(r.source.category) && (() => {
                      const d = carryKeyDetails(r.source, units)
                      return d && <div className={d.warn ? '' : 'muted'}>{d.warn ? <span className="badge red">{d.text}</span> : d.text}</div>
                    })()}
                    {showsKeyFields(r.source.category) && r.source.key === 'external' && r.source.externalBasis && (
                      <div className="muted">
                        {r.source.externalBasis.total.toLocaleString('de-DE', { maximumFractionDigits: 6 })} {EXTERNAL_UNIT_LABELS[r.source.externalBasis.measure]} in der Anlage; Kosten der Gemeinschaft {label} €:
                      </div>
                    )}
                    {showsKeyFields(r.source.category) && r.source.key === 'external' && r.source.externalBasis && (
                      <input
                        aria-label={`Kosten der Gemeinschaft ${label} für ${r.description}`}
                        value={r.externalTotalAmount}
                        onChange={(e) => updateCarry(i, { externalTotalAmount: e.target.value })}
                        placeholder="Kosten der Gemeinschaft €"
                        inputMode="decimal"
                        style={{ width: 170, marginTop: 4 }}
                      />
                    )}
                    {!r.inline && <div className="muted">Einzelbeträge je Mieter bitte im Formular eintragen.</div>}
                  </td>
                  <td>
                    <button className="btn small ghost" onClick={() => { setError(''); setForm(carryOverForm(r)); setFormCarryId(r.source.id) }}>Im Formular öffnen</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => void adoptCarry()} disabled={carrySaving || carry.every((r) => !r.checked)}>
              {carry.filter((r) => r.checked).length} {carry.filter((r) => r.checked).length === 1 ? 'Position' : 'Positionen'} für {label} anlegen
            </button>
            <button className="btn ghost" onClick={() => setCarry(null)}>Schließen</button>
          </div>
        </div>
      )}

      <div className="card no-print">
        <h2>🤖 Beleg per KI auswerten <span className="badge gray">{ai.where}</span></h2>
        <p className="muted">
          PDF oder Foto der Rechnung hochladen — das Modell ({ai.model}) schlägt Kostenpositionen
          vor, Sie prüfen und übernehmen sie. {ai.notice ?? 'Es verlässt nichts Ihren Rechner.'}
        </p>
        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
        >
          <strong>Belege hierher ziehen</strong> oder klicken zum Auswählen — auch mehrere auf einmal.
          <div className="muted">Sie werden nacheinander verarbeitet (PDF oder Foto).</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
          />
        </div>

        {queue.map((entry) => (
          <div key={entry.id} style={{ marginTop: 14 }}>
            <div className="row" style={{ alignItems: 'center' }}>
              <strong>{entry.fileName}</strong>
              {entry.status === 'wartend' && <span className="badge gray">wartet …</span>}
              {entry.status === 'läuft' && (
                <AiProgressBadge
                  progress={entry.progress ?? null}
                  startedAt={entry.startedAt ?? Date.now()}
                  onCancel={() => cancel(entry.id)}
                />
              )}
              {entry.status === 'fertig' && <span className="badge green">{countOf(entry.data.assessment?.lines.length ?? 0, 'Position', 'Positionen')} erkannt — bitte prüfen</span>}
              {entry.status === 'übernommen' && <span className="badge green">✓ übernommen</span>}
              {entry.status === 'fehler' && <span className="badge red">Fehler</span>}
              {entry.status === 'abgebrochen' && <span className="badge gray">abgebrochen</span>}
              {/* Gebucht wird im Jahr des Belegs; weicht es vom gewählten ab, steht es hier, wie in der Schnellerfassung (I1). */}
              {entry.data.assessment && entry.data.assessment.year !== year && <span className="badge gray">Jahr {entry.data.assessment.year}</span>}
              <div className="grow" />
              {(entry.status === 'wartend' || entry.status === 'fertig' || entry.status === 'fehler' || entry.status === 'abgebrochen' || entry.status === 'übernommen') && (
                <button className="btn small ghost" onClick={() => remove(entry.id)}>
                  {entry.status === 'fertig' ? 'Ausblenden' : 'Entfernen'}
                </button>
              )}
            </div>
            {entry.status === 'fehler' && <div className="error">{entry.error}</div>}
            {entry.data.assessment && (entry.status === 'fertig' || entry.status === 'übernommen') && (
              <AssessmentReview assessment={entry.data.assessment} units={units} keyContext={entry.data.assessment.year === year ? keyCtx : { items, year: entry.data.assessment.year, propertyKind: property?.kind ?? null }}
                onChange={(next) => { patchEntry(entry.id, { status: next.open ? 'fertig' : 'übernommen', data: { assessment: next } }); void load() }}
                onOpenItem={(id) => { const it = items.find((i) => i.id === id); if (it) { setError(''); setForm(itemToForm(it)) } }} />
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Kostenpositionen {label}</h2>
        {yearItems.length === 0 && <div className="empty">Noch keine Kosten für {label} erfasst.</div>}
        {yearItems.length > 0 && (
          <Table>
            <thead>
              <tr>
                <th>Kostenart</th>
                <th>Beschreibung</th>
                <th>Umlageschlüssel</th>
                <th className="num">Betrag</th>
                <th className="no-print"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
              <Fragment key={g.key}>
              {g.invoiceFile && (
                <tr className="group-head">
                  <td colSpan={5}>
                    {g.label}
                    <a href={`/uploads/${g.invoiceFile}`} target="_blank" rel="noreferrer">📎 Beleg</a>
                  </td>
                </tr>
              )}
              {g.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.category}
                    {isNotAllocable(i.category) && <span className="badge gray" style={{ marginLeft: 6 }}>Vermieter</span>}
                  </td>
                  <td>
                    {i.description}
                    {!i.invoiceFile && i.vendor && <div className="muted">{i.vendor}</div>}
                  </td>
                  <td>
                    {/* Nicht umlagefähig (#142): kein Schlüssel, die Position trägt der Vermieter. */}
                    {keyListText(i, units)}
                    {showsKeyFields(i.category) && <>
                    {/* Eine Einschränkung auf Teilnehmer (#105) soll man in der Liste sehen, nicht erst im Formular. */}
                    {i.participantUnitIds && (
                      <div className="muted">nur {i.participantUnitIds.map((id) => units.find((u) => u.id === id)?.name ?? '?').join(', ') || 'keine Wohnung'}</div>
                    )}
                    {i.key === 'direct' && <div className="muted">{units.find((u) => u.id === i.directUnitId)?.name}</div>}
                    {i.key === 'meter' && <div className="muted">{i.meterType ? METER_TYPE_LABELS[i.meterType] : '— kein Zählertyp'}</div>}
                    {i.key === 'custom' && (
                      <div className="muted">
                        {Object.entries(i.customShares ?? {})
                          .map(([unitId, pct]) => `${units.find((u) => u.id === unitId)?.name ?? '?'}: ${pct.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`)
                          .join(' · ') || '— keine Anteile'}
                      </div>
                    )}
                    </>}
                  </td>
                  <td className="num">
                    {fmtEuro(i.amountCents)}
                    {!!i.labor35aCents && <div className="muted">§35a: {fmtEuro(i.labor35aCents)}</div>}
                  </td>
                  <td className="actions no-print">
                    <button
                      className="icon-btn"
                      title="Bearbeiten"
                      aria-label="Kostenposition bearbeiten"
                      onClick={() => {
                        setError('')
                        setForm(itemToForm(i))
                      }}
                    >
                      ✎
                    </button>
                    <button className="icon-btn danger" title="Löschen" aria-label="Kostenposition löschen" onClick={() => deleteItem(i)}>🗑</button>
                  </td>
                </tr>
              ))}
              {g.invoiceFile && g.items.length > 1 && (
                <tr className="subtotal">
                  <td colSpan={3}>Summe Beleg — {g.label}</td>
                  <td className="num">{fmtEuro(g.items.reduce((a, i) => a + i.amountCents, 0))}</td>
                  <td className="no-print" />
                </tr>
              )}
              </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Summe</td>
                <td className="num">{fmtEuro(totalCents)}</td>
                <td className="no-print"></td>
              </tr>
            </tfoot>
          </Table>
        )}

        <button className="btn secondary no-print" style={{ marginTop: 14 }} onClick={() => { setError(''); setForm(newItemForm(units, meters, keyCtx)) }}>
          + Kostenposition manuell erfassen
        </button>
      </div>

      {form && (
        <Drawer
          open
          title={form.id ? 'Kostenposition bearbeiten' : 'Neue Kostenposition'}
          subtitle={form.id ? form.description : undefined}
          onClose={() => { setError(''); setForm(null) }}
          onSubmit={saveItem}
          footer={
            <>
              <span className="drawer-hint">Strg+S speichert · Esc schließt</span>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => { setError(''); setForm(null) }}>Abbrechen</button>
              <button className="btn" onClick={saveItem}>{form.id ? 'Übernehmen' : 'Hinzufügen'}</button>
            </>
          }
        >
          {error && <div className="error">{error}</div>}
          {categoryNotice(form.category, year, property?.cableBuiltBeforeDec2021 ?? null) && <div className="notice">{categoryNotice(form.category, year, property?.cableBuiltBeforeDec2021 ?? null)}</div>}
          <div className="row">
            <label className="field grow">
              Kostenart
              <select value={form.category} onChange={(e) => setForm(withCategory(form, e.target.value, units, meters, keyCtx))}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="field grow">
              Beschreibung
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="z. B. Grundsteuer 2025" />
            </label>
            <label className="field grow">
              Rechnungssteller
              <input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="optional" />
            </label>
            <label className="field grow">
              Betrag €
              <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="z. B. 480,00" />
              {/* #139: Eine Gutschrift senkt die Kosten des Jahres und wird verteilt wie eine Rechnung. */}
              <small className="muted">Eine Gutschrift mit Minus eintragen, z. B. -54,00.</small>
            </label>
            <label className="field grow" title="Lohn-/Arbeitskostenanteil nach §35a EStG — kann der Mieter steuerlich absetzen">
              <span>davon <Term id="labor35a">§35a-Lohn</Term> €</span>
              <input value={form.labor35a} onChange={(e) => setForm({ ...form, labor35a: e.target.value })} placeholder="optional" />
            </label>
            <details className="field grow" style={{ flexBasis: '100%' }} open={!!(form.serviceFrom || form.serviceTo || form.taxYear || form.heatingFuel || showsTaxYear(period, needsTaxYear))}>
              <summary>Weitere Angaben — Leistungszeitraum{showsTaxYear(period, needsTaxYear) ? ', Jahr der Zahlung' : ''}{form.category === HEATING_CATEGORY ? ', Brennstoff/Energie' : ''} (optional)</summary>
              <CostPeriodFields form={form} onChange={setForm} showTaxYear={showsTaxYear(period, needsTaxYear)} years={taxYearOptions(year)} />
            </details>
            {/* Nicht umlagefähig (#142): nichts zu verteilen, also keine Auswahl, die etwas anderes verspräche. */}
            {!showsKeyFields(form.category) && (
              <div className="field grow muted">
                <span><Term id="notAllocable">Nicht umlagefähig</Term>: Diese Position trägt der Vermieter allein; ein Umlageschlüssel entfällt.</span>
              </div>
            )}
            {/* #163: Für die Steuer zählt, wen eine Reparatur betrifft. Die Abrechnung liest das nicht. */}
            {showsTaxUnitField(form.category) && (
              <label className="field grow">
                <Term id="mixedUse">Betrifft (für die Steuer)</Term>
                <select value={taxScopeOf(form)} onChange={(e) => setForm(withTaxUnit(form, e.target.value))}>
                  <option value="">das ganze Gebäude (nach Fläche)</option>
                  <option value={TAX_SCOPE_SOME}>bestimmte Einheiten (nach Fläche)</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}{u.selfUsed && !u.participates ? ' (selbstgenutzt)' : ''}</option>)}
                </select>
              </label>
            )}
            {/* Bestimmte Einheiten, etwa das Dach des Hinterhauses (Durchsicht): Die Kästchen zeigen genau
                die gespeicherten Teilnehmer. */}
            {showsTaxUnitField(form.category) && taxScopeOf(form) === TAX_SCOPE_SOME && (
              <div className="field-group">
                <div className="field-group-label">Betroffene Einheiten (für die Steuer)</div>
                <div className="row">
                  {units.map((u) => (
                    <label key={u.id} className="field checkline">
                      <span>
                        <input
                          type="checkbox"
                          aria-label={`${u.name} (betroffen)`}
                          checked={(form.participants ?? []).includes(u.id)}
                          onChange={(e) => setForm(toggleTaxUnit(form, u.id, e.target.checked))}
                        />{' '}
                        {u.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {showsKeyFields(form.category) && <>
            <label className="field grow">
              <Term id="allocationKey">Umlageschlüssel</Term>
              <select value={form.key} onChange={(e) => setForm(withKey(form, e.target.value as CostKey, unitMeterTypes, keyCtx))}>
                {costKeyOptions(unitMeterTypes, form.key).map((k) => (
                  <option key={k} value={k}>{KEY_LABELS[k]}</option>
                ))}
              </select>
            </label>
            {/* #141: anders als dieselbe Kostenart im Vorjahr? Dasselbe sagt die Abrechnung. */}
            {keyChangeNotice(form, units, keyCtx) && (
              <div className="notice">
                {keyChangeNotice(form, units, keyCtx)} Mehr dazu: <Term id="keyChange" />.
              </div>
            )}
            {form.key === 'meter' && (
              <label className="field grow">
                Zählertyp
                <select value={form.meterType} onChange={(e) => setForm({ ...form, meterType: e.target.value as MeterType | '' })}>
                  <option value="">— wählen —</option>
                  {meterTypeOptions(unitMeterTypes, form.meterType).map((t) => (
                    <option key={t} value={t}>{METER_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </label>
            )}
            {form.key === 'custom' && (
              <div className="field-group">
                <div className="field-group-label"><Term id="agreedShares">Vereinbarte Anteile</Term></div>
                <div className="muted" style={{ marginBottom: 8 }}>
                  Anteil je Wohnung in Prozent, wie im Mietvertrag vereinbart (§556a Abs. 1 BGB).
                  Was unter 100 % fehlt, trägt der Vermieter.
                </div>
                <div className="row">
                  {basisUnits.map((u) => (
                    <label key={u.id} className="field grow">
                      {/* Name und Kennzeichen in einer Zeile — .field ist eine Flex-Spalte,
                          ein direktes Kind würde sich sonst über die ganze Breite ziehen. */}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {u.name}
                        {usageOf(u) === 'eigen' && <span className="badge gray">Eigennutzung</span>}
                      </span>
                      <input
                        value={form.customShares[u.id] ?? ''}
                        onChange={(e) => setForm({ ...form, customShares: { ...form.customShares, [u.id]: e.target.value } })}
                        placeholder="z. B. 40"
                        inputMode="decimal"
                      />
                    </label>
                  ))}
                </div>
                <div className="muted" style={{ marginTop: 6 }}>Summe: {sumText}</div>
              </div>
            )}
            {form.key === 'external' && (
              <div className="field-group">
                <div className="field-group-label">Laut Gemeinschaftsabrechnung</div>
                <div className="muted" style={{ marginBottom: 8 }}>
                  Betrag oben ist Ihr Anteil laut <Term id="homeownersStatement">Hausgeldabrechnung</Term>. Hier die Angaben der Gemeinschaft
                  zu dieser Kostenart, meist nach <Term id="mea">Miteigentumsanteilen</Term>; sie erscheinen im Rechenweg der Abrechnung (§556a Abs. 3 BGB).
                </div>
                <div className="row">
                  <label className="field grow">
                    Maßstab
                    <select value={form.externalMeasure} onChange={(e) => setForm({ ...form, externalMeasure: e.target.value as ExternalMeasure })}>
                      {EXTERNAL_MEASURE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                  <label className="field grow">
                    {externalTotalLabel(form.externalMeasure)}
                    <input value={form.externalTotal} onChange={(e) => setForm({ ...form, externalTotal: e.target.value })} inputMode="decimal" />
                  </label>
                  <label className="field grow">
                    Kosten der Gemeinschaft (ganze Anlage) €
                    <input value={form.externalTotalAmount} onChange={(e) => setForm({ ...form, externalTotalAmount: e.target.value })} placeholder="z. B. 50.000,00" inputMode="decimal" />
                  </label>
                </div>
                {/* #144: weicht der rechnerische Anteil vom Betrag ab, steht er markiert da */}
                {externalHint(form, units) && (
                  externalMismatch(form, units)
                    ? <div className="notice" style={{ marginTop: 6 }}><strong>{externalHint(form, units)}</strong></div>
                    : <div className="muted" style={{ marginTop: 6 }}>{externalHint(form, units)}</div>
                )}
              </div>
            )}
            {form.key === 'amounts' && (
              <div className="field-group">
                <div className="field-group-label"><Term id="individualAmounts">Einzelbeträge</Term> je Mieter</div>
                <div className="muted" style={{ marginBottom: 8 }}>
                  Die Beträge aus der Einzelabrechnung, etwa vom Messdienst. Bei einem Mieterwechsel teilt
                  der Messdienst selbst auf; den Rest trägt der Vermieter.
                </div>
                {tenanciesForAmounts(tenancies, units, period, form.participants).length === 0 ? (
                  <div className="muted">In diesem Jahr gibt es kein Mietverhältnis in diesem Objekt.</div>
                ) : (
                  <div className="row">
                    {tenanciesForAmounts(tenancies, units, period, form.participants).map((t) => (
                      <label key={t.id} className="field grow">
                        {t.tenantName} ({units.find((u) => u.id === t.unitId)?.name ?? '—'})
                        <input
                          value={form.tenancyAmounts[t.id] ?? ''}
                          onChange={(e) => setForm({ ...form, tenancyAmounts: { ...form.tenancyAmounts, [t.id]: e.target.value } })}
                          placeholder="z. B. 312,40"
                          inputMode="decimal"
                        />
                      </label>
                    ))}
                  </div>
                )}
                {selfAmountUnits(units, form.participants).length > 0 && (
                  <div className="row" style={{ marginTop: 8 }}>
                    {selfAmountUnits(units, form.participants).map((u) => (
                      <label key={u.id} className="field grow">
                        <span>{u.name} (selbstgenutzt, Ihr <Term id="ownShare">Eigenanteil</Term>)</span>
                        <input
                          value={form.selfAmounts[u.id] ?? ''}
                          onChange={(e) => setForm({ ...form, selfAmounts: { ...form.selfAmounts, [u.id]: e.target.value } })}
                          placeholder="z. B. 600,00"
                          inputMode="decimal"
                        />
                      </label>
                    ))}
                  </div>
                )}
                <div className="muted" style={{ marginTop: 6 }}>{amountsSumText(form, units, tenancies, period)}</div>
              </div>
            )}
            {PARTICIPANT_KEYS.includes(form.key) && basisUnits.length > 1 && (
              <details open={form.participants !== null}>
                <summary>Weitere Optionen: nur bestimmte Wohnungen beteiligen</summary>
                <div className="muted" style={{ marginBottom: 8 }}>
                  Etwa der Aufzug nur für ein Haus oder die Waschküche nur für ihre Nutzer. Nur die
                  angehakten Wohnungen bilden die <Term id="distributionBasis">Verteilbasis</Term>.
                </div>
                <div className="row">
                  {basisUnits.map((u) => {
                    const checked = form.participants === null || form.participants.includes(u.id)
                    return (
                      <label key={u.id} className="field checkline">
                        <span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const current = form.participants ?? basisUnits.map((x) => x.id)
                              const next = e.target.checked ? [...current, u.id] : current.filter((id) => id !== u.id)
                              setForm({ ...form, participants: next })
                            }}
                          />{' '}
                          {u.name}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </details>
            )}
            {form.key === 'direct' && (
              <label className="field grow">
                Wohnung
                <select value={form.directUnitId} onChange={(e) => setForm({ ...form, directUnitId: e.target.value })}>
                  <option value="">— wählen —</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            )}
            </>}
            <div className="field-group">
              <div className="field-group-label">Beleg (Rechnungskopie)</div>
              {form.invoiceFile ? (
                <div className="row" style={{ alignItems: 'center' }}>
                  <a href={`/uploads/${form.invoiceFile}`} target="_blank" rel="noreferrer">
                    📎 {form.invoiceFile.replace(/^\d+_/, '')}
                  </a>
                  <button className="btn small ghost" onClick={() => setForm({ ...form, invoiceFile: undefined })}>
                    Zuordnung entfernen
                  </button>
                </div>
              ) : (
                <>
                  <label className="field grow">
                    neu hochladen
                    <input type="file" accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadInvoice(f) }} />
                  </label>
                  {knownFiles.length > 0 && (
                    <label className="field grow" style={{ marginTop: 8 }}>
                      oder vorhandenen Beleg zuordnen
                      <select value="" onChange={(e) => { if (e.target.value) setForm({ ...form, invoiceFile: e.target.value }) }}>
                        <option value="">— wählen —</option>
                        {knownFiles.map(([f, label]) => (
                          <option key={f} value={f}>{label} — {f.replace(/^\d+_/, '')}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
            </div>
          </div>
        </Drawer>
      )}
    </>
  )
}
