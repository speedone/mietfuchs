// Ein Beleg, an dem die KI gescheitert ist, der aber gespeichert ist (Fehler mit Ausweg, #487): kein roter
// Fehler, sondern der Grund in einem Satz, der Ausweg und drei Knöpfe. Der genaue Satz des Servers steht unter
// „Mehr dazu“. Gemeinsam für den Eingang der Seite Belege und die Kosten; Sätze in aiFailure.ts.
import type { AiFailure } from '../types'
import { KEPT_NEXT, KEPT_TITLE, failureSentence, offersAiSettings } from '../aiFailure'
import { NoticeBox } from './Notice'

type Props = {
  failure: AiFailure
  // Von Hand erfassen: vorerst zur Karte des Belegs im Eingang (Zuordnen), ins Kostenformular mit #490 PR 3
  onManual?: (file: string) => void
  onRetry: () => void
  onOpenSettings?: () => void
}

export function KeptReceipt({ failure, onManual, onRetry, onOpenSettings }: Props) {
  return (
    <NoticeBox level="hint" title={KEPT_TITLE} action={`${failureSentence(failure)} ${KEPT_NEXT}`}
      more={failure.error ? <p className="muted">{failure.error}</p> : null}>
      <div className="flex flex-wrap items-center gap-2">
        {onManual && <button type="button" className="btn" onClick={() => onManual(failure.file)}>Von Hand erfassen</button>}
        <button type="button" className="btn secondary" onClick={onRetry}>Erneut versuchen</button>
        {onOpenSettings && offersAiSettings(failure.reason) && (
          <button type="button" className="btn ghost" onClick={onOpenSettings}>KI-Einstellungen öffnen</button>
        )}
      </div>
    </NoticeBox>
  )
}
