// #724: Die Rechnung des Schornsteinfegers unter der Kostenart „Schornsteinfeger“, obwohl im Objekt eine zentrale
// Heizanlage läuft, deren Heizkosten nach der Heizkostenverordnung abgerechnet werden. Betrifft die Rechnung diese
// Heizung, gehören die Kosten der Messungen nach dem Bundes-Immissionsschutzgesetz und der Reinigung der Anlage zu den
// Kosten des Betriebs der zentralen Heizungsanlage einschließlich der Abgasanlage (§ 7 Abs. 2 HeizkostenV, am amtlichen
// Text gelesen am 27.11.2026); Kehrgebühren sind Schornsteinreinigung nur, „soweit sie nicht bereits als Kosten nach
// Nummer 4 Buchstabe a berücksichtigt sind“ (§ 2 Nr. 12 BetrKV). Ob sie die Heizung betrifft, weiß nur der Vermieter:
// Die Berechnung bucht nichts um und ändert keine Zahl, sie fragt nur.
// Grundlage ist Beispiel A (server/testing/selfHeating.ts): Wohnungen A 60 m², B 80 m², C 60 m².
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { blockingErrors, INFORMATIONAL } from '../../shared/notices.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'
import type { CostItem, HeatingPlant } from '../../shared/types.ts'
import { selfSnapshot } from '../testing/selfHeating.ts'

const CODE = 'heating.chimney-sweep-central'
const sweep = (over: Partial<CostItem> = {}): CostItem => ({
  id: 'kehr', propertyId: 'objekt-1', period: periodKey('2025-01'), category: 'Schornsteinfeger', description: 'Schornsteinfeger 2025', amountCents: 12000, key: 'area', ...over,
})
const heating = (id: string, description: string, amountCents: number, heatingPart: CostItem['heatingPart'], heatingTarget: CostItem['heatingTarget'], extra: Partial<CostItem> = {}): CostItem => ({
  id, propertyId: 'objekt-1', period: periodKey('2025-01'), category: HEATING_CATEGORY, description, amountCents, key: 'heatingSystem', heatingPlantId: 'hp', heatingPart, heatingTarget, ...extra,
})
const SELF_ITEMS = [heating('gas', 'Erdgas', 600000, 'fuel', 'both', { fuelDeliveryId: 'd1' }), heating('wartung', 'Wartung', 24000, 'operating', 'both')]
const settle = (costItems: CostItem[], plant: Partial<HeatingPlant> = {}): ComputedSettlement => computeSettlement(selfSnapshot({ costItems, plant }))
const hints = (s: ComputedSettlement) => s.notices.filter((n) => n.code === CODE)
const share = (s: ComputedSettlement, tenancyId: string, itemId: string): number =>
  s.statements.find((st) => st.tenancyId === tenancyId)?.rows.filter((r) => r.costItemId === itemId).reduce((a, r) => a + r.shareCents, 0) ?? assert.fail(`keine Abrechnung ${tenancyId}`)

// Durchsicht S5: gekürzt; der Satz zu § 2 Nr. 12 BetrKV sagt jetzt, wann Kehrgebühren zur Kostenart gehören.
const HEAD = '„Schornsteinfeger 2025“ (120,00 €) wird als „Schornsteinfeger“ nach dem Schlüssel „Wohnfläche“ verteilt. '
const LAW = 'Die Kosten der Reinigung der Anlage und der Messungen nach dem Bundes-Immissionsschutzgesetz gehören zum Betrieb der zentralen Heizungsanlage einschließlich der Abgasanlage (§ 7 Abs. 2 HeizkostenV). ' +
  'Kehrgebühren gehören nur dann zur Kostenart „Schornsteinfeger“, wenn sie nicht schon bei den Heizkosten stehen (§ 2 Nr. 12 BetrKV). '
const STAYS = 'Für Kaminöfen, Gasthermen einzelner Wohnungen und andere Feuerstätten bleibt sie, wie sie ist.'

test('#724: eigene Heizkostenabrechnung, Schornsteinfeger nach Wohnfläche: ruhiger Hinweis mit Betrag an der Position; verteilt wird wie erfasst', () => {
  const s = settle([...SELF_ITEMS, sweep()])
  const [n, ...more] = hints(s)
  assert.deepEqual(more, [])
  assert.ok(n, `kein Hinweis, sondern: ${s.notices.map((x) => x.code).join(', ')}`)
  assert.equal(n.level, 'hint')
  assert.equal(n.title, 'Schornsteinfeger bei zentraler Heizung')
  assert.deepEqual(n.subject, { kind: 'costItem', id: 'kehr' })
  assert.equal(n.text, HEAD + LAW +
    'Betrifft die Rechnung die zentrale Heizung, stellen Sie die Position im Kostenformular auf „Heizung und Warmwasser“ mit dem Teil „Betrieb, Wartung, Strom der Heizung“ um. ' + STAYS)
  // Durchsicht S5: vorher rund 880 Zeichen.
  assert.ok(n.text.length <= 710, String(n.text.length))
  // Eine Auskunft: Sie färbt das Cockpit nicht und sichert das Abschließen nicht ab.
  assert.ok(INFORMATIONAL.has(CODE))
  assert.ok(!blockingErrors(s.notices).some((x) => x.code === CODE))
  // Nichts wird umgebucht: 120,00 € nach 60 : 80 : 60 m², C1 und C2 nach Tagen (273 und 92 von 365).
  assert.deepEqual([share(s, 'A', 'kehr'), share(s, 'B', 'kehr'), share(s, 'C1', 'kehr') + share(s, 'C2', 'kehr')], [3600, 4800, 3600])
  const ohne = settle(SELF_ITEMS)
  assert.deepEqual(s.statements.map((st) => st.totalShareCents - st.rows.filter((r) => r.costItemId === 'kehr').reduce((a, r) => a + r.shareCents, 0)), ohne.statements.map((st) => st.totalShareCents))
})

test('#724: je Position ein Hinweis; steht die Rechnung schon bei den Heizkosten, keiner', () => {
  const zwei = settle([...SELF_ITEMS, sweep(), sweep({ id: 'mess', description: 'Abgasmessung', amountCents: 4500, key: 'units' })])
  assert.deepEqual(hints(zwei).map((n) => [n.subject?.id, /^„Abgasmessung“ \(45,00 €\) wird als „Schornsteinfeger“ nach dem Schlüssel „Wohneinheiten“ verteilt/.test(n.text)]), [['kehr', false], ['mess', true]])
  assert.deepEqual(hints(settle([...SELF_ITEMS, heating('imm', 'Immissionsmessung', 6000, 'operating', 'both')])), [])
})

test('#724: Messdienst: derselbe Hinweis mit dem Satz zur doppelten Verteilung, ohne Rat zum Umstellen', () => {
  const s = settle([sweep()], { method: 'service' })
  const [n] = hints(s)
  assert.ok(n, `kein Hinweis, sondern: ${s.notices.map((x) => x.code).join(', ')}`)
  assert.equal(n.text, HEAD + LAW +
    'Betrifft sie die zentrale Heizung und steht sie schon in der Abrechnung des Messdienstes, wird sie hier ein zweites Mal verteilt. ' + STAYS)
})

test('#724: kein Hinweis ohne Heizanlage, bei freien Schlüsseln, bei Etagenheizung, bei „Mieter heizt selbst“, bei einer stillgelegten Anlage und bei Direktzuordnung', () => {
  // Freie Schlüssel: Mietfuchs verteilt dort nicht nach der Heizkostenverordnung.
  assert.deepEqual(hints(settle([sweep()], { method: 'manual' })), [])
  // Etagenheizung auf Vertrag des Vermieters: keine zentrale Heizungsanlage.
  assert.deepEqual(hints(settle([sweep()], { method: 'manual', supply: 'perUnit' })), [])
  // Die Anlage heizt im Zeitraum nicht mehr.
  assert.deepEqual(hints(settle([sweep()], { endsOn: '2024-06-30' })), [])
  // Die Gemeinschaft liefert die Heizkostenabrechnung (vermietete Eigentumswohnung).
  assert.deepEqual(hints(settle([sweep()], { method: 'service', source: 'homeowners' })), [])
  // Direkt einer Wohnung zugeordnet: die Gastherme oder der Kaminofen dieser Wohnung.
  assert.deepEqual(hints(settle([...SELF_ITEMS, sweep({ key: 'direct', directUnitId: 'b' })])), [])
  // Ohne Heizanlage, auch mit Mietern, die selbst heizen.
  const snap = selfSnapshot({ costItems: [sweep()] })
  const ohneAnlage = computeSettlement({ ...snap, heatingPlants: [], tenancies: snap.tenancies.map((t) => ({ ...t, heatingModel: 'selfSupply' as const, selfSupplyKind: 'perUnit' as const })) })
  assert.deepEqual(hints(ohneAnlage), [])
  assert.equal(share(ohneAnlage, 'B', 'kehr'), 4800)
  // Kein Mieter trägt die Position (nicht umlagefähig erfasst): nichts zu prüfen.
  assert.deepEqual(hints(settle([...SELF_ITEMS, sweep({ category: 'Nicht umlagefähig' })])), [])
})

// Durchsicht M2: Das Formular fragt nur, wenn die eigene Heizkostenabrechnung im Zeitraum der Position gilt
// (`selfActive`); der Hinweis fragt dieselbe Bedingung über den Schnappschuss (`selfAt`).
test('#724 Durchsicht M2: eigene Heizkostenabrechnung erst ab 2026: 2025 kein Hinweis, 2026 der Hinweis mit Rat zum Umstellen', () => {
  const ab2026: Partial<HeatingPlant> = { selfSpans: [{ from: periodKey('2026-01'), until: null }] }
  const s2025 = computeSettlement(selfSnapshot({ plant: ab2026, costItems: [heating('gas', 'Erdgas', 600000, undefined, undefined, { key: 'area', fuelDeliveryId: 'd1' }), sweep()] }))
  assert.deepEqual(hints(s2025), [])
  const k2026 = periodKey('2026-01')
  const s2026 = computeSettlement(selfSnapshot({ year: 2026, plant: ab2026, costItems: [
    heating('gas', 'Erdgas', 600000, 'fuel', 'both', { period: k2026, fuelDeliveryId: 'd1' }), heating('wartung', 'Wartung', 24000, 'operating', 'both', { period: k2026 }), sweep({ period: k2026, description: 'Schornsteinfeger 2026' }),
  ] }))
  const [n] = hints(s2026)
  assert.ok(n, `kein Hinweis, sondern: ${s2026.notices.map((x) => x.code).join(', ')}`)
  assert.match(n.text, /stellen Sie die Position im Kostenformular auf „Heizung und Warmwasser“/)
})

// Durchsicht S1: Ohne Angabe an der Anlage galt jede Heizposition mit dem Teil „Betrieb“ als Antwort auf die Frage nach
// dem Betriebsstrom. Eine Rechnung des Schornsteinfegers enthält keinen Strom; nach dem Umstellen schwieg der Hinweis.
test('#724 Durchsicht S1: die umgestellte Rechnung des Schornsteinfegers beantwortet die Frage nach dem Betriebsstrom nicht', () => {
  const gas = heating('gas', 'Erdgas', 600000, 'fuel', 'both', { fuelDeliveryId: 'd1' })
  const strom: CostItem = { id: 'as', propertyId: 'objekt-1', period: periodKey('2025-01'), category: 'Beleuchtung/Allgemeinstrom', description: 'Allgemeinstrom', amountCents: 50000, key: 'area' }
  const umgestellt = heating('kehr', 'Schornsteinfeger 2025', 12000, 'operating', 'both')
  const power = (s: ComputedSettlement) => s.notices.filter((x) => x.code === 'heating.operating-power-missing')
  assert.equal(power(settle([gas, strom, sweep()])).length, 1)
  const [n, ...more] = power(settle([gas, strom, umgestellt]))
  assert.deepEqual(more, [])
  assert.ok(n, 'der Hinweis zum Betriebsstrom fehlt nach dem Umstellen')
  assert.match(n.text, /^Für die Heizanlage ist für 2025 kein Betriebsstrom erfasst \(keine Heizposition mit dem Teil „Betrieb“, die Strom enthalten kann; „Schornsteinfeger 2025“ ist dem Namen nach eine Rechnung des Schornsteinfegers\), und beim Allgemeinstrom „Allgemeinstrom“ steht kein Abzug dafür\. /)
  // Ebenso Abgas- und Immissionsmessung und Kehrgebühren; eine Position, die Strom nennt, und jede andere „Betrieb“ zählen weiter.
  // Integrationsdurchsicht mit #721: dieselbe Wortliste wie `heatingKindOf` (shared/heatingKind.ts), auch „Kehren“; eine
  // Reparatur der Abgasanlage oder die Wartung eines Kaminofens ist keine Rechnung des Schornsteinfegers.
  for (const d of ['Abgasmessung', 'Immissionsmessung 2025', 'Kehrgebühren', 'Kaminkehrer', 'Kehren 2025']) assert.equal(power(settle([gas, strom, heating('x', d, 5000, 'operating', 'both')])).length, 1, d)
  for (const d of ['Betriebsstrom Heizung', 'Wartung', 'Strom für Brenner und Abgasgebläse', 'Reparatur Abgasanlage', 'Kaminofen Wartung']) assert.deepEqual(power(settle([gas, strom, heating('x', d, 5000, 'operating', 'both')])), [], d)
  // Der Text ohne solche Position bleibt wortgleich.
  assert.match(power(settle([gas, strom, sweep()]))[0]?.text ?? '', /^Für die Heizanlage ist für 2025 kein Betriebsstrom erfasst \(keine Heizposition mit dem Teil „Betrieb“\), und /)
})
