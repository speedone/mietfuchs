// Logo und Briefpapier als Bild für den Druck (#415, Teil 2b). Browser drucken eine eingebettete PDF nicht mit; wie die
// Belegkopien (pdfPreview.ts) wird die eine Seite mit pdf.js gerendert und als Bild eingesetzt. PNG und JPG zeigt der
// Browser selbst, nachdem feststeht, dass es die Datei gibt: Fehlt sie (Vorversion, Archiv ohne sie, von Hand
// gelöscht), druckt die Seite ohne Gestaltung, statt ein kaputtes Bild ohne Absender zu drucken (Durchsicht M2).
import type { LetterDesignFile } from '../../shared/types.ts'
import { designFileUrl, type DesignSlot } from '../../shared/letterDesign.ts'
import { openPdf, renderPage } from './pdf'
import { svgCanvasSize } from './letterDesignForm'

const cache = new Map<string, Promise<string>>()

export async function designImage(file: LetterDesignFile): Promise<string> {
  const url = designFileUrl(file.file)
  // Ein Bild wird jedes Mal nachgefragt (nur der Kopf der Antwort): Es kann seither fehlen.
  if (file.type !== 'pdf') {
    const res = await fetch(url, { method: 'HEAD' })
    if (!res.ok) throw new Error(`Die Datei fehlt (${res.status}).`)
    return url
  }
  let p = cache.get(file.file)
  if (!p) {
    p = (async () => {
      const { doc, close } = await openPdf({ url })
      try {
        // Faktor 2 (rund 150 dpi bei A4), wie die Belegkopien; PNG, damit feine Linien scharf bleiben.
        return (await renderPage(doc, 1)).toDataURL('image/png')
      } finally {
        close()
      }
    })()
    p.catch(() => cache.delete(file.file))
    cache.set(file.file, p)
  }
  return p
}

// Wie viele Seiten eine gewählte PDF hat, vor dem Hochladen: Als Briefpapier geht nur eine.
export async function pdfPageCount(data: ArrayBuffer): Promise<number> {
  const { doc, close } = await openPdf({ data })
  try {
    return doc.numPages
  } finally {
    close()
  }
}

// Ein gewähltes SVG als PNG (Durchsicht S1): Der Server nimmt kein SVG an. Gezeichnet wird über ein `<img>`, darin
// laufen keine Skripte und es lädt nichts nach; das Ergebnis ist ein Bild mit 300 dpi in der Größe, die es im Druck
// einnimmt (`svgCanvasSize`). Ein Briefpapier bekommt einen weißen Grund.
export async function svgToPng(file: Blob, slot: DesignSlot): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const { width, height } = svgCanvasSize(slot, img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('kein Zeichenbereich')
    if (slot === 'paper') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(img, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('kein Bild'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}
