// Das Anschreiben bearbeiten (#415): ein Feld je Baustein, die Platzhalter als anklickbare Chips, eine
// Vorschau mit den Werten des Mieters (bei der Vorlage mit Beispielwerten) und „Auf Vorgabe zurücksetzen“
// je Baustein. Dieselbe Oberfläche für die drei Ebenen: Vorlage der Installation (Einstellungen),
// abweichend je Objekt und einmalig je Mieter (Abrechnung).
import { useEffect, useRef, useState } from 'react'
import type { LetterAdjustmentMode, LetterBlock, LetterField, LetterTexts } from '../types'
import { ADJUSTMENT_MODES, adjustmentHint, exceedsOnePage, fieldsFor, LETTER_BLOCKS } from '../../../shared/letter.ts'
import { errorText, fmtEuro } from '../api'
import Drawer from './Drawer'
import Field from './Field'
import { useFormError } from './ErrorSummary'
import { NoticeBox } from './Notice'
import { useSaving } from '../useSaving'
import {
  customCentsOf, draftNewCents, insertField, letterProblems, ownOf, previewOf, setText, shownText, textChanges,
  type LetterDraft, type LetterFieldKey, type LetterLevel,
} from '../letterForm'

export type LetterSave = {
  texts: Partial<Record<LetterBlock, string | null>>
  // nur, wenn sie sich geändert hat; `null` nimmt die eigene Wahl des Mieters weg (Durchsicht K6)
  adjust?: { mode: LetterAdjustmentMode, cents: number | null } | null
}

type Props = {
  open: boolean
  level: LetterLevel
  title: string
  intro: string
  base: Record<LetterBlock, string> // was ohne eigenen Text dieser Ebene gilt
  own: LetterTexts
  values: Partial<Record<LetterField, string>>
  // Installation: die Vorgabe der Anpassung; Mieter: seine Wahl und der Vorschlag von Mietfuchs
  // `own`: Der Mieter hat eine eigene Wahl gespeichert; `defaultMode`: die Vorgabe, die sonst gilt.
  adjust?: { mode: LetterAdjustmentMode, cents: number | null, suggestedCents?: number, own?: boolean, defaultMode?: LetterAdjustmentMode }
  // Mieter: welche Bausteine sein Anschreiben zeigt; die übrigen tragen „erscheint hier nicht“
  shown?: readonly LetterBlock[]
  onClose: () => void
  onSave: (save: LetterSave) => Promise<void>
}

const centsText = (cents: number | null): string => (cents === null ? '' : (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }))

export default function LetterDrawer({ open, level, title, intro, base, own, values, adjust, shown, onClose, onSave }: Props) {
  const initial = (): LetterDraft => ({ own: ownOf(own), adjust: adjust?.mode ?? 'none', adjustOwn: adjust?.own ?? true, customCents: centsText(adjust?.cents ?? null) })
  const [draft, setDraft] = useState<LetterDraft>(initial)
  // Beim Öffnen der gespeicherte Stand; ein offenes Fenster behält seine Eingaben.
  useEffect(() => { if (open) setDraft(initial()) }, [open])
  const errors = useFormError<LetterFieldKey>()
  const { busy, run } = useSaving()
  const refs = useRef<Partial<Record<LetterBlock, HTMLTextAreaElement | null>>>({})
  const modes = level === 'installation' ? ADJUSTMENT_MODES.filter((m) => m.id !== 'custom') : ADJUSTMENT_MODES
  const suggested = adjust?.suggestedCents ?? 0
  const customCents = customCentsOf(draft)
  const hint = level === 'tenancy' && draft.adjust === 'custom' ? adjustmentHint('custom', customCents, suggested) : null
  // Die Vorschau nimmt den neuen Betrag aus dem Entwurf (Durchsicht S4); die Vorlagen zeigen Beispielwerte.
  const previewValues = level === 'tenancy' ? { ...values, VorauszahlungNeu: draftNewCents(draft, suggested) } : values
  const longLetter = exceedsOnePage(LETTER_BLOCKS
    .filter((b) => (shown ? shown.includes(b.id) : !['backPayment', 'balanced', 'adjustSuggestion', 'adjustCustom', 'attachments'].includes(b.id)))
    .map((b) => previewOf(shownText(draft, base, b.id), previewValues)))

  function save() {
    void run(async () => {
      const problems = letterProblems(draft, base, level)
      if (problems.length > 0) {
        errors.report(problems)
        return
      }
      const cents = draft.adjust === 'custom' ? customCents : null
      const savedOwn = adjust?.own ?? true
      const adjustChanged = adjust !== undefined && (draft.adjustOwn
        ? !savedOwn || draft.adjust !== adjust.mode || (draft.adjust === 'custom' && cents !== adjust.cents)
        : savedOwn)
      const adjustSave = draft.adjustOwn ? { mode: draft.adjust, cents } : null
      try {
        await onSave({ texts: textChanges(ownOf(own), draft.own), ...(adjustChanged ? { adjust: adjustSave } : {}) })
      } catch (e) {
        errors.set(`Nicht gespeichert: ${errorText(e)}`)
      }
    })
  }

  function insert(block: LetterBlock, field: LetterField) {
    const el = refs.current[block]
    const text = shownText(draft, base, block)
    const at = el ? { start: el.selectionStart, end: el.selectionEnd } : { start: text.length, end: text.length }
    const next = insertField(text, at.start, at.end, field)
    setDraft((d) => setText(d, base, block, next.text))
    errors.clearField(block)
    requestAnimationFrame(() => {
      const node = refs.current[block]
      if (!node) return
      node.focus()
      node.setSelectionRange(next.caret, next.caret)
    })
  }

  return (
    <Drawer
      open={open}
      title={title}
      width={720}
      onClose={onClose}
      onSubmit={save}
      value={draft}
      busy={busy}
      errors={errors}
      hint="Strg+S speichert · Esc schließt"
      actions={<button className="btn" onClick={save} disabled={busy}>Speichern</button>}
    >
      <p className="muted">{intro}</p>
      {longLetter && <NoticeBox level="warning" title="Anschreiben länger als eine Seite" action="Mit diesen Texten wird das Anschreiben voraussichtlich länger als eine Seite und druckt auf der nächsten weiter. Soll es auf eine Seite passen, kürzen Sie die Texte." />}
      {adjust && <fieldset className="no-connection">
        <legend className="field-legend">Anpassung der Vorauszahlung (§ 560 Abs. 4 BGB)</legend>
        {modes.map((m) => (
          <label key={m.id} className="checkline">
            <input type="radio" name="letter-adjust" checked={draft.adjust === m.id} onChange={() => setDraft((d) => ({ ...d, adjust: m.id, adjustOwn: true }))} />{' '}
            {m.label}{m.id === 'suggestion' && level === 'tenancy' ? ` (${suggested > 0 ? fmtEuro(suggested) : 'kein Vorschlag'})` : ''}
          </label>
        ))}
        {level === 'tenancy' && draft.adjust === 'custom' && (
          <Field label="Neue monatliche Vorauszahlung (€)" width="s" required {...errors.field('customCents')}>
            <input inputMode="decimal" value={draft.customCents} onChange={(e) => setDraft((d) => ({ ...d, customCents: e.target.value }))} />
          </Field>
        )}
        {hint && <NoticeBox level="hint" action={hint} />}
        {level === 'tenancy' && draft.adjustOwn && adjust?.defaultMode && (
          <button type="button" className="btn small ghost" onClick={() => setDraft((d) => ({ ...d, adjust: adjust.defaultMode ?? d.adjust, adjustOwn: false, customCents: '' }))}>
            Anpassung auf Vorgabe zurücksetzen
          </button>
        )}
      </fieldset>}
      {LETTER_BLOCKS.map((b) => {
        const text = shownText(draft, base, b.id)
        const appears = shown ? shown.includes(b.id) : true
        const inherited = draft.own[b.id] === null
        return (
          <div key={b.id} className="letter-edit">
            <Field
              label={b.label}
              width="full"
              hint={`Erscheint ${b.when}${appears ? '' : ' (in diesem Anschreiben nicht)'}.${inherited ? (level === 'installation' ? ' Vorgabe von Mietfuchs.' : ' Es gilt die Vorlage.') : ' Eigener Text.'} Leer heißt: weglassen.`}
              {...errors.field(b.id)}
            >
              <textarea
                ref={(el) => { refs.current[b.id] = el }}
                rows={b.multiline ? 3 : 1}
                value={text}
                onChange={(e) => setDraft((d) => setText(d, base, b.id, e.target.value))}
              />
            </Field>
            <div className="letter-chips" role="group" aria-label={`Platzhalter für ${b.label}`}>
              {fieldsFor(b.id).map((f) => (
                <button key={f.id} type="button" className="chip-button" title={f.label} onClick={() => insert(b.id, f.id)}>{`{${f.id}}`}</button>
              ))}
              {!inherited && (
                <button type="button" className="btn small ghost" onClick={() => setDraft((d) => ({ ...d, own: { ...d.own, [b.id]: null } }))}>
                  Auf Vorgabe zurücksetzen<span className="sr-only">{` (${b.label})`}</span>
                </button>
              )}
            </div>
            {text.trim() !== '' && <p className="letter-preview"><span className="muted">Vorschau: </span>{previewOf(text, previewValues)}</p>}
          </div>
        )
      })}
    </Drawer>
  )
}
