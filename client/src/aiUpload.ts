// Ein Beleg für die KI-Auswertung aus der Seite Heizkosten (Heizung PR 20): wie in Kosten und im Eingang der Seite Belege
// mit der Größe der Seitenbilder aus den Einstellungen (#35) und mit Objekt und Jahr, damit der Beleg im
// Posteingang dort liegt, bis er an eine Position kommt.
import { api } from './api'
import { buildUpload } from './pdfIntake'

// Ohne Objekt (`null`) liegt der Beleg im Posteingang ohne Zuordnung.
export async function heatingUpload(file: File, placement: { propertyId: string; year: number } | null): Promise<FormData> {
  const edge = await api<{ ai?: { pageImageEdge?: number | null } }>('/api/settings')
    .then((s) => s.ai?.pageImageEdge ?? undefined)
    .catch(() => undefined)
  const fd = await buildUpload(file, undefined, edge)
  if (placement) {
    fd.append('propertyId', placement.propertyId)
    fd.append('year', String(placement.year))
  }
  return fd
}

// Erst speichern, dann auswerten (#690, wie seit #674 im Eingang der Belege): Die Datei geht über /api/upload in den
// Ordner, mit Objekt und Jahr, und die Auswertung nennt danach nur ihren Namen (`asStored`). Hängt die KI, wird
// abgebrochen oder der Tab geschlossen, geht nur die Auswertung verloren; der Beleg steht unter „Ohne Position“.
export async function storeReceipt(file: File, placement: { propertyId: string; year: number } | null, signal?: AbortSignal): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  if (placement) {
    fd.append('propertyId', placement.propertyId)
    fd.append('year', String(placement.year))
  }
  const res = await api<{ file: string }>('/api/upload', { method: 'POST', body: fd, signal })
  if (typeof res.file !== 'string' || res.file === '') throw new Error('Mietfuchs hat den Beleg nicht bestätigt.')
  return res.file
}

// Der Satz, wenn ein gespeicherter Beleg nicht ausgewertet ist und der Server keinen Grund genannt hat (abgebrochen,
// Verbindung weg). Mit Grund steht `KeptReceipt` da.
export const STORED_NOT_EVALUATED = 'Ihr Beleg ist gespeichert und steht auf der Seite Belege unter „Ohne Position“. Ausgewertet ist er nicht.'

// Die Auswertung eines Belegs, der schon gespeichert ist (#487, seit #690 jede): Der Browser liest die
// Datei wie beim ersten Mal (Text, Seitenbilder), an den Server geht statt ihrer nur ihr Name.
export function asStored(fd: FormData, stored: string): FormData {
  fd.delete('file')
  fd.append('existingFile', stored)
  return fd
}
