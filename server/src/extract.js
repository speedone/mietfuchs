// KI-Belegauswertung über eine lokale Ollama-Instanz.
// PDFs öffnet der Server nicht selbst: Der Browser liest sie vor dem Hochladen mit pdf.js
// (client/src/pdfIntake.ts) und schickt die Textebene mit, bei Scans ohne Textebene die
// gerenderten Seiten als Bilder. So braucht der Server kein natives Modul, und das verhält
// sich in der Programmdatei genauso wie im Docker-Image. Bilder (Handyfotos) gehen als
// Base64 an das Modell, Seitenbilder ebenso. Beides erfordert ein Vision-fähiges Modell.

import fs from 'node:fs'

// Ab dieser Länge gilt die Textebene als brauchbar. Kürzerer Text stammt meist von einem
// Scan mit Stempel oder Kopfzeile, dann sind die Seitenbilder aussagekräftiger.
const TEXT_MIN = 80
const TEXT_MAX = 20000
const SEITEN_MAX = 4

// Kommt vor, wenn ein Tab von vor einem Update noch offen ist und PDFs nicht selbst liest
const OHNE_INHALT =
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
  },
  required: ['vendor', 'positions', 'totalGrossEur'],
}

const CATEGORY_ENUM = SCHEMA.properties.positions.items.properties.category.enum

const basisVon = (settings) => settings.ollamaUrl.replace(/\/+$/, '')

// Gemeinsamer Weg für alle Anfragen an Ollama. Übersetzt die häufigen Fehler in Meldungen,
// mit denen man in der Oberfläche etwas anfangen kann: Ollama läuft nicht oder unter einer
// anderen Adresse, das Modell ist nicht geladen, die Antwort dauert zu lange.
async function ollama(settings, pfad, { body, timeoutMs }) {
  const base = basisVon(settings)
  let res
  try {
    res = await fetch(`${base}${pfad}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new Error(`Ollama hat nicht innerhalb von ${Math.round(timeoutMs / 1000)} Sekunden geantwortet. Ohne Grafikkarte ist ein großes Modell oft zu langsam, dann hilft ein kleineres.`)
    }
    throw new Error(`Ollama ist unter ${base} nicht erreichbar. Läuft Ollama? Die Adresse steht in den Einstellungen.`)
  }
  if (res.status === 404 && body?.model) {
    throw new Error(`Das Modell „${body.model}" ist in Ollama nicht installiert. In den Einstellungen ein installiertes Modell wählen oder es mit „ollama pull ${body.model}" laden.`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Ollama antwortet mit ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

// Ein Chat-Aufruf mit erzwungenem JSON-Schema; liefert das geparste Ergebnis
async function chatJson(settings, message, format, timeoutMs) {
  const data = await ollama(settings, '/api/chat', {
    body: { model: settings.ollamaModel, messages: [message], stream: false, format, options: { temperature: 0 } },
    timeoutMs,
  })
  return JSON.parse(data.message?.content ?? '{}')
}

// Fähigkeiten laut Ollama, etwa ['completion', 'vision']. Ältere Versionen kennen das Feld
// nicht, dann null.
async function faehigkeiten(settings, model) {
  const info = await ollama(settings, '/api/show', { body: { model }, timeoutMs: 10000 })
  return { capabilities: Array.isArray(info.capabilities) ? info.capabilities : null, remote: Boolean(info.remote_host) }
}

// Vor dem Senden von Bildern: Ein Modell ohne Bildverständnis würde sie übergehen und sich
// eine Rechnung ausdenken. Kennt Ollama die Fähigkeiten nicht, wird es versucht.
async function bilderPruefen(settings) {
  const { capabilities } = await faehigkeiten(settings, settings.ollamaModel)
  if (capabilities && !capabilities.includes('vision')) {
    throw new Error(`Das Modell „${settings.ollamaModel}" versteht keine Bilder. Für Fotos und gescannte PDFs in den Einstellungen ein Modell mit Bildverständnis wählen.`)
  }
}

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

async function classifyPositions(settings, vendor, positions) {
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
  const { categories } = await chatJson(settings, { role: 'user', content: prompt }, schema, 120000)
  if (!Array.isArray(categories) || categories.length !== positions.length) return positions
  return positions.map((p, i) => ({ ...p, category: CATEGORY_ENUM.includes(categories[i]) ? categories[i] : p.category }))
}

// `pdfText` und `pages` (Base64) liefert der Browser für PDFs, siehe Kopf der Datei.
export async function extractFromFile(filePath, mimetype, settings, { pdfText = '', pages = [] } = {}) {
  const message = { role: 'user', content: PROMPT }

  if (mimetype === 'application/pdf') {
    const text = String(pdfText ?? '').trim()
    if (text.length >= TEXT_MIN) {
      message.content += `\n\n--- RECHNUNGSTEXT ---\n${text.slice(0, TEXT_MAX)}`
    } else if (pages.length > 0) {
      // Scan ohne (brauchbare) Textebene: die Seitenbilder gehen an das Vision-Modell
      message.images = pages.slice(0, SEITEN_MAX)
      message.content += '\n\nDie Rechnung ist als Bild(er) angehängt (gescanntes PDF, ggf. mehrseitig).'
    } else {
      throw new Error(OHNE_INHALT)
    }
  } else if (mimetype.startsWith('image/')) {
    message.images = [fs.readFileSync(filePath).toString('base64')]
    message.content += '\n\nDie Rechnung ist als Bild angehängt.'
  } else {
    throw new Error(`Dateityp ${mimetype} wird nicht unterstützt (PDF oder Bild).`)
  }

  if (message.images) await bilderPruefen(settings)
  const result = await chatJson(settings, message, SCHEMA, 300000)

  // Zweiter Durchgang: Kategorien gezielt nachschärfen. Schlägt er fehl, bleiben die
  // Kategorien aus der Extraktion erhalten — der Client mappt notfalls per Stichwort.
  if (Array.isArray(result.positions) && result.positions.length > 0) {
    try {
      result.positions = await classifyPositions(settings, result.vendor, result.positions)
    } catch {
      // bewusst ignoriert
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
export async function classifyDocType(filePath, mimetype, settings) {
  if (!mimetype.startsWith('image/')) return 'rechnung'
  await bilderPruefen(settings)
  const image = fs.readFileSync(filePath).toString('base64')
  const { docType } = await chatJson(settings, { role: 'user', content: DOCTYPE_PROMPT, images: [image] }, DOCTYPE_SCHEMA, 120000)
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

export async function extractMeterReading(filePath, mimetype, settings, { pages = [] } = {}) {
  const message = { role: 'user', content: METER_PROMPT }
  if (mimetype === 'application/pdf') {
    if (pages.length === 0) throw new Error(OHNE_INHALT)
    message.images = pages.slice(0, 1)
  } else if (mimetype.startsWith('image/')) {
    message.images = [fs.readFileSync(filePath).toString('base64')]
  } else {
    throw new Error(`Dateityp ${mimetype} wird nicht unterstützt (PDF oder Bild).`)
  }
  await bilderPruefen(settings)
  return chatJson(settings, message, METER_SCHEMA, 300000)
}

// Installierte Modelle für die Auswahl in den Einstellungen. `vision` sagt, ob das Modell
// Bilder versteht (null: Ollama kennt die Fähigkeiten nicht). `remote` kennzeichnet Modelle,
// die Ollama an einen Cloud-Dienst weiterreicht, die Belege verlassen dann den Rechner.
// Reine Embedding-Modelle können keine Rechnung lesen und fehlen deshalb.
export async function listOllamaModels(settings) {
  const { models = [] } = await ollama(settings, '/api/tags', { timeoutMs: 5000 })
  const liste = await Promise.all(
    models.map(async (m) => {
      const info = await faehigkeiten(settings, m.name).catch(() => ({ capabilities: null, remote: false }))
      if (info.capabilities && !info.capabilities.includes('completion')) return null
      return {
        name: m.name,
        sizeBytes: m.size ?? null,
        vision: info.capabilities ? info.capabilities.includes('vision') : null,
        remote: info.remote || Boolean(m.remote_host),
      }
    }),
  )
  return liste.filter(Boolean)
}

// Sucht Ollama unter den üblichen Adressen, wenn die eingestellte nicht antwortet: auf diesem
// Rechner, vom Docker-Container aus auf dem Host und als Dienst `ollama` im Compose-Profil.
// Die erste Adresse der Liste, die wie Ollama antwortet, gewinnt.
export async function findOllama(kandidaten) {
  const antworten = await Promise.all(
    kandidaten.map(async (url) => {
      try {
        const res = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(1500) })
        return res.ok && typeof (await res.json()).version === 'string'
      } catch {
        return false
      }
    }),
  )
  return kandidaten.find((_, i) => antworten[i]) ?? null
}
