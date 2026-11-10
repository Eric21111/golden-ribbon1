import { Text } from 'react-native';
import { stockUnit, type StockUnitCode } from '@/lib/stockUnits';

/** Unit definitions are immutable, so the same hint is valid for live stock and history. */
export function StockUnitHint({ code }: { code?: StockUnitCode | null }) {
  const unit = stockUnit(code);
  if (!unit || code === 'piece') return null;
  return <Text style={{ fontSize: 12, color: '#475569', marginVertical: 4 }}>Count in {unit.plural}. {unit.hint}</Text>;
}
