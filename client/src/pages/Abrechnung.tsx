import { useCallback, useEffect, useState } from 'react'
import type { Settings, Settlement, Tenancy, Unit } from '../types'
import { api, fmtDate, fmtEuro, parseEuro } from '../api'

type Props = { settings: Settings | null; units: Unit[]; tenancies: Tenancy[]; reload: () => Promise<void> }

export default function Abrechnung({ settings, tenancies, reload }: Props) {
  const [year, setYear] = useState(new Date().getFullYear() - 1)
  const [data, setData] = useState<Settlement | null>(null)
  const [error, setError] = useState('')
  const [printId, setPrintId] = useState<string | null>(null)
  const [ppEdit, setPpEdit] = useState<{ tenancyId: string; value: string } | null>(null)

  const load = useCallback(() => {
    return api<Settlement>(`/api/settlement/${year}`)
      .then((d) => { setData(d); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [year])

  useEffect(() => { void load() }, [load])

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
    const done = () => {
      document.body.classList.remove('print-one')
      setPrintId(null)
    }
    window.addEventListener('afterprint', done)
    const t = setTimeout(() => window.print(), 80)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', done)
      document.body.classList.remove('print-one')
    }
  }, [printId])

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

          {data.statements.map((st) => (
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
                <button className="btn secondary no-print" onClick={() => setPrintId(st.tenancyId)}>🖨 Drucken / PDF</button>
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
                    {st.rows.map((r, i) => (
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
                  {st.suggestedMonthlyCents > 0 && (
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
                Die zugrunde liegenden Belege können nach Terminvereinbarung eingesehen werden.
              </p>
            </div>
          ))}

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
