import { describe, expect, it } from 'vitest'
import type { RentLedgerRow, RentMonth, RentMonthStatus } from './types'
import { bookingDate, carriedText, ledgerStartText, carryText, closingLines, newPaymentDate, notDemandableNotes, openPartsText, paidLaterText, dueDetails, dueLine, monthDueText, rowStanding, shareText } from './ledgerView'

const month = (m: number, sollCents: number, status: RentMonthStatus): RentMonth => ({
  month: m, baseRentCents: sollCents, prepaymentCents: 0, flatRateCents: 0, sollCents, paidCents: status === 'paid' ? sollCents : 0, status,
  openPrepaymentCents: 0, openRentCents: status === 'paid' ? 0 : sollCents,
})

// Eine Zeile mit zwölf Monaten, deren Dezember sich vorgeben lässt. Über den Typ gebaut, damit
// der Übersetzer mitprüft, dass hier wirklich eine Mietkonto-Zeile steht.
const row = (dezember: RentMonth): RentLedgerRow => ({
  tenancyId: 't1', tenantName: 'Müller', unitName: 'OG',
  months: [...Array.from({ length: 11 }, (_, i) => month(i + 1, 100000, 'paid')), dezember],
  sollYearCents: 1200000, baseRentYearCents: 1200000, prepaymentYearCents: 0, flatRateYearCents: 0,
  paidYearCents: 1100000, settlementYearCents: 0, balanceCents: -100000, dueSollCents: 1200000, arrearsCents: 100000, openMonths: 1,
  notDemandableCents: 0, notDemandable: [], openingBalanceCents: 0, closingBalanceCents: -100000,
})

const heute = new Date('2026-09-22T00:00:00Z')

// **Seit #281 entfällt der Hinweis zum offenen Dezember** (#70): Das Mietkonto rechnet ab Beginn, eine im Januar
// eingegangene Dezembermiete deckt den Dezember („bezahlt am …“), und ein Rückstand steht im Folgejahr als Übertrag.
describe('Mietkonto: Übertrag, Stand zum Jahresende und offene Teile (#281)', () => {
  // fmtEuro setzt ein geschütztes Leerzeichen vor das Eurozeichen.
  const plain = (t: string | null | undefined): string | null => (t === null || t === undefined ? null : t.replace(/\s/g, ' '))
  it('der Übertrag aus dem Vorjahr: Rückstand, vorausbezahlt oder nichts', () => {
    expect(plain(carryText({ ...row(month(12, 100000, 'paid')), openingBalanceCents: -80000 }, 2025))).toBe('Übertrag aus 2024: Rückstand 800,00 €')
    expect(plain(carryText({ ...row(month(12, 100000, 'paid')), openingBalanceCents: 80000 }, 2025))).toBe('Übertrag aus 2024: vorausbezahlt 800,00 €')
    expect(plain(carryText({ ...row(month(12, 100000, 'paid')), openingBalanceCents: 0 }, 2025))).toBeNull()
  })

  it('der Stand zum 31.12. mit Rückstand und nicht mehr einzeln einforderbarem Teil, jeweils nur, wenn nicht 0', () => {
    const r: RentLedgerRow = { ...row(month(12, 100000, 'open')), closingBalanceCents: -100000, arrearsCents: 80000, notDemandableCents: 20000 }
    expect(closingLines(r, 2025)).toEqual([
      { label: 'Stand 31.12.2025', cents: -100000, tone: 'red' },
      { label: 'davon Rückstand', cents: 80000, tone: 'red' },
      { label: 'davon nicht mehr einzeln einforderbar', cents: 20000, tone: 'muted' },
    ])
    expect(closingLines({ ...r, closingBalanceCents: 30000, arrearsCents: 0, notDemandableCents: 0 }, 2025)).toEqual([
      { label: 'Stand 31.12.2025', cents: 30000, tone: 'green' },
    ])
  })

  it('ein teilweise bezahlter Monat nennt, was offen ist, damit die Reihenfolge sichtbar wird', () => {
    const teil: RentMonth = { ...month(1, 80000, 'partial'), baseRentCents: 60000, prepaymentCents: 20000, paidCents: 30000, openPrepaymentCents: 0, openRentCents: 50000 }
    expect(plain(openPartsText(teil))).toBe('offen: Vorauszahlung 0,00 €, Kaltmiete 500,00 €')
    expect(plain(openPartsText({ ...teil, flatRateCents: 5000 }))).toBe('offen: Vorauszahlung 0,00 €, Kaltmiete und Pauschale 500,00 €')
    expect(plain(openPartsText({ ...teil, baseRentCents: 0, flatRateCents: 60000 }))).toBe('offen: Vorauszahlung 0,00 €, Pauschale 500,00 €')
    expect(plain(openPartsText(month(1, 80000, 'paid')))).toBeNull()
    expect(plain(openPartsText(month(1, 80000, 'open')))).toBeNull()
  })

  it('später bezahlt: kleiner Zusatz mit dem Datum', () => {
    expect(plain(paidLaterText({ ...month(12, 80000, 'open'), paidLaterOn: '2026-02-15' }))).toBe('bezahlt am 15.02.2026')
    expect(plain(paidLaterText(month(12, 80000, 'open')))).toBeNull()
  })

  it('je Grund ein eigener Satz mit Zeitraum und Betrag; nur „in der Abrechnung enthalten“ sagt „enthalten“', () => {
    const r: RentLedgerRow = {
      ...row(month(12, 100000, 'open')),
      notDemandableCents: 60000,
      notDemandable: [
        { reason: 'inStatement', label: '2023', cents: 10000 },
        { reason: 'creditedAsPaid', label: '2024', cents: 20000, differenceCents: 20000 },
        { reason: 'deadlinePassed', label: '2022', cents: 30000 },
      ],
    }
    const notes = notDemandableNotes(r.notDemandable)
    expect(notes.map((n) => n.level)).toEqual(['hint', 'warning', 'hint'])
    expect(plain(notes[0]?.text)).toBe('In der Abrechnung 2023 enthalten (100,00 €): Die nicht gezahlte Vorauszahlung steckt im Saldo der Abrechnung; fordern Sie diesen, nicht die Vorauszahlung.')
    expect(plain(notes[1]?.text)).toBe('Die Abrechnung 2024 rechnet 200,00 € Vorauszahlung als gezahlt an, die nicht eingegangen sind. Einzeln verlangen lässt sich die Vorauszahlung nicht mehr. Ob eine berichtigte Abrechnung den Betrag noch einfordern kann, hängt an der Abrechnungsfrist (§ 556 Abs. 3 Satz 3 BGB); besprechen Sie das im Zweifel mit einer Beratung.')
    expect(plain(notes[2]?.text)).toBe('Die Abrechnungsfrist für 2022 ist abgelaufen. Die Vorauszahlung (300,00 €) lässt sich nicht mehr einzeln verlangen, nur noch über die Abrechnung.')
    expect(notes.filter((n) => n.text.includes('enthalten'))).toHaveLength(1)
  })

  it('geführt ab der ersten erfassten Mietzahlung: eine gedämpfte Zeile, nur wenn nach dem Mietbeginn', () => {
    expect(ledgerStartText({ ...row(month(12, 100000, 'paid')), ledgerStart: '2025-01-01' }))
      .toBe('Mietkonto geführt ab Januar 2025 (erste erfasste Mietzahlung); frühere Monate sind nicht erfasst.')
    expect(ledgerStartText(row(month(12, 100000, 'paid')))).toBeNull()
    // Dauerauftrag zum Monatsende (Integrationsdurchsicht 0.14): Die erste Zahlung lag im Vormonat.
    expect(ledgerStartText({ ...row(month(12, 100000, 'paid')), ledgerStart: '2024-01-01', ledgerStartPaidOn: '2023-12-30' }))
      .toBe('Mietkonto geführt ab Januar 2024: Die erste erfasste Mietzahlung vom 30.12.2023 gilt als Miete für Januar; frühere Monate sind nicht erfasst. Ist sie die Miete ihres eigenen Monats, tragen Sie diesen Monat an der Zahlung als Monat laut Verwendungszweck ein.')
  })

  it('ein Ausgezogener mit offenem Saldo', () => {
    expect(plain(carriedText({ tenancyId: 't', tenantName: 'Schmidt', unitName: 'EG', end: '2024-06-30', openCents: 80000, notDemandableCents: 0, notDemandable: [] })))
      .toBe('Schmidt, ausgezogen am 30.06.2024: offen 800,00 €')
    expect(plain(carriedText({ tenancyId: 't', tenantName: 'Schmidt', unitName: 'EG', end: '2024-06-30', openCents: 60000, notDemandableCents: 20000, notDemandable: [] })))
      .toBe('Schmidt, ausgezogen am 30.06.2024: offen 600,00 €, dazu 200,00 € nicht mehr einzeln einforderbar')
  })
})

describe('Mietkonto: Stand einer Zeile (#133, #281: aus Endsaldo und Rückstand)', () => {
  const zeile = (over: Partial<RentLedgerRow>): RentLedgerRow => ({ ...row(month(12, 100000, 'notDue')), ...over })
  it('künftige Monate sind kein Rückstand: „bisher bezahlt“', () => {
    expect(rowStanding(zeile({ closingBalanceCents: -300000, arrearsCents: 0 }))).toEqual({ kind: 'paidSoFar', cents: 300000 })
  })
  it('ein fälliger offener Monat ist ein Rückstand, auch aus dem Vorjahr', () => {
    expect(rowStanding(zeile({ closingBalanceCents: -400000, arrearsCents: 100000 }))).toEqual({ kind: 'arrears', cents: 100000 })
    // Das Jahr allein ausgeglichen, aber ein Übertrag offen: Rückstand, nicht „vollständig bezahlt“.
    expect(rowStanding(zeile({ balanceCents: 0, openingBalanceCents: -80000, closingBalanceCents: -80000, arrearsCents: 80000 }))).toEqual({ kind: 'arrears', cents: 80000 })
  })
  it('vorausbezahlt und ganz bezahlt nach dem Endsaldo, nicht nach dem Jahr allein', () => {
    expect(rowStanding(zeile({ balanceCents: 100000, closingBalanceCents: 100000, arrearsCents: 0 }))).toEqual({ kind: 'credit', cents: 100000 })
    // Im Jahr 800 € mehr gezahlt, die einen Rückstand des Vorjahres tilgen: ausgeglichen, kein Guthaben.
    expect(rowStanding(zeile({ balanceCents: 80000, openingBalanceCents: -80000, closingBalanceCents: 0, arrearsCents: 0 }))).toEqual({ kind: 'paid', cents: 0 })
  })
  it('nur noch über die Abrechnung offen: eigener Stand, kein Rückstand', () => {
    expect(rowStanding(zeile({ closingBalanceCents: -20000, arrearsCents: 0, notDemandableCents: 20000 }))).toEqual({ kind: 'viaSettlement', cents: 20000 })
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

// #334: Fälligkeit je Karte aus den Daten des Servers; die Plaketten sagen nie „bisher bezahlt“, wenn nichts fällig war.
const due = (m: number, status: RentMonthStatus, dueOn: string, creditExpectedBy: string, arrearsFrom: string, extra: Partial<RentMonth> = {}): RentMonth => ({ ...month(m, 80000, status), dueOn, creditExpectedBy, arrearsFrom, ...extra })
const card = (months: RentMonth[], over: Partial<RentLedgerRow> = {}): RentLedgerRow => ({ ...row(month(12, 80000, 'notDue')), months, arrearsCents: 0, closingBalanceCents: -months.reduce((a, m) => a + m.sollCents - m.paidCents, 0), openingBalanceCents: 0, ...over })
// Einzug Fr 09.10.2026: Oktober fällig 13.10., erwartet bis 19.10.; November fällig 04.11., erwartet bis 10.11.
const october = (status: RentMonthStatus) => due(10, status, '2026-10-13', '2026-10-19', '2026-10-20')
const november = due(11, 'notDue', '2026-11-04', '2026-11-10', '2026-11-11')
const moveIn = (status: RentMonthStatus): RentMonth[] => [...Array.from({ length: 9 }, (_, i) => month(i + 1, 0, 'paid')), october(status), november, month(12, 80000, 'notDue')]

describe('Mietkonto: Fälligkeit je Karte (#334)', () => {
  it('vor dem Fälligkeitstag: „fällig am“, die Plakette „noch nichts fällig“, nicht „bisher bezahlt“', () => {
    const r = card(moveIn('notDue'))
    expect(dueLine(r, '2026-10-12')).toEqual({ text: 'Miete Oktober fällig am Di., 13.10.2026', tone: 'muted' })
    expect(rowStanding(r, '2026-10-12')).toEqual({ kind: 'nothingDue', cents: 0 })
  })
  it('ab dem Fälligkeitstag bis zum erwarteten Eingang: „fällig seit …, Eingang erwartet bis …“, neutral', () => {
    const r = card(moveIn('notDue'))
    for (const asOf of ['2026-10-13', '2026-10-19']) {
      expect(dueLine(r, asOf)).toEqual({ text: 'Miete Oktober fällig seit 13.10., Eingang erwartet bis 19.10.', tone: 'muted' })
      expect(rowStanding(r, asOf)).toEqual({ kind: 'dueAwaiting', cents: 80000, since: '2026-10-13' })
    }
  })
  it('danach Rückstand: rot „offen seit“', () => {
    const r = card(moveIn('open'), { arrearsCents: 80000 })
    expect(dueLine(r, '2026-10-20')).toEqual({ text: 'Miete Oktober offen seit 13.10.2026', tone: 'red' })
    expect(rowStanding(r, '2026-10-20')).toEqual({ kind: 'arrears', cents: 80000 })
  })
  it('ohne geprüfte Feiertage zählt der Rückstand ab der sicheren Grenze, und die Zeile nennt diesen Tag', () => {
    const safe = [...Array.from({ length: 9 }, (_, i) => month(i + 1, 0, 'paid')), due(10, 'notDue', '2026-10-13', '2026-10-19', '2026-12-01'), month(11, 80000, 'notDue'), month(12, 80000, 'notDue')]
    expect(dueLine(card(safe), '2026-10-25')).toEqual({ text: 'Miete Oktober fällig seit 13.10., zählt als Rückstand ab 01.12.2026', tone: 'muted' })
  })
  it('bezahlt: der nächste Monat; „bisher bezahlt“ erst, wenn ein fälliger Monat gedeckt ist', () => {
    const paidOct = [...Array.from({ length: 9 }, (_, i) => month(i + 1, 0, 'paid')), october('paid'), november, month(12, 80000, 'notDue')]
    const r = card(paidOct)
    expect(dueLine(r, '2026-10-25')).toEqual({ text: 'Miete November fällig am Mi., 04.11.2026', tone: 'muted' })
    expect(rowStanding(r, '2026-10-25')).toEqual({ kind: 'paidSoFar', cents: 160000 })
    // Im Voraus bezahlt, aber noch nichts fällig: kein „bisher bezahlt“.
    expect(rowStanding(r, '2026-10-12')).toEqual({ kind: 'nothingDue', cents: 0 })
    // Ein Übertrag aus dem Vorjahr ist schon Geschichte: kein „noch nichts fällig“ bei einem Rückstand davor.
    expect(rowStanding(card(moveIn('notDue'), { openingBalanceCents: -1 }), '2026-10-12').kind).toBe('paidSoFar')
  })
  it('ohne Stichtag (älterer Server) keine Zeile und die bisherigen Plaketten', () => {
    expect(dueLine(card(moveIn('notDue')), undefined)).toBeNull()
    expect(rowStanding({ ...row(month(12, 100000, 'notDue')), closingBalanceCents: -300000, arrearsCents: 0 })).toEqual({ kind: 'paidSoFar', cents: 300000 })
  })
  it('das Monatskästchen nennt den Fälligkeitstag und einen späten Eingang nur zur Prüfung', () => {
    expect(monthDueText(october('notDue'))).toBe('fällig am 13.10.2026')
    expect(monthDueText({ ...due(11, 'paid', '2026-11-04', '2026-11-10', '2026-11-11'), paidAfterExpected: '2026-11-20' }))
      .toBe('fällig am 04.11.2026 · eingegangen am 20.11.2026, nach dem erwarteten Eingang; ob rechtzeitig überwiesen wurde, zeigt nur der Auftrag des Mieters')
    expect(monthDueText(month(3, 80000, 'paid'))).toBeNull()
  })
  it('die Einzelheiten nennen Land, Vertrag, Überweisungsauftrag und vier Bankgeschäftstage; die sichere Grenze nur ohne geprüfte Feiertage', () => {
    const nw = dueDetails('NW', false)
    expect(nw).toMatch(/Feiertagen in Nordrhein-Westfalen, auch denen einzelner Gemeinden/)
    expect(nw).toMatch(/wenn der Mietvertrag nichts anderes bestimmt/)
    expect(nw).toMatch(/in Auftrag gegeben/)
    expect(nw).toMatch(/vier Bankgeschäftstage/)
    expect(nw).toMatch(/vorsichtig ohne Feiertage/)
    expect(dueDetails('NW', true)).not.toMatch(/vorsichtig ohne Feiertage/)
    expect(dueDetails(null, false)).toMatch(/spätesten Tag aller Länder; am Ort kann sie früher sein/)
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
