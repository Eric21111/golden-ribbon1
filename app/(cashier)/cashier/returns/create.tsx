import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';

import { useAuth } from '@/features/auth/AuthProvider';
import { QuantityListScreen, type QuantityRow } from '@/features/stock/QuantityListScreen';
import { QuantityDoneScreen, QuantityReviewScreen, type ReviewLine } from '@/features/stock/QuantityReviewScreens';
import { getErrorMessage, getInventoryErrorMessage } from '@/lib/errors';
import { makeIdempotencyKey } from '@/lib/format';
import { listCashierProductCategories } from '@/services/inventoryService';
import { createStockReturn, listReturnStock } from '@/services/returnService';
import { useReturnStore } from '@/stores/returnStore';
import type { ReturnRequest } from '@/types/returns';

function savedReturnRequest(request: { p_items?: ReturnRequest['p_items']; p_notes: string | null; p_idempotency_key: string } | undefined): ReturnRequest | null {
  if (!request?.p_items?.length) return null;
  return {
    p_items: request.p_items,
    p_notes: request.p_notes,
    p_idempotency_key: request.p_idempotency_key,
  };
}

type Entered = { product_id: string; name: string; sku: string; category: string | null | undefined; quantity: number; system: number };

/** What was counted against what the system says: nothing to explain when they agree. */
function returnLine(entry: Entered): ReviewLine {
  const difference = entry.quantity - entry.system;
  return {
    id: entry.product_id,
    name: entry.name,
    sku: entry.sku,
    category: entry.category,
    quantity: entry.quantity,
    caption: `System ${entry.system}`,
    flag:
      difference === 0
        ? { label: 'Matches system', tone: 'success' }
        : { label: difference < 0 ? `${-difference} short` : `${difference} over`, tone: 'warning' },
  };
}

export default function CreateReturnScreen() {
  const { profile } = useAuth();
  const user = profile?.id ?? '';
  const saved = useReturnStore((state) => state.byUser[user]);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['return-inventory', user, profile?.branch_id],
    queryFn: async () => {
      const [stock, categories] = await Promise.all([listReturnStock(), listCashierProductCategories()]);
      return stock.map((row) => ({ ...row, product_category: categories.get(row.product_id) ?? null }));
    },
  });
  const [notes, setNotes] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [submitted, setSubmitted] = useState<Entered[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const leftover = query.data ?? [];

  // the products with a quantity entered: whole pieces above zero, nothing else
  const entered: Entered[] = leftover.flatMap((row) => {
    const raw = (qty[row.product_id] ?? '').trim();
    const quantity = Number.parseInt(raw, 10);
    if (!raw || !Number.isInteger(quantity) || quantity <= 0) return [];
    return [
      {
        product_id: row.product_id,
        name: row.product_name,
        sku: row.product_sku,
        category: row.product_category,
        quantity,
        system: Number(row.quantity_on_hand),
      },
    ];
  });

  async function confirm() {
    if (lock.current || !user) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const lines = entered;
    const savedRequest = savedReturnRequest(saved?.request);
    if (!savedRequest && lines.length === 0) {
      setError('Enter a quantity for at least one product.');
      lock.current = false;
      setBusy(false);
      return;
    }
    const request = savedRequest ?? {
          p_items: lines.map(({ product_id, quantity }) => ({ product_id, quantity_returned: quantity })),
          p_notes: notes.trim() || null,
          p_idempotency_key: makeIdempotencyKey('return'),
        };
    try {
      useReturnStore.getState().save(user, { request });
      const id = await createStockReturn(request);
      if (!saved?.request) {
        setSubmitted(lines);
      }
      useReturnStore.getState().save(user, { request, id });
      await Promise.all(
        ['inventory', 'inventory-movements', 'stock-returns', 'return-inventory'].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } catch (failure) {
      const code =
        typeof failure === 'object' && failure && 'code' in failure ? String(failure.code) : '';
      if (['22023', '42501', '23514', 'P0001', '40P01', '40001'].includes(code)) {
        useReturnStore.getState().clear(user);
        void query.refetch();
      }
      setError(getInventoryErrorMessage(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const branchLine = `${profile?.branch?.name ?? 'Assigned branch'} → Main Branch`;

  if (saved?.id) {
    return (
      <QuantityDoneScreen
        title="Return submitted"
        subtitle={branchLine}
        heading="In transit to Main Branch"
        lines={(submitted ?? []).map(returnLine)}
        quantityCaption="returned"
        doneLabel="Back to home"
        onDone={() => {
          useReturnStore.getState().clear(user);
          router.replace('/cashier/dashboard');
        }}
      />
    );
  }

  // A request that was saved but never confirmed (the connection dropped): shown for review as it was saved, read-only, so the
  // retry can never send something different or deduct stock twice.
  const savedRequest = savedReturnRequest(saved?.request);
  if (reviewing || savedRequest) {
    const known = new Map(leftover.map((row) => [row.product_id, row]));
    const lines: ReviewLine[] = savedRequest
      ? savedRequest.p_items.map((item) => {
          const row = known.get(item.product_id);
          const quantity = Number(item.quantity_returned);
          return row
            ? returnLine({ product_id: row.product_id, name: row.product_name, sku: row.product_sku, category: row.product_category, quantity, system: Number(row.quantity_on_hand) })
            : { id: item.product_id, name: 'Product', sku: '', category: null, quantity };
        })
      : entered.map(returnLine);
    return (
      <QuantityReviewScreen
        title="Review return"
        subtitle={branchLine}
        lines={lines}
        quantityCaption="returning"
        notes={savedRequest ? savedRequest.p_notes ?? '' : notes}
        onNotesChange={setNotes}
        notesMaxLength={2000}
        notesLocked={Boolean(savedRequest)}
        formError={error || null}
        lockedNote={savedRequest ? 'Saved. Retry to check the result. Stock is never deducted twice.' : null}
        canEdit={!savedRequest}
        onBack={() => {
          setError('');
          setReviewing(false);
        }}
        confirmLabel={savedRequest ? 'Retry' : 'Confirm'}
        confirming={busy}
        onConfirm={() => void confirm()}
      />
    );
  }

  const rows: QuantityRow[] = leftover.map((row) => ({
    id: row.product_id,
    name: row.product_name,
    sku: row.product_sku,
    category: row.product_category,
    onHand: Number(row.quantity_on_hand),
  }));

  return (
    <QuantityListScreen
      title="Create return"
      subtitle={branchLine}
      rows={rows}
      loading={query.isLoading}
      loadError={query.error ? getErrorMessage(query.error) : null}
      onRetry={() => void query.refetch()}
      quantities={qty}
      onQuantityChange={(id, value) => setQty((current) => ({ ...current, [id]: value }))}
      showMax
      emptyTitle="No leftover stock"
      emptyMessage="Only products still on hand at this branch appear here."
      formError={error || null}
      actionLabel="Review return"
      actionLoading={false}
      actionDisabled={entered.length === 0 || Boolean(query.error)}
      onAction={() => {
        setError('');
        setReviewing(true);
      }}
    />
  );
}
