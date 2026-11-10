// @vitest-environment jsdom
// Kopieren in die Zwischenablage (#528, Rückmeldung zur Kopplung): Über http im Heimnetz oder mit einem Zertifikat,
// dem der Browser nicht traut, fehlt navigator.clipboard (nur in sicherem Kontext). Dann kopiert ein verstecktes
// Textfeld mit execCommand('copy').
import { afterEach, expect, test, vi } from 'vitest'
import { copyText } from './copyText'

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

function stubExec(result: boolean) {
  const seen: string[] = []
  const exec = vi.fn((cmd: string) => {
    const field = document.querySelector('textarea')
    seen.push(`${cmd}:${field?.value ?? ''}:${document.activeElement === field}`)
    return result
  })
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
  return seen
}

test('mit Zwischenablage des Browsers: writeText', async () => {
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const seen = stubExec(true)
  expect(await copyText('ABCD-EFGH')).toBe(true)
  expect(writeText).toHaveBeenCalledWith('ABCD-EFGH')
  expect(seen).toEqual([])
})

test('ohne Zwischenablage (http im Heimnetz): verstecktes Textfeld, danach wieder weg', async () => {
  vi.stubGlobal('navigator', {})
  const seen = stubExec(true)
  const button = document.createElement('button')
  document.body.append(button)
  button.focus()
  expect(await copyText('ABCD-EFGH')).toBe(true)
  expect(seen).toEqual(['copy:ABCD-EFGH:true'])
  expect(document.querySelector('textarea')).toBeNull()
  // der Fokus kehrt zum Knopf zurück
  expect(document.activeElement).toBe(button)
})

test('writeText abgelehnt: ebenfalls das Textfeld', async () => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('NotAllowedError') }) } })
  const seen = stubExec(true)
  expect(await copyText('x')).toBe(true)
  expect(seen).toEqual(['copy:x:true'])
})

test('geht beides nicht: false', async () => {
  vi.stubGlobal('navigator', {})
  stubExec(false)
  expect(await copyText('x')).toBe(false)
  Object.defineProperty(document, 'execCommand', { value: () => { throw new Error('nein') }, configurable: true })
  expect(await copyText('x')).toBe(false)
  expect(document.querySelector('textarea')).toBeNull()
})
