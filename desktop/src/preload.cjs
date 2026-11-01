// Brücke zwischen Seite und Fenster (#517). Bewusst nur das Drucken: Die Seite bleibt eine gewöhnliche Webseite
// (contextIsolation, sandbox, kein Node), und alles, was sie sonst braucht, liefert der Server.
//
// CommonJS, weil Electron ein Preload in der Sandbox nicht als ES-Modul lädt.
const { contextBridge, ipcRenderer, webFrame } = require('electron')

contextBridge.exposeInMainWorld('mietfuchsDesktop', {
  print: () => ipcRenderer.invoke('mietfuchs:print'),
})

// `window.print()` druckt in Electron ohne Hintergründe, das Briefpapier fehlte. Die Seite ruft es an fünf Stellen auf;
// umgeleitet wird es hier, damit die Oberfläche im Browser und im Fenster dieselbe bleibt.
webFrame.executeJavaScript('window.print = () => { void window.mietfuchsDesktop.print() }')
