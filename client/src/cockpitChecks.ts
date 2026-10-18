// Prüfungen des Cockpits, ohne DOM prüfbar (cockpitChecks.test.ts).
import type { CostItem, MeterType } from './types'
import { isNotAllocable } from './types'
import { fmtDate, fmtEuro } from './api'
import { andList, countOf } from '../../shared/wording.ts'

// Nicht umlagefähige Positionen werden nie verteilt (calc.ts, `isNotAllocable`), ihr gespeicherter
// Schlüssel bedeutet also nichts (#142). Zählten sie mit, verlangte das Cockpit Ablesungen für eine
// Verwaltungsrechnung oder prüfte die Verteilbasis wegen der Erhaltungsrücklage.
const allocable = (items: CostItem[]) => items.filter((c) => !isNotAllocable(c.category))

// Die Zählertypen, nach denen im Jahr verbrauchsabhängig umgelegt wird.
export function meterTypesInUse(items: CostItem[]): Set<MeterType | null | undefined> {
  return new Set(allocable(items).filter((c) => c.key === 'meter').map((c) => c.meterType))
}

// Kommt ein Schlüssel vor, dessen Verteilbasis die Wohnungen bilden? Auch die Gemeinschaftsabrechnung
// (#105) verteilt über die Wohnungen der Einheit.
export function usesUnitBasis(items: CostItem[]): boolean {
  return allocable(items).some((c) => c.key === 'area' || c.key === 'units' || c.key === 'persons' || c.key === 'external')
}

// Die grünen Zeilen „Mietverhältnisse & Flächen“ und „Belege erfasst“, mit Ein- und Mehrzahl statt
// „Mietverhältnis(se)“ oder „Position(en)“ (#180).
//
// Einheiten ohne Wohnfläche und ohne Bewohner (`zeroArea`, Garage-artig nach `isGarageLike` in calc.ts, #135)
// sind eine Angabe und kein Fehler, die Zeile bleibt grün. Sie sagt aber, warum (Befund N2 aus #341): Bei
// Fläche und Personen tragen sie nichts; beim Schlüssel nach Einheiten zählt jede als eine Einheit
// (`basisUnits` in calc.ts). Das nennt die Zeile nur für die Einheiten in `byUnits`, also die, die an einer
// Position nach Einheiten im Zeitraum teilnehmen (`countsByUnits`).
export function tenanciesDetail(tenancies: number, notSettled: number, participating: number, zeroArea: string[], byUnits: string[] = []): string {
  const one = zeroArea.length === 1
  const all = byUnits.length === zeroArea.length && zeroArea.every((n) => byUnits.includes(n))
  const units = byUnits.length === 0
    ? ''
    : all
      ? `, nach Einheiten ${one ? 'als' : 'je als'} eine Einheit`
      : `, nach Einheiten ${byUnits.length === 1 ? `zählt ${byUnits[0]} als` : `zählen ${andList(byUnits)} je als`} eine Einheit`
  const zero = `${andList(zeroArea)} ohne Wohnfläche und ohne Bewohner (etwa Garage oder Stellplatz): ` +
    `Bei Fläche und Personen ${one ? 'zählt sie' : 'zählen sie'} nicht mit${units}`
  return `${countOf(tenancies, 'Mietverhältnis', 'Mietverhältnisse')}${notSettled > 0 ? `, davon ${notSettled} ohne Abrechnung` : ''}` +
    ` · ${countOf(participating, 'beteiligte Wohnung', 'beteiligte Wohnungen')} · ` +
    (zeroArea.length > 0 ? zero : 'vollständig')
}

// Zählt die Einheit bei einer umlagefähigen Position nach Einheiten im Zeitraum mit? Ohne Teilnehmerliste
// nehmen alle Einheiten teil, mit Liste nur die genannten (#94).
export function countsByUnits(items: CostItem[], unitId: string): boolean {
  return allocable(items).some((c) => c.key === 'units' && (c.participantUnitIds == null || c.participantUnitIds.includes(unitId)))
}

export function itemsDetail(items: number, sumCents: number, files: number): string {
  return `${countOf(items, 'Position', 'Positionen')} · Summe ${fmtEuro(sumCents)}${files ? ` · ${countOf(files, 'Belegdatei', 'Belegdateien')}` : ''}`
}

// Unterzeile unter der Überschrift des Cockpits. Beim Erststart (#180) steht dort keine
// Checkliste, sondern zwei Knöpfe zum Anfangen; eine Zahl offener Punkte, die nirgends
// aufgezählt sind, sagte einem Vermieter ohne Vorkenntnisse nichts. Die Zeile nennt deshalb den
// ersten Schritt, die Punkte kommen mit der Checkliste, sobald etwas erfasst ist.
//
// Nach dem Abschluss ist „dann ist die Abrechnung versandfertig“ falsch (UI-Durchsicht M9, #341): Die
// Zeile sagt dann, was geschehen ist, und nennt die offenen Punkte beim Namen (`open`, die Titel der
// Zeilen der Checkliste), denn eine versendete Abrechnung wird nicht mehr fertig, nur noch nachgearbeitet.
// Die Zeile „Abgeschlossen & versendet“ zählt dabei nicht mit, der Satz sagt ihren Stand selbst (Durchsicht S2):
// abgeschlossen, aber nicht versendet, mit der Frist des § 556 Abs. 3 BGB, die weiterläuft; versendet nach
// Ablauf der Frist ausdrücklich so.
export const SENT_CHECK = 'Abgeschlossen & versendet'
export function cockpitSubtitle({ loaded, fresh, open, sentAt = null, closed = false, deadline = null, start = null }: {
  loaded: boolean
  fresh: boolean
  open: readonly string[]
  sentAt?: string | null
  closed?: boolean
  // Frist nach § 556 Abs. 3 BGB (ISO)
  deadline?: string | null
  // Der erste Schritt im leeren Bestand (emptyStock.ts)
  start?: string | null
}): string {
  if (!loaded) return 'Lade Abrechnungsstand …'
  if (fresh) return start ?? 'Legen Sie zuerst Ihre Stammdaten an und erfassen Sie dann die Belege des Jahres.'
  const others = open.filter((t) => t !== SENT_CHECK)
  const rest = others.length > 0 ? `noch offen: ${andList(others.map((t) => `„${t}“`))}.` : 'nichts mehr offen.'
  // Ohne weitere offene Punkte endet der Satz, wo der Stand selbst noch etwas verlangt oder rot ist.
  const tail = others.length > 0 ? `; ${rest}` : '.'
  if (sentAt) {
    if (deadline !== null && sentAt > deadline) return `Versendet am ${fmtDate(sentAt)}, nach Ablauf der Frist (${fmtDate(deadline)})${tail}`
    return `Versendet am ${fmtDate(sentAt)}; ${rest}`
  }
  if (closed) return `Abgeschlossen, Versanddatum fehlt${deadline ? ` (Frist am ${fmtDate(deadline)})` : ''}${tail}`
  if (open.length === 0) return 'Alles bereit — die Abrechnung ist vollständig.'
  return `Noch ${countOf(open.length, 'Punkt', 'Punkte')} offen, dann ist die Abrechnung versandfertig.`
}
