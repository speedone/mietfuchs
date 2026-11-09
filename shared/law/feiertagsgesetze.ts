// Gesetzliche Feiertage der Länder im Rechtsregister. Je Feiertag ein Parameter: Tag im Jahr, die Länder,
// in denen er landesweit gilt, und die Länder, in denen er nur in einzelnen Gemeinden gilt. Was ein Land
// ändert (Frauentag in Berlin ab 2019, Reformationstag im Norden ab 2018), ist eine neue Fassung; einmalige
// Feiertage sind eine Fassung von genau einem Tag. Gelesen werden sie von shared/holidays.ts.
//
// **Warum im Register und nicht in einer eigenen Tabelle.** Es sind Rechtswerte mit Gültigkeit und
// Fundstelle, und sie ändern sich durch Gesetz. Im Register gelten dieselben Sicherungen wie für jeden
// anderen Wert: lückenlose Fassungen, jede ausgelieferte Fassung in law-history.test.ts festgehalten,
// Prüfstand je Fassung und die Release-Sperre. Eine zweite Tabelle müsste das alles nachbauen.
//
// `eventDate`: gefragt wird am Tag des Feiertags. Die Grenzen der Fassungen sind Tage des Inkrafttretens,
// wo sie gelesen sind; wo mehrere Länder in einem Jahr nachzogen, die Grenze des letzten (alle vor dem
// Feiertag). `day`: 'MM-TT', 'O±n' (Tage nach Ostersonntag) oder 'repentance' (Buß- und Bettag, der
// Mittwoch vor dem 23. November); er ist in allen Fassungen eines Parameters derselbe (law.test.ts).
//
// **Prüfstand.** `checked` nur, wo der Wortlaut an einer amtlichen Fundstelle gelesen ist (Gesetz- und
// Verordnungsblatt, amtliches Portal). `adopted`, wo ein Wert für mehrere Länder gilt und nicht jedes
// Landesgesetz gelesen ist, oder wo nur eine nichtamtliche Sammlung erreichbar war; die Fundstelle sagt
// dann, was gelesen ist, und der Wert deckt sich mit zwei unabhängigen Quellen: der festen Vergleichsliste
// der Python-Bibliothek holidays 0.104 (server/test/fixtures/holidays/, holidays.test.ts) und der
// npm-Bibliothek date-holidays (holidays-date-holidays.test.ts, nur im Test, monatlich von Dependabot
// gehoben). „nach den Vergleichslisten“ in einer Fundstelle meint beide. Gelesen am 15.10.2026.
//
// **Die Feiertagslisten der Länder (#334).** Jede geltende Fassung sagt etwas über alle 16 Länder: wo der
// Tag gilt und wo nicht. `checked` wird sie deshalb erst, wenn die Liste jedes Landes in der geltenden
// Fassung amtlich gelesen ist. `STATE_HOLIDAY_LAW` hält je Land fest, was gelesen ist (Vorschrift, Fundstelle,
// Kette der Änderungen, Quelle), `STATE_HOLIDAY_LAW_UNREAD`, was fehlt und warum. Die geltenden Fassungen
// holen ihre Quelle über `fromStateLists`, auch die nur eines Landes („nur in Berlin“ heißt „in keinem
// anderen Land“); ausgenommen ist der Tag der Deutschen Einheit (Einigungsvertrag, Bundesrecht). Ältere
// Fassungen (bis 2018, Frauentag vor 2019) bleiben, wie sie sind. Gelesen am 07.11.2026. Die juris-Portale der Länder liefern einem Browser ohne Fenster nichts
// (Antwort 204); gelesen ist deshalb im Gesetz- und Verordnungsblatt (oft über die Parlamentsdokumentation
// des Landtags) oder in einem anderen amtlichen Portal. Rheinland-Pfalz und Sachsen-Anhalt sind am 08.11.2026
// nachgelesen, über Regierungsentwurf, Beschlussempfehlung und Plenarprotokoll im Landtag (Wortlaut der
// beschlossenen Fassung) und die Änderungsgesetze; `retrieved` der geltenden Fassungen bleibt der Rechtsstand
// vom 07.11.2026, solange Bremen und Hamburg offen sind und die Fassungen `adopted` bleiben.
import type { LawParam, Source } from './register.ts'
import type { FederalState } from '../types.ts'
import { isFederalState, STATE_CODES, stateName } from '../states.ts'

export type HolidayValue = {
  readonly day: string
  readonly states: readonly FederalState[]
  // Land → wo der Feiertag dort gilt, in Worten. Er gilt dann nur in einzelnen Gemeinden.
  readonly local: { readonly [state: string]: string }
}

const RETRIEVED = '2026-10-15'
const READ_STATE_LISTS = '2026-11-07'
const ALL = STATE_CODES
const NORTH_BEFORE: readonly FederalState[] = ['BB', 'MV', 'SN', 'ST', 'TH']
const NORTH_AFTER: readonly FederalState[] = ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']

const checked = (cite: string, url: string): Source => ({ rank: 'law', cite, url, retrieved: RETRIEVED, checked: 'checked' })
// Jede übernommene Fassung nennt den Abgleich mit beiden Vergleichslisten.
const CROSS_CHECK = 'abgeglichen mit den Vergleichslisten (python-holidays und date-holidays)'
const adopted = (cite: string, url: string): Source => ({
  rank: 'law', cite: cite.includes('Vergleichslisten') ? cite : `${cite}; ${CROSS_CHECK}`, url, retrieved: RETRIEVED, checked: 'adopted',
})

const URL_SN = 'https://www.revosax.sachsen.de/vorschrift/3997'
const URL_BY = 'https://www.gesetze-bayern.de/Content/Document/BayFTG-1'
const URL_BE_2019 = 'https://pardok.parlament-berlin.de/starweb/adis/citat/VT/18/gvbl/g19030022.pdf'
const URL_BE_2024 = 'https://pardok.parlament-berlin.de/starweb/adis/citat/VT/19/gvbl/g24280460.pdf'
const URL_MV_2022 = 'https://www.dokumentation.landtag-mv.de/parldok/dokument/53736/gesetz_und_verordnungsblatt_31_2022.pdf'
const URL_HB = 'https://www.transparenz.bremen.de/sixcms/detail.php?gsid=bremen2014_tp.c.118553.de&template=00_html_to_pdf_d'

// ---------- Die Listen der Länder, amtlich gelesen am 07.11.2026 ----------

export type StateHolidayLaw = { readonly cite: string; readonly url: string }

// Je Land die Vorschrift mit der Liste der gesetzlichen Feiertage in der geltenden Fassung und wo sie
// gelesen ist. Wo es keine amtliche Gesamtfassung gibt, ist sie aus dem Stammgesetz oder der
// Neubekanntmachung und den Änderungen zusammengesetzt, jede im Gesetzblatt gelesen; dass später nichts
// die Liste berührt hat, belegen die Eingangsformeln späterer Gesetze oder Entwürfe („zuletzt geändert
// durch …“).
export const STATE_HOLIDAY_LAW: { readonly [S in FederalState]?: StateHolidayLaw } = {
  BW: { cite: '§ 1 FTG i. d. F. vom 08.05.1995 (GBl. S. 450); danach nur § 1a (31.10.2017 einmalig, G v. 25.11.2014, GBl. S. 548) und §§ 8 ff. (G v. 01.12.2015, GBl. S. 1034); 3. Oktober nach Art. 2 Abs. 2 Einigungsvertrag', url: 'https://www.landtag-bw.de/files/live/sites/LTBW/files/dokumente/gesetzblaetter/1995/GBl199517.pdf' },
  BY: { cite: 'Art. 1 Abs. 1 bis 3 FTG (BayRS 1131-3-I), Fassung ab 01.08.2013', url: URL_BY },
  BE: { cite: '§ 1 Abs. 1 FeiertG vom 28.10.1954 (GVBl. S. 615): geltende Fassung nach der Gegenüberstellung der Senatsvorlage Drs. 19/1359, geändert durch G v. 10.07.2024 (GVBl. S. 460)', url: 'https://pardok.parlament-berlin.de/starweb/adis/citat/VT/19/DruckSachen/d19-1359.pdf' },
  BB: { cite: '§ 2 Abs. 1 FTG vom 21.03.1991, zuletzt geändert durch G vom 30.04.2015 (GVBl. I Nr. 13)', url: 'https://bravors.brandenburg.de/gesetze/ftg_2015' },
  HE: { cite: '§ 1 Abs. 1 HFeiertagsG i. d. F. vom 29.12.1971 (GVBl. 1971 I S. 344), Nr. 8 und 9 i. d. F. des G v. 11.10.1994 (GVBl. I S. 596), in Kraft am 31.12.1994; Nr. 1 bis 7 im GVBl. 1971 (https://starweb.hessen.de/cache/GVBL/1971/00036.pdf); die Änderungen 1974, 1997, 2010 und 2012 (GVBl. S. 622) berühren § 1 nicht', url: 'https://starweb.hessen.de/cache/GVBL/1994/00025.pdf' },
  MV: { cite: '§ 2 Abs. 1 FTG M-V vom 18.06.1992 (GVOBl. S. 342); Nr. 9 (Buß- und Bettag) gestrichen durch G v. 20.12.1994 (GVOBl. S. 1055) ab 01.01.1995; Frauentag als Nr. 2 durch G v. 07.07.2022 (GVOBl. S. 427); Neubekanntmachung vom 08.03.2002 (GVOBl. S. 145); die Änderungen 2001, 2004, 2012 und 2021 (Art. 2 G v. 21.06.2021, GVOBl. S. 1010, 1016) berühren § 2 Abs. 1 nicht (Landtagsdrucksachen 3/2336, 4/1246, 6/1119, 7/5972); GVOBl. 1994 S. 1055 unter https://www.dokumentation.landtag-mv.de/parldok/dokument/11267', url: 'https://www.dokumentation.landtag-mv.de/parldok/dokument/3415' },
  NI: { cite: '§ 2 Abs. 1 NFeiertagsG i. d. F. vom 07.03.1995, zuletzt geändert durch G vom 22.06.2018 (Nds. GVBl. S. 123)', url: 'https://voris.wolterskluwer-online.de/browse/document/f74bc6e7-6ded-3c2c-9afb-b34620456e56' },
  NW: { cite: '§ 2 Abs. 1 FTG NW i. d. F. der Bekanntmachung vom 23.04.1989 (GV. NW. S. 222), zuletzt geändert durch G v. 20.12.1994 (GV. NW. S. 1114)', url: 'https://recht.nrw.de/lrgv/gesetz/01012000-bekanntmachung-der-neufassung-des-gesetzes-ueber-die-sonn-und-feiertage' },
  RP: { cite: '§ 2 Abs. 1 LFtG vom 15.07.1970 (GVBl. S. 225), Wortlaut des Regierungsentwurfs Drs. VI/1743, in zweiter Lesung nur in §§ 10 und 14 geändert (Drs. VI/2000) und am 08.07.1970 einstimmig angenommen (Plenarprotokoll 6/66); Nr. 8 Klammerzusatz „(3. Oktober)“ durch Art. 2 G v. 08.06.1993 (GVBl. S. 314; Drs. 12/2542, Beschlussempfehlung 12/3004 ändert Art. 2 nicht); Nr. 10 (Buß- und Bettag) gestrichen und Nr. 11 wird Nr. 10 durch G v. 20.12.1994 (GVBl. S. 474; Drs. 12/5573, Beschlussempfehlung 12/5754 fügt nur § 9 Abs. 2 an); die Änderungen 2003 (§§ 4, 5; Drs. 14/2221, 14/2463) und Art. 2 G v. 27.10.2009 (GVBl. S. 358, § 10; Drs. 15/3694, 15/3832) berühren § 2 nicht, zuletzt geändert 2009 nach den Eingangsformeln von Drs. 16/4671 und 17/4564; Drucksachen unter https://dokumente.landtag.rlp.de/landtag/drucksachen/', url: 'https://dokumente.landtag.rlp.de/landtag/drucksachen/1743-06.pdf' },
  SL: { cite: '§ 2 Abs. 1 SFG vom 18.02.1976 (Amtsbl. S. 213), geändert durch G Nr. 1289 vom 08.04.1992 (Amtsbl. S. 510) und G Nr. 1344 vom 14.12.1994 (Amtsbl. 1995 S. 18); die späteren Änderungen bis zum G vom 13.10.2015 (Amtsbl. I S. 790) berühren die Liste nicht; Änderungen unter https://www.amtsblatt.uni-saarland.de/hefte/1992/1992-022.pdf und https://www.amtsblatt.uni-saarland.de/hefte/1995/1995-002.pdf', url: 'https://www.amtsblatt.uni-saarland.de/hefte/1976/1976-013.pdf' },
  SH: { cite: '§ 2 Abs. 1 SFTG vom 28.06.2004 (GVOBl. S. 213), Wortlaut nach der Beschlussempfehlung Drs. 15/3444 (Entwurf unverändert); Nr. 8 „31. Oktober - Reformationstag -“ durch G v. 21.03.2018 (GVOBl. S. 69), in Kraft am 30.03.2018; zuletzt geändert 2018 nach dem Zitat im GVOBl. 2022', url: 'https://verkuendungsportal.schleswig-holstein.de/mm/gvobl_jahrgang_2018/GVOBl_2018.pdf' },
  SN: { cite: '§ 1 Abs. 1 SächsSFG, Stand 07.05.2025; Fronleichnam nach der Fronleichnamsverordnung vom 04.05.1993, geändert durch VO vom 30.05.1995 (SächsGVBl. S. 160)', url: URL_SN },
  ST: { cite: '§ 2 FeiertG LSA vom 22.05.1992 (GVBl. S. 356) in der Fassung der Beschlussempfehlung Drs. 1/1339, am 09.04.1992 so angenommen (Plenarprotokoll 1/31; Änderungsantrag Drs. 1/1366 ohne Heilige Drei Könige mit 34 zu 39 Stimmen abgelehnt); Nr. 10 (Buß- und Bettag) aufgehoben durch G v. 16.12.1994 (GVBl. S. 1044; Drs. 2/245, Beschlussempfehlung 2/401 unverändert), in Kraft am 01.01.1995; Änderungen bis 1994 nach der Genese in Drs. 3/5033; die Änderungen 2001 (§ 8), 2003 (§§ 3, 3a), § 13 Abs. 1 G v. 22.11.2006 (GVBl. S. 528; Beschlussempfehlung 5/323: § 9) und Art. 5 G v. 04.05.2026 (GVBl. S. 178; Beschlussempfehlung 8/6871: §§ 1, 2a, 5) berühren § 2 nicht; die Neubekanntmachung vom 25.08.2004 (GVBl. S. 538) ist nicht gelesen; Drucksachen unter https://padoka.landtag.sachsen-anhalt.de/files/drs/', url: 'https://padoka.landtag.sachsen-anhalt.de/files/drs/wp1/drs/d1339.pdf' },
  TH: { cite: '§ 2 Abs. 1 ThürFGtG i. d. F. des Dritten Änderungsgesetzes vom 19.03.2019 (GVBl. S. 22); Fronleichnam § 2 Abs. 2, § 10 Abs. 1 ThürFtG vom 21.12.1994 (GVBl. S. 1221, https://parldok.thueringer-landtag.de/ParlDok/dokument/11487); zuletzt geändert 2019 nach der Eingangsformel von Drs. 8/4465', url: 'https://parldok.thueringer-landtag.de/ParlDok/dokument/70512' },
}

// Länder, deren Liste in der geltenden Fassung nicht amtlich im Wortlaut gelesen und auch nicht abgeglichen
// ist, mit Grund. Solange hier ein Land steht, bleiben die geltenden Fassungen `adopted`, und
// `holidaysCheckedOn` ist falsch.
export const STATE_HOLIDAY_LAW_UNREAD: { readonly [S in FederalState]?: string } = {}

const URL_HH_OVERVIEW = 'https://www.hamburg.de/resource/blob/134374/7a4a9de67fd46caec0947c11bf23316d/bsb-feiertage-data.pdf'
const HH_OVERVIEW = `Übersicht über die gesetzlichen Feiertage in der Bundesrepublik Deutschland der Hamburger Behörde für Schule und Berufsbildung, Stand September 2018 (${URL_HH_OVERVIEW}, gelesen am 09.11.2026; sie führt die Reformationstage von 2018 noch nicht)`

// Länder, deren Gesetzestext nicht amtlich lesbar ist (die Portale sperren den Zugriff), deren Liste aber
// abgeglichen ist (Entscheidung vom 09.11.2026, #334): Was amtlich lesbar war, ist gelesen; die übrigen Tage
// decken sich mit einer amtlichen Übersicht und mit beiden Vergleichslisten. Die geltenden Fassungen bleiben
// dann `adopted` und nennen diese Länder, das Mietkonto rechnet aber mit ihren Feiertagen
// (`isCrossCheckedStateList`, shared/holidaysChecked.ts). Wird ein Gesetz später gelesen, wandert das Land
// nach `STATE_HOLIDAY_LAW`.
export const STATE_HOLIDAY_LAW_CROSS_CHECKED: { readonly [S in FederalState]?: string } = {
  HB: `§ 2 Abs. 1 FeiertG BR vom 12.11.1954 (Brem.GBl. S. 115). Amtlich gelesen sind Buchst. g „der 3. Oktober - Tag der deutschen Einheit -“ (Drs. 13/475, G v. 23.03.1993), die Aufhebung von Buchst. h (Buß- und Bettag), die aus i und j h und i macht (Drs. 13/1034, 1994), und Buchst. j „der Reformationstag“ (Drs. 19/939, G v. 26.06.2018, Brem.GBl. S. 302). Der Wortlaut der übrigen Buchstaben ist nicht amtlich lesbar (gesetzblatt.bremen.de, transparenz.bremen.de, inneres.bremen.de und bremen.de antworten mit 403; die digitalisierten Drucksachen 1953 bis 1955 enthalten den Entwurf nicht). Neujahr, Karfreitag, Ostermontag, 1. Mai, Christi Himmelfahrt, Pfingstmontag und beide Weihnachtstage, sonst keiner, nach der ${HH_OVERVIEW} und nach beiden Vergleichslisten (python-holidays und date-holidays)`,
  HH: `§ 1 FeiertagsG vom 16.10.1953. Amtlich gelesen ist Nr. 8 „31. Oktober“ (Fünftes Änderungsgesetz vom 12.03.2018, HmbGVBl. S. 63: hinter Nr. 7 eingefügt, die bisherigen Nr. 8 und 9 werden Nr. 9 und 10) und dass die späteren Änderungen nur § 2a betreffen. Der Wortlaut von Nr. 1 bis 7, 9 und 10 ist nicht amtlich lesbar (landesrecht-hamburg.de liefert einem Browser nichts, die Parlamentsdatenbank sperrt den Zugriff, das Archiv des Gesetzblatts beim Verlag beginnt 1995). Neujahr, Karfreitag, Ostermontag, 1. Mai, Christi Himmelfahrt, Pfingstmontag, 3. Oktober und beide Weihnachtstage, sonst keiner, nach der ${HH_OVERVIEW} und nach beiden Vergleichslisten (python-holidays und date-holidays)`,
}

// Die Quellen der geltenden Fassungen, die nur wegen der abgeglichenen Länder `adopted` sind.
const CROSS_CHECKED_SOURCES = new WeakSet<Source>()

// Ob eine Quelle eine Landesliste ist, die bis auf abgeglichene Länder amtlich gelesen ist.
export function isCrossCheckedStateList(source: Source): boolean {
  return CROSS_CHECKED_SOURCES.has(source)
}

// Die Quelle einer geltenden Fassung: `checked`, wenn jede Landesliste gelesen ist; sonst `adopted` mit den
// offenen oder abgeglichenen Ländern.
function fromStateLists(cite: string, url: string): Source {
  const open = STATE_CODES.filter((s) => STATE_HOLIDAY_LAW_UNREAD[s] !== undefined)
  const crossChecked = STATE_CODES.filter((s) => STATE_HOLIDAY_LAW_CROSS_CHECKED[s] !== undefined)
  if (open.length > 0) {
    return { rank: 'law', cite: `${cite}; Liste der Feiertage amtlich gelesen außer in ${[...open, ...crossChecked].join(', ')} (STATE_HOLIDAY_LAW_UNREAD); ${CROSS_CHECK}`, url, retrieved: READ_STATE_LISTS, checked: 'adopted' }
  }
  if (crossChecked.length > 0) {
    const source: Source = { rank: 'law', cite: `${cite}; Liste der Feiertage amtlich gelesen außer in ${crossChecked.join(', ')}, dort abgeglichen mit einer amtlichen Übersicht und den Vergleichslisten (STATE_HOLIDAY_LAW_CROSS_CHECKED)`, url, retrieved: READ_STATE_LISTS, checked: 'adopted' }
    CROSS_CHECKED_SOURCES.add(source)
    return source
  }
  return { rank: 'law', cite: `${cite}; Liste der Feiertage in allen 16 Ländern amtlich gelesen (STATE_HOLIDAY_LAW)`, url, retrieved: READ_STATE_LISTS, checked: 'checked' }
}

// Für die Tage, die in allen Ländern gelten.
const EVERYWHERE = fromStateLists('Feiertagsgesetze aller Länder', URL_SN)
const EVERYWHERE_ENACTED = 'Feiertagsgesetze der Länder, geltende Fassungen'

function dayText(day: string): string {
  if (day === 'repentance') return 'Mittwoch vor dem 23. November'
  if (day.startsWith('O')) {
    const n = Number(day.slice(1))
    return n === 0 ? 'Ostersonntag' : n > 0 ? `${n} Tage nach Ostersonntag` : `${-n} Tage vor Ostersonntag`
  }
  return `${day.slice(3, 5)}.${day.slice(0, 2)}.`
}

function describeHoliday(v: HolidayValue): string {
  const where = v.states.length === ALL.length ? 'in allen Ländern'
    : v.states.length === 0 ? 'in keinem Land landesweit'
    : `in ${v.states.map(stateName).join(', ')}`
  const local = Object.entries(v.local).map(([s, w]) => `${isFederalState(s) ? stateName(s) : s} ${w}`)
  return `${dayText(v.day)}, gesetzlicher Feiertag ${where}${local.length ? `; ${local.join('; ')}` : ''}`
}

const value = (day: string, states: readonly FederalState[], local: { readonly [state: string]: string } = {}): HolidayValue => ({ day, states, local })

const everywhere = (id: string, title: string, day: string): LawParam<HolidayValue, 'eventDate'> => ({
  id, title, norm: 'Feiertagsgesetze der Länder', timing: 'eventDate', describe: describeHoliday,
  versions: [{ value: value(day, ALL), source: EVERYWHERE, enacted: EVERYWHERE_ENACTED }],
})

export const holidayNewYear: LawParam<HolidayValue, 'eventDate'> = everywhere('holiday.new-year', 'Neujahr', '01-01')
export const holidayGoodFriday: LawParam<HolidayValue, 'eventDate'> = everywhere('holiday.good-friday', 'Karfreitag', 'O-2')
export const holidayEasterMonday: LawParam<HolidayValue, 'eventDate'> = everywhere('holiday.easter-monday', 'Ostermontag', 'O+1')
export const holidayLabourDay: LawParam<HolidayValue, 'eventDate'> = everywhere('holiday.labour-day', 'Tag der Arbeit', '05-01')
export const holidayAscension: LawParam<HolidayValue, 'eventDate'> = everywhere('holiday.ascension', 'Christi Himmelfahrt', 'O+39')
export const holidayWhitMonday: LawParam<HolidayValue, 'eventDate'> = everywhere('holiday.whit-monday', 'Pfingstmontag', 'O+50')
export const holidayChristmas: LawParam<HolidayValue, 'eventDate'> = everywhere('holiday.christmas', '1. Weihnachtstag', '12-25')
export const holidayBoxingDay: LawParam<HolidayValue, 'eventDate'> = everywhere('holiday.boxing-day', '2. Weihnachtstag', '12-26')

export const holidayEpiphany: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.epiphany', title: 'Heilige Drei Könige', norm: '§ 1 FTG BW; Art. 1 Abs. 1 Nr. 1 BayFTG; § 2 Nr. 2 FeiertG LSA', timing: 'eventDate', describe: describeHoliday,
  versions: [{ value: value('01-06', ['BW', 'BY', 'ST']), source: fromStateLists('§ 1 FTG BW; Art. 1 Abs. 1 Nr. 1 BayFTG; § 2 Nr. 2 FeiertG LSA', URL_BY), enacted: 'BayFTG; FTG BW i. d. F. vom 08.05.1995; FeiertG LSA i. d. F. vom 25.08.2004' }],
}

export const holidayWomensDay: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.womens-day', title: 'Internationaler Frauentag', norm: '§ 1 Abs. 1 Nr. 2 FeiertG Berlin; § 2 Abs. 1 Nr. 2 FTG M-V', timing: 'eventDate', describe: describeHoliday,
  versions: [
    { validTo: '2019-02-06', value: value('03-08', []), source: adopted('in keinem Land Feiertag, bis Berlin ihn mit G v. 30.01.2019 einfügte', URL_BE_2019), enacted: 'Feiertagsgesetze der Länder vor dem 07.02.2019' },
    { validFrom: '2019-02-07', validTo: '2022-07-12', value: value('03-08', ['BE']), source: checked('§ 1 Abs. 1 Nr. 2 FeiertG Berlin, eingefügt durch Art. 1 des Dritten Änderungsgesetzes vom 30.01.2019 (GVBl. S. 22)', URL_BE_2019), enacted: 'G v. 30.01.2019 (GVBl. Berlin S. 22), in Kraft am Tag nach der Verkündung' },
    { validFrom: '2022-07-13', value: value('03-08', ['BE', 'MV']), source: fromStateLists('§ 2 Abs. 1 Nr. 2 FTG M-V, eingefügt durch das Vierte Änderungsgesetz vom 07.07.2022 (GVOBl. M-V S. 427); § 1 Abs. 1 Nr. 2 FeiertG Berlin', URL_MV_2022), enacted: 'G v. 07.07.2022 (GVOBl. M-V 2022 Nr. 31, S. 427), in Kraft am 13.07.2022' },
  ],
}

export const holidayEasterSunday: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.easter-sunday', title: 'Ostersonntag', norm: '§ 2 Abs. 1 Nr. 3 FTG Brandenburg', timing: 'eventDate', describe: describeHoliday,
  versions: [{ value: value('O+0', ['BB']), source: fromStateLists('§ 2 Abs. 1 FTG Brandenburg', 'https://bravors.brandenburg.de/gesetze/ftg_2015'), enacted: 'FTG Brandenburg vom 21.03.1991, zuletzt geändert am 30.04.2015' }],
}

export const holidayWhitSunday: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.whit-sunday', title: 'Pfingstsonntag', norm: '§ 2 Abs. 1 Nr. 7 FTG Brandenburg', timing: 'eventDate', describe: describeHoliday,
  versions: [{ value: value('O+49', ['BB']), source: fromStateLists('§ 2 Abs. 1 FTG Brandenburg', 'https://bravors.brandenburg.de/gesetze/ftg_2015'), enacted: 'FTG Brandenburg vom 21.03.1991, zuletzt geändert am 30.04.2015' }],
}

// Einmalig am 8. Mai 2020 und 2025: eingefügt und am Tag danach wieder aufgehoben (jeweils Art. 1 und 2).
export const holidayLiberationDay: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.liberation-day', title: 'Tag der Befreiung', norm: '§ 1 Abs. 1 Nr. 11 FeiertG Berlin (einmalig)', timing: 'eventDate', describe: describeHoliday,
  versions: [
    { validTo: '2020-05-07', value: value('05-08', []), source: checked('kein Feiertag vor der Einfügung durch Art. 1 G v. 30.01.2019 (GVBl. S. 22)', URL_BE_2019), enacted: 'FeiertG Berlin vor dem 08.05.2020' },
    { validFrom: '2020-05-08', validTo: '2020-05-08', value: value('05-08', ['BE']), source: checked('§ 1 Abs. 1 Nr. 11 FeiertG Berlin, Art. 1 und 2 G v. 30.01.2019 (GVBl. S. 22)', URL_BE_2019), enacted: 'G v. 30.01.2019 (GVBl. Berlin S. 22), Nr. 11 aufgehoben zum 09.05.2020' },
    { validFrom: '2020-05-09', validTo: '2025-05-07', value: value('05-08', []), source: checked('Nr. 11 aufgehoben zum 09.05.2020 (Art. 2 G v. 30.01.2019); neu eingefügt erst durch G v. 10.07.2024 für den 08.05.2025', URL_BE_2024), enacted: 'FeiertG Berlin vom 09.05.2020 bis 07.05.2025' },
    { validFrom: '2025-05-08', validTo: '2025-05-08', value: value('05-08', ['BE']), source: checked('§ 1 Abs. 1 Nr. 11 FeiertG Berlin, Art. 1 und 2 des Vierten Änderungsgesetzes vom 10.07.2024 (GVBl. S. 460)', URL_BE_2024), enacted: 'G v. 10.07.2024 (GVBl. Berlin S. 460), Nr. 11 aufgehoben zum 09.05.2025' },
    { validFrom: '2025-05-09', value: value('05-08', []), source: fromStateLists('Nr. 11 aufgehoben zum 09.05.2025 (Art. 2 G v. 10.07.2024)', URL_BE_2024), enacted: 'FeiertG Berlin ab dem 09.05.2025' },
  ],
}

export const holidayCorpusChristi: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.corpus-christi', title: 'Fronleichnam', norm: 'Feiertagsgesetze von BW, BY, HE, NW, RP, SL; § 1 Abs. 1 SächsSFG mit Fronleichnamsverordnung; § 10 Abs. 1 ThürFtG', timing: 'eventDate', describe: describeHoliday,
  versions: [{
    value: value('O+60', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'], {
      SN: 'nur in einzelnen Gemeinden und Gemeindeteilen um Bautzen, Hoyerswerda und Kamenz',
      TH: 'nur in Gemeinden, in denen er 1994 gesetzlicher Feiertag war, etwa im Eichsfeld',
    }),
    source: fromStateLists('§ 1 FTG BW; Art. 1 Abs. 1 BayFTG; § 1 Abs. 1 Nr. 7 HFeiertagsG; § 2 Abs. 1 Nr. 7 FTG NW; § 2 Abs. 1 LFtG RP; § 2 Abs. 1 Nr. 7 SFG Saarland; Sachsen: Fronleichnamsverordnung vom 04.05.1993; Thüringen: § 10 Abs. 1 ThürFtG (GVBl. 1994 S. 1221), „in denjenigen Teilen Thüringens, in denen er im Jahre 1994 als gesetzlicher Feiertag begangen wurde“', 'https://www.revosax.sachsen.de/vorschrift/4142'),
    enacted: 'Feiertagsgesetze der Länder, geltende Fassungen',
  }],
}

// Einmalig am 17. Juni 2028 (75. Jahrestag des Volksaufstands): eingefügt durch Art. 1, aufgehoben am
// Tag danach (Art. 3) des Gesetzes vom 10.07.2024.
export const holidayUprising1953: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.uprising-1953', title: '75. Jahrestag des Volksaufstands vom 17. Juni 1953', norm: '§ 1 Abs. 1 Nr. 11 FeiertG Berlin (einmalig; eingefügt als Nr. 12, seit 09.05.2025 Nr. 11)', timing: 'eventDate', describe: describeHoliday,
  versions: [
    { validTo: '2028-06-16', value: value('06-17', []), source: fromStateLists('kein Feiertag außer am 17.06.2028 (Art. 1 und 3 G v. 10.07.2024)', URL_BE_2024), enacted: 'FeiertG Berlin vor dem 17.06.2028' },
    { validFrom: '2028-06-17', validTo: '2028-06-17', value: value('06-17', ['BE']), source: fromStateLists('§ 1 Abs. 1 Nr. 11 FeiertG Berlin: eingefügt als Nr. 12 durch Art. 1, seit 09.05.2025 Nr. 11 (Art. 2), aufgehoben durch Art. 3 des Vierten Änderungsgesetzes vom 10.07.2024 (GVBl. S. 460)', URL_BE_2024), enacted: 'G v. 10.07.2024 (GVBl. Berlin S. 460), aufgehoben zum 18.06.2028' },
    { validFrom: '2028-06-18', value: value('06-17', []), source: fromStateLists('aufgehoben zum 18.06.2028 (Art. 3 G v. 10.07.2024)', URL_BE_2024), enacted: 'FeiertG Berlin ab dem 18.06.2028' },
  ],
}

export const holidayAugsburgPeace: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.augsburg-peace', title: 'Augsburger Friedensfest', norm: 'Art. 1 Abs. 2 BayFTG', timing: 'eventDate', describe: describeHoliday,
  versions: [{ value: value('08-08', [], { BY: 'nur im Stadtgebiet Augsburg' }), source: fromStateLists('Art. 1 Abs. 2 BayFTG: „In der Stadt Augsburg ist außerdem der 8. August (Friedensfest) gesetzlicher Feiertag.“', URL_BY), enacted: 'BayFTG, Fassung ab 01.08.2013' }],
}

export const holidayAssumption: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.assumption', title: 'Mariä Himmelfahrt', norm: '§ 2 Abs. 1 Nr. 8 SFG Saarland; Art. 1 Abs. 1 Nr. 2, Abs. 3 BayFTG', timing: 'eventDate', describe: describeHoliday,
  versions: [{
    value: value('08-15', ['SL'], { BY: 'nur in Gemeinden mit mehr katholischen als evangelischen Einwohnern, wie sie das Landesamt für Statistik feststellt' }),
    source: fromStateLists('Art. 1 Abs. 1 Nr. 2, Abs. 3 BayFTG; § 2 Abs. 1 Nr. 8 SFG Saarland i. d. F. des G Nr. 1289 vom 08.04.1992 („der Maria Himmelfahrtstag (15. August)“)', URL_BY),
    enacted: 'BayFTG, Fassung ab 01.08.2013; SFG Saarland vom 18.02.1976, zuletzt geändert am 13.10.2015',
  }],
}

// Thüringen ab 2019. Das Dritte Änderungsgesetz vom 19.03.2019 (GVBl. S. 22, ausgegeben am 26.03.2019)
// trat am 27.03.2019 in Kraft (Art. 2, im Gesetzblatt gelesen). Die Grenze der Fassung bleibt die
// Jahresgrenze: Zwischen dem 01.01. und dem 27.03.2019 liegt kein 20. September, der Tag ist derselbe.
export const holidayChildrensDay: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.childrens-day', title: 'Weltkindertag', norm: '§ 2 Abs. 1 ThürFGtG (bis 2016 ThürFtG)', timing: 'eventDate', describe: describeHoliday,
  versions: [
    { validTo: '2018-12-31', value: value('09-20', []), source: adopted('in keinem Land Feiertag vor dem Dritten Gesetz zur Änderung des ThürFtG', 'https://parldok.thueringer-landtag.de/ParlDok/dokument/68329/drittes_gesetz_zur_aenderung_des_thueringer_feier_und_gedenktagsgesetzes_einfuehrung_des_weltkindertages_als_gesetzlichen_feiertag.pdf'), enacted: 'ThürFtG vor 2019' },
    { validFrom: '2019-01-01', value: value('09-20', ['TH']), source: fromStateLists('§ 2 Abs. 1 ThürFGtG, eingefügt durch das Dritte Änderungsgesetz vom 19.03.2019 (GVBl. S. 22), in Kraft am 27.03.2019', 'https://parldok.thueringer-landtag.de/ParlDok/dokument/70512'), enacted: 'G v. 19.03.2019 (GVBl. Thüringen S. 22), in Kraft am 27.03.2019' },
  ],
}

export const holidayUnityDay: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.unity-day', title: 'Tag der Deutschen Einheit', norm: 'Art. 2 Abs. 2 Einigungsvertrag', timing: 'eventDate', describe: describeHoliday,
  versions: [{ value: value('10-03', ALL), source: checked('Art. 2 Abs. 2 Einigungsvertrag: „Der 3. Oktober ist als Tag der Deutschen Einheit gesetzlicher Feiertag.“', 'https://www.gesetze-im-internet.de/einigvtr/art_2.html'), enacted: 'Einigungsvertrag vom 31.08.1990' }],
}

// 2017 einmalig in allen Ländern (500. Jahrestag), danach dauerhaft auch in Bremen, Hamburg, Niedersachsen
// und Schleswig-Holstein. Die vier änderten ihre Gesetze zwischen März und Juni 2018; die Grenze ist die
// des letzten, Bremen ab 29.06.2018, also vor dem ersten Reformationstag danach.
export const holidayReformation: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.reformation', title: 'Reformationstag', norm: 'Feiertagsgesetze von BB, MV, SN, ST, TH; § 2 Abs. 1 Buchst. j FeiertG BR; § 1 Nr. 8 FeiertagsG HH; § 2 NFeiertagsG; § 2 Abs. 1 SFTG', timing: 'eventDate', describe: describeHoliday,
  versions: [
    { validTo: '2017-10-30', value: value('10-31', NORTH_BEFORE), source: adopted('§ 1 Abs. 1 SächsSFG im Wortlaut gelesen; § 2 Nr. 9 FeiertG LSA über die Sammlung der Landeskirche EKM; BB, MV, TH nach den Vergleichslisten (python-holidays und date-holidays)', URL_SN), enacted: 'Feiertagsgesetze der Länder' },
    { validFrom: '2017-10-31', validTo: '2017-10-31', value: value('10-31', ALL), source: adopted('einmalige Regelung in jedem Land; gelesen Art. 1 Abs. 2a BayFTG a. F. (GVBl. 2016 S. 50), G v. 25.06.2015 (GV. NRW. S. 496) und § 2 Abs. 1 Buchst. j FeiertG BR i. d. F. vom 21.11.2017, die übrigen nach den Vergleichslisten (python-holidays und date-holidays)', 'https://www.verkuendung-bayern.de/gvbl/2016-50/'), enacted: 'je eigene Regelung der Länder für den 31.10.2017' },
    { validFrom: '2017-11-01', validTo: '2018-06-28', value: value('10-31', NORTH_BEFORE), source: adopted('die Regelungen für 2017 traten am 01.11.2017 außer Kraft (Art. 1 Abs. 2a BayFTG a. F.)', 'https://www.verkuendung-bayern.de/gvbl/2016-50/'), enacted: 'Feiertagsgesetze der Länder' },
    { validFrom: '2018-06-29', value: value('10-31', NORTH_AFTER), source: fromStateLists('§ 2 Abs. 1 Buchst. j FeiertG BR; § 1 Nr. 8 FeiertagsG HH (HmbGVBl. 2018 S. 63); § 2 Abs. 1 Buchst. h NFeiertagsG (G v. 22.06.2018); § 2 Abs. 1 SFTG SH (GVOBl. 2018 S. 69); Brandenburg, Mecklenburg-Vorpommern, Sachsen, Sachsen-Anhalt, Thüringen seit ihren Stammgesetzen', URL_HB), enacted: 'Änderungsgesetze von Bremen, Hamburg, Niedersachsen und Schleswig-Holstein aus 2018' },
  ],
}

export const holidayAllSaints: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.all-saints', title: 'Allerheiligen', norm: 'Feiertagsgesetze von BW, BY, NW, RP, SL', timing: 'eventDate', describe: describeHoliday,
  versions: [{ value: value('11-01', ['BW', 'BY', 'NW', 'RP', 'SL']), source: fromStateLists('§ 1 FTG BW; Art. 1 Abs. 1 BayFTG; § 2 Abs. 1 Nr. 9 FTG NW; § 2 Abs. 1 LFtG RP; § 2 Abs. 1 Nr. 10 SFG Saarland', URL_BY), enacted: 'Feiertagsgesetze der Länder, geltende Fassungen' }],
}

export const holidayRepentance: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.repentance', title: 'Buß- und Bettag', norm: '§ 1 Abs. 1 SächsSFG', timing: 'eventDate', describe: describeHoliday,
  versions: [{ value: value('repentance', ['SN']), source: fromStateLists('§ 1 Abs. 1 SächsSFG, Stand 07.05.2025', URL_SN), enacted: 'SächsSFG vom 10.11.1992, geltende Fassung' }],
}

// In der Reihenfolge des Jahres, für shared/holidays.ts.
export const HOLIDAY_PARAMS: readonly LawParam<HolidayValue, 'eventDate'>[] = [
  holidayNewYear, holidayEpiphany, holidayWomensDay, holidayGoodFriday, holidayEasterSunday, holidayEasterMonday,
  holidayLabourDay, holidayLiberationDay, holidayAscension, holidayWhitSunday, holidayWhitMonday, holidayCorpusChristi,
  holidayUprising1953, holidayAugsburgPeace, holidayAssumption, holidayChildrensDay, holidayUnityDay, holidayReformation,
  holidayAllSaints, holidayRepentance, holidayChristmas, holidayBoxingDay,
]
