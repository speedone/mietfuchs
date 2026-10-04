// „Auswertung prüfen“ (Belegbuchung, #170): die Zeilen eines ausgewerteten Belegs mit Ampel,
// Vorschlag und Kandidaten, die Vorschau des Servers und das Buchen genau dieser Vorschau.
// Schnellerfassung und KI auf der Kostenseite benutzen sie; der Posteingang führt mit „Weiter
// prüfen“ in die Schnellerfassung. Die Entscheidungslogik steht in client/src/assessment.ts.
import { Fragment, useEffect, useState } from 'react'
import type { AssessmentView, BookingPreview, Unit } from '../types'
import { errorText, fmtEuro } from '../api'
import {
  bookDecisions, bookedLines, categoryOptions, changeAssessmentYear, decisionsOf, initialRows, linesShape, linkChoices, planDecisions, previewLines, shownRow, withConfirmed, confirmLabel, type RowAction, type RowDraft,
} from '../assessment'
import { aiPositionDefaults, type KeyContext } from '../costForm'
import AiKeyCell from './AiKeyCell'
import Table from './Table'
import { useConfirm } from './feedback'

type Props = {
  assessment: AssessmentView
  units: Unit[]
  // Woraus der Schlüssel einer geänderten Kostenart vorgeschlagen wird (#141)
  keyContext?: KeyContext
  onChange: (next: AssessmentView) => void
  onOpenItem?: (costItemId: string) => void
}

const ACTIONS: readonly string[] = ['', 'create', 'dismiss', 'release']
const isAction = (v: string): v is RowAction => ACTIONS.includes(v) || v.startsWith('link:')

export default function AssessmentReview({ assessment: a, units, keyContext, onChange, onOpenItem }: Props) {
  const confirm = useConfirm()
  const [rows, setRows] = useState<Record<number, RowDraft>>(() => initialRows(a))
  const [preview, setPreview] = useState<BookingPreview | null>(null)
  // Die Erfolgsmeldung samt der Gestalt der Zeilen, die die Buchung hinterlassen hat
  const [booked, setBooked] = useState<{ lines: string[]; shape: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Die Eingaben beginnen von vorn, wenn sich Zustand oder Nummern der Zeilen ändern, also nach
  // einer Buchung dieses Belegs. Nicht bei jeder neuen Antwort: Bucht der Nutzer einen anderen
  // Beleg, lädt die Seite alle Auswertungen neu, und was er hier gerade eingibt, bliebe sonst
  // nicht stehen (Durchsicht zu #170).
  // Zurückgesetzt wird beim Rendern und nicht in einem Effekt: Ein Effekt lief auch beim ersten
  // Einfügen der Karte und erst nach dem Zeichnen, und eine Eingabe, die in diese Lücke fiel, war
  // danach still verschwunden (in Abnahme A wurde so nur eine von zwei Zeilen verknüpft).
  // Vorschau und Erfolgsmeldung gehen mit: Eine Vorschau sah den alten Stand, und ein „✓ Gebucht“
  // gilt nur für den Stand, den die eigene Buchung hinterlassen hat. Ändert sich die Gestalt von
  // außen (ein anderer Tab löscht die Position), wäre er für einen Augenblick irreführend.
  const shape = linesShape(a)
  const [rowsShape, setRowsShape] = useState(shape)
  if (rowsShape !== shape) {
    setRowsShape(shape)
    setRows(initialRows(a))
    setPreview(null)
    setBooked((b) => (b && b.shape === shape ? b : null))
  }
  // Eine Vorschau gilt nur für den Stand, den sie gesehen hat: Kommt die Auswertung neu (anderes
  // Jahr, eine andere Karte gebucht, Neuladen), verschwindet sie. Gebucht würde ohnehin nicht an
  // ihr vorbei (die Marke ergäbe „veraltet“), aber sie soll nichts zeigen, was nicht mehr gilt.
  useEffect(() => {
    setPreview(null)
  }, [a])
  // Was gezeigt wird, wird gebucht (shownRow): ein nicht mehr angebotenes Ziel gilt als offen.
  const shown: Record<number, RowDraft> = {}
  for (const line of a.lines) {
    const row = rows[line.idx]
    if (row) shown[line.idx] = shownRow(line, row)
  }
  const decisions = decisionsOf(a, shown)

  const patch = (idx: number, p: Partial<RowDraft>) => {
    setRows((r) => {
      const current = r[idx]
      return current ? { ...r, [idx]: { ...current, ...p } } : r
    })
    // Eine Vorschau gilt nur für das, was sie gesehen hat.
    setPreview(null)
    setBooked(null)
  }

  async function showPreview() {
    setBusy(true)
    setError('')
    try {
      setPreview(await planDecisions(a.id, decisions))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function book() {
    if (!preview || busy) return
    let toSend = decisions
    if (preview.confirm.length > 0) {
      const idxs = preview.confirm.flatMap((c) => (c.idx === null ? [] : [c.idx]))
      const ok = await confirm({
        title: 'Schon erfasst?',
        message: preview.confirm.map((c) => c.message).join(' '),
        confirmLabel: confirmLabel(decisions, idxs),
        cancelLabel: 'Abbrechen',
      })
      if (!ok) return
      toSend = withConfirmed(decisions, idxs)
    }
    setBusy(true)
    setError('')
    try {
      const result = await bookDecisions(a.id, toSend, preview.token)
      if (result.kind === 'done') {
        setBooked({ lines: bookedLines(result.preview), shape: linesShape(result.assessment) })
        setPreview(null)
        onChange(result.assessment)
      } else if (result.kind === 'conflict') {
        setError(result.message)
        setPreview(null)
        onChange(result.assessment)
      } else {
        // Abgelehnt oder auf einem anderen Stand: die neue Vorschau zeigen, nichts ist gebucht.
        setError(result.message)
        setPreview(result.preview)
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function changeYear(year: number) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setPreview(null)
      onChange(await changeAssessmentYear(a.id, year))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const years = [a.year - 2, a.year - 1, a.year, a.year + 1]
  return (
    <div className="assessment-review">
      <div className="row" style={{ alignItems: 'center', marginTop: 8 }}>
        <label className="field">
          Jahr der Buchung
          <select aria-label="Jahr der Buchung" value={a.year} disabled={busy} onChange={(e) => void changeYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      {a.propertyId === null && (
        <div className="warn">Zu welchem Objekt gehört dieser Beleg? Wählen Sie es bitte im Posteingang; gebucht wird nur innerhalb eines Objekts.</div>
      )}
      {a.sumWarning && <div className="warn" style={{ marginTop: 8 }}>⚠ {a.sumWarning}</div>}
      {/* Gerechnetes benennen, damit es geprüft werden kann (#34) */}
      {a.amountsAdjusted === 'netto' && (
        <div className="notice" style={{ marginTop: 8 }}>
          Die Positionen standen ohne Umsatzsteuer auf der Rechnung. Mietfuchs hat sie auf den Rechnungsbetrag hochgerechnet. Bitte die Beträge kurz prüfen.
        </div>
      )}
      {a.laborFromTotal && (
        <div className="notice" style={{ marginTop: 8 }}>
          Der Arbeitskostenanteil nach §35a stand nur als ein Betrag auf der Rechnung. Mietfuchs hat ihn nach Beträgen auf die Positionen verteilt; Fahrtkosten und Material gehören streng genommen nicht dazu.
        </div>
      )}
      <Table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th><span className="sr-only">Ampel</span></th>
            <th>Was geschieht?</th>
            <th>Beschreibung</th>
            <th>Kostenart</th>
            <th>Umlageschlüssel</th>
            <th className="num">Betrag €</th>
            <th className="num">§35a €</th>
          </tr>
        </thead>
        <tbody>
          {a.lines.map((line) => {
            const row = shown[line.idx]
            if (!row) return null
            if (line.state === 'created' || line.state === 'linked') {
              return (
                <tr key={line.idx}>
                  <td><span className="ampel gruen" /></td>
                  <td>
                    {line.state === 'created' ? `✓ angelegt als „${line.itemDescription ?? '?'}“` : `✓ verknüpft mit „${line.itemDescription ?? '?'}“`}
                    {line.state === 'linked' && (
                      <label style={{ marginLeft: 8 }}>
                        <input type="checkbox" aria-label={`„${line.description}“ lösen`} checked={row.action === 'release'}
                          onChange={(e) => patch(line.idx, { action: e.target.checked ? 'release' : '' })} /> lösen
                      </label>
                    )}
                  </td>
                  <td>{line.description}</td>
                  <td>{line.category}</td>
                  <td />
                  <td className="num">{line.amountCents === null ? '—' : fmtEuro(line.amountCents)}</td>
                  <td className="num">{line.labor35aCents === null ? '—' : fmtEuro(line.labor35aCents)}</td>
                </tr>
              )
            }
            const s = line.suggestion
            return (
              <Fragment key={line.idx}>
                <tr>
                  <td><span className={`ampel ${s?.level ?? 'gruen'}`} title={s?.reasons.join('\n')} /></td>
                  <td>
                    <select aria-label={`Was geschieht mit „${line.description}“?`} value={row.action}
                      onChange={(e) => { if (isAction(e.target.value)) patch(line.idx, { action: e.target.value }) }}>
                      {/* Eine verworfene Zeile steht als verworfen da. Wieder öffnen kennt der Server
                          nicht; anlegen oder verknüpfen lässt sie sich weiterhin. */}
                      {line.state === 'dismissed'
                        ? <option value="dismiss">✗ verworfen</option>
                        : <option value="">— offen lassen —</option>}
                      <option value="create">Neu anlegen</option>
                      {linkChoices(line, row).map((c) => (
                        <option key={c.id} value={`link:${c.id}`}>Mit „{c.description}“ ({fmtEuro(c.amountCents)}{c.invoiceFile ? '' : ', ohne Beleg'}) verknüpfen</option>
                      ))}
                      {line.state !== 'dismissed' && <option value="dismiss">Verwerfen</option>}
                    </select>
                  </td>
                  <td><input aria-label="Beschreibung" value={row.description} onChange={(e) => patch(line.idx, { description: e.target.value })} style={{ width: '100%' }} /></td>
                  <td>
                    <select aria-label="Kostenart" value={row.category}
                      onChange={(e) => patch(line.idx, { category: e.target.value, externalTotalAmount: '', ...aiPositionDefaults(e.target.value, units, [], keyContext, row.description) })}>
                      {categoryOptions(row.category).map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td><AiKeyCell position={row} units={units} onChange={(p) => patch(line.idx, p)} /></td>
                  <td className="num"><input aria-label="Betrag €" value={row.amount} onChange={(e) => patch(line.idx, { amount: e.target.value })} style={{ width: 100, textAlign: 'right' }} /></td>
                  <td className="num"><input aria-label="§35a €" value={row.labor35a} onChange={(e) => patch(line.idx, { labor35a: e.target.value })} style={{ width: 90, textAlign: 'right' }} placeholder="—" /></td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </Table>
      {/* Begründungen und Positionen, die im Formular gepflegt werden, stehen unter der Tabelle:
          in einer Zeile scrollten sie auf dem Handy mit (Durchsicht zu #170). */}
      <div style={{ marginTop: 6 }}>
        {a.lines.flatMap((l) => (l.state === 'open' && l.suggestion && l.suggestion.level !== 'gruen'
          ? l.suggestion.reasons.map((r) => <span key={`${l.idx}-${r}`} className={`chip ${l.suggestion?.level ?? 'gelb'}`}>{r}</span>)
          : []))}
      </div>
      {a.lines.flatMap((l) => (l.state === 'open' ? (l.suggestion?.candidates ?? []).filter((c) => c.formOnly).map((c) => (
        <div key={`${l.idx}-${c.id}`} className="warn" style={{ marginTop: 6 }}>
          „{l.description}“: „{c.description}“ wird {c.key === 'amounts' ? 'mit Einzelbeträgen je Mieter' : 'laut Gemeinschaftsabrechnung'} verteilt; ihren Betrag pflegen Sie im Formular. Haben Sie die Position dort aktualisiert, verwerfen Sie diese Zeile hier danach, damit der Beleg nicht offen bleibt.{' '}
          {onOpenItem && <button className="btn small" onClick={() => onOpenItem(c.id)}>Position öffnen</button>}
        </div>
      )) : []))}
      {preview && (
        <div className="card" aria-label="Vorschau" style={{ marginTop: 10 }}>
          <strong>Vorschau</strong>
          <ul>{previewLines(preview).map((t) => <li key={t}>{t}</li>)}</ul>
          {preview.notices.map((n) => <div key={n} className="notice">{n}</div>)}
          {preview.errors.map((e, i) => {
            const id = e.openItemId
            return (
              <div key={i} className="error">
                {e.message}{' '}
                {id && onOpenItem && <button className="btn small" onClick={() => onOpenItem(id)}>Position öffnen</button>}
              </div>
            )
          })}
        </div>
      )}
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      {booked && <div className="notice" aria-label="Gebucht" style={{ marginTop: 8 }}>✓ Gebucht: {booked.lines.join(' · ')}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <a href={`/uploads/${encodeURIComponent(a.file)}`} target="_blank" rel="noreferrer">📎 Beleg ansehen</a>
        <div className="grow" />
        <button className="btn secondary" disabled={busy || decisions.length === 0} onClick={() => void showPreview()}>Vorschau</button>
        <button className="btn" disabled={busy || !preview || preview.errors.length > 0} onClick={() => void book()}>Buchen</button>
      </div>
    </div>
  )
}
