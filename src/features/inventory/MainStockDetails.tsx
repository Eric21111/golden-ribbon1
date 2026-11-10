import { StockUnitHint } from '@/components/StockUnitHint';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
import { useProductBranchPrices, useProductBranchVariantPrices } from '@/hooks/useBranchProducts';
import { useProductDrinkChoices, useProductStockUses, useProductVariants } from '@/hooks/useProducts';
import { formatMoney } from '@/lib/format';
import type { InventoryItem } from '@/types/models';

import { buildPriceSummary, buildUseRows, sendAction, stockDisplay, type BranchPriceState, type BranchRef } from './stockDetails';

const TONE_COLORS = { danger: '#B91C1C', warning: managerColors.goldMuted } as const;

/**
 * The body of the Main Inventory "Stock details" sheet, in the order a manager needs it: Main's own stock and what to do about it
 * first, then ONE card for how it is sold: per option, what each selling branch charges and, in small gray text beside it, what a
 * sale takes from stock. Everything is visible (no collapsing) and built from the same rounded cards as the rest of the sheet.
 * Read only, with as little text as it can get away with. A product whose sales take from other items (Extra Rice -> Rice) has no
 * stock of its own to count or send, so it points at those items instead of asking for its own opening stock.
 */
export function MainStockDetails({
  item,
  sellingBranches,
  nameOf,
  onSend,
  onOpening,
  onOpenProduct,
  sharedSources,
  setupReady,
}: {
  item: InventoryItem;
  sellingBranches: BranchRef[];
  nameOf: (productId: string) => string;
  onSend: () => void;
  onOpening: () => void;
  /** Show another product's stock details (the product this one takes its stock from). */
  onOpenProduct: (productId: string) => void;
  /** The products this one takes ALL its stock from (it has none of its own), or null when it counts its own stock. */
  sharedSources: Array<{ id: string; name: string }> | null;
  /** False while that is still being worked out (no action is offered yet). */
  setupReady: boolean;
}) {
  const productId = item.product.id;
  const variants = useProductVariants(productId);
  const branchPrices = useProductBranchPrices(productId);
  const branchVariantPrices = useProductBranchVariantPrices(productId);
  const stockUses = useProductStockUses(productId);
  const drinkChoices = useProductDrinkChoices(productId);

  const stock = stockDisplay(item);
  const action = sendAction(item);
  const stockOnly = item.product.sell_in_pos === false;

  const pricesReady = variants.data && branchPrices.data && branchVariantPrices.data;
  const prices = useMemo(
    () =>
      pricesReady
        ? buildPriceSummary({
            product: item.product,
            variants: variants.data!,
            branchProducts: branchPrices.data!,
            branchVariants: branchVariantPrices.data!,
            branches: sellingBranches,
          })
        : null,
    [pricesReady, item.product, variants.data, branchPrices.data, branchVariantPrices.data, sellingBranches],
  );
  const usesReady = variants.data && stockUses.data && drinkChoices.data;
  const uses = useMemo(
    () =>
      usesReady
        ? buildUseRows({
            product: { id: productId, name: item.product.name },
            variants: variants.data!,
            stockUses: stockUses.data!,
            drinkChoices: drinkChoices.data!,
            nameOf,
          })
        : null,
    [usesReady, productId, item.product.name, variants.data, stockUses.data, drinkChoices.data, nameOf],
  );
  const failed = variants.error || branchPrices.error || branchVariantPrices.error || stockUses.error || drinkChoices.error;
  // Sales take from other items only: this product has nothing of its own to count or send
  const sharedStock = !stockOnly && sharedSources != null && sharedSources.length > 0;
  const ownBalanceKnown = item.updated_at != null;
  // what each option takes from stock, by option, for the price cards (none until it has loaded)
  const usesByOption = new Map(uses?.rows.map((row) => [row.key, row]) ?? []);
  // not repeated when the card above already says it (Extra Rice -> Rice)
  const hideUses = sharedStock && uses?.rows.length === 1;
  const chipsFor = (key: string): { chips: string[]; drink: string | null } => {
    const row = hideUses ? undefined : usesByOption.get(key);
    if (!row) return { chips: [], drink: null };
    // a product with no options that just takes itself x1 says nothing worth a chip
    const obvious = key === 'product' && row.usesOwnStock && row.items.length === 1 && / ×1$/.test(row.items[0]!);
    return {
      chips: obvious ? [] : row.items.map((text) => text.replace(/ ×1$/, '')),
      // the cashier picks ONE of these drinks, so they read as alternatives: "Bottled Water or Coke Mismo"
      drink: row.drinks.length === 0 ? null : row.drinks.length === 1 ? row.drinks[0]! : `${row.drinks.slice(0, -1).join(', ')} or ${row.drinks[row.drinks.length - 1]}`,
    };
  };
  const toneColor = stock.tone === 'danger' || stock.tone === 'warning' ? TONE_COLORS[stock.tone] : undefined;

  return (
    <View style={styles.wrap}><StockUnitHint code={item.product.stock_unit_code} />
      <View style={styles.section}>
        <Text style={styles.label}>{sharedStock ? 'STOCK' : 'STOCK AT MAIN'}</Text>
        {sharedStock ? (
          <SummaryCard
            rows={[
              { label: 'Uses stock from', value: sharedSources.map((source) => source.name).join(', '), emphasis: true },
              ...(ownBalanceKnown ? [{ label: 'Own balance', value: `${stock.value} · not used by sales` }] : []),
            ]}
          />
        ) : (
          <>
            <View style={styles.tiles}>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>On hand</Text>
                <Text style={[styles.tileValue, styles.tileValueMain, toneColor ? { color: toneColor } : null]} numberOfLines={1}>
                  {stock.value}
                </Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Updated</Text>
                <Text style={styles.tileValue} numberOfLines={2}>
                  {stock.updated}
                </Text>
              </View>
            </View>
            {stock.note ? <Text style={styles.note}>{stock.note}</Text> : null}
          </>
        )}
      </View>

      <View style={styles.actions}>
        {sharedStock ? (
          sharedSources.slice(0, 3).map((source) => (
            <ManagerActionButton key={source.id} label={`View ${source.name} stock`} variant="secondary" onPress={() => onOpenProduct(source.id)} />
          ))
        ) : !setupReady && !stockOnly ? (
          <Text style={styles.note}>Checking stock setup…</Text>
        ) : (
          <>
            <ManagerActionButton
              label={action.label}
              variant="secondary"
              icon={action.kind === 'opening' ? 'create-outline' : 'paper-plane-outline'}
              disabled={action.kind === 'blocked'}
              onPress={action.kind === 'opening' ? onOpening : onSend}
            />
            {action.hint ? <Text style={styles.note}>{action.hint}</Text> : null}
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{prices?.hasOptions ? 'SOLD AS' : 'SELLING PRICES'}</Text>
        {stockOnly ? (
          <View style={styles.card}>
            <Text style={styles.stockOnly}>Not sold in the POS</Text>
          </View>
        ) : failed ? (
          <Text style={styles.note}>Couldn&apos;t load this. Close and reopen to try again.</Text>
        ) : !prices ? (
          <Text style={styles.note}>Loading…</Text>
        ) : prices.hasOptions ? (
          <SoldAsCard
            blocks={prices.options.map((option) => ({
              key: option.key,
              title: option.retired ? `${option.name} · Retired` : option.name,
              ...chipsFor(option.key),
              prices: option.branches.map(priceLine),
            }))}
          />
        ) : (
          <SoldAsCard blocks={[{ key: 'product', ...chipsFor('product'), prices: prices.product.map(priceLine) }]} />
        )}
      </View>
    </View>
  );
}

type PriceLine = { key: string; label: string; value: string; muted?: boolean };
type SoldAsBlock = { key: string; title?: string; chips: string[]; drink: string | null; prices: PriceLine[] };

/** One branch's price for an option: the price, "₱20.00 · Off" when switched off, or "Not added" when it has no row. */
function priceLine(branch: BranchPriceState): PriceLine {
  if (branch.state === 'not_added') return { key: branch.branchId, label: branch.branchName, value: 'Not added', muted: true };
  const price = formatMoney(branch.price ?? 0);
  return branch.state === 'off'
    ? { key: branch.branchId, label: branch.branchName, value: `${price} · Off`, muted: true }
    : { key: branch.branchId, label: branch.branchName, value: price };
}

/**
 * ONE rounded card for every way the product is sold, options separated by thin dividers. Each option is a block of full-width
 * rows, so every branch name and price lines up from one option to the next: the option name, one row per selling branch
 * (name left, price right), then what a sale takes from stock as small chips (the drink choices in one blue chip).
 */
function SoldAsCard({ blocks }: { blocks: SoldAsBlock[] }) {
  return (
    <View style={styles.card}>
      {blocks.map((block, index) => (
        <View key={block.key} style={[styles.block, index > 0 && styles.blockDivider]}>
          {block.title ? <Text style={styles.blockTitle}>{block.title}</Text> : null}
          <View style={styles.priceRows}>
            {block.prices.map((line) => (
              <View key={line.key} style={styles.priceLine}>
                <Text style={styles.priceLabel} numberOfLines={2}>
                  {line.label}
                </Text>
                <Text style={[styles.priceValue, line.muted && styles.priceValueMuted]}>{line.value}</Text>
              </View>
            ))}
          </View>
          {block.chips.length > 0 || block.drink ? (
            <View style={styles.chips}>
              {block.chips.map((chip) => (
                <View key={chip} style={styles.chip}>
                  <Text style={styles.chipText}>{chip}</Text>
                </View>
              ))}
              {block.drink ? (
                <View style={[styles.chip, styles.chipDrink]}>
                  <Ionicons name="cafe-outline" size={13} color={managerColors.royalBlue} />
                  <Text style={[styles.chipText, styles.chipDrinkText]}>{block.drink}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16, paddingBottom: 8 },
  section: { gap: 8 },
  label: { color: managerColors.subtext, fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.6 },
  note: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  actions: { gap: 8 },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  tileLabel: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13 },
  tileValue: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  tileValueMain: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 20 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  stockOnly: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14, paddingVertical: 14 },
  block: { paddingVertical: 14, gap: 10 },
  blockDivider: { borderTopWidth: 1, borderTopColor: managerColors.cardBorder },
  blockTitle: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  priceRows: { gap: 8 },
  priceLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  priceLabel: { flex: 1, minWidth: 0, color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14 },
  priceValue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 15 },
  priceValueMuted: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%', backgroundColor: '#EEF2FA', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { flexShrink: 1, color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 12 },
  chipDrink: { backgroundColor: '#DCE8FC' },
  chipDrinkText: { color: managerColors.royalBlue },
});
