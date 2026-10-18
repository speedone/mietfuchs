// Ein Hinweis in zwei Teilen (#346, Schritt 10; UI-Durchsicht M8, #341): sichtbar bleibt alles bis auf
// Begründungen aus Fundstellen, die unter „Mehr dazu“ kommen. Der Wortlaut kommt vom Server und bleibt, wie er
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

// ---------- Fundstellen ----------
// Was M8 bemängelte, waren die Ketten aus Normen, Urteilen und Drucksachen, nicht die Folgen. Erkannt wird
// eine Fundstelle an ihrer Form; was danach vom Satz übrig bleibt, entscheidet, ob er eingeklappt wird.
const LAW = String.raw`(?:[A-ZÄÖÜ][\wÄÖÜäöüß]*(?:G|V|O|VO|KostAufG|StDV|BV)|BGB|EStG|EStDV|HeizkostenV|BetrKV|MessEV|WärmeLV|GModG|BEHG|UStG|CO2KostAufG|GEG|WoFlV|II\. BV)`
const NORM = new RegExp(String.raw`(?:§§?|Art\.)\s*\d+[a-z]?(?:\s*(?:Abs\.|Satz|S\.|Nr\.|Buchst\.|Halbs\.|Hs\.|Alt\.|lit\.)\s*[\da-z]+[a-z]?)*(?:\s*(?:und|bis|,|/)\s*(?:§§?\s*)?\d+[a-z]?(?:\s*(?:Abs\.|Satz|Nr\.|Buchst\.)\s*[\da-z]+)*)*(?:\s*(?:a\. F\.|n\. F\.))?(?:\s+${LAW})?`, 'g')
const COURT = /\b(?:BGH|BFH|BVerfG|BAG|BSG|OLG|LG|AG|VG|OVG|EuGH)\b[^.;()]*?(?:\b[IVX]+ [A-Z]{1,3} \d+\/\d+|\b\d+ [A-Z]{1,3} \d+\/\d+|\bWuM \d{4}, \d+)(?:,?\s*(?:Rn\.|Rz\.|Leitsatz)\s*[\da-z]+(?:\s*f+\.)?)*/g
const DOCKET = /\b[IVX]+ [A-Z]{1,3} \d+\/\d+(?:,?\s*(?:Rn\.|Rz\.|Leitsatz)\s*[\da-z]+(?:\s*f+\.)?)*/g
const PRINTED = /\b(?:BT|BR)-Drs\.\s*\d+\/\d+(?:,\s*S\.\s*\d+(?:\s*f+\.)?)?|\bBGBl\.\s*\d{4}\s*I+(?:\s*(?:Nr\.|S\.)\s*\d+)?|\bRn\.\s*\d+(?:\s*f+\.)?|\bKinne\/Schach\/Bieber[^,;)]*/g

// Was nie eingeklappt wird: Prozent- und Promillezahlen, Beträge, Daten (auch „6. April 2005“), Kürzungen.
export const PROTECTED = /\d+(?:,\d+)?\s*(?:%|‰)|€|\b\d{1,2}\.\d{1,2}\.\d{4}\b|\b\d{1,2}\.\s*(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b|kürz|Kürz/

// Ein Satz, dessen Inhalt nach Abzug der Fundstellen (Normen, Urteile mit Datum und Aktenzeichen,
// Drucksachen, Randnummern) nichts trägt, was der Vermieter sehen muss: keine Prozentzahl, kein Betrag,
// kein Datum, keine Aufforderung, keine Kürzung. Und er muss überwiegend aus Fundstellen bestehen oder ein
// Urteil oder eine Drucksache nennen; ein Satz mit einer einzelnen Norm in der Mitte bleibt sichtbar.
export function isCitationSentence(sentence: string): boolean {
  const s = sentence.trim()
  let cited = 0
  let strong = false
  const mask = (re: RegExp, isStrong: boolean) => (t: string) => t.replace(re, (m) => { cited += m.length; if (isStrong) strong = true; return ' ' })
  let rest = mask(COURT, true)(s)
  rest = mask(DOCKET, true)(rest)
  rest = mask(PRINTED, true)(rest)
  rest = mask(NORM, false)(rest)
  if (cited === 0) return false
  if (PROTECTED.test(rest)) return false
  // Eine Aufforderung auch mitten im Satz („…; tragen Sie dann …“), eine Bitte, eine Ortsangabe vorn.
  if (isAction(s) || /\b(?:bitte|Bitte)\b|[,;:]\s+[a-zäöü]+(?:en|ern|eln) Sie\b/.test(rest) || /^„[^“”]+“:/.test(s)) return false
  const words = rest.replace(/[^\p{L}\p{N}]+/gu, '').length
  if (cited >= words) return true
  // Ein Satz, der ein Urteil oder eine Drucksache als Beleg nennt, ist eine Begründung, außer er sagt eine
  // Folge für Geld oder Pflichten („zahlen die Mieter“, „dürfen Sie nur nachfordern“, „ist unwirksam“).
  return strong && !/\b(?:zahl\w*|trag\w*|trägt|nachford\w*|unwirksam|falsch|unzulässig|nicht zulässig|darf|dürfen|muss|müssen|erstatt\w*|Frist\w*|umleg\w*|aufteil\w*|aufgeteilt|reicht|genügt|außer)\b/i.test(rest)
}

// Ein Satz, der mit einem Verweis auf den vorigen beginnt („Öffnen Sie sie wieder …“, „Das …“,
// „Dafür …“, „Tragen Sie dort …“): ohne den vorigen Satz ist er nicht zu verstehen.
const REFERS_BACK = /^(?:(?:[A-ZÄÖÜ][a-zäöüß]+ Sie (?:sie|ihn|es|ihr|ihm|ihnen|das|dies\w*|diese\w*|dort|dann|darauf|dafür|damit|davon|daran|dazu|hier|so)\b)|(?:Das|Dies\w*|Diese\w*|Sie|Er|Es|Ihr\w*|Sein\w*|Dort|Dann|Da(?:für|mit|von|ran|zu|nach|rauf|her|bei|gegen)|Deshalb|Daher|Somit|Dabei|Hier|Ebenso|Auch)\b)|bis dahin/

// Was sichtbar bleibt (#346, Schritt 10; Entscheidung nach der Durchsicht): grundsätzlich alles. Unter
// „Mehr dazu“ kommen nur Sätze aus Fundstellen (`isCitationSentence`), und nur, wenn danach noch etwas
// sichtbar bleibt; ein sichtbarer Satz, der auf einen eingeklappten verweist, holt ihn wieder hervor.
// Ein Fehler (Stufe `error`) steht ganz offen da (#236). Die Reihenfolge des Texts bleibt in beiden Teilen.
export function splitNoticeText(text: string, level?: string): { visible: string, more: string } {
  const all = sentences(text)
  if (level === 'error' || all.length <= 1) return { visible: text.trim(), more: '' }
  const hidden = all.map(isCitationSentence)
  for (let changed = true; changed;) {
    changed = false
    for (let i = 1; i < all.length; i++) {
      if (!hidden[i] && hidden[i - 1] && REFERS_BACK.test((all[i] ?? '').trim())) { hidden[i - 1] = false; changed = true }
    }
  }
  if (hidden.every(Boolean)) return { visible: text.trim(), more: '' }
  return {
    visible: all.filter((_, k) => !hidden[k]).join('').trim(),
    more: all.filter((_, k) => hidden[k]).join('').trim(),
  }
}
