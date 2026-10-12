// KI-Auswertung der Heizkostenabrechnung eines Messdienstes und der Rechnung eines Brennstoff- oder
// Wärmelieferanten (Heizung PR 20, #103). Dieselbe Haltung wie extract.ts: Die KI liest, was auf dem Beleg
// steht, ein Mensch prüft es, und Mietfuchs rechnet nichts vor, was nicht dasteht (Entwurf 16). Gespeichert
// wird hier nichts; die Seite Heizkosten zeigt den Vorschlag und schreibt über die bestehenden Routen.
//
// Die Grenze zwischen roher Antwort und Zusage (#63): Was vom Modell kommt, ist `Record<string, unknown>`;
// was der Browser bekommt, beschreiben `ServiceStatementExtraction` und `FuelInvoiceExtraction` in
// shared/types.ts. Je Belegart gibt es genau einen Ausgang (`toServiceExtraction`, `toFuelExtraction`); nur
// dort entsteht die Zusage. Einen eigenen Eingang wie bei Rechnungen (`rawFromAnswer`) braucht es nicht,
// weil dazwischen nichts gerechnet wird außer dem Hochrechnen von Netto-Teilmengen, und das geschieht im
// Ausgang auf den schon gelesenen Zahlen (Plan PR 20, Abweichung 1). Die beiden Felder, die Mietfuchs selbst
// setzt (`amountsAdjusted`, `amountsNetUnadjusted`), liest der Ausgang nie aus der Antwort.
import type {
  AiSettings, DhwMethod, FuelInvoiceExtraction, FuelInvoicePartExtraction, FuelQuantityUnit, GasBasis,
  ServiceBlock, ServiceCo2Extraction, ServiceStatementExtraction, ServiceUserLine,
} from '../../shared/types.ts'
import { valueAt } from '../../shared/law/register.ts'
import { ustgStandardRate } from '../../shared/law/ustg.ts'
import type { ProviderImage } from './ai/index.ts'
import { largestRemainder } from './calc.ts'
import { ask, documentMaterial, EXTRACT_CATEGORIES, numberFromModel, type AskOptions } from './extract.ts'
import { rateDate, tolerance, vatExplainsGap } from './invoiceAmounts.ts'

type AiCapableSettings = { ai: AiSettings }

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
// Ein Name ist ein Text; eine Zahl ist dort keine Auskunft (wie `stringOrUndefined` in extract.ts).
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v.trim() || undefined : undefined)
// Überschrift und Nutzer stehen in einem Feld, das ein Mensch liest: Eine Zahl wird zum Text.
const textOrEmpty = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
// Ein Datum als JJJJ-MM-TT, das es im Kalender gibt.
const day = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return undefined
  const d = v.trim()
  const ms = Date.parse(`${d}T00:00:00Z`)
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === d ? d : undefined
}
// Eine Zahl, auch als Text in deutscher oder technischer Schreibweise (numberFromModel). Das typografische
// Minus „−“ (U+2212) liest ein Modell aus gedruckten Abrechnungen mit; es wird zum Bindestrich.
const num = (v: unknown): number | null => numberFromModel(typeof v === 'string' ? v.replace(/\u2212/g, '-') : v)
const positive = (v: unknown): number | null => {
  const n = num(v)
  return n !== null && n > 0 ? n : null
}
const notNegative = (v: unknown): number | null => {
  const n = num(v)
  return n !== null && n >= 0 ? n : null
}
function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return list.find((x) => x === v) ?? null
}

// ---------- Messdienst ----------

const DHW: readonly DhwMethod[] = ['heatMeter', 'volumeFormula', 'areaFormula']

export const SERVICE_SCHEMA = {
  type: 'object',
  properties: {
    vendor: { type: 'string', description: 'Messdienst oder Hausverwaltung, die die Abrechnung erstellt hat' },
    periodStart: { type: ['string', 'null'], description: 'Beginn des Abrechnungszeitraums als YYYY-MM-DD' },
    periodEnd: { type: ['string', 'null'], description: 'Ende des Abrechnungszeitraums als YYYY-MM-DD' },
    unitsCount: { type: ['number', 'null'], description: 'Zahl der Nutzeinheiten der Liegenschaft' },
    usersTotalEur: { type: ['number', 'null'], description: 'Gedruckte Summe der zu verteilenden Kosten Heizung und Warmwasser (bei einer Abzugszeile der Betrag nach dem Abzug)' },
    deductionEur: { type: ['number', 'null'], description: 'Betrag der Zeile „Abzüglich CO₂-Kosten Vermieter“ als positive Zahl, sonst null' },
    fuelGrossEur: { type: ['number', 'null'], description: 'Brennstoffkosten der Kostenaufstellung vor einem Abzug' },
    fuelNetEur: { type: ['number', 'null'], description: 'Brennstoffkosten der Kostenaufstellung nach dem Abzug, nur wenn eine Abzugszeile dasteht' },
    co2: {
      type: ['object', 'null'],
      properties: {
        emissionsKg: { type: ['number', 'null'] },
        areaM2: { type: ['number', 'null'] },
        kgPerM2: { type: ['number', 'null'] },
        landlordPercent: { type: ['number', 'null'] },
        totalEur: { type: ['number', 'null'] },
        landlordEur: { type: ['number', 'null'] },
      },
    },
    dhwMethod: { type: ['string', 'null'], enum: [...DHW, null] },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          category: { type: 'string', enum: EXTRACT_CATEGORIES },
          totalEur: { type: ['number', 'null'] },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Name des Nutzers, wie gedruckt' },
                unitLabel: { type: ['string', 'null'], description: 'Lage oder Nummer der Nutzeinheit' },
                from: { type: ['string', 'null'], description: 'Nutzungsbeginn YYYY-MM-DD, falls gedruckt' },
                to: { type: ['string', 'null'], description: 'Nutzungsende YYYY-MM-DD, falls gedruckt' },
                amountEur: { type: ['number', 'null'], description: 'Kosten dieses Nutzers in diesem Block' },
                vacancy: { type: 'boolean', description: 'true, wenn die Zeile Leerstand ist' },
              },
              required: ['label', 'amountEur'],
            },
          },
        },
        required: ['title', 'category', 'lines'],
      },
    },
  },
  required: ['blocks'],
}

export const SERVICE_PROMPT = `Du bist ein Assistent für die Nebenkostenabrechnung eines privaten Vermieters in Deutschland.
Dir liegt die Heiz- und Warmwasserkostenabrechnung eines Messdienstes (etwa Techem, ista, Brunata, Minol, KALO) oder einer Hausverwaltung vor. Lies die Werte so, wie sie gedruckt sind, und gib sie als JSON zurück. Rechne nichts um.

- "periodStart"/"periodEnd": der Abrechnungszeitraum der Liegenschaft.
- "unitsCount": die Zahl der Nutzeinheiten der Liegenschaft, wenn sie genannt ist.
- "usersTotalEur": die gedruckte Summe der zu verteilenden Heiz- und Warmwasserkosten aller Nutzer, etwa "Summe der Nutzerkosten Heizungsanlage" oder "zu verteilende Kosten". Steht darüber eine Zeile wie "Abzüglich CO₂-Kosten Vermieter", ist es die Summe nach diesem Abzug.
- "deductionEur": den Betrag der Zeile "Abzüglich CO₂-Kosten Vermieter" (oder gleichbedeutend) als positive Zahl. Gibt es keine solche Zeile, null. Beträge, die bei einzelnen Mietern als "vom Vermieter übernommen" stehen, gehören nicht hierher.
- "fuelGrossEur": die Brennstoffkosten in der Kostenaufstellung (etwa "Brennstoffkosten laut Rechnungen") vor einem Abzug; "fuelNetEur": die Brennstoffkosten nach der Abzugszeile, nur wenn eine solche Zeile dasteht, sonst null.
- "co2": der CO₂-Block: CO₂-Ausstoß der Liegenschaft in kg ("emissionsKg"), die Fläche dafür in m² ("areaM2"), der Ausstoß je m² und Jahr ("kgPerM2"), der Anteil des Vermieters in Prozent ("landlordPercent"), die CO₂-Kosten insgesamt ("totalEur") und davon der Anteil des Vermieters in Euro ("landlordEur"). Gibt es keinen CO₂-Block, null.
- "dhwMethod": wie der Wärmeanteil für Warmwasser ermittelt wurde: "heatMeter", wenn er mit einem Wärmezähler gemessen wurde; "volumeFormula", wenn er nach § 9 Abs. 2 Satz 2 HeizkostenV aus dem Warmwasservolumen errechnet wurde; "areaFormula", wenn er nach § 9 Abs. 2 Satz 4 HeizkostenV aus der Wohnfläche errechnet wurde. Steht dazu nichts da, null.
- "blocks": je Kostenblock (Heizung und Warmwasser, Kaltwasser und Abwasser, Hausstrom, …) ein Eintrag mit Überschrift ("title"), Kostenart ("category", GENAU eine aus der Liste: ${EXTRACT_CATEGORIES.map((c) => `"${c}"`).join(', ')}), der gedruckten Summe der Nutzerkosten des Blocks ("totalEur") und einer Zeile je Nutzer ("lines"): Name, wie gedruckt ("label"), Lage oder Nummer der Nutzeinheit ("unitLabel"), Nutzungszeitraum, falls gedruckt ("from", "to" als YYYY-MM-DD), die Kosten dieses Nutzers in diesem Block ("amountEur"; bei Heizung und Warmwasser die Summe aus Heiz- und Warmwasserkosten des Nutzers) und "vacancy": true, wenn die Zeile Leerstand ist.
- Beträge in Euro mit Dezimalpunkt, so wie gedruckt. Datumsangaben als YYYY-MM-DD.`

function lineOf(l: Record<string, unknown>): ServiceUserLine {
  const amount = num(l.amountEur)
  return {
    label: textOrEmpty(l.label),
    unitLabel: text(l.unitLabel) ?? null,
    from: day(l.from) ?? null,
    to: day(l.to) ?? null,
    ...(amount !== null ? { amountEur: amount } : {}),
    vacancy: l.vacancy === true,
  }
}

function blockOf(b: Record<string, unknown>): ServiceBlock {
  const total = num(b.totalEur)
  return {
    title: textOrEmpty(b.title),
    category: oneOf(EXTRACT_CATEGORIES, b.category) ?? '',
    ...(total !== null ? { totalEur: total } : {}),
    lines: Array.isArray(b.lines) ? b.lines.filter(isObject).map(lineOf) : [],
  }
}

function co2Of(v: unknown): ServiceCo2Extraction | null {
  if (!isObject(v)) return null
  const percent = num(v.landlordPercent)
  const c: ServiceCo2Extraction = {
    emissionsKg: notNegative(v.emissionsKg),
    areaM2: positive(v.areaM2),
    kgPerM2: notNegative(v.kgPerM2),
    landlordPercent: percent !== null && percent >= 0 && percent <= 100 ? percent : null,
    totalEur: notNegative(v.totalEur),
    landlordEur: notNegative(v.landlordEur),
  }
  return Object.values(c).every((x) => x === null) ? null : c
}

// Ausgang Messdienst: hier entsteht die Zusage an den Browser, und nur hier.
export function toServiceExtraction(answer: Record<string, unknown>): ServiceStatementExtraction {
  const units = num(answer.unitsCount)
  const deduction = num(answer.deductionEur)
  return {
    vendor: text(answer.vendor),
    periodStart: day(answer.periodStart),
    periodEnd: day(answer.periodEnd),
    unitsCount: units !== null && Number.isInteger(units) && units >= 1 ? units : null,
    usersTotalEur: notNegative(answer.usersTotalEur),
    // Die Zeile steht mit Minus da; gemeint ist der Betrag (Review Focus 2).
    deductionEur: deduction === null ? null : Math.abs(deduction),
    fuelGrossEur: notNegative(answer.fuelGrossEur),
    fuelNetEur: notNegative(answer.fuelNetEur),
    co2: co2Of(answer.co2),
    dhwMethod: oneOf(DHW, answer.dhwMethod),
    blocks: Array.isArray(answer.blocks) ? answer.blocks.filter(isObject).map(blockOf) : [],
  }
}

// ---------- Lieferant ----------

// § 43 Abs. 1 GModG nennt „Biomethan, Bioöl, biogenem Flüssiggas, grünem, blauem, orangenem oder türkisem
// Wasserstoff einschließlich daraus hergestellter Derivate“ (Prüfung des Plans, M5).
const BIO_WORDS = 'Biomethan, Bioöl, biogenes Flüssiggas oder grüner, blauer, orangener oder türkiser Wasserstoff samt daraus hergestellter Derivate'

export const FUEL_SCHEMA = {
  type: 'object',
  properties: {
    vendor: { type: 'string' },
    invoiceDate: { type: ['string', 'null'], description: 'Rechnungsdatum YYYY-MM-DD' },
    deliveredAt: { type: ['string', 'null'], description: 'Lieferdatum YYYY-MM-DD (Öl, Pellets, Flüssiggas)' },
    periodStart: { type: ['string', 'null'], description: 'Beginn des Abrechnungs- oder Lieferzeitraums YYYY-MM-DD (Gas, Fernwärme, Strom, Wärmelieferung)' },
    periodEnd: { type: ['string', 'null'], description: 'Ende des Abrechnungs- oder Lieferzeitraums YYYY-MM-DD' },
    totalGrossEur: { type: 'number', description: 'Rechnungsbetrag der Lieferung brutto, vor Abzug geleisteter Abschläge' },
    fixedEur: { type: ['number', 'null'], description: 'Grund-, Leistungs-, Mess- und Verrechnungspreise zusammen, brutto' },
    amountsAreNet: { type: ['boolean', 'null'], description: 'true, wenn die Beträge der Teilzeiträume nur netto ausgewiesen sind' },
    quantity: { type: ['number', 'null'] },
    quantityUnit: { type: ['string', 'null'], enum: ['l', 'kg', 'm3', 'kWh', 'srm', null] },
    energyKwh: { type: ['number', 'null'], description: 'Energiegehalt in kWh (Angabe nach § 3 Abs. 1 Nr. 4 CO2KostAufG)' },
    gasBasis: { type: ['string', 'null'], enum: ['hs', 'hi', null], description: 'hs = Brennwert, hi = Heizwert, nur bei Gas' },
    heatingValue: { type: ['number', 'null'], description: 'Heizwert in kWh je Liter, Kilogramm, m³ oder Schüttraummeter, nur wenn ausdrücklich als Heizwert genannt' },
    emissionsKg: { type: ['number', 'null'], description: 'Brennstoffemissionen in kg CO₂ (§ 3 Abs. 1 Nr. 1 CO2KostAufG)' },
    co2CostEur: { type: ['number', 'null'], description: 'Preisbestandteil der Kohlendioxidkosten (§ 3 Abs. 1 Nr. 2 CO2KostAufG)' },
    co2CostIsNet: { type: ['boolean', 'null'], description: 'true, wenn dieser Preisbestandteil ausdrücklich ohne Umsatzsteuer genannt ist' },
    emissionFactor: { type: ['number', 'null'], description: 'heizwertbezogener Emissionsfaktor in kg CO₂/kWh (§ 3 Abs. 1 Nr. 3 CO2KostAufG)' },
    bioCostEur: { type: ['number', 'null'], description: `Preisbestandteil für den nach § 43 Abs. 1 GModG verpflichtend anteilig zu nutzenden Brennstoff (${BIO_WORDS}; § 3 Abs. 1 Nr. 6 CO2KostAufG), sonst null` },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' }, to: { type: 'string' }, energyKwh: { type: ['number', 'null'] }, amountEur: { type: ['number', 'null'] },
          fixedEur: { type: ['number', 'null'] }, emissionsKg: { type: ['number', 'null'] }, co2CostEur: { type: ['number', 'null'] },
        },
        required: ['from', 'to'],
      },
    },
  },
  required: ['totalGrossEur'],
}

export const FUEL_PROMPT = `Du bist ein Assistent für die Nebenkostenabrechnung eines privaten Vermieters in Deutschland.
Dir liegt die Rechnung eines Lieferanten für Brennstoff oder Wärme vor (Erdgas, Fernwärme, Wärmelieferung eines Contractors, Heizöl, Flüssiggas, Pellets, Strom für eine Wärmepumpe). Lies die Werte so, wie sie gedruckt sind, und gib sie als JSON zurück. Rechne nichts um und ergänze nichts, was nicht dasteht.

- "totalGrossEur": der Rechnungsbetrag der Lieferung brutto, VOR Abzug geleisteter Abschläge. Nicht die Nachzahlung und nicht das Guthaben.
- "periodStart"/"periodEnd" bei Gas, Fernwärme, Wärmelieferung und Strom den Abrechnungszeitraum; "deliveredAt" bei Öl, Pellets und Flüssiggas den Liefertag.
- "fixedEur": Grund-, Leistungs-, Mess- und Verrechnungspreise zusammen, brutto, wenn gesondert ausgewiesen.
- "parts": Weist die Rechnung Teilzeiträume mit eigener Menge und eigenem Betrag aus (etwa bei einer Preisänderung), je Teilzeitraum ein Eintrag mit "from", "to", Energie in kWh, Betrag brutto, Grundpreis brutto, CO₂ in kg und CO₂-Kosten. Sind die Beträge der Teilzeiträume nur netto ausgewiesen, gib sie netto an und setze "amountsAreNet" auf true. Gibt es keine Teilzeiträume, eine leere Liste.
- "quantity"/"quantityUnit": die gelieferte Menge mit Einheit ("l", "kg", "m3", "kWh" oder "srm" für Schüttraummeter).
- Die Angaben nach § 3 Abs. 1 CO2KostAufG stehen oft in einem eigenen Kasten: Brennstoffemissionen in kg CO₂ ("emissionsKg"), Preisbestandteil der Kohlendioxidkosten ("co2CostEur"; steht er ausdrücklich ohne Umsatzsteuer da, setze "co2CostIsNet" auf true), heizwertbezogener Emissionsfaktor in kg CO₂/kWh ("emissionFactor"), Energiegehalt in kWh ("energyKwh"), Preisbestandteil für den nach § 43 Abs. 1 GModG verpflichtend anteilig zu nutzenden Brennstoff (${BIO_WORDS}; § 3 Abs. 1 Nr. 6 CO2KostAufG) ("bioCostEur"; steht dort "entfällt" oder nichts, null).
- "gasBasis" nur bei Gas: "hs", wenn die kWh nach dem Brennwert berechnet sind, "hi" nach dem Heizwert.
- "heatingValue": nur, wenn die Rechnung ausdrücklich einen Heizwert in kWh je Liter, Kilogramm, m³ oder Schüttraummeter nennt. Ein Brennwert ist kein Heizwert.
- Beträge in Euro mit Dezimalpunkt, Datumsangaben als YYYY-MM-DD.`

const UNIT_WORDS: Readonly<Record<string, FuelQuantityUnit>> = {
  l: 'l', liter: 'l', ltr: 'l', kg: 'kg', kilogramm: 'kg', m3: 'm3', 'm³': 'm3', cbm: 'm3', kubikmeter: 'm3', kwh: 'kWh', srm: 'srm', schüttraummeter: 'srm',
}
const unitOf = (v: unknown): FuelQuantityUnit | null => (typeof v === 'string' ? UNIT_WORDS[v.trim().toLowerCase()] ?? null : null)
const basisOf = (v: unknown): GasBasis | null => {
  if (typeof v !== 'string') return null
  const t = v.trim().toLowerCase()
  return t === 'hs' || t === 'brennwert' ? 'hs' : t === 'hi' || t === 'heizwert' ? 'hi' : null
}

function partOf(p: Record<string, unknown>): FuelInvoicePartExtraction | null {
  const from = day(p.from)
  const to = day(p.to)
  if (!from || !to || from > to) return null
  return { from, to, energyKwh: notNegative(p.energyKwh), amountEur: num(p.amountEur), fixedEur: notNegative(p.fixedEur), emissionsKg: notNegative(p.emissionsKg), co2CostEur: notNegative(p.co2CostEur) }
}

const toCents = (eur: number | null): number | null => (eur === null ? null : Math.round(eur * 100))

// Netto-Teilmengen anteilig auf den Rechnungsbetrag, nach derselben Regel wie normalizeAmounts (#34): nur,
// wenn das Modell sie als netto meldet, jede Teilmenge einen gelesenen Betrag hat, der Abstand größer ist
// als die Rundung und die Umsatzsteuer ihn erklärt. Sonst bleiben die Beträge, wie sie dastehen, und
// `amountsNetUnadjusted` sagt der Oberfläche, dass sie netto sind. Der Grundpreis je Teilmenge bekommt denselben
// Faktor; der der ganzen Rechnung nicht, denn Schema und Prompt verlangen ihn brutto (Durchsicht, Kann K1).
function grossUp(x: FuelInvoiceExtraction, net: boolean, today: string): FuelInvoiceExtraction {
  if (!net) return x
  const total = toCents(x.totalGrossEur) ?? 0
  const nets = x.parts.map((p) => toCents(p.amountEur))
  const read = nets.filter((c): c is number => c !== null)
  const sum = read.reduce((a, b) => a + b, 0)
  if (x.parts.length > 0 && read.length === nets.length && Math.abs(total - sum) <= tolerance(total)) return x
  const rate = valueAt(ustgStandardRate, rateDate(x.invoiceDate, today))
  const ok = x.parts.length > 0 && read.length === nets.length && sum < total - tolerance(total) && vatExplainsGap(sum, total, rate)
  if (!ok) return { ...x, amountsNetUnadjusted: true }
  const factor = total / sum
  const gross = largestRemainder(total, read.map((c) => c * factor), x.parts.map((_, i) => String(i)))
  const scale = (eur: number | null): number | null => (eur === null ? null : Math.round(eur * 100 * factor) / 100)
  return {
    ...x,
    parts: x.parts.map((p, i) => ({ ...p, amountEur: (gross[i] ?? 0) / 100, fixedEur: scale(p.fixedEur) })),
    amountsAdjusted: 'netto',
  }
}

// Ausgang Lieferant: hier entsteht die Zusage an den Browser, und nur hier. `today` als JJJJ-MM-TT für den
// Regelsatz der Umsatzsteuer ohne Rechnungsdatum (wie normalizeAmounts).
export function toFuelExtraction(answer: Record<string, unknown>, today: string = new Date().toISOString().slice(0, 10)): FuelInvoiceExtraction {
  const parts = Array.isArray(answer.parts) ? answer.parts.filter(isObject).map(partOf).filter((p): p is FuelInvoicePartExtraction => p !== null) : []
  const base: FuelInvoiceExtraction = {
    vendor: text(answer.vendor),
    invoiceDate: day(answer.invoiceDate),
    deliveredAt: day(answer.deliveredAt),
    periodStart: day(answer.periodStart),
    periodEnd: day(answer.periodEnd),
    totalGrossEur: num(answer.totalGrossEur),
    fixedEur: notNegative(answer.fixedEur),
    quantity: positive(answer.quantity),
    quantityUnit: unitOf(answer.quantityUnit),
    energyKwh: positive(answer.energyKwh),
    gasBasis: basisOf(answer.gasBasis),
    heatingValue: positive(answer.heatingValue),
    emissionsKg: notNegative(answer.emissionsKg),
    co2CostEur: notNegative(answer.co2CostEur),
    co2CostNet: answer.co2CostIsNet === true,
    emissionFactor: positive(answer.emissionFactor),
    bioCostEur: notNegative(answer.bioCostEur),
    parts,
    amountsNetUnadjusted: false,
  }
  return grossUp(base, answer.amountsAreNet === true, today)
}

// ---------- Auswertung ----------

type Input = { pdfText?: string; pages?: ProviderImage[] } & AskOptions

export async function extractServiceStatement(filePath: string, mimetype: string, settings: AiCapableSettings, { pdfText, pages, ...options }: Input = {}): Promise<ServiceStatementExtraction> {
  const material = documentMaterial(filePath, mimetype, { pdfText, pages }, { text: 'ABRECHNUNGSTEXT', noun: 'Die Abrechnung' })
  const answer = await ask(settings, 'serviceStatement', { prompt: SERVICE_PROMPT + material.suffix, images: material.images, schema: SERVICE_SCHEMA }, options)
  return toServiceExtraction(answer)
}

export async function extractFuelInvoice(filePath: string, mimetype: string, settings: AiCapableSettings, { pdfText, pages, ...options }: Input = {}): Promise<FuelInvoiceExtraction> {
  const material = documentMaterial(filePath, mimetype, { pdfText, pages }, { text: 'RECHNUNGSTEXT', noun: 'Die Rechnung' })
  const answer = await ask(settings, 'fuelInvoice', { prompt: FUEL_PROMPT + material.suffix, images: material.images, schema: FUEL_SCHEMA }, options)
  return toFuelExtraction(answer)
}
