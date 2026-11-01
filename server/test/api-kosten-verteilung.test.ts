// Die Verteilung nach § 82b EStDV über die echten Routen (#262 PR 1, E-1, E-9, E-11): Setzen beim Anlegen ohne
// Rückfrage, Ablehnung mit Satz (400), Rückfrage beim Ändern (409 `question: 'spread'`, bestätigt mit `confirmSpread`)
// und eine Wahl je Rechnung: Am Teil einer aufgeteilten Rechnung geändert, gilt sie für alle Teile, in einem Vorgang.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import { besideServer, restore, startServer, startServerIn, type Server } from '../testing/api.ts'
import type { CostItem, Property } from '../../shared/types.ts'
import { spreadQuestions, spreadRestQuestions } from '../../shared/spread.ts'
import { CALENDAR_RULES, periodLabel, periodOfKey } from '../../shared/period.ts'
import type { JournalGroupView } from '../src/db/journal.ts'

const sender = (s: Server) => (route: string, method: string, body?: unknown) =>
  fetch(`${s.base}${route}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

const dach = { period: '2025-01', category: 'Nicht umlagefähig', description: 'Dachsanierung', amountCents: 3_000_000, key: 'area' }

test('Route: Wahl beim Anlegen ohne Rückfrage; 400 mit Satz an einer umlagefähigen Kostenart; 409 beim Ändern, mit Bestätigung gespeichert', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    const r1 = await send('/api/costItems', 'POST', { ...dach, spreadYears: 3 })
    assert.equal(r1.status, 201, await r1.clone().text())
    const item = await r1.json() as CostItem
    assert.equal(item.spreadYears, 3)

    const r2 = await send('/api/costItems', 'POST', { ...dach, category: 'Gebäudereinigung', spreadYears: 3 })
    assert.equal(r2.status, 400)
    assert.match((await r2.json() as { error: string }).error, /nur „Nicht umlagefähig“ oder „Entnahme Erhaltungsrücklage“/)

    const r3 = await send(`/api/costItems/${item.id}`, 'PUT', { spreadYears: 5 })
    assert.equal(r3.status, 409)
    const b3 = await r3.json() as { error: string; question: string }
    assert.equal(b3.question, 'spread')
    assert.equal(b3.error, spreadQuestions(item, { ...item, spreadYears: 5 }).join(' '))
    const r4 = await send(`/api/costItems/${item.id}`, 'PUT', { spreadYears: 5, confirmSpread: true })
    assert.equal(r4.status, 200)
    assert.equal((await r4.json() as CostItem).spreadYears, 5)

    // Die Kostenart einer verteilten Position wechseln, ohne die Wahl zu leeren: 400.
    const r5 = await send(`/api/costItems/${item.id}`, 'PUT', { category: 'Sonstige Betriebskosten' })
    assert.equal(r5.status, 400)
    // Die Liste liefert die Wahl mit.
    const list = await (await send('/api/costItems?property=objekt-1', 'GET')).json() as CostItem[]
    assert.deepEqual(list.map((c) => c.spreadYears), [5])
    // Löschen fragt der Server nicht (die Rückfrage stellt das Formular).
    assert.equal((await send(`/api/costItems/${item.id}`, 'DELETE')).status, 200)
  } finally {
    s.stop()
  }
})

test('Route: eine Wahl je Rechnung; geändert an einem Teil, gilt sie für alle Teile derselben Quelle (Rückfrage nennt die Teile)', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    // Eine Maßnahme über den Jahreswechsel, mit Leistungszeitraum aufgeteilt (#208, #455); die Wahl gilt für jeden Teil. Mit
    // Datum der Zahlung, sonst begännen die Teile ihre Verteilung in zwei Jahren (Integrationsdurchsicht 0.14, S1).
    const split = { ...dach, serviceFrom: '2025-07-01', serviceTo: '2026-06-30', spreadYears: 2, paidOn: '2026-07-15', confirmPaidOn: true }
    const r1 = await send('/api/costItems/split', 'POST', split)
    assert.equal(r1.status, 201, await r1.clone().text())
    const parts = await r1.json() as CostItem[]
    assert.deepEqual(parts.map((p) => [p.period, p.spreadYears]), [['2025-01', 2], ['2026-01', 2]])
    const [first, second] = parts
    if (!first || !second) return assert.fail('zwei Teile erwartet')
    assert.ok(first.sourceId && first.sourceId === second.sourceId, 'beide Teile gehören zu einer Quelle')

    const r2 = await send(`/api/costItems/${second.id}`, 'PUT', { spreadYears: 4 })
    assert.equal(r2.status, 409)
    const b2 = await r2.json() as { error: string; question: string }
    assert.equal(b2.question, 'spread')
    assert.match(b2.error, /Die Wahl gilt für die ganze Rechnung und wird auch an den übrigen Teilen \(2025\) gespeichert\./)
    const r3 = await send(`/api/costItems/${second.id}`, 'PUT', { spreadYears: 4, confirmSpread: true })
    assert.equal(r3.status, 200, await r3.clone().text())
    const list = await (await send('/api/costItems?property=objekt-1', 'GET')).json() as CostItem[]
    assert.deepEqual(list.map((c) => [c.period, c.spreadYears ?? null]), [['2025-01', 4], ['2026-01', 4]])
    // Ein Vorgang, eine Gruppe des Verlaufs: die Änderung beider Teile steht in einem Eintrag.
    const journal = await (await send('/api/journal?property=objekt-1', 'GET')).json() as JournalGroupView[]
    assert.equal(journal[0]?.rows, 2, JSON.stringify(journal[0]))

    // Entfernen ebenso an allen Teilen.
    const r4 = await send(`/api/costItems/${first.id}`, 'PUT', { spreadYears: null, confirmSpread: true })
    assert.equal(r4.status, 200)
    const after = await (await send('/api/costItems?property=objekt-1', 'GET')).json() as CostItem[]
    assert.deepEqual(after.map((c) => c.spreadYears ?? null), [null, null])
  } finally {
    s.stop()
  }
})

test('Route: eine gespeicherte Position aufteilen und dabei die Wahl ändern fragt einmal nach (409), mit Bestätigung tragen alle Teile sie', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    const r1 = await send('/api/costItems', 'POST', { ...dach })
    const item = await r1.json() as CostItem
    const split = { serviceFrom: '2025-07-01', serviceTo: '2026-06-30', spreadYears: 3, paidOn: '2026-07-15', confirmPaidOn: true }
    const r2 = await send(`/api/costItems/${item.id}/split`, 'PUT', split)
    assert.equal(r2.status, 409)
    const b2 = await r2.json() as { error: string; question: string }
    assert.equal(b2.question, 'spread')
    assert.match(b2.error, /auf 3 Jahre verteilt/)
    const r3 = await send(`/api/costItems/${item.id}/split`, 'PUT', { ...split, confirmSpread: true })
    assert.equal(r3.status, 200, await r3.clone().text())
    assert.deepEqual((await r3.json() as CostItem[]).map((p) => p.spreadYears), [3, 3])
  } finally {
    s.stop()
  }
})

test('Backup: Wahl an der Position und Jahr des vorzeitigen Endes am Objekt kommen beim Einspielen zurück', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    const item = await (await send('/api/costItems', 'POST', { ...dach, spreadYears: 4 })).json() as CostItem
    assert.equal((await send('/api/properties/objekt-1', 'PUT', { spreadRestYear: 2027, confirmSpread: true })).status, 200)
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    assert.equal((await send(`/api/costItems/${item.id}`, 'PUT', { spreadYears: null, confirmSpread: true })).status, 200)
    assert.equal((await send('/api/properties/objekt-1', 'PUT', { spreadRestYear: null })).status, 200)
    const r = await restore(s, backup)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const items = await (await send('/api/costItems?property=objekt-1', 'GET')).json() as CostItem[]
    assert.deepEqual(items.map((c) => [c.id, c.spreadYears ?? null]), [[item.id, 4]])
    const properties = await (await send('/api/properties', 'GET')).json() as Property[]
    assert.deepEqual(properties.map((p) => p.spreadRestYear), [2027])
  } finally {
    s.stop()
  }
})

test('Backup: eine Datenbank von vor den Spalten kommt ohne Verteilung zurück (NULL)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-verteilung-backup-'))
  const s = await startServer()
  try {
    const file = path.join(dir, 'mietfuchs.sqlite')
    const c = await connect(file)
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_verteilung_82b'))
    if (bis < 0) assert.fail('Schritt …_verteilung_82b fehlt')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec(`INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key) VALUES ('c1', 'objekt-1', '2025-01', 'Nicht umlagefähig', 'Dach', 3000000, 'area')`)
    c.close()
    const zip = new AdmZip()
    zip.addFile('mietfuchs.sqlite', fs.readFileSync(file))
    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const items = await (await sender(s)('/api/costItems?property=objekt-1', 'GET')).json() as CostItem[]
    assert.deepEqual(items.map((i) => [i.id, i.spreadYears ?? null]), [['c1', null]])
    assert.equal(Object.hasOwn(items[0] ?? {}, 'spreadYears'), false, 'ohne Wahl fehlt das Feld')
    const properties = await (await sender(s)('/api/properties', 'GET')).json() as Property[]
    assert.deepEqual(properties.map((p) => p.spreadRestYear), [null])
  } finally {
    s.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Der Wechsel des Rhythmus (#208) trägt die Wahl an jeden Teil weiter (`spreadYears: 'same'`) und fragt nicht; auch eine
// Wahl, die so nicht hätte gespeichert werden dürfen (Ablage von Hand), hält ihn nicht auf.
test('Wechsel des Zeitraums: die Teile tragen die Wahl, ohne Rückfrage; eine krumme Wahl hält den Wechsel nicht auf', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-verteilung-wechsel-'))
  const s = await startServerIn(dir)
  try {
    const send = sender(s)
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    const jahr = { serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }
    assert.equal((await send('/api/costItems', 'POST', { ...dach, ...jahr, spreadYears: 3 })).status, 201)
    const g = await (await send('/api/costItems', 'POST', { ...dach, ...jahr, category: 'Grundsteuer', description: 'Grundsteuer' })).json() as CostItem
    const c = await besideServer(s.dataDir)
    try {
      c.exec(`UPDATE cost_items SET spread_years = 2 WHERE id = '${g.id}'`)
    } finally {
      c.close()
    }
    const rules = { startMonth: 1, changes: ['2025-05'] }
    const preview = await (await send('/api/properties/objekt-1/period/preview', 'POST', { rules })).json() as { token: string }
    const res = await send('/api/properties/objekt-1/period', 'PUT', { rules, answers: { groups: {}, overrides: {}, taxYears: {}, token: preview.token, understood: true } })
    assert.equal(res.status, 200, await res.clone().text())
    const items = await (await send('/api/costItems?property=objekt-1', 'GET')).json() as CostItem[]
    assert.deepEqual(items.map((i) => [i.category, i.spreadYears ?? null]).sort(), [
      ['Grundsteuer', 2], ['Grundsteuer', 2], ['Nicht umlagefähig', 3], ['Nicht umlagefähig', 3],
    ])
  } finally {
    s.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Durchsicht S1: Ein Zahlungsdatum an einer verteilten Position ändert das Steuerjahr und den Beginn der Verteilung. Eine
// Rückfrage nennt beides, der Rat steht einmal am Ende; bestätigt im selben Dialog (alle Kennzeichen), wird gespeichert.
test('Route: ein Zahlungsdatum an einer verteilten Position fragt einmal nach, mit beiden Sätzen und dem Rat einmal', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    const item = await (await send('/api/costItems', 'POST', { ...dach, spreadYears: 3 })).json() as CostItem
    const r1 = await send(`/api/costItems/${item.id}`, 'PUT', { paidOn: '2026-01-08' })
    assert.equal(r1.status, 409)
    const b1 = await r1.json() as { error: string; question: string }
    assert.equal(b1.question, 'paidOn')
    assert.equal(b1.error, [
      'Mit dem Datum 08.01.2026 zählt die Position für die Steuer zu 2026 statt zu 2025.',
      'Die Verteilung beginnt dann 2026 statt 2025: Abzug 2026 bis 2028 statt 2025 bis 2027.',
      'Die Wahl ist an die Erklärung des ersten Jahres gebunden.',
      'Haben Sie die Steuererklärung eines betroffenen Jahres schon abgegeben, besprechen Sie die Änderung mit Ihrem Steuerberater oder Finanzamt.',
    ].join(' '))
    const r2 = await send(`/api/costItems/${item.id}`, 'PUT', { paidOn: '2026-01-08', confirmPaidOn: true, confirmTaxYear: true, confirmSpread: true })
    assert.equal(r2.status, 200, await r2.clone().text())
    assert.equal((await r2.json() as CostItem).paidOn, '2026-01-08')
  } finally {
    s.stop()
  }
})

// Durchsicht S2: Ein Teil der Rechnung, an dem nicht verteilt werden kann (Betrag 0), lehnt die Wahl am anderen Teil ab,
// bevor gefragt wird: sonst erst die Rückfrage und nach der Bestätigung die Ablehnung.
test('Route: die Wahl an einem Teil, dessen anderer Teil keinen Betrag hat, lehnt sofort ab (400 ohne Rückfrage), mit konkretem Satz', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    const r1 = await send('/api/costItems/split', 'POST', { ...dach, serviceFrom: '2025-07-01', serviceTo: '2026-06-30' })
    assert.equal(r1.status, 201, await r1.clone().text())
    const [first, second] = await r1.json() as CostItem[]
    if (!first || !second) return assert.fail('zwei Teile erwartet')
    const r2 = await send(`/api/costItems/${first.id}`, 'PUT', { amountCents: 0 })
    assert.equal(r2.status, 200, await r2.clone().text())
    const r3 = await send(`/api/costItems/${second.id}`, 'PUT', { spreadYears: 2 })
    assert.equal(r3.status, 400, await r3.clone().text())
    const b3 = await r3.json() as { error: string }
    assert.match(b3.error, /am Teil „Dachsanierung \(anteilig 01\.07\.–31\.12\.2025\)“ lässt sich nicht verteilen/)
    assert.match(b3.error, /Betrag 0,00 €/)
    const list = await (await send('/api/costItems?property=objekt-1', 'GET')).json() as CostItem[]
    assert.deepEqual(list.map((c) => c.spreadYears ?? null), [null, null])
  } finally {
    s.stop()
  }
})

// Durchsicht K-d: Die Ablehnung an einer umlagefähigen Kostenart ist richtig gebaut.
test('Route: die Ablehnung an einer umlagefähigen Kostenart sagt, Erhaltungsaufwand zählt nicht zu den Betriebskosten', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    const r = await send('/api/costItems', 'POST', { ...dach, category: 'Gebäudereinigung', spreadYears: 3 })
    assert.equal(r.status, 400)
    assert.match((await r.json() as { error: string }).error, /denn Erhaltungsaufwand zählt nicht zu den Betriebskosten \(§ 1 Abs\. 2 Nr\. 2 BetrKV\)/)
  } finally {
    s.stop()
  }
})

// Durchsicht S2, beim Aufteilen: Eine gespeicherte Gutschrift aufteilen und dabei verteilen lehnt sofort ab (400), statt
// erst nachzufragen und nach der Bestätigung an den Teilen abzulehnen.
test('Route: eine Gutschrift aufteilen und dabei verteilen lehnt ohne Rückfrage ab (400)', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    const item = await (await send('/api/costItems', 'POST', { ...dach, description: 'Gutschrift Dachdecker', amountCents: -50_000 })).json() as CostItem
    const r = await send(`/api/costItems/${item.id}/split`, 'PUT', { serviceFrom: '2025-07-01', serviceTo: '2026-06-30', spreadYears: 3 })
    assert.equal(r.status, 400, await r.clone().text())
    assert.match((await r.json() as { error: string }).error, /Gutschrift/)
  } finally {
    s.stop()
  }
})

// Durchsicht von #262 PR 3: Der Satz der 409 ist genau der, den das Formular vorher selbst zeigt (Kosten.tsx:
// `spreadChange` mit den übrigen Teilen, beschriftet mit `periodLabel` der Regeln des Objekts). Sonst bestätigte der
// Vermieter im Formular einen anderen Text, als der Server meint.
test('Route: der Text der Rückfrage am Teil einer Rechnung ist der des Formulars (spreadQuestions mit periodLabel)', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    const parts = await (await send('/api/costItems/split', 'POST', { ...dach, serviceFrom: '2025-07-01', serviceTo: '2026-06-30', spreadYears: 2, paidOn: '2026-07-15', confirmPaidOn: true })).json() as CostItem[]
    const [first, second] = parts
    if (!first || !second) return assert.fail('zwei Teile erwartet')
    const r = await send(`/api/costItems/${first.id}`, 'PUT', { spreadYears: null })
    assert.equal(r.status, 409)
    const others = parts.filter((p) => p.id !== first.id).map((p) => periodLabel(periodOfKey(CALENDAR_RULES, p.period) ?? assert.fail('Zeitraum')))
    assert.equal((await r.json() as { error: string }).error, spreadQuestions(first, { ...first, spreadYears: null }, others).join(' '))
  } finally {
    s.stop()
  }
})

// #262 PR 4 (E-7): das Jahr des vorzeitigen Endes am Objekt. Ohne verteilte Position wird ohne Rückfrage gespeichert; mit
// einer, deren Abzug sich dadurch ändert, fragt der Server nach (409 `question: 'spread'`, dieselben Sätze wie im
// Formular aus `spreadRestQuestions`), bestätigt mit `confirmSpread`. Eine Jahreszahl außerhalb 1900 bis 2200 lehnt er
// vor der Rückfrage ab (400).
test('Route: Ende am Objekt ohne verteilte Position ohne Rückfrage, mit einer 409 und bestätigt gespeichert, Ungültiges 400', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    assert.equal((await send('/api/properties/objekt-1', 'PUT', { spreadRestYear: 2026 })).status, 200)
    assert.equal((await send('/api/properties/objekt-1', 'PUT', { spreadRestYear: null })).status, 200)
    const item = await (await send('/api/costItems', 'POST', { ...dach, spreadYears: 4 })).json() as CostItem
    const bad = await send('/api/properties/objekt-1', 'PUT', { spreadRestYear: 1899 })
    assert.equal(bad.status, 400)
    const r1 = await send('/api/properties/objekt-1', 'PUT', { name: 'Lindenweg', spreadRestYear: 2026 })
    assert.equal(r1.status, 409)
    const b1 = await r1.json() as { error: string; question: string }
    assert.equal(b1.question, 'spread')
    assert.equal(b1.error, spreadRestQuestions(null, 2026, [item]).join(' '))
    assert.match(b1.error, /„Dachsanierung“: Abzug 2025 bis 2026 \(Rest 2026\) statt 2025 bis 2028\./)
    const unchanged = await (await send('/api/properties', 'GET')).json() as Property[]
    assert.deepEqual(unchanged.map((p) => [p.name, p.spreadRestYear]), [[unchanged[0]?.name, null]], 'nach der Rückfrage ist nichts gespeichert')
    assert.notEqual(unchanged[0]?.name, 'Lindenweg')
    const r2 = await send('/api/properties/objekt-1', 'PUT', { name: 'Lindenweg', spreadRestYear: 2026, confirmSpread: true })
    assert.equal(r2.status, 200, await r2.clone().text())
    assert.equal((await r2.json() as Property).spreadRestYear, 2026)
    // Andere Angaben ohne das Feld fragen nicht; ein Ende nach dem letzten Jahr ändert nichts und fragt deshalb nicht.
    assert.equal((await send('/api/properties/objekt-1', 'PUT', { address: 'Lindenweg 1' })).status, 200)
    assert.equal((await send('/api/properties/objekt-1', 'PUT', { spreadRestYear: 2026 })).status, 200)
    const r3 = await send('/api/properties/objekt-1', 'PUT', { spreadRestYear: null })
    assert.equal(r3.status, 409)
    assert.match((await r3.json() as { error: string }).error, /Ohne dieses Jahr laufen die Verteilungen wie gewählt\./)
    assert.equal((await send('/api/properties/objekt-1', 'PUT', { spreadRestYear: 2028, confirmSpread: true })).status, 200)
    assert.equal((await send('/api/properties/objekt-1', 'PUT', { spreadRestYear: 2031 })).status, 200)
  } finally {
    s.stop()
  }
})

// Durchsicht S3: Die Rückfrage an der Position kennt das Ende am Objekt. Ende im Jahr der Zahlung: eine andere Wahl
// ändert nichts und fragt nicht; Ende im Folgejahr: gefragt mit dem Abzug samt Rest, derselbe Text wie im Formular.
test('Route: die Rückfrage an der Position rechnet mit dem Ende am Objekt', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    const item = await (await send('/api/costItems', 'POST', { ...dach, spreadYears: 4 })).json() as CostItem
    assert.equal((await send('/api/properties/objekt-1', 'PUT', { spreadRestYear: 2025, confirmSpread: true })).status, 200)
    const r1 = await send(`/api/costItems/${item.id}`, 'PUT', { spreadYears: 2 })
    assert.equal(r1.status, 200, await r1.clone().text())
    assert.equal((await send('/api/properties/objekt-1', 'PUT', { spreadRestYear: 2026, confirmSpread: true })).status, 200)
    const r2 = await send(`/api/costItems/${item.id}`, 'PUT', { spreadYears: 3 })
    assert.equal(r2.status, 409)
    const b2 = await r2.json() as { error: string }
    assert.equal(b2.error, spreadQuestions({ ...item, spreadYears: 2 }, { ...item, spreadYears: 3 }, [], 2026).join(' '))
    assert.match(b2.error, /auf 3 Jahre verteilt: Abzug 2025 bis 2026 \(Rest 2026\) statt 2025 bis 2026\./)
  } finally {
    s.stop()
  }
})

// Integrationsdurchsicht 0.14 (S1): Eine aufgeteilte Rechnung ist einmal bezahlt. Ohne Datum der Zahlung stünden ihre Teile
// in verschiedenen Kalenderjahren (2025 und 2026), und jeder Teil begänne seine Verteilung in einem anderen Jahr. Der Server
// lehnt die Wahl dann ab (400) und bittet um das Datum; mit Datum beginnt die Verteilung für die ganze Rechnung in einem Jahr.
test('Route: Verteilung an einer aufgeteilten Rechnung mit Teilen in zwei Kalenderjahren ohne Datum der Zahlung: 400, mit Datum ein Jahr', async () => {
  const s = await startServer()
  try {
    const send = sender(s)
    await send('/api/units', 'POST', { name: 'EG', areaM2: 80, participates: true })
    const split = { ...dach, serviceFrom: '2025-07-01', serviceTo: '2026-06-30', spreadYears: 2 }
    const r1 = await send('/api/costItems/split', 'POST', split)
    assert.equal(r1.status, 400, await r1.clone().text())
    const e1 = (await r1.json() as { error: string }).error
    assert.match(e1, /Bitte tragen Sie das Datum der Zahlung ein/)
    assert.match(e1, /2025 und 2026/)
    assert.deepEqual(await (await send('/api/costItems?property=objekt-1', 'GET')).json(), [], 'gespeichert wurde nichts')

    // Ohne Wahl aufgeteilt, dann an einem Teil verteilen: ebenso 400.
    const plain = await (await send('/api/costItems/split', 'POST', { ...split, spreadYears: null })).json() as CostItem[]
    const [a, b] = plain
    if (!a || !b) return assert.fail('zwei Teile erwartet')
    const r2 = await send(`/api/costItems/${b.id}`, 'PUT', { spreadYears: 2, confirmSpread: true })
    assert.equal(r2.status, 400, await r2.clone().text())
    assert.match((await r2.json() as { error: string }).error, /Bitte tragen Sie das Datum der Zahlung ein/)
    for (const p of plain) assert.equal((await send(`/api/costItems/${p.id}`, 'DELETE')).status, 200)

    // Mit Datum: beide Teile im Jahr 2026, die Verteilung beginnt für die ganze Rechnung dort.
    const r3 = await send('/api/costItems/split', 'POST', { ...split, paidOn: '2026-07-15', confirmPaidOn: true })
    assert.equal(r3.status, 201, await r3.clone().text())
    const parts = await r3.json() as CostItem[]
    assert.deepEqual(parts.map((p) => [p.paidOn, p.spreadYears]), [['2026-07-15', 2], ['2026-07-15', 2]])
    // Das Datum an einem Teil entfernen, solange verteilt ist: wieder zwei Jahre, 400.
    const r4 = await send(`/api/costItems/${parts[0]?.id ?? ''}`, 'PUT', { paidOn: null, confirmPaidOn: true, confirmSpread: true })
    assert.equal(r4.status, 400, await r4.clone().text())
    assert.match((await r4.json() as { error: string }).error, /Bitte tragen Sie das Datum der Zahlung ein/)
  } finally {
    s.stop()
  }
})
