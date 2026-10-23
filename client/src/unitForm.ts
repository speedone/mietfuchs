// Entscheidungslogik des Wohnungs-Formulars: Nutzungsart ↔ Datenmodell. Die beiden
// Kennzeichen `participates` und `selfUsed` werden immer gemeinsam geschrieben, damit keine
// widersprüchliche Kombination entstehen kann (siehe UnitUsage in types.ts).
import { parseNumberDe } from './numbers'
import type { BillingPeriod, CostItem, Meter, MeterType, Tenancy, Unit, UnitDependents, UnitUsage } from './types'
import { isNotAllocable, usageOf } from './types'
import { calendarYearPeriod } from '../../shared/period.ts'
import type { Problem } from './formProblems'

export type UnitForm = {
  id?: string
  name: string
  areaM2: string
  usage: UnitUsage
  selfPersons: string
  // Miteigentumsanteile (#94), für eine vermietete Eigentumswohnung
  mea: string
  // Zählertypen ohne Anschluss (#117), etwa Wasser bei einer Garage
  noConnection: MeterType[]
  // Nutzungswechsel (#259): ab Tag ('JJJJ-MM-TT') gilt die Nutzung; `usage` oben gilt bis zum ersten.
  usageChanges: { from: string; usage: UnitUsage }[]
  rooms: string
  floor: string
  notes: string
}

export const EMPTY_UNIT_FORM: UnitForm = {
  name: '', areaM2: '', usage: 'vermietet', selfPersons: '', mea: '', noConnection: [], usageChanges: [], rooms: '', floor: '', notes: '',
}

const numStr = (n: number | undefined | null) => (n != null ? String(n).replace('.', ',') : '')

export function unitToForm(u: Unit): UnitForm {
  return {
    id: u.id,
    name: u.name,
    areaM2: numStr(u.areaM2),
    usage: usageOf(u),
    selfPersons: numStr(u.selfPersons),
    mea: numStr(u.mea),
    noConnection: u.noConnection ?? [],
    usageChanges: (u.usageChanges ?? []).map((c) => ({ from: c.from, usage: c.usage })),
    rooms: numStr(u.rooms),
    floor: u.floor ?? '',
    notes: u.notes ?? '',
  }
}

// Die Felder des Wohnungsformulars mit Meldung (#346, Schritt 3).
export type UnitField = 'name' | 'areaM2' | 'rooms' | 'selfPersons' | 'mea' | UsageChangeField
// Das Datum einer Zeile der Nutzungswechsel (#259).
export type UsageChangeField = `usageChange.${number}`
export const usageChangeField = (row: number): UsageChangeField => `usageChange.${row}`
// Ist die Einheit in irgendeiner Stufe selbstgenutzt? Dann gilt die Personenzahl des eigenen Haushalts.
export const usesSelf = (form: Pick<UnitForm, 'usage' | 'usageChanges'>): boolean =>
  form.usage === 'eigen' || form.usageChanges.some((c) => c.usage === 'eigen')
const isDay = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d
export type UnitBuildResult = { problems: Problem<UnitField>[] } | { body: Record<string, unknown> }

// null statt undefined, damit geleerte Felder über die generische PUT-Route auch
// zurückgesetzt werden.
export function buildUnitBody(form: UnitForm): UnitBuildResult {
  // 0 m² ist erlaubt (#135): Eine Garage, ein Stellplatz oder ein Lager zählt beim
  // Flächenschlüssel dann nicht mit. Ein leeres Feld ist keine Angabe und bleibt ein Fehler.
  // Alle Angaben auf einmal, je mit Feld (#346, Schritt 3); vorher ein Sammelsatz für Name und Fläche.
  const problems: Problem<UnitField>[] = []
  if (!form.name.trim()) problems.push({ field: 'name', short: 'Name fehlt', text: 'Wohnung: Geben Sie einen Namen ein, etwa „OG links“.' })
  const area = parseNumberDe(form.areaM2) ?? NaN
  if (!form.areaM2.trim()) problems.push({ field: 'areaM2', short: 'Wohnfläche fehlt', text: 'Wohnfläche: Geben Sie die Fläche in m² ein, 0 für Garage, Stellplatz oder Lager.' })
  else if (!Number.isFinite(area) || area < 0) problems.push({ field: 'areaM2', short: 'Keine Fläche', text: 'Wohnfläche: Geben Sie die Fläche als Zahl ein, etwa 85,5; 0 für Garage, Stellplatz oder Lager.' })
  const rooms = form.rooms.trim() ? (parseNumberDe(form.rooms) ?? NaN) : null
  if (rooms !== null && (!Number.isFinite(rooms) || rooms <= 0)) {
    problems.push({ field: 'rooms', short: 'Keine Zahl', text: 'Zimmerzahl bitte als Zahl angeben (oder leer lassen).' })
  }
  const selfPersons = form.selfPersons.trim() ? (parseNumberDe(form.selfPersons) ?? NaN) : null
  if (usesSelf(form) && selfPersons !== null && (!Number.isFinite(selfPersons) || selfPersons < 0)) {
    problems.push({ field: 'selfPersons', short: 'Keine Zahl', text: 'Personen im eigenen Haushalt bitte als Zahl angeben (oder leer lassen).' })
  }
  const mea = form.mea.trim() ? (parseNumberDe(form.mea) ?? NaN) : null
  if (mea !== null && (!Number.isFinite(mea) || mea < 0)) {
    problems.push({ field: 'mea', short: 'Keine Zahl', text: 'Miteigentumsanteile bitte als Zahl angeben (oder leer lassen).' })
  }
  // Nutzungswechsel (#259): jede Zeile braucht einen Tag, und zwei Wechsel am selben Tag widersprechen sich.
  const seen = new Set<string>()
  form.usageChanges.forEach((c, i) => {
    const where = `Nutzungswechsel, Zeile ${i + 1}`
    if (!c.from.trim()) problems.push({ field: usageChangeField(i), short: 'Datum fehlt', text: `${where}: Geben Sie den Tag ein, ab dem die neue Nutzung gilt.` })
    else if (!isDay(c.from)) problems.push({ field: usageChangeField(i), short: 'Kein Datum', text: `${where}: Geben Sie ein gültiges Datum ein.` })
    else if (seen.has(c.from)) problems.push({ field: usageChangeField(i), short: 'Tag doppelt', text: `${where}: Für diesen Tag steht schon ein Wechsel; je Tag gilt nur eine Nutzung.` })
    seen.add(c.from)
  })
  if (problems.length > 0) return { problems }
  return {
    body: {
      name: form.name.trim(),
      areaM2: area,
      participates: form.usage === 'vermietet',
      selfUsed: form.usage === 'eigen',
      selfPersons: usesSelf(form) ? selfPersons : null,
      mea,
      noConnection: form.noConnection,
      usageChanges: [...form.usageChanges].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)).map((c) => ({ from: c.from, usage: c.usage })),
      rooms,
      floor: form.floor.trim() || null,
      notes: form.notes.trim() || null,
    },
  }
}

// Einheiten der Abrechnung mit 0 m² (#135). Ob eine davon Garage-artig ist (ausdrücklich mit
// 0 Personen genutzt, die 0 also eine Angabe), entscheidet allein der Server (`isGarageLike` in
// calc.ts) und liefert es als `garageLikeUnitIds` der Abrechnung. Eine zweite Regel hier liefe
// auseinander; die frühere las die Personen aus `statements` und übersah deshalb die Garage mit
// Inklusivmiete. Kennt die Abrechnung das Feld nicht (vor #135 abgeschlossen), gilt jede 0 m² als
// fehlend wie damals.
export function zeroAreaUnits(units: Unit[], garageLikeUnitIds: string[] | undefined): { zero: Unit[], missing: Unit[] } {
  const withoutArea = units.filter((u) => usageOf(u) !== 'ausgenommen' && !u.areaM2)
  const garage = new Set(garageLikeUnitIds ?? [])
  return { zero: withoutArea.filter((u) => garage.has(u.id)), missing: withoutArea.filter((u) => !garage.has(u.id)) }
}

// Was das Cockpit zu den Einheiten mit fehlender Fläche sagt (`missing` aus `zeroAreaUnits`,
// Endprüfung rc.4). Wohnt dort im Jahr jemand, ist 0 m² eine vergessene Fläche, und der Befehl
// bleibt. Steht die Einheit leer, kann sie ebenso eine Garage sein: Dann fragt das Cockpit nach,
// denn wer bei einer leeren Garage „Wohnfläche ergänzen“ befolgte, machte sie beim
// Personenschlüssel zum Leerstand (#177) und trüge selbst mehr. Keine neue Regel: Ob jemand dort
// wohnt, hat der Server mit `garageLikeUnitIds` schon entschieden (eine Einheit mit Mietverhältnis
// steht nur dann in `missing`, wenn es Personen hat); hier zählt nur noch, ob es im Jahr eines gibt.
// Eine selbstgenutzte Einheit in `missing` ist immer bewohnt: Leer ist sie für den Server nur mit
// ausdrücklich 0 eigenen Personen, und dann steht sie nicht in `missing`.
// Gibt es eine Position nach Fläche, an der die leere Einheit teilnimmt, warnt die Abrechnung
// trotzdem (`basis.unit-no-area`, #135); das sagt der Text dann vorab, statt sich zu widersprechen.
// `period`: der gewählte Abrechnungszeitraum (#208); eine Jahreszahl ist das Kalenderjahr.
export function missingAreaCheck(missing: Unit[], tenancies: Tenancy[], period: number | BillingPeriod, yearItems: CostItem[] = []): { cta: string, detail: string } {
  const span = typeof period === 'number' ? calendarYearPeriod(period) : period
  const from = span.from
  const to = span.to
  const inhabited = (u: Unit) => (u.selfUsed && !u.participates)
    || tenancies.some((t) => t.unitId === u.id && t.start <= to && (!t.end || t.end >= from))
  const known = missing.filter(inhabited)
  const empty = missing.filter((u) => !inhabited(u))
  const parts: string[] = []
  if (known.length > 0) parts.push(`Wohnfläche fehlt bei: ${known.map((u) => u.name).join(', ')}`)
  if (empty.length > 0) {
    const names = empty.map((u) => u.name)
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}` : names[0]
    const byArea = yearItems.some((c) => c.period === span.key && c.key === 'area' && !isNotAllocable(c.category) &&
      empty.some((u) => u.participates && (!c.participantUnitIds || c.participantUnitIds.includes(u.id))))
    parts.push((empty.length === 1
      ? `${list} hat 0 m² und im Jahr keine Bewohner. Ist ${list} eine Wohnung, tragen Sie die Wohnfläche ein; eine Garage oder ein Stellplatz bleibt bei 0 m².`
      : `${list} haben 0 m² und im Jahr keine Bewohner. Ist eine davon eine Wohnung, tragen Sie dort die Wohnfläche ein; eine Garage oder ein Stellplatz bleibt bei 0 m².`) +
      (byArea ? ' Bei Positionen nach Wohnfläche weist die Abrechnung trotzdem darauf hin.' : ''))
  }
  return { cta: known.length > 0 ? 'Wohnfläche ergänzen' : 'Fläche prüfen', detail: parts.join('. ') }
}

// Die Löschfrage einer Wohnung (#142). Vorher nannte sie nur die Mietverhältnisse; die
// Fremdschlüssel nehmen aber auch Zähler, Ablesungen, Zahlungen und die Angaben der Wohnung an
// Kostenpositionen mit. Die Zahlen kommen vom Server (`/api/units/:id/dependents`); ist er nicht
// erreichbar (`null`), steht die vollständige Liste ohne Zahlen da.
const IRREVERSIBLE = 'Das lässt sich nicht rückgängig machen.'
export function unitDeleteMessage(deps: UnitDependents | null): string {
  if (deps === null) {
    return 'Mit der Wohnung werden auch ihre Mietverhältnisse, Zähler, Ablesungen und Zahlungen gelöscht, dazu ihre Anteile an ' +
      `Kostenpositionen. ${IRREVERSIBLE}`
  }
  const count = (n: number, one: string, many: string) => (n > 0 ? [`${n} ${n === 1 ? one : many}`] : [])
  const parts = [
    ...count(deps.tenancies, 'Mietverhältnis', 'Mietverhältnisse'),
    ...count(deps.meters, 'Zähler', 'Zähler'),
    ...count(deps.readings, 'Ablesung', 'Ablesungen'),
    ...count(deps.payments, 'Zahlung', 'Zahlungen'),
    ...count(deps.costItemLinks, 'Angabe an einer Kostenposition', 'Angaben an Kostenpositionen').map((t) => `${t} (vereinbarte Anteile, Teilnahmen, Einzelbeträge)`),
  ]
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}` : parts[0]
  const head = list ? `Mit der Wohnung werden gelöscht: ${list}.` : 'An der Wohnung hängt nichts weiter.'
  const direct = deps.directCostItems > 0
    ? ` ${deps.directCostItems === 1 ? '1 direkt zugeordnete Kostenposition bleibt' : `${deps.directCostItems} direkt zugeordnete Kostenpositionen bleiben`} erhalten; ihren Betrag trägt danach der Vermieter.`
    : ''
  return `${head}${direct} ${IRREVERSIBLE}`
}

// Rechnungen einer Etagenheizung sperren das Löschen der Wohnung (Integrationsdurchsicht S1, Regel in
// server/src/db/repository.ts). Die Oberfläche sagt es, bevor sie fragt, statt erst „Löschen“ anzubieten.
export function unitDeleteBlocked(deps: UnitDependents | null): string | null {
  const n = deps?.fuelDeliveries ?? 0
  if (n === 0) return null
  return n === 1
    ? 'An der Wohnung hängt 1 Rechnung der Etagenheizung. Sie belegt Brennstoffkosten und CO₂-Aufteilung und bleibt deshalb; ' +
      'die Wohnung lässt sich erst löschen, wenn Sie die Rechnung auf der Seite Heizkosten unter „Lieferungen“ gelöscht haben.'
    : `An der Wohnung hängen ${n} Rechnungen der Etagenheizung. Sie belegen Brennstoffkosten und CO₂-Aufteilung und bleiben deshalb; ` +
      'die Wohnung lässt sich erst löschen, wenn Sie die Rechnungen auf der Seite Heizkosten unter „Lieferungen“ gelöscht haben.'
}

// Anschlüsse einer Einheit (#142). Gefragt wird positiv: angehakt heißt angeschlossen, und das ist
// der Normalfall. Gespeichert wird unverändert nur die Ausnahme (`noConnection`, #117), damit
// bestehende Daten ohne Umbau gelten.
//
// Angeboten werden nur Zählerarten, für die es im Objekt Zähler gibt: Ohne Zähler einer Art fragt
// die Berechnung nie nach dem Anschluss, und die Frage verwirrte nur. Eine schon gesetzte
// Ausnahme bleibt immer sichtbar, sonst stünde etwas Gespeichertes unsichtbar und unlöschbar im
// Formular. Strom bietet das Formular nur an, wenn das Objekt einen Stromzähler an einer Einheit
// hat oder er schon als Ausnahme gesetzt ist: Ein Stromzähler ohne Einheit ist der Allgemeinstrom
// des Hauses und sagt nichts über den Anschluss einer Einheit.
// Heizkostenverteiler sind kein Anschluss: Sie hängen an Heizkörpern, und eine Einheit ohne Heizung
// hat „kein Anschluss: Wärme“.
const CONNECTION_ORDER: MeterType[] = ['kaltwasser', 'warmwasser', 'waerme', 'sonstig', 'strom']
export function connectionTypes(objectMeters: Pick<Meter, 'type' | 'unitId'>[], noConnection: MeterType[]): MeterType[] {
  const present = new Set<MeterType>(objectMeters.filter((m) => m.type !== 'strom' || m.unitId).map((m) => m.type))
  return CONNECTION_ORDER.filter((t) => present.has(t) || noConnection.includes(t))
}

export function setConnected(form: UnitForm, type: MeterType, connected: boolean): UnitForm {
  const rest = form.noConnection.filter((t) => t !== type)
  return { ...form, noConnection: connected ? rest : [...rest, type] }
}

// Die Ausnahme in Worten, für die Zusammenfassung im Formular und das Kennzeichen in der Liste.
const CONNECTION_WORDS: Record<MeterType, string> = { kaltwasser: 'Wasser', warmwasser: 'Warmwasser', waerme: 'Wärme', hkv: '', strom: 'Strom', sonstig: '' }
export function connectionSummary(noConnection: MeterType[]): string {
  const sorted = CONNECTION_ORDER.filter((t) => noConnection.includes(t))
  if (sorted.length === 0) return ''
  const named = sorted.filter((t) => t !== 'sonstig').map((t) => CONNECTION_WORDS[t])
  const parts: string[] = []
  if (named.length === 1) parts.push(`ohne ${named[0]}anschluss`)
  else if (named.length > 1) parts.push(`ohne ${named.slice(0, -1).map((w) => `${w}-`).join(', ')} und ${named[named.length - 1]}anschluss`)
  if (sorted.includes('sonstig')) parts.push('ohne Anschluss für Sonstiges')
  return parts.join(', ')
}
