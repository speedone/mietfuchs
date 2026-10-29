import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BillingPeriod, CostItem, PeriodRules, UploadEntry, UploadInfo, Property, Settlement } from '../types'
import { useOpenForm, withProperty, useProperty } from '../property'
import { flushSync } from 'react-dom'
import { usePeriod } from '../period'
import { labelOfKey } from '../periodForm'
import { api, errorText, fmtEuro, fmtDate } from '../api'
import { closedPeriodNotice } from '../../../shared/costItem.ts'
import { closedCheckPath, filedUnderSettlement, type PlantPeriods } from '../costPeriods'
// Der Belegordner gliedert nach Kalenderjahren, denn Belege tragen Kalenderjahre (#208, Entwurf
// 5.2: `uploads.year` bleibt). Die Mappe für Mieter gehört dagegen zu einer Abrechnung, also zu
// einem Zeitraum des Objekts.
import { isCalendarRules, periodContaining, periodLabel, periodsBetween, rulesOf, startYearOf } from '../../../shared/period.ts'
import { renderInvoicePages, renderThumbnail } from '../pdfPreview'
import { buildTenantFolderPdf, isIndividualAmounts, planTenantFolder, type TenantFolderPlan } from '../tenantFolder'
import { amountCheckBody, amountCheckMode, attachChoices, buildFolder, coverage, filesByItem, duplicateHints, inboxFor, inboxOf, inboxPage, INBOX_STEP, matchesQuery, partsBySource, receiptCards, registerCount, receiptName, yearSections, type CategoryGroup, type FolderFilter, type ReceiptCard, type ReceiptUpload } from '../receipts'
import { previewWhenVisible } from '../previewQueue'
import { useFocusFirstNew } from '../focusNew'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import { useToast, useConfirm } from '../components/feedback'
import DraftActions from '../components/DraftActions'
import { useDraft } from '../useDraft'
import { NoticeBox } from '../components/Notice'
import Card from '../components/Card'

const fmtSize = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} kB`

const fmtDay = (iso: string) => fmtDate(iso.slice(0, 10))

// Wie weit vor dem sichtbaren Bereich ein Vorschaubild schon angefragt wird: etwa eine halbe Bildschirmhöhe,
// damit beim Scrollen kein leerer Kasten aufblitzt.
export const THUMB_LOOKAHEAD = '400px 0px'

// Vorschaubild eines Belegs. PDFs rendert pdf.js klein, Bilder zeigt der Browser selbst. Scheitert
// das Rendern (passwortgeschützt, beschädigt), bleibt ein Platzhalter: Der Beleg ist trotzdem da.
// Gerendert wird erst, wenn das Bild in die Nähe des sichtbaren Bereichs kommt, und über die gemeinsame
// Warteschlange (höchstens zwei zugleich, previewQueue.ts); wer vorbeiscrollt, bevor es dran ist, zieht
// die Anfrage zurück. Ohne IntersectionObserver (alter Browser) wird gleich angefragt, ebenfalls über die
// Warteschlange.
function Thumb({ upload, render }: { upload: UploadInfo; render: typeof renderThumbnail }) {
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

// ---------- Mappen packen (#170) ----------

type FolderMeta = { title: string; subtitle: string; fileName: string }

// Eine Seite als JPEG-Bytes, aus einer Daten-Adresse oder einer Bilddatei, die pdf-lib nicht
// unmittelbar nimmt (etwa WebP): über ein Canvas.
async function jpegBytes(src: string): Promise<Uint8Array> {
  if (src.startsWith('data:image/jpeg')) return Uint8Array.from(atob(src.split(',')[1] ?? ''), (c) => c.charCodeAt(0))
  const img = new Image()
  img.src = src
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d')?.drawImage(img, 0, 0)
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('Bild nicht lesbar'))), 'image/jpeg', 0.85))
  return new Uint8Array(await blob.arrayBuffer())
}

// Die Mappe erzeugen und herunterladen. Alles im Browser: Die Belege liegen ohnehin hier, und
// der Server braucht dafür kein Werkzeug, das in der Programmdatei fehlen könnte.
// Gibt die Namen der Belege zurück, die nicht hineinkamen.
async function downloadTenantFolder(plan: TenantFolderPlan, meta: FolderMeta): Promise<string[]> {
  const unreadable: string[] = []
  const bytes = await buildTenantFolderPdf(plan, {
    title: meta.title,
    subtitle: meta.subtitle,
    load: async (u) => {
      const res = await fetch(`/uploads/${encodeURIComponent(u.file)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    rasterize: async (u) => Promise.all((await renderInvoicePages(u.file)).map(jpegBytes)),
    onUnreadable: (u) => unreadable.push(receiptName(u)),
  })
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = meta.fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return unreadable
}

const fileLabel = (s: string) => s.normalize('NFC').replace(/[^\w\-äöüÄÖÜß]+/g, '-').replace(/^-+|-+$/g, '') || 'objekt'

// Der Abrechnungszeitraum, den die Mappe eines Kalenderjahres meint (#208): der, der im Jahr
// beginnt; beim Kalenderobjekt das Jahr selbst.
function packPeriod(rules: PeriodRules, year: number): BillingPeriod {
  return periodsBetween(rules, `${year}-01-01`, `${year}-12-31`).find((p) => p.from.startsWith(`${year}-`)) ?? periodContaining(rules, `${year}-01-01`)
}

function FolderPacks({ propertyId, propertyName, year, chosen, rules, uploads, costItems, make }: {
  propertyId: string
  propertyName: string
  year: number
  // Der in der Seitenleiste gewählte Zeitraum, wenn die Mappe dessen Objekt gilt; sonst der, der im Jahr beginnt
  chosen: BillingPeriod | null
  rules: PeriodRules
  uploads: UploadInfo[]
  costItems: CostItem[]
  make: (plan: TenantFolderPlan, meta: FolderMeta) => Promise<string[] | void>
}) {
  const [open, setOpen] = useState(false)
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  // Die Teile je Rechnung über alle Zeiträume (#455): Ein Teil ohne eigenen Beleg bekommt den seiner Rechnung.
  const parts = useMemo(() => partsBySource(costItems), [costItems])
  const [includeIndividual, setIncludeIndividual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const toast = useToast()
  const period = chosen ?? packPeriod(rules, year)
  const label = periodLabel(period)
  const param = isCalendarRules(rules) ? String(year) : period.key

  useEffect(() => {
    if (!open) return
    let live = true
    setSettlement(null)
    api<Settlement>(withProperty(`/api/settlement/${param}`, propertyId))
      .then((st) => { if (live) setSettlement(st) }, (e) => { if (live) setProblem(errorText(e)) })
    return () => { live = false }
  }, [open, param, propertyId])

  const plan = useMemo(
    () => (settlement ? planTenantFolder(settlement, costItems.filter((c) => c.propertyId === propertyId && c.period === period.key), uploads, { includeIndividual }, parts) : null),
    [settlement, costItems, uploads, includeIndividual, propertyId, period.key, parts],
  )
  const count = (status: string) => plan?.entries.filter((e) => e.status === status).length ?? 0
  const individual = plan?.entries.filter((e) => isIndividualAmounts(e.item) && e.upload).length ?? 0

  async function create() {
    if (!plan) return
    setBusy(true)
    setProblem('')
    try {
      const unreadable = await make(plan, {
        title: `Belegmappe ${label}`,
        subtitle: propertyName,
        fileName: `belegmappe-${label.replace(/[^\d-]+/g, '-').replace(/^-+|-+$/g, '')}-${fileLabel(propertyName)}.pdf`,
      })
      toast('Die Belegmappe ist erstellt.')
      if (unreadable && unreadable.length > 0) {
        setProblem(`Nicht übernehmbar, bitte gesondert beilegen: ${unreadable.join(', ')}. Das Deckblatt nennt sie.`)
      }
    } catch (e) {
      setProblem(`Die Mappe ließ sich nicht erstellen: ${errorText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={<>Mappen packen · {year}</>} className="no-print receipt-packs">
      <div className="row receipt-filters">
        <a className="btn" href={withProperty(`/api/receipts/tax/${year}`, propertyId)} download>🧾 Belege für die Steuer (ZIP)</a>
        <span className="muted">Alle Belege des Jahres nach den Gruppen der Anlage V, auch die nicht umlagefähigen, mit einer Übersicht.</span>
      </div>
      <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>📎 Belegmappe für Mieter · {label} (PDF)</summary>
        <p className="muted">
          Für die Belegeinsicht: die Belege der umgelegten Positionen in der Reihenfolge der Abrechnung, mit einem Deckblatt
          „Position → Beleg, Seite“. Seit 2025 dürfen Sie die Belege elektronisch bereitstellen (§ 556 Abs. 4 BGB).
        </p>
        {problem && <NoticeBox level="error" action={problem} />}
        {!plan ? (
          !problem && <div className="muted">Lädt die Abrechnung …</div>
        ) : (
          <>
            <p>
              {plan.documents.length} Beleg{plan.documents.length === 1 ? '' : 'e'} zu {plan.entries.length} umgelegten Position{plan.entries.length === 1 ? '' : 'en'}
              {count('none') > 0 && <> · {count('none')} Position{count('none') === 1 ? '' : 'en'} ohne Beleg</>}
              {count('missing') > 0 && <> · bei {count('missing')} fehlt die Datei</>}
            </p>
            {individual > 0 && (
              <label className="field checkline">
                <span>
                  <input type="checkbox" checked={includeIndividual} onChange={(e) => setIncludeIndividual(e.target.checked)} />{' '}
                  Belege beilegen, die nur einzelne Mieter betreffen ({individual})
                </span>
              </label>
            )}
            {individual > 0 && (
              <NoticeBox level="warning" action={<>
                Belege zu „Einzelbeträge je Mieter“ (etwa die Abrechnung eines Messdienstes), zu einer Direktzuordnung oder zu einer
                Position mit Teilnehmern betreffen nur einzelne Mieter und nennen oft deren Namen und Verbrauchswerte. Ein Mieter darf
                auch sie einsehen, ohne ein besonderes Interesse darzulegen (BGH, Urteil vom 07.02.2018, VIII ZR 189/17). Weil die Mappe
                an alle Mieter des Objekts geht, legen Sie sie am besten nur dem bei, der danach fragt, und prüfen vorher, ob Namen darauf
                stehen müssen. Ohne Haken stehen diese Positionen im Deckblatt mit „auf Anfrage“.
              </>} />
            )}
            <button className="btn" onClick={() => void create()} disabled={busy || plan.entries.length === 0}>
              {busy ? 'Wird erstellt …' : 'PDF erstellen'}
            </button>
          </>
        )}
      </details>
    </Card>
  )
}

type Props = {
  // Für Tests: ohne pdf.js
  renderThumb?: typeof renderThumbnail
  // Belege aus dem Posteingang per KI auswerten: übergibt sie der Schnellerfassung (App.tsx)
  onEvaluate?: (uploads: UploadInfo[]) => void
  // Ein Beleg mit offener Auswertung: weiter in der Prüfung der Schnellerfassung (#170)
  onContinue?: (upload: ReceiptUpload) => void
  // Eine Position im Formular der Seite Kosten öffnen, etwa um Betrag und §35a dort zu pflegen
  onOpenItem?: (item: CostItem) => void
  // Für Tests: die Belegmappe erzeugen, ohne pdf.js und Download
  makeTenantFolder?: (plan: TenantFolderPlan, meta: FolderMeta) => Promise<string[] | void>
}

// Eine Auswahl, die erst mit „Speichern“ wirkt (#309): Beleg und Position einander zuordnen. Die leere
// Wahl ist der gespeicherte Wert; wer etwas wählt, hat einen Entwurf, und erst „Speichern“ hängt den Beleg an.
// Steht die gewählte Position oder der gewählte Beleg nicht mehr unter `values` (die Liste folgt Objekt und
// Jahr, ein Beleg wurde anderswo zugeordnet), ist die Wahl verworfen (Durchsicht zu #309, MUSS 2).
function AttachPicker({ label, what, placeholder, scope, values, onSave, children }: {
  label: string
  what: string
  placeholder: string
  scope: string
  values: readonly string[]
  onSave: (value: string) => Promise<unknown>
  children: React.ReactNode
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

// Objekt und Jahr eines Belegs im Posteingang (#309): ein Entwurf für beide Felder mit einem „Speichern“.
// Gesendet wird nur, was sich geändert hat; der Server zieht die Auswertung desselben Belegs nach, solange
// aus ihr nichts gebucht ist (Belegbuchung).
type Placement = { propertyId: string; year: string }
function InboxPlacement({ upload, properties, yearOptions, onSave, children }: {
  upload: UploadInfo
  properties: readonly Property[]
  yearOptions: readonly number[]
  onSave: (changes: { propertyId?: string | null; year?: number | null }) => Promise<unknown>
  // `dirty`: Objekt oder Jahr sind geändert und nicht gespeichert.
  children: (placement: { propertyId: string | null; year: number | null; dirty: boolean }) => React.ReactNode
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

export default function Belege({ renderThumb = renderThumbnail, onEvaluate, onContinue, onOpenItem, makeTenantFolder = downloadTenantFolder }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const { year: currentYear, calendarYearOptions, calendar, key: periodKeyNow, period: periodNow, label: periodLabelNow } = usePeriod()
  const { property, properties } = useProperty()
  const [uploads, setUploads] = useState<UploadEntry[]>([])
  const [loadedItems, setLoadedItems] = useState<CostItem[]>([])
  const [plantsBy, setPlantsBy] = useState<Map<string, PlantPeriods[]>>(new Map())
  const [error, setError] = useState('')
  // Nach dem Zuordnen eines Belegs: Betrag der Position prüfen (Befund C). Eine aus dem Vorjahr
  // übernommene Position trägt einen geschätzten Betrag, der sonst still stehen bliebe.
  // `closed`: Die Abrechnung des Jahres der Position ist abgeschlossen; eine Änderung erscheint dort
  // als Abweichung (Integrationsdurchsicht vor 0.10).
  const [amountCheck, setAmountCheck] = useState<{ item: CostItem; file: string; amount: string; problem: string; form?: boolean; closed?: boolean } | null>(null)
  // „Betrag prüfen“ zählt als offenes Formular (#346, 7a): Die Frage zum Schätzbetrag kommt nach einem
  // Seitenwechsel nie wieder, und die Schätzung bliebe still stehen.
  useOpenForm(amountCheck !== null)
  // Wer aus dem Kasten weiterspringt, schließt ihn vorher wirklich: Sonst fände der Sprung die Marke noch
  // gesetzt und fragte nach dem Kasten, den er gerade schließt.
  const leaveCheck = (go: () => void) => { flushSync(() => setAmountCheck(null)); go() }
  // Der Ordner zeigt das Objekt und das Jahr der Seitenleiste (#170); gewählt werden beide nur dort (#346
  // Schritt 8, M13: vorher gab es hier eine zweite Auswahl für beide). Was der Ordner darüber hinaus kann, ist
  // ein Umfang und keine Wahl: Belege aller Objekte bzw. aller Jahre zeigen. Das Jahr ist das Kalenderjahr, in
  // dem der gewählte Zeitraum beginnt; darunter stehen seine Positionen (receipts.ts).
  const [allProperties, setAllProperties] = useState(false)
  const [allYears, setAllYears] = useState(false)
  const [query, setQuery] = useState('')

  const load = useCallback(() => {
    // Der Belegordner gilt für die ganze Installation (#92). Welche Belege an einer Kostenposition
    // hängen, wird deshalb über alle Objekte gefragt, je Objekt einzeln: Die Routen grenzen immer
    // auf ein Objekt ein, eine zweite Regel „alle“ gibt es dort bewusst nicht.
    // Dazu die Heizanlagen: Eine Heizposition mit eigener Heizperiode gehört in das Jahr, in dem
    // diese endet (E32). Fehlen sie, bleibt jede Position bei ihrem Schlüssel.
    const allItems = () =>
      api<Property[]>('/api/properties')
        .then((list) => Promise.all(list.map((p) => Promise.all([
          api<CostItem[]>(withProperty('/api/costItems', p.id)),
          api<PlantPeriods[]>(withProperty('/api/heating-plants', p.id)).catch(() => []),
        ]).then(([items, plants]) => ({ id: p.id, items, plants })))))
    return Promise.all([api<UploadEntry[]>('/api/uploads'), allItems()])
      .then(([u, c]) => {
        setUploads(u.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)))
        setLoadedItems(c.flatMap((x) => x.items))
        setPlantsBy(new Map(c.map((x) => [x.id, x.plants])))
        setError('')
      })
      .catch((e) => setError(String((e as Error).message)))
  }, [])

  useEffect(() => { void load() }, [load])
  // Die Positionen mit dem Schlüssel ihrer Abrechnung (E32): Register, Belegabdeckung, Posteingang
  // und Belegmappe ordnen danach, wie Kosten und Abrechnung. Geschrieben wird nur mit der Kennung.
  const costItems = useMemo(
    () => filedUnderSettlement(loadedItems, (id) => rulesOf(properties.find((p) => p.id === id)), (id) => plantsBy.get(id) ?? []),
    [loadedItems, properties, plantsBy],
  )

  // Ohne gewähltes Objekt (oder mit nur einem) gilt „alle“: Bei einem Objekt ist das dasselbe.
  const filter: FolderFilter = useMemo(() => ({
    propertyId: properties.length > 1 && !allProperties && property ? property.id : 'all',
    year: allYears ? 'all' : currentYear,
    // Der gewählte Zeitraum des Objekts der Seitenleiste: Rumpf und neuer Zeitraum beginnen im selben Jahr (#346 Schritt 12)
    period: !allYears && !calendar && property ? { propertyId: property.id, key: periodKeyNow } : null,
  }), [allProperties, allYears, property, currentYear, properties.length, calendar, periodKeyNow])
  const folder = useMemo(() => buildFolder(uploads, costItems, filter, query), [uploads, costItems, filter, query])
  const allCards = useMemo(() => receiptCards(uploads, costItems), [uploads, costItems])
  const hints = useMemo(() => duplicateHints(allCards), [allCards])
  const meterPhotos = useMemo(() => allCards.filter((c) => c.upload.kind === 'meterPhoto' && c.items.length === 0), [allCards])
  // Die Suche gilt auch im Posteingang
  const inbox = useMemo(() => inboxOf(allCards.filter((c) => matchesQuery(c, query)), filter), [allCards, filter, query])
  // Die neuesten 20, darunter „Ältere anzeigen (N)“; eine andere Auswahl oder Suche beginnt wieder bei 20.
  const inboxScope = `${filter.propertyId}|${filter.year}|${query}`
  const [inboxCount, setInboxCount] = useState({ scope: inboxScope, count: INBOX_STEP })
  const inboxShown = inboxPage(inbox.here, inboxCount.scope === inboxScope ? inboxCount.count : INBOX_STEP)
  // Nach „Ältere anzeigen“ der Fokus auf die erste neu gezeigte Karte (Durchsicht von PR #449, K3)
  const inboxList = useRef<HTMLUListElement>(null)
  const inboxFocus = useFocusFirstNew(inboxList, ':scope > li', '.receipt-title a')
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(0)
  const present = useMemo(() => new Set(uploads.map((u) => u.file)), [uploads])
  const booked = useMemo(() => filesByItem(uploads), [uploads])
  // Die Teile je Rechnung (#455): Der Beleg eines Teils belegt auch die übrigen.
  const parts = useMemo(() => partsBySource(costItems), [costItems])
  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name || 'Ohne Namen'
  const showProperty = filter.propertyId === 'all' && properties.length > 1
  // Mappen gibt es je Objekt und Jahr; bei einem einzigen Objekt ist es dieses.
  const packProperty = filter.propertyId !== 'all' ? filter.propertyId : properties.length === 1 ? properties[0]?.id ?? null : null
  // Die Jahre der Auswahl: die üblichen, dazu jedes Jahr, in dem es Positionen gibt
  const yearOptions = useMemo(
    () => [...new Set([...calendarYearOptions, currentYear, ...costItems.map((c) => startYearOf(c.period))])].sort((a, b) => b - a),
    [costItems, currentYear, calendarYearOptions],
  )

  // Belegabdeckung (#170): je Objekt der Auswahl, bei „alle Objekte“ also eine Zeile je Objekt
  const coverageRows = useMemo(() => {
    const ids = filter.propertyId === 'all' ? (properties.length > 0 ? properties.map((p) => p.id) : [...new Set(costItems.map((c) => c.propertyId))]) : [filter.propertyId]
    return ids
      .map((id) => ({ id, cov: coverage(costItems, { propertyId: properties.length > 1 ? id : 'all', year: filter.year, period: filter.period }, present, booked) }))
      .filter((r) => r.cov.positions > 0)
  }, [costItems, filter, present, booked, properties])

  // „Nachreichen“: einen Beleg an eine Position hängen, neu hochgeladen oder aus den Belegen, die
  // an keiner Position hängen. Hochgeladen wird mit Objekt und Jahr der Position, damit der Beleg
  // dort im Posteingang steht, falls das Verknüpfen danach scheitert.
  async function attach(c: CostItem, invoiceFile: string) {
    await api(`/api/costItems/${encodeURIComponent(c.id)}`, { method: 'PUT', body: JSON.stringify({ invoiceFile }) })
    setAmountCheck({ item: c, file: invoiceFile, amount: '', problem: '' })
    // Ist die Abrechnung des Jahres abgeschlossen, sagt der Kasten es. Scheitert die Frage, fehlt
    // nur der Satz; das Zuordnen ist schon gespeichert. Abgewartet wird sie nicht: Das „Speichern“
    // der Zuordnung (#309) ist mit dem PUT erledigt und soll nicht an dieser Auskunft hängen.
    void (async () => {
      try {
        // Die Abrechnung, zu der die Position gehört; nach Weg d ihre Heizkostenabrechnung (Durchsicht N2).
        const raw = loadedItems.find((x) => x.id === c.id) ?? c
        const path = closedCheckPath(raw, rulesOf(properties.find((p) => p.id === c.propertyId)), plantsBy.get(c.propertyId) ?? [])
        const s = await api<Pick<Settlement, 'closed'>>(withProperty(path, c.propertyId))
        if (s.closed) setAmountCheck((cur) => (cur && cur.item.id === c.id && cur.file === invoiceFile ? { ...cur, closed: true } : cur))
      } catch { /* ohne Auskunft kein Satz */ }
    })()
  }
  async function saveCheckedAmount() {
    if (!amountCheck) return
    const built = amountCheckBody(amountCheck.amount, amountCheck.item)
    if ('error' in built) { setAmountCheck({ ...amountCheck, problem: built.error, form: built.form }); return }
    try {
      await api(`/api/costItems/${encodeURIComponent(amountCheck.item.id)}`, { method: 'PUT', body: JSON.stringify(built.body) })
      setAmountCheck(null)
      await load()
      toast(`Betrag von „${amountCheck.item.description}“ auf ${fmtEuro(built.body.amountCents)} gesetzt.`)
    } catch (e) {
      setAmountCheck({ ...amountCheck, problem: errorText(e) })
    }
  }
  async function uploadFor(c: CostItem, f: File) {
    const fd = new FormData()
    fd.append('file', f)
    fd.append('propertyId', c.propertyId)
    fd.append('year', String(startYearOf(c.period)))
    try {
      const res = await api<{ file: string }>('/api/upload', { method: 'POST', body: fd })
      await attach(c, res.file)
      await load()
      toast(`Beleg an „${c.description}“ angehängt.`)
    } catch (e) {
      setError(`Der Beleg wurde nicht angehängt: ${errorText(e)}`)
    }
  }
  // Ein Fehler geht an den Aufrufer: Die Auswahl zeigt ihn am Knopf, und ihr Entwurf bleibt (#309).
  async function attachExisting(c: CostItem, file: string) {
    await attach(c, file)
    await load()
    toast(`Beleg an „${c.description}“ angehängt.`)
  }
  async function attachById(itemId: string, file: string) {
    const c = costItems.find((x) => x.id === itemId)
    if (!c) throw new Error('Diese Position gibt es nicht mehr. Bitte laden Sie die Seite neu.')
    await attachExisting(c, file)
  }

  // ---------- Posteingang (#170) ----------

  // Mehrere Belege auf einmal, nacheinander hochgeladen. Sie bekommen Objekt und Jahr der
  // Auswahl mit; bei „alle“ bleiben sie ohne, bis jemand sie zuordnet.
  async function uploadToInbox(files: File[]) {
    const ok = files.filter((f) => /^(application\/pdf|image\/)/.test(f.type))
    if (ok.length < files.length) setError('Nur PDFs und Bilder lassen sich als Beleg hochladen; die übrigen Dateien wurden übergangen.')
    let done = 0
    for (const f of ok) {
      setUploading(ok.length - done)
      const fd = new FormData()
      fd.append('file', f)
      if (filter.propertyId !== 'all') fd.append('propertyId', filter.propertyId)
      else if (properties.length === 1 && properties[0]) fd.append('propertyId', properties[0].id)
      if (filter.year !== 'all') fd.append('year', String(filter.year))
      try {
        await api('/api/upload', { method: 'POST', body: fd })
        done++
      } catch (e) {
        setError(`„${f.name}“ wurde nicht hochgeladen: ${errorText(e)}`)
      }
    }
    setUploading(0)
    await load()
    if (done > 0) toast(done === 1 ? 'Ein Beleg liegt im Posteingang.' : `${done} Belege liegen im Posteingang.`)
  }

  // „Weiter prüfen“: Die Schnellerfassung zeigt nur die Auswertungen eines Objekts. Hat die
  // Auswertung noch keins (der Beleg kam ohne Zuordnung), bekommt sie erst das gewählte; das geht,
  // solange nichts gebucht ist. Scheitert es, bleibt die Seite, statt ins Leere zu führen.
  async function continueChecking(u: ReceiptUpload) {
    if (!onContinue) return
    const current = u.assessment
    if (current && current.propertyId === null && property) {
      try {
        await api(`/api/assessments/${encodeURIComponent(current.id)}`, { method: 'PUT', body: JSON.stringify({ propertyId: property.id }) })
      } catch (e) {
        setError(`Die Auswertung wurde nicht dem Objekt zugeordnet: ${errorText(e)}`)
        return
      }
      onContinue({ ...u, assessment: { ...current, propertyId: property.id } })
      return
    }
    onContinue(u)
  }

  async function place(u: UploadInfo, changes: { propertyId?: string | null; year?: number | null }) {
    await api(`/api/uploads/${encodeURIComponent(u.file)}`, { method: 'PUT', body: JSON.stringify(changes) })
    await load()
  }

  // Die Positionen, denen ein Beleg aus dem Posteingang zugeordnet werden kann: die ohne Beleg im
  // Objekt und Jahr, denen er zugedacht ist, sonst in denen der Auswahl. Zugedacht ist, was die Karte
  // gerade zeigt, auch ein noch nicht gespeicherter Entwurf (#309).
  const candidatesFor = (u: Pick<UploadInfo, 'propertyId' | 'year'>): CostItem[] => {
    const propertyId = u.propertyId ?? (filter.propertyId === 'all' ? null : filter.propertyId)
    const year = u.year ?? (filter.year === 'all' ? null : filter.year)
    return costItems
      .filter((c) => (propertyId === null || c.propertyId === propertyId) && (year === null || startYearOf(c.period) === year))
      .filter((c) => !c.invoiceFile || !present.has(c.invoiceFile))
      .sort((a, b) => startYearOf(b.period) - startYearOf(a.period) || a.category.localeCompare(b.category, 'de') || a.description.localeCompare(b.description, 'de'))
  }

  async function deleteFile(f: UploadInfo) {
    const ok = await confirm({
      title: 'Beleg endgültig löschen?',
      message: `„${receiptName(f)}“ wird unwiderruflich von der Festplatte entfernt.`,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/uploads/${encodeURIComponent(f.file)}`, { method: 'DELETE' })
      await load()
      toast('Beleg gelöscht.')
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  const renderCard = (card: ReceiptCard) => {
    const { upload } = card
    const dup = hints.get(upload.file)
    return (
      <li key={upload.file} className="receipt-card">
        <Thumb upload={upload} render={renderThumb} />
        <div className="receipt-body">
          <div className="receipt-title">
            <a href={`/uploads/${encodeURIComponent(upload.file)}`} target="_blank" rel="noreferrer">{card.vendor || receiptName(upload)}</a>
            {card.items.length > 0 && <strong className="num">{fmtEuro(card.amountCents)}</strong>}
          </div>
          <div className="muted">
            {card.vendor && <>{receiptName(upload)} · </>}hochgeladen {fmtDay(upload.uploadedAt)} · {fmtSize(upload.size)}
            {showProperty && card.propertyIds.length > 0 && <> · <span className="badge gray">{card.propertyIds.map(propertyName).join(', ')}</span></>}
          </div>
          {upload.kind === 'meterPhoto' ? (
            <span className="badge gray">Zählerfoto aus der Schnellerfassung</span>
          ) : card.items.length > 0 ? (
            <ul className="receipt-items">
              {card.items.map((c) => (
                <li key={c.id}>→ {c.description}{filter.year === startYearOf(c.period) ? '' : ` (${startYearOf(c.period)})`} · {fmtEuro(c.amountCents)}</li>
              ))}
            </ul>
          ) : (
            <div className="receipt-inbox-controls">
              <InboxPlacement upload={upload} properties={properties} yearOptions={yearOptions} onSave={(changes) => place(upload, changes)}>
                {(placement) => (
                  <>
                    {candidatesFor(placement).length > 0 && (() => {
                      // Passt die Kostenart, die der Name des Belegs nennt, stehen diese Positionen oben
                      // (shared/duplicates.ts); sonst die Liste wie gehabt.
                      const choices = attachChoices(upload, candidatesFor(placement))
                      const option = (c: CostItem) => <option key={c.id} value={c.id}>{startYearOf(c.period)} · {c.category} · {c.description} · {fmtEuro(c.amountCents)}</option>
                      return (
                        <AttachPicker label={`${receiptName(upload)} einer Position zuordnen`} what={`Position für ${receiptName(upload)}`}
                          placeholder="Position wählen …" scope={upload.file} values={candidatesFor(placement).map((c) => c.id)}
                          onSave={(id) => attachById(id, upload.file)}>
                          {choices.likely.length > 0 ? (
                            <>
                              <optgroup label={`Passend zu „${choices.category}“`}>{choices.likely.map(option)}</optgroup>
                              {choices.rest.length > 0 && <optgroup label="Weitere Positionen ohne Beleg">{choices.rest.map(option)}</optgroup>}
                            </>
                          ) : choices.rest.map(option)}
                        </AttachPicker>
                      )
                    })()}
                    {/* Auswerten nimmt Objekt und Jahr, wie sie gespeichert sind; mit einem Entwurf daran vorbei landete
                        die Auswertung in einem anderen Objekt (Durchsicht zu #309, SOLLTE 3). */}
                    {upload.assessment?.open && onContinue ? (
                      <button className="btn" aria-label={`${receiptName(upload)} weiter prüfen`} disabled={placement.dirty} onClick={() => void continueChecking(upload)}>Weiter prüfen</button>
                    ) : onEvaluate && (
                      <button className="btn" aria-label={`${receiptName(upload)} per KI auswerten`} disabled={placement.dirty} onClick={() => onEvaluate([upload])}>Per KI auswerten</button>
                    )}
                    {placement.dirty && (upload.assessment?.open ? onContinue : onEvaluate) && <span className="muted">{PLACEMENT_FIRST}</span>}
                  </>
                )}
              </InboxPlacement>
            </div>
          )}
          {upload.invoiceDate && <div className="muted">Rechnungsdatum {fmtDate(upload.invoiceDate)}</div>}
          {dup && <div className="receipt-hint">⚠ {dup}</div>}
        </div>
        {card.items.length === 0 && (
          <button className="icon-btn danger" title="Löschen" aria-label={`Beleg ${receiptName(upload)} löschen`} onClick={() => void deleteFile(upload)}>🗑</button>
        )}
      </li>
    )
  }

  // Ein Register: eine Kostenart eines Jahres, mit den Belegen und den Positionen ohne Beleg
  const renderGroup = (g: CategoryGroup) => {
    // Wie die Belegabdeckung: auch ein Beleg über eine gebuchte Zeile deckt die Position (Durchsicht von PR #449, K2).
    // Je Rechnung wie die Belegabdeckung (#455): Die Teile einer Quelle zählen als eine Position.
    const { positions, without: ohne } = registerCount(g, present, booked, parts)
    return (
      <details key={g.key} className="card receipt-group" open>
        <summary>
          <span className="receipt-group-title">{g.category}</span>
          <span className="num">{fmtEuro(g.sumCents)}</span>
          {ohne === 0
            ? <span className="badge green">✓ {positions === 1 ? 'Beleg vorhanden' : 'alle Belege vorhanden'}</span>
            : <span className="badge amber">⚠ {ohne} von {positions} Position{positions > 1 ? 'en' : ''} ohne Beleg</span>}
        </summary>
        {g.cards.length > 0 && <ul className="receipt-list">{g.cards.map(renderCard)}</ul>}
        {g.missing.length > 0 && (
          <ul className="receipt-missing">
            {g.missing.map((c) => (
              <li key={c.id}>
                <span>– {c.description}{showProperty ? ` (${propertyName(c.propertyId)})` : ''} · {fmtEuro(c.amountCents)} <span className="muted">ohne Beleg</span></span>
                {/* Der Knopf darf nicht springen, wenn hinter der Auswahl „Speichern“ und „Verwerfen“ erscheinen (N7 aus
                    #341). Die Gruppe ist auch nach einem Umbruch rechtsbündig; am breiten Bildschirm steht der Knopf zuletzt,
                    sodass sie nach links wächst, am Handy zuerst, sodass die Knöpfe darunter umbrechen (Durchsicht von N7) */}
                <span className="receipt-attach ml-auto justify-end">
                  {inboxFor(allCards, c).length > 0 && (
                    <AttachPicker label={`Vorhandenen Beleg für ${c.description} zuordnen`} what={`Beleg für ${c.description}`}
                      placeholder="Aus dem Posteingang …" scope={c.id} values={inboxFor(allCards, c).map((u) => u.upload.file)}
                      onSave={(file) => attachExisting(c, file)}>
                      {inboxFor(allCards, c).map((u) => <option key={u.upload.file} value={u.upload.file}>{receiptName(u.upload)}</option>)}
                    </AttachPicker>
                  )}
                  <label className="btn secondary max-sm:order-first">
                    Beleg nachreichen
                    <input
                      type="file"
                      className="sr-only"
                      accept="application/pdf,image/*"
                      aria-label={`Beleg für ${c.description} hochladen`}
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadFor(c, f) }}
                    />
                  </label>
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    )
  }

  return (
    <>
      <PageHeader
        title="Belegordner"
        subtitle="Ihre Belege wie im Ordner aus Papier: je Objekt und Jahr, mit einem Register je Kostenart. Neue Belege kommen in den Posteingang."
      />
      {error && <NoticeBox level="error" action={error} />}
      {amountCheck && (
        <div role="status" aria-label="Betrag prüfen"><NoticeBox level="warning" className="stack no-print">
          Beleg an „{amountCheck.item.description}“ angehängt. Betrag der Position: <strong>{fmtEuro(amountCheck.item.amountCents)}</strong>.
          {amountCheck.closed && <div>{closedPeriodNotice(labelOfKey(rulesOf(properties.find((p) => p.id === amountCheck.item.propertyId)), amountCheck.item.period))}</div>}
          {' '}Stimmt er mit dem Beleg überein? Eine aus dem Vorjahr übernommene Position trägt oft noch einen geschätzten Betrag.{' '}
          <a href={`/uploads/${encodeURIComponent(amountCheck.file)}`} target="_blank" rel="noreferrer">Beleg ansehen</a>
          {/* Ein geschätzter Lohnanteil gelangte sonst still in die Anlage V (dritte Durchsicht). */}
          {(amountCheck.item.labor35aCents ?? 0) > 0 && (
            <div>
              Lohnanteil der Position: <strong>{fmtEuro(amountCheck.item.labor35aCents ?? 0)}</strong> – stimmt er mit dem Beleg?{' '}
              {onOpenItem && <button className="btn small ghost" onClick={() => { const it = amountCheck.item; leaveCheck(() => onOpenItem(it)) }}>Lohnanteil im Formular prüfen</button>}
            </div>
          )}
          {amountCheckMode(amountCheck.item) === 'form' ? (
            <div className="row center">
              <span>Bei dieser Position prüfen Sie den Betrag im Formular: Er hängt an weiteren Angaben (Einzelbeträge oder Kosten der Gemeinschaft).</span>
              {onOpenItem && <button className="btn small" onClick={() => { const it = amountCheck.item; leaveCheck(() => onOpenItem(it)) }}>Position öffnen</button>}
              <button className="btn small ghost" onClick={() => setAmountCheck(null)}>Schließen</button>
            </div>
          ) : (
          <div className="row">
            <label className="field">
              Betrag laut Beleg
              <input inputMode="decimal" value={amountCheck.amount} placeholder={fmtEuro(amountCheck.item.amountCents)} className="input-num"
                onChange={(e) => setAmountCheck({ ...amountCheck, amount: e.target.value, problem: '' })} />
            </label>
            <button className="btn small" onClick={() => void saveCheckedAmount()} disabled={!amountCheck.amount.trim()}>Betrag speichern</button>
            <button className="btn small ghost" onClick={() => setAmountCheck(null)}>Stimmt so</button>
          </div>
          )}
          {amountCheck.problem && (
            <NoticeBox level="error">
              {amountCheck.problem}
              {amountCheck.form && onOpenItem && <> <button className="btn small" onClick={() => { const it = amountCheck.item; leaveCheck(() => onOpenItem(it)) }}>Position öffnen</button></>}
            </NoticeBox>
          )}
        </NoticeBox></div>
      )}

      <div className="card no-print">
        {/* Suche in voller Breite, darunter die beiden Kästchen auf einer Linie (#346 Schritt 7b, Durchsicht M1 und K2):
            Der lange Platzhalter schnitt ab; was die Suche findet, steht jetzt als Hinweis. */}
        <Field label="Suche" width="full" hint="Findet Rechnungssteller, Beschreibung, Betrag (z. B. 128,40), Dateiname oder Jahr.">
          <input type="search" value={query} placeholder="z. B. Stadtwerke oder 128,40" onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <div className="checks">
          {properties.length > 1 && (
            <label className="field checkline">
              <span>
                <input type="checkbox" checked={allProperties} onChange={(e) => setAllProperties(e.target.checked)} />
                Belege aller Objekte zeigen
              </span>
            </label>
          )}
          <label className="field checkline">
            <span>
              <input type="checkbox" checked={allYears} onChange={(e) => setAllYears(e.target.checked)} />
              Belege aller Jahre zeigen
            </span>
          </label>
        </div>
        {/* Durchsicht zu Schritt 8, K2, und #346 Schritt 12: Bei einem anderen Rhythmus zeigt der Ordner für das Objekt der
            Seitenleiste den gewählten Zeitraum (receipts.ts, `period`); bei „alle Objekte“ für die übrigen die Zeiträume,
            die im Jahr beginnen. Nach einem Wechsel des Rhythmus beginnen Rumpf und neuer Zeitraum im selben Jahr. */}
        {!calendar && !allYears && (
          <p className="muted">
            Gezeigt sind die Positionen von {periodLabelNow}.
            {filter.propertyId === 'all' && properties.length > 1 && ` Bei den übrigen Objekten die Zeiträume, die ${currentYear} beginnen.`}
          </p>
        )}
      </div>

      <Card
        title={`📥 Posteingang (${inbox.here.length})`}
        aside={(
            <label className="btn">
            {uploading > 0 ? `Lädt hoch … (${uploading})` : 'Belege hochladen'}
            <input
              type="file"
              multiple
              className="sr-only"
              accept="application/pdf,image/*"
              aria-label="Belege in den Posteingang hochladen"
              disabled={uploading > 0}
              onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) void uploadToInbox(files) }}
            />
          </label>
        )}
        className={`receipt-inbox no-print${dragOver ? ' drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void uploadToInbox([...e.dataTransfer.files]) }}
      >
        <p className="muted">
          Belege, die an keiner Kostenposition hängen. Ziehen Sie neue Belege hierher oder laden Sie mehrere auf einmal hoch;
          danach ordnen Sie jeden einer Position zu oder lassen ihn per KI auswerten.
          {inbox.elsewhere > 0 && ` ${inbox.elsewhere} weitere ${inbox.elsewhere === 1 ? 'ist' : 'sind'} einem anderen Objekt oder Jahr zugedacht; Sie sehen ${inbox.elsewhere === 1 ? 'ihn' : 'sie'} mit ${properties.length > 1 ? '„Belege aller Objekte zeigen“ oder ' : ''}„Belege aller Jahre zeigen“.`}
        </p>
        {inboxShown.shown.length > 0 && <ul ref={inboxList} className="receipt-list">{inboxShown.shown.map(renderCard)}</ul>}
        {inboxShown.hidden > 0 && (
          <div className="row">
            <button type="button" className="btn secondary"
              onClick={() => { inboxFocus.expect(inboxShown.shown.length); setInboxCount({ scope: inboxScope, count: inboxShown.shown.length + INBOX_STEP }) }}>
              Ältere anzeigen ({inboxShown.hidden})
            </button>
          </div>
        )}
      </Card>

      {coverageRows.length > 0 && (
        <div className="card receipt-coverage">
          {coverageRows.map(({ id, cov }) => {
            const ohne = cov.positions - cov.covered
            return (
              <div key={id} className="receipt-coverage-row">
                <span>Belegabdeckung {filter.year === 'all' ? '' : `${filter.period?.propertyId === id ? periodLabelNow : filter.year} `}{coverageRows.length > 1 || showProperty ? `· ${propertyName(id)}` : ''}</span>
                <span className="progress" aria-hidden="true"><span className="progress-fill" style={{ width: `${cov.percent}%`, display: 'block' }} /></span>
                <strong>{cov.percent} %</strong>
                <span className="muted">{ohne === 0 ? 'alle Positionen belegt' : `${ohne} Position${ohne > 1 ? 'en' : ''} ohne Beleg`}</span>
              </div>
            )
          })}
        </div>
      )}

      {packProperty && filter.year !== 'all' && (
        <FolderPacks
          propertyId={packProperty}
          propertyName={propertyName(packProperty)}
          year={filter.year}
          chosen={filter.period?.propertyId === packProperty ? periodNow : null}
          rules={rulesOf(properties.find((p) => p.id === packProperty))}
          uploads={uploads}
          costItems={costItems}
          make={makeTenantFolder}
        />
      )}

      {folder.groups.length === 0 ? (
        <div className="card"><div className="empty">{query.trim() ? 'Nichts gefunden.' : 'Für diese Auswahl sind keine Kosten erfasst.'}</div></div>
      ) : filter.year === 'all' ? (
        // „Belege aller Jahre zeigen“: ein Abschnitt je Jahr mit Anzahl, aufgeklappt nur das gewählte Jahr; bei einer
        // Suche alle Jahre mit Treffern (Leistungsprüfung, Befund 4).
        yearSections(folder.groups).map((section) => (
          // Aufklapper und Kopfzeile wie ein Register (`receipt-group`), aber ohne Karte: Die Register stehen darin.
          <details key={section.year} data-year-section={section.year} className="receipt-group" open={section.year === currentYear || query.trim() !== ''}>
            <summary className="mb-3 border-b border-line py-2">
              <span className="text-l font-strong">{section.year}</span>
              <span className="muted">{section.receipts === 1 ? '1 Beleg' : `${section.receipts} Belege`}</span>
              {section.withoutReceipt > 0 && <span className="badge amber">⚠ {section.withoutReceipt} Position{section.withoutReceipt > 1 ? 'en' : ''} ohne Beleg</span>}
            </summary>
            {section.groups.map(renderGroup)}
          </details>
        ))
      ) : (
        folder.groups.map(renderGroup)
      )}

      {meterPhotos.length > 0 && (
        <details className="card no-print">
          <summary>Zählerfotos ({meterPhotos.length})</summary>
          <p className="muted">Fotos von Zählerständen aus der Schnellerfassung. Sie belegen keine Kosten und stehen deshalb nicht im Posteingang.</p>
          <ul className="receipt-list">{meterPhotos.map(renderCard)}</ul>
        </details>
      )}
    </>
  )
}
