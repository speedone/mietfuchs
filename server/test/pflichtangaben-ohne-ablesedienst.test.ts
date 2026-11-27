// #690 Punkt 7: Wer ohne Ablesedienst selbst abrechnet, hat keine „Vergleichsdaten Ihres Ablesedienstes“. Hinweis der
// Abrechnung und Ablehnung beim Speichern nennen sie deshalb nur noch dort, wo Werte eines Ablesedienstes erfasst
// werden; für alle anderen Anlagen bleibt der Wortlaut, wie er war.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { createEntity } from '../src/db/repository.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { saveHeatingInfo } from '../src/db/heatingInfo.ts'
import { saveMonthlyInfoRow } from '../src/db/monthlyInfo.ts'
import { computeSettlement } from '../src/calc.ts'
import { selfReading, selfSnapshot } from '../testing/selfHeating.ts'

const OLD = /etwa (aus den|die) Vergleichsdaten Ihres Ablesedienstes/

test('Hinweis der Abrechnung, Wärmezähler ohne Ablesedienst: der Weg steht in der Hilfe am Feld, kein Verweis auf den Ablesedienst als Quelle', () => {
  const base = selfSnapshot()
  const s = computeSettlement({ ...base, readings: [...base.readings, ...base.meters.filter((m) => m.unitId !== null).map((m) => selfReading(m.id, '2023-12-31', 0))] })
  const n = s.notices?.find((x) => x.code === 'heating.info-incomplete') ?? assert.fail('Hinweis heating.info-incomplete fehlt')
  assert.match(n.text, /Für den Vergleich mit einem Durchschnittsnutzer \(Nr\. 4\) tragen Sie einen Vergleichswert in kWh je m² Wohnfläche mit seiner Quelle ein\./)
  assert.match(n.text, /Rechnen Sie ohne Ablesedienst ab, nennt die Hilfe am Feld in der Karte „Angaben zur Abrechnung \(§ 6a\)“ einen Weg\./)
  assert.doesNotMatch(n.text, OLD)
  // Der Ausschluss des Hausdurchschnitts und seine Fundstelle bleiben.
  assert.match(n.text, /Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich.*\(BR-Drs\. 643\/21, S\. 19 und 21\)/s)
})

const status = (code: number, text: RegExp) => (e: unknown) =>
  e instanceof Error && 'status' in e && (e as { status: unknown }).status === code && text.test(e.message)
let ids = 0
const newId = () => `v-${++ids}`

async function house(capture: 'heatMeter' | 'serviceValues' | null, run: (save: (body: Record<string, unknown>) => Promise<unknown>) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-vergleichswert-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      for (const [u, area] of [['a', 60], ['b', 80]] as const) {
        await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: true, selfUsed: false })
        await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
      }
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
    })
    if (capture !== null) {
      await opened.write((db) => setUpSelf(db, 'hp', { period: '2026-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'none', capture, dhwHeatMeter: false, totalHeatMeter: false }, '2025-12-01', newId))
    }
    await run((body) => opened.write((db) => saveHeatingInfo(db, 'hp', '2026-01', body)))
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('Vergleichswert ohne Quelle speichern: eigene Abrechnung ohne Ablesedienst nennt Herausgeber, Titel und Jahr', async () => {
  await house('heatMeter', async (save) => {
    await assert.rejects(save({ infoReferenceKwhPerM2: 120 }), (e: unknown) => status(400, /Quelle des Vergleichswerts, etwa Herausgeber, Titel und Jahr.*eigenen Haus/)(e) && !OLD.test((e as Error).message))
  })
})

test('Vergleichswert ohne Quelle speichern: mit Werten des Ablesedienstes und bei freien Schlüsseln bleibt der Satz wortgleich', async () => {
  const same = status(400, /^Bitte nennen Sie die Quelle des Vergleichswerts, etwa die Vergleichsdaten Ihres Ablesedienstes\. Ein Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich\.$/)
  await house('serviceValues', async (save) => { await assert.rejects(save({ infoReferenceKwhPerM2: 120 }), same) })
  await house(null, async (save) => { await assert.rejects(save({ infoReferenceKwhPerM2: 120 }), same) })
})

// Durchsicht S4: monatliche Verbrauchsinformation (§ 6a Abs. 2 Nr. 3), dieselbe Weiche wie beim Vergleichswert der
// Abrechnung; mit Werten eines Ablesedienstes bleibt der Satz.
async function monthly(capture: 'heatMeter' | 'serviceValues', check: (e: unknown) => boolean): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-monat-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true, selfUsed: false })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
    })
    await opened.write((db) => setUpSelf(db, 'hp', { period: '2026-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'none', capture, dhwHeatMeter: false, totalHeatMeter: false }, '2025-12-01', newId))
    await assert.rejects(opened.write((db) => saveMonthlyInfoRow(db, 'hp', '2026-03', { referenceKwhPerM2: 10 })), check)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('monatliche Information: Vergleichswert ohne Quelle nennt ohne Ablesedienst Herausgeber, Titel und Jahr', async () => {
  await monthly('heatMeter', (e) => status(400, /etwa Herausgeber, Titel und Jahr/)(e) && !OLD.test((e as Error).message))
  await monthly('serviceValues', status(400, /etwa die Vergleichsdaten Ihres Ablesedienstes/))
})
