// Fernablesbarkeit der Erfassungsgeräte (Heizung PR 4, #214, Entwurf 3.13, R-A1, G-C2).
//
// § 12 Abs. 1 Satz 2 HeizkostenV erlaubt dem Mieter, seinen Anteil an den Heizkosten zu kürzen, wenn
// Geräte entgegen § 5 Abs. 2 oder 3 nicht fernablesbar sind. Ob das so ist, hängt am Gerät: Nach dem
// Stichtag eingebaute müssen es ab dem Einbau sein (§ 5 Abs. 2, `hkv.remote-reading.new-devices`),
// ältere ab dem Beginn von § 5 Abs. 3 (`hkv.remote-reading.retrofit`).
//
// Woher Mietfuchs das weiß, sagt die Anlage auf zwei Wegen: Zähler, die es kennt, tragen
// `remoteReadable` und `installedOn`; beim Messdienst und bei freien Schlüsseln kennt es die Geräte
// meist nicht, dann gilt die Angabe an der Anlage (G-C2). Diese Datei entscheidet nur; die Texte und
// Beträge stehen in calc.ts. Rechtszahlen stehen hier nicht (law-literals.test.ts).
import type { DevicesInstalledAfter, DevicesRemote, HeatingPlant, Meter, MeterType, Unit } from '../../shared/types.ts'
import { law, type LawLog, type Period } from '../../shared/law/register.ts'
import { hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit } from '../../shared/law/heizkostenv.ts'

// Wie sicher eine Kürzung ist:
//   required  ein Gerät ist nicht fernablesbar, obwohl es das in diesem Zeitraum sein muss
//   possible  es kann so sein; offen sind das Einbaudatum oder, bei einem Zeitraum, der den Beginn
//             von § 5 Abs. 3 nur berührt, die Rechtsfrage 15.1 Nr. 7: „bis zu“
//   unknown   Mietfuchs weiß nichts über die Geräte
//   fine      alle bekannten Geräte sind fernablesbar, oder keines muss es schon sein
export type RemoteLevel = 'required' | 'possible' | 'unknown' | 'fine'
const RANK: Record<RemoteLevel, number> = { fine: 0, unknown: 1, possible: 2, required: 3 }

export type RemotePlant = Pick<HeatingPlant, 'id' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'units'>
export type RemoteMeter = Pick<Meter, 'id' | 'unitId' | 'type' | 'heatingPlantId' | 'heatingRole' | 'remoteReadable' | 'installedOn'>
export type RemoteUnit = Pick<Unit, 'id' | 'noConnection'>
// `meterIds`: die Zähler, die zu dieser Stufe geführt haben; `byAnswer`: auch die Angabe an der Anlage.
export type RemoteVerdict = { level: RemoteLevel; meterIds: string[]; byAnswer: boolean }

// Die Gerätearten, die § 5 HeizkostenV erfasst: Zähler und Heizkostenverteiler für Heizung und
// Warmwasser. Der Versorgungszähler gehört dem Versorger und fällt nicht darunter.
const DEVICE_TYPES: readonly MeterType[] = ['waerme', 'warmwasser', 'hkv']

const top = (levels: readonly RemoteLevel[]): RemoteLevel => levels.reduce<RemoteLevel>((a, l) => (RANK[l] > RANK[a] ? l : a), 'fine')

// Die Erfassungsgeräte einer Anlage: Wärme-, Warmwasserzähler und Heizkostenverteiler der Wohnungen,
// die sie versorgt (ohne Liste alle ohne „kein Anschluss: Wärme“, #117), dazu ihre eigenen
// Wärmezähler.
export function plantDevices(plant: RemotePlant, meters: readonly RemoteMeter[], units: readonly RemoteUnit[]): RemoteMeter[] {
  const served = new Set(plant.units === null
    ? units.filter((u) => !(u.noConnection ?? []).includes('waerme')).map((u) => u.id)
    : plant.units.map((u) => u.unitId))
  return meters.filter((m) =>
    (m.unitId != null && served.has(m.unitId) && DEVICE_TYPES.includes(m.type)) ||
    (m.heatingPlantId === plant.id && m.heatingRole != null && m.heatingRole !== 'supply'))
}

// Ein Gerät, das nicht fernablesbar ist.
function deviceLevel(installedOn: string | null, period: Period, log: LawLog): RemoteLevel {
  // Erst nach dem Zeitraum eingebaut: In diesem Zeitraum gab es es noch nicht.
  if (installedOn !== null && installedOn > period.to) return 'fine'
  if (installedOn !== null && law(hkvRemoteReadingNewDevices, { date: installedOn }, log).required) return 'required'
  const retrofit = law(hkvRemoteReadingRetrofit, { period }, log).coverage
  if (retrofit === 'full') return 'required'
  // Ohne Einbaudatum kann es ein neues Gerät sein: „bis zu“ schon vor § 5 Abs. 3 (Entwurf 3.13).
  if (installedOn === null) return 'possible'
  return retrofit === 'partial' ? 'possible' : 'fine'
}

// Die Angabe an der Anlage: wie viele Geräte fernablesbar sind und wie viele nach dem Stichtag
// eingebaut wurden.
function answerLevel(remote: DevicesRemote, after: DevicesInstalledAfter, period: Period, log: LawLog): RemoteLevel {
  if (remote === 'unknown') return 'unknown'
  if (remote === 'all') return 'fine'
  // Sicher ist ein neues Gerät dabei, das nicht fernablesbar ist: alle neu, oder keines fernablesbar.
  if (after === 'all' || (after === 'some' && remote === 'none')) {
    if (law(hkvRemoteReadingNewDevices, { date: period.to }, log).required) return 'required'
    if (after === 'all') return 'fine'
  }
  const retrofit = law(hkvRemoteReadingRetrofit, { period }, log).coverage
  if (retrofit === 'full') return 'required'
  if (after === 'none') return retrofit === 'partial' ? 'possible' : 'fine'
  return 'possible'
}

export function plantVerdict(plant: RemotePlant, meters: readonly RemoteMeter[], units: readonly RemoteUnit[], period: Period, log: LawLog): RemoteVerdict {
  const answer = answerLevel(plant.devicesRemote, plant.devicesInstalledAfter2021, period, log)
  const devices = plantDevices(plant, meters, units).map((m) => ({
    id: m.id,
    level: m.remoteReadable === true ? ('fine' as const) : m.remoteReadable === false ? deviceLevel(m.installedOn ?? null, period, log) : ('unknown' as const),
  }))
  // Neben einer Angabe an der Anlage zählen nur Geräte, deren Fernablesbarkeit eingetragen ist; ohne
  // Angabe entscheiden die Geräte allein, und ohne Geräte bleibt es unbekannt.
  const candidates: RemoteLevel[] = answer === 'unknown'
    ? (devices.length > 0 ? devices.map((d) => d.level) : ['unknown'])
    : [answer, ...devices.map((d) => d.level).filter((l) => l !== 'unknown')]
  const level = top(candidates)
  return {
    level,
    meterIds: level === 'required' || level === 'possible' ? devices.filter((d) => d.level === level).map((d) => d.id) : [],
    byAnswer: answer === level,
  }
}

// Über alle Anlagen des Objekts: das Schwerere gilt. `null` ohne Anlage; dann bleibt es beim
// Hinweis aus PR 1.
export function remoteReadingVerdict(plants: readonly RemotePlant[], meters: readonly RemoteMeter[], units: readonly RemoteUnit[], period: Period, log: LawLog): RemoteVerdict | null {
  if (plants.length === 0) return null
  const verdicts = plants.map((p) => plantVerdict(p, meters, units, period, log))
  const level = top(verdicts.map((v) => v.level))
  const atLevel = verdicts.filter((v) => v.level === level)
  return { level, meterIds: [...new Set(atLevel.flatMap((v) => v.meterIds))], byAnswer: atLevel.some((v) => v.byAnswer) }
}
