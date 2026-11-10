// Der Kasten mit dem Zahlungs-QR-Code (#624): links der Code, rechts klein, was er enthält. Gezeichnet als SVG, damit der
// Druck scharf bleibt; Fehlerkorrektur M und Byte-Modus ohne ECI nach EPC069-12 (Inhalt aus shared/epcQr.ts).
import { correction, generate, mode, type Bitmap2D } from 'lean-qr'
import { toSvgPath } from 'lean-qr/extras/svg'
import { euro } from '../../../shared/costItem.ts'
import type { PaymentQrData } from '../paymentQr'

// Ohne ECI-Kopf: Zeile 3 des Inhalts erklärt UTF-8 schon, und nur so passen die 331 Byte in Version 13.
export function qrMatrix(payload: string): Bitmap2D {
  return generate(mode.bytes(new TextEncoder().encode(payload)), { minCorrectionLevel: correction.M, maxCorrectionLevel: correction.M, maxVersion: 13 })
}

const QUIET = 4

export default function PaymentQr({ data }: { data: PaymentQrData }) {
  const code = qrMatrix(data.payload)
  const side = code.size + 2 * QUIET
  const amount = euro(data.amountCents)
  return (
    <div className="payment-qr">
      <svg className="payment-qr-code" role="img" aria-label={`QR-Code für die Überweisung von ${amount}`} viewBox={`${-QUIET} ${-QUIET} ${side} ${side}`} shapeRendering="crispEdges">
        <rect x={-QUIET} y={-QUIET} width={side} height={side} fill="#fff" />
        <path d={toSvgPath(code)} fill="#000" />
      </svg>
      <div className="payment-qr-text">
        <div className="payment-qr-hint">Mit Ihrer Banking-App scannen</div>
        <div>{data.name}</div>
        <div>{data.iban}</div>
        <div>{amount}</div>
        {data.purpose !== '' && <div>{data.purpose}</div>}
      </div>
    </div>
  )
}
