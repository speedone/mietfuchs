// Brücke zwischen Seite und Fenster (#517). Bewusst nur das Drucken, der Zugriff aus dem Heimnetz und die Wahl des
// alten Ordners beim Umzug der Daten: Die Seite bleibt eine gewöhnliche Webseite
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
})

// `window.print()` druckt in Electron ohne Hintergründe, das Briefpapier fehlte. Die Seite ruft es an fünf Stellen auf;
// umgeleitet wird es hier, damit die Oberfläche im Browser und im Fenster dieselbe bleibt.
webFrame.executeJavaScript('window.print = () => { void window.mietfuchsDesktop.print() }')
