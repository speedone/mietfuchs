// Karte „Konten“ der Seite „Kontoauszug“ (#188, Teil 3): je Konto Bezeichnung, IBAN, Art, der Satz zur Lückenlosigkeit
// und die Importe mit „Zurücknehmen …“. „Nur für die Vermietung …“ fragt ausdrücklich nach, denn ab dann wird jeder
// Umsatz einzeln gespeichert.
import { api, errorText, fmtDate } from '../api'
import { coverageText } from '../bankView'
import type { BankAccountInfo } from '../types'
import Card from './Card'
import { useConfirm, useToast } from './feedback'
import Term from './Term'

export const MIXED_QUESTION = 'Künftige Auszüge speichern private Umsätze wieder nur als Tagessumme. Bisher einzeln gespeicherte Umsätze bleiben, auch in Verlauf und Sicherungen; ein Rücksprung oder ein Backup stellt die Bestätigung nicht wieder her.'
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
          <p className="m-0">{a.iban ?? a.otherId}{' · '}{a.kind === 'mixed'
            ? <><Term id="mixedAccount">Mischkonto</Term>: Private Umsätze stehen nur als Tagessumme da.</>
            : <><Term id="rentalAccount">nur für die Vermietung</Term>: Jeder Umsatz wird einzeln gespeichert.</>}</p>
          <p className="m-0">{coverageText(a)} <Term id="bankCoverage">Was heißt lückenlos?</Term></p>
          <ul>
            {a.imports.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline gap-2">
                <span>{`${fmtDate(i.fromDate)} bis ${fmtDate(i.toDate)}, ${i.fileName}, eingelesen am ${fmtDate(i.importedAt.slice(0, 10))}`}</span>
                <button type="button" className="btn ghost danger-ghost ml-auto" onClick={() => void (async () => {
                  const ok = await confirm({
                    title: 'Import zurücknehmen?',
                    message: 'Die Umsätze und Tagessummen dieses Auszugs werden entfernt; danach lässt er sich neu einlesen. Sind Umsätze daraus schon Zahlungen zugeordnet, lösen Sie zuerst diese Zuordnungen.',
                    confirmLabel: 'Zurücknehmen',
                    danger: true,
                  })
                  if (ok) await run(() => api(`/api/bank/imports/${i.id}`, { method: 'DELETE' }), 'Import zurückgenommen.')
                })()}>Zurücknehmen …<span className="sr-only">{` ${i.fileName}`}</span></button>
              </li>
            ))}
          </ul>
          {a.kind === 'rental' && (
            <div>
              {/* Ein Widerruf (Integrationsdurchsicht D3): ab dann wieder Mischkonto; Rücksprung und Backup holen die
                  Bestätigung nicht zurück. */}
              <button type="button" className="btn secondary" onClick={() => void (async () => {
                const ok = await confirm({ title: 'Zurück zum Mischkonto?', message: MIXED_QUESTION, confirmLabel: 'Zurückstellen' })
                if (ok) await run(() => api(`/api/bank/accounts/${a.id}`, { method: 'PUT', body: JSON.stringify({ kind: 'mixed' }) }), 'Das Konto gilt wieder als Mischkonto.')
              })()}>Zurück zum Mischkonto …</button>
            </div>
          )}
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
