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
      if (props.docType) answer = { docType: 'rechnung' }
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
