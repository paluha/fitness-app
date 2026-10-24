'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Модальное окно в стиле редизайна (.tx-dialog). Рендерится в body, чтобы
 * не зависеть от overflow/transform родителей. Закрывается по Esc, по
 * крестику и по клику на подложку.
 */
export function TxDialog({ title, onClose, children, wide }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Шире обычного — для архива и длинных списков. */
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="tx-dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tx-dialog" role="dialog" aria-modal="true" style={wide ? { width: 'min(560px, 100%)' } : undefined}>
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
