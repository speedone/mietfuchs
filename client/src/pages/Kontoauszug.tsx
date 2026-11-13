// Seite „Kontoauszug“ (#188, Teil 3): Auszug der Bank einlesen, offene Umsätze Mietverhältnissen zuordnen und buchen,
// Konten. Unabhängig vom gewählten Objekt: Ein Konto empfängt Mieten mehrerer Häuser. Vorschläge, offene Beträge und
// Sätze kommen vom Server, die Entscheidungen der Zeilen aus bankView.ts. Nichts davon geht in den Browserspeicher.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, errorText, fmtDate, fmtEuro } from '../api'
import { decisionsOf, greenRows, initialRow, type BankRow } from '../bankView'
import type { BankAccountInfo, BankLinkPreview, BankTransactionView } from '../types'
import BankAccountsCard from '../components/BankAccountsCard'
import BankImportDrawer, { type TenancyOption } from '../components/BankImportDrawer'
import BankOpenTable from '../components/BankOpenTable'
import Card from '../components/Card'
import DisclosureButton from '../components/DisclosureButton'
import EmptyState from '../components/EmptyState'
import { NoticeBox } from '../components/Notice'
import PageHeader from '../components/PageHeader'
import Table from '../components/Table'
import { useConfirm, useToast } from '../components/feedback'
import { sameDraft } from '../draft'
import { useOpenForm } from '../property'

export const RETENTION_SENTENCE = 'Bewahren Sie die Kontoauszüge Ihrer Bank selbst auf. Mietfuchs ersetzt sie nicht.'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export default function Kontoauszug() {
  const confirm = useConfirm()
  const toast = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [accounts, setAccounts] = useState<BankAccountInfo[] | null>(null)
  const [tenancies, setTenancies] = useState<TenancyOption[]>([])
  const [rows, setRows] = useState<BankRow[]>([])
  const [done, setDone] = useState<BankTransactionView[] | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [bookError, setBookError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Neu laden; die Wahl je Zeile bleibt, solange der Umsatz offen ist (auch nach einer 409).
  const load = useCallback(async () => {
    try {
      const [acc, open, ten] = await Promise.all([
        api<BankAccountInfo[]>('/api/bank/accounts'),
        api<BankTransactionView[]>('/api/bank/transactions?state=open'),
        api<TenancyOption[]>('/api/bank/tenancies'),
      ])
      setAccounts(acc)
      setTenancies(ten)
      setRows((before) => open.map((tx) => {
        const kept = before.find((r) => r.tx.id === tx.id)
        return kept && kept.tx.openCents === tx.openCents ? { ...kept, tx } : initialRow(tx)
      }))
      setLoadError(null)
    } catch (e) {
      setLoadError(errorText(e))
    }
  }, [])
  const loadDone = useCallback(async () => {
    try {
      setDone(await api<BankTransactionView[]>('/api/bank/transactions?state=done'))
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }, [toast])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (showDone) void loadDone() }, [showDone, loadDone])

  const book = async (chosen: BankRow[]) => {
    const decisions = decisionsOf(chosen.map((r) => ({ ...r, selected: true })))
    if (decisions.length === 0 || busy) return
    setBusy(true)
    setBookError(null)
    try {
      const plan = await api<BankLinkPreview>('/api/bank/links/plan', { method: 'POST', body: JSON.stringify({ decisions }) })
      if (plan.problems.length > 0) {
        setProblems(Object.fromEntries(plan.problems.map((p) => [p.transactionId, p.message])))
        return
      }
      setProblems({})
      const res = await api<{ ok: true; sentence: string }>('/api/bank/links', { method: 'POST', body: JSON.stringify({ decisions, token: plan.token }) })
      toast(res.sentence)
      await load()
      if (showDone) await loadDone()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setBookError(e.message)
        await load()
      } else setBookError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  // Eine Wahl, die vom Vorschlag abweicht, ist ein offenes Formular: Ein Wechsel von Seite oder Objekt fragt nach.
  useOpenForm(rows.some((r) => r.setAside !== null || !sameDraft(r.parts, initialRow(r.tx).parts)))

  const green = greenRows(rows.map((r) => r.tx))
  const bookGreen = async () => {
    const chosen = rows.filter((r) => green.includes(r.tx))
    const sum = chosen.reduce((a, r) => a + r.tx.openCents, 0)
    const ok = await confirm({
      title: 'Alle grünen übernehmen?',
      message: `${plural(chosen.length, 'Umsatz', 'Umsätze')} über ${fmtEuro(sum)} werden wie vorgeschlagen gebucht.`,
      confirmLabel: 'Buchen',
    })
    if (ok) await book(chosen.map((r) => initialRow(r.tx)))
  }

  const unlink = async (link: BankTransactionView['links'][number]) => {
    const choice: { mode: 'keep' | 'delete' | null } = { mode: null }
    const ok = await confirm({
      title: 'Zuordnung lösen?',
      message: 'Der Umsatz ist danach wieder offen. Die Zahlung bzw. Kautionsbuchung bleibt im Mietkonto, wenn Sie nichts anderes wählen.',
      confirmLabel: link.depositEntryId ? 'Lösen, Kautionsbuchung behalten' : 'Lösen, Zahlung behalten',
      ...(link.created ? { alternativeLabel: link.depositEntryId ? 'Lösen und Kautionsbuchung löschen' : 'Lösen und Zahlung löschen', onAlternative: () => { choice.mode = 'delete' } } : {}),
    })
    if (ok) choice.mode = 'keep'
    const mode = choice.mode
    if (mode === null) return
    try {
      await api(`/api/bank/links/${link.id}${mode === 'delete' ? '?payment=delete' : ''}`, { method: 'DELETE' })
      toast('Zuordnung gelöst.')
      await load()
      await loadDone()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  const restore = async (tx: BankTransactionView) => {
    try {
      await api(`/api/bank/transactions/${tx.id}`, { method: 'PUT', body: JSON.stringify({ setAside: null }) })
      toast('Umsatz zurückgeholt.')
      await load()
      await loadDone()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const choose = () => fileInput.current?.click()
  const empty = accounts !== null && accounts.length === 0 && rows.length === 0

  return (
    <>
      <PageHeader context="none" title="Kontoauszug"
        subtitle="Den Auszug Ihrer Bank einlesen (camt oder MT940, auch als ZIP) und die Mieteingänge den Mietverhältnissen zuordnen."
        actions={<button type="button" className="btn" onClick={choose}>Kontoauszug einlesen</button>} />
      <input ref={fileInput} type="file" className="sr-only" aria-label="Datei mit Kontoauszügen" accept=".xml,.sta,.txt,.940,.mt940,.zip"
        onChange={(e) => {
          const chosen = e.target.files?.[0] ?? null
          e.target.value = ''
          if (chosen) setFile(chosen)
        }} />
      {loadError && <NoticeBox level="error" action={loadError} />}
      <p className="muted">{RETENTION_SENTENCE}</p>
      {empty && (
        <EmptyState action={{ label: 'Kontoauszug einlesen', onClick: choose }}>
          Noch kein Kontoauszug eingelesen. Laden Sie ihn bei Ihrer Bank als Datei herunter; Mietfuchs schlägt danach vor, welcher Eingang zu welchem Mietverhältnis gehört.
        </EmptyState>
      )}
      {!empty && accounts !== null && (
        <Card title="Offene Umsätze" aside={green.length > 0 ? <button type="button" className="btn" disabled={busy} onClick={() => void bookGreen()}>{`Alle grünen übernehmen (${green.length})`}</button> : undefined}>
          {bookError && <NoticeBox level="error" action={bookError} />}
          {rows.length === 0
            ? <p>Alle eingelesenen Umsätze sind zugeordnet oder beiseitegelegt.</p>
            : <BankOpenTable rows={rows} tenancies={tenancies} problems={problems} busy={busy}
                onChange={(id, row) => setRows((rs) => rs.map((r) => (r.tx.id === id ? row : r)))} onBook={(chosen) => void book(chosen)} />}
          <DisclosureButton open={showDone} onToggle={() => setShowDone((v) => !v)} closedLabel="Erledigte Umsätze zeigen" openLabel="Erledigte Umsätze ausblenden" controls="bank-done" />
          {showDone && (
            <div id="bank-done">
              {done === null ? <p className="muted">Wird geladen …</p> : done.length === 0 ? <p>Noch keine erledigten Umsätze.</p> : (
                <Table className="stacked" aria-label="Erledigte Umsätze">
                  <thead><tr><th>Datum</th><th className="num">Betrag</th><th>Gegenseite</th><th>Zweck</th><th>Erledigt durch</th></tr></thead>
                  <tbody>
                    {done.map((tx) => (
                      <tr key={tx.id}>
                        <td data-label="Datum">{fmtDate(tx.bookingDate)}</td>
                        <td data-label="Betrag" className="num">{fmtEuro(tx.amountCents)}</td>
                        <td data-label="Gegenseite">{tx.counterpartyName ?? tx.counterpartyIban ?? ''}</td>
                        <td data-label="Zweck">{tx.purpose}</td>
                        <td data-label="Erledigt durch">
                          {tx.setAside !== null
                            ? <button type="button" className="btn ghost" onClick={() => void restore(tx)}>Zurückholen<span className="sr-only">{` ${fmtDate(tx.bookingDate)}`}</span></button>
                            : tx.links.map((l) => (
                              <div key={l.id} className="flex flex-wrap items-baseline gap-2">
                                <span>{`${l.depositEntryId ? 'Kautionsbuchung' : 'Zahlung'} über ${fmtEuro(l.cents)}`}</span>
                                <button type="button" className="btn ghost danger-ghost ml-auto" onClick={() => void unlink(l)}>Lösen …<span className="sr-only">{` ${fmtDate(tx.bookingDate)}`}</span></button>
                              </div>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          )}
        </Card>
      )}
      {accounts !== null && accounts.length > 0 && <BankAccountsCard accounts={accounts} onChanged={() => void load()} />}
      {file && (
        <BankImportDrawer key={`${file.name}:${file.size}:${file.lastModified}`} file={file} tenancies={tenancies}
          onClose={() => setFile(null)}
          onDone={(sentence) => {
            setFile(null)
            toast(sentence)
            void load()
          }} />
      )}
    </>
  )
}
