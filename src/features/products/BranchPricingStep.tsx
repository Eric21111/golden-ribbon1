import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useSheetReveal } from '@/components/BottomSheet';
import { managerColors } from '@/components/dashboard/theme';
import { colors } from '@/constants/theme';

import { firstPriceToFix, priceProblem } from './pricingReveal';
import { MIN_TOUCH_TARGET } from './touchTargets';
import { isPriceMissing } from './wizardGuards';

export type PricingMode = 'same' | 'different';
export type BranchPriceDraft = { base: string; variantPrices: Record<string, string> };

const BORDER = '#D9DFEA';
const BLUE_TINT = '#EAF0FB';
const DANGER = '#B91C1C';
const OK = '#166534';
const WARN = '#92400E';

/** ₱ prefixed price input with inline invalid-format feedback. */
function PriceInput({
  value,
  onChangeText,
  accessibilityLabel,
  missing = false,
  inputRef,
}: {
  value: string;
  onChangeText: (text: string) => void;
  accessibilityLabel: string;
  /** Flag an empty field next to filled ones once an error is showing (see isPriceMissing). */
  missing?: boolean;
  inputRef?: (node: TextInput | null) => void;
}) {
  const problem = priceProblem(value);
  const invalid = problem !== null;
  return (
    <View style={styles.priceCol}>
      <View style={[styles.priceBox, (invalid || missing) && styles.priceBoxInvalid]}>
        <Text style={styles.currency}>₱</Text>
        <TextInput
          ref={inputRef}
          accessibilityLabel={accessibilityLabel}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={managerColors.subtext}
          value={value}
          onChangeText={onChangeText}
          style={styles.priceInput}
        />
      </View>
      {invalid || missing ? <Text style={styles.invalidText}>{problem ?? 'Enter a price'}</Text> : null}
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
  required = false,
  embedded = false,
  offKeys = [],
  fieldRef,
}: {
  variants: Array<{ key: string; name: string }>;
  summaries: Record<string, string>;
  prices: Record<string, string>;
  onChange: (key: string, text: string) => void;
  /** True once an error is showing, so empty prices next to filled ones are flagged. */
  highlightMissing: boolean;
  /** This list has to be priced for the save to go through: every empty field is flagged. */
  required?: boolean;
  /** Inside a branch card: no frame and no header of its own. */
  embedded?: boolean;
  /** Options that are switched off at this branch (saving keeps them off). */
  offKeys?: string[];
  /** Hands each price field to the step so it can be scrolled to and focused. */
  fieldRef?: (key: string) => (node: TextInput | null) => void;
}) {
  return (
    <View style={embedded ? styles.listEmbedded : styles.list}>
      {embedded ? null : (
        <View style={styles.listHeader}>
          <Text style={styles.listHeaderText}>PRICE (PHP)</Text>
        </View>
      )}
      {variants.map((variant, index) => (
        <View key={variant.key} style={[styles.row, index > 0 && styles.rowDivider]}>
          <View style={styles.rowInfo}>
            <Text style={styles.rowName} numberOfLines={1}>
              {variant.name || 'Unnamed'}
              {offKeys.includes(variant.key) ? <Text style={styles.offTag}>{'  Off'}</Text> : null}
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
            inputRef={fieldRef?.(variant.key)}
            missing={isPriceMissing({
              showErrors: highlightMissing,
              prices,
              keys: variants.map((entry) => entry.key),
              key: variant.key,
              required,
            })}
          />
        </View>
      ))}
    </View>
  );
}

/** One price for the whole product: a card with the label on the left and the price on the right, like a variant row. */
function SinglePrice({
  label,
  value,
  onChangeText,
  accessibilityLabel,
  missing = false,
  embedded = false,
  fieldRef,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  accessibilityLabel: string;
  /** The save was tried and this price is still empty. */
  missing?: boolean;
  /** Inside a branch card: no frame of its own. */
  embedded?: boolean;
  fieldRef?: (node: TextInput | null) => void;
}) {
  return (
    <View style={[embedded ? styles.listEmbedded : styles.list, styles.singleCard, embedded && styles.singleEmbedded]}>
      <Text style={styles.singleLabel} numberOfLines={1}>
        {label}
      </Text>
      <PriceInput value={value} onChangeText={onChangeText} accessibilityLabel={accessibilityLabel} missing={missing && value.trim() === ''} inputRef={fieldRef} />
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
  branches,
  uniformBase,
  onUniformBaseChange,
  uniformPrices,
  onUniformPriceChange,
  branchOn,
  lockedOnIds = [],
  onToggleBranch,
  drafts,
  onBranchBaseChange,
  onBranchVariantPriceChange,
  offProductBranchIds = [],
  offOptionKeysByBranch = {},
  error,
  revealKey = 0,
  notCarriedBranches,
}: {
  mode: PricingMode;
  onModeChange: (mode: PricingMode) => void;
  variants: Array<{ key: string; name: string }>;
  /** Optional one-line "what it uses" per variant key, shown under the variant name. */
  stockSummaries: Record<string, string>;
  branches: Array<{ id: string; name: string }>;
  uniformBase: string;
  onUniformBaseChange: (text: string) => void;
  uniformPrices: Record<string, string>;
  onUniformPriceChange: (key: string, text: string) => void;
  /** "Different per Branch": whether each branch sells the product. A branch that is off is not added and gets no price. */
  branchOn: Record<string, boolean>;
  /** Branches that already carry the product (Edit): always on, no switch. */
  lockedOnIds?: string[];
  onToggleBranch: (branchId: string, on: boolean) => void;
  drafts: Record<string, BranchPriceDraft>;
  onBranchBaseChange: (branchId: string, text: string) => void;
  onBranchVariantPriceChange: (branchId: string, key: string, text: string) => void;
  /** Edit: branches where the whole product is switched off today (saving keeps it off). */
  offProductBranchIds?: string[];
  /** Edit: per branch, the options that are switched off today (saving keeps them off). */
  offOptionKeysByBranch?: Record<string, string[]>;
  error?: string;
  /** Goes up by one each time a save is refused: scrolls to (and focuses) the first price that needs fixing. */
  revealKey?: number;
  /**
   * Edit only: the selling branches that do not carry the product yet. "Same for All" adds the product to them. Absent (Create)
   * means every branch is new.
   */
  notCarriedBranches?: string[];
}) {
  const hasVariants = variants.length > 0;
  const toAdd = notCarriedBranches ?? [];
  const priceFieldFlagged = firstPriceToFix({ mode, variants, uniformBase, uniformPrices, branches, branchOn, drafts }) !== null;

  // After a refused save: bring the first price that needs fixing into view (its branch card, when there are cards) and focus it.
  const reveal = useSheetReveal();
  const fields = useRef(new Map<string, TextInput>());
  const cards = useRef(new Map<string, View>());
  const fieldRef = (id: string) => (node: TextInput | null) => {
    if (node) fields.current.set(id, node);
    else fields.current.delete(id);
  };
  const cardRef = (id: string) => (node: View | null) => {
    if (node) cards.current.set(id, node);
    else cards.current.delete(id);
  };
  useEffect(() => {
    if (!revealKey) return;
    const first = firstPriceToFix({ mode, variants, uniformBase, uniformPrices, branches, branchOn, drafts });
    if (first) {
      const input = fields.current.get(first.field) ?? null;
      reveal((first.card ? cards.current.get(first.card) : undefined) ?? input, { focus: input });
      return;
    }
    // not a price problem (every branch is switched off): show the branches
    const firstCard = mode === 'different' && branches[0] ? cards.current.get(branches[0].id) : undefined;
    if (firstCard) reveal(firstCard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);

  return (
    <View style={styles.wrap}>
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
              <Text style={[styles.toggleText, active && styles.toggleTextActive]} numberOfLines={1}>
                {option === 'same' ? 'Same for All' : 'Different per Branch'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {branches.length === 0 ? (
        <Text style={styles.hint}>No selling branches yet.</Text>
      ) : mode === 'same' ? (
        <>
          {hasVariants ? (
            <PriceList
              variants={variants}
              summaries={stockSummaries}
              prices={uniformPrices}
              onChange={onUniformPriceChange}
              highlightMissing={Boolean(error)}
              required
              fieldRef={(key) => fieldRef(`same:${key}`)}
            />
          ) : (
            <SinglePrice
              label="Selling price"
              value={uniformBase}
              onChangeText={onUniformBaseChange}
              accessibilityLabel="Selling price (PHP)"
              missing={Boolean(error)}
              fieldRef={fieldRef('same:base')}
            />
          )}
          {toAdd.length > 0 ? <Text style={styles.hint}>{`Adds it to ${toAdd.join(', ')}.`}</Text> : null}
        </>
      ) : (
        <>
          {branches.map((branch) => {
            const on = branchOn[branch.id] !== false;
            const locked = lockedOnIds.includes(branch.id);
            const draft = drafts[branch.id] ?? { base: '', variantPrices: {} };
            return (
              <View key={branch.id} ref={cardRef(branch.id)} collapsable={false} style={[styles.branchCard, !on && styles.branchCardOff]}>
                <View style={styles.branchHead}>
                  <View style={styles.branchTitleCol}>
                    <Text style={styles.branchTitle} numberOfLines={2}>
                      {branch.name}
                    </Text>
                    <Text style={styles.branchCaption}>
                      {locked ? (offProductBranchIds.includes(branch.id) ? 'Already added · off at this branch' : 'Already added') : 'Add to branch'}
                    </Text>
                  </View>
                  {locked ? null : (
                    <Switch
                      accessibilityLabel={`Add to ${branch.name}`}
                      value={on}
                      onValueChange={(next) => onToggleBranch(branch.id, next)}
                      thumbColor={colors.surface}
                      trackColor={{ false: colors.disabled, true: managerColors.royalBlue }}
                    />
                  )}
                </View>
                {on ? (
                  hasVariants ? (
                    <PriceList
                      embedded
                      variants={variants}
                      summaries={stockSummaries}
                      prices={draft.variantPrices}
                      onChange={(key, text) => onBranchVariantPriceChange(branch.id, key, text)}
                      highlightMissing={Boolean(error)}
                      required
                      offKeys={offOptionKeysByBranch[branch.id]}
                      fieldRef={(key) => fieldRef(`${branch.id}:${key}`)}
                    />
                  ) : (
                    <SinglePrice
                      embedded
                      label="Selling price"
                      value={draft.base}
                      onChangeText={(text) => onBranchBaseChange(branch.id, text)}
                      accessibilityLabel={`${branch.name} selling price (PHP)`}
                      missing={Boolean(error)}
                      fieldRef={fieldRef(`${branch.id}:base`)}
                    />
                  )
                ) : null}
              </View>
            );
          })}
        </>
      )}

      {/* a price that needs fixing is flagged on its own field; the message is only for a problem no field shows (every branch off) */}
      {error && !priceFieldFlagged ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
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
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  branchCard: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  branchCardOff: { backgroundColor: managerColors.cardSurface },
  branchHead: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TOUCH_TARGET - 8 },
  branchTitleCol: { flex: 1, minWidth: 0, gap: 1 },
  branchTitle: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  branchCaption: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13 },
  offTag: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
  listEmbedded: { paddingTop: 0 },
  singleEmbedded: { paddingVertical: 4 },

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
  singleCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12 },
  singleLabel: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
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
  error: { color: DANGER, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.7 },
});
