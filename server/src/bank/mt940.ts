// Kontoauszüge im Format MT940 lesen (#188).
//
// MT940 ist das ältere Textformat für Tagesauszüge, das viele Sparkassen und Banken weiter
// anbieten und Programme wie StarMoney als `.sta` exportieren. Es liefert dieselben Umsätze wie
// camt.ts, in derselben Gestalt (statement.ts), und folgt denselben Grundsätzen: nur, was auf dem
// Konto steht; nichts raten; Geld in Cent ohne Gleitkomma; ob ein Umsatz schon bekannt ist,
// entscheidet der Import.
//
// Aufbau, soweit hier gelesen:
//   :20:  Auftragsreferenz              :25:  Konto (BLZ/Konto oder IBAN)
//   :28C: Auszugsnummer/Blatt           :60F:/:60M: Anfangssaldo
//   :61:  ein Umsatz                    :86:  Angaben zum Umsatz davor
//   :62F:/:62M: Endsaldo
// Das Feld :86: ist in Deutschland nach dem DFÜ-Abkommen gegliedert: Geschäftsvorfallcode, dann
// Unterfelder mit Trennzeichen (?00 Buchungstext, ?10 Primanota, ?20–?29 und ?60–?63
// Verwendungszweck, ?30 BLZ/BIC, ?31 Konto/IBAN, ?32–?33 Name). Im Verwendungszweck stecken bei
// SEPA-Zahlungen Kennungen wie EREF+, SVWZ+ und ABWA+.

import {
  checkBalance, clip, clipEntry, clipOrNull, decimalToCents, fingerprintOf, normalizeIban, squash, startAfterOpening, TEXT_LIMITS,
  type BankEntry, type BankProblem, type BankReadResult, type BankStatement,
} from './statement.ts'

const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/

// Die SEPA-Kennungen im Verwendungszweck von :86:. Eine Kennung gilt nur am Anfang des Zwecks,
// nach Leerraum oder an einer Unterfeldgrenze, sonst wäre ein Wort, das auf „IBAN+“ endet, eine
// Kennung (siehe sepaTags).
const SEPA_TAGS = ['EREF', 'KREF', 'MREF', 'CRED', 'DEBT', 'COAM', 'OAMT', 'SVWZ', 'ABWA', 'ABWE', 'IBAN', 'BIC'] as const
type SepaTag = typeof SEPA_TAGS[number]

const NO_REFERENCE = new Set(['NONREF', 'NOTPROVIDED', 'NOT PROVIDED', 'NONE', ''])

const BOUNDARY = '\u0001'
const unglue = (s: string) => squash(s.split(BOUNDARY).join(''))

type Field = { tag: string, value: string }

// Zerlegt den Text in Felder. Ein Feld beginnt mit „:TAG:“ am Zeilenanfang und reicht bis zum
// nächsten; Folgezeilen gehören dazu. Trennzeilen („-“) und SWIFT-Umschläge ({1:…}{2:…}{3:{108:…}}
// {4:, -}{5:…}) gehören zu keinem Feld: Eine Zeile, die mit „{“ oder „-}“ beginnt, trägt höchstens
// nach „{4:“ den Anfang eines Feldes, sonst nichts. An ein Feld angehängt, machten sie dessen
// Inhalt unlesbar, beim :62F: still den Endsaldo.
function fieldsOf(text: string): Field[] {
  const fields: Field[] = []
  for (const raw of text.split(/\r\n|\r|\n/)) {
    let line = raw
    if (/^\s*(\{|-\})/.test(line)) {
      const body = line.indexOf('{4:')
      if (body < 0) continue
      line = line.slice(body + 3)
    }
    // „:NS:“ (Zusatzangaben mancher Banken, etwa Anschrift) ist ein eigenes Feld, das niemand liest;
    // als Folgezeile hinge es sonst am :86: und landete in Name oder Zweck.
    const m = /^:(\d{2}[A-Z]?|NS):(.*)$/.exec(line)
    if (m) {
      fields.push({ tag: m[1], value: m[2] })
    } else if (/^-\s*$/.test(line) || line.trim() === '') {
      continue
    } else if (fields.length) {
      fields[fields.length - 1].value += `\n${line}`
    }
  }
  return fields
}

// Die deutsche IBAN zu „BLZ/Kontonummer“ in :25: (#644), damit dasselbe Konto aus MT940 und camt eines ist: DE,
// Prüfziffer nach ISO 13616 (mod 97), BLZ, Kontonummer auf zehn Stellen. Einige Institute haben für bestimmte
// Konten eigene Regeln der Bundesbank (IBAN-Regeln); dort ergibt sich eine andere IBAN als die der Bank, und das Konto
// wird wie bisher als eigenes geführt, nie mit einem fremden verwechselt. Alles andere ist nicht abzuleiten (`null`).
function germanIbanOf(account: string): string | null {
  const m = /^(\d{8})\/(\d{1,10})$/.exec(account)
  if (!m) return null
  const bban = `${m[1]}${m[2].padStart(10, '0')}`
  // D = 13, E = 14, dazu „00“ für die Prüfziffer.
  const check = 98n - (BigInt(`${bban}131400`) % 97n)
  return `DE${String(check).padStart(2, '0')}${bban}`
}

// Saldo: C oder D, Datum JJMMTT, Währung, Betrag mit Komma.
function balanceOf(value: string): { cents: number, currency: string, date: string | null } | null {
  const m = /^([CD])(\d{6})([A-Z]{3})(\d+,\d*)$/.exec(value.trim())
  if (!m) return null
  const cents = decimalToCents(m[4], ',')
  return cents === null ? null : { cents: m[1] === 'D' ? -cents : cents, currency: m[3], date: yymmdd(m[2]) }
}

function yymmdd(s: string): string | null {
  const y = 2000 + Number(s.slice(0, 2))
  const iso = `${y}-${s.slice(2, 4)}-${s.slice(4, 6)}`
  return validDate(iso) ? iso : null
}

function validDate(iso: string): boolean {
  const t = Date.parse(`${iso}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso
}

// Der Buchungstag steht als MMTT ohne Jahr hinter der Wertstellung. Das Jahr ist das, bei dem
// der Buchungstag der Wertstellung am nächsten liegt. Nur Dezember/Januar zu prüfen genügt nicht:
// Bei einer zurückgegebenen Lastschrift ist die Wertstellung der ursprüngliche Belastungstag, und
// der kann bis zu acht Wochen zurückliegen (§ 675x BGB); November, gebucht am 10. Januar, ist das
// nächste Jahr.
function bookingDateOf(valueDate: string, mmdd: string): string | null {
  const year = Number(valueDate.slice(0, 4))
  const valueTime = Date.parse(`${valueDate}T00:00:00Z`)
  let best: string | null = null
  let bestDistance = Infinity
  for (const y of [year - 1, year, year + 1]) {
    const iso = `${y}-${mmdd.slice(0, 2)}-${mmdd.slice(2, 4)}`
    if (!validDate(iso)) continue
    const distance = Math.abs(Date.parse(`${iso}T00:00:00Z`) - valueTime)
    if (distance < bestDistance) {
      best = iso
      bestDistance = distance
    }
  }
  return best
}

// :61: Wertstellung JJMMTT, Buchungstag MMTT (optional), Richtung (C, D, RC, RD), Kennbuchstabe
// der Währung (optional), Betrag mit Komma, Buchungsschlüssel (N + drei Zeichen), Kundenreferenz,
// optional „//“ und Bankreferenz; eine zweite Zeile mit Ergänzungen.
const LINE_61 = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d{1,12},\d{0,2})([NFS][A-Z0-9]{3})([^\n]*)/

function reference(s: string | undefined): string | null {
  const t = (s ?? '').trim()
  return NO_REFERENCE.has(t.toUpperCase()) ? null : t
}

type Details86 = {
  bookingText: string | null
  purpose: string
  counterpartyName: string | null
  counterpartyIban: string | null
  endToEndId: string | null
  ultimatePartyName: string | null
}

// Volle Breite eines Unterfelds für Zweck und Name nach DFÜ-Abkommen.
const SUBFIELD_WIDTH = 27

// Ein Zeilenende unmittelbar vor einem Unterfeld, als Merkmal am vorigen Unterfeld (siehe joinSubfields).
const LINE_END = '\u0002'

type Subfield = { text: string, lineEnd: boolean }

// Wie zwei Teile des Zwecks oder des Namens zusammengehören (#644). Banken füllen die Unterfelder fortlaufend und
// schneiden dabei mitten im Wort: nach vollen 27 Zeichen, oder am Ende einer Zeile, wenn sie jede Zeile mit einem
// neuen Unterfeld beginnen. Dort kommt kein Leerzeichen hin. Endet ein Unterfeld vorher und mitten in der Zeile, hat
// die Bank es an einer Wortgrenze beendet („?20Kaution Rate 1 Whg 2?21Schmidt“), dort gehört eins hin. Ebenso keins,
// wo die Grenze eine SEPA-Kennung teilt („…SV?21WZ+…“). Der Fingerabdruck sieht keine Leerzeichen (purposeKey).
function cutAt(previous: Subfield, next: string): boolean {
  if (previous.lineEnd || previous.text.length >= SUBFIELD_WIDTH) return true
  return SEPA_TAGS.some((tag) => {
    for (let k = 1; k < tag.length + 1; k++) {
      const head = tag.slice(0, k)
      if (!previous.text.endsWith(head) || !next.startsWith(`${tag.slice(k)}+`)) continue
      const before = previous.text[previous.text.length - k - 1]
      if (before === undefined || /\s/.test(before)) return true
    }
    return false
  })
}

// Verbindet Unterfelder; zwischen zwei Teilen steht `glue` und, an einer Wortgrenze, ein Leerzeichen davor.
function joinSubfields(parts: readonly Subfield[], glue: string): string {
  let out = ''
  parts.forEach((part, i) => {
    if (i > 0) {
      const previous = parts[i - 1]
      out += (previous && !cutAt(previous, part.text) ? ' ' : '') + glue
    }
    out += part.text
  })
  return out
}

// Unterfelder des :86: nach DFÜ-Abkommen. Das Trennzeichen ist das Zeichen nach dem dreistelligen
// Geschäftsvorfallcode, meist „?“. Ein Unterfeld setzt sich über Zeilenumbrüche fort; wie die
// Teile des Zwecks (?20–?29, ?60–?63) und des Namens (?32, ?33) zusammengehören, sagt joinSubfields.
function details86(raw: string | undefined, credit: boolean): Details86 {
  const value = (raw ?? '').replace(/\r?\n/g, '')
  // Gegliedert ist ein :86: nur, wenn auf den Geschäftsvorfallcode ein Trennzeichen und zwei
  // Ziffern folgen („166?00…“). „100 EUR Kaution …“ ist Freitext.
  const structured = /^(\d{3})([^\w\s])\d{2}/.exec(value)
  const empty: Details86 = { bookingText: null, purpose: '', counterpartyName: null, counterpartyIban: null, endToEndId: null, ultimatePartyName: null }
  if (!structured) return { ...empty, purpose: squash(value) }
  const sep = structured[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Ein Zeilenende direkt vor einem Unterfeld bleibt als LINE_END stehen, jedes andere fällt weg.
  const marked = (raw ?? '').replace(new RegExp(`\\r?\\n(?=${sep}\\d{2})`, 'g'), LINE_END).replace(/\r?\n/g, '')
  const sub = new Map<number, Subfield>()
  for (const part of marked.slice(4).split(new RegExp(`${sep}(?=\\d{2})`))) {
    const key = Number(part.slice(0, 2))
    if (!Number.isInteger(key)) continue
    const body = part.slice(2)
    const known = sub.get(key)
    sub.set(key, { text: (known?.text ?? '') + body.split(LINE_END).join(''), lineEnd: body.endsWith(LINE_END) })
  }
  const subText = (key: number) => sub.get(key)?.text ?? ''
  const parts = (keys: number[]) => keys.map((k) => sub.get(k)).filter((p): p is Subfield => p !== undefined)
  // Die Grenzen der Unterfelder bleiben als BOUNDARY stehen, bis die Kennungen gefunden sind: Eine
  // Kennung beginnt meist am Anfang eines Unterfelds, direkt hinter dem Ende des vorigen
  // („?20EREF+NOTPROVIDED?21SVWZ+…“), und ohne Leerzeichen dazwischen wäre sie sonst nicht zu
  // erkennen.
  const purposeRaw = joinSubfields(parts([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 60, 61, 62, 63]), BOUNDARY)
  const tags = sepaTags(purposeRaw)
  const account = normalizeIban(subText(31))
  const name = squash(joinSubfields(parts([32, 33]), ''))
  const purpose = tags.SVWZ ?? (tags.found ? tags.rest : unglue(purposeRaw))
  return {
    bookingText: subText(0) ? squash(subText(0)) : null,
    purpose: squash(purpose),
    counterpartyName: name || null,
    counterpartyIban: IBAN.test(account) ? account : null,
    endToEndId: reference(tags.EREF),
    ultimatePartyName: (credit ? tags.ABWA : tags.ABWE) ?? null,
  }
}

// Zerlegt einen SEPA-Verwendungszweck in seine Kennungen. `rest` ist, was vor der ersten Kennung
// steht. Gesucht wird auf dem zusammengesetzten Text, denn eine Bank, die die Unterfelder
// fortlaufend nach 27 Zeichen füllt, teilt auch eine Kennung („?20…SV?21WZ+…“). Eine Kennung
// beginnt am Anfang, nach Leerraum oder an einer Unterfeldgrenze (BOUNDARY im Eingang).
function sepaTags(withBoundaries: string): Partial<Record<SepaTag, string>> & { found: boolean, rest: string } {
  const starts = new Set<number>([0])
  let purpose = ''
  for (const part of withBoundaries.split(BOUNDARY)) {
    starts.add(purpose.length)
    purpose += part
  }
  const re = new RegExp(`(${SEPA_TAGS.join('|')})\\+`, 'g')
  const marks = [...purpose.matchAll(re)]
    .filter((m) => starts.has(m.index) || /\s/.test(purpose[m.index - 1] ?? ''))
    .map((m) => ({ tag: m[1] as SepaTag, start: m.index, body: m.index + m[0].length }))
  const result: Partial<Record<SepaTag, string>> & { found: boolean, rest: string } = {
    found: marks.length > 0,
    rest: squash(marks.length ? purpose.slice(0, marks[0].start) : purpose),
  }
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : purpose.length
    const v = squash(purpose.slice(m.body, end))
    if (v) result[m.tag] = v
  })
  return result
}

export function readMt940(text: string, name = 'Datei'): BankReadResult {
  const result: BankReadResult = { statements: [], problems: [], pendingSkipped: 0 }
  const fields = fieldsOf(text)
  if (!fields.some((f) => f.tag === '61') && !fields.some((f) => f.tag.startsWith('60'))) {
    result.problems.push({ where: name, message: 'Die Datei ist kein Kontoauszug im Format MT940.' })
    return result
  }

  // Ein Auszug beginnt mit :20:. Manche Exporte lassen :20: weg; dann beginnt er mit :25:.
  const startTag = fields.some((f) => f.tag === '20') ? '20' : '25'
  const groups: Field[][] = []
  for (const f of fields) {
    if (f.tag === startTag || groups.length === 0) groups.push([])
    groups[groups.length - 1].push(f)
  }

  const reportedAccounts = new Set<string>()
  groups.forEach((group, gi) => {
    const get = (tag: string) => group.find((f) => f.tag === tag)?.value.trim()
    const statementId = clipOrNull(get('28C') ?? get('28') ?? get('20') ?? null, TEXT_LIMITS.reference)
    const label = `${name}, Auszug ${statementId ?? gi + 1}`
    const account = clip((get('25') ?? '').replace(/[A-Z]{3}$/, '').replace(/\s+/g, ''), TEXT_LIMITS.reference)
    const accountIban = IBAN.test(normalizeIban(account)) ? normalizeIban(account) : germanIbanOf(account)
    const opening = group.find((f) => f.tag === '60F' || f.tag === '60M')
    const closing = [...group].reverse().find((f) => f.tag === '62F' || f.tag === '62M')
    const openingBal = opening ? balanceOf(opening.value) : null
    const closingBal = closing ? balanceOf(closing.value) : null
    // Ein vorhandener, aber unlesbarer Saldo schaltete die Saldenprüfung still ab.
    if (opening && !openingBal) result.problems.push({ where: label, message: 'Der Anfangssaldo (:60:) lässt sich nicht lesen.' })
    if (closing && !closingBal) result.problems.push({ where: label, message: 'Der Endsaldo (:62:) lässt sich nicht lesen.' })
    // MT942 (Umsätze im Laufe des Tages) hat keine Salden und kann sich noch ändern; wie die
    // vorgemerkten Umsätze in camt wird es gezählt und nicht gelesen.
    if (!opening && !closing && group.some((f) => f.tag === '34F' || f.tag === '13D' || f.tag === '13')) {
      result.pendingSkipped += group.filter((f) => f.tag === '61').length
      result.problems.push({ where: label, message: 'Untertägige Umsätze (MT942) werden nicht übernommen, nur Tagesauszüge (MT940).' })
      return
    }
    const currency = openingBal?.currency ?? closingBal?.currency ?? null
    const statement: BankStatement = {
      format: 'mt940',
      statementId,
      accountIban,
      accountOtherId: accountIban ? null : account || null,
      createdAt: null,
      // Der Tag des Anfangssaldos; wann der Auszug beginnt, steht erst nach den Umsätzen fest (startAfterOpening).
      fromDate: openingBal?.date ?? null,
      fromWholeDay: true,
      toDate: closingBal?.date ?? null,
      openingBalanceCents: openingBal?.cents ?? null,
      closingBalanceCents: closingBal?.cents ?? null,
      entries: [],
    }
    // Einmal je Konto gemeldet, nicht je Auszug: Ein Jahr Tagesauszüge ergäbe sonst
    // zweihundertmal denselben Satz.
    if (!accountIban && !reportedAccounts.has(account)) {
      reportedAccounts.add(account)
      result.problems.push({
        where: label,
        message: account ? `Die Auszüge nennen das Konto nur als „${account}“, ohne IBAN.` : 'Der Auszug nennt das Konto nicht.',
      })
    }
    if (currency !== 'EUR') {
      result.problems.push({ where: label, message: `Der Auszug ist in ${currency ?? 'unbekannter Währung'}; Mietfuchs führt nur Euro.` })
      result.statements.push(statement)
      return
    }

    let n = 0
    group.forEach((f, i) => {
      if (f.tag !== '61') return
      n++
      const where = `${label}, Umsatz ${n}`
      const entry = readLine61(f.value, group[i + 1]?.tag === '86' ? group[i + 1].value : undefined, where, result.problems)
      if (entry) statement.entries.push(entry)
    })
    checkBalance(statement, label, result.problems)
    statement.fromDate = startAfterOpening(openingBal?.date ?? null, statement.toDate, statement.entries.map((e) => e.bookingDate))
    result.statements.push(statement)
  })
  return result
}

function readLine61(value: string, info: string | undefined, where: string, problems: BankProblem[]): BankEntry | null {
  const firstLine = value.split('\n')[0]
  const m = LINE_61.exec(firstLine)
  if (!m) {
    problems.push({ where, message: 'Die Umsatzzeile (:61:) lässt sich nicht lesen.' })
    return null
  }
  const valueDate = yymmdd(m[1])
  if (!valueDate) {
    problems.push({ where, message: 'Die Wertstellung ist kein gültiges Datum.' })
    return null
  }
  const bookingDate = m[2] ? bookingDateOf(valueDate, m[2]) : valueDate
  if (!bookingDate) {
    problems.push({ where, message: 'Der Buchungstag ist kein gültiges Datum.' })
    return null
  }
  const cents = decimalToCents(m[5], ',')
  if (cents === null) {
    problems.push({ where, message: `Der Betrag „${m[5]}“ lässt sich nicht centgenau lesen.` })
    return null
  }
  // C Gutschrift, D Lastschrift; RC ist der Storno einer Gutschrift und mindert das Konto, RD der
  // Storno einer Lastschrift und erhöht es.
  const mark = m[3]
  const credit = mark === 'C' || mark === 'RD'
  const reversal = mark.startsWith('R')
  const refs = m[7]
  const bankRef = refs.includes('//') ? reference(refs.slice(refs.indexOf('//') + 2)) : null
  const d = details86(info, credit)
  const base = {
    bookingDate,
    amountCents: credit ? cents : -cents,
    counterpartyIban: d.counterpartyIban,
    purpose: d.purpose || d.bookingText || '',
  }
  return clipEntry({
    ...base,
    valueDate,
    counterpartyName: d.counterpartyName,
    ultimatePartyName: d.ultimatePartyName,
    bankReference: bankRef,
    endToEndId: d.endToEndId,
    reversal,
    bookingDateEstimated: !m[2],
    batch: null,
    fingerprint: fingerprintOf(base),
  })
}
