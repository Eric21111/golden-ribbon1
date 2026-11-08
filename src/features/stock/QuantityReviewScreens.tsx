import Ionicons from '@react-native-vector-icons/ionicons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge, type ManagerBadgeTone } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import { formatLiveStock } from '@/lib/format';

/**
 * The two screens that follow QuantityListScreen: a review (what is about to be sent, the notes, Back to edit | Confirm) and the
 * "done" page. Same look as the Opening stock and Send stock reviews. Nothing is sent before Confirm.
 */
export type ReviewLine = {
  id: string;
  name: string;
  sku: string;
  category: string | null | undefined;
  quantity: number;
  /** One small gray line under the SKU, e.g. "System 25". */
  caption?: string;
  /** A small coloured tag under it, e.g. "20 short". */
  flag?: { label: string; tone: ManagerBadgeTone } | null;
};

function LineList({ lines, quantityCaption }: { lines: ReviewLine[]; quantityCaption: string }) {
  return (
    <View style={styles.listCard}>
      {lines.map((line, index) => (
        <View key={line.id} style={[styles.row, index < lines.length - 1 && styles.rowDivider]}>
          <CategoryIcon category={line.category} size={36} decorative />
          <View style={styles.rowInfo}>
            <Text style={styles.name} numberOfLines={2}>
              {line.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {line.sku}
              {line.caption ? ` · ${line.caption}` : ''}
            </Text>
            {line.flag ? <ManagerBadge label={line.flag.label} tone={line.flag.tone} /> : null}
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatLiveStock(line.quantity)}</Text>
            <Text style={styles.statLabel}>{quantityCaption}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function QuantityReviewScreen({
  title,
  subtitle,
  lines,
  quantityCaption,
  notes,
  onNotesChange,
  notesMaxLength,
  notesLocked = false,
  formError,
  lockedNote,
  canEdit = true,
  onBack,
  confirmLabel = 'Confirm',
  confirming,
  onConfirm,
}: {
  title: string;
  subtitle: string;
  lines: ReviewLine[];
  /** Under each number, e.g. "returning" / "buying". */
  quantityCaption: string;
  notes: string;
  onNotesChange: (value: string) => void;
  notesMaxLength: number;
  notesLocked?: boolean;
  formError?: string | null;
  /** A request that was already saved and is waiting to be retried: read-only, only the retry button. */
  lockedNote?: string | null;
  canEdit?: boolean;
  onBack: () => void;
  confirmLabel?: string;
  confirming: boolean;
  onConfirm: () => void;
}) {
  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
      <View style={styles.layout}>
        <ManagerScreenHeader title={title} subtitle={subtitle} showBack />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <LineList lines={lines} quantityCaption={quantityCaption} />
          <FormField
            label="Notes (optional)"
            value={notes}
            onChangeText={onNotesChange}
            multiline
            maxLength={notesMaxLength}
            editable={!notesLocked}
            accentColor={managerColors.royalBlue}
            labelStyle={styles.fieldLabel}
            style={styles.fieldInput}
          />
          {formError ? <Text style={styles.error}>{formError}</Text> : null}
          {lockedNote ? <Text style={styles.lockedNote}>{lockedNote}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <View style={styles.footerRow}>
            {canEdit ? (
              <View style={styles.footerButton}>
                <ManagerActionButton label="Back to edit" variant="secondary" disabled={confirming} onPress={onBack} />
              </View>
            ) : null}
            <View style={styles.footerButton}>
              <ManagerActionButton
                label={confirmLabel}
                icon="checkmark-circle-outline"
                loading={confirming}
                disabled={lines.length === 0}
                onPress={onConfirm}
              />
            </View>
          </View>
        </View>
      </View>
    </Screen>
  );
}

export function QuantityDoneScreen({
  title,
  subtitle,
  heading,
  lines,
  quantityCaption,
  doneLabel,
  onDone,
}: {
  title: string;
  subtitle: string;
  /** One short line next to the check mark. */
  heading: string;
  lines: ReviewLine[];
  quantityCaption: string;
  doneLabel: string;
  onDone: () => void;
}) {
  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
      <View style={styles.layout}>
        <ManagerScreenHeader title={title} subtitle={subtitle} showBack />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name="checkmark" size={28} color="#166534" />
            </View>
            <Text style={styles.heroText}>{heading}</Text>
          </View>
          {lines.length > 0 ? <LineList lines={lines} quantityCaption={quantityCaption} /> : null}
        </ScrollView>
        <View style={styles.footer}>
          <ManagerActionButton label={doneLabel} onPress={onDone} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { padding: 20, gap: 14, paddingBottom: 20 },
  listCard: {
    backgroundColor: '#FFFFFF',
    borderColor: managerColors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: managerColors.cardBorder },
  rowInfo: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15.5 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  stat: { alignItems: 'center', gap: 2, minWidth: 56 },
  statValue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 16 },
  statLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  lockedNote: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  footerRow: { flexDirection: 'row', gap: 10 },
  footerButton: { flex: 1 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 22 },
});
