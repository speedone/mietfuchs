// Ein Hinweis in zwei Teilen (#346, Schritt 10; UI-Durchsicht M8, #341): sichtbar der Titel und **ein**
// Satz, was zu tun ist, der Rest unter „Mehr dazu“. Der Wortlaut kommt vom Server und bleibt, wie er
// ist: Zerlegt wird er nur in seine Sätze, kein Wort kommt dazu oder fällt weg. So zeigen auch
// eingefrorene Abrechnungen ihre Hinweise in derselben Form, ohne dass der Server für jeden der rund
// 180 Codes einen zweiten, kurzen Text pflegen müsste (der zweite Text liefe sonst vom ersten weg).

// Abkürzungen, nach deren Punkt kein Satz endet (aus den Texten der Berechnung abgelesen).
const ABBREVIATIONS = new Set([
  'Abs', 'Nr', 'S', 'Rn', 'Rz', 'f', 'ff', 'Buchst', 'vgl', 'Vgl', 'bzw', 'ggf', 'Drs', 'Art', 'Ziff', 'Az', 'ca',
  'inkl', 'zzgl', 'evtl', 'Tz', 'Kap', 'Bd', 'Std', 'Mio', 'Mrd', 'usw', 'bspw', 'sog', 'Anm', 'Hs', 'Halbs',
  'Alt', 'lit', 'gem', 'Var', 'Bl', 'BGBl', 'Urt', 'Beschl', 'Nrn', 'insb', 'einschl', 'zz', 'Jh',
])
const MONTHS = /^(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/

// Darf nach dem Punkt an `dot` ein Satz enden? `next` ist der Text nach dem Leerraum.
function endsSentence(text: string, dot: number, next: string): boolean {
  // Ein Satz beginnt mit einem Großbuchstaben, einem Anführungszeichen, einer Klammer, § oder einer Zahl.
  if (!/^[A-ZÄÖÜ„“"(§0-9]/.test(next)) return false
  const before = text.slice(0, dot)
  const word = /([\p{L}\p{N}.-]*)$/u.exec(before)?.[1] ?? ''
  const token = word.split(/[-.]/).pop() ?? ''
  if (ABBREVIATIONS.has(token)) return false
  // Ein einzelner Buchstabe nach einem anderen mit Punkt: zweiter Teil von „z. B.“, „d. h.“, „a. F.“.
  if (/^\p{L}$/u.test(token) && /(^|\s)\p{L}\.\s+\p{L}$/u.test(before)) return false
  // Ein einzelner Kleinbuchstabe, dem ein zweiter folgt: erster Teil einer solchen Abkürzung.
  if (/^\p{Ll}$/u.test(token) && /^\p{L}\.(\s|$)/u.test(next)) return false
  // Ein Tag vor dem Monat: „am 6. April“.
  if (/^\d{1,2}$/.test(token) && MONTHS.test(next)) return false
  return true
}

// Die Sätze des Texts mit ihrem Leerraum dahinter, sodass `sentences(t).join('') === t`.
export function sentences(text: string): string[] {
  const out: string[] = []
  let start = 0
  // Satzzeichen, dahinter wahlweise schließende Anführungszeichen oder Klammern, dann Leerraum.
  const re = /[.!?][”“"»)]*(\s+)/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = m.index + m[0].length
    const dot = m.index
    if (endsSentence(text, dot, text.slice(end))) {
      out.push(text.slice(start, end))
      start = end
    }
  }
  if (start < text.length) out.push(text.slice(start))
  return out
}

// Ein Satz, der sagt, was zu tun ist: „Tragen Sie …“, „Bitte …“. Ein Bedingungssatz mit derselben
// Stellung („Haben Sie …, ist die Abrechnung …“, „Heizen Sie mit Gas …, sind …“) sagt dagegen, was
// gilt; er ist keiner, außer sein Hauptsatz fordert selbst etwas („Wollen Sie …, wählen Sie …“).
const IMPERATIVE = /^(?:Bitte\b|[A-ZÄÖÜ][a-zäöüß]+(?:en|ern|eln) Sie\b)/
const CONDITIONAL = /^[A-ZÄÖÜ][a-zäöüß]+ Sie\b[^;:]*?, (?:ist|sind|darf|dürfen|gilt|gelten|betrifft|bleibt|bleiben|entfällt|entfallen|wird|werden|kann|können|muss|müssen|hat|haben|steht|stehen|zählt|zählen|fehlt|fehlen|ändert|reicht|genügt|liegt|liegen|trägt|tragen|sagt|rechnet|nennt|verteilt|gibt|geht|gehen|kommt|braucht)\b(?! Sie\b)/

export function isAction(sentence: string): boolean {
  const s = sentence.trim()
  return IMPERATIVE.test(s) && !CONDITIONAL.test(s)
}

// Der sichtbare Satz und der Rest. Sichtbar ist der erste Satz, der sagt, was zu tun ist, sonst der
// erste; der Rest steht in der Reihenfolge des Texts ohne ihn. Ein Text aus einem Satz hat keinen Rest.
// Beginnt der Text mit einer Ortsangabe („Heizanlage „Gas“, Heizperiode 2025: …“, „„Wasser“: …“) und
// ist der sichtbare Satz ein späterer, steht sie als `context` davor: Sonst sagte der sichtbare Teil
// zweier gleicher Hinweise nicht, welche Anlage oder Position gemeint ist. Im Rest bleibt sie stehen.
const CONTEXT = /^(Heizanlage[^:.]{0,90}|„[^“”]{1,60}“):\s/
export function splitNoticeText(text: string): { context: string, action: string, more: string } {
  const all = sentences(text)
  if (all.length <= 1) return { context: '', action: text.trim(), more: '' }
  const i = Math.max(0, all.findIndex(isAction))
  const context = i > 0 ? (CONTEXT.exec(all[0])?.[1] ?? '') : ''
  return { context, action: all[i].trim(), more: all.filter((_, k) => k !== i).join('').trim() }
}
