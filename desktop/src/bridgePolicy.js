// Was die Seite im Fenster über die Brücke (preload.cjs) darf (#528, Schritt 2), ohne Electron geprüft
// (desktop/test/bridgePolicy.test.js). main.js fragt hier vor jedem Kanal.
//
// Lokal zeigt das Fenster die Seite seines eigenen Servers, sie darf alles. Verbunden mit einem Mietfuchs im Heimnetz
// kommt die Seite von einem anderen Rechner: Sie darf drucken, die Updates des Fensters bedienen und die Verbindung
// zeigen oder trennen, aber weder Ordner wählen noch den Server dieses Rechners ins Netz stellen, noch das Fenster mit
// einer anderen Adresse koppeln (`remote-connect` nur lokal). `network-get` beantwortet main.js dort mit
// `{ remote: true }`, ohne den Stand dieses Rechners zu nennen. Belege, Rahmen und fremde Seiten dürfen nie etwas
// (`ownPage`, trustedSender in server.js).

// Die Kanäle, je ohne das Präfix `mietfuchs:`
export const CHANNELS = Object.freeze([
  'print',
  'network-get', 'network-set', 'choose-folder',
  'updater-get', 'updater-check', 'updater-later', 'updater-restart',
  'remote-get', 'remote-connect', 'remote-disconnect',
])

// Was auch die Seite eines gekoppelten Servers darf
const REMOTE = new Set(['print', 'updater-get', 'updater-check', 'updater-later', 'updater-restart', 'remote-get', 'remote-disconnect'])

/**
 * @param {string} channel ohne `mietfuchs:`
 * @param {{ remote: boolean, ownPage: boolean }} where verbunden? die eigene Seite (Hauptrahmen der Oberfläche)?
 * @returns {boolean}
 */
export function allowed(channel, { remote, ownPage }) {
  if (!ownPage || !CHANNELS.includes(channel)) return false
  return remote ? REMOTE.has(channel) : true
}
