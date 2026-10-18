import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App.tsx'
import { ThemeProvider } from './contexts/ThemeContext'
import { LanguageProvider } from './contexts/LanguageContext'
import { imageOcrWorker } from './lib/image/ImageOcrWorker'
import { installDesktopLogging, installExternalLinkHandler } from './platform'
import { installDiagnostics } from './utils/diagnostics'
import { createLogger } from './utils/logger'

installDesktopLogging()
installDiagnostics()
installExternalLinkHandler()

const log = createLogger('React')

// Warm the OCR worker, engine, and language data while the page is online.
void imageOcrWorker.preload().catch(error => log.warn('OCR preload failed', error))

createRoot(document.getElementById('root')!, {
  onUncaughtError: (error, info) => log.error('Uncaught render error', error, { componentStack: info.componentStack }),
  onCaughtError: (error, info) => log.error('Caught render error', error, { componentStack: info.componentStack }),
  onRecoverableError: (error) => log.warn('Recovered from render error', error),
}).render(
  <StrictMode>
    <LanguageProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </LanguageProvider>
  </StrictMode>,
)
