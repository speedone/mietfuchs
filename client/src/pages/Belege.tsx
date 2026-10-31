// Die Seite „Belege“ (#490): zwei Ansichten über dieselben Daten, „Eingang“ (Ablage und Arbeitsliste, BelegeEingang.tsx)
// und „Ordner“ (Register je Kostenart, Suche, Belegabdeckung, Mappen, BelegeOrdner.tsx). Sie ersetzt Schnellerfassung und
// Belegordner. Beide Ansichten bleiben eingehängt, die andere ist nur verborgen: Ein Wechsel verliert nichts, weder
// Zuordnung, Objekt und Jahr eines Belegs, „Betrag prüfen“, geänderte Zeilen einer Auswertung noch das Jahr der Buchung
// (Regel 2). Welche Ansicht offen ist, hält App.tsx (gemerkt je Sitzung, belegeView.ts).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { CostItem, NoticeSubject, Settings, Unit } from '../types'
import { BELEGE_VIEWS, type BelegeView, type NavTarget } from '../nav'
import { receiptCards, receiptName } from '../receipts'
import { periodKeyOfYear, placeOf } from '../belegeView'
import { useProperty } from '../property'
import { usePeriod, useSwitchTo } from '../period'
import { rulesOf } from '../../../shared/period.ts'
import { NoticeBox } from '../components/Notice'
import { useReceiptStock } from '../receiptStock'
import { renderThumbnail } from '../pdfPreview'
import type { TenantFolderPlan } from '../tenantFolder'
import PageHeader from '../components/PageHeader'
import { EvaluationQueueProvider, useEvaluationQueueStore } from '../evaluationQueue'
import BelegeEingang from './BelegeEingang'
import BelegeOrdner, { type FolderMeta } from './BelegeOrdner'

type Props = {
  units: Unit[]
  settings: Settings | null
  // Mit Ziel: die Position auf der Seite öffnen, etwa zum Pflegen im Formular
  onNavigate: (tab: NavTarget, focus?: NoticeSubject) => void
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
  // Einen Beleg zeigen (App.tsx `openReceipt`): ein Sprung, der einen Wechsel von Objekt oder Jahr überlebt
  onOpenReceipt?: (file: string) => void
  onFocusDone?: () => void
  // Für Tests: ohne pdf.js und ohne Download
  renderThumb?: typeof renderThumbnail
  makeTenantFolder?: (plan: TenantFolderPlan, meta: FolderMeta) => Promise<string[] | void>
}

const LABELS: Record<BelegeView, string> = { eingang: 'Eingang', ordner: 'Ordner' }

// Eingang und Ordner teilen eine Warteschlange: In App.tsx liegt sie darüber; ohne sie (Tests einzelner Seiten) stellt die
// Seite eine eigene bereit, damit beide Ansichten dieselbe sehen.
export default function Belege(props: Props) {
  const shared = useEvaluationQueueStore()
  return shared ? <BelegePage {...props} /> : <EvaluationQueueProvider><BelegePage {...props} /></EvaluationQueueProvider>
}

function BelegePage({ units, settings, onNavigate, onOpenItem, onOpenAiSettings, onOpenMeters, view, onViewChange, focusFile, onOpenReceipt, onFocusDone, renderThumb, makeTenantFolder }: Props) {
  const stock = useReceiptStock()
  const [own, setOwn] = useState<BelegeView>(view ?? 'eingang')
  useEffect(() => { if (view) setOwn(view) }, [view])
  const shown = own
  const choose = (v: BelegeView) => { setOwn(v); onViewChange?.(v) }
  const [count, setCount] = useState(0)

  // Wohin ein Sprung zu einem Beleg geht: ein Beleg ohne Position in den Eingang, sonst in den Ordner. Gehört ein Beleg ohne
  // Position einem anderen Objekt oder Jahr, wird erst dorthin gewechselt, mit der Rückfrage bei offener Eingabe (Durchsicht
  // M1); in App.tsx stellt das die Seite neu auf, und der Sprung (`focusFile`) geht danach weiter. Geht es nicht, sagt es die
  // Seite, statt still nichts zu tun. Ein Sprung aus der eigenen Suche („Im Eingang zeigen“) geht über `onOpenReceipt`,
  // damit er den Wechsel überlebt; ohne (Tests) hält die Seite ihn selbst.
  const { property, properties } = useProperty()
  const { year } = usePeriod()
  const switchTo = useSwitchTo()
  const [ownFile, setOwnFile] = useState<string | null>(null)
  const target = focusFile ?? ownFile
  const [focus, setFocus] = useState<{ view: BelegeView; file: string } | null>(null)
  const [notice, setNotice] = useState('')
  const cards = useMemo(() => receiptCards(stock.uploads, stock.costItems), [stock.uploads, stock.costItems])
  const routed = useRef<string | null>(null)
  const switched = useRef<string | null>(null)
  const [, setAgain] = useState(0)
  useEffect(() => {
    if (!target) { routed.current = null; switched.current = null; return }
    if (!stock.loadedOnce || routed.current === target) return
    routed.current = target
    const card = cards.find((c) => c.upload.file === target)
    if (!card) {
      setNotice('Diesen Beleg gibt es nicht mehr. Wurde er gelöscht, holt ihn der Verlauf aus dem Papierkorb zurück.')
      focusDone()
      return
    }
    const free = card.items.length === 0 && card.upload.kind !== 'meterPhoto'
    if (free && switched.current !== target) {
      const there = placeOf(card.upload, { propertyId: properties.length > 1 ? property?.id ?? null : null, year })
      if (there) {
        switched.current = target
        const dest = properties.find((p) => p.id === (there.propertyId ?? property?.id))
        if (!dest) {
          setNotice(`„${receiptName(card.upload)}“ gehört zu einem Objekt, das es nicht mehr gibt. Ordnen Sie ihn im Ordner über die Suche einem Objekt zu.`)
          focusDone()
          return
        }
        // Immer mit Zeitraum, auch wenn nur das Objekt wechselt: Bei einem anderen Rhythmus (Mai bis April) gälte sonst der
        // Zeitraum um den bisherigen Anker, und das Jahr des Belegs wäre ein anderes (Nachdurchsicht S-B).
        void switchTo(there.propertyId ?? undefined, periodKeyOfYear(rulesOf(dest), there.year ?? year)).then((ok) => {
          // Nach dem Wechsel noch einmal leiten (in App.tsx ist die Seite dann neu aufgestellt)
          if (ok) { routed.current = null; setAgain((n) => n + 1); return }
          setNotice(`„${receiptName(card.upload)}“ gehört zu einem anderen Objekt oder Jahr; gewechselt wurde nicht.`)
          focusDone()
        })
        return
      }
    }
    setNotice('')
    const to: BelegeView = free ? 'eingang' : 'ordner'
    choose(to)
    setFocus({ view: to, file: target })
  })
  function focusDone() {
    setFocus(null)
    setOwnFile(null)
    onFocusDone?.()
  }
  const showInInbox = (file: string) => {
    if (onOpenReceipt) onOpenReceipt(file)
    else { routed.current = null; switched.current = null; setOwnFile(file) }
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
    setNotice('')
    choose(next)
    tabs.current[next]?.focus()
  }

  return (
    <>
      <PageHeader
        title="Belege"
        subtitle="Neue Belege legen Sie im Eingang ab, Rechnungen und Zählerfotos gemischt. Erfasste stehen im Ordner, je Objekt und Jahr mit einem Register je Kostenart."
      />
      {notice && <NoticeBox level="error" action={notice} />}
      <div role="tablist" aria-label="Ansicht der Belege" className="flex gap-1 border-b border-line mb-4 no-print" onKeyDown={onKey}>
        {BELEGE_VIEWS.map((v) => (
          <button key={v} ref={(el) => { tabs.current[v] = el }} type="button" role="tab" id={`belege-tab-${v}`} aria-controls={`belege-${v}`}
            aria-selected={shown === v} tabIndex={shown === v ? 0 : -1} onClick={() => { setNotice(''); choose(v) }}
            className="min-h-9 px-4 py-2 -mb-px cursor-pointer border-0 border-b-2 border-solid border-transparent bg-transparent text-m text-muted font-medium hover:text-text aria-selected:border-accent aria-selected:text-text aria-selected:font-strong">
            {LABELS[v]}
            {v === 'eingang' && count > 0 && <> <span className="badge gray">{count}<span className="sr-only"> offen</span></span></>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="belege-eingang" aria-labelledby="belege-tab-eingang" data-view="eingang" hidden={shown !== 'eingang'} tabIndex={0}>
        <BelegeEingang stock={stock} units={units} settings={settings} onNavigate={onNavigate} onOpenItem={onOpenItem}
          onOpenAiSettings={onOpenAiSettings} onOpenMeters={onOpenMeters} onCount={setCount} renderThumb={renderThumb}
          focusFile={focus?.view === 'eingang' ? focus.file : null} onFocusDone={focusDone} />
      </div>
      <div role="tabpanel" id="belege-ordner" aria-labelledby="belege-tab-ordner" data-view="ordner" hidden={shown !== 'ordner'} tabIndex={0}>
        <BelegeOrdner stock={stock} renderThumb={renderThumb} onOpenItem={onOpenItem} makeTenantFolder={makeTenantFolder}
          focusFile={focus?.view === 'ordner' ? focus.file : null} onFocusDone={focusDone}
          onShowInInbox={showInInbox} />
      </div>
    </>
  )
}
