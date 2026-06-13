import { useEffect, useMemo, useRef, useState } from 'react'
import type { CostItem, CostKey, IntakeResult, Meter, Reading, Settings, Unit } from '../types'
import { CATEGORIES, KEY_LABELS, METER_TYPE_LABELS, defaultKeyFor, matchCategory } from '../types'
import { api, fmtEuro, fmtDate, parseEuro } from '../api'
import { autoMatchMeter, belegSummeCheck, scorePosition, scoreReading, type Ampel } from '../triage'
import { useYear } from '../year'

type Props = { units: Unit[]; settings: Settings | null; onNavigate: (tab: string) => void }

// Editierbare Rechnungsposition (Felder als Strings, damit der Nutzer frei korrigieren kann)
type RechnungPos = {
  description: string
  category: string
  amount: string
  labor35a: string
  key: CostKey
  matchedByDesc: boolean
  checked: boolean
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

type Status = 'wartend' | 'läuft' | 'fertig' | 'fehler' | 'übernommen'

// Ein Eintrag der Warteschlange. Vor der Auswertung ist `kind` noch unbekannt; danach trägt der
// Eintrag entweder Rechnungspositionen oder einen Zählerstand-Kandidaten.
type QueueEntry = {
  id: number
  fileName: string
  status: Status
  error?: string
  kind?: 'rechnung' | 'zaehler'
  serverFile?: string
  exifDate?: string | null
  // Rechnung
  vendor?: string
  detectedYear?: number | null
  totalGrossCents?: number | null
  positions?: RechnungPos[]
  // Zähler
  reading?: ReadingCandidate
}

const todayISO = () => new Date().toISOString().slice(0, 10)

// Zählerstände: deutsche und technische Schreibweise zu Zahl
function parseNum(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(norm)
  return Number.isFinite(n) ? n : null
}

// Jahr aus den Extraktionsdaten ableiten: bevorzugt der Leistungszeitraum, sonst das Rechnungsdatum
function yearFrom(periodStart?: string | null, invoiceDate?: string): number | null {
  const src = (periodStart && periodStart.slice(0, 4)) || (invoiceDate && invoiceDate.slice(0, 4)) || ''
  const y = Number(src)
  return Number.isInteger(y) && y > 1990 && y < 2100 ? y : null
}

export default function Schnellerfassung({ units, settings, onNavigate }: Props) {
  const { year, setYear } = useYear()
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [existingItems, setExistingItems] = useState<CostItem[]>([])
  const [meters, setMeters] = useState<Meter[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')

  const filesRef = useRef(new Map<number, File>())
  const nextIdRef = useRef(1)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadData = () =>
    Promise.all([
      api<CostItem[]>('/api/costItems').then(setExistingItems),
      api<Meter[]>('/api/meters').then(setMeters),
      api<Reading[]>('/api/readings').then(setReadings),
    ])
  useEffect(() => {
    loadData().catch(() => setError('Server nicht erreichbar — läuft `npm run dev`?'))
  }, [])

  function patchEntry(id: number, patch: Partial<QueueEntry>) {
    setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }

  function addFiles(files: Iterable<File>) {
    const entries: QueueEntry[] = []
    for (const f of files) {
      if (!/^(application\/pdf|image\/)/.test(f.type)) continue
      const id = nextIdRef.current++
      filesRef.current.set(id, f)
      entries.push({ id, fileName: f.name, status: 'wartend' })
    }
    if (entries.length) setQueue((q) => [...q, ...entries])
  }

  // Sequenzielle Abarbeitung: ein lokales Modell verarbeitet sinnvoll nur eine Anfrage gleichzeitig
  useEffect(() => {
    if (queue.some((x) => x.status === 'läuft')) return
    const next = queue.find((x) => x.status === 'wartend')
    if (!next) return
    patchEntry(next.id, { status: 'läuft' })
    void (async () => {
      const file = filesRef.current.get(next.id)!
      try {
        const exifDate = await readExifDate(file)
        const fd = new FormData()
        fd.append('file', file)
        const res = await api<IntakeResult>('/api/intake', { method: 'POST', body: fd })

        if (res.kind === 'zaehler') {
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
            value: value != null ? String(value) : '',
            date: r.dateOnImage || exifDate || todayISO(),
            hasDate: !!(r.dateOnImage || exifDate),
            matchedMeterId,
            replacement: sc.replacementGuess,
            oldEndValue: sc.suggestedOldEndValue != null ? String(sc.suggestedOldEndValue) : '',
            checked: sc.level !== 'rot',
          }
          patchEntry(next.id, { status: 'fertig', kind: 'zaehler', serverFile: res.file, exifDate, reading })
        } else {
          const ex = res.extraction
          const positions: RechnungPos[] = (ex.positions || []).map((p) => {
            // KI-Kategorie auf die bekannten Betriebskostenarten abbilden — notfalls über die
            // Beschreibung. matchedByDesc merkt sich, ob die Kategorie nur so zustande kam (→ gelb).
            let category = matchCategory(p.category || '')
            let matchedByDesc = false
            if (category === 'Sonstige Betriebskosten') {
              const byDesc = matchCategory(p.description || '')
              if (byDesc !== 'Sonstige Betriebskosten') {
                category = byDesc
                matchedByDesc = true
              }
            }
            return {
              description: p.description,
              category,
              amount: p.amountEur.toLocaleString('de-DE', { minimumFractionDigits: 2 }),
              labor35a: p.labor35aEur ? p.labor35aEur.toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '',
              key: defaultKeyFor(category),
              matchedByDesc,
              checked: category !== 'Nicht umlagefähig',
            }
          })
          patchEntry(next.id, {
            status: 'fertig',
            kind: 'rechnung',
            serverFile: res.file,
            vendor: ex.vendor || next.fileName,
            detectedYear: yearFrom(ex.periodStart, ex.invoiceDate),
            totalGrossCents: ex.totalGrossEur != null ? Math.round(ex.totalGrossEur * 100) : null,
            positions,
          })
        }
      } catch (e) {
        patchEntry(next.id, { status: 'fehler', error: String((e as Error).message) })
      } finally {
        filesRef.current.delete(next.id)
      }
    })()
  }, [queue, meters, readings])

  function updatePos(entryId: number, idx: number, patch: Partial<RechnungPos>) {
    setQueue((q) =>
      q.map((x) => (x.id === entryId ? { ...x, positions: x.positions!.map((p, i) => (i === idx ? { ...p, ...patch } : p)) } : x)),
    )
  }
  function updateReading(entryId: number, patch: Partial<ReadingCandidate>) {
    setQueue((q) => q.map((x) => (x.id === entryId ? { ...x, reading: { ...x.reading!, ...patch } } : x)))
  }

  // ---------- Live-Bewertung (re-scort bei jeder Eingabe) ----------
  const priorYear = year - 1
  const priorTotalsByCat = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of existingItems) if (i.year === priorYear) m.set(i.category, (m.get(i.category) ?? 0) + i.amountCents)
    return m
  }, [existingItems, priorYear])
  const existingTargetByCat = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of existingItems) if (i.year === year) m.set(i.category, (m.get(i.category) ?? 0) + i.amountCents)
    return m
  }, [existingItems, year])

  type PosScore = { level: Ampel; reasons: string[] }
  type EntryScore = { posScores: PosScore[]; belegWarn: string | null; readingScore: ReturnType<typeof scoreReading> | null }
  const scored = useMemo(() => {
    const map = new Map<number, EntryScore>()
    for (const entry of queue) {
      if (entry.status !== 'fertig') continue
      if (entry.kind === 'rechnung' && entry.positions) {
        let sum = 0
        const posScores = entry.positions.map((p) => {
          const amountCents = parseEuro(p.amount) ?? 0
          sum += amountCents > 0 ? amountCents : 0
          const labor = p.labor35a.trim() ? parseEuro(p.labor35a) ?? 0 : 0
          const prior = priorTotalsByCat.get(p.category) ?? 0
          const current = (existingTargetByCat.get(p.category) ?? 0) + amountCents
          const devPct = prior > 0 ? ((current - prior) / prior) * 100 : null
          return scorePosition({
            category: p.category,
            amountCents,
            labor35aCents: labor,
            matchedByDesc: p.matchedByDesc,
            vendor: entry.vendor ?? '',
            detectedYear: entry.detectedYear ?? null,
            targetYear: year,
            existingItems,
            priorYearDeviationPct: devPct,
          })
        })
        map.set(entry.id, { posScores, belegWarn: belegSummeCheck(sum, entry.totalGrossCents ?? null), readingScore: null })
      } else if (entry.kind === 'zaehler' && entry.reading) {
        const r = entry.reading
        const rs = scoreReading({
          meterNumber: r.meterNumber || null,
          value: parseNum(r.value),
          hasDate: r.hasDate,
          matchedMeterId: r.matchedMeterId || null,
          readings,
        })
        map.set(entry.id, { posScores: [], belegWarn: null, readingScore: rs })
      }
    }
    return map
  }, [queue, existingItems, readings, year, priorTotalsByCat, existingTargetByCat])

  // Ampel-Zählung über alle fertigen Einträge
  const tally = useMemo(() => {
    const t = { gruen: 0, gelb: 0, rot: 0 }
    for (const entry of queue) {
      const es = scored.get(entry.id)
      if (!es) continue
      if (entry.kind === 'rechnung') for (const ps of es.posScores) t[ps.level]++
      else if (es.readingScore) t[es.readingScore.level]++
    }
    return t
  }, [queue, scored])
  const totalErkannt = tally.gruen + tally.gelb + tally.rot

  // ---------- Übernehmen ----------
  async function postPosition(entry: QueueEntry, p: RechnungPos) {
    const amount = parseEuro(p.amount)
    if (amount == null || amount <= 0) return false
    const labor = p.labor35a.trim() ? parseEuro(p.labor35a) ?? 0 : 0
    await api('/api/costItems', {
      method: 'POST',
      body: JSON.stringify({
        year: entry.detectedYear ?? year,
        category: p.category,
        description: p.description,
        vendor: entry.vendor,
        amountCents: amount,
        labor35aCents: labor || undefined,
        key: p.key,
        invoiceFile: entry.serverFile,
      }),
    })
    return true
  }
  async function postReading(entry: QueueEntry) {
    const r = entry.reading!
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

  // Übernimmt einen kompletten Eintrag (alle angehakten Positionen / den Zählerstand)
  async function adoptEntry(entry: QueueEntry) {
    if (entry.kind === 'rechnung') {
      for (const p of entry.positions ?? []) if (p.checked) await postPosition(entry, p)
    } else if (entry.kind === 'zaehler') {
      if (entry.reading?.checked) await postReading(entry)
    }
    patchEntry(entry.id, { status: 'übernommen' })
    await loadData()
  }

  // Übernimmt alle grünen, angehakten Vorschläge über sämtliche Einträge hinweg
  async function adoptAllGreen() {
    setError('')
    for (const entry of queue) {
      const es = scored.get(entry.id)
      if (!es || entry.status !== 'fertig') continue
      let any = false
      if (entry.kind === 'rechnung' && entry.positions) {
        for (let i = 0; i < entry.positions.length; i++) {
          const p = entry.positions[i]
          if (p.checked && es.posScores[i]?.level === 'gruen') {
            if (await postPosition(entry, p)) any = true
          }
        }
      } else if (entry.kind === 'zaehler' && entry.reading?.checked && es.readingScore?.level === 'gruen') {
        if (await postReading(entry)) any = true
      }
      if (any) patchEntry(entry.id, { status: 'übernommen' })
    }
    await loadData()
  }

  function removeEntry(id: number) {
    filesRef.current.delete(id)
    setQueue((q) => q.filter((x) => x.id !== id))
  }

  const unitName = (id: string | null) => (id ? units.find((u) => u.id === id)?.name ?? '?' : 'Haus (Hauptzähler)')
  const hasUebernommen = queue.some((x) => x.status === 'übernommen')

  return (
    <>
      <h1>📥 Schnellerfassung</h1>
      <p className="sub">
        Wirf alles rein — Rechnungen <em>und</em> Zählerfotos. Das Tool erkennt automatisch, was es ist,
        prüft es und sortiert nach Ampel. Grün übernimmst du mit einem Klick. Alles bleibt lokal
        ({settings?.ollamaModel || 'Ollama'}).
      </p>
      {error && <div className="error">{error}</div>}

      <div className="card no-print">
        <div className="row" style={{ alignItems: 'center' }}>
          <label className="field">
            Abrechnungsjahr
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 8 }, (_, k) => new Date().getFullYear() - k).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <div className="grow" />
          {totalErkannt > 0 && (
            <div className="muted" style={{ textAlign: 'right' }}>
              {totalErkannt} erkannt — <span className="ampel gruen" /> {tally.gruen} · <span className="ampel gelb" /> {tally.gelb} · <span className="ampel rot" /> {tally.rot}
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

        {tally.gruen > 0 && (
          <div className="sticky-bar">
            <strong>{tally.gruen}</strong> grüne Vorschläge bereit.
            <div className="grow" />
            <button className="btn" onClick={() => void adoptAllGreen()}>✓ Alle grünen übernehmen</button>
          </div>
        )}
      </div>

      {queue.map((entry) => {
        const es = scored.get(entry.id)
        return (
          <div className="card no-print" key={entry.id}>
            <div className="row" style={{ alignItems: 'center' }}>
              <strong>{entry.kind === 'zaehler' ? '🔢 ' : '🧾 '}{entry.vendor || entry.fileName}</strong>
              {entry.status === 'wartend' && <span className="badge gray">wartet …</span>}
              {entry.status === 'läuft' && <span className="badge gray"><span className="spinner" />Modell arbeitet …</span>}
              {entry.status === 'fertig' && entry.kind === 'rechnung' && <span className="badge green">{entry.positions?.length || 0} Position(en)</span>}
              {entry.status === 'fertig' && entry.kind === 'zaehler' && <span className="badge green">Zählerstand erkannt</span>}
              {entry.status === 'übernommen' && <span className="badge green">✓ übernommen</span>}
              {entry.status === 'fehler' && <span className="badge red">Fehler</span>}
              {entry.detectedYear != null && entry.detectedYear !== year && (
                <span className="badge gray">Jahr {entry.detectedYear}</span>
              )}
              <div className="grow" />
              {entry.status !== 'läuft' && (
                <button className="btn small ghost" onClick={() => removeEntry(entry.id)}>Entfernen</button>
              )}
            </div>

            {entry.status === 'fehler' && <div className="error" style={{ marginTop: 8 }}>{entry.error}</div>}

            {/* ---------- Rechnung ---------- */}
            {entry.status === 'fertig' && entry.kind === 'rechnung' && entry.positions && (
              <>
                {es?.belegWarn && <div className="warn" style={{ marginTop: 8 }}>⚠ {es.belegWarn}</div>}
                <table style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th><span className="sr-only">Übernehmen</span></th>
                      <th></th>
                      <th>Beschreibung</th>
                      <th>Kostenart</th>
                      <th>Umlageschlüssel</th>
                      <th className="num">Betrag €</th>
                      <th className="num">§35a €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.positions.map((p, i) => {
                      const ps = es?.posScores[i]
                      return (
                        <tr key={i}>
                          <td><input type="checkbox" checked={p.checked} onChange={(e) => updatePos(entry.id, i, { checked: e.target.checked })} /></td>
                          <td>
                            <span className={`ampel ${ps?.level ?? 'gruen'}`} title={ps?.reasons.join('\n')} />
                          </td>
                          <td><input value={p.description} onChange={(e) => updatePos(entry.id, i, { description: e.target.value })} style={{ width: '100%' }} /></td>
                          <td>
                            <select value={p.category} onChange={(e) => updatePos(entry.id, i, { category: e.target.value, key: defaultKeyFor(e.target.value), matchedByDesc: false })}>
                              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                            </select>
                          </td>
                          <td>
                            <select value={p.key} onChange={(e) => updatePos(entry.id, i, { key: e.target.value as CostKey })}>
                              {(['area', 'persons', 'units'] as CostKey[]).map((k) => (
                                <option key={k} value={k}>{KEY_LABELS[k]}</option>
                              ))}
                            </select>
                          </td>
                          <td className="num"><input value={p.amount} onChange={(e) => updatePos(entry.id, i, { amount: e.target.value })} style={{ width: 100, textAlign: 'right' }} /></td>
                          <td className="num"><input value={p.labor35a} onChange={(e) => updatePos(entry.id, i, { labor35a: e.target.value })} style={{ width: 80, textAlign: 'right' }} placeholder="—" /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {/* Begründungen der nicht-grünen Positionen */}
                {es?.posScores.some((s) => s.level !== 'gruen') && (
                  <div style={{ marginTop: 6 }}>
                    {es.posScores.map((s, i) =>
                      s.level === 'gruen' ? null : s.reasons.map((r, j) => (
                        <span key={`${i}-${j}`} className={`chip ${s.level}`}>{r}</span>
                      )),
                    )}
                  </div>
                )}
                <div className="row" style={{ marginTop: 10 }}>
                  <a href={`/uploads/${entry.serverFile}`} target="_blank" rel="noreferrer">📎 Beleg ansehen</a>
                  <div className="grow" />
                  <button className="btn" onClick={() => void adoptEntry(entry)} disabled={entry.positions.every((p) => !p.checked)}>
                    Diese übernehmen
                  </button>
                </div>
              </>
            )}

            {/* ---------- Zählerstand ---------- */}
            {entry.status === 'fertig' && entry.kind === 'zaehler' && entry.reading && (
              <div className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
                {entry.serverFile && (
                  <a href={`/uploads/${entry.serverFile}`} target="_blank" rel="noreferrer">
                    <img src={`/uploads/${entry.serverFile}`} alt="Zählerfoto" style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />
                  </a>
                )}
                <div className="grow">
                  <div className="row" style={{ alignItems: 'center' }}>
                    <span className={`ampel ${es?.readingScore?.level ?? 'gruen'}`} />
                    <label className="field">
                      Zähler
                      <select value={entry.reading.matchedMeterId} onChange={(e) => updateReading(entry.id, { matchedMeterId: e.target.value })}>
                        <option value="">— zuordnen —</option>
                        {meters.map((m) => (
                          <option key={m.id} value={m.id}>{m.name} · {unitName(m.unitId)}{m.meterNumber ? ` · Nr. ${m.meterNumber}` : ''}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Stand
                      <input value={entry.reading.value} onChange={(e) => updateReading(entry.id, { value: e.target.value })} style={{ width: 110 }} />
                    </label>
                    <label className="field">
                      Datum
                      <input type="date" value={entry.reading.date} onChange={(e) => updateReading(entry.id, { date: e.target.value, hasDate: true })} />
                    </label>
                    <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 9 }}>
                      <input type="checkbox" checked={entry.reading.replacement} onChange={(e) => updateReading(entry.id, { replacement: e.target.checked })} />
                      Zählerwechsel
                    </label>
                    {entry.reading.replacement && (
                      <label className="field">
                        Endstand alt
                        <input value={entry.reading.oldEndValue} onChange={(e) => updateReading(entry.id, { oldEndValue: e.target.value })} style={{ width: 110 }} />
                      </label>
                    )}
                  </div>
                  {entry.reading.meterNumber && <div className="muted">Gelesene Zählernummer: {entry.reading.meterNumber}</div>}
                  {es?.readingScore && es.readingScore.level !== 'gruen' && (
                    <div style={{ marginTop: 6 }}>
                      {es.readingScore.reasons.map((r, j) => <span key={j} className={`chip ${es.readingScore!.level}`}>{r}</span>)}
                    </div>
                  )}
                  <div className="row" style={{ marginTop: 10 }}>
                    <div className="grow" />
                    <button className="btn" onClick={() => void adoptEntry(entry)} disabled={!entry.reading.matchedMeterId || !parseNum(entry.reading.value)}>
                      Ablesung übernehmen
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {hasUebernommen && (
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
