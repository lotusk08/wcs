import cls from 'classnames';
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import Icon from './icon/ui.jsx';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let locks = 0;

const lockScroll = () => {
  locks += 1;
  if (locks === 1) {
    document.documentElement.classList.add('sheet-locked');
  }

  return () => {
    locks -= 1;
    if (locks === 0) {
      document.documentElement.classList.remove('sheet-locked');
    }
  };
};

export default function BottomSheet({ open, onClose, title, subtitle, header, footer, children, className }) {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  const dragRef = useRef(null);
  const titleId = useId();

  closeRef.current = onClose;

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));

      return () => cancelAnimationFrame(frame);
    }

    setShown(false);
    setDrag(0);
    const timer = setTimeout(() => setMounted(false), reducedMotion() ? 0 : 220);

    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open || !mounted) return;

    const previous = document.activeElement;
    const unlock = lockScroll();
    const panel = panelRef.current;
    const first = panel?.querySelector('[data-autofocus]');

    (first ?? panel)?.focus({ preventScroll: true });

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current?.();

        return;
      }

      if (event.key !== 'Tab' || !panel) return;

      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);

      if (!items.length) {
        event.preventDefault();
        panel.focus();

        return;
      }

      const head = items[0];
      const tail = items.at(-1);

      if (event.shiftKey && (document.activeElement === head || document.activeElement === panel)) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      unlock();
      if (previous && previous.isConnected && typeof previous.focus === 'function') {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open, mounted]);

  if (!mounted) return null;

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse') return;
    dragRef.current = { y: event.clientY, id: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!dragRef.current || dragRef.current.id !== event.pointerId) return;
    setDrag(Math.max(0, event.clientY - dragRef.current.y));
  };

  const onPointerUp = (event) => {
    if (!dragRef.current || dragRef.current.id !== event.pointerId) return;
    const distance = event.clientY - dragRef.current.y;

    dragRef.current = null;
    if (distance > 80) {
      closeRef.current?.();
    } else {
      setDrag(0);
    }
  };

  return createPortal(
    <div className={cls('sheet-root', { 'is-open': shown })}>
      <div className="sheet-backdrop" aria-hidden="true" onClick={() => closeRef.current?.()} />
      <div
        ref={panelRef}
        className={cls('sheet', className, { dragging: drag > 0 })}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
      >
        <div
          className="sheet-grab"
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span />
        </div>
        {title || header ? (
          <div className="sheet-head">
            {header ?? (
              <div className="sheet-heading">
                <h2 className="sheet-title" id={titleId}>
                  {title}
                </h2>
                {subtitle ? <p className="sheet-subtitle">{subtitle}</p> : null}
              </div>
            )}
            <button type="button" className="icon-btn sheet-close" aria-label={t('close')} onClick={() => closeRef.current?.()}>
              <Icon name="close" />
            </button>
          </div>
        ) : null}
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
