import Ionicons from '@react-native-vector-icons/ionicons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Pagination } from '@/components/Pagination';
import { FormField } from '@/components/FormField';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import {
  formatCashResultLabel,
  formatExpectedRemainingLabel,
  formatInventoryResultLabel,
  incompleteProductCount,
  isValidClosePieceQuantity,
  previewInventoryResult,
} from '@/features/shifts/closeDisplay';
import { useClientPagination } from '@/hooks/useClientPagination';
import { TABLET_MIN_EDGE } from '@/lib/layout';
import { formatMoney, previewCashResult } from '@/lib/format';
import type {
  ShiftCloseFinalizeProduct,
  ShiftClosePreview,
  ShiftCloseProductPreview,
} from '@/types/models';

type CountFilter = 'all' | 'needs_count' | 'counted';

const COUNT_FILTER_OPTIONS: Array<{ label: string; value: CountFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Needs count', value: 'needs_count' },
  { label: 'Counted', value: 'counted' },
];

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
  const counted = hasActual && !actualError;

  return (
    <View
      style={[styles.productCard, counted && styles.productCardCounted]}
      accessibilityLabel={`Count ${product.product_name_snapshot}`}
    >
      <View style={styles.productCardTop}>
        <View style={styles.productIconChip}>
          <Ionicons name="cube-outline" size={18} color={managerColors.royalBlue} />
        </View>
        <View style={styles.productCardInfo}>
          <Text style={styles.productName}>{product.product_name_snapshot}</Text>
          {product.sku_snapshot ? <Text style={styles.sku}>SKU {product.sku_snapshot}</Text> : null}
          <Text style={styles.systemStock}>
            System stock: {Number(product.system_balance_before_waste)} pcs
          </Text>
        </View>
        {counted ? (
          <View style={styles.countedBadge}>
            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
          </View>
        ) : null}
      </View>

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
            accessibilityHint="Count usable items left at the booth, not including waste."
          />
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
            accessibilityHint="Damaged, spoiled, or otherwise unusable pieces."
          />
        </View>
      </View>

      <View style={styles.resultRow}>
        <View style={styles.resultItem}>
          <Text style={styles.resultLabel}>Expected remaining</Text>
          <Text style={styles.resultValue}>
            {formatExpectedRemainingLabel(preview?.expectedRemaining ?? null, hasActual)}
          </Text>
        </View>
        <View style={styles.resultItem}>
          <Text style={styles.resultLabel}>Difference</Text>
          <Text
            style={[
              styles.resultValue,
              preview?.result === 'shortage' && styles.resultShortage,
              preview?.result === 'excess' && styles.resultExcess,
              preview?.result === 'exact' && styles.resultExact,
            ]}
          >
            {hasActual ? formatInventoryResultLabel(preview) : '—'}
          </Text>
        </View>
      </View>

      <Pressable
        onPress={() => setDetailsOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityLabel={detailsOpen ? 'Hide stock details' : 'View stock details'}
        style={styles.detailsToggleRow}
      >
        <Text style={styles.detailsToggle}>
          {detailsOpen ? 'Hide stock details' : 'View stock details'}
        </Text>
        <Ionicons
          name={detailsOpen ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={managerColors.royalBlue}
        />
      </Pressable>
      {detailsOpen ? (
        <View style={styles.detailsBox}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Opening</Text>
            <Text style={styles.detailValue}>{Number(product.opening_quantity)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Received</Text>
            <Text style={styles.detailValue}>{Number(product.received_quantity)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Returned/outgoing</Text>
            <Text style={styles.detailValue}>{Number(product.outgoing_quantity)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Sold</Text>
            <Text style={styles.detailValue}>{Number(product.sold_quantity)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Adjustment</Text>
            <Text style={styles.detailValue}>{Number(product.adjustment_quantity)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>System stock</Text>
            <Text style={styles.detailValue}>{Number(product.system_balance_before_waste)}</Text>
          </View>
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
  const [search, setSearch] = useState('');
  const [countFilter, setCountFilter] = useState<CountFilter>('all');

  const cashResult = previewCashResult(expectedCash, actualCash);
  const incomplete = incompleteProductCount(products, counts);
  const countedTotal = products.length - incomplete;

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) => {
      const counted = Boolean(counts[product.product_id]?.actualRemaining?.trim());
      if (countFilter === 'needs_count' && counted) return false;
      if (countFilter === 'counted' && !counted) return false;
      if (!term) return true;
      return `${product.product_name_snapshot} ${product.sku_snapshot ?? ''}`.toLowerCase().includes(term);
    });
  }, [products, counts, search, countFilter]);

  const pagination = useClientPagination(filteredProducts, `${search}|${countFilter}`, 8);

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
    <View style={styles.wrapper} accessibilityLabel={title}>
      <View style={styles.identityCard}>
        <View style={styles.identityHeader}>
          <View style={styles.identityIconChip}>
            <Ionicons name="document-text-outline" size={20} color={managerColors.royalBlue} />
          </View>
          <View style={styles.identityHeaderText}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.status}>Sales closed for today</Text>
          </View>
        </View>
        {(branchName || cutoffLabel) ? (
          <>
            <View style={styles.identityDivider} />
            {branchName ? (
              <View style={styles.identityRow}>
                <Ionicons name="storefront-outline" size={14} color={managerColors.subtext} />
                <Text style={styles.identityText}>Branch: {branchName}</Text>
              </View>
            ) : null}
            {cutoffLabel ? (
              <View style={styles.identityRow}>
                <Ionicons name="time-outline" size={14} color={managerColors.subtext} />
                <Text style={styles.identityText}>Cutoff: {cutoffLabel}</Text>
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      {!isLegacy && products.length > 0 ? (
        <>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Inventory count</Text>
            <Text style={styles.hint}>Count what's left and any waste for each product.</Text>
            <View
              style={[styles.banner, incomplete === 0 ? styles.bannerDone : styles.bannerPending]}
              accessibilityLiveRegion="polite"
            >
              <Ionicons
                name={incomplete === 0 ? 'checkmark-circle' : 'alert-circle-outline'}
                size={16}
                color={incomplete === 0 ? managerColors.green : '#92400E'}
              />
              <Text style={[styles.bannerText, incomplete === 0 && styles.bannerTextDone]}>
                {incomplete === 0
                  ? `All ${products.length} products counted`
                  : `${countedTotal} of ${products.length} counted · ${incomplete} remaining`}
              </Text>
            </View>

            <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or SKU" />
            <FilterChipRow options={COUNT_FILTER_OPTIONS} value={countFilter} onChange={setCountFilter} />
          </View>

          {pagination.pageItems.length === 0 ? (
            <Text style={styles.note}>No products match this search or filter.</Text>
          ) : (
            pagination.pageItems.map((product) => {
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
            })
          )}
          {pagination.showPagination ? (
            <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
          ) : null}
        </>
      ) : (
        <View style={styles.sectionCard}>
          <Text style={styles.note}>
            {isLegacy
              ? 'This historical shift only needs cash reconciliation.'
              : 'No inventory counts required for this shift.'}
          </Text>
        </View>
      )}

      <View style={styles.sectionCard}>
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
  wrapper: { gap: 14 },
  identityCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  identityHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityIconChip: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE8FC',
  },
  identityHeaderText: { flex: 1, gap: 2, minWidth: 0 },
  identityDivider: { height: 1, backgroundColor: managerColors.cardBorder },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  identityText: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  title: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 18 },
  status: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  note: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.6,
  },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginTop: -6 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  bannerPending: { backgroundColor: '#FEF3C7' },
  bannerDone: { backgroundColor: '#DCFCE7' },
  bannerText: { flex: 1, color: '#92400E', fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  bannerTextDone: { color: managerColors.green, fontFamily: 'Inter_600SemiBold' },
  productCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  productCardCounted: { borderColor: managerColors.green, backgroundColor: '#F8FFFA' },
  productCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  productIconChip: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE8FC',
  },
  productCardInfo: { flex: 1, minWidth: 0, gap: 2 },
  countedBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: managerColors.green,
  },
  productName: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  sku: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  systemStock: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  fieldsRow: { flexDirection: 'row', gap: 12 },
  fieldsStack: { gap: 12 },
  fieldHalf: { flex: 1 },
  helper: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 16 },
  resultRow: {
    flexDirection: 'row',
    gap: 20,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingTop: 12,
  },
  resultItem: { gap: 2 },
  resultLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
  resultValue: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  resultExact: { color: managerColors.green },
  resultShortage: { color: '#B45309' },
  resultExcess: { color: managerColors.royalBlue },
  detailsToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  detailsToggle: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  detailsBox: {
    backgroundColor: managerColors.cardSurface,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  detailValue: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
  expectedCash: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  cashDiff: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
