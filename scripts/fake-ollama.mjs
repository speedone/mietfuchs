// Ein nachgebautes Ollama für den Praxislauf und die Probe im Browser (Belegbuchung, #170).
// Es antwortet wie Ollama (zeilenweise JSON, zuletzt `done`) mit erfundenen Rechnungen: Steht das
// Kennwort einer Rechnung in der Anfrage (die Textebene eines PDFs), gilt sie; sonst die nächste
// aus der Reihenfolge, damit auch ein Foto ohne Text eine Antwort bekommt. Nur erfundene Belege.
//
//   node scripts/fake-ollama.mjs --port 11500
//   node scripts/fake-ollama.mjs --port 11500 --sequence WASSER,MUELL,GARTEN,GRUNDSTEUER
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const year = new Date().getUTCFullYear() - 1

// Die vier Abnahmefälle der Spezifikation (docs/superpowers/specs/2026-10-02-belegbuchung-design.md).
export const INVOICES = {
  WASSER: {
    vendor: 'Stadtwerke Musterstadt', invoiceDate: `${year}-12-31`, totalGrossEur: 1500,
    positions: [{ description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 700 }, { description: 'Abwasser', category: 'Wasser/Abwasser', amountEur: 800 }],
  },
  MUELL: {
    vendor: 'Abfallwirtschaft Musterkreis', invoiceDate: `${year}-12-15`, totalGrossEur: 650,
    positions: [{ description: 'Restmüll', category: 'Müllabfuhr', amountEur: 700 }, { description: 'Gutschrift Tonnentausch', category: 'Müllabfuhr', amountEur: -50 }],
  },
  GARTEN: {
    vendor: 'Gärtnerei Grün', invoiceDate: `${year}-11-30`, totalGrossEur: 1450,
    positions: [{ description: 'Gartenpflege Saison', category: 'Gartenpflege', amountEur: 1450, labor35aEur: null }],
  },
  GRUNDSTEUER: {
    vendor: 'Stadt Musterstadt', invoiceDate: `${year}-02-15`, totalGrossEur: 612.4,
    positions: [{ description: 'Grundsteuer B', category: 'Grundsteuer', amountEur: 612.4 }],
  },
}

// Heizung PR 20 (#103): die Messdienstabrechnung und die beiden Lieferantenrechnungen des KI-Prüflaufs
// (scripts/ai-eval/invoices/), so wie ein Modell sie richtig liest. Erkannt am Schema (`blocks`, `parts`);
// die Heizölrechnung am Namen des Lieferanten im Text (der Prompt selbst nennt Heizöl), sonst die Gasrechnung.
export const HEATING = {
  service: {
    vendor: 'Wärmedienst Beispiel GmbH', periodStart: '2025-01-01', periodEnd: '2025-12-31', unitsCount: 4, usersTotalEur: 3944.5, deductionEur: -87.5,
    fuelGrossEur: 3540, fuelNetEur: 3452.5,
    co2: { emissionsKg: 4456.4, areaM2: 194.6, kgPerM2: 22.9, landlordPercent: 30, totalEur: 291.67, landlordEur: 87.5 }, dhwMethod: 'volumeFormula',
    blocks: [
      { title: 'Heizung und Warmwasser', category: 'Heizung und Warmwasser', totalEur: 3944.5, lines: [
        { label: 'Mustermann, Erika', unitLabel: 'EG links', amountEur: 1180.25, vacancy: false },
        { label: 'Leerstand', unitLabel: 'EG rechts', amountEur: 702.1, vacancy: true },
        { label: 'Beispiel, Max', unitLabel: 'OG links', amountEur: 1065.4, vacancy: false },
        { label: 'Eigentümer (Eigennutzung)', unitLabel: 'OG rechts', amountEur: 996.75, vacancy: false },
      ] },
      { title: 'Kaltwasser und Abwasser', category: 'Wasser/Abwasser', totalEur: 1236, lines: [
        { label: 'Mustermann, Erika', unitLabel: 'EG links', amountEur: 402, vacancy: false },
        { label: 'Leerstand', unitLabel: 'EG rechts', amountEur: 85, vacancy: true },
        { label: 'Beispiel, Max', unitLabel: 'OG links', amountEur: 377, vacancy: false },
        { label: 'Eigentümer (Eigennutzung)', unitLabel: 'OG rechts', amountEur: 372, vacancy: false },
      ] },
    ],
  },
  gas: {
    vendor: 'Stadtwerke Beispielstadt', invoiceDate: '2026-03-20', periodStart: '2025-03-15', periodEnd: '2026-03-14', totalGrossEur: 4067.8, fixedEur: 207.06,
    quantity: 2890, quantityUnit: 'm3', energyKwh: 31285, gasBasis: 'hs', heatingValue: null, emissionsKg: 5674.8, co2CostEur: 380.99, emissionFactor: 0.20088, bioCostEur: null,
    parts: [
      { from: '2025-03-15', to: '2025-12-31', energyKwh: 22410, amountEur: 2885.77, fixedEur: 165.65, emissionsKg: 4065, co2CostEur: 266.05 },
      { from: '2026-01-01', to: '2026-03-14', energyKwh: 8875, amountEur: 1182.03, fixedEur: 41.41, emissionsKg: 1609.8, co2CostEur: 114.94 },
    ],
  },
  oil: {
    vendor: 'Heizöl Beispiel GmbH', invoiceDate: '2025-10-14', deliveredAt: '2025-10-12', totalGrossEur: 3150, quantity: 3000, quantityUnit: 'l', energyKwh: 30150,
    heatingValue: 10.05, emissionsKg: 8032, co2CostEur: 525.69, emissionFactor: 0.2664, bioCostEur: null, parts: [],
  },
}

/**
 * @param {{ port?: number, sequence?: string[] }} [options]
 * @returns {Promise<{ url: string, stop: () => void }>}
 */
export function startFakeOllama({ port = 0, sequence = Object.keys(INVOICES) } = {}) {
  let turn = 0
  /** @type {any} */
  let last = null
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => { body += d })
    req.on('end', () => {
      /** @param {unknown} obj */
      const send = (obj) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      if (req.url === '/api/version') return send({ version: '0.34.2' })
      if (req.url === '/api/tags') return send({ models: [{ name: 'probe:latest', size: 1000 }] })
      if (req.url === '/api/show') return send({ capabilities: ['completion', 'vision'] })
      /** @type {any} */
      const j = body ? JSON.parse(body) : {}
      const props = j.format?.properties ?? {}
      let answer
      if (props.blocks) answer = HEATING.service
      else if (props.parts) answer = JSON.stringify(j.messages ?? []).includes('Heizöl Beispiel') ? HEATING.oil : HEATING.gas
      else if (props.docType) answer = { docType: 'rechnung' }
      else if (props.categories) answer = { categories: (last?.positions ?? []).map((/** @type {any} */ p) => p.category) }
      else {
        const text = JSON.stringify(j.messages ?? [])
        const marker = Object.keys(INVOICES).find((k) => text.includes(k)) ?? sequence[turn++ % sequence.length] ?? 'WASSER'
        last = INVOICES[/** @type {keyof typeof INVOICES} */ (marker)]
        answer = last
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(`${JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(answer) }, done: false })}\n`)
      res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 100, eval_count: 20 })}\n`)
    })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const address = /** @type {import('node:net').AddressInfo} */ (server.address())
    resolve({ url: `http://127.0.0.1:${address.port}`, stop: () => server.close() })
  }))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  /** @param {string} name */
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`)
    return i === -1 ? undefined : process.argv[i + 1]
  }
  const fake = await startFakeOllama({ port: Number(arg('port') ?? 11500), sequence: arg('sequence')?.split(',') })
  console.log(`Nachgebautes Ollama läuft auf ${fake.url} (Modell „probe“). Beenden mit Strg+C.`)
}
