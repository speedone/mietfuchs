import { useEffect, useState } from 'react'
import HcaBlock from './HcaBlock'
import type { HeatingPeriodView, HeatingPlant, InsulationRule, InterimGapStatus, SelfHeatingStatement } from '../types'
import { api, errorText, fmtDate } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import {
  boundaryLight, boundaryText, distributionLines, gapConsequence, INSULATION_OPTIONS, INSULATION_QUESTION, insulationAsked, insulationExplained,
  heatUnitOf, percentOf, potLines, READING_RESULT_HINT, readingResult, shareEditable, unsureShareHint, userLine, type Light,
} from '../heatingSelfView'
import { forcedShare, shareBounds } from '../heatingSelfForm'

// Die Farbe der Ampel, wie im Cockpit.
const AMPEL: Record<Light, string> = { green: 'gruen', yellow: 'gelb', red: 'rot' }

// Die eigene Heizkostenabrechnung auf der Seite Heizkosten (Heizung PR 10, Entwurf 11.4): der Anteil nach
// Verbrauch der Heizperiode samt der Frage zum Wärmeschutz, die Ablesungen je Wohnung als Ampel mit der
// Antwort zu fehlenden Zwischenablesungen, die Verteilung und das Ableseergebnis je Wohnung zum Ausdrucken.
// `self` kommt aus der Abrechnung des Zeitraums (`heating[].self`), `view` aus der Ansicht der Heizperiode.
export default function SelfHeatingCards({ plant, view, self, onChanged }: {
  plant: HeatingPlant; view: HeatingPeriodView; self: SelfHeatingStatement | null; onChanged: () => void
}) {
  const toast = useToast()
  const [error, setError] = useState('')
  const [share, setShare] = useState('')
  const [waterShare, setWaterShare] = useState('')
  const { min, max } = shareBounds()
  const d = view.distribution ?? null
  const savedInsulation: InsulationRule | '' = d?.own.insulationRule ?? d?.effective?.insulationRule ?? ''
  const [insulation, setInsulation] = useState<InsulationRule | ''>(savedInsulation)
  // Eine Zwischenablesung, die „nicht möglich“ war, braucht einen Grund (I3).
  const [reasonFor, setReasonFor] = useState<{ key: string; reason: string } | null>(null)
  const [printUnit, setPrintUnit] = useState<string>(self?.units[0]?.unitId ?? '')
  const [printing, setPrinting] = useState(false)
  const editable = !d || shareEditable(d)
  // Die Warmwasserbereitung dieser Heizperiode, nicht die heutige der Anlage (Durchsicht von #241, Runde 2, H1).
  const hotWater = view.selfHotWater ?? plant.hotWater
  const forced = forcedShare(plant.energy, insulation)
  // Den Pflichtanteil nachzutragen geht auch in einer begonnenen Heizperiode (Durchsicht von #239, C1).
  const toForced = forced !== null && savedInsulation !== 'applies'
  const hint = unsureShareHint(plant.energy, insulation, d?.effective?.heating ?? percentOf(share))

  useEffect(() => {
    if (!printing) return
    document.body.classList.add('print-reading')
    const done = () => {
      document.body.classList.remove('print-reading')
      setPrinting(false)
    }
    window.addEventListener('afterprint', done)
    const t = setTimeout(() => window.print(), 80)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', done)
      document.body.classList.remove('print-reading')
    }
  }, [printing])

  async function saveShare() {
    const heat = forced ?? percentOf(share)
    const water = hotWater === 'none' ? null : (editable ? percentOf(waterShare) : (d?.effective?.water ?? null))
    if (heat === null || (hotWater !== 'none' && water === null)) {
      setError(`Bitte geben Sie den Anteil zwischen ${min} und ${max} % an, mit höchstens zwei Nachkommastellen.`)
      return
    }
    try {
      await api(`/api/heating-plants/${plant.id}/periods/${view.period}/distribution`, {
        method: 'PUT',
        // § 8 Abs. 1: beide Werte, das Warmwasser nur bei zentralem Warmwasser (Abweichung 14).
        body: JSON.stringify({
          heatConsumptionPct: heat,
          waterConsumptionPct: water,
          insulationRule: insulationAsked(plant.energy) ? (insulation === '' ? 'unknown' : insulation) : 'notApplies',
        }),
      })
      setError('')
      toast('Anteil gespeichert.')
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }
  async function answer(unitId: string, date: string, status: InterimGapStatus | null, reason = '') {
    try {
      const url = `/api/units/${unitId}/interim-gaps/${date}`
      if (status === null) await api(url, { method: 'DELETE' })
      else await api(url, { method: 'PUT', body: JSON.stringify({ status, reason }) })
      setError('')
      setReasonFor(null)
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const printed = self?.units.filter((u) => u.unitId === printUnit) ?? []

  return (
    <>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <h3>Anteil nach Verbrauch · {view.label}</h3>
        <p className="muted">
          Von den Kosten der Heizung und des Warmwassers verteilt Mietfuchs diesen Teil nach dem gemessenen Verbrauch
          (<Term id="consumptionCosts">Verbrauchskosten</Term>), den Rest nach der Fläche (<Term id="baseCosts">Grundkosten</Term>).
        </p>
        {d ? distributionLines(d).map((l) => <p key={l}>{l}</p>) : <p className="muted">Noch kein Anteil festgelegt.</p>}
        {insulationAsked(plant.energy) && (
          <div className="no-print">
            <label className="field grow">
              <span>{INSULATION_QUESTION} (<Term id="forcedConsumptionShare">Pflichtanteil</Term>)</span>
              <select value={insulation} onChange={(e) => setInsulation(e.target.value as InsulationRule | '')}>
                {insulation === '' && <option value="">— bitte wählen —</option>}
                {INSULATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <p className="muted">{insulationExplained()}</p>
          </div>
        )}
        {hint && <div className="notice">{hint}</div>}
        {(editable || toForced) && (
          <div className="row no-print">
            {/* Das Warmwasser übernimmt den Wert der Heizung sichtbar, bis der Vermieter ihn ändert. */}
            <label className="field">
              Heizung in % ({min} bis {max})
              <input inputMode="decimal" value={forced !== null ? String(forced) : share} disabled={forced !== null}
                onChange={(e) => { if (waterShare === '' || waterShare === share) setWaterShare(e.target.value); setShare(e.target.value) }} />
            </label>
            {hotWater !== 'none' && editable && (
              <label className="field">
                Warmwasser in %
                <input inputMode="decimal" value={waterShare} onChange={(e) => setWaterShare(e.target.value)} />
              </label>
            )}
            <button className="btn secondary" onClick={saveShare}>{editable ? 'Speichern' : 'Pflichtanteil eintragen'}</button>
          </div>
        )}
        {!editable && insulationAsked(plant.energy) && !toForced && insulation !== savedInsulation && (
          <div className="row no-print">
            <button className="btn secondary" onClick={saveShare}>Antwort speichern</button>
          </div>
        )}
      </div>
      {self && (
        <div className="card">
          <h3>Ablesungen</h3>
          <p className="muted no-print">
            Je Wohnung die Ablesung zu Beginn und Ende der Heizperiode und bei jedem Mieterwechsel (<Term id="interimReading">Zwischenablesung</Term>).
            Fehlt eine Zwischenablesung, sagen Sie, warum.
          </p>
          <div>
            {self.units.flatMap((u) => u.boundaries.map((b) => {
              const light = boundaryLight(b)
              const key = `${u.unitId}@${b.date}`
              return (
                <div key={key} className={`check-row ${light === 'green' ? '' : AMPEL[light]}`}>
                  <span className={`ampel ${AMPEL[light]}`} />
                  <div className="grow">
                    {boundaryText(b, u.unitName)}
                    {b.status === 'off' && b.kind === 'change' && b.far && (
                      <div className="row no-print">
                        <button className="btn ghost" onClick={() => answer(u.unitId, b.date, 'useReading')}>Ablesung verwenden</button>
                        <button className="btn ghost" onClick={() => answer(u.unitId, b.date, 'imprecise')}>Nach § 9b Abs. 3</button>
                        {b.gap !== null && <button className="btn ghost" onClick={() => answer(u.unitId, b.date, null)}>Antwort zurücknehmen</button>}
                      </div>
                    )}
                    {b.status === 'missing' && b.kind === 'change' && (
                      <div className="no-print">
                        <p className="muted">{gapConsequence('impossible')}</p>
                        <p className="muted">{gapConsequence('missed')}</p>
                        <div className="row">
                          <button className="btn ghost" onClick={() => setReasonFor({ key, reason: b.gapReason ?? '' })}>Nicht möglich</button>
                          <button className="btn ghost" onClick={() => answer(u.unitId, b.date, 'missed')}>Nicht durchgeführt</button>
                          {b.gap !== null && <button className="btn ghost" onClick={() => answer(u.unitId, b.date, null)}>Antwort zurücknehmen</button>}
                        </div>
                        {reasonFor?.key === key && (
                          <div className="row">
                            <label className="field grow">
                              Warum war die Zwischenablesung nicht möglich? (steht in der Abrechnung)
                              <input value={reasonFor.reason} onChange={(e) => setReasonFor({ key, reason: e.target.value })} />
                            </label>
                            <button className="btn secondary" disabled={reasonFor.reason.trim() === ''} onClick={() => answer(u.unitId, b.date, 'impossible', reasonFor.reason.trim())}>Grund speichern</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            }))}
          </div>
        </div>
      )}
      {self && self.ok && (
        <div className="card">
          <h3>Verteilung</h3>
          {self.pots.flatMap(potLines).map((l) => <p key={l}>{l}</p>)}
          {self.units.flatMap((u) => u.users).map((u) => <p key={u.key}>{userLine(u, self)}</p>)}
          <HcaBlock self={self} unitName={(id) => self.units.find((u) => u.unitId === id)?.unitName ?? id} />
        </div>
      )}
      {self && (
        <div className="card reading-result">
          <h3>Ableseergebnis · {view.label}</h3>
          <p className="muted no-print">{READING_RESULT_HINT}</p>
          <div className="row no-print">
            <label className="field">
              Wohnung
              <select value={printUnit} onChange={(e) => setPrintUnit(e.target.value)}>
                {self.units.map((u) => <option key={u.unitId} value={u.unitId}>{u.unitName}</option>)}
              </select>
            </label>
            <button className="btn secondary" onClick={() => setPrinting(true)}>Ableseergebnis drucken</button>
          </div>
          {printed.map((u) => (
            <div key={u.unitId} className="stack">
              <strong>{u.unitName}</strong>
              {[...new Set(u.readings.map((r) => r.boundary))].map((date) => (
                <div key={date}>
                  <span className="muted">{fmtDate(date)}</span>
                  {readingResult(u, date, heatUnitOf(self)).map((l) => <div key={l}>{l}</div>)}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
