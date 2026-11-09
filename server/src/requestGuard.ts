// Prüfung von Host und Origin (#517). Zwei Angriffe einer fremden Webseite im Browser des Vermieters:
//
// - **DNS-Rebinding:** Die Seite lässt ihren eigenen Namen auf 127.0.0.1 zeigen und liest dann Mietfuchs wie eine
//   eigene Seite aus. Abgewehrt am Host: Mietfuchs antwortet nur unter Namen, die kein Fremder auf sich ausstellen
//   kann (IP-Adressen, localhost, Rechnernamen ohne Punkt, Endungen des Heimnetzes) und unter denen aus
//   NKA_ALLOWED_HOSTS.
// - **CSRF:** Die Seite schickt ein Formular oder `fetch` an Mietfuchs und speichert, löscht oder beendet damit,
//   ohne die Antwort zu sehen. Abgewehrt an Origin bzw. Sec-Fetch-Site, nur für Anfragen, die etwas ändern.
//
// Ein Schlüssel je Start ist bewusst nicht dabei: Wer auf demselben Rechner ein Programm ausführt, liest die
// Datenbank auch ohne Mietfuchs, und „Im Browser öffnen“ müsste den Schlüssel sonst mitgeben.
//
// **Docker und npm prüfen nicht, solange NKA_ALLOWED_HOSTS fehlt.** Dort steht oft ein Reverse-Proxy mit eigener
// Domain davor, der den Host auch umschreibt (nginx setzt ihn ohne Zutun auf den Namen des Ziels); eine Prüfung
// legte solche Installationen beim Update still. „*“ schaltet die Prüfung überall ab.
import net from 'node:net'
import type { Runtime } from './version.ts'

export type GuardPolicy = { enabled: boolean, extraHosts: string[] }

export function guardPolicy(runtime: Runtime, env: NodeJS.ProcessEnv): GuardPolicy {
  const raw = env.NKA_ALLOWED_HOSTS?.trim() ?? ''
  const extraHosts = raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  if (extraHosts.includes('*')) return { enabled: false, extraHosts: [] }
  const enabled = extraHosts.length > 0 || (runtime !== 'docker' && runtime !== 'npm')
  return { enabled, extraHosts }
}

// Endungen, die nur im eigenen Netz aufgelöst werden: mDNS, Router (die FRITZ!Box vergibt `.fritz.box`), die
// reservierten Namen aus RFC 6761/6762/8375 und die privaten Netze von Tailscale und NetBird, deren Namen nur deren
// eigener DNS-Dienst auflöst.
const LOCAL_SUFFIXES = ['.localhost', '.local', '.lan', '.home', '.home.arpa', '.internal', '.localdomain', '.fritz.box', '.ts.net', '.netbird.cloud']

// Der Name ohne Port und ohne eckige Klammern einer IPv6-Adresse, klein geschrieben
function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') > 0 ? h.indexOf(']') : undefined)
  const colon = h.lastIndexOf(':')
  // Ein absoluter Name endet mit Punkt (`pi.fritz.box.`), gemeint ist derselbe
  return (colon >= 0 ? h.slice(0, colon) : h).replace(/\.$/, '')
}

// Steht der Name ausdrücklich in NKA_ALLOWED_HOSTS (genau oder unter einer Endung mit führendem Punkt)?
const listed = (name: string, extraHosts: string[]): boolean =>
  extraHosts.some((h) => (h.startsWith('.') ? name === h.slice(1) || name.endsWith(h) : name === h))

function allowedName(name: string, extraHosts: string[]): boolean {
  if (net.isIP(name) !== 0) return true
  if (name === 'localhost' || !name.includes('.')) return true
  if (LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true
  return listed(name, extraHosts)
}

// Besteht ein Name die Prüfung des Hosts? Ohne Prüfung (Docker und npm ohne NKA_ALLOWED_HOSTS, „*“) jeder. Auch für den
// Ursprung, den ein vertrauter Proxy beim Koppeln weiterreicht (#528, Durchsicht I2): Reicht ein Proxy den Wert eines
// Clients durch oder nimmt er jede Adresse an, gilt mit einer Liste nur ein Name, unter dem Mietfuchs ohnehin antwortet.
const plainName = (hostname: string): string => hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
export const hostAllowed = (hostname: string, policy: GuardPolicy): boolean =>
  !policy.enabled || allowedName(plainName(hostname), policy.extraHosts)

// Der Satz, wenn ein Name die Prüfung nicht besteht: am Host jeder Anfrage und beim Koppeln über einen Proxy derselbe
export const hostRefusal = (name: string): string =>
  `Mietfuchs antwortet nicht unter dem Namen „${name}“. Erreichbar ist es unter seiner IP-Adresse, unter localhost und unter Namen im Heimnetz. Einen eigenen Namen tragen Sie in NKA_ALLOWED_HOSTS ein.`

// Adressen, die niemand außerhalb des eigenen Netzes auf sich lenken kann: Loopback, private Netze (RFC 1918, ULA),
// Link-Local und der Bereich, aus dem Tailscale und NetBird vergeben (100.64.0.0/10)
const PRIVATE = new net.BlockList()
for (const [address, prefix] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16], ['100.64.0.0', 10]] as const) {
  PRIVATE.addSubnet(address, prefix, 'ipv4')
}
for (const [address, prefix] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) PRIVATE.addSubnet(address, prefix, 'ipv6')

function privateAddress(name: string): boolean {
  const family = net.isIP(name)
  if (family === 0) return false
  // IPv4 in IPv6 (`::ffff:192.168.1.5`, als URL `::ffff:c0a8:105`) zählt als IPv4
  const mapped = family === 6 ? /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(name) : null
  if (mapped) {
    const v4 = mapped[1] ?? [mapped[2], mapped[3]].flatMap((group) => { const n = parseInt(group ?? '0', 16); return [n >> 8, n & 255] }).join('.')
    return PRIVATE.check(v4, 'ipv4')
  }
  return PRIVATE.check(name, family === 4 ? 'ipv4' : 'ipv6')
}

// Für den weitergereichten Ursprung der Kopplung (#528): null, wenn er binden darf, sonst der Satz. Mit NKA_ALLOWED_HOSTS
// strenger als der Host (Integrationsdurchsicht m3): Fängt ein Proxy jeden Namen auf (in nginx der erste `server` am
// Port), reicht er auch einen fremden weiter, etwa `irgendwas.ts.net` oder eine öffentliche IP, auf die ein Angreifer
// ein gültiges Zertifikat hat. Dann bindet nur ein eingetragener Name, eine private oder Loopback-Adresse oder ein Name
// ohne Punkt. Ohne Liste (Programmdatei, Fenster) gilt die Regel des Hosts, ohne Prüfung jeder Name.
export function originHostRefusal(hostname: string, policy: GuardPolicy): string | null {
  const name = plainName(hostname)
  if (!hostAllowed(name, policy)) return hostRefusal(name)
  if (policy.extraHosts.length === 0) return null
  const binds = listed(name, policy.extraHosts) || privateAddress(name) || (net.isIP(name) === 0 && !name.includes('.'))
  return binds ? null : hostRefusal(name)
}

const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS'])

export type GuardRequest = { method: string, host?: string, origin?: string, secFetchSite?: string }

// null heißt durchlassen, sonst der Grund, der dem Aufrufer als Antwort gezeigt wird
export function checkRequest(req: GuardRequest, policy: GuardPolicy): string | null {
  if (!policy.enabled) return null
  if (req.host) {
    const name = hostnameOf(req.host)
    if (!allowedName(name, policy.extraHosts)) return hostRefusal(name)
  }
  if (READ_ONLY.has(req.method.toUpperCase())) return null
  if (req.origin !== undefined) {
    let origin: URL | null = null
    try {
      origin = req.origin === 'null' ? null : new URL(req.origin)
    } catch {
      origin = null
    }
    // Hinter einem Reverse-Proxy kommt der Host umgeschrieben an (nginx setzt den Namen des Ziels), die Seite heißt
    // dann, wie in NKA_ALLOWED_HOSTS eingetragen. Nur ausdrücklich eingetragene Namen, nicht die Regeln für den Host:
    // Sonst dürfte jede Seite auf localhost oder im Heimnetz ändern (Durchsicht M1).
    const sameSite = origin !== null &&
      (origin.host.toLowerCase() === req.host?.trim().toLowerCase() || listed(hostnameOf(origin.host), policy.extraHosts))
    if (!sameSite) {
      return `Änderungen nimmt Mietfuchs nur von seiner eigenen Seite an, nicht von „${req.origin}“.`
    }
    return null
  }
  if (req.secFetchSite === 'cross-site') return 'Änderungen nimmt Mietfuchs nur von seiner eigenen Seite an.'
  return null
}
