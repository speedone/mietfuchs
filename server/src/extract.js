// KI-Belegauswertung über eine lokale Ollama-Instanz.
// PDFs werden als Text extrahiert und an das Sprachmodell gegeben; gescannte PDFs
// ohne Textebene werden seitenweise als Bild gerendert. Bilder (Handyfotos) gehen
// als Base64 — beides erfordert ein Vision-fähiges Modell.

import fs from 'node:fs'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'

// Gescanntes PDF (keine Textebene): Seiten als PNG rendern, damit das Vision-Modell
// sie wie ein Foto auswerten kann. Begrenzt auf die ersten Seiten — Rechnungen stehen
// praktisch immer vorn, und jedes Bild kostet Auswertungszeit.
async function pdfPagesAsImages(filePath, maxPages = 4) {
  const { pdf } = await import('pdf-to-img')
  const doc = await pdf(filePath, { scale: 2 })
  const images = []
  for await (const page of doc) {
    images.push(page.toString('base64'))
    if (images.length >= maxPages) break
  }
  return images
}

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

// Zweiter, fokussierter Durchgang nur für die Kategorisierung: ein kleiner Prompt mit
// Definitionen je Kostenart ist deutlich treffsicherer als die Zuordnung „nebenbei" während
// der Extraktion (dort muss das Modell gleichzeitig Positionen, Beträge und §35a erkennen).
const CATEGORY_GUIDE = `- "Grundsteuer": Grundsteuer A/B (Position im Grundbesitzabgabenbescheid)
- "Wasser/Abwasser": Frisch-/Trinkwasser, Schmutzwasser, Abwasser, Kanalgebühren, Grund-/Zählergebühr Wasser
- "Niederschlagswasser": Regenwasser, Oberflächenwasser, versiegelte Fläche
- "Müllabfuhr": Restmüll, Biotonne, Papiertonne, Abfallgebühren, Sperrmüll, Containerleerung
- "Straßenreinigung": Straßenreinigung, Winterdienst, kommunale Kehrgebühren
- "Gebäudereinigung": Treppenhaus-/Hausreinigung
- "Gartenpflege": Gartenarbeiten, Heckenschnitt, Baumpflege, Rasenmähen, Außenanlagen
- "Beleuchtung/Allgemeinstrom": Allgemeinstrom, Haus-/Außenbeleuchtung
- "Schornsteinfeger": Kehrgebühren, Feuerstättenschau, Immissionsmessung
- "Sach- und Haftpflichtversicherung": Wohngebäude-/Gebäudeversicherung, Elementar, Haus- und Grundbesitzerhaftpflicht
- "Hauswart": Hausmeister
- "Aufzug": Aufzugswartung, TÜV Aufzug
- "Kabel/Antenne": Kabelanschluss, Breitband
- "Sonstige Betriebskosten": andere LAUFENDE Betriebskosten (z. B. Dachrinnenreinigung, Wartung Rauchmelder)
- "Nicht umlagefähig": Reparaturen, Instandhaltung, Verwaltung, Mahn-/Bankgebühren, einmalige Anschaffungen`

async function classifyPositions(base, model, vendor, positions) {
  const schema = {
    type: 'object',
    properties: {
      categories: {
        type: 'array',
        items: { type: 'string', enum: CATEGORY_ENUM },
        minItems: positions.length,
        maxItems: positions.length,
      },
    },
    required: ['categories'],
  }
  const prompt = `Du bist Experte für deutsche Betriebskostenabrechnungen (§2 BetrKV).
Ordne jede der folgenden Rechnungspositionen GENAU EINER Betriebskostenart zu.

Kostenarten und was dazugehört:
${CATEGORY_GUIDE}

Rechnungssteller: ${vendor || 'unbekannt'}
Positionen:
${positions.map((p, i) => `${i + 1}. ${p.description} (${p.amountEur} €)`).join('\n')}

Gib die Kategorien in derselben Reihenfolge wie die Positionen zurück.`
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      format: schema,
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}`)
  const data = await res.json()
  const { categories } = JSON.parse(data.message?.content ?? '{}')
  if (!Array.isArray(categories) || categories.length !== positions.length) return positions
  return positions.map((p, i) => ({ ...p, category: CATEGORY_ENUM.includes(categories[i]) ? categories[i] : p.category }))
}

export async function extractFromFile(filePath, mimetype, settings) {
  const base = settings.ollamaUrl.replace(/\/+$/, '')
  const message = { role: 'user', content: PROMPT }

  if (mimetype === 'application/pdf') {
    const parsed = await pdfParse(fs.readFileSync(filePath)).catch(() => ({ text: '' }))
    const text = (parsed.text || '').trim()
    if (text.length >= 80) {
      message.content += `\n\n--- RECHNUNGSTEXT ---\n${text.slice(0, 20000)}`
    } else {
      // Scan ohne (brauchbare) Textebene → Seiten rendern und ans Vision-Modell geben
      let images
      try {
        images = await pdfPagesAsImages(filePath)
      } catch (err) {
        throw new Error(`PDF enthält keinen auslesbaren Text und konnte nicht als Bild gerendert werden (${String(err.message || err)}).`)
      }
      if (images.length === 0) throw new Error('PDF enthält keine Seiten.')
      message.images = images
      message.content += '\n\nDie Rechnung ist als Bild(er) angehängt (gescanntes PDF, ggf. mehrseitig).'
    }
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
  const result = JSON.parse(data.message?.content ?? '{}')

  // Zweiter Durchgang: Kategorien gezielt nachschärfen. Schlägt er fehl, bleiben die
  // Kategorien aus der Extraktion erhalten — der Client mappt notfalls per Stichwort.
  if (Array.isArray(result.positions) && result.positions.length > 0) {
    try {
      result.positions = await classifyPositions(base, settings.ollamaModel, result.vendor, result.positions)
    } catch {
      // bewusst ignoriert
    }
  }
  return result
}

export async function listOllamaModels(settings) {
  const base = settings.ollamaUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Ollama antwortet mit ${res.status}`)
  const data = await res.json()
  return (data.models || []).map((m) => m.name)
}
