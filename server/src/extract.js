// KI-Belegauswertung über eine lokale Ollama-Instanz.
// PDFs werden als Text extrahiert und an das Sprachmodell gegeben,
// Bilder (Handyfotos) als Base64 — letzteres erfordert ein Vision-fähiges Modell.

import fs from 'node:fs'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'

const SCHEMA = {
  type: 'object',
  properties: {
    vendor: { type: 'string', description: 'Rechnungssteller / Absender' },
    invoiceDate: { type: 'string', description: 'Rechnungsdatum als YYYY-MM-DD' },
    periodStart: { type: ['string', 'null'], description: 'Beginn Leistungszeitraum YYYY-MM-DD, falls angegeben' },
    periodEnd: { type: ['string', 'null'], description: 'Ende Leistungszeitraum YYYY-MM-DD, falls angegeben' },
    positions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          category: {
            type: 'string',
            enum: [
              'Grundsteuer', 'Wasser/Abwasser', 'Müllabfuhr', 'Straßenreinigung',
              'Gebäudereinigung', 'Gartenpflege', 'Beleuchtung/Allgemeinstrom', 'Schornsteinfeger',
              'Sach- und Haftpflichtversicherung', 'Hauswart', 'Aufzug', 'Kabel/Antenne',
              'Niederschlagswasser', 'Sonstige Betriebskosten', 'Nicht umlagefähig',
            ],
          },
          amountEur: { type: 'number', description: 'Bruttobetrag dieser Position in Euro' },
          labor35aEur: { type: ['number', 'null'], description: 'Darin enthaltener Lohn-/Arbeitskostenanteil nach §35a EStG, falls auf der Rechnung ausgewiesen' },
        },
        required: ['description', 'category', 'amountEur'],
      },
    },
    totalGrossEur: { type: 'number', description: 'Gesamtbetrag brutto in Euro' },
  },
  required: ['vendor', 'positions', 'totalGrossEur'],
}

const CATEGORY_ENUM = SCHEMA.properties.positions.items.properties.category.enum

const PROMPT = `Du bist ein Assistent für die Nebenkostenabrechnung eines privaten Vermieters in Deutschland.
Analysiere die folgende Rechnung und extrahiere die Daten als JSON.

Wichtige Regeln:
- Teile die Rechnung in sinnvolle Kostenpositionen auf. Beispiel Wasserrechnung: Grundgebühr,
  Frischwasser, Schmutzwasser und ggf. Niederschlagswasser als getrennte Positionen.
  Beispiel Grundbesitzabgaben: Grundsteuer, Müll und Straßenreinigung getrennt ausweisen.
- Ordne jeder Position als "category" GENAU EINE der folgenden Betriebskostenarten zu
  (exakt diese Schreibweise verwenden, keine eigenen Kategorien erfinden):
  ${CATEGORY_ENUM.map((c) => `"${c}"`).join(', ')}.
  Beispiele: Abfall-/Müllgebühren aller Art → "Müllabfuhr"; Frisch-, Schmutz- und Abwasser
  sowie Kanalgebühren → "Wasser/Abwasser"; Regen-/Oberflächenwasser → "Niederschlagswasser";
  Gebäude-, Wohngebäude- oder Haftpflichtversicherung → "Sach- und Haftpflichtversicherung".
  Nur wenn wirklich nichts passt → "Sonstige Betriebskosten".
- Kosten für Instandhaltung, Reparaturen oder Verwaltung sind "Nicht umlagefähig".
- Beträge brutto in Euro mit Dezimalpunkt.
- Weist die Rechnung Arbeits-/Lohnkosten gesondert aus (häufig bei Handwerkern, Gartenpflege,
  Schornsteinfeger als "Anteil nach §35a EStG"), gib sie als labor35aEur an, sonst null.
- Datumsangaben als YYYY-MM-DD.`

export async function extractFromFile(filePath, mimetype, settings) {
  const base = settings.ollamaUrl.replace(/\/+$/, '')
  const message = { role: 'user', content: PROMPT }

  if (mimetype === 'application/pdf') {
    const parsed = await pdfParse(fs.readFileSync(filePath))
    const text = (parsed.text || '').trim()
    if (!text) throw new Error('PDF enthält keinen auslesbaren Text (vermutlich ein Scan). Bitte als Foto/Bild hochladen oder manuell erfassen.')
    message.content += `\n\n--- RECHNUNGSTEXT ---\n${text.slice(0, 20000)}`
  } else if (mimetype.startsWith('image/')) {
    message.images = [fs.readFileSync(filePath).toString('base64')]
    message.content += '\n\nDie Rechnung ist als Bild angehängt.'
  } else {
    throw new Error(`Dateityp ${mimetype} wird nicht unterstützt (PDF oder Bild).`)
  }

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.ollamaModel,
      messages: [message],
      stream: false,
      format: SCHEMA,
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(300000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Ollama antwortet mit ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  return JSON.parse(data.message?.content ?? '{}')
}

export async function listOllamaModels(settings) {
  const base = settings.ollamaUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Ollama antwortet mit ${res.status}`)
  const data = await res.json()
  return (data.models || []).map((m) => m.name)
}
