import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssignableHeatingItem, DevicesInstalledAfter, DevicesRemote, HeatingPlant, NewDevicesInstall, Unit } from '../types'
import { api, errorText, fmtEuro } from '../api'
import { useProperty, withProperty } from '../property'
import { periodLabel, periodOfKey, rulesOf } from '../../../shared/period.ts'
import { useConfirm, useToast } from './feedback'
import Drawer from './Drawer'
import Term from './Term'
import HeatingPeriodSection from './HeatingPeriodSection'
import { useFocusTarget, type FocusProps } from '../focus'
import {
  CAPTURE_OPTIONS, CONTRACT_OPTIONS, ENERGY_OPTIONS, HOW_TO_TELL, asksRemote, INSTALLED_OPTIONS, NEW_DEVICES_AFTER, NEW_INSTALL_OPTIONS, NEW_INSTALL_QUESTION, REMOTE_OPTIONS, asksNewInstall, emptyHeatingForm, heatingPlantBody,
  connectionNote, heatingSummary, heatingToForm, whoHint, whoOptions, type CaptureAnswer, type EnergyAnswer, type HeatingForm, type PerUnitContract, type WhoSettles,
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
    try {
      setAssignable(await api<AssignableHeatingItem[]>(withProperty('/api/heating-plants/assignable', propertyId)))
    } catch (e) {
      setError(errorText(e))
      return
    }
    setEditingId(null)
    setForm(emptyHeatingForm(units))
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
    const result = heatingPlantBody(form, units)
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
          body: JSON.stringify({ ...result.body, assignItemIds: assignable.map((i) => i.id) }),
        })
      }
    } catch (e) {
      setError(errorText(e))
      return
    }
    const created = editingId === null
    close()
    await loadAll()
    toast(created ? 'Heizung eingerichtet. An Ihren Beträgen ändert sich nichts.' : 'Heizung gespeichert.')
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
  const periodText = (key: AssignableHeatingItem['period']): string => {
    const p = periodOfKey(rulesOf(property), key)
    return p ? periodLabel(p) : key
  }

  return (
    <div className="card" ref={cardRef}>
      <h2><Term id="heatingSystem">Heizung</Term></h2>
      {error && !form && <div className="error">{error}</div>}
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
          <ul className="facts">{heatingSummary(p, units).map((line) => <li key={line}>{line}</li>)}</ul>
          <HeatingPeriodSection
            plant={p}
            objectRules={rulesOf(property)}
            hasCalendarData={assignable.length > 0 || units.length > 0}
            onChanged={loadAll}
            notify={toast}
            actions={<button className="btn secondary" onClick={() => openEdit(p)}>Ändern</button>}
            dangerAction={<button className="btn ghost danger-ghost" onClick={() => remove(p)}>Entfernen</button>}
          />
        </div>
      ))}
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
          <label className="field grow">
            Womit wird geheizt?
            <select value={form.energy} onChange={(e) => setForm({ ...form, energy: e.target.value as EnergyAnswer | '' })}>
              <option value="">— bitte wählen —</option>
              {ENERGY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <small className="muted">{HOW_TO_TELL.energy}</small>
          {form.energy === 'perUnit' ? (
            <label className="field grow">
              Wer hat den Vertrag für die Heizung in der Wohnung?
              <select value={form.contract} onChange={(e) => setForm({ ...form, contract: e.target.value as PerUnitContract })}>
                <option value="">— bitte wählen —</option>
                {CONTRACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
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
                <small className="muted">{HOW_TO_TELL.units}</small>
              </fieldset>
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
    </div>
  )
}
