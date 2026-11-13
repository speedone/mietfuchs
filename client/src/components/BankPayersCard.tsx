// Karte „Gemerkte Zahler“ der Seite „Kontoauszug“ (#188, Nachtrag 13.11.): Wer beim Einlesen „Dieses Konto als Zahler
// merken“ angehakt hat, sieht hier Name, IBAN und Mietverhältnis und kann es zurücknehmen. Danach fragt das nächste
// Einlesen bei dieser IBAN wieder nach; schon gespeicherte Umsätze und Zuordnungen bleiben.
import { api, errorText } from '../api'
import type { BankPayerView } from '../types'
import type { TenancyOption } from './BankImportDrawer'
import Card from './Card'
import { useConfirm, useToast } from './feedback'
import Term from './Term'

export const PAYER_REMOVE_QUESTION = 'Beim nächsten Einlesen fragt das Einlesen wieder nach, was ein Eingang von diesem Konto ist; auf einem Mischkonto bleibt ein privater Eingang dann nur in der Tagessumme. Schon gespeicherte Umsätze und Zuordnungen bleiben.'

export default function BankPayersCard({ payers, tenancies, onChanged }: {
  payers: readonly BankPayerView[]
  tenancies: readonly TenancyOption[]
  onChanged: () => void
}) {
  const confirm = useConfirm()
  const toast = useToast()
  const labelOf = (id: string) => tenancies.find((t) => t.id === id)?.label ?? 'Mietverhältnis nicht mehr vorhanden'
  return (
    <Card title="Gemerkte Zahler">
      <p className="muted m-0">Eingänge von diesen Konten ordnet das Einlesen ohne Rückfrage dem Mietverhältnis zu (<Term id="bankPayer">gemerkter Zahler</Term>).</p>
      <ul>
        {payers.map((p) => (
          <li key={p.id} className="flex flex-wrap items-baseline gap-2">
            {/* Der Name aus dem Auszug nur, wenn er nicht schon vorn im Mietverhältnis steht (Klicktest 13.11.). */}
            <span>{`${labelOf(p.tenancyId)}: Konto ${p.iban}${p.name && !labelOf(p.tenancyId).startsWith(p.name) ? ` (${p.name})` : ''}`}</span>
            <button type="button" className="btn ghost danger-ghost ml-auto" onClick={() => void (async () => {
              const ok = await confirm({ title: 'Gemerkten Zahler entfernen?', message: PAYER_REMOVE_QUESTION, confirmLabel: 'Entfernen', danger: true })
              if (!ok) return
              try {
                await api(`/api/bank/payers/${p.id}`, { method: 'DELETE' })
                toast('Gemerkten Zahler entfernt.')
                onChanged()
              } catch (e) {
                toast(errorText(e), 'error')
              }
            })()}>Entfernen …<span className="sr-only">{` ${p.name ?? p.iban}`}</span></button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
