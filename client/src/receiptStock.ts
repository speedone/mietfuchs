// Der Bestand der Seite „Belege“ (#490): alle Belege und die Positionen aller Objekte, einmal geladen für Eingang und
// Ordner. Beide Ansichten zeigen dieselben Daten; was die eine zuordnet, steht in der anderen gleich richtig.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CostItem, Property, UploadEntry } from './types'
import { api } from './api'
import { useProperty, withProperty } from './property'
import { filedUnderSettlement, type PlantPeriods } from './costPeriods'
import { rulesOf } from '../../shared/period.ts'

export type ReceiptStock = {
  uploads: UploadEntry[]
  // Die Positionen, wie der Server sie liefert (geschrieben wird nur mit der Kennung)
  loadedItems: CostItem[]
  // Dieselben mit dem Schlüssel ihrer Abrechnung (E32): Register, Belegabdeckung und Zuordnen ordnen danach
  costItems: CostItem[]
  plantsBy: Map<string, PlantPeriods[]>
  // Ob die Liste einmal geladen ist (für den Sprung zu einem Beleg, #487)
  loadedOnce: boolean
  error: string
  reload: () => Promise<void>
}

export function useReceiptStock(): ReceiptStock {
  const { properties } = useProperty()
  const [uploads, setUploads] = useState<UploadEntry[]>([])
  const [loadedItems, setLoadedItems] = useState<CostItem[]>([])
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [plantsBy, setPlantsBy] = useState<Map<string, PlantPeriods[]>>(new Map())
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    // Die Belege gelten für die ganze Installation (#92). Welche Belege an einer Kostenposition
    // hängen, wird deshalb über alle Objekte gefragt, je Objekt einzeln: Die Routen grenzen immer
    // auf ein Objekt ein, eine zweite Regel „alle“ gibt es dort bewusst nicht.
    // Dazu die Heizanlagen: Eine Heizposition mit eigener Heizperiode gehört in das Jahr, in dem
    // diese endet (E32). Fehlen sie, bleibt jede Position bei ihrem Schlüssel.
    const allItems = () =>
      api<Property[]>('/api/properties')
        .then((list) => Promise.all(list.map((p) => Promise.all([
          api<CostItem[]>(withProperty('/api/costItems', p.id)),
          api<PlantPeriods[]>(withProperty('/api/heating-plants', p.id)).catch(() => []),
        ]).then(([items, plants]) => ({ id: p.id, items, plants })))))
    return Promise.all([api<UploadEntry[]>('/api/uploads'), allItems()])
      .then(([u, c]) => {
        setUploads(u.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)))
        setLoadedItems(c.flatMap((x) => x.items))
        setPlantsBy(new Map(c.map((x) => [x.id, x.plants])))
        setError('')
        setLoadedOnce(true)
      })
      .catch((e) => setError(String((e as Error).message)))
  }, [])

  useEffect(() => { void reload() }, [reload])

  const costItems = useMemo(
    () => filedUnderSettlement(loadedItems, (id) => rulesOf(properties.find((p) => p.id === id)), (id) => plantsBy.get(id) ?? []),
    [loadedItems, properties, plantsBy],
  )
  return { uploads, loadedItems, costItems, plantsBy, loadedOnce, error, reload }
}
