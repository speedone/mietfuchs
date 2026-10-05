import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { CostItem, HeatingSettlementInfo, NoticeSubject, PeriodKey, Settings, Settlement, SettlementRow, Tenancy, Unit } from '../types'
import {
  heatingChoices, heatingOnlyNote, heatingOverridesWith, prepaymentLabel, prepaymentSplit, recommendedDeadlineText, settlementPaths, settlementTitle,
} from '../heatingSettlementView'
import { api, errorText, fmtDate, fmtEuro, parseEuro } from '../api'
import { invoiceLabel, renderInvoicePages } from '../pdfPreview'
import { usePeriod } from '../period'
import { PeriodSelect } from '../components/PeriodSelect'
import { useOpenForm, useProperty, withProperty } from '../property'
import { effectiveLandlord, letterhead } from '../landlord'
import { landlordReasonText } from '../landlordReasons'
import { notSettledText } from '../tenancyModel'
import { deviationView } from '../deviation'
import { deadlineView, historyView, type HistoryEntry } from '../settlementHistory'
import { costBasisText, personsText } from '../statementView'
import { legalBasisLines, noticeClass, noticesOf, noticeTarget, NOTICE_LEVEL_LABELS, type NoticeTab } from '../notices'
import PageHeader from '../components/PageHeader'
import { closeSettlementTitle } from '../propertyView'
import Term from '../components/Term'
import CalcSteps from '../components/CalcSteps'
import { suggestionBasis, totalColumnLabel, totalNote } from '../calcSteps'
import { useToast, useConfirm } from '../components/feedback'
import Table from '../components/Table'
import { countOf } from '../../../shared/wording.ts'
import { calendarPeriod } from '../../../shared/period.ts'

type Props = {
  settings: Settings | null
  units: Unit[]
  tenancies: Tenancy[]
  reload: () => Promise<void>
  // Für „Hier beheben →“ an einem Hinweis (#112), mit dem betroffenen Eintrag (#142)
  onNavigate?: (tab: NoticeTab, focus?: NoticeSubject) => void
}

export default function Abrechnung({ settings, tenancies, reload, onNavigate }: Props) {
  const { key, label, param, calendar, period } = usePeriod()
  const { properties, property } = useProperty()
  const propertyId = property?.id
  // Vermieter, IBAN und Frist: am Objekt abweichend, sonst aus den Einstellungen (#92).
  const landlord = settings ? effectiveLandlord(property, settings) : null
  const toast = useToast()
  const confirm = useConfirm()
  const [data, setData] = useState<Settlement | null>(null)
  const [error, setError] = useState('')
  const [printId, setPrintId] = useState<string | null>(null)
  const [ppEdit, setPpEdit] = useState<{ tenancyId: string; value: string } | null>(null)
  // Die Korrektur der gezahlten Vorauszahlung hängt an einem Mietverhältnis dieses Objekts (#145).
  useOpenForm(ppEdit !== null)
  const [costItems, setCostItems] = useState<CostItem[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [attachmentPages, setAttachmentPages] = useState<Record<string, string[]>>({})
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  // Heizung PR 5: die Heizkostenabrechnungen nach Weg d, deren Heizperiode in diesem Zeitraum endet.
  // Gewählt ist entweder die Betriebskostenabrechnung (`null`) oder eine von ihnen.
  const [heatingList, setHeatingList] = useState<HeatingSettlementInfo[]>([])
  const [target, setTarget] = useState<{ plantId: string; period: PeriodKey } | null>(null)
  const paths = settlementPaths(param, target)
  const choices = heatingChoices(heatingList, period)
  // Ein anderer Zeitraum oder ein anderes Objekt: wieder die Betriebskostenabrechnung.
  useEffect(() => { setTarget(null) }, [param, propertyId])

  const printAdjust = settings?.printAdjustSuggestion !== false // Standard: an
  const printAttachments = settings?.printAttachments === true // Standard: aus

  const load = useCallback(() => {
    return Promise.all([
      api<Settlement>(withProperty(paths.load, propertyId)),
      api<CostItem[]>(withProperty('/api/costItems', propertyId)),
      // Frühere Abschlüsse (#56). Fehlt die Route (älterer Server), bleibt die Liste leer.
      // Nur ein älterer Server ohne die Route (404) heißt „keine“; jeder andere Fehler wird gezeigt.
      api<HistoryEntry[]>(withProperty(paths.history, propertyId)).catch((e: unknown) => {
        if (/\b404\b/.test(String((e as Error).message))) return []
        throw e
      }),
    ])
      .then(([d, c, h]) => { setData(d); setCostItems(c); setHistory(h); setError('') })
      .catch((e) => setError(String((e as Error).message)))
      .then(() => api<HeatingSettlementInfo[]>(withProperty('/api/heating-settlements', propertyId)).then(setHeatingList).catch(() => setHeatingList([])))
  }, [paths.load, paths.history, propertyId])

  useEffect(() => { void load() }, [load])

  // Druckoptionen direkt in den Einstellungen merken
  // Ein Speichern, das der Server ablehnt (#146), meldet sich oben auf der Seite, statt nur in
  // der Konsole zu stehen. Ergibt true, wenn es geklappt hat.
  async function attempt(request: () => Promise<unknown>): Promise<boolean> {
    try {
      await request()
      setError('')
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    }
  }

  async function saveSetting(patch: Partial<Settings>) {
    if (!(await attempt(() => api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) })))) return
    await reload()
  }

  // Beleg-Dateien des Jahres (in Erfassungsreihenfolge, ohne Duplikate)
  const invoiceFiles = useMemo(
    () => [...new Set(costItems.filter((c) => c.period === key && c.invoiceFile).map((c) => c.invoiceFile!))],
    [costItems, key],
  )

  // Sprechende Anlagen-Beschriftung aus den verknüpften Kostenpositionen
  // (Rechnungssteller + Kostenarten) statt des technischen Dateinamens.
  function fileLabel(f: string): string {
    const linked = costItems.filter((c) => c.period === key && c.invoiceFile === f)
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

  // Abrechnung abschließen / wieder öffnen / Versanddatum festhalten
  async function closeSettlement() {
    const ok = await confirm({
      // Bei mehreren Objekten mit Objekt (#157): Eingefroren wird nur die Abrechnung dieses Objekts.
      title: closeSettlementTitle(label, properties, property),
      message: 'Der aktuelle Berechnungsstand wird eingefroren — spätere Änderungen an Kosten oder Stammdaten ändern diese Abrechnung nicht mehr. Sie lässt sich jederzeit wieder öffnen.',
      confirmLabel: 'Abschließen',
    })
    if (!ok) return
    if (!(await attempt(() => api(withProperty(paths.close, propertyId), { method: 'POST', body: JSON.stringify({}) })))) return
    await load()
    toast(`Abrechnung ${label} abgeschlossen.`)
  }
  async function reopenSettlement() {
    const ok = await confirm({
      title: `Abrechnung ${label} wieder öffnen?`,
      message: 'Es gilt wieder die laufende Berechnung. Der bisherige Stand bleibt unter „Frühere Abschlüsse“ erhalten. Eine bereits verschickte Abrechnung sollte nur bei Fehlern neu erstellt werden.',
      confirmLabel: 'Wieder öffnen',
    })
    if (!ok) return
    if (!(await attempt(() => api(withProperty(paths.close, propertyId), { method: 'DELETE' })))) return
    await load()
    toast(`Abrechnung ${label} wieder geöffnet.`)
  }
  async function saveSentAt(sentAt: string) {
    if (!(await attempt(() => api(withProperty(paths.close, propertyId), { method: 'PUT', body: JSON.stringify({ sentAt: sentAt || null }) })))) return
    await load()
  }
  const isClosed = !!data?.closed

  // Tatsächlich gezahlte Vorauszahlungen für ein Jahr festhalten (Korrektur) bzw. zurücksetzen
  async function savePpOverride(tenancyId: string, cents: number | null) {
    const ten = tenancies.find((t) => t.id === tenancyId)
    // Die Korrektur steht unter dem Zeitraum (#208). Bei einem Kalenderobjekt nennt der Server sie
    // nach Jahreszahl, für Tabs von vor dem Update; geschickt werden hier nur Zeiträume, sonst gälten
    // die Jahreszahlen als vollständiger Stand und die neue Korrektur fiele weg.
    const overrides: Record<string, number> = Object.fromEntries(Object.entries(ten?.prepaymentOverrides ?? {})
      .map(([schluessel, betrag]) => [/^\d{4}$/.test(schluessel) ? calendarPeriod(Number(schluessel)) : schluessel, betrag]))
    if (cents === null) delete overrides[key]
    else overrides[key] = cents
    // In der Heizkostenabrechnung ist „✎ anpassen“ die endgültige Heizkorrektur der Heizperiode (D2, Heizung PR 5).
    const body = target
      ? { heatingPrepaymentOverrides: heatingOverridesWith(ten ?? {}, target.plantId, target.period, cents) }
      : { prepaymentOverrides: overrides }
    if (!(await attempt(() => api(`/api/tenancies/${tenancyId}`, { method: 'PUT', body: JSON.stringify(body) })))) return
    setPpEdit(null)
    await Promise.all([load(), reload()])
    toast(cents === null ? 'Vorauszahlung zurückgesetzt.' : 'Gezahlte Vorauszahlung übernommen.')
  }

  useEffect(() => {
    if (!printId) return
    document.body.classList.add('print-one')
    // Browser verwenden document.title als Dateinamen beim „Als PDF speichern“
    const prevTitle = document.title
    const st = data?.statements.find((s) => s.tenancyId === printId)
    if (st) document.title = `${data ? settlementTitle(data) : `Nebenkostenabrechnung ${label}`} ${st.unitName} ${st.tenantName}`.replace(/[\\/:*?"<>|]/g, '-')
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
  }, [printId, data, label])

  const distributed = data ? data.totalCostsCents - data.landlord.totalCents : 0

  // §556 Abs. 3 BGB: Die Abrechnung muss dem Mieter binnen 12 Monaten nach Ende des
  // Abrechnungszeitraums zugehen, sonst sind Nachforderungen ausgeschlossen. Nach dem
  // Wiederöffnen zählt der frühere Versand weiter (#142, siehe deadlineView). Bezeichnung und Frist
  // vom Server (#208).
  const deadlineInfo = data ? deadlineView(data.period.label, data.deadline, data.closed?.sentAt ?? null, history, new Date()) : null

  return (
    <>
      <div className="no-print">
        <PageHeader title="Abrechnung" subtitle={'Die fertige Nebenkostenabrechnung pro Mieter — als PDF speichern über „Drucken“.'} />
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card no-print">
        <div className="row">
          <PeriodSelect />
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
        {choices.length > 0 && (
          <div className="row no-print">
            <button className={target === null ? 'btn' : 'btn ghost'} onClick={() => setTarget(null)}>{`Betriebskosten ${label}`}</button>
            {choices.map((h) => (
              <button key={`${h.plantId}|${h.period.key}`} className={target?.period === h.period.key ? 'btn' : 'btn ghost'} onClick={() => setTarget({ plantId: h.plantId, period: h.period.key })}>
                {`Heizkosten ${h.period.label} (eigene Abrechnung, Frist ${fmtDate(h.deadline)})`}
              </button>
            ))}
          </div>
        )}
        {data?.separateHeating && data.separateHeating.length > 0 && target === null && (
          <div className="info no-print">{`Die Heizkosten ${data.separateHeating.map((h) => h.period.label).join(', ')} rechnen Sie getrennt ab; sie stehen nicht in dieser Abrechnung.`}</div>
        )}
      </div>

      {data && (
        <div className="card no-print">
          <div className="row" style={{ alignItems: 'center' }}>
            {isClosed ? (
              <>
                <div className="grow">
                  <span className="badge green">abgeschlossen</span>{' '}
                  <span className="muted">
                    am {fmtDate(data.closed!.closedAt.slice(0, 10))} eingefroren — Änderungen an Kosten/Stammdaten wirken sich nicht mehr aus.
                  </span>
                </div>
                <label className="field" title="Datum, an dem die Abrechnung an die Mieter ging — maßgeblich für die §556-Frist">
                  versendet am
                  <input
                    type="date"
                    value={data.closed!.sentAt ?? ''}
                    onChange={(e) => void saveSentAt(e.target.value)}
                  />
                </label>
                <button className="btn ghost" onClick={() => void reopenSettlement()}>Wieder öffnen</button>
              </>
            ) : (
              <>
                <div className="grow">
                  <span className="badge gray">Entwurf</span>{' '}
                  <span className="muted">Die Abrechnung wird laufend neu berechnet. Nach dem Versand abschließen, damit sich der Stand nicht mehr ändert.</span>
                </div>
                <button className="btn" disabled={!data || data.totalCostsCents === 0} onClick={() => void closeSettlement()}>
                  🔒 Abrechnung {label} abschließen
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {data && deadlineInfo && data.totalCostsCents > 0 && (
        <div className={`${deadlineInfo.level} no-print`}>{deadlineInfo.text}</div>
      )}
      {history.length > 0 && (
        <details className="settlement-history no-print">
          <summary>Frühere Abschlüsse dieses Jahres ({history.length})</summary>
          <div className="muted">Beim Wiederöffnen bleibt der bisherige Stand erhalten; hier stehen die früheren, der zuletzt wiedergeöffnete zuerst.</div>
          {historyView(history).map((h) => (
            <div key={h.id} className="settlement-history-entry">
              <strong>{h.head}</strong>
              <ul>{h.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
          ))}
        </details>
      )}
      {data?.closed && (() => {
        // Abgeschlossenes Jahr gegen die heutige Berechnung (#56): erklären, nicht drängen.
        const view = deviationView(data.deviation)
        if (!view) return null
        return (
          <div className="notice no-print notice-item">
            <div className="notice-head"><strong>{view.title}</strong></div>
            <div>{view.intro}</div>
            {view.lines.length > 0 && <ul className="deviation-list">{view.lines.map((l) => <li key={l.id}>{l.text}</li>)}</ul>}
          </div>
        )
      })()}
      {data && noticesOf(data).map((n, i) => {
        const target = noticeTarget(n.subject)
        return (
          <div key={i} className={`${noticeClass(n.level)} no-print notice-item`}>
            {n.title && (
              <div className="notice-head">
                <span className="notice-level">{NOTICE_LEVEL_LABELS[n.level]}</span> <strong>{n.title}</strong>
              </div>
            )}
            <div>{n.text}</div>
            {n.terms && n.terms.length > 0 && (
              <div className="notice-terms">Begriffe: {n.terms.map((t, k) => <Fragment key={t}>{k > 0 && ', '}<Term id={t} /></Fragment>)}</div>
            )}
            {target && onNavigate && (
              <button type="button" className="btn secondary notice-action" onClick={() => onNavigate(target.tab, target.focus)}>{target.label}</button>
            )}
          </div>
        )
      })}
      {data && (() => {
        const basis = legalBasisLines(data.legalBasis)
        return (
          <details className="legal-basis no-print">
            <summary>{basis.head}</summary>
            {basis.rules.length > 0 ? (
              <ul>{basis.rules.map((r) => <li key={r}>{r}</li>)}</ul>
            ) : (
              data.legalBasis && <p>Für dieses Jahr wendet Mietfuchs keine besondere Rechtsregel an.</p>
            )}
            {basis.values.length > 0 && (
              <>
                <p>Angewandte Rechtswerte:</p>
                <ul>{basis.values.map((v) => <li key={v}>{v}</li>)}</ul>
              </>
            )}
            {basis.valuesNote && <p>{basis.valuesNote}</p>}
          </details>
        )
      })()}

      {data && (
        <>
          <div className="kpis no-print">
            <div className="kpi">
              <div className="v">{fmtEuro(data.totalCostsCents)}</div>
              <div className="l">Gesamtkosten {label}</div>
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

          {data.statements.length === 0 && (data.notSettled ?? []).length === 0 && (
            <div className="card"><div className="empty">Keine Mietverhältnisse im {calendar ? 'Jahr' : 'Zeitraum'} {label} — bitte Stammdaten prüfen.</div></div>
          )}

          {/* Mietverhältnisse mit Pauschale oder Inklusivmiete bekommen keine Abrechnung (#93);
              sie werden genannt statt still zu fehlen. */}
          {(data.notSettled ?? []).length > 0 && (
            <div className="card no-print">
              <h2>Ohne Abrechnung</h2>
              <p className="muted">
                Für diese Mietverhältnisse ist eine Pauschale oder Inklusivmiete vereinbart. Ihr Anteil an den Kosten
                bleibt beim Vermieter und zählt als Werbungskosten.
              </p>
              <ul>
                {(data.notSettled ?? []).map((n) => <li key={n.tenancyId}>{notSettledText(n)}</li>)}
              </ul>
            </div>
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
                {letterhead(landlord?.landlordName, property)}
              </div>
              <div className="statement-head">
                <div>
                  <h2 style={{ marginBottom: 2 }}>{data ? settlementTitle(data) : `Nebenkostenabrechnung ${label}`}</h2>
                  <div className="muted">
                    {st.tenantName} · {st.unitName} · {personsText(st, tenancies.find((t) => t.id === st.tenancyId))} ·
                    Zeitraum {fmtDate(st.periodStart)} – {fmtDate(st.periodEnd)} ({countOf(st.days, 'Tag', 'Tage')})
                  </div>
                  {heatingOnlyNote(st) && <p>{heatingOnlyNote(st)}</p>}
                  {recommendedDeadlineText(st) && <p className="muted no-print">{recommendedDeadlineText(st)}</p>}
                  {st.prepaymentNote && <p className="muted">{st.prepaymentNote}</p>}
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
                <div className="empty">Keine Kostenpositionen für {label} erfasst.</div>
              ) : (
                <Table style={{ marginTop: 14 }}>
                  <thead>
                    <tr>
                      <th>Kostenart</th>
                      <th className="num">{totalColumnLabel(st.rows)}</th>
                      <th>Verteilung</th>
                      <th className="num">Ihr Anteil</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <Fragment key={g.category}>
                        {g.rows.map((r) => (
                          <CalcSteps key={r.costItemId} row={r} colSpan={4}>
                            {(toggle) => (
                              <tr>
                                <td>
                                  {r.category}
                                  {r.description !== r.category && <div className="muted">{r.description}</div>}
                                </td>
                                <td className="num">
                                  {fmtEuro(r.totalCents)}
                                  {totalNote(r) && <div className="muted">{totalNote(r)}</div>}
                                </td>
                                <td>
                                  {r.keyLabel}
                                  {r.basisText && <div className="muted">{r.basisText}</div>}
                                  {toggle}
                                </td>
                                <td className="num">{fmtEuro(r.shareCents)}</td>
                              </tr>
                            )}
                          </CalcSteps>
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
                        {prepaymentLabel(st)}
                        {/* Ein Vermerk für den Vermieter, nicht für den Mieter (#142): nur am Bildschirm. */}
                        {st.prepaymentOverridden && <span className="muted no-print"> (manuell angepasst)</span>}
                        {!isClosed && <span className="no-print">
                          {' '}
                          {ppEdit?.tenancyId === st.tenancyId ? (
                            <>
                              {/* Esc verwirft, Enter übernimmt (#142), wie im Drawer. */}
                              <input
                                aria-label="Gezahlte Vorauszahlung €"
                                value={ppEdit.value}
                                onChange={(e) => setPpEdit({ tenancyId: st.tenancyId, value: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') { e.preventDefault(); setPpEdit(null) }
                                  else if (e.key === 'Enter') { e.preventDefault(); const c = parseEuro(ppEdit.value); if (c !== null) void savePpOverride(st.tenancyId, c) }
                                }}
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
                        </span>}
                      </td>
                      <td className="num" style={{ fontWeight: 400 }}>− {fmtEuro(st.prepaymentCents)}</td>
                    </tr>
                    {prepaymentSplit(st).map((line) => (
                      <tr key={line.label}>
                        <td colSpan={3} className="muted">{line.label}</td>
                        <td className="num muted">{fmtEuro(line.cents)}</td>
                      </tr>
                    ))}
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
                </Table>
              )}
              {st.rows.length > 0 && (
                <>
                  <p style={{ marginTop: 16 }}>
                    {st.balanceCents < 0 ? (
                      <>
                        Es ergibt sich eine <strong>Nachzahlung von {fmtEuro(-st.balanceCents)}</strong>.
                        Bitte überweisen Sie den Betrag innerhalb von {landlord?.paymentDeadlineDays || 30} Tagen
                        nach Zugang dieser Abrechnung
                        {landlord?.iban ? <> auf das Konto <strong>{landlord.iban}</strong>{landlord.landlordName ? ` (${landlord.landlordName})` : ''}</> : null}.
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
                      ({suggestionBasis(st, data.daysInYear)}).
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
                      <Table>
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
                      </Table>
                    </div>
                  )}
                </>
              )}
              <p className="muted" style={{ marginTop: 14 }}>
                {costBasisText(label, calendar)}
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
                          Anlage {idx + 1} zur Nebenkostenabrechnung {data?.period.label ?? label}: {fileLabel(f)}
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
              <Table>
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
                      <td className="muted">{landlordReasonText(r)}</td>
                      <td className="num">{fmtEuro(r.shareCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Summe Vermieteranteil</td>
                    <td className="num">{fmtEuro(data.landlord.totalCents)}</td>
                  </tr>
                  {data.selfUsedShareCents !== 0 && (
                    <tr>
                      <td colSpan={3} className="muted">davon <Term id="ownShare">Eigenanteil</Term> selbstgenutzter Wohnungen (steuerlich privat)</td>
                      <td className="num muted">{fmtEuro(data.selfUsedShareCents)}</td>
                    </tr>
                  )}
                </tfoot>
              </Table>
            </div>
          )}
        </>
      )}
    </>
  )
}
