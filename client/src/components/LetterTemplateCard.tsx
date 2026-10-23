// Die Vorlage des Anschreibens für alle Objekte (#415), in den Einstellungen. Die Karte zeigt nur an;
// bearbeitet wird im Seitenfenster (eine Karte, die ein Seitenfenster öffnet, speichert dort).
import { useCallback, useEffect, useState } from 'react'
import type { LetterTemplates } from '../types'
import { ADJUSTMENT_MODES, LETTER_BLOCK_IDS, SAMPLE_LETTER_VALUES } from '../../../shared/letter.ts'
import { api, errorText } from '../api'
import Card from './Card'
import { asTemplates } from '../letterView'
import LetterDrawer, { type LetterSave } from './LetterDrawer'
import { NoticeBox } from './Notice'
import { useToast } from './feedback'

export default function LetterTemplateCard({ reload }: { reload: () => Promise<void> }) {
  const [templates, setTemplates] = useState<LetterTemplates | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const load = useCallback(() => api<unknown>('/api/letter-texts').then((t) => { setTemplates(asTemplates(t)); setError('') }).catch((e) => setError(errorText(e))), [])
  useEffect(() => { void load() }, [load])

  async function save(s: LetterSave) {
    await api('/api/letter-texts', { method: 'PUT', body: JSON.stringify({ texts: s.texts, ...(s.adjust ? { adjustDefault: s.adjust.mode } : {}), ...(typeof s.printLetter === 'boolean' ? { printLetter: s.printLetter } : {}) }) })
    setOpen(false)
    await Promise.all([load(), reload()])
    toast('Vorlage des Anschreibens gespeichert.')
  }

  const own = templates ? LETTER_BLOCK_IDS.filter((b) => typeof templates.installation[b] === 'string').length : 0
  const adjustLabel = ADJUSTMENT_MODES.find((m) => m.id === templates?.adjustDefault)?.label ?? ''
  return (
    <Card title="Anschreiben zur Abrechnung" aside={templates ? <button className="btn secondary" onClick={() => setOpen(true)}>Vorlage bearbeiten</button> : undefined}>
      {error && <NoticeBox level="error" action={`Die Vorlage ließ sich nicht laden. ${error}`} />}
      <p className="muted">
        Jede Abrechnung beginnt mit einem Brief an den Mieter: Betreff, Anrede, Ergebnis mit Zahlungsfrist oder
        Erstattung, auf Wunsch die Anpassung der Vorauszahlung, Belegeinsicht und Gruß. Welcher Satz erscheint,
        entscheidet Mietfuchs; Sie schreiben nur den Text. Ein Objekt kann abweichen (Seite Abrechnung).
      </p>
      {templates && (
        <p className="m-0">
          {own === 0 ? 'Es gelten die Vorgaben von Mietfuchs.' : `${own} von ${LETTER_BLOCK_IDS.length} Bausteinen mit eigenem Text.`}
          {' '}Vorgabe für die Vorauszahlung: {adjustLabel}.
          {' '}{templates.printLetter === false ? 'Das Anschreiben wird nicht mitgedruckt.' : 'Das Anschreiben wird mitgedruckt.'}
        </p>
      )}
      {templates && (
        <LetterDrawer
          open={open}
          level="installation"
          title="Vorlage des Anschreibens"
          intro="Gilt für alle Objekte, solange ein Objekt oder ein Mieter nichts anderes festlegt. Die Vorschau setzt Beispielwerte ein."
          base={templates.defaults}
          own={templates.installation}
          values={SAMPLE_LETTER_VALUES}
          adjust={{ mode: templates.adjustDefault, cents: null }}
          printLetter={{ value: templates.printLetter ?? true }}
          onClose={() => setOpen(false)}
          onSave={save}
        />
      )}
    </Card>
  )
}
