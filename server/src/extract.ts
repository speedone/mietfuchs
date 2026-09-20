// KI-Belegauswertung: Prompts, Schemas und Ablauf. Mit welchem Anbieter das Modell läuft,
// entscheidet ai/index.ts anhand von `settings.ai`, hier geht es nur um das Fachliche.
// PDFs öffnet der Server nicht selbst: Der Browser liest sie vor dem Hochladen mit pdf.js
// (client/src/pdfIntake.ts) und schickt die Textebene mit, bei Scans ohne Textebene die
// gerenderten Seiten als Bilder. So braucht der Server kein natives Modul, und das verhält
// sich in der Programmdatei genauso wie im Docker-Image. Fotos und Seitenbilder gehen als
// { mimeType, data } an den Anbieter und erfordern ein Modell, das Bilder versteht.

import fs from 'node:fs'
import type { AiSettings, Extraction, MeterReadingExtraction } from '../../shared/types.ts'
import { aiProvider, type JsonSchema, type ProviderImage, type ProviderProgressEvent, type ProviderStats } from './ai/index.ts'
import { normalizeAmounts, type RawExtraction, type RawPosition } from './invoiceAmounts.ts'

// Settings-Ausschnitt, den dieses Modul braucht: nur die KI-Einstellungen, nicht die ganze
// Settings-Gestalt aus shared/types.ts.
type AiCapableSettings = { ai: AiSettings }

const photoOf = (filePath: string, mimetype: string): ProviderImage => ({ mimeType: mimetype, data: fs.readFileSync(filePath).toString('base64') })

// Zeitlimits je Schritt in Sekunden. Auf einem Rechner ohne Grafikkarte braucht ein Modell für
// einen mehrseitigen Scan lange: Im KI-Prüflauf (4 Kerne, keine Grafikkarte) las qwen3.5:4b zwei
// Seiten in rund acht Minuten, drei Seiten schaffte es nicht in zehn. Die Oberfläche zeigt den
// Fortschritt und lässt abbrechen, deshalb darf das Auslesen bis zu 20 Minuten dauern. Die
// Frage, was auf einem Foto zu sehen ist, ist in der Schnellerfassung der erste Schritt: Er
// enthält das Laden des Modells und ein Bild. Nur der zweite Durchgang (Kategorien) ist reiner
// Text und kurz. Das Zeitlimit unter „Erweitert“ (oder NKA_AI_TIMEOUT) gilt für alle Schritte.
const TIMEOUT_SECONDS: Record<string, number> = { extraction: 1200, classification: 180, docType: 600, meterReading: 600 }
const timeoutMs = (step: string, ai: AiSettings): number => (ai.timeoutSeconds ?? TIMEOUT_SECONDS[step]) * 1000

// „Zusätzliche Hinweise an das Modell“ aus den Einstellungen, etwa zu Eigenheiten der eigenen
// Belege. Sie stehen am Ende, damit sie die allgemeinen Regeln im Einzelfall ergänzen.
const withInstructions = (prompt: string, ai: AiSettings): string =>
  ai.extraInstructions ? `${prompt}\n\nZusätzliche Hinweise des Nutzers:\n${ai.extraInstructions}` : prompt

// Ein Fortschrittsereignis, um den auslösenden Schritt ergänzt (siehe ask)
export type AskProgressEvent = { step: string } & ProviderProgressEvent
// Kennzahlen eines Schritts, wie sie /api/extract und /api/intake in ihrer Antwort mitschicken
export type AskStats = { step: string } & ProviderStats

export type AskOptions = {
  signal?: AbortSignal
  stats?: AskStats[]
  onProgress?: (event: AskProgressEvent) => void
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

// Eine Anfrage an den Anbieter. `stats` sammelt die Kennzahlen je Schritt für die Antwort der
// Route, `signal` bricht ab, wenn der Browser nicht mehr wartet, `onProgress` meldet den
// Fortschritt mit dem Namen des Schritts weiter. Mit Bildern wählt ai/index.ts den Anbieter für
// Fotos und Scans, falls einer eingerichtet ist.
//
// Zurück kommt genau das, was der Anbieter geliefert hat: ein Objekt mit Feldern vom Typ
// `unknown`. Ein Modell hält sich nicht zwingend an sein Schema, und nichts prüft das zur
// Laufzeit gegen das Schema — deshalb engt jeder Aufrufer unten selbst ein, was er braucht,
// statt sich hier einen fertigen Typ zusichern zu lassen. Falsches fällt so beim Lesen auf und
// nicht erst in der Oberfläche.
async function ask(
  settings: AiCapableSettings,
  step: string,
  { prompt, images = [], schema }: { prompt: string; images?: ProviderImage[]; schema: JsonSchema },
  { signal, stats, onProgress }: AskOptions = {},
): Promise<Record<string, unknown>> {
  const { ai } = settings
  const answer = await aiProvider(ai, { images: images.length > 0 }).json({
    prompt: withInstructions(prompt, ai),
    images,
    schema,
    timeoutMs: timeoutMs(step, ai),
    signal,
    onProgress: onProgress && ((event: ProviderProgressEvent) => onProgress({ step, ...event })),
  })
  stats?.push({ step, ...answer.stats })
  return answer.data
}

// ---------- Zahlen und Texte aus der Antwort des Modells ----------

// Ein Text aus der Antwort des Modells. Kommt statt einer Zeichenkette eine Zahl, wird sie
// umgewandelt statt verworfen: Eine Zählernummer besteht meist nur aus Ziffern, deshalb schickt
// manches Modell sie als Zahl, während die Oberfläche sie als Zeichenkette vergleicht
// (autoMatchMeter in client/src/triage.ts). Für Beschreibung, Kostenart und Rechnungssteller
// gilt dasselbe, denn auch dort steht die Zahl danach in einem Feld, das ein Mensch liest und
// bei Bedarf überschreibt. Alles andere, etwa eine Liste oder ein Objekt, ist kein Text.
const textOrNull = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null
}

// Eine Zahl aus der Antwort des Modells, auch wenn sie als Text dasteht. Die Schemas verlangen
// für Beträge und Zählerstände Zahlen, erzwungen wird das aber nicht immer: Lehnt ein Dienst
// das Schema ab, fällt ai/openai.ts stufenweise bis auf „nur Prompt“ zurück, und ein kleines
// Modell auf dem eigenen Rechner antwortet dann, wie es mag. Ein Wert als Text darf deshalb
// nicht verlorengehen — die KI füllt vor, ein Mensch prüft, und wer abtippen muss, was das
// Modell schon gelesen hat, hat nichts gewonnen.
//
// Angenommen wird deutsche wie technische Schreibweise. Offen bleibt nur, was wirklich offen
// ist: Bei genau einem Trennzeichen mit genau drei Ziffern dahinter („1.234“) lässt sich nicht
// entscheiden, ob es gruppiert oder die Nachkommastellen abtrennt, und die beiden Lesarten
// liegen um den Faktor 1000 auseinander. Dann bleibt das Feld leer, statt zu raten.
const PLAIN = /^\d+$/
const AMBIGUOUS = /^\d{1,3}[.,]\d{3}$/
const GROUPED_DOT = /^\d{1,3}(?:\.\d{3})+$/ // 1.234.567
const GROUPED_COMMA = /^\d{1,3}(?:,\d{3})+$/ // 1,234,567
const DECIMAL_COMMA = /^\d+(?:\.\d{3})*,\d+$/ // 1234,5 · 1.234,56
const DECIMAL_DOT = /^\d+(?:,\d{3})*\.\d+$/ // 1234.5 · 1,234.56

// Einheiten, die ein Modell um die Zahl herum schreibt („12,50 €“, „EUR 12,50“, „1234 m³“). Sie
// machen die Zahl nicht mehrdeutig, und in der Rückfallstufe „nur Prompt“ ist genau diese
// Schreibweise naheliegend, bei einem Betrag noch mehr als bei einem Zählerstand. Im Browser
// liest parseEuro solche Angaben seit jeher, hier sollen sie deshalb auch ankommen.
//
// Die Listen sind mit Absicht kurz und sollen es bleiben. Sie nennen die Währung, mit der dieses
// Werkzeug rechnet, und die Einheiten, die bei seinen Zählern überhaupt vorkommen (Kubikmeter
// für Wasser, Kilowattstunden für Strom und Wärme), je in den Schreibweisen, die ein Modell
// dafür benutzt. Eine Währung darf vor oder hinter der Zahl stehen, eine Zählereinheit nur
// dahinter. Was hier nicht steht, bleibt ungelesen. Eine allgemeine Regel, also „alles
// abschneiden, was keine Ziffer ist“, wäre etwas anderes: Sie würde auch „ca. 1234“ oder
// „12 oder 13“ zu einer Zahl machen. Das ist keine Einheit, sondern eine Unsicherheit des
// Modells, und die soll der Mensch sehen. Die längere Schreibweise steht jeweils vorn, damit
// „EURO“ nicht als „EUR“ mit einem übrig gebliebenen O gelesen wird.
const CURRENCIES = ['euro', 'eur', '€']
const UNITS = [...CURRENCIES, 'm³', 'm3', 'cbm', 'kwh']

// Eine bekannte Einheit am Ende abtrennen, sonst den Wert unverändert lassen
function withoutUnit(body: string): string {
  const lower = body.toLowerCase()
  const unit = UNITS.find((u) => lower.length > u.length && lower.endsWith(u))
  return unit ? body.slice(0, body.length - unit.length) : body
}

// Eine vorangestellte Währung abtrennen, auch vor einem Vorzeichen („EUR -5“ wie „-5 EUR“)
function withoutCurrency(text: string): string {
  const sign = /^[+-]/.test(text) ? text.slice(0, 1) : ''
  const rest = text.slice(sign.length)
  const lower = rest.toLowerCase()
  const currency = CURRENCIES.find((c) => lower.length > c.length && lower.startsWith(c))
  return sign + (currency ? rest.slice(currency.length) : rest)
}

export function numberFromModel(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const text = value.replace(/[\s  ]/g, '') // manche Modelle gruppieren mit Leerzeichen
  const signed = withoutCurrency(text) // „EUR 12,50“ genauso wie „12,50 EUR“
  const negative = signed.startsWith('-')
  const body = withoutUnit(signed.replace(/^[+-]/, ''))
  if (!/^[\d.,]+$/.test(body) || AMBIGUOUS.test(body)) return null
  let digits: string | null = null
  if (PLAIN.test(body)) digits = body
  else if (GROUPED_DOT.test(body)) digits = body.replaceAll('.', '')
  else if (GROUPED_COMMA.test(body)) digits = body.replaceAll(',', '')
  else if (DECIMAL_COMMA.test(body)) digits = body.replaceAll('.', '').replace(',', '.')
  else if (DECIMAL_DOT.test(body)) digits = body.replaceAll(',', '')
  if (digits === null) return null
  const parsed = Number(digits)
  if (!Number.isFinite(parsed)) return null
  return negative ? -parsed : parsed
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

async function classifyPositions(settings: AiCapableSettings, vendor: string | undefined, positions: RawPosition[], options: AskOptions): Promise<RawPosition[]> {
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
  return positions.map((p, i) => {
    const category: unknown = categories[i]
    return { ...p, category: typeof category === 'string' && CATEGORY_ENUM.includes(category) ? category : p.category }
  })
}

// `pdfText` und `pages` ([{ mimeType, data }]) liefert der Browser für PDFs, siehe Kopf der Datei.
// `signal`, `stats` und `onProgress` gehen an ask().
export async function extractFromFile(
  filePath: string,
  mimetype: string,
  settings: AiCapableSettings,
  { pdfText = '', pages = [], signal, stats, onProgress }: { pdfText?: string; pages?: ProviderImage[] } & AskOptions = {},
): Promise<Extraction> {
  let prompt = PROMPT
  let images: ProviderImage[] = []

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

  // Netto-Positionen hochrechnen und einen Lohnanteil aus dem Gesamtbetrag verteilen (#34).
  const answer = await ask(settings, 'extraction', { prompt, images, schema: SCHEMA }, { signal, stats, onProgress })
  const result = normalizeAmounts(rawFromAnswer(answer))

  // Zweiter Durchgang: Kategorien gezielt nachschärfen. Schlägt er fehl, bleiben die
  // Kategorien aus der Extraktion erhalten — der Client mappt notfalls per Stichwort.
  if (Array.isArray(result.positions) && result.positions.length > 0) {
    try {
      const vendor = typeof result.vendor === 'string' ? result.vendor : undefined
      result.positions = await classifyPositions(settings, vendor, result.positions, { signal, stats, onProgress })
    } catch (err) {
      // Andere Fehler bewusst ignoriert; ein Abbruch soll die Auswertung aber beenden
      if (err instanceof Error && err.name === 'AbortError') throw err
    }
  }
  return toExtraction(result)
}

// ---------- Die Naht: von der Antwort des Modells zu dem, was die Oberfläche bekommt ----------
//
// Zwei Stadien derselben Daten, und beide brauchen ihre eigene Beschreibung: Was vom Modell
// kommt, ist `RawExtraction` (invoiceAmounts.ts) und darin alles `unknown`, denn ein Modell kann
// statt einer Zahl auch „neunzehn“ schicken. Was der Browser bekommt, ist `Extraction`
// (shared/types.ts) mit engen Typen. Die beiden Funktionen hier sind der Eingang und der Ausgang
// dazwischen; überschritten wird die Grenze nur an diesen zwei Stellen, und benannt.

// Eingang: die Antwort des Modells, zurechtgelegt für das Geraderücken. Zweierlei geschieht
// dabei. Erstens nimmt Mietfuchs dem Modell zwei Felder aus der Hand: `amountsAdjusted` und
// `laborFromTotal` sagen aus, was Mietfuchs selbst gerechnet hat (#34) — behauptete das Modell
// sie, stünde in der Oberfläche ein Hinweis auf eine Rechnung, die nie stattgefunden hat.
// Zweitens werden Beträge, die als Text dastehen, hier gelesen (numberFromModel) und nicht erst
// am Ausgang: So rechnet normalizeAmounts mit denselben Zahlen, die der Nutzer danach sieht.
// Alle übrigen Werte bleiben `unknown` und werden dort geprüft, wo sie gebraucht werden.
export function rawFromAnswer(answer: Record<string, unknown>): RawExtraction {
  const { amountsAdjusted: _adjusted, laborFromTotal: _fromTotal, ...fields } = answer
  const positions: Record<string, unknown>[] = Array.isArray(answer.positions) ? answer.positions.filter(isObject) : []
  return {
    ...fields,
    totalGrossEur: numberFromModel(answer.totalGrossEur) ?? answer.totalGrossEur,
    positions: positions.map((p): RawPosition => ({
      ...p,
      amountEur: numberFromModel(p.amountEur) ?? p.amountEur,
      labor35aEur: numberFromModel(p.labor35aEur) ?? p.labor35aEur,
    })),
  }
}

// Ausgang: hier entsteht die Zusage, die die Oberfläche bekommt, und nur hier. Geprüft wird
// dabei bewusst wenig — nur das, was die Oberfläche wirklich braucht. Eine vollständige Prüfung
// der Modellantwort wäre am Werkzeug vorbei: Die KI schlägt vor, ein Mensch prüft jede Position,
// bevor sie übernommen wird. Verworfen wird deshalb nur, was niemand gebrauchen kann.
//
// Ein Betrag, der keine Zahl ist, fehlt danach; das leere Feld füllt der Mensch aus. Fehlt eine
// Beschreibung oder eine Kostenart, steht dort eine leere Zeichenkette, denn die Oberfläche
// zeigt beide als Eingabefeld und kommt damit zurecht. Felder, die das Modell erfunden hat,
// erreichen den Browser gar nicht erst.
export function toExtraction(raw: RawExtraction): Extraction {
  return {
    vendor: textOrUndefined(raw.vendor),
    invoiceDate: textOrUndefined(raw.invoiceDate),
    periodStart: textOrUndefined(raw.periodStart),
    periodEnd: textOrUndefined(raw.periodEnd),
    totalGrossEur: finiteOrNull(raw.totalGrossEur) ?? undefined,
    positions: (raw.positions ?? []).map((p) => {
      const position: ExtractionPosition = {
        description: textOrEmpty(p.description),
        category: textOrEmpty(p.category),
        labor35aEur: finiteOrNull(p.labor35aEur),
      }
      // Der Lohnanteil darf ausdrücklich leer sein („keiner ausgewiesen“, so steht es im
      // Schema), der Betrag nicht: Ist er keine Zahl, fehlt das Feld.
      const amountEur = finiteOrNull(p.amountEur)
      if (amountEur !== null) position.amountEur = amountEur
      return position
    }),
    // Die beiden hat Mietfuchs selbst gesetzt (normalizeAmounts), nicht das Modell; dafür sorgt
    // der Eingang oben, und ihren Typ nehmen sie in invoiceAmounts.ts aus Extraction. Geprüft
    // werden sie hier trotzdem, denn eine Zusage soll dort eingelöst werden, wo sie gegeben
    // wird, statt davon abzuhängen, was an anderer Stelle geschieht.
    amountsAdjusted: raw.amountsAdjusted === 'netto' ? 'netto' : undefined,
    laborFromTotal: raw.laborFromTotal === true ? true : undefined,
  }
}

// Eine Position, wie die Oberfläche sie bekommt — aus shared/types.ts abgeleitet, damit hier
// nichts zu pflegen ist, wenn das Datenmodell wächst.
type ExtractionPosition = NonNullable<Extraction['positions']>[number]
// Beide lesen Texte nach derselben Regel wie der Zählerstand (textOrNull), nur ist ein fehlender
// Text hier einmal ein leeres Feld und einmal gar kein Feld.
const textOrEmpty = (value: unknown): string => textOrNull(value) ?? ''
const textOrUndefined = (value: unknown): string | undefined => textOrNull(value) ?? undefined
const finiteOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

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
export async function classifyDocType(filePath: string, mimetype: string, settings: AiCapableSettings, options: AskOptions): Promise<'rechnung' | 'zaehlerstand'> {
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

export async function extractMeterReading(
  filePath: string,
  mimetype: string,
  settings: AiCapableSettings,
  { pages = [], signal, stats, onProgress }: { pages?: ProviderImage[] } & AskOptions = {},
): Promise<MeterReadingExtraction> {
  let images: ProviderImage[]
  if (mimetype === 'application/pdf') {
    if (pages.length === 0) throw new Error(NO_CONTENT)
    images = pages.slice(0, 1)
  } else if (mimetype.startsWith('image/')) {
    images = [photoOf(filePath, mimetype)]
  } else {
    throw new Error(`Dateityp ${mimetype} wird nicht unterstützt (PDF oder Bild).`)
  }
  const answer = await ask(settings, 'meterReading', { prompt: METER_PROMPT, images, schema: METER_SCHEMA }, { signal, stats, onProgress })
  // Die drei Felder einzeln einengen statt die ganze Antwort zuzusichern. Der Zählerstand darf
  // dabei auch als Text kommen (siehe numberFromModel), die Zählernummer ebenso als Zahl — sie
  // besteht ja meist nur aus Ziffern, und die Oberfläche vergleicht sie als Zeichenkette.
  return {
    meterNumber: textOrNull(answer.meterNumber),
    value: numberFromModel(answer.value),
    dateOnImage: typeof answer.dateOnImage === 'string' ? answer.dateOnImage : null,
  }
}
