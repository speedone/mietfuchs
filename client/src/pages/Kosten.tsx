import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { CostItem, CostKey, Extraction, Meter, MeterType, Settings, Unit } from '../types'
import { CATEGORIES, KEY_LABELS, METER_TYPE_LABELS, defaultKeyFor, matchCategory } from '../types'
import { api, fmtEuro, parseEuro } from '../api'
import { useYear } from '../year'

type Props = { units: Unit[]; settings: Settings | null }

type ItemForm = {
  id?: string
  category: string
  description: string
  vendor: string
  amount: string
  labor35a: string
  key: CostKey
  directUnitId: string
  meterType: MeterType
  invoiceFile?: string
}

type ExtractPos = { description: string; category: string; amount: string; labor35a: string; key: CostKey; checked: boolean }

// Ein Eintrag der Upload-Warteschlange: Dateien werden nacheinander durch die KI geschickt
// (ein lokales Modell verarbeitet ohnehin nur eine Anfrage sinnvoll gleichzeitig).
type QueueEntry = {
  id: number
  fileName: string
  status: 'wartend' | 'läuft' | 'fertig' | 'fehler' | 'übernommen'
  error?: string
  vendor?: string
  serverFile?: string
  positions: ExtractPos[]
}

const EMPTY: ItemForm = { category: CATEGORIES[0], description: '', vendor: '', amount: '', labor35a: '', key: 'area', directUnitId: '', meterType: 'kaltwasser' }

export default function Kosten({ units, settings }: Props) {
  const { year, setYear } = useYear()
  const [items, setItems] = useState<CostItem[]>([])
  const [meters, setMeters] = useState<Meter[]>([])
  const [form, setForm] = useState<ItemForm | null>(null)
  const [error, setError] = useState('')

  // KI-Auswertung: Warteschlange für einen oder mehrere Belege
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [dragOver, setDragOver] = useState(false)
  const filesRef = useRef(new Map<number, File>())
  const nextIdRef = useRef(1)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = () => api<CostItem[]>('/api/costItems').then(setItems)
  useEffect(() => {
    load().catch(() => setError('Server nicht erreichbar — läuft `npm run dev`?'))
    api<Meter[]>('/api/meters').then(setMeters).catch(() => {})
  }, [])

  // Verbrauchsschlüssel ist nur sinnvoll, wenn Wohnungszähler existieren
  const unitMeterTypes = useMemo(() => [...new Set(meters.filter((m) => m.unitId).map((m) => m.type))], [meters])

  // Bereits hochgeladene Belege (für die nachträgliche Zuordnung zu einer Position)
  const knownFiles = useMemo(() => {
    const m = new Map<string, string>()
    for (const it of items) if (it.invoiceFile && !m.has(it.invoiceFile)) m.set(it.invoiceFile, it.vendor || it.category)
    return [...m.entries()]
  }, [items])

  async function uploadBeleg(f: File) {
    const fd = new FormData()
    fd.append('file', f)
    const res = await api<{ file: string }>('/api/upload', { method: 'POST', body: fd })
    setForm((prev) => (prev ? { ...prev, invoiceFile: res.file } : prev))
  }

  const yearItems = useMemo(() => items.filter((i) => i.year === year), [items, year])
  const totalCents = yearItems.reduce((a, i) => a + i.amountCents, 0)

  // Nach Beleg (Rechnung) gruppiert — alle Positionen eines Belegs stehen zusammen, mit
  // Zwischensumme = Belegsumme. So lassen sich die einzelnen Beträge und die Summe direkt
  // mit der Rechnung abgleichen (z. B. Wasser, Abwasser, Kanal- und Niederschlagsbeitrag
  // eines Versorgers). Manuell erfasste Positionen ohne Beleg stehen einzeln am Ende.
  type CostGroup = { key: string; label: string; invoiceFile?: string; items: CostItem[] }
  const grouped = useMemo(() => {
    const withBeleg: CostGroup[] = []
    const withoutBeleg: CostGroup[] = []
    for (const it of yearItems) {
      if (it.invoiceFile) {
        const g = withBeleg.find((x) => x.invoiceFile === it.invoiceFile)
        if (g) { g.items.push(it); if (!g.label && it.vendor) g.label = it.vendor }
        else withBeleg.push({ key: `f:${it.invoiceFile}`, label: it.vendor || '', invoiceFile: it.invoiceFile, items: [it] })
      } else {
        withoutBeleg.push({ key: `i:${it.id}`, label: it.vendor || it.category, items: [it] })
      }
    }
    // Fallback-Beschriftung, falls kein Rechnungssteller hinterlegt ist
    for (const g of withBeleg) if (!g.label) g.label = g.items.map((i) => i.category).find(Boolean) || 'Beleg'
    return [...withBeleg, ...withoutBeleg]
  }, [yearItems])

  async function saveItem() {
    if (!form) return
    const amount = parseEuro(form.amount)
    const labor35a = form.labor35a.trim() ? parseEuro(form.labor35a) : 0
    if (!form.description.trim() || amount === null || amount <= 0) {
      setError('Bitte Beschreibung und gültigen Betrag angeben.')
      return
    }
    if (labor35a === null || labor35a > amount) {
      setError('Der §35a-Lohnanteil muss eine gültige Zahl ≤ Gesamtbetrag sein.')
      return
    }
    if (form.key === 'direct' && !form.directUnitId) {
      setError('Bei Direktzuordnung bitte eine Wohnung wählen.')
      return
    }
    setError('')
    const body = JSON.stringify({
      year,
      category: form.category,
      description: form.description.trim(),
      vendor: form.vendor.trim() || undefined,
      amountCents: amount,
      labor35aCents: labor35a || undefined,
      key: form.key,
      directUnitId: form.key === 'direct' ? form.directUnitId : undefined,
      meterType: form.key === 'meter' ? form.meterType : undefined,
      invoiceFile: form.invoiceFile ?? null, // null löscht eine bestehende Zuordnung
    })
    if (form.id) await api(`/api/costItems/${form.id}`, { method: 'PUT', body })
    else await api('/api/costItems', { method: 'POST', body })
    setForm(null)
    await load()
  }

  async function deleteItem(i: CostItem) {
    if (!confirm(`Kostenposition „${i.description}" löschen?`)) return
    await api(`/api/costItems/${i.id}`, { method: 'DELETE' })
    await load()
  }

  function addFiles(files: Iterable<File>) {
    const entries: QueueEntry[] = []
    for (const f of files) {
      if (!/^(application\/pdf|image\/)/.test(f.type)) continue
      const id = nextIdRef.current++
      filesRef.current.set(id, f)
      entries.push({ id, fileName: f.name, status: 'wartend', positions: [] })
    }
    if (entries.length) setQueue((q) => [...q, ...entries])
  }

  function patchEntry(id: number, patch: Partial<QueueEntry>) {
    setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }

  // Sequenzielle Abarbeitung: sobald nichts läuft, den nächsten wartenden Beleg starten
  useEffect(() => {
    if (queue.some((x) => x.status === 'läuft')) return
    const next = queue.find((x) => x.status === 'wartend')
    if (!next) return
    patchEntry(next.id, { status: 'läuft' })
    void (async () => {
      try {
        const fd = new FormData()
        fd.append('file', filesRef.current.get(next.id)!)
        const res = await api<{ file: string; extraction: Extraction }>('/api/extract', { method: 'POST', body: fd })
        const ex = res.extraction
        const positions = (ex.positions || []).map((p) => {
          // KI-Kategorie auf die bekannten Betriebskostenarten abbilden — notfalls
          // über die Beschreibung (z. B. wenn das Modell eine eigene Kategorie erfindet)
          let category = matchCategory(p.category || '')
          if (category === 'Sonstige Betriebskosten') {
            const byDesc = matchCategory(p.description || '')
            if (byDesc !== 'Sonstige Betriebskosten') category = byDesc
          }
          return {
            description: p.description,
            category,
            amount: p.amountEur.toLocaleString('de-DE', { minimumFractionDigits: 2 }),
            labor35a: p.labor35aEur ? p.labor35aEur.toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '',
            key: defaultKeyFor(category),
            checked: category !== 'Nicht umlagefähig',
          }
        })
        patchEntry(next.id, { status: 'fertig', vendor: ex.vendor || next.fileName, serverFile: res.file, positions })
      } catch (e) {
        patchEntry(next.id, { status: 'fehler', error: String((e as Error).message) })
      } finally {
        filesRef.current.delete(next.id)
      }
    })()
  }, [queue])

  async function adoptPositions(entry: QueueEntry) {
    const chosen = entry.positions.filter((p) => p.checked)
    for (const p of chosen) {
      const amount = parseEuro(p.amount)
      if (amount === null) continue
      const labor35a = p.labor35a.trim() ? parseEuro(p.labor35a) : 0
      await api('/api/costItems', {
        method: 'POST',
        body: JSON.stringify({
          year,
          category: p.category,
          description: p.description,
          vendor: entry.vendor,
          amountCents: amount,
          labor35aCents: labor35a || undefined,
          key: p.key,
          invoiceFile: entry.serverFile,
        }),
      })
    }
    patchEntry(entry.id, { status: 'übernommen' })
    await load()
  }

  function updatePos(entryId: number, idx: number, patch: Partial<ExtractPos>) {
    setQueue((q) =>
      q.map((x) => (x.id === entryId ? { ...x, positions: x.positions.map((p, i) => (i === idx ? { ...p, ...patch } : p)) } : x)),
    )
  }

  return (
    <>
      <h1>Kosten &amp; Belege</h1>
      <p className="sub">Alle Rechnungen des Abrechnungsjahres erfassen — manuell oder per KI-Belegauswertung.</p>
      {error && <div className="error">{error}</div>}

      <div className="card no-print">
        <div className="row">
          <label className="field">
            Abrechnungsjahr
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 8 }, (_, k) => new Date().getFullYear() - k).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <div className="grow" />
          <div>
            <div className="muted">Erfasste Kosten {year}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtEuro(totalCents)}</div>
          </div>
        </div>
      </div>

      <div className="card no-print">
        <h2>🤖 Beleg per KI auswerten <span className="badge gray">lokal über Ollama</span></h2>
        <p className="muted">
          PDF oder Foto der Rechnung hochladen — das lokale Modell ({settings?.ollamaModel || 'Ollama'})
          schlägt Kostenpositionen vor, du prüfst und übernimmst sie. Es verlässt nichts deinen Rechner.
        </p>
        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
        >
          <strong>Belege hierher ziehen</strong> oder klicken zum Auswählen — auch mehrere auf einmal.
          <div className="muted">Sie werden nacheinander verarbeitet (PDF oder Foto).</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
          />
        </div>

        {queue.map((entry) => (
          <div key={entry.id} style={{ marginTop: 14 }}>
            <div className="row" style={{ alignItems: 'center' }}>
              <strong>{entry.fileName}</strong>
              {entry.status === 'wartend' && <span className="badge gray">wartet …</span>}
              {entry.status === 'läuft' && <span className="badge gray"><span className="spinner" />Modell arbeitet … (kann 1–2 Min. dauern)</span>}
              {entry.status === 'fertig' && <span className="badge green">{entry.positions.length} Position(en) erkannt — bitte prüfen</span>}
              {entry.status === 'übernommen' && <span className="badge green">✓ übernommen</span>}
              {entry.status === 'fehler' && <span className="badge red">Fehler</span>}
              <div className="grow" />
              {(entry.status === 'wartend' || entry.status === 'fertig' || entry.status === 'fehler' || entry.status === 'übernommen') && (
                <button className="btn small ghost" onClick={() => { filesRef.current.delete(entry.id); setQueue((q) => q.filter((x) => x.id !== entry.id)) }}>
                  {entry.status === 'fertig' ? 'Verwerfen' : 'Entfernen'}
                </button>
              )}
            </div>
            {entry.status === 'fehler' && <div className="error">{entry.error}</div>}
            {entry.status === 'fertig' && (
              <>
                <table style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th><span className="sr-only">Übernehmen</span></th>
                      <th>Beschreibung</th>
                      <th>Kostenart</th>
                      <th>Umlageschlüssel</th>
                      <th className="num">Betrag €</th>
                      <th className="num">§35a Lohn €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.positions.map((p, i) => (
                      <tr key={i}>
                        <td><input type="checkbox" checked={p.checked} onChange={(e) => updatePos(entry.id, i, { checked: e.target.checked })} /></td>
                        <td><input value={p.description} onChange={(e) => updatePos(entry.id, i, { description: e.target.value })} style={{ width: '100%' }} /></td>
                        <td>
                          <select value={p.category} onChange={(e) => updatePos(entry.id, i, { category: e.target.value, key: defaultKeyFor(e.target.value) })}>
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
                        <td className="num"><input value={p.labor35a} onChange={(e) => updatePos(entry.id, i, { labor35a: e.target.value })} style={{ width: 90, textAlign: 'right' }} placeholder="—" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => void adoptPositions(entry)} disabled={entry.positions.every((p) => !p.checked)}>
                    Ausgewählte Positionen für {year} übernehmen
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Kostenpositionen {year}</h2>
        {yearItems.length === 0 && <div className="empty">Noch keine Kosten für {year} erfasst.</div>}
        {yearItems.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Kostenart</th>
                <th>Beschreibung</th>
                <th>Umlageschlüssel</th>
                <th className="num">Betrag</th>
                <th className="no-print"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
              <Fragment key={g.key}>
              {g.invoiceFile && (
                <tr className="group-head">
                  <td colSpan={5}>
                    {g.label}
                    <a href={`/uploads/${g.invoiceFile}`} target="_blank" rel="noreferrer">📎 Beleg</a>
                  </td>
                </tr>
              )}
              {g.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.category}
                    {i.category === 'Nicht umlagefähig' && <span className="badge gray" style={{ marginLeft: 6 }}>Vermieter</span>}
                  </td>
                  <td>
                    {i.description}
                    {!i.invoiceFile && i.vendor && <div className="muted">{i.vendor}</div>}
                  </td>
                  <td>
                    {KEY_LABELS[i.key]}
                    {i.key === 'direct' && <div className="muted">{units.find((u) => u.id === i.directUnitId)?.name}</div>}
                    {i.key === 'meter' && <div className="muted">{METER_TYPE_LABELS[i.meterType ?? 'kaltwasser']}</div>}
                  </td>
                  <td className="num">
                    {fmtEuro(i.amountCents)}
                    {!!i.labor35aCents && <div className="muted">§35a: {fmtEuro(i.labor35aCents)}</div>}
                  </td>
                  <td className="num no-print">
                    <button
                      className="btn small secondary"
                      onClick={() =>
                        setForm({
                          id: i.id,
                          category: i.category,
                          description: i.description,
                          vendor: i.vendor ?? '',
                          amount: (i.amountCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
                          labor35a: i.labor35aCents ? (i.labor35aCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '',
                          key: i.key,
                          directUnitId: i.directUnitId ?? '',
                          meterType: i.meterType ?? 'kaltwasser',
                          invoiceFile: i.invoiceFile,
                        })
                      }
                    >
                      Bearbeiten
                    </button>{' '}
                    <button className="btn small ghost" onClick={() => deleteItem(i)}>Löschen</button>
                  </td>
                </tr>
              ))}
              {g.invoiceFile && g.items.length > 1 && (
                <tr className="subtotal">
                  <td colSpan={3}>Summe Beleg — {g.label}</td>
                  <td className="num">{fmtEuro(g.items.reduce((a, i) => a + i.amountCents, 0))}</td>
                  <td className="no-print" />
                </tr>
              )}
              </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Summe</td>
                <td className="num">{fmtEuro(totalCents)}</td>
                <td className="no-print"></td>
              </tr>
            </tfoot>
          </table>
        )}

        {form ? (
          <div className="row" style={{ marginTop: 16 }}>
            <label className="field">
              Kostenart
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value, key: form.id ? form.key : defaultKeyFor(e.target.value) })}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="field grow">
              Beschreibung
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="z. B. Grundsteuer 2025" />
            </label>
            <label className="field">
              Rechnungssteller
              <input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="optional" style={{ width: 140 }} />
            </label>
            <label className="field">
              Betrag €
              <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={{ width: 110 }} placeholder="z. B. 480,00" />
            </label>
            <label className="field" title="Lohn-/Arbeitskostenanteil nach §35a EStG — kann der Mieter steuerlich absetzen">
              davon §35a Lohn €
              <input value={form.labor35a} onChange={(e) => setForm({ ...form, labor35a: e.target.value })} style={{ width: 110 }} placeholder="optional" />
            </label>
            <label className="field">
              Umlageschlüssel
              <select value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value as CostKey })}>
                {(Object.keys(KEY_LABELS) as CostKey[])
                  .filter((k) => k !== 'meter' || unitMeterTypes.length > 0)
                  .map((k) => (
                    <option key={k} value={k}>{KEY_LABELS[k]}</option>
                  ))}
              </select>
            </label>
            {form.key === 'meter' && (
              <label className="field">
                Zählertyp
                <select value={form.meterType} onChange={(e) => setForm({ ...form, meterType: e.target.value as MeterType })}>
                  {unitMeterTypes.map((t) => <option key={t} value={t}>{METER_TYPE_LABELS[t]}</option>)}
                </select>
              </label>
            )}
            {form.key === 'direct' && (
              <label className="field">
                Wohnung
                <select value={form.directUnitId} onChange={(e) => setForm({ ...form, directUnitId: e.target.value })}>
                  <option value="">— wählen —</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            )}
            <div style={{ width: '100%' }}>
              <div className="field" style={{ marginBottom: 4 }}>Beleg (Rechnungskopie)</div>
              {form.invoiceFile ? (
                <div className="row" style={{ alignItems: 'center' }}>
                  <a href={`/uploads/${form.invoiceFile}`} target="_blank" rel="noreferrer">
                    📎 {form.invoiceFile.replace(/^\d+_/, '')}
                  </a>
                  <button className="btn small ghost" onClick={() => setForm({ ...form, invoiceFile: undefined })}>
                    Zuordnung entfernen
                  </button>
                </div>
              ) : (
                <div className="row">
                  <label className="field">
                    neu hochladen
                    <input type="file" accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadBeleg(f) }} />
                  </label>
                  {knownFiles.length > 0 && (
                    <label className="field">
                      oder vorhandenen Beleg zuordnen
                      <select value="" onChange={(e) => { if (e.target.value) setForm({ ...form, invoiceFile: e.target.value }) }}>
                        <option value="">— wählen —</option>
                        {knownFiles.map(([f, label]) => (
                          <option key={f} value={f}>{label} — {f.replace(/^\d+_/, '')}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>
            <button className="btn" onClick={saveItem}>{form.id ? 'Übernehmen' : 'Hinzufügen'}</button>
            <button className="btn ghost" onClick={() => setForm(null)}>Abbrechen</button>
          </div>
        ) : (
          <button className="btn secondary no-print" style={{ marginTop: 14 }} onClick={() => setForm({ ...EMPTY })}>
            + Kostenposition manuell erfassen
          </button>
        )}
      </div>
    </>
  )
}
