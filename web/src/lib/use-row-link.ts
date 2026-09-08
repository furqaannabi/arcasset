"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

/**
 * Makes a whole table row open the thing it describes.
 *
 * The row is not turned into a link. The id cell keeps its real anchor, which
 * is what carries keyboard focus, middle-click and open-in-new-tab — replacing
 * it with a click handler would take all three away. This only adds the rest of
 * the row's surface, which is otherwise dead space that looks clickable.
 *
 * Three things are deliberately not navigations: a click that landed on a link
 * (it has its own destination), a modified click (the person is asking for a
 * new tab or window, which a programmatic push cannot give them), and a click
 * that ends a text selection (they were reading, not navigating).
 */
export function useRowLink() {
  const router = useRouter();

  return (href: string) =>
    (event: MouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest("a,button,input,select,textarea")) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (window.getSelection()?.toString()) return;
      router.push(href);
    };
}
