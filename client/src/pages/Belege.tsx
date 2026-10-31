// Die Seite „Belege“ (#490): zwei Ansichten über dieselben Daten, „Eingang“ (Ablage und Arbeitsliste, BelegeEingang.tsx)
// und „Ordner“ (Register je Kostenart, Suche, Belegabdeckung, Mappen, BelegeOrdner.tsx). Sie ersetzt Schnellerfassung und
// Belegordner. Beide Ansichten bleiben eingehängt, die andere ist nur verborgen: Ein Wechsel verliert nichts, weder
// Zuordnung, Objekt und Jahr eines Belegs, „Betrag prüfen“, geänderte Zeilen einer Auswertung noch das Jahr der Buchung
// (Regel 2). Welche Ansicht offen ist, hält App.tsx (gemerkt je Sitzung, belegeView.ts).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { CostItem, NoticeSubject, Settings, Unit } from '../types'
import { BELEGE_VIEWS, type BelegeView } from '../nav'
import { receiptCards } from '../receipts'
import { useReceiptStock } from '../receiptStock'
import { renderThumbnail } from '../pdfPreview'
import type { TenantFolderPlan } from '../tenantFolder'
import PageHeader from '../components/PageHeader'
import BelegeEingang from './BelegeEingang'
import BelegeOrdner, { type FolderMeta } from './BelegeOrdner'

type Props = {
  units: Unit[]
  settings: Settings | null
  // Mit Ziel: die Position auf der Seite öffnen, etwa zum Pflegen im Formular
  onNavigate: (tab: string, focus?: NoticeSubject) => void
  // Eine Position im Formular der Seite Kosten öffnen, auch in einem anderen Objekt (App.tsx schaltet dann um)
  onOpenItem?: (item: CostItem) => void
  onOpenAiSettings?: () => void
  onOpenMeters?: () => void
  // Die offene Ansicht; ohne Angabe (Tests) hält die Seite sie selbst und beginnt mit dem Eingang
  view?: BelegeView
  onViewChange?: (view: BelegeView) => void
  // Ein Beleg, zu dem die Seite springen soll (Fehler mit Ausweg, #487). Ein Beleg ohne Position steht im Eingang, einer
  // an Positionen und ein Zählerfoto im Ordner.
  focusFile?: string | null
  onFocusDone?: () => void
  // Für Tests: ohne pdf.js und ohne Download
  renderThumb?: typeof renderThumbnail
  makeTenantFolder?: (plan: TenantFolderPlan, meta: FolderMeta) => Promise<string[] | void>
}

const LABELS: Record<BelegeView, string> = { eingang: 'Eingang', ordner: 'Ordner' }

export default function Belege({ units, settings, onNavigate, onOpenItem, onOpenAiSettings, onOpenMeters, view, onViewChange, focusFile, onFocusDone, renderThumb, makeTenantFolder }: Props) {
  const stock = useReceiptStock()
  const [own, setOwn] = useState<BelegeView>(view ?? 'eingang')
  useEffect(() => { if (view) setOwn(view) }, [view])
  const shown = own
  const choose = (v: BelegeView) => { setOwn(v); onViewChange?.(v) }
  const [count, setCount] = useState(0)

  // Wohin ein Sprung zu einem Beleg geht: ein Beleg ohne Position in den Eingang, sonst in den Ordner
  const [focus, setFocus] = useState<{ view: BelegeView; file: string } | null>(null)
  const cards = useMemo(() => receiptCards(stock.uploads, stock.costItems), [stock.uploads, stock.costItems])
  const routed = useRef<string | null>(null)
  useEffect(() => {
    if (!focusFile || !stock.loadedOnce || routed.current === focusFile) return
    routed.current = focusFile
    const card = cards.find((c) => c.upload.file === focusFile)
    const to: BelegeView = card && card.items.length === 0 && card.upload.kind !== 'meterPhoto' ? 'eingang' : 'ordner'
    choose(to)
    setFocus({ view: to, file: focusFile })
  })
  const focusDone = () => {
    setFocus(null)
    routed.current = null
    onFocusDone?.()
  }

  // Reiter nach dem Muster der WAI-ARIA: Pfeiltasten wechseln, Tab geht in die Ansicht
  const tabs = useRef<Record<BelegeView, HTMLButtonElement | null>>({ eingang: null, ordner: null })
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const at = BELEGE_VIEWS.indexOf(shown)
    const next = e.key === 'Home' ? BELEGE_VIEWS[0] : e.key === 'End' ? BELEGE_VIEWS[BELEGE_VIEWS.length - 1]
      : BELEGE_VIEWS[(at + (e.key === 'ArrowRight' ? 1 : BELEGE_VIEWS.length - 1)) % BELEGE_VIEWS.length]
    if (!next) return
    choose(next)
    tabs.current[next]?.focus()
  }

  return (
    <>
      <PageHeader
        title="Belege"
        subtitle="Neue Belege legen Sie im Eingang ab, Rechnungen und Zählerfotos gemischt. Erfasste stehen im Ordner, je Objekt und Jahr mit einem Register je Kostenart."
      />
      <div role="tablist" aria-label="Ansicht der Belege" className="flex gap-1 border-b border-line mb-4 no-print" onKeyDown={onKey}>
        {BELEGE_VIEWS.map((v) => (
          <button key={v} ref={(el) => { tabs.current[v] = el }} type="button" role="tab" id={`belege-tab-${v}`} aria-controls={`belege-${v}`}
            aria-selected={shown === v} tabIndex={shown === v ? 0 : -1} onClick={() => choose(v)}
            className="min-h-9 px-4 py-2 -mb-px cursor-pointer border-0 border-b-2 border-solid border-transparent bg-transparent text-m text-muted font-medium hover:text-text aria-selected:border-accent aria-selected:text-text aria-selected:font-strong">
            {LABELS[v]}
            {v === 'eingang' && count > 0 && <> <span className="badge gray">{count}<span className="sr-only"> offen</span></span></>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="belege-eingang" aria-labelledby="belege-tab-eingang" data-view="eingang" hidden={shown !== 'eingang'}>
        <BelegeEingang stock={stock} units={units} settings={settings} onNavigate={onNavigate} onOpenItem={onOpenItem}
          onOpenAiSettings={onOpenAiSettings} onOpenMeters={onOpenMeters} onCount={setCount} renderThumb={renderThumb}
          focusFile={focus?.view === 'eingang' ? focus.file : null} onFocusDone={focusDone} />
      </div>
      <div role="tabpanel" id="belege-ordner" aria-labelledby="belege-tab-ordner" data-view="ordner" hidden={shown !== 'ordner'}>
        <BelegeOrdner stock={stock} renderThumb={renderThumb} onOpenItem={onOpenItem} makeTenantFolder={makeTenantFolder}
          focusFile={focus?.view === 'ordner' ? focus.file : null} onFocusDone={focusDone}
          onShowInInbox={(file) => { choose('eingang'); setFocus({ view: 'eingang', file }) }} />
      </div>
    </>
  )
}
