// Anleitungen je Vermietungsart (#164): Das Lexikon erklärt, was ein Begriff bedeutet; eine
// Anleitung sagt, wie man eine bestimmte Lage in Mietfuchs anlegt und was daraus wird. Jede hat
// dieselbe Gliederung: Trifft das auf Sie zu? · So legen Sie es an · Was Mietfuchs daraus macht ·
// Worauf Sie achten müssen · Was Mietfuchs (noch) nicht kann.
//
// Liegt in shared/ neben dem Lexikon, weil der Server die Beispiele nachrechnet
// (server/test/guides.test.ts) und der Client sie zeigt. Maßstab wie beim Lexikon: nur, was
// Mietfuchs heute kann; eine Rechtsaussage nur mit Norm (`caveats[].norm`), die an der Quelle
// geprüft ist; Zahlenbeispiele so, dass der Test sie mit der Berechnung nachrechnen kann. Text in
// „…“ in den Schritten und unter „Was Mietfuchs daraus macht“ ist eine Beschriftung der
// Oberfläche und muss dort wörtlich so stehen; der Test prüft das.

import type { TermId } from './glossary.ts'
// Rechtszahlen aus dem Rechtsregister (Heizung PR 1), in der Fassung von `LAW_AS_OF` wie im Lexikon.
import { hkvConsumptionShare, hkvConsumptionShareForced, hkvCutInformation, hkvCutNotByConsumption, hkvEstimateThreshold, hkvRenewableExemption } from './law/heizkostenv.ts'
import { germanDate, LAW_AS_OF, valueAt } from './law/register.ts'
import { co2CutMissing, co2FirstPeriodStart } from './law/co2kostaufg.ts'

const SHARE = valueAt(hkvConsumptionShare, LAW_AS_OF)
const CUT = valueAt(hkvCutNotByConsumption, LAW_AS_OF)
// Heizung PR 10: der Pflichtanteil nach § 7 Abs. 1 Satz 2 HeizkostenV, aus dem Register.
const FORCED = valueAt(hkvConsumptionShareForced, LAW_AS_OF)
const ESTIMATE_THRESHOLD = valueAt(hkvEstimateThreshold, LAW_AS_OF)
const INFO_CUT = valueAt(hkvCutInformation, LAW_AS_OF)
// Heizung PR 6: die Kürzung bei fehlender CO₂-Aufteilung (§ 7 Abs. 4 CO2KostAufG) und der Beginn der
// Aufteilung (§ 11 Abs. 2 Satz 1) aus dem Register.
const CO2_CUT = valueAt(co2CutMissing, LAW_AS_OF)
const CO2_FROM = germanDate(co2FirstPeriodStart())
// Heizung PR 11: seit wann Wärmepumpen nicht mehr von der Heizkostenverordnung ausgenommen sind.
const HEAT_PUMP_FROM = germanDate(hkvRenewableExemption.versions.find((v) => v.validFrom !== undefined)?.validFrom ?? '')

// Die Seiten, auf die eine Anleitung springen kann. Dieselben Kennungen wie die Navigation;
// client/src/nav.ts prüft beim Übersetzen, dass jede davon dort vorkommt.
export const GUIDE_PAGES = ['stammdaten', 'zaehler', 'kosten', 'mietkonto', 'heizkosten', 'abrechnung', 'steuer', 'einstellungen', 'belege'] as const
export type GuidePage = (typeof GUIDE_PAGES)[number]

export type GuideStep = {
  text: string
  // Die Seite, auf der man es tut; ohne Seite, wenn der Schritt in der Seitenleiste liegt.
  page?: GuidePage
}
export type GuideCaveat = {
  text: string
  // Rechtsgrundlage; Pflicht, sobald der Text eine Rechtsregel nennt.
  norm?: string
}
export type GuideGap = {
  text: string
  // Das Issue, in dem es geplant ist, wo es eines gibt.
  issue?: number
}
export type Guide = {
  title: string
  // „Trifft das auf Sie zu?“
  applies: string
  // „So legen Sie es an“
  steps: readonly GuideStep[]
  // „Was Mietfuchs daraus macht“
  result: readonly string[]
  // Beispiel mit Zahlen, nachgerechnet in server/test/guides.test.ts
  example: string
  // „Worauf Sie achten müssen“
  caveats: readonly GuideCaveat[]
  // „Was Mietfuchs (noch) nicht kann“
  gaps: readonly GuideGap[]
  // Begriffe zum Nachschlagen
  terms: readonly [TermId, ...TermId[]]
}

const GUIDE_DATA = {
  granny: {
    title: 'Haus mit Einliegerwohnung oder Zweifamilienhaus mit Eigennutzung',
    applies: 'Sie wohnen selbst im Haus und vermieten eine zweite Wohnung darin, etwa eine Einliegerwohnung. Mietfuchs rechnet dann nur mit Ihrer Mietpartei ab, Ihren eigenen Anteil tragen Sie selbst.',
    steps: [
      { page: 'stammdaten', text: 'Tragen Sie in der Karte „Objekt“ Bezeichnung und Adresse ein und klicken Sie auf „Speichern“.' },
      { page: 'stammdaten', text: 'Legen Sie mit „+ Wohnung hinzufügen“ Ihre eigene Wohnung an: Wohnfläche eintragen, bei „Nutzung“ die Auswahl „Eigennutzung — Anteil trägt der Vermieter“ wählen und unter „Personen im eigenen Haushalt“ die Zahl der Bewohner eintragen.' },
      { page: 'stammdaten', text: 'Legen Sie die Einliegerwohnung ebenso an, mit der Nutzung „vermietet — Anteil trägt der Mieter“, und danach mit „+ Mietverhältnis hinzufügen“ die Mieterin mit Einzug, Personenzahl, Kaltmiete und Vorauszahlung.' },
      { page: 'zaehler', text: 'Hat nur die Einliegerwohnung einen eigenen Wasserzähler, legen Sie mit „+ Zähler hinzufügen“ zwei Zähler an: den Zähler des Hauses mit der Zuordnung „Haus (Hauptzähler)“ und den Zwischenzähler mit der Zuordnung zur Einliegerwohnung. Für jedes Jahr braucht jeder Zähler zwei Stände: zu Jahresbeginn (31.12. des Vorjahres) und zum Jahresende (31.12.); tragen Sie sie über „Ablesung speichern“ ein.' },
      { page: 'kosten', text: 'Erfassen Sie die Rechnungen mit „+ Kostenposition manuell erfassen“. Das Wasser verteilen Sie mit dem Umlageschlüssel „nach Verbrauch (Zähler)“ und dem Zählertyp „Kaltwasser“.' },
      { page: 'kosten', text: 'Reparaturen erfassen Sie als „Nicht umlagefähig“. Unter „Betrifft (für die Steuer)“ ordnen Sie eine Reparatur, die nur eine Wohnung betrifft, dieser Wohnung zu; für Dach, Fassade oder Heizung bleibt „das ganze Gebäude (nach Fläche)“ stehen.' },
      { page: 'steuer', text: 'Für die Anlage V drucken Sie die Steuerübersicht mit „🖨 Drucken / PDF“.' },
      { page: 'belege', text: 'Die Belege dazu lädt der Belegordner mit „Belege für die Steuer“ als ZIP, geordnet nach den Gruppen der Anlage V; die Übersicht darin nennt je Position den privaten und den abziehbaren Teil wie die Steuerübersicht.' },
    ],
    result: [
      'Ihre Wohnung zählt in die Verteilbasis. Nach Fläche, Wohneinheiten und Personen trägt die Mieterin nur ihren Teil, der Rest ist Ihr Eigenanteil. Er steht auf der Seite Abrechnung unter „Vermieteranteil (nicht umgelegt)“ mit dem Grund „Eigennutzung“.',
      'Beim Wasser gilt der Hauptzähler als Grundlage: Die Mieterin zahlt ihren gemessenen Verbrauch, der Rest des Hauptzählers ist Ihr Eigenanteil.',
      'Die Steuerübersicht teilt jede Position in privat und abziehbar: umlagefähige Kosten mit dem Eigenanteil der Abrechnung, nicht umlagefähige nach ihrer Zuordnung oder nach der Fläche. Überschuss und Hauptzahl rechnen mit dem abziehbaren Teil, der Rechenweg steht je Position zum Aufklappen.',
      'Bei der Heizung kennt Mietfuchs die Ausnahme für das Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen: Eine Warmmiete oder Pauschale ergibt dort keine Warnung.',
    ],
    example: 'Ihre Wohnung hat 120 m², die Einliegerwohnung 60 m², zusammen 180 m². Grundsteuer 900 € nach Wohnfläche: Die Mieterin trägt 300 €, 600 € sind Ihr Eigenanteil. Wasser 600 €, der Hauptzähler zeigt im Jahr 150 m³, der Zwischenzähler der Einliegerwohnung 50 m³: Die Mieterin trägt 200 €, 400 € sind Ihr Eigenanteil. Eine Dachreparatur über 1.800 € ist in der Steuerübersicht zu 60/180 abziehbar, also 600 €; 1.200 € sind privat.',
    caveats: [
      { text: 'In einem Gebäude mit nicht mehr als zwei Wohnungen, von denen Sie eine selbst bewohnen, geht eine Vereinbarung im Mietvertrag der Heizkostenverordnung vor; eine Warmmiete ist hier also möglich. Ohne solche Vereinbarung gilt die Verordnung auch hier.', norm: '§ 2 HeizkostenV' },
      { text: 'Ist im Mietvertrag kein Umlageschlüssel vereinbart, wird nach Wohnfläche umgelegt.', norm: '§ 556a Abs. 1 BGB' },
      { text: 'Ihr Eigenanteil ist privat und keine Werbungskosten; Kosten des ganzen Gebäudes sind nur zu dem Teil abziehbar, der auf die vermietete Fläche entfällt.', norm: '§ 9 Abs. 1, § 12 Nr. 1 EStG; BFH, Urteil vom 24.06.2008, IX R 26/06' },
      { text: 'Die Anleitung zur Anlage V bittet darum, bei der ersten verhältnismäßigen Aufteilung den Aufteilungsmaßstab und die Zuordnung in einer gesonderten Aufstellung zu erläutern; dafür taugt der Ausdruck der Steuerübersicht.' },
      { text: 'Lesen Sie Haupt- und Zwischenzähler am selben Tag ab, am besten zum 31.12. Deckt der Hauptzähler nicht das ganze Jahr ab, nimmt Mietfuchs ihn nicht als Grundlage und warnt.' },
    ],
    gaps: [
      { text: 'Haben Wohnungen verschiedene Geräte (Wärmezähler in der einen, Heizkostenverteiler in der anderen), verlangt die Heizkostenverordnung eine Vorerfassung nach Gruppen; die rechnet Mietfuchs noch nicht. Übernehmen Sie dann die Abrechnung eines Messdienstes als Einzelbeträge (siehe die Anleitung zum Messdienst).', issue: 218 },
      { text: 'Abschreibung (AfA) und Schuldzinsen gehören nicht zu den Kostenpositionen; die Steuerübersicht rechnet und teilt sie nicht.' },
    ],
    terms: ['granny', 'ownShare', 'mixedUse', 'mainMeter', 'heatingCostOrdinance'],
  },
  multiFamily: {
    title: 'Mehrfamilienhaus, ganz vermietet oder mit eigener Wohnung',
    applies: 'Ihr Haus hat drei oder mehr Wohnungen, die Sie vermieten; vielleicht wohnen Sie selbst in einer davon.',
    steps: [
      { page: 'stammdaten', text: 'Tragen Sie in der Karte „Objekt“ Bezeichnung, Adresse und die Art „Mehrfamilienhaus“ ein.' },
      { page: 'stammdaten', text: 'Legen Sie mit „+ Wohnung hinzufügen“ alle Wohnungen des Hauses an, auch eine selbstgenutzte („Eigennutzung — Anteil trägt der Vermieter“). Eine Einheit, die gesondert abgerechnet wird, etwa ein Laden, stellen Sie auf „nicht beteiligt — bleibt außen vor“.' },
      { page: 'stammdaten', text: 'Legen Sie je Mieter mit „+ Mietverhältnis hinzufügen“ ein Mietverhältnis an. Ändert sich später die Personenzahl oder die Vorauszahlung, ergänzen Sie die Staffel mit „+ Änderung ab Datum …“ oder „+ Erhöhung ab Monat …“, statt ein neues Mietverhältnis anzulegen.' },
      { page: 'zaehler', text: 'Legen Sie die Wohnungszähler mit ihrer Wohnung an und, wenn vorhanden, den Hauszähler als „Haus (Hauptzähler)“. Erfassen Sie für jeden Zähler den Stand zu Jahresbeginn (31.12. des Vorjahres) und zum Jahresende (31.12.) mit „Ablesung speichern“. Mit Wohnungszählern steht bei den Kosten der Schlüssel „nach Verbrauch (Zähler)“ zur Wahl.' },
      { page: 'belege', text: 'Laden Sie Rechnungen im Belegordner mit „Belege hochladen“ hoch. Sie liegen dann im „Posteingang“; von dort ordnen Sie jede einer Position zu oder lassen sie mit „Per KI auswerten“ in Positionen zerlegen.' },
      { page: 'kosten', text: 'Erfassen Sie jede Rechnung mit Kostenart und Umlageschlüssel. Betrifft eine Rechnung nur einen Teil der Wohnungen, etwa den Aufzug im Hinterhaus, wählen Sie bei der Position „Weitere Optionen: nur bestimmte Wohnungen beteiligen“.' },
      { page: 'kosten', text: 'Ab dem zweiten Jahr übernehmen Sie die Positionen des Vorjahres mit dem Knopf über der Liste (für 2026 heißt er Aus 2025 übernehmen …). Kostenart, Beschreibung und Umlageschlüssel kommen mit, Sie tragen je Zeile nur den neuen Betrag ein.' },
      { page: 'abrechnung', text: 'Prüfen Sie die Hinweise der Abrechnung; „Hier beheben →“ führt zum betroffenen Eintrag. Nach dem Versand schließen Sie die Abrechnung mit dem Knopf mit dem Schloss ab und tragen das Datum bei „versendet am“ ein.' },
    ],
    result: [
      'Jede Rechnung wird centgenau verteilt; der Rechenweg jeder Zeile steht auf der Seite Abrechnung unter „Rechenweg“.',
      'Eine neue Position bekommt den Umlageschlüssel, den dieselbe Kostenart im Vorjahr hatte. Weicht sie davon ab, weisen Formular und Abrechnung darauf hin. Eine Rechnung, die schon als Position erfasst ist, legt die KI-Auswertung nicht still ein zweites Mal an, sondern bietet an, den Beleg mit der Position zu verknüpfen.',
      'Für die Belegeinsicht Ihrer Mieter erstellt der Belegordner die „Belegmappe für Mieter“ als PDF.',
      'Was nicht auf Mieter entfällt, steht unter „Vermieteranteil (nicht umgelegt)“ mit seinem Grund, etwa Eigennutzung, Leerstand oder nicht umlagefähig.',
      'Werden Heizkosten nur nach Fläche verteilt, nennt die Abrechnung je Mieter den Betrag, um den er nach der Heizkostenverordnung kürzen darf.',
      'Wohnen Sie selbst im Haus, teilt die Steuerübersicht die Werbungskosten in privat und abziehbar, wie bei der Einliegerwohnung.',
    ],
    example: 'Drei Wohnungen mit 50, 70 und 80 m², Grundsteuer 2.000 € nach Wohnfläche: Die Mieter tragen 500 € und 700 €. Bewohnen Sie die Wohnung mit 80 m² selbst, sind 800 € Ihr Eigenanteil; ist sie vermietet, trägt ihr Mieter diese 800 €.',
    caveats: [
      { text: 'Ist im Mietvertrag kein Umlageschlüssel vereinbart, wird nach Wohnfläche umgelegt. Kosten, die von einem erfassten Verbrauch der Mieter abhängen, sind nach einem Maßstab umzulegen, der dem unterschiedlichen Verbrauch Rechnung trägt, also nach den Zählern.', norm: '§ 556a Abs. 1 Satz 1 und 2 BGB' },
      { text: 'Die Abrechnung muss dem Mieter spätestens bis zum Ablauf des zwölften Monats nach Ende des Abrechnungszeitraums zugehen; danach können Sie eine Nachzahlung in der Regel nicht mehr verlangen.', norm: '§ 556 Abs. 3 Satz 2 und 3 BGB' },
      { text: `Bei einer Zentralheizung sind mindestens ${SHARE.min} und höchstens ${SHARE.max} Prozent der Heiz- und Warmwasserkosten nach Verbrauch zu verteilen. Wird nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um ${CUT} Prozent kürzen.`, norm: '§ 7 Abs. 1, § 8 Abs. 1, § 12 Abs. 1 HeizkostenV' },
      { text: 'Verwaltungskosten sowie Instandhaltung und Instandsetzung sind keine Betriebskosten; erfassen Sie sie als „Nicht umlagefähig“.', norm: '§ 1 Abs. 2 BetrKV' },
      { text: `Fallen für die Heizung CO₂-Kosten an, sind sie zwischen Ihnen und dem Mieter nach dem CO₂-Ausstoß des Gebäudes aufzuteilen. Die Heizkostenabrechnung muss den Anteil des Mieters, die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen; fehlt das, darf der Mieter seinen Anteil an den Heizkosten um ${CO2_CUT} Prozent kürzen. Verteilen Sie die Heizkosten selbst nach einem Schlüssel, teilt Mietfuchs die CO₂-Kosten auf, wenn Sie die Rechnungen Ihres Versorgers auf der Seite Heizkosten als Lieferungen eintragen, bei Heizöl, Flüssiggas und Kohle dazu Anfangs- und Endbestand des Vorrats; rechnet ein Messdienst ab, übernehmen Sie seine Angaben dort.`, norm: '§ 5 Abs. 2, § 7 Abs. 3 und 4 CO2KostAufG' },
    ],
    gaps: [
      { text: 'Verschiedene Geräte in einer Heizanlage (Wärmezähler neben Heizkostenverteilern) brauchen eine Vorerfassung nach Gruppen; die rechnet Mietfuchs noch nicht.', issue: 218 },
      { text: 'Die Differenz zwischen Hauptzähler und Wohnungszählern als eigener Posten, Eichfristen und geschätzte Ablesungen.', issue: 98 },
    ],
    terms: ['allocationKey', 'distributionBasis', 'billingUnit', 'participants', 'ownShare', 'heatingCostOrdinance'],
  },
  condo: {
    title: 'Vermietete Eigentumswohnung mit Hausgeldabrechnung',
    applies: 'Sie vermieten eine Eigentumswohnung. Die Kosten des Hauses rechnet die Eigentümergemeinschaft ab, Sie bekommen jedes Jahr die Hausgeldabrechnung und geben die umlagefähigen Kosten an Ihre Mieter weiter.',
    steps: [
      { page: 'stammdaten', text: 'Wählen Sie in der Karte „Objekt“ die Art „Eigentumswohnung“ und klicken Sie auf „Speichern“; für eine weitere Wohnung neben einem Haus legen Sie mit „Weiteres Objekt anlegen“ ein eigenes Objekt an.' },
      { page: 'stammdaten', text: 'Legen Sie nur Ihre eigene Wohnung an, nicht die übrigen Wohnungen der Anlage, und tragen Sie bei „Miteigentumsanteile“ den Wert aus der Teilungserklärung oder der Hausgeldabrechnung ein. Danach das Mietverhältnis mit „+ Mietverhältnis hinzufügen“.' },
      { page: 'kosten', text: 'Übernehmen Sie aus der Hausgeldabrechnung jede umlagefähige Kostenart als eigene Position mit dem Umlageschlüssel „laut Gemeinschaftsabrechnung (Eigentumswohnung)“. Unter „Betrag €“ steht Ihr Anteil laut Hausgeldabrechnung, darunter „Maßstab“, die Summe der Anteile in der Anlage und „Kosten der Gemeinschaft (ganze Anlage) €“.' },
      { page: 'kosten', text: 'Verwaltervergütung, Kontoführung und Reparaturen erfassen Sie als „Nicht umlagefähig“, die Zuführung zur Rücklage als „Zuführung Erhaltungsrücklage“.' },
      { page: 'kosten', text: 'Die Grundsteuer steht nicht in der Hausgeldabrechnung; erfassen Sie sie nach Ihrem Bescheid, etwa „nach Wohnfläche“.' },
      { page: 'kosten', text: 'Mit der nächsten Hausgeldabrechnung übernehmen Sie die Positionen aus dem Vorjahr (Knopf über der Liste, für 2026 Aus 2025 übernehmen …) und tragen je Zeile Ihren neuen Anteil und die Kosten der Gemeinschaft ein; Maßstab und Summe der Anteile kommen mit.' },
      { page: 'abrechnung', text: 'Prüfen Sie die Abrechnung und den Rechenweg der Positionen, bevor Sie sie verschicken.' },
    ],
    result: [
      'Die Abrechnung zeigt dem Mieter den Rechenweg mit Ihren Miteigentumsanteilen und den Kosten der Gemeinschaft. Weicht Ihr eingetragener Betrag um mehr als 1 € vom rechnerischen Anteil ab, markiert das Kostenformular das, und verteilt wird der eingetragene Betrag.',
      'Bei einer Eigentumswohnung schlägt das Kostenformular für eine neue Position ohne Vorjahr den Umlageschlüssel „laut Gemeinschaftsabrechnung (Eigentumswohnung)“ vor, außer bei der Grundsteuer; danach den Schlüssel derselben Kostenart im Vorjahr.',
      'Nicht umlagefähige Positionen trägt der Vermieter; die Zuführung zur Erhaltungsrücklage weist die Steuerübersicht getrennt von den Werbungskosten aus.',
      'Bei einer Eigentumswohnung erinnert die Steuerübersicht daran, dass für die Steuer das gezahlte Hausgeld zählt und nicht die Beträge der Hausgeldabrechnung.',
    ],
    example: 'Allgemeinstrom der Anlage 2.400 €, Ihre Wohnung hat 124 von 10.000 MEA: Ihr Anteil ist 2.400 € × 124/10.000 = 29,76 €. Das ist der Betrag der Position, und weil Sie in dieser Anlage nur diese eine Wohnung vermieten, trägt die Mieterin die 29,76 € ganz. Für die Steuer: Hausgeld 300 € im Monat, also 3.600 € im Jahr, davon 900 € Zuführung zur Erhaltungsrücklage; im Jahr der Zahlung sind 2.700 € abziehbar.',
    caveats: [
      { text: 'Ist mit dem Mieter nichts anderes vereinbart, gilt für die Umlage der Maßstab, nach dem die Gemeinschaft unter den Eigentümern verteilt.', norm: '§ 556a Abs. 3 BGB' },
      { text: 'Die Gemeinschaft verteilt ihre Kosten nach Miteigentumsanteilen, soweit sie nichts anderes beschlossen oder vereinbart hat.', norm: '§ 16 Abs. 2 WEG' },
      { text: 'Die Frist von zwölf Monaten für die Abrechnung an den Mieter läuft auch, solange die Hausgeldabrechnung noch fehlt. Eine Nachforderung nach Ablauf der Frist ist nur möglich, wenn Sie die Verspätung nicht zu vertreten haben.', norm: '§ 556 Abs. 3 Satz 2 und 3 BGB' },
      { text: 'Verwaltungskosten und Instandhaltung sind keine Betriebskosten und gehören nicht in die Abrechnung des Mieters.', norm: '§ 1 Abs. 2 BetrKV' },
      { text: 'Die Zuführung zur Erhaltungsrücklage ist erst abziehbar, wenn und soweit die Gemeinschaft das Geld für Erhaltungsmaßnahmen ausgibt.', norm: 'BFH, Urteil vom 14.01.2025, IX R 19/24' },
      { text: 'Werbungskosten zählen im Jahr der Zahlung, also das gezahlte Hausgeld und eine Nachzahlung im Jahr, in dem Sie sie bezahlen.', norm: '§ 11 Abs. 2 EStG' },
    ],
    gaps: [
      { text: 'Die Hausgeldabrechnung per KI in Positionen mit Maßstab und Kosten der Gemeinschaft zerlegen; heute übertragen Sie die Beträge von Hand, ab dem zweiten Jahr in die Vorlagen aus dem Vorjahr.', issue: 102 },
      { text: 'Mietfuchs führt Kosten nach dem Jahr der Abrechnung, nicht nach dem Tag der Zahlung. Weichen beide ab, gleichen Sie die Zahlen für die Anlage V mit Ihren Kontoauszügen ab.' },
    ],
    terms: ['mea', 'homeownersStatement', 'homeownersFee', 'reserveFund', 'notAllocable'],
  },
  properties: {
    title: 'Mehrere Häuser oder Wohnungen (mehrere Objekte)',
    applies: 'Sie vermieten an mehr als einer Adresse, etwa zwei Häuser, ein Haus und eine Eigentumswohnung oder einen Garagenhof, und rechnen sie getrennt ab.',
    steps: [
      { page: 'stammdaten', text: 'Klicken Sie in der Karte „Objekt“ auf „Weiteres Objekt anlegen“, geben Sie Name, Art und Adresse ein und legen Sie es an. Mietfuchs wechselt danach in das neue, noch leere Objekt; Ihre bisherigen Daten bleiben unverändert.' },
      { text: 'Zwischen den Objekten wechseln Sie in der Seitenleiste unter „Objekt“. Der Umschalter erscheint ab dem zweiten Objekt, und der Seitenkopf nennt dann auf jeder Seite das gewählte Objekt.' },
      { page: 'stammdaten', text: 'Legen Sie in jedem Objekt seine Wohnungen und Mietverhältnisse an; Zähler und Kosten erfassen Sie ebenfalls im jeweiligen Objekt.' },
      { page: 'einstellungen', text: 'Vermieter, IBAN und Zahlungsfrist unter „Vermieter & Zahlung“ gelten für alle Objekte als Vorgabe.' },
      { page: 'stammdaten', text: 'Gehört ein Objekt jemand anderem oder hat es ein eigenes Konto, etwa das Haus der Eltern, setzen Sie in der Karte „Objekt“ unter „Abweichender Vermieter oder Bankverbindung“ den Haken „Für dieses Objekt abweichend“.' },
      { page: 'abrechnung', text: 'Abrechnung, Mietkonto und Steuerübersicht gelten jeweils für das gewählte Objekt.' },
    ],
    result: [
      'Jedes Objekt hat eigene Wohnungen, Zähler, Kosten und Abrechnungen, und jede Berechnung sieht nur ihr Objekt.',
      'Ein Zähler, eine Direktzuordnung oder ein Einzelbetrag kann nicht auf eine Wohnung eines anderen Objekts zeigen; Mietfuchs lehnt das beim Speichern ab.',
      'Der Belegordner zeigt die Belege des gewählten Objekts; mit „alle Objekte“ sehen Sie alle zusammen. Ein Beleg aus dem Posteingang wird nur innerhalb eines Objekts gebucht. Das Backup umfasst alle Objekte gemeinsam.',
      'Gelöscht werden kann nur ein leeres Objekt, und nie das letzte.',
    ],
    example: 'Eine Gebäudeversicherung über 1.500 € gilt für zwei Häuser mit 300 und 200 m² Wohnfläche. Sie teilen sie vorab selbst nach Fläche auf und erfassen 900 € im ersten und 600 € im zweiten Objekt; dort wird jeder Teil auf die Wohnungen verteilt.',
    caveats: [
      { text: 'Prüfen Sie vor dem Erfassen, in welchem Objekt Sie arbeiten. Wechseln Sie das Objekt bei offenem Formular, fragt Mietfuchs nach und speichert nichts in das andere Objekt.' },
      { text: 'Die Frist für die Abrechnung gilt für jede Abrechnung einzeln, also für jedes Objekt.', norm: '§ 556 Abs. 3 Satz 2 und 3 BGB' },
      { text: 'Teilen Sie eine gemeinsame Rechnung nach einem Maßstab auf, den Sie dem Mieter bei der Belegeinsicht erklären können, und heben Sie die Aufteilung auf.' },
    ],
    gaps: [
      { text: 'Eine Rechnung für mehrere Objekte einmal erfassen und automatisch vorverteilen.', issue: 95 },
      { text: 'Eine Steuer-Gesamtsicht über alle Objekte und weitere Kopfangaben der Anlage V je Objekt.', issue: 96 },
    ],
    terms: ['billingUnit', 'settlementDeadline'],
  },
  garage: {
    title: 'Garage oder Stellplatz, mitvermietet oder separat',
    applies: 'Sie vermieten eine Garage oder einen Stellplatz, an einen Mieter im Haus oder an jemand anderen.',
    steps: [
      { page: 'stammdaten', text: 'Gehört der Stellplatz zur Wohnung und trägt keine eigenen Nebenkosten, legen Sie ihn nicht als eigene Einheit an. Die Miete dafür steckt in der Kaltmiete der Wohnung, und die „Notiz (optional)“ der Wohnung kann ihn nennen.' },
      { page: 'stammdaten', text: 'Soll die Garage an Nebenkosten beteiligt sein, legen Sie sie mit „+ Wohnung hinzufügen“ als eigene Einheit mit 0 bei „Wohnfläche (m²)“ an und ihr Mietverhältnis mit 0 Personen. Mietet sie ein Wohnungsmieter, ist das ein zweites Mietverhältnis neben dem der Wohnung.' },
      { page: 'stammdaten', text: 'Hat die Garage keinen Wasseranschluss, entfernen Sie in ihrem Formular unter „Weitere Angaben — Anschlüsse“ das Häkchen bei „Kaltwasser“. Angeboten werden dort nur Zählerarten, die es im Objekt gibt.' },
      { page: 'kosten', text: 'Bei Positionen „nach Wohneinheiten“ zählt die Garage als eine Einheit mit. Soll sie dort nichts tragen, wählen Sie unter „Weitere Optionen: nur bestimmte Wohnungen beteiligen“ nur die Wohnungen.' },
      { page: 'stammdaten', text: 'Zahlt der Garagenmieter keine Nebenkosten, wählen Sie an seinem Mietverhältnis unter „Weitere Angaben“ bei den Nebenkosten „in der Miete enthalten (Inklusiv-/Warmmiete)“.' },
      { page: 'stammdaten', text: 'Mehrere Garagen auf einem eigenen Grundstück, etwa einen Garagenhof, legen Sie als eigenes Objekt mit der Art „Sonstiges (z. B. Garagen)“ an; die Art ändert an der Berechnung nichts. Verteilen Sie die Kosten dort nach Wohneinheiten, denn nach Fläche gibt es bei Garagen mit 0 m² keine Verteilbasis.' },
    ],
    result: [
      'Mit 0 m² und 0 Personen trägt die Garage nach Fläche und nach Personen nichts. Die Abrechnung nennt das als Hinweis, nicht als Warnung.',
      'Bei Heizung und Warmwasser zählt eine Einheit ohne Fläche und ohne Bewohner nicht als Wohnung: keine Warnung zur Warmmiete und kein Kürzungsbetrag.',
      'Ohne Wasseranschluss fehlt der Garage kein Zähler, und Wasserkosten nach Verbrauch betreffen sie nicht.',
    ],
    example: 'Zwei Wohnungen mit 70 und 50 m² und eine vermietete Garage mit 0 m². Grundsteuer 1.200 € nach Wohnfläche: 700 € und 500 €, die Garage trägt nichts. Müllabfuhr 600 € nach Wohneinheiten: Mit der Garage trägt jede der drei Einheiten 200 €; sind nur die Wohnungen beteiligt, je 300 €.',
    caveats: [
      { text: 'Nebenkosten trägt der Mieter einer Garage nur, wenn das vereinbart ist; sonst trägt der Vermieter die Lasten der Mietsache, etwa die Grundsteuer.', norm: '§ 535 Abs. 1 Satz 3, § 556 Abs. 1 BGB' },
      { text: 'In der Anlage V fragen die Zeilen zur Gesamtwohnfläche und zur eigengenutzten Fläche nur Wohnfläche ab; Garagen gehören nicht dazu. Die Steuerübersicht erklärt das, wenn Sie selbst im Haus wohnen.' },
    ],
    gaps: [
      { text: 'Eine Rechnung für Haus und Garagenhof als zwei Objekte einmal erfassen und vorverteilen.', issue: 95 },
    ],
    terms: ['noConnection', 'participants', 'inclusiveRent', 'distributionBasis'],
  },
  flatRate: {
    title: 'Pauschale oder Inklusivmiete',
    applies: 'Ihr Mietvertrag sieht für die Nebenkosten keine Vorauszahlung mit Abrechnung vor, sondern einen festen Betrag (Pauschale) oder die Nebenkosten stecken in der Miete (Inklusivmiete), ganz oder nur für die Heizung.',
    steps: [
      { page: 'stammdaten', text: 'Öffnen Sie das Mietverhältnis und klappen Sie „Weitere Angaben — Nebenkosten-Modell, Kontakt, Kaution, Vertrag (optional)“ auf.' },
      { page: 'stammdaten', text: 'Wählen Sie bei den Nebenkosten und getrennt bei „Heizung und Warmwasser“ jeweils „Vorauszahlung mit Abrechnung“, „Pauschale (keine Abrechnung)“ oder „in der Miete enthalten (Inklusiv-/Warmmiete)“.' },
      { page: 'stammdaten', text: 'Bei einer Pauschale tragen Sie den Betrag in die „Pauschale je Monat — Staffel“ ein. Wird ein Teil weiter abgerechnet, etwa die Heizung, gehört dessen Vorauszahlung in die Staffel „NK-Vorauszahlung“.' },
      { page: 'stammdaten', text: 'Ist alles inklusive, tragen Sie die ganze Miete in die Staffel „Kaltmiete je Monat“ ein und lassen die Vorauszahlung leer.' },
      { page: 'mietkonto', text: 'Die Zahlungen erfassen Sie wie sonst mit „+ Zahlung erfassen“.' },
      { page: 'steuer', text: 'Lesen Sie die Hinweise der Steuerübersicht zu den Zeilen 20 und 24 der Anlage V.' },
    ],
    result: [
      'Ein Mietverhältnis mit Pauschale oder Inklusivmiete bekommt keine Abrechnung; die Seite Abrechnung nennt es unter „Ohne Abrechnung“.',
      'Es bleibt in der Verteilbasis. Sein Anteil wird ihm nicht berechnet, sondern bleibt beim Vermieter, mit dem Grund „Betriebskostenpauschale“ oder „Inklusivmiete“. Das ist kein Eigenanteil und zählt als Werbungskosten.',
      'Das Mietkonto führt die Pauschale im monatlichen Soll; die Abrechnung rechnet sie nie an.',
      'Ist für die Heizung eine Pauschale oder Warmmiete vereinbart, obwohl das Haus nicht das selbstbewohnte Zweifamilienhaus ist, warnt die Abrechnung.',
    ],
    example: 'Zwei gleich große Wohnungen, Grundsteuer 1.200 € nach Wohnfläche. Der Mieter mit Vorauszahlung trägt 600 €. Die Mieterin nebenan zahlt eine Pauschale von 50 € im Monat, im Jahr 600 €, die im Mietkonto steht; ihr Anteil an der Grundsteuer von 600 € bleibt beim Vermieter.',
    caveats: [
      { text: 'Betriebskosten dürfen als Pauschale oder als Vorauszahlung vereinbart werden.', norm: '§ 556 Abs. 2 BGB' },
      { text: 'Eine Pauschale dürfen Sie nur erhöhen, wenn der Mietvertrag das vorsieht, durch Erklärung in Textform; sinken die Betriebskosten, ist sie ab dann herabzusetzen.', norm: '§ 560 Abs. 1 und 3 BGB' },
      { text: `Für Heizung und Warmwasser geht die Heizkostenverordnung einer Pauschale oder Warmmiete vor, außer im Gebäude mit nicht mehr als zwei Wohnungen, von denen Sie eine selbst bewohnen. Wird entgegen der Verordnung nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um ${CUT} Prozent kürzen.`, norm: '§ 2, § 12 Abs. 1 HeizkostenV' },
    ],
    gaps: [
      { text: 'Mietfuchs vergleicht eine Pauschale nicht mit den tatsächlichen Kosten und rechnet keine Erhöhung oder Senkung vor; das tun Sie anhand des Vermieteranteils selbst.' },
    ],
    terms: ['flatRate', 'inclusiveRent', 'prepayment', 'heatingCostOrdinance'],
  },
  meteringService: {
    title: 'Fertige Abrechnung eines Messdienstes übernehmen',
    applies: 'Ein Messdienst wie Techem, ista, Brunata oder Minol rechnet Heizung und Warmwasser ab und nennt für jede Wohnung oder jeden Nutzer einen Betrag.',
    steps: [
      { page: 'kosten', text: 'Legen Sie mit „+ Kostenposition manuell erfassen“ eine Position mit der Kostenart „Heizung und Warmwasser“ an. Unter „Betrag €“ tragen Sie ein, was Sie für Heizung und Warmwasser bezahlt haben, also die Kosten vor dem Abzug des CO₂-Anteils, den Sie als Vermieter tragen. Viele Messdienste ziehen diesen Anteil schon in der Kostenaufstellung ab; dann ist ihre Summe um ihn zu niedrig, und Sie rechnen: Summe aller Nutzerbeträge für Heizung und Warmwasser (einschließlich Leerstand) + CO₂-Anteil des Vermieters.' },
      { page: 'kosten', text: 'Wählen Sie den Umlageschlüssel „Einzelbeträge je Mieter (z. B. Messdienst)“ und füllen Sie bei jedem Mietverhältnis das Feld für Heizung und Warmwasser aus. Tragen Sie den Betrag ein, den die Abrechnung für den Mieter nennt; ziehen Sie selbst nichts ab. Weist die Abrechnung den CO₂-Anteil des Vermieters nur aus, ohne ihn vorab abzuziehen, zieht Mietfuchs ihn mit einer eigenen Zeile ab. Ist ein Mieter im Jahr ausgezogen, bekommen alter und neuer Mieter je ihren Betrag. Rechnet der Messdienst auch Kaltwasser oder weitere Nebenkosten ab, erfassen Sie diese als eigene Positionen mit ihrer Kostenart und ihren Einzelbeträgen.' },
      { page: 'kosten', text: 'Bewohnen Sie selbst eine Wohnung, tragen Sie in deren Feld den Betrag ein, den die Abrechnung für Ihre Wohnung nennt, ohne etwas dazuzurechnen. Den Teil des CO₂-Anteils, der auf Ihre Wohnung entfällt, tragen Sie auf der Seite Heizkosten in der Karte „CO₂-Kosten“ unter „davon für Ihre selbst bewohnte Wohnung“ ein: Steht auf der Einzelabrechnung Ihrer Wohnung ein vom Vermieter übernommener CO₂-Betrag, nehmen Sie diesen. Nennt die Abrechnung solche Beträge bei den Mietern, aber nicht bei Ihrer Wohnung, tragen Sie 0 ein; dann gehört nichts davon ins Private. Nur wenn sie gar keine Beträge je Wohnung nennt, lassen Sie das Feld leer, und Mietfuchs rechnet näherungsweise: CO₂-Anteil × Betrag Ihrer Wohnung ÷ Summe aller Nutzerbeträge für Heizung und Warmwasser.' },
      { page: 'kosten', text: 'Nennt die Abrechnung Arbeitskosten, tragen Sie sie unter „§35a-Lohn“ ein. Die Abrechnung selbst hängen Sie unter „Beleg (Rechnungskopie)“ an.' },
      { page: 'heizkosten', text: `Für Abrechnungszeiträume, die am oder nach dem ${CO2_FROM} beginnen, öffnen Sie die Seite Heizkosten und füllen die Karte „CO₂-Kosten“ aus: die Antwort auf die Frage nach der Abzugszeile, die Summe der Kosten aller Nutzer und die Zahlen der CO₂-Seite der Abrechnung. Die Zeile „Probe“ zeigt, ob der Betrag Ihrer Position dazu passt. Die Seite erscheint, sobald unter Stammdaten eine Heizanlage eingerichtet ist.` },
      { page: 'abrechnung', text: 'Prüfen Sie in der Abrechnung, ob für jeden Mieter ein Betrag eingetragen ist.' },
    ],
    result: [
      'Jeder Mieter trägt genau seinen Betrag, ohne Tagesanteil; bei einem Wechsel teilt der Messdienst selbst auf.',
      'Mit den CO₂-Angaben prüft Mietfuchs, ob der Betrag der Position zur Abrechnung passt. Beim Vorwegabzug steht der CO₂-Anteil des Vermieters für die vermieteten Wohnungen mit dem Grund „CO₂-Anteil des Vermieters“ beim Vermieter und in der Steuerübersicht als Werbungskosten; der Teil, der auf Ihre selbstgenutzte Wohnung entfällt, gehört zu Ihrem Eigenanteil und ist privat.',
      'Weist der Messdienst die CO₂-Kosten nur aus, ohne sie abzuziehen, bekommt jeder Mieter eine eigene Zeile „CO₂-Kosten: Anteil des Vermieters“.',
      'Fehlt für einen Mieter ein Betrag, sagt die Abrechnung es. Mehr als der Rechnungsbetrag lässt sich nicht verteilen, und eine Gutschrift nicht nach Einzelbeträgen.',
      'Für die Prüfung nach der Heizkostenverordnung zählen Einzelbeträge als Verteilung nach Verbrauch.',
    ],
    example: 'Die Heizkostenabrechnung nennt 1.200 € für Wohnung A, 1.100 € für Wohnung B und 600 € für Ihre eigene Wohnung, zusammen 2.900 €. Vorher abgezogen hat der Messdienst unter „abzüglich CO₂-Kosten Vermieter“ 100 €, die Sie als Vermieter tragen. Bezahlt haben Sie also 3.000 €, und das ist der Betrag der Position. Die Mieter tragen 1.200 € und 1.100 €; in das Feld Ihrer Wohnung kommen 600 €. In der Karte „CO₂-Kosten“ tragen Sie 2.900 € als Summe der Kosten aller Nutzer und 100 € als CO₂-Anteil des Vermieters ein; die Probe erwartet 3.000 € und findet sie. Die Einzelabrechnung Ihrer Wohnung nennt 20,69 € als vom Vermieter übernommen (die Näherung 100 × 600 ÷ 2.900 ergäbe dasselbe); Ihr Eigenanteil ist damit 620,69 €. Die übrigen 79,31 € stehen als CO₂-Anteil des Vermieters in der Steuerübersicht als Werbungskosten. Mit 2.900 € als Betrag fehlten sie dort.',
    caveats: [
      { text: `Bei einer Zentralheizung sind mindestens ${SHARE.min} und höchstens ${SHARE.max} Prozent der Kosten nach Verbrauch zu verteilen; das erledigt der Messdienst. Wird nicht nach Verbrauch abgerechnet, darf der Mieter um ${CUT} Prozent kürzen.`, norm: '§ 7 Abs. 1, § 8 Abs. 1, § 12 Abs. 1 HeizkostenV' },
      { text: 'Beim Mieterwechsel muss eine Zwischenablesung stattfinden; melden Sie dem Messdienst den Auszug rechtzeitig.', norm: '§ 9b HeizkostenV' },
      { text: `Fallen für die Heizung CO₂-Kosten an, sind sie zwischen Ihnen und dem Mieter nach dem CO₂-Ausstoß des Gebäudes aufzuteilen. Die Heizkostenabrechnung muss den Anteil des Mieters, die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen; fehlt das, darf der Mieter seinen Anteil an den Heizkosten um ${CO2_CUT} Prozent kürzen. Die großen Messdienste teilen auf, wenn Sie ihnen die CO₂-Angaben Ihrer Brennstoffrechnung melden, und weisen die Angaben in ihrer Abrechnung aus; legen Sie sie dem Mieter mit Ihrer Abrechnung bei.`, norm: '§ 5 Abs. 2, § 7 Abs. 3 und 4 CO2KostAufG' },
      { text: 'Weist die Abrechnung keinen CO₂-Anteil des Vermieters aus, fragen Sie beim Messdienst nach, bevor Sie abrechnen. Oder beantworten Sie die Frage nach der Abzugszeile mit „gar nicht aufgeteilt“ und tragen die Rechnung des Versorgers auf der Seite Heizkosten als Lieferung ein, „vom Messdienst angesetzt“; dann teilt Mietfuchs selbst auf.' },
      { text: 'Nicht jeder Messdienst setzt für eine selbstgenutzte Wohnung einen vom Vermieter übernommenen CO₂-Anteil an. Sehen Sie deshalb in die Einzelabrechnung Ihrer Wohnung, bevor Sie in der Karte „CO₂-Kosten“ etwas eintragen (Schritt 3).' },
      { text: 'Wo in der Abrechnung die Summe der Kosten aller Nutzer steht, beschreibt die Anleitung zum Aufteilen der CO₂-Kosten.' },
    ],
    gaps: [
      { text: 'Die Abrechnung des Messdienstes per KI auslesen und den Mietverhältnissen zuordnen; heute tragen Sie die Beträge von Hand ein.', issue: 103 },
      { text: 'Verschiedene Geräte in einer Heizanlage (Wärmezähler neben Heizkostenverteilern) brauchen eine Vorerfassung nach Gruppen; die rechnet Mietfuchs noch nicht.', issue: 218 },
    ],
    terms: ['individualAmounts', 'heatingCostOrdinance', 'ownShare', 'labor35a', 'co2Deducted'],
  },
  co2Costs: {
    title: 'CO₂-Kosten der Heizung aufteilen',
    applies: `Sie heizen mit Gas, Heizöl, Flüssiggas oder Kohle, oder Ihr Wärmelieferant weist CO₂-Kosten aus, und ein Messdienst oder die Hausverwaltung erstellt die Heizkostenabrechnung. Für Abrechnungszeiträume, die am oder nach dem ${CO2_FROM} beginnen, sind die CO₂-Kosten zwischen Ihnen und den Mietern aufzuteilen.`,
    steps: [
      { page: 'stammdaten', text: 'Richten Sie in der Karte „Heizung“ die Heizanlage ein, falls noch nicht geschehen: den Energieträger und bei der Frage, wer abrechnet, „Ein Messdienst oder die Hausverwaltung“.' },
      { page: 'kosten', text: 'Sehen Sie zuerst in der Kostenaufstellung des Messdienstes nach, ob eine Zeile den CO₂-Anteil des Vermieters vor der Verteilung abzieht, etwa „Abzüglich CO₂-Kosten Vermieter“. Ein Betrag „vom Vermieter übernommen“ bei den einzelnen Mietern ist dafür kein Zeichen.' },
      { page: 'kosten', text: 'Erfassen Sie die Abrechnung des Messdienstes wie in der Anleitung zur fertigen Abrechnung eines Messdienstes. Mit dieser Zeile ist der Betrag die Summe der Kosten aller Nutzer plus den CO₂-Anteil des Vermieters. Ohne diese Zeile ist der Betrag die Summe der Kosten aller Nutzer. Als Einzelbeträge tragen Sie die Beträge der Mieter wie in der Abrechnung ein, ohne selbst etwas abzuziehen.' },
      { page: 'heizkosten', text: 'Öffnen Sie die Seite Heizkosten und beantworten Sie in der Karte „CO₂-Kosten“ die Frage nach der Abzugszeile. Darunter steht eine Beispielzeile, an der Sie die Zeile erkennen.' },
      { page: 'heizkosten', text: 'Tragen Sie die Summe der Kosten aller Nutzer für Heizung und Warmwasser ein, so wie sie gedruckt ist. Finden Sie diese Zeile nicht, setzen Sie den Haken „Ich finde diese Zeile nicht“ und tragen die Beträge der leeren oder nicht eingetragenen Einheiten ein; dann rechnet Mietfuchs die Summe aus den Einzelbeträgen.' },
      { page: 'heizkosten', text: 'Übertragen Sie von der CO₂-Seite der Abrechnung den Ausstoß je Quadratmeter, den Anteil des Vermieters in Prozent, die CO₂-Kosten insgesamt und den Anteil des Vermieters in Euro, dazu „CO₂-Ausstoß insgesamt laut Abrechnung (kg)“ und „Wohnfläche laut Abrechnung (m²)“: Aus diesen beiden ist der Wert je Quadratmeter berechnet, und die Abrechnung muss sie als Berechnungsgrundlagen nennen. Unter „Nutzeinheiten laut Abrechnung“ steht die Zahl der Wohnungen und anderen Einheiten, auf die der Messdienst verteilt hat, auch leere. Die Zeile „Probe“ zeigt, ob der Betrag Ihrer Position dazu passt.' },
      { page: 'heizkosten', text: 'Nennt die Abrechnung je Mieter einen Betrag „vom Vermieter übernommen“, tragen Sie ihn beim Mieter ein; sonst rechnet Mietfuchs ihn nach dem Anteil an den Heizkosten.' },
    ],
    result: [
      'Bei einer Abzugszeile bleibt jeder Mieter bei seinem Betrag; der CO₂-Anteil des Vermieters steht beim Vermieter mit dem Grund „CO₂-Anteil des Vermieters“ und in der Steuerübersicht als Werbungskosten, der Teil Ihrer eigenen Wohnung im Eigenanteil.',
      'Ohne Abzugszeile bekommt jeder Mieter eine eigene Zeile „CO₂-Kosten: Anteil des Vermieters“ mit seinem Abzug.',
      `Geht die Probe nicht auf, bucht Mietfuchs nichts und nennt die Kürzung von ${CO2_CUT} % je Mieter; ebenso, wenn der Messdienst gar nicht aufgeteilt hat.`,
      'Die Abrechnung jedes Mieters enthält den Block „CO₂-Kostenaufteilung“ mit Einstufung und Grundlagen.',
    ],
    example: 'Die Kostenaufstellung eines Messdienstes nennt „Anlieferung Brennstoff“ 3.540,00 €, darunter „Abzüglich CO₂-Kosten Vermieter“ 87,50 €; die Kosten aller Nutzer ergeben 3.845,51 €. Sie beantworten die Frage nach der Abzugszeile mit „Ja“ und tragen 3.845,51 € und 87,50 € ein. Der Betrag Ihrer Position ist 3.845,51 € + 87,50 € = 3.933,01 €, und die Probe geht auf. Die Mieter tragen ihre Beträge unverändert; die 87,50 € stehen beim Vermieter als CO₂-Anteil, und in der Steuerübersicht stehen 3.933,01 € als Werbungskosten.',
    caveats: [
      { text: `Fehlt die Aufteilung oder der Ausweis der CO₂-Kosten in der Heizkostenabrechnung, darf jeder Mieter seinen Anteil an den Heizkosten um ${CO2_CUT} Prozent kürzen.`, norm: '§ 7 Abs. 3 und 4 CO2KostAufG' },
      { text: 'Wo die Summe der Kosten aller Nutzer steht, ist je Messdienst verschieden. Bei Techem heißt die Zeile „Summe der Nutzerkosten Heizungsanlage“. Für ista, Brunata, Minol und KALO liegt Mietfuchs keine Musterabrechnung vor; suchen Sie die gedruckte Summe der Kosten aller Nutzer für Heizung und Warmwasser, bei einer Abzugszeile die Summe nach dem Abzug.' },
      { text: 'Ob ein Messdienst den Anteil des Vermieters vorab abzieht, ist nicht bei allen Messdiensten gleich; deshalb fragt Mietfuchs danach, statt es je Messdienst anzunehmen.' },
      { text: 'Ist ein Abrechnungszeitraum von unter einem Jahr vereinbart, werden die Grenzen der Stufentabelle anteilig gekürzt.', norm: '§ 5 Abs. 1 Satz 4 CO2KostAufG' },
    ],
    gaps: [
      { text: 'Die CO₂-Angaben für den Messdienst ausdrucken.', issue: 210 },
      { text: 'Die Abrechnung des Messdienstes per KI auslesen.', issue: 103 },
    ],
    terms: ['co2Split', 'co2Stage', 'co2Deducted', 'co2Area'],
  },
  // Heizung PR 10 (#99, Entwurf 11.4): die eigene Heizkostenabrechnung. Beispiel nachgerechnet in guides.test.ts.
  heatingSelf: {
    title: 'Heizkosten selbst abrechnen',
    applies: 'Ihr Haus hat eine Zentralheizung, und Sie lesen die Wärmezähler oder die elektronischen Heizkostenverteiler (und, wenn die Heizung auch das Warmwasser bereitet, die Warmwasserzähler) jeder Wohnung selbst ab, oder ein Ablesedienst nennt Ihnen die Werte je Wohnung, und Sie rechnen selbst ab. Mietfuchs verteilt dann nach der Heizkostenverordnung in Grund- und Verbrauchskosten.',
    steps: [
      { page: 'stammdaten', text: 'Klicken Sie in der Karte „Heizung“ auf „Heizung einrichten“, wählen Sie die Energie und bei der Frage, wer abrechnet, „Ich selbst, mit Zählern oder Heizkostenverteilern“.' },
      { page: 'stammdaten', text: 'Beantworten Sie danach die Fragen zu Warmwasser, Erfassung, Wärmeschutz und dem Anteil nach Verbrauch und klicken Sie auf „Umstellen“. Nennt Mietfuchs Heizpositionen, wählen Sie für jede Teil und Ziel. Den Anteil und die Antwort zum Wärmeschutz ändern Sie später auf der Seite Heizkosten.' },
      { page: 'zaehler', text: 'Tragen Sie die Stände der angelegten Zähler zu Beginn und Ende der Heizperiode ein, beim Mieterwechsel zum Auszugstag.' },
      { page: 'zaehler', text: 'Mit Heizkostenverteilern legen Sie je Heizkörper einen Zähler mit der Sparte „Heizkostenverteiler“ an und wählen die Skala. Bei der Einheitsskala tragen Sie den Bewertungsfaktor des Heizkörpers ein. Setzt das Gerät am Stichtag auf null, tragen Sie in seinen Ablesungen den „Stichtagswert laut Anzeige“ ein und klicken auf „Stichtagswert speichern“.' },
      { page: 'heizkosten', text: 'Liefert ein Ablesedienst die Werte, etwa bei Verdunstern, tragen Sie sie auf der Seite Heizkosten in der Karte „Werte des Ablesedienstes“ je Wohnung und Nutzungszeitraum ein und klicken auf „Werte speichern“.' },
      { page: 'kosten', text: 'Erfassen Sie Brennstoff, Betriebsstrom, Wartung und Zählermiete als Position „Heizung und Warmwasser“; der Schlüssel ist „nach Heizkostenverordnung“, dazu der Teil der Heizkosten unter „Weitere Angaben“ und das Ziel.' },
      { page: 'heizkosten', text: 'Bereitet die Heizung auch das Warmwasser, wählen Sie auf der Seite Heizkosten in der Karte „Warmwasser“, wie die Wärme dafür bestimmt wird. Ohne Wärmezähler am Speicher tragen Sie das Warmwasser in m³ und seine Temperatur ein; bei Gas wählen Sie an der Rechnung unter „Kilowattstunden der Rechnung berechnet nach“ Brennwert oder Heizwert.' },
      { page: 'heizkosten', text: 'Prüfen Sie auf der Seite Heizkosten die Ablesungen. Fehlt beim Mieterwechsel eine Zwischenablesung, antworten Sie mit „Nicht möglich“ (mit Grund) oder „Nicht durchgeführt“. Wählen Sie in der Karte Ableseergebnis jede Wohnung und klicken Sie auf „Ableseergebnis drucken“; das Blatt geht an den Mieter dieser Wohnung.' },
      { page: 'heizkosten', text: 'Kann der Verbrauch einer Wohnung nicht ordnungsgemäß erfasst werden, etwa weil ein Gerät ausgefallen ist, klicken Sie auf der Seite Heizkosten in der Karte „Schätzung (§ 9a)“ bei der Wohnung auf „Schätzen“. Mietfuchs schlägt den Durchschnitt des Gebäudes je m² vor und nennt vorher den Anteil an der Fläche; wählen Sie den Grund, tragen Sie die Begründung ein (sie steht auf der Abrechnung des Mieters), bestätigen Sie, dass der Verbrauch nicht ordnungsgemäß erfasst werden konnte, und klicken Sie auf „Schätzung speichern“.' },
      { page: 'heizkosten', text: 'Tragen Sie auf der Seite Heizkosten in der Karte „Angaben zur Abrechnung (§ 6a)“ die Steuern und Abgaben laut Rechnung ein, den Vergleichswert eines Durchschnittsnutzers mit seiner Quelle (etwa von Ihrem Ablesedienst), die Klimafaktoren dieser und der vorigen Heizperiode mit ihrer Quelle und ob Ihr Mietvertrag ein Verbrauchervertrag ist (Sie vermieten als Unternehmer an einen Verbraucher), und klicken Sie auf „Angaben speichern“.' },
      { page: 'heizkosten', text: 'Gilt für Ihr Haus eine Ausnahme der Heizkostenverordnung, haben Sie im Zweifamilienhaus mit eigener Wohnung etwas anderes vereinbart oder bekommen die Mieter die monatliche Verbrauchsinformation vom Messdienst, geben Sie das in der Karte „Ausnahmen und Vereinbarungen“ an; die Antwort gilt ab dieser Heizperiode.' },
    ],
    result: [
      'Die Kosten jedes Topfs (Heizung, Warmwasser) gehen zum gewählten Anteil nach Verbrauch, der Rest nach Wohnfläche; bei verbundener Warmwasserbereitung teilt Mietfuchs die gemeinsamen Kosten nach der Wärme für das Warmwasser: gemessen am Warmwasserspeicher oder, wo das Messen unzumutbar wäre, nach den Formeln der Heizkostenverordnung; Brennstoff in Litern, Kilogramm oder Kubikmetern mit dem Heizwert laut Rechnung.',
      'Beim Mieterwechsel trägt jeder seinen abgelesenen Verbrauch; die Grundkosten der Heizung teilen sich nach Gradtagen, die des Warmwassers nach Tagen.',
      'Leerstand und Eigennutzung sind Nutzer wie Mieter; ihren Anteil tragen Sie. Die Abrechnung druckt den Block „Heizkostenabrechnung“ mit den Preisen je m², kWh und m³, bei Heizkostenverteilern und Ablesedienst je Einheit.',
      'Bei Heizkostenverteilern zählt jedes Gerät mit seinem Bewertungsfaktor; jeder Mieter bekommt seine Geräte mit Einheiten, Skala und Faktor ausgewiesen. Die Werte eines Ablesedienstes zählen wie abgelesen.',
      'Mit der Abrechnung druckt Mietfuchs für jeden Mieter die Informationen nach § 6a: Energieträger, Steuern und Abgaben, Entgelte der Erfassung, Kontaktadressen, den Vergleich mit dem Durchschnittsnutzer und den witterungsbereinigten Vergleich mit dem vorhergehenden Abrechnungszeitraum als Balken, beides nur mit seinen eigenen Zahlen. Fehlt einem Mieter eine Angabe, nennt die Abrechnung seine Kürzung.',
      `Ein geschätzter Verbrauch gilt für die ganze Heizperiode der Wohnung; wer bis zu einem Mieterwechsel gültig abgelesen ist, behält seinen Wert. Betrifft die Schätzung mehr als ${ESTIMATE_THRESHOLD} % der Fläche, gehen die Kosten dieses Topfs nur nach der Fläche.`,
    ],
    example: 'Zwei Wohnungen à 50 m², Fernwärme 3.000 €, kein zentrales Warmwasser, 70 % nach Verbrauch. Grundkosten 30 %: 900 €, je Wohnung 450 €. Verbrauchskosten 70 %: 2.100 € für 10.000 kWh. Wohnung A: 4.000 kWh, 840 €, zusammen 1.290 €. Wohnung B: 6.000 kWh, zusammen 1.710 €.',
    caveats: [
      { text: `Zwischen ${SHARE.min} und ${SHARE.max} Prozent der Kosten sind nach Verbrauch zu verteilen; bei Öl- oder Gasheizung in einem Haus mit Wärmeschutz unter dem Niveau von 1994 und überwiegend gedämmten Leitungen ${FORCED} Prozent der Heizkosten. Mehr geht nur mit einer Vereinbarung. Wissen Sie es nicht, liegen Sie mit ${FORCED} Prozent in jedem Fall richtig.`, norm: '§ 7 Abs. 1, § 8 Abs. 1, § 10 HeizkostenV' },
      { text: 'Den Anteil ändern Sie nach der ersten Festlegung nur aus den dort genannten Gründen, durch Erklärung gegenüber den Mietern und nur für künftige Abrechnungszeiträume.', norm: '§ 6 Abs. 4 HeizkostenV' },
      { text: 'Beim Mieterwechsel ist eine Zwischenablesung Pflicht. Wird sie nicht durchgeführt, rechnet Mietfuchs ersatzweise nach Gradtagen und Tagen, und der Mieter kann seinen Anteil kürzen; die Abrechnung nennt die Beträge.', norm: '§ 9b HeizkostenV' },
      { text: 'Die Kosten der Zwischenablesung sind keine Betriebskosten; sie trägt der Vermieter, soweit im Mietvertrag nichts anderes vereinbart ist.', norm: 'BGH VIII ZR 19/07' },
      { text: `Wird entgegen der Verordnung nicht nach Verbrauch verteilt, etwa weil keine Zähler eingebaut sind, darf jeder Mieter seinen Anteil um ${CUT} Prozent kürzen.`, norm: '§ 12 Abs. 1 Satz 1 HeizkostenV' },
      { text: 'Bei Zählern, die nicht aus der Ferne ablesbar sind, teilen Sie jedem Mieter das Ergebnis der Ablesung in der Regel innerhalb eines Monats mit.', norm: '§ 6 Abs. 1 HeizkostenV' },
      { text: 'Verwenden dürfen Sie nur Zähler und Heizkostenverteiler, deren Eignung eine sachverständige Stelle bestätigt hat; sie müssen für das Heizsystem geeignet und fachgerecht angebracht sein. Der Bewertungsfaktor eines Heizkostenverteilers hängt am Heizkörper; lassen Sie ihn fachgerecht ermitteln, etwa vom Messdienst oder vom Betrieb, der die Geräte anbringt.', norm: '§ 5 Abs. 1 Satz 2 und 4 HeizkostenV' },
      { text: `Die Wärme für das Warmwasser ist mit einem Wärmezähler zu messen. Eine Formel ist nur erlaubt, wenn das Messen unzumutbar aufwendig wäre; sonst darf jeder Mieter seinen Anteil an den Heiz- und Warmwasserkosten um ${CUT} Prozent kürzen.`, norm: '§ 9 Abs. 2, § 12 Abs. 1 Satz 1 HeizkostenV; BGH, Urteil vom 12.01.2022, VIII ZR 151/20' },
      { text: 'Geschätzt werden darf nur, wenn der Verbrauch wegen Geräteausfalls oder aus einem anderen zwingenden Grund nicht ordnungsgemäß erfasst werden kann. Auch ein Ablesefehler ist ein solcher Grund, wenn sich der Wert nicht mehr ermitteln lässt; im entschiedenen Fall war die Ablesung nicht nachholbar. Lässt sich ein Wert noch ablesen, ist er abzulesen; eine Ablesung einige Tage neben dem Stichtag ist kein Grund zu schätzen.', norm: '§ 9a Abs. 1 HeizkostenV; BGH, Urteil vom 16.11.2005, VIII ZR 373/04' },
      { text: 'Für die Grenze des § 9a Abs. 2 zählt Mietfuchs die ganze Fläche einer Wohnung, auch wenn nur ein Teil der Heizperiode geschätzt ist, und prüft Heizung und Warmwasser getrennt. Die Verordnung sagt dazu nichts Ausdrückliches; das ist eine Auslegung von Mietfuchs.', norm: '§ 9a Abs. 2 HeizkostenV' },
      { text: `Für Abrechnungszeiträume, die vor dem ${HEAT_PUMP_FROM} beginnen, galten die Vorschriften zur Verteilung nicht für Gebäude, die überwiegend mit Wärme aus Wärmepumpen versorgt werden. Mietfuchs fragt deshalb bei einer Wärmepumpe, ob sie mehr als die Hälfte der Wärme liefert.`, norm: '§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV in der alten Fassung' },
      { text: `Zur Abrechnung nach Verbrauch gehören die Informationen nach § 6a; fehlen sie ganz oder teilweise, darf der Mieter, dem sie fehlen, seinen Anteil um ${INFO_CUT} Prozent kürzen. Der Vergleich mit einem Durchschnittsnutzer stammt aus Vergleichsdaten, etwa der Ablesedienste; ein Durchschnitt Ihres eigenen Hauses ist kein solcher Vergleich.`, norm: '§ 6a Abs. 3, § 12 Abs. 1 Satz 3 HeizkostenV; BR-Drs. 643/21, S. 19 und 21' },
      { text: `Hat ein Mieter im vorhergehenden Abrechnungszeitraum noch nicht in der Wohnung gewohnt, ist der Vergleich nach Nr. 5 für ihn nicht möglich. Eine Ausnahme dafür nennt die Verordnung nicht; Mietfuchs nennt deshalb bis zu ${INFO_CUT} Prozent Kürzung, das ist eine Auslegung von Mietfuchs.`, norm: '§ 6a Abs. 3 Satz 1 Nr. 5 HeizkostenV' },
    ],
    gaps: [
      { text: 'Die monatlichen Verbrauchsinformationen bei fernablesbaren Geräten erstellt Mietfuchs noch nicht.', issue: 99 },
      { text: 'Verschiedene Geräte in einer Heizanlage (Wärmezähler neben Heizkostenverteilern) brauchen eine Vorerfassung nach Gruppen mit einem eigenen Wärmezähler je Gruppe; die rechnet Mietfuchs noch nicht. Offen ist dabei, ob eine Differenzrechnung genügt (für eine Gemeinschaft der Wohnungseigentümer BGH, V ZR 214/21; für das Mietrecht nicht entschieden) und wie § 6 Abs. 2 zu lesen ist, der auf „§ 5 Absatz 2“ verweist, gemeint ist nach Zusammenhang die Vorerfassung des § 5 Abs. 7.', issue: 218 },
      { text: 'Verdunster wertet Mietfuchs nicht selbst aus und hat das auch nicht vor; übernehmen Sie die Werte des Ablesedienstes.' },
      { text: 'Den Durchschnittsverbrauch einer Nutzergruppe als Grundlage der Schätzung rechnet Mietfuchs nicht, denn er setzt die Vorerfassung nach Gruppen voraus.', issue: 218 },
    ],
    terms: ['heatingCostOrdinance', 'baseCosts', 'consumptionCosts', 'interimReading', 'heatMeter', 'heatCostAllocator', 'hotWaterShare', 'degreeDays', 'heatingEstimate'],
  },
  tenantChange: {
    title: 'Mieterwechsel und Leerstand im Jahr',
    applies: 'Ein Mieter zieht im Laufe des Jahres aus, und die Wohnung wird gleich oder erst später wieder vermietet.',
    steps: [
      { page: 'stammdaten', text: 'Klicken Sie beim laufenden Mietverhältnis auf „Mieterwechsel“. Der Assistent fragt das „Auszugsdatum (letzter Miettag)“, dann die Zählerstände zum Auszug („Zwischenablesung der Zähler“) und zuletzt den neuen Mieter.' },
      { page: 'stammdaten', text: 'Steht die Wohnung danach leer, setzen Sie den Haken „Wohnung bleibt vorerst leer (Leerstand)“. Mit „Mieterwechsel durchführen“ wird alles auf einmal gespeichert; den neuen Mieter legen Sie später mit „+ Mietverhältnis hinzufügen“ an.' },
      { page: 'stammdaten', text: 'Die neue Anschrift des ausgezogenen Mieters tragen Sie an seinem Mietverhältnis ein: ✎ klicken, „Weitere Angaben — Nebenkosten-Modell, Kontakt, Kaution, Vertrag (optional)“ aufklappen und „Abweichende Anschrift (Schriftverkehr)“ ausfüllen. So haben Sie sie beim Versand der Abrechnung zur Hand; auf den Ausdruck kommt sie nicht.' },
      { page: 'zaehler', text: 'Eine Zwischenablesung können Sie auch später nachtragen: Ablesungen des Zählers aufklappen, Datum und Stand eintragen und „Ablesung speichern“.' },
      { page: 'mietkonto', text: 'Prüfen Sie im Mietkonto, ob die Vorauszahlungen bis zum Auszug eingegangen sind.' },
      { page: 'abrechnung', text: 'Jedes Mietverhältnis bekommt seine eigene Abrechnung. Hat ein Mieter weniger gezahlt als vereinbart, tragen Sie den gezahlten Betrag mit „✎ anpassen“ ein.' },
    ],
    result: [
      'Jeder Mieter trägt seinen Anteil für die Tage, an denen er gemietet hat. Den Anteil für die leeren Tage trägt der Vermieter, mit dem Grund „Leerstand“.',
      'Beim Personenschlüssel zählt eine leerstehende Wohnung je Leerstandstag mit einer Person, und auch diesen Anteil trägt der Vermieter. Wie eine leere Wohnung dort anzusetzen ist, ist nicht abschließend geklärt; die eine Person ist eine Auslegung von Mietfuchs.',
      'Beim Verbrauch teilt eine Zwischenablesung genau auf; ohne sie verteilt Mietfuchs den Verbrauch zwischen zwei Ablesungen tagesanteilig.',
      'Für ein Mietverhältnis, das im Jahr endet, schlägt die Abrechnung keine neue Vorauszahlung vor.',
    ],
    example: 'Eine Wohnung mit 60 von 180 m², Grundsteuer 1.800 € nach Wohnfläche, auf die Wohnung entfallen 600 €. Der alte Mieter wohnt bis 31.03.2025, 90 Tage: 147,95 €. April und Mai steht die Wohnung leer, 61 Tage: 100,27 € trägt der Vermieter. Der neue Mieter zieht am 01.06.2025 ein, 214 Tage: 351,78 €.',
    caveats: [
      { text: 'Zu Teilabrechnungen sind Sie nicht verpflichtet: Auch der ausgezogene Mieter bekommt seine Abrechnung mit der Jahresabrechnung, innerhalb derselben Frist von zwölf Monaten nach Ende des Abrechnungszeitraums.', norm: '§ 556 Abs. 3 Satz 2 und 4 BGB' },
      { text: 'Bei Heizung und Warmwasser ist beim Nutzerwechsel eine Zwischenablesung vorgeschrieben.', norm: '§ 9b HeizkostenV' },
      { text: 'Nach der Abrechnung können Sie und der neue Mieter die Vorauszahlung durch Erklärung in Textform auf eine angemessene Höhe anpassen.', norm: '§ 560 Abs. 4 BGB' },
    ],
    gaps: [
      { text: 'Eine geschätzte Ablesung kennzeichnen, wenn die Zwischenablesung versäumt wurde.', issue: 98 },
    ],
    terms: ['vacancy', 'personDays', 'meterReading', 'prepayment', 'settlementDeadline'],
  },
  // #208: Abrechnungszeitraum, der vom Kalenderjahr abweicht (Entwurf 11.4).
  periodMayApril: {
    title: 'Abrechnungszeitraum Mai bis April',
    applies: 'Ihr Messdienst rechnet die Heizkosten von Mai bis April ab, oder Ihr Mietvertrag nennt einen anderen Abrechnungszeitraum als das Kalenderjahr.',
    steps: [
      { page: 'stammdaten', text: 'Weicht nur der Zeitraum der Heizung ab, weil Ihr Messdienst von Mai bis April abrechnet, die übrigen Kosten aber im Kalenderjahr laufen, stellen Sie nicht das ganze Objekt um: Öffnen Sie in den Stammdaten die Karte „Heizung“ und klicken Sie auf „Zeitraum der Heizung ändern“. Dann entsteht kein Rumpfzeitraum für die übrigen Kosten.' },
      { page: 'stammdaten', text: 'Soll das ganze Objekt umgestellt werden, öffnen Sie die Karte „Abrechnungszeitraum“. Wählen Sie unter „Was möchten Sie ändern?“ den „Wechsel ab einem Monat“, tragen Sie den Monat ein, ab dem neu abgerechnet wird, und klicken Sie auf „Vorschau“. Wählen Sie keinen Monat, mit dem ein Rumpfzeitraum entstünde, dessen Abrechnungsfrist schon abgelaufen ist; die Vorschau sagt es rot.' },
      { page: 'stammdaten', text: 'Die Vorschau zeigt den Rumpfzeitraum davor mit seiner Frist und das Ergebnis der betroffenen Abrechnungen je Mieter vorher und nachher. Rechnungen ohne Leistungszeitraum, etwa die Grundsteuer des Jahres, teilt sie nach Tagen auf die neuen Zeiträume auf; Heizkosten teilt sie nicht, dort wählen Sie den Zeitraum, in dem die Wärme verbraucht wurde. Tragen Sie für jede Jahreskorrektur ein, was tatsächlich gezahlt wurde, oder setzen Sie den Haken „keine Korrektur (die Staffel gilt)“. Mit „Zeitraum wechseln“ wird alles gespeichert.' },
      { page: 'kosten', text: 'Eine Rechnung für ein Kalenderjahr, etwa die Grundsteuer, erfassen Sie mit ihrem Leistungszeitraum unter „Weitere Angaben“. Mietfuchs teilt sie beim Speichern nach Tagen auf die beiden Abrechnungszeiträume auf („Aufteilen und speichern“).' },
      { page: 'kosten', text: 'Reicht der Abrechnungszeitraum über zwei Kalenderjahre, fragt das Formular nach dem „Jahr der Zahlung (Steuer)“.' },
    ],
    result: [
      'Vor dem Wechsel entsteht ein Rumpfzeitraum. Seine Abrechnung muss zwölf Monate nach seinem Ende zugehen.',
      'Im Rumpfzeitraum rechnet der Vorschlag für die neue Vorauszahlung kalte Kosten nach Tagen hoch und Brennstoff nach Gradtagen, wenn die Brennstoffrechnung als „Brennstoff/Energie“ gekennzeichnet ist und einen Leistungszeitraum hat.',
      'Mietkonto und Steuer bleiben beim Kalenderjahr; die Steuerübersicht nimmt die Eigenanteile aus den Abrechnungen, die das Jahr berühren.',
    ],
    example: 'Umstellung ab Mai 2025: Der Rumpfzeitraum läuft vom 01.01. bis 30.04.2025 und muss bis 30.04.2026 abgerechnet sein. Die Grundsteuer 2025 über 480 € teilt Mietfuchs in 157,81 € für den Rumpf und 322,19 € für 2025/2026.',
    caveats: [
      { text: 'Eine Verkürzung des Abrechnungszeitraums braucht einen sachlichen Grund, etwa die Angleichung an den Messdienst. Legt Ihr Mietvertrag den Zeitraum fest, braucht die Umstellung die Zustimmung der Mieter. Länger als zwölf Monate darf kein Zeitraum sein.', norm: '§ 556 Abs. 3 Satz 1 BGB' },
      { text: 'Heizkosten müssen den Verbrauch im Abrechnungszeitraum abbilden; eine Gasrechnung über einen anderen Zeitraum teilt Mietfuchs nicht nach Tagen auf. Tragen Sie sie auf der Seite Heizkosten als Lieferung ein, grenzt Mietfuchs sie nach Zählerstand oder Gradtagen ab; sonst weist es darauf hin.', norm: 'BGH, Urteil vom 01.02.2012, VIII ZR 156/11' },
    ],
    gaps: [
      { text: 'Eine Gas- oder Fernwärmerechnung über einen anderen Zeitraum nach Gradtagen auf die Heizperiode abgrenzen; bis dahin weist Mietfuchs nur darauf hin.', issue: 97 },
    ],
    terms: ['billingPeriod', 'shortPeriod', 'accrualPrinciple'],
  },
  // Heizung PR 7 (#97, Durchsicht von #233): eine Versorgerrechnung über die Heizperiode hinaus.
  supplierInvoice: {
    title: 'Gasrechnung über die Heizperiode hinaus',
    applies: 'Ihr Versorger rechnet Gas, Fernwärme oder den Strom der Wärmepumpe über einen anderen Zeitraum ab als Ihre Heizperiode, etwa von März bis März, und Sie verteilen die Heizkosten selbst nach einem Schlüssel.',
    steps: [
      { page: 'stammdaten', text: 'Richten Sie in der Karte „Heizung“ die Heizanlage ein, falls noch nicht geschehen; bei der Frage, wer abrechnet, wählen Sie „Niemand“.' },
      { page: 'kosten', text: 'Erfassen Sie die Rechnung wie gewohnt mit „+ Kostenposition manuell erfassen“ und der Kostenart „Heizung und Warmwasser“, und zwar im Zeitraum, in dem die Rechnung endet.' },
      { page: 'heizkosten', text: 'Klicken Sie auf der Seite Heizkosten in der Karte „Lieferungen“ auf „Lieferung eintragen“, tragen Sie den Rechnungszeitraum laut Rechnung ein und, wenn die Rechnung sie ausweist, die festen Preisbestandteile und die CO₂-Angaben, dann „Lieferung speichern“.' },
      { page: 'heizkosten', text: 'Wählen Sie darunter bei „Welche Position gehört zu welcher Rechnung?“ an Ihrer Position die Lieferung. Ohne diese Verknüpfung grenzt Mietfuchs nichts ab und verteilt die Position ganz in ihrem Zeitraum.' },
      { page: 'zaehler', text: 'Genauer als nach Gradtagen wird es mit einem Zählerstand des Versorgungszählers zum Ende der Heizperiode; erfassen Sie ihn mit „Ablesung speichern“.' },
    ],
    result: [
      'Die Position bleibt in voller Höhe in ihrem Zeitraum. Der Teil der Heizperiode davor steht dort als eigene Zeile bei den Mietern, mit dem Schlüssel der Position, und hier als Gegenbuchung; über beide Zeiträume ist die Rechnung genau einmal verteilt.',
      'Fehlt beim Abschließen die Rechnung für einen Teil der Heizperiode, fragt Mietfuchs nach: abwarten, mit Vorbehalt schätzen oder ohne Schätzung abschließen.',
      'Die Abrechnung druckt den Block „Brennstoff“ mit dem Anteil jeder Rechnung und dem Verfahren.',
    ],
    example: 'Gasrechnung 15.03.2025–14.03.2026 über 6.500 €, Heizperiode Mai bis April, zwei Wohnungen mit 60 und 40 m² nach Wohnfläche: Nach Gradtagen gehören 848,71 ‰ in 2025/2026, das sind 5.516,61 € (Mieter A 3.309,97 €, Mieter B 2.206,64 €); 983,39 € gehören in 2024/2025 (Mieter A 590,03 €, Mieter B 393,36 €).',
    caveats: [
      { text: 'Umgelegt werden die Kosten des im Abrechnungszeitraum verbrauchten Brennstoffs, nicht der bezahlten Rechnungen; eine Abrechnung nach diesem Leistungsprinzip darf auf einer sachgerechten Schätzung beruhen.', norm: '§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 01.02.2012, VIII ZR 156/11, Rn. 14' },
      { text: 'Die Abrechnung muss dem Mieter bis zum Ablauf des zwölften Monats nach Ende des Abrechnungszeitraums zugehen; eine Nachforderung danach gibt es nur, wenn Sie die Verspätung nicht zu vertreten haben. Kommt die Rechnung des Versorgers spät, warten Sie mit dem Abschluss, solange die Frist läuft.', norm: '§ 556 Abs. 3 Satz 2 und 3 BGB' },
    ],
    gaps: [
      { text: 'Bei Etagenheizungen auf Ihren Vertrag ein gemeinsamer Gaszähler für mehrere Wohnungen; Mietfuchs braucht je Wohnung eine eigene Rechnung.', issue: 97 },
    ],
    terms: ['fuelDelivery', 'degreeDays', 'fixedPriceComponent', 'fuelEstimate'],
  },
  // Heizung PR 8 (#97, #99, Durchsicht von #237): Brennstoff mit Vorrat.
  stockFuel: {
    title: 'Heizöl, Flüssiggas, Pellets oder Holz mit Tank oder Lager',
    applies: 'Sie heizen mit Heizöl, Flüssiggas, Pellets, Holz oder Kohle, kaufen den Brennstoff in Lieferungen und verteilen die Heizkosten selbst nach einem Schlüssel. Nicht jede Lieferung wird im selben Jahr verbraucht.',
    steps: [
      { page: 'stammdaten', text: 'Richten Sie in der Karte „Heizung“ die Heizanlage mit ihrem Brennstoff ein; bei der Frage, wer abrechnet, wählen Sie „Niemand“.' },
      { page: 'kosten', text: 'Erfassen Sie jede Rechnung über eine Lieferung mit „+ Kostenposition manuell erfassen“ und der Kostenart „Heizung und Warmwasser“, im Zeitraum, in dem geliefert wurde.' },
      { page: 'heizkosten', text: 'Klicken Sie auf der Seite Heizkosten in der Karte „Lieferungen“ auf „Lieferung eintragen“, tragen Sie Lieferdatum, Menge und Einheit ein und, bei Heizöl, Flüssiggas und Kohle, die CO₂-Angaben laut Rechnung, dann „Lieferung speichern“.' },
      { page: 'heizkosten', text: 'Wählen Sie darunter bei „Welche Position gehört zu welcher Rechnung?“ an der Position die Lieferung. Aus der verknüpften Position nimmt Mietfuchs den Betrag der Lieferung.' },
      { page: 'heizkosten', text: 'Tragen Sie in der Karte „Vorrat“ den Endbestand ein, wie Sie ihn am Ende der Heizperiode abgelesen haben, und nur in der ersten Heizperiode auch den Anfangsbestand mit seinem Wert; danach übernimmt Mietfuchs den Endbestand der Vorperiode. Speichern Sie mit „Vorrat speichern“.' },
    ],
    result: [
      'Die Rechnungen bleiben Positionen in voller Höhe. Den Unterschied zwischen Bezahltem und Verbrauchtem tragen zwei Zeilen „aus dem Vorrat“ und „im Vorrat“ mit dem Schlüssel der Brennstoffposition; über die Jahre ist jede Lieferung genau einmal verteilt.',
      'Die Abrechnung druckt die „Bestandsrechnung Brennstoff“ mit Anfangsbestand, Lieferungen, Endbestand und Verbrauch.',
      'Bei Heizöl, Flüssiggas und Kohle teilt Mietfuchs die CO₂-Kosten nach dem verbrauchten Brennstoff auf.',
    ],
    example: 'Anfangsbestand 2.000 l für 1.900 €, Lieferungen 3.000 l für 3.150 € und 2.500 l für 2.500 €, Endbestand 1.800 l. Er stammt aus der jüngsten Lieferung und ist 1.800 € wert. Verbraucht wurden 5.750 €, bezahlt 5.650 €. Bei zwei Wohnungen mit 60 und 40 m² nach Wohnfläche tragen die Mieter 3.450 € und 2.300 € an Heizkosten.',
    caveats: [
      { text: `Umgelegt werden die Kosten der verbrauchten Brennstoffe und ihrer Lieferung, nicht der bezahlten Rechnungen. Eine Abrechnung nach Lieferungen ist nicht zulässig, und der Fehler lässt sich nicht durch die Kürzung um ${CUT} Prozent ausgleichen.`, norm: '§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 01.02.2012, VIII ZR 156/11' },
      { text: 'Wie der Endbestand zu bewerten ist, regelt die Heizkostenverordnung nicht. Mietfuchs rechnet, als sei das älteste Öl zuerst verbraucht worden, wie es die Kommentarliteratur und die Messdienste tun; der Endbestand hat dann die Preise der jüngsten Lieferungen.', norm: 'Kinne/Schach/Bieber-Kinne, BGB § 556 Rn. 121' },
      { text: 'Brennstoff, der vor dem 01.01.2023 in Rechnung gestellt wurde, trägt keine CO₂-Kosten; seine kg zählen aber für die Einstufung. Holz und Pellets sind keine Brennstoffe im Sinne des Brennstoffemissionshandels; für sie gibt es keine CO₂-Kosten aufzuteilen.', norm: '§ 11 Abs. 2 Satz 2, § 2 Abs. 1 CO2KostAufG; Anlage 1 BEHG' },
    ],
    gaps: [
      { text: 'Den Heizwert laut Rechnung liest die Belegauswertung nicht aus; für den Warmwasseranteil der eigenen Heizkostenabrechnung tragen Sie ihn an der Lieferung ein, sonst gilt hilfsweise der Wert der Heizkostenverordnung.', issue: 99 },
    ],
    terms: ['fuelStock', 'fuelDelivery', 'co2Split'],
  },
  // Heizung PR 9 (Durchsicht von #238, Recht I6): zweite Heizanlage, Etagenheizung, Heizung erneuert.
  heatingRenewed: {
    title: 'Heizung erneuert, zweite Heizanlage oder Etagenheizung',
    applies: 'Die Heizung wurde im Lauf eines Abrechnungszeitraums erneuert, etwa Öl gegen Gas; oder im Objekt heizen zwei Anlagen, etwa die Zentralheizung und eine Gastherme im Dachgeschoss; oder Thermen in den Wohnungen laufen über Ihren Gasvertrag.',
    steps: [
      { page: 'stammdaten', text: 'Wurde die Heizung erneuert, klicken Sie in der Karte „Heizung“ bei der bisherigen Anlage auf „Heizung erneuert (Kessel getauscht)“, wählen den Tag, an dem die neue in Betrieb ging, und ihren Brennstoff, dann „Tausch speichern“.' },
      { page: 'heizkosten', text: 'Ist noch Heizöl, Flüssiggas oder Pellets im Tank, tragen Sie bei der bisherigen Anlage in der Karte „Vorrat“ den Endbestand zum letzten Betriebstag ein und speichern mit „Vorrat speichern“.' },
      { page: 'stammdaten', text: 'Heizt eine zweite Anlage gleichzeitig, legen Sie sie mit „+ weitere Heizanlage“ an, geben beiden Anlagen einen Namen und ihre Wohnungen und sagen, ob sie im selben Gebäude steht.' },
      { page: 'kosten', text: 'Wählen Sie an jeder Heizposition unter „Heizanlage“ die Anlage, zu der die Rechnung gehört; Rechnungen einer Etagenheizung ordnen Sie mit dem Schlüssel „Direktzuordnung“ der Wohnung zu.' },
    ],
    result: [
      'Nach einem Tausch rechnet jede Anlage nur über ihre Betriebstage. Einen Restbestand übernimmt die neue Anlage, wenn sie mit demselben Brennstoff weiterheizt und Sie beim Tausch „Verheizt der neue Kessel den Brennstoff im Tank weiter?“ mit Ja beantworten; sonst tragen ihn die Mieter nicht, und er steht mit seinem Wert bei Ihnen.',
      'Eingestuft wird das Gebäude über den Ausstoß aller Anlagen, die im Jahr darin geheizt haben.',
      'Eine Heizposition, die über Wohnungen zweier Anlagen verteilt wird, meldet die Abrechnung als Fehler.',
    ],
    example: 'Ölheizung bis 30.06.2025, ab 01.07.2025 Gas, drei Wohnungen mit je 100 m² nach Wohnfläche. Anfangsbestand 2.000 l für 1.900 €, Lieferung 3.000 l für 3.150 €, Restbestand 500 l im Wert von 525 €. Die Mieter tragen 4.525 € Öl und die Gasrechnung über 1.500 €. Öl und Gas zusammen stießen 15.043,35 kg CO₂ aus, 50,1 kg je m²; Sie tragen 80 % der CO₂-Kosten.',
    caveats: [
      { text: 'Umgelegt werden die Kosten der verbrauchten Brennstoffe, nicht der Restbestand im Tank.', norm: '§ 7 Abs. 2 HeizkostenV' },
      { text: 'Eingestuft wird nach dem Ausstoß des Gebäudes pro Quadratmeter Wohnfläche und Jahr; mehrere Wohnungen mit gesonderter oder zentraler Versorgung in einem Gebäude zählen mit ihrer Gesamtwohnfläche. Wie mehrere Anlagen in einem Gebäude einzustufen sind, ist höchstrichterlich nicht geklärt; Mietfuchs stuft sie gemeinsam ein.', norm: '§ 5 Abs. 1 Satz 1 und 2 CO2KostAufG' },
      { text: 'Für Etagenheizungen gilt die Heizkostenverordnung nicht, und die Betriebskostenverordnung nennt bei ihnen nur Reinigung und Wartung. Ob Sie die Gaskosten umlegen dürfen, wenn der Gasvertrag auf Sie läuft, ist nicht geklärt; umgelegt werden dürfen Betriebskosten nur mit Vereinbarung im Mietvertrag.', norm: '§ 1 Abs. 1 HeizkostenV; § 2 Nr. 4 Buchstabe d BetrKV; § 556 Abs. 1 Satz 1 BGB' },
    ],
    gaps: [
      { text: 'Getrennte Heizkostenabrechnung (eigene Heizperiode mit eigener Vorauszahlung) zusammen mit einem Kesseltausch.', issue: 97 },
      { text: 'Lücken in den Gasrechnungen einer Etagenheizung je Wohnung erkennen und schätzen; heute zählt jede Rechnung der Anlage.', issue: 97 },
      { text: 'Ein gemeinsamer Gaszähler für mehrere Wohnungen mit Etagenheizung.', issue: 97 },
    ],
    terms: ['boilerSwap', 'perUnitHeating', 'heatingSystem', 'co2Stage'],
  },
} satisfies Record<string, Guide>

export type GuideId = keyof typeof GUIDE_DATA
// Nach außen mit dem allgemeinen Typ, damit Felder wie `page` oder `issue` überall lesbar sind.
export const GUIDES: Record<GuideId, Guide> = GUIDE_DATA
