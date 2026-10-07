// Jede Versorgerrechnung genau einmal verteilt (Heizung PR 7, Nachprüfungen der Durchsicht von #233,
// Entwurf 12.3 Nr. 1 und 5), über Abschluss, Wiederöffnen, Verknüpfen und spätere Änderungen in
// wechselnder Reihenfolge.
//
// Der Generator geht über die **echten Schreibwege** (repository.ts, db/fuel.ts, Abschluss wie in
// index.ts samt Schätzung) und bildet keine Sperre nach: Was die Anwendung mit 400 oder 409 ablehnt,
// wird übersprungen, alles andere geschieht. Vorgänge: Position verknüpfen, Gutschrift (klein oder als
// Storno bis zum ganzen Betrag), Betrag ändern (auch auf 0), lösen, löschen, abschließen (in einem Teil
// der Läufe mit Schätzung der Lücken), wieder öffnen, und eine Rechnung, die erst später kommt. Eine
// Gutschrift kommt nur zu einer Lieferung mit Rechnungsposition, und Gutschriften werden zuerst
// gelöst; das ist die Gestalt der Daten, keine Sperre.
//
// Geprüft wird je Lauf über alle Zeiträume (abgeschlossene mit dem eingefrorenen Stand und den
// Positionen beim Abschluss, denn eine Position eines abgeschlossenen Zeitraums lässt sich ändern):
//   (i)   Σ Mieterzeilen + Σ aller Vermieterteile = Σ Positionen. Das gilt **durch den Aufbau** (jede
//         Abrechnung verteilt genau ihre Positionen) und ist nur eine Probe der Buchhaltung.
//   (ii)  Obergrenze: Die Mieter tragen nicht mehr als die Positionen, außer um ausgewiesene negative
//         Teile (eine zu hohe Schätzung, ein Storno nach Abschluss; dann nennt die Abrechnung den Betrag).
//   (vii) Untergrenze: Die Mieter tragen mindestens die Positionen abzüglich der ausgewiesenen Teile beim
//         Vermieter (`fuelClosedPeriod`, `fuelEstimateDiff`).
//   (iii) Ohne Schätzungen, je Lieferung und Paar von Heizperioden: Die Gegenbuchungen `fuelCarry` heben
//         sich auf (was die eine hereinbucht, bucht die andere hinaus), oder ein ausgewiesener Teil desselben
//         Paars deckt sie genau. Das Zweite, wenn eine abgeschlossene Heizperiode einen Teil ausgewiesen hat,
//         den eine später wieder geöffnete und neu abgeschlossene doch hereinbucht (dann tragen die Mieter
//         die Rechnung genau einmal, und der ausgewiesene Teil steht im eingefrorenen Stand).
// Dazu die Zuordnungsprüfung (I1): Hat eine abgeschlossene Heizperiode eine Lieferung mit 0
// eingefroren, bucht die Heizperiode ihrer Positionen deren Teil trotzdem hinaus. Mit Schätzungen
// gelten (ii) und (vii) nur, wenn am Ende jede Schätzung von echten verknüpften Rechnungen abgedeckt ist.
//
// Heizung PR 9: Die Variante „Zwei Anlagen“ rechnet dasselbe mit zwei Anlagen in einem Objekt (Haus A mit den
// Wohnungen A und B, Haus B mit C), je mit eigenen Rechnungen. Dazu wird geprüft, dass jede Lieferung nur im
// Ausweis ihrer eigenen Anlage steht und jede Gegenbuchung je Abrechnung genau einmal vorkommt (je Anlage und
// Lieferung genau einmal verteilt), und dass je Anlage die Zeilen ihre Positionen ergeben.
//
// Heizung PR 10: Die Varianten „Eigene Heizkostenabrechnung“ rechnen dasselbe mit einer Anlage, die selbst nach
// der Heizkostenverordnung abrechnet (Wärmezähler je Wohnung, Ablesungen an jeder Grenze, Positionen nach
// Heizkostenverordnung). Dazu je Abrechnung über die Kernrechnung: (s1) die Gewichte der Nutzer verteilen
// jeden Topf ganz (Σ der Topfbeträge im Ausweis = Kosten des Topfs, je Nutzer höchstens 1 ct Rundung), keine
// Position steht wegen der Anlage beim Vermieter, und der Leerstand wird nie negativ; (s2) je Lieferung über
// alle Heizperioden: Σ der Zeilen ihrer Positionen und Überträge (ohne Gegenbuchungen) = Σ ihrer Positionen,
// jede Lieferung also genau einmal verbraucht. Die Mutationsproben stehen im PR.
//
// Heizung PR 11: Zwei Varianten rechnen den Warmwasseranteil nach der Volumen- und nach der Flächenformel
// (§ 9 Abs. 2 Satz 2 und 4 HeizkostenV), mit Gas nach Brennwert (Faktor 1,11) oder nach Heizwert. Dazu (s4):
// Die Wärme für das Warmwasser im Ausweis ist die der Formel, mit Faktor nur bei Brennwert, und α mal der
// Energie der Rechnungen in der Heizperiode ergibt genau sie; (s3) prüft daneben, dass der Topf Warmwasser
// α der Kosten trägt, und (i) und (s2), dass trotzdem jede Rechnung genau einmal verteilt ist.
//
// Heizung PR 12: Drei Varianten erfassen den Verbrauch mit Heizkostenverteilern (Einheitsskala mit Faktoren mit
// drei Nachkommastellen und Produktskala, Stichtagswert am Ende jeder Heizperiode, auch mit verbundenem
// Warmwasser) und mit Werten eines Ablesedienstes (je Wohnung und Nutzungszeitraum, mit Warmwasser). In allen
// dreien zieht der Mieter von B am 15.01.2025 aus, nach einem Leerstand von bis zu 30 Tagen zieht ein neuer ein,
// mit Zwischenablesung (§ 9b) bzw. getrennten Zeilen des Ablesedienstes. Dazu (s5): Je Wohnung ist der Verbrauch
// der Heizung im Ausweis Σ Differenz × Faktor ihrer Geräte bzw. Σ der Werte des Ablesedienstes, die Einheit
// „Einheiten“, und (i), (s1) und (s2) gelten wie mit Wärmezählern.
//
// Feste Startwerte, im Lauf der Tests wenige; mehr mit INV_FROM/INV_TO (siehe SEEDS).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { computeSettlement } from '../src/calc.ts'
import { createHeatingPlant, replaceHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { removeEstimate, saveEstimate } from '../src/db/heatingEstimates.ts'
import { saveHotWater } from '../src/db/co2.ts'
import { saveServiceValues } from '../src/db/serviceValues.ts'
import { createDelivery, createEstimates, freezeFuelCarries, fuelGapQuestions, unfreezeFuelCarries } from '../src/db/fuel.ts'
import { openDatabase } from '../src/db/open.ts'
import { readClosedSettlements, readCostItems, readFuelCarryFrozen, readFuelDeliveries, readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity, findClosedSettlement, removeEntity, reopenSettlement, updateEntity } from '../src/db/repository.ts'
import { properties } from '../src/db/schema.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { degreeDayPermille } from '../../shared/degreeDays.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { onlyVersion } from '../../shared/law/register.ts'
import { periodContaining, periodKey, periodOfKey } from '../../shared/period.ts'
import type { HeatingEstimate, PeriodRules } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
const DAY = 86400000
const isoOf = (t: number): string => new Date(t).toISOString().slice(0, 10)

function zufall(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// Was die Anwendung ablehnt, hat einen Status 400 oder 409 (HeatingError, PeriodError, CrossPropertyError).
const rejected = (err: unknown): boolean => {
  const status: unknown = err !== null && typeof err === 'object' ? Reflect.get(err, 'status') : undefined
  return status === 400 || status === 409
}

// Mieterzeilen und Vermieterteile einer Abrechnung, auch einer eingefrorenen (JSON).
const flaggedReason = (r: unknown): boolean => r === 'fuelClosedPeriod' || r === 'fuelEstimateDiff'

// Je Paar {Lieferung, zwei Heizperioden}: die Gegenzeile trägt die Kennung `fuel:<Lieferung>:<Heizperiode>:<andere>`.
const pairOf = (rowId: unknown): string | null => {
  if (typeof rowId !== 'string' || !rowId.startsWith('fuel:')) return null
  const [, d, p, o] = rowId.split(':')
  return d && p && o ? `${d}|${[p, o].sort().join('|')}` : null
}

function totals(s: unknown): { tenants: number; landlord: number; carry: number; up: number; down: number; pairs: Map<string, { carry: number; flagged: number; estimate: boolean }> } {
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
  const list = (o: unknown, key: string): unknown[] => {
    const v: unknown = o !== null && typeof o === 'object' ? Reflect.get(o, key) : undefined
    return Array.isArray(v) ? v : []
  }
  const tenants = list(s, 'statements').reduce<number>((a, st) => a + num(st !== null && typeof st === 'object' ? Reflect.get(st, 'totalShareCents') : 0), 0)
  const landlordObj: unknown = s !== null && typeof s === 'object' ? Reflect.get(s, 'landlord') : undefined
  const rows = list(landlordObj, 'rows')
  const parts = rows.flatMap((r) => list(r, 'landlordParts'))
  const reasonOf = (p: unknown): unknown => (p !== null && typeof p === 'object' ? Reflect.get(p, 'reason') : undefined)
  const centsOf = (p: unknown): number => num(p !== null && typeof p === 'object' ? Reflect.get(p, 'cents') : 0)
  const pairs = new Map<string, { carry: number; flagged: number; estimate: boolean }>()
  for (const r of rows) {
    const key = pairOf(r !== null && typeof r === 'object' ? Reflect.get(r, 'costItemId') : undefined)
    if (!key) continue
    const acc = pairs.get(key) ?? { carry: 0, flagged: 0, estimate: false }
    for (const p of list(r, 'landlordParts')) {
      if (reasonOf(p) === 'fuelEstimateDiff') acc.estimate = true
      if (reasonOf(p) === 'fuelCarry') acc.carry += centsOf(p)
      else if (flaggedReason(reasonOf(p))) acc.flagged += centsOf(p)
    }
    pairs.set(key, acc)
  }
  return {
    tenants,
    landlord: parts.reduce<number>((a, p) => a + centsOf(p), 0),
    carry: parts.reduce<number>((a, p) => a + (reasonOf(p) === 'fuelCarry' ? centsOf(p) : 0), 0),
    // Ausgewiesene Teile getrennt nach Vorzeichen: Ein positiver trägt der Vermieter statt der Mieter, ein
    // negativer haben die Mieter zu viel getragen.
    // Heizung PR 12: Der Leerstand (der Vermieter ist Nutzer der leeren Räume) zählt ebenso; ihn gibt es nur in
    // den Varianten mit Mieterwechsel.
    up: parts.reduce<number>((a, p) => a + (flaggedReason(reasonOf(p)) || reasonOf(p) === 'vacancy' ? Math.max(0, centsOf(p)) : 0), 0),
    down: parts.reduce<number>((a, p) => a + (flaggedReason(reasonOf(p)) || reasonOf(p) === 'vacancy' ? Math.min(0, centsOf(p)) : 0), 0),
    pairs,
  }
}

// Ohne Angabe die Startwerte 1 bis 10 und zwei festgehaltene, an denen die Mutationsprobe der
// Nachprüfungen von #233 je eine Rücknahme findet, die die ersten zehn nicht finden (16: Storno nach
// Abschluss der Heizperiode der Positionen; 81: Schätzfaktor). Ein Storno neben einer Schätzung (M2) und
// die Lücke nach einem Storno (G1) sieht die Invariante nicht, weil am Ende jede Schätzung von einer echten
// Rechnung abgedeckt sein muss; dafür stehen Einzeltests in calc-fuel.test.ts. Mit INV_FROM/INV_TO ein
// Bereich, z. B. INV_TO=60.
const SEEDS: number[] = process.env.INV_FROM !== undefined || process.env.INV_TO !== undefined
  ? Array.from({ length: Math.max(0, Number(process.env.INV_TO ?? 10) - Number(process.env.INV_FROM ?? 1) + 1) }, (_, k) => Number(process.env.INV_FROM ?? 1) + k)
  : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 81]
const STEPS = Number(process.env.INV_STEPS ?? 30)

type Variant = { name: string; lazy: boolean; estimate: boolean; two?: boolean; swap?: boolean; self?: boolean; hw?: 'combined' | 'separate'; dhw?: 'volumeFormula' | 'areaFormula'; capture?: 'hca' | 'serviceValues'; offset?: boolean; failure?: boolean }
const VARIANTS: Variant[] = [
  { name: 'Grundform', lazy: false, estimate: false },
  { name: 'Rechnung kommt später', lazy: true, estimate: false },
  { name: 'Abschluss mit Schätzung', lazy: true, estimate: true },
  { name: 'Zwei Anlagen', lazy: false, estimate: false, two: true },
  // Durchsicht von #238, I3: Gas wird an einem Tag durch Fernwärme ersetzt; die Rechnungen danach kommen
  // erst nach dem Tausch und gehören der neuen Anlage.
  { name: 'Kesseltausch', lazy: true, estimate: false, swap: true },
  // Heizung PR 10: eigene Heizkostenabrechnung, mit und ohne Schätzung beim Abschluss.
  { name: 'Eigene Heizkostenabrechnung', lazy: false, estimate: false, self: true },
  { name: 'Eigene Heizkostenabrechnung mit Schätzung', lazy: true, estimate: true, self: true },
  // Durchsicht von #239: mit Warmwasser, verbunden (Warmwasseranteil aus dem Speicherzähler) und getrennt
  // (Positionen nur für Heizung oder nur für Warmwasser).
  { name: 'Eigene Heizkostenabrechnung, verbundenes Warmwasser', lazy: false, estimate: false, self: true, hw: 'combined' },
  { name: 'Eigene Heizkostenabrechnung, getrenntes Warmwasser', lazy: false, estimate: false, self: true, hw: 'separate' },
  // Heizung PR 11: Warmwasseranteil nach einer Formel (§ 9 Abs. 2 HeizkostenV).
  { name: 'Eigene Heizkostenabrechnung, Warmwasser nach Volumenformel', lazy: false, estimate: false, self: true, hw: 'combined', dhw: 'volumeFormula' },
  { name: 'Eigene Heizkostenabrechnung, Warmwasser nach Flächenformel', lazy: true, estimate: false, self: true, hw: 'combined', dhw: 'areaFormula' },
  // Heizung PR 12: Heizkostenverteiler und Ablesedienst, jeweils mit Mieterwechsel und Leerstand in B.
  { name: 'Eigene Heizkostenabrechnung mit Heizkostenverteilern', lazy: false, estimate: false, self: true, capture: 'hca' },
  { name: 'Eigene Heizkostenabrechnung mit Heizkostenverteilern, verbundenes Warmwasser', lazy: true, estimate: false, self: true, hw: 'combined', capture: 'hca' },
  { name: 'Eigene Heizkostenabrechnung mit Werten eines Ablesedienstes', lazy: false, estimate: false, self: true, hw: 'combined', capture: 'serviceValues' },
  // Durchsicht von #241: Kesseltausch (die neue Anlage liest dieselben Geräte bzw. die Werte des Dienstes über
  // die Linie) und Ablesungen einige Tage neben dem Stichtag (ohne Rücksetzung, wie abgelesen).
  { name: 'Eigene Heizkostenabrechnung mit Heizkostenverteilern, Kesseltausch', lazy: true, estimate: false, self: true, swap: true, capture: 'hca' },
  { name: 'Eigene Heizkostenabrechnung mit Werten eines Ablesedienstes, Kesseltausch', lazy: true, estimate: false, self: true, swap: true, capture: 'serviceValues' },
  { name: 'Eigene Heizkostenabrechnung mit Heizkostenverteilern, Ablesung neben dem Stichtag', lazy: false, estimate: false, self: true, capture: 'hca', offset: true },
  // Heizung PR 13: Geräteausfall mit Schätzung nach § 9a, vier Wohnungen (30, 20, 25 und 25 % der Fläche),
  // Mieterwechsel in B, mit und ohne verbundenes Warmwasser.
  { name: 'Eigene Heizkostenabrechnung, Gerät ausgefallen (§ 9a)', lazy: false, estimate: false, self: true, failure: true },
  { name: 'Eigene Heizkostenabrechnung, verbundenes Warmwasser, Gerät ausgefallen (§ 9a)', lazy: true, estimate: false, self: true, hw: 'combined', failure: true },
]

// Wie oft die eigene Heizkostenabrechnung wirklich verteilt hat (Abdeckung, letzter Test).
const SELF = { periods: 0, distributed: 0, alpha: 0, formula: 0, units: 0 }
// Heizung PR 12, Durchsicht von #241: (s5) je Variante gezählt, damit keine still nichts prüft.
const UNITS_BY_VARIANT = new Map<string, number>()

// Heizung PR 12, (s5): Je Wohnung der Verbrauch der Heizung im Ausweis (Σ ihrer Nutzer) gleich dem erwarteten
// (Σ Differenz × Faktor ihrer Heizkostenverteiler bzw. Σ der Werte des Ablesedienstes), in Einheiten.
function unitChecks(r: ReturnType<typeof computeSettlement>, expected: ReadonlyMap<string, number> | undefined, water: ReadonlyMap<string, number> | undefined, where: string, variant: string): void {
  // Jede Anlage mit eigener Abrechnung, nach einem Kesseltausch also auch die neue (Durchsicht von #241, I1).
  for (const h of r.heating ?? []) {
    if (h.self) unitChecksOf(h.self, expected, water, `${where} (${h.plantId})`, variant)
  }
}
function unitChecksOf(self: NonNullable<NonNullable<ReturnType<typeof computeSettlement>['heating']>[number]['self']>, expected: ReadonlyMap<string, number> | undefined, water: ReadonlyMap<string, number> | undefined, where: string, variant: string): void {
  if (!self.ok || !expected) return
  SELF.units++
  UNITS_BY_VARIANT.set(variant, (UNITS_BY_VARIANT.get(variant) ?? 0) + 1)
  assert.equal(self.pots.find((p) => p.pot === 'heating')?.consumptionUnit, 'Einheiten', `${where}: (s5) Einheit`)
  for (const u of self.units) {
    const got = u.users.reduce((a, x) => a + (x.heatingConsumption ?? 0), 0)
    const want = expected.get(u.unitId) ?? 0
    assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${where}: (s5) ${u.unitName}: ${got} statt ${want}`)
    // Liefert der Ablesedienst das Warmwasser, zählen seine Werte und nicht die Warmwasserzähler.
    if (water && self.pots.some((p) => p.pot === 'water')) {
      const gotW = u.users.reduce((a, x) => a + (x.waterConsumption ?? 0), 0)
      const wantW = water.get(u.unitId) ?? 0
      assert.ok(Math.abs(gotW - wantW) <= 1e-6 * Math.max(1, wantW), `${where}: (s5) Warmwasser ${u.unitName}: ${gotW} statt ${wantW}`)
    }
  }
}

// Heizung PR 13, (s6): Geräteausfall mit Schätzung nach § 9a. Je Heizperiode, in der die Anlage verteilt:
// - die geschätzte Fläche des Topfs ist die Fläche der Wohnungen mit Schätzung, und der Topf geht genau dann nur
//   nach Fläche, wenn sie 25 % der Fläche **überschreitet** (C und D haben je genau 25 %, das ist keine
//   Überschreitung);
// - geht er nur nach Fläche, ist der Anteil nach Verbrauch 0, und jede Wohnung trägt Kosten × Fläche / Fläche des
//   Topfs (je Nutzer höchstens ein halber Cent daneben); sonst gilt der Anteil nach Verbrauch;
// - eine geschätzte Wohnung mit einem einzigen Nutzer hat genau den geschätzten Verbrauch;
// - in B (Mieterwechsel mit Zwischenablesung): Fehlt nur der Endstand, behält der Vormieter seinen abgelesenen
//   Verbrauch, und die Nutzer danach tragen zusammen die Schätzung mal ihrem Anteil an den Gradtagen (§ 9a Abs. 1
//   Satz 2, Prüfbericht A5); ist alles abgelesen, ergibt die Schätzung allein den Verbrauch der Wohnung (A9).
// Σ Zeilen = Σ Positionen prüft (i) wie in jeder Variante.
const AREAS: Record<string, number> = { a: 60, b: 40, c: 50, d: 50 }
const ESTIMATES = { checked: 0, over: 0, exact25: 0, kept: 0, complete: 0 }
type BFacts = { from: string; to: string; kept: number | null; endMissing: boolean; split: string }
const TABLE = onlyVersion(hkvDegreeDays).value
function estimateChecks(r: ReturnType<typeof computeSettlement>, estimates: readonly HeatingEstimate[], b: BFacts | null, where: string): void {
  const self = r.heating?.find((h) => h.plantId === 'hp')?.self
  if (!self?.ok) return
  const total = Object.values(AREAS).reduce((a, v) => a + v, 0)
  const heat = self.pots.find((p) => p.pot === 'heating') ?? assert.fail(`${where}: (s6) kein Topf Heizung`)
  const area = estimates.filter((e) => e.part === 'heat').reduce((a, e) => a + (AREAS[e.unitId] ?? 0), 0)
  if (area > 0) ESTIMATES.checked++
  if (area * 100 === total * 25) ESTIMATES.exact25++
  const over = area * 100 > total * 25
  assert.equal(heat.estimatedAreaM2, area, `${where}: (s6) geschätzte Fläche`)
  assert.equal(heat.overThreshold, over, `${where}: (s6) Grenze bei ${area} von ${total} m²`)
  if (over) {
    ESTIMATES.over++
    assert.equal(heat.consumptionPct, 0, `${where}: (s6) Anteil nach Verbrauch über der Grenze`)
    for (const u of self.units) {
      const got = u.users.reduce((a, x) => a + x.heatingCents, 0)
      const want = (heat.costCents * u.areaM2) / heat.areaM2
      assert.ok(Math.abs(got - want) <= u.users.length, `${where}: (s6) ${u.unitName} nur nach Fläche: ${got} statt ${want}`)
    }
  } else if (!heat.byAreaOnly) {
    assert.ok(heat.consumptionPct > 0, `${where}: (s6) Anteil nach Verbrauch unter der Grenze`)
  }
  for (const e of estimates.filter((x) => x.part === 'heat')) {
    const u = self.units.find((x) => x.unitId === e.unitId)
    if (!u || u.users.length !== 1) continue
    const v = u.users[0]?.heatingConsumption ?? Number.NaN
    assert.ok(Math.abs(v - e.value) <= 1e-9 * Math.max(1, e.value), `${where}: (s6) ${u.unitName} geschätzt ${e.value}, im Ausweis ${v}`)
  }
  const eb = estimates.find((x) => x.part === 'heat' && x.unitId === 'b')
  const ub = self.units.find((x) => x.unitId === 'b')
  if (!eb || !ub || !b) return
  const near = (x: number, y: number) => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(y))
  const all = ub.users.reduce((a, x) => a + (x.heatingConsumption ?? 0), 0)
  if (!b.endMissing && b.kept !== null) {
    // Alles abgelesen: Die Schätzung ersetzt alles (Markierung „unbrauchbar“).
    ESTIMATES.complete++
    assert.ok(near(all, eb.value), `${where}: (s6) B vollständig abgelesen, geschätzt ${eb.value}, im Ausweis ${all}`)
  } else if (b.endMissing && b.kept !== null) {
    ESTIMATES.kept++
    const first = ub.users.find((x) => x.tenancyId === 'tb') ?? assert.fail(`${where}: (s6) kein Vormieter in B`)
    assert.ok(near(first.heatingConsumption ?? Number.NaN, b.kept) && first.heatingEstimated !== true, `${where}: (s6) Vormieter behält ${b.kept}, im Ausweis ${first.heatingConsumption}`)
    // Geschätzt sind die Nutzer nach der letzten Zwischenablesung; ein Leerstand mit Ablesung zum Einzug
    // behält ebenfalls seinen Wert.
    const after = degreeDayPermille([{ from: isoOf(Date.parse(`${b.split}T00:00:00Z`) + DAY), to: b.to }], TABLE)
    const whole = degreeDayPermille([{ from: b.from, to: b.to }], TABLE)
    const rest = ub.users.filter((x) => x.heatingEstimated === true).reduce((a, x) => a + (x.heatingConsumption ?? 0), 0)
    assert.ok(near(rest, (eb.value * after) / whole), `${where}: (s6) Nutzer nach dem Wechsel ${rest} statt ${(eb.value * after) / whole}`)
  }
}

// Heizung PR 11, (s4): Bei einer Formel ist die Wärme für das Warmwasser im Ausweis Q = 2,5 · V · (t − 10)
// bzw. 32 · A (die beiden Wohnungen haben zusammen 100 m², jede Heizperiode hat zwölf Monate), bei Gas nach
// Brennwert mal 1,11, nach Heizwert ohne Faktor (§ 9 Abs. 2 Satz 6 Nr. 1), und α mal der Energie der Rechnungen
// in der Heizperiode (Bewertung der Lieferungen) ergibt genau dieses Q.
function dhwChecks(r: ReturnType<typeof computeSettlement>, input: { method: 'volumeFormula' | 'areaFormula'; volumeM3: number; tempC: number; basis: 'hs' | 'hi' }, where: string): void {
  const h = r.heating?.find((x) => x.plantId === 'hp')
  const self = h?.self
  if (!self?.ok || !self.alpha || !self.dhw) return
  SELF.formula++
  const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${where}: (s4) ${what}: ${a} statt ${b}`)
  const q0 = input.method === 'volumeFormula' ? 2.5 * input.volumeM3 * (input.tempC - 10) : 32 * 100
  const q = input.basis === 'hs' ? q0 * 1.11 : q0
  assert.equal(self.dhw.method, input.method, `${where}: (s4) Verfahren`)
  near(self.dhw.formulaKwh ?? Number.NaN, q0, 'Formelwert')
  near(self.dhw.heatKwh, q, 'Wärme nach dem Faktor')
  assert.equal(self.dhw.factor?.kind ?? null, input.basis === 'hs' ? 'gasCalorific' : null, `${where}: (s4) Faktor`)
  const energy = (h?.fuel?.deliveries ?? []).reduce((a, l) => a + (l.energyKwh ?? 0), 0)
  near((self.alpha.percent / 100) * energy, q, 'α · Energie der Rechnungen')
}

// Heizung PR 9: Wem gehört eine Zeile? Übertrag und Gegenbuchung der Lieferung, CO₂-Zeilen dem Topf, sonst der
// Position.
const plantOfRow = (id: string, itemPlant: ReadonlyMap<string, string>, deliveryPlant: ReadonlyMap<string, string>): string | undefined => {
  const [kind, ref] = id.split(':')
  if (kind === 'fuel') return deliveryPlant.get(ref ?? '')
  if (kind === 'co2' || kind === 'stock') return ref
  return itemPlant.get(id)
}

// Je Abrechnung (auch eingefroren): Jede Lieferung steht nur im Ausweis ihrer Anlage, und keine Gegenbuchung
// kommt zweimal vor.
function onceEach(s: unknown, deliveryPlant: ReadonlyMap<string, string>, where: string): void {
  const g = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' ? Reflect.get(o, k) : undefined)
  const arr = (o: unknown, k: string): unknown[] => { const v = g(o, k); return Array.isArray(v) ? v : [] }
  for (const h of arr(s, 'heating')) {
    for (const line of arr(g(h, 'fuel'), 'deliveries')) {
      const owner = deliveryPlant.get(String(g(line, 'deliveryId')))
      assert.equal(owner, g(h, 'plantId'), `${where}: Lieferung ${String(g(line, 'deliveryId'))} im Ausweis von ${String(g(h, 'plantId'))}`)
    }
  }
  const ids = arr(g(s, 'landlord'), 'rows').map((r) => String(g(r, 'costItemId'))).filter((id) => id.startsWith('fuel:'))
  assert.equal(new Set(ids).size, ids.length, `${where}: Gegenbuchung doppelt: ${ids.join(', ')}`)
}

// Heizung PR 10, (s1): Die Kernrechnung verteilt jeden Topf ganz. Der Ausweis nennt je Nutzer den Topfbetrag
// (Kosten des Topfs × Gewicht, auf den Cent gerundet); zusammen sind sie die Kosten des Topfs, je Nutzer
// höchstens ein halber Cent daneben. Keine Position der Anlage geht ohne Grund an den Vermieter, und der Rest
// beim Vermieter (Leerstand) wird nie negativ.
//
// (s3), Durchsicht von #239: Bei verbundenem Warmwasser (alle Positionen „Heizung und Warmwasser“) trägt der Topf
// Warmwasser den Warmwasseranteil α = gemessene Wärme am Speicher / Energie des Brennstoffs, der Topf Heizung
// den Rest; eine Vertauschung von α und 1 − α fällt hier auf, denn Σ Zeilen = Σ Positionen hielte sie aus.
function selfChecks(r: ReturnType<typeof computeSettlement>, items: readonly { id: string; key: string; amountCents: number; heatingTarget?: string | null }[], where: string): void {
  const self = r.heating?.find((h) => h.plantId === 'hp')?.self
  const mine = items.filter((c) => c.key === 'heatingSystem')
  if (!self || mine.length === 0) return
  SELF.periods++
  if (!self.ok) return
  SELF.distributed++
  for (const pot of self.pots) {
    const users = self.units.flatMap((u) => u.users)
    const sum = users.reduce((a, u) => a + (pot.pot === 'heating' ? u.heatingCents : u.waterCents), 0)
    assert.ok(Math.abs(sum - pot.costCents) <= users.length, `${where}: (s1) Topf ${pot.pot}: Σ Nutzer ${sum}, Kosten ${pot.costCents}`)
  }
  if (self.alpha && mine.every((c) => c.heatingTarget === 'both')) {
    SELF.alpha++
    const a = self.alpha.dhwHeatKwh / self.alpha.referenceKwh
    const cost = (p: string) => self.pots.find((x) => x.pot === p)?.costCents ?? 0
    const total = cost('heating') + cost('water')
    assert.ok(Math.abs(cost('water') - a * total) <= 1, `${where}: (s3) Warmwasser ${cost('water')} statt α ${a.toFixed(4)} × ${total}`)
  }
  for (const row of r.landlord.rows.filter((x) => mine.some((c) => c.id === x.costItemId))) {
    for (const p of row.landlordParts ?? []) {
      assert.ok(p.reason !== 'noBasis', `${where}: (s1) ${row.costItemId} ohne Verteilung beim Vermieter`)
      assert.ok(p.reason !== 'vacancy' || p.cents * Math.sign(row.totalCents || 1) >= -1, `${where}: (s1) negativer Leerstand ${p.cents} bei ${row.costItemId}`)
    }
  }
}

// Heizung PR 10, (s2): Zeilen einer Lieferung in einer Abrechnung (auch eingefroren): Mieter- und Vermieterzeilen
// ihrer Positionen und ihrer Übertragszeilen (`fuel:<Lieferung>:…:<Position>`), ohne die Gegenbuchungen.
function rowsOfDelivery(s: unknown, deliveryId: string, own: ReadonlySet<string>): number {
  const g = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' ? Reflect.get(o, k) : undefined)
  const arr = (o: unknown, k: string): unknown[] => { const v = g(o, k); return Array.isArray(v) ? v : [] }
  const n = (v: unknown): number => (typeof v === 'number' ? v : 0)
  const belongs = (id: string): boolean => own.has(id) || (id.startsWith(`fuel:${deliveryId}:`) && id.split(':').length > 4)
  const tenants = arr(s, 'statements').flatMap((st) => arr(st, 'rows')).filter((r) => belongs(String(g(r, 'costItemId')))).reduce<number>((a, r) => a + n(g(r, 'shareCents')), 0)
  const landlord = arr(g(s, 'landlord'), 'rows').filter((r) => belongs(String(g(r, 'costItemId')))).reduce<number>((a, r) => a + n(g(r, 'shareCents')), 0)
  return tenants + landlord
}

// Die Beträge der Positionen einer Lieferung, wie die Abrechnung sie verteilt hat (eine eingefrorene mit dem
// Betrag beim Abschluss): je Position einmal ihr `totalCents`.
function totalsOfDelivery(s: unknown, own: ReadonlySet<string>): number {
  const g = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' ? Reflect.get(o, k) : undefined)
  const arr = (o: unknown, k: string): unknown[] => { const v = g(o, k); return Array.isArray(v) ? v : [] }
  const seen = new Map<string, number>()
  for (const r of [...arr(s, 'statements').flatMap((st) => arr(st, 'rows')), ...arr(g(s, 'landlord'), 'rows')]) {
    const id = String(g(r, 'costItemId'))
    const total = g(r, 'totalCents')
    if (own.has(id) && typeof total === 'number') seen.set(id, total)
  }
  return [...seen.values()].reduce((a, v) => a + v, 0)
}

// Wie oft der Tausch in der Variante „Kesseltausch“ gelang (Abdeckung, letzter Test).
const SWAPS = { runs: 0, done: 0 }

for (const variant of VARIANTS) {
  for (const seed of SEEDS) {
    test(`Invariante, ${variant.name} (Startwert ${seed}): jede Rechnung genau einmal verteilt`, async () => {
      const rnd = zufall(seed * 7 + (variant.lazy ? 1 : 0) + (variant.estimate ? 2 : 0))
      const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
      // Heizung PR 11: Gas nach Brennwert oder nach Heizwert, für alle Rechnungen eines Laufs gleich, je nach
      // Startwert abwechselnd (der erste Wert der Zufallsfolge liegt bei kleinen Startwerten immer unter 0,5).
      const dhwBasis: 'hs' | 'hi' = seed % 2 === 0 ? 'hs' : 'hi'
      const dhwInputs = new Map<string, { volumeM3: number; tempC: number }>()
      const pick = <T,>(xs: readonly T[]): T | undefined => xs[Math.floor(rnd() * xs.length)]
      // Heizung PR 12: Auszug in B am 15.01.2025, Einzug nach 0 bis 30 Tagen Leerstand.
      const CHANGE_END = '2025-01-15'
      const nextStart = variant.capture || variant.failure ? isoOf(Date.parse(`${CHANGE_END}T00:00:00Z`) + (1 + int(0, 30)) * DAY) : ''
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fuel-inv-'))
      const opened = await openDatabase({ dataDir })
      try {
        const deliveries: { id: string; from: string; to: string; plantId: string }[] = []
        const all: { id: string; from: string; to: string; plantId: string }[] = []
        const pending: { id: string; plantId: string; body: Record<string, unknown> }[] = []
        await opened.write(async (db) => {
          await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1'))
          await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
          await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 40, participates: true })
          await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
          await createEntity(db, 'tenancies', 'tb', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01', ...(variant.capture || variant.failure ? { end: CHANGE_END } : {}) })
          if (variant.capture || variant.failure) await createEntity(db, 'tenancies', 'tb2', { unitId: 'b', tenantName: 'Mieter B2', persons: 1, start: nextStart })
          // Heizung PR 13: zwei weitere Wohnungen, sodass A 30 %, B 20 %, C und D je genau 25 % der Fläche haben.
          if (variant.failure) {
            for (const u of ['c', 'd']) {
              await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: AREAS[u] ?? 0, participates: true })
              await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
            }
          }
          if (variant.two) {
            await createEntity(db, 'units', 'c', { propertyId: 'objekt-1', name: 'C', areaM2: 50, participates: true })
            await createEntity(db, 'tenancies', 'tc', { unitId: 'c', tenantName: 'Mieter C', persons: 1, start: '2020-01-01' })
            await createHeatingPlant(db, 'hp', 'objekt-1', { name: 'Haus A', energy: 'gas', method: 'manual', units: [{ unitId: 'a', heatedAreaM2: null }, { unitId: 'b', heatedAreaM2: null }] })
            await createHeatingPlant(db, 'hp2', 'objekt-1', { buildingWith: 'own', name: 'Haus B', energy: 'gas', method: 'manual', units: [{ unitId: 'c', heatedAreaM2: null }] })
          } else {
            await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
          }
          // Heizung PR 10: Die Anlage rechnet selbst ab; Wärmezähler je Wohnung, kein zentrales Warmwasser.
          if (variant.self) {
            let m = 0
            const hw = variant.hw ?? 'none'
            await setUpSelf(db, 'hp', { period: '2023-05', heatConsumptionPct: int(50, 70), ...(hw !== 'none' ? { waterConsumptionPct: int(50, 70) } : {}), insulationRule: 'notApplies', hotWater: hw, capture: variant.capture ?? 'heatMeter', dhwHeatMeter: hw === 'combined' }, '2023-01-01', () => `wz${m++}`)
          }
          for (const plantId of variant.two ? ['hp', 'hp2'] : ['hp']) {
            let start = variant.estimate ? '2024-05-01' : isoOf(Date.UTC(2024, 1, 1) + int(0, 120) * DAY)
            const prefix = plantId === 'hp' ? 'd' : 'e'
            for (let k = 0; k < 3; k++) {
              const to = isoOf(Date.parse(`${start}T00:00:00Z`) + (int(300, 800) - 1) * DAY)
              const body = { label: `Rechnung ${prefix}${k}`, invoiceFrom: start, invoiceTo: to, fixedCents: rnd() < 0.5 ? int(0, 20000) : null, ...(variant.hw === 'combined' ? { energyKwh: int(20000, 60000) } : {}), ...(variant.dhw ? { gasBasis: dhwBasis } : {}) }
              // Kesseltausch: Die Rechnungen ab der zweiten gehören der neuen Anlage.
              const owner = variant.swap && k > 0 ? 'hp2' : plantId
              all.push({ id: `${prefix}${k}`, from: start, to, plantId: owner })
              if (!variant.lazy || k === 0) {
                await createDelivery(db, `${prefix}${k}`, plantId, body)
                deliveries.push({ id: `${prefix}${k}`, from: start, to, plantId })
              } else {
                pending.push({ id: `${prefix}${k}`, plantId: owner, body })
              }
              start = isoOf(Date.parse(`${to}T00:00:00Z`) + DAY)
            }
          }
        })
        const deliveryPlant = new Map(all.map((d) => [d.id, d.plantId]))
        const itemPlant = new Map<string, string>()
        const keys: string[] = []
        const firstFrom = all.reduce((a, d) => (d.from < a ? d.from : a), all[0]?.from ?? '')
        const lastTo = all.reduce((a, d) => (d.to > a ? d.to : a), '')
        for (let p = periodContaining(MAI, firstFrom); p.from <= lastTo; p = periodContaining(MAI, isoOf(Date.parse(`${p.to}T00:00:00Z`) + DAY))) keys.push(p.key)
        const periodOf = (key: string) => periodOfKey(MAI, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
        // Heizung PR 10: Ablesungen an jeder Grenze, je Wohnung ein steigender Stand.
        if (variant.self) {
          // Durchsicht von #239: dazu die Warmwasserzähler und der Wärmezähler am Speicher.
          const meters = (await opened.read((db) => readStock(db))).meters.filter((x) => (x.type === 'waerme' && x.unitId !== null) || (variant.hw && x.type === 'warmwasser') || x.heatingRole === 'dhwHeat')
          await opened.write(async (db) => {
            for (const meter of meters) {
              let value = 0
              const first = periodOf(keys[0] ?? '')
              await createEntity(db, 'readings', `${meter.id}@0`, { meterId: meter.id, date: isoOf(Date.parse(`${first.from}T00:00:00Z`) - DAY), value })
              for (const key of keys) {
                // Heizung PR 13: Zwischenablesung beim Wechsel in B (und zu Beginn des neuen Mietverhältnisses).
                const p = periodOf(key)
                if (variant.failure && meter.unitId === 'b' && meter.type === 'waerme' && CHANGE_END >= p.from && CHANGE_END < p.to) {
                  value += int(100, 2000)
                  await createEntity(db, 'readings', `${meter.id}@wechsel`, { meterId: meter.id, date: CHANGE_END, value, interimFor: CHANGE_END })
                  const before = isoOf(Date.parse(`${nextStart}T00:00:00Z`) - DAY)
                  if (before > CHANGE_END) {
                    value += int(0, 200)
                    await createEntity(db, 'readings', `${meter.id}@einzug`, { meterId: meter.id, date: before, value, interimFor: before })
                  }
                }
                value += meter.type === 'warmwasser' ? int(5, 50) : meter.heatingRole === 'dhwHeat' ? int(1000, 6000) : int(1000, 9000)
                await createEntity(db, 'readings', `${meter.id}@${key}`, { meterId: meter.id, date: p.to, value })
              }
            }
          })
        }
        // Heizung PR 13: Geräteausfall. Je Heizperiode fällt bei jeder Wohnung mit 30 % der Endstand des
        // Wärmezählers weg (damit auch der Anfangsstand der nächsten); die meisten Lücken schätzt der Vermieter
        // über den echten Schreibweg, manche nicht (dann verteilt die Anlage nicht), und manchmal steht eine
        // Schätzung neben vollständigen Ablesungen (Prüfbericht A9).
        const log: string[] = []
        const attempt = async (what: string, run: () => Promise<unknown>) => {
          try {
            await run()
            log.push(what)
          } catch (err) {
            if (!rejected(err)) throw err
          }
        }
        const failureUnits = ['a', 'b', 'c', 'd']
        const bFacts = new Map<string, BFacts>()
        const estimateBody = () => ({ value: int(1000, 9000), method: pick(['buildingAverage', 'previousPeriod', 'comparableUnit'] as const), reason: 'Wärmezähler ausgefallen', confirmed: rnd() < 0.7, cause: 'deviceFailure' })
        if (variant.failure) {
          const heatMeters = (await opened.read((db) => readStock(db))).meters.filter((x) => x.type === 'waerme' && x.unitId !== null && (x.heatingPlantId ?? null) === null)
          const gaps: { key: string; unitId: string }[] = []
          for (const [k, key] of keys.entries()) {
            for (const m of heatMeters) {
              if (rnd() >= 0.3 || !m.unitId) continue
              await opened.write((db) => removeEntity(db, 'readings', `${m.id}@${key}`))
              log.push(`ausfall ${m.unitId} ${key}`)
              gaps.push({ key, unitId: m.unitId })
              const next = keys[k + 1]
              if (next) gaps.push({ key: next, unitId: m.unitId })
            }
          }
          for (const g of gaps) if (rnd() < 0.85) await attempt(`schätzen ${g.unitId} ${g.key}`, () => opened.write((db) => saveEstimate(db, 'hp', g.key, g.unitId, 'heat', estimateBody())))
          // Neben vollständigen Ablesungen (A9), je Wohnung und Heizperiode mit 15 %.
          for (const key of keys) {
            for (const u of failureUnits) {
              // B in der Heizperiode des Wechsels öfter, damit (s6) die vollständige Ablesung mit Wechsel sieht.
              const changeHere = u === 'b' && CHANGE_END >= periodOf(key).from && CHANGE_END < periodOf(key).to
              if (gaps.some((g) => g.key === key && g.unitId === u) || rnd() >= (changeHere ? 0.6 : 0.15)) continue
              await attempt(`schätzen* ${u} ${key}`, () => opened.write((db) => saveEstimate(db, 'hp', key, u, 'heat', estimateBody())))
            }
          }
          // Was in B abgelesen ist: Stand zu Beginn und zum Wechsel, und ob der Endstand fehlt.
          const stockNow = await opened.read((db) => readStock(db))
          const bMeter = heatMeters.find((m) => m.unitId === 'b')
          const at = (date: string) => stockNow.readings.find((x) => x.meterId === bMeter?.id && x.date === date)?.value
          for (const key of keys) {
            const p = periodOf(key)
            if (!(CHANGE_END >= p.from && CHANGE_END < p.to)) continue
            const start = at(isoOf(Date.parse(`${p.from}T00:00:00Z`) - DAY))
            const change = at(CHANGE_END)
            const einzug = isoOf(Date.parse(`${nextStart}T00:00:00Z`) - DAY)
            const split = einzug > CHANGE_END && at(einzug) !== undefined ? einzug : CHANGE_END
            bFacts.set(key, { from: p.from, to: p.to, kept: start !== undefined && change !== undefined ? change - start : null, endMissing: at(p.to) === undefined, split })
          }
        }
        // Heizung PR 12: Heizkostenverteiler (je Wohnung zwei, Faktoren mit drei Nachkommastellen, in B eins mit
        // Produktskala), Stichtagswert am Ende jeder Heizperiode, Zwischenablesung beim Wechsel in B; bzw. Werte
        // des Ablesedienstes je Wohnung und Nutzungszeitraum. Erwartet je Heizperiode und Wohnung (s5).
        const expectedUnits = new Map<string, Map<string, number>>()
        const expectedWater = new Map<string, Map<string, number>>()
        const changeDays = variant.capture ? [CHANGE_END, ...(nextStart > isoOf(Date.parse(`${CHANGE_END}T00:00:00Z`) + DAY) ? [isoOf(Date.parse(`${nextStart}T00:00:00Z`) - DAY)] : [])] : []
        const addExpected = (key: string, unitId: string, v: number) => {
          const m = expectedUnits.get(key) ?? new Map<string, number>()
          m.set(unitId, (m.get(unitId) ?? 0) + v)
          expectedUnits.set(key, m)
        }
        if (variant.capture === 'hca') {
          const devices = [
            { id: 'hkv-a1', unitId: 'a', scale: 'unit', factor: int(500, 2000) / 1000 }, { id: 'hkv-a2', unitId: 'a', scale: 'unit', factor: int(500, 2000) / 1000 },
            { id: 'hkv-b1', unitId: 'b', scale: 'unit', factor: int(500, 2000) / 1000 }, { id: 'hkv-b2', unitId: 'b', scale: 'product', factor: null },
          ] as const
          await opened.write(async (db) => {
            for (const d of devices) {
              await createEntity(db, 'meters', d.id, { propertyId: 'objekt-1', unitId: d.unitId, name: d.id, type: 'hkv', unit: 'Einheiten', hcaScale: d.scale, ratingFactor: d.factor })
              const first = periodOf(keys[0] ?? '')
              // Neben dem Stichtag: bis zu zehn Tage vor oder nach der Grenze abgelesen, ohne Rücksetzung.
              const shift = (iso: string) => (variant.offset ? isoOf(Date.parse(`${iso}T00:00:00Z`) + int(-10, 10) * DAY) : iso)
              await createEntity(db, 'readings', `${d.id}@0`, { meterId: d.id, date: shift(isoOf(Date.parse(`${first.from}T00:00:00Z`) - DAY)), value: 0 })
              let total = 0
              for (const key of keys) {
                const p = periodOf(key)
                let value = 0
                // Zwischenablesung beim Wechsel in B (und am Beginn des Leerstands danach).
                if (d.unitId === 'b') {
                  for (const day of changeDays.filter((x) => x >= p.from && x < p.to)) {
                    value += int(0, 3000)
                    await createEntity(db, 'readings', `${d.id}@${day}`, { meterId: d.id, date: day, value })
                  }
                }
                value += int(100, 4000)
                if (variant.offset) {
                  // Ohne Zwischenablesung in B (die Grenzen des Wechsels haben dann eigene Stände); gezählt wird
                  // die Differenz der beiden Ablesungen neben den Grenzen.
                  await createEntity(db, 'readings', `${d.id}@${key}`, { meterId: d.id, date: shift(p.to), value: total + value })
                  total += value
                } else {
                  // Stichtagswert laut Anzeige am Ende der Heizperiode: das Gerät setzt auf 0 zurück.
                  await createEntity(db, 'readings', `${d.id}@${key}`, { meterId: d.id, date: p.to, value: 0, replacement: true, oldEndValue: value })
                }
                addExpected(key, d.unitId, value * (d.factor ?? 1))
              }
            }
          })
        }
        if (variant.capture === 'serviceValues') {
          for (const key of keys) {
            const p = periodOf(key)
            const rows: { unitId: string; from: string; to: string; heatValue: number; waterValue: number | null }[] = []
            for (const unitId of ['a', 'b']) {
              const cuts = unitId === 'b' ? changeDays.filter((x) => x >= p.from && x < p.to) : []
              let from = p.from
              for (const to of [...cuts, p.to]) {
                // Werte mit Nachkommastellen, wie Ablesedienste sie liefern.
                const heatValue = int(10000, 900000) / 100
                const waterValue = int(50, 5000) / 100
                rows.push({ unitId, from, to, heatValue, waterValue })
                addExpected(key, unitId, heatValue)
                const w = expectedWater.get(key) ?? new Map<string, number>()
                w.set(unitId, (w.get(unitId) ?? 0) + waterValue)
                expectedWater.set(key, w)
                from = isoOf(Date.parse(`${to}T00:00:00Z`) + DAY)
              }
            }
            await opened.write((db) => saveServiceValues(db, 'hp', key, { values: rows }))
          }
        }
        // Heizung PR 11: Warmwasser nach einer Formel, je Heizperiode Volumen und Temperatur; die Anlage erzeugt
        // die Wärme allein.
        if (variant.dhw) {
          const method = variant.dhw
          await opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: 'single' }))
          for (const key of keys) {
            const input = { volumeM3: int(10, 60), tempC: int(45, 60) }
            dhwInputs.set(key, input)
            await opened.write((db) => saveHotWater(db, 'hp', key, { dhwMethod: method, dhwUnmeasurable: true, ...(method === 'volumeFormula' ? { dhwVolumeM3: input.volumeM3, dhwTempC: input.tempC } : {}) }))
          }
        }
        let n = 0
        // Die Positionen je abgeschlossenem Zeitraum beim Abschluss.
        const atClose = new Map<string, number>()
        const unlinkedFrom = new Map<string, string>()
        const positionsIn = async (key: string) => (await opened.read((db) => readCostItems(db))).filter((c) => c.category === HEATING_CATEGORY && c.period === key).reduce((a, c) => a + c.amountCents, 0)
        const link = async (id: string, d: { id: string; to: string; plantId: string }, amountCents: number, key: 'area' | 'units') => {
          const owner = periodContaining(MAI, d.to)
          // Mit zwei Anlagen verteilt jede Position nur über die Wohnungen ihrer Anlage.
          const participants = variant.two ? { participantUnitIds: d.plantId === 'hp' ? ['a', 'b'] : ['c'] } : {}
          const target = variant.hw === 'combined' ? 'both' : variant.hw === 'separate' ? (rnd() < 0.5 ? 'heating' : 'water') : 'heating'
          const selfKey = variant.self ? { key: 'heatingSystem', heatingPart: 'fuel', heatingTarget: target } : { key }
          const made = await opened.write((db) => createEntity(db, 'costItems', id, {
            propertyId: 'objekt-1', period: owner.key, category: HEATING_CATEGORY, description: id, amountCents,
            heatingPlantId: d.plantId, fuelDeliveryId: d.id, taxYear: Number(owner.to.slice(0, 4)), ...participants, ...selfKey,
          }))
          itemPlant.set(id, d.plantId)
          return made
        }
        // Der Tausch am ersten Tag der zweiten Rechnung; er kann abgelehnt werden (abgeschlossene Heizperiode).
        let swapped = false
        if (variant.swap) SWAPS.runs++
        const swapDate = all[1]?.from ?? ''
        const replace = async (mark: string) => {
          if (!variant.swap || swapped) return
          try {
            await opened.write((db) => replaceHeatingPlant(db, 'hp', 'hp2', { date: swapDate, energy: 'districtHeating', name: 'Fernwärme', previousName: 'Gas' }))
            swapped = true
            SWAPS.done++
            log.push(`${mark} ${swapDate}`)
          } catch (err) {
            if (process.env.INV_DEBUG) console.log('Tausch abgelehnt', variant.name, String(err).slice(0, 200))
            if (!rejected(err)) throw err
          }
        }
        const arrive = async (next: { id: string; plantId: string; body: Record<string, unknown> }, mark: string) => {
          if (next.plantId === 'hp2' && variant.swap) {
            await replace('replace')
            if (!swapped) return
          }
          await opened.write((db) => createDelivery(db, next.id, next.plantId, next.body))
          const a = all.find((x) => x.id === next.id)
          if (a) deliveries.push(a)
          log.push(`${mark} ${next.id}`)
        }
        // Durchsicht von #241: Mit eigener Abrechnung wird gleich zu Beginn getauscht, bevor ein Abschluss den
        // Tausch sperrt; die Rechnungen der neuen Anlage kommen danach.
        if (variant.self && variant.swap) await replace('replace')
        for (let step = 0; step < STEPS; step++) {
          // Heizung PR 13: mit Geräteausfall auch Schätzungen ändern oder entfernen, auch in abgeschlossenen
          // Heizperioden (dort 409). Die übrigen Varianten behalten ihre Folge der Vorgänge.
          const op = pick(variant.failure
            ? ['link', 'link', 'link', 'credit', 'unlink', 'delete', 'close', 'close', 'reopen', 'amount', 'arrive', 'relink', 'storno', 'estimate'] as const
            : ['link', 'link', 'link', 'credit', 'unlink', 'delete', 'close', 'close', 'reopen', 'amount', 'arrive', 'relink', 'storno'] as const)
          if (op === 'estimate') {
            const key = pick(keys)
            const u = pick(failureUnits)
            if (!key || !u) continue
            if (rnd() < 0.3) await attempt(`entfernen ${u} ${key}`, () => opened.write((db) => removeEstimate(db, 'hp', key, u, 'heat')))
            else await attempt(`schätzen~ ${u} ${key}`, () => opened.write((db) => saveEstimate(db, 'hp', key, u, 'heat', estimateBody())))
            continue
          }
          const d = pick(deliveries)
          if (!d) continue
          const items = (await opened.read((db) => readCostItems(db))).filter((c) => c.fuelDeliveryId === d.id)
          if (op === 'arrive') {
            const next = pending[0]
            if (next) await arrive(next, 'arrive')
            if (next && deliveries.some((x) => x.id === next.id)) pending.shift()
          } else if (op === 'amount') {
            const c = pick(items)
            if (!c) continue
            const amountCents = rnd() < 0.15 ? 0 : c.amountCents < 0 ? -int(1000, 40000) : int(100000, 900000)
            await attempt(`amount ${c.id}=${amountCents}`, () => opened.write((db) => updateEntity(db, 'costItems', c.id, { amountCents })))
          } else if (op === 'link' || op === 'credit') {
            const positive = items.filter((c) => c.amountCents > 0).reduce((a, c) => a + c.amountCents, 0)
            if (op === 'credit' && (positive === 0 || items.filter((c) => c.amountCents < 0).length >= 2)) continue
            const id = `p${n++}`
            // Eine Gutschrift ist meist klein, manchmal ein Storno bis zum ganzen Betrag (W1).
            const amountCents = op === 'credit' ? (rnd() < 0.3 ? -positive : -int(1000, 40000)) : int(100000, 900000)
            await attempt(`${op} ${id}→${d.id}=${amountCents}`, () => link(id, d, amountCents, rnd() < 0.5 ? 'area' : 'units'))
          } else if (op === 'unlink' || op === 'delete') {
            const credits = items.filter((x) => x.amountCents < 0)
            const c = pick(credits.length > 0 ? credits : items)
            if (!c) continue
            await attempt(`${op} ${c.id}`, () => (op === 'delete' ? opened.write((db) => removeEntity(db, 'costItems', c.id)) : opened.write((db) => updateEntity(db, 'costItems', c.id, { fuelDeliveryId: null }))))
            if (op === 'unlink') unlinkedFrom.set(c.id, d.id)
          } else if (op === 'storno') {
            // Die Rechnung storniert: eine Gutschrift über die Summe ihrer Positionen, danach ergeben sie 0
            // (W1, auch nach dem Abschluss einer der Heizperioden, auch neben einer Schätzung).
            const T = items.reduce((a, c) => a + c.amountCents, 0)
            if (T <= 0) continue
            const id = `p${n++}`
            await attempt(`storno ${id}→${d.id}=${-T}`, () => link(id, d, -T, rnd() < 0.5 ? 'area' : 'units'))
          } else if (op === 'relink') {
            // Eine gelöste Position wieder mit ihrer Lieferung verknüpfen, auch nach einem Abschluss dazwischen.
            const all = await opened.read((db) => readCostItems(db))
            const c = pick(all.filter((x) => x.fuelDeliveryId == null && unlinkedFrom.has(x.id)))
            const to = c ? unlinkedFrom.get(c.id) : undefined
            if (!c || !to) continue
            await attempt(`relink ${c.id}→${to}`, () => opened.write((db) => updateEntity(db, 'costItems', c.id, { fuelDeliveryId: to })))
          } else if (op === 'close') {
            const key = pick(keys)
            if (!key) continue
            const here = await positionsIn(key)
            await attempt(`close ${key}`, () => opened.write(async (db) => {
              if (await findClosedSettlement(db, 'objekt-1', periodKey(key))) return
              atClose.set(key, here)
              await db.transaction(async (tx) => {
                let settlement = computeSettlement(snapshotFor(await readStock(tx), 'objekt-1', periodOf(key)), {})
                if (variant.estimate && fuelGapQuestions(settlement).length > 0 && rnd() < 0.7) {
                  const made = await createEstimates(tx, settlement, () => `e${n++}`)
                  log.push(`estimate ${made.join('+')}`)
                  settlement = computeSettlement(snapshotFor(await readStock(tx), 'objekt-1', periodOf(key)), {})
                }
                await closeSettlement(tx, { id: `s${n++}`, propertyId: 'objekt-1', period: periodKey(key), closedAt: '2027-01-01', sentAt: null, settlement })
                await freezeFuelCarries(tx, settlement)
              })
            }))
          } else {
            const key = pick(keys)
            if (!key) continue
            await attempt(`reopen ${key}`, async () => {
              if (await opened.write((db) => reopenSettlement(db, 'objekt-1', periodKey(key), `h${n++}`, unfreezeFuelCarries))) atClose.delete(key)
            })
          }
        }
        if (variant.swap) for (const next of [...pending]) {
          await arrive(next, 'arrive*')
          if (deliveries.some((x) => x.id === next.id)) pending.splice(pending.indexOf(next), 1)
        }
        if (variant.estimate) {
          // Am Ende kommen alle Rechnungen und werden verknüpft, wo es geht; dann ist jede Schätzung durch
          // eine echte Rechnung ersetzt oder ihr Teil als Abweichung ausgewiesen.
          for (const next of pending.splice(0)) await arrive(next, 'arrive*')
          for (const d of deliveries) {
            const its = (await opened.read((db) => readCostItems(db))).filter((c) => c.fuelDeliveryId === d.id)
            if (its.reduce((a, c) => a + c.amountCents, 0) > 0) continue
            const id = `p${n++}`
            await attempt(`link* ${id}→${d.id}`, () => link(id, d, int(100000, 900000), 'area'))
          }
        }
        const fall = `${variant.name}, Startwert ${seed}: ${JSON.stringify(all.map((d) => [d.from, d.to]))} ${log.join(', ')}`
        const stock = await opened.read((db) => readStock(db))
        const closed = await opened.read((db) => readClosedSettlements(db))
        const items = (await opened.read((db) => readCostItems(db))).filter((c) => c.category === HEATING_CATEGORY)
        let positions = 0
        // Eine Anlage, die die Kernrechnung nicht verteilt (Warmwasseranteil ohne vollständige Rechnungen),
        // gibt alles an den Vermieter; die Schranken (ii) und (vii) gelten dann nicht (Durchsicht von #239).
        let selfBlocked = false
        let tenants = 0
        let landlord = 0
        const pairs = new Map<string, { carry: number; flagged: number; estimate: boolean }>()
        let up = 0
        let down = 0
        const live = new Map<string, ReturnType<typeof computeSettlement>>()
        for (const key of keys) {
          const stored = closed.find((c) => c.period === key)
          const r = stored ? null : computeSettlement(snapshotFor(stock, 'objekt-1', periodOf(key)), {})
          if (r) live.set(key, r)
          const t = totals(stored ? stored.settlement : r)
          if (variant.two || (variant.swap && swapped)) {
            onceEach(stored ? stored.settlement : r, deliveryPlant, `${fall}; ${key}`)
            // Kesseltausch: Die neue Anlage zeigt keine Lücke vor dem Tausch, und keine Anlage steht in einem
            // Zeitraum, in dem sie nicht heizt.
            if (r && variant.swap) {
              const gaps = r.heating?.find((h) => h.plantId === 'hp2')?.fuel?.gaps ?? []
              assert.ok(gaps.every((g) => g.from >= swapDate), `${fall}; Lücke der neuen Anlage vor dem Tausch in ${key}: ${JSON.stringify(gaps)}`)
              for (const h of r.heating ?? []) {
                const p = periodOf(key)
                const alive = h.plantId === 'hp' ? p.from < swapDate : p.to >= swapDate
                assert.ok(alive || !h.fuel, `${fall}; ${h.plantId} rechnet Lieferungen in ${key}, obwohl sie dort nicht heizt`)
              }
            }
            if (r) {
              // Je Anlage ergeben ihre Zeilen ihre Positionen.
              for (const plantId of ['hp', 'hp2']) {
                const rows: { costItemId: string; shareCents: number }[] = [...r.statements.flatMap((st) => st.rows), ...r.landlord.rows].filter((row) => plantOfRow(row.costItemId, itemPlant, deliveryPlant) === plantId)
                const mine = items.filter((c) => c.period === key && c.heatingPlantId === plantId).reduce((a, c) => a + c.amountCents, 0)
                assert.equal(rows.reduce((a, row) => a + row.shareCents, 0), mine, `${fall}; Zeilen von ${plantId} in ${key}`)
              }
            }
          }
          if (r && variant.self) selfChecks(r, items.filter((c) => c.period === key), `${fall}; ${key}`)
          if (r && variant.capture) unitChecks(r, expectedUnits.get(key), expectedWater.get(key), `${fall}; ${key}`, variant.name)
          if (r && variant.failure) estimateChecks(r, stock.heatingEstimates.filter((e) => e.plantId === 'hp' && e.period === key), bFacts.get(key) ?? null, `${fall}; ${key}`)
          const dhwInput = dhwInputs.get(key)
          if (r && variant.dhw && dhwInput) dhwChecks(r, { method: variant.dhw, ...dhwInput, basis: dhwBasis }, `${fall}; ${key}`)
          if (r && variant.self && r.heating?.find((h) => h.plantId === 'hp')?.self?.ok === false) selfBlocked = true
          // Heizung PR 11: auch eine abgeschlossene Heizperiode, in der die Anlage nicht verteilt war (etwa eine
          // Lücke in den Rechnungen, die der Warmwasseranteil nach einer Formel nicht überbrückt).
          if (stored && variant.self) {
            const heating: unknown = Reflect.get(Object(stored.settlement), 'heating')
            if (Array.isArray(heating) && heating.some((x: unknown) => Reflect.get(Object(x), 'plantId') === 'hp' && Reflect.get(Object(Reflect.get(Object(x), 'self')), 'ok') === false)) selfBlocked = true
          }
          const here = stored ? (atClose.get(key) ?? assert.fail(`${fall}; ${key} ohne Stand beim Abschluss`)) : items.filter((c) => c.period === key).reduce((a, c) => a + c.amountCents, 0)
          assert.equal(t.tenants + t.landlord, here, `${fall}; Σ Zeilen in ${key}`)
          positions += here
          tenants += t.tenants
          landlord += t.landlord
          for (const [k, v] of t.pairs) {
            const acc = pairs.get(k) ?? { carry: 0, flagged: 0, estimate: false }
            acc.carry += v.carry
            acc.flagged += v.flagged
            acc.estimate ||= v.estimate
            pairs.set(k, acc)
          }
          up += t.up
          down += t.down
        }
        // (i) durch den Aufbau
        assert.equal(tenants + landlord, positions, `${fall}; (i)`)
        // (s2) Heizung PR 10: jede Lieferung genau einmal, über alle Heizperioden (ohne Schätzungen und
        // ohne ausgewiesene Teile, wie (iii); abgeschlossene mit ihrem eingefrorenen Stand).
        if (variant.self) {
          const flaggedAny = [...pairs.values()].some((v) => v.flagged !== 0 || v.estimate)
          const estimatesNow = (await opened.read((db) => readFuelDeliveries(db))).filter((x) => x.estimated)
          if (!flaggedAny && estimatesNow.length === 0) {
            for (const d of deliveries) {
              const own = new Set(items.filter((c) => c.fuelDeliveryId === d.id).map((c) => c.id))
              let rows = 0
              let T = 0
              for (const key of keys) {
                const s = closed.find((c) => c.period === key)?.settlement ?? live.get(key)
                rows += rowsOfDelivery(s, d.id, own)
                T += totalsOfDelivery(s, own)
              }
              assert.equal(rows, T, `${fall}; (s2) Lieferung ${d.id}: Zeilen ${rows}, Positionen ${T}`)
            }
          }
        }
        const deliveriesNow = await opened.read((db) => readFuelDeliveries(db))
        const estimates = deliveriesNow.filter((x) => x.estimated)
        // Eine stornierte Rechnung (Positionen ergeben 0 oder weniger) ersetzt keine Schätzung (Nachprüfung, M2).
        const linkedReal = deliveries.filter((d) => items.filter((c) => c.fuelDeliveryId === d.id).reduce((a, c) => a + c.amountCents, 0) > 0)
        const coveredDay = (day: string) => linkedReal.some((d) => d.from <= day && day <= d.to)
        const estimatesCovered = estimates.every((e) => coveredDay(e.invoiceFrom ?? '') && coveredDay(e.invoiceTo ?? ''))
        if ((estimates.length === 0 || estimatesCovered) && !selfBlocked) {
          assert.ok(tenants >= positions - up, `${fall}; (vii) Mieter ${tenants} < Positionen ${positions} − ausgewiesen ${up}`)
          assert.ok(tenants <= positions - down, `${fall}; (ii) Mieter ${tenants} > Positionen ${positions} + ausgewiesen ${-down}`)
        }
        // (iii) je Lieferung und Paar von Heizperioden: Die Gegenbuchungen heben sich auf, oder ein
        // ausgewiesener Teil deckt sie genau (Nachprüfung von 47f2373, H1: über alle Lieferungen summiert
        // deckte ein berechtigter Teil einer Lieferung die falsche Gegenbuchung einer anderen). Ausgelassen
        // sind nur die Paare einer Schätzung und die, in denen eine Rechnung eine Schätzung ersetzt
        // (`fuelEstimateDiff`): Dort steht die Gegenbuchung der Schätzung unter deren Kennung, nicht unter der
        // der Rechnung (Nachprüfung von 5bee89f, M-a).
        const estimateIds = new Set(estimates.map((e) => e.id))
        for (const [k, v] of pairs) {
          if (v.estimate || estimateIds.has(k.split('|')[0] ?? '')) continue
          assert.ok(v.carry === 0 || v.carry === -v.flagged, `${fall}; (iii) ${k}: Gegenbuchungen ${v.carry}, ausgewiesen ${v.flagged}`)
        }
        // Zuordnung (I1): eine mit 0 eingefrorene Heizperiode bekommt trotzdem ihren Teil hinausgebucht.
        const frozen = await opened.read((db) => readFuelCarryFrozen(db))
        for (const d of deliveries) {
          const owner = periodContaining(MAI, d.to).key
          const T = items.filter((c) => c.fuelDeliveryId === d.id).reduce((a, c) => a + c.amountCents, 0)
          const r = live.get(owner)
          if (!r || T === 0) continue
          for (const f of frozen.filter((x) => x.deliveryId === d.id && x.cents === 0 && x.period !== owner && closed.some((c) => c.period === x.period))) {
            const carry = r.heating?.find((h) => h.plantId === d.plantId)?.fuel?.carries.find((c) => c.deliveryId === d.id && c.period === f.period)
            assert.ok(carry && carry.cents !== 0, `${fall}; ${d.id} bucht den Teil für ${f.period} nicht hinaus`)
          }
        }
      } finally {
        opened.close()
        fs.rmSync(dataDir, { recursive: true, force: true })
      }
    })
  }
}

test('Invariante, eigene Heizkostenabrechnung: Abdeckung', () => {
  if (process.env.INV_LOG) console.log('Eigene Abrechnung', JSON.stringify(SELF))
  if (SELF.periods < 10) return
  assert.ok(SELF.alpha > 0, 'kein Lauf mit Warmwasseranteil geprüft (s3)')
  assert.ok(SELF.formula > 0, 'kein Lauf mit Warmwasseranteil nach einer Formel geprüft (s4)')
  assert.ok(SELF.distributed * 2 >= SELF.periods, `nur ${SELF.distributed} von ${SELF.periods} Heizperioden nach der Verordnung verteilt`)
  assert.ok(SELF.units > 0, 'kein Lauf mit Heizkostenverteilern oder Ablesedienst geprüft (s5)')
  if (process.env.INV_LOG) console.log('(s5) je Variante', JSON.stringify([...UNITS_BY_VARIANT]))
  for (const v of VARIANTS.filter((x) => x.capture)) assert.ok((UNITS_BY_VARIANT.get(v.name) ?? 0) > 0, `(s5) nie geprüft: ${v.name}`)
})

test('Invariante, Schätzung nach § 9a: Abdeckung', () => {
  if (process.env.INV_LOG) console.log('Schätzung', JSON.stringify(ESTIMATES))
  if (SELF.periods < 10) return
  assert.ok(ESTIMATES.checked > 0, 'keine Heizperiode mit Schätzung geprüft (s6)')
  assert.ok(ESTIMATES.over > 0, 'keine Heizperiode über der Grenze geprüft (s6)')
  assert.ok(ESTIMATES.checked > ESTIMATES.over, 'keine Heizperiode mit Schätzung unter der Grenze geprüft (s6)')
  assert.ok(ESTIMATES.exact25 > 0, 'keine Heizperiode mit genau 25 % geschätzter Fläche geprüft (s6, R-A22)')
  assert.ok(ESTIMATES.kept > 0, 'kein Vormieter mit abgelesenem Verbrauch neben einer Schätzung geprüft (s6, A5)')
  assert.ok(ESTIMATES.complete > 0, 'keine Schätzung neben vollständiger Ablesung geprüft (s6, A9)')
})

test('Invariante, Kesseltausch: Abdeckung', () => {
  if (SWAPS.runs < 10) return
  assert.ok(SWAPS.done * 3 >= SWAPS.runs * 2, `nur ${SWAPS.done} von ${SWAPS.runs} Läufen getauscht`)
})
