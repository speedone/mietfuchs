import { useCallback, useEffect, useRef, useState } from 'react'
import type { MarkPaidPlan, Payment, PaymentListItem, RentLedger, RentMonth, Tenancy, Unit } from '../types'
import { api, ApiError, errorText, fmtDate, fmtEuro } from '../api'
import { usePeriod } from '../period'
import { periodSpanText } from '../periodForm'
import { CalendarYearSelect } from '../components/PeriodSelect'
import { useProperty, withProperty } from '../property'
import { bookingDate, carriedText, carryText, ledgerStartText, closingLines, dueDetails, dueLine, monthDueText, newPaymentDate, notDemandableNotes, openPartsText, paidLaterText, rowStanding, shareText } from '../ledgerView'
import { holidaysCheckedOn } from '../../../shared/holidaysChecked.ts'
import { DESIGNATED_MONTH_HINT, emptyPaymentForm, hasSettlementPayments, kindChangeQuestion, newPaymentForm, noRentYearText, PAYMENT_KIND_LABELS, PAYMENT_KIND_OPTIONS, paymentBody, paymentChangeBody, paymentFormHints, paymentTenancyOptions, rentWithoutRow, rentWithoutRowQuestion, savedText, type PaymentDraft, type PaymentField, type PaymentForm } from '../paymentForm'
import { keepDraft, useDraft } from '../useDraft'
import DraftActions from '../components/DraftActions'
import MonthField from '../components/MonthField'
import Term from '../components/Term'
import { monthLabel } from '../monthText'
import Drawer from '../components/Drawer'
import { useSaving } from '../useSaving'
import Field from '../components/Field'
import { useFormError } from '../components/ErrorSummary'
import PageHeader from '../components/PageHeader'
import { useToast, useConfirm } from '../components/feedback'
import Table from '../components/Table'
import { useFocusTarget, useScrollToFocus, type FocusProps } from '../focus'
import { MONTH_SHORT, parseMonthText } from '../monthText'
import { NoticeBox } from '../components/Notice'
import Card from '../components/Card'
import { affectedText, createdText, emptyPlanText, MARK_PAID_EXPLAIN, markPaidBlocked as markPaidBlockedReason, markPaidRequest, markPaidStart, markPaidTenancyOptions, unresolvedText, type MarkPaidField, type MarkPaidValue } from '../markPaidForm'

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
  const [payments, setPayments] = useState<PaymentListItem[]>([])
  const [form, setForm] = useState<PaymentForm | null>(null)
  const [error, setError] = useState('')
  const formErrors = useFormError<PaymentField>()
  // „Offene Monate als bezahlt erfassen“ (#608): Wahl im Seitenfenster, Vorschau des Servers mit Folgenummer je Anfrage.
  const [markPaid, setMarkPaid] = useState<MarkPaidValue | null>(null)
  const [markPaidPlan, setMarkPaidPlan] = useState<MarkPaidPlan | null>(null)
  // Warum es keine Vorschau gibt (ein Monat außerhalb des Jahres …). Nicht am Feld: Das Feld nimmt seine Meldung bei der
  // nächsten Eingabe selbst zurück (`onFix`), und gefragt wird bei jeder.
  const [markPaidNote, setMarkPaidNote] = useState<string | null>(null)
  const markPaidErrors = useFormError<MarkPaidField>()
  const markPaidSeq = useRef(0)
  // „Hier beheben →“ aus der Abrechnung (#142): die Zeile des Mietverhältnisses hervorheben.
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const scrollToFocus = useScrollToFocus()
  useFocusTarget(focus, 'rentLedger', ledger?.rows ?? null, (r) => r.tenancyId, (r) => { setFocusedId(r.tenancyId); scrollToFocus() }, onFocusDone)

  const load = useCallback(() => {
    return Promise.all([
      api<RentLedger>(withProperty(`/api/rentledger/${year}`, propertyId)),
      api<Tenancy[]>(withProperty('/api/tenancies', propertyId)),
      api<PaymentListItem[]>(withProperty('/api/payments', propertyId)),
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

  async function deletePayment(p: PaymentListItem) {
    const ok = await confirm({
      title: 'Zahlung löschen?',
      // Eine Zahlung aus der Kaution (#228) nimmt ihre Verrechnung mit; der Stand der Kaution steigt wieder.
      message: `Zahlung vom ${fmtDate(p.date)} über ${fmtEuro(p.amountCents)} wird gelöscht.${p.fromDeposit ? ' Die Verrechnung in der Kaution fällt mit weg.' : ''}`,
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

  // Klick auf einen offenen/teilweisen Monat (#608): die Zahlung für diesen Monat, vorbelegt mit dem offenen Rest, dem
  // Fälligkeitstag (`bookingDate`) und dem Monat laut Verwendungszweck. Gespeichert wird erst im Fenster (#309).
  function bookMonth(tenancyId: string, mo: RentMonth) {
    const open = mo.sollCents - mo.paidCents
    if (open <= 0) return
    formErrors.clear()
    setForm({
      ...emptyPaymentForm(tenancyId, bookingDate(year, mo, new Date())),
      amount: (open / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
      designatedMonth: `${year}-${String(mo.month).padStart(2, '0')}`,
    })
  }

  // Jede Änderung verwirft die Vorschau und fragt neu; eine verspätete Antwort auf eine ältere Anfrage zählt nicht.
  function previewMarkPaid(value: MarkPaidValue) {
    const seq = ++markPaidSeq.current
    setMarkPaidPlan(null)
    const built = markPaidRequest(value, ledger?.rows ?? [], year, new Date())
    markPaidErrors.clear()
    if ('problems' in built) {
      // Einen Text, der kein Monat ist, meldet das Monatsfeld selbst (beim Verlassen); hier nur, was als Monat nicht passt.
      const shown = built.problems.filter((p) => p.field !== 'through' || parseMonthText(value.through).kind === 'month')
      setMarkPaidNote(shown.length > 0 ? shown.map((p) => p.text).join(' ') : null)
      return
    }
    setMarkPaidNote(null)
    api<MarkPaidPlan>(withProperty(`/api/rentledger/${year}/mark-paid/plan`, propertyId), { method: 'POST', body: JSON.stringify(built.body) })
      .then((plan) => { if (seq === markPaidSeq.current) setMarkPaidPlan(plan) })
      .catch((e: unknown) => { if (seq === markPaidSeq.current) markPaidErrors.set(errorText(e), { focus: false }) })
  }
  // Die Vorschau folgt dem Zustand des Fensters (Öffnen und jede Änderung); die Felder selbst setzen nur den Zustand.
  useEffect(() => {
    // Nur bei geänderter Wahl; ein Wechsel von Jahr oder Objekt baut die Seite neu auf.
    if (markPaid) previewMarkPaid(markPaid)
  }, [markPaid])
  const changeMarkPaid = (value: MarkPaidValue) => setMarkPaid(value)
  function closeMarkPaid() {
    markPaidSeq.current++
    markPaidErrors.clear()
    setMarkPaid(null)
    setMarkPaidPlan(null)
    setMarkPaidNote(null)
  }

  async function createMarkPaid() {
    if (!markPaid || !markPaidPlan || markPaidPlan.payments.length === 0) return
    const built = markPaidRequest(markPaid, ledger?.rows ?? [], year, new Date())
    if ('problems' in built) {
      markPaidErrors.report(built.problems)
      return
    }
    let count = 0
    try {
      const done = await api<{ count: number }>(withProperty(`/api/rentledger/${year}/mark-paid`, propertyId), {
        method: 'POST', body: JSON.stringify({ ...built.body, token: markPaidPlan.token }),
      })
      count = done.count
    } catch (e) {
      // 409: Der Stand hat sich seit der Vorschau geändert; die neue Vorschau steht dann da, angelegt ist nichts.
      if (e instanceof ApiError && e.status === 409 && e.data.plan) {
        markPaidSeq.current++
        setMarkPaidPlan(e.data.plan as MarkPaidPlan)
        markPaidErrors.show('Der Stand hat sich geändert. Bitte prüfen Sie die Vorschau noch einmal; angelegt ist noch nichts.')
        return
      }
      markPaidErrors.show(errorText(e))
      return
    }
    closeMarkPaid()
    await load()
    toast(createdText(count))
  }

  const tenancyName = (id: string) => {
    const t = tenancies.find((x) => x.id === id)
    return t ? t.tenantName : '-'
  }

  // Zahlungen des Jahres, neueste zuerst
  const yearPayments = payments
    .filter((p) => p.date >= `${year}-01-01` && p.date <= `${year}-12-31`)
    .sort((a, b) => b.date.localeCompare(a.date))
  const markPaidBlocked = ledger ? markPaidBlockedReason(ledger.rows, year, new Date()) : null
  // Die Einzelheiten zur Fälligkeit (#334): ob die Feiertage am Stichtag gelesen oder abgeglichen sind, entscheidet der Text.
  const dueChecked = ledger?.asOf ? holidaysCheckedOn(ledger.asOf) : false

  return (
    <>
      <PageHeader
        context="calendar"
        title="Mietkonto"
        subtitle="Welche Monate sind bezahlt? Soll (Bruttomiete) gegen tatsächliche Eingänge - pro Mietverhältnis."
        actions={
          <>
            <button
              className="btn"
              onClick={() => { formErrors.clear(); setForm(newPaymentForm(ledger, newPaymentDate(year, new Date()))) }}
              disabled={tenancies.length === 0}
            >
              + Zahlung anlegen
            </button>
            {/* #608: offene Monate in einem Schritt, mit Vorschau; Teilzahlungen bleiben bei „+ Zahlung anlegen“. */}
            <button
              className="btn secondary"
              disabled={!ledger || markPaidBlocked !== null}
              aria-describedby={markPaidBlocked !== null ? 'mark-paid-blocked' : undefined}
              onClick={() => setMarkPaid(markPaidStart(year, new Date(), ledger?.rows ?? []))}
            >
              Monate als bezahlt erfassen …
            </button>
            {markPaidBlocked !== null && <span id="mark-paid-blocked" className="muted">{markPaidBlocked}</span>}
          </>
        }
      />
      {error && <NoticeBox level="error" action={error} />}

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
          {(ledger.totals.notDemandableCents ?? 0) > 0 && (
            <div className="kpi">
              <div className="v" style={{ color: 'var(--muted)' }}>{fmtEuro(ledger.totals.notDemandableCents)}</div>
              <div className="l">nicht mehr einzeln einforderbar</div>
            </div>
          )}
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
                <option value="">Bitte wählen</option>
                {paymentTenancyOptions(form.kind, ledger, tenancies, (id) => units.find((u) => u.id === id)?.name ?? '-', form.tenancyId).map((o) => (
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
            {/* Nur an einer Miete (#281): Eine Zahlung aus der Abrechnung gilt dem Saldo, nicht einem Monat. */}
            {form.kind === 'rent' && (
              <MonthField label="Für Monat (laut Verwendungszweck)" value={form.designatedMonth} placeholder="kein Monat"
                hint={DESIGNATED_MONTH_HINT} start={form.date} onChange={(designatedMonth) => setForm({ ...form, designatedMonth })}
                {...formErrors.field('designatedMonth')} />
            )}
          </div>
          {paymentFormHints(form).map((h) => <NoticeBox key={h} level="hint" action={h} />)}
        </Drawer>
      )}

      {markPaid && (
        <Drawer
          open
          title="Offene Monate als bezahlt erfassen"
          onClose={closeMarkPaid}
          onSubmit={() => void saving.run(createMarkPaid)}
          busy={saving.busy}
          value={markPaid}
          errors={markPaidErrors}
          actions={<button className="btn" disabled={saving.busy || !markPaidPlan || markPaidPlan.payments.length === 0} onClick={() => void saving.run(createMarkPaid)}>Anlegen</button>}
        >
          <div className="row">
            <Field label="Mietverhältnis" {...markPaidErrors.field('tenancyId')}>
              <select value={markPaid.tenancyId} onChange={(e) => changeMarkPaid({ ...markPaid, tenancyId: e.target.value })}>
                {markPaidTenancyOptions(ledger?.rows ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <MonthField label="Bis Monat" value={markPaid.through} start={`${year}-01-01`}
              onChange={(through) => changeMarkPaid({ ...markPaid, through })} {...markPaidErrors.field('through')} />
          </div>
          <p className="muted">{MARK_PAID_EXPLAIN}</p>
          {markPaidPlan === null ? (
            <p className={markPaidNote ? undefined : 'muted'} role="status">{markPaidNote ?? 'Die Vorschau wird nach jeder Änderung neu berechnet.'}</p>
          ) : markPaidPlan.payments.length === 0 ? (
            <p role="status">{emptyPlanText(markPaid.through)}</p>
          ) : (
            <>
              {affectedText(markPaidPlan) && <NoticeBox level="warning" title="Auch andere Monate ändern sich" action={affectedText(markPaidPlan)} />}
              {unresolvedText(markPaidPlan) && <NoticeBox level="hint" action={unresolvedText(markPaidPlan)} />}
              <Table className="stacked">
                <thead>
                  <tr>
                    <th>Mietverhältnis</th>
                    <th>Monat</th>
                    <th>Datum</th>
                    <th className="num">Betrag</th>
                  </tr>
                </thead>
                <tbody>
                  {markPaidPlan.payments.map((p) => (
                    <tr key={`${p.tenancyId}/${p.month}`}>
                      <td data-label="Mietverhältnis">{`${p.tenantName} · ${p.unitName}`}</td>
                      <td data-label="Monat">{monthLabel(p.month)}</td>
                      <td data-label="Datum">{fmtDate(p.date)}</td>
                      <td className="num" data-label="Betrag">{fmtEuro(p.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p><strong>{`Summe: ${fmtEuro(markPaidPlan.totalCents)}`}</strong>{` in ${markPaidPlan.payments.length === 1 ? 'einer Zahlung' : `${markPaidPlan.payments.length} Zahlungen`}`}</p>
            </>
          )}
        </Drawer>
      )}

      {ledger?.rows.length === 0 && (
        <div className="card"><div className="empty">Für {year} gibt es keine Mietverhältnisse. Legen Sie sie unter Stammdaten an und hinterlegen Sie die Kaltmiete.</div></div>
      )}

      {/* Sichtprüfung E34: einmal über den Karten statt in jeder */}
      {ledger && ledger.rows.some((r) => r.sollYearCents > 0) && (
        <>
          <p className="muted">Grün heißt bezahlt, Gelb teilweise bezahlt, Rot offen; gestrichelte Monate zählen noch nicht als Rückstand. Klick auf einen roten oder gelben Monat öffnet die Zahlung für diesen Monat, vorbelegt mit dem offenen Rest, dem Fälligkeitstag und dem Monat laut Verwendungszweck. Eine Zahlung ohne Monat im Verwendungszweck tilgt die älteste offene Forderung, nicht unbedingt den angeklickten Monat (§ 366 BGB).</p>
          {/* #281: Das Konto läuft ab Beginn des Mietverhältnisses, verteilt nach § 366 BGB (Entwurf E4). */}
          <NoticeBox level="hint"
            action={<>Das Mietkonto rechnet ab Beginn des Mietverhältnisses: Ein Rückstand aus dem Vorjahr steht als Übertrag da, eine im Dezember gezahlte Januarmiete deckt den Januar. Zahlungen verteilt Mietfuchs nach der <Term id="paymentOrder">Tilgungsreihenfolge</Term>.</>}
            more={<p>Nennt der Mieter keinen Monat, tilgt eine Zahlung zuerst die offenen Vorauszahlungen, dann Kaltmiete und Pauschale, jeweils die ältesten zuerst. Beispiel: Offen sind 600 € Kaltmiete und 200 € Vorauszahlung, der Mieter zahlt 300 €. Dann sind 200 € auf die Vorauszahlung und 100 € auf die Kaltmiete angerechnet; offen bleiben 500 € Kaltmiete (BGH, Urteil vom 21.03.2018, VIII ZR 84/17, Rn. 56 und 57). Nennt er einen Monat, tragen Sie ihn an der Zahlung bei „Für Monat“ ein.</p>} />
        </>
      )}
      {ledger?.rows.map((r) => {
        const noRent = r.sollYearCents === 0
        const standing = rowStanding(r, ledger.asOf)
        // Fälligkeit je Karte (#334), aus den Daten des Servers.
        const due = dueLine(r, ledger.asOf)
        const carry = carryText(r, year)
        const partialLines = r.months.flatMap((mo) => {
          const text = openPartsText(mo)
          return text ? [`${MONTHS[mo.month - 1]}: ${text}`] : []
        })
        // Tolerant gegen eine Antwort ohne die Felder von #281 (älterer Server im offenen Tab), wie `settlementOnly`.
        const notes = notDemandableNotes(r.notDemandable ?? [])
        // Sichtprüfung E35: Bei Inklusivmiete gibt es keine Vorauszahlung; „0,00 €“ sähe aus wie ein fehlender Betrag.
        const inclusive = tenancies.find((t) => t.id === r.tenancyId)?.costModel === 'inclusive' && r.prepaymentYearCents === 0
        return (
          <Card key={r.tenancyId} className={focusedId === r.tenancyId ? 'focus-target' : undefined}
            title={<>{r.tenantName} <span className="muted normal">· {r.unitName}</span></>}
            aside={standing.kind === 'arrears' ? (
              <span className="badge red">{fmtEuro(standing.cents)} offen</span>
            ) : standing.kind === 'viaSettlement' ? (
              <span className="badge">über die Abrechnung</span>
            ) : standing.kind === 'credit' ? (
              <span className="badge green">{fmtEuro(standing.cents)} vorausbezahlt</span>
            ) : standing.kind === 'dueAwaiting' && standing.since ? (
              <span className="badge">fällig seit {`${standing.since.slice(8, 10)}.${standing.since.slice(5, 7)}.`}</span>
            ) : standing.kind === 'nothingDue' ? (
              <span className="badge">noch nichts fällig</span>
            ) : standing.kind === 'paidSoFar' ? (
              <span className="badge green">bisher bezahlt</span>
            ) : !noRent ? (
              <span className="badge green">vollständig bezahlt</span>
            ) : null}>

            {noRent ? (
              <NoticeBox level="warning">
                Keine Kaltmiete hinterlegt - unter <em>Stammdaten → Mietverhältnis bearbeiten</em> die Kaltmiete-Staffel
                eintragen, dann erscheint hier das Soll. (Reine NK-Vorauszahlungen zählen ebenfalls ins Soll.)
              </NoticeBox>
            ) : (
              <>
                {carry && <p className={r.openingBalanceCents < 0 ? 'text-red' : 'muted'}><strong>{carry}</strong></p>}
                {ledgerStartText(r) && <p className="muted">{ledgerStartText(r)}</p>}
                {due && (
                  <details className={`no-print rent-due ${due.tone === 'red' ? 'text-red' : 'muted'}`}>
                    <summary>{due.text}</summary>
                    {/* Rot ist nur die Zeile „offen seit …“, die Erklärung bleibt ruhig lesbar (UI-Durchsicht 0.17.0) */}
                    <p className="muted">{dueDetails(property?.state, dueChecked, r.dueRule)}</p>
                  </details>
                )}
                <div className="rent-grid">
                  {r.months.map((mo) => {
                    // Vor dem Beginn der Erfassung im Objekt (#281): nicht erfasst, weder bezahlt noch offen, kein Buchungsknopf.
                    const notRecorded = mo.status === 'notRecorded'
                    const cls = mo.sollCents === 0 || notRecorded ? 'none' : mo.status
                    const partial = shareText(mo)
                    const later = paidLaterText(mo)
                    const parts = openPartsText(mo)
                    // Nicht mehr einzeln einforderbar (E5): gedämpft gekennzeichnet; der Status bleibt, was die Zahlungen sagen.
                    const via = (mo.notDemandableCents ?? 0) > 0 ? 'Vorauszahlung: über die Abrechnung' : null
                    const dueText = monthDueText(mo)
                    const extra = [parts, later, via, dueText].filter((x) => x !== null).join(' · ')
                    const detail = mo.sollCents === 0 ? 'kein Mietverhältnis' : notRecorded ? `Soll ${fmtEuro(mo.sollCents)} · nicht erfasst` : `Soll ${fmtEuro(mo.sollCents)}${partial ? ` (${partial})` : ''} · gezahlt ${fmtEuro(mo.paidCents)}${mo.status === 'notDue' ? ' · zählt noch nicht als Rückstand' : ''}${extra ? ` · ${extra}` : ''}`
                    const content = (
                      <>
                        <span className="m">{MONTHS[mo.month - 1]}</span>
                        <span className="a">{mo.sollCents === 0 ? '-' : fmtEuro(mo.sollCents)}</span>
                        {partial && mo.sollCents !== 0 && <span className="m">{partial}</span>}
                        {notRecorded && mo.sollCents !== 0 && <span className="m">nicht erfasst</span>}
                        {later && <span className="m">{later}</span>}
                        {via && <span className="m">über die Abrechnung</span>}
                      </>
                    )
                    // Ein Monat mit offenem Rest ist ein Knopf, damit er auch per Tastatur die Zahlung
                    // öffnet; der Zusatz steht unsichtbar hinter dem sichtbaren Text (WCAG 2.5.3).
                    // Später bezahlt (`paidLaterOn`): nichts mehr zu buchen, also kein Knopf (Durchsicht, Befund 4).
                    if (!notRecorded && !mo.paidLaterOn && mo.sollCents - mo.paidCents > 0) {
                      return (
                        <button
                          type="button"
                          key={mo.month}
                          className={`rent-month ${cls}`}
                          title={detail}
                          onClick={() => bookMonth(r.tenancyId, mo)}
                        >
                          {content}
                          <span className="sr-only">{`: gezahlt ${fmtEuro(mo.paidCents)}${mo.status === 'notDue' ? ', zählt noch nicht als Rückstand' : ''}${parts ? `, ${parts}` : ''}${via ? `, ${via}` : ''}${dueText ? `, ${dueText}` : ''}, Zahlung erfassen`}</span>
                        </button>
                      )
                    }
                    return (
                      <div key={mo.month} className={`rent-month ${cls}`} title={detail}>
                        {content}
                        {dueText && <span className="sr-only">{`, ${dueText}`}</span>}
                      </div>
                    )
                  })}
                </div>
                {/* Was an teilweise bezahlten Monaten offen ist (#281, E4): die Reihenfolge der Tilgung sichtbar. */}
                {partialLines.length > 0 && <p className="muted">{partialLines.join('; ')}</p>}
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
                    {/* Zeilenende (#281, E4): Endsaldo zum 31.12., darunter getrennt Rückstand und nicht mehr einzeln
                        einforderbarer Teil. */}
                    {closingLines(r, year).map((line) => (
                      <tr key={line.label}>
                        <td>{line.label === `Stand 31.12.${year}` ? <strong>{line.label}</strong> : line.label}</td>
                        <td className="num" style={{ color: line.tone === 'red' ? 'var(--red)' : line.tone === 'green' ? 'var(--green)' : 'var(--muted)' }}>
                          {fmtEuro(line.cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {notes.map((n) => <NoticeBox key={n.text} level={n.level} action={n.text} />)}
                {(r.designatedOutside?.length ?? 0) > 0 && (
                  <NoticeBox level="hint" action={`Bei ${r.designatedOutside?.length === 1 ? 'einer Zahlung' : `${r.designatedOutside?.length} Zahlungen`} liegt der Monat laut Verwendungszweck außerhalb des Mietverhältnisses oder vor dem Beginn des Mietkontos; Mietfuchs verteilt sie deshalb nach der gesetzlichen Reihenfolge. Prüfen Sie Beginn und Ende des Mietverhältnisses oder den Monat an der Zahlung.`} />
                )}
              </>
            )}
          </Card>
        )
      })}

      {ledger && (ledger.settlementOnly?.length ?? 0) > 0 && (
        <Card title="Abrechnung früherer Mietverhältnisse">
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
        </Card>
      )}

      {/* Ein Rückstand eines Ausgezogenen verschwindet nicht (#281, E2). */}
      {ledger && (ledger.carriedOnly?.length ?? 0) > 0 && (
        <Card title="Offene Salden früherer Mietverhältnisse">
          <p className="muted">Mietverhältnisse, die vor {year} endeten und zum 31.12.{year} noch offen sind.</p>
          {(ledger.carriedOnly ?? []).map((r) => (
            <div key={r.tenancyId}>
              <p>{carriedText(r)} <span className="muted">· {r.unitName}</span></p>
              {notDemandableNotes(r.notDemandable ?? []).map((n) => <NoticeBox key={n.text} level={n.level} action={n.text} />)}
            </div>
          ))}
        </Card>
      )}

      <Card title={<>Zahlungseingänge {year}</>}>
        {yearPayments.length === 0 ? (
          <div className="empty">Noch keine Zahlungen für {year} erfasst. Zahlen die Mieter pünktlich, erfassen Sie alle Monate mit „Monate als bezahlt erfassen …“ in einem Schritt.</div>
        ) : (
          <>
          {/* „Für Monat“ (#281): leer heißt nach gesetzlicher Reihenfolge; die Hilfe steht einmal über der Tabelle. */}
          <p className="muted">{`Für Monat: ${DESIGNATED_MONTH_HINT} Leer heißt: nach gesetzlicher Reihenfolge.`}</p>
          <Table className="stacked">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Mietverhältnis</th>
                <th>Art</th>
                <th>Für Monat</th>
                <th>Notiz</th>
                <th className="num">Betrag</th>
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {yearPayments.map((p) => (
                <PaymentRow key={p.id} payment={p} tenancyName={tenancyName(p.tenancyId)} onSaved={load} onDelete={deletePayment}
                  outside={ledger?.rows.some((r) => r.designatedOutside?.includes(p.id)) ?? false} />
              ))}
            </tbody>
          </Table>
          </>
        )}
      </Card>
    </>
  )
}

// Eine Zeile der Zahlungseingänge (#281, #309): Art und Monat laut Verwendungszweck sind ein Entwurf mit „Speichern“
// und „Verwerfen“, wie die übrigen Auswahlfelder; nichts speichert beim Anklicken. Eine Umstellung der Art fragt vor dem
// Speichern (kindChangeQuestion), denn sie verschiebt den Betrag zwischen den Monaten und „gesondert“. Gesendet wird nur,
// was sich geändert hat (paymentChangeBody).
function PaymentRow({ payment: p, tenancyName, outside, onSaved, onDelete }: {
  payment: PaymentListItem
  tenancyName: string
  // Der Monat laut Verwendungszweck liegt außerhalb des Mietverhältnisses (wirkt wie keine Bestimmung).
  outside: boolean
  onSaved: () => Promise<unknown>
  onDelete: (p: PaymentListItem) => void
}) {
  const confirm = useConfirm()
  const toast = useToast()
  const saved: PaymentDraft = { kind: p.kind, month: p.designatedMonth ?? '' }
  const draft = useDraft(saved, { scope: p.id })
  const value = draft.value
  const what = `Zahlung vom ${fmtDate(p.date)}`
  async function save(v: PaymentDraft): Promise<unknown> {
    const built = paymentChangeBody(p, v)
    if ('problem' in built) throw new Error(built.problem)
    if (built.body.kind !== undefined) {
      const ok = await confirm({ ...kindChangeQuestion(p, built.body.kind, fmtDate(p.date)), confirmLabel: 'Art umstellen' })
      if (!ok) return keepDraft
    }
    if (Object.keys(built.body).length === 0) return undefined
    await api(`/api/payments/${p.id}`, { method: 'PUT', body: JSON.stringify(built.body) })
    await onSaved()
    toast(built.body.kind !== undefined
      ? `${what} ist jetzt „${PAYMENT_KIND_OPTIONS.find((o) => o.value === built.body.kind)?.label ?? built.body.kind}“.`
      : `${what} gespeichert.`)
    return undefined
  }
  return (
    // Mittig, weil die Auswahl „Art“ höher ist als eine Textzeile: oben ausgerichtet stand der Text über ihrer Mitte
    // (N6 aus #341)
    <tr className="*:align-middle">
      <td data-label="Datum">{fmtDate(p.date)}</td>
      <td data-label="Mietverhältnis">{tenancyName}</td>
      <td data-label="Art">
        {/* Der Wert ist der gezeigte; ein unbekannter stünde sonst als erster Eintrag da. */}
        {/* Eine Zahlung aus der Kaution (#228): Die Art ändert nur die Kautionsbuchung, hier steht sie als Text. */}
        {p.fromDeposit ? <span>{PAYMENT_KIND_LABELS[p.kind]}</span> : <>
        <span className="print-only">{PAYMENT_KIND_LABELS[p.kind]}</span>
        <select
          className="no-print"
          aria-label={`Art der ${what}`}
          value={value.kind}
          onChange={(e) => {
            const kind = PAYMENT_KIND_OPTIONS.find((o) => o.value === e.target.value)?.value
            if (kind) draft.set({ ...value, kind })
          }}
        >
          {PAYMENT_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{PAYMENT_KIND_LABELS[o.value]}</option>)}
        </select>
        </>}
      </td>
      <td data-label="Für Monat">
        {value.kind === 'rent' ? (
          <>
            <span className="print-only">{p.designatedMonth ? monthLabel(p.designatedMonth) : '–'}</span>
            <MonthField className="no-print" label={<span className="sr-only">Für Monat (laut Verwendungszweck), {what}</span>}
              value={value.month} placeholder="kein Monat" start={p.date}
              onChange={(month) => draft.set({ ...value, month })} />
            {outside && <span className="muted">außerhalb des Mietverhältnisses oder vor dem Mietkonto, verteilt nach gesetzlicher Reihenfolge</span>}
          </>
        ) : <span className="muted">gilt dem Saldo</span>}
        <DraftActions draft={draft} onSave={save} what={what} />
      </td>
      <td className="muted" data-label="Notiz">{p.note ?? ''}</td>
      <td className="num" data-label="Betrag">
        {fmtEuro(p.amountCents)}
        {p.fromDeposit && <div><small className="muted">aus der Kaution; ändern Sie sie unter Stammdaten bei „Kaution führen“</small></div>}
        {p.fromBank && <div><small className="muted">aus dem Kontoauszug</small></div>}
      </td>
      <td className="actions no-print">
        <button className="icon-btn danger" title="Löschen" aria-label="Zahlung löschen" onClick={() => onDelete(p)}>🗑</button>
      </td>
    </tr>
  )
}
