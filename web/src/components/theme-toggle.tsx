"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Explicit light/dark, persisted. Until someone chooses, the page follows the
 * OS — so the initial state is read off the resolved theme rather than assumed,
 * or the switch would show "light" to someone sitting on a dark system.
 *
 * The stamp goes on <html> as data-theme; globals.css defines the palette for
 * all three states (system, explicit light, explicit dark).
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = readStored();
    if (stored) {
      setTheme(stored);
      return;
    }
    setTheme(
      window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    );
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private windows and blocked site data throw here. The toggle still
      // works for this page view; it just will not be remembered.
    }
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Dark theme"
      // Rendered inert until the effect resolves the real theme, so the knob
      // never animates from a guessed position on first paint.
      disabled={theme === null}
      onClick={() => apply(isDark ? "light" : "dark")}
      className={`relative h-4 w-7 shrink-0 rounded-full border transition-colors ${
        isDark ? "border-accent bg-accent" : "border-line-strong bg-raised"
      } ${theme === null ? "opacity-40" : ""}`}
    >
      <span
        className={`absolute top-[2px] h-2.5 w-2.5 rounded-full transition-[left] ${
          isDark ? "left-[13px] bg-accent-ink" : "left-[2px] bg-muted"
        }`}
      />
    </button>
  );
}

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem("theme");
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}
