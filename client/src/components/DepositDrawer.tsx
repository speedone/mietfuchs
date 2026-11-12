// Das Seitenfenster „Kaution“ eines Mietverhältnisses (#228): Stand in einem Satz, die Kautionsbuchungen und das
// Formular für eine neue. Logik in depositForm.ts und shared/deposit.ts; gespeichert wird je Buchung über
// /api/deposit-entries, der Aufrufer lädt danach neu (`onChanged`).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { depositState } from '../../../shared/deposit.ts'
import { api, errorText, fmtDate, fmtEuro } from '../api'
import {
  DEPOSIT_KIND_OPTIONS, DEPOSIT_PURPOSE_OPTIONS, NO_MONEY_FORM_TEXT, depositEntryBody, depositKindText, depositPurposeHint, depositStateText, emptyDepositForm, formWithoutMoney,
  holdBody, holdFormOf, signedCents, withKind, type DepositField, type DepositHoldField,
} from '../depositForm'
import { depositSettlement, type DepositSettlement } from '../depositSettlement'
import { localToday } from '../periodForm'
import type { DepositEntry, DepositStatementInfo, Tenancy } from '../types'
import { useSaving } from '../useSaving'
import Drawer from './Drawer'
import { ErrorSummary, useFormError } from './ErrorSummary'
import { useConfirm, useToast } from './feedback'
import Field from './Field'
import Table from './Table'

export default function DepositDrawer({ tenancy, entries, info, onChanged, onClose }: {
  tenancy: Tenancy
  entries: DepositEntry[]
  // Die letzte Abrechnung und was aussteht, für die Aufstellung zum Auszug (GET /api/deposit-entries/statements).
  info?: DepositStatementInfo
  // Nach jeder gespeicherten Änderung, auch am Einbehalt (der am Mietverhältnis steht): Der Aufrufer lädt neu.
  onChanged: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState(() => emptyDepositForm(localToday()))
  // Nach dem Anlegen baut sich das Fenster neu auf (Durchsicht G1): Das stehen gebliebene Datum ist dann der neue
  // Ausgangsstand, und „Schließen“ fragt nicht nach Änderungen, die keine sind.
  const [round, setRound] = useState(0)
  const errors = useFormError<DepositField>()
  const saving = useSaving()
  const toast = useToast()
  const confirm = useConfirm()
  const state = depositState(tenancy, entries)
  const [hold, setHold] = useState(() => holdFormOf(tenancy))
  const holdErrors = useFormError<DepositHoldField>()
  // Strg+S speichert, woran man gerade schreibt: im Einbehalt ihn, sonst die neue Buchung (Durchsicht G1).
  const holdSection = useRef<HTMLElement>(null)
  const settlement = depositSettlement(tenancy, entries, info, localToday())
  const [printing, setPrinting] = useState(false)
  // Gedruckt wird nur das Blatt (index.css, `print-deposit`), wie die monatliche Verbrauchsinformation: erst nach dem
  // Rendern, aufgeräumt nach dem Druck.
  useEffect(() => {
    if (!printing) return
    document.body.classList.add('print-deposit')
    const done = () => {
      document.body.classList.remove('print-deposit')
      setPrinting(false)
    }
    window.addEventListener('afterprint', done)
    const t = setTimeout(() => window.print(), 80)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', done)
      document.body.classList.remove('print-deposit')
    }
  }, [printing])

  async function saveHold() {
    const result = holdBody(hold)
    if ('problems' in result) {
      holdErrors.report(result.problems)
      return
    }
    try {
      await api(`/api/tenancies/${tenancy.id}`, { method: 'PUT', body: JSON.stringify(result.body) })
      holdErrors.set('')
      toast('Einbehalt gespeichert.')
      // Wie nach dem Anlegen: Der gespeicherte Stand ist der neue Ausgangsstand, „Schließen“ fragt nicht nach. Nicht, wenn
      // im Formular einer Buchung schon etwas steht (Abschlussdurchsicht G5).
      if (form.amount.trim() === '' && form.note.trim() === '' && form.kind === 'received') setRound((r) => r + 1)
      onChanged()
    } catch (e) {
      holdErrors.show(errorText(e))
    }
  }
  // Angezeigt nach Datum, am selben Tag in Einfügereihenfolge: Eine nachgetragene alte Rate steht an ihrem Platz.
  const shown = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  async function create() {
    const result = depositEntryBody(form, tenancy.id)
    if ('problems' in result) {
      errors.report(result.problems)
      return
    }
    try {
      await api('/api/deposit-entries', { method: 'POST', body: JSON.stringify(result.body) })
      // Das Fenster bleibt offen: Raten und Zinsen kommen oft in einem Zug. Das Datum bleibt stehen.
      setForm({ ...emptyDepositForm(localToday()), date: form.date })
      // Neu aufbauen nur, wenn der Einbehalt nichts Ungespeichertes trägt; sonst ginge er beim Schließen ohne Rückfrage
      // verloren (Abschlussdurchsicht G5).
      const savedHold = holdFormOf(tenancy)
      if (hold.amount === savedHold.amount && hold.note === savedHold.note) setRound((r) => r + 1)
      errors.set('')
      toast('Kautionsbuchung angelegt.')
      onChanged()
    } catch (e) {
      errors.show(errorText(e))
    }
  }

  async function remove(entry: DepositEntry) {
    const ok = await confirm({
      title: 'Kautionsbuchung löschen?',
      message: `${depositKindText(entry)} vom ${fmtDate(entry.date)} über ${fmtEuro(entry.amountCents)} wird gelöscht. Der Stand der Kaution rechnet sich neu.${entry.paymentId ? ' Die Zahlung im Mietkonto fällt mit weg.' : ''}`,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/deposit-entries/${entry.id}`, { method: 'DELETE' })
      errors.set('')
      onChanged()
    } catch (e) {
      errors.show(errorText(e))
    }
  }

  return (
    <Drawer key={`${tenancy.id}-${round}`} open title={`Kaution von ${tenancy.tenantName}`} width={620} cancelLabel="Schließen"
      onClose={onClose} value={{ form, hold }} busy={saving.busy} errors={errors}
      onSubmit={() => void saving.run(holdSection.current?.contains(document.activeElement) ? saveHold : create)}
      actions={<button className="btn" disabled={saving.busy} onClick={() => void saving.run(create)}>Anlegen</button>}>
      <p className="m-0">{depositStateText(state, tenancy)}</p>
      {settlement && (
        <section aria-label="Aufstellung zum Auszug" className="field-group" ref={holdSection}>
          <h3>Aufstellung zum Auszug</h3>
          <SettlementView settlement={settlement} />
          <ErrorSummary errors={holdErrors} />
          <Field label="Einbehalt €" {...holdErrors.field('holdAmount')} hint="Was Sie vorerst zurückhalten, etwa bis zur nächsten Nebenkostenabrechnung. Leer heißt keiner. Mehr als der Stand der Kaution zählt nicht.">
            <input value={hold.amount} inputMode="decimal" placeholder="z. B. 300,00" onChange={(e) => setHold({ ...hold, amount: e.target.value })} />
          </Field>
          <Field label="Grund" {...holdErrors.field('holdNote')}>
            <input value={hold.note} placeholder="z. B. Nebenkosten 2025" onChange={(e) => setHold({ ...hold, note: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <button className="btn secondary" disabled={saving.busy} onClick={() => void saving.run(saveHold)}>Einbehalt speichern</button>
            <button className="btn secondary" onClick={() => setPrinting(true)}>Aufstellung drucken</button>
          </div>
        </section>
      )}
      {printing && settlement && createPortal(
        <div className="deposit-print">
          <h2>Aufstellung zum Auszug</h2>
          <p>Kaution von {tenancy.tenantName}{tenancy.end ? `, ausgezogen am ${fmtDate(tenancy.end)}` : ''}. Stand vom {fmtDate(localToday())}.</p>
          <SettlementView settlement={settlement} printed />
        </div>,
        document.body,
      )}
      {formWithoutMoney(tenancy) && <p className="muted">{NO_MONEY_FORM_TEXT}</p>}
      {entries.length > 0 && (
        <Table aria-label="Kautionsbuchungen">
          <thead>
            <tr><th>Datum</th><th>Art</th><th className="num">Betrag</th><th>Notiz</th><th><span className="sr-only">Aktion</span></th></tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.date)}</td>
                <td>{depositKindText(e)}</td>
                <td className="num">{fmtEuro(signedCents(e))}</td>
                <td>{e.note ?? ''}</td>
                <td><button className="btn small ghost danger-ghost" disabled={saving.busy} onClick={() => void saving.run(() => remove(e))}>Löschen …</button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <h3>Neue Kautionsbuchung</h3>
      <div className="field-group">
        <Field label="Datum" required {...errors.field('date')}>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Art">
          <select value={form.kind} onChange={(e) => {
            const kind = DEPOSIT_KIND_OPTIONS.find((o) => o.value === e.target.value)?.value
            if (kind) setForm(withKind(form, kind))
          }}>
            {DEPOSIT_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        {form.kind === 'applied' && (
          <Field label="Verrechnet mit" required {...errors.field('purpose')} hint={depositPurposeHint(form.purpose) ?? undefined}>
            <select value={form.purpose} onChange={(e) => {
              const purpose = DEPOSIT_PURPOSE_OPTIONS.find((o) => o.value === e.target.value)?.value
              if (purpose) setForm({ ...form, purpose })
            }}>
              {DEPOSIT_PURPOSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Betrag €" required {...errors.field('amount')}>
          <input value={form.amount} inputMode="decimal" placeholder="z. B. 2.400,00" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field label="Notiz">
          <input value={form.note} placeholder="z. B. erste Rate, Zinsen 2025" onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  )
}

// Die Aufstellung selbst, gleich am Bildschirm und im Druck.
// Gedruckt geht das Blatt an den Mieter; „Ihnen“ hieße dort ihn (Durchsicht G2). Freie Notizen, die letzte Abrechnung
// und Ausstehendes sind Orientierung für den Vermieter und stehen nicht darauf (Abschlussdurchsicht G4).
function SettlementView({ settlement: s, printed = false }: { settlement: DepositSettlement; printed?: boolean }) {
  return (
    <>
      <Table aria-label="Buchungen der Kaution">
        <tbody>
          {s.rows.map((r, i) => (
            <tr key={i}><td>{fmtDate(r.date)}</td><td>{r.label}{r.note && !printed ? ` (${r.note})` : ''}</td><td className="num">{fmtEuro(r.cents)}</td></tr>
          ))}
        </tbody>
      </Table>
      <p className="m-0">{printed ? 'Beim Vermieter liegen' : 'Bei Ihnen liegen'} {fmtEuro(s.balanceCents)}.</p>
      {s.hold && <p className="m-0">Einbehalten: {fmtEuro(s.hold.cents)} ({s.hold.note})</p>}
      <p className="m-0"><strong>Bleibt auszuzahlen: {fmtEuro(s.payoutCents)}</strong></p>
      {!printed && s.lastStatement && <p className="muted m-0">{s.lastStatement}</p>}
      {!printed && s.pending.map((line) => <p key={line} className="muted m-0">{line}</p>)}
    </>
  )
}
