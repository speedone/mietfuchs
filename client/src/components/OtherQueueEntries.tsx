// Belege der Warteschlange, die in einem anderen Objekt oder Zeitraum hochgeladen wurden (#490, Abschnitt „Filter“):
// eine Zeile mit ihrer Zahl und einem Sprung dorthin. Die Einträge selbst stehen auf der Seite ihres Objekts und
// Zeitraums, denn dort werden sie gebucht.
import { belongsTo, isOpenEntry, type QueueEntry } from '../evaluationQueue'
import { useProperty } from '../property'
import { useSwitchTo } from '../period'
import { labelOfKey } from '../periodForm'
import { parsePeriodKey, rulesOf } from '../../../shared/period.ts'
import { plural } from '../../../shared/wording.ts'

type Group = { propertyId: string | undefined; period: string | undefined; count: number }

export function groupOthers(queue: readonly QueueEntry[], propertyId: string | undefined, period: string | undefined): Group[] {
  const groups: Group[] = []
  for (const entry of queue) {
    if (belongsTo(entry, propertyId, period) || !isOpenEntry(entry)) continue
    const group = groups.find((g) => g.propertyId === entry.propertyId && g.period === entry.period)
    if (group) group.count++
    else groups.push({ propertyId: entry.propertyId, period: entry.period, count: 1 })
  }
  return groups
}

export function OtherQueueEntries({ queue, propertyId, period }: { queue: readonly QueueEntry[]; propertyId: string | undefined; period: string | undefined }) {
  const { properties } = useProperty()
  const switchTo = useSwitchTo()
  const groups = groupOthers(queue, propertyId, period)
  if (groups.length === 0) return null
  const where = (g: Group) => {
    const target = properties.find((p) => p.id === g.propertyId)
    const key = g.period ? parsePeriodKey(g.period) : null
    const when = key ? labelOfKey(rulesOf(target ?? null), key) : null
    const name = g.propertyId !== propertyId ? `„${target?.name || 'Ohne Namen'}“` : null
    return [name, when].filter(Boolean).join(', ')
  }
  return (
    <div className="row center no-print" role="group" aria-label="Belege in anderen Objekten und Zeiträumen">
      <span className="muted">In Arbeit an anderer Stelle:</span>
      {groups.map((g) => (
        <button key={`${g.propertyId ?? ''}:${g.period ?? ''}`} type="button" className="btn small ghost" onClick={() => void switchTo(g.propertyId, g.period)}>
          {g.count} {plural(g.count, 'Beleg', 'Belege')} bei {where(g)} →
        </button>
      ))}
    </div>
  )
}
