// Betriebsstrom im Allgemeinstrom (Heizung PR 15, #212, Entwurf 10.1). Eine Position mit
// `operatingPower: 'included'` sagt: Dieser Strom steckt auch in der Stromrechnung des Hauses. Dann muss
// beim Allgemeinstrom ein Abzug in gleicher Höhe stehen, sonst zahlen die Mieter ihn doppelt
// (§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15). Die Abzüge zählen über ihren
// Verweis und aus jedem Zeitraum (Review Focus 5); geprüft werden nur die Positionen, die die
// Abrechnung verteilt, damit der Hinweis genau einmal erscheint, nämlich dort, wo der Betriebsstrom steht.
import type { CostItem, HeatingEnergy, HeatingMethod, HeatingSource, HeatingSupply, OperatingPowerDeduction, OperatingPowerHandling } from '../../shared/types.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { asksOperatingPowerHandling, GENERAL_POWER_CATEGORY, POWER_GENERATED } from '../../shared/operatingPower.ts'

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
// R3-K-1: ohne Rückbezug, damit der Satz nach dem Fristsatz nicht diesem zugeschrieben wird.
const GENERATION_LAW = 'Dass dieser Strom nicht im Allgemeinstrom stehen darf, hat der Bundesgerichtshof für den Betriebsstrom entschieden (BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 13 f. und 15); dass es für den Strom zur Wärmeerzeugung ebenso gilt, ist eine Auslegung von Mietfuchs (§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV).'

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
      // R3-W-1: Selbst tragen heißt, er steht weder in den Heizkosten noch ungekürzt im Allgemeinstrom. Der Weg
      // ist deshalb immer der Abzug; wer nicht umlegen will, nimmt ihn zusätzlich aus den Heizkosten heraus.
      const keep = 'Wollen Sie ihn nicht umlegen, ziehen Sie ihn ebenso beim Allgemeinstrom ab und nehmen ihn zusätzlich aus den Heizkosten heraus; dann tragen Sie ihn selbst'
      const advice = f.generation
        ? `Erfassen Sie im Kostenformular beim Allgemeinstrom einen Abzug in Höhe dieses Stroms und verknüpfen Sie ihn mit dieser Position. ${keep}.`
        : `Erfassen Sie beim Allgemeinstrom einen Abzug in Höhe des Betriebsstroms, etwa mit der Karte „Betriebsstrom“ auf der Seite Heizkosten. ${keep} ${LAW_SELF}.`
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
    // R3-H-2: die Abrechnung des unlesbaren Abzugs mit Namen.
    const names = unknown.map((n) => `„${n.description}“`).join(', ')
    const where = [...new Set(unknown.map((n) => n.label))].join(', ')
    const open = f.others.filter((o) => o.credited === null)
    const credited = f.others.filter((o) => o.credited !== null)
    const openCents = open.reduce((a, o) => a + o.amountCents, 0)
    const creditedCents = credited.reduce((a, o) => a + o.amountCents, 0)
    if (credited.length > 0) {
      tail += ` Daneben ${credited.map((o) => `ist in der zugestellten Abrechnung ${o.credited} ein weiterer Abzug von ${fmtCents(o.amountCents)} gutgeschrieben („${o.description}“)`).join('; ')}. ` +
        `Steht der Abzug ${names} in der zugestellten Abrechnung ${where}, ist den Mietern ${twice(creditedCents)}. ` +
        // R3-H-2: Hier wird keine neue Abrechnung empfohlen, deshalb kein Fristsatz, sondern nur die Grenze.
        'Eine schon zugestellte doppelte Gutschrift lässt sich nach Ablauf der Abrechnungsfrist nicht mehr zu Lasten der Mieter korrigieren; den Betrag tragen Sie dann selbst (§ 556 Abs. 3 Satz 3 BGB; BGH, Urteil vom 17.11.2004, VIII ZR 115/04).'
    }
    if (open.length > 0) {
      tail += ` Daneben sind beim Allgemeinstrom weitere ${fmtCents(openCents)} abgezogen (${open.map((o) => `„${o.description}“`).join(', ')}). ` +
        `Steht der Abzug ${names} in der zugestellten Abrechnung ${where}, ist den Mietern ${twice(openCents)}; löschen Sie dann den weiteren Abzug.`
    }
  } else if (rest > 0) {
    tail = f.generation
      ? ` Außerdem fehlen ${fmtCents(rest)}. Erfassen Sie dafür im Kostenformular beim Allgemeinstrom einen Abzug und verknüpfen Sie ihn mit dieser Position.`
      : ` Außerdem fehlen ${fmtCents(rest)}. Erfassen Sie dafür beim Allgemeinstrom einen Abzug, etwa mit der Karte „Betriebsstrom“ auf der Seite Heizkosten ${LAW}.`
  }
  return `${lead}${sentences}${tail}${generationLaw}`
}

// ---------- Betriebsstrom fehlt (#224) und Strom zur Wärmeerzeugung im Allgemeinstrom (#253) ----------
//
// Folge-PR zu #252. Beide Hinweise sind Auskunft und ändern keine Zahl. Sie kommen nur in der Gesamtberechnung
// eines Zeitraums P und nur, wo die Lage eindeutig ist; im Zweifel schweigen sie, denn wegklicken lassen sie sich
// nicht (Entscheidung F1). Was sie bewusst nicht sehen:
// - A (Betriebsstrom fehlt) schweigt, sobald die Anlage irgendeine Heizposition „Betrieb“ hat, auch wenn es nur
//   die Wartung ist: Ohne Angabe des Vermieters lässt sie sich von einer Rechnung über einen eigenen Zähler nicht
//   unterscheiden. Ebenso bei einer Heizposition ohne Teil, bei Fernwärme (F3) und ohne Allgemeinstrom (F2).
// - Beide schweigen beim Messdienst: Dessen Beträge enthalten den Betriebsstrom meist, und ob er über einen
//   eigenen Zähler lief, sieht Mietfuchs nicht. Ebenso bei der Eigentumswohnung (Pflicht der Gemeinschaft) und
//   bei der Etagenheizung.
// - B (Wärmepumpe, Elektrokessel) schweigt für Zeiträume ganz vor dem Inkrafttreten der BetrKV-Fassung (F4); das
//   fragt calc.ts im Register ab.

type PowerItem = Pick<CostItem, 'id' | 'category' | 'description' | 'amountCents' | 'key' | 'heatingPart' | 'heatingPlantId' | 'fuelDeliveryId' | 'operatingPower' | 'operatingPowerItemId'>
export type PowerPlant = { id: string; name?: string; energy: HeatingEnergy; method: HeatingMethod; source: HeatingSource; supply?: HeatingSupply; periodStartMonth?: number | null; endsOn?: string | null; replacesPlantId?: string | null; operatingPowerHandling?: OperatingPowerHandling | null }

// `operating`: A ohne Angabe an der Anlage (#224). Mit Angabe (#266) `deductionMissing` (Strom über die Rechnung des
// Hauses, aber kein Abzug) oder `billMissing` (eigener Stromvertrag, aber keine Heizposition „Betrieb“).
// `generation`: B (#253), unabhängig von der Angabe.
export type MissingPowerFinding = {
  kind: 'operating' | 'deductionMissing' | 'billMissing' | 'generation'
  plantId: string
  plantName: string
  energy: HeatingEnergy
  // Die Stromrechnungen des Allgemeinstroms in P, in der Reihenfolge der Positionen; bei `billMissing` auch leer.
  generals: { id: string; description: string }[]
  // Ob die Anlage in P eine Heizposition „Betrieb“ ohne Kennzeichnung oder eine ohne Teil hat (Lage O); bei
  // `deductionMissing` sagt der Text dann, dass sie den Abzug nicht ersetzt und wie man nicht doppelt bucht.
  hasOperatingPart: boolean
}

export function missingPowerFindings(input: {
  period: { from: string; to: string }
  plants: readonly PowerPlant[]
  // Die Positionen des Zeitraums P.
  items: readonly PowerItem[]
  // Die Heizperioden der Anlagen mit eigener Heizperiode, die in P stehen (Weg b und d).
  heatingParts: readonly { plantId: string; items: readonly PowerItem[] }[]
}): MissingPowerFinding[] {
  // G: Allgemeinstrom in P. Ohne ihn ist nichts herauszurechnen (F2); nur „Rechnung fehlt“ kommt auch ohne, denn er
  // betrifft die Rechnung des eigenen Stromvertrags und nicht den Allgemeinstrom.
  const generals = input.items.filter((c) => c.category === GENERAL_POWER_CATEGORY && c.amountCents > 0 && c.operatingPower === undefined && c.key !== 'external' && c.key !== 'amounts')
  // Zu welcher Anlage eine Heizposition gehört, soweit bekannt. Ein Abzug auf eine unbekannte Position oder ohne
  // Verweis („dem Messdienst gemeldet“) gilt für jede Anlage als Antwort: lieber still als falsch.
  const plantOf = new Map<string, string>()
  for (const c of [...input.items, ...input.heatingParts.flatMap((p) => p.items)]) if (c.heatingPlantId) plantOf.set(c.id, c.heatingPlantId)
  const deductions = input.items.filter((c) => c.operatingPower === 'deduction')
  const out: MissingPowerFinding[] = []
  for (const plant of input.plants) {
    if ((plant.supply ?? 'central') !== 'central' || plant.source !== 'building' || plant.method === 'service') continue
    const generation = POWER_GENERATED.includes(plant.energy)
    // A gilt, wo Mietfuchs nach der Angabe fragt (Brenner, F3); eine Stelle für Frage und Hinweis (#266).
    if (!generation && !asksOperatingPowerHandling(plant)) continue
    // Die Angabe zählt nur, wo Mietfuchs nach ihr fragt; B kennt sie nicht (#266, E5).
    const handling = generation ? null : (plant.operatingPowerHandling ?? null)
    // Eigener Stromvertrag, dessen Kosten der Vermieter selbst trägt: rechtmäßig, nichts zu prüfen.
    if (handling === 'landlordPays') continue
    if (handling !== 'ownMeter' && generals.length === 0) continue
    const own = (plant.periodStartMonth ?? null) !== null
    // Eine Heizposition ohne Anlage kann zu jeder Anlage ohne eigene Heizperiode gehören.
    const heat = own
      ? input.heatingParts.filter((p) => p.plantId === plant.id).flatMap((p) => p.items)
      : input.items.filter((c) => c.category === HEATING_CATEGORY && (c.heatingPlantId === plant.id || !c.heatingPlantId))
    // I: gekennzeichneter Betriebsstrom; fehlt dessen Abzug, meldet das schon `heating.operating-power-double`.
    if (heat.some((c) => c.operatingPower === 'included')) continue
    // D: ein Abzug in P, der zu dieser Anlage gehören kann.
    if (deductions.some((d) => !d.operatingPowerItemId || (plantOf.get(d.operatingPowerItemId) ?? plant.id) === plant.id)) continue
    const partless = (c: PowerItem): boolean => c.heatingPart === undefined && !c.fuelDeliveryId
    // O: eine Heizposition „Betrieb“ (ohne Kennzeichnung, die steht oben) oder eine ohne Teil.
    const operatingPart = heat.some((c) => c.heatingPart === 'operating' || partless(c))
    if (generation) {
      if (plant.endsOn && plant.endsOn < input.period.from) continue
      const replaced = plant.replacesPlantId ? input.plants.find((p) => p.id === plant.replacesPlantId) : undefined
      if (replaced?.endsOn && replaced.endsOn >= input.period.to) continue
      if (heat.some((c) => c.heatingPart === 'fuel' || Boolean(c.fuelDeliveryId) || partless(c))) continue
    } else {
      if (!heat.some((c) => c.amountCents > 0)) continue
      // Ohne Angabe und beim eigenen Stromvertrag gilt O als Antwort. Beim Strom über die Rechnung des Hauses nicht:
      // Eine Wartung ersetzt den Abzug nicht (§ 7 Abs. 2 HeizkostenV nennt beide getrennt), und genau dieser Fall
      // blieb ohne Angabe stumm (#266).
      if (handling !== 'deducted' && operatingPart) continue
    }
    const kind = generation ? 'generation' : handling === 'deducted' ? 'deductionMissing' : handling === 'ownMeter' ? 'billMissing' : 'operating'
    out.push({ kind, plantId: plant.id, plantName: plant.name ?? '', energy: plant.energy, generals: generals.map((g) => ({ id: g.id, description: g.description })), hasOperatingPart: operatingPart })
  }
  return out
}

const plantText = (f: MissingPowerFinding): string => (f.plantName ? `Für die Heizanlage „${f.plantName}“` : 'Für die Heizanlage')
const generalsText = (f: MissingPowerFinding): string => {
  const first = f.generals[0]
  return first === undefined ? '' : `„${first.description}“${f.generals.length > 1 ? ' und weiteren' : ''}`
}
// K-1 (Rechtsprüfung des Plans): der rechtmäßige Fall, in dem nichts zu tun ist (V ZR 166/15, Rn. 15).
const OWN_METER_SELF = 'Tragen Sie den Strom eines eigenen Zählers selbst, ist nichts falsch; der Hinweis bleibt dann stehen.'
// H-3: Wer beim Allgemeinstrom pauschal oder inklusive zahlt, wird dort nicht abgerechnet.
const FLAT_TENANTS = 'Gilt für einen Mieter beim Allgemeinstrom eine Pauschale oder Inklusivmiete, folgt daraus für ihn nichts.'

// A (#224): Text des Hinweises `heating.operating-power-missing`.
export function missingOperatingPowerText(f: MissingPowerFinding, label: string): string {
  return `${plantText(f)} ist für ${label} kein Betriebsstrom erfasst (keine Heizposition mit dem Teil „Betrieb“), und beim Allgemeinstrom ${generalsText(f)} steht kein Abzug dafür. ` +
    'Brenner, Umwälzpumpen und Regelung einer Zentralheizung verbrauchen Strom. Dieser Betriebsstrom gehört zu den Heiz- und Warmwasserkosten (§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; § 2 Nr. 4 Buchst. a, Nr. 5 Buchst. a BetrKV). ' +
    'Läuft er über den Stromzähler des Hauses, steckt er in dieser Stromrechnung und wird mit ihrem Schlüssel verteilt; dort darf er nicht stehen (BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 13). ' +
    'Erfassen Sie ihn dann mit der Karte „Betriebsstrom“ auf der Seite Heizkosten. Ohne Zwischenzähler dürfen Sie ihn schätzen; bestreitet ein Mieter den Betrag, müssen Sie die Grundlagen darlegen (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz 3). ' +
    'Wollen Sie ihn nicht umlegen, ziehen Sie ihn trotzdem beim Allgemeinstrom ab; dann tragen Sie ihn selbst (V ZR 166/15, Rn. 15). ' +
    `Hat die Heizung einen eigenen Stromzähler, erfassen Sie dessen Rechnung als Heizposition mit dem Teil „Betrieb“; dann entfällt dieser Hinweis. ${OWN_METER_SELF} ${FLAT_TENANTS}`
}

// #266: Text des Hinweises `heating.operating-power-deduction-missing`.
export function deductionMissingText(f: MissingPowerFinding, label: string): string {
  return `${plantText(f)}: ${label}`
}

// #266: Text des Hinweises `heating.operating-power-bill-missing`.
export function billMissingText(f: MissingPowerFinding, label: string): string {
  return `${plantText(f)}: ${label}`
}

// B (#253): Text des Hinweises `heating.generation-power-missing`. `betrkvSince` und `hkvSince` kommen aus dem
// Register, deutsch geschrieben; `hkvSince` ist null, wo der Zeitraum die Fassung der HeizkostenV nicht berührt
// oder die Verordnung für diese Wärmepumpe noch nicht gilt (§ 12 Abs. 3 Satz 2 HeizkostenV, K-2). K-3: Die
// Schätzung ist nur für den Betriebsstrom entschieden.
export function generationPowerText(f: MissingPowerFinding, label: string, betrkvSince: string, hkvSince: string | null): string {
  const device = f.energy === 'heatPump' ? 'Wärmepumpe' : 'Elektrokessel'
  const ofDevice = f.energy === 'heatPump' ? 'der Wärmepumpe' : 'des Elektrokessels'
  // Recht H-1 (Nachprüfung fc20455): „soweit sie für die Anlage gilt“, denn bei freien Schlüsseln, § 2 und § 11
  // HeizkostenV gilt sie nicht immer; die Kernaussage trägt § 2 Nr. 4 Buchst. a BetrKV.
  const hkv = hkvSince === null ? '' : `, ebenso § 7 Abs. 2 HeizkostenV seit dem ${hkvSince}, soweit die Heizkostenverordnung für die Anlage gilt (§ 8 Abs. 2 HeizkostenV verweist darauf)`
  return `${plantText(f)} (${device}) ist für ${label} keine Rechnung über den Strom erfasst, den sie zur Wärmeerzeugung verbraucht (keine Heizposition mit dem Teil „Brennstoff/Energie“), und beim Allgemeinstrom ${generalsText(f)} steht kein Abzug dafür. ` +
    `Diesen Strom zählt § 2 Nr. 4 Buchst. a BetrKV seit dem ${betrkvSince} zu den Heizkosten${hkv}. ` +
    'Läuft er über den Stromzähler des Hauses, steckt er in dieser Stromrechnung und wird mit dem Schlüssel des Allgemeinstroms verteilt statt mit den Heizkosten. ' +
    'Dass er dann aus dem Allgemeinstrom herauszurechnen ist, ist eine Auslegung von Mietfuchs: Entschieden hat der Bundesgerichtshof das für den Betriebsstrom (BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 13 f.). ' +
    `Erfassen Sie den Strom ${ofDevice} in diesem Fall als Heizposition mit dem Teil „Brennstoff/Energie“, beantworten Sie dort „Läuft dieser Strom über den Stromzähler des Hauses?“ mit Ja und erfassen Sie beim Allgemeinstrom einen Abzug in derselben Höhe, verknüpft mit dieser Position. ` +
    'Ohne eigenen Zähler müssten Sie den Anteil schätzen; für den Betriebsstrom ist das zulässig (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz 3), für den Strom einer Wärmepumpe oder eines Elektrokessels ist es eine Auslegung von Mietfuchs, und bei einem so großen Anteil ist ein eigener Zähler der sichere Weg. Halten Sie die Grundlage der Schätzung im Kostenformular fest. ' +
    `Hat das Gerät einen eigenen Zähler, erfassen Sie dessen Rechnung als Heizposition mit dem Teil „Brennstoff/Energie“; dann entfällt dieser Hinweis. ${OWN_METER_SELF} ${FLAT_TENANTS}`
}
