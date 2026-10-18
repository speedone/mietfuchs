// Die Einrichtung „Heizung“ in den Stammdaten (Heizung PR 4, Entwurf 11.2), ohne DOM prüfbar
// (heatingForm.test.ts). Gefragt wird in der Reihenfolge des Entwurfs: womit geheizt wird
// (Schritt 1), wer die Heizkostenabrechnung erstellt (2), welche Wohnungen angeschlossen sind (4),
// ob die Geräte aus der Ferne ablesbar sind (5) und bei einer Wärmepumpe, seit wann ihr Verbrauch
// erfasst wird (6). Schritt 3 (eigener Zeitraum) kommt mit Heizung PR 5. Schritt 7 (eigene
// Abrechnung, Heizung PR 10) steht in heatingSelfForm.ts: Wer „Ich selbst“ wählt, legt die Anlage hier
// zunächst bei „Niemand“ an, und Schritt 7 stellt sie in einer Transaktion um (Abweichung 21 des Plans).
// Nichts davon ändert eine Zahl der Abrechnung.
import type { DevicesInstalledAfter, DevicesRemote, DhwMethod, HeatGeneration, HeatPumpMajority, HeatingEnergy, HeatingPeriodView, HeatingPlant, HeatingPlantUnit, HeatingStatement, Meter, NewDevicesInstall, PreviousSupply, PropertyKind, Unit } from './types'
import { isStockEnergy } from '../../shared/fuelStock.ts'
import { billingEnergy, CONTRACTING_ENERGIES, isHeatDelivery } from '../../shared/heatDelivery.ts'
import { parseEuro } from './api'
import { hkvConsumptionShare, hkvCutNotByConsumption, hkvHeatPumpCapture, hkvRemoteReadingNewDevices, hkvRenewableExemption } from '../../shared/law/heizkostenv.ts'
import { dayAfter, germanDate, LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { co2SelfSupply, halfSplitEnactedOn } from '../../shared/law/co2kostaufg.ts'
import { lineRoot, sameLine } from '../../shared/heatingPeriod.ts'
import { parseMeterValue } from './tenantChange'
import { ambiguousText, ambiguousThousands, parseNumberDe } from './numbers'

// Rechtszahlen aus dem Register, in der Fassung von heute (wie Lexikon und Anleitungen).
const SHARE = valueAt(hkvConsumptionShare, LAW_AS_OF)
const CUT = valueAt(hkvCutNotByConsumption, LAW_AS_OF)
export const NEW_DEVICES_AFTER = germanDate(valueAt(hkvRemoteReadingNewDevices, LAW_AS_OF).installedAfter)
// § 12 Abs. 3 Satz 1 HeizkostenV: der Stichtag der Wärmepumpen aus dem Register (Heizung PR 10, Abweichung 1).
const HEAT_PUMP_CAPTURED_BY = valueAt(hkvHeatPumpCapture, LAW_AS_OF).capturedBy
export const NEWER_THAN = germanDate(HEAT_PUMP_CAPTURED_BY)

export type EnergyAnswer = HeatingEnergy | 'perUnit'
export type PerUnitContract = '' | 'tenant' | 'landlord'
// Wer den Brennstoff einer zentralen Heizung bezieht (Heizung PR 19, #97): der Vermieter, ein Mieter, der alle
// angeschlossenen Wohnungen gemietet hat, oder ein Mieter, über dessen Vertrag auch andere Wohnungen versorgt werden.
export type FuelContract = 'landlord' | 'tenantAll' | 'tenantOthers'
// `supplier` (#225): Der Wärmelieferant rechnet unmittelbar mit den Mietern ab; dann entsteht keine Anlage.
export type WhoSettles = '' | 'service' | 'homeowners' | 'self' | 'manual' | 'supplier'
export type CaptureAnswer = 'unknown' | 'yes' | 'no' | 'newer'

export type HeatingForm = {
  energy: EnergyAnswer | ''
  contract: PerUnitContract
  // Heizung PR 19: nur bei einer neuen zentralen Anlage mit Gas, Öl, Flüssiggas oder Kohle gefragt (`asksFuelContract`);
  // Voreinstellung „Ich“, wie bisher.
  fuelContract: FuelContract
  who: WhoSettles
  unitIds: string[]
  remote: DevicesRemote
  installedAfter: DevicesInstalledAfter
  newInstall: NewDevicesInstall | ''
  captured: CaptureAnswer
  captureInstalledOn: string
  // Wärmepumpe erst nach dem Stichtag eingebaut (Heizung PR 10): ihr Einbaudatum.
  heatPumpInstalledOn: string
  warmRentAverage: string
  // Heizung PR 9: Name der Anlage (Pflicht ab der zweiten), Energie der Etagenheizungen und die Namen
  // der bisherigen Anlagen, die beim Anlegen der zweiten noch keinen Namen oder keine Liste haben.
  name: string
  perUnitEnergy: HeatingEnergy | ''
  otherNames: Record<string, string>
  // Recht I3 der Durchsicht von #238: im selben Gebäude wie eine andere Anlage (deren Kennung), in einem
  // eigenen (`'own'`) oder noch nicht beantwortet (`''`). Keine Vorbelegung.
  building: string
  // Etagenheizung: Hat jede Wohnung einen eigenen Gaszähler? Ohne ihn gibt es keine Rechnung je Wohnung.
  ownMeters: boolean
  // Nach einem Kesseltausch mit demselben Vorratsbrennstoff (Nachprüfung von #238): Verheizt die neue Anlage
  // den Brennstoff im Tank weiter? `''`: nicht gefragt.
  takesOverStock: '' | 'yes' | 'no'
  // Heizung PR 11 (Durchsicht von #240, Recht-I1/I2): ob die Anlage die Wärme allein erzeugt, und bei einer
  // Wärmepumpe, ob sie mehr als die Hälfte der Wärme des Gebäudes liefert. Keine Vorbelegung.
  generation: HeatGeneration | ''
  majority: HeatPumpMajority | ''
  // Wärmelieferung (Heizung PR 16, #213): Contracting und die Angaben zur Umstellung während laufender Mietverhältnisse.
  contracting: boolean
  deliverySince: string
  previousSupply: '' | PreviousSupply
  announcedOn: string
}

// Was die Einrichtung schickt. Die übrigen Felder der Anlage behalten ihre Vorgabe.
export type HeatingPlantBody = Pick<
  HeatingPlant,
  'energy' | 'supply' | 'method' | 'source' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'capturedOnOct2024' | 'captureInstalledOn' | 'warmRentAverageCents' | 'units' | 'newDevicesInstall' | 'name' | 'buildingWith'
  | 'contracting' | 'heatDeliverySince' | 'previousSupply' | 'switchAnnouncedOn'
> & Partial<Pick<HeatingPlant, 'heatPumpInstalledOn' | 'heatGeneration' | 'heatPumpMajority'>> & { takesOverStock?: boolean }
// Name und Wohnungen einer bisherigen Anlage, die mit dem Anlegen geändert werden (Heizung PR 9).
export type AdjustRow = { id: string; name: string; units: HeatingPlantUnit[] }
// `none`: Es entsteht bewusst keine Anlage, und der Satz sagt warum. Heizt der Mieter selbst (Heizung PR 19), stehen
// dabei die Wohnungen, deren Mietverhältnisse die Karte auf „Mieter heizt selbst“ stellen kann (`selfSupplyOffer`), und
// ob es eine zentrale Heizung ist (dann muss es ein einziger Mieter sein).
// `setUpSelf`: „Ich selbst“ gewählt; nach dem Speichern folgt Schritt 7 (Heizung PR 10).
// `singleTenant`: Das Angebot verlangt einen einzigen Mieter (zentrale Heizung mit Brennstoff des Mieters); ohne Angabe wie `central`.
export type HeatingResult = { body: HeatingPlantBody; adjust: AdjustRow[]; setUpSelf?: boolean } | { error: string } | { none: string; selfSupplyUnitIds: string[]; central: boolean; singleTenant?: boolean }

type UnitInfo = Pick<Unit, 'id' | 'noConnection'>

export const ENERGY_OPTIONS: { value: EnergyAnswer; label: string }[] = [
  { value: 'gas', label: 'Gas' },
  { value: 'oil', label: 'Öl' },
  { value: 'lpg', label: 'Flüssiggas' },
  { value: 'districtHeating', label: 'Fernwärme' },
  { value: 'heatPump', label: 'Wärmepumpe' },
  { value: 'pellets', label: 'Pellets' },
  { value: 'wood', label: 'Holz (Scheitholz, Hackschnitzel)' },
  { value: 'electric', label: 'Strom (Nachtspeicher, Elektroheizung)' },
  { value: 'coal', label: 'Kohle' },
  { value: 'other', label: 'Etwas anderes' },
  { value: 'perUnit', label: 'Jede Wohnung hat eine eigene Heizung' },
]

export const CONTRACT_OPTIONS: { value: Exclude<PerUnitContract, ''>; label: string }[] = [
  { value: 'tenant', label: 'Der Mieter hat den Vertrag, etwa für die Gastherme' },
  { value: 'landlord', label: 'Ich habe den Vertrag und lege die Kosten um' },
]

// Heizung PR 19 (#97, Prüfung M1): die Frage nach dem Liefervertrag einer zentralen Heizung. Wer den Brennstoff
// über einen eigenen Vertrag bezieht, versorgt sich selbst mit Wärme, auch bei einer zentralen Anlage (§ 2 Abs. 1,
// § 6 Abs. 2 CO2KostAufG; BT-Drs. 20/3172, S. 29, 34).
export const FUEL_CONTRACT_QUESTION = 'Wer hat den Liefervertrag für den Brennstoff?'
export const FUEL_CONTRACT_OPTIONS: { value: FuelContract; label: string }[] = [
  { value: 'landlord', label: 'Ich, und ich lege die Kosten um' },
  { value: 'tenantAll', label: 'Der Mieter, der alle angeschlossenen Wohnungen gemietet hat' },
  { value: 'tenantOthers', label: 'Ein Mieter, und über seinen Vertrag werden auch Wohnungen anderer versorgt' },
]
// Gefragt nur bei einer neuen zentralen Anlage mit einem Brennstoff, den ein Mieter selbst kaufen kann und für den
// das CO2KostAufG gilt; beim Ändern einer Anlage steht schon fest, dass Sie den Brennstoff beziehen.
const SELF_SUPPLY_FUELS: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg', 'coal']
export const asksFuelContract = (form: Pick<HeatingForm, 'energy' | 'contracting'>, editingId: string | null): boolean =>
  editingId === null && form.energy !== '' && form.energy !== 'perUnit' && SELF_SUPPLY_FUELS.includes(billingEnergy({ energy: form.energy, contracting: form.contracting }))
// Abdeckung V27: Beim Ändern fragt die Karte nicht mehr nach dem Liefervertrag. Wer eine zentrale Heizung als Anlage
// angelegt hat, deren Brennstoff ein Mieter bezieht, bekommt sonst nur den Fehler `co2.self-supply-mixed`; die Karte
// sagt den Weg schon hier.
export const editFuelContractNote = (form: Pick<HeatingForm, 'energy' | 'contracting'>, editingId: string | null): string | null =>
  editingId !== null && form.energy !== '' && form.energy !== 'perUnit' && SELF_SUPPLY_FUELS.includes(billingEnergy({ energy: form.energy, contracting: form.contracting }))
    ? 'Hat ein Mieter den Liefervertrag für den Brennstoff dieser Heizung, legen Sie dafür keine Heizanlage an: Klicken Sie unter der Anlage auf ' +
      '„Entfernen …“ (die Heizpositionen bleiben, nur ohne Anlage), dann auf „Heizung einrichten“, und wählen Sie bei „Wer hat den Liefervertrag für den Brennstoff?“ ' +
      '„Der Mieter, der alle angeschlossenen Wohnungen gemietet hat“.'
    : null

// Womit Etagenheizungen auf Vertrag des Vermieters heizen können (Heizung PR 9). Ohne Vorratsenergien:
// Der Vorrat wird je Heizanlage geführt, nicht je Wohnung.
// Fernwärme bis in die Wohnung ist eine Wärmelieferung, keine Etagenheizung (§ 1 Abs. 1 Nr. 2 HeizkostenV).
export const PER_UNIT_ENERGY_OPTIONS: { value: HeatingEnergy; label: string }[] = ENERGY_OPTIONS.flatMap((o) =>
  o.value !== 'perUnit' && o.value !== 'districtHeating' && !isStockEnergy(o.value) ? [{ value: o.value, label: o.label }] : [],
)

// Die Antworten auf die Frage nach dem Gebäude: jede andere laufende Anlage oder ein eigenes Gebäude.
// `current`: die gespeicherte Antwort. Zeigt sie auf eine stillgelegte Anlage (Kesseltausch), steht dort die
// laufende Anlage ihrer Linie, mit der gespeicherten Kennung als Wert; so ist das Angezeigte das Gespeicherte
// (Nachprüfung von #238).
export const buildingOptions = (others: readonly Pick<HeatingPlant, 'id' | 'name' | 'endsOn' | 'replacesPlantId'>[], names: Record<string, string> = {}, current = ''): { value: string; label: string }[] => {
  const stored = others.find((p) => p.id === current && p.endsOn !== null)
  const heir = stored ? others.find((p) => p.endsOn === null && sameLine(p, stored, others)) : undefined
  return [
    ...others.filter((p) => p.endsOn === null).map((p) => ({ value: p.id === heir?.id ? current : p.id, label: `Ja, im selben Gebäude wie „${(names[p.id] ?? p.name).trim() || 'die bisherige Heizanlage'}“` })),
    { value: 'own', label: 'Nein, in einem anderen Gebäude' },
  ]
}

// Kesseltausch mit demselben Vorratsbrennstoff (Nachprüfung von #238): die Frage und ihre Antworten.
export const TAKES_OVER_QUESTION = 'Verheizt der neue Kessel den Brennstoff im Tank weiter?'
export const TAKES_OVER_OPTIONS: { value: 'yes' | 'no'; label: string }[] = [
  { value: 'yes', label: 'Ja, der Restbestand ist der Anfangsbestand der neuen Heizanlage' },
  { value: 'no', label: 'Nein, der Restbestand bleibt bei Ihnen (etwa verkauft oder abgepumpt)' },
]
export const TAKES_OVER_HINT = 'Mit „Nein“ tragen die Mieter den Restbestand nicht; er steht mit seinem Wert bei Ihrem Anteil, und Sie tragen bei der neuen Heizanlage einen eigenen Anfangsbestand ein, wenn sie mit neuem Brennstoff beginnt. Stellen Sie später auf „Ja“ zurück, entfällt dieser eigene Anfangsbestand.'
// Zurück von „Nein“ auf „Ja“ leert der Server den eigenen Anfangsbestand der neuen Anlage in ihrer ersten
// Heizperiode (Nachprüfung von #238); die Oberfläche fragt vorher. `null`: keine Rückfrage nötig.
export const TAKES_OVER_BACK = 'Der eigene Anfangsbestand der neuen Heizanlage in ihrer ersten Heizperiode wird dabei entfernt; ihr Anfangsbestand ist dann der Restbestand der bisherigen Heizanlage. Erfasste Lieferungen bleiben.'
export const takesOverBack = (plant: Pick<HeatingPlant, 'takesOverStock'> | undefined, form: Pick<HeatingForm, 'takesOverStock'>): boolean =>
  plant?.takesOverStock === false && form.takesOverStock === 'yes'

// Die Auswahl der Anlage an Kosten, Zählern und Lieferungen: erst ab zwei Anlagen. Eine stillgelegte
// Anlage (Kesseltausch) nennt ihren letzten Betriebstag.
export const plantOptions = (plants: readonly Pick<HeatingPlant, 'id' | 'name' | 'endsOn'>[]): { value: string; label: string }[] =>
  plants.length < 2 ? [] : plants.map((p) => ({ value: p.id, label: p.endsOn ? `${p.name} (bis ${germanDate(p.endsOn)})` : p.name }))

// #225: Bei einer Wärmelieferung (Fernwärme oder Contracting) kann der Lieferant unmittelbar mit den Mietern abrechnen
// (§ 1 Abs. 3 HeizkostenV). Die Antwort gibt es nur beim Einrichten, denn sie legt keine Anlage an.
export const SUPPLIER_BILLS_LABEL = 'Der Wärmelieferant rechnet unmittelbar mit den Mietern ab'
export function whoOptions(kind: PropertyKind, form?: Pick<HeatingForm, 'energy' | 'contracting'>, editingId: string | null = null): { value: Exclude<WhoSettles, ''>; label: string }[] {
  const delivery = form !== undefined && editingId === null && form.energy !== '' && form.energy !== 'perUnit' &&
    billingEnergy({ energy: form.energy, contracting: form.contracting && asksContracting(form.energy) }) === 'districtHeating'
  const options: { value: Exclude<WhoSettles, ''>; label: string }[] = [
    { value: 'service', label: 'Ein Messdienst oder die Hausverwaltung' },
    { value: 'self', label: 'Ich selbst, mit Zählern oder Heizkostenverteilern' },
    { value: 'manual', label: 'Niemand, die Heizkosten werden nach Fläche oder fest verteilt' },
    ...(delivery ? [{ value: 'supplier' as const, label: SUPPLIER_BILLS_LABEL }] : []),
  ]
  // Bei einer vermieteten Eigentumswohnung liefert die Gemeinschaft die Abrechnung (Entwurf 11.2, D-F2).
  return kind === 'etw' ? [{ value: 'homeowners', label: 'Die Gemeinschaft (Hausverwaltung) rechnet ab' }, ...options] : options
}

export const REMOTE_OPTIONS: { value: DevicesRemote; label: string }[] = [
  { value: 'unknown', label: 'Weiß ich nicht' },
  { value: 'all', label: 'Ja, alle' },
  { value: 'partial', label: 'Nur einige' },
  { value: 'none', label: 'Nein' },
]

export const INSTALLED_OPTIONS: { value: DevicesInstalledAfter; label: string }[] = [
  { value: 'unknown', label: 'Weiß ich nicht' },
  { value: 'all', label: 'Ja, alle' },
  { value: 'some', label: 'Einige' },
  { value: 'none', label: 'Nein, alle früher' },
]

// Die Frage nach dem Einbau (§ 5 Abs. 2 Satz 1 und 4 HeizkostenV, Nachprüfung von #230). Sie zählt nur,
// wenn Geräte nach dem Stichtag eingebaut wurden und nicht alle fernablesbar sind.
// Sichtprüfung E10: kurz gefragt; was „einzeln“ und „als Ganzes“ bedeuten, sagen die Optionen und
// der Hilfetext darunter.
export const NEW_INSTALL_QUESTION = 'Wie wurden die nicht fernablesbaren Geräte eingebaut?'
export const NEW_INSTALL_OPTIONS: { value: NewDevicesInstall | ''; label: string }[] = [
  { value: '', label: 'Weiß ich nicht' },
  { value: 'single', label: 'Einzeln als Ersatz oder Ergänzung' },
  { value: 'whole', label: 'Das System wurde als Ganzes neu installiert' },
]
export const asksNewInstall = (form: Pick<HeatingForm, 'remote' | 'installedAfter'>): boolean =>
  (form.remote === 'none' || form.remote === 'partial') && form.installedAfter !== 'none'

export const CAPTURE_OPTIONS: { value: CaptureAnswer; label: string }[] = [
  { value: 'unknown', label: 'Weiß ich nicht' },
  { value: 'yes', label: 'Ja' },
  { value: 'no', label: 'Nein' },
  // Heizung PR 10 (Abweichung 1): eine Wärmepumpe, die erst danach eingebaut wurde, fällt nicht unter § 12 Abs. 3.
  { value: 'newer', label: `Die Wärmepumpe ist erst nach dem ${NEWER_THAN} eingebaut worden` },
]

const SELF_HINT = 'Sie lesen Wärmezähler und Warmwasserzähler jeder Wohnung ab, und Mietfuchs verteilt nach der Heizkostenverordnung. Nach dem Anlegen fragt Mietfuchs nach Warmwasser, Erfassung und dem Anteil nach Verbrauch; bis dahin ändert sich an keiner Zahl etwas.'
// Heizt der Mieter selbst (Heizung PR 19, Entwurf 11.2 Schritt 1, Prüfung S1): der Anspruch nach § 6 Abs. 2
// CO2KostAufG mit den Fristen aus dem Register, Verrechnen nur bei vereinbarter Vorauszahlung (Satz 4) und die
// Hinweispflicht (Satz 6).
const SELF = valueAt(co2SelfSupply, LAW_AS_OF)
const REFUND_TEXT =
  `Der Mieter kann den Anteil seiner CO₂-Kosten, den nach dem Stufenmodell Sie tragen, binnen ${SELF.claimMonths} Monaten nach der Abrechnung seines Lieferanten in Textform von Ihnen verlangen (§ 6 Abs. 2 CO2KostAufG). ` +
  'Erfassen Sie seine Anzeige auf der Seite Kosten unter „CO₂-Erstattung“. Ist eine Vorauszahlung auf Betriebskosten vereinbart, können Sie den Betrag in der nächsten Betriebskostenabrechnung nach der Anzeige verrechnen; ' +
  `sonst zahlen Sie ihn spätestens ${SELF.refundMonths} Monate nach der Anzeige aus. ` +
  `Bei Abschluss eines Mietvertrags ab dem ${germanDate(halfSplitEnactedOn())} und beim Einbau einer Heizung nach § 43 GModG müssen Sie den Mieter in Textform auf den Erstattungsanspruch und auf die Pflicht nach § 43 Abs. 1 GModG hinweisen (§ 6 Abs. 2 Satz 6).`
const SELF_SUPPLY = `Hat jeder Mieter einen eigenen Vertrag für seine Heizung, gibt es keine Heizkostenabrechnung des Hauses, und Mietfuchs legt keine Heizanlage an. ${REFUND_TEXT}`
// Zentrale Heizung, Brennstoffvertrag beim Mieter (Prüfung M1, S7): keine Anlage, denn der Vermieter bezieht weder
// Brennstoff noch Wärme. Was ihm für die Anlage selbst entsteht, legt er um wie vereinbart (§ 2 Nr. 4 a BetrKV).
const CENTRAL_SELF_SUPPLY =
  'Bezieht der Mieter den Brennstoff der zentralen Heizung über einen eigenen Vertrag, versorgt er sich selbst mit Wärme: Es gibt keine Heizkostenabrechnung des Hauses, und Mietfuchs legt keine Heizanlage an. ' +
  'Was Ihnen für die Heizung selbst entsteht, etwa Wartung, Messungen nach dem Immissionsschutzrecht oder Betriebsstrom über Ihren Zähler, erfassen Sie auf der Seite Kosten unter „Heizung und Warmwasser“ und legen es wie vereinbart um (§ 2 Nr. 4 a BetrKV). ' +
  `Läuft der Betriebsstrom über Ihren Allgemeinstrom, gehört sein Anteil zur Heizung und nicht zum Allgemeinstrom. ${REFUND_TEXT}`
// Gegenprüfung M1 (abgeschwächt): Liefert ein Mieter über seinen Vertrag auch an Dritte, rechnet Mietfuchs nicht.
// #225: § 1 Abs. 3 und § 11 Abs. 1 Nr. 4 HeizkostenV; der Mieter bezieht die Wärme über einen eigenen Vertrag und versorgt
// sich damit selbst (§ 6 Abs. 2 Satz 3 CO2KostAufG nennt den Wärmelieferanten ausdrücklich).
const SUPPLIER_BILLS =
  'Rechnet der Wärmelieferant unmittelbar mit den Mietern ab, legt Mietfuchs keine Heizanlage an. ' +
  'Legt er dabei die Anteile der Mieter am Gesamtverbrauch zugrunde und nicht den für jede Wohnung gemessenen Verbrauch, gelten nach § 1 Abs. 3 HeizkostenV die Pflichten des Gebäudeeigentümers aus der Verordnung für ihn. ' +
  'Misst er den Verbrauch jeder Wohnung selbst und rechnet danach ab, gilt die Verordnung für diese Verteilung nicht. ' +
  'Im ersten Fall sind die Kosten der Hausanlagen, die nicht in den Kosten der Wärmelieferung enthalten sind und die Sie gesondert abrechnen, etwa Wartung oder Betriebsstrom der Heizung im Haus, von der Verteilung nach Verbrauch ausgenommen (§ 11 Abs. 1 Nr. 4 HeizkostenV). ' +
  `Erfassen Sie diese Kosten auf der Seite Kosten unter „Heizung und Warmwasser“ und legen Sie sie wie vereinbart um. ${REFUND_TEXT}`
const NOT_COVERED = 'Liefert ein Mieter über seinen Vertrag auch Wärme an andere Wohnungen, regeln Heizkostenverordnung und CO2KostAufG die Verteilung nicht ausdrücklich für diesen Fall. Mietfuchs rechnet das nicht; bitte klären Sie die Abrechnung gesondert.'

// Die Mietverhältnisse, die die Karte nach „Der Mieter hat den Vertrag“ auf „Mieter heizt selbst“ stellen kann: die am
// Tag `today` laufenden der angehakten Wohnungen, die es noch nicht sind. Bei der zentralen Heizung muss es ein
// einziger Mieter sein (gleicher Name, Auslegung zu § 5 Abs. 3 CO2KostAufG, Prüfung S5); sonst nicht abgedeckt.
// Nachprüfung N-3: `kindTenancyIds` sind die laufenden, die schon „Mieter heizt selbst“ sind, aber ohne Art; bei ihnen
// trägt die Karte die Art nach (ohne Rückfrage, am Modell ändert sich nichts). Eine andere Art bleibt stehen.
export function selfSupplyOffer(
  unitIds: readonly string[],
  tenancies: readonly { id: string; unitId: string; tenantName: string; start: string; end: string | null; heatingModel?: string; selfSupplyKind?: string | null }[],
  today: string,
  central: boolean,
  // #225: Bei unmittelbarer Abrechnung des Wärmelieferanten hat jeder Mieter seinen Vertrag; dann darf es mehrere geben.
  singleTenant: boolean = central,
): { tenancyIds: string[]; names: string[]; kindTenancyIds: string[] } | { error: string } {
  const running = tenancies.filter((t) => unitIds.includes(t.unitId) && t.start <= today && (t.end === null || t.end >= today))
  const names = [...new Set(running.map((t) => t.tenantName.trim()))]
  if (singleTenant && names.length > 1) return { error: NOT_COVERED }
  // Durchsicht S-4: Bei der zentralen Heizung ist jede angehakte Einheit ohne laufendes Mietverhältnis Wärme an Dritte:
  // die selbstgenutzte des Vermieters ebenso wie eine leere, die über den Vertrag des Mieters mitbeheizt wird.
  if (singleTenant && unitIds.some((id) => !running.some((t) => t.unitId === id))) return { error: NOT_COVERED }
  const open = running.filter((t) => t.heatingModel !== 'selfSupply')
  const kindless = running.filter((t) => t.heatingModel === 'selfSupply' && !t.selfSupplyKind)
  return { tenancyIds: open.map((t) => t.id), names: [...new Set(open.map((t) => t.tenantName.trim()))], kindTenancyIds: kindless.map((t) => t.id) }
}

// Der Satz unter der zweiten Frage.
// „Woran erkenne ich das?“ je Frage der Einrichtung (Entwurf 11.2, Laienprobe B9).
export const HOW_TO_TELL = {
  // Heizung PR 16 (Prüfung C-M5): Contracting ist der Brennstoff des Kessels mit dem Häkchen. Bestände, die dem früheren
  // Rat („Wärmelieferung: Fernwärme wählen“) gefolgt sind, bleiben Fernwärme und rechnen richtig, nur ohne Brennstoff.
  energy: 'Woran erkenne ich das? Am Brennstoff auf Ihrer Rechnung. Kommt die Wärme aus einem Wärmenetz, wählen Sie Fernwärme. Betreibt ein Lieferant den Kessel in Ihrem Haus und stellt Ihnen Wärme in Rechnung (Contracting), wählen Sie den Brennstoff des Kessels und setzen darunter das Häkchen „Ein Dritter betreibt die Heizung …“. Eine Wärmepumpe ist „Wärmepumpe“, nicht „Strom“; „Strom“ heißt Nachtspeicher- oder Elektroheizung.',
  who: 'Woran erkenne ich das? Bekommen Sie jedes Jahr eine Heizkostenabrechnung mit Beträgen je Wohnung, etwa von ista, Techem, Brunata, Minol oder KALO, wählen Sie „Ein Messdienst oder die Hausverwaltung“; das gilt auch für die Abrechnung einer Hausverwaltung. Gibt es keine Zähler oder Heizkostenverteiler in den Wohnungen, wählen Sie „Niemand“.',
  units: 'Woran erkenne ich das? Angeschlossen ist jede Wohnung, die von dieser Heizung warm wird. Eine Garage oder eine Wohnung mit eigener Gastherme gehört nicht dazu.',
  // Recht I5 der Durchsicht von #238: bei der Etagenheizung ein eigener Satz.
  unitsPerUnit: 'Haken Sie jede Wohnung an, deren Therme über Ihren Gasvertrag läuft. Wohnungen, deren Mieter einen eigenen Vertrag haben, gehören nicht dazu.',
  // Heizung PR 19: Mieter mit eigenem Vertrag.
  unitsSelfSupply: 'Haken Sie jede Wohnung an, deren Mieter den Vertrag selbst hat. Nach „Speichern“ bietet Mietfuchs an, die laufenden Mietverhältnisse dieser Wohnungen auf „Mieter heizt selbst“ zu stellen.',
  after: 'Den Zeitraum der Heizung stellen Sie nach dem Anlegen in dieser Karte mit „Zeitraum der Heizung ändern“ ein, wenn Ihr Messdienst nicht im Abrechnungszeitraum des Objekts abrechnet. Haupt- und Wärmezähler ordnen Sie auf der Seite Zähler der Heizung zu.',
} as const

// Laienprobe B8: Ohne Messdienst und eigene Ablesung gibt es keine Geräte, die aus der Ferne
// abzulesen wären; die beiden Fragen dazu entfallen dann, und die Zusammenfassung nennt sie nicht.
// #225 (Durchsicht PR #296, S2): Rechnet der Wärmelieferant ab, fragt die Karte nicht nach den Geräten.
export const asksRemote = (who: WhoSettles | HeatingPlant['method']): boolean => who !== 'manual' && who !== 'supplier'

export function whoHint(who: WhoSettles, kind: PropertyKind): string {
  if (who === 'supplier') return SUPPLIER_BILLS
  if (who === 'self') return SELF_HINT
  if (who === 'service') return 'Die Abrechnung des Messdienstes übernehmen Sie wie bisher als Position „Heizung und Warmwasser“ mit dem Schlüssel „Einzelbeträge“.'
  if (who === 'homeowners') return 'Die Abrechnung der Gemeinschaft übernehmen Sie wie die eines Messdienstes: als Position „Heizung und Warmwasser“ mit dem Schlüssel „Einzelbeträge“, mit den Beträgen der Hausgeldabrechnung.'
  if (who === 'manual') {
    const rule = `Die Heizkostenverordnung verlangt, ${SHARE.min} bis ${SHARE.max} % der Heizkosten nach Verbrauch zu verteilen; sonst darf jeder Mieter seinen Anteil um ${CUT} % kürzen. Mietfuchs rechnet wie bisher und sagt es in der Abrechnung.`
    return kind === 'zfh'
      ? `${rule} Im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, dürfen Sie mit dem Mieter etwas anderes vereinbaren (§ 2 HeizkostenV).`
      : rule
  }
  return ''
}

// „Alle Wohnungen“ heißt: alle ohne „kein Anschluss: Wärme“ (#117), wie beim Server ohne Liste.
export const defaultUnitIds = (units: readonly UnitInfo[]): string[] =>
  units.filter((u) => !(u.noConnection ?? []).includes('waerme')).map((u) => u.id)

// Die Wohnungen, an denen eine Anlage hängt; ohne Liste alle mit Anschluss an die Wärme.
const servedIds = (plant: Pick<HeatingPlant, 'units'>, units: readonly UnitInfo[]): string[] =>
  plant.units === null ? defaultUnitIds(units) : plant.units.map((u) => u.unitId)

export function emptyHeatingForm(units: readonly UnitInfo[], others: readonly HeatingPlant[] = []): HeatingForm {
  // Ab der zweiten Anlage beginnt die Liste mit den Wohnungen, die an keiner hängen (Heizung PR 9).
  const taken = new Set(others.flatMap((p) => servedIds(p, units)))
  return {
    energy: '', contract: '', fuelContract: 'landlord', who: '', unitIds: defaultUnitIds(units).filter((id) => !taken.has(id)), remote: 'unknown', installedAfter: 'unknown',
    captured: 'unknown', captureInstalledOn: '', heatPumpInstalledOn: '', warmRentAverage: '', newInstall: '',
    name: '', perUnitEnergy: '', building: '', ownMeters: false, takesOverStock: '', generation: '', majority: '',
    contracting: false, deliverySince: '', previousSupply: '', announcedOn: '', otherNames: Object.fromEntries(others.filter((p) => p.name.trim() === '' || p.units === null).map((p) => [p.id, p.name])),
  }
}

const centsText = (cents: number): string => (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function heatingToForm(plant: HeatingPlant, units: readonly UnitInfo[]): HeatingForm {
  const perUnit = plant.supply === 'perUnit'
  return {
    energy: perUnit ? 'perUnit' : plant.energy,
    contract: perUnit ? 'landlord' : '',
    fuelContract: 'landlord',
    who: plant.source === 'homeowners' ? 'homeowners' : plant.method,
    unitIds: servedIds(plant, units),
    remote: plant.devicesRemote,
    installedAfter: plant.devicesInstalledAfter2021,
    captured: plant.heatPumpInstalledOn !== null ? 'newer' : plant.capturedOnOct2024 === null ? 'unknown' : plant.capturedOnOct2024 ? 'yes' : 'no',
    captureInstalledOn: plant.captureInstalledOn ?? '',
    heatPumpInstalledOn: plant.heatPumpInstalledOn ?? '',
    warmRentAverage: plant.warmRentAverageCents === null ? '' : centsText(plant.warmRentAverageCents),
    newInstall: plant.newDevicesInstall ?? '',
    name: plant.name,
    perUnitEnergy: perUnit ? plant.energy : '',
    otherNames: {},
    building: plant.buildingWith ?? '',
    ownMeters: perUnit,
    takesOverStock: plant.takesOverStock === null ? '' : plant.takesOverStock ? 'yes' : 'no',
    generation: plant.heatGeneration ?? '',
    majority: plant.heatPumpMajority ?? '',
    contracting: plant.contracting,
    deliverySince: plant.heatDeliverySince ?? '',
    previousSupply: plant.previousSupply ?? '',
    announcedOn: plant.switchAnnouncedOn ?? '',
  }
}

// ---------- Wärmelieferung (Heizung PR 16, #213) ----------

// Prüfung R-S2: Maßgeblich ist der Mietvertrag (BGH VIII ZR 46/25 Rn. 30). Die Fälle, in denen § 556c nicht greift,
// weil die Mieter die Heizkosten nicht als Betriebskosten trugen oder schon vorher ein Lieferant versorgte, stehen beim
// neutralen Eintrag; der Text der Abrechnung ist dann bedingt.
export const PREVIOUS_SUPPLY_OPTIONS: { value: '' | PreviousSupply; label: string }[] = [
  { value: '', label: 'Keine Angabe oder anders (etwa Heizkosten in der Miete enthalten, oder schon vorher ein Wärmelieferant)' },
  { value: 'landlord', label: 'Ich, mit einer eigenen Heizung; die Mieter zahlten die Heizkosten als Betriebskosten' },
  { value: 'tenant', label: 'Die Mieter selbst, etwa mit Einzelöfen oder Gasthermen' },
]
export const CONTRACTING_LABEL = 'Ein Dritter betreibt die Heizung im Haus und liefert die Wärme (Contracting)'
export const SWITCH_HINT = 'Nur ausfüllen, wenn Sie umgestellt haben, während Mietverträge schon bestanden.'
// Contracting bei jeder zentralen Anlage außer Fernwärme, auch bei der Wärmepumpe (Prüfung R-M4).
export const asksContracting = (energy: HeatingForm['energy']): boolean => energy !== '' && energy !== 'perUnit' && CONTRACTING_ENERGIES.includes(energy)
// Die Angaben zur Umstellung bei Fernwärme oder Contracting.
// Bei „Lieferant rechnet ab“ (#225) entsteht keine Anlage; die Umstellung wird dann nicht gefragt.
export const asksSwitch = (form: Pick<HeatingForm, 'energy' | 'contracting'> & { who?: WhoSettles }): boolean =>
  form.who !== 'supplier' && (form.energy === 'districtHeating' || (form.contracting && asksContracting(form.energy)))

// Die Beschriftung des Energieträgers im Ausweis und in der Karte: bei Contracting mit dem Brennstoff des Lieferanten.
export function energyLabelOf(h: Pick<HeatingStatement, 'energy' | 'contracting' | 'fuelEnergy'>): string {
  const label = (e: HeatingEnergy): string => ENERGY_OPTIONS.find((o) => o.value === e)?.label ?? e
  return h.contracting === true && h.fuelEnergy !== undefined ? `Wärmelieferung (Contracting, erzeugt mit ${label(h.fuelEnergy)})` : label(h.energy)
}

// Contracting beim Kesseltausch an- oder abwählen (Prüfung C-M1): War die bisherige Anlage keine Wärmelieferung, ist der
// Tag des Tauschs als Tag der Umstellung vorgeschlagen.
export function contractingSwap(form: SwapForm, checked: boolean, previous: Pick<HeatingPlant, 'energy' | 'contracting'>): SwapForm {
  if (!checked) return { ...form, contracting: false, deliverySince: '', previousSupply: '', announcedOn: '' }
  const proposed = (form.deliverySince ?? '') === '' && !isHeatDelivery(previous) ? form.date : (form.deliverySince ?? '')
  return { ...form, contracting: true, deliverySince: proposed }
}

// `others`: die übrigen Anlagen des Objekts; `editingId`: die Anlage, die geändert wird (dann gibt es
// keine Anpassung anderer Anlagen, Heizung PR 9).
export function heatingPlantBody(form: HeatingForm, units: readonly UnitInfo[], others: readonly HeatingPlant[] = [], editingId: string | null = null): HeatingResult {
  if (form.energy === '') return { error: 'Bitte wählen Sie, womit geheizt wird.' }
  // Die Frage nach dem Gebäude (Recht I3 der Durchsicht von #238): beim Anlegen neben einer laufenden Anlage Pflicht.
  if (!editingId && others.some((p) => p.endsOn === null) && form.building === '') {
    return { error: 'Steht die neue Heizanlage im selben Gebäude wie eine bisherige? Bitte wählen Sie; im selben Gebäude stuft Mietfuchs die Anlagen für die CO₂-Aufteilung gemeinsam ein.' }
  }
  const several = others.length > 0
  const name = form.name.trim()
  if (several && name === '') {
    return { error: editingId ? 'Bitte geben Sie der Heizanlage einen Namen.' : 'Bitte geben Sie der neuen Heizanlage einen Namen, etwa „Haus B“ oder „Gastherme DG“.' }
  }
  const buildingWith = form.building === '' ? null : form.building
  // Die bisherigen Anlagen ohne Namen oder ohne Liste bekommen beides mit dem Anlegen (Review Focus 1).
  const adjust: AdjustRow[] = []
  if (!editingId) {
    for (const p of others.filter((x) => x.name.trim() === '' || x.units === null)) {
      const otherName = (form.otherNames[p.id] ?? p.name).trim()
      if (otherName === '') return { error: 'Bitte geben Sie auch der bisherigen Heizanlage einen Namen, etwa „Zentralheizung“.' }
      const rest = servedIds(p, units).filter((id) => !form.unitIds.includes(id))
      if (rest.length === 0) return { error: `An „${otherName}“ hinge dann keine Wohnung mehr. Ändern Sie stattdessen die bisherige Heizanlage.` }
      adjust.push({ id: p.id, name: otherName, units: rest.map((unitId) => ({ unitId, heatedAreaM2: null })) })
    }
  }
  const all = defaultUnitIds(units)
  const allServed = !several && form.unitIds.length === all.length && all.every((id) => form.unitIds.includes(id))
  const unitList = allServed ? null : form.unitIds.map((unitId) => ({ unitId, heatedAreaM2: null }))
  if (form.energy === 'perUnit') {
    if (form.contract === '') return { error: 'Wer hat den Vertrag für die Heizung in der Wohnung?' }
    if (form.contract === 'tenant') return { none: SELF_SUPPLY, selfSupplyUnitIds: form.unitIds, central: false }
    // Etagenheizung auf Vertrag des Vermieters (Heizung PR 9, § 5 Abs. 1 Satz 2 CO2KostAufG): Die
    // Rechnung jeder Wohnung wird ihr direkt zugeordnet.
    if (form.perUnitEnergy === '') return { error: 'Womit heizen die Etagenheizungen?' }
    if (!form.ownMeters) {
      return { error: 'Mietfuchs ordnet die Rechnung jeder Wohnung dieser Wohnung zu; dafür braucht jede einen eigenen Gaszähler mit eigener Rechnung. Teilen sich Wohnungen einen Zähler, erfasst Mietfuchs das noch nicht.' }
    }
    if (form.unitIds.length === 0) return { error: 'Bitte haken Sie mindestens eine Wohnung an, die eine solche Heizung hat.' }
    return {
      body: {
        name, buildingWith, energy: form.perUnitEnergy, supply: 'perUnit', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown',
        capturedOnOct2024: null, captureInstalledOn: null, warmRentAverageCents: null, units: unitList, newDevicesInstall: null,
        contracting: false, heatDeliverySince: null, previousSupply: null, switchAnnouncedOn: null,
      },
      adjust,
    }
  }
  const energy: HeatingEnergy = form.energy
  // Heizung PR 19: Bezieht ein Mieter den Brennstoff, entsteht keine Anlage.
  if (asksFuelContract(form, editingId) && form.fuelContract !== 'landlord') {
    if (form.fuelContract === 'tenantOthers') return { error: NOT_COVERED }
    if (form.unitIds.length === 0) return { error: 'Bitte haken Sie mindestens eine Wohnung an, die an dieser Heizung hängt.' }
    return { none: CENTRAL_SELF_SUPPLY, selfSupplyUnitIds: form.unitIds, central: true }
  }
  // #225: Jeder Mieter hat seinen Vertrag mit dem Lieferanten; die Anlage im Haus ist trotzdem zentral. Vor den Prüfungen
  // der Umstellung, denn die fragt die Karte dann nicht (Durchsicht PR #296, S2). Steht noch „Lieferant“ da, obwohl die
  // Energie keine Wärmelieferung mehr ist, gilt keine Antwort (das Auswahlfeld zeigt sie dann auch nicht).
  if (form.who === 'supplier' && whoOptions('mfh', form, editingId).some((o) => o.value === 'supplier')) {
    if (form.unitIds.length === 0) return { error: 'Bitte haken Sie mindestens eine Wohnung an, die an dieser Heizung hängt.' }
    return { none: SUPPLIER_BILLS, selfSupplyUnitIds: form.unitIds, central: true, singleTenant: false }
  }
  if (form.who === 'supplier' && editingId !== null) return { error: 'Rechnet der Wärmelieferant unmittelbar mit den Mietern ab, gehört dafür keine Heizanlage hierher. Entfernen Sie die Heizanlage und richten Sie die Heizung neu ein.' }
  // Heizung PR 16: Contracting und die Angaben zur Umstellung, nur wo gefragt; sonst leer, damit kein früherer Wert
  // stehen bleibt (der Server ergänzt nur, was im Rumpf steht).
  const contracting = form.contracting && asksContracting(form.energy)
  const sw = asksSwitch({ energy: form.energy, contracting })
  if (sw && form.announcedOn !== '' && form.deliverySince === '') {
    return { error: 'Eine Ankündigung ohne Tag der Umstellung lässt sich nicht prüfen. Bitte tragen Sie den Tag der Umstellung ein oder leeren Sie beide.' }
  }
  // Hier ist „Lieferant“ schon behandelt oder gilt nicht mehr (siehe oben).
  const who = form.who === 'supplier' ? '' : form.who
  if (who === '') return { error: 'Bitte wählen Sie, wer die Heizkostenabrechnung erstellt.' }
  if (form.unitIds.length === 0) return { error: 'Bitte haken Sie mindestens eine Wohnung an, die an dieser Heizung hängt.' }
  const heatPump = energy === 'heatPump'
  const averageText = heatPump ? form.warmRentAverage.trim() : ''
  const average = averageText === '' ? null : parseEuro(averageText)
  if (averageText !== '' && (average === null || average < 0)) {
    return { error: 'Bitte geben Sie die durchschnittlichen Heizkosten als Betrag ein, etwa 1.234,56.' }
  }
  // Abweichung 1 des Plans (Heizung PR 10): erst nach dem Stichtag eingebaut, dann das Einbaudatum statt der Erfassung.
  const installedText = heatPump && form.captured === 'newer' ? form.heatPumpInstalledOn : ''
  if (heatPump && form.captured === 'newer') {
    if (installedText === '') return { error: 'Bitte geben Sie das Einbaudatum der Wärmepumpe an.' }
    if (installedText <= HEAT_PUMP_CAPTURED_BY) {
      return { error: `Eine Wärmepumpe, die bis zum ${NEWER_THAN} eingebaut wurde, beantworten Sie mit „Ja“ oder „Nein“.` }
    }
  }
  return {
    setUpSelf: who === 'self',
    body: {
      energy,
      supply: 'central',
      // „Ich selbst“: zunächst „Niemand“; Schritt 7 stellt um (Abweichung 21).
      method: who === 'homeowners' ? 'service' : who === 'self' ? 'manual' : who,
      source: who === 'homeowners' ? 'homeowners' : 'building',
      devicesRemote: form.remote,
      devicesInstalledAfter2021: form.installedAfter,
      capturedOnOct2024: heatPump && (form.captured === 'yes' || form.captured === 'no') ? form.captured === 'yes' : null,
      captureInstalledOn: heatPump && form.captured === 'no' && form.captureInstalledOn !== '' ? form.captureInstalledOn : null,
      warmRentAverageCents: average,
      heatPumpInstalledOn: installedText === '' ? null : installedText,
      units: unitList,
      newDevicesInstall: asksNewInstall(form) && form.newInstall !== '' ? form.newInstall : null,
      name,
      buildingWith,
      ...(form.takesOverStock === '' ? {} : { takesOverStock: form.takesOverStock === 'yes' }),
      ...(asksGeneration(form) ? { heatGeneration: form.generation === '' ? null : form.generation } : {}),
      ...(heatPump ? { heatPumpMajority: form.majority === '' ? null : form.majority } : {}),
      contracting,
      heatDeliverySince: sw && form.deliverySince !== '' ? form.deliverySince : null,
      previousSupply: sw && form.previousSupply !== '' ? form.previousSupply : null,
      switchAnnouncedOn: sw && form.announcedOn !== '' ? form.announcedOn : null,
    },
    adjust,
  }
}

// ---------- Kessel getauscht (Heizung PR 9) ----------

// Heizung PR 16: Contracting und die Angaben zur Umstellung (`contractingSwap`); fehlen sie, fragt der Tausch nicht.
export type SwapForm = { date: string; energy: HeatingEnergy | ''; name: string; previousName: string; takesOverStock: 'yes' | 'no'; meterValues?: Record<string, string>
  contracting?: boolean; deliverySince?: string; previousSupply?: '' | PreviousSupply; announcedOn?: string }
export type SwapBody = { date: string; energy: HeatingEnergy; name: string; previousName: string; takesOverStock?: boolean; meterReadings?: { meterId: string; value: number }[]
  contracting?: boolean; heatDeliverySince?: string; previousSupply?: PreviousSupply; switchAnnouncedOn?: string }

// Bei der eigenen Heizkostenabrechnung fragt der Tausch die Stände der Zähler der Anlage (Wärme am
// Warmwasserspeicher, Gesamtwärme) am letzten Tag der bisherigen ab (Durchsicht von #239, I3): Mit ihnen
// grenzt Mietfuchs die Wärme beider Anlagen ab. Die Zähler bleiben, wo sie sind.
export const swapMetersOf = (plant: Pick<HeatingPlant, 'id' | 'method' | 'replacesPlantId'>, plants: readonly Pick<HeatingPlant, 'id' | 'replacesPlantId'>[], meters: readonly Meter[]): Meter[] => {
  if (plant.method !== 'self') return []
  const root = lineRoot(plant, plants)
  const line = new Set([plant.id, ...plants.filter((p) => lineRoot(p, plants) === root).map((p) => p.id)])
  return meters.filter((m) => m.heatingPlantId !== null && m.heatingPlantId !== undefined && line.has(m.heatingPlantId) && !!m.heatingRole)
}

// Bei demselben Vorratsbrennstoff fragt der Tausch, ob die neue Anlage den Brennstoff weiter verheizt.
// Bei Contracting führt der Lieferant den Vorrat (Heizung PR 16); dann fragt der Tausch nicht.
export const asksTakeOver = (form: Pick<SwapForm, 'energy'> & { contracting?: boolean }, previous: Pick<HeatingPlant, 'energy'> & { contracting?: boolean }): boolean =>
  form.energy === previous.energy && billingEnergy({ energy: form.energy, contracting: form.contracting }) === billingEnergy(previous) && isStockEnergy(billingEnergy(previous))

// Getauscht wird eine laufende zentrale Anlage; bei getrennter Heizkostenabrechnung kommt das später.
export const canSwap = (p: Pick<HeatingPlant, 'endsOn' | 'supply' | 'separateSpans'>): boolean =>
  p.endsOn === null && p.supply === 'central' && p.separateSpans.length === 0

// Vorbelegung „Ja“: Wer den Kessel tauscht, verheizt den Brennstoff im Tank meist weiter.
export const emptySwapForm = (p: Pick<HeatingPlant, 'name'>): SwapForm => ({ date: '', energy: '', name: '', previousName: p.name, takesOverStock: 'yes' })

export function swapBody(form: SwapForm, previous: Pick<HeatingPlant, 'energy'>, plantMeters: readonly Pick<Meter, 'id' | 'name'>[] = []): { body: SwapBody } | { error: string } {
  if (form.date === '') return { error: 'Bitte wählen Sie den Tag, an dem die neue Heizung in Betrieb ging.' }
  if (form.energy === '') return { error: 'Womit heizt die neue Heizung?' }
  const meterReadings: { meterId: string; value: number }[] = []
  for (const m of plantMeters) {
    const text = (form.meterValues?.[m.id] ?? '').trim()
    if (text === '') continue
    const value = parseMeterValue(text)
    if (value === null) return { error: `Der Stand für „${m.name}“ ist keine Zahl.` }
    meterReadings.push({ meterId: m.id, value })
  }
  // Heizung PR 16: Contracting nur, wo der Tausch es gefragt hat; die Angaben zur Umstellung nur mit Wert.
  const contracting = form.contracting === undefined ? {} : { contracting: form.contracting && asksContracting(form.energy) }
  const sw = form.contracting === true && asksContracting(form.energy)
  if (sw && (form.announcedOn ?? '') !== '' && (form.deliverySince ?? '') === '') {
    return { error: 'Eine Ankündigung ohne Tag der Umstellung lässt sich nicht prüfen. Bitte tragen Sie den Tag der Umstellung ein oder leeren Sie beide.' }
  }
  const delivery = sw ? {
    ...(form.deliverySince ? { heatDeliverySince: form.deliverySince } : {}),
    ...(form.previousSupply ? { previousSupply: form.previousSupply } : {}),
    ...(form.announcedOn ? { switchAnnouncedOn: form.announcedOn } : {}),
  } : {}
  const body: SwapBody = { date: form.date, energy: form.energy, name: form.name.trim(), previousName: form.previousName.trim(), ...(meterReadings.length > 0 ? { meterReadings } : {}), ...contracting, ...delivery }
  return { body: asksTakeOver(form, previous) ? { ...body, takesOverStock: form.takesOverStock === 'yes' } : body }
}

// Sichtprüfung E9: Warum eine Einheit beim Einrichten nicht angehakt ist.
export const connectionNote = (u: Pick<Unit, 'noConnection'>): string | null =>
  (u.noConnection ?? []).includes('waerme') ? 'ohne Wärmeanschluss laut Wohnungsdaten' : null

// Befund M6 aus #341: Die Zeile „Abrechnung“ beschreibt bei `manual` den gespeicherten Stand, wie gerechnet wird,
// statt die Antwort „Niemand“ zu wiederholen. „Niemand“ bleibt die Antwort auf die Frage, wer die
// Heizkostenabrechnung erstellt (die Anleitungen zitieren sie); auf der Karte widerspräche sie aber einer Anlage,
// für die gerade „Ich selbst“ gewählt ist: Bis „Speichern“ in Schritt 7 ist sie bewusst mit freien Schlüsseln
// gespeichert (Abweichung 21).
export const MANUAL_SUMMARY = 'nach den Umlageschlüsseln der Kostenpositionen, ohne eigene Heizkostenabrechnung'
// Derselbe Satz in Schritt 7 und in der Mitteilung nach „Später“.
export const SELF_UNTIL_SWITCH = 'Die Abrechnung wechselt erst, wenn Sie das Fenster „Heizkosten selbst abrechnen“ speichern; bis dahin verteilt Mietfuchs die Heizkosten nach den Umlageschlüsseln der Kostenpositionen.'

// Die Zeilen der Karte, wenn eine Anlage eingerichtet ist. Ohne Liste versorgt die Anlage jede
// Einheit mit Wärmeanschluss (`servesUnit`); die übrigen nennt die Zeile, sonst hieße es „alle“.
export function heatingSummary(plant: HeatingPlant, units: readonly Pick<Unit, 'id' | 'name' | 'noConnection'>[], plants: readonly HeatingPlant[] = []): string[] {
  // Heizung PR 16: bei Contracting „Wärmelieferung (Contracting, erzeugt mit …)“.
  const energyLabel = energyLabelOf({ energy: billingEnergy(plant), contracting: plant.contracting, fuelEnergy: plant.energy })
  const perUnit = plant.supply === 'perUnit'
  const energy = perUnit ? `${energyLabel}, Etagenheizung je Wohnung (Vertrag bei Ihnen)` : energyLabel
  const who = perUnit
    ? 'Direktzuordnung der Rechnung jeder Wohnung'
    : plant.source === 'homeowners'
      ? 'Die Gemeinschaft (Hausverwaltung) rechnet ab'
      : plant.method === 'manual'
        ? MANUAL_SUMMARY
        : (whoOptions('mfh').find((o) => o.value === plant.method)?.label ?? plant.method)
  const without = units.filter((u) => connectionNote(u) !== null).map((u) => u.name)
  const served = plant.units === null
    ? `alle Wohnungen${without.length > 0 ? ` außer ${without.join(', ')} (ohne Wärmeanschluss)` : ''}`
    : plant.units.length === 0
      ? 'keine Wohnung'
      : plant.units.map((u) => units.find((x) => x.id === u.unitId)?.name ?? u.unitId).join(', ')
  const remote = REMOTE_OPTIONS.find((o) => o.value === plant.devicesRemote)?.label ?? plant.devicesRemote
  const lines = [`Energie: ${energy}`, `Abrechnung: ${who}`, `Angeschlossen: ${served}`]
  // Kesseltausch (Heizung PR 9): Stilllegung und Nachfolge.
  const successor = plants.find((p) => p.replacesPlantId === plant.id)
  const predecessor = plants.find((p) => p.id === plant.replacesPlantId)
  const swap = [
    ...(plant.endsOn ? [`Außer Betrieb seit ${germanDate(dayAfter(plant.endsOn))}${successor ? `, ersetzt durch „${successor.name}“` : ''}`] : []),
    ...(predecessor?.endsOn ? [`In Betrieb seit ${germanDate(dayAfter(predecessor.endsOn))}, ersetzt „${predecessor.name}“`] : []),
  ]
  return [
    ...(plant.name.trim() ? [`Name: ${plant.name.trim()}`] : []),
    ...lines,
    ...(asksRemote(plant.method) && !perUnit ? [`Aus der Ferne ablesbar: ${remote}`] : []),
    ...swap,
  ]
}

// ---------- Warmwasser laut Messdienst (Heizung PR 6, #211, Entwurf 7.7) ----------

export type HotWaterChoice = DhwMethod | ''
export const HOT_WATER_OPTIONS: readonly { value: HotWaterChoice; label: string }[] = [
  { value: '', label: 'keine Angabe' },
  { value: 'heatMeter', label: 'mit einem Wärmezähler gemessen' },
  { value: 'volumeFormula', label: 'mit einer Formel aus dem Warmwasserverbrauch' },
  { value: 'areaFormula', label: 'mit einer Formel aus der Wohnfläche' },
]
export const isFormula = (choice: HotWaterChoice): boolean => choice === 'volumeFormula' || choice === 'areaFormula'
// Die Bestätigung des unzumutbaren Aufwands (§ 9 Abs. 2 Satz 2 HeizkostenV) gibt es nur zu einer Formel.
export function hotWaterBody(choice: HotWaterChoice, unmeasurable: boolean): { dhwMethod: DhwMethod | null; dhwUnmeasurable: boolean | null } {
  return { dhwMethod: choice === '' ? null : choice, dhwUnmeasurable: isFormula(choice) ? unmeasurable : null }
}

// Die Bestätigung nennt die Voraussetzung der gewählten Formel (Durchsicht M1): die nach dem
// Warmwasserverbrauch bei unzumutbar hohem Aufwand (§ 9 Abs. 2 Satz 2), die nach der Wohnfläche nur,
// wenn auch das Volumen nicht gemessen werden kann (Satz 4).
export function unmeasurableLabel(choice: HotWaterChoice): string {
  return choice === 'areaFormula'
    ? 'Weder die Wärmemenge noch das Volumen des verbrauchten Warmwassers lässt sich messen (Nachweis aufbewahren)'
    : 'Die Wärmemenge ließe sich nur mit unzumutbar hohem Aufwand messen (Nachweis aufbewahren)'
}

// ---------- Warmwasser bei eigener Abrechnung (Heizung PR 11, Entwurf 8.3) ----------

// An der Anlage gefragt (Durchsicht von #240, Recht-I2): bei einer Wärmepumpe immer, sonst bei eigener
// Abrechnung, denn die Antwort entscheidet über Formel und Gesamtwärme beim Warmwasseranteil.
export const asksGeneration = (form: Pick<HeatingForm, 'energy' | 'who'>): boolean =>
  form.energy !== '' && form.energy !== 'perUnit' && (form.energy === 'heatPump' || form.who === 'self')
export const GENERATION_QUESTION = 'Erzeugt diese Heizung die Wärme allein?'
// § 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV in der Fassung bis zum Tag vor diesem: Wärmepumpen waren ausgenommen.
const EXEMPTION_ENDS = hkvRenewableExemption.versions.find((v) => v.validFrom !== undefined)?.validFrom ?? ''
export const MAJORITY_QUESTION = `Liefert die Wärmepumpe mehr als die Hälfte der Wärme des Gebäudes? (Wichtig für Abrechnungszeiträume, die vor dem ${germanDate(EXEMPTION_ENDS)} beginnen.)`
export const MAJORITY_EXPLAINED = 'Bis dahin galten die Vorschriften der Heizkostenverordnung zur Verteilung nicht für Gebäude, die überwiegend mit Wärme aus Wärmepumpen versorgt werden (§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV in der alten Fassung). Ohne Antwort rechnet Mietfuchs für diese Zeiträume ohne Kürzungsbeträge und nennt beide Folgen.'
export const MAJORITY_OPTIONS: readonly { value: HeatPumpMajority | ''; label: string }[] = [
  { value: '', label: 'bitte wählen' },
  { value: 'yes', label: 'Ja, mehr als die Hälfte' },
  { value: 'no', label: 'Nein' },
  { value: 'unknown', label: 'Weiß ich nicht' },
]

// Bei eigener Abrechnung rechnet Mietfuchs selbst; „keine Angabe“ gibt es dort nicht, die Vorgabe ist
// der Wärmezähler (§ 9 Abs. 2 Satz 1 HeizkostenV).
export const SELF_HOT_WATER_OPTIONS: readonly { value: HotWaterChoice; label: string }[] = HOT_WATER_OPTIONS.filter((o) => o.value !== '')

// Ob die Anlage die Wärme allein erzeugt (§ 9 Abs. 1 Satz 5, Abs. 2 Satz 6 Nr. 3 HeizkostenV). Ohne
// Vorgabe: Eine falsche Vorgabe ergäbe still einen falschen Anteil (Abweichung 5 des Plans PR 11).
export const HEAT_GENERATION_OPTIONS: readonly { value: HeatGeneration | ''; label: string }[] = [
  { value: '', label: 'bitte wählen' },
  { value: 'single', label: 'allein (ein Kessel, eine Wärmepumpe oder Fernwärme)' },
  { value: 'mixed', label: 'mit einem weiteren Erzeuger (Solaranlage, Heizstab, zweiter Kessel)' },
]

// Eine Zahl deutsch oder technisch geschrieben; leer heißt keine Angabe, `undefined` keine Zahl.
// Deutsche Tausenderpunkte wie bei Beträgen (`parseNumberDe`, Durchsicht von #240, M3).
export function parseDecimal(text: string): number | null | undefined {
  if (text.trim() === '') return null
  return parseNumberDe(text) ?? undefined
}
export const numberText = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 3, useGrouping: false }))

export type FormulaForm = { volume: string; temp: string }
export const formulaFormOf = (hw: HeatingPeriodView['hotWater']): FormulaForm => ({ volume: numberText(hw.dhwVolumeM3), temp: numberText(hw.dhwTempC) })

// Der Teil des Rumpfs, den nur die Volumenformel braucht.
export function selfFormulaBody(choice: HotWaterChoice, form: FormulaForm): { body: { dhwVolumeM3?: number | null; dhwTempC?: number | null } } | { error: string } {
  if (choice !== 'volumeFormula') return { body: {} }
  if (ambiguousThousands(form.volume)) return { error: `Volumen des Warmwassers: ${ambiguousText(form.volume)}` }
  const volume = parseDecimal(form.volume)
  if (volume === undefined) return { error: 'Das Volumen des Warmwassers ist keine Zahl.' }
  const temp = parseDecimal(form.temp)
  if (temp === undefined) return { error: 'Die Temperatur des Warmwassers ist keine Zahl.' }
  return { body: { dhwVolumeM3: volume, dhwTempC: temp } }
}

// Die Folge einer fehlenden Bestätigung (Durchsicht von #240, M6), mit der Kürzung aus dem Register.
export const unconfirmedConsequence = (): string =>
  `Ohne diese Bestätigung nennt die Abrechnung, dass jeder Mieter seinen Anteil an den Heiz- und Warmwasserkosten um ${CUT} % kürzen darf (§ 12 Abs. 1 Satz 1 HeizkostenV).`
// Die Beschriftung des Volumens: bei einem Kesseltausch das der Laufzeit der Anlage (Durchsicht von #240, Geld-I1).
export const volumeLabel = (running: { from: string; to: string } | null, fmt: (iso: string) => string): string =>
  running ? `Warmwasser in der Laufzeit dieser Anlage (${fmt(running.from)}–${fmt(running.to)}, m³, gemessen)` : 'Warmwasser in der Heizperiode (m³, gemessen)'
