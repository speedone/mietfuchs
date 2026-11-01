// „Passend zu Ihrem Bestand“ (#488, Teil 4): Über der Liste der Anleitungen schlägt die Startansicht von „Hilfe &
// Begriffe“ bis zu drei vor, jede mit dem Grund aus den Daten. Eine reine Funktion über das, was die App ohnehin geladen
// hat (Objekte, gewähltes Objekt mit Wohnungen und Mietverhältnissen, Heizanlagen, gewählter Zeitraum); keine eigene
// Route. Bei mehreren Objekten gilt wie überall das in der Seitenleiste gewählte.
//
// Eine Regel greift nur, wo die Angabe im Bestand eindeutig ist: lieber keine Kachel als eine falsche. Ohne Regel:
// „Gasrechnung über die Heizperiode hinaus“ (ob der Versorger anders abrechnet, steht erst in den Rechnungen).
//
// Reihenfolge nach Nutzen (`rank`): zuerst, was in diesem Zeitraum geschehen ist (Mieterwechsel, Leerstand, Kesseltausch),
// denn es verlangt jetzt etwas und war im Vorjahr anders; dann ein abweichender Abrechnungszeitraum, der jede Frist und
// jede Zuordnung verschiebt; dann die Heizung, wo Fehler eine Kürzung kosten; dann Pauschalen; zuletzt die Art des
// Objekts, die beim Anlegen schon feststand. Erst bekommt jede Gruppe der Anleitungen (Objekt, Jahr, Heizung) ihre beste
// Kachel, dann werden die Plätze in der Rangfolge aufgefüllt: Drei Heizungskacheln verdeckten sonst, dass auch das Jahr
// etwas verlangt.

import { GUIDES, type GuideId } from '../../shared/guides.ts'
import { co2FirstPeriodStart } from '../../shared/law/co2kostaufg.ts'
import { isStockEnergy } from '../../shared/fuelStock.ts'
import { billingEnergy } from '../../shared/heatDelivery.ts'
import { usageAt } from '../../shared/unitUsage.ts'
import { MONTH_NAMES } from './monthText'
import { CALENDAR_RULES } from '../../shared/period.ts'
import { hasOwnRhythm, heatingPeriodsEndingIn, plantRules } from '../../shared/heatingPeriod.ts'
import type { HeatingEnergy, HeatingPlant, Property, Tenancy, Unit } from '../../shared/types.ts'

export type HelpStock = {
  properties: readonly Pick<Property, 'id'>[]
  property: Pick<Property, 'id' | 'name' | 'kind' | 'periodRules'> | null
  units: readonly Unit[]
  tenancies: readonly Tenancy[]
  plants: readonly HeatingPlant[]
  // Der gewählte Abrechnungszeitraum mit inklusiven Grenzen und seiner Bezeichnung („2025“, „2025/2026“).
  period: { from: string; to: string; label: string; calendar: boolean }
}

export type GuideSuggestion = { guideId: GuideId; reason: string }

const WORDS = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf']
// Eine Zahl bis zwölf als Wort, darüber als Ziffer (wie im Satz üblich).
export const numberWord = (n: number): string => WORDS[n] ?? String(n)

const monthOf = (iso: string): string => MONTH_NAMES[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7)

const ENERGY_PREFIX: Partial<Record<HeatingEnergy, string>> = { gas: 'Gas', oil: 'Öl', lpg: 'Flüssiggas', coal: 'Kohle' }
const FUEL_NAMES: Partial<Record<HeatingEnergy, string>> = { oil: 'Heizöl', lpg: 'Flüssiggas', pellets: 'Pellets', wood: 'Holz', coal: 'Kohle' }

// Garage, Stellplatz, Carport: nur am Namen der Einheit erkennbar, eine Art der Einheit gibt es nicht. Nur das erste
// Wort zählt („TG-Stellplatz 3“, „Doppelgarage“), denn „Wohnung über der Garage“ ist eine Wohnung (Durchsicht S1).
const PARKING_WORD = /^(?:tg-?)?(?:tief|einzel|doppel)?(?:garage|garagen(?:stell)?platz|stellplatz|carport|parkplatz)\d*$/i
const isParking = (u: Pick<Unit, 'name'>): boolean => PARKING_WORD.test(u.name.trim().split(/\s+/)[0] ?? '')

// Ein Zeitraum ist das Kalenderjahr, wenn er am 01.01. beginnt und am 31.12. desselben Jahres endet; kürzer als zwölf
// Monate ist ein Rumpf (er entsteht nur bei einem Wechsel des Rhythmus).
const isCalendarYear = (p: { from: string; to: string }): boolean => p.from.endsWith('-01-01') && p.to === `${p.from.slice(0, 4)}-12-31`
const monthIndex = (iso: string): number => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1
const isShort = (p: { from: string; to: string }): boolean => monthIndex(p.to) - monthIndex(p.from) + 1 < 12

const nextDay = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
const overlaps = (start: string, end: string | null, from: string, to: string): boolean => start <= to && (end === null || end >= from)

type Candidate = GuideSuggestion & { rank: number }
// Ränge, siehe oben
const EVENT = 1
const PERIOD = 2
const HEATING = 3
const CONTRACT = 4
const PROPERTY = 5

export function suggestGuides(stock: HelpStock | null, max = 3): GuideSuggestion[] {
  if (!stock?.property) return []
  const { property, period } = stock
  const { from, to } = period
  const name = property.name.trim() || 'Ihr Objekt'
  const when = period.calendar ? period.label : `im Zeitraum ${period.label}`
  const units = stock.units.filter((u) => u.propertyId === property.id)
  const unitIds = new Set(units.map((u) => u.id))
  const tenancies = stock.tenancies.filter((t) => unitIds.has(t.unitId))
  const out: Candidate[] = []
  const add = (rank: number, guideId: GuideId, reason: string) => out.push({ rank, guideId, reason })

  // Mieterwechsel: in derselben Wohnung endet ein Mietverhältnis vor dem letzten Tag des Zeitraums, und ein späteres
  // beginnt nach seinem ersten Tag. Ein Wechsel genau an der Grenze gehört zum Vorjahr.
  // Gezählt wird jeder Wechsel, auch zwei in derselben Wohnung (Durchsicht S2).
  const changes = units.reduce((sum, u) => {
    const ts = tenancies.filter((t) => t.unitId === u.id)
    return sum + ts.filter((a) => a.end !== null && a.end >= from && a.end < to && ts.some((b) => b.start > a.end! && b.start > from && b.start <= to)).length
  }, 0)
  // Leerstand: an einem Tag des Zeitraums vermietet, aber ohne Mietverhältnis. Nur Wohnungen mit einem Mietverhältnis im
  // Zeitraum; eine ganz ohne ist eher noch nicht erfasst als leer.
  const vacant = units.filter((u) => {
    const ts = tenancies.filter((t) => t.unitId === u.id && overlaps(t.start, t.end, from, to))
    if (ts.length === 0) return false
    for (let d = from; d <= to; d = nextDay(d)) {
      if (usageAt(u, d) === 'vermietet' && !ts.some((t) => t.start <= d && (t.end === null || t.end >= d))) return true
    }
    return false
  })
  if (changes > 0) add(EVENT, 'tenantChange', changes === 1 ? `Weil ${when} ein Mieterwechsel erfasst ist` : `Weil ${when} ${numberWord(changes)} Mieterwechsel erfasst sind`)
  else if (vacant.length === 1) add(EVENT, 'tenantChange', `Weil „${vacant[0]!.name}“ ${when} zeitweise nicht vermietet ist`)
  else if (vacant.length > 1) add(EVENT, 'tenantChange', `Weil ${numberWord(vacant.length)} ${vacant.some(isParking) ? 'Einheiten' : 'Wohnungen'} ${when} zeitweise nicht vermietet sind`)

  // Heizanlagen des Objekts, die im Zeitraum heizen. Eine Ersatzanlage beginnt am Tag nach dem letzten der ersetzten.
  const all = stock.plants.filter((p) => p.propertyId === property.id)
  const startOf = (p: HeatingPlant): string => {
    const old = p.replacesPlantId ? all.find((q) => q.id === p.replacesPlantId) : undefined
    return old?.endsOn ? nextDay(old.endsOn) : '0000-01-01'
  }
  const plants = all.filter((p) => overlaps(startOf(p), p.endsOn, from, to))
  const renewed = all.some((p) => {
    const old = p.replacesPlantId ? all.find((q) => q.id === p.replacesPlantId) : undefined
    return !!old?.endsOn && old.endsOn >= from && old.endsOn < to
  })
  // Zwei Anlagen zugleich: Zeiten überschneiden sich, und keine ersetzt die andere.
  const related = (a: HeatingPlant, b: HeatingPlant) => a.replacesPlantId === b.id || b.replacesPlantId === a.id
  const concurrent = plants.filter((a) => plants.some((b) => b !== a && !related(a, b) && overlaps(startOf(a), a.endsOn, startOf(b), b.endsOn ?? '9999-12-31'))).length
  if (renewed) add(EVENT, 'heatingRenewed', `Weil die Heizung ${when} erneuert wurde`)
  else if (concurrent > 1) add(HEATING, 'heatingRenewed', `Weil in ${name} ${numberWord(concurrent)} Heizanlagen eingetragen sind`)
  else if (plants.some((p) => p.supply === 'perUnit')) add(HEATING, 'heatingRenewed', `Weil in ${name} Etagenheizungen eingetragen sind`)

  // Abrechnungszeitraum, entschieden am gewählten Zeitraum und nicht an den Regeln (Durchsicht M1): Vor oder nach einem
  // Wechsel kann er das Kalenderjahr sein. Ein Rumpf bekommt einen eigenen Grund, denn um ihn geht es in der Anleitung
  // (Vorschau, Frist des Rumpfs, Aufteilen nach Tagen); „von Januar bis April“ läse sich wie der Rhythmus.
  // Sonst die Heizung: die Heizperioden ihres eigenen Rhythmus (Beginnmonat und Wechsel, `plantRules`), die im gewählten
  // Zeitraum enden und so in seine Abrechnung gehören (M2).
  const rules = property.periodRules ?? CALENDAR_RULES
  const heatingPeriod = plants.filter(hasOwnRhythm).flatMap((p) => heatingPeriodsEndingIn(plantRules(p, rules), period)).find((h) => !isCalendarYear(h))
  if (!isCalendarYear(period)) {
    add(PERIOD, 'periodMayApril', isShort(period) ? `Weil ${name} auf einen anderen Abrechnungszeitraum umstellt` : `Weil ${name} von ${monthOf(from)} bis ${monthOf(to)} abrechnet`)
  } else if (heatingPeriod) {
    add(PERIOD, 'periodMayApril', heatingPeriod.short ? 'Weil die Heizung auf eine andere Heizperiode umstellt' : `Weil die Heizung von ${monthOf(heatingPeriod.from)} bis ${monthOf(heatingPeriod.to)} abgerechnet wird`)
  }

  // CO₂: Gas, Öl, Flüssiggas oder Kohle (auch als Brennstoff eines Wärmelieferanten), die Abrechnung erstellt ein
  // Messdienst oder die Hausverwaltung (so die Anleitung), und der Zeitraum beginnt nach dem Beginn der Aufteilung.
  const co2 = from >= co2FirstPeriodStart() ? plants.find((p) => p.method === 'service' && p.supply === 'central' && ENERGY_PREFIX[p.energy]) : undefined
  if (co2) add(HEATING, 'co2Costs', co2.contracting ? `Weil eine Wärmelieferung aus ${ENERGY_PREFIX[co2.energy]} eingetragen ist` : `Weil eine ${ENERGY_PREFIX[co2.energy]}-Zentralheizung eingetragen ist`)
  if (plants.some((p) => p.method === 'self')) add(HEATING, 'heatingSelf', 'Weil Sie die Heizkosten selbst abrechnen')
  // Vorrat: Brennstoff in Lieferungen, den Mietfuchs selbst verteilt; beim Messdienst nicht, und bei Wärmelieferung
  // nicht, denn abgerechnet wird dann die gelieferte Wärme (`billingEnergy`).
  const fuel = plants.find((p) => p.method !== 'service' && isStockEnergy(billingEnergy(p)))
  if (fuel) add(HEATING, 'stockFuel', `Weil eine Heizung mit ${FUEL_NAMES[fuel.energy]} eingetragen ist`)
  // Messdienst beim Haus; die Abrechnung der Gemeinschaft gehört zur Eigentumswohnung.
  if (plants.some((p) => p.method === 'service' && p.source === 'building')) add(HEATING, 'meteringService', 'Weil ein Messdienst Ihre Heizkosten abrechnet')

  // Pauschale oder Inklusivmiete an einem Mietverhältnis im Zeitraum, für die kalten Kosten oder die Heizung. Nicht bei
  // einer Garage: Ohne Nebenkosten trägt sie nach ihrer Anleitung die Inklusivmiete, das ist keine Lage der Pauschale.
  const notSettled = (m: string | undefined) => m === 'flatRate' || m === 'inclusive'
  const parkingIds = new Set(units.filter(isParking).map((u) => u.id))
  const flat = tenancies.filter((t) => !parkingIds.has(t.unitId) && overlaps(t.start, t.end, from, to) && (notSettled(t.costModel) || notSettled(t.heatingModel)))
  if (flat.length === 1) {
    const t = flat[0]!
    const what = t.costModel === 'flatRate' || t.heatingModel === 'flatRate' ? 'eine Pauschale' : 'eine Inklusivmiete'
    // Ohne Namen der allgemeine Satz (Durchsicht S3)
    const who = t.tenantName.trim()
    add(CONTRACT, 'flatRate', who ? `Weil mit ${who} ${what} vereinbart ist` : `Weil für ein Mietverhältnis ${what} vereinbart ist`)
  } else if (flat.length > 1) add(CONTRACT, 'flatRate', `Weil für ${numberWord(flat.length)} Mietverhältnisse eine Pauschale oder Inklusivmiete vereinbart ist`)

  // Art des Objekts. Wohnungen sind die beteiligten Einheiten (vermietet oder selbst genutzt am Ende des Zeitraums) ohne
  // Garagen und Stellplätze.
  const homes = units.filter((u) => !isParking(u) && usageAt(u, to) !== 'ausgenommen')
  if (property.kind === 'etw') add(PROPERTY, 'condo', `Weil ${name} als Eigentumswohnung eingetragen ist`)
  else if (homes.length === 2 && homes.some((u) => usageAt(u, to) === 'eigen') && homes.some((u) => usageAt(u, to) === 'vermietet')) {
    add(PROPERTY, 'granny', `Weil Sie in ${name} eine Wohnung selbst nutzen und eine vermieten`)
  } else if (homes.length >= 3) add(PROPERTY, 'multiFamily', `Weil ${name} ${numberWord(homes.length)} Wohnungen hat`)
  const parking = units.filter(isParking)
  if (parking.length === 1) add(PROPERTY, 'garage', `Weil ${name} die Einheit „${parking[0]!.name}“ hat`)
  else if (parking.length > 1) add(PROPERTY, 'garage', `Weil ${name} ${numberWord(parking.length)} Garagen oder Stellplätze hat`)
  if (stock.properties.length > 1) add(PROPERTY, 'properties', `Weil Sie ${numberWord(stock.properties.length)} Objekte angelegt haben`)

  // Stabil nach Rang (in derselben Stufe die Reihenfolge oben), dann zuerst je Gruppe die beste, danach der Rest.
  const ranked = out.map((c, i) => ({ c, i })).sort((a, b) => a.c.rank - b.c.rank || a.i - b.i).map((x) => x.c)
  const picked: Candidate[] = []
  for (const c of ranked) if (!picked.some((p) => GUIDES[p.guideId].group === GUIDES[c.guideId].group)) picked.push(c)
  const order = [...picked, ...ranked.filter((c) => !picked.includes(c))]
  // Nach dem Auffüllen wieder in der Rangfolge, damit ein Ereignis des Jahres oben steht.
  const chosen = order.slice(0, max).sort((a, b) => a.rank - b.rank || ranked.indexOf(a) - ranked.indexOf(b))
  return chosen.map(({ guideId, reason }) => ({ guideId, reason }))
}

// Die Heizanlagen fragt die App bei jedem Seitenwechsel neu ab (für die Navigation). Ist die Antwort inhaltlich gleich,
// bleibt die alte Liste, damit die App nicht einmal mehr zeichnet und die Vorschläge nicht neu rechnen (Durchsicht S4).
// Verglichen wird der ganze Inhalt: Jedes Feld einer Anlage kann eine Regel ändern, und die Listen sind kurz.
export function keepIfEqual<T>(prev: T, next: T): T {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
}
