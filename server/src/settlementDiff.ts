// Abgeschlossene Jahre gegen die heutige Berechnung (#56, Teil 1). Der eingefrorene Stand ist das,
// was der Mieter bekommen hat, und bleibt unberührt. Diese Datei sagt nur, ob die heutige
// Rechnung je Mieter einen anderen Saldo ergäbe, und in welche Richtung. Warum, sagt sie nicht:
// Eine Abweichung entsteht aus einer Korrektur an Mietfuchs ebenso wie aus einer Eingabe, die nach
// dem Abschluss geändert wurde, und beides sieht an den Zahlen gleich aus.
//
// Der eingefrorene Stand ist `unknown`: Er stammt womöglich aus einer früheren Version. Lässt er
// sich nicht lesen, ist das Ergebnis „nicht vergleichbar“ und nicht „keine Abweichung“, denn das
// zweite wäre eine Auskunft, die niemand geprüft hat.

import type { AppliedValue, LawValueChange, SettlementComparison, SettlementDeviation } from '../../shared/types.ts'

type Saldo = { tenancyId: string, tenantName: string, unitName: string, balanceCents: number }
type Current = { statements: Saldo[], legalBasis?: { values?: readonly AppliedValue[] } }
type FrozenValue = { id: string, title: string, text: string, value: unknown, validFrom: string | undefined }

// Die eingefrorenen Rechtswerte (Heizung PR 1). Fehlt das Feld, wurde vor 0.11.0 abgeschlossen;
// dann gibt es nichts zu vergleichen. Ein Eintrag, der sich nicht lesen lässt, fällt weg, statt
// eine Änderung zu behaupten.
function readValues(value: unknown): FrozenValue[] {
  if (value === null || typeof value !== 'object') return []
  const basis = Reflect.get(value, 'legalBasis')
  if (basis === null || typeof basis !== 'object') return []
  const values = Reflect.get(basis, 'values')
  if (!Array.isArray(values)) return []
  return values.flatMap((v): FrozenValue[] => {
    if (v === null || typeof v !== 'object') return []
    const id = Reflect.get(v, 'id')
    const title = Reflect.get(v, 'title')
    const text = Reflect.get(v, 'text')
    const validFrom = Reflect.get(v, 'validFrom')
    return typeof id === 'string' && typeof title === 'string' && typeof text === 'string'
      ? [{ id, title, text, value: Reflect.get(v, 'value'), validFrom: typeof validFrom === 'string' ? validFrom : undefined }]
      : []
  })
}

// Nur Werte, die auf beiden Seiten stehen und verschieden sind. Ein Wert, den nur eine Seite
// benutzt, ist eine Folge geänderter Daten und keine Änderung des Rechts. Zugeordnet wird je
// Fassung, also nach Kennung und Beginn: Ein Zeitraum über eine Grenze benutzt zwei Fassungen
// desselben Werts, und die zweite eingefrorene ist nicht mit der ersten heutigen zu vergleichen
// (Durchsicht von #221, M1).
function valueChanges(frozen: FrozenValue[], current: readonly AppliedValue[]): LawValueChange[] {
  return frozen.flatMap((f) => {
    const now = current.find((c) => c.id === f.id && c.validFrom === f.validFrom)
    if (!now || JSON.stringify(now.value) === JSON.stringify(f.value)) return []
    return [{ id: f.id, title: f.title, frozenText: f.text, currentText: now.text }]
  })
}

function readStatements(value: unknown): Saldo[] | null {
  if (value === null || typeof value !== 'object') return null
  const statements = Reflect.get(value, 'statements')
  if (!Array.isArray(statements)) return null
  const out: Saldo[] = []
  for (const st of statements) {
    if (st === null || typeof st !== 'object') return null
    const tenancyId = Reflect.get(st, 'tenancyId')
    const balanceCents = Reflect.get(st, 'balanceCents')
    if (typeof tenancyId !== 'string' || typeof balanceCents !== 'number' || !Number.isFinite(balanceCents)) return null
    const tenantName = Reflect.get(st, 'tenantName')
    const unitName = Reflect.get(st, 'unitName')
    out.push({ tenancyId, balanceCents, tenantName: typeof tenantName === 'string' ? tenantName : '', unitName: typeof unitName === 'string' ? unitName : '' })
  }
  return out
}

// `today` als JJJJ-MM-TT, hineingereicht, damit der Test nicht vom Kalender abhängt.
// `current` darf auch eine Funktion sein, die rechnet: Scheitert die heutige Berechnung, bleibt der
// eingefrorene Stand trotzdem lesbar, und das Ergebnis heißt „nicht vergleichbar“.
export function compareWithFrozen(frozen: unknown, currentOrCompute: Current | (() => Current), year: number, today: string): SettlementComparison {
  // § 556 Abs. 3 BGB: zwölf Monate nach Ende des Abrechnungszeitraums, hier des Kalenderjahres.
  const deadline = `${year + 1}-12-31`
  const deadlinePassed = today > deadline
  const before = readStatements(frozen)
  if (!before) return { comparable: false, deviations: [], valueChanges: [], deadline, deadlinePassed }
  let current: Current
  try {
    current = typeof currentOrCompute === 'function' ? currentOrCompute() : currentOrCompute
  } catch {
    return { comparable: false, deviations: [], valueChanges: [], deadline, deadlinePassed }
  }
  const now = new Map(current.statements.map((s) => [s.tenancyId, s]))
  const then = new Map(before.map((s) => [s.tenancyId, s]))
  const ids = [...new Set([...then.keys(), ...now.keys()])]
  const deviations: SettlementDeviation[] = []
  for (const id of ids) {
    const a = then.get(id)
    const b = now.get(id)
    const difference = (b?.balanceCents ?? 0) - (a?.balanceCents ?? 0)
    if (a && b && difference === 0) continue
    if (!a && !b) continue
    const who = b ?? a
    if (!who) continue
    deviations.push({
      tenancyId: id,
      tenantName: who.tenantName,
      unitName: who.unitName,
      frozenBalanceCents: a ? a.balanceCents : null,
      currentBalanceCents: b ? b.balanceCents : null,
      differenceCents: difference,
      direction: !a ? 'added' : !b ? 'removed' : difference > 0 ? 'tenant' : 'landlord',
    })
  }
  return { comparable: true, deviations, valueChanges: valueChanges(readValues(frozen), current.legalBasis?.values ?? []), deadline, deadlinePassed }
}
