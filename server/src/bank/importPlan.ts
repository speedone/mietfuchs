// Einen gelesenen Kontoauszug gegen den Bestand planen (#188): Was wird gespeichert, was ist schon da, was muss der
// Vermieter beantworten. Rein: Leseergebnis, Bestand und Antworten hinein, Schreibvorgänge und Vorschau heraus. Die
// Route plant beim Ausführen in der Schreibschlange neu und vergleicht die Prüfmarke (`importToken`), wie markPaid.ts.
//
// Die Regeln stehen in docs/superpowers/specs/2026-11-12-kontoauszug-design.md unter „Import“ und tragen hier ihre
// Nummer. Zwei Grundsätze gehen allem vor:
// - **Privates nie einzeln.** Auf einem Mischkonto wird ein Umsatz nur gespeichert, wenn seine Gegenseite Mieter oder
//   Zahler ist oder der Vermieter ihn der Vermietung zuordnet. Alles andere steht nur in der Tagessumme.
// - **Ein bekannter Tag wird nie ein zweites Mal geschrieben.** Der abgeschlossene Buchungstag je Konto ist die Einheit
//   des Abgleichs; so ändert ein zweites Einlesen nichts, gleich in welcher Reihenfolge die Auszüge kommen.

import crypto from 'node:crypto'
import { germanDate } from '../../../shared/law/register.ts'
import { compareText } from '../apportion.ts'
import type { BankImportDecision, BankImportQuestion } from '../../../shared/types.ts'
import { addIsoDays } from './coverage.ts'
import { FINGERPRINT_VERSION, type BankEntry, type BankReadResult, type BankStatement } from './statement.ts'
import type { BankAccount, BankDay, BankImport, BankStock, BankTransaction, TenancyPayer } from './model.ts'

export type ImportDecision = BankImportDecision

export type ImportQuestion = BankImportQuestion

export type ImportWrite = {
  accounts: BankAccount[]
  imports: BankImport[]
  days: BankDay[]
  transactions: BankTransaction[]
  replaced: { removeId: string; parts: BankTransaction[] }[]
  payers: TenancyPayer[]
}

export type ImportFinding = { where: string; message: string }

export type ImportPlan = {
  writes: ImportWrite
  questions: ImportQuestion[]
  findings: ImportFinding[]
  summary: { stored: number; knownDays: number; pending: number }
  sentence: string
  ready: boolean
  // Die Kennungen, die dieser Plan erzeugt hat; die Prüfmarke sieht von ihnen ab.
  newIds: string[]
}

export const MISSING_DAY_STATEMENT = 'Zu dieser Aufschlüsselung fehlt der Tagesauszug.'
export const DEPOSIT_ACCOUNT_HINT = 'Ein Kautionskonto lesen Sie hier bitte nicht ein.'

const accountKeyOf = (s: Pick<BankStatement, 'accountIban' | 'accountOtherId'>): string | null => s.accountIban ?? s.accountOtherId

export function accountQuestionText(q: { iban: string | null; otherId: string | null }): string {
  return `Das Konto ${q.iban ?? q.otherId ?? ''} wurde noch nie eingelesen. Ist es Ihr Konto für Mieteingänge? ${DEPOSIT_ACCOUNT_HINT}`
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
const euro = (cents: number): string => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const assertNever = (): never => {
  throw new Error('Tag fehlt im Plan')
}

// Anzahl und Summen eines Tages laut Auszug. Eine zerlegte Sammelbuchung zählt einmal mit ihrer Summe, wie sie auf dem
// Konto steht; so sieht derselbe Tag aus camt.052 (Summe) und camt.053 (zerlegt) gleich aus.
function daySums(entries: readonly BankEntry[]): { entryCount: number; creditCents: number; debitCents: number } {
  let entryCount = 0
  let creditCents = 0
  let debitCents = 0
  for (const e of entries) {
    if (e.batch && e.batch.part !== 1) continue
    const cents = e.batch ? e.batch.totalCents : e.amountCents
    entryCount++
    if (cents > 0) creditCents += cents
    else debitCents -= cents
  }
  return { entryCount, creditCents, debitCents }
}

// Die Buchungstage eines Auszugs, die abgeschlossen sind (Regel 4). Tagesauszüge (camt.053, MT940): jeder. camt.052:
// nur Tage vor dem Kalendertag der Erstellung; ohne Erstellung keiner.
function closedBefore(s: BankStatement): string | null {
  if (s.format !== 'camt.052') return null
  return s.createdAt && /^\d{4}-\d{2}-\d{2}/.test(s.createdAt) ? s.createdAt.slice(0, 10) : ''
}

const balanceFails = (s: BankStatement): boolean =>
  s.format !== 'camt.052' && s.format !== 'camt.054' && s.openingBalanceCents !== null && s.closingBalanceCents !== null
  && s.openingBalanceCents + s.entries.reduce((a, e) => a + e.amountCents, 0) !== s.closingBalanceCents

function toTransaction(e: BankEntry, id: string, accountId: string, importId: string): BankTransaction {
  return {
    id,
    accountId,
    importId,
    bookingDate: e.bookingDate,
    valueDate: e.valueDate,
    amountCents: e.amountCents,
    counterpartyName: e.counterpartyName,
    counterpartyIban: e.counterpartyIban,
    ultimatePartyName: e.ultimatePartyName,
    purpose: e.purpose,
    bankReference: e.bankReference,
    endToEndId: e.endToEndId,
    reversal: e.reversal,
    fingerprint: e.fingerprint,
    batchReference: e.batch?.reference ?? null,
    batchPart: e.batch?.part ?? null,
    batchParts: e.batch?.parts ?? null,
    batchTotalCents: e.batch?.totalCents ?? null,
    setAside: null,
  }
}

export function planBankImport(
  read: BankReadResult,
  stock: BankStock,
  decisions: readonly ImportDecision[],
  file: { sha256: string; name: string },
  newId: () => string,
  now: string,
): ImportPlan {
  const newIds: string[] = []
  const id = (): string => {
    const v = newId()
    newIds.push(v)
    return v
  }
  const writes: ImportWrite = { accounts: [], imports: [], days: [], transactions: [], replaced: [], payers: [] }
  const questions: ImportQuestion[] = []
  const findings: ImportFinding[] = [...read.problems]
  let knownDays = 0
  let pending = 0
  const alreadyImported: string[] = []

  const accountDecision = new Map<string, { accept: boolean; rental: boolean }>()
  const entryDecision = new Map<string, Extract<ImportDecision, { type: 'entry' }>>()
  for (const d of decisions) {
    if (d.type === 'account') accountDecision.set(d.iban, { accept: d.accept, rental: d.accept && d.rental === true })
    else entryDecision.set(d.key, d)
  }

  const accounts = [...stock.accounts]
  const accountOf = (key: string): BankAccount | undefined => accounts.find((a) => a.iban === key || (a.iban === null && a.otherId === key))
  const storedDays = new Map(stock.days.map((d) => [`${d.accountId}|${d.date}`, d]))
  const counterpartIbans = new Set([...stock.tenancyIbans.map((t) => t.iban), ...stock.payers.map((p) => p.iban)])
  const ownIbans = new Set([...stock.ownIbans, ...stock.accounts.flatMap((a) => (a.iban ? [a.iban] : []))])
  const payerKeys = new Set(stock.payers.map((p) => `${p.tenancyId}|${p.iban}`))
  const askedAccounts = new Set<string>()

  // Aufschlüsselungen (camt.054) zuletzt: Sie zerlegen, was die Tagesauszüge derselben Datei gerade angelegt haben.
  const ordered = read.statements.map((s, index) => ({ s, index }))
    .sort((a, b) => Number(a.s.format === 'camt.054') - Number(b.s.format === 'camt.054') || a.index - b.index)

  // Erster Durchgang je Auszug: Konto, Saldenprobe, abgeschlossene Tage, schon eingelesen. Was bleibt, wird nach Konto
  // und Tag gesammelt: Derselbe Tag kann auf mehreren Seiten einer Datei stehen (MT940 mit :28C: n/m, camt mit
  // mehreren Stmt), und erst alle Seiten zusammen sind der Tag (Durchsicht W2).
  // `existing`: die Tage hängen an einem vorhandenen Import (Integration D2), es entsteht keine neue Zeile.
  type Taken = { s: BankStatement; index: number; account: BankAccount; importId: string; fromDate: string; toDate: string; opening: number | null; closing: number | null; used: boolean; existing: boolean }
  const taken: Taken[] = []
  const dayEntries = new Map<string, { account: BankAccount; date: string; owner: Taken; items: { e: BankEntry; key: string }[] }>()
  const seen = new Set<string>()
  const breakdowns: { s: BankStatement; key: string; where: string }[] = []
  for (const { s, index } of ordered) {
    const where = `${file.name}, Auszug ${s.statementId ?? index + 1}`
    const key = accountKeyOf(s)
    if (key === null) continue // der Leser hat es gemeldet
    if (s.format === 'camt.054') {
      breakdowns.push({ s, key, where })
      continue
    }
    // Derselbe Auszug zweimal in der Datei (etwa doppelt im ZIP) zählt einmal.
    const identity = JSON.stringify([key, s.format, s.statementId, s.fromDate, s.toDate, s.openingBalanceCents, s.closingBalanceCents, s.entries.map((e) => [e.fingerprint, e.amountCents])])
    if (seen.has(identity)) continue
    seen.add(identity)
    // Regel 1: Saldenprobe. Der Leser meldet sie; übernommen wird der Auszug dann nicht.
    if (balanceFails(s)) {
      findings.push({ where, message: 'Dieser Auszug wird nicht übernommen, weil Anfangssaldo, Umsätze und Endsaldo nicht zusammenpassen.' })
      continue
    }
    // Regel 3: Konto.
    let account = accountOf(key)
    if (!account) {
      const answer = accountDecision.get(key)
      if (answer === undefined) {
        if (!askedAccounts.has(key)) questions.push({ type: 'account', iban: s.accountIban, otherId: s.accountIban ? null : s.accountOtherId })
        askedAccounts.add(key)
        continue
      }
      if (!answer.accept) continue
      // „Ja, ein Konto nur für die Vermietung“ (Nachtrag 13.11.) ist dieselbe ausdrückliche Bestätigung wie in der Karte
      // „Konten“: Ab jetzt wird jeder Umsatz einzeln gespeichert, und es gibt keine Rückfrage zu Eingängen.
      account = {
        id: id(),
        iban: s.accountIban,
        otherId: s.accountIban ? null : s.accountOtherId,
        label: `Konto ${key.slice(-4)}`,
        kind: answer.rental ? 'rental' : 'mixed',
        rentalConfirmedAt: answer.rental ? now : null,
      }
      accounts.push(account)
      writes.accounts.push(account)
      if (account.iban) ownIbans.add(account.iban)
    }
    // Regel 4: abgeschlossene Tage. Ein Bericht, der mitten am Tag beginnt, deckt seinen ersten Tag nicht ganz ab
    // (Durchsicht W5); dessen Umsätze kommen mit dem Tagesauszug.
    const before = closedBefore(s)
    const partialFirst = s.format === 'camt.052' && !s.fromWholeDay ? s.fromDate : null
    const closed = s.entries.filter((e) => (before === null || e.bookingDate < before) && (partialFirst === null || e.bookingDate > partialFirst))
    pending += s.entries.length - closed.length
    const entryDates = closed.map((e) => e.bookingDate).sort(compareText)
    const fromDate = (before === null ? s.fromDate : null) ?? entryDates[0]
    let toDate = (before === null ? s.toDate : null) ?? entryDates[entryDates.length - 1]
    if (before !== null && before !== '' && entryDates.length > 0) toDate = addIsoDays(before, -1)
    if (!fromDate || !toDate) continue
    // Regel 2: schon eingelesen.
    const accountId = account.id
    // Nur wenn jeder abgeschlossene Tag noch gespeichert ist (Integration D2): Hat der Vermieter einen älteren,
    // überlappenden Import zurückgenommen, fehlen dessen Tage, und dieser Auszug trägt sie am vorhandenen Import nach.
    const known = stock.imports.find((i) => i.accountId === accountId && i.fileSha256 === file.sha256 && i.fromDate === fromDate && i.toDate === toDate)
    if (known && closed.every((e) => storedDays.has(`${accountId}|${e.bookingDate}`))) {
      alreadyImported.push(known.importedAt)
      findings.push({ where, message: `Dieser Auszug wurde am ${germanDate(known.importedAt.slice(0, 10))} schon eingelesen.` })
      continue
    }
    const opening = s.format === 'camt.052' ? null : s.openingBalanceCents
    const closing = s.format === 'camt.052' ? null : s.closingBalanceCents
    // Mehrere Seiten desselben Auszugs (gleiches Konto, gleicher Zeitraum) sind ein Import (Integration D1): Der
    // Schlüssel der Tabelle ließe zwei nicht zu. Der Endsaldo ist der der letzten Seite.
    const sibling = taken.find((x) => x.account.id === accountId && x.fromDate === fromDate && x.toDate === toDate)
    if (sibling) sibling.closing = closing
    const t: Taken = sibling ?? { s, index, account, importId: known ? known.id : id(), fromDate, toDate, opening, closing, used: false, existing: known !== undefined }
    if (!sibling) taken.push(t)
    const perDay = new Map<string, number>()
    for (const e of closed) {
      const n = (perDay.get(e.bookingDate) ?? 0) + 1
      perDay.set(e.bookingDate, n)
      const dk = `${accountId}|${e.bookingDate}`
      const day = dayEntries.get(dk) ?? { account, date: e.bookingDate, owner: t, items: [] }
      day.items.push({ e, key: `${index}:${e.bookingDate}:${n}` })
      dayEntries.set(dk, day)
    }
  }

  // Zweiter Durchgang je Konto und Tag (Regeln 6 und 7), verglichen nur mit dem gespeicherten Bestand.
  for (const dk of [...dayEntries.keys()].sort(compareText)) {
    const { account, date, owner, items } = dayEntries.get(dk) ?? assertNever()
    const where = `${file.name}, Auszug ${owner.s.statementId ?? owner.index + 1}`
    const sums = daySums(items.map((i) => i.e))
    const stored = storedDays.get(dk)
    if (stored) {
      if (stored.entryCount === sums.entryCount && stored.creditCents === sums.creditCents && stored.debitCents === sums.debitCents) {
        knownDays++
      } else {
        const what = stored.entryCount === sums.entryCount
          ? `Eingänge ${euro(sums.creditCents)} statt ${euro(stored.creditCents)}, Ausgänge ${euro(sums.debitCents)} statt ${euro(stored.debitCents)}`
          : `${plural(sums.entryCount, 'Umsatz', 'Umsätze')} statt ${stored.entryCount}`
        findings.push({ where, message: `Der ${germanDate(date)} sieht in dieser Datei anders aus (${what}). Übernommen ist der frühere Stand; nehmen Sie den früheren Import unter „Konten“ zurück, wenn dieser Auszug gelten soll.` })
      }
      continue
    }
    let open = false
    const keep: BankTransaction[] = []
    for (const { e, key } of items) {
      const verdict = classify(account, e, key)
      if (verdict === 'question') open = true
      else if (verdict !== 'private') keep.push({ ...toTransaction(e, '', account.id, owner.importId), setAside: verdict === 'transfer' ? 'transfer' : null })
    }
    // Ein Tag mit offener Rückfrage wird erst geschrieben, wenn sie beantwortet ist: Halb geschrieben wäre er bekannt,
    // und der Rest fehlte für immer.
    if (open) continue
    owner.used = true
    writes.days.push({ accountId: account.id, date, importId: owner.importId, ...sums })
    for (const t of keep) writes.transactions.push({ ...t, id: id() })
  }
  for (const t of taken) {
    if (!t.used || t.existing) continue
    writes.imports.push({
      id: t.importId, accountId: t.account.id, fileSha256: file.sha256, fileName: file.name, format: t.s.format, statementId: t.s.statementId,
      fromDate: t.fromDate, toDate: t.toDate, openingBalanceCents: t.opening, closingBalanceCents: t.closing, importedAt: now, fingerprintVersion: FINGERPRINT_VERSION,
    })
  }
  for (const b of breakdowns) planBreakdown(b.s, b.key, b.where)

  // Regel 7: einordnen. 'store' speichern, 'transfer' speichern und als Umbuchung beiseitelegen, 'private' nur in der
  // Tagessumme, 'question' fragt den Vermieter.
  function classify(account: BankAccount, e: BankEntry, entryKey: string): 'store' | 'transfer' | 'private' | 'question' {
    const iban = e.counterpartyIban
    const own = iban !== null && ownIbans.has(iban)
    if (account.kind === 'rental') return own ? 'transfer' : 'store'
    if (iban !== null && counterpartIbans.has(iban)) return 'store'
    if (e.amountCents < 0 || own) return 'private'
    const answer = entryDecision.get(entryKey)
    if (!answer) {
      questions.push({ type: 'entry', key: entryKey, bookingDate: e.bookingDate, amountCents: e.amountCents, counterpartyName: e.counterpartyName, counterpartyIban: iban, purpose: e.purpose })
      return 'question'
    }
    if (answer.as === 'private') return 'private'
    if (answer.rememberPayer && answer.tenancyId && iban !== null && !payerKeys.has(`${answer.tenancyId}|${iban}`)) {
      payerKeys.add(`${answer.tenancyId}|${iban}`)
      writes.payers.push({ id: id(), tenancyId: answer.tenancyId, iban, name: e.counterpartyName })
    }
    return 'store'
  }

  // Regel 5: Eine Aufschlüsselung legt nie einen Tag an. Sie ersetzt eine gespeicherte, nicht zugeordnete
  // Sammelbuchung mit gleicher Referenz, gleichem Betrag und gleichem Buchungstag durch ihre Posten, aber nur, wenn die
  // Posten vollständig sind (Durchsicht W3) und auf einem Mischkonto jeder zur Vermietung gehört (W4): Sonst stünde ein
  // privater Posten einzeln in der Tabelle.
  function planBreakdown(s: BankStatement, key: string, where: string): void {
    const account = accountOf(key)
    const groups = new Map<string, BankEntry[]>()
    for (const e of s.entries) {
      if (!e.batch) continue
      const k = `${e.batch.reference ?? ''}|${e.batch.totalCents}|${e.bookingDate}`
      groups.set(k, [...(groups.get(k) ?? []), e])
    }
    const candidates = account ? [...stock.transactions.filter((t) => t.accountId === account.id), ...writes.transactions.filter((t) => t.accountId === account.id)] : []
    const replacedIds = new Set(writes.replaced.map((r) => r.removeId))
    for (const parts of groups.values()) {
      const first = parts[0]
      if (!first?.batch) continue
      const { reference, totalCents } = first.batch
      const date = first.bookingDate
      if (candidates.some((t) => t.batchReference === reference && t.batchTotalCents === totalCents && t.bookingDate === date)) {
        findings.push({ where, message: 'Diese Aufschlüsselung ist schon übernommen.' })
        continue
      }
      const target = candidates.find((t) => t.batchReference === null && t.bankReference !== null && t.bankReference === reference
        && t.amountCents === totalCents && t.bookingDate === date && !replacedIds.has(t.id))
      if (!target || !account) {
        findings.push({ where, message: MISSING_DAY_STATEMENT })
        continue
      }
      if (parts.length !== first.batch.parts || parts.reduce((a, p) => a + p.amountCents, 0) !== totalCents) {
        findings.push({ where, message: `Die Aufschlüsselung der Sammelbuchung vom ${germanDate(date)} ist unvollständig; die Sammelbuchung bleibt ein Umsatz.` })
        continue
      }
      if (stock.links.some((l) => l.transactionId === target.id)) {
        findings.push({ where, message: `Die Sammelbuchung vom ${germanDate(date)} ist schon zugeordnet und bleibt, wie sie ist.` })
        continue
      }
      if (account.kind === 'mixed' && parts.some((p) => p.counterpartyIban === null || !counterpartIbans.has(p.counterpartyIban))) {
        findings.push({ where, message: `Die Sammelbuchung vom ${germanDate(date)} enthält Posten, die nicht zur Vermietung gehören; sie bleibt ein Umsatz.` })
        continue
      }
      replacedIds.add(target.id)
      writes.replaced.push({
        removeId: target.id,
        parts: parts.map((p) => ({ ...toTransaction(p, id(), target.accountId, target.importId), setAside: target.setAside })),
      })
    }
  }

  const stored = writes.transactions.length + writes.replaced.reduce((a, r) => a + r.parts.length - 1, 0)
  const summary = { stored, knownDays, pending }
  const nothingElse = stored === 0 && knownDays === 0 && pending === 0 && writes.days.length === 0
  const sentence = nothingElse && alreadyImported.length > 0
    ? `Dieser Auszug wurde am ${germanDate((alreadyImported[0] ?? '').slice(0, 10))} schon eingelesen.`
    : [
        `${plural(stored, 'Umsatz', 'Umsätze')} übernommen`,
        ...(knownDays > 0 ? [`${plural(knownDays, 'Tag', 'Tage')} schon eingelesen`] : []),
        ...(pending > 0 ? [`${plural(pending, 'Umsatz kommt', 'Umsätze kommen')} mit dem Tagesauszug`] : []),
      ].join(', ') + '.'
  return { writes, questions, findings, summary, sentence, ready: questions.length === 0, newIds }
}

// Die Prüfmarke eines Plans: SHA-256 über Schreibvorgänge, Rückfragen, Befunde und Antworten. Die erzeugten Kennungen
// und der Zeitpunkt des Einlesens zählen nicht, denn sie sind beim Ausführen andere.
export function importToken(plan: ImportPlan, decisions: readonly ImportDecision[]): string {
  const ordinal = new Map(plan.newIds.map((v, i) => [v, `#${i}`]))
  const json = JSON.stringify({ writes: plan.writes, questions: plan.questions, findings: plan.findings, decisions }, (k, v: unknown) => {
    if (k === 'importedAt' || k === 'rentalConfirmedAt') return v === null ? null : ''
    return typeof v === 'string' ? (ordinal.get(v) ?? v) : v
  })
  return crypto.createHash('sha256').update(json, 'utf8').digest('hex')
}

// Die Antworten des Browsers, als JSON-Text im Feld `decisions` (multipart). Fehlt das Feld, gibt es keine Antworten;
// ist es nicht lesbar, `null`.
export function decisionsOf(raw: unknown): ImportDecision[] | null {
  if (raw === undefined || raw === '') return []
  let value: unknown
  try {
    value = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
  if (!Array.isArray(value) || value.length > 10000) return null
  const out: ImportDecision[] = []
  for (const d of value as unknown[]) {
    if (typeof d !== 'object' || d === null) return null
    const o = d as Record<string, unknown>
    if (o.type === 'account' && typeof o.iban === 'string' && typeof o.accept === 'boolean') {
      if (o.rental !== undefined && typeof o.rental !== 'boolean') return null
      out.push({ type: 'account', iban: o.iban, accept: o.accept, ...(o.rental === true ? { rental: true } : {}) })
    } else if (o.type === 'entry' && typeof o.key === 'string' && (o.as === 'rent' || o.as === 'deposit' || o.as === 'private')
      && (o.tenancyId === undefined || typeof o.tenancyId === 'string') && (o.rememberPayer === undefined || typeof o.rememberPayer === 'boolean')) {
      out.push({
        type: 'entry', key: o.key, as: o.as,
        ...(typeof o.tenancyId === 'string' ? { tenancyId: o.tenancyId } : {}),
        ...(o.rememberPayer === true ? { rememberPayer: true } : {}),
      })
    } else return null
  }
  return out
}
