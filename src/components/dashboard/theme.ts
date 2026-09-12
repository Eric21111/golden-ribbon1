export const managerColors = {
  navy: '#0A1224',
  royalBlue: '#1E3A8A',
  royalBlueLight: '#2E4FB8',
  gold: '#D4AF37',
  goldMuted: '#B7902B',
  teal: '#0F766E',
  lilac: '#6D28D9',
  green: '#15803D',
  ink: '#101828',
  subtext: '#667085',
  cardBorder: '#EEF1F6',
  cardSurface: '#F7F8FB',
} as const;

export const managerGradients = {
  header: [managerColors.navy, managerColors.royalBlue, managerColors.royalBlueLight] as const,
  hero: [managerColors.navy, managerColors.royalBlue] as const,
  gold: [managerColors.gold, managerColors.goldMuted] as const,
} as const;

export const statChipColors = {
  blue: { chip: '#DCE8FC', icon: managerColors.royalBlue },
  gold: { chip: '#FBE9C2', icon: managerColors.goldMuted },
  teal: { chip: '#CFF3E8', icon: managerColors.teal },
  lilac: { chip: '#E4D9FB', icon: managerColors.lilac },
  green: { chip: '#D7F5DE', icon: managerColors.green },
  red: { chip: '#FBDBD8', icon: '#B91C1C' },
  gray: { chip: '#EEF1F6', icon: managerColors.subtext },
} as const;

export type StatChipColor = keyof typeof statChipColors;

/** Soft two-tone pastel gradients (richer tint → near-white wash), same hue family as statChipColors. */
export const tileGradients = {
  blue: ['#D3E3FC', '#F4F8FF'] as const,
  gold: ['#FCEAC0', '#FFF9EF'] as const,
  teal: ['#C9F2E6', '#F2FDFB'] as const,
  lilac: ['#E2D3FB', '#F8F4FF'] as const,
  green: ['#CBF3DC', '#F2FDF6'] as const,
  red: ['#F9D6D2', '#FFF5F4'] as const,
  gray: ['#E4E7EE', '#F8F9FB'] as const,
} as const;
