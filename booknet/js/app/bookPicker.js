// Source badge + book picker overlay.

import { state } from './state.js';

export function createBookPicker(stage, options = {}) {
  const { onSaveLayout } = options || {};

  const sourceBadge = document.createElement('div');
  sourceBadge.id = 'sourceBadge';
  Object.assign(sourceBadge.style, {
    position: 'absolute',
    top: '8px',
    left: '8px',
    background: 'rgba(17,24,39,0.85)',
    color: '#f9fafb',
    padding: '4px 8px',
    borderRadius: '6px',
    fontSize: '12px',
    lineHeight: '1',
    pointerEvents: 'auto',
    cursor: 'pointer',
    zIndex: 10,
  });
  sourceBadge.tabIndex = 0;
  sourceBadge.setAttribute('role', 'button');
  sourceBadge.setAttribute('aria-label', 'Choose a book');
  sourceBadge.setAttribute('title', 'Choose a book');
  sourceBadge.style.display = 'none';

  const saveLayoutBtn = document.createElement('button');
  saveLayoutBtn.type = 'button';
  saveLayoutBtn.id = 'saveLayoutBtn';
  saveLayoutBtn.textContent = 'Save layout';
  Object.assign(saveLayoutBtn.style, {
    position: 'absolute',
    top: '40px',
    left: '8px',
    background: 'rgba(17,24,39,0.85)',
    color: '#f9fafb',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    border: 'none',
    cursor: 'pointer',
    lineHeight: '1',
    zIndex: 10,
    boxShadow: '0 2px 6px rgba(15,23,42,0.2)',
    display: 'none',
  });
  saveLayoutBtn.setAttribute('aria-label', 'Download current layout');
  saveLayoutBtn.setAttribute('title', 'Download current layout');
  saveLayoutBtn.addEventListener('mouseenter', () => { saveLayoutBtn.style.background = 'rgba(17,24,39,0.95)'; });
  saveLayoutBtn.addEventListener('mouseleave', () => { saveLayoutBtn.style.background = 'rgba(17,24,39,0.85)'; });
  saveLayoutBtn.addEventListener('click', () => { onSaveLayout?.(); });

  if (stage) stage.appendChild(sourceBadge);
  if (stage) stage.appendChild(saveLayoutBtn);

  let bookPickerEl = null;

  async function showBookPicker() {
    try {
      if (bookPickerEl) {
        bookPickerEl.style.display = 'flex';
        return;
      }
      let books = [];
      try {
        const res = await fetch('./data/books.json', { cache: 'no-store' });
        if (res.ok) books = await res.json();
      } catch {}

      if (!Array.isArray(books)) books = [];
      books = books
        .map((b) => (typeof b === 'string' ? b : (b?.name || '')))
        .filter(Boolean);

      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      });

      const modal = document.createElement('div');
      Object.assign(modal.style, {
        background: '#fff',
        color: '#111827',
        borderRadius: '10px',
        minWidth: '260px',
        maxWidth: '520px',
        width: '100%',
        boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        padding: '16px',
      });

      const header = document.createElement('div');
      header.textContent = 'Choose a book';
      Object.assign(header.style, { fontSize: '16px', fontWeight: '600', marginBottom: '10px' });
      modal.appendChild(header);

      const list = document.createElement('div');
      Object.assign(list.style, { display: 'grid', gap: '8px' });

      if (!books.length) {
        const empty = document.createElement('div');
        empty.textContent = 'No books found in ./data';
        Object.assign(empty.style, { color: '#6b7280', fontSize: '13px' });
        list.appendChild(empty);
      } else {
        const current = state.book || '';
        for (const name of books) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = name + (current && current === name ? ' •' : '');
          Object.assign(btn.style, {
            textAlign: 'left',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
            background: '#f9fafb',
            cursor: 'pointer',
            fontSize: '14px',
          });
          btn.addEventListener('mouseenter', () => { btn.style.background = '#f3f4f6'; });
          btn.addEventListener('mouseleave', () => { btn.style.background = '#f9fafb'; });
          btn.addEventListener('click', () => {
            const url = new URL(window.location.href);
            url.searchParams.set('book', name);
            url.searchParams.delete('folder');
            window.location.href = url.toString();
          });
          list.appendChild(btn);
        }
      }

      const footer = document.createElement('div');
      Object.assign(footer.style, { display: 'flex', justifyContent: 'flex-end', marginTop: '12px', gap: '8px' });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      Object.assign(cancel.style, {
        padding: '8px 12px',
        borderRadius: '8px',
        border: '1px solid #e5e7eb',
        background: '#fff',
        cursor: 'pointer',
        fontSize: '14px',
        color: '#374151',
      });
      cancel.addEventListener('click', () => { overlay.style.display = 'none'; });
      footer.appendChild(cancel);

      modal.appendChild(list);
      modal.appendChild(footer);
      overlay.appendChild(modal);

      const onKey = (ev) => { if (ev.key === 'Escape') overlay.style.display = 'none'; };
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; });
      window.addEventListener('keydown', onKey, { once: true });

      document.body.appendChild(overlay);
      bookPickerEl = overlay;
    } catch (err) {
      console.error('Failed to show book picker:', err);
    }
  }

  const onTitleClick = () => { showBookPicker(); };
  sourceBadge.addEventListener('click', onTitleClick);
  sourceBadge.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onTitleClick();
    }
  });

  function updateSourceBadge(text) {
    // When no book is selected (empty text), show a friendly prompt
    // so users can open the picker directly.
    const label = text && String(text).trim() ? String(text) : 'Select a book';
    // Move triangle to the beginning
    sourceBadge.textContent = `▼ ${label}`;
    sourceBadge.style.display = 'block';
  }

  function setDesignerMode(on) {
    saveLayoutBtn.style.display = on ? 'block' : 'none';
  }

  return { sourceBadge, saveLayoutBtn, showBookPicker, updateSourceBadge, setDesignerMode };
}
