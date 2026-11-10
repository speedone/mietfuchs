// Kleine XML-Leser für Dateien von außen: Kontoauszug (camt, #188) und E-Rechnung (#189).
//
// Grundsätze, für beide gleich:
// - **Keine Entitäten auflösen.** Der Parser lässt sie stehen; `text` löst nur die fünf
//   vordefinierten und Zeichenreferenzen auf. Eine Datei mit Dokumenttyp-Erklärung oder eigenen
//   Entitäten lehnt der Aufrufer vorher ab (`refuseUnsafe`): Sie könnte beim Auflösen beliebig
//   wachsen, und weder ein Kontoauszug noch eine E-Rechnung braucht eine.
// - **Alles bleibt Text.** Eine IBAN, eine Referenz mit führender Null oder ein Betrag darf nicht
//   als Zahl gelesen werden; Beträge zerlegt `signedDecimalToCents` bzw. `decimalToCents`.

import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { decimalToCents } from './bank/statement.ts'

export type XmlNode = Record<string, unknown>

// `keepPrefixes: false` wirft die Präfixe der Namensräume weg (camt.053.001.02 bis .08 unterscheiden
// sich nur im Namensraum, UBL und CII schreiben dieselben Elemente mal mit, mal ohne Präfix) und
// mit ihnen die `xmlns`-Angaben. Wer den Namensraum prüfen will, liest mit `keepPrefixes: true`.
export function makeParser(opts: { keepPrefixes: boolean }): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    textNodeName: '#text',
    removeNSPrefix: !opts.keepPrefixes,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: false,
    htmlEntities: false,
  })
}

// Was an einer Datei vor dem Parsen nicht stimmt: eine Dokumenttyp-Erklärung oder eigene
// Entitäten, oder unvollständiges XML (der Parser liest auch eine abgeschnittene Datei
// nachsichtig ein, und aus einem halben Dokument würde still ein leeres). Den Satz dazu schreibt
// der Aufrufer, denn er weiß, was die Datei hätte sein sollen.
export function refuseUnsafe(xml: string): 'doctype' | 'incomplete' | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return 'doctype'
  if (XMLValidator.validate(xml) !== true) return 'incomplete'
  return null
}

// Parsen, ohne zu werfen. fast-xml-parser wirft bei Dingen, die der Validator durchlässt: sehr tiefe
// Verschachtelung und Namen wie `__proto__` (Schutz vor Prototyp-Verschmutzung). Für eine Datei von
// außen heißt das nur „nicht lesbar“, nie einen Absturz der Anfrage.
export function tryParse(parser: XMLParser, xml: string): unknown {
  try {
    return parser.parse(xml)
  } catch {
    return undefined
  }
}

export const isNode = (v: unknown): v is XmlNode => typeof v === 'object' && v !== null && !Array.isArray(v)

// Ein Element, das einmal vorkommt, liest der Parser als Objekt, mehrfach als Liste.
export function list(v: unknown): unknown[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

// Das erste Vorkommen am Ende eines Pfads.
export function at(node: unknown, ...path: string[]): unknown {
  let cur: unknown = node
  for (const key of path) {
    if (Array.isArray(cur)) cur = cur[0]
    if (!isNode(cur)) return undefined
    cur = cur[key]
  }
  return Array.isArray(cur) ? cur[0] : cur
}

// Alle Vorkommen eines Pfads, über jede Ebene, die sich wiederholen darf: `all(ntry, 'NtryDtls',
// 'TxDtls')` liefert die Posten aller `NtryDtls`-Blöcke, nicht nur die des ersten.
export function all(node: unknown, ...path: string[]): unknown[] {
  let level: unknown[] = list(node)
  for (const key of path) level = level.flatMap((n) => (isNode(n) ? list(n[key]) : []))
  return level
}

// Der Parser löst keine Entitäten auf (siehe oben). Hier werden genau die fünf vordefinierten
// (&amp; &lt; &gt; &quot; &apos;) und Zeichenreferenzen (&#228; &#xE4;) aufgelöst, in einem
// Durchgang, damit „&amp;lt;“ als „&lt;“ stehen bleibt und nicht zu „<“ wird.
const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(s: string): string {
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (name !== undefined) return PREDEFINED[name.toLowerCase()] ?? whole
    const code = hex !== undefined ? parseInt(hex, 16) : Number(dec)
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

export function text(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = decodeEntities(v).trim()
    return s === '' ? null : s
  }
  if (isNode(v) && typeof v['#text'] === 'string') return text(v['#text'])
  return null
}

// Ein Attribut eines Elements (`currencyID`, `unitCode`, `format`, `xmlns:rsm`).
export function attr(v: unknown, name: string): string | null {
  return isNode(v) ? text(v[`@${name}`]) : null
}

// '-12.50' → -1250. Wie `decimalToCents` mit Punkt, dazu ein führendes Minus (eine E-Rechnung
// kennt negative Positionen und Rundungsbeträge). Kein Plus, kein Exponent, gerundet wird nicht.
export function signedDecimalToCents(raw: string): number | null {
  const s = raw.trim()
  const negative = s.startsWith('-')
  const cents = decimalToCents(negative ? s.slice(1) : s, '.')
  if (cents === null) return null
  return negative && cents !== 0 ? -cents : cents
}

// Die Kodierung steht in der XML-Erklärung. UTF-8 ist der Normalfall; ältere Exporte kommen in
// ISO-8859-1 oder Windows-1252, und als UTF-8 gelesen würde aus „März“ „M�rz“, und der
// Verwendungszweck stimmte mit dem desselben Umsatzes aus einer anderen Datei nicht mehr überein.
export function decodeXml(data: Buffer): { xml: string } | { problem: string } {
  const head = data.subarray(0, 200).toString('latin1')
  const declared = /^(?:\xEF\xBB\xBF)?<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(head)?.[1].toLowerCase() ?? 'utf-8'
  // ISO-8859-1 wird wie Windows-1252 gelesen, wie es auch Browser tun: Die beiden unterscheiden
  // sich nur in Steuerzeichen, die in einem Kontoauszug nicht vorkommen, dafür steht das €-Zeichen
  // aus Windows-Exporten dann richtig da.
  const label = declared === 'iso-8859-1' || declared === 'latin1' ? 'windows-1252' : declared
  try {
    return { xml: new TextDecoder(label).decode(data) }
  } catch {
    return { problem: `Die Datei ist in der Kodierung „${declared}“ geschrieben, die Mietfuchs nicht lesen kann.` }
  }
}
