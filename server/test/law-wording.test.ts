// Wortlaut der Rechtstexte beim Umzug ins Rechtsregister (Heizung PR 1, Entwurf 4.7): Die Zahlen
// und Daten der Rechtsregeln kommen danach aus shared/law/ und nicht mehr als Literal aus calc.ts,
// rules.ts, dem Lexikon und den Anleitungen. Am Wortlaut darf sich dabei nichts ändern, kein Zeichen.
// Dieser Test hält den Wortlaut **vor** dem Umzug fest; er entstand auf dem unveränderten Code und
// wird nicht neu erzeugt. Golden F01–F11 prüfen nur die Texte, die in ihren Beständen vorkommen,
// und die vorhandenen Tests zu Kabel, Heizung und Fernablesbarkeit prüfen mit Mustern. Erst ein
// wörtlicher Vergleich fängt ein „15 %“, aus dem „15%“ oder „15 Prozent“ geworden ist.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, NOTICE_KINDS, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { RULES } from '../src/rules.ts'
import { GLOSSARY } from '../../shared/glossary.ts'
import { GUIDES } from '../../shared/guides.ts'

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, areaM2: number, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2, participates: true, ...over })
const item = (year: number, over: Partial<SnapshotCostItem>): SnapshotCostItem =>
  ({ id: 'k', year, category: 'Heizung und Warmwasser', description: 'Posten', amountCents: 120000, key: 'area', ...over })
const snap = (year: number, s: Partial<SnapshotSource>, property?: Snapshot['property']): Snapshot => ({
  ...snapshotOf({ units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s }, year),
  ...(property !== undefined ? { property } : {}),
})
const two = { units: [unit('w1', 60), unit('w2', 40)], tenancies: [tenancy('A', 'w1'), tenancy('B', 'w2')] }
const textOf = (s: ComputedSettlement, code: string): string => {
  const n = s.notices.find((x) => x.code === code)
  if (!n) assert.fail(`kein Hinweis ${code}, sondern: ${s.notices.map((x) => x.code).join(', ')}`)
  return n.text
}
const cable = (year: number) => item(year, { category: 'Kabel/Antenne', description: 'Kabelanschluss', key: 'units' })
const meters = ['w1', 'w2'].map((u) => ({ id: `z-${u}`, unitId: u, type: 'waerme' as const }))
const readings = ['w1', 'w2'].flatMap((u, i) => [{ meterId: `z-${u}`, date: '2024-12-31', value: 0 }, { meterId: `z-${u}`, date: '2025-12-31', value: 10 + i }])
const ruleOf = (code: string) => {
  const r = RULES.find((x) => x.code === code)
  if (!r) assert.fail(`keine Regel ${code}`)
  return `${r.validFrom ?? ''}|${r.validTo ?? ''}|${r.summary}`
}
const caveat = (guide: keyof typeof GUIDES, index: number): string => {
  const c = GUIDES[guide].caveats[index]
  if (!c) assert.fail(`kein Hinweis ${index} in der Anleitung ${guide}`)
  return c.text
}

// Was heute dasteht, je Stelle.
const actual = (): Record<string, string | undefined> => ({
  'tv-signal.partial-year': textOf(computeSettlement(snap(2024, { ...two, costItems: [cable(2024)] })), 'tv-signal.partial-year'),
  'tv-signal.ended': textOf(computeSettlement(snap(2025, { ...two, costItems: [cable(2025)] })), 'tv-signal.ended'),
  'tv-signal.new-system 2021': textOf(computeSettlement(snap(2021, { ...two, costItems: [cable(2021)] }, { kind: 'mfh', cableBuiltBeforeDec2021: false })), 'tv-signal.new-system'),
  'tv-signal.new-system 2023': textOf(computeSettlement(snap(2023, { ...two, costItems: [cable(2023)] }, { kind: 'mfh', cableBuiltBeforeDec2021: false })), 'tv-signal.new-system'),
  'heating.not-by-consumption': textOf(computeSettlement(snap(2025, { ...two, costItems: [item(2025, { description: 'Heizöl' })] })), 'heating.not-by-consumption'),
  'heating.may-agree-otherwise': textOf(computeSettlement(snap(2025, {
    units: [unit('oben', 80), unit('unten', 80, { participates: false, selfUsed: true, selfPersons: 1 })],
    tenancies: [tenancy('A', 'oben')],
    costItems: [item(2025, { description: 'Heizöl' })],
  })), 'heating.may-agree-otherwise'),
  'heating.consumption-share': textOf(computeSettlement(snap(2025, { ...two, meters, readings, costItems: [
    item(2025, { id: 'g', description: 'Grundkosten', amountCents: 84000 }),
    item(2025, { id: 'v', description: 'Verbrauchskosten', amountCents: 36000, key: 'meter', meterType: 'waerme' }),
  ] })), 'heating.consumption-share'),
  'heating.flat-rate': textOf(computeSettlement(snap(2025, {
    units: two.units,
    tenancies: [tenancy('A', 'w1', { heatingModel: 'flatRate' }), tenancy('B', 'w2')],
    costItems: [item(2025, { key: 'amounts', tenancyAmounts: { A: 60000, B: 60000 } })],
  })), 'heating.flat-rate'),
  'heating.remote-reading': textOf(computeSettlement(snap(2027, { ...two, costItems: [item(2027, { key: 'amounts', tenancyAmounts: { A: 60000, B: 60000 } })] })), 'heating.remote-reading'),
  'basis.vacancy-persons': textOf(computeSettlement(snap(2025, {
    units: two.units,
    tenancies: [tenancy('A', 'w1')],
    costItems: [item(2025, { category: 'Müllabfuhr', description: 'Müll', key: 'persons' })],
  })), 'basis.vacancy-persons'),
  'title tv-signal.partial-year': NOTICE_KINDS['tv-signal.partial-year']?.title,
  'title heating.consumption-share': NOTICE_KINDS['heating.consumption-share']?.title,
  'rule tv-signal': ruleOf('tv-signal'),
  'rule heating-flat-rate': ruleOf('heating-flat-rate'),
  'rule heating-consumption': ruleOf('heating-consumption'),
  'rule heating-remote-reading': ruleOf('heating-remote-reading'),
  'glossary heatingCostOrdinance.short': GLOSSARY.heatingCostOrdinance.short,
  'glossary heatingCostOrdinance.example': GLOSSARY.heatingCostOrdinance.example,
  'guide multiFamily.caveats[2]': caveat('multiFamily', 2),
  'guide flatRate.caveats[2]': caveat('flatRate', 2),
  'guide meteringService.caveats[0]': caveat('meteringService', 0),
})

// Abgedruckt am 05.10.2026 auf dem Stand von origin/feat/heizung (v0.10.1 samt #216), vor jeder
// Änderung dieser PR. Gültigkeit der Regeln als „ab|bis|Kurzfassung“.
const EXPECTED: Record<string, string> = {
  "tv-signal.partial-year": "„Kabelanschluss“: Die Gebühren für das Kabelfernsehen (TV-Signal) sind nur bis zum 30.06.2024 umlagefähig, danach nicht mehr (Wegfall des Nebenkostenprivilegs). Umlegen dürfen Sie für 2024 höchstens das erste Halbjahr, und das nur bei einer Anlage, die vor dem 01.12.2021 errichtet wurde; danach nur noch den Betriebsstrom (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft). Bitte teilen Sie die Position entsprechend auf und buchen Sie den Rest als „Nicht umlagefähig“.",
  "tv-signal.ended": "„Kabelanschluss“: Die Gebühren für das Kabelfernsehen (TV-Signal) sind seit dem 01.07.2024 nicht mehr umlagefähig (Wegfall des Nebenkostenprivilegs). Auf die Mieter umgelegt sind in dieser Abrechnung 1.200,00 €. Umlegen dürfen Sie nur noch den Betriebsstrom, und das nur bei einer Anlage, die vor dem 01.12.2021 errichtet wurde (bei einer Gemeinschaftsantenne des Hauses auch Prüfung und Einstellung durch eine Fachkraft); buchen Sie das TV-Signal bitte als „Nicht umlagefähig“.",
  "tv-signal.new-system 2021": "„Kabelanschluss“: Die Kabel- oder Antennenanlage wurde ab dem 01.12.2021 errichtet; für sie waren die Gebühren für das TV-Signal nie umlagefähig, auch Betriebsstrom und Wartung nicht (§ 2 Satz 2 BetrKV). Auf die Mieter umgelegt sind in dieser Abrechnung 1.200,00 €. Umlagefähig sind allenfalls Betriebsstrom und Bereitstellungsentgelt einer reinen Glasfaser-Verteilanlage, bei der der Mieter seinen Anbieter frei wählen kann (§ 2 Nr. 15 Buchst. c BetrKV); buchen Sie den Rest bitte als „Nicht umlagefähig“. Für 2021 gilt das für die Kosten ab der Errichtung; was davor auf eine ältere Anlage entfiel, war umlagefähig.",
  "tv-signal.new-system 2023": "„Kabelanschluss“: Die Kabel- oder Antennenanlage wurde ab dem 01.12.2021 errichtet; für sie waren die Gebühren für das TV-Signal nie umlagefähig, auch Betriebsstrom und Wartung nicht (§ 2 Satz 2 BetrKV). Auf die Mieter umgelegt sind in dieser Abrechnung 1.200,00 €. Umlagefähig sind allenfalls Betriebsstrom und Bereitstellungsentgelt einer reinen Glasfaser-Verteilanlage, bei der der Mieter seinen Anbieter frei wählen kann (§ 2 Nr. 15 Buchst. c BetrKV); buchen Sie den Rest bitte als „Nicht umlagefähig“.",
  "heating.not-by-consumption": "„Heizöl“: Heizung und Warmwasser werden hier nicht nach Verbrauch verteilt. Die Heizkostenverordnung verlangt, mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch zu verteilen, den Rest nach Fläche (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). Sonst darf jeder Mieter seinen Anteil um 15 % kürzen (§ 12 Abs. 1 HeizkostenV), hier: A (w1) 108,00 € und B (w2) 72,00 €. Verteilen Sie 50 bis 70 % nach Verbrauch (eine Position nach Verbrauch mit Wärmezählern, den Rest als eigene Position nach Fläche) oder übernehmen Sie die Abrechnung des Messdienstes als Einzelbeträge.",
  "heating.may-agree-otherwise": "„Heizöl“: Heizung und Warmwasser werden hier nicht nach Verbrauch verteilt. Im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, darf anderes vereinbart werden (§ 2 HeizkostenV). Die Heizkostenverordnung gilt hier, sofern im Mietvertrag nichts anderes vereinbart ist; dann sind 50 bis 70 % nach Verbrauch zu verteilen, und sonst darf der Mieter seinen Anteil um 15 % kürzen (§ 12 Abs. 1 HeizkostenV).",
  "heating.consumption-share": "Heizung und Warmwasser („Grundkosten“ und „Verbrauchskosten“): nach Zählern verteilt werden 30 % der Heizkosten. Die Heizkostenverordnung verlangt mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). Bitte die Aufteilung zwischen Verbrauchs- und Grundkosten prüfen.",
  "heating.flat-rate": "Für A (w1) ist für Heizung und Warmwasser eine Pauschale oder Warmmiete vereinbart. Die Heizkostenverordnung geht der Vereinbarung vor (§ 2 HeizkostenV); zulässig ist das nur im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen. Sonst wird der Heizanteil als Vorauszahlung behandelt, über die Sie nach Verbrauch abrechnen müssen (BGH VIII ZR 212/05). Rechnen Sie trotzdem nicht nach Verbrauch ab, darf der Mieter seinen Anteil um 15 % kürzen (§ 12 Abs. 1 HeizkostenV).",
  "heating.remote-reading": "Spätestens seit dem 01.01.2027 müssen alle Zähler und Heizkostenverteiler für Heizung und Warmwasser fernablesbar sein (§ 5 Abs. 3 HeizkostenV); Geräte, die nach dem 01.12.2021 eingebaut wurden, müssen es in der Regel schon seit ihrem Einbau sein (§ 5 Abs. 2). Bei fernablesbaren Geräten stehen den Mietern schon seit 2022 monatliche Verbrauchsinformationen zu (§ 6a HeizkostenV). Fehlt das eine oder das andere, darf jeder Mieter seinen Anteil an den Heizkosten um 3 % kürzen (§ 12 Abs. 1 HeizkostenV). Mietfuchs weiß nicht, welche Geräte bei Ihnen eingebaut sind. Prüfen Sie das bitte mit Ihrem Messdienst. Ausgenommen sind Einzelfälle, in denen die Nachrüstung technisch nicht möglich ist, unangemessen aufwendig wäre oder sonst eine unbillige Härte bedeutete (§ 5 Abs. 3 Satz 2), sowie die Fälle des § 11 HeizkostenV. Das gilt nicht für eine Gastherme in der Wohnung mit eigenem Gasvertrag des Mieters. Im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, gilt das nur, wenn Sie nichts anderes vereinbart haben (§ 2 HeizkostenV).",
  "basis.vacancy-persons": "Bei „Müll“ (nach Personen) stand w2 (365 Tage) leer. An den Kosten leerstehender Wohnungen ist der Vermieter zu beteiligen; sie gehen nicht still an die übrigen Mieter (Grundsatz nach BGH, Urteil vom 31.05.2006, VIII ZR 159/05, dort zum Flächenschlüssel). Wie das beim Personenschlüssel geschieht, regelt kein Gesetz, und es ist nicht abschließend geklärt: Nach BGH, Beschluss vom 08.01.2013, VIII ZR 180/12, kommt es auf den Einzelfall an, und es kann in Betracht kommen, für die Zeit des Leerstands eine fiktive Person anzusetzen. Mietfuchs setzt jeden Tag ohne Mietverhältnis mit 1 Person an; das ist eine Auslegung von Mietfuchs. Der Anteil steht in Ihrem Vermieteranteil als Leerstand. Bei Kosten, die von der Personenzahl abhängen (etwa Wasser nach Personen), kann eine andere Aufteilung angemessener sein, zum Beispiel in Grund- und Verbrauchskosten.",
  "title tv-signal.partial-year": "Kabelfernsehen nur bis 30.06.2024 umlagefähig",
  "title heating.consumption-share": "Verbrauchsanteil der Heizkosten außerhalb 50 bis 70 %",
  "rule tv-signal": "|2024-06-30|Die Gebühren für das TV-Signal eines Kabelanschlusses und die Grundgebühren eines Breitbandanschlusses durften bis zum 30.06.2024 als Betriebskosten umgelegt werden, und zwar nur bei Anlagen, die vor dem 01.12.2021 errichtet wurden. Seitdem nicht mehr. Bei Anlagen, die vor dem 01.12.2021 errichtet wurden, bleiben umlagefähig: bei einer Gemeinschaftsantenne des Hauses der Betriebsstrom sowie Prüfung und Einstellung durch eine Fachkraft, bei einer Breitband-Verteilanlage nur der Betriebsstrom. Bei später errichteten Anlagen ist davon nichts umlagefähig, ausgenommen eine reine Glasfaser-Verteilanlage (Betriebsstrom und Bereitstellungsentgelt).",
  "rule heating-flat-rate": "||Heizung und Warmwasser müssen nach Verbrauch abgerechnet werden; die Heizkostenverordnung geht einer Pauschale oder Warmmiete vor. Die Vereinbarung wird dann nicht angewendet: Der Heizanteil gilt als Vorauszahlung, über die nach Verbrauch abzurechnen ist. Nur im Gebäude mit höchstens zwei Wohnungen, von denen der Vermieter eine selbst bewohnt, und in den Fällen des § 11 darf etwas anderes vereinbart werden. Wird nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um 15 % kürzen.",
  "rule heating-consumption": "||Von den Kosten der zentralen Heizungs- und Warmwasseranlage sind mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch zu verteilen, der Rest nach Wohn- oder Nutzfläche (bei der Heizung auch nach umbautem Raum). Wird nicht verbrauchsabhängig abgerechnet, darf der Mieter seinen Anteil um 15 % kürzen. Im Gebäude mit höchstens zwei Wohnungen, von denen der Vermieter eine selbst bewohnt, darf anderes vereinbart werden; ohne eine solche Vereinbarung gilt die Verordnung auch dort.",
  "rule heating-remote-reading": "2027-01-01||Zähler und Heizkostenverteiler für Heizung und Warmwasser müssen fernablesbar sein: die nach dem 01.12.2021 eingebauten sofort, alle übrigen ab dem 01.01.2027 (Nachrüstfrist bis 31.12.2026). Sind fernablesbare Geräte eingebaut, stehen den Mietern monatliche Verbrauchsinformationen zu. Fehlt das eine oder das andere, darf der Mieter seinen Anteil an den Heizkosten um 3 % kürzen. Ausgenommen sind Fälle, in denen die Nachrüstung technisch nicht möglich ist, einen unangemessenen Aufwand bedeutet oder in sonstiger Weise eine unbillige Härte wäre.",
  "glossary heatingCostOrdinance.short": "Heizkosten müssen zu 50 bis 70 Prozent nach Verbrauch verteilt werden, der Rest nach Fläche oder umbautem Raum; beim Warmwasser der Rest nur nach Fläche. Die Verordnung geht einer anderen Vereinbarung im Mietvertrag vor.",
  "glossary heatingCostOrdinance.example": "3.000 € Heizkosten, 70 % nach Verbrauch: 2.100 € nach den Messwerten, 900 € nach Wohnfläche. Wird nicht nach Verbrauch abgerechnet, etwa nur nach Fläche, darf der Mieter seinen Anteil um 15 % kürzen. Unabhängig davon darf er um 3 % kürzen, wenn Zähler nicht fernablesbar sind, obwohl sie es sein müssten (neue Geräte seit Dezember 2021, alle übrigen ab 2027), oder wenn die vorgeschriebenen Verbrauchsinformationen fehlen.",
  "guide multiFamily.caveats[2]": "Bei einer Zentralheizung sind mindestens 50 und höchstens 70 Prozent der Heiz- und Warmwasserkosten nach Verbrauch zu verteilen. Wird nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um 15 Prozent kürzen.",
  "guide flatRate.caveats[2]": "Für Heizung und Warmwasser geht die Heizkostenverordnung einer Pauschale oder Warmmiete vor, außer im Gebäude mit nicht mehr als zwei Wohnungen, von denen Sie eine selbst bewohnen. Wird entgegen der Verordnung nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um 15 Prozent kürzen.",
  "guide meteringService.caveats[0]": "Bei einer Zentralheizung sind mindestens 50 und höchstens 70 Prozent der Kosten nach Verbrauch zu verteilen; das erledigt der Messdienst. Wird nicht nach Verbrauch abgerechnet, darf der Mieter um 15 Prozent kürzen."
}

test('Wortlaut: jede Stelle, deren Zahl oder Datum ins Register zieht, steht Zeichen für Zeichen wie vorher', () => {
  const now = actual()
  assert.deepEqual(Object.keys(now).sort(), Object.keys(EXPECTED).sort())
  for (const [key, text] of Object.entries(EXPECTED)) assert.equal(now[key], text, key)
})
