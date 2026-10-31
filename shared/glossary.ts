// Das Begriffslexikon (#113): jeder Fachbegriff, dem ein Vermieter in Mietfuchs begegnet, mit
// einer Erklärung in einem Satz, einem Beispiel mit Zahlen, der Rechtsgrundlage und der Antwort
// auf „Brauche ich das?“.
//
// Es liegt in shared/, weil beide Seiten es brauchen: Der Server hängt an jeden Hinweis die
// passenden Begriffe (`noticeKinds` in calc.ts), der Client zeigt sie an. Es ist der erste
// Laufzeitanteil hier; das Docker-Image übernimmt den Ordner (siehe scripts/CLAUDE.md, Docker-Image).
//
// Maßstab für die Texte: einfache Worte, eine Rechtsaussage nur, wo sie im Gesetz steht, und
// Rechtsprechung ohne Aktenzeichen, wenn das Aktenzeichen nicht sicher belegt ist. Wer einen
// Eintrag ändert, prüft ihn bei der jährlichen Durchsicht mit (#110).
//
// Rechtszahlen kommen aus dem Rechtsregister (shared/law/, Heizung PR 1), und zwar in der Fassung
// von `LAW_AS_OF`: Das Lexikon erklärt das geltende Recht. Die Zahlen einer Beispielrechnung („70 %
// nach Verbrauch“) sind gewählt und bleiben stehen.
import { bgbHeatDeliverySwitch } from './law/bgb-betrkv.ts'
import { hkvConsumptionShare, hkvConsumptionShareForced, hkvCutInformation, hkvCutNotByConsumption, hkvCutRemoteReading, hkvDegreeDays, hkvDhwAreaFormula, hkvDhwFactors, hkvDhwVolumeFormula, hkvEstimateThreshold, hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit } from './law/heizkostenv.ts'
import { dayBefore as dayBeforeIso, germanDate, LAW_AS_OF, onlyVersion, valueAt } from './law/register.ts'
import { practiceEvaporatorWindow } from './law/practice.ts'
import { messevCalibrationYears } from './law/messev.ts'
import { OPERATING_POWER_HANDLING_LABELS, OPERATING_POWER_HANDLING_QUESTION } from './operatingPower.ts'
import { co2CutMissing, co2DistrictEtsNew, co2EbevFactors, co2FirstPeriodStart, co2HalfSplit, co2HalfSplitTwoFamily, co2NonResidential, co2Restriction, co2RoundingDecimals, co2SelfSupply, co2StageTable, halfSplitBioFirstDay, halfSplitEnactedOn, halfSplitFirstDay } from './law/co2kostaufg.ts'
import { bioCapFrom, gmodgHeating43 } from './law/gmodg.ts'
import { estgAcquisitionRelated, estgCheapRent, yearsWord } from './law/estg.ts'
import { ustgSmallBusiness } from './law/ustg.ts'

// Hälftige Teilung nach § 5a (Heizung PR 18): Stichtage, Grenze beim Biobrennstoff, Zweifamilienhaus und § 43 GModG.
const HALF = valueAt(co2HalfSplit, halfSplitBioFirstDay())
const TWO = valueAt(co2HalfSplitTwoFamily, LAW_AS_OF)
const HEATING43 = valueAt(gmodgHeating43, LAW_AS_OF)
// Erstattung an Mieter, die selbst heizen (Heizung PR 19).
const SELF = valueAt(co2SelfSupply, LAW_AS_OF)
// Verbilligte Vermietung (#257): die Grenzen von § 21 Abs. 2 EStG.
const CHEAP = valueAt(estgCheapRent, LAW_AS_OF)
// Anschaffungsnahe Herstellungskosten (#96 PR 2): Grenze und Zeitraum nach § 6 Abs. 1 Nr. 1a EStG.
const ACQ = valueAt(estgAcquisitionRelated, LAW_AS_OF)
const ACQ_YEARS = yearsWord(ACQ.years)
const acqDe = (euro: number): string => euro.toLocaleString('de-DE', { maximumFractionDigits: 0 })
// Garage und Umsatzsteuer (#323): die Grenzen der Kleinunternehmerregelung nach § 19 Abs. 1 UStG.
const SMALL = valueAt(ustgSmallBusiness, LAW_AS_OF)

const SHARE = valueAt(hkvConsumptionShare, LAW_AS_OF)
const CUT = valueAt(hkvCutNotByConsumption, LAW_AS_OF)
// Wärmelieferung (Heizung PR 16): der Pflichtanteil nach § 7 Abs. 1 Satz 2 und die Frist der Ankündigung.
const FORCED = valueAt(hkvConsumptionShareForced, LAW_AS_OF)
const SWITCH = valueAt(bgbHeatDeliverySwitch, LAW_AS_OF)
// Warmwasseranteil (Heizung PR 11): das Beispiel aus dem Entwurf 8.3, gerechnet mit den Werten des
// Registers. Die Mengen des Hauses sind Beispielzahlen und keine Rechtswerte.
const DHW_VOLUME = valueAt(hkvDhwVolumeFormula, LAW_AS_OF)
const DHW_AREA = valueAt(hkvDhwAreaFormula, LAW_AS_OF)
const DHW_FACTORS = valueAt(hkvDhwFactors, LAW_AS_OF)
const dhwDe = (n: number, digits = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const dhwPct = (part: number, whole: number) => `${dhwDe((part / whole) * 100, 2)} %`
const DHW_EXAMPLE = { areaM2: 200, volumeM3: 120, tempC: 60, gasKwh: 60000, measuredKwh: 9000, shareEuro: 1000 }
const DHW_Q_VOLUME = DHW_VOLUME.effort * DHW_EXAMPLE.volumeM3 * (DHW_EXAMPLE.tempC - DHW_VOLUME.coldWaterC)
const DHW_Q_AREA = DHW_AREA.kwhPerM2 * DHW_EXAMPLE.areaM2
const REMOTE_CUT = valueAt(hkvCutRemoteReading, LAW_AS_OF)
// Eichfrist (Heizung PR 21): die Fassung von heute; das Beispiel rechnet mit einem Zähler aus 2022.
const CALIBRATION = valueAt(messevCalibrationYears, LAW_AS_OF).kaltwasser
const CALIBRATION_EXAMPLE_YEAR = 2022
const ESTIMATE_THRESHOLD = valueAt(hkvEstimateThreshold, LAW_AS_OF)
const INFO_CUT = valueAt(hkvCutInformation, LAW_AS_OF)
// Monatliche Verbrauchsinformation (Heizung PR 22): Beispielzahlen eines Haushalts; die Umrechnung des
// Warmwassers mit den Werten des Registers.
const MONTHLY = { areaM2: 60, heatKwh: 700, dhwM3: 2.5, tempC: 55, prevHeatKwh: 400, prevM3: 2, lastYearHeatKwh: 350, refPerM2: 10 }
const MONTHLY_DHW_KWH = DHW_VOLUME.effort * MONTHLY.dhwM3 * (MONTHLY.tempC - DHW_VOLUME.coldWaterC)
const NEW_DEVICES_AFTER = germanDate(valueAt(hkvRemoteReadingNewDevices, LAW_AS_OF).installedAfter)
const RETROFIT_FROM = germanDate(onlyVersion(hkvRemoteReadingRetrofit).validFrom ?? '')
// Heizkostenverteiler (Heizung PR 12): Beispiel mit zwei Bewertungsfaktoren. Die Zahlen des Hauses
// sind Beispielzahlen und keine Rechtswerte.
const EVAPORATOR = valueAt(practiceEvaporatorWindow, LAW_AS_OF)
// Standardwerte der EBeV 2030 für das Beispiel (Heizung PR 17, Durchsicht von #246, Runde 2, N2): Erdgas nach
// Brennwert, 100.000 kWh × t CO₂/GJ × GJ/MWh.
const EBEV = valueAt(co2EbevFactors, LAW_AS_OF)
const ebevDe = (n: number, digits: number) => n.toLocaleString('de-DE', { maximumFractionDigits: digits })
const HCA = { livingRaw: 500, livingFactor: 1.25, bathRaw: 200, bathFactor: 0.8, houseUnits: 7850, consumptionEuro: 2100 }
const hcaDe = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
const HCA_LIVING = HCA.livingRaw * HCA.livingFactor
const HCA_BATH = Math.round(HCA.bathRaw * HCA.bathFactor * 100) / 100
const HCA_FLAT = HCA_LIVING + HCA_BATH

// CO₂ (Heizung PR 6): die Stufentabelle, die Rundung und die 3 % aus dem Register. Die Stufe eines
// Beispielwerts wird hier nachgeschlagen wie in server/src/co2.ts (unten einschließend), damit das
// Beispiel dieselbe Stufe nennt wie die Rechnung.
const CO2_CUT = valueAt(co2CutMissing, LAW_AS_OF)
const CO2_FROM = germanDate(co2FirstPeriodStart())
const CO2_DECIMALS = valueAt(co2RoundingDecimals, LAW_AS_OF)
// Heizung PR 7: § 8, § 9 und § 2 Abs. 4 Satz 2 CO2KostAufG aus dem Register.
const NON_RES_PERCENT = valueAt(co2NonResidential, LAW_AS_OF) / 10
const RESTRICTION = valueAt(co2Restriction, LAW_AS_OF)
const ETS_AFTER = germanDate(valueAt(co2DistrictEtsNew, LAW_AS_OF).connectedAfter)
const deCents = (cents: number): string => (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const STAGES = valueAt(co2StageTable, LAW_AS_OF)
function stageText(value: number): { range: string; percent: number } {
  let i = 0
  for (let k = 0; k < STAGES.length; k++) if (value >= (STAGES[k]?.from ?? Infinity)) i = k
  const stage = STAGES[i]
  const next = STAGES[i + 1]
  if (!stage) throw new Error('Stufentabelle leer')
  return { range: next ? `${stage.from} bis unter ${next.from} kg` : `ab ${stage.from} kg`, percent: stage.landlordPercent }
}
const B1 = stageText(40.2)
// Etagenheizung (Heizung PR 9): 3.000 kg auf 100 m² = 30,0 kg je m².
const E1 = stageText(30)
// Kesseltausch: 15.043,35 kg auf 300 m² = 50,1 kg je m², Öl allein 12.043,35 kg = 40,1 kg je m².
const K1 = stageText(50.1)
const K0 = stageText(40.1)
const FIRST = STAGES[0]
const SECOND = STAGES[1]
const LAST = STAGES[STAGES.length - 1]
if (!FIRST || !SECOND || !LAST) throw new Error('Stufentabelle unvollständig')

// Die Themen des Lexikons (Seite „Hilfe & Begriffe“): Jeder Begriff gehört zu genau einem, damit er auf der Startseite
// der Hilfe unter seinem Thema steht. Die Beschriftungen stehen im Client (client/src/helpView.ts).
export const TERM_TOPICS = ['costs', 'tenants', 'period', 'meters', 'heating', 'co2', 'condo', 'tax'] as const
export type TermTopic = (typeof TERM_TOPICS)[number]

export type Term = {
  // das Thema, unter dem der Begriff in der Hilfe steht
  topic: TermTopic
  title: string
  // ein Satz
  short: string
  // mit Zahlen gerechnet
  example: string
  // Rechtsgrundlage, wo es eine gibt
  norm?: string
  // „Brauche ich das?“
  needed: string
}

// Die Gradtagstabelle kommt aus dem Register (Entwurf 10.3: „Die Zahlen kommen aus dem Register“).
const DEGREE_DAYS = onlyVersion(hkvDegreeDays).value
const winterPermille = ['01', '02', '03', '04'].reduce((a, m) => a + (DEGREE_DAYS.months[m] ?? 0), 0)
const deEuro = (cents: number): string => (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const GLOSSARY = {
  allocable: {
    topic: 'costs',
    title: 'Umlagefähige Betriebskosten',
    short: 'Laufende Kosten des Hauses, die Sie auf die Mieter umlegen dürfen, wenn der Mietvertrag das vorsieht; welche das sind, zählt die Betriebskostenverordnung auf.',
    example: 'Grundsteuer 600 €, Müllabfuhr 360 €, Gebäudeversicherung 540 € im Jahr: zusammen 1.500 € umlagefähig.',
    norm: '§ 556 Abs. 1 BGB, § 2 BetrKV',
    needed: 'Ja, das ist der Kern jeder Nebenkostenabrechnung.',
  },
  notAllocable: {
    topic: 'costs',
    title: 'Nicht umlagefähige Kosten',
    short: 'Kosten, die der Vermieter selbst trägt, vor allem Verwaltung, Reparaturen und Instandhaltung; Mietfuchs rechnet sie ganz dem Vermieter zu.',
    example: 'Reparatur der Heizung 800 € und Kontoführung 60 €: beide 860 € trägt der Vermieter, auf der Abrechnung erscheinen sie nicht beim Mieter.',
    norm: '§ 1 Abs. 2 BetrKV',
    needed: 'Nur wenn Sie solche Rechnungen trotzdem erfassen, etwa für die Steuer (Anlage V). Die Zuführung zur Erhaltungsrücklage einer Eigentumswohnung erfassen Sie bitte nicht hier, sondern als Kostenart „Zuführung Erhaltungsrücklage“: Sie ist erst abziehbar, wenn die Gemeinschaft das Geld ausgibt. Ihren Anteil an einer Maßnahme, die die Gemeinschaft aus der Rücklage bezahlt hat, erfassen Sie als „Entnahme Erhaltungsrücklage“ (siehe Erhaltungsrücklage).',
  },
  allocationKey: {
    topic: 'costs',
    title: 'Umlageschlüssel',
    short: 'Die Regel, nach der eine Rechnung auf die Wohnungen verteilt wird: nach Wohnfläche, Personen, Wohneinheiten, Verbrauch oder einer vereinbarten Quote.',
    example: '900 € Müllabfuhr nach Wohnfläche: Eine Wohnung mit 60 von 180 m² trägt 300 €.',
    norm: '§ 556a Abs. 1 BGB',
    needed: 'Ja, für jede Kostenposition. Ist im Mietvertrag nichts vereinbart, gilt die Wohnfläche; für gemessenen Verbrauch der Verbrauch, für Heizung die Heizkostenverordnung und bei einer Eigentumswohnung der Schlüssel der Gemeinschaft.',
  },
  // #141: Der Hinweis „Umlageschlüssel anders als im Vorjahr“ verweist hierher. Wortlaut des
  // § 556a BGB und des § 6 Abs. 4 HeizkostenV nachgelesen auf gesetze-im-internet.de am 01.10.2026.
  keyChange: {
    topic: 'costs',
    title: 'Wechsel des Umlageschlüssels',
    short: 'Ein vereinbarter Umlageschlüssel gilt weiter, bis er geändert wird: mit Zustimmung der Mieter, oder einseitig durch Ihre Erklärung in Textform, aber nur vor Beginn eines Abrechnungszeitraums und nur hin zu einer Verteilung nach erfasstem Verbrauch oder erfasster Verursachung.',
    example: 'Müllabfuhr 900 € bisher nach Personen: Ein Haushalt mit 4 von 6 Personen trug 600 €. Nach Wohnfläche mit 60 von 180 m² wären es 300 €. Ohne Zustimmung der Mieter bleibt es bei den Personen, denn ein Wechsel zur Fläche ist keiner hin zum Verbrauch.',
    norm: '§ 556a Abs. 2 und Abs. 3 BGB, § 6 Abs. 4 HeizkostenV',
    needed: 'Nur wenn Sie einen Schlüssel anders wählen als im Vorjahr. Bei einer vermieteten Eigentumswohnung gilt, soweit nichts anderes vereinbart ist, der jeweils geltende Maßstab der Gemeinschaft; ändert die Gemeinschaft ihn, ändert er sich auch gegenüber dem Mieter. Widerspricht er billigem Ermessen, wird nach Absatz 1 umgelegt, in der Regel nach Wohnfläche. Für Heizung und Warmwasser gilt vorrangig § 6 Abs. 4 HeizkostenV: Dort darf der Maßstab für künftige Abrechnungszeiträume auch aus anderen sachgerechten Gründen geändert werden.',
  },
  distributionBasis: {
    topic: 'costs',
    title: 'Verteilbasis',
    short: 'Die Gesamtmenge, durch die geteilt wird, etwa die Summe aller Wohnflächen; jede Wohnung trägt ihren Teil davon.',
    example: 'Drei Wohnungen mit 50, 60 und 70 m² ergeben eine Verteilbasis von 180 m². Die Wohnung mit 60 m² trägt 60/180 = ein Drittel.',
    needed: 'Sie rechnen sie nicht selbst aus, Mietfuchs zeigt sie im Rechenweg. Wichtig ist nur, dass für jede Wohnung der Wert eingetragen ist.',
  },
  billingUnit: {
    topic: 'costs',
    title: 'Abrechnungseinheit',
    short: 'Die Wohnungen, die gemeinsam abgerechnet werden; eine Wohnung außerhalb, etwa ein Laden mit eigener Abrechnung, bleibt ganz außen vor.',
    example: 'Haus mit drei Wohnungen und einem Laden: Die drei Wohnungen bilden die Abrechnungseinheit. Von 1.200 € Grundsteuer ziehen Sie zuerst den Anteil des Ladens ab, etwa 300 €; nur die übrigen 900 € verteilen sich auf die Wohnungen.',
    needed: 'Nur wenn nicht alle Einheiten gemeinsam abgerechnet werden. Sonst gehört jede Wohnung dazu. Nehmen Sie eine Einheit heraus, gehört auch ihr Anteil an gemeinsamen Rechnungen heraus, sonst tragen ihn die Mieter mit.',
  },
  granny: {
    topic: 'tenants',
    title: 'Einliegerwohnung',
    short: 'Eine kleinere zweite Wohnung in einem Haus, das Sie selbst bewohnen; Sie rechnen die Nebenkosten nur mit dieser einen Mietpartei ab, Ihren eigenen Anteil tragen Sie selbst.',
    example: 'Ihre Wohnung hat 120 m², die Einliegerwohnung 45 m², zusammen 165 m². Von 600 € Grundsteuer nach Wohnfläche trägt die Mieterin 600 € × 45/165 = 163,64 €, die übrigen 436,36 € sind Ihr Eigenanteil.',
    norm: '§ 556a Abs. 1 BGB, § 2 HeizkostenV',
    needed: 'Wenn Sie im eigenen Haus eine Einliegerwohnung vermieten. Legen Sie ein Objekt an, Ihre eigene Wohnung als selbstgenutzt mit Fläche und Personen, die Einliegerwohnung als vermietet. Hat nur die Einliegerwohnung einen Zwischenzähler, legen Sie den Zähler des Hauses als Hauptzähler ohne Wohnung an: Dann zahlt die Mieterin ihren gemessenen Verbrauch, und der Rest ist Ihr Eigenanteil. Dieser Eigenanteil ist privat und steuerlich nicht abziehbar; in die Anlage V gehören die Kosten des Gebäudes nur zu dem Teil, der auf die vermietete Fläche entfällt. Bei den Heizkosten dürfen Sie in einem Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, mit der Mieterin etwas anderes vereinbaren als die Heizkostenverordnung, etwa eine Warmmiete; ohne eine solche Vereinbarung gilt sie.',
  },
  ownShare: {
    topic: 'tax',
    title: 'Eigenanteil',
    short: 'Der Teil der Kosten, der auf Ihre selbstgenutzte oder unentgeltlich überlassene Wohnung entfällt; Sie tragen ihn selbst, und er ist privat, also nicht als Werbungskosten abziehbar. Für die darin enthaltenen Arbeitskosten können Sie als Bewohner selbst die Steuerermäßigung nach § 35a nutzen. Was Sie wegen Leerstand oder als Rundungsrest tragen, gehört nicht dazu und bleibt Werbungskosten.',
    example: 'Grundsteuer 1.000 € nach Fläche, Ihre Wohnung hat 80 von 200 m²: 400 € sind Eigenanteil, nur die übrigen 600 € gehören in die Anlage V.',
    norm: '§ 9 Abs. 1, § 12 Nr. 1, § 35a EStG',
    needed: 'Wenn Sie selbst im Haus wohnen. Legen Sie Ihre Wohnung dann als selbstgenutzt an, sonst zahlen die Mieter Ihren Teil mit. Das gilt auch für eine Wohnung, die Sie unentgeltlich überlassen.',
  },
  mixedUse: {
    topic: 'tax',
    title: 'Teilweise selbstgenutztes Gebäude',
    short: 'Wohnen Sie selbst im Haus, sind dessen Kosten nur zu dem Teil Werbungskosten, der auf den vermieteten Teil entfällt: Was einer Wohnung direkt zuzuordnen ist, gehört ganz zu ihr, die Kosten des ganzen Gebäudes werden nach dem Verhältnis der Wohn- und Nutzflächen aufgeteilt.',
    example: 'Ihre Wohnung hat 120 m², die Einliegerwohnung 60 m², zusammen 180 m². Die Dachreparatur über 1.800 € ist zu 60/180 abziehbar, also 600 €; 1.200 € sind privat. Die Badrenovierung der Einliegerwohnung über 4.000 € ist ganz abziehbar, die in Ihrer Wohnung gar nicht.',
    norm: '§ 9 Abs. 1, § 12 Nr. 1 EStG; BFH, Urteil vom 24.06.2008, IX R 26/06',
    needed: 'Wenn Sie in einem Haus, in dem Sie vermieten, selbst wohnen oder eine Wohnung unentgeltlich überlassen. Legen Sie die eigene Wohnung als selbstgenutzt mit Fläche an; die Steuerübersicht teilt die Werbungskosten dann auf und zeigt den Rechenweg. Eine Reparatur, die nur eine Wohnung betrifft, ordnen Sie unter Kosten bei „Betrifft (für die Steuer)“ dieser Wohnung zu, eine Reparatur am Dach nur eines Gebäudeteils den betroffenen Einheiten. Wer zum ersten Mal verhältnismäßig aufteilt, erläutert dem Finanzamt den Maßstab in einer gesonderten Aufstellung; dafür taugt der Ausdruck der Steuerübersicht.',
  },
  // #257: verbilligte Vermietung, an der Wohnung und in der Steuerübersicht. Beispiel aus calc-steuer-verbilligt.test.ts.
  cheapRent: {
    topic: 'tax',
    title: 'Verbilligte Vermietung',
    short: `Vermieten Sie eine Wohnung deutlich unter der ortsüblichen Miete, etwa an Angehörige, sind die Werbungskosten dieser Wohnung nur zum entgeltlichen Teil abziehbar: Liegt das Entgelt unter ${CHEAP.split} % der ortsüblichen Warmmiete, wird geteilt; ab ${CHEAP.paid} % gilt eine auf Dauer angelegte Vermietung als entgeltlich (§ 21 Abs. 2 Satz 2 EStG). Dazwischen prüft das Finanzamt mit einer Totalüberschussprognose, ob Sie auf Dauer einen Überschuss erzielen. Ortsüblich ist die Kaltmiete laut Mietspiegel, jeder Wert innerhalb der Spanne, zuzüglich der umlagefähigen Betriebskosten, auch der, die der Mieter unmittelbar an Versorger zahlt; das Entgelt ist die vereinbarte Kaltmiete zuzüglich der gezahlten Umlagen.`,
    example: 'Die Tochter zahlt 200 € kalt ohne Vorauszahlung, ortsüblich wären 900 € warm: 2.400 € von 10.800 € im Jahr, also 22,22 %. Von einer Dachreparatur über 1.000 €, zu 60/100 nach Fläche dieser Wohnung zuzurechnen, sind 600 € × 2.400/10.800 = 133,33 € abziehbar und 466,67 € nicht.',
    norm: '§ 21 Abs. 2 EStG; BFH, Urteil vom 22.02.2021, IX R 7/20 (ortsübliche Miete, Rz. 11 bis 14 und 21); BMF-Schreiben vom 08.10.2004, BStBl I S. 933, Rz. 11 und 13 (Entgelt, Totalüberschussprognose)',
    needed: 'Nur wenn Sie eine Wohnung günstiger als üblich vermieten. Tragen Sie dann an der Wohnung die ortsübliche Warmmiete ein, mit Quelle (meist der Mietspiegel) und Datum; die Steuerübersicht zeigt die Quote, kürzt die Werbungskosten dieser Wohnung, wo das Gesetz es verlangt, und zeigt den Rechenweg. Zahlt der Mieter umlagefähige Kosten unmittelbar an Dritte, etwa Gas für die eigene Heizung oder die Müllabfuhr an die Gemeinde, gehören sie in die ortsübliche Warmmiete und ebenso zum Entgelt; tragen Sie sie in derselben Karte beim Mietverhältnis unter „Direkt gezahlte Kosten“ als Betrag im Monat ein. Sie zählen nur für die Quote, nicht zu Ihren Werbungskosten. Heizt der Mieter selbst und fehlt der Betrag, kürzt Mietfuchs nicht. Abschreibung und Schuldzinsen der Wohnung, die Mietfuchs nicht führt, sind nach derselben Quote zu kürzen. Umlagefähige Kosten rechnet Mietfuchs der Wohnung mit dem Anteil des Mieters laut Abrechnung zu, die übrigen nach Wohnfläche; Tage ohne verbilligtes Mietverhältnis, auch Leerstand, zählen als entgeltlich. Beides ist eine Auslegung von Mietfuchs. Zahlt der Mieter die vereinbarte Miete nicht wie vereinbart, prüft das Finanzamt außerdem, ob das Mietverhältnis einem Fremdvergleich standhält (OFD Frankfurt am Main, Rundverfügung vom 17.06.2025, Tz. 1.2); das rechnet Mietfuchs nicht.',
  },
  // #323: getrennt vermietete Garage und Umsatzsteuer, nur benannt, nicht gerechnet. § 4 Nr. 12 und § 19 UStG
  // am 24.10.2026 auf gesetze-im-internet.de gelesen, Abschnitt 4.12.2 Abs. 3 UStAE im Umsatzsteuer-Anwendungserlass
  // des BMF (Stand 02.06.2026), die Zeilen am Vordruck „2025AnlV101 – September 2025 –“, Seite 2.
  garageVat: {
    topic: 'tax',
    title: 'Umsatzsteuer bei Garage und Stellplatz',
    short: 'Die Vermietung von Wohnungen ist von der Umsatzsteuer befreit, die Vermietung von Plätzen zum Abstellen von Fahrzeugen nicht. Eine getrennt vermietete Garage oder ein getrennt vermieteter Stellplatz ist deshalb grundsätzlich umsatzsteuerpflichtig, auch wenn eine Privatperson sie mietet.',
    example: `Sie vermieten eine Garage für 60 € im Monat an einen Nachbarn, der keine Wohnung bei Ihnen hat: 720 € im Jahr sind ein steuerpflichtiger Umsatz. Für die Kleinunternehmerregelung zählen die Wohnungsmieten nicht mit, wohl aber die Garagenmiete und Ihre übrigen Umsätze als Unternehmer. Hat diese Summe im Vorjahr ${SMALL.previousYearEuro.toLocaleString('de-DE')} € nicht überschritten und überschreitet sie im laufenden Jahr ${SMALL.currentYearEuro.toLocaleString('de-DE')} € nicht, ist die Garagenmiete steuerfrei. Mietet dagegen Ihr Wohnungsmieter die Garage auf demselben Grundstück, auch mit eigenem Vertrag, ist sie nach Auffassung der Finanzverwaltung eine Nebenleistung zur Wohnung und wie diese befreit.`,
    norm: '§ 4 Nr. 12 Satz 2, § 19 Abs. 1 und 2 UStG; Abschnitt 4.12.2 Abs. 3 UStAE (Nebenleistung)',
    needed: 'Nur wenn Sie eine Garage oder einen Stellplatz an jemanden vermieten, der nicht zugleich bei Ihnen eine Wohnung im selben Gebäudekomplex oder in unmittelbarer Nähe mietet. Nach Auffassung der Finanzverwaltung ist es auch dann keine Nebenleistung, wenn ein anderer den Stellplatz mietet als die Wohnung, selbst ein Angehöriger im selben Haushalt. Mietfuchs rechnet keine Umsatzsteuer und weist sie auf der Abrechnung nicht aus. Ob Umsatzsteuer anfällt und was Sie dem Finanzamt dafür erklären müssen, klären Sie bitte mit Ihrem Steuerberater. Im Vordruck der Anlage V für 2025 stehen die Einnahmen aus der Vermietung von Garagen in Zeile 26, die vereinnahmte Umsatzsteuer in Zeile 27.',
  },
  // #336: vom Mieter übernommene Kosten als Einnahme, nur benannt. Das Urteil des FG Berlin-Brandenburg am Volltext
  // gelesen (IWW-Abrufnummer 253577, Entscheidungsgründe II. 2. a und b); das dort zitierte BFH-Urteil vom
  // 30.09.2003, IX R 9/03, nicht im Volltext, deshalb hier nicht genannt.
  tenantPaidCosts: {
    topic: 'tax',
    title: 'Vom Mieter übernommene Kosten',
    short: 'Übernimmt ein Mieter Kosten, die Sie als Vermieter zu tragen haben, etwa eine Renovierung, die er mit der Miete verrechnet, ist das für die Steuer eine Einnahme aus Vermietung, und zwar im Jahr, in dem der Mieter zahlt. Die Kosten selbst können zugleich Ihre Werbungskosten sein.',
    example: 'Der Mieter lässt für 3.000 € renovieren und verrechnet das wie vereinbart mit zwei Monatsmieten zu je 1.500 €. Auf Ihrem Konto kommt in diesen Monaten nichts an, für die Steuer haben Sie trotzdem 3.000 € Einnahmen. Ist die Renovierung sofort abziehbarer Erhaltungsaufwand, stehen 3.000 € Werbungskosten dagegen, und der Überschuss ändert sich nicht.',
    norm: '§ 8 Abs. 1, § 11 Abs. 1 EStG; FG Berlin-Brandenburg, Urteil vom 11.03.2026, 11 K 11216/24',
    needed: 'Nur wenn ein Mieter Arbeiten oder Rechnungen bezahlt hat, die eigentlich Sie schulden. Mietfuchs kennt solche Zahlungen nicht: Bei „tatsächlich gezahlt“ zählen nur die Zahlungen, die Sie im Mietkonto erfasst haben, und bei den Werbungskosten nur Ihre Kostenpositionen. Ob die Kosten sofort abziehbar sind oder nur über die Abschreibung, und ob auch Arbeiten dazugehören, die der Mieter nach dem Mietvertrag ohnehin schuldet, klären Sie bitte mit Ihrem Steuerberater.',
  },
  vacancy: {
    topic: 'tenants',
    title: 'Leerstand',
    short: 'Eine Wohnung ohne Mieter; ihren Anteil an den Kosten trägt der Vermieter und nicht die übrigen Mieter.',
    example: 'Eine von drei gleich großen Wohnungen steht vier Monate leer: Von 1.200 € Grundsteuer trägt der Vermieter für diese Zeit 400 € × 4/12 = 133,33 €. Beim Personenschlüssel zählt die leere Wohnung je Leerstandstag mit einer Person: Wohnen in den beiden anderen das ganze Jahr 2 und 1 Personen und steht die dritte leer, trägt der Vermieter von 600 € Müllabfuhr 600 € × 365/1.460 = 150 €.',
    norm: 'BGH, Urteil vom 31.05.2006, VIII ZR 159/05 (Grundsatz, am Flächenschlüssel); zum Personenschlüssel BGH, Beschluss vom 08.01.2013, VIII ZR 180/12',
    needed: 'Mietfuchs rechnet ihn von selbst heraus. Sie müssen nur Ein- und Auszug richtig eintragen. Wie eine leere Wohnung beim Personenschlüssel anzusetzen ist, regelt kein Gesetz und ist nicht abschließend geklärt; nach dem BGH kommt es auf den Einzelfall an, und eine fiktive Person für die Zeit des Leerstands kommt in Betracht; im Einzelfall hält er es auch für vertretbar, den Leerstand ganz außer Acht zu lassen. Mietfuchs setzt eine Person je Leerstandstag an; das ist eine Auslegung von Mietfuchs. Bei Kosten, die von der Personenzahl abhängen (etwa Wasser nach Personen), kann eine andere Aufteilung angemessener sein, zum Beispiel in Grund- und Verbrauchskosten.',
  },
  // #259: Die Hinweise `usage.changed` und `usage.tenancy-conflict` verweisen hierher. Das Beispiel rechnet
  // calc-nutzungswechsel.test.ts in derselben Gestalt nach (Fläche, 181 und 184 Tage).
  usageChange: {
    topic: 'tenants',
    title: 'Nutzungswechsel',
    short: 'Ziehen Sie in eine Wohnung ein, die vorher vermietet war, oder vermieten Sie Ihre bisher selbstgenutzte Wohnung, wechselt ihre Nutzung im Laufe des Jahres. Mietfuchs rechnet jeden Abschnitt nach seinen Tagen: in der Zeit der Eigennutzung ist der Anteil Ihr Eigenanteil, in der vermieteten Zeit trägt ihn der Mieter, und eine Zeit ohne Mieter ist Leerstand.',
    example: 'Grundsteuer 1.000 € nach Fläche, Ihre Wohnung hat 80 von 200 m². Sie wohnen dort bis 30.06.2025 und vermieten ab 01.07.2025: Ihr Eigenanteil ist 1.000 € × 80/200 × 181/365 = 198,36 €, der Mieter trägt 1.000 € × 80/200 × 184/365 = 201,64 €.',
    norm: '§ 556a Abs. 1 BGB (Verteilung nach dem Anteil der Wohnfläche); zum Leerstand BGH, Urteil vom 31.05.2006, VIII ZR 159/05. Steuerlich sind Aufwendungen für eine zunächst selbst bewohnte, danach leer stehende Wohnung nur abziehbar, wenn der Entschluss zu vermieten durch ernsthafte und nachhaltige Vermietungsbemühungen belegt ist (BFH, Urteil vom 28.10.2008, IX R 1/07).',
    needed: 'Wenn eine Einheit im Jahr die Nutzung wechselt. Tragen Sie den Wechsel in den Stammdaten der Einheit unter „Nutzungswechsel“ mit dem Tag ein, ab dem die neue Nutzung gilt; die Angabe „Nutzung“ gilt dann bis zum ersten Wechsel. Ein Mietverhältnis zählt nur in der vermieteten Zeit. Mietfuchs nimmt an, dass die Kosten gleichmäßig über das Jahr anfallen, und teilt sie nach Tagen; das ist eine Auslegung von Mietfuchs.',
  },
  // #258: Die Hinweise `allocation.not-agreed` und `allocation.other-unanswered` verweisen hierher. Das Beispiel ist
  // das aus calc-vertrag.test.ts.
  notAgreedCosts: {
    topic: 'costs',
    title: 'Nicht vereinbarte Betriebskosten',
    short: 'Betriebskosten trägt ein Mieter nur, soweit sein Mietvertrag es vereinbart. Legt der Vertrag eine Kostenart nicht um, trägt ihren Anteil der Vermieter und nicht die übrigen Mieter.',
    example: 'Zwei Wohnungen mit je 50 m², Gartenpflege 1.000 € nach Fläche. Der Vertrag von Mieter A nennt die Gartenpflege nicht: A trägt 0 €, Mieter B wie bisher 1.000 € × 50/100 = 500 €, und die übrigen 500 € trägt der Vermieter. Nähme man die Wohnung von A aus den Teilnehmern der Position, trüge B die ganzen 1.000 €; das wäre zu viel.',
    norm: '§ 556 Abs. 1 Satz 1 BGB; zur Aufzählung einzelner Kostenarten BGH, Urteil vom 10.10.2007, VIII ZR 279/06. Dass der Anteil beim Vermieter bleibt, ist eine Auslegung von Mietfuchs nach dem Grundsatz zum Leerstand (BGH, Urteil vom 31.05.2006, VIII ZR 159/05).',
    needed: 'Nur wenn ein Mietvertrag einzelne Kostenarten aufzählt und eine davon fehlt, oder bei sonstigen Betriebskosten, die er nicht beim Namen nennt. Verweist der Vertrag allgemein auf die Betriebskosten, trägt der Mieter die Kostenarten der Betriebskostenverordnung außer den sonstigen (BGH, Urteil vom 10.02.2016, VIII ZR 137/15). Tragen Sie bei der Kostenposition ein, welches Mietverhältnis sie laut Vertrag nicht trägt; Mietfuchs rechnet den Anteil dann Ihnen zu und lässt die Position in der Abrechnung dieses Mieters weg.',
  },
  namedOtherCosts: {
    topic: 'costs',
    title: 'Sonstige Betriebskosten im Mietvertrag benannt',
    short: 'Sonstige Betriebskosten (§ 2 Nr. 17 BetrKV), etwa die Dachrinnenreinigung, trägt ein Mieter nur, wenn sein Mietvertrag sie ausdrücklich beim Namen nennt; ein Verweis auf die Betriebskostenverordnung genügt dafür nicht.',
    example: 'Dachrinnenreinigung 200 € nach Fläche, zwei Wohnungen mit je 50 m². Nennt nur der Vertrag von Mieter B die Dachrinnenreinigung, trägt B 200 € × 50/100 = 100 €; den Anteil von Mieter A über 100 € trägt der Vermieter.',
    norm: '§ 556 Abs. 1 BGB, § 2 Nr. 17 BetrKV; BGH, Urteil vom 07.04.2004, VIII ZR 167/03',
    needed: 'Nur wenn Sie Kosten unter der Kostenart Sonstige Betriebskosten erfassen. Mietfuchs fragt dann je Mieter, ob sein Vertrag die Position nennt; ohne Antwort verteilt es wie erfasst und weist in der Abrechnung darauf hin. Gehört die Position eigentlich zu einer anderen Kostenart, wählen Sie diese.',
  },
  // #204: Der Hinweis „Mietverhältnisse überschneiden sich“ verweist hierher. Keine Rechtsgrundlage:
  // Es geht um einen Fehler in den erfassten Daten, nicht um eine Regel.
  tenancyOverlap: {
    topic: 'tenants',
    title: 'Überschneidende Mietverhältnisse',
    short: 'Zwei Mietverhältnisse derselben Wohnung bestehen laut Ihren Angaben an mindestens einem Tag zugleich; für diese Zeit wird die Wohnung doppelt berechnet.',
    example: 'Auszug am 30.09. eingetragen, Nachmieter ab 01.09.: Bei 1.200 € Grundsteuer und einer Wohnung mit 50 von 100 m² tragen beide Mieter für dieselben 30 Tage je 1.200 € × 50/100 × 30/365 = 49,32 €, die Wohnung also 49,32 € zu viel.',
    needed: 'Nur wenn es Ihnen angezeigt wird. Meist ist ein Datum vertippt: Berichtigen Sie dann Auszug oder Einzug in den Stammdaten. Für den Wechsel gibt es dort den Mieterwechsel, der die Daten lückenlos setzt. Mietfuchs rechnet bis dahin wie erfasst.',
  },
  personDays: {
    topic: 'costs',
    title: 'Personentage',
    short: 'Beim Personenschlüssel zählt, wie viele Personen wie viele Tage im Jahr in der Wohnung gewohnt haben.',
    example: 'Zwei Personen das ganze Jahr sind 2 × 365 = 730 Personentage; zieht im Juli eine dritte ein, kommen 1 × 184 dazu.',
    needed: 'Nur beim Umlageschlüssel „Personen“. Tragen Sie Änderungen der Personenzahl mit Datum ein. Tage, an denen eine Wohnung leer steht, zählen mit einer Person; diesen Anteil tragen Sie als Vermieter (siehe Leerstand).',
  },
  prepayment: {
    topic: 'tenants',
    title: 'Vorauszahlung',
    short: 'Ein monatlicher Betrag auf die Nebenkosten, über den einmal im Jahr abgerechnet wird; danach gibt es eine Nachzahlung oder ein Guthaben. Abgezogen werden die Vorauszahlungen, die der Mieter für den Abrechnungszeitraum tatsächlich geleistet hat.',
    example: '150 € im Monat sind 1.800 € im Jahr. Betragen die Kosten 2.000 €, zahlt der Mieter 200 € nach.',
    norm: '§ 556 Abs. 2 und 3, § 560 Abs. 4 BGB; BGH, Urteil vom 18.05.2011, VIII ZR 240/10',
    needed: 'Ja, wenn der Mietvertrag Vorauszahlungen vorsieht, der Normalfall. Mietfuchs setzt die vereinbarte Staffel an, im Ein- und Auszugsmonat anteilig nach Kalendertagen. Hat der Mieter anders gezahlt, tragen Sie die gezahlte Summe in der Abrechnung mit „✎ anpassen“ ein. Nach der Abrechnung dürfen Sie die Vorauszahlung angemessen anpassen. Das Anschreiben nennt dazu den Monat, ab dem sie gilt; Vorgabe ist der übernächste Monat nach dem Tag des Briefs. Das ist eine vorsichtige Entscheidung von Mietfuchs, denn § 560 Abs. 4 BGB nennt keine Frist (nach AG Mannheim, Urteil vom 06.02.2008, 8 C 552/06, wirkt die Anpassung schon zum nächsten Fälligkeitstermin). Nach dem Abschluss trägt „In die Staffel übernehmen“ die angekündigte Vorauszahlung als Stufe ein.',
  },
  // #281: Mietkonto und Hinweis „Rückstand im Mietkonto“ verteilen Zahlungen nach § 366 BGB (server/src/rentAllocation.ts).
  // #312 PR 3 ergänzt den Eintrag um die Steuer (Anlage V).
  paymentOrder: {
    topic: 'tenants',
    title: 'Tilgungsreihenfolge',
    short: 'Zahlt ein Mieter nicht genau die Monatsmiete, bestimmt § 366 BGB, welche Schuld die Zahlung tilgt: der Monat, den der Mieter angibt, sonst zuerst die offenen Vorauszahlungen, dann Kaltmiete und Pauschale, jeweils die ältesten zuerst.',
    example: 'Offen sind 600 € Kaltmiete und 200 € Vorauszahlung für Januar. Der Mieter überweist 300 € ohne Verwendungszweck: 200 € tilgen die Vorauszahlung, 100 € die Kaltmiete; offen bleiben 500 € Kaltmiete. Schreibt er „Miete Februar“, tilgt die Zahlung zuerst die Vorauszahlung und dann die Kaltmiete des Februars.',
    norm: '§ 366 BGB; BGH, Urteil vom 21.03.2018, VIII ZR 84/17, Rn. 53 bis 57 (Vorauszahlung ist die unsicherere Forderung, Anrechnung auf die ältesten Rückstände). Dass die Pauschale wie die Kaltmiete zur sichereren Klasse zählt, ist eine Auslegung von Mietfuchs, denn über sie wird nie abgerechnet.',
    needed: 'Ja, sobald Sie Zahlungen im Mietkonto erfassen. Nennt der Mieter in der Überweisung einen Monat, tragen Sie ihn an der Zahlung bei „Für Monat (laut Verwendungszweck)“ ein; einen Dauerauftrag über genau die Monatsmiete wertet Mietfuchs nicht als solche Angabe. Ist die Abrechnung eines Zeitraums erteilt oder ihre Frist abgelaufen, lassen sich offene Vorauszahlungen daraus nicht mehr einzeln verlangen, nur noch der Saldo der Abrechnung; das Mietkonto zeigt sie dann gesondert. Haben Sie Zahlungen erst ab einem bestimmten Monat erfasst, beginnt das Mietkonto im Monat der ersten im Objekt erfassten Mietzahlung; frühere Monate gelten als nicht erfasst und nicht als offen, danach zählt jeder Monat.',
  },
  // #311: Der Hinweis „Vorauszahlung im angebrochenen Monat“ verweist hierher. Die Monatsregel ist eine
  // Auslegung von Mietfuchs (Entscheidung R-1); die Alternative 1/30 steht ausdrücklich daneben.
  partialMonth: {
    topic: 'tenants',
    title: 'Angebrochener Monat',
    short: 'Beginnt oder endet das Mietverhältnis im Lauf eines Monats, setzt Mietfuchs Miete, Vorauszahlung und Pauschale dieses Monats nach Kalendertagen an.',
    example: 'Einzug am 15.03., 150 € Vorauszahlung im Monat: 17 von 31 Tagen sind 150 € × 17/31 = 82,26 €. Auszug am 15.06.: 15 von 30 Tagen sind 75,00 €.',
    norm: 'Weder ein Gesetz noch eine Entscheidung des BGH regelt die Methode. Anteilig nach Kalendertagen ist eine Auslegung von Mietfuchs, gewählt, weil Mietfuchs auch die Kosten nach Kalendertagen verteilt. Ebenso vertretbar ist ein Tagessatz von 1/30 der Monatsrate nach der Wertung des § 191 BGB; er ergibt im Beispiel 85,00 € statt 82,26 €, bei Einzug am 15.02.2025 70,00 € statt 75,00 €.',
    needed: 'Nur bei Ein- oder Auszug im Lauf eines Monats. Regelt Ihr Mietvertrag es anders, oder hat der Mieter anders gezahlt, tragen Sie die gezahlte Summe in der Abrechnung bei „abzüglich geleisteter Vorauszahlungen“ mit „✎ anpassen“ ein. Maßgeblich ist, was der Mieter tatsächlich gezahlt hat.',
  },
  flatRate: {
    topic: 'tenants',
    title: 'Betriebskostenpauschale',
    short: 'Ein fester monatlicher Betrag für die Nebenkosten, über den nicht abgerechnet wird; es gibt weder Nachzahlung noch Guthaben.',
    example: '120 € Pauschale im Monat sind 1.440 € im Jahr, gleich was die Kosten tatsächlich betragen.',
    norm: '§ 556 Abs. 2, § 560 Abs. 1 und 3 BGB',
    needed: 'Nur wenn der Mietvertrag eine Pauschale vereinbart. Erhöhen dürfen Sie sie nur, wenn der Vertrag das vorsieht und die Kosten tatsächlich gestiegen sind, mit einer begründeten Erklärung in Textform; sinken die Kosten, müssen Sie sie senken.',
  },
  inclusiveRent: {
    topic: 'tenants',
    title: 'Inklusivmiete',
    short: 'Die Nebenkosten stecken in der Miete und werden weder gesondert ausgewiesen noch abgerechnet; steckt auch die Heizung darin, spricht man von einer Bruttowarmmiete. Nicht zu verwechseln mit der „Warmmiete“ im Alltag, die meist Kaltmiete plus Vorauszahlungen mit Abrechnung meint.',
    example: '750 € Miete im Monat einschließlich aller Nebenkosten: Es gibt keine Abrechnung, die Kosten trägt der Vermieter aus den 9.000 € Jahresmiete.',
    needed: 'Nur bei solchen Verträgen, häufig bei möblierten Zimmern oder Einliegerwohnungen. Für die Heizung gilt die Heizkostenverordnung trotzdem; eine Warmmiete ist nur im Haus mit höchstens zwei Wohnungen wirksam, von denen Sie eine selbst bewohnen, oder in den Ausnahmen des § 11 (siehe dort).',
  },
  heatingCostOrdinance: {
    topic: 'heating',
    title: 'Heizkostenverordnung',
    short: `Heizkosten müssen zu ${SHARE.min} bis ${SHARE.max} Prozent nach Verbrauch verteilt werden, der Rest nach Fläche oder umbautem Raum; beim Warmwasser der Rest nur nach Fläche. Die Verordnung geht einer anderen Vereinbarung im Mietvertrag vor.`,
    example: `3.000 € Heizkosten, 70 % nach Verbrauch: 2.100 € nach den Messwerten, 900 € nach Wohnfläche. Wird nicht nach Verbrauch abgerechnet, etwa nur nach Fläche, darf der Mieter seinen Anteil um ${CUT} % kürzen. Unabhängig davon darf er um ${REMOTE_CUT} % kürzen, wenn Zähler nicht fernablesbar sind, obwohl sie es sein müssten (neue Geräte seit Dezember 2021, alle übrigen ab 2027), oder wenn die vorgeschriebenen Verbrauchsinformationen fehlen.`,
    norm: '§§ 1, 2, 5, 6a, 7, 8, 11, 12 HeizkostenV',
    needed: 'Bei einer Zentralheizung, bei Fernwärme und bei zentraler Warmwasserbereitung, nicht bei Etagenheizungen oder Gasthermen in der Wohnung (§ 1 Abs. 1 HeizkostenV), gleich wer den Gasvertrag hat. Im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, dürfen Sie mit dem Mieter etwas anderes vereinbaren, etwa eine Warmmiete; ohne solche Vereinbarung gilt die Verordnung auch dort. Wenige weitere Ausnahmen nennt § 11, etwa wenn die Messung unverhältnismäßig teuer wäre. Wärmepumpen sind seit Oktober 2024 nicht mehr ausgenommen. Nicht fernablesbare Zähler und Heizkostenverteiler müssen bis zum 31.12.2026 nachgerüstet oder getauscht sein; klären Sie das bitte mit Ihrem Messdienst. Ab dem Abrechnungsjahr 2027 erinnert Mietfuchs in der Abrechnung daran.',
  },
  // Heizung PR 15 (#212). Leitsatz und Rn. 13 bis 15 von BGH, Urteil vom 03.06.2016, V ZR 166/15, am
  // 05.10.2026 und 09.10.2026 gelesen; BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz c
  // und Gründe II.4 am 09.10.2026 gelesen (Volltext ohne Randnummern, deshalb ohne Randnummer zitiert).
  // Die Spannen der Literatur sind keine Rechtswerte und stehen nur hier (Entwurf 4.3 letzter Absatz);
  // law-literals.test.ts nennt sie als erlaubte Stellen. „oder höchstens 5 %“ bewusst so (P-K7).
  // Wärmepumpe und Stromheizung (R2-W1, R-W2): Der Strom zur Wärmeerzeugung steht in § 7 Abs. 2
  // HeizkostenV neben den Brennstoffen; das Herausrechnen aus dem Allgemeinstrom ist Auslegung. Pumpen und
  // Regelung über den Hauszähler bleiben Betriebsstrom (V ZR 166/15 Rn. 13).
  // #266: die Angabe an der Anlage und der Zwischenzähler (Rechtsprüfung des Plans, M-1; VIII ZR 27/07); die
  // Beschriftungen kommen aus shared/operatingPower.ts, damit Lexikon und Karte wortgleich sind.
  operatingPower: {
    topic: 'heating',
    title: 'Betriebsstrom der Heizung',
    short: 'Der Strom für Brenner, Umwälzpumpe und Regelung einer Zentralheizung gehört zu den Heiz- und Warmwasserkosten und wird mit ihnen nach der Heizkostenverordnung verteilt, nicht als Allgemeinstrom. Hat er keinen eigenen Stromvertrag, steckt er in der Stromrechnung des Hauses; dann ist er dort herauszurechnen und abzuziehen.',
    example: 'Brenner 120 W an 6 Stunden am Tag, Umwälzpumpe 45 W und Regelung 5 W rund um die Uhr, an 220 Heiztagen: 158,4 + 237,6 + 26,4 = 422,4 kWh. Die Stromrechnung des Hauses nennt 3.000 kWh für 1.050,00 €; auf die Heizung entfallen 422,4 von 3.000 kWh, also 147,84 € (Anteil am Rechnungsbetrag einschließlich Grundpreis; das ist eine Festlegung im Schätzermessen, keine Vorgabe des Gesetzes). Diese 147,84 € stehen als Betriebsstrom bei den Heizkosten und als Abzug beim Allgemeinstrom, und die Mieter zahlen den Strom nur einmal. Für Wohnungseigentümer lässt der Bundesgerichtshof auch einen Bruchteil der Brennstoffkosten als Schätzgrundlage zu und nennt dazu Werte aus der Literatur (3–6 % Jennißen, 4–10 % Schmidt-Futterer/Lammel, 8–10 % Wall oder höchstens 5 % Gies), legt aber selbst keinen Wert fest. Gemeint ist ein Bruchteil der Brennstoffkosten, nicht des Allgemeinstroms.',
    norm: '§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; § 2 Nr. 4 Buchst. a, Nr. 5 Buchst. a und Nr. 11 BetrKV; BGH, Urteil vom 03.06.2016, V ZR 166/15; BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07 (Leitsatz c)',
    needed: `Ja, wenn der Strom der Heizung über den Zähler des Hauses läuft: Dann gehört sein Anteil zu den Heizkosten, oder Sie tragen ihn selbst; im Allgemeinstrom darf er nicht stehen. Ohne Zwischenzähler ist der Anteil zu schätzen; das hat der Bundesgerichtshof auch für Mietverhältnisse entschieden. Für Wohnungseigentümer hat der Bundesgerichtshof entschieden, dass die Wahl des Verfahrens in ihrem Ermessen liegt, solange es nicht offenkundig ungeeignet ist. Er nennt eine Berechnung aus dem Stromverbrauchswert der angeschlossenen Geräte und den Heiztagen sowie einen Bruchteil der Brennstoffkosten (BGH, Urteil vom 03.06.2016, V ZR 166/15, Rn. 14). Dass Sie als Vermieter dieselbe Wahl haben, ist eine Auslegung von Mietfuchs; entschieden ist für Mietverhältnisse, dass Sie schätzen dürfen und die Grundlagen offenlegen müssen. Die Karte „Betriebsstrom“ rechnet nach Leistung und Heiztagen, nimmt den Zwischenzähler oder Ihren selbst geschätzten Betrag; einen Prozentsatz gibt Mietfuchs nicht vor. Bewahren Sie die Angaben auf: Bestreitet ein Mieter den Betrag, müssen Sie die Grundlagen Ihrer Schätzung darlegen (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz c). Mietfuchs speichert sie an beiden Positionen. Bei einer Wärmepumpe oder Stromheizung gehört der Strom, den Wärmepumpe oder Elektrokessel zur Wärmeerzeugung verbrauchen, zu den Heizkosten, aber nicht als Betriebsstrom (§ 7 Abs. 2 HeizkostenV: „Kosten des zur Wärmeerzeugung verbrauchten Stroms“); läuft er über den Zähler des Hauses, ist auch er beim Allgemeinstrom herauszurechnen (Auslegung von Mietfuchs; entschieden hat der Bundesgerichtshof es für den Betriebsstrom). Laufen dort Umwälzpumpen oder Regelung über den Stromzähler des Hauses, ist deren Strom Betriebsstrom und beim Allgemeinstrom abzuziehen (§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV). Bei Fernwärme gilt dasselbe für Pumpen und Regelung der Hausanlage (§ 7 Abs. 4, § 8 Abs. 4 HeizkostenV). Ein Zwischenzähler hinter dem Stromzähler des Hauses ist kein eigener Stromvertrag: Sein Strom steckt in der Stromrechnung des Hauses und ist beim Allgemeinstrom abzuziehen; der Zwischenzähler erspart nur das Schätzen. Mietfuchs weist auf der Abrechnung darauf hin, wenn eine Zentralheizung mit Brenner keinen Betriebsstrom hat und beim Allgemeinstrom nichts abgezogen ist. Wie der Betriebsstrom erfasst ist, geben Sie auf der Seite Heizkosten an („${OPERATING_POWER_HANDLING_QUESTION}“). Ohne diese Angabe schweigt der Hinweis, sobald für die Anlage irgendeine Heizposition mit dem Teil „Betrieb“ erfasst ist, auch wenn es nur die Wartung ist. Mit „${OPERATING_POWER_HANDLING_LABELS.deducted}“ kommt er, wenn der Abzug fehlt, auch wenn die Wartung erfasst ist; mit „${OPERATING_POWER_HANDLING_LABELS.ownMeter}“ kommt er, wenn keine Heizposition „Betrieb“ erfasst ist; mit „${OPERATING_POWER_HANDLING_LABELS.landlordPays}“ schweigt er. Der Hinweis schweigt auch bei Fernwärme und bei Wärmelieferung durch einen Contractor sowie bei einer Heizung mit Messdienst, denn dort steckt der Betriebsstrom meist im Preis des Lieferanten oder in den Beträgen des Messdienstes. Laufen Pumpen oder Regelung der Hausanlage über den Stromzähler des Hauses, gehört ihr Strom zu den Kosten der Hausanlage (§ 7 Abs. 4, § 8 Abs. 4 HeizkostenV) und ist beim Allgemeinstrom abzuziehen. Bei einer Wärmepumpe oder einem Elektrokessel weist Mietfuchs darauf hin, wenn keine Rechnung über deren Strom erfasst ist und beim Allgemeinstrom nichts abgezogen ist. Tragen Sie den Betriebsstrom selbst, mindert der Abzug nur die Abrechnung an die Mieter: Bezahlt haben Sie die ganze Stromrechnung, und sie gehört zu Ihren Werbungskosten, soweit Sie das Haus vermieten (§ 9 Abs. 1 Satz 1 EStG). Die Steuerübersicht rechnet das von selbst, in der Zeile „Betriebsstrom der Heizung“. Der Abzug zählt dort im Jahr, in dem Sie die Stromrechnung bezahlt haben, denn er teilt nur die Rechnung auf; das gilt auch, wenn der Betriebsstrom bei den Heizkosten in einem anderen Jahr steht. Heizt eine Anlage mit Messdienst, geben Sie am Abzug an, ob der Betrag dem Messdienst als Betriebsstrom gemeldet ist (dann steckt er in dessen Beträgen) oder ob Sie ihn selbst tragen; nur im zweiten Fall rechnet die Steuerübersicht ihn hinzu.`,
  },
  heatingSystem: {
    topic: 'heating',
    title: 'Heizanlage',
    short: 'Die Anlage, die das Haus mit Wärme und meist auch mit Warmwasser versorgt, etwa ein Gaskessel im Keller, eine Wärmepumpe oder der Anschluss an die Fernwärme. An der Heizanlage sagen Sie Mietfuchs, womit geheizt wird, wer die Heizkostenabrechnung erstellt und welche Wohnungen angeschlossen sind.',
    example: 'Ein Haus mit drei Wohnungen und Gaszentralheizung, abgerechnet vom Messdienst: Sie legen eine Heizanlage „Gas“ an und übernehmen die 3.600 € der Messdienstabrechnung wie bisher als Einzelbeträge, etwa 1.400 €, 1.200 € und 1.000 €. An diesen Beträgen ändert die Heizanlage nichts.',
    norm: '§ 1 HeizkostenV',
    needed: 'Nicht nötig, solange Sie die Heizkosten wie bisher erfassen. Mit den Angaben an der Heizanlage kann Mietfuchs sagen, ob Mieter wegen nicht fernablesbarer Geräte kürzen dürfen, und später die CO₂-Kosten und eine eigene Heizkostenabrechnung rechnen. Hat jede Wohnung eine eigene Heizung mit eigenem Vertrag des Mieters, gibt es keine Heizanlage des Hauses.',
  },
  heatCostAllocator: {
    topic: 'heating',
    title: 'Heizkostenverteiler',
    short:
      'Ein kleines Gerät am Heizkörper, das anzeigt, wie viel dieser Heizkörper im Verhältnis zu den übrigen geheizt hat. Seine Werte sind keine Kilowattstunden, sondern Einheiten, die erst mit den Werten aller Geräte des Hauses etwas bedeuten. ' +
      'Bei der Einheitsskala wird der Ablesewert mit dem Bewertungsfaktor des Heizkörpers malgenommen; die Abrechnung nennt den Faktor, damit der Mieter sie nachprüfen kann, so machen es die Messdienste. Bei der Produktskala ist er schon eingerechnet. ' +
      'Elektronische Geräte setzen am Stichtag auf null und speichern den Wert des Stichtags. ' +
      `Geräte, die nach dem ${NEW_DEVICES_AFTER} eingebaut wurden, müssen aus der Ferne ablesbar sein, alle übrigen ab dem ${RETROFIT_FROM}.`,
    example:
      `Im Wohnzimmer zeigt ein Verteiler mit Einheitsskala ${hcaDe(HCA.livingRaw)}, sein Bewertungsfaktor ist ${hcaDe(HCA.livingFactor)}: das sind ${hcaDe(HCA_LIVING)} Einheiten. ` +
      `Im Bad zeigt einer ${hcaDe(HCA.bathRaw)} bei Faktor ${hcaDe(HCA.bathFactor)}: ${hcaDe(HCA_BATH)} Einheiten. ` +
      `Die Wohnung hat damit ${hcaDe(HCA_FLAT)} von ${hcaDe(HCA.houseUnits)} Einheiten des Hauses, also ein Zehntel der Kosten nach Verbrauch, bei ${hcaDe(HCA.consumptionEuro)} € also ${hcaDe((HCA.consumptionEuro * HCA_FLAT) / HCA.houseUnits)} €. ` +
      `Ist das Gerät nicht fernablesbar, obwohl es das sein müsste, darf der Mieter seinen Anteil an den Heizkosten um ${REMOTE_CUT} % kürzen.`,
    norm: '§§ 5, 12 HeizkostenV',
    needed:
      'Wenn Ihr Haus Heizkostenverteiler hat. Rechnet ein Messdienst ab, übernehmen Sie seine Beträge als Einzelbeträge. ' +
      'Rechnen Sie selbst ab und lesen elektronische Geräte selbst ab, tragen Sie an jedem Gerät Skala und Bewertungsfaktor ein, und zum Stichtag den Stichtagswert laut Anzeige. Skala und Faktor finden Sie in der Geräteliste des Messdienstes oder in den Unterlagen des Herstellers. Ein Gerät mit anderem Faktor ist ein neues Gerät. ' +
      'Verwenden dürfen Sie nur Geräte, deren Eignung eine sachverständige Stelle bestätigt hat (§ 5 Abs. 1 Satz 2 HeizkostenV); der Faktor hängt am Heizkörper und ist fachgerecht zu ermitteln, etwa vom Messdienst. ' +
      'Verdunster wertet Mietfuchs nicht selbst aus; übernehmen Sie dafür die Werte des Ablesedienstes je Wohnung und Nutzungszeitraum. ' +
      `Eine Zwischenablesung bei Verdunstern empfiehlt die Arbeitsgemeinschaft Heiz- und Wasserkostenverteilung in der Regel nur, wenn seit der Hauptablesung ${EVAPORATOR.min} bis ${EVAPORATOR.max} ‰ der Gradtagszahlen vergangen sind. Verdunster lassen sich nicht aus der Ferne ablesen; nicht fernablesbare Geräte müssen bis zum ${germanDate(dayBeforeIso(onlyVersion(hkvRemoteReadingRetrofit).validFrom ?? ''))} ersetzt oder nachgerüstet sein. ` +
      'Tragen Sie am Zähler ein, ob das Gerät fernablesbar ist und wann es eingebaut wurde; dann sagt die Abrechnung, ob Mieter kürzen dürfen.',
  },
  serviceReading: {
    topic: 'heating',
    title: 'Ablesedienst',
    short: 'Ein Unternehmen, das die Geräte in den Wohnungen abliest und Ihnen die Werte je Wohnung und Nutzungszeitraum nennt, ohne selbst die Heizkosten abzurechnen. Bei Heizkostenverteilern nennt es bewertete Einheiten, also die Summe nach den Bewertungsfaktoren der Heizkörper.',
    example: 'Der Dienst meldet für Wohnung A vom 01.01. bis 30.09. 340 Einheiten und für den Nachmieter vom 01.10. bis 31.12. 100 Einheiten. Sie tragen beide Zeilen ein; Mietfuchs verteilt die Kosten nach Verbrauch nach diesen Einheiten.',
    norm: '§§ 5, 6 HeizkostenV',
    needed: 'Wenn ein Dienst Ihre Geräte abliest, Sie die Heizkosten aber selbst abrechnen. Rechnet der Dienst auch ab, übernehmen Sie seine Beträge als Einzelbeträge.',
  },
  evaporator: {
    topic: 'heating',
    title: 'Verdunster',
    short: 'Ein älterer Heizkostenverteiler mit einer Flüssigkeit in einem Glasröhrchen, die je nach Wärme des Heizkörpers verdunstet. Der Ablesedienst tauscht das Röhrchen jährlich und wertet es aus; Mietfuchs übernimmt seine Werte. Verdunster lassen sich nicht aus der Ferne ablesen.',
    example: `Ein Verdunster zeigt am Stichtag 12 Striche; der Ablesedienst rechnet sie mit dem Bewertungsfaktor des Heizkörpers in Einheiten um und nennt Ihnen die Summe je Wohnung. Ist er nicht bis zum ${germanDate(dayBeforeIso(onlyVersion(hkvRemoteReadingRetrofit).validFrom ?? ''))} durch ein fernablesbares Gerät ersetzt, darf der Mieter um ${REMOTE_CUT} % kürzen.`,
    norm: '§ 5 Abs. 3, § 12 Abs. 1 Satz 2 HeizkostenV',
    needed: `Wenn Ihr Haus noch Verdunster hat. Eine Zwischenablesung empfiehlt die Arbeitsgemeinschaft Heiz- und Wasserkostenverteilung in der Regel nur, wenn seit der Hauptablesung ${EVAPORATOR.min} bis ${EVAPORATOR.max} ‰ der Gradtagszahlen vergangen sind; sonst wird nach Gradtagen geteilt.`,
  },
  co2Split: {
    topic: 'co2',
    title: 'CO₂-Kostenaufteilung',
    short: 'Seit 2023 tragen Vermieter einen Teil der CO₂-Kosten der Heizung, und zwar umso mehr, je mehr CO₂ das Gebäude je Quadratmeter Wohnfläche ausstößt. Die Heizkostenabrechnung muss den Anteil des Mieters, die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen.',
    example: `600 € CO₂-Kosten in der Gasrechnung, 24.105,6 kg CO₂ bei 600 m² Wohnfläche: 40,2 kg je m², Stufe ${B1.range}. Der Vermieter trägt ${B1.percent} % der CO₂-Kosten, also ${(600 * B1.percent) / 100} €, die Mieter tragen ${600 - (600 * B1.percent) / 100} €. Fehlt die Aufteilung in der Heizkostenabrechnung, darf jeder Mieter seinen Anteil an den Heizkosten um ${CO2_CUT} % kürzen.`,
    norm: '§§ 5, 7 CO2KostAufG',
    needed: `Ja, wenn Sie mit Gas, Heizöl, Flüssiggas oder Kohle heizen oder Ihr Wärmelieferant CO₂-Kosten ausweist, für jeden Abrechnungszeitraum, der am oder nach dem ${CO2_FROM} beginnt. Rechnet ein Messdienst oder die Gemeinschaft ab, übernehmen Sie deren Angaben auf der Seite Heizkosten.`,
  },
  co2Stage: {
    topic: 'co2',
    title: 'Einstufung (CO₂-Stufe)',
    short: `Der CO₂-Ausstoß des Gebäudes in Kilogramm je Quadratmeter Wohnfläche und Jahr, auf ${CO2_DECIMALS === 1 ? 'eine Nachkommastelle' : `${CO2_DECIMALS} Nachkommastellen`} gerundet, ordnet das Gebäude einer von ${STAGES.length} Stufen zu. Die Stufe sagt, welchen Anteil der CO₂-Kosten der Vermieter trägt: von ${FIRST.landlordPercent} % unter ${SECOND.from} kg bis ${LAST.landlordPercent} % ab ${LAST.from} kg.`,
    example: `24.105,6 kg CO₂ bei 600 m² ergeben 40,176 kg je m², gerundet 40,2: Stufe ${B1.range}, der Vermieter trägt ${B1.percent} %. Ist ein Abrechnungszeitraum von unter einem Jahr vereinbart, werden die Grenzen der Tabelle anteilig gekürzt.`,
    norm: '§ 5 Abs. 1 und 2, Anlage CO2KostAufG',
    needed: 'Nur zum Prüfen: Die Stufe steht in der Abrechnung des Messdienstes. Mietfuchs ordnet den Wert nach und meldet, wenn der Anteil des Vermieters nicht zur Tabelle passt.',
  },
  co2Area: {
    topic: 'co2',
    title: 'Fläche der CO₂-Einstufung',
    short: 'Die Wohnfläche, durch die der CO₂-Ausstoß des Gebäudes geteilt wird. Das Gesetz sagt nicht, nach welcher Berechnung sie zu bestimmen ist; Mietfuchs nimmt im Zweifel die Fläche aus der Abrechnung des Messdienstes, damit beide Angaben übereinstimmen. Bei Etagenheizungen, deren Gasvertrag der Vermieter hat, zählt die Gesamtwohnfläche der vermieteten Wohnungen mit eigener Heizung (§ 5 Abs. 1 Satz 2 CO2KostAufG).',
    example: '5.421 kg CO₂ bei 200,6 m² laut Messdienst ergeben 27,02 kg je m², gerundet 27,0.',
    norm: '§ 5 Abs. 1 CO2KostAufG',
    needed: 'Nur, wenn Sie die Einstufung prüfen oder die Fläche des Messdienstes von Ihrer abweicht.',
  },
  serviceUnits: {
    topic: 'heating',
    title: 'Nutzeinheit',
    short: 'Jede Wohnung oder sonstige Einheit, die der Messdienst in seiner Heizkostenabrechnung einzeln abrechnet, auch eine leerstehende und Ihre eigene. Die Zahl steht in der Abrechnung, meist in der Kostenaufstellung oder auf dem Deckblatt.',
    example: 'Ein Haus mit vier Wohnungen, eine davon steht leer: Der Messdienst rechnet vier Nutzeinheiten ab. Für die Probe in der Karte „CO₂-Kosten“ darf die Summe der eingetragenen Beträge wegen der Rundung je Nutzeinheit um bis zu 4 · 2 ct = 8 ct über der gedruckten Summe liegen.',
    needed: 'Nur für die Probe der CO₂-Angaben auf der Seite Heizkosten.',
  },
  co2Deducted: {
    topic: 'co2',
    title: 'Abzugszeile (Vorwegabzug)',
    short: 'Manche Messdienste ziehen den CO₂-Anteil des Vermieters schon in der Kostenaufstellung ab, mit einer Zeile wie „Abzüglich CO₂-Kosten Vermieter“. Die Beträge der Mieter sind dann schon entlastet, und bezahlt haben Sie die Summe der Nutzerkosten plus diesen Anteil.',
    example: 'Die Kostenaufstellung nennt „Anlieferung Brennstoff“ 3.540,00 €, darunter „Abzüglich CO₂-Kosten Vermieter“ 87,50 €, und verteilt 3.452,50 €. Zusammen mit Strom, Wartung und Messdienstkosten ergeben die Kosten aller Nutzer 3.845,51 €; bezahlt haben Sie 3.845,51 € + 87,50 € = 3.933,01 €, und das ist der Betrag Ihrer Position.',
    norm: '§ 7 Abs. 1 CO2KostAufG',
    needed: 'Ja, wenn Ihre Abrechnung eine solche Zeile hat: Dann beantworten Sie die Frage in der Karte „CO₂-Kosten“ auf der Seite Heizkosten mit „Ja“.',
  },
  // Heizung PR 18 (#215). Wortlaut §§ 5a–5d, 6 Abs. 1, 7 Abs. 5 CO2KostAufG und § 43 GModG am 11.10.2026 gelesen.
  // Die Ausnahme nach § 5d Abs. 3 im Wortlaut der Gegenprüfung (M9), das Gebiet statt der Gemeinde (S9), die
  // Mitteilung als Auslegung (S12), die Kündigungssperrfrist (K4) und die Höhe der Kürzung (K8).
  co2HalfSplit: {
    topic: 'co2',
    title: 'Hälftige Teilung ab 2028 (§ 5a CO2KostAufG)',
    short: `Bei einer Gas-, Öl- oder Flüssiggasheizung, die nach dem ${germanDate(HEATING43.installedAfter)} in ein bestehendes Haus eingebaut wurde, tragen Sie ab dem ${germanDate(halfSplitFirstDay())} die Hälfte der Gasnetzentgelte und der CO₂-Kosten statt eines Anteils nach Stufen, ab dem ${germanDate(halfSplitBioFirstDay())} auch die Hälfte der Kosten des vorgeschriebenen Anteils an Biobrennstoff (höchstens für ${(HALF.bioCapPermille ?? 0) / 10} % des Brennstoffs). Abziehen müssen Sie Ihren Anteil in der Heizkostenabrechnung; sonst darf jeder Mieter seinen Anteil an den Heizkosten um ${CO2_CUT} % kürzen (§ 7 Abs. 5 Satz 3, Abs. 4 CO2KostAufG).`,
    example: 'Heizperiode 01.05.2027–30.04.2028, Stufe 40 %, CO₂-Kosten 600 €; nach der Gradtagstabelle fallen 530 ‰ ab dem 01.01.2028 an. Sie tragen 0,47 × 600 € × 40 % + 0,53 × 600 € × 50 % = 271,80 €. Netzentgelte 2028 von 300,00 €: davon tragen Sie 150,00 €.',
    norm: '§§ 5a, 5b, 5d, § 6 Abs. 1 Satz 2, § 7 Abs. 5 CO2KostAufG; § 43 Abs. 1, 7 GModG',
    needed: `Nur bei einer Heizung nach § 43 Abs. 1 GModG und Abrechnungen mit Tagen ab ${halfSplitFirstDay().slice(0, 4)}. Tragen Sie dann den Tag des Einbaus an der Heizung ein und bei jeder Gasrechnung die Netzentgelte. ` +
      'Ausnahmen: Nach einem Notfalleinbau ruht die Teilung zeitweise (§ 5a Abs. 4). ' +
      `In einem Gebäude mit höchstens ${TWO.maxDwellings} Wohnungen, von denen Sie eine selbst bewohnen und die beide über eine gemeinsame Heizung versorgt werden (§ 5d Abs. 3 CO2KostAufG), gilt weiter das Stufenmodell, ` +
      'wenn Sie das dem Mieter in Textform mitgeteilt haben (bei Abschluss des Mietvertrags; bestand der Vertrag schon, bevor die Voraussetzungen eintraten, genügt nach der Begründung in der Regel die Mitteilung mit der Abrechnung; dass die Mitteilung auch für diese Ausnahme nötig ist, ist eine Auslegung, Mietfuchs verlangt sie, damit Sie sicher gehen) ' +
      'und das Gebäude in keinem Gebiet liegt, das eine Verordnung zur Mietpreisbremse (§ 556d BGB), zur Kappungsgrenze (§ 558 Abs. 3 BGB) oder zur Kündigungssperrfrist (§ 577a Abs. 2 BGB) bestimmt; manche Verordnungen nennen nur Teile einer Gemeinde. ' +
      'Einen Härtefall nach § 5d Abs. 1 rechnet Mietfuchs nicht. ' +
      `Biobrennstoff aus einem Vorrat (Heizöl, Flüssiggas im Tank) und die Grenze von ${(HALF.bioCapPermille ?? 0) / 10} % ab ${(bioCapFrom() ?? '').slice(0, 4)} rechnet Mietfuchs noch nicht (#227); die Abrechnung sagt dann, was Sie selbst ermitteln müssen.`,
  },
  // UI-Durchsicht M2: Die Frage am Objekt öffnete vorher die lange Erklärung zur hälftigen Teilung.
  tightMarket: {
    topic: 'tenants',
    title: 'Angespannter Wohnungsmarkt',
    short: 'Ein Gebiet, das eine Verordnung der Landesregierung bestimmt, etwa zur Mietpreisbremse (§ 556d BGB), zur Kappungsgrenze (§ 558 Abs. 3 BGB) oder zur Kündigungssperrfrist (§ 577a Abs. 2 BGB). Manche Verordnungen nennen nur Teile einer Gemeinde, und sie gelten befristet.',
    example: `Zweifamilienhaus, eine Wohnung bewohnen Sie selbst, beide hängen an derselben Gasheizung nach § 43 GModG; CO₂-Kosten eines Jahres ab ${halfSplitFirstDay().slice(0, 4)} von 600 €, Stufe 40 %. Liegt das Haus in keinem solchen Gebiet und haben Sie das dem Mieter in Textform mitgeteilt, tragen Sie nach Stufen 600 € × 40 % = 240,00 €. Liegt es in einem solchen Gebiet, gilt die hälftige Teilung: 600 € × ${(HALF.co2Permille ?? 0) / 10} % = ${deEuro(600 * (HALF.co2Permille ?? 0) / 10)} €.`,
    norm: '§ 556d Abs. 2, § 558 Abs. 3, § 577a Abs. 2 BGB; § 5d Abs. 3 CO2KostAufG; § 43 GModG',
    needed: `Nur bei einer Heizung nach § 43 GModG in einem Haus mit höchstens ${TWO.maxDwellings} Wohnungen, von denen Sie eine selbst bewohnen und die beide über eine gemeinsame Heizung versorgt werden (§ 5d Abs. 3 CO2KostAufG). Dort entscheidet die Antwort, ob für die CO₂-Kosten die hälftige Teilung gilt oder weiter das Stufenmodell. Sonst braucht Mietfuchs die Angabe nicht.`,
  },
  // Heizung PR 19 (#97). Wortlaut § 2 Abs. 7, § 5 Abs. 3, § 6 Abs. 2, 3, § 8 Abs. 2, § 9 CO2KostAufG am 12.10.2026
  // gelesen; Prüfung S2 und K3, Gegenprüfung M1 (auch die zentrale Heizung mit Brennstoffvertrag beim Mieter).
  co2Refund: {
    topic: 'co2',
    title: 'CO₂-Erstattung, wenn der Mieter selbst heizt',
    short: `Hat der Mieter einen eigenen Vertrag für Gas oder Öl, etwa für eine Gastherme in der Wohnung oder eine zentrale Heizung, deren Brennstoff er selbst bezieht, trägt er die CO₂-Kosten zunächst selbst. Den Anteil, den nach dem Stufenmodell der Vermieter trüge, kann er binnen ${SELF.claimMonths} Monaten nach der Abrechnung seines Lieferanten in Textform von Ihnen verlangen; bei einer Heizung nach § 43 GModG ab ${halfSplitFirstDay().slice(0, 4)} die Hälfte der CO₂-Kosten und der Gasnetzentgelte.`,
    example: 'Gasrechnung 2025 des Mieters: 2.400 kg CO₂, Wohnung 80 m², also 30,0 kg je m² und Jahr; das ist die Stufe, in der der Vermieter 40 % trägt. CO₂-Kosten 600 €: Sie erstatten 240,00 €. Kocht der Mieter auch auf einem eigenen Gasherd, den er selbst angeschafft hat, sind es 228,00 €; ein mitvermieteter Herd kürzt nichts.',
    norm: '§ 2 Abs. 7, § 5 Abs. 3, § 6 Abs. 2, § 6 Abs. 3, § 8 Abs. 2, § 9 CO2KostAufG',
    needed: `Nur wenn ein Mieter selbst heizt und den Anspruch anzeigt. Stellen Sie sein Mietverhältnis dann in den Stammdaten unter Heizung auf „Mieter heizt selbst“ und erfassen Sie die Anzeige auf der Seite Kosten unter „CO₂-Erstattung“. ` +
      `Ist mit ihm eine Vorauszahlung auf Betriebskosten vereinbart, können Sie den Betrag in der nächsten Abrechnung nach der Anzeige verrechnen; sonst zahlen Sie spätestens ${SELF.refundMonths} Monate nach der Anzeige aus und tragen den Tag der Auszahlung an der Erstattung ein; die Steuerübersicht führt sie dann im Jahr der Auszahlung als Werbungskosten. ` +
      `Nutzt der Mieter den Brennstoff auch gewerblich, besteht der Anspruch nur, wenn der Wärmeverbrauch getrennt gemessen und nachgewiesen ist; im Nichtwohngebäude sind es ${SELF.nonResidentialPermille / 10} % (§ 8 Abs. 2). ` +
      `Auf den Anspruch müssen Sie den Mieter bei Abschluss eines Mietvertrags ab dem ${germanDate(halfSplitEnactedOn())} und beim Einbau einer Heizung nach § 43 GModG in Textform hinweisen, ebenso auf die Pflicht nach § 43 Abs. 1 GModG (§ 6 Abs. 2 Satz 6). Im Nichtwohngebäude besteht der Anspruch auch, wenn der Mieter nur sein Warmwasser selbst bereitet (§ 8 Abs. 2: „mit Wärme oder Warmwasser“); das bildet Mietfuchs nicht ab. ` +
      'In Gebäuden, für die § 11 der Heizkostenverordnung gilt, ist das CO2KostAufG nicht anzuwenden, wenn keine Abrechnung der Heizkosten vereinbart ist (§ 2 Abs. 7); Mietfuchs rechnet damit nichts.',
  },
  hotWaterShare: {
    topic: 'heating',
    title: 'Warmwasseranteil',
    short:
      'Bereitet die Heizung auch das Warmwasser, wird ein Teil ihrer Kosten dem Warmwasser zugerechnet. Die Wärme dafür ist mit einem Wärmezähler zu messen. ' +
      'Die Formel nach dem Warmwasserverbrauch ist nur erlaubt, wenn das Messen nur mit unzumutbar hohem Aufwand möglich wäre; die Formel nach der Wohnfläche nur, wenn weder die Wärmemenge noch das Volumen des verbrauchten Warmwassers gemessen werden kann. ' +
      'Wird Brennstoff in Litern, Kilogramm oder Kubikmetern abgerechnet, gilt der Heizwert laut Rechnung; die Werte der Heizkostenverordnung nur, wenn die Rechnung keinen nennt, und nur bei Heizkesseln.',
    example:
      `Ein Haus mit ${dhwDe(DHW_EXAMPLE.areaM2)} m² heizt mit Erdgas, abgerechnet nach Brennwert: ${dhwDe(DHW_EXAMPLE.gasKwh)} kWh. Verbraucht wurden ${dhwDe(DHW_EXAMPLE.volumeM3)} m³ Warmwasser zu ${dhwDe(DHW_EXAMPLE.tempC)} °C. ` +
      `Aus dem Volumen: Q = ${dhwDe(DHW_VOLUME.effort, 1)} · ${dhwDe(DHW_EXAMPLE.volumeM3)} · (${dhwDe(DHW_EXAMPLE.tempC)} − ${dhwDe(DHW_VOLUME.coldWaterC)}) = ${dhwDe(DHW_Q_VOLUME)} kWh, ` +
      `wegen der Abrechnung nach Brennwert mal ${dhwDe(DHW_FACTORS.gasCalorific, 2)} = ${dhwDe(DHW_Q_VOLUME * DHW_FACTORS.gasCalorific)} kWh, Anteil ${dhwPct(DHW_Q_VOLUME * DHW_FACTORS.gasCalorific, DHW_EXAMPLE.gasKwh)}. ` +
      `Aus der Fläche: ${dhwDe(DHW_AREA.kwhPerM2)} · ${dhwDe(DHW_EXAMPLE.areaM2)} = ${dhwDe(DHW_Q_AREA)} kWh, mal ${dhwDe(DHW_FACTORS.gasCalorific, 2)} = ${dhwDe(DHW_Q_AREA * DHW_FACTORS.gasCalorific)} kWh, Anteil ${dhwPct(DHW_Q_AREA * DHW_FACTORS.gasCalorific, DHW_EXAMPLE.gasKwh)}. ` +
      `Zeigt der Wärmezähler am Warmwasserspeicher ${dhwDe(DHW_EXAMPLE.measuredKwh)} kWh, gilt der Faktor nach dem Wortlaut nur für die Formeln: ${dhwDe(DHW_EXAMPLE.measuredKwh)} / ${dhwDe(DHW_EXAMPLE.gasKwh)} = ${dhwPct(DHW_EXAMPLE.measuredKwh, DHW_EXAMPLE.gasKwh)}. ` +
      `Wer die gemessene Wärme wie einen Formelwert auf den Brennwert umrechnet, käme auf ${dhwDe(DHW_EXAMPLE.measuredKwh)} · ${dhwDe(DHW_FACTORS.gasCalorific, 2)} / ${dhwDe(DHW_EXAMPLE.gasKwh)} = ${dhwPct(DHW_EXAMPLE.measuredKwh * DHW_FACTORS.gasCalorific, DHW_EXAMPLE.gasKwh)}; ` +
      'welche Lesart die technische Regel meint, ist nicht geklärt (⟨Norm offen: VDI 2077⟩), Mietfuchs rechnet nach dem Wortlaut. ' +
      `Wird ohne zulässigen Grund nach einer Formel abgerechnet, obwohl sich die Wärme ohne unzumutbaren Aufwand messen ließ, darf ein Mieter mit ${dhwDe(DHW_EXAMPLE.shareEuro)} € Heiz- und Warmwasserkosten seinen Anteil um ${CUT} % kürzen, also um ${dhwDe((DHW_EXAMPLE.shareEuro * CUT) / 100)} €.`,
    norm: '§ 9 Abs. 2 und 3, § 9b Abs. 2, § 12 Abs. 1 Satz 1 HeizkostenV; BGH, Urteil vom 12.01.2022, VIII ZR 151/20',
    needed:
      'Wenn Ihre Heizung auch das Warmwasser bereitet. Rechnet ein Messdienst ab und sagt seine Abrechnung, dass die Wärme für das Warmwasser nach einer Formel bestimmt wurde, tragen Sie das auf der Seite Heizkosten ein. ' +
      'Rechnen Sie selbst ab, misst ein Wärmezähler am Warmwasserspeicher die Wärme; ist keiner da, tragen Sie dort das Warmwasser in m³ und seine Temperatur ein, und nur wenn auch das nicht gemessen wird, rechnet Mietfuchs mit der Wohnfläche. ' +
      'Ist die Heizperiode kürzer als ein Jahr, kürzt Mietfuchs den Jahreswert der Flächenformel nach Tagen, so wie die Verordnung Warmwasserkosten beim Nutzerwechsel zeitanteilig teilt (§ 9b Abs. 2 HeizkostenV); eine ausdrückliche Regel dafür gibt es nicht.',
  },
  // Heizung PR 11 (Durchsicht von #240, Recht-I3): wonach die Gasrechnung die Kilowattstunden berechnet.
  gasCalorificBasis: {
    topic: 'heating',
    title: 'Brennwert und Heizwert (Gas)',
    short:
      'Gas wird in Kubikmetern gemessen und in Kilowattstunden abgerechnet. Für die Umrechnung nimmt der Versorger meist den Brennwert, der die Wärme im Wasserdampf der Abgase mitzählt, seltener den Heizwert, der sie nicht mitzählt. ' +
      'Welcher es ist, steht auf der Rechnung bei der Umrechnung von m³ in kWh. Für den Warmwasseranteil nach einer Formel zählt das: Bei Abrechnung nach Brennwert wird der Formelwert mit dem Faktor der Heizkostenverordnung multipliziert.',
    example:
      `Ein Haus braucht nach der Formel 15.000 kWh Wärme für das Warmwasser. Rechnet der Versorger nach Brennwert ab, setzt Mietfuchs 15.000 · ${dhwDe(DHW_FACTORS.gasCalorific, 2)} = ${dhwDe(15000 * DHW_FACTORS.gasCalorific)} kWh gegen die Kilowattstunden der Rechnung, nach Heizwert 15.000 kWh.`,
    norm: '§ 9 Abs. 2 Satz 6 Nr. 1 HeizkostenV',
    needed: 'Wenn Sie die Heizkosten selbst abrechnen, mit Gas heizen und die Wärme für das Warmwasser nach einer Formel bestimmen. Wählen Sie an der Gasrechnung, wonach die Kilowattstunden berechnet sind; steht dort „Brennwert“, wählen Sie „nach Brennwert“.',
  },
  // Heizung PR 10 (#99, Entwurf 10.3): die eigene Heizkostenabrechnung. Zahlen aus Beispiel A (8.6).
  baseCosts: {
    topic: 'heating',
    title: 'Grundkosten',
    short: 'Der Teil der Heiz- oder Warmwasserkosten, der nicht nach Verbrauch, sondern nach Fläche oder umbautem Raum verteilt wird. Bei der Heizung lässt die Verordnung die Wohn- oder Nutzfläche oder den umbauten Raum zu, jeweils auch nur der beheizten Räume; beim Warmwasser nur die Fläche.',
    example: 'Topf Heizung 5.628,00 €, davon 30 % Grundkosten = 1.688,40 €. Eine Wohnung mit 60 von 200 m² trägt davon 506,52 €.',
    norm: '§ 7 Abs. 1 Satz 5, § 8 Abs. 1 HeizkostenV',
    needed: 'Ja, wenn Sie die Heizkosten selbst abrechnen. Mietfuchs rechnet sie aus dem Anteil, den Sie nach Verbrauch verteilen. Wer den umbauten Raum als Maßstab bestimmt oder vereinbart hat, wählt ihn bei der Einrichtung und trägt je Wohnung den Rauminhalt in m³ ein; die Grundkosten des Warmwassers gehen dann weiter nach der Wohnfläche.',
  },
  consumptionCosts: {
    topic: 'heating',
    title: 'Verbrauchskosten',
    short: 'Der Teil der Heiz- oder Warmwasserkosten, der nach dem gemessenen Verbrauch verteilt wird, bei der Heizung nach Kilowattstunden, beim Warmwasser nach Kubikmetern.',
    example: 'Topf Heizung 5.628,00 €, davon 70 % nach Verbrauch = 3.939,60 €. Eine Wohnung mit 12.000 von 40.000 kWh trägt davon 1.181,88 €.',
    norm: '§ 7 Abs. 1 Satz 1, § 8 Abs. 1 HeizkostenV',
    needed: 'Ja, wenn Sie die Heizkosten selbst abrechnen. Ohne Zähler darf jeder Mieter seinen Anteil kürzen. Bei einer Öl- oder Gasheizung in einem Haus mit Wärmeschutz unter dem Niveau von 1994 und überwiegend gedämmten Leitungen ist der Anteil vorgeschrieben (§ 7 Abs. 1 Satz 2 HeizkostenV). Dass eine Flüssiggasheizung dazu zählt, ist eine Auslegung von Mietfuchs: Der Wortlaut sagt „Gasheizung“ ohne Einschränkung, wo die Verordnung Erdgas meint, sagt sie es (§ 9 Abs. 2 Satz 6 und die Tabelle in § 9 Abs. 3), und die Begründung (BR-Drs. 570/08) nennt Öl- und Gasheizungen und grenzt nur gegen Fernwärme ab. Der vorgeschriebene Anteil ist unter beiden Lesarten zulässig.',
  },
  forcedConsumptionShare: {
    topic: 'heating',
    title: 'Pflichtanteil nach Verbrauch',
    short: 'In Gebäuden, die das Anforderungsniveau der Wärmeschutzverordnung vom 16. August 1994 nicht erfüllen, die mit einer Öl- oder Gasheizung versorgt werden und in denen die freiliegenden Leitungen der Wärmeverteilung überwiegend gedämmt sind, ist der Anteil der Heizkosten nach Verbrauch vorgeschrieben; eine Wahl zwischen den Grenzen gibt es dann nicht.',
    example: 'Topf Heizung 5.000,00 €. Gilt der Pflichtanteil, gehen 3.500,00 € nach Verbrauch und 1.500,00 € nach Fläche; mit 50 % wären es je 2.500,00 €.',
    norm: '§ 7 Abs. 1 Satz 2, § 10 HeizkostenV',
    needed: 'Nur bei einer Öl- oder Gasheizung (Flüssiggas zählt nach Auslegung von Mietfuchs dazu, siehe Verbrauchskosten). Wissen Sie nicht, ob die Voraussetzungen vorliegen, liegen Sie mit dem Pflichtanteil in jedem Fall richtig, denn er liegt auch innerhalb der freien Wahl. Mehr geht nur mit einer Vereinbarung (§ 10 HeizkostenV). Den Pflichtanteil nachzutragen ist keine Änderung nach § 6 Abs. 4 und geht auch in einer begonnenen Heizperiode.',
  },
  // #223: die Kosten der Zwischenablesung bei Wasser und anderen Zählern; bei der Heizung steht dasselbe unter
  // „Zwischenablesung“.
  changeFee: {
    topic: 'heating',
    title: 'Nutzerwechselgebühr',
    short:
      'Was der Messdienst berechnet, wenn er wegen eines Auszugs mitten im Abrechnungszeitraum die Zähler zwischendurch abliest und abrechnet. ' +
      'Diese Kosten sind keine Betriebskosten, sondern Verwaltungskosten, und trägt der Vermieter, soweit im Mietvertrag nichts anderes vereinbart ist.',
    example: 'Der Messdienst berechnet für die Zwischenablesung der Wasserzähler beim Auszug 30,00 €. Gehen sie nach Personen über drei Wohnungen, trüge jede rund 10,00 €; tatsächlich gehören die 30,00 € zu Ihrem Anteil.',
    norm: 'BGH, Urteil vom 14.11.2007, VIII ZR 19/07',
    needed:
      'Bei jedem Mieterwechsel mit Zählern. Erfassen Sie die Gebühr unter „Nicht umlagefähig“. Haben Sie mit dem ausziehenden Mieter wirksam etwas anderes vereinbart, fordern Sie sie von ihm; ob eine Klausel im Formularmietvertrag genügt, hat der BGH nicht entschieden.',
  },
  // #218: nur Erklärung und Hinweis; die Verteilung über Nutzergruppen rechnet Mietfuchs nicht.
  preCapture: {
    topic: 'heating',
    title: 'Vorerfassung nach Nutzergruppen',
    short:
      'Die Kosten einer Heizanlage gehen zuerst auf Gruppen von Nutzern und erst danach innerhalb jeder Gruppe auf die einzelnen Nutzer. Den Anteil jeder Gruppe misst ein eigener Zähler. ' +
      'Vorgeschrieben ist das, wenn der Verbrauch der Nutzer einer Anlage nicht mit gleichen Ausstattungen erfasst wird, etwa Wärmezähler in einem Teil des Hauses und Heizkostenverteiler im anderen. ' +
      'Bei unterschiedlichen Nutzungs- oder Gebäudearten oder aus anderen sachgerechten Gründen darf der Gebäudeeigentümer sie auch sonst durchführen.',
    example:
      'An einer Heizung hängen ein Laden und vier Wohnungen. Ein Wärmezähler misst für den Laden 6.000 kWh von 20.000 kWh des Hauses: 30 % der Heizkosten gehen an die Gruppe Laden, 70 % an die Gruppe Wohnungen, ' +
      'und innerhalb der Wohnungen wird nach deren Heizkostenverteilern verteilt.',
    norm: '§ 5 Abs. 7 HeizkostenV',
    needed:
      'Pflicht nur bei verschiedenen Geräten an einer Anlage; Mietfuchs meldet das als Fehler und verteilt die Anlage dann nicht. In den übrigen Fällen entscheiden Sie. ' +
      'Die Vorerfassung rechnet Mietfuchs nicht; erstellt ein Messdienst die Abrechnung damit, übernehmen Sie seine Beträge als Einzelbeträge.',
  },
  // #219, Gesamtentwurf 14.1: nur der Lexikonhinweis; die Bestimmung des Verbrauchs rechnet Mietfuchs nicht.
  pipeHeat: {
    topic: 'heating',
    title: 'Rohrwärme',
    short:
      'Wärme, die die Rohre der Heizung an die Räume abgeben, ohne dass ein Heizkostenverteiler sie erfasst. In Gebäuden, in denen die freiliegenden Leitungen der Wärmeverteilung überwiegend ungedämmt sind und deswegen ein wesentlicher Anteil des Wärmeverbrauchs nicht erfasst wird, ' +
      'kann der Wärmeverbrauch der Nutzer nach anerkannten Regeln der Technik bestimmt werden; der so bestimmte Verbrauch gilt als erfasster Verbrauch.',
    example:
      'Die Heizung gibt 10.000 kWh an die Wohnungen ab, davon 3.000 kWh über ungedämmte Steigleitungen an der Wand. Die Heizkostenverteiler sehen nur die 7.000 kWh der Heizkörper. ' +
      'Eine Wohnung, deren Räume vor allem die Rohre wärmen, erscheint dann mit wenig Verbrauch, und die übrigen Wohnungen zahlen ihren Anteil mit.',
    norm: '§ 7 Abs. 1 Satz 3 und 4 HeizkostenV; BGH, Urteil vom 15.03.2017, VIII ZR 5/16',
    needed:
      'Nur bei Heizkostenverteilern und nur, wenn die Rohre frei auf der Wand verlaufen. Für Leitungen unter Putz oder im Estrich gilt die Regel nicht, auch nicht entsprechend (BGH, Urteil vom 15.03.2017, VIII ZR 5/16). ' +
      'Die Verordnung erlaubt die Bestimmung, sie schreibt sie nicht vor. Ein Verfahren dazu beschreibt die Richtlinie VDI 2077 Blatt 3.5 (Ausgabe 2018-05; sie ersetzt das Beiblatt „Rohrwärme“, auf das die Begründung der Verordnung verweist). ' +
      'Diese Bestimmung rechnet Mietfuchs nicht; es verteilt nach den erfassten Einheiten. Lassen Sie den Verbrauch von einem Messdienst bestimmen, tragen Sie dessen Werte als „Werte eines Ablesedienstes“ ein.',
  },
  interimReading: {
    topic: 'heating',
    title: 'Zwischenablesung',
    short: 'Die Ablesung der Wärme- und Warmwasserzähler, wenn ein Mieter mitten im Abrechnungszeitraum aus- oder einzieht. Nach ihr werden die Verbrauchskosten aufgeteilt; die übrigen Heizkosten nach Gradtagszahlen oder zeitanteilig, die übrigen Warmwasserkosten zeitanteilig.',
    example: 'Wechsel zum 30.09.: Grundkosten Heizung der Wohnung 506,52 €. Nach Gradtagen (Januar bis September 640 Promille) trägt der Vormieter 324,17 € und der Nachmieter 182,35 €; zeitanteilig wären es 378,85 € und 127,67 €.',
    norm: '§ 9b HeizkostenV',
    needed: 'Ja, bei jedem Mieterwechsel. Ist sie nicht möglich, werden die gesamten Kosten der Wohnung nach Gradtagen bzw. Tagen geteilt. Die Kosten der Zwischenablesung trägt der Vermieter, soweit nichts anderes vereinbart ist (BGH, Urteil vom 14.11.2007, VIII ZR 19/07); ob eine Klausel im Formularmietvertrag genügt, hat der BGH nicht entschieden. Das AG Berlin-Hohenschönhausen (16 C 205/07) hält sie für unwirksam; das ist die Entscheidung eines Amtsgerichts.',
  },
  heatMeter: {
    topic: 'meters',
    title: 'Wärmezähler',
    short: 'Ein geeichtes Messgerät, das die Wärme in Kilowattstunden misst, etwa an der Leitung einer Wohnung oder am Warmwasserspeicher.',
    example: 'Der Wärmezähler der Wohnung zeigt am 31.12.2024 1.000 kWh und am 31.12.2025 13.000 kWh: verbraucht sind 12.000 kWh.',
    norm: '§ 5 Abs. 1 HeizkostenV',
    needed: 'Wenn Sie die Heizkosten selbst abrechnen. Ein Wärmezähler am Warmwasserspeicher misst den Anteil des Warmwassers; ohne ihn ist eine Formel nur bei unzumutbar hohem Aufwand erlaubt.',
  },
  // Heizung PR 13 (#99, Entwurf 10.3): Schätzung nach § 9a. Die Zahlen des Beispiels sind Beispielzahlen.
  heatingEstimate: {
    topic: 'heating',
    title: 'Schätzung bei Geräteausfall',
    short: 'Fällt ein Zähler oder Heizkostenverteiler aus oder kann der Verbrauch aus einem anderen zwingenden Grund nicht ordnungsgemäß erfasst werden, wird der Verbrauch dieser Wohnung geschätzt: aus ihrem Verbrauch in einem vergleichbaren Zeitraum, aus dem Verbrauch einer vergleichbaren Wohnung oder aus dem Durchschnitt des Hauses. Der geschätzte Verbrauch tritt nur an die Stelle dessen, was nicht abgelesen werden konnte; hat ein Vormieter bis zur Zwischenablesung einen gültigen Wert, behält er ihn.',
    example:
      'Der Wärmezähler einer Wohnung mit 60 m² fällt aus. Die übrigen Wohnungen verbrauchen zusammen 28.000 kWh auf 140 m², das sind 200 kWh je m²: geschätzt werden 60 × 200 = 12.000 kWh. ' +
      `Die Wohnung hat 60 von 200 m², also 30 % der Fläche. Das ist mehr als ${ESTIMATE_THRESHOLD} %, und die Heizkosten werden deshalb in diesem Jahr nur nach der Fläche verteilt.`,
    norm: '§ 9a HeizkostenV',
    needed:
      'Nur, wenn der Verbrauch nicht ordnungsgemäß erfasst werden kann: Das Gerät ist ausgefallen, zeigt falsch an, oder ein anderer zwingender Grund verhindert die Ablesung. Dann muss der Verbrauch so ermittelt werden; ohne Schätzung verteilt Mietfuchs die Anlage nicht. ' +
      'Ist ein Wert nur einige Tage neben dem Stichtag abgelesen, gilt er, wie er ist; das ist kein Grund zu schätzen. ' +
      `Maßgeblich für die Grenze von ${ESTIMATE_THRESHOLD} % ist die Fläche der geschätzten Wohnungen, nicht ihre Zahl: Bei vier gleich großen Wohnungen hat jede genau ${ESTIMATE_THRESHOLD} %, das ist keine Überschreitung. ` +
      `Sind die Wohnungen verschieden groß, zählt die Fläche: Eine Wohnung mit mehr als ${ESTIMATE_THRESHOLD} % der Fläche überschreitet die Grenze allein, und mehrere kleinere können es zusammen. Mietfuchs zählt die ganze Fläche der Wohnung, auch wenn nur ein Teil der Heizperiode geschätzt ist, und prüft Heizung und Warmwasser getrennt; die Verordnung sagt dazu nichts Ausdrückliches, das ist eine Auslegung von Mietfuchs.`,
  },
  // Heizung PR 14 (#99, Entwurf 10.3). Die Zahlen sind Beispielzahlen.
  billingInfo: {
    topic: 'heating',
    title: 'Angaben zur Heizkostenabrechnung',
    short: 'Zur Heizkostenabrechnung nach Verbrauch gehören Angaben über die Energieträger, die Steuern und Abgaben, die Kosten der Zähler und der Ablesung, Kontaktadressen zum Energiesparen, beim Verbrauchervertrag die Streitbeilegung, ein Vergleich mit einem Durchschnittsnutzer aus Vergleichsdaten und ein grafischer Vergleich mit dem vorhergehenden Abrechnungszeitraum, bereinigt um die Witterung.',
    example: `Fehlt eine dieser Angaben, darf der Mieter seinen Anteil an den Heizkosten um ${INFO_CUT} % kürzen: bei 1.200 € Heizkosten um ${(1200 * INFO_CUT) / 100} €. Das ist ein Kürzungsrecht, auch wenn mehrere Angaben fehlen und auch wenn die monatliche Verbrauchsinformation fehlt; es summieren sich nur Kürzungsrechte aus verschiedenen Sätzen des § 12 Abs. 1 HeizkostenV, etwa dieses und das wegen nicht fernablesbarer Geräte (BR-Drs. 643/21, S. 24 f.).`,
    norm: '§ 6a HeizkostenV; § 12 Abs. 1 Satz 3 HeizkostenV',
    needed:
      'Ja, wenn Sie die Heizkosten nach Verbrauch abrechnen. Mietfuchs rechnet die meisten Angaben aus Ihren Daten. Steuern und Abgaben, bei Fernwärme die Werte des Netzes, den Vergleichswert eines Durchschnittsnutzers mit seiner Quelle und die Klimafaktoren tragen Sie auf der Seite Heizkosten ein. ' +
      'Ein Durchschnitt Ihres eigenen Hauses ist kein solcher Vergleich: Gemeint sind nach der Begründung der Verordnung anonymisierte Verbraucher aus den Beständen der Ablesedienste. ' +
      'Rechnen Sie mit Heizkostenverteilern oder freien Schlüsseln ab, legt meist der Ablesedienst den Vergleich bei; das bestätigen Sie mit seiner Quelle. Ist der Verbrauch eines Mieters geschätzt (§ 9a), gelten nach der Begründung der Verordnung nur die Mindestangaben, also die Kontaktinformationen und beim Verbrauchervertrag die Streitbeilegung; dass Mietfuchs das je Mieter anwendet, ist eine Auslegung.',
  },
  // Heizung PR 22: § 6a Abs. 1 Nr. 2, Abs. 2, § 12 Abs. 1 Satz 3 HeizkostenV und die Begründung (BR-Drs. 643/21,
  // S. 18 f.), gelesen am 05.10.2026, Gegenprüfung vom 12.10.2026. Die Zahlen sind Beispielzahlen.
  monthlyConsumptionInfo: {
    topic: 'heating',
    title: 'Monatliche Verbrauchsinformation',
    short: 'Sind Zähler oder Heizkostenverteiler fernablesbar, bekommt jeder Mieter jeden Monat seinen Verbrauch für Heizung und Warmwasser in Kilowattstunden, verglichen mit dem Vormonat, dem Vorjahresmonat und einem Durchschnittsnutzer.',
    example: `Im November verbraucht ein Haushalt mit ${MONTHLY.areaM2} m² ${MONTHLY.heatKwh} kWh für die Heizung (gemessen) und ${dhwDe(MONTHLY.dhwM3, 1)} m³ Warmwasser; bei ${MONTHLY.tempC} °C Warmwassertemperatur sind das umgerechnet etwa ${dhwDe(MONTHLY_DHW_KWH)} kWh, angelehnt an § 9 Abs. 2 Satz 2 HeizkostenV einschließlich der Verluste der Erzeugung. Beides steht getrennt da und wird nicht zusammengezählt. ` +
      `Im Oktober waren es ${MONTHLY.prevHeatKwh} kWh Heizung und ${MONTHLY.prevM3} m³ Warmwasser, im November des Vorjahres ${MONTHLY.lastYearHeatKwh} kWh Heizung. Ein Durchschnittsnutzer verbraucht laut Vergleichswert des Ablesedienstes ${MONTHLY.refPerM2} kWh je m² × ${MONTHLY.areaM2} m² = ${MONTHLY.refPerM2 * MONTHLY.areaM2} kWh.`,
    norm: '§ 6a Abs. 1 und 2, § 12 Abs. 1 Satz 3 HeizkostenV',
    needed:
      'Ja, wenn Zähler oder Heizkostenverteiler fernablesbar sind. Sind im Haus nur einige Geräte fernablesbar, ist nach der Begründung der Verordnung im Einzelfall zu prüfen, ob die monatliche Information möglich und zumutbar ist (BR-Drs. 643/21, S. 18). ' +
      'Die Information muss den Mieter erreichen: als Brief oder E-Mail, oder in einem Portal oder einer App, wenn er jeden Monat eine Nachricht bekommt, dass sie dort steht. ' +
      'Der Vergleich mit einem Durchschnittsnutzer stammt nicht von den Nutzern desselben Hauses, sondern aus Vergleichsdaten, etwa des Ablesedienstes. ' +
      `Fehlt die Information oder ist sie unvollständig, darf ein Mieter, dessen Wohnung fernablesbar ausgestattet ist, seinen Anteil an den Heizkosten (ist nach § 11 HeizkostenV nur die Wärme ausgenommen, am Warmwasser) um ${INFO_CUT} % kürzen. Ob schon ein einzelner fehlender Monat die volle Kürzung erlaubt, ist nicht höchstrichterlich geklärt; Mietfuchs rechnet vorsorglich mit den vollen ${INFO_CUT} % (Auslegung). ` +
      'Mietfuchs verlangt die Information für jeden Monat, auch außerhalb der Heizperiode: Die Verordnung sagt nur „monatlich“, das Vorblatt der Begründung nennt „während der Heizperiode“ (BR-Drs. 643/21); das ist eine vorsichtige Auslegung. Einen Monat zählt Mietfuchs ab dem ersten Tag des Folgemonats als fällig; eine Frist nennt die Verordnung nicht, das ist eine Festlegung von Mietfuchs. ' +
      'Rechnen Sie die Heizkosten selbst ab, erstellt Mietfuchs die Information auf der Seite Heizkosten aus den Zählerständen am Monatsende; zukommen lassen müssen Sie sie den Mietern selbst.',
  },
  climateFactor: {
    topic: 'heating',
    title: 'Klimafaktor',
    short: 'Eine Zahl, mit der ein Heizwärmeverbrauch auf ein durchschnittliches Klima umgerechnet wird; so lassen sich ein milder und ein kalter Winter vergleichen. Der Deutsche Wetterdienst veröffentlicht Klimafaktoren je Postleitzahl für Zeiträume von zwölf Monaten.',
    example: 'Ein Mieter verbrauchte 12.000 kWh, der Klimafaktor für seinen Ort ist 1,08: witterungsbereinigt 12.960 kWh. Im Vorjahr waren es 11.500 kWh bei einem Faktor von 1,15, witterungsbereinigt 13.225 kWh. Bereinigt hat er also weniger geheizt.',
    norm: '§ 6a Abs. 3 Satz 1 Nr. 5, Satz 2 bis 4 HeizkostenV',
    needed:
      'Ja, für den Vergleich mit dem vorhergehenden Abrechnungszeitraum. Die Faktoren sucht Mietfuchs nicht selbst heraus; Sie tragen sie mit ihrer Quelle ein, etwa die Klimafaktoren des Deutschen Wetterdienstes zu Ihrer Postleitzahl für die zwölf Monate der Heizperiode. ' +
      'Als Verfahren nach anerkannten Regeln der Technik nennt die Begründung der Verordnung „insbesondere die technische Regel VDI 3807“; die Klimafaktoren des Deutschen Wetterdienstes sind auf die Vereinfachungen „zugeschnitten“, die die Ministerien dafür bekannt machen, und „kostenfrei im Internet“ (BR-Drs. 643/21, S. 21). Bereinigt wird nur die Wärme, das Warmwasser nicht.',
  },
  cableTv: {
    topic: 'costs',
    title: 'Kabelfernsehen',
    short: 'Die Gebühren für das TV-Signal eines Kabelanschlusses sind seit dem 01.07.2024 keine umlagefähigen Betriebskosten mehr, bei Anlagen ab dem 01.12.2021 waren sie es nie. Bei Anlagen, die vor dem 01.12.2021 errichtet wurden, bleibt der Betriebsstrom umlagefähig, bei einer Gemeinschaftsantenne des Hauses auch ihre Prüfung und Einstellung durch eine Fachkraft; bei neueren Anlagen auch das nicht.',
    example: 'Kabelgebühren 2024 von 240 € bei einer Anlage, die vor dem 01.12.2021 errichtet wurde: Umlegen dürfen Sie höchstens die 120 € für Januar bis Juni. Ab 2025 nichts mehr davon.',
    norm: '§ 2 Satz 1 Nr. 15 und Satz 2 BetrKV',
    needed: 'Nur wenn Ihr Haus einen Kabelanschluss über einen Sammelvertrag hat.',
  },
  consumptionKey: {
    topic: 'costs',
    title: 'Verbrauchsschlüssel',
    short: 'Die Kosten werden nach den Zählerständen verteilt, also danach, wie viel jede Wohnung tatsächlich verbraucht hat.',
    example: 'Wasser 1.000 €, gemessen 60 m³ in Wohnung A und 40 m³ in Wohnung B: A trägt 600 €, B 400 €.',
    norm: '§ 556a Abs. 1 Satz 2 BGB; BGH, Urteil vom 12.03.2008, VIII ZR 188/07',
    needed: 'Wenn alle vermieteten Wohnungen eigene Zähler haben; dann ist ohne andere Vereinbarung nach Verbrauch umzulegen. Fehlt einer Mietwohnung der Zähler, müssen Sie nicht nach Verbrauch abrechnen.',
  },
  mainMeter: {
    topic: 'meters',
    title: 'Hauptzähler und Zwischenzähler',
    short: 'Der Hauptzähler misst das ganze Haus, ein Zwischenzähler eine einzelne Wohnung. Fehlt nur Ihrer eigenen Wohnung der Zwischenzähler, gilt für sie der Rest des Hauptzählers, samt Messdifferenz. Fehlt er einer vermieteten Wohnung, rechnen Sie besser nach Fläche ab; zur Abrechnung nach Verbrauch sind Sie dann nicht verpflichtet. Rechnen Sie trotzdem so, lässt Mietfuchs den Rest des Hauptzählers beim Vermieter, sofern der Hauptzähler das ganze Jahr abgelesen ist; sonst tragen die übrigen Wohnungen diesen Verbrauch mit, und Mietfuchs warnt.',
    example: 'Hauptzähler 200 m³, Zwischenzähler der Einliegerwohnung 40 m³, Ihre Wohnung ohne Zähler: Die übrigen 160 m³ gelten als Ihr Verbrauch. Bei 1.000 € Wasser trägt der Mieter der Einliegerwohnung 200 €, 800 € sind Ihr Eigenanteil.',
    needed: 'Wenn nicht jede Wohnung einen eigenen Zähler hat, etwa bei einer Einliegerwohnung. Lesen Sie den Hauptzähler dann zum 31.12. ab. Weicht die Summe der Wohnungszähler um mehr als etwa 20 % vom Hauptzähler ab, ist das Umlegen der Differenz nach der Rechtsprechung der Instanzgerichte angreifbar; klären Sie dann die Ursache.',
  },
  meterReading: {
    topic: 'meters',
    title: 'Zählerstand und Zählerwechsel',
    short: 'Der Verbrauch ist der Unterschied zweier Ablesungen; wird ein Zähler getauscht, gehören der Endstand des alten und der Anfangsstand des neuen Geräts dazu.',
    example: 'Stand am 31.12.2024: 120 m³, am 31.12.2025: 165 m³, Verbrauch 45 m³. Beim Tausch im Juni: alter Zähler endet bei 140, neuer beginnt bei 0 und steht am Jahresende bei 25; zusammen ebenfalls 45 m³.',
    needed: 'Wenn Sie nach Verbrauch abrechnen. Ablesen am besten immer zum 31.12.',
  },
  // #342: Einheit des Zählers; die Faktoren stehen in shared/meterUnits.ts.
  meterUnit: {
    topic: 'meters',
    title: 'Einheit des Zählers',
    short: 'Die Einheit, in der ein Zähler seinen Stand zeigt: bei Wärme kWh, MWh oder GJ, bei Wasser m³ oder Liter, bei Strom kWh oder MWh. Stehen Zähler, die gemeinsam verteilt werden, in verschiedenen dieser Einheiten, rechnet Mietfuchs sie ineinander um. Eine Einheit, die Mietfuchs für die Sparte nicht kennt (etwa m³ an einem Wärmezähler), rechnet es nicht um: Es rechnet, als zeigten alle Zähler dieselbe Einheit, und warnt.',
    example: 'Drei Wärmezähler zeigen kWh, einer MWh: 12.000 kWh, 15.000 kWh, 9.000 kWh und 16 MWh. Mietfuchs rechnet mit 16.000 kWh und verteilt nach 52.000 kWh. Ohne Umrechnung trüge der vierte Mieter fast nichts.',
    needed: 'Wenn Sie nach Verbrauch abrechnen. Wählen Sie auf der Seite Zähler die Einheit, die auf dem Zähler steht. Gaszähler zeigen m³, die Gasrechnung nennt kWh; das sind verschiedene Größen, die Mietfuchs nicht ineinander umrechnet.',
  },
  // Heizung PR 21 (#98): Eichfrist. Wortlaut § 34, Anlage 7 und 8 MessEV, §§ 33, 37 MessEG und der Leitsatz c
  // von BGH VIII ZR 112/10 gelesen am 12.10.2026.
  meterCalibration: {
    topic: 'meters',
    title: 'Eichfrist',
    short: `Die Eichfrist von Kalt- und Warmwasserzählern und Wärmezählern beträgt ${CALIBRATION} Jahre. Sie beginnt mit dem Inverkehrbringen, vermutet im Jahr der Kennzeichnung (etwa „M22“), oder mit der Eichung (Jahreszahl der Eichmarke), und endet mit dem Ende des Jahres, in dem sie abläuft. Heizkostenverteiler sind nicht eichpflichtig.`,
    example: `Ein Kaltwasserzähler mit der Kennzeichnung „M${String(CALIBRATION_EXAMPLE_YEAR).slice(2)}“ ist bis Ende ${CALIBRATION_EXAMPLE_YEAR + CALIBRATION} geeicht. Die Ablesung vom 31.12.${CALIBRATION_EXAMPLE_YEAR + CALIBRATION} zählt noch als geeicht, die vom 01.01.${CALIBRATION_EXAMPLE_YEAR + CALIBRATION + 1} nicht mehr.`,
    norm: '§ 33, § 37 Abs. 1 MessEG; § 34, § 35 und Anlage 7 MessEV',
    needed:
      'Ja, wenn Sie nach Zählern abrechnen. Nach Ablauf darf ein Zähler nicht ungeeicht verwendet werden, und seine Werte dürfen nicht in die Abrechnung (§ 33, § 37 MessEG). ' +
      'Bestreitet ein Mieter dann die Werte, gilt nach dem Bundesgerichtshof: „Den von einem nicht (mehr) geeichten Messgerät abgelesenen Verbrauchswerten kommt die Vermutung ihrer Richtigkeit nicht zu. In diesem Fall muss der Vermieter im Prozess die Richtigkeit der abgelesenen Werte zur Überzeugung des Tatrichters nachweisen.“ (Urteil vom 17.11.2010, VIII ZR 112/10, Leitsatz c). Im entschiedenen Fall gelang das mit der Prüfung durch eine staatlich anerkannte Prüfstelle. ' +
      'Hat der Messdienst oder Versorger die Eichfrist im Stichprobenverfahren verlängern lassen (§ 35 MessEV), gilt das verlängerte Jahr; am Zähler ist das nicht zu sehen.',
  },
  directAssignment: {
    topic: 'costs',
    title: 'Direktzuordnung',
    short: 'Eine Rechnung gehört vollständig zu einer einzigen Wohnung und wird nicht verteilt.',
    example: 'Der Schornsteinfeger prüft nur die Gastherme in Wohnung B für 85 €: Die 85 € trägt allein Wohnung B.',
    needed: 'Selten, nur für Rechnungen, die eindeutig eine Wohnung betreffen.',
  },
  agreedShares: {
    topic: 'costs',
    title: 'Vereinbarte Anteile',
    short: 'Im Mietvertrag steht für jede Wohnung eine feste Quote in Prozent; was unter 100 Prozent bleibt, trägt der Vermieter.',
    example: 'Aufzug 2.000 €, vereinbart 40 % für Wohnung A und 35 % für B: A trägt 800 €, B 700 €, der Vermieter 500 €.',
    norm: '§ 556a Abs. 1 BGB',
    needed: 'Nur wenn Ihr Mietvertrag solche Quoten nennt.',
  },
  individualAmounts: {
    topic: 'costs',
    title: 'Einzelbeträge',
    short: 'Die Beträge je Mieter stehen schon fest, etwa in der Abrechnung eines Messdienstes, und werden unverändert übernommen.',
    example: 'Die Heizkostenabrechnung des Messdienstes über 3.000 € nennt 1.240 € für Wohnung A und 1.160 € für B; 600 € entfallen auf Ihre eigene Wohnung.',
    needed: 'Wenn ein Dienstleister wie ein Messdienst bereits je Wohnung abgerechnet hat.',
  },
  participants: {
    topic: 'costs',
    title: 'Teilnehmende Wohnungen',
    short: 'Eine Rechnung betrifft nur einen Teil der Wohnungen und wird nur auf diese verteilt.',
    example: 'Der Aufzug 1.800 € im Jahr dient nur den drei Wohnungen im Hinterhaus: Nur ihre 210 m² bilden die Verteilbasis.',
    needed: 'Nur wenn nicht alle Wohnungen eine Einrichtung nutzen, etwa Aufzug, Waschküche oder ein zweites Haus.',
  },
  mea: {
    topic: 'condo',
    title: 'Miteigentumsanteile (MEA)',
    short: 'Der Anteil einer Eigentumswohnung am gemeinsamen Eigentum, meist in Tausendsteln; nach ihm verteilt die Gemeinschaft ihre Kosten.',
    example: 'Ihre Wohnung hat 85 von 1.000 MEA. Die Gebäudeversicherung der Anlage über 6.000 € kostet Sie 85/1.000 × 6.000 = 510 €.',
    norm: '§ 16 Abs. 1 und 2 WEG, § 556a Abs. 3 BGB',
    needed: 'Nur bei einer vermieteten Eigentumswohnung. Ohne andere Vereinbarung gilt der Maßstab der Gemeinschaft auch gegenüber dem Mieter, sofern er nicht unbillig ist. Haben Sie mehrere Wohnungen in derselben Anlage, verteilt Mietfuchs den Betrag „laut Gemeinschaftsabrechnung“ auf sie nach Miteigentumsanteilen oder Fläche, nicht nach ihrem Verbrauch; für Heizkosten übernehmen Sie dann besser die Beträge je Wohnung aus der Heizkostenabrechnung als Einzelbeträge.',
  },
  noConnection: {
    topic: 'meters',
    title: 'Einheit ohne Anschluss',
    short: 'Eine Einheit, die für eine Zählerart gar keinen Anschluss hat, etwa eine Garage ohne Wasser; ihr fehlt dann kein Zähler, und Verbrauchskosten dieser Art betreffen sie nicht.',
    example: 'Wasser 600 € nach Verbrauch, zwei Wohnungen mit 40 und 20 m³ gemessen, dazu eine vermietete Garage ohne Wasser: Die Wohnungen tragen 400 € und 200 €, die Garage nichts, und Mietfuchs warnt nicht vor einem fehlenden Zähler.',
    needed: 'Nur wenn eine Einheit eines Objekts mit Zählern keinen Anschluss dieser Art hat. Im Normalfall bleiben alle Häkchen gesetzt.',
  },
  homeownersStatement: {
    topic: 'condo',
    title: 'Hausgeldabrechnung',
    short: 'Die Jahresabrechnung der Eigentümergemeinschaft; aus ihr übernehmen Sie für die Nebenkostenabrechnung nur die umlagefähigen Kosten.',
    example: 'Hausgeld 3.600 € im Jahr, davon 1.900 € umlagefähig (Versicherung, Müll, Allgemeinstrom, Hausmeister). Verwaltergebühr 360 € und Reparaturen 440 € tragen Sie selbst und setzen sie als Werbungskosten an. Die Zuführung zur Rücklage von 900 € tragen Sie ebenfalls selbst, abziehbar ist sie aber erst, wenn die Gemeinschaft sie ausgibt (siehe Erhaltungsrücklage). Die Grundsteuer steht nicht darin, sie kommt mit eigenem Bescheid an Sie.',
    norm: '§ 28 WEG, § 556a Abs. 3 BGB',
    needed: 'Nur bei einer vermieteten Eigentumswohnung. Weist sie Entnahmen aus der Erhaltungsrücklage aus, erfassen Sie Ihren Anteil daran als „Entnahme Erhaltungsrücklage“ (siehe Erhaltungsrücklage).',
  },
  homeownersFee: {
    topic: 'condo',
    title: 'Hausgeld (Vorschuss)',
    short: 'Der monatliche Vorschuss, den Sie als Eigentümer an die Gemeinschaft zahlen, festgelegt im Wirtschaftsplan; er ist eine Vorauszahlung und noch keine Abrechnung. Erst die Hausgeldabrechnung nach Ende des Jahres sagt, welche Kosten wirklich angefallen sind, und ein Teil des Vorschusses ist meist die Zuführung zur Erhaltungsrücklage.',
    example: 'Hausgeld 300 € im Monat, also 3.600 € im Jahr, davon 900 € Zuführung zur Erhaltungsrücklage: Im Jahr der Zahlung sind 2.700 € als Werbungskosten abziehbar, die 900 € erst, wenn die Gemeinschaft sie für eine Erhaltungsmaßnahme ausgibt. Eine Nachzahlung aus der Hausgeldabrechnung zählt im Jahr, in dem Sie sie bezahlen.',
    norm: '§ 28 WEG; § 11 Abs. 2 EStG',
    needed: 'Nur bei einer vermieteten Eigentumswohnung. Für die Nebenkostenabrechnung Ihres Mieters zählt nicht der Vorschuss, sondern die Hausgeldabrechnung: Aus ihr übernehmen Sie die umlagefähigen Kosten. Für die Steuer zählt dagegen, wann das Geld abfließt, also der gezahlte Vorschuss im Jahr der Zahlung, ohne den Anteil der Erhaltungsrücklage. Mietfuchs stellt eine Position in das Jahr ihrer Abrechnung; haben Sie in einem anderen Jahr gezahlt, etwa eine Nachzahlung im Folgejahr, tragen Sie an der Position das Zahlungsdatum ein (siehe Zahlungsdatum).',
  },
  reserveFund: {
    topic: 'condo',
    title: 'Erhaltungsrücklage',
    short: 'Ein Teil des Hausgelds einer Eigentumswohnung, den die Gemeinschaft für künftige Reparaturen ansammelt; als Werbungskosten abziehbar ist er erst, wenn und soweit die Gemeinschaft das Geld für Erhaltungsmaßnahmen ausgibt, nicht schon bei der Zahlung.',
    example: 'Hausgeld 3.600 € im Jahr, davon 900 € Zuführung zur Erhaltungsrücklage: Sofort abziehbar sind höchstens 3.600 − 900 = 2.700 €. Bezahlt die Gemeinschaft zwei Jahre später aus der Rücklage eine Dachreparatur, ist Ihr Anteil daran erst in diesem Jahr Werbungskosten.',
    norm: '§ 19 Abs. 2 Nr. 4 WEG; § 9 Abs. 1 EStG; BFH, Urteil vom 14.01.2025, IX R 19/24',
    needed: `Nur bei einer vermieteten Eigentumswohnung. Erfassen Sie die Zuführung als Kostenart „Zuführung Erhaltungsrücklage“; Mietfuchs legt sie nicht auf den Mieter um und weist sie in der Steuerübersicht getrennt von den Werbungskosten aus. Bezahlt die Gemeinschaft eine Erhaltungsmaßnahme aus der Rücklage, erfassen Sie Ihren Anteil laut Hausgeldabrechnung als „Entnahme Erhaltungsrücklage“, ohne Zahlungsdatum: Er zählt im Jahr, in dem die Gemeinschaft das Geld ausgibt, nicht wenn Sie Ihr Hausgeld zahlen, und gehört in der Anlage V zu den Erhaltungsaufwendungen (2024 und 2025 Zeile 55, für verhältnismäßig aufgeteilten Aufwand Zeile 56). Das gilt auch für eine Rücklage, die Sie beim Kauf miterworben haben. Geht die Maßnahme über die Erhaltung hinaus, etwa ein neuer Aufzug oder ein Anbau, sind es Herstellungskosten; sie wirken über die Abschreibung, die Mietfuchs nicht rechnet. Eine Sonderumlage zählt nach derselben Begründung erst, wenn die Gemeinschaft sie für die Maßnahme ausgibt. In den ${ACQ_YEARS} Jahren nach dem Kauf zählen Entnahmen bei der Grenze für anschaffungsnahe Herstellungskosten mit (siehe Anschaffungsnahe Herstellungskosten).`,
  },
  // #96 PR 2 (Entwurf A4.4, Durchsicht X6): der Begriff zum gemeinsamen Hinweis `acquisitionRelated` der Steuerübersicht.
  // Wortlaut von § 6 Abs. 1 Nr. 1a EStG gelesen am 31.10.2026 auf gesetze-im-internet.de, Grenze und Zeitraum aus dem
  // Register (`estg.acquisition-related`); dass Entnahmen aus der Rücklage mitzählen: BFH, Urteil vom 14.01.2025,
  // IX R 19/24, Rz. 24. Verwaltungsauffassung: BMF-Schreiben vom 26.01.2026, IV C 1 - S 2253/00082/001/064 (BStBl-Fundstelle
  // nicht gefunden, gelesen in einer Kopie), Rn. 54 (Grenze), 62 (taggenau ab dem Übergang), 63 (zum Fristende weder
  // abgeschlossen noch bezahlt). Bezugsgröße sind die Anschaffungskosten des Gebäudes samt anteiliger Nebenkosten
  // (Durchsicht K5); das Beispiel teilt Kaufpreis und Nebenkosten im selben Verhältnis auf Gebäude und Boden.
  acquisitionRelatedCosts: {
    title: 'Anschaffungsnahe Herstellungskosten',
    short: `Aufwendungen für Instandsetzung und Modernisierung, die innerhalb von ${ACQ_YEARS} Jahren nach der Anschaffung eines Gebäudes durchgeführt werden und ohne Umsatzsteuer zusammen mehr als ${ACQ.percent} % der Anschaffungskosten des Gebäudes ausmachen, einschließlich der anteiligen Nebenkosten des Kaufs; sie sind dann keine sofort abziehbaren Werbungskosten, sondern Herstellungskosten und wirken nur über die Abschreibung.`,
    example: `Kaufpreis 250.000 €, davon 200.000 € für das Gebäude und 50.000 € für Grund und Boden. Grunderwerbsteuer, Notar und Grundbuch kosten zusammen 20.000 €; auf das Gebäude entfallen davon ebenso 80 %, also 16.000 €. Die Anschaffungskosten des Gebäudes sind damit 216.000 €, die Grenze ${ACQ.percent} % davon ${acqDe(216000 * ACQ.percent / 100)} €. Werden in den ${ACQ_YEARS} Jahren nach dem Übergang Bad und Fenster für zusammen 34.000 € ohne Umsatzsteuer erneuert, liegen die Aufwendungen über der Grenze: Alle 34.000 € gehören zu den Herstellungskosten, nicht nur die ${acqDe(34000 - 216000 * ACQ.percent / 100)} € darüber. Wären es 32.000 €, blieben sie unter der Grenze und sofort abziehbar, obwohl sie mehr sind als ${ACQ.percent} % des Kaufpreises für das Gebäude allein (${acqDe(200000 * ACQ.percent / 100)} €).`,
    norm: '§ 6 Abs. 1 Nr. 1a EStG; § 9 Abs. 5 Satz 2 EStG; BMF-Schreiben vom 26.01.2026, IV C 1 - S 2253/00082/001/064, Rn. 54, 62 und 63; BFH, Urteil vom 14.01.2025, IX R 19/24',
    needed: `Nur wenn Sie das Gebäude oder die Wohnung in den letzten ${ACQ_YEARS} Jahren gekauft haben. Die Frist läuft taggenau ab dem Übergang von Besitz, Nutzen und Lasten laut Kaufvertrag, nicht ab dem Tag des Kaufvertrags; tragen Sie das Datum in den Stammdaten beim Objekt unter „Für die Steuer (Anlage V)“ als Eigentumsübergang ein. Zum Ende der Frist müssen die Arbeiten weder abgeschlossen noch bezahlt sein: Was bis dahin ausgeführt wurde, zählt mit, auch wenn die Rechnung später kommt. Mietfuchs kennt die Anschaffungskosten nicht und rechnet die Grenze deshalb nicht; die Steuerübersicht weist in diesen Jahren und im Jahr nach dem Ende der Frist darauf hin. Mit zählen auch Ihr Anteil an Entnahmen aus der Erhaltungsrücklage und auf mehrere Jahre verteilter Erhaltungsaufwand; nicht mit zählen Erweiterungen und Erhaltungsarbeiten, die jährlich üblicherweise anfallen. Prüfen Sie die Grenze bitte mit Ihrem Steuerberater.`,
  },
  labor35a: {
    topic: 'tax',
    title: 'Lohnanteil nach § 35a EStG',
    short: 'Der Teil einer Rechnung, der auf Arbeit entfällt, einschließlich Maschinen- und Fahrtkosten und Umsatzsteuer, ohne Material. Weist die Abrechnung den Anteil des Mieters daran aus oder bescheinigen Sie ihn, kann er 20 Prozent davon unmittelbar von seiner Einkommensteuer abziehen, je Haushalt und Jahr höchstens 4.000 € für haushaltsnahe Dienstleistungen und 1.200 € für Handwerkerleistungen, über alle Rechnungen zusammen. Voraussetzung ist, dass die Rechnung unbar an den Handwerker oder Dienstleister bezahlt wurde.',
    example: 'Gartenpflege 1.000 €, davon Lohn 800 €: Trägt der Mieter 250 € der Rechnung, entfallen davon 200 € auf Lohn, und er kann 20 % davon abziehen, also 40 €.',
    norm: '§ 35a Abs. 2, 3 und 5 EStG; BMF-Schreiben vom 09.11.2016',
    needed: 'Nicht Pflicht, aber für Ihre Mieter bares Geld. Den Lohnanteil finden Sie auf der Rechnung des Handwerkers oder Dienstleisters.',
  },
  settlementDeadline: {
    topic: 'period',
    title: 'Abrechnungsfrist',
    short: 'Die Abrechnung muss dem Mieter spätestens zwölf Monate nach Ende des Abrechnungszeitraums zugehen, sonst können Sie in der Regel keine Nachzahlung mehr verlangen; ausgenommen ist nur eine Verspätung, die Sie nicht zu vertreten haben.',
    example: 'Abrechnung für 2025: Sie muss bis zum 31.12.2026 beim Mieter sein. Kommt sie am 02.01.2027, entfällt eine Nachzahlung von 200 €; ein Guthaben des Mieters bleibt fällig.',
    norm: '§ 556 Abs. 3 BGB; BGH, Urteil vom 20.05.2026, VIII ZR 6/24',
    needed: 'Ja, für jede Abrechnung. Es zählt der Zugang beim Mieter, nicht das Absenden. Bei einer Eigentumswohnung gilt die Frist auch, wenn die Hausgeldabrechnung noch fehlt. Liegt der Grundsteuerbescheid ohne Ihr Verschulden noch nicht vor, oder haben Sie gegen ihn, den Grundsteuerwert- oder den Messbescheid Einspruch eingelegt, dürfen Sie mit der Grundsteuer warten, bis der endgültige Bescheid da oder über den Einspruch entschieden ist. Rechnen Sie das Übrige trotzdem fristgerecht ab, behalten Sie sich die Grundsteuer ausdrücklich vor und fordern Sie sie im Regelfall innerhalb von drei Monaten danach. Mietfuchs zeigt die Frist auf der Seite Abrechnung.',
  },
  // #208: Abrechnungszeitraum, Rumpf und Leistungsprinzip. § 556 Abs. 3 BGB und VIII ZR 316/10,
  // VIII ZR 49/07, VIII ZR 156/11 gelesen am 05.10.2026 (Entwurf 2).
  billingPeriod: {
    topic: 'period',
    title: 'Abrechnungszeitraum',
    short: 'Die Zeit, über die Sie die Nebenkosten abrechnen: höchstens zwölf Monate, meist das Kalenderjahr, auf Wunsch etwa Mai bis April wie Ihr Messdienst.',
    example: 'Ein Objekt rechnet von Mai bis April ab: Der Zeitraum 2025/2026 läuft vom 01.05.2025 bis 30.04.2026, und die Abrechnung muss den Mietern bis 30.04.2027 zugehen.',
    norm: '§ 556 Abs. 3 BGB',
    needed: 'Nur wenn Ihr Messdienst oder Ihr Mietvertrag einen anderen Zeitraum als das Kalenderjahr nennt. Mietkonto und Steuer bleiben beim Kalenderjahr.',
  },
  // Heizung PR 5 (#217): BGH, Urteil vom 30.04.2008, VIII ZR 240/07, Leitsätze nachgelesen (Entwurf 3.1).
  heatingPeriod: {
    topic: 'period',
    title: 'Eigene Heizperiode',
    short: 'Die Heizkosten werden für einen anderen Zeitraum abgerechnet als die übrigen Betriebskosten, meist für den des Messdienstes, etwa Mai bis April.',
    example: 'Die Betriebskostenabrechnung 2026 umfasst Januar bis Dezember 2026, darin die Heizkosten der Heizperiode 01.05.2025–30.04.2026. Ein Mieter, der am 31.10.2025 ausgezogen ist, bekommt für 2026 eine Abrechnung nur mit seinen Heizkosten vom 01.05. bis 31.10.2025: Rechnet der Messdienst für die Wohnung 1.000,00 € ab, davon 412,30 € bis zum Auszug und 587,70 € für den Nachmieter, sind das 412,30 €.',
    norm: 'BGH, Urteil vom 30.04.2008, VIII ZR 240/07; § 556 Abs. 3 BGB',
    needed: 'Nur wenn Ihr Messdienst nicht im Zeitraum Ihrer Abrechnung abrechnet und Sie den Zeitraum nicht umstellen wollen. Zulässig ist das, wenn Heizkosten und übrige Kosten mit einer gemeinsamen Vorauszahlung abgerechnet werden. Werden die Heizkosten mit eigener Vorauszahlung getrennt abgerechnet, bekommt jede Heizperiode ihre eigene Heizkostenabrechnung mit eigener Frist; das ist eine Auslegung des Gesetzes. Legt Ihr Mietvertrag den Zeitraum fest, braucht eine Änderung die Zustimmung der Mieter.',
  },

  separateHeatingSettlement: {
    topic: 'period',
    title: 'Getrennte Heizkostenabrechnung',
    short: 'Die Heizkosten werden mit einer eigenen Heizkostenvorauszahlung in einer eigenen Abrechnung je Heizperiode abgerechnet, getrennt von den übrigen Betriebskosten.',
    example: 'Der Mieter zahlt 300,00 € im Monat, davon 123,00 € Heizkostenvorauszahlung und 177,00 € für die übrigen Nebenkosten. Die Heizkostenabrechnung 01.05.2025–30.04.2026 rechnet 12 × 123,00 € = 1.476,00 € gegen Heizkosten von 1.500,00 € an: Nachzahlung 24,00 €, zuzustellen bis 30.04.2027. Die Betriebskostenabrechnung rechnet nur die 177,00 € im Monat an.',
    norm: '§ 556 Abs. 3 BGB; dass eine eigene Heizkostenvorauszahlung eine eigene Abrechnung mit eigener Frist erlaubt, ist eine Auslegung (BGH, Urteil vom 30.04.2008, VIII ZR 240/07, gilt für die gemeinsame Vorauszahlung)',
    needed: 'Meist nein. Nur wenn Ihr Mietvertrag eine eigene Heizkostenvorauszahlung und eine eigene Heizkostenabrechnung vorsieht. Zahlen Ihre Mieter eine Vorauszahlung für alle Nebenkosten, rechnen Sie die Heizkosten in der Betriebskostenabrechnung mit ab.',
  },

  shortPeriod: {
    topic: 'period',
    title: 'Rumpfzeitraum',
    short: 'Ein kürzerer Abrechnungszeitraum vor einem Wechsel, damit kein Zeitraum länger als zwölf Monate wird.',
    example: 'Umstellung vom Kalenderjahr auf Mai bis April ab Mai 2025: 01.01.–30.04.2025 ist ein Rumpfzeitraum mit 120 Tagen; seine Abrechnung muss bis 30.04.2026 zugehen.',
    norm: '§ 556 Abs. 3 BGB; BGH, Urteil vom 27.07.2011, VIII ZR 316/10',
    needed: 'Nur beim Wechsel des Zeitraums. Eine Verkürzung braucht einen sachlichen Grund, etwa die Angleichung an den Messdienst; legt der Mietvertrag den Zeitraum fest, braucht sie die Zustimmung der Mieter. Eine Verlängerung über zwölf Monate gibt es nicht.',
  },
  accrualPrinciple: {
    topic: 'period',
    title: 'Leistungsprinzip',
    short: 'Eine Rechnung gehört in den Abrechnungszeitraum, in dem die Leistung erbracht wurde; reicht sie über zwei Zeiträume, teilt Mietfuchs kalte Betriebskosten nach Tagen auf. Heizkosten richten sich nach dem Verbrauch im Zeitraum und werden nicht nach Tagen geteilt.',
    example: 'Grundsteuer 2025 über 480 € bei einer Abrechnung von Mai bis April: 120 von 365 Tagen gehören in 2024/2025 (157,81 €), 245 Tage in 2025/2026 (322,19 €).',
    norm: 'BGH, Urteil vom 20.02.2008, VIII ZR 49/07; BGH, Urteil vom 01.02.2012, VIII ZR 156/11',
    needed: 'Nur wenn eine Rechnung einen anderen Zeitraum hat als Ihre Abrechnung. Tragen Sie dann unter „Weitere Angaben“ den Leistungszeitraum ein.',
  },
  // #255 PR 3: das Zahlungsdatum einer Kostenposition für die Steuer (Abflussprinzip). Quellen aus der Rechtsprüfung
  // zu #255 (H 11 EStH 2024, BFH VIII B 58/15, IX R 13/93, X R 2/21, § 28 GrStG).
  paymentDate: {
    topic: 'tax',
    title: 'Zahlungsdatum (Abflussprinzip)',
    short: 'Für die Steuer zählen Werbungskosten in dem Kalenderjahr, in dem Sie sie bezahlt haben, nicht im Jahr der Abrechnung und nicht am Rechnungsdatum. Bei einer Überweisung ist das der Tag, an dem Ihr Auftrag bei Ihrer Bank einging (Konto gedeckt), bei einer Lastschrift der Tag des Einzugs, bar der Tag der Übergabe. Eine Erstattung zählt im Jahr, in dem sie Ihnen zufließt; Mietfuchs mindert damit vereinfachend die Kosten derselben Art, am Überschuss ändert das nichts. Ohne Datum gilt ein angegebenes Jahr der Zahlung, sonst stellt Mietfuchs eine Position in das Jahr ihrer Abrechnung.',
    example: 'Grundsteuer 2025 über 600,00 €, bezahlt am 20.02.2026 nach einem späten Bescheid: Mit diesem Datum steht sie in der Steuerübersicht 2026 und fehlt in 2025. Die Abrechnung 2025 für die Mieter bleibt, wie sie ist.',
    norm: '§ 11 Abs. 2 Satz 1 EStG; H 11 EStH 2024 („Überweisung“); BFH, Beschluss vom 08.03.2016, VIII B 58/15 (Lastschrift); BFH, Urteil vom 22.09.1994, IX R 13/93 (Erstattung); Zehn-Tage-Regel: § 11 Abs. 2 Satz 2 EStG, BFH, Urteil vom 16.02.2022, X R 2/21',
    needed: 'Nur wenn Sie eine Rechnung in einem anderen Jahr bezahlt haben als im Jahr ihrer Abrechnung, etwa eine Nachzahlung im Folgejahr oder eine Versicherung, die Sie schon im Dezember für das nächste Jahr gezahlt haben. Tragen Sie es an der Kostenposition unter „Weitere Angaben“ ein. Bei Abschlägen lassen Sie es leer, das Datum steht immer für die ganze Position. Um den Jahreswechsel kann eine regelmäßig wiederkehrende Zahlung zum Vorjahr oder Folgejahr gehören (Zehn-Tage-Regel); Mietfuchs weist darauf hin, rechnet es aber nicht. Bei der Grundsteuer greift die Regel nicht, denn ihre Fälligkeiten (§ 28 GrStG) liegen nie in dieser Zeit.',
  },
  // #208: Gradtage, für den Vorschlag nach § 560 BGB im Rumpf. Werte aus dem Register
  // (`hkv.degree-days`), Herkunft dort.
  degreeDays: {
    topic: 'heating',
    title: 'Gradtagszahlen',
    short: 'Eine Tabelle, die ein Jahr Heizwärme auf die Monate verteilt: Im Winter wird viel geheizt, im Sommer kaum. Ein Jahr hat 1.000 Promille.',
    example: `Januar bis April zusammen ${winterPermille} Promille. Eine Gasrechnung über 700 € für diese vier Monate entspricht 700 € / ${(winterPermille / 1000).toLocaleString('de-DE')} ≈ ${deEuro(Math.round(70000 / (winterPermille / 1000)))} € im Jahr, also rund ${deEuro(Math.round(70000 / (winterPermille / 1000) / 12))} € im Monat.`,
    norm: '§ 9b Abs. 2 HeizkostenV (Gradtagszahlen nach den anerkannten Regeln der Technik); § 9b Abs. 1 und 4 HeizkostenV (Nutzerwechsel, abweichende Vereinbarung)',
    needed: 'Im Rumpfzeitraum rechnet Mietfuchs damit den Vorschlag für die neue Vorauszahlung hoch. Reicht eine Gas-, Fernwärme- oder Stromrechnung über das Ende der Heizperiode hinaus, teilt es damit den Verbrauch auf die Heizperioden auf, wenn weder ein Zählerstand zum Stichtag noch eine Zwischenrechnung des Versorgers vorliegt. Bei eigener Heizkostenabrechnung teilt es damit beim Mieterwechsel die Grundkosten der Heizung (§ 9b Abs. 2 HeizkostenV), auch wenn nach § 2 HeizkostenV eine Verteilung nach Wohnfläche vereinbart ist: Die Verteilungsregeln treten dann hinter die Vereinbarung zurück (§ 2 HeizkostenV), und Mietfuchs übernimmt die Regel zum Wechsel sinngemäß (Festlegung von Mietfuchs). Ebenso teilt es eine Wohnung, die einen Teil der Heizperiode leer steht: Für die leeren Räume ist der Vermieter Nutzer, und Mietfuchs behandelt den Leerstand wie einen Nutzerwechsel nach § 9b Abs. 1 HeizkostenV. Das ist eine Auslegung von Mietfuchs; eine Entscheidung, die das für den Leerstand bejaht oder verneint, ist nicht bekannt. Steht die Wohnung im Sommer leer, trägt der Vermieter nach Gradtagen weniger als zeitanteilig, die Mieter derselben Wohnung entsprechend mehr; den zeitanteiligen Vergleichswert nennen Rechenweg und Hinweis. Eine abweichende Vereinbarung im Mietvertrag geht vor (§ 9b Abs. 4 HeizkostenV). Wollen Sie beim Wechsel zeitanteilig teilen, stellen Sie das an der Heizanlage ein. Die Werte stammen aus der Praxis der Messdienste; die Norm DIN 94680, in der sie heute stehen, hat Mietfuchs nicht gelesen.',
  },

  fuelDelivery: {
    topic: 'heating',
    title: 'Lieferung (Rechnung des Versorgers)',
    short: 'Eine Rechnung über Brennstoff oder Energie, auf der Seite Heizkosten eingetragen: bei Gas, Fernwärme und Strom mit ihrem Rechnungszeitraum, bei Heizöl, Flüssiggas, Pellets, Holz und Kohle mit Lieferdatum und Menge. Reicht eine Gasrechnung über die Heizperiode hinaus, teilt Mietfuchs sie auf die Heizperioden auf; bei Brennstoff mit Vorrat ergibt die Bestandsrechnung den Verbrauch. Bei freien Schlüsseln verknüpfen Sie die Kostenposition mit ihr. Ergeben die Positionen einer Lieferung zusammen weniger als 0 €, ist sie eine Gutschrift ohne Rechnung: Sie belegt keinen Verbrauch, deckt also keine Tage ab und zählt keinen CO₂-Ausstoß; ihr Betrag mindert die Heizkosten der Heizperioden ihres Zeitraums.',
    example: 'Gasrechnung 15.03.2025–14.03.2026 über 6.500,00 €, Heizperiode Mai bis April: Nach Gradtagen gehören 848,71 ‰ in 2025/2026 (5.516,61 €), der Rest von 983,39 € in 2024/2025.',
    norm: '§ 7 Abs. 2 HeizkostenV',
    needed: 'Wenn eine Rechnung über die Heizperiode hinausreicht oder Mietfuchs die CO₂-Kosten selbst aufteilen soll. Ohne Verknüpfung verteilt Mietfuchs die Position ganz in ihrem Zeitraum und grenzt nichts ab.',
  },
  fuelStock: {
    topic: 'heating',
    title: 'Brennstoffvorrat (Bestandsrechnung)',
    short: 'Bei Heizöl, Flüssiggas, Pellets, Holz und Kohle liegt der Brennstoff im Tank oder Lager, und nicht jede Lieferung wird im selben Abrechnungszeitraum verbraucht. Umgelegt werden die Kosten der verbrauchten Brennstoffe und ihrer Lieferung, nicht der bezahlten Rechnungen: Anfangsbestand plus Lieferungen minus Endbestand. Wie der Endbestand zu bewerten ist, regelt die Heizkostenverordnung nicht; Mietfuchs rechnet wie die Kommentarliteratur und die Messdienste, dass das Älteste zuerst verbraucht wird, und bewertet den Endbestand zu den Preisen der jüngsten Lieferungen.',
    example: 'Anfangsbestand 2.000 l für 1.900 €, Lieferungen 3.000 l für 3.150 € und 2.500 l für 2.500 €, Endbestand 1.800 l. Der Endbestand stammt aus der jüngsten Lieferung und ist 1.800 € wert. Verbraucht wurden 5.700 l für 1.900 € + 3.150 € + 2.500 € − 1.800 € = 5.750 €; bezahlt haben Sie in diesem Zeitraum 5.650 €. Die 100 € Unterschied stehen in der Abrechnung als „aus dem Vorrat“ und „im Vorrat“.',
    norm: '§ 7 Abs. 2 HeizkostenV; BGH VIII ZR 156/11',
    needed: 'Ja, wenn Sie mit Heizöl, Flüssiggas, Pellets, Holz oder Kohle heizen und die Heizkosten selbst nach Schlüsseln verteilen, oder wenn der Messdienst die CO₂-Kosten nicht aufgeteilt hat. Dann tragen Sie auf der Seite Heizkosten in der Karte „Vorrat“ je Heizperiode den Endbestand ein und nur in der ersten auch den Anfangsbestand; danach übernimmt Mietfuchs den Endbestand der Vorperiode.',
  },
  perUnitHeating: {
    topic: 'heating',
    title: 'Etagenheizung',
    short: 'Eine Heizung in der Wohnung, meist eine Gastherme, die nur diese Wohnung versorgt. Die Heizkostenverordnung gilt dafür nicht, denn sie regelt nur zentrale Anlagen und die Wärmelieferung (§ 1 Abs. 1 HeizkostenV). Hat der Vermieter den Gasvertrag, sind die CO₂-Kosten aufzuteilen; eingestuft wird über die Gesamtwohnfläche der vermieteten Wohnungen mit eigener Heizung (§ 5 Abs. 1 Satz 2 CO2KostAufG). Ob der Vermieter die Gaskosten selbst als Betriebskosten umlegen darf, ist nicht geklärt: Die Betriebskostenverordnung nennt bei Etagenheizungen nur Reinigung und Wartung (§ 2 Nr. 4 Buchstabe d BetrKV), Buchstabe a bis c gelten für zentrale Anlagen und die Wärmelieferung.',
    example: `EG mit 60 m² und OG mit 40 m², je mit eigener Gastherme auf Ihren Vertrag; die Rechnungen nennen 1.800 kg und 1.200 kg CO₂ und CO₂-Kosten von 200 € und 120 €. 3.000 kg auf 100 m² ergeben 30,0 kg je m², Stufe ${E1.range}; Sie tragen ${E1.percent} %, beim EG ${(200 * E1.percent) / 100} €, beim OG ${(120 * E1.percent) / 100} €.`,
    norm: '§ 1 Abs. 1 HeizkostenV; § 2 Nr. 4 BetrKV; § 5 Abs. 1 Satz 2 CO2KostAufG',
    needed: 'Wenn in Wohnungen Thermen über Ihren Gasvertrag laufen. Jede Wohnung braucht dafür einen eigenen Gaszähler, denn die Rechnung gehört zu ihr. Umgelegt werden dürfen Betriebskosten nur, wenn der Mietvertrag es vereinbart (§ 556 Abs. 1 Satz 1 BGB); für die Gaskosten einer Etagenheizung prüfen Sie das bitte mit Ihrem Mietvertrag, im Zweifel mit Ihrem Haus- und Grundbesitzerverein. Hat der Mieter den Vertrag, gibt es keine Heizanlage des Hauses.',
  },
  boilerSwap: {
    topic: 'heating',
    title: 'Heizung erneuert (Kesseltausch) und Restbestand',
    short: 'Wird die Heizung erneuert, endet die bisherige Heizanlage am Tag vor dem Tausch, und eine neue beginnt mit denselben Wohnungen. Bleibt Heizöl, Flüssiggas oder Pellets im Tank, ist das der Restbestand. Heizt die neue Anlage mit demselben Brennstoff aus demselben Tank weiter, wird er ihr Anfangsbestand; Mietfuchs fragt das beim Tausch. Sonst tragen ihn die Mieter nicht, denn umgelegt werden nur die Kosten der verbrauchten Brennstoffe (§ 7 Abs. 2 HeizkostenV). Er bleibt dann mit seinem Wert bei Ihnen.',
    example: `Ölheizung bis 30.06., danach Gas. 500 l Restöl zu 1,05 € tragen die Mieter nicht, 525 € bleiben bei Ihnen. Eingestuft wird das Gebäude über das ganze Jahr: 12.043,35 kg aus dem Öl und 3.000 kg aus dem Gas auf 300 m² ergeben 50,1 kg je m² und ${K1.percent} %; das Öl allein ergäbe 40,1 kg je m² und ${K0.percent} %.`,
    norm: '§ 7 Abs. 2 HeizkostenV; § 5 Abs. 1 Satz 1 CO2KostAufG',
    needed: 'Wenn die Heizung im Lauf eines Abrechnungszeitraums ersetzt wird. Bleibt der Energieträger gleich und läuft er über denselben Zähler, etwa Gas über denselben Gaszähler, brauchen Sie keinen Tausch.',
  },
  fixedPriceComponent: {
    topic: 'heating',
    title: 'Fester Preisbestandteil',
    short: 'Grund-, Leistungs-, Mess- und Verrechnungspreis einer Versorgerrechnung. Er hängt an der Zeit, nicht an der Menge, und wird deshalb nach Tagen auf die Heizperioden geteilt.',
    example: 'Grund- und Leistungspreis 2.000,00 € für 15.03.2025–14.03.2026; auf 2025 entfallen 292 von 365 Tagen, also 1.600,00 €. Nach Gradtagen wären es 1.242,58 €.',
    needed: 'Nur wenn eine Rechnung über die Heizperiode hinausreicht. Ohne Angabe teilt Mietfuchs die ganze Rechnung nach dem Verbrauch.',
  },
  fuelEstimate: {
    topic: 'heating',
    title: 'Schätzung mit Vorbehalt',
    short: 'Fehlt beim Abschließen die Rechnung für einen Teil der Heizperiode, kann Mietfuchs diesen Teil aus der letzten Rechnung schätzen und mit Vorbehalt ausweisen. Ob ein Vermieter eine noch fehlende Versorgerrechnung so schätzen darf, ist höchstrichterlich nicht entschieden; sicher ist, abzuwarten, solange die Frist läuft.',
    example: 'Letzte Rechnung 6.000,00 €, die Lücke hat 151,29 ‰ ihrer Gradtage: geschätzt 6.000,00 € × 151,29 ‰ = 907,74 €. Kommt die Rechnung mit 983,39 € für diese Tage, stehen 75,65 € bei Ihnen.',
    norm: '§ 556 Abs. 3 Satz 2 und 3 BGB',
    needed: 'Nur wenn Sie abschließen wollen, bevor die Rechnung da ist.',
  },
  nonResidential: {
    topic: 'co2',
    title: 'Nichtwohngebäude (CO₂)',
    short: `Ein Gebäude, das nach seiner Zweckbestimmung nicht überwiegend dem Wohnen dient. Dort gilt keine Stufentabelle: Vereinbarungen, nach denen der Mieter mehr als die Hälfte der CO₂-Kosten trägt, sind unwirksam; Mietfuchs rechnet mit ${NON_RES_PERCENT} % beim Vermieter.`,
    example: `CO₂-Kosten 800,00 €: Der Vermieter trägt ${deCents(80000 * NON_RES_PERCENT)} €.`,
    norm: '§ 8 Abs. 1 CO2KostAufG',
    needed: 'Nur wenn das Gebäude überwiegend gewerblich oder anders als zum Wohnen genutzt wird.',
  },
  co2Restriction: {
    topic: 'co2',
    title: 'Beschränkungen (CO₂)',
    short: 'Stehen öffentlich-rechtliche Vorgaben, etwa Denkmalschutz, ein Anschluss- und Benutzungszwang oder eine Erhaltungssatzung, einer wesentlichen energetischen Verbesserung des Gebäudes oder seiner Wärmeversorgung entgegen, wird der Anteil des Vermieters gekürzt; stehen sie beidem entgegen, werden die CO₂-Kosten nicht aufgeteilt. Berufen darf sich der Vermieter darauf nur mit Nachweis gegenüber dem Mieter.',
    example: `Anteil des Vermieters laut Stufe 60 %; bei Denkmalschutz ${(60 * RESTRICTION.factor).toLocaleString('de-DE')} %. Bei beiden Vorgaben trägt der Vermieter nichts.`,
    norm: '§ 9 CO2KostAufG',
    needed: 'Nur wenn solche Vorgaben für Ihr Gebäude bestehen und Sie sie nachweisen können.',
  },
  districtEts: {
    topic: 'co2',
    title: 'Fernwärme aus dem Emissionshandel',
    short: `Das CO2KostAufG gilt auch für Wärme aus Anlagen im Europäischen Emissionshandel, aber nicht für Gebäude, die erstmals nach dem ${ETS_AFTER} einen Wärmeanschluss erhalten haben. Dann werden die CO₂-Kosten nicht aufgeteilt.`,
    example: 'Anschluss an das Wärmenetz im März 2023: keine Aufteilung. Anschluss 2015: Aufteilung nach der Stufentabelle wie bei Gas.',
    norm: '§ 2 Abs. 4 CO2KostAufG',
    needed: 'Nur bei Fernwärme, deren Wärme aus einer Anlage im Emissionshandel stammt.',
  },
  largestRemainder: {
    topic: 'costs',
    title: 'Restcent-Verfahren',
    short: 'Beim Runden auf Cent fehlen oder bleiben oft einzelne Cent übrig; Mietfuchs gibt sie an die Anteile mit dem größten Rest hinter dem Komma, damit die Summe genau dem Rechnungsbetrag entspricht. Ihr eigener Anteil (Eigennutzung, Leerstand) zählt dabei mit; bei gleichem Rest bekommen Sie den Cent vor einem Mieter.',
    example: '100,00 € auf drei gleich große Wohnungen sind je 33,3333 €. Gerundet wären das zusammen 99,99 €; den fehlenden Cent bekommt eine der drei, die dann 33,34 € trägt.',
    needed: 'Nein, Mietfuchs erledigt das selbst. Es erklärt nur, warum ein Anteil einen Cent vom rechnerischen Wert abweicht.',
  },
  ebev: {
    topic: 'co2',
    title: 'Emissionsberichterstattungsverordnung (EBeV 2030)',
    short: 'Die Verordnung nennt für jeden Brennstoff Standardwerte: wie viel CO₂ eine Menge Gas, Heizöl oder Flüssiggas beim Verbrennen ausstößt. Lieferanten rechnen damit die kg CO₂ auf ihrer Rechnung aus; Mietfuchs vergleicht die kg Ihrer Rechnung mit diesen Werten und meldet eine größere Abweichung als Hinweis.',
    example: `Erdgas nach Brennwert: ${ebevDe(EBEV.gas.tPerGj, 4)} t CO₂ je GJ und ${ebevDe(EBEV.gas.hsGjPerMwh, 4)} GJ je MWh. 100.000 kWh sind 100 MWh, also 100 × ${ebevDe(EBEV.gas.hsGjPerMwh, 4)} × ${ebevDe(EBEV.gas.tPerGj, 4)} = ${ebevDe(100 * EBEV.gas.hsGjPerMwh * EBEV.gas.tPerGj, 3)} t, rund ${ebevDe(Math.round(100000 * EBEV.gas.hsGjPerMwh * EBEV.gas.tPerGj), 0)} kg CO₂. Steht auf der Rechnung deutlich mehr, ist womöglich nach Heizwert statt nach Brennwert gerechnet.`,
    norm: '§ 3 Abs. 2 CO2KostAufG; Anlage 2 Teil 4 EBeV 2030',
    needed: 'Sie müssen nichts tun. Die kg CO₂ stehen auf der Rechnung Ihres Lieferanten; Mietfuchs nutzt die Werte nur zur Prüfung. Weniger kg als nach den Standardwerten können richtig sein, wenn ein anerkannter Biomasseanteil (Bio-Erdgas, Bioheizöl) abgezogen ist.',
  },
  // Heizung PR 16 (#213). Wortlaut § 556c BGB, WärmeLV §§ 1, 5, 8 bis 11, 13, HeizkostenV §§ 1, 7, 9, BetrKV
  // § 2 Nr. 4, CO2KostAufG §§ 2, 3 am 11.10.2026 gelesen; BGH, Urteil vom 20.05.2026, VIII ZR 46/25, Rn. 27,
  // 28, 30, 44 bis 47. Rn. 46 ist eine Feststellung im Einzelfall (Prüfung R-S4).
  heatDelivery: {
    topic: 'heating',
    title: 'Wärmelieferung (Contracting, Fernwärme)',
    short: `Liefert ein Dritter die Wärme, aus einem Wärmenetz (Fernwärme) oder aus einer Anlage im Haus, die er betreibt (Contracting), sind die Heizkosten das Entgelt für die Wärmelieferung und die Kosten des Betriebs der Hausanlagen. Verteilt werden sie nach der Heizkostenverordnung zu ${SHARE.min} bis ${SHARE.max} Prozent nach Verbrauch; nicht der Pflichtanteil von ${FORCED} % für ältere, nicht nach der Wärmeschutzverordnung 1994 gedämmte Gebäude mit Öl- oder Gasheizung und überwiegend gedämmten Leitungen, denn der gilt nur für die eigene Heizung (§ 7 Abs. 3 HeizkostenV verweist nicht auf Abs. 1 Satz 2).`,
    example: `Ein Contractor betreibt den Gaskessel im Keller und stellt 6.000 € Arbeitspreis und 1.200 € Grundpreis in Rechnung; dazu kommen 150 € Strom für die Pumpen der Hausanlage. Die Heizkosten sind 7.350 €. Wird der Warmwasseranteil mit einer Formel bestimmt, ist ihr Wert durch ${dhwDe(DHW_FACTORS.heatSupplyDivisor, 2)} zu teilen (÷ ${dhwDe(DHW_FACTORS.heatSupplyDivisor, 2)}), nicht wie bei eigenem Erdgas nach Brennwert mit ${dhwDe(DHW_FACTORS.gasCalorific, 2)} zu malnehmen. Die CO₂-Kosten teilt Mietfuchs wie bei Fernwärme auf: heizt er mit Gas, Öl oder Kohle, muss der Lieferant die CO₂-Angaben ausweisen.`,
    norm: '§ 556c BGB; §§ 1, 5, 8 bis 11 WärmeLV; § 1 Abs. 1 Nr. 2 und Abs. 3, § 7 Abs. 3 und 4, § 9 Abs. 2 Satz 6 Nr. 2, § 11 Abs. 1 Nr. 4 HeizkostenV; § 2 Nr. 4 Buchst. c BetrKV; § 2 Abs. 1 Satz 2, § 3 Abs. 4 CO2KostAufG',
    needed: `Wenn Ihr Haus mit Fernwärme oder von einem Contractor versorgt wird. Umlegen dürfen Sie die Kosten der Wärmelieferung, wenn der Mietvertrag es vorsieht (§ 2 Nr. 4 Buchst. c BetrKV). Haben Sie während laufender Mietverhältnisse von der eigenen Heizung umgestellt, gelten für diese Mieter die Voraussetzungen des § 556c BGB: bessere Effizienz und keine höheren Kosten als vorher. Außerdem ist die Umstellung spätestens ${SWITCH.noticeMonths} Monate vorher in Textform anzukündigen; fehlt die Ankündigung, beginnt die Frist für Einwendungen gegen die Abrechnung erst später (§ 11 Abs. 3 WärmeLV). Auch wer eine Betriebskostenpauschale zahlt, trägt die Heizkosten als Betriebskosten, denn § 556 Abs. 2 BGB lässt sie „als Pauschale oder als Vorauszahlung“ ausweisen (Auslegung von Mietfuchs); bei einer Inklusivmiete fehlt die Umlagevereinbarung, und § 556c gilt nicht. Hat der Mieter vorher selbst geheizt, etwa mit Einzelöfen, gilt § 556c nicht; ob und wie weit er die Kosten trägt, hängt dann von einer Vereinbarung ab, die auch stillschweigend entstehen kann. Der Bundesgerichtshof hat eine solche Vereinbarung im entschiedenen Fall jedenfalls über die Kosten angenommen, die bei eigener zentraler Versorgung nach § 7 Abs. 2 und § 8 Abs. 2 HeizkostenV angefallen wären (BGH, Urteil vom 20.05.2026, VIII ZR 46/25). Mietfuchs nennt das in der Abrechnung, wenn Sie an der Heizanlage den Tag der Umstellung eintragen. Betreibt ein Contractor den Kessel im Haus, wählen Sie bei der Heizanlage den Brennstoff des Kessels und setzen das Häkchen „Contracting“. Rechnet der Lieferant unmittelbar mit den Mietern ab und legt dabei die Anteile der Mieter am Gesamtverbrauch zugrunde, gelten die Pflichten des Gebäudeeigentümers aus der Heizkostenverordnung für ihn (§ 1 Abs. 3 HeizkostenV); misst er den Verbrauch jeder Wohnung selbst, gilt die Verordnung für diese Verteilung nicht. Wählen Sie dann bei „Wer erstellt Ihre Heizkostenabrechnung?“ die Antwort „Der Wärmelieferant rechnet unmittelbar mit den Mietern ab“; Mietfuchs legt in beiden Fällen keine Heizanlage an. Im ersten Fall sind die Kosten der Hausanlagen, die nicht in den Kosten der Wärmelieferung enthalten sind und die Sie gesondert abrechnen, von der Verteilung nach Verbrauch ausgenommen (§ 11 Abs. 1 Nr. 4 HeizkostenV).`,
  },
  legalBasis: {
    topic: 'period',
    title: 'Rechtsstand',
    short: 'Das Datum, auf dem die Regeln in Mietfuchs stehen, und die Regeln, die im Abrechnungsjahr gelten; beim Abschließen wird er mit der Abrechnung eingefroren.',
    example: 'Eine Abrechnung für 2023 mit Rechtsstand 30.09.2026 nennt die Regel zum Kabelfernsehen, denn 2023 war es bei Anlagen von vor dem 01.12.2021 noch umlagefähig; eine für 2025 nennt sie nicht mehr.',
    needed: 'Sie müssen nichts tun. Er zeigt, nach welchen Regeln eine Abrechnung erstellt wurde. Werte, die eine Behörde erst später veröffentlicht, etwa den CO₂-Preis des neuen Jahres, können Sie in den Einstellungen mit Quelle selbst eintragen; Mietfuchs braucht sie nur für die Prüfung Ihrer Rechnungen. Bringt ein Update den amtlichen Wert, gilt dieser.',
  },
} satisfies Record<string, Term>

export type TermId = keyof typeof GLOSSARY
