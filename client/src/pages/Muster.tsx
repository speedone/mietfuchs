import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Field, { RequiredLegend } from '../components/Field'
import MonthField from '../components/MonthField'
import Term from '../components/Term'
import Table from '../components/Table'
import Drawer from '../components/Drawer'
import DraftActions from '../components/DraftActions'
import EmptyState from '../components/EmptyState'
import Switcher from '../components/Switcher'
import { ErrorSummary, useFormError } from '../components/ErrorSummary'
import { NoticeBox, TextNotice } from '../components/Notice'
import { useConfirm, useToast } from '../components/feedback'
import { useDraft } from '../useDraft'

// Musterseite (#346 Schritt 12, Spezifikation Abschnitt 9): alle Bausteine der Oberfläche auf einer Seite, mit festen
// Werten und ohne Anfrage an den Server. Aufgerufen mit `?muster`, nicht in der Navigation. `npm run screenshots`
// fotografiert sie hell und dunkel, der Browserlauf prüft sie mit axe und der Messung abgeschnittener Felder wie jede
// Seite. Wer einen Baustein ändert, sieht ihn hier.
const UNITS = [{ value: 'eg', label: 'EG links' }, { value: 'og', label: 'OG rechts' }]

export default function Muster() {
  const toast = useToast()
  const confirm = useConfirm()
  const errors = useFormError<'betrag'>()
  const [open, setOpen] = useState(false)
  const [drawerForm, setDrawerForm] = useState({ name: '' })
  const [month, setMonth] = useState('2025-03')
  const [unit, setUnit] = useState('eg')
  const draft = useDraft('og')
  // Die Sammelmeldung mit einer Meldung am Feld, ohne den Fokus beim Laden zu nehmen
  useEffect(() => {
    errors.report([{ field: 'betrag', short: 'Betrag fehlt', text: 'Betrag: Bitte tragen Sie den Betrag laut Rechnung ein.' }], { focus: false })
  }, [])

  return (
    <>
      <PageHeader
        context="none"
        title="Musterseite"
        subtitle="Alle Bausteine der Oberfläche mit festen Werten. Nur zum Prüfen, nicht in der Navigation."
        actions={<button className="btn" onClick={() => toast('Eine Mitteilung.')}>+ Mitteilung anlegen</button>}
      />

      <Card title="Knöpfe">
        <div className="row">
          <button className="btn">Primär</button>
          <button className="btn secondary">Sekundär</button>
          <button className="btn ghost">Ruhig</button>
          <button className="btn small">Klein</button>
          <button className="btn" disabled>Gesperrt</button>
          <button className="btn ghost danger-ghost ml-auto" onClick={() => void confirm({ title: 'Muster löschen?', message: 'Eine Rückfrage mit Gefahr; der Startfokus steht auf „Abbrechen“.', confirmLabel: 'Löschen', danger: true })}>
            Muster löschen …
          </button>
        </div>
      </Card>

      <Card title="Felder in Stufen">
        <RequiredLegend />
        <div className="field-grid">
          <Field label="Betrag €" required width="s" {...errors.field('betrag')}>
            <input inputMode="decimal" defaultValue="" />
          </Field>
          <Field label="Kurzer Text" width="m"><input defaultValue="Hausmeister" /></Field>
          <Field label="Bezeichnung" width="l" hint="Ein Hinweis unter dem Feld."><input defaultValue="Lindenweg 12" /></Field>
          <Field label={<><Term id="allocationKey">Umlageschlüssel</Term> der Wohnung</>} width="m">
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </Field>
          <MonthField label="Ab Monat" value={month} onChange={setMonth} today="2026-10-21" width="s" />
          <Field label="Notiz" width="full"><textarea defaultValue="Ein Textfeld über die ganze Breite." /></Field>
        </div>
        <ErrorSummary errors={errors} />
      </Card>

      <Card title="Seitenfenster" aside={<button className="btn secondary" onClick={() => { setDrawerForm({ name: '' }); setOpen(true) }}>+ Muster anlegen</button>}>
        <p className="muted">„+ … anlegen“ öffnet ein Seitenfenster; Esc mit Eingabe fragt nach.</p>
        {open && (
          <Drawer open title="Muster anlegen" onClose={() => setOpen(false)} value={drawerForm}
            actions={<button className="btn" onClick={() => { setOpen(false); toast('Angelegt.') }}>Anlegen</button>}>
            <Field label="Name" required width="l"><input value={drawerForm.name} onChange={(e) => setDrawerForm({ name: e.target.value })} /></Field>
          </Drawer>
        )}
      </Card>

      <Card title="Entwurf am Feld">
        <div className="row">
          <Field label="Wohnung" width="m">
            <select value={draft.value} onChange={(e) => draft.set(e.target.value)}>
              {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </Field>
          <DraftActions draft={draft} what="Wohnung" onSave={async () => { toast('Gespeichert.') }} />
        </div>
      </Card>

      <Card title="Hinweise">
        <NoticeBox level="error" title="Fehler" action="Eine Position wird nicht verteilt, weil Angaben fehlen." fix={{ label: 'Hier beheben →', onClick: () => toast('Sprung zur Stelle.') }} />
        <NoticeBox level="warning" title="Warnung" action="Geld landet anders als vermutlich gewollt." more="Begründung aus einer Fundstelle (BGH VIII ZR 156/11)." />
        <NoticeBox level="hint" title="Hinweis" action="Bitte prüfen, ohne sicheren Fehler." />
        <TextNotice level="info" text="Eine Auskunft als fertiger Text. Sie wird in Sätze zerlegt." />
        <div className="ok">✓ Ein Erfolg.</div>
      </Card>

      <Card title="Tabelle">
        <Table className="stacked">
          <thead><tr><th>Wohnung</th><th>Mieter</th><th className="num">Betrag</th></tr></thead>
          <tbody>
            <tr><td data-label="Wohnung">EG links</td><td data-label="Mieter">Anna Becker</td><td className="num" data-label="Betrag">930,00 €</td></tr>
            <tr><td data-label="Wohnung">OG rechts</td><td data-label="Mieter">Jonas Hartmann</td><td className="num" data-label="Betrag">740,00 €</td></tr>
          </tbody>
        </Table>
      </Card>

      <Card title="Umschalter und Leerzustand">
        <Switcher label="Wohnung" className="switcher-field width-s" value={unit} options={UNITS} onChange={setUnit} />
        <EmptyState action={{ label: 'Wohnung anlegen', onClick: () => toast('Anlegen.') }}>Noch keine Wohnung erfasst.</EmptyState>
      </Card>
    </>
  )
}
