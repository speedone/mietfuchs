// Die Zelle „Umlageschlüssel“ einer ausgewerteten Position („Auswertung prüfen“, #141, #170).
// Die Auswahl zeigt den gemerkten Schlüssel als Eintrag, auch wenn er nicht unter den drei
// einfachen steht: Angezeigt wird, was gespeichert wird. Bei „laut Gemeinschaftsabrechnung“ steht
// darunter das Feld für die Kosten der Gemeinschaft im Jahr.
import type { CostKey, Unit } from '../types'
import { KEY_LABELS, METER_TYPE_LABELS, isNotAllocable } from '../types'
import type { Allocation } from '../../../shared/allocation.ts'
import { aiKeyOptions } from '../costForm'

// Was die Zelle von einer Zeile liest und ändert.
export type KeyCellValue = { category: string; key: CostKey; allocation: Allocation | null; externalTotalAmount: string }

type Props = {
  position: KeyCellValue
  units: Unit[]
  onChange: (patch: Partial<KeyCellValue>) => void
}

export default function AiKeyCell({ position: p, units, onChange }: Props) {
  // Nicht umlagefähig (#142): verteilt wird nie, also kein Schlüssel.
  if (isNotAllocable(p.category)) return <span className="muted">— trägt der Vermieter</span>
  const a = p.allocation && p.allocation.key === p.key ? p.allocation : null
  const names = (ids: string[]) => ids.map((id) => units.find((u) => u.id === id)?.name ?? '?').join(', ')
  return (
    <>
      {/* Wechselt jemand den Schlüssel, gilt der gemerkte nicht mehr. */}
      <select aria-label="Umlageschlüssel" value={p.key} onChange={(e) => onChange({ key: e.target.value as CostKey, allocation: null })}>
        {aiKeyOptions(p.key).map((k) => <option key={k} value={k}>{KEY_LABELS[k]}</option>)}
      </select>
      {/* Hervorgehoben (Durchsicht): Diese Zeile trifft nur einzelne Wohnungen und ist deshalb
          nicht vorab angehakt. */}
      {a?.participantUnitIds && <div><span className="chip gelb">nur {names(a.participantUnitIds)}</span></div>}
      {a?.meterType && <div className="muted">{METER_TYPE_LABELS[a.meterType]}</div>}
      {a?.key === 'direct' && a.directUnitId && <div><span className="chip gelb">direkt {names([a.directUnitId])}</span></div>}
      {p.key === 'external' && (
        <input
          aria-label="Kosten der Gemeinschaft (ganze Anlage) €"
          value={p.externalTotalAmount}
          onChange={(e) => onChange({ externalTotalAmount: e.target.value })}
          placeholder="Kosten der Gemeinschaft €"
          inputMode="decimal"
          className="input-cell"
        />
      )}
    </>
  )
}
