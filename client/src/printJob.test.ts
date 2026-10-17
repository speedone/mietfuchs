// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startPrint, type PrintJob } from './printJob'

describe('startPrint', () => {
  const jobs: PrintJob[] = []
  const start = (options: Parameters<typeof startPrint>[0]) => {
    const job = startPrint(options)
    jobs.push(job)
    return job
  }
  beforeEach(() => {
    vi.useFakeTimers()
    document.title = 'Mietfuchs'
    vi.spyOn(window, 'print').mockImplementation(() => {})
  })
  afterEach(() => {
    // Offene Aufträge abbrechen, sonst räumt ein Auftrag dieses Tests im nächsten mit auf
    for (const job of jobs.splice(0)) job.cancel()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('setzt den Titel als Dateinamen und druckt nach der Verzögerung', () => {
    start({ title: 'Abrechnung 2025 EG/links', delayMs: 50 })
    expect(document.title).toBe('Abrechnung 2025 EG-links')
    expect(window.print).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(window.print).toHaveBeenCalledOnce()
  })

  it('räumt bei afterprint noch nicht auf, sondern erst bei der nächsten Bedienung (Safari)', () => {
    document.title = 'Vorher'
    const onDone = vi.fn()
    start({ title: 'Steuer', onDone })
    vi.advanceTimersByTime(100)
    window.dispatchEvent(new Event('afterprint'))
    expect(document.title).toBe('Steuer')
    expect(onDone).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('pointerdown'))
    expect(document.title).toBe('Vorher')
    expect(onDone).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('keydown'))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('ein Druck über das Browsermenü räumt vorher auf, auch ohne Klick in die Seite', () => {
    document.title = 'Vorher'
    const onDone = vi.fn()
    start({ title: 'Steuer', onDone })
    vi.advanceTimersByTime(100)
    window.dispatchEvent(new Event('afterprint'))
    window.dispatchEvent(new Event('beforeprint'))
    expect(document.title).toBe('Vorher')
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('eine Bedienung oder ein beforeprint vor afterprint räumt nicht auf', () => {
    const onDone = vi.fn()
    start({ title: 'Steuer', onDone })
    vi.advanceTimersByTime(100)
    window.dispatchEvent(new Event('beforeprint'))
    window.dispatchEvent(new Event('pointerdown'))
    expect(onDone).not.toHaveBeenCalled()
    expect(document.title).toBe('Steuer')
  })

  it('cancel stellt den Titel sofort her, druckt nicht und ruft onDone nicht', () => {
    document.title = 'Vorher'
    const onDone = vi.fn()
    const job = start({ title: 'Steuer', onDone })
    job.cancel()
    vi.advanceTimersByTime(100)
    expect(window.print).not.toHaveBeenCalled()
    expect(document.title).toBe('Vorher')
    window.dispatchEvent(new Event('afterprint'))
    window.dispatchEvent(new Event('pointerdown'))
    expect(onDone).not.toHaveBeenCalled()
  })

  it('cancel nach afterprint entfernt auch die Horcher auf die nächste Bedienung', () => {
    document.title = 'Vorher'
    const onDone = vi.fn()
    const job = start({ title: 'Steuer', onDone })
    vi.advanceTimersByTime(100)
    window.dispatchEvent(new Event('afterprint'))
    job.cancel()
    expect(document.title).toBe('Vorher')
    document.title = 'Später'
    window.dispatchEvent(new Event('pointerdown'))
    expect(document.title).toBe('Später')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('zwei Drucke hintereinander stellen jeweils den Titel von davor her', () => {
    document.title = 'Vorher'
    start({ title: 'A' })
    vi.advanceTimersByTime(100)
    window.dispatchEvent(new Event('afterprint'))
    window.dispatchEvent(new Event('pointerdown'))
    expect(document.title).toBe('Vorher')
    start({ title: 'B' })
    vi.advanceTimersByTime(100)
    expect(document.title).toBe('B')
    window.dispatchEvent(new Event('afterprint'))
    window.dispatchEvent(new Event('keydown'))
    expect(document.title).toBe('Vorher')
  })
})
