import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import { applyAccent, DEFAULT_ACCENT } from './accents.js'

// Apply persisted theme + accent before first paint to avoid a flash.
document.documentElement.setAttribute('data-theme', localStorage.getItem('reminders-theme') || 'dark')
applyAccent(localStorage.getItem('reminders-accent') || DEFAULT_ACCENT)

createRoot(document.getElementById('root')).render(<App />)
