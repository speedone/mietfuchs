import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CostItem, HeatingPlant, HeatingSettlementInfo, Meter, NoticeSubject, PeriodKey, Settings, Settlement, Tenancy, Unit, UploadEntry } from '../types'
import { cockpitHeatingRows } from '../heatingSettlementView'
import { heatingRowTarget, itemsOfSettlement } from '../costPeriods'
import { localToday } from '../periodForm'
import { isNotAllocable, usageOf } from '../types'
import { cockpitSubtitle, itemsDetail, meterTypesInUse, tenanciesDetail, usesUnitBasis } from '../cockpitChecks'
import { coverageCheck, filesByItem } from '../receipts'
import { api, fmtEuro, fmtDate } from '../api'
import { andList } from '../../../shared/wording.ts'
import { hkvCutNotByConsumption } from '../../../shared/law/heizkostenv.ts'
import { LAW_AS_OF, valueAt } from '../../../shared/law/register.ts'
import { usePeriod, useSwitchPeriod } from '../period'
import { useProperty, withProperty } from '../property'
import { consentPending } from '../update'
import { heatingWithoutConsumption, meterReadiness } from '../meterCheck'
import { attentionDetail, attentionLevel } from '../notices'
import { missingAreaCheck, zeroAreaUnits } from '../unitForm'
import { UpdateConsent } from '../components/Update'

type Props = {
  units: Unit[]
  // Hält App je Objekt aktuell (beim Wechsel und nach jedem reload), wie für Stammdaten und Kosten.
  tenancies: Tenancy[]
  settings: Settings | null
  reload: () => Promise<void>
  onNavigate: (tab: string, focus?: NoticeSubject) => void
}

// Verbrauchsangaben des Servers (gleiche Form wie auf der Zähler-Seite)
type Consumption = { meterId: string; consumption: number; readingCount: number; warnings: string[] }

type Level = 'gruen' | 'gelb' | 'rot' | 'leer'

// Eine Zeile der Bereitschafts-Checkliste. `leer` = für dieses Haus nicht nötig (zählt nicht zum
// Fortschritt). `tab` verlinkt zur Stelle, an der man das Offene erledigt.
type Check = {
  title: string
  detail: string
  level: Level
  tab?: string
  cta?: string
  // Statt nur zur Seite zu wechseln (E45: erst in den Zeitraum der Heizkostenabrechnung)
  go?: () => void
}

// Ab dieser Abweichung zum Vorjahr gilt eine Kostenart als auffällig (wie in der Übersicht).
const NOTABLE_CHANGE_PCT = 25

export default function Cockpit({ units, tenancies, settings, reload, onNavigate }: Props) {
  const { key, label, param, at, period, calendar, rules } = usePeriod()
  const switchPeriod = useSwitchPeriod()
  const { property } = useProperty()
  const propertyId = property?.id
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  const [costItems, setCostItems] = useState<CostItem[]>([])
  const [meters, setMeters] = useState<Meter[]>([])
  const [consumption, setConsumption] = useState<Consumption[]>([])
  const [error, setError] = useState('')
  // Die Dateien im Belegordner, damit „Belege vollständig“ dasselbe sagt wie der Belegordner
  // (#170). Scheitert der Abruf, zählt der Verweis an der Position.
  const [uploadFiles, setUploadFiles] = useState<Set<string> | null>(null)
  const [bookedFiles, setBookedFiles] = useState<Map<string, string[]>>(new Map())
  // Heizung PR 5: die Heizkostenabrechnungen nach Weg d, jede mit ihrer eigenen Frist.
  const [heatingList, setHeatingList] = useState<HeatingSettlementInfo[]>([])
  // Die Anlagen sagen, in welchem Zeitraum eine Heizposition abgerechnet wird (E48, E32).
  const [plants, setPlants] = useState<HeatingPlant[]>([])

  const load = useCallback(() => {
    return Promise.all([
      api<Settlement>(withProperty(`/api/settlement/${param}`, propertyId)),
      api<CostItem[]>(withProperty('/api/costItems', propertyId)),
      api<Meter[]>(withProperty('/api/meters', propertyId)),
      api<Consumption[]>(withProperty(`/api/consumption/${param}`, propertyId)),
    ])
      .then(([s, c, m, k]) => { setSettlement(s); setCostItems(c); setMeters(m); setConsumption(k); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [param, propertyId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    api<HeatingSettlementInfo[]>(withProperty('/api/heating-settlements', propertyId)).then(setHeatingList).catch(() => setHeatingList([]))
    api<HeatingPlant[]>(withProperty('/api/heating-plants', propertyId)).then(setPlants).catch(() => setPlants([]))
  }, [propertyId])
  useEffect(() => {
    api<UploadEntry[]>('/api/uploads').then((list) => { setUploadFiles(new Set(list.map((u) => u.file))); setBookedFiles(filesByItem(list)) }, () => setUploadFiles(null))
  }, [param, propertyId])

  // ---------- Kennzahlen des Jahres ----------
  // Mit den Heizpositionen, deren Heizperiode in diesem Zeitraum endet, wie Kosten und Abrechnung.
  const yearItems = useMemo(() => itemsOfSettlement(costItems, key, rules, plants), [costItems, key, rules, plants])
  const itemsSum = useMemo(() => yearItems.reduce((a, c) => a + c.amountCents, 0), [yearItems])
  const invoiceFileCount = useMemo(() => new Set(yearItems.filter((c) => c.invoiceFile).map((c) => c.invoiceFile)).size, [yearItems])
  const participating = useMemo(() => units.filter((u) => u.participates), [units])

  // Vorjahresvergleich je Kostenart (wie in der Übersicht)
  const notable = useMemo(() => {
    const sumByCat = (key: PeriodKey) => {
      const m = new Map<string, number>()
      for (const c of itemsOfSettlement(costItems, key, rules, plants)) m.set(c.category, (m.get(c.category) ?? 0) + c.amountCents)
      return m
    }
    const cur = sumByCat(key)
    const prev = sumByCat(at.previous)
    if (prev.size === 0) return { hasPrev: false, list: [] as { cat: string; pct: number }[] }
    const list: { cat: string; pct: number }[] = []
    for (const [cat, k] of cur) {
      const p = prev.get(cat) ?? 0
      if (p === 0 || k === 0) continue
      const pct = ((k - p) / p) * 100
      if (Math.abs(pct) >= NOTABLE_CHANGE_PCT) list.push({ cat, pct })
    }
    return { hasPrev: true, list }
  }, [costItems, key, at.previous, rules, plants])

  // §556 Abs. 3 BGB: Zugang beim Mieter binnen 12 Monaten nach Ende des Abrechnungszeitraums. Die
  // Frist kommt vom Server (#208); vor dem Laden gibt es keine.
  const deadline = settlement?.deadline ?? null
  const daysLeft = deadline === null ? 0 : Math.ceil((Date.parse(`${deadline}T00:00:00Z`) - Date.now()) / 86400000)

  // ---------- Bereitschafts-Checkliste ----------
  const checks = useMemo<Check[]>(() => {
    if (!settlement) return []
    const list: Check[] = []

    // 1. Mietverhältnisse & Flächen
    // Auch die selbstgenutzte Wohnung braucht eine Fläche — ohne sie fällt ihr Eigenanteil
    // beim Flächenschlüssel stillschweigend weg.
    // 0 m² ohne Bewohner ist seit #135 eine Angabe (Garage, Stellplatz, Lager) und wird nur
    // genannt; 0 m² bei einer bewohnten Wohnung ist eine vergessene Fläche.
    const { zero: zeroArea, missing: noArea } = zeroAreaUnits(units, settlement.garageLikeUnitIds)
    // Mietverhältnisse ohne Abrechnung (Pauschale, Inklusivmiete, #93) zählen mit: Es gibt sie,
    // sie werden nur nicht abgerechnet.
    const ohneAbrechnung = settlement.notSettled ?? []
    const mietverhaeltnisse = settlement.statements.length + ohneAbrechnung.length
    if (mietverhaeltnisse === 0) {
      list.push({ title: 'Mietverhältnisse & Flächen', level: 'rot', tab: 'stammdaten', cta: 'Stammdaten prüfen',
        detail: `Keine Mietverhältnisse im ${calendar ? 'Jahr' : 'Zeitraum'} ${label} — ohne sie lässt sich nichts verteilen.` })
    } else if (noArea.length > 0) {
      // Bei einer leeren Einheit eine Frage statt eines Befehls (Endprüfung rc.4, missingAreaCheck).
      list.push({ title: 'Mietverhältnisse & Flächen', level: 'gelb', tab: 'stammdaten', ...missingAreaCheck(noArea, tenancies, period, yearItems) })
    } else {
      list.push({ title: 'Mietverhältnisse & Flächen', level: 'gruen',
        detail: tenanciesDetail(mietverhaeltnisse, ohneAbrechnung.length, participating.length, zeroArea.map((u) => u.name)) })
    }

    // 2. Belege & Kosten erfasst
    if (yearItems.length === 0) {
      list.push({ title: 'Belege erfasst', level: 'rot', tab: 'schnellerfassung', cta: 'Belege erfassen',
        detail: `Für ${label} sind noch keine Kosten erfasst.` })
    } else {
      list.push({ title: 'Belege erfasst', level: 'gruen',
        detail: itemsDetail(yearItems.length, itemsSum, invoiceFileCount) })
    }

    // 2b. Belege vollständig (#170): höchstens gelb, ein fehlender Beleg ändert keine Zahl
    const belege = coverageCheck(yearItems, uploadFiles, bookedFiles)
    list.push({ title: 'Belege vollständig', level: belege.level, detail: belege.detail,
      ...(belege.level === 'gelb' ? { tab: 'belege', cta: 'Belege nachreichen' } : {}) })

    // 3. Zählerstände — nur relevant, wenn verbrauchsabhängig umgelegt wird
    // Nicht umlagefähige Positionen zählen nicht mit (#142, cockpitChecks.ts).
    const meterTypes = meterTypesInUse(yearItems)
    const heatingIds = new Set(heatingWithoutConsumption(settlement))
    const heatingWithout = yearItems.filter((c) => heatingIds.has(c.id))
    if (meterTypes.size === 0 && heatingWithout.length > 0) {
      // #140: Heizung ohne Verbrauchsschlüssel. Ablesungen wären nötig, nicht entbehrlich.
      list.push({ title: 'Zählerstände', level: 'gelb', tab: 'kosten', cta: 'Heizkosten prüfen',
        detail: `${andList(heatingWithout.map((c) => `„${c.description}“`))} ${heatingWithout.length === 1 ? 'wird' : 'werden'} nicht nach Verbrauch verteilt. Die Heizkostenverordnung verlangt das (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV); sonst darf der Mieter seinen Anteil um ${valueAt(hkvCutNotByConsumption, LAW_AS_OF)} % kürzen. Nötig sind Ablesungen der Wärmezähler oder die Abrechnung des Messdienstes.` })
    } else if (meterTypes.size === 0) {
      list.push({ title: 'Zählerstände', level: 'leer',
        detail: 'Keine verbrauchsabhängige Umlage — Ablesungen nicht erforderlich.' })
    } else {
      const { relevant, incomplete } = meterReadiness(meters, consumption, meterTypes)
      if (incomplete.length > 0) {
        list.push({ title: 'Zählerstände', level: 'rot', tab: 'zaehler', cta: 'Stände erfassen',
          detail: `Anfang/Ende fehlt oder unplausibel bei: ${andList(incomplete.map((m) => m.name))}` })
      } else {
        list.push({ title: 'Zählerstände', level: 'gruen',
          detail: `${relevant.length} Zähler mit Anfangs- und Endstand erfasst.` })
      }
    }

    // 4. Verteilbasis: ausgenommene Wohnungen mit Wohnfläche sind fast immer ein Versehen.
    // Kosten für das ganze Haus dürfen nur anteilig auf die Mieter umgelegt werden — eine
    // selbstgenutzte Wohnung gehört deshalb als „Eigennutzung“ in die Basis.
    // Nur relevant, wenn im Jahr überhaupt ein Schlüssel vorkommt, dessen Basis die Wohnungen
    // bilden — bei reiner Verbrauchs- oder Direktumlage ändert die Nutzungsart nichts.
    // Auch die Gemeinschaftsabrechnung (#105): Sie verteilt über die Wohnungen der Einheit.
    const basisKeys = usesUnitBasis(yearItems)
    // Wohnungen, die an einer Position „laut Gemeinschaftsabrechnung“ nach MEA teilnehmen, und
    // denen die Anteile fehlen; wie in der Berechnung nur die Teilnehmer (Durchsicht zu #105).
    const meaIds = new Set(
      yearItems
        .filter((c) => c.key === 'external' && c.externalBasis?.measure === 'mea' && !isNotAllocable(c.category))
        .flatMap((c) => c.participantUnitIds ?? units.filter((u) => usageOf(u) !== 'ausgenommen').map((u) => u.id)),
    )
    const meaMissing = units.filter((u) => meaIds.has(u.id) && usageOf(u) !== 'ausgenommen' && !(u.mea && u.mea > 0))
    const excluded = units.filter((u) => usageOf(u) === 'ausgenommen' && u.areaM2 > 0)
    if (excluded.length > 0 && basisKeys) {
      list.push({ title: 'Verteilbasis', level: 'gelb', tab: 'stammdaten', cta: 'Nutzung prüfen',
        detail: `Nicht beteiligt und damit ganz außen vor: ${andList(excluded.map((u) => u.name))} — die Mieter tragen deren Anteil mit. Selbst bewohnte Wohnungen bitte auf „Eigennutzung“ stellen.` })
    } else if (meaMissing.length > 0) {
      // Ohne Miteigentumsanteile verteilt der Schlüssel der Gemeinschaft nicht (#105).
      const ohne = meaMissing
      list.push({ title: 'Verteilbasis', level: 'gelb', tab: 'stammdaten', cta: 'Anteile eintragen',
        detail: `Für ${andList(ohne.map((u) => u.name))} fehlen die Miteigentumsanteile, die die Gemeinschaftsabrechnung braucht.` })
    } else if (units.some((u) => usageOf(u) === 'eigen')) {
      const selfUsedUnits = units.filter((u) => usageOf(u) === 'eigen')
      list.push({ title: 'Verteilbasis', level: 'gruen',
        detail: `Eigennutzung in der Basis: ${andList(selfUsedUnits.map((u) => u.name))} — der Eigenanteil bleibt beim Vermieter.` })
    }

    // 5. Plausibilität zum Vorjahr
    if (yearItems.length === 0) {
      list.push({ title: 'Plausibilität zum Vorjahr', level: 'leer', detail: 'Noch keine Kosten zum Vergleichen.' })
    } else if (!notable.hasPrev) {
      list.push({ title: 'Plausibilität zum Vorjahr', level: 'leer', detail: `Kein Vorjahr (${at.previousLabel}) zum Vergleichen erfasst.` })
    } else if (notable.list.length > 0) {
      const txt = notable.list
        .map((a) => `${a.cat} (${a.pct > 0 ? '+' : ''}${Math.round(a.pct)} %)`)
        .join(', ')
      list.push({ title: 'Plausibilität zum Vorjahr', level: 'gelb', tab: 'uebersicht', cta: 'Vergleich ansehen',
        detail: `Auffällige Abweichung: ${txt} — Beleg prüfen, Mieter ggf. erklären.` })
    } else {
      list.push({ title: 'Plausibilität zum Vorjahr', level: 'gruen', detail: `Keine auffälligen Sprünge gegenüber ${at.previousLabel}.` })
    }

    // 6. Hinweise der Berechnung (z. B. negativer Verbrauch)
    if (settlement.warnings.length > 0) {
      list.push({ title: 'Hinweise der Berechnung', level: attentionLevel(settlement), tab: 'abrechnung', cta: 'Abrechnung ansehen',
        detail: attentionDetail(settlement) })
    }

    // 7. Abschluss & Versand
    const closed = settlement.closed
    if (settlement.statements.length === 0 && (settlement.notSettled ?? []).length > 0) {
      // Nur Pauschale oder Inklusivmiete (#93): Es gibt keine Abrechnung, also auch keine Frist.
      list.push({ title: 'Abgeschlossen & versendet', level: 'gruen',
        detail: 'Keine Abrechnung nötig: Alle Mietverhältnisse haben eine Pauschale oder Inklusivmiete.' })
    } else if (closed?.sentAt) {
      const ok = closed.sentAt <= settlement.deadline
      list.push({ title: 'Abgeschlossen & versendet', level: ok ? 'gruen' : 'rot',
        detail: `Versendet am ${fmtDate(closed.sentAt)} — Frist nach §556 BGB ${ok ? 'gewahrt' : 'überschritten'}.` })
    } else if (closed) {
      list.push({ title: 'Abgeschlossen & versendet', level: 'gelb', tab: 'abrechnung', cta: 'Versanddatum eintragen',
        detail: 'Abgeschlossen, aber Versanddatum fehlt — für die §556-Frist nachtragen.' })
    } else {
      const deadlineText = daysLeft >= 0
        ? `Noch ${daysLeft} Tage bis zur Frist (${fmtDate(settlement.deadline)}).`
        : `Frist am ${fmtDate(settlement.deadline)} abgelaufen.`
      list.push({ title: 'Abgeschlossen & versendet', level: daysLeft < 0 ? 'rot' : 'gelb', tab: 'abrechnung', cta: 'Zur Abrechnung',
        detail: `Noch im Entwurf. ${deadlineText}` })
    }
    // Jede beendete Heizperiode nach Weg d mit ihrer eigenen Frist (Heizung PR 5, Entwurf 3.1, B3).
    // „Zur Abrechnung“ wechselt dabei in den Zeitraum, in dem die Heizperiode endet, und wählt dort
    // die Heizkostenabrechnung (E45); im gewählten Zeitraum ist sie oft gar nicht wählbar.
    for (const row of cockpitHeatingRows(heatingList, localToday())) {
      const h = heatingList.find((x) => `${x.plantId}|${x.period.key}` === row.key)
      const go = h ? () => {
        const t = heatingRowTarget(h, rules)
        void switchPeriod(t.period).then((ok) => { if (ok) onNavigate('abrechnung', t.focus) })
      } : undefined
      list.push({ title: row.label, level: row.level, detail: row.text, ...(row.level === 'gruen' ? {} : { tab: 'abrechnung', cta: 'Zur Abrechnung', go }) })
    }

    return list
  }, [heatingList, rules, switchPeriod, onNavigate, settlement, participating, units, yearItems, itemsSum, invoiceFileCount, meters, consumption, tenancies, notable, daysLeft, label, calendar, period, at.previousLabel, uploadFiles, bookedFiles])

  const relevant = checks.filter((c) => c.level !== 'leer')
  const greenCount = relevant.filter((c) => c.level === 'gruen').length
  const pct = relevant.length ? Math.round((greenCount / relevant.length) * 100) : 0
  // Nächster Schritt: erst rote, dann gelbe offene Punkte
  const next = checks.find((c) => c.level === 'rot' && c.tab) ?? checks.find((c) => c.level === 'gelb' && c.tab)
  const openCount = relevant.length - greenCount

  const statusBadge = settlement?.closed?.sentAt
    ? <span className="badge green">versendet</span>
    : settlement?.closed
      ? <span className="badge green">abgeschlossen</span>
      : <span className="badge gray">Entwurf</span>

  const distributed = settlement ? settlement.totalCostsCents - settlement.landlord.totalCents : 0
  const fresh = settlement && settlement.statements.length === 0 && yearItems.length === 0

  return (
    <>
      <div className="statement-head">
        <div>
          <h1 style={{ marginBottom: 2 }}>Abrechnung {label}</h1>
          <p className="sub" style={{ margin: 0 }}>
            {cockpitSubtitle({ loaded: !!settlement, fresh: !!fresh, openCount })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {statusBadge}
          {settlement && !settlement.closed && (
            <span className={`badge ${daysLeft < 0 ? 'red' : daysLeft < 90 ? 'gray' : 'gray'}`}>
              {daysLeft >= 0 ? `Frist in ${daysLeft} Tagen` : 'Frist abgelaufen'}
            </span>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {consentPending(settings) && <UpdateConsent onAnswered={reload} />}

      {fresh ? (
        <div className="card">
          <div className="empty">
            <p>Noch nichts für {label} erfasst. So fangen Sie an:</p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn secondary" onClick={() => onNavigate('stammdaten')}>🏠 Stammdaten anlegen</button>
              <button className="btn" onClick={() => onNavigate('schnellerfassung')}>📥 Belege zur Schnellerfassung</button>
            </div>
          </div>
        </div>
      ) : settlement && (
        <>
          {/* Fortschritt */}
          <div className="card">
            <div className="row" style={{ alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ flex: 1 }}>Fertigstellung</strong>
              <span className="muted">{greenCount} von {relevant.length} erledigt</span>
            </div>
            <div className="progress"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>

            <div className="checklist">
              {checks.map((c, i) => {
                const clickable = c.level !== 'gruen' && c.level !== 'leer' && c.tab
                return (
                  <div
                    key={i}
                    className={`check-row ${c.level}${clickable ? ' clickable' : ''}`}
                    onClick={clickable ? () => (c.go ? c.go() : onNavigate(c.tab!)) : undefined}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === 'Enter') (c.go ? c.go() : onNavigate(c.tab!)) } : undefined}
                  >
                    <span className={`ampel ${c.level === 'leer' ? '' : c.level}`} style={c.level === 'leer' ? { background: 'var(--line)' } : undefined} />
                    <div className="grow">
                      <div className="check-title">{c.title}</div>
                      <div className="muted">{c.detail}</div>
                    </div>
                    {clickable && <span className="check-cta">{c.cta} →</span>}
                  </div>
                )
              })}
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              {next ? (
                <button className="btn" onClick={() => (next.go ? next.go() : onNavigate(next.tab!))}>→ Nächster Schritt: {next.cta}</button>
              ) : (
                <button className="btn" onClick={() => onNavigate('abrechnung')}>✓ Zur Abrechnung — abschließen & versenden</button>
              )}
              <button className="btn ghost" onClick={() => onNavigate('uebersicht')}>Kostenvergleich</button>
            </div>
          </div>

          {/* Kennzahlen */}
          <div className="kpis">
            <div className="kpi">
              <div className="v">{fmtEuro(settlement.totalCostsCents)}</div>
              <div className="l">Gesamtkosten {label}</div>
            </div>
            <div className="kpi">
              <div className="v">{fmtEuro(distributed)}</div>
              <div className="l">auf Mieter umgelegt</div>
            </div>
            <div className="kpi">
              <div className="v">{fmtEuro(settlement.landlord.totalCents)}</div>
              <div className="l">Vermieteranteil</div>
            </div>
          </div>

          {/* Ergebnis je Mieter */}
          {settlement.statements.length > 0 && (
            <div className="card">
              <h2>Voraussichtliches Ergebnis je Mieter</h2>
              {/* Ohne Kosten im Jahr erstattete die Berechnung jedem die volle Vorauszahlung (#142);
                  das ist kein voraussichtliches Guthaben, sondern ein noch leeres Jahr. */}
              {yearItems.length === 0 ? (
                <div className="empty">Noch keine Kosten für {label} erfasst — ein voraussichtliches Ergebnis gibt es, sobald Kosten da sind.</div>
              ) : (
              <div className="tenant-cards">
                {settlement.statements.map((st) => {
                  const isCredit = st.balanceCents >= 0
                  return (
                    <button key={st.tenancyId} className="tenant-card" onClick={() => onNavigate('abrechnung')}>
                      <div className="muted">{st.unitName} · {st.tenantName}</div>
                      <div className="tenant-bal" style={{ color: isCredit ? 'var(--green)' : 'var(--red)' }}>
                        {fmtEuro(Math.abs(st.balanceCents))}
                      </div>
                      <div className="muted">{isCredit ? 'Guthaben' : 'Nachzahlung'}</div>
                    </button>
                  )
                })}
                {units.filter((u) => !u.participates).map((u) => (
                  <div key={u.id} className="tenant-card muted-card">
                    <div className="muted">{u.name}</div>
                    <div className="tenant-bal" style={{ color: 'var(--muted)' }}>—</div>
                    <div className="muted">{usageOf(u) === 'eigen' ? 'selbst bewohnt' : 'nicht beteiligt'}</div>
                  </div>
                ))}
              </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
