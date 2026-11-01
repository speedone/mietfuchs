// Die Brücke des Programmfensters (#517, desktop/src/preload.cjs). Nur im Fenster vorhanden; im Browser fehlt sie.
interface Window {
  mietfuchsDesktop?: import('./desktopNetwork').DesktopBridge
}
