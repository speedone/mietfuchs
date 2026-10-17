// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HeatingSelfSetup from './HeatingSelfSetup'
import { UIProvider } from './feedback'
import type { HeatingPlant } from '../types'

const plant = { id: 'hp', energy: 'gas', hotWater: 'combined', capture: null, areaBasisHeat: 'area' } as HeatingPlant
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('HeatingSelfSetup', () => {
  it('nennt bei 409 die Positionen und schickt Teil und Ziel beim zweiten Versuch mit', async () => {
    const bodies: unknown[] = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      bodies.push(body)
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return new Response(JSON.stringify({ error: 'Für diese Heizposition braucht die eigene Abrechnung Teil und Ziel: „Gas“.', items: [{ id: 'c1', period: '2025-01', description: 'Gas', amountCents: 600000, key: 'area', heatingPart: 'fuel' }] }), { status: 409 })
      }
      return new Response(JSON.stringify({ plant: { ...plant, method: 'self' }, created: [], converted: 1 }), { status: 200 })
    })
    const onDone = vi.fn()
    render(<HeatingSelfSetup plant={plant} period="2025-01" onDone={onDone} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText(/Heizung in %/), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText(/Warmwasser in %/), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText(/Wärmeschutz/), { target: { value: 'notApplies' } })
    fireEvent.click(screen.getByRole('button', { name: 'Umstellen' }))
    await screen.findByLabelText(/Ziel für „Gas“/)
    const ziel = screen.getByLabelText(/Ziel für „Gas“/) as HTMLSelectElement
    // Der angezeigte Wert entspricht dem gespeicherten: bei verbundener Bereitung nur „beides“.
    expect([...ziel.options].map((o) => o.value)).toEqual(['', 'both'])
    fireEvent.change(ziel, { target: { value: 'both' } })
    fireEvent.click(screen.getByRole('button', { name: 'Umstellen' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodies[1]).toMatchObject({ items: [{ id: 'c1', heatingPart: 'fuel', heatingTarget: 'both' }] })
  })

  it('Durchsicht von #239: nennt die Heizperiode, rät bei „Weiß ich nicht“ zum Pflichtanteil und fragt bei Fernwärme nicht nach dem Wärmeschutz', () => {
    render(<HeatingSelfSetup plant={plant} period="2025-01" periodLabel="2025" onDone={() => {}} onCancel={() => {}} />)
    expect(screen.getByText(/er gilt ab der Heizperiode 2025/)).toBeTruthy()
    expect(screen.getByText(/Steht im Mietvertrag ein Anteil, gilt er/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Wärmeschutz/), { target: { value: 'unknown' } })
    fireEvent.change(screen.getByLabelText(/Heizung in %/), { target: { value: '50' } })
    expect(screen.getByText(/Mit 70 % liegen Sie in jedem Fall richtig/)).toBeTruthy()
    cleanup()
    render(<HeatingSelfSetup plant={{ ...plant, energy: 'districtHeating' }} period="2025-01" onDone={() => {}} onCancel={() => {}} />)
    expect(screen.queryByLabelText(/Wärmeschutz/)).toBeNull()
  })

  it('Durchsicht von #242, G-I1: passt eine Schätzung nach dem Wechsel der Erfassung nicht mehr, sagt die Meldung es', async () => {
    const notice = 'Eine Schätzung nach § 9a passt nicht mehr zur Erfassung der Heizperiode: „C“ (Heizung, eingetragen mit Wärmezählern in kWh).'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ plant: { ...plant, method: 'self' }, created: [], converted: 0, estimatesNotice: notice }), { status: 200 }))
    const onDone = vi.fn()
    render(<UIProvider><HeatingSelfSetup plant={plant} period="2025-01" onDone={onDone} onCancel={() => {}} /></UIProvider>)
    fireEvent.change(screen.getByLabelText(/Heizung in %/), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText(/Warmwasser in %/), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText(/Wärmeschutz/), { target: { value: 'notApplies' } })
    fireEvent.click(screen.getByRole('button', { name: 'Umstellen' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(screen.getByText(notice)).toBeTruthy()
  })
})
