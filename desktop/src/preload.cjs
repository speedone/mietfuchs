// Brücke zwischen Seite und Fenster (#517). Bewusst nur das Drucken, der Zugriff aus dem Heimnetz, die Wahl des
// alten Ordners beim Umzug der Daten und die automatischen Updates: Die Seite bleibt eine gewöhnliche Webseite
// (contextIsolation, sandbox, kein Node), und alles, was sie sonst braucht, liefert der Server.
//
// CommonJS, weil Electron ein Preload in der Sandbox nicht als ES-Modul lädt.
const { contextBridge, ipcRenderer, webFrame } = require('electron')

contextBridge.exposeInMainWorld('mietfuchsDesktop', {
  print: () => ipcRenderer.invoke('mietfuchs:print'),
  // Zugriff aus dem Heimnetz (Einstellungen): beide ergeben { enabled, port, addresses }. `set` startet den Server
  // neu, danach lädt das Fenster die Seite neu.
  network: {
    get: () => ipcRenderer.invoke('mietfuchs:network-get'),
    set: (/** @type {boolean} */ enabled) => ipcRenderer.invoke('mietfuchs:network-set', enabled === true),
  },
  // Umzug der Daten: der Ordner-Dialog des Systems, ergibt den gewählten Ordner oder null
  chooseFolder: () => ipcRenderer.invoke('mietfuchs:choose-folder'),
  // Automatische Updates (desktop/src/updater.js): alle ergeben den Stand { phase, current, version, percent, choice,
  // error, checkedAt }; `phase` ist `off`, wo das Fenster nicht selbst aktualisiert (Mac, Store, beim Entwickeln).
  // `restart` beendet den Server, installiert und startet neu; `onChange` meldet jeden neuen Stand und gibt eine
  // Funktion zum Abmelden zurück.
  updater: {
    get: () => ipcRenderer.invoke('mietfuchs:updater-get'),
    // `force` für „Jetzt prüfen“ (höchstens einmal pro Minute), sonst nur, wenn noch nicht oder vor einem Tag geprüft
    check: (/** @type {{ force?: boolean }} */ options) => ipcRenderer.invoke('mietfuchs:updater-check', options?.force === true),
    later: () => ipcRenderer.invoke('mietfuchs:updater-later'),
    restart: () => ipcRenderer.invoke('mietfuchs:updater-restart'),
    onChange: (/** @type {(state: unknown) => void} */ listener) => {
      const forward = (/** @type {unknown} */ _event, /** @type {unknown} */ state) => listener(state)
      ipcRenderer.on('mietfuchs:updater-state', forward)
      return () => { ipcRenderer.off('mietfuchs:updater-state', forward) }
    },
  },
})

// `window.print()` druckt in Electron ohne Hintergründe, das Briefpapier fehlte. Die Seite ruft es an fünf Stellen auf;
// umgeleitet wird es hier, damit die Oberfläche im Browser und im Fenster dieselbe bleibt.
webFrame.executeJavaScript('window.print = () => { void window.mietfuchsDesktop.print() }')
