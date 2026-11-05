import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

if (window.location.protocol === 'trae:') {
  document.documentElement.dataset.desktop = navigator.platform.includes('Mac') ? 'mac' : 'other'
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
