import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App.tsx'

// Suppress the browser right-click menu on chrome only. Inputs keep paste, and
// any selected text or data cell keeps copy — the panel is full of ids to lift.
window.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement | null;
  const isField = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
  const isData = !!target?.closest('td, .mono, .code-block, .log, .tag');
  if (isField || isData || !window.getSelection()?.isCollapsed) return;
  e.preventDefault();
});

// Suppress browser reload, print, view-source, and navigation shortcuts.
// Ctrl+F is deliberately left through — the app maps it to its own search.
window.addEventListener('keydown', (e) => {
  if (
    e.key === 'F5' ||
    e.key === 'F11' ||
    e.key === 'F12' ||
    (e.ctrlKey && ['r', 'R', 'p', 'P', 's', 'S', 'u', 'U', 'h', 'H'].includes(e.key)) ||
    (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
  ) {
    e.preventDefault();
  }
});

// Prevent dragging links or text that Edge would otherwise open in a browser window
window.addEventListener('dragover', (e) => e.preventDefault(), false);
window.addEventListener('drop', (e) => e.preventDefault(), false);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

