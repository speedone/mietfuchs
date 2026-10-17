// Anteil nach Verbrauch über die Linie einer Anlage
// (Durchsicht von #239, I1 und I3; die Regeln stehen in heating.ts). Eigene Datei, weil der Wächter
// in repository.ts sie braucht und heatingSelf.ts selbst aus repository.ts liest.
import { lineShareRows, type PlantShareRow, type ShareRow } from '../heating.ts'
import type { Executor } from './client.ts'
import { heatingPeriods, heatingPlants } from './schema.ts'

export async function lineRowsOf(db: Executor, plantId: string): Promise<{ merged: ShareRow[]; all: PlantShareRow[]; plants: { id: string; replacesPlantId: string | null }[] }> {
  const plants = await db.select({ id: heatingPlants.id, replacesPlantId: heatingPlants.replacesPlantId }).from(heatingPlants)
  const all = (await db.select({ plantId: heatingPeriods.plantId, period: heatingPeriods.period, heatConsumptionPct: heatingPeriods.heatConsumptionPct, waterConsumptionPct: heatingPeriods.waterConsumptionPct, insulationRule: heatingPeriods.insulationRule, above70Agreed: heatingPeriods.above70Agreed })
    .from(heatingPeriods)).map((r) => ({ ...r, period: String(r.period) }))
  return { merged: lineShareRows(all, plants, plantId), all, plants }
}

// Der Satz, wenn etwas vor dem Beginn der eigenen Abrechnung nach ihr gehen soll.
export const beforeBeginText = (begin: string): string =>
  `Die eigene Heizkostenabrechnung dieser Anlage beginnt mit der Heizperiode ${begin.slice(0, 4)}${begin.slice(5, 7) === '01' ? '' : `/${Number(begin.slice(0, 4)) + 1} (ab ${begin.slice(5, 7)}.${begin.slice(0, 4)})`}. Davor gelten die bisherigen Schlüssel, denn der Anteil nach Verbrauch gilt nur für künftige Abrechnungszeiträume (§ 6 Abs. 4 HeizkostenV).`
