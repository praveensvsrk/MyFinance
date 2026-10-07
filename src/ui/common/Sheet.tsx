import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
const DRAG_CLOSE_PX = 80;

/**
 * A modal bottom sheet: dialog semantics, Escape and scrim to close, Tab kept inside, page scroll
 * locked, drag the handle down to dismiss, and focus returned to whatever opened it.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  testId,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const heading = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheet.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    return () => {
      document.body.style.overflow = previous;
      opener?.focus?.();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || sheet.current === null) return;
    const items = Array.from(sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const onDown = (event: PointerEvent) => {
    drag.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onMove = (event: PointerEvent) => {
    if (drag.current !== null && event.clientY - drag.current > DRAG_CLOSE_PX) {
      drag.current = null;
      onClose();
    }
  };
  const onUp = () => {
    drag.current = null;
  };

  // Portalled to <body>: opened from the sticky header (z-index 2) the sheet would otherwise sit in
  // that stacking context and render beneath the tab bar, hiding the bottom of its content.
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheet}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading}
        data-testid={testId}
        onKeyDown={onKeyDown}
      >
        <div
          className="handle"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-hidden="true"
        />
        <div className="row-between">
          <h2 id={heading}>{title}</h2>
          <button type="button" className="ib sm" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        {subtitle !== undefined && <p className="sub">{subtitle}</p>}
        {children}
      </div>
    </>,
    document.body,
  );
}
