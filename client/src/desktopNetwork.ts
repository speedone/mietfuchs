// Zugriff aus dem Heimnetz im Programmfenster (#517). Die Brücke stellt das Fenster bereit (desktop/src/preload.cjs);
// im Browser und auf dem Handy fehlt sie, dann erscheint die Karte in den Einstellungen nicht. Hier steht, was die
// Karte entscheidet, ohne React (Karte: components/NetworkCard.tsx).

// Was das Fenster über den Zugriff meldet. `addresses` sind die Adressen fürs Handy (http://<IPv4>:<port>), auch bei
// ausgeschaltetem Zugriff; gezeigt werden sie nur, solange er an ist.
export type NetworkState = { enabled: boolean; port: number; addresses: string[]; remote?: boolean }

// `set` startet den Server mit der neuen Adresse neu und ergibt den neuen Stand; danach lädt das Fenster die Seite neu.
export type NetworkBridge = {
  get: () => Promise<NetworkState>
  set: (enabled: boolean) => Promise<NetworkState>
}

export type DesktopBridge = {
  print?: () => Promise<unknown>
  network?: NetworkBridge
  // Mietfuchs im Heimnetz (#528, desktopRemote.ts)
  remote?: import('./desktopRemote').RemoteBridge
  // Umzug der Daten (#517, relocation.ts): der Ordner-Dialog des Systems, ergibt den gewählten Ordner oder null
  chooseFolder?: () => Promise<string | null>
  // Automatische Updates unter Windows (#517, desktopUpdater.ts)
  updater?: import('./desktopUpdater').UpdaterBridge
}

// Die Brücke, wenn das Fenster sie kennt. Ein Fenster vor dieser Fassung kannte nur das Drucken.
export function networkBridge(
  w: { mietfuchsDesktop?: DesktopBridge } | undefined = typeof window === 'undefined' ? undefined : window,
): NetworkBridge | null {
  const network = w?.mietfuchsDesktop?.network
  return network && typeof network.get === 'function' && typeof network.set === 'function' ? network : null
}

export type NetworkView = {
  // Adressen fürs Handy, solange der gespeicherte Zugriff an ist und es welche gibt
  addresses: string[] | null
  // Der Zugriff ist an, aber der Rechner hängt an keinem Netzwerk
  noAddress: boolean
  // Das Häkchen weicht vom gespeicherten Stand ab: Speichern startet Mietfuchs neu
  restart: boolean
  // Beim Einschalten fragt unter Windows die Firewall
  firewall: boolean
}

// Was die Karte zeigt, aus dem gespeicherten Stand und dem Häkchen (dem Entwurf).
export function networkView(saved: NetworkState, checked: boolean): NetworkView {
  const restart = checked !== saved.enabled
  const reachable = saved.enabled && saved.addresses.length > 0
  return {
    addresses: reachable ? saved.addresses : null,
    noAddress: saved.enabled && saved.addresses.length === 0,
    restart,
    firewall: restart && checked,
  }
}

// ---------- Anmeldung beim Einschalten (#528) ----------
// Was die Karte vom Zugang wissen muss (GET /api/auth). Fehlt er (älterer Server, Fehler), fragt sie nicht.
export type NetworkAccess = { mode: string, envFixed: boolean, minLength: number }

// Beim Einschalten fragt die Karte nach einem Passwort für andere Geräte, solange keines festgelegt ist und NKA_AUTH es
// nicht festlegt. Festgelegt wird es über den Fensterschlüssel, ohne Code.
export const askForPassword = (access: NetworkAccess | null, saved: NetworkState, checked: boolean): boolean =>
  access !== null && checked && !saved.enabled && !access.envFixed && access.mode !== 'password'

// Gezählt nach Zeichen wie am Server (NFC, ein Emoji ist ein Zeichen); die übrigen Regeln prüft der Server
export function passwordEntryProblem(password: string, repeat: string, minLength: number): string | null {
  if ([...password.normalize('NFC')].length < minLength) return `Das Passwort braucht mindestens ${minLength} Zeichen.`
  if (password !== repeat) return 'Die beiden Passwörter stimmen nicht überein.'
  return null
}

// Der Hinweis „Im Heimnetz erreichbar“ in der Seitenleiste (#517, Durchsicht vor 0.15.0 K5, components/NetworkHint.tsx):
// Er liest den Stand einmal von der Brücke und folgt danach der Karte, die nach dem Speichern den neuen Stand meldet.
// Sonst stünde er nach dem Ausschalten noch da, bis das Fenster die Seite neu lädt.
const networkListeners = new Set<(state: NetworkState) => void>()
export function announceNetwork(state: NetworkState): void {
  for (const listener of networkListeners) listener(state)
}
export function onNetworkChange(listener: (state: NetworkState) => void): () => void {
  networkListeners.add(listener)
  return () => { networkListeners.delete(listener) }
}

// Der Sprung vom Hinweis zur Karte: Ist sie schon da (Seite Einstellungen), kommt sie gleich ins Bild, sonst einmal,
// sobald sie erscheint. Gemerkt bis dahin, nicht länger.
let cardWanted = false
const cardListeners = new Set<() => void>()
export function requestNetworkCard(): void {
  cardWanted = cardListeners.size === 0
  for (const listener of cardListeners) listener()
}
export function onNetworkCardRequest(listener: () => void): () => void {
  cardListeners.add(listener)
  if (cardWanted) {
    cardWanted = false
    listener()
  }
  return () => { cardListeners.delete(listener) }
}
