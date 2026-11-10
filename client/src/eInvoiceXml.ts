// Ist ein gespeicherter Beleg eine E-Rechnung als XML-Datei (#189)? Nach Art oder Endung; eine ältere Zeile kann
// `text/xml` tragen, die Endung entscheidet dann. Eigenes Modul, damit tenantFolder.ts und eInvoicePdf.ts es teilen,
// ohne sich gegenseitig zu laden.
export const isXmlReceipt = (file: string, mimeType?: string): boolean => mimeType === 'application/xml' || /\.xml$/i.test(file)
