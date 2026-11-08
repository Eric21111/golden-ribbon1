import type { Edge } from 'react-native-safe-area-context';

/**
 * Which safe-area edges a screen pads. Android is always edge-to-edge (Expo SDK 57: edge-to-edge can no longer be turned
 * off), so every screen is drawn under the status bar, the camera cut-out and the navigation / gesture bar and must pad
 * them itself.
 *
 * - TOP belongs to the screen. A caller may leave it out by passing an `edges` list without 'top'.
 * - LEFT and RIGHT always belong to the screen (zero in portrait; a camera cut-out or a side navigation bar in landscape).
 * - BOTTOM has exactly one owner at a time: the floating tab bar when it is showing (RoleNavigation pads the bottom
 *   inset itself), otherwise the screen. A caller's `edges` can never switch it on or off, so a screen without a tab bar
 *   cannot end up under the navigation bar, and a screen with one never pads the same inset twice.
 */
export function resolveScreenEdges(edges: readonly Edge[] | undefined, hasBottomNavigation: boolean): Edge[] {
  const resolved: Edge[] = [];
  if (edges === undefined || edges.includes('top')) resolved.push('top');
  resolved.push('left', 'right');
  if (!hasBottomNavigation) resolved.push('bottom');
  return resolved;
}
