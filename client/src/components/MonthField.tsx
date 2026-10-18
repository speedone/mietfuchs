import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import Field from './Field'
import { usePopover } from './popover'
import { MONTH_NAMES, MONTH_SHORT, YEAR_MAX, YEAR_MIN, gridMove, monthLabel, parseMonthText, type GridPos } from '../monthText'
import { localToday } from '../periodForm'

// Das Monatsfeld (#287, #346 Schritt 5; Spezifikation Abschnitt 3 „Datum, Monat, Geld“). Es ersetzt den
// MonthPicker aus zwei Auswahllisten und davor `<input type="month">`, das Safari auf dem Mac und Firefox nicht
// kennen. Ein **Textfeld**, das „3.2025“, „03/25“, „2025-03“, „März 2025“ und „Mrz 27“ versteht (Regel in
// monthText.ts), **plus** ein Knopf ▦ für das Raster: Ein Kalender ist nie die einzige Eingabe (GOV.UK
// „Dates“). Das Raster zeigt 12 Monate in 3 Spalten, das Jahr mit ‹ ›, und folgt dem APG-Grid-Muster: Pfeile,
// Pos1/Ende, Bild auf/ab für das Jahr, Enter wählt (die Zellen sind Knöpfe), Esc schließt nur das Raster.
//
// Der Wert ist 'JJJJ-MM', sobald der Text ein Monat ist; sonst der Text selbst, unverändert. Ein ungültiger
// Text wird also nicht verworfen: Die Prüfung des Formulars meldet ihn, und schon beim Verlassen steht am Feld,
// was nicht stimmt („Monat 13 gibt es nicht“). Ein gespeicherter Wert in einer anderen Schreibweise ('MM.JJJJ'
// aus den Staffeln) wird als „März 2025“ gezeigt und erst bei einer Änderung zu 'JJJJ-MM'. Beim Verlassen
// schreibt das Feld einen lesbaren Text als „März 2025“ um.
//
// Es fügt sich in `<Field>` ein: Beschriftung, Pflichtangabe, Hinweis und Meldung kommen von dort, die Meldung
// der Prüfung (`error`) geht der eigenen beim Verlassen vor.

type Props = {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  /** Steht im leeren Feld, etwa „ab Einzug“ in der ersten Zeile einer Staffel. */
  placeholder?: string
  /** Das Jahr, das das Raster ohne Wert zeigt, kommt aus diesem Datum (Einzug), sonst aus heute. */
  start?: string
  today?: string
  required?: boolean
  hint?: ReactNode
  error?: string
  id?: string
  onFix?: () => void
  width?: 's' | 'm'
  className?: string
}

const display = (value: string): string => {
  const r = parseMonthText(value)
  return r.kind === 'month' ? monthLabel(r.key) : value
}
const keyOf = (pos: GridPos) => `${pos.year}-${String(pos.month + 1).padStart(2, '0')}`

export default function MonthField({ label, value, onChange, placeholder, start, today, required, hint, error, id, onFix, width, className }: Props) {
  const [text, setText] = useState(() => display(value))
  const [ownError, setOwnError] = useState<string>()
  // Was das Feld zuletzt gemeldet hat: Nur ein Wert von außen (Raster, Zurücksetzen) ersetzt den Text.
  const sent = useRef(value)
  useEffect(() => {
    if (value === sent.current) return
    sent.current = value
    setText(display(value))
    setOwnError(undefined)
  }, [value])
  const emit = (next: string) => {
    sent.current = next
    onChange(next)
  }
  const onText = (t: string) => {
    setText(t)
    setOwnError(undefined)
    const r = parseMonthText(t)
    emit(r.kind === 'month' ? r.key : r.kind === 'empty' ? '' : t)
  }
  const onBlur = () => {
    const r = parseMonthText(text)
    if (r.kind === 'month') setText(monthLabel(r.key))
    else if (r.kind === 'invalid') setOwnError(r.short)
  }

  // Das Raster: welches Jahr es zeigt und welcher Monat den Fokus hat.
  const selected = (() => {
    const r = parseMonthText(value)
    return r.kind === 'month' ? { year: Number(r.key.slice(0, 4)), month: Number(r.key.slice(5, 7)) - 1 } : null
  })()
  const [pos, setPos] = useState<GridPos>({ year: 2000, month: 0 })
  const gridRef = useRef<HTMLSpanElement>(null)
  const focusCell = () => gridRef.current?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')?.focus()
  // Beim Öffnen: das Jahr des Werts, sonst des Einzugs, sonst von heute; der Fokus auf dem gewählten Monat,
  // sonst auf dem laufenden, sonst auf Januar.
  const prepare = () => {
    const now = today ?? localToday()
    const fallbackYear = /^\d{4}/.test(start ?? '') ? Number(start?.slice(0, 4)) : Number(now.slice(0, 4))
    const year = Math.min(YEAR_MAX, Math.max(YEAR_MIN, selected?.year ?? fallbackYear))
    setPos(selected ?? { year, month: year === Number(now.slice(0, 4)) ? Number(now.slice(5, 7)) - 1 : 0 })
  }
  const pop = usePopover({ beforeOpen: prepare, onOpen: focusCell })
  // Nach einem Schritt mit der Tastatur steht der Fokus auf der neuen Zelle (nicht nach ‹ ›, dort bleibt er).
  const moved = useRef(false)
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    focusCell()
  }, [pos])
  const choose = (p: GridPos) => {
    const key = keyOf(p)
    setText(monthLabel(key))
    setOwnError(undefined)
    emit(key)
    onFix?.()
    pop.hide()
  }
  const onGridKey = (e: KeyboardEvent<HTMLElement>) => {
    const next = gridMove(pos, e.key)
    if (!next) return
    e.preventDefault()
    moved.current = true
    setPos(next)
  }
  const year = (delta: number) => setPos((p) => ({ year: Math.min(YEAR_MAX, Math.max(YEAR_MIN, p.year + delta)), month: p.month }))

  const shown = error ?? ownError
  return (
    <Field label={label} required={required} hint={hint} error={shown} announce={!error && !!ownError} id={id} onFix={onFix} width={width} className={className}>
      {(control) => (
        <span className="month-field">
          <input
            {...control}
            value={text}
            placeholder={placeholder}
            autoComplete="off"
            onChange={(e) => onText(e.target.value)}
            onBlur={onBlur}
          />
          <button
            type="button"
           
            aria-label="Monat im Raster wählen"
            aria-haspopup="dialog"
            {...pop.trigger}
          >
            <span aria-hidden="true">▦</span>
          </button>
          {pop.render({
            className: 'month-pop',
            labelledBy: control['aria-labelledby'],
            children: (
              <>
                <span>
                  <button type="button" aria-label="Voriges Jahr" disabled={pos.year <= YEAR_MIN} onClick={() => year(-1)}>‹</button>
                  <span aria-live="polite">{pos.year}</span>
                  <button type="button" aria-label="Nächstes Jahr" disabled={pos.year >= YEAR_MAX} onClick={() => year(1)}>›</button>
                </span>
                <span ref={gridRef} role="grid" aria-label={`Monate ${pos.year}`} onKeyDown={onGridKey}>
                  {[0, 1, 2, 3].map((row) => (
                    <span role="row" key={row}>
                      {[0, 1, 2].map((col) => {
                        const month = row * 3 + col
                        const isSelected = selected?.year === pos.year && selected.month === month
                        return (
                          <button
                            key={month}
                            type="button"
                            role="gridcell"
                            tabIndex={month === pos.month ? 0 : -1}
                            aria-selected={isSelected}
                            aria-label={`${MONTH_NAMES[month]} ${pos.year}`}
                           
                            onClick={() => choose({ year: pos.year, month })}
                          >
                            {MONTH_SHORT[month]}
                          </button>
                        )
                      })}
                    </span>
                  ))}
                </span>
              </>
            ),
          })}
        </span>
      )}
    </Field>
  )
}
