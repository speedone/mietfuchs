// Stellt für Servertests unter Node nach, was der Server im Programmfenster (#517) vorfindet: einen utilityProcess von
// Electron mit `process.versions.electron` und `process.parentPort`. Geladen über `NODE_OPTIONS=--import` vor dem
// Server. Eine Zeile „quit“ auf der Standardeingabe wird zur Nachricht „quit“ des Fensters; so prüft ein Test den Weg,
// den main.js nimmt, wenn es den Server beendet, bevor es seine Adresse kennt.
import { EventEmitter } from 'node:events'

Object.defineProperty(process.versions, 'electron', { value: '0.0.0-test', enumerable: true })
const port = Object.assign(new EventEmitter(), { postMessage: () => {} })
Object.defineProperty(process, 'parentPort', { value: port })
let buffered = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buffered += chunk
  for (let i = buffered.indexOf('\n'); i >= 0; i = buffered.indexOf('\n')) {
    port.emit('message', { data: buffered.slice(0, i).trim() })
    buffered = buffered.slice(i + 1)
  }
})
// Die Standardeingabe darf den Server nicht am Leben halten, sonst endete er nie von selbst
process.stdin.unref()
