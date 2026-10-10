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
  // R-W2: Strom zur Wärmeerzeugung einer Wärmepumpe oder Stromheizung (Teil „Brennstoff/Energie“) statt
  // Betriebsstrom; der Text sagt dann, dass das Herausrechnen eine Auslegung ist.
  generation: boolean
  description: string
  amountCents: number
  // Was den Mietern gutgeschrieben ist (`creditedCents`) und die Differenz zum Betriebsstrom.
  deductedCents: number
  differenceCents: number
  closedIssues: OperatingPowerClosedIssue[]
  // Die übrigen Abzüge (offen oder gutgeschrieben), mit ihrem heutigen Betrag (R-W1); `credited`: die
  // abgeschlossene Abrechnung, in der er gutgeschrieben ist, sonst null (offen; R2-K-A).
  others: { description: string; amountCents: number; credited: string | null }[]
}

// Was ein Abzug den Mietern gutgeschrieben hat (als positiver Betrag): offen oder gutgeschrieben sein
// Betrag; bei geändertem Betrag der eingefrorene; nicht im Stand oder unlesbar nichts. Bei `unknown`
// zählt er nicht: Ein Hinweis zu viel ist der harmlosere Ausgang als eine stumme Doppelbelastung.
function creditedCents(d: OperatingPowerDeduction): number {
  if (d.closed === null || d.closed.state === 'credited') return -d.amountCents
  if (d.closed.state === 'changed') return -d.closed.frozenCents
  return 0
}

// Ein Hinweis entsteht, wenn das Gutgeschriebene vom Betriebsstrom abweicht, und immer, solange ein
// eingefrorener Stand unlesbar ist (R-W1): Stand der Abzug doch in der zugestellten Abrechnung, wäre ein
// zweiter Abzug eine doppelte Gutschrift, und die bliebe sonst stumm.
export function operatingPowerFindings(
  distributed: readonly Pick<CostItem, 'id' | 'description' | 'amountCents' | 'operatingPower' | 'heatingPart'>[],
  deductions: readonly OperatingPowerDeduction[],
): OperatingPowerFinding[] {
  const out: OperatingPowerFinding[] = []
  for (const item of distributed) {
    if (item.operatingPower !== 'included') continue
    const mine = deductions.filter((d) => d.itemId === item.id)
    const deductedCents = mine.reduce((a, d) => a + creditedCents(d), 0)
    const differenceCents = item.amountCents - deductedCents
    const closedIssues = mine.flatMap((d): OperatingPowerClosedIssue[] => {
      const c = d.closed
      if (c === null || c.state === 'credited') return []
      return [{ description: d.description, label: c.label, amountCents: -d.amountCents, state: c.state, frozenCents: c.state === 'changed' ? -c.frozenCents : null }]
    })
    if (differenceCents === 0 && !closedIssues.some((c) => c.state === 'unknown')) continue
    const others = mine.filter((d) => d.closed === null || d.closed.state === 'credited').map((d) => ({ description: d.description, amountCents: -d.amountCents, credited: d.closed?.label ?? null }))
    out.push({ itemId: item.id, generation: item.heatingPart === 'fuel', description: item.description, amountCents: item.amountCents, deductedCents, differenceCents, closedIssues, others })
  }
  return out
}

// R-K1: Wiederöffnen rechnet den ganzen Zeitraum neu; nach Ablauf der Frist darf die neue Abrechnung den
// Mieter weder insgesamt noch bei einer Position schlechter stellen als die zugestellte.
const DEADLINE = 'Ist die Abrechnungsfrist abgelaufen, darf die neue Abrechnung den Mieter nicht schlechter stellen als die zugestellte: keine höhere Nachforderung, kein geringeres Guthaben und auch bei keiner einzelnen Position mehr als zuvor, es sei denn, Sie haben die Verspätung nicht zu vertreten (§ 556 Abs. 3 Satz 3 BGB; BGH, Urteile vom 17.11.2004, VIII ZR 115/04, und vom 12.12.2007, VIII ZR 190/06).'

const LAW = '(§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15)'
// R2-H-C: Rn. 13 trägt, dass er nicht im Allgemeinstrom stehen darf, Rn. 14 das Schätzen des Anteils,
// Rn. 15 das Selbsttragen.
const LAW_SELF = '(§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 13 f. und 15)'
// R2-W-A: Für den Strom zur Wärmeerzeugung steht das Zitat nur zusammen mit der Auslegung.
const GENERATION_LAW = 'Für den Betriebsstrom hat der Bundesgerichtshof das entschieden (BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 13 f. und 15); dass es für den Strom zur Wärmeerzeugung ebenso gilt, ist eine Auslegung von Mietfuchs (§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV).'

// Ein Satz je Abzug in einer abgeschlossenen Abrechnung (R-W1, R2-W2, R-K3). Nur wo feststeht, dass er nicht
// oder zu wenig gutgeschrieben ist, steht die Bitte, die Abrechnung wieder zu öffnen; kein Satz rät zu
// einem neuen Abzug in einem anderen Jahr, denn der käme bei anderen Abrechnungen an.
function closedText(n: OperatingPowerClosedIssue, fmtCents: (c: number) => string, what: string): string {
  if (n.state === 'unknown') {
    return ` Der Abzug „${n.description}“ (${fmtCents(n.amountCents)}) gehört zur abgeschlossenen Abrechnung ${n.label}. Ob er dort gutgeschrieben ist, lässt sich aus dem gespeicherten Stand nicht lesen. ` +
      `Sehen Sie bitte in der zugestellten Abrechnung nach. Steht er dort, ist nichts zu tun. Fehlt er, öffnen Sie die Abrechnung ${n.label} wieder und stellen Sie sie neu zu. ` +
      'Legen Sie keinen zweiten Abzug an, sonst bekommen die Mieter ihn womöglich zweimal gutgeschrieben.'
  }
  const frozen = n.frozenCents ?? 0
  if (n.state === 'changed' && frozen > n.amountCents) {
    return ` Der Abzug „${n.description}“ steht in der abgeschlossenen Abrechnung ${n.label} mit ${fmtCents(frozen)} statt ${fmtCents(n.amountCents)}, denn der Betrag wurde nach dem Abschluss verkleinert. ` +
      `Den Mietern ist dort ${fmtCents(frozen - n.amountCents)} mehr gutgeschrieben als ${what === 'Betriebsstrom' ? 'der Betriebsstrom' : 'dieser Strom'}; diesen Teil des Allgemeinstroms tragen Sie selbst. ` +
      `Das benachteiligt die Mieter nicht und ist nach Auffassung von Mietfuchs zulässig (vgl. BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 15). ${DEADLINE}`
  }
  if (n.state === 'changed') {
    return ` Der Abzug „${n.description}“ steht in der abgeschlossenen Abrechnung ${n.label} mit ${fmtCents(frozen)} statt ${fmtCents(n.amountCents)}, denn der Betrag wurde nach dem Abschluss geändert. ` +
      `${fmtCents(n.amountCents - frozen)} zahlen die Mieter dort also doppelt. Soll der neue Betrag gelten, öffnen Sie die Abrechnung ${n.label} wieder und stellen Sie sie neu zu. ` +
      `Legen Sie dafür keinen weiteren Abzug an. ${DEADLINE}`
  }
  return ` Der Abzug „${n.description}“ (${fmtCents(n.amountCents)}) gehört zur abgeschlossenen Abrechnung ${n.label}, steht aber nicht in ihrem eingefrorenen Stand. ` +
    `Den Mietern ist er dort nicht gutgeschrieben, sie zahlen diesen Strom also zweimal. Öffnen Sie die Abrechnung ${n.label} wieder und stellen Sie sie neu zu. ` +
    'Legen Sie keinen zweiten Abzug in einem anderen Jahr an, denn er käme bei anderen Abrechnungen an. ' +
    `Eine Gutschrift dürfen Sie auch nach Ablauf der Abrechnungsfrist noch nachholen, denn § 556 Abs. 3 Satz 3 BGB schließt nur Nachforderungen aus. ${DEADLINE}`
}

// Der Text des Befunds. Ohne Abzug in einer abgeschlossenen Abrechnung zwei Fälle eines Codes: zu wenig
// abgezogen heißt doppelt verteilt, zu viel heißt, der Vermieter trägt einen Teil des Allgemeinstroms
// selbst. Mit Abzügen in abgeschlossenen Abrechnungen ein eigener Kopf und je Abzug ein Satz (R-W1); was
// gemessen an den heutigen Beträgen noch fehlt, steht danach. Die Norm nennt auch das Warmwasser (P-K3);
// selbst tragen ist zulässig (P-K5, V ZR 166/15 Rn. 15), heißt aber, den Betriebsstrom aus den Heizkosten
// zu nehmen (R2-K3).
export function operatingPowerText(f: OperatingPowerFinding, fmtCents: (c: number) => string): string {
  const what = f.generation ? 'Strom zur Wärmeerzeugung' : 'Betriebsstrom'
  const head = `„${f.description}“: Dieser ${what} steckt nach Ihrer Angabe auch in der Stromrechnung des Allgemeinstroms`
  // R-W2: Für den Strom zur Wärmeerzeugung ist das Herausrechnen eine Auslegung; entschieden ist es für den Betriebsstrom.
  // R2-W-A: Für den Strom zur Wärmeerzeugung kein „Betriebsstrom“ und kein Verweis auf die Karte, die ihn
  // ablehnt; der Abzug entsteht von Hand im Kostenformular, verknüpft mit dieser Position.
  const generationLaw = f.generation ? ` ${GENERATION_LAW}` : ''
  const asThis = f.generation ? 'dieser Strom' : 'der Betriebsstrom'
  if (f.closedIssues.length === 0) {
    if (f.differenceCents > 0) {
      const advice = f.generation
        ? 'Erfassen Sie im Kostenformular beim Allgemeinstrom einen Abzug in Höhe dieses Stroms und verknüpfen Sie ihn mit dieser Position, oder nehmen Sie den Strom zur Wärmeerzeugung aus den Heizkosten heraus und tragen ihn selbst.'
        : `Erfassen Sie beim Allgemeinstrom einen Abzug in Höhe des Betriebsstroms, etwa mit der Karte „Betriebsstrom“ auf der Seite Heizkosten, oder nehmen Sie den Betriebsstrom aus den Heizkosten heraus und tragen ihn selbst ${LAW_SELF}.`
      return `${head}; abgezogen sind dort ${fmtCents(f.deductedCents)} statt ${fmtCents(f.amountCents)}; ${fmtCents(f.differenceCents)} werden damit doppelt verteilt. ${advice}${generationLaw}`
    }
    return `${head}; abgezogen sind dort ${fmtCents(f.deductedCents)}, ${fmtCents(-f.differenceCents)} mehr als ${asThis}. ` +
      `Diesen Teil des Allgemeinstroms tragen Sie damit selbst; passen Sie den Abzug an ${f.generation ? 'diesen Strom' : 'den Betriebsstrom'} an${f.generation ? '.' : ` ${LAW}.`}${generationLaw}`
  }
  const lead = `${head}. ${f.closedIssues.length === 1 ? 'Der Abzug dafür steht' : 'Abzüge dafür stehen'} in einer abgeschlossenen Abrechnung.`
  const sentences = f.closedIssues.map((n) => closedText(n, fmtCents, what)).join('')
  // Was gemessen an den heutigen Beträgen aller Abzüge noch fehlt.
  const otherCents = f.others.reduce((a, o) => a + o.amountCents, 0)
  const rest = f.amountCents - f.closedIssues.reduce((a, n) => a + n.amountCents, 0) - otherCents
  const unknown = f.closedIssues.filter((n) => n.state === 'unknown')
  let tail = ''
  if (unknown.length > 0 && otherCents > 0) {
    // R2-K-A: Löschen nur, wo der weitere Abzug offen ist; ist er schon zugestellt, trägt der Vermieter die
    // doppelte Gutschrift. „zweimal“ nur bei gleichen Beträgen, sonst der Betrag.
    const unknownCents = unknown.reduce((a, n) => a + n.amountCents, 0)
    const twice = (cents: number) => (cents === unknownCents ? `${asThis} zweimal gutgeschrieben` : `zusätzlich ${fmtCents(Math.min(cents, unknownCents))} gutgeschrieben`)
    const names = unknown.map((n) => `„${n.description}“`).join(', ')
    const open = f.others.filter((o) => o.credited === null)
    const credited = f.others.filter((o) => o.credited !== null)
    const openCents = open.reduce((a, o) => a + o.amountCents, 0)
    const creditedCents = credited.reduce((a, o) => a + o.amountCents, 0)
    if (credited.length > 0) {
      tail += ` Daneben ${credited.map((o) => `ist in der zugestellten Abrechnung ${o.credited} ein weiterer Abzug von ${fmtCents(o.amountCents)} gutgeschrieben („${o.description}“)`).join('; ')}. ` +
        `Steht der Abzug ${names} ebenfalls in der zugestellten Abrechnung, ist den Mietern ${twice(creditedCents)}. ` +
        `Eine schon zugestellte doppelte Gutschrift lässt sich nach Ablauf der Abrechnungsfrist nicht mehr zu Lasten der Mieter korrigieren; den Betrag tragen Sie dann selbst. ${DEADLINE}`
    }
    if (open.length > 0) {
      tail += ` Daneben sind beim Allgemeinstrom weitere ${fmtCents(openCents)} abgezogen (${open.map((o) => `„${o.description}“`).join(', ')}). ` +
        `Steht der Abzug ${names} in der zugestellten Abrechnung, ist den Mietern ${twice(openCents)}; löschen Sie dann den weiteren Abzug.`
    }
  } else if (rest > 0) {
    tail = f.generation
      ? ` Außerdem fehlen ${fmtCents(rest)}. Erfassen Sie dafür im Kostenformular beim Allgemeinstrom einen Abzug und verknüpfen Sie ihn mit dieser Position.`
      : ` Außerdem fehlen ${fmtCents(rest)}. Erfassen Sie dafür beim Allgemeinstrom einen Abzug, etwa mit der Karte „Betriebsstrom“ auf der Seite Heizkosten ${LAW}.`
  }
  return `${lead}${sentences}${tail}${generationLaw}`
}
