import React, { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';

const SHORTCUTS = [
  { keys: ['/'], label: 'Focus search' },
  { keys: ['Ctrl', 'K'], label: 'Focus search' },
  { keys: ['Ctrl', 'Enter'], label: 'Launch selected profiles' },
  { keys: ['Ctrl', 'A'], label: 'Select all visible' },
  { keys: ['Delete'], label: 'Delete selected' },
  { keys: ['Escape'], label: 'Deselect all / Close' },
  { keys: ['?'], label: 'Toggle this panel' },
];

export const ShortcutHelper: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="shortcuts-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="shortcuts-card">
        <div className="shortcuts-head">
          <Keyboard size={16} strokeWidth={1.75} />
          <h2>Keyboard Shortcuts</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="shortcuts-body">
          {SHORTCUTS.map((s) => (
            <div key={s.label + s.keys.join()} className="shortcut-row">
              <span>{s.label}</span>
              <div className="shortcut-keys">
                {s.keys.map((k) => (
                  <kbd key={k} className="kbd">
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// [shortcuts] key bindings
