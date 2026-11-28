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
const heatingPeriodName = (key: string): string =>
  `${key.slice(0, 4)}${key.slice(5, 7) === '01' ? '' : `/${Number(key.slice(0, 4)) + 1} (ab ${key.slice(5, 7)}.${key.slice(0, 4)})`}`
export const beforeBeginText = (begin: string): string =>
  `Die eigene Heizkostenabrechnung dieser Anlage beginnt mit der Heizperiode ${heatingPeriodName(begin)}. Davor gelten die bisherigen Schlüssel, denn der Anteil nach Verbrauch gilt nur für künftige Abrechnungszeiträume (§ 6 Abs. 4 HeizkostenV).`
// #690, Durchsicht: Die Heizperiode liegt in einem früheren Zeitraum der eigenen Abrechnung (Erfassung oder
// Warmwasserbereitung wurden für später geändert). Sie rechnet selbst ab; nur umgestellt wird sie hier nicht mehr.
export const earlierSpanText = (period: string, laterFrom: string): string =>
  `Die Heizperiode ${heatingPeriodName(period)} rechnet schon nach der eigenen Heizkostenabrechnung, mit der Erfassung und der Warmwasserbereitung, die für sie eingestellt waren; ab der Heizperiode ${heatingPeriodName(laterFrom)} gilt eine andere Einstellung. ` +
  'Eine frühere Heizperiode lässt sich hier nicht nachträglich umstellen. Gespeichert wurde nichts. Wählen Sie den Zeitraum, ab dem die Änderung gelten soll, und ändern Sie die Erfassung dort.'
