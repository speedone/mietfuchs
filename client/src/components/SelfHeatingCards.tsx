import { useState } from 'react'
import type { HeatingPeriodView, HeatingPlant, InterimGapStatus, SelfHeatingStatement } from '../types'
import { api, errorText, fmtDate } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { boundaryLight, boundaryText, distributionLines, potLines, readingResult, shareEditable, userLine, type Light } from '../heatingSelfView'
import { shareBounds } from '../heatingSelfForm'

// Die Farbe der Ampel, wie im Cockpit.
const AMPEL: Record<Light, string> = { green: 'gruen', yellow: 'gelb', red: 'rot' }

// Die eigene Heizkostenabrechnung auf der Seite Heizkosten (Heizung PR 10, Entwurf 11.4): der Anteil nach
// Verbrauch der Heizperiode, die Ablesungen je Wohnung als Ampel mit der Antwort zu fehlenden
// Zwischenablesungen, die Verteilung und das Ableseergebnis zum Ausdrucken. `self` kommt aus der Abrechnung
// des Zeitraums (`heating[].self`), `view` aus der Ansicht der Heizperiode.
export default function SelfHeatingCards({ plant, view, self, onChanged }: {
  plant: HeatingPlant; view: HeatingPeriodView; self: SelfHeatingStatement | null; onChanged: () => void
}) {
  const toast = useToast()
  const [error, setError] = useState('')
  const [share, setShare] = useState('')
  const [waterShare, setWaterShare] = useState('')
  const { min, max } = shareBounds()
  const d = view.distribution ?? null

  async function saveShare() {
    try {
      await api(`/api/heating-plants/${plant.id}/periods/${view.period}/distribution`, {
        method: 'PUT',
        // § 8 Abs. 1: beide Werte, das Warmwasser nur bei zentralem Warmwasser (Abweichung 14).
        body: JSON.stringify({
          heatConsumptionPct: Number(share.replace(',', '.')),
          waterConsumptionPct: plant.hotWater === 'none' ? null : Number(waterShare.replace(',', '.')),
          insulationRule: d?.effective?.insulationRule ?? d?.own.insulationRule ?? 'unknown',
        }),
      })
      setError('')
      toast('Anteil gespeichert.')
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }
  async function answer(unitId: string, date: string, status: InterimGapStatus | null) {
    try {
      const url = `/api/units/${unitId}/interim-gaps/${date}`
      if (status === null) await api(url, { method: 'DELETE' })
      else await api(url, { method: 'PUT', body: JSON.stringify({ status, reason: '' }) })
      setError('')
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }

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
        {(!d || shareEditable(d)) && (
          <div className="row no-print">
            {/* Das Warmwasser übernimmt den Wert der Heizung sichtbar, bis der Vermieter ihn ändert. */}
            <label className="field">
              Heizung in % ({min} bis {max})
              <input inputMode="decimal" value={share} onChange={(e) => { if (waterShare === '' || waterShare === share) setWaterShare(e.target.value); setShare(e.target.value) }} />
            </label>
            {plant.hotWater !== 'none' && (
              <label className="field">
                Warmwasser in %
                <input inputMode="decimal" value={waterShare} onChange={(e) => setWaterShare(e.target.value)} />
              </label>
            )}
            <button className="btn secondary" onClick={saveShare}>Speichern</button>
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
              return (
                <div key={`${u.unitId}@${b.date}`} className={`check-row ${light === 'green' ? '' : AMPEL[light]}`}>
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
                      <div className="row no-print">
                        <button className="btn ghost" onClick={() => answer(u.unitId, b.date, 'impossible')}>Nicht möglich</button>
                        <button className="btn ghost" onClick={() => answer(u.unitId, b.date, 'missed')}>Nicht durchgeführt</button>
                        {b.gap !== null && <button className="btn ghost" onClick={() => answer(u.unitId, b.date, null)}>Antwort zurücknehmen</button>}
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
        </div>
      )}
      {self && (
        <div className="card">
          <h3>Ableseergebnis</h3>
          <p className="muted no-print">
            Bei Zählern, die nicht aus der Ferne ablesbar sind, teilen Sie jedem Mieter das Ergebnis der Ablesung in der Regel innerhalb eines Monats mit
            (§ 6 Abs. 1 Satz 2 HeizkostenV). Drucken Sie dazu diese Karte.
          </p>
          {self.units.map((u) => (
            <div key={u.unitId} className="stack">
              <strong>{u.unitName}</strong>
              {[...new Set(u.readings.map((r) => r.boundary))].map((date) => (
                <div key={date}>
                  <span className="muted">{fmtDate(date)}</span>
                  {readingResult(u, date).map((l) => <div key={l}>{l}</div>)}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
