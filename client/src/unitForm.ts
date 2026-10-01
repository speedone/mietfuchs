// Entscheidungslogik des Wohnungs-Formulars: Nutzungsart ↔ Datenmodell. Die beiden
// Kennzeichen `participates` und `selfUsed` werden immer gemeinsam geschrieben, damit keine
// widersprüchliche Kombination entstehen kann (siehe UnitUsage in types.ts).
import { parseNumberDe } from './numbers'
import type { Meter, MeterType, Unit, UnitDependents, UnitUsage } from './types'
import { usageOf } from './types'

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
  rooms: string
  floor: string
  notes: string
}

export const EMPTY_UNIT_FORM: UnitForm = {
  name: '', areaM2: '', usage: 'vermietet', selfPersons: '', mea: '', noConnection: [], rooms: '', floor: '', notes: '',
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
    rooms: numStr(u.rooms),
    floor: u.floor ?? '',
    notes: u.notes ?? '',
  }
}

export type UnitBuildResult = { error: string } | { body: Record<string, unknown> }

// null statt undefined, damit geleerte Felder über die generische PUT-Route auch
// zurückgesetzt werden.
export function buildUnitBody(form: UnitForm): UnitBuildResult {
  // 0 m² ist erlaubt (#135): Eine Garage, ein Stellplatz oder ein Lager zählt beim
  // Flächenschlüssel dann nicht mit. Ein leeres Feld ist keine Angabe und bleibt ein Fehler.
  const area = parseNumberDe(form.areaM2) ?? NaN
  if (!form.name.trim() || !Number.isFinite(area) || area < 0) {
    return { error: 'Bitte Name und gültige Wohnfläche angeben (0 m² für Garage, Stellplatz oder Lager).' }
  }
  const rooms = form.rooms.trim() ? (parseNumberDe(form.rooms) ?? NaN) : null
  if (rooms !== null && (!Number.isFinite(rooms) || rooms <= 0)) {
    return { error: 'Zimmerzahl bitte als Zahl angeben (oder leer lassen).' }
  }
  const selfPersons = form.selfPersons.trim() ? (parseNumberDe(form.selfPersons) ?? NaN) : null
  if (form.usage === 'eigen' && selfPersons !== null && (!Number.isFinite(selfPersons) || selfPersons < 0)) {
    return { error: 'Personen im eigenen Haushalt bitte als Zahl angeben (oder leer lassen).' }
  }
  const mea = form.mea.trim() ? (parseNumberDe(form.mea) ?? NaN) : null
  if (mea !== null && (!Number.isFinite(mea) || mea < 0)) {
    return { error: 'Miteigentumsanteile bitte als Zahl angeben (oder leer lassen).' }
  }
  return {
    body: {
      name: form.name.trim(),
      areaM2: area,
      participates: form.usage === 'vermietet',
      selfUsed: form.usage === 'eigen',
      selfPersons: form.usage === 'eigen' ? selfPersons : null,
      mea,
      noConnection: form.noConnection,
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
const CONNECTION_ORDER: MeterType[] = ['kaltwasser', 'waerme', 'sonstig', 'strom']
export function connectionTypes(objectMeters: Pick<Meter, 'type' | 'unitId'>[], noConnection: MeterType[]): MeterType[] {
  const present = new Set<MeterType>(objectMeters.filter((m) => m.type !== 'strom' || m.unitId).map((m) => m.type))
  return CONNECTION_ORDER.filter((t) => present.has(t) || noConnection.includes(t))
}

export function setConnected(form: UnitForm, type: MeterType, connected: boolean): UnitForm {
  const rest = form.noConnection.filter((t) => t !== type)
  return { ...form, noConnection: connected ? rest : [...rest, type] }
}

// Die Ausnahme in Worten, für die Zusammenfassung im Formular und das Kennzeichen in der Liste.
const CONNECTION_WORDS: Record<MeterType, string> = { kaltwasser: 'Wasser', waerme: 'Wärme', strom: 'Strom', sonstig: '' }
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
