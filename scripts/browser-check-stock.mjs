// Zustände, die nur der Browserlauf (browser-check.mjs) braucht (#584), zusätzlich zum Beispielbestand aus
// demo-stock.mjs. Die Bildschirmfotos (screenshots.mjs) und der Druck in Safari (safari-print-check.mjs) rufen das
// nicht auf, ihre Bilder und PDFs bleiben also, wie sie sind.
//
// Jeder Zustand steht in einem eigenen Objekt, damit die Seiten des Lindenwegs nicht unübersichtlich werden, und der
// Lauf prüft jede Seite der Navigation auch in jedem dieser Objekte (`passes`):
//   - „Birkenhof 3“: eine Wohnung mit Zimmern (WG, #573) mit drei vermieteten Zimmern neben einer gewöhnlichen
//     Wohnung, eine geschätzte Ablesung mit Begründung (#98) und Wasser nach Verbrauch mit Bezugszähler, Zählern
//     dahinter, verteiltem Rest und einem Zwischenzähler (#98). Die Abrechnung bleibt offen.
//   - „Kastanienallee 5, WE 7“ (aus demo-stock.mjs): abgeschlossen, noch nicht versendet (#337).
//   - „Ahornweg 4“: abgeschlossen und versendet (#337).
//
// **Alle Daten sind erfunden**, wie in demo-stock.mjs.
import { YEAR, PREV } from './demo-stock.mjs'


/**
 * Ein Objekt, dessen Seiten der Lauf ein weiteres Mal prüft. `id` hängt an der Kennung jeder Seite („zaehler@wg“),
 * `heating` sagt, ob die Navigation die Heizkosten zeigt, `expect` je Seite gezielte Prüfungen (siehe browser-check.mjs).
 * @typedef {{ selector: string, text: RegExp, absent?: boolean, why: string }} Expectation
 * @typedef {{ id: string, name: string, property: string, heating: boolean, expect: Record<string, Expectation[]> }} Pass
 */

/**
 * Legt die Zustände an und nennt die Objekte, deren Seiten zu prüfen sind.
 * @param {{ get: (p: string) => Promise<any>, post: (p: string, b?: unknown) => Promise<any>, put: (p: string, b?: unknown) => Promise<any> }} api
 * @param {{ haus: string, etw: string }} ids
 * @returns {Promise<Pass[]>}
 */
export async function seedBrowserCheck(api, ids) {
  const wg = await seedFlatShare(api)

  // Abgeschlossen, noch nicht versendet: die Eigentumswohnung aus dem Beispielbestand
  await api.post(`/api/settlement/${YEAR}/close?property=${ids.etw}`, {})

  // Abgeschlossen und versendet: ein kleines Haus. Versendet am 20. Januar nach dem Zeitraum, vor dem 20. Januar heute,
  // denn ein Datum nach heute lehnt der Server ab (shared/sentAt.ts). Heute in UTC wie der Server; die Oberfläche in
  // Berlin ist höchstens einen Tag weiter.
  const ahorn = await seedSmallHouse(api)
  const today = new Date().toISOString().slice(0, 10)
  const sentAt = `${YEAR + 1}-01-20` <= today ? `${YEAR + 1}-01-20` : today
  await api.post(`/api/settlement/${YEAR}/close?property=${ahorn}`, { sentAt })

  return [
    {
      id: 'wg', name: 'Birkenhof 3', property: wg, heating: false,
      expect: {
        // Die Gegenprobe zu 0.16.0: Die geschätzte Ablesung ist ein Hinweis, kein Fehler, und das Cockpit zählt die
        // Zählerstände als vollständig.
        'zaehler-staende': [
          { selector: 'main .notice-item.hint', text: /Ablesung geschätzt/, why: 'Die geschätzte Ablesung steht als Hinweis da.' },
          { selector: 'main .notice-item.error, main .notice-item.notice', text: /Ablesung geschätzt/, absent: true, why: 'Eine gültige geschätzte Ablesung ist kein Fehler und keine Warnung.' },
        ],
        cockpit: [
          { selector: 'main .check-row.gruen .check-title', text: /^Zählerstände$/, why: 'Mit einer geschätzten Ablesung sind die Zählerstände vollständig (grün).' },
        ],
        stammdaten: [
          { selector: 'main .badge', text: /^3 Zimmer$/, why: 'Die Wohnung mit Zimmern nennt in den Stammdaten ihre drei Zimmer.' },
          { selector: 'main .badge', text: /^über die Zimmer$/, why: 'Die Wohnung mit Zimmern wird über die Zimmer vermietet.' },
        ],
      },
    },
    {
      id: 'abgeschlossen', name: 'Kastanienallee 5, WE 7', property: ids.etw, heating: false,
      expect: {
        abrechnung: [
          { selector: 'main .badge', text: /^abgeschlossen$/, why: 'Die Abrechnung steht als abgeschlossen da.' },
          { selector: 'main button', text: /^Als versendet markieren$/, why: 'Abgeschlossen, aber nicht versendet: Der Schritt „Als versendet markieren“ steht da.' },
          { selector: 'main label.field', text: /^versendet am/, absent: true, why: 'Nicht versendet: Ein Feld „versendet am“ steht noch nicht da.' },
        ],
        cockpit: [
          { selector: 'main .badge', text: /^abgeschlossen$/, why: 'Das Cockpit nennt die Abrechnung abgeschlossen.' },
        ],
      },
    },
    {
      id: 'versendet', name: 'Ahornweg 4', property: ahorn, heating: false,
      expect: {
        abrechnung: [
          { selector: 'main .badge', text: /^abgeschlossen$/, why: 'Die Abrechnung steht als abgeschlossen da.' },
          { selector: 'main label.field', text: /^versendet am/, why: 'Versendet: Das Feld „versendet am“ trägt das gespeicherte Datum.' },
          { selector: 'main button', text: /^Als versendet markieren$/, absent: true, why: 'Versendet: „Als versendet markieren“ steht nicht mehr da.' },
        ],
        cockpit: [
          { selector: 'main .badge', text: /^versendet$/, why: 'Das Cockpit nennt die Abrechnung versendet.' },
        ],
      },
    },
  ]
}

// Birkenhof 3: eine WG im 1. OG (Wohnung mit drei Zimmern) und eine gewöhnliche Wohnung im EG
async function seedFlatShare(api) {
  const house = await api.post('/api/properties', { name: 'Birkenhof 3', kind: 'mfh', address: 'Birkenhof 3, 12345 Musterstadt' })
  const B = house.id
  const q = `?property=${B}`
  const unit = (body) => api.post(`/api/units${q}`, { participates: true, ...body })
  const eg = await unit({ name: 'EG', areaM2: 64, rooms: 3, floor: 'EG' })
  const flat = await unit({ name: '1. OG (WG)', areaM2: 96, rooms: 4, floor: '1. OG' })
  const rooms = [
    await unit({ name: 'Zimmer 1', areaM2: 18, parentUnitId: flat.id }),
    await unit({ name: 'Zimmer 2', areaM2: 15, parentUnitId: flat.id }),
    await unit({ name: 'Zimmer 3', areaM2: 13, parentUnitId: flat.id }),
  ]

  const tenancy = (body) => api.post(`/api/tenancies${q}`, { prepaymentOverrides: {}, end: null, ...body })
  const neumann = await tenancy({
    unitId: eg.id, tenantName: 'Paul Neumann', start: '2020-03-01', personHistory: [{ from: '2020-03-01', persons: 2 }],
    prepayments: [{ from: '2020-03', monthlyCents: 18000 }], baseRents: [{ from: '2020-03', monthlyCents: 54000 }],
  })
  const roomTenants = [['Ella Vogt', '2022-10-01', 9000, 38000], ['Can Demir', '2023-04-01', 8000, 34000], ['Nele Brandt', `${YEAR}-03-01`, 7000, 31000]]
  const roomTenancies = []
  for (const [i, [name, start, prepay, rent]] of roomTenants.entries()) {
    const month = String(start).slice(0, 7)
    roomTenancies.push(await tenancy({
      unitId: rooms[i].id, tenantName: name, start, personHistory: [{ from: start, persons: 1 }],
      prepayments: [{ from: month, monthlyCents: prepay }], baseRents: [{ from: month, monthlyCents: rent }],
    }))
  }
  for (const [t, from, cents] of [[neumann, 1, 72000], [roomTenancies[0], 1, 47000], [roomTenancies[1], 1, 42000], [roomTenancies[2], 3, 38000]]) {
    for (let m = Number(from); m <= 12; m++) {
      await api.post(`/api/payments${q}`, { tenancyId: t.id, date: `${YEAR}-${String(m).padStart(2, '0')}-03`, amountCents: cents })
    }
  }

  // Wasser: Hauptzähler als Bezugszähler, dahinter die Zähler der beiden Wohnungen und das Gartenwasser als
  // Zwischenzähler (Zähler für einen Teil des Hauses). Der Endstand im EG ist geschätzt.
  const meter = (body) => api.post(`/api/meters${q}`, { type: 'kaltwasser', unit: 'm³', ...body })
  const read = (m, date, value, extra = {}) => api.post(`/api/readings${q}`, { meterId: m.id, date, value, ...extra })
  const main = await meter({ name: 'Hauptwasserzähler', unitId: null, meterNumber: 'HW-30117' })
  const wgMeter = await meter({ name: 'Kaltwasser WG', unitId: flat.id, meterNumber: 'KW-3201' })
  const egMeter = await meter({ name: 'Kaltwasser EG', unitId: eg.id, meterNumber: 'KW-3101' })
  const garden = await meter({ name: 'Gartenwasser', unitId: null, scope: 'common', meterNumber: 'GW-3001' })
  for (const [m, start, end] of [[main, 1204.0, 1426.0], [wgMeter, 301.5, 412.0], [egMeter, 150.2, 230.4], [garden, 20.1, 32.3]]) {
    await read(m, `${PREV}-12-31`, start)
    if (m === egMeter) await read(m, `${YEAR}-12-31`, end, { estimated: true, estimateReason: 'Zähler nicht zugänglich, Mieter verreist' })
    else await read(m, `${YEAR}-12-31`, end)
  }

  const cost = (body) => api.post(`/api/costItems${q}`, { year: YEAR, vendor: '', ...body })
  await cost({
    category: 'Wasser/Abwasser', description: 'Frischwasser und Abwasser', vendor: 'Stadtwerke Musterstadt', amountCents: 98000,
    key: 'meter', meterType: 'kaltwasser',
    meterRest: {
      referenceMeterId: main.id, behindMeterIds: [wgMeter.id, egMeter.id], key: 'area', unitIds: null,
      subMeters: [{ meterId: garden.id, target: 'landlord' }],
    },
  })
  await cost({ category: 'Grundsteuer', description: `Grundsteuer B ${YEAR}`, vendor: 'Stadt Musterstadt', amountCents: 38400, key: 'area' })
  await cost({ category: 'Müllabfuhr', description: 'Restmüll und Biotonne', vendor: 'Abfallwirtschaft Musterkreis', amountCents: 52000, key: 'persons' })
  await cost({ category: 'Sach- und Haftpflichtversicherung', description: 'Wohngebäudeversicherung', vendor: 'Beispiel Versicherung AG', amountCents: 71000, key: 'area' })
  return B
}

// Ahornweg 4: ein Zweifamilienhaus mit zwei vermieteten Wohnungen und Kosten nach Fläche
async function seedSmallHouse(api) {
  const house = await api.post('/api/properties', { name: 'Ahornweg 4', kind: 'zfh', address: 'Ahornweg 4, 12345 Musterstadt' })
  const A = house.id
  const q = `?property=${A}`
  const unit = (body) => api.post(`/api/units${q}`, { participates: true, ...body })
  const unten = await unit({ name: 'Erdgeschoss', areaM2: 82, rooms: 3, floor: 'EG' })
  const oben = await unit({ name: 'Obergeschoss', areaM2: 76, rooms: 3, floor: '1. OG' })
  const tenancy = (body) => api.post(`/api/tenancies${q}`, { prepaymentOverrides: {}, end: null, ...body })
  const kraemer = await tenancy({
    unitId: unten.id, tenantName: 'Ida Krämer', start: '2018-06-01', personHistory: [{ from: '2018-06-01', persons: 2 }],
    prepayments: [{ from: '2018-06', monthlyCents: 15000 }], baseRents: [{ from: '2018-06', monthlyCents: 68000 }],
  })
  const albers = await tenancy({
    unitId: oben.id, tenantName: 'Tim Albers', start: '2021-01-01', personHistory: [{ from: '2021-01-01', persons: 1 }],
    prepayments: [{ from: '2021-01', monthlyCents: 13000 }], baseRents: [{ from: '2021-01', monthlyCents: 61000 }],
  })
  for (const [t, cents] of [[kraemer, 83000], [albers, 74000]]) {
    for (let m = 1; m <= 12; m++) await api.post(`/api/payments${q}`, { tenancyId: t.id, date: `${YEAR}-${String(m).padStart(2, '0')}-02`, amountCents: cents })
  }
  const cost = (body) => api.post(`/api/costItems${q}`, { year: YEAR, key: 'area', ...body })
  await cost({ category: 'Grundsteuer', description: `Grundsteuer B ${YEAR}`, vendor: 'Stadt Musterstadt', amountCents: 41200 })
  await cost({ category: 'Sach- und Haftpflichtversicherung', description: 'Wohngebäudeversicherung', vendor: 'Beispiel Versicherung AG', amountCents: 64000 })
  await cost({ category: 'Müllabfuhr', description: 'Restmüll und Biotonne', vendor: 'Abfallwirtschaft Musterkreis', amountCents: 38000, key: 'persons' })
  return A
}
