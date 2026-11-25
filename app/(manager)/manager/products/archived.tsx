import { useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { useDeleteArchivedProduct, useRestoreProduct, useArchivedProducts } from '@/hooks/useProducts';
import { confirmAction } from '@/lib/confirmAction';
import { getErrorMessage, getRetentionActionMessage } from '@/lib/errors';
import { formatDateShort } from '@/lib/format';
import { tryBeginSubmit, endSubmit } from '@/lib/submitLock';
import type { Product } from '@/types/models';

type PendingAction = { id: string; kind: 'restore' | 'delete' } | null;

export default function ArchivedProductsScreen() {
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState<PendingAction>(null);
  const lock = useRef(false);
  const query = useArchivedProducts(search);
  const restoreMutation = useRestoreProduct();
  const deleteMutation = useDeleteArchivedProduct();

  const run = (product: Product, kind: 'restore' | 'delete') => {
    if (!tryBeginSubmit(lock)) return;
    setPending({ id: product.id, kind });
    setActionError('');
    setNotice('');
    const action = kind === 'restore' ? restoreMutation.mutateAsync(product.id) : deleteMutation.mutateAsync(product.id);
    void action
      .then(() => {
        setNotice(kind === 'restore' ? `${product.name} is back on Products.` : `${product.name} was permanently deleted.`);
      })
      .catch((error: unknown) => setActionError(getRetentionActionMessage(error)))
      .finally(() => {
        endSubmit(lock);
        setPending(null);
      });
  };

  const confirmRestore = (product: Product) => {
    if (pending) return;
    confirmAction(
      'Restore product?',
      `This puts ${product.name} back on Products with the same ID, SKU, stock, and recipes. Its enabled or disabled setting returns to what it was before it was archived.`,
      () => run(product, 'restore'),
      { confirm: 'Restore', cancel: 'Cancel', tone: 'warning' },
    );
  };

  const confirmDelete = (product: Product) => {
    if (pending) return;
    confirmAction(
      'Delete product permanently?',
      `This permanently deletes ${product.name} only when it has no sales, stock movements, or other records that must be kept. This cannot be undone. If it has history, restore it instead.`,
      () => run(product, 'delete'),
      { confirm: 'Delete product', cancel: 'Cancel', tone: 'danger' },
    );
  };

  return (
    <MainBranchGuard>
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Archived Products" showBack />
        <ConstrainedWidth style={styles.column}>
          <View style={styles.filters}>
            <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or SKU" />
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          </View>
          {query.error ? (
            <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
          ) : query.isLoading && !query.data ? (
            <LoadingState label="Loading archived products…" />
          ) : (
            <FlatList
              data={query.data ?? []}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={
                <EmptyState
                  title={search.trim() ? 'No matching archived products' : 'No archived products'}
                  message={search.trim() ? 'Try another name or SKU.' : 'Products you archive from Edit Product show up here.'}
                />
              }
              renderItem={({ item }) => {
                const busy = pending?.id === item.id;
                return (
                  <View style={styles.card}>
                    <ListRowCard
                      icon="archive-outline"
                      title={item.name}
                      titleTag={item.sku}
                      meta={`Archived ${formatDateShort(item.archived_at ?? null)}`}
                      accessibilityLabel={`${item.name}, ${item.sku}, archived ${formatDateShort(item.archived_at ?? null)}`}
                    />
                    <View style={styles.actions}>
                      <View style={styles.action}>
                        <ManagerActionButton
                          label="Restore"
                          icon="arrow-undo-outline"
                          variant="secondary"
                          loading={busy && pending?.kind === 'restore'}
                          disabled={pending != null}
                          onPress={() => confirmRestore(item)}
                        />
                      </View>
                      <View style={styles.action}>
                        <ManagerActionButton
                          label="Delete"
                          icon="trash-outline"
                          variant="destructive"
                          loading={busy && pending?.kind === 'delete'}
                          disabled={pending != null}
                          onPress={() => confirmDelete(item)}
                        />
                      </View>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </ConstrainedWidth>
      </Screen>
    </MainBranchGuard>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  filters: { gap: 12, marginBottom: 14 },
  notice: { color: '#166534', fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  listContent: { paddingBottom: 16, flexGrow: 1 },
  separator: { height: 12 },
  card: { gap: 8 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
});
