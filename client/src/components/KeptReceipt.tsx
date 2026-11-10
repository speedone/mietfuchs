// Ein Beleg, an dem die KI gescheitert ist, der aber gespeichert ist (Fehler mit Ausweg, #487): kein roter
// Fehler, sondern der Grund in einem Satz, der Ausweg und drei Knöpfe. Der genaue Satz des Servers steht unter
// „Mehr dazu“. Gemeinsam für den Eingang der Seite Belege und die Kosten; Sätze in aiFailure.ts.
import type { AiFailure } from '../types'
import { KEPT_NEXT, KEPT_NEXT_E_INVOICE, KEPT_TITLE, failureSentence, offersAiSettings } from '../aiFailure'
import { NoticeBox } from './Notice'

type Props = {
  failure: AiFailure
  // Von Hand erfassen: ins Kostenformular mit dem Beleg (#490 PR 3); bei Zählerfoto und Lieferung das passende Formular
  onManual?: (file: string) => void
  onRetry: () => void
  onOpenSettings?: () => void
}

// Eine E-Rechnung als XML-Datei (#189, `e-invoice`): Gefragt wurde keine KI, und ein neuer Versuch ändert nichts.
function actionText(failure: AiFailure): string {
  if (failure.reason === 'e-invoice') return `Die E-Rechnung wird nicht übernommen: ${failure.eInvoiceRefusal ?? ''} ${KEPT_NEXT_E_INVOICE}`
  return `${failure.eInvoiceRefusal ? `Die E-Rechnung im PDF wird nicht übernommen: ${failure.eInvoiceRefusal} ` : ''}${failureSentence(failure)} ${KEPT_NEXT}`
}

export function KeptReceipt({ failure, onManual, onRetry, onOpenSettings }: Props) {
  return (
    <NoticeBox level="hint" title={KEPT_TITLE}
      action={actionText(failure)}
      more={failure.error ? <p className="muted">{failure.error}</p> : null}>
      <div className="flex flex-wrap items-center gap-2">
        {onManual && <button type="button" className="btn" onClick={() => onManual(failure.file)}>Von Hand erfassen</button>}
        {failure.reason !== 'e-invoice' && <button type="button" className="btn secondary" onClick={onRetry}>Erneut versuchen</button>}
        {onOpenSettings && offersAiSettings(failure.reason) && (
          <button type="button" className="btn ghost" onClick={onOpenSettings}>KI-Einstellungen öffnen</button>
        )}
      </div>
    </NoticeBox>
  )
}
