// Die Ansicht „Eingang“ der Seite Belege (#490): Ablage und Arbeitsliste in einem, vorher Schnellerfassung und
// Posteingang des Belegordners. Oben die Ablage für Rechnungen und Zählerfotos (mit KI wertet sie aus, wahlweise „Nur
// ablegen“; ohne erreichbare KI speichert sie nur), die Ampelzählung und „Alle grünen übernehmen“; darunter „Wird
// ausgewertet“, „Zu prüfen“ (Auswertungen mit dem Beleg daneben, Zählerstände) und „Ohne Position“ (gespeicherte
// Belege: Objekt und Jahr, Zuordnen mit „Betrag prüfen“, „Per KI auswerten“, „Weiter prüfen“, Löschen). Ohne Filter:
// Der Eingang zeigt alles Offene des gewählten Objekts und Jahres samt Belegen ohne Zuordnung; was anderswo offen ist,
// nennt je eine Zeile mit dem Sprung dorthin.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AiStatus, AssessmentView, CostItem, NoticeSubject, Reading, Settings, Unit, UploadInfo, Meter } from '../types'
import { calendarPeriod, periodContext, periodOfKey, rulesOf, startYearOf } from '../../../shared/period.ts'
import { api, errorText, fmtEuro } from '../api'
import { aiSummary } from '../aiForm'
import { type KeyContext } from '../costForm'
import { bookDecisions, greenDecisions, loadOpenAssessments, openBadgeClass, planDecisions } from '../assessment'
import { assessmentOf, belongsTo, isBusy, useEvaluationQueue, type QueueEntry, type QueueTarget } from '../evaluationQueue'
import { initialCandidate, readingBody, scoreCandidate, type ReadingCandidate } from '../readingCandidate'
import AssessmentReview from '../components/AssessmentReview'
import DisclosureButton from '../components/DisclosureButton'
import { usePeriod, useSwitchTo } from '../period'
import { useProperty, withProperty } from '../property'
import { AiProgressBadge } from '../components/AiProgress'
import { plural } from '../../../shared/wording.ts'
import { NoticeBox } from '../components/Notice'
import { KeptReceipt } from '../components/KeptReceipt'
import { TakenOff } from '../components/TakenOff'
import { ReadingReview } from '../components/ReadingReview'
import { OtherQueueEntries } from '../components/OtherQueueEntries'
import { useRetryFocus } from '../retryFocus'
import { useConfirm, useToast } from '../components/feedback'
import { renderThumbnail } from '../pdfPreview'
import { useFocusFirstNew } from '../focusNew'
import { attachChoices, duplicateHints, inboxOf, inboxPage, INBOX_STEP, receiptCards, receiptName, type FolderFilter, type ReceiptCard, type ReceiptUpload } from '../receipts'
import { aiMode, elsewhereGroups, periodKeyOfYear, SKIPPED_FILES, splitFiles, withoutPosition } from '../belegeView'
import type { ReceiptStock } from '../receiptStock'
import { AmountCheckBox, AttachPicker, InboxPlacement, PLACEMENT_FIRST, ReceiptItem, useAttach, useHighlight } from '../components/ReceiptParts'

type Props = {
  stock: ReceiptStock
  units: Unit[]
  settings: Settings | null
  // Mit Ziel: die Position auf der Seite öffnen, etwa zum Pflegen im Formular
  onNavigate: (tab: string, focus?: NoticeSubject) => void
  // Eine Position im Formular der Seite Kosten öffnen („Betrag prüfen“), auch in einem anderen Objekt
  onOpenItem?: (item: CostItem) => void
  // Fehler mit Ausweg (#487): die KI-Einstellungen öffnen; bei einem Zählerfoto, dessen Ablesen gescheitert ist, die
  // Seite Zähler (Ablesung von Hand)
  onOpenAiSettings?: () => void
  onOpenMeters?: () => void
  // Ein Beleg, zu dem die Ansicht springen soll (ein Beleg ohne Position, etwa aus „Im Eingang zeigen“)
  focusFile?: string | null
  onFocusDone?: () => void
  // Die Zahl der offenen Einträge, für den Reiter „Eingang“
  onCount?: (count: number) => void
  // Für Tests: ohne pdf.js
  renderThumb?: typeof renderThumbnail
}

// Eine Gruppe des Eingangs mit Überschrift (für Vorleser und als Sprungmarke)
function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="no-print" aria-labelledby={`eingang-${id}`} data-group={id}>
      <h2 id={`eingang-${id}`} className="text-l font-strong mt-8 mb-3">{title}</h2>
      {children}
    </section>
  )
}

export default function BelegeEingang({ stock, units, settings, onNavigate, onOpenItem, onOpenAiSettings, onOpenMeters, focusFile, onFocusDone, onCount, renderThumb = renderThumbnail }: Props) {
  // Wohin die Belege zur Auswertung gehen (siehe aiForm.ts)
  const ai = aiSummary(settings)
  // Das Kalenderjahr, in dem der gewählte Zeitraum beginnt (#208): Ein Beleg ohne erkanntes Jahr
  // bekommt es, und die Belegbuchung leitet daraus den Zeitraum ab.
  const { year, key, rules, calendar, calendarYearOptions } = usePeriod()
  const { property, properties } = useProperty()
  const propertyId = property?.id
  const toast = useToast()
  const confirm = useConfirm()
  const switchTo = useSwitchTo()
  const [existingItems, setExistingItems] = useState<CostItem[]>([])
  const [meters, setMeters] = useState<Meter[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  // Ob Zähler und Ablesungen geantwortet haben: Erst dann steht der Vorschlag zu einem Zählerfoto da, und nur mit
  // ihnen ('ok') wird er festgehalten.
  const [meterData, setMeterData] = useState<'loading' | 'ok' | 'failed'>('loading')
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  // Was nach „Alle grünen übernehmen“ noch zu prüfen bleibt (#139)
  const [pending, setPending] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Ein gespeicherter, nicht ausgewerteter Beleg, der gelöscht oder zugeordnet ist: sein Eintrag ist erledigt (Durchsicht S3)
  const forgetKept = (file: string) => {
    for (const x of allRef.current) if (x.status === 'gespeichert' && (x.failure?.file ?? x.file) === file) remove(x.id)
  }
  const attach = useAttach(stock, properties, setError, forgetKept)


  // Gespeicherte Auswertungen dieses Objekts (#170): die offenen vom Server, dazu die in dieser
  // Sitzung gebuchten, damit „✓ übernommen“ stehen bleibt.
  const [assessments, setAssessments] = useState<AssessmentView[]>([])
  const upsert = (v: AssessmentView) =>
    setAssessments((list) => (list.some((x) => x.id === v.id) ? list.map((x) => (x.id === v.id ? v : x)) : [...list, v]))

  // Die eine Warteschlange der App (#490): Sie läuft weiter, wenn man die Seite, das Objekt oder den Zeitraum wechselt.
  // Der Eingang zeigt die Einträge seines Objekts und Zeitraums, die übrigen nennt eine Zeile (OtherQueueEntries).
  const { queue: all, patchEntry, addFiles, addStored, remove, cancel, retry, takeOff, asInvoice, sweep } = useEvaluationQueue()
  const allRef = useRef(all)
  allRef.current = all
  // Wer die Seite verlässt, sieht Erledigtes beim nächsten Mal nicht wieder (übernommen, abgebrochen, abgelegt).
  useEffect(() => () => sweep(), [sweep])
  // Objekt und Jahr für die Auswertung (#170); ein neuer Beleg steht damit im Eingang dieses Objekts, falls er
  // ungebucht bleibt.
  const target: QueueTarget = { propertyId, year, period: key, pageImageEdge: settings?.ai?.pageImageEdge ?? undefined }
  const queue = useMemo(() => all.filter((x) => belongsTo(x, propertyId, key)), [all, propertyId, key])
  const isReading = (x: QueueEntry) => x.status === 'fertig' && x.result?.kind === 'zaehler'
  const isInvoice = (x: QueueEntry) => x.result?.kind === 'rechnung'

  // Ob die Ablage auswertet (belegeView.ts, `aiMode`): Gefragt wird erst mit den Einstellungen, ein Dienst im Internet nie;
  // beim Ablegen und mit „Erneut prüfen“ noch einmal. Läuft eine Auswertung, ist die KI erreichbar.
  const external = !!settings?.aiExternal?.text
  const askable = settings !== null && !external
  const [status, setStatus] = useState<AiStatus | null>(null)
  const checkAi = useCallback(async (): Promise<AiStatus | null> => {
    if (!askable) return null
    try {
      const s = await api<AiStatus>('/api/ai/status')
      setStatus(s)
      return s
    } catch {
      return null // ohne Antwort wie vorher: auswerten
    }
  }, [askable])
  useEffect(() => { void checkAi() }, [checkAi])
  const busy = all.some(isBusy)
  const mode = aiMode(status, external, busy)

  // Eine Auswertung, die der Server nicht mehr als offen führt, ist gebucht, auch wenn das anderswo geschah (in
  // einem anderen Jahr, auf der Seite Kosten): Ihr Eintrag gilt dann als übernommen.
  const settleBooked = (open: AssessmentView[]) => {
    for (const x of allRef.current) {
      const v = assessmentOf(x)
      if (!isInvoice(x) || x.status !== 'fertig' || !v || (v.propertyId ?? x.propertyId) !== propertyId) continue
      if (!open.some((o) => o.id === v.id)) patchEntry(x.id, { status: 'übernommen' })
    }
  }

  const loadData = () => Promise.all([
    api<CostItem[]>(withProperty('/api/costItems', propertyId)).then(setExistingItems),
    Promise.all([api<Meter[]>(withProperty('/api/meters', propertyId)), api<Reading[]>(withProperty('/api/readings', propertyId))])
      .then(([m, r]) => { setMeters(m); setReadings(r); setMeterData('ok') }, (e: unknown) => { setMeterData('failed'); throw e }),
    loadOpenAssessments(propertyId).then((open) => {
      setAssessments((list) => [...list.filter((x) => !x.open && !open.some((o) => o.id === x.id)), ...open])
      settleBooked(open)
    }),
  ])
  // Mit dem Bestand der Seite: Was hier gebucht oder zugeordnet wird, steht danach im Ordner richtig.
  const reloadAll = () => Promise.all([loadData(), stock.reload()])
  useEffect(() => {
    loadData().catch(() => setError('Server nicht erreichbar: Läuft `npm run dev`?'))
    // Neu laden, wenn das Objekt wechselt (#92).
  }, [propertyId])

  // Kommt eine Antwort der Warteschlange (ausgewertet, gespeichert, gescheitert), steht der Beleg danach in der Ablage
  // und gegebenenfalls unter „Ohne Position“: einmal je Eintrag und Zustand den Bestand neu laden.
  const settledSeen = useRef(new Map<number, string>())
  const settledKey = queue.filter((x) => x.status !== 'wartend' && x.status !== 'läuft').map((x) => `${x.id}:${x.status}`).join('|')
  useEffect(() => {
    let changed = false
    for (const x of queue) {
      if (x.status === 'wartend' || x.status === 'läuft') continue
      if (settledSeen.current.get(x.id) !== x.status) { settledSeen.current.set(x.id, x.status); changed = true }
    }
    if (changed) void stock.reload()
  }, [settledKey])

  // Der Zählerstand eines Eintrags: nach der ersten Eingabe der eigene, sonst der Vorschlag aus der Antwort mit den
  // Zählern dieses Objekts (gezeigt, sobald sie geantwortet haben, auch mit einem Fehler).
  const readingOf = (x: QueueEntry): ReadingCandidate | null =>
    x.data.reading ?? (x.result?.kind === 'zaehler' && meterData !== 'loading' ? initialCandidate(x.result.reading, x.exifDate ?? null, meters, readings) : null)
  const focusAfterRetry = useRetryFocus(queue)
  // Der Vorschlag gilt ab dem Augenblick, in dem er entsteht (wie vor #490 mit der Antwort): Er bleibt am Eintrag, auch
  // wenn neue Ablesungen die Ampel ändern, und die andere Seite zeigt denselben. Erst mit den Zählern, sonst bliebe
  // ein Vorschlag ohne Zuordnung stehen.
  useEffect(() => {
    if (meterData !== 'ok') return
    for (const x of queue) {
      if (x.data.reading || x.result?.kind !== 'zaehler') continue
      const r = readingOf(x)
      if (r) patchEntry(x.id, { data: { reading: r } })
    }
  })

  // Ausgewertete Rechnungen kommen zu den Auswertungen der Seite, auch wenn die Antwort kam, während die Seite
  // nicht offen war. Je Eintrag einmal; danach gilt, was die Seite daraus macht (Buchen). Gebuchtes nicht.
  const absorbed = useRef(new Set<number>())
  useEffect(() => {
    for (const x of queue) {
      const v = assessmentOf(x)
      if (!isInvoice(x) || x.status !== 'fertig' || !v || absorbed.current.has(x.id)) continue
      absorbed.current.add(x.id)
      upsert(v)
    }
  }, [queue])

  // Nach einer Buchung steht die neue Fassung auch am Eintrag, in der ganzen Schlange: Der Beleg kann in einem
  // anderen Jahr hochgeladen sein, und die Seite Kosten zeigt dann dasselbe.
  const keepInQueue = (next: AssessmentView) => {
    for (const x of allRef.current) if (assessmentOf(x)?.id === next.id) patchEntry(x.id, { status: next.open ? 'fertig' : 'übernommen', data: { assessment: next } })
  }

  // Woraus eine Position ihren Schlüssel vorgeschlagen bekommt (#141), je Jahr des Belegs.
  // Der Vorschlag des Schlüssels sieht in den Zeitraum, in den gebucht wird (#208, `bookingPeriod`).
  const keyCtx = (v: AssessmentView): KeyContext => {
    const at = periodOfKey(rules, v.targetPeriod ?? calendarPeriod(v.year))
    return at ? { items: existingItems, year: v.year, at: periodContext(rules, at), propertyKind: property?.kind ?? null } : { items: existingItems, year: v.year, propertyKind: property?.kind ?? null }
  }

  function updateReading(entry: QueueEntry, patch: Partial<ReadingCandidate>) {
    const reading = readingOf(entry)
    if (reading) patchEntry(entry.id, { data: { reading: { ...reading, ...patch } } })
  }

  // ---------- Live-Bewertung der Zählerstände (re-scort bei jeder Eingabe) ----------
  const readingScores = useMemo(() => {
    const map = new Map<number, ReturnType<typeof scoreCandidate>>()
    for (const entry of queue) {
      const r = isReading(entry) ? readingOf(entry) : null
      if (r) map.set(entry.id, scoreCandidate(r, readings))
    }
    return map
  }, [queue, readings, meters, meterData])

  // Ampel-Zählung: offene Zeilen der Auswertungen (Vorschlag des Servers) und Zählerstände
  const tally = useMemo(() => {
    const t = { gruen: 0, gelb: 0, rot: 0 }
    for (const v of assessments) for (const l of v.lines) if (l.state === 'open' && l.suggestion) t[l.suggestion.level]++
    for (const rs of readingScores.values()) t[rs.level]++
    return t
  }, [assessments, readingScores])
  const totalRecognized = tally.gruen + tally.gelb + tally.rot
  // Grün im Sinne von „Alle grünen übernehmen“: dieselbe Bedingung für die Zählung und die
  // Übernahme, damit nie mehr angeboten wird, als gebucht würde.
  const readingReady = (entry: QueueEntry): boolean =>
    isReading(entry) && !!readingOf(entry)?.checked && readingScores.get(entry.id)?.level === 'gruen'
  // Auswertungen, deren Jahr der Buchung einen ungespeicherten Entwurf hat (Durchsicht zu #309, MUSS 1). Ihre Karte
  // zeigt ein anderes Jahr, als gebucht würde; „Alle grünen übernehmen“ lässt sie deshalb aus, bis das Jahr
  // gespeichert oder verworfen ist. Gesperrt wird nicht der ganze Knopf, damit die übrigen Belege weiterlaufen.
  const [yearDrafts, setYearDrafts] = useState<ReadonlySet<string>>(new Set())
  const onYearDraft = useCallback((id: string, dirty: boolean) => setYearDrafts((s) => {
    if (s.has(id) === dirty) return s
    const next = new Set(s)
    if (dirty) next.add(id)
    else next.delete(id)
    return next
  }), [])
  const greenOf = (v: AssessmentView) => (yearDrafts.has(v.id) ? [] : greenDecisions(v))
  // Die laufende Übernahme fragt je Beleg neu nach (Nachprüfung A2): Wer währenddessen an einem späteren
  // Beleg das Jahr ändert, dessen Beleg bleibt außen vor.
  const yearDraftsNow = useRef(yearDrafts)
  yearDraftsNow.current = yearDrafts
  const heldBack = assessments.filter((v) => yearDrafts.has(v.id) && greenDecisions(v).length > 0).length
  const greenReady = assessments.reduce((n, v) => n + greenOf(v).length, 0) + queue.filter(readingReady).length

  // Während eine Übernahme läuft, startet keine zweite: Ein Doppelklick legte sonst eine Ablesung
  // zweimal an (Rechnungen schützt zusätzlich der Server). Der Verweis gilt sofort, der Zustand
  // sperrt die Knöpfe.
  const adoptingRef = useRef(false)
  const [adopting, setAdopting] = useState(false)
  async function exclusively(work: () => Promise<void>) {
    if (adoptingRef.current) return
    adoptingRef.current = true
    setAdopting(true)
    try {
      await work()
    } finally {
      adoptingRef.current = false
      setAdopting(false)
    }
  }

  // ---------- Übernehmen ----------
  async function postReading(entry: QueueEntry) {
    const r = readingOf(entry)
    const body = r ? readingBody(r) : null
    if (!body) return false
    await api('/api/readings', { method: 'POST', body: JSON.stringify(body) })
    return true
  }

  // Übernimmt den Zählerstand eines Eintrags auf ausdrücklichen Klick. Als übernommen gilt er
  // erst, wenn er gesendet ist. Rechnungen bucht „Auswertung prüfen“.
  const adoptReading = (entry: QueueEntry) => exclusively(async () => {
    setError('')
    setPending('')
    try {
      if (!(await postReading(entry))) {
        setError('Nicht übernommen: Bitte ordnen Sie einen Zähler zu und geben Sie den Stand an, beim Zählerwechsel auch den Endstand des alten Zählers.')
        return
      }
    } catch (e) {
      setError(`Nicht übernommen: ${errorText(e)}`)
      await loadData()
      return
    }
    patchEntry(entry.id, { status: 'übernommen' })
    await loadData()
  })

  // Übernimmt alle grünen Vorschläge: je Auswertung Vorschau und Buchung auf dem Server, dann
  // die grünen Zählerstände. Nacheinander, damit der zweite Beleg derselben Kostenart die eben
  // angelegte Position als Kandidaten sieht und stehen bleibt, statt still doppelt angelegt zu werden.
  const adoptAllGreen = () => exclusively(async () => {
    setError('')
    setPending('')
    const left: string[] = []
    const named = (v: AssessmentView, idx: number) => `„${v.lines.find((l) => l.idx === idx)?.description ?? ''}“`
    for (const v of assessments) {
      const decisions = yearDraftsNow.current.has(v.id) ? [] : greenDecisions(v)
      if (decisions.length === 0) continue
      try {
        const preview = await planDecisions(v.id, decisions)
        if (preview.errors.length > 0 || preview.confirm.length > 0) {
          left.push(...decisions.map((d) => named(v, d.idx)))
          continue
        }
        const result = await bookDecisions(v.id, decisions, preview.token)
        if (result.kind === 'done' || result.kind === 'conflict') upsert(result.assessment)
        if (result.kind !== 'done') left.push(...decisions.map((d) => named(v, d.idx)))
      } catch (e) {
        setError(`Nicht übernommen: ${errorText(e)}`)
        await reloadAll()
        return
      }
    }
    for (const entry of queue) {
      if (!readingReady(entry)) continue
      try {
        if (await postReading(entry)) patchEntry(entry.id, { status: 'übernommen' })
      } catch (e) {
        setError(`Nicht übernommen: ${errorText(e)}`)
        break
      }
    }
    if (left.length > 0) setPending(`Übernommen ist, was grün war. Noch zu prüfen: ${left.join(', ')}. Bitte ansehen, „Vorschau“ und dann „Buchen“.`)
    await reloadAll()
  })

  const hasAdopted = queue.some((x) => x.status === 'übernommen') || assessments.some((v) => v.lines.some((l) => l.state === 'created' || l.state === 'linked'))

  // ---------- Ablage ----------

  // Nur ablegen, ohne Auswertung (und ohne erreichbare KI immer): Die Belege bekommen Objekt und Jahr der Auswahl mit
  // und stehen danach unter „Ohne Position“. Nacheinander hochgeladen.
  const [uploading, setUploading] = useState(0)
  async function storeOnly(files: File[]) {
    const { ok, skipped } = splitFiles(files)
    setError(skipped > 0 ? SKIPPED_FILES : '')
    let done = 0
    for (const f of ok) {
      setUploading(ok.length - done)
      const fd = new FormData()
      fd.append('file', f)
      if (propertyId) fd.append('propertyId', propertyId)
      fd.append('year', String(year))
      try {
        await api('/api/upload', { method: 'POST', body: fd })
        done++
      } catch (e) {
        setError(`„${f.name}“ wurde nicht hochgeladen: ${errorText(e)}`)
      }
    }
    setUploading(0)
    await stock.reload()
    if (done > 0) toast(done === 1 ? 'Ein Beleg ist gespeichert und steht unter „Ohne Position“.' : `${done} Belege sind gespeichert und stehen unter „Ohne Position“.`)
  }
  // Die Ablage: mit KI auswerten, sonst nur speichern
  async function drop(files: Iterable<File>) {
    const list = [...files]
    if (list.length === 0) return
    // Ohne KI erst noch einmal fragen: Läuft sie inzwischen, wird ausgewertet
    if (mode === 'ohne' && aiMode(await checkAi(), external, busy) === 'ohne') { void storeOnly(list); return }
    setError(addFiles(list, target) > 0 ? SKIPPED_FILES : '')
  }

  // ---------- Ohne Position ----------

  const allCards = useMemo(() => receiptCards(stock.uploads, stock.costItems), [stock.uploads, stock.costItems])
  const hints = useMemo(() => duplicateHints(allCards), [allCards])
  const filter: FolderFilter = useMemo(() => ({ propertyId: properties.length > 1 && propertyId ? propertyId : 'all', year }), [properties.length, propertyId, year])
  const inbox = useMemo(() => inboxOf(allCards, filter), [allCards, filter])
  const shownAssessments = useMemo(() => new Set(assessments.filter((v) => v.open).map((v) => v.id)), [assessments])
  const { cards: freeCards, kept } = useMemo(() => withoutPosition(inbox.here, all, shownAssessments), [inbox.here, all, shownAssessments])
  const elsewhere = useMemo(() => elsewhereGroups(allCards, filter), [allCards, filter])
  // Die neuesten 20, darunter „Ältere anzeigen (N)“; ein anderes Objekt oder Jahr beginnt wieder bei 20.
  const inboxScope = `${filter.propertyId}|${filter.year}`
  const [inboxCount, setInboxCount] = useState({ scope: inboxScope, count: INBOX_STEP })
  const inboxShown = inboxPage(freeCards, inboxCount.scope === inboxScope ? inboxCount.count : INBOX_STEP)
  // Nach „Ältere anzeigen“ der Fokus auf die erste neu gezeigte Karte (Durchsicht von PR #449, K3)
  const inboxList = useRef<HTMLUListElement>(null)
  const inboxFocus = useFocusFirstNew(inboxList, ':scope > li', '.receipt-title a')
  const present = useMemo(() => new Set(stock.uploads.map((u) => u.file)), [stock.uploads])
  const yearOptions = useMemo(
    () => [...new Set([...calendarYearOptions, year, ...stock.costItems.map((c) => startYearOf(c.period))])].sort((a, b) => b - a),
    [stock.costItems, year, calendarYearOptions],
  )
  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name || 'Ohne Namen'

  // Die Positionen, denen ein Beleg zugeordnet werden kann: die ohne Beleg im Objekt und Jahr, denen er zugedacht ist,
  // sonst in denen der Auswahl. Zugedacht ist, was die Karte gerade zeigt, auch ein noch nicht gespeicherter Entwurf
  // (#309).
  const candidatesFor = (u: Pick<UploadInfo, 'propertyId' | 'year'>): CostItem[] => {
    const pid = u.propertyId ?? (filter.propertyId === 'all' ? null : filter.propertyId)
    const y = u.year ?? year
    return stock.costItems
      .filter((c) => (pid === null || c.propertyId === pid) && startYearOf(c.period) === y)
      .filter((c) => !c.invoiceFile || !present.has(c.invoiceFile))
      .sort((a, b) => startYearOf(b.period) - startYearOf(a.period) || a.category.localeCompare(b.category, 'de') || a.description.localeCompare(b.description, 'de'))
  }

  async function place(u: UploadInfo, changes: { propertyId?: string | null; year?: number | null }) {
    await api(`/api/uploads/${encodeURIComponent(u.file)}`, { method: 'PUT', body: JSON.stringify(changes) })
    await stock.reload()
  }

  // „Per KI auswerten“ direkt am Beleg (#490, vorher ein Sprung in die Schnellerfassung). Der Browser holt die Datei
  // aus der Ablage, denn ein PDF liest er vor der Auswertung selbst (pdfIntake.ts); an den Server geht danach nur ihr
  // Name, sonst läge der Beleg danach doppelt da.
  async function evaluate(u: UploadInfo) {
    setError('')
    try {
      const res = await fetch(`/uploads/${encodeURIComponent(u.file)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      addStored([{ file: new File([blob], u.originalName || u.file, { type: u.mimeType || blob.type }), stored: u.file }], target)
    } catch (e) {
      setError(`„${receiptName(u)}“ ließ sich nicht aus der Ablage der Belege holen: ${errorText(e)}`)
    }
  }

  // „Weiter prüfen“: zur Auswertung unter „Zu prüfen“, hervorgehoben. Hat sie noch kein Objekt (der Beleg kam ohne
  // Zuordnung), bekommt sie erst das gewählte; das geht, solange nichts gebucht ist. Scheitert es, bleibt alles, wie es
  // war, mit einer Meldung.
  const [jumpTo, setJumpTo] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useHighlight()
  async function continueChecking(u: ReceiptUpload) {
    const current = u.assessment
    if (!current) return
    if (current.propertyId === null && property) {
      try {
        await api(`/api/assessments/${encodeURIComponent(current.id)}`, { method: 'PUT', body: JSON.stringify({ propertyId: property.id }) })
      } catch (e) {
        setError(`Die Auswertung wurde nicht dem Objekt zugeordnet: ${errorText(e)}`)
        return
      }
      await reloadAll()
    } else if (current.propertyId && current.propertyId !== propertyId) {
      // Die Auswertung gehört einem anderen Objekt: dorthin wechseln, wie vorher beim Sprung in die Schnellerfassung
      await switchTo(current.propertyId, undefined)
      return
    }
    setJumpTo(current.id)
  }
  useEffect(() => {
    if (!jumpTo) return
    const card = [...document.querySelectorAll<HTMLElement>('[data-assessment]')].find((el) => el.dataset.assessment === jumpTo)
    if (!card) return
    setJumpTo(null)
    card.scrollIntoView?.({ block: 'start' })
    card.focus()
    setHighlighted(`a:${jumpTo}`)
  })

  // Ein angesprungener Beleg ohne Position (etwa „Im Eingang zeigen“ aus der Suche des Ordners): erst wenn die Liste da
  // ist; steht er hinter „Ältere anzeigen“, wird die Liste bis zu ihm aufgeklappt.
  const focusedFile = useRef<string | null>(null)
  useEffect(() => {
    if (!focusFile || !stock.loadedOnce || focusedFile.current === focusFile) return
    const card = [...document.querySelectorAll<HTMLElement>('[data-view="eingang"] [data-file]')].find((el) => el.dataset.file === focusFile)
    const at = freeCards.findIndex((c) => c.upload.file === focusFile)
    if (!card && at >= inboxShown.shown.length) {
      setInboxCount({ scope: inboxScope, count: at + 1 })
      return
    }
    focusedFile.current = focusFile
    if (card) {
      card.scrollIntoView?.({ block: 'center' })
      ;(card.querySelector<HTMLElement>('a') ?? card).focus()
      setHighlighted(`f:${focusFile}`)
    } else setError('Dieser Beleg steht nicht mehr im Eingang; vielleicht hängt er inzwischen an einer Position (Ordner).')
    onFocusDone?.()
  })

  async function deleteFile(f: UploadInfo) {
    // Der Server legt den Beleg in den Papierkorb, und der Verlauf holt ihn zurück (#490: vorher hieß es hier
    // „unwiderruflich“).
    const ok = await confirm({
      title: 'Beleg löschen?',
      message: `„${receiptName(f)}“ wird aus den Belegen entfernt und in den Papierkorb gelegt. Zurückholen können Sie ihn im Verlauf.`,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/uploads/${encodeURIComponent(f.file)}`, { method: 'DELETE' })
      forgetKept(f.file)
      await reloadAll()
      toast('Beleg gelöscht. Der Verlauf holt ihn aus dem Papierkorb zurück.')
    } catch (e) {
      setError(errorText(e))
    }
  }

  // „Von Hand erfassen“ an einem gespeicherten, nicht ausgewerteten Beleg: vorerst zu Zuordnen, Objekt und Jahr seiner
  // Karte (wie vorher der Sprung in den Belegordner); ins Kostenformular führt es mit #490 PR 3.
  const focusControls = (file: string) => {
    const card = [...document.querySelectorAll<HTMLElement>('[data-view="eingang"] li.receipt-card')].find((el) => el.dataset.file === file)
    if (!card) return
    card.scrollIntoView?.({ block: 'center' })
    card.querySelector<HTMLElement>('.receipt-inbox-controls select, .receipt-inbox-controls button')?.focus()
    setHighlighted(`f:${file}`)
  }

  // `review`: die Karte steht an ihrer Auswertung unter „Zu prüfen“; dort braucht es weder „Weiter prüfen“ noch „Per KI
  // auswerten“ (Durchsicht M2).
  const renderInbox = (card: ReceiptCard, review = false) => {
    const { upload } = card
    const keptEntry = kept.get(upload.file)
    return (
      <ReceiptItem key={upload.file} card={card} renderThumb={renderThumb} jumped={highlighted === `f:${upload.file}`} hint={hints.get(upload.file)}
        place={properties.length > 1 && upload.propertyId === null ? 'ohne Objekt' : undefined}
        onDelete={() => void deleteFile(upload)} entryId={keptEntry?.id}>
        {/* Gespeichert, aber nicht ausgewertet (#487): der Grund und „Erneut versuchen“ an der Karte des Belegs */}
        {keptEntry?.failure && (
          <KeptReceipt failure={keptEntry.failure} onManual={() => focusControls(upload.file)}
            onRetry={() => { focusAfterRetry(keptEntry.id); retry(keptEntry.id) }} onOpenSettings={onOpenAiSettings} />
        )}
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
                      onSave={(id) => attach.attachById(id, upload.file)}>
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
                {review ? null : upload.assessment?.open ? (
                  <button className="btn" aria-label={`${receiptName(upload)} weiter prüfen`} disabled={placement.dirty} onClick={() => void continueChecking(upload)}>Weiter prüfen</button>
                ) : !keptEntry && (
                  <button className="btn" aria-label={`${receiptName(upload)} per KI auswerten`} disabled={placement.dirty} onClick={() => void evaluate(upload)}>Per KI auswerten</button>
                )}
                {placement.dirty && !review && <span className="muted">{PLACEMENT_FIRST}</span>}
              </>
            )}
          </InboxPlacement>
        </div>
      </ReceiptItem>
    )
  }

  // ---------- Gruppen ----------

  const running = queue.filter((x) => x.status === 'wartend' || x.status === 'läuft')
  // Einträge, die als Karte der Warteschlange stehen: Zählerstände, Fehler, Abgebrochenes, ein gespeichertes Zählerfoto
  // und ein gespeicherter Beleg, dessen Karte (noch) nicht unter „Ohne Position“ steht.
  const freeFiles = new Set(freeCards.map((c) => c.upload.file))
  const entryCards = queue.filter((x) => {
    if (x.status === 'wartend' || x.status === 'läuft' || x.status === 'abgelegt') return false
    if (isInvoice(x) && (x.status === 'fertig' || x.status === 'übernommen')) return false
    if (x.status === 'gespeichert' && x.failure && !x.failure.meterPhoto && freeFiles.has(x.failure.file)) return false
    return true
  })
  const takenOff = queue.filter((x) => x.status === 'abgelegt')
  const openCount = running.length + entryCards.filter((x) => x.status !== 'übernommen').length + assessments.filter((v) => v.open).length + freeCards.length
  useEffect(() => { onCount?.(openCount) }, [openCount, onCount])

  // Der Sprung zu Belegen ohne Position eines anderen Objekts oder Jahres: dort der Zeitraum, der im Jahr des Belegs
  // beginnt
  const jumpElsewhere = (g: { propertyId: string | null; year: number | null }) => {
    const there = g.propertyId ? properties.find((p) => p.id === g.propertyId) ?? property : property
    const y = g.year ?? year
    const periodKey = periodKeyOfYear(rulesOf(there ?? null), y)
    void switchTo(g.propertyId ?? undefined, g.year === null ? undefined : periodKey)
  }

  // Eine Karte der Warteschlange: wartend, laufend, ein erkannter Zählerstand, ein Fehler, ein gespeicherter Beleg
  const renderEntry = (entry: QueueEntry) => {
    const meter = entry.result?.kind === 'zaehler'
    const reading = isReading(entry) ? readingOf(entry) : null
    return (
      <div className="card no-print" key={entry.id} data-queue-entry={entry.id} data-file={entry.file} tabIndex={-1}>
        <div className="row center">
          <strong>{meter ? '🔢 ' : '🧾 '}{entry.fileName}</strong>
          {entry.status === 'wartend' && <span className="badge gray">wartet …</span>}
          {entry.status === 'läuft' && (
            <AiProgressBadge
              progress={entry.progress ?? null}
              startedAt={entry.startedAt ?? Date.now()}
              onCancel={() => cancel(entry.id)}
            />
          )}
          {isReading(entry) && <span className="badge green">Zählerstand erkannt</span>}
          {entry.status === 'übernommen' && <span className="badge green">✓ übernommen</span>}
          {entry.status === 'fehler' && <span className="badge red">Fehler</span>}
          {entry.status === 'gespeichert' && <span className="badge amber">gespeichert</span>}
          {entry.status === 'abgebrochen' && <span className="badge gray">abgebrochen</span>}
          <div className="grow" />
          {entry.status !== 'läuft' && (
            entry.status === 'gespeichert'
              ? <button className="btn small ghost" onClick={() => takeOff(entry.id)}>Aus der Liste nehmen{' '}<span className="sr-only">({entry.fileName})</span></button>
              : <>
                {/* Hat das Modell eine Rechnung für ein Zählerfoto gehalten (#490) */}
                {isReading(entry) && <button className="btn small ghost" onClick={() => asInvoice(entry.id)}>Als Rechnung auswerten</button>}
                <button className="btn small ghost" onClick={() => remove(entry.id)}>Entfernen</button>
              </>
          )}
        </div>

        {entry.status === 'fehler' && <NoticeBox level="error" action={entry.error} />}
        {entry.status === 'gespeichert' && entry.failure && (
          <KeptReceipt failure={entry.failure} onManual={entry.failure.meterPhoto ? (onOpenMeters && (() => onOpenMeters())) : focusControls}
            onRetry={() => { focusAfterRetry(entry.id); retry(entry.id) }} onOpenSettings={onOpenAiSettings} />
        )}

        {reading && (
          <ReadingReview reading={reading} serverFile={entry.result?.file} score={readingScores.get(entry.id)} meters={meters} units={units}
            adopting={adopting} onChange={(patch) => updateReading(entry, patch)} onAdopt={() => void adoptReading(entry)} />
        )}
      </div>
    )
  }

  // Eine Auswertung mit dem Beleg daneben (#490), damit man vergleichen kann. Auf Wunsch: Daneben stehend ließe der Beleg
  // der Tabelle bei 1440 px zu wenig Platz, sie müsste seitlich rollen (M10 aus #341). Am schmalen Bildschirm steht er
  // darunter.
  const [beside, setBeside] = useState<ReadonlySet<string>>(new Set())
  const toggleBeside = (id: string) => setBeside((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const renderAssessment = (v: AssessmentView) => {
    const shown = beside.has(v.id) && v.open
    // Der Beleg selbst, solange er an keiner Position hängt: löschen, Objekt und Jahr, zuordnen (Durchsicht M2)
    const own = v.open ? allCards.find((c) => c.upload.file === v.file && c.items.length === 0 && c.upload.kind !== 'meterPhoto') : undefined
    return (
      <div className={`card no-print${highlighted === `a:${v.id}` ? ' bg-accent-soft border-accent' : ''}`} key={v.id} data-assessment={v.id} tabIndex={-1}>
        <div className="row center">
          <strong>🧾 {v.vendor || v.originalName}</strong>
          {v.open
            ? <span className={openBadgeClass(v)}>{v.lines.filter((l) => l.state === 'open').length} offen — bitte prüfen</span>
            : <span className="badge green">✓ übernommen</span>}
          {/* Das Jahr, in das gebucht wird (nach einer Änderung von Hand nicht mehr das des Belegs) */}
          {(v.targetPeriod ?? calendarPeriod(v.year)) !== key && <span className="badge gray">{calendar ? `Jahr ${v.year}` : v.targetLabel ?? `Jahr ${v.year}`}</span>}
          <div className="grow" />
          {v.open && (
            <DisclosureButton open={shown} onToggle={() => toggleBeside(v.id)} closedLabel="Beleg daneben zeigen" openLabel="Beleg ausblenden"
              controls={`beleg-${v.id}`} className="btn small ghost" />
          )}
        </div>
        {own && <ul className="receipt-list">{renderInbox(own, true)}</ul>}
        <div className={shown ? 'flex flex-col xl:flex-row-reverse xl:items-start gap-4' : undefined}>
          {shown && (
            <iframe id={`beleg-${v.id}`} className="w-full xl:w-96 h-112 shrink-0 border border-line bg-card"
              src={`/uploads/${encodeURIComponent(v.file)}`} title={`Beleg ${v.originalName}`} />
          )}
          <div className="min-w-0 flex-1">
            <AssessmentReview assessment={v} units={units} keyContext={keyCtx(v)}
              onChange={(next) => { upsert(next); keepInQueue(next); void reloadAll() }}
              onOpenItem={(id) => onNavigate('kosten', { kind: 'costItem', id })} onYearDraft={onYearDraft} />
          </div>
        </div>
      </div>
    )
  }

  const empty = running.length === 0 && entryCards.length === 0 && assessments.length === 0 && freeCards.length === 0 && takenOff.length === 0

  return (
    <>
      {error && <NoticeBox level="error" action={error} />}
      {pending && <div className="warn">{pending}</div>}
      <AmountCheckBox attach={attach} properties={properties} onOpenItem={onOpenItem} />

      <div className="card no-print">
        {totalRecognized > 0 && (
          <div className="row center">
            <div className="grow" />
            <div className="muted align-right">
              {totalRecognized} erkannt · <span className="ampel gruen" /> {tally.gruen} · <span className="ampel gelb" /> {tally.gelb} · <span className="ampel rot" /> {tally.rot}
            </div>
          </div>
        )}

        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); void drop(e.dataTransfer.files) }}
        >
          <strong>Rechnungen und Zählerfotos hierher ziehen</strong> oder klicken, auch den ganzen Stapel gemischt.
          <div className="muted">
            {mode === 'ohne'
              ? 'Mietfuchs speichert jeden Beleg; danach ordnen Sie ihn einer Position zu.'
              : 'Mietfuchs speichert jeden Beleg und wertet ihn danach aus, einen nach dem anderen (je Beleg 1–2 Min.). Sie können die Seite dabei verlassen.'}
            {' '}{ai.notice ?? 'Alles bleibt lokal.'}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            aria-label="Belege und Zählerfotos auswählen"
            className="sr-only"
            onChange={(e) => { if (e.target.files) void drop([...e.target.files]); e.target.value = '' }}
          />
        </div>
        <div className="row center">
          {mode !== 'ohne' ? (
            <label className="btn secondary">
              {uploading > 0 ? `Wird gespeichert … (${uploading})` : 'Nur ablegen, ohne Auswertung'}
              <input type="file" multiple className="sr-only" accept="application/pdf,image/*" aria-label="Belege nur ablegen, ohne Auswertung" disabled={uploading > 0}
                onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) void storeOnly(files) }} />
            </label>
          ) : (
            <>
              <span className="muted">Die KI ist gerade nicht erreichbar. Belege werden nur gespeichert; „Per KI auswerten“ steht an jedem Beleg.</span>
              <button type="button" className="btn small ghost" onClick={() => void checkAi()}>Erneut prüfen</button>
              {uploading > 0 && <span className="muted">Wird gespeichert … ({uploading})</span>}
              {onOpenAiSettings && <button type="button" className="btn small ghost" onClick={onOpenAiSettings}>KI-Einstellungen öffnen</button>}
            </>
          )}
        </div>

        {/* Die Leiste steht auch, wenn nur zurückgehaltene Belege da sind, damit der Satz erklärt, warum
            nichts angeboten wird (Nachprüfung A1). */}
        {(greenReady > 0 || heldBack > 0) && (
          <div className="sticky-bar">
            {greenReady > 0 && <><strong>{greenReady}</strong> {plural(greenReady, 'grüner Vorschlag', 'grüne Vorschläge')} bereit.</>}
            {heldBack > 0 && <span className="muted"> {heldBack === 1 ? '1 Beleg mit ungespeichertem Jahr bleibt außen vor.' : `${heldBack} Belege mit ungespeichertem Jahr bleiben außen vor.`}</span>}
            <div className="grow" />
            {greenReady > 0 && <button className="btn" disabled={adopting} onClick={() => void adoptAllGreen()}>✓ Alle grünen übernehmen</button>}
          </div>
        )}
      </div>

      {/* Eine offene Auswertung steht hier ohnehin als Karte (alle Jahre des Objekts) */}
      <OtherQueueEntries queue={all} propertyId={propertyId} period={key}
        shown={(x) => x.status === 'fertig' && isInvoice(x) && assessments.some((v) => v.id === assessmentOf(x)?.id)} />
      {elsewhere.length > 0 && (
        <div className="row center no-print" role="group" aria-label="Belege ohne Position in anderen Objekten und Jahren">
          <span className="muted">Ohne Position an anderer Stelle:</span>
          {elsewhere.map((g) => (
            <button key={`${g.propertyId ?? ''}:${g.year ?? ''}`} type="button" className="btn small ghost" onClick={() => jumpElsewhere(g)}>
              {g.count} {plural(g.count, 'Beleg', 'Belege')} bei {[g.propertyId ? `„${propertyName(g.propertyId)}“` : null, g.year].filter(Boolean).join(', ')} →
            </button>
          ))}
        </div>
      )}

      {running.length > 0 && <Group id="laeuft" title="Wird ausgewertet">{running.map(renderEntry)}</Group>}

      {(entryCards.length > 0 || assessments.length > 0) && (
        <Group id="pruefen" title="Zu prüfen">
          {entryCards.map(renderEntry)}
          {assessments.map(renderAssessment)}
        </Group>
      )}

      {(freeCards.length > 0 || takenOff.length > 0) && (
        <Group id="ohne" title={`Ohne Position (${freeCards.length})`}>
          {takenOff.map((x) => {
            const file = x.failure?.file ?? x.file
            return <TakenOff key={x.id} fileName={x.fileName} onShow={file && freeFiles.has(file) ? () => {
              const card = [...document.querySelectorAll<HTMLElement>('[data-view="eingang"] li.receipt-card')].find((el) => el.dataset.file === file)
              card?.scrollIntoView?.({ block: 'center' })
              card?.querySelector<HTMLElement>('a')?.focus()
              setHighlighted(`f:${file}`)
            } : undefined} />
          })}
          {freeCards.length > 0 && (
            <p className="muted">Gespeicherte Belege, die an keiner Kostenposition hängen. Ordnen Sie jeden einer Position zu oder lassen Sie ihn per KI auswerten.</p>
          )}
          {inboxShown.shown.length > 0 && <ul ref={inboxList} className="receipt-list">{inboxShown.shown.map((c) => renderInbox(c))}</ul>}
          {inboxShown.hidden > 0 && (
            <div className="row">
              <button type="button" className="btn secondary"
                onClick={() => { inboxFocus.expect(inboxShown.shown.length); setInboxCount({ scope: inboxScope, count: inboxShown.shown.length + INBOX_STEP }) }}>
                Ältere anzeigen ({inboxShown.hidden})
              </button>
            </div>
          )}
        </Group>
      )}

      {empty && stock.loadedOnce && (
        <div className="card"><div className="empty">Alles erledigt. Neue Belege legen Sie oben ab; erfasste finden Sie im Ordner.</div></div>
      )}

      {hasAdopted && (
        <div className="card no-print">
          <div className="row center">
            <span>✓ Übernommen. Weiter geht's auf der Abrechnung oder bei den Kosten.</span>
            <div className="grow" />
            <button className="btn secondary" onClick={() => onNavigate('kosten')}>→ Kosten ansehen</button>
            <button className="btn" onClick={() => onNavigate('abrechnung')}>→ Zur Abrechnung</button>
          </div>
        </div>
      )}
    </>
  )
}
