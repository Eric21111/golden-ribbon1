/**
 * A softer, "candy pastel" set kept separate from the brand palette (statChipColors/
 * tileGradients) — used to color-code ranked rows (branches, products) across every
 * owner report screen so rank #1..#N reads as visually distinct at a glance, consistently
 * everywhere it appears.
 */
export const ACCENT_PALETTE = [
  { icon: '#2B8FD1', gradient: ['#CDEBFB', '#F3FBFF'] as const }, // sky blue
  { icon: '#1FA37A', gradient: ['#C9F5E3', '#F2FFFA'] as const }, // mint
  { icon: '#E0824A', gradient: ['#FCE0C7', '#FFF8F1'] as const }, // peach
  { icon: '#6B7FE0', gradient: ['#DADFFB', '#F5F6FF'] as const }, // periwinkle
  { icon: '#E0637E', gradient: ['#FBD6DF', '#FFF4F7'] as const }, // rose
] as const;

export function accentForRank(rank: number) {
  return ACCENT_PALETTE[(rank - 1) % ACCENT_PALETTE.length];
}
