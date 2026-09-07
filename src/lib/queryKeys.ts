export const queryKeys = {
  profile: (userId: string) => ['profile', userId] as const,
  branches: ['branches'] as const,
  branch: (id: string) => ['branches', id] as const,
  products: (search = '', activeOnly = false) =>
    ['products', { search, activeOnly }] as const,
  product: (id: string) => ['products', id] as const,
  inventory: (branchId: string, activeOnly = false) => ['inventory', branchId, { activeOnly }] as const,
  transfers: (branchId = '', status = '') => ['transfers', { branchId, status }] as const,
  transfer: (id: string) => ['transfers', id] as const,
  movements: (branchId = '') => ['inventory-movements', { branchId }] as const,
  activeShift: (cashierId: string) => ['shifts', 'active', cashierId] as const,
  employees: ['employees'] as const,
  returns: (branchId = '', status = '') => ['stock-returns', { branchId, status }] as const,
  return: (id: string) => ['stock-returns', id] as const,
  returnDiscrepancies: ['return-discrepancies'] as const,
  sales: (filters: Record<string, unknown> = {}) => ['sales', filters] as const,
  sale: (id: string) => ['sales', id] as const,
  shiftSummary: (id: string) => ['shifts', 'summary', id] as const,
  shiftSummaries: (filters: Record<string, unknown> = {}) => ['shifts', 'history', filters] as const,
  salesByBranch: (rangeType = 'today', startDate = '', endDate = '') =>
    ['reports', 'sales-by-branch', { rangeType, startDate, endDate }] as const,
  productSales: (rangeType = 'today', branchId = '', startDate = '', endDate = '') =>
    ['reports', 'product-sales', { rangeType, branchId, startDate, endDate }] as const,
  ownerDashboard: ['dashboard', 'owner'] as const,
  managerDashboard: ['dashboard', 'manager'] as const,
  managerRecentSales: ['dashboard', 'manager', 'recent-sales'] as const,
  branchPerformance: (rangeType = 'today', startDate = '', endDate = '') =>
    ['reports', 'branch-performance', { rangeType, startDate, endDate }] as const,
  branchPerformanceDetails: (branchId: string, rangeType = 'today', startDate = '', endDate = '') =>
    ['reports', 'branch-performance-details', branchId, { rangeType, startDate, endDate }] as const,
  transferDiscrepanciesReport: (
    branchId = '',
    discrepancyType = '',
    rangeType = 'today',
    startDate = '',
    endDate = ''
  ) =>
    [
      'reports',
      'transfer-discrepancies',
      { branchId, discrepancyType, rangeType, startDate, endDate },
    ] as const,
  returnDiscrepanciesReport: (
    branchId = '',
    discrepancyType = '',
    rangeType = 'today',
    startDate = '',
    endDate = ''
  ) =>
    [
      'reports',
      'return-discrepancies',
      { branchId, discrepancyType, rangeType, startDate, endDate },
    ] as const,
  inventoryReconciliation: (branchId = '') =>
    ['reports', 'inventory-reconciliation', { branchId }] as const,
  auditLogs: (filters: Record<string, unknown> = {}) =>
    ['audit', 'logs', filters] as const,
  auditLogDetail: (id: string) =>
    ['audit', 'log', id] as const,
} as const;

