// Die Ansicht „Ordner“ der Seite Belege (#490, vorher der Belegordner, #170): Register je Kostenart mit Summe und
// Belegabdeckung, „Beleg nachreichen“ und „Aus dem Eingang …“ an Positionen ohne Beleg, die Suche über alle Objekte und
// Jahre, Zählerfotos und die Mappen. Belege ohne Position stehen im Eingang (BelegeEingang.tsx).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BillingPeriod, CostItem, PeriodRules, UploadInfo, Settlement } from '../types'
import { withProperty, useProperty } from '../property'
import { usePeriod } from '../period'
import { api, errorText, fmtEuro } from '../api'
// Der Ordner gliedert nach Kalenderjahren, denn Belege tragen Kalenderjahre (#208, Entwurf
// 5.2: `uploads.year` bleibt). Die Mappe für Mieter gehört dagegen zu einer Abrechnung, also zu
// einem Zeitraum des Objekts.
import { isCalendarRules, periodContaining, periodLabel, periodsBetween, rulesOf, startYearOf } from '../../../shared/period.ts'
import { renderInvoicePages, renderThumbnail } from '../pdfPreview'
import { buildTenantFolderPdf, isIndividualAmounts, planTenantFolder, type TenantFolderPlan } from '../tenantFolder'
import { buildFolder, coverage, filesByItem, duplicateHints, inboxFor, partsBySource, receiptCards, registerCount, receiptName, yearSections, type CategoryGroup, type FolderFilter, type ReceiptCard } from '../receipts'
import { hitPlace } from '../belegeView'
import { useEvaluationQueue } from '../evaluationQueue'
import type { ReceiptStock } from '../receiptStock'
import Field from '../components/Field'
import { useToast } from '../components/feedback'
import { NoticeBox } from '../components/Notice'
import Card from '../components/Card'
import { AmountCheckBox, AttachPicker, ReceiptItem, useAttach, useHighlight } from '../components/ReceiptParts'

// ---------- Mappen packen (#170) ----------

type FolderMeta = { title: string; subtitle: string; fileName: string }

// Eine Seite als JPEG-Bytes, aus einer Daten-Adresse oder einer Bilddatei, die pdf-lib nicht
// unmittelbar nimmt (etwa WebP): über ein Canvas.
async function jpegBytes(src: string): Promise<Uint8Array> {
  if (src.startsWith('data:image/jpeg')) return Uint8Array.from(atob(src.split(',')[1] ?? ''), (c) => c.charCodeAt(0))
  const img = new Image()
  img.src = src
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d')?.drawImage(img, 0, 0)
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('Bild nicht lesbar'))), 'image/jpeg', 0.85))
  return new Uint8Array(await blob.arrayBuffer())
}

// Die Mappe erzeugen und herunterladen. Alles im Browser: Die Belege liegen ohnehin hier, und
// der Server braucht dafür kein Werkzeug, das in der Programmdatei fehlen könnte.
// Gibt die Namen der Belege zurück, die nicht hineinkamen.
async function downloadTenantFolder(plan: TenantFolderPlan, meta: FolderMeta): Promise<string[]> {
  const unreadable: string[] = []
  const bytes = await buildTenantFolderPdf(plan, {
    title: meta.title,
    subtitle: meta.subtitle,
    load: async (u) => {
      const res = await fetch(`/uploads/${encodeURIComponent(u.file)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    rasterize: async (u) => Promise.all((await renderInvoicePages(u.file)).map(jpegBytes)),
    onUnreadable: (u) => unreadable.push(receiptName(u)),
  })
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = meta.fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return unreadable
}

const fileLabel = (s: string) => s.normalize('NFC').replace(/[^\w\-äöüÄÖÜß]+/g, '-').replace(/^-+|-+$/g, '') || 'objekt'

// Der Abrechnungszeitraum, den die Mappe eines Kalenderjahres meint (#208): der, der im Jahr
// beginnt; beim Kalenderobjekt das Jahr selbst.
function packPeriod(rules: PeriodRules, year: number): BillingPeriod {
  return periodsBetween(rules, `${year}-01-01`, `${year}-12-31`).find((p) => p.from.startsWith(`${year}-`)) ?? periodContaining(rules, `${year}-01-01`)
}

function FolderPacks({ propertyId, propertyName, year, chosen, rules, uploads, costItems, make }: {
  propertyId: string
  propertyName: string
  year: number
  // Der in der Seitenleiste gewählte Zeitraum, wenn die Mappe dessen Objekt gilt; sonst der, der im Jahr beginnt
  chosen: BillingPeriod | null
  rules: PeriodRules
  uploads: UploadInfo[]
  costItems: CostItem[]
  make: (plan: TenantFolderPlan, meta: FolderMeta) => Promise<string[] | void>
}) {
  const [open, setOpen] = useState(false)
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  // Die Teile je Rechnung über alle Zeiträume (#455): Ein Teil ohne eigenen Beleg bekommt den seiner Rechnung.
  const parts = useMemo(() => partsBySource(costItems), [costItems])
  const [includeIndividual, setIncludeIndividual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const toast = useToast()
  const period = chosen ?? packPeriod(rules, year)
  const label = periodLabel(period)
  const param = isCalendarRules(rules) ? String(year) : period.key

  useEffect(() => {
    if (!open) return
    let live = true
    setSettlement(null)
    api<Settlement>(withProperty(`/api/settlement/${param}`, propertyId))
      .then((st) => { if (live) setSettlement(st) }, (e) => { if (live) setProblem(errorText(e)) })
    return () => { live = false }
  }, [open, param, propertyId])

  const plan = useMemo(
    () => (settlement ? planTenantFolder(settlement, costItems.filter((c) => c.propertyId === propertyId && c.period === period.key), uploads, { includeIndividual }, parts) : null),
    [settlement, costItems, uploads, includeIndividual, propertyId, period.key, parts],
  )
  const count = (status: string) => plan?.entries.filter((e) => e.status === status).length ?? 0
  const individual = plan?.entries.filter((e) => isIndividualAmounts(e.item) && e.upload).length ?? 0

  async function create() {
    if (!plan) return
    setBusy(true)
    setProblem('')
    try {
      const unreadable = await make(plan, {
        title: `Belegmappe ${label}`,
        subtitle: propertyName,
        fileName: `belegmappe-${label.replace(/[^\d-]+/g, '-').replace(/^-+|-+$/g, '')}-${fileLabel(propertyName)}.pdf`,
      })
      toast('Die Belegmappe ist erstellt.')
      if (unreadable && unreadable.length > 0) {
        setProblem(`Nicht übernehmbar, bitte gesondert beilegen: ${unreadable.join(', ')}. Das Deckblatt nennt sie.`)
      }
    } catch (e) {
      setProblem(`Die Mappe ließ sich nicht erstellen: ${errorText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={<>Mappen packen · {year}</>} className="no-print receipt-packs">
      <div className="row receipt-filters">
        <a className="btn" href={withProperty(`/api/receipts/tax/${year}`, propertyId)} download>🧾 Belege für die Steuer (ZIP)</a>
        <span className="muted">Alle Belege des Jahres nach den Gruppen der Anlage V, auch die nicht umlagefähigen, mit einer Übersicht.</span>
      </div>
      <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>📎 Belegmappe für Mieter · {label} (PDF)</summary>
        <p className="muted">
          Für die Belegeinsicht: die Belege der umgelegten Positionen in der Reihenfolge der Abrechnung, mit einem Deckblatt
          „Position → Beleg, Seite“. Seit 2025 dürfen Sie die Belege elektronisch bereitstellen (§ 556 Abs. 4 BGB).
        </p>
        {problem && <NoticeBox level="error" action={problem} />}
        {!plan ? (
          !problem && <div className="muted">Lädt die Abrechnung …</div>
        ) : (
          <>
            <p>
              {plan.documents.length} Beleg{plan.documents.length === 1 ? '' : 'e'} zu {plan.entries.length} umgelegten Position{plan.entries.length === 1 ? '' : 'en'}
              {count('none') > 0 && <> · {count('none')} Position{count('none') === 1 ? '' : 'en'} ohne Beleg</>}
              {count('missing') > 0 && <> · bei {count('missing')} fehlt die Datei</>}
            </p>
            {individual > 0 && (
              <label className="field checkline">
                <span>
                  <input type="checkbox" checked={includeIndividual} onChange={(e) => setIncludeIndividual(e.target.checked)} />{' '}
                  Belege beilegen, die nur einzelne Mieter betreffen ({individual})
                </span>
              </label>
            )}
            {individual > 0 && (
              <NoticeBox level="warning" action={<>
                Belege zu „Einzelbeträge je Mieter“ (etwa die Abrechnung eines Messdienstes), zu einer Direktzuordnung oder zu einer
                Position mit Teilnehmern betreffen nur einzelne Mieter und nennen oft deren Namen und Verbrauchswerte. Ein Mieter darf
                auch sie einsehen, ohne ein besonderes Interesse darzulegen (BGH, Urteil vom 07.02.2018, VIII ZR 189/17). Weil die Mappe
                an alle Mieter des Objekts geht, legen Sie sie am besten nur dem bei, der danach fragt, und prüfen vorher, ob Namen darauf
                stehen müssen. Ohne Haken stehen diese Positionen im Deckblatt mit „auf Anfrage“.
              </>} />
            )}
            <button className="btn" onClick={() => void create()} disabled={busy || plan.entries.length === 0}>
              {busy ? 'Wird erstellt …' : 'PDF erstellen'}
            </button>
          </>
        )}
      </details>
    </Card>
  )
}

export type { FolderMeta }

type Props = {
  stock: ReceiptStock
  // Für Tests: ohne pdf.js
  renderThumb?: typeof renderThumbnail
  // Eine Position im Formular der Seite Kosten öffnen, etwa um Betrag und §35a dort zu pflegen
  onOpenItem?: (item: CostItem) => void
  // Ein Beleg, zu dem die Ansicht springen soll (ein Beleg an Positionen oder ein Zählerfoto). Steht er im gewählten
  // Ausschnitt nicht, zeigt sie alle Objekte und Jahre.
  focusFile?: string | null
  onFocusDone?: () => void
  // Ein Treffer der Suche ohne Position: im Eingang zeigen
  onShowInInbox?: (file: string) => void
  // Für Tests: die Belegmappe erzeugen, ohne pdf.js und Download
  makeTenantFolder?: (plan: TenantFolderPlan, meta: FolderMeta) => Promise<string[] | void>
}

export default function BelegeOrdner({ stock, renderThumb = renderThumbnail, onOpenItem, focusFile, onFocusDone, onShowInInbox, makeTenantFolder = downloadTenantFolder }: Props) {
  const { year: currentYear, calendar, key: periodKeyNow, period: periodNow, label: periodLabelNow } = usePeriod()
  const { property, properties } = useProperty()
  const { uploads, costItems, loadedOnce } = stock
  const [error, setError] = useState('')
  // Hängt ein gespeicherter, nicht ausgewerteter Beleg jetzt an einer Position, ist sein Eintrag der Warteschlange erledigt
  // (Durchsicht S3)
  const { queue, remove } = useEvaluationQueue()
  const attach = useAttach(stock, properties, setError, (file) => {
    for (const x of queue) if (x.status === 'gespeichert' && (x.failure?.file ?? x.file) === file) remove(x.id)
  })
  // Der Ordner zeigt das Objekt und das Jahr der Seitenleiste (#170); gewählt werden beide nur dort (#346
  // Schritt 8, M13). Was der Ordner darüber hinaus kann, ist ein Umfang und keine Wahl: Belege aller Objekte bzw.
  // aller Jahre zeigen. Das Jahr ist das Kalenderjahr, in dem der gewählte Zeitraum beginnt; darunter stehen seine
  // Positionen (receipts.ts). Die Suche durchsucht immer alle Objekte und Jahre (#490) und nennt beides am Treffer.
  const [allProperties, setAllProperties] = useState(false)
  const [allYears, setAllYears] = useState(false)
  const [query, setQuery] = useState('')
  const searching = query.trim() !== ''

  // Zum angesprungenen Beleg (#487): erst wenn die Liste da ist; steht er nicht im Ausschnitt, einmal alle Objekte
  // und Jahre zeigen. Fehlt er ganz, ist der Sprung trotzdem erledigt.
  const widenedForFocus = useRef(false)
  const focusedFile = useRef<string | null>(null)
  const [jumped, setJumped] = useHighlight()
  useEffect(() => {
    if (!focusFile || !loadedOnce || focusedFile.current === focusFile) return
    const done = () => {
      focusedFile.current = focusFile
      widenedForFocus.current = false
      onFocusDone?.()
    }
    const card = [...document.querySelectorAll<HTMLElement>('[data-view="ordner"] li.receipt-card[data-file]')].find((li) => li.dataset.file === focusFile)
    if (card) {
      // Ein Zählerfoto steht in den zugeklappten „Zählerfotos“ (Durchsicht #487)
      const folded = card.closest('details')
      if (folded && !folded.open) folded.open = true
      card.scrollIntoView?.({ block: 'center' })
      card.querySelector<HTMLElement>('a')?.focus()
      setJumped(focusFile)
      done()
    } else if (!widenedForFocus.current && uploads.some((u) => u.file === focusFile)) {
      widenedForFocus.current = true
      setAllProperties(true)
      setAllYears(true)
    } else done()
  })

  // Ohne gewähltes Objekt (oder mit nur einem) gilt „alle“: Bei einem Objekt ist das dasselbe.
  const scope: FolderFilter = useMemo(() => ({
    propertyId: properties.length > 1 && !allProperties && property ? property.id : 'all',
    year: allYears ? 'all' : currentYear,
    // Der gewählte Zeitraum des Objekts der Seitenleiste: Rumpf und neuer Zeitraum beginnen im selben Jahr (#346 Schritt 12)
    period: !allYears && !calendar && property ? { propertyId: property.id, key: periodKeyNow } : null,
  }), [allProperties, allYears, property, currentYear, properties.length, calendar, periodKeyNow])
  // Was die Register zeigen: der Umfang, bei einer Suche alle Objekte und Jahre
  const filter: FolderFilter = useMemo(() => (searching ? { propertyId: 'all', year: 'all', period: null } : scope), [searching, scope])
  const folder = useMemo(() => buildFolder(uploads, costItems, filter, query), [uploads, costItems, filter, query])
  const allCards = useMemo(() => receiptCards(uploads, costItems), [uploads, costItems])
  const hints = useMemo(() => duplicateHints(allCards), [allCards])
  const meterPhotos = useMemo(() => allCards.filter((c) => c.upload.kind === 'meterPhoto' && c.items.length === 0), [allCards])
  const present = useMemo(() => new Set(uploads.map((u) => u.file)), [uploads])
  const booked = useMemo(() => filesByItem(uploads), [uploads])
  // Die Teile je Rechnung (#455): Der Beleg eines Teils belegt auch die übrigen.
  const parts = useMemo(() => partsBySource(costItems), [costItems])
  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name || 'Ohne Namen'
  const showProperty = filter.propertyId === 'all' && properties.length > 1
  // Mappen gibt es je Objekt und Jahr; bei einem einzigen Objekt ist es dieses.
  const packProperty = scope.propertyId !== 'all' ? scope.propertyId : properties.length === 1 ? properties[0]?.id ?? null : null

  // Belegabdeckung (#170): je Objekt des Umfangs, bei „alle Objekte“ also eine Zeile je Objekt
  const coverageRows = useMemo(() => {
    const ids = scope.propertyId === 'all' ? (properties.length > 0 ? properties.map((p) => p.id) : [...new Set(costItems.map((c) => c.propertyId))]) : [scope.propertyId]
    return ids
      .map((id) => ({ id, cov: coverage(costItems, { propertyId: properties.length > 1 ? id : 'all', year: scope.year, period: scope.period }, present, booked) }))
      .filter((r) => r.cov.positions > 0)
  }, [costItems, scope, present, booked, properties])

  const renderCard = (card: ReceiptCard) => (
    <ReceiptItem key={card.upload.file} card={card} renderThumb={renderThumb} jumped={jumped === card.upload.file} hint={hints.get(card.upload.file)}
      place={showProperty && card.propertyIds.length > 0 ? card.propertyIds.map(propertyName).join(', ') : undefined}>
      {card.upload.kind === 'meterPhoto' ? (
        <span className="badge gray">Zählerfoto aus dem Eingang</span>
      ) : (
        <ul className="receipt-items">
          {card.items.map((c) => (
            <li key={c.id}>→ {c.description}{filter.year === startYearOf(c.period) ? '' : ` (${startYearOf(c.period)})`} · {fmtEuro(c.amountCents)}</li>
          ))}
        </ul>
      )}
    </ReceiptItem>
  )

  // Ein Register: eine Kostenart eines Jahres, mit den Belegen und den Positionen ohne Beleg
  const renderGroup = (g: CategoryGroup) => {
    // Wie die Belegabdeckung: auch ein Beleg über eine gebuchte Zeile deckt die Position (Durchsicht von PR #449, K2).
    // Je Rechnung wie die Belegabdeckung (#455): Die Teile einer Quelle zählen als eine Position.
    const { positions, without: ohne } = registerCount(g, present, booked, parts)
    return (
      <details key={g.key} className="card receipt-group" open>
        <summary>
          <span className="receipt-group-title">{g.category}</span>
          <span className="num">{fmtEuro(g.sumCents)}</span>
          {ohne === 0
            ? <span className="badge green">✓ {positions === 1 ? 'Beleg vorhanden' : 'alle Belege vorhanden'}</span>
            : <span className="badge amber">⚠ {ohne} von {positions} Position{positions > 1 ? 'en' : ''} ohne Beleg</span>}
        </summary>
        {g.cards.length > 0 && <ul className="receipt-list">{g.cards.map(renderCard)}</ul>}
        {g.missing.length > 0 && (
          <ul className="receipt-missing">
            {g.missing.map((c) => (
              <li key={c.id}>
                <span>– {c.description}{showProperty ? ` (${propertyName(c.propertyId)})` : ''} · {fmtEuro(c.amountCents)} <span className="muted">ohne Beleg</span></span>
                {/* Der Knopf darf nicht springen, wenn hinter der Auswahl „Speichern“ und „Verwerfen“ erscheinen (N7 aus
                    #341). Die Gruppe ist auch nach einem Umbruch rechtsbündig; am breiten Bildschirm steht der Knopf zuletzt,
                    sodass sie nach links wächst, am Handy zuerst, sodass die Knöpfe darunter umbrechen (Durchsicht von N7) */}
                <span className="receipt-attach ml-auto justify-end">
                  {inboxFor(allCards, c).length > 0 && (
                    <AttachPicker label={`Vorhandenen Beleg für ${c.description} zuordnen`} what={`Beleg für ${c.description}`}
                      placeholder="Aus dem Eingang …" scope={c.id} values={inboxFor(allCards, c).map((u) => u.upload.file)}
                      onSave={(file) => attach.attachExisting(c, file)}>
                      {inboxFor(allCards, c).map((u) => <option key={u.upload.file} value={u.upload.file}>{receiptName(u.upload)}</option>)}
                    </AttachPicker>
                  )}
                  <label className="btn secondary max-sm:order-first">
                    Beleg nachreichen
                    <input
                      type="file"
                      className="sr-only"
                      accept="application/pdf,image/*"
                      aria-label={`Beleg für ${c.description} hochladen`}
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void attach.uploadFor(c, f) }}
                    />
                  </label>
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    )
  }

  return (
    <>
      {(error || stock.error) && <NoticeBox level="error" action={error || stock.error} />}
      <AmountCheckBox attach={attach} properties={properties} onOpenItem={onOpenItem} />

      <div className="card no-print">
        {/* Suche in voller Breite, darunter die beiden Kästchen auf einer Linie (#346 Schritt 7b, Durchsicht M1 und K2):
            Der lange Platzhalter schnitt ab; was die Suche findet, steht jetzt als Hinweis. */}
        <Field label="Suche" width="full" hint="Findet Rechnungssteller, Beschreibung, Betrag (z. B. 128,40), Dateiname oder Jahr, in allen Objekten und Jahren, auch Belege im Eingang.">
          <input type="search" value={query} placeholder="z. B. Stadtwerke oder 128,40" onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <div className="checks">
          {properties.length > 1 && (
            <label className="field checkline">
              <span>
                <input type="checkbox" checked={allProperties} onChange={(e) => setAllProperties(e.target.checked)} />
                Belege aller Objekte zeigen
              </span>
            </label>
          )}
          <label className="field checkline">
            <span>
              <input type="checkbox" checked={allYears} onChange={(e) => setAllYears(e.target.checked)} />
              Belege aller Jahre zeigen
            </span>
          </label>
        </div>
        {/* Durchsicht zu Schritt 8, K2, und #346 Schritt 12: Bei einem anderen Rhythmus zeigt der Ordner für das Objekt der
            Seitenleiste den gewählten Zeitraum (receipts.ts, `period`); bei „alle Objekte“ für die übrigen die Zeiträume,
            die im Jahr beginnen. Nach einem Wechsel des Rhythmus beginnen Rumpf und neuer Zeitraum im selben Jahr. */}
        {!calendar && !allYears && !searching && (
          <p className="muted">
            Gezeigt sind die Positionen von {periodLabelNow}.
            {scope.propertyId === 'all' && properties.length > 1 && ` Bei den übrigen Objekten die Zeiträume, die ${currentYear} beginnen.`}
          </p>
        )}
      </div>

      {coverageRows.length > 0 && (
        <div className="card receipt-coverage">
          {coverageRows.map(({ id, cov }) => {
            const ohne = cov.positions - cov.covered
            return (
              <div key={id} className="receipt-coverage-row">
                <span>Belegabdeckung {scope.year === 'all' ? '' : `${scope.period?.propertyId === id ? periodLabelNow : scope.year} `}{coverageRows.length > 1 || (scope.propertyId === 'all' && properties.length > 1) ? `· ${propertyName(id)}` : ''}</span>
                <span className="progress" aria-hidden="true"><span className="progress-fill" style={{ width: `${cov.percent}%`, display: 'block' }} /></span>
                <strong>{cov.percent} %</strong>
                <span className="muted">{ohne === 0 ? 'alle Positionen belegt' : `${ohne} Position${ohne > 1 ? 'en' : ''} ohne Beleg`}</span>
              </div>
            )
          })}
        </div>
      )}

      {packProperty && scope.year !== 'all' && (
        <FolderPacks
          propertyId={packProperty}
          propertyName={propertyName(packProperty)}
          year={scope.year}
          chosen={scope.period?.propertyId === packProperty ? periodNow : null}
          rules={rulesOf(properties.find((p) => p.id === packProperty))}
          uploads={uploads}
          costItems={costItems}
          make={makeTenantFolder}
        />
      )}

      {/* Treffer ohne Position: Sie stehen im Eingang; hier nur mit Ort und dem Weg dorthin. */}
      {searching && folder.unlinked.length > 0 && (
        <Card title={`Im Eingang (${folder.unlinked.length})`} className="no-print">
          <ul className="receipt-list">
            {folder.unlinked.map((card) => (
              <ReceiptItem key={card.upload.file} card={card} renderThumb={renderThumb} jumped={false} hint={hints.get(card.upload.file)}
                place={hitPlace(card, propertyName, properties.length > 1)}>
                {onShowInInbox && (
                  <div className="row">
                    <button type="button" className="btn small secondary" onClick={() => onShowInInbox(card.upload.file)}>
                      Im Eingang zeigen{' '}<span className="sr-only">({receiptName(card.upload)})</span>
                    </button>
                  </div>
                )}
              </ReceiptItem>
            ))}
          </ul>
        </Card>
      )}

      {folder.groups.length === 0 ? (
        (!searching || folder.unlinked.length === 0) && <div className="card"><div className="empty">{searching ? 'Nichts gefunden.' : 'Für diese Auswahl sind keine Kosten erfasst.'}</div></div>
      ) : filter.year === 'all' ? (
        // „Belege aller Jahre zeigen“ und die Suche: ein Abschnitt je Jahr mit Anzahl, aufgeklappt nur das gewählte Jahr;
        // bei einer Suche alle Jahre mit Treffern (Leistungsprüfung, Befund 4).
        yearSections(folder.groups).map((section) => (
          // Aufklapper und Kopfzeile wie ein Register (`receipt-group`), aber ohne Karte: Die Register stehen darin.
          <details key={section.year} data-year-section={section.year} className="receipt-group" open={section.year === currentYear || searching}>
            <summary className="mb-3 border-b border-line py-2">
              <span className="text-l font-strong">{section.year}</span>
              <span className="muted">{section.receipts === 1 ? '1 Beleg' : `${section.receipts} Belege`}</span>
              {section.withoutReceipt > 0 && <span className="badge amber">⚠ {section.withoutReceipt} Position{section.withoutReceipt > 1 ? 'en' : ''} ohne Beleg</span>}
            </summary>
            {section.groups.map(renderGroup)}
          </details>
        ))
      ) : (
        folder.groups.map(renderGroup)
      )}

      {meterPhotos.length > 0 && (
        <details className="card no-print">
          <summary>Zählerfotos ({meterPhotos.length})</summary>
          <p className="muted">Fotos von Zählerständen aus dem Eingang. Sie belegen keine Kosten und stehen deshalb nicht unter „Ohne Position“.</p>
          <ul className="receipt-list">{meterPhotos.map(renderCard)}</ul>
        </details>
      )}
    </>
  )
}
