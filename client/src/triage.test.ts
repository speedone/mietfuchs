import { expect, test } from 'vitest'
import { aiRowPreselected, categoryDeviationPct, duplicateCandidates, duplicateGroups, scorePosition, type PositionCtx } from './triage'
import type { CostItem } from './types'

const ctx = (patch: Partial<PositionCtx>): PositionCtx => ({
  category: 'Sach- und Haftpflichtversicherung', amountCents: 10000, labor35aCents: 0, matchedByDesc: false,
  vendor: 'Versicherung AG', detectedYear: 2025, targetYear: 2025, existingItems: [], ...patch,
})

test('Gutschrift (#139): ein negativer Betrag ist kein fehlender, wird aber zum Prüfen als Gutschrift benannt', () => {
  const s = scorePosition(ctx({ amountCents: -5400 }))
  expect(s.reasons).not.toContain('Betrag fehlt oder ist 0')
  expect(s.reasons.some((r) => /Gutschrift/.test(r))).toBe(true)
  expect(s.level).toBe('gelb')
  // Kein Lohnanteil heißt nicht „Lohnanteil größer als der Betrag“
  expect(s.reasons.some((r) => /§35a/.test(r))).toBe(false)
})

test('Betrag 0 bleibt rot', () => {
  expect(scorePosition(ctx({ amountCents: 0 })).level).toBe('rot')
})

// ---------- Zusammenspiel mit „Aus dem Vorjahr übernehmen“ (Befund A) ----------
// Erst übernommen (Schätzbetrag, ohne Beleg), dann kommt die echte Rechnung per KI: Es entstand
// still eine zweite Position derselben Kostenart. Die Regel steht in shared/duplicates.ts.

const schaetzung: CostItem = { id: 'gs', propertyId: 'p', year: 2026, category: 'Grundsteuer', description: 'Grundsteuer 2026', vendor: 'Stadt', amountCents: 61000, key: 'area' }

test('A: eine KI-Zeile derselben Kostenart findet die übernommene Position, auch mit anderer Beschreibung', () => {
  const found = duplicateCandidates([schaetzung], { category: 'Grundsteuer', description: 'Abgabenbescheid Q1–Q4', vendor: 'Stadt Musterstadt', year: 2026 })
  expect(found.map((i) => i.id)).toEqual(['gs'])
  // anderes Jahr: nichts
  expect(duplicateCandidates([schaetzung], { category: 'Grundsteuer', description: 'x', vendor: '', year: 2025 })).toEqual([])
})

test('A: mit Kandidaten ist die Ampel nicht grün und nennt die Position', () => {
  const s = scorePosition(ctx({ category: 'Grundsteuer', description: 'Abgabenbescheid', vendor: 'Stadt Musterstadt', amountCents: 61240, detectedYear: 2026, targetYear: 2026, existingItems: [schaetzung] }))
  expect(s.level).not.toBe('gruen')
  expect(s.reasons.some((r) => /schon erfasst: „Grundsteuer 2026“/.test(r))).toBe(true)
})

test('A: vorab angehakt nur ohne Kandidaten und ohne Rot', () => {
  expect(aiRowPreselected({ category: 'Grundsteuer', preselect: true, problem: null, level: 'gruen', candidates: [] })).toBe(true)
  expect(aiRowPreselected({ category: 'Grundsteuer', preselect: true, problem: null, level: 'gelb', candidates: [schaetzung] })).toBe(false)
  expect(aiRowPreselected({ category: 'Grundsteuer', preselect: true, problem: null, level: 'rot', candidates: [] })).toBe(false)
  expect(aiRowPreselected({ category: 'Grundsteuer', preselect: true, problem: 'Betrag fehlt', level: 'gelb', candidates: [] })).toBe(false)
  expect(aiRowPreselected({ category: 'Nicht umlagefähig', preselect: true, problem: null, level: 'gelb', candidates: [] })).toBe(false)
})

test('A im Januar: Vorjahresvergleich nach dem Jahr des Belegs, nicht nach dem gewählten', () => {
  const items: CostItem[] = [
    { ...schaetzung, id: 'a', year: 2025, amountCents: 60000 },
    { ...schaetzung, id: 'b', year: 2024, amountCents: 30000 },
  ]
  // Beleg für 2026, gewählt ist noch 2025: verglichen wird 2026 (nichts erfasst) mit 2025
  expect(categoryDeviationPct(items, 'Grundsteuer', 2026, 61200)).toBeCloseTo(2)
  // Das gewählte Jahr hätte 2025 (schon 600 €) + 612 € gegen 2024 verglichen: +304 %
  expect(categoryDeviationPct(items, 'Grundsteuer', 2025, 61200)).toBeCloseTo(304)
  expect(categoryDeviationPct([], 'Grundsteuer', 2026, 61200)).toBeNull()
})

// ---------- Verknüpfen je Gruppe (zweite Durchsicht) ----------
const row = (description: string, amount: string, labor35a = '', category = 'Wasser/Abwasser') => ({ description, category, amount, labor35a })
const wasser: CostItem = { id: 'wa', propertyId: 'p', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser/Abwasser 2025', amountCents: 150000, key: 'area' }
const groupsOf = (rows: ReturnType<typeof row>[], items: CostItem[], invoiceFile = 'w.pdf') =>
  duplicateGroups(rows, { items, vendor: 'Stadtwerke', year: 2025, invoiceFile })

test('mehrere KI-Zeilen derselben Kostenart aus einem Beleg: eine Wahl mit der Summe, alle Zeilen in der Gruppe', () => {
  const groups = groupsOf([row('Frischwasser', '700,00'), row('Schmutzwasser', '800,00')], [wasser])
  expect(groups).toHaveLength(1)
  expect(groups[0]?.rows).toEqual([0, 1])
  const offer = groups[0]?.offers[0]
  expect(offer?.label).toMatch(/^Mit „Wasser\/Abwasser 2025“ \(1\.500,00\s€\) verknüpfen und Betrag auf 1\.500,00\s€ setzen \(2 Positionen\)$/)
  expect(offer?.built).toEqual({ body: { amountCents: 150000, invoiceFile: 'w.pdf' } })
})

test('eine Position, die schon mit diesem Beleg verknüpft ist, bleibt Ziel: Betrag erhöhen', () => {
  const half: CostItem = { ...wasser, amountCents: 70000, invoiceFile: 'w.pdf' }
  const groups = groupsOf([row('Schmutzwasser', '800,00')], [half])
  const offer = groups[0]?.offers[0]
  expect(offer?.sameReceipt).toBe(true)
  expect(offer?.label).toMatch(/um 800,00\s€ auf 1\.500,00\s€ erhöhen/)
  expect(offer?.built).toEqual({ body: { amountCents: 150000 } })
  // Ein anderer Beleg bleibt kein Ziel
  expect(groupsOf([row('Schmutzwasser', '800,00')], [half], 'anders.pdf')[0]?.offers).toEqual([])
})

test('§35a: ohne gelesenen Lohnanteil wird der bisherige entfernt und das gesagt; ein gelesener gilt', () => {
  const garten: CostItem = { ...wasser, id: 'g', category: 'Gartenpflege', description: 'Garten', amountCents: 300000, labor35aCents: 100000 }
  const leer = groupsOf([row('Gartenpflege', '2.800,00', '', 'Gartenpflege')], [garten])[0]?.offers[0]
  expect(leer?.built).toEqual({ body: { amountCents: 280000, invoiceFile: 'w.pdf', labor35aCents: 0 } })
  expect(leer?.note).toMatch(/Der bisherige §35a-Lohnanteil \(1\.000,00\s€\) wird entfernt; tragen Sie ihn aus der Rechnung ein\./)
  const null0 = groupsOf([row('Gartenpflege', '2.800,00', '0', 'Gartenpflege')], [garten])[0]?.offers[0]
  expect(null0?.built).toMatchObject({ body: { labor35aCents: 0 } })
  const gelesen = groupsOf([row('Gartenpflege', '2.800,00', '500,00', 'Gartenpflege')], [garten])[0]?.offers[0]
  expect(gelesen?.built).toEqual({ body: { amountCents: 280000, invoiceFile: 'w.pdf', labor35aCents: 50000 } })
  expect(gelesen?.note).toBeNull()
})

test('§35a: geprüft wird gegen den Lohnanteil, der danach gilt, auch bei Gutschriften', () => {
  const garten: CostItem = { ...wasser, id: 'g', category: 'Gartenpflege', description: 'Garten', amountCents: 50000, invoiceFile: 'w.pdf', labor35aCents: 40000 }
  // Gleicher Beleg: Lohnanteil 400 + 300 = 700 € bei 500 + 100 = 600 € Betrag
  expect(groupsOf([row('Nachtrag', '100,00', '300,00', 'Gartenpflege')], [garten])[0]?.offers[0]?.built).toMatchObject({ error: expect.stringMatching(/§35a/) })
  // Gutschriften werden seit der dritten Durchsicht nicht mehr verknüpft, sondern angelegt (L3);
  // dort prüft amountProblem wie im Formular.
  const ohne: CostItem = { ...garten, invoiceFile: undefined }
  expect(groupsOf([row('Gutschrift', '-50,00', '', 'Gartenpflege')], [ohne])[0]?.offers).toEqual([])
})

test('Gemeinschaftsabrechnung und Einzelbeträge: kein Ein-Klick-Verknüpfen, sondern die Position im Formular', () => {
  const hg: CostItem = { ...wasser, id: 'hg', key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 1000000 } }
  const einzel: CostItem = { ...wasser, id: 'ez', key: 'amounts', tenancyAmounts: { t1: 30000 } }
  const g = groupsOf([row('Frischwasser', '700,00')], [hg, einzel])[0]
  expect(g?.offers).toEqual([])
  expect(g?.formOnly.map((i) => i.id)).toEqual(['hg', 'ez'])
})

// ---------- Dritte Durchsicht ----------
const muell: CostItem = { id: 'P', propertyId: 'p', year: 2025, category: 'Müllabfuhr', description: 'Restmüll', amountCents: 70000, key: 'area', invoiceFile: 'w.pdf' }

test('H1: eine eben aus diesem Beleg angelegte Zeile bietet kein „erhöhen“ mit ihrem eigenen Betrag an', () => {
  const rows = [{ ...row('Restmüll', '700,00', '', 'Müllabfuhr'), created: true }, row('Gutschrift', '-50,00', '', 'Müllabfuhr')]
  // Die angelegte Position gehört zu diesem Beleg: Die Gutschrift wird als eigene Zeile angelegt.
  expect(duplicateGroups(rows, { items: [muell], vendor: 'Stadt', year: 2025, invoiceFile: 'w.pdf', ownIds: ['P'] })).toEqual([])
  // Auch ohne die Kennung (etwa nach einem Fehler): nie 700 + 650, und keine negative Summe verknüpft
  const g = duplicateGroups(rows, { items: [muell], vendor: 'Stadt', year: 2025, invoiceFile: 'w.pdf' })
  expect(g.flatMap((x) => x.rows)).toEqual([1])
  expect(g[0]?.offers).toEqual([])
})

test('derselbe Beleg zweimal in der Warteschlange: kein zweites „erhöhen“, sondern „schon mit diesem Beleg erfasst“', () => {
  const t: CostItem = { ...wasser, invoiceFile: 'w.pdf' }
  const g = groupsOf([row('Frischwasser', '700,00'), row('Schmutzwasser', '800,00')], [t])
  expect(g[0]?.offers.map((o) => o.label)).toEqual([expect.stringMatching(/um 1\.500,00\s€ auf 3\.000,00\s€ erhöhen/)])
  const taken = duplicateGroups([row('Frischwasser', '700,00'), row('Schmutzwasser', '800,00')], { items: [t], vendor: 'S', year: 2025, invoiceFile: 'w.pdf', receiptTaken: ['wa'] })
  expect(taken[0]?.offers).toEqual([])
  expect(taken[0]?.takenByReceipt.map((i) => i.id)).toEqual(['wa'])
})

test('L3: eine Gruppe mit negativer Summe wird nicht verknüpft, nur neu angelegt', () => {
  expect(groupsOf([row('Gutschrift', '-50,00')], [wasser])[0]?.offers).toEqual([])
})

test('L1: ausdrücklich 0 als Lohn eingetragen heißt „auf 0 gesetzt“, nicht „tragen Sie ihn ein“', () => {
  const garten: CostItem = { ...wasser, id: 'g', category: 'Gartenpflege', description: 'Garten', amountCents: 300000, labor35aCents: 100000 }
  const o = groupsOf([row('Gartenpflege', '2.800,00', '0', 'Gartenpflege')], [garten])[0]?.offers[0]
  expect(o?.built).toMatchObject({ body: { labor35aCents: 0 } })
  expect(o?.note).toBe('Der §35a-Lohnanteil wird auf 0 gesetzt.')
})
