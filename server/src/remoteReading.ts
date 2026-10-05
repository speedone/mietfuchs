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
import type { HeatingPlant, Meter, MeterType, Unit } from '../../shared/types.ts'
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

export type RemotePlant = Pick<HeatingPlant, 'id' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'newDevicesInstall' | 'units'>
export type RemoteMeter = Pick<Meter, 'id' | 'unitId' | 'type' | 'heatingPlantId' | 'heatingRole' | 'remoteReadable' | 'installedOn'>
export type RemoteUnit = Pick<Unit, 'id' | 'noConnection'>
// `meterIds`: die Zähler, die zu dieser Stufe geführt haben; `byAnswer`: auch die Angabe an der Anlage;
// `askInstall`: „möglich“ hängt an der unbeantworteten Frage, ob einzeln ersetzt oder als Ganzes neu.
export type RemoteVerdict = { level: RemoteLevel; meterIds: string[]; byAnswer: boolean; askInstall: boolean }

// Die Gerätearten, die § 5 HeizkostenV erfasst: Zähler und Heizkostenverteiler für Heizung und
// Warmwasser. Der Versorgungszähler gehört dem Versorger und fällt nicht darunter.
const DEVICE_TYPES: readonly MeterType[] = ['waerme', 'warmwasser', 'hkv']

const top = (levels: readonly RemoteLevel[]): RemoteLevel => levels.reduce<RemoteLevel>((a, l) => (RANK[l] > RANK[a] ? l : a), 'fine')

// Die Erfassungsgeräte einer Anlage: Wärme-, Warmwasserzähler und Heizkostenverteiler der Wohnungen,
// die sie versorgt (ohne Liste alle ohne „kein Anschluss: Wärme“, #117), dazu ihre eigenen
// Wärmezähler.
export function plantDevices(plant: RemotePlant, meters: readonly RemoteMeter[], units: readonly RemoteUnit[]): RemoteMeter[] {
  const served = servedUnitIds([plant], units)
  return meters.filter((m) =>
    (m.unitId != null && served.has(m.unitId) && DEVICE_TYPES.includes(m.type)) ||
    (m.heatingPlantId === plant.id && m.heatingRole != null && m.heatingRole !== 'supply'))
}

// Die Wohnungen, die die Anlagen versorgen: ohne Liste alle ohne „kein Anschluss: Wärme“ (#117).
export function servedUnitIds(plants: readonly Pick<RemotePlant, 'units'>[], units: readonly RemoteUnit[]): Set<string> {
  const all = units.filter((u) => !(u.noConnection ?? []).includes('waerme')).map((u) => u.id)
  return new Set(plants.flatMap((p) => (p.units === null ? all : p.units.map((u) => u.unitId))))
}

// Wie ein nicht fernablesbares Gerät nach dem Stichtag eingebaut wurde (§ 5 Abs. 2 HeizkostenV):
//   whole    als Ganzes neu, oder Satz 4 ist ausgeschlossen: Satz 1 gilt ab dem Einbau
//   single   einzeln als Ersatz oder Ergänzung in ein nicht fernablesbares System: Satz 4, dann die
//            Frist des Abs. 3
//   unknown  offen; vor dieser Frist heißt es „möglich“, und der Hinweis nennt die Frage
type InstallMode = 'whole' | 'single' | 'unknown'

type Judged = { level: RemoteLevel; ask: boolean }

// Ein Gerät, das nicht fernablesbar ist (Durchsicht und Nachprüfung von #230).
function deviceLevel(installedOn: string | null, mode: InstallMode, period: Period, log: LawLog): Judged {
  // Erst nach dem Zeitraum eingebaut: In diesem Zeitraum gab es es noch nicht.
  if (installedOn !== null && installedOn > period.to) return { level: 'fine', ask: false }
  const isNew = installedOn !== null && law(hkvRemoteReadingNewDevices, { date: installedOn }, log).required
  if (isNew && mode === 'whole') return { level: 'required', ask: false }
  const retrofit = law(hkvRemoteReadingRetrofit, { period }, log).coverage
  if (retrofit === 'full') return { level: 'required', ask: false }
  // Ohne Einbaudatum kann es ein neues Gerät sein: „bis zu“ schon vor § 5 Abs. 3 (Entwurf 3.13).
  if (installedOn === null) return { level: 'possible', ask: false }
  // Ein neues Gerät, das ein Ersatz nach Satz 4 ist oder sein kann.
  if (isNew) return { level: 'possible', ask: mode === 'unknown' }
  return { level: retrofit === 'partial' ? 'possible' : 'fine', ask: false }
}

// Die Angabe an der Anlage: wie viele Geräte fernablesbar sind, wie viele nach dem Stichtag
// eingebaut wurden und, für diese, ob einzeln oder als Ganzes.
function answerLevel(plant: RemotePlant, period: Period, log: LawLog): Judged {
  const { devicesRemote: remote, devicesInstalledAfter2021: after, newDevicesInstall: install } = plant
  if (remote === 'unknown') return { level: 'unknown', ask: false }
  if (remote === 'all') return { level: 'fine', ask: false }
  const retrofit = law(hkvRemoteReadingRetrofit, { period }, log).coverage
  if (retrofit === 'full') return { level: 'required', ask: false }
  // Ob es in diesem Zeitraum schon Geräte gibt, die nach dem Stichtag eingebaut wurden.
  const newOnes = after !== 'none' && law(hkvRemoteReadingNewDevices, { date: period.to }, log).required
  // Sicher ist ein neues, nicht fernablesbares Gerät dabei: keines fernablesbar und einige oder alle
  // neu, oder einige fernablesbar und alle neu.
  const sureNew = newOnes && ((remote === 'none' && (after === 'all' || after === 'some')) || (remote === 'partial' && after === 'all'))
  if (sureNew) {
    if (install === 'whole') return { level: 'required', ask: false }
    if (install === 'single') return { level: 'possible', ask: false }
    // Unbeantwortet. Sind einige fernablesbar und alle neu, schließt das den Ersatz in ein durchweg
    // nicht fernablesbares System aus (wie bisher). Sonst kann jedes neue Gerät einzeln ersetzt sein.
    if (remote === 'partial') return { level: 'required', ask: false }
    return { level: 'possible', ask: true }
  }
  if (retrofit === 'partial') return { level: 'possible', ask: false }
  // Vielleicht ein neues, nicht fernablesbares Gerät: „möglich“.
  if (newOnes) return { level: 'possible', ask: install === null }
  return { level: 'fine', ask: false }
}

export function plantVerdict(plant: RemotePlant, meters: readonly RemoteMeter[], units: readonly RemoteUnit[], period: Period, log: LawLog): RemoteVerdict {
  const answer = answerLevel(plant, period, log)
  const known = plantDevices(plant, meters, units)
  // Versorgt die Anlage Wohnungen, an denen Mietfuchs kein Gerät kennt, kann es dort weitere,
  // nicht fernablesbare geben.
  const recorded = new Set(known.map((m) => m.unitId).filter((u): u is string => typeof u === 'string'))
  const unrecorded = [...servedUnitIds([plant], units)].some((u) => !recorded.has(u))
  // Wie ein neues Gerät eingebaut wurde: die Antwort an der Anlage; sonst schließen fernablesbare
  // Mitgeräte (laut Anlage oder bekannt) den Ersatz nach Satz 4 aus. Allein bekannt und ohne weitere
  // Wohnungen ohne Gerät bleibt es sicher (R-A1); mit solchen ist es offen.
  const modeOf = (id: string): InstallMode => {
    if (plant.newDevicesInstall !== null) return plant.newDevicesInstall
    if (plant.devicesRemote === 'none') return 'unknown'
    if (plant.devicesRemote === 'all' || plant.devicesRemote === 'partial') return 'whole'
    const others = known.filter((o) => o.id !== id && typeof o.remoteReadable === 'boolean')
    if (others.length > 0) return others.every((o) => o.remoteReadable === false) ? 'unknown' : 'whole'
    return unrecorded ? 'unknown' : 'whole'
  }
  const devices = known.map((m) => ({
    id: m.id,
    ...(m.remoteReadable === true
      ? { level: 'fine' as const, ask: false }
      : m.remoteReadable === false ? deviceLevel(m.installedOn ?? null, modeOf(m.id), period, log) : { level: 'unknown' as const, ask: false }),
  }))
  // Neben einer Angabe an der Anlage zählen nur Geräte, deren Fernablesbarkeit eingetragen ist; ohne
  // Angabe entscheiden die Geräte allein, und ohne Geräte bleibt es unbekannt.
  const counted = answer.level === 'unknown' ? devices : devices.filter((d) => d.level !== 'unknown')
  const candidates: RemoteLevel[] = answer.level === 'unknown'
    ? (devices.length > 0 ? devices.map((d) => d.level) : ['unknown'])
    : [answer.level, ...counted.map((d) => d.level)]
  const level = top(candidates)
  const ask = level === 'possible' &&
    ((answer.level === 'possible' && answer.ask) || counted.some((d) => d.level === 'possible' && d.ask))
  return {
    level,
    meterIds: level === 'required' || level === 'possible' ? devices.filter((d) => d.level === level).map((d) => d.id) : [],
    byAnswer: answer.level === level,
    askInstall: ask,
  }
}

// Über alle Anlagen des Objekts: das Schwerere gilt. `null` ohne Anlage; dann bleibt es beim
// Hinweis aus PR 1.
export function remoteReadingVerdict(plants: readonly RemotePlant[], meters: readonly RemoteMeter[], units: readonly RemoteUnit[], period: Period, log: LawLog): RemoteVerdict | null {
  if (plants.length === 0) return null
  const verdicts = plants.map((p) => plantVerdict(p, meters, units, period, log))
  const level = top(verdicts.map((v) => v.level))
  const atLevel = verdicts.filter((v) => v.level === level)
  return {
    level,
    meterIds: [...new Set(atLevel.flatMap((v) => v.meterIds))],
    byAnswer: atLevel.some((v) => v.byAnswer),
    askInstall: atLevel.some((v) => v.askInstall),
  }
}
