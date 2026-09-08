import { StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

export const returnStyles = StyleSheet.create({
  detailsBody: { gap: spacing.md },
  detailsHeaderCopy: { flex: 1, minWidth: 0 },
  card: {
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  discrepancyCard: {
    borderColor: '#FCA5A5',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  text: {
    color: colors.text,
    fontSize: 15,
  },
  meta: {
    color: colors.muted,
    fontSize: 13,
  },
  auditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  auditLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  auditValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
  },
  warning: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '800',
  },
  complete: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '800',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  empty: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});
