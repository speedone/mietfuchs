import { useCallback, useEffect, useState } from 'react'
import type { Settings, Tenancy, Unit } from './types'
import { api } from './api'
import Stammdaten from './pages/Stammdaten'
import Kosten from './pages/Kosten'
import Zaehler from './pages/Zaehler'
import Abrechnung from './pages/Abrechnung'
import Einstellungen from './pages/Einstellungen'

type Tab = 'stammdaten' | 'kosten' | 'zaehler' | 'abrechnung' | 'einstellungen'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'stammdaten', label: 'Stammdaten', icon: '🏠' },
  { id: 'kosten', label: 'Kosten & Belege', icon: '🧾' },
  { id: 'zaehler', label: 'Zähler', icon: '🔢' },
  { id: 'abrechnung', label: 'Abrechnung', icon: '📄' },
  { id: 'einstellungen', label: 'Einstellungen', icon: '⚙️' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('stammdaten')
  const [units, setUnits] = useState<Unit[]>([])
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)

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
        <div className="foot">Alle Daten bleiben lokal auf diesem Rechner.</div>
      </nav>
      <main>
        {tab === 'stammdaten' && (
          <Stammdaten units={units} tenancies={tenancies} settings={settings} reload={reload} />
        )}
        {tab === 'kosten' && <Kosten units={units} settings={settings} />}
        {tab === 'zaehler' && <Zaehler units={units} />}
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
