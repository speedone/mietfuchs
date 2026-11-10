// Die Rechnungsansicht als eigene Seite unter `?e-rechnung=<Datei>` (#189, PR 3): Dorthin führt jeder Link auf einen
// Beleg, der eine E-Rechnung als XML-Datei ist (`receiptHref`), denn die Datei selbst geht nur als Download hinaus
// (server/src/uploads.ts). Ohne Navigation, wie ein geöffneter Beleg in einem eigenen Tab; gedruckt wird mit dem Browser.
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { EInvoiceView as View } from '../types'
import { eInvoiceDocument } from '../eInvoiceView'
import { EInvoiceView } from './EInvoiceView'
import { NoticeBox } from './Notice'

type Props = { file: string; load?: (file: string) => Promise<View> }

const loadView = (file: string): Promise<View> => api<View>(`/api/e-invoice/${encodeURIComponent(file)}`)

export function EInvoicePage({ file, load = loadView }: Props) {
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    load(file).then((v) => { if (current) setView(v) }, (err: unknown) => { if (current) setError(err instanceof Error ? err.message : String(err)) })
    return () => { current = false }
  }, [file, load])
  const title = view ? eInvoiceDocument(view).title : 'E-Rechnung'
  useEffect(() => { document.title = `${title} · Mietfuchs` }, [title])
  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="m-0">{title}</h1>
          <p className="text-muted m-0">E-Rechnung als XML-Datei, lesbar dargestellt. Maßgeblich ist die Datei selbst.</p>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          <button type="button" className="btn" onClick={() => window.print()} disabled={!view}>🖨 Drucken / PDF</button>
          <a className="btn secondary" href={`/uploads/${encodeURIComponent(file)}`} download>Original (XML) herunterladen</a>
        </div>
      </div>
      {error && <NoticeBox level="error" title="Die E-Rechnung ließ sich nicht laden" action={error} />}
      {!view && !error && <p role="status">Lädt …</p>}
      {view && <EInvoiceView view={view} />}
    </main>
  )
}
