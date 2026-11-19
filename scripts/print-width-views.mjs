// Die übrigen Druckansichten für die Prüfung der Druckbreite (#647): Ableseformular, Kaution, monatliche
// Verbrauchsinformation, CO₂-Blatt, E-Rechnung, getrennte Heizkostenabrechnung, Ableseergebnis und Steuer. Die Seite
// Abrechnung prüft print-width-check.mjs selbst; hier stehen nur die Wege zu den anderen Blättern.
//
// Je Ansicht:
//   - `setup(api, ids, stock)` legt über die API an, was die Ansicht über den Beispielbestand (demo-stock.mjs) hinaus
//     braucht. Alle laufen einmal vor der ersten Ansicht, in der Reihenfolge der Liste. Was die Abrechnung von Lindenweg
//     und Eigentumswohnung ändern könnte (Heizanlage, Heizperiode, Belege), kommt in zwei eigene Objekte, „Ulmenweg 7“
//     (eigene Heizkostenabrechnung mit fernablesbaren Wärmezählern) und „Erlenstraße 9“ (getrennte Heizkostenabrechnung,
//     Weg d). Ihre Kennungen trägt `setup` in `ids` ein (`ids.ulmenweg`, `ids.erlenstrasse`), `open` liest sie dort.
//     Am Lindenweg kommen nur Kautionsbuchungen des ausgezogenen Mieters dazu. Alle Daten sind erfunden.
//   - `open(page, ids)` bedient die Oberfläche wie ein Mensch (Objekt im Umschalter der Seitenleiste, Seite in der
//     Navigation, Knöpfe nach ihrem Text, Rückfragen bejahen), bis `window.print()` gerufen wurde (`window.__printed`).
//     Die Seite steht dann so, wie der Browser sie druckt. `window.print` muss der Aufrufer vorher ersetzen (siehe
//     `stubPrint`); nach einem Seitenaufruf (E-Rechnung) setzt `open` den Zähler selbst neu, falls er fehlt.
//
// Allein aufgerufen startet das Skript den Beispielbestand, öffnet jede Ansicht in einem frischen Chromium und meldet
// Breite im Druck, hinausragende Elemente und die Seitenzahl ihrer PDF:
//
//   node scripts/print-width-views.mjs [--out <ordner>] [--only name,name]
//
// Exit 0, wenn jede Ansicht sich öffnen ließ (auch mit zu breitem Inhalt), 1 wenn nicht, 2 wenn der Lauf scheitert.
// Voraussetzungen: `npm install`, `npm run build`, `npx playwright install chromium`.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** @typedef {import('playwright').Page} Page */
/** @typedef {ReturnType<typeof import('./demo-stock.mjs').client>} Api */
/** @typedef {Record<string, string>} Ids */
/** @typedef {typeof import('./demo-stock.mjs')} Stock */
/** @typedef {{ name: string, label: string, setup?: (api: Api, ids: Ids, stock: Stock) => Promise<void>, open: (page: Page, ids: Ids) => Promise<void> }} PrintView */

// Ein Wort ohne Trennstelle, wie es als Beschreibung oder Firmenname vorkommt (auch in print-width-check.mjs)
export const LONG_WORD = 'Wartungsvertragsverlängerungsvereinbarungsnachtragsrechnungsposition'

// Wie lange auf ein Element gewartet wird, bevor die Ansicht als nicht erreichbar gilt
const WAIT_MS = 20000

// ---------- Bedienung ----------

/** Ersetzt `window.print` durch einen Zähler; für `page.addInitScript` und für `page.evaluate`. */
export function stubPrint() {
  const win = /** @type {any} */ (globalThis)
  if (typeof win.__printed === 'number') return
  win.__printed = 0
  win.print = () => { win.__printed += 1 }
}

/**
 * Wartet, bis der Locator sichtbar ist, sonst ein Fehler mit Ansage.
 * @param {import('playwright').Locator} locator
 * @param {string} what
 */
async function shown(locator, what, timeout = WAIT_MS) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout })
  } catch {
    throw new Error(`Nicht erschienen: ${what}`)
  }
  return locator.first()
}

/**
 * Wartet, bis der Locator im Dokument steht (auch am Bildschirm ausgeblendet, etwa ein Blatt nur für den Druck).
 * @param {import('playwright').Locator} locator
 * @param {string} what
 */
async function attached(locator, what, timeout = 5000) {
  try {
    await locator.first().waitFor({ state: 'attached', timeout })
  } catch {
    throw new Error(`Nicht im Dokument: ${what}`)
  }
}

/**
 * Beantwortet eine offene Rückfrage mit dem Knopf, der weitermacht (wie safari-print-check.mjs).
 * @param {Page} page
 */
async function answerQuestion(page) {
  return page.evaluate(() => {
    const win = /** @type {any} */ (globalThis)
    const ask = win.document.querySelector('dialog[open][role="alertdialog"]')
    if (!ask) return null
    const text = (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    const buttons = [...ask.querySelectorAll('button')]
    const yes = buttons.find((b) => /drucken|verwerfen|öffnen/i.test(text(b)) && !/nicht|abbrechen/i.test(text(b))) ?? buttons[buttons.length - 1]
    yes?.click()
    return yes ? text(yes) : null
  })
}

/**
 * Wartet auf `window.print()`, bejaht unterwegs Rückfragen.
 * @param {Page} page
 * @param {string} what
 */
async function untilPrinted(page, what) {
  const end = Date.now() + WAIT_MS
  for (;;) {
    const printed = await page.evaluate(() => /** @type {any} */ (globalThis).__printed)
    if (typeof printed !== 'number') throw new Error('window.print ist nicht ersetzt (window.__printed fehlt); vorher stubPrint() als Init-Skript setzen')
    if (printed > 0) break
    if (Date.now() > end) throw new Error(`window.print() kam nicht: ${what}`)
    await answerQuestion(page)
    await page.waitForTimeout(150)
  }
  // Was nach dem Druckaufruf noch nachlädt (Bilder, Schriften)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
}

/**
 * Wählt das Objekt im Umschalter der Seitenleiste, wenn es nicht schon gewählt ist.
 * @param {Page} page
 * @param {string | undefined} id
 * @param {string} name
 */
async function chooseProperty(page, id, name) {
  if (!id) throw new Error(`Objekt „${name}“ fehlt in ids; lief setup dieser Ansicht?`)
  const select = await shown(page.locator('nav.sidebar select[aria-label="Objekt wählen"], select[aria-label="Objekt wählen"]'), 'Umschalter „Objekt“ in der Seitenleiste')
  if ((await select.inputValue()) === id) return
  await select.selectOption(id)
  await answerQuestion(page)
  await page.waitForLoadState('networkidle')
  const now = await select.inputValue()
  if (now !== id) throw new Error(`Objekt „${name}“ ließ sich nicht wählen (gewählt: ${now})`)
}

/**
 * Öffnet eine Seite über die Navigation der Seitenleiste.
 * @param {Page} page
 * @param {string} label
 */
async function navigate(page, label) {
  const button = await shown(page.locator('nav.sidebar button', { hasText: label }), `„${label}“ in der Seitenleiste`)
  await button.click()
  await answerQuestion(page)
  await page.waitForLoadState('networkidle')
}

/**
 * Ein Knopf nach seinem Text, innerhalb von `scope`.
 * @param {Page | import('playwright').Locator} scope
 * @param {string | RegExp} name
 * @param {string} what
 */
async function clickButton(scope, name, what) {
  const button = await shown(scope.locator('button:not([disabled])', { hasText: name }), what)
  await button.click()
}

/**
 * Ein offenes Seitenfenster mit seiner Überschrift.
 * @param {Page} page
 * @param {string} title
 */
async function drawer(page, title) {
  return shown(page.locator('dialog[open]').filter({ has: page.locator('h2', { hasText: title }) }), `Fenster „${title}“`)
}

// ---------- Bestand ----------

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const monthEnd = (year, month) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)

/**
 * Ein Objekt mit Wohnungen und laufenden Mietverhältnissen.
 * @param {Api} api
 * @param {{ name: string, address: string, flats: { name: string, areaM2: number, floor: string, tenant: string, start: string, prepay: number, rent: number }[] }} spec
 */
async function createHouse(api, spec) {
  const property = await api.post('/api/properties', { name: spec.name, kind: 'mfh', address: spec.address })
  const q = `?property=${property.id}`
  const flats = []
  for (const f of spec.flats) {
    const unit = await api.post(`/api/units${q}`, { name: f.name, areaM2: f.areaM2, rooms: 3, floor: f.floor, participates: true })
    const month = f.start.slice(0, 7)
    const tenancy = await api.post(`/api/tenancies${q}`, {
      unitId: unit.id, tenantName: f.tenant, start: f.start, end: null, personHistory: [{ from: f.start, persons: 2 }],
      prepayments: [{ from: month, monthlyCents: f.prepay }], prepaymentOverrides: {}, baseRents: [{ from: month, monthlyCents: f.rent }],
    })
    flats.push({ unit, tenancy })
  }
  return { id: /** @type {string} */ (property.id), q, flats }
}

// „Ulmenweg 7“: Gasheizung mit eigener Heizkostenabrechnung (Wärmezähler je Wohnung, fernablesbar, Stände an jedem
// Monatsende), dazu eine Gasrechnung als Lieferung für das CO₂-Blatt. Einmal angelegt, auch wenn mehrere Ansichten es
// brauchen.
/** @param {Api} api @param {Ids} ids @param {Stock} stock */
async function ensureUlmenweg(api, ids, stock) {
  if (ids.ulmenweg) return
  const { YEAR, PREV } = stock
  const house = await createHouse(api, {
    name: 'Ulmenweg 7', address: 'Ulmenweg 7, 12345 Musterstadt', flats: [
      { name: 'EG', areaM2: 74, floor: 'EG', tenant: 'Paul Richter', start: '2020-03-01', prepay: 21000, rent: 61000 },
      { name: 'OG', areaM2: 68, floor: '1. OG', tenant: 'Merve Aksoy', start: '2021-06-01', prepay: 19000, rent: 57000 },
    ],
  })
  const { plant } = await api.post(`/api/heating-plants${house.q}`, { energy: 'gas', method: 'manual' })
  const self = await api.put(`/api/heating-plants/${plant.id}/self`, {
    period: `${YEAR}-01`, heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'none', capture: 'heatMeter', dhwHeatMeter: false, totalHeatMeter: false,
  })
  /** @type {any[]} */
  const created = self.created ?? []
  const heatMeters = created.filter((m) => m.unitId && m.type === 'waerme')
  if (heatMeters.length !== house.flats.length) throw new Error(`Ulmenweg 7: ${heatMeters.length} Wärmezähler angelegt, erwartet ${house.flats.length}: ${JSON.stringify(created).slice(0, 300)}`)
  // Verbrauch je Monat in kWh, Winter mehr als Sommer
  const profile = [1900, 1650, 1300, 800, 420, 160, 110, 110, 300, 820, 1350, 1800]
  for (const [i, meter] of heatMeters.entries()) {
    await api.put(`/api/meters/${meter.id}${house.q}`, { ...meter, meterNumber: `WMZ-7${i + 1}0`, remoteReadable: true, installedOn: '2022-09-01' })
    const scale = meter.unit === 'MWh' ? 1000 : 1
    const factor = i === 0 ? 1 : 0.85
    let value = 21000 + i * 6000
    await api.post(`/api/readings${house.q}`, { meterId: meter.id, date: `${PREV}-12-31`, value: value / scale })
    for (const m of range(1, 12)) {
      value += Math.round(profile[m - 1] * factor)
      await api.post(`/api/readings${house.q}`, { meterId: meter.id, date: monthEnd(YEAR, m), value: value / scale })
    }
  }
  // Bei eigener Abrechnung steht der Betrag in der Position, die Rechnung (Lieferung) trägt Energie und CO₂
  const delivery = await api.post(`/api/heating-plants/${plant.id}/deliveries`, {
    label: `Erdgas ${YEAR} ${LONG_WORD}`, invoiceFrom: `${YEAR}-01-01`, invoiceTo: `${YEAR}-12-31`, invoiceDate: `${YEAR + 1}-01-20`,
    energyKwh: 24000, gasBasis: 'hs', emissionsKg: 4353, co2CostCents: 28480,
  })
  const item = (body) => api.post(`/api/costItems${house.q}`, { year: YEAR, category: 'Heizung und Warmwasser', key: 'heatingSystem', heatingPlantId: plant.id, heatingTarget: 'heating', ...body })
  await item({ description: `Erdgas ${YEAR}`, vendor: 'Energieversorgung Musterstadt', amountCents: 286400, heatingPart: 'fuel', fuelDeliveryId: delivery.id ?? delivery.delivery?.id })
  await item({ description: 'Wartung Gasbrennwertkessel', vendor: 'Heizungsbau Beispiel GmbH', amountCents: 31900, heatingPart: 'operating' })
  ids.ulmenweg = house.id
  ids.ulmenwegPlant = plant.id
}

// Eine erfundene XRechnung (UBL), wie sie ein Handwerksbetrieb als XML-Datei schickt.
/** @param {number} year */
function xrechnung(year) {
  const line = (id, name, net) => `<cac:InvoiceLine><cbc:ID>${id}</cbc:ID><cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">${net}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${name}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="EUR">${net}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
<cbc:ID>R-${year}-0815</cbc:ID>
<cbc:IssueDate>${year}-10-02</cbc:IssueDate>
<cbc:DueDate>${year}-10-16</cbc:DueDate>
<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
<cac:AccountingSupplierParty><cac:Party><cac:PostalAddress><cbc:StreetName>Werkstraße 7</cbc:StreetName><cbc:CityName>Musterstadt</cbc:CityName><cbc:PostalZone>12345</cbc:PostalZone><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>DE123456789</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Heizungsbau Beispiel GmbH</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cac:PostalAddress><cbc:StreetName>Lindenweg 12</cbc:StreetName><cbc:CityName>Musterstadt</cbc:CityName><cbc:PostalZone>12345</cbc:PostalZone><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyLegalEntity><cbc:RegistrationName>Klaus Wegener</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
<cac:Delivery><cbc:ActualDeliveryDate>${year}-09-26</cbc:ActualDeliveryDate></cac:Delivery>
<cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>DE02120300000000202051</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">60.61</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">319.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">60.61</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">319.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">319.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">379.61</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">379.61</cbc:PayableAmount></cac:LegalMonetaryTotal>
${line('1', 'Jährliche Wartung Gasbrennwertkessel einschließlich Abgasmessung', '245.00')}
${line('2', `Dichtungssatz und Zündelektrode ${LONG_WORD}`, '74.00')}
</Invoice>
`
}

/** @type {PrintView[]} */
export const PRINT_VIEWS = [
  {
    name: 'ableseformular',
    label: 'Ableseformular (Seite Zähler)',
    async open(page, ids) {
      await chooseProperty(page, ids.haus, 'Lindenweg 12')
      await navigate(page, 'Zähler')
      await clickButton(page, 'Ableseformular drucken', 'Knopf „Ableseformular drucken“')
      const sheet = await drawer(page, 'Ableseformular drucken')
      await clickButton(sheet, /^Drucken$/, 'Knopf „Drucken“ im Fenster')
      await untilPrinted(page, 'Ableseformular')
      await attached(page.locator('.reading-sheet-print'), 'Ableseformular im Dokument')
    },
  },
  {
    name: 'kaution',
    label: 'Kaution, Aufstellung zum Auszug (Stammdaten)',
    // Der ausgezogene Mieter des Lindenwegs: erhalten, verzinst, mit einem Schaden verrechnet, ausgezahlt. Gedruckt wird
    // nur die Notiz einer Verrechnung (depositSettlement.ts), deshalb steht das lange Wort dort, doppelt: einmal
    // passt es in die drei Spalten und prüfte nichts (Gegenprobe ohne softBreak); der Zweck „Schaden“
    // berührt weder Mietkonto noch Steuer.
    async setup(api, ids, stock) {
      /** @type {any[]} */
      const tenancies = await api.get(`/api/tenancies?property=${ids.haus}`)
      const hartmann = tenancies.find((t) => t.tenantName === 'Jonas Hartmann')
      if (!hartmann) throw new Error('Mietverhältnis „Jonas Hartmann“ fehlt im Beispielbestand')
      const entry = (body) => api.post('/api/deposit-entries', { tenancyId: hartmann.id, ...body })
      await entry({ date: '2021-08-20', kind: 'received', amountCents: 156000, note: 'Überweisung vor Einzug' })
      await entry({ date: `${stock.PREV}-12-31`, kind: 'interest', amountCents: 1870 })
      await entry({ date: `${stock.YEAR}-08-15`, kind: 'applied', purpose: 'damage', amountCents: 20000, note: `Schaden laut Wohnungsabnahme ${LONG_WORD}${LONG_WORD}` })
      await entry({ date: `${stock.YEAR}-08-15`, kind: 'refunded', amountCents: 137870, note: 'Rückzahlung nach Wohnungsabnahme' })
    },
    async open(page, ids) {
      await chooseProperty(page, ids.haus, 'Lindenweg 12')
      await navigate(page, 'Stammdaten')
      const former = await shown(page.locator('details', { has: page.locator('summary', { hasText: 'Frühere Mietverhältnisse' }) }), 'Abschnitt „Frühere Mietverhältnisse“')
      if (!(await former.evaluate((d) => /** @type {any} */ (d).open))) await former.locator('summary').first().click()
      const row = await shown(former.locator('tr', { hasText: 'Jonas Hartmann' }), 'Zeile „Jonas Hartmann“')
      await clickButton(row, 'Kaution führen', 'Knopf „Kaution führen“')
      const deposit = await shown(page.locator('dialog[open].drawer'), 'Fenster „Kaution“')
      await clickButton(deposit, 'Aufstellung drucken', 'Knopf „Aufstellung drucken“')
      await untilPrinted(page, 'Kaution')
    },
  },
  {
    name: 'monatsinfo',
    label: 'Monatliche Verbrauchsinformation (Heizkosten)',
    setup: ensureUlmenweg,
    async open(page, ids) {
      await chooseProperty(page, ids.ulmenweg, 'Ulmenweg 7')
      await navigate(page, 'Heizkosten')
      const card = await shown(page.locator('section, .card').filter({ has: page.locator('h3', { hasText: 'Monatliche Verbrauchsinformation' }) }), 'Karte „Monatliche Verbrauchsinformation“')
      // Der erste fällige Monat (Januar)
      await clickButton(card, /^Drucken$/, 'Knopf „Drucken“ eines fälligen Monats')
      await untilPrinted(page, 'Monatliche Verbrauchsinformation')
      await attached(page.locator('.monthly-info-print'), 'Blatt der Verbrauchsinformation im Dokument')
    },
  },
  {
    name: 'co2-blatt',
    label: 'CO₂-Angaben für den Messdienst (Heizkosten)',
    setup: ensureUlmenweg,
    async open(page, ids) {
      await chooseProperty(page, ids.ulmenweg, 'Ulmenweg 7')
      await navigate(page, 'Heizkosten')
      await clickButton(page, 'Blatt „CO₂-Angaben für den Messdienst“ öffnen', 'Knopf „Blatt „CO₂-Angaben für den Messdienst“ öffnen“')
      await answerQuestion(page)
      await shown(page.locator('.card table'), 'Tabelle des CO₂-Blatts')
      await clickButton(page.locator('.card'), /^Drucken$/, 'Knopf „Drucken“ am CO₂-Blatt')
      await untilPrinted(page, 'CO₂-Blatt')
    },
  },
  {
    name: 'e-rechnung',
    label: 'E-Rechnung (XRechnung als XML, eigene Seite)',
    async setup(api, ids, stock) {
      await ensureUlmenweg(api, ids, stock)
      const fd = new FormData()
      fd.append('file', new Blob([xrechnung(stock.YEAR)], { type: 'application/xml' }), `Rechnung Wartung ${stock.YEAR}.xml`)
      fd.append('propertyId', ids.ulmenweg)
      fd.append('year', String(stock.YEAR))
      const { file } = await api.post('/api/upload', fd)
      const view = await api.get(`/api/e-invoice/${encodeURIComponent(file)}`)
      if (!view || (Array.isArray(view.unreadable) && view.unreadable.length > 0)) throw new Error(`Die E-Rechnung wird nicht gelesen: ${JSON.stringify(view).slice(0, 300)}`)
    },
    async open(page, ids) {
      await chooseProperty(page, ids.ulmenweg, 'Ulmenweg 7')
      await navigate(page, 'Belege')
      // Der Link auf den Beleg öffnet sonst einen neuen Tab; gedruckt wird in diesem
      const link = await shown(page.locator('a[href*="e-rechnung="]'), 'Link auf die E-Rechnung im Eingang')
      const href = await link.getAttribute('href')
      if (!href) throw new Error('Der Link auf die E-Rechnung hat kein Ziel')
      await page.goto(new URL(href, page.url()).href)
      await page.evaluate(stubPrint)
      await page.waitForLoadState('networkidle')
      await clickButton(page, 'Drucken / PDF', 'Knopf „🖨 Drucken / PDF“ der E-Rechnung')
      await untilPrinted(page, 'E-Rechnung')
    },
  },
  {
    name: 'heizkostenabrechnung',
    label: 'Getrennte Heizkostenabrechnung, Weg d (Abrechnung)',
    // „Erlenstraße 9“: Gas über den Messdienst, Heizperiode Mai bis April, getrennt abgerechnet ab Mai des Vorvorjahrs
    // (wie setupSeparateHeating in bundle-vergleich.mjs). Die Heizperiode endet im Abrechnungsjahr und steht deshalb
    // im Umschalter der Seite Abrechnung.
    async setup(api, ids, stock) {
      const { YEAR, PREV } = stock
      const house = await createHouse(api, {
        name: 'Erlenstraße 9', address: 'Erlenstraße 9, 12345 Musterstadt', flats: [
          { name: 'Wohnung links', areaM2: 82, floor: 'EG', tenant: 'Sabine Lorenz', start: '2019-10-01', prepay: 26000, rent: 72000 },
          { name: 'Wohnung rechts', areaM2: 77, floor: 'EG', tenant: 'Tobias Brandt', start: '2022-02-01', prepay: 24000, rent: 69000 },
        ],
      })
      const { plant } = await api.post(`/api/heating-plants${house.q}`, { energy: 'gas', method: 'service' })
      const rules = { startMonth: 5, changes: [] }
      const period = await api.post(`/api/heating-plants/${plant.id}/period/preview`, { rules })
      await api.put(`/api/heating-plants/${plant.id}/period`, { rules, answers: { understood: true, token: period.token } })
      const separate = { separate: true, month: `${PREV}-05` }
      const preview = await api.post(`/api/heating-plants/${plant.id}/separate/preview`, separate)
      // Die Heizanteile der Vorauszahlungen, wie die Vorschau sie vorbelegt
      const steps = Object.fromEntries((preview.steps ?? []).map((st) => [st.tenancyId, Object.fromEntries(st.rows.map((r) => [r.from, r.heatingCents]))]))
      await api.put(`/api/heating-plants/${plant.id}/separate`, { ...separate, answers: { understood: true, steps, token: preview.token } })
      const item = (body) => api.post(`/api/costItems${house.q}`, { period: `${PREV}-05`, category: 'Heizung und Warmwasser', key: 'area', heatingPlantId: plant.id, taxYear: YEAR, ...body })
      await item({ description: `Erdgas ${PREV}/${YEAR}`, vendor: 'Energieversorgung Musterstadt', amountCents: 312450 })
      await item({ description: 'Abrechnung Messdienst', vendor: 'Messdienst Beispiel', amountCents: 21480 })
      const list = await api.get(`/api/heating-settlements${house.q}`)
      if (!Array.isArray(list) || list.length === 0) throw new Error(`Erlenstraße 9: keine getrennte Heizkostenabrechnung: ${JSON.stringify(list).slice(0, 300)}`)
      ids.erlenstrasse = house.id
    },
    async open(page, ids) {
      await chooseProperty(page, ids.erlenstrasse, 'Erlenstraße 9')
      await navigate(page, 'Abrechnung')
      const choice = page.locator('[role="group"][aria-label="Welche Abrechnung?"] button', { hasText: 'Heizkosten' })
      await (await shown(choice, 'Umschalter „Heizkosten …“ auf der Seite Abrechnung')).click()
      await answerQuestion(page)
      await page.waitForLoadState('networkidle')
      // Am Bildschirm ausgeblendet (statement-hidden), deshalb nur im Dokument verlangt
      await attached(page.locator('.card.statement'), 'Mieterabrechnungen der Heizkosten', WAIT_MS)
      await clickButton(page, 'Drucken / PDF', 'Knopf „🖨 Drucken / PDF“')
      const print = await drawer(page, 'Drucken')
      await clickButton(print, /^Drucken$/, 'Knopf „Drucken“ im Fenster „Drucken“')
      await untilPrinted(page, 'Heizkostenabrechnung')
    },
  },
  {
    name: 'ableseergebnis',
    label: 'Ableseergebnis der eigenen Heizkostenabrechnung (Heizkosten)',
    setup: ensureUlmenweg,
    async open(page, ids) {
      await chooseProperty(page, ids.ulmenweg, 'Ulmenweg 7')
      await navigate(page, 'Heizkosten')
      await clickButton(page.locator('.reading-result'), 'Ableseergebnis drucken', 'Knopf „Ableseergebnis drucken“')
      await untilPrinted(page, 'Ableseergebnis')
    },
  },
  {
    name: 'steuer',
    label: 'Steuer (Anlage V)',
    async open(page, ids) {
      await chooseProperty(page, ids.haus, 'Lindenweg 12')
      await navigate(page, 'Steuer')
      await clickButton(page, 'Drucken / PDF', 'Knopf „🖨 Drucken / PDF“ (Steuer)')
      await untilPrinted(page, 'Steuer')
    },
  },
]

// ---------- Allein aufgerufen: jede Ansicht öffnen und messen ----------

// Läuft in der Seite: alles Sichtbare, das hinausragt (auch print-width-check.mjs misst hiermit)
export function overflowingElements(limit) {
  // Die Skripte kennen die Typen des DOM nicht (wie safari-print-check.mjs)
  const win = /** @type {any} */ (globalThis)
  const document = win.document
  // Wie weit ein Element im Druck reicht; null, wenn es nicht gedruckt wird. Text, der aus seinem Block ragt, macht dessen
  // Box nicht breiter, nur seinen Inhalt (scrollWidth).
  const reach = (el) => {
    const style = win.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return { left: r.left, right: style.overflowX === 'visible' ? Math.max(r.right, r.left + el.scrollWidth) : r.right }
  }
  const outside = (x) => x !== null && (x.right > limit + 0.5 || x.left < -0.5)
  const found = []
  for (const el of document.querySelectorAll('body *')) {
    const x = reach(el)
    if (!outside(x)) continue
    // Nur das innerste Element nennen: ragt ein Kind hinaus, ist das Elternteil meist nur deshalb so breit
    if ([...el.children].some((c) => outside(reach(c)))) continue
    found.push({ tag: el.tagName.toLowerCase(), cls: String(el.className), right: Math.round(/** @type {any} */ (x).right), text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) })
  }
  return { documentWidth: document.documentElement.scrollWidth, found }
}

async function pageCount(file) {
  const pdfjs = await import(pathToFileURL(path.join(root, 'client/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise
  return doc.numPages
}

async function main() {
  const argv = process.argv.slice(2)
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const out = path.resolve(arg('--out') ?? path.join(os.tmpdir(), 'mietfuchs-druckbreite-ansichten'))
  const only = arg('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null
  const views = only ? PRINT_VIEWS.filter((v) => only.includes(v.name)) : PRINT_VIEWS
  if (only && views.length !== only.length) throw new Error(`Unbekannte Ansicht in --only; bekannt: ${PRINT_VIEWS.map((v) => v.name).join(', ')}`)
  fs.mkdirSync(out, { recursive: true })
  const limit = (186 * 96) / 25.4
  const stock = await import('./demo-stock.mjs')
  const { chromium } = await stock.loadPlaywright()
  const browser = await chromium.launch({ args: ['--lang=de-DE'] })
  /** @type {Awaited<ReturnType<typeof stock.startDemo>> | null} */
  let demo = null
  let failed = 0
  try {
    demo = await stock.startDemo({ pdf: (html) => stock.textPdf(html), prefix: 'mietfuchs-druckansichten-' })
    /** @type {Ids} */
    const ids = { ...demo.ids }
    // Die Setups der gewählten Ansichten, in der Reihenfolge der Liste
    for (const v of views) {
      if (!v.setup) continue
      console.log(`Anlegen für ${v.name} …`)
      await v.setup(demo.api, ids, stock)
    }
    const rows = []
    for (const v of views) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: 'light' })
      const page = await context.newPage()
      /** @type {string[]} */
      const pageErrors = []
      page.on('pageerror', (e) => pageErrors.push(e.message))
      await page.addInitScript(stubPrint)
      await page.addInitScript((id) => { try { localStorage.setItem('mietfuchs.property', id) } catch { /* ohne Speicher das erste Objekt */ } }, ids.haus)
      const row = { name: v.name, opened: false, width: /** @type {number | null} */ (null), overflow: /** @type {boolean | null} */ (null), pages: /** @type {number | null} */ (null), note: '' }
      try {
        await page.goto(demo.base)
        await page.waitForLoadState('networkidle')
        await v.open(page, ids)
        row.opened = true
        await page.emulateMedia({ media: 'print' })
        await page.setViewportSize({ width: Math.floor(limit), height: 900 })
        await page.waitForTimeout(300)
        const width = await page.evaluate(overflowingElements, limit)
        row.width = width.documentWidth
        row.overflow = width.found.length > 0 || width.documentWidth > limit + 1
        if (row.overflow) {
          const seen = new Set()
          const distinct = width.found.filter((f) => { const k = `${f.tag}.${f.cls}`; if (seen.has(k)) return false; seen.add(k); return true })
          row.note = distinct.slice(0, 4).map((f) => `<${f.tag}${f.cls ? `.${f.cls.split(/\s+/).join('.')}` : ''}> „${f.text}“ bis ${f.right} px`).join('; ')
        }
        const file = path.join(out, `${v.name}.pdf`)
        await page.pdf({ path: file, preferCSSPageSize: true })
        row.pages = await pageCount(file)
      } catch (err) {
        failed += 1
        row.note = err instanceof Error ? err.message.split('\n')[0] : String(err)
        await page.screenshot({ path: path.join(out, `${v.name}-fehler.png`), fullPage: true }).catch(() => {})
      }
      if (pageErrors.length > 0) row.note = [row.note, ...pageErrors.map((e) => `Fehler in der Seite: ${e}`)].filter(Boolean).join('; ')
      rows.push(row)
      const yes = (b) => (b === null ? '–' : b ? 'ja' : 'nein')
      console.log(`${v.name}: geöffnet ${yes(row.opened)}, Breite ${row.width ?? '–'} px, zu breit ${yes(row.overflow)}, ${row.pages ?? '–'} Seiten${row.note ? `; ${row.note}` : ''}`)
      await context.close()
      if (demo.problem()) throw new Error(/** @type {string} */ (demo.problem()))
    }
    const table = ['| Ansicht | geöffnet | Breite im Druck (px) | zu breit | Seiten | Anmerkung |', '|---|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.name} | ${r.opened ? 'ja' : 'nein'} | ${r.width ?? '–'} | ${r.overflow === null ? '–' : r.overflow ? 'ja' : 'nein'} | ${r.pages ?? '–'} | ${r.note.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} |`)]
    fs.writeFileSync(path.join(out, 'ansichten.md'), `# Druckansichten\n\nSatzspiegel ${Math.floor(limit)} px.\n\n${table.join('\n')}\n`)
    console.log(`\n${table.join('\n')}\n\nPDFs und Bericht: ${out}`)
  } finally {
    await browser.close()
    await demo?.stop()
  }
  return failed > 0 ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code }, (err) => {
    console.error(err)
    process.exitCode = 2
  })
}
