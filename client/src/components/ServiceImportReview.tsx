// Prüfansicht einer ausgelesenen Messdienstabrechnung (Heizung PR 20, #103). Nichts ist gespeichert, bis der
// Vermieter einen der drei Knöpfe wählt; jeder Knopf schreibt über die bestehende Route. Die Logik steht in
// serviceImport.ts.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useConfirm, useToast } from './feedback'
import Table from './Table'
import Term from './Term'
import { CO2_ANSWER_OPTIONS, CO2_EXAMPLE, CO2_QUESTION, co2Body, co2ToForm, probeLine, type Co2Answer } from '../co2Form'
import {
  answerConflict, blockBlocked, co2FormFromExtraction, deductionHint, DHW_LABELS, dhwNote, draftsOf, duplicateBlocks, itemBodies, serviceChecks, targetOptions,
  type BlockDraft, type ImportContext,
} from '../serviceImport'
import { spansTwoYears } from '../../../shared/period.ts'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { CATEGORIES, type HeatingPeriodView, type ServiceStatementExtraction } from '../types'

export default function ServiceImportReview({ x, file, ctx, view, co2 = true, onDone }: {
  x: ServiceStatementExtraction
  file: string
  ctx: ImportContext
  view: HeatingPeriodView
  // Sind für diese Heizperiode CO₂-Kosten aufzuteilen (wie die Karte „CO₂-Kosten“)? Sonst keine Frage danach.
  co2?: boolean
  onDone: () => void
}) {
  const [drafts, setDrafts] = useState<BlockDraft[]>(() => draftsOf(x, ctx))
  const [answer, setAnswer] = useState<Co2Answer>('')
  // Die eben angelegte Heizposition, mit der die CO₂-Angaben verknüpft werden (Prüfung S5).
  const [heatingItemId, setHeatingItemId] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()
  const confirm = useConfirm()
  const options = targetOptions(ctx)
  const checks = serviceChecks(x, ctx)
  const setDraft = (i: number, next: Partial<BlockDraft>) => setDrafts((all) => all.map((d, k) => (k === i ? { ...d, ...next } : d)))

  async function createItems() {
    const r = itemBodies(x, drafts, ctx, file)
    if ('error' in r) {
      setError(r.error)
      return
    }
    if (r.bodies.length === 0) {
      setError('Es ist kein Block zum Anlegen gewählt. Setzen Sie den Haken bei den Blöcken, die Sie übernehmen wollen.')
      return
    }
    // Durchsicht S4: Gibt es den Block schon (erneut ausgelesen), wird nicht still ein zweites Mal angelegt.
    const twice = duplicateBlocks(x, drafts, ctx)
    if (twice.length > 0) {
      const ok = await confirm({
        title: 'Diese Kosten gibt es schon',
        message: `Für ${twice.map((t) => `„${t}“`).join(', ')} stehen schon Einzelbeträge in der Abrechnung. Legen Sie die Positionen nur an, wenn sie noch fehlen; sonst stünden die Kosten doppelt in der Abrechnung.`,
        confirmLabel: 'Trotzdem anlegen',
        defaultChoice: 'cancel',
      })
      if (!ok) return
    }
    setBusy(true)
    let created = 0
    try {
      for (const [k, body] of r.bodies.entries()) {
        const item = await api<{ id: string }>('/api/costItems', { method: 'POST', body: JSON.stringify(body) })
        if (body.category === HEATING_CATEGORY) setHeatingItemId(item.id)
        // Angelegt ist angelegt (Durchsicht S3): Der Haken dieses Blocks geht sofort weg, damit ein zweiter Klick
        // nach einem Fehler bei einem späteren Block ihn nicht noch einmal anlegt.
        const index = r.blocks[k]
        setDrafts((all) => all.map((d, j) => (j === index ? { ...d, include: false } : d)))
        created++
      }
      setError('')
      toast(`${created} Position${created === 1 ? '' : 'en'} angelegt.`)
      onDone()
    } catch (e) {
      setError(errorText(e))
      // Was schon angelegt ist, soll die Seite zeigen (Einzelbeträge der Heizperiode, Probe).
      if (created > 0) onDone()
    } finally {
      setBusy(false)
    }
  }

  async function saveCo2() {
    const co2Ctx = { items: view.items, unitsCount: x.unitsCount ?? ctx.units.length }
    const form = { ...co2FormFromExtraction(x, co2ToForm(view.co2, co2Ctx), heatingItemId), answer }
    const r = co2Body(form, co2Ctx)
    if ('error' in r) {
      setError(r.error)
      return
    }
    // Wie auf der Karte „CO₂-Kosten“: Geht die Probe nicht auf, wird nicht still gespeichert.
    const probe = probeLine(form, co2Ctx)
    if (probe && !probe.ok) {
      const ok = await confirm({
        title: 'Die Probe geht nicht auf',
        message: `${probe.text}. Solange die Probe nicht aufgeht, bucht Mietfuchs keine CO₂-Aufteilung, und die Abrechnung meldet einen Fehler. Legen Sie zuerst die Positionen an und prüfen Sie Ihre Antwort auf die Frage nach der Abzugszeile. Trotzdem speichern?`,
        confirmLabel: 'Trotzdem speichern',
      })
      if (!ok) return
    }
    try {
      await api(`/api/heating-plants/${ctx.plantId}/periods/${ctx.heating.key}/co2`, { method: 'PUT', body: JSON.stringify(r.body) })
      setError('')
      toast('CO₂-Angaben gespeichert.')
      onDone()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function saveHotWater() {
    if (!x.dhwMethod) return
    try {
      await api(`/api/heating-plants/${ctx.plantId}/periods/${ctx.heating.key}/hot-water`, { method: 'PUT', body: JSON.stringify({ dhwMethod: x.dhwMethod }) })
      setError('')
      toast('Angabe zum Warmwasser gespeichert.')
      onDone()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const hint = deductionHint(x)
  const conflict = answerConflict(x, answer)
  const note = x.dhwMethod ? dhwNote(x.dhwMethod) : null
  return (
    <div className="field-group">
      <p className="muted">Die KI hat die Abrechnung gelesen. Bitte prüfen Sie jede Zahl am Beleg, bevor Sie etwas übernehmen.</p>
      {checks.length > 0 && <ul className="notice">{checks.map((c) => <li key={c}>{c}</li>)}</ul>}
      {x.blocks.map((b, i) => {
        const d = drafts[i]
        if (!d) return null
        const blocked = blockBlocked({ ...b, category: d.category }, ctx)
        const title = b.title || 'Kostenblock'
        const span = d.category === HEATING_CATEGORY ? ctx.heating : ctx.object
        return (
          <fieldset key={`${b.title}-${i}`}>
            <legend>
              <label className="checkline">
                <input type="checkbox" checked={d.include} disabled={blocked !== null} onChange={(e) => setDraft(i, { include: e.target.checked })} />
                {title}
              </label>
            </legend>
            {blocked && <p className="muted">{blocked}</p>}
            <div className="row">
              <label className="field">
                Kostenart
                <select aria-label={`Kostenart „${title}“`} value={d.category} onChange={(e) => setDraft(i, { category: [...CATEGORIES].find((c) => c === e.target.value) ?? '' })}>
                  <option value="">Bitte wählen …</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="field">
                Betrag der Position{d.category === HEATING_CATEGORY && x.deductionEur !== null ? ' (vor „Abzüglich CO₂-Kosten Vermieter“)' : ''}
                <input aria-label={`Betrag „${title}“`} inputMode="decimal" value={d.amount} onChange={(e) => setDraft(i, { amount: e.target.value })} />
              </label>
              {spansTwoYears(span) && (
                <label className="field">
                  Jahr der Zahlung (für die Steuer)
                  <input aria-label={`Jahr der Zahlung „${title}“ (für die Steuer)`} inputMode="numeric" value={d.taxYear} onChange={(e) => setDraft(i, { taxYear: e.target.value })} />
                </label>
              )}
            </div>
            <Table>
              <thead><tr><th>Nutzer laut Abrechnung</th><th className="num">Betrag</th><th>Gehört zu</th></tr></thead>
              <tbody>
                {b.lines.map((l, k) => (
                  <tr key={`${l.label}-${k}`}>
                    <td>{l.label}{l.unitLabel ? ` · ${l.unitLabel}` : ''}</td>
                    <td className="num">{l.amountEur === undefined ? 'nicht gelesen' : l.amountEur.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td>
                      <select aria-label={`Zuordnung „${l.label}“`} value={d.targets[k] ?? ''} onChange={(e) => setDraft(i, { targets: d.targets.map((t, j) => (j === k ? options.find((o) => o.value === e.target.value)?.value ?? '' : t)) })}>
                        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </fieldset>
        )
      })}
      {x.blocks.length > 0 && <div className="row"><button className="btn" disabled={busy} onClick={() => void createItems()}>Positionen anlegen</button></div>}

      {co2 && (<>
      <h3><Term id="co2Split">CO₂-Kosten</Term></h3>
      <label className="field">
        {CO2_QUESTION}
        <select aria-label="Steht in der Kostenaufstellung eine Abzugszeile?" value={answer} onChange={(e) => setAnswer(CO2_ANSWER_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
          {CO2_ANSWER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <small className="muted">{CO2_EXAMPLE}</small>
      {hint && <p>{hint}</p>}
      {conflict && <p className="notice">{conflict}</p>}
      <div className="row"><button className="btn secondary" onClick={() => void saveCo2()}>CO₂-Angaben übernehmen</button></div>
      </>)}

      {x.dhwMethod && (
        <>
          <p>Warmwasseranteil laut Abrechnung {DHW_LABELS[x.dhwMethod]}.</p>
          {note && <small className="muted">{note}</small>}
          <div className="row"><button className="btn secondary" onClick={() => void saveHotWater()}>Ermittlung übernehmen</button></div>
        </>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  )
}
