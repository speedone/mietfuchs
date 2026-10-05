import { useCallback, useEffect, useState } from 'react'
import type { Payment, RentLedger, RentMonth, Tenancy } from '../types'
import { api, errorText, fmtDate, fmtEuro, parseEuro } from '../api'
import { usePeriod } from '../period'
import { periodSpanText } from '../periodForm'
import { CalendarYearSelect } from '../components/PeriodSelect'
import { useProperty, withProperty } from '../property'
import { bookingDate, newPaymentDate, rowStanding, showDecemberNote } from '../ledgerView'
import Drawer from '../components/Drawer'
import PageHeader from '../components/PageHeader'
import { useToast, useConfirm } from '../components/feedback'
import Table from '../components/Table'
import { useFocusTarget, useScrollToFocus, type FocusProps } from '../focus'

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

type PaymentForm = { tenancyId: string; date: string; amount: string; note: string }

export default function Mietkonto({ focus, onFocusDone }: FocusProps = {}) {
  // Das Mietkonto rechnet im Kalenderjahr (#208, Entwurf 3.11).
  const { calendarYear: year, calendar, label, period } = usePeriod()
  const { property } = useProperty()
  const propertyId = property?.id
  const toast = useToast()
  const confirm = useConfirm()
  const [ledger, setLedger] = useState<RentLedger | null>(null)
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [form, setForm] = useState<PaymentForm | null>(null)
  const [error, setError] = useState('')
  // „Hier beheben →“ aus der Abrechnung (#142): die Zeile des Mietverhältnisses hervorheben.
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const scrollToFocus = useScrollToFocus()
  useFocusTarget(focus, 'rentLedger', ledger?.rows ?? null, (r) => r.tenancyId, (r) => { setFocusedId(r.tenancyId); scrollToFocus() }, onFocusDone)

  const load = useCallback(() => {
    return Promise.all([
      api<RentLedger>(withProperty(`/api/rentledger/${year}`, propertyId)),
      api<Tenancy[]>(withProperty('/api/tenancies', propertyId)),
      api<Payment[]>(withProperty('/api/payments', propertyId)),
    ])
      .then(([l, t, p]) => { setLedger(l); setTenancies(t); setPayments(p); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [year, propertyId])

  useEffect(() => { void load() }, [load])

  async function savePayment() {
    if (!form) return
    const cents = parseEuro(form.amount)
    if (!form.tenancyId || !/^\d{4}-\d{2}-\d{2}$/.test(form.date) || cents === null || cents === 0) {
      setError('Bitte Mietverhältnis, Datum und einen Betrag angeben.')
      return
    }
    setError('')
    // Lehnt der Server ab (#146), bleibt der Dialog offen und zeigt seinen Satz.
    try {
      await api('/api/payments', {
        method: 'POST',
        body: JSON.stringify({ tenancyId: form.tenancyId, date: form.date, amountCents: cents, note: form.note.trim() || undefined }),
      })
    } catch (e) {
      setError(errorText(e))
      return
    }
    setForm(null)
    await load()
    toast(`Zahlung über ${fmtEuro(cents)} erfasst.`)
  }

  async function deletePayment(p: Payment) {
    const ok = await confirm({
      title: 'Zahlung löschen?',
      message: `Zahlung vom ${fmtDate(p.date)} über ${fmtEuro(p.amountCents)} wird gelöscht.`,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/payments/${p.id}`, { method: 'DELETE' })
    } catch (e) {
      setError(errorText(e))
      return
    }
    setError('')
    await load()
    toast('Zahlung gelöscht.')
  }

  // Klick auf einen offenen/teilweisen Monat: Zahlung mit dem offenen Restbetrag vorbelegen
  function bookMonth(tenancyId: string, mo: RentMonth) {
    const open = mo.sollCents - mo.paidCents
    if (open <= 0) return
    setError('')
    setForm({
      tenancyId,
      date: bookingDate(year, mo, new Date()),
      amount: (open / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
      note: '',
    })
  }

  const tenancyName = (id: string) => {
    const t = tenancies.find((x) => x.id === id)
    return t ? t.tenantName : '—'
  }

  // Zahlungen des Jahres, neueste zuerst
  const yearPayments = payments
    .filter((p) => p.date >= `${year}-01-01` && p.date <= `${year}-12-31`)
    .sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <PageHeader
        title="Mietkonto"
        subtitle="Welche Monate sind bezahlt? Soll (Bruttomiete) gegen tatsächliche Eingänge — pro Mietverhältnis."
        actions={
          <button
            className="btn"
            onClick={() => { setError(''); setForm({ tenancyId: ledger?.rows[0]?.tenancyId ?? '', date: newPaymentDate(year, new Date()), amount: '', note: '' }) }}
            disabled={(ledger?.rows.length ?? 0) === 0}
          >
            + Zahlung erfassen
          </button>
        }
      />
      {error && !form && <div className="error">{error}</div>}

      <div className="card">
        <div className="row">
          <CalendarYearSelect />
        </div>
      </div>
      {!calendar && <div className="info no-print">Die Abrechnung {label} umfasst {periodSpanText(period)}. Das Mietkonto zeigt das Kalenderjahr.</div>}

      {ledger && (
        <div className="kpis">
          <div className="kpi">
            <div className="v">{fmtEuro(ledger.totals.sollYearCents)}</div>
            <div className="l">Soll {year} (brutto)</div>
          </div>
          <div className="kpi">
            <div className="v">{fmtEuro(ledger.totals.paidYearCents)}</div>
            <div className="l">eingegangen</div>
          </div>
          <div className="kpi">
            <div className="v" style={{ color: ledger.totals.openCents > 0 ? 'var(--red)' : 'var(--green)' }}>
              {fmtEuro(ledger.totals.openCents)}
            </div>
            <div className="l">offene Rückstände</div>
          </div>
        </div>
      )}

      {form && (
        <Drawer
          open
          title="Zahlung erfassen"
          onClose={() => { setError(''); setForm(null) }}
          onSubmit={savePayment}
          footer={
            <>
              <span className="drawer-hint">Strg+S speichert · Esc schließt</span>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => { setError(''); setForm(null) }}>Abbrechen</button>
              <button className="btn" onClick={savePayment}>Speichern</button>
            </>
          }
        >
          {error && <div className="error">{error}</div>}
          <div className="row">
            <label className="field grow">
              Mietverhältnis
              <select value={form.tenancyId} onChange={(e) => setForm({ ...form, tenancyId: e.target.value })}>
                <option value="">— wählen —</option>
                {(ledger?.rows ?? []).map((r) => (
                  <option key={r.tenancyId} value={r.tenancyId}>{r.tenantName} · {r.unitName}</option>
                ))}
              </select>
            </label>
            <label className="field grow">
              Datum
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label className="field grow">
              Betrag €
              <input value={form.amount} placeholder="z. B. 1.000,00" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </label>
            <label className="field grow">
              Notiz (optional)
              <input value={form.note} placeholder="z. B. Überweisung, Nachzahlung" onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>
          </div>
        </Drawer>
      )}

      {ledger?.rows.length === 0 && (
        <div className="card"><div className="empty">Für {year} gibt es keine Mietverhältnisse. Legen Sie sie unter Stammdaten an und hinterlegen Sie die Kaltmiete.</div></div>
      )}

      {ledger?.rows.map((r) => {
        const noRent = r.sollYearCents === 0
        const standing = rowStanding(r)
        return (
          <div className={focusedId === r.tenancyId ? 'card focus-target' : 'card'} key={r.tenancyId}>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <h2 style={{ marginRight: 'auto' }}>{r.tenantName} <span className="muted" style={{ fontWeight: 400 }}>· {r.unitName}</span></h2>
              {standing.kind === 'arrears' ? (
                <span className="badge red">{fmtEuro(standing.cents)} offen</span>
              ) : standing.kind === 'credit' ? (
                <span className="badge green">{fmtEuro(standing.cents)} Guthaben</span>
              ) : standing.kind === 'paidSoFar' ? (
                <span className="badge green">bisher bezahlt</span>
              ) : !noRent ? (
                <span className="badge green">vollständig bezahlt</span>
              ) : null}
            </div>

            {noRent ? (
              <div className="notice" style={{ marginTop: 8 }}>
                Keine Kaltmiete hinterlegt — unter <em>Stammdaten → Mietverhältnis bearbeiten</em> die Kaltmiete-Staffel
                eintragen, dann erscheint hier das Soll. (Reine NK-Vorauszahlungen zählen ebenfalls ins Soll.)
              </div>
            ) : (
              <>
                <div className="rent-grid">
                  {r.months.map((mo) => {
                    const cls = mo.sollCents === 0 ? 'none' : mo.status
                    return (
                      <div
                        key={mo.month}
                        className={`rent-month ${cls}`}
                        title={mo.sollCents === 0 ? 'kein Mietverhältnis' : `Soll ${fmtEuro(mo.sollCents)} · gezahlt ${fmtEuro(mo.paidCents)}${mo.status === 'notDue' ? ' · noch nicht fällig' : ''}`}
                        onClick={() => bookMonth(r.tenancyId, mo)}
                      >
                        <div className="m">{MONTHS[mo.month - 1]}</div>
                        <div className="a">{mo.sollCents === 0 ? '—' : fmtEuro(mo.sollCents)}</div>
                      </div>
                    )
                  })}
                </div>
                <p className="muted" style={{ margin: '2px 0 10px' }}>
                  Klick auf einen roten/gelben Monat bucht den offenen Restbetrag vor; gestrichelte Monate sind noch nicht fällig.
                </p>
                {/* **Der überraschende Dezember** (#70). Die Bedingung steht in ledgerView.ts,
                    damit sie einen Test hat: Der erste Entwurf stand hier und war zweimal falsch,
                    einmal im laufenden Jahr und einmal in der Aussage, wo das Geld auftaucht. */}
                {showDecemberNote(r, year, new Date()) && (
                  <p className="muted" style={{ margin: '2px 0 10px' }}>
                    Der Dezember steht offen. Das kann daran liegen, dass die Dezembermiete erst im
                    Januar eingegangen ist: Zahlungen zählen zu dem Jahr, in dem sie eingegangen sind,
                    und erscheinen dann unter den Zahlungseingängen {year + 1}.
                  </p>
                )}
                <Table>
                  <tbody>
                    <tr>
                      <td>Kaltmiete (netto)</td>
                      <td className="num">{fmtEuro(r.baseRentYearCents)}</td>
                    </tr>
                    <tr>
                      <td>NK-Vorauszahlung</td>
                      <td className="num">{fmtEuro(r.prepaymentYearCents)}</td>
                    </tr>
                    {r.flatRateYearCents > 0 && (
                      <tr>
                        <td>NK-Pauschale (ohne Abrechnung)</td>
                        <td className="num">{fmtEuro(r.flatRateYearCents)}</td>
                      </tr>
                    )}
                    <tr>
                      <td><strong>Soll {year} (brutto)</strong></td>
                      <td className="num"><strong>{fmtEuro(r.sollYearCents)}</strong></td>
                    </tr>
                    <tr>
                      <td>eingegangen</td>
                      <td className="num">{fmtEuro(r.paidYearCents)}</td>
                    </tr>
                    <tr>
                      <td>{standing.kind === 'arrears' ? 'offener Rückstand (fällig)' : standing.kind === 'paidSoFar' ? 'noch nicht fällig' : 'Guthaben/Überzahlung'}</td>
                      <td className="num" style={{ color: standing.kind === 'arrears' ? 'var(--red)' : standing.kind === 'paidSoFar' ? 'var(--muted)' : 'var(--green)' }}>
                        {fmtEuro(standing.cents)}
                      </td>
                    </tr>
                  </tbody>
                </Table>
              </>
            )}
          </div>
        )
      })}

      <div className="card">
        <h2>Zahlungseingänge {year}</h2>
        {yearPayments.length === 0 ? (
          <div className="empty">Noch keine Zahlungen für {year} erfasst.</div>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Mietverhältnis</th>
                <th>Notiz</th>
                <th className="num">Betrag</th>
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {yearPayments.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDate(p.date)}</td>
                  <td>{tenancyName(p.tenancyId)}</td>
                  <td className="muted">{p.note ?? ''}</td>
                  <td className="num">{fmtEuro(p.amountCents)}</td>
                  <td className="actions no-print">
                    <button className="icon-btn danger" title="Löschen" aria-label="Zahlung löschen" onClick={() => deletePayment(p)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  )
}
