import { useWindowDimensions } from 'react-native';

/** Shortest side ≥ 600 matches login and typical phone/tablet split. */
export const TABLET_MIN_EDGE = 600;

/** Phone landscape wide enough for catalog | order split. */
export const POS_SPLIT_MIN_WIDTH = 700;

export const layoutWidths = {
  /** Home / reading columns */
  content: 640,
  /** Profile / forms */
  form: 520,
  /** Checkout payment column */
  payment: 520,
  /** Sales / hub master pane */
  salesMaster: 360,
  /** Hub list column on tablet */
  hubMaster: 380,
  /** Product catalog max on tablet */
  catalog: 900,
  /** Supervisory list hubs (Owner) — single column, no split */
  hub: 720,
} as const;

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const shortest = Math.min(width, height);
  const isLandscape = width > height;
  const isTablet = shortest >= TABLET_MIN_EDGE;
  /** Split catalog | cart on tablet, or phone landscape with enough width. */
  const posSplit = isTablet || (isLandscape && width >= POS_SPLIT_MIN_WIDTH);
  const posColumns = !posSplit ? 1 : width >= 1100 ? 3 : 2;
  const productColumns = !isTablet ? 1 : 2;

  return {
    width,
    height,
    isTablet,
    isLandscape,
    posSplit,
    posColumns,
    productColumns,
    contentMaxWidth: layoutWidths.content,
    formMaxWidth: layoutWidths.form,
    paymentMaxWidth: layoutWidths.payment,
    salesMasterWidth: layoutWidths.salesMaster,
    hubMasterWidth: layoutWidths.hubMaster,
    catalogMaxWidth: layoutWidths.catalog,
    hubMaxWidth: layoutWidths.hub,
  };
}
