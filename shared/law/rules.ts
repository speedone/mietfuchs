// Das Regelverzeichnis (#112), seit Heizung PR 1 Teil des Rechtsregisters (vorher
// server/src/rules.ts): Rechtsregeln, die die Berechnung anwendet, jeweils mit dem Zeitraum, in dem
// sie gelten. Eine Abrechnung rechnet nach dem Recht ihres Jahres und nicht nach dem von heute; wo
// eine Regel nur für einen Teil des Jahres gilt, sagt das `ruleCoverage`.
//
// Aufgenommen wird nur, was die Berechnung wirklich anwendet. Das Verzeichnis ist keine
// Rechtsbibliothek, sondern die Liste, gegen die eine Abrechnung geprüft wurde; deshalb steht
// sie als Rechtsstand in jeder Abrechnung und wird beim Abschließen mit eingefroren.
//
// Zahlen und Daten in Kurzfassung und Gültigkeit kommen aus den Parametern des Registers und
// stehen hier nicht noch einmal: So kann die Erklärung keine andere Zahl nennen als die Rechnung.
// Der Wortlaut ist derselbe wie vorher (server/test/law-wording.test.ts).
//
// ISO-Daten werden Zeichen für Zeichen verglichen, wie `compareText` in calc.ts.
//
// Ein eigenes Stichtagsdatum hat das Verzeichnis nicht mehr (Durchsicht von #221, M4): Es gilt
// `LAW_AS_OF` aus register.ts. Wer eine Regel ändert oder ergänzt, prüft die Parameter, aus denen sie
// liest, setzt deren `retrieved` und `LAW_AS_OF` auf den Tag der Durchsicht (#110).
import { betrkvTvSignal } from './bgb-betrkv.ts'
import { co2CutMissing, co2FirstPeriodStart } from './co2kostaufg.ts'
import { hkvConsumptionShare, hkvConsumptionShareForced, hkvCutNotByConsumption, hkvCutRemoteReading, hkvEstimateThreshold, hkvRemoteReadingRetrofit } from './heizkostenv.ts'
import { dayBefore, germanDate, LAW_AS_OF, onlyVersion, valueAt } from './register.ts'

// Die Fassungen, aus denen die Regeln ihre Grenzen nehmen. Bekommt einer der beiden Parameter eine
// zweite Fassung, muss die Regel entscheiden, welche sie erklärt; bis dahin bricht `onlyVersion`
// beim Laden ab.
const tv = onlyVersion(betrkvTvSignal)
const retrofit = onlyVersion(hkvRemoteReadingRetrofit)
if (!tv.validTo || !retrofit.validFrom) throw new Error('Rechtsregister: Kabelregel oder Fernablesbarkeit ohne Grenze')
const TV_UNTIL = tv.validTo
const TV_NEW_FROM = germanDate(tv.value.newSystemsFrom)
const RETROFIT_FROM = retrofit.validFrom
const share = valueAt(hkvConsumptionShare, LAW_AS_OF)
const cut = valueAt(hkvCutNotByConsumption, LAW_AS_OF)
const remoteCut = valueAt(hkvCutRemoteReading, LAW_AS_OF)
const forcedShare = valueAt(hkvConsumptionShareForced, LAW_AS_OF)
const estimateThreshold = valueAt(hkvEstimateThreshold, LAW_AS_OF)
const CO2_FROM = co2FirstPeriodStart()
const co2Cut = valueAt(co2CutMissing, LAW_AS_OF)

export type Rule = {
  code: string
  title: string
  // Rechtsgrundlage, wie sie ein Mensch nachschlägt
  norm: string
  // in einfachen Worten, ein bis zwei Sätze
  summary: string
  // ISO-Daten, inklusive; fehlt eine Grenze, gilt die Regel in diese Richtung unbegrenzt
  validFrom?: string
  validTo?: string
}

export const RULES: readonly Rule[] = [
  {
    code: 'tv-signal',
    title: 'Kabelfernsehen über die Nebenkosten',
    norm: '§ 2 Satz 1 Nr. 15 und Satz 2 BetrKV',
    summary:
      `Die Gebühren für das TV-Signal eines Kabelanschlusses und die Grundgebühren eines Breitbandanschlusses durften bis zum ${germanDate(TV_UNTIL)} ` +
      `als Betriebskosten umgelegt werden, und zwar nur bei Anlagen, die vor dem ${TV_NEW_FROM} errichtet wurden. Seitdem nicht mehr. ` +
      `Bei Anlagen, die vor dem ${TV_NEW_FROM} errichtet wurden, bleiben umlagefähig: bei einer Gemeinschaftsantenne des Hauses der ` +
      'Betriebsstrom sowie Prüfung und Einstellung durch eine Fachkraft, bei einer Breitband-Verteilanlage nur der Betriebsstrom. ' +
      'Bei später errichteten Anlagen ist davon nichts umlagefähig, ausgenommen eine reine Glasfaser-Verteilanlage (Betriebsstrom und Bereitstellungsentgelt).',
    validTo: TV_UNTIL,
  },
  {
    code: 'heating-flat-rate',
    title: 'Pauschale oder Warmmiete bei Heizung und Warmwasser',
    norm: '§§ 2, 12 Abs. 1 HeizkostenV; BGH, Urteil vom 19.07.2006, VIII ZR 212/05',
    summary:
      'Heizung und Warmwasser müssen nach Verbrauch abgerechnet werden; die Heizkostenverordnung geht einer Pauschale oder Warmmiete vor. ' +
      'Die Vereinbarung wird dann nicht angewendet: Der Heizanteil gilt als Vorauszahlung, über die nach Verbrauch abzurechnen ist. ' +
      'Nur im Gebäude mit höchstens zwei Wohnungen, von denen der Vermieter eine selbst bewohnt, und in den Fällen des § 11 darf etwas anderes vereinbart werden. ' +
      `Wird nicht nach Verbrauch abgerechnet, darf der Mieter seinen Anteil um ${cut} % kürzen.`,
  },
  {
    code: 'heating-consumption',
    title: 'Heizung und Warmwasser nach Verbrauch',
    norm: '§§ 2, 7 Abs. 1, 8 Abs. 1, 12 Abs. 1 HeizkostenV',
    summary:
      `Von den Kosten der zentralen Heizungs- und Warmwasseranlage sind mindestens ${share.min} und höchstens ${share.max} % nach dem erfassten Verbrauch zu verteilen, der Rest nach Wohn- oder Nutzfläche (bei der Heizung auch nach umbautem Raum). ` +
      `Wird nicht verbrauchsabhängig abgerechnet, darf der Mieter seinen Anteil um ${cut} % kürzen. ` +
      'Im Gebäude mit höchstens zwei Wohnungen, von denen der Vermieter eine selbst bewohnt, darf anderes vereinbart werden; ohne eine solche Vereinbarung gilt die Verordnung auch dort.',
  },
  {
    // Durchsicht vom 02.10.2026 (#110): Die Nachrüstfrist des § 5 Abs. 3 endet am 31.12.2026. Für
    // Geräte, die nach dem 01.12.2021 eingebaut wurden, gilt die Pflicht in der Regel schon seit dem
    // Einbau (§ 5 Abs. 2), und die monatliche Information nach § 6a schulden Vermieter seit 2022;
    // beides trägt schon die Kürzung um 3 %. Die Regel beginnt trotzdem erst 2027, weil sie an der
    // Nachrüstfrist hängt, die alle Geräte erfasst. Die früheren Pflichten betreffen nur neu
    // eingebaute Geräte und den Versand der Information, und beides erfasst Mietfuchs nicht: Ein
    // Hinweis ab 2022 wäre in jedem Haus erschienen, ohne dass sich sagen ließe, ob er zutrifft.
    // Wortlaut geprüft auf
    // https://www.gesetze-im-internet.de/heizkostenv/ (Stand Art. 3 G v. 16.10.2023 I Nr. 280).
    code: 'heating-remote-reading',
    title: 'Fernablesbare Zähler und monatliche Verbrauchsinformation',
    norm: '§ 5 Abs. 2 und 3, § 6a, § 12 Abs. 1 Satz 2 und 3 HeizkostenV',
    summary:
      `Zähler und Heizkostenverteiler für Heizung und Warmwasser müssen fernablesbar sein: die nach dem ${germanDate(retrofit.value.installedUpTo)} eingebauten sofort, alle übrigen ab dem ${germanDate(RETROFIT_FROM)} (Nachrüstfrist bis ${germanDate(dayBefore(RETROFIT_FROM))}). ` +
      'Sind fernablesbare Geräte eingebaut, stehen den Mietern monatliche Verbrauchsinformationen zu. ' +
      `Fehlt das eine oder das andere, darf der Mieter seinen Anteil an den Heizkosten um ${remoteCut} % kürzen. ` +
      'Ausgenommen sind Fälle, in denen die Nachrüstung technisch nicht möglich ist, einen unangemessenen Aufwand bedeutet oder in sonstiger Weise eine unbillige Härte wäre.',
    // Der Zeitpunkt kommt aus `hkv.remote-reading.retrofit` (N6 der dritten Fassung).
    validFrom: RETROFIT_FROM,
  },
  {
    // Heizung PR 6 (#97): Wortlaut §§ 5, 7, 11 und Anlage CO2KostAufG geprüft am 05.10.2026. Bei
    // Nichtwohngebäuden (§ 8) und Einschränkungen (§ 9) gelten eigene Regeln; sie kommen mit PR 7.
    code: 'co2-split',
    title: 'Aufteilung der CO₂-Kosten',
    norm: '§§ 5, 7, 11 CO2KostAufG',
    summary:
      `Für Abrechnungszeiträume, die am oder nach dem ${germanDate(CO2_FROM)} beginnen, werden bei Wohngebäuden die CO₂-Kosten der Heizung zwischen Vermieter und Mieter aufgeteilt, ` +
      'und zwar nach dem CO₂-Ausstoß des Gebäudes je Quadratmeter Wohnfläche und Jahr: Je höher der Ausstoß, desto größer der Anteil des Vermieters (Stufentabelle in der Anlage des Gesetzes). ' +
      `Die Heizkostenabrechnung muss den Anteil des Mieters, die Einstufung und die Berechnungsgrundlagen ausweisen; fehlt das, darf der Mieter seinen Anteil an den Heizkosten um ${co2Cut} % kürzen.`,
    validFrom: CO2_FROM,
  },
  {
    // Heizung PR 6 (#211): § 9 Abs. 2 HeizkostenV im Wortlaut geprüft am 05.10.2026; das Urteil
    // kürzt den gesamten Anteil an Heiz- und Warmwasserkosten (Entwurf R-A6, G-B9).
    code: 'heating-dhw-split',
    title: 'Warmwasser mit Wärmezähler',
    norm: '§ 9 Abs. 2 Satz 1, § 12 Abs. 1 Satz 1 HeizkostenV; BGH, Urteil vom 12.01.2022, VIII ZR 151/20',
    summary:
      'Versorgt die Heizung auch das Warmwasser, ist die Wärme für das Warmwasser mit einem Wärmezähler zu messen. ' +
      'Die Formel nach dem Warmwasserverbrauch darf nur verwenden, wer die Wärmemenge nur mit unzumutbar hohem Aufwand messen könnte; die Formel nach der Wohnfläche nur, wenn weder die Wärmemenge noch das Volumen des verbrauchten Warmwassers gemessen werden kann. ' +
      `Wird ohne diesen Grund nach einer Formel abgerechnet, darf der Mieter seinen gesamten Anteil an den Heiz- und Warmwasserkosten um ${cut} % kürzen.`,
  },
  {
    // Heizung PR 7 (#97): § 8 CO2KostAufG im Wortlaut geprüft am 05.10.2026.
    code: 'co2-non-residential',
    title: 'CO₂-Kosten im Nichtwohngebäude',
    norm: '§ 8 CO2KostAufG',
    summary:
      'Dient ein Gebäude nach seiner Zweckbestimmung nicht überwiegend dem Wohnen, gilt keine Stufentabelle: ' +
      'Vereinbarungen, nach denen der Mieter mehr als die Hälfte der CO₂-Kosten trägt, sind unwirksam; der Vermieter trägt also mindestens die Hälfte.',
    validFrom: CO2_FROM,
  },
  {
    // Heizung PR 7 (#97): § 9 CO2KostAufG im Wortlaut geprüft am 05.10.2026.
    code: 'co2-restriction',
    title: 'CO₂-Kosten bei Beschränkungen',
    norm: '§ 9 CO2KostAufG',
    summary:
      'Stehen öffentlich-rechtliche Vorgaben (etwa Denkmalschutz, Anschluss- und Benutzungszwang, Erhaltungssatzung) einer wesentlichen energetischen Verbesserung des Gebäudes oder seiner Wärmeversorgung entgegen, ' +
      'wird der Anteil des Vermieters um die Hälfte gekürzt; stehen sie beidem entgegen, werden die CO₂-Kosten nicht aufgeteilt. ' +
      'Darauf berufen kann sich der Vermieter nur, wenn er dem Mieter die Umstände nachweist.',
    validFrom: CO2_FROM,
  },
  {
    // Heizung PR 7 (#97): § 7 Abs. 2 HeizkostenV im Wortlaut, BGH VIII ZR 156/11 Rn. 14 geprüft am
    // 05.10.2026 (Entwurf 2, 3.2, 8.2).
    code: 'heating-consumed-fuel',
    title: 'Kosten des verbrauchten Brennstoffs',
    norm: '§ 7 Abs. 2 HeizkostenV; BGH, Urteil vom 01.02.2012, VIII ZR 156/11',
    summary:
      'Umgelegt werden die Kosten der im Abrechnungszeitraum verbrauchten Brennstoffe, nicht der bezahlten Rechnungen. ' +
      'Reicht eine Rechnung des Versorgers über das Ende des Zeitraums hinaus, ist sie abzugrenzen; eine sachgerechte Schätzung ist dabei zulässig. ' +
      // Heizung PR 8 (#97, #99): Vorrat. Die Bewertung des Endbestands ist Praxis der Messdienste ([M] Minol).
      'Bei Heizöl, Flüssiggas, Pellets, Holz und Kohle ergibt sich der Verbrauch aus Anfangsbestand + Lieferungen − Endbestand. ' +
      'Die Bewertung des Endbestands regelt die HeizkostenV nicht; Mietfuchs rechnet, dass das Älteste zuerst verbraucht wird (Kinne/Schach/Bieber-Kinne, BGB § 556 Rn. 121), ' +
      'und bewertet den Endbestand zu den Preisen der jüngsten Lieferungen. Eine Abrechnung nach Lieferungen ist nicht zulässig und lässt sich nicht durch die Kürzung nach § 12 Abs. 1 HeizkostenV ausgleichen.',
  },
  // Heizung PR 10 (#99, Entwurf 10.2): die eigene Heizkostenabrechnung. Wortlaut gelesen am
  // 05.10.2026 auf gesetze-im-internet.de (HeizkostenV §§ 6 bis 9b in der Fassung Art. 3 G v.
  // 16.10.2023).
  {
    code: 'heating-own-settlement',
    title: 'Eigene Heizkostenabrechnung nach der Heizkostenverordnung',
    norm: '§§ 6 bis 9 HeizkostenV',
    summary:
      `Von den Kosten der Heizung und des Warmwassers sind mindestens ${share.min} und höchstens ${share.max} % nach dem erfassten Verbrauch zu verteilen; höhere Sätze gehen nur mit einer Vereinbarung (§ 10). Der Rest geht bei der Heizung nach Wohn- oder Nutzfläche oder der beheizten Fläche, beim Warmwasser nach Wohn- oder Nutzfläche. Die Verordnung lässt auch den umbauten Raum zu (§ 7 Abs. 1 Satz 5, § 8 Abs. 1); Mietfuchs rechnet mit der Fläche. ` +
      'Bereitet die Heizung auch das Warmwasser, wird der Anteil des Warmwassers mit einem Wärmezähler gemessen. ' +
      `In Gebäuden mit Öl- oder Gasheizung, die das Anforderungsniveau der Wärmeschutzverordnung vom 16. August 1994 nicht erfüllen und deren freiliegende Leitungen überwiegend gedämmt sind, sind es bei der Heizung ${forcedShare} % (§ 7 Abs. 1 Satz 2); mehr nur mit einer Vereinbarung (§ 10). ` +
      'Umgelegt werden die Kosten des verbrauchten Brennstoffs, nicht der gelieferte.',
  },
  {
    code: 'heating-tenant-change',
    title: 'Mieterwechsel bei Heizung und Warmwasser',
    norm: '§ 9b HeizkostenV; BGH, Urteil vom 14.11.2007, VIII ZR 19/07',
    summary:
      'Zieht ein Mieter während des Abrechnungszeitraums aus, ist eine Zwischenablesung vorzunehmen. Die Verbrauchskosten werden nach ihr aufgeteilt, die übrigen Heizkosten nach Gradtagszahlen oder zeitanteilig, die übrigen Warmwasserkosten zeitanteilig. ' +
      'Ist die Zwischenablesung nicht möglich, werden die gesamten Kosten so aufgeteilt. Abweichende Vereinbarungen bleiben unberührt. ' +
      'Die Kosten der Zwischenablesung trägt der Vermieter, soweit nichts anderes vereinbart ist.',
  },
  {
    code: 'heating-reading-date',
    title: 'Ablesung neben dem Stichtag',
    norm: 'OLG Schleswig, Rechtsentscheid vom 04.10.1990, 4 RE-Miet 1/88; § 9a HeizkostenV; BGH, Urteil vom 16.11.2005, VIII ZR 373/04',
    summary:
      'Abgelesen wird zum Ende des Abrechnungszeitraums oder zum Wechsel. Eine Ablesung einige Tage daneben ist unschädlich, wenn in der Zwischenzeit wenig verbraucht wird; zurückgerechnet wird nicht. ' +
      'Geschätzt werden darf nur, wenn ein Gerät ausfällt oder ein anderer zwingender Grund vorliegt, und zwingend ist ein Grund erst, wenn sich der Fehler nicht mehr beheben lässt.',
  },
  {
    code: 'heating-key-change',
    title: 'Wechsel des Anteils nach Verbrauch',
    norm: '§ 6 Abs. 4 HeizkostenV',
    summary:
      'Den Anteil nach Verbrauch und die übrigen Maßstäbe wählt der Gebäudeeigentümer. Für künftige Abrechnungszeiträume ändern darf er sie durch Erklärung gegenüber den Nutzern bei Einführung einer Vorerfassung nach Nutzergruppen, nach baulichen Maßnahmen, die nachhaltig Heizenergie einsparen, oder aus anderen sachgerechten Gründen nach ihrer erstmaligen Bestimmung. ' +
      'Festlegung und Änderung sind nur mit Wirkung zum Beginn eines Abrechnungszeitraums zulässig. Den vorgeschriebenen Anteil nach § 7 Abs. 1 Satz 2 wählt er nicht, er gilt.',
  },
  // Heizung PR 13 (#99, Entwurf 10.2): Schätzung bei Geräteausfall. Wortlaut gelesen am 05.10.2026 auf
  // gesetze-im-internet.de.
  {
    code: 'heating-estimate',
    title: 'Schätzung bei Geräteausfall',
    norm: '§ 9a HeizkostenV; BGH, Urteil vom 16.11.2005, VIII ZR 373/04',
    summary:
      'Kann der Verbrauch eines Nutzers wegen Geräteausfalls oder aus einem anderen zwingenden Grund nicht ordnungsgemäß erfasst werden, ermittelt ihn der Gebäudeeigentümer: aus dem Verbrauch der betroffenen Räume in vergleichbaren Zeiträumen, aus dem Verbrauch vergleichbarer anderer Räume im selben Abrechnungszeitraum oder aus dem Durchschnittsverbrauch des Gebäudes oder der Nutzergruppe. ' +
      'Der so ermittelte Verbrauch tritt an die Stelle des erfassten. Auch ein Ablesefehler ist ein zwingender Grund, wenn sich der Wert nicht mehr ermitteln lässt; im vom BGH entschiedenen Fall war die Ablesung nicht nachholbar. Eine so erstellte Abrechnung kann nicht nach § 12 gekürzt werden; der BGH hat die Kürzung dort verneint. ' +
      `Betrifft die Schätzung mehr als ${estimateThreshold} % der für die Verteilung maßgeblichen Fläche, werden die Kosten ausschließlich nach der Fläche verteilt. ` +
      // Durchsicht von #242, R-I5/G-M8: zwei Festlegungen, die die Verordnung nicht ausdrücklich regelt.
      'Mietfuchs zählt dafür die ganze Fläche einer Wohnung, auch wenn nur ein Teil der Heizperiode geschätzt ist, und prüft Heizung und Warmwasser getrennt (Auslegung von Mietfuchs).',
  },
]

function ruleByCode(code: string): Rule {
  const rule = RULES.find((r) => r.code === code)
  // Ein unbekannter Code ist ein Tippfehler im Programm; eine stille Antwort ließe die Regel
  // unbemerkt nie greifen.
  if (!rule) throw new Error(`Unbekannte Regel „${code}“`)
  return rule
}

// Regeln, deren Gültigkeit den Zeitraum [from, to] berührt, in der Reihenfolge des Verzeichnisses.
export function rulesFor(from: string, to: string): Rule[] {
  return RULES.filter((r) => (!r.validFrom || r.validFrom <= to) && (!r.validTo || r.validTo >= from))
}

// Gilt die Regel im ganzen Zeitraum, in einem Teil davon oder gar nicht?
export function ruleCoverage(code: string, from: string, to: string): 'full' | 'partial' | 'none' {
  const rule = ruleByCode(code)
  if (!rulesFor(from, to).includes(rule)) return 'none'
  const startsInside = rule.validFrom !== undefined && rule.validFrom > from
  const endsInside = rule.validTo !== undefined && rule.validTo < to
  return startsInside || endsInside ? 'partial' : 'full'
}
