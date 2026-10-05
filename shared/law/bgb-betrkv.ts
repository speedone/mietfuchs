// Parameter aus BGB und Betriebskostenverordnung (Heizung PR 1, Entwurf 4.3). Frist und Höchstdauer
// des Abrechnungszeitraums (§ 556 Abs. 3 BGB, #208).
import type { LawParam, Source } from './register.ts'
import { germanDate } from './register.ts'

// Kabelfernsehen: Die Gebühren für das TV-Signal durften bis zum 30.06.2024 umgelegt werden, und
// nur bei Anlagen, die vor dem 01.12.2021 errichtet wurden (§ 2 Satz 1 Nr. 15 Buchst. a und b,
// Satz 2 BetrKV). `overlap`: Ein Abrechnungsjahr, das die Übergangszeit nur berührt, ist das
// Übergangsjahr („teilweise“). Wortlaut geprüft am 05.10.2026; die BetrKV ist unverändert seit
// Art. 4 G v. 16.10.2023 (Durchsicht vom 02.10.2026).
export const betrkvTvSignal: LawParam<{ readonly newSystemsFrom: string }, 'overlap'> = {
  id: 'betrkv.tv-signal',
  title: 'Kabelfernsehen über die Nebenkosten',
  norm: '§ 2 Satz 1 Nr. 15 Buchst. a und b, Satz 2 BetrKV',
  timing: 'overlap',
  versions: [{
    validTo: '2024-06-30',
    value: { newSystemsFrom: '2021-12-01' },
    source: { rank: 'law', cite: '§ 2 Satz 1 Nr. 15 Buchst. a und b, Satz 2 BetrKV', url: 'https://www.gesetze-im-internet.de/betrkv/__2.html', retrieved: '2026-10-05', checked: 'checked' },
    enacted: 'BetrKV, Fassung Art. 4 G v. 16.10.2023 (BGBl. I Nr. 280)',
  }],
  describe: (v) => `umlagefähig nur bei Anlagen, die vor dem ${germanDate(v.newSystemsFrom)} errichtet wurden`,
}

const bgb556 = (cite: string): Source => ({ rank: 'law', cite, url: 'https://www.gesetze-im-internet.de/bgb/__556.html', retrieved: '2026-10-05', checked: 'checked' })

// Abgerechnet wird jährlich (§ 556 Abs. 3 Satz 1 BGB); ein Abrechnungszeitraum ist deshalb nach
// herrschender Meinung höchstens zwölf Monate lang. Shared/period.ts bildet daraus die Zeiträume,
// vor jedem Wechsel einen Rumpf. Wortlaut geprüft am 05.10.2026 (Entwurf 2, 4.3).
export const bgbMaxPeriodMonths: LawParam<number, 'periodStart'> = {
  id: 'bgb.max-period-months',
  title: 'Höchstdauer des Abrechnungszeitraums',
  norm: '§ 556 Abs. 3 Satz 1 BGB',
  timing: 'periodStart',
  versions: [{ value: 12, source: bgb556('§ 556 Abs. 3 Satz 1 BGB (herrschende Meinung)'), enacted: '§ 556 Abs. 3 BGB' }],
  describe: (v) => `höchstens ${v} Monate`,
}

// Die Abrechnung muss dem Mieter spätestens bis zum Ablauf des zwölften Monats nach Ende des
// Abrechnungszeitraums mitgeteilt werden (§ 556 Abs. 3 Satz 2 BGB); danach ist eine Nachforderung
// ausgeschlossen, es sei denn, der Vermieter hat die Verspätung nicht zu vertreten (Satz 3).
export const bgbDeadlineMonths: LawParam<number, 'periodStart'> = {
  id: 'bgb.deadline-months',
  title: 'Abrechnungsfrist',
  norm: '§ 556 Abs. 3 Satz 2 BGB',
  timing: 'periodStart',
  versions: [{ value: 12, source: bgb556('§ 556 Abs. 3 Satz 2 BGB'), enacted: '§ 556 Abs. 3 BGB' }],
  describe: (v) => `Zugang bis zum Ablauf des ${v}. Monats nach Ende des Zeitraums`,
}
