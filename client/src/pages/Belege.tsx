import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CostItem, UploadInfo } from '../types'
import { api, fmtEuro } from '../api'
import { invoiceLabel } from '../pdfPreview'
import PageHeader from '../components/PageHeader'
import { useToast, useConfirm } from '../components/feedback'

const fmtSize = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} kB`

const fmtDateTime = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('de-DE')} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
}

export default function Belege() {
  const toast = useToast()
  const confirm = useConfirm()
  const [uploads, setUploads] = useState<UploadInfo[]>([])
  const [costItems, setCostItems] = useState<CostItem[]>([])
  const [error, setError] = useState('')

  const load = useCallback(() => {
    return Promise.all([api<UploadInfo[]>('/api/uploads'), api<CostItem[]>('/api/costItems')])
      .then(([u, c]) => { setUploads(u.sort((a, b) => b.mtime.localeCompare(a.mtime))); setCostItems(c); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [])

  useEffect(() => { void load() }, [load])

  async function deleteFile(f: UploadInfo) {
    const ok = await confirm({
      title: 'Beleg endgültig löschen?',
      message: `„${invoiceLabel(f.file)}" wird unwiderruflich von der Festplatte entfernt.`,
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

  // Verknüpfte Kostenpositionen je Datei
  const linkedBy = useMemo(() => {
    const map = new Map<string, CostItem[]>()
    for (const c of costItems) {
      if (!c.invoiceFile) continue
      const arr = map.get(c.invoiceFile) ?? []
      arr.push(c)
      map.set(c.invoiceFile, arr)
    }
    return map
  }, [costItems])

  // Duplikat-Heuristik: gleiche Dateigröße (vermutlich dieselbe Datei doppelt hochgeladen)
  // oder gleicher Rechnungssteller + gleiche Summe + gleiches Jahr (doppelt erfasst).
  const duplicateHint = useMemo(() => {
    const hints = new Map<string, string>()
    for (const f of uploads) {
      const twin = uploads.find((o) => o.file !== f.file && o.size === f.size)
      if (twin) {
        hints.set(f.file, `gleiche Dateigröße wie „${invoiceLabel(twin.file)}" — möglicherweise doppelt hochgeladen`)
        continue
      }
      const linked = linkedBy.get(f.file) ?? []
      if (linked.length === 0) continue
      const vendor = linked.find((c) => c.vendor)?.vendor?.toLowerCase()
      const sum = linked.reduce((a, c) => a + c.amountCents, 0)
      const year = linked[0].year
      if (!vendor) continue
      for (const [other, oLinked] of linkedBy) {
        if (other === f.file) continue
        const oVendor = oLinked.find((c) => c.vendor)?.vendor?.toLowerCase()
        const oSum = oLinked.reduce((a, c) => a + c.amountCents, 0)
        if (oVendor === vendor && oSum === sum && oLinked[0].year === year) {
          hints.set(f.file, `gleicher Rechnungssteller, gleiche Summe und gleiches Jahr wie „${invoiceLabel(other)}" — möglicherweise doppelt erfasst`)
          break
        }
      }
    }
    return hints
  }, [uploads, linkedBy])

  const orphans = uploads.filter((f) => !(linkedBy.get(f.file)?.length))

  return (
    <>
      <PageHeader
        title="Belegarchiv"
        subtitle="Alle hochgeladenen Belege mit ihrem Zuordnungsstatus. Nicht zugeordnete Dateien (z. B. aus abgebrochenen Auswertungen) können hier aufgeräumt werden."
      />
      {error && <div className="error">{error}</div>}

      {orphans.length > 0 && (
        <div className="notice">
          {orphans.length} Beleg{orphans.length > 1 ? 'e sind' : ' ist'} keiner Kostenposition
          zugeordnet — auf der Seite „Kosten &amp; Belege" lassen sich vorhandene Belege nachträglich
          zuordnen, oder hier löschen.
        </div>
      )}

      <div className="card">
        {uploads.length === 0 ? (
          <div className="empty">Noch keine Belege hochgeladen.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Beleg</th>
                <th>Hochgeladen</th>
                <th className="num">Größe</th>
                <th>Verknüpfte Kostenpositionen</th>
                <th className="sr-only">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((f) => {
                const linked = linkedBy.get(f.file) ?? []
                const sum = linked.reduce((a, c) => a + c.amountCents, 0)
                const years = [...new Set(linked.map((c) => c.year))].sort().join(', ')
                const dup = duplicateHint.get(f.file)
                return (
                  <tr key={f.file}>
                    <td>
                      <a href={`/uploads/${encodeURIComponent(f.file)}`} target="_blank" rel="noreferrer">
                        {invoiceLabel(f.file)}
                      </a>
                      {dup && <div className="muted" style={{ color: 'var(--amber)' }}>⚠ {dup}</div>}
                    </td>
                    <td className="muted">{fmtDateTime(f.mtime)}</td>
                    <td className="num muted">{fmtSize(f.size)}</td>
                    <td>
                      {linked.length === 0 ? (
                        <span className="badge gray">nicht zugeordnet</span>
                      ) : (
                        <>
                          <span className="badge green">{linked.length} Position{linked.length > 1 ? 'en' : ''}</span>{' '}
                          <span className="muted">{years} · {fmtEuro(sum)}{linked.find((c) => c.vendor) ? ` · ${linked.find((c) => c.vendor)!.vendor}` : ''}</span>
                        </>
                      )}
                    </td>
                    <td className="actions">
                      {linked.length === 0 && (
                        <button className="icon-btn danger" title="Löschen" aria-label="Beleg löschen" onClick={() => void deleteFile(f)}>🗑</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
