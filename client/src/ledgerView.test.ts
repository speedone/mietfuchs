import { describe, expect, it } from 'vitest'
import type { RentLedgerRow, RentMonth, RentMonthStatus } from './types'
import { bookingDate, carriedText, ledgerStartText, carryText, closingLines, newPaymentDate, notDemandableNotes, openPartsText, paidLaterText, rentDueApplies, rentDueNote, rowStanding, shareText } from './ledgerView'

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
