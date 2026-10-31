// Läuft vor jeder Testdatei (`setupFiles` in vite.config.ts). `findBy…` und `waitFor` warten
// voreingestellt nur eine Sekunde; unter Last (voller Testlauf, Server- und Client-Tests parallel)
// scheiterten so Belege, propertyCreate und AiSettings gelegentlich, ohne dass etwas falsch war
// (Durchsicht von #221). Ein Element, das wirklich nie erscheint, fällt auch nach fünf Sekunden auf.
import { configure } from '@testing-library/react'
import { beforeEach } from 'vitest'
import { installDialogPolyfill } from './testing/dialog'

configure({ asyncUtilTimeout: 5000 })

// `<dialog>` mit `showModal()` (#346): Menüblatt, Rückfrage und Seitenfenster brauchen es, und jsdom
// kennt es nicht. Nur, wo eine Datei jsdom anfordert; die übrigen laufen ohne `window`.
if (typeof window !== 'undefined' && 'HTMLDialogElement' in window) installDialogPolyfill()

// Jeder Test beginnt wie eine neue Sitzung: Die Seite Belege merkt ihre Ansicht in sessionStorage (#490), und ein Test,
// der den Ordner öffnet, sollte den nächsten nicht dort beginnen lassen.
if (typeof window !== 'undefined') {
  beforeEach(() => {
    try { sessionStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  })
}
