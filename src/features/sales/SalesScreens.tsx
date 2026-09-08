import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBranches } from '@/hooks/useBranches';
import { useEmployees } from '@/hooks/useEmployees';
import { useSale, useSales } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { PAGE_SIZE, PAGINATION_MIN_ITEMS, totalPagesFor } from '@/lib/pagination';
import type { SaleStatus } from '@/types/models';

function SaleStatusBadge({ status }: { status: SaleStatus }) {
  const isCompleted = status === 'completed';
  return (
    <Text
      style={[
        styles.badge,
        isCompleted ? styles.completedBadge : styles.voidedBadge,
      ]}
    >
      {isCompleted ? 'COMPLETED' : 'VOIDED'}
    </Text>
  );
}

export function SalesHistoryScreen({ role }: { role: 'owner' | 'manager' | 'cashier' }) {
  const { profile } = useAuth();
  const [page, setPage] = useState(0);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedCashierId, setSelectedCashierId] = useState('');
  const [dateFilter, setDateFilter] = useState(''); // YYYY-MM-DD

  // Branches & Cashiers for Owner filter
  const branches = useBranches();
  const employees = useEmployees();
  const cashiers = employees.data?.filter((e) => e.role === 'cashier') ?? [];

  // For manager, branch is assigned branch; for cashier, cashier is own id
  const branchId = role === 'owner' ? (selectedBranchId || undefined) : undefined;
  const cashierId = role === 'owner' ? (selectedCashierId || undefined) : undefined;

  const salesQuery = useSales(
    {
      branchId,
      cashierId,
      date: dateFilter || undefined,
    },
    page,
    PAGE_SIZE,
  );

  const sales = salesQuery.data?.items ?? [];
  const total = salesQuery.data?.total ?? 0;
  const totalPages = totalPagesFor(total, PAGE_SIZE);
  const showPagination = total >= PAGINATION_MIN_ITEMS;

  return (
    <Screen constrain>
      <PageHeader
        title="Sales History"
        subtitle={
          role === 'owner'
            ? 'Audited sales across all branches.'
            : role === 'manager'
            ? `${profile?.branch?.name ?? 'Branch'} sales history.`
            : 'Your recorded sales.'
        }
      />

      {/* Owner Filters */}
      {role === 'owner' && (
        <View style={styles.filterCard}>
          <Text style={styles.filterTitle}>Filters</Text>

          {/* Branch Filter Tabs */}
          <Text style={styles.label}>Branch:</Text>
          <View style={styles.chipRow}>
            <Text
              onPress={() => {
                setSelectedBranchId('');
                setPage(0);
              }}
              style={[styles.chip, !selectedBranchId && styles.chipActive]}
            >
              All Branches
            </Text>
            {branches.data
              ?.filter((b) => !b.is_main_branch)
              .map((b) => (
                <Text
                  key={b.id}
                  onPress={() => {
                    setSelectedBranchId(b.id);
                    setPage(0);
                  }}
                  style={[styles.chip, selectedBranchId === b.id && styles.chipActive]}
                >
                  {b.name}
                </Text>
              ))}
          </View>

          {/* Cashier Filter Tabs */}
          {cashiers.length > 0 && (
            <>
              <Text style={styles.label}>Cashier:</Text>
              <View style={styles.chipRow}>
                <Text
                  onPress={() => {
                    setSelectedCashierId('');
                    setPage(0);
                  }}
                  style={[styles.chip, !selectedCashierId && styles.chipActive]}
                >
                  All Cashiers
                </Text>
                {cashiers.map((c) => (
                  <Text
                    key={c.id}
                    onPress={() => {
                      setSelectedCashierId(c.id);
                      setPage(0);
                    }}
                    style={[styles.chip, selectedCashierId === c.id && styles.chipActive]}
                  >
                    {c.full_name}
                  </Text>
                ))}
              </View>
            </>
          )}
        </View>
      )}

      {/* Date Filter */}
      <View style={styles.dateRow}>
        <TextInput
          style={styles.dateInput}
          placeholder="Filter by Date (YYYY-MM-DD)"
          placeholderTextColor={colors.muted}
          value={dateFilter}
          onChangeText={(val) => {
            setDateFilter(val.trim());
            setPage(0);
          }}
        />
        {dateFilter ? (
          <AppButton
            label="Clear Date"
            variant="secondary"
            onPress={() => {
              setDateFilter('');
              setPage(0);
            }}
          />
        ) : null}
      </View>

      {salesQuery.isLoading && <LoadingState label="Loading sales history…" />}
      {salesQuery.error && (
        <ErrorState
          message={getErrorMessage(salesQuery.error)}
          onRetry={() => void salesQuery.refetch()}
        />
      )}

      {sales.length === 0 && !salesQuery.isLoading && (
        <EmptyState title="No sales found" message="No matching sales records for this selection." />
      )}

      {sales.map((sale) => (
        <View key={sale.id} style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.saleNumber}>{sale.sale_number}</Text>
            <SaleStatusBadge status={sale.status} />
          </View>

          <View style={styles.auditRow}>
            <Text style={styles.metaLabel}>Branch:</Text>
            <Text style={styles.metaValue}>{sale.branch?.name ?? 'Branch'}</Text>
          </View>

          <View style={styles.auditRow}>
            <Text style={styles.metaLabel}>Cashier:</Text>
            <Text style={styles.metaValue}>{sale.cashier?.full_name ?? 'Cashier'}</Text>
          </View>

          <View style={styles.auditRow}>
            <Text style={styles.metaLabel}>Date / Time:</Text>
            <Text style={styles.metaValue}>{formatDate(sale.sold_at)}</Text>
          </View>

          <View style={styles.auditRow}>
            <Text style={styles.metaLabel}>Total:</Text>
            <Text style={styles.totalValue}>{formatMoney(sale.total_amount)}</Text>
          </View>

          <AppButton
            label="View sale details"
            variant="secondary"
            onPress={() => {
              const route =
                role === 'owner'
                  ? `/owner/sales/${sale.id}`
                  : role === 'manager'
                  ? `/manager/sales/${sale.id}`
                  : `/cashier/sales/${sale.id}`;
              router.push(route as any);
            }}
          />
        </View>
      ))}

      {showPagination ? (
        <View style={styles.pager}>
          <Pagination
            page={Math.min(page, totalPages - 1)}
            totalPages={totalPages}
            onPageChange={setPage}
            visible={!salesQuery.isLoading}
          />
        </View>
      ) : null}
    </Screen>
  );
}

type SaleDetailsBodyProps = {
  saleId: string;
  role: 'owner' | 'manager' | 'cashier';
  /** Hide shift link when embedded in a split pane. */
  showShiftLink?: boolean;
};

/** Sale detail body reusable for full-page and tablet master–detail. */
export function SaleDetailsBody({
  saleId,
  role,
  showShiftLink = true,
}: SaleDetailsBodyProps) {
  const query = useSale(saleId);

  if (query.isLoading) return <LoadingState label="Loading sale details…" />;
  if (query.error || !query.data) {
    return (
      <ErrorState
        message="Unable to load sale details."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const sale = query.data;

  return (
    <View style={styles.detailsBody}>
      <View style={styles.headerRow}>
        <View style={styles.detailsHeaderCopy}>
          <PageHeader title={sale.sale_number} subtitle={`Sold ${formatDate(sale.sold_at)}`} />
        </View>
        <SaleStatusBadge status={sale.status} />
      </View>

      <View style={styles.card}>
        <View style={styles.auditRow}>
          <Text style={styles.metaLabel}>Branch:</Text>
          <Text style={styles.metaValue}>{sale.branch?.name ?? 'Branch'}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.metaLabel}>Cashier:</Text>
          <Text style={styles.metaValue}>{sale.cashier?.full_name ?? 'Cashier'}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.metaLabel}>Shift Session:</Text>
          <Text style={styles.metaValue}>
            {sale.shift ? formatDate(sale.shift.started_at) : 'Shift session'}
          </Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.metaLabel}>Date / Time:</Text>
          <Text style={styles.metaValue}>{formatDate(sale.sold_at)}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Items Ordered</Text>
      {sale.items.map((item) => (
        <View key={item.id} style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.productName}>
              {item.product?.name ?? `Product (${item.product_id})`}
            </Text>
            <Text style={styles.itemSubtotal}>{formatMoney(item.subtotal)}</Text>
          </View>
          <Text style={styles.itemMeta}>
            Quantity: {item.quantity} · Historical Price: {formatMoney(item.unit_price)}
          </Text>
        </View>
      ))}

      <Text style={styles.sectionTitle}>Payment Summary</Text>
      <View style={styles.card}>
        <View style={styles.auditRow}>
          <Text style={styles.metaLabel}>Subtotal:</Text>
          <Text style={styles.metaValue}>{formatMoney(sale.subtotal)}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.totalLabel}>Total Amount:</Text>
          <Text style={styles.totalAmount}>{formatMoney(sale.total_amount)}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.metaLabel}>Amount Paid:</Text>
          <Text style={styles.metaValue}>{formatMoney(sale.amount_paid)}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.metaLabel}>Change Given:</Text>
          <Text style={styles.metaValue}>{formatMoney(sale.change_amount)}</Text>
        </View>
      </View>

      {showShiftLink && sale.shift_id ? (
        <AppButton
          label="View shift details"
          variant="secondary"
          onPress={() => {
            const shiftRoute =
              role === 'owner'
                ? `/owner/shifts/${sale.shift_id}`
                : role === 'manager'
                  ? `/manager/shifts/${sale.shift_id}`
                  : `/cashier/shifts/${sale.shift_id}`;
            router.push(shiftRoute as never);
          }}
        />
      ) : null}
    </View>
  );
}

export function SaleDetailsScreen({ role }: { role: 'owner' | 'manager' | 'cashier' }) {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  return (
    <Screen constrain>
      <SaleDetailsBody saleId={id} role={role} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  detailsBody: { gap: spacing.md },
  detailsHeaderCopy: { flex: 1, minWidth: 0 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  filterCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  filterTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: '#F3F4F6',
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  chipActive: {
    backgroundColor: colors.primary,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  saleNumber: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },
  completedBadge: {
    color: '#166534',
    backgroundColor: '#DCFCE7',
  },
  voidedBadge: {
    color: '#991B1B',
    backgroundColor: '#FEE2E2',
  },
  auditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  metaLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  metaValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  totalValue: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  productName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
  },
  itemSubtotal: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  itemMeta: {
    color: colors.muted,
    fontSize: 13,
  },
  totalLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  totalAmount: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '900',
  },
  pager: {
    paddingVertical: spacing.sm,
  },
});
