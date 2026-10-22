import { useEffect, useState } from 'react'
import { keepDraft, useDraft } from '../useDraft'
import DraftActions from './DraftActions'
import Card from './Card'
import EstimateCard from './EstimateCard'
import HcaBlock from './HcaBlock'
import type { HeatingPeriodView, HeatingPlant, InsulationRule, InterimGapStatus, SelfHeatingStatement } from '../types'
import { billingEnergy } from '../../../shared/heatDelivery.ts'
import { api, errorText, fmtDate } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import {
  boundaryLight, boundaryText, distributionLines, gapConsequence, INSULATION_OPTIONS, INSULATION_QUESTION, insulationAsked, insulationExplained,
  heatUnitOf, percentOf, potLines, READING_RESULT_HINT, readingResult, shareEditable, unsureShareHint, userLine, type Light,
} from '../heatingSelfView'
import { forcedShare, shareBounds } from '../heatingSelfForm'
import { ErrorSummary, useFormError } from './ErrorSummary'
import { NoticeBox } from './Notice'

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
  // Fehler als Sammelmeldung oben in der Karte (#346, Schritt 3)
  const errors = useFormError()
  const setError = errors.set
  const { min, max } = shareBounds()
  const d = view.distribution ?? null
  const savedInsulation: InsulationRule | '' = d?.own.insulationRule ?? d?.effective?.insulationRule ?? ''
  // § 10 HeizkostenV (Heizung PR 14): mehr als 70 % nach Vereinbarung, mit dem Anteil gespeichert.
  // Ohne eigene Zeile gilt die Vereinbarung der Vorperiode weiter (`own.above70Agreed` ist dann `false`, nicht leer); bei
  // gesperrtem Anteil ist das Häkchen nicht zu sehen und ginge sonst still verloren (Durchsicht von #406).
  const savedAgreed = d && d.own.heating !== null ? d.own.above70Agreed === true : (d?.effective?.above70Agreed ?? false)
  // Anteil, Wärmeschutz und § 10 sind ein Entwurf mit einem „Speichern“ am Fuß der Karte (#346 Schritt 7, N8; vorher
  // „Speichern“ bzw. „Pflichtanteil eintragen“ und daneben „Antwort speichern“). Eine Änderung meldet sich als offenes
  // Formular an (#346, 7a).
  const draft = useDraft({ share: '', waterShare: '', insulation: savedInsulation, agreed: savedAgreed }, { scope: `${plant.id}|${view.period}` })
  const { share, waterShare, insulation, agreed } = draft.value
  const edit = (patch: Partial<typeof draft.value>) => draft.set({ ...draft.value, ...patch })
  // Eine Zwischenablesung, die „nicht möglich“ war, braucht einen Grund (I3). Als offenes Formular zählt er erst mit einer
  // Eingabe (GapReason über useDraft; Durchsicht K5).
  const [reasonFor, setReasonFor] = useState<string | null>(null)
  const [printUnit, setPrintUnit] = useState<string>(self?.units[0]?.unitId ?? '')
  const [printing, setPrinting] = useState(false)
  const editable = !d || shareEditable(d)
  // Die Warmwasserbereitung dieser Heizperiode, nicht die heutige der Anlage (Durchsicht von #241, Runde 2, H1).
  const hotWater = view.selfHotWater ?? plant.hotWater
  // Fehlt der Anteil fürs Warmwasser (etwa weil die vorige Heizperiode kein zentrales Warmwasser hatte), lässt er sich
  // auch in begonnener Heizperiode nachtragen: Der Server sieht darin keine Änderung nach § 6 Abs. 4 (Durchsicht von #406).
  const waterMissing = !editable && hotWater !== 'none' && (d?.effective?.water ?? null) === null
  // Heizung PR 16: nach der Energie der Abrechnung; bei Contracting gilt der Pflichtanteil nicht (§ 7 Abs. 3).
  const energy = billingEnergy(plant)
  const forcedRaw = forcedShare(energy, insulation)
  // Mit Vereinbarung darf der Anteil über dem Pflichtanteil liegen.
  const forced = forcedRaw !== null && !agreed ? forcedRaw : null
  // Den Pflichtanteil nachzutragen geht auch in einer begonnenen Heizperiode (Durchsicht von #239, C1).
  const toForced = forced !== null && savedInsulation !== 'applies'
  const hint = unsureShareHint(energy, insulation, d?.effective?.heating ?? percentOf(share))

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
    // Gesperrt und ohne Pflichtanteil gilt der Anteil weiter, wie beim Warmwasser; geändert wird dann nur die Antwort
    // zum Wärmeschutz (#376). Der Server nimmt den unveränderten Anteil an (§ 6 Abs. 4).
    const heat = forced ?? (editable ? percentOf(share) : (d?.effective?.heating ?? null))
    const water = hotWater === 'none' ? null : (editable || waterMissing ? percentOf(waterShare) : (d?.effective?.water ?? null))
    if (heat === null || (hotWater !== 'none' && water === null)) {
      setError(`Bitte geben Sie den Anteil zwischen ${min} und ${max} % an, mit höchstens zwei Nachkommastellen.`)
      return keepDraft
    }
    try {
      await api(`/api/heating-plants/${plant.id}/periods/${view.period}/distribution`, {
        method: 'PUT',
        // § 8 Abs. 1: beide Werte, das Warmwasser nur bei zentralem Warmwasser (Abweichung 14).
        body: JSON.stringify({
          heatConsumptionPct: heat,
          waterConsumptionPct: water,
          insulationRule: insulationAsked(energy) ? (insulation === '' ? 'unknown' : insulation) : 'notApplies',
          above70Agreed: agreed,
        }),
      })
      setError('')
      toast('Anteil gespeichert.')
      onChanged()
    } catch (e) {
      setError(errorText(e))
      return keepDraft
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
      // Der Grund meldet seinen Fehler am Feld (geworfen an GapReason), nicht noch einmal oben (Durchsicht K5).
      if (status === 'impossible') throw e
      setError(errorText(e))
    }
  }

  const printed = self?.units.filter((u) => u.unitId === printUnit) ?? []

  return (
    <>
      {/* Eine Sammelmeldung für alle Karten der eigenen Abrechnung, über der ersten (#346, Schritt 3). */}
      <ErrorSummary errors={errors} />
      <Card title="Anteil nach Verbrauch" level={3}>
        <p className="muted">
          Von den Kosten der Heizung und des Warmwassers verteilt Mietfuchs diesen Teil nach dem gemessenen Verbrauch
          (<Term id="consumptionCosts">Verbrauchskosten</Term>), den Rest nach der Fläche (<Term id="baseCosts">Grundkosten</Term>).
        </p>
        {d ? distributionLines(d).map((l) => <p key={l}>{l}</p>) : <p className="muted">Noch kein Anteil festgelegt.</p>}
        {insulationAsked(energy) && (
          <div className="no-print">
            <label className="field">
              <span>{INSULATION_QUESTION} (<Term id="forcedConsumptionShare">Pflichtanteil</Term>)</span>
              <select value={insulation} disabled={draft.saving} onChange={(e) => edit({ insulation: e.target.value as InsulationRule | '' })}>
                {insulation === '' && <option value="">— bitte wählen —</option>}
                {INSULATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <p className="muted">{insulationExplained()}</p>
          </div>
        )}
        {hint && <NoticeBox level="warning" action={hint} />}
        {(editable || toForced || waterMissing) && (
          <div className="row no-print">
            {/* Das Warmwasser übernimmt den Wert der Heizung sichtbar, bis der Vermieter ihn ändert. */}
            {(editable || toForced) && <label className="field">
              Heizung in % ({min} bis {max})
              <input inputMode="decimal" value={forced !== null ? String(forced) : share} disabled={forced !== null || draft.saving}
                onChange={(e) => edit({ share: e.target.value, ...(waterShare === '' || waterShare === share ? { waterShare: e.target.value } : {}) })} />
            </label>}
            {hotWater !== 'none' && (editable || waterMissing) && (
              <label className="field">
                Warmwasser in %
                <input inputMode="decimal" value={waterShare} disabled={draft.saving} onChange={(e) => edit({ waterShare: e.target.value })} />
              </label>
            )}
          </div>
        )}
        {(editable || waterMissing) && (
          <div className="no-print">
            <label className="checkline">
              <input type="checkbox" checked={agreed} disabled={draft.saving} onChange={(e) => edit({ agreed: e.target.checked })} />
              Mehr als {max} % nach Verbrauch sind mit den Mietern vereinbart (§ 10 HeizkostenV)
            </label>
            <p className="muted">Nur ankreuzen, wenn es im Mietvertrag oder einer Vereinbarung mit den Mietern steht; mehr als 100 % gibt es nicht. Die Angabe gilt mit dem Anteil.</p>
          </div>
        )}
        {!editable && toForced && <p className="muted no-print">Mit „Speichern“ tragen Sie den Pflichtanteil ein.</p>}
        {waterMissing && <p className="muted no-print">Für das Warmwasser fehlt noch ein Anteil nach Verbrauch; tragen Sie ihn ein, er gilt für diese Heizperiode.</p>}
        <div className="no-print">
          <DraftActions draft={draft} onSave={saveShare} layout="card" what="Anteil nach Verbrauch" />
        </div>
      </Card>
      {self && (
        <Card title="Ablesungen" level={3}>
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
                          <button className="btn secondary" onClick={() => setReasonFor(key)}>Nicht möglich</button>
                          <button className="btn secondary" onClick={() => answer(u.unitId, b.date, 'missed')}>Nicht durchgeführt</button>
                          {b.gap !== null && <button className="btn ghost" onClick={() => answer(u.unitId, b.date, null)}>Antwort zurücknehmen</button>}
                        </div>
                        {reasonFor === key && <GapReason saved={b.gapReason ?? ''} scope={key} onSave={(reason) => answer(u.unitId, b.date, 'impossible', reason)} onCancel={() => setReasonFor(null)} />}
                      </div>
                    )}
                  </div>
                </div>
              )
            }))}
          </div>
        </Card>
      )}
      {/* Heizung PR 13: Schätzung nach § 9a, direkt hinter den Ablesungen. */}
      {self && <EstimateCard plant={plant} view={view} self={self} onChanged={onChanged} />}
      {self && self.ok && (
        <Card title="Verteilung" level={3}>
          {self.pots.flatMap(potLines).map((l) => <p key={l}>{l}</p>)}
          {self.units.flatMap((u) => u.users).map((u) => <p key={u.key}>{userLine(u, self)}</p>)}
          <HcaBlock self={self} unitName={(id) => self.units.find((u) => u.unitId === id)?.unitName ?? id} />
        </Card>
      )}
      {self && (
        <Card title={<>Ableseergebnis · {view.label}</>} level={3} className="reading-result">
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
        </Card>
      )}
    </>
  )
}

// Der Grund, warum eine Zwischenablesung nicht möglich war (I3): ein Entwurf am Feld (#309, #346 Schritt 7); er steht
// in der Abrechnung und ist deshalb Pflicht.
function GapReason({ saved, scope, onSave, onCancel }: { saved: string; scope: string; onSave: (reason: string) => Promise<void>; onCancel: () => void }) {
  const draft = useDraft(saved, { scope })
  async function save(value: string) {
    if (value.trim() === '') throw new Error('Bitte nennen Sie den Grund; er steht in der Abrechnung.')
    await onSave(value.trim())
  }
  return (
    <div className="row">
      <label className="field">
        Warum war die Zwischenablesung nicht möglich? (steht in der Abrechnung)
        <input value={draft.value} disabled={draft.saving} onChange={(e) => draft.set(e.target.value)} />
      </label>
      <DraftActions draft={draft} onSave={save} what="Grund" />
      {!draft.dirty && <button className="btn secondary" type="button" onClick={onCancel}>Abbrechen</button>}
    </div>
  )
}
