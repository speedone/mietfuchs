// Bezugszähler und verteilter Rest (#98, Entwurf docs/superpowers/specs/2026-11-04-virtuelle-zaehler-design.md,
// Abschnitt „Rechnung“, Schritte 1 bis 3): die Planung des Rests in Mengen, ohne Geld und ohne Rundung. calc.ts
// sammelt die Mengen, fragt hier, ob und wie sich der Rest bilden lässt, und verteilt danach den Betrag einmal
// (#202). Eine reine Funktion, damit #573 (Wohnung und Zimmer) denselben Baustein nutzt; sie importiert nichts aus
// calc.ts.
import type { MeterRest, MeterRestTarget } from '../../shared/types.ts'

export type RestInput = {
  // Verbrauch des Bezugszählers im Zeitraum; `null`: Er deckt den Zeitraum nicht (oder es gibt ihn nicht).
  reference: number | null
  // Die Zähler hinter dem Bezugszähler: in der Gruppe des Rests, in der Verteilbasis der Position, Verbrauch.
  behind: { unitId: string | null; inGroup: boolean; inBasis: boolean; value: number }[]
  // Zwischenzähler ohne Wohnung; `value: null`: Er deckt den Zeitraum nicht.
  subs: { meterId: string; value: number | null; target: MeterRestTarget }[]
  // Die Einheiten, die den Rest bekommen. `measured`: mit einem Zähler hinter dem Bezug, im Zeitraum abgelesen;
  // `occupied`: bewohnt und mit Anschluss der Sparte. Nur eine bewohnte Einheit ohne Zähler ist ungemessen.
  group: { unitId: string; measured: boolean; occupied: boolean }[]
  // Bewohnte Einheiten ohne Zähler hinter dem Bezug, die nicht in der Gruppe sind: Ihr Verbrauch steckt im Rest.
  unmeteredOutside: string[]
  key: MeterRest['key']
}

type RestAmounts = {
  // Die Verteilbasis: Bezug minus `excluded`. Im Rückfall die Summe der Zähler.
  total: number
  // Zähler hinter dem Bezug, deren Einheit in der Verteilbasis liegt.
  measuredIn: number
  // Zähler hinter dem Bezug außerhalb der Verteilbasis (an den Vermieter, Grund außerhalb).
  outside: number
  rest: number
  subs: { meterId: string; value: number; target: MeterRestTarget }[]
}

// `reason` sagt, welcher Satz zum Fehler gehört (der Entwurf verlangt bei `rest-mixed` je Fall einen eigenen).
// `detail`: bei `rest-mixed` die Einheiten, bei `sub-incomplete` die Zwischenzähler, bei `rest-unavailable` leer.
export type RestPlan =
  | { kind: 'error'; code: 'meter.rest-mixed'; reason: 'mixed' | 'outside' | 'meter-key'; detail: string[] }
  | { kind: 'error'; code: 'meter.rest-unavailable'; reason: 'main-partial' | 'negative'; detail: string[] }
  | { kind: 'error'; code: 'meter.sub-incomplete'; reason: 'sub-incomplete'; detail: string[] }
  // Nur bei ganz gemessener Gruppe: verteilt wird nach den Zählern (samt Zwischenzählern), der Rest ist 0.
  | ({ kind: 'fallback'; reason: 'main-partial' | 'negative' } & RestAmounts)
  | ({ kind: 'plan' } & RestAmounts)

// Ein Rest, der nur durch Rechenrauschen der Tagesanteile unter oder über 0 liegt, ist 0. Die Grenze ist relativ
// zum Bezug: Zählerstände haben höchstens drei Nachkommastellen.
const NOISE = 1e-9

export function planMeterRest(input: RestInput): RestPlan {
  const byLandlord = input.key === 'landlord' || input.key === 'selfUse'
  const unmeasured = input.group.filter((u) => u.occupied && !u.measured).map((u) => u.unitId)
  const anyMeasured = input.group.some((u) => u.measured)
  // Ganz gemessen: keine bewohnte Einheit ohne Zähler, und wenigstens eine mit. Eine Gruppe ganz ohne Zähler und
  // ohne Bewohner hat keine Messung, deren Differenz der Rest sein könnte; sie zählt als ungemessen.
  const groupMeasured = unmeasured.length === 0 && anyMeasured
  // Schritt 1: Wer den Rest bekommt, muss ganz gemessen oder ganz ungemessen sein. Trägt ihn der Vermieter, gibt es
  // keine Gruppe, die zu viel zahlen könnte.
  if (!byLandlord) {
    if (unmeasured.length > 0 && anyMeasured) return { kind: 'error', code: 'meter.rest-mixed', reason: 'mixed', detail: unmeasured }
    if (input.unmeteredOutside.length > 0) return { kind: 'error', code: 'meter.rest-mixed', reason: 'outside', detail: [...input.unmeteredOutside] }
    if (input.key === 'meter' && !groupMeasured) return { kind: 'error', code: 'meter.rest-mixed', reason: 'meter-key', detail: unmeasured }
  }
  // Schritt 2: kein stiller Teilverbrauch eines Zwischenzählers.
  const incomplete = input.subs.filter((s) => s.value === null).map((s) => s.meterId)
  if (incomplete.length > 0) return { kind: 'error', code: 'meter.sub-incomplete', reason: 'sub-incomplete', detail: incomplete }
  const subs = input.subs.flatMap((s) => (s.value === null ? [] : [{ meterId: s.meterId, value: s.value, target: s.target }]))
  const counted = subs.filter((s) => s.target !== 'excluded').reduce((a, s) => a + s.value, 0)
  const excluded = subs.filter((s) => s.target === 'excluded').reduce((a, s) => a + s.value, 0)
  const measuredIn = input.behind.filter((m) => m.inBasis).reduce((a, m) => a + m.value, 0)
  const outside = input.behind.filter((m) => !m.inBasis).reduce((a, m) => a + m.value, 0)
  // Ganz gemessen heißt beim Vermieter: Niemand ohne Zähler hängt am Bezug.
  const fallbackAllowed = byLandlord ? unmeasured.length === 0 && input.unmeteredOutside.length === 0 : groupMeasured
  // Schritt 3: Lässt sich der Rest nicht bilden, nach den Zählern (gemessen) oder gar nicht (ungemessen).
  const fallback = (reason: 'main-partial' | 'negative'): RestPlan => (fallbackAllowed
    ? { kind: 'fallback', reason, total: measuredIn + outside + counted, measuredIn, outside, rest: 0, subs }
    : { kind: 'error', code: 'meter.rest-unavailable', reason, detail: [] })
  if (input.reference === null) return fallback('main-partial')
  const total = input.reference - excluded
  let rest = total - measuredIn - outside - counted
  if (Math.abs(rest) <= NOISE * Math.max(1, Math.abs(input.reference))) rest = 0
  if (rest < 0) return fallback('negative')
  return { kind: 'plan', total: measuredIn + outside + rest + counted, measuredIn, outside, rest, subs }
}

// **Wann der Rest Eigenanteil ist** (`key: 'selfUse'`), genau wie beim Rest des Hauptzählers nach #116 (consumptionFor in
// calc.ts), damit beide dieselbe Regel haben, wenn #116 über diesen Baustein läuft: Eigenanteil (privat) ist er nur, wenn
// er auf selbstgenutzte Einheiten ohne Zähler entfällt. Gibt es keine Einheit ohne Zähler, ist er eine Messdifferenz;
// hat ein Zähler eine Lücke, steckt deren Verbrauch darin; wohnt in einer Einheit ohne Zähler ein Mieter, lässt sich
// nicht bestimmen, wie viel auf ihn entfällt. Dann bleibt er beim Vermieter, abziehbar (`mainMeterRest`). Mit
// Nutzungswechsel (#259) gilt er je Tag, an dem alle Einheiten ohne Zähler selbstgenutzt sind (`daysAllSelf`, eine
// Auslegung: gleichmäßiger Verbrauch).
export type SelfRestInput = {
  // Bewohnte Einheiten ohne Zähler hinter dem Bezug; `selfUsed`: im Zeitraum selbstgenutzt, `wholeSelf`: an jedem Tag.
  unmeasured: { unitId: string; selfUsed: boolean; wholeSelf: boolean }[]
  // Wie viele gemessene Einheiten einen lückenhaften Zähler haben.
  partial: number
  // Tage, an denen alle Einheiten ohne Zähler selbstgenutzt sind, und Tage des Zeitraums.
  daysAllSelf: number
  days: number
}
export type SelfRest = { share: number; reason: 'whole' | 'days' | 'none-unmetered' | 'partial' | 'rented' }

export function selfRestShare(input: SelfRestInput): SelfRest {
  if (input.unmeasured.length === 0) return { share: 0, reason: 'none-unmetered' }
  if (input.partial > 0) return { share: 0, reason: 'partial' }
  if (input.unmeasured.every((u) => u.selfUsed && u.wholeSelf)) return { share: 1, reason: 'whole' }
  if (input.unmeasured.every((u) => u.selfUsed)) return { share: input.days > 0 ? Math.min(1, Math.max(0, input.daysAllSelf / input.days)) : 0, reason: 'days' }
  return { share: 0, reason: 'rented' }
}
