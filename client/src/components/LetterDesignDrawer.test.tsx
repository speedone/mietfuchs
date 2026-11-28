// @vitest-environment jsdom
// Das Seitenfenster „Logo und Briefpapier“ (#415, Teil 2b): eine gewählte Datei geht erst mit „Speichern“ hinaus,
// eine falsche wird am Feld abgelehnt, die Ränder werden alle auf einmal gemeldet.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UIProvider } from './feedback'
import LetterDesignDrawer, { PaperPreview } from './LetterDesignDrawer'
import { DEFAULT_LETTER_DESIGN } from '../../../shared/letterDesign.ts'
import type { DesignPayload } from '../letterDesignForm'

afterEach(cleanup)

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const show = (onSave: (p: DesignPayload) => Promise<void>) => render(
  <UIProvider>
    <LetterDesignDrawer open level="installation" title="Logo und Briefpapier" stored={DEFAULT_LETTER_DESIGN} installation={DEFAULT_LETTER_DESIGN} onClose={() => {}} onSave={onSave} />
  </UIProvider>,
)

test('ein gewähltes Logo geht erst mit „Speichern“ hinaus', async () => {
  const onSave = vi.fn(async (_p: DesignPayload) => {})
  show(onSave)
  fireEvent.change(screen.getByLabelText('Logo'), { target: { files: [new File([PNG], 'logo.png', { type: 'image/png' })] } })
  await screen.findByText('logo.png')
  expect(onSave).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  const payload = onSave.mock.calls[0]?.[0]
  expect(payload?.design).toMatchObject({ logo: 'new', paper: 'remove' })
  expect(payload?.files.logo?.name).toBe('logo.png')
})

test('eine falsche Datei wird am Feld abgelehnt und kommt nicht in den Entwurf', async () => {
  const onSave = vi.fn(async (_p: DesignPayload) => {})
  show(onSave)
  fireEvent.change(screen.getByLabelText('Logo'), { target: { files: [new File(['GIF89a'], 'logo.gif', { type: 'image/gif' })] } })
  expect((await screen.findAllByText(/PNG, JPG oder SVG/)).length).toBeGreaterThan(0)
  expect(screen.queryByText('logo.gif')).toBeNull()
})

// #691: Logo und Briefpapier zusammen. Das Logo druckt zwischen dem Rand oben und dem Informationsblock; lässt der Rand
// wenig oder keinen Platz, sagt es das Fenster, bevor gedruckt wird, und die Vorschau zeigt, was gedruckt wird.
test('Logo und Briefpapier: ein großer Rand oben nennt, dass das Logo kleiner oder gar nicht druckt', async () => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
  const stored = { ...DEFAULT_LETTER_DESIGN, logo: { file: 'logo-0123456789abcdef.png', type: 'png' as const }, paper: { file: 'paper-0123456789abcdef.png', type: 'png' as const } }
  render(
    <UIProvider>
      <LetterDesignDrawer open level="installation" title="Logo und Briefpapier" stored={stored} installation={stored} onClose={() => {}} onSave={async () => {}} />
    </UIProvider>,
  )
  // Vorgabe 20 mm: Platz genug, kein Hinweis
  expect(screen.queryByText(/Logo wird/)).toBeNull()
  fireEvent.change(screen.getByLabelText(/Rand oben/), { target: { value: '36' } })
  expect(await screen.findByText('Logo wird kleiner gedruckt')).toBeTruthy()
  fireEvent.change(screen.getByLabelText(/Rand oben/), { target: { value: '45' } })
  expect(await screen.findByText('Logo wird nicht gedruckt')).toBeTruthy()
  vi.unstubAllGlobals()
})

test('Vorschau: ohne Platz zeigt sie kein Logo, wie der Druck', () => {
  const margins = { top: 45, right: 20, bottom: 30, left: 25 }
  const { container, rerender } = render(<PaperPreview paper="papier.png" logo="logo.png" margins={margins} />)
  expect(container.querySelector('.paper-preview-logo')).toBeNull()
  rerender(<PaperPreview paper="papier.png" logo="logo.png" margins={{ ...margins, top: 25 }} />)
  expect(container.querySelector('.paper-preview-logo')).not.toBeNull()
  // Ohne Briefpapier steht das Logo immer da
  rerender(<PaperPreview paper={null} logo="logo.png" margins={{}} />)
  expect(container.querySelector('.paper-preview-logo')).not.toBeNull()
})
