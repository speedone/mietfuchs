import { describe, expect, it } from 'vitest'
import type { RentLedgerRow, RentMonth, RentMonthStatus } from './types'
import { bookingDate, newPaymentDate, rentDueApplies, rentDueNote, rowStanding, shareText, showDecemberNote, decemberNote } from './ledgerView'

const month = (m: number, sollCents: number, status: RentMonthStatus): RentMonth => ({
  month: m, baseRentCents: sollCents, prepaymentCents: 0, flatRateCents: 0, sollCents, paidCents: status === 'paid' ? sollCents : 0, status,
})

// Eine Zeile mit zwölf Monaten, deren Dezember sich vorgeben lässt. Über den Typ gebaut, damit
// der Übersetzer mitprüft, dass hier wirklich eine Mietkonto-Zeile steht.
const row = (dezember: RentMonth): RentLedgerRow => ({
  tenancyId: 't1', tenantName: 'Müller', unitName: 'OG',
  months: [...Array.from({ length: 11 }, (_, i) => month(i + 1, 100000, 'paid')), dezember],
  sollYearCents: 1200000, baseRentYearCents: 1200000, prepaymentYearCents: 0, flatRateYearCents: 0,
  paidYearCents: 1100000, settlementYearCents: 0, balanceCents: -100000, dueSollCents: 1200000, arrearsCents: 100000, openMonths: 1,
})

const heute = new Date('2026-09-22T00:00:00Z')

describe('Mietkonto: der Hinweis zum offenen Dezember (#70)', () => {
  it('erscheint für ein vergangenes Jahr mit offenem Dezember', () => {
    expect(showDecemberNote(row(month(12, 100000, 'open')), 2025, heute)).toBe(true)
    expect(showDecemberNote(row(month(12, 100000, 'partial')), 2025, heute)).toBe(true)
  })

  it('erscheint nicht im laufenden Jahr', () => {
    // **Der Befund der Durchsicht, gemessen.** `rentLedger` füllt immer alle zwölf Monate, der
    // Dezember des laufenden Jahres trägt also Soll und steht offen — im Januar genauso wie im
    // September. Ohne diese Bedingung bekäme jedes laufende Mietverhältnis den Hinweis das ganze
    // Jahr über, Monate bevor er etwas bedeuten kann.
    expect(showDecemberNote(row(month(12, 100000, 'open')), 2026, heute)).toBe(false)
    // Und erst recht nicht für ein künftiges.
    expect(showDecemberNote(row(month(12, 100000, 'open')), 2027, heute)).toBe(false)
  })

  it('erscheint nicht, wenn der Dezember bezahlt ist oder kein Soll trägt', () => {
    expect(showDecemberNote(row(month(12, 100000, 'paid')), 2025, heute)).toBe(false)
    // Kein Soll heißt, das Mietverhältnis lief im Dezember nicht mehr; `rentLedger` setzt den
    // Monat dann auf „paid", aber auch mit offenem Status gäbe es nichts zu erklären.
    expect(showDecemberNote(row(month(12, 0, 'open')), 2025, heute)).toBe(false)
  })

  // **Befund M3 aus #341.** Der Hinweis stand auch bei zwölf offenen Monaten: Dann ist nicht die
  // Dezembermiete spät gekommen, sondern es fehlt das ganze Jahr. Er hilft nur, wenn allein der
  // Dezember offen ist.
  it('erscheint nicht, wenn auch frühere Monate offen sind', () => {
    const alleOffen: RentLedgerRow = {
      ...row(month(12, 100000, 'open')),
      months: Array.from({ length: 12 }, (_, i) => month(i + 1, 100000, 'open')),
    }
    expect(showDecemberNote(alleOffen, 2025, heute)).toBe(false)
    expect(decemberNote(alleOffen, 2025, heute)).toBe(null)
    const novemberTeilweise: RentLedgerRow = {
      ...row(month(12, 100000, 'open')),
      months: [...Array.from({ length: 10 }, (_, i) => month(i + 1, 100000, 'paid')), month(11, 100000, 'partial'), month(12, 100000, 'open')],
    }
    expect(showDecemberNote(novemberTeilweise, 2025, heute)).toBe(false)
  })

  it('zählt Monate ohne Soll nicht als offen', () => {
    // Einzug im Mai: Januar bis April tragen kein Soll und stehen nicht im Weg.
    const abMai: RentLedgerRow = {
      ...row(month(12, 100000, 'open')),
      months: [...Array.from({ length: 4 }, (_, i) => month(i + 1, 0, 'paid')), ...Array.from({ length: 7 }, (_, i) => month(i + 5, 100000, 'paid')), month(12, 100000, 'open')],
    }
    expect(showDecemberNote(abMai, 2025, heute)).toBe(true)
  })

  it('erklärt die Verteilung der Zahlungen der Reihe nach', () => {
    // Ein zu niedriger November erscheint nach der Verteilung ab Januar als Lücke im Dezember:
    // Der Satz nennt beide Ursachen und den fehlenden Betrag.
    const teil: RentMonth = { ...month(12, 100000, 'partial'), paidCents: 40000 }
    const text = decemberNote(row(teil), 2025, heute)?.replace(/\s/g, ' ')
    expect(text).toContain('Im Dezember fehlen 600,00 €')
    expect(text).toContain('der Reihe nach ab Januar')
    expect(text).toContain('Zahlungseingängen 2026')
    expect(decemberNote(row(month(12, 100000, 'open')), 2025, heute)?.replace(/\s/g, ' ')).toContain('Im Dezember fehlen 1.000,00 €')
  })

  it('kommt ohne Dezember-Eintrag nicht ins Straucheln', () => {
    // Eine Zeile ohne zwölf Monate erzeugt `rentLedger` nicht. Der Zugriff auf `months[11]` wäre
    // trotzdem ein `undefined`, und darauf eine Eigenschaft zu lesen beendete die Seite.
    const ohne: RentLedgerRow = { ...row(month(12, 100000, 'open')), months: [] }
    expect(showDecemberNote(ohne, 2025, heute)).toBe(false)
  })
})

describe('Mietkonto: Stand einer Zeile im laufenden Jahr (#133, zweite Browserabnahme)', () => {
  const zeile = (over: Partial<RentLedgerRow>): RentLedgerRow => ({ ...row(month(12, 100000, 'notDue')), ...over })
  it('künftige Monate sind kein Rückstand: „bisher bezahlt“', () => {
    expect(rowStanding(zeile({ paidYearCents: 900000, balanceCents: -300000, dueSollCents: 900000, arrearsCents: 0 }))).toEqual({ kind: 'paidSoFar', cents: 300000 })
  })
  it('ein fälliger offener Monat ist ein Rückstand', () => {
    expect(rowStanding(zeile({ paidYearCents: 800000, balanceCents: -400000, dueSollCents: 900000, arrearsCents: 100000 }))).toEqual({ kind: 'arrears', cents: 100000 })
  })
  it('Überzahlung und ganz bezahlt', () => {
    expect(rowStanding(zeile({ paidYearCents: 1300000, balanceCents: 100000, dueSollCents: 1200000, arrearsCents: 0 }))).toEqual({ kind: 'credit', cents: 100000 })
    expect(rowStanding(zeile({ paidYearCents: 1200000, balanceCents: 0, dueSollCents: 1200000, arrearsCents: 0 }))).toEqual({ kind: 'paid', cents: 0 })
  })
})

describe('Mietkonto: Buchungsdatum beim Klick auf einen Monat (#133, letzte Durchsicht)', () => {
  const heute = new Date(2026, 9, 1)
  it('ein fälliger Monat: der Erste des Monats', () => {
    expect(bookingDate(2026, month(9, 100000, 'open'), heute)).toBe('2026-09-01')
  })
  it('ein noch nicht fälliger Monat: heute, denn gezahlt wird heute (Zuflussprinzip)', () => {
    expect(bookingDate(2026, month(12, 100000, 'notDue'), heute)).toBe('2026-10-01')
  })
})

describe('Datum einer neuen Zahlung (#142)', () => {
  const heute = new Date(2026, 9, 1, 12)
  it('im laufenden Jahr: heute', () => {
    expect(newPaymentDate(2026, heute)).toBe('2026-10-01')
  })
  it('ein früheres Jahr: der 31.12. dieses Jahres, nicht heute, damit die Zahlung im gewählten Jahr steht', () => {
    expect(newPaymentDate(2025, heute)).toBe('2025-12-31')
  })
  it('ein späteres Jahr: der 1. Januar', () => {
    expect(newPaymentDate(2027, heute)).toBe('2027-01-01')
  })
  it('örtlich gelesen, nicht in UTC: kurz nach Mitternacht am 1. Januar ist schon das neue Jahr', () => {
    const neujahr = new Date(2026, 0, 1, 0, 30)
    expect(newPaymentDate(2026, neujahr)).toBe('2026-01-01')
  })
})

describe('Mietkonto: der angebrochene Monat (#311)', () => {
  it('nennt den Anteil am Monat, ein voller Monat bleibt ohne Zusatz', () => {
    expect(shareText({ share: { days: 17, of: 31 } })).toBe('anteilig 17/31 Tage')
    expect(shareText({})).toBeNull()
  })
})

describe('Fälligkeit des laufenden Monats als Auskunft', () => {
  it('nennt kurz den dritten Werktag nach den Feiertagen am Ort, die Einzelheiten aufklappbar', () => {
    expect(rentDueNote(2027, new Date(2027, 0, 2), 'BW')).toEqual({
      text: 'Miete Januar fällig am Do., 07.01.2027',
      details: '3. Werktag, Samstag nicht mitgezählt; nach den Feiertagen in Baden-Württemberg. Das gilt, wenn der Mietvertrag nichts anderes bestimmt; bei einem sehr alten Mietverhältnis ohne vereinbarte Vorauszahlung kann die Miete erst nach Ablauf des Monats fällig sein (Art. 229 § 3 Abs. 1 Nr. 7 EGBGB). ' +
        'Rechtzeitig ist eine Überweisung, die bis zu diesem Tag in Auftrag gegeben ist; die Gutschrift kann später kommen.',
    })
    expect(rentDueNote(2026, new Date(2026, 7, 1), 'BE')?.text).toBe('Miete August fällig am Mi., 05.08.2026')
  })

  it('sagt nichts über den Rückstand (das Mietkonto zählt ihn noch nach #133)', () => {
    const note = rentDueNote(2026, new Date(2026, 9, 6), 'BW')
    expect(`${note?.text} ${note?.details}`).not.toMatch(/Rückstand/)
  })

  it('ohne Bundesland zählen nur die bundesweiten Feiertage, und das steht dabei', () => {
    const note = rentDueNote(2027, new Date(2027, 0, 2), null)
    expect(note?.text).toBe('Miete Januar fällig am Mi., 06.01.2027 (ohne Bundesland: nur bundesweite Feiertage)')
    expect(note?.details).toMatch(/nur nach den bundesweiten Feiertagen, weil beim Objekt kein Bundesland eingetragen ist/)
    expect(rentDueNote(2027, new Date(2027, 0, 2), undefined)).toEqual(note)
  })

  it('vor und nach dem Tag dieselbe Zeile', () => {
    expect(rentDueNote(2026, new Date(2026, 9, 5), 'BY')?.text).toBe('Miete Oktober fällig am Mo., 05.10.2026')
    expect(rentDueNote(2026, new Date(2026, 9, 6), 'BY')?.text).toBe('Miete Oktober fällig am Mo., 05.10.2026')
  })

  it('nur im laufenden Jahr', () => {
    expect(rentDueNote(2025, new Date(2026, 9, 6), 'BY')).toBeNull()
    expect(rentDueNote(2027, new Date(2026, 9, 6), 'BY')).toBeNull()
  })
})

describe('Fälligkeit: Feiertage einzelner Gemeinden', () => {
  // Fronleichnam am 03.06.2021 gilt in Sachsen nur in einzelnen Gemeinden. Landesweit ist der dritte
  // Werktag der 03.06., dort aber der 04.06.; ohne Hinweis nennte die Auskunft für diese Gemeinden einen Tag
  // zu früh, und ein Vermieter hielte eine pünktliche Zahlung für verspätet.
  it('nennt einen gemeindeweisen Feiertag, der die Frist dort verschiebt', () => {
    const note = rentDueNote(2021, new Date(2021, 5, 1), 'SN')
    expect(note?.text).toBe('Miete Juni fällig am Do., 03.06.2021')
    expect(note?.details).toMatch(/In Gemeinden, in denen am 03\.06\. Fronleichnam gilt, ist es ein Werktag später\./)
  })

  it('schweigt, wenn kein gemeindeweiser Feiertag in die Frist fällt', () => {
    expect(rentDueNote(2026, new Date(2026, 9, 6), 'BY')?.details).not.toMatch(/Gemeinden/)
    expect(rentDueNote(2021, new Date(2021, 5, 1), 'BE')?.details).not.toMatch(/Gemeinden/)
  })
})

// Durchsicht: Die Auskunft galt für das ganze Objekt, sobald irgendeine Zeile im Jahr Soll hatte. Beginnt das
// Mietverhältnis erst im laufenden Monat (anteilig, #311) oder endete das letzte im Vormonat, nannte sie
// einen Fälligkeitstag für eine Miete, die es so nicht gibt.
describe('Fälligkeit: nur wenn im laufenden Monat eine volle Monatsmiete geschuldet ist', () => {
  const zeile = (oktober: RentMonth): RentLedgerRow => ({ ...row(month(12, 100000, 'notDue')), months: Array.from({ length: 12 }, (_, i) => (i === 9 ? oktober : month(i + 1, 100000, 'notDue'))) })
  const okt = new Date(2026, 9, 6)

  it('ein voller Monat mit Soll: ja', () => {
    expect(rentDueApplies([zeile(month(10, 100000, 'notDue'))], 2026, okt)).toBe(true)
  })

  it('nur ein angebrochener Monat oder gar kein Soll im Monat: nein', () => {
    expect(rentDueApplies([zeile({ ...month(10, 54839, 'notDue'), share: { days: 17, of: 31 } })], 2026, okt)).toBe(false)
    expect(rentDueApplies([zeile(month(10, 0, 'notDue'))], 2026, okt)).toBe(false)
    expect(rentDueApplies([], 2026, okt)).toBe(false)
  })

  it('reicht eine Zeile mit vollem Monat neben einer anteiligen', () => {
    expect(rentDueApplies([zeile({ ...month(10, 54839, 'notDue'), share: { days: 17, of: 31 } }), zeile(month(10, 100000, 'notDue'))], 2026, okt)).toBe(true)
  })

  it('nur im laufenden Jahr', () => {
    expect(rentDueApplies([zeile(month(10, 100000, 'paid'))], 2025, okt)).toBe(false)
  })
})

// Durchsicht: Über der Auskunft „war fällig bis …“ stand „gestrichelte Monate sind noch nicht fällig“ und im
// Tooltip des laufenden Monats „noch nicht fällig“. Fällig ist er nach dem dritten Werktag; er zählt nur
// noch nicht als Rückstand (#133). Geprüft wird der Quelltext der Seite, wie in printCss.test.ts.
describe('Mietkonto: gestrichelte Monate heißen nicht „noch nicht fällig“', () => {
  it('weder im Hinweis über den Karten noch im Tooltip', async () => {
    const fsModule = 'node:fs'
    const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
    const page = fs.readFileSync(new URL('./pages/Mietkonto.tsx', import.meta.url), 'utf8')
    expect(page).not.toContain('gestrichelte Monate sind noch nicht fällig')
    expect(page).not.toContain("' · noch nicht fällig'")
    expect(page).toContain('gestrichelte Monate zählen noch nicht als Rückstand')
  })
})

// N6 aus #341: Die Farben der Monatskacheln haben eine Erklärung über den Karten.
describe('Mietkonto: die Kachelfarben sind erklärt', () => {
  it('Grün, Gelb und Rot stehen im Hinweis über den Karten', async () => {
    const fsModule = 'node:fs'
    const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
    const page = fs.readFileSync(new URL('./pages/Mietkonto.tsx', import.meta.url), 'utf8')
    expect(page).toContain('Grün heißt bezahlt, Gelb teilweise bezahlt, Rot offen')
  })
})
