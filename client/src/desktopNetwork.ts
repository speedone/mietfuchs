// Zugriff aus dem Heimnetz im Programmfenster (#517). Die Brücke stellt das Fenster bereit (desktop/src/preload.cjs);
// im Browser und auf dem Handy fehlt sie, dann erscheint die Karte in den Einstellungen nicht. Hier steht, was die
// Karte entscheidet, ohne React (Karte: components/NetworkCard.tsx).

// Was das Fenster über den Zugriff meldet. `addresses` sind die Adressen fürs Handy (http://<IPv4>:<port>), auch bei
// ausgeschaltetem Zugriff; gezeigt werden sie nur, solange er an ist.
export type NetworkState = { enabled: boolean; port: number; addresses: string[] }

// `set` startet den Server mit der neuen Adresse neu und ergibt den neuen Stand; danach lädt das Fenster die Seite neu.
export type NetworkBridge = {
  get: () => Promise<NetworkState>
  set: (enabled: boolean) => Promise<NetworkState>
}

export type DesktopBridge = {
  print?: () => Promise<unknown>
  network?: NetworkBridge
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
