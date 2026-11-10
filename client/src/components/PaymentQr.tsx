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

// Ruhezone: ein Zehntel der Kante (ein Achtel der Module auf jeder Seite), mindestens die vier Module der Norm. Weil der
// Anteil fest ist, schiebt letter.css sie mit einem festen Maß in den Rand, und der Code steht bündig mit dem Text.
// Ein Zahlungs-Code hat mindestens Version 4 (33 Module), dann sind es immer genau 10 %.
const quietOf = (size: number): number => Math.max(4, size / 8)

export default function PaymentQr({ data }: { data: PaymentQrData }) {
  const code = qrMatrix(data.payload)
  const quiet = quietOf(code.size)
  const side = code.size + 2 * quiet
  const amount = euro(data.amountCents)
  return (
    <div className="payment-qr">
      <svg className="payment-qr-code" role="img" aria-label={`QR-Code für die Überweisung von ${amount}`} viewBox={`${-quiet} ${-quiet} ${side} ${side}`} shapeRendering="crispEdges">
        <rect x={-quiet} y={-quiet} width={side} height={side} fill="#fff" />
        <path d={toSvgPath(code)} fill="#000" />
      </svg>
      <div className="payment-qr-text">
        <div className="payment-qr-hint">Mit Ihrer Banking-App scannen</div>
        <dl className="payment-qr-facts">
          <dt>Empfänger</dt><dd>{data.name}</dd>
          <dt>IBAN</dt><dd>{data.iban}</dd>
          <dt>Betrag</dt><dd>{amount}</dd>
          {data.purpose !== '' && <><dt>Verwendungszweck</dt><dd>{data.purpose}</dd></>}
        </dl>
      </div>
    </div>
  )
}
