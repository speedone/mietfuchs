// @vitest-environment jsdom
// Zwei Fenster, dieselben Einstellungen: Die Karte „Vermieter & Zahlung“ schickt beim Speichern die Schlüssel mit, die
// sie schreibt, so wie der Server sie geliefert hat (`ifUnchanged`, settingsSeen.ts). Lehnt der Server ab, steht sein
// Satz in der Karte mit den Werten von jetzt, die Felder zeigen den Stand von jetzt, und was hier geändert wurde, bleibt
// stehen. Was beide geändert haben, und was im Brief zusammengehört (Kontoinhaber und IBAN), entscheidet der Nutzer,
// bevor wieder gespeichert wird. Im selben Fenster gilt nach dem eigenen Speichern der Stand aus der Antwort als gesehen.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AiSettings as AiValues, Settings } from '../types'
import { ApiError } from '../api'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import { AiSettings } from '../components/AiSettings'
import { LANDLORD_GROUPS, LANDLORD_KEYS, LANDLORD_STALE_FIELDS, mergeStale, sameLandlordInput, seenPart, settingsStaleText } from '../settingsSeen'
import Einstellungen from './Einstellungen'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const OLD_IBAN = 'DE89370400440532013000'
const NEW_IBAN = 'DE02120300000000202051'
const OWN_IBAN = 'DE75512108001245126199'
// Wie ein frischer Bestand: Anschrift und Kontakt fehlen, die Karte zeigt dafür leere Felder.
const SETTINGS: Settings = { houseName: '', address: '', landlordName: 'Erika Muster', iban: OLD_IBAN, paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' }
const STALE = 'Die Einstellungen wurden inzwischen geändert. Gespeichert wurde nichts, damit diese Änderung nicht verloren geht.'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const plain = (iban: string) => iban.replace(/\s/g, '')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

type Sent = Record<string, unknown>
type Options = { settings?: Settings; fresh?: unknown }
async function open(answer: (body: Sent, nth: number) => Response, options: Options = {}) {
  const sent: Sent[] = []
  let reloads = 0
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/settings' && init?.method === 'PUT') {
      const body: Sent = { ...JSON.parse(String(init.body)) }
      sent.push(body)
      return answer(body, sent.length)
    }
    if (url === '/api/settings') return json(options.fresh ?? [])
    return json(url.startsWith('/healthz') ? { ok: true } : [])
  })
  const page = (settings: Settings) => (
    <PropertyProvider>
      <UIProvider>
        <Einstellungen settings={settings} reload={async () => { reloads++ }} update={{ status: null, checking: false, checkNow: async () => {} }} />
      </UIProvider>
    </PropertyProvider>
  )
  const view = render(page(options.settings ?? SETTINGS))
  const heading = await screen.findByRole('heading', { name: 'Vermieter & Zahlung' }, SLOW)
  const section = heading.closest('section')
  if (!section) throw new Error('Die Karte „Vermieter & Zahlung“ fehlt.')
  const card = within(section)
  const field = (name: RegExp): HTMLInputElement => card.getByRole('textbox', { name })
  return { sent, card, field, save: () => fireEvent.click(card.getByRole('button', { name: 'Speichern' })), reloads: () => reloads, show: (settings: Settings) => view.rerender(page(settings)) }
}

test('die Karte schickt den geladenen Stand ihrer Schlüssel mit, auch was im Bestand fehlt', async () => {
  const page = await open((body) => json({ ...SETTINGS, ...body }))
  fireEvent.change(page.field(/Kontakt/), { target: { value: 'Tel. 0123 456789' } })
  page.save()
  await waitFor(() => expect(page.sent).toHaveLength(1), SLOW)
  // Fehlendes als `null`, nicht als die leere Zeichenkette des Formulars: Der Server vergleicht mit seinem Stand.
  expect(page.sent[0]?.ifUnchanged).toEqual({ landlordName: 'Erika Muster', iban: OLD_IBAN, paymentDeadlineDays: 30, landlordAddress: null, landlordContact: null })
  expect(page.sent[0]?.landlordContact).toBe('Tel. 0123 456789')
})

test('im selben Fenster gilt nach dem Speichern der Stand aus der Antwort als gesehen', async () => {
  // Der Server liefert, was dasteht: die Anschrift als leere Zeile, den Kontakt wie eingegeben.
  const page = await open((body) => json({ ...SETTINGS, landlordAddress: '', landlordContact: body.landlordContact }))
  fireEvent.change(page.field(/Kontakt/), { target: { value: 'Tel. 0123 456789' } })
  page.save()
  await waitFor(() => expect(page.sent).toHaveLength(1), SLOW)
  fireEvent.change(page.field(/Name des Vermieters/), { target: { value: 'Erika Mustermann' } })
  page.save()
  await waitFor(() => expect(page.sent).toHaveLength(2), SLOW)
  expect(page.sent[1]?.ifUnchanged).toEqual({ landlordName: 'Erika Muster', iban: OLD_IBAN, paymentDeadlineDays: 30, landlordAddress: '', landlordContact: 'Tel. 0123 456789' })
})

test('abgelehnt: Die Karte nennt das Geänderte mit dem Wert von jetzt, zeigt ihn und behält die eigene Eingabe', async () => {
  const now = { ...SETTINGS, iban: NEW_IBAN }
  const page = await open((body, nth) => (nth === 1 ? json({ error: STALE, stale: true, current: now }, 409) : json({ ...now, ...body })))
  fireEvent.change(page.field(/Kontakt/), { target: { value: 'Tel. 0123 456789' } })
  page.save()
  const alert = await page.card.findByRole('alert', {}, SLOW)
  expect(alert.textContent).toContain(STALE)
  expect(alert.textContent).toContain('Inzwischen geändert: IBAN (jetzt DE02 1203 0000 0000 2020 51).')
  expect(alert.textContent).toContain('was Sie hier selbst geändert haben, steht weiter da')
  // Die IBAN des anderen Fensters steht jetzt im Feld, der eigene Kontakt bleibt; zu entscheiden ist nichts.
  await waitFor(() => expect(plain(page.field(/IBAN/).value)).toBe(NEW_IBAN), SLOW)
  expect(page.field(/Kontakt/).value).toBe('Tel. 0123 456789')
  expect(page.card.queryByRole('button', { name: /von dort übernehmen/ })).toBeNull()
  expect(page.reloads()).toBe(1)
  // Erneut speichern schickt die IBAN von jetzt und kennt sie als gesehen: Nichts wird zurückgeschrieben.
  page.save()
  await waitFor(() => expect(page.sent).toHaveLength(2), SLOW)
  expect(page.sent[1]?.iban).toBe(NEW_IBAN)
  expect(page.sent[1]?.landlordContact).toBe('Tel. 0123 456789')
  expect(page.sent[1]?.ifUnchanged).toMatchObject({ iban: NEW_IBAN })
})

// Durchsicht: A speichert Name und IBAN, B (alter Stand) tippt eine andere IBAN und einen Kontakt. Ohne Entscheidung
// stünde nach dem zweiten Speichern der Kontoinhaber aus A neben der IBAN aus B, was niemand eingegeben hat.
async function bothChangedBank() {
  const before: Settings = { ...SETTINGS, iban: NEW_IBAN }
  const now = { ...before, landlordName: 'Anton Fremd', iban: OLD_IBAN }
  const page = await open((body, nth) => (nth === 1 ? json({ error: STALE, stale: true, current: now }, 409) : json({ ...now, ...body })), { settings: before })
  fireEvent.change(page.field(/IBAN/), { target: { value: OWN_IBAN } })
  fireEvent.change(page.field(/Kontakt/), { target: { value: 'Tel. 0123 456789' } })
  page.save()
  const alert = await page.card.findByRole('alert', {}, SLOW)
  return { page, alert }
}

test('Kontoinhaber und IBAN von beiden geändert: Die Meldung nennt die Werte von dort, der Name von dort steht im Feld, die eigene IBAN bleibt, beides ist gekennzeichnet', async () => {
  const { page, alert } = await bothChangedBank()
  expect(alert.textContent).toContain('Name des Vermieters (jetzt „Anton Fremd“)')
  expect(alert.textContent).toContain('IBAN (jetzt DE89 3704 0044 0532 0130 00)')
  // Der Name wurde nur dort geändert: Im Feld steht der von dort, nie der alte (Durchsicht S1). Ob er zur eigenen IBAN
  // passt, entscheidet der Nutzer.
  expect(page.field(/Name des Vermieters/).value).toBe('Anton Fremd')
  expect(plain(page.field(/IBAN/).value)).toBe(OWN_IBAN)
  // Am Feld selbst steht, was dort gilt.
  const describedBy = (input: HTMLInputElement) => (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
  expect(describedBy(page.field(/Name des Vermieters/))).toContain('Inzwischen anderswo geändert auf „Anton Fremd“. Das steht jetzt hier.')
  expect(describedBy(page.field(/IBAN/))).toContain('Inzwischen anderswo geändert auf DE89 3704 0044 0532 0130 00. Hier steht Ihre Eingabe.')
  expect(describedBy(page.field(/Kontakt/))).not.toContain('anderswo')
  // Speichern geht erst nach der Entscheidung.
  page.save()
  const blocked = await page.card.findByText(/Bitte entscheiden Sie zuerst/, {}, SLOW)
  expect(blocked).toBeTruthy()
  expect(page.sent).toHaveLength(1)
})

test('„Werte von dort übernehmen“ setzt die ganze Gruppe auf den Stand von jetzt, der eigene Kontakt bleibt', async () => {
  const { page } = await bothChangedBank()
  fireEvent.click(page.card.getByRole('button', { name: /Werte von dort übernehmen/ }))
  expect(page.field(/Name des Vermieters/).value).toBe('Anton Fremd')
  expect(plain(page.field(/IBAN/).value)).toBe(OLD_IBAN)
  expect(page.card.queryByRole('button', { name: /von dort übernehmen/ })).toBeNull()
  page.save()
  await waitFor(() => expect(page.sent).toHaveLength(2), SLOW)
  expect(page.sent[1]).toMatchObject({ landlordName: 'Anton Fremd', iban: OLD_IBAN, landlordContact: 'Tel. 0123 456789', ifUnchanged: { landlordName: 'Anton Fremd', iban: OLD_IBAN } })
})

test('„Meine Eingabe behalten“ speichert die eigene IBAN zum Namen von dort, bewusst über den Stand von dort', async () => {
  const { page } = await bothChangedBank()
  fireEvent.click(page.card.getByRole('button', { name: 'Meine Eingabe behalten' }))
  expect(page.card.queryByRole('button', { name: 'Meine Eingabe behalten' })).toBeNull()
  page.save()
  await waitFor(() => expect(page.sent).toHaveLength(2), SLOW)
  expect(page.sent[1]).toMatchObject({ landlordName: 'Anton Fremd', iban: OWN_IBAN, ifUnchanged: { landlordName: 'Anton Fremd', iban: OLD_IBAN } })
})

// Durchsicht S1: Hier nur der Name, dort nur die IBAN. Die IBAN von dort steht im Feld, nie die alte; „Meine Eingabe
// behalten“ setzt sie nicht zurück, und die Entscheidung sagt, welche Werte danach gelten.
test('nur Name hier, nur IBAN dort: die IBAN von dort bleibt bei jeder Wahl, die Entscheidung nennt die Werte', async () => {
  const now = { ...SETTINGS, iban: NEW_IBAN }
  const page = await open((body, nth) => (nth === 1 ? json({ error: STALE, stale: true, current: now }, 409) : json({ ...now, ...body })))
  fireEvent.change(page.field(/Name des Vermieters/), { target: { value: 'Erika Neu' } })
  page.save()
  await page.card.findByRole('alert', {}, SLOW)
  await waitFor(() => expect(plain(page.field(/IBAN/).value)).toBe(NEW_IBAN), SLOW)
  expect(page.field(/Name des Vermieters/).value).toBe('Erika Neu')
  const keep = page.card.getByRole('button', { name: 'Meine Eingabe behalten' })
  const notice = keep.closest('.notice') ?? keep.parentElement?.parentElement
  if (!notice) throw new Error('Die Entscheidung fehlt.')
  expect(notice.textContent).toContain('Mit „Meine Eingabe behalten“ gilt: Name des Vermieters „Erika Neu“, IBAN DE02 1203 0000 0000 2020 51.')
  expect(notice.textContent).toContain('Mit „Werte von dort übernehmen“ gilt: Name des Vermieters „Erika Muster“, IBAN DE02 1203 0000 0000 2020 51.')
  expect(notice.textContent).not.toContain('DE89')
  fireEvent.click(keep)
  page.save()
  await waitFor(() => expect(page.sent).toHaveLength(2), SLOW)
  expect(page.sent[1]).toMatchObject({ landlordName: 'Erika Neu', iban: NEW_IBAN, ifUnchanged: { iban: NEW_IBAN } })
})

test('mergeStale: Schreibweisen sind keine eigene Änderung und ergeben keinen Hinweis „von beiden geändert“', () => {
  const form = (name: string, iban: string, days: string, address = '', contact = '') => ({ landlordName: name, iban, paymentDeadlineDays: days, landlordAddress: address, landlordContact: contact })
  const options = { same: sameLandlordInput, groups: LANDLORD_GROUPS }
  const before = form('Erika Muster', 'DE89 3704 0044 0532 0130 00', '30')
  // Hier: IBAN ohne Vierergruppen und klein, Name mit Leerraum am Rand, die Zahlungsfrist geleert. Dort: alles geändert.
  const shown = form('  Erika Muster ', 'de89370400440532013000', '')
  const now = form('Anton Fremd', 'DE02 1203 0000 0000 2020 51', '14', 'Musterweg 1')
  const merged = mergeStale(shown, before, now, options)
  expect(merged.conflicts).toEqual([])
  expect(merged.form).toEqual(now)

  // Beide haben dasselbe eingegeben: nichts zu entscheiden.
  expect(mergeStale(form('Erika Muster', 'DE02120300000000202051', '30'), before, form('Erika Muster', 'DE02 1203 0000 0000 2020 51', '30'), options).conflicts).toEqual([])
  // Dasselbe Feld, verschiedene Werte: nur dieses Feld, die eigene Eingabe bleibt.
  const contact = mergeStale(form('Erika Muster', before.iban, '30', '', 'hier'), before, form('Erika Muster', before.iban, '30', '', 'dort'), options)
  expect(contact.conflicts).toEqual([['landlordContact']])
  expect(contact.form.landlordContact).toBe('hier')
  // Gruppe: dort der Name, hier die IBAN; die Anschrift von dort gehört über den Namen dazu. Was nur dort geändert
  // wurde, steht mit dem Wert von dort im Formular (Durchsicht S1), die eigene IBAN bleibt.
  const group = mergeStale(form('Erika Muster', 'DE75 5121 0800 1245 1261 99', '30', '', 'hier'), before, form('Anton Fremd', before.iban, '14', 'Musterweg 1'), options)
  expect(group.conflicts).toEqual([['landlordName', 'iban', 'landlordAddress']])
  expect(group.form).toEqual(form('Anton Fremd', 'DE75 5121 0800 1245 1261 99', '14', 'Musterweg 1', 'hier'))
  // Name hier, Anschrift dort: Absender als Gruppe.
  expect(mergeStale(form('Erika Neu', before.iban, '30'), before, form('Erika Muster', before.iban, '30', 'Musterweg 1'), options).conflicts).toEqual([['landlordName', 'landlordAddress']])
})

test('settingsSeen: nur die Schlüssel der Karte, das Geänderte mit seinem Wert von jetzt', () => {
  expect(seenPart({ a: 1, b: undefined, c: 3 }, ['a', 'b'])).toEqual({ a: 1, b: null })
  expect(seenPart(null, ['a'])).toEqual({ a: null })
  const seen = seenPart(SETTINGS, LANDLORD_KEYS)
  // Der Stand von jetzt trägt alles, was die Antwort trägt (KI, Druck): Genannt wird nur, was die Karte schreibt.
  const refusal = new ApiError(STALE, 409, { stale: true, current: { ...SETTINGS, iban: NEW_IBAN, paymentDeadlineDays: 14, landlordAddress: '', printFooter: true, ai: { text: {} } } })
  expect(settingsStaleText(refusal, seen, LANDLORD_STALE_FIELDS, 'Weiter.')).toBe(`${STALE} Inzwischen geändert: IBAN (jetzt DE02 1203 0000 0000 2020 51), Zahlungsfrist (jetzt 14 Tage). Weiter.`)
  expect(settingsStaleText(new ApiError('Nein', 400, {}), seen, LANDLORD_STALE_FIELDS, 'Weiter.')).toBeNull()
})

// Ein Tab im Hintergrund: Die App hält die Einstellungen und lädt sie beim Seitenwechsel nicht neu.
test('beim Öffnen fragt die Seite den Stand von jetzt; weicht er ab, lädt die App neu, und das unberührte Formular übernimmt ihn', async () => {
  const fresh = { ...SETTINGS, iban: NEW_IBAN, fixedByEnv: [] }
  const page = await open((body) => json({ ...fresh, ...body }), { fresh })
  await waitFor(() => expect(page.reloads()).toBe(1), SLOW)
  // Die App liefert danach die neuen Einstellungen.
  page.show(fresh)
  await waitFor(() => expect(plain(page.field(/IBAN/).value)).toBe(NEW_IBAN), SLOW)
  fireEvent.change(page.field(/Kontakt/), { target: { value: 'Tel. 0123 456789' } })
  page.save()
  await waitFor(() => expect(page.sent).toHaveLength(1), SLOW)
  expect(page.sent[0]).toMatchObject({ iban: NEW_IBAN, ifUnchanged: { iban: NEW_IBAN } })
})

test('ein Formular mit Eingabe wird nicht ersetzt, und ohne Abweichung lädt nichts neu', async () => {
  const page = await open((body) => json({ ...SETTINGS, ...body }), { fresh: { ...SETTINGS, fixedByEnv: [] } })
  fireEvent.change(page.field(/Kontakt/), { target: { value: 'Tel. 0123 456789' } })
  page.show({ ...SETTINGS, iban: NEW_IBAN })
  await new Promise((r) => setTimeout(r, 50))
  expect(plain(page.field(/IBAN/).value)).toBe(OLD_IBAN)
  expect(page.field(/Kontakt/).value).toBe('Tel. 0123 456789')
  expect(page.reloads()).toBe(0)
  // Gesehen bleibt der alte Stand: Das Speichern wird dann ehrlich abgelehnt.
  page.save()
  await waitFor(() => expect(page.sent).toHaveLength(1), SLOW)
  expect(page.sent[0]?.ifUnchanged).toMatchObject({ iban: OLD_IBAN })
})

// ---------- KI-Belegauswertung ----------
const AI: AiValues = {
  text: { provider: 'ollama', preset: 'ollama-local', url: 'http://localhost:11434', model: 'bild:4b', vision: null }, images: null,
  timeoutSeconds: null, numCtx: null, maxOutputTokens: null, pageImageEdge: null, jsonMode: 'auto', reasoningEffort: null, extraInstructions: '',
  consent: { text: { url: 'http://localhost:11434', model: 'bild:4b', date: '2026-01-01' } },
}
function openAi(answer: (body: Sent, nth: number) => Response) {
  const sent: Sent[] = []
  let reloads = 0
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/settings' && init?.method === 'PUT') {
      const body: Sent = { ...JSON.parse(String(init.body)) }
      sent.push(body)
      return answer(body, sent.length)
    }
    if (url.startsWith('/api/ai/status')) return json({ ok: true, models: [] })
    return json([])
  })
  const settings = (ai: AiValues): Settings => ({ ...SETTINGS, ai, fixedByEnv: [], aiExternal: { text: false, images: false } })
  const view = render(<UIProvider><AiSettings settings={settings(AI)} reload={async () => { reloads++ }} /></UIProvider>)
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  return { sent, save, reloads: () => reloads, show: (ai: AiValues) => view.rerender(<UIProvider><AiSettings settings={settings(ai)} reload={async () => { reloads++ }} /></UIProvider>) }
}
const extraField = () => screen.findByRole<HTMLTextAreaElement>('textbox', { name: /Zusätzliche Hinweise an das Modell/ }, SLOW)
const timeoutField = () => screen.getByRole<HTMLInputElement>('textbox', { name: /Zeitlimit je Schritt/ })

test('KI-Belegauswertung: Die Karte schickt ihren geladenen Stand ohne die Zustimmungen mit, danach den aus der Antwort', async () => {
  // Der Server liefert die wirksamen Werte; hier mit einer Zeitgrenze, die er selbst gesetzt hat.
  const card = openAi((body) => json({ ...SETTINGS, ai: { ...(body.ai as AiValues), timeoutSeconds: 120, consent: {} } }))
  fireEvent.change(await extraField(), { target: { value: 'Bitte genau lesen.' } })
  card.save()
  await waitFor(() => expect(card.sent).toHaveLength(1), SLOW)
  const { consent: _consent, ...seen } = AI
  expect(card.sent[0]?.ifUnchanged).toEqual({ ai: seen })
  card.save()
  await waitFor(() => expect(card.sent).toHaveLength(2), SLOW)
  expect(card.sent[1]?.ifUnchanged).toEqual({ ai: { ...seen, timeoutSeconds: 120, extraInstructions: 'Bitte genau lesen.' } })
})

test('KI-Belegauswertung abgelehnt: Die Mitteilung nennt das Geänderte mit Wert, die Eingabe bleibt, und erneutes Speichern geht', async () => {
  const { consent: _consent, ...seen } = AI
  const now = { ...AI, timeoutSeconds: 120, text: { ...AI.text, model: 'text:8b' } }
  const card = openAi((body, nth) => (nth === 1
    ? json({ error: STALE, stale: true, current: { ...SETTINGS, ai: now } }, 409)
    : json({ ...SETTINGS, ai: { ...(body.ai as AiValues), consent: {} } })))
  fireEvent.change(await extraField(), { target: { value: 'Bitte genau lesen.' } })
  card.save()
  const toast = await screen.findByText(/Die Einstellungen wurden inzwischen geändert/, {}, SLOW)
  expect(toast.textContent).toContain('Standard-Anbieter (jetzt Modell „text:8b“, Adresse „http://localhost:11434“)')
  expect(toast.textContent).toContain('Zeitlimit je Schritt (jetzt 120 Sekunden)')
  expect(toast.textContent).toContain('was Sie hier selbst geändert haben, steht weiter da')
  expect(toast.textContent).not.toContain('öffnen Sie die Einstellungen erneut')
  expect(card.reloads()).toBe(1)
  // Die eigene Eingabe steht noch da, das Unberührte zeigt den Stand von jetzt.
  expect((await extraField()).value).toBe('Bitte genau lesen.')
  await waitFor(() => expect(timeoutField().value).toBe('120'), SLOW)
  // Erneut speichern: mit dem Stand von jetzt als gesehen, nichts wird zurückgeschrieben.
  card.save()
  await waitFor(() => expect(card.sent).toHaveLength(2), SLOW)
  expect(card.sent[1]?.ifUnchanged).toEqual({ ai: { ...seen, timeoutSeconds: 120, text: now.text } })
  expect(card.sent[1]?.ai).toMatchObject({ timeoutSeconds: 120, text: now.text, extraInstructions: 'Bitte genau lesen.' })
})

test('KI-Belegauswertung: Liefert die App einen neueren Stand, übernimmt ihn die unberührte Karte', async () => {
  const card = openAi((body) => json({ ...SETTINGS, ai: { ...(body.ai as AiValues), consent: {} } }))
  await extraField()
  card.show({ ...AI, extraInstructions: 'Von außen.' })
  await waitFor(async () => expect((await extraField()).value).toBe('Von außen.'), SLOW)
  card.save()
  await waitFor(() => expect(card.sent).toHaveLength(1), SLOW)
  expect(card.sent[0]?.ifUnchanged).toMatchObject({ ai: { extraInstructions: 'Von außen.' } })
})
