import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { ReceiptUpload } from './receipts'
import type { CostItem, NoticeSubject, Settings, Tenancy, Unit, UploadInfo } from './types'
import { api } from './api'
import { PeriodProvider, usePeriod } from './period'
import { PeriodSelect } from './components/PeriodSelect'
import { PropertyProvider, PropertySwitcher, useProperty, useSwitchProperty, withProperty } from './property'
import { UIProvider, useConfirm, useToast } from './components/feedback'
import FoxLogo from './components/Logo'
import { UpdateHint, useUpdateStatus } from './components/Update'
import DatabaseNotice from './components/Database'
import PropertyNotice from './components/PropertyNotice'
import { emptyPropertyNotice } from './propertyView'
import { canQuit, hintVisible } from './update'
import Cockpit from './pages/Cockpit'
import Uebersicht from './pages/Uebersicht'
import Schnellerfassung from './pages/Schnellerfassung'
import Stammdaten from './pages/Stammdaten'
import Kosten from './pages/Kosten'
import Mietkonto from './pages/Mietkonto'
import Zaehler from './pages/Zaehler'
import Belege from './pages/Belege'
import Abrechnung from './pages/Abrechnung'
import Hilfe from './pages/Hilfe'
import Steuer from './pages/Steuer'
import Einstellungen from './pages/Einstellungen'
import { NAV, type Tab } from './nav'

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
    <button className="theme-toggle quit" onClick={stop} disabled={stopping} title="Mietfuchs beenden">
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
  const setTab = useCallback((t: Tab, f: NoticeSubject | null = null) => { setFocus(f); setTabState(t) }, [])
  const clearFocus = useCallback(() => setFocus(null), [])
  const [stopped, setStopped] = useState(false)
  // Belege aus dem Posteingang, die die Schnellerfassung auswerten soll (#170)
  const [handoff, setHandoff] = useState<UploadInfo[] | null>(null)
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
  const { key: periodKeyNow } = usePeriod()
  const { properties, property, previousId, focusNoticeFor, setFocusNoticeFor, reload: reloadProperties } = useProperty()
  const switchProperty = useSwitchProperty()
  // Ausgewertet wird im Objekt, dem der Beleg zugedacht ist; ohne Zuordnung im gewählten.
  const evaluateFromInbox = async (list: UploadInfo[]) => {
    const target = list.find((u) => u.propertyId)?.propertyId
    if (target && target !== property?.id && !(await switchProperty(target))) return
    setHandoff(list)
    setTab('schnellerfassung')
  }
  // „Weiter prüfen“ (#170): Die Schnellerfassung zeigt die offenen Auswertungen des Objekts; dazu
  // erst auf das Objekt der Auswertung umschalten, wie beim Auswerten.
  const continueAssessment = async (u: ReceiptUpload) => {
    const target = u.assessment?.propertyId
    if (target && target !== property?.id && !(await switchProperty(target))) return
    setTab('schnellerfassung')
  }
  // „Position öffnen“ aus dem Belegordner: Der zeigt alle Objekte, die Seite Kosten nur das
  // gewählte. Gehört die Position zu einem anderen, wird erst umgeschaltet, wie oben.
  const openCostItem = async (item: CostItem) => {
    if (item.propertyId !== property?.id && !(await switchProperty(item.propertyId))) return
    setTab('kosten', { kind: 'costItem', id: item.id })
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

  return (
    <>
      <nav className="sidebar">
        <div className="logo">
          <FoxLogo size={30} />
          <div className="logo-text">
            Mietfuchs
            <small>{property?.name || 'Nebenkosten im Griff'}</small>
          </div>
        </div>

        {/* Oben statt im Fuß: Der Fuß liegt auf kleinen Bildschirmen und langen Seiten
            außer Sicht. */}
        {update.status && hintVisible(update.status, settings) && (
          <UpdateHint status={update.status} onDismissed={reload} onShowGuide={() => setTab('einstellungen')} />
        )}

        <PropertySwitcher properties={properties} value={propertyId} onChange={(id) => void switchProperty(id)} />

        <PeriodSelect className="year-switcher no-print" />

        {NAV.map((group, gi) => (
          <div key={gi} className="nav-group">
            {group.section && <div className="nav-section">{group.section}</div>}
            {group.items.map((it) => (
              <button key={it.id} className={tab === it.id ? 'active' : ''} onClick={() => setTab(it.id)}>
                <span>{it.icon}</span> {it.label}
              </button>
            ))}
          </div>
        ))}

        <div className="foot">
          {/* Der Name steht am Knopf selbst: Am Handy bleibt nur „🌗“ sichtbar (#142). Er beginnt
              mit dem sichtbaren Text, damit Sprachsteuerung den Knopf am Rechner findet. */}
          <button className="theme-toggle" onClick={cycle} title="Design wechseln (System / Hell / Dunkel)" aria-label={`Design: ${THEME_LABELS[choice]} – wechseln (System / Hell / Dunkel)`}>
            🌗 <span className="theme-label">Design: {THEME_LABELS[choice]}</span>
          </button>
          {canQuit(update.status) && <QuitButton onQuit={() => setStopped(true)} />}
          <div className="foot-note">Alle Daten bleiben lokal auf diesem Rechner.</div>
        </div>
      </nav>
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
            onSetUp={tab === 'stammdaten' ? undefined : () => setTab('stammdaten')}
            onDismiss={() => propertyId && dismissNotice(propertyId)}
          />
        )}
        {/* Je Objekt und Jahr neu aufgestellt (#145, Durchsicht zu #141): Formulare und
            Zwischenstände einer Seite gehören zu dem Objekt und Jahr, in dem sie entstanden sind. */}
        <Fragment key={`${propertyId ?? ''}:${periodKeyNow}`}>
        {tab === 'cockpit' && (
          <Cockpit units={units} tenancies={tenancies} settings={settings} reload={reload} onNavigate={(t) => setTab(t as Tab)} />
        )}
        {tab === 'schnellerfassung' && (
          <Schnellerfassung units={units} settings={settings} onNavigate={(t, f) => setTab(t as Tab, f ?? null)}
            handoff={handoff ?? undefined} onHandoffTaken={() => setHandoff(null)} />
        )}
        {tab === 'uebersicht' && <Uebersicht onNavigate={(t) => setTab(t as Tab)} />}
        {tab === 'stammdaten' && (
          <Stammdaten units={units} tenancies={tenancies} settings={settings} reload={reload} focus={focus} onFocusDone={clearFocus} />
        )}
        {tab === 'kosten' && <Kosten units={units} settings={settings} tenancies={tenancies} focus={focus} onFocusDone={clearFocus} />}
        {tab === 'mietkonto' && <Mietkonto focus={focus} onFocusDone={clearFocus} />}
        {tab === 'zaehler' && <Zaehler units={units} focus={focus} onFocusDone={clearFocus} />}
        {tab === 'belege' && <Belege onEvaluate={(list) => void evaluateFromInbox(list)} onContinue={(u) => void continueAssessment(u)} onOpenItem={(item) => void openCostItem(item)} />}
        {tab === 'abrechnung' && (
          <Abrechnung settings={settings} units={units} tenancies={tenancies} reload={reload} onNavigate={(t, f) => setTab(t, f ?? null)} />
        )}
        {tab === 'steuer' && <Steuer settings={settings} />}
        {tab === 'hilfe' && <Hilfe onNavigate={(t) => setTab(t)} />}
        {tab === 'einstellungen' && settings && (
          <Einstellungen settings={settings} reload={reload} update={update} />
        )}
        </Fragment>
      </main>
    </>
  )
}

export default function App() {
  return (
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Shell />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>
  )
}
