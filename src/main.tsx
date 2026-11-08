import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Apply dark class immediately to avoid a light flash before settings load.
document.documentElement.classList.add('dark')

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
