import { useCallback, useEffect, useState } from 'react'
import type { Payment, PaymentKind, RentLedger, RentMonth, Tenancy, Unit } from '../types'
import { api, errorText, fmtDate, fmtEuro } from '../api'
import { usePeriod } from '../period'
import { periodSpanText } from '../periodForm'
import { CalendarYearSelect } from '../components/PeriodSelect'
import { useProperty, withProperty } from '../property'
import { bookingDate, newPaymentDate, rentDueApplies, rentDueNote, rowStanding, shareText, decemberNote } from '../ledgerView'
import { emptyPaymentForm, hasSettlementPayments, kindChangeQuestion, newPaymentForm, noRentYearText, PAYMENT_KIND_LABELS, PAYMENT_KIND_OPTIONS, paymentBody, paymentFormHints, paymentTenancyOptions, rentWithoutRow, rentWithoutRowQuestion, savedText, type PaymentField, type PaymentForm } from '../paymentForm'
import Drawer from '../components/Drawer'
import { useSaving } from '../useSaving'
import Field from '../components/Field'
import { useFormError } from '../components/ErrorSummary'
import PageHeader from '../components/PageHeader'
import { useToast, useConfirm } from '../components/feedback'
import Table from '../components/Table'
import { useFocusTarget, useScrollToFocus, type FocusProps } from '../focus'
import { MONTH_SHORT } from '../monthText'

const MONTHS = MONTH_SHORT

export default function Mietkonto({ focus, onFocusDone }: FocusProps = {}) {
  // Das Mietkonto rechnet im Kalenderjahr (#208, Entwurf 3.11).
  const { calendarYear: year, calendar, label, period } = usePeriod()
  const { property } = useProperty()
  const propertyId = property?.id
  const toast = useToast()
  // Kein doppeltes Speichern (Durchsicht S1): `busy` an Fenster und Knopf, ein zweiter Aufruf fällt weg.
  const saving = useSaving()
  const confirm = useConfirm()
  const [ledger, setLedger] = useState<RentLedger | null>(null)
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [form, setForm] = useState<PaymentForm | null>(null)
  const [error, setError] = useState('')
  const formErrors = useFormError<PaymentField>()
  // „Hier beheben →“ aus der Abrechnung (#142): die Zeile des Mietverhältnisses hervorheben.
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const scrollToFocus = useScrollToFocus()
  useFocusTarget(focus, 'rentLedger', ledger?.rows ?? null, (r) => r.tenancyId, (r) => { setFocusedId(r.tenancyId); scrollToFocus() }, onFocusDone)

  const load = useCallback(() => {
    return Promise.all([
      api<RentLedger>(withProperty(`/api/rentledger/${year}`, propertyId)),
      api<Tenancy[]>(withProperty('/api/tenancies', propertyId)),
      api<Payment[]>(withProperty('/api/payments', propertyId)),
      api<Unit[]>(withProperty('/api/units', propertyId)),
    ])
      .then(([l, t, p, u]) => { setLedger(l); setTenancies(t); setPayments(p); setUnits(u); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [year, propertyId])

  useEffect(() => { void load() }, [load])

  async function savePayment() {
    if (!form) return
    const built = paymentBody(form)
    if ('problems' in built) {
      formErrors.report(built.problems)
      return
    }
    formErrors.clear()
    if (rentWithoutRow(form, ledger)) {
      const ok = await confirm({
        title: 'Miete ohne Mietverhältnis im Jahr?',
        message: rentWithoutRowQuestion(year, tenancyName(form.tenancyId)),
        confirmLabel: 'Trotzdem als Miete speichern',
      })
      if (!ok) return
    }
    // Lehnt der Server ab (#146), bleibt der Dialog offen und zeigt seinen Satz.
    try {
      await api('/api/payments', {
        method: 'POST',
        body: JSON.stringify(built.body),
      })
    } catch (e) {
      formErrors.show(errorText(e))
      return
    }
    setForm(null)
    await load()
    toast(savedText(built.body))
  }

  // Die Art einer erfassten Zahlung umstellen (Durchsicht M2): etwa ein früher als Miete erfasstes
  // Guthaben. Erst nach Rückfrage, bis dahin zeigt die Auswahl das Gespeicherte (kindChangeQuestion).
  // Gesendet wird nur die Art, der Rest bleibt (Zusammenführen nach Anwesenheit).
  async function changeKind(p: Payment, kind: PaymentKind) {
    if (kind === p.kind) return
    const ok = await confirm({ ...kindChangeQuestion(p, kind, fmtDate(p.date)), confirmLabel: 'Art umstellen' })
    if (!ok) return
    try {
      await api(`/api/payments/${p.id}`, { method: 'PUT', body: JSON.stringify({ kind }) })
    } catch (e) {
      // Eine Aktion ohne Formular meldet ihren Fehler als Mitteilung, nicht oben auf der Seite (H3).
      toast(errorText(e), 'error')
      return
    }
    await load()
    toast(`Zahlung vom ${fmtDate(p.date)} ist jetzt „${PAYMENT_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind}“.`)
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
      toast(errorText(e), 'error')
      return
    }
    await load()
    toast('Zahlung gelöscht.')
  }

  // Klick auf einen offenen/teilweisen Monat: Zahlung mit dem offenen Restbetrag vorbelegen
  function bookMonth(tenancyId: string, mo: RentMonth) {
    const open = mo.sollCents - mo.paidCents
    if (open <= 0) return
    formErrors.clear()
    setForm({
      ...emptyPaymentForm(tenancyId, bookingDate(year, mo, new Date())),
      amount: (open / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
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
  const dueNote = rentDueNote(year, new Date(), property?.state)

  return (
    <>
      <PageHeader
        context="calendar"
        title="Mietkonto"
        subtitle="Welche Monate sind bezahlt? Soll (Bruttomiete) gegen tatsächliche Eingänge — pro Mietverhältnis."
        actions={
          <button
            className="btn"
            onClick={() => { formErrors.clear(); setForm(newPaymentForm(ledger, newPaymentDate(year, new Date()))) }}
            disabled={tenancies.length === 0}
          >
            + Zahlung anlegen
          </button>
        }
      />
      {error && <div className="error">{error}</div>}

      {/* Das Abrechnungsjahr wählt die Seitenleiste (#346 Schritt 8). Weicht der Zeitraum vom Kalenderjahr ab, ist
          das Kalenderjahr des Mietkontos eine andere Größe und wird hier gewählt (#208). */}
      {!calendar && (
        <div className="card no-print">
          <div className="row">
            <CalendarYearSelect className="width-s" />
          </div>
          <div className="info">Die Abrechnung {label} umfasst {periodSpanText(period)}. Das Mietkonto zeigt das Kalenderjahr.</div>
        </div>
      )}

      {ledger && (
        <div className="kpis">
          <div className="kpi">
            <div className="v">{fmtEuro(ledger.totals.sollYearCents)}</div>
            <div className="l">Soll {year} (brutto)</div>
          </div>
          <div className="kpi">
            <div className="v">{fmtEuro(ledger.totals.paidYearCents)}</div>
            <div className="l">Miete eingegangen</div>
          </div>
          {hasSettlementPayments(payments, year) && (
            <div className="kpi">
              <div className="v">{fmtEuro(ledger.totals.settlementYearCents)}</div>
              <div className="l">aus der Abrechnung (gesondert)</div>
            </div>
          )}
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
          onClose={() => { formErrors.clear(); setForm(null) }}
          onSubmit={() => void saving.run(savePayment)}
          busy={saving.busy}
          value={form}
          errors={formErrors}
          actions={<button className="btn" disabled={saving.busy} onClick={() => void saving.run(savePayment)}>Speichern</button>}
        >
          {(ledger?.rows.length ?? 0) === 0 && <div className="info">{noRentYearText(year)}</div>}
          <div className="row">
            <label className="field">
              Art
              <select value={form.kind} onChange={(e) => {
                const kind = PAYMENT_KIND_OPTIONS.find((o) => o.value === e.target.value)?.value
                if (kind) setForm({ ...form, kind })
              }}>
                {PAYMENT_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <Field label="Mietverhältnis" required {...formErrors.field('tenancyId')}>
              <select value={form.tenancyId} onChange={(e) => setForm({ ...form, tenancyId: e.target.value })}>
                <option value="">— wählen —</option>
                {paymentTenancyOptions(form.kind, ledger, tenancies, (id) => units.find((u) => u.id === id)?.name ?? '—', form.tenancyId).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Datum" required {...formErrors.field('date')}>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Betrag €" required {...formErrors.field('amount')}>
              <input value={form.amount} inputMode="decimal" placeholder="z. B. 1.000,00" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Notiz">
              <input value={form.note} placeholder="z. B. Überweisung, Abrechnung 2025" onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
          </div>
          {paymentFormHints(form).map((h) => <p className="hint" key={h}>{h}</p>)}
        </Drawer>
      )}

      {ledger?.rows.length === 0 && (
        <div className="card"><div className="empty">Für {year} gibt es keine Mietverhältnisse. Legen Sie sie unter Stammdaten an und hinterlegen Sie die Kaltmiete.</div></div>
      )}

      {/* Sichtprüfung E34: einmal über den Karten statt in jeder */}
      {ledger && ledger.rows.some((r) => r.sollYearCents > 0) && (
        <p className="muted">Klick auf einen roten oder gelben Monat bucht den offenen Restbetrag vor; gestrichelte Monate zählen noch nicht als Rückstand.</p>
      )}
      {/* Nur eine Auskunft: Die Rechnung des Mietkontos ändert sie nicht (#133). */}
      {dueNote && ledger && rentDueApplies(ledger.rows, year, new Date()) && (
        <details className="muted no-print rent-due">
          <summary>{dueNote.text}</summary>
          <p>{dueNote.details}</p>
        </details>
      )}
      {ledger?.rows.map((r) => {
        const noRent = r.sollYearCents === 0
        const standing = rowStanding(r)
        const december = decemberNote(r, year, new Date())
        // Sichtprüfung E35: Bei Inklusivmiete gibt es keine Vorauszahlung; „0,00 €“ sähe aus wie ein fehlender Betrag.
        const inclusive = tenancies.find((t) => t.id === r.tenancyId)?.costModel === 'inclusive' && r.prepaymentYearCents === 0
        return (
          <div className={focusedId === r.tenancyId ? 'card focus-target' : 'card'} key={r.tenancyId}>
            <div className="row baseline">
              <h2 className="grow">{r.tenantName} <span className="muted normal">· {r.unitName}</span></h2>
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
              <div className="notice">
                Keine Kaltmiete hinterlegt — unter <em>Stammdaten → Mietverhältnis bearbeiten</em> die Kaltmiete-Staffel
                eintragen, dann erscheint hier das Soll. (Reine NK-Vorauszahlungen zählen ebenfalls ins Soll.)
              </div>
            ) : (
              <>
                <div className="rent-grid">
                  {r.months.map((mo) => {
                    const cls = mo.sollCents === 0 ? 'none' : mo.status
                    const partial = shareText(mo)
                    return (
                      <div
                        key={mo.month}
                        className={`rent-month ${cls}`}
                        title={mo.sollCents === 0 ? 'kein Mietverhältnis' : `Soll ${fmtEuro(mo.sollCents)}${partial ? ` (${partial})` : ''} · gezahlt ${fmtEuro(mo.paidCents)}${mo.status === 'notDue' ? ' · zählt noch nicht als Rückstand' : ''}`}
                        onClick={() => bookMonth(r.tenancyId, mo)}
                      >
                        <div className="m">{MONTHS[mo.month - 1]}</div>
                        <div className="a">{mo.sollCents === 0 ? '—' : fmtEuro(mo.sollCents)}</div>
                        {partial && mo.sollCents !== 0 && <div className="m">{partial}</div>}
                      </div>
                    )
                  })}
                </div>
                {/* **Der überraschende Dezember** (#70). Die Bedingung steht in ledgerView.ts,
                    damit sie einen Test hat: Der erste Entwurf stand hier und war zweimal falsch,
                    einmal im laufenden Jahr und einmal in der Aussage, wo das Geld auftaucht. */}
                {december !== null && <p className="muted">{december}</p>}
                <Table>
                  <tbody>
                    <tr>
                      <td>Kaltmiete (netto)</td>
                      <td className="num">{fmtEuro(r.baseRentYearCents)}</td>
                    </tr>
                    <tr>
                      <td>NK-Vorauszahlung</td>
                      <td className="num">{inclusive ? <span className="muted">in der Miete enthalten</span> : fmtEuro(r.prepaymentYearCents)}</td>
                    </tr>
                    {r.heatingPrepaymentYearCents !== undefined && (
                      <tr>
                        <td>Heizvorauszahlung</td>
                        <td className="num">{fmtEuro(r.heatingPrepaymentYearCents)}</td>
                      </tr>
                    )}
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
                      <td>Miete eingegangen</td>
                      <td className="num">{fmtEuro(r.paidYearCents)}</td>
                    </tr>
                    {hasSettlementPayments(payments, year, r.tenancyId) && (
                      <tr>
                        <td>Abrechnung (Nachzahlung/Guthaben), gesondert</td>
                        <td className="num">{fmtEuro(r.settlementYearCents)}</td>
                      </tr>
                    )}
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

      {ledger && (ledger.settlementOnly?.length ?? 0) > 0 && (
        <div className="card">
          <h2>Abrechnung früherer Mietverhältnisse</h2>
          <p className="muted">Nachzahlungen und Guthaben aus der Abrechnung, gezahlt im Jahr {year}, für Mietverhältnisse, die in diesem Jahr nicht mehr bestanden.</p>
          <Table>
            <tbody>
              {ledger.settlementOnly.map((r) => (
                <tr key={r.tenancyId}>
                  <td>{r.tenantName} <span className="muted">· {r.unitName}</span></td>
                  <td className="num">{fmtEuro(r.settlementYearCents)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <div className="card">
        <h2>Zahlungseingänge {year}</h2>
        {yearPayments.length === 0 ? (
          <div className="empty">Noch keine Zahlungen für {year} erfasst.</div>
        ) : (
          <Table className="stacked">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Mietverhältnis</th>
                <th>Art</th>
                <th>Notiz</th>
                <th className="num">Betrag</th>
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {yearPayments.map((p) => (
                <tr key={p.id}>
                  <td data-label="Datum">{fmtDate(p.date)}</td>
                  <td data-label="Mietverhältnis">{tenancyName(p.tenancyId)}</td>
                  <td data-label="Art">
                    {/* Der Wert ist der gespeicherte; ein unbekannter stünde sonst als erster Eintrag da. */}
                    <span className="print-only">{PAYMENT_KIND_LABELS[p.kind]}</span>
                    <select
                      className="no-print"
                      aria-label={`Art der Zahlung vom ${fmtDate(p.date)}`}
                      value={p.kind}
                      onChange={(e) => {
                        const kind = PAYMENT_KIND_OPTIONS.find((o) => o.value === e.target.value)?.value
                        if (kind) void changeKind(p, kind)
                      }}
                    >
                      {PAYMENT_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{PAYMENT_KIND_LABELS[o.value]}</option>)}
                    </select>
                  </td>
                  <td className="muted" data-label="Notiz">{p.note ?? ''}</td>
                  <td className="num" data-label="Betrag">{fmtEuro(p.amountCents)}</td>
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
