// Seitenfenster „Kontoauszug einlesen“ (#188, Teil 3): Vorschau des Servers mit Befunden, Rückfragen und dem Satz zum
// Ergebnis; jede Antwort plant neu, „Einlesen“ schickt Datei, Antworten und Marke. Antwortet der Server 409, steht die
// neue Vorschau da. Die Datei und die Rückfragen (darin private Umsätze) leben nur im Zustand dieses Fensters, nie im
// Browserspeicher; Schließen verwirft alles.
import { useEffect, useRef, useState } from 'react'
import { api, ApiError, errorText, fmtEuro } from '../api'
import { importDecisionsOf, questionKey, questionProblems, type QuestionAnswer } from '../bankView'
import type { BankImportPreview, BankImportQuestion } from '../types'
import Drawer from './Drawer'
import Field from './Field'
import { NoticeBox } from './Notice'
import { RENTAL_QUESTION } from './BankAccountsCard'

export type TenancyOption = { id: string; label: string }

const germanDay = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

function form(file: File, fields: Record<string, string>): FormData {
  const fd = new FormData()
  fd.append('statement', file, file.name)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return fd
}

export default function BankImportDrawer({ file, tenancies, onClose, onDone }: {
  file: File
  tenancies: readonly TenancyOption[]
  onClose: () => void
  onDone: (sentence: string) => void
}) {
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({})
  const [preview, setPreview] = useState<BankImportPreview | null>(null)
  const [planning, setPlanning] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState<string | null>(null)
  const seq = useRef(0)
  // Die Fragen der ersten Vorschau bleiben stehen, auch wenn eine Antwort sie beantwortet und der Server sie nicht mehr
  // nennt; sonst verschwände das Feld unter der Hand.
  const [questions, setQuestions] = useState<BankImportQuestion[]>([])

  useEffect(() => {
    const mine = ++seq.current
    setPlanning(true)
    const decisions = importDecisionsOf(questions, answers)
    api<BankImportPreview>('/api/bank/import/plan', { method: 'POST', body: form(file, { decisions: JSON.stringify(decisions) }) })
      .then((p) => {
        if (mine !== seq.current) return
        setPreview(p)
        merge(p)
        setError(null)
      })
      .catch((e: unknown) => {
        if (mine === seq.current) setError(errorText(e))
      })
      .finally(() => {
        if (mine === seq.current) setPlanning(false)
      })
  }, [file, answers]) // eslint-disable-line react-hooks/exhaustive-deps -- `questions` wächst nur aus der Antwort

  const answer = (key: string, patch: QuestionAnswer) => {
    setStale(null)
    // Eine geänderte Antwort zum Konto stellt die Fragen zu seinen Eingängen neu (Durchsicht Teil 3, W4): Nach „Nein“
    // fragt der Server nicht mehr nach ihnen, und eine alte Frage sperrte sonst „Einlesen“.
    if (key.startsWith('account:')) {
      setQuestions((qs) => qs.filter((q) => q.type === 'account'))
      setAnswers((a) => ({ ...Object.fromEntries(Object.entries(a).filter(([k]) => k.startsWith('account:'))), [key]: { ...a[key], ...patch } }))
      return
    }
    setAnswers((a) => ({ ...a, [key]: { ...a[key], ...patch } }))
  }
  // Neue Fragen kommen dazu. Trägt eine neue Frage einen Vorschlag des Servers (Name und Betrag passen zu genau einem
  // Mietverhältnis), steht er als Antwort darin, solange noch keine gegeben ist; „Einlesen“ bestätigt ihn, der Grund
  // steht am Feld.
  const merge = (p: BankImportPreview) => {
    setQuestions((qs) => [...qs, ...p.questions.filter((q) => !qs.some((x) => questionKey(x) === questionKey(q)))])
    const suggested = p.questions.flatMap((q) => (q.type === 'entry' && q.suggestion ? [{ key: questionKey(q), q, s: q.suggestion }] : []))
    if (suggested.length > 0) {
      setAnswers((a) => {
        const fresh = suggested.filter(({ key }) => a[key] === undefined)
        if (fresh.length === 0) return a
        // Ohne „als Zahler merken“ (Durchsicht): Ein Vorschlag aus Name und Betrag darf kein Konto dauerhaft merken; sonst
        // würde jeder spätere Eingang davon auch auf einem Mischkonto einzeln gespeichert, ohne dass jemand es gewählt hat.
        return { ...a, ...Object.fromEntries(fresh.map(({ key, s }) => [key, { as: 'rent' as const, tenancyId: s.tenancyId, rememberPayer: false }])) }
      })
    }
  }
  // Gezeigt und geprüft werden die Fragen, die der Server noch stellt, und die schon beantworteten.
  const shown = questions.filter((q) => answers[questionKey(q)] !== undefined || (preview?.questions ?? []).some((p) => questionKey(p) === questionKey(q)))
  const open = questionProblems(shown, answers)
  const unanswered = shown.filter((q) => q.type === 'entry' && answers[questionKey(q)]?.as === undefined)
  const ready = !planning && preview !== null && preview.ready && open.length === 0

  const submit = async () => {
    if (!preview || !ready || busy) return
    setBusy(true)
    try {
      const decisions = importDecisionsOf(questions, answers)
      const res = await api<{ ok: true; sentence: string }>('/api/bank/import', { method: 'POST', body: form(file, { decisions: JSON.stringify(decisions), token: preview.token }) })
      onDone(res.sentence)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data.preview) {
        const fresh = e.data.preview as BankImportPreview
        setPreview(fresh)
        merge(fresh)
        setStale(e.message)
      } else setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open title="Kontoauszug einlesen" subtitle={file.name} onClose={onClose} value={answers} busy={busy} onSubmit={() => void submit()}
      actions={<button type="button" className="btn" disabled={!ready || busy} aria-describedby={!ready && !planning && preview ? 'bank-import-why' : undefined} onClick={() => void submit()}>Einlesen</button>}>
      {error && <NoticeBox level="error" action={error} />}
      {stale && <NoticeBox level="warning" action={stale} />}
      {planning && !preview && <p className="muted">Die Datei wird gelesen …</p>}
      {preview && (
        <>
          {/* Solange Rückfragen offen sind, zählt der Satz nur die Tage ohne Frage („0 Umsätze übernommen“, #644); er steht
              erst da, wenn alles beantwortet ist. Was fehlt, sagt der Satz unter den Fragen. */}
          {(preview.ready || preview.questions.length === 0) && <p role="status">{preview.sentence}</p>}
          {/* Was der Satz zum Ergebnis schon sagt ("schon eingelesen"), steht nicht noch einmal als Befund (Klicktest B2). */}
          {preview.findings.filter((f) => f.message !== preview.sentence).map((f, i) => <NoticeBox key={i} level="error" context={f.where} action={f.message} />)}
          {/* Nachtrag 13.11.: Hundert private Eingänge sollen nicht hundert Klicks kosten. „privat“ ist die sichere Wahl, davon
              bleibt nur die Tagessumme; gegebene Antworten und Vorschläge bleiben stehen. */}
          {unanswered.length > 1 && (
            <div>
              <button type="button" className="btn secondary" onClick={() => {
                setStale(null)
                setAnswers((a) => ({ ...a, ...Object.fromEntries(unanswered.map((q) => [questionKey(q), { as: 'private' as const }])) }))
              }}>{`Alle übrigen als privat (${unanswered.length})`}</button>
            </div>
          )}
          {shown.map((q) => {
            const key = questionKey(q)
            const a = answers[key] ?? {}
            if (q.type === 'account') {
              return (
                <fieldset key={key} className="field-group">
                  <legend className="sr-only">Konto</legend>
                  <p>{`Das Konto ${q.iban ?? q.otherId ?? ''} wurde noch nie eingelesen. Ist es Ihr Konto für Mieteingänge?`}</p>
                  <p className="muted">Ein Kautionskonto lesen Sie hier bitte nicht ein.</p>
                  {/* Untereinander: nebeneinander liefen die beiden Antworten am schmalen Fenster in eine Zeile (Klicktest 13.11.). */}
                  <div className="flex flex-col gap-1">
                    <label><input type="radio" name={key} checked={a.accept === true && !a.rental} onChange={() => answer(key, { accept: true, rental: false })} /> Ja, mein Konto für Mieteingänge</label>
                    {/* Nachtrag 13.11.: Ein reines Vermieterkonto gleich als solches anlegen; dann gibt es keine Rückfrage je
                        Eingang. Der Satz darunter ist dieselbe Bestätigung wie in der Karte „Konten“. */}
                    <label><input type="radio" name={key} checked={a.accept === true && a.rental === true} aria-describedby={`${key}-rental`} onChange={() => answer(key, { accept: true, rental: true })} /> Ja, ein Konto nur für die Vermietung</label>
                    <p id={`${key}-rental`} className="muted m-0">{RENTAL_QUESTION}</p>
                    <label><input type="radio" name={key} checked={a.accept === false} onChange={() => answer(key, { accept: false, rental: false })} /> Nein, nicht einlesen</label>
                  </div>
                </fieldset>
              )
            }
            const from = q.counterpartyName ?? q.counterpartyIban ?? 'unbekannter Herkunft'
            return (
              <fieldset key={key} className="field-group">
                <legend className="sr-only">Eingang</legend>
                <Field label={`Was ist der Eingang vom ${germanDay(q.bookingDate)} über ${fmtEuro(q.amountCents)} von ${from}?`} hint={q.purpose || undefined} required>
                  <select value={a.as ?? ''} onChange={(e) => {
                    const as = (e.target.value || undefined) as QuestionAnswer['as']
                    answer(key, { as, ...((as === 'rent' || as === 'deposit') && a.rememberPayer === undefined ? { rememberPayer: q.counterpartyIban !== null } : {}) })
                  }}>
                    <option value="">Bitte wählen</option>
                    <option value="rent">Mieteingang</option>
                    <option value="deposit">Kaution</option>
                    <option value="private">privat</option>
                  </select>
                </Field>
                {(a.as === 'rent' || a.as === 'deposit') && (
                  <Field label="Mietverhältnis" required
                    hint={q.suggestion && a.as === 'rent' && a.tenancyId === q.suggestion.tenancyId ? `Vorschlag: ${q.suggestion.reason}` : undefined}>
                    <select value={a.tenancyId ?? ''} onChange={(e) => answer(key, { tenancyId: e.target.value || undefined })}>
                      <option value="">Bitte wählen</option>
                      {tenancies.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </Field>
                )}
                {/* Auch bei der Kaution (#644): Gemerkt erkennt die Zuordnung danach das Mietverhältnis über die IBAN. */}
                {(a.as === 'rent' || a.as === 'deposit') && q.counterpartyIban !== null && (
                  <label><input type="checkbox" checked={a.rememberPayer === true} onChange={(e) => answer(key, { rememberPayer: e.target.checked })} /> Dieses Konto als Zahler merken</label>
                )}
              </fieldset>
            )
          })}
          {!ready && !planning && <p id="bank-import-why" className="muted">{open.length > 0 ? 'Bitte beantworten Sie zuerst die Rückfragen.' : 'In dieser Datei ist nichts einzulesen.'}</p>}
        </>
      )}
    </Drawer>
  )
}
