// Ein Beleg für die KI-Auswertung aus der Seite Heizkosten (Heizung PR 20): wie in Kosten und Schnellerfassung
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
