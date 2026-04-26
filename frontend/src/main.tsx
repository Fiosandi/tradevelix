import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './style.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  console.error('Root element not found!')
} else {
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
    console.log('React app mounted successfully')
  } catch (error) {
    console.error('Error mounting React app:', error)
    rootElement.innerHTML = '<div style="padding: 20px; background: #dc2626; color: white;"><h2>React Mount Error</h2><pre>' + error + '</pre></div>'
  }
}
