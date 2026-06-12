import { useCallback, useEffect, useState } from 'react'
import type { Settings, Tenancy, Unit } from './types'
import { api } from './api'
import Uebersicht from './pages/Uebersicht'
import Stammdaten from './pages/Stammdaten'
import Kosten from './pages/Kosten'
import Zaehler from './pages/Zaehler'
import Belege from './pages/Belege'
import Abrechnung from './pages/Abrechnung'
import Einstellungen from './pages/Einstellungen'

type Tab = 'uebersicht' | 'stammdaten' | 'kosten' | 'zaehler' | 'belege' | 'abrechnung' | 'einstellungen'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'uebersicht', label: 'Übersicht', icon: '📊' },
  { id: 'stammdaten', label: 'Stammdaten', icon: '🏠' },
  { id: 'kosten', label: 'Kosten & Belege', icon: '🧾' },
  { id: 'zaehler', label: 'Zähler', icon: '🔢' },
  { id: 'belege', label: 'Belegarchiv', icon: '📁' },
  { id: 'abrechnung', label: 'Abrechnung', icon: '📄' },
  { id: 'einstellungen', label: 'Einstellungen', icon: '⚙️' },
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

export default function App() {
  const [tab, setTab] = useState<Tab>('uebersicht')
  const [units, setUnits] = useState<Unit[]>([])
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const { choice, cycle } = useTheme()

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
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
        <div className="foot">
          <button className="theme-toggle" onClick={cycle} title="Design wechseln (System / Hell / Dunkel)">
            🌗 Design: {THEME_LABELS[choice]}
          </button>
          <div>Alle Daten bleiben lokal auf diesem Rechner.</div>
        </div>
      </nav>
      <main>
        {tab === 'uebersicht' && <Uebersicht onNavigate={(t) => setTab(t as Tab)} />}
        {tab === 'stammdaten' && (
          <Stammdaten units={units} tenancies={tenancies} settings={settings} reload={reload} />
        )}
        {tab === 'kosten' && <Kosten units={units} settings={settings} />}
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
