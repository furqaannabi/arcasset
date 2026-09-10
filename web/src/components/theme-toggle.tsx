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
      title={isDark ? "Switch to light" : "Switch to dark"}
      onClick={toggle}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
        isDark ? "border-accent bg-accent" : "border-line-strong bg-raised"
      }`}
    >
      {/*
       * The knob carries the icon rather than the track carrying two. At 20px
       * a pair of glyphs with a puck sliding between them is mush; one glyph
       * that changes is legible, and it says what the control *is* now rather
       * than what it could become.
       */}
      <span
        className={`absolute top-[2px] grid h-4 w-4 place-items-center rounded-full transition-[left,background-color,color] duration-200 ${
          isDark ? "left-[18px] bg-accent-ink text-accent" : "left-[2px] bg-panel text-muted"
        }`}
      >
        {isDark ? <MoonGlyph /> : <SunGlyph />}
      </span>
    </button>
  );
}

/**
 * Inline, not an icon package. Two glyphs do not justify a dependency, and
 * `currentColor` lets the knob's text colour drive them so the theme tokens
 * stay the only place a colour is decided.
 */
function SunGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11L3.05 3.05" />
      </g>
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" aria-hidden="true">
      {/* One filled crescent, not a circle with a hole: a cut-out would show
          the knob through it at this size and read as a smudge. */}
      <path
        d="M13.2 10.3A5.8 5.8 0 0 1 5.7 2.8a5.8 5.8 0 1 0 7.5 7.5Z"
        fill="currentColor"
      />
    </svg>
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
