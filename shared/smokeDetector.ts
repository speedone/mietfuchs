// Rauchwarnmelder in den Betriebskosten (#714), für Berechnung und Kostenformular.
//
// Die **Miete** der Geräte ist nicht umlagefähig: Sie steht den Kosten des Erwerbs gleich (BGH, Urteil vom 11.05.2022,
// VIII ZR 379/20, Leitsatz). Die Kosten der regelmäßigen Prüfung und Sicherstellung der Betriebsbereitschaft (**Wartung**)
// sind als sonstige Betriebskosten umlegbar (BGH, Urteil vom 05.10.2022, VIII ZR 117/21, Leitsatz b), wenn der Mietvertrag
// sie nennt (die Frage dazu stellt Mietfuchs bei jeder Position „Sonstige Betriebskosten“, #258). Rechnungen führen beides
// oft in einer Position („Miete und Wartung Rauchmelder“, so in beiden Urteilen).
//
// Erkannt wird nur an der Beschreibung der Position, und entschieden wird nichts: Verteilt wird wie erfasst, die Abrechnung
// sagt es. `rent`: die Beschreibung nennt Miete; `unclear`: sie nennt Rauchwarnmelder, aber weder Miete noch Wartung;
// `null`: keine Rauchwarnmelder, oder nur Wartung.
export type SmokeDetectorKind = 'rent' | 'unclear'

// Auch „Rauch-Warnmelder“, „Rauchwarn-Melder“, „Rauchm.“, „Rauchmeld.“, „Rauchmeldegerät“, „Rauchwarngerät“,
// „Rauchdetektor“, Tippfehler in „warn“ und die Abkürzung „RWM“ (auch „RWMs“). Andere Melder (Brandmeldeanlage) sind
// nicht gemeint, und der Rechnungssteller wird nicht betrachtet (Firmennamen ergäben Fehlalarme).
const DETECTOR = /rauch[- ]?(?:w[a-z]{0,4}[.-]? ?)?meld(?:er|eger|\.)|rauchwarn|rauchm\.|rauchdetektor|(?<![a-zäöüß])rwm(?![a-rt-zäöüß])/i
// Miete ist jedes „miet…“ außer den harmlosen Zusammensetzungen (Mieter, Mieteinheit, Mietwohnung, Mieträume …), dazu
// Leasing und Leihe. Eine Wortliste der Mietbegriffe schwieg bei „Mietpauschale inkl. Wartung“, „Mietanteil“, „gemietet“
// (Nachprüfung von #714). **Grenze**: Nennt eine Zeile neben den Rauchwarnmeldern die Miete eines anderen Geräts („Miete
// Wasserzähler und Wartung Rauchwarnmelder“), gilt sie als Miete der Rauchwarnmelder; der Satz sagt, woran er hängt.
const RENT = /miet(?!er|vertr|einh|wohn|whg|s?h[aä]us|objekt|verh|partei|sache|fläche|minderung|bereich|r[aä]um)|leasing|leih|gelieh|rental/i
// „Mietvertrag“ ist zweierlei: der Verweis auf den Wohnungsmietvertrag („Wartung gem. Mietvertrag“) bleibt still, der
// Mietvertrag der Geräte („Mietvertrag Nr. 4711 inkl. Wartung“) fragt nach.
const REFERRED_CONTRACT = /(?:gem\.?|gemäß|gemaess|laut|lt\.?|nach|siehe|§\s*\d+[a-z]?)\s+(?:de[mn]\s+)?mietvertr[a-zäöüß]*\.?|mietvertr[a-zäöüß]*\.?\s*§/gi
const CONTRACT = /mietvertr/i
// Eine verneinte oder ausdrücklich getrennte Miete ist keine: „keine Miete“, „ohne Gerätemiete“, „exkl. Miete“, „nicht
// gemietet“, „Miete nicht enthalten“, „Miete separat“. „zzgl. Miete“ gehört nicht dazu: Dort kommt die Miete hinzu.
const NO_RENT = /(?:keine|ohne|exkl\.?|exklusive)\s+(?:geräte)?miet[a-zäöüß-]*|nicht\s+gemietet|miete\s+(?:nicht\s+(?:enthalten|umgelegt)|separat|gesondert|herausgerechnet)/gi
// Was üblicherweise die Geräte selbst einschließt: Dann fragt der ruhige Hinweis nach, auch wenn „Wartung“ dabeisteht.
// Kauf, Lieferung und Einbau sind keine laufenden Kosten (§ 1 Abs. 1 BetrKV); die Miete setzt der BGH dem Erwerb gleich.
// Der Batterietausch gehört zur Wartung und ist ausgenommen.
const INCLUDES = /full[- ]?service|komplett|rundum|(?:ü|ue)berlassung|bereitstellung|kauf|erwerb|beschaffung|anschaffung|lieferung|montage|installation|einbau|nachrüstung|ausstattung|erneuerung|(?<!batterie[- ]?)austausch|(?:neu|ersatz)ger|gerätekosten|gerätegebühr|gerätenutzung|gerätepauschale|nutzungsgebühr|nutzungsentgelt|inkl\.?\s+ger[aä]|abschreibung|\bafa\b|finanzierung/i
// Nur was eindeutig Wartung heißt. „Service“ allein zählt nicht.
const SERVICE = /wartung|wart\.|wartg|pr(?:ü|ue)f|inspektion|kontrolle|funktionstest|batterie(?:wechsel|tausch)/i

export function smokeDetectorKind(description: string | null | undefined): SmokeDetectorKind | null {
  const text = (description ?? '').replace(NO_RENT, ' ').replace(REFERRED_CONTRACT, ' ')
  if (!DETECTOR.test(text)) return null
  if (RENT.test(text)) return 'rent'
  if (INCLUDES.test(text) || CONTRACT.test(text)) return 'unclear'
  return SERVICE.test(text) ? null : 'unclear'
}

// Die Bedingung steht dabei: Der Hinweis erscheint bei jeder umlagefähigen Kostenart, nach dem Mietvertrag fragt Mietfuchs
// aber nur bei „Sonstige Betriebskosten“ (`allocation.other-unanswered`).
const RULE = 'Die Miete von Rauchwarnmeldern ist nicht umlagefähig, ebenso wenig ihr Kauf (BGH VIII ZR 379/20); umlegbar sind nur die Kosten der Wartung als sonstige Betriebskosten, wenn der Mietvertrag sie nennt (BGH VIII ZR 117/21).'
const WAY = 'Erfassen Sie die Miete als eigene Position mit der Kostenart „Nicht umlagefähig“ und hier nur die Wartung; enthält die Position nur die Miete, ändern Sie ihre Kostenart. Trennt die Rechnung beides nicht, fragen Sie den Anbieter nach dem Anteil der Miete. Der Hinweis richtet sich nach der Beschreibung.'

// Der Satz der Abrechnung und des Kostenformulars. `tenantText`: der Betrag, den die Position auf Mieter umlegt, als Text;
// im Formular, wo er noch nicht feststeht, entfällt er.
export function smokeDetectorText(kind: SmokeDetectorKind, tenantText: string | null): string {
  const amount = tenantText === null ? '' : ` Die Position legt ${tenantText} auf Mieter um.`
  return kind === 'rent'
    ? `${RULE}${amount} ${WAY}`
    : `Enthält der Betrag Miete, Kauf oder Einbau der Geräte? ${RULE}${amount} Steckt eines davon darin, erfassen Sie es als eigene Position mit der Kostenart „Nicht umlagefähig“; nennt die Beschreibung nur die Wartung, entfällt dieser Hinweis.`
}
