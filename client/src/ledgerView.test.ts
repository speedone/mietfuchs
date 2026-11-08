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
      .toBe('eingegangen am 20.11.2026, nach dem erwarteten Eingang; ob rechtzeitig überwiesen wurde, zeigt nur der Auftrag des Mieters')
    expect(monthDueText(month(3, 80000, 'paid'))).toBeNull()
  })
  it('die Einzelheiten nennen Land, Vertrag, Überweisungsauftrag und vier Bankgeschäftstage; die sichere Grenze nur ohne geprüfte Feiertage', () => {
    const nw = dueDetails('NW', false, { rule: 'startWorkday', agreed: false })
    expect(nw).toMatch(/Feiertage zählen nach Nordrhein-Westfalen, auch die einzelner Gemeinden/)
    expect(nw).toMatch(/ohne andere Vereinbarung/)
    expect(nw).toMatch(/in Auftrag gegeben/)
    expect(nw).toMatch(/vier Bankgeschäftstage/)
    expect(nw).toMatch(/Für den Rückstand zählen Feiertage erst/)
    expect(dueDetails('NW', true, { rule: 'startWorkday', agreed: false })).not.toMatch(/Für den Rückstand zählen Feiertage erst/)
    expect(dueDetails(null, false, { rule: 'startWorkday', agreed: false })).toMatch(/spätesten Tag aller Länder; am Ort kann die Miete früher fällig sein/)
    // Textdurchsicht 0.17.0: die sichere Grenze nennt auch die erste Miete, die schon bei Mietbeginn fällig ist (safeArrearsFrom).
    expect(nw).toMatch(/im Einzugsmonat, bei einer ersten Miete, die schon bei Mietbeginn fällig ist, bei einem festen Tag nach dem 14\. und nach Ablauf des Monats ab dem Ersten des übernächsten/)
  })
})

// Durchsicht der Oberfläche (#334): M1 Einzelheiten nach der Regel des Mietverhältnisses, S2/S3/S9 Randfälle der Zeile.
describe('Mietkonto: Fälligkeit, Durchsicht', () => {
  it('M1: die Einzelheiten nennen die Regel des Mietverhältnisses, beim Altvertrag „nach Ablauf“', () => {
    const old = dueDetails('NW', false, { rule: 'inArrears', agreed: false })
    expect(old).toMatch(/nach Ablauf des Monats fällig, weil das Mietverhältnis schon am 01\.09\.2001 bestand \(Art\. 229 § 3 Abs\. 1 Nr\. 7 EGBGB\)/)
    expect(old).not.toMatch(/spätestens am dritten Werktag/)
    expect(dueDetails('NW', false, { rule: 'inArrears', agreed: true })).toMatch(/laut Mietvertrag nach Ablauf des Monats/)
    expect(dueDetails('NW', false, { rule: 'dayOfMonth', agreed: true, day: 15 })).toMatch(/laut Mietvertrag am 15\. des Monats/)
    expect(dueDetails('NW', false, { rule: 'startWorkday', agreed: false })).toMatch(/zu Beginn des Monats, spätestens am dritten Werktag/)
    expect(dueDetails('NW', false, { rule: 'startWorkday', agreed: false, firstRentAtStart: true })).toMatch(/erste Miete ist laut Mietvertrag schon bei Mietbeginn fällig; ob diese Klausel wirksam ist, ist nicht höchstrichterlich geklärt/)
    // S4: Feiertage einzelner Gemeinden zählen mit, am Ort kann es früher sein.
    expect(dueDetails('SN', false, { rule: 'startWorkday', agreed: false })).toMatch(/wo sie nicht gelten, kann die Miete einen Werktag früher fällig sein/)
    // S6: die Lastschrift mit Vorbehalt.
    expect(old).toMatch(/zur Miete nicht eigens entschieden/)
  })
  it('S2: ein Monat, der nur noch über die Abrechnung offen ist, ist nicht rot „offen seit“', () => {
    const via = { ...due(3, 'open', '2025-03-05', '2025-03-11', '2025-03-12'), notDemandableCents: 80000 }
    const r = card([month(1, 80000, 'paid'), month(2, 80000, 'paid'), via, ...Array.from({ length: 9 }, (_, i) => month(i + 4, 80000, 'paid'))])
    expect(dueLine(r, '2026-11-07')).toBeNull()
  })
  it('S3: ein später bezahlter Monat ist nicht „offen seit“', () => {
    const later = { ...due(12, 'open', '2025-12-03', '2025-12-09', '2025-12-10'), paidLaterOn: '2026-01-15' }
    const r = card([...Array.from({ length: 11 }, (_, i) => month(i + 1, 80000, 'paid')), later])
    expect(dueLine(r, '2026-11-07')).toBeNull()
  })
  it('S9: kommendes Jahr, ausgezogen, Rückstand nur aus dem Vorjahr', () => {
    // Kommendes Jahr: nichts fällig, die Zeile nennt den Januar.
    const next = card(Array.from({ length: 12 }, (_, i) => due(i + 1, 'notDue', `2027-${String(i + 1).padStart(2, '0')}-05`, `2027-${String(i + 1).padStart(2, '0')}-11`, `2027-${String(i + 1).padStart(2, '0')}-12`)))
    expect(rowStanding(next, '2026-11-07')).toEqual({ kind: 'nothingDue', cents: 0 })
    expect(dueLine(next, '2026-11-07')?.text).toBe('Miete Januar fällig am Di., 05.01.2027')
    // Ausgezogen im Juni, alles bezahlt: keine Zeile.
    const gone = card([...Array.from({ length: 6 }, (_, i) => month(i + 1, 80000, 'paid')), ...Array.from({ length: 6 }, (_, i) => month(i + 7, 0, 'paid'))])
    expect(dueLine(gone, '2026-11-07')).toBeNull()
    // Rückstand nur aus dem Vorjahr: rote Plakette, die Zeile nennt neutral den nächsten Monat.
    const carried = card(moveIn('notDue'), { arrearsCents: 50000, openingBalanceCents: -50000 })
    expect(rowStanding(carried, '2026-10-12').kind).toBe('arrears')
    expect(dueLine(carried, '2026-10-12')).toEqual({ text: 'Miete Oktober fällig am Di., 13.10.2026', tone: 'muted' })
  })
  it('das Kästchen nennt „fällig am“ nur, solange der Monat nicht bezahlt ist', () => {
    expect(monthDueText(due(11, 'paid', '2026-11-04', '2026-11-10', '2026-11-11'))).toBeNull()
    expect(monthDueText(due(11, 'open', '2026-11-04', '2026-11-10', '2026-11-11'))).toBe('fällig am 04.11.2026')
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
