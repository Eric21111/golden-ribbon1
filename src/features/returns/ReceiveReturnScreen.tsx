import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { AppButton } from '@/components/AppButton';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useReceiveReturn, useReturn } from '@/hooks/useReturns';
import { getInventoryErrorMessage } from '@/lib/errors';
import { makeIdempotencyKey } from '@/lib/format';
import { ReturnStatusBadge } from './ReturnStatusBadge';

const schema = z.object({
  items: z.array(z.object({
    stock_return_item_id: z.string(),
    quantity_received: z.string().min(1, 'Enter the physical count.').regex(/^\d+$/, 'Enter a whole number of zero or greater.'),
  })).min(1),
  notes: z.string().max(1000).optional(),
});
type Values = z.infer<typeof schema>;

export function ReceiveReturnScreen({ role }: { role: 'owner' | 'manager' }) {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const query = useReturn(id);
  const mutation = useReceiveReturn();
  const requestKey = useRef(makeIdempotencyKey('return-receive'));
  const formInitialized = useRef(false);
  const [review, setReview] = useState<Values | null>(null);

  const { control, handleSubmit, reset } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { items: [], notes: '' },
  });
  const { fields } = useFieldArray({ control, name: 'items' });

  useEffect(() => {
    if (query.data && !formInitialized.current) {
      reset({
        items: query.data.items.map((item) => ({
          stock_return_item_id: item.id,
          quantity_received: '',
        })),
        notes: '',
      });
      formInitialized.current = true;
    }
  }, [query.data, reset]);

  const reviewItems = useMemo(() => {
    return review?.items.map((value) => {
      const returnItem = query.data?.items.find((item) => item.id === value.stock_return_item_id);
      const received = Number(value.quantity_received);
      return returnItem
        ? {
            ...returnItem,
            received,
            difference: returnItem.quantity_returned - received,
          }
        : null;
    }).filter((item) => item !== null) ?? [];
  }, [query.data?.items, review]);

  if (query.isLoading) return <LoadingState label="Loading stock return…" />;
  if (query.error || !query.data) {
    return (
      <Screen>
        <ErrorState message="Unable to load stock return." onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const stockReturn = query.data;

  // Authorization check: Main Branch receiving is Owner-only.
  if (role !== 'owner') {
    return (
      <Screen>
        <PageHeader title="Unauthorized" subtitle="Only the Owner can receive returns at Main Branch." />
        <AppButton label="Go back" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (stockReturn.status !== 'in_transit') {
    return (
      <Screen>
        <PageHeader title="Stock return" subtitle="This return is no longer in transit." />
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.name}>{stockReturn.return_number}</Text>
            <ReturnStatusBadge status={stockReturn.status} />
          </View>
          <Text style={styles.meta}>From: {stockReturn.from_branch_name}</Text>
          <Text style={styles.meta}>To: {stockReturn.to_branch_name}</Text>
          <Text style={styles.meta}>Received by: {stockReturn.received_by_name ?? 'Staff'}</Text>
        </View>
        <AppButton
          label="View details"
          variant="secondary"
          onPress={() => {
            const detailRoute = role === 'owner' ? `/owner/returns/${stockReturn.id}` : `/manager/returns/${stockReturn.id}`;
            router.replace(detailRoute as any);
          }}
        />
      </Screen>
    );
  }

  if (review) {
    return (
      <Screen>
        <PageHeader
          title="Review return receipt"
          subtitle={`${stockReturn.return_number} · Confirm actual received physical counts.`}
        />
        {reviewItems.map((item) => (
          <View key={item.id} style={[styles.card, item.difference !== 0 && styles.warningCard]}>
            <Text style={styles.name}>{item.product_name}</Text>
            <Text style={styles.meta}>SKU: {item.product_sku}</Text>
            <Text style={styles.meta}>Expected (Returned): {item.quantity_returned}</Text>
            <Text style={styles.received}>Actual Received: {item.received}</Text>
            <Text style={item.difference === 0 ? styles.complete : styles.warning}>
              {item.difference === 0
                ? 'Complete (Exact Match)'
                : item.difference > 0
                ? `${item.difference} missing`
                : `${Math.abs(item.difference)} excess`}
            </Text>
          </View>
        ))}

        {review.notes ? <Text style={styles.meta}>Notes: {review.notes}</Text> : null}
        {mutation.error ? (
          <Text style={styles.error}>{getInventoryErrorMessage(mutation.error)}</Text>
        ) : null}

        <AppButton
          label="Confirm receipt"
          loading={mutation.isPending}
          onPress={() =>
            mutation.mutate(
              {
                returnId: stockReturn.id,
                items: reviewItems.map((item) => ({
                  stock_return_item_id: item.id,
                  quantity_received: item.received,
                })),
                notes: review.notes?.trim() || null,
                idempotencyKey: requestKey.current,
              },
              {
                onSuccess: (finalStatus) => {
                  setReview(null);
                  Alert.alert(
                    'Return received',
                    `Main branch inventory was successfully updated. Final status: ${finalStatus.replaceAll('_', ' ')}.`,
                    [
                      {
                        text: 'View details',
                        onPress: () => {
                          const detailRoute = role === 'owner' ? `/owner/returns/${stockReturn.id}` : `/manager/returns/${stockReturn.id}`;
                          router.replace(detailRoute as any);
                        },
                      },
                    ]
                  );
                  void query.refetch();
                },
              }
            )
          }
        />
        <AppButton
          label="Back to counts"
          variant="secondary"
          disabled={mutation.isPending}
          onPress={() => setReview(null)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader
        title="Receive return"
        subtitle={`${stockReturn.return_number} · ${stockReturn.from_branch_name} → ${stockReturn.to_branch_name}`}
      />
      <Text style={styles.instructions}>
        Physically count all returned products. Do not assume the declared returned quantity matches what was received.
      </Text>

      {fields.map((field, index) => {
        const item = stockReturn.items[index];
        if (!item) return null;
        return (
          <View key={field.id} style={styles.card}>
            <Text style={styles.name}>{item.product_name}</Text>
            <Text style={styles.meta}>
              {item.product_sku} · Returned by branch: {item.quantity_returned}
            </Text>
            <Controller
              control={control}
              name={`items.${index}.quantity_received`}
              render={({ field: quantity, fieldState }) => (
                <FormField
                  label="Actual physical count"
                  value={quantity.value}
                  onChangeText={quantity.onChange}
                  keyboardType="number-pad"
                  placeholder="0"
                  error={fieldState.error?.message}
                />
              )}
            />
          </View>
        );
      })}

      <Controller
        control={control}
        name="notes"
        render={({ field }) => (
          <FormField
            label="Receiving notes (optional)"
            value={field.value ?? ''}
            onChangeText={field.onChange}
            multiline
            maxLength={1000}
          />
        )}
      />

      <AppButton label="Review receipt" onPress={handleSubmit(setReview)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  warningCard: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FFF7F7',
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  meta: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  received: {
    color: colors.primary,
    fontSize: 17,
    fontWeight: '800',
  },
  complete: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '800',
  },
  warning: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '800',
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  instructions: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
  },
});
