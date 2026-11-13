// Karte „Konten“ der Seite „Kontoauszug“ (#188, Teil 3): je Konto Bezeichnung, IBAN, Art, der Satz zur Lückenlosigkeit
// und die Importe mit „Zurücknehmen …“. „Nur für die Vermietung …“ fragt ausdrücklich nach, denn ab dann wird jeder
// Umsatz einzeln gespeichert.
import { api, errorText, fmtDate } from '../api'
import { coverageText } from '../bankView'
import type { BankAccountInfo } from '../types'
import Card from './Card'
import { useConfirm, useToast } from './feedback'

export const RENTAL_QUESTION = 'Ab jetzt wird jeder Umsatz dieses Kontos einzeln gespeichert, auch ein privater. Das gilt für künftige Auszüge; was bisher nur als Tagessumme steht, bleibt so.'

export default function BankAccountsCard({ accounts, onChanged }: { accounts: readonly BankAccountInfo[]; onChanged: () => void }) {
  const confirm = useConfirm()
  const toast = useToast()
  const run = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work()
      toast(done)
      onChanged()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  return (
    <Card title="Konten">
      {accounts.map((a) => (
        <section key={a.id} className="stack" aria-label={a.label}>
          <h3 className="m-0">{a.label}</h3>
          <p className="m-0">{a.iban ?? a.otherId}{' · '}{a.kind === 'mixed' ? 'Mischkonto: Private Umsätze stehen nur als Tagessumme da.' : 'nur für die Vermietung: Jeder Umsatz wird einzeln gespeichert.'}</p>
          <p className="m-0">{coverageText(a)}</p>
          <ul>
            {a.imports.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline gap-2">
                <span>{`${fmtDate(i.fromDate)} bis ${fmtDate(i.toDate)}, ${i.fileName}, eingelesen am ${fmtDate(i.importedAt.slice(0, 10))}`}</span>
                <button type="button" className="btn ghost danger-ghost ml-auto" onClick={() => void (async () => {
                  const ok = await confirm({
                    title: 'Import zurücknehmen?',
                    message: 'Die Umsätze und Tagessummen dieses Auszugs werden entfernt; danach lässt er sich neu einlesen. Zahlungen im Mietkonto bleiben.',
                    confirmLabel: 'Zurücknehmen',
                    danger: true,
                  })
                  if (ok) await run(() => api(`/api/bank/imports/${i.id}`, { method: 'DELETE' }), 'Import zurückgenommen.')
                })()}>Zurücknehmen …<span className="sr-only">{` ${i.fileName}`}</span></button>
              </li>
            ))}
          </ul>
          {a.kind === 'mixed' && (
            <div>
              <button type="button" className="btn secondary" onClick={() => void (async () => {
                const ok = await confirm({ title: 'Konto nur für die Vermietung?', message: RENTAL_QUESTION, confirmLabel: 'Umstellen' })
                if (ok) await run(() => api(`/api/bank/accounts/${a.id}`, { method: 'PUT', body: JSON.stringify({ kind: 'rental', confirm: true }) }), 'Das Konto gilt jetzt als Konto nur für die Vermietung.')
              })()}>Nur für die Vermietung …</button>
            </div>
          )}
        </section>
      ))}
    </Card>
  )
}
