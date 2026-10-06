import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssignableHeatingItem, DevicesInstalledAfter, DevicesRemote, HeatingEnergy, HeatingPlant, NewDevicesInstall, Unit } from '../types'
import { api, errorText, fmtEuro } from '../api'
import { useProperty, withProperty } from '../property'
import { periodLabel, periodOfKey, rulesOf } from '../../../shared/period.ts'
import { useConfirm, useToast } from './feedback'
import Drawer from './Drawer'
import Term from './Term'
import HeatingPeriodSection from './HeatingPeriodSection'
import { useFocusTarget, type FocusProps } from '../focus'
import {
  CAPTURE_OPTIONS, CONTRACT_OPTIONS, ENERGY_OPTIONS, HOW_TO_TELL, asksRemote, INSTALLED_OPTIONS, NEW_DEVICES_AFTER, NEW_INSTALL_OPTIONS, NEW_INSTALL_QUESTION, PER_UNIT_ENERGY_OPTIONS, REMOTE_OPTIONS, asksNewInstall, buildingOptions, canSwap, emptyHeatingForm, emptySwapForm, heatingPlantBody,
  connectionNote, heatingSummary, heatingToForm, swapBody, whoHint, whoOptions, type CaptureAnswer, type EnergyAnswer, type HeatingForm, type PerUnitContract, type SwapForm, type WhoSettles,
} from '../heatingForm'

// Die Karte „Heizung“ in den Stammdaten (Heizung PR 4, Entwurf 11.2). Ohne Anlage ein Satz und der
// Knopf „Heizung einrichten“; nichts davon ist Pflicht, und an keiner Zahl ändert sich etwas (11.1).
// Beim Anlegen zeigt die Einrichtung, welche Heizpositionen zur Anlage kommen (Vorschau, 3.0); der
// Server nimmt genau diese, oder er lehnt ab, wenn sich die Liste inzwischen geändert hat.
// `onChanged` (Laienprobe B1): Die Seite lädt danach Mietverhältnisse und Anlagen neu, denn das
// Aufteilen der Vorauszahlung und das Umschlüsseln ändern Daten außerhalb dieser Karte.
export default function HeatingCard({ units, focus, onFocusDone, onChanged }: { units: Unit[]; onChanged?: () => Promise<void> } & FocusProps) {
  const { property } = useProperty()
  const propertyId = property?.id
  const toast = useToast()
  const confirm = useConfirm()
  const [plants, setPlants] = useState<HeatingPlant[]>([])
  const [form, setForm] = useState<HeatingForm | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [assignable, setAssignable] = useState<AssignableHeatingItem[]>([])
  const [error, setError] = useState('')
  // Kessel getauscht (Heizung PR 9): die Anlage, die endet, und die Angaben zur neuen.
  const [swap, setSwap] = useState<{ plant: HeatingPlant; form: SwapForm } | null>(null)
  // „Hier beheben →“ an einem Hinweis zur Heizanlage (Heizung PR 5): die Karte ins Bild holen.
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTarget(focus, 'heatingPlant', plants, (p) => p.id, () => cardRef.current?.scrollIntoView?.({ block: 'start' }), onFocusDone)

  const load = useCallback(async () => {
    setPlants(await api<HeatingPlant[]>(withProperty('/api/heating-plants', propertyId)))
  }, [propertyId])
  const loadAll = useCallback(async () => {
    await load()
    await onChanged?.()
  }, [load, onChanged])

  useEffect(() => {
    load().catch((e) => setError(errorText(e)))
  }, [load])

  async function openNew() {
    setError('')
    // Die Vorschau der Zuordnung gilt nur für die erste Anlage: Bei einer weiteren ordnet der Vermieter
    // jede Position selbst zu (Heizung PR 9), denn sonst kämen alle losen Positionen zur neuen.
    if (plants.length === 0) {
      try {
        setAssignable(await api<AssignableHeatingItem[]>(withProperty('/api/heating-plants/assignable', propertyId)))
      } catch (e) {
        setError(errorText(e))
        return
      }
    } else {
      setAssignable([])
    }
    setEditingId(null)
    setForm(emptyHeatingForm(units, plants))
  }

  function openEdit(p: HeatingPlant) {
    setError('')
    setAssignable([])
    setEditingId(p.id)
    setForm(heatingToForm(p, units))
  }

  function close() {
    setError('')
    setForm(null)
  }

  async function save() {
    if (!form) return
    const others = plants.filter((p) => p.id !== editingId)
    const result = heatingPlantBody(form, units, others, editingId)
    if ('error' in result) {
      setError(result.error)
      return
    }
    if ('none' in result) {
      close()
      toast(result.none)
      return
    }
    try {
      if (editingId) {
        await api(`/api/heating-plants/${editingId}`, { method: 'PUT', body: JSON.stringify(result.body) })
      } else {
        await api(withProperty('/api/heating-plants', propertyId), {
          method: 'POST',
          body: JSON.stringify({ ...result.body, adjust: result.adjust, assignItemIds: assignable.map((i) => i.id) }),
        })
      }
    } catch (e) {
      setError(errorText(e))
      return
    }
    const created = editingId === null
    const first = plants.length === 0
    close()
    await loadAll()
    toast(created ? (first ? 'Heizung eingerichtet. An Ihren Beträgen ändert sich nichts.' : 'Weitere Heizanlage angelegt. Ordnen Sie ihre Heizpositionen auf der Seite Kosten zu.') : 'Heizung gespeichert.')
  }

  function openSwap(p: HeatingPlant) {
    setError('')
    setSwap({ plant: p, form: emptySwapForm(p) })
  }

  async function saveSwap() {
    if (!swap) return
    const result = swapBody(swap.form)
    if ('error' in result) {
      setError(result.error)
      return
    }
    try {
      await api(`/api/heating-plants/${swap.plant.id}/replace`, { method: 'POST', body: JSON.stringify({ ...result.body, method: swap.plant.method, source: swap.plant.source }) })
    } catch (e) {
      setError(errorText(e))
      return
    }
    setError('')
    setSwap(null)
    await loadAll()
    toast('Heizung erneuert. Tragen Sie bei der bisherigen Heizung den Endbestand zum letzten Betriebstag ein, wenn noch Brennstoff im Tank ist.')
  }

  async function remove(p: HeatingPlant) {
    const ok = await confirm({
      title: 'Heizanlage entfernen?',
      message: 'Die Heizpositionen bleiben, wie sie sind, nur ohne Heizanlage. Zähler der Anlage lösen Sie vorher auf der Seite Zähler.',
      confirmLabel: 'Entfernen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/heating-plants/${p.id}`, { method: 'DELETE' })
    } catch (e) {
      setError(errorText(e))
      return
    }
    setError('')
    await loadAll()
    toast('Heizanlage entfernt.')
  }

  const kind = property?.kind ?? 'mfh'
  // Welche Wohnungen an der Anlage hängen, bei zentraler Heizung wie bei der Etagenheizung (Heizung PR 9).
  const unitChoice = form && (
    <fieldset className="field grow no-connection">
      <legend className="field-legend">Welche Wohnungen hängen an dieser Heizung?</legend>
      <div className="checks">
        {units.map((u) => (
          <label key={u.id} className="checkline">
            <input
              type="checkbox"
              checked={form.unitIds.includes(u.id)}
              onChange={(e) => setForm({ ...form, unitIds: e.target.checked ? [...form.unitIds, u.id] : form.unitIds.filter((id) => id !== u.id) })}
            />
            {u.name}
            {connectionNote(u) && <small className="muted"> ({connectionNote(u)})</small>}
          </label>
        ))}
      </div>
      <small className="muted">{form.energy === 'perUnit' ? HOW_TO_TELL.unitsPerUnit : HOW_TO_TELL.units}</small>
    </fieldset>
  )
  const periodText = (key: AssignableHeatingItem['period']): string => {
    const p = periodOfKey(rulesOf(property), key)
    return p ? periodLabel(p) : key
  }

  return (
    <div className="card" ref={cardRef}>
      <h2><Term id="heatingSystem">Heizung</Term></h2>
      {error && !form && !swap && <div className="error">{error}</div>}
      {plants.length === 0 && (
        <>
          <p className="muted">
            Optional. Wenn Sie hier angeben, womit geheizt wird und wer abrechnet, sagt die Abrechnung, ob Mieter wegen nicht
            fernablesbarer Geräte kürzen dürfen. An Ihren Beträgen ändert sich dadurch nichts.
          </p>
          <button className="btn secondary" onClick={openNew}>Heizung einrichten</button>
        </>
      )}
      {plants.map((p) => (
        // Sichtprüfung E5: eine Liste mit allen Angaben der Anlage, darunter eine Zeile mit allen Aktionen
        <div key={p.id} className="stack heating-plant">
          <ul className="facts">{heatingSummary(p, units, plants).map((line) => <li key={line}>{line}</li>)}</ul>
          <HeatingPeriodSection
            plant={p}
            objectRules={rulesOf(property)}
            hasCalendarData={assignable.length > 0 || units.length > 0}
            onChanged={loadAll}
            notify={toast}
            actions={<>
              <button className="btn secondary" onClick={() => openEdit(p)}>Ändern</button>
              {canSwap(p) && <button className="btn secondary" onClick={() => openSwap(p)}>Heizung erneuert (Kessel getauscht)</button>}
            </>}
            dangerAction={<button className="btn ghost danger-ghost" onClick={() => remove(p)}>Entfernen</button>}
          />
        </div>
      ))}
      {plants.length > 0 && (
        <button className="btn secondary" onClick={openNew}>+ weitere Heizanlage</button>
      )}
      {form && (
        <Drawer
          open
          title={editingId ? 'Heizung ändern' : 'Heizung einrichten'}
          onClose={close}
          onSubmit={save}
          footer={
            <>
              <span className="drawer-hint">Strg+S speichert · Esc schließt</span>
              <span className="spacer" />
              <button className="btn ghost" onClick={close}>Abbrechen</button>
              <button className="btn" onClick={save}>{editingId ? 'Übernehmen' : 'Anlegen'}</button>
            </>
          }
        >
          {error && <div className="error">{error}</div>}
          {plants.length > (editingId ? 1 : 0) && (
            <label className="field grow">
              {editingId ? 'Name der Heizanlage' : 'Name der neuen Heizanlage'}
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="etwa „Haus B“ oder „Gastherme DG“" />
            </label>
          )}
          {!editingId && Object.keys(form.otherNames).length > 0 && (
            <>
              <p className="muted">
                Bei mehreren Heizanlagen braucht jede einen Namen und ihre Wohnungen. Die bisherige Heizanlage behält die Wohnungen, die Sie unten
                nicht für die neue anhaken.
              </p>
              {Object.entries(form.otherNames).map(([id, value]) => (
                <label key={id} className="field grow">
                  Name der bisherigen Heizanlage
                  <input value={value} onChange={(e) => setForm({ ...form, otherNames: { ...form.otherNames, [id]: e.target.value } })} placeholder="etwa „Zentralheizung“" />
                </label>
              ))}
            </>
          )}
          {(editingId ? plants.length > 1 : plants.some((p) => p.endsOn === null)) && (
            <label className="field grow">
              {editingId ? 'Steht diese Heizanlage im selben Gebäude wie eine andere?' : 'Steht die neue Heizanlage im selben Gebäude wie eine bisherige?'}
              <select value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })}>
                <option value="">— bitte wählen —</option>
                {buildingOptions(plants.filter((p) => p.id !== editingId), form.otherNames).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <small className="muted">Im selben Gebäude stuft Mietfuchs die Anlagen für die CO₂-Aufteilung gemeinsam ein, über den Ausstoß aller Anlagen und die Wohnfläche aller versorgten Wohnungen (§ 5 Abs. 1 CO2KostAufG); das ist eine Auslegung.</small>
            </label>
          )}
          <label className="field grow">
            Womit wird geheizt?
            <select value={form.energy} onChange={(e) => setForm({ ...form, energy: e.target.value as EnergyAnswer | '' })}>
              <option value="">— bitte wählen —</option>
              {ENERGY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <small className="muted">{HOW_TO_TELL.energy}</small>
          {form.energy === 'perUnit' ? (
            <>
              <label className="field grow">
                Wer hat den Vertrag für die Heizung in der Wohnung?
                <select value={form.contract} onChange={(e) => setForm({ ...form, contract: e.target.value as PerUnitContract })}>
                  <option value="">— bitte wählen —</option>
                  {CONTRACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              {form.contract === 'landlord' && (
                <>
                  <label className="field grow">
                    Womit heizen die Etagenheizungen?
                    <select value={form.perUnitEnergy} onChange={(e) => setForm({ ...form, perUnitEnergy: e.target.value as HeatingEnergy | '' })}>
                      <option value="">— bitte wählen —</option>
                      {PER_UNIT_ENERGY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                  <label className="checkline">
                    <input type="checkbox" checked={form.ownMeters} onChange={(e) => setForm({ ...form, ownMeters: e.target.checked })} />
                    Jede dieser Wohnungen hat einen eigenen Gaszähler mit eigener Rechnung
                  </label>
                  <p className="muted">
                    Ordnen Sie die Rechnung jeder Wohnung auf der Seite Kosten direkt dieser Wohnung zu, mit der Kostenart „Heizung und
                    Warmwasser“, und tragen Sie die Rechnung auf der Seite Heizkosten mit ihrer Wohnung ein. Für die CO₂-Aufteilung zählt die
                    Wohnfläche der vermieteten Wohnungen mit eigener Heizung (§ 5 Abs. 1 Satz 2 CO2KostAufG). Für eine{' '}
                    <Term id="perUnitHeating">Etagenheizung</Term> gilt die Heizkostenverordnung nicht; ob Sie die Gaskosten umlegen dürfen, hängt an Ihrem Mietvertrag.
                  </p>
                  {unitChoice}
                </>
              )}
            </>
          ) : (
            <>
              <label className="field grow">
                Wer erstellt Ihre Heizkostenabrechnung?
                <select value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value as WhoSettles })}>
                  <option value="">— bitte wählen —</option>
                  {whoOptions(kind).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <small className="muted">{HOW_TO_TELL.who}</small>
              {whoHint(form.who, kind) && <p className="muted">{whoHint(form.who, kind)}</p>}
              {unitChoice}
              {asksRemote(form.who) && (<>
              <label className="field grow">
                Sind die Zähler und Heizkostenverteiler aus der Ferne ablesbar?
                <select value={form.remote} onChange={(e) => setForm({ ...form, remote: e.target.value as DevicesRemote })}>
                  {REMOTE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <small className="muted">Woran erkenne ich das? Fernablesbare Geräte liest der Messdienst per Funk ab, ohne die Wohnungen zu betreten. Im Zweifel fragen Sie Ihren Messdienst.</small>
              <label className="field grow">
                {`Wurden sie nach dem ${NEW_DEVICES_AFTER} eingebaut?`}
                <select value={form.installedAfter} onChange={(e) => setForm({ ...form, installedAfter: e.target.value as DevicesInstalledAfter })}>
                  {INSTALLED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              {asksNewInstall(form) && (
                <label className="field grow">
                  {NEW_INSTALL_QUESTION}
                  <select value={form.newInstall} onChange={(e) => setForm({ ...form, newInstall: e.target.value as NewDevicesInstall | '' })}>
                    {NEW_INSTALL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
              {asksNewInstall(form) && (
                <small className="muted">{`Nach dem ${NEW_DEVICES_AFTER} einzeln als Ersatz oder Ergänzung in ein bestehendes System eingebaut: Die Pflicht zur Fernablesbarkeit gilt dann erst mit der Frist für ältere Geräte. Als Ganzes neu installiert: schon ab dem Einbau. Im Zweifel fragen Sie Ihren Messdienst.`}</small>
              )}
              </>)}
              {form.energy === 'heatPump' && (
                <>
                  <label className="field grow">
                    Wurde der Verbrauch der Wärmepumpe am 01.10.2024 schon erfasst?
                    <select value={form.captured} onChange={(e) => setForm({ ...form, captured: e.target.value as CaptureAnswer })}>
                      {CAPTURE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                  {form.captured === 'no' && (
                    <label className="field grow">
                      Seit wann wird er erfasst?
                      <input type="date" value={form.captureInstalledOn} onChange={(e) => setForm({ ...form, captureInstalledOn: e.target.value })} />
                    </label>
                  )}
                  <label className="field grow">
                    Nur bei Warmmiete ohne Abrechnung: durchschnittliche Heizkosten 2022 bis 2024 (€ im Jahr)
                    <input inputMode="decimal" value={form.warmRentAverage} onChange={(e) => setForm({ ...form, warmRentAverage: e.target.value })} />
                    <small className="muted">Bei einer Bruttowarmmiete bestimmt § 12 Abs. 3 HeizkostenV, wie diese Kosten zu ermitteln sind. Mietfuchs rechnet damit in einer späteren Version; tragen Sie den Betrag ein, sobald Sie ihn kennen.</small>
                  </label>
                </>
              )}
              {!editingId && <p className="muted">{HOW_TO_TELL.after}</p>}
              {!editingId && assignable.length > 0 && (
                <div className="muted">
                  {assignable.length === 1 ? 'Diese Heizposition kommt zur Anlage' : `Diese ${assignable.length} Heizpositionen kommen zur Anlage`}; an den Beträgen ändert sich nichts:
                  <ul>{assignable.map((i) => <li key={i.id}>{periodText(i.period)}: {i.description} ({fmtEuro(i.amountCents)})</li>)}</ul>
                </div>
              )}
            </>
          )}
        </Drawer>
      )}
      {swap && (
        <Drawer
          open
          title="Heizung erneuert (Kessel getauscht)"
          onClose={() => { setError(''); setSwap(null) }}
          onSubmit={saveSwap}
          footer={
            <>
              <span className="drawer-hint">Strg+S speichert · Esc schließt</span>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => { setError(''); setSwap(null) }}>Abbrechen</button>
              <button className="btn" onClick={saveSwap}>Tausch speichern</button>
            </>
          }
        >
          {error && <div className="error">{error}</div>}
          <p className="muted">
            Die bisherige Heizung endet am Tag vor dem Tausch; eine neue Heizanlage beginnt mit denselben Wohnungen. Lieferungen, Positionen und
            Vorrat bleiben bei der bisherigen. Ist noch Brennstoff im Tank, tragen Sie ihn als Endbestand zum letzten Betriebstag ein. Heizt die
            neue Anlage mit demselben Brennstoff aus demselben Tank, wird er ihr Anfangsbestand; sonst tragen die Mieter den{' '}
            <Term id="boilerSwap">Restbestand</Term> nicht, und er steht mit seinem Wert bei Ihnen. Bleibt der Energieträger gleich und läuft
            er über denselben Zähler, etwa Gas, brauchen Sie keinen Tausch.
          </p>
          <label className="field grow">
            Seit wann heizt die neue Heizung?
            <input type="date" value={swap.form.date} onChange={(e) => setSwap({ ...swap, form: { ...swap.form, date: e.target.value } })} />
          </label>
          <label className="field grow">
            Womit heizt die neue Heizung?
            <select value={swap.form.energy} onChange={(e) => setSwap({ ...swap, form: { ...swap.form, energy: e.target.value as HeatingEnergy | '' } })}>
              <option value="">— bitte wählen —</option>
              {ENERGY_OPTIONS.flatMap((o) => (o.value === 'perUnit' ? [] : [<option key={o.value} value={o.value}>{o.label}</option>]))}
            </select>
          </label>
          <label className="field grow">
            Name der neuen Heizanlage
            <input value={swap.form.name} onChange={(e) => setSwap({ ...swap, form: { ...swap.form, name: e.target.value } })} placeholder="etwa „Gastherme“" />
          </label>
          <label className="field grow">
            Name der bisherigen Heizanlage
            <input value={swap.form.previousName} onChange={(e) => setSwap({ ...swap, form: { ...swap.form, previousName: e.target.value } })} placeholder="etwa „Ölkessel“" />
          </label>
        </Drawer>
      )}
    </div>
  )
}
