import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssessmentView, CostItem, IntakeResult, Meter, NoticeSubject, Reading, Settings, Unit, UploadInfo } from '../types'
import { api, errorText } from '../api'
import { aiSummary } from '../aiForm'
import { autoMatchMeter, scoreReading } from '../triage'
import { parseQuantity, type KeyContext } from '../costForm'
import { bookDecisions, greenDecisions, loadOpenAssessments, planDecisions } from '../assessment'
import { useEvaluationQueue, type QueueEntry as BaseEntry, type QueuePatch } from '../evaluationQueue'
import AssessmentReview from '../components/AssessmentReview'
import { useYear } from '../year'
import { useOpenForm, useProperty, withProperty, useSwitchYear } from '../property'
import { AiProgressBadge } from '../components/AiProgress'

type Props = {
  units: Unit[]
  settings: Settings | null
  // Mit Ziel: die Position auf der Seite öffnen, etwa zum Pflegen im Formular
  onNavigate: (tab: string, focus?: NoticeSubject) => void
  // Belege aus dem Posteingang des Belegordners (#170), die ausgewertet werden sollen. Sie liegen
  // schon im Ordner und gehen nur mit ihrem Namen an den Server.
  handoff?: UploadInfo[]
  onHandoffTaken?: () => void
}

type ReadingCandidate = {
  meterNumber: string
  value: string
  date: string // YYYY-MM-DD
  hasDate: boolean
  matchedMeterId: string
  replacement: boolean
  oldEndValue: string
  checked: boolean
}

// Was ein Eintrag der Warteschlange (evaluationQueue.ts) nach der Auswertung trägt: bei einer
// Rechnung die Kennung der gespeicherten Auswertung (sie steht dann als Karte „Auswertung prüfen“
// da), bei einem Zählerfoto den erkannten Stand.
type Evaluated = {
  kind: 'rechnung' | 'zaehler'
  serverFile: string
  exifDate: string | null
  reading: ReadingCandidate
  assessmentId: string
}
type QueueEntry = BaseEntry<Evaluated>

const todayISO = () => new Date().toISOString().slice(0, 10)

// Zählerstände lesen wie jede Menge (#149): „1.234“ ist 1234 und nicht 1,234. Ein leeres Feld ist
// kein Wert.
const parseNum = (s: string): number | null => parseQuantity(s)
// Und so ins Feld schreiben, dass dasselbe wieder herauskommt: Als „1.234“ stünde 1,234 m³ da und
// würde als 1234 gelesen.
const quantityInput = (n: number): string => n.toLocaleString('de-DE', { useGrouping: false, maximumFractionDigits: 6 })

const NOT_SAVED = 'Die Auswertung ließ sich nicht speichern. Bitte versuchen Sie es noch einmal; gebucht wurde nichts.'

export default function Schnellerfassung({ units, settings, onNavigate, handoff, onHandoffTaken }: Props) {
  // Wohin die Belege zur Auswertung gehen (siehe aiForm.ts)
  const ai = aiSummary(settings)
  const { year } = useYear()
  // Fragt bei offenem Formular nach, wie der Objektwechsel (Durchsicht zu #141).
  const switchYear = useSwitchYear()
  const { property } = useProperty()
  const propertyId = property?.id
  const [existingItems, setExistingItems] = useState<CostItem[]>([])
  const [meters, setMeters] = useState<Meter[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
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
    api<Meter[]>(withProperty('/api/meters', propertyId)).then(setMeters),
    api<Reading[]>(withProperty('/api/readings', propertyId)).then(setReadings),
    loadOpenAssessments(propertyId).then((open) =>
      setAssessments((list) => [...list.filter((x) => !x.open && !open.some((o) => o.id === x.id)), ...open])),
  ])
  useEffect(() => {
    loadData().catch(() => setError('Server nicht erreichbar — läuft `npm run dev`?'))
    // Neu laden, wenn das Objekt wechselt (#92).
  }, [propertyId])

  const { queue, patchEntry, addFiles, addStored, remove, cancel } = useEvaluationQueue<IntakeResult, Evaluated>({
    endpoint: '/api/intake',
    pageImageEdge: settings?.ai?.pageImageEdge ?? undefined,
    // Objekt und Jahr für die Auswertung (#170); ein neuer Beleg steht damit im Posteingang
    // dieses Objekts, falls er ungebucht bleibt.
    propertyId,
    year,
    finish: async (res, file): Promise<QueuePatch<Evaluated>> => {
      if (res.kind === 'zaehler') {
        const exifDate = await readExifDate(file)
        const r = res.reading
        const matchedMeterId = autoMatchMeter(r.meterNumber ?? null, meters) ?? ''
        const value = r.value ?? null
        const sc = scoreReading({
          meterNumber: r.meterNumber ?? null,
          value,
          hasDate: !!(r.dateOnImage || exifDate),
          matchedMeterId: matchedMeterId || null,
          readings,
        })
        const reading: ReadingCandidate = {
          meterNumber: r.meterNumber ?? '',
          value: value != null ? quantityInput(value) : '',
          date: r.dateOnImage || exifDate || todayISO(),
          hasDate: !!(r.dateOnImage || exifDate),
          matchedMeterId,
          replacement: sc.replacementGuess,
          oldEndValue: sc.suggestedOldEndValue != null ? quantityInput(sc.suggestedOldEndValue) : '',
          checked: sc.level !== 'rot',
        }
        return { status: 'fertig', data: { kind: 'zaehler', serverFile: res.file, exifDate, reading } }
      }
      if (!res.assessment) return { status: 'fehler', error: NOT_SAVED }
      upsert(res.assessment)
      return { status: 'fertig', data: { kind: 'rechnung', serverFile: res.file, assessmentId: res.assessment.id } }
    },
  })
  // Was beim Objektwechsel verloren ginge (#145): laufende Auswertungen und ein erkannter, noch
  // nicht übernommener Zählerstand. Eine ausgewertete Rechnung ist gespeichert und bleibt.
  useOpenForm(queue.some((x) => x.status === 'wartend' || x.status === 'läuft' || (x.status === 'fertig' && x.data.kind === 'zaehler')))

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
      addStored(list)
    })()
  }, [handoff])

  // Woraus eine Position ihren Schlüssel vorgeschlagen bekommt (#141), je Jahr des Belegs.
  const keyCtx = (target: number): KeyContext => ({ items: existingItems, year: target, propertyKind: property?.kind ?? null })

  function updateReading(entryId: number, patch: Partial<ReadingCandidate>) {
    const entry = queue.find((x) => x.id === entryId)
    const reading = entry?.data.reading
    if (reading) patchEntry(entryId, { data: { reading: { ...reading, ...patch } } })
  }

  // ---------- Live-Bewertung der Zählerstände (re-scort bei jeder Eingabe) ----------
  const readingScores = useMemo(() => {
    const map = new Map<number, ReturnType<typeof scoreReading>>()
    for (const entry of queue) {
      if (entry.status !== 'fertig' || entry.data.kind !== 'zaehler' || !entry.data.reading) continue
      const r = entry.data.reading
      map.set(entry.id, scoreReading({ meterNumber: r.meterNumber || null, value: parseNum(r.value), hasDate: r.hasDate, matchedMeterId: r.matchedMeterId || null, readings }))
    }
    return map
  }, [queue, readings])

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
    entry.status === 'fertig' && entry.data.kind === 'zaehler' && !!entry.data.reading?.checked && readingScores.get(entry.id)?.level === 'gruen'
  const greenReady = assessments.reduce((n, v) => n + greenDecisions(v).length, 0) + queue.filter(readingReady).length

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
    const r = entry.data.reading
    if (!r) return false
    const value = parseNum(r.value)
    if (!r.matchedMeterId || value == null) return false
    const oldEnd = r.replacement ? parseNum(r.oldEndValue) : null
    if (r.replacement && oldEnd == null) return false
    await api('/api/readings', {
      method: 'POST',
      body: JSON.stringify({
        meterId: r.matchedMeterId,
        date: r.date,
        value,
        replacement: r.replacement || undefined,
        oldEndValue: r.replacement ? oldEnd : undefined,
      }),
    })
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
      const decisions = greenDecisions(v)
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

  const unitName = (id: string | null) => (id ? units.find((u) => u.id === id)?.name ?? '?' : 'Haus (Hauptzähler)')
  const hasAdopted = queue.some((x) => x.status === 'übernommen') || assessments.some((v) => v.lines.some((l) => l.state === 'created' || l.state === 'linked'))

  return (
    <>
      <h1>📥 Schnellerfassung</h1>
      <p className="sub">
        Werfen Sie alles rein — Rechnungen <em>und</em> Zählerfotos. Das Tool erkennt automatisch, was es ist,
        prüft es und sortiert nach Ampel. Grün übernehmen Sie mit einem Klick.{' '}
        {ai.notice ?? `Alles bleibt lokal (${ai.model}).`}
      </p>
      {error && <div className="error">{error}</div>}
      {pending && <div className="warn">{pending}</div>}

      <div className="card no-print">
        <div className="row" style={{ alignItems: 'center' }}>
          <label className="field">
            Abrechnungsjahr
            <select value={year} onChange={(e) => void switchYear(Number(e.target.value))}>
              {Array.from({ length: 8 }, (_, k) => new Date().getFullYear() - k).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <div className="grow" />
          {totalRecognized > 0 && (
            <div className="muted" style={{ textAlign: 'right' }}>
              {totalRecognized} erkannt — <span className="ampel gruen" /> {tally.gruen} · <span className="ampel gelb" /> {tally.gelb} · <span className="ampel rot" /> {tally.rot}
            </div>
          )}
        </div>

        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          style={{ marginTop: 12 }}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
        >
          <strong>Den ganzen Stapel hierher ziehen</strong> oder klicken — Rechnungen und Zählerfotos gemischt.
          <div className="muted">Sie werden nacheinander ausgewertet (kann je Beleg 1–2 Min. dauern).</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
          />
        </div>

        {greenReady > 0 && (
          <div className="sticky-bar">
            <strong>{greenReady}</strong> grüne Vorschläge bereit.
            <div className="grow" />
            <button className="btn" disabled={adopting} onClick={() => void adoptAllGreen()}>✓ Alle grünen übernehmen</button>
          </div>
        )}
      </div>

      {queue.map((entry) => {
        // Eine ausgewertete Rechnung steht als Karte ihrer Auswertung da (unten).
        if (entry.data.kind === 'rechnung' && entry.status === 'fertig') return null
        const rs = readingScores.get(entry.id)
        return (
          <div className="card no-print" key={entry.id}>
            <div className="row" style={{ alignItems: 'center' }}>
              <strong>{entry.data.kind === 'zaehler' ? '🔢 ' : '🧾 '}{entry.fileName}</strong>
              {entry.status === 'wartend' && <span className="badge gray">wartet …</span>}
              {entry.status === 'läuft' && (
                <AiProgressBadge
                  progress={entry.progress ?? null}
                  startedAt={entry.startedAt ?? Date.now()}
                  onCancel={() => cancel(entry.id)}
                />
              )}
              {entry.status === 'fertig' && entry.data.kind === 'zaehler' && <span className="badge green">Zählerstand erkannt</span>}
              {entry.status === 'übernommen' && <span className="badge green">✓ übernommen</span>}
              {entry.status === 'fehler' && <span className="badge red">Fehler</span>}
              {entry.status === 'abgebrochen' && <span className="badge gray">abgebrochen</span>}
              <div className="grow" />
              {entry.status !== 'läuft' && (
                <button className="btn small ghost" onClick={() => remove(entry.id)}>Entfernen</button>
              )}
            </div>

            {entry.status === 'fehler' && <div className="error" style={{ marginTop: 8 }}>{entry.error}</div>}

            {/* ---------- Zählerstand ---------- */}
            {entry.status === 'fertig' && entry.data.kind === 'zaehler' && entry.data.reading && (
              <div className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
                {entry.data.serverFile && (
                  <a href={`/uploads/${entry.data.serverFile}`} target="_blank" rel="noreferrer">
                    <img src={`/uploads/${entry.data.serverFile}`} alt="Zählerfoto" style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />
                  </a>
                )}
                <div className="grow">
                  <div className="row" style={{ alignItems: 'center' }}>
                    <span className={`ampel ${rs?.level ?? 'gruen'}`} />
                    <label className="field">
                      Zähler
                      <select value={entry.data.reading.matchedMeterId} onChange={(e) => updateReading(entry.id, { matchedMeterId: e.target.value })}>
                        <option value="">— zuordnen —</option>
                        {meters.map((m) => (
                          <option key={m.id} value={m.id}>{m.name} · {unitName(m.unitId)}{m.meterNumber ? ` · Nr. ${m.meterNumber}` : ''}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Stand
                      <input value={entry.data.reading.value} onChange={(e) => updateReading(entry.id, { value: e.target.value })} style={{ width: 110 }} />
                    </label>
                    <label className="field">
                      Datum
                      <input type="date" value={entry.data.reading.date} onChange={(e) => updateReading(entry.id, { date: e.target.value, hasDate: true })} />
                    </label>
                    <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 9 }}>
                      <input type="checkbox" checked={entry.data.reading.replacement} onChange={(e) => updateReading(entry.id, { replacement: e.target.checked })} />
                      Zählerwechsel
                    </label>
                    {entry.data.reading.replacement && (
                      <label className="field">
                        Endstand alt
                        <input value={entry.data.reading.oldEndValue} onChange={(e) => updateReading(entry.id, { oldEndValue: e.target.value })} style={{ width: 110 }} />
                      </label>
                    )}
                  </div>
                  {entry.data.reading.meterNumber && <div className="muted">Gelesene Zählernummer: {entry.data.reading.meterNumber}</div>}
                  {rs && rs.level !== 'gruen' && (
                    <div style={{ marginTop: 6 }}>
                      {rs.reasons.map((r, j) => <span key={j} className={`chip ${rs.level}`}>{r}</span>)}
                    </div>
                  )}
                  <div className="row" style={{ marginTop: 10 }}>
                    <div className="grow" />
                    <button className="btn" onClick={() => void adoptReading(entry)} disabled={adopting || !entry.data.reading.matchedMeterId || parseNum(entry.data.reading.value) === null}>
                      Ablesung übernehmen
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {assessments.map((v) => (
        <div className="card no-print" key={v.id}>
          <div className="row" style={{ alignItems: 'center' }}>
            <strong>🧾 {v.vendor || v.originalName}</strong>
            {v.open
              ? <span className="badge green">{v.lines.filter((l) => l.state === 'open').length} offen — bitte prüfen</span>
              : <span className="badge green">✓ übernommen</span>}
            {/* Das Jahr, in das gebucht wird (nach einer Änderung von Hand nicht mehr das des Belegs) */}
            {v.year !== year && <span className="badge gray">Jahr {v.year}</span>}
          </div>
          <AssessmentReview assessment={v} units={units} keyContext={keyCtx(v.year)}
            onChange={(next) => { upsert(next); void loadData() }}
            onOpenItem={(id) => onNavigate('kosten', { kind: 'costItem', id })} />
        </div>
      ))}

      {hasAdopted && (
        <div className="card no-print">
          <div className="row" style={{ alignItems: 'center' }}>
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

// ---------- EXIF-Datum (best effort) ----------
// Liest das Aufnahmedatum (DateTimeOriginal) aus dem JPEG, damit der Nutzer das Ablesedatum nicht
// tippen muss. Schlägt es fehl, greift im Aufrufer der Fallback „heute". Bewusst minimal gehalten.
async function readExifDate(file: File): Promise<string | null> {
  if (!/jpe?g/i.test(file.type)) return null
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer()
    const view = new DataView(buf)
    if (view.getUint16(0) !== 0xffd8) return null
    let offset = 2
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset)
      if ((marker & 0xff00) !== 0xff00) break
      const size = view.getUint16(offset + 2)
      if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966 /* 'Exif' */) {
        return parseExifDate(view, offset + 10)
      }
      offset += 2 + size
    }
  } catch {
    /* best effort — Datum ist optional */
  }
  return null
}

function parseExifDate(view: DataView, tiffStart: number): string | null {
  const little = view.getUint16(tiffStart) === 0x4949
  const u16 = (o: number) => view.getUint16(o, little)
  const u32 = (o: number) => view.getUint32(o, little)
  const findTag = (ifd: number, tag: number): number | null => {
    const count = u16(ifd)
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12
      if (u16(entry) === tag) return entry
    }
    return null
  }
  const readAscii = (entry: number): string => {
    const len = u32(entry + 4)
    const at = len > 4 ? tiffStart + u32(entry + 8) : entry + 8
    let s = ''
    for (let i = 0; i < len - 1; i++) s += String.fromCharCode(view.getUint8(at + i))
    return s
  }
  const ifd0 = tiffStart + u32(tiffStart + 4)
  const candidates: number[] = []
  const exifPtr = findTag(ifd0, 0x8769) // ExifIFD-Zeiger
  if (exifPtr) {
    const dto = findTag(tiffStart + u32(exifPtr + 8), 0x9003) // DateTimeOriginal
    if (dto) candidates.push(dto)
  }
  const dt = findTag(ifd0, 0x0132) // DateTime
  if (dt) candidates.push(dt)
  for (const c of candidates) {
    const m = readAscii(c).match(/^(\d{4}):(\d{2}):(\d{2})/) // "YYYY:MM:DD HH:MM:SS"
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
  }
  return null
}
