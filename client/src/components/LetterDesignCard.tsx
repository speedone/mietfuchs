// Logo und Briefpapier für alle Objekte (#415, Teil 2b), in den Einstellungen. Die Karte zeigt nur an; bearbeitet wird
// im Seitenfenster (eine Karte, die ein Seitenfenster öffnet, speichert dort).
import { useCallback, useEffect, useState } from 'react'
import type { LetterDesigns } from '../../../shared/types.ts'
import { api, errorText } from '../api'
import Card from './Card'
import LetterDesignDrawer, { designSummary, sendLetterDesign } from './LetterDesignDrawer'
import { NoticeBox } from './Notice'
import { asLetterDesigns } from '../letterDesignView'
import { useToast } from './feedback'

export default function LetterDesignCard() {
  const [designs, setDesigns] = useState<LetterDesigns | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const load = useCallback(() => api<unknown>('/api/letter-design').then((d) => { setDesigns(asLetterDesigns(d)); setError('') }).catch((e) => setError(errorText(e))), [])
  useEffect(() => { void load() }, [load])

  return (
    <Card title="Logo und Briefpapier" aside={designs ? <button className="btn secondary" onClick={() => setOpen(true)}>Gestaltung bearbeiten</button> : undefined}>
      {error && <NoticeBox level="error" action={`Die Gestaltung ließ sich nicht laden. ${error}`} />}
      <p className="muted">
        Ein Logo oben rechts im Briefkopf und ein eigenes Briefpapier als Hintergrund der Abrechnung, für alle Objekte;
        ein Objekt kann abweichen (Seite Abrechnung). Das Anschriftfeld für Fensterumschläge bleibt frei.
      </p>
      {designs && <p className="m-0">{designSummary(designs.installation)}</p>}
      {designs && (
        <LetterDesignDrawer
          open={open}
          level="installation"
          title="Logo und Briefpapier"
          stored={designs.installation}
          installation={designs.installation}
          onClose={() => setOpen(false)}
          onSave={async (payload) => {
            await sendLetterDesign('/api/letter-design', payload)
            setOpen(false)
            await load()
            toast('Logo und Briefpapier gespeichert.')
          }}
        />
      )}
    </Card>
  )
}
