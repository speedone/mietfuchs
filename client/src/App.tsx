import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CostItem, HeatingPlant, NoticeSubject, Settings, Tenancy, Unit } from './types'
import { api } from './api'
import { PeriodProvider, usePeriod, useSwitchTo } from './period'
import { PeriodSelect } from './components/PeriodSelect'
import { PropertyProvider, PropertySwitcher, useProperty, useSwitchProperty, withProperty } from './property'
import { UIProvider, useConfirm, useToast } from './components/feedback'
import { NewPropertyProvider, useOpenNewProperty } from './components/NewPropertyDrawer'
import FoxLogo from './components/Logo'
import { UpdateHint, useUpdateStatus } from './components/Update'
import DatabaseNotice from './components/Database'
import PropertyNotice from './components/PropertyNotice'
import { emptyPropertyNotice, propertyName } from './propertyView'
import { canQuit, hintVisible } from './update'
import Cockpit from './pages/Cockpit'
import Uebersicht from './pages/Uebersicht'
import Stammdaten from './pages/Stammdaten'
import Kosten from './pages/Kosten'
import Mietkonto from './pages/Mietkonto'
import Zaehler from './pages/Zaehler'
import Belege from './pages/Belege'
import Abrechnung from './pages/Abrechnung'
import Hilfe from './pages/Hilfe'
import { keepIfEqual, type HelpStock } from './helpSuggestions'
import Verlauf from './pages/Verlauf'
import Steuer from './pages/Steuer'
import Einstellungen from './pages/Einstellungen'
import { navFor, splitTarget, tabLabel, type BelegeView, type NavTarget, type Tab } from './nav'
import { periodKeyOfYear, placeOf, readView, writeView } from './belegeView'
import { rulesOf } from '../../shared/period.ts'
import type { ReceiptStart } from './receiptForm'
import MobileNav, { MOBILE_QUERY, useMediaQuery } from './components/MobileNav'
import Heizkosten from './pages/Heizkosten'
import { TermHelp } from './components/Term'
import GuideThread from './components/GuideThread'
import type { TermId } from '../../shared/glossary.ts'
import { GUIDES, type GuideId } from '../../shared/guides.ts'
import Muster from './pages/Muster'
import { EvaluationQueueProvider, useEvaluationQueueStore } from './evaluationQueue'

// Der Faden einer Anleitung: welcher Schritt welcher Anleitung gerade befolgt wird (#488, PR 2).
type GuideThreadState = { guide: GuideId; step: number }

// Den Fokus auf den Titel der Seite setzen, ohne zu rollen; der Titel wird dafür fokussierbar (nicht per Tab).
function focusPageTitle() {
  const title = document.querySelector<HTMLElement>('main h1')
  if (!title) return
  title.tabIndex = -1
  title.focus({ preventScroll: true })
}

// ---------- Dark Mode ----------
type ThemeChoice = 'system' | 'light' | 'dark'
const THEME_LABELS: Record<ThemeChoice, string> = { system: 'System', light: 'Hell', dark: 'Dunkel' }

function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(
    () => (localStorage.getItem('nka-theme') as ThemeChoice) || 'system',
  )
  useEffect(() => {
    localStorage.setItem('nka-theme', choice)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = choice === 'system' ? (mq.matches ? 'dark' : 'light') : choice
      document.documentElement.dataset.theme = resolved
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [choice])
  const cycle = () =>
    setChoice((c) => (c === 'system' ? 'light' : c === 'light' ? 'dark' : 'system'))
  return { choice, cycle }
}

// Beenden aus der Oberfläche (#45). Nur sichtbar, wenn Mietfuchs als Programmdatei läuft: Aus
// einem Linux-Paket gibt es kein Konsolenfenster, dessen Schließen sonst der Weg dorthin ist.
function QuitButton({ onQuit }: { onQuit: () => void }) {
  const confirm = useConfirm()
  const toast = useToast()
  const [stopping, setStopping] = useState(false)

  async function stop() {
    const ok = await confirm({
      title: 'Mietfuchs beenden?',
      message: 'Die Oberfläche lässt sich danach nicht mehr bedienen, bis Sie Mietfuchs neu starten. Ihre Daten bleiben gespeichert.',
      confirmLabel: 'Beenden',
    })
    if (!ok) return
    setStopping(true)
    try {
      await api('/api/quit', { method: 'POST' })
      onQuit()
    } catch (e) {
      // Bricht die Verbindung ab, während der Server sich beendet, ist das kein Fehler
      onQuit()
      void e
    }
  }

  return (
    <button className="theme-toggle" onClick={stop} disabled={stopping} title="Mietfuchs beenden">
      ⏻ {stopping ? 'Wird beendet …' : 'Mietfuchs beenden'}
    </button>
  )
}

// Nach dem Beenden bleibt die Seite im Browser stehen. Ohne Erklärung sähe sie aus wie eine
// kaputte Anwendung.
function Stopped() {
  return (
    <main className="stopped">
      <div className="card">
        <h1>Mietfuchs ist beendet</h1>
        <p>Dieses Fenster kann geschlossen werden. Ihre Daten sind gespeichert.</p>
        <p className="muted">Zum Weiterarbeiten Mietfuchs neu starten, etwa über den Eintrag im Startmenü.</p>
      </div>
    </main>
  )
}

// Geschlossene Hinweise „noch keine Wohnungen“ (#157), gemerkt je Browser wie das gewählte
// Objekt. Ohne Speicher (privates Fenster) erscheint ein geschlossener Hinweis beim nächsten
// Öffnen wieder, was nichts kaputt macht.
const DISMISSED_KEY = 'mietfuchs.property.dismissedNotices'
function readDismissedNotices(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function writeDismissedNotices(ids: string[]): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids))
  } catch {
    // Ohne Speicher gilt das Schließen nur bis zum Neuladen.
  }
}

function Shell() {
  const [tab, setTabState] = useState<Tab>('cockpit')
  // Der Eintrag, den „Hier beheben →“ auf der Zielseite öffnen soll (#142). Jeder andere
  // Seitenwechsel löscht ihn, und die Seite meldet, wenn sie ihn geöffnet hat.
  const [focus, setFocus] = useState<NoticeSubject | null>(null)
  // Der Faden einer Anleitung (#488, PR 2): Anleitung und Schritt, denen man gerade folgt. Gesetzt vom Sprung aus der
  // Anleitung und von „Nächster Schritt“, in einem Zug mit der Seite, damit die Leiste zwischen zwei Schritten nicht
  // kurz verschwindet und den Fokus verliert. Beendet nur von der Navigation (Seitenleiste, Menüblatt, untere Leiste),
  // von „Zurück zur Anleitung“ und „Leiste schließen“. Sprünge aus dem Seiteninhalt („Hier beheben →“, „Mehr in ‚Hilfe &
  // Begriffe‘ →“) behalten ihn, ebenso der Wechsel von Objekt und Zeitraum: Die Anleitung gilt fürs Vorgehen, nicht für
  // ein Objekt oder Jahr (Durchsicht von PR 2, K1 und K2). `undefined` heißt beim Seitenwechsel: Faden behalten.
  const [thread, setThread] = useState<GuideThreadState | null>(null)
  const setTab = useCallback((t: Tab, f: NoticeSubject | null = null, th?: GuideThreadState | null) => {
    setFocus(f)
    setTabState(t)
    if (th !== undefined) setThread(th)
  }, [])
  const clearFocus = useCallback(() => setFocus(null), [])
  const [stopped, setStopped] = useState(false)
  // Die offene Ansicht der Seite Belege (#490), gemerkt je Sitzung: Die Seitenleiste öffnet die zuletzt benutzte.
  const [belegeView, setBelegeViewState] = useState<BelegeView>(readView)
  const setBelegeView = useCallback((v: BelegeView) => { writeView(v); setBelegeViewState(v) }, [])
  // Der Beleg, zu dem die Seite Belege springen soll (Fehler mit Ausweg, #487)
  const [receiptFocus, setReceiptFocus] = useState<string | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  // Zu welchem Objekt `units` gehört (#157): Bis die Wohnungen eines eben gewählten Objekts da
  // sind, stehen noch die des vorigen hier.
  const [unitsFor, setUnitsFor] = useState<string | null>(null)
  // Wohnungen je Objekt beim letzten Laden (#157): Der Hinweis im leeren Objekt sagt nur dann
  // „Ihre Daten … sind unverändert“, wenn das vorige Objekt beim Wechsel Wohnungen hatte.
  const [unitCounts, setUnitCounts] = useState<Record<string, number>>({})
  // Objekte, deren Hinweis „noch keine Wohnungen“ geschlossen wurde, gemerkt je Browser
  const [dismissedNotices, setDismissedNotices] = useState<string[]>(readDismissedNotices)
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const { choice, cycle } = useTheme()
  // Der gewählte Abrechnungszeitraum (#208); die Seiten werden bei seinem Wechsel neu aufgestellt.
  const { key: periodKeyNow, label: periodLabelNow, year: periodYear, period: periodNow, calendar: periodCalendar } = usePeriod()
  // Unter 900 px Kopf, Menüblatt und untere Leiste statt der Seitenleiste (#346, Schritt 9)
  const mobile = useMediaQuery(MOBILE_QUERY)
  const { properties, property, previousId, focusNoticeFor, setFocusNoticeFor, reload: reloadProperties, hasOpenForm } = useProperty()
  // Wechselt die Breite über die Grenze, wird die eine Navigation ausgehängt und die andere gezeichnet;
  // lag der Fokus in der ausgehängten (etwa im offenen Menüblatt), stünde er danach auf <body>. Er geht
  // dann an die aktuelle Seite in der Seitenleiste bzw. an ☰.
  const wasMobile = useRef(mobile)
  useEffect(() => {
    if (wasMobile.current === mobile) return
    wasMobile.current = mobile
    const active = document.activeElement
    if (active && active !== document.body) return
    document.querySelector<HTMLElement>(mobile ? 'button.menu-toggle' : 'nav.sidebar [aria-current="page"]')?.focus()
  }, [mobile])
  const switchProperty = useSwitchProperty()
  const openNewProperty = useOpenNewProperty()
  const confirmLeave = useConfirm()
  // Jeder Seitenwechsel fragt wie der Wechsel von Objekt und Zeitraum, wenn ein Formular offen oder eine
  // Änderung ungespeichert ist (#346, Schritt 7a): App.tsx stellt die Seite neu auf, und die Eingabe wäre
  // still weg. Das gilt für die Navigation (Seitenleiste, Menüblatt, untere Leiste) wie für Sprünge aus
  // einer Seite („Hier beheben →“, „Position öffnen“, „Weiter prüfen“, die Anleitung zum Update).
  // Startfokus auf „Abbrechen“. Ergibt, ob gewechselt wurde.
  // Ein Ziel kann eine Ansicht der Seite Belege nennen (`belege:eingang`, nav.ts); der Wechsel der Ansicht allein fragt
  // nicht, denn beide Ansichten bleiben eingehängt.
  const navigate = useCallback(async (target: NavTarget, f: NoticeSubject | null = null, th?: GuideThreadState | null): Promise<boolean> => {
    const { tab: t, view } = splitTarget(target)
    if (t !== tab && hasOpenForm()) {
      const ok = await confirmLeave({
        title: 'Ungespeicherte Änderungen verwerfen?',
        message: `Auf dieser Seite ist ein Formular offen oder eine Änderung noch nicht gespeichert. Beim Wechsel zu „${tabLabel(t)}“ geht sie verloren.`,
        confirmLabel: 'Verwerfen',
        cancelLabel: 'Abbrechen',
        danger: true,
      })
      if (!ok) return false
    }
    if (view) setBelegeView(view)
    setTab(t, f, th)
    return true
  }, [tab, hasOpenForm, confirmLeave, setTab, setBelegeView])
  // Die Navigation selbst (Seitenleiste, Menüblatt, untere Leiste) beendet den Faden.
  const navigateFromNav = useCallback((t: NavTarget) => navigate(t, null, null), [navigate])
  // Nach dem Sprung aus der Anleitung steht der Fokus auf dem Titel der Zielseite (Durchsicht von PR 2, S1); `seq`
  // zählt die Sprünge, der Effekt läuft, wenn die neue Seite gezeichnet ist.
  const [titleFocus, setTitleFocus] = useState(0)
  useEffect(() => { if (titleFocus > 0) focusPageTitle() }, [titleFocus])
  // „Zu {Seite} →“ in einer Anleitung und „Nächster Schritt“ im Faden: auf die Seite des Schritts, mit dem Faden. Eine
  // neue Seite beginnt oben, nicht auf der Höhe, auf der die Anleitung stand. Aus der Leiste bleibt der Fokus dort.
  const followStep = useCallback(async (guide: GuideId, step: number, focusTitle = false): Promise<boolean> => {
    const s = GUIDES[guide].steps[step]
    const page = s?.page
    if (!page) return false
    // Ein Schritt auf der Seite Belege kann die Ansicht nennen (Eingang oder Ordner, #490)
    const done = await navigate(page === 'belege' && s.view ? `belege:${s.view}` : page, null, { guide, step })
    if (done && page !== tab) window.scrollTo(0, 0)
    if (done && focusTitle) setTitleFocus((n) => n + 1)
    return done
  }, [navigate, tab])
  // „Zurück zur Anleitung“: in die Hilfe, die die Anleitung öffnet und den Fokus auf den Schritt setzt.
  const [helpGuide, setHelpGuide] = useState<{ id: GuideId; step: number; seq: number } | null>(null)
  const backToGuide = useCallback(() => {
    if (!thread) return
    const { guide, step } = thread
    void navigate('hilfe', null, null).then((done) => { if (done) setHelpGuide((h) => ({ id: guide, step, seq: (h?.seq ?? 0) + 1 })) })
  }, [navigate, thread])
  // „Leiste schließen“: Die Leiste verschwindet mit dem Knopf, der den Fokus hatte; ohne Ziel stünde er danach auf
  // <body>, und die Tabulatortaste begänne wieder oben in der Seitenleiste. Er geht deshalb an den Titel der Seite, der
  // dafür `tabIndex = -1` bekommt (Durchsicht von PR 2, K4).
  const closeThread = useCallback(() => {
    setThread(null)
    focusPageTitle()
  }, [])
  // „Mehr in ‚Hilfe & Begriffe‘ →“ aus einer Begriffserklärung (#346, Schritt 6): über `navigate`, also mit der
  // Rückfrage bei offenem Formular; die Hilfe rollt dann zum Begriff.
  const [helpTerm, setHelpTerm] = useState<{ id: TermId; seq: number } | null>(null)
  const openHelp = useCallback((id: TermId) => {
    void navigate('hilfe').then((done) => { if (done) setHelpTerm((h) => ({ id, seq: (h?.seq ?? 0) + 1 })) })
  }, [navigate])
  // Schließen oder Neuladen des Tabs mit offenem Formular: Der Browser fragt mit seinem eigenen Satz nach. Ebenso,
  // solange eine KI-Auswertung läuft oder wartet oder ein erkannter Zählerstand nicht übernommen ist (#490): Wartende
  // Belege sind noch nicht hochgeladen, die laufende bricht ab, und der Zählerstand steht nur im Browser.
  const evaluations = useEvaluationQueueStore()
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!hasOpenForm() && !evaluations?.unsaved()) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [hasOpenForm, evaluations])
  // Ausgewertet wird im Objekt, dem der Beleg zugedacht ist; ohne Zuordnung im gewählten.
  // Wechselt dabei das Objekt, hat dessen Rückfrage schon gefragt (die Seite wird ohnehin neu aufgestellt);
  // sonst fragt der Seitenwechsel.
  const goViaProperty = async (target: string | null | undefined, t: Tab, f: NoticeSubject | null = null): Promise<boolean> => {
    if (target && target !== property?.id) {
      if (!(await switchProperty(target))) return false
      setTab(t, f)
      return true
    }
    return navigate(t, f)
  }
  // Fehler mit Ausweg (#487): ein gespeicherter Beleg auf der Seite Belege (ohne Position im Eingang, sonst im
  // Ordner), bzw. die KI-Einstellungen
  const openReceipt = (file: string) => {
    void navigate('belege').then((done) => { if (done) setReceiptFocus(file) })
  }
  const openAiSettings = () => { void navigate('einstellungen') }
  // Ein Zählerfoto, dessen Ablesen gescheitert ist: die Ablesung von Hand auf der Seite Zähler
  const openMeters = () => { void navigate('zaehler') }
  // „Position öffnen“ von der Seite Belege: Die zeigt alle Objekte, die Seite Kosten nur das
  // gewählte. Gehört die Position zu einem anderen, wird erst umgeschaltet, wie oben.
  const openCostItem = async (item: CostItem) => {
    await goViaProperty(item.propertyId, 'kosten', { kind: 'costItem', id: item.id })
  }
  // „Von Hand erfassen“ an einem gespeicherten Beleg (#490 PR 3, #487 Teil 2): auf die Seite Kosten, in Objekt und Zeitraum
  // des Belegs (ein Beleg ohne Zuordnung bleibt im gewählten), und dort das Formular „Neue Kostenposition“ mit dem Beleg.
  // Wechselt dabei das Objekt oder der Zeitraum, hat dessen Rückfrage schon gefragt; sonst fragt der Seitenwechsel.
  const switchTo = useSwitchTo()
  const toastShell = useToast()
  const [receiptStart, setReceiptStart] = useState<ReceiptStart | null>(null)
  const openNewCostItem = async (u: ReceiptStart) => {
    const there = placeOf(u, { propertyId: properties.length > 1 ? property?.id ?? null : null, year: periodYear })
    const dest = there ? properties.find((p) => p.id === (there.propertyId ?? property?.id)) : undefined
    // Gehört der Beleg einem Objekt, das es nicht mehr gibt, nicht still ins gewählte (Durchsicht K1)
    if (there && !dest) {
      toastShell(`„${u.originalName || u.file}“ gehört zu einem Objekt, das es nicht mehr gibt. Ordnen Sie ihn auf der Seite Belege einem Objekt zu.`, 'error')
      return
    }
    if (there && dest) {
      if (!(await switchTo(there.propertyId ?? undefined, periodKeyOfYear(rulesOf(dest), there.year ?? periodYear)))) return
      setTab('kosten')
      setReceiptStart(u)
      return
    }
    if (await navigate('kosten')) setReceiptStart(u)
  }
  const update = useUpdateStatus(settings)
  const propertyId = property?.id
  // Das zuletzt gewählte Objekt, für den Reihenfolge-Schutz in reload (#145)
  const currentProperty = useRef(propertyId)
  currentProperty.current = propertyId

  // Wohnungen und Mietverhältnisse des gewählten Objekts (#92). Solange die Objekte noch nicht
  // geladen sind, wird gewartet: Ohne Angabe gälte auf dem Server bei mehreren Objekten keins.
  const reload = useCallback(async () => {
    const [u, t, s] = await Promise.all([
      propertyId ? api<Unit[]>(withProperty('/api/units', propertyId)) : Promise.resolve([]),
      propertyId ? api<Tenancy[]>(withProperty('/api/tenancies', propertyId)) : Promise.resolve([]),
      api<Settings>('/api/settings'),
      reloadProperties(),
    ])
    // Wechselt das Objekt schnell hin und her (A → B → A), kann die Antwort für B nach der für A
    // ankommen. Sie gilt dann nicht mehr, sonst stünden Wohnungen von B unter A.
    if (currentProperty.current !== propertyId) return
    setUnits(u)
    setUnitsFor(propertyId ?? null)
    if (propertyId) setUnitCounts((c) => ({ ...c, [propertyId]: u.length }))
    setTenancies(t)
    setSettings(s)
  }, [propertyId, reloadProperties])

  useEffect(() => {
    reload().catch((e) => console.error(e))
  }, [reload])

  // Die Seite Heizkosten erscheint erst mit einer Heizanlage (Heizung PR 6, Entwurf 11.4). Neu
  // gefragt wird bei jedem Seitenwechsel, so erscheint sie, sobald die Anlage in den Stammdaten
  // angelegt ist.
  // Die Liste selbst braucht „Passend zu Ihrem Bestand“ in der Hilfe (#488, Teil 4).
  const [heatingPlants, setHeatingPlants] = useState<HeatingPlant[]>([])
  const hasHeatingPlant = heatingPlants.length > 0
  useEffect(() => {
    if (!propertyId) {
      setHeatingPlants((prev) => keepIfEqual(prev, []))
      return
    }
    let current = true
    api<HeatingPlant[]>(withProperty('/api/heating-plants', propertyId))
      .then((list) => { if (current) setHeatingPlants((prev) => keepIfEqual(prev, list)) })
      .catch(() => { if (current) setHeatingPlants((prev) => keepIfEqual(prev, [])) })
    return () => { current = false }
  }, [propertyId, tab])

  // Der Bestand für „Passend zu Ihrem Bestand“: das gewählte Objekt mit seinen Wohnungen, Mietverhältnissen und
  // Heizanlagen im gewählten Zeitraum. Solange die Wohnungen eines anderen Objekts geladen sind, keiner; und nur auf
  // der Hilfe, sonst braucht ihn niemand.
  const helpStock = useMemo<HelpStock | null>(() => (tab === 'hilfe' && property && unitsFor === property.id ? {
    properties, property, units, tenancies, plants: heatingPlants,
    period: { from: periodNow.from, to: periodNow.to, label: periodLabelNow, calendar: periodCalendar },
  } : null), [tab, properties, property, unitsFor, units, tenancies, heatingPlants, periodNow, periodLabelNow, periodCalendar])

  const contextLine = [property ? propertyName(property) : null, periodLabelNow].filter(Boolean).join(' · ')

  const clearNoticeFocus = useCallback(() => setFocusNoticeFor(null), [setFocusNoticeFor])

  if (stopped) return <Stopped />

  const emptyNotice = emptyPropertyNotice({
    properties, property, previousId, unitsFor, unitCount: units.length,
    previousUnitCount: previousId ? unitCounts[previousId] ?? null : null, dismissed: dismissedNotices,
  })
  const dismissNotice = (id: string) => setDismissedNotices((d) => {
    const next = [...d, id]
    writeDismissedNotices(next)
    return next
  })

  // Der Inhalt der Seitenleiste, am Rechner als Leiste, am Handy im Menüblatt (#346, Schritt 9):
  // dieselbe Navigation aus nav.ts, dieselbe Auswahl von Objekt und Zeitraum. Im Blatt (`close`
  // gesetzt) schließt die Wahl einer Seite es; der Hinweis auf ein Update fehlt dort, aktualisiert wird
  // am Rechner.
  const sidebar = (close: (() => void) | null) => {
    // Objekt und Zeitraum wechseln im Blatt, ohne es zu schließen, wie in der Seitenleiste: Mit den
    // Pfeiltasten sendet ein Auswahlfeld bei jedem Schritt `change`, und ein Blatt, das sich dabei
    // schlösse, ließe nur den nächsten Eintrag erreichen. Eine Rückfrage (offenes Formular) liegt seit
    // #346 Schritt 1 im Top-Layer über dem Blatt; es bleibt dafür offen, und nach Abbrechen steht man,
    // wo man war. Eine Seite im Blatt schließt es, sobald der Wechsel feststeht.
    return (
    <>
      <div className="logo">
        <FoxLogo size={30} />
        <div className="logo-text">
          Mietfuchs
          <small>{property?.name || 'Nebenkosten im Griff'}</small>
        </div>
        {close && <button type="button" className="sheet-close" aria-label="Menü schließen" onClick={close}>✕</button>}
      </div>

      {/* Oben statt im Fuß: Der Fuß liegt auf kleinen Bildschirmen und langen Seiten
          außer Sicht. */}
      {!close && update.status && hintVisible(update.status, settings) && (
        <UpdateHint status={update.status} onDismissed={reload} onShowGuide={() => void navigate('einstellungen')} />
      )}

      {/* Das „+“ öffnet dasselbe Fenster wie die Karte „Weitere Objekte“; am Handy schließt erst das Menüblatt. */}
      <PropertySwitcher properties={properties} value={propertyId} onChange={(id) => void switchProperty(id)}
        onCreate={openNewProperty ? () => { close?.(); openNewProperty() } : undefined} className="px-2.5 pb-3" />

      <PeriodSelect className="px-2.5 pb-3" />

      {navFor(hasHeatingPlant).map((group, gi) => (
        <div key={gi} className="nav-group">
          {group.section && <div className="nav-section">{group.section}</div>}
          {group.items.map((it) => (
            <button key={it.id} className={tab === it.id ? 'active' : ''} aria-current={tab === it.id ? 'page' : undefined}
              onClick={() => { void navigateFromNav(it.id).then((done) => { if (done) close?.() }) }}>
              <span>{it.icon}</span> {it.label}
            </button>
          ))}
        </div>
      ))}

      <div className="foot">
        {/* Der Name steht am Knopf selbst (#142). Er beginnt mit dem sichtbaren Text, damit
            Sprachsteuerung den Knopf am Rechner findet. */}
        <button className="theme-toggle" onClick={cycle} title="Design wechseln (System / Hell / Dunkel)" aria-label={`Design: ${THEME_LABELS[choice]} – wechseln (System / Hell / Dunkel)`}>
          🌗 <span>Design: {THEME_LABELS[choice]}</span>
        </button>
        {canQuit(update.status) && <QuitButton onQuit={() => setStopped(true)} />}
      </div>
    </>
    )
  }

  return (
    <TermHelp.Provider value={openHelp}>
      {mobile ? (
        <MobileNav tab={tab} context={contextLine} onNavigate={(t) => void navigateFromNav(t === 'belege' ? 'belege:eingang' : t)} sheet={(close) => <nav className="sidebar" aria-label="Hauptnavigation">{sidebar(close)}</nav>} />
      ) : (
        <nav className="sidebar" aria-label="Hauptnavigation">{sidebar(null)}</nav>
      )}
      <main>
        {/* Was beim Start mit den Daten geschehen ist (#55). Auf jeder Seite, damit die Meldung
            nicht davon abhängt, wo der Nutzer gerade ist. */}
        <DatabaseNotice />
        {/* Nach dem Wechsel in ein leeres Objekt (#157), ebenfalls auf jeder Seite: Leere Seiten
            sähen sonst aus, als wären die Daten weg. */}
        {emptyNotice && (
          <PropertyNotice
            current={emptyNotice.current}
            previous={emptyNotice.previous}
            previousHadUnits={emptyNotice.previousHadUnits}
            focus={focusNoticeFor === propertyId}
            onFocused={clearNoticeFocus}
            onBack={() => void switchProperty(emptyNotice.previous.id)}
            onSetUp={tab === 'stammdaten' ? undefined : () => void navigate('stammdaten')}
            onDismiss={() => propertyId && dismissNotice(propertyId)}
          />
        )}
        {/* Je Objekt und Jahr neu aufgestellt (#145, Durchsicht zu #141): Formulare und
            Zwischenstände einer Seite gehören zu dem Objekt und Jahr, in dem sie entstanden sind. Die
            Warteschlange der KI-Auswertung liegt darüber (App), sie überlebt den Wechsel (#490). */}
        <Fragment key={`${propertyId ?? ''}:${periodKeyNow}`}>
        {tab === 'cockpit' && (
          <Cockpit units={units} tenancies={tenancies} settings={settings} updateStatus={update.status} reload={reload} onNavigate={(t, f) => void navigate(t, f ?? null)} />
        )}
        {tab === 'uebersicht' && <Uebersicht onNavigate={(t) => void navigate(t)} />}
        {tab === 'stammdaten' && (
          <Stammdaten units={units} tenancies={tenancies} settings={settings} reload={reload} focus={focus} onFocusDone={clearFocus} />
        )}
        {tab === 'kosten' && <Kosten units={units} settings={settings} tenancies={tenancies} focus={focus} onFocusDone={clearFocus} onOpenReceipt={openReceipt} onOpenAiSettings={openAiSettings} onOpenMeters={openMeters}
          receiptStart={receiptStart} onReceiptStartDone={() => setReceiptStart(null)} onNewCostItem={(u) => void openNewCostItem(u)} onOpenInbox={() => void navigate('belege:eingang')} />}
        {tab === 'mietkonto' && <Mietkonto focus={focus} onFocusDone={clearFocus} />}
        {tab === 'zaehler' && <Zaehler units={units} focus={focus} onFocusDone={clearFocus} />}
        {tab === 'belege' && <Belege units={units} settings={settings} onNavigate={(t, f) => void navigate(t, f ?? null)}
          onOpenItem={(item) => void openCostItem(item)} onOpenAiSettings={openAiSettings} onOpenMeters={openMeters} onNewCostItem={(u) => void openNewCostItem(u)}
          view={belegeView} onViewChange={setBelegeView} focusFile={receiptFocus} onOpenReceipt={openReceipt} onFocusDone={() => setReceiptFocus(null)} />}
        {tab === 'abrechnung' && (
          <Abrechnung settings={settings} units={units} tenancies={tenancies} reload={reload} onNavigate={(t, f) => void navigate(t, f ?? null)} focus={focus} onFocusDone={clearFocus} />
        )}
        {tab === 'heizkosten' && <Heizkosten units={units} tenancies={tenancies} onTenanciesChanged={reload} onOpenReceipt={openReceipt} onOpenAiSettings={openAiSettings} />}
        {tab === 'steuer' && <Steuer settings={settings} onNavigate={(t) => void navigate(t, null)} />}
        {tab === 'hilfe' && <Hilfe onFollow={(g, step) => void followStep(g, step, true)} focusTerm={helpTerm} onFocusTermDone={() => setHelpTerm(null)}
          openGuide={helpGuide} onOpenGuideDone={() => setHelpGuide(null)} stock={helpStock} />}
        {tab === 'verlauf' && <Verlauf />}
        {tab === 'einstellungen' && settings && (
          <Einstellungen settings={settings} reload={reload} update={update} onNavigate={(t) => void navigate(t)} />
        )}
        </Fragment>
        {/* Außerhalb der je Objekt und Jahr neu aufgestellten Seite: Die Leiste bleibt zwischen zwei Schritten dieselbe
            und behält den Fokus auf „Nächster Schritt“. */}
        {thread && <GuideThread guide={thread.guide} step={thread.step} onNext={(step) => followStep(thread.guide, step)} onBack={backToGuide} onClose={closeThread} />}
      </main>
    </TermHelp.Provider>
  )
}

// Die Musterseite (#346 Schritt 12) unter `?muster`, im dunklen Design mit `?muster=dunkel`: alle Bausteine ohne
// Server, für Bildschirmfotos und Browserlauf; nicht in der Navigation.
function musterTheme(): 'light' | 'dark' | null {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('muster')) return null
  return params.get('muster') === 'dunkel' ? 'dark' : 'light'
}

export default function App() {
  const muster = musterTheme()
  useEffect(() => { if (muster) document.documentElement.dataset.theme = muster }, [muster])
  // Ohne Objekt- und Zeitraum-Provider: die fragen den Server, die Musterseite kommt ohne aus (Durchsicht)
  if (muster) return <UIProvider><main><Muster /></main></UIProvider>
  return (
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <NewPropertyProvider>
            {/* Eine Warteschlange der KI-Auswertung für die ganze App (#490), außerhalb der Seiten */}
            <EvaluationQueueProvider>
              <Shell />
            </EvaluationQueueProvider>
          </NewPropertyProvider>
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>
  )
}
