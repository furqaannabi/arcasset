"use client";

import { useEffect, useState } from "react";

/**
 * The wall clock, as state.
 *
 * "Which period are we in" is a question about now, but reading `Date.now()`
 * during render is impure — React's own lint rule rejects it — and the value
 * would never update anyway, so a period would stay highlighted after it
 * ended. This ticks instead.
 *
 * Starts at 0 rather than at the current time: a timestamp baked into the
 * server render would hydrate against a different second and mismatch.
 * Anything comparing against it simply reads as "not yet" for one frame.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const read = () => setNow(Math.floor(Date.now() / 1000));
    read();
    const timer = setInterval(read, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
