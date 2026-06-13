import { useCallback, useEffect, useState } from 'react'
import type { Payment, RentLedger, RentMonth, Tenancy } from '../types'
import { api, fmtDate, fmtEuro, parseEuro } from '../api'
import { useYear } from '../year'

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

type PaymentForm = { tenancyId: string; date: string; amount: string; note: string }

export default function Mietkonto() {
  const { year, setYear } = useYear()
  const [ledger, setLedger] = useState<RentLedger | null>(null)
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [form, setForm] = useState<PaymentForm | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    return Promise.all([
      api<RentLedger>(`/api/rentledger/${year}`),
      api<Tenancy[]>('/api/tenancies'),
      api<Payment[]>('/api/payments'),
    ])
      .then(([l, t, p]) => { setLedger(l); setTenancies(t); setPayments(p); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [year])

  useEffect(() => { void load() }, [load])

  async function savePayment() {
    if (!form) return
    const cents = parseEuro(form.amount)
    if (!form.tenancyId || !/^\d{4}-\d{2}-\d{2}$/.test(form.date) || cents === null || cents === 0) {
      setError('Bitte Mietverhältnis, Datum und einen Betrag angeben.')
      return
    }
    setError('')
    await api('/api/payments', {
      method: 'POST',
      body: JSON.stringify({ tenancyId: form.tenancyId, date: form.date, amountCents: cents, note: form.note.trim() || undefined }),
    })
    setForm(null)
    await load()
  }

  async function deletePayment(p: Payment) {
    if (!confirm(`Zahlung vom ${fmtDate(p.date)} über ${fmtEuro(p.amountCents)} wirklich löschen?`)) return
    await api(`/api/payments/${p.id}`, { method: 'DELETE' })
    await load()
  }

  // Klick auf einen offenen/teilweisen Monat: Zahlung mit dem offenen Restbetrag vorbelegen
  function bookMonth(tenancyId: string, mo: RentMonth) {
    const open = mo.sollCents - mo.paidCents
    if (open <= 0) return
    setForm({
      tenancyId,
      date: `${year}-${String(mo.month).padStart(2, '0')}-01`,
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
      <h1>Mietkonto</h1>
      <p className="sub">Welche Monate sind bezahlt? Soll (Bruttomiete) gegen tatsächliche Eingänge — pro Mietverhältnis.</p>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="row">
          <label className="field">
            Jahr
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 8 }, (_, k) => new Date().getFullYear() - k).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <div className="field grow" />
          <button
            className="btn"
            onClick={() => setForm({ tenancyId: ledger?.rows[0]?.tenancyId ?? '', date: new Date().toISOString().slice(0, 10), amount: '', note: '' })}
            disabled={(ledger?.rows.length ?? 0) === 0}
          >
            + Zahlung erfassen
          </button>
        </div>
      </div>

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
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <h2>Zahlung erfassen</h2>
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
            <label className="field">
              Datum
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label className="field">
              Betrag €
              <input value={form.amount} style={{ width: 120 }} placeholder="z. B. 1.000,00" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </label>
            <label className="field grow">
              Notiz (optional)
              <input value={form.note} placeholder="z. B. Überweisung, Nachzahlung" onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>
            <button className="btn" onClick={savePayment}>Speichern</button>
            <button className="btn ghost" onClick={() => setForm(null)}>Abbrechen</button>
          </div>
        </div>
      )}

      {ledger?.rows.length === 0 && (
        <div className="card"><div className="empty">Für {year} gibt es keine Mietverhältnisse. Lege sie unter Stammdaten an und hinterlege die Kaltmiete.</div></div>
      )}

      {ledger?.rows.map((r) => {
        const noRent = r.sollYearCents === 0
        return (
          <div className="card" key={r.tenancyId}>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <h2 style={{ marginRight: 'auto' }}>{r.tenantName} <span className="muted" style={{ fontWeight: 400 }}>· {r.unitName}</span></h2>
              {r.balanceCents < 0 ? (
                <span className="badge red">{fmtEuro(-r.balanceCents)} offen</span>
              ) : r.balanceCents > 0 ? (
                <span className="badge green">{fmtEuro(r.balanceCents)} Guthaben</span>
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
                        title={mo.sollCents === 0 ? 'kein Mietverhältnis' : `Soll ${fmtEuro(mo.sollCents)} · gezahlt ${fmtEuro(mo.paidCents)}`}
                        onClick={() => bookMonth(r.tenancyId, mo)}
                      >
                        <div className="m">{MONTHS[mo.month - 1]}</div>
                        <div className="a">{mo.sollCents === 0 ? '—' : fmtEuro(mo.sollCents)}</div>
                      </div>
                    )
                  })}
                </div>
                <p className="muted" style={{ margin: '2px 0 10px' }}>
                  Klick auf einen roten/gelben Monat bucht den offenen Restbetrag vor.
                </p>
                <table>
                  <tbody>
                    <tr>
                      <td>Kaltmiete (netto)</td>
                      <td className="num">{fmtEuro(r.baseRentYearCents)}</td>
                    </tr>
                    <tr>
                      <td>NK-Vorauszahlung</td>
                      <td className="num">{fmtEuro(r.prepaymentYearCents)}</td>
                    </tr>
                    <tr>
                      <td><strong>Soll {year} (brutto)</strong></td>
                      <td className="num"><strong>{fmtEuro(r.sollYearCents)}</strong></td>
                    </tr>
                    <tr>
                      <td>eingegangen</td>
                      <td className="num">{fmtEuro(r.paidYearCents)}</td>
                    </tr>
                    <tr>
                      <td>{r.balanceCents < 0 ? 'offener Rückstand' : 'Guthaben/Überzahlung'}</td>
                      <td className="num" style={{ color: r.balanceCents < 0 ? 'var(--red)' : 'var(--green)' }}>
                        {fmtEuro(Math.abs(r.balanceCents))}
                      </td>
                    </tr>
                  </tbody>
                </table>
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
          <table>
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
                  <td className="num no-print">
                    <button className="btn small ghost" onClick={() => deletePayment(p)}>Löschen</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
