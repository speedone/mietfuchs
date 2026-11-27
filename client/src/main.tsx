import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './tw.css'
import { markPageEdges, markPrintWidth } from './letterDesignView'
import { installPrintFit } from './printFit'

// Druck in Safari (#286): die feste Druckbreite nur in WebKit (letter.css)
markPrintWidth(document.documentElement)
// Kopf- und Fußzeilen des Browsers (#735): in Firefox ohne Seitenrand, die 12 mm als Innenabstand (letter.css)
markPageEdges(document)
// Notbremse gegen den verkleinerten Druck (#647)
installPrintFit()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
