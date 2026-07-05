// Modal machinery ported from the original (App.tsx:2312-2520): LIFO escape stack
// (only the topmost modal closes on Escape), focus trap keeping Tab inside
// [aria-modal], backdrop-press-to-close, blur-on-unmount (tablet soft-keyboard fix),
// and a promise-based confirm() that replaces window.confirm/prompt.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ---- Escape stack ----
const escapeStack: number[] = [];
let escapeSeq = 0;
const escapeHandlers = new Map<number, () => void>();

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || escapeStack.length === 0) return;
    const top = escapeStack[escapeStack.length - 1];
    const handler = escapeHandlers.get(top);
    if (handler) {
      event.preventDefault();
      handler();
    }
  });
}

export function useEscapeKey(onEscape: () => void, active = true): void {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const id = ++escapeSeq;
    escapeStack.push(id);
    escapeHandlers.set(id, () => handlerRef.current());
    return () => {
      const index = escapeStack.indexOf(id);
      if (index >= 0) escapeStack.splice(index, 1);
      escapeHandlers.delete(id);
    };
  }, [active]);
}

// ---- Body scroll lock ----
// Counted so stacked overlays (modal over modal, confirm over editor) release the
// lock only when the last one unmounts. Padding compensates the scrollbar width
// so the page doesn't shift sideways when it disappears.
let scrollLocks = 0;

function lockBodyScroll(): void {
  if (++scrollLocks > 1) return;
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.overflow = "hidden";
  if (scrollbar > 0) document.body.style.paddingInlineEnd = `${scrollbar}px`;
}

function unlockBodyScroll(): void {
  if (--scrollLocks > 0) return;
  document.body.style.overflow = "";
  document.body.style.paddingInlineEnd = "";
}

/** Freeze the page behind an overlay (modal, drawer) while `active`. */
export function useBodyScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [active]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  onClose,
  children,
  className = "",
  labelledBy,
  wide = false,
}: {
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
  wide?: boolean;
}) {
  useEscapeKey(onClose);
  useBodyScrollLock();
  const panelRef = useRef<HTMLDivElement>(null);
  const pressStartedOnBackdrop = useRef(false);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    // Autofocus the first sensible control.
    const first = panel.querySelector<HTMLElement>(
      "input, select, textarea, button:not(.modal-close)");
    first?.focus();
    return () => {
      // iOS/tablet soft-keyboard fix: blur whatever was focused inside.
      const active = document.activeElement;
      if (active instanceof HTMLElement && panel.contains(active)) active.blur();
    };
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    // Re-query per keypress: modal content changes (wizard steps etc.).
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onMouseUp={(event) => {
        // Close only when the press STARTED on the backdrop (drag-out doesn't close).
        if (pressStartedOnBackdrop.current && event.target === event.currentTarget) onClose();
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        className={`modal-panel ${wide ? "modal-wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---- Promise-based confirm ----
export interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonPlaceholder?: string;
}
type ConfirmResolution = { ok: boolean; reason?: string };

let pushConfirm: ((req: ConfirmRequest, resolve: (r: ConfirmResolution) => void) => void) | null =
  null;

export function askConfirm(req: ConfirmRequest): Promise<ConfirmResolution> {
  return new Promise((resolve) => {
    if (pushConfirm) pushConfirm(req, resolve);
    else resolve({ ok: false });
  });
}

export function ConfirmHost() {
  const [active, setActive] = useState<{
    req: ConfirmRequest;
    resolve: (r: ConfirmResolution) => void;
  } | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    pushConfirm = (req, resolve) => {
      setReason("");
      setActive({ req, resolve });
    };
    return () => {
      pushConfirm = null;
    };
  }, []);

  if (!active) return null;
  const { req, resolve } = active;
  const finish = (ok: boolean) => {
    setActive(null);
    resolve({ ok, reason: reason.trim() || undefined });
  };
  const confirmDisabled = Boolean(req.requireReason && !reason.trim());

  return (
    <Modal onClose={() => finish(false)} labelledBy="confirm-title">
      <h3 id="confirm-title" className="modal-title">{req.title}</h3>
      {req.message ? <p className="confirm-message">{req.message}</p> : null}
      {req.requireReason ? (
        <input
          className="input"
          value={reason}
          maxLength={200}
          placeholder={req.reasonPlaceholder ?? "Reason"}
          onChange={(event) => setReason(event.target.value)}
        />
      ) : null}
      <div className="modal-actions">
        <button className="btn" onClick={() => finish(false)}>Cancel</button>
        <button
          className={req.danger ? "btn btn-danger" : "btn btn-primary"}
          disabled={confirmDisabled}
          onClick={() => finish(true)}
        >
          {req.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </Modal>
  );
}
