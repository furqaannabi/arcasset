"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const EVENT = "arcasset:themechange";

/**
 * Explicit light/dark, persisted, defaulting to the OS until someone chooses.
 *
 * The theme is genuinely external mutable state — it lives in localStorage, in
 * a media query, and on the <html> element, any of which can change from
 * outside React — so it is read with useSyncExternalStore rather than mirrored
 * into component state from an effect.
 */
function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  // `storage` covers the same site in another tab; the custom event covers
  // this one, which `storage` deliberately does not fire for.
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function getSnapshot(): Theme {
  const stored = read();
  if (stored) return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * The server cannot know the viewer's theme. Reporting "light" here would make
 * the switch render in the wrong position for a dark-mode viewer for one
 * frame; the pre-paint script in layout.tsx has already stamped <html>, so
 * only this control is briefly out of step, and it corrects on hydration.
 */
function getServerSnapshot(): Theme {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isDark = theme === "dark";

  function toggle() {
    const next: Theme = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private windows and blocked site data throw. The choice still applies
      // to this page view; it just will not be remembered.
    }
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Dark theme"
      onClick={toggle}
      className={`relative h-4 w-7 shrink-0 rounded-full border transition-colors ${
        isDark ? "border-accent bg-accent" : "border-line-strong bg-raised"
      }`}
    >
      <span
        className={`absolute top-[2px] h-2.5 w-2.5 rounded-full transition-[left] ${
          isDark ? "left-[13px] bg-accent-ink" : "left-[2px] bg-muted"
        }`}
      />
    </button>
  );
}

function read(): Theme | null {
  try {
    const v = localStorage.getItem("theme");
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}
