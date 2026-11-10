// Ist ein XML eine E-Rechnung (#189)? Erkannt wird am Wurzelelement samt Namensraum, nicht am
// Dateinamen: Im PDF heißt der Anhang je Fassung anders (factur-x.xml, xrechnung.xml,
// zugferd-invoice.xml), und eine reine XRechnung kann heißen, wie sie will.
//
// Die E-Rechnung nach EN 16931 gibt es in zwei Schreibweisen: UBL (Rechnung und Gutschrift
// getrennt) und CII (auch das XML in ZUGFeRD und Factur-X). Nicht übernommen werden die Profile
// MINIMUM und BASIC WL und ZUGFeRD 1.0: Sie gelten nicht als E-Rechnung (UStAE 14.1 Abs. 14), und
// MINIMUM und BASIC WL tragen keine Positionen. Ein solches PDF geht den bisherigen Weg.

import { at, attr, isNode, makeParser, refuseUnsafe, text, tryParse } from '../xml.ts'
import type { EInvoiceSyntax, Refusal } from './model.ts'

// Wie die Grenze für hochgeladene Belege (index.ts): Eine XRechnung kann Anhänge (Stundenzettel,
// Fotos) in base64 tragen und so groß werden wie ein PDF.
export const E_INVOICE_MAX_BYTES = 25 * 1024 * 1024

const ROOTS: Record<string, { local: string, syntax: EInvoiceSyntax }> = {
  'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2': { local: 'Invoice', syntax: 'ubl-invoice' },
  'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2': { local: 'CreditNote', syntax: 'ubl-credit-note' },
  'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100': { local: 'CrossIndustryInvoice', syntax: 'cii' },
}
const ZUGFERD_1 = 'urn:ferd:CrossIndustryDocument:invoice:1p0'
const UNPARSABLE = 'Die Datei ließ sich nicht als XML lesen (zu tief verschachtelt oder mit unzulässigen Namen).'
const NO_POSITIONS = ['urn:factur-x.eu:1p0:minimum', 'urn:factur-x.eu:1p0:basicwl', 'urn:zugferd.de:2p0:minimum', 'urn:zugferd.de:2p0:basicwl']

// Wurzel und ihr Namensraum. Dafür wird mit Präfixen gelesen, denn ohne sie verwirft der Parser
// auch die `xmlns`-Angaben.
function rootOf(xml: string): { local: string, namespace: string | null } | 'unparsable' | null {
  const doc = tryParse(makeParser({ keepPrefixes: true }), xml)
  if (doc === undefined) return 'unparsable'
  if (!isNode(doc)) return null
  const name = Object.keys(doc).find((k) => !k.startsWith('?') && !k.startsWith('#'))
  if (name === undefined) return null
  const colon = name.indexOf(':')
  const prefix = colon < 0 ? null : name.slice(0, colon)
  return { local: name.slice(colon + 1), namespace: attr(doc[name], prefix === null ? 'xmlns' : `xmlns:${prefix}`) }
}

// Ist das XML eine E-Rechnung, gleich ob Mietfuchs sie übernimmt? Wurzel samt Namensraum, keine Dokumenttyp-Erklärung,
// vollständig. Danach entscheidet sich, ob eine reine XML-Datei als Beleg liegen bleiben darf (index.ts).
export function eInvoiceSyntaxOf(xml: string): EInvoiceSyntax | null {
  if (refuseUnsafe(xml) !== null) return null
  const root = rootOf(xml)
  if (root === 'unparsable' || root === null || root.namespace === null) return null
  const known = ROOTS[root.namespace]
  return known && known.local === root.local ? known.syntax : null
}

// `null`: keine E-Rechnung (anderes XML). `Refusal`: eine E-Rechnung, die nicht übernommen wird,
// oder eine Datei, die sich nicht sicher lesen lässt.
export function detectEInvoice(xml: string): { syntax: EInvoiceSyntax, profile: string | null } | Refusal | null {
  const unsafe = refuseUnsafe(xml)
  if (unsafe === 'doctype') return { refused: 'Die Datei enthält eine Dokumenttyp-Erklärung. Eine E-Rechnung braucht keine, deshalb liest Mietfuchs sie nicht.' }
  if (unsafe === 'incomplete') return { refused: 'Die Datei ist kein vollständiges XML; vielleicht wurde sie beim Herunterladen abgeschnitten.' }
  const root = rootOf(xml)
  if (root === 'unparsable') return { refused: UNPARSABLE }
  if (!root || root.namespace === null) return null
  if (root.namespace === ZUGFERD_1) return { refused: 'Die Rechnung ist im veralteten Format ZUGFeRD 1.0 geschrieben, das nicht als E-Rechnung gilt. Mietfuchs liest sie wie ein gewöhnliches PDF.' }
  const known = ROOTS[root.namespace]
  if (!known || known.local !== root.local) return null
  const parsed = tryParse(makeParser({ keepPrefixes: false }), xml)
  if (parsed === undefined) return { refused: UNPARSABLE }
  const body = at(parsed, known.local)
  const profile = text(known.syntax === 'cii'
    ? at(body, 'ExchangedDocumentContext', 'GuidelineSpecifiedDocumentContextParameter', 'ID')
    : at(body, 'CustomizationID'))
  if (profile !== null && NO_POSITIONS.some((p) => profile.toLowerCase().startsWith(p))) {
    return { refused: 'Die eingebettete Rechnung ist im Profil MINIMUM oder BASIC WL geschrieben und enthält keine Positionen. Mietfuchs liest sie wie ein gewöhnliches PDF.' }
  }
  return { syntax: known.syntax, profile }
}
