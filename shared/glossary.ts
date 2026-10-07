// Das Begriffslexikon (#113): jeder Fachbegriff, dem ein Vermieter in Mietfuchs begegnet, mit
// einer Erklärung in einem Satz, einem Beispiel mit Zahlen, der Rechtsgrundlage und der Antwort
// auf „Brauche ich das?“.
//
// Es liegt in shared/, weil beide Seiten es brauchen: Der Server hängt an jeden Hinweis die
// passenden Begriffe (`noticeKinds` in calc.ts), der Client zeigt sie an. Es ist der erste
// Laufzeitanteil hier; das Docker-Image übernimmt den Ordner (siehe CLAUDE.md).
//
// Maßstab für die Texte: einfache Worte, eine Rechtsaussage nur, wo sie im Gesetz steht, und
// Rechtsprechung ohne Aktenzeichen, wenn das Aktenzeichen nicht sicher belegt ist. Wer einen
// Eintrag ändert, prüft ihn bei der jährlichen Durchsicht mit (#110).
//
// Rechtszahlen kommen aus dem Rechtsregister (shared/law/, Heizung PR 1), und zwar in der Fassung
// von `LAW_AS_OF`: Das Lexikon erklärt das geltende Recht. Die Zahlen einer Beispielrechnung („70 %
// nach Verbrauch“) sind gewählt und bleiben stehen.
import { hkvConsumptionShare, hkvCutNotByConsumption, hkvCutRemoteReading, hkvDegreeDays, hkvDhwAreaFormula, hkvDhwFactors, hkvDhwVolumeFormula, hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit } from './law/heizkostenv.ts'
import { germanDate, LAW_AS_OF, onlyVersion, valueAt } from './law/register.ts'
import { co2CutMissing, co2DistrictEtsNew, co2FirstPeriodStart, co2NonResidential, co2Restriction, co2RoundingDecimals, co2StageTable } from './law/co2kostaufg.ts'

const SHARE = valueAt(hkvConsumptionShare, LAW_AS_OF)
const CUT = valueAt(hkvCutNotByConsumption, LAW_AS_OF)
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
const NEW_DEVICES_AFTER = germanDate(valueAt(hkvRemoteReadingNewDevices, LAW_AS_OF).installedAfter)
const RETROFIT_FROM = germanDate(onlyVersion(hkvRemoteReadingRetrofit).validFrom ?? '')

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

export type Term = {
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
    title: 'Umlagefähige Betriebskosten',
    short: 'Laufende Kosten des Hauses, die Sie auf die Mieter umlegen dürfen, wenn der Mietvertrag das vorsieht; welche das sind, zählt die Betriebskostenverordnung auf.',
    example: 'Grundsteuer 600 €, Müllabfuhr 360 €, Gebäudeversicherung 540 € im Jahr: zusammen 1.500 € umlagefähig.',
    norm: '§ 556 Abs. 1 BGB, § 2 BetrKV',
    needed: 'Ja, das ist der Kern jeder Nebenkostenabrechnung.',
  },
  notAllocable: {
    title: 'Nicht umlagefähige Kosten',
    short: 'Kosten, die der Vermieter selbst trägt, vor allem Verwaltung, Reparaturen und Instandhaltung; Mietfuchs rechnet sie ganz dem Vermieter zu.',
    example: 'Reparatur der Heizung 800 € und Kontoführung 60 €: beide 860 € trägt der Vermieter, auf der Abrechnung erscheinen sie nicht beim Mieter.',
    norm: '§ 1 Abs. 2 BetrKV',
    needed: 'Nur wenn Sie solche Rechnungen trotzdem erfassen, etwa für die Steuer (Anlage V). Die Zuführung zur Erhaltungsrücklage einer Eigentumswohnung erfassen Sie bitte nicht hier, sondern als Kostenart „Zuführung Erhaltungsrücklage“: Sie ist erst abziehbar, wenn die Gemeinschaft das Geld ausgibt.',
  },
  allocationKey: {
    title: 'Umlageschlüssel',
    short: 'Die Regel, nach der eine Rechnung auf die Wohnungen verteilt wird: nach Wohnfläche, Personen, Wohneinheiten, Verbrauch oder einer vereinbarten Quote.',
    example: '900 € Müllabfuhr nach Wohnfläche: Eine Wohnung mit 60 von 180 m² trägt 300 €.',
    norm: '§ 556a Abs. 1 BGB',
    needed: 'Ja, für jede Kostenposition. Ist im Mietvertrag nichts vereinbart, gilt die Wohnfläche; für gemessenen Verbrauch der Verbrauch, für Heizung die Heizkostenverordnung und bei einer Eigentumswohnung der Schlüssel der Gemeinschaft.',
  },
  // #141: Der Hinweis „Umlageschlüssel anders als im Vorjahr“ verweist hierher. Wortlaut des
  // § 556a BGB und des § 6 Abs. 4 HeizkostenV nachgelesen auf gesetze-im-internet.de am 01.10.2026.
  keyChange: {
    title: 'Wechsel des Umlageschlüssels',
    short: 'Ein vereinbarter Umlageschlüssel gilt weiter, bis er geändert wird: mit Zustimmung der Mieter, oder einseitig durch Ihre Erklärung in Textform, aber nur vor Beginn eines Abrechnungszeitraums und nur hin zu einer Verteilung nach erfasstem Verbrauch oder erfasster Verursachung.',
    example: 'Müllabfuhr 900 € bisher nach Personen: Ein Haushalt mit 4 von 6 Personen trug 600 €. Nach Wohnfläche mit 60 von 180 m² wären es 300 €. Ohne Zustimmung der Mieter bleibt es bei den Personen, denn ein Wechsel zur Fläche ist keiner hin zum Verbrauch.',
    norm: '§ 556a Abs. 2 und Abs. 3 BGB, § 6 Abs. 4 HeizkostenV',
    needed: 'Nur wenn Sie einen Schlüssel anders wählen als im Vorjahr. Bei einer vermieteten Eigentumswohnung gilt, soweit nichts anderes vereinbart ist, der jeweils geltende Maßstab der Gemeinschaft; ändert die Gemeinschaft ihn, ändert er sich auch gegenüber dem Mieter. Widerspricht er billigem Ermessen, wird nach Absatz 1 umgelegt, in der Regel nach Wohnfläche. Für Heizung und Warmwasser gilt vorrangig § 6 Abs. 4 HeizkostenV: Dort darf der Maßstab für künftige Abrechnungszeiträume auch aus anderen sachgerechten Gründen geändert werden.',
  },
  distributionBasis: {
    title: 'Verteilbasis',
    short: 'Die Gesamtmenge, durch die geteilt wird, etwa die Summe aller Wohnflächen; jede Wohnung trägt ihren Teil davon.',
    example: 'Drei Wohnungen mit 50, 60 und 70 m² ergeben eine Verteilbasis von 180 m². Die Wohnung mit 60 m² trägt 60/180 = ein Drittel.',
    needed: 'Sie rechnen sie nicht selbst aus, Mietfuchs zeigt sie im Rechenweg. Wichtig ist nur, dass für jede Wohnung der Wert eingetragen ist.',
  },
  billingUnit: {
    title: 'Abrechnungseinheit',
    short: 'Die Wohnungen, die gemeinsam abgerechnet werden; eine Wohnung außerhalb, etwa ein Laden mit eigener Abrechnung, bleibt ganz außen vor.',
    example: 'Haus mit drei Wohnungen und einem Laden: Die drei Wohnungen bilden die Abrechnungseinheit. Von 1.200 € Grundsteuer ziehen Sie zuerst den Anteil des Ladens ab, etwa 300 €; nur die übrigen 900 € verteilen sich auf die Wohnungen.',
    needed: 'Nur wenn nicht alle Einheiten gemeinsam abgerechnet werden. Sonst gehört jede Wohnung dazu. Nehmen Sie eine Einheit heraus, gehört auch ihr Anteil an gemeinsamen Rechnungen heraus, sonst tragen ihn die Mieter mit.',
  },
  granny: {
    title: 'Einliegerwohnung',
    short: 'Eine kleinere zweite Wohnung in einem Haus, das Sie selbst bewohnen; Sie rechnen die Nebenkosten nur mit dieser einen Mietpartei ab, Ihren eigenen Anteil tragen Sie selbst.',
    example: 'Ihre Wohnung hat 120 m², die Einliegerwohnung 45 m², zusammen 165 m². Von 600 € Grundsteuer nach Wohnfläche trägt die Mieterin 600 € × 45/165 = 163,64 €, die übrigen 436,36 € sind Ihr Eigenanteil.',
    norm: '§ 556a Abs. 1 BGB, § 2 HeizkostenV',
    needed: 'Wenn Sie im eigenen Haus eine Einliegerwohnung vermieten. Legen Sie ein Objekt an, Ihre eigene Wohnung als selbstgenutzt mit Fläche und Personen, die Einliegerwohnung als vermietet. Hat nur die Einliegerwohnung einen Zwischenzähler, legen Sie den Zähler des Hauses als Hauptzähler ohne Wohnung an: Dann zahlt die Mieterin ihren gemessenen Verbrauch, und der Rest ist Ihr Eigenanteil. Dieser Eigenanteil ist privat und steuerlich nicht abziehbar; in die Anlage V gehören die Kosten des Gebäudes nur zu dem Teil, der auf die vermietete Fläche entfällt. Bei den Heizkosten dürfen Sie in einem Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, mit der Mieterin etwas anderes vereinbaren als die Heizkostenverordnung, etwa eine Warmmiete; ohne eine solche Vereinbarung gilt sie.',
  },
  ownShare: {
    title: 'Eigenanteil',
    short: 'Der Teil der Kosten, der auf Ihre selbstgenutzte oder unentgeltlich überlassene Wohnung entfällt; Sie tragen ihn selbst, und er ist privat, also nicht als Werbungskosten abziehbar. Für die darin enthaltenen Arbeitskosten können Sie als Bewohner selbst die Steuerermäßigung nach § 35a nutzen. Was Sie wegen Leerstand oder als Rundungsrest tragen, gehört nicht dazu und bleibt Werbungskosten.',
    example: 'Grundsteuer 1.000 € nach Fläche, Ihre Wohnung hat 80 von 200 m²: 400 € sind Eigenanteil, nur die übrigen 600 € gehören in die Anlage V.',
    norm: '§ 9 Abs. 1, § 12 Nr. 1, § 35a EStG',
    needed: 'Wenn Sie selbst im Haus wohnen. Legen Sie Ihre Wohnung dann als selbstgenutzt an, sonst zahlen die Mieter Ihren Teil mit. Das gilt auch für eine Wohnung, die Sie unentgeltlich überlassen.',
  },
  mixedUse: {
    title: 'Teilweise selbstgenutztes Gebäude',
    short: 'Wohnen Sie selbst im Haus, sind dessen Kosten nur zu dem Teil Werbungskosten, der auf den vermieteten Teil entfällt: Was einer Wohnung direkt zuzuordnen ist, gehört ganz zu ihr, die Kosten des ganzen Gebäudes werden nach dem Verhältnis der Wohn- und Nutzflächen aufgeteilt.',
    example: 'Ihre Wohnung hat 120 m², die Einliegerwohnung 60 m², zusammen 180 m². Die Dachreparatur über 1.800 € ist zu 60/180 abziehbar, also 600 €; 1.200 € sind privat. Die Badrenovierung der Einliegerwohnung über 4.000 € ist ganz abziehbar, die in Ihrer Wohnung gar nicht.',
    norm: '§ 9 Abs. 1, § 12 Nr. 1 EStG; BFH, Urteil vom 24.06.2008, IX R 26/06',
    needed: 'Wenn Sie in einem Haus, in dem Sie vermieten, selbst wohnen oder eine Wohnung unentgeltlich überlassen. Legen Sie die eigene Wohnung als selbstgenutzt mit Fläche an; die Steuerübersicht teilt die Werbungskosten dann auf und zeigt den Rechenweg. Eine Reparatur, die nur eine Wohnung betrifft, ordnen Sie unter Kosten bei „Betrifft (für die Steuer)“ dieser Wohnung zu, eine Reparatur am Dach nur eines Gebäudeteils den betroffenen Einheiten. Wer zum ersten Mal verhältnismäßig aufteilt, erläutert dem Finanzamt den Maßstab in einer gesonderten Aufstellung; dafür taugt der Ausdruck der Steuerübersicht.',
  },
  vacancy: {
    title: 'Leerstand',
    short: 'Eine Wohnung ohne Mieter; ihren Anteil an den Kosten trägt der Vermieter und nicht die übrigen Mieter.',
    example: 'Eine von drei gleich großen Wohnungen steht vier Monate leer: Von 1.200 € Grundsteuer trägt der Vermieter für diese Zeit 400 € × 4/12 = 133,33 €. Beim Personenschlüssel zählt die leere Wohnung je Leerstandstag mit einer Person: Wohnen in den beiden anderen das ganze Jahr 2 und 1 Personen und steht die dritte leer, trägt der Vermieter von 600 € Müllabfuhr 600 € × 365/1.460 = 150 €.',
    norm: 'BGH, Urteil vom 31.05.2006, VIII ZR 159/05 (Grundsatz, am Flächenschlüssel); zum Personenschlüssel BGH, Beschluss vom 08.01.2013, VIII ZR 180/12',
    needed: 'Mietfuchs rechnet ihn von selbst heraus. Sie müssen nur Ein- und Auszug richtig eintragen. Wie eine leere Wohnung beim Personenschlüssel anzusetzen ist, regelt kein Gesetz und ist nicht abschließend geklärt; nach dem BGH kommt es auf den Einzelfall an, und eine fiktive Person für die Zeit des Leerstands kommt in Betracht; im Einzelfall hält er es auch für vertretbar, den Leerstand ganz außer Acht zu lassen. Mietfuchs setzt eine Person je Leerstandstag an; das ist eine Auslegung von Mietfuchs. Bei Kosten, die von der Personenzahl abhängen (etwa Wasser nach Personen), kann eine andere Aufteilung angemessener sein, zum Beispiel in Grund- und Verbrauchskosten.',
  },
  // #204: Der Hinweis „Mietverhältnisse überschneiden sich“ verweist hierher. Keine Rechtsgrundlage:
  // Es geht um einen Fehler in den erfassten Daten, nicht um eine Regel.
  tenancyOverlap: {
    title: 'Überschneidende Mietverhältnisse',
    short: 'Zwei Mietverhältnisse derselben Wohnung bestehen laut Ihren Angaben an mindestens einem Tag zugleich; für diese Zeit wird die Wohnung doppelt berechnet.',
    example: 'Auszug am 30.09. eingetragen, Nachmieter ab 01.09.: Bei 1.200 € Grundsteuer und einer Wohnung mit 50 von 100 m² tragen beide Mieter für dieselben 30 Tage je 1.200 € × 50/100 × 30/365 = 49,32 €, die Wohnung also 49,32 € zu viel.',
    needed: 'Nur wenn es Ihnen angezeigt wird. Meist ist ein Datum vertippt: Berichtigen Sie dann Auszug oder Einzug in den Stammdaten. Für den Wechsel gibt es dort den Mieterwechsel, der die Daten lückenlos setzt. Mietfuchs rechnet bis dahin wie erfasst.',
  },
  personDays: {
    title: 'Personentage',
    short: 'Beim Personenschlüssel zählt, wie viele Personen wie viele Tage im Jahr in der Wohnung gewohnt haben.',
    example: 'Zwei Personen das ganze Jahr sind 2 × 365 = 730 Personentage; zieht im Juli eine dritte ein, kommen 1 × 184 dazu.',
    needed: 'Nur beim Umlageschlüssel „Personen“. Tragen Sie Änderungen der Personenzahl mit Datum ein. Tage, an denen eine Wohnung leer steht, zählen mit einer Person; diesen Anteil tragen Sie als Vermieter (siehe Leerstand).',
  },
  prepayment: {
    title: 'Vorauszahlung',
    short: 'Ein monatlicher Betrag auf die Nebenkosten, über den einmal im Jahr abgerechnet wird; danach gibt es eine Nachzahlung oder ein Guthaben.',
    example: '150 € im Monat sind 1.800 € im Jahr. Betragen die Kosten 2.000 €, zahlt der Mieter 200 € nach.',
    norm: '§ 556 Abs. 2, § 560 Abs. 4 BGB',
    needed: 'Ja, wenn der Mietvertrag Vorauszahlungen vorsieht, der Normalfall. Nach der Abrechnung dürfen Sie sie angemessen anpassen.',
  },
  flatRate: {
    title: 'Betriebskostenpauschale',
    short: 'Ein fester monatlicher Betrag für die Nebenkosten, über den nicht abgerechnet wird; es gibt weder Nachzahlung noch Guthaben.',
    example: '120 € Pauschale im Monat sind 1.440 € im Jahr, gleich was die Kosten tatsächlich betragen.',
    norm: '§ 556 Abs. 2, § 560 Abs. 1 und 3 BGB',
    needed: 'Nur wenn der Mietvertrag eine Pauschale vereinbart. Erhöhen dürfen Sie sie nur, wenn der Vertrag das vorsieht und die Kosten tatsächlich gestiegen sind, mit einer begründeten Erklärung in Textform; sinken die Kosten, müssen Sie sie senken.',
  },
  inclusiveRent: {
    title: 'Inklusivmiete',
    short: 'Die Nebenkosten stecken in der Miete und werden weder gesondert ausgewiesen noch abgerechnet; steckt auch die Heizung darin, spricht man von einer Bruttowarmmiete. Nicht zu verwechseln mit der „Warmmiete“ im Alltag, die meist Kaltmiete plus Vorauszahlungen mit Abrechnung meint.',
    example: '750 € Miete im Monat einschließlich aller Nebenkosten: Es gibt keine Abrechnung, die Kosten trägt der Vermieter aus den 9.000 € Jahresmiete.',
    needed: 'Nur bei solchen Verträgen, häufig bei möblierten Zimmern oder Einliegerwohnungen. Für die Heizung gilt die Heizkostenverordnung trotzdem; eine Warmmiete ist nur im Haus mit höchstens zwei Wohnungen wirksam, von denen Sie eine selbst bewohnen, oder in den Ausnahmen des § 11 (siehe dort).',
  },
  heatingCostOrdinance: {
    title: 'Heizkostenverordnung',
    short: `Heizkosten müssen zu ${SHARE.min} bis ${SHARE.max} Prozent nach Verbrauch verteilt werden, der Rest nach Fläche oder umbautem Raum; beim Warmwasser der Rest nur nach Fläche. Die Verordnung geht einer anderen Vereinbarung im Mietvertrag vor.`,
    example: `3.000 € Heizkosten, 70 % nach Verbrauch: 2.100 € nach den Messwerten, 900 € nach Wohnfläche. Wird nicht nach Verbrauch abgerechnet, etwa nur nach Fläche, darf der Mieter seinen Anteil um ${CUT} % kürzen. Unabhängig davon darf er um ${REMOTE_CUT} % kürzen, wenn Zähler nicht fernablesbar sind, obwohl sie es sein müssten (neue Geräte seit Dezember 2021, alle übrigen ab 2027), oder wenn die vorgeschriebenen Verbrauchsinformationen fehlen.`,
    norm: '§§ 1, 2, 5, 6a, 7, 8, 11, 12 HeizkostenV',
    needed: 'Bei einer Zentralheizung, bei Fernwärme und bei zentraler Warmwasserbereitung, nicht bei Etagenheizungen oder Gasthermen in der Wohnung (§ 1 Abs. 1 HeizkostenV), gleich wer den Gasvertrag hat. Im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, dürfen Sie mit dem Mieter etwas anderes vereinbaren, etwa eine Warmmiete; ohne solche Vereinbarung gilt die Verordnung auch dort. Wenige weitere Ausnahmen nennt § 11, etwa wenn die Messung unverhältnismäßig teuer wäre. Wärmepumpen sind seit Oktober 2024 nicht mehr ausgenommen. Nicht fernablesbare Zähler und Heizkostenverteiler müssen bis zum 31.12.2026 nachgerüstet oder getauscht sein; klären Sie das bitte mit Ihrem Messdienst. Ab dem Abrechnungsjahr 2027 erinnert Mietfuchs in der Abrechnung daran.',
  },
  heatingSystem: {
    title: 'Heizanlage',
    short: 'Die Anlage, die das Haus mit Wärme und meist auch mit Warmwasser versorgt, etwa ein Gaskessel im Keller, eine Wärmepumpe oder der Anschluss an die Fernwärme. An der Heizanlage sagen Sie Mietfuchs, womit geheizt wird, wer die Heizkostenabrechnung erstellt und welche Wohnungen angeschlossen sind.',
    example: 'Ein Haus mit drei Wohnungen und Gaszentralheizung, abgerechnet vom Messdienst: Sie legen eine Heizanlage „Gas“ an und übernehmen die 3.600 € der Messdienstabrechnung wie bisher als Einzelbeträge, etwa 1.400 €, 1.200 € und 1.000 €. An diesen Beträgen ändert die Heizanlage nichts.',
    norm: '§ 1 HeizkostenV',
    needed: 'Nicht nötig, solange Sie die Heizkosten wie bisher erfassen. Mit den Angaben an der Heizanlage kann Mietfuchs sagen, ob Mieter wegen nicht fernablesbarer Geräte kürzen dürfen, und später die CO₂-Kosten und eine eigene Heizkostenabrechnung rechnen. Hat jede Wohnung eine eigene Heizung mit eigenem Vertrag des Mieters, gibt es keine Heizanlage des Hauses.',
  },
  heatCostAllocator: {
    title: 'Heizkostenverteiler',
    short: `Ein kleines Gerät am Heizkörper, das anzeigt, wie viel dieser Heizkörper im Verhältnis zu den übrigen geheizt hat. Seine Werte sind keine Kilowattstunden, sondern Einheiten, die erst mit den Werten aller Geräte des Hauses etwas bedeuten. Geräte, die nach dem ${NEW_DEVICES_AFTER} eingebaut wurden, müssen aus der Ferne ablesbar sein, alle übrigen ab dem ${RETROFIT_FROM}.`,
    example: `Im Wohnzimmer zeigt der Verteiler 420 Einheiten, im ganzen Haus sind es 4.200. Auf diesen Heizkörper entfällt damit ein Zehntel der Kosten nach Verbrauch, bei 2.100 € also 210 €. Ist das Gerät nicht fernablesbar, obwohl es das sein müsste, darf der Mieter seinen Anteil an den Heizkosten um ${REMOTE_CUT} % kürzen.`,
    norm: '§§ 5, 12 HeizkostenV',
    needed: 'Wenn Ihr Messdienst die Heizkosten nach Heizkostenverteilern abrechnet. Mietfuchs wertet ihre Einheiten noch nicht selbst aus; übernehmen Sie dafür die Abrechnung des Messdienstes als Einzelbeträge. Tragen Sie am Zähler ein, ob das Gerät fernablesbar ist und wann es eingebaut wurde; dann sagt die Abrechnung, ob Mieter kürzen dürfen.',
  },
  co2Split: {
    title: 'CO₂-Kostenaufteilung',
    short: 'Seit 2023 tragen Vermieter einen Teil der CO₂-Kosten der Heizung, und zwar umso mehr, je mehr CO₂ das Gebäude je Quadratmeter Wohnfläche ausstößt. Die Heizkostenabrechnung muss den Anteil des Mieters, die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen.',
    example: `600 € CO₂-Kosten in der Gasrechnung, 24.105,6 kg CO₂ bei 600 m² Wohnfläche: 40,2 kg je m², Stufe ${B1.range}. Der Vermieter trägt ${B1.percent} % der CO₂-Kosten, also ${(600 * B1.percent) / 100} €, die Mieter tragen ${600 - (600 * B1.percent) / 100} €. Fehlt die Aufteilung in der Heizkostenabrechnung, darf jeder Mieter seinen Anteil an den Heizkosten um ${CO2_CUT} % kürzen.`,
    norm: '§§ 5, 7 CO2KostAufG',
    needed: `Ja, wenn Sie mit Gas, Heizöl, Flüssiggas oder Kohle heizen oder Ihr Wärmelieferant CO₂-Kosten ausweist, für jeden Abrechnungszeitraum, der am oder nach dem ${CO2_FROM} beginnt. Rechnet ein Messdienst oder die Gemeinschaft ab, übernehmen Sie deren Angaben auf der Seite Heizkosten.`,
  },
  co2Stage: {
    title: 'Einstufung (CO₂-Stufe)',
    short: `Der CO₂-Ausstoß des Gebäudes in Kilogramm je Quadratmeter Wohnfläche und Jahr, auf ${CO2_DECIMALS === 1 ? 'eine Nachkommastelle' : `${CO2_DECIMALS} Nachkommastellen`} gerundet, ordnet das Gebäude einer von ${STAGES.length} Stufen zu. Die Stufe sagt, welchen Anteil der CO₂-Kosten der Vermieter trägt: von ${FIRST.landlordPercent} % unter ${SECOND.from} kg bis ${LAST.landlordPercent} % ab ${LAST.from} kg.`,
    example: `24.105,6 kg CO₂ bei 600 m² ergeben 40,176 kg je m², gerundet 40,2: Stufe ${B1.range}, der Vermieter trägt ${B1.percent} %. Ist ein Abrechnungszeitraum von unter einem Jahr vereinbart, werden die Grenzen der Tabelle anteilig gekürzt.`,
    norm: '§ 5 Abs. 1 und 2, Anlage CO2KostAufG',
    needed: 'Nur zum Prüfen: Die Stufe steht in der Abrechnung des Messdienstes. Mietfuchs ordnet den Wert nach und meldet, wenn der Anteil des Vermieters nicht zur Tabelle passt.',
  },
  co2Area: {
    title: 'Fläche der CO₂-Einstufung',
    short: 'Die Wohnfläche, durch die der CO₂-Ausstoß des Gebäudes geteilt wird. Das Gesetz sagt nicht, nach welcher Berechnung sie zu bestimmen ist; Mietfuchs nimmt im Zweifel die Fläche aus der Abrechnung des Messdienstes, damit beide Angaben übereinstimmen. Bei Etagenheizungen, deren Gasvertrag der Vermieter hat, zählt die Gesamtwohnfläche der vermieteten Wohnungen mit eigener Heizung (§ 5 Abs. 1 Satz 2 CO2KostAufG).',
    example: '5.421 kg CO₂ bei 200,6 m² laut Messdienst ergeben 27,02 kg je m², gerundet 27,0.',
    norm: '§ 5 Abs. 1 CO2KostAufG',
    needed: 'Nur, wenn Sie die Einstufung prüfen oder die Fläche des Messdienstes von Ihrer abweicht.',
  },
  serviceUnits: {
    title: 'Nutzeinheit',
    short: 'Jede Wohnung oder sonstige Einheit, die der Messdienst in seiner Heizkostenabrechnung einzeln abrechnet, auch eine leerstehende und Ihre eigene. Die Zahl steht in der Abrechnung, meist in der Kostenaufstellung oder auf dem Deckblatt.',
    example: 'Ein Haus mit vier Wohnungen, eine davon steht leer: Der Messdienst rechnet vier Nutzeinheiten ab. Für die Probe in der Karte „CO₂-Kosten“ darf die Summe der eingetragenen Beträge wegen der Rundung je Nutzeinheit um bis zu 4 · 2 ct = 8 ct über der gedruckten Summe liegen.',
    needed: 'Nur für die Probe der CO₂-Angaben auf der Seite Heizkosten.',
  },
  co2Deducted: {
    title: 'Abzugszeile (Vorwegabzug)',
    short: 'Manche Messdienste ziehen den CO₂-Anteil des Vermieters schon in der Kostenaufstellung ab, mit einer Zeile wie „Abzüglich CO₂-Kosten Vermieter“. Die Beträge der Mieter sind dann schon entlastet, und bezahlt haben Sie die Summe der Nutzerkosten plus diesen Anteil.',
    example: 'Die Kostenaufstellung nennt „Anlieferung Brennstoff“ 3.540,00 €, darunter „Abzüglich CO₂-Kosten Vermieter“ 87,50 €, und verteilt 3.452,50 €. Zusammen mit Strom, Wartung und Messdienstkosten ergeben die Kosten aller Nutzer 3.845,51 €; bezahlt haben Sie 3.845,51 € + 87,50 € = 3.933,01 €, und das ist der Betrag Ihrer Position.',
    norm: '§ 7 Abs. 1 CO2KostAufG',
    needed: 'Ja, wenn Ihre Abrechnung eine solche Zeile hat: Dann beantworten Sie die Frage in der Karte „CO₂-Kosten“ auf der Seite Heizkosten mit „Ja“.',
  },
  hotWaterShare: {
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
    title: 'Grundkosten',
    short: 'Der Teil der Heiz- oder Warmwasserkosten, der nicht nach Verbrauch, sondern nach der Fläche verteilt wird; bei der Heizung auch nach der beheizten Fläche.',
    example: 'Topf Heizung 5.628,00 €, davon 30 % Grundkosten = 1.688,40 €. Eine Wohnung mit 60 von 200 m² trägt davon 506,52 €.',
    norm: '§ 7 Abs. 1 Satz 5, § 8 Abs. 1 HeizkostenV',
    needed: 'Ja, wenn Sie die Heizkosten selbst abrechnen. Mietfuchs rechnet sie aus dem Anteil, den Sie nach Verbrauch verteilen.',
  },
  consumptionCosts: {
    title: 'Verbrauchskosten',
    short: 'Der Teil der Heiz- oder Warmwasserkosten, der nach dem gemessenen Verbrauch verteilt wird, bei der Heizung nach Kilowattstunden, beim Warmwasser nach Kubikmetern.',
    example: 'Topf Heizung 5.628,00 €, davon 70 % nach Verbrauch = 3.939,60 €. Eine Wohnung mit 12.000 von 40.000 kWh trägt davon 1.181,88 €.',
    norm: '§ 7 Abs. 1 Satz 1, § 8 Abs. 1 HeizkostenV',
    needed: 'Ja, wenn Sie die Heizkosten selbst abrechnen. Ohne Zähler darf jeder Mieter seinen Anteil kürzen. Bei einer Öl- oder Gasheizung in einem Haus mit Wärmeschutz unter dem Niveau von 1994 und überwiegend gedämmten Leitungen ist der Anteil vorgeschrieben (§ 7 Abs. 1 Satz 2 HeizkostenV). Dass eine Flüssiggasheizung dazu zählt, ist eine Auslegung von Mietfuchs: Der Wortlaut sagt „Gasheizung“ ohne Einschränkung, wo die Verordnung Erdgas meint, sagt sie es (§ 9 Abs. 2 Satz 6 und die Tabelle in § 9 Abs. 3), und die Begründung (BR-Drs. 570/08) nennt Öl- und Gasheizungen und grenzt nur gegen Fernwärme ab. Der vorgeschriebene Anteil ist unter beiden Lesarten zulässig.',
  },
  forcedConsumptionShare: {
    title: 'Pflichtanteil nach Verbrauch',
    short: 'In Gebäuden, die das Anforderungsniveau der Wärmeschutzverordnung vom 16. August 1994 nicht erfüllen, die mit einer Öl- oder Gasheizung versorgt werden und in denen die freiliegenden Leitungen der Wärmeverteilung überwiegend gedämmt sind, ist der Anteil der Heizkosten nach Verbrauch vorgeschrieben; eine Wahl zwischen den Grenzen gibt es dann nicht.',
    example: 'Topf Heizung 5.000,00 €. Gilt der Pflichtanteil, gehen 3.500,00 € nach Verbrauch und 1.500,00 € nach Fläche; mit 50 % wären es je 2.500,00 €.',
    norm: '§ 7 Abs. 1 Satz 2, § 10 HeizkostenV',
    needed: 'Nur bei einer Öl- oder Gasheizung (Flüssiggas zählt nach Auslegung von Mietfuchs dazu, siehe Verbrauchskosten). Wissen Sie nicht, ob die Voraussetzungen vorliegen, liegen Sie mit dem Pflichtanteil in jedem Fall richtig, denn er liegt auch innerhalb der freien Wahl. Mehr geht nur mit einer Vereinbarung (§ 10 HeizkostenV). Den Pflichtanteil nachzutragen ist keine Änderung nach § 6 Abs. 4 und geht auch in einer begonnenen Heizperiode.',
  },
  interimReading: {
    title: 'Zwischenablesung',
    short: 'Die Ablesung der Wärme- und Warmwasserzähler, wenn ein Mieter mitten im Abrechnungszeitraum aus- oder einzieht. Nach ihr werden die Verbrauchskosten aufgeteilt; die übrigen Heizkosten nach Gradtagszahlen oder zeitanteilig, die übrigen Warmwasserkosten zeitanteilig.',
    example: 'Wechsel zum 30.09.: Grundkosten Heizung der Wohnung 506,52 €. Nach Gradtagen (Januar bis September 640 Promille) trägt der Vormieter 324,17 € und der Nachmieter 182,35 €; zeitanteilig wären es 378,85 € und 127,67 €.',
    norm: '§ 9b HeizkostenV',
    needed: 'Ja, bei jedem Mieterwechsel. Ist sie nicht möglich, werden die gesamten Kosten der Wohnung nach Gradtagen bzw. Tagen geteilt. Die Kosten der Zwischenablesung trägt der Vermieter, soweit nichts anderes vereinbart ist (BGH, Urteil vom 14.11.2007, VIII ZR 19/07); ob eine Klausel im Formularmietvertrag genügt, hat der BGH nicht entschieden. Das AG Berlin-Hohenschönhausen (16 C 205/07) hält sie für unwirksam; das ist die Entscheidung eines Amtsgerichts.',
  },
  heatMeter: {
    title: 'Wärmezähler',
    short: 'Ein geeichtes Messgerät, das die Wärme in Kilowattstunden misst, etwa an der Leitung einer Wohnung oder am Warmwasserspeicher.',
    example: 'Der Wärmezähler der Wohnung zeigt am 31.12.2024 1.000 kWh und am 31.12.2025 13.000 kWh: verbraucht sind 12.000 kWh.',
    norm: '§ 5 Abs. 1 HeizkostenV',
    needed: 'Wenn Sie die Heizkosten selbst abrechnen. Ein Wärmezähler am Warmwasserspeicher misst den Anteil des Warmwassers; ohne ihn ist eine Formel nur bei unzumutbar hohem Aufwand erlaubt.',
  },
  cableTv: {
    title: 'Kabelfernsehen',
    short: 'Die Gebühren für das TV-Signal eines Kabelanschlusses sind seit dem 01.07.2024 keine umlagefähigen Betriebskosten mehr, bei Anlagen ab dem 01.12.2021 waren sie es nie. Bei Anlagen, die vor dem 01.12.2021 errichtet wurden, bleibt der Betriebsstrom umlagefähig, bei einer Gemeinschaftsantenne des Hauses auch ihre Prüfung und Einstellung durch eine Fachkraft; bei neueren Anlagen auch das nicht.',
    example: 'Kabelgebühren 2024 von 240 € bei einer Anlage, die vor dem 01.12.2021 errichtet wurde: Umlegen dürfen Sie höchstens die 120 € für Januar bis Juni. Ab 2025 nichts mehr davon.',
    norm: '§ 2 Satz 1 Nr. 15 und Satz 2 BetrKV',
    needed: 'Nur wenn Ihr Haus einen Kabelanschluss über einen Sammelvertrag hat.',
  },
  consumptionKey: {
    title: 'Verbrauchsschlüssel',
    short: 'Die Kosten werden nach den Zählerständen verteilt, also danach, wie viel jede Wohnung tatsächlich verbraucht hat.',
    example: 'Wasser 1.000 €, gemessen 60 m³ in Wohnung A und 40 m³ in Wohnung B: A trägt 600 €, B 400 €.',
    norm: '§ 556a Abs. 1 Satz 2 BGB; BGH, Urteil vom 12.03.2008, VIII ZR 188/07',
    needed: 'Wenn alle vermieteten Wohnungen eigene Zähler haben; dann ist ohne andere Vereinbarung nach Verbrauch umzulegen. Fehlt einer Mietwohnung der Zähler, müssen Sie nicht nach Verbrauch abrechnen.',
  },
  mainMeter: {
    title: 'Hauptzähler und Zwischenzähler',
    short: 'Der Hauptzähler misst das ganze Haus, ein Zwischenzähler eine einzelne Wohnung. Fehlt nur Ihrer eigenen Wohnung der Zwischenzähler, gilt für sie der Rest des Hauptzählers, samt Messdifferenz. Fehlt er einer vermieteten Wohnung, rechnen Sie besser nach Fläche ab; zur Abrechnung nach Verbrauch sind Sie dann nicht verpflichtet. Rechnen Sie trotzdem so, lässt Mietfuchs den Rest des Hauptzählers beim Vermieter, sofern der Hauptzähler das ganze Jahr abgelesen ist; sonst tragen die übrigen Wohnungen diesen Verbrauch mit, und Mietfuchs warnt.',
    example: 'Hauptzähler 200 m³, Zwischenzähler der Einliegerwohnung 40 m³, Ihre Wohnung ohne Zähler: Die übrigen 160 m³ gelten als Ihr Verbrauch. Bei 1.000 € Wasser trägt der Mieter der Einliegerwohnung 200 €, 800 € sind Ihr Eigenanteil.',
    needed: 'Wenn nicht jede Wohnung einen eigenen Zähler hat, etwa bei einer Einliegerwohnung. Lesen Sie den Hauptzähler dann zum 31.12. ab. Weicht die Summe der Wohnungszähler um mehr als etwa 20 % vom Hauptzähler ab, ist das Umlegen der Differenz nach der Rechtsprechung der Instanzgerichte angreifbar; klären Sie dann die Ursache.',
  },
  meterReading: {
    title: 'Zählerstand und Zählerwechsel',
    short: 'Der Verbrauch ist der Unterschied zweier Ablesungen; wird ein Zähler getauscht, gehören der Endstand des alten und der Anfangsstand des neuen Geräts dazu.',
    example: 'Stand am 31.12.2024: 120 m³, am 31.12.2025: 165 m³, Verbrauch 45 m³. Beim Tausch im Juni: alter Zähler endet bei 140, neuer beginnt bei 0 und steht am Jahresende bei 25; zusammen ebenfalls 45 m³.',
    needed: 'Wenn Sie nach Verbrauch abrechnen. Ablesen am besten immer zum 31.12.',
  },
  directAssignment: {
    title: 'Direktzuordnung',
    short: 'Eine Rechnung gehört vollständig zu einer einzigen Wohnung und wird nicht verteilt.',
    example: 'Der Schornsteinfeger prüft nur die Gastherme in Wohnung B für 85 €: Die 85 € trägt allein Wohnung B.',
    needed: 'Selten, nur für Rechnungen, die eindeutig eine Wohnung betreffen.',
  },
  agreedShares: {
    title: 'Vereinbarte Anteile',
    short: 'Im Mietvertrag steht für jede Wohnung eine feste Quote in Prozent; was unter 100 Prozent bleibt, trägt der Vermieter.',
    example: 'Aufzug 2.000 €, vereinbart 40 % für Wohnung A und 35 % für B: A trägt 800 €, B 700 €, der Vermieter 500 €.',
    norm: '§ 556a Abs. 1 BGB',
    needed: 'Nur wenn Ihr Mietvertrag solche Quoten nennt.',
  },
  individualAmounts: {
    title: 'Einzelbeträge',
    short: 'Die Beträge je Mieter stehen schon fest, etwa in der Abrechnung eines Messdienstes, und werden unverändert übernommen.',
    example: 'Die Heizkostenabrechnung des Messdienstes über 3.000 € nennt 1.240 € für Wohnung A und 1.160 € für B; 600 € entfallen auf Ihre eigene Wohnung.',
    needed: 'Wenn ein Dienstleister wie ein Messdienst bereits je Wohnung abgerechnet hat.',
  },
  participants: {
    title: 'Teilnehmende Wohnungen',
    short: 'Eine Rechnung betrifft nur einen Teil der Wohnungen und wird nur auf diese verteilt.',
    example: 'Der Aufzug 1.800 € im Jahr dient nur den drei Wohnungen im Hinterhaus: Nur ihre 210 m² bilden die Verteilbasis.',
    needed: 'Nur wenn nicht alle Wohnungen eine Einrichtung nutzen, etwa Aufzug, Waschküche oder ein zweites Haus.',
  },
  mea: {
    title: 'Miteigentumsanteile (MEA)',
    short: 'Der Anteil einer Eigentumswohnung am gemeinsamen Eigentum, meist in Tausendsteln; nach ihm verteilt die Gemeinschaft ihre Kosten.',
    example: 'Ihre Wohnung hat 85 von 1.000 MEA. Die Gebäudeversicherung der Anlage über 6.000 € kostet Sie 85/1.000 × 6.000 = 510 €.',
    norm: '§ 16 Abs. 1 und 2 WEG, § 556a Abs. 3 BGB',
    needed: 'Nur bei einer vermieteten Eigentumswohnung. Ohne andere Vereinbarung gilt der Maßstab der Gemeinschaft auch gegenüber dem Mieter, sofern er nicht unbillig ist. Haben Sie mehrere Wohnungen in derselben Anlage, verteilt Mietfuchs den Betrag „laut Gemeinschaftsabrechnung“ auf sie nach Miteigentumsanteilen oder Fläche, nicht nach ihrem Verbrauch; für Heizkosten übernehmen Sie dann besser die Beträge je Wohnung aus der Heizkostenabrechnung als Einzelbeträge.',
  },
  noConnection: {
    title: 'Einheit ohne Anschluss',
    short: 'Eine Einheit, die für eine Zählerart gar keinen Anschluss hat, etwa eine Garage ohne Wasser; ihr fehlt dann kein Zähler, und Verbrauchskosten dieser Art betreffen sie nicht.',
    example: 'Wasser 600 € nach Verbrauch, zwei Wohnungen mit 40 und 20 m³ gemessen, dazu eine vermietete Garage ohne Wasser: Die Wohnungen tragen 400 € und 200 €, die Garage nichts, und Mietfuchs warnt nicht vor einem fehlenden Zähler.',
    needed: 'Nur wenn eine Einheit eines Objekts mit Zählern keinen Anschluss dieser Art hat. Im Normalfall bleiben alle Häkchen gesetzt.',
  },
  homeownersStatement: {
    title: 'Hausgeldabrechnung',
    short: 'Die Jahresabrechnung der Eigentümergemeinschaft; aus ihr übernehmen Sie für die Nebenkostenabrechnung nur die umlagefähigen Kosten.',
    example: 'Hausgeld 3.600 € im Jahr, davon 1.900 € umlagefähig (Versicherung, Müll, Allgemeinstrom, Hausmeister). Verwaltergebühr 360 € und Reparaturen 440 € tragen Sie selbst und setzen sie als Werbungskosten an. Die Zuführung zur Rücklage von 900 € tragen Sie ebenfalls selbst, abziehbar ist sie aber erst, wenn die Gemeinschaft sie ausgibt (siehe Erhaltungsrücklage). Die Grundsteuer steht nicht darin, sie kommt mit eigenem Bescheid an Sie.',
    norm: '§ 28 WEG, § 556a Abs. 3 BGB',
    needed: 'Nur bei einer vermieteten Eigentumswohnung.',
  },
  homeownersFee: {
    title: 'Hausgeld (Vorschuss)',
    short: 'Der monatliche Vorschuss, den Sie als Eigentümer an die Gemeinschaft zahlen, festgelegt im Wirtschaftsplan; er ist eine Vorauszahlung und noch keine Abrechnung. Erst die Hausgeldabrechnung nach Ende des Jahres sagt, welche Kosten wirklich angefallen sind, und ein Teil des Vorschusses ist meist die Zuführung zur Erhaltungsrücklage.',
    example: 'Hausgeld 300 € im Monat, also 3.600 € im Jahr, davon 900 € Zuführung zur Erhaltungsrücklage: Im Jahr der Zahlung sind 2.700 € als Werbungskosten abziehbar, die 900 € erst, wenn die Gemeinschaft sie für eine Erhaltungsmaßnahme ausgibt. Eine Nachzahlung aus der Hausgeldabrechnung zählt im Jahr, in dem Sie sie bezahlen.',
    norm: '§ 28 WEG; § 11 Abs. 2 EStG',
    needed: 'Nur bei einer vermieteten Eigentumswohnung. Für die Nebenkostenabrechnung Ihres Mieters zählt nicht der Vorschuss, sondern die Hausgeldabrechnung: Aus ihr übernehmen Sie die umlagefähigen Kosten. Für die Steuer zählt dagegen, wann das Geld abfließt, also der gezahlte Vorschuss im Jahr der Zahlung, ohne den Anteil der Erhaltungsrücklage. Mietfuchs führt Kosten nach dem Jahr der Abrechnung; weichen Zahlungsjahr und Abrechnungsjahr ab, gleichen Sie das für die Anlage V bitte selbst ab.',
  },
  reserveFund: {
    title: 'Erhaltungsrücklage',
    short: 'Ein Teil des Hausgelds einer Eigentumswohnung, den die Gemeinschaft für künftige Reparaturen ansammelt; als Werbungskosten abziehbar ist er erst, wenn und soweit die Gemeinschaft das Geld für Erhaltungsmaßnahmen ausgibt, nicht schon bei der Zahlung.',
    example: 'Hausgeld 3.600 € im Jahr, davon 900 € Zuführung zur Erhaltungsrücklage: Sofort abziehbar sind höchstens 3.600 − 900 = 2.700 €. Bezahlt die Gemeinschaft zwei Jahre später aus der Rücklage eine Dachreparatur, ist Ihr Anteil daran erst in diesem Jahr Werbungskosten.',
    norm: '§ 19 Abs. 2 Nr. 4 WEG; § 9 Abs. 1 EStG; BFH, Urteil vom 14.01.2025, IX R 19/24',
    needed: 'Nur bei einer vermieteten Eigentumswohnung. Erfassen Sie die Zuführung als Kostenart „Zuführung Erhaltungsrücklage“; Mietfuchs legt sie nicht auf den Mieter um und weist sie in der Steuerübersicht getrennt von den Werbungskosten aus.',
  },
  labor35a: {
    title: 'Lohnanteil nach § 35a EStG',
    short: 'Der Teil einer Rechnung, der auf Arbeit entfällt, einschließlich Maschinen- und Fahrtkosten und Umsatzsteuer, ohne Material. Weist die Abrechnung den Anteil des Mieters daran aus oder bescheinigen Sie ihn, kann er 20 Prozent davon unmittelbar von seiner Einkommensteuer abziehen, je Haushalt und Jahr höchstens 4.000 € für haushaltsnahe Dienstleistungen und 1.200 € für Handwerkerleistungen, über alle Rechnungen zusammen. Voraussetzung ist, dass die Rechnung unbar an den Handwerker oder Dienstleister bezahlt wurde.',
    example: 'Gartenpflege 1.000 €, davon Lohn 800 €: Trägt der Mieter 250 € der Rechnung, entfallen davon 200 € auf Lohn, und er kann 20 % davon abziehen, also 40 €.',
    norm: '§ 35a Abs. 2, 3 und 5 EStG; BMF-Schreiben vom 09.11.2016',
    needed: 'Nicht Pflicht, aber für Ihre Mieter bares Geld. Den Lohnanteil finden Sie auf der Rechnung des Handwerkers oder Dienstleisters.',
  },
  settlementDeadline: {
    title: 'Abrechnungsfrist',
    short: 'Die Abrechnung muss dem Mieter spätestens zwölf Monate nach Ende des Abrechnungszeitraums zugehen, sonst können Sie in der Regel keine Nachzahlung mehr verlangen; ausgenommen ist nur eine Verspätung, die Sie nicht zu vertreten haben.',
    example: 'Abrechnung für 2025: Sie muss bis zum 31.12.2026 beim Mieter sein. Kommt sie am 02.01.2027, entfällt eine Nachzahlung von 200 €; ein Guthaben des Mieters bleibt fällig.',
    norm: '§ 556 Abs. 3 BGB; BGH, Urteil vom 20.05.2026, VIII ZR 6/24',
    needed: 'Ja, für jede Abrechnung. Es zählt der Zugang beim Mieter, nicht das Absenden. Bei einer Eigentumswohnung gilt die Frist auch, wenn die Hausgeldabrechnung noch fehlt. Liegt der Grundsteuerbescheid ohne Ihr Verschulden noch nicht vor, oder haben Sie gegen ihn, den Grundsteuerwert- oder den Messbescheid Einspruch eingelegt, dürfen Sie mit der Grundsteuer warten, bis der endgültige Bescheid da oder über den Einspruch entschieden ist. Rechnen Sie das Übrige trotzdem fristgerecht ab, behalten Sie sich die Grundsteuer ausdrücklich vor und fordern Sie sie im Regelfall innerhalb von drei Monaten danach. Mietfuchs zeigt die Frist auf der Seite Abrechnung.',
  },
  // #208: Abrechnungszeitraum, Rumpf und Leistungsprinzip. § 556 Abs. 3 BGB und VIII ZR 316/10,
  // VIII ZR 49/07, VIII ZR 156/11 gelesen am 05.10.2026 (Entwurf 2).
  billingPeriod: {
    title: 'Abrechnungszeitraum',
    short: 'Die Zeit, über die Sie die Nebenkosten abrechnen: höchstens zwölf Monate, meist das Kalenderjahr, auf Wunsch etwa Mai bis April wie Ihr Messdienst.',
    example: 'Ein Objekt rechnet von Mai bis April ab: Der Zeitraum 2025/2026 läuft vom 01.05.2025 bis 30.04.2026, und die Abrechnung muss den Mietern bis 30.04.2027 zugehen.',
    norm: '§ 556 Abs. 3 BGB',
    needed: 'Nur wenn Ihr Messdienst oder Ihr Mietvertrag einen anderen Zeitraum als das Kalenderjahr nennt. Mietkonto und Steuer bleiben beim Kalenderjahr.',
  },
  // Heizung PR 5 (#217): BGH, Urteil vom 30.04.2008, VIII ZR 240/07, Leitsätze nachgelesen (Entwurf 3.1).
  heatingPeriod: {
    title: 'Eigene Heizperiode',
    short: 'Die Heizkosten werden für einen anderen Zeitraum abgerechnet als die übrigen Betriebskosten, meist für den des Messdienstes, etwa Mai bis April.',
    example: 'Die Betriebskostenabrechnung 2026 umfasst Januar bis Dezember 2026, darin die Heizkosten der Heizperiode 01.05.2025–30.04.2026. Ein Mieter, der am 31.10.2025 ausgezogen ist, bekommt für 2026 eine Abrechnung nur mit seinen Heizkosten vom 01.05. bis 31.10.2025: Rechnet der Messdienst für die Wohnung 1.000,00 € ab, davon 412,30 € bis zum Auszug und 587,70 € für den Nachmieter, sind das 412,30 €.',
    norm: 'BGH, Urteil vom 30.04.2008, VIII ZR 240/07; § 556 Abs. 3 BGB',
    needed: 'Nur wenn Ihr Messdienst nicht im Zeitraum Ihrer Abrechnung abrechnet und Sie den Zeitraum nicht umstellen wollen. Zulässig ist das, wenn Heizkosten und übrige Kosten mit einer gemeinsamen Vorauszahlung abgerechnet werden. Werden die Heizkosten mit eigener Vorauszahlung getrennt abgerechnet, bekommt jede Heizperiode ihre eigene Heizkostenabrechnung mit eigener Frist; das ist eine Auslegung des Gesetzes. Legt Ihr Mietvertrag den Zeitraum fest, braucht eine Änderung die Zustimmung der Mieter.',
  },

  separateHeatingSettlement: {
    title: 'Getrennte Heizkostenabrechnung',
    short: 'Die Heizkosten werden mit einer eigenen Heizkostenvorauszahlung in einer eigenen Abrechnung je Heizperiode abgerechnet, getrennt von den übrigen Betriebskosten.',
    example: 'Der Mieter zahlt 300,00 € im Monat, davon 123,00 € Heizkostenvorauszahlung und 177,00 € für die übrigen Nebenkosten. Die Heizkostenabrechnung 01.05.2025–30.04.2026 rechnet 12 × 123,00 € = 1.476,00 € gegen Heizkosten von 1.500,00 € an: Nachzahlung 24,00 €, zuzustellen bis 30.04.2027. Die Betriebskostenabrechnung rechnet nur die 177,00 € im Monat an.',
    norm: '§ 556 Abs. 3 BGB; dass eine eigene Heizkostenvorauszahlung eine eigene Abrechnung mit eigener Frist erlaubt, ist eine Auslegung (BGH, Urteil vom 30.04.2008, VIII ZR 240/07, gilt für die gemeinsame Vorauszahlung)',
    needed: 'Meist nein. Nur wenn Ihr Mietvertrag eine eigene Heizkostenvorauszahlung und eine eigene Heizkostenabrechnung vorsieht. Zahlen Ihre Mieter eine Vorauszahlung für alle Nebenkosten, rechnen Sie die Heizkosten in der Betriebskostenabrechnung mit ab.',
  },

  shortPeriod: {
    title: 'Rumpfzeitraum',
    short: 'Ein kürzerer Abrechnungszeitraum vor einem Wechsel, damit kein Zeitraum länger als zwölf Monate wird.',
    example: 'Umstellung vom Kalenderjahr auf Mai bis April ab Mai 2025: 01.01.–30.04.2025 ist ein Rumpfzeitraum mit 120 Tagen; seine Abrechnung muss bis 30.04.2026 zugehen.',
    norm: '§ 556 Abs. 3 BGB; BGH, Urteil vom 27.07.2011, VIII ZR 316/10',
    needed: 'Nur beim Wechsel des Zeitraums. Eine Verkürzung braucht einen sachlichen Grund, etwa die Angleichung an den Messdienst; legt der Mietvertrag den Zeitraum fest, braucht sie die Zustimmung der Mieter. Eine Verlängerung über zwölf Monate gibt es nicht.',
  },
  accrualPrinciple: {
    title: 'Leistungsprinzip',
    short: 'Eine Rechnung gehört in den Abrechnungszeitraum, in dem die Leistung erbracht wurde; reicht sie über zwei Zeiträume, teilt Mietfuchs kalte Betriebskosten nach Tagen auf. Heizkosten richten sich nach dem Verbrauch im Zeitraum und werden nicht nach Tagen geteilt.',
    example: 'Grundsteuer 2025 über 480 € bei einer Abrechnung von Mai bis April: 120 von 365 Tagen gehören in 2024/2025 (157,81 €), 245 Tage in 2025/2026 (322,19 €).',
    norm: 'BGH, Urteil vom 20.02.2008, VIII ZR 49/07; BGH, Urteil vom 01.02.2012, VIII ZR 156/11',
    needed: 'Nur wenn eine Rechnung einen anderen Zeitraum hat als Ihre Abrechnung. Tragen Sie dann unter „Weitere Angaben“ den Leistungszeitraum ein.',
  },
  // #208: Gradtage, für den Vorschlag nach § 560 BGB im Rumpf. Werte aus dem Register
  // (`hkv.degree-days`), Herkunft dort.
  degreeDays: {
    title: 'Gradtagszahlen',
    short: 'Eine Tabelle, die ein Jahr Heizwärme auf die Monate verteilt: Im Winter wird viel geheizt, im Sommer kaum. Ein Jahr hat 1.000 Promille.',
    example: `Januar bis April zusammen ${winterPermille} Promille. Eine Gasrechnung über 700 € für diese vier Monate entspricht 700 € / ${(winterPermille / 1000).toLocaleString('de-DE')} ≈ ${deEuro(Math.round(70000 / (winterPermille / 1000)))} € im Jahr, also rund ${deEuro(Math.round(70000 / (winterPermille / 1000) / 12))} € im Monat.`,
    norm: '§ 9b Abs. 2 HeizkostenV (Gradtagszahlen nach den anerkannten Regeln der Technik)',
    needed: 'Im Rumpfzeitraum rechnet Mietfuchs damit den Vorschlag für die neue Vorauszahlung hoch. Reicht eine Gas-, Fernwärme- oder Stromrechnung über das Ende der Heizperiode hinaus, teilt es damit den Verbrauch auf die Heizperioden auf, wenn weder ein Zählerstand zum Stichtag noch eine Zwischenrechnung des Versorgers vorliegt. Die Werte stammen aus der Praxis der Messdienste; die Norm DIN 94680, in der sie heute stehen, hat Mietfuchs nicht gelesen.',
  },

  fuelDelivery: {
    title: 'Lieferung (Rechnung des Versorgers)',
    short: 'Eine Rechnung über Brennstoff oder Energie, auf der Seite Heizkosten eingetragen: bei Gas, Fernwärme und Strom mit ihrem Rechnungszeitraum, bei Heizöl, Flüssiggas, Pellets, Holz und Kohle mit Lieferdatum und Menge. Reicht eine Gasrechnung über die Heizperiode hinaus, teilt Mietfuchs sie auf die Heizperioden auf; bei Brennstoff mit Vorrat ergibt die Bestandsrechnung den Verbrauch. Bei freien Schlüsseln verknüpfen Sie die Kostenposition mit ihr.',
    example: 'Gasrechnung 15.03.2025–14.03.2026 über 6.500,00 €, Heizperiode Mai bis April: Nach Gradtagen gehören 848,71 ‰ in 2025/2026 (5.516,61 €), der Rest von 983,39 € in 2024/2025.',
    norm: '§ 7 Abs. 2 HeizkostenV',
    needed: 'Wenn eine Rechnung über die Heizperiode hinausreicht oder Mietfuchs die CO₂-Kosten selbst aufteilen soll. Ohne Verknüpfung verteilt Mietfuchs die Position ganz in ihrem Zeitraum und grenzt nichts ab.',
  },
  fuelStock: {
    title: 'Brennstoffvorrat (Bestandsrechnung)',
    short: 'Bei Heizöl, Flüssiggas, Pellets, Holz und Kohle liegt der Brennstoff im Tank oder Lager, und nicht jede Lieferung wird im selben Abrechnungszeitraum verbraucht. Umgelegt werden die Kosten der verbrauchten Brennstoffe und ihrer Lieferung, nicht der bezahlten Rechnungen: Anfangsbestand plus Lieferungen minus Endbestand. Wie der Endbestand zu bewerten ist, regelt die Heizkostenverordnung nicht; Mietfuchs rechnet wie die Kommentarliteratur und die Messdienste, dass das Älteste zuerst verbraucht wird, und bewertet den Endbestand zu den Preisen der jüngsten Lieferungen.',
    example: 'Anfangsbestand 2.000 l für 1.900 €, Lieferungen 3.000 l für 3.150 € und 2.500 l für 2.500 €, Endbestand 1.800 l. Der Endbestand stammt aus der jüngsten Lieferung und ist 1.800 € wert. Verbraucht wurden 5.700 l für 1.900 € + 3.150 € + 2.500 € − 1.800 € = 5.750 €; bezahlt haben Sie in diesem Zeitraum 5.650 €. Die 100 € Unterschied stehen in der Abrechnung als „aus dem Vorrat“ und „im Vorrat“.',
    norm: '§ 7 Abs. 2 HeizkostenV; BGH VIII ZR 156/11',
    needed: 'Ja, wenn Sie mit Heizöl, Flüssiggas, Pellets, Holz oder Kohle heizen und die Heizkosten selbst nach Schlüsseln verteilen, oder wenn der Messdienst die CO₂-Kosten nicht aufgeteilt hat. Dann tragen Sie auf der Seite Heizkosten in der Karte „Vorrat“ je Heizperiode den Endbestand ein und nur in der ersten auch den Anfangsbestand; danach übernimmt Mietfuchs den Endbestand der Vorperiode.',
  },
  perUnitHeating: {
    title: 'Etagenheizung',
    short: 'Eine Heizung in der Wohnung, meist eine Gastherme, die nur diese Wohnung versorgt. Die Heizkostenverordnung gilt dafür nicht, denn sie regelt nur zentrale Anlagen und die Wärmelieferung (§ 1 Abs. 1 HeizkostenV). Hat der Vermieter den Gasvertrag, sind die CO₂-Kosten aufzuteilen; eingestuft wird über die Gesamtwohnfläche der vermieteten Wohnungen mit eigener Heizung (§ 5 Abs. 1 Satz 2 CO2KostAufG). Ob der Vermieter die Gaskosten selbst als Betriebskosten umlegen darf, ist nicht geklärt: Die Betriebskostenverordnung nennt bei Etagenheizungen nur Reinigung und Wartung (§ 2 Nr. 4 Buchstabe d BetrKV), Buchstabe a bis c gelten für zentrale Anlagen und die Wärmelieferung.',
    example: `EG mit 60 m² und OG mit 40 m², je mit eigener Gastherme auf Ihren Vertrag; die Rechnungen nennen 1.800 kg und 1.200 kg CO₂ und CO₂-Kosten von 200 € und 120 €. 3.000 kg auf 100 m² ergeben 30,0 kg je m², Stufe ${E1.range}; Sie tragen ${E1.percent} %, beim EG ${(200 * E1.percent) / 100} €, beim OG ${(120 * E1.percent) / 100} €.`,
    norm: '§ 1 Abs. 1 HeizkostenV; § 2 Nr. 4 BetrKV; § 5 Abs. 1 Satz 2 CO2KostAufG',
    needed: 'Wenn in Wohnungen Thermen über Ihren Gasvertrag laufen. Jede Wohnung braucht dafür einen eigenen Gaszähler, denn die Rechnung gehört zu ihr. Umgelegt werden dürfen Betriebskosten nur, wenn der Mietvertrag es vereinbart (§ 556 Abs. 1 Satz 1 BGB); für die Gaskosten einer Etagenheizung prüfen Sie das bitte mit Ihrem Mietvertrag, im Zweifel mit Ihrem Haus- und Grundbesitzerverein. Hat der Mieter den Vertrag, gibt es keine Heizanlage des Hauses.',
  },
  boilerSwap: {
    title: 'Heizung erneuert (Kesseltausch) und Restbestand',
    short: 'Wird die Heizung erneuert, endet die bisherige Heizanlage am Tag vor dem Tausch, und eine neue beginnt mit denselben Wohnungen. Bleibt Heizöl, Flüssiggas oder Pellets im Tank, ist das der Restbestand. Heizt die neue Anlage mit demselben Brennstoff aus demselben Tank weiter, wird er ihr Anfangsbestand; Mietfuchs fragt das beim Tausch. Sonst tragen ihn die Mieter nicht, denn umgelegt werden nur die Kosten der verbrauchten Brennstoffe (§ 7 Abs. 2 HeizkostenV). Er bleibt dann mit seinem Wert bei Ihnen.',
    example: `Ölheizung bis 30.06., danach Gas. 500 l Restöl zu 1,05 € tragen die Mieter nicht, 525 € bleiben bei Ihnen. Eingestuft wird das Gebäude über das ganze Jahr: 12.043,35 kg aus dem Öl und 3.000 kg aus dem Gas auf 300 m² ergeben 50,1 kg je m² und ${K1.percent} %; das Öl allein ergäbe 40,1 kg je m² und ${K0.percent} %.`,
    norm: '§ 7 Abs. 2 HeizkostenV; § 5 Abs. 1 Satz 1 CO2KostAufG',
    needed: 'Wenn die Heizung im Lauf eines Abrechnungszeitraums ersetzt wird. Bleibt der Energieträger gleich und läuft er über denselben Zähler, etwa Gas über denselben Gaszähler, brauchen Sie keinen Tausch.',
  },
  fixedPriceComponent: {
    title: 'Fester Preisbestandteil',
    short: 'Grund-, Leistungs-, Mess- und Verrechnungspreis einer Versorgerrechnung. Er hängt an der Zeit, nicht an der Menge, und wird deshalb nach Tagen auf die Heizperioden geteilt.',
    example: 'Grund- und Leistungspreis 2.000,00 € für 15.03.2025–14.03.2026; auf 2025 entfallen 292 von 365 Tagen, also 1.600,00 €. Nach Gradtagen wären es 1.242,58 €.',
    needed: 'Nur wenn eine Rechnung über die Heizperiode hinausreicht. Ohne Angabe teilt Mietfuchs die ganze Rechnung nach dem Verbrauch.',
  },
  fuelEstimate: {
    title: 'Schätzung mit Vorbehalt',
    short: 'Fehlt beim Abschließen die Rechnung für einen Teil der Heizperiode, kann Mietfuchs diesen Teil aus der letzten Rechnung schätzen und mit Vorbehalt ausweisen. Ob ein Vermieter eine noch fehlende Versorgerrechnung so schätzen darf, ist höchstrichterlich nicht entschieden; sicher ist, abzuwarten, solange die Frist läuft.',
    example: 'Letzte Rechnung 6.000,00 €, die Lücke hat 151,29 ‰ ihrer Gradtage: geschätzt 6.000,00 € × 151,29 ‰ = 907,74 €. Kommt die Rechnung mit 983,39 € für diese Tage, stehen 75,65 € bei Ihnen.',
    norm: '§ 556 Abs. 3 Satz 2 und 3 BGB',
    needed: 'Nur wenn Sie abschließen wollen, bevor die Rechnung da ist.',
  },
  nonResidential: {
    title: 'Nichtwohngebäude (CO₂)',
    short: `Ein Gebäude, das nach seiner Zweckbestimmung nicht überwiegend dem Wohnen dient. Dort gilt keine Stufentabelle: Vereinbarungen, nach denen der Mieter mehr als die Hälfte der CO₂-Kosten trägt, sind unwirksam; Mietfuchs rechnet mit ${NON_RES_PERCENT} % beim Vermieter.`,
    example: `CO₂-Kosten 800,00 €: Der Vermieter trägt ${deCents(80000 * NON_RES_PERCENT)} €.`,
    norm: '§ 8 Abs. 1 CO2KostAufG',
    needed: 'Nur wenn das Gebäude überwiegend gewerblich oder anders als zum Wohnen genutzt wird.',
  },
  co2Restriction: {
    title: 'Beschränkungen (CO₂)',
    short: 'Stehen öffentlich-rechtliche Vorgaben, etwa Denkmalschutz, ein Anschluss- und Benutzungszwang oder eine Erhaltungssatzung, einer wesentlichen energetischen Verbesserung des Gebäudes oder seiner Wärmeversorgung entgegen, wird der Anteil des Vermieters gekürzt; stehen sie beidem entgegen, werden die CO₂-Kosten nicht aufgeteilt. Berufen darf sich der Vermieter darauf nur mit Nachweis gegenüber dem Mieter.',
    example: `Anteil des Vermieters laut Stufe 60 %; bei Denkmalschutz ${(60 * RESTRICTION.factor).toLocaleString('de-DE')} %. Bei beiden Vorgaben trägt der Vermieter nichts.`,
    norm: '§ 9 CO2KostAufG',
    needed: 'Nur wenn solche Vorgaben für Ihr Gebäude bestehen und Sie sie nachweisen können.',
  },
  districtEts: {
    title: 'Fernwärme aus dem Emissionshandel',
    short: `Das CO2KostAufG gilt auch für Wärme aus Anlagen im Europäischen Emissionshandel, aber nicht für Gebäude, die erstmals nach dem ${ETS_AFTER} einen Wärmeanschluss erhalten haben. Dann werden die CO₂-Kosten nicht aufgeteilt.`,
    example: 'Anschluss an das Wärmenetz im März 2023: keine Aufteilung. Anschluss 2015: Aufteilung nach der Stufentabelle wie bei Gas.',
    norm: '§ 2 Abs. 4 CO2KostAufG',
    needed: 'Nur bei Fernwärme, deren Wärme aus einer Anlage im Emissionshandel stammt.',
  },
  largestRemainder: {
    title: 'Restcent-Verfahren',
    short: 'Beim Runden auf Cent fehlen oder bleiben oft einzelne Cent übrig; Mietfuchs gibt sie an die Anteile mit dem größten Rest hinter dem Komma, damit die Summe genau dem Rechnungsbetrag entspricht. Ihr eigener Anteil (Eigennutzung, Leerstand) zählt dabei mit; bei gleichem Rest bekommen Sie den Cent vor einem Mieter.',
    example: '100,00 € auf drei gleich große Wohnungen sind je 33,3333 €. Gerundet wären das zusammen 99,99 €; den fehlenden Cent bekommt eine der drei, die dann 33,34 € trägt.',
    needed: 'Nein, Mietfuchs erledigt das selbst. Es erklärt nur, warum ein Anteil einen Cent vom rechnerischen Wert abweicht.',
  },
  legalBasis: {
    title: 'Rechtsstand',
    short: 'Das Datum, auf dem die Regeln in Mietfuchs stehen, und die Regeln, die im Abrechnungsjahr gelten; beim Abschließen wird er mit der Abrechnung eingefroren.',
    example: 'Eine Abrechnung für 2023 mit Rechtsstand 30.09.2026 nennt die Regel zum Kabelfernsehen, denn 2023 war es bei Anlagen von vor dem 01.12.2021 noch umlagefähig; eine für 2025 nennt sie nicht mehr.',
    needed: 'Sie müssen nichts tun. Er zeigt, nach welchen Regeln eine Abrechnung erstellt wurde.',
  },
} satisfies Record<string, Term>

export type TermId = keyof typeof GLOSSARY
