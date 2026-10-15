// Kontoauszüge im Format camt.05x lesen (#188).
//
// Eine reine Funktion: Datei hinein, Umsätze heraus, ohne Datenbank und ohne Zuordnung. Gelesen
// werden camt.053 (Tagesauszug), camt.052 (Umsätze im Laufe des Tages) und camt.054
// (Einzelnachricht), in allen Fassungen von 001.02 bis 001.08; die Umsätze stehen in allen drei
// in derselben Gestalt (`Ntry`). Hochgeladene Dateien und ZIP-Archive nimmt read.ts entgegen.
//
// Grundsätze:
// - **Ein Umsatz ist keine Zahlung.** Hier entsteht nur, was auf dem Konto steht; ob und wem es
//   als Mietzahlung zugeordnet wird, entscheidet später der Vermieter.
// - **Nur Gebuchtes.** Vorgemerkte Umsätze (`PDNG`) können sich noch ändern oder verschwinden
//   und werden nur gezählt.
// - **Nichts wird geraten.** Ein Betrag, der sich nicht centgenau lesen lässt, eine fremde
//   Währung oder ein fehlendes Buchungsdatum ergibt einen Befund, und der Umsatz fehlt. Ein
//   Umsatz, der still falsch übernommen wird, landet im Mietkonto und in der Steuer.
// - **Geld in Cent, ohne Gleitkomma.** Der Betrag wird als Zeichenkette gelesen und zerlegt.
// - **Ob ein Umsatz schon bekannt ist, entscheidet der Parser nicht.** Er liefert dafür nur
//   Fakten, die von der Datei unabhängig sind: den Fingerabdruck aus den Angaben der Buchung, die
//   Referenz der Bank und bei einer zerlegten Sammelbuchung deren Referenz und Summe. Jede Regel,
//   die allein aus einer Datei einen Schlüssel macht, scheitert an echten Auszügen in eine der
//   beiden Richtungen: Banken zählen ihre Referenz je Tag neu (verschiedene Buchungen, gleiche
//   Referenz), camt.052 trägt sie oft nicht, wo camt.053 sie trägt (gleiche Buchung, verschiedene
//   Angaben), und ein Bericht über die neuen Umsätze seit dem letzten Abruf kann eine zweite
//   gleiche Zahlung enthalten, die kein Doppel ist. Entscheiden kann das nur der Import gegen den
//   Bestand, und wo es offen bleibt, der Vermieter: Ein Umsatz wird nie still als Doppel verworfen.

import { XMLParser, XMLValidator } from 'fast-xml-parser'
import {
  checkBalance, decimalToCents, fingerprintOf, normalizeIban, problemOnly, squash,
  type BankBatch, type BankEntry, type BankProblem, type BankReadResult, type BankStatement,
} from './statement.ts'

// Diese Angaben sagen „keine Referenz“, obwohl ein Wert dasteht.
const NO_REFERENCE = new Set(['NONREF', 'NOTPROVIDED', 'NOT PROVIDED', 'NONE', ''])

const DOCUMENT_KINDS = [
  { root: 'BkToCstmrStmt', item: 'Stmt', kind: 'camt.053' },
  { root: 'BkToCstmrAcctRpt', item: 'Rpt', kind: 'camt.052' },
  { root: 'BkToCstmrDbtCdtNtfctn', item: 'Ntfctn', kind: 'camt.054' },
] as const

type Node = Record<string, unknown>

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  // Namensräume unterscheiden sich je Fassung (camt.053.001.02 bis .08), die Elemente nicht.
  removeNSPrefix: true,
  // Alles bleibt Text: Eine IBAN, eine Referenz mit führender Null oder ein Betrag darf nicht
  // als Zahl gelesen werden.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Keine Entitäten auflösen: Ein Kontoauszug braucht keine eigenen, und die fünf vordefinierten
  // samt Zeichenreferenzen löst decodeEntities selbst auf (Wunsch aus #188).
  processEntities: false,
  htmlEntities: false,
})

// ---------- kleine Leser ----------

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v)

// Ein Element, das einmal vorkommt, liest der Parser als Objekt, mehrfach als Liste.
function list(v: unknown): unknown[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

// Das erste Vorkommen am Ende eines Pfads.
function at(node: unknown, ...path: string[]): unknown {
  let cur: unknown = node
  for (const key of path) {
    if (Array.isArray(cur)) cur = cur[0]
    if (!isNode(cur)) return undefined
    cur = cur[key]
  }
  return Array.isArray(cur) ? cur[0] : cur
}

// Alle Vorkommen eines Pfads, über jede Ebene, die sich wiederholen darf: `all(ntry, 'NtryDtls',
// 'TxDtls')` liefert die Posten aller `NtryDtls`-Blöcke, nicht nur die des ersten.
function all(node: unknown, ...path: string[]): unknown[] {
  let level: unknown[] = list(node)
  for (const key of path) level = level.flatMap((n) => (isNode(n) ? list(n[key]) : []))
  return level
}

// Der Parser löst keine Entitäten auf (siehe oben). Hier werden genau die fünf vordefinierten
// (&amp; &lt; &gt; &quot; &apos;) und Zeichenreferenzen (&#228; &#xE4;) aufgelöst, in einem
// Durchgang, damit „&amp;lt;“ als „&lt;“ stehen bleibt und nicht zu „<“ wird.
const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(s: string): string {
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (name !== undefined) return PREDEFINED[name.toLowerCase()] ?? whole
    const code = hex !== undefined ? parseInt(hex, 16) : Number(dec)
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

function text(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = decodeEntities(v).trim()
    return s === '' ? null : s
  }
  if (isNode(v) && typeof v['#text'] === 'string') return text(v['#text'])
  return null
}

function iban(v: unknown): string | null {
  const s = text(v)
  return s ? normalizeIban(s) : null
}

function reference(v: unknown): string | null {
  const s = text(v)
  return s && !NO_REFERENCE.has(s.toUpperCase()) ? s : null
}

const berlinDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })

// Kalendertag aus `Dt` ('2025-03-03') oder `DtTm`. Ein Zeitpunkt mit Zeitzone ('…Z', '…+01:00')
// wird in den Tag in Deutschland umgerechnet, denn um 23:30 Uhr UTC ist dort schon der nächste
// Tag, und am 31.12. hinge daran das Jahr. Ohne Zeitzone gilt die Ortszeit der Bank, wie sie
// dasteht.
function civilDate(v: unknown): string | null {
  const date = text(at(v, 'Dt'))
  if (date) return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
  const stamp = text(at(v, 'DtTm'))
  if (!stamp) return null
  if (/(Z|[+-]\d{2}:\d{2})$/.test(stamp)) {
    const t = new Date(stamp)
    return Number.isNaN(t.getTime()) ? null : berlinDay.format(t)
  }
  const day = stamp.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

// '850.00' → 85000, '850' → 85000, '850.5' → 85050. Mehr als zwei Nachkommastellen nur, wenn
// sie Null sind: camt erlaubt fünf, ein Euro hat zwei, und gerundet wird hier nicht.
export const amountToCents = (raw: string): number | null => decimalToCents(raw, '.')

// ---------- ein Umsatz ----------

type EntryContext = { where: string, problems: BankProblem[], accountIban: string | null }

function signOf(indicator: unknown): 1 | -1 | null {
  const s = text(indicator)
  return s === 'CRDT' ? 1 : s === 'DBIT' ? -1 : null
}

function purposeOf(tx: unknown, ntry: unknown): string {
  const lines = all(tx, 'RmtInf', 'Ustrd')
    .map(text)
    .filter((s): s is string => s !== null)
  if (lines.length) return squash(lines.join(' '))
  const structured = text(at(tx, 'RmtInf', 'Strd', 'CdtrRefInf', 'Ref'))
  if (structured) return squash(structured)
  const additional = text(at(tx, 'AddtlTxInf')) ?? text(at(ntry, 'AddtlNtryInf'))
  return additional ? squash(additional) : ''
}

// Den Namen führt camt.053.001.02 unmittelbar (`Dbtr/Nm`), ab .08 eine Ebene tiefer (`Dbtr/Pty/Nm`).
function partyName(parties: unknown, role: string): string | null {
  const name = text(at(parties, role, 'Nm')) ?? text(at(parties, role, 'Pty', 'Nm'))
  return name ? squash(name) : null
}

// Die Gegenseite ist bei einem Eingang der Zahler (Dbtr), bei einem Ausgang der Empfänger (Cdtr).
// Ein Storno und eine Rücklastschrift behalten die Rollen der ursprünglichen Zahlung: Bei einer
// zurückgegebenen Lastschrift bleibt der Mieter Dbtr, obwohl das Geld jetzt abfließt. Steht auf
// der gewählten Seite trotzdem das eigene Konto, ist es die andere.
function counterpartyOf(tx: unknown, sign: 1 | -1, reversal: boolean, accountIban: string | null) {
  const parties = at(tx, 'RltdPties')
  const read = (role: 'Dbtr' | 'Cdtr') => ({
    name: partyName(parties, role),
    iban: iban(at(parties, `${role}Acct`, 'Id', 'IBAN')),
    ultimate: partyName(parties, role === 'Dbtr' ? 'UltmtDbtr' : 'UltmtCdtr'),
  })
  const primary: 'Dbtr' | 'Cdtr' = (sign > 0) !== reversal ? 'Dbtr' : 'Cdtr'
  const chosen = read(primary)
  if (accountIban && chosen.iban === accountIban) {
    const other = read(primary === 'Dbtr' ? 'Cdtr' : 'Dbtr')
    if (other.iban && other.iban !== accountIban) return other
    // Nennen beide Seiten nur das eigene Konto (oder die andere gar keins), gibt es keine
    // erkennbare Gegenseite. Das eigene Konto als Gegenseite ließe den Vermieter als seinen
    // eigenen Zahler dastehen.
    return { name: null, iban: null, ultimate: chosen.ultimate }
  }
  return chosen
}

// Betrag eines Postens in einer Sammelbuchung: `Amt` ab .08, `AmtDtls/TxAmt/Amt` davor.
function txAmountOf(tx: unknown): { raw: string, currency: string | null } | null {
  const amt = at(tx, 'Amt') ?? at(tx, 'AmtDtls', 'TxAmt', 'Amt')
  const raw = text(amt)
  if (!raw) return null
  return { raw, currency: isNode(amt) ? text(amt['@Ccy']) : null }
}

function readEntry(ntry: unknown, ctx: EntryContext): BankEntry[] | null {
  const amt = at(ntry, 'Amt')
  const currency = isNode(amt) ? text(amt['@Ccy']) : null
  const raw = text(amt)
  const sign = signOf(at(ntry, 'CdtDbtInd'))
  const bookingDate = civilDate(at(ntry, 'BookgDt'))
  if (!raw || sign === null) {
    ctx.problems.push({ where: ctx.where, message: 'Betrag oder Richtung (Eingang/Ausgang) fehlt.' })
    return null
  }
  if (currency !== 'EUR') {
    ctx.problems.push({ where: ctx.where, message: `Der Umsatz ist in ${currency ?? 'unbekannter Währung'}; Mietfuchs führt nur Euro.` })
    return null
  }
  const cents = amountToCents(raw)
  if (cents === null) {
    ctx.problems.push({ where: ctx.where, message: `Der Betrag „${raw}“ lässt sich nicht centgenau lesen.` })
    return null
  }
  if (!bookingDate) {
    ctx.problems.push({ where: ctx.where, message: 'Das Buchungsdatum fehlt oder ist unlesbar.' })
    return null
  }
  const valueDate = civilDate(at(ntry, 'ValDt'))
  // `RvslInd` ist ein XML-Boolean: `true` oder `1`.
  const reversalText = text(at(ntry, 'RvslInd'))
  const reversal = reversalText === 'true' || reversalText === '1'
  const entryRef = reference(at(ntry, 'AcctSvcrRef'))
  const txs = all(ntry, 'NtryDtls', 'TxDtls')

  const one = (tx: unknown, amountCents: number, txSign: 1 | -1, bankReference: string | null, batch: BankBatch | null): BankEntry => {
    const party = counterpartyOf(tx, txSign, reversal, ctx.accountIban)
    const base = {
      bookingDate,
      amountCents,
      counterpartyIban: party.iban,
      purpose: purposeOf(tx, ntry),
    }
    return {
      ...base,
      valueDate,
      counterpartyName: party.name,
      ultimatePartyName: party.ultimate,
      bankReference,
      endToEndId: reference(at(tx, 'Refs', 'EndToEndId')),
      reversal,
      bookingDateEstimated: false,
      batch,
      fingerprint: fingerprintOf(base),
    }
  }

  // Eine Sammelbuchung (mehrere Posten unter einem Umsatz) wird zerlegt, aber nur, wenn jeder
  // Posten einen lesbaren Euro-Betrag trägt und die Summe genau den Umsatz ergibt. Jeder Posten
  // trägt dann Referenz und Summe der Sammelbuchung, denn dieselbe Bank meldet sie in camt.052
  // mitunter als Summe und in camt.053 zerlegt; der Import erkennt sie so als dieselbe.
  if (txs.length > 1) {
    const parts: { tx: unknown, cents: number, sign: 1 | -1 }[] = []
    for (const tx of txs) {
      const a = txAmountOf(tx)
      const c = a && a.currency === 'EUR' ? amountToCents(a.raw) : null
      if (c === null) break
      const s = signOf(at(tx, 'CdtDbtInd')) ?? sign
      parts.push({ tx, cents: c * s, sign: s })
    }
    if (parts.length === txs.length && parts.reduce((a, p) => a + p.cents, 0) === cents * sign) {
      return parts.map((p, i) => one(p.tx, p.cents, p.sign,
        reference(at(p.tx, 'Refs', 'AcctSvcrRef')),
        { reference: entryRef, totalCents: cents * sign, part: i + 1, parts: parts.length }))
    }
    ctx.problems.push({
      where: ctx.where,
      message: `Sammelbuchung mit ${txs.length} Posten, die sich nicht zum Umsatz addieren; sie wird als ein Umsatz übernommen.`,
    })
  }
  // Ein einzelner Posten ist nur dann der ganze Umsatz, wenn die Bank keine größere Sammelbuchung
  // ankündigt (`Btch/NbOfTxs`) und sein Betrag, falls er einen nennt, dem Umsatz entspricht. Sonst
  // ist es ein Ausschnitt einer Sammelbuchung: 2.400 € mit einem Posten über 800 € von einem Mieter
  // wären ein Umsatz über 2.400 € von ihm, und die Zuordnung schlüge ihm eine dreifache Miete vor.
  if (txs.length === 1) {
    const announced = Number(text(at(ntry, 'NtryDtls', 'Btch', 'NbOfTxs')) ?? '1')
    const a = txAmountOf(txs[0])
    const partCents = a && a.currency === 'EUR' ? amountToCents(a.raw) : null
    const partSign = signOf(at(txs[0], 'CdtDbtInd')) ?? sign
    const mismatch = (a !== null && (partCents === null || partCents * partSign !== cents * sign)) || (Number.isFinite(announced) && announced > 1)
    if (mismatch) {
      ctx.problems.push({
        where: ctx.where,
        message: 'Sammelbuchung, von der die Datei nur einen Teil der Posten nennt; sie wird als ein Umsatz ohne einzelne Gegenseite übernommen.',
      })
      return [one(undefined, cents * sign, sign, entryRef, null)]
    }
  }
  // Eine nicht zerlegte Sammelbuchung ist ein Umsatz ohne einzelne Gegenseite: Name, IBAN und Zweck
  // des ersten Postens zu nehmen, ließe den Fingerabdruck an der Reihenfolge der Posten hängen.
  return [one(txs.length > 1 ? undefined : txs[0], cents * sign, sign, entryRef ?? reference(at(txs[0], 'Refs', 'AcctSvcrRef')), null)]
}

// Saldo eines Auszugs nach Art: OPBD (Anfangssaldo), PRCD (Endsaldo des Vortags, gilt als
// Anfang), CLBD (Endsaldo). Einen Saldo, der sich nicht centgenau lesen lässt, gibt es nicht.
function balanceOf(item: unknown, codes: string[]): number | null {
  for (const bal of all(item, 'Bal')) {
    const code = text(at(bal, 'Tp', 'CdOrPrtry', 'Cd')) ?? text(at(bal, 'Tp', 'CdOrPrtry', 'Prtry'))
    if (!code || !codes.includes(code)) continue
    const raw = text(at(bal, 'Amt'))
    const sign = signOf(at(bal, 'CdtDbtInd'))
    const cents = raw ? amountToCents(raw) : null
    return cents === null || sign === null ? null : cents * sign
  }
  return null
}

// Steht ein Saldo der gesuchten Art im Auszug, lässt sich aber nicht lesen? Dann entfiele die
// Saldenprobe still; MT940 meldet denselben Fall.
function unreadableBalance(item: unknown, codes: string[]): boolean {
  const present = all(item, 'Bal').some((b) => codes.includes(text(at(b, 'Tp', 'CdOrPrtry', 'Cd')) ?? text(at(b, 'Tp', 'CdOrPrtry', 'Prtry')) ?? ''))
  return present && balanceOf(item, codes) === null
}

function balanceDate(item: unknown, codes: string[]): string | null {
  const bal = all(item, 'Bal').find((b) => codes.includes(text(at(b, 'Tp', 'CdOrPrtry', 'Cd')) ?? text(at(b, 'Tp', 'CdOrPrtry', 'Prtry')) ?? ''))
  return bal ? civilDate(at(bal, 'Dt')) : null
}

// ---------- ein Dokument ----------

export function readCamt(xml: string, name = 'Datei'): BankReadResult {
  const result: BankReadResult = { statements: [], problems: [], pendingSkipped: 0 }
  // camt kennt keine Dokumenttyp-Erklärung. Eine Datei mit DOCTYPE oder eigenen Entitäten ist
  // kein Kontoauszug und könnte beim Auflösen beliebig wachsen.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    result.problems.push({ where: name, message: 'Die Datei enthält eine Dokumenttyp-Erklärung und ist kein Kontoauszug im Format camt.' })
    return result
  }
  // Erst prüfen, ob das XML vollständig ist: Der Parser liest auch eine abgeschnittene Datei
  // nachsichtig ein, und aus einem halben Auszug würde still ein leerer.
  if (XMLValidator.validate(xml) !== true) {
    result.problems.push({ where: name, message: 'Die Datei ist kein vollständiges XML; vielleicht wurde sie beim Herunterladen abgeschnitten.' })
    return result
  }
  let doc: unknown
  try {
    doc = at(parser.parse(xml), 'Document')
  } catch {
    result.problems.push({ where: name, message: 'Die Datei ist kein lesbares XML.' })
    return result
  }
  const found = DOCUMENT_KINDS.find((k) => at(doc, k.root) !== undefined)
  if (!found) {
    result.problems.push({ where: name, message: 'Die Datei ist kein Kontoauszug im Format camt.052, camt.053 oder camt.054.' })
    return result
  }
  const items = all(at(doc, found.root), found.item)
  if (items.length === 0) {
    result.problems.push({ where: name, message: 'Die Datei enthält keinen Auszug.' })
  }
  items.forEach((item, si) => {
    const statementId = text(at(item, 'Id'))
    const label = `${name}, Auszug ${statementId ?? si + 1}`
    const statement: BankStatement = {
      format: found.kind,
      statementId,
      accountIban: iban(at(item, 'Acct', 'Id', 'IBAN')),
      accountOtherId: text(at(item, 'Acct', 'Id', 'Othr', 'Id')),
      createdAt: text(at(item, 'CreDtTm')),
      // Ohne Zeitraum (FrToDt ist freiwillig) nennen ihn die Salden: ihr Datum.
      fromDate: civilDate({ DtTm: at(item, 'FrToDt', 'FrDtTm') }) ?? balanceDate(item, ['OPBD', 'PRCD']),
      toDate: civilDate({ DtTm: at(item, 'FrToDt', 'ToDtTm') }) ?? balanceDate(item, ['CLBD']),
      openingBalanceCents: balanceOf(item, ['OPBD', 'PRCD']),
      closingBalanceCents: balanceOf(item, ['CLBD']),
      entries: [],
    }
    if (unreadableBalance(item, ['OPBD', 'PRCD'])) result.problems.push({ where: label, message: 'Der Anfangssaldo lässt sich nicht lesen.' })
    if (unreadableBalance(item, ['CLBD'])) result.problems.push({ where: label, message: 'Der Endsaldo lässt sich nicht lesen.' })
    if (!statement.accountIban) {
      result.problems.push({
        where: label,
        message: statement.accountOtherId
          ? `Der Auszug nennt das Konto nur als „${statement.accountOtherId}“, ohne IBAN.`
          : 'Der Auszug nennt das Konto nicht.',
      })
    }
    all(item, 'Ntry').forEach((ntry, ni) => {
      const where = `${label}, Umsatz ${ni + 1}`
      // Der Status ist Pflicht: Text bis .02, `Cd` oder `Prtry` ab .08. Fehlt er, ist offen, ob
      // die Buchung steht, und geraten wird nicht.
      const status = text(at(ntry, 'Sts')) ?? text(at(ntry, 'Sts', 'Cd')) ?? text(at(ntry, 'Sts', 'Prtry'))
      if (!status) {
        result.problems.push({ where, message: 'Der Umsatz hat keinen Status; ob er gebucht ist, ist offen.' })
        return
      }
      if (status !== 'BOOK') {
        result.pendingSkipped++
        return
      }
      statement.entries.push(...(readEntry(ntry, { where, problems: result.problems, accountIban: statement.accountIban }) ?? []))
    })
    // camt.052 kann vorgemerkte Umsätze im Saldo führen, die hier nicht gelesen werden; geprüft
    // wird deshalb nur der Tagesauszug.
    if (found.kind === 'camt.053') checkBalance(statement, label, result.problems)
    result.statements.push(statement)
  })
  return result
}

// ---------- eine hochgeladene Datei ----------

// Die Kodierung steht in der XML-Erklärung. UTF-8 ist der Normalfall; ältere Exporte kommen in
// ISO-8859-1 oder Windows-1252, und als UTF-8 gelesen würde aus „März“ „M�rz“, und der
// Verwendungszweck stimmte mit dem desselben Umsatzes aus einer anderen Datei nicht mehr überein.
function decodeXml(data: Buffer): { xml: string } | { problem: string } {
  const head = data.subarray(0, 200).toString('latin1')
  const declared = /^(?:\xEF\xBB\xBF)?<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(head)?.[1].toLowerCase() ?? 'utf-8'
  // ISO-8859-1 wird wie Windows-1252 gelesen, wie es auch Browser tun: Die beiden unterscheiden
  // sich nur in Steuerzeichen, die in einem Kontoauszug nicht vorkommen, dafür steht das €-Zeichen
  // aus Windows-Exporten dann richtig da.
  const label = declared === 'iso-8859-1' || declared === 'latin1' ? 'windows-1252' : declared
  try {
    return { xml: new TextDecoder(label).decode(data) }
  } catch {
    return { problem: `Die Datei ist in der Kodierung „${declared}“ geschrieben, die Mietfuchs nicht lesen kann.` }
  }
}

// Eine camt-Datei als Bytes: Kodierung aus der XML-Erklärung, dann lesen.
export function readCamtFile(data: Buffer, where: string): BankReadResult {
  const decoded = decodeXml(data)
  return 'problem' in decoded ? problemOnly(where, decoded.problem) : readCamt(decoded.xml, where)
}
