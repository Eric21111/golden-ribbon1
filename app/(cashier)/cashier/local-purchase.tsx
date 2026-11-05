import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/AuthProvider';
import { QuantityListScreen, type QuantityRow } from '@/features/stock/QuantityListScreen';
import { QuantityDoneScreen, QuantityReviewScreen, type ReviewLine } from '@/features/stock/QuantityReviewScreens';
import { getInventoryErrorMessage } from '@/lib/errors';
import { makeIdempotencyKey } from '@/lib/format';
import {
  listCashierLocalPurchaseCatalog,
  recordBranchLocalPurchase,
} from '@/services/inventoryService';

type QtyMap = Record<string, string>;

export default function LocalPurchaseScreen() {
  const { profile } = useAuth();
  const client = useQueryClient();
  const [qty, setQty] = useState<QtyMap>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [recorded, setRecorded] = useState<ReviewLine[] | null>(null);
  const keyRef = useRef(makeIdempotencyKey('local-purchase'));

  const catalog = useQuery({
    queryKey: ['local-purchase-catalog', profile?.branch_id],
    queryFn: listCashierLocalPurchaseCatalog,
  });

  // the products with a quantity entered, as the lines of the review and of the request
  const lines = useMemo(() => {
    const rows = catalog.data ?? [];
    return rows.flatMap((row) => {
      const raw = (qty[row.product_id] ?? '').trim();
      if (!raw || raw === '0') return [];
      return [{ product_id: row.product_id, name: row.product_name, sku: row.product_sku, category: row.product_category, onHand: row.quantity_on_hand, quantity: raw }];
    });
  }, [catalog.data, qty]);

  const reviewLines: ReviewLine[] = lines.map((line) => ({
    id: line.product_id,
    name: line.name,
    sku: line.sku,
    category: line.category,
    quantity: Number(line.quantity),
    caption: `On hand ${line.onHand}`,
  }));

  const mutation = useMutation({
    mutationFn: () =>
      recordBranchLocalPurchase(
        lines.map(({ product_id, quantity }) => ({ product_id, quantity })),
        notes.trim() || null,
        keyRef.current,
      ),
    onSuccess: async () => {
      setError('');
      // what was recorded stays on screen after the catalog refreshes
      setRecorded(reviewLines);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['local-purchase-catalog'] }),
        client.invalidateQueries({ queryKey: ['inventory'] }),
        client.invalidateQueries({ queryKey: ['cashier-pos-inventory'] }),
      ]);
    },
    onError: (failure) => setError(getInventoryErrorMessage(failure)),
  });

  const branchName = profile?.branch?.name ?? 'Branch';

  if (recorded) {
    return (
      <QuantityDoneScreen
        title="Purchase recorded"
        subtitle={branchName}
        heading={`Added to ${branchName} stock. Main stock is unchanged.`}
        lines={recorded}
        quantityCaption="added"
        doneLabel="Back to home"
        onDone={() => router.replace('/cashier/dashboard')}
      />
    );
  }

  if (reviewing) {
    return (
      <QuantityReviewScreen
        title="Review purchase"
        subtitle={branchName}
        lines={reviewLines}
        quantityCaption="adding"
        notes={notes}
        onNotesChange={setNotes}
        notesMaxLength={1000}
        formError={error || null}
        onBack={() => {
          setError('');
          setReviewing(false);
        }}
        confirming={mutation.isPending}
        onConfirm={() => {
          if (lines.length === 0 || mutation.isPending) return;
          setError('');
          mutation.mutate();
        }}
      />
    );
  }

  const rows: QuantityRow[] = (catalog.data ?? []).map((row) => ({
    id: row.product_id,
    name: row.product_name,
    sku: row.product_sku,
    category: row.product_category,
    onHand: row.quantity_on_hand,
  }));

  return (
    <QuantityListScreen
      title="Local purchase"
      subtitle={branchName}
      rows={rows}
      loading={catalog.isLoading}
      loadError={catalog.error ? getInventoryErrorMessage(catalog.error) : null}
      onRetry={() => void catalog.refetch()}
      quantities={qty}
      onQuantityChange={(id, value) => setQty((current) => ({ ...current, [id]: value }))}
      emptyTitle="Nothing to purchase"
      emptyMessage="Ask Main to turn on Keep Unsold Stock at Branch for a product first."
      formError={null}
      actionLabel="Review purchase"
      actionLoading={false}
      actionDisabled={lines.length === 0}
      onAction={() => {
        setError('');
        setReviewing(true);
      }}
    />
  );
}
