// KI-Belegauswertung: Prompts, Schemas und Ablauf. Mit welchem Anbieter das Modell läuft,
// entscheidet ai/index.js anhand von `settings.ai`, hier geht es nur um das Fachliche.
// PDFs öffnet der Server nicht selbst: Der Browser liest sie vor dem Hochladen mit pdf.js
// (client/src/pdfIntake.ts) und schickt die Textebene mit, bei Scans ohne Textebene die
// gerenderten Seiten als Bilder. So braucht der Server kein natives Modul, und das verhält
// sich in der Programmdatei genauso wie im Docker-Image. Fotos und Seitenbilder gehen als
// { mimeType, data } an den Anbieter und erfordern ein Modell, das Bilder versteht.

import fs from 'node:fs'
import { aiProvider } from './ai/index.ts'
import { normalizeAmounts } from './invoiceAmounts.ts'

const photoOf = (filePath, mimetype) => ({ mimeType: mimetype, data: fs.readFileSync(filePath).toString('base64') })

// Zeitlimits je Schritt in Sekunden. Auf einem Rechner ohne Grafikkarte braucht ein Modell für
// einen mehrseitigen Scan lange: Im KI-Prüflauf (4 Kerne, keine Grafikkarte) las qwen3.5:4b zwei
// Seiten in rund acht Minuten, drei Seiten schaffte es nicht in zehn. Die Oberfläche zeigt den
// Fortschritt und lässt abbrechen, deshalb darf das Auslesen bis zu 20 Minuten dauern. Die
// Frage, was auf einem Foto zu sehen ist, ist in der Schnellerfassung der erste Schritt: Er
// enthält das Laden des Modells und ein Bild. Nur der zweite Durchgang (Kategorien) ist reiner
// Text und kurz. Das Zeitlimit unter „Erweitert“ (oder NKA_AI_TIMEOUT) gilt für alle Schritte.
const TIMEOUT_SECONDS = { extraction: 1200, classification: 180, docType: 600, meterReading: 600 }
const timeoutMs = (step, ai) => (ai.timeoutSeconds ?? TIMEOUT_SECONDS[step]) * 1000

// „Zusätzliche Hinweise an das Modell“ aus den Einstellungen, etwa zu Eigenheiten der eigenen
// Belege. Sie stehen am Ende, damit sie die allgemeinen Regeln im Einzelfall ergänzen.
const withInstructions = (prompt, ai) =>
  ai.extraInstructions ? `${prompt}\n\nZusätzliche Hinweise des Nutzers:\n${ai.extraInstructions}` : prompt

// Eine Anfrage an den Anbieter. `stats` sammelt die Kennzahlen je Schritt für die Antwort der
// Route, `signal` bricht ab, wenn der Browser nicht mehr wartet, `onProgress` meldet den
// Fortschritt mit dem Namen des Schritts weiter. Mit Bildern wählt ai/index.js den Anbieter für
// Fotos und Scans, falls einer eingerichtet ist.
async function ask(settings, step, { prompt, images = [], schema }, { signal, stats, onProgress } = {}) {
  const { ai } = settings
  const answer = await aiProvider(ai, { images: images.length > 0 }).json({
    prompt: withInstructions(prompt, ai),
    images,
    schema,
    timeoutMs: timeoutMs(step, ai),
    signal,
    onProgress: onProgress && ((event) => onProgress({ step, ...event })),
  })
  stats?.push({ step, ...answer.stats })
  return answer.data
}

// Ab dieser Länge gilt die Textebene als brauchbar. Kürzerer Text stammt meist von einem
// Scan mit Stempel oder Kopfzeile, dann sind die Seitenbilder aussagekräftiger.
const TEXT_MIN = 80
const TEXT_MAX = 20000
const PAGES_MAX = 4

// Kommt vor, wenn ein Tab von vor einem Update noch offen ist und PDFs nicht selbst liest
const NO_CONTENT =
  'Das PDF hat keine lesbare Textebene, und es kamen keine Seitenbilder mit. Bitte die Mietfuchs-Oberfläche neu laden und den Beleg dort erneut hochladen.'

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
    positionsAreNet: { type: ['boolean', 'null'], description: 'true, wenn die Positionsbeträge OHNE Umsatzsteuer ausgewiesen sind und die Steuer erst in der Summe steht' },
    vatRatePercent: { type: ['number', 'null'], description: 'Umsatzsteuersatz in Prozent, falls die Rechnung ihn nennt (z. B. 19)' },
    labor35aTotalEur: { type: ['number', 'null'], description: 'Arbeits-/Lohnkosten nach §35a EStG als EIN Betrag für die ganze Rechnung, falls nur so ausgewiesen' },
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
- Beträge in Euro mit Dezimalpunkt, so wie sie auf der Rechnung stehen. Rechne nichts um.
- Stehen die Positionsbeträge ohne Umsatzsteuer da und taucht die Steuer erst in der Summe auf
  (häufig bei Handwerkern und Schornsteinfegern), setze positionsAreNet auf true und
  vatRatePercent auf den genannten Satz. Die Positionen bleiben dann netto, wie gedruckt.
- Weist die Rechnung Arbeits-/Lohnkosten gesondert aus (häufig bei Handwerkern, Gartenpflege,
  Schornsteinfeger als "Anteil nach §35a EStG"), gib sie als labor35aEur an, sonst null.
- Nennt die Rechnung die Arbeitskosten nur als einen Betrag für das Ganze ("Im Rechnungsbetrag
  sind Arbeitskosten in Höhe von 90,56 EUR enthalten"), gib diesen als labor35aTotalEur an und
  lass labor35aEur je Position null. Erfinde keine Aufteilung.
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

async function classifyPositions(settings, vendor, positions, options) {
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
  const { categories } = await ask(settings, 'classification', { prompt, schema }, options)
  if (!Array.isArray(categories) || categories.length !== positions.length) return positions
  return positions.map((p, i) => ({ ...p, category: CATEGORY_ENUM.includes(categories[i]) ? categories[i] : p.category }))
}

// `pdfText` und `pages` ([{ mimeType, data }]) liefert der Browser für PDFs, siehe Kopf der Datei.
// `signal`, `stats` und `onProgress` gehen an ask().
export async function extractFromFile(filePath, mimetype, settings, { pdfText = '', pages = [], signal, stats, onProgress } = {}) {
  let prompt = PROMPT
  let images = []

  if (mimetype === 'application/pdf') {
    const text = String(pdfText ?? '').trim()
    if (text.length >= TEXT_MIN) {
      prompt += `\n\n--- RECHNUNGSTEXT ---\n${text.slice(0, TEXT_MAX)}`
    } else if (pages.length > 0) {
      // Scan ohne (brauchbare) Textebene: die Seitenbilder gehen an das Vision-Modell
      images = pages.slice(0, PAGES_MAX)
      prompt += '\n\nDie Rechnung ist als Bild(er) angehängt (gescanntes PDF, ggf. mehrseitig).'
    } else {
      throw new Error(NO_CONTENT)
    }
  } else if (mimetype.startsWith('image/')) {
    images = [photoOf(filePath, mimetype)]
    prompt += '\n\nDie Rechnung ist als Bild angehängt.'
  } else {
    throw new Error(`Dateityp ${mimetype} wird nicht unterstützt (PDF oder Bild).`)
  }

  // Netto-Positionen hochrechnen und einen Lohnanteil aus dem Gesamtbetrag verteilen (#34)
  const result = normalizeAmounts(await ask(settings, 'extraction', { prompt, images, schema: SCHEMA }, { signal, stats, onProgress }))

  // Zweiter Durchgang: Kategorien gezielt nachschärfen. Schlägt er fehl, bleiben die
  // Kategorien aus der Extraktion erhalten — der Client mappt notfalls per Stichwort.
  if (Array.isArray(result.positions) && result.positions.length > 0) {
    try {
      result.positions = await classifyPositions(settings, result.vendor, result.positions, { signal, stats, onProgress })
    } catch (err) {
      // Andere Fehler bewusst ignoriert; ein Abbruch soll die Auswertung aber beenden
      if (err?.name === 'AbortError') throw err
    }
  }
  return result
}

// ---------- Universeller Eingang (Schuhkarton): Dokumenttyp + Zählerstand ----------

const DOCTYPE_SCHEMA = {
  type: 'object',
  properties: { docType: { type: 'string', enum: ['rechnung', 'zaehlerstand'] } },
  required: ['docType'],
}

const DOCTYPE_PROMPT = `Entscheide, was auf diesem Bild zu sehen ist, für eine Nebenkostenabrechnung:
- "rechnung": eine Rechnung, ein Gebührenbescheid oder ein ähnliches Kostendokument (Text, Tabellen, Beträge).
- "zaehlerstand": das Foto eines Verbrauchszählers (Wasser, Strom, Wärme) mit Zählwerk oder Display.
Antworte nur mit der Kategorie.`

// Bilder können Rechnungsfoto ODER Zählerfoto sein → klassifizieren. PDFs/Bescheide sind praktisch
// immer Kostendokumente; dort sparen wir uns den zusätzlichen Vision-Call.
export async function classifyDocType(filePath, mimetype, settings, options) {
  if (!mimetype.startsWith('image/')) return 'rechnung'
  const { docType } = await ask(
    settings,
    'docType',
    { prompt: DOCTYPE_PROMPT, images: [photoOf(filePath, mimetype)], schema: DOCTYPE_SCHEMA },
    options,
  )
  return docType === 'zaehlerstand' ? 'zaehlerstand' : 'rechnung'
}

const METER_SCHEMA = {
  type: 'object',
  properties: {
    meterNumber: { type: ['string', 'null'], description: 'Aufgedruckte Zählernummer / Gerätenummer, falls lesbar' },
    value: { type: ['number', 'null'], description: 'Abgelesener Zählerstand als Zahl (schwarze Vorkommastellen)' },
    dateOnImage: { type: ['string', 'null'], description: 'Auf dem Foto sichtbares Datum als YYYY-MM-DD, falls vorhanden' },
  },
  required: ['value'],
}

const METER_PROMPT = `Du siehst das Foto eines Verbrauchszählers (Wasser, Strom oder Wärme) für eine Nebenkostenabrechnung.
Lies ab und gib JSON zurück:
- "meterNumber": die aufgedruckte Zählernummer / Gerätenummer, falls erkennbar, sonst null.
- "value": den aktuellen Zählerstand als Zahl. Nimm die schwarzen Vorkommastellen; rote Nachkommastellen (Liter/Hunderter) weglassen.
- "dateOnImage": ein auf dem Bild sichtbares Datum als YYYY-MM-DD, sonst null.`

export async function extractMeterReading(filePath, mimetype, settings, { pages = [], signal, stats, onProgress } = {}) {
  let images
  if (mimetype === 'application/pdf') {
    if (pages.length === 0) throw new Error(NO_CONTENT)
    images = pages.slice(0, 1)
  } else if (mimetype.startsWith('image/')) {
    images = [photoOf(filePath, mimetype)]
  } else {
    throw new Error(`Dateityp ${mimetype} wird nicht unterstützt (PDF oder Bild).`)
  }
  return ask(settings, 'meterReading', { prompt: METER_PROMPT, images, schema: METER_SCHEMA }, { signal, stats, onProgress })
}
