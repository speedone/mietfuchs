// Das Anschreiben bearbeiten (#415): ein Feld je Baustein, die Platzhalter als anklickbare Chips, eine
// Vorschau mit den Werten des Mieters (bei der Vorlage mit Beispielwerten) und „Auf Vorgabe zurücksetzen“
// je Baustein. Dieselbe Oberfläche für die drei Ebenen: Vorlage der Installation (Einstellungen),
// abweichend je Objekt und einmalig je Mieter (Abrechnung).
import { useEffect, useRef, useState } from 'react'
import type { LetterAdjustmentMode, LetterBlock, LetterField, LetterTexts } from '../types'
import { ADJUSTMENT_MODES, adjustmentHint, exceedsOnePage, fieldsFor, LETTER_BLOCKS } from '../../../shared/letter.ts'
import MonthField from './MonthField'
import { monthLabel } from '../monthText'
import { localToday } from '../periodForm'
import { errorText, fmtEuro } from '../api'
import Drawer from './Drawer'
import Field from './Field'
import { useFormError } from './ErrorSummary'
import { NoticeBox } from './Notice'
import { useSaving } from '../useSaving'
import {
  adjustFromHint, adjustTextLacksMonth, customCentsOf, draftNewCents, insertField, letterProblems, ownOf, previewOf, setText, shownText, textChanges,
  type LetterDraft, type LetterFieldKey, type LetterLevel,
} from '../letterForm'

export type LetterSave = {
  texts: Partial<Record<LetterBlock, string | null>>
  // nur, wenn sie sich geändert hat; `null` nimmt die eigene Wahl des Mieters weg (Durchsicht K6)
  adjust?: { mode: LetterAdjustmentMode, cents: number | null, from?: string | null } | null
  // Teil 2: „Anschreiben mitdrucken“, nur wenn es sich geändert hat; am Objekt heißt `null` „wie die Vorgabe“.
  printLetter?: boolean | null
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
  // `from`: der eigene Monat des Mieters (#317, `null` = Vorgabe), `defaultFrom`: der Monat der Vorgabe.
  adjust?: { mode: LetterAdjustmentMode, cents: number | null, suggestedCents?: number, own?: boolean, defaultMode?: LetterAdjustmentMode, from?: string | null, defaultFrom?: string }
  // Mieter: welche Bausteine sein Anschreiben zeigt; die übrigen tragen „erscheint hier nicht“
  shown?: readonly LetterBlock[]
  // Teil 2: „Anschreiben mitdrucken“. Installation: ja oder nein (`base` fehlt); Objekt: wie die Vorgabe (`null`,
  // `base` ist die Vorgabe der Einstellungen), ja oder nein. Fehlt es, fragt das Fenster nicht (Mieter).
  printLetter?: { value: boolean | null, base?: boolean }
  onClose: () => void
  onSave: (save: LetterSave) => Promise<void>
}

const centsText = (cents: number | null): string => (cents === null ? '' : (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }))

const PRINT_CHOICES = [{ id: 'inherit', value: null }, { id: 'yes', value: true }, { id: 'no', value: false }] as const

export default function LetterDrawer({ open, level, title, intro, base, own, values, adjust, shown, printLetter, onClose, onSave }: Props) {
  const initial = (): LetterDraft => ({ own: ownOf(own), adjust: adjust?.mode ?? 'none', adjustOwn: adjust?.own ?? true, customCents: centsText(adjust?.cents ?? null), adjustFrom: adjust?.from ?? null, printLetter: printLetter?.value ?? null })
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
  // #317: der Monat der Anpassung, wie der Entwurf ihn nennt
  const shownFrom = draft.adjustFrom ?? adjust?.defaultFrom ?? ''
  const fromHint = level === 'tenancy' && draft.adjust !== 'none' ? adjustFromHint(shownFrom, localToday()) : null
  const adjustBlock = draft.adjust === 'custom' ? 'adjustCustom' : 'adjustSuggestion'
  const lacksMonth = level === 'tenancy' && draft.adjust !== 'none' && adjustTextLacksMonth(shownText(draft, base, adjustBlock))
  const previewValues = level === 'tenancy' ? { ...values, VorauszahlungNeu: draftNewCents(draft, suggested), AnpassungAb: /^\d{4}-\d{2}$/.test(shownFrom) ? monthLabel(shownFrom) : '' } : values
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
      const from = draft.adjust === 'none' ? null : draft.adjustFrom ?? null
      const adjustChanged = adjust !== undefined && (draft.adjustOwn
        ? !savedOwn || draft.adjust !== adjust.mode || (draft.adjust === 'custom' && cents !== adjust.cents) || from !== (adjust.from ?? null)
        : savedOwn)
      const adjustSave = draft.adjustOwn ? { mode: draft.adjust, cents, from } : null
      const printChanged = printLetter !== undefined && (draft.printLetter ?? null) !== printLetter.value
      try {
        await onSave({ texts: textChanges(ownOf(own), draft.own), ...(adjustChanged ? { adjust: adjustSave } : {}), ...(printChanged ? { printLetter: draft.printLetter ?? null } : {}) })
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
      {printLetter && printLetter.base === undefined && (
        <div className="letter-edit">
          <label className="checkline">
            <input type="checkbox" checked={draft.printLetter !== false} onChange={(e) => setDraft((d) => ({ ...d, printLetter: e.target.checked }))} />{' '}
            Anschreiben mitdrucken
          </label>
          <p className="muted text-s m-0">Ohne Anschreiben beginnt die Aufstellung mit Anschrift, Datum und Betreff; Ergebnis, Anpassung und Belegeinsicht stehen dann unter der Tabelle. Ein Objekt kann abweichen, beim Drucken lässt es sich umschalten.</p>
        </div>
      )}
      {printLetter && printLetter.base !== undefined && (
        <Field label="Anschreiben mitdrucken" width="m" hint="Beim Drucken lässt es sich für den einen Druck umschalten.">
          <select
            value={PRINT_CHOICES.find((c) => c.value === (draft.printLetter ?? null))?.id ?? 'inherit'}
            onChange={(e) => setDraft((d) => ({ ...d, printLetter: PRINT_CHOICES.find((c) => c.id === e.target.value)?.value ?? null }))}
          >
            <option value="inherit">{`Wie in den Einstellungen (${printLetter.base ? 'ja' : 'nein'})`}</option>
            <option value="yes">Ja</option>
            <option value="no">Nein</option>
          </select>
        </Field>
      )}
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
        {level === 'tenancy' && draft.adjust !== 'none' && (
          <MonthField
            label="Ab Monat"
            width="s"
            value={shownFrom}
            today={localToday()}
            hint="Vorgabe von Mietfuchs: der übernächste Monat nach dem Tag des Briefs. § 560 Abs. 4 BGB nennt keine Frist; früher geht nach AG Mannheim, 8 C 552/06, schon der nächste Fälligkeitstermin."
            {...errors.field('adjustFrom')}
            onChange={(v) => setDraft((d) => ({ ...d, adjustFrom: v === adjust?.defaultFrom ? null : v, adjustOwn: true }))}
          />
        )}
        {fromHint && <NoticeBox level="hint" action={fromHint} />}
        {lacksMonth && <NoticeBox level="hint" action={`Ihr Text zur Anpassung nennt den Monat nicht. Mit dem Platzhalter {AnpassungAb} steht ${/^\d{4}-\d{2}$/.test(shownFrom) ? monthLabel(shownFrom) : 'der Monat'} im Brief, und „In die Staffel übernehmen“ nimmt nach dem Abschluss denselben Monat.`} />}
        {level === 'tenancy' && draft.adjustOwn && adjust?.defaultMode && (
          <button type="button" className="btn small ghost" onClick={() => setDraft((d) => ({ ...d, adjust: adjust.defaultMode ?? d.adjust, adjustOwn: false, customCents: '', adjustFrom: null }))}>
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
