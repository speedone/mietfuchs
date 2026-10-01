import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CostItem, UploadInfo, Property } from '../types'
import { withProperty, useProperty } from '../property'
import { useYear, YEAR_OPTIONS } from '../year'
import { api, errorText, fmtEuro, fmtDate } from '../api'
import { renderThumbnail } from '../pdfPreview'
import { buildFolder, coverage, duplicateHints, receiptCards, receiptName, type FolderFilter, type ReceiptCard } from '../receipts'
import PageHeader from '../components/PageHeader'
import { useToast, useConfirm } from '../components/feedback'

const fmtSize = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} kB`

const fmtDay = (iso: string) => fmtDate(iso.slice(0, 10))

// Vorschaubild eines Belegs. PDFs rendert pdf.js klein, Bilder zeigt der Browser selbst. Scheitert
// das Rendern (passwortgeschützt, beschädigt), bleibt ein Platzhalter: Der Beleg ist trotzdem da.
function Thumb({ upload, render }: { upload: UploadInfo; render: typeof renderThumbnail }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    render(upload.file, upload.mimeType).then((s) => { if (live) setSrc(s) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [upload.file, upload.mimeType, render])
  return (
    <a className="receipt-thumb" href={`/uploads/${encodeURIComponent(upload.file)}`} target="_blank" rel="noreferrer" aria-label={`${receiptName(upload)} öffnen`}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span aria-hidden="true">{failed ? '📄' : '…'}</span>}
    </a>
  )
}

type Props = {
  // Für Tests: ohne pdf.js
  renderThumb?: typeof renderThumbnail
}

export default function Belege({ renderThumb = renderThumbnail }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const { year: currentYear } = useYear()
  const { property, properties } = useProperty()
  const [uploads, setUploads] = useState<UploadInfo[]>([])
  const [costItems, setCostItems] = useState<CostItem[]>([])
  const [error, setError] = useState('')
  // Voreinstellung: das gewählte Objekt und das Abrechnungsjahr (#170). Umschalten wirkt nur
  // hier; das Objekt der übrigen Seiten bleibt, wie es ist.
  const [filterProperty, setFilterProperty] = useState<string>(property?.id ?? 'all')
  const [filterYear, setFilterYear] = useState<string>(String(currentYear))
  const [query, setQuery] = useState('')

  useEffect(() => { if (property) setFilterProperty(property.id) }, [property?.id])
  useEffect(() => { setFilterYear(String(currentYear)) }, [currentYear])

  const load = useCallback(() => {
    // Der Belegordner gilt für die ganze Installation (#92). Welche Belege an einer Kostenposition
    // hängen, wird deshalb über alle Objekte gefragt, je Objekt einzeln: Die Routen grenzen immer
    // auf ein Objekt ein, eine zweite Regel „alle“ gibt es dort bewusst nicht.
    const allItems = () =>
      api<Property[]>('/api/properties')
        .then((list) => Promise.all(list.map((p) => api<CostItem[]>(withProperty('/api/costItems', p.id)))))
        .then((lists) => lists.flat())
    return Promise.all([api<UploadInfo[]>('/api/uploads'), allItems()])
      .then(([u, c]) => { setUploads(u.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))); setCostItems(c); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [])

  useEffect(() => { void load() }, [load])

  // Ein Objekt, das es nicht (mehr) gibt, gilt als „alle“, damit das Auswahlfeld nie etwas
  // anderes zeigt, als gefiltert wird.
  const shownProperty = filterProperty === 'all' || properties.some((p) => p.id === filterProperty) ? filterProperty : 'all'
  const filter: FolderFilter = useMemo(() => ({
    propertyId: properties.length > 1 ? shownProperty : 'all',
    year: filterYear === 'all' ? 'all' : Number(filterYear),
  }), [shownProperty, filterYear, properties.length])
  const folder = useMemo(() => buildFolder(uploads, costItems, filter, query), [uploads, costItems, filter, query])
  const hints = useMemo(() => duplicateHints(receiptCards(uploads, costItems)), [uploads, costItems])
  const present = useMemo(() => new Set(uploads.map((u) => u.file)), [uploads])
  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name || 'Ohne Namen'
  const showProperty = filter.propertyId === 'all' && properties.length > 1
  // Die Jahre der Auswahl: die üblichen, dazu jedes Jahr, in dem es Positionen gibt
  const yearOptions = useMemo(
    () => [...new Set([...YEAR_OPTIONS, currentYear, ...costItems.map((c) => c.year)])].sort((a, b) => b - a),
    [costItems, currentYear],
  )

  // Belegabdeckung (#170): je Objekt der Auswahl, bei „alle Objekte“ also eine Zeile je Objekt
  const coverageRows = useMemo(() => {
    const ids = filter.propertyId === 'all' ? (properties.length > 0 ? properties.map((p) => p.id) : [...new Set(costItems.map((c) => c.propertyId))]) : [filter.propertyId]
    return ids
      .map((id) => ({ id, cov: coverage(costItems, { propertyId: properties.length > 1 ? id : 'all', year: filter.year }, present) }))
      .filter((r) => r.cov.positions > 0)
  }, [costItems, filter, present, properties])

  // „Nachreichen“: einen Beleg an eine Position hängen, neu hochgeladen oder aus den Belegen, die
  // an keiner Position hängen. Hochgeladen wird mit Objekt und Jahr der Position, damit der Beleg
  // dort im Posteingang steht, falls das Verknüpfen danach scheitert.
  async function attach(c: CostItem, invoiceFile: string) {
    await api(`/api/costItems/${encodeURIComponent(c.id)}`, { method: 'PUT', body: JSON.stringify({ invoiceFile }) })
  }
  async function uploadFor(c: CostItem, f: File) {
    const fd = new FormData()
    fd.append('file', f)
    fd.append('propertyId', c.propertyId)
    fd.append('year', String(c.year))
    try {
      const res = await api<{ file: string }>('/api/upload', { method: 'POST', body: fd })
      await attach(c, res.file)
      await load()
      toast(`Beleg an „${c.description}“ angehängt.`)
    } catch (e) {
      setError(`Der Beleg wurde nicht angehängt: ${errorText(e)}`)
    }
  }
  async function attachExisting(c: CostItem, file: string) {
    try {
      await attach(c, file)
      await load()
      toast(`Beleg an „${c.description}“ angehängt.`)
    } catch (e) {
      setError(`Der Beleg wurde nicht angehängt: ${errorText(e)}`)
    }
  }

  async function deleteFile(f: UploadInfo) {
    const ok = await confirm({
      title: 'Beleg endgültig löschen?',
      message: `„${receiptName(f)}" wird unwiderruflich von der Festplatte entfernt.`,
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
          {card.items.length > 0 ? (
            <ul className="receipt-items">
              {card.items.map((c) => (
                <li key={c.id}>→ {c.description} {c.year} · {fmtEuro(c.amountCents)}</li>
              ))}
            </ul>
          ) : (
            <span className="badge gray">nicht zugeordnet</span>
          )}
          {dup && <div className="receipt-hint">⚠ {dup}</div>}
        </div>
        {card.items.length === 0 && (
          <button className="icon-btn danger" title="Löschen" aria-label={`Beleg ${receiptName(upload)} löschen`} onClick={() => void deleteFile(upload)}>🗑</button>
        )}
      </li>
    )
  }

  return (
    <>
      <PageHeader
        title="Belegordner"
        subtitle="Ihre Belege wie im Ordner aus Papier: je Objekt und Jahr, mit einem Register je Kostenart. Belege, die an keiner Position hängen, stehen unten."
      />
      {error && <div className="error">{error}</div>}

      <div className="card no-print">
        <div className="row receipt-filters">
          {properties.length > 1 && (
            <label className="field">
              Objekt
              <select value={shownProperty} onChange={(e) => setFilterProperty(e.target.value)}>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name || 'Ohne Namen'}</option>)}
                <option value="all">alle Objekte</option>
              </select>
            </label>
          )}
          <label className="field">
            Jahr
            <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
              {yearOptions.map((y) => <option key={y} value={String(y)}>{y}</option>)}
              <option value="all">alle Jahre</option>
            </select>
          </label>
          <label className="field grow">
            Suche
            <input
              type="search"
              value={query}
              placeholder="Rechnungssteller, Beschreibung, Betrag (z. B. 128,40), Dateiname oder Jahr"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      </div>

      {coverageRows.length > 0 && (
        <div className="card receipt-coverage">
          {coverageRows.map(({ id, cov }) => {
            const ohne = cov.positions - cov.covered
            return (
              <div key={id} className="receipt-coverage-row">
                <span>Belegabdeckung {filter.year === 'all' ? '' : `${filter.year} `}{coverageRows.length > 1 || showProperty ? `· ${propertyName(id)}` : ''}</span>
                <span className="progress" aria-hidden="true"><span className="progress-fill" style={{ width: `${cov.percent}%`, display: 'block' }} /></span>
                <strong>{cov.percent} %</strong>
                <span className="muted">{ohne === 0 ? 'alle Positionen belegt' : `${ohne} Position${ohne > 1 ? 'en' : ''} ohne Beleg`}</span>
              </div>
            )
          })}
        </div>
      )}

      {folder.groups.length === 0 ? (
        <div className="card"><div className="empty">{query.trim() ? 'Nichts gefunden.' : 'Für diese Auswahl sind keine Kosten erfasst.'}</div></div>
      ) : (
        folder.groups.map((g) => {
          const ohne = g.items.filter((c) => !c.invoiceFile || !present.has(c.invoiceFile)).length
          return (
            <details key={g.key} className="card receipt-group" open>
              <summary>
                <span className="receipt-group-title">{filter.year === 'all' ? `${g.year} · ` : ''}{g.category}</span>
                <span className="num">{fmtEuro(g.sumCents)}</span>
                {ohne === 0
                  ? <span className="badge green">✓ {g.items.length === 1 ? 'Beleg vorhanden' : 'alle Belege vorhanden'}</span>
                  : <span className="badge amber">⚠ {ohne} von {g.items.length} Position{g.items.length > 1 ? 'en' : ''} ohne Beleg</span>}
              </summary>
              {g.cards.length > 0 && <ul className="receipt-list">{g.cards.map(renderCard)}</ul>}
              {g.missing.length > 0 && (
                <ul className="receipt-missing">
                  {g.missing.map((c) => (
                    <li key={c.id}>
                      <span>– {c.description}{showProperty ? ` (${propertyName(c.propertyId)})` : ''} · {fmtEuro(c.amountCents)} <span className="muted">ohne Beleg</span></span>
                      <span className="receipt-attach">
                        <label className="btn small">
                          Beleg nachreichen
                          <input
                            type="file"
                            className="sr-only"
                            accept="application/pdf,image/*"
                            aria-label={`Beleg für ${c.description} hochladen`}
                            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadFor(c, f) }}
                          />
                        </label>
                        {folder.unlinked.length > 0 && (
                          <select aria-label={`Vorhandenen Beleg für ${c.description} zuordnen`} value="" onChange={(e) => { if (e.target.value) void attachExisting(c, e.target.value) }}>
                            <option value="">oder vorhandenen zuordnen …</option>
                            {folder.unlinked.map((u) => <option key={u.upload.file} value={u.upload.file}>{receiptName(u.upload)}</option>)}
                          </select>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )
        })
      )}

      {folder.unlinked.length > 0 && (
        <div className="card">
          <h2>Nicht zugeordnet ({folder.unlinked.length})</h2>
          <p className="muted">
            Diese Belege hängen an keiner Kostenposition. Auf der Seite „Kosten“ lassen sie sich einer Position zuordnen, oder Sie löschen sie hier.
          </p>
          <ul className="receipt-list">{folder.unlinked.map(renderCard)}</ul>
        </div>
      )}
    </>
  )
}
