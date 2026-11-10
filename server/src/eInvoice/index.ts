// Der eine Eingang für die E-Rechnung (#189): Bytes hinein, Vorschlag oder Begründung heraus.
// Entwurf: docs/superpowers/specs/2026-11-09-e-rechnung-design.md
//
// - `none`: keine E-Rechnung (oder kein XML). Der Beleg geht den bisherigen Weg.
// - `refused`: eine E-Rechnung, die nicht übernommen wird; der Satz sagt warum. Bisheriger Weg.
// - `read`: der Vorschlag als `RawExtraction` für normalizeAmounts/toExtraction, dazu je
//   Position, ob der Lohnanteil nur vorgeschlagen ist, die Notizen aus check.ts und BT-1.

import type { RawExtraction } from '../invoiceAmounts.ts'
import { decodeXml } from '../xml.ts'
import { checkEInvoice } from './check.ts'
import { detectEInvoice, eInvoiceSyntaxOf, E_INVOICE_MAX_BYTES } from './detect.ts'
import { readModel } from './read.ts'
import { toRawExtraction } from './toRaw.ts'

export type EInvoiceResult =
  | { kind: 'none' }
  | { kind: 'refused', reason: string }
  | { kind: 'read', raw: RawExtraction, laborGuessed: boolean[], notes: string[], invoiceNumber: string | null }

// Eingebettete Anhänge (BG-24: UBL `EmbeddedDocumentBinaryObject`, CII `AttachmentBinaryObject`) sind
// base64 und können Megabytes groß sein; gelesen wird nichts davon. Ausgeschnitten wird nur der Text
// bis zum nächsten `<`, also nie Markup: Eine Dokumenttyp-Erklärung bleibt sichtbar und wird abgelehnt.
// So dauert eine XRechnung mit 24 MB Anhang Millisekunden statt Sekunden, in denen der Server stünde.
function withoutAttachments(xml: string): string {
  return xml.replace(/(<(?:[\w.-]+:)?(?:EmbeddedDocumentBinaryObject|AttachmentBinaryObject)\b[^>]*>)[^<]*/g, '$1')
}

// Das XML, aufbereitet zum Erkennen: `null`, wenn es kein XML ist oder zu groß.
function xmlOf(data: Buffer): string | null {
  if (data.length > E_INVOICE_MAX_BYTES) return null
  const decoded = decodeXml(data)
  if ('problem' in decoded) return null
  // Was nicht wie XML anfängt, ist keine E-Rechnung.
  if (!/^\s*(?:\uFEFF)?\s*</.test(decoded.xml)) return null
  return withoutAttachments(decoded.xml)
}

// Darf eine reine XML-Datei als Beleg liegen bleiben (#189, PR 3)? Nur eine E-Rechnung (UBL oder CII, ohne
// Dokumenttyp-Erklärung, höchstens 25 MB), auch eine, die Mietfuchs nicht übernimmt. Wirft nie.
export function isEInvoiceDocument(data: Buffer): boolean {
  try {
    const xml = xmlOf(data)
    return xml !== null && eInvoiceSyntaxOf(xml) !== null
  } catch {
    return false
  }
}

// Wirft nie: Eine Datei von außen ist im schlimmsten Fall „nicht übernommen“.
export function readEInvoice(data: Buffer): EInvoiceResult {
  try {
    return readUnguarded(data)
  } catch {
    return { kind: 'refused', reason: 'Die E-Rechnung ließ sich nicht lesen.' }
  }
}

function readUnguarded(data: Buffer): EInvoiceResult {
  if (data.length > E_INVOICE_MAX_BYTES) return { kind: 'refused', reason: 'Die E-Rechnung ist größer als 25 MB; Mietfuchs liest sie nicht.' }
  const xml = xmlOf(data)
  if (xml === null) return { kind: 'none' }
  const found = detectEInvoice(xml)
  if (found === null) return { kind: 'none' }
  if ('refused' in found) return { kind: 'refused', reason: found.refused }
  const inv = readModel(xml, found.syntax)
  const checked = checkEInvoice(inv)
  if ('refused' in checked) return { kind: 'refused', reason: checked.refused }
  const { raw, laborGuessed } = toRawExtraction(inv)
  return { kind: 'read', raw, laborGuessed, notes: checked.notes, invoiceNumber: inv.number }
}
