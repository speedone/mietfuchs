import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { CostItem, CostKey, Extraction, ExternalMeasure, Meter, MeterType, Settlement, Settings, Tenancy, Unit } from '../types'
import { CATEGORIES, KEY_LABELS, METER_TYPE_LABELS, isNotAllocable, matchCategory, usageOf } from '../types'
import {
  EMPTY_ITEM_FORM,
  basisUnitsOf,
  buildCostItemBody,
  costKeyOptions,
  customSharesSumText,
  itemToForm,
  meterTypeOptions,
  amountsSumText,
  externalHint,
  externalMismatch,
  tenanciesForAmounts,
  EXTERNAL_MEASURE_OPTIONS,
  PARTICIPANT_KEYS,
  categoryNotice,
  selfAmountUnits,
  aiPositionBody,
  aiPositionDefaults,
  aiPositionPreselect,
  aiPositionProblem,
  keyChangeNotice,
  newItemForm,
  externalTotalLabel,
  keyListText,
  showsKeyFields,
  withKey,
  withCategory,
  type AiPosition,
  type ItemForm,
  type KeyContext,
} from '../costForm'
import { alreadyCarried, carryKeyDetails, carryOverBody, carryOverForm, carryOverRows, withCarryAmount, type CarryRow } from '../carryOver'
import AiKeyCell from '../components/AiKeyCell'
import { api, errorText, fmtDate, fmtEuro, parseEuro } from '../api'
import { aiRequest, type AiProgress } from '../aiRequest'
import { aiSummary } from '../aiForm'
import { buildUpload } from '../pdfIntake'
import { useYear } from '../year'
import { useOpenForm, useProperty, useSwitchYear, withProperty } from '../property'
import Drawer from '../components/Drawer'
import PageHeader from '../components/PageHeader'
import Term from '../components/Term'
import { AiProgressBadge } from '../components/AiProgress'
import { useToast, useConfirm } from '../components/feedback'
import Table from '../components/Table'
import DuplicateNotices from '../components/DuplicateNotices'
import { aiRowPreselected, candidateText, duplicateCandidates, duplicateGroups, type DuplicateGroup, type LinkOffer } from '../triage'
import { sameCostCandidates } from '../../../shared/duplicates.ts'
import { useFocusTarget, type FocusProps } from '../focus'

// `tenancies` für die Einzelbeträge je Mietverhältnis (#94); ohne sie gibt es dort nur keine Felder.
type Props = { units: Unit[]; settings: Settings | null; tenancies?: Tenancy[] } & FocusProps

// Eine ausgewertete Position samt Schlüssel, gegebenenfalls dem gemerkten aus dem Vorjahr (#141).
// `linked`: mit einer bestehenden Position verknüpft statt neu angelegt (deren Beschreibung)
// `created`: als neue Position angelegt; erledigt wie `linked` (dritte Durchsicht)
type ExtractPos = AiPosition & { checked: boolean; linked?: string; created?: boolean }

// Maßeinheit der Summe der Anteile, für die Vorlagenliste (#141)
const EXTERNAL_UNIT_LABELS: Record<ExternalMeasure, string> = { mea: 'MEA', area: 'm²', units: 'Einheiten' }

// Ein Eintrag der Upload-Warteschlange: Dateien werden nacheinander durch die KI geschickt
// (ein lokales Modell verarbeitet ohnehin nur eine Anfrage sinnvoll gleichzeitig).
type QueueEntry = {
  id: number
  fileName: string
  status: 'wartend' | 'läuft' | 'fertig' | 'fehler' | 'abgebrochen' | 'übernommen'
  error?: string
  vendor?: string
  serverFile?: string
  // Was der Server gerechnet hat (#34)
  amountsAdjusted?: Extraction['amountsAdjusted']
  laborFromTotal?: boolean
  positions: ExtractPos[]
  // Aus diesem Beleg angelegte Positionen: Sie sind keine Doppelung der übrigen Zeilen.
  createdIds?: string[]
  // während der Auswertung: was das Modell gerade tut und seit wann
  progress?: AiProgress | null
  startedAt?: number
}


export default function Kosten({ units, settings, tenancies = [], focus, onFocusDone }: Props) {
  // Wohin die Belege zur Auswertung gehen (siehe aiForm.ts)
  const ai = aiSummary(settings)
  const { year } = useYear()
  // Fragt bei offenem Formular nach, wie der Objektwechsel (Durchsicht).
  const switchYear = useSwitchYear()
  const { property } = useProperty()
  const propertyId = property?.id
  const toast = useToast()
  const confirm = useConfirm()
  const [items, setItems] = useState<CostItem[]>([])
  const [meters, setMeters] = useState<Meter[]>([])
  const [form, setForm] = useState<ItemForm | null>(null)
  const [error, setError] = useState('')

  // KI-Auswertung: Warteschlange für einen oder mehrere Belege
  const [queue, setQueue] = useState<QueueEntry[]>([])
  // „Aus dem Vorjahr übernehmen“ (#141): die Vorlagen, solange die Liste offen ist. Eingetragene
  // Beträge gehen beim Verlassen verloren, deshalb zählt die Liste als offenes Formular.
  const [carry, setCarry] = useState<CarryRow[] | null>(null)
  useOpenForm(carry?.some((r) => r.amount.trim() !== '') ?? false)
  // Ausgewertete, noch nicht übernommene Belege gehören zum Objekt, in dem sie hochgeladen wurden;
  // ein Zählerstand hängt an einem seiner Zähler (#145).
  useOpenForm(queue.some((x) => x.status === 'wartend' || x.status === 'läuft' || x.status === 'fertig'))
  const [dragOver, setDragOver] = useState(false)
  const filesRef = useRef(new Map<number, File>())
  const nextIdRef = useRef(1)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Abbruch je laufender Auswertung; der Server stoppt dann auch das Modell
  const abortRef = useRef(new Map<number, AbortController>())

  // Der zuletzt geladene Stand und das Laden selbst, für die KI-Auswertung: Sie entscheidet beim
  // Eintreffen, ob eine Zeile vorab angehakt ist, und muss dafür wissen, was schon erfasst ist.
  const itemsRef = useRef<CostItem[]>([])
  const loadingRef = useRef<Promise<unknown> | null>(null)
  const [linking, setLinking] = useState(false)
  const load = () => {
    const loading = api<CostItem[]>(withProperty('/api/costItems', propertyId)).then((list) => { itemsRef.current = list; setItems(list) })
    loadingRef.current = loading
    return loading
  }
  useEffect(() => {
    load().catch(() => setError('Server nicht erreichbar — läuft `npm run dev`?'))
    api<Meter[]>(withProperty('/api/meters', propertyId)).then(setMeters).catch(() => {})
    // Neu laden, wenn das Objekt wechselt (#92).
  }, [propertyId])
  // Ist die Abrechnung des Jahres für dieses Objekt abgeschlossen (#142)? Dann ändert eine
  // Kostenposition sie nicht mehr; die Seite sagt das, statt still weiter erfassen zu lassen.
  const [closedAt, setClosedAt] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setClosedAt(null)
    api<Pick<Settlement, 'closed'>>(withProperty(`/api/settlement/${year}`, propertyId))
      .then((s) => { if (alive) setClosedAt(s.closed?.closedAt ?? null) })
      .catch(() => {})
    return () => { alive = false }
  }, [year, propertyId])
  // „Hier beheben →“ aus der Abrechnung (#142): die betroffene Position zum Bearbeiten öffnen.
  useFocusTarget(focus, 'costItem', items, (i) => i.id, (i) => { setError(''); setForm(itemToForm(i)) }, onFocusDone)
  // Wer die Seite verlässt, wartet nicht mehr auf die Auswertung
  useEffect(() => () => { for (const controller of abortRef.current.values()) controller.abort() }, [])

  // Verbrauchsschlüssel ist nur sinnvoll, wenn Wohnungszähler existieren
  const unitMeterTypes = useMemo(() => [...new Set(meters.filter((m) => m.unitId).map((m) => m.type))], [meters])
  // Wohnungen der Abrechnungseinheit — nur sie können einen vereinbarten Anteil tragen
  const basisUnits = useMemo(() => basisUnitsOf(units), [units])
  // Live-Summe der Anteile, damit der Vermieter-Rest schon bei der Eingabe sichtbar ist
  const sumText = form ? customSharesSumText(form, units) : ''

  // Bereits hochgeladene Belege (für die nachträgliche Zuordnung zu einer Position)
  const knownFiles = useMemo(() => {
    const m = new Map<string, string>()
    for (const it of items) if (it.invoiceFile && !m.has(it.invoiceFile)) m.set(it.invoiceFile, it.vendor || it.category)
    return [...m.entries()]
  }, [items])

  async function uploadInvoice(f: File) {
    const fd = new FormData()
    fd.append('file', f)
    // Wird die Position nicht gespeichert, steht der Beleg im Posteingang dieses Objekts und
    // Jahres (#170) statt ohne Zuordnung.
    if (property?.id) fd.append('propertyId', property.id)
    fd.append('year', String(year))
    try {
      const res = await api<{ file: string }>('/api/upload', { method: 'POST', body: fd })
      setForm((prev) => (prev ? { ...prev, invoiceFile: res.file } : prev))
    } catch (e) {
      setError(`Der Beleg wurde nicht hochgeladen: ${errorText(e)}`)
    }
  }

  const yearItems = useMemo(() => items.filter((i) => i.year === year), [items, year])
  // Woraus eine neue Position ihren Schlüssel vorgeschlagen bekommt (#141): die Positionen des
  // Objekts, das Jahr und die Art des Objekts.
  const keyCtx: KeyContext = useMemo(() => ({ items, year, propertyKind: property?.kind ?? null }), [items, year, property?.kind])
  const totalCents = yearItems.reduce((a, i) => a + i.amountCents, 0)

  // Nach Beleg (Rechnung) gruppiert — alle Positionen eines Belegs stehen zusammen, mit
  // Zwischensumme = Belegsumme. So lassen sich die einzelnen Beträge und die Summe direkt
  // mit der Rechnung abgleichen (z. B. Wasser, Abwasser, Kanal- und Niederschlagsbeitrag
  // eines Versorgers). Manuell erfasste Positionen ohne Beleg stehen einzeln am Ende.
  type CostGroup = { key: string; label: string; invoiceFile?: string; items: CostItem[] }
  const grouped = useMemo(() => {
    const withInvoice: CostGroup[] = []
    const withoutInvoice: CostGroup[] = []
    for (const it of yearItems) {
      if (it.invoiceFile) {
        const g = withInvoice.find((x) => x.invoiceFile === it.invoiceFile)
        if (g) { g.items.push(it); if (!g.label && it.vendor) g.label = it.vendor }
        else withInvoice.push({ key: `f:${it.invoiceFile}`, label: it.vendor || '', invoiceFile: it.invoiceFile, items: [it] })
      } else {
        withoutInvoice.push({ key: `i:${it.id}`, label: it.vendor || it.category, items: [it] })
      }
    }
    // Fallback-Beschriftung, falls kein Rechnungssteller hinterlegt ist
    for (const g of withInvoice) if (!g.label) g.label = g.items.map((i) => i.category).find(Boolean) || 'Beleg'
    return [...withInvoice, ...withoutInvoice]
  }, [yearItems])

  // Die Vorlagen gehören zum gewählten Jahr und Objekt; wechselt eines davon, schließt die Liste.
  useEffect(() => { setCarry(null) }, [year, propertyId])
  const previousCount = useMemo(() => items.filter((i) => i.year === year - 1).length, [items, year])

  function updateCarry(index: number, patch: Partial<CarryRow>) {
    setCarry((rows) => rows && rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  // Erst alle angehakten Zeilen prüfen, dann anlegen (#139): Eine Zeile ohne Betrag wird genannt,
  // statt still zu fehlen. Angelegte Zeilen verschwinden aus der Liste; scheitert eine, bleibt der
  // Rest stehen, damit ein zweiter Versuch nichts doppelt anlegt.
  // Gesperrt, solange ein Durchgang läuft (Durchsicht): Ein Doppelklick legte sonst alles zweimal
  // an, denn der zweite Klick kommt, bevor die Liste neu gezeichnet ist. Deshalb ein Ref und nicht
  // nur der gesperrte Knopf.
  const carryBusy = useRef(false)
  const [carrySaving, setCarrySaving] = useState(false)
  async function adoptCarry() {
    if (!carry || carryBusy.current) return
    carryBusy.current = true
    setCarrySaving(true)
    try {
      await adoptCarryRows(carry)
    } finally {
      carryBusy.current = false
      setCarrySaving(false)
    }
  }
  async function adoptCarryRows(rows: CarryRow[]) {
    const chosen = rows.filter((row) => row.checked)
    const blocked = chosen.flatMap((row) => {
      const built = carryOverBody(row, units, year, tenancies)
      return 'error' in built ? [`„${row.description}“: ${built.error}`] : []
    })
    if (blocked.length > 0) {
      setError(`Nicht übernommen: ${blocked.join(' ')}`)
      return
    }
    // Schon im Jahr erfasst und trotzdem angehakt: ausdrücklich nachfragen (Durchsicht), sonst
    // stünde dieselbe Rechnung zweimal in der Abrechnung.
    const twice = chosen.filter((row) => alreadyCarried(items, row, year))
    if (twice.length > 0) {
      const ok = await confirm({
        title: 'Schon erfasst',
        message: `${twice.map((r) => `„${r.description}“`).join(', ')} ${twice.length === 1 ? 'ist' : 'sind'} für ${year} schon erfasst. Legen Sie ${twice.length === 1 ? 'die Position' : 'die Positionen'} trotzdem noch einmal an, wird dieselbe Rechnung zweimal verteilt.`,
        confirmLabel: 'Trotzdem anlegen',
        cancelLabel: 'Abbrechen',
      })
      if (!ok) return
    }
    setError('')
    const done = new Set<string>()
    for (const row of chosen) {
      const built = carryOverBody(row, units, year, tenancies)
      if ('error' in built) continue
      try {
        await api(withProperty('/api/costItems', propertyId), { method: 'POST', body: JSON.stringify(built.body) })
        done.add(row.source.id)
      } catch (e) {
        setError(`„${row.description}“ wurde nicht übernommen: ${errorText(e)}`)
        break
      }
    }
    removeCarried(done)
    await load()
    if (done.size > 0) toast(`${done.size} ${done.size === 1 ? 'Position' : 'Positionen'} aus ${year - 1} für ${year} angelegt.`)
  }
  // Angelegte Zeilen verschwinden aus der Liste, gleich auf welchem Weg (Knopf oder Formular).
  function removeCarried(ids: Set<string>) {
    if (ids.size === 0) return
    setCarry((rows) => {
      if (!rows) return rows
      const rest = rows.filter((r) => !ids.has(r.source.id))
      return rest.length > 0 ? rest : null
    })
  }
  // Die Zeile, aus der das offene Formular stammt („Im Formular öffnen“): Nach dem Speichern
  // verschwindet sie aus der Liste, sonst legte der Knopf sie ein zweites Mal an (Durchsicht).
  const [formCarryId, setFormCarryId] = useState<string | null>(null)
  useEffect(() => { if (!form) setFormCarryId(null) }, [form])

  async function saveItem() {
    if (!form) return
    const built = buildCostItemBody(form, units, year, tenancies)
    if ('error' in built) {
      setError(built.error)
      return
    }
    setError('')
    const body = JSON.stringify(built.body)
    const editing = !!form.id
    // Eine neue Position, für die dieselbe Rechnung schon erfasst sein könnte (shared/duplicates.ts):
    // nachfragen, wie in der Schnellerfassung. Nur beim Neuanlegen; wer bearbeitet, meint diese.
    if (!editing) {
      const same = sameCostCandidates(items, { propertyId, year, category: form.category, description: form.description, vendor: form.vendor })
      const first = same[0]
      if (first) {
        let instead = false
        const ok = await confirm({
          title: 'Dieselbe Rechnung?',
          message: `Für ${year} ist ${same.map(candidateText).join(', ')} schon erfasst. Ist das dieselbe Rechnung? Dann bearbeiten Sie besser die vorhandene Position, sonst wird sie zweimal verteilt.`,
          confirmLabel: 'Trotzdem anlegen',
          alternativeLabel: `Stattdessen „${first.description}“ bearbeiten`,
          onAlternative: () => { instead = true },
          cancelLabel: 'Abbrechen',
        })
        if (instead) { setForm(itemToForm(first)); return }
        if (!ok) return
      }
    }
    // Lehnt der Server ab (#146), bleibt der Dialog offen und zeigt seinen Satz.
    try {
      if (editing) await api(`/api/costItems/${form.id}`, { method: 'PUT', body })
      else await api(withProperty('/api/costItems', propertyId), { method: 'POST', body })
    } catch (e) {
      setError(errorText(e))
      return
    }
    const desc = form.description.trim()
    if (!editing && formCarryId) removeCarried(new Set([formCarryId]))
    setForm(null)
    await load()
    toast(editing ? `„${desc}" übernommen.` : `„${desc}" hinzugefügt.`)
  }

  async function deleteItem(i: CostItem) {
    const ok = await confirm({
      title: `Kostenposition löschen?`,
      message: `„${i.description}" (${fmtEuro(i.amountCents)}) wird gelöscht.`,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/costItems/${i.id}`, { method: 'DELETE' })
    } catch (e) {
      setError(errorText(e))
      return
    }
    setError('')
    await load()
    toast(`„${i.description}" gelöscht.`)
  }

  function addFiles(files: Iterable<File>) {
    const entries: QueueEntry[] = []
    for (const f of files) {
      if (!/^(application\/pdf|image\/)/.test(f.type)) continue
      const id = nextIdRef.current++
      filesRef.current.set(id, f)
      entries.push({ id, fileName: f.name, status: 'wartend', positions: [] })
    }
    if (entries.length) setQueue((q) => [...q, ...entries])
  }

  function patchEntry(id: number, patch: Partial<QueueEntry>) {
    setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }

  // Sequenzielle Abarbeitung: sobald nichts läuft, den nächsten wartenden Beleg starten
  useEffect(() => {
    if (queue.some((x) => x.status === 'läuft')) return
    const next = queue.find((x) => x.status === 'wartend')
    if (!next) return
    const controller = new AbortController()
    abortRef.current.set(next.id, controller)
    patchEntry(next.id, { status: 'läuft', startedAt: Date.now(), progress: null })
    void (async () => {
      try {
        // PDFs liest der Browser selbst und schickt Text oder Seitenbilder mit (pdfIntake.ts)
        const fd = await buildUpload(filesRef.current.get(next.id)!, undefined, settings?.ai?.pageImageEdge ?? undefined)
        // Bleibt der Beleg ungebucht, steht er im Posteingang dieses Objekts; nennt er kein Jahr,
        // gilt das gewählte (#170).
        if (propertyId) fd.append('propertyId', propertyId)
        fd.append('year', String(year))
        const res = await aiRequest<{ file: string; extraction: Extraction }>('/api/extract', fd, {
          signal: controller.signal,
          onProgress: (progress) => patchEntry(next.id, { progress }),
        })
        const ex = res.extraction
        await loadingRef.current?.catch(() => {})
        const known = itemsRef.current
        const ctx: KeyContext = { items: known, year, propertyKind: property?.kind ?? null }
        const vendor = ex.vendor || next.fileName
        const positions = (ex.positions || []).map((p) => {
          // KI-Kategorie auf die bekannten Betriebskostenarten abbilden — notfalls
          // über die Beschreibung (z. B. wenn das Modell eine eigene Kategorie erfindet)
          let category = matchCategory(p.category || '')
          if (category === 'Sonstige Betriebskosten') {
            const byDesc = matchCategory(p.description || '')
            if (byDesc !== 'Sonstige Betriebskosten') category = byDesc
          }
          // Ohne Betrag bleibt das Feld leer, damit es sich ausfüllen lässt: Das Modell muss
          // ihn nicht gelesen haben (siehe toExtraction in server/src/extract.ts). Ohne Betrag
          // ist die Position auch nicht vorgewählt, ebenso bei 0 € (#139).
          const amount = p.amountEur?.toLocaleString('de-DE', { minimumFractionDigits: 2 }) ?? ''
          const labor35a = p.labor35aEur ? p.labor35aEur.toLocaleString('de-DE', { minimumFractionDigits: 2 }) : ''
          return {
            description: p.description,
            category,
            amount,
            labor35a,
            externalTotalAmount: '',
            ...aiPositionDefaults(category, units, meters, ctx, p.description),
          }
          // Könnte dieselbe Rechnung schon erfasst sein, etwa aus dem Vorjahr übernommen
          // (shared/duplicates.ts)? Dann nicht vorab angehakt; die Zeile darunter bietet an, den
          // Beleg mit der Position zu verknüpfen.
        }).map((p) => ({
          ...p,
          checked: aiRowPreselected({
            category: p.category, preselect: aiPositionPreselect(p), problem: aiPositionProblem(p, units, year), level: 'gruen',
            candidates: duplicateCandidates(known, { category: p.category, description: p.description, vendor, year }),
          }),
        }))
        patchEntry(next.id, { status: 'fertig', vendor, serverFile: res.file, positions, amountsAdjusted: ex.amountsAdjusted, laborFromTotal: ex.laborFromTotal })
      } catch (e) {
        // Selbst abgebrochen ist kein Fehler
        if (controller.signal.aborted) patchEntry(next.id, { status: 'abgebrochen' })
        else patchEntry(next.id, { status: 'fehler', error: String((e as Error).message) })
      } finally {
        filesRef.current.delete(next.id)
        abortRef.current.delete(next.id)
      }
    })()
  }, [queue])

  async function adoptPositions(entry: QueueEntry) {
    // Erst prüfen, dann übernehmen (#139), mit derselben Regel wie das Formular: Eine Gutschrift
    // geht durch, eine angehakte Position mit 0 € oder ohne Betrag wird genannt statt still
    // ausgelassen.
    const blocked = entry.positions.filter((p) => p.checked && aiPositionProblem(p, units, year) !== null)
    if (blocked.length > 0) {
      setError(`Nicht übernommen: ${blocked.map((p) => `„${p.description}“: ${aiPositionProblem(p, units, year)}`).join(' ')}`)
      return
    }
    // Angehakt, obwohl dieselbe Rechnung schon erfasst sein könnte: ausdrücklich nachfragen.
    const twice = entry.positions.filter((p) => p.checked && candidatesOf(entry, p).length > 0)
    if (twice.length > 0) {
      const ok = await confirm({
        title: 'Schon erfasst?',
        message: `Für ${year} steht schon eine Position derselben Kostenart wie ${twice.map((p) => `„${p.description}“`).join(', ')}. Ist es dieselbe Rechnung, verknüpfen Sie den Beleg besser mit ihr, sonst wird sie zweimal verteilt. Ist es eine zweite Rechnung, legen Sie sie als neue Position an.`,
        confirmLabel: 'Trotzdem anlegen',
        cancelLabel: 'Abbrechen',
      })
      if (!ok) return
    }
    setError('')
    const done: { index: number; id: string }[] = []
    // Angelegte Zeilen sind erledigt, nicht nur abgehakt: Sonst fänden sie nach dem Neuladen ihre
    // eigene Position am selben Beleg und böten „um ihren Betrag erhöhen“ an.
    const markCreated = () => setQueue((q) => q.map((x) => (x.id !== entry.id ? x : {
      ...x,
      positions: x.positions.map((y, i) => (done.some((d) => d.index === i) ? { ...y, checked: false, created: true } : y)),
      createdIds: [...(x.createdIds ?? []), ...done.map((d) => d.id).filter(Boolean)],
    })))
    for (const [index, p] of entry.positions.entries()) {
      if (!p.checked) continue
      // Über dieselbe Prüfung wie das Formular (#141), samt gemerktem Schlüssel; nicht umlagefähig
      // ergibt dort die neutrale Vorgabe (#142).
      const built = aiPositionBody(p, { vendor: entry.vendor, invoiceFile: entry.serverFile }, units, year)
      if ('error' in built) continue
      try {
        const created = await api<{ id?: string } | null>(withProperty('/api/costItems', propertyId), { method: 'POST', body: JSON.stringify(built.body) })
        done.push({ index, id: created?.id ?? '' })
      } catch (e) {
        // Was bis hierher übernommen ist, steht in der Liste und gilt als erledigt, damit ein
        // zweiter Versuch es nicht doppelt anlegt; der Beleg gilt noch nicht als übernommen.
        markCreated()
        setError(`„${p.description}“ wurde nicht übernommen: ${errorText(e)}`)
        await load()
        return
      }
    }
    markCreated()
    patchEntry(entry.id, { status: 'übernommen' })
    await load()
  }

  const itemsFor = (entry: QueueEntry): CostItem[] =>
    entry.createdIds?.length ? items.filter((i) => !entry.createdIds?.includes(i.id)) : items
  const candidatesOf = (entry: QueueEntry, p: ExtractPos): CostItem[] =>
    p.linked || p.created ? [] : duplicateCandidates(itemsFor(entry), { category: p.category, description: p.description, vendor: entry.vendor ?? '', year })

  const groupsOf = (entry: QueueEntry): DuplicateGroup[] =>
    duplicateGroups(entry.positions, { items, vendor: entry.vendor ?? '', year, invoiceFile: entry.serverFile, ownIds: entry.createdIds })

  // Den Beleg mit einer bestehenden Position verknüpfen, statt eine zweite anzulegen, für alle
  // Zeilen der Gruppe zugleich (duplicateGroups in triage.ts). Gesperrt bis nach dem Neuladen.
  async function linkGroup(entry: QueueEntry, group: DuplicateGroup, offer: LinkOffer) {
    if ('error' in offer.built) { setError(`Nicht verknüpft: ${offer.built.error}`); return }
    setError('')
    setLinking(true)
    try {
      await api(`/api/costItems/${offer.target.id}`, { method: 'PUT', body: JSON.stringify(offer.built.body) })
      // Auf dem aktuellen Stand, nicht auf dem beim Klick: Eingaben während der Anfrage bleiben.
      setQueue((q) => q.map((x) => {
        if (x.id !== entry.id) return x
        const positions = x.positions.map((y, i) => (group.rows.includes(i) ? { ...y, linked: offer.target.description, checked: false } : y))
        return { ...x, positions, ...(positions.every((y) => y.linked || y.created) ? { status: 'übernommen' as const } : {}) }
      }))
      await load()
      toast(`„${offer.target.description}“ mit dem Beleg verknüpft.`)
    } catch (e) {
      setError(`Nicht verknüpft: ${errorText(e)}`)
    } finally {
      setLinking(false)
    }
  }

  function updatePos(entryId: number, idx: number, patch: Partial<ExtractPos>) {
    setQueue((q) =>
      q.map((x) => (x.id === entryId ? { ...x, positions: x.positions.map((p, i) => (i === idx ? { ...p, ...patch } : p)) } : x)),
    )
  }

  return (
    <>
      <PageHeader
        title="Kosten & Belege"
        subtitle="Alle Rechnungen des Abrechnungsjahres erfassen — manuell oder per KI-Belegauswertung."
        actions={<button className="btn" onClick={() => { setError(''); setForm(newItemForm(units, meters, keyCtx)) }}>+ Kostenposition</button>}
      />
      {error && !form && <div className="error">{error}</div>}
      {closedAt && (
        <div className="notice">
          Die Abrechnung {year} ist abgeschlossen (am {fmtDate(closedAt.slice(0, 10))}). Änderungen an den Kosten
          ändern die eingefrorene Abrechnung nicht; die Abrechnungsseite zeigt sie als Abweichung zur heutigen
          Berechnung. Bearbeiten bleibt möglich.
        </div>
      )}

      <div className="card no-print">
        <div className="row">
          <label className="field">
            Abrechnungsjahr
            <select value={year} onChange={(e) => void switchYear(Number(e.target.value))}>
              {Array.from({ length: 8 }, (_, k) => new Date().getFullYear() - k).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          {previousCount > 0 && !carry && (
            <button className="btn secondary" onClick={() => { setError(''); setCarry(carryOverRows(items, year)) }}>
              Aus {year - 1} übernehmen …
            </button>
          )}
          <div className="grow" />
          <div>
            <div className="muted">Erfasste Kosten {year}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtEuro(totalCents)}</div>
          </div>
        </div>
      </div>


      {carry && (
        <div className="card no-print">
          <h2>Positionen aus {year - 1} für {year} übernehmen</h2>
          <p className="muted">
            Übernommen werden Kostenart, Beschreibung, Rechnungssteller und der Umlageschlüssel samt
            Angaben. Tragen Sie je Zeile den Betrag {year} ein; eine Zeile mit Betrag ist angehakt.
            Angelegt wird erst mit dem Knopf unten, ohne Beleg.
          </p>
          <Table>
            <thead>
              <tr>
                <th><span className="sr-only">Übernehmen</span></th>
                <th>Kostenart</th>
                {/* Betrag gleich hinter der Kostenart: Auf dem Handy scrollt die Tabelle waagerecht
                    (Table.tsx), und das Feld, das man ausfüllen muss, soll ohne Wischen dastehen. */}
                <th className="num">Betrag {year} €</th>
                <th className="num">§35a Lohn €</th>
                <th>Beschreibung</th>
                <th>Umlageschlüssel</th>
                <th><span className="sr-only">Formular</span></th>
              </tr>
            </thead>
            <tbody>
              {carry.map((r, i) => (
                <tr key={r.source.id}>
                  <td>
                    <input type="checkbox" aria-label={`${r.description} übernehmen`} checked={r.checked} disabled={!r.inline}
                      onChange={(e) => updateCarry(i, { checked: e.target.checked })} />
                  </td>
                  <td>
                    {r.source.category}
                    {alreadyCarried(items, r, year) && <div><span className="badge gray">schon für {year} erfasst</span></div>}
                  </td>
                  <td className="num">
                    {r.inline && (
                      <input aria-label={`Betrag ${year} für ${r.description}`} value={r.amount} onChange={(e) => updateCarry(i, withCarryAmount(r, e.target.value, alreadyCarried(items, r, year)))}
                        placeholder="—" inputMode="decimal" style={{ width: 100, textAlign: 'right' }} />
                    )}
                    {r.checked && !r.amount.trim() && <div><span className="badge red">Betrag fehlt</span></div>}
                    <div className="muted">{year - 1}: {fmtEuro(r.source.amountCents)}</div>
                  </td>
                  <td className="num">
                    {r.inline && <input aria-label={`§35a-Lohn ${year} für ${r.description}`} value={r.labor35a} onChange={(e) => updateCarry(i, { labor35a: e.target.value })} placeholder="—" inputMode="decimal" style={{ width: 90, textAlign: 'right' }} />}
                  </td>
                  <td><input aria-label="Beschreibung" value={r.description} onChange={(e) => updateCarry(i, { description: e.target.value })} style={{ width: '100%', minWidth: 200 }} /></td>
                  <td>
                    {keyListText(r.source)}
                    {showsKeyFields(r.source.category) && r.source.participantUnitIds && (
                      <div className="muted">nur {r.source.participantUnitIds.map((id) => units.find((u) => u.id === id)?.name ?? '?').join(', ')}</div>
                    )}
                    {showsKeyFields(r.source.category) && r.source.key === 'meter' && r.source.meterType && <div className="muted">{METER_TYPE_LABELS[r.source.meterType]}</div>}
                    {/* Durchsicht: Anteile samt Summe, Wohnung der Direktzuordnung */}
                    {showsKeyFields(r.source.category) && (() => {
                      const d = carryKeyDetails(r.source, units)
                      return d && <div className={d.warn ? '' : 'muted'}>{d.warn ? <span className="badge red">{d.text}</span> : d.text}</div>
                    })()}
                    {showsKeyFields(r.source.category) && r.source.key === 'external' && r.source.externalBasis && (
                      <div className="muted">
                        {r.source.externalBasis.total.toLocaleString('de-DE', { maximumFractionDigits: 6 })} {EXTERNAL_UNIT_LABELS[r.source.externalBasis.measure]} in der Anlage; Kosten der Gemeinschaft {year} €:
                      </div>
                    )}
                    {showsKeyFields(r.source.category) && r.source.key === 'external' && r.source.externalBasis && (
                      <input
                        aria-label={`Kosten der Gemeinschaft ${year} für ${r.description}`}
                        value={r.externalTotalAmount}
                        onChange={(e) => updateCarry(i, { externalTotalAmount: e.target.value })}
                        placeholder="Kosten der Gemeinschaft €"
                        inputMode="decimal"
                        style={{ width: 170, marginTop: 4 }}
                      />
                    )}
                    {!r.inline && <div className="muted">Einzelbeträge je Mieter bitte im Formular eintragen.</div>}
                  </td>
                  <td>
                    <button className="btn small ghost" onClick={() => { setError(''); setForm(carryOverForm(r)); setFormCarryId(r.source.id) }}>Im Formular öffnen</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => void adoptCarry()} disabled={carrySaving || carry.every((r) => !r.checked)}>
              {carry.filter((r) => r.checked).length} {carry.filter((r) => r.checked).length === 1 ? 'Position' : 'Positionen'} für {year} anlegen
            </button>
            <button className="btn ghost" onClick={() => setCarry(null)}>Schließen</button>
          </div>
        </div>
      )}

      <div className="card no-print">
        <h2>🤖 Beleg per KI auswerten <span className="badge gray">{ai.where}</span></h2>
        <p className="muted">
          PDF oder Foto der Rechnung hochladen — das Modell ({ai.model}) schlägt Kostenpositionen
          vor, Sie prüfen und übernehmen sie. {ai.notice ?? 'Es verlässt nichts Ihren Rechner.'}
        </p>
        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
        >
          <strong>Belege hierher ziehen</strong> oder klicken zum Auswählen — auch mehrere auf einmal.
          <div className="muted">Sie werden nacheinander verarbeitet (PDF oder Foto).</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
          />
        </div>

        {queue.map((entry) => (
          <div key={entry.id} style={{ marginTop: 14 }}>
            <div className="row" style={{ alignItems: 'center' }}>
              <strong>{entry.fileName}</strong>
              {entry.status === 'wartend' && <span className="badge gray">wartet …</span>}
              {entry.status === 'läuft' && (
                <AiProgressBadge
                  progress={entry.progress ?? null}
                  startedAt={entry.startedAt ?? Date.now()}
                  onCancel={() => abortRef.current.get(entry.id)?.abort()}
                />
              )}
              {entry.status === 'fertig' && <span className="badge green">{entry.positions.length} Position(en) erkannt — bitte prüfen</span>}
              {entry.status === 'übernommen' && <span className="badge green">✓ übernommen</span>}
              {entry.status === 'fehler' && <span className="badge red">Fehler</span>}
              {entry.status === 'abgebrochen' && <span className="badge gray">abgebrochen</span>}
              <div className="grow" />
              {(entry.status === 'wartend' || entry.status === 'fertig' || entry.status === 'fehler' || entry.status === 'abgebrochen' || entry.status === 'übernommen') && (
                <button className="btn small ghost" onClick={() => { filesRef.current.delete(entry.id); setQueue((q) => q.filter((x) => x.id !== entry.id)) }}>
                  {entry.status === 'fertig' ? 'Verwerfen' : 'Entfernen'}
                </button>
              )}
            </div>
            {entry.status === 'fehler' && <div className="error">{entry.error}</div>}
            {entry.status === 'fertig' && (
              <>
                {/* Gerechnetes benennen, damit es geprüft werden kann (#34) */}
                {entry.amountsAdjusted === 'netto' && (
                  <div className="notice" style={{ marginTop: 8 }}>
                    Die Positionen standen ohne Umsatzsteuer auf der Rechnung. Mietfuchs hat sie auf den
                    Rechnungsbetrag hochgerechnet. Bitte die Beträge kurz prüfen.
                  </div>
                )}
                {entry.laborFromTotal && (
                  <div className="notice" style={{ marginTop: 8 }}>
                    Der Arbeitskostenanteil nach §35a stand nur als ein Betrag auf der Rechnung. Mietfuchs
                    hat ihn nach Beträgen auf die Positionen verteilt; Fahrtkosten und Material gehören
                    streng genommen nicht dazu.
                  </div>
                )}
                <Table style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th><span className="sr-only">Übernehmen</span></th>
                      <th>Beschreibung</th>
                      <th>Kostenart</th>
                      <th>Umlageschlüssel</th>
                      <th className="num">Betrag €</th>
                      <th className="num">§35a Lohn €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.positions.map((p, i) => (
                      <Fragment key={i}>
                      <tr>
                        <td><input type="checkbox" checked={p.checked} disabled={!!p.linked || !!p.created} onChange={(e) => updatePos(entry.id, i, { checked: e.target.checked })} /></td>
                        <td><input value={p.description} onChange={(e) => updatePos(entry.id, i, { description: e.target.value })} style={{ width: '100%' }} /></td>
                        <td>
                          <select value={p.category} onChange={(e) => updatePos(entry.id, i, { category: e.target.value, externalTotalAmount: '', ...aiPositionDefaults(e.target.value, units, meters, keyCtx, p.description) })}>
                            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                          </select>
                        </td>
                        <td><AiKeyCell position={p} units={units} onChange={(patch) => updatePos(entry.id, i, patch)} /></td>
                        <td className="num"><input value={p.amount} onChange={(e) => updatePos(entry.id, i, { amount: e.target.value })} style={{ width: 100, textAlign: 'right' }} /></td>
                        <td className="num"><input value={p.labor35a} onChange={(e) => updatePos(entry.id, i, { labor35a: e.target.value })} style={{ width: 90, textAlign: 'right' }} placeholder="—" /></td>
                      </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </Table>
                <DuplicateNotices groups={groupsOf(entry)} rows={entry.positions} year={year} busy={linking}
                  onLink={(g, o) => void linkGroup(entry, g, o)} onOpen={(item) => { setError(''); setForm(itemToForm(item)) }} />
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => void adoptPositions(entry)} disabled={entry.positions.every((p) => !p.checked)}>
                    Ausgewählte Positionen für {year} übernehmen
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Kostenpositionen {year}</h2>
        {yearItems.length === 0 && <div className="empty">Noch keine Kosten für {year} erfasst.</div>}
        {yearItems.length > 0 && (
          <Table>
            <thead>
              <tr>
                <th>Kostenart</th>
                <th>Beschreibung</th>
                <th>Umlageschlüssel</th>
                <th className="num">Betrag</th>
                <th className="no-print"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
              <Fragment key={g.key}>
              {g.invoiceFile && (
                <tr className="group-head">
                  <td colSpan={5}>
                    {g.label}
                    <a href={`/uploads/${g.invoiceFile}`} target="_blank" rel="noreferrer">📎 Beleg</a>
                  </td>
                </tr>
              )}
              {g.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.category}
                    {isNotAllocable(i.category) && <span className="badge gray" style={{ marginLeft: 6 }}>Vermieter</span>}
                  </td>
                  <td>
                    {i.description}
                    {!i.invoiceFile && i.vendor && <div className="muted">{i.vendor}</div>}
                  </td>
                  <td>
                    {/* Nicht umlagefähig (#142): kein Schlüssel, die Position trägt der Vermieter. */}
                    {keyListText(i)}
                    {showsKeyFields(i.category) && <>
                    {/* Eine Einschränkung auf Teilnehmer (#105) soll man in der Liste sehen, nicht erst im Formular. */}
                    {i.participantUnitIds && (
                      <div className="muted">nur {i.participantUnitIds.map((id) => units.find((u) => u.id === id)?.name ?? '?').join(', ') || 'keine Wohnung'}</div>
                    )}
                    {i.key === 'direct' && <div className="muted">{units.find((u) => u.id === i.directUnitId)?.name}</div>}
                    {i.key === 'meter' && <div className="muted">{i.meterType ? METER_TYPE_LABELS[i.meterType] : '— kein Zählertyp'}</div>}
                    {i.key === 'custom' && (
                      <div className="muted">
                        {Object.entries(i.customShares ?? {})
                          .map(([unitId, pct]) => `${units.find((u) => u.id === unitId)?.name ?? '?'}: ${pct.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`)
                          .join(' · ') || '— keine Anteile'}
                      </div>
                    )}
                    </>}
                  </td>
                  <td className="num">
                    {fmtEuro(i.amountCents)}
                    {!!i.labor35aCents && <div className="muted">§35a: {fmtEuro(i.labor35aCents)}</div>}
                  </td>
                  <td className="actions no-print">
                    <button
                      className="icon-btn"
                      title="Bearbeiten"
                      aria-label="Kostenposition bearbeiten"
                      onClick={() => {
                        setError('')
                        setForm(itemToForm(i))
                      }}
                    >
                      ✎
                    </button>
                    <button className="icon-btn danger" title="Löschen" aria-label="Kostenposition löschen" onClick={() => deleteItem(i)}>🗑</button>
                  </td>
                </tr>
              ))}
              {g.invoiceFile && g.items.length > 1 && (
                <tr className="subtotal">
                  <td colSpan={3}>Summe Beleg — {g.label}</td>
                  <td className="num">{fmtEuro(g.items.reduce((a, i) => a + i.amountCents, 0))}</td>
                  <td className="no-print" />
                </tr>
              )}
              </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Summe</td>
                <td className="num">{fmtEuro(totalCents)}</td>
                <td className="no-print"></td>
              </tr>
            </tfoot>
          </Table>
        )}

        <button className="btn secondary no-print" style={{ marginTop: 14 }} onClick={() => { setError(''); setForm(newItemForm(units, meters, keyCtx)) }}>
          + Kostenposition manuell erfassen
        </button>
      </div>

      {form && (
        <Drawer
          open
          title={form.id ? 'Kostenposition bearbeiten' : 'Neue Kostenposition'}
          subtitle={form.id ? form.description : undefined}
          onClose={() => { setError(''); setForm(null) }}
          onSubmit={saveItem}
          footer={
            <>
              <span className="drawer-hint">Strg+S speichert · Esc schließt</span>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => { setError(''); setForm(null) }}>Abbrechen</button>
              <button className="btn" onClick={saveItem}>{form.id ? 'Übernehmen' : 'Hinzufügen'}</button>
            </>
          }
        >
          {error && <div className="error">{error}</div>}
          {categoryNotice(form.category, year, property?.cableBuiltBeforeDec2021 ?? null) && <div className="notice">{categoryNotice(form.category, year, property?.cableBuiltBeforeDec2021 ?? null)}</div>}
          <div className="row">
            <label className="field grow">
              Kostenart
              <select value={form.category} onChange={(e) => setForm(withCategory(form, e.target.value, units, meters, keyCtx))}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="field grow">
              Beschreibung
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="z. B. Grundsteuer 2025" />
            </label>
            <label className="field grow">
              Rechnungssteller
              <input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="optional" />
            </label>
            <label className="field grow">
              Betrag €
              <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="z. B. 480,00" />
              {/* #139: Eine Gutschrift senkt die Kosten des Jahres und wird verteilt wie eine Rechnung. */}
              <small className="muted">Eine Gutschrift mit Minus eintragen, z. B. -54,00.</small>
            </label>
            <label className="field grow" title="Lohn-/Arbeitskostenanteil nach §35a EStG — kann der Mieter steuerlich absetzen">
              <span>davon <Term id="labor35a">§35a-Lohn</Term> €</span>
              <input value={form.labor35a} onChange={(e) => setForm({ ...form, labor35a: e.target.value })} placeholder="optional" />
            </label>
            {/* Nicht umlagefähig (#142): nichts zu verteilen, also keine Auswahl, die etwas anderes verspräche. */}
            {!showsKeyFields(form.category) && (
              <div className="field grow muted">
                <span><Term id="notAllocable">Nicht umlagefähig</Term>: Diese Position trägt der Vermieter allein; ein Umlageschlüssel entfällt.</span>
              </div>
            )}
            {showsKeyFields(form.category) && <>
            <label className="field grow">
              <Term id="allocationKey">Umlageschlüssel</Term>
              <select value={form.key} onChange={(e) => setForm(withKey(form, e.target.value as CostKey, unitMeterTypes, keyCtx))}>
                {costKeyOptions(unitMeterTypes, form.key).map((k) => (
                  <option key={k} value={k}>{KEY_LABELS[k]}</option>
                ))}
              </select>
            </label>
            {/* #141: anders als dieselbe Kostenart im Vorjahr? Dasselbe sagt die Abrechnung. */}
            {keyChangeNotice(form, units, keyCtx) && (
              <div className="notice">
                {keyChangeNotice(form, units, keyCtx)} Mehr dazu: <Term id="keyChange" />.
              </div>
            )}
            {form.key === 'meter' && (
              <label className="field grow">
                Zählertyp
                <select value={form.meterType} onChange={(e) => setForm({ ...form, meterType: e.target.value as MeterType | '' })}>
                  <option value="">— wählen —</option>
                  {meterTypeOptions(unitMeterTypes, form.meterType).map((t) => (
                    <option key={t} value={t}>{METER_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </label>
            )}
            {form.key === 'custom' && (
              <div className="field-group">
                <div className="field-group-label"><Term id="agreedShares">Vereinbarte Anteile</Term></div>
                <div className="muted" style={{ marginBottom: 8 }}>
                  Anteil je Wohnung in Prozent, wie im Mietvertrag vereinbart (§556a Abs. 1 BGB).
                  Was unter 100 % fehlt, trägt der Vermieter.
                </div>
                <div className="row">
                  {basisUnits.map((u) => (
                    <label key={u.id} className="field grow">
                      {/* Name und Kennzeichen in einer Zeile — .field ist eine Flex-Spalte,
                          ein direktes Kind würde sich sonst über die ganze Breite ziehen. */}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {u.name}
                        {usageOf(u) === 'eigen' && <span className="badge gray">Eigennutzung</span>}
                      </span>
                      <input
                        value={form.customShares[u.id] ?? ''}
                        onChange={(e) => setForm({ ...form, customShares: { ...form.customShares, [u.id]: e.target.value } })}
                        placeholder="z. B. 40"
                        inputMode="decimal"
                      />
                    </label>
                  ))}
                </div>
                <div className="muted" style={{ marginTop: 6 }}>Summe: {sumText}</div>
              </div>
            )}
            {form.key === 'external' && (
              <div className="field-group">
                <div className="field-group-label">Laut Gemeinschaftsabrechnung</div>
                <div className="muted" style={{ marginBottom: 8 }}>
                  Betrag oben ist Ihr Anteil laut <Term id="homeownersStatement">Hausgeldabrechnung</Term>. Hier die Angaben der Gemeinschaft
                  zu dieser Kostenart, meist nach <Term id="mea">Miteigentumsanteilen</Term>; sie erscheinen im Rechenweg der Abrechnung (§556a Abs. 3 BGB).
                </div>
                <div className="row">
                  <label className="field grow">
                    Maßstab
                    <select value={form.externalMeasure} onChange={(e) => setForm({ ...form, externalMeasure: e.target.value as ExternalMeasure })}>
                      {EXTERNAL_MEASURE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                  <label className="field grow">
                    {externalTotalLabel(form.externalMeasure)}
                    <input value={form.externalTotal} onChange={(e) => setForm({ ...form, externalTotal: e.target.value })} inputMode="decimal" />
                  </label>
                  <label className="field grow">
                    Kosten der Gemeinschaft (ganze Anlage) €
                    <input value={form.externalTotalAmount} onChange={(e) => setForm({ ...form, externalTotalAmount: e.target.value })} placeholder="z. B. 50.000,00" inputMode="decimal" />
                  </label>
                </div>
                {/* #144: weicht der rechnerische Anteil vom Betrag ab, steht er markiert da */}
                {externalHint(form, units) && (
                  externalMismatch(form, units)
                    ? <div className="notice" style={{ marginTop: 6 }}><strong>{externalHint(form, units)}</strong></div>
                    : <div className="muted" style={{ marginTop: 6 }}>{externalHint(form, units)}</div>
                )}
              </div>
            )}
            {form.key === 'amounts' && (
              <div className="field-group">
                <div className="field-group-label"><Term id="individualAmounts">Einzelbeträge</Term> je Mieter</div>
                <div className="muted" style={{ marginBottom: 8 }}>
                  Die Beträge aus der Einzelabrechnung, etwa vom Messdienst. Bei einem Mieterwechsel teilt
                  der Messdienst selbst auf; den Rest trägt der Vermieter.
                </div>
                {tenanciesForAmounts(tenancies, units, year, form.participants).length === 0 ? (
                  <div className="muted">In diesem Jahr gibt es kein Mietverhältnis in diesem Objekt.</div>
                ) : (
                  <div className="row">
                    {tenanciesForAmounts(tenancies, units, year, form.participants).map((t) => (
                      <label key={t.id} className="field grow">
                        {t.tenantName} ({units.find((u) => u.id === t.unitId)?.name ?? '—'})
                        <input
                          value={form.tenancyAmounts[t.id] ?? ''}
                          onChange={(e) => setForm({ ...form, tenancyAmounts: { ...form.tenancyAmounts, [t.id]: e.target.value } })}
                          placeholder="z. B. 312,40"
                          inputMode="decimal"
                        />
                      </label>
                    ))}
                  </div>
                )}
                {selfAmountUnits(units, form.participants).length > 0 && (
                  <div className="row" style={{ marginTop: 8 }}>
                    {selfAmountUnits(units, form.participants).map((u) => (
                      <label key={u.id} className="field grow">
                        <span>{u.name} (selbstgenutzt, Ihr <Term id="ownShare">Eigenanteil</Term>)</span>
                        <input
                          value={form.selfAmounts[u.id] ?? ''}
                          onChange={(e) => setForm({ ...form, selfAmounts: { ...form.selfAmounts, [u.id]: e.target.value } })}
                          placeholder="z. B. 600,00"
                          inputMode="decimal"
                        />
                      </label>
                    ))}
                  </div>
                )}
                <div className="muted" style={{ marginTop: 6 }}>{amountsSumText(form, units, tenancies, year)}</div>
              </div>
            )}
            {PARTICIPANT_KEYS.includes(form.key) && basisUnits.length > 1 && (
              <details open={form.participants !== null}>
                <summary>Weitere Optionen: nur bestimmte Wohnungen beteiligen</summary>
                <div className="muted" style={{ marginBottom: 8 }}>
                  Etwa der Aufzug nur für ein Haus oder die Waschküche nur für ihre Nutzer. Nur die
                  angehakten Wohnungen bilden die <Term id="distributionBasis">Verteilbasis</Term>.
                </div>
                <div className="row">
                  {basisUnits.map((u) => {
                    const checked = form.participants === null || form.participants.includes(u.id)
                    return (
                      <label key={u.id} className="field checkline">
                        <span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const current = form.participants ?? basisUnits.map((x) => x.id)
                              const next = e.target.checked ? [...current, u.id] : current.filter((id) => id !== u.id)
                              setForm({ ...form, participants: next })
                            }}
                          />{' '}
                          {u.name}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </details>
            )}
            {form.key === 'direct' && (
              <label className="field grow">
                Wohnung
                <select value={form.directUnitId} onChange={(e) => setForm({ ...form, directUnitId: e.target.value })}>
                  <option value="">— wählen —</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            )}
            </>}
            <div className="field-group">
              <div className="field-group-label">Beleg (Rechnungskopie)</div>
              {form.invoiceFile ? (
                <div className="row" style={{ alignItems: 'center' }}>
                  <a href={`/uploads/${form.invoiceFile}`} target="_blank" rel="noreferrer">
                    📎 {form.invoiceFile.replace(/^\d+_/, '')}
                  </a>
                  <button className="btn small ghost" onClick={() => setForm({ ...form, invoiceFile: undefined })}>
                    Zuordnung entfernen
                  </button>
                </div>
              ) : (
                <>
                  <label className="field grow">
                    neu hochladen
                    <input type="file" accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadInvoice(f) }} />
                  </label>
                  {knownFiles.length > 0 && (
                    <label className="field grow" style={{ marginTop: 8 }}>
                      oder vorhandenen Beleg zuordnen
                      <select value="" onChange={(e) => { if (e.target.value) setForm({ ...form, invoiceFile: e.target.value }) }}>
                        <option value="">— wählen —</option>
                        {knownFiles.map(([f, label]) => (
                          <option key={f} value={f}>{label} — {f.replace(/^\d+_/, '')}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
            </div>
          </div>
        </Drawer>
      )}
    </>
  )
}
