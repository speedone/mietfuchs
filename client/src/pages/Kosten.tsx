import { useEffect, useMemo, useState } from 'react'
import type { CostItem, CostKey, Extraction, Meter, MeterType, Settings, Unit } from '../types'
import { CATEGORIES, KEY_LABELS, METER_TYPE_LABELS, defaultKeyFor } from '../types'
import { api, fmtEuro, parseEuro } from '../api'

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

const EMPTY: ItemForm = { category: CATEGORIES[0], description: '', vendor: '', amount: '', labor35a: '', key: 'area', directUnitId: '', meterType: 'kaltwasser' }

export default function Kosten({ units, settings }: Props) {
  const [year, setYear] = useState(new Date().getFullYear() - 1)
  const [items, setItems] = useState<CostItem[]>([])
  const [meters, setMeters] = useState<Meter[]>([])
  const [form, setForm] = useState<ItemForm | null>(null)
  const [error, setError] = useState('')

  // KI-Auswertung
  const [file, setFile] = useState<File | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [extractMeta, setExtractMeta] = useState<{ vendor: string; file: string } | null>(null)
  const [positions, setPositions] = useState<ExtractPos[]>([])

  const load = () => api<CostItem[]>('/api/costItems').then(setItems)
  useEffect(() => {
    load().catch(() => setError('Server nicht erreichbar — läuft `npm run dev`?'))
    api<Meter[]>('/api/meters').then(setMeters).catch(() => {})
  }, [])

  // Verbrauchsschlüssel ist nur sinnvoll, wenn Wohnungszähler existieren
  const unitMeterTypes = useMemo(() => [...new Set(meters.filter((m) => m.unitId).map((m) => m.type))], [meters])

  const yearItems = useMemo(() => items.filter((i) => i.year === year), [items, year])
  const totalCents = yearItems.reduce((a, i) => a + i.amountCents, 0)

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
      invoiceFile: form.invoiceFile,
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

  async function runExtraction() {
    if (!file) return
    setExtracting(true)
    setExtractError('')
    setPositions([])
    setExtractMeta(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api<{ file: string; extraction: Extraction }>('/api/extract', { method: 'POST', body: fd })
      const ex = res.extraction
      setExtractMeta({ vendor: ex.vendor || file.name, file: res.file })
      setPositions(
        (ex.positions || []).map((p) => ({
          description: p.description,
          category: CATEGORIES.includes(p.category) ? p.category : 'Sonstige Betriebskosten',
          amount: p.amountEur.toLocaleString('de-DE', { minimumFractionDigits: 2 }),
          labor35a: p.labor35aEur ? p.labor35aEur.toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '',
          key: defaultKeyFor(p.category),
          checked: p.category !== 'Nicht umlagefähig',
        })),
      )
    } catch (e) {
      setExtractError(String((e as Error).message))
    } finally {
      setExtracting(false)
    }
  }

  async function adoptPositions() {
    const chosen = positions.filter((p) => p.checked)
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
          vendor: extractMeta?.vendor,
          amountCents: amount,
          labor35aCents: labor35a || undefined,
          key: p.key,
          invoiceFile: extractMeta?.file,
        }),
      })
    }
    setPositions([])
    setExtractMeta(null)
    setFile(null)
    await load()
  }

  function updatePos(idx: number, patch: Partial<ExtractPos>) {
    setPositions(positions.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
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
        <div className="row">
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="btn" onClick={runExtraction} disabled={!file || extracting}>
            {extracting && <span className="spinner" />}
            {extracting ? 'Modell arbeitet … (kann 1–2 Min. dauern)' : 'Auswerten'}
          </button>
        </div>
        {extractError && <div className="error">{extractError}</div>}
        {positions.length > 0 && (
          <>
            <div className="ok">
              Rechnung von <strong>{extractMeta?.vendor}</strong> erkannt — {positions.length} Position(en).
              Bitte prüfen, anpassen und übernehmen.
            </div>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Beschreibung</th>
                  <th>Kostenart</th>
                  <th>Umlageschlüssel</th>
                  <th className="num">Betrag €</th>
                  <th className="num">§35a Lohn €</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => (
                  <tr key={i}>
                    <td><input type="checkbox" checked={p.checked} onChange={(e) => updatePos(i, { checked: e.target.checked })} /></td>
                    <td><input value={p.description} onChange={(e) => updatePos(i, { description: e.target.value })} style={{ width: '100%' }} /></td>
                    <td>
                      <select value={p.category} onChange={(e) => updatePos(i, { category: e.target.value, key: defaultKeyFor(e.target.value) })}>
                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={p.key} onChange={(e) => updatePos(i, { key: e.target.value as CostKey })}>
                        {(['area', 'persons', 'units'] as CostKey[]).map((k) => (
                          <option key={k} value={k}>{KEY_LABELS[k]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="num"><input value={p.amount} onChange={(e) => updatePos(i, { amount: e.target.value })} style={{ width: 100, textAlign: 'right' }} /></td>
                    <td className="num"><input value={p.labor35a} onChange={(e) => updatePos(i, { labor35a: e.target.value })} style={{ width: 90, textAlign: 'right' }} placeholder="—" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={adoptPositions} disabled={positions.every((p) => !p.checked)}>
                Ausgewählte Positionen für {year} übernehmen
              </button>
              <button className="btn ghost" onClick={() => { setPositions([]); setExtractMeta(null) }}>Verwerfen</button>
            </div>
          </>
        )}
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
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {yearItems.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.category}
                    {i.category === 'Nicht umlagefähig' && <span className="badge gray" style={{ marginLeft: 6 }}>Vermieter</span>}
                  </td>
                  <td>
                    {i.description}
                    {i.vendor && <div className="muted">{i.vendor}</div>}
                    {i.invoiceFile && (
                      <div><a href={`/uploads/${i.invoiceFile}`} target="_blank" rel="noreferrer" className="muted">📎 Beleg</a></div>
                    )}
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
