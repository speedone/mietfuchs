// Offene Umsätze der Seite „Kontoauszug“ (#188, Teil 3): je Zeile Ampel mit Grund als Text, Datum, Betrag, Gegenseite,
// Zweck, Mietverhältnis und Art (vorbelegt aus dem Vorschlag), Aufteilen, Beiseitelegen und „Buchen“. Die Zeilen hält die
// Seite (Auswahl bleibt nach einer 409). Geld rechnet nur der Server; hier steht nur der Rest der Teile zur Anzeige.
import { fmtDate, fmtEuro, parseEuro } from '../api'
import { removePart, rowProblem, SET_ASIDE_OPTIONS, targetOptionsFor, type BankRow, type RowPart, type RowTarget } from '../bankView'
import type { BankSetAside } from '../types'
import type { TenancyOption } from './BankImportDrawer'
import { FieldMessage } from './Field'
import Table from './Table'

const LIGHT_TEXT = { green: '● grün', yellow: '● gelb' } as const
// Kennung neuer Teile, fest je Teil (W2).
let partSeq = 0

function PartFields({ row, part, index, tenancies, onChange, onRemove }: {
  row: BankRow
  part: RowPart
  index: number
  tenancies: readonly TenancyOption[]
  onChange: (patch: Partial<RowPart>) => void
  onRemove: (() => void) | null
}) {
  const known = part.tenancyId === null || tenancies.some((t) => t.id === part.tenancyId)
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="field">
        <span>Mietverhältnis</span>
        <select aria-label="Mietverhältnis" value={part.tenancyId ?? ''} onChange={(e) => onChange({ tenancyId: e.target.value || null })}>
          <option value="">Bitte wählen</option>
          {!known && part.tenancyId && <option value={part.tenancyId}>unbekanntes Mietverhältnis</option>}
          {tenancies.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Art</span>
        <select aria-label="Art" value={part.target ?? ''} onChange={(e) => onChange({ target: (e.target.value || null) as RowTarget | null })}>
          <option value="">Bitte wählen</option>
          {/* Verknüpfen gibt es nur am Teil, der die erfasste Buchung trägt (Durchsicht Teil 3, M5). */}
          {targetOptionsFor(row.tx, part.target).filter((o) => part.refId !== undefined || (o.value !== 'existingPayment' && o.value !== 'existingDeposit')).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {row.parts.length > 1 && (
        <label className="field">
          <span>Betrag</span>
          <input inputMode="decimal" aria-label={`Betrag Teil ${index + 1}`} aria-invalid={part.amountText !== undefined || undefined}
            value={part.amountText ?? fmtEuro(Math.abs(part.amountCents)).replace(/\s?€$/, '')}
            onChange={(e) => {
              // Gesteuert (Durchsicht Teil 3, W2): Lesbar wird der Betrag sofort übernommen, sonst bleibt der Text stehen,
              // die Zeile ist nicht buchbar, und eine Meldung sagt es.
              const cents = parseEuro(e.target.value)
              const { amountText: _old, ...rest } = part
              onChange(cents !== null && cents !== 0 ? { ...rest, amountCents: Math.sign(row.tx.openCents) * Math.abs(cents), amountText: undefined } : { amountText: e.target.value })
            }} />
          {part.amountText !== undefined && <FieldMessage error="Bitte geben Sie einen Betrag ein, etwa 250,00." />}
        </label>
      )}
      {onRemove && <button type="button" className="btn ghost" onClick={onRemove}>Teil entfernen</button>}
    </div>
  )
}

export default function BankOpenTable({ rows, tenancies, problems, busy, onChange, onBook }: {
  rows: readonly BankRow[]
  tenancies: readonly TenancyOption[]
  problems: Readonly<Record<string, string>>
  busy: boolean
  onChange: (id: string, row: BankRow) => void
  onBook: (rows: BankRow[]) => void
}) {
  return (
    <Table className="stacked" aria-label="Offene Umsätze">
      <thead>
        <tr><th>Ampel</th><th>Datum</th><th className="num">Betrag</th><th>Gegenseite</th><th>Zweck</th><th>Zuordnung</th><th><span className="sr-only">Aktion</span></th></tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { tx } = row
          const s = tx.suggestion
          const setPart = (i: number, patch: Partial<RowPart>) => onChange(tx.id, { ...row, parts: row.parts.map((p, k) => {
            if (k !== i) return p
            const next = { ...p, ...patch }
            if (next.amountText === undefined) delete next.amountText
            return next
          }) })
          const rest = tx.openCents - row.parts.reduce((a, p) => a + p.amountCents, 0)
          const reason = rowProblem(row)
          const problem = problems[tx.id]
          return (
            <tr key={tx.id} data-transaction={tx.id}>
              <td data-label="Ampel">
                <span>{s ? LIGHT_TEXT[s.light] : '○ ohne Vorschlag'}</span>
                <br /><span className="muted">{s ? s.reason : 'Kein Mietverhältnis zu dieser IBAN bekannt'}</span>
              </td>
              <td data-label="Datum">{fmtDate(tx.bookingDate)}</td>
              <td data-label="Betrag" className="num">
                {fmtEuro(tx.openCents)}
                {tx.openCents !== tx.amountCents && <><br /><span className="muted">{`von ${fmtEuro(tx.amountCents)}`}</span></>}
              </td>
              <td data-label="Gegenseite">{tx.counterpartyName ?? tx.counterpartyIban ?? ''}{tx.ultimatePartyName && <><br /><span className="muted">{`für ${tx.ultimatePartyName}`}</span></>}</td>
              <td data-label="Zweck">{tx.purpose}</td>
              <td data-label="Zuordnung">
                {row.setAside === null && row.parts.map((part, i) => (
                  <PartFields key={part.key} row={row} part={part} index={i} tenancies={tenancies} onChange={(patch) => setPart(i, patch)}
                    onRemove={row.parts.length > 1 ? () => onChange(tx.id, removePart(row, i)) : null} />
                ))}
                {row.setAside === null && (
                  <button type="button" className="btn ghost" onClick={() => onChange(tx.id, { ...row, parts: [...row.parts, { key: `${tx.id}:${++partSeq}`, tenancyId: null, target: null, amountCents: rest }] })}>+ weiterer Teil</button>
                )}
                {row.parts.length > 1 && rest !== 0 && <p className="muted">{`Rest ${fmtEuro(rest)} bleibt offen.`}</p>}
                <label className="field">
                  <span>Beiseitelegen</span>
                  <select aria-label="Beiseitelegen" value={row.setAside ?? ''} onChange={(e) => onChange(tx.id, { ...row, setAside: (e.target.value || null) as BankSetAside | null })}>
                    <option value="">nein, zuordnen</option>
                    {SET_ASIDE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                {problem && <FieldMessage error={problem} announce />}
              </td>
              <td className="actions">
                <button type="button" className="btn secondary" disabled={busy || reason !== null} aria-describedby={reason ? `why-${tx.id}` : undefined}
                  onClick={() => onBook([{ ...row, selected: true }])}>
                  Buchen<span className="sr-only">{` ${fmtDate(tx.bookingDate)} ${fmtEuro(tx.openCents)}`}</span>
                </button>
                {reason && <p id={`why-${tx.id}`} className="muted">{reason}</p>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
