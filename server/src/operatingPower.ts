// Betriebsstrom im Allgemeinstrom (Heizung PR 15, #212, Entwurf 10.1). Eine Position mit
// `operatingPower: 'included'` sagt: Dieser Strom steckt auch in der Stromrechnung des Hauses. Dann muss
// beim Allgemeinstrom ein Abzug in gleicher Höhe stehen, sonst zahlen die Mieter ihn doppelt
// (§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15). Die Abzüge zählen über ihren
// Verweis und aus jedem Zeitraum (Review Focus 5); geprüft werden nur die Positionen, die die
// Abrechnung verteilt, damit der Hinweis genau einmal erscheint, nämlich dort, wo der Betriebsstrom steht.
import type { CostItem, OperatingPowerDeduction } from '../../shared/types.ts'

// Ein Abzug in einer abgeschlossenen Abrechnung, der den Mietern nicht oder nicht so gutgeschrieben ist,
// wie er heute dasteht (P-W3, R2-W2). `frozenCents` nur bei `changed`: der eingefrorene Betrag.
export type OperatingPowerClosedIssue = {
  description: string
  label: string
  amountCents: number
  state: 'missing' | 'unknown' | 'changed'
  frozenCents: number | null
}

export type OperatingPowerFinding = {
  itemId: string
  description: string
  amountCents: number
  deductedCents: number
  differenceCents: number
  closedIssues: OperatingPowerClosedIssue[]
}

// Was ein Abzug den Mietern gutgeschrieben hat (als positiver Betrag): offen oder gutgeschrieben sein
// Betrag; bei geändertem Betrag der eingefrorene; nicht im Stand oder unlesbar nichts. Bei `unknown`
// zählt er nicht: Ein Hinweis zu viel ist der harmlosere Ausgang als eine stumme Doppelbelastung.
function creditedCents(d: OperatingPowerDeduction): number {
  if (d.closed === null || d.closed.state === 'credited') return -d.amountCents
  if (d.closed.state === 'changed') return -d.closed.frozenCents
  return 0
}

export function operatingPowerFindings(
  distributed: readonly Pick<CostItem, 'id' | 'description' | 'amountCents' | 'operatingPower'>[],
  deductions: readonly OperatingPowerDeduction[],
): OperatingPowerFinding[] {
  const out: OperatingPowerFinding[] = []
  for (const item of distributed) {
    if (item.operatingPower !== 'included') continue
    const mine = deductions.filter((d) => d.itemId === item.id)
    const deductedCents = mine.reduce((a, d) => a + creditedCents(d), 0)
    const differenceCents = item.amountCents - deductedCents
    if (differenceCents === 0) continue
    const closedIssues = mine.flatMap((d): OperatingPowerClosedIssue[] => {
      const c = d.closed
      if (c === null || c.state === 'credited') return []
      return [{ description: d.description, label: c.label, amountCents: -d.amountCents, state: c.state, frozenCents: c.state === 'changed' ? -c.frozenCents : null }]
    })
    out.push({ itemId: item.id, description: item.description, amountCents: item.amountCents, deductedCents, differenceCents, closedIssues })
  }
  return out
}

// R2-K4: Wiederöffnen rechnet den ganzen Zeitraum neu; nach Ablauf der Frist ist eine höhere
// Nachforderung ausgeschlossen.
const DEADLINE = 'Nach Ablauf der Abrechnungsfrist darf die neue Abrechnung keine höhere Nachforderung enthalten als die zugestellte (§ 556 Abs. 3 Satz 3 BGB).'

// Ein Satz je Abzug in einer abgeschlossenen Abrechnung (R2-W2): Nur wo feststeht, dass er nicht oder
// anders gutgeschrieben ist, steht die Bitte, neu zuzustellen; bei einem unlesbaren Stand nicht.
function closedText(n: OperatingPowerClosedIssue, fmtCents: (c: number) => string): string {
  if (n.state === 'unknown') {
    return ` Der Abzug „${n.description}“ (${fmtCents(n.amountCents)}) steht in der abgeschlossenen Abrechnung ${n.label}; ob er dort gutgeschrieben ist, lässt sich aus dem eingefrorenen Stand nicht lesen. Prüfen Sie die zugestellte Abrechnung.`
  }
  if (n.state === 'changed') {
    return ` Der Abzug „${n.description}“ steht in der abgeschlossenen Abrechnung ${n.label} mit einem anderen Betrag; gutgeschrieben sind dort ${fmtCents(n.frozenCents ?? 0)} statt ${fmtCents(n.amountCents)}, denn der Betrag wurde nach dem Abschluss geändert. ` +
      `Soll der neue Betrag gelten, öffnen Sie die Abrechnung ${n.label} wieder und stellen Sie sie neu zu. ${DEADLINE}`
  }
  return ` Der Abzug „${n.description}“ (${fmtCents(n.amountCents)}) steht in der abgeschlossenen Abrechnung ${n.label}, aber nicht in ihrem eingefrorenen Stand; den Mietern ist er nicht gutgeschrieben. ` +
    `Öffnen Sie die Abrechnung ${n.label} wieder und stellen Sie sie neu zu, damit er ankommt. ${DEADLINE}`
}

// Zwei Texte, ein Code: zu wenig abgezogen heißt doppelt verteilt, zu viel heißt, der Vermieter trägt
// einen Teil des Allgemeinstroms selbst. Dazu je Abzug in einer abgeschlossenen Abrechnung ein Satz. Die
// Norm nennt auch das Warmwasser (P-K3); selbst tragen ist zulässig (P-K5, V ZR 166/15 Rn. 15), heißt
// aber, den Betriebsstrom aus den Heizkosten zu nehmen (R2-K3).
export function operatingPowerText(f: OperatingPowerFinding, fmtCents: (c: number) => string): string {
  const head = `„${f.description}“: Dieser Betriebsstrom steckt nach Ihrer Angabe auch in der Stromrechnung des Allgemeinstroms`
  const frozen = f.closedIssues.map((n) => closedText(n, fmtCents)).join('')
  if (f.differenceCents > 0) {
    return `${head}; abgezogen sind dort ${fmtCents(f.deductedCents)} statt ${fmtCents(f.amountCents)}; ${fmtCents(f.differenceCents)} werden damit doppelt verteilt. ` +
      'Erfassen Sie beim Allgemeinstrom einen Abzug in Höhe des Betriebsstroms, etwa mit der Karte „Betriebsstrom“ auf der Seite Heizkosten, ' +
      'oder nehmen Sie den Betriebsstrom aus den Heizkosten heraus und tragen ihn selbst (§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 13 und 15).' +
      frozen
  }
  return `${head}; abgezogen sind dort ${fmtCents(f.deductedCents)}, ${fmtCents(-f.differenceCents)} mehr als der Betriebsstrom. ` +
    'Diesen Teil des Allgemeinstroms tragen Sie damit selbst; passen Sie den Abzug an den Betriebsstrom an (§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15).' +
    frozen
}
