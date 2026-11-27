// Seite „Heizkosten“ (#690 Punkt 6), ohne DOM prüfbar: der Untertitel passend zur Art der Abrechnung und bei eigener
// Abrechnung die Liste „Was fehlt noch“ je Heizperiode.
//
// **Die Liste ist keine zweite Regel neben der Berechnung.** Eine Zeile ist nur grün, wenn die Abrechnung der
// Heizperiode zu ihrem Thema keinen Fehler und keine Warnung trägt; welcher Hinweis zu welcher Zeile gehört, steht in
// shared/heatingTodo.ts (mit Wächter gegen den Katalog der Berechnung). Eigene Bedingungen gibt es nur, wo die
// Berechnung nichts meldet (noch keine Kosten, kein Anteil, kein Ausweis), und sie machen eine Zeile nie grüner als
// die Hinweise.
import type { HeatingInfoStatement, HeatingPeriodView, HeatingPlant, HeatingStatement, InfoItem, Meter, Notice, NoticeSubject, Tenancy, Unit } from './types'
import { lineRoot, servesUnit } from '../../shared/heatingPeriod.ts'
import { andList } from '../../shared/wording.ts'
import { todoRuleOf, type TodoStepId } from '../../shared/heatingTodo.ts'
import { boundaryLight, missingDevicesLines, type Light } from './heatingSelfView'

// Die Lage einer Anlage, nach der sich die Seite richtet (#690, Grundlage für #719): Messdienst, eigene Abrechnung,
// freie Schlüssel an einer zentralen Anlage oder Etagenheizung (`supply = 'perUnit'`, immer freie Schlüssel; die
// HeizkostenV gilt dort nicht, die Karte „Angaben zur Abrechnung (§ 6a)“ steht nicht).
export type HeatingSituation = 'service' | 'self' | 'manual' | 'perUnit'
export function heatingSituation(plant: Pick<HeatingPlant, 'method' | 'supply'>): HeatingSituation {
  return (plant.supply ?? 'central') === 'perUnit' ? 'perUnit' : plant.method
}

const SERVICE_SUBTITLE = 'Je Heizperiode die Angaben aus der Heizkostenabrechnung: CO₂-Kosten, Warmwasser und Lieferungen.'
const SUBTITLES: Record<HeatingSituation, string> = {
  service: SERVICE_SUBTITLE,
  self: 'Je Heizperiode Ihre eigene Heizkostenabrechnung: was noch fehlt, Lieferungen, Anteil nach Verbrauch, Ablesungen und die Angaben zur Abrechnung.',
  manual: 'Je Heizperiode die Lieferungen Ihrer Heizanlage, die CO₂-Angaben und die Angaben zur Abrechnung.',
  perUnit: 'Je Heizperiode die Lieferungen und die CO₂-Angaben der Heizungen in den Wohnungen.',
}
// Ohne Anlage und bei Anlagen in verschiedener Lage: ein Satz, der zu jeder passt.
const NEUTRAL_SUBTITLE = 'Je Heizanlage und Heizperiode die Angaben zur Abrechnung der Heizkosten.'

// `null`: noch nicht geladen. Dann steht der bisherige Satz, damit er beim Messdienst nach dem Laden nicht wechselt.
export function heatingSubtitle(plants: readonly Pick<HeatingPlant, 'method' | 'supply'>[] | null): string {
  if (plants === null) return SERVICE_SUBTITLE
  const kinds = [...new Set(plants.map(heatingSituation))]
  const only = kinds.length === 1 ? kinds[0] : undefined
  return only ? SUBTITLES[only] : NEUTRAL_SUBTITLE
}

// Eine Zeile der Liste. `page`: die Seite, auf der der Schritt erledigt wird, wenn es nicht diese ist; `card`: die
// Überschrift der Karte auf dieser Seite, in der er erledigt wird (Durchsicht S2).
export type TodoStep = {
  id: TodoStepId
  light: Light
  title: string
  detail: string
  page?: 'kosten' | 'zaehler' | 'abrechnung'
  card?: string
  // Die Anlage derselben Linie, bei der der Schritt steht (Kesseltausch: § 6a bei der Anlage, die am Ende heizt).
  plant?: { id: string; name: string }
}
export const todoCardLabel = (card: string): string => `Zur Karte „${card}“`
export const todoPlantLabel = (name: string): string => (name ? `Zur Heizanlage „${name}“` : 'Zur neuen Heizanlage')

// Die Anlagen derselben Linie (Kesseltausch, `lineRoot`) und, wenn es nicht diese ist, die Anlage, die am Ende der
// Heizperiode (`to`) heizt: An sie hängt die Berechnung Ausweis und Hinweise nach § 6a der ganzen Linie (`host` in
// calc.ts). Nachprüfung M1.
type LinePlant = Pick<HeatingPlant, 'id' | 'name' | 'replacesPlantId' | 'endsOn'>
export function lineOf(plant: LinePlant, plants: readonly LinePlant[], to: string): { line: Set<string>; host: { id: string; name: string } | null } {
  const root = lineRoot(plant, plants)
  const members = plants.filter((p) => lineRoot(p, plants) === root)
  const line = new Set(members.filter((p) => p.id !== plant.id).map((p) => p.id))
  if (line.size === 0) return { line, host: null }
  const host = members.find((p) => !p.endsOn || p.endsOn >= to) ?? members[members.length - 1]
  return { line, host: host && host.id !== plant.id ? { id: host.id, name: host.name } : null }
}
export const TODO_PAGE_LABEL: Record<NonNullable<TodoStep['page']>, string> = { kosten: 'Zur Seite Kosten', zaehler: 'Zur Seite Zähler & Stände', abrechnung: 'Zur Seite Abrechnung' }
// Das Wort zur Farbe, für Vorleser und wer Farben nicht unterscheidet.
export const TODO_LIGHT_WORD: Record<Light, string> = { green: 'Erledigt', yellow: 'Zu prüfen', red: 'Offen' }

const HEATING_PREFIXES = ['heating.', 'co2.', 'fuel.']

// Ein Hinweis, der zur Heizung gehört, aber keiner Anlage sicher zuzuordnen ist (ab zwei Anlagen: ohne Bezug, an einem
// Mieter oder einer Wohnung mehrerer Anlagen, an einem Zähler ohne Anlage). Er steht bei jeder Anlage als weiterer
// Hinweis und färbt keine Zeile (Durchsicht M1): lieber bei jeder Anlage genannt als bei keiner.
export type TodoNotice = Notice & { loose?: true }

// Zu welchen Anlagen gehört ein Bezug? Ein Zähler über seine Anlage oder seine Wohnung, eine Wohnung über die Anlagen,
// die sie versorgen (`servesUnit`, wie die Berechnung), ein Mietverhältnis über seine Wohnung. `null`: unbekannt.
type PlantUnits = { id: string; units: readonly { unitId: string }[] | null }
export function subjectPlants(stock: {
  plants: readonly PlantUnits[]
  units: readonly (Pick<Unit, 'id'> & Partial<Pick<Unit, 'noConnection' | 'parentUnitId'>>)[]
  meters: readonly Pick<Meter, 'id' | 'unitId' | 'heatingPlantId'>[]
  tenancies: readonly Pick<Tenancy, 'id' | 'unitId'>[]
}): (s: NoticeSubject) => readonly string[] | null {
  const ofUnit = (unitId: string | null | undefined): readonly string[] | null => {
    const unit = stock.units.find((u) => u.id === unitId)
    if (!unit) return null
    return stock.plants.filter((p) => servesUnit(p, { id: unit.id, noConnection: unit.noConnection, parentUnitId: unit.parentUnitId })).map((p) => p.id)
  }
  return (s) => {
    if (s.kind === 'meter') {
      const m = stock.meters.find((x) => x.id === s.id)
      if (!m) return null
      return m.heatingPlantId ? [m.heatingPlantId] : ofUnit(m.unitId)
    }
    if (s.kind === 'unit') return ofUnit(s.id)
    if (s.kind === 'tenancy') return ofUnit(stock.tenancies.find((t) => t.id === s.id)?.unitId)
    return null
  }
}

// Die Hinweise der Abrechnung, die zu dieser Anlage und Heizperiode gehören: mit Bezug auf die Anlage oder auf eine
// Position der Heizperiode; gibt es im Objekt nur eine Anlage, auch jeder Hinweis der Heizung mit anderem Bezug
// (Mieter, Wohnung). Ab zwei Anlagen entscheidet `owner` (`subjectPlants`): gehört der Bezug genau dieser Anlage, zählt
// er hier; nur anderen, dann nicht; sonst steht er bei jeder Anlage als weiterer Hinweis (`loose`). Positionen anderer
// Anlagen (`foreignItems`) zählen nicht. Ein Hinweis nennt nur die Anlage, nicht die Heizperiode: Enden zwei
// Heizperioden der Anlage im Zeitraum, entscheidet der Text („Heizperiode 2024/2025“); nennt er keine, gilt er beiden.
// Ausgenommene Codes (shared/heatingTodo.ts) zählen nie.
export function noticesOf(
  all: readonly Notice[],
  ctx: {
    plantId: string; plants: number; view: Pick<HeatingPeriodView, 'label' | 'items'>; labels: readonly string[]
    owner?: (s: NoticeSubject) => readonly string[] | null; foreignItems?: ReadonlySet<string>
    // Die übrigen Anlagen derselben Linie (`lineOf`): Ihre Hinweise gelten derselben Heizperiode und zählen hier als
    // weiterer Hinweis (Nachprüfung M1).
    line?: ReadonlySet<string>
  },
): TodoNotice[] {
  const itemIds = new Set(ctx.view.items.map((i) => i.id))
  const others = ctx.labels.filter((l) => l !== ctx.view.label)
  const names = (text: string, label: string): boolean => text.includes(`Heizperiode ${label}:`) || text.includes(`Heizperiode ${label} `) || text.includes(`Heizperiode ${label},`) || text.includes(`Heizperiode ${label}.`)
  const out: TodoNotice[] = []
  for (const n of all) {
    if ('skip' in todoRuleOf(n.code)) continue
    if (others.some((l) => names(n.text, l)) && !names(n.text, ctx.view.label)) continue
    const s = n.subject
    if (s !== undefined && (s.kind === 'heatingCosts' || s.kind === 'heatingPlant' || s.kind === 'heatingSettlement')) {
      if (s.id === ctx.plantId) out.push(n)
      else if (ctx.line?.has(s.id)) out.push({ ...n, loose: true })
      continue
    }
    if (s !== undefined && s.kind === 'costItem' && itemIds.has(s.id)) {
      out.push(n)
      continue
    }
    if (!HEATING_PREFIXES.some((p) => n.code.startsWith(p))) continue
    if (ctx.plants <= 1) {
      out.push(n)
      continue
    }
    if (s !== undefined && s.kind === 'costItem' && ctx.foreignItems?.has(s.id)) continue
    const owners = s !== undefined ? ctx.owner?.(s) ?? null : null
    if (owners !== null && owners.length === 1 && owners[0] === ctx.plantId) out.push(n)
    else if (owners !== null && owners.length > 0 && !owners.includes(ctx.plantId)) continue
    else out.push({ ...n, loose: true })
  }
  return out
}

// Färbt der Hinweis seine Zeile? Fehler rot, Warnung gelb; ein Hinweis nur, wo die Tabelle es sagt (`hints`).
function lightOfNotice(n: Notice): Light | null {
  if (n.level === 'error') return 'red'
  if (n.level === 'warning') return 'yellow'
  const rule = todoRuleOf(n.code)
  return 'step' in rule && rule.hints === true ? 'yellow' : null
}
const RANK: Record<Light, number> = { green: 0, yellow: 1, red: 2 }
const worse = (a: Light, b: Light): Light => (RANK[b] > RANK[a] ? b : a)

// Fehler und Warnungen zur Heizung dieser Heizperiode, die keine Zeile der Liste haben (`other`, unbekannte Codes und
// Hinweise, die keiner Anlage sicher gehören, `loose`).
export function extraNotices(notices: readonly TodoNotice[]): number {
  return notices.filter((n) => {
    const rule = todoRuleOf(n.code)
    return 'step' in rule && (rule.step === 'other' || n.loose === true) && n.level !== 'hint'
  }).length
}

const pct = (n: number): string => `${n.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`
const INFO_NAME: Record<InfoItem, string> = {
  '1a': 'Anteil der Energieträger',
  '1b': 'Steuern, Abgaben und Zölle',
  '1c': 'Entgelte der Verbrauchserfassung',
  '2': 'Kontaktinformationen',
  '3': 'Information zur Streitbeilegung (Frage zum Verbrauchervertrag)',
  '4': 'Vergleichswert eines Durchschnittsnutzers',
  '5': 'Vergleich mit dem vorhergehenden Abrechnungszeitraum',
}
const infoName = (x: InfoItem, info: HeatingInfoStatement): string =>
  (x === '1a' && info.district ? 'Treibhausgasemissionen und Primärenergiefaktor der Fernwärme' : INFO_NAME[x])

const NOT_CHECKED = 'Die Abrechnung verteilt die Kosten dieser Heizperiode noch nicht; ob hier etwas fehlt, zeigt sich erst danach.'

// `statement`: der Ausweis der Abrechnung zu dieser Anlage und Heizperiode (`null`, solange es keinen gibt).
// `notices`: die Hinweise der Abrechnung zu Anlage und Heizperiode (`noticesOf`).
// `deliveries`: Zahl der Lieferungen dieser Heizperiode. `co2`: fragt die Seite hier nach den CO₂-Angaben?
// `separate`: Die Heizperiode wird getrennt abgerechnet; ihren Stand prüft die getrennte Abrechnung, die Liste sieht
// ihn nicht und zeigt deshalb keine Zeile rot (Durchsicht K1).
export function selfTodos(i: {
  view: HeatingPeriodView; statement: Pick<HeatingStatement, 'self' | 'info'> | null; notices: readonly TodoNotice[]; deliveries: number; co2: boolean
  separate?: boolean
  // Die Anlage derselben Linie, die Ausweis und Angaben nach § 6a trägt, wenn es nicht diese ist (`lineOf`).
  host?: { id: string; name: string } | null
}): TodoStep[] {
  const steps = selfSteps(i)
  return i.separate ? steps.map((x) => (x.light === 'red' ? { ...x, light: 'yellow' as const } : x)) : steps
}

function selfSteps(i: Parameters<typeof selfTodos>[0]): TodoStep[] {
  const { view } = i
  const self = i.statement?.self ?? null
  const info = i.statement?.info ?? null
  // Geprüft ist ein Thema erst, wenn die Abrechnung die Heizperiode verteilt; vorher meldet sie zu CO₂, Warmwasser und
  // § 6a womöglich nur deshalb nichts.
  const checked = self?.ok === true
  // Nr. 1 c allein: Keine Position trägt den Teil „Messdienst, Ablesung, Geräte“. Der Hinweis dazu nennt keine Kürzung
  // („sind keine angefallen, ist nichts zu tun“) und ließe sich im rechtmäßigen Fall nie abstellen; er färbt nicht.
  const onlyMetering = info !== null && info.missing.length === 0 && info.uncertain.length > 0 && info.uncertain.every((x) => x === '1c')
  const of = (id: TodoStepId): Notice[] => i.notices.filter((n) => {
    const rule = todoRuleOf(n.code)
    return n.loose !== true && 'step' in rule && rule.step === id
  })
  // Die Zeile mit dem, was die Abrechnung zu ihrem Thema meldet: nie grüner als deren Hinweise.
  const row = (own: TodoStep): TodoStep => {
    const colouring = of(own.id).filter((n) => lightOfNotice(n) !== null && !(n.code === 'heating.info-open' && onlyMetering))
    if (colouring.length === 0) return own
    const light = colouring.reduce<Light>((a, n) => worse(a, lightOfNotice(n) ?? 'green'), own.light)
    const titles = [...new Set(colouring.map((n) => n.title))]
    const said = `Die Abrechnung meldet: ${andList(titles.map((t) => `„${t}“`))}; Einzelheiten stehen auf der Seite Abrechnung unter „Zu prüfen“.`
    // „Noch nicht geprüft“ entfällt, sobald die Abrechnung zum Thema etwas meldet.
    const kept = own.light === 'green' ? '' : own.detail.replace(NOT_CHECKED, '').trim()
    return { ...own, light, detail: kept === '' ? said : `${kept} ${said}`, ...(own.page === undefined && own.card === undefined ? { page: 'abrechnung' as const } : {}) }
  }
  const steps: TodoStep[] = []

  // Kosten: Die Abrechnung verteilt nur Kostenpositionen; eine Lieferung allein ergibt Gesamtkosten von 0. Verteilt die
  // Abrechnung Kosten ohne eigene Position dieser Anlage (Kesseltausch: übernommener Vorrat, Durchsicht K5), sind sie
  // erfasst.
  const withAmount = view.items.filter((x) => x.amountCents !== 0).length
  const distributed = (self?.pots ?? []).reduce((a, p) => a + p.costCents, 0)
  // Die Reihenfolge der Seite (Durchsicht S3): Lieferung hier, Rechnung als Position auf der Seite Kosten, dann verknüpfen.
  const how = 'So gehen Sie vor: Tragen Sie die Brennstoffrechnung unten in der Karte „Lieferungen“ ein (oder lassen Sie sie dort mit der KI auslesen), erfassen Sie dieselbe Rechnung auf der Seite Kosten als Position der Kostenart „Heizung und Warmwasser“ und verknüpfen Sie beide unten in „Lieferungen“ unter „Welche Position gehört zu welcher Rechnung?“. Wartung, Betriebsstrom und Zählermiete erfassen Sie nur auf der Seite Kosten.'
  steps.push(row(withAmount > 0 || distributed > 0
    ? {
      id: 'costs', light: 'green', title: 'Kosten der Heizung erfasst',
      detail: withAmount > 0
        ? `${withAmount === 1 ? 'Eine Position' : `${withAmount} Positionen`} der Kostenart „Heizung und Warmwasser“ in dieser Heizperiode.`
        : 'Keine eigene Position in dieser Heizperiode; die Abrechnung verteilt Kosten aus dem Vorrat oder der Anlage davor. Wartung, Betriebsstrom und Zählermiete dieser Anlage sind eigene Positionen; erfassen Sie sie auf der Seite Kosten, wenn sie angefallen sind.',
    }
    : {
      id: 'costs', light: 'red', title: 'Kosten der Heizung erfasst', page: 'kosten',
      detail: i.deliveries > 0
        ? `${i.deliveries === 1 ? 'Eine Lieferung ist' : `${i.deliveries} Lieferungen sind`} eingetragen, aber keine Position der Kostenart „Heizung und Warmwasser“ mit Betrag; verteilt wird nur, was als Kostenposition erfasst ist. Erfassen Sie die Rechnung auf der Seite Kosten und verknüpfen Sie sie unten in „Lieferungen“ unter „Welche Position gehört zu welcher Rechnung?“.`
        : `Noch keine Position der Kostenart „Heizung und Warmwasser“ mit Betrag in dieser Heizperiode. ${how}`,
    }))

  const hotWater = view.selfHotWater ?? 'none'
  const share = view.distribution?.effective ?? null
  // Durchsicht S5: Fehlt der Anteil oder liegt er außerhalb der Grenzen, meldet die Berechnung `heating.share-invalid`;
  // die Tabelle ordnet ihn dieser Zeile zu (`row`), mit Titel und Farbe des Fehlers.
  const shareCard = { card: 'Anteil nach Verbrauch' }
  steps.push(row(share === null
    ? { id: 'share', light: 'red', title: 'Anteil nach Verbrauch festgelegt', ...shareCard, detail: 'Noch kein Anteil nach Verbrauch festgelegt. Tragen Sie ihn unten in der Karte „Anteil nach Verbrauch“ ein.' }
    : hotWater !== 'none' && share.water === null
      ? { id: 'share', light: 'red', title: 'Anteil nach Verbrauch festgelegt', ...shareCard, detail: 'Für das Warmwasser fehlt noch ein Anteil nach Verbrauch. Tragen Sie ihn unten in der Karte „Anteil nach Verbrauch“ ein.' }
      : { id: 'share', light: 'green', title: 'Anteil nach Verbrauch festgelegt', ...shareCard, detail: `Heizung ${pct(share.heating)}${share.water !== null ? `, Warmwasser ${pct(share.water)}` : ''} nach Verbrauch, der Rest nach Fläche.` }))

  // Warmwasser aus der Heizung: Ob der Anteil bestimmbar ist, sagt nur die Abrechnung (`heating.dhw-share-invalid`);
  // das gewählte Verfahren allein ist es nicht (die Einrichtung setzt es sofort).
  if (hotWater === 'combined') {
    const title = 'Warmwasseranteil bestimmt'
    const card = 'Warmwasser'
    steps.push(row(view.hotWater.dhwMethod === null
      ? { id: 'hotWater', light: 'red', title, card, detail: 'Die Heizung bereitet auch das Warmwasser. Wählen Sie unten in der Karte „Warmwasser“, wie die Wärme dafür bestimmt wird.' }
      : !checked
        ? { id: 'hotWater', light: 'yellow', title, card, detail: `Das Verfahren ist gewählt. ${NOT_CHECKED}` }
        : { id: 'hotWater', light: 'green', title, card, detail: 'Die Abrechnung bestimmt den Anteil des Warmwassers; die Angaben dazu stehen unten in der Karte „Warmwasser“.' }))
  }

  // Ablesungen: Die Zeile steht immer. Ohne Ausweis zeigt die Seite keine Grenzen; dann entscheidet, ob die Abrechnung
  // die Heizperiode als unvollständig meldet.
  {
    const title = 'Ablesungen vollständig'
    const byService = (self?.capture ?? view.capture) === 'serviceValues'
    // Durchsicht S2: Ablesungen führen zur Seite „Zähler & Stände“, Werte des Ablesedienstes zu ihrer Karte hier.
    const toMeters = byService ? { card: 'Werte des Ablesedienstes' } : { page: 'zaehler' as const }
    if (self) {
      const lights = self.units.flatMap((u) => u.boundaries.map(boundaryLight))
      const red = lights.filter((l) => l === 'red').length
      const yellow = lights.filter((l) => l === 'yellow').length
      const noDevice = missingDevicesLines(self)
      const lacksDevice = noDevice.length > 0 || self.units.some((u) => u.boundaries.some((b) => (b.noDevicePots ?? []).length > 0))
      steps.push(row(lacksDevice
        ? {
          id: 'readings', light: 'red', title, ...toMeters,
          detail: noDevice.length > 0
            ? noDevice.join(' ')
            : `Für mindestens eine Wohnung ist ${byService ? 'kein Wert des Ablesedienstes eingetragen' : 'kein Gerät angelegt'}; welche, steht unten in der Karte „Ablesungen“.`,
        }
        : red > 0
          ? { id: 'readings', light: 'red', title, ...toMeters, detail: `${red} von ${lights.length} Ablesungen ${red === 1 ? 'fehlt oder braucht' : 'fehlen oder brauchen'} Ihre Antwort; welche, steht unten in der Karte „Ablesungen“.` }
          : yellow > 0
            ? { id: 'readings', light: 'yellow', title, ...toMeters, detail: `Keine Ablesung fehlt. ${yellow === 1 ? 'Eine sollten' : `${yellow} sollten`} Sie ansehen (neben dem Stichtag abgelesen oder Zwischenablesung nicht möglich); sie stehen unten in der Karte „Ablesungen“.` }
            : { id: 'readings', light: 'green', title, ...toMeters, detail: 'Keine Ablesung fehlt.' }))
    } else {
      const incomplete = i.notices.find((n) => n.code === 'heating.self-incomplete')
      steps.push(row(incomplete
        ? { id: 'readings', light: 'red', title, ...toMeters, detail: `Die Abrechnung meldet „${incomplete.title}“ und zeigt deshalb hier keine Ablesungen. Was fehlt, etwa Stände zu Beginn und Ende der Heizperiode, nennt die Seite Abrechnung unter „Zu prüfen“.` }
        : { id: 'readings', light: 'yellow', title, ...toMeters, detail: `${NOT_CHECKED} Die Stände zu Beginn und Ende der Heizperiode tragen Sie ${byService ? 'unten unter „Werte des Ablesedienstes“' : 'auf der Seite „Zähler & Stände“'} ein.` }))
    }
  }

  steps.push(row(self?.ok
    ? { id: 'distribution', light: 'green', title: 'Kosten verteilt', detail: 'Mietfuchs verteilt die Kosten dieser Heizperiode; das Ergebnis steht unten in der Karte „Verteilung“.' }
    : { id: 'distribution', light: 'red', title: 'Kosten verteilt', page: 'abrechnung', detail: self ? 'Mietfuchs kann die Kosten dieser Heizperiode noch nicht verteilen; bis dahin stehen sie beim Vermieter. Was fehlt, nennt die Seite Abrechnung unter „Zu prüfen“.' : 'Die Abrechnung verteilt für diese Heizperiode noch nichts.' }))

  // CO₂: allein nach den Hinweisen der Abrechnung. Die Zeile steht, wo die Seite nach CO₂-Angaben fragt oder die
  // Abrechnung dazu etwas meldet.
  if (i.co2 || of('co2').some((n) => lightOfNotice(n) !== null)) {
    const title = 'CO₂-Kosten aufgeteilt'
    steps.push(row(checked
      ? { id: 'co2', light: 'green', title, detail: 'Die Abrechnung meldet zur Aufteilung der CO₂-Kosten keinen Fehler und keine Warnung.' }
      : { id: 'co2', light: 'yellow', title, detail: NOT_CHECKED }))
  }

  // § 6a: gelb, solange der Ausweis etwas als fehlend oder offen nennt oder die Abrechnung dazu einen Hinweis trägt
  // (`heating.info-incomplete`, `heating.info-open`), denn beide nennen eine Kürzung.
  const title = 'Angaben zur Abrechnung (§ 6a) vollständig'
  if (i.host) {
    // Nachprüfung M1: Die Angaben nach § 6a der Heizperiode stehen bei der Anlage, die am Ende heizt; was die Abrechnung
    // dort dazu meldet, färbt die Zeile hier.
    const there = i.notices.filter((n) => n.loose === true && n.subject?.kind === 'heatingCosts' && n.subject.id === i.host?.id &&
      (() => { const r = todoRuleOf(n.code); return 'step' in r && r.step === 'info' })() && lightOfNotice(n) !== null)
    const where = i.host.name ? `der Heizanlage „${i.host.name}“` : 'der neuen Heizanlage'
    const light = there.reduce<Light>((a, n) => worse(a, lightOfNotice(n) ?? 'green'), 'green')
    const said = there.length > 0 ? ` Die Abrechnung meldet dort: ${andList([...new Set(there.map((n) => `„${n.title}“`))])}.` : ''
    steps.push({ id: 'info', light, title, plant: i.host, detail: `Die Angaben nach § 6a für diese Heizperiode stehen bei ${where}, die am Ende der Heizperiode heizt; dort tragen Sie sie ein.${said}` })
    return steps
  }
  const infoCard = { card: 'Angaben zur Abrechnung (§ 6a)' }
  // Durchsicht S1: Im ersten Jahr der eigenen Abrechnung kennt Mietfuchs den Verbrauch des Vorjahres meist nicht; den
  // Vergleich nach Nr. 5 kann es dann nicht erstellen, und kein Feld der Karte heilt das. Die Zeile sagt es ehrlich.
  const noPrevious = info !== null && info.missing.includes('5') && info.users.some((u) => u.prevUnknown && u.missing.includes('5'))
  const PREVIOUS = 'Den Vergleich mit dem vorhergehenden Abrechnungszeitraum (Nr. 5) kann Mietfuchs nicht erstellen, weil es den Verbrauch der Mieter im Vorjahr nicht kennt, meist im ersten Jahr der eigenen Abrechnung. Steht er in der Abrechnung Ihres früheren Messdienstes, legen Sie Ihrer Abrechnung einen witterungsbereinigten Vergleich damit bei; in Mietfuchs vermerken lässt sich das nicht, und die Zeile bleibt gelb, bis Mietfuchs den Vergleich selbst erstellen kann.'
  if (info) {
    // Nr. 1 c steht bei jeder Anlage ohne Position „Messdienst, Ablesung, Geräte“ unter „offen“; allein färbt sie nur,
    // wenn die Abrechnung deshalb etwas meldet (dann über den Hinweis).
    const open = info.uncertain.filter((x) => x !== '1c' && !info.missing.includes(x))
    if (info.missing.length > 0 || open.length > 0) {
      const parts: string[] = []
      if (info.missing.length > 0) parts.push(`Es ${info.missing.length === 1 ? 'fehlt' : 'fehlen'}: ${andList(info.missing.map((x) => infoName(x, info)))}.`)
      if (open.length > 0) parts.push(`Offen ${open.length === 1 ? 'ist' : 'sind'}: ${andList(open.map((x) => infoName(x, info)))}.`)
      parts.push('Was Sie dazu eintragen können, steht unten in der Karte „Angaben zur Abrechnung (§ 6a)“; was fehlt, nennt die Abrechnung mit der Kürzung, die die Mieter dann erklären dürfen.')
      if (noPrevious) parts.push(PREVIOUS)
      steps.push(row({ id: 'info', ...infoCard, light: 'yellow', title, detail: parts.join(' ') }))
    } else if (!checked) {
      steps.push(row({ id: 'info', ...infoCard, light: 'yellow', title, detail: NOT_CHECKED }))
    } else {
      steps.push(row({
        id: 'info', ...infoCard, light: 'green', title,
        detail: onlyMetering
          ? 'Die Abrechnung vermisst keine Angabe. Entgelte der Verbrauchserfassung druckt sie nicht, weil keine Position den Teil „Messdienst, Ablesung, Geräte“ trägt; sind keine angefallen, ist nichts zu tun.'
          : 'Die Abrechnung vermisst keine Angabe.',
      }))
    }
  } else if (!checked) {
    steps.push(row({ id: 'info', ...infoCard, light: 'yellow', title, detail: NOT_CHECKED }))
  } else if (of('info').some((n) => lightOfNotice(n) !== null)) {
    steps.push(row({ id: 'info', ...infoCard, light: 'green', title, detail: '' }))
  }
  return steps
}

// „Was fehlt noch“ je Lage. Bisher hat nur die eigene Abrechnung eine Liste (#690 Punkt 6); die übrigen Lagen bekommen
// ihre in #719 hier, mit denselben Zeilen (`TodoStep`) und derselben Regel: nie grüner als die Hinweise der Abrechnung.
export type TodoInput = Parameters<typeof selfTodos>[0]
const TODOS: Partial<Record<HeatingSituation, (i: TodoInput) => TodoStep[]>> = { self: selfTodos }
export function todosFor(situation: HeatingSituation, i: TodoInput): TodoStep[] | null {
  const of = TODOS[situation]
  return of ? of(i) : null
}

// `extra`: Fehler und Warnungen der Abrechnung zur Heizung dieser Heizperiode ohne eigene Zeile (`extraNotices`).
// „Alles erledigt“ steht nur, wenn jede Zeile grün ist und die Abrechnung sonst nichts zur Heizung meldet.
export function todoSummary(steps: readonly TodoStep[], extra: number): string {
  const open = steps.filter((s) => s.light !== 'green').length
  const more = extra === 0 ? '' : ` Dazu meldet die Abrechnung ${extra === 1 ? 'einen weiteren Hinweis' : `${extra} weitere Hinweise`} zur Heizung; ${extra === 1 ? 'er steht' : 'sie stehen'} auf der Seite Abrechnung unter „Zu prüfen“.`
  if (open === 0 && extra === 0) return `Alle ${steps.length} Punkte sind erledigt; die Abrechnung meldet zur Heizung dieser Heizperiode keinen Fehler und keine Warnung.`
  if (open === 0) return `Die ${steps.length} Punkte der Liste sind erledigt.${more}`
  return `${open} von ${steps.length} Punkten ${open === 1 ? 'ist' : 'sind'} offen.${more}`
}
