// Ein nachgebauter Server für die Belegbuchung in jsdom-Tests (#170). Er rechnet mit denselben
// Funktionen wie der echte (server/src/assessment.ts und server/src/bookingPlan.ts), nur ohne
// Datenbank. Was die Vorschau verspricht, was gebucht wird und wie die Route antwortet, kommt so
// aus dem echten Planer und dem echten `bookingResponse`, und ein Test der Oberfläche prüft keine
// Fassung der Regeln, die es nur im Test gibt.
// Bewusst kein `*.test.ts`: vitest führt diese Datei nicht als Test aus.
import type { AssessmentView, CostItem, Extraction, Meter, StoredAssessment, StoredAssessmentLine, Unit } from '../types'
import { describeAssessment, detectedYear, linesFromExtraction, withoutBooked, type BookedLine } from '../../../server/src/assessment.ts'
import { CALENDAR_RULES, calendarPeriod } from '../../../shared/period.ts'
import { bookingResponse, parseDecisions, planBooking, previewWith, settle, tokenSource, type BookingWrite } from '../../../server/src/bookingPlan.ts'

type Stored = { assessment: StoredAssessment; lines: StoredAssessmentLine[] }
const fieldOf = (v: unknown, key: string): unknown => (v !== null && typeof v === 'object' ? Reflect.get(v, key) : undefined)

export type FakeBooking = ReturnType<typeof fakeBooking>

export function fakeBooking(start: { items: CostItem[]; units: Unit[]; meters?: Meter[]; propertyId?: string }) {
  const propertyId = start.propertyId ?? 'objekt-1'
  let items = [...start.items]
  const records: Stored[] = []
  const requests: { path: string; body: unknown }[] = []
  let next = 0
  const booked = (): BookedLine[] =>
    records.flatMap((r) => r.lines.filter((l) => l.costItemId !== null).map((l) => ({ ...l, file: r.assessment.file })))
  const view = (r: Stored): AssessmentView => describeAssessment(r, {
    items: items.filter((i) => i.propertyId === propertyId), units: start.units, meters: start.meters ?? [], propertyKind: 'mfh', rules: CALENDAR_RULES,
    originalName: r.assessment.file, twinOf: null, twinNames: new Map(), booked: booked(),
  })
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

  function apply(r: Stored, writes: readonly BookingWrite[]): void {
    for (const w of writes) {
      if (w.kind === 'createItem') {
        // Die Felder aus #208 stehen im Rumpf als `null`, an der Position fehlen sie dann.
        const { invoiceFile, serviceFrom, serviceTo, taxYear, heatingPart, heatingTarget, ...rest } = w.body
        items = [...items, {
          ...rest, id: w.id, ...(invoiceFile ? { invoiceFile } : {}),
          ...(serviceFrom !== null && serviceTo !== null ? { serviceFrom, serviceTo } : {}),
          ...(taxYear !== null ? { taxYear } : {}), ...(heatingPart !== null ? { heatingPart } : {}), ...(heatingTarget !== null ? { heatingTarget } : {}),
        }]
      } else if (w.kind === 'updateItem') {
        items = items.map((i) => (i.id === w.id
          ? { ...i, amountCents: w.patch.amountCents, labor35aCents: w.patch.labor35aCents ?? undefined, invoiceFile: w.patch.invoiceFile ?? i.invoiceFile }
          : i))
      } else {
        r.lines = r.lines.map((l) => (l.idx === w.idx ? { ...l, ...w.change } : l))
      }
    }
  }

  return {
    get items(): CostItem[] { return items },
    requests,
    patchItem(id: string, patch: Partial<CostItem>): void {
      items = items.map((i) => (i.id === id ? { ...i, ...patch } : i))
    },
    // Wie die Route nach einer gelungenen Auswertung: speichern und mit Vorschlägen zurückgeben.
    evaluate(file: string, ex: Extraction, opts: { year: number }): AssessmentView {
      const id = `a${++next}`
      const detected = detectedYear(ex)
      const fresh = linesFromExtraction(ex)
      const r: Stored = {
        assessment: {
          id, file, propertyId, year: detected ?? opts.year, detectedYear: detected,
          requestedYear: opts.year, requestedPeriod: propertyId === null ? null : calendarPeriod(opts.year), vendor: ex.vendor ?? null,
          invoiceDate: ex.invoiceDate ?? null, totalGrossCents: typeof ex.totalGrossEur === 'number' ? Math.round(ex.totalGrossEur * 100) : null,
          amountsAdjusted: ex.amountsAdjusted ?? null, laborFromTotal: ex.laborFromTotal === true, nextIdx: fresh.length,
          createdAt: new Date(Date.UTC(2026, 9, 2, 0, 0, next)).toISOString(),
        },
        lines: fresh.map((l, idx) => ({ ...l, assessmentId: id, idx, booking: null, costItemId: null, dismissed: false, reassessed: false })),
      }
      records.push(r)
      return view(r)
    },
    // Wie saveAssessment beim erneuten Auswerten: offene Zeilen ersetzt, gebuchte bleiben, und neben
    // gebuchten sind die neuen Zeilen `reassessed` (Integrationsdurchsicht, H1).
    evaluateAgain(file: string, ex: Extraction): AssessmentView {
      const r = records.find((x) => x.assessment.file === file)
      if (!r) throw new Error(`keine Auswertung zu ${file}`)
      const kept = r.lines.filter((l) => l.costItemId !== null)
      const added = withoutBooked(linesFromExtraction(ex), kept)
      const start = r.assessment.nextIdx
      r.lines = [...kept, ...added.map((l, i) => ({
        ...l, assessmentId: r.assessment.id, idx: start + i, booking: null, costItemId: null, dismissed: false, reassessed: kept.length > 0,
      }))]
      r.assessment = { ...r.assessment, nextIdx: start + added.length }
      return view(r)
    },
    // Beantwortet, was die Belegbuchung betrifft, sonst `null`.
    async handle(url: string, init?: RequestInit): Promise<Response | null> {
      const method = init?.method ?? 'GET'
      const path = url.split('?')[0] ?? url
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      if (path === '/api/costItems' && method === 'GET') return json(items.filter((i) => i.propertyId === propertyId))
      const item = path.match(/^\/api\/costItems\/([^/]+)$/)
      if (item && method === 'DELETE') {
        items = items.filter((i) => i.id !== item[1])
        for (const r of records) r.lines = r.lines.map((l) => (l.costItemId === item[1] ? { ...l, costItemId: null } : l))
        return json({ ok: true })
      }
      if (path === '/api/assessments' && method === 'GET') return json(records.map(view).filter((v) => !url.includes('open=1') || v.open))
      const m = path.match(/^\/api\/assessments\/([^/]+)(?:\/(plan|book))?$/)
      if (!m) return null
      const r = records.find((x) => x.assessment.id === m[1])
      if (!r) return json({ error: 'Diese Auswertung gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }, 404)
      if (!m[2]) {
        const year = fieldOf(body, 'year')
        // Wie placeAssessment: ein von Hand gesetztes Jahr ist zugleich das gewählte.
        if (method === 'PUT' && typeof year === 'number') {
          r.assessment = { ...r.assessment, year, requestedYear: year, requestedPeriod: r.assessment.propertyId === null ? null : calendarPeriod(year) }
        }
        return json(view(r))
      }
      requests.push({ path, body })
      const parsed = parseDecisions(fieldOf(body, 'decisions'))
      if ('error' in parsed) return json({ error: parsed.error }, 400)
      const planned = planBooking({
        assessment: r.assessment, lines: r.lines, items, booked: booked(), units: start.units, twinFiles: [], fileNames: new Map(), closed: [], rules: CALENDAR_RULES,
      }, parsed.decisions, () => `neu-${++next}`)
      // Der echte Server bildet die Marke als SHA-256 der Quelle; für den Vergleich genügt die Quelle.
      const preview = previewWith(planned, tokenSource(planned))
      if (m[2] === 'plan') return json(preview)
      const token = fieldOf(body, 'token')
      const outcome = settle(planned, parsed.decisions.length, typeof token === 'string' ? token : '', preview)
      if (!outcome) apply(r, planned.writes)
      const reply = bookingResponse(outcome ?? { kind: 'done', changed: true, preview }, view(r))
      return json(reply.body, reply.status)
    },
  }
}
