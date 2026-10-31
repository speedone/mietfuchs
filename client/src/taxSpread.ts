// Die Verteilung nach § 82b EStDV auf der Steuerseite (#262 PR 3, Entwurf
// docs/superpowers/specs/2026-10-30-erhaltungsaufwand-verteilen-design.md, E-5, E-8): die Spalte „verteilt“, der Satz an
// der Zeile, der Block der Zeilen 57 bis 72 und die Texte der Hinweise. Gerechnet ist alles auf dem Server (`taxReport`,
// `deductionPlan` in server/src/outflow.ts); hier wird nur zugeordnet und in Worte gefasst. Die Zeilennummern kommen nur
// aus `anlageVLines` (client/src/anlageV.ts): Für ein Jahr ohne gelesenen Vordruck und für ein Ursprungsjahr, das der
// Vordruck nicht mehr führt, steht keine Nummer da.
//
// § 82b Abs. 1 Satz 1 EStDV: Größere Aufwendungen für die Erhaltung von Gebäuden, die im Zeitpunkt der Leistung nicht zu
// einem Betriebsvermögen gehören und überwiegend Wohnzwecken dienen, kann der Steuerpflichtige abweichend von § 11 Abs. 2
// EStG auf zwei bis fünf Jahre gleichmäßig verteilen. Satz 2: überwiegend Wohnzwecken, wenn die Grundfläche der
// Wohnzwecken dienenden Räume mehr als die Hälfte der gesamten Nutzfläche beträgt. Sätze 3 und 4: Garagen. Abs. 3:
// Miteigentümer verteilen gleich.
import type { PropertyKind, TaxExpenseItem, TaxReport, TaxSpread } from './types'
import { fmtEuro } from './api'
import { anlageVLines } from './anlageV'

export const isSpreadItem = (x: TaxExpenseItem): boolean => x.spread !== undefined || x.spreadFrom !== undefined

// Die Spalte „verteilt“ nur, wenn eine Zeile etwas verschiebt; Zeilen, die sich aufheben (erstes Jahr einer Verteilung und
// Anteil einer anderen), brauchen sie trotzdem, sonst ergäbe die Zeile nicht Betrag = privat + unentgeltlich + verteilt +
// abziehbar.
export const showsDeferred = (report: Pick<TaxReport, 'expenses'>): boolean => report.expenses.items.some((x) => (x.deferredCents ?? 0) !== 0)

// Durchsicht S1: der verschobene Teil nach Vorzeichen. Plus ist im Jahr der Zahlung in Folgejahre verschoben, Minus ein
// Anteil aus einem Vorjahr, der in diesem Jahr abgezogen wird; als ein Saldo hieße ein Folgejahr „-3.333,33 € verschoben“.
export function deferredParts(report: Pick<TaxReport, 'expenses'>): { outCents: number; inCents: number } {
  const d = report.expenses.items.map((x) => x.deferredCents ?? 0)
  return { outCents: d.filter((c) => c > 0).reduce((a, c) => a + c, 0), inCents: -d.filter((c) => c < 0).reduce((a, c) => a + c, 0) }
}
export const DEFERRED_COLUMN_TITLE = 'Plus: in Folgejahre verschoben; Minus: Anteil aus einem Vorjahr, in diesem Jahr abgezogen (§ 82b EStDV)'
export const DEFERRED_COLUMN_NOTE = 'Spalte „verteilt“: mit Plus der Teil, der in Folgejahre verschoben ist (§ 82b EStDV); mit Minus ein Anteil aus einem Vorjahr, der in diesem Jahr abgezogen wird. Jede Zeile ergibt Gesamt = privat + verteilt + abziehbar, bei verbilligter Vermietung dazu unentgeltlich.'

// Der Satz unter der Beschreibung einer Zeile.
export function spreadItemText(item: TaxExpenseItem): string | null {
  if (item.spread) {
    const years = item.spread.rates.map((r) => r.year)
    const head = `auf ${item.spread.years} Jahre verteilt (${years[0]} bis ${years[years.length - 1]})`
    if (item.spread.baseCents === 0) return `${head}: ohne Wirkung, nichts davon abziehbar`
    return `${head}: in diesem Jahr ${fmtEuro(item.spread.rates[0]?.cents ?? 0)}, in die Folgejahre ${fmtEuro(item.deferredCents ?? 0)}`
  }
  const f = item.spreadFrom
  if (!f) return null
  return `Anteil ${f.index} von ${f.of} aus ${f.outflowYear}, Grundlage ${fmtEuro(f.baseCents)} abziehbar; ${f.restAfterCents > 0 ? `danach noch ${fmtEuro(f.restAfterCents)}` : 'danach nichts mehr'}`
}

// ---------- Block „Auf bis zu 5 Jahre zu verteilende Erhaltungsaufwendungen“ (Zeilen 57 bis 72) ----------
//
// Gegliedert wie der Vordruck: die in diesem Jahr begonnenen Verteilungen (57 Gesamtaufwand und davon in diesem Jahr
// abzuziehen, 58 direkt zugeordnet, 59 verhältnismäßig mit Gesamtbetrag und abzugsfähigem Anteil, 60 Summe), dann je
// Ursprungsjahr die übernommenen Anteile (direkt, verhältnismäßig, Summe). Gesamtbetrag ist der Bruttoanteil des Jahres
// (`grossRateCents`), das Ergebnis die Rate von D (`rateCents`), beides vor der Kürzung bei verbilligter Vermietung; die
// steht wie jede andere bei den Zeilen 87/88.
export type SpreadBlockRow = {
  key: string
  kind: 'total' | 'item' | 'sum'
  line: number | null
  code?: number
  label: string
  // Gesamtbetrag (Zeile 57: Gesamtaufwand; verhältnismäßig: Bruttoanteil des Jahres); `null`, wo der Vordruck keinen fragt.
  grossCents: number | null
  percent: number | null
  cents: number
}
export type SpreadBlock = { sections: { key: string; title: string; rows: SpreadBlockRow[] }[]; thisYearCents: number; showsLines: boolean }

// Durchsicht K4/K5: Welche Zahl in welches Feld von Zeile 57 und 59 gehört, sagt die Anleitung nicht ausdrücklich.
export const SPREAD_BLOCK_READING = 'Die Belegung der Felder ist eine Auslegung: Gesamtaufwand und Gesamtbetrag sind der ganze Betrag bzw. sein Anteil an diesem Jahr, das Ergebnis der Anteil des abziehbaren Teils. Der abzugsfähige Anteil ist auf zwei Stellen abgerundet; der Vordruck fragt ganze Euro.'

const how = (direct: boolean): string => (direct ? 'direkt zugeordnet' : 'verhältnismäßig zugeordnet')

export function spreadBlock(report: Pick<TaxReport, 'year' | 'expenses'>): SpreadBlock | null {
  const all = report.expenses.spread
  if (!all) return null
  // Durchsicht S3: Eine Verteilung ohne abziehbaren Teil (D = 0) gehört nicht in die Zeilen 57 bis 72, auch nicht in den
  // Gesamtaufwand von Zeile 57; der Hinweis `spreadNothingDeductible` nennt sie. Übernommene Anteile von 0 gibt es nicht.
  const s = { ...all, started: all.started.filter((x) => x.baseCents > 0) }
  if (s.started.length + s.carried.length === 0) return null
  const year = report.year
  const m = anlageVLines(year)?.maintenance
  const sections: SpreadBlock['sections'] = []
  if (s.started.length > 0) {
    const l = m?.spread
    const sum = (f: (x: TaxSpread['started'][number]) => number) => s.started.reduce((a, x) => a + f(x), 0)
    sections.push({
      key: 'started', title: `In ${year} begonnen`,
      rows: [
        { key: 'started-total', kind: 'total', line: l?.total ?? null, label: `Gesamtaufwand ${year}, davon ${year} abzuziehen`, grossCents: sum((x) => x.amountCents), percent: null, cents: sum((x) => x.grossRateCents) },
        ...[...s.started.filter((x) => x.direct), ...s.started.filter((x) => !x.direct)].map((x): SpreadBlockRow => ({
          key: `started-${x.costItemId}`, kind: 'item', line: (x.direct ? l?.direct : l?.proportional) ?? null, label: `${x.description} (${how(x.direct)})`,
          grossCents: x.direct ? null : x.grossRateCents, percent: x.direct ? null : x.deductiblePercent, cents: x.rateCents,
        })),
        { key: 'started-sum', kind: 'sum', line: l?.sum.line ?? null, ...(l?.sum.code !== undefined ? { code: l.sum.code } : {}), label: `Summe der in ${year} begonnenen Verteilungen`, grossCents: null, percent: null, cents: sum((x) => x.rateCents) },
      ],
    })
  }
  const origins = [...new Set(s.carried.map((x) => x.outflowYear))].sort((a, b) => a - b)
  for (const y0 of origins) {
    const list = s.carried.filter((x) => x.outflowYear === y0)
    const l = m?.spreadFromPriorYears?.find((p) => p.fromYear === y0)
    sections.push({
      key: `from-${y0}`, title: `Anteile aus ${y0}`,
      rows: [
        ...[...list.filter((x) => x.direct), ...list.filter((x) => !x.direct)].map((x): SpreadBlockRow => ({
          key: `from-${y0}-${x.costItemId}`, kind: 'item', line: (x.direct ? l?.direct : l?.proportional) ?? null,
          label: `${x.description} (${x.rest ? 'Rest aus ' : ''}Anteil ${x.index} von ${x.of}, ${how(x.direct)})`,
          grossCents: x.direct ? null : x.grossRateCents, percent: x.direct ? null : x.deductiblePercent, cents: x.rateCents,
        })),
        { key: `from-${y0}-sum`, kind: 'sum', line: l?.sum.line ?? null, ...(l?.sum.code !== undefined ? { code: l.sum.code } : {}), label: `Summe der Anteile aus ${y0}`, grossCents: null, percent: null, cents: list.reduce((a, x) => a + x.rateCents, 0) },
      ],
    })
  }
  return { sections, thisYearCents: s.thisYearCents, showsLines: sections.some((x) => x.rows.some((r) => r.line !== null)) }
}

// ---------- Hinweise (E-8) ----------

const quoted = (d: string): string => `„${d || 'ohne Beschreibung'}“`

// `spreadConditions`: In diesem Jahr beginnt eine Verteilung. Eine Warnung, denn die Voraussetzungen kennt Mietfuchs nur
// zum Teil (Fläche und Eigennutzung, nicht Betriebsvermögen und die Nutzung jeder Fläche).
export function spreadConditionsText(report: Pick<TaxReport, 'year' | 'expenses'>, kind?: PropertyKind): { action: string; more: string } {
  const notAllocable = report.expenses.items.some((x) => x.spread !== undefined && x.category === 'Nicht umlagefähig')
  const where = kind === 'etw'
    ? ' Bei einer Eigentumswohnung misst Mietfuchs das an der Wohnung, nicht am ganzen Haus; Teileigentum wie ein Laden dient nicht Wohnzwecken (Auslegung).'
    : kind === 'sonstiges' ? ' Mietfuchs kennt die Nutzung der Flächen nicht; prüfen Sie den Anteil der Wohnräume selbst.' : ''
  return {
    action: 'Prüfen Sie die Voraussetzungen: Das Gebäude gehört zu Ihrem Privatvermögen und dient überwiegend Wohnzwecken, das heißt, die Wohnräume haben mehr als die Hälfte der gesamten Nutzfläche (§ 82b Abs. 1 Satz 1 und 2 EStDV).' + where +
      (notAllocable ? ' Verteilen lässt sich nur Erhaltungsaufwand; Verwaltungskosten und Zinsen, die ebenfalls unter „Nicht umlagefähig“ stehen, gehören nicht dazu.' : '') +
      ` Die Wahl gehört in die Erklärung dieses Jahres (${report.year}) und bindet die Folgejahre.`,
    more: 'Garagen, die zum Gebäude gehören, zählen ohne Rücksicht auf ihre tatsächliche Nutzung als Wohnräume, soweit in ihnen nicht mehr als ein Personenkraftwagen für jede Wohnung untergestellt werden kann; Räume für weitere Kraftwagen zählen nicht (§ 82b Abs. 1 Satz 3 und 4 EStDV). Eine Ferienwohnung für wechselnde Gäste dient nicht Wohnzwecken (BFH, Urteil vom 04.09.2000, IX R 75/99). Gehört das Gebäude mehreren Eigentümern, verteilen alle auf denselben Zeitraum (§ 82b Abs. 3 EStDV). Für ein Baudenkmal oder ein Gebäude im Sanierungsgebiet gelten eigene Vorschriften mit Bescheinigung (§§ 11a, 11b EStG), die Mietfuchs nicht rechnet.',
  }
}

// `spreadCarried`: Anteile aus Vorjahren. Die Grundlage D je Position, damit der Vermieter sie mit dem Bescheid des Jahres
// der Zahlung vergleicht; Mietfuchs friert abgegebene Jahre nicht ein (Entscheidung U-1).
export function spreadCarriedText(report: Pick<TaxReport, 'expenses'>): string {
  const list = report.expenses.spread?.carried ?? []
  const bases = list.map((x) => `${quoted(x.description)} aus ${x.outflowYear}: Grundlage ${fmtEuro(x.baseCents)}`).join('; ')
  return `Diese Anteile gehören in die Erklärung dieses Jahres; in einem späteren Jahr lässt sich ein vergessener Anteil nicht nachholen, und ist der Bescheid dieses Jahres bestandskräftig, ist er verloren. ${bases}. Weicht eine Grundlage von Ihrem Bescheid für das Jahr der Zahlung ab, etwa weil Sie seither eine Fläche berichtigt haben, gilt für die Erklärung der Wert des Bescheids.`
}

// Die Fundstellen dazu (Durchsicht S2). Das Urteil von 1977 ist nach H 21.1 EStH zitiert, nicht im Volltext gelesen.
export const SPREAD_CARRIED_MORE = 'Kein Anteil lässt sich in ein anderes Jahr übertragen: H 21.1 EStH (BFH, Urteil vom 26.10.1977, VIII R 111/74, BStBl 1978 II S. 367, zitiert nach den Hinweisen). An die einmal getroffene Wahl ist der Steuerpflichtige gebunden: BFH, Urteil vom 27.10.1992, IX R 152/89, Rn. 12 bis 14.'

// `spreadNothingDeductible`: D = 0, etwa direkt der selbstgenutzten Wohnung zugeordnet. Entschieden (Aufgabe aus der
// Durchsicht von PR 2): Die Folgejahre bekommen keine Zeile, denn es gibt nichts abzuziehen; die Verteilung steht nur im
// Jahr der Zahlung, und dieser Hinweis sagt es.
export function spreadNothingDeductibleText(report: Pick<TaxReport, 'expenses'>): string {
  const names = (report.expenses.spread?.started ?? []).filter((x) => x.baseCents === 0).map((x) => quoted(x.description)).join(', ')
  return `${names}: Nichts davon ist abziehbar, die Verteilung hat keine Wirkung, und in den Folgejahren steht nichts. Wählen Sie unter Kosten bei der Position „nicht verteilen“.`
}

// `spreadIgnored`: eine gespeicherte Wahl an einer Position, an der nicht verteilt werden kann (Ablage von Hand,
// wiederhergestellt). Das Formular zeigt dort kein Feld und schickt beim Speichern „nicht verteilen“.
export function spreadIgnoredText(report: Pick<TaxReport, 'spreadIgnored'>): string {
  const names = (report.spreadIgnored ?? []).map((x) => quoted(x.description)).join(', ')
  return `${names}: Für die Steuer ist eine Verteilung gespeichert, an dieser Position wird aber nicht verteilt; verteilen lässt sich nur „Nicht umlagefähig“ oder „Entnahme Erhaltungsrücklage“ mit einem Betrag über 0 €. Die Übersicht zählt den Betrag ganz im Jahr der Zahlung. Speichern Sie die Position unter Kosten einmal; dann entfällt die Angabe.`
}
