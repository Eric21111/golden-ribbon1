import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';

import { PRICE_PATTERN } from './productSchema';
import { MIN_TOUCH_TARGET } from './touchTargets';
import { isPriceMissing } from './wizardGuards';

export type PricingMode = 'same' | 'different';
/** How complete one branch's prices are: nothing entered, some variants priced, or all priced. */
export type BranchPriceStatus = 'none' | 'partial' | 'full';
export type BranchPriceDraft = { base: string; variantPrices: Record<string, string> };

const BORDER = '#D9DFEA';
const BLUE_TINT = '#EAF0FB';
const DANGER = '#B91C1C';
const OK = '#166534';
const WARN = '#92400E';

function isInvalidPrice(text: string): boolean {
  const trimmed = text.trim();
  return trimmed !== '' && !PRICE_PATTERN.test(trimmed);
}

/** ₱ prefixed price input with inline invalid-format feedback. */
function PriceInput({
  value,
  onChangeText,
  accessibilityLabel,
  missing = false,
}: {
  value: string;
  onChangeText: (text: string) => void;
  accessibilityLabel: string;
  /** Flag an empty field next to filled ones once an error is showing (see isPriceMissing). */
  missing?: boolean;
}) {
  const invalid = isInvalidPrice(value);
  return (
    <View style={styles.priceCol}>
      <View style={[styles.priceBox, (invalid || missing) && styles.priceBoxInvalid]}>
        <Text style={styles.currency}>₱</Text>
        <TextInput
          accessibilityLabel={accessibilityLabel}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={managerColors.subtext}
          value={value}
          onChangeText={onChangeText}
          style={styles.priceInput}
        />
      </View>
      {invalid || missing ? <Text style={styles.invalidText}>{invalid ? 'Invalid price' : 'Enter a price'}</Text> : null}
    </View>
  );
}

/** One row per variant: name (plus what it uses) on the left, price on the right. */
function PriceList({
  variants,
  summaries,
  prices,
  onChange,
  highlightMissing,
}: {
  variants: Array<{ key: string; name: string }>;
  summaries: Record<string, string>;
  prices: Record<string, string>;
  onChange: (key: string, text: string) => void;
  /** True once an error is showing, so empty prices next to filled ones are flagged. */
  highlightMissing: boolean;
}) {
  return (
    <View style={styles.list}>
      <View style={styles.listHeader}>
        <Text style={styles.listHeaderText}>PRICE (PHP)</Text>
      </View>
      {variants.map((variant, index) => (
        <View key={variant.key} style={[styles.row, index > 0 && styles.rowDivider]}>
          <View style={styles.rowInfo}>
            <Text style={styles.rowName} numberOfLines={1}>
              {variant.name || 'Unnamed'}
            </Text>
            {summaries[variant.key] ? (
              <Text style={styles.rowSummary} numberOfLines={2}>
                {summaries[variant.key]}
              </Text>
            ) : null}
          </View>
          <PriceInput
            value={prices[variant.key] ?? ''}
            onChangeText={(text) => onChange(variant.key, text)}
            accessibilityLabel={`${variant.name || 'Variant'} price (PHP)`}
            missing={isPriceMissing({
              showErrors: highlightMissing,
              prices,
              keys: variants.map((entry) => entry.key),
              key: variant.key,
            })}
          />
        </View>
      ))}
    </View>
  );
}

/**
 * Step 3 of the product wizards: branch pricing. Presentational only — all price state, validation and
 * saving stay in the wizard. This component only changes how the same data is shown and edited.
 */
export function BranchPricingStep({
  mode,
  onModeChange,
  variants,
  stockSummaries,
  previewNotice,
  otherModePricesKept,
  branches,
  uniformBase,
  onUniformBaseChange,
  uniformPrices,
  onUniformPriceChange,
  selectedBranchId,
  onSelectBranch,
  branchStatus,
  draft,
  onDraftBaseChange,
  onDraftVariantPriceChange,
  error,
}: {
  mode: PricingMode;
  onModeChange: (mode: PricingMode) => void;
  variants: Array<{ key: string; name: string }>;
  /** Optional one-line "what it uses" per variant key, shown under the variant name. */
  stockSummaries: Record<string, string>;
  /** Reminder that preview-only settings (category, stock used, drink choice) are not saved. Null/absent: none used. */
  previewNotice?: string | null;
  /** True when the pricing mode that is NOT selected still holds entered prices. */
  otherModePricesKept?: boolean;
  branches: Array<{ id: string; name: string }>;
  uniformBase: string;
  onUniformBaseChange: (text: string) => void;
  uniformPrices: Record<string, string>;
  onUniformPriceChange: (key: string, text: string) => void;
  selectedBranchId: string;
  onSelectBranch: (branchId: string) => void;
  branchStatus: Record<string, BranchPriceStatus>;
  draft: BranchPriceDraft;
  onDraftBaseChange: (text: string) => void;
  onDraftVariantPriceChange: (key: string, text: string) => void;
  error?: string;
}) {
  const hasVariants = variants.length > 0;
  const fullCount = branches.filter((branch) => branchStatus[branch.id] === 'full').length;
  const partialCount = branches.filter((branch) => branchStatus[branch.id] === 'partial').length;
  const nothingPriced =
    mode === 'same'
      ? hasVariants
        ? !variants.some((variant) => (uniformPrices[variant.key] ?? '').trim() !== '')
        : uniformBase.trim() === ''
      : branches.every((branch) => (branchStatus[branch.id] ?? 'none') === 'none');

  return (
    <View style={styles.wrap}>
      {previewNotice ? (
        <View style={styles.previewNotice}>
          <Ionicons name="information-circle" size={16} color={WARN} />
          <Text style={styles.previewNoticeText}>{previewNotice}</Text>
        </View>
      ) : null}

      <View style={styles.toggle}>
        {(['same', 'different'] as const).map((option) => {
          const active = mode === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => onModeChange(option)}
              style={[styles.toggleButton, active && styles.toggleButtonActive]}
            >
              <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
                {option === 'same' ? 'Same for All' : 'Different per Branch'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {otherModePricesKept ? (
        <Text style={styles.hint}>
          {mode === 'same'
            ? 'Your per-branch prices are kept if you switch back.'
            : 'Your same-for-all prices are kept if you switch back.'}
        </Text>
      ) : null}

      {branches.length === 0 ? (
        <Text style={styles.hint}>No selling branches available yet.</Text>
      ) : mode === 'same' ? (
        <>
          {hasVariants ? (
            <PriceList
              variants={variants}
              summaries={stockSummaries}
              prices={uniformPrices}
              onChange={onUniformPriceChange}
              highlightMissing={Boolean(error)}
            />
          ) : (
            <View style={styles.single}>
              <Text style={styles.singleLabel}>Selling price (PHP)</Text>
              <PriceInput
                value={uniformBase}
                onChangeText={onUniformBaseChange}
                accessibilityLabel="Selling price (PHP)"
              />
            </View>
          )}
          <Text style={styles.hint}>
            Applies to all {branches.length} {branches.length === 1 ? 'branch' : 'branches'}.
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.overview}>
            {fullCount} of {branches.length} {branches.length === 1 ? 'branch' : 'branches'} priced
            {partialCount > 0 ? ` · ${partialCount} incomplete` : ''}
          </Text>
          <View style={styles.branchChips}>
            {branches.map((branch) => {
              const status = branchStatus[branch.id] ?? 'none';
              const selected = branch.id === selectedBranchId;
              return (
                <Pressable
                  key={branch.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${branch.name}, ${
                    status === 'full' ? 'priced' : status === 'partial' ? 'incomplete' : 'not priced'
                  }`}
                  onPress={() => onSelectBranch(branch.id)}
                  style={({ pressed }) => [
                    styles.branchChip,
                    status === 'full' && styles.chipFull,
                    status === 'partial' && styles.chipPartial,
                    selected && styles.branchChipSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.branchName,
                      status === 'full' && styles.nameFull,
                      status === 'partial' && styles.namePartial,
                    ]}
                    numberOfLines={1}
                  >
                    {branch.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {hasVariants ? (
            <PriceList
              variants={variants}
              summaries={stockSummaries}
              prices={draft.variantPrices}
              onChange={onDraftVariantPriceChange}
              highlightMissing={Boolean(error)}
            />
          ) : (
            <View style={styles.single}>
              <Text style={styles.singleLabel}>Branch selling price (PHP)</Text>
              <PriceInput
                value={draft.base}
                onChangeText={onDraftBaseChange}
                accessibilityLabel="Branch selling price (PHP)"
              />
            </View>
          )}

        </>
      )}

      {branches.length > 0 && nothingPriced ? (
        <View style={styles.notice}>
          <Ionicons name="alert-circle" size={16} color={WARN} />
          <Text style={styles.noticeText}>No prices set yet. Items will be saved at ₱0.00.</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  toggle: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: managerColors.cardSurface,
    borderRadius: 12,
    padding: 4,
  },
  toggleButton: { flex: 1, minHeight: MIN_TOUCH_TARGET, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  toggleButtonActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#B9C8EA',
  },
  toggleText: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  toggleTextActive: { color: managerColors.royalBlue },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13 },
  overview: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  branchChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  branchChip: {
    flexGrow: 1,
    flexBasis: 96,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  // Status colours (pastel). The selected branch gets a blue outline so it never clashes with them.
  chipFull: { backgroundColor: '#DCFCE7', borderColor: '#A7E3BC' },
  chipPartial: { backgroundColor: '#FEF3C7', borderColor: '#F5D98A' },
  branchChipSelected: { borderColor: managerColors.royalBlue },
  branchName: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  nameFull: { color: OK },
  namePartial: { color: WARN },

  list: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  listHeader: { alignItems: 'flex-end', paddingBottom: 4 },
  listHeaderText: { color: managerColors.subtext, fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  rowInfo: { flex: 1, minWidth: 0, gap: 1 },
  rowName: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  rowSummary: { color: WARN, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 16 },
  single: { gap: 6 },
  singleLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  priceCol: { width: 116, gap: 2 },
  priceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
  },
  priceBoxInvalid: { borderColor: DANGER },
  currency: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  priceInput: {
    flex: 1,
    minWidth: 0,
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    padding: 0,
  },
  invalidText: { color: DANGER, fontFamily: 'Inter_500Medium', fontSize: 11 },
  previewNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  previewNoticeText: { flex: 1, color: WARN, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  noticeText: { flex: 1, color: WARN, fontFamily: 'Inter_500Medium', fontSize: 13 },
  error: { color: DANGER, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.7 },
});
