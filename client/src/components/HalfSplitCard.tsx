// Die Karte „Heizung nach § 43 GModG“ (Heizung PR 18, #215; Entwurf 3.9, 5.3): Tag des Einbaus, Notfalleinbau,
// Neubau, gespeichert an der Anlage, und die Mitteilung nach § 5d Abs. 4 je Mietverhältnis.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { useOpenWhenDiffers } from '../useDraft'
import { APPLICATION_FROM, FIRST_USE_UNTIL, HALF_SPLIT_WHAT, HALF_SPLIT_YEAR, halfSplitBody, halfSplitToForm, INSTALLED_AFTER, noticeBody, noticeTenancies, PRIOR_DUTY_EXPLAINED, PRIOR_DUTY_QUESTION, TRI_OPTIONS, type HalfSplitBody, type NoticeTenancy, type TriState } from '../halfSplitForm'
import { halfSplitFirstDay } from '../../../shared/law/co2kostaufg.ts'
import type { HeatingEnergy, HeatingPlant } from '../types'
import { ErrorSummary, useFormError } from './ErrorSummary'

export default function HalfSplitCard({ plant, tenancies, onSaved, onNoticeSaved }: {
  plant: HalfSplitBody & Pick<HeatingPlant, 'units'> & { id: string; energy: HeatingEnergy }
  tenancies: readonly NoticeTenancy[]
  onSaved: () => void
  // Lädt die Mietverhältnisse neu, an denen die Mitteilung steht (sonst zeigte die Karte sie nach einem
  // Seitenwechsel wieder leer); ohne Angabe `onSaved`.
  onNoticeSaved?: () => void
}) {
  const [form, setForm] = useState(halfSplitToForm(plant))
  const [notices, setNotices] = useState<Record<string, string>>(() => Object.fromEntries(tenancies.map((t) => [t.id, t.halfSplitNoticeOn ?? ''])))
  // Fehler als Sammelmeldung oben in der Karte (#346, Schritt 3)
  const errors = useFormError()
  const setError = errors.set
  // Eine ungespeicherte Eingabe zählt als offenes Formular: Seiten-, Objekt- und Zeitraumwechsel fragen (#346, 7a).
  // Gezählt wird, was die Karte zeigt (ohne Einbau keine weiteren Fragen), und je Mitteilung gegen ihren
  // gespeicherten Stand; eine gespeicherte Mitteilung gilt sofort als gespeichert, auch bevor die
  // Mietverhältnisse neu geladen sind.
  const shownForm = (f: typeof form) => (f.installedOn === '' ? { installedOn: '' } : f)
  const markSaved = useOpenWhenDiffers(shownForm(form), shownForm(halfSplitToForm(plant)))
  const [noticeSaved, setNoticeSaved] = useState<Record<string, string>>({})
  useOpenWhenDiffers(notices, Object.fromEntries(tenancies.map((t) => [t.id, noticeSaved[t.id] ?? t.halfSplitNoticeOn ?? ''])))
  const toast = useToast()
  const asked = noticeTenancies(tenancies, plant, halfSplitFirstDay())
  const pick = (value: string): TriState => TRI_OPTIONS.find((o) => o.value === value)?.value ?? 'unknown'
  const applicationQuestion = `Bauantrag, Antrag auf Zustimmung oder Bauanzeige vor dem ${APPLICATION_FROM}?`

  async function saveNotice(t: NoticeTenancy) {
    const result = noticeBody(notices[t.id] ?? '')
    if ('error' in result) {
      setError(result.error)
      return
    }
    try {
      await api(`/api/tenancies/${t.id}`, { method: 'PUT', body: JSON.stringify(result.body) })
      setError('')
      setNoticeSaved((s) => ({ ...s, [t.id]: notices[t.id] ?? '' }))
      toast(`Mitteilung an ${t.tenantName} gespeichert.`)
      ;(onNoticeSaved ?? onSaved)()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function save() {
    const result = halfSplitBody(form)
    if ('error' in result) {
      setError(result.error)
      return
    }
    try {
      await api(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify(result.body) })
      setError('')
      markSaved()
      toast('Angaben zur Heizung gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="card">
      <h2>Heizung nach <Term id="co2HalfSplit">§ 43 GModG</Term> {`(ab ${HALF_SPLIT_YEAR})`}</h2>
      <ErrorSummary errors={errors} />
      <p className="muted">{`Nur für eine Gas-, Öl- oder Flüssiggasheizung, die nach dem ${INSTALLED_AFTER} in ein bestehendes Gebäude eingebaut wurde, oder eine solche Heizung in einem Neubau. ${HALF_SPLIT_WHAT}`}</p>
      <label className="field">
        Tag des Einbaus
        <input type="date" aria-label="Tag des Einbaus" value={form.installedOn} onChange={(e) => setForm({ ...form, installedOn: e.target.value })} />
      </label>
      {form.installedOn !== '' && (
        <>
          <label className="field checkline">
            <input type="checkbox" checked={form.emergency} onChange={(e) => setForm({ ...form, emergency: e.target.checked })} />
            Eingebaut, weil die bisherige Heizung irreparabel ausgefallen war (§ 5a Abs. 4 CO2KostAufG)
          </label>
          {form.emergency && (
            <label className="field">
              {PRIOR_DUTY_QUESTION}
              <select aria-label={PRIOR_DUTY_QUESTION} value={form.priorDuty} onChange={(e) => setForm({ ...form, priorDuty: pick(e.target.value) })}>
                {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span className="muted">{PRIOR_DUTY_EXPLAINED}</span>
            </label>
          )}
          <label className="field checkline">
            <input type="checkbox" checked={form.newBuilding} onChange={(e) => setForm({ ...form, newBuilding: e.target.checked })} />
            {`Das Gebäude ist ein Neubau, erstmals genutzt bis ${FIRST_USE_UNTIL} (§ 5b CO2KostAufG)`}
          </label>
          {form.newBuilding && (
            <>
              {/* Prüfung S13: Dass im Neubau der Tag der Inbetriebnahme zählt, ist eine Festlegung ohne Primärquelle. */}
              <p className="muted">Im Neubau gilt § 5a entsprechend (§ 5b CO2KostAufG); als Tag des Einbaus tragen Sie den Tag ein, an dem die Gas-, Öl- oder Flüssiggasheizung in Betrieb ging.</p>
              <label className="field">
                Erstmals genutzt am
                <input type="date" aria-label="Erstmals genutzt am" value={form.firstUse} onChange={(e) => setForm({ ...form, firstUse: e.target.value })} />
              </label>
              <label className="field">
                {applicationQuestion}
                <select aria-label={applicationQuestion} value={form.applicationBefore} onChange={(e) => setForm({ ...form, applicationBefore: pick(e.target.value) })}>
                  {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </>
          )}
          <p className="muted">Im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen und die beide an dieser Heizung hängen, bleibt es beim Stufenmodell, wenn Sie das jedem Mieter in Textform mitgeteilt haben und das Gebäude in keinem Gebiet liegt, das eine Verordnung zur Mietpreisbremse, Kappungsgrenze oder Kündigungssperrfrist bestimmt (Frage beim Objekt). Mitteilen müssen Sie es bei Abschluss des Mietvertrags; bestand der Vertrag schon, bevor die Voraussetzungen eintraten, genügt nach der Begründung in der Regel die Mitteilung mit der Abrechnung (§ 5d Abs. 3, 4 CO2KostAufG; BT-Drs. 21/7009, S. 156). Dass die Mitteilung auch für diese Ausnahme nötig ist, ist eine Auslegung; Mietfuchs verlangt sie, damit Sie sicher gehen.</p>
        </>
      )}
      <div className="row"><button className="btn" onClick={() => void save()}>Angaben speichern</button></div>
      {form.installedOn !== '' && asked.length > 0 && (
        <div className="field-group">
          <div className="field-group-label">Mitteilung nach § 5d Abs. 4 (nur Zweifamilienhaus mit Eigennutzung)</div>
          {asked.map((t) => (
            <div key={t.id} className="row">
              <label className="field">
                {`Mitteilung an ${t.tenantName} in Textform am`}
                <input type="date" aria-label={`Mitteilung an ${t.tenantName} nach § 5d Abs. 4 in Textform am`} value={notices[t.id] ?? ''} onChange={(e) => setNotices({ ...notices, [t.id]: e.target.value })} />
              </label>
              <button className="btn secondary" onClick={() => void saveNotice(t)}>Mitteilung speichern</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
