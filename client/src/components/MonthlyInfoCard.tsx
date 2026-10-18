// Die Karte „Monatliche Verbrauchsinformation“ einer Heizperiode (Heizung PR 22, § 6a Abs. 1 Nr. 2, Abs. 2
// HeizkostenV). Je Monat der Stand, der Vergleichswert eines Durchschnittsnutzers mit Quelle und der Tag der
// Mitteilung; das Blatt je Mieter zum Drucken. Die Logik steht in monthlyInfoForm.ts.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Table from './Table'
import Term from './Term'
import { useDraft } from '../useDraft'
import DraftActions from './DraftActions'
import Card from './Card'
import MonthlyInfoSheet from './MonthlyInfoSheet'
import { monthStatus, periodReferenceText, rowBody, rowToForm, tempBody, type MonthlyRowForm } from '../monthlyInfoForm'
import { monthName } from '../../../shared/monthlyInfo.ts'
import type { MonthlyInfoMonth, MonthlyInfoRow, MonthlyInfoView } from '../types'
import { ErrorSummary, useFormError } from './ErrorSummary'

// Die Farbe des Stands: grün mitgeteilt, gelb offen, rot unvollständig, grau ohne Pflicht in diesem Monat.
const TONE_CHIP = { ok: 'gruen', open: 'gelb', warn: 'rot', none: '' } as const

export default function MonthlyInfoCard({ plantId, period, propertyName = '' }: { plantId: string; period: string; propertyName?: string }) {
  const [view, setView] = useState<MonthlyInfoView | null>(null)
  const [printing, setPrinting] = useState<string | null>(null)
  // Fehler beim Laden als Sammelmeldung oben in der Karte (#346, Schritt 3)
  const errors = useFormError()
  const setError = errors.set
  const toast = useToast()
  // Die Temperatur und jede Zeile sind ein Entwurf am Feld mit eigenem „Speichern“, das erst bei einer Änderung
  // erscheint (#309, #346 Schritt 7); jeder meldet sich als offenes Formular an (#346, 7a). Nach dem Speichern lädt
  // die Karte neu, und die Entwürfe übernehmen den neuen Stand.

  async function load() {
    try {
      const v = await api<MonthlyInfoView>(`/api/heating-plants/${plantId}/periods/${period}/monthly-info`)
      setView(v)
      setError('')
    } catch (e) {
      setError(errorText(e), { focus: false })
    }
  }
  useEffect(() => {
    void load()
    // `load` ändert sich mit jedem Rendern; geladen wird neu, wenn Anlage oder Heizperiode wechseln.
  }, [plantId, period])

  // Gedruckt wird nur das Blatt (index.css): wie beim Ablesebeleg erst nach dem Rendern, und aufgeräumt nach dem Druck.
  useEffect(() => {
    if (printing === null) return
    document.body.classList.add('print-monthly-info')
    const done = () => {
      document.body.classList.remove('print-monthly-info')
      setPrinting(null)
    }
    window.addEventListener('afterprint', done)
    const t = setTimeout(() => window.print(), 80)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', done)
      document.body.classList.remove('print-monthly-info')
    }
  }, [printing])

  async function saveRow(month: string, form: MonthlyRowForm) {
    const r = rowBody(form)
    if ('error' in r) throw new Error(r.error)
    await api<MonthlyInfoRow>(`/api/heating-plants/${plantId}/monthly-info/${month}`, { method: 'PUT', body: JSON.stringify(r.body) })
    toast('Gespeichert.')
    await load()
  }

  // Bei getrenntem Warmwasser gibt es die Karte „Warmwasser“ nicht; ohne Temperatur bliebe jeder Monat mit
  // Warmwasserzähler unvollständig, und der Vermieter könnte die genannte Kürzung nicht abwenden.
  async function saveTemp(temp: string) {
    const r = tempBody(temp)
    if ('error' in r) throw new Error(r.error)
    await api(`/api/heating-plants/${plantId}/periods/${period}/dhw-temperature`, { method: 'PUT', body: JSON.stringify(r.body) })
    toast('Gespeichert.')
    await load()
  }

  if (!view || !view.managed || view.elsewhere || view.months.length === 0) return errors.state.problems.length > 0 ? <ErrorSummary errors={errors} /> : null
  const toPrint = view.months.find((m) => m.month === printing)
  const reference = periodReferenceText(view.periodReference)
  const gaps = new Set(view.months.flatMap((m) => m.users.flatMap((u) => u.gaps)))

  return (
    <Card title={<Term id="monthlyConsumptionInfo">Monatliche Verbrauchsinformation</Term>} level={3}>
      <ErrorSummary errors={errors} />
      <p className="muted">
        Zähler Ihrer Mieter sind aus der Ferne ablesbar. Dann steht jedem Mieter jeden Monat seine Verbrauchsinformation zu. Mietfuchs erstellt sie aus
        den Zählerständen genau am Monatsende; zukommen lassen müssen Sie sie selbst, als Brief oder E-Mail, und hier vermerken Sie, wann. Den
        Vergleichswert eines Durchschnittsnutzers nennt Ihnen etwa Ihr Ablesedienst; ein Durchschnitt aus Ihrem eigenen Haus genügt nicht.
      </p>
      {reference && <p className="muted">{reference}</p>}
      {view.dhwTemp.here ? (
        <TempField saved={view.dhwTemp.tempC === null ? '' : view.dhwTemp.tempC.toLocaleString('de-DE', { maximumFractionDigits: 2 })} scope={`${plantId}|${period}`} onSave={saveTemp} />
      ) : gaps.has('dhwTemp') && (
        <p className="muted">Die mittlere Warmwassertemperatur für die Umrechnung tragen Sie in der Karte „Warmwasser“ dieser Heizperiode ein; auch eine geschätzte genügt.</p>
      )}
      <Table>
        <thead><tr><th>Monat</th><th>Stand</th><th>Vergleichswert (kWh je m²)</th><th>Quelle</th><th>Mitgeteilt am</th><th /></tr></thead>
        <tbody>
          {view.months.map((m) => (
            <MonthRow key={m.month} month={m} onSave={(form) => saveRow(m.month, form)} onPrint={() => setPrinting(m.month)} />
          ))}
        </tbody>
      </Table>
      {toPrint && createPortal(<MonthlyInfoSheet month={toPrint} propertyName={propertyName} />, document.body)}
    </Card>
  )
}

// Die mittlere Warmwassertemperatur: ein Entwurf am Feld (#309, #346 Schritt 7).
function TempField({ saved, scope, onSave }: { saved: string; scope: string; onSave: (temp: string) => Promise<void> }) {
  const draft = useDraft(saved, { scope })
  return (
    <div className="row">
      <label className="field">
        Mittlere Warmwassertemperatur (°C)
        <input inputMode="decimal" value={draft.value} disabled={draft.saving} onChange={(e) => draft.set(e.target.value)} />
      </label>
      <DraftActions draft={draft} onSave={onSave} what="Warmwassertemperatur" />
      <p className="muted">Damit rechnet Mietfuchs das Warmwasser in Kilowattstunden um, für die ganze Heizperiode; auch eine geschätzte Temperatur genügt.</p>
    </div>
  )
}

// Ein Monat: Vergleichswert, Quelle und Tag der Mitteilung als Entwurf an der Zeile, „Speichern“ erst bei einer
// Änderung (#309, #346 Schritt 7); „Drucken“ für das Blatt der Mieter, sobald der Monat fällig ist.
function MonthRow({ month: m, onSave, onPrint }: { month: MonthlyInfoMonth; onSave: (form: MonthlyRowForm) => Promise<void>; onPrint: () => void }) {
  const draft = useDraft(rowToForm(m.row), { scope: m.month })
  const f = draft.value
  const status = monthStatus(m)
  const label = monthName(m.month)
  const set = (key: keyof MonthlyRowForm, value: string) => draft.set({ ...f, [key]: value })
  return (
    <tr>
      <td>{label}</td>
      <td><span className={`chip ${TONE_CHIP[status.tone]}`}>{status.text}</span></td>
      <td><input aria-label={`Vergleichswert ${label} (kWh je m²)`} inputMode="decimal" value={f.reference} disabled={draft.saving} onChange={(e) => set('reference', e.target.value)} /></td>
      <td><input aria-label={`Quelle ${label}`} value={f.source} disabled={draft.saving} onChange={(e) => set('source', e.target.value)} /></td>
      <td><input aria-label={`Mitgeteilt am ${label}`} type="date" value={f.sentOn} disabled={draft.saving} onChange={(e) => set('sentOn', e.target.value)} /></td>
      <td className="row">
        <DraftActions draft={draft} onSave={onSave} what={label} />
        {m.due && m.users.length > 0 && <button className="btn secondary" type="button" onClick={onPrint}>Drucken</button>}
      </td>
    </tr>
  )
}
