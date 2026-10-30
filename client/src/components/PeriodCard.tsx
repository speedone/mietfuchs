import { useState } from 'react'
import type { PeriodChangePreview, PeriodEffect, Property } from '../types'
import { api, errorText, fmtDate, fmtEuro } from '../api'
import { useProperty } from '../property'
import { useToast } from './feedback'
import Term from './Term'
import MonthField from './MonthField'
import Field from './Field'
import {
  answersAfterConflict, answersOf, changeLabel, conflictPreview, earliestOpenChange, initialAnswers, localToday, MONTH_OPTIONS, nextRules, periodChangedText, rhythmText, withoutChange,
  type AnswerForm, type RhythmForm,
} from '../periodForm'
import { rulesOf } from '../../../shared/period.ts'
import { useFormError } from './ErrorSummary'
import Drawer from './Drawer'
import { NoticeBox } from './Notice'
import Card from './Card'

// Die Karte „Abrechnungszeitraum“ in den Stammdaten (#208, Entwurf 3.6, 11.4). Jede Änderung geht
// über die Vorschau des Servers, im Seitenfenster (#346 Schritt 7); gespeichert wird erst mit „Speichern“ nach
// der Vorschau, in einer Transaktion. Wer im Kalenderjahr abrechnet, sieht hier eine Zeile und muss nichts tun.

// `fromField`: die Angaben der Fehler-API für das Monatsfeld (`errors.field('from')`).
export function RhythmFields({ form, onChange, fromField }: { form: RhythmForm; onChange: (next: RhythmForm) => void; fromField?: { id: string; error?: string; onFix: () => void } }) {
  return (
    <>
    {/* Raster mit Breitenstufen (#346 Schritt 7b): die Auswahl so breit wie ihr längster Eintrag, der Monat kurz
        mit dem Rasterknopf direkt am Feld; vorher nahm das Monatsfeld fast die ganze Breite. */}
    <div className="field-grid">
      <Field label="Was möchten Sie ändern?" hint="Beim Wechsel bleiben frühere Zeiträume, wie sie sind; „Beginnmonat von Anfang an“ ändert auch alle früheren.">
        <select value={form.mode} onChange={(e) => onChange({ ...form, mode: e.target.value === 'change' ? 'change' : 'start' })}>
          <option value="change">Wechsel ab einem Monat</option>
          <option value="start">Beginnmonat von Anfang an</option>
        </select>
      </Field>
      {form.mode === 'start' ? (
        <Field label="Abrechnungszeitraum beginnt im">
          <select value={form.month} onChange={(e) => onChange({ ...form, month: Number(e.target.value) })}>
            {MONTH_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
      ) : (
        // Das Monatsfeld: `type="month"` kennen Safari und Firefox nicht (#287, #346 Schritt 5).
        <MonthField
          label="Neuer Zeitraum beginnt ab Monat"
          hint="Danach läuft jeder Zeitraum von diesem Monat bis zum Vormonat im Folgejahr; davor entsteht ein kürzerer Rumpfzeitraum."
          value={form.from}
          today={localToday()}
          onChange={(from) => onChange({ ...form, from })}
          {...fromField}
        />
      )}
    </div>
    {/* Laienprobe B4: „von Anfang an“ deutet die Vergangenheit um, auch schon verschickte Abrechnungen. */}
    {form.mode === 'start' && (
      <div className="warn">
        Das ändert auch alle früheren Abrechnungszeiträume, nicht nur künftige. Haben Sie eine Abrechnung davon schon verschickt,
        wählen Sie „Wechsel ab einem Monat“; sonst stimmen die Zahlen hier nicht mehr mit der verschickten Abrechnung überein.
      </div>
    )}
    </>
  )
}

// Laienprobe B3, B3a: Fristen und Ergebnisse der Abrechnungen, die die Änderung trifft und die schon
// begonnen haben, vorher und nachher. Abgelaufene Frist: rot, mit der Folge (§ 556 Abs. 3 S. 3 BGB)
// und dem Betrag. Auch die Vorschau der Heizung nutzt die Liste.
const balance = (cents: number): string => (cents >= 0 ? `Guthaben ${fmtEuro(cents)}` : `Nachzahlung ${fmtEuro(-cents)}`)

// Kalte Rechnungen mit Leistungszeitraum, nach Tagen auf die neuen Zeiträume geteilt. Kommt ein Anteil zu einem Teil
// derselben Rechnung, der im Zeitraum stehen bleibt, sagt es ein Satz (#455): Dort entsteht keine zweite Zeile.
// Integrationsdurchsicht zu #455, M1: Hängt das Zusammenfassen am Jahr der Zahlung, das die Vorschau unten fragt, gilt
// der Satz nur für die vorbelegten Jahre.
// Befund 3 zu #455: Nennt der Zusatz „(anteilig …)“ der Zeile danach eine längere Spanne, sagt der Satz ihren neuen Namen.
const mergeText = (label: string, into: string, dependsOnYear: boolean, as?: string): string => {
  const named = as === undefined ? '' : `; die Zeile heißt danach „${as}“`
  return dependsOnYear
    ? ` Bleibt es beim vorbelegten Jahr der Zahlung, wird der Anteil für ${label} mit dem Teil „${into}“ zusammengefasst${named}; mit einem anderen Jahr bleibt er eine eigene Zeile.`
    : ` Der Anteil für ${label} wird mit dem Teil „${into}“ zusammengefasst${named}.`
}

// #471: der umgekehrte Fall, zusammengefasst wird erst mit einem anderen als dem vorbelegten Jahr.
// Durchsicht, M2: Trüge die Zeile dann die ganze Rechnung, nennt der Satz auch ihren neuen Namen.
const mergeWithYearText = (label: string, into: string, year: number, renamedTo?: string): string =>
  ` Mit dem vorbelegten Jahr der Zahlung bleibt der Anteil für ${label} eine eigene Zeile; mit dem Jahr ${year} für beide wird er mit dem Teil „${into}“ zusammengefasst` +
  (renamedTo === undefined ? '.' : `; die Zeile trägt dann die ganze Rechnung und heißt „${renamedTo}“.`)

// #471: Der neue Name, wenn die Zeile danach die ganze Rechnung trägt; hängt das Zusammenfassen am vorbelegten Jahr, gilt
// er nur unter derselben Bedingung (Durchsicht, M2).
const renameText = (renamedTo: string, dependsOnYear: boolean): string => dependsOnYear
  ? ` Bleibt es beim vorbelegten Jahr, trägt die Zeile danach die ganze Rechnung und heißt „${renamedTo}“.`
  : ` Die Zeile trägt danach die ganze Rechnung und heißt „${renamedTo}“.`

export function MoveList({ moves }: { moves: PeriodChangePreview['moves'] }) {
  return moves.map((m) => (
    <p key={m.costItemId}>
      „{m.description}“ ({fmtEuro(m.amountCents)}) wird nach Tagen aufgeteilt: {m.parts.map((p) => `${p.label}: ${fmtEuro(p.amountCents)}`).join(', ')}.
      {m.parts.flatMap((p) => (p.mergedInto !== undefined ? [mergeText(p.label, p.mergedInto, p.mergeDependsOnYear === true, p.mergedAs)]
        : p.mergeWithYear !== undefined ? [mergeWithYearText(p.label, p.mergeWithYear.into, p.mergeWithYear.year, p.mergeWithYear.renamedTo)] : [])).join('')}
      {m.renamedTo === undefined ? '' : renameText(m.renamedTo, m.parts.some((p) => p.mergedInto !== undefined && p.mergeDependsOnYear === true))}
    </p>
  ))
}

export function EffectsList({ effects, earliest }: { effects: PeriodEffect[]; earliest?: string }) {
  if (effects.length === 0) return null
  return (
    <div className="stack">
      <h4>Was sich an schon begonnenen Abrechnungen ändert</h4>
      <p className="muted">Gerechnet mit den Vorschlägen dieser Vorschau; wo keiner steht, mit dem Aufteilen nach Tagen. Wählen Sie anders, ändern sich die Beträge.</p>
      {effects.map((e) => (
        <div key={e.label} className={e.passed ? 'error' : 'muted'}>
          <p>
            <strong>{e.label}</strong>: Abrechnung bis {fmtDate(e.deadline)} zustellen
            {e.passed ? ' – diese Frist ist schon abgelaufen.' : '.'}
            {e.replaces.length > 0 && ` Bisher: ${e.replaces.map((r) => `${r.label} (Frist ${fmtDate(r.deadline)})`).join(', ')}.`}
          </p>
          {e.tenants.length > 0 && (
            <ul>
              {e.tenants.map((t) => (
                <li key={t.tenantName}>
                  {t.tenantName}: {t.beforeCents === null ? '' : `vorher ${balance(t.beforeCents)}, `}nachher {balance(t.afterCents)}
                </li>
              ))}
            </ul>
          )}
          {e.passed && (
            <p>
              Weil Sie selbst umstellen, haben Sie die Verspätung zu vertreten; eine Nachzahlung aus diesem Zeitraum können Sie deshalb nicht mehr
              verlangen (§ 556 Abs. 3 Satz 3 BGB){e.lostClaimsCents > 0 ? `; das sind hier ${fmtEuro(e.lostClaimsCents)} mehr als bisher` : ''}.
              {' '}Vorsicht auch aus einem zweiten Grund: Ob sich der Abrechnungszeitraum für einen schon abgelaufenen Zeitraum nachträglich ändern
              lässt, ist nicht geklärt; üblich ist ein Wechsel nur für die Zukunft.
              {earliest && ` Damit keine abgelaufene Abrechnung entsteht, wechseln Sie frühestens ab ${changeLabel(earliest)}.`}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

export function PreviewAnswers({ preview, answers, onChange }: { preview: PeriodChangePreview; answers: AnswerForm; onChange: (next: AnswerForm) => void }) {
  // Das Jahr der Zahlung einer Position einer Gruppe nur für den gewählten Zeitraum (I1).
  const groupOf = new Map(preview.groups.flatMap((g) => g.items.map((i) => [i.costItemId, g] as const)))
  const chosenOf = (g: PeriodChangePreview['groups'][number]): string => answers.groups[g.id] ?? g.suggested
  const shownTax = preview.taxYears.filter((t) => {
    const g = groupOf.get(t.costItemId)
    if (g === undefined) return true
    const chosen = chosenOf(g)
    return chosen === 'split' ? true : chosen === t.period
  })
  return (
    <>
      {preview.groups.map((g) => {
        const chosen = chosenOf(g)
        const target = g.options.find((o) => o.key === chosen)
        const total = g.items.reduce((sum, i) => sum + i.amountCents, 0)
        const short = target !== undefined && preview.periods.some((p) => p.key === target.key && p.short)
        return (
          <div key={g.id}>
            <label className="field">
              Zeitraum für {g.items.map((i) => `„${i.description}“`).join(', ')} (bisher {g.fromLabel})
              <select value={chosen} onChange={(e) => onChange({ ...answers, groups: { ...answers.groups, [g.id]: e.target.value } })}>
                {chosen === '' && <option value="">– bitte wählen –</option>}
                {g.split !== null && <option value="split">{g.suggested === 'split' ? 'Nach Tagen auf die neuen Zeiträume aufteilen (Vorgabe)' : 'Nach Tagen auf die neuen Zeiträume aufteilen'}</option>}
                {g.options.map((o) => <option key={o.key} value={o.key}>ganz nach {o.label}</option>)}
              </select>
            </label>
            {/* Review Runde 1: warum das Teilen nicht vorbelegt ist, und was es zwischen Steuerjahren verschöbe. */}
            {g.split !== null && (chosen === 'split' || chosen === '') && g.split.notes.map((n) => <div key={n} className="warn">{n}</div>)}
            {g.taxShifts.filter((t) => t.key === chosen).map((t) => <div key={t.key} className="warn">{t.text}</div>)}
            {/* Laienprobe B2: was das Aufteilen ergibt, und was das Nicht-Aufteilen bedeutet. */}
            {g.split !== null && chosen === 'split' && (
              <p className="muted">
                Die Rechnungen gelten als Kosten von {g.split.range} und werden nach Tagen geteilt:{' '}
                {g.split.items.map((it) => {
                  const d = g.items.find((i) => i.costItemId === it.costItemId)?.description ?? ''
                  return `„${d}“ ${it.parts.map((p) => `${p.label}: ${fmtEuro(p.amountCents)}`).join(', ')}`
                }).join('; ')}.
              </p>
            )}
            {g.split !== null && chosen !== 'split' && (
              <div className="warn">
                {fmtEuro(total)} kommen ganz nach {target?.label ?? chosen}. Wählen Sie das nur, wenn die Rechnungen ausschließlich diesen Zeitraum betreffen;
                eine Jahresrechnung stünde sonst ganz in {target?.label ?? chosen}.
              </div>
            )}
            {g.individualAmounts && (
              <div className="warn">
                Einzelbeträge teilt Mietfuchs nicht nach Tagen: Welcher Betrag in welchen Zeitraum gehört, steht nur in der Abrechnung, aus der sie stammen.
                {' '}Wählen Sie den Zeitraum, dem die Rechnung angehört. Betrifft sie beide, erfassen Sie sie danach je Zeitraum mit den Einzelbeträgen, die darauf entfallen.
              </div>
            )}
            {g.heating && (
              <div className="warn">
                Heizkosten teilt Mietfuchs nicht nach Tagen, denn im Winter wird mehr verbraucht als im Sommer (BGH VIII ZR 156/11).
                {short
                  ? ` ${fmtEuro(total)} stehen danach ganz im Rumpfzeitraum ${target?.label ?? ''}. Ist das eine Rechnung über ein ganzes Jahr, zahlen die Mieter dort die Heizkosten eines Jahres gegen die Vorauszahlungen weniger Monate. Tragen Sie danach den Leistungszeitraum der Rechnung ein und lassen Sie sie zum Stichtag abgrenzen (Zählerstand oder Zwischenrechnung des Versorgers).`
                  : ' Wählen Sie den Zeitraum, in dem die Wärme verbraucht wurde.'}
              </div>
            )}
          </div>
        )
      })}
      {shownTax.map((t) => (
        <label key={t.key} className="field">
          Jahr der Zahlung (Steuer) für „{t.description}“ in {t.label}
          <select value={answers.taxYears[t.key] ?? String(t.suggested)} onChange={(e) => onChange({ ...answers, taxYears: { ...answers.taxYears, [t.key]: e.target.value } })}>
            {t.options.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        </label>
      ))}
      {preview.overrides.map((o) => (
        <fieldset key={o.tenancyId} className="field">
          <legend>
            {o.tenantName}: <Term id="prepayment">tatsächlich gezahlte Vorauszahlungen</Term> neu erfassen
            (bisher {o.from.map((f) => `${fmtEuro(f.cents)} für ${f.label}`).join(', ')})
          </legend>
          {o.ask.map((a) => {
            const entry = answers.overrides[o.tenancyId]?.[a.period] ?? { amount: '', none: false }
            const set = (next: { amount: string; none: boolean }) =>
              onChange({ ...answers, overrides: { ...answers.overrides, [o.tenancyId]: { ...(answers.overrides[o.tenancyId] ?? {}), [a.period]: next } } })
            return (
              <div key={a.period} className="row">
                <label className="field">
                  tatsächlich gezahlt {a.months} ({a.label}) €
                  <input value={entry.amount} disabled={entry.none} inputMode="decimal" onChange={(e) => set({ ...entry, amount: e.target.value })} />
                </label>
                <label className="checkline">
                  <input type="checkbox" checked={entry.none} onChange={(e) => set({ ...entry, none: e.target.checked })} />
                  <span>keine Korrektur (die Staffel gilt)</span>
                </label>
              </div>
            )
          })}
        </fieldset>
      ))}
    </>
  )
}

export default function PeriodCard({ onChanged }: { onChanged?: () => Promise<void> } = {}) {
  const { property, reload } = useProperty()
  const toast = useToast()
  // Das Seitenfenster (#346 Schritt 7, M18): `change` für einen neuen Rhythmus, oder der Wechsel, der entfernt wird.
  const [open, setOpen] = useState<{ kind: 'change' } | { kind: 'remove'; from: string } | null>(null)
  // Laienprobe B4: Vorgabe ist der Wechsel ab dem laufenden Monat; frühere Zeiträume bleiben, wie sie sind.
  const [form, setForm] = useState<RhythmForm>({ mode: 'change', month: 1, from: localToday().slice(0, 7) })
  const [understood, setUnderstood] = useState(false)
  const [preview, setPreview] = useState<PeriodChangePreview | null>(null)
  const [answers, setAnswers] = useState<AnswerForm | null>(null)
  // Fehler als Sammelmeldung im Fuß des Seitenfensters (#346, Schritt 3 und 7)
  const errors = useFormError<'from'>()
  const setError = errors.set
  const [busy, setBusy] = useState(false)
  // Eine Vorschau ist nach einer Änderung des Formulars verfallen (M2): Das Fenster sagt dann, dass sie neu nötig ist.
  const [stale, setStale] = useState(false)
  if (!property) return null
  const rules = rulesOf(property)

  function start(next: { kind: 'change' } | { kind: 'remove'; from: string }) {
    setForm({ mode: 'change', month: 1, from: localToday().slice(0, 7) })
    setPreview(null)
    setAnswers(null)
    setUnderstood(false)
    setStale(false)
    errors.clear()
    setOpen(next)
    if (next.kind === 'remove') void ask(withoutChange(rules, next.from))
  }

  // Durchsicht M2 (vorbestehend): Gespeichert werden die Regeln der Vorschau. Ändert sich danach das Formular, gälte die
  // Vorschau für einen anderen Monat als den im Feld; sie verfällt deshalb samt Antworten und Bestätigung, und „Speichern“
  // ist bis zur nächsten Vorschau gesperrt.
  function changeForm(next: RhythmForm) {
    setForm(next)
    if (preview !== null) setStale(true)
    setPreview(null)
    setAnswers(null)
    setUnderstood(false)
  }

  function close() {
    setOpen(null)
    setPreview(null)
    setAnswers(null)
    setUnderstood(false)
    errors.clear()
  }

  async function ask(next: ReturnType<typeof nextRules>) {
    if (!property) return
    if ('error' in next) { errors.report([{ field: next.field, short: next.short, text: next.error }]); return }
    setError('')
    setBusy(true)
    try {
      const p = await api<PeriodChangePreview>(`/api/properties/${property.id}/period/preview`, { method: 'POST', body: JSON.stringify({ rules: next }) })
      setPreview(p)
      setAnswers(initialAnswers(p))
      setUnderstood(false)
      setStale(false)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!property || !preview || !answers) return
    const given = answersOf(preview, answers)
    if ('error' in given) { setError(given.error); return }
    setBusy(true)
    try {
      await api<Property>(`/api/properties/${property.id}/period`, { method: 'PUT', body: JSON.stringify({ rules: preview.rules, answers: { ...given, understood } }) })
      const done = preview
      close()
      await reload()
      await onChanged?.()
      // Laienprobe B7: was jetzt gilt und bis wann der Rumpf zugehen muss.
      toast(periodChangedText(done))
    } catch (e) {
      // 409: veraltete Vorschau oder fehlende Angaben. Die Antwort bringt die neue Vorschau mit
      // (Durchsicht von #226, M2); sie ersetzt die alte, die Antworten werden neu vorbelegt.
      const fresh = conflictPreview(e)
      if (fresh) {
        setPreview(fresh)
        setAnswers(answersAfterConflict(fresh, preview.token, answers))
      }
      // Review Runde 1: Die Bestätigung galt der alten Vorschau.
      setUnderstood(false)
      setError(`${errorText(e)} Bitte prüfen Sie die Vorschau erneut.`)
    } finally {
      setBusy(false)
    }
  }

  // Gespeichert wird erst nach der Vorschau, ohne Sperre der Vorschau und, bei abgelaufener Frist, mit der Bestätigung.
  const passed = preview?.effects.some((e) => e.passed) ?? false
  const canSave = preview !== null && answers !== null && preview.blocked.length === 0 && (!passed || understood)
  const title = open?.kind === 'remove' ? `Wechsel ab ${changeLabel(open.from)} entfernen` : 'Abrechnungszeitraum ändern'

  return (
    <Card title={<><Term id="billingPeriod">Abrechnungszeitraum</Term></>}>
      {/* Sichtprüfung E4: der Stand als Satz, die Erklärung darunter statt in derselben Zeile */}
      <p>{rhythmText(rules)}.</p>
      <small className="muted">
        Wählen Sie einen anderen Beginn nur, wenn Ihr Mietvertrag oder Ihr Messdienst ihn vorgibt. Weicht nur die Heizung ab,
        stellen Sie das in der Karte „Heizung“ ein; der Zeitraum der übrigen Kosten bleibt dann, wie er ist.
      </small>
      <div className="row">
        <button className="btn secondary" onClick={() => start({ kind: 'change' })}>Abrechnungszeitraum ändern</button>
        {rules.changes.map((c) => (
          <button key={c} className="btn secondary" onClick={() => start({ kind: 'remove', from: c })}>Wechsel ab {changeLabel(c)} entfernen …</button>
        ))}
      </div>
      {open && (
        <Drawer
          key={open.kind === 'remove' ? `entfernen-${open.from}` : 'wechsel'}
          open
          title={title}
          subtitle={`Bisher: ${rhythmText(rules)}`}
          width={560}
          onClose={close}
          onSubmit={() => { if (canSave && !busy) void apply() }}
          // Was der Vermieter eingibt; die Vorschau selbst lädt das Fenster nach.
          value={{ form, answers, understood }}
          busy={busy}
          errors={errors}
          actions={<button className="btn" disabled={busy || !canSave} onClick={() => void apply()}>Speichern</button>}
        >
          {open.kind === 'change' && (
            <>
              <RhythmFields form={form} onChange={changeForm} fromField={errors.field('from')} />
              <div className="row">
                <button className="btn secondary" disabled={busy} onClick={() => void ask(nextRules(rules, form))}>Vorschau</button>
              </div>
            </>
          )}
          {!preview && (
            <p className="muted">
              {open.kind === 'change'
                ? (stale ? 'Sie haben die Angaben geändert. Fordern Sie die Vorschau erneut an; gespeichert wird erst danach.' : 'Die Vorschau zeigt, was sich ändert; gespeichert wird erst danach.')
                : busy ? 'Die Vorschau wird geladen …' : 'Die Vorschau ließ sich nicht laden.'}
            </p>
          )}
          {/* Durchsicht K2: Scheitert die Vorschau zum Entfernen, lässt sie sich erneut anfordern. */}
          {open.kind === 'remove' && !preview && !busy && (
            <div className="row">
              <button className="btn secondary" onClick={() => void ask(withoutChange(rules, open.from))}>Vorschau erneut laden</button>
            </div>
          )}
          {preview && answers && (
            <div className="stack">
              <h3>Nach dem Wechsel</h3>
              <p>{preview.periods.map((p) => (p.short ? `${p.label} (Rumpf)` : p.label)).join(' · ')}</p>
              {preview.newShort.length > 0 && (
                <div className="warn">
                  <Term id="shortPeriod">Rumpfzeitraum</Term> {preview.newShort.map((p) => p.label).join(', ')}. Eine Verkürzung braucht einen sachlichen Grund,
                  etwa die Angleichung an den Messdienst. Legt Ihr Mietvertrag den Zeitraum fest, braucht die Umstellung die Zustimmung der Mieter.
                </div>
              )}
              {preview.blocked.map((b) => <NoticeBox key={b} level="error" action={b} />)}
              <MoveList moves={preview.moves} />
              {preview.assessments.map((a) => <p key={a.assessmentId} className="muted">Belegauswertung „{a.file}“: künftig {a.toLabel}.</p>)}
              {/* Integrationsdurchsicht zu #415: eigene Anschreiben je Mieter eines Zeitraums, der sich ändert, entfallen. */}
              {(preview.letters ?? []).map((t) => <p key={t} className="muted">{t}</p>)}
              <PreviewAnswers preview={preview} answers={answers} onChange={setAnswers} />
              <EffectsList effects={preview.effects} earliest={earliestOpenChange(localToday())} />
              {passed && (
                <label className="checkline">
                  <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
                  <span>Ich habe verstanden, dass ich aus einem Zeitraum mit abgelaufener Frist keine Nachzahlung mehr verlangen kann.</span>
                </label>
              )}
            </div>
          )}
        </Drawer>
      )}
    </Card>
  )
}
