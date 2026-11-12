// Das Seitenfenster „Kaution“ eines Mietverhältnisses (#228): Stand in einem Satz, die Kautionsbuchungen und das
// Formular für eine neue. Logik in depositForm.ts und shared/deposit.ts; gespeichert wird je Buchung über
// /api/deposit-entries, der Aufrufer lädt danach neu (`onChanged`).
import { useState } from 'react'
import { depositState } from '../../../shared/deposit.ts'
import { api, errorText, fmtDate, fmtEuro } from '../api'
import {
  DEPOSIT_KIND_OPTIONS, DEPOSIT_PURPOSE_OPTIONS, NO_MONEY_FORM_TEXT, depositEntryBody, depositKindText, depositStateText, emptyDepositForm, formWithoutMoney,
  signedCents, withKind, type DepositField,
} from '../depositForm'
import { localToday } from '../periodForm'
import type { DepositEntry, Tenancy } from '../types'
import { useSaving } from '../useSaving'
import Drawer from './Drawer'
import { useFormError } from './ErrorSummary'
import { useConfirm, useToast } from './feedback'
import Field from './Field'
import Table from './Table'

export default function DepositDrawer({ tenancy, entries, onChanged, onClose }: {
  tenancy: Tenancy
  entries: DepositEntry[]
  onChanged: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState(() => emptyDepositForm(localToday()))
  const errors = useFormError<DepositField>()
  const saving = useSaving()
  const toast = useToast()
  const confirm = useConfirm()
  const state = depositState(tenancy, entries)

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
      message: `${depositKindText(entry)} vom ${fmtDate(entry.date)} über ${fmtEuro(entry.amountCents)} wird gelöscht. Der Stand der Kaution rechnet sich neu.`,
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
    <Drawer key={tenancy.id} open title={`Kaution von ${tenancy.tenantName}`} width={620} cancelLabel="Schließen"
      onClose={onClose} value={form} busy={saving.busy} errors={errors} onSubmit={() => void saving.run(create)}
      actions={<button className="btn" disabled={saving.busy} onClick={() => void saving.run(create)}>Anlegen</button>}>
      <p className="m-0">{depositStateText(state, tenancy)}</p>
      {formWithoutMoney(tenancy) && <p className="muted">{NO_MONEY_FORM_TEXT}</p>}
      {entries.length > 0 && (
        <Table aria-label="Kautionsbuchungen">
          <thead>
            <tr><th>Datum</th><th>Art</th><th className="num">Betrag</th><th>Notiz</th><th><span className="sr-only">Aktion</span></th></tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.date)}</td>
                <td>{depositKindText(e)}</td>
                <td className="num">{fmtEuro(signedCents(e))}</td>
                <td>{e.note ?? ''}</td>
                <td><button className="btn small ghost danger-ghost" disabled={saving.busy} onClick={() => void remove(e)}>Löschen …</button></td>
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
          <Field label="Verrechnet mit" required {...errors.field('purpose')}
            hint="Die Verrechnung mit einem Mietrückstand oder einer Nachzahlung aus der Abrechnung folgt mit einer späteren Version.">
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
