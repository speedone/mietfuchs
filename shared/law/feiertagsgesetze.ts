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

// Für die Tage, die in allen Ländern gelten: gelesen in Sachsen und Bayern, die übrigen nach den
// Vergleichslisten.
const EVERYWHERE = adopted('Feiertagsgesetze aller Länder; im Wortlaut gelesen § 1 Abs. 1 SächsSFG und Art. 1 Abs. 1 BayFTG, die übrigen deckungsgleich mit den Vergleichslisten (python-holidays und date-holidays)', URL_SN)
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
  versions: [{ value: value('01-06', ['BW', 'BY', 'ST']), source: adopted('Art. 1 Abs. 1 Nr. 1 BayFTG im Wortlaut gelesen; § 1 FTG BW und § 2 Nr. 2 FeiertG LSA nur über nichtamtliche Sammlungen (Gewerbeaufsicht BW, Landeskirche EKM)', URL_BY), enacted: 'BayFTG; FTG BW i. d. F. vom 08.05.1995; FeiertG LSA i. d. F. vom 25.08.2004' }],
}

export const holidayWomensDay: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.womens-day', title: 'Internationaler Frauentag', norm: '§ 1 Abs. 1 Nr. 2 FeiertG Berlin; § 2 Abs. 1 Nr. 2 FTG M-V', timing: 'eventDate', describe: describeHoliday,
  versions: [
    { validTo: '2019-02-06', value: value('03-08', []), source: adopted('in keinem Land Feiertag, bis Berlin ihn mit G v. 30.01.2019 einfügte', URL_BE_2019), enacted: 'Feiertagsgesetze der Länder vor dem 07.02.2019' },
    { validFrom: '2019-02-07', validTo: '2022-07-12', value: value('03-08', ['BE']), source: checked('§ 1 Abs. 1 Nr. 2 FeiertG Berlin, eingefügt durch Art. 1 des Dritten Änderungsgesetzes vom 30.01.2019 (GVBl. S. 22)', URL_BE_2019), enacted: 'G v. 30.01.2019 (GVBl. Berlin S. 22), in Kraft am Tag nach der Verkündung' },
    { validFrom: '2022-07-13', value: value('03-08', ['BE', 'MV']), source: checked('§ 2 Abs. 1 Nr. 2 FTG M-V, eingefügt durch das Vierte Änderungsgesetz vom 07.07.2022 (GVOBl. M-V S. 427)', URL_MV_2022), enacted: 'G v. 07.07.2022 (GVOBl. M-V 2022 Nr. 31, S. 427), in Kraft am 13.07.2022' },
  ],
}

export const holidayEasterSunday: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.easter-sunday', title: 'Ostersonntag', norm: '§ 2 Abs. 1 Nr. 3 FTG Brandenburg', timing: 'eventDate', describe: describeHoliday,
  versions: [{ value: value('O+0', ['BB']), source: adopted('§ 2 Abs. 1 Nr. 3 FTG Brandenburg, über die Sammlung der Landeskirche EKM gelesen (bravors.brandenburg.de nicht abrufbar)', 'https://www.kirchenrecht-ekm.de/document/9625'), enacted: 'FTG Brandenburg vom 21.03.1991, zuletzt geändert am 30.04.2015' }],
}

export const holidayWhitSunday: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.whit-sunday', title: 'Pfingstsonntag', norm: '§ 2 Abs. 1 Nr. 7 FTG Brandenburg', timing: 'eventDate', describe: describeHoliday,
  versions: [{ value: value('O+49', ['BB']), source: adopted('§ 2 Abs. 1 Nr. 7 FTG Brandenburg, über die Sammlung der Landeskirche EKM gelesen (bravors.brandenburg.de nicht abrufbar)', 'https://www.kirchenrecht-ekm.de/document/9625'), enacted: 'FTG Brandenburg vom 21.03.1991, zuletzt geändert am 30.04.2015' }],
}

// Einmalig am 8. Mai 2020 und 2025: eingefügt und am Tag danach wieder aufgehoben (jeweils Art. 1 und 2).
export const holidayLiberationDay: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.liberation-day', title: 'Tag der Befreiung', norm: '§ 1 Abs. 1 Nr. 11 FeiertG Berlin (einmalig)', timing: 'eventDate', describe: describeHoliday,
  versions: [
    { validTo: '2020-05-07', value: value('05-08', []), source: checked('kein Feiertag vor der Einfügung durch Art. 1 G v. 30.01.2019 (GVBl. S. 22)', URL_BE_2019), enacted: 'FeiertG Berlin vor dem 08.05.2020' },
    { validFrom: '2020-05-08', validTo: '2020-05-08', value: value('05-08', ['BE']), source: checked('§ 1 Abs. 1 Nr. 11 FeiertG Berlin, Art. 1 und 2 G v. 30.01.2019 (GVBl. S. 22)', URL_BE_2019), enacted: 'G v. 30.01.2019 (GVBl. Berlin S. 22), Nr. 11 aufgehoben zum 09.05.2020' },
    { validFrom: '2020-05-09', validTo: '2025-05-07', value: value('05-08', []), source: checked('Nr. 11 aufgehoben zum 09.05.2020 (Art. 2 G v. 30.01.2019); neu eingefügt erst durch G v. 10.07.2024 für den 08.05.2025', URL_BE_2024), enacted: 'FeiertG Berlin vom 09.05.2020 bis 07.05.2025' },
    { validFrom: '2025-05-08', validTo: '2025-05-08', value: value('05-08', ['BE']), source: checked('§ 1 Abs. 1 Nr. 11 FeiertG Berlin, Art. 1 und 2 des Vierten Änderungsgesetzes vom 10.07.2024 (GVBl. S. 460)', URL_BE_2024), enacted: 'G v. 10.07.2024 (GVBl. Berlin S. 460), Nr. 11 aufgehoben zum 09.05.2025' },
    { validFrom: '2025-05-09', value: value('05-08', []), source: checked('Nr. 11 aufgehoben zum 09.05.2025 (Art. 2 G v. 10.07.2024)', URL_BE_2024), enacted: 'FeiertG Berlin ab dem 09.05.2025' },
  ],
}

export const holidayCorpusChristi: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.corpus-christi', title: 'Fronleichnam', norm: 'Feiertagsgesetze von BW, BY, HE, NW, RP, SL; § 1 Abs. 1 SächsSFG mit Fronleichnamsverordnung; § 10 Abs. 1 ThürFtG', timing: 'eventDate', describe: describeHoliday,
  versions: [{
    value: value('O+60', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'], {
      SN: 'nur in einzelnen Gemeinden und Gemeindeteilen um Bautzen, Hoyerswerda und Kamenz',
      TH: 'nur in Gemeinden, in denen er 1994 gesetzlicher Feiertag war, etwa im Eichsfeld',
    }),
    source: adopted('Sachsen: Fronleichnamsverordnung vom 04.05.1993 (revosax) und Thüringen: § 10 Abs. 1 ThürFtG (GVBl. 1994 S. 1221) im Wortlaut gelesen; Bayern Art. 1 Abs. 1 BayFTG; HE, SL, BW nur über nichtamtliche Sammlungen, NW und RP nach den Vergleichslisten (python-holidays und date-holidays)', 'https://www.revosax.sachsen.de/vorschrift/4142'),
    enacted: 'Feiertagsgesetze der Länder, geltende Fassungen',
  }],
}

// Einmalig am 17. Juni 2028 (75. Jahrestag des Volksaufstands): eingefügt durch Art. 1, aufgehoben am
// Tag danach (Art. 3) des Gesetzes vom 10.07.2024.
export const holidayUprising1953: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.uprising-1953', title: '75. Jahrestag des Volksaufstands vom 17. Juni 1953', norm: '§ 1 Abs. 1 Nr. 12 FeiertG Berlin (einmalig)', timing: 'eventDate', describe: describeHoliday,
  versions: [
    { validTo: '2028-06-16', value: value('06-17', []), source: checked('kein Feiertag außer am 17.06.2028 (Art. 1 und 3 G v. 10.07.2024)', URL_BE_2024), enacted: 'FeiertG Berlin vor dem 17.06.2028' },
    { validFrom: '2028-06-17', validTo: '2028-06-17', value: value('06-17', ['BE']), source: checked('§ 1 Abs. 1 Nr. 12 FeiertG Berlin, Art. 1 und 3 des Vierten Änderungsgesetzes vom 10.07.2024 (GVBl. S. 460)', URL_BE_2024), enacted: 'G v. 10.07.2024 (GVBl. Berlin S. 460), aufgehoben zum 18.06.2028' },
    { validFrom: '2028-06-18', value: value('06-17', []), source: checked('aufgehoben zum 18.06.2028 (Art. 3 G v. 10.07.2024)', URL_BE_2024), enacted: 'FeiertG Berlin ab dem 18.06.2028' },
  ],
}

export const holidayAugsburgPeace: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.augsburg-peace', title: 'Augsburger Friedensfest', norm: 'Art. 1 Abs. 2 BayFTG', timing: 'eventDate', describe: describeHoliday,
  versions: [{ value: value('08-08', [], { BY: 'nur im Stadtgebiet Augsburg' }), source: checked('Art. 1 Abs. 2 BayFTG: „In der Stadt Augsburg ist außerdem der 8. August (Friedensfest) gesetzlicher Feiertag.“', URL_BY), enacted: 'BayFTG, Fassung ab 01.08.2013' }],
}

export const holidayAssumption: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.assumption', title: 'Mariä Himmelfahrt', norm: '§ 2 Abs. 1 Nr. 8 SFG Saarland; Art. 1 Abs. 1 Nr. 2, Abs. 3 BayFTG', timing: 'eventDate', describe: describeHoliday,
  versions: [{
    value: value('08-15', ['SL'], { BY: 'nur in Gemeinden mit mehr katholischen als evangelischen Einwohnern, wie sie das Landesamt für Statistik feststellt' }),
    source: adopted('Art. 1 Abs. 1 Nr. 2, Abs. 3 BayFTG im Wortlaut gelesen; § 2 Abs. 1 Nr. 8 SFG Saarland nur über die Sammlung der Landeskirche EKiR', URL_BY),
    enacted: 'BayFTG, Fassung ab 01.08.2013; SFG Saarland vom 18.02.1976, zuletzt geändert am 13.10.2015',
  }],
}

// Thüringen ab 2019. Die Grenze ist die Jahresgrenze: Das Gesetz vom 26.03.2019 (GVBl. S. 22) galt am
// ersten Weltkindertag danach; sein Inkrafttreten ist nur aus dem Entwurf gelesen.
export const holidayChildrensDay: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.childrens-day', title: 'Weltkindertag', norm: '§ 2 Abs. 1 ThürFtG', timing: 'eventDate', describe: describeHoliday,
  versions: [
    { validTo: '2018-12-31', value: value('09-20', []), source: adopted('in keinem Land Feiertag vor dem Dritten Gesetz zur Änderung des ThürFtG', 'https://parldok.thueringer-landtag.de/ParlDok/dokument/68329/drittes_gesetz_zur_aenderung_des_thueringer_feier_und_gedenktagsgesetzes_einfuehrung_des_weltkindertages_als_gesetzlichen_feiertag.pdf'), enacted: 'ThürFtG vor 2019' },
    { validFrom: '2019-01-01', value: value('09-20', ['TH']), source: adopted('§ 2 Abs. 1 ThürFtG, Drittes Änderungsgesetz vom 26.03.2019 (GVBl. S. 22); gelesen der Gesetzentwurf (Drs. 6/6163) und die heutige Fassung über die Sammlung der Landeskirche EKM, das Gesetzblatt selbst nicht', 'https://parldok.thueringer-landtag.de/ParlDok/dokument/68329/drittes_gesetz_zur_aenderung_des_thueringer_feier_und_gedenktagsgesetzes_einfuehrung_des_weltkindertages_als_gesetzlichen_feiertag.pdf'), enacted: 'G v. 26.03.2019 (GVBl. Thüringen S. 22)' },
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
    { validFrom: '2017-10-31', validTo: '2017-10-31', value: value('10-31', ALL), source: adopted('einmalige Regelung in jedem Land; gelesen Art. 1 Abs. 2a BayFTG a. F. (GVBl. 2016 S. 50), G v. 25.06.2015 (GV. NRW. S. 495) und § 2 Abs. 1 Buchst. j FeiertG BR i. d. F. vom 21.11.2017, die übrigen nach den Vergleichslisten (python-holidays und date-holidays)', 'https://www.verkuendung-bayern.de/gvbl/2016-50/'), enacted: 'je eigene Regelung der Länder für den 31.10.2017' },
    { validFrom: '2017-11-01', validTo: '2018-06-28', value: value('10-31', NORTH_BEFORE), source: adopted('die Regelungen für 2017 traten am 01.11.2017 außer Kraft (Art. 1 Abs. 2a BayFTG a. F.)', 'https://www.verkuendung-bayern.de/gvbl/2016-50/'), enacted: 'Feiertagsgesetze der Länder' },
    { validFrom: '2018-06-29', value: value('10-31', NORTH_AFTER), source: adopted('§ 2 Abs. 1 Buchst. j FeiertG BR (Fassung ab 29.06.2018) und § 1 Nr. 8 FeiertagsG HH (HmbGVBl. 2018 S. 63) im Wortlaut gelesen; Niedersachsen (G v. 22.06.2018) über das Innenministerium, Schleswig-Holstein (GVOBl. 2018 S. 69) über den Landtag', URL_HB), enacted: 'Änderungsgesetze von Bremen, Hamburg, Niedersachsen und Schleswig-Holstein aus 2018' },
  ],
}

export const holidayAllSaints: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.all-saints', title: 'Allerheiligen', norm: 'Feiertagsgesetze von BW, BY, NW, RP, SL', timing: 'eventDate', describe: describeHoliday,
  versions: [{ value: value('11-01', ['BW', 'BY', 'NW', 'RP', 'SL']), source: adopted('Art. 1 Abs. 1 BayFTG im Wortlaut gelesen; BW und SL über nichtamtliche Sammlungen, NW und RP nach den Vergleichslisten (python-holidays und date-holidays)', URL_BY), enacted: 'Feiertagsgesetze der Länder, geltende Fassungen' }],
}

export const holidayRepentance: LawParam<HolidayValue, 'eventDate'> = {
  id: 'holiday.repentance', title: 'Buß- und Bettag', norm: '§ 1 Abs. 1 SächsSFG', timing: 'eventDate', describe: describeHoliday,
  versions: [{ value: value('repentance', ['SN']), source: checked('§ 1 Abs. 1 SächsSFG, Stand 07.05.2025', URL_SN), enacted: 'SächsSFG vom 10.11.1992, geltende Fassung' }],
}

// In der Reihenfolge des Jahres, für shared/holidays.ts.
export const HOLIDAY_PARAMS: readonly LawParam<HolidayValue, 'eventDate'>[] = [
  holidayNewYear, holidayEpiphany, holidayWomensDay, holidayGoodFriday, holidayEasterSunday, holidayEasterMonday,
  holidayLabourDay, holidayLiberationDay, holidayAscension, holidayWhitSunday, holidayWhitMonday, holidayCorpusChristi,
  holidayUprising1953, holidayAugsburgPeace, holidayAssumption, holidayChildrensDay, holidayUnityDay, holidayReformation,
  holidayAllSaints, holidayRepentance, holidayChristmas, holidayBoxingDay,
]
