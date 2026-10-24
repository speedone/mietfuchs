import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './tw.css'
import { markPrintWidth } from './letterDesignView'

// Druck in Safari (#286): die feste Druckbreite nur in WebKit (letter.css)
markPrintWidth(document.documentElement)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
