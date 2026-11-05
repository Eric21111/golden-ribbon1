/**
 * Where a scrolling sheet must scroll to bring one element into view, or null when it is already fully visible (so nothing
 * moves). Free of React so it can be unit-tested. All positions are window coordinates, as measureInWindow reports them.
 *
 * The content moves with the scroll, so the top edge of the visible area is the content's top plus the current offset.
 * The element is put `margin` below that edge, so what sits just above it (its card title, its label) stays in view.
 */
export function revealScrollOffset(input: {
  /** Window y of the top of the scrolled content (it moves up as the sheet scrolls). */
  contentY: number;
  /** How far the sheet is scrolled now. */
  offset: number;
  /** Height of the visible area. Already shorter while the keyboard is up. */
  viewportHeight: number;
  /** Window y and height of the element to show. */
  elementY: number;
  elementHeight: number;
  margin?: number;
}): number | null {
  const margin = input.margin ?? 16;
  const viewportTop = input.contentY + input.offset;
  const viewportBottom = viewportTop + input.viewportHeight;
  const fullyVisible = input.elementY >= viewportTop && input.elementY + input.elementHeight <= viewportBottom;
  if (fullyVisible) return null;
  return Math.max(0, input.offset + (input.elementY - viewportTop) - margin);
}
