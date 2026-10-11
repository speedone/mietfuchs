// Die Karte „Monatliche Verbrauchsinformation“ einer Heizperiode (Heizung PR 22, § 6a Abs. 1 Nr. 2, Abs. 2
// HeizkostenV). Je Monat der Stand, der Vergleichswert eines Durchschnittsnutzers mit Quelle und der Tag der
// Mitteilung; das Blatt je Mieter zum Drucken. Die Logik steht in monthlyInfoForm.ts.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Table from './Table'
import Term from './Term'
import MonthlyInfoSheet from './MonthlyInfoSheet'
import { EMPTY_ROW_FORM, monthStatus, periodReferenceText, rowBody, rowToForm, type MonthlyRowForm } from '../monthlyInfoForm'
import { monthName } from '../../../shared/monthlyInfo.ts'
import type { MonthlyInfoRow, MonthlyInfoView } from '../types'

// Die Farbe des Stands: grün mitgeteilt, gelb offen, rot unvollständig, grau ohne Pflicht in diesem Monat.
const TONE_CHIP = { ok: 'gruen', open: 'gelb', warn: 'rot', none: '' } as const

export default function MonthlyInfoCard({ plantId, period, propertyName = '' }: { plantId: string; period: string; propertyName?: string }) {
  const [view, setView] = useState<MonthlyInfoView | null>(null)
  const [forms, setForms] = useState<Record<string, MonthlyRowForm>>({})
  const [printing, setPrinting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const toast = useToast()

  async function load() {
    try {
      const v = await api<MonthlyInfoView>(`/api/heating-plants/${plantId}/periods/${period}/monthly-info`)
      setView(v)
      setForms(Object.fromEntries(v.months.map((m) => [m.month, rowToForm(m.row)])))
      setError('')
    } catch (e) {
      setError(errorText(e))
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

  async function save(month: string) {
    const r = rowBody(forms[month] ?? EMPTY_ROW_FORM)
    if ('error' in r) {
      setError(r.error)
      return
    }
    try {
      await api<MonthlyInfoRow>(`/api/heating-plants/${plantId}/monthly-info/${month}`, { method: 'PUT', body: JSON.stringify(r.body) })
      toast('Gespeichert.')
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  if (!view || !view.managed || view.elsewhere || view.months.length === 0) return error ? <div className="error">{error}</div> : null
  const set = (month: string, key: keyof MonthlyRowForm, value: string) =>
    setForms((f) => ({ ...f, [month]: { ...(f[month] ?? EMPTY_ROW_FORM), [key]: value } }))
  const toPrint = view.months.find((m) => m.month === printing)
  const reference = periodReferenceText(view.periodReference)
  const gaps = new Set(view.months.flatMap((m) => m.users.flatMap((u) => u.gaps)))

  return (
    <div className="card">
      <h2><Term id="monthlyConsumptionInfo">Monatliche Verbrauchsinformation</Term></h2>
      <p className="muted">
        Zähler Ihrer Mieter sind aus der Ferne ablesbar. Dann steht jedem Mieter jeden Monat seine Verbrauchsinformation zu. Mietfuchs erstellt sie aus
        den Zählerständen genau am Monatsende; zukommen lassen müssen Sie sie selbst, als Brief oder E-Mail, und hier vermerken Sie, wann. Den
        Vergleichswert eines Durchschnittsnutzers nennt Ihnen etwa Ihr Ablesedienst; ein Durchschnitt aus Ihrem eigenen Haus genügt nicht.
      </p>
      {reference && <p className="muted">{reference}</p>}
      {gaps.has('dhwTemp') && (
        <p className="muted">Die mittlere Warmwassertemperatur für die Umrechnung tragen Sie in der Karte „Warmwasser“ dieser Heizperiode ein; auch eine geschätzte genügt.</p>
      )}
      {error && <div className="error">{error}</div>}
      <Table>
        <thead><tr><th>Monat</th><th>Stand</th><th>Vergleichswert (kWh je m²)</th><th>Quelle</th><th>Mitgeteilt am</th><th /></tr></thead>
        <tbody>
          {view.months.map((m) => {
            const status = monthStatus(m)
            const f = forms[m.month] ?? EMPTY_ROW_FORM
            const label = monthName(m.month)
            return (
              <tr key={m.month}>
                <td>{label}</td>
                <td><span className={`chip ${TONE_CHIP[status.tone]}`}>{status.text}</span></td>
                <td><input aria-label={`Vergleichswert ${label} (kWh je m²)`} inputMode="decimal" value={f.reference} onChange={(e) => set(m.month, 'reference', e.target.value)} /></td>
                <td><input aria-label={`Quelle ${label}`} value={f.source} onChange={(e) => set(m.month, 'source', e.target.value)} /></td>
                <td><input aria-label={`Mitgeteilt am ${label}`} type="date" value={f.sentOn} onChange={(e) => set(m.month, 'sentOn', e.target.value)} /></td>
                <td className="row">
                  <button className="btn secondary" type="button" onClick={() => void save(m.month)}>Speichern</button>
                  {m.due && m.users.length > 0 && <button className="btn secondary" type="button" onClick={() => setPrinting(m.month)}>Drucken</button>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      {toPrint && createPortal(<MonthlyInfoSheet month={toPrint} propertyName={propertyName} />, document.body)}
    </div>
  )
}
