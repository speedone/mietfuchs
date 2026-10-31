import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AssessmentView, CostItem, NoticeSubject, Reading, Settings, Unit, UploadInfo, Meter } from '../types'
import { calendarPeriod, periodContext, periodOfKey } from '../../../shared/period.ts'
import { api, errorText } from '../api'
import { aiSummary } from '../aiForm'
import { type KeyContext } from '../costForm'
import { bookDecisions, greenDecisions, loadOpenAssessments, planDecisions } from '../assessment'
import { assessmentOf, belongsTo, useEvaluationQueue, type QueueEntry, type QueueTarget } from '../evaluationQueue'
import { initialCandidate, readingBody, scoreCandidate, type ReadingCandidate } from '../readingCandidate'
import AssessmentReview from '../components/AssessmentReview'
import { usePeriod } from '../period'
import { useOpenForm, useProperty, withProperty } from '../property'
import { AiProgressBadge } from '../components/AiProgress'
import { plural } from '../../../shared/wording.ts'
import PageHeader from '../components/PageHeader'
import { NoticeBox } from '../components/Notice'
import { KeptReceipt } from '../components/KeptReceipt'
import { TakenOff } from '../components/TakenOff'
import { ReadingReview } from '../components/ReadingReview'
import { OtherQueueEntries } from '../components/OtherQueueEntries'
import { useRetryFocus } from '../retryFocus'

// Sichtprüfung E30: Die Kennzeichnung offener Zeilen trägt die Farbe der schlechtesten Ampel,
// nicht Grün für „bitte prüfen“.
function openBadgeClass(v: AssessmentView): string {
  const levels = v.lines.filter((l) => l.state === 'open').map((l) => l.suggestion?.level)
  return levels.includes('rot') ? 'badge red' : levels.includes('gelb') ? 'badge amber' : 'badge green'
}

type Props = {
  units: Unit[]
  settings: Settings | null
  // Mit Ziel: die Position auf der Seite öffnen, etwa zum Pflegen im Formular
  onNavigate: (tab: string, focus?: NoticeSubject) => void
  // Belege aus dem Posteingang des Belegordners (#170), die ausgewertet werden sollen. Sie liegen
  // schon im Ordner und gehen nur mit ihrem Namen an den Server.
  handoff?: UploadInfo[]
  onHandoffTaken?: () => void
  // Fehler mit Ausweg (#487): einen gespeicherten, nicht ausgewerteten Beleg im Belegordner zeigen, die
  // KI-Einstellungen öffnen
  onOpenReceipt?: (file: string) => void
  onOpenAiSettings?: () => void
  // Bei einem Zählerfoto, dessen Ablesen gescheitert ist: die Seite Zähler (Ablesung von Hand)
  onOpenMeters?: () => void
}

export default function Schnellerfassung({ units, settings, onNavigate, handoff, onHandoffTaken, onOpenReceipt, onOpenAiSettings, onOpenMeters }: Props) {
  // Wohin die Belege zur Auswertung gehen (siehe aiForm.ts)
  const ai = aiSummary(settings)
  // Das Kalenderjahr, in dem der gewählte Zeitraum beginnt (#208): Ein Beleg ohne erkanntes Jahr
  // bekommt es, und die Belegbuchung leitet daraus den Zeitraum ab.
  const { year, key, rules, calendar } = usePeriod()
  const { property } = useProperty()
  const propertyId = property?.id
  const [existingItems, setExistingItems] = useState<CostItem[]>([])
  const [meters, setMeters] = useState<Meter[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  // Ob Zähler und Ablesungen einmal geantwortet haben: Erst dann entsteht der Vorschlag zu einem Zählerfoto.
  const [loaded, setLoaded] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  // Was nach „Alle grünen übernehmen“ noch zu prüfen bleibt (#139)
  const [pending, setPending] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Gespeicherte Auswertungen dieses Objekts (#170): die offenen vom Server, dazu die in dieser
  // Sitzung gebuchten, damit „✓ übernommen“ stehen bleibt.
  const [assessments, setAssessments] = useState<AssessmentView[]>([])
  const upsert = (v: AssessmentView) =>
    setAssessments((list) => (list.some((x) => x.id === v.id) ? list.map((x) => (x.id === v.id ? v : x)) : [...list, v]))

  const loadData = () => Promise.all([
    api<CostItem[]>(withProperty('/api/costItems', propertyId)).then(setExistingItems),
    Promise.all([api<Meter[]>(withProperty('/api/meters', propertyId)), api<Reading[]>(withProperty('/api/readings', propertyId))])
      .then(([m, r]) => { setMeters(m); setReadings(r) })
      .finally(() => setLoaded(true)),
    loadOpenAssessments(propertyId).then((open) =>
      setAssessments((list) => [...list.filter((x) => !x.open && !open.some((o) => o.id === x.id)), ...open])),
  ])
  useEffect(() => {
    loadData().catch(() => setError('Server nicht erreichbar — läuft `npm run dev`?'))
    // Neu laden, wenn das Objekt wechselt (#92).
  }, [propertyId])

  // Die eine Warteschlange der App (#490): Sie läuft weiter, wenn man die Seite, das Objekt oder den Zeitraum wechselt.
  // Die Seite zeigt die Einträge ihres Objekts und Zeitraums, die übrigen nennt eine Zeile (OtherQueueEntries).
  const { queue: all, patchEntry, addFiles, addStored, remove, cancel, retry, takeOff } = useEvaluationQueue()
  // Objekt und Jahr für die Auswertung (#170); ein neuer Beleg steht damit im Posteingang dieses Objekts, falls er
  // ungebucht bleibt.
  const target: QueueTarget = { propertyId, year, period: key, pageImageEdge: settings?.ai?.pageImageEdge ?? undefined }
  const queue = useMemo(() => all.filter((x) => belongsTo(x, propertyId, key)), [all, propertyId, key])
  const isReading = (x: QueueEntry) => x.status === 'fertig' && x.result?.kind === 'zaehler'
  const isInvoice = (x: QueueEntry) => x.result?.kind === 'rechnung'
  // Der Zählerstand eines Eintrags: nach der ersten Eingabe der eigene, sonst der Vorschlag aus der Antwort mit den
  // Zählern dieses Objekts (erst wenn sie geladen sind, sonst fehlte die Zuordnung).
  const readingOf = (x: QueueEntry): ReadingCandidate | null =>
    x.data.reading ?? (x.result?.kind === 'zaehler' && loaded ? initialCandidate(x.result.reading, x.exifDate ?? null, meters, readings) : null)
  const focusAfterRetry = useRetryFocus(queue)
  // Der Vorschlag gilt ab dem Augenblick, in dem er entsteht (wie vor #490 mit der Antwort): Er bleibt am Eintrag, auch
  // wenn neue Ablesungen die Ampel ändern, und die andere Seite zeigt denselben.
  useEffect(() => {
    for (const x of queue) {
      if (x.data.reading || x.result?.kind !== 'zaehler') continue
      const r = readingOf(x)
      if (r) patchEntry(x.id, { data: { reading: r } })
    }
  })
  // Was beim Wechsel verloren ginge (#145, #490): ein erkannter, noch nicht übernommener Zählerstand. Eine laufende
  // Auswertung läuft in der Warteschlange der App weiter, eine ausgewertete Rechnung ist gespeichert.
  useOpenForm(queue.some(isReading))

  // Ausgewertete Rechnungen kommen zu den Auswertungen der Seite, auch wenn die Antwort kam, während die Seite
  // nicht offen war. Je Eintrag einmal; danach gilt, was die Seite daraus macht (Buchen).
  const absorbed = useRef(new Set<number>())
  useEffect(() => {
    for (const x of queue) {
      const v = assessmentOf(x)
      if (!isInvoice(x) || !v || absorbed.current.has(x.id)) continue
      absorbed.current.add(x.id)
      upsert(v)
    }
  }, [queue])

  // Nach einer Buchung steht die neue Fassung auch am Eintrag, damit die Seite Kosten dasselbe zeigt.
  const keepInQueue = (next: AssessmentView) => {
    for (const x of queue) if (assessmentOf(x)?.id === next.id) patchEntry(x.id, { status: next.open ? 'fertig' : 'übernommen', data: { assessment: next } })
  }

  // Übernahme aus dem Posteingang (#170). Der Browser holt die Datei aus dem Ordner, denn ein PDF
  // liest er vor der Auswertung selbst (pdfIntake.ts); an den Server geht danach nur ihr Name.
  // Je Übergabe genau einmal, auch wenn React den Effekt zweimal ausführt (StrictMode)
  const takenRef = useRef<UploadInfo[] | null>(null)
  useEffect(() => {
    if (!handoff || handoff.length === 0 || takenRef.current === handoff) return
    takenRef.current = handoff
    onHandoffTaken?.()
    void (async () => {
      const list: { file: File; stored: string }[] = []
      for (const u of handoff) {
        try {
          const res = await fetch(`/uploads/${encodeURIComponent(u.file)}`)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const blob = await res.blob()
          list.push({ file: new File([blob], u.originalName || u.file, { type: u.mimeType || blob.type }), stored: u.file })
        } catch (e) {
          setError(`„${u.originalName || u.file}“ ließ sich nicht aus dem Belegordner holen: ${errorText(e)}`)
        }
      }
      addStored(list, target)
    })()
  }, [handoff])

  // Woraus eine Position ihren Schlüssel vorgeschlagen bekommt (#141), je Jahr des Belegs.
  // Der Vorschlag des Schlüssels sieht in den Zeitraum, in den gebucht wird (#208, `bookingPeriod`).
  const keyCtx = (v: AssessmentView): KeyContext => {
    const target = periodOfKey(rules, v.targetPeriod ?? calendarPeriod(v.year))
    return target ? { items: existingItems, year: v.year, at: periodContext(rules, target), propertyKind: property?.kind ?? null } : { items: existingItems, year: v.year, propertyKind: property?.kind ?? null }
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
  }, [queue, readings, meters, loaded])

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
        await loadData()
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
    await loadData()
  })

  const hasAdopted = queue.some((x) => x.status === 'übernommen') || assessments.some((v) => v.lines.some((l) => l.state === 'created' || l.state === 'linked'))

  return (
    <>
      <PageHeader
        title="Schnellerfassung"
        subtitle={<>
          Werfen Sie alles rein — Rechnungen <em>und</em> Zählerfotos. Mietfuchs erkennt automatisch, was es ist,
          prüft es und sortiert nach Ampel. Grün übernehmen Sie mit einem Klick.{' '}
          {ai.notice ?? 'Alles bleibt lokal.'}
        </>}
      />
      {error && <NoticeBox level="error" action={error} />}
      {pending && <div className="warn">{pending}</div>}

      <div className="card no-print">
        {totalRecognized > 0 && (
          <div className="row center">
            <div className="grow" />
            <div className="muted align-right">
              {totalRecognized} erkannt — <span className="ampel gruen" /> {tally.gruen} · <span className="ampel gelb" /> {tally.gelb} · <span className="ampel rot" /> {tally.rot}
            </div>
          </div>
        )}

        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files, target) }}
        >
          <strong>Den ganzen Stapel hierher ziehen</strong> oder klicken — Rechnungen und Zählerfotos gemischt.
          <div className="muted">Sie werden nacheinander ausgewertet (kann je Beleg 1–2 Min. dauern).</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            aria-label="Belege und Zählerfotos auswählen"
            className="sr-only"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files, target); e.target.value = '' }}
          />
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

      <OtherQueueEntries queue={all} propertyId={propertyId} period={key} />

      {queue.map((entry) => {
        // Eine ausgewertete Rechnung steht als Karte ihrer Auswertung da (unten).
        if (isInvoice(entry) && (entry.status === 'fertig' || entry.status === 'übernommen')) return null
        if (entry.status === 'abgelegt') {
          const stored = entry.failure?.file
          return <TakenOff key={entry.id} fileName={entry.fileName} onShow={stored && onOpenReceipt ? () => onOpenReceipt(stored) : undefined} />
        }
        const meter = entry.result?.kind === 'zaehler'
        const reading = isReading(entry) ? readingOf(entry) : null
        return (
          <div className="card no-print" key={entry.id} data-queue-entry={entry.id} tabIndex={-1}>
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
              {entry.status === 'gespeichert' && <span className="badge amber">im Belegordner</span>}
              {entry.status === 'abgebrochen' && <span className="badge gray">abgebrochen</span>}
              <div className="grow" />
              {entry.status !== 'läuft' && (
                entry.status === 'gespeichert'
                  ? <button className="btn small ghost" onClick={() => takeOff(entry.id)}>Aus der Liste nehmen{' '}<span className="sr-only">({entry.fileName})</span></button>
                  : <button className="btn small ghost" onClick={() => remove(entry.id)}>Entfernen</button>
              )}
            </div>

            {entry.status === 'fehler' && <NoticeBox level="error" action={entry.error} />}
            {entry.status === 'gespeichert' && entry.failure && (
              <KeptReceipt failure={entry.failure} onManual={entry.failure.meterPhoto ? (onOpenMeters && (() => onOpenMeters())) : onOpenReceipt}
                onRetry={() => { focusAfterRetry(entry.id); retry(entry.id) }} onOpenSettings={onOpenAiSettings} />
            )}

            {reading && (
              <ReadingReview reading={reading} serverFile={entry.result?.file} score={readingScores.get(entry.id)} meters={meters} units={units}
                adopting={adopting} onChange={(patch) => updateReading(entry, patch)} onAdopt={() => void adoptReading(entry)} />
            )}
          </div>
        )
      })}

      {assessments.map((v) => (
        <div className="card no-print" key={v.id}>
          <div className="row center">
            <strong>🧾 {v.vendor || v.originalName}</strong>
            {v.open
              ? <span className={openBadgeClass(v)}>{v.lines.filter((l) => l.state === 'open').length} offen — bitte prüfen</span>
              : <span className="badge green">✓ übernommen</span>}
            {/* Das Jahr, in das gebucht wird (nach einer Änderung von Hand nicht mehr das des Belegs) */}
            {(v.targetPeriod ?? calendarPeriod(v.year)) !== key && <span className="badge gray">{calendar ? `Jahr ${v.year}` : v.targetLabel ?? `Jahr ${v.year}`}</span>}
          </div>
          <AssessmentReview assessment={v} units={units} keyContext={keyCtx(v)}
            onChange={(next) => { upsert(next); keepInQueue(next); void loadData() }}
            onOpenItem={(id) => onNavigate('kosten', { kind: 'costItem', id })} onYearDraft={onYearDraft} />
        </div>
      ))}

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
