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
import { detectEInvoice, E_INVOICE_MAX_BYTES } from './detect.ts'
import { readModel } from './read.ts'
import { toRawExtraction } from './toRaw.ts'

export type EInvoiceResult =
  | { kind: 'none' }
  | { kind: 'refused', reason: string }
  | { kind: 'read', raw: RawExtraction, laborGuessed: boolean[], notes: string[], invoiceNumber: string | null }

// Wirft nie: Eine Datei von außen ist im schlimmsten Fall „nicht übernommen“.
export function readEInvoice(data: Buffer): EInvoiceResult {
  try {
    return readUnguarded(data)
  } catch {
    return { kind: 'refused', reason: 'Die E-Rechnung ließ sich nicht lesen.' }
  }
}

function readUnguarded(data: Buffer): EInvoiceResult {
  if (data.length > E_INVOICE_MAX_BYTES) return { kind: 'refused', reason: 'Die E-Rechnung ist größer als 10 MB; Mietfuchs liest sie nicht.' }
  const decoded = decodeXml(data)
  if ('problem' in decoded) return { kind: 'none' }
  // Was nicht wie XML anfängt, ist keine E-Rechnung, und die Prüfung auf Vollständigkeit soll es
  // nicht als abgeschnittenes XML melden.
  if (!/^\s*(?:﻿)?\s*</.test(decoded.xml)) return { kind: 'none' }
  const found = detectEInvoice(decoded.xml)
  if (found === null) return { kind: 'none' }
  if ('refused' in found) return { kind: 'refused', reason: found.refused }
  const inv = readModel(decoded.xml, found.syntax)
  const checked = checkEInvoice(inv)
  if ('refused' in checked) return { kind: 'refused', reason: checked.refused }
  const { raw, laborGuessed } = toRawExtraction(inv)
  return { kind: 'read', raw, laborGuessed, notes: checked.notes, invoiceNumber: inv.number }
}
