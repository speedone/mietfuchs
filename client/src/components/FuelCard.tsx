// Die Karte „Lieferungen“ einer Heizperiode (Heizung PR 7, Entwurf 3.2, 5.4, 11.4): die Rechnungen des
// Versorgers, die in dieser Heizperiode enden, und bei freien Schlüsseln die Verknüpfung der Positionen.
// Mietfuchs teilt jede Rechnung auf die Heizperioden auf; die Abrechnung zeigt, wie.
import { useState } from 'react'
import { api, errorText, fmtEuro } from '../api'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import { CO2_ENERGIES, GAS_BASIS_LABEL, GAS_BASIS_MISSING, gasBasisMissing, defaultGrade, deliveryLine, deliveryOptions, deliveryUnitId, emptyFuelForm, fuelBody, fuelToForm, GAS_BASIS_OPTIONS, gradeOptions, STOCK_QUANTITY_OPTIONS, stockFuelBody, unitWordFor, type FuelForm } from '../fuelForm'
import { isStockEnergy } from '../../../shared/fuelStock.ts'
import type { FuelDelivery, HeatingEnergy, HeatingMethod, HeatingPeriodView, HeatingPlant, Unit } from '../types'

type TextKey = Exclude<keyof FuelForm, 'usedByService' | 'quantityUnit' | 'unitId' | 'gasBasis' | 'grade'>

export default function FuelCard({ plant, view, deliveries, units = [], onSaved }: {
  plant: { id: string; method: HeatingMethod; energy?: HeatingEnergy } & Partial<Pick<HeatingPlant, 'supply' | 'units'>>
  view: HeatingPeriodView
  deliveries: FuelDelivery[]
  // Die Wohnungen des Objekts, für die Rechnung einer Etagenheizung (Heizung PR 9).
  units?: readonly Pick<Unit, 'id' | 'name'>[]
  onSaved: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<FuelForm>(emptyFuelForm)
  const [error, setError] = useState('')
  const toast = useToast()
  const confirm = useConfirm()
  const service = plant.method === 'service'
  // Heizöl, Flüssiggas, Pellets, Holz und Kohle (Heizung PR 8): Lieferdatum und Menge für den Vorrat.
  const stock = plant.energy !== undefined && isStockEnergy(plant.energy)
  const set = <K extends keyof FuelForm>(key: K, value: FuelForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const options = deliveryOptions(deliveries)
  // Beim Vorrat (Durchsicht von #237, M5): der Betrag aus den verknüpften Positionen dieser Heizperiode.
  const linkedText = (id: string): string => {
    const linked = view.items.filter((i) => i.fuelDeliveryId === id)
    return linked.length === 0 ? 'noch keine Position verknüpft' : `Betrag laut Position ${fmtEuro(linked.reduce((a, i) => a + i.amountCents, 0))}`
  }

  function open(d: FuelDelivery | null) {
    // Heizung PR 11: Die Zeile der Heizwerttabelle ist nur vorbelegt, wo es genau eine gibt.
    setForm(d ? fuelToForm(d) : { ...emptyFuelForm(), grade: plant.energy ? defaultGrade(plant.energy) : '' })
    setEditing(d ? d.id : 'neu')
    setError('')
  }

  async function save() {
    const unit = deliveryUnitId(form, { supply: plant.supply ?? 'central' })
    if ('error' in unit) {
      setError(unit.error)
      return
    }
    const r = stock ? stockFuelBody(form, plant.method) : fuelBody(form, plant.method)
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

  async function link(itemId: string, deliveryId: string) {
    try {
      await api(`/api/costItems/${itemId}`, { method: 'PUT', body: JSON.stringify({ fuelDeliveryId: deliveryId === '' ? null : deliveryId }) })
      setError('')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
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
            <label className="field" key={i.id}>
              {i.description}
              <select aria-label={`Lieferung zu „${i.description}“`} value={i.fuelDeliveryId ?? ''} disabled={view.closed} onChange={(e) => void link(i.id, options.find((o) => o.value === e.target.value)?.value ?? '')}>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
      {editing !== null && (
        <div className="field-group">
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
              {form.heatingValue.trim() === '' && plant.energy !== undefined && gradeOptions(plant.energy).length > 0 && (
                <label className="field">
                  Steht kein Heizwert auf der Rechnung: Brennstoff laut Heizkostenverordnung
                  <select value={form.grade} onChange={(e) => set('grade', gradeOptions(plant.energy ?? 'other').find((o) => o.value === e.target.value)?.value ?? '')}>
                    {(plant.energy ? gradeOptions(plant.energy) : []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
            {plant.energy === 'gas' && (<>
              <label className="field">
                {GAS_BASIS_LABEL}
                <select value={form.gasBasis} onChange={(e) => set('gasBasis', GAS_BASIS_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
                  {GAS_BASIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <small className="muted">Steht bei der Umrechnung von m³ in kWh „Brennwert“ auf der Rechnung, wählen Sie „nach Brennwert“. Für den <Term id="gasCalorificBasis">Warmwasseranteil nach einer Formel</Term> hängt der Faktor davon ab.</small>
              {gasBasisMissing(form, view) && <div className="notice">{GAS_BASIS_MISSING}</div>}
            </>)}
          </>)}
          {/* Bei Strom einer Wärmepumpe gibt es keine CO₂-Kosten aufzuteilen (§ 2 Abs. 1 CO2KostAufG). */}
          {(plant.energy === undefined || CO2_ENERGIES.includes(plant.energy)) && (
            <div className="row">
              {text('emissionsKg', 'CO₂-Ausstoß laut Rechnung (kg)')}
              {text('co2Cost', 'CO₂-Kosten laut Rechnung')}
            </div>
          )}
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
      {error && <div className="error">{error}</div>}
      {!view.closed && editing === null && <div className="row"><button className="btn" onClick={() => open(null)}>Lieferung eintragen</button></div>}
    </div>
  )
}
