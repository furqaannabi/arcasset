"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

/**
 * A modal, for showing something without leaving the page.
 *
 * Its own file rather than ui.tsx: that module is imported by server
 * components, and a hook in it would make every button and panel in the app a
 * client component to no purpose.
 *
 * Deliberately plain — a backdrop, a panel, and the three behaviours a person
 * expects from anything covering the page: Escape closes it, clicking the
 * backdrop closes it, and the page behind does not scroll while it is open.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Restored rather than cleared: the page may have had its own value, and a
    // modal has no business deciding what the document's overflow is after it
    // has gone.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        // Stops a click inside reaching the backdrop handler, which would
        // otherwise close the modal whenever someone selected text in it.
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-card border border-line bg-panel shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink">{title}</p>
            {subtitle ? (
              <p className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{subtitle}</p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-card border border-line px-2.5 py-1 font-mono text-[11px] text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Esc
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
