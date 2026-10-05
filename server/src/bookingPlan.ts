// Planen einer Buchung (Belegbuchung, #170), als reine Funktion: Aus dem gespeicherten Stand und
// den Entscheidungen des Browsers entstehen die Vorschau und die Liste dessen, was zu schreiben
// ist. Die Vorschau sagt wörtlich, was die Buchung danach tut; db/booking.ts führt genau diese
// Schreibliste aus und nichts anderes.
//
// **Die Summenregel** (Spec, Entscheidung 2): Der Betrag einer Position, an der Zeilen hängen,
// ist die Summe **aller** Zeilen an ihr, über alle Belege, aus dem gespeicherten Stand. Deshalb
// kann keine Zeile doppelt zählen, egal wie oft gebucht wird. Der §35a-Lohnanteil folgt derselben
// Regel; nennt keine Zeile einen, wird ein vorhandener entfernt, und die Vorschau sagt es.
//
// **Eine Zeile, die nicht offen ist, wird nie noch einmal gebucht.** Ist sie genau so gebucht,
// ist das ohne Änderung (Doppelklick, Wiederholung); anders gebucht ist ein Widerspruch.
import type {
  AssessmentLineState, AssessmentView, BillingPeriod, BookingPreview, CostItem, CostKey, ExternalMeasure, LineDecision, LineFields, MeterType, PeriodKey, PeriodRules, PreviewItem, PreviewProblem, StoredAssessment, StoredAssessmentLine, Unit,
} from '../../shared/types.ts'
import type { Allocation } from '../../shared/allocation.ts'
import { periodLabel, periodOfKey, startYearOf } from '../../shared/period.ts'
import { amountProblem, closedPeriodNotice, costItemBody, euro, type CostItemBody } from '../../shared/costItem.ts'
import { bookingPeriod, bookingTaxYear, candidateText } from '../../shared/assessment.ts'
import { sameCostCandidates } from '../../shared/duplicates.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { heatingPeriodsEndingIn } from '../../shared/heatingPeriod.ts'
import { paymentYear, spansTwoYears } from '../../shared/period.ts'
import { isSplitPart } from '../../shared/splitPart.ts'
import { attachedText, candidatePool, carriesCredit, changeOf, lineCandidates, lineDraft, lineState, ownItemIds, twinText, type BookedLine, type LineChange } from './assessment.ts'

export type PlanInput = {
  assessment: StoredAssessment
  lines: readonly StoredAssessmentLine[]
  // Alle Positionen aller Objekte: Ein Ziel aus einem anderen Objekt soll benannt werden können
  items: readonly CostItem[]
  // Alle gebuchten Zeilen aller Auswertungen
  booked: readonly BookedLine[]
  // Die Wohnungen des Objekts der Auswertung
  units: readonly Unit[]
  // Andere Belege mit gleichem Inhalt (Prüfsumme)
  twinFiles: readonly string[]
  // Der Name eines Belegs, wie der Nutzer ihn kennt (für Hinweise); fehlt er, gilt der Dateiname
  fileNames: ReadonlyMap<string, string>
  // Abgeschlossene Abrechnungen aller Objekte (Integrationsdurchsicht vor 0.10): Ändert die Buchung
  // den Betrag einer Position in einem solchen Zeitraum, sagt die Vorschau es
  closed: readonly { propertyId: string; period: PeriodKey }[]
  // Die Regeln der Zeiträume des Objekts der Auswertung (#208); Pflicht (Durchsicht von #226, M1).
  rules: PeriodRules
  // Die eigene Heizperiode der einzigen Anlage des Objekts (Heizung PR 5); fehlt sie, folgt die
  // Heizung dem Objekt. Nur für den Satz der Vorschau: Die Position kommt in die Heizperiode, die im
  // Zielzeitraum endet, mit dem Jahr der Zahlung nach `paymentYear` (wie repository.ts).
  heatingRules?: PeriodRules | null
}

// Der Zeitraum, in den eine Auswertung bucht (#208, `bookingPeriod`), und die Bezeichnung eines
// Schlüssels nach den Regeln des Objekts.
const targetOfPlan = (input: PlanInput): BillingPeriod => bookingPeriod(input.rules, input.assessment)
const labelOfKey = (input: PlanInput, key: PeriodKey): string => {
  const p = periodOfKey(input.rules, key)
  return p ? periodLabel(p) : key
}

export type BookingWrite =
  | { kind: 'createItem'; id: string; body: CostItemBody & { propertyId: string } }
  | { kind: 'updateItem'; id: string; patch: { amountCents: number; labor35aCents: number | null; invoiceFile?: string } }
  | { kind: 'line'; idx: number; change: LineChange }

export type Planned = {
  preview: Omit<BookingPreview, 'token'>
  writes: BookingWrite[]
  // Entscheidungen, die schon genau so gebucht sind
  unchanged: number[]
  // Zeilen, die anders gebucht sind, als die Entscheidung verlangt (409)
  conflicts: string[]
  // Der Zustand jeder Zeile, über die entschieden wird, so wie der Planer sie vorfand. Er geht in
  // die Prüfmarke ein: Hat ein anderer Tab eine Zeile inzwischen verworfen, sähe die Vorschau
  // sonst gleich aus, und die ältere Vorschau buchte über die neue Entscheidung hinweg.
  decided: { idx: number; state: AssessmentLineState }[]
}

const FORM_ONLY: readonly CostKey[] = ['amounts', 'external']
const quote = (s: string): string => `„${s}“`

type Link = { assessmentId: string; idx: number; file: string; amountCents: number | null; labor35aCents: number | null }

export function planBooking(input: PlanInput, decisions: readonly LineDecision[], newId: () => string): Planned {
  const a = input.assessment
  const targetPeriod = targetOfPlan(input)
  const errors: PreviewProblem[] = []
  const confirm: PreviewProblem[] = []
  const notices: string[] = []
  const conflicts: string[] = []
  const unchanged: number[] = []
  const decided: { idx: number; state: AssessmentLineState }[] = []
  // Positionen, von denen eine Zeile gelöst wird (für den Beleg der Position, siehe unten)
  const released = new Set<string>()
  const fileName = (file: string): string => quote(input.fileNames.get(file) ?? file)
  const after = new Map<number, LineChange>()
  const created: PreviewItem[] = []
  const createWrites: BookingWrite[] = []
  const touched: string[] = []
  const itemById = new Map(input.items.map((i) => [i.id, i]))
  const own = new Set(ownItemIds(input.lines))
  const others = input.items.filter((i) => i.propertyId === a.propertyId && !own.has(i.id))
  const twinBooked = input.booked.some((l) => input.twinFiles.includes(l.file))
  const seen = new Set<number>()
  const named = (l: StoredAssessmentLine): string => quote(l.description || 'ohne Beschreibung')
  const targetOf = (l: StoredAssessmentLine): string => {
    const t = l.costItemId ? itemById.get(l.costItemId) : undefined
    return t ? quote(t.description) : 'einer Position'
  }

  if (a.propertyId === null && decisions.some((d) => d.action === 'create' || d.action === 'link')) {
    errors.push({ idx: null, message: 'Zu welchem Objekt gehört dieser Beleg? Bitte wählen Sie es zuerst; gebucht wird nur innerhalb eines Objekts.' })
  }

  for (const d of decisions) {
    const line = input.lines.find((l) => l.idx === d.idx)
    if (!line) {
      errors.push({ idx: d.idx, message: 'Diese Zeile der Auswertung gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
      continue
    }
    if (seen.has(d.idx)) {
      errors.push({ idx: d.idx, message: `${named(line)} steht zweimal in der Anfrage.` })
      continue
    }
    seen.add(d.idx)
    const state = lineState(line)
    decided.push({ idx: d.idx, state })

    if (d.action === 'create') {
      if (state === 'created') {
        if (sameCreate(d.fields, line, input, a)) unchanged.push(d.idx)
        else conflicts.push(`${named(line)} ist schon mit anderen Angaben als eigene Position ${targetOf(line)} angelegt.`)
        continue
      }
      if (state === 'linked') { conflicts.push(`${named(line)} ist schon mit ${targetOf(line)} verknüpft.`); continue }
      if (a.propertyId === null) continue
      if (d.fields.key === 'amounts') {
        errors.push({ idx: d.idx, message: `${named(line)}: Einzelbeträge je Mieter tragen Sie bitte im Formular der Position ein.` })
        continue
      }
      const built = costItemBody(lineDraft(d.fields, { vendor: a.vendor ?? '', invoiceFile: a.file, taxYear: bookingTaxYear(targetPeriod, a) }, input.units), input.units, targetPeriod.key)
      if ('error' in built) {
        errors.push({ idx: d.idx, message: `${quote(d.fields.description || line.description)}: ${built.error}` })
        continue
      }
      const body = built.body
      if (!d.despiteCandidates) {
        const pool = candidatePool(others, body.amountCents, input.booked)
        const candidates = sameCostCandidates(pool, { propertyId: a.propertyId, period: targetPeriod.key, category: body.category, description: body.description, vendor: a.vendor ?? '' })
        // Dieselbe Regel wie in der Ansicht (lineCandidates): Hängt dieser Beleg, ein Beleg gleichen
        // Inhalts oder (bei einer erneuten Auswertung) eine schon gebuchte Zeile dieses Belegs an
        // einer Position, gleich welcher Kostenart, ist die Rechnung womöglich schon erfasst.
        const ownItems = line.reassessed ? input.items.filter((i) => own.has(i.id)) : []
        const held = lineCandidates(others, a, body, input.booked, { own: ownItems, twinFiles: input.twinFiles, target: targetPeriod.key })
        if (held.own.length > 0) {
          confirm.push({ idx: d.idx, message: `Dieser Beleg ist schon gebucht (an ${held.own.map((i) => quote(i.description)).join(', ')}). Ist ${quote(body.description)} dort schon enthalten, legen Sie die Zeile nicht noch einmal an, sonst wird die Rechnung zweimal verteilt; verwerfen Sie sie. Legen Sie sie nur an, wenn sie dort nicht enthalten ist.` })
        } else if (held.attached.length > 0 || held.twin.length > 0) {
          const texts = [...(held.attached.length > 0 ? [attachedText(held.attached)] : []), ...(held.twin.length > 0 ? [twinText(held.twin, (f) => input.fileNames.get(f) ?? f)] : [])]
          confirm.push({ idx: d.idx, message: `${texts.join(' ')} Ist ${quote(body.description)} dort schon enthalten, legen Sie die Zeile nicht noch einmal an, sonst wird die Rechnung zweimal verteilt; verknüpfen Sie sie besser oder verwerfen Sie sie. Legen Sie sie nur an, wenn sie dort nicht enthalten ist.` })
        } else if (candidates.length > 0 && body.amountCents < 0) {
          // Eine Gutschrift wird nie verknüpft; die Rückfrage rät deshalb nicht dazu.
          confirm.push({ idx: d.idx, message: `Für ${periodLabel(targetPeriod)} steht schon ${candidates.map(candidateText).join(', ')}, eine Gutschrift derselben Kostenart wie ${quote(body.description)}. Ist es dieselbe Gutschrift, legen Sie sie nicht noch einmal an, sonst wird sie zweimal abgezogen. Ist es eine zweite Gutschrift, legen Sie sie als neue Position an.` })
        } else if (candidates.length > 0) {
          confirm.push({ idx: d.idx, message: `Für ${periodLabel(targetPeriod)} steht schon ${candidates.map(candidateText).join(', ')}, dieselbe Kostenart wie ${quote(body.description)}. Ist es dieselbe Rechnung, verknüpfen Sie den Beleg besser mit ihr, sonst wird sie zweimal verteilt. Ist es eine zweite Rechnung, legen Sie sie als neue Position an.` })
        } else if (twinBooked) {
          confirm.push({ idx: d.idx, message: `Ein Beleg mit gleichem Inhalt ist schon gebucht. Legen Sie ${quote(body.description)} nur an, wenn es wirklich eine zweite Rechnung ist.` })
        }
      }
      // Das Jahr der Zahlung nennt die Vorschau (Durchsicht von #231): bei einer Heizposition mit eigener
      // Heizperiode deren Jahr, sonst das der Buchung, und ob das Rechnungsdatum außerhalb lag.
      const heatingTarget = body.category === HEATING_CATEGORY && input.heatingRules ? heatingPeriodsEndingIn(input.heatingRules, targetPeriod) : []
      const h = heatingTarget.length === 1 ? heatingTarget[0] : undefined
      const yearSpan = h && spansTwoYears(h) ? h : !h && spansTwoYears(targetPeriod) ? targetPeriod : undefined
      // Bei einer Heizposition rechnet der Planer das Jahr einmal, und die Buchung schreibt genau diesen
      // Wert (Durchsicht von #231): Vorschau und gebuchte Position sagen dasselbe.
      let heatingTaxYear: number | undefined
      if (yearSpan) {
        const py = paymentYear(yearSpan, a.invoiceDate, h ? undefined : a.year)
        if (h) heatingTaxYear = py.year
        notices.push(`${quote(body.description)}: ${h ? `Heizperiode ${periodLabel(h)}, ` : ''}Jahr der Zahlung ${py.year}.` +
          (py.clamped && a.invoiceDate ? ` Das Rechnungsdatum ${a.invoiceDate.slice(8, 10)}.${a.invoiceDate.slice(5, 7)}.${a.invoiceDate.slice(0, 4)} liegt außerhalb der Jahre, die zu ${periodLabel(yearSpan)} passen; prüfen Sie das Jahr der Zahlung im Formular.` : ''))
      }
      const id = newId()
      createWrites.push({ kind: 'createItem', id, body: { ...body, ...(heatingTaxYear !== undefined ? { taxYear: heatingTaxYear } : {}), propertyId: a.propertyId } })
      after.set(d.idx, {
        booking: 'created', costItemId: id, dismissed: false, description: body.description, category: body.category,
        amountCents: body.amountCents, labor35aCents: d.fields.labor35aCents,
      })
      created.push({
        costItemId: null, lines: [d.idx], description: body.description, category: body.category, year: a.year,
        beforeCents: null, afterCents: body.amountCents, beforeLabor35aCents: null, afterLabor35aCents: body.labor35aCents ?? null,
      })
      continue
    }

    if (d.action === 'link') {
      if (state === 'linked' && line.costItemId === d.costItemId) {
        // Ohne Berichtigung gilt die gespeicherte; eine andere Berichtigung ginge sonst still verloren.
        const sameAmount = d.amountCents === undefined || d.amountCents === line.amountCents
        const sameLabor = d.labor35aCents === undefined || d.labor35aCents === line.labor35aCents
        if (sameAmount && sameLabor) unchanged.push(d.idx)
        else conflicts.push(`${named(line)} ist schon mit ${targetOf(line)} verknüpft, aber mit einem anderen Betrag oder Lohnanteil.`)
        continue
      }
      if (state === 'linked') { conflicts.push(`${named(line)} ist schon mit ${targetOf(line)} verknüpft.`); continue }
      if (state === 'created') { conflicts.push(`${named(line)} ist schon als eigene Position ${targetOf(line)} angelegt.`); continue }
      const target = itemById.get(d.costItemId)
      if (!target) {
        errors.push({ idx: d.idx, message: 'Diese Position gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
        continue
      }
      if (target.propertyId !== a.propertyId) {
        errors.push({ idx: d.idx, message: `${quote(target.description)} gehört zu einem anderen Objekt. Verknüpft wird nur innerhalb des Objekts dieses Belegs.` })
        continue
      }
      if (target.period !== targetPeriod.key) {
        errors.push({ idx: d.idx, message: `${quote(target.description)} gehört zu ${labelOfKey(input, target.period)}, der Beleg zu ${periodLabel(targetPeriod)}. Ändern Sie das Jahr des Belegs oder legen Sie eine neue Position an.` })
        continue
      }
      if (carriesCredit(target, input.booked)) {
        errors.push({ idx: d.idx, message: `${quote(target.description)} ist eine Gutschrift. Eine Gutschrift wird nie mit einer Rechnung verrechnet, damit sie auf der Abrechnung sichtbar bleibt; legen Sie ${named(line)} als eigene Position an.` })
        continue
      }
      // Review der Laienprobe (Runde 1): Ein Teil einer nach Tagen aufgeteilten Rechnung ist kein Ziel.
      // Die Summenregel setzte seinen Betrag auf die Summe der Zeilen, also auf die ganze Rechnung, und
      // die übrigen Teile stünden zusätzlich da (gemessen 681,73 € statt 470 €).
      if (isSplitPart(input.rules, target)) {
        errors.push({ idx: d.idx, openItemId: target.id, message: `${quote(target.description)} ist ein Teil einer nach Tagen aufgeteilten Rechnung; ihr Betrag ist nur der Anteil dieses Zeitraums. Verknüpfen lässt sich eine Zeile damit nicht. Öffnen Sie die Position, wenn sich der Betrag der Rechnung geändert hat, oder legen Sie ${named(line)} als eigene Position an.` })
        continue
      }
      if (FORM_ONLY.includes(target.key)) {
        const how = target.key === 'amounts' ? 'mit Einzelbeträgen je Mieter' : 'laut Gemeinschaftsabrechnung'
        errors.push({ idx: d.idx, openItemId: target.id, message: `${quote(target.description)} wird ${how} verteilt; ihr Betrag hängt an weiteren Angaben. Öffnen Sie die Position und tragen Sie ihn dort ein. Haben Sie die Position dort aktualisiert, verwerfen Sie diese Zeile hier danach, damit der Beleg nicht offen bleibt.` })
        continue
      }
      const amount = d.amountCents !== undefined ? d.amountCents : line.amountCents
      const labor = d.labor35aCents !== undefined ? d.labor35aCents : line.labor35aCents
      if (amount === null) {
        errors.push({ idx: d.idx, message: `${named(line)}: Der Betrag ist nicht gelesen. Bitte tragen Sie ihn ein.` })
        continue
      }
      if (amount < 0) {
        errors.push({ idx: d.idx, message: `${named(line)} ist eine Gutschrift. Sie wird nie mit einer Position verrechnet, sondern als eigene Position angelegt, damit sie auf der Abrechnung sichtbar bleibt.` })
        continue
      }
      if (input.booked.some((l) => l.costItemId === target.id && input.twinFiles.includes(l.file))) {
        errors.push({ idx: d.idx, message: `${quote(target.description)} enthält diesen Beleg schon: Ein Beleg mit gleichem Inhalt ist mit ihr verknüpft. Ein zweites Verknüpfen zählte die Rechnung doppelt.` })
        continue
      }
      if (line.reassessed && own.has(target.id) && !d.despiteCandidates) {
        // Erlaubt, denn es kann eine weitere Zeile derselben Rechnung sein; aber nur nach
        // ausdrücklicher Bestätigung wie beim Anlegen, denn Verknüpfen addiert (H1).
        const fromHere = input.booked.filter((l) => l.assessmentId === a.id && l.costItemId === target.id).reduce((s, l) => s + (l.amountCents ?? 0), 0)
        const all = input.booked.filter((l) => l.costItemId === target.id).reduce((s, l) => s + (l.amountCents ?? 0), 0)
        confirm.push({ idx: d.idx, message: `${quote(target.description)} ist schon aus diesem Beleg gebucht (${euro(fromHere)}). Verknüpfen addiert ${euro(amount)} auf ${euro(all + amount)}. Wählen Sie das nur, wenn die Rechnung diese Zeile zusätzlich enthält.` })
      }
      after.set(d.idx, { ...changeOf(line), booking: 'linked', costItemId: target.id, dismissed: false, amountCents: amount, labor35aCents: labor })
      if (!touched.includes(target.id)) touched.push(target.id)
      continue
    }

    if (d.action === 'dismiss') {
      if (state === 'dismissed') { unchanged.push(d.idx); continue }
      if (state !== 'open') { conflicts.push(`${named(line)} ist schon gebucht. Lösen Sie die Zeile zuerst, wenn Sie sie verwerfen möchten.`); continue }
      after.set(d.idx, { ...changeOf(line), dismissed: true })
      // Sonst zeigte eine Vorschau, die nur verwirft, nichts, und die Meldung nach dem Buchen ebenso.
      notices.push(`${named(line)} wird verworfen.`)
      continue
    }

    // release
    if (state === 'open' || state === 'dismissed') { unchanged.push(d.idx); continue }
    if (state === 'created') {
      errors.push({ idx: d.idx, message: `${named(line)} ist als eigene Position ${targetOf(line)} angelegt. Sie lösen sie, indem Sie die Position löschen; dann ist die Zeile wieder offen.` })
      continue
    }
    const from = line.costItemId
    after.set(d.idx, { ...changeOf(line), booking: null, costItemId: null, dismissed: false })
    if (from && !touched.includes(from)) touched.push(from)
    if (from) released.add(from)
  }

  // ---------- Die Summenregel je berührter Position ----------
  const updateWrites: BookingWrite[] = []
  const touchedItems: PreviewItem[] = []
  for (const id of touched) {
    const t = itemById.get(id)
    if (!t) continue
    const before = input.booked.filter((l) => l.costItemId === id)
    const links: Link[] = [
      ...before.filter((l) => !(l.assessmentId === a.id && after.has(l.idx))),
      ...[...after].filter(([, c]) => c.costItemId === id).map(([idx, c]) => ({ assessmentId: a.id, idx, file: a.file, amountCents: c.amountCents, labor35aCents: c.labor35aCents })),
    ]
    const beforeLabor = t.labor35aCents ?? 0
    const ownLines = links.filter((l) => l.assessmentId === a.id).map((l) => l.idx).sort((x, y) => x - y)
    if (links.length === 0) {
      notices.push(`${quote(t.description)} behält ihren Betrag von ${euro(t.amountCents)}; mit ihr ist keine Zeile eines Belegs mehr verknüpft.`)
      touchedItems.push({
        costItemId: id, lines: [], description: t.description, category: t.category, year: startYearOf(t.period), beforeCents: t.amountCents,
        afterCents: t.amountCents, beforeLabor35aCents: t.labor35aCents ?? null, afterLabor35aCents: t.labor35aCents ?? null,
      })
      continue
    }
    if (links.some((l) => l.amountCents === null)) {
      errors.push({ idx: null, message: `${quote(t.description)}: Mindestens eine verknüpfte Zeile hat keinen gelesenen Betrag.` })
      continue
    }
    const sum = links.reduce((s, l) => s + (l.amountCents ?? 0), 0)
    if (sum <= 0) {
      errors.push({ idx: null, message: `Die Summe der Zeilen an ${quote(t.description)} wäre ${euro(sum)}. Eine Gutschrift oder eine Summe von 0 € wird nicht verrechnet; legen Sie die Gutschrift als eigene Position an.` })
      continue
    }
    const read = links.filter((l) => l.labor35aCents !== null)
    const labor: number | null = read.length > 0
      ? read.reduce((s, l) => s + (l.labor35aCents ?? 0), 0)
      : beforeLabor > 0 ? null : t.labor35aCents ?? null
    const linkedBefore = before.reduce((s, l) => s + (l.amountCents ?? 0), 0)
    if (before.length === 0 && t.amountCents !== sum) {
      notices.push(`${quote(t.description)}: Der bisherige Betrag von ${euro(t.amountCents)} stammt aus keinem Beleg, etwa eine Schätzung aus dem Vorjahr. Er wird durch die Summe der Zeilen ersetzt, ${euro(sum)}.`)
    }
    if (before.length > 0 && t.amountCents !== linkedBefore) {
      notices.push(`${quote(t.description)}: Der Betrag wurde von Hand auf ${euro(t.amountCents)} geändert. Die Buchung setzt ihn auf die Summe der verknüpften Zeilen, ${euro(sum)}.`)
    }
    if (before.length === 0 && t.invoiceFile && t.invoiceFile !== a.file) {
      notices.push(`${quote(t.description)} trägt schon einen Beleg, dessen Zeilen nicht ausgewertet sind. Ihr Betrag wird trotzdem durch die Summe der Zeilen ersetzt; gehört die Rechnung nicht dazu, legen Sie sie besser als eigene Position an.`)
    }
    if (read.length === 0 && beforeLabor > 0) {
      notices.push(`${quote(t.description)}: Der bisherige §35a-Lohnanteil von ${euro(beforeLabor)} wird entfernt, denn keine verknüpfte Zeile nennt einen. Nennt die Rechnung einen, tragen Sie ihn im Formular ein.`)
    }
    if (read.length > 0 && labor === 0 && beforeLabor > 0) {
      notices.push(`${quote(t.description)}: Der §35a-Lohnanteil wird auf ${euro(0)} gesetzt, wie die Rechnung ihn nennt.`)
    }
    const problem = amountProblem(sum, labor ?? 0, t.category)
    if (problem !== null) {
      errors.push({ idx: null, message: `${quote(t.description)}: ${problem}` })
      continue
    }
    // Gesperrt wird nicht: Die Abrechnung bleibt eingefroren, und die Abweichung zeigt sie selbst.
    // Gesagt wird es, denn das Jahr aus dem Beleg geht dem gewählten vor, und eine Rechnung vom
    // Vorjahr landet leicht in einem abgeschlossenen.
    if ((sum !== t.amountCents || labor !== (t.labor35aCents ?? null)) && input.closed.some((c) => c.propertyId === t.propertyId && c.period === t.period)) {
      notices.push(`${quote(t.description)}: ${closedPeriodNotice(labelOfKey(input, t.period))}`)
    }
    // Der Beleg der Position. Beim Verknüpfen: Trägt sie keinen, den dieses Belegs. Beim Lösen
    // wechselt er nur, wenn er der Beleg der gelösten Zeile ist und aus ihm keine Zeile mehr an der
    // Position hängt; dann gilt der Beleg der ersten verbleibenden Zeile. Trägt sie keinen, ebenso,
    // nie aber der gerade gelöste. Ein von Hand angehängter Beleg wird nie ersetzt.
    let invoiceFile: string | undefined
    if (released.has(id)) {
      if (!t.invoiceFile || (t.invoiceFile === a.file && !links.some((l) => l.file === a.file))) invoiceFile = links[0]?.file
      if (invoiceFile !== undefined && invoiceFile !== t.invoiceFile) {
        notices.push(t.invoiceFile
          ? `${quote(t.description)} trägt künftig den Beleg ${fileName(invoiceFile)}, denn mit ${fileName(t.invoiceFile)} ist keine Zeile mehr an ihr verknüpft.`
          : `${quote(t.description)} trägt künftig den Beleg ${fileName(invoiceFile)}.`)
      }
    } else if (!t.invoiceFile) {
      invoiceFile = a.file
    }
    updateWrites.push({ kind: 'updateItem', id, patch: { amountCents: sum, labor35aCents: labor, ...(invoiceFile !== undefined ? { invoiceFile } : {}) } })
    touchedItems.push({
      costItemId: id, lines: ownLines, description: t.description, category: t.category, year: startYearOf(t.period), beforeCents: t.amountCents,
      afterCents: sum, beforeLabor35aCents: t.labor35aCents ?? null, afterLabor35aCents: labor,
    })
  }

  const lineWrites: BookingWrite[] = [...after].map(([idx, change]) => ({ kind: 'line', idx, change }))
  return {
    preview: { items: [...created, ...touchedItems], notices, errors, confirm },
    writes: [...createWrites, ...updateWrites, ...lineWrites],
    unchanged,
    conflicts,
    decided,
  }
}

// Ist eine angelegte Zeile genau so angelegt, wie die Entscheidung sie verlangt? Beschreibung,
// Kostenart, Betrag und Lohnanteil stehen an der Zeile, Schlüssel und Verteilung an der Position.
// Was nicht mehr übernehmbar ist, ist nicht gleich.
function sameCreate(fields: LineFields, line: StoredAssessmentLine, input: PlanInput, a: StoredAssessment): boolean {
  const target = targetOfPlan(input)
  const built = costItemBody(lineDraft(fields, { vendor: a.vendor ?? '', invoiceFile: a.file, taxYear: bookingTaxYear(target, a) }, input.units), input.units, target.key)
  if ('error' in built) return false
  const b = built.body
  if (b.description !== line.description || b.category !== line.category || b.amountCents !== line.amountCents || fields.labor35aCents !== line.labor35aCents) return false
  const item = input.items.find((i) => i.id === line.costItemId)
  if (!item) return true
  const filled = <T>(v: T | null | undefined): T | null => (v === undefined || v === null || (typeof v === 'object' && Object.keys(v).length === 0) ? null : v)
  // Schlüssel der Objekte sortiert: Was aus der Datenbank kommt, muss nicht in derselben Reihenfolge stehen.
  const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([k, w]) => [k, sorted(w)]))
      : v)
  const allocation = (x: Pick<CostItemBody, 'key' | 'directUnitId' | 'meterType' | 'customShares' | 'participantUnitIds' | 'externalBasis'> | CostItem): string => JSON.stringify(sorted([
    x.key, filled(x.directUnitId), filled(x.meterType), filled(x.customShares), filled(x.participantUnitIds), filled(x.externalBasis),
  ]))
  return allocation(b) === allocation(item)
}

// Woraus die Prüfmarke einer Vorschau entsteht: was sie zeigt und was sie an den Zeilen ändert,
// ohne die Kennungen neuer Positionen (die entstehen erst beim Buchen). Der Server bildet daraus
// eine SHA-256-Marke (db/booking.ts); ändert sich der Stand, ändert sich die Marke.
export function tokenSource(p: Planned): string {
  const lines = p.writes.flatMap((w) => w.kind === 'line'
    ? [[w.idx, w.change.booking, w.change.booking === 'created' ? null : w.change.costItemId, w.change.dismissed, w.change.amountCents, w.change.labor35aCents]]
    : [])
  // Neue Positionen mit allem, was sie werden (Schlüssel und Verteilung zeigt die Vorschau nicht,
  // sie gehören aber zur Buchung), ohne ihre Kennung.
  const creates = p.writes.flatMap((w) => (w.kind === 'createItem' ? [w.body] : []))
  return JSON.stringify({ items: p.preview.items, notices: p.preview.notices, lines, creates, decided: p.decided.map((d) => [d.idx, d.state]) })
}

// Die Vorschau, wie die Routen sie zeigen: Widersprüche stehen bei den Fehlern vorn.
export function previewWith(p: Planned, token: string): BookingPreview {
  return { ...p.preview, errors: [...p.conflicts.map((message) => ({ idx: null, message })), ...p.preview.errors], token }
}

// Ob gebucht wird. Die Reihenfolge ist die Zusage: Ein Widerspruch geht vor, eine ganz schon
// gebuchte Anfrage ist ein Erfolg ohne Änderung (Doppelklick), Fehler und offene Rückfragen
// verhindern das Buchen, und eine Vorschau auf einem anderen Stand auch.
export function decide(p: Planned, decisionCount: number, token: string, expected: string): 'apply' | 'unchanged' | 'conflict' | 'refused' | 'stale' {
  if (p.conflicts.length > 0) return 'conflict'
  if (p.unchanged.length === decisionCount) return 'unchanged'
  if (p.preview.errors.length > 0 || p.preview.confirm.length > 0) return 'refused'
  return token === expected ? 'apply' : 'stale'
}

// Was aus einer Buchung wird. `done` mit `changed: false` ist die schon genau so gebuchte Anfrage.
export type BookingOutcome =
  | { kind: 'done'; changed: boolean; preview: BookingPreview }
  | { kind: 'refused'; preview: BookingPreview }
  | { kind: 'conflict'; message: string }
  | { kind: 'stale'; preview: BookingPreview }

// Das Ergebnis jeder Entscheidung außer „buchen“; `null` heißt, die Schreibliste ist auszuführen.
// db/booking.ts und der nachgebaute Server der Browser-Tests (client/src/testing/fakeBooking.ts)
// nehmen beide diese Zuordnung, damit sie nicht zweimal dasteht.
export function settle(p: Planned, decisionCount: number, token: string, preview: BookingPreview): BookingOutcome | null {
  const decision = decide(p, decisionCount, token, preview.token)
  if (decision === 'conflict') return { kind: 'conflict', message: p.conflicts.join(' ') }
  if (decision === 'unchanged') return { kind: 'done', changed: false, preview }
  if (decision === 'refused') return { kind: 'refused', preview }
  if (decision === 'stale') return { kind: 'stale', preview }
  return null
}

const STALE = 'Seit der Vorschau hat sich der Stand geändert. Bitte prüfen Sie die neue Vorschau und buchen Sie dann.'

// Die Antwort der Route „Buchen“, ebenfalls für Route und nachgebauten Server. Jede Ablehnung
// bringt den Stand mit, mit dem die Oberfläche ohne zweite Anfrage weitermacht: 400 und die 409
// einer veralteten Vorschau die (neue) Vorschau, die 409 eines Widerspruchs die aktuelle Auswertung.
export function bookingResponse(outcome: BookingOutcome, assessment: AssessmentView): { status: 200 | 400 | 409; body: Record<string, unknown> } {
  switch (outcome.kind) {
    case 'done': return { status: 200, body: { changed: outcome.changed, assessment, preview: outcome.preview } }
    case 'refused': {
      const error = [...outcome.preview.errors, ...outcome.preview.confirm].map((p) => p.message).join(' ')
      return { status: 400, body: { error, preview: outcome.preview } }
    }
    case 'conflict': return { status: 409, body: { error: outcome.message, assessment } }
    case 'stale': return { status: 409, body: { error: STALE, preview: outcome.preview } }
  }
}

// ---------- Die Entscheidungen aus dem Rumpf ----------
//
// Verengt wird mit `typeof` und `Reflect.get`, wie in repository.ts. Die Listen erlaubter Werte
// sind `Record<…, true>`: Kommt ein Schlüssel oder Zählertyp hinzu, verlangt der Übersetzer ihn
// hier, ohne dass diese Datei das Schema (und damit drizzle) laden muss; die Tests des Browsers
// importieren sie.
const KEYS: Record<CostKey, true> = { area: true, persons: true, units: true, direct: true, meter: true, custom: true, external: true, amounts: true }
const METER_TYPES: Record<MeterType, true> = { kaltwasser: true, warmwasser: true, strom: true, waerme: true, hkv: true, sonstig: true }
const MEASURES: Record<ExternalMeasure, true> = { mea: true, area: true, units: true }

const get = (v: unknown, key: string): unknown => (v !== null && typeof v === 'object' ? Reflect.get(v, key) : undefined)
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const centsOrNull = (v: unknown): number | null | false => (v === null ? null : isWhole(v) ? v : false)
function known<T extends string>(list: Record<T, true>, v: unknown): T | null {
  for (const k of Object.keys(list)) if (k === v) return v as T
  return null
}

function readAllocation(v: unknown): Allocation | null | false {
  if (v === null) return null
  const key = known(KEYS, get(v, 'key'))
  if (!key) return false
  const meterRaw = get(v, 'meterType')
  const meterType = meterRaw === null ? null : known(METER_TYPES, meterRaw)
  if (meterRaw !== null && meterType === null) return false
  const direct = get(v, 'directUnitId')
  if (direct !== null && typeof direct !== 'string') return false
  const sharesRaw = get(v, 'customShares')
  let customShares: Record<string, number> | null = null
  if (sharesRaw !== null) {
    if (typeof sharesRaw !== 'object' || Array.isArray(sharesRaw)) return false
    customShares = {}
    for (const [id, p] of Object.entries(sharesRaw)) {
      if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) return false
      customShares[id] = p
    }
  }
  const partRaw = get(v, 'participantUnitIds')
  let participantUnitIds: string[] | null = null
  if (partRaw !== null) {
    if (!Array.isArray(partRaw)) return false
    participantUnitIds = partRaw.filter((x): x is string => typeof x === 'string')
    if (participantUnitIds.length !== partRaw.length) return false
  }
  const extRaw = get(v, 'externalBasis')
  let externalBasis: Allocation['externalBasis'] = null
  if (extRaw !== null) {
    const measure = known(MEASURES, get(extRaw, 'measure'))
    const total = get(extRaw, 'total')
    if (!measure || typeof total !== 'number' || !(total > 0)) return false
    externalBasis = { measure, total }
  }
  return { key, meterType, directUnitId: direct, customShares, participantUnitIds, externalBasis }
}

const UNREADABLE = 'Die Entscheidungen zu den Zeilen sind unlesbar. Bitte laden Sie die Seite neu.'

export function parseDecisions(raw: unknown): { decisions: LineDecision[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: UNREADABLE }
  const out: LineDecision[] = []
  for (const d of raw) {
    const idx = get(d, 'idx')
    if (!isWhole(idx) || idx < 0) return { error: UNREADABLE }
    const action = get(d, 'action')
    if (action === 'dismiss' || action === 'release') {
      out.push({ idx, action })
      continue
    }
    if (action === 'link') {
      const costItemId = get(d, 'costItemId')
      if (typeof costItemId !== 'string' || costItemId === '') return { error: UNREADABLE }
      const amountRaw = get(d, 'amountCents')
      const laborRaw = get(d, 'labor35aCents')
      const amount = amountRaw === undefined ? undefined : centsOrNull(amountRaw)
      const labor = laborRaw === undefined ? undefined : centsOrNull(laborRaw)
      const despite = get(d, 'despiteCandidates')
      if (amount === false || labor === false || (despite !== undefined && typeof despite !== 'boolean')) return { error: UNREADABLE }
      out.push({
        idx, action: 'link', costItemId, ...(amount !== undefined ? { amountCents: amount } : {}), ...(labor !== undefined ? { labor35aCents: labor } : {}),
        ...(despite === true ? { despiteCandidates: true } : {}),
      })
      continue
    }
    if (action === 'create') {
      const f = get(d, 'fields')
      const description = get(f, 'description')
      const category = get(f, 'category')
      const key = known(KEYS, get(f, 'key'))
      const amountCents = centsOrNull(get(f, 'amountCents'))
      const labor35aCents = centsOrNull(get(f, 'labor35aCents'))
      const externalTotalCents = centsOrNull(get(f, 'externalTotalCents'))
      const allocation = readAllocation(get(f, 'allocation'))
      const despite = get(d, 'despiteCandidates')
      if (typeof description !== 'string' || typeof category !== 'string' || !key || amountCents === false || labor35aCents === false ||
        externalTotalCents === false || allocation === false || (despite !== undefined && typeof despite !== 'boolean')) {
        return { error: UNREADABLE }
      }
      out.push({
        idx, action: 'create', fields: { description, category, amountCents, labor35aCents, key, allocation, externalTotalCents },
        ...(despite === true ? { despiteCandidates: true } : {}),
      })
      continue
    }
    return { error: UNREADABLE }
  }
  return { decisions: out }
}
