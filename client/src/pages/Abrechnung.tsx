import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { CostItem, Settings, Settlement, SettlementRow, Tenancy, Unit } from '../types'
import { api, fmtDate, fmtEuro, parseEuro } from '../api'
import { invoiceLabel, renderInvoicePages } from '../pdfPreview'

type Props = { settings: Settings | null; units: Unit[]; tenancies: Tenancy[]; reload: () => Promise<void> }

export default function Abrechnung({ settings, tenancies, reload }: Props) {
  const [year, setYear] = useState(new Date().getFullYear() - 1)
  const [data, setData] = useState<Settlement | null>(null)
  const [error, setError] = useState('')
  const [printId, setPrintId] = useState<string | null>(null)
  const [ppEdit, setPpEdit] = useState<{ tenancyId: string; value: string } | null>(null)
  const [costItems, setCostItems] = useState<CostItem[]>([])
  const [attachmentPages, setAttachmentPages] = useState<Record<string, string[]>>({})
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)

  const printAdjust = settings?.printAdjustSuggestion !== false // Standard: an
  const printAttachments = settings?.printAttachments === true // Standard: aus

  const load = useCallback(() => {
    return Promise.all([
      api<Settlement>(`/api/settlement/${year}`),
      api<CostItem[]>('/api/costItems'),
    ])
      .then(([d, c]) => { setData(d); setCostItems(c); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [year])

  useEffect(() => { void load() }, [load])

  // Druckoptionen direkt in den Einstellungen merken
  async function saveSetting(patch: Partial<Settings>) {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) })
    await reload()
  }

  // Beleg-Dateien des Jahres (in Erfassungsreihenfolge, ohne Duplikate)
  const invoiceFiles = useMemo(
    () => [...new Set(costItems.filter((c) => c.year === year && c.invoiceFile).map((c) => c.invoiceFile!))],
    [costItems, year],
  )

  // Sprechende Anlagen-Beschriftung aus den verknüpften Kostenpositionen
  // (Rechnungssteller + Kostenarten) statt des technischen Dateinamens.
  function fileLabel(f: string): string {
    const linked = costItems.filter((c) => c.year === year && c.invoiceFile === f)
    const vendor = linked.find((c) => c.vendor)?.vendor
    const cats = [...new Set(linked.map((c) => c.category))].join(', ')
    if (vendor && cats) return `${vendor} — ${cats}`
    return vendor || cats || invoiceLabel(f)
  }

  // Belegseiten vorab rendern, sobald der Andruck aktiviert ist — der Druckdialog
  // wartet nicht auf asynchrones Rendering.
  useEffect(() => {
    if (!printAttachments) return
    const missing = invoiceFiles.filter((f) => !attachmentPages[f])
    if (missing.length === 0) return
    let alive = true
    setAttachmentsLoading(true)
    void (async () => {
      for (const f of missing) {
        const pages = await renderInvoicePages(f).catch(() => [])
        if (!alive) return
        setAttachmentPages((prev) => ({ ...prev, [f]: pages }))
      }
    })().finally(() => { if (alive) setAttachmentsLoading(false) })
    return () => { alive = false }
  }, [printAttachments, invoiceFiles, attachmentPages])

  // Tatsächlich gezahlte Vorauszahlungen für ein Jahr festhalten (Korrektur) bzw. zurücksetzen
  async function savePpOverride(tenancyId: string, cents: number | null) {
    const ten = tenancies.find((t) => t.id === tenancyId)
    const overrides = { ...(ten?.prepaymentOverrides ?? {}) }
    if (cents === null) delete overrides[String(year)]
    else overrides[String(year)] = cents
    await api(`/api/tenancies/${tenancyId}`, { method: 'PUT', body: JSON.stringify({ prepaymentOverrides: overrides }) })
    setPpEdit(null)
    await Promise.all([load(), reload()])
  }

  useEffect(() => {
    if (!printId) return
    document.body.classList.add('print-one')
    // Browser verwenden document.title als Dateinamen beim „Als PDF speichern"
    const prevTitle = document.title
    const st = data?.statements.find((s) => s.tenancyId === printId)
    if (st) document.title = `Nebenkostenabrechnung ${year} ${st.unitName} ${st.tenantName}`.replace(/[\\/:*?"<>|]/g, '-')
    const done = () => {
      document.body.classList.remove('print-one')
      document.title = prevTitle
      setPrintId(null)
    }
    window.addEventListener('afterprint', done)
    const t = setTimeout(() => window.print(), 80)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', done)
      document.body.classList.remove('print-one')
      document.title = prevTitle
    }
  }, [printId, data, year])

  const distributed = data ? data.totalCostsCents - data.landlord.totalCents : 0

  // §556 Abs. 3 BGB: Die Abrechnung muss dem Mieter binnen 12 Monaten nach Ende des
  // Abrechnungszeitraums zugehen, sonst sind Nachforderungen ausgeschlossen.
  const deadline = new Date(Date.UTC(year + 1, 11, 31))
  const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86400000)

  return (
    <>
      <div className="no-print">
        <h1>Abrechnung</h1>
        <p className="sub">Die fertige Nebenkostenabrechnung pro Mieter — als PDF speichern über „Drucken".</p>
      </div>
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
          <label className="field checkline" title="Absatz mit dem Vorschlag zur Anpassung der monatlichen Vorauszahlung (§560 Abs. 4 BGB) andrucken">
            <span>
              <input
                type="checkbox"
                checked={printAdjust}
                onChange={(e) => void saveSetting({ printAdjustSuggestion: e.target.checked })}
              />{' '}
              Neue Vorauszahlung vorschlagen (§560 BGB)
            </span>
          </label>
          <label className="field checkline" title="Kopien der hochgeladenen Beleg-PDFs als Anlage hinter jeder Abrechnung mit ausdrucken">
            <span>
              <input
                type="checkbox"
                checked={printAttachments}
                onChange={(e) => void saveSetting({ printAttachments: e.target.checked })}
              />{' '}
              Belegkopien als Anlage andrucken
              {printAttachments && attachmentsLoading && <span className="muted"> (werden vorbereitet …)</span>}
            </span>
          </label>
        </div>
      </div>

      {data && data.totalCostsCents > 0 && (
        <div className={daysLeft < 0 ? 'error no-print' : daysLeft < 90 ? 'notice no-print' : 'ok no-print'}>
          {daysLeft >= 0 ? (
            <>Abrechnungsfrist (§556 BGB): Die Abrechnung {year} muss dem Mieter bis zum <strong>31.12.{year + 1}</strong> zugehen — noch {daysLeft} Tage.</>
          ) : (
            <>Die Abrechnungsfrist für {year} ist am 31.12.{year + 1} abgelaufen — Nachforderungen sind in der Regel ausgeschlossen (Guthaben des Mieters bleiben fällig).</>
          )}
        </div>
      )}
      {data?.warnings.map((w, i) => (
        <div key={i} className="notice no-print">{w}</div>
      ))}

      {data && (
        <>
          <div className="kpis no-print">
            <div className="kpi">
              <div className="v">{fmtEuro(data.totalCostsCents)}</div>
              <div className="l">Gesamtkosten {year}</div>
            </div>
            <div className="kpi">
              <div className="v">{fmtEuro(distributed)}</div>
              <div className="l">auf Mieter umgelegt</div>
            </div>
            <div className="kpi">
              <div className="v">{fmtEuro(data.landlord.totalCents)}</div>
              <div className="l">Vermieteranteil</div>
            </div>
          </div>

          {data.statements.length === 0 && (
            <div className="card"><div className="empty">Keine Mietverhältnisse im Jahr {year} — bitte Stammdaten prüfen.</div></div>
          )}

          {data.statements.map((st) => {
            // Belege, die in dieser Abrechnung tatsächlich vorkommen (für die Anlage)
            const stFiles = printAttachments
              ? [...new Set(st.rows
                  .map((r) => costItems.find((c) => c.id === r.costItemId)?.invoiceFile)
                  .filter((f): f is string => !!f))]
              : []
            const attachmentsReady = stFiles.every((f) => attachmentPages[f])
            // Positionen nach Kostenart gruppieren — mit Zwischensumme, sobald eine
            // Kostenart mehrere Positionen hat (erleichtert den Abgleich mit dem Bescheid).
            const groups: { category: string; rows: SettlementRow[] }[] = []
            for (const r of st.rows) {
              const g = groups.find((x) => x.category === r.category)
              if (g) g.rows.push(r)
              else groups.push({ category: r.category, rows: [r] })
            }
            return (
            <div key={st.tenancyId} className={`card statement ${printId === st.tenancyId ? 'print-target' : ''}`}>
              <div className="muted" style={{ marginBottom: 8 }}>
                {settings?.landlordName && <>{settings.landlordName} · </>}
                {settings?.houseName} · {settings?.address}
              </div>
              <div className="statement-head">
                <div>
                  <h2 style={{ marginBottom: 2 }}>Nebenkostenabrechnung {year}</h2>
                  <div className="muted">
                    {st.tenantName} · {st.unitName} · {st.persons} Person(en) ·
                    Zeitraum {fmtDate(st.periodStart)} – {fmtDate(st.periodEnd)} ({st.days} Tage)
                  </div>
                </div>
                <button
                  className="btn secondary no-print"
                  disabled={printAttachments && !attachmentsReady}
                  title={printAttachments && !attachmentsReady ? 'Belegkopien werden noch vorbereitet …' : undefined}
                  onClick={() => setPrintId(st.tenancyId)}
                >
                  🖨 Drucken / PDF
                </button>
              </div>

              {st.rows.length === 0 ? (
                <div className="empty">Keine Kostenpositionen für {year} erfasst.</div>
              ) : (
                <table style={{ marginTop: 14 }}>
                  <thead>
                    <tr>
                      <th>Kostenart</th>
                      <th className="num">Gesamtkosten</th>
                      <th>Verteilung</th>
                      <th className="num">Ihr Anteil</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <Fragment key={g.category}>
                        {g.rows.map((r, i) => (
                          <tr key={i}>
                            <td>
                              {r.category}
                              {r.description !== r.category && <div className="muted">{r.description}</div>}
                            </td>
                            <td className="num">{fmtEuro(r.totalCents)}</td>
                            <td>
                              {r.keyLabel}
                              {r.basisText && <div className="muted">{r.basisText}</div>}
                            </td>
                            <td className="num">{fmtEuro(r.shareCents)}</td>
                          </tr>
                        ))}
                        {g.rows.length > 1 && (
                          <tr className="subtotal">
                            <td>Summe {g.category}</td>
                            <td className="num">{fmtEuro(g.rows.reduce((a, r) => a + r.totalCents, 0))}</td>
                            <td />
                            <td className="num">{fmtEuro(g.rows.reduce((a, r) => a + r.shareCents, 0))}</td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Summe Ihrer Betriebskosten</td>
                      <td className="num">{fmtEuro(st.totalShareCents)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ fontWeight: 400 }}>
                        abzüglich geleisteter Vorauszahlungen
                        {st.prepaymentOverridden && <span className="muted"> (manuell angepasst)</span>}
                        <span className="no-print">
                          {' '}
                          {ppEdit?.tenancyId === st.tenancyId ? (
                            <>
                              <input
                                value={ppEdit.value}
                                onChange={(e) => setPpEdit({ tenancyId: st.tenancyId, value: e.target.value })}
                                style={{ width: 100, textAlign: 'right', padding: '3px 6px' }}
                                autoFocus
                              />{' '}
                              <button className="btn small" onClick={() => { const c = parseEuro(ppEdit.value); if (c !== null) void savePpOverride(st.tenancyId, c) }}>OK</button>{' '}
                              <button className="btn small ghost" onClick={() => setPpEdit(null)}>Abbrechen</button>
                            </>
                          ) : (
                            <>
                              <button
                                className="btn small ghost"
                                title="Tatsächlich gezahlten Betrag erfassen (z. B. bei ausgefallenen Zahlungen)"
                                onClick={() => setPpEdit({ tenancyId: st.tenancyId, value: (st.prepaymentCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) })}
                              >
                                ✎ anpassen
                              </button>
                              {st.prepaymentOverridden && (
                                <button className="btn small ghost" onClick={() => void savePpOverride(st.tenancyId, null)}>zurücksetzen</button>
                              )}
                            </>
                          )}
                        </span>
                      </td>
                      <td className="num" style={{ fontWeight: 400 }}>− {fmtEuro(st.prepaymentCents)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3}>
                        {st.balanceCents >= 0 ? 'Guthaben zu Ihren Gunsten' : 'Nachzahlung zu Ihren Lasten'}
                      </td>
                      <td className="num">
                        <span className={`saldo ${st.balanceCents >= 0 ? '' : ''}`} style={{ color: st.balanceCents >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {fmtEuro(Math.abs(st.balanceCents))}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
              {st.rows.length > 0 && (
                <>
                  <p style={{ marginTop: 16 }}>
                    {st.balanceCents < 0 ? (
                      <>
                        Es ergibt sich eine <strong>Nachzahlung von {fmtEuro(-st.balanceCents)}</strong>.
                        Bitte überweisen Sie den Betrag innerhalb von {settings?.paymentDeadlineDays || 30} Tagen
                        nach Zugang dieser Abrechnung
                        {settings?.iban ? <> auf das Konto <strong>{settings.iban}</strong>{settings?.landlordName ? ` (${settings.landlordName})` : ''}</> : null}.
                      </>
                    ) : (
                      <>
                        Es ergibt sich ein <strong>Guthaben von {fmtEuro(st.balanceCents)}</strong>.
                        Der Betrag wird Ihnen erstattet bzw. mit der nächsten Mietzahlung verrechnet.
                      </>
                    )}
                  </p>
                  {printAdjust && st.suggestedMonthlyCents > 0 && (
                    <p>
                      Auf Basis dieser Abrechnung wird die monatliche Nebenkostenvorauszahlung gemäß
                      §560 Abs. 4 BGB ab dem übernächsten Monat auf <strong>{fmtEuro(st.suggestedMonthlyCents)}</strong> angepasst
                      (ein Zwölftel Ihrer Jahreskosten, gerundet).
                    </p>
                  )}
                  {st.total35aCents > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <strong>Bescheinigung nach §35a EStG</strong>
                      <p className="muted" style={{ margin: '4px 0 8px' }}>
                        In Ihrem Kostenanteil sind folgende Arbeitskosten für haushaltsnahe
                        Dienstleistungen/Handwerkerleistungen enthalten, die Sie ggf. steuerlich
                        geltend machen können:
                      </p>
                      <table>
                        <tbody>
                          {st.rows.filter((r) => (r.labor35aCents ?? 0) > 0).map((r, i) => (
                            <tr key={i}>
                              <td>{r.category} — {r.description}</td>
                              <td className="num">{fmtEuro(r.labor35aCents!)}</td>
                            </tr>
                          ))}
                          <tr>
                            <td style={{ fontWeight: 700 }}>Summe §35a-Arbeitskosten (Ihr Anteil)</td>
                            <td className="num" style={{ fontWeight: 700 }}>{fmtEuro(st.total35aCents)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
              <p className="muted" style={{ marginTop: 14 }}>
                Abrechnung nach dem Abflussprinzip (im Abrechnungsjahr gezahlte Rechnungen).
                {printAttachments && stFiles.length > 0
                  ? ` Kopien der zugrunde liegenden Belege sind als Anlage beigefügt (${stFiles.length} Beleg${stFiles.length > 1 ? 'e' : ''}).`
                  : ' Die zugrunde liegenden Belege können nach Terminvereinbarung eingesehen werden.'}
              </p>
              {printAttachments && stFiles.length > 0 && (
                <>
                  <div className="muted no-print">
                    Anlage beim Druck: {stFiles.map(fileLabel).join(' · ')}
                  </div>
                  <div className="print-only attachments">
                    {stFiles.map((f, idx) => (
                      <div key={f} className="attachment">
                        <div className="attachment-caption">
                          Anlage {idx + 1} zur Nebenkostenabrechnung {year}: {fileLabel(f)}
                        </div>
                        {(attachmentPages[f] ?? []).map((src, i) => (
                          <img key={i} src={src} alt={`${fileLabel(f)} — Seite ${i + 1}`} />
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            )
          })}

          {data.landlord.rows.length > 0 && (
            <div className="card no-print">
              <h2>Vermieteranteil (nicht umgelegt)</h2>
              <table>
                <thead>
                  <tr>
                    <th>Kostenart</th>
                    <th className="num">Gesamtkosten</th>
                    <th>Grund</th>
                    <th className="num">Ihr Anteil</th>
                  </tr>
                </thead>
                <tbody>
                  {data.landlord.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.category}<div className="muted">{r.description}</div></td>
                      <td className="num">{fmtEuro(r.totalCents)}</td>
                      <td className="muted">{r.category === 'Nicht umlagefähig' ? 'nicht umlagefähig' : 'Leerstand / Rundung / keine Verteilbasis'}</td>
                      <td className="num">{fmtEuro(r.shareCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Summe Vermieteranteil</td>
                    <td className="num">{fmtEuro(data.landlord.totalCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
