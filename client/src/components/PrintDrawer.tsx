// „Drucken“ auf der Seite Abrechnung: ein Seitenfenster vor dem Druck mit der Wahl, was gedruckt wird (alle Mieter oder
// einer), und den Einstellungen zum Druck. Gedruckt wird erst nach dem Schließen des Fensters, wie beim Ableseformular.
//
// Die Häkchen bleiben, was sie auf der Seite waren: „Anschreiben mitdrucken“ gilt nur für diesen Druck, die drei übrigen
// sind ein Entwurf der Einstellungen mit eigenem „Speichern“ (#309). Das Fenster ändert sie unmittelbar (Vorschau und
// Druck folgen ihnen); „Abbrechen“ stellt den Stand von vorher her (`onClose` der Seite). `value` ist die ganze Auswahl.
import type { ReactNode } from 'react'
import Drawer from './Drawer'
import Field from './Field'
import DraftActions from './DraftActions'
import type { Draft } from '../useDraft'

export type PrintSettings = { printFoldMarks: boolean; printAttachments: boolean; printFooter: boolean }
// `all` druckt alle Mieter, sonst die Kennung eines Mietverhältnisses.
export type PrintScope = 'all' | string

export default function PrintDrawer({ scope, onScope, tenants, withLetter, onLetter, letterNote, draft, onSaveDraft, draftNote, attachmentsLoading, paper, blocked, warnings, onPrint, onClose, busy }: {
  scope: PrintScope
  onScope: (scope: PrintScope) => void
  tenants: { id: string; label: string }[]
  withLetter: boolean
  onLetter: (on: boolean) => void
  // Der Satz zu „Anschreiben mitdrucken“, wenn es von der Vorgabe abweicht
  letterNote: string | null
  draft: Draft<PrintSettings>
  onSaveDraft: (value: PrintSettings) => Promise<unknown>
  draftNote: string
  attachmentsLoading: boolean
  // Mit Briefpapier entfällt die Fußzeile von Mietfuchs
  paper: boolean
  // Warum gerade nicht gedruckt werden kann (Belegkopien, Briefpapier werden vorbereitet), sonst null
  blocked: string | null
  // Was vor dem Druck zu prüfen ist (Anschrift, Länge des Anschreibens), für die gewählten Mieter
  warnings: ReactNode
  onPrint: () => void
  onClose: () => void
  busy: boolean
}) {
  const settings = draft.value
  const print = () => { if (!blocked && !busy) onPrint() }
  return (
    <Drawer
      open
      title="Drucken"
      subtitle="Nebenkostenabrechnung drucken oder als PDF speichern (im Druckdialog „Als PDF speichern“)."
      hint="Strg+S druckt · Esc schließt"
      onClose={onClose}
      onSubmit={print}
      busy={busy}
      value={{ scope, withLetter, ...settings }}
      actions={<>
        <button className="btn" disabled={!!blocked || busy} aria-describedby={blocked ? 'print-blocked' : undefined} onClick={print}>Drucken</button>
        {blocked && <span id="print-blocked" className="muted">{blocked}</span>}
      </>}
    >
      <Field label="Was drucken?">
        <select value={scope} onChange={(e) => onScope(e.target.value)}>
          <option value="all">{`Alle Mieter (${tenants.length})`}</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </Field>
      <div className="grid gap-2">
      {/* Teil 2 von #415: nur für diesen Druck; die Vorgabe steht in der Vorlage des Objekts bzw. in den Einstellungen. */}
      <label className="checkline" title="Ein Brief an den Mieter als erste Seite; ohne ihn beginnt die Aufstellung mit Anschrift, Datum und Betreff">
        <input type="checkbox" checked={withLetter} onChange={(e) => onLetter(e.target.checked)} />
        <span>Anschreiben mitdrucken</span>
      </label>
      {letterNote && <p className="muted m-0">{letterNote}</p>}
      <label className="checkline" title="Marken am linken Rand des Anschreibens zum Falten für einen Fensterumschlag (DIN 5008) und zum Lochen">
        <input type="checkbox" checked={settings.printFoldMarks} onChange={(e) => draft.set({ ...settings, printFoldMarks: e.target.checked })} />
        <span>Falz- und Lochmarken drucken</span>
      </label>
      <label className="checkline" title="Kopien der hochgeladenen Beleg-PDFs als Anlage hinter jeder Abrechnung mit ausdrucken">
        <input type="checkbox" checked={settings.printAttachments} onChange={(e) => draft.set({ ...settings, printAttachments: e.target.checked })} />
        <span>
          Belegkopien als Anlage mitdrucken
          {settings.printAttachments && attachmentsLoading && <span className="muted"> (werden vorbereitet …)</span>}
        </span>
      </label>
      <label className="checkline" title="Vermieter, Anschrift, Kontakt und IBAN unten auf der Seite des Anschreibens (Anschrift und Kontakt unter „Einstellungen“ bzw. beim Objekt)">
        <input type="checkbox" checked={settings.printFooter} onChange={(e) => draft.set({ ...settings, printFooter: e.target.checked })} />
        <span>
          Fußzeile mit Kontakt und Bank
          {settings.printFooter && paper && <span className="muted"> (mit Briefpapier nicht)</span>}
          {/* Druck (#415): Kontakt und Bank stehen im Fuß des Anschreibens, nicht auf jeder Seite der Aufstellung. */}
          {settings.printFooter && !paper && !withLetter && <span className="muted"> (nur mit Anschreiben)</span>}
        </span>
      </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DraftActions draft={draft} onSave={onSaveDraft} what="Druckeinstellungen" />
        {draft.dirty && <span className="muted">{draftNote}</span>}
      </div>
      {warnings}
    </Drawer>
  )
}
