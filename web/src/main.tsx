import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// INTENTIONAL CI FAILURE for #44 artifact proof — remove before review
const intentionalCiFailure44: string = 1

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
