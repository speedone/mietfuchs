// Die Karte „Lieferungen“ einer Heizperiode (Heizung PR 7, Entwurf 3.2, 5.4, 11.4): die Rechnungen des
// Versorgers, die in dieser Heizperiode enden, und bei freien Schlüsseln die Verknüpfung der Positionen.
// Mietfuchs teilt jede Rechnung auf die Heizperioden auf; die Abrechnung zeigt, wie.
import { useState } from 'react'
import { api, errorText, fmtEuro } from '../api'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import DraftActions from './DraftActions'
import { useDraft } from '../useDraft'
import { useOpenForm } from '../property'
import { asksCo2Facts, STOCK_BIO_ONLY_ZERO, GAS_BASIS_LABEL, GAS_BASIS_MISSING, gasBasisMissing, defaultGrade, deliveryLine, deliveryOptions, deliveryUnitId, emptyFuelForm, fuelBody, fuelToForm, GAS_BASIS_OPTIONS, gradeOptions, METERED_QUANTITY_OPTIONS, STOCK_QUANTITY_OPTIONS, stockFuelBody, unitWordFor, type FuelForm, type FuelPartForm } from '../fuelForm'
import { aiRequest, progressText, type AiProgress } from '../aiRequest'
import { heatingUpload } from '../aiUpload'
import { fuelChecks, fuelFormFromExtraction } from '../fuelImport'
import { CREDIT_ANSWERS, CREDIT_QUESTION, creditAction, creditOnlyOf, creditTargetOptions, emptyReassignForm, PAYMENT_GUIDE, reassignBody, RETURNED_HINT, RETURNED_QUESTION, STANDALONE_DONE, type CreditAnswer, type ReassignForm } from '../fuelCredit'
import { isStockEnergy } from '../../../shared/fuelStock.ts'
import { billingEnergy } from '../../../shared/heatDelivery.ts'
import { startYearOf } from '../../../shared/period.ts'
import type { FuelDelivery, FuelExtractResult, HeatingEnergy, HeatingMethod, HeatingPeriodView, HeatingPlant, Unit } from '../types'
import { ErrorSummary, useFormError } from './ErrorSummary'

type TextKey = Exclude<keyof FuelForm, 'usedByService' | 'quantityUnit' | 'unitId' | 'gasBasis' | 'grade' | 'parts'>

// Die Spalten einer Teilmenge laut Rechnung (Heizung PR 20).
const PART_FIELDS: readonly { key: keyof FuelPartForm; label: string }[] = [
  { key: 'from', label: 'von' }, { key: 'to', label: 'bis' }, { key: 'energyKwh', label: 'kWh' }, { key: 'amount', label: 'Betrag' },
  { key: 'fixed', label: 'davon fest' }, { key: 'emissionsKg', label: 'kg CO₂' }, { key: 'co2Cost', label: 'CO₂-Kosten' },
]
const EMPTY_PART: FuelPartForm = { from: '', to: '', energyKwh: '', amount: '', fixed: '', emissionsKg: '', co2Cost: '' }

export default function FuelCard({ plant, view, deliveries, allDeliveries, allItems, units = [], findings = {}, onSaved }: {
  plant: { id: string; method: HeatingMethod; energy?: HeatingEnergy } & Partial<Pick<HeatingPlant, 'supply' | 'units' | 'contracting' | 'heatGeneration' | 'gmodg43InstalledOn' | 'propertyId'>>
  view: HeatingPeriodView
  deliveries: FuelDelivery[]
  // #251: Alle Lieferungen der Anlage und alle Positionen mit Lieferung, für die Gutschrift ohne Rechnung (ihre Summe und
  // die Lieferung, die sie berichtigt, kann in einer anderen Heizperiode stehen). Fehlen sie, gelten die dieser.
  allDeliveries?: readonly FuelDelivery[]
  allItems?: readonly { fuelDeliveryId?: string | null; amountCents: number }[]
  // Die Wohnungen des Objekts, für die Rechnung einer Etagenheizung (Heizung PR 9).
  units?: readonly Pick<Unit, 'id' | 'name'>[]
  // Die Befunde der CO₂-Prüfung je Lieferung (Heizung PR 17, Durchsicht von #246, R-K7), aus dem Blatt für
  // den Messdienst, also aus derselben Prüfung wie die Abrechnung.
  findings?: Readonly<Record<string, readonly string[]>>
  onSaved: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  // Das Formular einer Lieferung (auch mit dem Vorschlag der KI) zählt als offenes Formular (#346, 7a).
  useOpenForm(editing !== null)
  const [form, setForm] = useState<FuelForm>(emptyFuelForm)
  // Fehler als Sammelmeldung oben in der Karte (#346, Schritt 3)
  const errors = useFormError()
  const setError = errors.set
  // Heizung PR 20: die Prüfungen einer mit der KI gelesenen Rechnung und der Fortschritt beim Lesen.
  const [checks, setChecks] = useState<string[]>([])
  const [reading, setReading] = useState<AiProgress | null | 'start'>(null)
  // #251: die offene Frage zu einer Gutschrift ohne Rechnung.
  const [credit, setCredit] = useState<{ id: string; answer: CreditAnswer } | null>(null)
  const [reassign, setReassign] = useState<ReassignForm>(emptyReassignForm)
  const toast = useToast()
  const confirm = useConfirm()
  const service = plant.method === 'service'
  // Heizöl, Flüssiggas, Pellets, Holz und Kohle (Heizung PR 8): Lieferdatum und Menge für den Vorrat.
  // Heizung PR 16: nach der Energie der Abrechnung; bei Contracting sind Lieferungen Wärmerechnungen.
  const energy = plant.energy === undefined ? undefined : billingEnergy({ energy: plant.energy, contracting: plant.contracting })
  const stock = energy !== undefined && isStockEnergy(energy)
  // Heizung PR 18: Netzentgelte und Biobrennstoff nur bei einer Heizung nach § 43 Abs. 1 GModG; Netzentgelte nur bei
  // der Belieferung mit Gas, bei Contracting nach dem Brennstoff des Lieferanten (`plant.energy`).
  const halfSplit = (plant.gmodg43InstalledOn ?? null) !== null
  const gasDelivered = plant.energy === 'gas'
  const set = <K extends keyof FuelForm>(key: K, value: FuelForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const options = deliveryOptions(deliveries)
  // Beim Vorrat (Durchsicht von #237, M5): der Betrag aus den verknüpften Positionen dieser Heizperiode.
  const linkedText = (id: string): string => {
    const linked = view.items.filter((i) => i.fuelDeliveryId === id)
    return linked.length === 0 ? 'noch keine Position verknüpft' : `Betrag laut Position ${fmtEuro(linked.reduce((a, i) => a + i.amountCents, 0))}`
  }

  function open(d: FuelDelivery | null) {
    // Heizung PR 11: Die Zeile der Heizwerttabelle ist nur vorbelegt, wo es genau eine gibt.
    setForm(d ? fuelToForm(d) : { ...emptyFuelForm(), grade: energy ? defaultGrade(energy) : '' })
    setEditing(d ? d.id : 'neu')
    setChecks([])
    setError('')
  }

  // Heizung PR 20 (#103): Die KI liest die Rechnung, das Formular einer neuen Lieferung ist damit vorbelegt;
  // gespeichert wird erst mit „Lieferung speichern“. Der Beleg liegt mit Objekt und Jahr im Belegordner.
  async function readInvoice(file: File) {
    setReading('start')
    setError('')
    try {
      const fd = plant.propertyId ? await heatingUpload(file, { propertyId: plant.propertyId, year: startYearOf(view.period) }) : await heatingUpload(file, null)
      const r = await aiRequest<FuelExtractResult>(`/api/heating-plants/${plant.id}/fuel-invoice`, fd, { onProgress: setReading })
      // Durchsicht S1: nur vorbelegen, was die Karte unten zeigt (CO₂-Felder, Bezug der kWh bei Gas).
      const co2 = plant.energy === undefined || asksCo2Facts({ energy: plant.energy, contracting: plant.contracting, heatGeneration: plant.heatGeneration ?? null })
      const place = { method: plant.method, stock, halfSplit, co2, gas: !stock && energy === 'gas' }
      setForm(fuelFormFromExtraction(r.extraction, { ...emptyFuelForm(), grade: energy ? defaultGrade(energy) : '' }, place))
      setChecks(fuelChecks(r.extraction, place))
      setEditing('neu')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setReading(null)
    }
  }

  async function save() {
    const unit = deliveryUnitId(form, { supply: plant.supply ?? 'central' })
    if ('error' in unit) {
      setError(unit.error)
      return
    }
    const r = stock ? stockFuelBody(form, plant.method, { halfSplit }) : fuelBody(form, plant.method, { halfSplit })
    if ('error' in r) {
      setError(r.error)
      return
    }
    // Die Wohnung nur bei einer Etagenheizung; sonst bleibt der Rumpf, wie er war.
    const body = plant.supply === 'perUnit' ? { ...r.body, unitId: unit.unitId } : r.body
    try {
      if (editing === 'neu') await api(`/api/heating-plants/${plant.id}/deliveries`, { method: 'POST', body: JSON.stringify(body) })
      else await api(`/api/fuel-deliveries/${editing}`, { method: 'PUT', body: JSON.stringify(body) })
      setEditing(null)
      setError('')
      toast('Lieferung gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function remove(d: FuelDelivery) {
    const ok = await confirm({
      title: 'Lieferung entfernen?',
      message: d.estimated ? 'Die Schätzung entfällt; die Abrechnung rechnet ohne sie.' : 'Verknüpfte Positionen bleiben stehen und werden dann ohne Abgrenzung verteilt.',
      confirmLabel: 'Entfernen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/fuel-deliveries/${d.id}`, { method: 'DELETE' })
      toast('Lieferung entfernt.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }


  const itemsForCredit = allItems ?? view.items
  const credits = new Map(creditOnlyOf(deliveries, itemsForCredit).map((c) => [c.delivery.id, c.cents]))

  async function answer(d: FuelDelivery, value: CreditAnswer) {
    setCredit({ id: d.id, answer: value })
    setReassign(emptyReassignForm())
    setError('')
    const action = creditAction(value, d)
    if (action.kind !== 'save') return
    try {
      await api(action.url, { method: 'PUT', body: JSON.stringify(action.body) })
      toast('Angabe gespeichert.')
      setCredit(null)
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function assign(d: FuelDelivery) {
    const r = reassignBody(reassign)
    if ('error' in r) {
      setError(r.error)
      return
    }
    try {
      const result = await api<{ sourceEmpty: boolean }>(`/api/fuel-deliveries/${d.id}/reassign-credit`, { method: 'POST', body: JSON.stringify(r.body) })
      setCredit(null)
      setError('')
      toast('Gutschrift zugeordnet.')
      if (result?.sourceEmpty) {
        const ok = await confirm({
          title: 'Leere Lieferung entfernen?',
          message: `An der Lieferung „${d.label || 'Lieferung'}“ hängt keine Position mehr.`,
          confirmLabel: 'Entfernen',
          defaultChoice: 'cancel',
        })
        if (ok) await api(`/api/fuel-deliveries/${d.id}`, { method: 'DELETE' })
      }
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const creditBlock = (d: FuelDelivery, cents: number) => {
    const name = `„${d.label || 'Lieferung'}“`
    const open = credit?.id === d.id ? credit.answer : null
    const targets = creditTargetOptions(d, allDeliveries ?? deliveries, itemsForCredit)
    return (
      <div className="field-group">
        <div className="field-group-label">
          Die Positionen ergeben zusammen {fmtEuro(cents)}: eine <Term id="fuelDelivery">Gutschrift ohne Rechnung</Term>. <strong>{CREDIT_QUESTION}</strong>
        </div>
        {d.creditNoteKind === 'standalone' && <p className="muted">{STANDALONE_DONE}</p>}
        <span className="row">
          {CREDIT_ANSWERS.map((a) => (
            <button key={a.value} className={open === a.value ? 'btn' : 'btn secondary'} onClick={() => void answer(d, a.value)}>{a.label}</button>
          ))}
        </span>
        {open === 'payment' && <p className="hint">{PAYMENT_GUIDE}</p>}
        {open === 'reassign' && (<>
          <label className="field grow">
            Lieferung, die die Gutschrift berichtigt
            <select aria-label={`Lieferung, die die Gutschrift ${name} berichtigt`} value={reassign.targetId} onChange={(e) => setReassign((f) => ({ ...f, targetId: targets.find((o) => o.value === e.target.value)?.value ?? '' }))}>
              {targets.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="checkline">
            <input type="checkbox" checked={reassign.returned} onChange={(e) => setReassign((f) => ({ ...f, returned: e.target.checked }))} />
            {RETURNED_QUESTION}
          </label>
          <small className="muted">{RETURNED_HINT}</small>
          {reassign.returned && (
            <div className="row">
              <label className="field">Menge der Rechnung, berichtigt<input aria-label="Menge der Rechnung, berichtigt" inputMode="decimal" value={reassign.quantity} onChange={(e) => setReassign((f) => ({ ...f, quantity: e.target.value }))} /></label>
              <label className="field">CO₂-Ausstoß, berichtigt (kg)<input aria-label="CO₂-Ausstoß, berichtigt (kg)" inputMode="decimal" value={reassign.emissionsKg} onChange={(e) => setReassign((f) => ({ ...f, emissionsKg: e.target.value }))} /></label>
              <label className="field">CO₂-Kosten, berichtigt<input aria-label="CO₂-Kosten, berichtigt" inputMode="decimal" value={reassign.co2Cost} onChange={(e) => setReassign((f) => ({ ...f, co2Cost: e.target.value }))} /></label>
            </div>
          )}
          <div className="row">
            <button className="btn" onClick={() => void assign(d)}>Zuordnen</button>
            <button className="btn secondary" onClick={() => setCredit(null)}>Abbrechen</button>
          </div>
        </>)}
      </div>
    )
  }

  const text = (key: TextKey, label: string, mode: 'decimal' | 'text' = 'decimal') => (
    <label className="field">
      {label}
      <input aria-label={label} value={form[key]} inputMode={mode === 'decimal' ? 'decimal' : undefined} type={key === 'invoiceFrom' || key === 'invoiceTo' || key === 'deliveredAt' || key === 'invoiceDate' ? 'date' : 'text'} onChange={(e) => set(key, e.target.value)} />
    </label>
  )

  return (
    <div className="card">
      <h2><Term id="accrualPrinciple">Lieferungen</Term></h2>
      <ErrorSummary errors={errors} />
      {stock ? (
        <p className="muted">
          Tragen Sie jede Lieferung mit Lieferdatum und Menge ein, wie auf der Rechnung. Was davon in dieser Heizperiode verbraucht wurde,
          ergibt die Karte „Vorrat“ aus Anfangs- und Endbestand (<Term id="fuelStock">Bestandsrechnung</Term>).
          {!service && ' Den Betrag nimmt Mietfuchs aus der verknüpften Kostenposition; ohne Verknüpfung geht die Bestandsrechnung nicht auf.'}
        </p>
      ) : (
        <p className="muted">
          Tragen Sie jede Rechnung Ihres Versorgers mit ihrem Rechnungszeitraum ein. Reicht sie über die Heizperiode hinaus, teilt Mietfuchs sie
          auf: nach einem Zählerstand zum Stichtag, nach Teilmengen der Rechnung oder nach <Term id="degreeDays">Gradtagen</Term>.
        </p>
      )}
      {plant.supply === 'perUnit' && (
        <p className="muted">
          Etagenheizung: Tragen Sie die Rechnung jeder Wohnung mit ihrer Wohnung ein. Nennt eine Sammelrechnung mehrere Zählpunkte, tragen
          Sie für jede Wohnung eine eigene Lieferung mit ihrem Teil ein. Beim Mieterwechsel teilt Mietfuchs die Rechnung der Wohnung nach
          Tagen auf die Mieter auf, nicht nach einem Zwischenstand des Gaszählers.
        </p>
      )}
      {deliveries.length === 0 && <p className="muted">{stock ? 'Noch keine Lieferung in dieser Heizperiode.' : 'Noch keine Lieferung, die in dieser Heizperiode endet.'}</p>}
      <ul className="plain">
        {deliveries.map((d) => (
          <li key={d.id}>
            <strong>{d.label || 'Lieferung'}</strong> {deliveryLine(d)}
            {stock && !service && <span className="muted"> · {linkedText(d.id)}</span>}
            {(findings[d.id] ?? []).map((f) => <p key={f} className="hint">{f}</p>)}
            {!view.closed && !service && credits.has(d.id) && creditBlock(d, credits.get(d.id) ?? 0)}
            {!view.closed && (
              <span className="row">
                <button className="btn secondary" onClick={() => open(d)}>Ändern</button>
                <button className="btn ghost danger-ghost" onClick={() => void remove(d)}>Entfernen</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {!service && view.items.length > 0 && (
        <div className="field-group">
          <div className="field-group-label">Welche Position gehört zu welcher Rechnung? Abschläge, Schlussrechnung und Gutschrift einer Rechnung gehören zur selben Lieferung. Ohne Verknüpfung grenzt Mietfuchs nichts ab und verteilt die Position ganz in ihrem Zeitraum.</div>
          {view.items.map((i) => (
            <LinkRow key={i.id} item={i} options={options} closed={view.closed} onSaved={onSaved} />
          ))}
        </div>
      )}
      {editing !== null && (
        <div className="field-group">
          {checks.length > 0 && <ul className="notice">{checks.map((c) => <li key={c}>{c}</li>)}</ul>}
          {plant.supply === 'perUnit' && (
            <label className="field grow">
              Wohnung
              <select value={form.unitId} onChange={(e) => set('unitId', e.target.value)}>
                <option value="">— bitte wählen —</option>
                {units.filter((u) => !plant.units || plant.units.some((x) => x.unitId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          )}
          {text('label', 'Bezeichnung', 'text')}
          {stock ? (<>
            <div className="row">
              {text('deliveredAt', 'Lieferdatum')}
              {text('invoiceDate', 'Rechnungsdatum (leer: Lieferdatum)')}
            </div>
            <div className="row">
              {text('quantity', 'Menge')}
              <label className="field">
                Einheit
                <select aria-label="Einheit der Menge" value={form.quantityUnit} onChange={(e) => set('quantityUnit', STOCK_QUANTITY_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
                  {STOCK_QUANTITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              {service && text('amount', 'Rechnungsbetrag')}
            </div>
            {/* Heizung PR 11: für den Warmwasseranteil der Heizwert laut Rechnung, sonst die Zeile der Tabelle (§ 9 Abs. 3 HeizkostenV). */}
            <div className="row">
              {text('heatingValue', `Heizwert laut Rechnung (kWh je ${unitWordFor(form.quantityUnit)})`)}
              {form.heatingValue.trim() === '' && energy !== undefined && gradeOptions(energy).length > 0 && (
                <label className="field">
                  Steht kein Heizwert auf der Rechnung: Brennstoff laut Heizkostenverordnung
                  <select value={form.grade} onChange={(e) => set('grade', gradeOptions(energy ?? 'other').find((o) => o.value === e.target.value)?.value ?? '')}>
                    {(energy ? gradeOptions(energy) : []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          </>) : (<>
            <div className="row">
              {text('invoiceFrom', 'Rechnungszeitraum von')}
              {text('invoiceTo', 'bis')}
            </div>
            <div className="row">
              {service && text('amount', 'Rechnungsbetrag')}
              {text('fixed', 'davon fester Preisbestandteil (Grund-, Mess-, Verrechnungspreis)')}
              {text('energyKwh', 'Energie (kWh)')}
            </div>
            {/* Heizung PR 20: die Menge laut Rechnung, wie sie auf dem Beleg steht. */}
            <div className="row">
              {text('quantity', 'Menge')}
              <label className="field">
                Einheit
                <select aria-label="Einheit der Menge laut Rechnung" value={form.quantityUnit} onChange={(e) => set('quantityUnit', METERED_QUANTITY_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
                  {METERED_QUANTITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
            {energy === 'gas' && (<>
              <label className="field">
                {GAS_BASIS_LABEL}
                <select aria-label={GAS_BASIS_LABEL} value={form.gasBasis} onChange={(e) => set('gasBasis', GAS_BASIS_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
                  {GAS_BASIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <small className="muted">Steht bei der Umrechnung von m³ in kWh „Brennwert“ auf der Rechnung, wählen Sie „nach Brennwert“. Für den <Term id="gasCalorificBasis">Warmwasseranteil nach einer Formel</Term> hängt der Faktor davon ab.</small>
              {gasBasisMissing(form, view) && <div className="notice">{GAS_BASIS_MISSING}</div>}
            </>)}
          </>)}
          {/* Bei Strom einer Wärmepumpe gibt es keine CO₂-Kosten aufzuteilen (§ 2 Abs. 1 CO2KostAufG). */}
          {(plant.energy === undefined || asksCo2Facts({ energy: plant.energy, contracting: plant.contracting, heatGeneration: plant.heatGeneration ?? null })) && (
            <div className="row">
              {text('emissionsKg', 'CO₂-Ausstoß laut Rechnung (kg)')}
              {text('co2Cost', 'CO₂-Kosten laut Rechnung')}
              {text('emissionFactor', 'Emissionsfaktor laut Rechnung (kg CO₂ je kWh)')}
            </div>
          )}
          {/* Heizung PR 20: Teilmengen laut Rechnung (Stufe 3), etwa bei einer Preisänderung; nicht beim Vorrat. */}
          {!stock && (
            <div className="field-group">
              <div className="field-group-label">Teilmengen laut Rechnung, wenn die Rechnung Teilzeiträume mit eigener Menge und eigenem Betrag ausweist</div>
              {form.parts.map((p, i) => (
                <div className="row" key={i}>
                  {PART_FIELDS.map((f) => (
                    <label className="field" key={f.key}>
                      {f.label}
                      <input
                        aria-label={`Teilmenge ${i + 1}: ${f.label}`}
                        type={f.key === 'from' || f.key === 'to' ? 'date' : 'text'}
                        inputMode={f.key === 'from' || f.key === 'to' ? undefined : 'decimal'}
                        value={p[f.key]}
                        onChange={(e) => set('parts', form.parts.map((q, j) => (j === i ? { ...q, [f.key]: e.target.value } : q)))}
                      />
                    </label>
                  ))}
                  <button className="btn ghost" type="button" onClick={() => set('parts', form.parts.filter((_, j) => j !== i))}>Teilmenge entfernen</button>
                </div>
              ))}
              <div className="row"><button className="btn secondary" type="button" onClick={() => set('parts', [...form.parts, EMPTY_PART])}>Teilmenge hinzufügen</button></div>
            </div>
          )}
          {halfSplit && (
            <div className="row">
              {!stock && gasDelivered && text('gridFee', 'Netzentgelte laut Rechnung (€, ohne Entgelte des Messstellenbetreibers; § 40 Abs. 3 Nr. 4 EnWG)')}
              {text('bioCost', 'Biobrennstoff, Preisbestandteil nach § 3 Abs. 1 Nr. 6 CO2KostAufG (€)')}
            </div>
          )}
          {halfSplit && stock && <small className="muted">Bei Brennstoff aus dem Tank nur 0, wenn die Lieferung keinen Pflichtanteil an Biobrennstoff enthält. {STOCK_BIO_ONLY_ZERO}</small>}
          {!stock && (
            <details className="extra-details">
              <summary>Weitere Angaben</summary>
              {text('sharePercent', 'Anteil dieser Heizperiode am Verbrauch (%), wenn bekannt')}
            </details>
          )}
          {service && (
            <label className="checkline">
              <input type="checkbox" checked={form.usedByService} onChange={(e) => set('usedByService', e.target.checked)} />
              vom Messdienst angesetzt
            </label>
          )}
          <div className="row">
            <button className="btn" onClick={() => void save()}>Lieferung speichern</button>
            <button className="btn secondary" onClick={() => setEditing(null)}>Abbrechen</button>
          </div>
        </div>
      )}
      {!view.closed && editing === null && (
        <div className="row">
          <button className="btn" onClick={() => open(null)}>Lieferung eintragen</button>
          {reading === null ? (
            <label className="btn secondary">
              Rechnung mit KI auslesen
              <input type="file" className="sr-only" aria-label="Rechnung mit KI auslesen" accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readInvoice(f) }} />
            </label>
          ) : <span className="muted">{progressText(reading === 'start' ? null : reading)}</span>}
        </div>
      )}
    </div>
  )
}

// Die Verknüpfung einer Position mit ihrer Lieferung (#309): ein Entwurf an der Zeile, erst „Speichern“ schickt
// ihn an die Position, danach lädt die Seite neu. Ein Fehler steht an der Zeile.
function LinkRow({ item, options, closed, onSaved }: {
  item: { id: string; description: string; fuelDeliveryId?: string | null }
  options: readonly { value: string; label: string }[]
  closed: boolean
  onSaved: () => void
}) {
  // Verschwindet die gewählte Lieferung aus der Liste, ist der Entwurf verworfen (Durchsicht zu #309, MUSS 2).
  const draft = useDraft(item.fuelDeliveryId ?? '', { scope: item.id, isValid: (v) => options.some((o) => o.value === v) })
  const what = `Lieferung zu „${item.description}“`
  async function link(deliveryId: string) {
    await api(`/api/costItems/${item.id}`, { method: 'PUT', body: JSON.stringify({ fuelDeliveryId: deliveryId === '' ? null : deliveryId }) })
    onSaved()
  }
  return (
    <div className="row center">
      <label className="field">
        {item.description}
        <select aria-label={what} value={draft.value} disabled={closed || draft.saving} onChange={(e) => draft.set(options.find((o) => o.value === e.target.value)?.value ?? '')}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <DraftActions draft={draft} onSave={link} what={what} />
    </div>
  )
}
