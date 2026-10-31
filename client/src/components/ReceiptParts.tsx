// Bausteine der Seite „Belege“ (#490), die Eingang und Ordner teilen: das Vorschaubild, die Karte eines Belegs, die
// Auswahl „Zuordnen“ mit Entwurf, Objekt und Jahr eines Belegs ohne Position, „Betrag prüfen“ nach dem Zuordnen und
// das Hervorheben nach einem Sprung. Die Entscheidungslogik steht in receipts.ts und belegeView.ts.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { CostItem, Property, Settlement, UploadInfo } from '../types'
import { api, errorText, fmtDate, fmtEuro } from '../api'
import { withProperty, useOpenForm } from '../property'
import { closedPeriodNotice } from '../../../shared/costItem.ts'
import { closedCheckPath } from '../costPeriods'
import { labelOfKey } from '../periodForm'
import { rulesOf, startYearOf } from '../../../shared/period.ts'
import { renderThumbnail } from '../pdfPreview'
import { previewWhenVisible } from '../previewQueue'
import { amountCheckBody, amountCheckFormReason, amountCheckIsPart, amountCheckMode, receiptName, type ReceiptCard } from '../receipts'
import type { ReceiptStock } from '../receiptStock'
import { useDraft } from '../useDraft'
import DraftActions from './DraftActions'
import { NoticeBox } from './Notice'
import { useToast } from './feedback'

export const fmtSize = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} kB`

export const fmtDay = (iso: string) => fmtDate(iso.slice(0, 10))

// Wie weit vor dem sichtbaren Bereich ein Vorschaubild schon angefragt wird: etwa eine halbe Bildschirmhöhe,
// damit beim Scrollen kein leerer Kasten aufblitzt.
export const THUMB_LOOKAHEAD = '400px 0px'

// Vorschaubild eines Belegs. PDFs rendert pdf.js klein, Bilder zeigt der Browser selbst. Scheitert
// das Rendern (passwortgeschützt, beschädigt), bleibt ein Platzhalter: Der Beleg ist trotzdem da.
// Gerendert wird erst, wenn das Bild in die Nähe des sichtbaren Bereichs kommt, und über die gemeinsame
// Warteschlange (höchstens zwei zugleich, previewQueue.ts); wer vorbeiscrollt, bevor es dran ist, zieht
// die Anfrage zurück. Ohne IntersectionObserver (alter Browser) wird gleich angefragt, ebenfalls über die
// Warteschlange.
export function Thumb({ upload, render }: { upload: UploadInfo; render: typeof renderThumbnail }) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const preview = previewWhenVisible(
      (signal) => render(upload.file, upload.mimeType, signal),
      (result) => { if (result.ok) setSrc(result.value); else setFailed(true) },
    )
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      preview.visible(true)
      return () => preview.dispose()
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) preview.visible(entry.isIntersecting)
    }, { rootMargin: THUMB_LOOKAHEAD })
    observer.observe(el)
    return () => { observer.disconnect(); preview.dispose() }
  }, [upload.file, upload.mimeType, render])
  return (
    <a ref={ref} className="receipt-thumb" href={`/uploads/${encodeURIComponent(upload.file)}`} target="_blank" rel="noreferrer" aria-label={`${receiptName(upload)} öffnen`}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span aria-hidden="true">{failed ? '📄' : '…'}</span>}
    </a>
  )
}

// Ein Beleg als Karte: Vorschaubild, Name mit Link, Betrag, Hochladezeit und Größe, die Positionen oder die Bedienung
// eines Belegs ohne Position (`children`), Rechnungsdatum, Doppel-Hinweis und Löschen.
export function ReceiptItem({ card, renderThumb, jumped, place, hint, onDelete, entryId, children }: {
  card: ReceiptCard
  // Der Eintrag der Warteschlange, der an dieser Karte steht (gespeichert, nicht ausgewertet): Nach „Erneut versuchen“
  // findet der Fokus die Karte wieder (retryFocus.ts).
  entryId?: number
  renderThumb: typeof renderThumbnail
  // Nach einem Sprung ein paar Sekunden hervorgehoben
  jumped: boolean
  // Objekte und Jahr, wo die Karte sie nennt (alle Objekte, Treffer der Suche)
  place?: ReactNode
  hint?: string
  onDelete?: () => void
  children?: ReactNode
}) {
  const { upload } = card
  return (
    <li className={`receipt-card${jumped ? ' bg-accent-soft border-accent' : ''}`}
      data-file={upload.file} data-jumped={jumped ? 'true' : undefined} data-queue-entry={entryId} tabIndex={entryId === undefined ? undefined : -1}>
      <Thumb upload={upload} render={renderThumb} />
      <div className="receipt-body">
        <div className="receipt-title">
          <a href={`/uploads/${encodeURIComponent(upload.file)}`} target="_blank" rel="noreferrer">{card.vendor || receiptName(upload)}</a>
          {card.items.length > 0 && <strong className="num">{fmtEuro(card.amountCents)}</strong>}
        </div>
        <div className="muted">
          {card.vendor && <>{receiptName(upload)} · </>}hochgeladen {fmtDay(upload.uploadedAt)} · {fmtSize(upload.size)}
          {place && <> · <span className="badge gray">{place}</span></>}
        </div>
        {children}
        {upload.invoiceDate && <div className="muted">Rechnungsdatum {fmtDate(upload.invoiceDate)}</div>}
        {hint && <div className="receipt-hint">⚠ {hint}</div>}
      </div>
      {onDelete && (
        <button className="icon-btn danger" title="Löschen" aria-label={`Beleg ${receiptName(upload)} löschen`} onClick={onDelete}>🗑</button>
      )}
    </li>
  )
}

// Eine Auswahl, die erst mit „Speichern“ wirkt (#309): Beleg und Position einander zuordnen. Die leere
// Wahl ist der gespeicherte Wert; wer etwas wählt, hat einen Entwurf, und erst „Speichern“ hängt den Beleg an.
// Steht die gewählte Position oder der gewählte Beleg nicht mehr unter `values` (die Liste folgt Objekt und
// Jahr, ein Beleg wurde anderswo zugeordnet), ist die Wahl verworfen (Durchsicht zu #309, MUSS 2).
export function AttachPicker({ label, what, placeholder, scope, values, onSave, children }: {
  label: string
  what: string
  placeholder: string
  scope: string
  values: readonly string[]
  onSave: (value: string) => Promise<unknown>
  children: ReactNode
}) {
  const draft = useDraft('', { scope, isValid: (v) => v === '' || values.includes(v) })
  return (
    <>
      <select aria-label={label} value={draft.value} disabled={draft.saving} onChange={(e) => draft.set(e.target.value)}>
        <option value="">{placeholder}</option>
        {children}
      </select>
      <DraftActions draft={draft} onSave={onSave} what={what} />
    </>
  )
}

export const PLACEMENT_FIRST = 'Erst Objekt und Jahr speichern oder verwerfen.'

// Objekt und Jahr eines Belegs ohne Position (#309): ein Entwurf für beide Felder mit einem „Speichern“.
// Gesendet wird nur, was sich geändert hat; der Server zieht die Auswertung desselben Belegs nach, solange
// aus ihr nichts gebucht ist (Belegbuchung).
type Placement = { propertyId: string; year: string }
export function InboxPlacement({ upload, properties, yearOptions, onSave, children }: {
  upload: UploadInfo
  properties: readonly Property[]
  yearOptions: readonly number[]
  onSave: (changes: { propertyId?: string | null; year?: number | null }) => Promise<unknown>
  // `dirty`: Objekt oder Jahr sind geändert und nicht gespeichert.
  children: (placement: { propertyId: string | null; year: number | null; dirty: boolean }) => ReactNode
}) {
  const saved: Placement = {
    propertyId: upload.propertyId && properties.some((p) => p.id === upload.propertyId) ? upload.propertyId : '',
    year: upload.year === null ? '' : String(upload.year),
  }
  const draft = useDraft(saved, { scope: upload.file })
  const name = receiptName(upload)
  const save = (v: Placement) => {
    const changes: { propertyId?: string | null; year?: number | null } = {}
    if (v.propertyId !== saved.propertyId) changes.propertyId = v.propertyId || null
    if (v.year !== saved.year) changes.year = v.year ? Number(v.year) : null
    return onSave(changes)
  }
  return (
    <>
      {properties.length > 1 && (
        <select aria-label={`Objekt für ${name}`} value={draft.value.propertyId} disabled={draft.saving}
          onChange={(e) => draft.set({ ...draft.value, propertyId: e.target.value })}>
          <option value="">ohne Objekt</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name || 'Ohne Namen'}</option>)}
        </select>
      )}
      <select aria-label={`Jahr für ${name}`} value={draft.value.year} disabled={draft.saving}
        onChange={(e) => draft.set({ ...draft.value, year: e.target.value })}>
        <option value="">ohne Jahr</option>
        {[...new Set([...yearOptions, ...(upload.year === null ? [] : [upload.year])])].sort((a, b) => b - a).map((y) => <option key={y} value={String(y)}>{y}</option>)}
      </select>
      <DraftActions draft={draft} onSave={save} what={properties.length > 1 ? `Objekt und Jahr für ${name}` : `Jahr für ${name}`} />
      {children({ propertyId: draft.value.propertyId || null, year: draft.value.year ? Number(draft.value.year) : null, dirty: draft.dirty || draft.saving })}
    </>
  )
}

// ---------- Nach einem Sprung hervorheben ----------

export const JUMP_HIGHLIGHT_MS = 4000

// Was nach einem Sprung kurz hervorgehoben steht (ein Beleg, eine Auswertung), damit man sieht, wohin er ging.
export function useHighlight(): [string | null, (key: string | null) => void] {
  const [jumped, setJumped] = useState<string | null>(null)
  useEffect(() => {
    if (!jumped) return
    const t = setTimeout(() => setJumped(null), JUMP_HIGHLIGHT_MS)
    return () => clearTimeout(t)
  }, [jumped])
  return [jumped, setJumped]
}

// ---------- Zuordnen und „Betrag prüfen“ (Befund C) ----------

type AmountCheckState = { item: CostItem; file: string; amount: string; problem: string; form?: boolean; closed?: boolean }

// Einen Beleg an eine Position hängen, neu hochgeladen oder einen vorhandenen ohne Position, und danach „Betrag
// prüfen“: Eine aus dem Vorjahr übernommene Position trägt einen geschätzten Betrag, der sonst still stehen bliebe.
// `closed`: Die Abrechnung des Jahres der Position ist abgeschlossen; eine Änderung erscheint dort als Abweichung
// (Integrationsdurchsicht vor 0.10). Eingang und Ordner haben je einen eigenen Kasten.
// `onAttached`: Der Beleg hängt jetzt an einer Position; ein gespeicherter, nicht ausgewerteter Eintrag der Warteschlange
// dazu ist erledigt (Durchsicht S3).
export function useAttach(stock: ReceiptStock, properties: readonly Property[], onError: (text: string) => void, onAttached?: (file: string) => void) {
  const toast = useToast()
  const [check, setCheck] = useState<AmountCheckState | null>(null)
  // „Betrag prüfen“ zählt als offenes Formular (#346, 7a): Die Frage zum Schätzbetrag kommt nach einem
  // Seitenwechsel nie wieder, und die Schätzung bliebe still stehen.
  useOpenForm(check !== null)

  async function attach(c: CostItem, invoiceFile: string) {
    await api(`/api/costItems/${encodeURIComponent(c.id)}`, { method: 'PUT', body: JSON.stringify({ invoiceFile }) })
    onAttached?.(invoiceFile)
    setCheck({ item: c, file: invoiceFile, amount: '', problem: '' })
    // Ist die Abrechnung des Jahres abgeschlossen, sagt der Kasten es. Scheitert die Frage, fehlt
    // nur der Satz; das Zuordnen ist schon gespeichert. Abgewartet wird sie nicht: Das „Speichern“
    // der Zuordnung (#309) ist mit dem PUT erledigt und soll nicht an dieser Auskunft hängen.
    void (async () => {
      try {
        // Die Abrechnung, zu der die Position gehört; nach Weg d ihre Heizkostenabrechnung (Durchsicht N2).
        const raw = stock.loadedItems.find((x) => x.id === c.id) ?? c
        const path = closedCheckPath(raw, rulesOf(properties.find((p) => p.id === c.propertyId)), stock.plantsBy.get(c.propertyId) ?? [])
        const s = await api<Pick<Settlement, 'closed'>>(withProperty(path, c.propertyId))
        if (s.closed) setCheck((cur) => (cur && cur.item.id === c.id && cur.file === invoiceFile ? { ...cur, closed: true } : cur))
      } catch { /* ohne Auskunft kein Satz */ }
    })()
  }
  // Ein Fehler geht an den Aufrufer: Die Auswahl zeigt ihn am Knopf, und ihr Entwurf bleibt (#309).
  async function attachExisting(c: CostItem, file: string) {
    await attach(c, file)
    await stock.reload()
    toast(`Beleg an „${c.description}“ angehängt.`)
  }
  async function attachById(itemId: string, file: string) {
    const c = stock.costItems.find((x) => x.id === itemId)
    if (!c) throw new Error('Diese Position gibt es nicht mehr. Bitte laden Sie die Seite neu.')
    await attachExisting(c, file)
  }
  // „Beleg nachreichen“: hochgeladen mit Objekt und Jahr der Position, damit der Beleg dort im Eingang steht, falls das
  // Verknüpfen danach scheitert.
  async function uploadFor(c: CostItem, f: File) {
    const fd = new FormData()
    fd.append('file', f)
    fd.append('propertyId', c.propertyId)
    fd.append('year', String(startYearOf(c.period)))
    try {
      const res = await api<{ file: string }>('/api/upload', { method: 'POST', body: fd })
      await attach(c, res.file)
      await stock.reload()
      toast(`Beleg an „${c.description}“ angehängt.`)
    } catch (e) {
      onError(`Der Beleg wurde nicht angehängt: ${errorText(e)}`)
    }
  }
  async function saveAmount() {
    if (!check) return
    const built = amountCheckBody(check.amount, check.item)
    if ('error' in built) { setCheck({ ...check, problem: built.error, form: built.form }); return }
    try {
      await api(`/api/costItems/${encodeURIComponent(check.item.id)}`, { method: 'PUT', body: JSON.stringify(built.body) })
      setCheck(null)
      await stock.reload()
      toast(`Betrag von „${check.item.description}“ auf ${fmtEuro(built.body.amountCents)} gesetzt.`)
    } catch (e) {
      setCheck({ ...check, problem: errorText(e) })
    }
  }
  return { check, setCheck, attachExisting, attachById, uploadFor, saveAmount }
}

// Der Kasten „Betrag prüfen“ nach dem Zuordnen.
export function AmountCheckBox({ attach, properties, onOpenItem }: {
  attach: ReturnType<typeof useAttach>
  properties: readonly Property[]
  onOpenItem?: (item: CostItem) => void
}) {
  const { check, setCheck, saveAmount } = attach
  if (!check) return null
  // Die Regeln des Objekts der Position, damit auch ein alter Teil ohne Quelle als Teil zählt (#455).
  const rules = rulesOf(properties.find((p) => p.id === check.item.propertyId))
  const isPart = amountCheckIsPart(check.item, rules)
  // Wer aus dem Kasten weiterspringt, schließt ihn vorher wirklich: Sonst fände der Sprung die Marke noch
  // gesetzt und fragte nach dem Kasten, den er gerade schließt.
  const leave = () => { const it = check.item; flushSync(() => setCheck(null)); onOpenItem?.(it) }
  return (
    <div role="status" aria-label="Betrag prüfen"><NoticeBox level="warning" className="stack no-print">
      Beleg an „{check.item.description}“ angehängt. Betrag der Position: <strong>{fmtEuro(check.item.amountCents)}</strong>.
      {check.closed && <div>{closedPeriodNotice(labelOfKey(rules, check.item.period))}</div>}
      {/* Ein Teil trägt nur den Anteil seines Zeitraums; mit dem Beleg verglichen, lüde der Satz zum Fehler ein (#455). */}
      {!isPart && <>{' '}Stimmt er mit dem Beleg überein? Eine aus dem Vorjahr übernommene Position trägt oft noch einen geschätzten Betrag.</>}{' '}
      <a href={`/uploads/${encodeURIComponent(check.file)}`} target="_blank" rel="noreferrer">Beleg ansehen</a>
      {/* Ein geschätzter Lohnanteil gelangte sonst still in die Anlage V (dritte Durchsicht). */}
      {(check.item.labor35aCents ?? 0) > 0 && (
        <div>
          Lohnanteil der Position: <strong>{fmtEuro(check.item.labor35aCents ?? 0)}</strong> – stimmt er mit dem Beleg?{' '}
          {onOpenItem && <button className="btn small ghost" onClick={leave}>Lohnanteil im Formular prüfen</button>}
        </div>
      )}
      {amountCheckMode(check.item, rules) === 'form' ? (
        <div className="row center">
          <span>{amountCheckFormReason(check.item, rules)}</span>
          {onOpenItem && <button className="btn small" onClick={leave}>Position öffnen</button>}
          <button className="btn small ghost" onClick={() => setCheck(null)}>Schließen</button>
        </div>
      ) : (
        <div className="row">
          <label className="field">
            Betrag laut Beleg
            <input inputMode="decimal" value={check.amount} placeholder={fmtEuro(check.item.amountCents)} className="input-num"
              onChange={(e) => setCheck({ ...check, amount: e.target.value, problem: '' })} />
          </label>
          <button className="btn small" onClick={() => void saveAmount()} disabled={!check.amount.trim()}>Betrag speichern</button>
          <button className="btn small ghost" onClick={() => setCheck(null)}>Stimmt so</button>
        </div>
      )}
      {check.problem && (
        <NoticeBox level="error">
          {check.problem}
          {check.form && onOpenItem && <> <button className="btn small" onClick={leave}>Position öffnen</button></>}
        </NoticeBox>
      )}
    </NoticeBox></div>
  )
}
