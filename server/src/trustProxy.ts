// NKA_TRUST_PROXY (#528, Kopplung über einen Proxy): die Peers, deren Proxy-Kopfzeilen Mietfuchs glaubt. Nur für den
// Kanal einer Anfrage (`channelOf` in access.ts); `trust proxy` von Express bleibt aus. Entwurf mit Begründungen:
// docs/superpowers/specs/2026-11-09-kopplung-proxy-design.md, Abschnitt 3.
//
// - Je Eintrag eine IP-Adresse (v4, v6), ein Netz in CIDR oder ein Name. Was jedem vertraute (`*`, `true`, eine Zahl von
//   Sprüngen wie bei Express), gilt nicht: Aus dem Heimnetz ließe sich sonst jede Kopfzeile fälschen.
// - **Namen** (der Dienst `caddy` in Docker Compose) werden erst bei Bedarf aufgelöst, nie beim Start: Caddy startet nach
//   Mietfuchs. Das Ergebnis gilt 60 Sekunden; eine Adresse außerhalb des Ergebnisses löst höchstens alle 5 Sekunden neu
//   auf (ein neu erstellter Container bekommt eine neue Adresse). Eine Auflösung zugleich, die Anfrage wartet darauf.
import dns from 'node:dns'
import net from 'node:net'
import { addressKey } from './access.ts'

export const NAME_TTL_MS = 60_000
export const MISS_RETRY_MS = 5_000
// Höchstens so lange wartet eine Anfrage auf DNS (Durchsicht M2): Ein hängender Resolver hielte sonst jede Anfrage mit
// Proxy-Kopfzeilen fest. Danach gilt der Name als nicht auflösbar, bis zum nächsten Versuch nach 5 Sekunden.
export const LOOKUP_TIMEOUT_MS = 2_000
// Engere Netze als diese vertrauten fast jedem (Durchsicht I1): IPv4 unter /8, IPv6 unter /32
const MIN_PREFIX = { ipv4: 8, ipv6: 32 } as const

const NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i
// `true` und eine Zahl von Sprüngen versteht Express als „jedem vertrauen“ bzw. „den letzten n“; beides ist fälschbar
const EVERYONE = /^(\*|true|\d+)$/i

const everyoneLine = (entry: string): string =>
  `NKA_TRUST_PROXY: „${entry}“ vertraut jedem und gilt nicht. Tragen Sie die Adresse oder den Namen des Proxys ein.`
const invalidLine = (entry: string): string =>
  `NKA_TRUST_PROXY: „${entry}“ ist weder eine IP-Adresse noch ein Netz noch ein Name und gilt nicht.`
const unresolvedLine = (name: string): string => `NKA_TRUST_PROXY: Der Name „${name}“ lässt sich (noch) nicht auflösen.`
const tooWideLine = (entry: string): string =>
  `NKA_TRUST_PROXY: „${entry}“ vertraut fast jedem und gilt nicht. Tragen Sie die Adresse des Proxys oder ein engeres Netz ein.`
// Weitere Schlüsselwörter von Express: Sie sähen aus wie Namen, sind aber Gruppen von Netzen bzw. „aus“ (Durchsicht I1)
const HOME_NETWORK = 'vertraut jedem Gerät im Heimnetz und gilt nicht. Tragen Sie die Adresse oder den Namen des Proxys ein, in Docker Compose etwa caddy.'
const KEYWORDS: Record<string, string> = {
  loopback: 'ist kein Name eines Rechners und gilt nicht. Für einen Proxy auf demselben Rechner tragen Sie 127.0.0.1,::1 ein.',
  uniquelocal: HOME_NETWORK,
  linklocal: HOME_NETWORK,
  false: 'ist kein Name eines Rechners und gilt nicht. Wer keinem Proxy vertraut, lässt NKA_TRUST_PROXY leer.',
}

// IPv4 in IPv6 als IPv4, IPv6 in einer Schreibweise, ohne Zone: so vergleicht auch die Bremse (`addressKey`)
const familyOf = (address: string): 'ipv4' | 'ipv6' | null => (net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null)

// IPv4 in IPv6 (`::ffff:a.b.c.d`, auch in Hex `::ffff:ac12:5`) ist IPv4: Ein Peer kommt so an und wird in `trusts` zu
// IPv4. Als IPv6-Netz `::ffff:0:0/96` vertraute es sonst jedem IPv4-Peer an der Untergrenze vorbei (Durchsicht, Minor 1).
const MAPPED = '0:0:0:0:0:ffff:'
function mappedV4(key: string): string | null {
  if (!key.startsWith(MAPPED)) return null
  const [high, low] = key.slice(MAPPED.length).split(':').map((g) => Number.parseInt(g, 16))
  return [high >> 8, high & 255, low >> 8, low & 255].join('.')
}
// `addressKey` bringt IPv4 in IPv6 mit Punkten schon auf IPv4, in Hex auf die volle Schreibweise
const plainKey = (raw: string): string => mappedV4(addressKey(raw)) ?? addressKey(raw)

function subnetOf(entry: string): { network: string, prefix: number, family: 'ipv4' | 'ipv6' } | null {
  const slash = entry.indexOf('/')
  if (slash < 0) return null
  const raw = entry.slice(0, slash)
  const bits = entry.slice(slash + 1)
  if (!/^\d{1,3}$/.test(bits)) return null
  const prefix = Number(bits)
  const network = plainKey(raw)
  const family = familyOf(network)
  if (!family) return null
  // Ein IPv6-Netz um IPv4 in IPv6: ab /96 ein IPv4-Netz mit 96 Bit weniger
  if (family === 'ipv4' && net.isIPv6(raw)) return prefix >= 96 && prefix <= 128 ? { network, prefix: prefix - 96, family } : null
  return prefix <= (family === 'ipv4' ? 32 : 128) ? { network, prefix, family } : null
}

export function parseTrustProxy(value: string | undefined): { addresses: net.BlockList, names: string[], problems: string[], configured: boolean } {
  const addresses = new net.BlockList()
  const names: string[] = []
  const problems: string[] = []
  let configured = false
  for (const entry of (value ?? '').split(',').map((e) => e.trim()).filter(Boolean)) {
    if (EVERYONE.test(entry)) {
      problems.push(everyoneLine(entry))
      continue
    }
    const keyword = KEYWORDS[entry.toLowerCase()]
    if (keyword) {
      problems.push(`NKA_TRUST_PROXY: „${entry}“ ${keyword}`)
      continue
    }
    const address = entry.includes('/') ? null : plainKey(entry)
    const family = address ? familyOf(address) : null
    if (address && family) {
      addresses.addAddress(address, family)
      configured = true
      continue
    }
    const subnet = subnetOf(entry)
    if (subnet && subnet.prefix < MIN_PREFIX[subnet.family]) {
      problems.push(tooWideLine(entry))
      continue
    }
    if (subnet) {
      addresses.addSubnet(subnet.network, subnet.prefix, subnet.family)
      configured = true
      continue
    }
    // Ein Name endet nicht auf eine reine Zahl: `300.1.1.1` ist eine ungültige Adresse, kein Name
    if (NAME.test(entry) && !/^\d+$/.test(entry.split('.').at(-1) ?? '')) {
      const name = entry.toLowerCase()
      if (!names.includes(name)) names.push(name)
      configured = true
      continue
    }
    problems.push(invalidLine(entry))
  }
  return { addresses, names, problems, configured }
}

export type ProxyTrust = {
  // Mindestens ein gültiger Eintrag: Dann heißt HTTPS für die Kopplung auch „über einen vertrauten Proxy“
  configured: boolean
  // Zeilen für die Fehlerausgabe beim Start
  problems: readonly string[]
  trusts(address: string | undefined): Promise<boolean>
}

type NameEntry = { addresses: string[], resolvedAt: number, attemptedAt: number, failing: boolean, pending: Promise<void> | null }

const systemLookup = async (name: string): Promise<string[]> => (await dns.promises.lookup(name, { all: true })).map((a) => a.address)

// Ein Name ohne Punkt (`caddy`) wird absolut gefragt (`caddy.`): Sonst hängte der Resolver die Suchliste des Systems an
// (`caddy.fritz.box`), und ein Gerät dieses Namens im Heimnetz gälte als Proxy. Docker beantwortet `caddy.` in seinem DNS
// (127.0.0.11) wie `caddy` (nachgemessen mit Docker 29, glibc und musl).
const absoluteName = (name: string): string => (name.includes('.') ? name : `${name}.`)

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Zeitüberschreitung')), ms)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

export function createProxyTrust(value: string | undefined, options: { lookup?: (name: string) => Promise<string[]>, now?: () => number, logError?: (line: string) => void, lookupTimeoutMs?: number } = {}): ProxyTrust {
  const { lookup = systemLookup, now = Date.now, logError = console.error, lookupTimeoutMs = LOOKUP_TIMEOUT_MS } = options
  const { addresses, names, problems, configured } = parseTrustProxy(value)
  const entries = new Map<string, NameEntry>(names.map((name) => [name, { addresses: [], resolvedAt: -Infinity, attemptedAt: -Infinity, failing: false, pending: null }]))

  function resolve(name: string, entry: NameEntry): Promise<void> {
    entry.attemptedAt = now()
    entry.pending = (async () => {
      try {
        entry.addresses = (await withTimeout(lookup(absoluteName(name)), lookupTimeoutMs)).map(plainKey)
        entry.failing = false
      } catch {
        // Kein Abbruch: Der Name ergibt keine Adresse, eine Zeile beim ersten Mal und wieder nach einer Auflösung
        entry.addresses = []
        if (!entry.failing) logError(unresolvedLine(name))
        entry.failing = true
      } finally {
        entry.resolvedAt = now()
        entry.pending = null
      }
    })()
    return entry.pending
  }

  async function viaName(name: string, entry: NameEntry, key: string): Promise<boolean> {
    // Im frischen Ergebnis: sofort, ohne auf eine laufende Auflösung für eine andere Adresse zu warten (Durchsicht M2)
    if (now() - entry.resolvedAt < NAME_TTL_MS && entry.addresses.includes(key)) return true
    if (entry.pending) await entry.pending
    const at = now()
    const fresh = at - entry.resolvedAt < NAME_TTL_MS
    if (fresh && entry.addresses.includes(key)) return true
    // Abgelaufen, oder eine Adresse außerhalb des Ergebnisses: neu auflösen, aber höchstens alle 5 Sekunden
    if (at - entry.attemptedAt >= MISS_RETRY_MS && (!fresh || !entry.addresses.includes(key))) await (entry.pending ?? resolve(name, entry))
    return now() - entry.resolvedAt < NAME_TTL_MS && entry.addresses.includes(key)
  }

  return {
    configured,
    problems,
    async trusts(address: string | undefined): Promise<boolean> {
      if (!configured || !address) return false
      const key = plainKey(address)
      const family = familyOf(key)
      if (!family) return false
      if (addresses.check(key, family)) return true
      const results = await Promise.all([...entries].map(([name, entry]) => viaName(name, entry, key)))
      return results.includes(true)
    },
  }
}
