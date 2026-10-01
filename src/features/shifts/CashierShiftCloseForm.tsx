import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';
import { spacing } from '@/constants/theme';
import {
  ACTUAL_REMAINING_HELPER,
  WASTE_HELPER,
  formatCashResultLabel,
  formatExpectedRemainingLabel,
  formatInventoryResultLabel,
  incompleteProductCount,
  isValidClosePieceQuantity,
  previewInventoryResult,
} from '@/features/shifts/closeDisplay';
import { TABLET_MIN_EDGE } from '@/lib/layout';
import { formatMoney, previewCashResult } from '@/lib/format';
import type {
  ShiftCloseFinalizeProduct,
  ShiftClosePreview,
  ShiftCloseProductPreview,
} from '@/types/models';

type ProductCounts = Record<string, { actualRemaining: string; wasteQuantity: string }>;

function emptyCounts(products: ShiftCloseProductPreview[]): ProductCounts {
  return Object.fromEntries(
    products.map((product) => [product.product_id, { actualRemaining: '', wasteQuantity: '0' }]),
  );
}

function buildFinalizePayload(
  products: ShiftCloseProductPreview[],
  counts: ProductCounts,
): ShiftCloseFinalizeProduct[] {
  return products.map((product) => {
    const row = counts[product.product_id];
    const waste = (row?.wasteQuantity ?? '0').trim() || '0';
    return {
      product_id: product.product_id,
      actual_remaining: (row?.actualRemaining ?? '').trim(),
      ...(waste !== '0' ? { waste_quantity: waste } : {}),
    };
  });
}

function ProductCountCard({
  product,
  actualRemaining,
  wasteQuantity,
  onChangeActual,
  onChangeWaste,
  wide,
}: {
  product: ShiftCloseProductPreview;
  actualRemaining: string;
  wasteQuantity: string;
  onChangeActual: (value: string) => void;
  onChangeWaste: (value: string) => void;
  wide: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasActual = actualRemaining.trim().length > 0;
  const preview = previewInventoryResult(
    Number(product.system_balance_before_waste),
    actualRemaining,
    wasteQuantity,
  );
  const actualError =
    hasActual && !isValidClosePieceQuantity(actualRemaining)
      ? 'Use whole pieces only (0 or more).'
      : undefined;
  const wasteError =
    wasteQuantity.trim().length > 0 && !isValidClosePieceQuantity(wasteQuantity.trim() || '0')
      ? 'Use whole pieces only (0 or more).'
      : undefined;

  return (
    <View style={styles.productCard} accessibilityLabel={`Count ${product.product_name_snapshot}`}>
      <Text style={styles.productName}>{product.product_name_snapshot}</Text>
      {product.sku_snapshot ? <Text style={styles.sku}>SKU {product.sku_snapshot}</Text> : null}
      <Text style={styles.systemStock}>
        System stock: {Number(product.system_balance_before_waste)} pcs
      </Text>

      <View style={wide ? styles.fieldsRow : styles.fieldsStack}>
        <View style={wide ? styles.fieldHalf : undefined}>
          <FormField
            label="Actual remaining"
            value={actualRemaining}
            onChangeText={onChangeActual}
            keyboardType="number-pad"
            placeholder="—"
            error={actualError}
            accentColor={managerColors.royalBlue}
            accessibilityHint={ACTUAL_REMAINING_HELPER}
          />
          <Text style={styles.helper}>{ACTUAL_REMAINING_HELPER}</Text>
        </View>
        <View style={wide ? styles.fieldHalf : undefined}>
          <FormField
            label="Waste"
            value={wasteQuantity}
            onChangeText={onChangeWaste}
            keyboardType="number-pad"
            placeholder="0"
            error={wasteError}
            accentColor={managerColors.royalBlue}
            accessibilityHint={WASTE_HELPER}
          />
          <Text style={styles.helper}>{WASTE_HELPER}</Text>
        </View>
      </View>

      <View style={styles.resultRow}>
        <Text style={styles.resultMeta}>
          Expected remaining:{' '}
          {formatExpectedRemainingLabel(preview?.expectedRemaining ?? null, hasActual)}
        </Text>
        <Text
          style={[
            styles.resultValue,
            preview?.result === 'shortage' && styles.resultShortage,
            preview?.result === 'excess' && styles.resultExcess,
            preview?.result === 'exact' && styles.resultExact,
          ]}
        >
          {hasActual ? `Difference: ${formatInventoryResultLabel(preview)}` : 'Difference: —'}
        </Text>
      </View>

      <Pressable
        onPress={() => setDetailsOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityLabel={detailsOpen ? 'Hide stock details' : 'View stock details'}
      >
        <Text style={styles.detailsToggle}>
          {detailsOpen ? 'Hide stock details' : 'View stock details'}
        </Text>
      </Pressable>
      {detailsOpen ? (
        <View style={styles.detailsBox}>
          <Text style={styles.detailLine}>Opening: {Number(product.opening_quantity)}</Text>
          <Text style={styles.detailLine}>Received: {Number(product.received_quantity)}</Text>
          <Text style={styles.detailLine}>Returned/outgoing: {Number(product.outgoing_quantity)}</Text>
          <Text style={styles.detailLine}>Sold: {Number(product.sold_quantity)}</Text>
          <Text style={styles.detailLine}>Adjustment: {Number(product.adjustment_quantity)}</Text>
          <Text style={styles.detailLine}>
            System stock: {Number(product.system_balance_before_waste)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function CashierShiftCloseForm({
  preview,
  branchName,
  title = 'End Shift',
  submitLabel = 'Complete End Shift',
  loading,
  onSubmit,
}: {
  preview: ShiftClosePreview;
  branchName?: string | null;
  title?: string;
  submitLabel?: string;
  loading?: boolean;
  onSubmit: (actualCash: string, products: ShiftCloseFinalizeProduct[]) => void;
}) {
  const { width, height } = useWindowDimensions();
  const wide = Math.min(width, height) >= TABLET_MIN_EDGE;
  const isLegacy = preview.mode === 'legacy_cash_only' || !preview.inventory_reconciliation_required;
  const products = isLegacy ? [] : preview.products ?? [];
  const expectedCash = Number(preview.expected_cash);

  const [actualCash, setActualCash] = useState('');
  const [counts, setCounts] = useState<ProductCounts>(() => emptyCounts(products));

  const cashResult = previewCashResult(expectedCash, actualCash);
  const incomplete = incompleteProductCount(products, counts);

  const productsValid = useMemo(() => {
    if (products.length === 0) return true;
    return products.every((product) => {
      const row = counts[product.product_id];
      const waste = (row?.wasteQuantity ?? '0').trim() || '0';
      return (
        isValidClosePieceQuantity(row?.actualRemaining ?? '')
        && isValidClosePieceQuantity(waste)
      );
    });
  }, [counts, products]);

  const canSubmit = cashResult != null && productsValid && incomplete === 0;

  const cutoffLabel = preview.sales_cutoff_at
    ? new Date(preview.sales_cutoff_at).toLocaleString('en-PH', {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const submit = () => {
    if (!canSubmit || loading) return;
    onSubmit(actualCash.trim(), buildFinalizePayload(products, counts));
  };

  return (
    <View style={styles.card} accessibilityLabel={title}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.status}>Sales closed for today</Text>
      {branchName ? <Text style={styles.meta}>Branch: {branchName}</Text> : null}
      {cutoffLabel ? <Text style={styles.meta}>Cutoff: {cutoffLabel}</Text> : null}

      {!isLegacy && products.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Inventory count</Text>
          {incomplete > 0 ? (
            <Text style={styles.banner} accessibilityLiveRegion="polite">
              {incomplete} product{incomplete === 1 ? '' : 's'} still need a physical count.
            </Text>
          ) : null}
          {products.map((product) => {
            const row = counts[product.product_id] ?? { actualRemaining: '', wasteQuantity: '0' };
            return (
              <ProductCountCard
                key={product.product_id}
                product={product}
                actualRemaining={row.actualRemaining}
                wasteQuantity={row.wasteQuantity}
                wide={wide}
                onChangeActual={(actualRemaining) =>
                  setCounts((current) => ({
                    ...current,
                    [product.product_id]: {
                      actualRemaining,
                      wasteQuantity: current[product.product_id]?.wasteQuantity ?? '0',
                    },
                  }))
                }
                onChangeWaste={(wasteQuantity) =>
                  setCounts((current) => ({
                    ...current,
                    [product.product_id]: {
                      actualRemaining: current[product.product_id]?.actualRemaining ?? '',
                      wasteQuantity,
                    },
                  }))
                }
              />
            );
          })}
        </View>
      ) : (
        <Text style={styles.note}>
          {isLegacy
            ? 'This historical shift only needs cash reconciliation.'
            : 'No inventory counts required for this shift.'}
        </Text>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cash Remittance</Text>
        <Text style={styles.expectedCash}>Expected cash {formatMoney(expectedCash)}</Text>
        <FormField
          label="Actual cash"
          value={actualCash}
          onChangeText={setActualCash}
          keyboardType="decimal-pad"
          placeholder="—"
          accentColor={managerColors.royalBlue}
          accessibilityHint="Enter the cash counted in the drawer. Leave blank until counted."
        />
        <Text style={styles.cashDiff}>
          Difference: {formatCashResultLabel(expectedCash, actualCash, cashResult)}
        </Text>
        {!actualCash.trim() ? (
          <Text style={styles.helper}>Enter actual cash counted. Leave blank until counted.</Text>
        ) : null}
      </View>

      <ManagerActionButton
        label={submitLabel}
        loading={loading}
        disabled={!canSubmit || loading}
        onPress={submit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.md,
  },
  title: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 19 },
  status: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  note: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  section: { gap: spacing.sm },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.6,
  },
  banner: {
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  productCard: {
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    backgroundColor: managerColors.cardSurface,
  },
  productName: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  sku: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  systemStock: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  fieldsRow: { flexDirection: 'row', gap: 10 },
  fieldsStack: { gap: 4 },
  fieldHalf: { flex: 1 },
  helper: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 16 },
  resultRow: { gap: 2 },
  resultMeta: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  resultValue: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  resultExact: { color: managerColors.green },
  resultShortage: { color: '#B45309' },
  resultExcess: { color: managerColors.royalBlue },
  detailsToggle: {
    color: managerColors.royalBlue,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    marginTop: 2,
  },
  detailsBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    gap: 2,
  },
  detailLine: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  expectedCash: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  cashDiff: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
