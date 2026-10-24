// „In die Staffel übernehmen“ (#317): Auf einer abgeschlossenen Abrechnung je Mieter, was das Anschreiben an neuer
// Vorauszahlung ankündigt, ob es in der Staffel steht, und ein Knopf, der es dort als Stufe einträgt (je Mieter und für
// alle). Den Plan rechnet der Server; übernommen wird nur mit seiner Marke, nach einer Rückfrage, wo es etwas zu fragen gibt.
import { useCallback, useEffect, useState } from 'react'
import type { PrepaymentStepPlan } from '../types'
import { api, ApiError, errorText, fmtEuro } from '../api'
import { withProperty } from '../property'
import { monthLabel } from '../monthText'
import { localToday } from '../periodForm'
import { overdueItems, overdueText, pendingItems, scheduleLabel, stepQuestion, stepStatus } from '../prepaymentSteps'
import Card from './Card'
import Drawer from './Drawer'
import MonthField from './MonthField'
import { NoticeBox } from './Notice'
import { useConfirm, useToast } from './feedback'
import { useFormError } from './ErrorSummary'
import { useSaving } from '../useSaving'

type Props = {
  // `/api/settlement/<Zeitraum>` bzw. `/api/heating-settlement/<Anlage>/<Heizperiode>`
  path: string
  propertyId: string | null
  // nach dem Übernehmen: Stammdaten neu laden
  onSaved: () => Promise<void> | void
}

export default function PrepaymentStepsCard({ path, propertyId, onSaved }: Props) {
  const [plan, setPlan] = useState<PrepaymentStepPlan | null>(null)
  const [chosen, setChosen] = useState<string[] | null>(null)
  const [months, setMonths] = useState<Record<string, string>>({})
  const errors = useFormError<string>()
  const { busy, run } = useSaving()
  const confirm = useConfirm()
  const toast = useToast()

  // Ein älterer Server oder eine Testattrappe liefert etwas anderes; dann zeigt die Karte nichts.
  const fetchPlan = useCallback(async (m: Record<string, string>): Promise<PrepaymentStepPlan | null> => {
    const p = await api<unknown>(withProperty(`${path}/prepayment-steps/plan`, propertyId), { method: 'POST', body: JSON.stringify({ months: m }) })
    return p !== null && typeof p === 'object' && Array.isArray(Reflect.get(p, 'items')) ? (p as PrepaymentStepPlan) : null
  }, [path, propertyId])
  useEffect(() => {
    fetchPlan({}).then(setPlan).catch(() => setPlan(null))
  }, [fetchPlan])

  // Ein geänderter Monat: neu planen, sobald er ein Monat ist; die Prüfung des Servers steht dann am Feld.
  function changeMonth(id: string, value: string) {
    const next = { ...months, [id]: value }
    setMonths(next)
    if (!/^\d{4}-\d{2}$/.test(value)) return
    const valid = Object.fromEntries(Object.entries(next).filter(([, v]) => /^\d{4}-\d{2}$/.test(v)))
    fetchPlan(valid).then((p) => { if (p) setPlan(p); errors.clearField(id) }).catch((e: unknown) => errors.report([{ field: id, short: errorText(e), text: errorText(e) }]))
  }

  function open(ids: string[]) {
    setMonths({})
    setChosen(ids)
    void fetchPlan({}).then((p) => { if (p) setPlan(p) }).catch(() => {})
  }

  function save() {
    if (!plan || !chosen) return
    void run(async () => {
      const lines = stepQuestion(plan, chosen)
      if (lines) {
        const ok = await confirm({
          title: 'Trotzdem in die Staffel übernehmen?',
          message: <ul className="m-0">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>,
          confirmLabel: 'Übernehmen',
          defaultChoice: 'cancel',
        })
        if (!ok) return
      }
      const valid = Object.fromEntries(Object.entries(months).filter(([, v]) => /^\d{4}-\d{2}$/.test(v)))
      try {
        await api(withProperty(`${path}/prepayment-steps`, propertyId), { method: 'POST', body: JSON.stringify({ tenancyIds: chosen, months: valid, token: plan.token }) })
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.data.plan) {
          setPlan(e.data.plan as PrepaymentStepPlan)
          errors.show('Der Stand hat sich geändert. Bitte prüfen Sie die Angaben und speichern Sie noch einmal.')
          return
        }
        errors.show(`Nicht übernommen: ${errorText(e)}`)
        return
      }
      setChosen(null)
      setPlan(await fetchPlan({}))
      await onSaved()
      toast('In die Staffel übernommen.')
    })
  }

  if (!plan || plan.items.length === 0) return null
  const pending = pendingItems(plan)
  const overdue = overdueText(overdueItems(plan))
  const shown = chosen ? plan.items.filter((it) => chosen.includes(it.tenancyId)) : []
  return (
    <Card
      title="Angekündigte Anpassung der Vorauszahlung"
      className="no-print"
      aside={pending.length > 1 ? <button className="btn secondary" onClick={() => open(pending.map((it) => it.tenancyId))}>Alle in die Staffel übernehmen</button> : undefined}
    >
      <p className="muted">Das Anschreiben kündigt die neue Vorauszahlung an (§ 560 Abs. 4 BGB). Hier tragen Sie sie als Stufe in die Staffel des Mietverhältnisses ein; den Monat können Sie dabei ändern.</p>
      {overdue && <NoticeBox level="warning" title="Angekündigt, aber nicht übernommen" action={overdue} />}
      <ul className="m-0">
        {plan.items.map((it) => (
          <li key={it.tenancyId}>
            <strong>{it.tenantName}</strong> ({it.unitName}): {stepStatus(it)}{' '}
            {it.state === 'pending' && <button className="btn small secondary" onClick={() => open([it.tenancyId])}>In die Staffel übernehmen<span className="sr-only">{` (${it.tenantName})`}</span></button>}
          </li>
        ))}
      </ul>
      {chosen && (
        <Drawer
          open
          title="In die Staffel übernehmen"
          onClose={() => setChosen(null)}
          onSubmit={save}
          value={months}
          busy={busy}
          errors={errors}
          hint="Strg+S speichert · Esc schließt"
          actions={<button className="btn" onClick={save} disabled={busy || shown.every((it) => it.state !== 'pending')}>Speichern</button>}
        >
          <p className="muted">
            Vorgabe ist der Monat, den das Schreiben nennt. § 560 Abs. 4 BGB nennt keine Frist; nach AG Mannheim, Urteil vom
            06.02.2008, 8 C 552/06, Rn. 29 wirkt die Anpassung zum nächsten Fälligkeitstermin. Ging das Schreiben spät zu, prüfen Sie den Monat.
          </p>
          {shown.map((it) => (
            <div key={it.tenancyId} className="letter-edit">
              <h3 className="m-0 text-l">{it.tenantName} ({it.unitName})</h3>
              <p className="m-0">{`${scheduleLabel(it)}: ${fmtEuro(it.cents)} statt ${fmtEuro(it.currentCents)}`}</p>
              {it.state === 'blocked' && <NoticeBox level="warning" action={it.blocked} />}
              {it.state === 'taken' && <p className="muted m-0">Steht schon in der Staffel.</p>}
              {it.state === 'pending' && (
                <MonthField
                  label="Ab Monat"
                  value={months[it.tenancyId] ?? it.from}
                  onChange={(v) => changeMonth(it.tenancyId, v)}
                  today={localToday()}
                  width="s"
                  required
                  {...errors.field(it.tenancyId)}
                />
              )}
              {it.state === 'pending' && it.existing.length > 0 && (
                <p className="muted m-0">{`Schon in der Staffel ab ${monthLabel(it.from)}: ${it.existing.map((e) => `${fmtEuro(e.monthlyCents)} ab ${monthLabel(e.from)}`).join(', ')}.`}</p>
              )}
              {it.state === 'pending' && it.notes.map((n, i) => <NoticeBox key={i} level="hint" action={n} />)}
            </div>
          ))}
        </Drawer>
      )}
    </Card>
  )
}
