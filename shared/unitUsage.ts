// Die Nutzung einer Einheit als Staffel „ab Datum“ (#259). **Die eine Stelle für „Nutzung am Tag t“**:
// Abrechnung, Steuerübersicht und Oberfläche fragen nur diese Funktionen.
//
// Die erste Stufe ist die Angabe an der Einheit (`participates`/`selfUsed`, `baseUsage`); sie gilt vor
// dem ersten Wechsel. Jeder Eintrag in `usageChanges` gilt ab seinem Tag. Zwei Einträge am selben Tag:
// es gilt der letzte, wie bei den Staffeln der Mietverhältnisse (`lastPerFrom` in server/src/schedule.ts).
// Ohne Eintrag ist die Einheit, was sie vorher war; so ändert sich ohne Wechsel keine Zahl.
// Entwurf: docs/superpowers/specs/2026-10-23-nutzungswechsel-design.md

import type { Unit, UnitUsage, UsageChange } from './types.ts'

export type UsageUnit = Pick<Unit, 'participates' | 'selfUsed' | 'usageChanges'>
export type UsageSpan = { from: string; to: string; usage: UnitUsage; days: number }

export const UNIT_USAGES: readonly UnitUsage[] = ['vermietet', 'eigen', 'ausgenommen']

// `participates` hat Vorrang: eine vermietete Wohnung ist nie Eigennutzung, auch wenn ein von Hand
// bearbeiteter Bestand beide Kennzeichen trägt.
export function baseUsage(u: Pick<Unit, 'participates' | 'selfUsed'>): UnitUsage {
  if (u.participates) return 'vermietet'
  return u.selfUsed ? 'eigen' : 'ausgenommen'
}

export const usageFlags = (usage: UnitUsage): { participates: boolean; selfUsed: boolean } =>
  ({ participates: usage === 'vermietet', selfUsed: usage === 'eigen' })

const MS_DAY = 86400000
const dayNumber = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / MS_DAY)
const isoOf = (n: number): string => new Date(n * MS_DAY).toISOString().slice(0, 10)
const validDay = (d: unknown): d is string =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && isoOf(dayNumber(d)) === d

// Die Wechsel nach Datum, am selben Tag der letzte; ungültige fallen weg (krumm, nicht kaputt).
export function usageChangesOf(u: Pick<Unit, 'usageChanges'>): UsageChange[] {
  const list = (u.usageChanges ?? []).filter((c) => validDay(c.from) && UNIT_USAGES.includes(c.usage))
  const last = new Map<string, UsageChange>()
  for (const c of list) last.set(c.from, c)
  return [...last.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
}

export function usageAt(u: UsageUnit, day: string): UnitUsage {
  let usage = baseUsage(u)
  for (const c of usageChangesOf(u)) {
    if (c.from > day) break
    usage = c.usage
  }
  return usage
}

// Lückenlose Abschnitte gleicher Nutzung in [from, to] (inklusive Grenzen). Ohne Wechsel im Zeitraum
// genau ein Abschnitt über alle Tage.
export function usageSpans(u: UsageUnit, from: string, to: string): UsageSpan[] {
  const spans: UsageSpan[] = []
  let cursor = from
  let usage = usageAt(u, from)
  for (const c of usageChangesOf(u)) {
    if (c.from <= from) continue
    if (c.from > to) break
    if (c.usage === usage) continue
    const end = isoOf(dayNumber(c.from) - 1)
    spans.push({ from: cursor, to: end, usage, days: dayNumber(end) - dayNumber(cursor) + 1 })
    cursor = c.from
    usage = c.usage
  }
  spans.push({ from: cursor, to, usage, days: dayNumber(to) - dayNumber(cursor) + 1 })
  return spans
}

// Die Tage je Nutzung in [from, to].
export function usageDays(u: UsageUnit, from: string, to: string): Record<UnitUsage, number> {
  const days: Record<UnitUsage, number> = { vermietet: 0, eigen: 0, ausgenommen: 0 }
  if (from > to) return days
  for (const sp of usageSpans(u, from, to)) days[sp.usage] += sp.days
  return days
}

// Fragen für die Oberfläche und die Steuer (#259): an mindestens einem Tag in [from, to] vermietet bzw.
// selbstgenutzt, und an jedem Tag selbstgenutzt (selbst bewohnt im Sinne von § 2 HeizkostenV).
export const rentedWithin = (u: UsageUnit, from: string, to: string): boolean => usageDays(u, from, to).vermietet > 0
export const selfUsedWithin = (u: UsageUnit, from: string, to: string): boolean => usageDays(u, from, to).eigen > 0
export const selfUsedThroughout = (u: UsageUnit, from: string, to: string): boolean => {
  const d = usageDays(u, from, to)
  return d.eigen > 0 && d.vermietet === 0 && d.ausgenommen === 0
}

// Zählt ein Mietverhältnis in [from, to] für die Kosten? Nur, wenn seine Wohnung in seiner Zeit darin an einem Tag
// vermietet ist (wie `costTenancies` in calc.ts).
export function tenancyRentedWithin(u: UsageUnit, t: { start: string; end: string | null }, from: string, to: string): boolean {
  const f = t.start > from ? t.start : from
  const e = t.end !== null && t.end < to ? t.end : to
  return f <= e && rentedWithin(u, f, e)
}

// Ist die Einheit in irgendeiner Stufe der Staffel vermietet? Für die Frage „ist überhaupt eine Wohnung beteiligt“.
export const everRented = (u: UsageUnit): boolean => baseUsage(u) === 'vermietet' || usageChangesOf(u).some((c) => c.usage === 'vermietet')

// Die Kennzeichen einer Einheit für die Ja/Nein-Fragen eines Zeitraums (§ 2 HeizkostenV): vermietet an einem Tag,
// selbstgenutzt nur an jedem Tag (wie `dwellerUnits` in calc.ts).
export function flagsWithin<U extends UsageUnit>(u: U, from: string, to: string): U {
  if (!usageChangesWithin(u, from, to) && usageAt(u, from) === baseUsage(u)) return u
  return { ...u, participates: rentedWithin(u, from, to), selfUsed: selfUsedThroughout(u, from, to), usageChanges: [] }
}

// Wechselt die Nutzung in [from, to]?
export const usageChangesWithin = (u: UsageUnit, from: string, to: string): boolean => usageSpans(u, from, to).length > 1

// Die Einheit mit der Nutzung eines Tages als feste Angabe. Gilt am Tag die Angabe an der Einheit,
// dasselbe Objekt (keine Zahl darf wandern); sonst eine Kopie ohne Wechsel.
export function unitAsOf<U extends UsageUnit>(u: U, day: string): U {
  const usage = usageAt(u, day)
  if (usage === baseUsage(u)) return u
  return { ...u, ...usageFlags(usage), usageChanges: [] }
}

// Wechselt die Nutzung in [from, to] von „vermietet“ weg (Eigennutzung oder ausgenommen)? Nur dann kann bei verteiltem
// Erhaltungsaufwand das Ende nach § 82b Abs. 2 EStDV eintreten (#262, Durchsicht K2).
export function leavesRentalWithin(u: UsageUnit, from: string, to: string): boolean {
  const spans = usageSpans(u, from, to)
  return spans.some((s, i) => i > 0 && spans[i - 1]?.usage === 'vermietet' && s.usage !== 'vermietet')
}
