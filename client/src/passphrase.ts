// Vorschlag einer Passphrase für die Anmeldung (#528, vom Projektinhaber bestätigt: mindestens 15 Zeichen, mit Vorschlag).
// Vier Wörter aus dieser Liste, mit Bindestrich verbunden; gezogen mit dem Zufall des Browsers (crypto.getRandomValues),
// ohne Schieflage (Verwerfen über der größten Vielfachen der Listenlänge). Nur Kleinbuchstaben ohne Umlaut, damit sich
// der Vorschlag am Handy ohne Umschalten tippen lässt. Bei 340 Wörtern sind das gut 33 Bit; gegen Raten aus dem Netz
// bremst der Server zusätzlich.
export const PASSPHRASE_WORDS: readonly string[] = [
  'abend', 'acker', 'adler', 'ahorn', 'alpen', 'ameise', 'amsel', 'anker', 'apfel', 'arena', 'atlas', 'auge',
  'bach', 'backe', 'bagger', 'ball', 'banane', 'bank', 'barke', 'bart', 'bauer', 'baum', 'becher', 'beere',
  'berg', 'besen', 'biene', 'birke', 'birne', 'blatt', 'blitz', 'blume', 'bogen', 'boje', 'boot', 'brett',
  'brief', 'brille', 'brot', 'brunnen', 'bruder', 'buch', 'burg', 'busch', 'dach', 'dackel', 'damm', 'dampf',
  'decke', 'deich', 'delfin', 'docht', 'dorf', 'drache', 'dreieck', 'duft', 'eiche', 'eimer', 'eisen', 'elch',
  'ente', 'erbse', 'erde', 'esel', 'eule', 'fabel', 'faden', 'fahne', 'falke', 'farbe', 'faser', 'feder',
  'feige', 'feld', 'fels', 'fenster', 'ferien', 'fichte', 'figur', 'fink', 'fisch', 'flasche', 'floh', 'flocke',
  'flur', 'fluss', 'flut', 'forelle', 'foto', 'frosch', 'fuchs', 'gabel', 'gans', 'garten', 'geige', 'gipfel',
  'gitarre', 'glocke', 'gold', 'gras', 'graupel', 'gurke', 'hafen', 'hafer', 'hagel', 'hahn', 'hammer', 'hase',
  'hecke', 'hefe', 'heft', 'held', 'hering', 'herz', 'heu', 'himmel', 'hirsch', 'hobel', 'honig', 'horn',
  'hose', 'hummel', 'hund', 'hut', 'igel', 'insel', 'jacke', 'jaguar', 'joghurt', 'kabel', 'kaffee', 'kahn',
  'kakao', 'kamel', 'kamin', 'kanal', 'kanne', 'karte', 'kasse', 'katze', 'kegel', 'kekse', 'kerze', 'kessel',
  'kette', 'kiefer', 'kirsche', 'kissen', 'kiste', 'klee', 'knopf', 'koala', 'koch', 'koffer', 'komet', 'kompass',
  'korb', 'kran', 'kranich', 'kraut', 'kreis', 'krone', 'kuchen', 'kugel', 'kurbel', 'lachs', 'lampe', 'land',
  'laterne', 'laub', 'lehm', 'leiter', 'lerche', 'licht', 'linde', 'lineal', 'locke', 'loewe', 'luchs', 'luft',
  'lupe', 'magnet', 'mais', 'mantel', 'mappe', 'marder', 'markt', 'maus', 'meer', 'meise', 'melone', 'messer',
  'milch', 'mixer', 'mond', 'moor', 'moos', 'motor', 'muschel', 'nadel', 'nebel', 'nest', 'netz', 'nudel',
  'ofen', 'oliven', 'onkel', 'orgel', 'otter', 'paddel', 'palme', 'papier', 'pappel', 'pinsel', 'pirat',
  'planet', 'pony', 'posaune', 'puppe', 'quark', 'quelle', 'rabe', 'radio', 'rakete', 'rasen', 'raupe', 'regen',
  'reh', 'reis', 'rinde', 'robbe', 'rock', 'rose', 'rucksack', 'ruder', 'saft', 'salat', 'salz', 'sand',
  'sattel', 'schaf', 'schal', 'schiff', 'schirm', 'schnee', 'schrank', 'schuh', 'schwan', 'see', 'segel',
  'seife', 'sessel', 'sichel', 'sieb', 'silber', 'sofa', 'sonne', 'spaten', 'spiegel', 'stall', 'stern',
  'stiefel', 'stock', 'storch', 'strand', 'strauch', 'stuhl', 'sturm', 'tafel', 'tanne', 'tasse', 'taube',
  'teich', 'teller', 'tiger', 'tinte', 'tisch', 'tomate', 'topf', 'torte', 'traube', 'treppe', 'trommel',
  'tulpe', 'turm', 'uhu', 'ufer', 'vase', 'vogel', 'waage', 'wagen', 'wald', 'walnuss', 'wanne', 'wasser',
  'welle', 'wiese', 'wind', 'winter', 'wolke', 'wolle', 'wurzel', 'zange', 'zebra', 'zelt', 'ziege', 'zimt',
  'zitrone', 'zucker', 'zwerg', 'zwiebel', 'acht', 'anis', 'aster', 'beet', 'bohne', 'dattel', 'efeu', 'fagott',
  'fenchel', 'gecko', 'gong', 'harfe', 'iltis', 'kiwi', 'lama', 'leuchte', 'minze', 'mokka', 'nelke', 'oase',
  'pfanne', 'quitte', 'rettich', 'rubin', 'salbei', 'senf', 'tukan', 'veilchen', 'walross',
]

type Random = (buf: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer>

const browserRandom: Random = (buf) => crypto.getRandomValues(buf)

function pick(random: Random): string {
  const n = PASSPHRASE_WORDS.length
  const limit = Math.floor(0x100000000 / n) * n
  const buf = new Uint32Array(1)
  // Ein Zufall, der nur verworfen würde, wiederholt sich nicht ewig; nach 64 Versuchen gilt der letzte
  for (let i = 0; i < 64; i++) {
    const v = random(buf)[0] ?? 0
    if (v < limit || i === 63) return PASSPHRASE_WORDS[v % n] ?? 'apfel'
  }
  return 'apfel'
}

// Vier Wörter; reicht das nicht für die Mindestlänge, kommt ein weiteres dazu.
export function passphrase(minLength: number, random: Random = browserRandom): string {
  const words: string[] = []
  while (words.length < 4 || [...words.join('-')].length < minLength) words.push(pick(random))
  return words.join('-')
}
