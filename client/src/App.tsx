import { useCallback, useEffect, useState } from 'react'
import type { Settings, Tenancy, Unit } from './types'
import { api } from './api'
import { YearProvider, useYear, YEAR_OPTIONS } from './year'
import Cockpit from './pages/Cockpit'
import Uebersicht from './pages/Uebersicht'
import Schnellerfassung from './pages/Schnellerfassung'
import Stammdaten from './pages/Stammdaten'
import Kosten from './pages/Kosten'
import Mietkonto from './pages/Mietkonto'
import Zaehler from './pages/Zaehler'
import Belege from './pages/Belege'
import Abrechnung from './pages/Abrechnung'
import Einstellungen from './pages/Einstellungen'

type Tab =
  | 'cockpit' | 'schnellerfassung' | 'zaehler' | 'kosten' | 'mietkonto'
  | 'abrechnung' | 'uebersicht'
  | 'stammdaten' | 'belege' | 'einstellungen'

// Navigation nach Arbeitsphase gruppiert statt als flache Tab-Liste: erst der Überblick,
// dann „Sammeln" (übers Jahr laufend), „Abrechnen" (Jahresende) und „Einrichten" (selten).
type NavItem = { id: Tab; label: string; icon: string }
const NAV: { section?: string; items: NavItem[] }[] = [
  { items: [{ id: 'cockpit', label: 'Cockpit', icon: '◎' }] },
  {
    section: 'Sammeln · laufend',
    items: [
      { id: 'schnellerfassung', label: 'Schnellerfassung', icon: '📥' },
      { id: 'zaehler', label: 'Zähler & Stände', icon: '🔢' },
      { id: 'kosten', label: 'Kosten', icon: '🧾' },
      { id: 'mietkonto', label: 'Mietkonto', icon: '💶' },
    ],
  },
  {
    section: 'Abrechnen · Jahresende',
    items: [
      { id: 'abrechnung', label: 'Abrechnung', icon: '📄' },
      { id: 'uebersicht', label: 'Kostenvergleich', icon: '📊' },
    ],
  },
  {
    section: 'Einrichten · selten',
    items: [
      { id: 'stammdaten', label: 'Stammdaten', icon: '🏠' },
      { id: 'belege', label: 'Belegarchiv', icon: '📁' },
      { id: 'einstellungen', label: 'Einstellungen', icon: '⚙️' },
    ],
  },
]

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

function Shell() {
  const [tab, setTab] = useState<Tab>('cockpit')
  const [units, setUnits] = useState<Unit[]>([])
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const { choice, cycle } = useTheme()
  const { year, setYear } = useYear()

  const reload = useCallback(async () => {
    const [u, t, s] = await Promise.all([
      api<Unit[]>('/api/units'),
      api<Tenancy[]>('/api/tenancies'),
      api<Settings>('/api/settings'),
    ])
    setUnits(u)
    setTenancies(t)
    setSettings(s)
  }, [])

  useEffect(() => {
    reload().catch((e) => console.error(e))
  }, [reload])

  return (
    <>
      <nav className="sidebar">
        <div className="logo">
          Nebenkosten
          <small>{settings?.houseName || 'Abrechnungs-Tool'}</small>
        </div>

        <label className="year-switcher no-print">
          <span>Abrechnungsjahr</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>

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
          <button className="theme-toggle" onClick={cycle} title="Design wechseln (System / Hell / Dunkel)">
            🌗 Design: {THEME_LABELS[choice]}
          </button>
          <div>Alle Daten bleiben lokal auf diesem Rechner.</div>
        </div>
      </nav>
      <main>
        {tab === 'cockpit' && <Cockpit units={units} onNavigate={(t) => setTab(t as Tab)} />}
        {tab === 'schnellerfassung' && <Schnellerfassung units={units} settings={settings} onNavigate={(t) => setTab(t as Tab)} />}
        {tab === 'uebersicht' && <Uebersicht onNavigate={(t) => setTab(t as Tab)} />}
        {tab === 'stammdaten' && (
          <Stammdaten units={units} tenancies={tenancies} settings={settings} reload={reload} />
        )}
        {tab === 'kosten' && <Kosten units={units} settings={settings} />}
        {tab === 'mietkonto' && <Mietkonto />}
        {tab === 'zaehler' && <Zaehler units={units} />}
        {tab === 'belege' && <Belege />}
        {tab === 'abrechnung' && (
          <Abrechnung settings={settings} units={units} tenancies={tenancies} reload={reload} />
        )}
        {tab === 'einstellungen' && settings && (
          <Einstellungen settings={settings} reload={reload} />
        )}
      </main>
    </>
  )
}

export default function App() {
  return (
    <YearProvider>
      <Shell />
    </YearProvider>
  )
}
