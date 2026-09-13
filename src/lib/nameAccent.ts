import type { StatChipColor } from '@/components/dashboard/theme';

// Branch/location names aren't inherently categorical, so this just cycles a stable color per
// name (the same name always gets the same color) purely to help tell them apart at a glance —
// shared wherever a branch tag needs color-coding (employee rows, reconciliation cards, etc.).
const ACCENT_CYCLE: StatChipColor[] = ['blue', 'teal', 'lilac', 'green', 'gold', 'gray'];

// Pinned assignments for the branches that come up constantly — keeps their color predictable
// instead of whatever the hash happens to land on. Any other branch name falls back to the hash.
const NAME_OVERRIDES: Record<string, StatChipColor> = {
  'Branch 1': 'blue',
  'Branch 2': 'gold',
  'Main Branch': 'pink',
};

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function accentForName(name: string): StatChipColor {
  return NAME_OVERRIDES[name] ?? ACCENT_CYCLE[hashString(name) % ACCENT_CYCLE.length];
}
